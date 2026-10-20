# scripts

## 범위

사람이 부르는 진입 명령과, OpenClaw 설정을 바꾸는 적용 스크립트, 백업·복원, 공개 안전 검사.

- 모듈 진입 래퍼: `ocuclaw-patch.sh`(→ `ocuclaw-patch/cli.mjs`, `all`의 재시작·대기 포함), `even-ai-settings.sh`(→ `even-ai-settings/cli.mjs`), `patch-watch.sh`(→ `patch-watch.mjs`).
- 설정 적용: `apply-persona-locale.sh`(성격 파일 4개 복사, 이름 리체, 언어·시간대 4키), `apply-live-tick-allowlist.mjs` + `lib/live-tick-allowlist.mjs`(tick 3키 + `plugins.allow`), `apply-memory-aside.sh`(llama.cpp 플러그인, `memory.search.provider`, Aside MCP + 자동 승인, `browser.enabled`), `set-opencodex-key.sh`(사람 전용).
- 검사: `check-live-tick-allowlist.mjs`, `public-safety-scan.sh`.
- 백업·복원: `backup.sh`, `restore.sh`(Gateway를 멈춘 상태에서 복사한다. Even AI 설정 저장소는 Gateway 실행 중에 쓰면 덮어써질 수 있다).

이 폴더의 범위가 아닌 것: 패치 감시자(`patch-watch.mjs`와 `patch-watch/`)는 이 폴더에 있지만 별도 단위다. 여기서는 그 래퍼(`patch-watch.sh`)만 다룬다. OcuClaw 주입 코드와 Even AI 설정 로직은 각 모듈에 있고 여기서 다시 구현하지 않는다. Tailscale serve, opencodex 설정, 모델 목록, OpenClaw·OcuClaw 버전은 어떤 스크립트도 바꾸지 않는다.

## 불변 조건

- 설정·성격 파일·플러그인 폴더를 바꾸는 스크립트는 사용자가 먼저 `backup.sh`를 돌렸다는 전제로 쓴다. 백업은 `$OPENCLAW_HOME/backups/<YYYYMMDD-HHMMSS>/`(권한 700)에 `openclaw.json`, `even-ai-settings.json`(있으면), `workspace/*.md`, `extensions/ocuclaw/` 전체를 담는다. 새로 바꾸는 파일이 생기면 백업·복원 대상에도 넣는다.
- 복원은 workspace에서 성격 파일 4개(`IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`)만 되돌린다. 백업에 들어 있어도 `DREAMS.md`, `MEMORY.md` 같은 다른 `*.md`는 리체가 백업 뒤에 쓴 기억이므로 덮어쓰지 않는다.
- `restore.sh`는 `gateway stop --force`(`--force`가 없으면 운영 중인 서비스라며 멈추지 않는다) 뒤 `gateway status`에 `(not loaded)`가 보이고 `Connectivity check: ok`가 사라질 때까지 최대 30초 기다린다. 상태를 읽지 못하면 멈춘 것으로 보지 않는다. 멈춘 뒤 복사가 실패하면 Gateway를 다시 켜고 실패를 알린다.
- `plugins.allow`는 `openclaw plugins list --enabled --json`에서 계산한다: 켜진 ID − `ALLOWLIST_EXCLUDE`(`browser`) + `ALLOWLIST_INCLUDE`(`ocuclaw`, `llama-cpp`), 중복 제거, 정렬. 켜진 목록이 비면 예외로 멈춘다(빈 배타 목록은 모든 플러그인을 끈다). 허용 목록이 생긴 뒤 새로 설치한 플러그인은 켜진 목록에 나오지 않으므로 `ALLOWLIST_INCLUDE`에 넣어야 한다.
- `tickApiBaseUrl`은 `/v1` 없이 둔다(플러그인이 붙인다). `tickModel`의 첫 `/` 앞은 공급자로 떨어진다.
- 비밀값을 출력하지 않는다. `check-live-tick-allowlist.mjs`는 API 키의 길이만, `public-safety-scan.sh`는 파일과 규칙 이름만 출력한다. `set-opencodex-key.sh`는 `stty -echo`로 읽고(끝나거나 중단되면 trap으로 에코를 되돌린다), 키를 파이프로 `openclaw config patch --stdin`에 넘긴다. 키가 어떤 프로세스의 명령 인자에도 나타나지 않아야 하며 출력은 버린다. 에이전트는 이 스크립트를 대신 실행하지 않는다.
- `public-safety-scan.sh`의 패턴은 문자열 조각을 이어 만든다. 패턴을 그대로 적으면 스크립트 자신이 걸린다. OcuClaw dist의 `ocuclaw-g2/`(우리 사본)는 비교에서 뺀다. dist가 없으면 2로 끝나며 이는 통과가 아니다. 이메일 주소는 내용(이력 blob·작업 트리·커밋 메시지)에서 `@users.noreply.github.com`과 Claude 공동 작성자 줄의 noreply 주소만 허용하고, 커밋 작성자·커미터 이메일은 `@users.noreply.github.com`만 허용한다. 64자리 16진수 문자열(휴대폰 노드 ID 모양)은 어디에도 두지 않는다.
- 복원은 플러그인 폴더를 `ocuclaw.restore-tmp`로 먼저 복사한 뒤 바꿔 넣는다. 복사 실패 시 기존 폴더가 남아야 한다.
- `apply-memory-aside.sh`의 llama.cpp 로그인 단계는 대화형이다: 대화 모델(수 GB)은 No, 임베딩 모델만(약 0.3 GB)은 Yes. 첫 질문에 Yes면 큰 모델을 받고 기본 모델이 바뀔 수 있다. `Embeddings: ready`면 이 단계를 건너뛴다. 무인 실행으로 바꾸지 않는다(2026.10.5에 비대화형 옵션이 없다).
- `apply-persona-locale.sh`는 처음 설치 때만 성격 파일 4개를 복사하고(표식 `workspace/.openclaw-g2-installed`), 이후 원본과 달라진 파일은 건너뛴다. `--force`일 때만 덮어쓴다. `DREAMS.md`, `memory/`는 건드리지 않는다.

