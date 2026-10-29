'use strict';

/**
 * Authoritative 60 Hz game simulation.
 *
 * The server owns health, positions, attacks, skills, projectiles and rounds.
 * Clients only send held inputs; the room's game state is advanced in tickRoom()
 * and snapshotted for rendering.
 */

const {
  ARENA,
  PHYSICS,
  overlaps,
  hurtbox,
  worldHitbox,
  otherPlayer,
  clamp,
  modifiers,
  hasStatus,
  addEvent,
  applyEffects,
  grantShield,
  heal,
  applyDamage,
  endRound,
  tickStatuses
} = require('./combat');
const { executeSkill, get: getSkillType } = require('./skills');
const { updateBotInput } = require('./bot');

const INPUT_KEYS = [
  'left', 'right', 'up', 'down', 'light', 'heavy', 'block',
  'skill1', 'skill2', 'skill3', 'ult'
];
const PRESS_KEYS = ['up', 'light', 'heavy', 'skill1', 'skill2', 'skill3', 'ult'];
const SLOT_FOR_KEY = { skill1: 'S1', skill2: 'S2', skill3: 'S3', ult: 'ULT' };
const PRESS_BUFFER_TICKS = 12;
const ROUND_SECONDS = 99;
const ROUND_COUNTDOWN = 180; // 3 seconds
const ROUND_END_TICKS = 190;
const POWER_PER_SECOND = 0.5;

function emptyInput() {
  const input = {};
  for (const key of INPUT_KEYS) input[key] = false;
  return input;
}

function sanitizeInput(raw) {
  const input = emptyInput();
  if (!raw || typeof raw !== 'object') return input;
  for (const key of INPUT_KEYS) input[key] = raw[key] === true;
  return input;
}

function createPlayer(roomPlayer, index) {
  const hero = roomPlayer.hero;
  const stats = hero.stats;
  const spawnX = index === 0 ? 390 : 890;
  return {
    id: roomPlayer.playerId,
    nickname: roomPlayer.nickname,
    heroId: hero.id,
    hero,
    isBot: !!roomPlayer.isBot,
    stats,
    spawnX,
    x: spawnX,
    y: ARENA.groundY,
    vx: 0,
    vy: 0,
    facing: index === 0 ? 1 : -1,
    grounded: true,
    health: stats.maxHealth,
    maxHealth: stats.maxHealth,
    power: 0,
    state: 'idle',
    anim: 'idle',
    walking: false,
    blocking: false,
    crouching: false,
    action: null,
    hitstun: 0,
    blockstun: 0,
    invuln: 30,
    statuses: [],
    shield: null,
    cooldowns: { S1: 0, S2: 0, S3: 0, ULT: 0 },
    combo: 0,
    comboTimer: 0,
    input: emptyInput(),
    lastRawInput: emptyInput(),
    pressBuffer: [],
    lastLandTick: 0,
    connected: true
  };
}

function createGameState(room) {
  const roomPlayers = [...room.players.values()].slice(0, 2);
  const game = {
    roomCode: room.code,
    tick: 0,
    phase: 'countdown',
    countdown: ROUND_COUNTDOWN,
    round: 1,
    timeLeft: ROUND_SECONDS * ARENA.tickRate,
    players: roomPlayers.map((rp, index) => createPlayer(rp, index)),
    roundWins: {},
    roundEnded: false,
    roundEndTimer: 0,
    roundEndReason: null,
    roundWinnerId: null,
    events: [],
    eventSeq: 0,
    projectiles: [],
    cinematic: null,
    winnerId: null,
    loserId: null,
    matchEnded: false,
    nextEntityId: 1
  };
  for (const player of game.players) game.roundWins[player.id] = 0;
  resetRound(game, false);
  addEvent(game, 'roundStart', { round: 1 });
  return game;
}

