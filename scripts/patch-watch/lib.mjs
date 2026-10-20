// Pure decision / retry logic for the OcuClaw patch watcher (see scripts/patch-watch.mjs).

function listed(stdout, key) {
  const out = [];
  const re = new RegExp(`^\\s*${key}:\\s*(\\S.*?)\\s*$`);
  for (const line of String(stdout || "").split("\n")) {
    const m = line.match(re);
    if (m) out.push(m[1]);
  }
  return out;
}

// Interpret `ocuclaw-patch/cli.mjs check`: exit 0 = all present, 3 = missing points,
// 5 = hooks present but the installed payload differs from the repo (stale).
export function parseCheckOutput(code, stdout, stderr) {
  if (code === 0) return { kind: "ok" };
  if (code === 3) {
    const points = listed(stdout, "missing");
    if (points.length > 0) return { kind: "missing", points };
  }
  if (code === 5) return { kind: "stale", files: listed(stdout, "stale") };
  const tail = String(stderr || stdout || "").trim().split("\n").slice(-3).join(" | ");
  return { kind: "error", detail: `check exit ${code}${tail ? `: ${tail}` : ""}` };
}

// Only a clean "missing" result alerts; a stale payload or a failed check is logged only.
export function decide(result) {
  switch (result.kind) {
    case "ok":
      return { notify: false, log: "check ok: all patch points present, no alert" };
    case "stale":
      return {
        notify: false,
        log: `check: payload differs from repo; run apply to update (${(result.files || []).join(", ") || "?"}), no alert`,
      };
    case "missing":
      return {
        notify: true,
        points: result.points,
        log: `check: missing ${result.points.join(", ")}`,
      };
    default:
      return { notify: false, log: `check error (no alert): ${result.detail}` };
  }
}

const NODE_ID = /\b([0-9a-fA-F]{8})[0-9a-fA-F]{56}\b/g;

// Shorten every 64-hex node id to its first 8 chars + "…" (log hygiene).
export function redactNodeIds(text) {
  return String(text).replace(NODE_ID, "$1…");
}

// One log line per notify attempt: ok/fail and the node id prefix, never raw CLI output.
export function formatNotifyResult(n, r) {
  if (r && r.ok) return `notify attempt ${n}: ok (node ${String(r.node || "?").slice(0, 8)}…)`;
  return `notify attempt ${n}: fail (${redactNodeIds((r && r.error) || "unknown error")})`;
}

export function displayPath(abs, home) {
  if (home && (abs === home || abs.startsWith(home + "/"))) return "~" + abs.slice(home.length);
  return abs;
}

// User-facing alert, Korean casual speech.
export function buildAlert(points, repoDisplay) {
  return {
    title: "OcuClaw 패치가 빠졌어",
    body:
      `게이트웨이가 다시 켜졌는데 OcuClaw 패치 지점이 빠졌어: ${points.join(", ")}. ` +
      "이대로면 Hey Even 답이 첫 조각만 보여. " +
      `${repoDisplay}/scripts/ocuclaw-patch.sh apply 돌리고 openclaw gateway restart 해줘.`,
  };
}

const PHONE_PLATFORM = /android|ios|ipados/i;
const PHONE_FAMILY = /android|iphone|ipad/i;

// Choose the paired phone node (connected, supports system.notify) from `openclaw nodes status --json`.
export function pickPhoneNode(status, override) {
  const nodes = (status && Array.isArray(status.nodes) && status.nodes) || [];
  const usable = (n) => n && n.connected === true && Array.isArray(n.commands) && n.commands.includes("system.notify");
  let found;
  if (override) {
    found = nodes.find((n) => usable(n) && (n.nodeId === override || n.displayName === override));
  } else {
    found = nodes.find(
      (n) => usable(n) && (PHONE_PLATFORM.test(n.platform || "") || PHONE_FAMILY.test(n.deviceFamily || "")),
    );
  }
  return found ? { id: found.nodeId, name: found.displayName } : null;
}

function positiveSec(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : dflt;
}

export function retryConfig(env) {
  return {
    intervalMs: positiveSec(env.PATCH_WATCH_RETRY_INTERVAL_SEC, 30000),
    maxMs: positiveSec(env.PATCH_WATCH_RETRY_MAX_SEC, 600000),
  };
}

// Attempt now, then every intervalMs while the elapsed time stays within maxMs.
export async function sendWithRetry(attempt, { intervalMs, maxMs, sleep, now, shouldAbort = () => false, onAttempt }) {
  const start = now();
  let attempts = 0;
  let lastError = "";
  for (;;) {
    attempts += 1;
    let r;
    try {
      r = await attempt(attempts);
    } catch (err) {
      r = { ok: false, error: err && err.message ? err.message : String(err) };
    }
    if (onAttempt) onAttempt(attempts, r);
    if (r && r.ok) return { ok: true, attempts, result: r };
    lastError = (r && r.error) || "unknown error";
    if (shouldAbort()) return { ok: false, attempts, lastError, aborted: true };
    if (now() - start + intervalMs > maxMs) return { ok: false, attempts, lastError };
    await sleep(intervalMs);
    if (shouldAbort()) return { ok: false, attempts, lastError, aborted: true };
  }
}

// Counts "[gateway] ready" lines in appended gateway.log text; keeps partial lines between feeds.
export class ReadyScanner {
  constructor() {
    this.rest = "";
  }

  feed(chunk) {
    const text = this.rest + chunk;
    const lines = text.split("\n");
    this.rest = lines.pop();
    return lines.filter((l) => /\[gateway\] ready\s*$/.test(l)).length;
  }
}
