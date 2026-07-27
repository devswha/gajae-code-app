# Gajae Code App MVP 정의 (확정본)

확정일: 2026-07-16. 이 문서는 제품 방향의 기준선이다. 여기에 없는 기능 투자는
v2 이후 몫이며, 스코프를 바꾸려면 이 문서를 먼저 고친다.

> **현행 레포 주의 (2026-07-20):** 이 문서의 v1 서술은 **역사적 기준선**이다.
> v2 완주 후 wave1–6 정리에서 v1 전용 레인(비-GJC 5-프로바이더 웹 구동,
> web-push/PWA, tmux 미러, 멀티유저 인증)이 본 레포에서 제거됐다. v1 기능이
> 필요한 사용자는 스냅샷 레포 `devswha/gajae-app-v1`(v1.0.0 컷)을 사용한다.
> 현행 상태는 `docs/V2-PLAN.md` 상태 헤더와
> `docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md`의 v2 completion record가 기준.

## 한 줄 정의

- **v1 = tmux가 주인이고 앱은 창문.** 내 tmux에서 이미 돌고 있는 에이전트들을
  브라우저/폰으로 보고, 말 걸 수 있는 관제창.
- **v2 = 앱이 주인이 되는 것.** Gajae Code App의 Codex App 같은 존재 — 웹/데스크톱이
  에이전트 작업을 직접 실행·관리하는 1급 실행기.

## v1 MVP — tmux 관제창

| # | 기능 | 구현 |
|---|---|---|
| V1-1 | **가져오기** — tmux에서 도는 에이전트 세션 자동 발견. GJC는 lsof+프로세스 혈통(lineage), 첫 메시지 전 idle pane 포함. claude/codex/ssh는 pane subtree 분류 | 완성 |
| V1-2 | **보기** — GJC는 transcript(.jsonl) 기반 실시간 채팅 뷰(`gajae-core watch`), 외부 CLI는 터미널 attach 뷰 | 완성 |
| V1-3 | **찔러주기** — GJC는 control tower(`/send`, `/spawn`, `/kill`) 경유 입력·생명주기. lineage 증명 + 세대 토큰(`$N`)으로 오조작 차단. 외부 CLI는 attach 터미널 입력 | 완성 |
| V1-4 | **알림** — 라이브 턴 완료(live_stop) web push, 탭 닫혀도 동작. 웹 구동 알림과 독립 토글 | 완성 |
| V1-5 | **히스토리** — 프로바이더 세션 스토어 자동 인덱싱. 등록/clone 절차 불필요 | 완성 |
| V1-6 | **무로그인** — `GAJAE_AUTH=none` 기본. implicit owner 매핑, login/register 404. exposure guard가 무인증 비-loopback 바인드를 기동 차단, `GAJAE_ALLOW_UNAUTH_REMOTE=1`로만 해제 | 완성 (2026-07-16) |

### v1 동작 구조

```
입력:  브라우저 → 앱 서버 → control tower(127.0.0.1:3019) → tmux pane → GJC
출력:  GJC → transcript(.jsonl) → gajae-core watch → 앱 서버 → WebSocket → 브라우저
```

입력과 출력 경로가 완전히 분리돼 있다. tower가 죽어도 "보기"는 유지되고
"찔러주기"만 얌전히 실패한다. tower는 이 저장소에 포함되지 않은 외부 구성요소다
(동봉/내장 여부는 v2 결정).

### v1에 존재하지만 코어가 아닌 것 (존치, 추가 투자 금지)

- 웹 구동 채팅 레인: 앱이 CLI를 headless 자식으로 직접 실행 (5개 프로바이더 전부).
  GJC는 `gajae-core`(Rust process host) → Node worker → `gjc -p` 경로.
- 파일 브라우저/에디터, 프로젝트 clone 마법사.

### v1 릴리스 조건

1. 실사용으로 에러/버그 없이 도는 것이 확인될 것.
2. `npm run verify` 풀 게이트 통과.
3. `v1.0.0` 태그 → `gajae-app-server-1.0.0-linux-x64-node22.tar.gz` 발행 →
   CHANGELOG `Unreleased`를 날짜 헤딩으로 전환.

