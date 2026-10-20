# 엔지니어링 노트

## Hey Even 답이 첫 조각만 뜬다

- **증상**: 안경에 "네, 잘", "안녕", "물" 같은 앞부분만 뜬다. Gateway 로그에 `Agent run ended: … (1~5 chars)`. 모델·공급자와 무관하다(opencodex를 거치지 않는 `claude-cli` 모델, 스트리밍을 끈 상태에서도 재현).
- **원인**: OpenClaw 2026.10.5 Gateway는 assistant 이벤트의 첫 프레임에만 전체 `text`를 싣고 이후 프레임은 `{itemId, delta}`만 보낸다(Gateway의 `projectAssistantWireDelta`). OcuClaw 2.1.2의 `_handleAssistantEvent`는 `data.text`가 문자열일 때만 실행 버퍼(`_runTextBuffer`)를 갈아 끼우므로 버퍼가 첫 조각에서 멈춘다. lifecycle `end`에서 그 버퍼가 `message`로 나가고, Even AI 대기자는 첫 `message`에서 확정되므로 잘린 글이 그대로 응답이 된다.
- **대응**: 두 겹이다. (1) `client-assistant-delta` 훅이 delta를 버퍼에 이어 붙여 `text`를 만든다. itemId가 바뀌거나 `replace: true`면 버퍼를 비우고 새로 시작한다. (2) `endpoint-final-reply` 훅이 응답 본문을 대화 기록의 최종 답으로 정한다. (1)만으로는 도구 호출이 끼는 실행이나 Gateway 프레임 형식이 또 바뀌는 경우를 막지 못하므로 (2)가 진짜 근거다.
- **확인**: `scripts/ocuclaw-patch.sh verify-live`. 질문 3개(700자 이상 유도, 마크다운 목록 유도, 한 문장)를 보내고 응답이 대화 기록 최종 답을 다듬은 결과와 정확히 같은지 본다. "transcript reply was not over 350" 같은 note는 모델이 짧게 답한 것이지 실패가 아니다.

## 대화 기록에서 실행의 답 찾기

- Gateway `chat.history`의 어시스턴트 메시지는 `__openclaw.runId`(없으면 `runId`)로 실행에 묶인다. 최근 40개만 받으므로 한 실행이 40개 넘는 메시지를 남기면 최종 답을 놓칠 수 있다(그때는 스트림 대체로 간다).
- 도구 호출 턴(`stopReason`이 `toolUse`·`tool_use`·`tool_calls`·`toolCalls`)은 최종 답이 아니다. 기록이 아직 그 턴까지만 있으면 계속 기다린다.
- 직접 DB를 읽는 검증 도구는 `transcript_events` 테이블을 쓴다. 이벤트는 `event_json` 또는 zstd 압축 `event_zstd`에 있고, 세션 키는 `session_windows`에서 `session_id`로 찾는다. 사용자 메시지의 `idempotencyKey`가 `<runId>:user` 모양이라 이것으로 실행 ID를 되찾는다. 그래서 검증 도구는 `node:sqlite`와 `zstdDecompressSync`가 있는 Node(시스템 Node 26)가 필요하다.
- Gateway 쪽 세션 키는 `agent:main:ocuclaw:even-ai`처럼 에이전트 접두어가 붙는다. 플러그인 키 `ocuclaw:even-ai`와 비교할 때 접두어를 떼야 한다. 접미어 `:<id>`가 붙은 키는 일회용 세션이며 전용 세션이 아니다.

## `sessions.compaction.list` 오류

- **증상**: Gateway 로그에 OcuClaw가 부른 `sessions.compaction.list`의 unknown method 오류.
- **원인**: 2026.10.5 Gateway에는 이 메서드가 없다. OcuClaw는 한 번 실패한 뒤에야 프로세스 안 플래그를 세우므로 재시작마다 오류가 한 번씩 남는다.
- **대응**: `client-hello-features` 훅이 hello-ok의 `features.methods`(Gateway가 광고하는 메서드 목록)를 기록하고, `context-compaction-skip` 훅이 목록에 없으면 호출 자체를 하지 않는다. 광고 목록이 없을 때를 위해 거부된 메서드를 `~/.openclaw/ocuclaw-g2/unsupported-gateway-methods.json`에 호스트 버전별로 저장한다(현재 버전 것만 남긴다). OpenClaw를 올리면 버전이 바뀌어 다시 시도한다.

## 안경 실시간 화면 tick이 "missing api key"로 실패한다

