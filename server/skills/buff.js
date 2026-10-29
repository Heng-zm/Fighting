'use strict';

/** Self buff: raises damage and movement speed for a limited time. */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  ctx.applyEffects(caster, [
    {
      type: 'buff',
      duration: Number(params.duration) || 8,
      damageMultiplier: Number(params.damageMultiplier) || 1.3,
      speedMultiplier: Number(params.speedMultiplier) || 1.15
    }
  ], caster.id);
  if (Number(params.heal) > 0) ctx.heal(caster, Number(params.heal));
  ctx.addEvent('buff', {
    playerId: caster.id,
    color: params.color || caster.hero?.theme?.accent || '#22d3ee'
  });
}

module.exports = { execute };
