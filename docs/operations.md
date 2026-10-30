# 운영

모든 명령은 저장소 루트에서, OpenClaw Gateway가 도는 Mac에서 실행한다.

## 전제 조건

- macOS, 로그인한 사용자 세션(LaunchAgent가 `gui/<uid>` 도메인에 올라간다).
- OpenClaw 2026.10.x: `~/.local/bin/openclaw`(전용 Node 26), Gateway LaunchAgent `ai.openclaw.gateway`가 `127.0.0.1:18789`에서 실행 중. `openclaw gateway status`에 `Connectivity check: ok`.
- OcuClaw 2.1.x가 `~/.openclaw/extensions/ocuclaw/`에 설치되어 있고 relay가 `127.0.0.1:47800`.
- 시스템 Node 26: `/opt/homebrew/opt/node/bin/node`(`node:sqlite`, `zlib.zstdDecompressSync` 필요). 다른 경로면 `NODE=…`로 넘긴다.
- opencodex 허브가 `127.0.0.1:10100`에서 실행 중.
- Tailscale serve가 :8443(Even AI, HTTPS), :8444(relay, TLS TCP), :8460(Gateway, HTTPS)을 열어 둔 상태. 이 저장소는 serve 설정을 만들거나 바꾸지 않는다.
- 휴대폰 OpenClaw 앱이 페어링되어 node로 연결됨(패치 알림 수신용).

## 처음 설치 순서

순서가 중요하다. 각 단계는 앞 단계의 결과에 기대고, 모두 `openclaw.json`과 Gateway 재시작을 공유하므로 동시에 돌리지 않는다.

```sh
scripts/backup.sh                                     # 1. 백업. 출력된 경로를 적어 둔다
scripts/ocuclaw-patch.sh apply                        # 2. OcuClaw에 훅 주입(전부 아니면 전무)
openclaw gateway restart                              #    패치를 불러오도록 재시작
scripts/ocuclaw-patch.sh check                        #    12개 항목 모두 있음 확인
scripts/apply-persona-locale.sh                       # 3. 리체 성격 파일 + 언어·시간대
scripts/even-ai-settings.sh apply                     # 4. Hey Even 전용 세션 + 안경 프롬프트(Gateway 멈춤→쓰기→시작)
scripts/set-opencodex-key.sh                          # 5. (사람이 직접) opencodex 키 입력, 화면에 안 보임
node scripts/apply-live-tick-allowlist.mjs --dry-run  # 6. tick 설정 + plugins.allow 미리 보기
node scripts/apply-live-tick-allowlist.mjs --restart  #    적용 후 재시작
scripts/apply-memory.sh                               # 7. llama.cpp 임베딩(대화형) + 내장 브라우저 끔 + 남은 Aside MCP 제거
scripts/patch-watch.sh install                        # 8. 패치 감시 LaunchAgent
node scripts/apply-ego-browser.mjs --restart          # 9. 웹 도구 ego lite 연결(스킬 키 하나 + 재시작)
```

