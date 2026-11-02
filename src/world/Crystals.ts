import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CRYSTALS, SECRET_CRYSTAL } from './layout';
import { terrainHeight, edgeRadius } from './Terrain';
import { mulberry32, range, damp } from '../utils/math';
import { glowTexture } from '../utils/textures';
import { mergeByMaterial } from '../utils/merge';

export function crystalGeometry() {
  const body = new THREE.CylinderGeometry(0.5, 0.42, 1, 6, 1).translate(0, 0.5, 0);
  const tip = new THREE.ConeGeometry(0.5, 0.55, 6, 1).translate(0, 1.275, 0);
  const g = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()]);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function crystalMaterial(color: string, emissive: string, intensity = 0.8) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness: 0.18,
    metalness: 0.05,
    flatShading: true,
    transparent: true,
    opacity: 0.93,
  });
}

interface Shard {
  mesh: THREE.Mesh;
  base: number;
  delay: number;
}

/** Interactive crystal cluster + decorative clusters under the island. */
export class Crystals {
  readonly group = new THREE.Group();
  readonly hitProxy: THREE.Mesh;
  readonly center = new THREE.Vector3();
  readonly secret: THREE.Group;
  readonly secretProxy: THREE.Mesh;
  readonly secretPosition = new THREE.Vector3();
  private shards: Shard[] = [];
  private pulse = -10;
  private mat: THREE.MeshStandardMaterial;
  private matAlt: THREE.MeshStandardMaterial;
  private underMat: THREE.MeshStandardMaterial;
  private secretMat: THREE.MeshStandardMaterial;
  private glow: THREE.Sprite;
  private secretGlow: THREE.Sprite;
  private secretFound = 0;
  private boost = 0;

  constructor() {
    this.group.name = 'crystals';
    const rng = mulberry32(99);
    const geo = crystalGeometry();
    this.mat = crystalMaterial('#cdb9ff', '#7a4dff', 0.8);
    this.matAlt = crystalMaterial('#b5fff0', '#2fd6c0', 0.8);

    const y = terrainHeight(CRYSTALS.x, CRYSTALS.z);
    this.center.set(CRYSTALS.x, y + 0.05, CRYSTALS.z);
    const shards = [
      [0, 0, 0.026, 0.11, 0, 0],
      [0.03, 0.012, 0.018, 0.07, 0.35, 0.4],
      [-0.028, 0.01, 0.017, 0.075, -0.4, -0.2],
      [0.008, -0.03, 0.015, 0.06, 0.2, -0.5],
      [-0.012, 0.032, 0.013, 0.05, -0.3, 0.5],
      [0.04, -0.022, 0.011, 0.04, 0.5, -0.2],
      [-0.044, -0.018, 0.012, 0.045, -0.5, -0.4],
    ];
    shards.forEach(([dx, dz, r, h, rx, rz], i) => {
      const m = new THREE.Mesh(geo, i % 3 === 1 ? this.matAlt : this.mat);
      m.position.set(CRYSTALS.x + dx, y - 0.006, CRYSTALS.z + dz);
      m.scale.set(r * 2, h, r * 2);
      m.rotation.set(rx, rng() * 3, rz);
      m.castShadow = true;
      this.group.add(m);
      this.shards.push({ mesh: m, base: h, delay: i * 0.06 });
    });
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#a98bff', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.position.copy(this.center);
    this.glow.scale.setScalar(0.22);
    this.group.add(this.glow);

    this.hitProxy = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.copy(this.center);
    this.hitProxy.name = 'crystals-hit';
    this.group.add(this.hitProxy);

    // ---------- crystals hanging below the island ----------
    this.underMat = crystalMaterial('#9fe9ff', '#38b8ff', 1.1);
    const under = new THREE.Group();
    under.name = 'under-crystals';
    for (let c = 0; c < 7; c++) {
      const th = (c / 7) * Math.PI * 2 + range(rng, -0.3, 0.3);
      const er = edgeRadius(th);
      const k = range(rng, 0.25, 0.6);
      const rr = er * Math.pow(1 - k, 0.75) * 0.8;
      const yy = -0.04 - Math.pow(k, 1.15) * 0.78 + 0.03;
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(geo, c % 2 ? this.underMat : this.mat);
        const s = range(rng, 0.6, 1.2);
        m.position.set(Math.cos(th) * rr + range(rng, -0.02, 0.02), yy, Math.sin(th) * rr + range(rng, -0.02, 0.02));
        m.scale.set(0.03 * s, 0.1 * s, 0.03 * s);
        m.rotation.set(Math.PI + range(rng, -0.4, 0.4), rng() * 3, range(rng, -0.4, 0.4));
        under.add(m);
      }
    }
    mergeByMaterial(under);
    this.group.add(under);

