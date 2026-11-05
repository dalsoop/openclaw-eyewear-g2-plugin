# 0010. 패치 감시자를 걷어내고, OcuClaw 업데이트 뒤 확인은 사람이 한다(0004 일부 대체)

## 맥락

0004는 LaunchAgent 감시자(`com.openclaw-g2.patch-watch`)가 Gateway 시작마다 패치 지점을 검사하고, 빠졌으면 페어링된 휴대폰으로 알리게 했다. 감시자는 저장소 체크아웃의 `scripts/patch-watch.mjs watch`를 상주시켜 돌았다.

2026-11-06 사용자(이 저장소와 그 GitHub 계정의 주인)가 Gateway가 도는 Mac에서 더 쓰지 않는 상주 작업을 걷어내기로 정했고, 이 감시자도 그 대상이다. 사용자는 감시자만 끄고 OpenClaw Gateway(`ai.openclaw.gateway`)는 그대로 두라고 했다. 그 Mac의 저장소 체크아웃도 그대로 둔다.

## 결정

- 감시자를 걷어낸다. 저장소에서 `scripts/patch-watch.sh`, `scripts/patch-watch.mjs`, `scripts/patch-watch/`(`AGENTS.md`, `launchagent.plist.template`, `lib.mjs`, `lib.test.mjs`)와 그 설치·운영 안내를 지운다.
- 그 Mac에서는 2026-11-06 `launchctl bootout gui/<uid>/com.openclaw-g2.patch-watch`로 내리고 `~/Library/LaunchAgents/com.openclaw-g2.patch-watch.plist`를 지웠다. Gateway LaunchAgent, OcuClaw 설치본과 패치는 건드리지 않았다.
- 0004의 나머지는 그대로다. OcuClaw 버전을 고정하지 않고, 패치를 자동으로 다시 입히지 않는다. 재적용은 사람이 명령으로 한다.
- OcuClaw를 업데이트한 뒤(또는 Hey Even 답이 첫 조각만 보이면) 사람이 `scripts/ocuclaw-patch.sh check`로 확인하고, 빠졌으면 `scripts/ocuclaw-patch.sh all`로 재적용한다.

## 대안

- **감시자를 그대로 두기**: 사용자가 더 쓰지 않는 상주 작업으로 정했다.
- **설치본에서만 내리고 코드는 남기기**: 저장소의 설치 순서를 따라 하면 감시자가 다시 올라가고, 문서와 실제 상태가 어긋난다. 0008에서 같은 이유로 고르지 않은 길이다.

## 결과

- OcuClaw 업데이트로 패치가 빠져도 알려 주는 것이 없다. 사람이 알아차리고 재적용할 때까지 Hey Even은 첫 조각만 보내고, tick은 API 키를 못 얻으며, `sessions.compaction.list` 오류가 로그에 다시 남는다.
- 0001의 결과에 적힌 "감시·알림"은 더 없다. 재적용 명령(`apply`, `check`, `verify-live`, `all`)은 그대로다.
- `check`의 출력 형식과 종료 코드(0, 3, 5)는 뜻을 바꾸지 않는다. 사람과 `scripts/ocuclaw-patch.sh all`이 읽는다.
- 단위 시험은 감시자 시험 23개가 빠져 134개에서 111개가 됐다.
- 감시자가 남긴 `~/.openclaw/ocuclaw-g2/patch-watch.log`, `patch-watch.launchd.log`, `patch-watch.state.json`은 지우지 않았다. 손으로 지워도 된다. 같은 폴더에는 Gateway 안의 주입 코드도 기록을 남기므로(`unsupported-gateway-methods.json`) 폴더째 지우지 않는다.
- 다시 켜려면 사용자가 정하고 새 결정으로 남긴다. 옛 코드는 이 결정 직전의 main 커밋 `38382ba`에 있다.
