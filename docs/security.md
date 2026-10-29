# 보안 정책

## 보호 대상

| 자산 | 위치 | 왜 민감한가 |
|---|---|---|
| Even AI 토큰(`evenAiToken`) | `~/.openclaw/openclaw.json`의 `plugins.entries.ocuclaw.config` | 있으면 tailnet 안 누구나 리체에게 Hey Even 질문(= 리체가 이 Mac에서 할 수 있는 동작 포함)을 보낼 수 있다 |
| relay 자격 증명(`relayToken`) | 같은 위치 | OcuClaw 앱 대화 경로 |
| Gateway 토큰 | `openclaw.json`의 `gateway.auth` | 휴대폰 OpenClaw 앱의 operator 권한 |
| opencodex 키(`models.providers.opencodex.apiKey`) | `openclaw.json` | 모델 사용량·비용 귀속 |
| Soniox 키(`sonioxApiKey`) | `plugins.entries.ocuclaw.config` | 유료 음성 인식(월 한도 $5, $3에서 알림) |
| 대화 기록 DB | `~/.openclaw/agents/main/agent/openclaw-agent.sqlite` | 사용자의 모든 대화 |
| tailnet 호스트 이름·IP | Tailscale 설정 | 저장소가 공개되므로 접근 경로 노출 |
| 페어링된 휴대폰의 노드 ID·이름 | `openclaw nodes status`, 감시 로그 | 개인 기기 식별 정보 |
| 백업 | `~/.openclaw/backups/<시각>/`(폴더 권한 700) | 위 비밀값이 모두 든 `openclaw.json` 사본 |

## 접근 경로와 인증

1. **네트워크**: 휴대폰은 tailnet에 들어와야만 이 Mac에 닿는다. `tailscale serve`(:8443 Even AI, :8444 relay, :8460 Gateway)만 쓰고 funnel은 쓰지 않는다. tailnet 밖에서 오는 요청은 경로 자체가 없다.
2. **Hey Even**: `Authorization: Bearer <evenAiToken>`. 토큰이 없거나 틀리면 OcuClaw가 HTTP 200 완료 응답의 본문으로 `Authentication failed.`를 돌려주고 에이전트는 실행되지 않는다. 이 문구는 한국어화하지 않는다.
3. **OcuClaw 앱**: relay 자격 증명. 페어링 기록(`openclaw ocuclaw pair`, 화면과 휴대폰의 안전 단어 4개 대조)과 첫 사용 확인은 사람이 자기 터미널에서만 한다. 에이전트는 이 절차를 실행하거나 화면을 가져가지 않는다(OcuClaw가 명시적으로 금지).
4. **Gateway**: 토큰 인증. 프록시 헤더는 `trustedProxies 127.0.0.1/32`, 즉 같은 Mac의 `tailscale serve`만 신뢰한다. 다른 주소가 보낸 전달 헤더는 믿지 않는다.
5. **opencodex**: 리체 전용 키를 쓰는 것이 정책이다. 지금 opencodex는 loopback 호출의 키를 검사하지 않아, 전용 키가 발급되기 전까지 자리 채움 값이 들어 있다. opencodex가 loopback 키 검사를 시작하면 모든 모델 호출과 tick이 그 순간 실패한다.

## 권한

| 주체 | 할 수 있는 일 | 할 수 없는 일 |
|---|---|---|
| 페어링된 휴대폰(OpenClaw 앱) | operator·node 권한: 리체와 대화, 알림 수신(`system.notify`) | tailnet 밖에서 접속 |
| Even 앱(Hey Even) | 안경 전용 세션 하나에 질문 | 다른 세션 열람, 성격 질문 받기 |
| 리체 | 이 Mac에서 사용자 권한 전체(파일, 명령) | 브라우저 도구로 웹 계정 다루기(붙인 도구가 없다), 사용자가 시키지 않은 외부 공개 행동, 부탁받지 않은 사적 데이터 공유 |
| 저장소 스크립트 | `~/.openclaw/` 설정·플러그인 변경, Gateway 재시작, 휴대폰 알림 | 비밀값 출력, opencodex·Tailscale 설정 변경 |
| 에이전트(개발 작업자) | 스크립트 실행, 비밀값이 "설정되어 있는지" 확인 | 비밀값 값 보기·입력, 페어링·첫 사용 의식 실행 |

