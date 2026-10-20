# ocuclaw-patch

## 범위

설치된 OcuClaw 플러그인(`~/.openclaw/extensions/ocuclaw/`)에 우리 코드를 넣고, 들어갔는지 검사하고, 실제 Even AI 응답이 대화 기록과 맞는지 실측하는 모듈이다.

- `payload/*.js`: 설치본의 `dist/ocuclaw-g2/`로 그대로 복사되는 우리 모듈. Gateway 프로세스 안에서 OcuClaw와 함께 돈다.
- `patcher.mjs`: `PATCH_POINTS`(지점 이름, 대상 파일, 기준 문자열, `after`/`replace`, 넣을 한 줄) 정의와 적용·검사.
- `cli.mjs`: `apply`·`check`·`verify-live`·`all`. 셸 진입점은 `scripts/ocuclaw-patch.sh`.
- `verify-live.mjs`: 실제 엔드포인트 요청, 대화 기록 DB 조회. 이 함수들은 `even-ai-settings`도 가져다 쓴다.

이 모듈의 범위가 아닌 것: Even AI 라우팅·프롬프트 설정(`even-ai-settings/`), Gateway 시작 감지와 휴대폰 알림(`scripts/patch-watch*`), `openclaw.json` 변경(`scripts/`), 성격 파일(`persona/`). 이 모듈은 `openclaw.json`을 읽기만 하고(토큰) 쓰지 않는다.

## 불변 조건

- 원본 파일에 들어가는 것은 한 줄 훅뿐이고, 줄 끝에 `/* ocuclaw-g2:<지점 이름> */` 표식이 붙는다. OcuClaw 원본 코드를 이 폴더에 복사하지 않는다. 기준 문자열은 한 줄 이하.
- 기준 문자열은 대상 파일 안에서 정확히 한 번 나와야 한다. 하나라도 못 찾거나 두 번 이상이면 `PatchError`로 멈추고 **아무 파일도 쓰지 않는다**(payload 복사도 하지 않는다). 모든 변경을 메모리에서 계산한 뒤에 쓴다.
- 적용은 멱등이다. 표식이 있는 지점은 건너뛰고, payload가 저장소와 바이트 단위로 같으면 복사하지 않는다. 두 번째 실행 결과는 `already applied`.
- 검사는 `payload` + 11개 지점을 각각 판정한다. `replace` 지점은 표식이 있고 기준 문자열이 사라졌어야, `after` 지점은 표식과 기준 문자열이 둘 다 있어야 통과다. 설치본 `dist/ocuclaw-g2/index.js`가 없거나, 설치본 `index.js`가 불러오는 파일이 하나라도 없으면 `payload`가 빠짐이다. 저장소에만 새로 생긴 payload 파일은 빠짐이 아니라 낡음이다. 파일은 있는데 내용이 저장소와 다르면 빠짐이 아니라 낡음(`stale`)이다: 훅이 다 있으면 종료 코드 5와 `  stale: <파일>` 줄, 훅도 빠졌으면 3에 `stale:` 줄을 덧붙인다. 저장소 payload를 고치거나 브랜치를 바꾸면 재적용 전까지 5가 나오는 것이 정상이고, 감시자는 이때 알림하지 않는다.
- 파일 쓰기는 같은 폴더의 임시 파일 → rename이고 원래 권한을 유지한다.
- `resolveEvenAiReply`는 절대 예외를 던지지 않고 빈 문자열을 돌려주지 않는다. 순서는 대화 기록 → 스트림 → `NO_REPLY_NOTICE`, 각 후보에 `formatGlassesReply`를 적용한 뒤 비었는지 본다.
- `formatGlassesReply` = 기호 정리 → trim → 길이 정책. 길이는 `Array.from`(코드포인트)으로 센다. 문자열 `.length`(UTF-16)로 세면 이모지·일부 한자에서 틀린다.
- `resolveTickApiKey`는 실패하면 빈 문자열이다. 예외를 OcuClaw로 올려보내지 않는다.
- payload는 `node:` 내장 모듈만 쓴다. OcuClaw의 다른 모듈을 import하지 않는다(설치본 구조가 바뀌어도 우리 모듈은 로드되어야 한다).
- 메서드 지원 상태는 `Symbol.for("openclaw-g2.gatewayMethodSupport")` 전역에 둔다. OcuClaw가 모듈을 여러 번 로드해도 상태가 하나다.

## 구현 방식

