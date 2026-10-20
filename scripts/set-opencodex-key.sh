#!/bin/sh
# Store a dedicated opencodex API key for OpenClaw without echoing it.
# Run this yourself in a terminal; the key never appears on screen, in history
# or in any process argv: it travels over pipes into `openclaw config patch --stdin`.
set -eu
NODE=${NODE:-/opt/homebrew/opt/node/bin/node}
OPENCLAW=${OPENCLAW:-$HOME/.local/bin/openclaw}

trap 'stty echo 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '리체 전용 opencodex 키를 붙여 넣고 Enter (화면에 표시되지 않음): '
stty -echo 2>/dev/null || true
IFS= read -r KEY || true
stty echo 2>/dev/null || true
printf '\n'

[ -n "$KEY" ] || { echo "키가 비어 있어. 다시 실행해 줘." >&2; exit 1; }

# printf is a shell builtin (no argv exposure); node builds the JSON patch from stdin.
printf '%s' "$KEY" \
  | "$NODE" -e 'let k="";process.stdin.on("data",(c)=>{k+=c}).on("end",()=>{process.stdout.write(JSON.stringify({models:{providers:{opencodex:{apiKey:k}}}}))})' \
  | "$OPENCLAW" config patch --stdin >/dev/null
unset KEY
echo "저장했어. 이제 이 창은 닫아도 돼."
