# Contributing to Gajae App

Thanks for your interest in contributing to Gajae App! Before you start, please take a moment to read through this guide.

## Before You Start

- **Search first.** Check [existing issues](https://github.com/devswha/gajae-code-app/issues) and [pull requests](https://github.com/devswha/gajae-code-app/pulls) to avoid duplicating work.
- **Discuss first** for new features. Open an [issue](https://github.com/devswha/gajae-code-app/issues/new) to discuss your idea before investing time in implementation. We may already have plans or opinions on how it should work.
- **Bug fixes are always welcome.** If you spot a bug, feel free to open a PR directly.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- Git

## Getting Started

1. Fork the [repository](https://github.com/devswha/gajae-code-app).
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/gajae-app.git
   cd gajae-app
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Create a branch for your changes:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Project Structure

```
gajae-app/
├── src/              # React frontend (Vite + Tailwind)
│   ├── components/   # UI components
│   ├── contexts/     # React context providers
│   ├── hooks/        # Custom React hooks
│   ├── i18n/         # Internationalization and translations
│   ├── lib/          # Shared frontend libraries
│   ├── types/        # TypeScript type definitions
│   └── utils/        # Frontend utilities
├── server/           # Express backend
│   ├── routes/       # API route handlers
│   ├── middleware/   # Express middleware
│   ├── database/     # SQLite database layer
│   └── tools/        # CLI tool integrations
├── shared/           # Code shared between client and server
└── public/           # Static assets, icons, PWA manifest
```

## Development Workflow

- `npm run dev` — Start both the frontend and backend in development mode
- `npm run build` — Create a production build
- `npm run server` — Start only the backend server
- `npm run client` — Start only the Vite dev server

## Making Changes

### Bug Fixes

- Reference the issue number in your PR if one exists
- Describe how to reproduce the bug in your PR description
- Add a screenshot or recording for visual bugs

### New Features

- Keep the scope focused — one feature per PR
- Include screenshots or recordings for UI changes

### Documentation

- Documentation improvements are always welcome
- Keep language clear and concise
- Keep installation and self-hosting instructions aligned with [the self-hosting guide](docs/SELF-HOST.md)

## Commit Convention

We follow [Conventional Commits](https://conventionalcommits.org/) to generate release notes automatically. Every commit message should follow this format:

```
<type>(optional scope): <description>
```

Use imperative, present tense: "add feature" not "added feature" or "adds feature".

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `perf` | A performance improvement |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `style` | CSS, formatting, visual changes |
| `chore` | Maintenance, dependencies, config |
| `ci` | CI/CD pipeline changes |
| `test` | Adding or updating tests |
| `build` | Build system changes |

### Examples

```bash
feat: add conversation search
feat(i18n): add Japanese language support
fix: redirect unauthenticated users to login
fix(editor): syntax highlighting for .env files
perf: lazy load code editor component
refactor(chat): extract message list component
docs: update self-hosting guide
```

### Breaking Changes

Add `!` after the type or include `BREAKING CHANGE:` in the commit footer:

```bash
feat!: redesign settings page layout
```

## Pull Requests

- Give your PR a clear, descriptive title following the commit convention above
- Fill in the PR description with what changed and why
- Link any related issues
- Include screenshots for UI changes
- Make sure the build passes (`npm run build`)
- Keep PRs focused — avoid unrelated changes

## Releases

Maintainers publish approved repository revisions through the repository-owned self-hosting lifecycle. Use an immutable commit SHA for installations and updates; do not rely on a global package or a moving branch.

```bash
./scripts/gajae-app.sh status
./scripts/gajae-app.sh update --ref <approved-full-commit-sha>
```

See the [self-hosting guide](docs/SELF-HOST.md) for installation, updates, rollback, and service operations.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0-or-later License](LICENSE), including the additional terms specified in Section 7 of the LICENSE file.
