'use strict';

/**
 * Scans /characters on startup and turns every valid character folder into a
 * playable hero. Adding a folder with a valid character.json requires no code
 * changes anywhere else in the project.
 */

const fs = require('fs');
const path = require('path');

const CHARACTERS_DIR = path.join(__dirname, '..', 'characters');

// Keep this in sync with /server/skills/index.js. A custom skills.js
// implementation may also provide specialized logic for any type.
const KNOWN_SKILL_TYPES = [
  'projectile',
  'dash_attack',
  'teleport',
  'buff',
  'shield',
  'heal',
  'area_attack',
  'grab',
  'debuff',
  'ultimate'
];

const SKILL_SLOTS = ['S1', 'S2', 'S3', 'ULT'];
const REQUIRED_ANIMATIONS = ['idle', 'walk', 'jump', 'crouch', 'block', 'light', 'heavy', 'hit', 'ko'];

const DEFAULT_ANIMATION = {
  sprite: '',
  frameWidth: 96,
  frameHeight: 96,
  frameCount: 1,
  frameDuration: 120,
  loop: true
};

const DEFAULT_ANIMATIONS = {
  idle: { ...DEFAULT_ANIMATION, sprite: 'sprites/idle.png', frameCount: 4 },
  walk: { ...DEFAULT_ANIMATION, sprite: 'sprites/walk.png', frameCount: 6 },
  jump: { ...DEFAULT_ANIMATION, sprite: 'sprites/jump.png', frameCount: 3, loop: false },
  crouch: { ...DEFAULT_ANIMATION, sprite: 'sprites/crouch.png', frameCount: 2 },
  block: { ...DEFAULT_ANIMATION, sprite: 'sprites/block.png', frameCount: 2 },
  light: { ...DEFAULT_ANIMATION, sprite: 'sprites/light.png', frameCount: 3, loop: false },
  heavy: { ...DEFAULT_ANIMATION, sprite: 'sprites/heavy.png', frameCount: 4, loop: false },
  hit: { ...DEFAULT_ANIMATION, sprite: 'sprites/hit.png', frameCount: 2, loop: false },
  ko: { ...DEFAULT_ANIMATION, sprite: 'sprites/ko.png', frameCount: 2, loop: false },
  special1: { ...DEFAULT_ANIMATION, sprite: 'sprites/special1.png', frameCount: 4, loop: false },
  special2: { ...DEFAULT_ANIMATION, sprite: 'sprites/special2.png', frameCount: 4, loop: false },
  special3: { ...DEFAULT_ANIMATION, sprite: 'sprites/special3.png', frameCount: 4, loop: false },
  ult: { ...DEFAULT_ANIMATION, sprite: 'sprites/ult.png', frameCount: 6, loop: false }
};

const DEFAULT_MOVE = {
  damage: 5,
  startupFrames: 5,
  activeFrames: 4,
  recoveryFrames: 8,
  hitbox: { x: 26, y: -118, w: 56, h: 40 },
  knockback: 4,
  hitstun: 14
};

function warn(message) {
  console.warn(`[characters] ${message}`);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value, fallback, min = 0.01) {
  return isFiniteNumber(value) && value >= min ? value : fallback;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return '';
  return normalized;
}

function validateAnimation(name, config, heroDir) {
  const merged = { ...DEFAULT_ANIMATION, ...(config && typeof config === 'object' ? config : {}) };
  const animation = {
    sprite: safeRelativePath(merged.sprite),
    frameWidth: Math.round(positive(merged.frameWidth, 96, 1)),
    frameHeight: Math.round(positive(merged.frameHeight, 96, 1)),
    frameCount: Math.round(positive(merged.frameCount, 1, 1)),
    frameDuration: Math.round(positive(merged.frameDuration, 120, 16)),
    loop: merged.loop !== false
  };
  if (animation.sprite) {
    const full = path.join(heroDir, animation.sprite);
    if (!fs.existsSync(full)) {
      warn(`"${path.basename(heroDir)}" is missing ${name} sprite (${animation.sprite}); using vector fallback art.`);
    }
  }
  return animation;
}

