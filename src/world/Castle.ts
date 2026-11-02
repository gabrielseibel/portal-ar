import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StaticBatch } from './StaticBatch';
import { C } from './palette';
import { CASTLE, SECRET_DOOR } from './layout';
import { terrainHeight } from './Terrain';
import { damp, mulberry32 } from '../utils/math';
import { shared } from '../systems/SharedUniforms';

const flagVert = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float w = sin(uv.x * 6.0 - uTime * uSpeed) * 0.004 * uv.x;
  p.z += w;
  p.y += sin(uv.x * 4.0 - uTime * uSpeed * 0.7) * 0.0015 * uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const flagFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTrim;
varying vec2 vUv;
void main() {
  float trim = step(0.82, vUv.y) + step(vUv.y, 0.18);
  vec3 c = mix(uColor, uTrim, trim);
  c *= 0.75 + 0.25 * sin(vUv.x * 6.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Castelo de Aurora Alta, on the plateau. Gates, windows and flags animate
 * when touched; a rune stone on the hill flank hides a secret passage.
 */
export class Castle {
  readonly group = new THREE.Group();
  readonly hitProxy: THREE.Mesh;
  readonly secretProxy: THREE.Mesh;
  readonly towerTop = new THREE.Vector3();
  readonly gatePosition = new THREE.Vector3();
  readonly secretPosition = new THREE.Vector3();
  private windowMat: THREE.MeshBasicMaterial;
  private doors: THREE.Object3D[] = [];
  private gateGlow: THREE.Mesh;
  private flagMat: THREE.ShaderMaterial;
  private open = 0;
  private openTarget = 0;
  private openTimer = 0;
  private lit = 0;
  private slab: THREE.Mesh;
  private tunnelGlow: THREE.Mesh;
  private secretOpen = 0;
  private secretTarget = 0;
  private baseWin = C.windowWarm.clone().multiplyScalar(0.5);

  constructor(batch: StaticBatch, detail: StaticBatch) {
    this.group.name = 'castle';
    const rng = mulberry32(5);
    const base = new THREE.Object3D();
    const y0 = terrainHeight(CASTLE.x, CASTLE.z) - 0.004;
    base.position.set(CASTLE.x, y0, CASTLE.z);
    base.rotation.y = -0.18;
    base.updateMatrix();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const tmp = new THREE.Object3D();
    const put = (geo: THREE.BufferGeometry, color: THREE.Color, p: [number, number, number], s: [number, number, number] = [1, 1, 1], ry = 0, target = batch) => {
      tmp.position.set(...p);
      tmp.rotation.set(0, ry, 0);
      tmp.scale.set(...s);
      tmp.updateMatrix();
      target.addMatrix(geo, color, base.matrix.clone().multiply(tmp.matrix), 0.06, rng);
    };
    const windows: THREE.BufferGeometry[] = [];
    const win = (p: [number, number, number], s: [number, number, number], ry = 0) => {
      tmp.position.set(...p);
      tmp.rotation.set(0, ry, 0);
      tmp.scale.set(...s);
      tmp.updateMatrix();
      windows.push(box.clone().applyMatrix4(tmp.matrix).applyMatrix4(base.matrix));
    };

    const S = 0.11;
    const WH = 0.075;
    const T = 0.018;
    // base mound
    put(new THREE.CylinderGeometry(0.17, 0.19, 0.02, 10), C.stoneDark, [0, 0.004, 0]);
    // curtain walls (front wall split for the gate)
    put(box, C.stone, [0, WH / 2, -S], [2 * S, WH, T]);
    put(box, C.stone, [-S, WH / 2, 0], [T, WH, 2 * S]);
    put(box, C.stone, [S, WH / 2, 0], [T, WH, 2 * S]);
    put(box, C.stone, [-S / 2 - 0.012, WH / 2, S], [S - 0.024, WH, T]);
    put(box, C.stone, [S / 2 + 0.012, WH / 2, S], [S - 0.024, WH, T]);
    put(box, C.stone, [0, WH - 0.012, S], [0.05, 0.024, T]);
    // crenellations
    const cren = new THREE.BoxGeometry(0.012, 0.012, T + 0.004);
    for (let i = -4; i <= 4; i++) {
      const o = (i / 4) * (S - 0.012);
      put(cren, C.stoneLight, [o, WH + 0.006, -S], [1, 1, 1], 0, detail);
      put(cren, C.stoneLight, [o, WH + 0.006, S], [1, 1, 1], 0, detail);
      put(cren, C.stoneLight, [-S, WH + 0.006, o], [1, 1, 1], Math.PI / 2, detail);
      put(cren, C.stoneLight, [S, WH + 0.006, o], [1, 1, 1], Math.PI / 2, detail);
    }
    // corner towers
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const h = 0.13 + (sz < 0 ? 0.02 : 0);
      put(new THREE.CylinderGeometry(0.028, 0.032, h, 10), C.stoneLight, [sx * S, h / 2, sz * S]);
      put(new THREE.CylinderGeometry(0.034, 0.034, 0.01, 10), C.stone, [sx * S, h, sz * S]);
      put(new THREE.ConeGeometry(0.038, 0.075, 10), C.roofSlate, [sx * S, h + 0.042, sz * S]);
      win([sx * S + sx * 0.02, h * 0.7, sz * S + sz * 0.02], [0.006, 0.014, 0.006], Math.PI / 4);
      win([sx * S, h * 0.45, sz * S + 0.03], [0.007, 0.012, 0.004]);
    }
    // keep
    put(box, C.stoneLight, [0.02, 0.07, -0.035], [0.1, 0.14, 0.09]);
    put(new THREE.ConeGeometry(0.08, 0.06, 4), C.roofSlate, [0.02, 0.17, -0.035], [1, 1, 1], Math.PI / 4);
    for (let i = -1; i <= 1; i++) {
      win([0.02 + i * 0.028, 0.1, 0.0105], [0.01, 0.018, 0.004]);
      win([0.02 + i * 0.028, 0.055, 0.0105], [0.008, 0.012, 0.004]);
    }
    // main tower
    const MT = 0.25;
    put(new THREE.CylinderGeometry(0.034, 0.04, MT, 12), C.stone, [-0.04, MT / 2, -0.05]);
    put(new THREE.CylinderGeometry(0.044, 0.044, 0.012, 12), C.stoneLight, [-0.04, MT, -0.05]);
    put(new THREE.ConeGeometry(0.05, 0.11, 12), C.roofSlate, [-0.04, MT + 0.06, -0.05]);
    for (let i = 0; i < 3; i++) win([-0.04, 0.12 + i * 0.045, -0.05 + 0.038], [0.008, 0.016, 0.004]);
    win([-0.04 + 0.037, 0.2, -0.05], [0.004, 0.016, 0.008]);
    this.towerTop.set(-0.04, MT + 0.14, -0.05).applyMatrix4(base.matrix);

    // gatehouse
    for (const sx of [-1, 1]) {
      put(box, C.stoneLight, [sx * 0.032, 0.05, S + 0.004], [0.022, 0.1, 0.03]);
      put(new THREE.ConeGeometry(0.02, 0.035, 4), C.roofSlate, [sx * 0.032, 0.118, S + 0.004], [1, 1, 1], Math.PI / 4);
    }
    put(box, C.woodDark, [0, 0.024, S - 0.004], [0.04, 0.048, 0.006]);
    // ramp to the gate
    put(box, C.stoneDark, [0, 0.004, S + 0.045], [0.05, 0.008, 0.06], 0, detail);

    // gate doors (animated)
    const doorGeo = new THREE.BoxGeometry(0.02, 0.046, 0.005).translate(0.01, 0.023, 0);
    const doorMat = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 0.8, flatShading: true });
    const doorsRoot = new THREE.Group();
    doorsRoot.position.set(0, 0, S + 0.006);
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * -0.02, 0, 0);
      const d = new THREE.Mesh(doorGeo, doorMat);
      d.scale.x = sx;
      pivot.add(d);
      doorsRoot.add(pivot);
      this.doors.push(pivot);
    }
    this.gateGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.038, 0.046),
      new THREE.MeshBasicMaterial({ color: '#ffcf86', transparent: true, opacity: 0, toneMapped: false }),
    );
    this.gateGlow.position.set(0, 0.024, S - 0.0005);
    const gateFrame = new THREE.Group();
    gateFrame.add(doorsRoot, this.gateGlow);
    gateFrame.position.copy(base.position);
    gateFrame.rotation.copy(base.rotation);
    this.group.add(gateFrame);
    this.gatePosition.set(0, 0.03, S + 0.02).applyMatrix4(base.matrix);

    // windows mesh
    this.windowMat = new THREE.MeshBasicMaterial({ color: this.baseWin.clone(), toneMapped: false });
    const winMesh = new THREE.Mesh(mergeGeometries(
        windows.map((g) => {
          const n = g.toNonIndexed();
          n.deleteAttribute('uv');
          return n;
        }),
      ), this.windowMat);
    winMesh.name = 'castle-windows';
    this.group.add(winMesh);

    // flags
    this.flagMat = new THREE.ShaderMaterial({
      vertexShader: flagVert,
      fragmentShader: flagFrag,
      side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uSpeed: { value: 5 }, uColor: { value: C.flagRed.clone() }, uTrim: { value: C.flagGold.clone() } },
    });
    const flagGeo = new THREE.PlaneGeometry(0.04, 0.022, 8, 1).translate(0.02, 0, 0);
    const poleGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 0.05, 4);
    const flagSpots: Array<[number, number, number]> = [
      [-0.04, MT + 0.1, -0.05],
      [-S, 0.15 + 0.07, -S],
      [S, 0.15 + 0.07, -S],
    ];
    for (const [x, y, z] of flagSpots) {
      put(poleGeo, C.woodDark, [x, y + 0.02, z], [1, 1, 1], 0, detail);
      const f = new THREE.Mesh(flagGeo, this.flagMat);
      const p = new THREE.Vector3(x, y + 0.034, z).applyMatrix4(base.matrix);
      f.position.copy(p);
      f.rotation.y = 0.6;
      this.group.add(f);
    }

    // touch target
    this.hitProxy = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.set(CASTLE.x, y0 + 0.14, CASTLE.z);
    this.hitProxy.rotation.y = base.rotation.y;
    this.hitProxy.name = 'castle-hit';
    this.group.add(this.hitProxy);

    // ---------- secret passage ----------
    const sx = SECRET_DOOR.x;
    const sz = SECRET_DOOR.z;
    const sy = terrainHeight(sx, sz);
    const facing = Math.atan2(sx - CASTLE.x, sz - CASTLE.z);
    const secret = new THREE.Group();
    secret.position.set(sx, sy, sz);
    secret.rotation.y = facing;
    // tunnel mouth: dark stone arch + glowing interior
    const archMat = new THREE.MeshStandardMaterial({ color: C.rockDark, flatShading: true, roughness: 1 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 5, 10, Math.PI), archMat);
    arch.position.y = 0.012;
    const tunnel = new THREE.Mesh(new THREE.CircleGeometry(0.024, 12, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#120d18' }));
    tunnel.position.set(0, 0.012, -0.002);
    this.tunnelGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.022, 12, 0, Math.PI),
      new THREE.MeshBasicMaterial({ color: '#7ff6ff', transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.tunnelGlow.position.set(0, 0.012, -0.001);
    // rune slab covering the mouth
    const slabMat = new THREE.MeshStandardMaterial({ color: C.stone, flatShading: true, roughness: 0.9, emissive: new THREE.Color('#58e0ff'), emissiveIntensity: 0.0 });
    this.slab = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.012), slabMat);
    this.slab.position.set(0, 0.025, 0.006);
    // carved rune (thin emissive bars)
    const runeMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', toneMapped: false, transparent: true, opacity: 0.55 });
    const rune = new THREE.Group();
    for (const [w, hh, x, y, rz] of [
      [0.003, 0.03, 0, 0, 0],
      [0.003, 0.016, -0.007, 0.006, 0.7],
      [0.003, 0.016, 0.007, 0.006, -0.7],
      [0.014, 0.003, 0, -0.01, 0],
    ]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), runeMat);
      b.position.set(x, y, 0.0062);
      b.rotation.z = rz;
      rune.add(b);
    }
    this.slab.add(rune);
    secret.add(arch, tunnel, this.tunnelGlow, this.slab);
    this.group.add(secret);
    this.secretPosition.set(sx, sy + 0.025, sz);

    this.secretProxy = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.secretProxy.position.copy(this.secretPosition);
    this.secretProxy.name = 'secret-door-hit';
    this.group.add(this.secretProxy);
  }

  celebrate() {
    this.openTarget = 1;
    this.openTimer = 9;
    this.lit = 9;
  }

  openSecret() {
    this.secretTarget = 1;
  }

  get secretIsOpen() {
    return this.secretTarget > 0;
  }

  update(dt: number, t: number) {
    if (this.openTimer > 0) {
      this.openTimer -= dt;
      if (this.openTimer <= 0) this.openTarget = 0;
    }
    if (this.lit > 0) this.lit -= dt;
    this.open = damp(this.open, this.openTarget, 2.2, dt);
    this.doors[0].rotation.y = -this.open * 1.7;
    this.doors[1].rotation.y = this.open * 1.7;
    (this.gateGlow.material as THREE.MeshBasicMaterial).opacity = this.open * (0.85 + Math.sin(t * 9) * 0.08);
    const glow = this.lit > 0 ? Math.min(1, this.lit) : 0;
    const k = 0.7 + glow * 2.6 + Math.sin(t * 2) * 0.05;
    this.windowMat.color.copy(this.baseWin).multiplyScalar(k);
    this.flagMat.uniforms.uSpeed.value = damp(this.flagMat.uniforms.uSpeed.value, this.lit > 0 ? 11 : 5, 2, dt);

    this.secretOpen = damp(this.secretOpen, this.secretTarget, 2.5, dt);
    this.slab.position.x = this.secretOpen * 0.058;
    this.slab.rotation.y = this.secretOpen * -0.25;
    (this.slab.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + Math.sin(t * 2.4) * 0.1 + this.secretOpen * 0.3;
    (this.tunnelGlow.material as THREE.MeshBasicMaterial).opacity = this.secretOpen * (0.7 + Math.sin(t * 4) * 0.15);
  }
}
