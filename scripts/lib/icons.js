'use strict';

/** Procedural portraits and skill icons. */

const { Bitmap, blitScaled, parseColor } = require('./bitmap');
const { drawFighter, paletteFor, shade, mix } = require('./fighter');

function lerpColor(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return [
    Math.round(ca[0] + (cb[0] - ca[0]) * t),
    Math.round(ca[1] + (cb[1] - ca[1]) * t),
    Math.round(ca[2] + (cb[2] - ca[2]) * t),
    255
  ];
}

function verticalGradient(bmp, top, bottom) {
  for (let y = 0; y < bmp.height; y += 1) {
    const color = lerpColor(top, bottom, y / Math.max(1, bmp.height - 1));
    bmp.fillRect(0, y, bmp.width, 1, color);
  }
}

function roundedRect(bmp, x, y, w, h, r, color, alpha = 1) {
  bmp.fillRect(x + r, y, w - r * 2, h, color, alpha);
  bmp.fillRect(x, y + r, w, h - r * 2, color, alpha);
  bmp.circle(x + r, y + r, r, color, alpha);
  bmp.circle(x + w - r - 1, y + r, r, color, alpha);
  bmp.circle(x + r, y + h - r - 1, r, color, alpha);
  bmp.circle(x + w - r - 1, y + h - r - 1, r, color, alpha);
}

function ring(bmp, cx, cy, radius, thickness, color, alpha = 1) {
  const steps = Math.max(32, Math.round(radius * 2.4));
  const c = parseColor(color);
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    for (let t = 0; t < thickness; t += 0.7) {
      bmp.blend(
        Math.round(cx + Math.cos(a) * (radius - t)),
        Math.round(cy + Math.sin(a) * (radius - t)),
        c,
        alpha
      );
    }
  }
}

function drawPortrait(hero) {
  const theme = paletteFor(hero);
  const bmp = new Bitmap(256, 256);
  verticalGradient(bmp, shade(theme.primary, 0.18), '#070710');
  bmp.glow(132, 128, 118, theme.primary, 0.22);
  ring(bmp, 128, 126, 94, 2.4, theme.accent, 0.18);
  ring(bmp, 128, 126, 72, 1.4, theme.primary, 0.24);

  // Angular backdrop shapes.
  bmp.polygon([[0, 196], [256, 112], [256, 256], [0, 256]], shade(theme.primary, 0.26), 0.65);
  bmp.polygon([[0, 236], [256, 160], [256, 256], [0, 256]], '#06060c', 0.5);
  for (let i = 0; i < 5; i += 1) {
    bmp.line(16 + i * 9, 210 + i * 2, 118 + i * 8, 52 + i * 6, 1, theme.accent, 0.1);
  }

  const fighter = new Bitmap(96, 96);
  drawFighter(fighter, 0, 0, 'idle', 0, 6, hero);
  blitScaled(bmp, fighter, 24, 22, 2.2, false);

  // Frame and corner brackets.
  bmp.fillRect(0, 0, 256, 4, '#05050b');
  bmp.fillRect(0, 252, 256, 4, '#05050b');
  bmp.fillRect(0, 0, 4, 256, '#05050b');
  bmp.fillRect(252, 0, 4, 256, '#05050b');
  for (const [x, y, sx, sy] of [[8, 8, 1, 1], [248, 8, -1, 1], [8, 248, 1, -1], [248, 248, -1, -1]]) {
    bmp.line(x, y, x + sx * 30, y, 2, theme.accent, 0.8);
    bmp.line(x, y, x, y + sy * 30, 2, theme.accent, 0.8);
  }
  bmp.fillRect(12, 222, 84, 3, theme.primary, 0.75);
  bmp.fillRect(12, 229, 48, 2, theme.accent, 0.5);

  return bmp;
}