/** Reset positions, health, statuses and cooldowns. Power intentionally carries. */
function resetRound(game, announce = true) {
  const alive = game.players;
  for (const player of alive) {
    player.x = player.spawnX;
    player.y = ARENA.groundY;
    player.vx = 0;
    player.vy = 0;
    player.grounded = true;
    player.facing = game.players[0] === player ? 1 : -1;
    player.health = player.maxHealth;
    player.state = 'idle';
    player.anim = 'idle';
    player.walking = false;
    player.blocking = false;
    player.crouching = false;
    player.action = null;
    player.hitstun = 0;
    player.blockstun = 0;
    player.invuln = 30;
    player.statuses = [];
    player.shield = null;
    player.cooldowns = { S1: 0, S2: 0, S3: 0, ULT: 0 };
    player.combo = 0;
    player.comboTimer = 0;
    player.input = emptyInput();
    player.lastRawInput = emptyInput();
    player.pressBuffer = [];
  }
  game.timeLeft = ROUND_SECONDS * ARENA.tickRate;
  game.phase = 'countdown';
  game.countdown = ROUND_COUNTDOWN;
  game.roundEnded = false;
  game.roundEndTimer = 0;
  game.roundEndReason = null;
  game.roundWinnerId = null;
  game.projectiles = [];
  game.cinematic = null;
  if (announce) addEvent(game, 'roundStart', { round: game.round });
}

/** Inject an input snapshot and convert newly-pressed buttons into buffered actions. */
function receiveInput(game, playerId, rawInput) {
  if (!game) return;
  const player = game.players.find((p) => p.id === playerId);
  if (!player || player.isBot) return;
  const next = sanitizeInput(rawInput);
  const previous = player.lastRawInput;

  for (const action of PRESS_KEYS) {
    if (next[action] && !previous[action]) {
      // Replace an older press of the same button so mashing cannot queue a
      // second special after a long recovery window.
      player.pressBuffer = player.pressBuffer.filter((entry) => entry.action !== action);
      player.pressBuffer.push({ action, tick: game.tick });
      if (player.pressBuffer.length > 16) player.pressBuffer.shift();
    }
  }

  player.lastRawInput = { ...next };
  player.input = next;
}

function setAnimState(player) {
  if (player.health <= 0) {
    player.state = 'ko';
    player.anim = 'ko';
    return;
  }
  if (player.hitstun > 0 || hasStatus(player, 'stun')) {
    player.state = 'hitstun';
    player.anim = 'hit';
    return;
  }
  if (player.blockstun > 0) {
    player.state = 'block';
    player.anim = 'block';
    return;
  }
  if (player.action) {
    player.state = player.action.kind === 'attack' ? 'attack' : 'skill';
    player.anim = player.action.kind === 'attack'
      ? player.action.moveKey
      : (player.action.skill.animation || `special${player.action.slot === 'ULT' ? '3' : player.action.slot.slice(1)}`);
    return;
  }
  if (player.blocking) {
    player.state = 'block';
    player.anim = 'block';
    return;
  }
  if (player.crouching && player.grounded) {
    player.state = 'crouch';
    player.anim = 'crouch';
    return;
  }
  if (!player.grounded) {
    player.state = 'jump';
    player.anim = 'jump';
    return;
  }
  if (player.walking) {
    player.state = 'walk';
    player.anim = 'walk';
    return;
  }
  player.state = 'idle';
  player.anim = 'idle';
}

function pushApart(game) {
  const [a, b] = game.players;
  if (!a || !b || a.health <= 0 || b.health <= 0) return;
  if (Math.abs(a.y - b.y) > 130) return;
  const distance = Math.abs(a.x - b.x);
  if (distance >= PHYSICS.pushRadius) return;
  const overlap = PHYSICS.pushRadius - distance;
  const dir = a.x <= b.x ? -1 : 1;
  a.x = clamp(a.x + (dir * overlap) / 2, ARENA.leftBound, ARENA.rightBound);
  b.x = clamp(b.x - (dir * overlap) / 2, ARENA.leftBound, ARENA.rightBound);
}

function applyPhysics(game, player) {
  if (player.grounded) {
    player.y = ARENA.groundY;
    player.vy = 0;
    player.x += player.vx;
    player.vx *= PHYSICS.groundFriction;
    if (Math.abs(player.vx) < 0.06) player.vx = 0;
  } else {
    player.vy += PHYSICS.gravity;
    player.x += player.vx;
    player.y += player.vy;
    if (player.y >= ARENA.groundY) {
      player.y = ARENA.groundY;
      player.vy = 0;
      player.grounded = true;
      player.lastLandTick = game.tick;
      addEvent(game, 'land', { playerId: player.id, x: player.x, y: player.y });
    }
  }
  player.x = clamp(player.x, ARENA.leftBound, ARENA.rightBound);
}

