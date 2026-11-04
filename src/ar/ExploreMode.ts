import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ARMode, PlacementStatus } from './ARMode';
import type { Engine } from '../systems/Engine';
import type { Stage } from '../scenes/Stage';

/** Classic 3D mode (no camera): orbit, zoom and auto-rotate around the diorama. */
export class ExploreMode implements ARMode {
  readonly kind = 'explore' as const;
  readonly label = 'Exploração 3D';
  readonly baseScale = 1;
  readonly placing = false;
  onStatus: (s: PlacementStatus) => void = () => {};
  onPlaced: () => void = () => {};
  onEnded: () => void = () => {};
  readonly controls: OrbitControls;

  constructor(
    private engine: Engine,
    private stage: Stage,
    input: HTMLElement,
  ) {
    this.controls = new OrbitControls(engine.camera, input);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 11;
    this.controls.maxPolarAngle = 1.53;
    this.controls.minPolarAngle = 0.05;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.target.set(0, 1.0, 0);
  }

  /** Portrait screens get a wider lens and a farther start so the whole diorama fits. */
  private frame(resetPosition: boolean) {
    const cam = this.engine.camera;
    const portrait = cam.aspect < 1;
    const fov = portrait ? 58 : 42;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (resetPosition) {
      const hTan = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.min(1, cam.aspect);
      const big = this.stage.kind === 'duda' ? 2.2 : 1.25; // the valley is wider than the other islands
      const dist = THREE.MathUtils.clamp(big / hTan, 3.0, 9.5);
      cam.position.set(0, 1.0, 0).add(new THREE.Vector3(0.12, 0.33, 1).normalize().multiplyScalar(dist));
      this.controls.target.set(0, 1.0, 0);
    }
  }

  async start() {
    const cam = this.engine.camera;
    cam.near = 0.05;
    cam.far = 120;
    this.engine.resize();
    this.frame(true);
    this.stage.anchor.position.set(0, 0, 0);
    this.stage.anchor.quaternion.identity();
    this.stage.anchor.scale.setScalar(1);
    this.controls.enabled = true;
    this.controls.autoRotate = true;
    this.controls.update();
    this.onPlaced();
  }

  stop() {
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  update() {
    this.frame(false);
    this.controls.update();
  }

  handleTap() {
    return false;
  }

  reposition() {
    this.frame(true);
    this.controls.update();
  }

  rotateBy(rad: number) {
    const off = this.engine.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad);
    this.engine.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
  }

  zoomBy(f: number) {
    const off = this.engine.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() / f, this.controls.minDistance, this.controls.maxDistance);
    off.setLength(len);
    this.engine.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
  }

  pickCamera() {
    return this.engine.camera;
  }
}
