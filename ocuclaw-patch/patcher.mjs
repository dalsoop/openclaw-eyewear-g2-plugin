// Applies/checks the openclaw-g2 hooks in an installed OcuClaw plugin folder.
// Our code lives in ./payload and is copied to <plugin>/dist/ocuclaw-g2/.
// Original files only get short hook lines, located by anchor strings; every
// hook line carries a marker comment "/* ocuclaw-g2:<point> */".
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PAYLOAD_SRC = path.join(HERE, "payload");
export const PAYLOAD_DEST_REL = "dist/ocuclaw-g2";
const IMPORT_LINE = 'import * as __ocuclawG2 from "../ocuclaw-g2/index.js";';

export function marker(name) {
  return `/* ocuclaw-g2:${name} */`;
}

// mode "after": insert `line` (indented like the anchor) after the anchor line.
// mode "replace": replace the anchor text with `line` (marker appended).
export const PATCH_POINTS = [
  {
    name: "endpoint-import",
    file: "dist/even-ai/even-ai-endpoint.js",
    mode: "after",
    anchor: 'import { filterPlainAssistantOutputText } from "../domain/message-emoji-filter.js";',
    line: IMPORT_LINE,
  },
  {
    name: "endpoint-final-reply",
    file: "dist/even-ai/even-ai-endpoint.js",
    mode: "replace",
    anchor: "const filteredAssistantText = filterPlainAssistantOutputText(assistantText);",
    line:
      "const filteredAssistantText = await __ocuclawG2.resolveEvenAiReply({ gatewayBridge, runId, sessionKey, streamText: assistantText, logger });",
  },
  {
    name: "endpoint-korean-errors",
    file: "dist/even-ai/even-ai-endpoint.js",
    mode: "after",
    anchor: "function buildCompletionPayload(opts = {}) {",
    line: "opts = __ocuclawG2.localizeCompletionOpts(opts);",
  },
  {
    name: "client-import",
    file: "dist/gateway/openclaw-client.js",
    mode: "after",
    anchor: 'import { sanitizeConnectReason } from "./sanitize-connect-reason.js";',
    line: 'import * as __ocuclawG2 from "../ocuclaw-g2/index.js";',
  },
  {
    name: "client-assistant-delta",
    file: "dist/gateway/openclaw-client.js",
    mode: "after",
    anchor: "_handleAssistantEvent(runId, data, sessionKey = this._activeRunSessionKey) {",
    line: "data = __ocuclawG2.normalizeAssistantDelta(this, data);",
  },
  {
    name: "client-hello-features",
    file: "dist/gateway/openclaw-client.js",
    mode: "after",
    anchor: "this._applyConnectPolicy(helloOk.policy);",
    line: "__ocuclawG2.noteGatewayHello(helloOk);",
  },
  {
    name: "context-import",
    file: "dist/runtime/session-context-service.js",
    mode: "after",
    anchor: 'import * as path from "node:path";',
    line: 'import * as __ocuclawG2 from "../ocuclaw-g2/index.js";',
  },
  {
    name: "context-compaction-skip",
    file: "dist/runtime/session-context-service.js",
    mode: "replace",
    anchor: "if (compactionListUnsupported) return Promise.resolve(null);",
    line:
      'if (compactionListUnsupported || __ocuclawG2.isMethodUnsupported("sessions.compaction.list")) return Promise.resolve(null);',
  },
  {
    name: "context-compaction-note",
    file: "dist/runtime/session-context-service.js",
    mode: "replace",
    anchor: "if (isMethodNotFoundError(err)) compactionListUnsupported = true;",
    line:
      'if (isMethodNotFoundError(err)) { compactionListUnsupported = true; __ocuclawG2.markMethodUnsupported("sessions.compaction.list"); }',
  },
  {
    name: "glasses-ui-import",
    file: "dist/tools/glasses-ui-tool.js",
    mode: "after",
    anchor: 'import * as path from "node:path";',
    line: 'import * as __ocuclawG2 from "../ocuclaw-g2/index.js";',
  },
  {
    name: "glasses-ui-tick-api-key",
    file: "dist/tools/glasses-ui-tool.js",
    mode: "replace",
    anchor: "const key = await api.runtime.modelAuth.getApiKeyForModel({ model: modelRef, cfg });",
    line: "const key = await __ocuclawG2.resolveTickApiKey(api.runtime.modelAuth, modelRef, cfg);",
  },
];

export class PatchError extends Error {
  constructor(message, missingPoints) {
    super(message);
    this.missingPoints = missingPoints;
  }
}

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

function hookPresent(text, point) {
  return text.split("\n").some((l) => l.includes(marker(point.name)));
}

