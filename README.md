# Shadow Clash

A complete, server-authoritative online 2D fighting game. The server runs the
60 Hz simulation and clients send only held inputs. The browser client provides
responsive Canvas rendering, prediction/reconciliation, opponent interpolation,
matchmaking, private invite rooms, spectators, rematches and reconnects.

- No login, database or build step: a guest profile is kept in the browser.
- Best of 3 rounds, 99 seconds per round, health and power gauges, KO/result screens.
- Characters are discovered from `characters/`; adding a valid folder needs no code changes.
- Reusable skill system with projectiles, dashes, teleports, buffs, shields, heals,
  grabs, debuffs, area attacks and cinematic ultimates.
- Keyboard, touch and Gamepad support.
- Synthesized WebAudio sound effects, with a persisted mute toggle.

## Quick start

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. The server binds to `0.0.0.0` and uses `PORT` when
set (default `3000`). On Windows, for example:

```powershell
$env:PORT=8080; npm start
```

`npm start` first scans `characters/` and generates placeholder art for any
missing sprites, portraits or skill icons, then starts Express and Socket.IO.
Generated images are ignored by git.

Other scripts:

| Command | Purpose |
| --- | --- |
| `npm start` | Generate missing assets, then run the server. |
| `npm run dev` | Same as start, with Node's `--watch` restart on server changes. |
| `npm run new-character <name>` | Scaffold a new playable hero in `characters/<name>/`. |
| `npm run generate-assets` | Generate missing art without starting the server. |
| `npm run generate-assets -- --force` | Regenerate all procedural art (overwrites PNGs). |

The server keeps rooms, ratings and profiles in memory. Restarting it clears
online state; browser profiles are re-adopted from local storage on the next
registration. There is no account system.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move left / right | `A` / `D` or left / right arrow | Left stick or D-pad |
| Jump | `W`, `Space` or up arrow | Left stick up or D-pad up |
| Crouch | `S` or down arrow | Left stick down or D-pad down |
| Light attack | `J` | A |
| Heavy attack | `K` | B |
| Block | `L` or `Shift` | LB or LT |
| Skill 1 | `U` | X |
| Skill 2 | `I` | Y |
| Skill 3 | `O` | RB |
| Ultimate | `P` | RT |

The on-screen joystick and buttons appear for touch pointers. Inputs from all
sources are merged into one object:

```js
{
  left, right, up, down,
  light, heavy, block,
  skill1, skill2, skill3, ult
}
```

Every field is a boolean. The client sends this object at about 30 Hz; the
server samples it at 60 Hz. Quick taps are latched briefly by the client and
newly-pressed buttons are buffered server-side for a few frames.

Quick emotes are available in the lobby and in-game: `GG`, `Nice!`, `Rematch?`,
`Good luck!`, `Well played!`, `Oops!`.

## Rules

- A match is best of three rounds. The first fighter to win two rounds wins.
- Each round lasts 99 seconds. If time expires, the fighter with more health wins;
  equal health is a draw for that round.
- Health is restored at the start of each round. Cooldowns and status effects reset.
- Power carries between rounds. It fills slowly over time and from dealing or
  taking damage. Skills spend their configured power cost.
- The ultimate requires 100 power and spends the whole gauge.
- Blocking reduces a blockable hit to 16% damage and builds a little power.
  Grabs and ultimates are unblockable.
- A KO or timeout ends the round. After a short round-end pause the next round
  starts, or the match result is shown after a second win.
- Leaving during a live match forfeits it to the opponent.

## Modes and match flow

### Random match

1. Select a fighter and choose **Random Match**.
2. The matchmaker runs once per second. New searches start with a rating window
   of +/-100, widening by 50 every 5 seconds.
3. A found match opens a 5-second accept window. Both players must accept.
4. Accepted players enter a character/ready lobby. Both ready up to start.
5. If no opponent is found after 30 seconds, the client offers **Fight a Bot**.
   The player can accept the CPU match or keep waiting.

Only one queue entry per identity is allowed. Declining or timing out an accept
requeues the other player when possible.

### Private room / invite friend

