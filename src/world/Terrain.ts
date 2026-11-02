import * as THREE from 'three';
import { Noise } from '../utils/noise';
import { clamp, distToPolyline, smoothstep, lerp, TAU } from '../utils/math';
import { C } from './palette';
import { CASTLE, MOUNTAINS, PATHS, RIVER, VILLAGE, ISLAND_R, FOREST, CRYSTALS } from './layout';

const noise = new Noise(7);

/** Irregular island outline. */
export function edgeRadius(theta: number) {
  return ISLAND_R * (1 + 0.06 * Math.sin(theta * 3 + 0.7) + 0.035 * Math.sin(theta * 7 + 1.3) + 0.02 * noise.noise2(Math.cos(theta) * 2, Math.sin(theta) * 2));
}

function mountainHeight(x: number, z: number) {
  let h = 0;
  for (const m of MOUNTAINS) {
    const d = Math.hypot(x - m.x, z - m.z) / m.r;
    if (d < 1) {
      const k = Math.pow(1 - d, 1.55);
      const ridged = 1 - Math.abs(noise.noise2(x * 9 + m.x * 3, z * 9));
      h = Math.max(h, m.h * k * (0.82 + 0.25 * ridged));
    }
  }
  return h;
}

/** Height before the river is carved. */
function baseHeight(x: number, z: number) {
  let h = 0.02 + noise.fbm2(x * 2.2, z * 2.2, 3) * 0.05;
  h += mountainHeight(x, z);
  // castle plateau
  const dc = Math.hypot(x - CASTLE.x, z - CASTLE.z);
  const plateau = 1 - smoothstep(CASTLE.r * 0.72, CASTLE.r * 1.35, dc);
  h = Math.max(h, lerp(h, CASTLE.h, plateau));
  // village is flattened
  const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
  const flat = 1 - smoothstep(VILLAGE.r * 0.7, VILLAGE.r * 1.25, dv);
  h = lerp(h, 0.03, flat * 0.85);
  // soft rim near the edge
  const r = Math.hypot(x, z);
  const er = edgeRadius(Math.atan2(z, x));
  h -= smoothstep(er * 0.86, er, r) * 0.035;
  return h;
}

let riverLevels: Float32Array | null = null;
const RIVER_SAMPLES = 64;

/** Water surface height along the river, forced to flow downhill. */
export function riverLevel(t: number) {
  if (!riverLevels) {
    riverLevels = new Float32Array(RIVER_SAMPLES + 1);
    let prev = Infinity;
    for (let i = 0; i <= RIVER_SAMPLES; i++) {
      const p = pointOnPolyline(RIVER, i / RIVER_SAMPLES);
      const lvl = Math.min(prev, baseHeight(p[0], p[1]) - 0.012, 0.05);
      riverLevels[i] = lvl;
      prev = lvl - 0.0008;
    }
  }
  const f = clamp(t) * RIVER_SAMPLES;
  const i = Math.min(Math.floor(f), RIVER_SAMPLES - 1);
  return lerp(riverLevels[i], riverLevels[i + 1], f - i);
}

export function riverWidth(t: number) {
  return lerp(0.05, 0.036, t) + (t < 0.06 ? (0.06 - t) * 0.9 : 0);
}

export function pointOnPolyline(pts: ReadonlyArray<readonly [number, number]>, t: number): [number, number] {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l);
    total += l;
  }
  let target = clamp(t) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const k = lens[i] > 0 ? clamp(target / lens[i]) : 0;
      return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)];
    }
    target -= lens[i];
  }
  return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
}

/** Final terrain height (island-local). */
export function terrainHeight(x: number, z: number) {
  let h = baseHeight(x, z);
  const rv = distToPolyline(x, z, RIVER);
  const w = riverWidth(rv.t);
  if (rv.d < w * 1.6) {
    const bed = riverLevel(rv.t) - 0.03;
    const k = 1 - smoothstep(w * 0.55, w * 1.6, rv.d);
    h = lerp(h, Math.min(h, bed), k);
  }
  return h;
}

export function pathDistance(x: number, z: number) {
  let d = Infinity;
  for (const p of PATHS) d = Math.min(d, distToPolyline(x, z, p).d);
  return d;
}

function terrainColor(x: number, z: number, h: number, slope: number, out: THREE.Color) {
  const n = noise.noise2(x * 7, z * 7);
  out.copy(C.grass).lerp(n > 0 ? C.grassLight : C.grassDark, Math.abs(n) * 1.3);
  // meadow tint in the front
  out.lerp(C.meadow, smoothstep(0.2, 0.9, z) * 0.35);
  // forest floor darker
  const df = Math.hypot(x - FOREST.x, z - FOREST.z);
  out.lerp(C.moss, (1 - smoothstep(FOREST.r * 0.4, FOREST.r * 1.1, df)) * 0.6);
  // crystal glade slightly lavender
  const dg = Math.hypot(x - CRYSTALS.x, z - CRYSTALS.z);
  out.lerp(new THREE.Color('#8f9a7a'), (1 - smoothstep(0.02, 0.14, dg)) * 0.5);
  // paths
  const pd = pathDistance(x, z);
  out.lerp(C.path, (1 - smoothstep(0.012, 0.03, pd)) * 0.9);
  // river banks
  const rv = distToPolyline(x, z, RIVER);
  const w = riverWidth(rv.t);
  out.lerp(C.sand, 1 - smoothstep(w * 0.9, w * 1.55, rv.d));
  // rock on slopes and heights
  const rockiness = clamp(smoothstep(0.55, 1.2, slope) + smoothstep(0.24, 0.42, h) * 0.85);
  out.lerp(n > 0.1 ? C.rock : C.rockDark, rockiness);
  // snow caps
  const snow = smoothstep(0.5, 0.6, h + n * 0.04) * (1 - smoothstep(2.5, 4.5, slope) * 0.35);
  out.lerp(C.snow, snow);
  return out;
}

