import * as THREE from 'three';
import { StaticBatch } from './StaticBatch';
import { C } from './palette';
import { BRIDGE, CHEST, CRYSTALS, RIVER } from './layout';
import { samplePoint, terrainHeight, riverLevel, edgeRadius } from './Terrain';
import { distToPolyline, mulberry32, range, damp } from '../utils/math';

/** Rocks, the wooden bridge, a standing-stone circle and the hidden chest. */
export class Props {
  readonly group = new THREE.Group();
  readonly chestProxy: THREE.Mesh;
  readonly chestPosition = new THREE.Vector3();
  private lid: THREE.Object3D;
  private lidOpen = 0;
  private lidTarget = 0;
  private chestGlow: THREE.Mesh;

  constructor(batch: StaticBatch, detail: StaticBatch) {
    this.group.name = 'props';
    const rng = mulberry32(23);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const box = new THREE.BoxGeometry(1, 1, 1);

    // scattered rocks
    for (let i = 0; i < 38; i++) {
      const p = samplePoint(rng, (x, z) => distToPolyline(x, z, RIVER).d > 0.05 || rng() < 0.5);
      if (!p) continue;
      const s = range(rng, 0.008, 0.028);
      const target = s > 0.018 ? batch : detail;
      target.add(rock, rng() < 0.5 ? C.rock : C.stoneDark, { x: p[0], y: terrainHeight(p[0], p[1]) + s * 0.25, z: p[1] }, { x: rng() * 3, y: rng() * 3, z: rng() * 3 }, { x: s * 1.3, y: s * 0.8, z: s }, 0.15, rng);
    }
    // river stones
    for (let i = 0; i < 14; i++) {
      const t = range(rng, 0.05, 0.95);
      const side = rng() < 0.5 ? -1 : 1;
      const p = RIVER[Math.floor(t * (RIVER.length - 1))];
      const x = p[0] + side * range(rng, 0.045, 0.07);
      const z = p[1] + range(rng, -0.04, 0.04);
      detail.add(rock, C.stoneLight, { x, y: terrainHeight(x, z) + 0.003, z }, { y: rng() * 3 }, { x: 0.01, y: 0.005, z: 0.008 }, 0.2, rng);
    }

    // standing stones around the crystal glade
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2;
      const x = CRYSTALS.x + Math.cos(a) * 0.115;
      const z = CRYSTALS.z + Math.sin(a) * 0.115;
      batch.add(box, C.stoneDark, { x, y: terrainHeight(x, z) + 0.018, z }, { y: -a, z: range(rng, -0.08, 0.08) }, { x: 0.012, y: 0.042 + rng() * 0.012, z: 0.02 }, 0.1, rng);
    }

    // arched wooden bridge across the river
    const by = riverLevel(0.45);
    const span = 0.16;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = BRIDGE.x - span / 2 + t * span;
      const y = by + 0.012 + Math.sin(t * Math.PI) * 0.025;
      batch.add(box, i % 2 ? C.woodLight : C.wood, { x, y, z: BRIDGE.z }, { z: Math.cos(t * Math.PI) * 0.45 }, { x: 0.016, y: 0.005, z: 0.045 }, 0.1, rng);
      if (i % 2 === 0) {
        for (const s of [-1, 1]) detail.add(box, C.woodDark, { x, y: y + 0.012, z: BRIDGE.z + s * 0.021 }, {}, { x: 0.003, y: 0.024, z: 0.003 });
      }
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        const t0 = i / 10;
        const t1 = (i + 1) / 10;
        const x0 = BRIDGE.x - span / 2 + t0 * span;
        const x1 = BRIDGE.x - span / 2 + t1 * span;
        const y0 = by + 0.034 + Math.sin(t0 * Math.PI) * 0.025;
        const y1 = by + 0.034 + Math.sin(t1 * Math.PI) * 0.025;
        detail.add(box, C.woodDark, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: BRIDGE.z + s * 0.021 }, { z: Math.atan2(y1 - y0, x1 - x0) }, { x: Math.hypot(x1 - x0, y1 - y0), y: 0.003, z: 0.003 });
      }
    }

    // ---------- hidden chest on the cliff edge ----------
    const th = Math.atan2(CHEST.z, CHEST.x);
    const er = edgeRadius(th) * 0.93;
    const cx = Math.cos(th) * er;
    const cz = Math.sin(th) * er;
    const cy = terrainHeight(cx, cz);
    const chest = new THREE.Group();
    chest.position.set(cx, cy, cz);
    chest.rotation.y = -th + Math.PI / 2;
    const woodMat = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 0.8, flatShading: true });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#d8aa45', roughness: 0.35, metalness: 0.8, flatShading: true });
    const baseM = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.02, 0.024), woodMat);
    baseM.position.y = 0.01;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.004, 0.026), goldMat);
    band.position.y = 0.018;
    this.lid = new THREE.Group();
    this.lid.position.set(0, 0.02, -0.012);
    const lidM = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.036, 8, 1, false, 0, Math.PI), woodMat);
    lidM.rotation.z = Math.PI / 2;
    lidM.position.z = 0.012;
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.003), goldMat);
    lock.position.set(0, 0.002, 0.025);
    this.lid.add(lidM, lock);
    this.chestGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.03, 0.02),
      new THREE.MeshBasicMaterial({ color: '#ffd76e', transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.chestGlow.rotation.x = -Math.PI / 2;
    this.chestGlow.position.y = 0.0205;
    chest.add(baseM, band, this.lid, this.chestGlow);
    chest.scale.setScalar(1.15);
    this.group.add(chest);
    // a boulder hiding it from the front
    const bx = cx + Math.cos(th + 0.12) * 0.01 - 0.0;
    const bz = cz + 0.045;
    batch.add(rock, C.rock, { x: bx, y: terrainHeight(bx, bz) + 0.012, z: bz }, { y: 1.2 }, { x: 0.032, y: 0.03, z: 0.026 }, 0.1, rng);
    this.chestPosition.set(cx, cy + 0.03, cz);

    this.chestProxy = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.chestProxy.position.copy(this.chestPosition);
    this.chestProxy.name = 'chest-hit';
    this.group.add(this.chestProxy);
  }

  openChest() {
    this.lidTarget = 1;
  }

  get chestOpened() {
    return this.lidTarget > 0;
  }

  update(dt: number, t: number) {
    this.lidOpen = damp(this.lidOpen, this.lidTarget, 3, dt);
    this.lid.rotation.x = -this.lidOpen * 1.9;
    (this.chestGlow.material as THREE.MeshBasicMaterial).opacity = this.lidOpen * (0.8 + Math.sin(t * 5) * 0.2);
  }
}
