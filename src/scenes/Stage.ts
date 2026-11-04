import * as THREE from 'three';
import type { QualitySettings } from '../systems/Quality';
import { Portal } from '../effects/Portal';
import { World } from '../world/World';
import { FarmWorld } from '../world/farm/FarmWorld';
import { DudaWorld } from '../world/duda/DudaWorld';
import { Dragon, DRAGON_TEAL } from '../characters/Dragon';
import { Birds } from '../characters/Birds';
import { Sky } from '../world/Sky';
import { ParticlePool } from '../effects/ParticlePool';
import { crystalGeometry } from '../world/Crystals';
import { ISLAND_Y, PERCH, PORTAL_R } from '../world/layout';
import { C } from '../world/palette';
import { clamp, damp, easeOutCubic, easeInOutCubic, lerp, smoothstep } from '../utils/math';
import { POINT_SIZE_GLSL, shared } from '../systems/SharedUniforms';
import { glowTexture } from '../utils/textures';

export type StagePhase = 'hidden' | 'opening' | 'open';
export type Environment = 'ar' | 'explore';
export type WorldKind = 'fantasia' | 'vila' | 'duda';

const RISE_START = 1.9;
const RISE_DUR = 2.6;
const FLASH_AT = 2.75;
const DRAGON_AT = 4.0;
const REVEALED_AT = 4.6;

/**
 * Everything that lives "inside the portal": the portal itself, the floating
 * island, the dragon, the sky. `anchor` is positioned by the active AR mode;
 * `root` carries the user's rotation / scale adjustments.
 */
export class Stage {
  readonly anchor = new THREE.Group();
  readonly root = new THREE.Group();
  readonly portal: Portal;
  readonly world: World | FarmWorld | DudaWorld;
  readonly kind: WorldKind;
  readonly hasDragon: boolean;
  readonly dragon: Dragon;
  readonly birds: Birds;
  readonly sky: Sky;
  readonly bursts: ParticlePool;
  readonly fire: ParticlePool;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly portalLight: THREE.PointLight;
  readonly islandCenter = new THREE.Vector3(0, ISLAND_Y + 0.25, 0);
  private shadowCatcher: THREE.Mesh;
  private exploreSet = new THREE.Group();
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private clipActive = true;
  private tmp = new THREE.Vector3();
  private quality: QualitySettings;

  phase: StagePhase = 'hidden';
  private seqT = 0;
  private flashed = false;
  private dragonOut = false;
  private revealed = false;
  private seqRunning = false;

  baseScale = 1;
  /** Extra height of the island above its normal place (stage units, user adjustable). */
  islandLift = 0;
  userScale = 1;
  userYaw = 0;
  readonly userOffset = new THREE.Vector3();

  onFlash: () => void = () => {};
  onRiseStart: () => void = () => {};
  onRevealed: () => void = () => {};
  onDragonLanded: () => void = () => {};

