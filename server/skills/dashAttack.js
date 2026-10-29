'use strict';

/**
 * Dash attack: attaches a motion/hit window to the caster's current skill
 * action. The game loop moves the caster and resolves the moving hitbox.
 */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const action = caster.action;
  const frames = Math.max(4, Math.round(Number(params.frames) || 12));
  const hitbox = params.hitbox && typeof params.hitbox === 'object'
    ? params.hitbox
    : { x: 10, y: -132, w: 90, h: 90 };

  if (!action) {
    // Custom callers may invoke this outside a skill action; resolve instantly.
    if (target) {
      ctx.applyDamage(caster, target, skill.damage, {
        knockback: Number(params.knockback) || 10,
        hitstun: Number(params.hitstun) || 22,
        skillId: skill.id,
        label: skill.displayName
      });
    }
    return;
  }

  action.motion = {
    vx: caster.facing * (Number(params.speed) || 16),
    until: action.frame + frames,
    started: action.frame,
    hitbox: {
      x: Number(hitbox.x) || 10,
      y: Number(hitbox.y) || -132,
      w: Number(hitbox.w) || 90,
      h: Number(hitbox.h) || 90
    },
    hasHit: false,
    damage: skill.damage,
    effects: skill.effects,
    knockback: Number(params.knockback) || 10,
    hitstun: Number(params.hitstun) || 22,
    launch: Number(params.launch) || 0,
    skillId: skill.id,
    label: skill.displayName
  };
  caster.invuln = Math.max(caster.invuln, Math.round(Number(params.invulnFrames) || 8));
  caster.vx = action.motion.vx;
  ctx.addEvent('dash', {
    playerId: caster.id,
    fromX: caster.x,
    facing: caster.facing,
    skillId: skill.id
  });
}

module.exports = { execute };
