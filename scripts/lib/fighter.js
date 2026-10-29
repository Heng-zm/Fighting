'use strict';

/**
 * Procedural placeholder fighter art. Every hero still uses the same JSON-driven
 * animation system; these drawings simply avoid shipping binary art in the repo.
 */

const { parseColor } = require('./bitmap');

function shade(color, factor = 0.6) {
  const [r, g, b, a] = parseColor(color);
  return [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor), a];
}

function mix(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  return [
    Math.round(ca[0] + (cb[0] - ca[0]) * t),
    Math.round(ca[1] + (cb[1] - ca[1]) * t),
    Math.round(ca[2] + (cb[2] - ca[2]) * t),
    255
  ];
}

function paletteFor(hero) {
  const primary = parseColor(hero.theme?.primary || '#ff6a00');
  const accent = parseColor(hero.theme?.accent || '#ffd166');
  const isShade = hero.id === 'shade';
  return {
    primary,
    primaryDark: shade(primary, 0.5),
    primaryLight: mix(primary, '#ffffff', 0.24),
    accent,
    accentDark: shade(accent, 0.6),
    outline: [18, 11, 20, 255],
    skin: isShade ? [209, 190, 232, 255] : [242, 172, 124, 255],
    skinDark: isShade ? [151, 129, 180, 255] : [194, 120, 82, 255],
    cloth: isShade ? [28, 20, 46, 255] : [58, 22, 18, 255],
    boot: isShade ? [17, 13, 28, 255] : [40, 15, 13, 255],
    hair: isShade ? [91, 55, 168, 255] : [255, 138, 36, 255],
    aura: [...primary.slice(0, 3), 255]
  };
}

function segment(bmp, a, b, color, width, outline = true) {
  if (outline) bmp.line(a.x, a.y, b.x, b.y, width + 3, [18, 11, 20, 255]);
  bmp.line(a.x, a.y, b.x, b.y, width, color);
  // A warm edge and a cool core shadow give the flat pixel rig some volume.
  bmp.line(
    a.x - 0.55,
    a.y - 0.65,
    b.x - 0.55,
    b.y - 0.65,
    Math.max(1, width * 0.27),
    mix(color, '#ffffff', 0.24),
    0.3
  );
  bmp.line(
    a.x + 0.6,
    a.y + 0.7,
    b.x + 0.6,
    b.y + 0.7,
    Math.max(1, width * 0.24),
    shade(color, 0.68),
    0.32
  );
}

function drawFoot(bmp, foot, color) {
  bmp.ellipse(foot.x + 2, foot.y - 1, 5.5, 3, [18, 11, 20, 255]);
  bmp.ellipse(foot.x + 2, foot.y - 1.5, 4.5, 2.3, color);
  bmp.ellipse(foot.x + 2, foot.y - 2.1, 3.4, 0.9, mix(color, '#ffffff', 0.32), 0.38);
  bmp.ellipse(foot.x + 2, foot.y - 0.1, 4.1, 0.75, [8, 5, 8, 255], 0.5);
  bmp.circle(foot.x + 5.4, foot.y - 1.4, 0.65, mix(color, '#ffffff', 0.5), 0.55);
}

function drawAura(bmp, cx, cy, radius, color, accentColor, strength = 0.16) {
  bmp.glow(cx, cy, radius, color, strength);
  for (let i = 0; i < 3; i += 1) {
    const r = radius * (0.55 + i * 0.18);
    bmp.ellipse(cx, cy, r, r * 0.9, color, 0.05);
  }
  bmp.ellipse(cx, cy, radius * 0.34, radius * 0.34, accentColor, 0.12);
}

/**
 * Draw one animation frame. Art is authored in a 96x96 cell with feet at y=89.
 */
