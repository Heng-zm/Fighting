'use strict';

/**
 * Generates placeholder sprite sheets, portraits and skill icons for every
 * character folder that has a character.json. Existing files are preserved
 * unless --force is passed. `npm start` runs this automatically, so fresh clones
 * and newly generated heroes always have usable art.
 */

const fs = require('fs');
const path = require('path');
const { Bitmap, ScaledBitmap, downsample } = require('./lib/bitmap');
const { drawFighter } = require('./lib/fighter');
const { drawPortrait, drawSkillIcon } = require('./lib/icons');
const { encodePNG } = require('./lib/png');

const ROOT = path.join(__dirname, '..');
const CHARACTERS_DIR = path.join(ROOT, 'characters');
const FORCE = process.argv.includes('--force');

function safePath(root, relative) {
  const normalized = String(relative || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  return path.join(root, normalized);
}

function writePng(file, bitmap) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(bitmap.width, bitmap.height, bitmap.data));
}

function generateAnimation(heroDir, hero, name, animation) {
  if (!animation || !animation.sprite) return false;
  const target = safePath(heroDir, animation.sprite);
  if (!target) return false;
  if (!FORCE && fs.existsSync(target)) return false;

  const frameCount = Math.max(1, Math.round(Number(animation.frameCount) || 1));
  const frameWidth = Math.max(16, Math.round(Number(animation.frameWidth) || 96));
  const frameHeight = Math.max(16, Math.round(Number(animation.frameHeight) || 96));
  const sheet = new Bitmap(frameWidth * frameCount, frameHeight);
  const density = frameWidth / 96;
  // Supersample high-density sheets, then box-filter down. This preserves the
  // hand-authored 96-unit rig while giving curved shapes clean anti-aliased
  // edges and leaving polygons/outlines free of stair-steps.
  const supersample = density >= 1.5 ? 2 : 1;
  const renderScale = density * supersample;
  const sourceSize = Math.round(96 * renderScale);
  const yOffset = Math.max(0, Math.round((frameHeight - 96 * density) / 2));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const source = new Bitmap(sourceSize, sourceSize);
    drawFighter(new ScaledBitmap(source, renderScale), 0, 0, name, frame, frameCount, hero);
    const cell = supersample > 1 ? downsample(source, supersample) : source;
    for (let y = 0; y < Math.min(cell.height, frameHeight - yOffset); y += 1) {
      for (let x = 0; x < Math.min(cell.width, frameWidth); x += 1) {
        const si = (y * cell.width + x) * 4;
        const alpha = cell.data[si + 3];
        if (!alpha) continue;
        sheet.blend(frame * frameWidth + x, yOffset + y, [
          cell.data[si],
          cell.data[si + 1],
          cell.data[si + 2],
          alpha
        ]);
      }
    }
  }

  writePng(target, sheet);
  return true;
}

function generateCharacter(folderName) {
  const heroDir = path.join(CHARACTERS_DIR, folderName);
  const jsonPath = path.join(heroDir, 'character.json');
  if (!fs.existsSync(jsonPath)) return { sprites: 0, icons: 0, skipped: true };

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    console.warn(`[assets] Skipping ${folderName}: invalid character.json (${error.message})`);
    return { sprites: 0, icons: 0, skipped: true };
  }

  const hero = {
    id: folderName,
    displayName: raw.displayName || folderName,
    theme: {
      primary: raw.theme?.primary || (folderName === 'shade' ? '#8b5cf6' : '#ff6a00'),
      accent: raw.theme?.accent || (folderName === 'shade' ? '#22d3ee' : '#ffd166')
    }
  };

  let sprites = 0;
  for (const [name, animation] of Object.entries(raw.animations || {})) {
    if (generateAnimation(heroDir, hero, name, animation)) sprites += 1;
  }

  let icons = 0;
  if (raw.portrait) {
    const target = safePath(heroDir, raw.portrait);
    if (target && (FORCE || !fs.existsSync(target))) {
      writePng(target, drawPortrait(hero));
      icons += 1;
    }
  }

  for (const skill of raw.skills || []) {
    if (!skill || !skill.icon) continue;
    const target = safePath(heroDir, skill.icon);
    if (!target) continue;
    if (!FORCE && fs.existsSync(target)) continue;
    writePng(target, drawSkillIcon(hero, skill));
    icons += 1;
  }

  return { sprites, icons, skipped: false };
}

function main() {
  if (!fs.existsSync(CHARACTERS_DIR)) {
    console.log('[assets] No characters/ directory found; nothing to generate.');
    return;
  }
  const entries = fs.readdirSync(CHARACTERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  let totalSprites = 0;
  let totalIcons = 0;
  for (const entry of entries) {
    const result = generateCharacter(entry.name);
    if (result.skipped) continue;
    if (result.sprites || result.icons) {
      console.log(`[assets] ${entry.name}: generated ${result.sprites} sprite sheet(s), ${result.icons} icon(s).`);
    }
    totalSprites += result.sprites;
    totalIcons += result.icons;
  }
  if (totalSprites || totalIcons) {
    console.log(`[assets] Done. ${totalSprites} sprite sheets, ${totalIcons} icons.`);
  }
}

main();
