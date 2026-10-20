// Pure helpers for turning on OcuClaw glassesUiLive ticks via opencodex and
// for computing the exclusive `plugins.allow` list. No I/O here so the
// logic can be unit tested with `node --test scripts/lib/`.

// Manifest id of @openclaw/llama-cpp-provider (openclaw.plugin.json "id").
export const LLAMA_CPP_PLUGIN_ID = "llama-cpp";

// Plugins dropped from / forced into the allowlist.
export const ALLOWLIST_EXCLUDE = Object.freeze(["browser"]);
export const ALLOWLIST_INCLUDE = Object.freeze(["ocuclaw", LLAMA_CPP_PLUGIN_ID]);

// The plugin appends /v1 itself and strips the provider prefix before the
// first "/", so opencodex receives "anthropic/claude-opus-5-5".
export const GLASSES_UI_LIVE = Object.freeze({
  tickBackend: "openai-compat",
  tickApiBaseUrl: "http://127.0.0.1:10100",
  tickModel: "opencodex/anthropic/claude-opus-5-5",
});
export const GLASSES_UI_LIVE_PATH = "plugins.entries.ocuclaw.config.glassesUiLive";

export function computeAllowlist(enabledIds, opts = {}) {
  const exclude = new Set(opts.exclude || ALLOWLIST_EXCLUDE);
  const include = opts.include || ALLOWLIST_INCLUDE;
  const kept = enabledIds.filter((id) => typeof id === "string" && id && !exclude.has(id));
  if (kept.length === 0) {
    throw new Error("refusing to build allowlist from an empty enabled-plugin list");
  }
  return [...new Set([...kept, ...include])].sort();
}

export function enabledIdsFromPluginsJson(text) {
  return pluginsFromListJson(text).filter((p) => p && p.enabled !== false).map((p) => p.id);
}

// Every discovered plugin id (enabled or not).
export function allIdsFromPluginsJson(text) {
  return pluginsFromListJson(text).map((p) => p && p.id).filter(Boolean);
}

function pluginsFromListJson(text) {
  const start = typeof text === "string" ? text.indexOf("{") : -1;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch {
    throw new Error("could not parse `openclaw plugins list --json` output");
  }
  if (start < 0 || !parsed || !Array.isArray(parsed.plugins)) {
    throw new Error("could not parse `openclaw plugins list --json` output");
  }
  return parsed.plugins;
}

export function glassesUiLiveSetOps() {
  return Object.entries(GLASSES_UI_LIVE).map(([key, value]) => ({
    path: `${GLASSES_UI_LIVE_PATH}.${key}`,
    value,
  }));
}

export function compareEnabledToAllowlist(enabledIds, allowIds, notInstalledIds = []) {
  const enabled = new Set(enabledIds);
  const allow = new Set(allowIds);
  const notInstalled = new Set(notInstalledIds);
  const missing = [...allow].filter((id) => !enabled.has(id) && !notInstalled.has(id)).sort();
  const extra = [...enabled].filter((id) => !allow.has(id)).sort();
  return {
    ok: missing.length === 0 && extra.length === 0,
    missing,
    extra,
    notInstalled: [...allow].filter((id) => notInstalled.has(id) && !enabled.has(id)).sort(),
  };
}

const START_MARKER = "[gateway] http server listening";

// Text of the newest gateway run in gateway.log, or null if none is found.
export function logSinceLastStart(logText) {
  const idx = logText.lastIndexOf(START_MARKER);
  if (idx < 0) return null;
  const lineStart = logText.lastIndexOf("\n", idx) + 1;
  return logText.slice(lineStart);
}

export function findNoTickBackendWarning(text) {
  const line = (text || "").split("\n").find((l) => l.includes("glassesUiLive llm disabled: no tick backend"));
  return line || null;
}

// First opencodex usage record after sinceMs for the stripped tick model with HTTP 200.
export function findTickSuccess(usageText, { sinceMs, requestedModel } = {}) {
  const want = requestedModel || GLASSES_UI_LIVE.tickModel.slice(GLASSES_UI_LIVE.tickModel.indexOf("/") + 1);
  for (const line of (usageText || "").split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.timestamp >= sinceMs && rec.requestedModel === want && rec.status === 200) return rec;
  }
  return null;
}
