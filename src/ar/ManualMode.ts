import * as THREE from 'three';
import type { ARMode, PlacementStatus } from './ARMode';
import type { Engine } from '../systems/Engine';
import type { Stage } from '../scenes/Stage';
import { CameraFeed } from './CameraFeed';
import { Reticle } from '../effects/Reticle';
import { shared } from '../systems/SharedUniforms';

/** Assumed distance from the phone to the table (metres) when no tracking exists. */
const FLOOR_H = 0.42;
const STATIC_PITCH = -0.62;

/**
 * Simplified placement for devices without WebXR or a marker: the camera image
 * is shown as-is and the portal is placed on an *assumed* horizontal plane.
 * If the gyroscope is available, the virtual camera follows the phone's
 * rotation (3DoF) so the world stays put when you look around. This mode never
 * claims to detect surfaces.
 */
export class ManualMode implements ARMode {
  readonly kind = 'manual' as const;
  readonly label = 'Posicionamento manual';
  readonly baseScale = 0.16;
  placing = true;
  onStatus: (s: PlacementStatus) => void = () => {};
  onPlaced: () => void = () => {};
  onEnded: () => void = () => {};

  private reticle: Reticle;
  private status: PlacementStatus = 'starting';
  private aim = new THREE.Vector2(0, -0.25);
  private gyroOn = false;
  private orientation: { alpha: number; beta: number; gamma: number } | null = null;
  private raycaster = new THREE.Raycaster();
  private floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), FLOOR_H);
  private hit = new THREE.Vector3();
  private hasHit = false;
  private q0 = new THREE.Quaternion();
  private qScreen = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  private euler = new THREE.Euler();
  private zee = new THREE.Vector3(0, 0, 1);

  constructor(
    private engine: Engine,
    private stage: Stage,
    private feed: CameraFeed,
  ) {
    this.reticle = new Reticle(shared.uTime);
    engine.scene.add(this.reticle.mesh);
  }

  get gyroscopeActive() {
    return this.gyroOn;
  }

  async start() {
    if (!this.feed.active) await this.feed.start();
    const cam = this.engine.camera;
    cam.position.set(0, 0, 0);
    cam.near = 0.02;
    cam.far = 60;
    cam.quaternion.setFromEuler(new THREE.Euler(STATIC_PITCH, 0, 0, 'YXZ'));
    this.placing = true;
    this.setStatus('surface');
    // Android exposes orientation without a prompt; iOS needs enableGyroscope() from a tap
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (DOE && typeof DOE.requestPermission !== 'function') this.listenGyro();
  }

  /** Must be called from a user gesture on iOS. */
  async enableGyroscope(): Promise<boolean> {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    try {
      if (DOE?.requestPermission) {
        const r = await DOE.requestPermission();
        if (r !== 'granted') return false;
      }
      this.listenGyro();
      return true;
    } catch {
      return false;
    }
  }

  private listenGyro() {
    window.addEventListener('deviceorientation', this.onOrient);
  }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    const first = !this.gyroOn;
    this.gyroOn = true;
    this.orientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
    if (first) this.aim.set(0, 0);
  };

  stop() {
    window.removeEventListener('deviceorientation', this.onOrient);
    this.gyroOn = false;
    this.engine.scene.remove(this.reticle.mesh);
  }

  private setStatus(s: PlacementStatus) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  private updateCamera() {
    const cam = this.engine.camera;
    const c = this.engine.canvas;
    const w = c.clientWidth || innerWidth;
    const h = c.clientHeight || innerHeight;
    const fov = this.feed.verticalFov(w, h);
    if (Math.abs(cam.fov - fov) > 0.01 || Math.abs(cam.aspect - w / h) > 0.001) {
      cam.fov = fov;
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    if (this.gyroOn && this.orientation) {
      const d = THREE.MathUtils.DEG2RAD;
      const { alpha, beta, gamma } = this.orientation;
      const orient = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number) * d;
      this.euler.set(beta * d, alpha * d, -gamma * d, 'YXZ');
      const target = new THREE.Quaternion().setFromEuler(this.euler).multiply(this.qScreen).multiply(this.q0.setFromAxisAngle(this.zee, -orient));
      cam.quaternion.slerp(target, 0.5);
    }
    cam.updateMatrixWorld();
  }

  update() {
    this.updateCamera();
    if (!this.placing) {
      this.reticle.mesh.visible = false;
      return;
    }
    const cam = this.engine.camera;
    this.raycaster.setFromCamera(this.aim, cam);
    this.hasHit = !!this.raycaster.ray.intersectPlane(this.floor, this.hit) && this.hit.distanceTo(cam.position) < 4;
    if (this.hasHit) {
      const s = this.stage.baseScale * this.stage.userScale * 0.55;
      this.reticle.mesh.matrix.compose(this.hit, new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      this.reticle.mesh.visible = true;
      this.reticle.setFound(true);
      this.setStatus('surface');
    } else {
      this.reticle.mesh.visible = false;
      this.setStatus('aim-down');
    }
  }

  handleDrag(_dx: number, _dy: number, x: number, y: number) {
    if (!this.placing || this.gyroOn) return false;
    const c = this.engine.canvas.getBoundingClientRect();
    this.aim.set(((x - c.left) / c.width) * 2 - 1, -((y - c.top) / c.height) * 2 + 1);
    return true;
  }

  handleTap(x: number, y: number) {
    if (!this.placing) return false;
    if (!this.gyroOn) {
      this.handleDrag(0, 0, x, y);
      this.update();
    }
    return this.confirmPlacement();
  }

  confirmPlacement() {
    if (!this.placing || !this.hasHit) return true;
    const cam = this.engine.camera;
    const yaw = Math.atan2(cam.position.x - this.hit.x, cam.position.z - this.hit.z);
    this.stage.anchor.position.copy(this.hit);
    this.stage.anchor.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.stage.anchor.scale.setScalar(1);
    this.placing = false;
    this.reticle.mesh.visible = false;
    this.setStatus('placed');
    this.onPlaced();
    return true;
  }

  reposition() {
    this.placing = true;
    if (!this.gyroOn) this.aim.set(0, -0.25);
    this.setStatus('surface');
  }

  pickCamera() {
    return this.engine.camera;
  }
}