- **Invite Friend** creates a four-character room code.
- Share the URL (`/?room=CODE`) or give the code to the other player.
- The host can kick a guest in the lobby.
- Guests choose a fighter and ready up; the host can change fighters until ready.
- Open the invite link to join the lobby. Add `&spectate=1` or use **Spectate
  instead** in the Join dialog to watch.
- Private rooms return to the lobby after a match via **Back to Lobby**.
- A room expires after 10 minutes of inactivity. Empty rooms are cleaned up.

### Bot match

The bot uses the same input pipeline, cooldowns, hitboxes and power rules as a
human. It approaches, blocks projectiles, uses ranged skills, closes distance and
uses its ultimate when available. Bot matches update wins/losses but do not change
rating.

### Rematches

Both human players must request/accept a rematch within 30 seconds. The CPU
auto-accepts. A rematch creates a fresh match in the same room. In private rooms,
**Back to Lobby** also resets both ready states.

### Reconnect and spectators

A disconnected player's slot is held for 15 seconds. Reloading the page or
reconnecting with the same guest identity restores the live match, result screen
or lobby. The opponent sees a reconnect banner.

Spectators receive `gameStart` with `spectator: true` and live snapshots, but
cannot send gameplay inputs or request rematches. They see the same result cards
with a spectator-specific heading.

### Guest identity and multiple tabs

A guest `playerId` is created in `localStorage`. To make same-browser testing
possible, a tab-specific identity is kept in `sessionStorage` with a short local
lease. Three tabs therefore become three distinct players; reloading a tab keeps
its identity and can reconnect to its match. Clearing site storage creates a new
guest identity.

## Characters

### Auto-discovery and API

The server scans every directory under `characters/` at startup. A folder becomes
a hero when its `character.json` passes validation. Invalid heroes are skipped
with warnings in the server console; invalid optional fields are defaulted or
warned about. No client or server code changes are needed for a new hero.

Endpoints:

| Endpoint | Description |
| --- | --- |
| `GET /api/characters` | Public array of all valid heroes. |
| `GET /api/characters/:id` | One public hero, or 404. |
| `GET /api/health` | `{ ok, heroes, uptimeSeconds }`. |
| `GET /characters/:id/...` | Static sprite, portrait, icon and sound assets. |

The client fetches the roster and renders portraits, stats, moves and skills
automatically. A missing image falls back to vector/procedural rendering.

### Folder layout

```text
characters/
  flame/
    character.json
    skills.js            # optional custom skill overrides
    sprites/
      idle.png
      walk.png
      ...
    icons/
      portrait.png
      fireball.png
      ...
    sounds/              # optional
```

The folder name is the hero id. It may contain letters, numbers, `-` and `_`.
`character.json`'s `name` does not override the folder id; keeping them equal is
recommended.

### Create a hero in one command

```bash
npm run new-character my-hero
```

This creates a complete, playable template with four skills, a custom skill stub
and asset folders. Restart the server (or run `npm start`) and the hero appears
in the roster; missing PNGs are generated automatically.

To check the scaffold end-to-end:

```bash
npm run new-character test
npm start
# Open the game: "Test" should appear in Change Fighter and in /api/characters.
# Delete characters/test and restart to remove the test hero.
```

### `character.json` schema

Minimum accepted shape:

```json
{
  "displayName": "My Hero",
  "tagline": "Short description",
  "description": "Longer description shown in the roster.",
  "portrait": "icons/portrait.png",
  "theme": {
    "primary": "#22d3ee",
    "accent": "#a5f3fc",
    "glow": "rgba(34,211,238,0.55)"
  },
  "stats": {
    "maxHealth": 1000,
    "walkSpeed": 4.5,
    "jumpPower": 16.5,
    "weight": 1
  },
  "animations": {
    "idle": {
      "sprite": "sprites/idle.png",
      "frameWidth": 96,
      "frameHeight": 96,
      "frameCount": 6,
      "frameDuration": 110,
      "loop": true
    }
  },
  "moves": {
    "light": {
      "damage": 40,
      "startupFrames": 4,
      "activeFrames": 3,
      "recoveryFrames": 7,
      "hitbox": { "x": 24, "y": -126, "w": 64, "h": 42 },
      "knockback": 3.5,
      "hitstun": 12
    },
    "heavy": {
      "damage": 90,
      "startupFrames": 10,
      "activeFrames": 5,
      "recoveryFrames": 19,
      "hitbox": { "x": 28, "y": -136, "w": 82, "h": 62 },
      "knockback": 8,
      "hitstun": 23,
      "launch": 3
    }
  },
  "skills": []
}
```

