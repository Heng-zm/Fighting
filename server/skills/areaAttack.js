'use strict';

const { overlaps, hurtbox, addEvent } = require('../combat');

/** Area attack around the caster (uppercuts, shockwaves, spins). */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const radius = Number(params.radius) || 130;
  const vertical = Number(params.verticalRange) || 190;
  const damage = Number(params.damage) || skill.damage;
  const launched = Number(params.launch) || 10;

  let connected = false;
  if (target && target.health > 0) {
    const dx = Math.abs(target.x - caster.x);
    const dy = Math.abs(target.y - caster.y);
    if (dx <= radius && dy <= vertical && target.invuln <= 0) {
      const result = ctx.applyDamage(caster, target, damage, {
        knockback: Number(params.knockback) || 8,
        hitstun: Number(params.hitstun) || 24,
        launch: launched,
        skillId: skill.id,
        label: skill.displayName
      });
      connected = result.damage > 0;
    }
  }

  ctx.addEvent('areaAttack', {
    playerId: caster.id,
    x: caster.x,
    y: caster.y - 90,
    radius,
    color: params.color || caster.hero?.theme?.primary || '#ff7a18',
    connected,
    skillId: skill.id
  });
}

module.exports = { execute, overlaps, hurtbox, addEvent };
