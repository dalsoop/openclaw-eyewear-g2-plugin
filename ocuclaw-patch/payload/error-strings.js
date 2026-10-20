// openclaw-g2: Korean versions of the glasses-facing Even AI error replies.
const EXACT = new Map([
  ["Even AI request timed out. Please try again.", "시간이 너무 걸렸어. 다시 물어봐 줘."],
  ["Even AI request failed upstream. Please try again.", "답을 만들다 문제가 생겼어. 다시 물어봐 줘."],
]);
const DISCONNECTED_RE = /^Even AI is unavailable because .+ is disconnected\.$/s;
const DISCONNECTED_KO = "지금 리체랑 연결이 끊겼어. 잠시 뒤에 다시 해 줘.";

export function localizeGlassesText(text) {
  if (typeof text !== "string") return text;
  if (EXACT.has(text)) return EXACT.get(text);
  if (DISCONNECTED_RE.test(text)) return DISCONNECTED_KO;
  return text;
}

// Hook for buildCompletionPayload(opts): rewrites opts.content only.
export function localizeCompletionOpts(opts) {
  if (!opts || typeof opts.content !== "string") return opts;
  const content = localizeGlassesText(opts.content);
  return content === opts.content ? opts : { ...opts, content };
}
