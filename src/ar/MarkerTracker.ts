import * as THREE from 'three';
import { AR, POS } from './vendor/aruco.js';
import { ASSUMED_LONG_SIDE_FOV } from './CameraFeed';
import { MARKER_DICTIONARY, MARKER_ID } from '../assets/marker';

export { markerSVG, MARKER_ID } from '../assets/marker';

export interface MarkerPose {
  /** Marker → camera transform in three.js camera conventions (marker size = 1 unit). */
  matrix: THREE.Matrix4;
  corners: Array<{ x: number; y: number }>;
  error: number;
}

/**
 * Real image-marker tracking (ArUco MIP 36h12, id 7) + planar POSIT pose
 * estimation, running on a downscaled copy of the camera frame.
 */
export class MarkerTracker {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private detector = new AR.Detector({ dictionaryName: MARKER_DICTIONARY });
  private posit: InstanceType<typeof POS.Posit> | null = null;
  private positKey = '';
  private prevQ: THREE.Quaternion | null = null;
  lastProcessMs = 0;

  constructor(private processWidth: number) {
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  setProcessWidth(w: number) {
    this.processWidth = w;
  }

  process(video: HTMLVideoElement): MarkerPose | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    const t0 = performance.now();
    const scale = Math.min(1, this.processWidth / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const markers = this.detector.detect(img);
    const m = markers.find((k) => k.id === MARKER_ID);
    this.lastProcessMs = performance.now() - t0;
    if (!m) return null;

    const f = Math.max(w, h) / 2 / Math.tan(((ASSUMED_LONG_SIDE_FOV / 2) * Math.PI) / 180);
    const key = `${f.toFixed(2)}`;
    if (!this.posit || this.positKey !== key) {
      this.posit = new POS.Posit(1, f);
      this.positKey = key;
    }
    const pts = m.corners.map((c) => ({ x: c.x - w / 2, y: h / 2 - c.y }));
    const pose = this.posit.pose(pts);

    const toMatrix = (R: number[][], T: number[]) =>
      new THREE.Matrix4().set(R[0][0], R[0][1], -R[0][2], T[0], R[1][0], R[1][1], -R[1][2], T[1], -R[2][0], -R[2][1], R[2][2], -T[2], 0, 0, 0, 1);

    let matrix = toMatrix(pose.bestRotation, pose.bestTranslation);
    // planar pose ambiguity: when both solutions are close, keep the one nearest to the previous pose
    if (this.prevQ && pose.alternativeError < pose.bestError * 1.8) {
      const alt = toMatrix(pose.alternativeRotation, pose.alternativeTranslation);
      const qa = new THREE.Quaternion().setFromRotationMatrix(matrix);
      const qb = new THREE.Quaternion().setFromRotationMatrix(alt);
      if (qb.angleTo(this.prevQ) < qa.angleTo(this.prevQ) - 0.05) matrix = alt;
    }
    if (matrix.elements[14] > -0.01) return null; // behind the camera: invalid
    this.prevQ = new THREE.Quaternion().setFromRotationMatrix(matrix);
    return {
      matrix,
      corners: m.corners.map((c) => ({ x: c.x / scale, y: c.y / scale })),
      error: pose.bestError,
    };
  }

  reset() {
    this.prevQ = null;
  }
}
