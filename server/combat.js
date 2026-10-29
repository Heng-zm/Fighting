'use strict';

/**
 * Shared combat math and damage resolution.
 *
 * Coordinates use a 1280x720 arena. A player's (x, y) is the point between their
 * feet on the floor. Negative y is up.
 */

const ARENA = {
  width: 1280,
  height: 720,
  groundY: 620,
  leftBound: 64,
  rightBound: 1216,
  tickRate: 60
};

const PHYSICS = {
  gravity: 0.92,
  jumpCutoff: 0.55,
  groundFriction: 0.72,
  airFriction: 0.985,
  pushRadius: 58
};

/** Axis-aligned rectangle overlap. */
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** The area that can be hit. Crouching players expose a smaller hurtbox. */
function hurtbox(player) {
  if (player.crouching && player.grounded) {
    return { x: player.x - 32, y: player.y - 98, w: 64, h: 98 };
  }
  return { x: player.x - 34, y: player.y - 152, w: 68, h: 152 };
}

/** Convert a character-relative hitbox into world coordinates. */
function worldHitbox(player, hb) {
  if (!hb) return null;
  const x = player.facing >= 0 ? player.x + hb.x : player.x - hb.x - hb.w;
  return { x, y: player.y + hb.y, w: hb.w, h: hb.h };
}