function drawSymbol(bmp, hero, skill) {
  const theme = paletteFor(hero);
  const id = String(skill.id || '').toLowerCase();
  const type = String(skill.type || '').toLowerCase();
  const cx = 64;
  const cy = 64;

  bmp.glow(cx, cy, 42, theme.primary, 0.18);

  if (type === 'projectile' || id.includes('fireball') || id.includes('shuriken')) {
    if (id.includes('shuriken')) {
      bmp.polygon([
        [cx, cy - 30], [cx + 9, cy - 8], [cx + 30, cy], [cx + 9, cy + 8],
        [cx, cy + 30], [cx - 9, cy + 8], [cx - 30, cy], [cx - 9, cy - 8]
      ], '#161022');
      bmp.polygon([
        [cx, cy - 26], [cx + 7, cy - 7], [cx + 26, cy], [cx + 7, cy + 7],
        [cx, cy + 26], [cx - 7, cy + 7], [cx - 26, cy], [cx - 7, cy - 7]
      ], theme.primary);
      bmp.circle(cx, cy, 10, '#161022');
      bmp.circle(cx, cy, 5, theme.accent);
      bmp.circle(cx - 2, cy - 2, 2, '#ffffff');
    } else {
      bmp.polygon([
        [cx - 26, cy - 24], [cx - 6, cy - 10], [cx + 8, cy - 22], [cx + 4, cy - 2],
        [cx + 28, cy], [cx + 4, cy + 6], [cx + 10, cy + 24], [cx - 5, cy + 10],
        [cx - 24, cy + 26], [cx - 12, cy + 5], [cx - 30, cy]
      ], theme.primaryDark, 0.9);
      bmp.glow(cx, cy, 28, theme.primary, 0.3);
      bmp.circle(cx, cy, 18, '#161022');
      bmp.circle(cx, cy, 14, theme.primary);
      bmp.circle(cx - 4, cy - 5, 5, theme.accent);
      bmp.circle(cx - 6, cy - 7, 2.2, '#ffffff');
    }
  } else if (type === 'dash_attack') {
    for (let i = 0; i < 3; i += 1) {
      const x = 24 + i * 20;
      bmp.polygon([
        [x, cy - 22], [x + 16, cy], [x, cy + 22], [x + 5, cy], [x - 8, cy - 16]
      ], i === 2 ? theme.accent : theme.primary, 0.95 - i * 0.18);
    }
    for (let i = 0; i < 4; i += 1) {
      bmp.line(10, 36 + i * 18, 38, 36 + i * 18, 1.4, theme.accent, 0.4);
    }
  } else if (type === 'area_attack' || id.includes('uppercut')) {
    bmp.glow(cx, cy + 6, 34, theme.accent, 0.25);
    bmp.polygon([
      [cx, cy - 42], [cx + 12, cy - 8], [cx + 34, cy + 4], [cx + 10, cy + 14],
      [cx + 18, cy + 38], [cx, cy + 22], [cx - 18, cy + 38], [cx - 10, cy + 14],
      [cx - 34, cy + 4], [cx - 12, cy - 8]
    ], theme.primary);
    bmp.polygon([
      [cx, cy - 34], [cx + 7, cy - 6], [cx + 24, cy + 1], [cx + 6, cy + 9],
      [cx + 10, cy + 28], [cx, cy + 15], [cx - 10, cy + 28], [cx - 6, cy + 9],
      [cx - 24, cy + 1], [cx - 7, cy - 6]
    ], theme.accent);
    bmp.circle(cx, cy, 8, '#161022');
    bmp.circle(cx, cy, 4, theme.primary);
  } else if (type === 'teleport') {
    ring(bmp, cx, cy, 34, 4, theme.primary, 0.9);
    ring(bmp, cx, cy, 25, 2, theme.accent, 0.65);
    ring(bmp, cx, cy, 16, 2, theme.primary, 0.5);
    bmp.polygon([[cx - 3, cy - 30], [cx + 18, cy], [cx - 3, cy + 30], [cx + 4, cy], [cx - 12, cy - 20]], theme.accent, 0.9);
    bmp.circle(cx + 12, cy + 12, 2.4, theme.accent);
  } else if (type === 'debuff' || id.includes('poison')) {
    bmp.polygon([
      [cx, cy - 34], [cx + 18, cy - 6], [cx + 22, cy + 8], [cx + 12, cy + 26],
      [cx - 10, cy + 26], [cx - 22, cy + 8], [cx - 16, cy - 8]
    ], '#161022');
    bmp.polygon([
      [cx, cy - 27], [cx + 14, cy - 4], [cx + 16, cy + 8], [cx + 8, cy + 20],
      [cx - 7, cy + 20], [cx - 16, cy + 8], [cx - 11, cy - 5]
    ], '#84cc16');
    bmp.circle(cx - 5, cy + 2, 5, theme.accent);
    bmp.circle(cx + 7, cy + 10, 2.4, '#ffffff', 0.7);
    for (const [x, y, r] of [[cx + 22, cy - 20, 4], [cx + 31, cy - 9, 2.4], [cx - 29, cy - 14, 3]]) {
      bmp.circle(x, y, r, '#84cc16', 0.6);
    }
  } else if (type === 'shield') {
    bmp.polygon([
      [cx, cy - 34], [cx + 28, cy - 22], [cx + 24, cy + 10], [cx, cy + 36],
      [cx - 24, cy + 10], [cx - 28, cy - 22]
    ], '#161022');
    bmp.polygon([
      [cx, cy - 26], [cx + 20, cy - 17], [cx + 17, cy + 6], [cx, cy + 27],
      [cx - 17, cy + 6], [cx - 20, cy - 17]
    ], theme.primary);
    bmp.line(cx, cy - 20, cx, cy + 20, 2.4, theme.accent, 0.8);
    bmp.line(cx - 12, cy - 6, cx + 12, cy - 6, 2.4, theme.accent, 0.8);
  } else if (type === 'heal') {
    bmp.circle(cx, cy, 34, '#161022');
    bmp.circle(cx, cy, 29, theme.primaryDark);
    bmp.fillRect(cx - 7, cy - 22, 14, 44, '#ffffff', 0.9);
    bmp.fillRect(cx - 22, cy - 7, 44, 14, '#ffffff', 0.9);
    bmp.circle(cx, cy, 5, theme.accent);
  } else if (type === 'buff') {
    bmp.circle(cx, cy + 10, 28, theme.primaryDark, 0.85);
    for (let i = 0; i < 3; i += 1) {
      bmp.polygon([
        [cx, cy - 34 + i * -1], [cx + 15, cy - 12 + i * 10], [cx + 5, cy - 12 + i * 10],
        [cx + 5, cy + 4 + i * 10], [cx - 5, cy + 4 + i * 10], [cx - 5, cy - 12 + i * 10], [cx - 15, cy - 12 + i * 10]
      ], i === 2 ? theme.accent : theme.primary, 0.6 + i * 0.18);
    }
  } else if (type === 'grab') {
    bmp.circle(cx, cy + 8, 26, theme.primaryDark);
    for (let i = 0; i < 4; i += 1) {
      const x = cx - 18 + i * 12;
      bmp.line(x, cy + 20, x - 6, cy - 18, 5, '#161022');
      bmp.line(x, cy + 18, x - 5, cy - 16, 3, theme.primary);
      bmp.circle(x - 4, cy - 18, 2.5, theme.accent);
    }
    bmp.circle(cx, cy + 18, 10, theme.primaryDark);
  } else if (type === 'ultimate') {
    // Starburst.
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      bmp.line(
        cx + Math.cos(angle) * 18, cy + Math.sin(angle) * 18,
        cx + Math.cos(angle) * 48, cy + Math.sin(angle) * 48,
        i % 2 ? 1.2 : 3,
        i % 2 ? theme.accent : theme.primary,
        0.7
      );
    }
    ring(bmp, cx, cy, 22, 3, theme.accent);
    bmp.circle(cx, cy, 16, theme.primary);
    bmp.circle(cx, cy, 8, '#161022');
    bmp.circle(cx, cy, 3, theme.accent);
    // Crown spikes.
    bmp.polygon([
      [cx - 14, cy - 10], [cx - 8, cy - 22], [cx - 1, cy - 12],
      [cx + 5, cy - 24], [cx + 12, cy - 10], [cx + 16, cy + 1], [cx - 16, cy + 1]
    ], theme.accent, 0.75);
  } else {
    ring(bmp, cx, cy, 28, 2.5, theme.primary, 0.8);
    bmp.polygon([
      [cx, cy - 30], [cx + 24, cy + 20], [cx - 24, cy + 20]
    ], theme.primary, 0.8);
    bmp.circle(cx, cy, 8, theme.accent);
  }
}

