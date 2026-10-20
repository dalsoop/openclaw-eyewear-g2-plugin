// Exercises apply/check against a temp copy of the pristine plugin backup.
// Set OCUCLAW_G2_PRISTINE_DIR to override the backup location; by default the
// newest unpatched plugin copy under ~/.openclaw/backups is used, and the
// suite is skipped when none exists (e.g. on a machine without a backup).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyPatches, checkPatches, PATCH_POINTS } from "../patcher.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "..", "cli.mjs");
function findPristine() {
  if (process.env.OCUCLAW_G2_PRISTINE_DIR) return process.env.OCUCLAW_G2_PRISTINE_DIR;
  const root = path.join(os.homedir(), ".openclaw/backups");
  if (!fs.existsSync(root)) return null;
  for (const stamp of fs.readdirSync(root).sort().reverse()) {
    const dir = path.join(root, stamp, "extensions/ocuclaw");
    const marker = path.join(dir, "dist/even-ai/even-ai-endpoint.js");
    if (fs.existsSync(marker) && !fs.readFileSync(marker, "utf8").includes("ocuclaw-g2:")) return dir;
  }
  return null;
}
const PRISTINE = findPristine();
const SKIP = PRISTINE ? false : "no unpatched OcuClaw backup found (set OCUCLAW_G2_PRISTINE_DIR)";

let tmpRoot;

function freshCopy(name) {
  const dir = path.join(tmpRoot, name);
  fs.cpSync(PRISTINE, dir, { recursive: true });
  return dir;
}

function snapshotTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === "node_modules") continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

before(() => {
  if (SKIP) return;
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocuclaw-g2-test-"));
});

after(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("pristine copy fails check with every point missing", { skip: SKIP }, () => {
  const dir = freshCopy("pristine");
  const res = checkPatches(dir);
  assert.deepEqual(res.missing.sort(), PATCH_POINTS.map((p) => p.name).concat("payload").sort());
});

test("apply then check passes, and apply again changes nothing", { skip: SKIP }, () => {
  const dir = freshCopy("apply-twice");
  const first = applyPatches(dir);
  assert.ok(first.changed.length > 0);
  assert.deepEqual(checkPatches(dir), { missing: [], stale: [] });
  const snap1 = snapshotTree(dir);
  const second = applyPatches(dir);
  assert.deepEqual(second.changed, []);
  assert.deepEqual(snapshotTree(dir), snap1);
});

test("hello hook is placed after the connect policy line", { skip: SKIP }, () => {
  const dir = freshCopy("hello");
  applyPatches(dir);
  const text = fs.readFileSync(path.join(dir, "dist/gateway/openclaw-client.js"), "utf8");
  assert.match(text, /this\._applyConnectPolicy\(helloOk\.policy\);\n\s*__ocuclawG2\.noteGatewayHello\(helloOk\);/);
});

test("patched modules still load", { skip: SKIP }, async () => {
  const dir = freshCopy("import");
  applyPatches(dir);
  for (const rel of [
    "dist/even-ai/even-ai-endpoint.js",
    "dist/gateway/openclaw-client.js",
    "dist/runtime/session-context-service.js",
    "dist/ocuclaw-g2/index.js",
  ]) {
    await import(pathToFileURL(path.join(dir, rel)).href);
  }
});

test("removing one hook makes check fail and name that point", { skip: SKIP }, () => {
  const dir = freshCopy("remove-hook");
  applyPatches(dir);
  const point = PATCH_POINTS.find((p) => p.name === "client-assistant-delta");
  const file = path.join(dir, point.file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  fs.writeFileSync(file, lines.filter((l) => !l.includes(`ocuclaw-g2:${point.name} `)).join("\n"));
  assert.deepEqual(checkPatches(dir).missing, ["client-assistant-delta"]);

  const r = spawnSync(process.execPath, [CLI, "check", "--plugin-dir", dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /client-assistant-delta/);
});

test("a missing anchor aborts the whole apply with no partial writes", { skip: SKIP }, () => {
  const dir = freshCopy("missing-anchor");
  const point = PATCH_POINTS.find((p) => p.name === "context-compaction-skip");
  const file = path.join(dir, point.file);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(point.anchor, "/* anchor gone */"));
  const before = snapshotTree(dir);
  assert.throws(() => applyPatches(dir), (err) => {
    assert.deepEqual(err.missingPoints, ["context-compaction-skip"]);
    return true;
  });
  assert.deepEqual(snapshotTree(dir), before);

  const r = spawnSync(process.execPath, [CLI, "apply", "--plugin-dir", dir], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /context-compaction-skip/);
  assert.deepEqual(snapshotTree(dir), before);
});

test("cli apply and check succeed on a clean copy", { skip: SKIP }, () => {
  const dir = freshCopy("cli");
  let r = spawnSync(process.execPath, [CLI, "apply", "--plugin-dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = spawnSync(process.execPath, [CLI, "check", "--plugin-dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = spawnSync(process.execPath, [CLI, "apply", "--plugin-dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already applied/);
});

test("a payload file that differs from the repo is stale, not missing (exit 5)", { skip: SKIP }, () => {
  const dir = freshCopy("stale-payload");
  applyPatches(dir);
  const file = path.join(dir, "dist/ocuclaw-g2/index.js");
  fs.appendFileSync(file, "\n// older build\n");
  assert.deepEqual(checkPatches(dir), { missing: [], stale: ["index.js"] });

  const r = spawnSync(process.execPath, [CLI, "check", "--plugin-dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 5, r.stdout + r.stderr);
  assert.match(r.stdout, /payload differs from repo/);
  assert.match(r.stdout, /^ {2}stale: index\.js$/m);
  assert.doesNotMatch(r.stdout, /missing:/);
});

test("an absent payload file is a missing payload (exit 3)", { skip: SKIP }, () => {
  const dir = freshCopy("absent-payload");
  applyPatches(dir);
  fs.rmSync(path.join(dir, "dist/ocuclaw-g2/index.js"));
  assert.deepEqual(checkPatches(dir).missing, ["payload"]);

  const r = spawnSync(process.execPath, [CLI, "check", "--plugin-dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}missing: payload$/m);
});

test("a missing hook wins over a stale payload (exit 3, both listed)", { skip: SKIP }, () => {
  const dir = freshCopy("missing-and-stale");
  applyPatches(dir);
  fs.appendFileSync(path.join(dir, "dist/ocuclaw-g2/index.js"), "\n// older build\n");
  const point = PATCH_POINTS.find((p) => p.name === "client-assistant-delta");
  const file = path.join(dir, point.file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  fs.writeFileSync(file, lines.filter((l) => !l.includes(`ocuclaw-g2:${point.name} `)).join("\n"));

  const r = spawnSync(process.execPath, [CLI, "check", "--plugin-dir", dir], { encoding: "utf8" });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /^ {2}missing: client-assistant-delta$/m);
  assert.match(r.stdout, /^ {2}stale: index\.js$/m);
});

test("apply on a missing plugin folder exits 2 and writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ocuclaw-g2-empty-"));
  try {
    const r = spawnSync(process.execPath, [CLI, "apply", "--plugin-dir", dir], { encoding: "utf8" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /not an OcuClaw plugin folder/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
