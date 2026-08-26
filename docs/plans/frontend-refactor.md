# Frontend refactor plan

Status: Phase 0 shipped (c4b0975 DOM test lane); phase 4 mostly shipped (e1b80da i18n and the dead re-export, 7974eaa api types); phases 1-3 not started
Saved: 2026-08-27

## Current priority order

1. **P0 — DONE (c4b0975): a test lane that can reach a hook.** Everything below
   rewrites hooks, and until this landed the client suite could only assert on
   HTML strings.
2. **P1 — Server state through TanStack Query.** The single root cause of the
   god hooks. Start with a one-domain spike, not a migration.
3. **P2 — UI state in a real store (Zustand).** Only after P1, so what remains
   in the store is actually UI state.
4. **P3 — React 19 + React Compiler.** Last, because P1 and P2 delete half the
   memoisation this is meant to remove.
5. **P4 — Housekeeping.** Two of four items shipped; the rest is file movement
   with no urgency.

## Objective

Cut the hand-written infrastructure the client carries - its own caching,
deduplication, refetching, optimistic updates and memoisation - by replacing it
with libraries that already do it. This removes abstraction rather than adding
it; complexity should go down at every step.

## Delivery order

### 0. Test runtime — DONE (c4b0975)

Prerequisite for everything else, so it went first.

- `*.dom.bun.test.tsx` files run on Bun with happy-dom and
  `@testing-library/react`. Bun was already a required dependency, so no new
  runner was added.
- The DOM is registered by `scripts/bun-dom-preload.ts`, not by an import inside
  the test: Bun evaluates `node_modules` before local modules, so
  `@testing-library/dom` captures `document.body` and installs throwing stubs
  before a local module can register a document.
- The preload keys off the file name in `process.argv`, so the server contract
  suites still run without a `window`. A global preload would make code that
  branches on `typeof window` take the browser path inside a server test.
- `scripts/run-tests.mjs` splits client files into bun/node the way it already
  split server ones, and its bun pattern accepts `.tsx`.
- First subject: `src/shared/view/ui/ActionMenu.dom.bun.test.tsx`. Five
  behaviours that were previously unreachable, including Escape restoring focus
  to the trigger and an outside click deliberately not doing so.

### 1. Server state through TanStack Query — NOT STARTED

The evidence, measured 2026-08-27:

| Hook | Lines |
|------|-------|
| `src/stores/useSessionStore.ts` | 1130 |
| `src/hooks/useProjectsState.ts` | 1069 (7 `useEffect`) |
| `src/components/chat/hooks/useChatSessionState.ts` | 986 |
| `src/components/git-panel/hooks/useGitPanelController.ts` | 817 |
| `src/components/chat/hooks/useChatRealtimeHandlers.ts` | 373 |
| **Total** | **4375** |

- `src/utils/api.ts` is 270 lines of raw `fetch`; caching, deduplication,
  refetching and optimistic updates are hand-written in the hooks above.
- `src/components/app/AppContent.tsx:125` polls running sessions on a
  `setInterval(5000)`.
- `useProjectsState.ts:508` implements `registerOptimisticSession` by hand.
- The realtime handler receives a `setSessionState` setter and writes state
  directly, which is what ties `useChatRealtimeHandlers`, `useSessionStore` and
  `useChatSessionState` together.

Target shape: `useQuery`/`useMutation` own server state, and **WebSocket is
demoted from a state source to a cache-invalidation channel**
(`queryClient.setQueryData`).

**Start with a spike, not a migration.** Convert `projects` only, then measure:
how many lines actually disappear, and where the WebSocket handler fights the
cache. The hard part is not volume, it is the interval during which the same
data lives in both the Query cache and the old `useState`. That question is
answered by one day of code, not by more planning.

**Decided before the spike (2026-08-27), so the spike cannot answer the wrong
question — the projects domain has no streaming, so it would never surface
these on its own:**

- **Query owns lists and settled message history. The live turn does not live
  in the cache.** Streaming deltas are never written per-token into the Query
  cache (no per-token `setQueryData`); the in-flight tail stays WebSocket-owned
  as today. On the turn's terminal event the tail is **folded** into the
  history cache with one `setQueryData` call; reconciliation against the disk
  transcript (invalidate → refetch) is deferred to the next session open. The
  64 KiB tool-output transport budget makes the fold safe: a refetch returns
  the same previews the tail already carries, and full outputs remain the
  export service's job.
- Discrete WS events (`session_upserted` deltas, list-changed notifications)
  are cache writes or invalidations — they are events, not streams, so
  `setQueryData`/`invalidateQueries` is the correct path for them.
