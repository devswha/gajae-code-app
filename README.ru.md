<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <strong>Русский</strong> · <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Логотип Gajae App" width="96" height="96">
  <h1>Gajae App</h1>
  <p><strong>Локальная среда ИИ-разработки для Gajae Code</strong></p>
  <p>Проекты, сессии, наборы агентов и навыки в одном рабочем пространстве.</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/Gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/Gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/Gajae-code-app?include_prereleases&label=release" alt="Релиз GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/Gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/Gajae-code-app/releases/tag/v2.0.0-beta.2"><strong>Скачать для macOS</strong></a> ·
  <a href="#основные-возможности">Возможности</a> · <a href="#запуск-из-исходного-кода">Разработка</a> ·
  <a href="https://github.com/devswha/Gajae-code-app/issues">Issues</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="Gajae App с сессиями внутри проектов" width="920"></p>
<p align="center"><sub>Раскройте проект, откройте его сессии и запустите новую задачу GJC в том же пространстве.</sub></p>

## Что такое Gajae App?

Gajae App — открытая настольная и браузерная среда для [Gajae Code](https://github.com/devswha/gajae-code). Она запускает и возобновляет сессии GJC, группируя потоковые ответы и работу инструментов по проектам.

Приложение не предоставляет ИИ-модель или подписку. Оно использует учётные записи, модели и агентов, настроенных в Gajae Code. Файлы и состояние выполнения остаются на компьютере, где запущено приложение.

> Этот репозиторий — **бета-линейка v2 только для GJC**. Прежний tmux-интерфейс и экран нескольких провайдеров сохранены в [gaminus](https://github.com/devswha/gaminus).

## Основные возможности

- **Сессии внутри проектов** — связанные сессии отображаются прямо под раскрытым проектом.
- **Быстрый запуск задач** — новая сессия GJC создаётся через **New task** или `+` в строке проекта.
- **Наборы агентов** — модели и reasoning effort для Default, Planner, Executor, Architect и Critic переключаются вместе.
- **Навыки в чате** — поиск навыков проекта, пользователя и встроенных навыков через `/skill:<name>`.
- **Хронология в реальном времени** — потоковый ответ, состояние рассуждения, инструменты, подтверждения, остановка и продолжение в одном диалоге.
- **Архив и восстановление** — проекты и сессии можно архивировать без удаления.
- **Локальные файлы** — просмотр файлов проекта без потери контекста задачи.
- **Общее ядро для Desktop и Web** — Tauri и браузер используют один локальный сервер и границу выполнения GJC.

## Интерфейс

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="Выбор набора агентов"><br><sub><b>Наборы агентов</b><br>Основной агент и четыре специализированные роли</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="Меню навыков"><br><sub><b>Команды навыков</b><br>Поиск навыков прямо из чата</sub></td>
</tr></table>

## Установка приложения macOS

Публичная бета поддерживает **Apple Silicon (M1 и новее) с macOS 11 и новее**.

1. Скачайте DMG и одноимённый `.sha256` со страницы [v2.0.0-beta.2](https://github.com/devswha/Gajae-code-app/releases/tag/v2.0.0-beta.2).
2. Проверьте контрольную сумму:

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256
   ```

3. Откройте DMG и перетащите **Gajae App** в **Applications**.
4. При первом запуске нажмите приложение в Finder с Control и выберите **Открыть**. Если macOS блокирует запуск: **Системные настройки → Конфиденциальность и безопасность → Всё равно открыть**.

> Бета-DMG подписан ad hoc и пока не нотарифицирован Apple. Используйте только файл из GitHub Releases с совпадающей контрольной суммой.

| Цель | Статус | Требования |
|---|---|---|
| macOS arm64 Desktop | Доступен бета-DMG | macOS 11+, Apple Silicon |
| Linux x86_64 Server | Доступен бета-артефакт | glibc 2.35+, Node.js 22 |
| Разработка в браузере | Запуск из исходников | Node.js 22 или 24 |
| Intel Mac / Windows / Linux Desktop | Пока не поддерживаются | Нужны упаковка и проверка |

## Основной сценарий

1. Нажмите `+` рядом с **Projects**, чтобы добавить локальную папку.
2. Раскройте проект и откройте сессию либо создайте новую через `+` в строке.
3. Выберите конфигурацию агентов в поле ввода.
4. Отправьте запрос и следите за ответами, инструментами и подтверждениями.
5. Введите `/` для основных команд или `/skill:` для поиска навыков.

## Наборы и навыки

Список объединяет конфигурацию **Current**, **28 встроенных наборов** для GJC `0.11.1` и пользовательские наборы.

- Пользовательские наборы: `~/.gjc/agent/models.yml`
- Текущая конфигурация ролей: `~/.gjc/agent/config.yml`

`/skill:` объединяет навыки в следующем порядке:

1. Проект: `<workspace>/.gjc/skills/<name>/SKILL.md`
2. Пользователь: `~/.gjc/agent/skills/<name>/SKILL.md`
3. Встроенные навыки Gajae App

Для отображения нужны корректные `name` и `description`. `enabled: false` или `hide: true` скрывают навык.

## Запуск из исходного кода

Требуются Node.js `22.22.2+` или `24.15.0+`, npm, Git и настроенный Gajae Code. Для настольной сборки также нужен Rust `1.85.1` через rustup.

```bash
git clone https://github.com/devswha/Gajae-code-app.git
cd Gajae-code-app
npm ci
npm run dev
```

Откройте <http://127.0.0.1:5173>. Для разработки Tauri выполните `npm run desktop:dev`.

## Архитектура

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

Ядро Rust управляет процессами, наблюдением за файлами, состоянием задач и границами PTY. Настольное приложение подключается только к loopback-серверу и защищает локальную сессию bootstrap nonce и cookie `HttpOnly`. Подробнее: [план архитектуры](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md) и [проверка Tauri](docs/DESKTOP-TAURI-VERIFICATION.md).

## Команды разработки

| Команда | Назначение |
|---|---|
| `npm run dev` | Запуск React и сервера разработки |
| `npm run desktop:dev` | Запуск приложения Tauri |
| `npm test` | Тесты сервера и клиента |
| `npm run typecheck` | Проверка TypeScript |
| `npm run lint` | Запуск ESLint |
| `npm run build` | Сборка клиента, сервера и ядра Rust |
| `npm run verify` | Полная проверка качества |

## Статус и лицензия

Gajae App v2 находится в бета-версии. Перед обновлением сохраните `~/.gajae-app/data` и конфигурацию GJC. Сообщайте о проблемах в [Issues](https://github.com/devswha/Gajae-code-app/issues/new), указав ОС, версию и шаги воспроизведения.

Gajae App распространяется по лицензии [GNU AGPL v3.0 or later](LICENSE). Проект начался с upstream-интерфейса Siteboon AI B.V. и был перестроен для GJC. См. [NOTICE](NOTICE) и [политику upstream](docs/UPSTREAM.md).
