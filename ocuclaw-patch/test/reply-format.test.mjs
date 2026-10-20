import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanReplySymbols,
  applyLengthPolicy,
  formatGlassesReply,
  DEFAULT_REPLY_BUDGET,
} from "../payload/reply-format.js";

const cp = (s) => Array.from(s).length;

test("default budget is 350", () => {
  assert.equal(DEFAULT_REPLY_BUDGET, 350);
});

test("strips headings, emphasis, inline code, fences, list markers, quotes, links", () => {
  const input = [
    "# 제목",
    "## 부제목",
    "**굵게** 와 *기울임* 과 __밑줄굵게__ 와 _밑줄_",
    "`코드` 사용",
    "```js",
    "const a = 1;",
    "```",
    "- 하나",
    "* 둘",
    "+ 셋",
    "1. 넷",
    "> 인용문",
    "[링크 글자](https://example.com/x)",
  ].join("\n");
  assert.equal(
    cleanReplySymbols(input),
    [
      "제목",
      "부제목",
      "굵게 와 기울임 과 밑줄굵게 와 밑줄",
      "코드 사용",
      "const a = 1;",
      "하나",
      "둘",
      "셋",
      "넷",
      "인용문",
      "링크 글자",
    ].join("\n"),
  );
});

test("keeps snake_case and arithmetic asterisks intact", () => {
  assert.equal(cleanReplySymbols("변수 my_var_name 값은 2 * 3"), "변수 my_var_name 값은 2 * 3");
});

test("removes emoji and variation selectors", () => {
  assert.equal(cleanReplySymbols("좋아요 😊 정말 ❤️ 최고 👍🏽"), "좋아요 정말 최고");
  assert.equal(cleanReplySymbols("가족 👨‍👩‍👧 사진"), "가족 사진");
});

test("emoji-only reply becomes empty", () => {
  assert.equal(formatGlassesReply("😀🎉👍"), "");
});

test("empty reply stays empty", () => {
  assert.equal(formatGlassesReply(""), "");
  assert.equal(formatGlassesReply("   \n  "), "");
  assert.equal(formatGlassesReply(null), "");
});

test("trims leading and trailing whitespace after cleanup", () => {
  assert.equal(formatGlassesReply("\n\n  - 안녕  \n\n"), "안녕");
});

test("exactly 350 code points is sent as is", () => {
  const s = "가".repeat(350);
  assert.equal(applyLengthPolicy(s), s);
  // astral code points count as one each
  const astral = "𝒜".repeat(350);
  assert.equal(applyLengthPolicy(astral), astral);
});

test("351 code points without boundary cuts at 349 and appends ellipsis", () => {
  const s = "가".repeat(351);
  const out = applyLengthPolicy(s);
  assert.equal(out, "가".repeat(349) + "…");
  assert.equal(cp(out), 350);
});

test("no boundary within 349 -> hard cut at 349 + ellipsis, trailing whitespace trimmed", () => {
  const s = "가".repeat(348) + " " + "나".repeat(10);
  const out = applyLengthPolicy(s);
  assert.equal(out, "가".repeat(348) + "…");
});

test("cuts at the last Korean sentence ending '다.'", () => {
  const first = "오늘은 날씨가 맑습니다.";
  const second = "내일은 비가 올 예정입니다.";
  const filler = "가".repeat(400);
  const s = `${first} ${second} ${filler}`;
  const out = applyLengthPolicy(s);
  assert.equal(out, `${first} ${second}…`);
});

test("sentence boundary requires whitespace or end after the mark", () => {
  // "3.14" must not count as a boundary
  const s = "원주율은 3.14" + "가".repeat(400);
  const out = applyLengthPolicy(s);
  assert.equal(out, Array.from(s).slice(0, 349).join("") + "…");
});

test("newline counts as a boundary", () => {
  const head = "첫 줄 내용";
  const s = `${head}\n${"가".repeat(400)}`;
  assert.equal(applyLengthPolicy(s), `${head}…`);
});

test("boundary marks ? ! 。 … are honoured", () => {
  for (const mark of ["?", "!", "。", "…"]) {
    const head = `질문인가요${mark}`;
    const s = `${head} ${"가".repeat(400)}`;
    assert.equal(applyLengthPolicy(s), mark === "…" ? head : `${head}…`, mark);
  }
});

test("boundary exactly at 349 code points is used", () => {
  const head = "가".repeat(348) + ".";
  const s = `${head} ${"나".repeat(5)}`;
  assert.equal(cp(head), 349);
  assert.equal(applyLengthPolicy(s), `${head}…`);
});

test("boundary at position 350 is out of range", () => {
  const s = "가".repeat(349) + ". " + "나".repeat(5);
  assert.equal(applyLengthPolicy(s), "가".repeat(349) + "…");
});

test("budget is tunable", () => {
  assert.equal(applyLengthPolicy("가나다라마바", { budget: 4 }), "가나다…");
  assert.equal(applyLengthPolicy("가나다라", { budget: 4 }), "가나다라");
});

test("result never exceeds the budget", () => {
  const s = "문장입니다. ".repeat(200);
  assert.ok(cp(formatGlassesReply(s)) <= 350);
});

test("cleanup runs before the length check", () => {
  // 340 visible chars plus markdown noise: fits after cleanup
  const s = "**" + "가".repeat(340) + "**";
  assert.equal(formatGlassesReply(s), "가".repeat(340));
});

test("no double ellipsis when the cut text already ends with …", () => {
  const head = "생각해 보니…";
  const s = `${head} ${"가".repeat(400)}`;
  assert.equal(applyLengthPolicy(s), head);
  // hard cut landing right after an ellipsis also gets no second one
  const hard = "가".repeat(348) + "…" + "나".repeat(10);
  assert.equal(applyLengthPolicy(hard), "가".repeat(348) + "…");
});
