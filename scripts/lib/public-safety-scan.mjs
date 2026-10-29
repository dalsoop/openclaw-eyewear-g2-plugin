import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// Assemble patterns so the scanner and its tests do not match themselves.
const RULES = [
  ["tailnet hostname", new RegExp("\\bts" + "\\.net\\b", "i")],
  ["tailnet IP (100.64/10)", new RegExp("\\b10" + "0\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.\\d{1,3}\\.\\d{1,3}\\b")],
  ["Soniox key", new RegExp("\\bsn" + "x_[A-Za-z0-9]{8,}")],
  ["opencodex key", new RegExp("\\boc" + "x_data_[A-Za-z0-9]{6,}")],
  ["bearer token", new RegExp("\\bBear" + "er\\s+[A-Za-z0-9._~+/=-]{20,}")],
  ["private key block", new RegExp("-----BEGIN [A-Z ]*PRIV" + "ATE KEY-----")],
  ["64-hex id (node id?)", new RegExp("\\b[0-9a-fA-F]{6" + "4}\\b")],
];
const EMAIL = new RegExp("[A-Za-z0-9._%+-]+" + "@" + "[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}", "g");
const NOREPLY = "@users.noreply." + "github.com";
const emailAllowed = (email) => email.toLowerCase().endsWith(NOREPLY) || email.toLowerCase() === "noreply" + "@anthropic.com";
const matchRules = (text) => {
  const hits = RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
  if ((text.match(EMAIL) || []).some((email) => !emailAllowed(email))) hits.push("email address");
  return hits;
};
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const norm = (text) => text.split(/\r?\n/).map((line) => line.trim());
function windows(lines) {
  const out = [];
  for (let i = 0; i + 4 <= lines.length; i += 1) {
    const w = lines.slice(i, i + 4);
    if (w.some((line) => line === "") || w.join("").replace(/\s/g, "").length < 40) continue;
    out.push([i + 1, w.join("\n")]);
  }
  return out;
}
const forbiddenPath = (p) => p.split("/").includes(".dryforge");

export function scan({ root, dist, mode = "pr", base = "origin/main", head = "HEAD" }) {
  const git = (args, opts = {}) => execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"], ...opts,
  });
  const resolve = (ref) => git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).toString().trim();
  if (mode !== "pr" && mode !== "all") throw new Error("invalid mode");
  // Fail closed on an unknown base/head or an unrelated history; never fall back to all/empty.
  const headOid = resolve(head);
  const mergeBase = mode === "pr" ? git(["merge-base", resolve(base), headOid]).toString().trim() : null;
  const revisions = mode === "all" ? ["--all"] : [headOid, `^${mergeBase}`];
  const findings = [];
  const report = (where, rule, commit = null) => findings.push({ where, rule, commit });
  const refHashes = new Map();
  const refWindows = new Map();
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (path.relative(dist, p) !== "ocuclaw-g2") walk(p);
      } else if (e.isFile()) {
        const buf = fs.readFileSync(p);
        const rel = path.relative(dist, p);
        refHashes.set(sha(buf), rel);
        for (const [, w] of windows(norm(buf.toString("utf8")))) {
          if (!refWindows.has(w)) refWindows.set(w, rel);
        }
      }
    }
  }
  if (!fs.statSync(dist).isDirectory()) throw new Error("invalid reference directory");
  walk(dist);
  if (!refHashes.size) throw new Error("empty reference directory");
  function scanContent(where, buf) {
    const text = buf.toString("utf8");
    for (const rule of matchRules(text)) report(where, rule);
    if (buf.length && refHashes.has(sha(buf))) report(where, `byte-identical to OcuClaw dist/${refHashes.get(sha(buf))}`);
    for (const [line, w] of windows(norm(text))) {
      if (refWindows.has(w)) {
        report(where, `line ${line}: 4+ consecutive lines copied from OcuClaw dist/${refWindows.get(w)}`);
        break;
      }
    }
  }

  const blobPaths = new Map();
  const commits = git(["rev-list", ...revisions]).toString().trim().split("\n").filter(Boolean);
  for (const commit of commits) {
    // Inspect additions/modifications against every parent, not only new object IDs.
    // A PR can reintroduce an old base blob and delete it again before HEAD.
    const changes = git(["diff-tree", "--root", "--no-commit-id", "--raw", "--no-abbrev", "-r", "-m", "-z", "--no-renames", commit]).toString().split("\0").filter(Boolean);
    for (let i = 0; i < changes.length; i += 2) {
      const [, newMode, , newId] = changes[i].split(" ");
      const p = changes[i + 1];
      if (!p || !newId) throw new Error("invalid diff output");
      if (newMode === "000000") continue;
      if (newMode === "160000") throw new Error("submodule cannot be scanned");
      blobPaths.set(newId, p);
    }
    // Check each commit's full path tree too: reusing a base blob under a forbidden name is unsafe.
    for (const p of git(["ls-tree", "-rz", "--name-only", commit]).toString().split("\0").filter(Boolean)) {
      if (forbiddenPath(p)) report(`history path ${p}`, ".dryforge tracked");
    }
    const body = git(["show", "-s", "--format=%B", commit]).toString();
    for (const rule of matchRules(body)) report(`commit message ${commit.slice(0, 10)}`, rule, commit);
    const [ae, ce] = git(["show", "-s", "--format=%ae%x00%ce", commit]).toString().trim().split("\0");
    if (!ae.toLowerCase().endsWith(NOREPLY)) report(`commit metadata ${commit.slice(0, 10)}`, "author email is not a GitHub noreply address", commit);
    if (!ce.toLowerCase().endsWith(NOREPLY)) report(`commit metadata ${commit.slice(0, 10)}`, "committer email is not a GitHub noreply address", commit);
  }
  for (const [id, p] of blobPaths) scanContent(`history ${p} (${id.slice(0, 10)})`, git(["cat-file", "blob", id]));

  // Index and working tree remain part of the gate, including untracked non-ignored files.
  for (const entry of git(["ls-files", "--stage", "-z"]).toString().split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const [fileMode, id, stage] = entry.slice(0, tab).split(" ");
    const p = entry.slice(tab + 1);
    if (stage !== "0" || fileMode === "160000") throw new Error("unmerged index or submodule cannot be scanned");
    if (forbiddenPath(p)) report(`index ${p}`, ".dryforge tracked");
    scanContent(`index ${p}`, git(["cat-file", "blob", id]));
  }
  const tree = [...new Set(git(["ls-files", "-co", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean))];
  for (const p of tree) {
    if (forbiddenPath(p)) report(`working tree ${p}`, ".dryforge tracked");
    const full = path.join(root, p);
    let stat;
    try { stat = fs.lstatSync(full); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) scanContent(`working tree ${p}`, Buffer.from(fs.readlinkSync(full)));
    else if (stat.isFile()) scanContent(`working tree ${p}`, fs.readFileSync(full));
    else throw new Error("unsupported working-tree entry");
  }
  return { findings, mode, mergeBase, headOid, blobs: blobPaths.size, commits: commits.length, files: tree.length, references: refHashes.size };
}

