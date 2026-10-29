/**
 * Canvas renderer.
 *
 * Draws the arena, auto-discovered hero sprites, projectiles, particles,
 * floating damage numbers and cinematic ultimates. The local fighter is
 * predicted from held input; opponents are interpolated from the snapshot
 * stream with a small render delay.
 */

const ARENA = {
  width: 1280,
  height: 720,
  groundY: 620,
  leftBound: 64,
  rightBound: 1216
};

const GRAVITY = 0.92;
const TICK = 1 / 60;
const REMOTE_DELAY_MS = 85;
const SPRITE_SCALE = 2.2;
// The game is authored in a 1280x720 coordinate space. Rendering it into a
// 2560x1440 backing store gives crisp edges and fine texture detail without
// moving a single gameplay coordinate.
const RENDER_SCALE = 2;
const DISPLAY_FONT = '"Arial Black", "Segoe UI Black", Impact, sans-serif';
const UI_FONT = '"Segoe UI", Inter, system-ui, sans-serif';
const MONO_FONT = '"Cascadia Mono", Consolas, monospace';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function parseColor(color) {
  if (typeof color !== 'string') return [255, 255, 255];
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const num = Number.parseInt(hex.slice(0, 6), 16);
    if (Number.isNaN(num)) return [255, 255, 255];
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(',').map((part) => Number.parseFloat(part));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }
  return [255, 255, 255];
}

