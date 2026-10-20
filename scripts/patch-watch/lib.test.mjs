// Decision and retry logic of the patch watcher (no gateway, no phone needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCheckOutput,
  decide,
  buildAlert,
  displayPath,
  pickPhoneNode,
  retryConfig,
  sendWithRetry,
  ReadyScanner,
  formatNotifyResult,
  redactNodeIds,
} from "./lib.mjs";

const MISSING_OUT = [
  "check: MISSING 2 patch point(s) (/x/ocuclaw)",
  "  missing: final-reply-hook",
  "  missing: tick-auth",
  "",
].join("\n");

test("check exit 0 is ok", () => {
  assert.deepEqual(parseCheckOutput(0, "check: all patch points present (/x)\n", ""), { kind: "ok" });
});

test("check exit 3 lists the missing points", () => {
  assert.deepEqual(parseCheckOutput(3, MISSING_OUT, ""), {
    kind: "missing",
    points: ["final-reply-hook", "tick-auth"],
  });
});

test("check exit 3 without point names is an error, not an alert", () => {
  const r = parseCheckOutput(3, "garbage\n", "");
  assert.equal(r.kind, "error");
});

test("any other exit code is an error", () => {
  const r = parseCheckOutput(1, "", "TypeError: boom\n");
  assert.equal(r.kind, "error");
  assert.match(r.detail, /exit 1/);
  assert.match(r.detail, /boom/);
  assert.equal(parseCheckOutput(null, "", "").kind, "error");
});

test("decide: present -> no alert", () => {
  assert.equal(decide({ kind: "ok" }).notify, false);
});

test("decide: missing -> alert", () => {
  const d = decide({ kind: "missing", points: ["a"] });
  assert.equal(d.notify, true);
  assert.deepEqual(d.points, ["a"]);
});

const STALE_OUT = [
  "check: all hooks present, payload differs from repo (/x/ocuclaw); run apply to update",
  "  stale: index.js",
  "  stale: final-reply.js",
  "",
].join("\n");

test("check exit 5 is a stale payload, listing the files", () => {
  assert.deepEqual(parseCheckOutput(5, STALE_OUT, ""), { kind: "stale", files: ["index.js", "final-reply.js"] });
});

test("check exit 3 ignores stale lines when collecting missing points", () => {
  const out = MISSING_OUT + "  stale: index.js\n";
  assert.deepEqual(parseCheckOutput(3, out, ""), { kind: "missing", points: ["final-reply-hook", "tick-auth"] });
});

test("decide: stale payload -> log only, never alert", () => {
  const d = decide({ kind: "stale", files: ["index.js"] });
  assert.equal(d.notify, false);
  assert.match(d.log, /payload differs from repo; run apply to update/);
  assert.match(d.log, /index\.js/);
  assert.doesNotMatch(d.log, /^check error/);
});

