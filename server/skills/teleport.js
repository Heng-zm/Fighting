'use strict';

const { ARENA, clamp } = require('../combat');

/** Teleport behind (or to an offset from) the opponent, with a few i-frames. */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const from = { x: caster.x, y: caster.y };
  const distance = Number(params.distance) || 88;
  const invulnFrames = Math.round(Number(params.invulnFrames) || 14);

  let newX;
  if (target) {
    if (params.to === 'front') newX = target.x + target.facing * distance;
    else newX = target.x - target.facing * distance;
    caster.facing = target.x >= newX ? 1 : -1;
  } else {
    newX = caster.x + caster.facing * distance;
  }

  caster.x = clamp(newX, ARENA.leftBound, ARENA.rightBound);
  caster.vx = 0;
  caster.vy = 0;
  caster.grounded = true;
  caster.y = ARENA.groundY;
  caster.invuln = Math.max(caster.invuln, invulnFrames);
  caster.statuses = caster.statuses.filter((s) => s.type !== 'slow');

  if (Number(params.damage) > 0 && target) {
    ctx.applyDamage(caster, target, Number(params.damage), {
      knockback: 2,
      hitstun: 10,
      skillId: skill.id,
      label: skill.displayName
    });
  }

  ctx.addEvent('teleport', {
    playerId: caster.id,
    fromX: from.x,
    fromY: from.y,
    toX: caster.x,
    toY: caster.y,
    color: params.color || caster.hero?.theme?.accent || '#8b5cf6'
  });
}

module.exports = { execute };
