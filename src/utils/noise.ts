/**
 * Compact 2D/3D gradient noise (improved Perlin) + fBm, used to sculpt the
 * procedural island. Deterministic for a given seed.
 */
import { mulberry32 } from './math';

export class Noise {
  private perm = new Uint8Array(512);

  constructor(seed = 1) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private static fade(t: number) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private static grad(h: number, x: number, y: number, z: number) {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  noise3(x: number, y: number, z: number) {
    const P = this.perm;
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = Noise.fade(x);
    const v = Noise.fade(y);
    const w = Noise.fade(z);
    const A = P[X] + Y;
    const AA = P[A] + Z;
    const AB = P[A + 1] + Z;
    const B = P[X + 1] + Y;
    const BA = P[B] + Z;
    const BB = P[B + 1] + Z;
    const g = Noise.grad;
    const l = (a: number, b: number, t: number) => a + t * (b - a);
    return l(
      l(l(g(P[AA] & 15, x, y, z), g(P[BA] & 15, x - 1, y, z), u), l(g(P[AB] & 15, x, y - 1, z), g(P[BB] & 15, x - 1, y - 1, z), u), v),
      l(
        l(g(P[AA + 1] & 15, x, y, z - 1), g(P[BA + 1] & 15, x - 1, y, z - 1), u),
        l(g(P[AB + 1] & 15, x, y - 1, z - 1), g(P[BB + 1] & 15, x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }

  noise2(x: number, y: number) {
    return this.noise3(x, y, 0.5);
  }

  fbm2(x: number, y: number, octaves = 4, lac = 2, gain = 0.5) {
    let a = 0.5;
    let f = 1;
    let s = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * this.noise2(x * f, y * f);
      f *= lac;
      a *= gain;
    }
    return s;
  }

  fbm3(x: number, y: number, z: number, octaves = 3) {
    let a = 0.5;
    let f = 1;
    let s = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * this.noise3(x * f, y * f, z * f);
      f *= 2;
      a *= 0.5;
    }
    return s;
  }
}
