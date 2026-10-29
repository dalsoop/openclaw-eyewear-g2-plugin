import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "./public-safety-scan.mjs";

const cli = fileURLToPath(new URL("./public-safety-scan.mjs", import.meta.url));
const privateEmail = "fixture" + "@" + "example.invalid";
const safeEmail = "fixture" + "@users.noreply.github.com";
const token = "sn" + "x_" + "fixtureOnlyNotARealKey";
function fixture(t, unsafeBase = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-safety-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "repo");
  const dist = path.join(dir, "dist");
  fs.mkdirSync(root);
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, "reference.js"), "synthetic reference, not installed source\n");
  const git = (...args) => execFileSync("git", ["-C", root, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_COMMITTER_NAME: "Fixture", GIT_AUTHOR_EMAIL: safeEmail, GIT_COMMITTER_EMAIL: safeEmail, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull },
  }).toString().trim();
  git("init", "-b", "main");
  fs.writeFileSync(path.join(root, "safe.txt"), "safe\n");
  git("add", "safe.txt");
  if (unsafeBase) {
    git("-c", `user.email=${privateEmail}`, "commit", "--author", `Fixture <${privateEmail}>`, "-m", "Base");
  } else git("commit", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", base);
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs/public-safety-baseline.json"), JSON.stringify({ findings: [] }));
  const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); };
  const commit = (message = "Change") => { git("add", "."); git("commit", "-m", message); return git("rev-parse", "HEAD"); };
  return { root, dist, git, base, write, commit, run: (opts = {}) => scan({ root, dist, ...opts }) };
}

