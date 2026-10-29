# OpenClaw 아이웨어 G2 플러그인 설정(리체)

## 무엇인가

OpenClaw 비서 "리체"와 G2 안경용 OcuClaw 플러그인을 내 장비에 맞춘 개인 설정과, OcuClaw를 보완하는 패치를 모은 저장소다.

- 한국어화: 리체 페르소나(반말), 화면·음성·전사 언어 한국어, 시간대 Asia/Seoul, 안경에 뜨는 오류 문구 한국어
- Hey Even 답 잘림 수정: 안경에 답의 첫 조각만 뜨던 문제를 고친다
- 안경 실시간 화면: `glassesUiLive` tick을 opencodex로 켜고 `plugins.allow`를 정리한다
- 로컬 기억 검색: OpenClaw가 관리하는 llama.cpp 임베딩(임베딩 모델만)으로 기억을 검색한다
- 브라우저 도구 없음: 내장 브라우저는 꺼 두고 다른 브라우저 도구도 붙이지 않는다(예전에 붙였던 Aside MCP는 지운다)
- 패치 감시: 게이트웨이가 다시 뜰 때 패치 지점이 사라졌으면 휴대폰으로 알린다

## 요구 사항

- macOS
- OpenClaw 2026.10.x (Node 26, `~/.local/bin/openclaw`)
- OcuClaw 2.1.x (`~/.openclaw/extensions/ocuclaw`)
- opencodex 허브 (`127.0.0.1:10100`)
- Tailscale: 휴대폰이 tailnet 안에서만 이 Mac에 접속한다. OcuClaw 앱은 `:8444`(relay), Even 앱의 Hey Even은 `:8443`, 휴대폰 OpenClaw 앱은 `:8460`(Gateway)으로 들어온다. 모두 `tailscale serve`로 열려 있고 funnel은 쓰지 않는다.

## 설치 순서

먼저 백업한다. 백업은 저장소 밖 `~/.openclaw/backups/<시각>`에 남는다.

```sh
scripts/backup.sh                                   # 백업 폴더 경로를 출력한다
scripts/ocuclaw-patch.sh apply                      # OcuClaw에 보완 코드 주입 (전부 되거나 아무것도 안 씀)
scripts/apply-persona-locale.sh                     # 리체 페르소나 + 한국어/시간대 (이후 실행은 바뀐 성격 파일을 건너뜀, --force로 덮어씀)
scripts/even-ai-settings.sh apply                   # Hey Even 전용 대화 + 안경용 한국어 프롬프트
node scripts/apply-live-tick-allowlist.mjs --restart # 안경 실시간 화면 + plugins.allow (--dry-run으로 미리 보기)
scripts/apply-memory.sh                             # 로컬 임베딩, 내장 브라우저 끔, 남은 Aside MCP 제거
scripts/patch-watch.sh install                      # 패치 감시 LaunchAgent 등록
```

- `apply-memory.sh`는 중간에 질문을 한다. 대화 모델 다운로드(수 GB)에는 **No**, 임베딩 모델만 받기(약 0.3 GB)에는 **Yes**를 고른다.
- opencodex 키는 `scripts/set-opencodex-key.sh`를 직접 터미널에서 실행해 넣는다. 입력이 화면에 보이지 않고 셸 기록에도 남지 않는다.
- 모든 스크립트는 다시 돌려도 안전하다(이미 된 부분은 건너뛴다).

## 재적용 (OcuClaw 업데이트 뒤)

OcuClaw를 업데이트하면 주입한 코드가 지워진다. 휴대폰에 패치 감시 알림이 오면 이 명령을 돌린다.

```sh
scripts/ocuclaw-patch.sh all
```

`all`은 apply → (바뀌었으면) 게이트웨이 재시작 → check → verify-live 순서로 돈다. 나눠서 하려면:

```sh
scripts/ocuclaw-patch.sh apply
openclaw gateway restart
scripts/ocuclaw-patch.sh check
scripts/ocuclaw-patch.sh verify-live
```

새 OcuClaw에서 고정 지점(anchor)을 못 찾으면 apply는 아무것도 쓰지 않고 멈추며, 빠진 지점 이름을 보여 준다.

## 되돌리기

```sh
scripts/restore.sh ~/.openclaw/backups/<시각>   # 게이트웨이를 멈추고 복원한 뒤 다시 켬 (--no-restart로 생략)
scripts/patch-watch.sh uninstall                # 패치 감시 LaunchAgent 제거
```

## 검사 명령

```sh
/opt/homebrew/opt/node/bin/node --test ocuclaw-patch/test/ even-ai-settings/test/ scripts/lib/ scripts/patch-watch/
scripts/ocuclaw-patch.sh check          # 패치 지점이 모두 있는지
scripts/ocuclaw-patch.sh verify-live    # 실제 Even AI 요청의 답과 대화 기록이 같은지
scripts/even-ai-settings.sh check       # 앱 저장소와 설정 값이 저장소 값과 같은지
scripts/even-ai-settings.sh verify      # 연속 요청 두 개가 전용 대화에 들어가고 반말·기호 없음
node scripts/check-live-tick-allowlist.mjs   # plugins.allow 일치 + 실시간 tick 실제 호출 (--skip-tick)
scripts/patch-watch.sh status           # LaunchAgent 상태와 최근 검사 결과
openclaw memory status --deep --agent main   # Embeddings / Vector store ready
openclaw mcp list                       # aside가 없어야 한다
scripts/public-safety-scan.sh           # PR 범위 + 인덱스·작업 트리 안전 검사 (먼저 git fetch origin)
scripts/public-safety-scan.sh --all     # 모든 ref 전수 감사 (알려진 발견도 FAIL)
```

