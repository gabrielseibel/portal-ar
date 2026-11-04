import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clockTexture, doorTexture, plasterTexture, roofTexture, signTexture, stoneTexture, windowGlowTexture, windowTexture, woodTexture } from './paint';
import type { BuildingSpec } from './layout';
import { shared } from '../../systems/SharedUniforms';

const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** World units covered by one texture repeat. */
const TEX = 0.1;

/**
 * Collects transformed geometries per material and merges them, so a whole
 * town of painted buildings costs one draw call per material.
 */
export class Batcher {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  readonly frame = new THREE.Matrix4();

  /** Sets the local frame (position + yaw) for the next adds. */
  at(x: number, y: number, z: number, yaw = 0) {
    this.frame.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    return this;
  }

  add(geo: THREE.BufferGeometry, mat: THREE.Material, local?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = local ? this.frame.clone().multiply(local) : this.frame;
    g = g.applyMatrix4(m);
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
  }

  /** Box sitting on y (bottom centre at x, y, z in the current frame), UVs tiled in world units. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, rotX = 0, rotY = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0)), new THREE.Vector3(1, 1, 1));
    this.add(tiledBox(w, h, d), mat, m);
  }

  build(name: string, shadows: boolean) {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((x) => x.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows && !(mat as THREE.MeshStandardMaterial).transparent;
      mesh.receiveShadow = shadows;
      g.add(mesh);
    }
    this.parts.clear();
    return g;
  }
}

/** BoxGeometry whose UVs repeat every TEX units on every face. */
export function tiledBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: Array<[number, number]> = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / TEX, (uv.getY(i) * dims[f][1]) / TEX);
  }
  return g;
}

