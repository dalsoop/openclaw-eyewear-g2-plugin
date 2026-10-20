#!/bin/sh
# Install the Korean persona files (리체) and set Korean UI/voice/timezone.
# Back up first with scripts/backup.sh.
#
# Persona files that already exist and differ from the repo copy are left
# alone (리체 edits them during conversations). Pass --force to overwrite.
set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW=${OPENCLAW:-$HOME/.local/bin/openclaw}
WS="${OPENCLAW_HOME:-$HOME/.openclaw}/workspace"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$WS"
for f in IDENTITY.md SOUL.md USER.md AGENTS.md; do
  if [ -f "$WS/$f" ] && ! cmp -s "$REPO/persona/$f" "$WS/$f" && [ "$FORCE" = 0 ] \
     && [ -f "$WS/.openclaw-g2-installed" ]; then
    echo "skip $f: changed since install (use --force to overwrite)" >&2
    continue
  fi
  cp "$REPO/persona/$f" "$WS/$f"
done
touch "$WS/.openclaw-g2-installed"

"$OPENCLAW" agents set-identity --agent main --name "리체"
"$OPENCLAW" config set ui.prefs.locale ko
"$OPENCLAW" config set talk.speechLocale ko-KR
"$OPENCLAW" config set tools.media.audio.language ko
"$OPENCLAW" config set agents.defaults.userTimezone Asia/Seoul
