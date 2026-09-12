# Built-in WebView Browser — Proof of Concept

Status: **PoC only.** This is not the production browser backend. The Native
(Puppeteer/Chromium sidecar) browser and the Aside backend are unchanged; see
"Scope" below.

## What was built

The smallest possible slice that proves the architecture:

- `src-tauri/src/browser_poc.rs` — window creation, URL validation (https
  only), duplicate handling, and a read-only `document.title` probe.
- Two desktop-shell commands, `browser_poc_open` / `browser_poc_title_probe`,
  registered in `src-tauri/src/main.rs`.
- `src-tauri/capabilities/browser-poc.json` — the only new capability: it
  grants exactly those two commands to the served SPA on the supervised
  loopback origin (`http://127.0.0.1:*`, window `main` only).
- A carve-out in `navigation.rs` + `lifecycle.rs`: the `browser-poc` window is
  the only webview allowed to leave the loopback navigation lock (https URLs
  only), and closing it destroys it instead of hiding the app surface.
- `src-tauri/build.rs` now declares the app command manifest, which turns on
  ACL enforcement for the shell's own commands (see Security).
- Settings → Automation → "Built-in WebView (PoC)" entry point
  (`AutomationSettingsTab.tsx` + `src/utils/browserPoc.ts`), rendered only
  when the Tauri command bridge exists (desktop shell only).

## The ten questions

### 1. Which Tauri WebView primitive was used?

`tauri::WebviewWindowBuilder::new(app, "browser-poc", WebviewUrl::External(url))`
(tauri 2.11.5 / tauri-runtime-wry 2.11.4 / wry 0.55.1 — the versions pinned in
`src-tauri/Cargo.toml`). On macOS the builder also sets a fixed
`data_store_identifier` (dedicated `WKWebsiteDataStore`); Windows/Linux set a
`data_directory` under the app data dir. No custom protocol, no iframe, no
webview embedding tricks — a real second OS window with the system WebView.

### 2. Does it render remote pages directly?

Yes. Verified live on macOS (Apple Silicon, macOS 26): `https://example.com`
renders in the PoC window, rendered by WebKit itself. There is no screencast,
no JPEG/frame stream, no `BrowserPanel` involvement, no mouse/keyboard/clipboard
forwarding, no viewport synchronization, and no Puppeteer/Chromium process.
The legacy browser stack was not touched.

### 3. Does user input work directly?

Yes. Verified live:

- Clicking example.com's "Learn more" link started a real navigation chain in
  the window (`https://iana.org/domains/example` → 301 →
  `https://www.iana.org/…`). The chain ultimately stopped only because
  iana.org redirects that page to **cleartext http**, which the PoC's
  https-only navigation policy refuses — the policy working as designed.
- `location.href = 'https://example.org/'` navigated the window (confirmed by
  reading `location.href` back in the page).
- Right-click opens the native WebKit context menu (Reload / Inspect Element).

Double-click text selection was exercised but its highlight could not be
confirmed by screenshot OCR in the automated harness; click and keyboard input
demonstrably reach the page (the click that navigated the link is the same
input path).

### 4. What browser engine is used on each platform?

- macOS: system WebKit (`WKWebView`). Verified live.
- Windows: WebView2 (Chromium). Not built or tested in this PoC; the code path
  is the same `WebviewWindowBuilder`, with `data_directory` set. Out of scope
  until the desktop shell ships there.
- Linux: WebKitGTK. Not tested; Linux desktop packaging is out of active
  development (owner decision 2026-09-09). The Rust code compiles for it; the
  `data_directory` path is set.

No cross-platform consistency is claimed beyond macOS.

### 5. How are cookies/profile data persisted?

macOS (verified live): the PoC window uses a dedicated persistent
`WKWebsiteDataStore` (fixed UUID, `data_store_identifier`). Observed:

- `localStorage` set on example.com in one window instance survived closing
  the window, reopening it (new window object), and **a full app relaunch** —
  read back as the same value afterwards.
- A session cookie (no `Max-Age`) did **not** survive the app relaunch. That
  is ordinary session-cookie semantics; durable cookies (`Max-Age`/`Expires`)
  live in the same persistent store as localStorage and are expected to
  survive, but were not separately verified in this PoC.

So: yes, this can realistically serve as a persistent basic built-in browser
on macOS. The store is per-app and separate from the main window's default
store; login state in the browser window does not leak into the shell's
webview.

Windows/Linux: WebView2/WebKitGTK profile directories are configured
(`data_directory` under the app data dir) but not verified.

### 6. What Tauri capabilities are available to the remote WebView?

None. The boundary, in layers:

1. **Window label**: no capability anywhere references the `browser-poc`
   label. Tauri's ACL resolves commands per (window label, origin context), so
   plugin commands (`shell:*`, `deep-link:*`, `core:*`) are all denied for the
   remote page. A unit test (`capability_files_keep_the_browser_window_unprivileged`)
   enforces this on the capability files.
