import * as THREE from 'three';
import { mulberry32 } from '../../utils/math';

/**
 * Hand-painted looking textures drawn on canvas at runtime, in the warm,
 * brushy palette of the farmhouse model (no image files to download).
 */
type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
}

export function toTexture(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const shade = (hex: string, k: number) => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * (k > 1 ? 0.95 : 1.05)), Math.max(0, Math.min(1, hsl.l * k)));
  return `#${c.getHexString()}`;
};

/** Soft brush dabs: the painterly grain shared by every texture. */
export function brush(ctx: Ctx, w: number, h: number, colors: string[], n: number, size: number, seed: number, alpha = 0.35) {
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.4 + r() * 0.6);
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const x = r() * w;
    const y = r() * h;
    const s = size * (0.4 + r());
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * (0.35 + r() * 0.4), r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Vertical wooden boards (one texture repeat ≈ 0.1 island units). */
export function woodTexture(base = '#c98a4a') {
  return cached(`wood${base}`, () => {
    const { c, ctx } = canvas(256, 256);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    const r = mulberry32(11);
    for (let i = 0; i < 8; i++) {
      const x = i * 32;
      ctx.fillStyle = shade(base, 0.88 + r() * 0.24);
      ctx.fillRect(x + 1, 0, 30, 256);
      ctx.strokeStyle = shade(base, 0.6);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
      // grain
      ctx.strokeStyle = shade(base, 0.78);
      ctx.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        const gx = x + 6 + r() * 20;
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + 4, 80, gx - 4, 170, gx + 2, 256);
        ctx.stroke();
      }
      if (r() < 0.5) {
        ctx.fillStyle = shade(base, 0.62);
        ctx.beginPath();
        ctx.ellipse(x + 16, r() * 256, 4, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    brush(ctx, 256, 256, [shade(base, 1.2), shade(base, 0.8)], 160, 10, 3, 0.18);
    return toTexture(c);
  });
}

/** Rounded clay tiles, painted in rows (tinted per roof colour). */
export function roofTexture(base: string) {
  return cached(`roof${base}`, () => {
    const { c, ctx } = canvas(256, 256);
    ctx.fillStyle = shade(base, 0.7);
    ctx.fillRect(0, 0, 256, 256);
    const r = mulberry32(base.length * 7 + base.charCodeAt(2));
    const rows = 8;
    const cols = 6;
    for (let j = 0; j < rows; j++) {
      const y = j * 32;
      const off = (j % 2) * 21;
      for (let i = -1; i < cols + 1; i++) {
        const x = i * 43 + off;
        const g = ctx.createLinearGradient(0, y, 0, y + 34);
        const k = 0.9 + r() * 0.25;
        g.addColorStop(0, shade(base, 1.25 * k));
        g.addColorStop(0.6, shade(base, 1.0 * k));
        g.addColorStop(1, shade(base, 0.7 * k));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + 2, y);
        ctx.lineTo(x + 41, y);
        ctx.quadraticCurveTo(x + 43, y + 30, x + 21.5, y + 34);
        ctx.quadraticCurveTo(x, y + 30, x + 2, y);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 8, y + 4, 10, 4);
      }
    }
    brush(ctx, 256, 256, [shade(base, 1.3), shade(base, 0.6)], 80, 8, 5, 0.15);
    return toTexture(c);
  });
}

/** Cream plaster with timber-frame hints. */
export function plasterTexture(base = '#efe0c2') {
  return cached(`plaster${base}`, () => {
    const { c, ctx } = canvas(256, 256);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    brush(ctx, 256, 256, [shade(base, 0.9), shade(base, 1.06), shade(base, 0.84)], 260, 16, 21, 0.25);
    return toTexture(c);
  });
}

/** Irregular stones (walls, fountain, wells). */
export function stoneTexture(base = '#9a948a') {
  return cached(`stone${base}`, () => {
    const { c, ctx } = canvas(256, 256);
    ctx.fillStyle = shade(base, 0.55);
    ctx.fillRect(0, 0, 256, 256);
    const r = mulberry32(31);
    for (let j = 0; j < 7; j++) {
      let x = -r() * 30;
      const y = j * 37;
      while (x < 256) {
        const w = 30 + r() * 34;
        const k = 0.85 + r() * 0.35;
        const g = ctx.createLinearGradient(0, y, 0, y + 34);
        g.addColorStop(0, shade(base, 1.2 * k));
        g.addColorStop(1, shade(base, 0.82 * k));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 2, w - 4, 33, 9);
        ctx.fill();
        x += w;
      }
    }
    brush(ctx, 256, 256, [shade(base, 1.3), shade(base, 0.7)], 120, 7, 9, 0.15);
    return toTexture(c);
  });
}

