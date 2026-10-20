#!/usr/bin/env node
// openclaw-g2 OcuClaw patch tool.
//   node ocuclaw-patch/cli.mjs apply        [--plugin-dir DIR]
//   node ocuclaw-patch/cli.mjs check        [--plugin-dir DIR]
//   node ocuclaw-patch/cli.mjs verify-live  [--endpoint URL] [--config FILE] [--transcript-db FILE]
//   node ocuclaw-patch/cli.mjs all          (apply, check, verify-live)
// Default plugin dir: ~/.openclaw/extensions/ocuclaw
import * as os from "node:os";
import * as path from "node:path";
import { applyPatches, checkPatches, PatchError } from "./patcher.mjs";
import { verifyLive } from "./verify-live.mjs";

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    opts[a.slice(2)] = rest[i + 1];
    i += 1;
  }
  return { cmd, opts };
}

function runApply(pluginDir) {
  try {
    const { changed } = applyPatches(pluginDir);
    if (changed.length === 0) console.log(`apply: already applied (${pluginDir})`);
    else console.log(`apply: patched ${changed.join(", ")} (${pluginDir})`);
    return 0;
  } catch (err) {
    if (err instanceof PatchError) {
      console.error(`apply: ABORTED, nothing written. ${err.message}`);
      for (const name of err.missingPoints) console.error(`  missing anchor: ${name}`);
      return 2;
    }
    throw err;
  }
}

// Exit 0 all present, 3 a hook or payload file missing, 5 hooks present but the
// installed payload differs from the repo copy (stale; re-apply to update).
function runCheck(pluginDir) {
  const { missing, stale } = checkPatches(pluginDir);
  if (missing.length === 0 && stale.length === 0) {
    console.log(`check: all patch points present (${pluginDir})`);
    return 0;
  }
  if (missing.length === 0) {
    console.log(`check: all hooks present, payload differs from repo (${pluginDir}); run apply to update`);
    for (const f of stale) console.log(`  stale: ${f}`);
    return 5;
  }
  console.log(`check: MISSING ${missing.length} patch point(s) (${pluginDir})`);
  for (const name of missing) console.log(`  missing: ${name}`);
  for (const f of stale) console.log(`  stale: ${f}`);
  return 3;
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  const pluginDir = path.resolve(
    opts["plugin-dir"] || path.join(os.homedir(), ".openclaw/extensions/ocuclaw"),
  );
  switch (cmd) {
    case "apply":
      return runApply(pluginDir);
    case "check":
      return runCheck(pluginDir);
    case "verify-live":
      return verifyLive(opts);
    case "all": {
      const a = runApply(pluginDir);
      if (a !== 0) return a;
      const c = runCheck(pluginDir);
      if (c !== 0) return c;
      return verifyLive(opts);
    }
    default:
      console.error("usage: cli.mjs apply|check|verify-live|all [--plugin-dir DIR]");
      return 64;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  },
);
