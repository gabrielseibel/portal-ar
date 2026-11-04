import * as THREE from 'three';
import { Noise } from '../../utils/noise';
import { clamp, distToPolyline, lerp, mulberry32, smoothstep } from '../../utils/math';
import { rockTexture, toTexture } from './paint';
import {
  BEACH, COAST, DESERT, DESERT_ROAD, FARM, FIELDS, FOREST_EAST, FOREST_NORTH, FOREST_PONDS, FOREST_SOUTH, FOREST_TRAILS, FOREST_WEST, TERRACE, HOUSE, ISLAND, LAKE, MOUNTAINS, ORCHARD, PATHS, PEN, PLAZA, POND,
  RIVERS, SEA_Y, WATERFALL, inRect, type P2,
} from './layout';

const noise = new Noise(77);
const edgeNoise = (th: number) => 1 + 0.028 * Math.sin(th * 5 + 0.7) + 0.018 * Math.sin(th * 9 + 2.1) + 0.01 * Math.sin(th * 17);

/** 0 at the island centre, 1 on its rim (super-ellipse with a wavy outline). */
export function edgeFactor(x: number, z: number) {
  const { a, b, n } = ISLAND;
  const e = Math.pow(Math.pow(Math.abs(x) / a, n) + Math.pow(Math.abs(z) / b, n), 1 / n);
  return e / edgeNoise(Math.atan2(z, x));
}

/** z of the coastline at x (sea lies south of it); +inf where there is no coast. */
export function coastZ(x: number) {
  if (x < COAST[0][0]) return 99;
  for (let i = 0; i < COAST.length - 1; i++) {
    const [ax, az] = COAST[i];
    const [bx, bz] = COAST[i + 1];
    if (x <= bx) return lerp(az, bz, (x - ax) / (bx - ax));
  }
  return COAST[COAST.length - 1][1];
}
export const seaFactor = (x: number, z: number) => smoothstep(0.0, 0.09, z - coastZ(x));

/** Distance to the nearest river (any of them) and that river's parameters. */
export function nearestRiver(x: number, z: number) {
  let best = { d: Infinity, t: 0, w: 0.03, top: 0, bottom: 0 };
  for (const r of RIVERS) {
    const q = distToPolyline(x, z, r.pts as P2[]);
    if (q.d / r.w < best.d / best.w) best = { d: q.d, t: q.t, w: r.w, top: r.top, bottom: r.bottom };
  }
  return best;
}

/** Ground height (island units). Farm and town stay flat; relief in the mountains and at the water. */
export function heightAt(x: number, z: number) {
  let h = 0.006 * noise.fbm2(x * 3.2, z * 3.2, 3);
  for (const m of MOUNTAINS) {
    const d2 = ((x - m.x) ** 2 + (z - m.z) ** 2) / (m.r * m.r);
    h += m.h * Math.exp(-d2 * 2.1) * (0.85 + 0.15 * noise.noise2(x * 9, z * 9));
  }
  // rocky ledge north of the farm and the forest: a steep step with flat top
  h += TERRACE.h * smoothstep(TERRACE.z + 0.012, TERRACE.z - 0.012, z) * smoothstep(TERRACE.x1 + 0.05, TERRACE.x1 - 0.05, x);
  // desert dunes
  if (inRect(x, z, DESERT, 0.05)) h += 0.012 * (0.5 + 0.5 * Math.sin(x * 18 + Math.sin(z * 9) * 2));
  // mountain lake on a plateau, the waterfall drops through a notch to the river
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = lerp(h, LAKE.y, smoothstep(LAKE.r + 0.12, LAKE.r + 0.03, dl));
  if (dl < LAKE.r) h = LAKE.y - 0.04 * smoothstep(LAKE.r, LAKE.r * 0.45, dl);
  if (Math.abs(x - WATERFALL.x) < 0.045 && z > WATERFALL.top - 0.02 && z < WATERFALL.bottom + 0.02) h = Math.min(h, lerp(LAKE.y - 0.02, -0.01, smoothstep(WATERFALL.top, WATERFALL.bottom, z)));
  // river beds
  const r = nearestRiver(x, z);
  h = lerp(h, Math.min(h, lerp(r.top, r.bottom, r.t) - 0.035), smoothstep(r.w * 1.7, r.w * 0.75, r.d));
  // ponds
  for (const p of [POND, ...FOREST_PONDS]) {
    const dp = Math.hypot(x - p.x, z - p.z);
    if (dp < p.r + 0.02) h = Math.min(h, -0.048 * smoothstep(p.r + 0.02, p.r * 0.5, dp));
  }
  // the sea, with a rocky lip along the island rim
  const s = seaFactor(x, z);
  h = lerp(h, -0.1, s);
  const e = edgeFactor(x, z);
  h -= smoothstep(0.92, 1.0, e) * 0.02;
  if (s > 0.01) h = Math.max(h, lerp(-0.12, 0.016, smoothstep(0.93, 0.985, e)));
  return h;
}


