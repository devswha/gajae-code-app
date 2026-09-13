# CUA background-only validation drill (opt-in, manual)

This drill is **not run by any automated suite** and must never be wired into
`npm test`, `npm run verify`, or CI. It requires a human at a physical Mac and
it drives real GUI input. Run it only when you intend to.

## What this drill can and cannot establish

**Claim under test**

> Gajae Code does not request foreground or desktop-scoped delivery on the
> managed `computer` path.

**Not claimed, and not testable here**

> macOS can never deliver foreground input.

The automated tests in `server/modules/automation/cua-capability.test.ts` and
`cua-authority.test.ts` already prove the request side deterministically: the
server rejects `delivery_mode: 'foreground'`, `scope: 'desktop'` and physical
pointer movement before dispatch. This drill exists to check the *observed*
side — that a permitted background request behaves the way CUA Driver 0.21.0
documents on real hardware.

Known limits that no amount of drilling removes:

- `delivery_mode: "background"` is documented by the driver as a
  **"best-effort-background ladder rung"**, not a guarantee.
- `hotkey` and `press_key` are documented as never driver-verifiable
  (`effect: "unverifiable"`); a successful post is not proof of delivery, and a
  missing effect is not proof of non-delivery.
- The agent cursor overlay is decorative. Seeing it move is **not** evidence
  that the hardware pointer stayed still — record the pointer separately.
- TCC booleans from `cua-driver permissions status --json` describe the
  `com.trycua.driver` daemon identity, not this app's.
- `--permission-mode bounded` and `--capability-manifest` are `serve`-only
  flags. The app uses the `cua-driver mcp` proxy path and cannot assert a
  reviewed capability manifest; this drill cannot substitute for one.

## Preconditions

- macOS on Apple Silicon, `cua-driver` 0.21.x installed and its daemon running
  (`cua-driver status` reports `Cua Driver daemon is running`).
- `cua-driver permissions status --json` reports
  `"source": {"attribution": "driver-daemon"}`. Any other attribution means the
  app reports permissions as unknown and the drill is invalid.
- A scratch target app (TextEdit with an untitled document is sufficient).
- A **separate** app the operator will actively type into for the whole run —
  this is the app whose focus must never be stolen. Do not use a real account,
  a messaging client, or anything with destructive shortcuts.

Do not run destructive or live-account GUI actions. Do not point the drill at a
browser session, a terminal, or any window where a stray keystroke can act.

## Recorded observations

For every step record all six fields. Steps 3–5 are observed **while the
operator is continuously typing into the unrelated app**.

| Field | How to capture |
| --- | --- |
| Frontmost application | `osascript -e 'tell application "System Events" to name of first application process whose frontmost is true'` |
| Keyboard focus | `cua-driver call get_window_state` on the operator's app, or observe which window receives the operator's typing |
| Real hardware pointer location | `cua-driver call get_cursor_position` (screen points, origin top-left) |
| Target window | `pid` + `window_id` from `cua-driver call list_windows` |
| Requested delivery mode | the exact `arguments` the server dispatched (see below) |
| Observed input delivery | fresh `get_window_state` of the target, plus the operator's report of their own app |

Capture the dispatched arguments from the server rather than from the model's
narration — a model saying it used background delivery is not evidence. Log the
guarded record produced by `guardCuaCall` in
`server/modules/automation/cua-capability.ts`.

## Steps

1. **Baseline.** Record all six fields with no agent activity. Note the
   pointer coordinates precisely.
2. **Grant.** Start a session, have the agent target the scratch app, and
   approve the Action Required prompt for that application only.
3. **Background text.** Agent runs `type_text` against the scratch app while
   the operator types continuously into the unrelated app.
   *Pass:* frontmost unchanged, operator's keystrokes all land in their own app,
   pointer coordinates unchanged, text appears in the scratch app.
4. **Background key and scroll.** Repeat with `press_key` and `scroll`.
   *Pass:* same as step 3. Record `effect` values; `unverifiable` is an expected
   outcome for keys and is not a failure by itself.
5. **Background click.** Repeat with an `element_token`-addressed `click`.
   *Pass:* same as step 3.
6. **Menu.** Agent runs `invoke_menu` on the scratch app.
   *Pass:* frontmost unchanged. CUA Driver 0.21.0 documents `invoke_menu` as
   pure accessibility resolution that never falls back to pixels; if the
   frontmost application changes here, that is a **finding** — record it and
   stop, because the app's tool description asserts no fronting.
7. **Denied escalations.** Confirm each of these is refused by the server
   before any driver round-trip, and that nothing on screen moves:
   - `click` with `delivery_mode: "foreground"`
   - `press_key` with `scope: "desktop"`
   - `move_cursor` with `scope: "desktop"`
   - `click` with `modifier: ["cmd"]`
   - `move_cursor` with no `target`
8. **Revocation.** Revoke the application grant in Settings and confirm the next
   mutation fails closed with `was not granted`.

## Failure handling

Any step where the frontmost application changes, the operator loses a
keystroke, or the hardware pointer moves is a **defect in the background-only
boundary**, not an acceptable variance. Record the exact dispatched arguments
and the driver's response, and file it against the capability policy rather
than adjusting the drill.