- **증상**: tick 설정이 맞는데 매번 `openai-compat: missing api key`.
- **원인**: OcuClaw가 tick 모델을 문자열(`"opencodex/anthropic/claude-opus-5-5"`) 그대로 `api.runtime.modelAuth.getApiKeyForModel`에 넘긴다. OpenClaw는 `{provider, id}` 객체를 기대하므로 TypeError가 나고, 반환값도 문자열이 아니라 `{apiKey, source, mode}`다.
- **대응**: `glasses-ui-tick-api-key` 훅이 첫 `/`에서 공급자와 ID를 나눠 객체로 넘기고 `apiKey`를 꺼낸다. 실패하면 빈 문자열을 돌려주므로 tick은 다시 "missing api key"로 보인다. 같은 증상이 다시 나오면 패치가 빠졌는지(`check`)부터 본다.
- `tickApiBaseUrl`에는 `/v1`을 붙이지 않는다. 플러그인이 붙인다. 붙이면 `/v1/v1`이 된다.
- **확인**: `node scripts/check-live-tick-allowlist.mjs`. 플러그인 자신의 레시피 코드로 실제 tick 1회를 부르고, `~/.opencodex/usage.jsonl`에서 `requestedModel=anthropic/claude-opus-5-5`, HTTP 200 기록을 찾는다. `no tick backend` 경고는 마지막 `[gateway] http server listening` 이후 로그만 본다.

## `plugins.allow`는 켜는 순간 나머지를 끈다

- 허용 목록을 설정하면 목록 밖 플러그인은 모두 꺼진다. 지금 44개(켜져 있던 전체 − `browser` + `ocuclaw` + `llama-cpp`).
- `browser`를 뺐기 때문에 어떤 클라이언트(휴대폰·Mac 앱 등)가 `browser.request`를 부르면 Gateway 로그에 "unknown method"가 찍힌다. 정상이다.
- 패치한 OcuClaw는 원본과 달라 출처를 검증할 수 없으므로 출처(provenance) 경고는 허용 목록에 넣어도 남는다. 경고만 있고 로드가 거부되지 않으면 정상이다. 로드가 거부되면 백업으로 되돌린다.
- 새 플러그인을 설치하고 허용 목록에 안 넣으면 "설치는 됐는데 안 켜지는" 상태가 된다. `check-live-tick-allowlist.mjs`의 `enabled == plugins.allow`가 missing/extra를 보여 준다.

## Hey Even 설정이 config를 바꿔도 안 먹는다

- **원인**: OcuClaw는 앱 안 설정 편집기가 한 번이라도 쓴 `~/.openclaw/even-ai-settings.json`(`{version, updatedAtMs, settings:{routingMode, systemPrompt, …}}`)을 config 키보다 우선한다. 플러그인 CLI에는 이 파일을 쓰는 명령이 없다.
- **대응**: `scripts/even-ai-settings.sh apply`가 Gateway를 멈추고(`gateway stop --force`), 멈춘 뒤 파일을 다시 읽어 병합해 원자적으로 쓰고(권한 유지, 없으면 600), config 두 키를 `config patch --stdin`으로 넣은 뒤 다시 시작한다. 이미 같으면 Gateway를 건드리지 않는다.
- 실행 중에 파일을 쓰면 플러그인이 메모리 값으로 덮어쓸 수 있다. 손으로 고칠 때도 멈춘 상태에서 한다.
- **확인**: `scripts/even-ai-settings.sh check`(양쪽 일치), `verify`(질문 2개를 연달아 보내 같은 전용 세션에 쌓이는지, 두 번째 답이 첫 질문의 과일 이름을 기억하는지, 반말·기호·되묻기 없는지). 반말 판정은 휴리스틱이라 "~요"가 인용에 들어가면 오탐이 날 수 있다.

## 조정 환경 변수는 Gateway 환경에 넣어야 한다

`OCUCLAW_G2_REPLY_BUDGET`, `OCUCLAW_G2_HISTORY_TIMEOUT_MS`, `OCUCLAW_G2_STATE_DIR`은 Gateway 프로세스 안에서 읽힌다. 셸에서 export하고 스크립트를 돌려도 효과가 없다. Gateway LaunchAgent(`ai.openclaw.gateway`)의 환경에 넣고 재시작해야 한다. `OCUCLAW_G2_FORCE_HISTORY_FAILURE=1`은 기록 조회를 일부러 실패시키는 시험용 스위치이며 운영 환경에 남기면 Hey Even이 늘 스트림 대체로 답한다.

## OcuClaw 업데이트 뒤