export function main(args) {
  const [root, ...flags] = args;
  const options = { root, dist: path.join(homedir(), ".openclaw/extensions/ocuclaw/dist") };
  let scopeSet = false;
  try {
    for (let i = 0; i < flags.length; i += 1) {
      const flag = flags[i];
      if (flag === "--all") {
        if (scopeSet) throw new Error("conflicting modes");
        options.mode = "all";
        scopeSet = true;
      } else if (["--base", "--head", "--ocuclaw-dist"].includes(flag)) {
        if (!flags[i + 1] || flags[i + 1].startsWith("--")) throw new Error("missing value");
        const key = { "--base": "base", "--head": "head", "--ocuclaw-dist": "dist" }[flag];
        if (Object.hasOwn(options, key) && key !== "dist") throw new Error("duplicate option");
        options[key] = flags[++i];
      } else throw new Error("unknown option");
    }
    if (options.mode === "all" && (options.base || options.head)) throw new Error("conflicting modes");
    const result = scan(options);
    console.log(`scope ${result.mode}${result.mergeBase ? ` ${result.mergeBase}...${result.headOid}` : " all refs"}; scanned ${result.blobs} history blobs, ${result.commits} commits, ${result.files} working-tree files; reference ${result.references} OcuClaw dist files`);
    // The baseline only labels full-audit findings. It never exempts or suppresses anything.
    let known = [];
    if (result.mode === "all") {
      known = JSON.parse(fs.readFileSync(path.join(root, "docs/public-safety-baseline.json"), "utf8")).findings;
      if (!Array.isArray(known)) throw new Error("invalid baseline");
    }
    for (const finding of result.findings) {
      const label = known.some((item) => item.commit === finding.commit && item.rule === finding.rule) ? " (known baseline)" : "";
      console.log(`FAIL ${finding.where}: ${finding.rule}${label}`);
    }
    if (result.findings.length) return 1;
    console.log("public-safety-scan: clean");
    return 0;
  } catch {
    // Do not echo git stderr, arbitrary arguments, file contents, or secret-bearing values.
    console.error("cannot scan: check arguments, git refs/index, baseline (all mode), and OcuClaw dist");
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