    // ---------- secret crystal behind the waterfall ----------
    this.secret = new THREE.Group();
    this.secretMat = crystalMaterial('#fff1b8', '#ffc94d', 0.35);
    const sy = terrainHeight(SECRET_CRYSTAL.x, SECRET_CRYSTAL.z);
    this.secret.position.set(SECRET_CRYSTAL.x, sy - 0.015, SECRET_CRYSTAL.z);
    for (const [dx, dz, s, rz] of [
      [0, 0, 1, 0],
      [0.012, 0.006, 0.6, 0.5],
      [-0.012, 0.004, 0.55, -0.5],
    ]) {
      const m = new THREE.Mesh(geo, this.secretMat);
      m.position.set(dx, 0, dz);
      m.scale.set(0.022 * s, 0.07 * s, 0.022 * s);
      m.rotation.z = rz;
      this.secret.add(m);
    }
    this.secretGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd36b', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.secretGlow.position.set(0, 0.04, 0);
    this.secretGlow.scale.setScalar(0.1);
    this.secret.add(this.secretGlow);
    this.group.add(this.secret);
    this.secretPosition.set(SECRET_CRYSTAL.x, sy + 0.02, SECRET_CRYSTAL.z);
    this.secretProxy = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.secretProxy.position.copy(this.secretPosition);
    this.secretProxy.name = 'secret-crystal-hit';
    this.group.add(this.secretProxy);
  }

  /** Tap reaction: cascading glow wave across the cluster. */
  trigger(t: number) {
    this.pulse = t;
  }

  revealSecret() {
    this.secretFound = 1;
  }

  /** Global magic boost (e.g. while the portal opens). */
  setBoost(v: number) {
    this.boost = v;
  }

  update(dt: number, t: number) {
    const since = t - this.pulse;
    for (const s of this.shards) {
      const k = Math.max(0, since - s.delay);
      const wave = k < 1.6 ? Math.sin(Math.min(1, k * 4) * Math.PI * 0.5) * Math.exp(-k * 2.2) : 0;
      s.mesh.scale.y = s.base * (1 + wave * 0.25);
    }
    const p = since < 2 ? Math.exp(-since * 1.8) : 0;
    const breathe = 0.75 + Math.sin(t * 1.4) * 0.15;
    this.mat.emissiveIntensity = breathe + p * 3.5 + this.boost;
    this.matAlt.emissiveIntensity = breathe + Math.max(0, p * 3.5 - 0.3) + this.boost;
    this.underMat.emissiveIntensity = 1 + Math.sin(t * 0.9 + 1) * 0.3 + this.boost;
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.35 + p * 0.6 + Math.sin(t * 1.4) * 0.05;
    this.glow.scale.setScalar(0.2 + p * 0.25);
    const sf = damp(this.secretMat.emissiveIntensity, 0.35 + this.secretFound * 2.2 + Math.sin(t * 2) * 0.15, 3, dt);
    this.secretMat.emissiveIntensity = sf;
    (this.secretGlow.material as THREE.SpriteMaterial).opacity = 0.15 + this.secretFound * 0.6;
    this.secretGlow.scale.setScalar(0.1 + this.secretFound * 0.12);
  }
}