test("PR scope excludes inherited bad metadata while all mode reports it", (t) => {
  const f = fixture(t, true);
  f.write("new.txt", "new safe file\n"); f.commit();
  assert.deepEqual(f.run().findings, []);
  assert(f.run({ mode: "all" }).findings.some((x) => x.rule.startsWith("author email")));
});
test("new commit metadata is not exempted", (t) => {
  const f = fixture(t);
  f.write("new.txt", "safe"); f.git("add", ".");
  f.git("commit", "--author", `Fixture <${privateEmail}>`, "-m", "Change");
  assert(f.run().findings.some((x) => x.rule.startsWith("author email")));
});
test("new commit messages are scanned without leaking the matched value", (t) => {
  const f = fixture(t); f.commit(`Change ${token}`);
  const findings = f.run().findings;
  assert(findings.some((x) => x.where.startsWith("commit message") && x.rule === "Soniox key"));
  assert(!JSON.stringify(findings).includes(token));
});
test("intermediate added-then-deleted secrets remain in the PR gate", (t) => {
  const f = fixture(t); f.write("temporary.txt", token); f.commit();
  fs.unlinkSync(path.join(f.root, "temporary.txt")); f.commit("Delete temporary file");
  assert(f.run().findings.some((x) => x.where.startsWith("history") && x.rule === "Soniox key"));
});
test("reintroduced inherited blobs are scanned even when removed again", (t) => {
  const f = fixture(t); f.write("old.txt", token); f.commit("Historical content");
  fs.unlinkSync(path.join(f.root, "old.txt")); f.commit("Remove historical content");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.write("reintroduced.txt", token); f.commit("Reintroduce old blob");
  fs.unlinkSync(path.join(f.root, "reintroduced.txt")); f.commit("Remove reintroduced blob");
  assert(f.run().findings.some((x) => x.where.startsWith("history") && x.rule === "Soniox key"));
});
test("merge-base scope excludes new base commits on a diverged branch", (t) => {
  const f = fixture(t); f.git("switch", "-c", "topic"); f.write("topic.txt", "safe"); f.commit();
  f.git("switch", "main"); f.write("base-only.txt", token); f.commit();
  f.git("update-ref", "refs/remotes/origin/main", "HEAD"); f.git("switch", "topic");
  assert.deepEqual(f.run().findings, []);
});
test("unknown refs and unrelated histories fail closed", (t) => {
  const f = fixture(t);
  assert.throws(() => f.run({ base: "missing-ref" }));
  assert.throws(() => f.run({ head: "missing-ref" }));
  f.git("switch", "--orphan", "unrelated"); f.write("other.txt", "safe"); f.commit();
  assert.throws(() => f.run());
});
test("dirty working tree and untracked files are scanned", (t) => {
  const f = fixture(t); f.write("safe.txt", privateEmail); f.write("untracked.txt", token);
  const findings = f.run().findings;
  assert(findings.some((x) => x.where === "working tree safe.txt" && x.rule === "email address"));
  assert(findings.some((x) => x.where === "working tree untracked.txt" && x.rule === "Soniox key"));
});
test("staged secrets remain blocked after working tree content is cleaned", (t) => {
  const f = fixture(t); f.write("safe.txt", token); f.git("add", "safe.txt"); f.write("safe.txt", "safe again");
  assert(f.run().findings.some((x) => x.where === "index safe.txt" && x.rule === "Soniox key"));
});
test("forbidden paths reusing inherited blobs are blocked", (t) => {
  const f = fixture(t); f.write("nested/.dryforge/copy.txt", "safe\n"); f.commit();
  assert(f.run().findings.some((x) => x.where.startsWith("history path") && x.rule === ".dryforge tracked"));
});
test("OcuClaw exact and consecutive-line copies are still blocked", (t) => {
  const f = fixture(t);
  const reference = ["synthetic reference statement alpha", "synthetic reference statement beta", "synthetic reference statement gamma", "synthetic reference statement delta"].join("\n");
  fs.writeFileSync(path.join(f.dist, "reference.js"), reference);
  f.write("exact.txt", reference); f.write("window.txt", `prefix\n${reference}\nsuffix`);
  const findings = f.run().findings;
  assert(findings.some((x) => x.rule.startsWith("byte-identical")));
  assert(findings.some((x) => x.rule.includes("consecutive lines")));
});
test("missing and empty reference directories are not clean", (t) => {
  const f = fixture(t); assert.throws(() => f.run({ dist: path.join(f.root, "missing") }));
  fs.unlinkSync(path.join(f.dist, "reference.js")); assert.throws(() => f.run());
});
test("all refs audit includes findings on non-head branches", (t) => {
  const f = fixture(t); f.git("switch", "-c", "other"); f.write("other.txt", token); f.commit(); f.git("switch", "main");
  assert.deepEqual(f.run().findings, []);
  assert(f.run({ mode: "all" }).findings.some((x) => x.rule === "Soniox key"));
});
test("baseline labels but never exempts a full audit finding", (t) => {
  const f = fixture(t, true);
  f.write("docs/public-safety-baseline.json", JSON.stringify({ findings: [{ commit: f.base, rule: "author email is not a GitHub noreply address" }] }));
  const out = spawnSync(process.execPath, [cli, f.root, "--all", "--ocuclaw-dist", f.dist], { encoding: "utf8" });
  assert.equal(out.status, 1); assert.match(out.stdout, /FAIL .*known baseline/); assert(!out.stdout.includes(privateEmail));
});
test("all mode scans blobs targeted directly by tags", (t) => {
  const f = fixture(t); f.write("direct-blob.txt", token);
  const blob = f.git("hash-object", "-w", "direct-blob.txt");
  fs.unlinkSync(path.join(f.root, "direct-blob.txt")); f.git("tag", "direct-blob", blob);
  assert.deepEqual(f.run().findings, []);
  assert(f.run({ mode: "all" }).findings.some((x) => x.rule === "Soniox key"));
});
test("replace refs cannot hide the original commit message", (t) => {
  const f = fixture(t); const original = f.commit(`Change ${token}`);
  const replacement = f.git("commit-tree", "HEAD^{tree}", "-p", f.base, "-m", "Safe replacement");
  f.git("replace", original, replacement);
  for (const mode of ["pr", "all"]) {
    assert(f.run({ mode }).findings.some((x) => x.where.startsWith("commit message") && x.rule === "Soniox key"));
  }
});
test("shallow side-parent histories fail closed despite a valid merge base", (t) => {
  const f = fixture(t); f.git("switch", "-c", "side"); f.commit(`Intermediate ${token}`);
  f.write("side.txt", "safe"); const boundary = f.commit("Clean side tip");
  f.git("switch", "main"); f.git("merge", "--no-ff", "side", "-m", "Merge side");
  assert(f.run().findings.some((x) => x.rule === "Soniox key"));
  fs.writeFileSync(path.resolve(f.root, f.git("rev-parse", "--git-path", "shallow")), boundary + "\n");
  assert(f.git("merge-base", "origin/main", "HEAD"));
  for (const mode of ["pr", "all"]) {
    assert.throws(() => f.run({ mode }));
    const out = spawnSync(process.execPath, [cli, f.root, ...(mode === "all" ? ["--all"] : []), "--ocuclaw-dist", f.dist], { encoding: "utf8" });
    assert.equal(out.status, 2); assert.doesNotMatch(out.stdout, /public-safety-scan: clean/);
  }
});
test("legacy graft files fail closed", (t) => {
  const f = fixture(t);
  const graft = path.resolve(f.root, f.git("rev-parse", "--git-path", "info/grafts"));
  fs.mkdirSync(path.dirname(graft), { recursive: true }); fs.writeFileSync(graft, "");
  for (const mode of ["pr", "all"]) assert.throws(() => f.run({ mode }));
});
test("CLI modes and invalid arguments have explicit exit codes", (t) => {
  const f = fixture(t);
  const run = (...args) => spawnSync(process.execPath, [cli, f.root, ...args], { encoding: "utf8" });
  const clean = run("--base", "origin/main", "--head", "HEAD", "--ocuclaw-dist", f.dist);
  assert.equal(clean.status, 0); assert.match(clean.stdout, /public-safety-scan: clean/);
  for (const args of [["--base"], ["--base", "missing"], ["--unknown"], ["--all", "--head", "HEAD"], ["--ocuclaw-dist", "missing"]]) {
    const out = run(...args); assert.equal(out.status, 2); assert.doesNotMatch(out.stdout, /public-safety-scan: clean/);
  }
});
