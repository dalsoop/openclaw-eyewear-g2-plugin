// API key lookup for glassesUiLive llm ticks.
// OcuClaw passes the tick model as a raw string ("provider/model") to
// api.runtime.modelAuth.getApiKeyForModel, but OpenClaw expects a model
// object ({ provider, id }) and returns { apiKey, source, mode }. The raw
// string makes the lookup throw, so every tick failed with
// "openai-compat: missing api key". This adapter fixes both sides.

export function parseTickModelRef(modelRef) {
  if (typeof modelRef !== "string") return null;
  const idx = modelRef.indexOf("/");
  if (idx <= 0 || idx === modelRef.length - 1) return null;
  return { provider: modelRef.slice(0, idx), id: modelRef.slice(idx + 1) };
}

export async function resolveTickApiKey(modelAuth, modelRef, cfg) {
  const model = parseTickModelRef(modelRef);
  if (!model || !modelAuth || typeof modelAuth.getApiKeyForModel !== "function") return "";
  try {
    const res = await modelAuth.getApiKeyForModel({ model, cfg });
    if (typeof res === "string") return res;
    return res && typeof res.apiKey === "string" ? res.apiKey : "";
  } catch {
    return "";
  }
}
