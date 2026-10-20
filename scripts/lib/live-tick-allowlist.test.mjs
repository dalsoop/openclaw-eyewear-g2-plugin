// Unit tests for the pure helpers behind apply/check-live-tick-allowlist.
// Run: node --test scripts/lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LLAMA_CPP_PLUGIN_ID,
  GLASSES_UI_LIVE,
  computeAllowlist,
  enabledIdsFromPluginsJson,
  allIdsFromPluginsJson,
  glassesUiLiveSetOps,
  compareEnabledToAllowlist,
  logSinceLastStart,
  findNoTickBackendWarning,
  findTickSuccess,
} from "./live-tick-allowlist.mjs";

test("llama.cpp plugin id matches the published manifest", () => {
  assert.equal(LLAMA_CPP_PLUGIN_ID, "llama-cpp");
});

test("computeAllowlist drops browser, adds ocuclaw and llama-cpp, sorts and dedupes", () => {
  const out = computeAllowlist(["xai", "browser", "anthropic", "ocuclaw", "anthropic"]);
  assert.deepEqual(out, ["anthropic", "llama-cpp", "ocuclaw", "xai"]);
});

test("computeAllowlist is idempotent on its own output", () => {
  const once = computeAllowlist(["browser", "memory-core", "openai"]);
  const enabledAfter = once.filter((id) => id !== "llama-cpp"); // not installed
  assert.deepEqual(computeAllowlist(enabledAfter), once);
});

test("computeAllowlist rejects empty input so we never lock out every plugin", () => {
  assert.throws(() => computeAllowlist([]), /empty/);
  assert.throws(() => computeAllowlist(["browser"]), /empty/);
});

test("enabledIdsFromPluginsJson tolerates a banner and skips disabled entries", () => {
  const text =
    "OpenClaw 2026.10.5 banner\n" +
    JSON.stringify({ plugins: [
      { id: "a", enabled: true },
      { id: "b", enabled: false },
      { id: "c", enabled: true },
    ] });
  assert.deepEqual(enabledIdsFromPluginsJson(text), ["a", "c"]);
  assert.deepEqual(allIdsFromPluginsJson(text), ["a", "b", "c"]);
});

test("enabledIdsFromPluginsJson throws on unparsable output", () => {
  assert.throws(() => enabledIdsFromPluginsJson("nope"), /plugins list/);
});

test("glassesUiLiveSetOps targets only the three tick keys", () => {
  assert.deepEqual(glassesUiLiveSetOps(), [
    { path: "plugins.entries.ocuclaw.config.glassesUiLive.tickBackend", value: "openai-compat" },
    { path: "plugins.entries.ocuclaw.config.glassesUiLive.tickApiBaseUrl", value: "http://127.0.0.1:10100" },
    { path: "plugins.entries.ocuclaw.config.glassesUiLive.tickModel", value: "opencodex/anthropic/claude-opus-5-5" },
  ]);
  assert.equal(GLASSES_UI_LIVE.tickApiBaseUrl.endsWith("/v1"), false);
});

test("compareEnabledToAllowlist ignores known not-installed ids", () => {
  const r = compareEnabledToAllowlist(["a", "b"], ["a", "b", "llama-cpp"], ["llama-cpp"]);
  assert.deepEqual(r, { ok: true, missing: [], extra: [], notInstalled: ["llama-cpp"] });
  const bad = compareEnabledToAllowlist(["a", "browser"], ["a", "b"], []);
  assert.deepEqual(bad, { ok: false, missing: ["b"], extra: ["browser"], notInstalled: [] });
});

test("logSinceLastStart keeps only the newest gateway run", () => {
  const log = [
    "t1 [gateway] http server listening (3 plugins)",
    "t2 [ocuclaw] glassesUiLive llm disabled: no tick backend for provider \"opencodex\"",
    "t3 [gateway] http server listening (3 plugins)",
    "t4 [gateway] ready",
  ].join("\n");
  const seg = logSinceLastStart(log);
  assert.match(seg, /^t3 /);
  assert.equal(findNoTickBackendWarning(seg), null);
  assert.match(findNoTickBackendWarning(log), /no tick backend/);
  assert.equal(logSinceLastStart("no start marker"), null);
});

test("findTickSuccess matches a 200 for the stripped model after a timestamp", () => {
  const lines = [
    { timestamp: 100, requestedModel: "anthropic/claude-opus-5-5", status: 200 },
    { timestamp: 300, requestedModel: "anthropic/claude-opus-5-5", status: 500 },
    { timestamp: 400, requestedModel: "anthropic/claude-opus-5-5", status: 200, requestId: "r4" },
    { timestamp: 500, requestedModel: "claude-opus-5-5", status: 200 },
  ].map((o) => JSON.stringify(o)).join("\n") + "\nnot json\n";
  assert.equal(findTickSuccess(lines, { sinceMs: 200 }).requestId, "r4");
  assert.equal(findTickSuccess(lines, { sinceMs: 450 }), null);
});
