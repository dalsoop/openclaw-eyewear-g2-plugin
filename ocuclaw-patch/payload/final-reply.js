// openclaw-g2: pick the Even AI response body from the run's final transcript
// reply (via gateway chat.history), falling back to the streamed text.
import { formatGlassesReply } from "./reply-format.js";

export const NO_REPLY_NOTICE = "답을 못 가져왔어. 다시 물어봐 줘.";
export const DEFAULT_HISTORY_TIMEOUT_MS = 5000;
const DEFAULT_POLL_MS = 250;
const HISTORY_LIMIT = 40;
const TOOL_STOP_REASONS = new Set(["toolUse", "tool_use", "tool_calls", "toolCalls"]);

function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function forcedFailure() {
  // Test-only switch; off unless explicitly set.
  return process.env.OCUCLAW_G2_FORCE_HISTORY_FAILURE === "1";
}

// Concatenates the text parts of a transcript message body (string or block list).
export function messageText(content) {
  if (typeof content === "string") return content;
  let out = "";
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === "text" && typeof part.text === "string") out += part.text;
  }
  return out;
}

function messageRunId(message) {
  const meta = message && message.__openclaw;
  if (meta && typeof meta.runId === "string") return meta.runId.trim();
  return typeof message?.runId === "string" ? message.runId.trim() : "";
}

function findRunReply(history, runId) {
  const messages = history && Array.isArray(history.messages) ? history.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "assistant" || messageRunId(m) !== runId) continue;
    const text = messageText(m.content);
    if (!text.trim()) continue;
    return { text, toolTurn: TOOL_STOP_REASONS.has(m.stopReason) };
  }
  return null;
}

function timeoutError(ms) {
  const err = new Error(`chat.history lookup did not finish within ${ms}ms`);
  err.code = "ocuclaw_g2_history_timeout";
  return err;
}

function withDeadline(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(ms)), Math.max(1, ms));
      if (timer.unref) timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves with the run's final assistant text from chat.history, or throws
// on lookup error / timeout / no non-empty reply before the deadline.
export async function fetchFinalReplyText({
  gatewayBridge,
  runId,
  sessionKey,
  timeoutMs = DEFAULT_HISTORY_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
}) {
  if (!gatewayBridge || typeof gatewayBridge.request !== "function") {
    throw new Error("gateway bridge has no request()");
  }
  const id = typeof runId === "string" ? runId.trim() : "";
  if (!id) throw new Error("missing runId");
  const deadline = Date.now() + timeoutMs;
  let lastSeen = null;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const history = await withDeadline(
      gatewayBridge.request("chat.history", { sessionKey, limit: HISTORY_LIMIT }),
      remaining,
    );
    const found = findRunReply(history, id);
    if (found && !found.toolTurn) return found.text;
    if (found) lastSeen = found.text;
    if (deadline - Date.now() <= pollMs) {
      if (lastSeen) return lastSeen;
      await sleep(Math.max(0, deadline - Date.now()));
      break;
    }
    await sleep(pollMs);
  }
  if (lastSeen) return lastSeen;
  throw timeoutError(timeoutMs);
}

// Returns the processed glasses reply; never throws, never returns "".
export async function resolveEvenAiReply({
  gatewayBridge,
  runId,
  sessionKey,
  streamText,
  logger,
  historyTimeoutMs,
  pollMs,
  budget,
}) {
  const log = logger && typeof logger.info === "function" ? logger : null;
  const timeoutMs =
    Number.isFinite(historyTimeoutMs) && historyTimeoutMs > 0
      ? historyTimeoutMs
      : envInt("OCUCLAW_G2_HISTORY_TIMEOUT_MS", DEFAULT_HISTORY_TIMEOUT_MS);
  const fmt = { budget };
  let source = "transcript";
  let reason = "";
  let body = "";
  try {
    if (forcedFailure()) throw new Error("forced history failure (OCUCLAW_G2_FORCE_HISTORY_FAILURE)");
    const finalText = await fetchFinalReplyText({ gatewayBridge, runId, sessionKey, timeoutMs, pollMs });
    body = formatGlassesReply(finalText, fmt);
    if (!body) reason = "empty transcript reply";
  } catch (err) {
    reason = err && err.message ? err.message : String(err);
  }
  if (!body) {
    source = "stream";
    body = formatGlassesReply(typeof streamText === "string" ? streamText : "", fmt);
  }
  if (!body) {
    source = "notice";
    body = formatGlassesReply(NO_REPLY_NOTICE, fmt);
  }
  if (log) {
    const streamChars = typeof streamText === "string" ? Array.from(streamText).length : 0;
    log.info(
      `[ocuclaw-g2] even-ai reply run=${runId || "-"} source=${source} chars=${Array.from(body).length} streamChars=${streamChars}` +
        (reason ? ` fallbackReason=${JSON.stringify(reason)}` : ""),
    );
  }
  return body;
}
