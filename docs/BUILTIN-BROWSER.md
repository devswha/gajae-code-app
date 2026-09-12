# Built-in browser contract

The built-in browser replaces the app-managed Chromium sidecar for basic browser
automation. It is available only in the macOS desktop app. Web and self-hosted
clients open external links; Aside remains a user-installed, runtime-owned
alternative.

## Choice and availability

The application choice is `builtin` or `aside` (default `builtin`). A stored
legacy `native` value reads as `builtin`; new writes use only the new names.
Built-in explicitly selects the runtime's native browser setting on each run.
Aside keeps its CLI probe, routing and no-fallback failure behavior.

Rust reports actual built-in availability through authenticated automation
status. If capability is absent, the app removes both its browser custom tool
and the SDK browser tool name, so ordinary chat remains usable and a browser
direct browser API request receives an explicit unsupported result instead of
activating the SDK's Chromium implementation. Hidden tool discovery is also
disabled under the app's existing tool allowlist policy.

## Surface and ownership

One `builtin-browser` window has one owner. An attempt by another session while
it remains open fails as `builtin_browser_in_use`; closing the window releases
ownership. The trusted 56 logical-pixel toolbar (`builtin-controls`) and the
unprivileged remote page child share that one native window through Tauri 2.11.5
with the exact-pinned `unstable` feature that exposes `add_child`.

The supported actions are open/close, navigate, back, forward, reload, observe,
extract, selector-based click and fill. Arbitrary page `run`, screenshots,
frame streaming, input forwarding and multiple tabs are intentionally absent.
Each command carries the expected window/document/origin captured before any
permission prompt, preventing approval from authorizing a later navigation.
An isolated WKContentWorld holds a private per-document identity. The native
state remains loading until that identity is installed in the finished page;
even a reload at the same URL invalidates earlier document authority. DOM
actions verify this identity immediately before accessing the page. Observed
selectors are unique, ambiguous click/fill requests are rejected, and text/HTML
previews are bounded in UTF-8 with explicit truncation metadata.

Navigation permits HTTPS and exact loopback HTTP only. It rejects the app's own
server origin, credentials and special schemes. macOS 13 uses an explicit
ephemeral profile; macOS 14+ uses a persistent UUID profile.

## Boundary and lifecycle

The worker reaches `AutomationService` through the existing bridge. The server
then verifies the native endpoint's HMAC proof; native separately checks the
server's kernel `LOCAL_PEERPID`. Desktop bootstrap uses one private stdin
`GJC_DESKTOP_INIT` v2 envelope, with an optional updater binding. A retained open
window blocks restart preparation. Owner and pending work are retired only
after the window is confirmed destroyed.
Fences, cancellation and physical pending work remain owned until confirmed
settled.

## Packaging and acceptance

Root Puppeteer dependencies are removed, but the pinned SDK still brings
`puppeteer-core` and `@puppeteer/browsers`. Keep the extract-zip backport,
runtime manifest checks and payload security graph until that dependency graph
changes; this contract does not claim that packaged Puppeteer bytes are gone.

## Validation — 2026-09-12

The integrated change was checked on **macOS 26.6.2, arm64**, using an isolated
`--qa-profile` and a disposable loopback website. No production profile or model
credentials were used.

- The full `npm run verify` gate passed, including the real SDK contract suites,
  browserless root/delegation discovery checks, origin permission binding,
  frontend DOM suites, locale parity and package checks. Final typecheck, lint
  and identity checks also passed after cleanup.
- The macOS server payload built and passed its out-of-tree smoke. The final
  native suite passed **358 tests** with 6 existing opt-in cases ignored; the
  build-binding integration suite passed **11 tests**. An ad-hoc app was built
  with `GJC_UPDATE_MODE=disabled`.
- **30 real authenticated REST → server → native WebView checks passed**:
  readiness, opening/loading, title, bounded long Korean-page observation,
  truncation, unique selectors, fill and its input event, click and its page
  handler, ambiguous-selector rejection, remote IPC denial, owner collision,
  navigation, stale-document rejection, native back/forward/reload, same-URL
  reload invalidation and fresh observation, all three loopback
  aliases for the forbidden app server, removed input endpoint, close and the
  confirmed empty state.
- Actual GUI checks passed for Settings launch, the full toolbar below the
  titlebar, address-field navigation, direct page typing/clicking, visible
  blocked-address feedback, toolbar close and normal QA app quit. Geometry
  uses AppKit's content layout and parent coordinate system; the toolbar and
  its status row fit inside 56 points without covering the page.

The native document, cancellation, retained-window restart fence, profile/QA
isolation and capability invariants also have focused Rust tests. A synthetic
updater exchange peer now stays alive until retirement, matching the real
persistent channel and avoiding an early-EOF race in that test fixture.

This is source/ad-hoc acceptance. It does not claim a new live-model browser
run, physical macOS 13 execution, or a signed/notarized production update.
