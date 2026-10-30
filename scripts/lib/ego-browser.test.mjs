// Unit tests for the pure helpers behind apply-ego-browser.
// Run: /opt/homebrew/opt/node/bin/node --test scripts/lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EGO_SKILL_ENABLED_PATH,
  parseJsonOutput,
  skillProblems,
  execProblems,
} from "./ego-browser.mjs";

const readySkill = {
  name: "ego-browser",
  source: "agents-skills-personal",
  disabled: false,
  blockedByAllowlist: false,
  blockedByAgentFilter: false,
  platformIncompatible: false,
  eligible: true,
  modelVisible: true,
};

function policy({ status = "allowed", security = "full", ask = "off", agentId = "main" } = {}) {
  return {
    effectivePolicy: {
      scopes: [{ scopeLabel: "tools.exec", configPath: "tools.exec", agentId, security: { effective: security }, ask: { effective: ask } }],
    },
    toolAccess: { agentId, local: { tools: [{ id: "exec", status }, { id: "process", status: "allowed" }] } },
  };
}

test("the owned config key is the skill's enabled flag", () => {
  assert.equal(EGO_SKILL_ENABLED_PATH, "skills.entries.ego-browser.enabled");
});

test("parseJsonOutput skips a banner line and rejects non-objects", () => {
  assert.deepEqual(parseJsonOutput('OpenClaw 2026.10.5\n{"a":1}', "x"), { a: 1 });
  assert.throws(() => parseJsonOutput("not json", "skills info"), /could not parse skills info output/);
  assert.throws(() => parseJsonOutput("[1]", "x"), /could not parse/);
  assert.throws(() => parseJsonOutput("", "x"), /could not parse/);
  assert.throws(() => parseJsonOutput(undefined, "x"), /could not parse/);
});

test("skillProblems is empty for a ready, model-visible skill", () => {
  assert.deepEqual(skillProblems(readySkill), []);
});

test("skillProblems reports a missing skill with the CLI's message", () => {
  const out = skillProblems({ ok: false, error: { message: 'Skill "ego-browser" not found.' } });
  assert.equal(out.length, 1);
  assert.match(out[0], /skill not found .*not found/);
});

test("skillProblems names each blocker", () => {
  const out = skillProblems({
    ...readySkill,
    disabled: true,
    blockedByAllowlist: true,
    blockedByAgentFilter: true,
    eligible: false,
    modelVisible: false,
  });
  assert.equal(out.length, 5);
  assert.match(out.join("\n"), /disabled \(skills\.entries\.ego-browser\.enabled/);
  assert.match(out.join("\n"), /agents\.entries\.main\.skills/);
  assert.match(out.join("\n"), /not visible to the model/);
});

test("skillProblems treats absent flags as problems (fail closed)", () => {
  assert.ok(skillProblems({ name: "ego-browser" }).length >= 5);
  assert.deepEqual(skillProblems(null), ["no skill info"]);
  assert.match(skillProblems({ ...readySkill, name: "other" })[0], /unexpected skill name/);
});

test("execProblems is empty when exec is allowed with security full and ask off", () => {
  assert.deepEqual(execProblems(policy()), []);
});

test("execProblems reports approval prompts, narrower security and denied exec", () => {
  assert.match(execProblems(policy({ ask: "on-miss" })).join("\n"), /asks for approval \(on-miss\)/);
  assert.match(execProblems(policy({ security: "allowlist" })).join("\n"), /security is allowlist/);
  assert.match(execProblems(policy({ status: "denied" })).join("\n"), /exec tool is denied/);
});

test("execProblems fails closed when the agent's scope is not reported", () => {
  const out = execProblems(policy({ agentId: "other" }));
  assert.equal(out.length, 2);
  assert.deepEqual(execProblems({}), [
    "exec tool access for agent main not reported",
    "exec policy for agent main not reported",
  ]);
  assert.deepEqual(execProblems(null), ["no exec policy"]);
});

test("execProblems checks the agent's own tools.exec scope, not only the global one", () => {
  const p = policy();
  p.effectivePolicy.scopes.push({
    scopeLabel: "agent:main",
    configPath: "agents.entries.main.tools.exec",
    agentId: "main",
    security: { effective: "full" },
    ask: { effective: "always" },
  });
  assert.deepEqual(execProblems(p), ["agent:main: exec asks for approval (always)"]);
});
