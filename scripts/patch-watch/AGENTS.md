# patch-watch

## 범위

Gateway가 시작될 때마다 OcuClaw 패치 지점을 검사하고, 빠졌으면 페어링된 휴대폰 OpenClaw 앱으로 한국어 알림을 보내는 상주 감시자다. 진입점은 `scripts/patch-watch.mjs`(`run`·`watch`·`install`·`uninstall`·`status`·`test`), 판단 로직은 이 폴더의 `lib.mjs`, LaunchAgent 틀은 `launchagent.plist.template`이다.

이 단위의 범위가 아닌 것:
- 패치를 다시 입히는 일. 감시자는 `ocuclaw-patch/cli.mjs apply`를 절대 부르지 않고, Gateway를 재시작하지 않는다.
- 패치 지점의 정의와 검사 방법. `ocuclaw-patch/cli.mjs check`를 자식 프로세스로 부르고 종료 코드와 출력 줄만 해석한다. 패처 모듈을 import하지 않는다.
- `openclaw.json`과 OcuClaw 설치본. 읽지도 쓰지 않는다.

## 불변 조건

- 알림은 검사 결과가 "빠짐"(종료 코드 3 + `  missing: <이름>` 줄 1개 이상, 즉 훅 표식이나 payload 파일이 없음)일 때만 보낸다. 종료 코드 0이면 알림 없음. 종료 코드 5(훅은 다 있고 payload 내용만 저장소 작업 트리와 다름)는 저장소 편집·브랜치 전환으로도 생기므로 `payload differs from repo; run apply to update`와 `  stale: <파일>` 이름만 로그에 남기고 알림하지 않는다(`run`은 0). 그 밖(다른 코드, 3인데 이름 없음, 실행 실패)은 "check error"로 로그만 남기고 알림하지 않는다.
- 알림 문구는 한국어 반말이다. 제목 `OcuClaw 패치가 빠졌어`, 본문에 빠진 지점 이름, Hey Even이 첫 조각만 보인다는 영향, `<저장소 경로>/scripts/ocuclaw-patch.sh apply`와 `openclaw gateway restart`. 저장소 경로는 홈을 `~`로 줄여 쓴다.
- 받을 노드는 실행 때마다 `openclaw nodes status --json`에서 고른다: `connected === true`이고 `commands`에 `system.notify`가 있으며 플랫폼이 android/ios/ipados(또는 기기 계열 android/iphone/ipad)인 첫 노드. `PATCH_WATCH_NODE`가 있으면 그 ID 또는 표시 이름. 노드 이름·ID를 저장소에 적지 않고, 로그에는 ID 앞 8자만 남긴다. `nodes notify --json`의 원래 출력은 로그에 쓰지 않고 시도마다 `ok`/`fail`과 노드 ID 앞 8자만 쓴다(`formatNotifyResult`). 모든 로그 줄은 쓰기 전에 64자리 16진수를 앞 8자 + `…`로 줄인다(`redactNodeIds`).
- 재시도: 즉시 1회, 이후 `PATCH_WATCH_RETRY_INTERVAL_SEC`(30)마다, 다음 시도가 첫 시도로부터 `PATCH_WATCH_RETRY_MAX_SEC`(600)를 넘지 않는 동안. 끝내 실패하면 빠진 지점과 재적용 명령을 로그에 남긴다.
- `run` 종료 코드: 0 알림 불필요, 10 보냄, 11 못 보냄, 12 검사 오류. 바꾸지 않는다.
- `watch`에서 새 Gateway 시작이 감지되면 이전 `run` 자식을 SIGTERM으로 끊고 새로 시작한다. 같은 `[gateway] ready` 줄로 두 번 검사하지 않는다(`patch-watch.state.json`의 `lastReady`).
- `install`·`uninstall`은 멱등이다. plist 내용이 같고 적재되어 있으면 아무것도 하지 않는다.

## 구현 방식

- 시작 감지: 2초마다 `gateway.log`의 늘어난 부분만 읽어 `ReadyScanner`로 `[gateway] ready`로 끝나는 줄을 센다. 줄 중간에서 끊긴 조각은 다음 읽기와 이어 붙인다. 파일 크기가 줄면(회전) 처음부터 다시 읽는다. 감시자가 뜰 때 로그의 마지막 ready 줄이 상태 파일과 다르면 한 번 검사한다(로그인 직후 Gateway가 먼저 뜬 경우).
- LaunchAgent: `com.openclaw-g2.patch-watch`, `RunAtLoad`, `KeepAlive`, `ThrottleInterval` 30, 작업 폴더와 스크립트 경로는 설치 시점의 저장소 절대 경로. 저장소를 옮기면 `install`을 다시 돌려야 한다. plist의 환경 변수는 PATH만 넣는다. 재시도 값 등을 바꾸려면 틀에 키를 추가하고 다시 설치한다.
- 상태와 로그는 `PATCH_WATCH_STATE_DIR`(기본 `~/.openclaw/ocuclaw-g2/`)의 `patch-watch.log`, `patch-watch.launchd.log`, `patch-watch.state.json`.
- 판단·재시도·노드 선택·문구 생성은 모두 `lib.mjs`의 순수 함수로 두고, 시간(`now`, `sleep`)과 전송 함수를 주입받는다. 입출력이 있는 코드는 `patch-watch.mjs`에만 둔다.

## 시험

- `scripts/patch-watch.sh test`(= `node --test scripts/patch-watch/`).
- `lib.test.mjs`: 검사 출력 해석(0, 3+이름, 3 이름 없음, 5 낡은 payload, 3에 섞인 `stale:` 줄 무시, 다른 코드), 알림 여부 판단(낡음은 로그만), 알림 결과 로그(원래 출력 없음, ID 앞 8자), 64자리 ID 줄이기, 알림 문구(지점 이름·명령 포함, `~` 표기), 노드 선택(연결 안 됨·`system.notify` 없음·Mac 노드 제외, 덮어쓰기), 재시도(첫 시도 성공, 간격·최대 시간 경계, 예외를 실패로 처리, 중단), 재시도 환경 변수 잘못된 값, `ReadyScanner`의 조각 경계.
- 실측: 실제 설치본에서 훅 한 줄을 지우고 `openclaw gateway restart` → 로그에 `ALERT SENT`, 휴대폰 수신은 사람이 확인 → 재적용 후 재시작 → `check ok`, 알림 없음. 끝나면 반드시 재적용 상태로 돌려놓는다.
- Gateway 로그 문구나 `check` 출력 형식이 바뀌면 감지·해석이 조용히 멈춘다. OpenClaw·패처를 바꾼 뒤에는 `scripts/patch-watch.sh status`에서 `gateway start detected`와 `check ok`가 찍히는지 본다.