function validateMove(name, move, heroId) {
  if (!move || typeof move !== 'object') {
    warn(`"${heroId}" move "${name}" is missing; using defaults.`);
    return { ...DEFAULT_MOVE };
  }
  const hb = move.hitbox && typeof move.hitbox === 'object' ? move.hitbox : DEFAULT_MOVE.hitbox;
  const hitbox = {
    x: isFiniteNumber(hb.x) ? hb.x : DEFAULT_MOVE.hitbox.x,
    y: isFiniteNumber(hb.y) ? hb.y : DEFAULT_MOVE.hitbox.y,
    w: positive(hb.w, DEFAULT_MOVE.hitbox.w, 1),
    h: positive(hb.h, DEFAULT_MOVE.hitbox.h, 1)
  };
  if (!move.hitbox) warn(`"${heroId}" move "${name}" has no hitbox; using defaults.`);
  return {
    damage: positive(move.damage, DEFAULT_MOVE.damage, 0),
    startupFrames: Math.round(positive(move.startupFrames, DEFAULT_MOVE.startupFrames, 1)),
    activeFrames: Math.round(positive(move.activeFrames, DEFAULT_MOVE.activeFrames, 1)),
    recoveryFrames: Math.round(positive(move.recoveryFrames, DEFAULT_MOVE.recoveryFrames, 1)),
    hitbox,
    knockback: positive(move.knockback, DEFAULT_MOVE.knockback, 0),
    hitstun: Math.round(positive(move.hitstun, DEFAULT_MOVE.hitstun, 1)),
    launch: positive(move.launch, 0, 0),
    animation: typeof move.animation === 'string' ? move.animation : name
  };
}

function validateSkill(rawSkill, heroId, customSkills, index) {
  if (!rawSkill || typeof rawSkill !== 'object') {
    warn(`"${heroId}" has an invalid skill at index ${index}; skipping.`);
    return null;
  }
  const slot = String(rawSkill.slot || '').toUpperCase();
  const id = String(rawSkill.id || '').trim();
  if (!id) {
    warn(`"${heroId}" skill #${index + 1} is missing an id; skipping.`);
    return null;
  }
  if (!SKILL_SLOTS.includes(slot)) {
    warn(`"${heroId}" skill "${id}" has invalid slot "${rawSkill.slot}"; expected S1, S2, S3 or ULT. Skipping.`);
    return null;
  }
  const type = String(rawSkill.type || '').trim();
  const custom = customSkills && customSkills[id];
  if (!type) {
    warn(`"${heroId}" skill "${id}" is missing a type; skipping.`);
    return null;
  }
  if (!KNOWN_SKILL_TYPES.includes(type) && !(custom && typeof custom.execute === 'function')) {
    warn(`"${heroId}" skill "${id}" uses unknown type "${type}"; skipping.`);
    return null;
  }
  if (!rawSkill.displayName) {
    warn(`"${heroId}" skill "${id}" is missing displayName; using its id.`);
  }
  if (!isFiniteNumber(rawSkill.cooldown)) {
    warn(`"${heroId}" skill "${id}" is missing cooldown; defaulting to 5 seconds.`);
  }
  if (!isFiniteNumber(rawSkill.powerCost)) {
    warn(`"${heroId}" skill "${id}" is missing powerCost; defaulting to 0.`);
  }

  return {
    id,
    slot,
    displayName: String(rawSkill.displayName || id),
    description: String(rawSkill.description || ''),
    icon: safeRelativePath(rawSkill.icon),
    type,
    cooldown: Math.max(0, Number(rawSkill.cooldown) || 0),
    powerCost: Math.max(0, Number(rawSkill.powerCost) || 0),
    damage: Math.max(0, Number(rawSkill.damage) || 0),
    startupFrames: Math.round(positive(rawSkill.startupFrames, 8, 1)),
    recoveryFrames: Math.round(positive(rawSkill.recoveryFrames, 16, 1)),
    activeFrames: Math.round(positive(rawSkill.activeFrames, 1, 1)),
    params: rawSkill.params && typeof rawSkill.params === 'object' ? rawSkill.params : {},
    effects: Array.isArray(rawSkill.effects)
      ? rawSkill.effects.filter((effect) => effect && typeof effect.type === 'string')
      : [],
    animation: String(rawSkill.animation || `special${slot === 'ULT' ? '3' : slot.slice(1)}`),
    sound: safeRelativePath(rawSkill.sound),
    custom: !!(custom && typeof custom.execute === 'function')
  };
}

