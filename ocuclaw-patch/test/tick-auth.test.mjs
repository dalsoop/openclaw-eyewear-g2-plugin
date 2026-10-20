import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTickModelRef, resolveTickApiKey } from "../payload/tick-auth.js";

test("parseTickModelRef splits provider at the first slash", () => {
  assert.deepEqual(parseTickModelRef("opencodex/anthropic/claude-opus-5-5"), {
    provider: "opencodex",
    id: "anthropic/claude-opus-5-5",
  });
  assert.equal(parseTickModelRef("gpt-4o-mini"), null);
  assert.equal(parseTickModelRef(""), null);
  assert.equal(parseTickModelRef(undefined), null);
});

test("resolveTickApiKey passes a model object, not the raw string", async () => {
  let seen;
  const modelAuth = {
    async getApiKeyForModel(params) {
      seen = params;
      return { apiKey: "k-123", source: "config", mode: "api-key" };
    },
  };
  const cfg = { marker: true };
  const key = await resolveTickApiKey(modelAuth, "opencodex/anthropic/claude-opus-5-5", cfg);
  assert.equal(key, "k-123");
  assert.deepEqual(seen.model, { provider: "opencodex", id: "anthropic/claude-opus-5-5" });
  assert.equal(seen.cfg, cfg);
});

test("resolveTickApiKey accepts a plain string result", async () => {
  const modelAuth = { getApiKeyForModel: async () => "plain" };
  assert.equal(await resolveTickApiKey(modelAuth, "p/m", {}), "plain");
});

test("resolveTickApiKey returns empty string on errors and odd results", async () => {
  const throwing = { getApiKeyForModel: async () => { throw new Error("boom"); } };
  assert.equal(await resolveTickApiKey(throwing, "p/m", {}), "");
  assert.equal(await resolveTickApiKey({ getApiKeyForModel: async () => ({}) }, "p/m", {}), "");
  assert.equal(await resolveTickApiKey({}, "p/m", {}), "");
  assert.equal(await resolveTickApiKey(undefined, "p/m", {}), "");
  assert.equal(await resolveTickApiKey({ getApiKeyForModel: async () => "x" }, "noslash", {}), "");
});
