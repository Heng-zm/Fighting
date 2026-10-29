'use strict';

/** Short-range grab. Unblockable, staggers the target and repositions them. */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const range = Number(params.range) || 100;
  if (!target || Math.abs(target.x - caster.x) > range || target.health <= 0) {
    ctx.addEvent('grabWhiff', { playerId: caster.id, x: caster.x + caster.facing * 60, y: caster.y - 100 });
    return;
  }

  const result = ctx.applyDamage(caster, target, skill.damage, {
    unblockable: true,
    knockback: 0,
    hitstun: Number(params.hitstun) || 45,
    skillId: skill.id,
    label: skill.displayName
  });

  if (result.damage > 0) {
    target.x = caster.x + caster.facing * (Number(params.holdDistance) || 58);
    target.y = caster.y;
    target.vx = 0;
    if (Number(params.stun) > 0) {
      ctx.applyEffects(target, [{ type: 'stun', duration: Number(params.stun) }], caster.id);
    }
    ctx.addEvent('grab', {
      playerId: caster.id,
      targetId: target.id,
      x: target.x,
      y: target.y - 110
    });
  }
}

module.exports = { execute };