const W = ISLAND.a * 2 + 0.1;
const D = ISLAND.b * 2 + 0.1;
const X0 = -W / 2;
const Z0 = -D / 2;

export interface TerrainBuild {
  ground: THREE.Mesh;
  cliffs: THREE.Mesh;
  underside: THREE.Mesh;
  water: THREE.Mesh[];
  fall: THREE.Mesh;
  map: THREE.Texture;
}

export function buildTerrain(detail: number, waterMat: THREE.Material, fallMat: THREE.Material): TerrainBuild {
  const map = paintGroundMap(detail >= 1 ? 2048 : 1536);
  const ground = new THREE.Mesh(groundGeometry(Math.round(220 * detail)), new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 }));
  ground.name = 'vale-terreno';
  const rock = new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 1 });
  const { cliffs, underside } = cliffGeometries();
  const cliffMesh = new THREE.Mesh(cliffs, rock);
  cliffMesh.name = 'vale-penhascos';
  const under = new THREE.Mesh(underside, rock);
  under.name = 'vale-base';
  const water = [
    seaMesh(waterMat),
    ...RIVERS.map((r, i) => riverMesh(waterMat, r.pts, r.w, r.top, r.bottom, `rio-${i}`)),
    diskMesh(POND.x, POND.z, POND.r, -0.017, waterMat, 'lago-fazenda'),
    ...FOREST_PONDS.map((p, i) => diskMesh(p.x, p.z, p.r, -0.017, waterMat, `lago-floresta-${i}`)),
    diskMesh(LAKE.x, LAKE.z, LAKE.r + 0.01, LAKE.y - 0.008, waterMat, 'lago-montanha'),
  ];
  const fall = waterfallMesh(fallMat);
  return { ground, cliffs: cliffMesh, underside: under, water, fall, map };
}

// ------------------------------------------------------------------ meshes
function groundGeometry(segX: number) {
  const segZ = Math.round((segX * D) / W);
  const nx = segX + 1;
  const pos = new Float32Array(nx * (segZ + 1) * 3);
  const uv = new Float32Array(nx * (segZ + 1) * 2);
  const inside = new Uint8Array(nx * (segZ + 1));
  for (let j = 0; j <= segZ; j++) {
    for (let i = 0; i <= segX; i++) {
      let x = X0 + (i / segX) * W;
      let z = Z0 + (j / segZ) * D;
      const e = edgeFactor(x, z);
      const k = j * nx + i;
      if (e < 1) inside[k] = 1;
      else {
        // pull outside vertices onto the rim so the outline is smooth
        x /= e;
        z /= e;
      }
      pos.set([x, heightAt(x, z), z], k * 3);
      uv.set([(x - X0) / W, 1 - (z - Z0) / D], k * 2);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (inside[a] || inside[b] || inside[c] || inside[d]) idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Rim point at angle th (the outline is degree-1 homogeneous, so one division finds it). */
function rimPoint(th: number): [number, number] {
  const x = Math.cos(th);
  const z = Math.sin(th);
  const e = edgeFactor(x, z);
  return [x / e, z / e];
}

function cliffGeometries() {
  const N = 260;
  const rng = mulberry32(5);
  const rim: Array<[number, number, number]> = [];
  for (let i = 0; i < N; i++) {
    const [x, z] = rimPoint((i / N) * Math.PI * 2);
    rim.push([x, heightAt(x, z), z]);
  }
  // cliffs: rim → jagged bottom
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let u = 0;
  const bottoms: number[] = [];
  for (let i = 0; i <= N; i++) {
    const [x, y, z] = rim[i % N];
    if (i > 0) {
      const [px, , pz] = rim[i - 1];
      u += Math.hypot(x - px, z - pz) * 3;
    }
    const bottom = i < N ? -0.2 - rng() * 0.07 : bottoms[0];
    bottoms.push(bottom);
    pos.push(x, y, z, x * 0.985, bottom, z * 0.985);
    uv.push(u, 1, u, 1 - (y - bottom) * 2.6);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // outward-facing
    }
  }
  const cliffs = new THREE.BufferGeometry();
  cliffs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cliffs.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  cliffs.setIndex(idx);
  cliffs.computeVertexNormals();

  // underside: rings shrinking toward a rocky tip
  const RINGS = 7;
  const up: number[] = [];
  const uuv: number[] = [];
  const uidx: number[] = [];
  for (let r = 0; r <= RINGS; r++) {
    const k = r / RINGS;
    const shrink = Math.pow(1 - k, 0.75) * 0.985;
    for (let i = 0; i <= N; i++) {
      const [x, , z] = rim[i % N];
      const wob = r === 0 || r === RINGS ? 1 : 0.9 + 0.2 * noise.noise2(i * 0.15, r * 1.3);
      const y = r === 0 ? bottoms[i] : -0.24 - k * 0.78 + 0.05 * noise.noise2(i * 0.2, r);
      up.push(x * shrink * wob, y, z * shrink * wob);
      uuv.push((i / N) * 24, 1 - k * 3);
      if (r > 0 && i > 0) {
        const a = (r - 1) * (N + 1) + i - 1;
        const b = a + 1;
        const c = a + N + 1;
        const d = c + 1;
        uidx.push(a, b, c, b, d, c); // outward-facing
      }
    }
  }
  const underside = new THREE.BufferGeometry();
  underside.setAttribute('position', new THREE.Float32BufferAttribute(up, 3));
  underside.setAttribute('uv', new THREE.Float32BufferAttribute(uuv, 2));
  underside.setIndex(uidx);
  underside.computeVertexNormals();
  return { cliffs, underside };
}

function seaMesh(mat: THREE.Material) {
  const g = new THREE.PlaneGeometry(W, D, 140, Math.round((140 * D) / W));
  g.rotateX(-Math.PI / 2);
  g.translate(0, SEA_Y, 0);
  const p = g.attributes.position;
  const keep: number[] = [];
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    let ok = true;
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(i + k);
      const x = p.getX(v);
      const z = p.getZ(v);
      if (edgeFactor(x, z) > 0.985 || z < coastZ(x) - 0.04) ok = false;
    }
    if (ok) keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
  }
  g.setIndex(keep);
  const m = new THREE.Mesh(g, mat);
  m.name = 'mar';
  return m;
}