Required: `stats`, `animations`, `moves.light`, `moves.heavy`, and a `skills`
array. Everything else is optional or defaulted. Missing animations use generated
defaults; missing sprites use vector fallback art. Skill slots are unique and
must be `S1`, `S2`, `S3` or `ULT`. A hero with fewer than four valid skills loads,
but the missing slots warn.

Coordinates are in a 1280x720 arena with the fighter's feet at `y = groundY`.
Hitboxes use character-relative coordinates; `x` extends in the facing
direction, `y` is negative upward. Animation sprites are horizontal frame
sheets.

### Character asset generation

`npm run generate-assets` scans every character with a `character.json` and
creates any missing PNGs:

- one sheet per animation, using the configured frame dimensions/count;
- the portrait and every skill icon;
- existing files are preserved unless `--force` is used.

The generated art is deterministic, dependency-free procedural pixel art. Replace
any PNG with your own art using the same dimensions. Generated PNGs under
`characters/*/sprites` and `characters/*/icons` are gitignored; the `.gitkeep`
files remain.

## Skills

Each entry in `skills` supports:

```json
{
  "id": "fireball",
  "slot": "S1",
  "displayName": "Fire Ball",
  "description": "Hurl a burning orb.",
  "icon": "icons/fireball.png",
  "type": "projectile",
  "cooldown": 3,
  "powerCost": 0,
  "damage": 95,
  "startupFrames": 10,
  "recoveryFrames": 18,
  "params": {},
  "effects": [],
  "animation": "special1",
  "sound": ""
}
```

- `cooldown` is in seconds; all cooldowns reset at round start.
- `powerCost` is spent on cast. The ultimate ignores this value and always requires
  100 power.
- `startupFrames` is the delay before the effect executes; `recoveryFrames` is the
  lockout afterwards. The action is uninterruptible except by hit-stun/KO.
- `effects` is a list of status effects applied on hit (see below).
- `animation` names the animation to display; `ult` and `special1`-`special3` are
  conventional but not mandatory.
- `sound` is an optional asset path. Skills without sounds use synthesized audio.

### Built-in skill types

| `type` | Behavior | Important `params` |
| --- | --- | --- |
| `projectile` | Spawns a moving hitbox. | `speed`, `lifetime`, `width`, `height`, `hitHeight`, `spawnOffset`, `verticalSpeed`, `pierce`, `shape`, `color`, `secondary`, `knockback`, `hitstun`, `launch` |
| `dash_attack` | Moves the caster forward with a hitbox and i-frames. | `speed`, `frames`, `hitbox`, `invulnFrames`, `knockback`, `hitstun`, `launch` |
| `teleport` | Repositions behind/in front of the target. | `to: "behind" or "front"`, `distance`, `invulnFrames`, `damage` |
| `buff` | Self damage/speed buff, optionally heals. | `duration`, `damageMultiplier`, `speedMultiplier`, `heal` |
| `shield` | Temporary damage-absorbing shield. | `amount`, `duration` |
| `heal` | Instant self heal. | `amount` |
| `area_attack` | Radial hit around the caster. | `radius`, `verticalRange`, `launch`, `knockback`, `hitstun` |
| `grab` | Short-range, unblockable grab with stagger. | `range`, `holdDistance`, `stun`, `hitstun` |
| `debuff` | Applies effects at range, with optional instant damage. | `range`, `verticalRange`, `effect`, `duration`, `damagePerSecond`, `knockback`, `hitstun` |
| `ultimate` | Freezes the fight for a cinematic and deals one large hit. | `cinematicFrames`, `damageAt`, `launch`, `teleportBehind` |

Unknown types are skipped at load unless a custom `skills.js` implementation
exists for that skill id.

### Status effects

Effects are applied by skills and projectile hits:

```json
{ "type": "burn", "duration": 3, "damagePerSecond": 6 }
{ "type": "poison", "duration": 5, "damagePerSecond": 8 }
{ "type": "slow", "duration": 3, "magnitude": 0.25 }
{ "type": "stun", "duration": 1.2 }
{ "type": "buff", "duration": 6, "damageMultiplier": 1.2, "speedMultiplier": 1.15 }
```

