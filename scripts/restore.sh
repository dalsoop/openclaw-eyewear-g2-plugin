#!/bin/sh
# Restore a snapshot made by backup.sh: stop the gateway (and wait until it is down),
# copy, start it and wait for "Connectivity check: ok".
# Usage: scripts/restore.sh <backup-dir> [--no-restart]
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OPENCLAW=${OPENCLAW:-$HOME/.local/bin/openclaw}
. "$ROOT/scripts/lib/gateway.sh"

# Only the persona files this repo installs; DREAMS.md, MEMORY.md and other
# workspace notes written by the agent after the backup are left alone.
PERSONA_FILES="IDENTITY.md SOUL.md USER.md AGENTS.md"

SRC="${1:-}"
OC_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
RESTART=1
[ "${2:-}" = "--no-restart" ] && RESTART=0

[ -n "$SRC" ] && [ -f "$SRC/openclaw.json" ] || {
  echo "usage: $0 <backup-dir> [--no-restart]  (dir must contain openclaw.json)" >&2
  exit 2
}

# The Even AI settings store must be written while the gateway is stopped,
# otherwise the gateway can write its in-memory copy back over it.
if [ "$RESTART" = 1 ]; then
  # Without --force, `gateway stop` refuses to stop the operator's service.
  "$OPENCLAW" gateway stop --force
  gateway_wait_stopped 30
  # From here on the gateway is down: if a copy fails, bring it back and say so.
  trap 'rc=$?; if [ $rc -ne 0 ]; then echo "restore failed (exit $rc); restarting the gateway with the current files — check $SRC" >&2; "$OPENCLAW" gateway start >/dev/null 2>&1 || true; fi' EXIT
fi

cp -p "$SRC/openclaw.json" "$OC_HOME/openclaw.json"
[ -f "$SRC/even-ai-settings.json" ] && cp -p "$SRC/even-ai-settings.json" "$OC_HOME/even-ai-settings.json"
if [ -d "$SRC/workspace" ]; then
  mkdir -p "$OC_HOME/workspace"
  for f in $PERSONA_FILES; do
    if [ -f "$SRC/workspace/$f" ]; then cp -p "$SRC/workspace/$f" "$OC_HOME/workspace/$f"; fi
  done
fi
if [ -d "$SRC/extensions/ocuclaw" ]; then
  rm -rf "$OC_HOME/extensions/ocuclaw.restore-tmp"
  cp -Rp "$SRC/extensions/ocuclaw" "$OC_HOME/extensions/ocuclaw.restore-tmp"
  rm -rf "$OC_HOME/extensions/ocuclaw"
  mv "$OC_HOME/extensions/ocuclaw.restore-tmp" "$OC_HOME/extensions/ocuclaw"
fi

echo "restored from $SRC"
if [ "$RESTART" = 1 ]; then
  "$OPENCLAW" gateway start
  gateway_wait_ok 60
fi
