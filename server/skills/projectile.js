'use strict';

/** Projectile skill: spawns a moving hitbox that is simulated in the game loop. */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const speed = Number(params.speed) || 9;
  const lifetime = Math.max(10, Number(params.lifetime) || 120);
  const height = Number(params.height) || 112;
  const width = Number(params.width) || 52;
  const hitHeight = Number(params.hitHeight) || 40;
  const offset = Number(params.spawnOffset) || 54;

  const projectile = ctx.spawnProjectile({
    ownerId: caster.id,
    skillId: skill.id,
    skillName: skill.displayName,
    x: caster.x + caster.facing * offset,
    y: caster.y - height,
    vx: caster.facing * speed,
    vy: Number(params.verticalSpeed) || 0,
    w: width,
    h: hitHeight,
    damage: skill.damage,
    effects: skill.effects,
    knockback: Number(params.knockback) || 5,
    hitstun: Number(params.hitstun) || 16,
    launch: Number(params.launch) || 0,
    pierce: params.pierce === true,
    remaining: lifetime,
    shape: params.shape || (skill.type === 'projectile' ? 'orb' : 'orb'),
    color: params.color || caster.hero?.theme?.primary || '#ff7a18',
    secondary: params.secondary || caster.hero?.theme?.accent || '#ffd166'
  });

  ctx.addEvent('projectileSpawn', {
    projectileId: projectile.id,
    ownerId: caster.id,
    x: projectile.x,
    y: projectile.y,
    shape: projectile.shape,
    color: projectile.color
  });
}

module.exports = { execute };