Burn and poison tick once per second. Slow reduces movement speed. Stun cancels
the target's action. Buffs stack their multipliers. Statuses appear as HUD icons
and reset on round start.

### Custom skill logic

Put a `skills.js` in the hero folder. It can export the skill map directly or
under a `skills` key. Custom implementations take priority over the built-in type
for that id.

```js
'use strict';

module.exports = {
  my_hero_orb: {
    execute(caster, target, room, skill, ctx) {
      ctx.spawnProjectile({
        ownerId: caster.id,
        skillId: skill.id,
        skillName: skill.displayName,
        x: caster.x + caster.facing * 60,
        y: caster.y - 100,
        vx: caster.facing * 12,
        vy: 0,
        w: 48,
        h: 36,
        damage: skill.damage,
        color: caster.hero.theme.primary,
        effects: skill.effects
      });
      ctx.addEvent('customCast', { playerId: caster.id, skillId: skill.id });
    }
  },

  my_hero_burst: {
    execute(caster, target, room, skill, ctx) {
      if (!target) return;
      ctx.applyDamage(caster, target, skill.damage, {
        knockback: 10,
        hitstun: 24,
        launch: 8,
        skillId: skill.id,
        label: skill.displayName
      });
      ctx.applyEffects(target, [
        { type: 'burn', duration: 3, damagePerSecond: 5 }
      ], caster.id);
    }
  }
};
```

Available context helpers:

| Helper | Purpose |
| --- | --- |
| `ctx.game` | The authoritative game state for that room. |
| `ctx.addEvent(type, payload)` | Add a visual/audio event to the next snapshot. |
| `ctx.applyDamage(caster, target, amount, opts)` | Central damage resolver; handles block/shield/KO/power. |
| `ctx.applyEffects(target, effects, sourceId)` | Apply burn/poison/slow/stun/buff. |
| `ctx.grantShield(target, amount, seconds)` | Temporary shield. |
| `ctx.heal(target, amount)` | Heal capped at max health. |
| `ctx.spawnProjectile(config)` | Create a simulated projectile. |

Keep custom logic deterministic and tick-based. Do not mutate timers or schedule
work outside the game loop. Cooldowns, power, hit-stun and casting state are
validated before a custom skill runs.

### Ultimate checklist

- Give the hero an entry in the `ULT` slot with a full power cost (the server
  requires 100 power regardless of the configured cost).
- Set `type: "ultimate"` and tune `cinematicFrames` and `damageAt`.
- Use `teleportBehind: true` for an assassin-style vanish.
- The cinematic freezes players and projectiles until it finishes; damage is
  unblockable and ignores invulnerability at the configured frame.
- The client renders the letterbox, title, flash and screen shake from snapshot
  `cinematic` data.

## Architecture

```text
server/
  index.js            Express, Socket.IO, API, rate limits, 60 Hz loop
  gameLoop.js         Authoritative simulation, input buffer, rounds, snapshots
  combat.js           Damage, shields, hitboxes, statuses, round end
  playerRegistry.js   Guest identities, profiles, online status
  characterLoader.js  Folder scan, validation, public hero serialization
  roomManager.js      Lobbies, match lifecycle, rematch, reconnect, cleanup
  matchmaker.js       Queue, accept window, rating widening, bot offer
  bot.js              CPU input AI
  skills/             Reusable skill type implementations
client/
  index.html          Screen/DOM contract
  styles.css          Responsive theme, HUD, touch controls
  main.js             App state machine, routing, prediction loop, result UI
  renderer.js         Canvas renderer, sprites, effects, procedural fighters
  input.js            Keyboard + Gamepad + touch input merger
  network.js          Socket.IO wrapper, latency/jitter probe
  ui/                 Menu, character select, matchmaking, lobby, HUD
scripts/
  generateAssets.js   Dependency-free procedural PNG generation
  newCharacter.js     Character scaffold CLI
characters/           Auto-discovered hero folders
```