**리체에게는 브라우저 도구가 없다.** 내장 브라우저는 꺼져 있고(`browser.enabled = false`, 허용 목록에서 제외), 로그인된 웹 계정으로 확인 없이 쓰기 동작을 하던 Aside MCP(`--approval approve`, 결정 0005)는 2026-10-30 사용자 결정으로 뺐다(결정 0008). 0005의 자동 승인은 Aside 한 도구에 대해 사용자가 위험을 듣고 고른 것이므로 다른 도구로 옮기지 않는다. 리체에게 웹 도구(브라우저, MCP 서버)를 새로 붙이거나 내장 브라우저를 다시 켜려면, 붙일 도구와 그 승인 정책(확인 없이 실행할지, 동작마다 확인받을지)을 사용자가 먼저 정하고 새 결정으로 남긴다. 그 전에는 MCP 서버를 추가하지 않는다.

## 감사

별도 감사 기록은 두지 않는다. 추적은 다음으로 한다.

- 리체가 한 일: OpenClaw 대화 기록(세션별, Hey Even은 안경 전용 세션).
- 접속·플러그인 로드·경고: `~/Library/Logs/openclaw/gateway.log`. 우리 훅은 Hey Even 응답마다 `[ocuclaw-g2] even-ai reply run=… source=transcript|stream|notice chars=… streamChars=…`(실패 이유 포함)를 남기며, 답 내용은 남기지 않는다.
- 모델 사용량: `~/.opencodex/usage.jsonl`(전용 키가 생기면 키 기준으로 분리된다).
- 패치 상태와 알림: `~/.openclaw/ocuclaw-g2/patch-watch.log`. 알림 전송 결과에는 노드 ID 앞 8자만 쓴다.

## 비밀값 다루기

- **저장 위치**: 모든 비밀값은 `~/.openclaw/openclaw.json` 한 곳에만 있다. 저장소, 커밋 메시지, 로그, 화면 출력에 넣지 않는다.
- **입력**: opencodex 키는 사람이 발급하고(opencodex 규칙상 사람만 발급) 사람이 `scripts/set-opencodex-key.sh`로 넣는다. 이 스크립트는 에코를 끄고 읽어 `openclaw config set`에 넘기며 셸 기록에 남지 않는다. 에이전트는 값을 보지 않고 설정 여부(길이 등)만 확인한다.
- **사용**: 비밀값으로 요청을 보낼 때는 `openclaw.json`을 직접 읽어 요청 헤더에만 넣는다. `openclaw config get`은 가려진 값을 돌려주므로 요청에 쓸 수 없다.
- **백업**: 백업 폴더는 저장소 밖이고 권한 700이다. 백업을 저장소로 복사하지 않는다.
- **회전·폐기**: 자동 회전은 없다. 키를 바꿀 때는 같은 키 경로에 새 값을 넣고 Gateway를 재시작한다. 오래된 백업에는 옛 비밀값이 남아 있으므로 키를 폐기했다면 그 백업도 같은 등급으로 다룬다.

## 공개 저장소 규칙

저장소는 GitHub에 공개된다. 이력 전체에 다음이 있으면 안 된다.

- 토큰·키(Even AI, relay, Gateway, opencodex, Soniox), `openclaw.json` 원본, 대화 DB.
- tailnet 호스트 이름과 tailnet IP(CGNAT 대역 100.64/10). 포트 번호와 `127.0.0.1`은 괜찮다.
- 휴대폰 이름·노드 ID, 기기 모델명, 개인 이메일.
- OcuClaw 원본 코드(라이선스 표시 없음). 기준 문자열(한 줄 이하의 짧은 문자열)만 허용된다.
- 로컬 작업 메모 폴더(`.gitignore` 대상).

PR을 올리기 전 `scripts/public-safety-scan.sh --base origin/main --head HEAD`가 PR이 더하는 커밋(`origin/main..HEAD`)의 blob·메시지·작성자/커미터 메타데이터·금지 경로와 인덱스·작업 트리를 검사한다. 실패하면 push하지 않는다. main에 이미 공개된 커밋은 PR의 새 노출이 아니므로 PR 게이트에서는 제외하되, `--all` 전수 감사에서는 계속 검사한다. `docs/public-safety-baseline.json`은 기존 발견의 SHA·이유를 기록할 뿐이며 전수 감사의 `FAIL`과 종료 코드 1을 숨기지 않는다. 이미 공개된 개인 이메일의 값은 다시 문서에 쓰지 않고 `findings.md`에 노출 사실만 적는다. main 이력을 force-push하지 않는다(`standards.md`의 2026-10-30 정책).
