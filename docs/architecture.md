# 시스템 구성

## 전체 그림

이 저장소는 실행되는 서비스가 아니다. Mac 한 대에 설치된 OpenClaw(2026.10.5)와 그 위의 OcuClaw 플러그인(2.1.2)을 **바꾸고 검사하는 스크립트와 주입 코드**다. 실행 주체는 언제나 이 Mac의 사용자 계정이고, 바뀌는 대상은 저장소 밖 `~/.openclaw/` 아래의 설치본이다.

```
휴대폰 Even 앱 (Hey Even) ──HTTPS :8443──┐
휴대폰·안경 OcuClaw 앱 ─────TLS TCP :8444──┼─ tailscale serve ─▶ OcuClaw relay 127.0.0.1:47800 ─┐
휴대폰 OpenClaw 앱 ─────────HTTPS :8460──┘                                                        │
                                   └────────▶ OpenClaw Gateway 127.0.0.1:18789 ◀── WebSocket ─────┘
                                                   │  (LaunchAgent ai.openclaw.gateway)
                                                   ├─▶ opencodex 허브 127.0.0.1:10100/v1 (모든 모델 호출)
                                                   ├─▶ llama.cpp 로컬 임베딩 (기억 검색)
                                                   └─▶ aside mcp (stdio, 웹 도구)
```

- 휴대폰은 tailnet 안에서만 들어온다. 네 경로 모두 `tailscale serve`이고 funnel은 쓰지 않는다. `:8445`는 opencodex 포워더(이전에 8443을 쓰다 옮김)로, 이 저장소와 관계없지만 같은 Mac의 serve 설정에 있어 함께 건드리지 않는다.
- OcuClaw는 Gateway 안에 로드되는 플러그인이다. relay 포트(47800)에서 OcuClaw 앱 연결과 Even AI HTTP 엔드포인트(`/v1/chat/completions`)를 함께 받고, 에이전트 실행은 Gateway에 WebSocket 클라이언트(`gateway/openclaw-client.js`)로 붙어 요청한다.
- 에이전트는 OpenClaw의 `main` 에이전트(이름 "리체")다. 성격 파일은 `~/.openclaw/workspace/`에, 대화 기록은 `~/.openclaw/agents/main/agent/openclaw-agent.sqlite`에 있다.

## 대표 흐름: Hey Even 질문 하나

1. Even 앱이 `:8443`으로 OpenAI 호환 `POST /v1/chat/completions`를 보낸다(Bearer `evenAiToken`).
2. OcuClaw 엔드포인트가 토큰을 확인하고, 라우팅 모드 `background`이므로 안경 전용 세션(`ocuclaw:even-ai`, Gateway 쪽 키는 `agent:main:ocuclaw:even-ai`)에서 에이전트 실행을 시작한다. 시스템 프롬프트는 앱 안 설정 저장소(`~/.openclaw/even-ai-settings.json`)의 값이 config 값보다 우선한다.
3. Gateway가 모델을 opencodex로 부르고, 결과를 assistant 이벤트로 흘려보낸다. 2026.10.5 Gateway는 첫 프레임에만 전체 `text`를 싣고 이후 프레임은 `{itemId, delta}`만 보낸다.
4. OcuClaw 클라이언트의 assistant 처리 앞에 끼운 우리 훅이 delta를 이어 붙여 `text`를 다시 만든다(원래는 `text`가 문자열일 때만 버퍼를 갱신해 첫 조각에서 멈췄다).
5. lifecycle `end`에서 OcuClaw가 버퍼를 `message`로 내보내면 Even AI 대기자가 확정되고, 엔드포인트가 응답 본문을 만든다. 이 지점의 원래 이모지 필터 호출을 우리 훅이 대체해, Gateway에 `chat.history`(최근 40개)를 250ms 간격으로 최대 5초 조회해 그 실행(runId)의 최종 어시스턴트 답을 얻는다. 실패하면 스트림 누적 텍스트, 그것도 비면 안내 문구를 쓴다.
6. 고른 글을 기호 정리 → 공백 정리 → 350 코드포인트 문장 경계 자르기로 다듬어 HTTP 200 완료 응답의 `choices[0].message.content`로 돌려준다. 오류 문구도 같은 응답 모양으로 나가며, 응답 조립 함수 입구의 훅이 영어 오류 문구를 한국어로 바꾼다.

OcuClaw 앱 대화(`:8444`)는 같은 클라이언트를 쓰지만 실행 뒤 대화 기록을 다시 불러와 화면을 그리므로 길이 정책이 적용되지 않는다.

## 주입 구조

