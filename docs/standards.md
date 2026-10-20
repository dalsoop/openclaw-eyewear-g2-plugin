# 규칙

## 실행 장소

- 모든 스크립트는 OpenClaw Gateway가 도는 그 Mac 한 대에서만 실행한다. 다른 Mac에 SSH로 들어가 스크립트·테스트를 돌리지 않는다. 이 저장소에는 무거운 빌드가 없다.
- `~/.openclaw/openclaw.json`과 Gateway 재시작은 모든 적용 스크립트가 공유한다. 적용 스크립트 두 개를 동시에 돌리지 않는다(한 번에 하나, 끝난 뒤 다음).

## 공개 저장소에 들어가면 안 되는 것

- 비밀값(토큰, API 키, `openclaw.json` 원본, 대화 DB), tailnet 호스트 이름, tailnet IP(100.64/10 대역), 휴대폰 이름·노드 ID, 기기 모델명, 이메일 주소를 커밋·커밋 메시지·문서·테스트 고정값에 넣지 않는다. 포트 번호와 `127.0.0.1`은 허용된다. 커밋 작성자·커미터 이메일은 `@users.noreply.github.com` 주소여야 한다.
- 스크립트는 이런 값을 실행 시 로컬 설정에서 읽는다. 저장소에 기본값으로 박지 않는다(예: 휴대폰 노드는 `openclaw nodes status --json`에서 고른다).
- OcuClaw 원본 코드를 복사하지 않는다. 허용되는 것은 훅 위치를 찾는 한 줄짜리 기준 문자열뿐이다. 원본과 연속 4줄 이상(공백 제외 40자 이상)이 같거나 파일이 바이트 단위로 같으면 위반이다.
- `.gitignore`에 든 경로를 `git add -f`로 넣지 않는다.
- **검증 게이트**: 커밋을 올리기 전 `scripts/public-safety-scan.sh`가 `public-safety-scan: clean`으로 끝나야 한다(종료 코드 0). 1이면 올리지 않는다. 2(OcuClaw dist를 못 찾음)는 통과가 아니다. 이 검사는 설치된 OcuClaw를 기준으로 비교하므로 OcuClaw가 설치된 Mac에서만 의미가 있다.
- 검사 규칙의 정규식은 문자열을 쪼개 조립한다. 검사 스크립트 자신이나 문서에 검사 대상 패턴(tailnet 도메인 접미사, `Bearer` 뒤 긴 토큰, 키 접두어)을 그대로 쓰면 자기 자신이 걸린다.

## 비밀값을 다루는 코드

- 비밀값을 표준 출력·표준 오류·로그에 쓰지 않는다. 출력이 필요하면 "설정됨/길이 N"만 쓴다.
- 비밀값이 필요한 요청은 `openclaw.json`을 직접 파싱해 HTTP 헤더에만 넣는다. `openclaw config get`의 결과(가려진 값)를 요청에 쓰지 않는다.
- 사람이 넣어야 하는 비밀값(opencodex 키)을 스크립트·에이전트가 대신 넣지 않는다. `scripts/set-opencodex-key.sh`처럼 에코를 끈 입력만 제공한다.

## 설정 변경

- 설정·성격 파일·`even-ai-settings.json`·OcuClaw 플러그인 폴더를 바꾸기 전에 `scripts/backup.sh`를 먼저 돌린다. 백업 없이 바꾸는 스크립트를 새로 만들지 않는다.
- 설정은 `openclaw config set`/`config patch`/`--batch-json`으로 자기 키만 바꾼다. `openclaw.json`을 직접 덮어쓰지 않는다(복원 스크립트는 예외).
- 기존 항목을 지우는 `config set`은 `--replace`가 필요하다. 지울 대상을 먼저 확인한 뒤에만 쓴다.
- `plugins.allow`는 배타 목록이다. 손으로 목록을 적지 않고 반드시 `openclaw plugins list --enabled --json`의 현재 목록에서 계산한다(`scripts/lib/live-tick-allowlist.mjs`의 `computeAllowlist`). 계산 결과가 비면 설정하지 않는다. 새 플러그인을 켤 때는 허용 목록에도 넣어야 한다(빠지면 그 플러그인은 꺼진다).
- `~/.openclaw/even-ai-settings.json`은 Gateway가 멈춘 상태에서만 쓴다. 쓰기 전에 멈춘 뒤의 파일을 다시 읽고, `routingMode`·`systemPrompt` 외 필드는 보존한다. 저장소 `version`이 1이 아니면 쓰지 않고 멈춘다.
- Hey Even 시스템 프롬프트는 config(`plugins.entries.ocuclaw.config.evenAiSystemPrompt`)와 앱 안 저장소 양쪽에 같은 값으로 넣는다. 한쪽만 바꾸면 위반이다. 프롬프트 원본은 `persona/even-ai-system-prompt.txt` 하나이며, 앞뒤 공백을 지운 뒤 1~4000 코드포인트여야 한다.
- Tailscale serve 경로(:8443, :8444, :8445, :8460), opencodex 설정, 모델 목록, OpenClaw 버전은 이 저장소에서 바꾸지 않는다. OcuClaw 버전을 고정하지 않는다.
- Gateway를 재시작한 스크립트는 `openclaw gateway status`에 `Connectivity check: ok`가 나올 때까지 기다린 뒤 다음 단계로 간다.

