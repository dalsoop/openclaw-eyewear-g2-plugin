// Pure helpers for attaching ego lite to the agent as its web tool
// (decision 0009): the `ego-browser` skill that ego lite ships, run through
// the agent's exec tool without approval prompts. No I/O here so the logic
// can be unit tested with `node --test scripts/lib/`.

export const AGENT_ID = "main";
export const EGO_SKILL = "ego-browser";
// The one config key this repo owns for the web tool. The skill is found on
// its own (personal agent skills), so detaching needs `false`, not unset.
export const EGO_SKILL_ENABLED_PATH = `skills.entries.${EGO_SKILL}.enabled`;

// Parse CLI JSON output that may carry a banner line before the object.
export function parseJsonOutput(text, what) {
  const start = typeof text === "string" ? text.indexOf("{") : -1;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start));
  } catch {
    throw new Error(`could not parse ${what} output`);
  }
  if (start < 0 || parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`could not parse ${what} output`);
  }
  return parsed;
}

// `openclaw skills info ego-browser --agent main --json` -> list of problems
// that keep the model from seeing or using the skill (empty = attached).
export function skillProblems(info) {
  if (!info || typeof info !== "object") return ["no skill info"];
  if (info.ok === false) return [`skill not found (${info.error?.message || "unknown error"})`];
  const problems = [];
  if (info.name !== EGO_SKILL) problems.push(`unexpected skill name ${JSON.stringify(info.name)}`);
  if (info.disabled !== false) problems.push(`disabled (${EGO_SKILL_ENABLED_PATH} is not true)`);
  if (info.blockedByAllowlist !== false) problems.push("blocked by the skill allowlist");
  if (info.blockedByAgentFilter !== false) problems.push(`blocked by agents.entries.${AGENT_ID}.skills`);
  if (info.platformIncompatible !== false) problems.push("platform incompatible");
  if (info.eligible !== true) problems.push("not eligible (missing requirements)");
  if (info.modelVisible !== true) problems.push("not visible to the model");
  return problems;
}

// `openclaw exec-policy show --agent main --json` -> problems that would stop
// `ego-browser nodejs` from running without a confirmation (empty = runs
// without prompts, the approval scope decision 0009 keeps from 0005).
export function execProblems(policy, agentId = AGENT_ID) {
  if (!policy || typeof policy !== "object") return ["no exec policy"];
  const problems = [];
  const tools = policy.toolAccess?.agentId === agentId ? policy.toolAccess.local?.tools : undefined;
  const exec = Array.isArray(tools) ? tools.find((t) => t && t.id === "exec") : undefined;
  if (!exec) problems.push(`exec tool access for agent ${agentId} not reported`);
  else if (exec.status !== "allowed") problems.push(`exec tool is ${exec.status}`);
  const scopes = Array.isArray(policy.effectivePolicy?.scopes) ? policy.effectivePolicy.scopes : [];
  const scope = scopes.find((s) => s && s.agentId === agentId && s.configPath === "tools.exec");
  if (!scope) {
    problems.push(`tools.exec policy for agent ${agentId} not reported`);
  } else {
    if (scope.security?.effective !== "full") problems.push(`exec security is ${scope.security?.effective ?? "unknown"}, not full`);
    if (scope.ask?.effective !== "off") problems.push(`exec asks for approval (${scope.ask?.effective ?? "unknown"})`);
  }
  return problems;
}
