<div align="center">
  <img src="public/logo.png" alt="Gajae App" width="96" height="96">
  <h1>Gajae App</h1>
  <p><strong>Gajae Code를 위한 Codex App 스타일 로컬 AI 코딩 워크스페이스</strong></p>
  <p>프로젝트, 세션, 모델 프리셋, 스킬을 한 화면에서 관리하고 GJC 작업을 직접 실행합니다.</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/Gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/Gajae-code-app?include_prereleases&label=release" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/Gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/Node.js-22%20%7C%2024-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22 or 24">
  <img src="https://img.shields.io/badge/agent-Gajae%20Code-E86F51" alt="Gajae Code">
</p>

<p align="center">
  <a href="#왜-gajae-app인가">핵심 기능</a> ·
  <a href="#macos-앱-다운로드">앱 다운로드</a> ·
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="#모델-프리셋과-스킬">프리셋과 스킬</a> ·
  <a href="docs/INSTALL.md">서버 설치</a> ·
  <a href="CONTRIBUTING.md">기여</a>
</p>

<p align="center">
  <img src="public/screenshots/gajae-app-overview.jpg" alt="Gajae App의 프로젝트별 세션과 새 작업 화면" width="920">
</p>
<p align="center"><sub>프로젝트를 펼치면 세션이 바로 이어지고, 같은 화면에서 새 Gajae Code 작업을 시작합니다.</sub></p>

