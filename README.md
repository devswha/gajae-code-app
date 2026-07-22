<p align="center">
  <strong>한국어</strong> ·
  <a href="README.en.md">English</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.it.md">Italiano</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Gajae App 로고" width="96" height="96">
  <h1>Gajae App</h1>
  <p><strong>Gajae Code를 위한 로컬 우선 AI 코딩 데스크톱</strong></p>
  <p>프로젝트, 세션, 에이전트 프리셋, 스킬을 하나의 작업 공간에서 관리합니다.</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/gajae-code-app?include_prereleases&label=release" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
  <img src="https://img.shields.io/badge/agent-Gajae%20Code-E86F51" alt="Gajae Code">
</p>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.2"><strong>macOS 앱 다운로드</strong></a> ·
  <a href="#핵심-기능">핵심 기능</a> ·
  <a href="#소스에서-실행">개발 시작</a> ·
  <a href="https://github.com/devswha/gajae-code-app/issues">이슈</a>
</p>

<p align="center">
  <img src="public/screenshots/gajae-app-overview.jpg" alt="프로젝트 아래에 세션이 정리된 Gajae App 작업 화면" width="920">
</p>
<p align="center"><sub>프로젝트를 펼치면 세션이 바로 이어지고, 같은 화면에서 새 GJC 작업을 시작할 수 있습니다.</sub></p>

## Gajae App이란

