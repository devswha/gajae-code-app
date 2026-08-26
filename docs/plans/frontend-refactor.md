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

### 1. Server state through TanStack Query — SPIKE SHIPPED (a17f4dc)

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
- **streamedQuery: verdict is NO (2026-08-27, post-3b).** Not now, and
  probably not after it stabilizes either. Three grounds: (1) the export is
  still `experimental_streamedQuery` in 5.102.6, failing the adoption gate
  on its own; (2) its model is "write every chunk into the cache", which is
  the cost model this plan explicitly rejected - after 3a/3b the settled
  window already lives in the cache and reconciles via invalidation, so the
  problem streamedQuery solves no longer exists here; (3) adoption deletes
  nothing: the multiplexed WS (steer/resume/permission frames) would need a
  hand-written per-session AsyncIterable adapter, its restart-on-refetch
  semantics do not map to live turns, and the disk-transcript merge logic
  stays regardless. Net code increases. **Flip conditions (all three):** the
  `experimental_` prefix is dropped, the runtime natively exposes per-turn
  AsyncIterable streams, and a measured problem appears in the current tail
  handling. The A/B (one queryFn swap behind `['messages', sessionId]`)
  stays available as a diagnostic for that third condition only.
- Every hook rewritten in P1 moves its tests to the DOM lane in the same
  commit; the static `renderToStaticMarkup` lane must not outlive the hooks it
  was a workaround for.

**Spike results (a17f4dc, measured 2026-08-27):**

- `useProjectsState.ts` 1069 → 1058. The honest reading: the deleted fetch
  infrastructure (~50 lines of loading-state bookkeeping, mount effect,
  manual merge/bail-out) was almost offset by Query wiring. **The line count
  of the god hooks is dominated by selection/navigation/client state, not by
  server-state plumbing** — which strengthens P2's case and resets the
  expectation for what P1 deletes: risk and duplication, not volume.
- **The WebSocket handler did not fight the cache.** `session_upserted` is a
  discrete keyed upsert via `setQueryData`, and the `structuralSharing` merge
  receives the current cache as its previous value, so a refetch whose
  payload is shorter (paged sessions, optimistic rows) cannot clobber it.
  The decided architecture held without exceptions.
- Behavior now structural instead of hand-enforced: a degraded
  `/api/projects` response throws inside the queryFn and therefore keeps the
  previous cache; a silent refresh is just `refetch()` (never flips
  `isLoading`); identity bail-outs live in one `structuralSharing` function.
- DOM-lane tests: `src/hooks/useProjectsState.query.dom.bun.test.tsx` (5
  behaviors); the pure-helper node tests were untouched and still pass.
- P1 slice order (lowest risk first, each landing on a working product):
  1. **Running-sessions polling** - DONE (64399be). `useRunningSessionsSync`
     declares the poll as a `refetchInterval` query. Found and locked a real
     contract: the sync effect keys on `dataUpdatedAt` because structural
     sharing keeps equal payloads referentially stable while
     `useSessionProtection`'s grace window needs every poll delivered.
  2. **git-panel domain** - DONE (5c97c83). 817 -> 507 lines (-310). Four
     project-scoped queries + six mutations replaced eight fetchers, six
     loading flags, and all refresh chains. The big win was structural: the
     project-scoped cache key deleted `selectedProjectIdRef`, the
     AbortController plumbing and every stale-response guard - that race
     protection existed only because responses could outlive a project
     switch. Error payloads stay data because the views render them.
  3. **sessions/messages domain** - the main event, honoring the fold
     contract above, landing in sub-steps because chat is the product's core:
     - **3a - DONE (36305fd).** The settled window lives in
       `['messages', sessionId]`; the slot exposes it through getter-only
       accessors (an accidental assignment now throws instead of forking the
       data). One whole-window `setQueryData` per accepted response, behind
       today's exact ticket/offset guards. Realtime tails, merge pipeline,
       streaming, statuses and the slot LRU stay slot-local. Store API
       unchanged; hook tests moved to the DOM lane.
     - **3b - DONE (a8ffa47).** The store runs an active-window observer
       (subscription on the viewed session's window; queryFn = the bounded
       reconcile; `staleTime: Infinity` so only invalidation fetches). The
       sidebar's `session_upserted` watcher now invalidates
       `['messages', sessionId]`, deleting the `externalMessageUpdate`
       counter and its prop thread through four components. A streaming slot
       disables the observer (the old skip-during-streaming guard, now
       structural: the stale mark survives and reconciles on idle).
       `getMessages` recomputes the merged view lazily on read, so any
       out-of-band cache write is always reflected - this is the hook the
       terminal fold and the streamedQuery A/B both plug into.
     - **3c - open, deliberately deferred.** The ticket machinery stays: the
       imperative fetch paths (explicit limit/offset windows) do not route
       through the query's own fetcher, so Query's per-key serialization does
       not yet cover what the tickets guard. Deleting them requires moving
       fetch/fetchMore onto fetchQuery/infinite-query semantics first -
       re-evaluate after the store has soaked in daily use.
     - The terminal-time bounded reconcile (`refreshFromServer` over the
       loaded window) already implements the fold contract's intent: no
       per-token cache writes, one settled write per turn. Deferring the
       reconcile to reopen is NOT worth the id/token-usage staleness it
       would introduce; the contract's wording is refined accordingly.
     - The streamedQuery A/B window opens once 3b lands.

  Running deletion tally for P1: projects -11, polling -55 (into a reusable
  hook), git-panel -310. The pattern holds: the payoff scales with how much
  hand-written cache/race infrastructure the domain carried, not with its
  line count.

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
