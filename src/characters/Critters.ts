import * as THREE from 'three';
import { terrainHeight, pointOnPolyline } from '../world/Terrain';
import { PATHS, MEADOW, VILLAGE } from '../world/layout';
import { bakeRigidParts } from '../utils/merge';

interface Critter {
  root: THREE.Group;
  body: THREE.Object3D;
  route: ReadonlyArray<readonly [number, number]>;
  u: number;
  dir: number;
  speed: number;
  pause: number;
  phase: number;
}

/**
 * "Lanudos": fluffy round creatures that wander the paths and meadow,
 * hopping as they go. They get excited when the village lights up.
 */
export class Critters {
  readonly group = new THREE.Group();
  private list: Critter[] = [];
  private excited = 0;

  constructor() {
    this.group.name = 'critters';
    const fluff = new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 1, flatShading: true });
    const fluffWarm = new THREE.MeshStandardMaterial({ color: '#e9cfa8', roughness: 1, flatShading: true });
    const face = new THREE.MeshStandardMaterial({ color: '#3d3440', roughness: 0.6 });
    const eye = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const bakedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const meadowLoop: Array<[number, number]> = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      meadowLoop.push([MEADOW.x + Math.cos(a) * 0.12, MEADOW.z + Math.sin(a) * 0.08]);
    }
    const villageLoop: Array<[number, number]> = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      villageLoop.push([VILLAGE.x + 0.05 + Math.cos(a) * 0.07, VILLAGE.z + 0.06 + Math.sin(a) * 0.05]);
    }
    const routes = [PATHS[0], PATHS[1], meadowLoop, villageLoop, PATHS[2]];
    routes.forEach((route, i) => {
      const root = new THREE.Group();
      const body = new THREE.Group();
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.016, 1), i % 2 ? fluffWarm : fluff);
      b.position.y = 0.016;
      b.castShadow = true;
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), face);
      f.position.set(0, 0.02, 0.013);
      f.scale.set(1, 1, 0.7);
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 6, 4), eye);
        e.position.set(s * 0.003, 0.022, 0.0185);
        body.add(e);
      }
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), face);
        ear.position.set(s * 0.009, 0.026, 0.008);
        ear.scale.set(1.4, 0.6, 1);
        body.add(ear);
      }
      body.add(b, f);
      bakeRigidParts(body, bakedMat);
      root.add(body);
      root.scale.setScalar(i === 2 ? 1.25 : 1);
      this.group.add(root);
      this.list.push({ root, body, route, u: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: 0.05 + Math.random() * 0.03, pause: 0, phase: Math.random() * 6 });
    });
  }

  excite() {
    this.excited = 6;
  }

  update(dt: number, t: number) {
    this.excited = Math.max(0, this.excited - dt);
    for (const c of this.list) {
      const loop = c.route[0][0] === c.route[c.route.length - 1][0] && c.route[0][1] === c.route[c.route.length - 1][1];
      if (c.pause > 0) c.pause -= dt;
      else {
        c.u += c.dir * c.speed * dt * (this.excited > 0 ? 1.8 : 1);
        if (loop) c.u = ((c.u % 1) + 1) % 1;
        else if (c.u > 1 || c.u < 0) {
          c.u = Math.min(1, Math.max(0, c.u));
          c.dir *= -1;
          c.pause = 1 + Math.random() * 2;
        }
        if (Math.random() < dt * 0.1) c.pause = 0.8 + Math.random() * 1.5;
      }
      const p = pointOnPolyline(c.route, c.u);
      const q = pointOnPolyline(c.route, Math.min(1, Math.max(0, c.u + c.dir * 0.02)));
      const y = terrainHeight(p[0], p[1]);
      c.root.position.set(p[0], y, p[1]);
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-5) c.root.rotation.y = Math.atan2(q[0] - p[0], q[1] - p[1]);
      const moving = c.pause <= 0;
      const hopF = this.excited > 0 ? 12 : 9;
      const hop = moving || this.excited > 0 ? Math.abs(Math.sin(t * hopF + c.phase)) * (this.excited > 0 ? 0.016 : 0.008) : 0;
      c.body.position.y = hop;
      c.body.scale.set(1 + (hop > 0.001 ? 0 : 0.06), 1 - (hop > 0.001 ? -0.05 : 0.04), 1);
    }
  }
}
