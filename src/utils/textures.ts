import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, tex);
  return tex;
}

/** Soft round glow used by most particle systems. */
export const glowTexture = () =>
  canvasTexture('glow', 64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

/** Puffy smoke sprite. */
export const smokeTexture = () =>
  canvasTexture('smoke', 64, (ctx, s) => {
    for (let i = 0; i < 6; i++) {
      const x = s / 2 + Math.cos(i * 1.7) * s * 0.12;
      const y = s / 2 + Math.sin(i * 2.3) * s * 0.12;
      const g = ctx.createRadialGradient(x, y, 0, x, y, s * 0.36);
      g.addColorStop(0, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });

/** Four-point sparkle star. */
export const sparkTexture = () =>
  canvasTexture('spark', 64, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [w, hgt] of [
      [s * 0.06, s * 0.92],
      [s * 0.92, s * 0.06],
    ]) {
      const lg = ctx.createRadialGradient(c, c, 0, c, c, c);
      lg.addColorStop(0, 'rgba(255,255,255,0.95)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.ellipse(c, c, w / 2, hgt / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
