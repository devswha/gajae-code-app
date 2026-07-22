<p align="center">
  <a href="README.md">한국어</a> · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <strong>Français</strong> ·
  <a href="README.de.md">Deutsch</a> · <a href="README.it.md">Italiano</a> · <a href="README.ru.md">Русский</a> · <a href="README.tr.md">Türkçe</a>
</p>

<div align="center">
  <img src="public/logo.png" alt="Logo de Gajae Code App" width="96" height="96">
  <h1>Gajae Code App</h1>
  <p><strong>Un environnement de programmation IA local-first pour Gajae Code</strong></p>
  <p>Gérez projets, sessions, préréglages d’agents et compétences dans un même espace.</p>
</div>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml"><img src="https://github.com/devswha/gajae-code-app/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/devswha/gajae-code-app/releases"><img src="https://img.shields.io/github/v/release/devswha/gajae-code-app?include_prereleases&label=release" alt="Version GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/devswha/gajae-code-app" alt="AGPL-3.0-or-later"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?logo=apple" alt="macOS Apple Silicon">
</p>

<p align="center">
  <a href="https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.3"><strong>Télécharger pour macOS</strong></a> ·
  <a href="#fonctionnalités-principales">Fonctionnalités</a> · <a href="#exécuter-depuis-les-sources">Développement</a> ·
  <a href="https://github.com/devswha/gajae-code-app/issues">Issues</a>
</p>

<p align="center"><img src="public/screenshots/gajae-app-overview.jpg" alt="Espace Gajae Code App avec les sessions sous chaque projet" width="920"></p>
<p align="center"><sub>Dépliez un projet pour retrouver ses sessions et lancer une nouvelle tâche GJC au même endroit.</sub></p>

## Qu’est-ce que Gajae Code App ?

