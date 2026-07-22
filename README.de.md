<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.fr.md">Français</a> ·
  <strong>Deutsch</strong> · <a href="README.it.md">Italiano</a> · <a href="README.ru.md">Русский</a> · <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Gajae-App-Logo" width="96" height="96">
  <h1>Gajae App</h1>
  <p><strong>Eine Local-first-KI-Programmierumgebung für Gajae Code</strong></p>
  <p>Projekte, Sitzungen, Agenten-Presets und Skills in einem Arbeitsbereich verwalten.</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/gajae-code-app?include_prereleases&label=release" alt="GitHub-Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.2"><strong>Für macOS herunterladen</strong></a> ·
  <a href="#hauptfunktionen">Funktionen</a> · <a href="#aus-dem-quellcode-starten">Entwicklung</a> ·
  <a href="https://github.com/devswha/gajae-code-app/issues">Issues</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="Gajae App mit Sitzungen unter den Projekten" width="920"></p>
<p align="center"><sub>Ein Projekt aufklappen, seine Sitzungen öffnen und am selben Ort eine neue GJC-Aufgabe starten.</sub></p>

## Was ist Gajae App?

Gajae App ist ein quelloffener Desktop- und Browser-Arbeitsbereich für [Gajae Code](https://github.com/devswha/gajae-code). Die App startet und setzt GJC-Sitzungen fort und ordnet Streaming-Antworten sowie Werkzeugausführungen nach Projekt.

Die App enthält weder KI-Modell noch Abonnement. Sie verwendet die in Gajae Code eingerichteten Konten, Modelle und Agenten. Projektdateien und Ausführungsstatus bleiben auf dem Host der App.

> Dieses Repository ist die **ausschließlich für GJC bestimmte v2-Beta-Produktlinie**. Die frühere tmux- und Multi-Provider-Oberfläche bleibt in [gaminus](https://github.com/devswha/gaminus) erhalten.

## Hauptfunktionen

- **Projektbezogene Sitzungen** — Sitzungen erscheinen direkt unter dem aufgeklappten Projekt.
- **Schnelle neue Aufgaben** — Eine GJC-Sitzung über **New task** oder das `+` in der Projektzeile starten.
- **Agenten-Presets** — Modelle und reasoning effort für Default, Planner, Executor, Architect und Critic gemeinsam wechseln.
- **Skills im Chat** — Projekt-, Benutzer- und integrierte Skills mit `/skill:<name>` durchsuchen.
- **Live-Zeitleiste** — Streaming, Denkstatus, Werkzeugaufrufe, Freigaben, Abbruch und Fortsetzung in einem Gespräch verfolgen.
- **Archivieren und Wiederherstellen** — Projekte und Sitzungen ohne Löschen aufbewahren.
- **Lokale Dateien** — Projektdateien im aktuellen Aufgabenkontext öffnen.
- **Ein Kern für Desktop und Web** — Tauri und Browser teilen lokalen Server und GJC-Ausführungsgrenze.

## Oberfläche

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="Agenten-Preset-Auswahl"><br><sub><b>Agenten-Presets</b><br>Standardagent und vier Fachrollen gemeinsam konfigurieren</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="Skill-Befehlsmenü"><br><sub><b>Skill-Befehle</b><br>Skills direkt im Chat durchsuchen</sub></td>
</tr></table>

## macOS-App installieren

Die öffentliche Beta unterstützt **Apple Silicon (M1 oder neuer) ab macOS 11**.

1. DMG und gleichnamige `.sha256`-Datei vom [Release v2.0.0-beta.2](https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.2) laden.
2. Prüfsumme verifizieren:

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.2-macos-arm64.dmg.sha256
   ```

3. DMG öffnen und **Gajae App** nach **Applications** ziehen.
4. Beim ersten Start die App im Finder mit gedrückter Control-Taste anklicken und **Öffnen** wählen. Bei einer Sperre: **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen**.

> Das Beta-DMG ist ad hoc signiert und noch nicht von Apple notarisiert. Nur Dateien aus GitHub Releases mit passender Prüfsumme verwenden.

| Ziel | Status | Anforderungen |
|---|---|---|
| macOS arm64 Desktop | Beta-DMG verfügbar | macOS 11+, Apple Silicon |
| Linux x86_64 Server | Beta-Artefakt verfügbar | glibc 2.35+, Node.js 22 |
| Browser-Entwicklung | Aus Quellcode | Node.js 22 oder 24 |
| Intel Mac / Windows / Linux Desktop | Noch nicht unterstützt | Paketierung und Prüfung erforderlich |

## Grundlegender Ablauf

1. Mit dem `+` neben **Projects** einen lokalen Arbeitsbereich hinzufügen.
2. Das Projekt für eine vorhandene Sitzung aufklappen oder über das Zeilen-`+` eine neue erstellen.
3. Im Eingabefeld ein Agenten-Preset wählen.
4. Prompt senden und Antworten, Werkzeuge sowie Freigaben live verfolgen.
5. `/` für Grundbefehle oder `/skill:` für verfügbare Skills eingeben.

## Presets und Skills

Die Auswahl zeigt die **Current-Konfiguration**, **28 integrierte Presets** für GJC `0.11.1` und eigene Presets.

- Eigene Presets: `~/.gjc/agent/models.yml`
- Aktuelle Rollenkonfiguration: `~/.gjc/agent/config.yml`

`/skill:` führt Skills in dieser Priorität zusammen:

1. Projekt: `<workspace>/.gjc/skills/<name>/SKILL.md`
2. Benutzer: `~/.gjc/agent/skills/<name>/SKILL.md`
3. In Gajae App integrierte Skills

Ein sichtbarer Skill benötigt gültige Felder `name` und `description`. `enabled: false` oder `hide: true` blendet ihn aus.

## Aus dem Quellcode starten

Erforderlich sind Node.js `22.22.2+` oder `24.15.0+`, npm, Git und ein eingerichtetes Gajae Code. Desktop-Builds benötigen zusätzlich Rust `1.85.1` über rustup.

```bash
git clone https://github.com/devswha/gajae-code-app.git
cd gajae-code-app
npm ci
npm run dev
```

Danach <http://127.0.0.1:5173> öffnen. Tauri-Entwicklung startet mit `npm run desktop:dev`.

## Architektur

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

Der Rust-Kern verwaltet Prozesse, Dateiüberwachung, Auftragszustand und PTY-Grenzen. Die Desktop-App verbindet sich nur mit einem Loopback-Server und schützt die lokale Sitzung durch Bootstrap-Nonce und `HttpOnly`-Cookie. Mehr dazu in der [Architektur-Roadmap](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md) und im [Tauri-Prüfprotokoll](docs/DESKTOP-TAURI-VERIFICATION.md).

## Entwicklungsbefehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | React und Entwicklungsserver starten |
| `npm run desktop:dev` | Tauri-Desktop-App starten |
| `npm test` | Server- und Clienttests ausführen |
| `npm run typecheck` | TypeScript prüfen |
| `npm run lint` | ESLint ausführen |
| `npm run build` | Client, Server und Rust-Kern bauen |
| `npm run verify` | Vollständige Qualitätsprüfung ausführen |

## Status und Lizenz

Gajae App v2 ist Beta. Vor Aktualisierungen `~/.gajae-app/data` und die GJC-Konfiguration sichern. Fehler bitte mit Betriebssystem, App-Version und Reproduktionsschritten unter [Issues](https://github.com/devswha/gajae-code-app/issues/new) melden.

Gajae App wird unter [GNU AGPL v3.0 or later](LICENSE) veröffentlicht. Es basiert ursprünglich auf der Upstream-Oberfläche von Siteboon AI B.V. und wurde zu einem GJC-spezifischen Produkt umgebaut. Siehe [NOTICE](NOTICE) und [Upstream-Richtlinie](docs/UPSTREAM.md).
