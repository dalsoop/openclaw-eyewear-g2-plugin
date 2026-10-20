#!/usr/bin/env node
// Alert the paired phone when the OcuClaw patch points are missing after a gateway start.
// Never re-applies the patch; it only checks and notifies.
//   node scripts/patch-watch.mjs run [--reason TEXT]  one check; alert the phone (with retry) if points are missing
//   node scripts/patch-watch.mjs watch                daemon: tail gateway.log, `run` on every "[gateway] ready"
//   node scripts/patch-watch.mjs install | uninstall   LaunchAgent (idempotent)
//   node scripts/patch-watch.mjs status                LaunchAgent state + recent log
//   node scripts/patch-watch.mjs test                  unit tests
// Env: PATCH_WATCH_RETRY_INTERVAL_SEC (30), PATCH_WATCH_RETRY_MAX_SEC (600), PATCH_WATCH_NODE (phone id/name override),
//      PATCH_WATCH_STATE_DIR (~/.openclaw/ocuclaw-g2), PATCH_WATCH_GATEWAY_LOG, OPENCLAW, NODE.
// `run` exit codes: 0 no alert needed (incl. stale payload, logged only), 10 alert sent, 11 alert not delivered, 12 check error.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseCheckOutput,
  decide,
  buildAlert,
  displayPath,
  pickPhoneNode,
  retryConfig,
  sendWithRetry,
  ReadyScanner,
  formatNotifyResult,
  redactNodeIds,
} from "./patch-watch/lib.mjs";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const HOME = os.homedir();
const NODE = process.env.NODE || "/opt/homebrew/opt/node/bin/node";
const OPENCLAW = process.env.OPENCLAW || path.join(HOME, ".local/bin/openclaw");
const STATE_DIR = process.env.PATCH_WATCH_STATE_DIR || path.join(HOME, ".openclaw/ocuclaw-g2");
const LOG = path.join(STATE_DIR, "patch-watch.log");
const STATE_FILE = path.join(STATE_DIR, "patch-watch.state.json");
const GATEWAY_LOG = process.env.PATCH_WATCH_GATEWAY_LOG || path.join(HOME, "Library/Logs/openclaw/gateway.log");
const LABEL = "com.openclaw-g2.patch-watch";
const PLIST = path.join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const TEMPLATE = path.join(ROOT, "scripts/patch-watch/launchagent.plist.template");
const POLL_MS = 2000;

