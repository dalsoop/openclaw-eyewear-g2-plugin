#!/bin/sh
# Local memory embeddings (OpenClaw-managed llama.cpp); built-in browser off;
# a leftover Aside MCP server is removed (docs/tracking/decisions/0008-remove-aside.md).
# The agent's web tool, ego lite, is attached by scripts/apply-ego-browser.mjs
# (decision 0009), not here.
# Back up first with scripts/backup.sh. Safe to re-run.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
OPENCLAW=${OPENCLAW:-$HOME/.local/bin/openclaw}
. "$ROOT/scripts/lib/gateway.sh"

# 1. Built-in browser off; remove the Aside MCP server an earlier version of
#    this script registered. Runs before the interactive steps so an aborted
#    login cannot leave it behind. Only a successful `mcp list --json` without
#    an "aside" key counts as already removed; a failed or unreadable listing
#    stops the script. The listing may hold other servers' settings, so it is
#    never printed.
"$OPENCLAW" config set browser.enabled false --strict-json
if ! servers=$("$OPENCLAW" mcp list --json 2>/dev/null); then
  echo "cannot read mcp.servers ('openclaw mcp list' failed); Aside removal not checked" >&2
  exit 1
fi
set +e
printf '%s' "$servers" | "$NODE" -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let o;
  try { o = JSON.parse(s.slice(s.indexOf("{"))); } catch { process.exit(2); }
  if (o === null || typeof o !== "object" || Array.isArray(o)) process.exit(2);
  process.exit(Object.hasOwn(o, "aside") ? 0 : 3);
});'
rc=$?
set -e
case $rc in
  0) "$OPENCLAW" mcp unset aside ;;
  3) ;;
  *) echo "unexpected 'openclaw mcp list --json' output; Aside removal not checked" >&2
     exit 1 ;;
esac

# 2. llama.cpp provider plugin (needed for memory.search.provider=local)
if ! "$OPENCLAW" plugins list --enabled 2>/dev/null | grep -q 'llama-cpp'; then
  yes | "$OPENCLAW" plugins install @openclaw/llama-cpp-provider
fi

# 3. Managed local embeddings, embedding-only (the chat model stays unchanged)
"$OPENCLAW" config set memory.search.provider local
if ! "$OPENCLAW" memory status --deep --agent main 2>/dev/null | grep -q 'Embeddings: ready'; then
  # Interactive: answer "No" to the chat-model download (several GB), then
  # "Yes" to "download only the local embedding model (about 0.3 GB)".
  echo "대화 모델 다운로드 질문에는 No, 임베딩 모델만 받는 질문에는 Yes를 고르세요."
  "$OPENCLAW" models auth login --provider llama-cpp --method local
fi

"$OPENCLAW" gateway restart
gateway_wait_ok 60
"$OPENCLAW" memory index --force --agent main
"$OPENCLAW" memory status --deep --agent main | grep -E 'Embeddings|Vector store'
