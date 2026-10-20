import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAssistantDelta } from "../payload/assistant-delta.js";
import { localizeCompletionOpts, localizeGlassesText } from "../payload/error-strings.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isMethodUnsupported,
  markMethodUnsupported,
  noteGatewayHello,
  resetMethodSupportForTests,
} from "../payload/method-support.js";

function withStateDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocuclaw-g2-state-"));
  const prev = process.env.OCUCLAW_G2_STATE_DIR;
  process.env.OCUCLAW_G2_STATE_DIR = dir;
  resetMethodSupportForTests();
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.OCUCLAW_G2_STATE_DIR;
    else process.env.OCUCLAW_G2_STATE_DIR = prev;
    resetMethodSupportForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("delta-only assistant frames are accumulated into text", () => {
  const client = { _runTextBuffer: "", _runItemId: null };
  const first = normalizeAssistantDelta(client, { itemId: "i1", text: "안녕", delta: "안녕" });
  assert.equal(first.text, "안녕");
  client._runTextBuffer = first.text;
  client._runItemId = "i1";
  const second = normalizeAssistantDelta(client, { itemId: "i1", delta: "하세요" });
  assert.equal(second.text, "안녕하세요");
  assert.equal(second.delta, "하세요");
});

test("delta-only frame for a new item starts a new text", () => {
  const client = { _runTextBuffer: "이전 메시지", _runItemId: "i1" };
  const out = normalizeAssistantDelta(client, { itemId: "i2", delta: "새" });
  assert.equal(out.text, "새");
});

test("frames with text or without delta are untouched", () => {
  const client = { _runTextBuffer: "x", _runItemId: "i1" };
  const withText = { itemId: "i1", text: "전체", delta: "체" };
  assert.equal(normalizeAssistantDelta(client, withText), withText);
  const noDelta = { phase: "x" };
  assert.equal(normalizeAssistantDelta(client, noDelta), noDelta);
  assert.equal(normalizeAssistantDelta(client, null), null);
});

test("glasses-facing English errors become Korean", () => {
  assert.equal(
    localizeGlassesText("Even AI request timed out. Please try again."),
    "시간이 너무 걸렸어. 다시 물어봐 줘.",
  );
  assert.equal(
    localizeGlassesText("Even AI request failed upstream. Please try again."),
    "답을 만들다 문제가 생겼어. 다시 물어봐 줘.",
  );
  assert.equal(
    localizeGlassesText("Even AI is unavailable because OpenClaw is disconnected."),
    "지금 리체랑 연결이 끊겼어. 잠시 뒤에 다시 해 줘.",
  );
  assert.equal(localizeGlassesText("Authentication failed."), "Authentication failed.");
  assert.equal(localizeGlassesText("보통 답"), "보통 답");
});

test("localizeCompletionOpts rewrites only the content field", () => {
  const opts = { id: "x", content: "Even AI request timed out. Please try again." };
  const out = localizeCompletionOpts(opts);
  assert.deepEqual(out, { id: "x", content: "시간이 너무 걸렸어. 다시 물어봐 줘." });
  const same = { id: "y", content: "Authentication failed." };
  assert.equal(localizeCompletionOpts(same), same);
  assert.equal(localizeCompletionOpts(undefined), undefined);
});

test("unsupported methods are remembered process-wide", () => {
  withStateDir(() => {
    assert.equal(isMethodUnsupported("sessions.compaction.list"), false);
    markMethodUnsupported("sessions.compaction.list");
    assert.equal(isMethodUnsupported("sessions.compaction.list"), true);
  });
});

test("advertised hello method list decides support before any call", () => {
  withStateDir(() => {
    noteGatewayHello({ server: { version: "2026.10.5" }, features: { methods: ["chat.history", "sessions.describe"] } });
    assert.equal(isMethodUnsupported("sessions.compaction.list"), true);
    assert.equal(isMethodUnsupported("chat.history"), false);
    noteGatewayHello({ server: { version: "2026.11.0" }, features: { methods: ["sessions.compaction.list"] } });
    assert.equal(isMethodUnsupported("sessions.compaction.list"), false);
  });
});

test("without a method list, unsupported results persist per host version", () => {
  withStateDir((dir) => {
    noteGatewayHello({ server: { version: "2026.10.5" } });
    markMethodUnsupported("sessions.compaction.list");
    const file = path.join(dir, "unsupported-gateway-methods.json");
    assert.ok(fs.existsSync(file));
    // simulate a gateway restart: fresh process state, same version
    resetMethodSupportForTests();
    assert.equal(isMethodUnsupported("sessions.compaction.list"), false, "unknown before hello");
    noteGatewayHello({ server: { version: "2026.10.5" } });
    assert.equal(isMethodUnsupported("sessions.compaction.list"), true);
    // a new host version retries
    resetMethodSupportForTests();
    noteGatewayHello({ server: { version: "2026.11.0" } });
    assert.equal(isMethodUnsupported("sessions.compaction.list"), false);
  });
});

test("noteGatewayHello tolerates junk", () => {
  withStateDir(() => {
    noteGatewayHello(null);
    noteGatewayHello({ features: { methods: "nope" } });
    assert.equal(isMethodUnsupported("x"), false);
  });
});