/** Find the opponent of a player inside a two-player game. */
function otherPlayer(game, player) {
  return game.players.find((p) => p.id !== player.id) || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Damage/speed multipliers from temporary buffs and debuffs. */
function modifiers(player) {
  let damage = 1;
  let speed = 1;
  for (const status of player.statuses) {
    if (status.type === 'buff') {
      damage *= status.damageMultiplier || 1.25;
      speed *= status.speedMultiplier || 1.1;
    }
    if (status.type === 'slow') {
      speed *= 1 - (status.magnitude || 0.35);
    }
  }
  return { damage, speed };
}

function hasStatus(player, type) {
  return player.statuses.some((s) => s.type === type && s.remaining > 0);
}

function addEvent(game, type, payload = {}) {
  game.eventSeq += 1;
  game.events.push({ id: game.eventSeq, type, tick: game.tick, ...payload });
  // Keep the per-frame queue bounded even if no snapshots are being read.
  if (game.events.length > 120) game.events.splice(0, game.events.length - 120);
}

/**
 * Apply a status effect list from a skill.
 * Supported: burn, poison, slow, stun, buff.
 */
function applyEffects(game, target, effects, sourceId = null) {
  if (!target || !Array.isArray(effects)) return;
  for (const effect of effects) {
    if (!effect || !effect.type) continue;
    const duration = Math.max(0.1, Number(effect.duration) || 2);
    const ticks = Math.round(duration * ARENA.tickRate);

    if (effect.type === 'burn' || effect.type === 'poison') {
      const existing = target.statuses.find(
        (s) => s.type === effect.type && s.sourceId === sourceId
      );
      const status = {
        type: effect.type,
        remaining: ticks,
        duration: ticks,
        damagePerSecond: Math.max(0.5, Number(effect.damagePerSecond) || 3),
        sourceId,
        accumulator: 0
      };
      if (existing) Object.assign(existing, status);
      else target.statuses.push(status);
      addEvent(game, 'status', {
        targetId: target.id,
        effect: effect.type,
        duration
      });
    } else if (effect.type === 'slow') {
      target.statuses.push({
        type: 'slow',
        remaining: ticks,
        duration: ticks,
        magnitude: clamp(Number(effect.magnitude) || 0.35, 0.05, 0.85)
      });
      addEvent(game, 'status', { targetId: target.id, effect: 'slow', duration });
    } else if (effect.type === 'stun') {
      target.statuses.push({ type: 'stun', remaining: ticks, duration: ticks });
      target.action = null;
      target.blocking = false;
      addEvent(game, 'status', { targetId: target.id, effect: 'stun', duration });
    } else if (effect.type === 'buff') {
      target.statuses.push({
        type: 'buff',
        remaining: ticks,
        duration: ticks,
        damageMultiplier: clamp(Number(effect.damageMultiplier) || 1.25, 1, 3),
        speedMultiplier: clamp(Number(effect.speedMultiplier) || 1.1, 1, 2)
      });
      addEvent(game, 'status', { targetId: target.id, effect: 'buff', duration });
    }
  }
}

/** Grant a temporary damage-absorbing shield. */
function grantShield(game, target, amount, durationSeconds) {
  if (!target) return;
  const ticks = Math.round((Number(durationSeconds) || 5) * ARENA.tickRate);
  target.shield = {
    amount: Math.max(0, Number(amount) || 0),
    until: game.tick + ticks
  };
  addEvent(game, 'shield', { playerId: target.id, amount: target.shield.amount });
}

function heal(game, target, amount) {
  if (!target || target.health <= 0) return 0;
  const before = target.health;
  target.health = Math.min(target.maxHealth, target.health + Math.max(0, amount));
  const healed = Math.round(target.health - before);
  if (healed > 0) {
    addEvent(game, 'heal', { playerId: target.id, x: target.x, y: target.y - 120, amount: healed });
  }
  return healed;
}

function endRound(game, winnerId, reason) {
  if (game.phase !== 'playing' || game.roundEnded) return;
  game.roundEnded = true;
  game.phase = 'round_end';
  game.roundEndTimer = 190;
  game.roundEndReason = reason;
  game.roundWinnerId = winnerId;
  if (winnerId) {
    game.roundWins[winnerId] = (game.roundWins[winnerId] || 0) + 1;
  }
  addEvent(game, 'roundEnd', {
    winnerId,
    reason,
    wins: { ...game.roundWins }
  });
}

/**
 * Central damage resolver. All attacks, projectiles, DOTs and ultimates go
 * through this function so blocking, shields, i-frames, power and round endings
 * stay consistent.
 *
 * options: { knockback, launch, hitstun, blockstun, sourceId, unblockable,
 *            ignoreInvuln, dot, skillId, label }
 */
function applyDamage(game, target, source, rawAmount, options = {}) {
  if (!target || target.health <= 0) return { damage: 0, blocked: false };
  if (game.phase !== 'playing' || game.roundEnded) return { damage: 0, blocked: false };
  if (!options.ignoreInvuln && target.invuln > 0 && !options.dot) {
    return { damage: 0, blocked: false, invulnerable: true };
  }

  const sourcePlayer = source || (options.sourceId ? game.players.find((p) => p.id === options.sourceId) : null);
  const mods = sourcePlayer ? modifiers(sourcePlayer) : { damage: 1 };
  let amount = Math.max(0, Number(rawAmount) || 0) * mods.damage;
  if (amount <= 0) return { damage: 0, blocked: false };

  const attackerX = sourcePlayer ? sourcePlayer.x : target.x + target.facing * 100;
  const attackFromFront = (attackerX - target.x) * target.facing >= 0;
  const canBlock =
    !options.unblockable &&
    !options.dot &&
    target.blocking &&
    target.grounded &&
    attackFromFront;
  const canShield = target.shield && target.shield.amount > 0 && game.tick < target.shield.until;

  let shieldAbsorbed = 0;
  if (canShield) {
    shieldAbsorbed = Math.min(target.shield.amount, amount);
    target.shield.amount -= shieldAbsorbed;
    amount -= shieldAbsorbed;
    if (target.shield.amount <= 0) target.shield = null;
    addEvent(game, 'shieldHit', {
      playerId: target.id,
      x: target.x,
      y: target.y - 110,
      amount: Math.round(shieldAbsorbed)
    });
  }

  if (amount <= 0.01) {
    if (sourcePlayer && shieldAbsorbed > 0) {
      sourcePlayer.power = clamp(sourcePlayer.power + 2, 0, 100);
    }
    return { damage: 0, blocked: false, shieldAbsorbed };
  }

  let damage;
  let blocked = false;

  if (canBlock) {
    blocked = true;
    damage = Math.max(1, Math.round(amount * 0.16));
    target.health = Math.max(0, target.health - damage);
    target.blockstun = Math.max(target.blockstun, options.blockstun || 10);
    target.vx = (attackerX > target.x ? -1 : 1) * Math.min(4, (options.knockback || 4) * 0.35);
    target.hitstun = 0;
    target.power = clamp(target.power + damage * 0.5 + 1, 0, 100);
    if (sourcePlayer) sourcePlayer.power = clamp(sourcePlayer.power + damage * 0.3, 0, 100);
    addEvent(game, 'block', {
      x: target.x + (attackerX > target.x ? -26 : 26),
      y: target.y - 108,
      targetId: target.id,
      sourceId: sourcePlayer ? sourcePlayer.id : null,
      damage
    });
  } else {
    damage = Math.max(1, Math.round(amount));
    target.health = Math.max(0, target.health - damage);
    target.action = null;
    target.blocking = false;
    target.crouching = false;
    target.hitstun = Math.max(target.hitstun, options.hitstun || 14);
    target.invuln = Math.max(target.invuln, (options.hitstun || 14) + 12);
    const dir = attackerX > target.x ? -1 : 1;
    target.vx = dir * Math.max(0, Number(options.knockback) || 4);
    if (options.launch) {
      target.vy = -Math.abs(Number(options.launch) || 0);
      target.grounded = false;
    }
    target.power = clamp(target.power + damage * 0.1, 0, 100);

    if (sourcePlayer) {
      sourcePlayer.power = clamp(sourcePlayer.power + damage * 0.16, 0, 100);
      sourcePlayer.combo = sourcePlayer.comboTimer > 0 ? sourcePlayer.combo + 1 : 1;
      sourcePlayer.comboTimer = 100;
    }

    addEvent(game, 'hit', {
      x: target.x + (attackerX > target.x ? -22 : 22),
      y: target.y - 110,
      targetId: target.id,
      sourceId: sourcePlayer ? sourcePlayer.id : null,
      damage,
      blocked: false,
      heavy: !!options.launch || !!options.ultimate,
      skillId: options.skillId || null,
      label: options.label || null
    });
  }

  if (damage > 0) {
    addEvent(game, 'damageNumber', {
      x: target.x,
      y: target.y - 165,
      amount: damage,
      blocked,
      targetId: target.id
    });
  }

  if (target.health <= 0) {
    target.health = 0;
    target.state = 'ko';
    target.action = null;
    target.blocking = false;
    target.hitstun = 60;
    target.vy = -10;
    target.vx = (attackerX > target.x ? -1 : 1) * 7;
    target.grounded = false;
    addEvent(game, 'ko', {
      x: target.x,
      y: target.y - 100,
      playerId: target.id,
      sourceId: sourcePlayer ? sourcePlayer.id : null
    });
    const winner = sourcePlayer && sourcePlayer.id !== target.id ? sourcePlayer : otherPlayer(game, target);
    endRound(game, winner ? winner.id : null, 'ko');
  }

  return { damage, blocked, shieldAbsorbed };
}

/** Update DOTs and duration based statuses once per server tick. */
function tickStatuses(game, player) {
  if (!player.statuses.length && !player.shield) return;
  for (const status of player.statuses) {
    status.remaining -= 1;
    if (status.type === 'burn' || status.type === 'poison') {
      status.accumulator = (status.accumulator || 0) + 1;
      if (status.accumulator >= 60 && status.remaining > 0) {
        status.accumulator -= 60;
        const source = game.players.find((p) => p.id === status.sourceId) || null;
        applyDamage(game, player, source, status.damagePerSecond, {
          dot: true,
          ignoreInvuln: true,
          sourceId: status.sourceId,
          label: status.type
        });
      }
    }
  }
  player.statuses = player.statuses.filter((s) => s.remaining > 0);
  if (player.shield && game.tick >= player.shield.until) player.shield = null;
}

module.exports = {
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
};
