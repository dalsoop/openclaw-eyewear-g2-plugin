# 0007. 안경 실시간 화면 tick은 기본 모델(Opus 5.5)과 리체 전용 opencodex 키를 쓴다

## 맥락

`glassesUiLive`는 opencodex 공급자에 맞는 tick 백엔드가 없어 꺼져 있었다("no tick backend for provider opencodex"). 켜려면 OpenAI 호환 백엔드와 모델, 그리고 API 키가 필요하다. opencodex는 loopback 호출의 키를 검사하지 않지만 키 발급은 사람만 할 수 있다. tick은 화면이 떠 있는 동안 주기적으로 모델을 부르므로 비용이 쌓인다.

## 결정

tick 백엔드 `openai-compat`, 기본 URL `http://127.0.0.1:10100`, 모델 `opencodex/anthropic/claude-opus-5-5`(기본 대화 모델과 같음). 키는 사용자가 발급한 리체 전용 opencodex 키를 `models.providers.opencodex.apiKey`에 넣어 쓴다. 비용 설명을 들은 사용자가 고른 것이다.

## 대안

- **작고 싼 모델로 tick**: 비용은 줄지만 실시간 화면 품질이 일반 대화와 달라진다. 사용자가 고르지 않았다.
- **자리 채움 키**(loopback은 검사 안 하므로 아무 값): 바로 동작하지만 리체의 사용량을 opencodex에서 따로 볼 수 없다. 사용자는 사용량 분리를 위해 전용 키를 골랐다.

## 결과

- 전용 키가 발급되기 전까지는 자리 채움 값이 들어 있고, 사용량이 분리되지 않는다.
- 이 키는 tick뿐 아니라 리체의 모든 opencodex 호출에 쓰인다. 키를 폐기하면(그리고 opencodex가 키를 검사하면) 리체 전체가 멈춘다.
- tick 비용이 Opus 단가로 쌓인다. 비용이 문제가 되면 `tickModel`만 바꾸면 된다(다른 설정과 독립).
- tick 키 조회는 OcuClaw의 TypeError 버그를 우리 훅이 고쳐야 동작한다. 패치가 빠지면 tick도 멈춘다.
