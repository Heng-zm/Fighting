'use strict';

/** Temporary damage-absorbing shield. */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const amount = Number(params.amount) || Math.max(40, skill.damage || 120);
  const duration = Number(params.duration) || 6;
  ctx.grantShield(caster, amount, duration);
  ctx.addEvent('shieldCast', {
    playerId: caster.id,
    color: params.color || caster.hero?.theme?.accent || '#38bdf8'
  });
}

module.exports = { execute };
