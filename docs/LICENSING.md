# Licensing

What this project is licensed under, what it may not ship, and what those
decisions cost. Read this before adding a dependency or changing anything under
`LICENSE`, `NOTICE`, or `scripts/release/`.

## What the app is

Gajae Code App is **AGPL-3.0-or-later**, and `package.json` declares the same.

The `LICENSE` file is the AGPL text plus **additional terms under Section 7**,
authored by Siteboon AI B.V. as copyright holder of the upstream project this
one derives from, `CloudCLI UI` (`https://github.com/siteboon/claudecodeui`).
Those terms are not optional and not ours to waive:

- **7(b)** requires the attribution `"CloudCLI UI
  (https://github.com/siteboon/claudecodeui)"` in documentation, README, or
  Appropriate Legal Notices, reasonably prominent.
- **7(c)** requires modified versions to be clearly marked as modified and not
  presented as the original.

`LICENSE` and `NOTICE` are hash-pinned by `npm run check:identity`, so neither
changes without a deliberate update to that script. Provenance and the intake
rules live in [UPSTREAM.md](./UPSTREAM.md).

AGPL Section 13 also requires offering source to anyone who uses the app over a
network. The About tab carries the license link and the repository URL for that
reason; do not remove them.

## What must not ship

The app bundles `@gajae-code/coding-agent`, a third-party MIT package this
project does not control. Its dependency tree is a license surface we inherit
rather than choose, and it currently pulls two packages that cannot ship here.

`scripts/release/distribution-exclusions.mjs` is the single list, consumed by
both distribution builders and by the check. Nothing upstream is patched: the
packages install normally and are deleted from the artifact, so a runtime bump
re-applies the decision with no manual step.

| Package | Terms | Reached through | Cost of excluding it |
| --- | --- | --- | --- |
| `mupdf` | AGPL-3.0-or-later | `@gajae-code/coding-agent` → `markit-ai` | The `read` tool stops converting **PDFs** |
| `elkjs` | EPL-2.0 | `@gajae-code/coding-agent` → `@gajae-code/utils` → `beautiful-mermaid` | Mermaid layout, which nothing reaches |

`npm run check:licenses` runs inside `npm run verify` and fails when a shipped
package carries terms this product cannot distribute and is not on that list.
It fails in the other direction too: an exclusion for a package no longer in the
tree is a rule guarding nothing.

### Why PDF was given up

`mupdf` is AGPL. Bundling it forecloses any non-AGPL licensing of this product,
and it cannot be removed at the source because `markit-ai` is a hard dependency
of a package this project does not own.

Measured before deciding: removing `mupdf` alone leaves the runtime loading
normally and the tool suites passing unchanged, because `markit-ai` loads it
through `require("mupdf")` inside a function rather than at module scope. The
loss is confined to one of markit's nineteen converters. **Word, PowerPoint,
Excel, EPUB, iWork, notebooks, audio, images, HTML, RSS and the rest keep
working.**

Two ways to get PDF back, neither urgent:

1. **Fork `markit-ai`.** It is MIT (`Michaelliv/markit`), and `mupdf` is confined
   to `converters/pdf/`. Swap it for a permissive engine such as pdf.js
   (Apache-2.0). Cost: the fork must be maintained against upstream, and the
   current converter uses mupdf's structured-text geometry for table and diagram
   extraction, so a naive swap degrades to plain text extraction.
2. **Handle PDFs above the runtime.** Convert in the app with a permissive
   library and hand the agent the converted text. Nothing is forked, so runtime
   updates cannot break it. Preferred if PDF becomes a requirement.

### One thing to watch

The exclusion works because the `mupdf` load is lazy. If upstream ever makes it
a module-scope import, deleting the package would break the runtime instead of
degrading it. The payload builder's smoke step runs the packaged server, so that
change fails the build rather than reaching users. If it happens, the choice is
between forking `markit-ai`, dropping the feature another way, or staying AGPL.

## Third-party notices

Redistributing a dependency carries its notice obligations. Two are open and
neither is fixed yet:

- `@gajae-code/coding-agent` ships **no LICENSE file** despite declaring MIT, so
  the copyright and permission notice MIT requires is absent from what we
  redistribute.
- Pretendard is **OFL-1.1** and its subset fonts ship in `dist/assets/`, but the
  OFL text is nowhere in the repository.

The fix for both is a generated `THIRD-PARTY-NOTICES` produced at build time from
the shipped tree, so new dependencies are covered without anyone maintaining a
list by hand.

## Adding a dependency

1. Check the license before adding it. MIT, BSD, ISC, Apache-2.0 and MPL-2.0 are
   fine. AGPL, GPL, LGPL, SSPL, EPL, BUSL, Elastic and anything source-available
   are not.
2. Run `npm run check:licenses`. It reads the production tree from
   `package-lock.json`, so it sees transitive dependencies too.
3. If the check fails on a package arriving through a dependency you do not
   control, decide between removing the parent, excluding the package with its
   cost recorded, or accepting the terms for the whole product.
