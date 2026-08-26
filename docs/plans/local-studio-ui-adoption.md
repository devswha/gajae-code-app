# Local Studio UI/UX adoption plan

Status: Phases 1-5 shipped (feaa33e, d64af56, 3377739, b37bec7, and in phase 5: 91f4821 queue, 26c818f steering, ac9b819 context, inline titles, the session ActionMenu, and 13cf015 Markdown export); fork remains deferred by choice, phase 6 is unevaluated
Saved: 2026-08-15
Re-verified against the tree: 2026-08-27

## Current priority order

1. P0 — DONE (27fb844): synchronized `main` with `origin/main`, resolved the
   command-disposition conflict, and retained all local commits.
2. P1 — Complete the core chat workflow in this order:
   - Explicit steer-versus-queue control while a turn is running — DONE
     (629e864)
   - Composer status strip — DROPPED after UI audit: model/reasoning, context,
     and activity controls already exist in or above the composer; cwd and Git
     remain available in Workspace Status
   - Current-activity bar above the composer — DONE in the existing UI
   - Fork a session from a specific message — DEFERRED pending demonstrated
     user need
3. P2 — Complete session management:
   - Inline title editing — DONE
     (`src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`;
     `src/components/sidebar/hooks/useSidebarController.ts:649`)
   - Pin, fork, export, and reasoning visibility in one session menu — pin
     shipped after this plan was written and is now verified: the session
     ActionMenu carries pin/unpin, rename and delete
     (`src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx:131-153`),
     wired through `useSidebarController.ts:678` to
     `provider.routes.ts:368`. Reasoning visibility is a global preference in
     Settings → Appearance
     (`src/components/settings/view/tabs/AppearanceSettingsTab.tsx:83-100` and
     `src/components/main-content/view/MainContent.tsx:40`), which is a better
     home than a per-session menu entry. Fork stays DEFERRED above.
     Export shipped as the app's own transcript export
     (`server/modules/providers/services/session-export.service.ts`,
     `GET /api/providers/sessions/:id/export`): the sidebar entry downloads the
     session as Markdown. Driving the runtime's `/export` was rejected because
     it only runs inside a live turn (`server/gjc-bun-sdk-adapter.ts:514`) and
     writes into the project directory, so a menu click would have booted a
     session to leave a file in the user's repository. `/export` stays for the
     in-session case. Phase 5 has no open items.
4. P3 — DONE (b37bec7): Development Preview with localhost discovery and
   managed Chromium/CDP, including focused tests and browser smoke coverage.
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
   - Mobile: drawer above the chat, below the sidebar.

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

4. Development Preview — DONE (b37bec7)
   - Detect reachable localhost development servers
     (`server/modules/automation/local-sites.ts`, called by
     `src/components/workspace/view/BrowserPanel.tsx:98`).
   - Address bar, back/forward, reload, and connection state
     (`src/components/workspace/view/BrowserPanel.tsx:367-375`).
   - Live view backed by managed Chromium/CDP rather than iframe-only embedding
     (`server/modules/automation/browser-sidecar.ts` and
     `src/components/workspace/view/BrowserPanel.tsx:133-200`).
   - Keep preview visible beside the active chat
     (`src/components/workspace/view/WorkspacePanel.tsx:172-176`).

5. Chat UX improvements
   - Combined chat model and reasoning selector — DONE (2fe57ad)
     - One trigger shows the effective chat model and reasoning level. The
       popover first selects a model, then advances to only the reasoning
       levels that GJC's live model registry reports for that model.
     - The separate Agent configuration control still owns the multi-role
       configuration, so model selection no longer competes with a second
       reasoning dropdown.
     - The primary send action now uses the simple upward arrow established by
       the reviewed Z.ai composer. Desktop and 390px mobile browser smoke pass.
   - Multi-role preset naming — DONE (d8f773b)
     - The separate surface is named Agent configuration throughout the UI and
       translations so its five-role scope is distinct from the chat model.
   - Steer a running turn — DONE (26c818f), beyond the original list
     - chat.steer follows chat.abort's path: same run lookup and scope check,
       one new worker method, and the live session the adapter already holds.
     - The SDK requires the caller to name the queue on a busy agent
       (`prompt(text, { streamingBehavior: 'steer' })`); a bare prompt throws
       AgentBusyError, and the contract fake now throws the same way.
     - Enter and the primary send action now queue by default while a turn is
       running. Plain text exposes a separate steering button; slash commands
       and attachments remain queue-only so they keep their normal pipeline.
       A refused or unanswered steering request falls back to the queue.
     - Browser smoke covered desktop and 390px mobile running states. Both
       actions remain visible on mobile; the model trigger contracts before
       the action buttons move.
   - Context and token controls — DONE (ac9b819)
     - The composer shows one explicit `Context N%` control and opens the
       existing token detail surface from it.
     - The separate cumulative-token pill was removed; detailed token buckets
       remain available in Workspace Status and the token detail surface.
   - Fork a session from a specific message — DEFERRED
     - It branches chat history only; it does not restore the working tree or
       create a Git branch/worktree.
     - Do not implement until real usage shows that conversational branching
       without a matching code snapshot is useful rather than misleading.
   - Inline session title editing — DONE
     (`src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx:270-321`;
     `src/components/sidebar/hooks/useSidebarController.ts:649-672`).
   - Session menu: pin, fork, export, reasoning visibility — pin, rename and
     delete are rendered by the session ActionMenu
     (`src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx:131-153`);
     reasoning visibility is provided by Settings → Appearance
     (`src/components/settings/view/tabs/AppearanceSettingsTab.tsx:83-100` and
     `src/components/main-content/view/MainContent.tsx:40`); fork is DEFERRED.
     Export is in the menu and downloads Markdown built from the stored
     transcript (`src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`
     to `server/modules/providers/services/session-export.service.ts`), which
     reads the provider directly so tool output over the 64KB transport budget
     is exported whole rather than as the preview the chat view receives.
   - Composer status strip — DROPPED as duplicative after auditing the current UI
   - Clear current-activity bar above the composer — DONE
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
