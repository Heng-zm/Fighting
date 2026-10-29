'use strict';

/**
 * Ultimate: freezes the fight for a short cinematic, then deals a large
 * unblockable hit. Client renders the dark overlay, title and screen shake.
 */
function execute(caster, target, room, skill, ctx) {
  const params = skill.params || {};
  const game = ctx.game;
  const targetPlayer = target || game.players.find((p) => p.id !== caster.id);

  if (params.teleportBehind && targetPlayer) {
    const oldX = caster.x;
    caster.x = targetPlayer.x - targetPlayer.facing * 70;
    caster.facing = targetPlayer.x >= caster.x ? 1 : -1;
    caster.x = Math.max(70, Math.min(1210, caster.x));
    ctx.addEvent('teleport', {
      playerId: caster.id,
      fromX: oldX,
      fromY: caster.y,
      toX: caster.x,
      toY: caster.y,
      color: caster.hero?.theme?.accent || '#a855f7'
    });
  }

  game.cinematic = {
    ownerId: caster.id,
    targetId: targetPlayer ? targetPlayer.id : null,
    skillId: skill.id,
    skillName: skill.displayName,
    startTick: game.tick,
    duration: Math.max(60, Math.round(Number(params.cinematicFrames) || 150)),
    damageAt: Math.max(20, Math.round(Number(params.damageAt) || 80)),
    applied: false,
    damage: Number(params.damage) || skill.damage,
    effects: skill.effects,
    teleportBehind: params.teleportBehind === true
  };
  caster.action = null;
  caster.state = 'idle';
  caster.vx = 0;
  targetPlayer && (targetPlayer.vx = 0);
  ctx.addEvent('ultimateStart', {
    playerId: caster.id,
    targetId: targetPlayer ? targetPlayer.id : null,
    skillId: skill.id,
    skillName: skill.displayName,
    durationFrames: game.cinematic.duration,
    color: params.color || caster.hero?.theme?.primary || '#ff7a18'
  });
}

module.exports = { execute };
