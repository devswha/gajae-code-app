# Relicensing

The goal is a closed engine and a closed application. This is what stands in the
way and in what order to remove it.

## Where it stands

The **engine** — `native/`, `server/gjc-*`, `src-tauri/` — shares no file with
the historical upstream. It can be closed today; nothing legal blocks it. What
remains there is packaging, described in
[LICENSING.md](./LICENSING.md#the-engine-boundary) and the engine repository's
extraction plan.

The **application** cannot be closed while any upstream code remains in it. It is
AGPL because it derives from the historical upstream recorded in
[UPSTREAM.md](./UPSTREAM.md), and that is not a licence this project chose or can
change unilaterally.

Measured with `node scripts/measure-upstream-derivation.mjs`:

```
Upstream-derived code: 3,713 of 73,910 lines (5.0%)      baseline 2026-09-01

   813 lines   23 files  other components
   811 lines   39 files  server modules
   704 lines   27 files  chat UI
   442 lines   15 files  settings
   407 lines   19 files  UI primitives
   242 lines   17 files  other client
   122 lines    6 files  other server
    93 lines    5 files  other
    79 lines    3 files  sidebar
```

Re-run it to see the number move. Zero is the point at which this project can be
licensed as it chooses.

Two accounting notes on the 2026-09-01 baseline. First, it is not comparable to
the 33.5% figure previously recorded here: the measurement now diffs only
substantive lines (blank and punctuation-only lines no longer count as shared)
and uses a symmetric denominator, on the grounds that neither blank lines nor
file-length asymmetry are protected expression. Under the previous ruler the
same tree measures 32.7%. Second, the work is essentially done: every area was
rewritten from behavioral contracts, each in its own commit carrying the
contract it was written from, and step 1 was answered by deletion - the file
tree, git panel and code editor are gone, along with their dependencies and
settings. What remains is 3,713 lines spread thin across files that have
already been rewritten once and now sit at their functional floor.

## Residual similarity that is not expression

Some rewritten files still score above the measurement's 0.1 threshold, and
inspection shows why: the lines they still share with upstream are interface
and observable behavior, not protectable expression. Concretely:

- import lines referring to this repository's own modules, which match while
  the module layout itself mirrors upstream's;
- exported function signatures and destructured parameter names, pinned by
  their callers;
- error message text, error codes, HTTP route paths, and WebSocket message
  shapes, pinned by clients and tests;
- JSX structure and class strings in presentational components, pinned by the
  product's visual design and by tests that assert on rendered HTML;
- the DDL in `schema.ts`, pinned byte-for-byte in effect by compatibility with
  existing user databases.

Changing any of these would change observable behavior, so no rewrite can
remove them. That claim is now measured rather than asserted:
`node scripts/classify-residual-overlap.mjs` reads every line this tree still
shares with upstream and files it by the construct it belongs to, so the
conversion review starts from an itemized list instead of a percentage.

```
Lines still shared with upstream: 3,455 across 199 files      2026-09-01

  1980  57.3%  declaration   type, prop, parameter and return-shape names
                             callers depend on
   600  17.4%  import        imports of this repository's own modules
   461  13.3%  markup        JSX and class strings pinned by the design and by
                             tests that assert on rendered HTML
   340   9.8%  literal       route paths, error codes, i18n keys, message kinds
    64   1.9%  sql/ddl       schema pinned by existing user databases
    10   0.3%  other         everything a human still has to read
```

The whole `other` bucket is ten lines, and they are what is left over when a
classifier stops guessing: `}: MainContentProps) {`, `useEffect(() => {`,
`export {};`, `declare global {`, `#!/usr/bin/env node`, `export default {`,
and `export default PermissionContext;`.

The declaration bucket is the largest and the most tempting to attack, because
those names are pinned by *our own* callers - a repository-wide rename would
move the number. It would also be churn for its own sake: identifiers are not
protected expression, which is precisely why they are in this list rather than
in the rewrite queue.

What remains before the licence can change is therefore a determination, not
more rewriting:

1. counsel confirms the itemized residue above is functional overlap;
2. `NOTICE` and `CLA.md` are reconciled - they currently name different parties
   as the project owner, which is the one paperwork defect that would matter
   when the grant changes;
3. the flip lands as its own commit at a release boundary: `LICENSE`,
   `package.json`, `Cargo.toml`, the README badge, with earlier tags left
   AGPL-3.0-or-later, because relicensing is prospective and the public history
   keeps the terms it shipped under.

## What "removing" it actually requires

Copyright infringement needs two things: **access** to the original, and
**substantial similarity** of protected expression. A clean-room procedure
attacks the first by using implementers who have never seen the original. That
is not available here - everyone who could do this work has read the code.

The second is available, and it is sufficient. Copyright protects expression,
not function: a file rewritten to a different design, over different
dependencies, with a different structure, shares no protected expression even
though its author had seen the original. Server routes and repositories are the
easiest of all, because the range of expression is narrow to begin with.

The discipline that makes it hold:

1. **Do not work with the original open.** Write down what the file must *do*,
   from its tests and its visible behaviour. Close the original. Implement from
   the description.
2. **Choose a different design.** A different library, a different decomposition.
   Similarity that is structural cannot be argued away; similarity that is
   absent needs no argument.
3. **Keep the evidence.** The description, and a dated commit per replacement.
   The squashed history means there is little evidence of past authorship; there
   is no reason to repeat that mistake going forward.
4. **Measure.** Every replacement should move the number.

`scripts/measure-upstream-derivation.mjs` clones the upstream to compare. That
clone is contaminating material: read it to measure, never to write from.

## Order of work

**Deletion is the cheapest form of replacement, and it is first.** Step 1 was
taken on 2026-09-01: the file tree, git panel and code editor were deleted
rather than rewritten. Agent-first products (Claude Code, Codex CLI, the IDE
extensions) do not rebuild a file browser, a git GUI or an editor; they meet
the user inside the tools that already do that. Deleting those three removed
6,605 derived lines that no rewrite could have driven to zero, because their
substantive content is rendered markup pinned by the product's own design.
Files referenced in chat now open in the user's editor through
`POST /api/system/open-file`.

| Step | Area | Lines | Why here |
| --- | --- | --- | --- |
| 1 | file tree, git panel, code editor | **6,521** | Self-contained features. If an agent reads and edits the files, a human-facing git GUI and file browser may not be product at all - and `git rm` costs nothing to write and nothing to maintain. |
| 2 | server modules | 9,067 | Largest, and the easiest to rewrite legitimately: routes, repositories and migrations have little room for expressive choice. |
| 3 | chat UI | 6,527 | The product's core surface. Worth doing deliberately and last among the large areas. |
| 4 | the remainder | ~10,800 | Settings, sidebar, primitives, odds and ends. |

Step 1 is a **product decision, not an engineering one**: decide what the product
does not do. Nothing else on this list is that cheap.

## Before starting

Two things are worth settling first, because they change the size of the job:

- **Scope.** Every feature cut is derived code that never has to be replaced.
  Answer step 1 before writing any replacement.
- **Sequence against the engine split.** The engine can be closed independently
  and immediately. Doing that first makes the valuable part private while this
  longer work proceeds, rather than after it.

## What this does not achieve

Worth stating plainly, so the effort is spent with open eyes:

- **What is already public stays public.** The repository has been public since
  2026-07-22 and has forks. Removing the code from `HEAD` does not remove it from
  anyone's clone.
- **Shipped builds are readable.** `dist-server` is unminified compiled
  TypeScript, so every release discloses the engine's logic as clearly as the
  source would. Closing the repository without addressing that protects nothing.
- **AGPL is already doing the work most people want from it.** It does not
  prevent copying, and it was never going to; it prevents a *proprietary* fork.
  Relicensing is worth doing when this project wants to be proprietary, not as a
  defence against being copied.