function log(msg) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const line = `${new Date().toISOString()} [${process.pid}] ${redactNodeIds(msg)}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

function parseJsonOut(text) {
  const i = String(text || "").indexOf("{");
  if (i < 0) return null;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return null;
  }
}

function runCheck() {
  const r = spawnSync(NODE, [path.join(ROOT, "ocuclaw-patch/cli.mjs"), "check"], {
    encoding: "utf8",
    timeout: 60000,
  });
  if (r.error) return { kind: "error", detail: `check failed to run: ${r.error.message}` };
  return parseCheckOutput(r.status, r.stdout, r.stderr);
}

function notifyOnce(alert) {
  const st = spawnSync(OPENCLAW, ["nodes", "status", "--json"], { encoding: "utf8", timeout: 30000 });
  if (st.status !== 0) return { ok: false, error: `nodes status exit ${st.status}` };
  const node = pickPhoneNode(parseJsonOut(st.stdout), process.env.PATCH_WATCH_NODE);
  if (!node) return { ok: false, error: "phone node not connected" };
  const r = spawnSync(
    OPENCLAW,
    ["nodes", "notify", "--node", node.id, "--title", alert.title, "--body", alert.body,
      "--priority", "timeSensitive", "--json"],
    { encoding: "utf8", timeout: 45000 },
  );
  const out = parseJsonOut(r.stdout);
  if (r.status === 0 && !(out && out.ok === false)) {
    return { ok: true, node: node.id.slice(0, 8) };
  }
  const err = (r.stderr || r.stdout || "").trim().split("\n").slice(-1)[0];
  return { ok: false, error: `notify exit ${r.status}${err ? `: ${err.slice(0, 200)}` : ""}` };
}

async function cmdRun(opts) {
  log(`run start (reason: ${opts.reason || "manual"})`);
  const d = decide(runCheck());
  log(d.log);
  if (d.log.startsWith("check error")) return 12;
  if (!d.notify) return 0;
  const alert = buildAlert(d.points, displayPath(ROOT, HOME));
  log(`alert text: ${alert.title} / ${alert.body}`);
  const cfg = retryConfig(process.env);
  const res = await sendWithRetry(() => notifyOnce(alert), {
    ...cfg,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    onAttempt: (n, r) => log(formatNotifyResult(n, r)),
  });
  if (res.ok) {
    log(`ALERT SENT after ${res.attempts} attempt(s)`);
    return 10;
  }
  log(`ALERT NOT DELIVERED after ${res.attempts} attempt(s) over ${cfg.maxMs / 1000}s: ${redactNodeIds(res.lastError)}. ` +
    `Missing: ${d.points.join(", ")}. Re-apply: ${displayPath(ROOT, HOME)}/scripts/ocuclaw-patch.sh apply && openclaw gateway restart`);
  return 11;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s) + "\n");
}

function lastReadyLine(file) {
  try {
    const size = fs.statSync(file).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, "r");
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n").filter((l) => /\[gateway\] ready\s*$/.test(l));
    return lines.length ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

async function cmdWatch() {
  log(`watch start (gateway log ${GATEWAY_LOG})`);
  let child = null;
  const trigger = (reason, readyLine) => {
    if (child && child.exitCode === null) {
      log("superseding the previous run (new gateway start)");
      child.kill("SIGTERM");
    }
    if (readyLine) writeState({ lastReady: readyLine });
    child = spawn(NODE, [SELF, "run", "--reason", reason], { stdio: "ignore" });
  };

  // Catch a start that happened before this watcher came up (login race), once per ready line.
  const last = lastReadyLine(GATEWAY_LOG);
  if (last && readState().lastReady !== last) trigger("gateway start before watcher", last);

  let offset = (() => {
    try {
      return fs.statSync(GATEWAY_LOG).size;
    } catch {
      return 0;
    }
  })();
  let scanner = new ReadyScanner();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    let size;
    try {
      size = fs.statSync(GATEWAY_LOG).size;
    } catch {
      continue;
    }
    if (size < offset) {
      offset = 0;
      scanner = new ReadyScanner();
    }
    if (size === offset) continue;
    const buf = Buffer.alloc(size - offset);
    const fd = fs.openSync(GATEWAY_LOG, "r");
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    const text = buf.toString("utf8");
    if (scanner.feed(text) > 0) {
      const lines = text.split("\n").filter((l) => /\[gateway\] ready\s*$/.test(l));
      log("gateway start detected");
      trigger("gateway start", lines[lines.length - 1] || null);
    }
  }
}

function uid() {
  return String(process.getuid());
}

function loaded() {
  return spawnSync("launchctl", ["print", `gui/${uid()}/${LABEL}`], { stdio: "ignore" }).status === 0;
}

function cmdInstall() {
  const envPath = ["/opt/homebrew/opt/node/bin", path.join(HOME, ".local/bin"), "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const plist = fs
    .readFileSync(TEMPLATE, "utf8")
    .replaceAll("__LABEL__", LABEL)
    .replaceAll("__NODE__", NODE)
    .replaceAll("__ROOT__", ROOT)
    .replaceAll("__STATE_DIR__", STATE_DIR)
    .replaceAll("__PATH__", envPath);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const current = fs.existsSync(PLIST) ? fs.readFileSync(PLIST, "utf8") : null;
  if (current === plist && loaded()) {
    console.log(`install: already installed (${PLIST} -> ${ROOT})`);
    return 0;
  }
  if (loaded()) spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], { stdio: "ignore" });
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
  const r = spawnSync("launchctl", ["bootstrap", `gui/${uid()}`, PLIST], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`install: launchctl bootstrap failed (${r.status}): ${(r.stderr || "").trim()}`);
    return 1;
  }
  console.log(`install: loaded ${LABEL} (${PLIST} -> ${ROOT})`);
  return 0;
}

function cmdUninstall() {
  const was = loaded();
  if (was) spawnSync("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], { stdio: "ignore" });
  const had = fs.existsSync(PLIST);
  if (had) fs.unlinkSync(PLIST);
  console.log(was || had ? `uninstall: removed ${LABEL}` : "uninstall: not installed");
  return 0;
}

function cmdStatus() {
  console.log(`LaunchAgent ${LABEL}: ${loaded() ? "loaded" : "not loaded"} (${fs.existsSync(PLIST) ? PLIST : "no plist"})`);
  if (fs.existsSync(LOG)) {
    const lines = fs.readFileSync(LOG, "utf8").trimEnd().split("\n");
    console.log(lines.slice(-15).join("\n"));
  }
  return 0;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith("--")) throw new Error(`unexpected argument: ${rest[i]}`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  switch (cmd) {
    case "run":
      return cmdRun(opts);
    case "watch":
      return cmdWatch();
    case "install":
      return cmdInstall();
    case "uninstall":
      return cmdUninstall();
    case "status":
      return cmdStatus();
    case "test":
      return spawnSync(NODE, ["--test", path.join(ROOT, "scripts/patch-watch/")], { stdio: "inherit" }).status;
    default:
      console.error("usage: patch-watch.mjs run|watch|install|uninstall|status|test");
      return 64;
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    try {
      log(`fatal: ${err && err.stack ? err.stack : String(err)}`);
    } catch {}
    process.exit(1);
  },
);