## 구현 방식

- 셸은 POSIX `sh` + `set -eu`. `NODE`(기본 `/opt/homebrew/opt/node/bin/node`)와 `OPENCLAW`(기본 `~/.local/bin/openclaw`) 환경 변수로 경로를 바꿀 수 있다. 셸 스크립트는 `OPENCLAW=${OPENCLAW:-$HOME/.local/bin/openclaw}`로 받아 `"$OPENCLAW"`만 부르고, Node 스크립트도 같은 `OPENCLAW`를 읽는다. `OPENCLAW_HOME`으로 임시 홈을 가리키면 백업·복원·성격 적용을 실제 설치본 없이 시험할 수 있다.
- 설정 변경은 `openclaw config set`(여러 키는 `--batch-json`, JSON 값은 `--strict-json`)을 쓴다. 지우는 변경에는 `--replace`가 필요하다.
- Gateway를 재시작하는 스크립트는 `openclaw gateway status`의 `Connectivity check: ok`를 기다린다(`apply-live-tick-allowlist.mjs --restart`는 120초, `apply-memory-aside.sh`·`restore.sh`는 60초). 셸 스크립트의 대기는 `lib/gateway.sh`의 `gateway_wait_ok`·`gateway_wait_stopped`를 쓴다(간격 `GATEWAY_WAIT_POLL_SEC`, 기본 2초).
- tick 검사는 플러그인 자신의 `dist/config/runtime-config.js`, `dist/tools/glasses-ui-recipes.js`와 주입된 `dist/ocuclaw-g2/index.js`, OpenClaw의 `dist/runtime-model-auth.runtime.js`를 import해 실제 tick 1회를 부르고 `~/.opencodex/usage.jsonl`에서 `requestedModel=anthropic/claude-opus-5-5`·HTTP 200을 찾는다. 이 경로들은 OcuClaw·OpenClaw 버전이 바뀌면 깨질 수 있다. `no tick backend` 경고는 로그의 마지막 `[gateway] http server listening` 이후만 본다.

## 시험

- `node --test scripts/lib/`: llama.cpp 플러그인 ID, 허용 목록 계산(제외·포함·중복·정렬·자기 출력에 다시 적용해도 같음·빈 목록 거부), `plugins list --json` 앞에 배너가 붙은 출력 파싱과 꺼진 항목 제외, tick 설정 3키만 쓰는지, 켜진 목록 비교(notInstalled 무시), 마지막 Gateway 실행 구간 자르기, 사용 기록에서 tick 성공 찾기. `no tick backend` 경고 찾기는 시험이 없다.
- 셸 스크립트에는 자동 시험이 없다. 백업·복원은 `OPENCLAW_HOME=<임시 폴더>`와 호출을 기록하는 가짜 `openclaw`(`OPENCLAW=<가짜 경로>`)로 왕복과 "정지 → 멈춤 확인 → 복사 → 시작 → 연결 확인" 순서, 성격 파일 4개만 되돌리는지 확인한다. `set-opencodex-key.sh`는 인자와 표준 입력을 기록하는 가짜 `openclaw`로 키가 인자에 없는지 본다. 진짜 설정에 대고 돌리지 않는다. 적용 스크립트는 실제 설치본에서 대응 검사 명령으로 확인한다: 성격·언어는 설정 4키 값, tick·허용 목록은 `node scripts/check-live-tick-allowlist.mjs`, 기억·Aside는 `openclaw memory status --deep --agent main`과 `openclaw mcp probe`.
- 공개 전에는 `scripts/public-safety-scan.sh`가 clean이어야 한다.