function drawSkillIcon(hero, skill) {
  const theme = paletteFor(hero);
  const bmp = new Bitmap(128, 128);
  verticalGradient(bmp, '#171327', '#07070d');
  // Venom gets a green tint regardless of hero palette.
  if (String(skill.id).includes('poison') || skill.type === 'debuff') {
    verticalGradient(bmp, '#17230e', '#070d06');
  }
  bmp.glow(64, 62, 56, theme.primary, 0.16);
  for (let i = 0; i < 6; i += 1) {
    bmp.line(8, 20 + i * 18, 120, 4 + i * 20, 1, theme.accent, 0.04);
  }
  roundedRect(bmp, 5, 5, 118, 118, 18, '#05050b', 0.75);
  ring(bmp, 64, 64, 56, 1.2, theme.accent, 0.25);
  drawSymbol(bmp, hero, skill);
  roundedRect(bmp, 4, 4, 120, 120, 18, theme.accent, 0.12);
  // Corner cuts.
  bmp.fillRect(4, 4, 20, 3, theme.accent, 0.85);
  bmp.fillRect(4, 4, 3, 20, theme.accent, 0.85);
  bmp.fillRect(104, 121, 20, 3, theme.primary, 0.85);
  bmp.fillRect(121, 104, 3, 20, theme.primary, 0.85);
  return bmp;
}

module.exports = { drawPortrait, drawSkillIcon, ring, roundedRect, verticalGradient };
