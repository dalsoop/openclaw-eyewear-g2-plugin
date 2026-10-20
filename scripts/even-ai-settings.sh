#!/bin/sh
# Hey Even (Even AI) glasses-only conversation and Korean glasses prompt.
#   scripts/even-ai-settings.sh apply    idempotent: routing mode background + persona/even-ai-system-prompt.txt
#                                        into both the in-app store and plugin config (restarts gateway only if needed)
#   scripts/even-ai-settings.sh check    store and config match the repo values
#   scripts/even-ai-settings.sh verify   two live Even AI requests share the dedicated session, 반말, no symbols
#   scripts/even-ai-settings.sh test     unit tests (node --test)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  apply|check|verify)
    exec "$NODE" --no-warnings "$ROOT/even-ai-settings/cli.mjs" "$cmd" "$@"
    ;;
  test)
    exec "$NODE" --test "$ROOT/even-ai-settings/test/"
    ;;
  *)
    echo "usage: $0 apply|check|verify|test" >&2
    exit 64
    ;;
esac
