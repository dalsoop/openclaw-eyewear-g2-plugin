import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeEvenAiStore,
  validateSystemPrompt,
  configNeedsUpdate,
  MAX_PROMPT_CODE_POINTS,
} from "../store.mjs";

const desired = { routingMode: "background", systemPrompt: "짧게 반말로 답해." };

test("seeds a fresh store when none exists", () => {
  const { changed, store } = mergeEvenAiStore(null, desired, 1000);
  assert.equal(changed, true);
  assert.equal(store.version, 1);
  assert.equal(store.updatedAtMs, 1000);
  assert.equal(store.settings.routingMode, "background");
  assert.equal(store.settings.systemPrompt, "짧게 반말로 답해.");
});

test("preserves every other settings field and unknown top-level fields", () => {
  const existing = {
    version: 1,
    updatedAtMs: 5,
    extraTop: { keep: true },
    settings: {
      routingMode: "active",
      systemPrompt: "",
      defaultModel: "anthropic/x",
      defaultThinking: "high",
      listenEnabled: true,
      defaultFastMode: true,
      defaultAgent: "main",
      trackedThrowawayKeys: ["ocuclaw:even-ai:1"],
      futureField: 42,
    },
  };
  const before = JSON.parse(JSON.stringify(existing));
  const { changed, store } = mergeEvenAiStore(existing, desired, 2000);
  assert.equal(changed, true);
  assert.deepEqual(existing, before, "input must not be mutated");
  assert.deepEqual(store.extraTop, { keep: true });
  assert.equal(store.updatedAtMs, 2000);
  assert.deepEqual(store.settings, {
    ...before.settings,
    routingMode: "background",
    systemPrompt: "짧게 반말로 답해.",
  });
});

test("is idempotent: second merge reports no change and keeps updatedAtMs", () => {
  const first = mergeEvenAiStore(null, desired, 1000).store;
  const second = mergeEvenAiStore(first, desired, 9999);
  assert.equal(second.changed, false);
  assert.deepEqual(second.store, first);
});

test("prompt comparison uses trimmed value like the plugin", () => {
  const first = mergeEvenAiStore(null, { ...desired, systemPrompt: "  짧게 반말로 답해.\n" }, 1).store;
  assert.equal(first.settings.systemPrompt, "짧게 반말로 답해.");
  assert.equal(mergeEvenAiStore(first, desired, 2).changed, false);
});

test("rejects an unexpected store version instead of overwriting it", () => {
  assert.throws(() => mergeEvenAiStore({ version: 2, settings: {} }, desired, 1), /version/);
});

test("validateSystemPrompt trims and enforces the 4000 code point limit", () => {
  assert.equal(validateSystemPrompt("  hi \n"), "hi");
  assert.equal(MAX_PROMPT_CODE_POINTS, 4000);
  assert.equal(validateSystemPrompt("가".repeat(4000)).length, 4000);
  assert.throws(() => validateSystemPrompt("가".repeat(4001)), /4000/);
  assert.throws(() => validateSystemPrompt("   "), /empty/);
});

test("configNeedsUpdate compares routing mode and trimmed prompt", () => {
  assert.equal(configNeedsUpdate({}, desired), true);
  assert.equal(
    configNeedsUpdate({ evenAiRoutingMode: "background", evenAiSystemPrompt: "짧게 반말로 답해." }, desired),
    false,
  );
  assert.equal(
    configNeedsUpdate({ evenAiRoutingMode: "active", evenAiSystemPrompt: "짧게 반말로 답해." }, desired),
    true,
  );
});