Gajae App은 [Gajae Code](https://github.com/devswha/gajae-code)를 데스크톱과 브라우저에서 사용하기 위한 오픈소스 작업 공간입니다. 앱이 GJC 세션을 시작하고 재개하며, 스트리밍 응답과 도구 실행을 프로젝트 단위로 정리합니다.

이 앱은 AI 모델이나 구독을 제공하지 않습니다. Gajae Code에 설정된 계정, 모델, 에이전트 설정을 그대로 사용하며 프로젝트 파일과 실행 상태는 앱이 동작하는 호스트에 남습니다.

> 이 저장소는 **GJC 전용 v2 베타 제품 라인**입니다. 과거 tmux 관제 UI와 다중 프로바이더 화면은 [gaminus](https://github.com/devswha/gaminus)에 보존되어 있습니다.

## 핵심 기능

- **프로젝트 중심 세션 탐색** — 프로젝트를 펼치면 관련 세션이 바로 아래에 표시됩니다. 별도의 Work 목록으로 이동할 필요 없이 최근 대화를 빠르게 다시 엽니다.
- **빠른 새 작업** — 상단의 **New task** 또는 각 프로젝트 행의 `+`에서 현재 워크스페이스를 대상으로 새 GJC 세션을 시작합니다.
- **에이전트 프리셋** — Default, Planner, Executor, Architect, Critic 역할의 모델과 reasoning effort를 하나의 프리셋으로 전환합니다.
- **채팅 안의 스킬** — `/skill:<name>`으로 프로젝트, 사용자, 번들 스킬을 검색하고 프롬프트에 적용합니다.
- **실시간 실행 타임라인** — 스트리밍 응답, 사고 상태, 도구 호출, 승인 요청, 중단과 재개를 한 대화에서 확인합니다.
- **보관과 복구** — 프로젝트와 세션을 삭제하지 않고 보관하고, 필요할 때 다시 활성화할 수 있습니다.
- **로컬 파일 탐색** — 현재 프로젝트의 파일을 앱 안에서 열어보고 작업 컨텍스트를 유지합니다.
- **데스크톱과 웹의 공통 코어** — Tauri 데스크톱 셸과 브라우저 UI가 같은 로컬 서버와 GJC 실행 경계를 사용합니다.

## 제품 화면

<table>
  <tr>
    <td width="50%" align="center">
      <img src="public/screenshots/model-presets.jpg" alt="Gajae App 에이전트 프리셋 선택기">
      <br><sub><b>에이전트 프리셋</b><br>기본 에이전트와 4개 전문 역할을 함께 선택</sub>
    </td>
    <td width="50%" align="center">
      <img src="public/screenshots/skill-commands.jpg" alt="Gajae App 스킬 슬래시 커맨드 메뉴">
      <br><sub><b>스킬 커맨드</b><br>프로젝트·사용자·번들 스킬을 채팅에서 검색</sub>
    </td>
  </tr>
</table>

## macOS 앱 설치

현재 공개 데스크톱 빌드는 **Apple Silicon(M1 이상), macOS 11 이상**을 지원합니다.

1. [v2.0.0-beta.2 릴리스](https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.2)에서 아래 두 파일을 내려받습니다.
   - `gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg`
   - `gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256`
2. 다운로드 폴더에서 체크섬을 검증합니다.

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256
   ```

3. DMG를 열고 **Gajae App**을 **Applications**로 드래그합니다.
4. 첫 실행은 Finder에서 앱을 `Control`-클릭하고 **열기**를 선택합니다. 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기**를 사용합니다.

> 현재 베타 DMG는 ad-hoc 서명되어 있으며 Apple 공증 전 상태입니다. GitHub Release에서 받은 파일과 체크섬이 일치하는지 반드시 확인하세요.

### 배포 지원 범위

| 대상 | 상태 | 요구사항 |
|---|---|---|
| macOS arm64 데스크톱 | 베타 DMG 제공 | macOS 11+, Apple Silicon |
| Linux x86_64 서버 | 베타 서버 아티팩트 제공 | glibc 2.35+, Node.js 22 |
| 브라우저 개발 환경 | 소스 실행 지원 | Node.js 22 또는 24 |
| Intel Mac / Windows / Linux 데스크톱 | 아직 미지원 | 별도 검증과 패키징 필요 |

모든 설치 파일은 [GitHub Releases](https://github.com/devswha/gajae-code-app/releases)에서 버전이 고정된 아티팩트와 `.sha256`을 함께 제공합니다.

## 기본 사용 흐름

1. 사이드바의 **Projects** 옆 `+`로 로컬 폴더를 워크스페이스로 추가합니다.
2. 프로젝트를 펼쳐 기존 세션을 열거나 프로젝트 행의 `+`로 새 세션을 만듭니다.
3. 입력창의 프리셋 선택기에서 사용할 에이전트 구성을 고릅니다.
4. 프롬프트를 보내고 응답, 도구 실행, 승인 요청을 실시간으로 확인합니다.
5. `/`로 기본 커맨드를, `/skill:`로 사용 가능한 스킬을 검색합니다.
6. 필요하면 파일 패널에서 프로젝트 파일을 확인하고 이어서 작업합니다.

## 프리셋과 스킬

### 에이전트 프리셋

현재 앱은 **Current 설정**, GJC `0.11.1` 기준 **28개 내장 프리셋**, 사용자 커스텀 프리셋을 같은 선택기에 표시합니다.

| 역할 | 담당 작업 |
|---|---|
| Default | 일반 대화와 작업 조율 |
| Planner | 계획 수립과 요구사항 분해 |
| Executor | 구현과 반복 실행 |
| Architect | 구조, 경계, 장기 설계 판단 |
| Critic | 검토, 반례 탐색, 품질 확인 |

- 커스텀 프리셋: `~/.gjc/agent/models.yml`
- 현재 역할 설정: `~/.gjc/agent/config.yml`

### 스킬 검색 순서

`/skill:` 메뉴는 다음 위치를 합쳐 보여주며, 같은 이름이 있으면 위쪽 항목이 우선합니다.

1. 프로젝트: `<workspace>/.gjc/skills/<name>/SKILL.md`
2. 사용자: `~/.gjc/agent/skills/<name>/SKILL.md`
3. Gajae App 번들 스킬

메뉴에 표시하려면 `SKILL.md`에 유효한 `name`과 `description`이 필요합니다. `enabled: false` 또는 `hide: true`인 스킬은 숨겨집니다.

## 소스에서 실행

### 요구사항

- Node.js `22.22.2+` 또는 `24.15.0+`
- npm과 Git
- 사용할 계정과 모델이 설정된 Gajae Code
- 데스크톱 빌드 시 rustup 기반 Rust `1.85.1`

### 웹 개발 환경

```bash
git clone https://github.com/devswha/gajae-code-app.git
cd gajae-code-app
npm ci
npm run dev
```

브라우저에서 <http://127.0.0.1:5173>을 엽니다. 개발 API 서버는 `127.0.0.1:3001`에서 실행됩니다.

### Tauri 데스크톱 개발

```bash
npm ci
npm run desktop:dev
```

이 명령은 Tauri 셸과 전용 로컬 Gajae App 서버를 함께 시작합니다.

## 구조

```text
React UI (Browser / Tauri)
          │ HTTP + WebSocket
          ▼
Gajae App local server
          │
          ├── SQLite · project files · Git/worktree
          ▼
gajae-core (Rust process host)
          │ private stdio protocol
          ▼
GJC worker ──▶ Gajae Code CLI / SDK
```

- Rust core가 GJC 프로세스 수명주기, 파일 감시, 작업 상태와 PTY 경계를 담당합니다.
- 서버가 작업과 세션 상태를 소유하므로 UI 연결이 잠시 끊겨도 실행 상태를 복구할 수 있습니다.
- 데스크톱 앱은 loopback 서버에만 연결하고 bootstrap nonce와 `HttpOnly` 쿠키로 로컬 세션을 보호합니다.

자세한 내용은 [아키텍처 로드맵](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md)과 [Tauri 검증 기록](docs/DESKTOP-TAURI-VERIFICATION.md)을 참고하세요.

## 개발 명령

| 명령 | 용도 |
|---|---|
| `npm run dev` | React 클라이언트와 개발 서버 실행 |
| `npm run desktop:dev` | Tauri 데스크톱 앱 실행 |
| `npm test` | 서버와 클라이언트 테스트 |
| `npm run typecheck` | TypeScript 검사 |
| `npm run lint` | ESLint 검사 |
| `npm run build` | 클라이언트, 서버, Rust core 빌드 |
| `npm run verify` | 감사, 타입, Rust, 테스트, lint, 정체성, 빌드 전체 검증 |

서버 배포와 운영은 [설치 가이드](docs/INSTALL.md)와 [셀프호스팅 가이드](docs/SELF-HOST.md)를 확인하세요.

## 프로젝트 상태

Gajae App v2는 베타입니다. 업그레이드 전 `~/.gajae-app/data`와 GJC 설정을 백업하세요. 문제를 발견하면 운영체제, 앱 버전, 재현 단계와 함께 [이슈](https://github.com/devswha/gajae-code-app/issues/new)를 등록해 주세요.

## 라이선스와 출처

Gajae App은 [GNU AGPL v3.0 or later](LICENSE)로 배포됩니다. 이 프로젝트는 Siteboon AI B.V.의 업스트림 UI 코드베이스에서 시작해 GJC 전용 제품으로 재구성되었습니다. 저작권과 추가 조건은 [NOTICE](NOTICE), 업스트림 반영 정책은 [docs/UPSTREAM.md](docs/UPSTREAM.md)를 확인하세요.
