# even-ai-settings

## 범위

Hey Even(Even AI)의 라우팅 모드(`background`)와 안경용 한국어 시스템 프롬프트를 두 곳, 즉 OcuClaw 앱 안 설정 저장소(`~/.openclaw/even-ai-settings.json`)와 config(`plugins.entries.ocuclaw.config.evenAiRoutingMode`, `evenAiSystemPrompt`)에 같은 값으로 넣고, 실제 요청으로 전용 세션 동작을 확인한다.

- `store.mjs`: 프롬프트 검증, 저장소 병합, config 비교(입출력 없음).
- `reply-style.mjs`: 답 말투 휴리스틱(반말, 길이, 마크다운·목록·표·이모지, 끝 되묻기)과 전용 세션 키 비교(입출력 없음).
- `cli.mjs`: `apply`·`check`·`verify`. 셸 진입점은 `scripts/even-ai-settings.sh`.

이 모듈의 범위가 아닌 것: 프롬프트 문구 자체(`persona/even-ai-system-prompt.txt`가 원본), 안경 응답 다듬기와 최종 답 결정(OcuClaw 주입 코드), `evenAiToken`·`evenAiDedicatedSessionKey`·`glassesUiLive` 등 다른 OcuClaw 설정 키. 이 키들은 읽기만 한다.

## 불변 조건

- 저장소 파일은 Gateway가 멈춘 상태에서만 쓴다. `apply`는 `openclaw gateway stop --force` → 멈춤 확인 → **멈춘 뒤 파일을 다시 읽어** 병합 → 원자적 쓰기(기존 권한 유지, 새 파일은 600) → config → `gateway start` → `Connectivity check: ok` 대기 순서다. 중간에 실패해도 `finally`에서 Gateway를 다시 시작한다.
- 둘 다 이미 같으면 Gateway를 멈추지 않는다.
- 병합은 `settings.routingMode`·`settings.systemPrompt`만 바꾸고 다른 필드(알려지지 않은 필드 포함)는 보존한다. 실제로 바뀔 때만 `updatedAtMs`를 갱신한다. `version`이 1이 아니면 예외로 멈춘다(모르는 형식을 덮어쓰지 않는다).
- 프롬프트는 trim 후 비어 있으면 거부, 4000 코드포인트 초과도 거부한다(OcuClaw의 검증과 같은 기준).
- 비교는 앞뒤 공백을 무시한다.
- 출력에 토큰을 쓰지 않는다. `verify`는 토큰을 요청 헤더에만 넣는다.

## 구현 방식

- config는 `openclaw config patch --stdin`으로 두 키만 넣는다. `openclaw.json`을 직접 쓰지 않는다. 저장소 파일은 OpenClaw CLI에 쓰는 명령이 없어 직접 쓴다.
- 전용 세션 판정: Gateway 키는 `agent:<에이전트>:` 접두어가 붙으므로 떼고 비교한다(`agent:main:ocuclaw:even-ai` == `ocuclaw:even-ai`). `:<id>`가 더 붙은 일회용 키는 전용 세션이 아니다.
- `verify`는 과일 이름을 무작위로 골라 첫 질문에서 기억시키고 두 번째 질문 답에 그 이름이 있는지로 맥락 유지를 본다. 두 질문이 각각 정확히 한 세션에서만 발견되어야 하고 두 세션 키가 같아야 한다. 요청·기록 조회 함수는 `ocuclaw-patch/verify-live.mjs`의 것을 쓴다.
- 반말 판정(`요|니다|니까` + 문장 끝)은 휴리스틱이다. 인용문 속 존댓말에도 걸린다. 규칙을 넓힐 때는 오탐을 시험에 추가한다.

## 시험

- `scripts/even-ai-settings.sh test`(= `node --test even-ai-settings/test/`).
- `store.test.mjs`: 저장소 없음 → 새로 만듦, 같음 → 변화 없음(`updatedAtMs` 유지), 다른 필드 보존, 다른 version 거부, 빈 프롬프트·4001 코드포인트 거부, config 비교.
- `reply-style.test.mjs`: 존댓말, 길이 초과, 마크다운·목록·표·이모지, 끝 되묻기, 전용 세션 키 접두어·일회용 키.
- 실제 저장소·config를 건드리는 시험은 `--store`·`--config` 옵션으로 임시 파일을 쓴다. `apply`는 실제 Gateway를 멈추므로 시험 스위트에서 부르지 않는다.
