#!/bin/sh
# PR gate: scan new commits since the merge base plus the index and working tree.
# --all audits all refs without suppressing known findings. Never prints matched values.
# Exit 0 = clean, 1 = findings, 2 = cannot scan (including missing refs or OcuClaw dist).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
exec "$NODE" "$ROOT/scripts/lib/public-safety-scan.mjs" "$ROOT" "$@"
