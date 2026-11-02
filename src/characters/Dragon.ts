import * as THREE from 'three';
import { clamp, damp, dampAngle, easeInOutCubic, lerp, smoothstep } from '../utils/math';
import type { ParticlePool } from '../effects/ParticlePool';
import { bakeRigidParts } from '../utils/merge';

export interface DragonPalette {
  body: string;
  belly: string;
  wing: string;
  horn: string;
  iris: string;
  spikes: string;
}

export const DRAGON_TEAL: DragonPalette = { body: '#4aa38e', belly: '#f2dbab', wing: '#ee8f6f', horn: '#f4e4bd', iris: '#3a2a55', spikes: '#f0b85a' };
export const DRAGON_PLUM: DragonPalette = { body: '#8a6fc4', belly: '#f7e2c4', wing: '#7fd6c8', horn: '#fff1d2', iris: '#2a2240', spikes: '#ffd27a' };

type State = 'hidden' | 'emerging' | 'idle' | 'flying';

interface Flight {
  curve: THREE.CatmullRomCurve3;
  duration: number;
  t: number;
  onDone?: () => void;
}

/**
 * A small, expressive, fully procedural dragon.
 * Hierarchy: root (yaw/position) → body (breathing) → neck/head, wings, tail chain, legs.
 * All geometry is built from primitives so it ships with zero external assets.
 */
export class Dragon {
  readonly root = new THREE.Group();
  readonly hitProxy: THREE.Mesh;
  /** World-space-independent anchor at the mouth, used to emit flames. */
  readonly mouth = new THREE.Object3D();

  private body = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private eyes: THREE.Group[] = [];
  private pupils: THREE.Object3D[] = [];
  private wings: THREE.Group[] = [];
  private tail: THREE.Group[] = [];
  private legs: THREE.Group[] = [];

  private state: State = 'hidden';
  private home = new THREE.Vector3();
  private homeYaw = 0;
  private yaw = 0;
  private lookTarget = new THREE.Vector3(0, 0.3, 2);
  private lookAtCamera = 0;
  private headYaw = 0;
  private headPitch = 0;
  private nextGlance = 2;
  private glanceAtCamera = true;
  private nextBlink = 2.5;
  private blink = 0;
  private flap = 0; // 0 folded .. 1 spread
  private flapSpeed = 0;
  private flapPhase = 0;
  private jawOpen = 0;
  private fireTime = 0;
  private reactTime = 0;
  private squash = 0;
  private hopT = -1;
  private stretchT = -1;
  private flight: Flight | null = null;
  private idleTimer = 0;
  private nextFlight = 28;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  canFly = true;
  /** Fired at start of a flame breath (for audio). */
  onFlame: () => void = () => {};
  onWingBeat: () => void = () => {};
  onLand: () => void = () => {};

