#!/bin/sh
# Public-safety scan over the whole git history (every blob reachable from any ref,
# commit messages) plus the working tree. Exit 0 = clean, 1 = findings, 2 = cannot scan.
#   - no tailnet hostnames or tailnet IPs (CGNAT 100.64/10 range)
#   - no Soniox / opencodex keys or bearer-looking tokens
#   - no email addresses (only GitHub noreply and the Claude co-author noreply are allowed)
#   - no 64-hex strings (paired phone node ids look like this)
#   - commit metadata: author/committer emails must end in @users.noreply.github.com
#   - no .dryforge/ path ever tracked
#   - no copied OcuClaw source: no file byte-identical to, or sharing more than
#     3 consecutive (non-trivial) lines with, any file under the installed
#     OcuClaw dist (our own injected copies in dist/ocuclaw-g2 are skipped)
# Usage: scripts/public-safety-scan.sh [--ocuclaw-dist DIR]
# Findings print the file and the rule only, never the matched value.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
DIST="$HOME/.openclaw/extensions/ocuclaw/dist"
if [ "${1:-}" = "--ocuclaw-dist" ]; then DIST=${2:?missing DIR}; fi

exec "$NODE" --input-type=module - "$ROOT" "$DIST" <<'EOF'
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const [root, dist] = process.argv.slice(2);
const git = (args, opts = {}) =>
  execFileSync("git", ["-C", root, ...args], { maxBuffer: 1 << 30, ...opts });

// Patterns are assembled so this file does not match itself.
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
const EMAIL_ALLOW = (e) => e.toLowerCase().endsWith(NOREPLY) || e.toLowerCase() === "noreply" + "@anthropic.com";
const hasEmail = (text) => (text.match(EMAIL) || []).some((e) => !EMAIL_ALLOW(e));
const matchRules = (text) => {
  const hits = RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
  if (hasEmail(text)) hits.push("email address");
  return hits;
};

const findings = [];
const report = (where, rule) => findings.push(`${where}: ${rule}`);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// --- reference: OcuClaw dist (excluding our payload copies) ---
if (!fs.existsSync(dist)) {
  console.error(`cannot scan: OcuClaw dist not found: ${dist}`);
  process.exit(2);
}
const WINDOW = 4; // "more than 3 consecutive lines"
const MIN_WINDOW_CHARS = 40; // skip windows of braces/blank-ish lines
const norm = (text) => text.split(/\r?\n/).map((l) => l.trim());
function windows(lines) {
  const out = [];
  for (let i = 0; i + WINDOW <= lines.length; i += 1) {
    const w = lines.slice(i, i + WINDOW);
    if (w.some((l) => l === "")) continue;
    if (w.join("").replace(/\s/g, "").length < MIN_WINDOW_CHARS) continue;
    out.push([i + 1, w.join("\n")]);
  }
  return out;
}
const refHashes = new Map();
const refWindows = new Map();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (path.relative(dist, p) === "ocuclaw-g2") continue;
      walk(p);
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
walk(dist);

function scanContent(where, buf) {
  const text = buf.toString("utf8");
  for (const name of matchRules(text)) report(where, name);
  const h = sha(buf);
  if (buf.length > 0 && refHashes.has(h)) report(where, `byte-identical to OcuClaw dist/${refHashes.get(h)}`);
  for (const [line, w] of windows(norm(text))) {
    if (refWindows.has(w)) {
      report(where, `line ${line}: ${WINDOW}+ consecutive lines copied from OcuClaw dist/${refWindows.get(w)}`);
      break;
    }
  }
}

// --- git history: every blob reachable from any ref ---
const objs = git(["rev-list", "--objects", "--all"]).toString().trim().split("\n").filter(Boolean);
const blobPaths = new Map();
const allPaths = new Set();
{
  const ids = objs.map((l) => l.split(" ")[0]);
  const types = git(["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: ids.join("\n") + "\n" })
    .toString().trim().split("\n");
  const typeOf = new Map(types.map((l) => l.split(" ")));
  for (const l of objs) {
    const sp = l.indexOf(" ");
    const id = sp < 0 ? l : l.slice(0, sp);
    const p = sp < 0 ? "" : l.slice(sp + 1);
    if (p) allPaths.add(p);
    if (typeOf.get(id) === "blob" && !blobPaths.has(id)) blobPaths.set(id, p || "(unnamed)");
  }
}
for (const p of git(["log", "--all", "--format=", "--name-only"]).toString().split("\n")) if (p) allPaths.add(p);
for (const p of allPaths) {
  if (p === ".dryforge" || p.startsWith(".dryforge/") || p.includes("/.dryforge/")) report(`history path ${p}`, ".dryforge tracked");
}
for (const [id, p] of blobPaths) {
  scanContent(`history ${p} (${id.slice(0, 10)})`, git(["cat-file", "blob", id]));
}

// --- commit messages ---
const msgs = git(["log", "--all", "--format=%H%x00%B%x01"]).toString().split("\x01");
for (const m of msgs) {
  const [hash, body = ""] = m.trim().split("\0");
  if (!hash) continue;
  for (const name of matchRules(body)) report(`commit message ${hash.slice(0, 10)}`, name);
}

// --- commit metadata: author / committer emails ---
for (const line of git(["log", "--all", "--format=%H%x00%ae%x00%ce"]).toString().split("\n")) {
  const [hash, ae = "", ce = ""] = line.split("\0");
  if (!hash) continue;
  if (!ae.toLowerCase().endsWith(NOREPLY)) report(`commit metadata ${hash.slice(0, 10)}`, "author email is not a GitHub noreply address");
  if (!ce.toLowerCase().endsWith(NOREPLY)) report(`commit metadata ${hash.slice(0, 10)}`, "committer email is not a GitHub noreply address");
}

// --- working tree: tracked + untracked (not ignored) ---
const tree = git(["ls-files", "-co", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
for (const p of tree) {
  if (p.startsWith(".dryforge/")) report(`working tree ${p}`, ".dryforge tracked");
  const full = path.join(root, p);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) scanContent(`working tree ${p}`, fs.readFileSync(full));
}

console.log(`scanned ${blobPaths.size} history blobs, ${msgs.length - 1} commit messages, ${tree.length} working-tree files; reference ${refHashes.size} OcuClaw dist files`);
if (findings.length) {
  for (const f of [...new Set(findings)]) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log("public-safety-scan: clean");
EOF
