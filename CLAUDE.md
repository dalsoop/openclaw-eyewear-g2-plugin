# openclaw-g2

개인용 AI 에이전트 "리체"(OpenClaw `main` 에이전트)를 G2 안경(OcuClaw 플러그인, Hey Even)과 함께 쓰기 위한 설정 스크립트와 OcuClaw 보완 코드 모음이다. 사용자는 한 명, 실행 장소는 OpenClaw Gateway가 도는 Mac 한 대이며, 저장소 코드는 그 Mac의 `~/.openclaw/` 설치본을 바꾸고 검사한다. 서비스·빌드·배포 파이프라인은 없고, Node ES 모듈과 POSIX 셸 스크립트, `node --test` 단위 시험이 전부다. 저장소는 GitHub에 공개된다.

## 프로젝트 구조

```
openclaw-g2/
├── CLAUDE.md                          ← 이 파일(AGENTS.md와 같은 내용)
├── AGENTS.md                          ← 이 파일(CLAUDE.md와 같은 내용)
├── docs/
│   ├── architecture.md                ← 구성 요소, 포트, Hey Even 요청 흐름, 주입 구조, 감시 흐름
│   ├── business-rules.md              ← 리체의 말, 최종 답 결정, 기호·길이 정책, 오류 문구, 패치 상태, 알림 규칙
│   ├── security.md                    ← 보호 자산, 접근 경로·인증, 권한(Aside 자동 승인 포함), 비밀값, 공개 규칙
│   ├── standards.md                   ← 반드시 지킬 규칙: 공개 금지 항목, 설정 변경 방식, 주입 코드 규칙, 시험 게이트
│   ├── engineering-notes.md           ← 잘림 원인, tick 키 버그, 허용 목록 함정, 설정 저장소 우선순위, 재적용 체크리스트
│   ├── operations.md                  ← 설치 순서, 사람 단계, 재적용, 되돌리기, 검사 명령, 설정 키·환경 변수
│   ├── contracts.md                   ← Even AI 응답 계약, CLI 하위 명령·출력·종료 코드, 휴대폰 알림 문구
│   └── tracking/
│       ├── status.md                  ← 기능별 구현·검증 상태와 남은 일
│       ├── decisions/
│       │   ├── index.md               ← 결정 기록 목록
│       │   └── NNNN-*.md              ← 개별 결정(패치 방식, 기록 기반 최종 답, 허용 목록, 알림만, Aside, 전용 세션, tick 키)
│       └── findings.md                ← 지금 풀 수 없는 문제와 그 이유
├── ocuclaw-patch/
│   └── AGENTS.md                      ← OcuClaw 주입 코드·패처·실측 비교의 범위와 불변 조건
├── even-ai-settings/
│   └── AGENTS.md                      ← Hey Even 라우팅·프롬프트를 config와 앱 안 저장소에 쓰는 규칙
├── scripts/
│   ├── AGENTS.md                      ← 진입 스크립트, 설정 적용, 백업·복원, 공개 안전 검사
│   └── patch-watch/
│       └── AGENTS.md                  ← Gateway 시작 감지 → 패치 검사 → 휴대폰 알림 감시자
└── persona/                           ← 리체에게 주는 성격 파일 원본(개발 지침 아님)
```

`persona/AGENTS.md`는 리체의 작업 공간 규칙으로 `~/.openclaw/workspace/`에 복사되는 내용물이다. 이 저장소를 고치는 지침으로 읽지 말고, 개발 지침 파일로 바꾸지도 않는다.

## 반드시 지킬 것

