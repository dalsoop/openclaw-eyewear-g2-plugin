// Live truncation check: ask the Even AI endpoint real questions and assert the
// response equals formatGlassesReply(final transcript reply of that run).
// The token is read from openclaw.json and only ever put in the request header.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { formatGlassesReply } from "./payload/reply-format.js";
import { messageText } from "./payload/final-reply.js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:47800/v1/chat/completions";
const DEFAULT_CONFIG = path.join(os.homedir(), ".openclaw/openclaw.json");
const DEFAULT_DB = path.join(os.homedir(), ".openclaw/agents/main/agent/openclaw-agent.sqlite");

export const DEFAULT_ENDPOINT_URL = DEFAULT_ENDPOINT;
export const DEFAULT_CONFIG_FILE = DEFAULT_CONFIG;
export const DEFAULT_TRANSCRIPT_DB = DEFAULT_DB;

export const LIVE_QUESTIONS = [
  {
    label: "long",
    text: "한국의 봄, 여름, 가을, 겨울 각각의 날씨와 즐길 거리를 자세히 설명해 줘. 최소 700자 이상으로 길게 써 줘.",
    expectLong: true,
  },
  {
    label: "markdown-list",
    text: "주말에 집에서 할 만한 활동 다섯 가지를 마크다운 번호 목록으로 알려줘. 각 항목 제목은 **굵게** 쓰고 한 줄 설명을 붙여 줘.",
    expectMarkdown: true,
  },
  {
    label: "short",
    text: "한 문장으로만 답해 줘: 하늘은 왜 파란색이야?",
  },
];

export function readToken(configFile) {
  const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const token = cfg?.plugins?.entries?.ocuclaw?.config?.evenAiToken;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(`evenAiToken not found in ${configFile}`);
  }
  return token.trim();
}

export async function askEvenAi(endpoint, token, text, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "EvenCore/1.0",
      },
      body: JSON.stringify({ model: "openclaw", messages: [{ role: "user", content: text }] }),
    });
    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`unexpected response (HTTP ${res.status})`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function decodeEvent(row) {
  try {
    if (typeof row.event_json === "string") return JSON.parse(row.event_json);
    if (row.event_zstd) return JSON.parse(zstdDecompressSync(Buffer.from(row.event_zstd)).toString("utf8"));
  } catch {
    // ignore undecodable rows
  }
  return null;
}

const textOf = messageText;

// Maps transcript session ids to gateway session keys (session_windows).
function sessionKeyOf(db, sessionId) {
  try {
    const row = db.prepare("select session_key from session_windows where session_id = ?").get(sessionId);
    return row && typeof row.session_key === "string" ? row.session_key : null;
  } catch {
    return null;
  }
}

// Returns the gateway session keys of every session whose user messages
// (created after sinceMs) contain `needle`.
export function findSessionKeysWithUserText(dbFile, needle, sinceMs) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const rows = db
      .prepare("select session_id, event_json, event_zstd from transcript_events where created_at >= ?")
      .all(sinceMs);
    const keys = new Set();
    for (const row of rows) {
      const ev = decodeEvent(row);
      if (!ev || ev.type !== "message" || !ev.message || ev.message.role !== "user") continue;
      if (textOf(ev.message.content).includes(needle)) {
        keys.add(sessionKeyOf(db, row.session_id) || `session-id:${row.session_id}`);
      }
    }
    return [...keys];
  } finally {
    db.close();
  }
}

