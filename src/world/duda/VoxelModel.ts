import * as THREE from 'three';
import { FIELDS, NX, NY, NZ, S, GROUND_Z, inRect, type FieldKind } from './layout';

/**
 * Runtime side of the farm model: `fazenda.bin` is the voxelised + recoloured
 * version of the farm FBX (see tools/fazenda-da-duda/). One byte per voxel,
 * run-length encoded as (count, value) pairs, x fastest, then y, then z:
 *   value & 63 → palette index (0 = empty), value >> 6 → part.
 */
export const Part = { Static: 0, Foliage: 1, Crop: 2, Building: 3 } as const;

export interface FarmModelData {
  vox: Uint8Array;
  palette: THREE.Color[];
  /** Palette index of the greenhouse glass (rendered translucent). */
  glass: number;
  trees: Array<{ x: number; y: number; z: number; top: number; kind: string; n: number }>;
}

export function decodeRLE(rle: Uint8Array, total: number) {
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i + 1 < rle.length && o < total; i += 2) {
    const n = rle[i];
    const v = rle[i + 1];
    if (v) out.fill(v, o, Math.min(total, o + n));
    o += n;
  }
  return out;
}

export async function loadFarmModel(base: string): Promise<FarmModelData> {
  const [bin, meta] = await Promise.all([
    fetch(`${base}models/fazenda-da-duda/fazenda.bin`).then((r) => {
      if (!r.ok) throw new Error(`fazenda.bin ${r.status}`);
      return r.arrayBuffer();
    }),
    fetch(`${base}models/fazenda-da-duda/fazenda.json`).then((r) => {
      if (!r.ok) throw new Error(`fazenda.json ${r.status}`);
      return r.json() as Promise<{ dims: number[]; palette: string[]; glass: number; trees: FarmModelData['trees'] }>;
    }),
  ]);
  const [nx, ny, nz] = meta.dims;
  if (nx !== NX || ny !== NY || nz !== NZ) throw new Error('fazenda: dimensões inesperadas');
  return { vox: decodeRLE(new Uint8Array(bin), NX * NY * NZ), palette: meta.palette.map((h) => new THREE.Color(h)), glass: meta.glass, trees: meta.trees };
}

// face table: normal, 4 corners (unit cube), each quad wound counter-clockwise seen from outside
const FACES: Array<{ d: [number, number, number]; c: Array<[number, number, number]> }> = [
  { d: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { d: [-1, 0, 0], c: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]] },
  { d: [0, 1, 0], c: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], c: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
];

const hash3 = (x: number, y: number, z: number) => {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  rnd: number[] = [];
  idx: number[] = [];
  quad(x: number, y: number, z: number, f: (typeof FACES)[number], c: THREE.Color, k: number, r: number) {
    const b = this.pos.length / 3;
    // voxel (x, y, z) z-up → island-local (X right, Y up, Z toward the viewer)
    for (const [cx, cy, cz] of f.c) {
      this.pos.push((x + cx - NX / 2) * S, (z + cz - GROUND_Z) * S, (NY / 2 - (y + cy)) * S);
      this.nrm.push(f.d[0], f.d[2], -f.d[1]);
      this.col.push(c.r * k, c.g * k, c.b * k);
      this.rnd.push(r);
    }
    // (x, y, z) → (X, Y, Z) = (x, z, −y) is a rotation, so the winding is kept
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  build(withRand = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (withRand) g.setAttribute('aRand', new THREE.Float32BufferAttribute(this.rnd, 1));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface FarmGeometries {
  scenery: THREE.BufferGeometry;
  foliage: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  crops: Map<FieldKind, THREE.BufferGeometry>;
}

/**
 * Builds the visible faces of the voxel farm, split by behaviour: static
 * scenery, swaying foliage, and one geometry per crop field (they grow and
 * get harvested). Faces hidden by a static neighbour are culled; faces under
 * foliage or crops are kept, so nothing opens up when those move.
 */
export function buildFarmGeometries(d: FarmModelData): FarmGeometries {
  const { vox, palette } = d;
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ ? 0 : vox[x + NX * (y + NY * z)]);
  const scenery = new GeoBuilder();
  const foliage = new GeoBuilder();
  const glass = new GeoBuilder();
  const crops = new Map<FieldKind, GeoBuilder>();
  const fieldOf = (x: number, y: number) => (Object.keys(FIELDS) as FieldKind[]).find((k) => inRect(x, y, FIELDS[k])) ?? 'tomato';
  const col = new THREE.Color();

  for (let z = 0; z < NZ; z++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const v = vox[x + NX * (y + NY * z)];
        if (!v) continue;
        const part = v >> 6;
        const base = palette[(v & 63) - 1];
        if (!base) continue;
        const jit = 0.9 + hash3(x, y, z) * 0.18;
        const isGlass = (v & 63) === d.glass;
        let target = isGlass ? glass : scenery;
        if (part === Part.Foliage) target = foliage;
        else if (part === Part.Crop) {
          const k = fieldOf(x, y);
          if (!crops.has(k)) crops.set(k, new GeoBuilder());
          target = crops.get(k)!;
        }
        const solidStatic = part === Part.Static || part === Part.Building;
        for (const f of FACES) {
          // the board's underside is covered by the floating island
          if (z === 0 && f.d[2] === -1) continue;
          const n = at(x + f.d[0], y + f.d[1], z + f.d[2]);
          if (n) {
            const np = n >> 6;
            const nStatic = np === Part.Static || np === Part.Building;
            const nGlass = (n & 63) === d.glass;
            // glass only hides glass (so the frames and the plants inside stay visible)
            if (isGlass ? nGlass : !nGlass && (solidStatic ? nStatic : nStatic || np === part)) continue;
          }
          // a hint of baked light: tops brighter, undersides darker
          const shade = f.d[2] === 1 ? 1.04 : f.d[2] === -1 ? 0.72 : 0.94;
          col.copy(base);
          target.quad(x, y, z, f, col, jit * shade, hash3(x >> 1, y >> 1, 7));
        }
      }
    }
  }
  const cropGeos = new Map<FieldKind, THREE.BufferGeometry>();
  for (const [k, b] of crops) cropGeos.set(k, b.build(true));
  return { scenery: scenery.build(), foliage: foliage.build(), glass: glass.build(), crops: cropGeos };
}
