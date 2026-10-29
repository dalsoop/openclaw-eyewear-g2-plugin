#!/bin/sh
# Local memory embeddings (OpenClaw-managed llama.cpp); built-in browser off;
# no browser tool for the agent (a leftover Aside MCP server is removed, see
# docs/tracking/decisions/0008-remove-aside.md).
# Back up first with scripts/backup.sh. Safe to re-run.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OPENCLAW=${OPENCLAW:-$HOME/.local/bin/openclaw}
. "$ROOT/scripts/lib/gateway.sh"

# 1. llama.cpp provider plugin (needed for memory.search.provider=local)
if ! "$OPENCLAW" plugins list --enabled 2>/dev/null | grep -q 'llama-cpp'; then
  yes | "$OPENCLAW" plugins install @openclaw/llama-cpp-provider
fi

# 2. Managed local embeddings, embedding-only (the chat model stays unchanged)
"$OPENCLAW" config set memory.search.provider local
if ! "$OPENCLAW" memory status --deep --agent main 2>/dev/null | grep -q 'Embeddings: ready'; then
  # Interactive: answer "No" to the chat-model download (several GB), then
  # "Yes" to "download only the local embedding model (about 0.3 GB)".
  echo "대화 모델 다운로드 질문에는 No, 임베딩 모델만 받는 질문에는 Yes를 고르세요."
  "$OPENCLAW" models auth login --provider llama-cpp --method local
fi

# 3. Built-in browser off; remove the Aside MCP server an earlier version of
#    this script registered (`mcp unset` exits 1 when the server is absent,
#    so check first and skip when it is already gone).
"$OPENCLAW" config set browser.enabled false --strict-json
if "$OPENCLAW" mcp show aside >/dev/null 2>&1; then
  "$OPENCLAW" mcp unset aside
fi

"$OPENCLAW" gateway restart
gateway_wait_ok 60
"$OPENCLAW" memory index --force --agent main
"$OPENCLAW" memory status --deep --agent main | grep -E 'Embeddings|Vector store'