export interface TerrainBuild {
  top: THREE.BufferGeometry;
  under: THREE.BufferGeometry;
}

/** Builds the island top surface (polar grid) and its rocky underside. */
export function buildTerrain(detail: number): TerrainBuild {
  const rings = [26, 34, 44][detail] ?? 34;
  const segs = [84, 112, 144][detail] ?? 112;

  // ---------- top surface ----------
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const eps = 0.01;
  pos.push(0, terrainHeight(0, 0), 0);
  terrainColor(0, 0, terrainHeight(0, 0), 0, c);
  col.push(c.r, c.g, c.b);
  for (let i = 1; i <= rings; i++) {
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * TAU;
      const er = edgeRadius(th);
      // denser rings toward the rim
      const rr = Math.pow(i / rings, 0.92) * er;
      const x = Math.cos(th) * rr;
      const z = Math.sin(th) * rr;
      const hgt = terrainHeight(x, z);
      const slope = Math.hypot(terrainHeight(x + eps, z) - hgt, terrainHeight(x, z + eps) - hgt) / eps;
      pos.push(x, hgt, z);
      terrainColor(x, z, hgt, slope, c);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs;
    const b0 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j);
      idx.push(a0 + j1, b0 + j1, b0 + j);
    }
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  top.setIndex(idx);
  top.computeVertexNormals();

  // ---------- underside (cliff + inverted rocky cone) ----------
  const uRings = [10, 14, 18][detail] ?? 14;
  const uSegs = Math.floor(segs / 2);
  const upos: number[] = [];
  const ucol: number[] = [];
  const uidx: number[] = [];
  const TIP = -0.82;
  for (let i = 0; i <= uRings; i++) {
    for (let j = 0; j < uSegs; j++) {
      const th = (j / uSegs) * TAU;
      const er = edgeRadius(th);
      let rr: number;
      let y: number;
      if (i === 0) {
        rr = er;
        y = terrainHeight(Math.cos(th) * er * 0.999, Math.sin(th) * er * 0.999);
      } else {
        const k = (i - 1) / (uRings - 1);
        rr = er * Math.pow(1 - k, 0.75) * (1.0 - 0.05 * k) + 0.002;
        y = -0.04 - Math.pow(k, 1.15) * (-TIP - 0.04);
        const n = noise.fbm3(Math.cos(th) * 2.5, y * 4, Math.sin(th) * 2.5, 3);
        rr *= 1 + n * 0.28;
        y += n * 0.05;
        // a few dangling stalactite lobes
        const lobe = Math.max(0, Math.sin(th * 5 + 1.1)) * Math.max(0, Math.sin(th * 3 - 0.4));
        y -= lobe * k * 0.18;
        if (i === uRings) rr *= 0.2;
      }
      upos.push(Math.cos(th) * rr, y, Math.sin(th) * rr);
      // strata colours
      const band = noise.noise2(y * 14, th * 2);
      if (i === 0) c.copy(C.grassDark);
      else if (y > -0.09) c.copy(C.soil).lerp(C.soilDark, 0.3 + band * 0.3);
      else if (y > -0.35) c.copy(C.rock).lerp(C.soil, 0.25 + band * 0.4);
      else c.copy(C.rockCool).lerp(C.rockDeep, smoothstep(-0.35, TIP, y) + band * 0.2);
      ucol.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < uRings; i++) {
    for (let j = 0; j < uSegs; j++) {
      const j1 = (j + 1) % uSegs;
      const a = i * uSegs + j;
      const b = i * uSegs + j1;
      const cc = (i + 1) * uSegs + j;
      const d = (i + 1) * uSegs + j1;
      uidx.push(a, b, cc, b, d, cc);
    }
  }
  // close bottom
  const tipIndex = upos.length / 3;
  upos.push(0, TIP - 0.1, 0);
  ucol.push(C.rockDeep.r, C.rockDeep.g, C.rockDeep.b);
  for (let j = 0; j < uSegs; j++) uidx.push(uRings * uSegs + j, uRings * uSegs + ((j + 1) % uSegs), tipIndex);

  let under = new THREE.BufferGeometry();
  under.setAttribute('position', new THREE.Float32BufferAttribute(upos, 3));
  under.setAttribute('color', new THREE.Float32BufferAttribute(ucol, 3));
  under.setIndex(uidx);
  under = under.toNonIndexed();
  under.computeVertexNormals();

  return { top, under };
}

/** Random point on the island satisfying a predicate (rejection sampling). */
export function samplePoint(rng: () => number, ok: (x: number, z: number) => boolean, tries = 60): [number, number] | null {
  for (let i = 0; i < tries; i++) {
    const th = rng() * TAU;
    const r = Math.sqrt(rng()) * 0.92;
    const x = Math.cos(th) * r * edgeRadius(th);
    const z = Math.sin(th) * r * edgeRadius(th);
    if (ok(x, z)) return [x, z];
  }
  return null;
}
