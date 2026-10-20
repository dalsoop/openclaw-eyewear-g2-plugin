// Heuristic checks that an Even AI reply follows the glasses prompt:
// casual Korean (반말), <= 350 code points, no markdown / list markers /
// tables / emoji, and no trailing follow-up question.

export const MAX_REPLY_CODE_POINTS = 350;

// Polite sentence endings: ...요 / ...니다 / ...니까 at a sentence boundary.
const POLITE = /(요|니다|니까)\s*([.!?~…]|$)/m;
const MARKDOWN = /\*\*|__|`|^\s{0,3}#{1,6}\s|\[[^\]]+\]\([^)]+\)/m;
const LIST = /^\s*([-*+•·▪◦]|\d+[.)])\s+/m;
const TABLE = /\|.*\|/;
const EMOJI = /\p{Extended_Pictographic}/u;
const FOLLOW_UP = /(더\s*궁금한|궁금한\s*(거|게|점)|다른\s*(거|건|질문)|도와줄\s*(거|게)|알려줄까|어때\?|있어\?)\s*[.!?]*\s*$/;

export function replyStyleProblems(text) {
  const s = typeof text === "string" ? text.trim() : "";
  const problems = [];
  if (Array.from(s).length > MAX_REPLY_CODE_POINTS) problems.push("length");
  if (POLITE.test(s)) problems.push("polite");
  if (MARKDOWN.test(s)) problems.push("markdown");
  if (LIST.test(s)) problems.push("list");
  if (TABLE.test(s)) problems.push("table");
  if (EMOJI.test(s)) problems.push("emoji");
  if (FOLLOW_UP.test(s)) problems.push("follow-up");
  return problems;
}

// Gateway session keys are agent-scoped ("agent:main:ocuclaw:even-ai"); the
// plugin's own key is "ocuclaw:even-ai". Throwaway keys (":<id>" suffix) and
// other sessions do not match.
export function isDedicatedSessionKey(sessionKey, dedicatedKey) {
  const k = String(sessionKey || "").toLowerCase();
  const d = String(dedicatedKey || "").toLowerCase();
  return !!d && (k === d || /^agent:[^:]+:/.test(k) && k.replace(/^agent:[^:]+:/, "") === d);
}
