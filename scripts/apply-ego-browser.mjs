#!/usr/bin/env node
// Attach ego lite (the agent browser, its logged-in default profile) to the
// agent as its web tool: the `ego-browser` skill that ego lite ships, run
// through the agent's exec tool without approval prompts (decision 0009).
// Sets the one key this repo owns, skills.entries.ego-browser.enabled=true
// (skills hot-apply, no gateway restart), then checks that the agent can use
// the tool. Back up first with scripts/backup.sh. Safe to re-run.
//
// Usage: node scripts/apply-ego-browser.mjs [--check]
//   --check  verify only, write nothing
// Prints `PASS|FAIL <name>: <detail>` per check; exit 0 only if all pass.
import { spawnSync } from "node:child_process";
import {
  AGENT_ID,
  EGO_SKILL,
  EGO_SKILL_ENABLED_PATH,
  execProblems,
  parseJsonOutput,
  skillProblems,
} from "./lib/ego-browser.mjs";

const HOME = process.env.HOME;
const OPENCLAW = process.env.OPENCLAW || `${HOME}/.local/bin/openclaw`;
const EGO_BROWSER = process.env.EGO_BROWSER || `${HOME}/.local/bin/ego-browser`;
const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--check");
if (unknown.length) {
  console.error("usage: node scripts/apply-ego-browser.mjs [--check]");
  process.exit(64);
}
const checkOnly = args.includes("--check");

let failed = 0;
function report(name, problems, okDetail) {
  const ok = problems.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? (okDetail ? `: ${okDetail}` : "") : `: ${problems.join("; ")}`}`);
}
// Run a CLI; a non-zero exit still hands back stdout (openclaw prints JSON errors there).
function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    ok: !r.error && r.status === 0,
    out: r.stdout || "",
    err: String(r.stderr || r.error?.message || "").trim(),
  };
}
function json(res, what) {
  try {
    return parseJsonOutput(res.out, what);
  } catch (err) {
    return { parseError: `${err.message}${res.ok ? "" : ` (${res.err.split("\n")[0]})`}` };
  }
}

// 1. ego lite's CLI runs (ego lite installed and onboarded). It prints its
//    version to stderr.
const ego = run(EGO_BROWSER, ["--version"]);
report("ego-browser", ego.ok ? [] : [`cannot run ${EGO_BROWSER} --version (install ego lite and finish onboarding)`],
  `${ego.out}\n${ego.err}`.trim().split("\n")[0].trim());

// 2. The owned key. Re-setting the same value is harmless.
if (!checkOnly) {
  const set = run(OPENCLAW, ["config", "set", EGO_SKILL_ENABLED_PATH, "true", "--strict-json"]);
  report(`set ${EGO_SKILL_ENABLED_PATH}`, set.ok ? [] : [set.err.split("\n")[0] || "config set failed"], "true");
}

// 3. The agent sees the skill (found, enabled, not filtered, visible to the model).
const info = json(run(OPENCLAW, ["skills", "info", EGO_SKILL, "--agent", AGENT_ID, "--json"]), "`openclaw skills info`");
report(`skill ${EGO_SKILL} for agent ${AGENT_ID}`, info.parseError ? [info.parseError] : skillProblems(info),
  `visible, source ${info.source}`);

// 4. The agent's exec tool runs `ego-browser nodejs` without approval prompts.
const policy = json(run(OPENCLAW, ["exec-policy", "show", "--agent", AGENT_ID, "--json"]), "`openclaw exec-policy show`");
report("exec without approval prompts", policy.parseError ? [policy.parseError] : execProblems(policy),
  "security full, ask off");

// 5. One browser: the built-in OpenClaw browser stays off.
const builtin = run(OPENCLAW, ["config", "get", "browser.enabled"]);
report("built-in browser off", builtin.ok && builtin.out.trim() === "false" ? [] : ["browser.enabled is not false (run scripts/apply-memory.sh)"],
  "browser.enabled=false");

if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
