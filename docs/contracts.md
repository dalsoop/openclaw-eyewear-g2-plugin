# 외부 계약

이 저장소의 소비자는 셋이다: (1) Even 앱이 부르는 Even AI 엔드포인트(우리 훅이 응답 본문을 정한다), (2) 사람과 감시자가 부르는 CLI, (3) 휴대폰이 받는 알림.

## 공통 약속

- CLI는 비밀값을 출력하지 않는다. 비밀값은 `~/.openclaw/openclaw.json`에서 직접 읽는다.
- CLI 출력은 영어 한 줄 요약이고 사람·안경·휴대폰에게 보이는 문구는 한국어 반말이다.
- 적용 명령은 다시 돌려도 결과가 같다. 다만 출력과 재시작은 명령마다 다르다.
  - `ocuclaw-patch.sh apply`, `even-ai-settings.sh apply`: 바꿀 것이 없으면 `already applied`를 출력하고 0으로 끝나며 Gateway를 건드리지 않는다. `ocuclaw-patch.sh all`도 apply가 바뀐 것이 없으면 재시작하지 않는다.
  - `patch-watch.sh install`: 같으면 `already installed`.
  - `apply-persona-locale.sh`, `apply-live-tick-allowlist.mjs`: `already applied`를 따로 출력하지 않고 같은 값을 매번 다시 쓴다(재시작 없음, 허용 목록은 `--restart`일 때만).
  - `apply-memory.sh`: 이미 된 단계(llama.cpp 플러그인, 임베딩 준비, 남은 `mcp.servers.aside` 제거)는 건너뛰지만 Gateway 재시작과 `memory index --force`는 매번 한다.
- OpenClaw CLI 경로는 모든 스크립트가 `OPENCLAW` 환경 변수 하나로 바꾼다(기본 `~/.local/bin/openclaw`).
- 종료 코드 64는 잘못된 하위 명령(사용법 출력), 1은 예상 밖 예외(스택 출력)다.

## Even AI 엔드포인트

- **경로**: 휴대폰에서 tailnet의 `:8443`(HTTPS), 로컬에서 `http://127.0.0.1:47800/v1/chat/completions`. `POST`만.
- **인증**: `Authorization: Bearer <evenAiToken>`.
- **입력**: OpenAI chat completions 모양. `{"model": "openclaw", "messages": [{"role": "user", "content": "<질문>"}]}`. Even 앱의 User-Agent는 `EvenCore/1.0`.
- **출력**: 성공·실패 모두 HTTP 200 JSON 완료 응답이고, 안경에 보일 글은 `choices[0].message.content` 하나다.
  - 정상: 그 실행의 대화 기록 최종 답을 다듬은 글(마크다운·이모지 없음, 350 코드포인트 이하, 잘렸으면 `…`로 끝남). 기록을 못 얻으면 스트림 누적 글, 그것도 없으면 `답을 못 가져왔어. 다시 물어봐 줘.`.
  - 인증 실패: `Authentication failed.`(영어 그대로, 에이전트 실행 없음).
  - 시간 초과(60초): `시간이 너무 걸렸어. 다시 물어봐 줘.`
  - 상위 실패: `답을 만들다 문제가 생겼어. 다시 물어봐 줘.`
  - Gateway 연결 끊김: `지금 리체랑 연결이 끊겼어. 잠시 뒤에 다시 해 줘.`
  - 그 밖의 OcuClaw 오류 문구는 원문 그대로.
- **세션**: 모든 요청이 안경 전용 세션 하나(`ocuclaw:even-ai`)에 이어진다.
- **보장하지 않는 것**: 응답이 전체 답이라는 것(전체는 대화 기록에만 있다), HTTP 상태 코드로 오류를 구분하는 것.

## `scripts/ocuclaw-patch.sh` (`ocuclaw-patch/cli.mjs`)

