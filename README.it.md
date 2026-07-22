<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> · <strong>Italiano</strong> · <a href="README.ru.md">Русский</a> · <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Logo di Gajae Code App" width="96" height="96">
  <h1>Gajae Code App</h1>
  <p><strong>Un ambiente desktop di programmazione IA local-first per Gajae Code</strong></p>
  <p>Gestisci progetti, sessioni, preset degli agenti e skill in un unico spazio di lavoro.</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/gajae-code-app?include_prereleases&label=release" alt="Release GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.3"><strong>Scarica per macOS</strong></a> ·
  <a href="#funzionalità-principali">Funzionalità</a> · <a href="#esecuzione-dai-sorgenti">Sviluppo</a> ·
  <a href="https://github.com/devswha/gajae-code-app/issues">Issue</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="Gajae Code App con le sessioni sotto i progetti" width="920"></p>
<p align="center"><sub>Espandi un progetto per ritrovare le sessioni e avviare una nuova attività GJC nello stesso spazio.</sub></p>

## Che cos’è Gajae Code App?

Gajae Code App è uno spazio di lavoro open source per usare [Gajae Code](https://github.com/devswha/gajae-code) da desktop o browser. Avvia e riprende le sessioni GJC e organizza per progetto le risposte in streaming e l’attività degli strumenti.

L’app non include un modello IA né un abbonamento. Usa account, modelli e agenti già configurati in Gajae Code. I file e lo stato di esecuzione restano sulla macchina che esegue l’app.

> Questo repository è la **linea v2 beta dedicata esclusivamente a GJC**. La precedente interfaccia tmux e multi-provider è conservata in [gaminus](https://github.com/devswha/gaminus).

## Funzionalità principali

- **Sessioni per progetto** — Le sessioni compaiono direttamente sotto il progetto espanso.
- **Nuove attività rapide** — Avvia una sessione GJC con **New task** o con il `+` sulla riga del progetto.
- **Preset degli agenti** — Cambia insieme modelli e reasoning effort di Default, Planner, Executor, Architect e Critic.
- **Skill nella chat** — Cerca skill di progetto, utente e integrate con `/skill:<name>`.
- **Cronologia in tempo reale** — Segui streaming, stato di ragionamento, strumenti, approvazioni, interruzione e ripresa.
- **Archiviazione e ripristino** — Archivia progetti e sessioni senza eliminarli.
- **File locali** — Apri i file del progetto mantenendo il contesto dell’attività.
- **Un solo core per desktop e Web** — Tauri e browser condividono server locale e confine di esecuzione GJC.

## Interfaccia

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="Selettore dei preset"><br><sub><b>Preset degli agenti</b><br>Configura insieme l’agente predefinito e quattro ruoli specialistici</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="Menu delle skill"><br><sub><b>Comandi skill</b><br>Cerca le skill direttamente dalla chat</sub></td>
</tr></table>

## Installare l’app macOS

La beta pubblica supporta **Apple Silicon (M1 o successivo) con macOS 11 o successivo**.

1. Scarica il DMG e il relativo `.sha256` dalla [release v2.0.0-beta.3](https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.3).
2. Verifica il checksum:

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.3-macos-arm64.dmg.sha256
   ```

3. Apri il DMG e trascina **Gajae Code App** in **Applications**.
4. Al primo avvio, fai Control-clic sull’app nel Finder e scegli **Apri**. Se bloccata: **Impostazioni di Sistema → Privacy e sicurezza → Apri comunque**.

> Il DMG beta è firmato ad hoc e non è ancora autenticato da Apple. Usa solo file di GitHub Releases con checksum corrispondente.

| Destinazione | Stato | Requisiti |
|---|---|---|
| Desktop macOS arm64 | DMG beta disponibile | macOS 11+, Apple Silicon |
| Server Linux x86_64 | Artefatto beta disponibile | glibc 2.35+, Node.js 22 |
| Sviluppo nel browser | Esecuzione dai sorgenti | Node.js 22 o 24 |
| Intel Mac / Windows / desktop Linux | Non ancora supportati | Pacchettizzazione e verifica necessarie |

## Flusso di base

1. Usa il `+` accanto a **Projects** per aggiungere uno spazio locale.
2. Espandi il progetto per aprire una sessione o usa il `+` della riga per crearne una.
3. Scegli la configurazione degli agenti nel selettore dei preset.
4. Invia il prompt e segui risposte, strumenti e approvazioni in tempo reale.
5. Digita `/` per i comandi base o `/skill:` per cercare le skill.

## Preset e skill

Il selettore riunisce la configurazione **Current**, **28 preset integrati** per GJC `0.11.1` e i preset personalizzati.

- Preset personalizzati: `~/.gjc/agent/models.yml`
- Configurazione corrente dei ruoli: `~/.gjc/agent/config.yml`

`/skill:` unisce le skill in quest’ordine di priorità:

1. Progetto: `<workspace>/.gjc/skills/<name>/SKILL.md`
2. Utente: `~/.gjc/agent/skills/<name>/SKILL.md`
3. Skill integrate in Gajae Code App

Una skill visibile deve avere `name` e `description` validi. `enabled: false` o `hide: true` la nascondono.

## Esecuzione dai sorgenti

Servono Node.js `22.22.2+` o `24.15.0+`, npm, Git e Gajae Code configurato. La build desktop richiede anche Rust `1.85.1` tramite rustup.

```bash
git clone https://github.com/devswha/gajae-code-app.git
cd gajae-code-app
npm ci
npm run dev
```

Apri <http://127.0.0.1:5173>. Per lo sviluppo Tauri esegui `npm run desktop:dev`.

## Architettura

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

Il core Rust gestisce processi, monitoraggio file, stato dei job e confini PTY. L’app desktop si collega solo a un server loopback e protegge la sessione locale con nonce di bootstrap e cookie `HttpOnly`. Consulta la [roadmap dell’architettura](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md) e il [registro di verifica Tauri](docs/DESKTOP-TAURI-VERIFICATION.md).

## Comandi di sviluppo

| Comando | Scopo |
|---|---|
| `npm run dev` | Avvia React e il server di sviluppo |
| `npm run desktop:dev` | Avvia l’app desktop Tauri |
| `npm test` | Esegue i test server e client |
| `npm run typecheck` | Controlla TypeScript |
| `npm run lint` | Esegue ESLint |
| `npm run build` | Compila client, server e core Rust |
| `npm run verify` | Esegue tutti i controlli di qualità |

## Stato e licenza

Gajae Code App v2 è in beta. Esegui il backup di `~/.gajae-app/data` e della configurazione GJC prima di aggiornare. Segnala i problemi nelle [Issue](https://github.com/devswha/gajae-code-app/issues/new) indicando sistema, versione e passaggi di riproduzione.

Gajae Code App è distribuita con licenza [GNU AGPL v3.0 or later](LICENSE). È nata dall’interfaccia upstream di Siteboon AI B.V. ed è stata ricostruita come prodotto dedicato a GJC. Vedi [NOTICE](NOTICE) e la [politica upstream](docs/UPSTREAM.md).
