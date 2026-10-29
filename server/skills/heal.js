'use strict';

/** Instant self heal. */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const amount = Number(params.amount) || skill.damage || 100;
  ctx.heal(caster, amount);
  ctx.addEvent('healCast', {
    playerId: caster.id,
    color: params.color || caster.hero?.theme?.accent || '#4ade80'
  });
}

module.exports = { execute };
