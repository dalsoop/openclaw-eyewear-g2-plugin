#!/usr/bin/env node
// Attach ego lite (the agent browser, its logged-in default profile) to the
// agent as its web tool: the `ego-browser` skill that ego lite ships, run
// through the agent's exec tool without approval prompts (decision 0009).
// Sets the one key this repo owns, skills.entries.ego-browser.enabled=true,
// then checks that the skill is visible to the agent and that exec runs
// without approval prompts. These checks do not run a browser as the agent;
// docs/operations.md says how to confirm that. Back up first with
// scripts/backup.sh. Safe to re-run.
//
// Usage: node scripts/apply-ego-browser.mjs [--check | --restart]
//   --check    verify only, write nothing
//   --restart  after all checks pass, restart the gateway and wait for
//              "Connectivity check: ok" (120 s). Sessions snapshot their skill
//              list when they start, so open sessions (the glasses session
//              too) only see a change after a restart.
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
const known = new Set(["--check", "--restart"]);
if (args.some((a) => !known.has(a)) || (args.includes("--check") && args.includes("--restart"))) {
  console.error("usage: node scripts/apply-ego-browser.mjs [--check | --restart]");
  process.exit(64);
}
const checkOnly = args.includes("--check");
const restart = args.includes("--restart");

let failed = 0;
function report(name, problems, okDetail) {
  const ok = problems.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? (okDetail ? `: ${okDetail}` : "") : `: ${problems.join("; ")}`}`);
}
// Run a CLI with a time limit; a non-zero exit still hands back stdout
// (openclaw prints JSON errors there).
function run(cmd, argv, timeout = 60_000) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout });
  return {
    ok: !r.error && r.status === 0,
    status: r.error ? r.error.code || "error" : r.status,
    out: r.stdout || "",
    err: String(r.stderr || r.error?.message || "").trim(),
  };
}
function firstLine(text) {
  return String(text).trim().split("\n")[0].trim();
}
// Parse JSON output. A non-zero exit fails the check unless the CLI reported
// the failure itself as {"ok": false, ...} (handled by the caller's judge).
function json(res, what) {
  let parsed;
  try {
    parsed = parseJsonOutput(res.out, what);
  } catch (err) {
    return { problem: `${err.message}${res.ok ? "" : ` (exit ${res.status}: ${firstLine(res.err)})`}` };
  }
  if (!res.ok && parsed.ok !== false) return { problem: `${what} exited ${res.status}` };
  return { parsed };
}

// 1. ego lite's CLI runs. It prints its version to stderr. This shows the
//    command exists at EGO_BROWSER, not that the agent's PATH finds it or that
//    the profile is signed in.
const ego = run(EGO_BROWSER, ["--version"]);
report("ego-browser", ego.ok ? [] : [`cannot run ${EGO_BROWSER} --version (install ego lite and finish onboarding)`],
  firstLine(`${ego.out}\n${ego.err}`));

// 2. The owned key. Re-setting the same value is harmless.
if (!checkOnly) {
  const set = run(OPENCLAW, ["config", "set", EGO_SKILL_ENABLED_PATH, "true", "--strict-json"]);
  report(`set ${EGO_SKILL_ENABLED_PATH}`, set.ok ? [] : [firstLine(set.err) || `config set exited ${set.status}`], "true");
}

// 3. The agent sees the skill (found, enabled, not filtered, visible to the model).
const info = json(run(OPENCLAW, ["skills", "info", EGO_SKILL, "--agent", AGENT_ID, "--json"]), "`openclaw skills info`");
report(`skill ${EGO_SKILL} for agent ${AGENT_ID}`, info.problem ? [info.problem] : skillProblems(info.parsed),
  `visible, source ${info.parsed?.source}`);

// 4. The agent's exec tool runs commands without approval prompts.
const policy = json(run(OPENCLAW, ["exec-policy", "show", "--agent", AGENT_ID, "--json"]), "`openclaw exec-policy show`");
report("exec without approval prompts", policy.problem ? [policy.problem] : execProblems(policy.parsed),
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

if (restart) {
  // OpenClaw's own restart health wait is 60 s plus the launchd drain.
  const r = run(OPENCLAW, ["gateway", "restart"], 150_000);
  process.stdout.write(r.out);
  if (!r.ok) {
    console.error(`gateway restart exited ${r.status}: ${firstLine(r.err)}`);
    process.exit(1);
  }
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (/Connectivity check: ok/.test(run(OPENCLAW, ["gateway", "status"]).out)) {
      console.log("gateway: Connectivity check: ok");
      break;
    }
    if (Date.now() > deadline) {
      console.error("gateway did not report Connectivity check: ok within 120s");
      process.exit(1);
    }
    spawnSync("/bin/sleep", ["2"]);
  }
}
