# Relicensing

The project moved from AGPL-3.0-or-later to MIT on 2026-09-01. This page records
what that required, what it did not, and how to check the claim it rests on.

## Where it stands

**Done.** `LICENSE` is MIT, `NOTICE` carries the copyright and the origin
attribution, and `package.json`, `src-tauri/Cargo.toml` and
`native/gajae-core/Cargo.toml` all declare MIT. Releases up to and including
2.0.0-beta.6 stay AGPL-3.0-or-later: relicensing is prospective and the tags
keep the terms they shipped under.

The project started as a fork of the upstream recorded in
[UPSTREAM.md](./UPSTREAM.md), so for as long as that project's code was in the
tree the licence was not this project's to choose. Getting the choice back took
two things: rewriting every file from its behavioral contract rather than
editing it, one commit per file, and deleting the features whose value did not
justify the rewrite - the file tree, git panel and code editor, which
agent-first tools leave to the editor the user already has.

Measured with `node scripts/measure-upstream-derivation.mjs`:

```
Upstream-derived code: 6,554 of 99,019 lines (6.6%)      baseline 2026-09-01

  2216 lines   39 files  translations
   761 lines   35 files  server modules
   743 lines   23 files  other components
   733 lines   18 files  other client
   694 lines   27 files  chat UI
   404 lines   15 files  settings
   329 lines   19 files  UI primitives
   306 lines   10 files  other
   155 lines    7 files  other server
    79 lines    3 files  docs and config
    79 lines    3 files  sidebar
    55 lines    1 files  served assets
```

A same-day rewrite pass then took the reducible remainder apart file by file -
translations reworded, components and server modules restructured, the
stylesheet reorganized. A second pass the same day went after what the first
had called fixed: the nginx template was redesigned around server-level proxy
inheritance, the schema DDL was re-expressed (layout, commentary, commutable
constraint order - the logical schema is pinned by every user database on disk
and did not move), the feature-request template became a GitHub issue form,
and the last matching shebangs and re-export lines were reworked. The tree now
measures:

```
Upstream-derived code: 88 of 98,979 lines (0.1%)         after rewrite 2026-09-01

    88 lines  package.json    the dependency set and its semver ranges, npm's
                              JSON grammar, and tool invocations (vite, tsc)
```

Re-run it to see the number move. Zero is the point at which this project can be
licensed as it chooses. The one file above zero is itemized in full: its shared
lines are the factual list of packages this product depends on, the version
ranges it accepts, and commands dictated by the tools they invoke. Driving it
to zero would mean shipping different dependencies - changing the product, not
the expression. That is stated as the limit of this exercise, not as its
completion.

Two accounting notes on the 2026-09-01 baseline. First, it is not comparable to
the 33.5% figure previously recorded here: the measurement now diffs only
substantive lines (blank and punctuation-only lines no longer count as shared)
and uses a symmetric denominator, on the grounds that neither blank lines nor
file-length asymmetry are protected expression. Under the previous ruler the
same tree measures 32.7%. Second, the measurement was widened after the code
was done, and the widening is the more important half of the story: it had only
ever read `.ts/.tsx/.js/.jsx`, so it walked past four screenshots byte-identical
to upstream's, an API documentation page served verbatim, the stylesheet, the
changelog and the UI copy in ten languages. Prose, screenshots and design are
the most clearly ownable things in a repository and were the last to be checked.
They have since been deleted or rewritten, and the measurement now reads
css/json/html/md/conf/yml as well and compares binary assets byte for byte.

Third, step 1 was answered by deletion rather than rewriting: the file tree, git
panel and code editor are gone with their dependencies, settings and
translations, because agent-first tools meet the user inside the editor they
already have. Files referenced in chat open through
`POST /api/system/open-file`.

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
- the DDL in `schema.ts`, whose logical content - column names, types,
  defaults, constraints - is pinned by compatibility with existing user
  databases; its layout and commentary have been re-expressed, which is all
  the expression DDL has.

Changing any of these would change observable behavior, so no rewrite can
remove them. That claim is now measured rather than asserted:
`node scripts/classify-residual-overlap.mjs` reads every line this tree still
shares with upstream and files it by the construct it belongs to, so the
conversion review starts from an itemized list instead of a percentage.

```
Lines still shared with upstream: 750 across 72 files    after rewrite 2026-09-01

   380  50.7%  declaration   type, prop and parameter names callers depend on,
                             and the i18n keys the components read
   178  23.7%  import        imports of this repository's own modules
   121  16.1%  literal       CSS declarations, route paths, error codes
    26   3.5%  other         everything a human still has to read
    22   2.9%  i18n key      key lines in locale files
    17   2.3%  markup        JSX and class strings pinned by the design and by
                             tests that assert on rendered HTML
     6   0.8%  sql/ddl       inline DDL in migrations, pinned by user databases
```

The `other` bucket is 26 lines and it is entirely file format: YAML keys in a
workflow, `#!/usr/bin/env node`, `export {};`, `@layer base {`, and the
`}: Props) {` that closes a destructured parameter list. The stylesheet's share
is single CSS declarations - one project cannot write
`padding-top: var(--safe-area-inset-top);` differently from another.

The declaration bucket is the largest and the most tempting to attack, because
those names are pinned by *our own* callers - a repository-wide rename would
move the number. It would also be churn for its own sake: identifiers are not
protected expression, which is precisely why they are in this list rather than
in the rewrite queue.

That determination was made on 2026-09-01 on the evidence above, without
outside counsel, and it is stated here rather than implied: what the two trees
still share is interface and file format, not expression. `NOTICE` and `CLA.md`
now name the same party as the project owner, and the attribution to the
upstream project is kept although MIT does not require it.

The residual risk that remains is not that the analysis is wrong but that
someone disagrees with it. The mitigations are all in place and all free:
attribution kept, evidence reproducible from two scripts, one commit per
rewritten file with the contract it was written from, and earlier releases left
on the terms they shipped under. If a complaint ever arrives, the answer is a
line-by-line account rather than an argument, and the fallback - reverting a
release to AGPL or rewriting a specific line - stays available.

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

## What this did not achieve

Worth stating plainly, so nobody reads more into the change than it carries:

- **What is already public stays public.** The repository has been public since
  2026-07-22 and has forks. Rewriting `HEAD` does not rewrite anyone's clone,
  and the AGPL releases stay AGPL wherever they were downloaded.
- **MIT is a grant, not a shield.** It lets anyone use, modify and ship this
  code, including in a closed product, without asking. That is the point of
  choosing it; it is not a change that protects the project from being copied,
  because nothing ever did.
- **The residue is argued, not certified.** The itemization above is evidence,
  not a legal opinion. It was reviewed by the project owner rather than by
  counsel, and that decision is recorded here so it is visible rather than
  implied.