function riverMesh(mat: THREE.Material, pts2: readonly P2[], width: number, top: number, bottom: number, name: string) {
  const curve = new THREE.SplineCurve(pts2.map(([x, z]) => new THREE.Vector2(x, z)));
  const N = 90;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = curve.getPoint(t);
    const tg = curve.getTangent(t);
    const nx = -tg.y;
    const nz = tg.x;
    const w = width * 1.3;
    const y = lerp(top, bottom, t);
    pos.push(p.x + nx * w, y, p.y + nz * w, p.x - nx * w, y, p.y - nz * w);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  return m;
}

function diskMesh(x: number, z: number, r: number, y: number, mat: THREE.Material, name: string) {
  const g = new THREE.CircleGeometry(r, 40);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.name = name;
  return m;
}

function waterfallMesh(mat: THREE.Material) {
  const top = LAKE.y - 0.008;
  const len = Math.hypot(WATERFALL.bottom - WATERFALL.top, top);
  const g = new THREE.PlaneGeometry(0.075, len, 1, 8);
  const m = new THREE.Mesh(g, mat);
  m.position.set(WATERFALL.x, top / 2 - 0.005, (WATERFALL.top + WATERFALL.bottom) / 2 + 0.01);
  m.rotation.x = -Math.atan2(WATERFALL.bottom - WATERFALL.top, top);
  m.name = 'cachoeira';
  return m;
}

// ------------------------------------------------------------------ the painted ground map
type Kind = 'grass' | 'meadow' | 'forest' | 'rock' | 'snow' | 'sand' | 'desert' | 'yard' | 'bed';

function classify(x: number, z: number, h: number, slope: number): Kind {
  const r = nearestRiver(x, z);
  const water = seaFactor(x, z) > 0.4 || r.d < r.w * 1.05 || Math.hypot(x - POND.x, z - POND.z) < POND.r || FOREST_PONDS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r) || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r;
  if (water) return 'bed';
  if (h > 0.3) return 'snow';
  if (h > 0.1 || slope > 1.4) return 'rock';
  if (inRect(x, z, DESERT, 0.03)) return 'desert';
  const toCoast = coastZ(x) - z;
  if (toCoast < 0.05 || (x > BEACH[0] && x < BEACH[1] && toCoast < 0.13)) return 'sand';
  if (inRect(x, z, FOREST_WEST) || inRect(x, z, FOREST_SOUTH) || inRect(x, z, FOREST_EAST) || inRect(x, z, FOREST_NORTH)) return 'forest';
  if (inRect(x, z, FARM)) {
    const border = Math.min(x - FARM[0], FARM[1] - x, z - FARM[2], FARM[3] - z);
    return border > 0.03 + 0.03 * noise.noise2(x * 14, z * 14) ? 'yard' : 'meadow';
  }
  // sandy rims around the forest ponds
  if (FOREST_PONDS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.025 + 0.01 * noise.noise2(x * 30, z * 30))) return 'yard';
  return 'grass';
}

