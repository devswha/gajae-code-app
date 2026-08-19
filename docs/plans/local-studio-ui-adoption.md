# Local Studio UI/UX adoption plan

Status: Phases 1-3 shipped (feaa33e, d64af56, 3377739); phase 5 partly shipped (91f4821 queue, 26c818f steering); phases 4-6 approved for this session
Saved: 2026-08-15

## Current priority order

1. P0 — DONE (27fb844): synchronized `main` with `origin/main`, resolved the
   command-disposition conflict, and retained all local commits.
2. P1 — Complete the core chat workflow in this order:
   - Clickable composer status strip for cwd, branch, reasoning, and context
   - Explicit steer-versus-queue control while a turn is running
   - Current-activity bar above the composer
   - Fork a session from a specific message
3. P2 — Complete session management:
   - Inline title editing
   - Pin, fork, export, and reasoning visibility in one session menu
4. P3 — Deliver Development Preview with localhost discovery and managed
   Chromium/CDP, including focused component tests and browser smoke coverage.
5. P4 — If public distribution is approved, complete Developer ID signing,
   notarization, entitlement review, and clean-machine installation QA.
6. P5 — Evaluate split-pane multi-session workspaces, then decide whether side
   chat remains necessary.

## Objective

Improve GJC App's coding workflow without redesigning its visual identity or restoring previously removed terminal and manual Git workflows.

## Delivery order

1. Unified right-side Workspace panel — DONE (feaa33e)
   - Shipped with the two surfaces that existed: Files and Editor. Status and
     Preview join the same tab strip as phases 2 and 4 deliver them, rather than
     shipping as empty tabs.
   - Collapsible and resizable; ARIA tablist with arrow-key navigation and a
     focusable separator that resizes with the keyboard.
   - Open state, selected tab and width persist together under one storage key,
     migrating the old files-panel flag.
   - Chat keeps the rest of the row, so switching tools never reflows it.
   - Mobile: drawer at the quick-settings layer, below the sidebar.

2. Session Status — DONE (d64af56)
   - First tab in the strip; model, reasoning level, context usage with the
     window and an accessible bar, running/queued activity, project, working
     directory and a read-only Git summary (branch, changed, staged, untracked).
   - Chat publishes a snapshot through SessionStatusProvider; the panel reads it.
     An unchanged snapshot never reaches setState, so typing does not re-render
     the panel.
   - Reports only what was reported: a field the runtime has not sent reads
     "Not reported yet", the token section is absent when no budget was sent,
     and the 'default' model selector is not shown as a model name.
   - Git is fetched only while the tab is visible, refreshed on demand, and a
     non-repository directory is reported as the normal state it is.
   - Deliberately not shipped here:
     - Compaction action. /compact runs through the composer's command gate;
       driving that pipeline from the panel belongs with the clickable composer
       status strip in phase 5, not behind a second, divergent entry point.
     - Cost and call totals. The runtime reports token buckets only
       (used/input/output/cache); there is no cost or call count to render, and
       a computed guess would be a fabrication.
     - Used skills and development server. Neither has a client-side source
       today; the development server arrives with phase 4's detection.
     - Restore-time model and context. Session state is reported by a live turn,
       so a freshly reopened session reads "Not reported yet" until it runs.

3. Files and Editor integration — DONE (feaa33e, 3377739)
   - Delivered with phase 1: FilesPanel moved into the Workspace tab strip, the
     editor sidebar became useEditorFile, and opening a file from chat, the
     command palette or the tree switches the one panel to its Editor tab.
   - Closed here: the Files tab shipped with Korean prose baked in. Failures now
     travel as a reason and are translated at render, with all ten locales
     covered and a test that fails if hardcoded prose returns.
   - No second permanent column was added; the panel still owns one width.

4. Development Preview
   - Detect reachable localhost development servers
   - Address bar, back/forward, reload, and connection state
   - Live view backed by managed Chromium/CDP rather than iframe-only embedding
   - Keep preview visible beside the active chat

5. Chat UX improvements
   - Steer a running turn — DONE (26c818f), beyond the original list
     - chat.steer follows chat.abort's path: same run lookup and scope check,
       one new worker method, and the live session the adapter already holds.
     - The SDK requires the caller to name the queue on a busy agent
       (`prompt(text, { streamingBehavior: 'steer' })`); a bare prompt throws
       AgentBusyError, and the contract fake now throws the same way.
     - Prose steers; a slash command and an attachment still take a turn of
       their own. Anything the runtime does not take is queued, and the answer
       carries why (no-run / not-running / unsupported / refused / failed).
     - Open: there is no explicit "queue this instead of steering" control, so
       prose typed during a run always steers. It belongs with the composer
       status strip below, not with a second hidden shortcut.
   - Fork a session from a specific message
   - Inline session title editing
   - Session menu: pin, fork, export, reasoning visibility
   - Clickable composer status strip for cwd, branch summary, reasoning, and context
   - Clear current-activity bar above the composer
   - Multiple queued follow-up messages with edit, delete, and reorder — DONE (91f4821)
     - Storage, composer and app-level auto-send all carry a list; the strip
       renders send order with per-message reorder, edit and delete.
     - Only the head dispatches, and only once the previous one became a run.
       A dispatch that never becomes a run releases the gate after a bounded
       window instead of stranding the queue.
     - A flush never runs while the composer holds text, so editing a queued
       message cannot be overwritten by the one behind it.

6. Later evaluation
   - Split-pane multi-session workspace
   - Side chat only if split panes do not make it redundant

## Explicit exclusions

- Do not restore the embedded terminal.
- Do not restore manual Git commit/push/branch controls.
- Do not add GPU, model-download, or inference-controller management.
- Do not copy Local Studio's visual identity.
- Do not rebuild capabilities GJC App already has: slash commands, file mentions, image attachments, voice input, model presets, tool grouping, permission panels, subagent rendering, Markdown, and single queued-message handling.

## Acceptance criteria

- Existing chat, session restoration, permissions, queueing, files, and editor behavior remain intact.
- Workspace panel keyboard and mobile behavior are covered.
- Preview does not depend on iframe compatibility and exposes no browser credentials to clients.
- Git information is read-only.
- Every phase ships with focused component tests and browser-level smoke coverage.