// Finds the most recent user message containing `needle` (created after
// sinceMs) in any session (current, dedicated Even AI or throwaway) and returns
// the final assistant reply of that run together with its session key.
export function findRunReplyInTranscript(dbFile, needle, sinceMs) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "select session_id, seq, created_at, event_json, event_zstd from transcript_events where created_at >= ? order by session_id, seq",
      )
      .all(sinceMs);
    const bySession = new Map();
    for (const row of rows) {
      const ev = decodeEvent(row);
      if (!ev || ev.type !== "message" || !ev.message) continue;
      if (!bySession.has(row.session_id)) bySession.set(row.session_id, []);
      bySession.get(row.session_id).push({ seq: row.seq, createdAt: row.created_at, m: ev.message });
    }
    let hit = null;
    for (const [sessionId, list] of bySession) {
      list.forEach((e, idx) => {
        if (e.m.role === "user" && textOf(e.m.content).includes(needle)) {
          if (!hit || e.createdAt > hit.createdAt) hit = { sessionId, idx, createdAt: e.createdAt };
        }
      });
    }
    if (!hit) return null;
    const list = bySession.get(hit.sessionId);
    const user = list[hit.idx].m;
    const key = typeof user.idempotencyKey === "string" ? user.idempotencyKey : "";
    const runId = key.endsWith(":user") ? key.slice(0, -":user".length) : "";
    let reply = null;
    for (let i = hit.idx + 1; i < list.length; i += 1) {
      const m = list[i].m;
      if (m.role === "user" && !runId) break;
      if (m.role !== "assistant") continue;
      const msgRun = m.__openclaw && typeof m.__openclaw.runId === "string" ? m.__openclaw.runId : "";
      if (runId && msgRun && msgRun !== runId) continue;
      const t = textOf(m.content);
      if (t.trim()) reply = t;
    }
    return reply === null
      ? null
      : { runId: runId || null, sessionId: hit.sessionId, sessionKey: sessionKeyOf(db, hit.sessionId), text: reply };
  } finally {
    db.close();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const short = (s, n = 120) => {
  const a = Array.from(s.replace(/\n/g, "\\n"));
  return a.length > n ? `${a.slice(0, n).join("")}...` : a.join("");
};

export async function verifyLive(opts = {}) {
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const dbFile = opts["transcript-db"] || DEFAULT_DB;
  const token = readToken(opts.config || DEFAULT_CONFIG);
  let failures = 0;
  for (const q of LIVE_QUESTIONS) {
    const nonce = randomBytes(3).toString("hex");
    const text = `${q.text} (확인용 ${nonce})`;
    const since = Date.now() - 5000;
    let response;
    try {
      response = await askEvenAi(endpoint, token, text, 75_000);
    } catch (err) {
      console.log(`verify-live [${q.label}] FAIL request: ${err.message}`);
      failures += 1;
      continue;
    }
    let found = null;
    const deadline = Date.now() + 20_000;
    while (!found && Date.now() < deadline) {
      found = findRunReplyInTranscript(dbFile, `확인용 ${nonce}`, since);
      if (!found) await sleep(500);
    }
    if (!found) {
      console.log(`verify-live [${q.label}] FAIL no transcript reply found for nonce ${nonce}`);
      failures += 1;
      continue;
    }
    const expected = formatGlassesReply(found.text);
    const rawChars = Array.from(found.text).length;
    const respChars = Array.from(response).length;
    const ok = expected !== "" && response === expected;
    const notes = [];
    if (q.expectLong && rawChars <= 350) notes.push("note: transcript reply was not over 350");
    if (q.expectMarkdown && !/(^|\n)\s*(\d+\.|[-*+])\s|\*\*/.test(found.text)) {
      notes.push("note: transcript reply had no markdown list");
    }
    console.log(
      `verify-live [${q.label}] ${ok ? "OK" : "FAIL"} session=${found.sessionKey || "?"} run=${found.runId || "?"} transcriptChars=${rawChars} responseChars=${respChars} expectedChars=${Array.from(expected).length}` +
        (notes.length ? ` (${notes.join("; ")})` : ""),
    );
    if (!ok) {
      failures += 1;
      console.log(`  response: ${short(response)}`);
      console.log(`  expected: ${short(expected)}`);
    }
  }
  console.log(failures === 0 ? "verify-live: PASS" : `verify-live: FAIL (${failures})`);
  return failures === 0 ? 0 : 4;
}