| 하위 명령 | 입력 | 출력 | 종료 코드 |
|---|---|---|---|
| `apply [--plugin-dir DIR]` | 플러그인 폴더(기본 `~/.openclaw/extensions/ocuclaw`) | `apply: patched <항목들>` 또는 `apply: already applied` | 0 성공, 2 기준 문자열을 못 찾았거나 `dist/index.js`가 없는 폴더(`apply: ABORTED, nothing written` + 기준 문자열이면 줄마다 `  missing anchor: <지점>`, 아무것도 쓰지 않음) |
| `check [--plugin-dir DIR]` | 같음 | `check: all patch points present`, `check: MISSING N patch point(s)` + 줄마다 `  missing: <지점>`, 또는 `check: all hooks present, payload differs from repo (…); run apply to update`. 저장소와 다른 payload 파일은 어느 경우든 줄마다 `  stale: <파일>` | 0 모두 있음, 3 훅이나 payload 파일이 빠짐, 5 훅·파일은 다 있으나 payload 내용이 저장소와 다름(낡음) |
| `verify-live [--endpoint URL] [--config FILE] [--transcript-db FILE]` | 실행 중인 Gateway | 질문별 `verify-live [<label>] OK|FAIL session=… run=… transcriptChars=… responseChars=… expectedChars=…`, 끝에 `verify-live: PASS` 또는 `FAIL (n)` | 0 통과, 4 실패 |
| `all` (셸) | 같음 | apply → 바뀌었으면 `openclaw gateway restart`와 연결 대기 → check → verify-live | 첫 실패 단계의 코드 |
| `test` (셸) | — | `node --test` 결과 | node 결과 |

지점 이름(검사 출력에 쓰이며 감시자 알림 본문에도 그대로 들어간다): `payload`(설치본 `dist/ocuclaw-g2/index.js`나 그것이 불러오는 파일이 없을 때. 저장소에만 새로 생긴 파일이나 내용만 다르면 빠짐이 아니라 `stale`), `endpoint-import`, `endpoint-final-reply`, `endpoint-korean-errors`, `client-import`, `client-assistant-delta`, `client-hello-features`, `context-import`, `context-compaction-skip`, `context-compaction-note`, `glasses-ui-import`, `glasses-ui-tick-api-key`. 이름을 바꾸면 이미 설치본에 들어간 표식과 맞지 않게 되어 검사가 빠짐으로 판정한다.

## `scripts/even-ai-settings.sh` (`even-ai-settings/cli.mjs`)

옵션: `--prompt-file`(기본 `persona/even-ai-system-prompt.txt`), `--store`(기본 `~/.openclaw/even-ai-settings.json`), `--config`, `--endpoint`, `--transcript-db`.

| 하위 명령 | 동작 | 종료 코드 |
|---|---|---|
| `apply` | 다르면 Gateway 멈춤 → 저장소 병합 쓰기 → config 두 키 → Gateway 시작, `Connectivity check: ok`까지 대기 → `check` | `check`의 코드. 프롬프트가 비었거나 4000 코드포인트 초과, 저장소 version이 1이 아니면 1 |
| `check` | `check: store ok|MISMATCH, config ok|MISMATCH` | 0 일치, 3 불일치 |
| `verify` | 질문 2개를 연달아 보내 같은 전용 세션, 맥락 이어짐, 반말·기호·되묻기 없음 확인 | 0 통과, 4 실패 |
| `test` | 단위 시험 | node 결과 |

## `scripts/patch-watch.sh` (`scripts/patch-watch.mjs`)

| 하위 명령 | 동작 | 종료 코드 |
|---|---|---|
| `install` | LaunchAgent `com.openclaw-g2.patch-watch`를 저장소 경로로 만들어 `launchctl bootstrap`. 같으면 `already installed` | 0, bootstrap 실패 1 |
| `uninstall` | `bootout` 후 plist 삭제 | 0 |
| `status` | 적재 여부와 감시 로그 마지막 15줄 | 0 |
| `run [--reason TEXT]` | 검사 1회 + 필요하면 알림(재시도 포함) | 0 알림 불필요(payload만 낡은 경우 포함, 로그만), 10 알림 보냄, 11 끝내 못 보냄, 12 검사 오류(알림 없음) |
| `watch` | 상주: Gateway 로그를 보다가 시작마다 `run` | 끝나지 않음 |
| `test` | 단위 시험 | node 결과 |

저장소 폴더를 옮기면 LaunchAgent가 옛 경로를 가리키므로 `install`을 다시 돌려야 한다.

## 휴대폰 알림