function drawFighter(bmp, ox, oy, animName, frame, frameCount, hero) {
  const theme = paletteFor(hero);
  const count = Math.max(1, frameCount || 1);
  const phase = (frame / count) * Math.PI * 2;
  const isShade = hero.id === 'shade';
  const anim = animName || 'idle';

  // Base joint positions (96x96 canvas, facing right).
  const hip = { x: 48, y: 64 };
  let neck = { x: 48, y: 37 };
  let head = { x: 48, y: 26 };
  let lean = 0;
  let bob = 0;

  let backKnee = { x: 43, y: 76 };
  let backFoot = { x: 38, y: 89 };
  let frontKnee = { x: 54, y: 76 };
  let frontFoot = { x: 59, y: 89 };
  let backElbow = { x: 36, y: 50 };
  let backHand = { x: 41, y: 61 };
  let frontElbow = { x: 61, y: 49 };
  let frontHand = { x: 58, y: 60 };
  let specialOrb = null;
  let kick = false;

  if (anim === 'idle') {
    bob = Math.sin(phase) * 1.2;
    neck.y += bob;
    head.y += bob;
    frontHand.x += Math.sin(phase) * 1.4;
    frontHand.y += bob * 0.8;
    backHand.x -= Math.sin(phase) * 0.7;
    backHand.y += bob * 0.5;
  } else if (anim === 'walk') {
    const swing = Math.sin(phase);
    lean = 2;
    bob = Math.abs(Math.cos(phase)) * 1.1;
    neck.y += bob;
    head.y += bob;
    hip.y += bob * 0.3;
    frontKnee.x = 54 + swing * 4;
    frontFoot.x = 59 + swing * 9;
    frontFoot.y = 89 - Math.max(0, swing) * 2.5;
    backKnee.x = 43 - swing * 4;
    backFoot.x = 38 - swing * 9;
    backFoot.y = 89 - Math.max(0, -swing) * 2;
    frontHand.x -= swing * 4;
    backHand.x += swing * 4;
    frontElbow.x += swing * 2;
    backElbow.x -= swing * 2;
  } else if (anim === 'jump') {
    hip.y = 62;
    neck = { x: 48, y: 33 };
    head = { x: 48, y: 22 };
    frontKnee = { x: 58, y: 68 };
    frontFoot = { x: 67, y: 72 };
    backKnee = { x: 38, y: 66 };
    backFoot = { x: 31, y: 75 };
    frontElbow = { x: 62, y: 34 };
    frontHand = { x: 69, y: 23 };
    backElbow = { x: 35, y: 34 };
    backHand = { x: 27, y: 26 };
  } else if (anim === 'crouch') {
    hip.y = 70;
    neck = { x: 49, y: 48 };
    head = { x: 50, y: 38 };
    lean = 1;
    frontKnee = { x: 60, y: 79 };
    frontFoot = { x: 68, y: 89 };
    backKnee = { x: 35, y: 80 };
    backFoot = { x: 31, y: 89 };
    frontElbow = { x: 60, y: 54 };
    frontHand = { x: 66, y: 58 };
    backElbow = { x: 38, y: 55 };
    backHand = { x: 45, y: 58 };
  } else if (anim === 'block') {
    lean = -2;
    frontKnee = { x: 56, y: 76 };
    frontFoot = { x: 62, y: 89 };
    backKnee = { x: 40, y: 76 };
    backFoot = { x: 34, y: 89 };
    frontElbow = { x: 62, y: 45 };
    frontHand = { x: 69, y: 38 };
    backElbow = { x: 40, y: 48 };
    backHand = { x: 58, y: 44 };
  } else if (anim === 'light') {
    const ext = Math.sin(Math.min(1, (frame + 1) / Math.max(2, count)) * Math.PI);
    lean = 2 + ext * 3;
    frontElbow = { x: 62 + ext * 9, y: 43 };
    frontHand = { x: 64 + ext * 23, y: 42 };
    backElbow = { x: 38, y: 52 };
    backHand = { x: 43, y: 60 };
    frontKnee = { x: 56, y: 76 };
    frontFoot = { x: 62, y: 89 };
    if (ext > 0.55) specialOrb = { x: frontHand.x + 4, y: frontHand.y, radius: 3, color: theme.accent, alpha: 0.35 };
  } else if (anim === 'heavy') {
    const ext = Math.min(1, Math.sin(Math.min(1, (frame + 1) / Math.max(2, count)) * Math.PI) * 1.15);
    kick = ext > 0.35;
    lean = -2 - ext * 4;
    neck.x -= ext * 2;
    head.x -= ext * 3;
    hip.x -= ext * 2;
    frontKnee = { x: 54 + ext * 16, y: 67 - ext * 6 };
    frontFoot = { x: 60 + ext * 29, y: 61 - ext * 8 };
    backKnee = { x: 44, y: 78 };
    backFoot = { x: 40, y: 89 };
    frontElbow = { x: 55 - ext * 4, y: 48 };
    frontHand = { x: 62 - ext * 6, y: 44 };
    backElbow = { x: 35, y: 48 };
    backHand = { x: 28, y: 41 };
    if (ext > 0.6) specialOrb = { x: frontFoot.x + 2, y: frontFoot.y, radius: 4.5, color: theme.accent, alpha: 0.4 };
  } else if (anim === 'hit') {
    lean = -6;
    neck.y = 38;
    head = { x: 42, y: 26 };
    frontKnee = { x: 58, y: 78 };
    frontFoot = { x: 66, y: 89 };
    backKnee = { x: 40, y: 78 };
    backFoot = { x: 32, y: 89 };
    frontElbow = { x: 70, y: 34 };
    frontHand = { x: 77, y: 30 };
    backElbow = { x: 30, y: 44 };
    backHand = { x: 21, y: 40 };
  } else if (anim === 'ko') {
    drawKO(bmp, ox, oy, hero, theme, isShade);
    return;
  } else if (anim === 'special1') {
    const ext = Math.sin(Math.min(1, (frame + 1) / Math.max(2, count)) * Math.PI);
    lean = 2;
    frontElbow = { x: 63, y: 42 };
    frontHand = { x: 70 + ext * 10, y: 38 };
    backElbow = { x: 37, y: 51 };
    backHand = { x: 43, y: 59 };
    frontKnee = { x: 58, y: 76 };
    frontFoot = { x: 64, y: 89 };
    backFoot = { x: 34, y: 89 };
    specialOrb = { x: frontHand.x + 5, y: frontHand.y, radius: 6 + ext * 3, color: theme.primary, alpha: 0.9 };
  } else if (anim === 'special2') {
    lean = 11;
    hip.x = 44;
    neck = { x: 58, y: 38 };
    head = { x: 62, y: 27 };
    backKnee = { x: 36, y: 80 };
    backFoot = { x: 20, y: 86 };
    frontKnee = { x: 40, y: 71 };
    frontFoot = { x: 26, y: 81 };
    backElbow = { x: 38, y: 42 };
    backHand = { x: 30, y: 48 };
    frontElbow = { x: 66, y: 34 };
    frontHand = { x: 76, y: 32 };
    specialOrb = { x: 44, y: 60, radius: 18, color: theme.primary, alpha: 0.18 };
  } else if (anim === 'special3') {
    if (isShade) {
      lean = 4;
      frontElbow = { x: 64, y: 45 };
      frontHand = { x: 82, y: 46 };
      backElbow = { x: 58, y: 51 };
      backHand = { x: 73, y: 54 };
      frontKnee = { x: 58, y: 78 };
      frontFoot = { x: 64, y: 89 };
      backFoot = { x: 33, y: 89 };
      specialOrb = { x: 87, y: 47, radius: 7, color: [132, 204, 22, 255], alpha: 0.9 };
    } else {
      hip.y = 68;
      neck = { x: 49, y: 42 };
      head = { x: 50, y: 31 };
      lean = 1;
      frontElbow = { x: 59, y: 32 };
      frontHand = { x: 64, y: 10 };
      backElbow = { x: 36, y: 49 };
      backHand = { x: 41, y: 59 };
      frontKnee = { x: 61, y: 78 };
      frontFoot = { x: 66, y: 89 };
      backKnee = { x: 37, y: 80 };
      backFoot = { x: 32, y: 89 };
      specialOrb = { x: 64, y: 7, radius: 7, color: theme.primary, alpha: 0.8 };
    }
  } else if (anim === 'ult') {
    const pulse = 0.65 + Math.sin(phase) * 0.25;
    neck = { x: 48, y: 36 };
    head = { x: 48, y: 25 };
    frontElbow = { x: 66, y: 28 };
    frontHand = { x: 80, y: 11 };
    backElbow = { x: 30, y: 28 };
    backHand = { x: 16, y: 11 };
    frontKnee = { x: 58, y: 75 };
    frontFoot = { x: 65, y: 89 };
    backKnee = { x: 38, y: 75 };
    backFoot = { x: 31, y: 89 };
    specialOrb = { x: 48, y: 52, radius: 22, color: theme.primary, alpha: 0.15 + pulse * 0.08 };
  } else {
    bob = Math.sin(phase) * 1.2;
    neck.y += bob;
    head.y += bob;
  }

  // Lean offsets.
  const leanShift = lean;
  neck.x += leanShift;
  head.x += leanShift * 1.15;
  backKnee.x += leanShift * 0.15;
  backFoot.x += leanShift * 0.15;
  frontKnee.x += leanShift * 0.2;
  frontFoot.x += leanShift * 0.2;

  const shoulderY = neck.y + 4;
  const backShoulder = { x: neck.x - 6, y: shoulderY };
  const frontShoulder = { x: neck.x + 6, y: shoulderY };
  const armYShift = neck.y - 37;
  const shiftPoint = (p, dx = 0, dy = 0) => ({ x: p.x + dx, y: p.y + dy });
  backElbow = shiftPoint(backElbow, leanShift, armYShift);
  backHand = shiftPoint(backHand, leanShift, armYShift);
  frontElbow = shiftPoint(frontElbow, leanShift, armYShift);
  frontHand = shiftPoint(frontHand, leanShift, armYShift);

  const activeAura = ['special1', 'special2', 'special3', 'ult'].includes(anim);
  const auraStrength = anim === 'ult' ? 0.3 : 0.14;

  // Background aura.
  if (activeAura) {
    drawAura(bmp, ox + 48, oy + 48, anim === 'ult' ? 42 : 31, theme.primary, theme.accent, auraStrength);
  }

  // Motion streaks behind dashes.
  if (anim === 'special2') {
    for (let i = 0; i < 3; i += 1) {
      const y = 48 + i * 13;
      bmp.line(ox + 4, oy + y, ox + 30 - i * 4, oy + y, 2, theme.accent, 0.5);
    }
  }

  // Scarf / cape behind body.
  if (isShade) {
    bmp.polygon([
      [ox + neck.x - 4, oy + neck.y + 2],
      [ox + neck.x - 22, oy + 74],
      [ox + neck.x - 9, oy + 70],
      [ox + neck.x + 2, oy + neck.y + 10]
    ], theme.primaryDark, 0.95);
    bmp.polygon([
      [ox + neck.x - 7, oy + neck.y + 5],
      [ox + neck.x - 18, oy + 68],
      [ox + neck.x - 12, oy + 64],
      [ox + neck.x - 2, oy + neck.y + 8]
    ], shade(theme.primaryDark, 0.7), 0.5);
    bmp.line(ox + neck.x - 5, oy + neck.y + 5, ox + neck.x - 16, oy + 67, 2, theme.accent, 0.5);
    bmp.line(ox + neck.x - 8, oy + neck.y + 8, ox + neck.x - 18, oy + 66, 0.7, mix(theme.accent, '#ffffff', 0.35), 0.32);
    bmp.line(ox + neck.x - 12, oy + neck.y + 13, ox + neck.x - 20, oy + 64, 0.6, [8, 5, 14, 255], 0.5);
  } else {
    const wave = Math.sin(phase) * 3;
    bmp.line(ox + neck.x - 8, oy + neck.y + 3, ox + neck.x - 22, oy + neck.y + 13 + wave, 3.5, [18, 11, 20, 255]);
    bmp.line(ox + neck.x - 8, oy + neck.y + 3, ox + neck.x - 21, oy + neck.y + 12 + wave, 2, theme.primary);
    bmp.line(ox + neck.x - 7.6, oy + neck.y + 2.2, ox + neck.x - 20.6, oy + neck.y + 11 + wave, 0.7, mix(theme.primary, '#ffffff', 0.42), 0.45);
    bmp.line(ox + neck.x - 21, oy + neck.y + 12 + wave, ox + neck.x - 30, oy + neck.y + 8 - wave, 2, theme.accent);
  }

  // Back limbs.
  segment(bmp, { x: ox + hip.x, y: oy + hip.y }, { x: ox + backKnee.x, y: oy + backKnee.y }, theme.primaryDark, 7);
  segment(bmp, { x: ox + backKnee.x, y: oy + backKnee.y }, { x: ox + backFoot.x, y: oy + backFoot.y }, theme.primaryDark, 6);
  drawFoot(bmp, { x: ox + backFoot.x, y: oy + backFoot.y }, theme.boot);
  segment(bmp, { x: ox + backShoulder.x, y: oy + backShoulder.y }, { x: ox + backElbow.x, y: oy + backElbow.y }, theme.cloth, 6);
  segment(bmp, { x: ox + backElbow.x, y: oy + backElbow.y }, { x: ox + backHand.x, y: oy + backHand.y }, theme.skinDark, 5);
  bmp.circle(ox + backHand.x, oy + backHand.y, 2.7, theme.skinDark);

  // Torso / hips.
  bmp.line(ox + hip.x, oy + hip.y, ox + neck.x, oy + neck.y, 21, [18, 11, 20, 255]);
  bmp.line(ox + hip.x, oy + hip.y, ox + neck.x, oy + neck.y, 17, theme.primaryDark);
  bmp.line(ox + hip.x - 1, oy + hip.y - 3, ox + neck.x, oy + neck.y + 2, 10, theme.primary);
  bmp.line(ox + neck.x - 5, oy + neck.y + 5, ox + hip.x - 3, oy + hip.y - 2, 2, [255, 255, 255, 255], 0.14);
  // Fabric folds and side shading.
  bmp.line(ox + neck.x - 5.5, oy + neck.y + 7, ox + hip.x - 4.5, oy + hip.y - 4, 0.9, [8, 4, 7, 255], 0.42);
  bmp.line(ox + neck.x + 4.5, oy + neck.y + 9, ox + hip.x + 4, oy + hip.y - 3, 0.8, mix(theme.primary, '#ffffff', 0.45), 0.24);
  bmp.line(ox + neck.x + 1, oy + neck.y + 13, ox + hip.x + 1, oy + hip.y - 8, 0.65, [8, 4, 7, 255], 0.35);
  bmp.line(ox + neck.x - 6.5, oy + neck.y + 5, ox + neck.x - 6.5, oy + hip.y - 6, 1.2, shade(theme.primaryDark, 0.72), 0.4);
  bmp.line(ox + neck.x + 6, oy + neck.y + 7, ox + hip.x + 6, oy + hip.y - 7, 1, mix(theme.primary, '#ffffff', 0.3), 0.2);

  // Belt and chest emblem.
  bmp.ellipse(ox + hip.x, oy + hip.y - 1, 10, 3.5, [18, 11, 20, 255]);
  bmp.ellipse(ox + hip.x, oy + hip.y - 1.5, 8, 2.4, theme.accent);
  bmp.circle(ox + hip.x - 6, oy + hip.y - 1.8, 0.9, mix(theme.accent, '#ffffff', 0.4), 0.8);
  bmp.circle(ox + hip.x + 6, oy + hip.y - 1.8, 0.9, mix(theme.accent, '#ffffff', 0.4), 0.8);
  bmp.circle(ox + neck.x + 1, oy + neck.y + 12, 3.4, [18, 11, 20, 255]);
  bmp.circle(ox + neck.x + 1, oy + neck.y + 12, 2.4, theme.accent);
  bmp.circle(ox + neck.x + 0.2, oy + neck.y + 11.2, 0.9, [255, 255, 255, 255], 0.55);

  // Shoulder pads.
  for (const [side, shoulder] of [[-1, backShoulder], [1, frontShoulder]]) {
    const padColor = side > 0 ? theme.primary : theme.primaryDark;
    bmp.circle(ox + shoulder.x, oy + shoulder.y + 1, 5.4, [18, 11, 20, 255]);
    bmp.circle(ox + shoulder.x, oy + shoulder.y, 4.4, padColor);
    bmp.circle(ox + shoulder.x - side * 0.4, oy + shoulder.y + 1.4, 3.2, shade(padColor, 0.78), 0.35);
    bmp.circle(ox + shoulder.x + side * 1.1, oy + shoulder.y - 1.2, 1.8, mix(padColor, '#ffffff', 0.42), 0.4);
    bmp.circle(ox + shoulder.x + side, oy + shoulder.y - 1, 1.6, theme.accent, 0.75);
    bmp.circle(ox + shoulder.x + side * 1.2, oy + shoulder.y - 1.4, 0.65, [255, 255, 255, 255], 0.6);
  }

  // Neck and head.
  bmp.line(ox + neck.x, oy + neck.y + 2, ox + head.x, oy + head.y + 7, 6, [18, 11, 20, 255]);
  bmp.line(ox + neck.x, oy + neck.y + 2, ox + head.x, oy + head.y + 7, 4, theme.skin);

  if (isShade) {
    // Hood.
    bmp.circle(ox + head.x, oy + head.y, 12, [18, 11, 20, 255]);
    bmp.polygon([
      [ox + head.x - 11, oy + head.y + 2],
      [ox + head.x - 2, oy + head.y - 13],
      [ox + head.x + 11, oy + head.y - 4],
      [ox + head.x + 8, oy + head.y + 9],
      [ox + head.x - 6, oy + head.y + 11]
    ], theme.primaryDark);
    bmp.polygon([
      [ox + head.x - 8, oy + head.y + 2],
      [ox + head.x - 3, oy + head.y - 9],
      [ox + head.x + 5, oy + head.y - 4],
      [ox + head.x + 3, oy + head.y + 6],
      [ox + head.x - 4, oy + head.y + 8]
    ], shade(theme.primaryDark, 0.72), 0.75);
    bmp.line(ox + head.x - 1, oy + head.y - 11, ox + head.x + 9, oy + head.y - 3, 1.1, mix(theme.primaryDark, '#9fb4ff', 0.5), 0.42);
    bmp.circle(ox + head.x + 2, oy + head.y + 1, 7.6, theme.skinDark);
    bmp.circle(ox + head.x + 4, oy + head.y + 1, 6.6, theme.skin);
    bmp.circle(ox + head.x + 1.5, oy + head.y - 2, 2.4, mix(theme.skin, '#ffffff', 0.35), 0.3);
    // Glowing eye slits.
    bmp.glow(ox + head.x + 5, oy + head.y + 1, 4.6, theme.accent, 0.18);
    bmp.line(ox + head.x + 2, oy + head.y - 1, ox + head.x + 8, oy + head.y - 2, 2, theme.accent);
    bmp.line(ox + head.x + 2, oy + head.y + 3, ox + head.x + 7, oy + head.y + 2, 1.2, [255, 255, 255, 255], 0.55);
    // Hood point.
    bmp.polygon([
      [ox + head.x - 8, oy + head.y - 6],
      [ox + head.x - 18, oy + head.y + 2],
      [ox + head.x - 7, oy + head.y + 4]
    ], theme.primaryDark);
    bmp.line(ox + head.x - 9, oy + head.y - 4, ox + head.x - 15, oy + head.y + 1, 0.9, mix(theme.primaryDark, '#9fb4ff', 0.45), 0.4);
    bmp.circle(ox + head.x + 7, oy + head.y + 1, 1.2, theme.accent);
    bmp.circle(ox + head.x + 7.2, oy + head.y + 0.7, 0.45, [255, 255, 255, 255], 0.8);
  } else {
    // Spiky hair.
    bmp.polygon([
      [ox + head.x - 10, oy + head.y + 1],
      [ox + head.x - 12, oy + head.y - 9],
      [ox + head.x - 5, oy + head.y - 7],
      [ox + head.x - 5, oy + head.y - 14],
      [ox + head.x + 2, oy + head.y - 8],
      [ox + head.x + 5, oy + head.y - 15],
      [ox + head.x + 9, oy + head.y - 6],
      [ox + head.x + 13, oy + head.y - 8],
      [ox + head.x + 10, oy + head.y + 2]
    ], [18, 11, 20, 255]);
    bmp.circle(ox + head.x, oy + head.y, 9.5, [18, 11, 20, 255]);
    bmp.circle(ox + head.x, oy + head.y, 8.4, theme.skin);
    bmp.polygon([
      [ox + head.x - 8, oy + head.y - 4],
      [ox + head.x - 8, oy + head.y - 10],
      [ox + head.x - 3, oy + head.y - 6],
      [ox + head.x + 1, oy + head.y - 12],
      [ox + head.x + 5, oy + head.y - 6],
      [ox + head.x + 9, oy + head.y - 9],
      [ox + head.x + 8, oy + head.y - 3]
    ], theme.hair);
    bmp.line(ox + head.x - 4, oy + head.y - 8, ox + head.x - 1, oy + head.y - 3, 0.9, mix(theme.hair, '#ffffff', 0.6), 0.55);
    bmp.line(ox + head.x + 2, oy + head.y - 10, ox + head.x + 5, oy + head.y - 5, 0.8, mix(theme.hair, '#ffffff', 0.5), 0.45);
    // Cheek / jaw shading, ear and face highlights.
    bmp.polygon([
      [ox + head.x - 8, oy + head.y - 2],
      [ox + head.x - 7, oy + head.y + 4],
      [ox + head.x - 2, oy + head.y + 7.5],
      [ox + head.x - 1, oy + head.y + 2],
      [ox + head.x - 4.5, oy + head.y - 2]
    ], theme.skinDark, 0.32);
    bmp.circle(ox + head.x - 8.2, oy + head.y + 1.6, 1.7, [18, 11, 20, 255]);
    bmp.circle(ox + head.x - 8.2, oy + head.y + 1.6, 1.1, theme.skinDark);
    bmp.line(ox + head.x + 1.5, oy + head.y - 1.8, ox + head.x + 4.2, oy + head.y - 2.2, 1.1, [48, 27, 20, 255], 0.8);
    bmp.line(ox + head.x + 3.8, oy + head.y + 0.2, ox + head.x + 6.2, oy + head.y - 0.4, 0.8, theme.skinDark, 0.55);
    bmp.ellipse(ox + head.x + 5, oy + head.y + 1.1, 1.7, 1.15, [255, 247, 234, 255]);
    bmp.circle(ox + head.x + 5.3, oy + head.y + 1.1, 0.75, [30, 20, 20, 255]);
    bmp.circle(ox + head.x + 5.65, oy + head.y + 0.75, 0.3, theme.accent);
    bmp.line(ox + head.x + 2.4, oy + head.y - 2.3, ox + head.x + 7, oy + head.y - 2.8, 0.9, [48, 27, 20, 255], 0.7);
    bmp.line(ox + head.x + 2, oy + head.y + 4.5, ox + head.x + 6, oy + head.y + 4, 1.2, theme.skinDark);
  }

  // Front leg.
  segment(bmp, { x: ox + hip.x, y: oy + hip.y }, { x: ox + frontKnee.x, y: oy + frontKnee.y }, theme.cloth, 8);
  segment(bmp, { x: ox + frontKnee.x, y: oy + frontKnee.y }, { x: ox + frontFoot.x, y: oy + frontFoot.y }, theme.primary, 7);
  bmp.circle(ox + frontKnee.x, oy + frontKnee.y, 3.4, [18, 11, 20, 255]);
  bmp.circle(ox + frontKnee.x, oy + frontKnee.y - 0.2, 2.5, theme.primaryDark);
  bmp.circle(ox + frontKnee.x - 0.5, oy + frontKnee.y - 0.9, 0.9, mix(theme.primary, '#ffffff', 0.4), 0.45);
  drawFoot(bmp, { x: ox + frontFoot.x, y: oy + frontFoot.y }, theme.boot);
  if (kick) {
    bmp.line(ox + frontKnee.x, oy + frontKnee.y, ox + frontFoot.x, oy + frontFoot.y, 2, theme.accent, 0.7);
  }

  // Front arm.
  segment(bmp, { x: ox + frontShoulder.x, y: oy + frontShoulder.y }, { x: ox + frontElbow.x, y: oy + frontElbow.y }, theme.cloth, 7);
  segment(bmp, { x: ox + frontElbow.x, y: oy + frontElbow.y }, { x: ox + frontHand.x, y: oy + frontHand.y }, theme.skin, 6);
  bmp.circle(ox + frontElbow.x, oy + frontElbow.y, 2.9, [18, 11, 20, 255]);
  bmp.circle(ox + frontElbow.x - 0.2, oy + frontElbow.y - 0.3, 2.1, theme.primaryDark);
  bmp.circle(ox + frontHand.x, oy + frontHand.y, 3.2, [18, 11, 20, 255]);
  bmp.circle(ox + frontHand.x, oy + frontHand.y, 2.4, theme.skin);
  bmp.line(ox + frontHand.x - 1.2, oy + frontHand.y - 0.4, ox + frontHand.x + 0.8, oy + frontHand.y - 0.8, 0.65, theme.skinDark, 0.55);
  bmp.circle(ox + frontHand.x - 0.6, oy + frontHand.y - 0.6, 0.8, theme.accent, 0.7);

  // Power orb / projectile hand glow.
  if (specialOrb) {
    const gx = ox + specialOrb.x;
    const gy = oy + specialOrb.y;
    bmp.glow(gx, gy, specialOrb.radius * 2.4, specialOrb.color, 0.22 * specialOrb.alpha);
    bmp.circle(gx, gy, specialOrb.radius, [18, 11, 20, 255], specialOrb.alpha);
    bmp.circle(gx, gy, specialOrb.radius * 0.78, specialOrb.color, specialOrb.alpha);
    bmp.circle(gx - specialOrb.radius * 0.2, gy - specialOrb.radius * 0.25, specialOrb.radius * 0.28, [255, 255, 255, 255], specialOrb.alpha * 0.7);
  }
}