- 2단계 뒤 Gateway 로그에서 OcuClaw가 로드되는지 확인한다. 출처 경고만 있으면 정상이고, 로드가 거부되면 1단계 백업으로 되돌리고 멈춘다.
- 6단계는 아직 설치되지 않은 `llama-cpp`도 허용 목록에 미리 넣는다. 그래서 7단계에서 설치한 플러그인이 배타 목록 때문에 꺼지지 않는다. 허용 목록이 생긴 뒤 새로 설치한 플러그인은 목록 밖이라 켜진 목록에도 나오지 않는다. 그래서 6단계를 다시 돌려도 들어가지 않는다. `scripts/lib/live-tick-allowlist.mjs`의 `ALLOWLIST_INCLUDE`에 ID를 더한 뒤 6단계를 다시 돌린다.
- 7단계의 두 질문: 대화 모델(수 GB)은 **No**, 임베딩 모델만(약 0.3 GB)은 **Yes**. 사람 없이 돌리지 않는다.
- 7단계는 웹 도구를 붙이지 않는다. 예전 판이 등록한 `mcp.servers.aside`가 남아 있으면 지우고, 없으면 건너뛴다(결정 0008). 웹 도구 ego lite는 9단계가 붙인다.
- 8단계는 2단계 뒤에 한다. 패치가 없는 상태에서 감시자를 먼저 켜면 다음 Gateway 시작 때 바로 알림이 간다.
- 9단계는 ego lite를 설치하고 온보딩을 마친 뒤에 한다(`ego-browser` 명령과 ego lite의 `ego-browser` 스킬이 있어야 한다). `skills.entries.ego-browser.enabled` 하나만 쓰고, 검사가 모두 통과하면 Gateway를 재시작한다(스킬 목록은 세션이 시작될 때 고정되므로 안경 전용 세션 같은 열린 세션은 재시작 뒤에야 바뀐다). 검사는 스킬이 보이는지와 승인 질문이 없는지만 본다. 리체가 실제로 ego lite를 쓰는지는 리체에게 무해한 조회(예: "ego lite로 https://example.com 제목만 알려줘")를 시키고, 대화 기록에 `ego-browser nodejs` `exec` 호출이 남는지로 확인한다. 성격 파일의 "브라우저(ego lite)" 절은 3단계가 처음 설치 때만 복사하므로, 이미 설치된 곳에서는 백업 뒤 workspace `AGENTS.md`의 브라우저 절만 `persona/AGENTS.md`의 것으로 바꾼다(결정 0009).

## 사람만 하는 단계

에이전트는 실행하지도, 화면을 가져가지도 않는다. 순서만 안내한다.

1. 휴대폰 OS 언어와 Even 앱 언어를 한국어로 맞춘다(호스트에서 바꿀 수 없다). Even 앱에서 Even AI 에이전트가 OcuClaw(리체)로 선택되어 있는지 본다.
2. 본인 터미널에서 `openclaw ocuclaw pair` → 화면과 휴대폰의 안전 단어 4개 대조.
3. 본인 터미널에서 `openclaw ocuclaw first-use` → 안경에서 메시지 보내기 → 답이 안경에 보였는지 대답 → 환영 이미지가 뜨면 두 번 탭.
4. `openclaw ocuclaw journey`로 마쳤는지 확인.
5. opencodex에서 리체 전용 키를 발급하고 `scripts/set-opencodex-key.sh`로 넣은 뒤 `openclaw gateway restart`.

## OcuClaw 업데이트 뒤 재적용

휴대폰에 "OcuClaw 패치가 빠졌어" 알림이 오면:

```sh
scripts/backup.sh                       # 새 버전의 깨끗한 사본 확보(패치 시험에도 쓴다)
scripts/ocuclaw-patch.sh all            # apply → (바뀌었으면) gateway restart → check → verify-live
node scripts/check-live-tick-allowlist.mjs
```

`all`은 apply가 실패하면(종료 코드 2) 거기서 멈추고 아무것도 쓰지 않는다. 출력의 `missing anchor:` 지점을 보고 기준 문자열을 고친다.

## 되돌리기

```sh
scripts/restore.sh ~/.openclaw/backups/<시각>        # Gateway 정지·멈춤 확인 → openclaw.json, even-ai-settings.json, 성격 파일 4개, 플러그인 폴더 복원 → 시작·연결 확인
scripts/restore.sh ~/.openclaw/backups/<시각> --no-restart
scripts/patch-watch.sh uninstall                     # 감시자 제거
```

