import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEvenAiReply,
  fetchFinalReplyText,
  NO_REPLY_NOTICE,
} from "../payload/final-reply.js";
import { formatGlassesReply } from "../payload/reply-format.js";

const RUN = "run-1";

function historyWith(messages) {
  return { sessionKey: "main", messages };
}

function assistant(runId, text, extra = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    __openclaw: { runId },
    ...extra,
  };
}

function bridge(handler) {
  const calls = [];
  return {
    calls,
    request(method, params) {
      calls.push({ method, params });
      return handler(method, params, calls.length);
    },
  };
}

const quietLogger = { info() {}, warn() {}, debug() {}, error() {} };

test("notice text is the Korean one from the spec", () => {
  assert.equal(NO_REPLY_NOTICE, "답을 못 가져왔어. 다시 물어봐 줘.");
});

test("uses the final transcript reply of the run, not the stream text", async () => {
  const b = bridge(async () =>
    historyWith([
      { role: "user", content: "질문" },
      assistant("other-run", "다른 답"),
      assistant(RUN, "중간 답", { stopReason: "toolUse" }),
      assistant(RUN, "## 최종\n**완전한** 답입니다."),
    ]),
  );
  const out = await resolveEvenAiReply({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    streamText: "안녕",
    logger: quietLogger,
  });
  assert.equal(out, "최종\n완전한 답입니다.");
  assert.equal(b.calls[0].method, "chat.history");
  assert.equal(b.calls[0].params.sessionKey, "main");
});

test("polls until the run's reply shows up in history", async () => {
  const b = bridge(async (_m, _p, n) =>
    n < 3 ? historyWith([]) : historyWith([assistant(RUN, "늦게 온 답")]),
  );
  const text = await fetchFinalReplyText({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    timeoutMs: 2000,
    pollMs: 5,
  });
  assert.equal(text, "늦게 온 답");
  assert.equal(b.calls.length, 3);
});

test("history error falls back to the accumulated stream text", async () => {
  const b = bridge(async () => {
    throw new Error("boom");
  });
  const stream = "스트림으로 받은 **전체** 글";
  const out = await resolveEvenAiReply({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    streamText: stream,
    logger: quietLogger,
  });
  assert.equal(out, formatGlassesReply(stream));
  assert.equal(out, "스트림으로 받은 전체 글");
});

test("history lookup that does not finish in time falls back to stream text", async () => {
  const b = bridge(() => new Promise(() => {}));
  const started = Date.now();
  const out = await resolveEvenAiReply({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    streamText: "느린 조회 대신 스트림",
    historyTimeoutMs: 50,
    logger: quietLogger,
  });
  assert.equal(out, "느린 조회 대신 스트림");
  assert.ok(Date.now() - started < 1000);
});

test("empty transcript reply falls back to the stream text", async () => {
  const b = bridge(async () => historyWith([assistant(RUN, "   ")]));
  const out = await resolveEvenAiReply({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    streamText: "스트림 답",
    historyTimeoutMs: 40,
    pollMs: 5,
    logger: quietLogger,
  });
  assert.equal(out, "스트림 답");
});

test("transcript reply that is empty after cleanup (emoji only) falls back to stream", async () => {
  const b = bridge(async () => historyWith([assistant(RUN, "😀🎉")]));
  const out = await resolveEvenAiReply({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    streamText: "",
    historyTimeoutMs: 40,
    pollMs: 5,
    logger: quietLogger,
  });
  assert.equal(out, NO_REPLY_NOTICE);
});

test("failure with empty stream text sends the Korean notice", async () => {
  const b = bridge(async () => {
    throw new Error("boom");
  });
  const out = await resolveEvenAiReply({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    streamText: "",
    logger: quietLogger,
  });
  assert.equal(out, NO_REPLY_NOTICE);
});

test("missing bridge or runId falls back to stream text", async () => {
  const out = await resolveEvenAiReply({
    gatewayBridge: null,
    runId: "",
    sessionKey: "main",
    streamText: "그냥 스트림",
    logger: quietLogger,
  });
  assert.equal(out, "그냥 스트림");
});

test("stream fallback also gets the length policy", async () => {
  const b = bridge(async () => {
    throw new Error("boom");
  });
  const stream = "가".repeat(500);
  const out = await resolveEvenAiReply({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    streamText: stream,
    logger: quietLogger,
  });
  assert.equal(out, "가".repeat(349) + "…");
});

test("forced-failure switch (test only) skips the transcript", async () => {
  const b = bridge(async () => historyWith([assistant(RUN, "트랜스크립트 답")]));
  const prev = process.env.OCUCLAW_G2_FORCE_HISTORY_FAILURE;
  process.env.OCUCLAW_G2_FORCE_HISTORY_FAILURE = "1";
  try {
    const out = await resolveEvenAiReply({
      gatewayBridge: b,
      runId: RUN,
      sessionKey: "main",
      streamText: "강제 실패 시 스트림",
      logger: quietLogger,
    });
    assert.equal(out, "강제 실패 시 스트림");
    assert.equal(b.calls.length, 0);
  } finally {
    if (prev === undefined) delete process.env.OCUCLAW_G2_FORCE_HISTORY_FAILURE;
    else process.env.OCUCLAW_G2_FORCE_HISTORY_FAILURE = prev;
  }
});

test("string content is accepted", async () => {
  const b = bridge(async () =>
    historyWith([{ role: "assistant", content: "문자열 답", __openclaw: { runId: RUN } }]),
  );
  const text = await fetchFinalReplyText({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    timeoutMs: 200,
  });
  assert.equal(text, "문자열 답");
});

test("tool-use only reply is accepted once the deadline passes", async () => {
  const b = bridge(async () =>
    historyWith([assistant(RUN, "도구 호출 전 말", { stopReason: "toolUse" })]),
  );
  const text = await fetchFinalReplyText({
    gatewayBridge: b,
    runId: RUN,
    sessionKey: "main",
    timeoutMs: 60,
    pollMs: 5,
  });
  assert.equal(text, "도구 호출 전 말");
});