- 훅 줄은 OcuClaw 지역 변수 이름(`gatewayBridge`, `runId`, `sessionKey`, `assistantText`, `logger`, `opts`, `data`, `helloOk`, `api`, `modelRef`, `cfg`)에 의존한다. 기준 문자열을 고칠 때는 그 변수들이 새 버전에서도 같은 이름으로 그 자리에 있는지 설치본을 읽어 확인한다.
- `after` 모드에서 기준 문자열이 `{`로 끝나면(함수 머리) 넣는 줄을 두 칸 더 들여 쓴다.
- 대화 기록 조회는 `chat.history`(`limit` 40)를 250ms 간격으로 부르고, 각 호출도 남은 시간 안에 끝나야 한다. 도구 호출 턴(`stopReason`)이면 계속 기다린다.
- delta 재조립은 `text`가 이미 문자열이거나 `delta`가 문자열이 아니면 원래 데이터를 그대로 돌려준다. `itemId`가 현재 항목과 다르거나 `replace === true`면 새로 시작한다.
- 미지원 메서드 판정 순서: hello의 `features.methods` 목록이 있으면 그것만 본다 → 없으면 호스트 버전별 파일 기록 → 프로세스 메모리.
- 조정값: `OCUCLAW_G2_REPLY_BUDGET`(2 미만·숫자 아님은 무시), `OCUCLAW_G2_HISTORY_TIMEOUT_MS`, `OCUCLAW_G2_STATE_DIR`, 시험 전용 `OCUCLAW_G2_FORCE_HISTORY_FAILURE=1`. 모두 Gateway 프로세스 환경에서 읽는다.
- `verify-live`는 질문 끝에 `(확인용 <nonce>)`를 붙여 대화 기록 DB(`transcript_events`, `event_json` 또는 zstd `event_zstd`)에서 그 실행을 찾는다. 토큰은 `openclaw.json`에서 읽어 헤더에만 넣는다. 출력에는 응답 앞부분 120자까지만 나간다.

## CLI 종료 코드

`apply` 0/2(`dist/index.js`가 없는 폴더도 2), `check` 0/3/5, `verify-live` 0/4, 사용법 64, 예상 밖 예외 1. 패치 감시자가 `check`의 3·5와 `  missing: <이름>`·`  stale: <파일>` 줄 형식을 해석하므로 이 형식을 바꾸면 감시자도 함께 고친다. 지점 이름을 바꾸면 이미 설치본에 들어간 표식과 맞지 않아 검사가 빠짐으로 판정한다.

## 시험

- `scripts/ocuclaw-patch.sh test`(= `node --test ocuclaw-patch/test/`).
- `reply-format.test.mjs`: 정확히 350, 351, 경계 없음(349에서 자름), 경계가 정확히 349·350 위치, 줄바꿈 경계, `다.` 끝, `…`로 끝나는 자른 글(`……` 금지), 이모지만, 빈 답, 정리 뒤 길이 계산, 예산 조정, `snake_case`·곱셈 `*` 보존.
- `final-reply.test.mjs`: 기록 우선, 기록이 늦게 나타나는 경우 폴링, 조회 오류·시간 초과·빈 답·정리 후 빈 답 → 스트림, 스트림도 비면 안내 문구, 브리지·runId 없음, 스트림에도 길이 정책, 도구 턴만 있으면 마감 뒤 수용, 강제 실패 스위치.
- `glue.test.mjs`: delta 재조립(새 itemId면 새로 시작, `text`가 있거나 delta가 없으면 그대로), 오류 문구 한국어화와 `content`만 바꾸기, hello 메서드 목록 우선 판정, 목록이 없을 때 호스트 버전별 파일 기록, 잘못된 hello 무시.
- `tick-auth.test.mjs`: 모델 문자열 분해, 반환값이 문자열·객체·예외인 경우.
- `patcher.test.mjs`: 깨끗한 OcuClaw 사본(`OCUCLAW_G2_PRISTINE_DIR`, 기본은 `~/.openclaw/backups/`의 가장 최근 패치 안 된 사본, 없으면 건너뜀)을 임시 폴더에 복사해 전부 빠짐 → 적용 → 통과 → 재적용 무변화, 훅 하나 지우면 그 지점만 지목, 기준 문자열 하나 없으면 아무것도 안 씀, 패치된 모듈이 실제로 import되는지. `OCUCLAW_G2_PRISTINE_DIR`로 지정한 경로가 없으면 실패하고, 지정하지 않았는데 사본이 없으면 건너뛴다.
- 지점을 추가·변경하면 실제 설치본에 `scripts/ocuclaw-patch.sh all`을 돌려 `verify-live: PASS`까지 확인한다. 단위 시험만으로는 기준 문자열이 실제 버전과 맞는지 알 수 없다.