## OcuClaw 주입 코드

- 원본 파일에 들어가는 것은 한 줄 훅뿐이고, 모든 훅 줄 끝에 `/* ocuclaw-g2:<지점 이름> */` 표식이 있어야 한다. 로직은 `ocuclaw-patch/payload/`에만 둔다.
- 새 패치 지점은 `ocuclaw-patch/patcher.mjs`의 `PATCH_POINTS`에만 추가한다. 기준 문자열은 대상 파일 안에서 정확히 한 번만 나와야 한다.
- 주입 코드는 OcuClaw의 기존 동작을 깨는 예외를 던지지 않는다. Hey Even 응답 함수는 빈 문자열을 돌려주지 않고, tick 키 조회는 실패 시 빈 문자열을 돌려준다.
- 주입 코드는 의존성 없는 ES 모듈(`node:` 내장 모듈만)이어야 한다. 설치본의 `node_modules`에 의존하지 않는다.
- 조정값은 환경 변수(`OCUCLAW_G2_*`)로 받고, 잘못된 값이면 기본값으로 돌아간다.

## 시험

- 단위 시험: `/opt/homebrew/opt/node/bin/node --test ocuclaw-patch/test/ even-ai-settings/test/ scripts/lib/ scripts/patch-watch/`가 모두 통과해야 한다(지금 103개). 주입 코드, 다듬기 규칙, 허용 목록 계산, 감시 판단 로직을 바꾸면 이 명령을 돌린다.
- 다듬기 규칙(기호 정리·길이 정책)을 바꾸면 경계 사례 시험(정확히 350, 351, 경계 없음, `다.` 끝, 이모지만, 빈 답, `…` 중복)을 함께 고친다.
- 패치 지점을 바꾸면 깨끗한 원본 사본 기준 시험(`ocuclaw-patch/test/patcher.test.mjs`: 원본은 전부 빠짐, 적용 후 통과, 두 번 적용해도 변화 없음, 훅 하나 지우면 그 지점만 지목, 기준 문자열 하나 없으면 아무것도 안 씀)이 통과해야 한다.
- 설치본에 영향을 주는 변경은 단위 시험만으로 통과가 아니다. `scripts/ocuclaw-patch.sh all`(적용 → 재시작 → 검사 → `verify-live`)이 `verify-live: PASS`로 끝나야 한다.
- 시험은 진짜 `~/.openclaw` 설치본을 바꾸지 않는다. 임시 폴더 사본이나 `OPENCLAW_HOME`/`--plugin-dir`/`--store`/`--config` 옵션을 쓴다.

## 스크립트 모양

- 모든 적용·설치 명령은 다시 돌려도 결과가 같아야 한다. 바꿀 것이 없을 때 `already applied`를 찍고 아무것도 하지 않는 것은 `ocuclaw-patch.sh apply`·`all`과 `even-ai-settings.sh apply`(`patch-watch.sh install`은 `already installed`)이고, 나머지 적용 스크립트는 같은 값을 다시 쓴다. `apply-memory-aside.sh`는 매번 Gateway를 재시작하고 색인을 다시 만든다(명령별 동작은 `docs/contracts.md`의 공통 약속).
- 셸 진입점은 `scripts/*.sh`이고 POSIX `sh` + `set -eu`다. 로직이 있는 것은 Node ES 모듈(`.mjs`)로 쓰고, 입출력 없는 판단 로직은 별도 `lib` 파일로 떼어 시험한다.
- Node 경로는 `NODE` 환경 변수, OpenClaw 경로는 `OPENCLAW` 환경 변수로 바꿀 수 있어야 한다. 셸·Node 스크립트 모두 같은 이름을 쓰고, `openclaw`를 PATH에서 바로 부르지 않는다. 기본값은 `/opt/homebrew/opt/node/bin/node`, `~/.local/bin/openclaw`.
- 종료 코드는 의미가 있다. 검사 명령은 빠짐·불일치에 0이 아닌 고정 코드를 쓰고, 다른 스크립트(감시자)가 그 코드를 해석한다. 기존 코드의 뜻을 바꾸지 않는다.
- 코드 주석·로그·CLI 출력은 영어, 사용자(휴대폰·안경)에게 보이는 문구는 한국어 반말이다.

## 커밋과 브랜치

- GitHub `main`은 PR로만 바꾼다. 원격 `main`에 직접 push하지 않는다.
- 커밋 메시지는 영어 명령형 한 줄 제목이다.
- 커밋에 비밀값이 섞였으면 그 커밋을 올리지 않는다. 이미 올렸다면 키를 폐기하고 이력을 다시 쓴다.