  constructor(palette: DragonPalette = DRAGON_TEAL, private fire?: ParticlePool, private fireSpace?: THREE.Object3D) {
    this.root.name = 'dragon';
    this.build(palette);
    // one draw call per rigid body part instead of one per primitive
    bakeRigidParts(this.root, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 }));
    this.hitProxy = new THREE.Mesh(new THREE.SphereGeometry(1.25, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.set(0, 0.95, 0.15);
    this.hitProxy.name = 'dragon-hit';
    this.root.add(this.hitProxy);
    this.root.visible = false;
  }

  // ------------------------------------------------------------------ build
  private build(p: DragonPalette) {
    const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...extra });
    const bodyMat = std(p.body, { roughness: 0.5 });
    const bellyMat = std(p.belly, { roughness: 0.65 });
    const wingMat = std(p.wing, { side: THREE.DoubleSide, roughness: 0.6, emissive: new THREE.Color(p.wing), emissiveIntensity: 0.12 });
    const hornMat = std(p.horn, { roughness: 0.4 });
    const spikeMat = std(p.spikes, { roughness: 0.4, emissive: new THREE.Color(p.spikes), emissiveIntensity: 0.15 });
    const white = new THREE.MeshStandardMaterial({ color: '#fbfbf7', roughness: 0.25 });
    const iris = new THREE.MeshStandardMaterial({ color: p.iris, roughness: 0.2, emissive: new THREE.Color(p.iris), emissiveIntensity: 0.25 });
    const black = new THREE.MeshStandardMaterial({ color: '#0b0a10', roughness: 0.15 });
    const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const blush = new THREE.MeshBasicMaterial({ color: '#ff8fa3', transparent: true, opacity: 0.45, depthWrite: false });
    const mouthMat = new THREE.MeshStandardMaterial({ color: '#7a2433', roughness: 0.7 });
    const sphere = (r: number, w = 18, h = 14) => new THREE.SphereGeometry(r, w, h);

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...pos);
      m.scale.set(...scale);
      m.rotation.set(...rot);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.body);
    // torso
    add(this.body, sphere(0.5, 22, 16), bodyMat, [0, 0.62, 0], [0.86, 0.8, 1.06]);
    add(this.body, sphere(0.42, 18, 14), bellyMat, [0, 0.54, 0.16], [0.76, 0.74, 0.86]);
    // back spikes
    const spike = new THREE.ConeGeometry(0.06, 0.16, 6);
    for (let i = 0; i < 4; i++) add(this.body, spike, spikeMat, [0, 1.02 - i * 0.05, 0.18 - i * 0.2], [1, 1, 1], [-0.5 - i * 0.15, 0, 0]);

    // legs
    const legGeo = sphere(0.17, 12, 10);
    const footGeo = sphere(0.12, 12, 8);
    const clawGeo = new THREE.ConeGeometry(0.025, 0.07, 5);
    for (const [x, z, s] of [
      [0.27, 0.32, 0.85],
      [-0.27, 0.32, 0.85],
      [0.32, -0.25, 1.1],
      [-0.32, -0.25, 1.1],
    ]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.32, z);
      add(leg, legGeo, bodyMat, [0, 0, 0], [s, s * 1.15, s]);
      add(leg, footGeo, bodyMat, [0, -0.24, 0.05], [s, s * 0.55, s * 1.25]);
      for (let c = -1; c <= 1; c++) add(leg, clawGeo, hornMat, [c * 0.05 * s, -0.27, 0.17 * s], [1, 1, 1], [Math.PI / 2, 0, 0]);
      this.body.add(leg);
      this.legs.push(leg);
    }

    // tail chain
    let parent: THREE.Object3D = this.body;
    let r = 0.2;
    const tailStart = new THREE.Group();
    tailStart.position.set(0, 0.5, -0.42);
    this.body.add(tailStart);
    parent = tailStart;
    for (let i = 0; i < 7; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0 : 0.02, i === 0 ? 0 : -r * 1.15);
      add(seg, sphere(r, 12, 10), bodyMat, [0, 0, -r * 0.5], [1, 0.9, 1.4]);
      if (i % 2 === 0 && i < 6) add(seg, spike, spikeMat, [0, r * 0.85, -r * 0.4], [0.7, 0.7, 0.7], [-0.9, 0, 0]);
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
      r *= 0.8;
    }
    // spade tip
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), spikeMat);
    tip.scale.set(1.1, 0.35, 1.4);
    tip.position.set(0, 0.0, -0.2);
    parent.add(tip);

    // neck + head
    this.neck.position.set(0, 0.88, 0.36);
    this.body.add(this.neck);
    add(this.neck, sphere(0.25, 14, 12), bodyMat, [0, 0.08, 0.04], [1, 1.1, 1]);
    add(this.neck, sphere(0.21, 14, 12), bellyMat, [0, 0.06, 0.12], [0.9, 1, 0.8]);
    this.head.position.set(0, 0.36, 0.1);
    this.neck.add(this.head);
    add(this.head, sphere(0.4, 24, 18), bodyMat, [0, 0.12, 0.08], [1.04, 0.92, 1]);
    add(this.head, sphere(0.25, 18, 14), bodyMat, [0, 0.0, 0.4], [1.02, 0.72, 1.05]);
    // nostrils
    for (const s of [-1, 1]) add(this.head, sphere(0.03, 8, 6), black, [s * 0.09, 0.07, 0.64], [1, 0.6, 1]);
    // jaw (opens for roar & fire)
    this.jaw.position.set(0, -0.06, 0.22);
    this.head.add(this.jaw);
    add(this.jaw, sphere(0.2, 16, 10), bellyMat, [0, -0.04, 0.16], [1.02, 0.42, 1.1]);
    add(this.head, sphere(0.16, 12, 8), mouthMat, [0, -0.04, 0.4], [1, 0.4, 0.9]);
    this.mouth.position.set(0, -0.02, 0.66);
    this.head.add(this.mouth);
    // eyes
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.19, 0.22, 0.33);
      eye.rotation.y = s * 0.38;
      add(eye, sphere(0.14, 18, 14), white, [0, 0, 0], [1, 1.12, 0.8]);
      const pupilGroup = new THREE.Group();
      eye.add(pupilGroup);
      add(pupilGroup, sphere(0.1, 16, 12), iris, [0, -0.005, 0.06], [1, 1.15, 0.6]);
      add(pupilGroup, sphere(0.062, 14, 10), black, [0, -0.005, 0.1], [1, 1.2, 0.5]);
      add(pupilGroup, sphere(0.026, 8, 6), shine, [s * -0.03, 0.045, 0.13]);
      add(pupilGroup, sphere(0.012, 6, 4), shine, [s * 0.025, -0.035, 0.13]);
      this.head.add(eye);
      this.eyes.push(eye);
      this.pupils.push(pupilGroup);
      // cheeks
      add(this.head, sphere(0.07, 10, 8), blush, [s * 0.3, 0.02, 0.33], [1, 0.55, 0.5], [0, s * 0.6, 0]);
    }
    // horns & ear fins
    const horn = new THREE.ConeGeometry(0.055, 0.3, 8);
    for (const s of [-1, 1]) {
      add(this.head, horn, hornMat, [s * 0.16, 0.46, -0.04], [1, 1, 1], [-0.6, 0, s * -0.25]);
      add(this.head, new THREE.ConeGeometry(0.09, 0.22, 4), wingMat, [s * 0.36, 0.2, -0.04], [0.35, 1, 1], [-0.3, 0, s * -1.2]);
    }

    // wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(0.35, -0.12);
    wingShape.lineTo(0.62, 0.02);
    wingShape.lineTo(0.98, 0.12);
    wingShape.quadraticCurveTo(0.84, 0.24, 0.78, 0.38);
    wingShape.quadraticCurveTo(0.68, 0.26, 0.6, 0.34);
    wingShape.quadraticCurveTo(0.52, 0.5, 0.46, 0.6);
    wingShape.quadraticCurveTo(0.36, 0.42, 0.28, 0.48);
    wingShape.quadraticCurveTo(0.18, 0.56, 0.1, 0.5);
    wingShape.quadraticCurveTo(0.05, 0.3, 0, 0.22);
    const wingGeo = new THREE.ShapeGeometry(wingShape, 6);
    wingGeo.rotateX(-Math.PI / 2);
    const boneGeo = new THREE.CylinderGeometry(0.028, 0.02, 1, 6);
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.3, 0.98, 0.05);
      const inner = new THREE.Group();
      inner.scale.set(s, 1, 1);
      pivot.add(inner);
      const membrane = new THREE.Mesh(wingGeo, wingMat);
      membrane.castShadow = true;
      inner.add(membrane);
      // leading-edge bones
      const b1 = new THREE.Mesh(boneGeo, bodyMat);
      b1.scale.set(1, 0.37, 1);
      b1.position.set(0.175, 0, 0.06);
      b1.rotation.set(0, 0, Math.PI / 2 + 0.33);
      b1.rotation.order = 'YXZ';
      b1.rotation.y = -0.33;
      const b2 = new THREE.Mesh(boneGeo, bodyMat);
      b2.scale.set(0.8, 0.66, 0.8);
      b2.position.set(0.66, 0, -0.03);
      b2.rotation.set(0, 0.2, Math.PI / 2);
      b2.rotation.order = 'YXZ';
      b2.rotation.y = 0.27;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 5), hornMat);
      claw.position.set(0.62, 0.02, 0.02);
      inner.add(b1, b2, claw);
      this.body.add(pivot);
      this.wings.push(pivot);
    }
  }

  // ---------------------------------------------------------------- control
  setHome(pos: THREE.Vector3, yaw: number) {
    this.home.copy(pos);
    this.homeYaw = yaw;
    if (this.state === 'idle') {
      this.root.position.copy(pos);
      this.yaw = yaw;
    }
  }

  get isVisible() {
    return this.root.visible;
  }

  get isFlying() {
    return this.state === 'flying' || this.state === 'emerging';
  }

  hide() {
    this.state = 'hidden';
    this.root.visible = false;
    this.flight = null;
  }

  /** Appear at home immediately (used when restoring a session). */
  showAtHome() {
    this.state = 'idle';
    this.root.visible = true;
    this.root.position.copy(this.home);
    this.yaw = this.homeYaw;
    this.flap = 0;
  }

  /** Burst out of the portal, loop once and land on the perch. */
  emerge(from: THREE.Vector3, onDone?: () => void) {
    this.root.visible = true;
    this.state = 'emerging';
    const h = this.home;
    const pts = [
      from.clone().setY(from.y - 0.1),
      from.clone().setY(from.y + 0.7),
      new THREE.Vector3(from.x + 0.55, from.y + 1.35, from.z + 0.45),
      new THREE.Vector3(h.x + 0.5, h.y + 0.95, h.z - 0.3),
      new THREE.Vector3(h.x + 0.15, h.y + 0.35, h.z + 0.05),
      h.clone(),
    ];
    this.startFlight(pts, 4.2, onDone);
  }

  private startFlight(pts: THREE.Vector3[], duration: number, onDone?: () => void) {
    this.flight = { curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), duration, t: 0, onDone };
    this.flapSpeed = 1;
  }

  /** Take off, circle the floating island and come back. */
  takeFlight(islandCenter: THREE.Vector3, radius: number) {
    if (!this.canFly || this.state !== 'idle') return;
    this.state = 'flying';
    const h = this.home;
    const pts = [h.clone(), h.clone().add(new THREE.Vector3(0, 0.45, 0.05))];
    const start = Math.atan2(h.z - islandCenter.z, h.x - islandCenter.x);
    for (let i = 1; i <= 7; i++) {
      const a = start - (i / 7) * Math.PI * 2;
      pts.push(new THREE.Vector3(islandCenter.x + Math.cos(a) * radius, islandCenter.y + 0.55 + Math.sin(i * 1.3) * 0.18, islandCenter.z + Math.sin(a) * radius));
    }
    pts.push(h.clone().add(new THREE.Vector3(0.25, 0.4, -0.1)), h.clone());
    this.startFlight(pts, 13, undefined);
  }

  /** Touch reaction: look at the viewer, flap, roar and breathe a little flame. */
  react() {
    if (this.state === 'hidden') return;
    this.reactTime = 2.4;
    this.lookAtCamera = 1;
    this.idleTimer = 0;
    if (this.state === 'idle') {
      this.hopT = 0;
      this.flapSpeed = 1;
    }
    this.fireTime = 1.25;
    this.onFlame();
  }

  breatheFire(duration = 1) {
    this.fireTime = duration;
    this.onFlame();
  }

  // ----------------------------------------------------------------- update
  update(dt: number, t: number, cameraWorld: THREE.Vector3, islandCenter: THREE.Vector3) {
    if (this.state === 'hidden') return;
    this.idleTimer += dt;

    // ---- locomotion ----
    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const u = easeInOutCubic(clamp(f.t));
      const pos = f.curve.getPointAt(u, this.tmpV);
      this.root.position.copy(pos);
      const tan = f.curve.getTangentAt(clamp(u + 0.001, 0, 1), this.tmpV2);
      const targetYaw = Math.atan2(tan.x, tan.z);
      const turn = (targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      this.yaw = dampAngle(this.yaw, targetYaw, 6, dt);
      this.body.rotation.z = damp(this.body.rotation.z, clamp(-turn * 1.5, -0.6, 0.6), 4, dt);
      this.body.rotation.x = damp(this.body.rotation.x, clamp(-tan.y * 0.8, -0.5, 0.5), 4, dt);
      const nearEnd = f.t > 0.86;
      this.flapSpeed = nearEnd ? 1.6 : 1;
      this.flap = damp(this.flap, 1, 6, dt);
      if (f.t >= 1) {
        this.flight = null;
        this.state = 'idle';
        this.squash = 1;
        this.root.position.copy(this.home);
        this.flapSpeed = 0;
        this.nextFlight = 30 + Math.random() * 25;
        this.idleTimer = 0;
        this.onLand();
        f.onDone?.();
      }
    } else {
      this.body.rotation.z = damp(this.body.rotation.z, 0, 5, dt);
      this.body.rotation.x = damp(this.body.rotation.x, 0, 5, dt);
      // face toward the viewer when reacting, otherwise home orientation
      let targetYaw = this.homeYaw;
      if (this.reactTime > 0) {
        this.tmpV.copy(cameraWorld);
        this.root.parent?.worldToLocal(this.tmpV);
        targetYaw = Math.atan2(this.tmpV.x - this.root.position.x, this.tmpV.z - this.root.position.z);
      }
      this.yaw = dampAngle(this.yaw, targetYaw, 3, dt);
      // hop
      let hop = 0;
      if (this.hopT >= 0) {
        this.hopT += dt;
        hop = Math.sin(clamp(this.hopT / 0.45) * Math.PI) * 0.18;
        if (this.hopT > 0.45) {
          this.hopT = -1;
          this.squash = 0.7;
        }
      }
      this.root.position.set(this.home.x, this.home.y + hop * this.root.scale.y, this.home.z);
      // wings: spread while reacting or stretching, else folded
      let spread = this.reactTime > 0.6 ? 1 : 0;
      if (this.stretchT >= 0) {
        this.stretchT += dt;
        spread = smoothstep(0, 0.4, this.stretchT) * (1 - smoothstep(1.6, 2.2, this.stretchT));
        if (this.stretchT > 2.3) this.stretchT = -1;
      }
      this.flap = damp(this.flap, spread, 5, dt);
      if (this.reactTime <= 0.6) this.flapSpeed = damp(this.flapSpeed, 0, 3, dt);

      // occasional idle flourishes
      if (this.idleTimer > 4 && this.stretchT < 0 && Math.random() < dt * 0.06) this.stretchT = 0;
      if (this.idleTimer > 3 && Math.random() < dt * 0.04) this.hopT = this.hopT < 0 ? 0 : this.hopT;
      if (this.canFly && this.state === 'idle' && this.idleTimer > this.nextFlight) this.takeFlight(islandCenter, 1.55);
    }
    this.root.rotation.y = this.yaw;

    // ---- breathing & squash ----
    this.squash = damp(this.squash, 0, 7, dt);
    const breath = Math.sin(t * 2.1) * 0.035;
    this.body.scale.set(1 + breath * 0.5 + this.squash * 0.12, 1 + breath - this.squash * 0.16, 1 + breath * 0.3);

    // ---- wings ----
    this.flapPhase += dt * (6 + this.flapSpeed * 9) * (this.flapSpeed > 0.05 ? 1 : 0.2);
    const beat = Math.sin(this.flapPhase);
    if (this.flapSpeed > 0.3 && beat > 0.98 && Math.random() < 0.5) this.onWingBeat();
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const w = this.wings[i];
      const fold = 1 - this.flap;
      const flapAmt = this.flap * (0.25 + this.flapSpeed * 0.65) * beat;
      w.rotation.order = 'YZX';
      w.rotation.y = s * (-0.95 * fold - 0.1);
      w.rotation.z = s * (0.85 * fold + 0.15 + flapAmt);
      w.rotation.x = -0.25 * fold;
      const sc = lerp(0.78, 1, this.flap);
      w.scale.setScalar(sc);
    }

    // ---- tail ----
    const wag = this.reactTime > 0 ? 2.2 : 1;
    for (let i = 0; i < this.tail.length; i++) {
      const seg = this.tail[i];
      seg.rotation.y = Math.sin(t * 2 * wag - i * 0.65) * (0.12 + i * 0.03) * wag;
      seg.rotation.x = (this.flight ? 0.05 : -0.18) + Math.sin(t * 1.3 - i * 0.5) * 0.04;
    }

    // ---- head look ----
    this.reactTime = Math.max(0, this.reactTime - dt);
    if (this.reactTime <= 0) this.lookAtCamera = damp(this.lookAtCamera, 0, 1.5, dt);
    this.nextGlance -= dt;
    if (this.nextGlance <= 0) {
      this.nextGlance = 1.8 + Math.random() * 3;
      this.glanceAtCamera = Math.random() < 0.35;
      this.lookTarget.set(-1 + Math.random() * 2, 0.4 + Math.random() * 1.2, 1 + Math.random() * 1.2);
    }
    let target: THREE.Vector3;
    const lookCam = this.lookAtCamera > 0.5 || this.glanceAtCamera;
    if (lookCam) {
      target = this.tmpV.copy(cameraWorld);
      this.root.worldToLocal(target);
    } else target = this.tmpV.copy(this.lookTarget);
    const neckBase = this.tmpV2.set(0, 1.3, 0.5);
    const dx = target.x - neckBase.x;
    const dy = target.y - neckBase.y;
    const dz = target.z - neckBase.z;
    const yawT = clamp(Math.atan2(dx, dz), -1.1, 1.1);
    const pitchT = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.7, 0.5);
    this.headYaw = damp(this.headYaw, this.flight ? 0 : yawT, this.lookAtCamera > 0.5 ? 8 : 3, dt);
    this.headPitch = damp(this.headPitch, this.flight ? 0.15 : pitchT, 4, dt);
    this.neck.rotation.set(this.headPitch * 0.4 - 0.12, this.headYaw * 0.4, 0);
    this.head.rotation.set(this.headPitch * 0.6 + Math.sin(t * 2.1) * 0.03, this.headYaw * 0.6, Math.sin(t * 0.7) * 0.05);
    // pupils follow a bit further than the head
    for (const p of this.pupils) {
      p.rotation.y = clamp(yawT - this.headYaw, -0.4, 0.4) * 0.6;
      p.rotation.x = clamp(pitchT - this.headPitch, -0.3, 0.3) * 0.6;
    }

    // ---- blink ----
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 1;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lid = 1 - Math.sin(this.blink * Math.PI) * 0.92;
    for (const e of this.eyes) e.scale.y = lid;

    // ---- jaw & fire ----
    const firing = this.fireTime > 0;
    this.fireTime = Math.max(0, this.fireTime - dt);
    const roar = this.reactTime > 1.8 ? 1 : 0;
    this.jawOpen = damp(this.jawOpen, firing || roar ? 0.55 : 0, 10, dt);
    this.jaw.rotation.x = this.jawOpen;
    if (firing && this.fire && this.fireSpace) this.emitFire(dt);
  }

  private emitFire(dt: number) {
    const pool = this.fire!;
    const space = this.fireSpace!;
    const origin = this.mouth.getWorldPosition(this.tmpV);
    space.worldToLocal(origin);
    this.mouth.getWorldQuaternion(this.tmpQ);
    const dir = this.tmpV2.set(0, -0.12, 1).applyQuaternion(this.tmpQ);
    // convert direction into the particle space
    const sq = space.getWorldQuaternion(new THREE.Quaternion()).invert();
    dir.applyQuaternion(sq).normalize();
    const scale = this.root.scale.x;
    const n = Math.ceil(dt * 110);
    for (let i = 0; i < n; i++) {
      const sp = (0.9 + Math.random() * 0.5) * scale * 3.2;
      pool.emit(
        origin,
        { x: dir.x * sp + (Math.random() - 0.5) * 0.25 * scale * 3, y: dir.y * sp + (Math.random() - 0.3) * 0.25 * scale * 3, z: dir.z * sp + (Math.random() - 0.5) * 0.25 * scale * 3 },
        {
          life: 0.38 + Math.random() * 0.25,
          size: 0.035 * scale * 3.2,
          sizeEnd: 0.11 * scale * 3.2,
          color: Math.random() < 0.3 ? '#fff6cf' : '#ffc14d',
          colorEnd: '#c2361b',
          gravity: -0.5 * scale * 3,
          drag: 2.4,
        },
      );
    }
  }

  /** Little bounce used by the hidden baby dragon. */
  bounce() {
    this.hopT = 0;
  }

  /** Squash/stretch pop when it appears or is discovered. */
  pop() {
    this.squash = -0.6;
  }
}