/** Layered cliff rock for the island sides and underside. */
export function rockTexture() {
  return cached('rock', () => {
    const { c, ctx } = canvas(512, 256);
    const bands = ['#8a6a4a', '#7a5a3e', '#6e5a4e', '#8a7564', '#5e4e44', '#74604f'];
    const r = mulberry32(41);
    let y = 0;
    let i = 0;
    while (y < 256) {
      const hgt = 14 + r() * 26;
      ctx.fillStyle = bands[i++ % bands.length];
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.03 + i) * 4);
      ctx.lineTo(512, y + hgt + 6);
      ctx.lineTo(0, y + hgt + 6);
      ctx.fill();
      y += hgt;
    }
    brush(ctx, 512, 256, ['#a3866a', '#4e3e34', '#9a8a7a'], 420, 12, 43, 0.22);
    // grassy lip at the top
    ctx.fillStyle = '#5a9a3c';
    ctx.fillRect(0, 0, 512, 10);
    for (let x = 0; x < 512; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x + 3, 14 + r() * 12);
      ctx.lineTo(x + 6, 8);
      ctx.fill();
    }
    return toTexture(c);
  });
}

/** Painted wooden door with a little window. */
export function doorTexture() {
  return cached('door', () => {
    const { c, ctx } = canvas(64, 128);
    ctx.fillStyle = '#7a4a26';
    ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = '#a5683a';
    ctx.beginPath();
    ctx.roundRect(5, 5, 54, 120, 10);
    ctx.fill();
    ctx.strokeStyle = '#6a3d1e';
    ctx.lineWidth = 2;
    for (const x of [22, 42]) {
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, 122);
      ctx.stroke();
    }
    ctx.fillStyle = '#9fd3f0';
    ctx.fillRect(20, 18, 24, 22);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.arc(48, 72, 4, 0, Math.PI * 2);
    ctx.fill();
    return toTexture(c, false);
  });
}

/** Window with green shutters; the glass is lit by `uNight` through emissive. */
export function windowTexture() {
  return cached('window', () => {
    const { c, ctx } = canvas(128, 96);
    ctx.fillStyle = '#4f8a3f';
    ctx.fillRect(0, 0, 26, 96);
    ctx.fillRect(102, 0, 26, 96);
    ctx.strokeStyle = '#3a6a2e';
    ctx.lineWidth = 2;
    for (const x of [6, 13, 20, 108, 115, 122]) {
      ctx.beginPath();
      ctx.moveTo(x, 6);
      ctx.lineTo(x, 90);
      ctx.stroke();
    }
    ctx.fillStyle = '#6a3d1e';
    ctx.fillRect(26, 0, 76, 96);
    const g = ctx.createLinearGradient(0, 8, 0, 88);
    g.addColorStop(0, '#bfe6ff');
    g.addColorStop(1, '#6fa8d8');
    ctx.fillStyle = g;
    ctx.fillRect(32, 8, 64, 80);
    ctx.fillStyle = '#6a3d1e';
    ctx.fillRect(62, 8, 4, 80);
    ctx.fillRect(32, 46, 64, 4);
    return toTexture(c, false);
  });
}

/** Emissive mask for windows (only the glass glows at night). */
export function windowGlowTexture() {
  return cached('windowGlow', () => {
    const { c, ctx } = canvas(128, 96);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#ffd98a';
    ctx.fillRect(32, 8, 64, 80);
    return toTexture(c, false);
  });
}

/** Clock face for the community-center tower. */
export function clockTexture() {
  return cached('clock', () => {
    const { c, ctx } = canvas(128, 128);
    ctx.fillStyle = '#f4ead2';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6a4a2e';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#6a4a2e';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillRect(64 + Math.cos(a) * 48 - 3, 64 + Math.sin(a) * 48 - 3, 6, 6);
    }
    return toTexture(c, false);
  });
}

/** Little wooden sign with painted lettering. */
export function signTexture(text: string) {
  return cached(`sign${text}`, () => {
    const { c, ctx } = canvas(256, 64);
    ctx.fillStyle = '#8a5a30';
    ctx.beginPath();
    ctx.roundRect(2, 2, 252, 60, 10);
    ctx.fill();
    ctx.strokeStyle = '#5a361a';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#fbe9c4';
    ctx.font = 'bold 30px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34);
    return toTexture(c, false);
  });
}
