# Providers Module Guide

This file documents the current provider contract in `server/modules/providers`.
Keep it current whenever provider wiring or session sync behavior changes. The
goal is that a human or AI agent can understand or extend the provider layer
without guessing which files need to move.

## Current Provider Shape

The app is GJC-only: `gjc` is the only registered provider
(`provider.registry.ts`). The legacy provider ids `claude`, `codex`, `cursor`,
and `opencode` were removed as execution lanes in the fork-legacy-removal waves
(v2 = GJC-only). They survive only as data:

- historical `sessions` rows in the database keep their original `provider`
  value and render read-only in the UI;
- `session-conversations-search.service.ts` still searches historical
  Claude/Codex transcripts on disk;
- the token-usage endpoint in `server/index.js` still reads historical
  provider artifacts.

Do not re-add legacy ids to the registry; new work targets `gjc` only.

Every provider wrapper exposes four facets:

- `models`
- `auth`
- `sessions`
- `sessionSynchronizer`

These correspond to the shared interfaces in `server/shared/interfaces.ts`:

- `IProviderModels`
- `IProviderAuth`
- `IProviderSessions`
- `IProviderSessionSynchronizer`

The services that consume them are:

- `providerModelsService`
- `providerAuthService`
- `sessionsService`
- `sessionSynchronizerService`

## Current File Layout

```text
server/modules/providers/list/gjc/
  gjc.provider.ts
  gjc-auth.provider.ts
  gjc-models.provider.ts
  gjc-sessions.provider.ts
  gjc-session-synchronizer.provider.ts
  GJC-PROVIDER-SPEC.md
```

## What Each Facet Does

| Facet | Responsibility | Base / Service |
| --- | --- | --- |
| `models` | Report the provider's supported model catalog | `IProviderModels` -> `providerModelsService` |
| `auth` | Report install/auth state for the provider runtime | `IProviderAuth` -> `providerAuthService` |
| `sessions` | Normalize live events and fetch session history | `IProviderSessions` -> `sessionsService` |
| `sessionSynchronizer` | Scan transcript artifacts and upsert session metadata | `IProviderSessionSynchronizer` -> `sessionSynchronizerService` |

`sessions` and `sessionSynchronizer` are separate concerns:

- `sessions` handles runtime event normalization and history fetches.
- `sessionSynchronizer` handles file-backed session indexing into `sessionsDb`.

## Facet Contracts

Auth:

- Return a full `ProviderAuthStatus`.
- Treat normal `not installed` / `not authenticated` states as data, not exceptions.
- Keep provider-specific credential discovery inside the auth provider.

Sessions:

- Implement `normalizeMessage(raw, sessionId)` and `fetchHistory(sessionId, options)`.
- Use `createNormalizedMessage(...)` and `generateMessageId(...)` for emitted messages.
- Keep normalized message ids unique. If one raw event produces multiple text
  parts, append a discriminator so ids do not collide.
- Keep pagination consistent:
  - `limit: null` means unbounded/full history.
  - `limit: 0` means an empty page.
  - always return `total`, `hasMore`, `offset`, and `limit` when paginating.
- Sanitize any filesystem-derived ids before using them in file or database paths.

Session synchronization:

- Implement `synchronize(since?: Date)` to scan provider artifacts and upsert
  sessions into `sessionsDb`.
- Implement `synchronizeFile(filePath)` for single-file watcher updates.
- Use the existing helpers when they fit:
  - `buildLookupMap(...)`
  - `extractFirstValidJsonlData(...)`
  - `findFilesRecursivelyCreatedAfter(...)`
  - `normalizeSessionName(...)`
  - `readFileTimestamps(...)`
- Make the sync resilient to partial, malformed, or missing provider files.
- The orchestration service runs the synchronizer and only advances
  `scan_state.last_scanned_at` when it succeeds.

Current session sync roots:

| Provider | Scan Roots | Metadata Helpers / Notes |
| --- | --- | --- |
| GJC | `~/.gjc` session transcripts (see `GJC-PROVIDER-SPEC.md`) | No dedicated title field or session index; the title is derived from the first user message, streamed line-by-line. `~/.gjc/agent/*.db` files are auth/cache/usage stores, not sessions — read-only. |

The Rust `gajae-core watch` supervisor is the primary GJC watcher lane; the
TypeScript synchronizer stays as defense-in-depth (see `server/GJC-LIVE-SPEC.md`).

## Validation

After changing the provider layer, run the relevant checks:

```bash
npx eslint server/modules/providers/**/*.ts server/shared/types.ts server/shared/interfaces.ts
npx tsc --noEmit -p server/tsconfig.json
```

Useful tests in this repo:

- `server/modules/providers/tests/gjc-sessions.test.ts`
- `server/modules/providers/tests/gjc-session-watcher.test.ts`
- `server/modules/providers/tests/provider-models.service.test.ts`

If you touch sessions or session synchronization, add or update focused tests
alongside the implementation.

## Common Mistakes

- Adding provider files but forgetting `provider.registry.ts` or
  `provider.routes.ts`.
- Returning duplicate normalized message ids for split content.
- Treating `limit === 0` as unbounded history.
- Building file paths from raw session ids without validation.
- Writing to GJC's live `agent.db`/`history.db` (they belong to the running CLI;
  reads only).
- Reintroducing legacy provider execution lanes — historical sessions are
  read-only data, not runnable providers.