function gableTriangles(w: number, d: number, h: number) {
  // two triangles closing the roof at x = ±w/2 (ridge along X)
  const p: number[] = [];
  const uv: number[] = [];
  for (const s of [-1, 1]) {
    const x = (s * w) / 2;
    const tri = s > 0 ? [[x, 0, d / 2], [x, 0, -d / 2], [x, h, 0]] : [[x, 0, -d / 2], [x, 0, d / 2], [x, h, 0]];
    for (const [a, b, c] of tri) {
      p.push(a, b, c);
      uv.push((c + d / 2) / TEX, b / TEX);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ shared materials
export interface Mats {
  wall: Record<BuildingSpec['wall'], THREE.MeshStandardMaterial>;
  roof: (color: string) => THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  door: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  clock: THREE.MeshStandardMaterial;
  sign: (text: string) => THREE.MeshStandardMaterial;
  /** Plain painted colour (trims, posts). */
  paint: (color: string) => THREE.MeshStandardMaterial;
  all: () => THREE.Material[];
}

export function createMats(): Mats {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  const roofs = new Map<string, THREE.MeshStandardMaterial>();
  const signs = new Map<string, THREE.MeshStandardMaterial>();
  const paints = new Map<string, THREE.MeshStandardMaterial>();
  const m: Mats = {
    wall: {
      wood: std({ map: woodTexture('#c98a4a') }),
      plaster: std({ map: plasterTexture('#f1e4c8') }),
      stone: std({ map: stoneTexture('#a39a8a') }),
      red: std({ map: woodTexture('#b8503a') }),
      blue: std({ map: woodTexture('#5a86b8') }),
      green: std({ map: woodTexture('#8aa08a') }),
    },
    roof: (c) => {
      let r = roofs.get(c);
      if (!r) roofs.set(c, (r = std({ map: roofTexture(c) })));
      return r;
    },
    stone: std({ map: stoneTexture('#8f8a80') }),
    wood: std({ map: woodTexture('#b07a44') }),
    darkWood: std({ map: woodTexture('#7a4f2c') }),
    door: std({ map: doorTexture() }),
    window: std({ map: windowTexture(), emissiveMap: windowGlowTexture(), emissive: new THREE.Color('#ffcf7e'), emissiveIntensity: 0 }),
    glass: std({ color: '#cfefff', transparent: true, opacity: 0.38, roughness: 0.1, depthWrite: false }),
    white: std({ color: '#f4f1e8' }),
    clock: std({ map: clockTexture() }),
    sign: (t) => {
      let s = signs.get(t);
      if (!s) signs.set(t, (s = std({ map: signTexture(t) })));
      return s;
    },
    paint: (c) => {
      let p = paints.get(c);
      if (!p) paints.set(c, (p = std({ color: c })));
      return p;
    },
    all: () => [...Object.values(m.wall), ...roofs.values(), ...signs.values(), ...paints.values(), m.stone, m.wood, m.darkWood, m.door, m.window, m.glass, m.white, m.clock],
  };
  return m;
}

const plane = (w: number, h: number) => new THREE.PlaneGeometry(w, h);
const T = (x: number, y: number, z: number, ry = 0, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));

/** Gable-roofed building (ridge along local X, front door on +Z). Returns the chimney top (local), if any. */
export function building(
  b: Batcher,
  o: { w: number; d: number; h: number; wall: THREE.Material; roof: THREE.Material; mats: Mats; roofH?: number; door?: boolean; windows?: number; chimney?: boolean; sign?: string; bigDoor?: boolean },
) {
  const { w, d, h, mats } = o;
  const rh = o.roofH ?? d * 0.42;
  const ov = 0.014;
  b.box(0, 0, 0, w + 0.012, 0.012, d + 0.012, mats.stone);
  b.box(0, 0.012, 0, w, h - 0.012, d, o.wall);
  b.add(gableTriangles(w, d, rh), o.wall, T(0, h, 0));
  // roof slopes (thin boxes) + ridge
  const sl = Math.hypot(d / 2 + ov, rh + ov * 0.6);
  const ang = Math.atan2(rh, d / 2);
  for (const s of [-1, 1]) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(0, h + rh / 2 - 0.002, (s * d) / 4 + s * 0.002),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(s * ang, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    b.add(tiledBox(w + ov * 2, 0.008, sl), o.roof, m);
  }
  b.box(0, h + rh - 0.004, 0, w + ov * 2 + 0.004, 0.01, 0.014, mats.darkWood);
  // front: door, windows, sign
  const fz = d / 2 + 0.0015;
  if (o.door !== false) {
    const dw = o.bigDoor ? Math.min(w * 0.45, 0.07) : 0.028;
    const dh = o.bigDoor ? h * 0.8 : 0.05;
    b.add(plane(dw, dh), mats.door, T(0, 0.012 + dh / 2, fz));
  }
  const nw = o.windows ?? 2;
  for (let i = 0; i < nw; i++) {
    const x = nw === 1 ? w * 0.3 : (i / (nw - 1) - 0.5) * w * 0.62;
    if (Math.abs(x) < 0.03 && o.door !== false) continue;
    b.add(plane(0.03, 0.024), mats.window, T(x, h * 0.6, fz));
  }
  for (const s of [-1, 1]) b.add(plane(0.03, 0.024), mats.window, T((s * w) / 2 + s * 0.0015, h * 0.6, 0, (s * Math.PI) / 2));
  if (o.sign) b.add(plane(0.07, 0.018), mats.sign(o.sign), T(0, h - 0.004, fz + 0.001));
  if (o.chimney) {
    b.box(w * 0.28, h + rh * 0.3, -d * 0.18, 0.022, rh * 0.9, 0.022, mats.stone);
    return new THREE.Vector3(w * 0.28, h + rh * 1.2, -d * 0.18);
  }
  return null;
}

/** A town building from the layout table (+ clock tower for the community centre). */
export function townBuilding(b: Batcher, s: BuildingSpec, mats: Mats, groundY: number) {
  b.at(s.x, groundY, s.z, s.rot);
  const chimney = building(b, { w: s.w, d: s.d, h: s.h, wall: mats.wall[s.wall], roof: mats.roof(s.roof), mats, windows: 3, chimney: s.id !== 'center', sign: s.title.split(' ')[0] });
  if (s.tower) {
    const tw = 0.06;
    b.box(0, s.h, 0, tw, 0.1, tw, mats.stone);
    b.add(new THREE.ConeGeometry(tw * 0.85, 0.06, 4, 1).rotateY(Math.PI / 4), mats.roof(s.roof), T(0, s.h + 0.1 + 0.03, 0));
    b.add(new THREE.CircleGeometry(0.02, 20), mats.clock, T(0, s.h + 0.065, tw / 2 + 0.001));
  }
  return chimney;
}

/** A painted cottage for the townsfolk: porch with posts, steps, chimney (front door on +Z). */
export function cottage(
  b: Batcher,
  mats: Mats,
  o: { w: number; d: number; h: number; wall: THREE.Material; roof: THREE.Material; trim: THREE.Material; porch?: boolean },
) {
  const { w, d, h } = o;
  const top = building(b, { w, d, h, wall: o.wall, roof: o.roof, mats, windows: 2, chimney: true, roofH: d * 0.5 });
  // trims on the corners
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box((sx * w) / 2, 0.012, (sz * d) / 2, 0.006, h - 0.012, 0.006, o.trim);
  if (o.porch !== false) {
    const pd = 0.035;
    b.box(0, 0, d / 2 + pd / 2, w * 0.86, 0.012, pd, mats.wood);
    b.box(0, 0, d / 2 + pd + 0.008, w * 0.3, 0.006, 0.016, mats.wood);
    for (const sx of [-1, 1]) b.box(sx * w * 0.4, 0.012, d / 2 + pd - 0.004, 0.006, h * 0.72, 0.006, o.trim);
    b.box(0, 0.012 + h * 0.72, d / 2 + pd / 2, w * 0.9, 0.006, pd + 0.01, o.roof);
  }
  return top;
}

/** Solid arched footbridge: planks along local Z, rails on both sides. */
export function footbridge(b: Batcher, mats: Mats, len = 0.15, width = 0.05) {
  const n = 9;
  const rise = 0.016;
  const seg = len / n;
  for (let i = 0; i < n; i++) {
    const u0 = i / n - 0.5;
    const u1 = (i + 1) / n - 0.5;
    const y0 = rise * (1 - 4 * u0 * u0);
    const y1 = rise * (1 - 4 * u1 * u1);
    const zc = ((u0 + u1) / 2) * len;
    const tilt = Math.atan2(y1 - y0, seg);
    b.box(0, (y0 + y1) / 2 - 0.003, zc, width, 0.006, seg * 1.04, i % 2 ? mats.wood : mats.darkWood, -tilt);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const u = i / 4 - 0.5;
      b.box((sx * width) / 2, rise * (1 - 4 * u * u), u * len, 0.004, 0.022, 0.004, mats.darkWood);
    }
    for (let i = 0; i < 4; i++) {
      const u0 = i / 4 - 0.5;
      const u1 = (i + 1) / 4 - 0.5;
      const y0 = rise * (1 - 4 * u0 * u0) + 0.02;
      const y1 = rise * (1 - 4 * u1 * u1) + 0.02;
      b.box((sx * width) / 2, (y0 + y1) / 2 - 0.002, ((u0 + u1) / 2) * len, 0.004, 0.004, len / 4 + 0.002, mats.darkWood, -Math.atan2(y1 - y0, len / 4));
    }
  }
}

/** Greenhouse: white frame + translucent glass. */
export function greenhouse(b: Batcher, mats: Mats, w: number, d: number) {
  const h = 0.07;
  const rh = d * 0.45;
  b.box(0, 0, 0, w + 0.01, 0.012, d + 0.01, mats.stone);
  b.add(tiledBox(w, h, d), mats.glass, T(0, 0.012 + h / 2, 0));
  b.add(gableTriangles(w, d, rh), mats.glass, T(0, 0.012 + h, 0));
  const ang = Math.atan2(rh, d / 2);
  const sl = Math.hypot(d / 2, rh);
  for (const s of [-1, 1]) b.add(tiledBox(w, 0.004, sl), mats.glass, new THREE.Matrix4().compose(new THREE.Vector3(0, 0.012 + h + rh / 2, (s * d) / 4), new THREE.Quaternion().setFromEuler(new THREE.Euler(s * ang, 0, 0)), new THREE.Vector3(1, 1, 1)));
  // frame
  const f = 0.006;
  for (const x of [-w / 2, -w / 6, w / 6, w / 2]) {
    for (const z of [-d / 2, d / 2]) b.box(x, 0.012, z, f, h, f, mats.white);
    b.box(x, 0.012 + h - f, 0, f, f, d, mats.white);
  }
  b.box(0, 0.012 + h + rh - f, 0, w, f, f, mats.white);
  b.add(plane(0.03, 0.05), mats.door, T(0, 0.012 + 0.025, d / 2 + 0.002));
}

// ------------------------------------------------------------------ nature (instanced)
/** Soft crown made of three overlapping blobs, shaded darker underneath (vertex colours). */
export function crownGeometry(pine = false) {
  let g: THREE.BufferGeometry;
  if (pine) {
    const parts = [0, 1, 2].map((i) => new THREE.ConeGeometry(0.05 - i * 0.012, 0.06, 7).translate(0, 0.03 + i * 0.03, 0));
    g = mergeGeometries(parts.map(ni))!;
  } else {
    const parts = [
      new THREE.IcosahedronGeometry(0.045, 1).translate(0, 0.04, 0),
      new THREE.IcosahedronGeometry(0.034, 1).translate(0.03, 0.03, 0.01),
      new THREE.IcosahedronGeometry(0.032, 1).translate(-0.026, 0.028, -0.012),
      new THREE.IcosahedronGeometry(0.03, 1).translate(0.004, 0.066, -0.006),
    ];
    g = mergeGeometries(parts.map(ni))!;
  }
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.62 + 0.45 * THREE.MathUtils.clamp(pos.getY(i) / 0.09, 0, 1);
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  s: number;
  kind: 'green' | 'pine' | 'blossom' | 'autumn' | 'apple' | 'orange';
}

const TREE_COLORS: Record<TreeSpot['kind'], string[]> = {
  green: ['#4f9a3a', '#5fae45', '#3f8a34', '#6ab84a'],
  pine: ['#2f6a3a', '#3a7a44', '#2a5e34'],
  blossom: ['#f4a7c9', '#f7bdd6', '#ea8fb8'],
  autumn: ['#f2b233', '#e8902a', '#f7c94b'],
  apple: ['#4f9a3a', '#5aa640'],
  orange: ['#4a9a3a', '#3f8a34'],
};

/** Instanced trees: trunks, crowns (round + pine), fruit. Crowns sway in the vertex shader. */
export function buildTrees(spots: TreeSpot[], shake: THREE.Vector4, shadows: boolean) {
  const g = new THREE.Group();
  g.name = 'arvores';
  const rng = (i: number) => (Math.sin(i * 91.7) * 43758.5453) % 1;
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a4f2c', roughness: 1 });
  const crownMat = sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), shake);
  const fruitMat = sway(new THREE.MeshStandardMaterial({ roughness: 0.5 }), shake);
  const trunkGeo = new THREE.CylinderGeometry(0.006, 0.01, 1, 6).translate(0, 0.5, 0);
  const round = spots.filter((s) => s.kind !== 'pine');
  const pines = spots.filter((s) => s.kind === 'pine');
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeometry(false), crownMat, Math.max(1, round.length));
  const pineCrowns = new THREE.InstancedMesh(crownGeometry(true), crownMat, Math.max(1, pines.length));
  const fruitSpots = round.filter((s) => s.kind === 'apple' || s.kind === 'orange');
  const fruits = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.007, 0), fruitMat, Math.max(1, fruitSpots.length * 7));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    const th = s.kind === 'pine' ? 0.04 : 0.05;
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q.identity(), new THREE.Vector3(s.s, th * s.s, s.s));
    trunks.setMatrixAt(i, m);
  });
  let ri = 0;
  let pi = 0;
  let fi = 0;
  spots.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.39);
    const top = (s.kind === 'pine' ? 0.035 : 0.045) * s.s;
    m.compose(new THREE.Vector3(s.x, s.y + top, s.z), q, new THREE.Vector3(s.s, s.s, s.s));
    const pal = TREE_COLORS[s.kind];
    c.set(pal[Math.abs(Math.floor(rng(i) * 97)) % pal.length]);
    if (s.kind === 'pine') {
      pineCrowns.setMatrixAt(pi, m);
      pineCrowns.setColorAt(pi++, c);
    } else {
      crowns.setMatrixAt(ri, m);
      crowns.setColorAt(ri++, c);
      if (s.kind === 'apple' || s.kind === 'orange') {
        for (let k = 0; k < 7; k++) {
          const a = k * 0.9 + i;
          const y = 0.03 + (k % 3) * 0.018;
          const r = 0.044 - Math.abs(y - 0.045) * 0.4;
          m.compose(new THREE.Vector3(s.x + Math.cos(a) * r * s.s, s.y + top + y * s.s, s.z + Math.sin(a) * r * s.s), q.identity(), new THREE.Vector3(s.s, s.s, s.s));
          fruits.setMatrixAt(fi, m);
          fruits.setColorAt(fi++, c.set(s.kind === 'apple' ? '#e5383b' : '#ff9b2f'));
        }
      }
    }
  });
  crowns.count = ri;
  pineCrowns.count = pi;
  fruits.count = fi;
  for (const im of [trunks, crowns, pineCrowns, fruits]) {
    im.castShadow = shadows;
    im.receiveShadow = shadows;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return { group: g, materials: [trunkMat, crownMat, fruitMat] };
}

