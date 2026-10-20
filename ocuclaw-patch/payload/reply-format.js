// openclaw-g2: formatting of Hey Even replies sent to the G2 glasses.
// Order: (1) symbol cleanup -> (2) trim -> (3) length policy (code points).

export const DEFAULT_REPLY_BUDGET = 350;
export const ELLIPSIS = "…";

function envBudget() {
  const raw = typeof process !== "undefined" ? process.env.OCUCLAW_G2_REPLY_BUDGET : undefined;
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 2 ? n : DEFAULT_REPLY_BUDGET;
}

// Emoji sequences: presentation emoji, or text-default pictographs forced to
// emoji with VS16, plus trailing modifiers / keycaps / tags and ZWJ chains.
const EMOJI_SEQUENCE_RE =
  /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️)(?:\p{Emoji_Modifier}|️|⃣|[\u{E0020}-\u{E007F}])*(?:‍(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\p{Emoji_Modifier}|️|⃣)*)*/gu;
const VARIATION_SELECTOR_RE = /[︎️⃣]/gu;

const FENCE_LINE_RE = /^\s*(?:```|~~~)/;
const RULE_LINE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BLOCKQUOTE_RE = /^(\s*)(?:>\s?)+/;
const LIST_MARKER_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const HEADING_RE = /^(\s*)#{1,6}(?:\s+|$)/;

function stripLinePrefixes(line) {
  let prev;
  let cur = line;
  // Repeat so combinations like "> - item" or "- # title" are all removed.
  do {
    prev = cur;
    cur = cur.replace(BLOCKQUOTE_RE, "$1").replace(LIST_MARKER_RE, "$1").replace(HEADING_RE, "$1");
  } while (cur !== prev);
  return cur.replace(/^\s+/, "");
}

function stripInline(text) {
  let s = text;
  // Images and links keep only their text.
  s = s.replace(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g, "$1");
  // Inline code keeps its content.
  s = s.replace(/(`+)([^`\n]*?)\1/g, "$2");
  s = s.replace(/`+/g, "");
  // Strong / emphasis (paired), longest markers first.
  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "$1");
  s = s.replace(/(^|[^\p{L}\p{N}_])__(?=\S)([^\n]*?\S)__(?![\p{L}\p{N}_])/gu, "$1$2");
  s = s.replace(/\*(?=[^\s*])([^\n*]*?[^\s*])\*/g, "$1");
  s = s.replace(/\*(?=[^\s*])([^\s*])\*/g, "$1");
  s = s.replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^\n_]*?[^\s_]|[^\s_])_(?![\p{L}\p{N}_])/gu, "$1$2");
  // Unpaired strong markers left over.
  s = s.replace(/\*\*+/g, "");
  s = s.replace(/(^|[^\p{L}\p{N}])__+(?![\p{L}\p{N}])/gu, "$1");
  return s;
}

export function cleanReplySymbols(text) {
  if (typeof text !== "string" || !text) return "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (const line of lines) {
    if (FENCE_LINE_RE.test(line)) continue;
    if (RULE_LINE_RE.test(line)) continue;
    let s = stripLinePrefixes(line);
    s = stripInline(s);
    s = s.replace(EMOJI_SEQUENCE_RE, "").replace(VARIATION_SELECTOR_RE, "");
    s = s.replace(/[ \t ]{2,}/g, " ").replace(/^[ \t ]+|[ \t ]+$/g, "");
    out.push(s);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

const SENTENCE_END = new Set([".", "?", "!", "。", ELLIPSIS]);

function isSpace(ch) {
  return /\s/u.test(ch);
}

export function applyLengthPolicy(text, opts = {}) {
  const budget =
    Number.isFinite(opts.budget) && opts.budget >= 2 ? Math.floor(opts.budget) : envBudget();
  const chars = Array.from(typeof text === "string" ? text : "");
  if (chars.length <= budget) return chars.join("");
  const limit = budget - 1; // room for the ellipsis
  let cut = -1;
  for (let i = 0; i < chars.length && i < limit; i += 1) {
    const ch = chars[i];
    if (ch === "\n") {
      if (i > 0) cut = i;
      continue;
    }
    if (SENTENCE_END.has(ch)) {
      const next = chars[i + 1];
      if (next === undefined || isSpace(next)) cut = i + 1;
    }
  }
  const end = cut > 0 ? cut : limit;
  const head = chars.slice(0, end).join("").replace(/\s+$/u, "");
  // Avoid "……" when the cut already ends with an ellipsis.
  return head.endsWith(ELLIPSIS) ? head : head + ELLIPSIS;
}

export function formatGlassesReply(text, opts = {}) {
  const cleaned = cleanReplySymbols(text).trim();
  if (!cleaned) return "";
  return applyLengthPolicy(cleaned, opts);
}