function isStunned(player) {
  return hasStatus(player, 'stun');
}

function consumePress(game, player, wanted) {
  const index = player.pressBuffer.findIndex(
    (entry) => entry.action === wanted && game.tick - entry.tick <= PRESS_BUFFER_TICKS
  );
  if (index === -1) return false;
  player.pressBuffer.splice(index, 1);
  return true;
}

function startAttack(game, player, moveKey) {
  const move = player.hero.moves[moveKey];
  if (!move) return false;
  const total = move.startupFrames + move.activeFrames + move.recoveryFrames;
  player.action = {
    kind: 'attack',
    moveKey,
    move,
    frame: 0,
    total,
    hasHit: false,
    startTick: game.tick
  };
  player.blocking = false;
  player.crouching = false;
  player.walking = false;
  if (player.grounded) player.vx = 0;
  setAnimState(player);
  return true;
}

function startSkill(game, player, slot) {
  const skill = player.hero.skillsBySlot?.[slot];
  if (!skill) return false;
  if (player.cooldowns[slot] > 0) return false;
  if (slot === 'ULT' ? player.power < 100 : player.power < skill.powerCost) return false;
  if (!getSkillType(skill.type) && !player.hero.customSkills?.[skill.id]) return false;

  player.power = slot === 'ULT' ? 0 : Math.max(0, player.power - skill.powerCost);
  player.cooldowns[slot] = Math.max(1, Math.round(skill.cooldown * ARENA.tickRate));
  const startup = Math.max(1, skill.startupFrames);
  const recovery = Math.max(1, skill.recoveryFrames);
  player.action = {
    kind: 'skill',
    slot,
    skill,
    frame: 0,
    startup,
    recovery,
    total: startup + recovery,
    executed: false,
    motion: null,
    startTick: game.tick
  };
  player.blocking = false;
  player.crouching = false;
  player.walking = false;
  if (player.grounded) player.vx = 0;
  addEvent(game, 'skillStart', {
    playerId: player.id,
    slot,
    skillId: skill.id,
    name: skill.displayName,
    x: player.x,
    y: player.y - 110
  });
  setAnimState(player);
  return true;
}

function canAct(player) {
  return (
    !player.action &&
    player.health > 0 &&
    player.hitstun <= 0 &&
    player.blockstun <= 0 &&
    !isStunned(player)
  );
}

/** Move the player and resolve a dash_attack motion hitbox. */
function updateSkillMotion(game, player, target, action) {
  const motion = action.motion;
  if (!motion) return;
  if (action.frame > motion.until) {
    action.motion = null;
    if (player.grounded) player.vx = 0;
    return;
  }
  player.x = clamp(player.x + motion.vx, ARENA.leftBound, ARENA.rightBound);
  player.vx = 0;
  if (!motion.hasHit && target && target.health > 0) {
    const hitbox = worldHitbox(player, motion.hitbox);
    if (overlaps(hitbox, hurtbox(target))) {
      const result = applyDamage(game, target, player, motion.damage, {
        knockback: motion.knockback,
        hitstun: motion.hitstun,
        launch: motion.launch,
        skillId: motion.skillId,
        label: motion.label
      });
      if (result.damage > 0 || result.blocked || result.shieldAbsorbed > 0) {
        motion.hasHit = true;
      }
    }
  }
}

function makeSkillContext(game) {
  return {
    game,
    addEvent: (type, payload) => addEvent(game, type, payload),
    applyDamage: (caster, target, amount, opts) => applyDamage(game, target, caster, amount, opts),
    applyEffects: (target, effects, sourceId) => applyEffects(game, target, effects, sourceId),
    grantShield: (target, amount, duration) => grantShield(game, target, amount, duration),
    heal: (target, amount) => heal(game, target, amount),
    spawnProjectile: (config) => spawnProjectile(game, config)
  };
}

