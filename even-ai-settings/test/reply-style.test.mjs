import { test } from "node:test";
import assert from "node:assert/strict";
import { replyStyleProblems, isDedicatedSessionKey } from "../reply-style.mjs";

test("plain casual Korean reply passes", () => {
  assert.deepEqual(replyStyleProblems("하늘이 파란 건 햇빛 중 파란빛이 공기에 더 많이 흩어져서 그래."), []);
});

test("polite endings are flagged", () => {
  assert.ok(replyStyleProblems("파란빛이 더 많이 흩어지기 때문이에요.").includes("polite"));
  assert.ok(replyStyleProblems("그렇습니다. 맞습니다.").includes("polite"));
});

test("markdown, list markers, tables and emoji are flagged", () => {
  assert.ok(replyStyleProblems("**굵게** 써 봤어").includes("markdown"));
  assert.ok(replyStyleProblems("목록이야\n- 하나\n- 둘").includes("list"));
  assert.ok(replyStyleProblems("1. 첫째\n2. 둘째").includes("list"));
  assert.ok(replyStyleProblems("| a | b |\n|---|---|").includes("table"));
  assert.ok(replyStyleProblems("좋아 😀").includes("emoji"));
  assert.ok(replyStyleProblems("# 제목").includes("markdown"));
});

test("over 350 code points is flagged", () => {
  assert.ok(replyStyleProblems("가".repeat(351)).includes("length"));
  assert.deepEqual(replyStyleProblems("가".repeat(349) + "야"), []);
});

test("follow-up questions at the end are flagged", () => {
  assert.ok(replyStyleProblems("그건 이래. 더 궁금한 거 있어?").includes("follow-up"));
});

test("dedicated session key matching", () => {
  assert.equal(isDedicatedSessionKey("agent:main:ocuclaw:even-ai", "ocuclaw:even-ai"), true);
  assert.equal(isDedicatedSessionKey("ocuclaw:even-ai", "ocuclaw:even-ai"), true);
  assert.equal(isDedicatedSessionKey("agent:main:main", "ocuclaw:even-ai"), false);
  assert.equal(isDedicatedSessionKey("agent:main:ocuclaw:even-ai:123", "ocuclaw:even-ai"), false);
  assert.equal(isDedicatedSessionKey("agent:main:ocuclaw:1792465355414", "ocuclaw:even-ai"), false);
});
