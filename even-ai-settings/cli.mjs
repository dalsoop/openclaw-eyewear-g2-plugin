#!/usr/bin/env node
// Even AI (Hey Even) glasses settings for OcuClaw.
//   node even-ai-settings/cli.mjs apply   idempotent: stop gateway, write the in-app
//                                         store (other fields kept), set the two
//                                         config keys, start gateway
//   node even-ai-settings/cli.mjs check   exit 0 only if store and config both match
//   node even-ai-settings/cli.mjs verify  verification 9: two back-to-back Even AI
//                                         requests land in the one dedicated session
// Options: --prompt-file FILE --store FILE --config FILE --endpoint URL --transcript-db FILE
// Secrets (evenAiToken etc.) are never printed.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mergeEvenAiStore, configNeedsUpdate, validateSystemPrompt } from "./store.mjs";
import { replyStyleProblems, isDedicatedSessionKey } from "./reply-style.mjs";
import {
  askEvenAi,
  readToken,
  findRunReplyInTranscript,
  findSessionKeysWithUserText,
  DEFAULT_ENDPOINT_URL,
  DEFAULT_CONFIG_FILE,
  DEFAULT_TRANSCRIPT_DB,
} from "../ocuclaw-patch/verify-live.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ROUTING_MODE = "background";
const DEFAULT_DEDICATED_KEY = "ocuclaw:even-ai";
const OPENCLAW = process.env.OPENCLAW || path.join(os.homedir(), ".local/bin/openclaw");

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith("--")) throw new Error(`unexpected argument: ${rest[i]}`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  return {
    cmd,
    promptFile: opts["prompt-file"] || path.join(ROOT, "persona/even-ai-system-prompt.txt"),
    storeFile: opts.store || path.join(os.homedir(), ".openclaw/even-ai-settings.json"),
    configFile: opts.config || DEFAULT_CONFIG_FILE,
    endpoint: opts.endpoint || DEFAULT_ENDPOINT_URL,
    dbFile: opts["transcript-db"] || DEFAULT_TRANSCRIPT_DB,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJsonOrNull(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function ocuclawConfig(configFile) {
  const cfg = readJsonOrNull(configFile);
  return cfg?.plugins?.entries?.ocuclaw?.config || {};
}

function desiredSettings(promptFile) {
  return { routingMode: ROUTING_MODE, systemPrompt: validateSystemPrompt(fs.readFileSync(promptFile, "utf8")) };
}

function state(o) {
  const desired = desiredSettings(o.promptFile);
  const store = readJsonOrNull(o.storeFile);
  const storeChange = mergeEvenAiStore(store, desired, Date.now()).changed;
  const configChange = configNeedsUpdate(ocuclawConfig(o.configFile), desired);
  return { desired, store, storeChange, configChange };
}

function gatewayStatus() {
  const r = spawnSync(OPENCLAW, ["gateway", "status"], { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  return {
    running: /Runtime:\s*running/.test(out),
    ok: /Connectivity check: ok/.test(out),
  };
}

async function waitFor(pred, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function run(args, input) {
  // Output of these commands is not secret (stop/start/config patch of two
  // non-secret keys), but keep it short.
  const out = execFileSync(OPENCLAW, args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
  const lines = out.trim().split("\n").filter(Boolean);
  if (lines.length) console.log(`  ${args.join(" ")}: ${lines[lines.length - 1]}`);
}

function writeStoreAtomic(file, store) {
  const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode });
  fs.renameSync(tmp, file);
}

async function apply(o) {
  const s = state(o);
  if (!s.storeChange && !s.configChange) {
    console.log("apply: already applied (store and config match)");
    return 0;
  }
  console.log(`apply: store ${s.storeChange ? "needs update" : "ok"}, config ${s.configChange ? "needs update" : "ok"}`);
  console.log("apply: stopping gateway");
  run(["gateway", "stop", "--force"]);
  try {
    await waitFor(() => !gatewayStatus().running, "gateway to stop", 60_000);
    // Re-read after stop: the plugin may have persisted on shutdown.
    const fresh = readJsonOrNull(o.storeFile);
    const merged = mergeEvenAiStore(fresh, s.desired, Date.now());
    if (merged.changed) {
      writeStoreAtomic(o.storeFile, merged.store);
      console.log(`apply: wrote ${o.storeFile} (routingMode=${ROUTING_MODE}, systemPrompt ${Array.from(s.desired.systemPrompt).length} code points)`);
    }
    if (configNeedsUpdate(ocuclawConfig(o.configFile), s.desired)) {
      const patch = {
        plugins: { entries: { ocuclaw: { config: { evenAiRoutingMode: ROUTING_MODE, evenAiSystemPrompt: s.desired.systemPrompt } } } },
      };
      run(["config", "patch", "--stdin"], JSON.stringify(patch));
      console.log("apply: set plugins.entries.ocuclaw.config.evenAiRoutingMode / evenAiSystemPrompt");
    }
  } finally {
    console.log("apply: starting gateway");
    run(["gateway", "start"]);
    await waitFor(() => gatewayStatus().ok, "gateway 'Connectivity check: ok'", 180_000);
  }
  return check(o);
}

function check(o) {
  const s = state(o);
  const ok = !s.storeChange && !s.configChange;
  console.log(`check: store ${s.storeChange ? "MISMATCH" : "ok"}, config ${s.configChange ? "MISMATCH" : "ok"}`);
  return ok ? 0 : 3;
}

async function askAndLocate(o, token, text, nonce) {
  const since = Date.now() - 5000;
  const response = await askEvenAi(o.endpoint, token, text, 90_000);
  let found = null;
  const deadline = Date.now() + 30_000;
  while (!found && Date.now() < deadline) {
    found = findRunReplyInTranscript(o.dbFile, `확인용 ${nonce}`, since);
    if (!found) await sleep(500);
  }
  const keys = findSessionKeysWithUserText(o.dbFile, `확인용 ${nonce}`, since);
  return { response, found, keys };
}

async function verify(o) {
  const token = readToken(o.configFile);
  const dedicated = ocuclawConfig(o.configFile).evenAiDedicatedSessionKey || DEFAULT_DEDICATED_KEY;
  const fruits = ["망고스틴", "리치", "용과", "두리안", "패션프루트", "람부탄"];
  const fruit = fruits[randomBytes(1)[0] % fruits.length];
  const n1 = randomBytes(3).toString("hex");
  const n2 = randomBytes(3).toString("hex");
  const asks = [
    { label: "first", nonce: n1, text: `기억해 둬. 내가 요즘 제일 좋아하는 과일은 ${fruit}야. 알겠다고 한 문장으로만 답해. (확인용 ${n1})` },
    { label: "second", nonce: n2, text: `내가 방금 제일 좋아한다고 한 과일이 뭐였지? 한 문장으로 답해. (확인용 ${n2})` },
  ];
  let failures = 0;
  const sessionKeys = [];
  const results = [];
  for (const a of asks) {
    let r;
    try {
      r = await askAndLocate(o, token, a.text, a.nonce);
    } catch (err) {
      console.log(`verify [${a.label}] FAIL request: ${err.message}`);
      failures += 1;
      continue;
    }
    results.push(r);
    if (!r.found) {
      console.log(`verify [${a.label}] FAIL no transcript reply for nonce ${a.nonce}`);
      failures += 1;
      continue;
    }
    sessionKeys.push(r.found.sessionKey);
    const problems = [];
    if (!isDedicatedSessionKey(r.found.sessionKey, dedicated)) problems.push(`not in dedicated session (${r.found.sessionKey})`);
    if (r.keys.length !== 1) problems.push(`question found in ${r.keys.length} sessions: ${r.keys.join(", ")}`);
    const styleRaw = replyStyleProblems(r.found.text);
    const styleResp = replyStyleProblems(r.response);
    if (styleRaw.length) problems.push(`transcript reply style: ${styleRaw.join(",")}`);
    if (styleResp.length) problems.push(`glasses response style: ${styleResp.join(",")}`);
    if (a.label === "second" && !r.response.includes(fruit)) problems.push(`context not carried over (no "${fruit}")`);
    console.log(`verify [${a.label}] ${problems.length ? "FAIL" : "OK"} session=${r.found.sessionKey} chars=${Array.from(r.response).length} reply=${JSON.stringify(r.response)}`);
    for (const p of problems) console.log(`  ${p}`);
    if (problems.length) failures += 1;
  }
  if (sessionKeys.length === 2 && sessionKeys[0] !== sessionKeys[1]) {
    console.log(`verify FAIL: requests landed in different sessions (${sessionKeys.join(" vs ")})`);
    failures += 1;
  }
  console.log(failures === 0 ? `verify: PASS (dedicated session ${sessionKeys[0]})` : `verify: FAIL (${failures})`);
  return failures === 0 ? 0 : 4;
}

const o = parseArgs(process.argv.slice(2));
const handlers = { apply, check, verify };
if (!handlers[o.cmd]) {
  console.error("usage: cli.mjs apply|check|verify [--prompt-file F] [--store F] [--config F] [--endpoint URL] [--transcript-db F]");
  process.exit(64);
}
process.exit(await handlers[o.cmd](o));