## Hey Even 동작

- Hey Even 요청은 안경 전용 대화(`ocuclaw:even-ai`, 백그라운드 라우팅)로 들어가고, `persona/even-ai-system-prompt.txt`의 한국어 안경용 프롬프트를 쓴다.
- 안경에 보내는 답은 다음 순서로 다듬는다.
  1. 기호 정리: 마크다운 제목·목록·인용·코드 울타리·강조 기호, 링크 주소, 이모지를 지운다.
  2. 앞뒤 공백 정리
  3. 길이 제한: 350자(코드포인트 기준, 끝의 `…` 포함). 넘으면 문장 경계에서 자르고 `…`를 붙인다.
- 최종 답은 대화 기록(transcript)에서 읽는다. 못 읽으면 스트림으로 모은 글을 쓰고, 그것도 비면 "답을 못 가져왔어. 다시 물어봐 줘."를 보낸다. 시간 초과·연결 끊김 같은 OcuClaw 오류 문구도 한국어로 바꾼다.

조정값(환경 변수). 앞의 둘은 OcuClaw 안에서 읽으므로 **게이트웨이 LaunchAgent의 환경**에 넣어야 효과가 있다. 셸에서 export해도 소용없다.

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `OCUCLAW_G2_REPLY_BUDGET` | 350 | 안경 답 최대 글자 수(코드포인트) |
| `OCUCLAW_G2_HISTORY_TIMEOUT_MS` | 5000 | 대화 기록에서 최종 답을 기다리는 시간 |
| `PATCH_WATCH_RETRY_INTERVAL_SEC` | 30 | 휴대폰 알림 재시도 간격 (패치 감시 LaunchAgent) |
| `PATCH_WATCH_RETRY_MAX_SEC` | 600 | 휴대폰 알림 재시도 최대 시간 (패치 감시 LaunchAgent) |

## 잘림 버그 원인

OpenClaw 2026.10.5 게이트웨이는 assistant 스트림의 첫 프레임에만 전체 `text`를 싣고, 그 뒤 프레임에는 `{itemId, delta}`만 보낸다(게이트웨이의 `projectAssistantWireDelta`). OcuClaw 2.1.2는 `data.text`가 문자열일 때만 버퍼를 갱신하므로, 버퍼가 첫 조각에서 멈추고 안경에는 답의 앞부분만 뜬다.

고친 방법: delta를 이어 붙여 버퍼를 다시 만들고, 최종 답은 대화 기록에서 읽어 보낸다(위 대체 순서 참고).

## 알려진 사항

- OcuClaw 출처(provenance) 경고는 남는다. `plugins.allow`에 ocuclaw가 들어 있지만, 패치한 플러그인은 원본과 달라 검증할 수 없다.
- `plugins.allow`에서 `browser`를 뺐고 `browser.enabled=false`다. 그래서 `browser.request`를 부르는 클라이언트가 있으면 로그에 "unknown method"가 찍힌다.
- Soniox 음성 인식: 월 한도 $5, $3에서 알림. 키는 `plugins.entries.ocuclaw.config.sonioxApiKey`에 저장한다(값은 이 저장소에 없다).
- opencodex 키는 `scripts/set-opencodex-key.sh`로만 넣는다(`models.providers.opencodex.apiKey`).
- **리체에게는 브라우저 도구가 없다.** 예전에 확인 없이 실행되도록(`--approval approve`) 붙였던 Aside MCP는 2026-10-30 사용자 결정으로 뺐다. 로그인된 사이트에서 무언가를 하라고 시키면(Hey Even 포함) 리체는 할 수 없다. 웹 도구를 다시 붙이려면 그 도구의 승인 정책을 사용자가 먼저 정해야 한다(`docs/tracking/decisions/0008-remove-aside.md`).

## "잘 이해하지 못했습니다"가 뜰 때

이 문구는 서버가 아니라 **Even 앱이 직접 만든다**. 요청이 서버에 닿지 않았을 때 나온다(서버 기록과 비교해 확인함). 그래서 서버 쪽에서는 고칠 수 없다. 이렇게 해 본다.

- "Hey Even" 뒤 알림음이 난 다음에 말한다.
- Even 앱에서 Even AI 언어가 한국어인지, 에이전트가 OcuClaw(리체)로 선택돼 있는지 확인한다.

## 휴대폰에서 직접 할 일 (사람 단계)

아래는 사람이 직접 한다. 에이전트는 이 절차(pair, first-use)를 실행하지 않는다.

1. 휴대폰 OS 언어와 Even 앱 언어를 한국어로 맞춘다.
2. 내 터미널에서 `openclaw ocuclaw pair`를 실행하고, 화면과 휴대폰의 안전 단어 4개가 같은지 비교한다.
3. 내 터미널에서 `openclaw ocuclaw first-use`를 실행한다. 안경에서 메시지를 보내고 → 답이 뜬 것을 확인하고 → 환영 이미지가 뜨면 → 두 번 탭한다.
4. `openclaw ocuclaw journey`로 마쳤는지 확인한다.

## 라이선스와 출처

이 저장소에는 우리가 쓴 코드만 들어 있다. OcuClaw는 라이선스를 밝히지 않았으므로 그 소스는 넣지 않았다. 패처가 찾는 고정 지점(anchor)은 짧은 문자열뿐이다. `scripts/public-safety-scan.sh`가 이를 확인한다.