test("formatNotifyResult logs ok/fail and an 8-char node prefix only", () => {
  const id = "a".repeat(8) + "b".repeat(56);
  const ok = formatNotifyResult(1, { ok: true, node: id });
  assert.equal(ok, "notify attempt 1: ok (node aaaaaaaa…)");
  assert.doesNotMatch(ok, /b{8}/);
  const fail = formatNotifyResult(2, { ok: false, error: `notify exit 1: no route to ${id}` });
  assert.match(fail, /^notify attempt 2: fail \(/);
  assert.doesNotMatch(fail, /b{8}/);
  assert.match(fail, /aaaaaaaa…/);
});

test("redactNodeIds shortens any 64-hex id to 8 chars + …", () => {
  const id = "0123abcd" + "f".repeat(56);
  assert.equal(redactNodeIds(`x ${id} y "${id.toUpperCase()}"`), `x 0123abcd… y "0123ABCD…"`);
  assert.equal(redactNodeIds("short 0123abcd"), "short 0123abcd");
});

test("decide: check error -> log only, never alert", () => {
  const d = decide({ kind: "error", detail: "exit 1" });
  assert.equal(d.notify, false);
  assert.match(d.log, /exit 1/);
});

test("alert text is Korean, names points and the re-apply commands", () => {
  const { title, body } = buildAlert(["final-reply-hook", "tick-auth"], "~/code/openclaw-g2");
  assert.match(title, /패치/);
  assert.match(body, /final-reply-hook, tick-auth/);
  assert.match(body, /~\/code\/openclaw-g2\/scripts\/ocuclaw-patch\.sh apply/);
  assert.match(body, /openclaw gateway restart/);
  assert.match(body, /첫 조각/);
  // casual speech (반말), no polite endings
  assert.doesNotMatch(body, /(습니다|세요|해요)/);
});

test("displayPath shortens home to ~", () => {
  assert.equal(displayPath("/Users/u/code/openclaw-g2", "/Users/u"), "~/code/openclaw-g2");
  assert.equal(displayPath("/opt/x", "/Users/u"), "/opt/x");
});

const STATUS = {
  nodes: [
    { nodeId: "mac1", displayName: "mac", platform: "macOS 27", deviceFamily: "Mac", connected: true, commands: ["system.notify"] },
    { nodeId: "ph1", displayName: "phone", platform: "android", deviceFamily: "Android", connected: true, commands: ["system.notify"] },
  ],
};

test("pickPhoneNode picks the connected phone with system.notify, not the Mac", () => {
  assert.deepEqual(pickPhoneNode(STATUS), { id: "ph1", name: "phone" });
});

test("pickPhoneNode returns null when the phone is not connected", () => {
  const s = { nodes: [STATUS.nodes[0], { ...STATUS.nodes[1], connected: false }] };
  assert.equal(pickPhoneNode(s), null);
});

test("pickPhoneNode accepts iOS and honours an explicit override", () => {
  const s = { nodes: [{ nodeId: "i1", displayName: "iph", platform: "iOS 26", deviceFamily: "iPhone", connected: true, commands: ["system.notify"] }] };
  assert.deepEqual(pickPhoneNode(s), { id: "i1", name: "iph" });
  assert.deepEqual(pickPhoneNode(STATUS, "mac1"), { id: "mac1", name: "mac" });
  assert.equal(pickPhoneNode(STATUS, "nope"), null);
  assert.equal(pickPhoneNode(null), null);
});

test("retryConfig defaults to 30 s every, up to 10 min, and is tunable", () => {
  assert.deepEqual(retryConfig({}), { intervalMs: 30000, maxMs: 600000 });
  assert.deepEqual(
    retryConfig({ PATCH_WATCH_RETRY_INTERVAL_SEC: "5", PATCH_WATCH_RETRY_MAX_SEC: "20" }),
    { intervalMs: 5000, maxMs: 20000 },
  );
  assert.deepEqual(retryConfig({ PATCH_WATCH_RETRY_INTERVAL_SEC: "abc" }), { intervalMs: 30000, maxMs: 600000 });
});

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test("sendWithRetry stops at the first success", async () => {
  const clk = fakeClock();
  let n = 0;
  const r = await sendWithRetry(async () => { n += 1; return n === 3 ? { ok: true } : { ok: false, error: "offline" }; }, {
    intervalMs: 30000, maxMs: 600000, ...clk,
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.equal(clk.now(), 60000);
});

test("sendWithRetry gives up after maxMs (21 attempts for 30 s / 10 min)", async () => {
  const clk = fakeClock();
  const r = await sendWithRetry(async () => ({ ok: false, error: "offline" }), { intervalMs: 30000, maxMs: 600000, ...clk });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 21);
  assert.equal(r.lastError, "offline");
  assert.equal(clk.now(), 600000);
});

test("sendWithRetry treats a thrown attempt as a failure", async () => {
  const clk = fakeClock();
  const r = await sendWithRetry(async () => { throw new Error("spawn failed"); }, { intervalMs: 10, maxMs: 25, ...clk });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 3);
  assert.match(r.lastError, /spawn failed/);
});

test("sendWithRetry stops when aborted (superseded by a newer start)", async () => {
  const clk = fakeClock();
  let n = 0;
  const r = await sendWithRetry(async () => { n += 1; return { ok: false, error: "x" }; }, {
    intervalMs: 10, maxMs: 1000, ...clk, shouldAbort: () => n >= 2,
  });
  assert.equal(r.ok, false);
  assert.equal(r.aborted, true);
  assert.equal(r.attempts, 2);
});

test("ReadyScanner counts gateway ready lines, across chunk boundaries", () => {
  const s = new ReadyScanner();
  assert.equal(s.feed("2026-10-20T12:48:38.540+09:00 [gateway] http server listening\n2026-10-20T12:48:39.088+09:00 [gate"), 0);
  assert.equal(s.feed("way] ready\n"), 1);
  assert.equal(s.feed("[gateway] startup phase: ready 0.4ms total=7001.0ms\n"), 0);
  assert.equal(s.feed("x [gateway] ready\ny [gateway] ready\n"), 2);
});
