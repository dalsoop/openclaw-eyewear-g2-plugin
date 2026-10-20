// Pure helpers for the OcuClaw Even AI settings store
// (~/.openclaw/even-ai-settings.json, format {version, updatedAtMs, settings}).
// The in-app store takes precedence over plugin config once it exists, so the
// apply script writes the same routing mode and prompt into both places.

export const STORE_VERSION = 1;
export const MAX_PROMPT_CODE_POINTS = 4000;

// Mirrors the plugin's normalizeAndValidateCustomSystemPrompt (trim, <= 4000
// code points); an empty prompt is rejected because it would be a no-op.
export function validateSystemPrompt(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new Error("system prompt is empty");
  const n = Array.from(trimmed).length;
  if (n > MAX_PROMPT_CODE_POINTS) {
    throw new Error(`system prompt has ${n} code points; the limit is ${MAX_PROMPT_CODE_POINTS}`);
  }
  return trimmed;
}

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

// Returns {changed, store}. Keeps every other field (known or unknown) and only
// bumps updatedAtMs when routingMode or systemPrompt actually change.
export function mergeEvenAiStore(existing, desired, nowMs) {
  const routingMode = desired.routingMode;
  const systemPrompt = validateSystemPrompt(desired.systemPrompt);
  if (existing == null) {
    return {
      changed: true,
      store: { version: STORE_VERSION, updatedAtMs: nowMs, settings: { routingMode, systemPrompt } },
    };
  }
  if (typeof existing !== "object" || existing.version !== STORE_VERSION) {
    throw new Error(`unsupported Even AI settings store version: ${existing && existing.version}`);
  }
  const settings = existing.settings && typeof existing.settings === "object" ? existing.settings : {};
  const same = trimmed(settings.routingMode) === routingMode && trimmed(settings.systemPrompt) === systemPrompt;
  if (same) return { changed: false, store: existing };
  return {
    changed: true,
    store: {
      ...existing,
      updatedAtMs: nowMs,
      settings: { ...settings, routingMode, systemPrompt },
    },
  };
}

// pluginConfig = plugins.entries.ocuclaw.config from openclaw.json.
export function configNeedsUpdate(pluginConfig, desired) {
  const cfg = pluginConfig || {};
  return (
    trimmed(cfg.evenAiRoutingMode) !== desired.routingMode ||
    trimmed(cfg.evenAiSystemPrompt) !== trimmed(desired.systemPrompt)
  );
}
