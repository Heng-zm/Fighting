'use strict';

/** Applies poison/slow/stun/burn at range (with an optional instant hit). */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const range = Number(params.range) || 480;
  const verticalRange = Number(params.verticalRange) || 260;
  const effects = Array.isArray(skill.effects) && skill.effects.length
    ? skill.effects
    : [{ type: params.effect || 'poison', duration: Number(params.duration) || 4, damagePerSecond: Number(params.damagePerSecond) || 4 }];

  if (!target || Math.abs(target.x - caster.x) > range || Math.abs(target.y - caster.y) > verticalRange) {
    ctx.addEvent('debuffWhiff', {
      playerId: caster.id,
      x: caster.x + caster.facing * 140,
      y: caster.y - 100,
      color: params.color || '#84cc16'
    });
    return;
  }

  if (Number(skill.damage) > 0) {
    ctx.applyDamage(caster, target, skill.damage, {
      knockback: Number(params.knockback) || 2,
      hitstun: Number(params.hitstun) || 12,
      skillId: skill.id,
      label: skill.displayName
    });
  }
  ctx.applyEffects(target, effects, caster.id);
  ctx.addEvent('debuff', {
    playerId: caster.id,
    targetId: target.id,
    x: target.x,
    y: target.y - 110,
    color: params.color || '#84cc16',
    skillId: skill.id
  });
}

module.exports = { execute };
