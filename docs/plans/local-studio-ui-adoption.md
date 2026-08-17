# Local Studio UI/UX adoption plan

Status: Phase 1 shipped (feaa33e); phases 2-6 approved for this session
Saved: 2026-08-15

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

2. Session Status — NEXT
   - Model and reasoning level
   - Context usage and compaction action
   - Token/cost/call totals when reported by the runtime
   - Running and queued work
   - Project, directory, read-only Git summary, development server, and used skills

3. Files and Editor integration
   - Reuse the existing FilesPanel and EditorSidebar behavior
   - Keep file navigation and editing inside one Workspace surface
   - Avoid adding another permanent column for every opened surface

4. Development Preview
   - Detect reachable localhost development servers
   - Address bar, back/forward, reload, and connection state
   - Live view backed by managed Chromium/CDP rather than iframe-only embedding
   - Keep preview visible beside the active chat

5. Chat UX improvements
   - Fork a session from a specific message
   - Inline session title editing
   - Session menu: pin, fork, export, reasoning visibility
   - Clickable composer status strip for cwd, branch summary, reasoning, and context
   - Clear current-activity bar above the composer
   - Multiple queued follow-up messages with edit, delete, and reorder

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