- **보내는 때**: Gateway 시작 뒤 검사에서 훅 표식이나 payload 파일이 빠졌을 때만(`check` 종료 코드 3). 정상, payload 내용만 저장소와 다를 때(5), 검사 오류일 때는 보내지 않는다.
- **수단**: `openclaw nodes notify --node <id> --title … --body … --priority timeSensitive`.
- **제목**: `OcuClaw 패치가 빠졌어`
- **본문**: `게이트웨이가 다시 켜졌는데 OcuClaw 패치 지점이 빠졌어: <지점들>. 이대로면 Hey Even 답이 첫 조각만 보여. <저장소 경로(~ 표기)>/scripts/ocuclaw-patch.sh apply 돌리고 openclaw gateway restart 해줘.`
- **재시도**: 30초 간격, 첫 시도부터 최대 600초. 같은 Gateway 시작에 대해 한 번만 보낸다.

## 나머지 스크립트

| 명령 | 입력 | 출력·종료 코드 |
|---|---|---|
| `scripts/backup.sh` | `OPENCLAW_HOME`(기본 `~/.openclaw`) | 표준 출력에 백업 폴더 경로 한 줄. 홈이 없으면 1 |
| `scripts/restore.sh <dir> [--no-restart]` | `openclaw.json`이 든 백업 폴더 | Gateway 정지 → 멈춘 것 확인(30초) → 복사(`openclaw.json`, `even-ai-settings.json`, 성격 파일 4개 `IDENTITY.md`·`SOUL.md`·`USER.md`·`AGENTS.md`, 플러그인 폴더) → 시작 → `Connectivity check: ok` 대기(60초). `--no-restart`면 정지·시작 없이 복사만. `restored from <dir>`. 폴더가 잘못되면 2, 30초 안에 안 멈추면 아무것도 쓰지 않고 1, 시작 뒤 연결 확인이 안 되면 1 |
| `scripts/apply-persona-locale.sh [--force]` | `persona/*.md` | 처음 설치 때 성격 파일 4개 복사(표식 `workspace/.openclaw-g2-installed` 생성). 이후에는 원본과 달라진 파일을 건너뛰고 `skip <파일>: changed since install`을 stderr에 찍는다. `--force`면 덮어쓴다. 설정 4개는 매번 적용 |
| `node scripts/apply-live-tick-allowlist.mjs [--dry-run] [--restart]` | 켜진 플러그인 목록 | 허용 목록 개수와 내용 출력. 켜진 목록이 비면 예외로 1 |
| `node scripts/check-live-tick-allowlist.mjs [--skip-tick]` | 실행 중인 Gateway, opencodex | 항목마다 `PASS|FAIL <이름>: <세부>`, `ALL CHECKS PASSED`면 0, 아니면 1. API 키는 길이만 출력 |
| `scripts/apply-memory.sh` | 대화형(질문 2개) | `browser.enabled=false`, `mcp.servers.aside`가 있으면 `openclaw mcp unset aside`(지운 줄이 출력된다). 재시작 뒤 `Connectivity check: ok`를 60초까지 기다린 다음 색인. 마지막에 Embeddings·Vector store 상태. 연결 확인이 안 되면 1 |
| `scripts/set-opencodex-key.sh` | 표준 입력(에코 꺼짐) | 키는 파이프로 `openclaw config patch --stdin`에 넘긴다(명령 인자에 남지 않음). 저장 안내 한 줄. 빈 입력이면 1 |
| `scripts/public-safety-scan.sh [--base REF] [--head REF] [--ocuclaw-dist DIR]` 또는 `--all [--ocuclaw-dist DIR]` | 기본 PR 모드: `origin/main..HEAD`(PR이 더하는 커밋, 공통 조상이 없으면 2)의 blob·메시지·메타데이터·금지 경로. `--all`: 모든 ref의 전체 이력. 두 모드 모두 인덱스·작업 트리·설치된 OcuClaw dist 검사 | 범위와 개수, `FAIL <위치>: <규칙>`(값은 출력 안 함). 위치는 `working tree …`, `index …`, `history …`, `commit message …`, `commit metadata …`. 전수 감사의 알려진 발견은 `(known baseline)`으로 표시하지만 그대로 실패. 0 깨끗함, 1 발견, 2 검사 불가(인자/ref/공통 조상/shallow/graft/index/dist/전수 감사 기준선 오류). `--all`과 `--base`·`--head` 혼용 불가 |