1. **공개 저장소에 비밀값·개인 정보·OcuClaw 원본을 넣지 않는다.** 토큰·키, `openclaw.json` 원본, 대화 DB, tailnet 호스트 이름과 IP, 휴대폰 이름·노드 ID, 이메일, OcuClaw 원본 코드(한 줄 기준 문자열만 허용). 올리기 전 `scripts/public-safety-scan.sh`가 clean이어야 한다.
2. **비밀값은 보지도 출력하지도 않는다.** 스크립트는 `~/.openclaw/openclaw.json`에서 읽어 요청 헤더에만 넣는다. opencodex 키 발급·입력, 페어링(`openclaw ocuclaw pair`)과 첫 사용 확인(`first-use`)은 사람만 한다.
3. **설치본을 바꾸기 전에 `scripts/backup.sh`.** `openclaw.json`, 성격 파일, `even-ai-settings.json`, OcuClaw 플러그인 폴더가 대상이다. 적용 스크립트는 한 번에 하나씩 돌린다(같은 설정 파일과 Gateway 재시작을 공유한다).
4. **`plugins.allow`는 배타 목록이다.** 손으로 적지 말고 켜진 플러그인 목록에서 계산한다. 빈 목록이나 빠진 ID는 그 플러그인들을 끈다.
5. **OcuClaw 패치는 전부 아니면 전무, 원본에는 표식 달린 한 줄 훅만.** 로직은 `ocuclaw-patch/payload/`에만 두고, Tailscale serve·opencodex 설정·OpenClaw/OcuClaw 버전은 이 저장소에서 바꾸지 않는다.

전체 규칙은 `docs/standards.md`에 있다.

## 작업 전에 읽을 것

- 항상: `docs/standards.md`, `docs/engineering-notes.md`, 고칠 폴더의 `AGENTS.md`.
- 패치 지점·주입 코드를 고칠 때: `ocuclaw-patch/AGENTS.md`의 불변 조건과 훅이 기대는 OcuClaw 지역 변수, `docs/engineering-notes.md`의 잘림 원인과 "OcuClaw 업데이트 뒤" 체크리스트. 그 뒤 실제 설치본에서 `scripts/ocuclaw-patch.sh all`이 `verify-live: PASS`까지 가야 한다.
- 안경 답의 모양(기호 정리, 350 코드포인트, 대체 순서, 오류 문구)을 바꿀 때: `docs/business-rules.md`의 Hey Even 절과 `docs/contracts.md`의 Even AI 엔드포인트 절. `verify-live`의 기대값도 같은 함수에서 나오므로 함께 바뀐다.
- `check` 출력이나 종료 코드를 바꿀 때: `scripts/patch-watch/AGENTS.md`. 감시자가 그 형식을 해석한다.
- Hey Even 프롬프트·라우팅을 바꿀 때: `even-ai-settings/AGENTS.md`(Gateway를 멈추고 써야 하는 이유).
- 플러그인을 켜고 끄거나 tick 설정을 바꿀 때: `docs/engineering-notes.md`의 허용 목록·tick 키 항목.
- 문서·스크립트에 경로·호스트·값을 적을 때: `docs/security.md`의 공개 저장소 규칙.
- 리체의 권한이나 Aside 승인 정책을 건드릴 때: `docs/tracking/decisions/0005-aside-auto-approve.md`. 사용자 결정 없이 바꾸지 않는다.

## 문제가 생기면

바로 사용자에게 알리고 멈출 것:
- 비밀값, tailnet 호스트 이름·IP, 휴대폰 식별 정보, OcuClaw 원본 코드가 커밋되었거나 push되었다(키는 폐기 대상).
- 패치 적용 뒤 Gateway가 OcuClaw 로드를 거부하거나 `Connectivity check: ok`로 돌아오지 않는다(백업으로 되돌린 뒤 보고).
- `plugins.allow` 적용 뒤 켜진 플러그인 목록과 허용 목록이 다르다(플러그인이 조용히 꺼졌다).
- Hey Even 응답이 다시 잘리거나 `verify-live`가 FAIL이다.
- 리체가 사용자가 시키지 않은 Aside 쓰기 동작을 했다는 흔적이 있다.
- 작업이 사람만 할 수 있는 단계(키 입력, 페어링, 첫 사용 확인)를 요구한다.

그 밖에 지금 풀 수 없는 문제는 `docs/tracking/findings.md`에 현상·영향·지금 못 고치는 이유·방법으로 적는다.
