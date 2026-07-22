<div align="center">
  <img src="public/logo.png" alt="Gajae App" width="96" height="96">
  <h1>Gajae App</h1>
  <p>tmux에서 이미 돌고 있는 코딩 에이전트들을 보고 찔러주는, 셀프호스팅 웹/데스크톱 관제창.</p>
</div>

<p align="center">
  <a href="#quick-start">빠른 시작</a> ·
  <a href="#first-run">첫 실행</a> ·
  <a href="#daily-workflow">일상 사용</a> ·
  <a href="docs/INSTALL.md">프로덕션 설치</a> ·
  <a href="https://github.com/devswha/Gajae-code-app/issues">이슈</a>
</p>

## Gajae App이 하는 일

Gajae App은 **내 머신/서버의 tmux에서 이미 돌고 있는 코딩 에이전트들을 들여다보는 단일 사용자 관제창**이다. 세션을 자동으로 발견하고, 브라우저나 폰에서 다음을 할 수 있다:

- **뭐가 돌고 있는지 본다** — 지원 에이전트가 든 tmux 세션이 등록 절차 없이 사이드바에 자동으로 뜬다. 턴이 진행 중인 세션은 **RUN**(초록), 지시 대기는 **LIVE**(파랑), 첫 대화 전 pane은 **대기**로 구분된다.
- **대화를 실시간으로 본다** — Gajae Code(GJC) 세션은 transcript 기반 실시간 채팅 뷰로, Claude Code·Codex 세션은 attach된 터미널로 열린다.
- **세션을 찔러준다** — 라이브 GJC 세션에 메시지를 보내고, 새로 띄우고, 죽인다. 갓 띄워 첫 대화 전인 세션에도 사이드바에서 바로 첫 메시지를 보낼 수 있다. 다른 에이전트는 attach된 터미널에 직접 타이핑한다.
- **알림을 받는다** — 라이브 턴이 끝나면 탭을 다 닫아도 web push가 온다.
- **히스토리를 뒤진다** — 과거 프로바이더 세션이 네이티브 세션 스토어에서 자동 인덱싱된다.

세션의 주인은 tmux다: Gajae App을 재시작하거나 꺼도 세션은 죽지 않는다.

웹에서 에이전트를 직접 실행하는 것도 가능하다(스트리밍 채팅 + 툴 콜 승인, 파일 브라우저/에디터, 스킬, MCP 설정) — 관제창 위의 보조 레인이다. 확정된 v1/v2 스코프 기준선은 [docs/MVP.md](docs/MVP.md)에 있다.

앱에 모델 구독은 포함되지 않는다. 사용할 에이전트 CLI는 Gajae App을 돌리는 호스트의 같은 OS 사용자로 미리 설치·인증해 둬야 한다.

### 지원 에이전트

- **Gajae Code (GJC)** — 라이브 채팅 뷰, 메시지 릴레이, spawn/kill + 웹 구동 채팅
- **Claude Code** — tmux 터미널 attach + 웹 구동 채팅
- **Codex** — tmux 터미널 attach + 웹 구동 채팅
- **Cursor** — 웹 구동 채팅
- **OpenCode** — 웹 구동 채팅

프로바이더별 모델·effort·권한 모드·세션 히스토리·스킬·MCP 기능은 해당 프로바이더가 지원할 때만 노출된다.

<a id="quick-start"></a>
## 빠른 시작

> **일상 사용이 목적이면 [프로덕션 설치](docs/INSTALL.md)를 따라 릴리스 아티팩트로 설치하라.**
> 아래 소스 실행은 코드를 고치는 개발용이다 — 미리 빌드된 번들 없이 즉석 변환으로
> 돌기 때문에 로딩이 느리고, HTTP라 브라우저의 앱 설치(PWA)도 제한된다.

### 요구사항

- Node.js 22.22.2+ (22.x) 또는 24.15.0+ (24.x)
- 소스 개발 시 rustup 기반 Rust 1.85.1 (릴리스 아티팩트에는 네이티브 코어가 포함됨)
- npm, Git
- 이미 설치·인증된 지원 에이전트 CLI 1개 이상

### 소스에서 웹 앱 실행

```bash
git clone https://github.com/devswha/Gajae-code-app.git
cd gajae-app
npm ci
npm run dev
```

<http://127.0.0.1:5173> 을 연다. 개발 백엔드는 `127.0.0.1:3001`에서 listen한다.

### 데스크톱 앱 개발 실행

웹 스택을 켜둔 채 두 번째 터미널에서 Electron을 실행한다.

터미널 1:

```bash
npm run dev
```

터미널 2:

```bash
npm run desktop:dev
```

<a id="first-run"></a>
## 첫 실행

