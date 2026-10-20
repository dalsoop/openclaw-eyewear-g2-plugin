#!/bin/sh
# Patch watcher: alert the paired phone when OcuClaw patch points are missing after a gateway start.
#   scripts/patch-watch.sh install | uninstall | status | run | test
# See scripts/patch-watch.mjs for details.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
exec "$NODE" "$ROOT/scripts/patch-watch.mjs" "$@"
