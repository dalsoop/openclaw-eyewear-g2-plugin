# 현재 상태

기준: OpenClaw 2026.10.5, OcuClaw 2.1.2. "검증됨"은 아래 근거 명령을 실제로 돌려 통과한 것이고, "구현됨"은 코드는 있으나 그 경로를 실측하지 않은 것이다.

## 완료

| 기능 | 상태 | 근거 |
|---|---|---|
| 백업·복원 | 검증됨(복원은 가짜 CLI와 임시 홈) | `scripts/backup.sh`로 실제 백업을 만들었다(플러그인 파일 수 원본과 일치). `restore.sh`는 가짜 `openclaw`와 임시 홈으로 "강제 정지 → 멈춤 확인(`(not loaded)`) → 성격 파일 4개·설정·플러그인 복사 → 시작 → 연결 확인" 순서, 멈추지 않을 때 아무것도 쓰지 않음, 복사 실패 시 Gateway를 다시 켜고 안내함을 확인했다. 실제 설치본에 대한 복원 실행은 하지 않았다 |
| Hey Even 잘림 수정(delta 재조립 + 기록 기반 최종 답) | 검증됨 | 단위 시험, `scripts/ocuclaw-patch.sh verify-live` PASS(긴 답·마크다운 목록·한 문장 3건이 기록 최종 답을 다듬은 결과와 정확히 일치) |
| 기호 정리·350 코드포인트 길이 정책 | 기호 정리는 검증됨, 350 자르기는 단위 시험으로만 검증 | `ocuclaw-patch/test/reply-format.test.mjs` 경계 사례. 안경 프롬프트가 답을 350자 아래로 유도하므로 실측 긴 답도 205~228자였고, 실제 Gateway에서 350에서 잘리는 경로는 돌지 않았다 |
| 기록 조회 실패 시 대체(스트림 → 안내 문구) | 단위 시험으로 검증 | `ocuclaw-patch/test/final-reply.test.mjs`(오류, 시간 초과, 빈 답, 도구 턴). 실제 Gateway에서 강제 실패 스위치로 돌린 기록은 없다 |
| 오류 문구 한국어화 3종 | 단위 시험으로 검증 | `glue.test.mjs`. 실제 시간 초과·연결 끊김 상황은 재현하지 않았다 |
| `sessions.compaction.list` 건너뛰기 | 검증됨 | 단위 시험, Gateway 재시작 뒤 로그에 해당 오류 없음(hello `features.methods` 기준으로 호출 안 함) |
| 패처 적용·검사(멱등, 전부 아니면 전무, 지점 지목) | 검증됨 | `patcher.test.mjs`(깨끗한 사본 기준), 실제 설치본 `check: all patch points present` |
| 리체 성격·한국어·시간대 | 검증됨 | 설정 4개 값 확인. 별도 세션에서 영어로 "What's your name, and what language do you usually reply in?"를 보내자 "내 이름은 리체야. 보통 한국어 반말로 짧게 답해."로 답했다. 성격 파일은 처음 설치 뒤 달라진 파일을 건너뛴다(`--force`로 덮어씀) |
| Hey Even 전용 세션 + 안경 프롬프트(config·앱 안 저장소) | 검증됨 | `scripts/even-ai-settings.sh check`, `verify` PASS(연속 2건이 같은 전용 세션, 맥락 이어짐, 반말·기호 없음) |
| 실시간 화면 tick | 검증됨(자리 채움 키로, 리체 전용 opencodex 키는 아직 발급 전) | `check-live-tick-allowlist.mjs`: 실제 tick 1회 응답, opencodex 사용 기록 HTTP 200, `no tick backend` 경고 없음. tick 키 조회 TypeError는 `glasses-ui-tick-api-key` 훅으로 고침 |
| `plugins.allow`(44개, `browser` 제외) | 검증됨 | 켜진 목록 == 허용 목록 |
| 로컬 기억 검색(llama.cpp 임베딩) | 검증됨 | `openclaw memory status --deep --agent main`에서 Embeddings·Vector store ready |
| 내장 브라우저 끔, Aside MCP 제거(결정 0008) | 구현됨, 가짜 CLI로 검증 | `scripts/apply-memory.sh`는 Aside를 등록하지 않고, `mcp.servers.aside`가 있을 때만 `openclaw mcp unset aside`로 지운다. 호출을 기록하는 가짜 `openclaw`로 "있으면 한 번 지우고, 다시 돌리면 건너뜀"을 확인했다. 실제 설치본에서는 돌리지 않았다. 설치본의 `mcp.servers.aside` 제거는 저장소 밖 작업(2026-10-30)이 맡았고 여기서 확인하지 않았다. 리체에게는 브라우저 도구가 없다 |
| Gateway 시작 검사·휴대폰 알림 | 검증됨 | 패치를 뺀 상태로 재시작 → 감시 로그 `ALERT SENT`, 다시 넣고 재시작 → `check ok`, 알림 없음. 휴대폰 수신 자체는 사용자 확인 사항 |
| 공개 안전 검사 | PR 범위 검사와 전수 감사 분리, 임시 저장소 시험 21개 통과 | 기본 PR 모드는 PR이 더하는 커밋(`base..head`)의 내용·메타데이터와 인덱스·작업 트리를 검사한다. `--all`은 모든 ref를 검사하며 PR #1 병합 커밋의 메타데이터 2건을 계속 FAIL로 보고한다. `docs/public-safety-baseline.json`은 기록용이며 면제하지 않는다 |
| 단위 시험 전체 | 124개 통과 | `node --test ocuclaw-patch/test/ even-ai-settings/test/ scripts/lib/ scripts/patch-watch/` |

