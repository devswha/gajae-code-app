# GJC SDK lifecycle remediation — app-owned patch

Status: ported to exactly **0.17.6** on September 25, 2026 and applied through a
clean `rm -rf node_modules && npm ci`. All 32 files passed pristine 0.17.6
before-hash validation and installation; check-only subsequently verified all 32.
The previous verified pin was 0.16.4 (September 8, 2026); see
[0.17.6 port](#0176-port) for every re-anchored edit and every 0.17.6 addition.
The app, worker and native validators share `shared/sdkLifecyclePolicy.json`
(maximum 32 files). This is not
an updater/plugin fork, an upstream publication, or permission to clear
`sdk_background_ownership_unproven`. Root and packaging postinstall apply this
same manifest; runtime manifest v2 checks all post-hashes before SDK startup.
The source-integrity receipt does not authorize installation or certify idle.

## Artifact contract and provenance

`manifest.json` uses the agreed schema exactly: schema version 1, id
`gjc-sdk-lifecycle-v1`, exact package versions, and 32 source-file entries with
full before/after SHA-256 digests and ordered replace-once edits. Each `before`
snippet occurs exactly once in the preceding source. The complete transformed
file must match `afterSha256`; snippet matches alone are not sufficient.

Pristine 0.17.6 packages were fetched on September 25, 2026 into a new temporary
directory with `npm pack --ignore-scripts`; their SHA-1 digests match the registry
`dist` values below. Every `beforeSha256` is the pristine 0.17.6 file, and every
`afterSha256` is the complete transformed file. The port replayed the 0.16.4
manifest's ordered edits against these files; edits whose `before` snippet no
longer occurred exactly once were re-anchored with the same semantics, and new
0.17.6 detached work inside already-patched files was given its own replace-once
edits (209 edits in total, previously 191). No installed dependency file was edited
by hand: the manifest is applied only by `npm run apply:sdk-patch`/postinstall.

| Published package | npm tarball SHA-1 | npm integrity |
| --- | --- | --- |
| `@gajae-code/coding-agent@0.17.6` | `d5b540e05e435dbd209be1fe3db5861bb9f1c9cb` | `sha512-ENjs77fG9R5iv8EZFQfLSQKtoPTyi4qCwkJj0c2B8NxFWH9u2VN4V4OAAO0cibBLE5q/Zm4wEWsbHe5oh0xiNA==` |
| `@gajae-code/agent-core@0.17.6` | `bd915aea9624073a2041e5feacae900d5a45be4c` | `sha512-BX97ZGbBk90JhXZ4AUrFR1GLMth92gW+9YDEhW9nu4jbAgD6wtMVHoWUoXMgQHc/ulMxEczCmilMXcGozpmHqQ==` |
| `@gajae-code/ai@0.17.6` | `62916c5f0d83638cae49ec1a99b0b2157179d049` | `sha512-g0ArBNjk3fgyhTYW8M3+HzhHuB6N53EL7/a3DiLVx/ctqflTbeP5JDRadA+Wpbbk+Gsv73w9P8ygYrd3FvrUjA==` |

## What changes

1. **`coding-agent/src/sdk/session.ts`: startup ownership.** Model-host preconnect
   and Codex credential/WebSocket prewarm each reserve a promise before their
   operation begins. Session transition cleanup joins these promises before
   credential/provider resources are released. The failed-creation path also
   joins startup work and retained async-job disposal. Transport preferences,
   selected models and enabled tools are unchanged; WebSockets are not disabled.
2. **`coding-agent/src/session/agent-session.ts`: actual retained completion.**
   Calling `awaitDisposeCompletion()` first now starts disposal but returns its
   retained promise, not the bounded caller promise. Separate physical owners
   retain post-prompt work when forced recovery clears the logical queue, and
   retain each prompt through its actual finalizer. Normal disposal joins these
   owners and the core physical ledger before closing session resources. The
   SDK factory also enables a final `flushOrThrow()` for caller-borrowed Settings
   after physical/tool cleanup; it does not close that object. Persistence errors
   reject retained completion.
3. **`agent-core/src/run-resource-ledger.ts`: physical accounting survives
   quarantine.** The existing promise-registration paths also retain physical
   promises independently of visible resources and bounded tombstones. This
   includes promises submitted through already-closed/quarantined leases.
   Logical `waitForSettlement()` results are unchanged: quarantine remains
   `unfenced`, even after a physical join. Terminal physical joining denies
   fresh `open()` calls but never deletes pending promises to become idle.
4. **`agent-core/src/agent-loop.ts`: retain the producer, not only its consumer.**
   Both loop entrypoints reserve their producer-body completion before invoking
   the body. It resolves in the producer's `finally`, not when a consumer sees
   `agent_end`, breaks iteration, or `forceAbort()` clears the busy flag. This
   also covers pre-provider metadata/auth/hook awaits inside that body. This is
   physical-only retention, not a logical ledger entry: it does not add a
   `waitForSettlement()` self-dependency or change standalone sealing.
5. **`coding-agent/src/config/model-preset-registry.ts`: recurring maintenance.**
   This is a recurring six-hour refresh (default startup delay: 30 seconds), not
   a one-shot task. Its callable cancellation handle also exposes read-only
   activity, a reversible admission fence, and a pending-work join. A fence
   pauses future timer dispatch/publication and retains the due time/deferred
   notification. Accepted flights and publication promises keep running through
   callback completion. Reopening resumes scheduling; automatic refresh is not
   disabled.
6. **`coding-agent/src/config/model-registry.ts`: maintenance ownership.**
   Constructor publication returns its catalog-mutation promise instead of
   discarding it. Activity covers helper roots, catalog queue/tail, explicit
   background refresh, async catalog callbacks and their settings persistence.
   Disposal joins these owners, not only the helper. A persistence failure stays
   unknown. Borrowed AuthStorage is accounted separately by its leaf seam.
7. **`ai/src/auth-storage.ts`: actual auth leaf ownership.** Raw OAuth provider/
   broker refresh promises, scoped/shared usage overrides, per-credential usage
   work and cache publication, config-value resolution, and credential-disabled
   callbacks reserve ownership before invocation. Caller timeout/cancellation
   races never release their underlying loser. Existing public timeout and
   synchronous `close()` behavior remain unchanged. A close does not erase
   pending ownership. Data generations and activity revisions remain separate.
8. **`coding-agent/src/config/settings.ts`: reserved background saves.** Every
   real save promise is retained independently of the latest `#savePromise`.
   The getter exposes the reserved debounce and in-flight writes; the join waits
   for the existing timer/save naturally and never invokes flush/close. A failed
  save leaves sticky `settings_persistence_unconfirmed`, even once its promise
  has settled. Normal `flush()`/`flushOrThrow()` semantics are unchanged.

9. **AI stream producer contract (19 additional files).**
   `src/utils/event-stream.ts` holds per-stream physical owners in a module-private
   WeakMap. `runAppStreamProducer` reserves the owner before invoking the actual
   async producer and resolves only after that body, including its real `finally`,
   and adopted child producers settle. `push`, `end`, `fail`, `result` and iterator
   completion do not release it. A lookalike property or a bare
   `AssistantMessageEventStream` is not a registered producer.
   `src/providers/register-builtins.ts` owns module loading and forwarding, and
   adopts the inner producer before consuming it. `src/stream.ts` does likewise
   for lazy imports, custom-provider forwarding and **every** auth-retry attempt.
   `complete`/`completeSimple` also join known producers, so non-streaming callers
   such as title generation retain their tail. `result()` itself stays unchanged.
   `src/utils/idle-iterator.ts` retains raced `next()` and `return()` promises in
   the initiating producer's async-local owner; its timeout/abort still returns
   promptly, without discharging the losing physical operation.

   The 15 actual transport bodies are `amazon-bedrock`, `anthropic`,
   `azure-openai-responses`, `cursor`, `google-gemini-cli`, `google-shared`,
   `kiro-api-key`, `kiro-codewhisperer`, `ollama`, `openai-completions`,
   `openai-responses`, `openai-codex-responses`, `openai-anthropic-shim`,
   `gitlab-duo`, and `pi-native-client` (all `ai/src/providers/*.ts`). Google
   and Vertex share the patched Google body; Kimi/Synthetic delegate through the
   patched shim. Shim/GitLab forwarding adopts their inner transport as well.
   Cursor's body is retained, but its separately dispatched HTTP/2 task/debug
   work is not fully audited and explicitly remains unknown.

10. **Core/session composition and factory retention.** The core retains each
    authenticated producer promise in the physical ledger, separately from
    logical provider settlement. Missing producers and child coverage failures
    leave sticky `sdk_provider_producer_unrepresented`; quarantine cannot erase
    either retained promises or that reason. The ledger exposes a pure activity
    getter. The session composes it with physical prompt/post-prompt owners and
    the SDK factory's pending work, with disposal/failure generations.
    Parallel workspace/context/prompt-template discovery is now reserved before
    invocation, including workspace deadline losers and early factory failure.
    Direct credential-disabled callbacks and reactive MCP publication reserve
    returned promises, and cleanup joins accepted work before closing shared
    resources. The adapter reads these actual owners from creation through
    retained disposal; it does not turn a source-integrity receipt into coverage.

11. **Enabled default SDK host (five additional files).**
    `coding-agent/src/sdk/host/host.ts` provides a session-local physical owner
    and reserves accepted dispatch, activation and send promises before invoking
    them. Reverse RPC deliveries use the same owned send path. Admission closes
    on ordinary host stop; already-accepted handlers and writes remain owned.
    `src/sdk/host/session-runtime.ts` retains directed deliveries, preflight and
    submission continuations, terminalization/skill recovery, gate resolution,
    lifecycle persistence and the actual startup/shutdown handlers. Retired-owner
    cleanup timers have physical reservations through dispatch; cancelling a
    future timer does not discharge an already-running callback. Existing bounded
    drains still return on their original budgets. SDK session resource cleanup
    then joins the separate physical owners before releasing shared resources.
    `src/sdk/prompt-deadline-manager.ts` similarly retains deadline/retry timers,
    in-flight expiry writes and uncertainty recovery after logical lease clears.
    `src/sdk/host/websocket-transport.ts` preserves the 250ms public stop race but
    retains the actual server-stop loser; its physical join propagates late
    failure. `src/sdk/host/query/revision-store.ts` joins detached snapshot-unlink
    promises before final directory cleanup.

    A real SDK session is tested with its default WebSocket host actively started
    (endpoint creation verified), an offline provider turn, normal disposal and
    endpoint removal. Its receipt is complete with zero activity. The adapter
    contract also proves that the enabled default path becomes eligible after
    cleanup. The fixture pre-starts an isolated **in-process** broker, so no
    detached process is spawned or signalled. These are ownership tests, not a
    transport-disable workaround or a certificate for opaque user extensions.

These APIs are additions to the Bun source runtime, not changes to npm declaration
files. The async-local iterator retention is qualified for the pinned Bun runtime;
it does not constitute browser or other JavaScript-runtime qualification.

## 0.17.6 port

Replay of the 0.16.4 manifest against pristine 0.17.6: 21 of 32 files applied
unchanged (only their hashes changed); 11 files had edits whose anchor moved.
**No edit was dropped.** Every failing edit was re-anchored to the 0.17.6 code
with the same semantics; none of the guarantees is implemented upstream yet.

| File | Edit | Decision | Reason / new anchor |
| --- | --- | --- | --- |
| `coding-agent/src/sdk/session.ts` | #3 | re-anchored | `session.registerToolSessionTransitionCleanup(joinStartupTasks)` stays directly after `hasSession = true`, now before 0.17.6's owned-MCP cleanup registration. |
| | #7 | re-anchored | failed-creation async-job disposal still joins `awaitRetainedDisposalCompletion()`; only the surrounding comment changed. |
| | #10 | re-anchored | context-file discovery now passes `{ cwd, agentDir, profileAuthority }`; still wrapped in `ownFactoryTask`. |
| | #11 | re-anchored (split) | hook-discovery comment reworded; the two `appFactoryUnknown` insertions are separate anchors. |
| | #12 | re-anchored | constrained plugin hooks gained `activationGeneration`/structured findings; same insertion point. |
| | #17 | re-anchored (split) | 0.17.6 replaced conventional MCP publication with serialized owned/inherited publishers. Upstream now joins those tails in tool-session cleanup, but does not count them as activity; every reactive `void sync…`/`refreshMCPTools` publication is still owned by `startOwnedStartupTask`, including the new inherited publisher. |
| | #19 | re-anchored | failed-creation branch comment reworded; `await joinAppHosts()` stays first. |
| `coding-agent/src/session/agent-session.ts` | #7, #8 | re-anchored | 0.17.6 added a logical session work lease per post-prompt task. Forced recovery releases those leases, so the separate physical owner set is still required. |
| | #12 | re-anchored | `#sessionShutdownReason` was inserted after `#disposeTerminalError`. |
| `coding-agent/src/config/model-registry.ts` | #8, #9 (+#1, #4 context) | re-anchored | `refreshInBackground()` gained `credentialSessionId`; a fenced deferral now stores and replays it with the strategy. |
| `ai/src/auth-storage.ts` | #4, #8, #9 | re-anchored | usage requests gained provider-generation checks and a cross-process usage lease inside the same in-flight promises; the `#ownAppTask` wrap is unchanged. |
| `ai/src/utils/idle-iterator.ts` | #1, #2 | re-anchored | the loop was re-indented and `iterator.return()` became idempotent; raced `next()`/`return()` promises are still retained. |
| `ai/src/stream.ts` | #3, #8 | re-anchored | `complete`/`completeSimple` now drain the stream before `result()`; the producer join wraps both. |
| `ai/src/providers/cursor.ts` | #0–#2 | re-anchored | new `node:tls` import, first-event watchdog setup and write-drain finally; same producer wrap and unknown marker. |
| `coding-agent/src/sdk/host/host.ts` | #0 | re-anchored | a `file-lock` import was inserted between anchored imports. |
| `coding-agent/src/sdk/host/session-runtime.ts` | #0 | re-anchored | multi-line `./host` import with capability constants. |
| | #1 | re-anchored (split) | runtime now keeps its own connection-capability fields. |
| | #2 | re-anchored | `sendFrameTo()` takes one connection; capability fan-out moved to callers. |
| | #11 | re-anchored | terminal-boundary helpers were inserted before `trackLifecycle`. |
| | #13 | re-anchored | deadline settings resolve through helpers; `onDeadlineExceeded` added. |
| | #19 | re-anchored | a workflow-gate turn provider follows the runtime owner literal. |
| | #20 | re-anchored (split) | `stop()` takes lock-contention/unregister-reason options; `session_shutdown` forwards `event.reason`. |
| `coding-agent/src/sdk/host/websocket-transport.ts` | #0 | re-anchored | a value import from `./host` was inserted. |
| `coding-agent/src/sdk/prompt-deadline-manager.ts` | #2 | re-anchored (split) | constructor gained flush options between the anchored blocks. |

New 0.17.6 detached work inside already-patched files, owned by additional edits:

- `sdk/host/host.ts`: `reportActivity()` durable heartbeats are fire-and-forget from
  `start()`, activation and session-runtime turn boundaries. The serialized write
  is owned at its source by the host's `AppSdkHostOwner`.
- `sdk/host/session-runtime.ts`: periodic broker re-registration. Stopping clears
  the interval, but an already-dispatched `runBrokerRecovery()` is now owned.
- `sdk/prompt-deadline-manager.ts`: the bounded `onDeadlineExceeded` worktree flush
  keeps its public 10s budget, but the abandoned hook promise is physically owned.
- `sdk/session.ts`: 0.17.6 re-enabled filesystem/plugin/settings extension-module
  discovery. Any discovered module reports `sdk_extension_effects_unrepresented`,
  like preloaded ones (a second layer; the app itself does not let them load, see
  below).

Audited and deliberately not patched:

- `ai/src/providers/devin-acp.ts` is a new 0.17.6 transport that spawns a cached
  `devin acp` child with detached stdio drains. It is not a registered producer, so
  its streams report `sdk_provider_producer_unrepresented` (core join or lazy
  adoption), i.e. fail closed. Covering it would exceed the 32-file policy and a
  persistent child cannot be certified by promise joins anyway.
- `agent-session.ts` gained in-memory follow-up reservation waits
  (`#queueFollowUpAfterReservation`) and a workflow-gate continuation `abort()`.
  They perform no I/O beyond session queues and are bounded by existing session
  logic; they are not separately owned.

App consequences of 0.17.6 recorded outside this manifest:

- **Extension-module discovery.** `createAgentSession` now discovers
  `<agentDir>/extensions`, project `.gjc/extensions`, plugin entry points and the
  `extensions` setting. The adapter passes an empty `preloadedExtensions` result
  (0.16.4's default, fresh `ExtensionRuntime` per session) so none of them load.
  `disableExtensionDiscovery` is avoided because on 0.17.6 it also disables
  hook-convention discovery, which top-level sessions kept on 0.16.4.
- **Delegation arguments.** 0.17.6 `ExtensionToolWrapper` runs
  `validateToolArguments` on direct execution too, and that validation strips
  unknown strict-object keys (0.16.4's model-facing agent-loop path already did).
  A `task` call carrying `model` is therefore ignored, not rejected, and the child
  is forced onto the parent's exact model. The app cannot intercept, because
  `customToolToDefinition` drops `rawArgumentValidation`/`lenientArgValidation`.

## Public registry seam

```ts
getAppLifecycleActivity(): {
  generation: string;
  complete: boolean;
  starting: number;
  queued: number;
  running: number;
  settling: number;
  unknown: string[];
}
setAppLifecycleAdmission(closed: boolean): void;
awaitAppLifecycleSettlement(): Promise<void>;
```

The getter is pure and detached; counts may overlap. It is incomplete while
maintenance admission is open, if a required settings flush capability is
missing, or after unconfirmed persistence. Deferred future maintenance is not an
accepted root and is not busy while fenced. The explicit join requires a held
fence and rejects if reopened during its wait. This is **registry maintenance**,
not an AuthStorage, settings-global, or whole-worker receipt.

Foreground `refresh`/`refreshStatic`/`refreshProvider` retain their behavior: they
may be required continuations of accepted OAuth/session work. Top-level app
admission must gate genuinely new callers; every accepted catalog mutation is
counted before its first await. `refreshInBackground` and helper timer/notification
roots defer while fenced. Parent must include registry generation/counts from
adapter construction, not only after first session creation. A missing seam is
unknown. The new runtime methods need a narrow public capability type at the app
boundary; the npm declaration files are deliberately not rewritten.

## AuthStorage and Settings leaf seams

Both classes expose the same seven-field `getAppLifecycleActivity()` shape above
and `awaitAppLifecycleSettlement(): Promise<void>`. **Neither gets an admission
fence.** New roots are already gated by the worker, registry and OAuth owners;
an accepted registry flight must be allowed to reach a later auth dependency or
settings write. Leaf starts/completions revise their own generation.

Source audit found no autonomous recurring dispatcher in AuthStorage: its timers
bound requests. Settings' autonomous save debounce belongs to a reservation
created synchronously by a writer. Its complete save promise remains owned from
reservation through persistence/failure cleanup. Thus these constructor/global
leaf owners need no perpetual blanket unknown once their real pending sets are
empty (unless Settings persistence failed). These are component receipts, not a
full SDK certificate. Missing APIs remain unknown; the adapter must aggregate
leaf generations/counts from construction and retain references to every owner
that can still have pending work.

The joins are physical-promise joins with no artificial timeout, no mutation of
admission, and no forced flush. They must be called by an outer owner, not awaited
from a callback that they themselves own. The read-only getters are bounded and
do not inspect credentials or the filesystem.

The new runtime helper `awaitPhysicalRunResources(ledger)` is a **terminal join**,
not a read-only observer. It is called only by normal SDK disposal. Its optional
exported marker `GJC_APP_LIFECYCLE_PATCH = 'gjc-sdk-lifecycle-v1'` is useful for
debugging, but is neither a quiescence certificate nor proof that all patch files
are present. A bundler may elide the marker if unused. Use the manifest inventory
to verify source bytes before compilation. The SDK accesses the additive helper
through a narrow public namespace type; existing app-facing declaration files and
the public `awaitDisposeCompletion(): Promise<void>` signature are unchanged.

## Preserved behavior

- `abort()` and `forceAbort()` keep their existing bounded/logical behavior.
  They may free the interactive busy state while physical work remains retained.
- `dispose()` keeps its existing caller deadline and
  `SessionDisposalIncompleteError`. The retained join has no invented timeout:
  a task that never settles must keep it pending.
- Existing disposal failures still reject. Physical completion is not success
  of the user's tool/provider operation; an ordinary failed operation can settle.
- Ownership is per ledger/session. One session's completed teardown does not
  discharge another session's pending work.
- No process-tree kill, updater admission change, SDK-command replacement, timer
  monkeypatch, or installed private-field inspection is used to manufacture idle.

## Physical evidence and reproduction

`lifecycle.bun.test.ts` imports an explicitly selected isolated candidate SDK and
core/AI. Only their 32 manifest-listed source files differ from pristine published packages.
Other dependencies are read-only links to the existing 0.17.6 dependency closure;
this is not a clean-install, cross-platform or packaged-binary qualification.
All session data goes into independent temporary fixtures. No live credentials,
provider requests or shell commands are needed.

The tests hold actual promise gates, verify the retained join remains unresolved,
then release the gates and await completion. They do not infer physical completion
from generation changes or empty diagnostic counters. Coverage includes:

- quarantined and late failed-lease resources;
- a provider factory still pending after `forceAbort()`/`waitForIdle()`;
- an abort-ignoring tool;
- abandoned post-prompt work with a bounded public disposal timeout;
- Codex prewarm before resource cleanup, with WebSockets still enabled;
- independent sessions and preserved cleanup failure;
- a real SDK prompt reaching normal disposal;
- standalone logical settlement while its loop body is retained physically;
- recurring refresh and publication deferral without aborting accepted work;
- independent borrowed-registry activity and catalog callback completion;
- borrowed Settings flush ordering, held public persistence promises, actual
  durable reload, error propagation and preservation of borrowed storage;
- auth scoped/shared usage timeout losers, provider deadlines, OAuth cancellation
  losers, config resolver reservation-before-invocation, and callback completion;
- real Settings debounce and file-lock-blocked persistence, overlapping saves,
  durable reload, and actual background-save failure;
- physical producer `finally` on success/failure after an early terminal event;
- an **actual pi-native transport** publishing terminal SSE before EOF, through
  both a core join and real session disposal with its caller deadline;
- lazy built-in dispatch, nested/custom forwarding and auth-retry loser tails;
- physical idle-iterator timeout/abort losers, and rejection of forged receipts;
- accepted host control/response/delivery callbacks after logical stop, independent
  host owners, actual WebSocket shutdown timeout losers and late failure;
- a real hosted lifecycle drain exceeding its public budget while persistence
  and retired-owner timers remain retained, plus physical deadline writes after
  logical clears and future-vs-running timer cancellation;
- enabled default-host SDK and adapter cleanup reaching complete, zero activity;
- the unregistered-provider-tail limitation below.

From the repository, run the read-only/replay tests with the supported Node:

```sh
node --test patches/gjc-sdk-lifecycle/manifest.test.mjs
```

During parent integration, set `GJC_SDK_LIFECYCLE_CANDIDATE` to the isolated
pristine or known-after install root for replay tests; this avoids treating the
checkout's previous eight-file state as the new manifest's known-after state.
The full parent-applier tests use the shared policy and require capacity for 32 files.

For physical tests, extract the exact published packages into a fresh temporary
install layout (`node_modules/@gajae-code/{coding-agent,agent-core,ai}`), supply their
unchanged transitive dependencies, and use the parent's exported
`applySdkLifecyclePatch(tempRoot, manifest)` function on **that temporary root**.
Do not run the applier CLI against the checkout as part of artifact review.
For normal development, `npm ci` applies it through postinstall; `npm run
apply:sdk-patch` applies the checked manifest explicitly, and `npm run
check:sdk-patch` is read-only. An unknown/local modification is refused, not
overwritten. `npm test` runs these same lifecycle tests against the installed
patched code through `scripts/sdk-lifecycle-contract.test.mjs`, using separate
temporary data directories and offline providers.

```sh
GJC_SDK_LIFECYCLE_CANDIDATE=/absolute/temporary/install-root \
  dist-native/bun test patches/gjc-sdk-lifecycle/lifecycle.bun.test.ts
```

`manifest.test.mjs` verifies exact replay/full hashes and invokes the parent's
applier only on temporary fixtures. It checks unapplied `--check` semantics,
known-after idempotence, version rejection, and all-file prevalidation. Installed
source is read only; known-after fixtures can be reconstructed in memory.

## Concrete remaining proof limits

This patch is **not yet an all-feature SDK quiescence certificate**.

- **Leaf receipts require upstream root admission.** Auth and Settings do not
  reject an accepted continuation. A future external caller can create new work;
  the app must gate those callers and compose each leaf generation. Per-instance
  leaf activity is not evidence for a different AuthStorage/Settings instance.
  Synchronous request APIs or external stores remain owned by their calling root;
  the leaf seam specifically retains asynchronous work which may escape a raced
  waiter. It does not certify unrepresented work hidden behind a third-party
  provider/store callback's returned promise.
- The built-in **producer-body tail gap is closed**, including forwarding and
  iterator timeout losers. An unregistered custom/extension provider, including
  the bundled Grok provider's independent implementation, remains unknown. A
  returned promise is a contract for represented work, not evidence for detached
  effects hidden by a custom fetch/callback implementation.
- **Default SDK hosting now has physical ownership, not a blanket exception.**
  Its bounded return is still not physical completion: the session joins its
  retained owners and the real WebSocket stop promise. Missing host registration
  remains `sdk_host_effects_unrepresented`; a custom transport without a physical
  join is `sdk_host_transport_unrepresented`. Joining a host from the callback it
  would itself wait for fails explicitly with `sdk_host_reentrant_settlement`
  instead of manufacturing idle or deadlocking. This does not claim coverage of
  separate generic notification hosting, which still reports
  `sdk_notification_effects_unrepresented` when enabled.
- Explicit/preloaded extensions and discovered hook/plugin factories may detach
  arbitrary effects; those sessions report `sdk_extension_effects_unrepresented`.
  `ExtensionRunner.initialize()` can also flush buffered credential-disabled
  events through unretained microtasks. Although direct returned callback
  promises are now retained, a session receiving these events reports
  `sdk_extension_credential_dispatch_unrepresented`. Runner-level queue/finally
  retention is still required for that buffered path. Borrowed arbitrary runtime
  services/event buses/MCP managers report `sdk_injected_services_unrepresented`.
- Cursor's producer is retained, but its HTTP/2 coordinator subtasks and async
  debug writer still require independent validation and joins; its receipt
  includes `sdk_cursor_subtasks_unrepresented`.
- A shell/tool can intentionally detach a descendant or create an external
  effect not represented by its returned promise. Physical promise settlement
  alone is not OS process-tree proof.
- Failed factories have no returned whole-session receipt. The enumerated
  parallel discoveries, prewarm and async-job cleanup now join on failure, but
  all fallible extension/host/discovery implementations have not been certified.
  The adapter therefore retains `sdk_background_ownership_unproven` for a failed
  factory rather than inferring coverage from rejection.

Accordingly, do **not** blanket-remove `sdk_background_ownership_unproven` based
on the marker or this patch. Parent integration must preserve unknown for these
unproven paths. Guarded application, postinstall/build wiring and runtime manifest
v2 are connected. Final frozen-source promotion, real packaged/platform checks,
native restart/previous-owner proof and public release still require their own
evidence; this artifact is not a waiver of any of them.