1. **기본은 무로그인.** Gajae App은 인증이 꺼진 상태(`GAJAE_AUTH=none`)로 시작한다 — 셀프호스팅 단일 사용자 도구이기 때문이다. `GAJAE_AUTH=password`를 주면 로컬 오너 계정(아이디 3자 이상, 비밀번호 6자 이상)을 요구한다. 인증이 꺼진 상태에서는 `GAJAE_ALLOW_UNAUTH_REMOTE=1`로 노출을 명시적으로 인지하지 않는 한 loopback이 아닌 주소로는 listen을 거부한다(신뢰하는 VPN/tailnet 전용).
2. **Git 정체성 설정.** 이 호스트에서 만들 커밋에 쓸 이름과 이메일을 입력한다. 전역 Git `user.name`/`user.email`에 기록되며 GitHub 로그인은 필요 없다.
3. **코딩 에이전트 연결.** 온보딩에서 프로바이더 로그인 플로우를 진행하거나, 건너뛰고 나중에 **설정 → 에이전트**에서 한다. 호스트 레벨 CLI 인증이 항상 기준이다.
4. **라이브 세션 열기.** tmux에서 이미 돌고 있는 에이전트가 사이드바에 자동으로 뜬다. GJC 세션은 메시지를 보낼 수 있는 라이브 채팅 뷰로, Claude Code·Codex 세션은 attach된 터미널로 열린다.
5. **(선택) 웹에서 에이전트 실행.** 프로젝트 디렉토리를 추가하고 사용 가능한 프로바이더를 골라 모델·권한 컨트롤을 맞춘 뒤 첫 프롬프트를 보낸다.

<a id="daily-workflow"></a>
## 일상 사용

### 라이브 tmux 세션 (코어 레인)

- 세션은 등록이 아니라 **발견**된다: 지원 에이전트가 든 tmux 세션은 자동으로 뜨고, 아직 첫 대화 전인 갓 띄운 GJC pane도 잡힌다.
- GJC 행은 세션 transcript를 먹는 라이브 채팅 뷰로 열린다. 메시지 전송, 슬래시 커맨드, 새 tmux GJC 세션 spawn, kill이 가능하다 — 파괴적 조작은 에이전트가 그 세션 안에서 돈다는 게 증명될 때만 허용되고, 같은 이름으로 교체된 세션은 거부된다.
- Claude Code·Codex 행은 터미널 뷰로 열리며 거기 타이핑하는 게 입력 경로다. SSH로 터널링된 세션은 attach 전용 행으로 뜬다.
- 라이브 행의 주인은 웹 서버가 아니라 tmux다. 서버를 재시작해도 외부 세션은 죽지 않아야 한다.
- 메시지 릴레이는 로컬 control tower 엔드포인트(`TOWER_URL`, 기본 `127.0.0.1:3019`)를 쓴다. tower가 죽어 있어도 보기는 유지되고 전송만 얌전히 실패한다.

### 프로젝트와 세션

- 프로바이더 세션 스토어는 자동 인덱싱된다. 사이드바에서 프로젝트를 펼치면 인덱싱된 세션을 재개할 수 있다. 프로바이더 정체성은 분리 유지된다.
- 웹 구동 채팅용으로는 절대 경로로 로컬 워크스페이스를 추가하거나 프로젝트 마법사로 Git 저장소를 clone한다. 경로는 브라우저를 보는 기기가 아니라 서버가 도는 머신 기준이다.
- GitHub 토큰은 HTTPS clone에 필요할 때만 **설정 → API & Credentials**에 저장한다. SSH URL은 서버 사용자의 SSH 설정을 쓴다.

### 채팅과 승인 (웹 구동 레인)

- 텍스트, 이미지 첨부, 파일 멘션, 프로바이더 지원 슬래시 커맨드를 보낼 수 있다.
- 무제한 실행을 켜는 대신 채팅 안에서 툴 콜을 검토하고 권한 요청에 응답한다.
- 모델·effort·thinking·권한 컨트롤은 선택한 프로바이더가 노출할 때만 쓴다.
- 실행 중지는 활성 에이전트 프로세스를 멈출 뿐, 프로젝트나 히스토리를 지우지 않는다.

### 파일

파일 패널에서 워크스페이스 루트를 탐색하고, 이미지·마크다운을 미리 보고, 텍스트 파일을 편집하고, 폴더 생성과 업로드를 한다. 파일 접근은 검증된 프로젝트 경로로 제한되며 심링크·경로 탈출은 거부된다.

### 알림

**설정 → 알림**에서 브라우저/데스크톱 알림을 켠다. 실행 완료, 에러, 권한 요청, 라이브 턴 완료 이벤트가 각각 토글되므로 시끄러운 레인만 따로 끌 수 있다.

## 원격 사용

서버는 기본적으로 loopback에 바인드된다. 다른 기기에서 쓰려면 그 바인드를 유지한 채 신뢰하는 VPN이나 SSH 터널을 쓴다:

```bash
ssh -N -L 3001:127.0.0.1:3001 user@server
```

그 뒤 로컬에서 <http://127.0.0.1:3001> 을 연다. 3001 포트를 공용 인터넷에 직접 노출하지 마라.

Electron 앱은 원격 Gajae App 서버를 등록할 수 있다. 원격 타깃은 HTTPS가 필수이고, 평문 HTTP는 정확한 loopback 오리진에만 허용된다. 로컬/원격 타깃마다 격리된 Electron 세션 파티션을 써서 쿠키와 스토리지가 공유되지 않는다.

## 프로덕션 설치