  constructor(scene: THREE.Scene, q: QualitySettings, kind: WorldKind = 'fantasia') {
    this.quality = q;
    this.kind = kind;
    this.hasDragon = kind === 'fantasia';
    this.anchor.name = 'anchor';
    this.root.name = 'stage';
    this.anchor.add(this.root);
    scene.add(this.anchor);

    // lights live inside the stage so they follow placement
    this.hemi = new THREE.HemisphereLight('#e4ecff', '#6a5848', 1.25);
    this.sun = new THREE.DirectionalLight('#ffe3bd', 2.6);
    this.sun.position.set(2.2, 4.2, 2.6);
    this.sun.target.position.set(0, ISLAND_Y * 0.7, 0);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.portalLight = new THREE.PointLight('#6ff0dc', 0, 0, 0);
    this.portalLight.position.set(0, 0.35, 0);
    this.root.add(this.hemi, this.sun, this.sun.target, this.portalLight);

    this.bursts = new ParticlePool(Math.round(420 * Math.max(0.5, q.particles)));
    this.fire = new ParticlePool(Math.round(260 * Math.max(0.6, q.particles)));
    this.root.add(this.bursts.points, this.fire.points);

    this.portal = new Portal(q.particles);
    this.root.add(this.portal.group);

    this.world = kind === 'vila' ? new FarmWorld(q) : kind === 'duda' ? new DudaWorld(q) : new World(q, this.fire, this.root);
    this.world.group.position.y = ISLAND_Y;
    this.root.add(this.world.group);

    this.sky = new Sky(ISLAND_Y, q.level === 'economico' ? 4 : 6);
    this.birds = new Birds(ISLAND_Y, q.level === 'economico' ? 5 : 8);
    this.root.add(this.sky.group, this.birds.group);

    // dragon + perch rock on the real surface next to the ring
    this.dragon = new Dragon(DRAGON_TEAL, this.fire, this.root);
    this.dragon.root.scale.setScalar(0.2);
    if (this.hasDragon) this.root.add(this.buildPerch(), this.dragon.root);
    const perchTop = new THREE.Vector3(PERCH.x, 0.085, PERCH.z);
    this.dragon.setHome(perchTop, Math.atan2(-PERCH.x * 0.4, 1));

    // AR: transparent plane that only receives shadows on the real table
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.32, color: '#1a1020' }));
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = 0.001;
    this.shadowCatcher.receiveShadow = true;
    this.root.add(this.shadowCatcher);

    this.buildExploreSet();
    this.root.add(this.exploreSet);

    // island + dragon rise *through* the portal: clip everything below the surface
    const clip = [this.clipPlane];
    const applyClip = () => {
      for (const m of [...this.world.materials(), ...materialsOf(this.dragon.root)]) m.clippingPlanes = clip;
    };
    applyClip();
    // the Fazenda da Duda loads its models asynchronously
    if (this.world instanceof DudaWorld) void this.world.ready.then(applyClip);

    this.hideAll();
    this.applyTransform();
  }

  private buildPerch() {
    const g = new THREE.Group();
    g.position.set(PERCH.x, 0, PERCH.z);
    const rockMat = new THREE.MeshStandardMaterial({ color: C.rock, flatShading: true, roughness: 0.95 });
    const mossMat = new THREE.MeshStandardMaterial({ color: C.moss, flatShading: true, roughness: 1 });
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), rockMat);
    rock.scale.set(1.35, 0.55, 1.15);
    rock.position.y = 0.035;
    rock.castShadow = rock.receiveShadow = true;
    const moss = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), mossMat);
    moss.scale.set(1.25, 0.32, 1.05);
    moss.position.y = 0.068;
    const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.045, 0), rockMat);
    small.position.set(0.12, 0.015, 0.06);
    small.castShadow = true;
    g.add(rock, moss, small);
    const cg = crystalGeometry();
    const cm = new THREE.MeshStandardMaterial({ color: '#b5fff0', emissive: '#2fd6c0', emissiveIntensity: 1, roughness: 0.2, flatShading: true });
    for (const [x, z, s, rz] of [
      [-0.11, 0.03, 1, 0.3],
      [-0.12, -0.02, 0.7, -0.2],
      [-0.09, 0.07, 0.55, 0.6],
    ]) {
      const m = new THREE.Mesh(cg, cm);
      m.position.set(x, 0.01, z);
      m.scale.set(0.03 * s, 0.09 * s, 0.03 * s);
      m.rotation.z = rz;
      g.add(m);
    }
    return g;
  }

  private buildExploreSet() {
    // dark stone dais under the portal + distant starfield (explore mode only)
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(2.25, 2.45, 0.22, 64),
      new THREE.MeshStandardMaterial({ color: '#2a2433', roughness: 0.75, metalness: 0.15 }),
    );
    dais.position.y = -0.112;
    dais.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.02, 6, 128), new THREE.MeshStandardMaterial({ color: '#8a6b3d', metalness: 0.8, roughness: 0.35 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.0;
    this.exploreSet.add(dais, rim);

    const n = 900;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 10;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, Math.abs(u) * r * 0.9 - 4, Math.sin(a) * s * r], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const stars = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: shared.uTime, uMap: { value: glowTexture() }, uViewportHeight: shared.uViewportHeight },
        vertexShader: `${POINT_SIZE_GLSL}
          uniform float uTime; attribute float aSeed; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = worldPointSize(0.12 + aSeed * 0.2, mv); vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 40.0)); }`,
        fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.85,0.9,1.0) * t.a * vA, t.a * vA); }`,
      }),
    );
    stars.frustumCulled = false;
    this.exploreSet.add(stars);
  }

  setEnvironment(env: Environment, scene: THREE.Scene) {
    const explore = env === 'explore';
    this.exploreSet.visible = explore;
    this.shadowCatcher.visible = !explore;
    if (explore) {
      scene.background = backgroundTexture();
      scene.fog = new THREE.Fog('#0d0a18', 9, 30);
    } else {
      scene.background = null;
      scene.fog = null;
    }
  }

  /** Frees GPU memory when switching worlds. */
  dispose(scene: THREE.Scene) {
    scene.remove(this.anchor);
    this.anchor.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      mats.forEach((x) => x.dispose());
    });
    this.sun.shadow.map?.dispose();
  }

  setQuality(q: QualitySettings) {
    this.quality = q;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  get islandY() {
    return ISLAND_Y + this.islandLift;
  }

  /** Raises/lowers the island (and its sky) without restarting the opening. */
  setIslandLift(v: number) {
    this.islandLift = v;
    this.islandCenter.y = this.islandY + 0.25;
    this.sky.group.position.y = v;
    this.birds.group.position.y = v;
    if (!this.seqRunning || this.seqT >= RISE_START + RISE_DUR) this.world.group.position.y = this.islandY;
  }

  get worldScale() {
    return this.root.getWorldScale(this.tmp).x;
  }

  applyTransform() {
    this.root.scale.setScalar(this.baseScale * this.userScale);
    this.root.rotation.y = this.userYaw;
    this.root.position.copy(this.userOffset);
  }

  private hideAll() {
    this.world.group.visible = false;
    this.sky.group.visible = false;
    this.birds.group.visible = false;
    this.dragon.hide();
  }

  /** Starts the ~3 s portal opening, then the island rises and the dragon flies out. */
  beginOpening() {
    this.phase = 'opening';
    this.seqT = 0;
    this.flashed = false;
    this.dragonOut = false;
    this.revealed = false;
    this.seqRunning = true;
    this.clipActive = true;
    this.portal.reset();
    this.hideAll();
    this.world.reset();
  }

  /** Instantly show the opened state (no animation). */
  showOpened() {
    this.phase = 'open';
    this.seqT = 99;
    this.portal.progress = 1;
    this.portal.markOpen();
    this.world.group.visible = true;
    this.world.group.position.y = this.islandY;
    this.world.group.scale.setScalar(1);
    this.world.group.rotation.y = 0;
    this.sky.group.visible = this.birds.group.visible = true;
    this.sky.group.scale.setScalar(1);
    this.birds.group.scale.setScalar(1);
    if (this.hasDragon) this.dragon.showAtHome();
    this.clipActive = false;
    this.seqRunning = false;
    this.flashed = this.dragonOut = this.revealed = true;
  }

  reset() {
    this.phase = 'hidden';
    this.seqRunning = false;
    this.portal.reset();
    this.hideAll();
  }

  update(dt: number, t: number, cameraWorld: THREE.Vector3) {
    // clip plane follows the stage surface (world space)
    this.root.updateMatrixWorld();
    this.clipPlane.set(new THREE.Vector3(0, 1, 0), this.clipActive ? 0.0005 : 1e6).applyMatrix4(this.root.matrixWorld);
    if (!this.clipActive) this.clipPlane.constant = 1e6;

    // shadow frustum must match the real-world scale of the diorama
    const s = this.worldScale;
    const cam = this.sun.shadow.camera;
    const ext = 2.1 * s;
    if (Math.abs(cam.right - ext) > 1e-6) {
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = 0.1 * s;
      cam.far = 9 * s;
      cam.updateProjectionMatrix();
    }
    this.portalLight.distance = 3.4 * s;
    this.world.setDetailDistance(this.quality.detailDistance * s);

    if (this.seqRunning) this.runSequence(dt);

    const p = this.portal.progress;
    const peak = smoothstep(0.55, 0.95, p);
    this.portalLight.intensity = damp(this.portalLight.intensity, this.phase === 'hidden' ? 0 : peak * (this.phase === 'open' ? 0.9 : 2.4), 3, dt);
    this.portal.update(dt, t);

    if (this.world.group.visible) {
      this.world.update(dt, t, cameraWorld, this.islandCenter);
      this.sky.update(dt, t);
      this.birds.update(dt, t);
    }
    this.dragon.update(dt, t, cameraWorld, this.islandCenter);
    this.bursts.update(dt);
    this.fire.update(dt);

    // slow, subtle drift of the sun: dynamic light across the diorama
    const a = t * 0.03;
    this.sun.position.set(Math.cos(a) * 2.6 + 0.6, 4.2 + Math.sin(a * 1.7) * 0.3, Math.sin(a) * 2.2 + 1.6);
    if (!(this.world instanceof World)) this.world.applyLighting(this.sun, this.hemi);
  }

  private runSequence(dt: number) {
    this.seqT += dt;
    const T = this.seqT;
    this.portal.progress = clamp(T / 3.0);
    if (T >= 3.0) this.portal.markOpen();

    if (T >= RISE_START) {
      if (!this.world.group.visible) {
        this.world.group.visible = true;
        this.onRiseStart();
      }
      const k = clamp((T - RISE_START) / RISE_DUR);
      const e = easeOutCubic(k);
      this.world.group.position.y = lerp(-1.75, this.islandY, e);
      this.world.group.rotation.y = lerp(-0.9, 0, easeInOutCubic(k));
      this.world.group.scale.setScalar(lerp(0.72, 1, e));
      if (k > 0.75) {
        const f = smoothstep(0.75, 1, k);
        this.sky.group.visible = this.birds.group.visible = true;
        this.sky.group.scale.setScalar(f);
        this.birds.group.scale.setScalar(f);
      }
    }
    if (!this.flashed && T >= FLASH_AT) {
      this.flashed = true;
      this.portal.surge();
      this.onFlash();
      for (let i = 0; i < 3; i++) {
        this.bursts.burst({ x: 0, y: 0.15, z: 0 }, 50, 1.6, { life: 1.4, size: 0.06, color: i === 0 ? '#ffffff' : i === 1 ? '#7ff6e0' : '#b28cff', colorEnd: '#5a3cff', gravity: 0.25, drag: 1.4 });
      }
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        this.bursts.emit({ x: Math.cos(a) * PORTAL_R, y: 0.03, z: Math.sin(a) * PORTAL_R }, { x: Math.cos(a) * 0.3, y: 0.6 + Math.random() * 0.6, z: Math.sin(a) * 0.3 }, { life: 1.3, size: 0.045, color: '#ffe3a1', colorEnd: '#4ff0d2', drag: 1.8 });
      }
    }
    if (!this.dragonOut && T >= DRAGON_AT && this.hasDragon) {
      this.dragonOut = true;
      this.dragon.emerge(new THREE.Vector3(0.25, -0.3, 0.2), () => this.onDragonLanded());
    }
    if (T >= DRAGON_AT + 2.2) {
      this.clipActive = false;
      this.seqRunning = false;
    }
    if (!this.revealed && T >= REVEALED_AT) {
      this.revealed = true;
      this.phase = 'open';
      this.onRevealed();
    }
  }
}

function materialsOf(o: THREE.Object3D) {
  const out = new Set<THREE.Material>();
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => out.add(x));
  });
  return [...out];
}

let bg: THREE.Texture | null = null;
function backgroundTexture() {
  if (bg) return bg;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#05040b');
  g.addColorStop(0.45, '#121027');
  g.addColorStop(0.75, '#22183a');
  g.addColorStop(1, '#0b0814');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  bg = new THREE.CanvasTexture(c);
  bg.colorSpace = THREE.SRGBColorSpace;
  return bg;
}
