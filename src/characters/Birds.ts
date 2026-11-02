import * as THREE from 'three';
import { mulberry32, range } from '../utils/math';

interface Bird {
  root: THREE.Group;
  wings: THREE.Mesh[];
  radius: number;
  angle: number;
  speed: number;
  height: number;
  phase: number;
  golden: boolean;
}

/** A small flock circling above the island; one rare golden bird is a discovery. */
export class Birds {
  readonly group = new THREE.Group();
  readonly goldenProxy: THREE.Mesh;
  private birds: Bird[] = [];
  private golden!: Bird;
  private goldenSpin = 0;

  constructor(centerY: number, count = 7) {
    this.group.name = 'birds';
    const rng = mulberry32(77);
    const bodyGeo = new THREE.ConeGeometry(0.012, 0.045, 5).rotateX(Math.PI / 2);
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.012, 0.055, 0, -0.004, 0, 0, -0.014], 3));
    wingGeo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#ffd36b', emissive: new THREE.Color('#ffb52e'), emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide, flatShading: true });
    for (let i = 0; i < count; i++) {
      const golden = i === count - 1;
      const m = golden ? goldMat : mat;
      const root = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, m);
      const wl = new THREE.Mesh(wingGeo, m);
      const wr = new THREE.Mesh(wingGeo, m);
      wr.scale.x = -1;
      root.add(body, wl, wr);
      root.scale.setScalar(golden ? 1.3 : range(rng, 0.8, 1.1));
      this.group.add(root);
      const b: Bird = { root, wings: [wl, wr], radius: range(rng, 0.7, 1.45), angle: rng() * Math.PI * 2, speed: range(rng, 0.25, 0.42) * (rng() < 0.3 ? -1 : 1), height: centerY + range(rng, 0.75, 1.15), phase: rng() * 6, golden };
      this.birds.push(b);
      if (golden) {
        this.golden = b;
        b.radius = 1.05;
        b.height = centerY + 0.95;
      }
    }
    this.goldenProxy = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.goldenProxy.name = 'golden-bird-hit';
    this.golden.root.add(this.goldenProxy);
    this.goldenProxy.scale.setScalar(1 / this.golden.root.scale.x);
  }

  get goldenPosition() {
    return this.golden.root.getWorldPosition(new THREE.Vector3());
  }

  celebrateGolden() {
    this.goldenSpin = 1.2;
  }

  update(dt: number, t: number) {
    for (const b of this.birds) {
      b.angle += b.speed * dt;
      const x = Math.cos(b.angle) * b.radius;
      const z = Math.sin(b.angle) * b.radius;
      const y = b.height + Math.sin(t * 0.8 + b.phase) * 0.06;
      b.root.position.set(x, y, z);
      // tangent heading
      const dir = Math.sign(b.speed);
      b.root.rotation.set(0, Math.atan2(-Math.sin(b.angle) * dir, Math.cos(b.angle) * dir) + 0, -0.35 * dir);
      const gliding = Math.sin(t * 0.5 + b.phase) > 0.6;
      const flap = gliding ? 0.15 : Math.sin(t * 14 + b.phase * 4) * 0.7;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
    }
    if (this.goldenSpin > 0) {
      this.goldenSpin -= dt;
      this.golden.root.rotation.z += dt * 12;
    }
  }
}