function applyPoint(text, point) {
  if (hookPresent(text, point)) return { text, changed: false };
  if (countOccurrences(text, point.anchor) !== 1) return null;
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.includes(point.anchor));
  const indent = lines[idx].match(/^\s*/)[0];
  if (point.mode === "after") {
    const extra = point.anchor.endsWith("{") ? "  " : "";
    lines.splice(idx + 1, 0, `${indent}${extra}${point.line} ${marker(point.name)}`);
  } else {
    lines[idx] = lines[idx].replace(point.anchor, `${point.line} ${marker(point.name)}`);
  }
  return { text: lines.join("\n"), changed: true };
}

function payloadFiles() {
  return fs
    .readdirSync(PAYLOAD_SRC)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

function payloadInSync(pluginDir) {
  const dest = path.join(pluginDir, PAYLOAD_DEST_REL);
  return payloadFiles().every((f) => {
    const p = path.join(dest, f);
    return fs.existsSync(p) && fs.readFileSync(p, "utf8") === fs.readFileSync(path.join(PAYLOAD_SRC, f), "utf8");
  });
}

function writeAtomic(file, text) {
  const tmp = `${file}.ocuclaw-g2.tmp`;
  const mode = fs.existsSync(file) ? fs.statSync(file).mode : 0o644;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}

function assertPluginDir(pluginDir) {
  if (!fs.existsSync(path.join(pluginDir, "dist/index.js"))) {
    throw new PatchError(`not an OcuClaw plugin folder: ${pluginDir}`, []);
  }
}

// Computes every change first; writes nothing if any point fails.
export function applyPatches(pluginDir) {
  assertPluginDir(pluginDir);
  const contents = new Map();
  const missing = [];
  const changed = [];
  for (const point of PATCH_POINTS) {
    const abs = path.join(pluginDir, point.file);
    if (!contents.has(abs)) {
      contents.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
    }
    const text = contents.get(abs);
    const res = text === null ? null : applyPoint(text, point);
    if (!res) {
      missing.push(point.name);
      continue;
    }
    if (res.changed) {
      contents.set(abs, res.text);
      changed.push(point.name);
    }
  }
  if (missing.length) {
    throw new PatchError(`anchor not found (or not unique) for: ${missing.join(", ")}`, missing);
  }
  const payloadChanged = !payloadInSync(pluginDir);
  if (payloadChanged) {
    const dest = path.join(pluginDir, PAYLOAD_DEST_REL);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of payloadFiles()) {
      writeAtomic(path.join(dest, f), fs.readFileSync(path.join(PAYLOAD_SRC, f), "utf8"));
    }
    changed.unshift("payload");
  }
  for (const [abs, text] of contents) {
    if (text !== null && text !== fs.readFileSync(abs, "utf8")) writeAtomic(abs, text);
  }
  return { changed };
}

// Hooks and payload presence decide "missing"; a payload that exists but differs
// from the repo copy (repo edited, branch switched, older apply) is only "stale":
// the gateway still runs a patched plugin, so it must not be reported as missing.
export function checkPatches(pluginDir) {
  assertPluginDir(pluginDir);
  const missing = [];
  const stale = [];
  const dest = path.join(pluginDir, PAYLOAD_DEST_REL);
  // Only files the installed index.js actually imports are required; a file that
  // exists only in the repo (added since the last apply) makes the payload stale.
  const installedIndex = path.join(dest, "index.js");
  const required = new Set(["index.js"]);
  if (fs.existsSync(installedIndex)) {
    for (const m of fs.readFileSync(installedIndex, "utf8").matchAll(/from\s+["']\.\/([\w.-]+\.js)["']/g)) {
      required.add(m[1]);
    }
  }
  let absent = false;
  for (const f of new Set([...payloadFiles(), ...required])) {
    const p = path.join(dest, f);
    const src = path.join(PAYLOAD_SRC, f);
    if (!fs.existsSync(p)) {
      if (required.has(f)) absent = true;
      else stale.push(f);
    } else if (!fs.existsSync(src) || fs.readFileSync(p, "utf8") !== fs.readFileSync(src, "utf8")) {
      stale.push(f);
    }
  }
  if (absent) missing.push("payload");
  for (const point of PATCH_POINTS) {
    const abs = path.join(pluginDir, point.file);
    const text = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    const hooked = hookPresent(text, point);
    // A replaced anchor must be gone; an inserted hook must follow its anchor.
    const ok =
      hooked &&
      (point.mode === "replace" ? !text.includes(point.anchor) : text.includes(point.anchor));
    if (!ok) missing.push(point.name);
  }
  return { missing, stale };
}
