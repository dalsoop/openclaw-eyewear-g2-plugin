#!/bin/sh
# Snapshot the OpenClaw files this repo modifies, outside the repo.
# Usage: scripts/backup.sh            -> prints the backup directory
#        OPENCLAW_HOME=/tmp/x scripts/backup.sh   (testing)
set -eu

OC_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$OC_HOME/backups/$STAMP"

[ -d "$OC_HOME" ] || { echo "OpenClaw home not found: $OC_HOME" >&2; exit 1; }
mkdir -p "$DEST/workspace"
chmod 700 "$OC_HOME/backups" "$DEST"

cp -p "$OC_HOME/openclaw.json" "$DEST/openclaw.json"
[ -f "$OC_HOME/even-ai-settings.json" ] && cp -p "$OC_HOME/even-ai-settings.json" "$DEST/even-ai-settings.json"
for f in "$OC_HOME"/workspace/*.md; do
  [ -f "$f" ] && cp -p "$f" "$DEST/workspace/"
done
if [ -d "$OC_HOME/extensions/ocuclaw" ]; then
  mkdir -p "$DEST/extensions"
  cp -Rp "$OC_HOME/extensions/ocuclaw" "$DEST/extensions/ocuclaw"
fi

echo "$DEST"