- workspace는 성격 파일 4개(`IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`)만 되돌린다. 백업에 함께 들어 있는 `DREAMS.md`, `MEMORY.md` 등 다른 `*.md`는 리체가 쓴 기억이라 그대로 둔다. 필요하면 백업 폴더에서 손으로 꺼낸다.
- 복원은 백업에 있는 파일만 되돌린다. 백업 뒤 새로 생긴 workspace 파일, 설치한 llama.cpp 플러그인, 내려받은 임베딩 모델, `~/.openclaw/ocuclaw-g2/` 상태 폴더는 지우지 않는다.
- 플러그인 폴더는 임시 이름으로 복사한 뒤 바꿔 넣으므로 복사 도중 실패해도 기존 폴더가 남는다.
- 2026-10-30 이전에 만든 백업에는 Aside가 들어 있다: `openclaw.json`의 `mcp.servers.aside`(자동 승인)와 workspace `AGENTS.md`의 옛 "브라우저(Aside)" 절. 그런 백업으로 복원했으면 `scripts/apply-memory.sh`를 다시 돌려 MCP 서버를 지우고, workspace `AGENTS.md`의 그 절을 `persona/AGENTS.md`의 "브라우저(ego lite)" 절로 바꾼다. 다른 절에 설치 뒤 고친 내용이 있으면 남기고 그 절만 바꾼다(`--force`는 성격 파일 4개를 모두 덮어쓰므로 쓰지 않는다, 결정 0008).
- ego lite 웹 도구를 떼어 내려면 `openclaw config set skills.entries.ego-browser.enabled false --strict-json` → `openclaw gateway restart`(연결 확인까지 기다림) → workspace `AGENTS.md`의 브라우저 절을 바꾼다(결정 0009의 되돌리기). 키를 지우거나(unset) 결정 0009 이전에 만든 백업으로 복원하는 것만으로는 떨어지지 않는다. 키가 없으면 스킬이 기본으로 보인다. `false`는 스킬 안내를 숨길 뿐이고 `exec`로 `ego-browser`를 부르는 것까지 막지는 않는다.

## 검사 명령

| 명령 | 통과 조건 |
|---|---|
| `/opt/homebrew/opt/node/bin/node --test ocuclaw-patch/test/ even-ai-settings/test/ scripts/lib/ scripts/patch-watch/` | 134개 모두 pass |
| `scripts/ocuclaw-patch.sh check` | `check: all patch points present`(종료 코드 5 `payload differs from repo`는 훅은 살아 있고 설치본 payload가 저장소와 다를 뿐이다. `apply`로 맞춘다) |
| `scripts/ocuclaw-patch.sh verify-live` | `verify-live: PASS`(실제 Even AI 요청 3건, 1~2분) |
| `scripts/even-ai-settings.sh check` | `store ok, config ok` |
| `scripts/even-ai-settings.sh verify` | `verify: PASS (dedicated session …)` |
| `node scripts/check-live-tick-allowlist.mjs` | `ALL CHECKS PASSED`(`--skip-tick`이면 tick 호출 생략) |
| `scripts/patch-watch.sh status` | `loaded`, 최근 로그에 `check ok` |
| `openclaw memory status --deep --agent main` | Embeddings·Vector store ready |
| `openclaw mcp list` | `aside`가 없음(MCP로 붙인 웹 도구가 없다. 웹 도구 ego lite는 스킬이다) |
| `node scripts/apply-ego-browser.mjs --check` | `ALL CHECKS PASSED`(ego-browser 실행, 스킬이 리체에게 보임, `exec` 승인 질문 없음, 내장 브라우저 꺼짐). 리체가 실제로 쓰는지는 위 9단계 설명의 조회로 본다 |
| `scripts/public-safety-scan.sh` | `public-safety-scan: clean` |

`verify-live`와 `even-ai-settings.sh verify`는 실제 모델을 부르므로 비용이 들고, 질문이 안경 전용 세션 기록에 `(확인용 <nonce>)` 꼬리표와 함께 남는다.

## 설정 값

### 이 저장소가 쓰는 OpenClaw 설정 키

| 키 | 값 | 쓰는 스크립트 |
|---|---|---|
| `ui.prefs.locale` | `ko` | `apply-persona-locale.sh` |
| `talk.speechLocale` | `ko-KR` | 〃 |
| `tools.media.audio.language` | `ko` | 〃 |
| `agents.defaults.userTimezone` | `Asia/Seoul` | 〃 |
| `plugins.entries.ocuclaw.config.evenAiRoutingMode` | `background` | `even-ai-settings.sh` |
| `plugins.entries.ocuclaw.config.evenAiSystemPrompt` | `persona/even-ai-system-prompt.txt` 내용 | 〃(앱 안 저장소에도) |
| `plugins.entries.ocuclaw.config.glassesUiLive.tickBackend` | `openai-compat` | `apply-live-tick-allowlist.mjs` |
| `….glassesUiLive.tickApiBaseUrl` | `http://127.0.0.1:10100`(`/v1` 없이) | 〃 |
| `….glassesUiLive.tickModel` | `opencodex/anthropic/claude-opus-5-5` | 〃 |
| `plugins.allow` | 켜진 플러그인 − `browser` + `ocuclaw` + `llama-cpp`(지금 44개) | 〃 |
| `memory.search.provider` | `local` | `apply-memory.sh` |
| `mcp.servers.aside` | 없음(남아 있으면 `openclaw mcp unset aside`로 지운다) | 〃 |
| `browser.enabled` | `false` | 〃 |
| `skills.entries.ego-browser.enabled` | `true`(떼어 낼 때는 `false`. 지우면 기본으로 보이므로 unset으로는 떨어지지 않는다) | `apply-ego-browser.mjs` |
| `models.providers.opencodex.apiKey` | 리체 전용 키(비밀) | `set-opencodex-key.sh`(사람) |