## v2 MVP — Gajae Code App의 Codex App

v1이 에러/버그 없이 돌아간 뒤에만 시작한다.
실행 순서와 슬라이스 정의는 `docs/V2-PLAN.md`가 기준이다.

1. **웹 구동 실행의 승격** — 웹에서 에이전트 작업을 만들고 돌리는 것이 본체.
   기반은 이미 깔린 GJC worker + Rust core 레인.
2. **작업 단위 관리** — 잡이 UI 접속과 무관하게 생존, worktree별 소유권/정리
   규칙, 커밋 전 diff 리뷰, 관측 가능한 진짜 abort, 순서 보장·멱등 이벤트 replay
   (로드맵 product invariants).
3. **claude/codex의 GJC급 라이브 뷰** — 터미널 attach 대신 구조화된 transcript
   뷰 + 구조화 send. Cursor/OpenCode tmux 감지 추가.
4. **Rust 코어 확장** — durable job state, PTY lifecycle, Git/worktree, SQLite
   ownership 이관 (Checkpoint C 잔여 슬라이스).
5. **씬 데스크톱 셸** — Electron vs Tauri 실측 재평가 (Checkpoint D).
6. 프로젝트 마법사(clone 등) 부가 기능 복권. control tower 동봉/내장 결정.

### 외부 프로젝트 활용 원칙 (2026-07-17)

- **Paseo(getpaseo/paseo, AGPLv3)**: 코드 이식 금지(AGPL 전염). 설계 문서만
  참고 — `agent-lifecycle`/`timeline-sync`/`data-model`(→ 2번),
  `providers`/`custom-providers`(→ 3번), `architecture`/`terminal-performance`
  (→ 5번).
- **Codex(openai/codex, Apache-2.0)**: 부분 이식 허용(NOTICE/어트리뷰션 준수).
  `codex-rs` app-server JSON-RPC는 3번 codex 구조화 send·라이브 뷰와 Protocol
  v1 진화의 레퍼런스, sandbox/PTY/Git 조각은 4번 `gajae-core` 확장 재료.
  외부 codex 세션 "보기"는 `~/.codex/sessions` rollout JSONL을
  `gajae-core watch` 루트로 추가하는 경로를 우선 검토한다.
- 어느 쪽도 확정된 Rust core + GJC worker 레인을 **대체**하는 용도로 쓰지
  않는다 (로드맵 confirmed decision 위반).

## 제품 경계 — gjc-app은 프론트엔드다 (2026-07-27 확정)

에이전트 기능은 **이 저장소가 만들지 않는다.** `@gajae-code/coding-agent`(현재
`0.11.8`, `package.json`에 버전 고정된 npm 의존성)가 소유한다. gjc-app은 그
위에 얹히는 UI/UX 셸이며, 실질 권한은 "무엇을 켜고 무엇을 보여줄지 고르는 것"에
한정된다.

### 소유 경계

| coding-agent (upstream) | gjc-app (이 저장소) |
|---|---|
| 툴 34종 (`tools/index.ts` `BUILTIN_TOOLS`) | 웹/데스크톱 UI 전체 |
| 번들 스킬 4종 (`defaults/gjc/skills/*/SKILL.md`) | 워커 프로세스 감독 (`gjc-worker-client.ts`) |
| 슬래시 명령 43종 (`slash-commands/builtin-registry.ts`) | **활성 툴 선택** (`toolNames`) |
| 세션 엔진·모델 해석·프롬프트 | **디스패치 명령 선택** (`gjc-command-catalog.ts`) |
| | 앱 네이티브 대체 명령 (`appUiCommands.ts`) |

### 여기서 따라오는 규칙

1. **기능을 만들지 말고 드러내라.** upstream에 이미 있는 것을 앱에서 못 쓰는
   상태가 결함이다. 앱에서 재구현하는 것은 결함의 해결이 아니라 분기다.