Gajae Code App est un espace de travail open source pour utiliser [Gajae Code](https://github.com/devswha/gajae-code) sur ordinateur ou dans un navigateur. Il démarre et reprend les sessions GJC, puis organise les réponses en streaming et les outils par projet.

L’application ne fournit ni modèle IA ni abonnement. Elle utilise les comptes, modèles et agents déjà configurés dans Gajae Code. Les fichiers et l’état d’exécution restent sur la machine qui héberge l’application.

> Ce dépôt correspond à la **gamme v2 bêta exclusivement GJC**. L’ancienne interface tmux et l’interface multi-fournisseurs sont conservées dans [gaminus](https://github.com/devswha/gaminus).

## Fonctionnalités principales

- **Sessions organisées par projet** — Les sessions apparaissent directement sous le projet déplié.
- **Création rapide** — Lancez une session GJC via **New task** ou le `+` de la ligne du projet.
- **Préréglages d’agents** — Changez ensemble les modèles et le reasoning effort de Default, Planner, Executor, Architect et Critic.
- **Compétences dans le chat** — Recherchez les compétences du projet, de l’utilisateur et intégrées avec `/skill:<name>`.
- **Chronologie en temps réel** — Suivez streaming, réflexion, appels d’outils, approbations, arrêt et reprise dans une conversation.
- **Archivage et restauration** — Archivez projets et sessions sans les supprimer.
- **Fichiers locaux** — Consultez les fichiers du projet sans quitter le contexte de la tâche.
- **Même cœur pour bureau et Web** — Tauri et le navigateur partagent le serveur local et la frontière d’exécution GJC.

## Aperçu

<table><tr>
<td width="50%" align="center"><img src="public/screenshots/model-presets.jpg" alt="Sélecteur de préréglages"><br><sub><b>Préréglages d’agents</b><br>Configurez l’agent par défaut et quatre rôles spécialisés</sub></td>
<td width="50%" align="center"><img src="public/screenshots/skill-commands.jpg" alt="Menu des compétences"><br><sub><b>Commandes de compétences</b><br>Recherchez les compétences depuis le chat</sub></td>
</tr></table>

## Installer l’application macOS

La bêta publique prend en charge **Apple Silicon (M1 ou plus récent) sous macOS 11 ou ultérieur**.

1. Téléchargez le DMG et son fichier `.sha256` depuis la [version v2.0.0-beta.3](https://github.com/devswha/gajae-code-app/releases/tag/v2.0.0-beta.3).
2. Vérifiez la somme de contrôle :

   ```bash
   cd ~/Downloads
   shasum -a 256 -c gajae-app-desktop-2.0.0-beta.3-macos-arm64.dmg.sha256
   ```

3. Ouvrez le DMG et glissez **Gajae Code App** dans **Applications**.
4. Au premier lancement, faites Control-clic dans Finder puis choisissez **Ouvrir**. En cas de blocage : **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**.

> Le DMG bêta est signé ad hoc et n’est pas encore notarié par Apple. Utilisez uniquement un fichier GitHub Releases dont la somme correspond.

| Cible | État | Prérequis |
|---|---|---|
| Bureau macOS arm64 | DMG bêta disponible | macOS 11+, Apple Silicon |
| Serveur Linux x86_64 | Archive bêta disponible | glibc 2.35+, Node.js 22 |
| Développement navigateur | Exécution depuis les sources | Node.js 22 ou 24 |
| Intel Mac / Windows / bureau Linux | Pas encore pris en charge | Empaquetage et validation requis |

## Utilisation de base

1. Cliquez sur le `+` à côté de **Projects** pour ajouter un dossier local.
2. Dépliez le projet pour ouvrir une session ou utilisez le `+` de sa ligne pour en créer une.
3. Choisissez la configuration d’agents dans le sélecteur de préréglages.
4. Envoyez votre demande et suivez les réponses, outils et approbations en temps réel.
5. Saisissez `/` pour les commandes de base ou `/skill:` pour rechercher une compétence.

## Préréglages et compétences

Le sélecteur réunit la configuration **Current**, **28 préréglages intégrés** pour GJC `0.11.1` et vos préréglages personnalisés.

- Préréglages personnalisés : `~/.gjc/agent/models.yml`
- Configuration actuelle des rôles : `~/.gjc/agent/config.yml`

`/skill:` fusionne les compétences dans cet ordre de priorité :

1. Projet : `<workspace>/.gjc/skills/<name>/SKILL.md`
2. Utilisateur : `~/.gjc/agent/skills/<name>/SKILL.md`
3. Compétences intégrées à Gajae Code App

Une compétence visible doit définir `name` et `description`. `enabled: false` ou `hide: true` la masque.

## Exécuter depuis les sources

Prérequis : Node.js `22.22.2+` ou `24.15.0+`, npm, Git et Gajae Code configuré. La compilation bureau nécessite aussi Rust `1.85.1` via rustup.

```bash
git clone https://github.com/devswha/gajae-code-app.git
cd gajae-code-app
npm ci
npm run dev
```

Ouvrez <http://127.0.0.1:5173>. Pour Tauri, lancez `npm run desktop:dev`.

## Architecture

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

Le cœur Rust gère les processus, la surveillance des fichiers, l’état des tâches et la frontière PTY. L’application bureau se connecte uniquement au serveur loopback et protège la session locale avec un nonce de bootstrap et un cookie `HttpOnly`. Consultez la [feuille de route d’architecture](docs/GJC-DESKTOP-ARCHITECTURE-ROADMAP.md) et le [rapport de validation Tauri](docs/DESKTOP-TAURI-VERIFICATION.md).

## Commandes de développement

| Commande | Usage |
|---|---|
| `npm run dev` | Démarrer React et le serveur de développement |
| `npm run desktop:dev` | Démarrer l’application Tauri |
| `npm test` | Lancer les tests serveur et client |
| `npm run typecheck` | Vérifier TypeScript |
| `npm run lint` | Lancer ESLint |
| `npm run build` | Compiler client, serveur et cœur Rust |
| `npm run verify` | Exécuter tous les contrôles qualité |

## État et licence

Gajae Code App v2 est en bêta. Sauvegardez `~/.gajae-app/data` et la configuration GJC avant une mise à jour. Signalez les problèmes dans [Issues](https://github.com/devswha/gajae-code-app/issues/new) avec le système, la version et les étapes de reproduction.

Le projet est distribué sous [GNU AGPL v3.0 or later](LICENSE). Issu de l’interface amont de Siteboon AI B.V., il a été reconstruit pour GJC. Consultez [NOTICE](NOTICE) et la [politique amont](docs/UPSTREAM.md).