function rgba(color, alpha = 1) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRectPath(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function drawStar(ctx, x, y, outer, inner, points, rotation, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = rotation + (i * Math.PI) / points;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/**
 * Soft elliptical light / smoke blob. Cheaper and smoother than stacking a
 * dozen translucent circles, and one of the main builders for the atmosphere.
 */
function softBlob(ctx, x, y, rx, ry, color, alpha, rotation = 0) {
  if (alpha <= 0 || rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  if (rotation) ctx.rotate(rotation);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.42, rgba(color, alpha * 0.66));
  gradient.addColorStop(0.72, rgba(color, alpha * 0.22));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Tileable monochrome noise used for stone, wood and film grain. */
function grainPattern(ctx, seed = 1337, size = 160) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const noise = canvas.getContext('2d');
  const image = noise.createImageData(size, size);
  const random = seededRandom(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.round(128 + ((random() + random() + random()) / 3 - 0.5) * 118);
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  noise.putImageData(image, 0, 0);
  return ctx.createPattern(canvas, 'repeat');
}

/**
 * Painted wood with figure, grain lines and a couple of knots. `vertical`
 * controls whether the grain runs up the board or along a beam.
 */
function drawWood(ctx, x, y, w, h, vertical, seed, palette = ['#201014', '#3a1b1c', '#6c3228']) {
  const random = seededRandom(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const base = vertical
    ? ctx.createLinearGradient(x, 0, x + w, 0)
    : ctx.createLinearGradient(0, y, 0, y + h);
  base.addColorStop(0, palette[0]);
  base.addColorStop(0.35, palette[1]);
  base.addColorStop(0.7, palette[1]);
  base.addColorStop(1, palette[0]);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);

  const length = vertical ? h : w;
  const breadth = vertical ? w : h;
  const lineCount = Math.max(6, Math.round(breadth * 0.55));
  for (let i = 0; i < lineCount; i += 1) {
    const lane = (i + 0.25 + random() * 0.5) / lineCount;
    const bright = random() > 0.58;
    ctx.strokeStyle = bright
      ? rgba(palette[2], 0.08 + random() * 0.17)
      : `rgba(4, 2, 4, ${0.18 + random() * 0.24})`;
    ctx.lineWidth = 0.65 + random() * 1.55;
    ctx.beginPath();
    if (vertical) {
      let px = x + lane * w;
      ctx.moveTo(px, y);
      for (let py = y + 10; py <= y + h; py += 10) {
        px += (random() - 0.5) * 1.15;
        ctx.lineTo(px, py);
      }
    } else {
      let py = y + lane * h;
      ctx.moveTo(x, py);
      for (let px = x + 14; px <= x + w; px += 14) {
        py += (random() - 0.5) * 0.85;
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  for (let i = 0; i < 2; i += 1) {
    const kx = x + random() * w;
    const ky = y + random() * h;
    for (let ring = 1; ring <= 3; ring += 1) {
      ctx.strokeStyle = `rgba(8, 4, 5, ${0.16 / ring})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.ellipse(kx, ky, 1.6 * ring, 0.9 * ring, vertical ? 0.35 : -0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const edge = vertical
    ? ctx.createLinearGradient(x, 0, x + w, 0)
    : ctx.createLinearGradient(0, y, 0, y + h);
  edge.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
  edge.addColorStop(0.12, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(0.88, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.48)');
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Masonry wall with bevelled blocks, soot, cracks and mossy seams. */
function drawStoneWall(ctx, x, y, w, h, seed, palette = ['#0c0a12', '#17131d', '#1e1924', '#14111a']) {
  const random = seededRandom(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = palette[0];
  ctx.fillRect(x, y, w, h);

  let rowY = y - 2;
  while (rowY < y + h) {
    const rowH = 15 + random() * 13;
    let bx = x - 40 - random() * 30;
    while (bx < x + w) {
      const bw = 30 + random() * 54;
      const tone = palette[1 + Math.floor(random() * Math.max(1, palette.length - 1))] || palette[1];
      const top = Math.max(y, rowY);
      const bottom = Math.min(y + h, rowY + rowH);
      if (bottom - top > 2) {
        ctx.fillStyle = tone;
        ctx.fillRect(bx + 1, top + 1, bw - 2, bottom - top - 2);
        ctx.fillStyle = `rgba(220, 225, 255, ${0.025 + random() * 0.045})`;
        ctx.fillRect(bx + 2, top + 1, bw - 4, 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(bx + 2, bottom - 2, bw - 4, 1);
        for (let speck = 0; speck < 3; speck += 1) {
          ctx.fillStyle = random() > 0.5
            ? `rgba(190, 195, 220, ${0.035 + random() * 0.05})`
            : 'rgba(0, 0, 0, 0.22)';
          ctx.fillRect(
            bx + 4 + random() * Math.max(1, bw - 8),
            top + 4 + random() * Math.max(1, bottom - top - 9),
            1 + random() * 2,
            1
          );
        }
      }
      bx += bw;
    }
    rowY += rowH;
  }

  // Cracks and damp streaks.
  for (let i = 0; i < 7; i += 1) {
    let cx = x + random() * w;
    let cy = y + random() * h;
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.16 + random() * 0.18})`;
    ctx.lineWidth = 0.6 + random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let step = 0; step < 4; step += 1) {
      cx += (random() - 0.5) * 15;
      cy += random() * 10;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 9; i += 1) {
    softBlob(ctx, x + random() * w, y + h - random() * 20, 12 + random() * 26, 7 + random() * 15, '#17332a', 0.12);
  }

  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = grainPattern(ctx, seed + 7, 140);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Curved pagoda roof with tile ribs and a highlighted eave. */
function drawTiledRoof(ctx, cx, baseY, halfWidth, depth, seed, palette = ['#060710', '#111420', '#1b2030']) {
  const random = seededRandom(seed);
  const topY = baseY - depth;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, baseY + 5);
  ctx.quadraticCurveTo(cx - halfWidth * 0.55, topY - 4, cx, topY);
  ctx.quadraticCurveTo(cx + halfWidth * 0.55, topY - 4, cx + halfWidth, baseY + 5);
  ctx.quadraticCurveTo(cx + halfWidth * 0.62, baseY + 12, cx, baseY + 8);
  ctx.quadraticCurveTo(cx - halfWidth * 0.62, baseY + 12, cx - halfWidth, baseY + 5);
  ctx.closePath();
  const roof = ctx.createLinearGradient(0, topY, 0, baseY + 10);
  roof.addColorStop(0, palette[2]);
  roof.addColorStop(0.55, palette[1]);
  roof.addColorStop(1, palette[0]);
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.clip();

  const tiles = Math.max(11, Math.round(halfWidth / 3));
  for (let i = 0; i <= tiles; i += 1) {
    const t = i / tiles;
    const xTop = cx + (t - 0.5) * halfWidth * 1.06;
    const xEave = cx + (t - 0.5) * halfWidth * 2;
    const yTop = topY + 2 + Math.abs(t - 0.5) * depth * 0.24;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(2, 3, 8, 0.7)' : 'rgba(2, 3, 8, 0.36)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(xTop, yTop);
    ctx.quadraticCurveTo((xTop + xEave) / 2, topY + depth * 0.62, xEave, baseY + 5);
    ctx.stroke();
  }
  for (let band = 1; band <= 3; band += 1) {
    const t = band / 4;
    ctx.strokeStyle = `rgba(160, 180, 210, ${0.045 + random() * 0.02})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 0; i <= 24; i += 1) {
      const u = i / 24;
      const px = cx + (u - 0.5) * halfWidth * (1.05 + t * 0.95);
      const py = topY + t * depth + Math.abs(u - 0.5) * 5;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 196, 128, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, baseY + 5);
  ctx.quadraticCurveTo(cx, baseY + 12, cx + halfWidth, baseY + 5);
  ctx.stroke();
  ctx.restore();

  // Upturned eave tips.
  for (const side of [-1, 1]) {
    const x = cx + side * halfWidth;
    ctx.fillStyle = palette[0];
    ctx.beginPath();
    ctx.moveTo(x, baseY + 2);
    ctx.lineTo(x + side * 7, baseY - 3);
    ctx.lineTo(x + side * 3, baseY + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 186, 110, 0.16)';
    ctx.fillRect(x - (side > 0 ? 8 : 0), baseY + 2, 8, 1);
  }
}

/** Paper lantern with metal caps, ribs, chain and a warm pool of light. */
function drawLantern(ctx, x, y, size, seed) {
  const random = seededRandom(seed);
  const bodyW = size * 0.74;
  const bodyH = size;
  softBlob(ctx, x, y + 2, size * 1.5, size * 1.65, '#ff9b45', 0.13);
  softBlob(ctx, x, y + 1, size * 0.78, size * 0.92, '#ffd08a', 0.15);

  ctx.strokeStyle = 'rgba(26, 17, 16, 0.9)';
  ctx.lineWidth = Math.max(0.8, size * 0.045);
  ctx.beginPath();
  ctx.moveTo(x, y - size * 1.72);
  ctx.lineTo(x, y - bodyH * 0.55);
  ctx.stroke();
  for (let link = 0; link < 4; link += 1) {
    ctx.strokeStyle = 'rgba(96, 72, 52, 0.45)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(x, y - size * 1.64 + link * size * 0.25, 1.2, 1.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#2b1a16';
  ctx.fillRect(x - bodyW * 0.34, y - bodyH * 0.62, bodyW * 0.68, bodyH * 0.15);
  ctx.fillRect(x - bodyW * 0.4, y + bodyH * 0.48, bodyW * 0.8, bodyH * 0.12);

  const paper = ctx.createRadialGradient(x - bodyW * 0.22, y - bodyH * 0.24, 1, x, y, bodyH * 0.72);
  paper.addColorStop(0, '#ffe7b0');
  paper.addColorStop(0.35, '#ffc46a');
  paper.addColorStop(0.72, '#e98b39');
  paper.addColorStop(1, '#8f3f19');
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.ellipse(x, y, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(91, 39, 16, 0.45)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.ellipse(x, y, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(114, 51, 21, 0.55)';
  ctx.lineWidth = 0.7;
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.ellipse(x, y, bodyW * (0.22 + Math.abs(i) * 0.13), bodyH / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.32)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.ellipse(x - bodyW * 0.13, y - bodyH * 0.1, bodyW * 0.2, bodyH * 0.25, -0.2, 0, Math.PI * 2);
  ctx.stroke();

  // Tassel and soot flecks.
  ctx.strokeStyle = '#a34727';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x, y + bodyH * 0.6);
  ctx.lineTo(x, y + bodyH * 0.8);
  ctx.moveTo(x - 2, y + bodyH * 0.7);
  ctx.lineTo(x - 2, y + bodyH * 0.84);
  ctx.moveTo(x + 2, y + bodyH * 0.7);
  ctx.lineTo(x + 2, y + bodyH * 0.84);
  ctx.stroke();
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = `rgba(70, 28, 12, ${0.12 + random() * 0.15})`;
    ctx.fillRect(x + (random() - 0.5) * bodyW * 0.7, y + (random() - 0.5) * bodyH * 0.7, 1, 2);
  }
}

/** Stone-and-iron brazier with layered flame and drifting sparks. */
function drawBrazier(ctx, x, baseY, scale, seed) {
  const random = seededRandom(seed);
  ctx.save();
  ctx.translate(x, baseY);
  ctx.scale(scale, scale);

  // Pedestal.
  const stone = ctx.createLinearGradient(-18, 0, 18, 0);
  stone.addColorStop(0, '#08070b');
  stone.addColorStop(0.45, '#211d27');
  stone.addColorStop(0.7, '#151119');
  stone.addColorStop(1, '#07060a');
  ctx.fillStyle = stone;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(18, 0);
  ctx.lineTo(14, -26);
  ctx.lineTo(-14, -26);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-15, -9);
  ctx.lineTo(15, -9);
  ctx.moveTo(-14, -18);
  ctx.lineTo(14, -18);
  ctx.stroke();
  ctx.fillStyle = '#1c1822';
  ctx.fillRect(-13, -29, 26, 5);
  ctx.fillStyle = 'rgba(225, 225, 245, 0.12)';
  ctx.fillRect(-12, -25, 2, 23);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(9, -24, 2, 22);
  ctx.fillStyle = 'rgba(255, 164, 84, 0.18)';
  ctx.fillRect(-13, -29, 26, 1);

  // Iron bowl.
  const bowl = ctx.createLinearGradient(0, -42, 0, -24);
  bowl.addColorStop(0, '#3b3130');
  bowl.addColorStop(1, '#130f12');
  ctx.fillStyle = bowl;
  ctx.beginPath();
  ctx.moveTo(-22, -42);
  ctx.quadraticCurveTo(0, -30, 22, -42);
  ctx.lineTo(17, -25);
  ctx.quadraticCurveTo(0, -20, -17, -25);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 181, 100, 0.26)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-22, -42);
  ctx.quadraticCurveTo(0, -30, 22, -42);
  ctx.stroke();

  // Flame body.
  softBlob(ctx, 0, -54, 50, 62, '#ff6a1c', 0.18);
  softBlob(ctx, 0, -50, 24, 36, '#ffb347', 0.25);
  const tongues = 7;
  for (let i = 0; i < tongues; i += 1) {
    const fx = (random() - 0.5) * 24;
    const height = 22 + random() * 46;
    const sway = (random() - 0.5) * 10;
    const flame = ctx.createLinearGradient(fx, -26, fx + sway, -26 - height);
    flame.addColorStop(0, 'rgba(255, 94, 18, 0.78)');
    flame.addColorStop(0.55, 'rgba(255, 163, 56, 0.62)');
    flame.addColorStop(1, 'rgba(255, 246, 196, 0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(fx - 7, -28);
    ctx.quadraticCurveTo(fx - 8 + sway * 0.4, -28 - height * 0.6, fx + sway, -28 - height);
    ctx.quadraticCurveTo(fx + 7 + sway * 0.4, -28 - height * 0.52, fx + 7, -28);
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 12; i += 1) {
    const angle = random() * Math.PI * 2;
    const dist = 8 + random() * 34;
    ctx.fillStyle = `rgba(255, ${140 + Math.floor(random() * 80)}, 60, ${0.2 + random() * 0.5})`;
    ctx.fillRect(Math.cos(angle) * dist, -80 - random() * 45, 1.1, 1.1);
  }
  ctx.restore();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderScale = RENDER_SCALE;
    this.pixelWidth = Math.round(ARENA.width * this.renderScale);
    this.pixelHeight = Math.round(ARENA.height * this.renderScale);
    canvas.width = this.pixelWidth;
    canvas.height = this.pixelHeight;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    this.heroes = new Map();
    this.images = new Map();
    this.snapshot = null;
    this.snapshotAt = 0;
    this.playersMeta = new Map();
    this.localId = null;
    this.spectator = false;
    this.match = null;

    this.remoteBuffers = new Map();
    this.projectileVisuals = new Map();
    this.predicted = null;
    this.predictionLocked = false;
    this.prevUp = false;
    this.tickAccumulator = 0;

    this.particles = [];
    this.rings = [];
    this.floaters = [];
    this.emotes = [];
    this.seenEvents = new Set();
    this.screenPositions = new Map();

    // Small offscreen buffer used for the powered-up glow. Downscaling and
    // re-upscaling the sprite is a far cheaper soft blur than ctx.filter,
    // which can stall software rasterizers for seconds on a large canvas.
    this.bloomCanvas = document.createElement('canvas');
    this.bloomCanvas.width = 128;
    this.bloomCanvas.height = 128;
    this.bloomCtx = this.bloomCanvas.getContext('2d');
    this.bloomCtx.imageSmoothingEnabled = true;

    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.flash = { color: '#ffffff', alpha: 0 };
    this.vignettePulse = 0;

    this.ambient = [];
    const random = seededRandom(8917);
    for (let i = 0; i < 72; i += 1) {
      const ember = random() > 0.68;
      this.ambient.push({
        x: random() * ARENA.width,
        y: ember ? 500 + random() * 190 : 410 + random() * 300,
        speed: ember ? 0.28 + random() * 0.58 : 0.05 + random() * 0.22,
        drift: (random() - 0.5) * (ember ? 0.34 : 0.16),
        size: ember ? 0.8 + random() * 1.7 : 0.45 + random() * 1.5,
        alpha: ember ? 0.24 + random() * 0.48 : 0.045 + random() * 0.16,
        hue: ember ? (random() > 0.35 ? '#ff9b45' : '#ffd08a') : (random() > 0.5 ? '#78c9e8' : '#c8b8ff'),
        ember,
        phase: random() * Math.PI * 2
      });
    }

    this.buildBackground();
  }

  // -----------------------------------------------------------------------
  // Asset loading
  // -----------------------------------------------------------------------

  image(url) {
    if (!url) return null;
    if (this.images.has(url)) return this.images.get(url);
    const entry = { img: new Image(), ready: false, failed: false };
    entry.img.onload = () => {
      entry.ready = true;
    };
    entry.img.onerror = () => {
      entry.failed = true;
    };
    entry.img.src = url;
    this.images.set(url, entry);
    return entry;
  }

  ensureHero(hero) {
    if (!hero || !hero.id || this.heroes.has(hero.id)) return;
    this.heroes.set(hero.id, hero);
    for (const animation of Object.values(hero.animations || {})) {
      if (animation && animation.sprite) this.image(animation.sprite);
    }
    this.image(hero.portrait);
  }

  preloadHeroes(heroes) {
    for (const hero of heroes || []) this.ensureHero(hero);
  }

  // -----------------------------------------------------------------------
  // Match lifecycle
  // -----------------------------------------------------------------------

  setMatch(payload) {
    this.match = payload;
    this.spectator = payload.spectator === true;
    this.localId = this.spectator ? null : payload.localId || null;
    this.playersMeta.clear();
    this.remoteBuffers.clear();
    this.projectileVisuals.clear();
    this.particles = [];
    this.rings = [];
    this.floaters = [];
    this.emotes = [];
    this.seenEvents.clear();
    this.screenPositions.clear();
    this.predicted = null;
    this.predictionLocked = false;
    this.prevUp = false;
    this.tickAccumulator = 0;
    this.shake = 0;
    this.flash.alpha = 0;

    for (const player of payload.players || []) {
      const hero = player.hero || this.heroes.get(player.heroId) || null;
      this.ensureHero(hero);
      this.playersMeta.set(player.playerId, {
        playerId: player.playerId,
        nickname: player.nickname,
        heroId: player.heroId,
        hero,
        isBot: player.isBot
      });
    }

    if (payload.state) this.setSnapshot(payload.state, true);
  }

  setSnapshot(snapshot, initial = false) {
    if (!snapshot) return;
    this.snapshot = snapshot;
    this.snapshotAt = performance.now();
    this.addEvents(snapshot.events || []);

    if (initial) {
      this.remoteBuffers.clear();
      this.projectileVisuals.clear();
    }

    const now = performance.now();
    for (const player of snapshot.players || []) {
      const isLocal = !this.spectator && player.id === this.localId;
      if (isLocal) {
        this.reconcile(player, initial);
      } else {
        let buffer = this.remoteBuffers.get(player.id);
        if (!buffer) {
          buffer = [];
          this.remoteBuffers.set(player.id, buffer);
        }
        buffer.push({ t: now, p: player });
        while (buffer.length > 2 && now - buffer[0].t > 1200) buffer.shift();
      }
    }
  }

  reconcile(player, initial) {
    if (initial || !this.predicted) {
      this.predicted = {
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        grounded: player.grounded,
        facing: player.facing
      };
      this.predictionLocked = this.isLocked(player);
      return;
    }

    const locked = this.isLocked(player);
    const dx = player.x - this.predicted.x;
    const dy = player.y - this.predicted.y;

    if (locked || Math.abs(dx) > 140 || Math.abs(dy) > 170) {
      this.predicted.x = player.x;
      this.predicted.y = player.y;
      this.predicted.vx = player.vx;
      this.predicted.vy = player.vy;
      this.predicted.grounded = player.grounded;
    } else {
      const serverMoving = Math.abs(player.vx) > 0.12 || !player.grounded;
      if (!serverMoving) {
        // Correct slow drift only when the authoritative fighter is settled.
        this.predicted.x += dx * 0.22;
        this.predicted.y += dy * 0.45;
        if (player.grounded && Math.abs(dy) < 3) {
          this.predicted.y = ARENA.groundY;
          this.predicted.vy = 0;
          this.predicted.grounded = true;
        }
      }
      if (player.grounded && !this.predicted.grounded && this.predicted.y >= ARENA.groundY - 2) {
        this.predicted.y = ARENA.groundY;
        this.predicted.grounded = true;
        this.predicted.vy = 0;
      }
    }
    this.predicted.facing = player.facing;
    this.predictionLocked = locked;
  }

  isLocked(player) {
    const snapshot = this.snapshot;
    return !!(
      (snapshot && snapshot.phase !== 'playing') ||
      player.action ||
      player.hitstun > 0 ||
      player.health <= 0
    );
  }

  // -----------------------------------------------------------------------
  // Effects
  // -----------------------------------------------------------------------

  addEvents(events) {
    for (const event of events || []) {
      if (event.id != null) {
        if (this.seenEvents.has(event.id)) continue;
        this.seenEvents.add(event.id);
      }
      this.addEvent(event);
    }
  }

  addEvent(event) {
    if (!event) return;
    switch (event.type) {
      case 'hit': {
        const color = event.heavy ? '#ffd166' : '#ffe1a6';
        this.spawnBurst(event.x, event.y, color, event.heavy ? 22 : 13, event.heavy ? 9 : 6);
        this.spawnBurst(event.x, event.y, '#ff5a1f', event.heavy ? 12 : 6, 4.5);
        this.addRing(event.x, event.y, event.heavy ? 18 : 10, event.heavy ? 110 : 66, color, 0.26);
        this.addSlash(event.x, event.y, event.sourceId === this.localId ? 0.8 : -0.8, color);
        this.shake = Math.max(this.shake, event.heavy ? 15 : 7);
        if (event.heavy) this.flash.color = '#ffb02e', this.flash.alpha = 0.16;
        break;
      }
      case 'block': {
        this.spawnBurst(event.x, event.y, '#9fe8ff', 9, 4);
        this.addRing(event.x, event.y, 8, 52, '#9fe8ff', 0.18);
        this.shake = Math.max(this.shake, 2.5);
        break;
      }
      case 'ko': {
        this.spawnBurst(event.x, event.y, '#ffd166', 36, 11);
        this.spawnBurst(event.x, event.y, '#ff5a1f', 24, 8);
        this.addRing(event.x, event.y, 20, 240, '#ffd166', 0.4);
        this.shake = 26;
        this.flash.color = '#ffffff';
        this.flash.alpha = 0.34;
        break;
      }
      case 'damageNumber': {
        this.addFloater(
          event.x,
          event.y,
          event.blocked ? `BLOCK ${event.amount}` : String(event.amount),
          event.blocked ? '#9fe8ff' : event.amount >= 120 ? '#ffd166' : '#ffffff',
          event.blocked ? 18 : event.amount >= 120 ? 34 : 26
        );
        break;
      }
      case 'projectileHit': {
        this.spawnBurst(event.x, event.y, event.color || '#ffd166', 16, 6);
        this.addRing(event.x, event.y, 12, 70, event.color || '#ffd166', 0.2);
        this.shake = Math.max(this.shake, 4);
        break;
      }
      case 'skillStart': {
        this.addFloater(event.x, event.y - 40, event.name || 'SKILL', '#ffd166', 15, 900, true);
        this.ringAtPlayer(event.playerId, event.skillId === 'ult' ? '#c4a2ff' : '#ffb02e');
        break;
      }
      case 'areaAttack': {
        this.addRing(event.x, event.y + 90, 12, event.radius || 130, event.color || '#ffb02e', 0.42);
        this.spawnBurst(event.x, event.y, event.color || '#ffb02e', 22, 7);
        if (event.connected) this.shake = Math.max(this.shake, 11);
        break;
      }
      case 'teleport': {
        this.spawnBurst(event.fromX, event.fromY - 80, event.color || '#a855f7', 20, 6);
        this.spawnBurst(event.toX, event.toY - 80, event.color || '#a855f7', 20, 6);
        this.addRing(event.fromX, event.fromY - 80, 12, 80, event.color || '#a855f7', 0.24);
        break;
      }
      case 'buff':
      case 'shieldCast':
      case 'healCast': {
        const color = event.color || '#4ade80';
        const pos = this.playerPosition(event.playerId);
        if (pos) {
          this.spawnRise(pos.x, pos.y - 70, color, 16);
          this.addRing(pos.x, pos.y - 80, 20, 82, color, 0.25);
        }
        break;
      }
      case 'ultimateStart': {
        this.flash.color = event.color || '#ffffff';
        this.flash.alpha = 0.22;
        this.shake = 15;
        break;
      }
      case 'ultimateHit': {
        this.spawnBurst(event.x, event.y, event.color || '#ffd166', 52, 13);
        this.spawnBurst(event.x, event.y, '#ffffff', 26, 9);
        this.addRing(event.x, event.y, 20, 320, '#ffffff', 0.5);
        this.shake = 34;
        this.flash.color = '#ffffff';
        this.flash.alpha = 0.55;
        this.addFloater(event.x, event.y - 50, event.skillName || 'ULTIMATE', '#ffd166', 20, 1200, true);
        break;
      }
      case 'damage': {
        // Custom skills may emit their own damage event shape.
        if (event.x && event.y) {
          this.spawnBurst(event.x, event.y, '#ffd166', 10, 5);
        }
        break;
      }
      case 'heal': {
        this.addFloater(event.x, event.y, `+${event.amount}`, '#4ade80', 24);
        this.spawnRise(event.x, event.y, '#4ade80', 12);
        break;
      }
      case 'shieldHit': {
        this.spawnBurst(event.x, event.y, '#9fe8ff', 12, 5);
        this.addFloater(event.x, event.y - 20, `-${event.amount}`, '#9fe8ff', 20);
        break;
      }
      case 'status': {
        const pos = this.playerPosition(event.targetId);
        if (pos) {
          const colors = {
            burn: '#ff7a18',
            poison: '#84cc16',
            slow: '#34e7ff',
            stun: '#ffd166',
            buff: '#9b6cff'
          };
          this.spawnBurst(pos.x, pos.y - 100, colors[event.effect] || '#ffffff', 10, 4);
        }
        break;
      }
      case 'jump':
      case 'land': {
        this.spawnDust(event.x, event.y, event.type === 'land' ? 11 : 6);
        break;
      }
      case 'debuff':
      case 'debuffWhiff': {
        this.spawnBurst(event.x, event.y, event.color || '#84cc16', 15, 5);
        this.addRing(event.x, event.y, 14, 90, event.color || '#84cc16', 0.22);
        break;
      }
      case 'matchEnd': {
        this.flash.color = '#ffffff';
        this.flash.alpha = 0.2;
        break;
      }
      default:
        break;
    }
  }

  playerPosition(playerId) {
    if (!this.snapshot) return null;
    return this.snapshot.players.find((player) => player.id === playerId) || null;
  }

  ringAtPlayer(playerId, color) {
    const player = this.playerPosition(playerId);
    if (!player) return;
    this.addRing(player.x, player.y - 80, 24, 96, color, 0.24);
  }

  addRing(x, y, startRadius, endRadius, color, life) {
    this.rings.push({
      x,
      y,
      radius: startRadius,
      endRadius,
      life,
      maxLife: life,
      color,
      width: 3
    });
  }

  addSlash(x, y, direction, color) {
    this.particles.push({
      type: 'slash',
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.22,
      maxLife: 0.22,
      size: 46,
      color,
      direction,
      gravity: 0
    });
  }

  spawnBurst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const power = speed * (0.35 + Math.random() * 0.8);
      this.particles.push({
        type: 'spark',
        x,
        y,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power - 1,
        life: 0.28 + Math.random() * 0.45,
        maxLife: 0.6,
        size: 1.5 + Math.random() * 3.4,
        color,
        gravity: 0.14
      });
    }
  }

  spawnRise(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        type: 'spark',
        x: x + (Math.random() - 0.5) * 56,
        y: y + (Math.random() - 0.5) * 28,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -1.3 - Math.random() * 1.8,
        life: 0.7 + Math.random() * 0.5,
        maxLife: 1.2,
        size: 1.5 + Math.random() * 3,
        color,
        gravity: -0.015
      });
    }
  }

  spawnDust(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push({
        type: 'dust',
        x: x + (Math.random() - 0.5) * 40,
        y: y - 3,
        vx: (Math.random() - 0.5) * 3.4,
        vy: -0.5 - Math.random() * 1.2,
        life: 0.45 + Math.random() * 0.4,
        maxLife: 0.85,
        size: 4 + Math.random() * 9,
        color: '#b9a58a',
        gravity: 0.02
      });
    }
  }

  addFloater(x, y, text, color, size, life = 900, label = false) {
    this.floaters.push({
      x,
      y,
      text,
      color,
      size,
      life: life / 1000,
      maxLife: life / 1000,
      vy: -0.85,
      label
    });
  }

  showEmote(playerId, text) {
    const clean = String(text || '').slice(0, 24);
    if (!clean) return;
    this.emotes = this.emotes.filter((entry) => entry.playerId !== playerId);
    this.emotes.push({ playerId, text: clean, life: 3.4, maxLife: 3.4 });
  }

  // -----------------------------------------------------------------------
  // Background
  // -----------------------------------------------------------------------

  buildBackground() {
    const scale = this.renderScale;
    const bg = document.createElement('canvas');
    bg.width = Math.round(ARENA.width * scale);
    bg.height = Math.round(ARENA.height * scale);
    const ctx = bg.getContext('2d', { alpha: false });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const random = seededRandom(4421);
    const W = ARENA.width;
    const H = ARENA.height;

    // ---------------------------------------------------------------- sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#03040c');
    sky.addColorStop(0.28, '#070a1a');
    sky.addColorStop(0.5, '#0f0e24');
    sky.addColorStop(0.68, '#25172f');
    sky.addColorStop(0.82, '#160f20');
    sky.addColorStop(1, '#05050c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    softBlob(ctx, 340, 170, 430, 190, '#2a1c52', 0.17, -0.24);
    softBlob(ctx, 720, 120, 360, 140, '#162e47', 0.1, 0.14);
    softBlob(ctx, 1020, 250, 340, 150, '#341a3b', 0.075, 0.22);

    // Stars, some with a small cross flare.
    for (let i = 0; i < 260; i += 1) {
      const x = random() * W;
      const y = random() * 438;
      const bright = random();
      const radius = bright > 0.94 ? 1.05 + random() * 1.05 : 0.25 + random() * 0.8;
      const alpha = 0.14 + random() * 0.68;
      const tint = bright > 0.9 ? '255, 238, 208' : '205, 222, 255';
      ctx.fillStyle = `rgba(${tint}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (bright > 0.965) {
        ctx.strokeStyle = `rgba(220, 232, 255, ${alpha * 0.26})`;
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(x - radius * 4, y);
        ctx.lineTo(x + radius * 4, y);
        ctx.moveTo(x, y - radius * 4);
        ctx.lineTo(x, y + radius * 4);
        ctx.stroke();
      }
    }

    // --------------------------------------------------------------- moon
    const moonX = 1006;
    const moonY = 148;
    softBlob(ctx, moonX, moonY, 270, 250, '#ffd89a', 0.09);
    softBlob(ctx, moonX, moonY, 142, 132, '#ffeabd', 0.12);

    const disc = ctx.createRadialGradient(moonX - 28, moonY - 34, 6, moonX, moonY, 94);
    disc.addColorStop(0, '#fffaf0');
    disc.addColorStop(0.4, '#f2e1ba');
    disc.addColorStop(0.7, '#d3ae79');
    disc.addColorStop(0.9, '#a47b50');
    disc.addColorStop(1, '#7d5c3d');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 88, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(moonX, moonY, 88, 0, Math.PI * 2);
    ctx.clip();
    // Maria and craters.
    for (const [cx, cy, rx, ry, alpha] of [
      [-32, -18, 21, 17, 0.28],
      [26, 18, 27, 22, 0.22],
      [43, -31, 12, 10, 0.2],
      [-10, 43, 15, 11, 0.18],
      [16, -42, 8, 7, 0.16]
    ]) {
      softBlob(ctx, moonX + cx, moonY + cy, rx, ry, '#6d4c30', alpha);
      ctx.strokeStyle = 'rgba(255, 246, 220, 0.16)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(moonX + cx - 1, moonY + cy - 1, rx * 0.82, 3.5, 5.3);
      ctx.stroke();
    }
    // Fine crater speckle gives the disc some tooth at close range.
    for (let i = 0; i < 94; i += 1) {
      const angle = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * 80;
      const cx = moonX + Math.cos(angle) * dist;
      const cy = moonY + Math.sin(angle) * dist;
      const radius = 0.6 + random() * 2.8;
      ctx.fillStyle = `rgba(112, 82, 54, ${0.08 + random() * 0.16})`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 243, 214, ${0.06 + random() * 0.14})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(cx - 0.4, cy - 0.5, radius, 3.3, 5.6);
      ctx.stroke();
    }
    const maria = ctx.createLinearGradient(moonX - 80, moonY - 50, moonX + 30, moonY + 70);
    maria.addColorStop(0, 'rgba(86, 63, 48, 0.12)');
    maria.addColorStop(0.55, 'rgba(86, 63, 48, 0)');
    maria.addColorStop(1, 'rgba(35, 27, 32, 0.1)');
    ctx.fillStyle = maria;
    ctx.fillRect(moonX - 90, moonY - 90, 180, 180);
    const shade = ctx.createRadialGradient(moonX - 30, moonY - 36, 8, moonX + 12, moonY + 16, 104);
    shade.addColorStop(0, 'rgba(255, 255, 255, 0)');
    shade.addColorStop(0.66, 'rgba(30, 24, 28, 0.06)');
    shade.addColorStop(1, 'rgba(24, 18, 24, 0.48)');
    ctx.fillStyle = shade;
    ctx.fillRect(moonX - 96, moonY - 96, 192, 192);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = grainPattern(ctx, 814, 150);
    ctx.fillRect(moonX - 96, moonY - 96, 192, 192);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 246, 218, 0.32)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 88, 0, Math.PI * 2);
    ctx.stroke();

    // Thin clouds.
    for (const [x, y, rx, ry, alpha, rotation] of [
      [120, 212, 230, 15, 0.5, -0.03],
      [360, 258, 280, 11, 0.38, 0.02],
      [710, 116, 250, 9, 0.3, 0.01],
      [520, 330, 320, 14, 0.28, -0.02],
      [880, 252, 230, 8, 0.2, 0.02]
    ]) {
      softBlob(ctx, x, y, rx, ry, '#171226', alpha, rotation);
      softBlob(ctx, x + rx * 0.2, y - ry * 0.4, rx * 0.7, ry * 0.55, '#2b2138', alpha * 0.4, rotation);
    }

    // --------------------------------------------------------- mountains
    const ridges = [
      { color: '#0d0c1e', top: '#15142c', base: 520, amp: 122, freq: 0.0058, phase: 2.1 },
      { color: '#090916', top: '#111022', base: 538, amp: 94, freq: 0.0091, phase: 4.4 },
      { color: '#06060f', top: '#0b0a16', base: 556, amp: 70, freq: 0.0137, phase: 1.2 }
    ];
    for (const ridge of ridges) {
      const gradient = ctx.createLinearGradient(0, 300, 0, 560);
      gradient.addColorStop(0, ridge.top);
      gradient.addColorStop(0.62, ridge.color);
      gradient.addColorStop(1, '#05050b');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(-40, 562);
      for (let x = -40; x <= W + 40; x += 8) {
        const wave = Math.sin(x * ridge.freq + ridge.phase) * 0.62
          + Math.sin(x * ridge.freq * 2.7 + ridge.phase * 1.7) * 0.26
          + Math.sin(x * ridge.freq * 5.1 + ridge.phase * 0.6) * 0.12;
        const y = ridge.base - ridge.amp * (0.5 + wave * 0.5);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 40, 562);
      ctx.closePath();
      ctx.fill();
    }

    // Soft moonlight scatter through the haze.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    softBlob(ctx, 902, 330, 235, 310, '#8fa8ff', 0.035, -0.52);
    softBlob(ctx, 772, 430, 150, 235, '#7590d8', 0.022, -0.52);
    ctx.restore();

    // ------------------------------------------------- distant skyline
    for (let i = 0; i < 48; i += 1) {
      const x = -16 + i * 28 + random() * 9;
      const width = 15 + random() * 24;
      const height = 16 + random() * 54;
      const top = 474 - height;
      ctx.fillStyle = random() > 0.5 ? '#080813' : '#0a0916';
      ctx.fillRect(x, top, width, height + 8);
      ctx.beginPath();
      ctx.moveTo(x - 3, top + 1);
      ctx.lineTo(x + width / 2, top - 5 - random() * 4);
      ctx.lineTo(x + width + 3, top + 1);
      ctx.closePath();
      ctx.fill();
      if (random() > 0.55) {
        const light = random() > 0.45 ? 'rgba(255, 174, 92, 0.32)' : 'rgba(105, 210, 235, 0.24)';
        ctx.fillStyle = light;
        ctx.fillRect(x + 3 + random() * Math.max(1, width - 7), top + 6 + random() * Math.max(1, height - 12), 1.4, 2);
      }
    }

    // ----------------------------------------------------------- pagoda
    const pagodaX = 640;
    // Stone terrace.
    ctx.fillStyle = '#08070e';
    ctx.fillRect(pagodaX - 132, 466, 264, 14);
    ctx.fillStyle = 'rgba(210, 218, 255, 0.07)';
    ctx.fillRect(pagodaX - 132, 466, 264, 1);

    // Central wooden body and balcony bands.
    ctx.fillStyle = '#080710';
    ctx.fillRect(pagodaX - 45, 292, 90, 178);
    for (let level = 0; level < 5; level += 1) {
      const y = 446 - level * 38;
      ctx.fillStyle = '#0b0913';
      ctx.fillRect(pagodaX - 52, y, 104, 5);
      ctx.fillStyle = 'rgba(170, 180, 220, 0.055)';
      ctx.fillRect(pagodaX - 52, y, 104, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(pagodaX - 52, y + 4, 104, 1);
      // Warm paper windows behind wooden lattice.
      for (const wx of [-24, 8]) {
        const glow = ctx.createLinearGradient(pagodaX + wx, 0, pagodaX + wx + 16, 0);
        glow.addColorStop(0, 'rgba(255, 152, 72, 0.12)');
        glow.addColorStop(0.5, 'rgba(255, 188, 104, 0.3)');
        glow.addColorStop(1, 'rgba(255, 152, 72, 0.1)');
        ctx.fillStyle = glow;
        ctx.fillRect(pagodaX + wx, y + 9, 16, 14);
        ctx.strokeStyle = 'rgba(20, 12, 12, 0.7)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(pagodaX + wx + 8, y + 9);
        ctx.lineTo(pagodaX + wx + 8, y + 23);
        ctx.moveTo(pagodaX + wx, y + 16);
        ctx.lineTo(pagodaX + wx + 16, y + 16);
        ctx.stroke();
      }
    }

    const roofs = [
      { y: 457, half: 112, depth: 24, seed: 6101 },
      { y: 419, half: 96, depth: 22, seed: 6102 },
      { y: 383, half: 80, depth: 20, seed: 6103 },
      { y: 349, half: 64, depth: 18, seed: 6104 },
      { y: 317, half: 48, depth: 15, seed: 6105 }
    ];
    for (const roof of roofs) drawTiledRoof(ctx, pagodaX, roof.y, roof.half, roof.depth, roof.seed);
    // Eave lanterns make the tiers legible against the night sky.
    for (const roof of roofs) {
      for (const side of [-1, 1]) {
        const lx = pagodaX + side * roof.half * 0.62;
        softBlob(ctx, lx, roof.y + 1, 10, 7, '#ffb45e', 0.16);
        ctx.fillStyle = 'rgba(255, 195, 112, 0.5)';
        ctx.fillRect(lx - 1, roof.y - 1, 2, 3);
      }
    }
    // Spire.
    ctx.fillStyle = '#0b0a12';
    ctx.fillRect(pagodaX - 2, 250, 4, 54);
    for (let ring = 0; ring < 4; ring += 1) {
      ctx.fillStyle = 'rgba(174, 152, 108, 0.38)';
      ctx.fillRect(pagodaX - 7 + ring, 258 + ring * 8, 14 - ring * 2, 1.4);
    }
    ctx.fillStyle = 'rgba(255, 194, 116, 0.32)';
    ctx.beginPath();
    ctx.arc(pagodaX, 248, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Haze across the middle distance.
    softBlob(ctx, 380, 470, 380, 26, '#2a2044', 0.2);
    softBlob(ctx, 910, 482, 430, 30, '#332040', 0.16);
    softBlob(ctx, 640, 460, 260, 18, '#252040', 0.16);

    // ------------------------------------------------------ stone wall
    drawStoneWall(ctx, 0, 470, W, 132, 5511);
    ctx.fillStyle = '#22202c';
    ctx.fillRect(0, 466, W, 5);
    ctx.fillStyle = 'rgba(255, 180, 110, 0.12)';
    ctx.fillRect(0, 466, W, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 471, W, 2);

    // ------------------------------------------------------- spectators
    for (let i = 0; i < 64; i += 1) {
      const x = -12 + i * 20.6 + (random() - 0.5) * 10;
      const baseline = 584 + random() * 18;
      const height = 22 + random() * 28;
      const headR = 3.6 + random() * 2.5;
      const headY = baseline - height;
      ctx.fillStyle = `rgba(4, 3, 9, ${0.72 + random() * 0.24})`;
      ctx.beginPath();
      ctx.arc(x, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - headR * 1.5, baseline);
      ctx.quadraticCurveTo(x - headR * 2.1, headY + headR * 1.2, x - headR * 0.7, headY + headR * 0.8);
      ctx.lineTo(x + headR * 0.7, headY + headR * 0.8);
      ctx.quadraticCurveTo(x + headR * 2.1, headY + headR * 1.2, x + headR * 1.5, baseline);
      ctx.closePath();
      ctx.fill();
      if (random() > 0.45) {
        ctx.strokeStyle = 'rgba(255, 158, 92, 0.1)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, headY, headR + 0.8, -2.4, -0.8);
        ctx.stroke();
      }
      if (random() > 0.9) {
        softBlob(ctx, x + 5, headY + 9, 8, 5, '#63d9ee', 0.12);
        ctx.fillStyle = 'rgba(130, 238, 250, 0.5)';
        ctx.fillRect(x + 4, headY + 8, 2, 3);
      }
    }

    // Barrier rail in front of the crowd.
    ctx.strokeStyle = '#100d16';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 585);
    ctx.lineTo(W, 585);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170, 190, 235, 0.06)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 583.5);
    ctx.lineTo(W, 583.5);
    ctx.stroke();
    for (let x = 12; x < W; x += 38) {
      ctx.strokeStyle = 'rgba(8, 6, 12, 0.9)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, 585);
      ctx.lineTo(x, 610);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(190, 205, 245, 0.045)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x + 1, 585);
      ctx.lineTo(x + 1, 608);
      ctx.stroke();
    }

    // Warm wash from the gate lanterns.
    for (const x of [240, 480, 800, 1040]) {
      softBlob(ctx, x, 535, 74, 94, '#ff9b45', 0.045);
    }

    // ------------------------------------------------------- torii gate
    for (const [side, x, seed] of [[-1, 112, 9101], [1, 1134, 9102]]) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x - 21, 622);
      ctx.lineTo(x - 15, 316);
      ctx.lineTo(x + 15, 316);
      ctx.lineTo(x + 23, 622);
      ctx.closePath();
      ctx.clip();
      drawWood(ctx, x - 24, 312, 50, 312, true, seed, ['#160b0d', '#35161a', '#713126']);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255, 146, 96, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 14, 320);
      ctx.lineTo(x - 20, 614);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.moveTo(x + 14.5, 320);
      ctx.lineTo(x + 21, 614);
      ctx.stroke();
      ctx.fillStyle = '#18151d';
      ctx.fillRect(x - 27, 595, 54, 18);
      ctx.fillStyle = 'rgba(210, 220, 250, 0.08)';
      ctx.fillRect(x - 27, 595, 54, 1);
    }

    // Top lintel with a slight upward sweep.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(28, 296);
    ctx.bezierCurveTo(430, 286, 850, 286, 1252, 296);
    ctx.lineTo(1250, 314);
    ctx.bezierCurveTo(850, 307, 430, 307, 30, 314);
    ctx.closePath();
    ctx.clip();
    drawWood(ctx, 18, 280, 1250, 40, false, 9110, ['#190c0e', '#3d1919', '#7f392b']);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255, 174, 114, 0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(28, 296);
    ctx.bezierCurveTo(430, 286, 850, 286, 1252, 296);
    ctx.stroke();
    ctx.fillStyle = '#151114';
    ctx.fillRect(20, 292, 12, 25);
    ctx.fillRect(1248, 292, 12, 25);
    ctx.fillStyle = 'rgba(201, 154, 84, 0.28)';
    ctx.fillRect(22, 295, 8, 1.5);
    ctx.fillRect(1250, 295, 8, 1.5);

    // Lower crossbeam.
    ctx.save();
    drawWood(ctx, 32, 318, 1216, 26, false, 9111, ['#170b0d', '#36171a', '#793428']);
    ctx.restore();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(32, 342, 1216, 2);
    ctx.fillStyle = 'rgba(255, 170, 110, 0.12)';
    ctx.fillRect(32, 318, 1216, 1);

    // Iron straps and bolts.
    for (const x of [178, 396, 640, 884, 1102]) {
      ctx.fillStyle = '#171319';
      ctx.fillRect(x - 5, 316, 10, 29);
      ctx.fillStyle = 'rgba(205, 180, 135, 0.16)';
      ctx.fillRect(x - 4, 318, 8, 1);
      for (const by of [321, 331, 340]) {
        ctx.fillStyle = 'rgba(225, 200, 155, 0.26)';
        ctx.fillRect(x - 1, by, 2, 2);
      }
    }

    // Central iron seal on the crossbeam.
    ctx.fillStyle = 'rgba(16, 12, 13, 0.92)';
    ctx.beginPath();
    ctx.arc(640, 331, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(202, 160, 92, 0.48)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226, 191, 126, 0.22)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(640, 331, 4.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(216, 180, 108, 0.44)';
    ctx.beginPath();
    ctx.moveTo(640, 327);
    ctx.lineTo(643, 331);
    ctx.lineTo(640, 335);
    ctx.lineTo(637, 331);
    ctx.closePath();
    ctx.fill();

    // Hanging banners.
    for (const [x, glyph, seed] of [[190, '炎', 4401], [1090, '影', 4402]]) {
      const wave = seededRandom(seed);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x - 15, 316);
      ctx.lineTo(x + 15, 316);
      for (let i = 0; i <= 8; i += 1) {
        const t = i / 8;
        ctx.lineTo(x + 14 + Math.sin(t * 7 + seed) * 1.7, 316 + t * 112 + (wave() - 0.5) * 2);
      }
      for (let i = 8; i >= 0; i -= 1) {
        const t = i / 8;
        ctx.lineTo(x - 14 + Math.sin(t * 7 + seed) * 1.7, 316 + t * 112 + (wave() - 0.5) * 2);
      }
      ctx.closePath();
      ctx.fillStyle = glyph === '炎' ? 'rgba(62, 18, 18, 0.86)' : 'rgba(35, 20, 54, 0.88)';
      ctx.fill();
      ctx.clip();
      const cloth = ctx.createLinearGradient(x - 15, 0, x + 15, 0);
      cloth.addColorStop(0, 'rgba(0, 0, 0, 0.42)');
      cloth.addColorStop(0.4, 'rgba(255, 132, 70, 0.07)');
      cloth.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
      ctx.fillStyle = cloth;
      ctx.fillRect(x - 16, 316, 32, 114);
      ctx.strokeStyle = 'rgba(196, 153, 84, 0.4)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x - 12, 321, 24, 103);
      ctx.fillStyle = 'rgba(224, 188, 110, 0.7)';
      ctx.font = '600 17px "Yu Mincho", "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.fillText(glyph, x, 360);
      ctx.restore();
      ctx.fillStyle = '#2b211b';
      ctx.fillRect(x - 16, 313, 32, 3);
    }

    // Lanterns.
    for (const [x, y, seed] of [[240, 390, 701], [480, 394, 702], [800, 388, 703], [1040, 392, 704]]) {
      drawLantern(ctx, x, y, 24, seed);
    }

    // ------------------------------------------------------------ floor
    const floorBase = ctx.createLinearGradient(0, 596, 0, H);
    floorBase.addColorStop(0, '#26202f');
    floorBase.addColorStop(0.32, '#171320');
    floorBase.addColorStop(0.78, '#0c0913');
    floorBase.addColorStop(1, '#06050b');
    ctx.fillStyle = floorBase;
    ctx.fillRect(0, 596, W, 124);

    // Stage lip.
    const lip = ctx.createLinearGradient(0, 596, 0, 611);
    lip.addColorStop(0, '#3a3344');
    lip.addColorStop(0.34, '#231d2c');
    lip.addColorStop(1, '#0c0912');
    ctx.fillStyle = lip;
    ctx.fillRect(0, 596, W, 15);
    ctx.fillStyle = 'rgba(255, 188, 122, 0.22)';
    ctx.fillRect(56, 597, W - 112, 1.4);
    ctx.fillStyle = 'rgba(178, 195, 240, 0.08)';
    ctx.fillRect(56, 599, W - 112, 0.8);

    // Polished flagstones in perspective.
    const floorRandom = seededRandom(9907);
    const vpX = 640;
    const vpY = 352;
    const rows = [608, 614, 621, 629, 639, 651, 665, 682, 702, 720];
    const tones = ['#1b1624', '#201a29', '#17131f', '#241d2d', '#15121c', '#1d1826'];
    for (let row = 0; row < rows.length - 1; row += 1) {
      const y0 = rows[row];
      const y1 = rows[row + 1];
      const k0 = (y0 - vpY) / (720 - vpY);
      const k1 = (y1 - vpY) / (720 - vpY);
      let bx = -620 + floorRandom() * 80;
      while (bx < 1900) {
        const bw = 82 + floorRandom() * 88;
        const xTopA = vpX + (bx - vpX) * k0;
        const xTopB = vpX + (bx + bw - vpX) * k0;
        const xBotA = vpX + (bx - vpX) * k1;
        const xBotB = vpX + (bx + bw - vpX) * k1;
        ctx.beginPath();
        ctx.moveTo(xTopA, y0);
        ctx.lineTo(xTopB, y0);
        ctx.lineTo(xBotB, y1);
        ctx.lineTo(xBotA, y1);
        ctx.closePath();
        ctx.fillStyle = tones[Math.floor(floorRandom() * tones.length)];
        ctx.fill();
        ctx.strokeStyle = 'rgba(3, 3, 7, 0.62)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(190, 200, 235, 0.035)';
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(xTopA + 1, y0 + 0.6);
        ctx.lineTo(xTopB - 1, y0 + 0.6);
        ctx.stroke();

        if (floorRandom() > 0.55) {
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.24)';
          ctx.lineWidth = 0.6;
          let cx = xTopA + (xTopB - xTopA) * floorRandom();
          let cy = y0 + (y1 - y0) * floorRandom();
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          for (let step = 0; step < 3; step += 1) {
            cx += (floorRandom() - 0.5) * 20;
            cy += (y1 - y0) / 3;
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();
          for (let speck = 0; speck < 2; speck += 1) {
            ctx.fillStyle = floorRandom() > 0.5
              ? 'rgba(215, 220, 245, 0.05)'
              : 'rgba(0, 0, 0, 0.24)';
            ctx.fillRect(
              xTopA + floorRandom() * Math.max(1, xTopB - xTopA),
              y0 + floorRandom() * Math.max(1, y1 - y0),
              1.2,
              0.8
            );
          }
          ctx.restore();
        }
        bx += bw;
      }
    }

    // Polished sheen and long lantern reflections.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const sheen = ctx.createLinearGradient(0, 596, 0, 720);
    sheen.addColorStop(0, 'rgba(130, 160, 220, 0.055)');
    sheen.addColorStop(0.38, 'rgba(90, 110, 170, 0.014)');
    sheen.addColorStop(1, 'rgba(255, 130, 60, 0.018)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 596, W, 124);
    for (const x of [240, 480, 800, 1040]) {
      softBlob(ctx, x, 674, 23, 60, '#ff9b45', 0.16);
      softBlob(ctx, x, 687, 9, 38, '#ffd08a', 0.1);
    }
    softBlob(ctx, 1006, 700, 150, 34, '#a9c0ff', 0.03);
    softBlob(ctx, 112, 690, 28, 62, '#713126', 0.1);
    softBlob(ctx, 1134, 690, 28, 62, '#713126', 0.1);
    ctx.restore();

    // Inlaid center emblem.
    ctx.save();
    ctx.translate(640, 682);
    const inlay = ctx.createRadialGradient(0, 0, 6, 0, 0, 78);
    inlay.addColorStop(0, 'rgba(29, 24, 34, 0.7)');
    inlay.addColorStop(1, 'rgba(14, 11, 18, 0)');
    ctx.fillStyle = inlay;
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(198, 158, 92, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(198, 158, 92, 0.11)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 61, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 28; i += 1) {
      const angle = (i / 28) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(218, 180, 112, 0.13)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 64, Math.sin(angle) * 64);
      ctx.lineTo(Math.cos(angle) * 71, Math.sin(angle) * 71);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(216, 176, 108, 0.13)';
    ctx.font = '400 68px "Yu Mincho", "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('影', 0, 4);
    ctx.restore();

    // Arena boundary inlays.
    for (const x of [ARENA.leftBound, ARENA.rightBound]) {
      ctx.strokeStyle = 'rgba(64, 208, 226, 0.22)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, 618, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(64, 208, 226, 0.16)';
      ctx.beginPath();
      ctx.moveTo(x, 610);
      ctx.lineTo(x - 3, 615);
      ctx.lineTo(x + 3, 615);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(64, 208, 226, 0.14)';
      ctx.fillRect(x - 0.6, 590, 1.2, 18);
    }

    // --------------------------------------------------------- braziers
    drawBrazier(ctx, 26, 622, 1.16, 7711);
    drawBrazier(ctx, 1254, 622, 1.16, 7712);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    softBlob(ctx, 26, 692, 46, 22, '#ff8a3d', 0.11);
    softBlob(ctx, 1254, 692, 46, 22, '#ff8a3d', 0.11);
    ctx.restore();

    // Baked stage lighting and haze: the same atmosphere that used to be
    // redrawn every frame, but rasterised once into the background texture.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const stageLight = ctx.createRadialGradient(640, 610, 40, 640, 590, 460);
    stageLight.addColorStop(0, 'rgba(255, 168, 92, 0.05)');
    stageLight.addColorStop(0.55, 'rgba(255, 132, 56, 0.015)');
    stageLight.addColorStop(1, 'rgba(255, 132, 56, 0)');
    ctx.fillStyle = stageLight;
    ctx.fillRect(180, 200, 920, 520);

    const fogBand = ctx.createLinearGradient(0, 435, 0, 625);
    fogBand.addColorStop(0, 'rgba(76, 156, 205, 0)');
    fogBand.addColorStop(0.48, 'rgba(76, 156, 205, 0.022)');
    fogBand.addColorStop(0.72, 'rgba(150, 118, 190, 0.015)');
    fogBand.addColorStop(1, 'rgba(150, 118, 190, 0)');
    ctx.fillStyle = fogBand;
    ctx.fillRect(0, 435, W, 190);
    ctx.restore();

    // Subtle scanline texture, baked so it costs nothing per frame.
    ctx.save();
    ctx.globalAlpha = 0.018;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    ctx.restore();

    // ------------------------------------------------------ colour grade
    const grade = ctx.createLinearGradient(0, 0, 0, H);
    grade.addColorStop(0, 'rgba(26, 42, 96, 0.08)');
    grade.addColorStop(0.52, 'rgba(0, 0, 0, 0)');
    grade.addColorStop(1, 'rgba(88, 30, 12, 0.1)');
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, W, H);

    // Film grain, scaled so each noise cell lands on a physical pixel.
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    const grain = grainPattern(ctx, 731, 180);
    if (grain.setTransform && typeof DOMMatrix !== 'undefined') {
      grain.setTransform(new DOMMatrix([1 / scale, 0, 0, 1 / scale, 0, 0]));
    }
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = grainPattern(ctx, 928, 300);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Fixed vignette.
    const vignette = ctx.createRadialGradient(640, 340, 230, 640, 360, 780);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.62, 'rgba(0, 0, 0, 0.12)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    this.bgCanvas = bg;
  }
  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  updateEffects(dt) {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt * 60;
      particle.y += particle.vy * dt * 60;
      particle.vy += particle.gravity * dt * 60;
      particle.vx *= 0.985;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);

    for (const ring of this.rings) {
      ring.life -= dt;
      const t = 1 - ring.life / ring.maxLife;
      ring.radius = lerp(ring.radius, ring.endRadius, Math.min(1, dt * 14 + t * 0.12));
    }
    this.rings = this.rings.filter((ring) => ring.life > 0);

    for (const floater of this.floaters) {
      floater.life -= dt;
      floater.y += floater.vy * dt * 60;
      floater.vy *= 0.985;
    }
    this.floaters = this.floaters.filter((floater) => floater.life > 0);

    for (const emote of this.emotes) emote.life -= dt;
    this.emotes = this.emotes.filter((emote) => emote.life > 0);

    this.shake *= Math.pow(0.0008, dt);
    if (this.shake < 0.2) this.shake = 0;
    this.shakeX = (Math.random() - 0.5) * this.shake * 2;
    this.shakeY = (Math.random() - 0.5) * this.shake * 2;

    this.flash.alpha *= Math.pow(0.002, dt);
    if (this.flash.alpha < 0.005) this.flash.alpha = 0;

    for (const mote of this.ambient) {
      mote.y -= mote.speed * dt * 60;
      mote.x += mote.drift * dt * 60;
      if (mote.y < -10) {
        mote.y = mote.ember ? 600 + Math.random() * 100 : ARENA.height + 10;
        mote.x = Math.random() * ARENA.width;
      }
      if (mote.x < -10) mote.x = ARENA.width + 10;
      if (mote.x > ARENA.width + 10) mote.x = -10;
    }
  }

  stepPrediction(input) {
    const snapshot = this.snapshot;
    const local = snapshot?.players?.find((player) => player.id === this.localId);
    if (!local || !this.predicted) {
      this.prevUp = !!input.up;
      return;
    }
    if (this.predictionLocked || snapshot.phase !== 'playing' || local.health <= 0) {
      this.prevUp = !!input.up;
      return;
    }

    const meta = this.playersMeta.get(this.localId);
    const stats = meta?.hero?.stats || { walkSpeed: 4.4, jumpPower: 16.5 };
    const pred = this.predicted;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (pred.grounded) {
      pred.y = ARENA.groundY;
      pred.vy = 0;
      if (input.up && !this.prevUp) {
        pred.grounded = false;
        pred.vy = -stats.jumpPower;
        if (dir !== 0) pred.vx = dir * stats.walkSpeed * 0.86;
      } else if (input.block || input.down) {
        pred.vx = 0;
      } else if (dir !== 0) {
        const backpedal = dir !== local.facing ? 0.76 : 1;
        pred.vx = dir * stats.walkSpeed * backpedal;
        pred.x += pred.vx;
      } else {
        pred.vx = 0;
      }
    } else {
      if (dir !== 0) {
        const maxAir = stats.walkSpeed * 1.05;
        pred.vx = clamp(pred.vx + dir * 0.2, -maxAir, maxAir);
      }
      pred.vy += GRAVITY;
      pred.x += pred.vx;
      pred.y += pred.vy;
      if (pred.y >= ARENA.groundY) {
        pred.y = ARENA.groundY;
        pred.vy = 0;
        pred.grounded = true;
      }
    }

    pred.x = clamp(pred.x, ARENA.leftBound, ARENA.rightBound);
    this.prevUp = !!input.up;
  }

  localAnim(local, input) {
    if (this.predictionLocked) return local.anim;
    if (!this.predicted.grounded) return 'jump';
    if (input.block) return 'block';
    if (input.down) return 'crouch';
    if (input.left || input.right) return 'walk';
    return 'idle';
  }

  getDisplayPlayers(now) {
    if (!this.snapshot) return [];
    const players = [];
    for (const player of this.snapshot.players) {
      if (!this.spectator && player.id === this.localId) {
        const predicted = this.predicted || player;
        const meta = this.playersMeta.get(player.id);
        players.push({
          ...player,
          x: predicted.x,
          y: predicted.y,
          vx: predicted.vx,
          vy: predicted.vy,
          grounded: predicted.grounded,
          facing: predicted.facing,
          anim: this.localAnim(player, this.lastInput || {}),
          _hero: meta?.hero,
          _local: true
        });
      } else {
        players.push(this.interpolatedPlayer(player, now));
      }
    }
    players.sort((a, b) => {
      if (a._local && !b._local) return 1;
      if (b._local && !a._local) return -1;
      return a.y - b.y;
    });
    return players;
  }

  interpolatedPlayer(latest, now) {
    const buffer = this.remoteBuffers.get(latest.id);
    const meta = this.playersMeta.get(latest.id);
    if (!buffer || buffer.length === 0) {
      return { ...latest, _hero: meta?.hero, _local: false };
    }
    if (buffer.length === 1) {
      return { ...latest, x: buffer[0].p.x, y: buffer[0].p.y, _hero: meta?.hero, _local: false };
    }

    const target = now - REMOTE_DELAY_MS;
    let rightIndex = buffer.findIndex((entry) => entry.t >= target);
    if (rightIndex === -1) rightIndex = buffer.length - 1;
    if (rightIndex === 0) rightIndex = 1;
    const before = buffer[Math.max(0, rightIndex - 1)];
    const after = buffer[rightIndex];
    const span = Math.max(1, after.t - before.t);
    const t = clamp((target - before.t) / span, 0, 1);
    const x = lerp(before.p.x, after.p.x, t);
    const y = lerp(before.p.y, after.p.y, t);
    return {
      ...latest,
      x,
      y,
      anim: before.p.anim,
      facing: latest.facing,
      vx: lerp(before.p.vx, after.p.vx, t),
      vy: lerp(before.p.vy, after.p.vy, t),
      _hero: meta?.hero,
      _local: false
    };
  }

  updateProjectileVisuals() {
    if (!this.snapshot) return;
    const seen = new Set();
    for (const projectile of this.snapshot.projectiles || []) {
      seen.add(projectile.id);
      const existing = this.projectileVisuals.get(projectile.id);
      if (existing) {
        existing.target = projectile;
      } else {
        this.projectileVisuals.set(projectile.id, {
          x: projectile.x,
          y: projectile.y,
          target: projectile,
          angle: 0
        });
      }
    }
    for (const [id] of this.projectileVisuals) {
      if (!seen.has(id)) this.projectileVisuals.delete(id);
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  render(dt, inputState = {}) {
    const now = performance.now();
    this.lastInput = inputState;
    this.tickAccumulator += Math.min(dt, 0.1);
    let ticks = 0;
    while (this.tickAccumulator >= TICK && ticks < 6) {
      this.stepPrediction(inputState);
      this.tickAccumulator -= TICK;
      ticks += 1;
    }
    if (ticks === 0) this.prevUp = !!inputState.up;

    this.updateEffects(dt);
    this.updateProjectileVisuals();

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, this.pixelWidth, this.pixelHeight);
    ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);

    if (!this.snapshot) return;

    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);
    this.drawBackground(now);
    this.drawAmbient(now);
    this.drawProjectiles(now);

    const players = this.getDisplayPlayers(now);
    this.screenPositions.clear();
    for (const player of players) this.drawShadow(player);

    const drawOrder = [...players].sort((a, b) => (a._local ? 1 : 0) - (b._local ? 1 : 0));
    for (const player of drawOrder) this.drawPlayer(player, now);

    this.drawParticles();
    this.drawRings();
    this.drawFloaters();
    this.drawEmotes(players);

    if (this.snapshot.cinematic) this.drawCinematic(now);
    if (this.snapshot.phase === 'countdown') this.drawCountdownTint();
    this.drawVignette(now);

    ctx.restore();

    if (this.flash.alpha > 0.003) {
      ctx.fillStyle = rgba(this.flash.color, this.flash.alpha);
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    }
  }

  drawBackground(now) {
    const ctx = this.ctx;
    ctx.drawImage(this.bgCanvas, 0, 0, ARENA.width, ARENA.height);

    // The broad lighting is baked into the background; only small drifting
    // fog puffs and the brazier flicker need to be animated per frame.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const drift = Math.sin(now * 0.00008);
    softBlob(ctx, 360 + drift * 90, 506, 290, 22, '#4c9ccd', 0.022);
    softBlob(ctx, 930 - drift * 80, 520, 320, 26, '#9676be', 0.015);
    for (const x of [26, 1254]) {
      const flicker = 0.6 + Math.sin(now * 0.009 + x) * 0.25 + Math.sin(now * 0.021 + x * 2) * 0.15;
      softBlob(ctx, x, 556, 54 + flicker * 10, 62 + flicker * 12, '#ff7b2e', 0.03 + flicker * 0.022);
    }
    ctx.restore();
  }

  drawAmbient(now) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const mote of this.ambient) {
      const flicker = 0.55 + Math.sin(now * 0.002 + mote.phase) * 0.45;
      const x = mote.x + Math.sin(now * 0.0008 + mote.phase) * (mote.ember ? 3.5 : 1.6);
      const y = mote.y;
      if (mote.ember) {
        ctx.fillStyle = rgba(mote.hue, mote.alpha * 0.12 * flicker);
        ctx.beginPath();
        ctx.arc(x, y, mote.size * 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(mote.hue, mote.alpha * flicker);
        ctx.beginPath();
        ctx.arc(x, y, mote.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = rgba(mote.hue, mote.alpha * flicker);
        ctx.beginPath();
        ctx.arc(x, y, mote.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawShadow(player) {
    const ctx = this.ctx;
    const height = Math.max(0, ARENA.groundY - player.y);
    const scale = clamp(1 - height / 900, 0.45, 1);
    ctx.save();
    ctx.translate(player.x, ARENA.groundY + 2);
    ctx.scale(scale, scale);
    const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 58);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.58)');
    gradient.addColorStop(0.65, 'rgba(0, 0, 0, 0.25)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, 62, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer(player, now) {
    const ctx = this.ctx;
    const meta = this.playersMeta.get(player.id);
    const hero = player._hero || meta?.hero || this.heroes.get(player.heroId);
    this.ensureHero(hero);
    this.screenPositions.set(player.id, { x: player.x, y: player.y });

    const theme = hero?.theme || { primary: '#ff5a1f', accent: '#ffd166', glow: 'rgba(255,90,31,.4)' };
    const animName = (player.anim && hero?.animations?.[player.anim]) ? player.anim : 'idle';
    const animation = hero?.animations?.[animName] || { frameWidth: 96, frameHeight: 96, frameCount: 1, frameDuration: 120, loop: true };
    const entry = animation.sprite ? this.image(animation.sprite) : null;
    const ready = entry && entry.ready && !entry.failed;

    // Aura when powered up or using a special.
    const special = ['special1', 'special2', 'special3', 'ult'].includes(animName);
    if ((player.power >= 100) || special) {
      const radius = special ? 92 : 74;
      const pulse = 0.65 + Math.sin(now * 0.006 + player.x) * 0.2;
      const aura = ctx.createRadialGradient(player.x, player.y - 90, 10, player.x, player.y - 90, radius);
      aura.addColorStop(0, rgba(theme.primary, 0.22 * pulse));
      aura.addColorStop(0.6, rgba(theme.primary, 0.08 * pulse));
      aura.addColorStop(1, rgba(theme.primary, 0));
      ctx.fillStyle = aura;
      ctx.fillRect(player.x - radius, player.y - 190, radius * 2, 200);
    }

    if (player.health > 0 && player.health / player.maxHealth < 0.25) {
      const low = 0.11 + Math.sin(now * 0.008) * 0.06;
      const glow = ctx.createRadialGradient(player.x, player.y - 75, 25, player.x, player.y - 75, 95);
      glow.addColorStop(0, `rgba(255, 45, 70, ${low})`);
      glow.addColorStop(1, 'rgba(255, 45, 70, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(player.x - 100, player.y - 180, 200, 200);
    }

    // Coloured bounce light on the stage floor.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    softBlob(ctx, player.x, ARENA.groundY + 5, 54, 13, theme.primary, 0.055);
    ctx.restore();

    const flashHit = player.hitstun > 0 && Math.floor(now / 55) % 3 === 0;
    let frame = 0;
    let sourceW = 96;
    let sourceH = 96;
    let drawW = 96;
    let drawH = 96;
    if (ready) {
      frame = this.frameIndex(player, animation, now);
      sourceW = animation.frameWidth || entry.img.width;
      sourceH = animation.frameHeight || entry.img.height;
      // High-density sheets keep the same 96-unit character footprint.
      const density = Math.max(0.5, sourceW / 96);
      drawW = sourceW / density;
      drawH = sourceH / density;
    }

    // Polished-floor reflection, faded when the fighter leaves the ground.
    // A single translucent mirrored draw is enough at this opacity and avoids
    // the per-frame gaussian filter, which is very expensive on large canvases.
    const air = clamp((ARENA.groundY - player.y) / 260, 0, 1);
    if (ready && player.health > 0 && air < 0.96) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, ARENA.groundY, ARENA.width, ARENA.height - ARENA.groundY);
      ctx.clip();
      ctx.globalAlpha = 0.085 * (1 - air) * (flashHit ? 0.5 : 1);
      ctx.translate(player.x, 2 * ARENA.groundY - player.y);
      ctx.scale(player.facing * SPRITE_SCALE, -SPRITE_SCALE * 0.94);
      ctx.drawImage(entry.img, frame * sourceW, 0, sourceW, sourceH, -drawW / 2, -drawH * (89 / 96), drawW, drawH);
      ctx.restore();
    }

    // Powered-up rim bloom, drawn behind the sprite. The sprite is softened
    // through a small offscreen buffer instead of a per-frame gaussian filter.
    if (ready && ((player.power >= 100) || special)) {
      const bloom = this.bloomCtx;
      bloom.clearRect(0, 0, 128, 128);
      bloom.drawImage(entry.img, frame * sourceW, 0, sourceW, sourceH, 0, 0, 128, 128);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3 + Math.sin(now * 0.006 + player.x) * 0.06;
      ctx.translate(player.x, player.y);
      ctx.scale(player.facing * SPRITE_SCALE * 1.035, SPRITE_SCALE * 1.035);
      ctx.drawImage(this.bloomCanvas, -drawW / 2, -drawH * (89 / 96), drawW, drawH);
      ctx.restore();
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (player.facing < 0) {
      ctx.translate(player.x, player.y);
      ctx.scale(-SPRITE_SCALE, SPRITE_SCALE);
    } else {
      ctx.translate(player.x, player.y);
      ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
    }

    if (ready) {
      ctx.drawImage(entry.img, frame * sourceW, 0, sourceW, sourceH, -drawW / 2, -drawH * (89 / 96), drawW, drawH);
      if (flashHit) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.42;
        ctx.drawImage(entry.img, frame * sourceW, 0, sourceW, sourceH, -drawW / 2, -drawH * (89 / 96), drawW, drawH);
        ctx.restore();
      }
    } else {
      this.drawFallbackFighter(player, theme, animName, now);
    }
    ctx.restore();

    this.drawStatusEffects(player, theme, now);

    if (player._local) {
      ctx.save();
      ctx.fillStyle = rgba(theme.accent, 0.85);
      ctx.beginPath();
      ctx.moveTo(player.x, player.y - 206);
      ctx.lineTo(player.x - 7, player.y - 218);
      ctx.lineTo(player.x + 7, player.y - 218);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  frameIndex(player, animation, now) {
    const count = Math.max(1, animation.frameCount || 1);
    if (player.action && !animation.loop) {
      const total = Math.max(1, player.action.total || 1);
      const progress = clamp((player.action.frame || 0) / total, 0, 1);
      return Math.min(count - 1, Math.floor(progress * count));
    }
    if (animation.loop) {
      return Math.floor(now / Math.max(16, animation.frameDuration || 120)) % count;
    }
    return Math.min(count - 1, Math.floor(now / Math.max(16, animation.frameDuration || 120)) % count);
  }

  drawFallbackFighter(player, theme, animName, now) {
    const ctx = this.ctx;
    const phase = now * 0.004;
    const bob = Math.sin(phase) * 1.4;
    const crouch = animName === 'crouch' || animName === 'block';
    const lean = animName === 'walk' ? Math.sin(phase) * 0.8 : 0;
    const base = crouch ? 12 : 0;
    const hue = theme.primary;
    const accent = theme.accent;

    ctx.save();
    ctx.translate(lean, 0);
    // Legs.
    ctx.strokeStyle = hue;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-5, -55 + base);
    ctx.lineTo(-12, -25 + base);
    ctx.lineTo(-18, -2);
    ctx.moveTo(5, -55 + base);
    ctx.lineTo(12, -25 + base);
    ctx.lineTo(18, -2);
    ctx.stroke();
    // Torso.
    ctx.strokeStyle = '#1a1120';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.moveTo(0, -55 + base);
    ctx.lineTo(0, -108 + bob + base);
    ctx.stroke();
    ctx.strokeStyle = hue;
    ctx.lineWidth = 17;
    ctx.stroke();
    // Belt.
    ctx.fillStyle = accent;
    ctx.fillRect(-9, -61 + base, 18, 4);
    // Arms.
    ctx.strokeStyle = hue;
    ctx.lineWidth = 6;
    const armSwing = animName === 'walk' ? Math.sin(phase) * 8 : 0;
    ctx.beginPath();
    ctx.moveTo(-2, -103 + bob + base);
    ctx.lineTo(-15, -80 + armSwing + base);
    ctx.lineTo(-9, -62 + armSwing + base);
    ctx.moveTo(2, -103 + bob + base);
    ctx.lineTo(15, -80 - armSwing + base);
    ctx.lineTo(9, -62 - armSwing + base);
    ctx.stroke();
    // Head.
    ctx.fillStyle = '#1a1120';
    ctx.beginPath();
    ctx.arc(0, -124 + bob + base, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hue;
    ctx.beginPath();
    ctx.arc(0, -124 + bob + base, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(4, -124 + bob + base, 2, 0, Math.PI * 2);
    ctx.fill();
    // Scarf.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -114 + bob + base);
    ctx.quadraticCurveTo(-19, -108 + Math.sin(phase) * 4 + base, -28, -116 + base);
    ctx.stroke();
    ctx.restore();
  }

  drawStatusEffects(player, theme, now) {
    const ctx = this.ctx;
    const y = player.y - 85;

    if (player.shield && player.shield.amount > 0) {
      const pulse = 0.65 + Math.sin(now * 0.006) * 0.14;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = `rgba(120, 225, 255, ${0.35 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(player.x, y, 64, 92, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(80, 200, 255, ${0.055 * pulse})`;
      ctx.fill();
      ctx.restore();
    }

    const statuses = player.statuses || [];
    for (const status of statuses) {
      if (status.type === 'burn' || status.type === 'poison') {
        const color = status.type === 'burn' ? '#ff7a18' : '#84cc16';
        for (let i = 0; i < 3; i += 1) {
          const t = (now * 0.005 + i * 0.7 + player.x * 0.01) % 1;
          const px = player.x + Math.sin(t * 8 + i * 2.4) * (22 + i * 5);
          const py = player.y - 20 - t * 120;
          const size = 3 + (1 - t) * 5;
          ctx.fillStyle = rgba(color, (1 - t) * 0.55);
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (status.type === 'stun') {
        for (let i = 0; i < 3; i += 1) {
          const angle = now * 0.004 + (i * Math.PI * 2) / 3;
          ctx.fillStyle = '#ffd166';
          drawStar(ctx, player.x + Math.cos(angle) * 24, player.y - 172 + Math.sin(angle) * 7, 5, 2.2, 5, angle, '#ffd166');
        }
      }
      if (status.type === 'buff') {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const glow = ctx.createRadialGradient(player.x, y, 20, player.x, y, 84);
        glow.addColorStop(0, rgba('#9b6cff', 0.1));
        glow.addColorStop(1, rgba('#9b6cff', 0));
        ctx.fillStyle = glow;
        ctx.fillRect(player.x - 90, y - 90, 180, 180);
        ctx.restore();
      }
      if (status.type === 'slow') {
        ctx.strokeStyle = 'rgba(52, 231, 255, 0.28)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 2; i += 1) {
          const offset = ((now * 0.03 + i * 40) % 80) - 40;
          ctx.beginPath();
          ctx.arc(player.x + offset, player.y - 40, 48, 0.2, 1.1);
          ctx.stroke();
        }
      }
    }

    if (player.invuln > 0 && player.hitstun <= 0 && player.health > 0) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(player.x, y, 48, now * 0.002, now * 0.002 + 0.7);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawProjectiles(now) {
    const ctx = this.ctx;
    for (const visual of this.projectileVisuals.values()) {
      const target = visual.target;
      visual.x = lerp(visual.x, target.x, 0.42);
      visual.y = lerp(visual.y, target.y, 0.42);
      visual.angle += 0.028;
      const x = visual.x;
      const y = visual.y;
      const color = target.color || '#ff7a18';
      const secondary = target.secondary || '#ffd166';
      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      if (target.shape === 'shuriken') {
        for (let i = 0; i < 4; i += 1) {
          ctx.globalAlpha = 0.18 - i * 0.035;
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x - (target.w || 42) / 2 - i * 13, y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        drawStar(ctx, x, y, (target.w || 42) / 2 + 5, 8, 4, visual.angle, rgba(color, 0.22), rgba(secondary, 0.8));
        drawStar(ctx, x, y, (target.w || 42) / 2 - 3, 6, 4, visual.angle + 0.5, secondary, color);
        drawStar(ctx, x, y, 6, 3, 4, visual.angle, '#ffffff');
      } else {
        const radius = Math.max(14, (target.w || 48) / 2);
        const glow = ctx.createRadialGradient(x, y, 1, x, y, radius * 2.3);
        glow.addColorStop(0, rgba(secondary, 0.7));
        glow.addColorStop(0.35, rgba(color, 0.34));
        glow.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.3, 0, Math.PI * 2);
        ctx.fill();

        // Trail.
        for (let i = 1; i <= 4; i += 1) {
          ctx.fillStyle = rgba(color, 0.09 / i);
          ctx.beginPath();
          ctx.arc(x - i * 13, y + Math.sin(now * 0.01 + i) * 2, radius * (1 - i * 0.1), 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = '#1a0d18';
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.95, 0, Math.PI * 2);
        ctx.fill();
        const orb = ctx.createRadialGradient(x - radius * 0.25, y - radius * 0.3, 2, x, y, radius);
        orb.addColorStop(0, '#ffffff');
        orb.addColorStop(0.35, secondary);
        orb.addColorStop(1, color);
        ctx.fillStyle = orb;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.78, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      if (particle.type === 'slash') {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.direction * 0.55);
        ctx.strokeStyle = rgba(particle.color, alpha * 0.85);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, particle.size, -1.25, 1.25);
        ctx.stroke();
        ctx.strokeStyle = rgba('#ffffff', alpha * 0.5);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, particle.size * 0.82, -1.1, 1.1);
        ctx.stroke();
        ctx.restore();
      } else if (particle.type === 'dust') {
        ctx.fillStyle = rgba(particle.color, alpha * 0.18);
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * (1.5 - alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = rgba(particle.color, alpha);
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawRings() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const ring of this.rings) {
      const alpha = clamp(ring.life / ring.maxLife, 0, 1);
      ctx.strokeStyle = rgba(ring.color, alpha * 0.7);
      ctx.lineWidth = ring.width * alpha + 0.5;
      ctx.beginPath();
      ctx.ellipse(ring.x, ring.y, ring.radius, ring.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFloaters() {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const floater of this.floaters) {
      const alpha = clamp(floater.life / floater.maxLife, 0, 1);
      const pop = floater.life > floater.maxLife - 0.1 ? 1 + (floater.maxLife - floater.life) * 2 : 1;
      ctx.font = `900 ${Math.round(floater.size * pop)}px ${floater.label ? UI_FONT : DISPLAY_FONT}`;
      ctx.lineWidth = floater.label ? 3 : 4;
      ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.7})`;
      ctx.strokeText(floater.text, floater.x, floater.y);
      ctx.fillStyle = rgba(floater.color, alpha);
      ctx.fillText(floater.text, floater.x, floater.y);
    }
    ctx.restore();
  }

  drawEmotes(players) {
    const ctx = this.ctx;
    for (const emote of this.emotes) {
      const pos = this.screenPositions.get(emote.playerId);
      if (!pos) continue;
      const player = players.find((entry) => entry.id === emote.playerId);
      const meta = this.playersMeta.get(emote.playerId);
      const hero = player?._hero || meta?.hero;
      const accent = hero?.theme?.accent || '#ffd166';
      const alpha = clamp(emote.life / 0.35, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `800 15px ${UI_FONT}`;
      const width = ctx.measureText(emote.text).width + 26;
      const height = 36;
      const x = pos.x - width / 2;
      const y = pos.y - 262;
      ctx.fillStyle = 'rgba(8, 10, 22, 0.92)';
      ctx.strokeStyle = rgba(accent, 0.55);
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, x, y, width, height, 12);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos.x - 6, y + height);
      ctx.lineTo(pos.x + 6, y + height);
      ctx.lineTo(pos.x, y + height + 9);
      ctx.closePath();
      ctx.fillStyle = 'rgba(8, 10, 22, 0.92)';
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emote.text, pos.x, y + height / 2 + 1);
      ctx.restore();
    }
  }

  drawCinematic(now) {
    const ctx = this.ctx;
    const cinema = this.snapshot.cinematic;
    const meta = this.playersMeta.get(cinema.ownerId);
    const owner = this.snapshot.players.find((player) => player.id === cinema.ownerId);
    const hero = meta?.hero || this.heroes.get(owner?.heroId);
    const theme = hero?.theme || { primary: '#ff5a1f', accent: '#ffd166' };
    const duration = Math.max(1, cinema.duration || 150);
    const progress = clamp(1 - (cinema.ticksLeft || 0) / duration, 0, 1);

    ctx.save();
    ctx.fillStyle = `rgba(2, 3, 10, ${0.72 + Math.sin(progress * Math.PI) * 0.08})`;
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);

    // Diagonal speed lines.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = rgba(theme.primary, 0.22);
    ctx.lineWidth = 2;
    const offset = (now * 0.12) % 90;
    for (let i = -10; i < 30; i += 1) {
      const x = i * 90 + offset;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - 260, ARENA.height);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(theme.accent, 0.08);
    for (let i = -10; i < 30; i += 1) {
      const x = i * 130 - offset * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - 420, ARENA.height);
      ctx.stroke();
    }
    ctx.restore();

    // Portrait panel.
    const portraitEntry = hero?.portrait ? this.image(hero.portrait) : null;
    const panelX = 650;
    const panelY = 52;
    const panelW = 580;
    const panelH = 616;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(panelX + 110, panelY);
    ctx.lineTo(panelX + panelW, panelY - 24);
    ctx.lineTo(panelX + panelW - 10, panelY + panelH + 20);
    ctx.lineTo(panelX, panelY + panelH);
    ctx.closePath();
    ctx.clip();
    const panelBg = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY + panelH);
    panelBg.addColorStop(0, rgba(theme.primary, 0.25));
    panelBg.addColorStop(0.55, 'rgba(8, 8, 20, 0.9)');
    panelBg.addColorStop(1, 'rgba(3, 4, 10, 0.95)');
    ctx.fillStyle = panelBg;
    ctx.fillRect(panelX, panelY, panelW, panelH);
    if (portraitEntry?.ready) {
      const img = portraitEntry.img;
      const scale = Math.max(panelW / img.width, panelH / img.height) * 1.06;
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img, panelX + (panelW - dw) / 2 + 50, panelY + (panelH - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    } else {
      ctx.font = `900 260px ${DISPLAY_FONT}`;
      ctx.fillStyle = rgba(theme.accent, 0.18);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((hero?.displayName || '?').slice(0, 1), panelX + panelW / 2, panelY + panelH / 2);
    }
    const shade = ctx.createLinearGradient(panelX, panelY, panelX + 260, panelY);
    shade.addColorStop(0, 'rgba(3, 4, 10, 0.96)');
    shade.addColorStop(1, 'rgba(3, 4, 10, 0)');
    ctx.fillStyle = shade;
    ctx.fillRect(panelX, panelY, 300, panelH);
    ctx.restore();

    // Owner panel border strips.
    ctx.strokeStyle = rgba(theme.accent, 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(panelX + 110, panelY);
    ctx.lineTo(panelX + panelW, panelY - 24);
    ctx.lineTo(panelX + panelW - 10, panelY + panelH + 20);
    ctx.lineTo(panelX, panelY + panelH);
    ctx.closePath();
    ctx.stroke();

    // Text.
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(theme.accent, 0.85);
    ctx.font = `800 13px ${MONO_FONT}`;
    ctx.fillText('ULTIMATE', 112, 238);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 62px ${DISPLAY_FONT}`;
    const name = String(cinema.skillName || 'ULTIMATE').toUpperCase();
    this.wrapText(ctx, name, 108, 300, 470, 66, theme);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = `800 12px ${UI_FONT}`;
    ctx.fillText(meta?.nickname || owner?.nickname || 'FIGHTER', 112, 430);
    ctx.fillStyle = rgba(theme.primary, 0.65);
    ctx.fillRect(112, 448, 250, 2);
    ctx.restore();

    // Progress bar.
    const barW = 340;
    const barX = 112;
    const barY = 640;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(barX, barY, barW, 3);
    ctx.fillStyle = rgba(theme.accent, 0.85);
    ctx.fillRect(barX, barY, barW * progress, 3);
    ctx.restore();
  }

  wrapText(ctx, text, x, y, maxWidth, lineHeight, theme) {
    const words = text.split(' ');
    let line = '';
    let lineY = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        this.strokeFillText(ctx, line, x, lineY, theme);
        line = word;
        lineY += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) this.strokeFillText(ctx, line, x, lineY, theme);
  }

  strokeFillText(ctx, text, x, y, theme) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 6;
    ctx.strokeText(text, x, y);
    const gradient = ctx.createLinearGradient(x, y - 40, x, y + 30);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.6, '#ffe4bd');
    gradient.addColorStop(1, theme?.accent || '#ffb02e');
    ctx.fillStyle = gradient;
    ctx.fillText(text, x, y);
  }

  drawCountdownTint() {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(2, 3, 10, 0.16)';
    ctx.fillRect(0, 0, ARENA.width, ARENA.height);
  }

  drawVignette(now) {
    const ctx = this.ctx;
    const pulse = this.snapshot?.phase === 'playing' && this.snapshot?.timer <= 10
      ? 0.09 + Math.sin(now * 0.008) * 0.05
      : 0;
    if (pulse > 0) {
      const red = ctx.createRadialGradient(640, 360, 300, 640, 360, 760);
      red.addColorStop(0, 'rgba(255, 20, 50, 0)');
      red.addColorStop(1, `rgba(255, 20, 50, ${pulse})`);
      ctx.fillStyle = red;
      ctx.fillRect(0, 0, ARENA.width, ARENA.height);
    }
  }
}
