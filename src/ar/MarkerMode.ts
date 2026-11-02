import * as THREE from 'three';
import type { ARMode, PlacementStatus } from './ARMode';
import type { Engine } from '../systems/Engine';
import type { Stage } from '../scenes/Stage';
import { CameraFeed } from './CameraFeed';
import { MarkerTracker } from './MarkerTracker';

const MARKER_TO_STAGE = new THREE.Matrix4().makeRotationX(Math.PI / 2);

/**
 * Fallback for devices without WebXR: the printed PORTAL marker is tracked in
 * the camera image (6DoF pose), and the world is anchored on top of it.
 */
export class MarkerMode implements ARMode {
  readonly kind = 'marker' as const;
  readonly label = 'Marcador impresso · rastreamento por imagem';
  /** One stage unit expressed in marker widths. */
  readonly baseScale = 0.8;
  placing = true;
  onStatus: (s: PlacementStatus) => void = () => {};
  onPlaced: () => void = () => {};
  onEnded: () => void = () => {};

  private tracker: MarkerTracker;
  private status: PlacementStatus = 'starting';
  private stableFrames = 0;
  private lostFor = 0;
  private hasPose = false;
  private frameToggle = false;
  private target = new THREE.Matrix4();
  private tPos = new THREE.Vector3();
  private tQuat = new THREE.Quaternion();
  private tScale = new THREE.Vector3();

  constructor(
    private engine: Engine,
    private stage: Stage,
    private feed: CameraFeed,
    processWidth: number,
  ) {
    this.tracker = new MarkerTracker(processWidth);
  }

  async start() {
    if (!this.feed.active) await this.feed.start();
    this.engine.camera.position.set(0, 0, 0);
    this.engine.camera.quaternion.identity();
    this.engine.camera.near = 0.05;
    this.engine.camera.far = 400;
    this.updateFov();
    this.stage.anchor.visible = false;
    this.placing = true;
    this.setStatus('marker-search');
  }

  /** The camera feed is owned by the Experience (it survives switching between camera modes). */
  stop() {
    this.tracker.reset();
  }

  private updateFov() {
    const c = this.engine.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    const fov = this.feed.verticalFov(w, h);
    if (Math.abs(this.engine.camera.fov - fov) > 0.01 || Math.abs(this.engine.camera.aspect - w / h) > 0.001) {
      this.engine.camera.fov = fov;
      this.engine.camera.aspect = w / h;
      this.engine.camera.updateProjectionMatrix();
    }
  }

  private setStatus(s: PlacementStatus) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  update(dt: number) {
    this.updateFov();
    // keep the UI thread fluid: skip every other frame when detection is expensive
    this.frameToggle = !this.frameToggle;
    const pose = this.tracker.lastProcessMs > 14 && this.frameToggle ? undefined : this.tracker.process(this.feed.video);
    if (pose === undefined) {
      this.smooth(dt);
      return;
    }
    if (pose) {
      this.lostFor = 0;
      this.target.multiplyMatrices(pose.matrix, MARKER_TO_STAGE);
      if (!this.hasPose) {
        this.target.decompose(this.stage.anchor.position, this.stage.anchor.quaternion, this.stage.anchor.scale);
        this.hasPose = true;
      }
      if (this.placing) {
        this.stableFrames++;
        this.stage.anchor.visible = true;
        this.setStatus('marker-found');
        if (this.stableFrames > 8) {
          this.placing = false;
          this.setStatus('placed');
          this.onPlaced();
        }
      } else this.setStatus('placed');
    } else {
      this.stableFrames = Math.max(0, this.stableFrames - 2);
      this.lostFor += dt * (this.frameToggle ? 1 : 2);
      if (this.placing && this.lostFor > 0.4) this.setStatus('marker-search');
      if (!this.placing && this.lostFor > 0.7) this.setStatus('marker-lost');
    }
    this.smooth(dt);
  }

  /** Low-pass filter on the pose: removes jitter while staying responsive. */
  private smooth(dt: number) {
    if (!this.hasPose) return;
    this.target.decompose(this.tPos, this.tQuat, this.tScale);
    const a = this.stage.anchor;
    const jump = a.position.distanceTo(this.tPos) > 0.8 * Math.max(1, this.tPos.length() * 0.1);
    const k = jump ? 1 : 1 - Math.exp(-dt * 18);
    a.position.lerp(this.tPos, k);
    a.quaternion.slerp(this.tQuat, jump ? 1 : 1 - Math.exp(-dt * 14));
    a.scale.setScalar(1);
  }

  handleTap() {
    return this.placing; // taps do nothing until the marker is found
  }

  reposition() {
    this.placing = true;
    this.stableFrames = 0;
    this.hasPose = false;
    this.tracker.reset();
    this.stage.anchor.visible = false;
    this.setStatus('marker-search');
  }

  pickCamera() {
    return this.engine.camera;
  }
}
