# Gajae App v2 구현 계획 (end-to-end)

작성일: 2026-07-17. 기준 문서: `docs/MVP.md`(v2 정의),
`docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md`(체크포인트/불변식).
v1.0.0 릴리스 컷(2026-07-17) 이후의 실행 순서를 정의한다.
스코프를 바꾸려면 이 문서를 먼저 고친다.

> **상태 (2026-07-20): v2 완료.** Phase 0–6 전부 착지(릴리스 1.1.0–1.3.0),
> Tauri 셸 C7 실기 GUI 스모크까지 통과(`docs/DESKTOP-TAURI-VERIFICATION.md`,
> `artifacts/g002/`). Electron은 wave1(C9)에서 제거. 남은 항목은
> **notarization(휴먼 게이트, Apple 자격증명)** 과 **이번 런 커밋들의 Linux
> x64 verify 레인 재실행**(본 세션은 macOS arm64에서만 게이트를 돌렸다) 뿐이다.
>
> **v1 격리 불변식 은퇴 (2026-07-20):** wave1–6에서 v1 전용 레인(비-GJC
> provider, web-push/PWA, tmux 미러, 멀티유저 인증)을 제거하면서 원칙 1은
> 역사적 기록이 됐다. v1 사용자는 스냅샷 레포
> **`devswha/gajae-app-v1`** (v1.0.0 컷, 릴리스 미러 포함)로 서비스한다.
> 유지보수 방향은 항상 본 레포 → v1 스냅샷 단방향 체리픽.

## 목표

v2 = 앱이 주인. 웹/데스크톱에서 에이전트 작업을 만들고, 돌리고, 살아있게
유지하고, diff를 리뷰하고, 커밋까지 끝내는 1급 실행기.

## 전역 원칙

1. **v1 격리 불변식**: watcher/tower/알림/히스토리 레인은 어떤 v2 슬라이스도
   건드리지 않는다. v2 신규 구성요소의 실패는 웹 구동 레인만 죽인다.
2. **외부 프로젝트 원칙** (MVP.md 2026-07-17 결정): Paseo는 설계 참고만,
   openai/codex는 Apache-2.0 부분 이식 허용.
3. 모든 슬라이스는 Linux x64 + macOS arm64 양쪽에서 `npm run verify` 풀 게이트
   통과 후에만 main에 올린다.
4. 페이즈 경계마다 1.x 마이너 릴리스를 컷한다 (1.1.0, 1.2.0, …).
5. 데스크톱 셸은 Tauri 우선으로 실측한다 (2026-07-17 구두 결정, Phase 5에서
   수치로 확정 기록).

## Phase 0 — 준비 (완료)

- v1.0.0 태그 + 서버 아티팩트 발행.
- macOS arm64 테스트 타겟(맥북) 구축, 테스트 스위트 크로스플랫폼 green.
- Rust 자산 현황: `gajae-core` host/watch 프로덕션 가동, jobs/pty 구현·미배선.

## Phase 1 — durable jobs 배선 (v2 항목 2 전반부)

떠 있는 `gajae-core jobs` 권위자를 제품에 연결한다.

- **1.1 `GjcJobsClient` 서비스**: `gajae-core jobs --database <app-data>/jobs.sqlite3`
  자식 프로세스를 소유하는 Node 클라이언트.
  `gjc-session-watcher.service.ts` 패턴 재사용: spawn → ready 핸드셰이크 →
  64KiB 프레임 검증 → bounded 재시작 백오프 → stdin EOF 종료.
  실패 격리: jobs 클라이언트 다운 = 웹 구동 런 시작 거부만, 기존 레인 무영향.
- **1.2 런 등록**: 웹 구동 GJC 런(start/resume)을 잡으로 생성하고 fenced
  lease를 잡는다. `turn.completed`/`turn.failed`/abort 확정이 명시적 상태
  전이로 이어진다. 서버 재시작 시 Rust 권위자의 `interrupted` 재조정 결과가
  세션 UI에 그대로 보인다.
- **1.3 replay 정합**: `chat-run-registry`의 in-memory replay를 잡 이벤트
  replay(순서 보장·멱등)와 정렬. 브라우저 재접속은 seq 커서로 이어 붙는다.
