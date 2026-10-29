# UX Review & UI Design Audit

This document tracks UI/UX issues, mobile ergonomics, accessibility, visual design improvements, and before/after comparisons for Shadow Clash.

## Design System Overview
- **Aesthetic**: Bold arcade fighting game, high contrast, vibrant accents, dark/clean battle backdrop, readable typography.
- **Variables**: Standardized colors, spacing, borders, shadows, glow effects, touch target sizes.
- **Responsive Target**: Mobile landscape (360x640, 390x844), desktop (1920x1080), tablet.

## Gameplay UI/UX Pass — 2026-10-29 (Agent 2)

Implemented and verified with live Playwright bot-match screenshots (desktop 1280x720, mobile 844x390 and 640x360):

### Fixed (see BUGS.md BUG-002…BUG-006)
- **Client boot**: `hud.js` syntax error broke the entire client; game now runs.
- **Settings actually apply**: volume + reduce-motion now reach the audio engine and the canvas renderer; reduce-motion defaults from the OS preference and disables camera shake and hit flashes.
- **Mobile emote collision**: in-game emote strip no longer overlaps the touch action cluster; buttons enlarged to 44px targets.
- **Mirrored opponent power gauge** and clamped off-screen damage/skill floaters.

### HUD & Feedback improvements
- **Low-health danger vignette**: pulsing red edge glow when your fighter drops to ≤25% HP (hidden for spectators, suppressed between rounds).
- **Ultimate-ready power gauge**: the power bar glows violet and pulses when it hits 100.
- **Unaffordable skills dim**: skill slots and touch buttons desaturate while power is short, so it is obvious why an ability fails; the existing "not enough power" shake remains.
- **Combo counter**: repositioned to 40% height (clear of the Leave button on every viewport) and gains a bump animation on every additional hit.
- **Ping indicator**: colored dot + 60ms/150ms quality thresholds with a hover tooltip.
- **Layout**: Leave button moved to the bottom-left on desktop and under the right HUD on touch so it never overlaps HUD rows, pips, or combos.
- **Colorblind mode**: health bars now distinguish fighters by hue (you = blue, opponent = amber, distinct low-HP variants) instead of painting both bars the same cyan.
- **Accessibility**: round announcements (`FIGHT!`, `K.O.`) are announced via `aria-live`; skill slots and touch skill buttons expose skill names through `aria-label`/`title`.
- Fixed duplicate `pointerdown` listeners re-bound on every rematch with a stale hero reference.

## Floating Joystick Redesign — 2026-10-29 (Agent 2)

Replaced the fixed joystick with a **floating joystick**, the standard for mobile fighters:

- **Thumb-anchored**: touching anywhere in the lower-left 46% × 62% of the arena spawns the joystick centered on the thumb (clamped so the ring stays inside the zone). No more reaching for a fixed ring.
- **Rest hint**: when idle, a faint joystick with a MOVE label rests at the bottom-left so the control is discoverable; it fades out while active.
- **Direction feedback**: four cardinal arrows on the ring light up gold (with a glow) as the movement threshold for that direction is crossed, making the dead zones visible.
- **Spring-back**: on release the knob and ring animate back to the rest position; the MOVE label reappears.
- **Refined visuals**: layered ring (soft outer + dashed inner), glossy gold knob with an active glow, full opacity when held, 40% when idle.
- **Robustness**: single-pointer tracking (second finger ignored), pointer capture so drags leaving the zone still track, release/blur fully clears inputs (no stuck movement), and the touch-scale/opacity settings still apply.
- Verified via scripted touch drag: recentering, `dir-*` classes, `input.left/right/up` truthiness, 44px travel clamp, and clean release — plus all unit/integration/mobile E2E suites.

## Screen-by-Screen UX Audit & Action Items

### 1. Main Menu & Nickname Prompt
- Current: Minimalist placeholder.
- Improvements: Bold arcade logo, animated backdrop/glow, clear nickname validation with instant feedback, responsive menu buttons with sound/focus states.

### 2. Character Select Screen
- Current: Basic character listing.
- Improvements: Interactive fighter grid, animated stat bars (Speed, Power, Defense, Range), skill preview tooltips/icons on hover or tap, portrait highlights, locked ready state indication.

### 3. Lobby & Room Management
- Current: Simple room code input and buttons.
- Improvements: One-click "Copy Room Link" with toast feedback, clear P1 / P2 slots with ready status badges, player ping indicators, kick/leave buttons.

### 4. Matchmaking Screen
- Current: Text display of queue.
- Improvements: Pulse/radar animation, elapsed matchmaking timer, instant "Match Found!" countdown modal, cancel queue button.

### 5. Combat HUD & Feedback
- Current: Canvas or basic DOM overlay.
- Improvements:
  - Ergonomic health bars with animated damage lag ("red drain")
  - Power gauge with max-ready glow and "Not Enough Power" shake effect
  - Cooldown timers with numeric countdown overlays on skill buttons
  - Combo counter with scaling animations
  - Screen shake and hit flash on heavy/ultimate impacts
  - Connection quality indicator (Green <60ms, Yellow 60-150ms, Red >150ms)

### 6. Mobile Touch Controls
- Current: Need comprehensive touch overlay.
- Improvements:
  - Virtual floating/fixed joystick on left thumb
  - Action button cluster on right thumb (Light, Heavy, Block, Skill 1, Skill 2, Ult)
  - Minimum 44x44px touch targets (recommended 56px+)
  - Prevent viewport bounce, scroll, pull-to-refresh
  - Landscape orientation prompt if portrait
  - Haptic feedback via `navigator.vibrate` on hits/presses

### 7. Results & Rematch Screen
- Current: Basic text result.
- Improvements: Dramatic "VICTORY / DEFEAT" screen, match statistics, Rematch (1/2, 2/2 ready) button, Return to Menu button.

### 8. Accessibility & Settings Modal
- Current: None.
- Improvements:
  - Settings dialog: Sound FX & Music sliders
  - Reduce screen shake & flashing toggle
  - Keybinding guide & rebinding options
  - High contrast and color-blind safe HP bar options