- Query keys: `['projects']`, `['sessions', projectId]`,
  `['messages', sessionId]`. `refetchOnWindowFocus` is off globally — the
  server is local and WS already announces changes.
- **Retreat line:** if the spike disproves the hybrid, land Query for lists
  only and leave messages WS-owned (a smaller but real win); do not force it.
- **Exit:** re-evaluate TanStack's experimental `streamedQuery` as a
  replacement for the fold once it is stable; do not build P1 on it.
- Every hook rewritten in P1 moves its tests to the DOM lane in the same
  commit; the static `renderToStaticMarkup` lane must not outlive the hooks it
  was a workaround for.

### 2. UI state in a real store — NOT STARTED

- `useSessionStore.ts` is a store by name only: `useState` + `useRef` over a
  `Map`, so subscriptions cannot be split per field.
- The result is prop drilling: `AppContent.tsx:67,77` spreads a
  `sidebarSharedProps` bundle wholesale.
- Zustand with selectors cuts the re-render scope to one field:
  `useStore((s) => s.activeSessionId)`.
- **Do not delete the contexts wholesale.** There are six -- WebSocket, Auth,
  Theme, Permission, SessionStatus, PaletteOps. The first three are exactly what
  Context is for. `PaletteOpsContext` is the one to remove: it exists only
  because there is no global store to hold that state.

### 3. React 19 + React Compiler — NOT STARTED

- `useChatComposerState.ts` holds 31 `useCallback`s and `useSessionStore.ts` 30.
  That is a person doing a compiler's job.
- Every React-consuming dependency accepts 19; checked 2026-08-27 against
  `peerDependencies`: react-error-boundary `>=16.13.1`, cmdk `^18 || ^19`,
  lucide-react up to `^19`, react-markdown `>=18`, react-router-dom `>=18`,
  `@uiw/react-codemirror` `>=16.8.0`, react-i18next `>=16.8.0`, react-dropzone,
  react-syntax-highlighter. **Nothing blocks the upgrade.**
- `@types/react` moves to 19 with it, and the compiler arrives as a Babel plugin
  through `@vitejs/plugin-react`.

### 4. Housekeeping — 2 of 4 done

- **i18n lazy loading — DONE (e1b80da).** `config.js` static-imported all fifty
  translation files. English stays bundled as the fallback; the other nine are
  chunks behind a small i18next backend, one per language. Measured on a real
  build: main bundle 530KB to 271KB, gzip 153KB to 80KB. This also uncovered a
  bug: `languages.js` offered French and `config.js` never registered it, so
  choosing French silently served English. `src/i18n/localeCoverage.test.ts`
  now fails if a language is offered but cannot load.
- **`api.js` to TypeScript — DONE (7974eaa).** 37 files import it and it was the
  only untyped layer. Typecheck passed without touching a call site.
- **Dead re-export — DONE (e1b80da).** `src/contexts/AuthContext.jsx` was a
  one-line re-export nothing imported.
- **Shared buckets — NOT STARTED.** `src/lib/`, `src/utils/` and
  `src/shared/view/` are three homes with no rule about which to use.
- **`view/subcomponents/` — NOT STARTED.** One meaningless nesting level, in
  four component folders; `chat/view/subcomponents/` alone holds 26 files.

Both remaining items are pure file movement: hundreds of changed import paths,
a diff that hides real work in review, and a magnet for conflicts with anyone
else in the tree. They are worth doing on a quiet day, not during a push.

## Explicit exclusions

- **Do not add a second test runner.** Bun is already required; the DOM lane
  rides on it.
- **Do not replace Context wholesale.** WebSocket, Auth and Theme stay.
- **Do not hand-write another abstraction.** Every step here replaces
  hand-written infrastructure with a library; if a step adds a new bespoke
  layer, it is the wrong step.
- **Do not start P1 before P0.** Rewriting 4375 lines of hooks without hook
  tests is not a refactor.
- **Do not reorder P1 and P2.** Server state has to leave first, or the same
  caching gets hand-written a second time inside the store.

## Known loose ends

- ~~`dompurify` and `rehype-raw` are declared in `package.json` and imported
  nowhere.~~ Removed, together with the equally unimported `chokidar`.
- Three `.jsx` files remain: `src/main.jsx`, `src/contexts/ThemeContext.jsx`,
  `src/hooks/useLocalStorage.jsx`, plus `src/i18n/*.js`.

## Acceptance criteria

- Every step ships with tests that would fail if it were reverted.
- `npm test`, `npm run typecheck` and `npm run lint` pass at each commit.
- Bundle size is measured from a real build, not estimated.
- No step leaves the app in a state where *settled* server data lives in two
  places. The one deliberate exception is the in-flight turn: its live tail is
  WebSocket-owned until the terminal fold (decided above).
