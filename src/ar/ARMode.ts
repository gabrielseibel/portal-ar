import type * as THREE from 'three';

export type ModeKind = 'webxr' | 'marker' | 'manual' | 'explore';

export type PlacementStatus =
  | 'starting'
  | 'scanning' // looking for a surface (WebXR)
  | 'surface' // a surface is under the reticle (WebXR) / reticle on assumed plane (manual)
  | 'aim-down' // manual: tilt the phone toward the table
  | 'marker-search'
  | 'marker-found'
  | 'marker-lost'
  | 'placed';

export interface ARMode {
  readonly kind: ModeKind;
  /** Human readable label shown in the UI. */
  readonly label: string;
  /** Default real-world scale of one stage unit for this mode. */
  readonly baseScale: number;
  /** True while the user still has to choose where the portal opens. */
  readonly placing: boolean;
  start(): Promise<void>;
  stop(): void;
  update(dt: number, t: number, frame?: XRFrame): void;
  /** Called on screen taps during placement; returns true if consumed. */
  handleTap(x: number, y: number): boolean;
  /** Called on one-finger drags during placement (manual aiming). Returns true if consumed. */
  handleDrag?(dx: number, dy: number, x: number, y: number): boolean;
  /** Programmatic confirm (e.g. "Abrir portal aqui" button). */
  confirmPlacement?(): boolean;
  reposition(): void;
  /** Camera used for picking & spatial audio this frame. */
  pickCamera(): THREE.PerspectiveCamera;
  onStatus: (s: PlacementStatus) => void;
  onPlaced: () => void;
  onEnded: () => void;
}
