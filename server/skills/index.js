'use strict';

/**
 * Built-in skill type library.
 *
 * Every module exports:
 *   execute(caster, target, room, skill, ctx)
 *
 * Custom heroes may override any skill id from their skills.js file. The custom
 * implementation has priority over the built-in type.
 */

const projectile = require('./projectile');
const dashAttack = require('./dashAttack');
const teleport = require('./teleport');
const buff = require('./buff');
const shield = require('./shield');
const heal = require('./heal');
const areaAttack = require('./areaAttack');
const grab = require('./grab');
const debuff = require('./debuff');
const ultimate = require('./ultimate');

const LIBRARY = {
  projectile,
  dash_attack: dashAttack,
  teleport,
  buff,
  shield,
  heal,
  area_attack: areaAttack,
  grab,
  debuff,
  ultimate
};

const unknownTypeWarnings = new Set();

function get(type) {
  return LIBRARY[type] || null;
}

/**
 * Run a skill, preferring hero-specific code from characters/<hero>/skills.js.
 * Returns true when an implementation ran.
 */
function executeSkill(caster, target, room, skill, ctx) {
  const custom = caster.hero?.customSkills?.[skill.id];
  if (custom && typeof custom.execute === 'function') {
    custom.execute(caster, target, room, skill, ctx);
    return true;
  }

  const implementation = LIBRARY[skill.type];
  if (!implementation || typeof implementation.execute !== 'function') {
    if (!unknownTypeWarnings.has(skill.type)) {
      unknownTypeWarnings.add(skill.type);
      console.warn(`[skills] Unknown skill type "${skill.type}" for ${skill.id}; it was ignored.`);
    }
    return false;
  }
  implementation.execute(caster, target, room, skill, ctx);
  return true;
}

module.exports = {
  LIBRARY,
  types: Object.keys(LIBRARY),
  get,
  executeSkill
};