2. **App commands**: `src-tauri/build.rs` now declares the app command
   manifest (`tauri_build::AppManifest::commands`), which makes the shell's
   own commands ACL-gated too. Before this, app commands without an app
   manifest are callable from **any** page that received the IPC
   initialization script — including remote pages. This PoC closes that hole
   for the whole shell: `retry_desktop_server` and `ack_updater_screen` are
   now explicitly granted only to the local `main` window
   (`capabilities/default.json`).
3. **Verified live**: from example.com inside the PoC window,
   `window.__TAURI_INTERNALS__.invoke('retry_desktop_server')` was rejected
   with
   `retry_desktop_server not allowed on window "browser-poc", webview "browser-poc", URL: https://example.com/ — allowed on: [windows: "main", URL: local], referenced by: capability: default`.
   Invoking `browser_poc_open` from the remote page did not open a window.
4. **The SPA's own grant**: the served SPA (loopback origin, `main` window)
   may invoke exactly `browser_poc_open` and `browser_poc_title_probe` — the
   smallest remote-context capability that still lets our own UI drive the
   PoC. The URL pattern `http://127.0.0.1:*` was verified to match only the
   loopback origin (any port), nothing else.
5. **Residual surface, documented**: Tauri injects its IPC bootstrap into
   every webview, and `window.__TAURI_INTERNALS__` is defined
   non-configurable, so it cannot be deleted by the PoC's strip script (which
   does remove `window.__TAURI__`). The internals object is unusable to the
   page: every command is denied by the ACL (3) and the per-app invoke key it
   would need lives only in initialization-script closures.
6. **Navigation policy**: the `browser-poc` window may navigate to https URLs
   only. Verified live: `http://127.0.0.1:<port>` and iana.org's cleartext
   redirect were refused; every other webview keeps the loopback-only lock.

### 7. Can simple JS evaluation work?

Yes, read-only. `WebviewWindow::eval` runs JavaScript in the remote page. The
PoC's `browser_poc_title_probe` evaluates `document.title` and renders it as a
banner inside the page. Verified live: the banner
`Gajae PoC: document.title = Example Domain` appeared in the window. This is
the entire automation surface of the PoC — no click/fill/wait APIs, and none
should be added without a security review of what a page can be made to do.

### 8. What important limitations exist?

- https-only navigation in the PoC window: sites that downgrade to cleartext
  http (e.g. the iana.org page example.com links to) will not finish loading.
  Deliberate; can be revisited with HSTS-style handling later.
- No URL bar, history UI, reload/back/forward controls, download handling,
  popup handling, or multi-tab support. `Webview::url()`, navigation and
  friends exist in this Tauri version if a future PR wants them; this PoC
  intentionally did not build browser chrome.
- Session cookies die with the app relaunch (see 5); durable cookies and
  localStorage persist.
- The macOS window is a plain `WebviewWindow`; standard title bar only.
- Windows/Linux behavior is configured but unverified.
- `window.open` / popups from remote pages were not implemented or tested;
  wry's default new-window behavior applies (effectively suppressed).

### 9. Can this realistically replace the current Native browser as the fallback?

Yes, for the fallback role: basic browsing with direct rendering, direct user
input, persistent per-app profile, and a hard security boundary against
privileged app APIs — all verified live on macOS. It cannot replace the
*automation* role: there is no CDP, no selector engine, no auth replay. That
remains Aside's job (or the legacy Native browser until it is retired).
Complex automation through `evaluateJavaScript` is theoretically possible but
was deliberately not explored beyond `document.title`.

### 10. What legacy components could eventually be deleted?

If the Built-in WebView becomes the fallback browser and Aside covers the
automation path, the following legacy pieces become candidates for removal
(**not in this PR**): the browser sidecar and its protocol/runtime modules,
Puppeteer / `@puppeteer/browsers`, the managed Chromium download/cache, the
screencast/frame streaming pipeline, `browser.input` mouse/keyboard/clipboard
forwarding, viewport synchronization, and the `BrowserPanel` rendering path
for remote content.

## Scope guardrails honored

- BrowserPanel, WorkspacePanel, browser-sidecar/runtime/protocol, Puppeteer,
  Chromium cache, screencast, and `browser.input` are untouched.
- Aside (`browser.backend=aside`, its skill, repl/exec routing, CLI probing,
  and setting) is untouched; the PoC is not part of the backend selector.
- No feature-flag system; the entry point is desktop-shell-only by bridge
  availability.
- Tests: Rust unit tests for URL validation, label scoping, navigation
  policy, and the capability files; DOM tests for the Settings entry point
  (hidden without the bridge, both open outcomes, probe error surfacing).
  No test requires internet, Chromium, or Aside.

## How to run the PoC manually

1. Build the desktop shell (`npm run server:payload:macos`, then
   `env -u CI GJC_UPDATE_MODE=disabled npm run tauri -- build --bundles app`,
   or `cargo build` inside `src-tauri` for a debug shell).
2. Open the app → Settings → Automation → **Built-in WebView (PoC)** →
   *Open test browser*.
3. Interact with the page directly; close/reopen the window; use *Show page
   title* to see the `document.title` probe banner.

POC RESULT: VIABLE_WITH_LIMITATIONS