The server runs one fixed 60 Hz simulation step per 16.67 ms (up to five catch-up
steps after a stall). Snapshots are emitted at 30 Hz. Clients hold a local
prediction for their own fighter and reconcile toward authoritative snapshots;
opponents are interpolated around 85 ms behind the latest snapshot. The only
gameplay message a client can send is input state, and the server owns health,
positions, hit detection, cooldowns, rounds and results.

The loop is single-process and in-memory. Run one Node instance per game world;
do not use multiple processes behind a load balancer without shared state and
Socket.IO sticky sessions/adapters. Rate limits protect queue and room actions
(5 requests per 10 seconds for queue/room creation; 10 per 10 seconds for
join/nickname/spectate-style actions).

## Socket.IO event reference

All events are Socket.IO events. Unless stated otherwise, the server broadcasts
room events to the room channel and player-specific events to the player's socket.

### Client to server

| Event | Payload | Description |
| --- | --- | --- |
| `setNickname` | `{ nickname, playerId?, heroId?, profile? }` | Register or restore a guest. `profile` may contain persisted rating/wins/losses. Emits `nicknameSet`; triggers room reconnect when applicable. |
| `queueJoin` | none | Join random matchmaking. May emit `queueStatus.error`. |
| `queueCancel` | none | Leave the queue and any pending accept. |
| `matchAccept` | none | Accept the current match-found offer. |
| `matchDecline` | none | Decline the offer; the opponent may be requeued. |
| `queueBot` | none | Start a CPU match. Normally sent after the 30-second `botOffer`; must be queued. |
| `roomCreate` | none | Create a private room and become host. |
| `roomJoin` | `{ code, spectate? }` | Join a private room or watch as a spectator. |
| `roomLeave` | none | Leave the room. Leaving a live match forfeits it. |
| `roomReady` | `{ ready, heroId? }` | Set ready state and optionally select a hero. Both ready starts the match. |
| `roomKick` | `{ playerId }` | Host-only kick in the lobby. |
| `chooseHero` | `{ heroId }` | Change hero in the menu or lobby. Not allowed during a match. |
| `rematchRequest` | `{ accept: boolean }` | Request/accept a rematch, or cancel the local vote with `accept: false`. |
| `returnToLobby` | none | Return a private room to its lobby after a result. |
| `input` | `{ input: { left, right, up, down, light, heavy, block, skill1, skill2, skill3, ult } }` | Held input state, about 30 Hz. Ignored outside a live match. |
| `emote` | `{ text }` | One of the six allowed quick emotes. |
| `ping` | `{ t }` | Application latency probe; server replies with `pong`. |
| `requestSnapshot` | none | Ask for the current snapshot (used after missed lobby/game transitions). |

Unregistered actions receive `roomError` with code `NOT_REGISTERED`. Validation,
state and rate-limit failures also use `roomError` (or `queueStatus.error` for
queue actions) with a human-readable message.

### Server to client