- 우리 코드(`ocuclaw-patch/payload/*.js`)는 설치본의 `dist/ocuclaw-g2/`로 복사된다. 원본 파일에는 그 모듈을 불러 쓰는 한 줄짜리 훅만 들어가고, 각 훅 줄 끝에 `/* ocuclaw-g2:<지점 이름> */` 표식이 붙는다.
- 훅이 들어가는 원본 파일은 네 개다: `dist/even-ai/even-ai-endpoint.js`(최종 답, 오류 문구), `dist/gateway/openclaw-client.js`(delta 재조립, hello 기능 목록 기록), `dist/runtime/session-context-service.js`(`sessions.compaction.list` 건너뛰기), `dist/tools/glasses-ui-tool.js`(실시간 화면 tick의 API 키 조회).
- 주입된 모듈은 프로세스 전역(`Symbol.for` 키)에 Gateway가 hello에서 광고한 메서드 목록을 들고 있고, 거부된 메서드는 `~/.openclaw/ocuclaw-g2/unsupported-gateway-methods.json`에 호스트 버전별로 남긴다.

## 저장소 구성 요소

| 구성 요소 | 역할 | 의존 방향 |
|---|---|---|
| `ocuclaw-patch/` | 주입 코드(payload), 적용·검사 도구(patcher, cli), 실측 비교(verify-live) | OcuClaw 설치본을 바꾼다. 다른 구성 요소에 의존하지 않는다 |
| `even-ai-settings/` | Hey Even 라우팅·프롬프트를 config와 앱 안 저장소 양쪽에 쓰고, 전용 세션을 실측 검증 | `ocuclaw-patch/verify-live.mjs`의 요청·기록 조회 함수와 `persona/even-ai-system-prompt.txt`를 쓴다 |
| `scripts/` | 사람이 부르는 진입 셸 스크립트, 설정 적용(성격·언어, tick·허용 목록, 기억·Aside), 백업·복원, 공개 안전 검사 | 각 모듈의 CLI를 부른다. `openclaw` CLI로 설정을 바꾼다 |
| `scripts/patch-watch.mjs` + `scripts/patch-watch/` | Gateway 시작을 감지해 패치 검사 후 휴대폰 알림을 보내는 상주 감시자(LaunchAgent `com.openclaw-g2.patch-watch`) | `ocuclaw-patch/cli.mjs check`를 자식 프로세스로 부르고 출력과 종료 코드만 해석한다 |
| `persona/` | 리체 성격 파일 원본과 안경용 시스템 프롬프트(내용물, 코드 아님) | 적용 스크립트가 `~/.openclaw/workspace/`와 설정에 복사한다 |

## 패치 감시 흐름

LaunchAgent가 로그인 때 `patch-watch.mjs watch`를 띄운다 → 2초마다 `~/Library/Logs/openclaw/gateway.log` 끝을 읽어 `[gateway] ready` 줄을 찾는다 → 찾으면 `run`을 자식으로 띄운다(이전 run이 살아 있으면 끊는다) → `ocuclaw-patch/cli.mjs check` 결과가 "빠짐"(훅 표식이나 payload 파일이 없음)이면(payload 내용만 저장소와 다른 "낡음"은 로그만) `openclaw nodes status --json`에서 `system.notify`를 지원하는 연결된 휴대폰 노드를 골라 `openclaw nodes notify`로 한국어 알림 → 실패하면 30초 간격, 최대 10분 재시도 → 결과는 `~/.openclaw/ocuclaw-g2/patch-watch.log`. 감시자가 늦게 뜬 경우를 위해 시작 때 마지막 ready 줄을 상태 파일과 비교해 한 번 더 검사한다.

## 외부 의존

- **OpenClaw 2026.10.5**: Node 26 전용 경로 `~/.local/share/openclaw-node`, 실행 래퍼 `~/.local/bin/openclaw`. 설정 파일 `~/.openclaw/openclaw.json`.
- **OcuClaw 2.1.2**: `~/.openclaw/extensions/ocuclaw/`. 라이선스 표시가 없다.
- **opencodex 허브**: `127.0.0.1:10100`, OpenAI 호환. `/v1/embeddings`는 없다. 사용 기록 `~/.opencodex/usage.jsonl`.
- **llama.cpp 공급자 플러그인**(`@openclaw/llama-cpp-provider`, 플러그인 ID `llama-cpp`): 임베딩 모델만 내려받아 기억 검색에 쓴다.
- **Aside**: `~/.local/bin/aside mcp`(stdio).
- **Soniox**: OcuClaw의 안경 음성 입력. 이 저장소는 설정을 바꾸지 않는다.
- **도구 실행용 Node**: 저장소 스크립트는 `/opt/homebrew/opt/node/bin/node`(시스템 Node, `node:sqlite`와 `zstdDecompressSync` 필요)로 돈다. OpenClaw 자신의 Node와 다르다.