`evenAiDedicatedSessionKey`는 설정하지 않아 기본값 `ocuclaw:even-ai`를 쓴다. `sonioxApiKey`(Soniox 음성, 월 한도 $5·알림 $3)는 이 저장소가 바꾸지 않는다.

### 환경 변수

| 변수 | 기본값 | 어디서 읽나 | 뜻 |
|---|---|---|---|
| `OCUCLAW_G2_REPLY_BUDGET` | 350 | Gateway 프로세스 | 안경 답 최대 코드포인트(`…` 포함, 2 미만은 무시) |
| `OCUCLAW_G2_HISTORY_TIMEOUT_MS` | 5000 | Gateway 프로세스 | 대화 기록 최종 답 대기 시간 |
| `OCUCLAW_G2_STATE_DIR` | `~/.openclaw/ocuclaw-g2` | Gateway 프로세스 | 미지원 메서드 기록 위치 |
| `OCUCLAW_G2_FORCE_HISTORY_FAILURE` | 꺼짐 | Gateway 프로세스 | `1`이면 기록 조회를 일부러 실패(시험 전용) |
| `OCUCLAW_G2_PRISTINE_DIR` | 가장 최근의 패치 안 된 백업 사본(없으면 시험 건너뜀) | 패처 시험 | 깨끗한 OcuClaw 사본 |
| `PATCH_WATCH_RETRY_INTERVAL_SEC` | 30 | 감시자 LaunchAgent | 알림 재시도 간격 |
| `PATCH_WATCH_RETRY_MAX_SEC` | 600 | 감시자 LaunchAgent | 알림 재시도 최대 시간 |
| `PATCH_WATCH_NODE` | 자동 선택 | 감시자 | 알림 받을 노드 ID 또는 표시 이름 |
| `PATCH_WATCH_STATE_DIR` | `~/.openclaw/ocuclaw-g2` | 감시자 | 로그·상태 파일 위치 |
| `PATCH_WATCH_GATEWAY_LOG` | `~/Library/Logs/openclaw/gateway.log` | 감시자 | 감시할 Gateway 로그 |
| `NODE` | `/opt/homebrew/opt/node/bin/node` | 셸 진입점, 감시자 | 도구 실행용 Node |
| `OPENCLAW` | `~/.local/bin/openclaw` | 모든 셸·Node 스크립트, 감시자 | OpenClaw CLI 경로 |
| `GATEWAY_WAIT_POLL_SEC` | 2 | `restore.sh`, `apply-memory.sh` | Gateway 상태 확인 간격(시험 때 줄인다) |
| `OPENCLAW_HOME` | `~/.openclaw` | `backup.sh`, `restore.sh`, 성격 적용, tick 검사 | OpenClaw 홈(시험 때 임시 폴더로) |
| `EGO_BROWSER` | `~/.local/bin/ego-browser` | `apply-ego-browser.mjs` | ego lite CLI 경로 |

`OCUCLAW_G2_*` 중 Gateway 프로세스에서 읽는 값은 Gateway LaunchAgent 환경에 넣고 재시작해야 효과가 있다. 감시자 값은 `scripts/patch-watch/launchagent.plist.template`(설치 때 PATH만 넣는다)에 추가하고 `scripts/patch-watch.sh install`을 다시 돌린다.

## 파일 위치