| Event | Payload | Description |
| --- | --- | --- |
| `presence` | `{ online, searching, rooms, heroes }` | Online/searching counts and active match count; sent on connect and periodically. |
| `nicknameSet` | `{ playerId, nickname, rating, wins, losses, heroId, status, online }` | Confirms registration and returns the public profile. |
| `queueStatus` | `{ status: "searching", elapsed, since, rating, range, waiting, online }` or `{ status: "idle" }` or `{ status: "error", code, message }` | Search progress and range. |
| `matchFound` | `{ roomCode, opponent: { playerId, nickname, rating }, acceptWindow, deadline }` | A random opponent was found; show the accept dialog. |
| `matchAcceptStatus` | `{ playerId, accepted, acceptedCount }` or `{ accepted: true, both: true }` | The other player accepted, or both accepted. |
| `matchCancelled` | `{ reason, by?, roomCode, requeued }` | Accept failed/declined/timed out. `requeued` tells the client to return to search. |
| `botOffer` | `{ waitSeconds, message }` | No human was found after 30 seconds; offer a CPU match. |
| `roomUpdate` | room object (see below) | Lobby/room state changes, including result-room updates. |
| `gameStart` | `{ roomCode, mode, spectator, room, players, state }` | Enter the game. `state` is an initial snapshot. `mode` is `private`, `random` or `bot`. |
| `snapshot` | snapshot object (see below) | Authoritative state at 30 Hz plus event effects. |
| `matchEnd` | `{ roomCode, winnerId, loserId, winnerName, loserName, reason, score, roundWins, ratings, profiles, endedAt, room }` | Final result. `reason` is `ko`, `timeout`, `forfeit` or `disconnect`. `ratings` contains before/after/delta per human. |
| `rematchUpdate` | `{ votes, starting?, expired?, cancelled?, deadline? }` | Rematch votes and lifecycle. `starting: true` is followed by a fresh `gameStart`. |
| `opponentLeft` | `{ playerId, nickname, forfeit, reconnectIn?, left? }` | Opponent disconnected or left. During a match `reconnectIn` is the grace period. |
| `opponentReconnected` | `{ playerId, nickname }` | Opponent restored their slot. |
| `roomError` | `{ code, message }` | Action failed. Common codes include `ROOM_FULL`, `ROOM_NOT_FOUND`, `MATCH_STARTED`, `ALREADY_IN_ROOM`, `NOT_HOST`, `KICKED`, `ROOM_CLOSED`, `ROOM_EXPIRED`, `RATE_LIMITED`, `UNKNOWN_HERO`, `NO_CHARACTERS`, `NOT_IN_RESULT`, `NOT_PRIVATE`, `SERVER_ERROR`. |
| `roomLeft` | none | Acknowledges an explicit `roomLeave`. |
| `emote` | `{ playerId, nickname, text }` | Broadcast quick emote. |
| `pong` | `{ t, serverTime }` | Reply to `ping`; the client computes RTT/jitter. |

### Room object

```json
{
  "code": "ABCD",
  "mode": "private",
  "state": "lobby",
  "hostId": "guest_...",
  "createdAt": 0,
  "expiresAt": 0,
  "players": [
    {
      "playerId": "guest_...",
      "nickname": "Fighter",
      "heroId": "flame",
      "hero": { "...": "public hero object" },
      "ready": false,
      "disconnected": false,
      "isBot": false,
      "isHost": true,
      "rating": 1000
    }
  ],
  "spectators": 0,
  "rematchVotes": [],
  "acceptDeadline": 0,
  "matchResult": null
}
```

`state` is `accepting`, `lobby`, `playing`, `result` or `closed`. `matchResult`
is present after a match and contains a compact winner/loser/score/reason summary.
`expiresAt` is based on 10 minutes of room inactivity.

### Snapshot object

Key fields:

```json
{
  "roomCode": "ABCD",
  "tick": 1234,
  "tickRate": 60,
  "phase": "playing",
  "round": 1,
  "timeLeft": 5940,
  "timer": 99,
  "countdown": 0,
  "roundEndTimer": 0,
  "roundWins": { "guest_a": 0, "guest_b": 0 },
  "players": [
    {
      "id": "guest_a",
      "nickname": "A",
      "heroId": "flame",
      "x": 390, "y": 620, "vx": 0, "vy": 0,
      "facing": 1,
      "health": 1000, "maxHealth": 1000,
      "power": 0, "wins": 0,
      "state": "idle", "anim": "idle",
      "blocking": false, "crouching": false, "grounded": true,
      "cooldowns": { "S1": 0, "S2": 0, "S3": 0, "ULT": 0 },
      "statuses": [],
      "shield": null,
      "action": null,
      "connected": true
    }
  ],
  "projectiles": [],
  "cinematic": null,
  "winnerId": null,
  "loserId": null,
  "matchEnded": false,
  "events": [],
  "arena": { "width": 1280, "height": 720, "groundY": 620 }
}
```

`phase` is `countdown`, `playing`, `round_end` or `match_end`. `events` contains
short-lived render/audio events (`hit`, `ko`, `projectileSpawn`, `ultimateHit`,
`roundEnd`, `matchEnd`, etc.) with monotonically increasing ids so clients can
avoid replaying effects. `action` identifies the current attack/skill for
animation; `cinematic` drives the ultimate overlay.

## Deployment

### Requirements and constraints

- Node.js 18+ with a long-running process; WebSocket upgrades must be allowed.
- One server instance. Room and match state is in memory, so horizontal scaling
  needs a shared Socket.IO adapter/room store and sticky sessions, which this
  project intentionally does not include.