/** Wind sway + tap shake for instanced foliage (offset grows with height inside the instance). */
export function sway<T extends THREE.MeshStandardMaterial>(mat: T, shake: THREE.Vector4) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uShake = { value: shake };
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uShake;\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float hk = smoothstep(0.0, 0.09, transformed.y);
      float w = sin(uTime * 1.5 + ip.x * 13.0 + ip.z * 9.0) * 0.5 + sin(uTime * 2.6 + ip.x * 21.0) * 0.25;
      float sk = uShake.z * smoothstep(uShake.w, 0.0, distance(ip.xz, uShake.xy));
      transformed.x += (w * 0.0035 + sk * sin(uTime * 34.0) * 0.008) * hk;
      transformed.z += (w * 0.0025 + sk * cos(uTime * 29.0) * 0.006) * hk;`,
    );
    mat.userData.shader = sh;
  };
  mat.customProgramCacheKey = () => 'duda-sway';
  return mat;
}

/** Simple instanced mesh from a list of [x, y, z, scale, rotY, color]. */
export function scatter(geo: THREE.BufferGeometry, mat: THREE.Material, items: Array<[number, number, number, number, number, string]>, shadows = false) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  items.forEach(([x, y, z, s, ry, col], i) => {
    m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
    im.setMatrixAt(i, m);
    im.setColorAt(i, c.set(col));
  });
  im.count = items.length;
  im.castShadow = shadows;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

/** Crop plant geometry (leaves + fruit), vertex-coloured per kind. */
export function cropGeometry(kind: string) {
  const parts: THREE.BufferGeometry[] = [];
  const color = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return ni(g);
  };
  const leaf = (x: number, z: number, s: number, hex = '#4fae3f') => color(new THREE.IcosahedronGeometry(0.011 * s, 0).scale(1, 0.7, 1).translate(x, 0.009 * s, z), hex);
  if (kind === 'pumpkin') {
    parts.push(leaf(-0.008, 0, 1.1), leaf(0.008, 0.004, 1), color(new THREE.SphereGeometry(0.011, 10, 8).scale(1.2, 0.85, 1.2).translate(0, 0.01, -0.006), '#f08a24'));
  } else if (kind === 'cauli') {
    parts.push(leaf(0, 0, 1.4, '#5fa84a'), color(new THREE.SphereGeometry(0.009, 10, 8).translate(0, 0.016, 0), '#f5f0d8'));
  } else if (kind === 'tomato' || kind === 'strawberry' || kind === 'blueberry') {
    const fruit = kind === 'tomato' ? '#e8463a' : kind === 'strawberry' ? '#ff4f6d' : '#4f6fe0';
    parts.push(color(new THREE.CylinderGeometry(0.0015, 0.0015, 0.03, 4).translate(0, 0.015, 0), '#8a6a3a'));
    parts.push(leaf(0, 0, 1.1, '#3f9a35'), color(new THREE.IcosahedronGeometry(0.01, 0).translate(0, 0.024, 0), '#4fae3f'));
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      parts.push(color(new THREE.SphereGeometry(kind === 'blueberry' ? 0.0042 : 0.0055, 6, 5).translate(Math.cos(a) * 0.009, 0.012 + (i % 2) * 0.012, Math.sin(a) * 0.009), fruit));
    }
  } else {
    parts.push(leaf(0, 0, 1));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ characters (painted, smooth)
export interface PersonStyle {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  hat?: string;
  longHair?: boolean;
}

type Part = [THREE.BufferGeometry, string, number, number, number];

/** Merges coloured primitives into one vertex-coloured geometry (one draw call). */
export function paintedGeometry(parts: Part[]) {
  const geos = parts.map(([geo, hex, x, y, z]) => {
    const g = ni(geo.clone().translate(x, y, z));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  return merged;
}

let paintedMat: THREE.MeshStandardMaterial | null = null;
/** Shared material for characters, animals and small props (colours live in the vertices). */
export function characterMaterial() {
  return (paintedMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
}

/** One mesh from coloured primitives. */
export function blob(parts: Part[]) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(paintedGeometry(parts), characterMaterial());
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/** A smooth, chunky villager with animatable limbs: six draw calls per person. */
export class PaintedPerson {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  readonly hitProxy: THREE.Mesh;
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();

  constructor(st: PersonStyle) {
    this.root.add(this.body);
    const limb = (pivot: THREE.Group, x: number, y: number, hex: string, len: number, r: number, hand?: string) => {
      pivot.position.set(x, y, 0);
      const parts: Part[] = [[new THREE.CapsuleGeometry(r, len, 3, 8), hex, 0, -len / 2 - r * 0.2, 0]];
      if (hand) parts.push([new THREE.SphereGeometry(0.0034, 8, 6), hand, 0, -len - r * 0.6, 0]);
      pivot.add(blob(parts));
    };
    limb(this.legL, -0.0055, 0.022, st.pants, 0.014, 0.004);
    limb(this.legR, 0.0055, 0.022, st.pants, 0.014, 0.004);
    limb(this.armL, -0.012, 0.042, st.shirt, 0.012, 0.0032, st.skin);
    limb(this.armR, 0.012, 0.042, st.shirt, 0.012, 0.0032, st.skin);
    this.body.add(this.legL, this.legR, this.armL, this.armR, blob([[new THREE.CapsuleGeometry(0.0095, 0.012, 4, 10), st.shirt, 0, 0.033, 0]]));
    const headParts: Part[] = [
      [new THREE.SphereGeometry(0.0105, 14, 12), st.skin, 0, 0, 0],
      [new THREE.SphereGeometry(0.0112, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), st.hair, 0, 0.001, -0.001],
      [new THREE.SphereGeometry(0.0016, 6, 5), '#2a1c14', -0.0038, 0.001, 0.0098],
      [new THREE.SphereGeometry(0.0016, 6, 5), '#2a1c14', 0.0038, 0.001, 0.0098],
      [new THREE.SphereGeometry(0.0022, 6, 5), '#ff9a8a', 0.0062, -0.002, 0.008],
      [new THREE.SphereGeometry(0.0022, 6, 5), '#ff9a8a', -0.0062, -0.002, 0.008],
    ];
    if (st.longHair) headParts.push([new THREE.CapsuleGeometry(0.0075, 0.012, 3, 8), st.hair, 0, -0.008, -0.006]);
    if (st.hat) {
      headParts.push(
        [new THREE.CylinderGeometry(0.019, 0.019, 0.002, 18), st.hat, 0, 0.007, 0],
        [new THREE.CylinderGeometry(0.008, 0.0105, 0.009, 14), st.hat, 0, 0.012, 0],
        [new THREE.CylinderGeometry(0.0106, 0.0106, 0.0022, 14), '#d9534f', 0, 0.009, 0],
      );
    }
    this.head.position.set(0, 0.058, 0);
    this.head.add(blob(headParts));
    this.body.add(this.head);
    this.hitProxy = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.085, 0.05), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.y = 0.035;
    this.root.add(this.hitProxy);
  }

  walk(phase: number, amount: number) {
    const a = Math.sin(phase) * 0.7 * amount;
    this.legL.rotation.x = a;
    this.legR.rotation.x = -a;
    this.armL.rotation.x = -a * 0.8;
    this.armR.rotation.x = a * 0.8;
    this.body.position.y = Math.abs(Math.cos(phase)) * 0.002 * amount;
  }

  raiseArm(k: number, right = true) {
    (right ? this.armR : this.armL).rotation.x = -k * 2.4;
  }
}

export const sphere = (r: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 12, 10).scale(sx, sy, sz);
export const cone = (r: number, h: number, rx = 0) => new THREE.ConeGeometry(r, h, 8).rotateX(rx);
export { T as localMatrix };