function spawnProjectile(game, config) {
  const projectile = {
    id: `proj_${game.nextEntityId++}`,
    ownerId: config.ownerId,
    skillId: config.skillId || null,
    skillName: config.skillName || 'Projectile',
    x: config.x,
    y: config.y,
    vx: config.vx || 0,
    vy: config.vy || 0,
    w: config.w || 48,
    h: config.h || 36,
    damage: config.damage || 0,
    effects: config.effects || [],
    knockback: config.knockback || 4,
    hitstun: config.hitstun || 14,
    launch: config.launch || 0,
    pierce: config.pierce === true,
    remaining: config.remaining || 120,
    shape: config.shape || 'orb',
    color: config.color || '#ff7a18',
    secondary: config.secondary || '#ffd166',
    hitIds: []
  };
  game.projectiles.push(projectile);
  return projectile;
}

function updateAction(game, player, target) {
  const action = player.action;
  if (!action) return;

  action.frame += 1;

  if (action.kind === 'attack') {
    const move = action.move;
    const active = action.frame > move.startupFrames &&
      action.frame <= move.startupFrames + move.activeFrames;
    if (active && !action.hasHit && target && target.health > 0) {
      const hitbox = worldHitbox(player, move.hitbox);
      if (overlaps(hitbox, hurtbox(target))) {
        const result = applyDamage(game, target, player, move.damage, {
          knockback: move.knockback,
          hitstun: move.hitstun,
          launch: move.launch,
          label: action.moveKey
        });
        if (result.damage > 0 || result.blocked || result.shieldAbsorbed > 0) {
          action.hasHit = true;
        }
      }
    }
    if (action.frame >= action.total) player.action = null;
  } else if (action.kind === 'skill') {
    if (!action.executed && action.frame >= action.startup) {
      action.executed = true;
      const ctx = makeSkillContext(game);
      executeSkill(player, target, game.room, action.skill, ctx);
      // Ultimates clear the caster action when their cinematic begins.
      if (player.action !== action) return;
    }
    if (player.action === action) updateSkillMotion(game, player, target, action);
    if (player.action === action && action.frame >= action.total) player.action = null;
  }

  if (player.action) setAnimState(player);
}

function updateProjectiles(game) {
  for (const projectile of game.projectiles) {
    if (projectile.dead) continue;
    projectile.x += projectile.vx;
    projectile.y += projectile.vy;
    projectile.remaining -= 1;

    const box = {
      x: projectile.x - projectile.w / 2,
      y: projectile.y - projectile.h / 2,
      w: projectile.w,
      h: projectile.h
    };

    for (const target of game.players) {
      if (target.id === projectile.ownerId || target.health <= 0) continue;
      if (projectile.hitIds.includes(target.id)) continue;
      if (!overlaps(box, hurtbox(target))) continue;

      const source = game.players.find((p) => p.id === projectile.ownerId) || null;
      const result = applyDamage(game, target, source, projectile.damage, {
        knockback: projectile.knockback,
        hitstun: projectile.hitstun,
        launch: projectile.launch,
        skillId: projectile.skillId,
        label: projectile.skillName
      });

      addEvent(game, 'projectileHit', {
        projectileId: projectile.id,
        x: projectile.x,
        y: projectile.y,
        targetId: target.id,
        blocked: result.blocked,
        color: projectile.color
      });

      if (!result.blocked && result.damage > 0 && projectile.effects.length) {
        applyEffects(game, target, projectile.effects, projectile.ownerId);
      }
      if (projectile.pierce) projectile.hitIds.push(target.id);
      else {
        projectile.dead = true;
        break;
      }
    }

    if (projectile.remaining <= 0 || projectile.x < -120 || projectile.x > ARENA.width + 120) {
      projectile.dead = true;
    }
  }
  game.projectiles = game.projectiles.filter((projectile) => !projectile.dead);
}