Gajae App은 [Gajae Code](https://github.com/devswha/gajae-code)를 데스크톱과 브라우저에서 쓰기 위한 **로컬 우선 실행기**입니다. 앱이 GJC 세션을 시작하고 재개하며, 스트리밍 대화와 도구 실행을 프로젝트 단위로 정리합니다. 모델 구독이나 별도 AI 서비스는 포함하지 않으며, GJC에 설정된 계정과 모델을 그대로 사용합니다.

현재 저장소는 **GJC 전용 v2 제품 라인**입니다. 과거의 tmux 관제창과 다중 프로바이더 UI가 필요한 경우 [gaminus](https://github.com/devswha/gaminus) 스냅샷을 사용하세요.

## 왜 Gajae App인가

- **프로젝트 안에 세션이 있다.** 프로젝트를 펼치면 해당 세션이 바로 아래에 나타나며, 최근 작업을 짧고 촘촘한 목록으로 탐색할 수 있습니다.
- **새 작업의 진입점이 단순하다.** 상단의 **New task** 또는 프로젝트 행의 `+`에서 GJC 세션을 시작합니다.
- **한 번에 에이전트 팀을 고른다.** Default, Planner, Executor, Architect, Critic 다섯 역할을 모델 프리셋 하나로 전환합니다.
- **스킬이 채팅 안으로 들어온다.** `/skill:<name>` 커맨드로 프로젝트, 사용자, 번들 스킬을 검색하고 실행합니다.
- **GJC의 작업 흐름을 그대로 보여준다.** 스트리밍 응답, 도구 호출, 승인 요청, 중단, 세션 재개를 하나의 채팅 타임라인에서 다룹니다.
- **로컬 코드가 로컬에 남는다.** 프로젝트 파일, Git 상태, GJC 설정과 세션은 앱이 실행되는 호스트에서 처리됩니다.
- **웹과 데스크톱이 같은 코어를 쓴다.** React UI와 로컬 서버를 공유하고, macOS 데스크톱 셸은 Tauri로 제공합니다.

## 제품 화면

<table>
  <tr>
    <td width="50%" align="center">
      <img src="public/screenshots/model-presets.jpg" alt="Gajae App 모델 프리셋 선택기">
      <br><sub><b>모델 프리셋</b><br>기본 에이전트와 4개 전문 에이전트를 함께 선택</sub>
    </td>
    <td width="50%" align="center">
      <img src="public/screenshots/skill-commands.jpg" alt="Gajae App 스킬 슬래시 커맨드 메뉴">
      <br><sub><b>스킬 커맨드</b><br>프로젝트·사용자·번들 스킬을 채팅에서 검색</sub>
    </td>
  </tr>
</table>

## 빠른 시작

### macOS 앱 다운로드

Apple Silicon(M1 이상) Mac에서는 소스 빌드 없이 [Gajae App v2.0.0-beta.2](https://github.com/devswha/Gajae-code-app/releases/tag/v2.0.0-beta.2)의 `gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg`를 내려받아 설치할 수 있습니다.

1. DMG와 같은 이름의 `.sha256` 파일을 함께 내려받습니다.
2. 터미널에서 체크섬을 확인합니다.

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256
   ```

3. DMG를 열고 **Gajae App**을 **Applications**로 드래그합니다.
4. 첫 실행은 Finder에서 앱을 `Control`-클릭한 뒤 **열기**를 선택합니다. 차단되면 **시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기**를 사용하세요.

> 이 베타 DMG는 아직 Apple Developer ID 공증을 받지 않은 ad-hoc 서명 빌드입니다. 체크섬이 일치하는 GitHub Release 아티팩트만 사용하세요. Intel Mac, Windows, Linux 데스크톱 설치 파일은 아직 제공하지 않습니다.

### 요구사항

- Node.js `22.22.2+` (22.x) 또는 `24.15.0+` (24.x)
- npm과 Git
- 소스 개발 및 데스크톱 빌드: rustup 기반 Rust `1.85.1`
- GJC에서 사용할 계정과 모델 설정

### 웹 개발 서버

```bash
git clone https://github.com/devswha/Gajae-code-app.git
cd Gajae-code-app
npm ci
npm run dev
```

브라우저에서 <http://127.0.0.1:5173>을 엽니다. 개발 백엔드는 `127.0.0.1:3001`에서 실행됩니다.

### macOS 데스크톱 앱 개발

```bash
npm ci
npm run desktop:dev
```

`desktop:dev`는 Tauri 셸과 로컬 Gajae App 서버를 함께 실행합니다. 별도의 웹 개발 서버를 먼저 켤 필요가 없습니다.

> GitHub Release는 **macOS arm64 데스크톱 DMG**와 **Linux x86_64 서버 아티팩트**를 각각 체크섬과 함께 제공합니다.

## 기본 사용 흐름

1. 사이드바의 **Projects** 옆 `+`를 눌러 로컬 워크스페이스를 추가합니다.
2. 프로젝트를 펼쳐 기존 세션을 열거나, 프로젝트 행의 `+`로 새 세션을 만듭니다.
3. 입력창 오른쪽의 프리셋 선택기에서 사용할 에이전트 구성을 고릅니다.
4. 프롬프트를 보내고 스트리밍 응답, 도구 호출, 승인 요청을 채팅에서 확인합니다.
5. `/`로 기본 커맨드를, `/skill:`로 사용 가능한 GJC 스킬을 찾습니다.
6. 필요하면 우측 파일 패널에서 프로젝트 파일을 탐색하고 Git 작업을 검토합니다.

## 모델 프리셋과 스킬

### 모델 프리셋

Gajae App은 현재 역할 설정인 **Current**, GJC `0.11.1` 기준 **28개 내장 프리셋**, 사용자의 커스텀 프리셋을 한 목록에 표시합니다. 각 프리셋은 다음 역할의 모델과 reasoning effort를 함께 정의할 수 있습니다.

| 역할 | 용도 |
|---|---|
| Default | 일반 대화와 작업 조율 |
| Planner | 계획 수립과 요구사항 분해 |
| Executor | 구현과 반복 작업 |
| Architect | 구조·경계·장기 설계 판단 |
| Critic | 검토, 반례 탐색, 품질 게이트 |

커스텀 프리셋은 GJC의 `~/.gjc/agent/models.yml`에서 읽습니다. 현재 역할 구성은 `~/.gjc/agent/config.yml`을 따릅니다.

### 스킬

입력창에서 `/skill:`을 입력하면 아래 우선순위로 스킬을 합쳐 보여줍니다.

1. 프로젝트 스킬: `<workspace>/.gjc/skills/<name>/SKILL.md`
2. 사용자 스킬: `~/.gjc/agent/skills/<name>/SKILL.md`
3. Gajae App 번들 스킬

동일한 이름이 있으면 프로젝트 → 사용자 → 번들 순으로 우선합니다. `SKILL.md`에 유효한 `name`과 `description`이 있어야 메뉴에 나타나며, `enabled: false` 또는 `hide: true`인 스킬은 숨깁니다.

## 동작 구조

```text
React UI (Browser / Tauri)
          │ HTTP + WebSocket
          ▼
Gajae App local server
          │
          ├── SQLite · project files · Git/worktree
          │
          ▼
gajae-core (Rust process host)
          │ private stdio protocol
          ▼
GJC worker ──▶ Gajae Code CLI / SDK
```

- GJC 실행과 세션 재개는 앱 서버 뒤의 전용 worker 경계를 통과합니다.
- Rust core가 프로세스 수명주기, 감시, 작업 권한의 네이티브 경계를 담당합니다.
- UI 연결이 끊겨도 서버가 소유한 작업 상태와 세션 히스토리는 별도로 유지됩니다.
- 데스크톱 셸은 loopback 서버에만 연결하며 bootstrap nonce와 `HttpOnly` 쿠키로 로컬 세션을 보호합니다.

자세한 결정과 검증 기록은 [GJC 데스크톱 아키텍처 로드맵](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md)과 [Tauri 검증 기록](docs/DESKTOP-TAURI-VERIFICATION.md)을 참고하세요.

## 설치와 셀프호스팅

프로덕션 서버의 현재 지원 대상은 다음과 같습니다.

| 대상 | 상태 | 요구사항 |
|---|---|---|
| Linux x86_64 서버 | GitHub Release 베타 아티팩트 제공 | glibc 2.35+, Node.js 22 |
| macOS arm64 데스크톱 | GitHub Release 베타 DMG 제공 | macOS 11+, Apple Silicon |
| Windows / Linux 데스크톱 | 미지원 | 향후 별도 검증 필요 |

데스크톱과 서버 설치 모두 [GitHub Releases](https://github.com/devswha/Gajae-code-app/releases)의 버전 고정 아티팩트와 `.sha256` 파일을 함께 사용합니다. 가변 `latest` URL이나 검증하지 않은 소스 번들을 사용하지 마세요.

- 최초 설치: [docs/INSTALL.md](docs/INSTALL.md)
- 운영, 업그레이드, 롤백, 제거: [docs/SELF-HOST.md](docs/SELF-HOST.md)

서버는 loopback에 두고 신뢰하는 VPN 또는 SSH 터널로 접근하는 방식을 권장합니다.

```bash
ssh -N -L 3001:127.0.0.1:3001 user@server
```

## 개발

| 명령 | 용도 |
|---|---|
| `npm run dev` | Vite 클라이언트와 개발 백엔드 실행 |
| `npm run client` | Vite 클라이언트만 실행 |
| `npm run server:dev` | 개발 백엔드만 실행 |
| `npm run desktop:dev` | Tauri 데스크톱 앱 개발 실행 |
| `npm test` | 서버·클라이언트 테스트 실행 |
| `npm run typecheck` | 클라이언트·서버 TypeScript 검사 |
| `npm run lint` | 제품과 툴링 코드 ESLint 검사 |
| `npm run build` | 클라이언트·서버·Rust core 빌드 |
| `npm run verify` | 감사, 타입, Rust, 테스트, lint, 정체성, 빌드 전체 게이트 |

변경 제출 전 전체 검증을 실행하세요.

```bash
npm run verify
```

저장소 구조와 기여 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 문서

- [v2 구현 계획과 완료 상태](docs/V2-PLAN.md)
- [GJC 데스크톱 아키텍처 로드맵](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md)
- [Tauri 데스크톱 검증 기록](docs/DESKTOP-TAURI-VERIFICATION.md)
- [프로덕션 설치](docs/INSTALL.md)
- [셀프호스팅과 롤백](docs/SELF-HOST.md)
- [업스트림 출처와 선별 반영 정책](docs/UPSTREAM.md)
- [이슈 트래커](https://github.com/devswha/Gajae-code-app/issues)

## 프로젝트 상태

Gajae App v2는 현재 베타입니다. 세션·프로젝트 데이터는 보존하지만, 업그레이드 전 `~/.gajae-app/data`와 GJC 설정을 백업하세요. 버그는 재현 단계, 운영체제, 앱 버전과 함께 [이슈](https://github.com/devswha/Gajae-code-app/issues/new)로 알려주세요.

## 라이선스와 출처

Gajae App은 [GNU AGPL v3.0 or later](LICENSE)로 배포됩니다. 네트워크를 통해 수정 버전을 제공하는 경우 해당 사용자에게 대응 소스를 제공해야 합니다.

이 프로젝트는 Siteboon AI B.V.의 업스트림 UI 코드베이스에서 시작되었고 현재 GJC 전용 제품으로 재구성되었습니다. 저작권과 재라이선스 경계는 [NOTICE](NOTICE), 선별적 업스트림 반영 원칙은 [docs/UPSTREAM.md](docs/UPSTREAM.md)를 확인하세요.

README의 정보 구조와 제품 제시 방식은 유사한 로컬 개발자 도구인 [lidge-jun/opencodex](https://github.com/lidge-jun/opencodex)를 참고했으며, 기능 설명과 명령은 Gajae App의 현재 코드와 릴리스 계약을 기준으로 작성했습니다.