function loadCustomSkills(heroDir, heroId) {
  const file = path.join(heroDir, 'skills.js');
  if (!fs.existsSync(file)) return {};
  try {
    // Reload on each server restart / --watch restart so authors can iterate.
    delete require.cache[require.resolve(file)];
    const loaded = require(file);
    const source = loaded && loaded.skills && typeof loaded.skills === 'object' ? loaded.skills : loaded;
    if (!source || typeof source !== 'object') {
      warn(`"${heroId}" skills.js must export an object of { skillId: { execute } }.`);
      return {};
    }
    const valid = {};
    for (const [id, impl] of Object.entries(source)) {
      if (impl && typeof impl.execute === 'function') {
        valid[id] = impl;
      } else {
        warn(`"${heroId}" skills.js entry "${id}" is missing an execute() function.`);
      }
    }
    return valid;
  } catch (error) {
    warn(`"${heroId}" skills.js failed to load: ${error.message}`);
    return {};
  }
}

function loadCharacterFolder(folderName) {
  const heroDir = path.join(CHARACTERS_DIR, folderName);
  const jsonPath = path.join(heroDir, 'character.json');

  if (!/^[A-Za-z0-9_-]+$/.test(folderName)) {
    warn(`Skipping "${folderName}": folder names may only contain letters, numbers, - and _.`);
    return null;
  }
  if (!fs.existsSync(jsonPath)) {
    warn(`Skipping "${folderName}": missing character.json.`);
    return null;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    warn(`Skipping "${folderName}": invalid JSON (${error.message}).`);
    return null;
  }

  if (!raw || typeof raw !== 'object') {
    warn(`Skipping "${folderName}": character.json must contain an object.`);
    return null;
  }
  if (!raw.stats || typeof raw.stats !== 'object') {
    warn(`Skipping "${folderName}": missing "stats" object.`);
    return null;
  }
  if (!raw.animations || typeof raw.animations !== 'object') {
    warn(`Skipping "${folderName}": missing "animations" object.`);
    return null;
  }
  if (!raw.moves || typeof raw.moves !== 'object' || !raw.moves.light || !raw.moves.heavy) {
    warn(`Skipping "${folderName}": "moves.light" and "moves.heavy" are required.`);
    return null;
  }
  if (!Array.isArray(raw.skills)) {
    warn(`Skipping "${folderName}": "skills" must be an array.`);
    return null;
  }

  const maxHealth = positive(raw.stats.maxHealth, 1000, 100);
  const walkSpeed = positive(raw.stats.walkSpeed, 4, 0.5);
  const jumpPower = positive(raw.stats.jumpPower, 16, 4);
  const weight = positive(raw.stats.weight, 1, 0.1);

  const customSkills = loadCustomSkills(heroDir, folderName);

  const animations = { ...DEFAULT_ANIMATIONS };
  for (const [name, config] of Object.entries(raw.animations)) {
    animations[name] = validateAnimation(name, config, heroDir);
  }
  for (const name of REQUIRED_ANIMATIONS) {
    if (!raw.animations[name]) {
      warn(`"${folderName}" has no "${name}" animation; using a generated default.`);
    }
  }

  const moves = {
    light: validateMove('light', raw.moves.light, folderName),
    heavy: validateMove('heavy', raw.moves.heavy, folderName)
  };

  const skills = [];
  const usedSlots = new Set();
  raw.skills.forEach((skill, index) => {
    const validated = validateSkill(skill, folderName, customSkills, index);
    if (!validated) return;
    if (usedSlots.has(validated.slot)) {
      warn(`"${folderName}" has duplicate slot ${validated.slot} for skill "${validated.id}"; skipping.`);
      return;
    }
    usedSlots.add(validated.slot);
    skills.push(validated);
  });
  if (skills.length < 4) {
    warn(`"${folderName}" has ${skills.length}/4 valid skills. Missing slots: ${SKILL_SLOTS.filter((s) => !usedSlots.has(s)).join(', ') || 'none'}.`);
  }

  const portrait = safeRelativePath(raw.portrait);
  if (portrait && !fs.existsSync(path.join(heroDir, portrait))) {
    warn(`"${folderName}" portrait not found (${portrait}); using a generated fallback.`);
  }

  const character = {
    id: folderName,
    name: String(raw.name || folderName),
    displayName: String(raw.displayName || raw.name || folderName),
    tagline: String(raw.tagline || ''),
    description: String(raw.description || ''),
    portrait,
    theme: {
      primary: String(raw.theme?.primary || '#ff7a18'),
      accent: String(raw.theme?.accent || '#ffd166'),
      glow: String(raw.theme?.glow || 'rgba(255,122,24,0.55)')
    },
    stats: { maxHealth: Math.round(maxHealth), walkSpeed, jumpPower, weight },
    animations,
    moves,
    skills,
    skillsBySlot: Object.fromEntries(skills.map((skill) => [skill.slot, skill])),
    customSkills,
    assetBase: `/characters/${folderName}/`,
    dir: heroDir
  };

  if (raw.name && raw.name !== folderName) {
    warn(`"${folderName}": name "${raw.name}" differs from folder name; using folder name as the hero id.`);
  }

  return character;
}

