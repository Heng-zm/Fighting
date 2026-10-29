'use strict';

/** Minimal software raster drawing used to generate placeholder art. */

function parseColor(color) {
  if (Array.isArray(color)) return color;
  const hex = String(color || '#ffffff').replace('#', '');
  const value = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    255
  ];
}

class Bitmap {
  constructor(width, height, background = null) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
    if (background) this.fillRect(0, 0, width, height, background);
  }

  blend(x, y, color, coverage = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const [r, g, b, a = 255] = color;
    const alpha = (a / 255) * coverage;
    if (alpha <= 0) return;
    const i = (y * this.width + x) * 4;
    const dstA = this.data[i + 3] / 255;
    const outA = alpha + dstA * (1 - alpha);
    if (outA <= 0) return;
    this.data[i] = Math.round((r * alpha + this.data[i] * dstA * (1 - alpha)) / outA);
    this.data[i + 1] = Math.round((g * alpha + this.data[i + 1] * dstA * (1 - alpha)) / outA);
    this.data[i + 2] = Math.round((b * alpha + this.data[i + 2] * dstA * (1 - alpha)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }

  fillRect(x, y, w, h, color, alpha = 1) {
    const c = parseColor(color);
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) this.blend(xx, yy, c, alpha);
    }
  }

  circle(cx, cy, radius, color, alpha = 1) {
    this.ellipse(cx, cy, radius, radius, color, alpha);
  }

  ellipse(cx, cy, rx, ry, color, alpha = 1) {
    const c = parseColor(color);
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const dist = dx * dx + dy * dy;
        if (dist <= 1) {
          const coverage = dist > 0.82 ? (1 - dist) / 0.18 : 1;
          this.blend(x, y, c, alpha * Math.max(0.15, coverage));
        }
      }
    }
  }

  line(x1, y1, x2, y2, width, color, alpha = 1) {
    const c = parseColor(color);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.ceil(length * 1.4);
    const radius = Math.max(0.5, width / 2);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.circle(x1 + dx * t, y1 + dy * t, radius, c, alpha);
    }
  }

  polygon(points, color, alpha = 1) {
    if (!points || points.length < 3) return;
    const c = parseColor(color);
    const ys = points.map((p) => p[1]);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y += 1) {
      const intersections = [];
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          intersections.push(a[0] + t * (b[0] - a[0]));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        for (let x = Math.ceil(intersections[i]); x <= Math.floor(intersections[i + 1]); x += 1) {
          this.blend(x, y, c, alpha);
        }
      }
    }
  }

  glow(cx, cy, radius, color, strength = 0.25) {
    const c = parseColor(color);
    for (let i = 6; i >= 1; i -= 1) {
      this.circle(cx, cy, (radius * i) / 6, c, strength / i);
    }
  }
}

/** Nearest-neighbour scale + optional horizontal flip. */
function blitScaled(dst, src, dx, dy, scale, flipX = false) {
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const sy = Math.min(src.height - 1, Math.floor(y / scale));
      const px = flipX ? src.width - 1 - sx : sx;
      const i = (sy * src.width + px) * 4;
      const a = src.data[i + 3];
      if (!a) continue;
      dst.blend(dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2], a]);
    }
  }
}

/**
 * Maps a drawing authored in a 96x96 cell onto a larger bitmap. This lets the
 * fighter art be rendered with extra pixels (and then box-filtered) without
 * duplicating every coordinate in the character rig.
 */
class ScaledBitmap {
  constructor(target, scale) {
    this.target = target;
    this.scale = scale;
  }

  get width() {
    return this.target.width / this.scale;
  }

  get height() {
    return this.target.height / this.scale;
  }

  blend(x, y, color, coverage = 1) {
    this.target.blend(x * this.scale, y * this.scale, color, coverage);
  }

  fillRect(x, y, w, h, color, alpha = 1) {
    this.target.fillRect(x * this.scale, y * this.scale, w * this.scale, h * this.scale, color, alpha);
  }

  circle(cx, cy, radius, color, alpha = 1) {
    this.target.circle(cx * this.scale, cy * this.scale, radius * this.scale, color, alpha);
  }

  ellipse(cx, cy, rx, ry, color, alpha = 1) {
    this.target.ellipse(cx * this.scale, cy * this.scale, rx * this.scale, ry * this.scale, color, alpha);
  }

  line(x1, y1, x2, y2, width, color, alpha = 1) {
    this.target.line(
      x1 * this.scale,
      y1 * this.scale,
      x2 * this.scale,
      y2 * this.scale,
      Math.max(0.5, width * this.scale),
      color,
      alpha
    );
  }

  polygon(points, color, alpha = 1) {
    this.target.polygon(
      points.map(([x, y]) => [x * this.scale, y * this.scale]),
      color,
      alpha
    );
  }

  glow(cx, cy, radius, color, strength = 0.25) {
    this.target.glow(cx * this.scale, cy * this.scale, radius * this.scale, color, strength);
  }
}

/** Alpha-aware box filter used to anti-alias supersampled art. */
function downsample(src, factor) {
  const width = Math.max(1, Math.round(src.width / factor));
  const height = Math.max(1, Math.round(src.height / factor));
  const out = new Bitmap(width, height);
  const samples = factor * factor;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        const py = y * factor + sy;
        if (py >= src.height) break;
        for (let sx = 0; sx < factor; sx += 1) {
          const px = x * factor + sx;
          if (px >= src.width) continue;
          const i = (py * src.width + px) * 4;
          const a = src.data[i + 3] / 255;
          if (a <= 0) continue;
          r += src.data[i] * a;
          g += src.data[i + 1] * a;
          b += src.data[i + 2] * a;
          alpha += a;
        }
      }
      if (alpha <= 0) continue;
      const o = (y * width + x) * 4;
      out.data[o] = Math.round(r / alpha);
      out.data[o + 1] = Math.round(g / alpha);
      out.data[o + 2] = Math.round(b / alpha);
      out.data[o + 3] = Math.round((alpha / samples) * 255);
    }
  }
  return out;
}

module.exports = { Bitmap, ScaledBitmap, downsample, blitScaled, parseColor };

