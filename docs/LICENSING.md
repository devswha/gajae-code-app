# Licensing

What this project is licensed under, what it may not ship, and what those
decisions cost. Read this before adding a dependency or changing anything under
`LICENSE`, `NOTICE`, or `scripts/release/`.

Relicensing this project - closing the engine, then the application - is planned
separately in [RELICENSING.md](./RELICENSING.md), which measures what stands in
the way and orders the work.

## What the app is

Gajae Code App is **AGPL-3.0-or-later**, and `package.json` declares the same.

The `LICENSE` file is the AGPL text plus **additional terms under Section 7**,
authored by Siteboon AI B.V. as copyright holder of the historical upstream this
project derives from. Those terms are not optional and not ours to waive:

- **7(b)** requires the upstream attribution notice, verbatim as `LICENSE` gives
  it, in documentation, README, or Appropriate Legal Notices, reasonably
  prominent.
- **7(c)** requires modified versions to be clearly marked as modified and not
  presented as the original.

The upstream identity itself is recorded once, in [UPSTREAM.md](./UPSTREAM.md),
and in `LICENSE` and `NOTICE`. It is deliberately not repeated here: the identity
scanner treats a legacy product reference outside those files as a defect,
because that is how provenance quietly turns into an install instruction.

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

Redistributing a dependency carries its notice obligations, and most of the 582
packages in a distribution require their license text to travel with them.

`THIRD-PARTY-NOTICES.md` is generated from the dependency tree by
`scripts/generate-third-party-notices.mjs`. It reads the tree rather than a
hand-kept list, because a list answers for the day it was written and stops
being true on the next install. `npm run check:notices` runs inside
`npm run verify` and fails when the file no longer matches the tree, so a
distribution cannot ship notices describing an older set of dependencies. Both
distribution builders carry the file.

It closes the two obligations that were being missed outright:

- `@gajae-code/coding-agent` declares MIT but ships **no license file**, so the
  notice it requires was absent from everything we redistribute. Twenty-eight
  packages are in that position; each is listed with its declared license and
  copyright holder rather than passed over.
- Pretendard is **OFL-1.1** and its subset fonts ship in `dist/assets/`. Its
  license lives at `dist/LICENSE.txt` inside the package, which is why the
  generator looks beyond each package root.

Excluded packages are deliberately absent from the notices: the build removes
them, so this project does not redistribute them, and a notice for something
that does not ship makes the real entries harder to trust.

## The engine boundary

A closed core is possible only if the part that would close depends on nothing
it cannot take with it. That part exists and is measured:

| Layer | Files sharing a path with the historical upstream | Original to this project |
| --- | --- | --- |
| `native/` (Rust core) | 0 | 5,368 lines |
| `src-tauri/src` (desktop shell) | 0 | 784 lines |
| `server/gjc-*` (worker, adapter, protocol) | 0 | 13,397 lines |

The app may call into the engine. **The engine may not reach back**, and that is
enforced rather than hoped for: `eslint.config.js` classifies the engine files as
`gjc-engine` and fails any import from them into `server/modules/*`, barrel
imports included. The rule sits last in the list because this plugin lets a later
rule re-allow what an earlier one denied, and the barrel allowance above it would
otherwise reopen the door.

One file moved to make that true: `gjc-command-surface.generated.ts` is generated
from the installed runtime and was living in `server/modules/providers/`, so the
engine had to import the app to read it. It now sits beside the engine that
generates it, and the app imports it from there - the allowed direction.

### How the last two couplings went

`server/gjc-cli.js`, the pre-worker spawn path, was the last file reaching into
the app. It imported two things, and neither turned out to be a real dependency:

- **The notification orchestrator.** Used only as the default value of two
  options, and the sole production caller - `gjc-worker-node-runtime.ts` -
  already passed no-ops over them. The app owns run notifications and delivers
  them from its own side of the protocol. The defaults are now no-ops, which is
  what production was already doing.
- **`providerAuthService.isProviderInstalled`.** Used only to choose between two
  error messages after a failed run: the CLI's own, or "gjc is not on PATH".
  Answering that pulled the app's provider registry, and the credential database
  behind it, into the engine to learn something the engine can ask the CLI
  directly. It now spawns `gjc --version` itself - asynchronously, unlike the
  app's synchronous probe, so the grace period the caller wraps it in means
  something.

Both files are in `gjc-engine` now and the boundary holds end to end. The only
file in `server/gjc-*` still importing the app is `gjc-worker-client.ts`, which
is supposed to: it is the app's end of the protocol.

### What extraction still needs

The code boundary is done, and so is the interface it runs over:
[GJC-WORKER-PROTOCOL.md](./GJC-WORKER-PROTOCOL.md) specifies the worker protocol
so either side can be implemented from it alone, and
`server/gjc-worker-protocol-spec.test.ts` fails when the document and the codec
disagree. That matters here for a reason beyond documentation: a proprietary
engine behind a documented, independently implementable interface is a separate
program, while one behind private glue invented to look like an interface is an
argument.

Its one gap is stated in the document itself - payload schemas are not part of
the protocol layer, so a third party could implement the host side today but
would need those schemas to implement the worker side.

Still outstanding for extraction: a decision on whether `src-tauri` ships with
the engine or the shell, and the third-party notices below - which the engine
would carry, since it is the side that bundles the runtime.

## Adding a dependency

1. Check the license before adding it. MIT, BSD, ISC, Apache-2.0 and MPL-2.0 are
   fine. AGPL, GPL, LGPL, SSPL, EPL, BUSL, Elastic and anything source-available
   are not.
2. Run `npm run check:licenses`. It reads the production tree from
   `package-lock.json`, so it sees transitive dependencies too.
3. If the check fails on a package arriving through a dependency you do not
   control, decide between removing the parent, excluding the package with its
   cost recorded, or accepting the terms for the whole product.