| 경로 | 내용 |
|---|---|
| `~/.openclaw/backups/<YYYYMMDD-HHMMSS>/` | 백업(권한 700) |
| `~/.openclaw/extensions/ocuclaw/dist/ocuclaw-g2/` | 주입된 우리 코드 사본 |
| `~/.openclaw/ocuclaw-g2/patch-watch.log` | 감시자 검사·알림 기록 |
| `~/.openclaw/ocuclaw-g2/patch-watch.launchd.log` | 감시자 표준 출력·오류 |
| `~/.openclaw/ocuclaw-g2/patch-watch.state.json` | 마지막으로 처리한 ready 줄 |
| `~/.openclaw/ocuclaw-g2/unsupported-gateway-methods.json` | Gateway가 거부한 메서드(호스트 버전별) |
| `~/Library/LaunchAgents/com.openclaw-g2.patch-watch.plist` | 감시자 LaunchAgent |
| `~/Library/Logs/openclaw/gateway.log` | Gateway 로그(`[ocuclaw-g2]` 줄 포함) |
| `~/.agents/skills/ego-browser` | 리체가 보는 ego lite 스킬(설치된 ego lite 앱 안 스킬 폴더로 가는 링크. 이 저장소가 만들지 않는다) |

## 공개 저장소로 올리기

1. `git fetch origin` 뒤 `scripts/public-safety-scan.sh --base origin/main --head HEAD`가 clean이어야 한다(PR이 더하는 커밋 범위와 인덱스·작업 트리 검사). 인자 없는 실행도 같은 범위다. refs나 OcuClaw dist가 없으면 2이며 통과가 아니다.
2. 작업 브랜치를 push하고 PR을 연다. 시험·독립 검토·필수 검사를 통과하면 에이전트가 `gh pr merge <번호> --rebase --match-head-commit <검토한 SHA>`로 병합한다(이 저장소에는 머지 대기열이 없다). 원격 `main` 직접 push·force-push는 하지 않는다. 로컬 main은 `git pull --ff-only`로 맞춘다.
   - **병합 전제**: GitHub의 PR 병합은 병합한 계정의 커밋 이메일을 새로 쓴다. merge·squash는 새 커밋의 작성자로, rebase는 PR 커밋 각각의 커미터로 쓴다(작성자는 그대로). merge 병합 커밋의 커미터는 GitHub 자체 계정이라 `@users.noreply.github.com` 규칙에 늘 걸리므로 rebase를 쓴다. 병합 계정의 GitHub 이메일 비공개 설정(Settings → Emails → "Keep my email addresses private")이 켜져 있어야 그 이메일이 noreply 주소가 된다. 꺼져 있거나 확인할 수 없으면 병합하지 않고 사용자에게 알린다. 지금 gh 토큰으로는 계정 이메일 설정(`/user/emails`)을 읽을 수 없으므로, 실무에서는 계정 소유자의 확인이 확인 방법이다. `gh pr merge --author-email`에 GitHub noreply 주소를 줬을 때 "Invalid email address"로 거부되면 꺼져 있다는 신호다.
   - **병합 직후 확인**: 병합 직전에 `git fetch origin` 뒤 `git rev-parse origin/main`으로 병합 전 main SHA를 적어 둔다. 병합 뒤 깨끗한 체크아웃(변경·미추적 파일 없음)에서 `git fetch origin` 뒤 `scripts/public-safety-scan.sh --base <병합 전 main SHA> --head origin/main`이 clean이어야 한다(병합이 main에 더한 커밋만 검사. 인덱스·작업 트리도 함께 검사하므로 깨끗한 체크아웃에서 돌린다). 1이고 FAIL 위치가 `commit metadata …`이면 병합이 noreply가 아닌 이메일을 남긴 것이므로 즉시 사용자에게 알린다.
3. 별도 전수 감사는 `scripts/public-safety-scan.sh --all`이다. 모든 ref의 이력을 검사하므로 기존 GitHub 병합 메타데이터 발견은 계속 `FAIL`, 종료 코드 1이다. `docs/public-safety-baseline.json`은 SHA와 이유만 기록하며 발견을 면제하지 않는다. 전수 감사와 PR 게이트 결과를 구분해 기록한다.