/** Fallen KO pose drawn horizontally. */
function drawKO(bmp, ox, oy, hero, theme, isShade) {
  const hx = ox + 23;
  const hy = oy + 80;
  // Legs.
  segment(bmp, { x: ox + 58, y: oy + 82 }, { x: ox + 74, y: oy + 74 }, theme.primaryDark, 7);
  segment(bmp, { x: ox + 74, y: oy + 74 }, { x: ox + 87, y: oy + 78 }, theme.boot, 5);
  segment(bmp, { x: ox + 58, y: oy + 82 }, { x: ox + 77, y: oy + 86 }, theme.cloth, 7);
  segment(bmp, { x: ox + 77, y: oy + 86 }, { x: ox + 89, y: oy + 85 }, theme.boot, 5);

  // Torso.
  bmp.line(ox + 31, oy + 82, ox + 57, oy + 81, 20, [18, 11, 20, 255]);
  bmp.line(ox + 31, oy + 82, ox + 57, oy + 81, 16, theme.primaryDark);
  bmp.line(ox + 33, oy + 80, ox + 54, oy + 80, 8, theme.primary);
  bmp.ellipse(ox + 55, oy + 81, 5, 8, theme.accent);

  // Arms sprawled.
  segment(bmp, { x: ox + 40, y: oy + 82 }, { x: ox + 28, y: oy + 66 }, theme.cloth, 6);
  segment(bmp, { x: ox + 28, y: oy + 66 }, { x: ox + 16, y: oy + 70 }, theme.skin, 5);
  segment(bmp, { x: ox + 46, y: oy + 84 }, { x: ox + 49, y: oy + 93 }, theme.skinDark, 5);

  // Head.
  bmp.circle(ox + 22, oy + 82, 11, [18, 11, 20, 255]);
  bmp.circle(ox + 22, oy + 82, 9, theme.skin);
  if (isShade) {
    bmp.polygon([
      [ox + 13, oy + 78],
      [ox + 22, oy + 70],
      [ox + 31, oy + 79],
      [ox + 28, oy + 88],
      [ox + 15, oy + 87]
    ], theme.primaryDark);
    bmp.circle(ox + 23, oy + 82, 6.6, theme.skinDark);
    bmp.line(ox + 18, oy + 81, ox + 21, oy + 82, 1.2, theme.accent);
  } else {
    bmp.polygon([
      [ox + 13, oy + 79],
      [ox + 16, oy + 69],
      [ox + 23, oy + 74],
      [ox + 28, oy + 71],
      [ox + 30, oy + 80]
    ], theme.hair);
    bmp.line(ox + 18, oy + 82, ox + 21, oy + 83, 1.2, [30, 20, 20, 255]);
    bmp.line(ox + 24, oy + 83, ox + 27, oy + 82, 1.2, [30, 20, 20, 255]);
  }

  // Small stun stars.
  for (let i = 0; i < 3; i += 1) {
    const angle = (Math.PI * 2 * i) / 3;
    bmp.circle(ox + 22 + Math.cos(angle) * 14, oy + 65 + Math.sin(angle) * 4, 1.2, theme.accent, 0.8);
  }
}

module.exports = { drawFighter, paletteFor, drawAura, shade, mix };