function updateCinematic(game) {
  const cinematic = game.cinematic;
  if (!cinematic) return;
  const elapsed = game.tick - cinematic.startTick;
  const owner = game.players.find((p) => p.id === cinematic.ownerId);
  const target = game.players.find((p) => p.id === cinematic.targetId) || otherPlayer(game, owner || game.players[0]);

  if (!cinematic.applied && elapsed >= cinematic.damageAt) {
    cinematic.applied = true;
    if (owner && target && target.health > 0) {
      const result = applyDamage(game, target, owner, cinematic.damage, {
        unblockable: true,
        ignoreInvuln: true,
        knockback: 16,
        launch: 10,
        hitstun: 55,
        ultimate: true,
        skillId: cinematic.skillId,
        label: cinematic.skillName
      });
      addEvent(game, 'ultimateHit', {
        ownerId: owner.id,
        targetId: target.id,
        x: target.x,
        y: target.y - 100,
        damage: result.damage,
        skillName: cinematic.skillName
      });
    }
  }

  if (elapsed >= cinematic.duration || game.phase !== 'playing') {
    game.cinematic = null;
    addEvent(game, 'ultimateEnd', { playerId: cinematic.ownerId });
  }
}

function updatePlayer(game, player, target) {
  if (game.phase !== 'playing') return;

  // Cooldowns, invulnerability and status effects always advance while active.
  for (const slot of Object.keys(player.cooldowns)) {
    if (player.cooldowns[slot] > 0) player.cooldowns[slot] -= 1;
  }
  if (player.invuln > 0) player.invuln -= 1;
  if (player.comboTimer > 0) {
    player.comboTimer -= 1;
    if (player.comboTimer === 0) player.combo = 0;
  }
  player.power = Math.min(100, player.power + POWER_PER_SECOND / ARENA.tickRate);
  tickStatuses(game, player);
  if (game.phase !== 'playing') return;

  if (player.health <= 0) {
    setAnimState(player);
    return;
  }

  if (player.hitstun > 0) {
    player.hitstun -= 1;
    player.blocking = false;
    player.crouching = false;
    player.walking = false;
    applyPhysics(game, player);
    setAnimState(player);
    return;
  }

  if (player.blockstun > 0) {
    player.blockstun -= 1;
    player.blocking = player.input.block && player.grounded;
    player.crouching = player.input.down && player.grounded;
    player.walking = false;
    player.vx = 0;
    applyPhysics(game, player);
    setAnimState(player);
    return;
  }

  if (isStunned(player)) {
    player.action = null;
    player.blocking = false;
    player.crouching = false;
    player.walking = false;
    player.vx = 0;
    applyPhysics(game, player);
    setAnimState(player);
    return;
  }

  if (player.action) {
    updateAction(game, player, target);
    applyPhysics(game, player);
    setAnimState(player);
    return;
  }

  // Free movement and actions.
  const input = player.input;
  player.blocking = !!input.block && player.grounded;
  player.crouching = !!input.down && player.grounded;
  player.walking = false;

  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const mods = modifiers(player);

  if (player.blocking) {
    player.vx = 0;
  } else if (player.grounded) {
    if (player.crouching) {
      player.vx = 0;
    } else if (dir !== 0) {
      const backpedal = dir !== player.facing ? 0.76 : 1;
      player.vx = dir * player.stats.walkSpeed * mods.speed * backpedal;
      player.walking = true;
    } else {
      player.vx = 0;
    }
  } else if (dir !== 0) {
    // Limited air control keeps the jump arc close to the server simulation.
    const maxAir = player.stats.walkSpeed * 1.05;
    player.vx = clamp(player.vx + dir * 0.2, -maxAir, maxAir);
  }

  // Process buffered presses. Blocking prevents attacks until the player
  // releases block; failed inputs stay buffered for a few frames.
  player.pressBuffer = player.pressBuffer.filter(
    (entry) => game.tick - entry.tick <= PRESS_BUFFER_TICKS
  );

  if (!player.blocking) {
    for (const entry of [...player.pressBuffer]) {
      if (entry.action === 'up') {
        if (player.grounded) {
          consumePress(game, player, 'up');
          player.grounded = false;
          player.vy = -player.stats.jumpPower;
          player.crouching = false;
          if (dir !== 0) player.vx = dir * player.stats.walkSpeed * 0.86;
          addEvent(game, 'jump', { playerId: player.id, x: player.x, y: player.y });
          break;
        }
        continue;
      }

      if (entry.action === 'light' || entry.action === 'heavy') {
        consumePress(game, player, entry.action);
        startAttack(game, player, entry.action);
        break;
      }

      const slot = SLOT_FOR_KEY[entry.action];
      if (slot) {
        if (startSkill(game, player, slot)) {
          consumePress(game, player, entry.action);
          break;
        }
      }
    }
  }

  applyPhysics(game, player);

  // Characters always face each other while not locked in an action.
  if (target && player.health > 0 && !player.action) {
    if (Math.abs(target.x - player.x) > 2) player.facing = target.x > player.x ? 1 : -1;
  }

  setAnimState(player);
}