- 검증: 유닛 + "런 중 서버 kill → 재기동 → interrupted 관측" e2e.
  Paseo `agent-lifecycle`/`timeline-sync` 문서와 설계 대조.
- 종료 조건: 잡이 UI 접속과 무관하게 생존, abort가 관측 가능, 재시작 후
  상태가 결정적.

## Phase 2 — Git/worktree 이관과 작업 단위 완성 (항목 2 후반 + 항목 4 잔여)

- **2.1 `gajae-core git` API**: worktree 생성/목록/정리, status/diff를 별도
  strict NDJSON API로. 필요 조각은 codex-rs에서 이식(NOTICE 준수).
- **2.2 잡↔worktree 소유권**: 잡이 worktree를 점유/반납하는 규칙, 고아
  worktree 정리, 커밋 전 diff 리뷰(기존 git 패널 재사용) 후 명시적 커밋.
- 검증: worktree 수명주기 + containment(탈출 불가) + diff 리뷰 e2e.
- 종료 조건: 로드맵 product invariants 중 "worktree/잡 소유권·정리 규칙",
  "커밋 전 diff 리뷰" 충족. Checkpoint C 잔여 슬라이스 완료.

## Phase 3 — 웹 구동 실행의 승격 (항목 1)

- "새 작업" 흐름을 UI 1급으로: 프로젝트 선택 → 프롬프트/모델/권한 →
  잡 생성 → 라이브 뷰. 사이드바에 잡 섹션(기존 RUN/LIVE 뱃지 문법 재사용,
  INTERRUPTED 추가). v1 관제 섹션은 그대로 공존.
- 알림(web push)을 잡 터미널 상태에 연결.
- 종료 조건: 브라우저만으로 작업 생성→실행→중단→재개→diff 리뷰→커밋이
  완결. 이 시점에 1.1.0 컷.

## Phase 4 — claude/codex GJC급 라이브 뷰 (항목 3) [Phase 1 이후 병렬 가능]

- **4.1 codex transcript watch**: `~/.codex/sessions` rollout JSONL 루트를
  `gajae-core watch`에 추가하고 codex 전용 synchronizer/뷰 normalize
  (GJC 프로바이더 모듈 구조 복제). claude는 기존 `~/.claude/projects`
  JSONL 인덱싱을 라이브 뷰로 승격.
- **4.2 구조화 send**: codex `app-server` JSON-RPC 레인 프로토타입 →
  SDK 유지 대비 결정 게이트(응답성/이벤트 풍부함 실측 후 확정).
- **4.3 Cursor/OpenCode tmux 감지**: pane subtree 분류 확장.
- 종료 조건: tmux에서 도는 claude/codex 세션이 터미널 attach 없이 구조화
  채팅 뷰로 보이고, 구조화 입력이 가능.

## Phase 5 — Tauri 씬 데스크톱 셸 (항목 5, Checkpoint D)

- **5.1 Tauri 프로토타입**: 빌드된 React 자산 임베드, 로컬 서버
  spawn/attach, 창 수명주기와 잡 생존 분리(Phase 1 산출물 전제). macOS
  arm64(맥북)에서 개발·검증.
- **5.2 실측 결정 기록**: Tauri vs Electron — 기동시간/메모리/번들
  크기/업데이터/서명. Tauri 우선 가설을 수치로 확정하고 roadmap open
  decision을 닫는다.
- **5.3 패키징**: dmg + Linux 배포물, 기존 `desktopVersion` 라인 승계.
- 종료 조건: 창을 닫아도 잡이 살아있는 데스크톱 배포물.

## Phase 6 — 부가 복권 (항목 6)

- 프로젝트 마법사(clone) 복권, control tower 동봉/내장 결정 및 구현.
- 종료 조건: tower 결정이 MVP.md 결정 이력에 기록되고 구현 완료.

## 의존성 요약

```
Phase 1 ──> Phase 2 ──> Phase 3 ──> Phase 5 ──> Phase 6
   └────────────────> Phase 4 (병렬)
```

## 비-목표 (v2에서 하지 않는 것)

- 서버 전체 Rust 재작성, React UI 교체, 모든 프로바이더의 worker 이관.
- Paseo식 relay/모바일 네이티브 앱 (v3 이후 몫).
- 외부 세션의 잡 입양(두 세계 통합) — v2 완료 후 별도 결정.
