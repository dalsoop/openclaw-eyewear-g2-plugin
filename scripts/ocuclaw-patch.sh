#!/bin/sh
# Re-apply / check / live-verify the openclaw-g2 hooks in the installed OcuClaw plugin.
#   scripts/ocuclaw-patch.sh apply [--plugin-dir DIR]   idempotent apply (all-or-nothing)
#   scripts/ocuclaw-patch.sh check [--plugin-dir DIR]   per-point check: 0 ok, 3 missing, 5 stale payload only
#   scripts/ocuclaw-patch.sh verify-live                real Even AI requests vs transcript
#   scripts/ocuclaw-patch.sh all                        apply, restart gateway if changed, check, verify-live
#   scripts/ocuclaw-patch.sh test                       unit + patcher tests (node --test)
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
OPENCLAW=${OPENCLAW:-$HOME/.local/bin/openclaw}
CLI="$ROOT/ocuclaw-patch/cli.mjs"

wait_gateway() {
  i=0
  sleep 5
  while [ $i -lt 40 ]; do
    if "$OPENCLAW" gateway status 2>&1 | grep -q "Connectivity check: ok"; then
      return 0
    fi
    i=$((i + 1))
    sleep 3
  done
  echo "gateway did not report 'Connectivity check: ok'" >&2
  return 1
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  apply|check|verify-live)
    exec "$NODE" "$CLI" "$cmd" "$@"
    ;;
  all)
    out=$("$NODE" "$CLI" apply "$@") || { echo "$out"; exit 2; }
    echo "$out"
    case "$out" in
      *"already applied"*) ;;
      *)
        echo "restarting gateway to load the patched plugin"
        "$OPENCLAW" gateway restart
        wait_gateway
        sleep 5
        ;;
    esac
    "$NODE" "$CLI" check "$@"
    exec "$NODE" "$CLI" verify-live
    ;;
  test)
    exec "$NODE" --test "$ROOT/ocuclaw-patch/test/"
    ;;
  *)
    echo "usage: $0 apply|check|verify-live|all|test [--plugin-dir DIR]" >&2
    exit 64
    ;;
esac
