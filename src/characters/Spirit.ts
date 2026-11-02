import * as THREE from 'three';
import { terrainHeight } from '../world/Terrain';
import { MEADOW } from '../world/layout';
import { glowTexture } from '../utils/textures';
import { damp } from '../utils/math';

/**
 * Espírito da Floresta: a translucent fox-like spirit that only appears after
 * the visitor has spent some time in the world, wanders the meadow and fades.
 */
export class Spirit {
  readonly group = new THREE.Group();
  readonly hitProxy: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private glow: THREE.Sprite;
  private tail: THREE.Mesh;
  private visibility = 0;
  private timer = 0;
  private phase: 'waiting' | 'visible' | 'leaving' = 'waiting';
  private angle = 0;
  private found = false;
  private spin = 0;
  firstDelay = 20;
  onAppear: () => void = () => {};

  constructor() {
    this.group.name = 'spirit';
    this.mat = new THREE.MeshBasicMaterial({ color: '#9ffcff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), this.mat);
    body.scale.set(0.9, 0.8, 1.5);
    body.position.y = 0.02;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), this.mat);
    head.position.set(0, 0.032, 0.02);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.014, 8).rotateX(Math.PI / 2), this.mat);
    snout.position.set(0, 0.03, 0.033);
    const earG = new THREE.ConeGeometry(0.004, 0.012, 6);
    const e1 = new THREE.Mesh(earG, this.mat);
    const e2 = new THREE.Mesh(earG, this.mat);
    e1.position.set(0.006, 0.045, 0.018);
    e2.position.set(-0.006, 0.045, 0.018);
    this.tail = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 8).rotateX(-Math.PI / 2 - 0.6), this.mat);
    this.tail.position.set(0, 0.03, -0.03);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#7ff4ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(0.12);
    this.glow.position.y = 0.03;
    this.group.add(body, head, snout, e1, e2, this.tail, this.glow);
    this.hitProxy = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.y = 0.03;
    this.hitProxy.name = 'spirit-hit';
    this.group.add(this.hitProxy);
    this.group.visible = false;
  }

  get isVisible() {
    return this.group.visible && this.visibility > 0.3;
  }

  get position() {
    return this.group.getWorldPosition(new THREE.Vector3());
  }

  /** Called when the visitor touches it. */
  touch() {
    this.found = true;
    this.spin = 1.5;
    this.timer = 4;
  }

  reset() {
    this.phase = 'waiting';
    this.timer = this.firstDelay;
    this.visibility = 0;
    this.group.visible = false;
  }

  update(dt: number, t: number) {
    this.timer -= dt;
    if (this.phase === 'waiting' && this.timer <= 0) {
      this.phase = 'visible';
      this.timer = 15;
      this.group.visible = true;
      this.onAppear();
    } else if (this.phase === 'visible' && this.timer <= 0) {
      this.phase = 'leaving';
      this.timer = 2;
    } else if (this.phase === 'leaving' && this.timer <= 0) {
      this.phase = 'waiting';
      this.timer = this.found ? 70 : 40;
      this.group.visible = false;
    }
    const target = this.phase === 'visible' ? 1 : 0;
    this.visibility = damp(this.visibility, target, 2, dt);
    if (!this.group.visible) return;
    this.angle += dt * 0.45;
    const x = MEADOW.x + Math.cos(this.angle) * 0.16;
    const z = MEADOW.z - 0.04 + Math.sin(this.angle * 1.3) * 0.08;
    const y = terrainHeight(x, z) + 0.01 + Math.sin(t * 2) * 0.006;
    const dx = -Math.sin(this.angle) * 0.16;
    const dz = Math.cos(this.angle * 1.3) * 0.08 * 1.3;
    this.group.position.set(x, y, z);
    this.group.rotation.y = Math.atan2(dx, dz);
    if (this.spin > 0) {
      this.spin -= dt;
      this.group.rotation.y += (1.5 - this.spin) * 12;
    }
    this.tail.rotation.y = Math.sin(t * 5) * 0.4;
    const flick = 0.75 + Math.sin(t * 9) * 0.08;
    this.mat.opacity = this.visibility * 0.75 * flick;
    (this.glow.material as THREE.SpriteMaterial).opacity = this.visibility * 0.5;
  }
}
