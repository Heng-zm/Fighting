'use strict';

/**
 * Lightweight CPU opponent used by "Fight a Bot".
 *
 * Bots write into the exact same input/press-buffer pipeline as humans, so they
 * obey cooldowns, hit-stun, blocking and every other server rule. No cheating.
 */

const { ARENA } = require('./combat');

const EMPTY = {
  left: false,
  right: false,
  up: false,
  down: false,
  light: false,
  heavy: false,
  block: false,
  skill1: false,
  skill2: false,
  skill3: false,
  ult: false
};

function ensureAi(bot) {
  if (!bot.ai) {
    bot.ai = {
      nextThink: 0,
      nextAction: 0,
      blockUntil: 0,
      retreatUntil: 0,
      lastDecision: ''
    };
  }
  return bot.ai;
}

function queuePress(bot, action, tick) {
  if (bot.pressBuffer.some((entry) => entry.action === action && tick - entry.tick < 4)) return;
  bot.pressBuffer.push({ action, tick });
  if (bot.pressBuffer.length > 8) bot.pressBuffer.shift();
}

function skillReady(bot, slot) {
  const skill = bot.hero.skillsBySlot?.[slot];
  if (!skill) return null;
  if (bot.cooldowns[slot] > 0) return null;
  if (slot === 'ULT') return bot.power >= 100 ? skill : null;
  if (bot.power < skill.powerCost) return null;
  return skill;
}

function incomingProjectile(game, bot) {
  return game.projectiles.some((projectile) => {
    if (projectile.ownerId === bot.id) return false;
    const towards = (projectile.vx > 0 && projectile.x < bot.x) || (projectile.vx < 0 && projectile.x > bot.x);
    return towards && Math.abs(projectile.x - bot.x) < 360 && Math.abs(projectile.y - (bot.y - 100)) < 150;
  });
}

function updateBotInput(game, bot, target) {
  bot.input = { ...EMPTY };
  if (!target || target.health <= 0) return;

  const ai = ensureAi(bot);
  const now = game.tick;
  const dx = target.x - bot.x;
  const distance = Math.abs(dx);
  const towards = dx >= 0 ? 'right' : 'left';
  const away = dx >= 0 ? 'left' : 'right';

  if (bot.health <= 0 || bot.hitstun > 0 || bot.statuses.some((s) => s.type === 'stun' && s.remaining > 0)) {
    return;
  }

  // Defensive reactions: block telegraphed normals and incoming projectiles.
  const threat = incomingProjectile(game, bot);
  const attacking = target.action && target.action.kind === 'attack' && target.action.frame <= 2 && distance < 200;
  if (!bot.action && (threat || attacking) && now >= ai.nextThink) {
    if (Math.random() < 0.55) {
      ai.blockUntil = now + 12 + Math.floor(Math.random() * 12);
      ai.nextThink = now + 30;
    }
  }
  if (now < ai.blockUntil) {
    bot.input.block = true;
    return;
  }

  if (now < ai.retreatUntil) {
    bot.input[away] = true;
    return;
  }

  // Ranged skills while approaching.
  if (!bot.action && now >= ai.nextAction) {
    const s1 = skillReady(bot, 'S1');
    const s2 = skillReady(bot, 'S2');
    const s3 = skillReady(bot, 'S3');
    const ult = skillReady(bot, 'ULT');

    if (ult && (distance < 300 || Math.random() < 0.2)) {
      queuePress(bot, 'ult', now);
      ai.nextAction = now + 80;
      ai.lastDecision = 'ult';
      return;
    }

    if (bot.health < bot.maxHealth * 0.38 && s2 && (s2.type === 'heal' || s2.type === 'shield')) {
      queuePress(bot, 'skill2', now);
      ai.nextAction = now + 70;
      ai.lastDecision = 'sustain';
      return;
    }

    if (distance > 220 && s1 && s1.type === 'projectile' && Math.random() < 0.65) {
      queuePress(bot, 'skill1', now);
      ai.nextAction = now + 36 + Math.floor(Math.random() * 30);
      ai.lastDecision = 'zone';
      return;
    }

    if (distance > 260 && s3 && Math.random() < 0.3) {
      if (s3.type === 'teleport') {
        queuePress(bot, 'skill3', now);
        ai.nextAction = now + 60;
        ai.lastDecision = 'teleport';
        return;
      }
      if (s3.type === 'debuff' || s3.type === 'projectile') {
        queuePress(bot, 'skill3', now);
        ai.nextAction = now + 70;
        ai.lastDecision = 'zone';
        return;
      }
    }

    if (distance < 170 && s2 && s2.type === 'dash_attack' && Math.random() < 0.3) {
      queuePress(bot, 'skill2', now);
      ai.nextAction = now + 50;
      ai.lastDecision = 'dash';
      return;
    }

    if (distance < 135 && s3 && s3.type === 'area_attack' && Math.random() < 0.45) {
      queuePress(bot, 'skill3', now);
      ai.nextAction = now + 45;
      ai.lastDecision = 'area';
      return;
    }

    if (distance < 128) {
      if (Math.random() < 0.2 && s1) {
        queuePress(bot, 'skill1', now);
        ai.nextAction = now + 30;
        ai.lastDecision = 'special';
      } else {
        queuePress(bot, Math.random() < 0.58 ? 'light' : 'heavy', now);
        ai.nextAction = now + 16 + Math.floor(Math.random() * 18);
        ai.lastDecision = 'poke';
      }
      return;
    }
  }

  // Movement.
  if (distance > 150) {
    bot.input[towards] = true;
    // Jump in occasionally to close the gap.
    if (bot.grounded && now >= ai.nextThink && Math.random() < 0.035) {
      queuePress(bot, 'up', now);
      ai.nextThink = now + 50;
    }
  } else if (distance > 96) {
    bot.input[towards] = true;
  } else if (distance < 58) {
    bot.input[away] = true;
  } else {
    bot.input.down = Math.random() < 0.15;
    if (!bot.action && now >= ai.nextThink && Math.random() < 0.08) {
      ai.blockUntil = now + 10;
    }
  }

  if (now >= ai.nextThink) ai.nextThink = now + 5 + Math.floor(Math.random() * 8);
}

module.exports = { updateBotInput, EMPTY };