## 남은 일 (우선순위 순)

1. **기존 공개 메타데이터 감사**: PR #1 병합 커밋의 개인 이메일 노출 사실은 `findings.md`, SHA·두 발견의 사유는 `docs/public-safety-baseline.json`에 기록했다. main 이력은 다시 쓰지 않는다. PR 게이트와 별개로 `--all`은 기존 발견을 계속 FAIL로 보고하므로 결과를 구분해 기록한다. PR 병합은 병합 계정의 GitHub 이메일 비공개 설정이 켜진 뒤에 rebase로 하고, 직후 병합 범위를 검사한다(`docs/operations.md`, `findings.md`).
2. **설치본 성격 파일의 브라우저 절**: 설치본 workspace의 `AGENTS.md`에는 옛 "웹 작업에는 Aside를 쓴다" 절이 남아 있다(2026-10-30 확인, 저장소의 옛 원본과 같았다). `apply-persona-locale.sh`는 처음 설치 뒤 달라진 파일을 건너뛰므로 저절로 바뀌지 않고, `--force`는 설치 뒤 달라진 `USER.md`까지 덮어쓴다. `scripts/backup.sh` 뒤 `persona/AGENTS.md` 하나만 workspace로 복사한다.
3. **사람 단계**: 휴대폰 OS·Even 앱 언어 확인, `openclaw ocuclaw pair` 페어링 기록, `openclaw ocuclaw first-use` 첫 사용 확인, `openclaw ocuclaw journey` 확인. 에이전트가 대신할 수 없다.
4. **리체 전용 opencodex 키 발급과 입력**: 아직 발급하지 않았다. 지금 설정에는 자리 채움 값이 들어 있고 tick 검증도 그 값으로 했다. 발급 후 `scripts/set-opencodex-key.sh` → `openclaw gateway restart` → `node scripts/check-live-tick-allowlist.mjs`.
5. **리체의 웹 도구**: Aside를 뺀 뒤(결정 0008) 리체에게 브라우저 도구가 없다. 다시 붙이려면 사용자가 붙일 도구와 승인 정책을 먼저 정한다(`findings.md`).
6. **OcuClaw 개발자에게 버그 보고**: delta 전용 assistant 프레임 미처리, tick 모델을 문자열로 넘기는 키 조회, 미지원 메서드 호출. 정식 수정이 나오면 해당 패치 지점을 지운다.
7. **opencodex 모델 목록 동기화**: opencodex에 새 모델이 생기면 OpenClaw 모델 목록에 손으로 반영하고 있다. 자동화하지 않았다.
8. **사설 도메인 이름**(예: 내부 전용 `.kr` 이름으로 접근): 보류 중.

## 막힌 것

- 3·4번은 사람만 할 수 있다.
- 5번은 사용자가 붙일 도구와 승인 정책을 정해야 한다.
- 1번의 기존 공개 이력 노출은 남아 있다. 전수 감사에서 계속 보고하며 새 PR 게이트의 성공으로 숨기지 않는다.
- PR 병합은 계정 소유자가 GitHub 이메일 비공개 설정을 켜야 할 수 있다(사용자 결정).
