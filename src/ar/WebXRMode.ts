import * as THREE from 'three';
import type { ARMode, PlacementStatus } from './ARMode';
import type { Engine } from '../systems/Engine';
import type { Stage } from '../scenes/Stage';
import { Reticle } from '../effects/Reticle';
import { shared } from '../systems/SharedUniforms';

/**
 * Real surface detection with the WebXR Device API (`immersive-ar` + `hit-test`),
 * Android Chrome / compatible browsers. Uses DOM Overlay for the UI when available
 * and XR anchors when the device supports them.
 */
export class WebXRMode implements ARMode {
  readonly kind = 'webxr' as const;
  readonly label = 'Realidade aumentada · superfícies detectadas';
  readonly baseScale = 0.3;
  placing = true;
  onStatus: (s: PlacementStatus) => void = () => {};
  onPlaced: () => void = () => {};
  onEnded: () => void = () => {};

  private session: XRSession | null = null;
  private hitSource: XRHitTestSource | null = null;
  private reticle: Reticle;
  private lastHit: XRHitTestResult | null = null;
  private anchor: XRAnchor | null = null;
  private status: PlacementStatus = 'starting';
  private hasOverlay = false;
  private ending = false;

  constructor(
    private engine: Engine,
    private stage: Stage,
    private overlayRoot: HTMLElement,
  ) {
    this.reticle = new Reticle(shared.uTime);
    engine.scene.add(this.reticle.mesh);
  }

  async start() {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) throw new Error('WebXR indisponível');
    const init: XRSessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors', 'local-floor'],
      domOverlay: { root: this.overlayRoot },
    };
    const session = await xr.requestSession('immersive-ar', init);
    this.session = session;
    this.hasOverlay = !!(session as XRSession & { domOverlayState?: { type: string } }).domOverlayState;
    session.addEventListener('end', this.handleEnd);
    session.addEventListener('select', this.handleSelect);
    this.engine.renderer.xr.setReferenceSpaceType('local');
    await this.engine.renderer.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;
    if (!this.hitSource) throw new Error('hit-test indisponível');
    this.placing = true;
    this.setStatus('scanning');
  }

  /** Without DOM Overlay, taps arrive as XR "select" events. */
  private handleSelect = () => {
    if (this.hasOverlay) return;
    if (this.placing) this.handleTap();
  };

  private handleEnd = () => {
    this.hitSource?.cancel();
    this.hitSource = null;
    this.session = null;
    this.reticle.mesh.visible = false;
    this.engine.resize();
    if (!this.ending) this.onEnded();
  };

  stop() {
    this.ending = true;
    this.reticle.mesh.visible = false;
    if (this.session) void this.session.end().catch(() => undefined);
    this.engine.scene.remove(this.reticle.mesh);
  }

  private setStatus(s: PlacementStatus) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  update(_dt: number, _t: number, frame?: XRFrame) {
    if (!frame || !this.session) return;
    const ref = this.engine.renderer.xr.getReferenceSpace();
    if (!ref) return;

    if (this.anchor && frame.trackedAnchors?.has(this.anchor)) {
      const pose = frame.getPose(this.anchor.anchorSpace, ref);
      if (pose) this.applyAnchorMatrix(new THREE.Matrix4().fromArray(pose.transform.matrix), false);
    }

    if (!this.placing || !this.hitSource) {
      this.reticle.mesh.visible = false;
      return;
    }
    const hits = frame.getHitTestResults(this.hitSource);
    if (hits.length) {
      const pose = hits[0].getPose(ref);
      if (pose) {
        this.lastHit = hits[0];
        const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
        const s = this.stage.worldScale * 0.55;
        this.reticle.mesh.matrix.copy(m).multiply(new THREE.Matrix4().makeScale(s, s, s));
        this.reticle.mesh.visible = true;
        this.reticle.setFound(true);
        this.setStatus('surface');
        return;
      }
    }
    this.lastHit = null;
    this.reticle.mesh.visible = false;
    this.setStatus('scanning');
  }

  handleTap() {
    if (!this.placing) return false;
    if (!this.lastHit) return true; // consume taps while scanning
    const ref = this.engine.renderer.xr.getReferenceSpace();
    const pose = ref ? this.lastHit.getPose(ref) : null;
    const m = pose ? new THREE.Matrix4().fromArray(pose.transform.matrix) : this.reticle.mesh.matrix.clone();
    this.applyAnchorMatrix(m, true);
    // Persist the placement with a real XR anchor where supported
    try {
      const create = (this.lastHit as XRHitTestResult & { createAnchor?: () => Promise<XRAnchor> }).createAnchor;
      if (create) {
        void create
          .call(this.lastHit)
          .then((a) => {
            this.anchor?.delete();
            this.anchor = a;
          })
          .catch(() => undefined);
      }
    } catch {
      /* anchors are optional */
    }
    this.placing = false;
    this.reticle.mesh.visible = false;
    this.setStatus('placed');
    this.onPlaced();
    return true;
  }

  confirmPlacement() {
    return this.handleTap();
  }

  /** Position the stage on the surface, rotated so its front faces the viewer. */
  private applyAnchorMatrix(m: THREE.Matrix4, faceViewer: boolean) {
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    if (faceViewer) {
      const cam = this.engine.activeCamera;
      const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
      const yaw = Math.atan2(cp.x - pos.x, cp.z - pos.z);
      // keep surface normal (usually +Y for horizontal planes), set heading toward camera
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      if (up.y > 0.8) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.stage.anchor.userData.yaw = yaw;
    } else if (this.stage.anchor.userData.yaw !== undefined) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.stage.anchor.userData.yaw as number);
    }
    this.stage.anchor.position.copy(pos);
    this.stage.anchor.quaternion.copy(q);
    this.stage.anchor.scale.setScalar(1);
  }

  reposition() {
    this.anchor?.delete();
    this.anchor = null;
    this.placing = true;
    this.setStatus('scanning');
  }

  pickCamera() {
    return this.engine.activeCamera;
  }
}