2. **선택 목록은 손으로 베끼지 않는다.** `gjc-command-catalog.ts`(43종 중 23종)와
   `gjc-skills.provider.ts`의 `BUNDLED_SKILLS`는 현재 upstream을 수기 복사한
   사본이다. `docs/UPSTREAM.md`가 수동 선별 반영 정책이므로 이 어긋남은
   버전 업마다 재발한다. 2026-07-27에 발견된 `/move`·`/models`·`/bg`·`/quit`·
   `/contribution-prep`·`/help` 6종 누락(모델에게 생텍스트 유출)이 그 실례다.
   생성 + CI 드리프트 검사로 대체한다.
3. **UI가 없는 툴은 절반만 켠 것이다.** `job`·`monitor`·`goal`처럼 산출물을
   보여줄 화면이 없는 툴은, 켜는 순간 "보이지 않는 곳에서 도는 상태"를 만든다.
   툴 활성화와 그 툴의 표시 화면은 같은 슬라이스로 묶는다.
4. **안전장치는 프론트엔드 일이다.** 파괴적 명령의 확인 창은 upstream이 아니라
   앱이 제공해야 하는 어포던스다.

### 현재 노출 상태 (2026-07-27 실측)

- 툴: 34종 중 **7종** 활성 (`bash, read, write, edit, search, find, ask`).
  SDK 기본 필수 6종 + `ask`로, 사실상 최소 구성.
- 스킬: 번들 4종 중 3종 표기(`team`은 tmux 기반이라 앱에서 숨김). 다만
  `skill` 툴이 꺼져 있어 **표기된 3종도 결정적 활성화가 되지 않는다.**
  `/skill:<name>`을 슬래시 명령으로 바꾸는 경로는 TUI 전용
  (`modes/interactive-mode.ts`)이라 앱에는 존재하지 않는다.
- 앱에 화면이 아예 없는 upstream 기능: 세션 분기(`/tree`), 사이드 챗(`/btw`),
  목표 모드(`/goal`), 메시지 복사.

## 버저닝 정책 (2026-07-16 확정)

- Gajae Code App 자체 semver 라인은 `1.0.0`부터 시작. 업스트림(claudecodeui) `1.36.x`
  넘버는 CHANGELOG의 historical provenance 전용이며 절대 재사용하지 않는다.
- 태그는 실제 릴리스 컷에서만 만든다 (`v<version>`).
- 실행 중인 서버는 `/health`에서 버전을 보고한다. 데스크톱 셸은 독립된
  `desktopVersion` 라인을 유지한다.

## 결정 이력

| 날짜 | 결정 |
|---|---|
| 2026-07-16 | v1 = tmux 관제창으로 확정. 웹 구동 레인은 보조로 격하 (삭제 없음) |
| 2026-07-16 | 자체 버전 라인 `1.0.0` 시작, 업스트림 넘버 폐기 |
| 2026-07-16 | 무로그인 기본 (`GAJAE_AUTH=none`) + fail-closed exposure guard 구현 |
| 2026-07-16 | GJC worker/Rust core 격리(Checkpoint A/B/C 슬라이스 1·2)는 완성 자산으로 존치, 이후 러스트 투자는 v2로 이연 |
| 2026-07-17 | 외부 프로젝트 활용 원칙 확정: Paseo(AGPLv3)는 설계 참고만·코드 이식 금지, openai/codex(Apache-2.0)는 app-server 프로토콜·Rust 조각 부분 이식 허용 |
| 2026-07-27 | **gjc-app = UI/UX 프론트엔드로 제품 경계 확정.** 에이전트 기능은 `@gajae-code/coding-agent`가 소유하고, 이 저장소는 노출·표시·안전장치만 담당한다. 앱에서의 에이전트 기능 재구현 금지 |
| 2026-07-27 | upstream 선택 목록(명령 카탈로그·번들 스킬)의 수기 복사를 폐기 대상으로 확정. 생성 + CI 드리프트 검사로 대체 |
