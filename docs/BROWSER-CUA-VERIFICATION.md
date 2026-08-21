# Browser and CUA verification

Last verified: 2026-08-21 on Apple Silicon macOS.

## Implemented surface

- A Bun NDJSON sidecar owns the persistent Chrome-for-Testing profile, tabs,
  structured CDP actions, input, downloads policy, and screencast frames.
- The Workspace Browser panel and GJC agent bridge share the same session tabs.
- Browser HTTP automation is available at `/api/browser/:sessionId`; the first
  PoC `/api/automation/browser/:sessionId` routes remain as compatibility aliases.
- `npm run browser:debug` is an HTTP-only client for the running server. It does
  not launch Chromium and accepts the desktop cookie through
  `GAJAE_BROWSER_DEBUG_COOKIE` when desktop authentication is enabled.
- CUA Driver remains an external prerequisite. The status surface reports its
  version, daemon state, Accessibility permission, and Screen Recording
  permission. Agent native actions are limited to the reviewed allowlist.
- Origin and application grants are session-scoped by default. Only an explicit
  “Always allow” persists; individual grants can be revoked in Settings.
- Stop closes the browser/CUA session, aborts active work, and clears session
  grants. A crashed sidecar reaps its owned Chromium process, restarts, restores
  tab URLs and the active tab, then resumes screencasting.

The PoC intentionally excludes file upload, automatic download saving, browser
extensions, existing Chrome profiles, force-quitting native apps, clipboard
reading, file transfer, screen recording, and lock-screen control.

## Automated evidence

The following passed on 2026-08-21:

- `npm run verify`: dependency audit, TypeScript, Rust formatting/clippy/tests,
  all server and client tests, lint, identity checks, and production builds.
- `npm run test:e2e:gjc`: seven driver/wire/browser integration scenarios.
- `npm run test:e2e:browser`: real Chrome-for-Testing actions, popup and tab
  state, navigation, dialogs, screencast, and interruption of a non-settling
  page script.
- Fake sidecar recovery integration: restart, orphan-browser reap, URL restore,
  active-tab restore, and screencast resubscription.
- Fake CUA and HTTP route integration: computer call, persistent grant creation,
  individual revoke, and the public `/api/browser/:sessionId` routes.
- `npm run smoke:packaged-server -- --tauri-app <app>` and strict `codesign`
  verification against the generated Tauri app bundle.

## Manual packaged-app evidence

The generated app at
`src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Gajae Code App.app`
passed these checks:

- Opened `http://100.78.133.28:8080/` in the Workspace Browser panel and showed
  the live todo-list Chromium frame.
- Killed only the owned browser sidecar. The app reaped the orphaned Chromium,
  started a new sidecar and Chromium process, restored the same URL and tab, and
  resumed the live frame without restarting the desktop app.
- Ran a Sol session using `computer.list_apps`; CUA Driver 0.21.0 returned that
  TextEdit was running and the app remained stable.
- Requested a previously unapproved `https://example.org` origin, selected
  **Deny**, and observed a failed-closed tool result while the shared browser
  stayed on the existing todo page.
- Started `browser.run` with a promise that never settles, pressed Stop, and
  observed cancellation and browser-session cleanup in 733 ms.

macOS Accessibility and Screen Recording were already granted for this test.
They were inspected but not revoked because changing OS privacy permissions is
outside normal app QA. Denied app-level origin access exercises the app's
fail-closed approval path without modifying system security settings.

## Upstream SDK dependency

`@gajae-code/coding-agent@0.14.2` and its upstream `main` branch do not yet
provide an external backend interface for the reserved `browser` and `computer`
tools. The app therefore still supplies these two tools through the SDK's
`customTools` option. The requested architecture—inject at built-in tool
materialization time without a same-name custom-tool overwrite—requires an
upstream release. It is tracked in
[gajae-code issue #4809](https://github.com/Yeachan-Heo/gajae-code/issues/4809).

After upstream publishes that API, replace `customTools` in
`server/gjc-bun-sdk-adapter.ts`, update `@gajae-code/coding-agent`, and rerun the
same gates and packaged-app scenarios above. No direct `node_modules` patch is
permitted.
