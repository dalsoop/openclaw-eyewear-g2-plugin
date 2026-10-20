#!/usr/bin/env node
// Idempotently turn on OcuClaw glassesUiLive ticks via opencodex and set the
// exclusive plugins.allow list (live enabled plugins - browser + ocuclaw +
// llama-cpp). Back up first with scripts/backup.sh.
//
// Usage: node scripts/apply-live-tick-allowlist.mjs [--dry-run] [--restart]
import { execFileSync } from "node:child_process";
import {
  computeAllowlist,
  enabledIdsFromPluginsJson,
  glassesUiLiveSetOps,
} from "./lib/live-tick-allowlist.mjs";

const OPENCLAW = process.env.OPENCLAW || `${process.env.HOME}/.local/bin/openclaw`;
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const restart = args.has("--restart");

function oc(argv, opts = {}) {
  return execFileSync(OPENCLAW, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

const enabled = enabledIdsFromPluginsJson(oc(["plugins", "list", "--enabled", "--json"]));
const allow = computeAllowlist(enabled);
console.log(`enabled plugins: ${enabled.length}; allowlist: ${allow.length}`);
console.log(`plugins.allow = ${allow.join(",")}`);

const ops = [{ path: "plugins.allow", value: allow }, ...glassesUiLiveSetOps()];
const setArgs = ["config", "set", "--batch-json", JSON.stringify(ops)];
if (dryRun) setArgs.push("--dry-run");
process.stdout.write(oc(setArgs));

if (restart && !dryRun) {
  process.stdout.write(oc(["gateway", "restart"]));
  const deadline = Date.now() + 120_000;
  for (;;) {
    let status = "";
    try {
      status = oc(["gateway", "status"]);
    } catch (err) {
      status = String(err.stdout || "");
    }
    if (/Connectivity check: ok/.test(status)) {
      console.log("gateway: Connectivity check: ok");
      break;
    }
    if (Date.now() > deadline) {
      console.error("gateway did not report Connectivity check: ok within 120s");
      process.exit(1);
    }
    execFileSync("/bin/sleep", ["2"]);
  }
}