class CharacterLoader {
  constructor() {
    this.characters = new Map();
    this.lastScan = 0;
  }

  load() {
    this.characters.clear();
    this.lastScan = Date.now();

    let entries = [];
    try {
      entries = fs.readdirSync(CHARACTERS_DIR, { withFileTypes: true });
    } catch (error) {
      console.error(`[characters] Could not read ${CHARACTERS_DIR}: ${error.message}`);
      return this;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const character = loadCharacterFolder(entry.name);
      if (!character) continue;
      this.characters.set(character.id, character);
    }

    console.log(`[characters] Loaded ${this.characters.size} hero(es): ${[...this.characters.keys()].join(', ') || 'none'}`);
    return this;
  }

  get(id) {
    return this.characters.get(id) || null;
  }

  getPublic(id) {
    const character = this.get(id);
    return character ? this.toPublic(character) : null;
  }

  all() {
    return [...this.characters.values()];
  }

  toPublic(character) {
    return {
      id: character.id,
      name: character.name,
      displayName: character.displayName,
      tagline: character.tagline,
      description: character.description,
      portrait: character.assetBase + (character.portrait || ''),
      theme: character.theme,
      stats: character.stats,
      animations: Object.fromEntries(
        Object.entries(character.animations).map(([name, anim]) => [
          name,
          { ...anim, sprite: anim.sprite ? character.assetBase + anim.sprite : '' }
        ])
      ),
      moves: character.moves,
      skills: character.skills.map((skill) => ({
        ...skill,
        icon: skill.icon ? character.assetBase + skill.icon : '',
        sound: skill.sound ? character.assetBase + skill.sound : ''
      })),
      assetBase: character.assetBase
    };
  }

  allPublic() {
    return this.all().map((character) => this.toPublic(character));
  }

  validateAll() {
    return this.allPublic();
  }
}

module.exports = {
  CharacterLoader,
  CHARACTERS_DIR,
  KNOWN_SKILL_TYPES,
  SKILL_SLOTS,
  DEFAULT_ANIMATION,
  DEFAULT_ANIMATIONS,
  DEFAULT_MOVE
};
