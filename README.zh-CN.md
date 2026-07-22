<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> ·
  <strong>简体中文</strong> · <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> ·
  <a href="README.it.md">Italiano</a> · <a href="README.ru.md">Русский</a> · <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Gajae App 标志" width="96" height="96">
  <h1>Gajae App</h1>
  <p><strong>为 Gajae Code 打造的本地优先 AI 编程桌面应用</strong></p>
  <p>在一个工作区中管理项目、会话、智能体预设与技能。</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/Gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/Gajae-code-app?include_prereleases&label=release" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/Gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/Gajae-code-app/releases/tag/v2.0.0-beta.2"><strong>下载 macOS 应用</strong></a> ·
  <a href="#核心功能">核心功能</a> · <a href="#从源码运行">开发</a> ·
  <a href="https://github.com/devswha/Gajae-code-app/issues">问题反馈</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="会话嵌套在项目下方的 Gajae App 工作区" width="920"></p>
<p align="center"><sub>展开项目即可访问会话，并在同一工作区开始新的 GJC 任务。</sub></p>

## Gajae App 是什么？

Gajae App 是用于在桌面端和浏览器中使用 [Gajae Code](https://github.com/devswha/gajae-code) 的开源工作区。它负责启动与恢复 GJC 会话，并按项目整理流式回复和工具执行。

本应用不提供 AI 模型或订阅服务。它使用 Gajae Code 中已有的账户、模型和智能体配置；项目文件与执行状态保留在运行应用的主机上。

> 本仓库是 **仅面向 GJC 的 v2 Beta 产品线**。旧版 tmux 监控界面和多提供商 UI 保存在 [gaminus](https://github.com/devswha/gaminus)。

## 核心功能

- **以项目为中心的会话** — 展开项目后，相关会话直接显示在项目下方。
- **快速新建任务** — 通过 **New task** 或项目行的 `+` 启动新的 GJC 会话。
- **智能体预设** — 一次切换 Default、Planner、Executor、Architect、Critic 的模型与 reasoning effort。
- **聊天内技能** — 使用 `/skill:<name>` 搜索项目、用户和内置技能。
- **实时执行时间线** — 在同一对话中查看流式输出、思考状态、工具调用、审批、中止和恢复。
- **归档与恢复** — 无需删除即可归档项目和会话，并在需要时恢复。
- **本地文件浏览** — 在保持任务上下文的同时查看项目文件。
- **桌面与 Web 共用核心** — Tauri 外壳与浏览器 UI 使用同一本地服务器和 GJC 执行边界。

## 产品界面

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="智能体预设选择器"><br><sub><b>智能体预设</b><br>同时配置默认智能体和四个专业角色</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="技能命令菜单"><br><sub><b>技能命令</b><br>在聊天中搜索项目、用户和内置技能</sub></td>
</tr></table>

## 安装 macOS 应用

公开桌面 Beta 当前支持 **Apple Silicon（M1 及更新机型）和 macOS 11 及以上版本**。

1. 从 [v2.0.0-beta.2 发布页](https://github.com/devswha/Gajae-code-app/releases/tag/v2.0.0-beta.2)下载 DMG 及同名 `.sha256` 文件。
2. 验证校验和：

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256
   ```

3. 打开 DMG，将 **Gajae App** 拖入 **Applications**。
4. 首次启动时，在 Finder 中按住 Control 点击应用并选择**打开**。如被阻止，请前往**系统设置 → 隐私与安全性 → 仍要打开**。

> 当前 Beta DMG 使用 ad-hoc 签名，尚未通过 Apple 公证。请只使用 GitHub Releases 中且校验和一致的文件。

| 目标 | 状态 | 要求 |
|---|---|---|
| macOS arm64 桌面版 | 提供 Beta DMG | macOS 11+、Apple Silicon |
| Linux x86_64 服务器 | 提供 Beta 服务器包 | glibc 2.35+、Node.js 22 |
| 浏览器开发环境 | 支持源码运行 | Node.js 22 或 24 |
| Intel Mac / Windows / Linux 桌面版 | 暂不支持 | 需要单独打包与验证 |

## 基本使用流程

1. 点击 **Projects** 旁的 `+` 添加本地工作区。
2. 展开项目打开已有会话，或点击项目行的 `+` 新建会话。
3. 在输入框的预设选择器中选择智能体配置。
4. 发送提示词，实时查看回复、工具执行和审批请求。
5. 输入 `/` 查看基础命令，输入 `/skill:` 搜索可用技能。

## 预设与技能

选择器会同时显示 **Current 配置**、面向 GJC `0.11.1` 的 **28 个内置预设**以及用户自定义预设。

- 自定义预设：`~/.gjc/agent/models.yml`
- 当前角色配置：`~/.gjc/agent/config.yml`

`/skill:` 按以下优先级合并技能：

1. 项目：`<workspace>/.gjc/skills/<name>/SKILL.md`
2. 用户：`~/.gjc/agent/skills/<name>/SKILL.md`
3. Gajae App 内置技能

技能必须包含有效的 `name` 和 `description` 才会显示。设置 `enabled: false` 或 `hide: true` 的技能会被隐藏。

## 从源码运行

需要 Node.js `22.22.2+` 或 `24.15.0+`、npm、Git，以及已配置账户和模型的 Gajae Code。桌面构建还需要 Rust `1.85.1`。

```bash
git clone https://github.com/devswha/Gajae-code-app.git
cd Gajae-code-app
npm ci
npm run dev
```

打开 <http://127.0.0.1:5173>。Tauri 桌面开发可运行 `npm run desktop:dev`。

## 架构

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

Rust 核心负责进程生命周期、文件监听、任务状态和 PTY 边界。桌面应用只连接 loopback 服务器，并使用 bootstrap nonce 与 `HttpOnly` Cookie 保护本地会话。更多信息请参阅[架构路线图](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md)和 [Tauri 验证记录](docs/DESKTOP-TAURI-VERIFICATION.md)。

## 开发命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动 React 客户端和开发服务器 |
| `npm run desktop:dev` | 启动 Tauri 桌面应用 |
| `npm test` | 运行服务器与客户端测试 |
| `npm run typecheck` | 检查 TypeScript |
| `npm run lint` | 运行 ESLint |
| `npm run build` | 构建客户端、服务器和 Rust 核心 |
| `npm run verify` | 运行完整质量门禁 |

## 项目状态与许可证

Gajae App v2 仍处于 Beta 阶段。升级前请备份 `~/.gajae-app/data` 和 GJC 配置。请在 [Issues](https://github.com/devswha/Gajae-code-app/issues/new) 中附上操作系统、应用版本和复现步骤。

本项目采用 [GNU AGPL v3.0 or later](LICENSE) 发布。它源自 Siteboon AI B.V. 的上游 UI 代码库，现已重构为 GJC 专用产品。署名信息见 [NOTICE](NOTICE)，上游引入政策见 [docs/UPSTREAM.md](docs/UPSTREAM.md)。
