<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <strong>日本語</strong> ·
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> ·
  <a href="README.it.md">Italiano</a> · <a href="README.ru.md">Русский</a> · <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Gajae App ロゴ" width="96" height="96">
  <h1>Gajae App</h1>
  <p><strong>Gajae Code のためのローカルファースト AI コーディングデスクトップ</strong></p>
  <p>プロジェクト、セッション、エージェントプリセット、スキルを一つのワークスペースで管理します。</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/Gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/Gajae-code-app?include_prereleases&label=release" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/Gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/Gajae-code-app/releases/tag/v2.0.0-beta.2"><strong>macOS 版をダウンロード</strong></a> ·
  <a href="#主な機能">主な機能</a> · <a href="#ソースから実行">開発</a> ·
  <a href="https://github.com/devswha/Gajae-code-app/issues">Issues</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="プロジェクトの下にセッションが並ぶ Gajae App" width="920"></p>
<p align="center"><sub>プロジェクトを展開してセッションを開き、同じ画面から新しい GJC タスクを開始できます。</sub></p>

## Gajae App とは

Gajae App は [Gajae Code](https://github.com/devswha/gajae-code) をデスクトップとブラウザで利用するためのオープンソースワークスペースです。GJC セッションの開始と再開、ストリーミング応答、ツール実行をプロジェクト単位で整理します。

AI モデルやサブスクリプションは含まれません。Gajae Code に設定済みのアカウント、モデル、エージェント設定を利用し、プロジェクトファイルと実行状態はアプリを動かすホストに残ります。

> このリポジトリは **GJC 専用 v2 ベータ製品ライン**です。以前の tmux 監視 UI とマルチプロバイダー画面は [gaminus](https://github.com/devswha/gaminus) に保存されています。

## 主な機能

- **プロジェクト中心のセッション** — プロジェクトを展開すると、関連するセッションがすぐ下に表示されます。
- **素早い新規タスク** — **New task** またはプロジェクト行の `+` から GJC セッションを開始します。
- **エージェントプリセット** — Default、Planner、Executor、Architect、Critic のモデルと reasoning effort をまとめて切り替えます。
- **チャット内スキル** — `/skill:<name>` でプロジェクト、ユーザー、内蔵スキルを検索します。
- **リアルタイムタイムライン** — ストリーミング、思考状態、ツール呼び出し、承認、中止、再開を一つの会話で確認できます。
- **アーカイブと復元** — プロジェクトやセッションを削除せずに保管し、後から復元できます。
- **ローカルファイル閲覧** — タスクの文脈を保ったままプロジェクトファイルを開けます。
- **デスクトップと Web の共通コア** — Tauri とブラウザ UI が同じローカルサーバーと GJC 実行境界を共有します。

## 画面

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="エージェントプリセット"><br><sub><b>エージェントプリセット</b><br>Default と 4 つの専門ロールをまとめて選択</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="スキルコマンド"><br><sub><b>スキルコマンド</b><br>チャットからプロジェクト・ユーザー・内蔵スキルを検索</sub></td>
</tr></table>

## macOS アプリのインストール

公開ベータは **Apple Silicon（M1 以降）、macOS 11 以降**に対応しています。

1. [v2.0.0-beta.2 リリース](https://github.com/devswha/Gajae-code-app/releases/tag/v2.0.0-beta.2)から DMG と同名の `.sha256` をダウンロードします。
2. チェックサムを確認します。

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256
   ```

3. DMG を開き、**Gajae App** を **Applications** にドラッグします。
4. 初回は Finder で Control クリックして **開く**を選びます。ブロックされた場合は **システム設定 → プライバシーとセキュリティ → このまま開く**を使用してください。

> 現在の DMG は ad-hoc 署名で、Apple の公証前です。GitHub Releases のファイルを使用し、必ずチェックサムを確認してください。

| 対象 | 状態 | 要件 |
|---|---|---|
| macOS arm64 デスクトップ | ベータ DMG 提供 | macOS 11+、Apple Silicon |
| Linux x86_64 サーバー | ベータアーティファクト提供 | glibc 2.35+、Node.js 22 |
| ブラウザ開発環境 | ソース実行対応 | Node.js 22 または 24 |
| Intel Mac / Windows / Linux デスクトップ | 未対応 | パッケージングと検証が必要 |

## 基本的な使い方

1. **Projects** の横の `+` でローカルワークスペースを追加します。
2. プロジェクトを展開して既存セッションを開くか、行の `+` で新規作成します。
3. 入力欄のプリセット選択からエージェント構成を選びます。
4. プロンプトを送信し、応答、ツール実行、承認をリアルタイムで確認します。
5. `/` で基本コマンド、`/skill:` で利用可能なスキルを検索します。

## プリセットとスキル

選択画面には **Current 設定**、GJC `0.11.1` 向けの **28 個の内蔵プリセット**、ユーザープリセットが表示されます。

- カスタムプリセット: `~/.gjc/agent/models.yml`
- 現在のロール設定: `~/.gjc/agent/config.yml`

`/skill:` は次の優先順でスキルを統合します。

1. プロジェクト: `<workspace>/.gjc/skills/<name>/SKILL.md`
2. ユーザー: `~/.gjc/agent/skills/<name>/SKILL.md`
3. Gajae App 内蔵スキル

表示には有効な `name` と `description` が必要です。`enabled: false` または `hide: true` のスキルは非表示になります。

## ソースから実行

Node.js `22.22.2+` または `24.15.0+`、npm、Git、設定済みの Gajae Code が必要です。デスクトップビルドには Rust `1.85.1` も必要です。

```bash
git clone https://github.com/devswha/Gajae-code-app.git
cd Gajae-code-app
npm ci
npm run dev
```

<http://127.0.0.1:5173> を開きます。Tauri 開発は `npm run desktop:dev` で開始します。

## アーキテクチャ

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

Rust core がプロセス、ファイル監視、ジョブ状態、PTY 境界を管理します。デスクトップは loopback サーバーのみに接続し、bootstrap nonce と `HttpOnly` Cookie でローカルセッションを保護します。詳細は[アーキテクチャロードマップ](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md)と [Tauri 検証記録](docs/DESKTOP-TAURI-VERIFICATION.md)を参照してください。

## 開発コマンド

| コマンド | 用途 |
|---|---|
| `npm run dev` | React と開発サーバーを起動 |
| `npm run desktop:dev` | Tauri デスクトップを起動 |
| `npm test` | サーバーとクライアントのテスト |
| `npm run typecheck` | TypeScript 検査 |
| `npm run lint` | ESLint 検査 |
| `npm run build` | クライアント、サーバー、Rust core をビルド |
| `npm run verify` | 全品質ゲートを実行 |

## 状態とライセンス

Gajae App v2 はベータです。更新前に `~/.gajae-app/data` と GJC 設定をバックアップしてください。不具合は OS、アプリバージョン、再現手順とともに [Issues](https://github.com/devswha/Gajae-code-app/issues/new) へ報告してください。

[GNU AGPL v3.0 or later](LICENSE) で配布されます。Siteboon AI B.V. の上流 UI を起点に GJC 専用製品へ再構成しました。帰属は [NOTICE](NOTICE)、上流取り込み方針は [docs/UPSTREAM.md](docs/UPSTREAM.md) を参照してください。