function updateKOBodies(game) {
  for (const player of game.players) {
    if (player.health <= 0) {
      applyPhysics(game, player);
      player.anim = 'ko';
      player.state = 'ko';
    }
  }
}

function updateBots(game) {
  for (const bot of game.players) {
    if (!bot.isBot || bot.health <= 0) continue;
    const target = otherPlayer(game, bot);
    updateBotInput(game, bot, target);
  }
}

function checkTimeUp(game) {
  if (game.phase !== 'playing' || game.cinematic) return;
  if (game.timeLeft > 0) return;
  const [a, b] = game.players;
  addEvent(game, 'timeUp', {});
  let winnerId = null;
  if (a.health > b.health) winnerId = a.id;
  else if (b.health > a.health) winnerId = b.id;
  endRound(game, winnerId, 'timeout');
}

function finishDecidedMatch(room) {
  const game = room.game;
  const [a, b] = game.players;
  const aWins = game.roundWins[a.id] || 0;
  const bWins = game.roundWins[b.id] || 0;
  if (aWins < 2 && bWins < 2) return false;

  const winner = aWins >= 2 ? a : b;
  const loser = winner === a ? b : a;
  game.phase = 'match_end';
  game.matchEnded = true;
  game.winnerId = winner.id;
  game.loserId = loser.id;
  game.cinematic = null;
  addEvent(game, 'matchEnd', {
    winnerId: winner.id,
    loserId: loser.id,
    wins: { ...game.roundWins }
  });
  if (typeof room.onMatchEnd === 'function') {
    room.onMatchEnd(winner.id, game.roundEndReason === 'timeout' ? 'timeout' : 'ko');
  }
  return true;
}

/**
 * Advance one room by exactly one 60 Hz tick. Called by the global loop in
 * server/index.js. Room state stays 'playing' for the whole match; the game's
 * own phase handles countdown / round transitions.
 */
function tickRoom(room) {
  const game = room.game;
  if (!game || game.matchEnded) return;

  game.tick += 1;

  // Keep connection state in sync and neutralize disconnected inputs.
  for (const player of game.players) {
    const roomPlayer = room.players.get(player.id);
    player.connected = player.isBot ? true : !!(roomPlayer && !roomPlayer.disconnected);
    if (!player.connected) {
      player.input = emptyInput();
      player.pressBuffer = [];
      player.blocking = false;
    }
  }

  if (game.phase === 'countdown') {
    game.countdown -= 1;
    for (const player of game.players) setAnimState(player);
    if (game.countdown <= 0) {
      game.phase = 'playing';
      game.countdown = 0;
      addEvent(game, 'fight', { round: game.round });
      for (const player of game.players) {
        player.pressBuffer = [];
        player.invuln = Math.max(player.invuln, 20);
      }
    }
    return;
  }

  if (game.phase === 'playing') {
    if (game.cinematic) {
      updateCinematic(game);
      return;
    }

    updateBots(game);

    for (const player of game.players) {
      updatePlayer(game, player, otherPlayer(game, player));
      if (game.phase !== 'playing' || game.cinematic) break;
    }

    if (game.phase === 'playing' && !game.cinematic) {
      pushApart(game);
      updateProjectiles(game);
      game.timeLeft -= 1;
      checkTimeUp(game);
    }
    return;
  }

  if (game.phase === 'round_end') {
    game.roundEndTimer -= 1;
    updateKOBodies(game);
    if (game.roundEndTimer <= 0) {
      if (finishDecidedMatch(room)) return;
      game.round += 1;
      resetRound(game, true);
    }
    return;
  }
}

