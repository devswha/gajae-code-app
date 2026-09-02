# elkjs (Gajae Code App stub)

This is not elkjs. It is a first-party, MIT-licensed placeholder that Gajae
Code App installs at `node_modules/elkjs` inside its distributions, where the
real package (EPL-2.0) has been removed by
`scripts/release/distribution-exclusions.mjs`.

It exists because `beautiful-mermaid` imports `elkjs/lib/elk.bundled.js` at
module scope, so without a resolvable package the whole GJC runtime fails to
load. With the stub, loading succeeds and only a Mermaid diagram that actually
needs ELK layout fails, with `ElkLayoutUnavailableError`.

The `version` field is rewritten at build time to the version of the package it
replaces.
