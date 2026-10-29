# Bug Tracker

Bug tracker for Shadow Clash.

## Bug Table Format
`ID | Severity | Area | Steps to reproduce | Expected | Actual | Suggested fix | Status`

| ID | Severity | Area | Steps to Reproduce | Expected | Actual | Suggested Fix | Status |
|---|---|---|---|---|---|---|---|
| BUG-001 | High | Server / Robustness | Send `socket.emit('setNickname', null)` or `roomJoin` with `null` | Server should validate payload as object or send user-friendly error | Unhandled `TypeError: Cannot read properties of null` thrown, resulting in `SERVER_ERROR` | Ensure `withErrors` sanitizes `payload` to an object `{}` if null or non-object; add null check in `input` handler | Verified |
| BUG-002 | Critical | Client / Gameplay | Load any page; open a match | Client should boot and render the game | `client/ui/hud.js` had a syntax error (stray statements after a closed `forEach`), so the module failed to parse and **the entire game client never started** | Remove the stray block; keep the `noskill`/`touch-cd` updates inside the `forEach` | Verified |
| BUG-003 | High | Client / Settings | Open Settings, change Sound FX volume or Reduce Motion during a match | Volume and reduced-motion settings must affect the running game | Callbacks targeted `window.app` which does not exist (app is exposed as `window.shadowClash`), so neither setting did anything; renderer had no reduce-motion support at all | Point callbacks at `window.shadowClash`, add `SoundEngine.setVolume`, honor `reduceMotion` in `Renderer.updateEffects`, default the toggle from `prefers-reduced-motion` | Verified |
| BUG-004 | Medium | Client / Mobile UX | Start a match on a touch device wider than 700px (e.g. 844x390) | Emote buttons must not interfere with gameplay controls | The GG / Nice! / Rematch? strip overlapped the S2 / ULT action buttons | Reposition the emote strip under the round timer on coarse-pointer devices and enlarge buttons to 44px targets | Verified |
| BUG-005 | Low | Client / HUD | Play a match; watch the opponent's power gauge | Remote gauges should mirror the local one (fill toward the screen edge) | Opponent power bar filled left-to-right like the local player's, breaking the mirrored HUD convention | Right-align `.power-fill` via `margin-left: auto` and flip the value label to the left | Verified |
| BUG-006 | Low | Client / Rendering | Take damage near the left/right arena wall | Damage numbers and skill labels stay readable inside the arena | Floating text (e.g. "Phantom Shuriken") rendered partially or fully off-screen | Clamp floater x/y to the arena bounds after measuring the text width | Verified |
| BUG-007 | Low | Tests / Flakiness | Run `playwright test --project=mobile-android` | Touch-target assertions should tolerate device-pixel rounding | `expect(height).toBeGreaterThanOrEqual(44)` failed on `43.99999` | Round the measured bounding box before asserting | Verified |
| BUG-008 | High | Combat / Server Game Loop | Both players reach 0 HP on the exact same tick (e.g. mutual projectile hit or poison tick) | Server detects Double KO / Draw; awards no round win or marks draw | First player processed sets `game.phase = 'round_end'`; second player KO is ignored, wrongly awarding round to second player | Collect lethal damage across all players in the tick; call `endRound(game, null, 'double_ko')` if both reach 0 HP | Open |

### BUG-001 Details
- **Discovered**: Automated socket integration testing (`tests/integration/socketFlow.test.js`).
- **Impact**: Any malformed or null socket event from a client or attacker triggers server-side TypeError exceptions.
- **Fix**: Updated `withErrors` in `server/index.js` to normalize `payload` to `{}` if `null`/non-object, and guarded `socket.on('input')` against non-object payloads.
- **Verification**: Verified via `npm run test:integration` malformed payload test.

### BUG-002 Details
- **Discovered**: `node --check` syntax sweep over `client/` during the gameplay UI/UX pass.
- **Impact**: Total client breakage — `hud.js` failed to parse, so `main.js` (which imports it) never ran. No menu, no matchmaking, no game.
- **Fix**: Removed duplicated statements left behind after a `forEach` block in `buildSkillBar`; restored the intended `noskill` / cooldown-text updates inside the loop.
- **Verification**: `node --check` across all client modules plus a full Playwright bot-match screenshot run.

### BUG-003 Details
- **Discovered**: Manual settings walkthrough against the live game.
- **Impact**: Both accessibility settings were dead UI: volume changes were ignored (and audio master gain was hard-coded to 0.55) and "Reduce Motion" only dampened CSS animations while canvas screen-shake/flash continued at full strength.
- **Fix**: Settings now target `window.shadowClash`; `SoundEngine` persists and applies a volume; `Renderer` gained `reduceMotion` and zeroes shake/flash when enabled; the toggle defaults from the OS `prefers-reduced-motion` preference.
- **Verification**: Manual toggle during a live bot match; unit/integration/E2E suites all pass.

### BUG-004 Details
- **Discovered**: Playwright mobile-landscape screenshots at 844x390.
- **Impact**: Quick emote buttons sat on top of the S2/ULT touch buttons, blocking combat inputs.
- **Fix**: On coarse pointers the emote strip moves under the round timer with 44px targets; small fine-pointer windows (<700px) still hide it.
- **Verification**: Re-ran mobile screenshots — emote strip and touch clusters no longer intersect (verified via bounding boxes).

### BUG-005 / BUG-006 / BUG-007 Details
- Opponent power gauge now mirrors the local one and its value label moved to the leading edge.
- Floating combat text is clamped inside the 1280x720 arena after text measurement.
- Mobile touch-target assertions round bounding boxes to avoid DPR sub-pixel flakes.

### BUG-008 Details
- **Discovered**: Combat engine edge case audit during Phase 2 review.
- **Impact**: In a trade where both players receive lethal damage within the same 60Hz server tick (simultaneous projectile hit or mutual poison tick), `server/combat.js` triggers `endRound` immediately on the first dead player, setting `game.phase = 'round_end'`. When the loop checks the second player, `endRound` returns early due to the phase check, erroneously granting a round win to the player who died on the exact same tick instead of recording a Double KO.
- **Ownership**: Server combat logic (`/server/combat.js`, `/server/gameLoop.js`) is owned by Agent 1. Reported to Agent 1 for resolution.