- 업데이트는 플러그인 폴더를 통째로 바꾸므로 훅과 `dist/ocuclaw-g2/`가 모두 사라진다. Gateway가 다시 뜨면 감시자가 휴대폰으로 알린다.
- 재적용 체크리스트: `scripts/backup.sh` → `scripts/ocuclaw-patch.sh all` → 출력이 `check: all patch points present`와 `verify-live: PASS`인지 확인 → `node scripts/check-live-tick-allowlist.mjs`로 tick 확인.
- `apply`가 `ABORTED, nothing written`과 `missing anchor: <지점>`으로 끝나면 새 버전에서 그 기준 문자열이 바뀐 것이다. 설치본의 해당 파일을 읽어 같은 역할의 새 줄을 찾아 `PATCH_POINTS`의 기준 문자열만 고친다. 원본 코드를 저장소로 가져오지 않는다. OcuClaw가 버그를 고쳤다면(assistant 처리에서 delta를 다루거나 최종 답을 기록에서 고른다면) 그 지점은 지운다.
- 업데이트가 `ocuclaw-g2`라는 이름의 dist 폴더를 새로 만들 가능성은 낮지만, 공개 안전 검사는 그 폴더를 우리 사본으로 보고 비교에서 뺀다.

## 패치 단위 시험은 로컬 백업에 묶여 있다

`ocuclaw-patch/test/patcher.test.mjs`는 `~/.openclaw/backups/` 아래에서 가장 최근의 패치 표식(`ocuclaw-g2:`) 없는 OcuClaw 사본을 깨끗한 원본으로 고른다. 그런 사본이 없으면 7개 시험을 건너뛴다(skip, 실패 아님). `OCUCLAW_G2_PRISTINE_DIR`로 직접 지정하면 그 경로가 반드시 있어야 하고, 없으면 실패한다. OcuClaw를 업데이트한 뒤에는 `scripts/backup.sh`를 패치 전에 돌려 새 버전의 깨끗한 사본을 남겨야 시험이 새 버전을 기준으로 돈다.

## 로컬 임베딩 설치는 대화형이다

`openclaw models auth login --provider llama-cpp --method local`은 두 번 묻는다. 첫 질문은 수 GB 대화 모델 다운로드다. **No**. 여기서 Yes를 고르면 큰 모델을 받고 기본 모델이 바뀔 수 있다. 두 번째 질문은 임베딩 모델만(약 0.3 GB) 받기다. **Yes**. 2026.10.5에는 `openclaw onboard --llama-cpp-embedding-only` 같은 비대화형 옵션이 없다. 그래서 `scripts/apply-memory-aside.sh`는 사람이 터미널 앞에 있을 때만 돌린다. 이미 `Embeddings: ready`면 이 단계를 건너뛴다. 확인은 `openclaw memory status --deep --agent main`에서 Embeddings·Vector store가 ready인지 본다.

## 패치 감시자

- Gateway 시작 판단은 `gateway.log`의 `[gateway] ready`로 끝나는 줄이다. OpenClaw가 이 로그 문구를 바꾸면 감시자는 아무것도 감지하지 못하고 조용히 지나간다. OpenClaw를 올린 뒤에는 `scripts/patch-watch.sh status`에서 "gateway start detected"가 찍히는지 확인한다.
- 로그 파일이 줄어들면(회전) 처음부터 다시 읽는다. 줄 중간에서 끊긴 조각은 다음 읽기와 이어 붙인다.
- 로그인 직후 Gateway가 감시자보다 먼저 뜨면, 감시자가 시작할 때 마지막 ready 줄을 `patch-watch.state.json`과 비교해 한 번 검사한다. 같은 ready 줄로 두 번 알리지 않는다.
- 감시자는 `ocuclaw-patch/cli.mjs check`의 출력 형식(`  missing: <이름>`, `  stale: <파일>` 줄)과 종료 코드(0, 3, 5)에 의존한다. 5(payload 내용만 저장소와 다름)는 저장소 편집·브랜치 전환만으로도 나오므로 알림하지 않는다. `check` 출력을 바꾸면 감시자 해석도 함께 고친다. 형식이 어긋나면 "check error"로 기록되고 알림이 가지 않는다.
- 시험: 패치를 하나 뺀 사본이 아니라 실제 설치본에서 훅 줄 하나를 지우고 Gateway를 재시작하면 알림이 가는지, 다시 적용하고 재시작하면 알림이 없는지 본다. 끝나면 반드시 재적용한다.

## 페르소나 파일은 개발 지침이 아니다

`persona/AGENTS.md`는 리체에게 주는 작업 공간 규칙이다(`~/.openclaw/workspace/AGENTS.md`로 복사된다). 이 저장소를 고치는 개발 지침으로 읽지 않는다. `scripts/apply-persona-locale.sh`는 처음 설치 뒤 workspace에 `.openclaw-g2-installed` 표식을 남기고, 그 뒤로는 저장소 원본과 달라진 성격 파일을 건너뛴다. 리체가 대화에서 정해 적은 세부 성격이나 `USER.md` 지시문을 지키기 위해서다. 저장소 원본으로 되돌리려면 `--force`를 쓴다. 표식을 지우면 다음 실행이 처음 설치처럼 모두 덮어쓴다.