- No external database, object storage or prebuilt assets are required.
- Use a health check on `/api/health` if your platform supports one.

### Generic VPS / managed Node host

```bash
git clone <your-repository> shadow-clash
cd shadow-clash
npm ci --omit=dev
PORT=3000 npm start
```

Run it under a process manager (systemd, PM2, the host's process runner) so it
restarts after crashes/reboots. Ensure the process can write generated PNGs under
`characters/` on first start, or run `npm run generate-assets` during deploy.

### Nginx reverse proxy

Socket.IO needs HTTP and WebSocket upgrade headers:

```nginx
server {
  listen 80;
  server_name fight.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }
}
```

Terminate TLS at the proxy and open the HTTPS URL. The client derives invite links
from `window.location.origin`, so the deployed origin is automatically used.

### ngrok (quick internet playtest)

With the server running locally on port 3000:

```bash
ngrok http 3000
```

Open the generated `https://...ngrok-free.app` URL on each device. Invite links
will use the ngrok origin automatically. ngrok forwards WebSocket upgrades, so
matchmaking and live inputs work through the tunnel. Free tunnels can change URL
after a restart, which invalidates previously copied invite links. Keep the
tunnel and local server alive for the duration of a test.

### LAN play

Bind the server to `0.0.0.0` (default), allow port 3000 through the host firewall
and open `http://<host-lan-ip>:3000` on other devices. Do not use `localhost` in
links shared with another machine.

## Manual acceptance checklist

1. Start clean with `npm install && npm start`; open three tabs.
2. Register in each tab. Confirm three distinct player ids in the profile UI.
3. Tab A: **Invite Friend**. Tabs B/C open the invite URL. B joins as a fighter,
   C opens with `?room=CODE&spectate=1`.
4. Change fighters, ready in A and B, and confirm all three enter the countdown.
5. Use keyboard attacks/skills/ULT and verify the HUD, cooldowns, power and ping.
6. Reload B mid-match; confirm it reconnects into the same match within 15s.
7. Play (or automate) two KOs; confirm round pips, round transitions, result title,
   score, ratings and both result cards.
8. Request a rematch on both human clients; confirm a fresh match starts.
9. In a private room, finish a match and use **Back to Lobby**.
10. Queue alone for 30s and use **Fight a Bot**; finish and rematch against the CPU.
11. Run `npm run new-character test`, restart, and confirm **Test** appears in the
    roster and `/api/characters`. Remove `characters/test` and restart when done.
12. Check the browser console and server log for errors or failed asset requests.

## Troubleshooting

- **No heroes / "No characters found"** — every hero needs a valid
  `character.json` with `stats`, `animations`, `moves.light`, `moves.heavy` and a
  `skills` array. Check server warnings, then restart. Run `npm run generate-assets`
  if images are missing.
- **Port already in use** — stop the old process or set `PORT` to another value.
- **Stuck on connecting / no live updates** — the reverse proxy or tunnel is not
  forwarding WebSocket upgrades. Use the Nginx headers above or test directly on
  port 3000.
- **Invite link opens the menu** — the room may have expired (10 minutes idle), the
  code may be wrong, or the link points to a different origin/tunnel URL.
- **Refreshing a second tab reconnects the first** — the tab-specific session
  identity has been replaced by a direct localStorage reset or a copied session.
  Clear site data or use a new tab normally.
- **Assets look stale after replacing art** — hard-refresh the browser (static
  files are cached for an hour).
- **Profiles reset after a server restart** — expected: rooms, ratings and online
  status are in memory. The browser re-adopts its cached profile on the next
  registration.
- **One browser cannot join twice** — same tabs intentionally use distinct guest
  identities via `sessionStorage`; use another browser/profile if you need a fully
  separate local storage scope.

## Design notes and limits

- The server is authoritative; clients cannot set positions, health, cooldowns or
  results.
- No login, match history database, ranked seasons, friend lists or persistent
  accounts are included.
- Voice chat, replays and audio asset packs are out of scope. SFX are synthesized
  in the browser with WebAudio and can be muted.
- Character art in the repository is procedurally generated placeholder art; replace
  it with your own PNG sheets without changing code.
- The game is tuned for two fighters per room and one room per player. Spectators
  are read-only and do not count toward the two player slots.