/** Serialize everything a client needs to render one snapshot. */
function buildSnapshot(room) {
  const game = room.game;
  if (!game) return null;
  const players = game.players.map((player) => {
    const roomPlayer = room.players.get(player.id);
    return {
      id: player.id,
      nickname: player.nickname,
      heroId: player.heroId,
      isBot: player.isBot,
      x: Math.round(player.x * 10) / 10,
      y: Math.round(player.y * 10) / 10,
      vx: Math.round(player.vx * 100) / 100,
      vy: Math.round(player.vy * 100) / 100,
      facing: player.facing,
      health: Math.max(0, Math.round(player.health)),
      maxHealth: player.maxHealth,
      power: Math.round(player.power * 10) / 10,
      state: player.state,
      anim: player.anim,
      blocking: player.blocking,
      crouching: player.crouching,
      grounded: player.grounded,
      hitstun: player.hitstun,
      invuln: player.invuln,
      combo: player.combo,
      connected: player.isBot ? true : !!(roomPlayer && !roomPlayer.disconnected),
      wins: game.roundWins[player.id] || 0,
      cooldowns: {
        S1: player.cooldowns.S1,
        S2: player.cooldowns.S2,
        S3: player.cooldowns.S3,
        ULT: player.cooldowns.ULT
      },
      statuses: player.statuses.map((status) => ({
        type: status.type,
        remaining: status.remaining,
        duration: status.duration || status.remaining,
        damagePerSecond: status.damagePerSecond || 0,
        magnitude: status.magnitude || 0
      })),
      shield: player.shield
        ? {
            amount: Math.round(player.shield.amount),
            remaining: Math.max(0, player.shield.until - game.tick)
          }
        : null,
      action: player.action
        ? {
            kind: player.action.kind,
            frame: player.action.frame,
            total: player.action.total,
            moveKey: player.action.moveKey || null,
            slot: player.action.slot || null,
            skillId: player.action.skill?.id || null
          }
        : null
    };
  });

  return {
    roomCode: game.roomCode,
    tick: game.tick,
    tickRate: ARENA.tickRate,
    phase: game.phase,
    round: game.round,
    timeLeft: game.timeLeft,
    timer: Math.max(0, Math.ceil(game.timeLeft / ARENA.tickRate)),
    countdown: game.countdown,
    roundEndTimer: game.roundEndTimer,
    roundEndReason: game.roundEndReason,
    roundWinnerId: game.roundWinnerId,
    roundWins: { ...game.roundWins },
    phaseTick: game.phase === 'countdown'
      ? game.countdown
      : game.phase === 'round_end'
        ? game.roundEndTimer
        : 0,
    players,
    projectiles: game.projectiles.map((projectile) => ({
      id: projectile.id,
      ownerId: projectile.ownerId,
      skillId: projectile.skillId,
      skillName: projectile.skillName,
      x: Math.round(projectile.x * 10) / 10,
      y: Math.round(projectile.y * 10) / 10,
      w: projectile.w,
      h: projectile.h,
      shape: projectile.shape,
      color: projectile.color,
      secondary: projectile.secondary
    })),
    cinematic: game.cinematic
      ? {
          ownerId: game.cinematic.ownerId,
          targetId: game.cinematic.targetId,
          skillId: game.cinematic.skillId,
          skillName: game.cinematic.skillName,
          duration: game.cinematic.duration,
          ticksLeft: Math.max(0, game.cinematic.duration - (game.tick - game.cinematic.startTick))
        }
      : null,
    winnerId: game.winnerId,
    loserId: game.loserId,
    matchEnded: game.matchEnded,
    events: game.events.map((event) => ({ ...event })),
    arena: { width: ARENA.width, height: ARENA.height, groundY: ARENA.groundY }
  };
}

function clearEvents(game) {
  if (game) game.events = [];
}

module.exports = {
  ARENA,
  INPUT_KEYS,
  PRESS_KEYS,
  emptyInput,
  sanitizeInput,
  createGameState,
  receiveInput,
  tickRoom,
  buildSnapshot,
  clearEvents
};

