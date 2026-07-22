<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a> · <strong>繁體中文</strong> ·
  <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> ·
  <a href="README.it.md">Italiano</a> · <a href="README.ru.md">Русский</a> · <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Gajae Code App 標誌" width="96" height="96">
  <h1>Gajae Code App</h1>
  <p><strong>為 Gajae Code 打造的本機優先 AI 程式開發桌面應用程式</strong></p>
  <p>在單一工作區中管理專案、工作階段、代理預設與技能。</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/gajae-code-app?include_prereleases&label=release" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.3"><strong>下載 macOS 應用程式</strong></a> ·
  <a href="#核心功能">核心功能</a> · <a href="#從原始碼執行">開發</a> ·
  <a href="https://github.com/devswha/gajae-code-app/issues">問題回報</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="工作階段位於專案下方的 Gajae Code App 工作區" width="920"></p>
<p align="center"><sub>展開專案即可存取工作階段，並在同一個工作區開始新的 GJC 任務。</sub></p>

## 什麼是 Gajae Code App？

Gajae Code App 是用於在桌面和瀏覽器中使用 [Gajae Code](https://github.com/devswha/gajae-code) 的開源工作區。它負責啟動與恢復 GJC 工作階段，並依專案整理串流回應與工具執行。

本應用程式不提供 AI 模型或訂閱。它使用 Gajae Code 中既有的帳號、模型與代理設定；專案檔案和執行狀態會保留在執行應用程式的主機上。

> 此儲存庫是 **GJC 專用的 v2 Beta 產品線**。舊版 tmux 監控介面與多供應商 UI 保留於 [gaminus](https://github.com/devswha/gaminus)。

## 核心功能

- **以專案為中心的工作階段** — 展開專案後，相關工作階段會直接顯示在下方。
- **快速建立任務** — 從 **New task** 或專案列的 `+` 啟動 GJC 工作階段。
- **代理預設** — 一次切換 Default、Planner、Executor、Architect、Critic 的模型與 reasoning effort。
- **聊天中的技能** — 使用 `/skill:<name>` 搜尋專案、使用者和內建技能。
- **即時執行時間軸** — 在同一對話中查看串流內容、思考狀態、工具呼叫、核准、中止與恢復。
- **封存與還原** — 不必刪除即可封存專案和工作階段，並於需要時還原。
- **本機檔案瀏覽** — 在保留任務脈絡的同時檢視專案檔案。
- **桌面與 Web 共用核心** — Tauri 外殼和瀏覽器 UI 使用相同的本機伺服器與 GJC 執行邊界。

## 產品畫面

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="代理預設選擇器"><br><sub><b>代理預設</b><br>同時設定預設代理與四個專業角色</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="技能命令選單"><br><sub><b>技能命令</b><br>從聊天搜尋專案、使用者與內建技能</sub></td>
</tr></table>

## 安裝 macOS 應用程式

目前公開 Beta 支援 **Apple Silicon（M1 以上）與 macOS 11 以上版本**。

1. 從 [v2.0.0-beta.3 發行頁](https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.3)下載 DMG 與同名 `.sha256` 檔案。
2. 驗證校驗和：

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.3-macos-arm64.dmg.sha256
   ```

3. 開啟 DMG，將 **Gajae Code App** 拖到 **Applications**。
4. 第一次啟動時，在 Finder 中按住 Control 點擊應用程式並選擇**打開**。若遭封鎖，請前往**系統設定 → 隱私權與安全性 → 強制打開**。

> 目前的 Beta DMG 採用 ad-hoc 簽署，尚未通過 Apple 公證。請僅使用 GitHub Releases 中校驗和一致的檔案。

| 目標 | 狀態 | 需求 |
|---|---|---|
| macOS arm64 桌面版 | 提供 Beta DMG | macOS 11+、Apple Silicon |
| Linux x86_64 伺服器 | 提供 Beta 伺服器套件 | glibc 2.35+、Node.js 22 |
| 瀏覽器開發環境 | 支援原始碼執行 | Node.js 22 或 24 |
| Intel Mac / Windows / Linux 桌面版 | 尚未支援 | 需要額外封裝與驗證 |

## 基本使用流程

1. 點擊 **Projects** 旁的 `+` 新增本機工作區。
2. 展開專案開啟既有工作階段，或按專案列的 `+` 建立新工作階段。
3. 在輸入框的預設選擇器中選擇代理設定。
4. 傳送提示並即時查看回應、工具執行與核准要求。
5. 輸入 `/` 查看基本命令，或輸入 `/skill:` 搜尋可用技能。

## 預設與技能

選擇器會同時顯示 **Current 設定**、適用於 GJC `0.11.1` 的 **28 個內建預設**，以及使用者自訂預設。

- 自訂預設：`~/.gjc/agent/models.yml`
- 目前角色設定：`~/.gjc/agent/config.yml`

`/skill:` 依下列優先順序合併技能：

1. 專案：`<workspace>/.gjc/skills/<name>/SKILL.md`
2. 使用者：`~/.gjc/agent/skills/<name>/SKILL.md`
3. Gajae Code App 內建技能

技能需包含有效的 `name` 與 `description` 才會顯示。設定 `enabled: false` 或 `hide: true` 的技能會被隱藏。

## 從原始碼執行

需要 Node.js `22.22.2+` 或 `24.15.0+`、npm、Git，以及已設定帳號和模型的 Gajae Code。桌面建置另需 Rust `1.85.1`。

```bash
git clone https://github.com/devswha/gajae-code-app.git
cd gajae-code-app
npm ci
npm run dev
```

開啟 <http://127.0.0.1:5173>。Tauri 桌面開發請執行 `npm run desktop:dev`。

## 架構

```text
React UI (Browser / Tauri)
          │ HTTP + WebSocket
          ▼
Gajae Code App local server
          │
          ├── SQLite · project files · Git/worktree
          ▼
gajae-core (Rust process host)
          │ private stdio protocol
          ▼
GJC worker ──▶ Gajae Code CLI / SDK
```

Rust 核心負責程序生命週期、檔案監看、任務狀態與 PTY 邊界。桌面應用程式只連接 loopback 伺服器，並以 bootstrap nonce 和 `HttpOnly` Cookie 保護本機工作階段。詳情請參閱[架構路線圖](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md)與 [Tauri 驗證記錄](docs/DESKTOP-TAURI-VERIFICATION.md)。

## 開發命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 啟動 React 用戶端與開發伺服器 |
| `npm run desktop:dev` | 啟動 Tauri 桌面應用程式 |
| `npm test` | 執行伺服器與用戶端測試 |
| `npm run typecheck` | 檢查 TypeScript |
| `npm run lint` | 執行 ESLint |
| `npm run build` | 建置用戶端、伺服器與 Rust 核心 |
| `npm run verify` | 執行完整品質檢查 |

## 專案狀態與授權

Gajae Code App v2 仍在 Beta 階段。升級前請備份 `~/.gajae-app/data` 與 GJC 設定。請在 [Issues](https://github.com/devswha/gajae-code-app/issues/new) 附上作業系統、應用程式版本和重現步驟。

本專案依 [GNU AGPL v3.0 or later](LICENSE) 發行。它源自 Siteboon AI B.V. 的上游 UI 程式碼庫，現已重構為 GJC 專用產品。出處請參閱 [NOTICE](NOTICE)，上游引入政策請參閱 [docs/UPSTREAM.md](docs/UPSTREAM.md)。
