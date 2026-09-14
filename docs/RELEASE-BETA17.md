# Gajae Code App 2.0.0-beta.17

Product: `2.0.0-beta.17`; desktop: `0.2.11`; SDK: `0.16.4`.
macOS Apple Silicon desktop and Linux x64 self-hosted server.

## Changes

- Adds bounded, privacy-safe desktop startup/shutdown and native-client
  diagnostics with deterministic occupied-port and native-failure fixtures.
  Records retain stages and fixed failure categories without message text,
  paths, URLs, credentials or supervised output.
- Preflights the remembered loopback origin immediately before sidecar spawn.
  OS-assigned ports and an explicitly refused connection may proceed; active or
  ambiguous listeners fail closed. The app preserves the foreign listener and
  remembered port, never attaches to or kills the occupant, and applies the
  same check to updater successor startup.
- Enforces managed CUA's background-only policy at schema, capability,
  authorization, service and driver boundaries. Foreground or desktop-scoped
  delivery, physical pointer movement, unbound input and unreviewed arguments
  are denied before dispatch; grants remain session- and application-scoped.
  Background delivery remains a driver best-effort behavior, not a guarantee
  that the operating system can never foreground input.
- Separates browser surfaces: Settings' explicit built-in viewer launch is
  independent of the selected agent backend, while HTTP(S) links in chat open
  in the user's external browser. A backend selection does not redirect either
  surface.
- Makes Ego readiness explicit and browser-only. Readiness inspection is
  filesystem-only and redacts paths; only the user-requested Settings test may
  run the bounded CLI health check. If Ego is unavailable, ordinary chat and
  coding remain available while browser work fails closed, with no Built-in,
  Aside, OS-browser, Playwright, Puppeteer, MCP or CUA fallback.
- Repairs post-merge CI contract fixtures so the intended session-scoped CUA
  grant is materialized and browser-backend vocabulary parity is covered at
  the application manifest boundary.

## Release boundary

Any updater-enabled macOS build must be production-bound at compile time with
`GJC_UPDATE_MODE=production`, its production feed origin and updater public key,
then Developer ID signed, notarized and stapled before publication. This source
preparation does not claim a built artifact, signature/notarization result,
updater A-to-B transition, GUI or macOS 13 acceptance, live-provider run, or
Linux desktop acceptance.
