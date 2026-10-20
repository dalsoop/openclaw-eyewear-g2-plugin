// openclaw-g2 injected module for the OcuClaw plugin (not part of OcuClaw).
// Loaded by short hook lines added to OcuClaw's dist files by ocuclaw-patch.
export { formatGlassesReply, cleanReplySymbols, applyLengthPolicy } from "./reply-format.js";
export { resolveEvenAiReply, NO_REPLY_NOTICE } from "./final-reply.js";
export { normalizeAssistantDelta } from "./assistant-delta.js";
export { localizeCompletionOpts, localizeGlassesText } from "./error-strings.js";
export { isMethodUnsupported, markMethodUnsupported, noteGatewayHello } from "./method-support.js";
export { parseTickModelRef, resolveTickApiKey } from "./tick-auth.js";
