#!/usr/bin/env node
// Re-runnable verification for glassesUiLive ticks and the plugins.allow list.
//   allowlist: enabled plugins == plugins.allow (ids not installed are reported)
//   tick:      no "no tick backend" warning since the last gateway start, and
//              one real llm tick through the plugin's own recipe code returns
//              text and shows up as HTTP 200 in ~/.opencodex/usage.jsonl.
// Never prints secrets. Exit 0 only if every check passes.
//
// Usage: node scripts/check-live-tick-allowlist.mjs [--skip-tick]
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  GLASSES_UI_LIVE,
  compareEnabledToAllowlist,
  allIdsFromPluginsJson,
  enabledIdsFromPluginsJson,
  findNoTickBackendWarning,
  findTickSuccess,
  logSinceLastStart,
} from "./lib/live-tick-allowlist.mjs";

const HOME = process.env.HOME;
const OPENCLAW = process.env.OPENCLAW || `${HOME}/.local/bin/openclaw`;
const OC_HOME = process.env.OPENCLAW_HOME || `${HOME}/.openclaw`;
const PLUGIN_DIR = path.join(OC_HOME, "extensions/ocuclaw");
const OPENCLAW_PKG = `${HOME}/.local/share/openclaw-node/lib/node_modules/openclaw`;
const GATEWAY_LOG = `${HOME}/Library/Logs/openclaw/gateway.log`;
const USAGE_LOG = `${HOME}/.opencodex/usage.jsonl`;
const skipTick = process.argv.includes("--skip-tick");

let failed = 0;
function report(name, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}
function oc(argv) {
  try {
    return execFileSync(OPENCLAW, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return String(err.stdout || "");
  }
}

// 1. Gateway is up.
report("gateway connectivity", /Connectivity check: ok/.test(oc(["gateway", "status"])));

// 2. Authored config (read locally; only non-secret keys are printed).
const cfg = JSON.parse(fs.readFileSync(path.join(OC_HOME, "openclaw.json"), "utf8"));
const liveRaw = cfg?.plugins?.entries?.ocuclaw?.config?.glassesUiLive || {};
const cfgOk = Object.entries(GLASSES_UI_LIVE).every(([k, v]) => liveRaw[k] === v);
report(
  "glassesUiLive config",
  cfgOk,
  Object.keys(GLASSES_UI_LIVE).map((k) => `${k}=${liveRaw[k]}`).join(" "),
);

// 3. Allowlist equals the enabled plugin list.
const allow = Array.isArray(cfg?.plugins?.allow) ? cfg.plugins.allow : null;
if (!allow) {
  report("plugins.allow set", false, "plugins.allow is not an array");
} else {
  const enabled = enabledIdsFromPluginsJson(oc(["plugins", "list", "--enabled", "--json"]));
  const known = new Set(allIdsFromPluginsJson(oc(["plugins", "list", "--json"])));
  const notInstalled = allow.filter((id) => !known.has(id));
  const r = compareEnabledToAllowlist(enabled, allow, notInstalled);
  report(
    "enabled == plugins.allow",
    r.ok && !allow.includes("browser") && allow.includes("ocuclaw"),
    `enabled=${enabled.length} allow=${allow.length} missing=[${r.missing}] extra=[${r.extra}] notInstalled=[${r.notInstalled}]`,
  );
}

// 4. No "no tick backend" warning since the last gateway start.
const seg = logSinceLastStart(fs.readFileSync(GATEWAY_LOG, "utf8"));
if (seg === null) {
  report("gateway log segment", false, "no gateway start marker found");
} else {
  const startLine = seg.split("\n")[0].slice(0, 29);
  const warn = findNoTickBackendWarning(seg);
  report("no 'no tick backend' warning since last start", !warn, warn ? warn.slice(0, 160) : `since ${startLine}`);
}

// 5. One real tick through the plugin's code path.
if (!skipTick) {
  const imp = (p) => import(pathToFileURL(p).href);
  const { resolveGlassesUiLive } = await imp(path.join(PLUGIN_DIR, "dist/config/runtime-config.js"));
  const { executeLlmRecipe } = await imp(path.join(PLUGIN_DIR, "dist/tools/glasses-ui-recipes.js"));
  const { resolveTickApiKey } = await imp(path.join(PLUGIN_DIR, "dist/ocuclaw-g2/index.js"));
  const modelAuth = await imp(path.join(OPENCLAW_PKG, "dist/runtime-model-auth.runtime.js"));

  const warnings = [];
  const live = resolveGlassesUiLive(liveRaw, cfg, { warn: (m) => warnings.push(m) });
  report(
    "plugin resolves tick backend",
    warnings.length === 0 && live.tickBackend === GLASSES_UI_LIVE.tickBackend,
    `backend=${live.tickBackend} model=${live.tickModel} base=${live.tickApiBaseUrl}${warnings.length ? ` warn=${warnings[0]}` : ""}`,
  );
  // Same lookup the gateway does (patched glasses-ui-tick-api-key hook).
  const apiKey = await resolveTickApiKey(modelAuth, live.tickModel, cfg);
  report("tick api key resolves", apiKey !== "", apiKey ? `length ${apiKey.length}` : "empty");

  const sinceMs = Date.now() - 1000;
  // Mirrors resolveLlmCtx in glasses-ui-tool.js.
  const res = await executeLlmRecipe(
    { kind: "llm", prompt: "Reply with the single word OK." },
    {
      backend: live.tickBackend,
      model: live.tickModel,
      baseUrl: live.tickApiBaseUrl,
      apiKey,
      maxOutputTokens: live.tickMaxOutputTokens || 200,
      previousBody: "",
    },
  );
  report(
    "tick call returns text",
    !res.error && typeof res.output === "string" && res.output.trim() !== "",
    res.error ? res.error : `output=${JSON.stringify(res.output.trim().slice(0, 40))}`,
  );

  let hit = null;
  for (let i = 0; i < 20 && !hit; i += 1) {
    hit = findTickSuccess(fs.existsSync(USAGE_LOG) ? fs.readFileSync(USAGE_LOG, "utf8") : "", { sinceMs });
    if (!hit) await new Promise((r) => setTimeout(r, 500));
  }
  report(
    "opencodex usage.jsonl has HTTP 200",
    !!hit,
    hit
      ? `requestId=${hit.requestId} requestedModel=${hit.requestedModel} status=${hit.status} inbound=${hit.inboundProtocol}`
      : "no matching record",
  );
}

console.log(failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
