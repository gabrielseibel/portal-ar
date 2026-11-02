import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { C } from './palette';
import { mulberry32, range } from '../utils/math';

interface Orbiter {
  obj: THREE.Object3D;
  radius: number;
  angle: number;
  speed: number;
  y: number;
  bob: number;
  phase: number;
  spin: number;
}

/** Drifting clouds and small floating rocks orbiting the island (stage units, centered on the portal axis). */
export class Sky {
  readonly group = new THREE.Group();
  private orbiters: Orbiter[] = [];

  constructor(islandY: number, cloudCount: number) {
    this.group.name = 'sky';
    const rng = mulberry32(3);
    const cloudMat = new THREE.MeshStandardMaterial({ color: C.cloud, roughness: 1, flatShading: true, emissive: new THREE.Color('#fff4ea'), emissiveIntensity: 0.18, transparent: true, opacity: 0.95 });
    for (let i = 0; i < cloudCount; i++) {
      const puffs: THREE.BufferGeometry[] = [];
      const n = 4 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const r = range(rng, 0.05, 0.1) * (k === 0 ? 1.3 : 1);
        const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
        g.deleteAttribute('uv');
        g.scale(1, 0.7, 1);
        g.translate((k - n / 2) * 0.06 + range(rng, -0.02, 0.02), range(rng, -0.01, 0.03), range(rng, -0.04, 0.04));
        puffs.push(g);
      }
      const geo = mergeGeometries(puffs);
      geo.computeVertexNormals();
      const cloud = new THREE.Mesh(geo, cloudMat);
      cloud.name = 'cloud';
      const s = range(rng, 0.8, 1.4);
      cloud.scale.setScalar(s);
      this.group.add(cloud);
      this.orbiters.push({ obj: cloud, radius: range(rng, 1.35, 1.75), angle: (i / cloudCount) * Math.PI * 2 + rng(), speed: range(rng, 0.025, 0.05), y: islandY + range(rng, 0.35, 0.95), bob: 0.03, phase: rng() * 6, spin: 0 });
    }

    // floating rocks with grassy caps
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    for (let i = 0; i < 6; i++) {
      const r = range(rng, 0.035, 0.07);
      const top = new THREE.CylinderGeometry(r, r * 0.9, r * 0.35, 6).toNonIndexed();
      const bottom = new THREE.ConeGeometry(r * 0.9, r * 1.6, 6).toNonIndexed();
      bottom.rotateX(Math.PI);
      bottom.translate(0, -r * 0.95, 0);
      for (const [g, c] of [
        [top, C.grass],
        [bottom, C.rock],
      ] as const) {
        g.deleteAttribute('uv');
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      const geo = mergeGeometries([top, bottom]);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, rockMat);
      m.castShadow = true;
      this.group.add(m);
      this.orbiters.push({ obj: m, radius: range(rng, 1.12, 1.38), angle: (i / 6) * Math.PI * 2 + 0.4, speed: range(rng, -0.06, 0.06), y: islandY + range(rng, -0.55, 0.05), bob: 0.04, phase: rng() * 6, spin: range(rng, -0.3, 0.3) });
    }
  }

  update(dt: number, t: number) {
    for (const o of this.orbiters) {
      o.angle += o.speed * dt;
      o.obj.position.set(Math.cos(o.angle) * o.radius, o.y + Math.sin(t * 0.6 + o.phase) * o.bob, Math.sin(o.angle) * o.radius);
      o.obj.rotation.y += o.spin * dt;
    }
  }
}
