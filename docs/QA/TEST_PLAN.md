# Master Test Plan

This document details the test strategy, scope, automated test suites, and manual exploratory testing procedures for each phase of Shadow Clash.

## Test Strategy Matrix

| Test Layer | Tools | Scope | Target Frequency |
|---|---|---|---|
| **Unit Tests** | Vitest | Character Loader, Cooldowns, Power Gauge, Damage/Combat Math, Matchmaker Elo/widening, Room Code Generation, Rate Limiter | Pre-commit / CI |
| **Integration Tests** | Vitest + `socket.io-client` | Bot client flows, Room lifecycles, Reconnection grace window (15s timeout), Rematch negotiation, Malformed packets | Pre-commit / CI |
| **E2E UI Tests** | Playwright | Full 2-player match flows, Invite links across tabs, Mobile touch viewports (360x640, 390x844), Rematch | Nightly / Release |
| **Load Tests** | Node.js + WebSocket Bot Swarm | 50-100 concurrent clients, server tick rate (<16ms), memory leak checks over duration | Release Milestone |

## Phase Testing Checklist

- [x] **Phase 1: Server / Rooms / Registry**
  - [x] Connect & disconnect handling
  - [x] Duplicate nickname handling & sanitization
  - [x] Rate limiting & invalid payload rejection
  - [x] Room code uniqueness and collisions
- [x] **Phase 2: Game Loop / Combat Engine**
  - [x] Damage calculation, defense/block mitigation
  - [x] Hit-stun and knockback frames
  - [x] Round timer countdown & round transitions
  - [x] KO edge cases: timeout with equal health handled; simultaneous Double KO identified and logged as BUG-008
- [x] **Phase 3: Rendering & HUD**
  - [x] Health bar display & smoothing
  - [x] Timer, round counters, score display
  - [x] Ping & connection quality indicator (green/yellow/red dot with tooltip)
  - [x] Canvas scaling, high-DPI (Retina) sharpness
- [x] **Phase 4: Input Subsystem**
  - [x] Keyboard input handling (no stuck keys on blur)
  - [x] Gamepad detection & polling
  - [x] Virtual floating joystick & mobile touch cluster (>=44x44px targets)
  - [x] Unified input packet payload format
- [x] **Phase 5: Character Loading & Extensibility**
  - [x] JSON schema validation for character definitions
  - [x] Missing sprite / asset fallback handling
  - [x] `npm run new-character` CLI generation check verified
- [x] **Phase 6: Skills & Status Effects**
  - [x] Cooldown enforcement & spam prevention
  - [x] Power gauge accumulation (capped at 100)
  - [x] Status effects: burning, poison, freeze/slow, buffs
  - [x] Projectiles lifecycle and boundary cleanup
  - [x] Ultimate abilities execution & resource consumption
- [x] **Phase 7: Matchmaking & Social Flows**
  - [x] Elo-based pairing and window expansion (+50 every 5s)
  - [x] Match accept / decline race conditions with countdown ring
  - [x] Room invite link parsing & direct joining across tabs
  - [x] Disconnect & 15-second reconnect handling
  - [x] Rematch flow between both players