프로덕션은 glibc 2.35+ Linux x86_64, Node.js 22.x(22.22.2+), 사용자 레벨 systemd 서비스에서 지원된다.

[GitHub Releases](https://github.com/devswha/Gajae-code-app/releases)의 불변 `gajae-app-server-<version>-linux-x64-node22.tar.gz` 아티팩트를 사용한다. 지원되는 설치는 다음을 지켜야 한다:

1. 고정된 버전과 짝이 되는 `.sha256` 파일을 내려받는다;
2. 압축 해제 전에 체크섬을 검증한다;
3. `~/.gajae-app/releases/<version>` 아래에 푼다;
4. `~/.gajae-app/current`가 그 릴리스를 가리키게 한다;
5. `gajae-app.service`를 user 서비스로 돌리고 `http://127.0.0.1:3001/health`를 확인한다.

정확한 최초 설치 명령은 [docs/INSTALL.md](docs/INSTALL.md), 서비스 운영·업그레이드·원격 접속·롤백·제거는 [docs/SELF-HOST.md](docs/SELF-HOST.md)를 따른다. 가변 `latest` URL, 패키지 레지스트리 사본, 컨테이너 이미지, 검증 안 된 소스 빌드를 프로덕션 서버로 배포하지 마라.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 프로바이더가 안 뜸 | 해당 CLI가 Gajae App을 돌리는 사용자의 `PATH`에서 설치·인증·노출돼 있는지 확인 후 **설정 → 에이전트** 재확인. |
| 프로젝트 경로 거부 | 서버 호스트에 실제로 존재하고 서버 사용자가 접근 가능한 절대 경로를 입력. |
| Electron 개발 화면이 빈 페이지 | `npm run desktop:dev` 전에 `npm run dev`가 켜져 있어야 함. |
| 서비스가 안 뜸 | `systemctl --user status gajae-app.service` 와 `journalctl --user -u gajae-app.service -f` 실행. |
| 원격 접속 실패 | 로컬 `/health`부터 확인한 뒤 SSH/VPN 경로 또는 등록된 HTTPS 오리진 검증. |
| 로그인 후에도 자격 증명이 무효로 보임 | **설정 → 에이전트**에서 프로바이더 재연결 후 서비스 사용자로 CLI를 직접 검증. |

## 개발 명령어

| 명령 | 용도 |
|---|---|
| `npm run dev` | Vite 클라이언트 + 개발 백엔드 실행 |
| `npm run server:dev` | 개발 백엔드만 실행 |
| `npm run client` | Vite 클라이언트만 실행 |
| `npm run desktop:dev` | 개발 클라이언트에 붙는 Electron 실행 |
| `npm test` | 서버·클라이언트·Electron 테스트 실행 |
| `npm run typecheck` | 클라이언트·서버 타입 체크 |
| `npm run lint` | 제품·툴링 코드 전체 ESLint |
| `npm run check:identity` | 제품·법적·출처 정체성 규칙 검증 |
| `npm run build` | 프로덕션 클라이언트·서버 빌드 |
| `npm run verify` | 전체 릴리스 게이트 실행 |

Node.js 22.22.2+ (22.x) 또는 24.15.0+ (24.x)를 쓰고, 변경 제출 전 풀 게이트를 돌린다:

```bash
npm run verify
```

의존성 감사, 타입 체크, 전체 테스트 파티션, lint, 정체성 검증, 프로덕션 빌드가 포함된다.

## 보안과 데이터 경계

- 셀프호스팅 전제로 인증이 기본 비활성(`GAJAE_AUTH=none`)이다. exposure guard가 무인증 비-loopback 바인드를 차단하며 `GAJAE_ALLOW_UNAUTH_REMOTE=1`로만 해제된다. `GAJAE_AUTH=password`에서는 `HttpOnly`, `SameSite=Strict` 쿠키와 영구 로그아웃 무효화를 쓴다.
- URL 쿼리 파라미터로는 자격 증명을 받지 않는다. 외부 에이전트 API 키는 `X-API-Key` 헤더를 쓴다.
- 프로젝트 파일은 정규화 경로·심링크 검사를 거치고, 쓰기는 같은 디렉토리 원자 교체를 쓴다.
- 업로드는 요청별 비공개 임시 디렉토리를 쓰고 완료/실패 후 정리된다.
- Electron은 타깃 권한을 기본 거부하고 IPC를 등록된 런처 프레임으로 제한한다.
- 업그레이드나 호스트 이전 전에 `~/.gajae-app/data`를 백업한다. 릴리스 전환은 이 디렉토리를 보존해야 한다.

## 프로젝트 정보

- [MVP 정의 (v1/v2 스코프 기준선)](docs/MVP.md)
- [프로덕션 설치](docs/INSTALL.md)
- [셀프호스팅과 롤백](docs/SELF-HOST.md)
- [업스트림 출처와 선별 반영](docs/UPSTREAM.md)
- [기여 가이드](CONTRIBUTING.md)
- [이슈 트래커](https://github.com/devswha/Gajae-code-app/issues)

## 라이선스

[GNU AGPL v3](LICENSE)
