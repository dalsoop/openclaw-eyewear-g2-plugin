#!/bin/sh
# PR gate: scan the commits base..head adds, plus the index and working tree.
# --all audits all refs without suppressing known findings. Never prints matched values.
# Exit 0 = clean, 1 = findings, 2 = cannot scan (including missing refs or OcuClaw dist).
set -eu
ROOT=$(cd -P "$(dirname "$0")/.." && pwd -P)
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
# Call main() unconditionally: never depend on an entry-point check that a
# symlinked path could defeat, which would exit 0 without scanning. argv[1] is
# the repository root (not the module), so the module's own entry check stays
# false and the scan runs exactly once.
exec "$NODE" --input-type=module -e '
import * as path from "node:path";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(1);
let main;
try {
  ({ main } = await import(pathToFileURL(path.join(args[0], "scripts/lib/public-safety-scan.mjs")).href));
} catch {
  console.error("cannot scan: scanner module failed to load");
  process.exit(2);
}
process.exitCode = main(args);
' -- "$ROOT" "$@"
