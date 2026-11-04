import * as THREE from 'three';
import { characterMaterial, paintedGeometry } from './kit';

type Part = [THREE.BufferGeometry, string, number, number, number];

export interface Look {
  skin: string;
  hair: string;
  hairStyle?: 'short' | 'long' | 'bun' | 'spiky' | 'bob' | 'curly' | 'ponytail' | 'bald' | 'braid';
  shirt: string;
  pants: string;
  /** Skirt / dress colour (replaces the trousers). */
  dress?: string;
  beard?: string;
  mustache?: string;
  glasses?: boolean;
  hat?: { kind: 'cap' | 'wide' | 'straw' | 'wizard' | 'bow'; color: string };
  child?: boolean;
  big?: boolean;
  /** Characters that are not regular people. */
  special?: 'shadow' | 'dwarf' | 'robe' | 'wheelchair';
}

const sph = (r: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 12, 9).scale(sx, sy, sz);
const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 3, 8);
const cyl = (r0: number, r1: number, h: number, n = 12) => new THREE.CylinderGeometry(r0, r1, h, n);

/** A whole villager as one vertex-coloured geometry (feet at y 0, facing +Z). Returns the head height too. */
export function personGeometry(l: Look): { geo: THREE.BufferGeometry; head: number } {
  const p: Part[] = [];
  if (l.special === 'shadow') {
    p.push([sph(0.016, 1, 1.5, 1), '#120c1e', 0, 0.026, 0], [sph(0.0026), '#ffffff', -0.005, 0.034, 0.014], [sph(0.0026), '#ffffff', 0.005, 0.034, 0.014], [new THREE.ConeGeometry(0.002, 0.008, 5), '#120c1e', 0, 0.05, 0]);
    return { geo: paintedGeometry(p), head: 0.034 };
  }
  if (l.special === 'dwarf') {
    p.push([cyl(0.009, 0.013, 0.026), '#5a4030', 0, 0.013, 0], [sph(0.011), '#4a3426', 0, 0.033, 0], [sph(0.0075, 1, 1, 0.5), '#0e0a08', 0, 0.032, 0.006], [sph(0.0017), '#ffd84a', -0.003, 0.033, 0.0095], [sph(0.0017), '#ffd84a', 0.003, 0.033, 0.0095]);
    return { geo: paintedGeometry(p), head: 0.033 };
  }
  const k = l.child ? 0.72 : 1;
  const w = l.big ? 1.25 : 1;
  const legH = 0.022 * k;
  const torsoY = legH + 0.011 * k;
  // legs / dress / robe / wheelchair
  if (l.special === 'robe') {
    p.push([cyl(0.009 * w, 0.015, 0.045 * k), l.shirt, 0, 0.0225 * k, 0]);
  } else if (l.special === 'wheelchair') {
    p.push(
      [cyl(0.011, 0.011, 0.003, 14).rotateZ(Math.PI / 2), '#6a6a72', -0.011, 0.011, 0],
      [cyl(0.011, 0.011, 0.003, 14).rotateZ(Math.PI / 2), '#6a6a72', 0.011, 0.011, 0],
      [new THREE.BoxGeometry(0.02, 0.003, 0.016), '#4a4a52', 0, 0.016, 0.002],
      [new THREE.BoxGeometry(0.02, 0.016, 0.003), '#4a4a52', 0, 0.024, -0.007],
      [cap(0.0035, 0.01).rotateX(Math.PI / 2), l.pants, -0.0045, 0.019, 0.008],
      [cap(0.0035, 0.01).rotateX(Math.PI / 2), l.pants, 0.0045, 0.019, 0.008],
    );
  } else if (l.dress) {
    p.push([cyl(0.0075 * w, 0.0115 * w, legH * 0.85), l.dress, 0, legH * 0.62, 0], [cap(0.0028, legH * 0.25), l.skin, -0.004, legH * 0.18, 0], [cap(0.0028, legH * 0.25), l.skin, 0.004, legH * 0.18, 0]);
  } else {
    p.push([cap(0.0038 * k * w, legH * 0.6), l.pants, -0.0045 * k * w, legH * 0.5, 0], [cap(0.0038 * k * w, legH * 0.6), l.pants, 0.0045 * k * w, legH * 0.5, 0]);
  }
  const sitting = l.special === 'wheelchair';
  const ty = sitting ? 0.03 : torsoY;
  // torso + arms + hands
  p.push([cap(0.0092 * k * w, 0.011 * k), l.shirt, 0, ty, 0]);
  for (const s of [-1, 1]) {
    p.push([cap(0.003 * k, 0.012 * k).rotateZ(s * 0.18), l.shirt, s * 0.0115 * k * w, ty - 0.001, 0]);
    p.push([sph(0.0032 * k), l.skin, s * 0.0128 * k * w, ty - 0.011 * k, 0.001]);
  }
  // head
  const hy = ty + 0.022 * k;
  const r = 0.0105 * k;
  p.push([sph(r), l.skin, 0, hy, 0], [sph(r * 0.15), '#2a1c14', -r * 0.36, hy + r * 0.05, r * 0.93], [sph(r * 0.15), '#2a1c14', r * 0.36, hy + r * 0.05, r * 0.93]);
  p.push([sph(r * 0.2), '#ff9a8a', -r * 0.6, hy - r * 0.2, r * 0.75], [sph(r * 0.2), '#ff9a8a', r * 0.6, hy - r * 0.2, r * 0.75]);
  const hs = l.hairStyle ?? 'short';
  if (hs !== 'bald') p.push([new THREE.SphereGeometry(r * 1.07, 12, 9, 0, Math.PI * 2, 0, Math.PI * (hs === 'bob' || hs === 'long' ? 0.62 : 0.52)), l.hair, 0, hy + r * 0.08, -r * 0.08]);
  else p.push([new THREE.SphereGeometry(r * 1.03, 12, 9, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.3), l.hair, 0, hy, -r * 0.1]);
  if (hs === 'long' || hs === 'braid') p.push([cap(r * 0.72, r * 1.5), l.hair, 0, hy - r * 0.9, -r * 0.55]);
  if (hs === 'braid') p.push([cap(r * 0.25, r * 1.4).rotateZ(0.3), l.hair, r * 0.7, hy - r * 1.5, r * 0.1]);
  if (hs === 'bob') p.push([sph(r * 1.08, 1, 0.75, 1), l.hair, 0, hy - r * 0.15, -r * 0.18]);
  if (hs === 'bun') p.push([sph(r * 0.45), l.hair, 0, hy + r * 0.95, -r * 0.45]);
  if (hs === 'ponytail') p.push([cap(r * 0.32, r * 1.2).rotateX(0.5), l.hair, 0, hy - r * 0.2, -r * 1.05]);
  if (hs === 'curly') for (let i = 0; i < 7; i++) p.push([sph(r * 0.38), l.hair, Math.cos(i * 0.9) * r * 0.85, hy + r * 0.45 + (i % 2) * r * 0.25, Math.sin(i * 0.9) * r * 0.85 - r * 0.2]);
  if (hs === 'spiky') for (let i = 0; i < 6; i++) p.push([new THREE.ConeGeometry(r * 0.3, r * 0.8, 5).rotateX(-0.5 + (i % 2) * 0.3).rotateZ((i - 2.5) * 0.35), l.hair, (i - 2.5) * r * 0.3, hy + r * 1.05, -r * 0.2]);
  if (l.beard) p.push([sph(r * 0.8, 1, 0.9, 0.6), l.beard, 0, hy - r * 0.62, r * 0.5]);
  if (l.mustache) p.push([sph(r * 0.38, 1.6, 0.45, 0.5), l.mustache, 0, hy - r * 0.28, r * 0.92]);
  if (l.glasses) for (const s of [-1, 1]) p.push([new THREE.TorusGeometry(r * 0.27, r * 0.06, 5, 12), '#3a2a1e', s * r * 0.38, hy + r * 0.05, r * 0.98]);
  if (l.hat) {
    const c = l.hat.color;
    if (l.hat.kind === 'cap') p.push([new THREE.SphereGeometry(r * 1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), c, 0, hy + r * 0.2, 0], [cyl(r * 0.6, r * 0.6, r * 0.12).scale(1, 1, 1.4), c, 0, hy + r * 0.25, r * 0.9]);
    if (l.hat.kind === 'wide' || l.hat.kind === 'straw') p.push([cyl(r * 1.9, r * 1.9, r * 0.15, 18), c, 0, hy + r * 0.6, 0], [cyl(r * 0.8, r * 1.0, r * 0.8, 14), c, 0, hy + r * 1.05, 0]);
    if (l.hat.kind === 'wizard') p.push([cyl(r * 2.1, r * 2.1, r * 0.15, 18), c, 0, hy + r * 0.6, 0], [new THREE.ConeGeometry(r * 0.95, r * 2.4, 12).rotateZ(-0.25), c, r * 0.3, hy + r * 1.8, 0], [cyl(r * 1.0, r * 1.0, r * 0.25, 14), '#e8c84a', 0, hy + r * 0.8, 0]);
    if (l.hat.kind === 'bow') p.push([sph(r * 0.45, 1.6, 0.8, 0.6), c, -r * 0.5, hy + r * 1.0, 0], [sph(r * 0.45, 1.6, 0.8, 0.6), c, r * 0.5, hy + r * 1.0, 0]);
  }
  return { geo: paintedGeometry(p), head: hy };
}

/** One villager: a single mesh that walks by bobbing, plus a speech anchor and a touch target. */
export class Villager {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly head = new THREE.Object3D();
  readonly hitProxy: THREE.Mesh;

  constructor(look: Look) {
    const { geo, head } = personGeometry(look);
    this.body = new THREE.Mesh(geo, characterMaterial());
    this.body.castShadow = true;
    this.head.position.y = head;
    this.root.add(this.body, this.head);
    this.hitProxy = new THREE.Mesh(new THREE.BoxGeometry(0.04, head + 0.02, 0.04), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.y = (head + 0.02) / 2;
    this.root.add(this.hitProxy);
  }

  /** Walking: a little bounce and sway (amount 0..1). */
  walk(phase: number, amount: number) {
    this.body.position.y = Math.abs(Math.sin(phase)) * 0.003 * amount;
    this.body.rotation.z = Math.sin(phase) * 0.08 * amount;
  }
}