function paintGroundMap(size: number) {
  const pw = size;
  const ph = Math.round((size * D) / W);
  const ppu = pw / W; // pixels per island unit
  const { c, ctx } = (() => {
    const cc = document.createElement('canvas');
    cc.width = pw;
    cc.height = ph;
    return { c: cc, ctx: cc.getContext('2d')! };
  })();
  const toPx = (x: number, z: number): [number, number] => [(x - X0) * ppu, (z - Z0) * ppu];

  // 1) per-pixel base colours at half resolution
  const lw = Math.round(pw / 2);
  const lh = Math.round(ph / 2);
  const low = document.createElement('canvas');
  low.width = lw;
  low.height = lh;
  const lctx = low.getContext('2d')!;
  const img = lctx.createImageData(lw, lh);
  const C: Record<Kind, [THREE.Color, THREE.Color]> = {
    grass: [new THREE.Color('#5ea53f'), new THREE.Color('#7fbf4c')],
    meadow: [new THREE.Color('#78bb4a'), new THREE.Color('#93cc5a')],
    forest: [new THREE.Color('#3f7f34'), new THREE.Color('#5a9a3c')],
    rock: [new THREE.Color('#8a7864'), new THREE.Color('#a8957a')],
    snow: [new THREE.Color('#e8eef6'), new THREE.Color('#ffffff')],
    sand: [new THREE.Color('#e3c98c'), new THREE.Color('#f0dca6')],
    desert: [new THREE.Color('#e8b85e'), new THREE.Color('#f2cf7c')],
    yard: [new THREE.Color('#d9a04a'), new THREE.Color('#e8b45c')],
    bed: [new THREE.Color('#5d7f6a'), new THREE.Color('#7a9a7a')],
  };
  const tmp = new THREE.Color();
  const kinds: Kind[] = new Array(lw * lh);
  const step = W / lw;
  const H = new Float32Array(lw * lh);
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) H[j * lw + i] = heightAt(X0 + (i + 0.5) * step, Z0 + (j + 0.5) * step);
  const hAt = (i: number, j: number) => H[Math.min(lh - 1, Math.max(0, j)) * lw + Math.min(lw - 1, Math.max(0, i))];
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      const x = X0 + (i + 0.5) * step;
      const z = Z0 + (j + 0.5) * step;
      const h = H[j * lw + i];
      const sx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * step);
      const sz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * step);
      const slope = Math.hypot(sx, sz);
      const k = classify(x, z, h, slope);
      kinds[j * lw + i] = k;
      const n = 0.5 + 0.5 * noise.fbm2(x * 7, z * 7, 3);
      const [a, b] = C[k];
      tmp.copy(a).lerp(b, clamp(n * 1.2 - 0.1));
      // painted shading from the slope direction (light from the north-west)
      if (k === 'rock' || k === 'snow' || k === 'grass' || k === 'forest') tmp.multiplyScalar(clamp(1 + (-sx - sz) * 0.18, 0.7, 1.25));
      // wet sand next to the water
      if (k === 'sand') tmp.lerp(C.bed[1], smoothstep(0.25, 0.4, seaFactor(x, z)) * 0.5);
      const o = (j * lw + i) * 4;
      img.data[o] = tmp.r * 255;
      img.data[o + 1] = tmp.g * 255;
      img.data[o + 2] = tmp.b * 255;
      img.data[o + 3] = 255;
    }
  }
  // the canvas works in sRGB: convert from three's linear working colours
  for (let o = 0; o < img.data.length; o += 4) {
    for (let k = 0; k < 3; k++) {
      const v = img.data[o + k] / 255;
      img.data[o + k] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    }
  }
  lctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(low, 0, 0, pw, ph);

  // 2) brush strokes over grass and meadows (the painted grain)
  const rng = mulberry32(9);
  const kindAt = (px: number, py: number) => kinds[Math.min(lh - 1, Math.floor(py / 2)) * lw + Math.min(lw - 1, Math.floor(px / 2))];
  for (let i = 0; i < 26000 * (size / 2048) ** 2; i++) {
    const px = rng() * pw;
    const py = rng() * ph;
    const k = kindAt(px, py);
    if (k === 'bed' || k === 'snow') continue;
    const pal =
      k === 'sand' || k === 'desert' ? ['#f6e6b8', '#d9a95a'] : k === 'yard' ? ['#f0c272', '#c98a3a', '#e8b45c'] : k === 'rock' ? ['#b5a28a', '#6e5e50', '#8a7a6a'] : k === 'forest' ? ['#2f6a2c', '#4f8f3a', '#6aa84a'] : ['#4f9a3a', '#8fcf5a', '#a7d96a', '#5fa543'];
    ctx.globalAlpha = 0.3 + rng() * 0.3;
    ctx.strokeStyle = pal[Math.floor(rng() * pal.length)];
    ctx.lineWidth = 1 + rng() * 2.2;
    ctx.beginPath();
    const len = 3 + rng() * 7;
    const a = -Math.PI / 2 + (rng() - 0.5) * 1.2;
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 3) farm yard, pen and orchard ground
  const rectPx = (r: readonly [number, number, number, number], pad = 0) => {
    const [x0, y0] = toPx(r[0] - pad, r[2] - pad);
    const [x1, y1] = toPx(r[1] + pad, r[3] + pad);
    return [x0, y0, x1 - x0, y1 - y0] as const;
  };
  ctx.fillStyle = 'rgba(205,165,104,0.85)';
  {
    const [x, y] = toPx(HOUSE.x, HOUSE.z + 0.06);
    ctx.beginPath();
    ctx.ellipse(x, y, 0.2 * ppu, 0.16 * ppu, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(196,158,98,0.8)';
  {
    const [x, y, w, h] = rectPx(PEN, 0.01);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 0.03 * ppu);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(70,120,50,0.25)';
  {
    const [x, y, w, h] = rectPx(ORCHARD);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 0.05 * ppu);
    ctx.fill();
  }

  // 4) dirt paths: darker rim, lighter middle, pebbles
  const drawPath = (pts: ReadonlyArray<readonly [number, number]>, width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * ppu;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([x, z], i) => {
      const [px, py] = toPx(x, z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };
  for (const t of FOREST_TRAILS) drawPath(t, 0.07, '#c9913f');
  for (const t of FOREST_TRAILS) drawPath(t, 0.05, '#e2ae58');
  drawPath(DESERT_ROAD, 0.05, '#6e6a64');
  drawPath(DESERT_ROAD, 0.04, '#8c877e');
  for (const p of PATHS) drawPath(p, 0.062, '#a9814f');
  for (const p of PATHS) drawPath(p, 0.048, '#d2aa6e');
  for (const p of PATHS) {
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L * 140; s++) {
        const t = rng();
        const [px, py] = toPx(lerp(ax, bx, t) + (rng() - 0.5) * 0.04, lerp(az, bz, t) + (rng() - 0.5) * 0.04);
        ctx.fillStyle = rng() < 0.5 ? '#e6c48a' : '#9a7448';
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.ellipse(px, py, 1.5 + rng() * 2, 1 + rng() * 1.5, rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // 5) cobbled plaza
  {
    const [cx, cy] = toPx(PLAZA.x, PLAZA.z);
    const R = PLAZA.r * ppu;
    ctx.fillStyle = '#9a8f7e';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
    ctx.clip();
    const s = 0.016 * ppu;
    for (let y = cy - R; y < cy + R; y += s) {
      for (let x = cx - R + ((Math.round((y - cy) / s) % 2) * s) / 2; x < cx + R; x += s) {
        const k = 0.85 + rng() * 0.3;
        ctx.fillStyle = `rgb(${190 * k},${180 * k},${160 * k})`;
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, s - 2, s - 2, s * 0.3);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.strokeStyle = '#7a6e5e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 6) tilled fields with furrows
  for (const r of Object.values(FIELDS)) {
    const [x, y, w, h] = rectPx(r, 0.008);
    ctx.fillStyle = '#5e3a22';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 0.012 * ppu);
    ctx.fill();
    for (let fy = y + 3; fy < y + h - 2; fy += 0.022 * ppu) {
      ctx.fillStyle = '#7d5232';
      ctx.fillRect(x + 4, fy, w - 8, 0.012 * ppu);
    }
  }

  // 7) wildflower specks in meadows and grass
  const flowers = ['#ffffff', '#ffe14d', '#ff8ab6', '#b48cff', '#ff6a4a'];
  for (let i = 0; i < 5000 * (size / 2048) ** 2; i++) {
    const px = rng() * pw;
    const py = rng() * ph;
    const k = kindAt(px, py);
    if (k !== 'grass' && k !== 'meadow') continue;
    ctx.fillStyle = flowers[Math.floor(rng() * flowers.length)];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(px, py, 1.4 + rng() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toTexture(c, false);
}
