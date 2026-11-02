import * as THREE from 'three';
import { StaticBatch } from '../StaticBatch';

const BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * Voxel builder: every piece is an axis-aligned box placed by its *bottom
 * centre* in a local frame (position + Y rotation). Everything lands in merged
 * vertex-coloured batches, so a whole village costs a handful of draw calls.
 */
export class Vox {
  private frame = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  constructor(
    public batch: StaticBatch,
    public glow?: StaticBatch,
  ) {}

  /** Sets the local frame used by the next calls. */
  at(x: number, y: number, z: number, ry = 0) {
    this.frame.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    return this;
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, target: StaticBatch = this.batch, jitter = 0.05) {
    this.p.set(x, y + h / 2, z);
    this.s.set(w, h, d);
    this.m.compose(this.p, this.q.identity(), this.s).premultiply(this.frame);
    target.addMatrix(BOX, color, this.m, jitter);
    return this;
  }

  /** Emissive window (goes to the glow batch when present). */
  win(x: number, y: number, z: number, w: number, h: number, d: number) {
    return this.box(x, y, z, w, h, d, '#ffffff', this.glow ?? this.batch, 0);
  }

  /** Stepped gable roof along local X (ridge on X axis). */
  roof(w: number, d: number, y: number, steps: number, stepH: number, color: THREE.ColorRepresentation, trim?: THREE.ColorRepresentation) {
    for (let i = 0; i < steps; i++) {
      const dd = d - (i * d) / steps;
      this.box(0, y + i * stepH, 0, w, stepH, dd, i % 2 && trim ? trim : color);
    }
    return this;
  }

  /** World-space point from local frame coordinates. */
  point(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.frame);
  }
}

/** Builds a group of boxes (for animated characters) — returns the mesh group. */
export function voxGroup(parts: Array<[number, number, number, number, number, number, THREE.ColorRepresentation]>, material: THREE.Material) {
  const b = new StaticBatch();
  const m = new THREE.Matrix4();
  for (const [x, y, z, w, h, d, c] of parts) {
    m.compose(new THREE.Vector3(x, y + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    b.addMatrix(BOX, c, m, 0);
  }
  const mesh = b.build(material, 'vox');
  mesh.castShadow = true;
  return mesh;
}

export interface PersonStyle {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  hat?: string;
  apron?: string;
  beard?: string;
  child?: boolean;
}

/** An original voxel villager with animatable limbs. */
export class VoxPerson {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private legL: THREE.Object3D;
  private legR: THREE.Object3D;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly hitProxy: THREE.Mesh;

  constructor(st: PersonStyle, mat: THREE.Material) {
    const k = st.child ? 0.72 : 1;
    const u = 0.008 * k; // 1 "pixel"
    this.root.add(this.body);
    const limb = (x: number, color: string, len: number, w: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, len, 0);
      const mesh = voxGroup([[0, -len, 0, w, len, w, color]], mat);
      pivot.add(mesh);
      return pivot;
    };
    this.legL = limb(-u * 1.1, st.pants, u * 4, u * 1.8);
    this.legR = limb(u * 1.1, st.pants, u * 4, u * 1.8);
    const torso: Array<[number, number, number, number, number, number, string]> = [[0, u * 4, 0, u * 4.4, u * 4.6, u * 2.6, st.shirt]];
    if (st.apron) torso.push([0, u * 4.2, u * 1.35, u * 3.6, u * 4, u * 0.3, st.apron]);
    this.body.add(this.legL, this.legR, voxGroup(torso, mat));
    this.armL = limb(-u * 2.9, st.shirt, u * 8.4, u * 1.5);
    this.armR = limb(u * 2.9, st.shirt, u * 8.4, u * 1.5);
    this.body.add(this.armL, this.armR);
    const headParts: Array<[number, number, number, number, number, number, string]> = [
      [0, 0, 0, u * 3.8, u * 3.8, u * 3.6, st.skin],
      [0, u * 3.2, -u * 0.2, u * 4.2, u * 1.2, u * 4, st.hair],
      [0, u * 1.2, -u * 1.9, u * 4.2, u * 2.6, u * 0.6, st.hair],
      [-u * 0.8, u * 1.9, u * 1.85, u * 0.6, u * 0.6, u * 0.2, '#2a1c14'],
      [u * 0.8, u * 1.9, u * 1.85, u * 0.6, u * 0.6, u * 0.2, '#2a1c14'],
    ];
    if (st.beard) headParts.push([0, 0, u * 1.75, u * 3.4, u * 1.3, u * 0.4, st.beard]);
    if (st.hat) {
      headParts.push([0, u * 3.8, 0, u * 6, u * 0.5, u * 6, st.hat]);
      headParts.push([0, u * 4.3, 0, u * 3.8, u * 1.6, u * 3.8, st.hat]);
    }
    const head = new THREE.Group();
    head.position.set(0, u * 8.6, 0);
    head.add(voxGroup(headParts, mat));
    this.head = head;
    this.body.add(head);
    this.hitProxy = new THREE.Mesh(new THREE.BoxGeometry(u * 9, u * 15, u * 9), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.y = u * 7;
    this.root.add(this.hitProxy);
  }

  /** phase in radians, amount 0..1 (0 = standing). */
  walk(phase: number, amount: number) {
    const a = Math.sin(phase) * 0.7 * amount;
    this.legL.rotation.x = a;
    this.legR.rotation.x = -a;
    this.armL.rotation.x = -a * 0.8;
    this.armR.rotation.x = a * 0.8;
    this.body.position.y = Math.abs(Math.cos(phase)) * 0.003 * amount;
  }

  /** Arm raised (waving / hammering), 0..1. */
  raiseArm(k: number, right = true) {
    (right ? this.armR : this.armL).rotation.x = -k * 2.4;
  }
}
