import * as THREE from 'three';
import type { QualitySettings } from '../../systems/Quality';
import { shared } from '../../systems/SharedUniforms';
import { StaticBatch } from '../StaticBatch';
import { ChimneySmoke, Fireflies } from '../../effects/Ambient';
import { glowTexture } from '../../utils/textures';
import { clamp, damp, dampAngle, mulberry32, range, smoothstep } from '../../utils/math';
import { Vox, VoxPerson, voxGroup } from '../farm/Voxel';
import { buildFarmGeometries, loadFarmModel, type FarmModelData } from './VoxelModel';
import {
  BARN, CLOVER, COOP, DOG_BED, FIELDS, GREENHOUSE, HIVES, HOUSE, NX, NY, PEN, POND, ROUTE, S, SCARECROW, SHED, rectCenter, vx, vy, vz,
  type FieldKind, type Rect,
} from './layout';

const DAY_LENGTH = 240; // seconds for a full day
const REGROW = 26; // seconds for a harvested field to grow back

interface Critter {
  root: THREE.Object3D;
  head?: THREE.Object3D;
  target: THREE.Vector2;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  speed: number;
  wait: number;
  hop: number;
}

export interface FarmTree {
  proxy: THREE.Mesh;
  kind: string;
  center: THREE.Vector3;
  top: number;
}

/** Island-local centre of a voxel rect, at height `z` voxels. */
const at = (r: Rect, z = 2) => {
  const [x, y] = rectCenter(r);
  return new THREE.Vector3(vx(x), vy(z), vz(y));
};
const rectSize = (r: Rect, h: number): [number, number, number] => [(r[1] - r[0] + 1) * S, h, (r[3] - r[2] + 1) * S];

/**
 * Fazenda da Duda: built from the user's own farm and farmhouse models.
 * The farm comes as voxel data (recoloured from the FBX), the farmhouse as a
 * textured GLB. Around them: Duda and her daily routine, Biscoito the dog,
 * chickens, ducks, bees, butterflies, growing crops and a day/night cycle.
 */
export class DudaWorld {
  readonly kind = 'duda' as const;
  readonly group = new THREE.Group();
  readonly proxies: Record<string, THREE.Mesh> = {};
  readonly sounds: THREE.Vector3[] = [];
  readonly trees: FarmTree[] = [];
  /** Resolves when the farm model and the farmhouse are in place (never rejects). */
  readonly ready: Promise<void>;
  loadError: string | null = null;

  timeOfDay = 0.32;
  timeScale = 1;
  private night = 0;
  private quality: QualitySettings;

  private voxMat: THREE.MeshStandardMaterial;
  private foliageMat: THREE.MeshStandardMaterial;
  private cropMats = new Map<FieldKind, THREE.MeshStandardMaterial>();
  private charMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private glassMat: THREE.MeshStandardMaterial;
  private waterMat: THREE.ShaderMaterial;
  private shake = new THREE.Vector4(0, 0, 0, 0.1);
  /** Growth per field, 0 (just harvested) … 1 (ripe). */
  readonly growth: Record<FieldKind, number> = { tomato: 1, pumpkin: 1, blueberry: 1, cauli: 1, strawberry: 1 };
  readonly harvested = new Set<FieldKind>();

  readonly duda: VoxPerson;
  private dudaLeg = 0;
  private stop = 0;
  private pause = 2;
  /** Seconds Duda stays still facing the viewer (after a tap). */
  talk = 0;
  private droplets: THREE.Mesh[] = [];
  private can: THREE.Object3D;

  private dog: THREE.Group;
  private dogTail: THREE.Object3D;
  private dogHead: THREE.Object3D;
  private zzz: THREE.Sprite;
  dogAwake = false;
  private dogHop = 0;

  private chickens: Critter[] = [];
  private chickenExcite = 0;
  private egg: THREE.Group;
  eggVisible = false;
  private ducks: THREE.Group[] = [];
  private bees: THREE.InstancedMesh;
  private beeBoost = 0;
  private butterflies: Array<{ g: THREE.Group; wings: THREE.Mesh[]; home: THREE.Vector3; seed: number }> = [];
  private honey: THREE.Object3D;
  hiveTaps = 0;
  private moonFlower: THREE.Group;
  private moonMat: THREE.MeshBasicMaterial;
  moonBloom = 0;
  private moonTarget = 0;
  private clover: THREE.Group;
  private cloverSpark: THREE.Sprite;
  private lamps: THREE.Sprite[] = [];
  private fireflies: Fireflies;
  private smoke: ChimneySmoke | null = null;
  private smokeBoost = 0;
  private rocks: THREE.Object3D[] = [];
  private bobber: THREE.Mesh;
  private fish: THREE.Mesh;
  private fishMat: THREE.MeshStandardMaterial;
  private fishing = -1;
  private fishT = 0;
  /** Called when a cast pays off (island-local splash point). */
  onCatch: (where: THREE.Vector3) => void = () => {};

  constructor(q: QualitySettings) {
    this.quality = q;
    this.group.name = 'fazenda-da-duda';
    const rng = mulberry32(1712);
    this.voxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
    this.foliageMat = this.swaying(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
    for (const k of Object.keys(FIELDS) as FieldKind[]) this.cropMats.set(k, this.growing(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), k));
    this.charMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: '#ffd98a', toneMapped: false });
    this.waterMat = waterMaterial();
    this.glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.42, roughness: 0.15, metalness: 0.1, depthWrite: false });

    this.buildBase(rng);
    this.buildPond();
    this.buildLamps();

    // Duda
    this.duda = new VoxPerson({ skin: '#f3c6a0', hair: '#c4552c', shirt: '#f2a7c3', pants: '#4a6fb5', hat: '#ecc76a' }, this.charMat);
    this.duda.root.scale.setScalar(0.78);
    const [sx, sy] = ROUTE[0];
    this.duda.root.position.set(vx(sx), 0, vz(sy));
    this.can = voxGroup([[0, 0, 0, 0.012, 0.01, 0.009, '#7fb1c9'], [0.008, 0.006, 0, 0.008, 0.003, 0.003, '#7fb1c9'], [0, 0.01, 0, 0.004, 0.006, 0.009, '#5d8aa3']], this.charMat);
    this.can.position.set(0.022, 0.035, 0.012);
    this.can.visible = false;
    this.duda.root.add(this.can);
    this.group.add(this.duda.root);
    const dropMat = new THREE.MeshBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.85 });
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.005, 0.003), dropMat);
      d.visible = false;
      this.droplets.push(d);
      this.group.add(d);
    }

    // Biscoito
    ({ dog: this.dog, tail: this.dogTail, head: this.dogHead } = this.buildDog());
    this.zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: zzzTexture(), transparent: true, depthWrite: false }));
    this.zzz.scale.setScalar(0.035);
    this.group.add(this.zzz);

    this.buildChickens(rng);
    this.egg = this.buildEgg();
    this.buildDucks();
    this.bees = this.buildBees();
    this.buildButterflies(rng);
    this.honey = this.buildHoney();
    this.moonMat = new THREE.MeshBasicMaterial({ color: '#d9f4ff', transparent: true, opacity: 0, toneMapped: false });
    this.moonFlower = this.buildMoonFlower();
    ({ g: this.clover, spark: this.cloverSpark } = this.buildClover());
    ({ bobber: this.bobber, fish: this.fish, mat: this.fishMat } = this.buildFishing());

    // fireflies over the pond, the orchard and the meadow
    const ff: THREE.Vector3[] = [];
    const zones: Array<[number, number, number]> = [
      [63, 26, 14],
      [30, 25, 18],
      [95, 25, 18],
      [20, 85, 12],
    ];
    for (let i = 0; i < Math.round(56 * q.particles); i++) {
      const [x, y, r] = zones[i % zones.length];
      ff.push(new THREE.Vector3(vx(x + range(rng, -r, r)), range(rng, 0.03, 0.14), vz(y + range(rng, -r * 0.7, r * 0.7))));
    }
    this.fireflies = new Fireflies(ff, [new THREE.Color('#fff09a'), new THREE.Color('#d6ff8a')], 0.026, 0.03);
    this.group.add(this.fireflies.points);

    // touch targets (independent of the async model: interactions can bind right away)
    const H = (z: number) => z * S;
    this.proxy('house', new THREE.Vector3(vx(HOUSE.x), 0.1, vz(HOUSE.y)), 0, 0, [HOUSE.width * S, 0.22, HOUSE.width * S * 0.86]);
    this.proxy('greenhouse', at(GREENHOUSE, 2 + 10), 0, 0, rectSize(GREENHOUSE, H(20)));
    this.proxy('barn', at(BARN, 2 + 8), 0, 0, rectSize(BARN, H(16)));
    this.proxy('coop', at(COOP, 2 + 7), 0, 0, rectSize(COOP, H(14)));
    this.proxy('chickens', at(PEN, 2 + 2), 0, 0, rectSize(PEN, H(5)));
    this.proxy('hives', at(HIVES, 2 + 4), 0, 0, rectSize(HIVES, H(8)));
    this.proxy('shed', at(SHED, 2 + 5), 0, 0, rectSize(SHED, H(10)));
    this.proxy('pond', at(POND, 1), 0, 0, rectSize(POND, H(3)));
    this.proxy('scarecrow', new THREE.Vector3(vx(SCARECROW.x), H(5), vz(SCARECROW.y)), 0.04, 0.12);
    for (const k of Object.keys(FIELDS) as FieldKind[]) this.proxy(`field:${k}`, at(FIELDS[k], 2 + 2), 0, 0, rectSize(FIELDS[k], H(5)));
    this.proxy('dog', new THREE.Vector3(), 0.03);
    this.proxies.dog.removeFromParent();
    this.dog.add(this.proxies.dog);
    this.proxies.dog.position.set(0, 0.012, 0);
    this.proxy('egg', new THREE.Vector3(), 0.025);
    this.proxies.egg.removeFromParent();
    this.egg.add(this.proxies.egg);
    this.proxy('clover', this.clover.position.clone().setY(0.01), 0.03);

    this.sounds.push(at(POND, 2), new THREE.Vector3(vx(HOUSE.x), 0.05, vz(HOUSE.y)));

    this.ready = this.load(import.meta.env.BASE_URL).catch((e) => {
      this.loadError = String(e);
      console.error('[fazenda-da-duda]', e);
    });
  }

  // ================================================================== loading the user's models
  private async load(base: string) {
    const [data, gltf] = await Promise.all([
      loadFarmModel(base),
      import('three/examples/jsm/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync(`${base}models/fazenda-da-duda/casa.glb`)),
    ]);
    this.buildFarm(data);
    this.placeFarmhouse(gltf.scene);
  }

  private buildFarm(data: FarmModelData) {
    const g = buildFarmGeometries(data);
    const shadows = this.quality.shadows;
    const scenery = new THREE.Mesh(g.scenery, this.voxMat);
    scenery.name = 'fazenda-cenario';
    scenery.castShadow = scenery.receiveShadow = shadows;
    const foliage = new THREE.Mesh(g.foliage, this.foliageMat);
    foliage.name = 'fazenda-copas';
    foliage.castShadow = shadows;
    foliage.receiveShadow = shadows;
    const glass = new THREE.Mesh(g.glass, this.glassMat);
    glass.name = 'estufa-vidro';
    glass.renderOrder = 2;
    this.group.add(scenery, foliage, glass);
    for (const [k, geo] of g.crops) {
      const m = new THREE.Mesh(geo, this.cropMats.get(k)!);
      m.name = `plantacao-${k}`;
      m.castShadow = m.receiveShadow = shadows;
      this.group.add(m);
    }
    for (const t of data.trees) {
      const c = new THREE.Vector3(vx(t.x), vy(t.z), vz(t.y));
      const r = Math.max(0.035, Math.cbrt(t.n) * S * 0.75);
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      p.position.copy(c);
      p.name = 'tree-hit';
      this.group.add(p);
      this.trees.push({ proxy: p, kind: t.kind, center: c, top: vy(t.top) });
    }
  }

  private placeFarmhouse(house: THREE.Object3D) {
    house.name = 'casa-da-duda';
    house.scale.setScalar(HOUSE.width * S);
    house.position.set(vx(HOUSE.x), 0, vz(HOUSE.y));
    const clip = this.voxMat.clippingPlanes;
    let chimney: THREE.Mesh | null = null;
    house.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = this.quality.shadows;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.clippingPlanes = clip;
      if (mat.name === 'Farmhouse_5') chimney = m;
    });
    this.group.add(house);
    house.updateMatrixWorld(true);
    // smoke from the model's own chimney (fallback: above the roof)
    const top = new THREE.Vector3(vx(HOUSE.x + 4), 0.2, vz(HOUSE.y + 2));
    if (chimney) {
      const box = new THREE.Box3().setFromObject(chimney);
      box.getCenter(top);
      top.y = box.max.y;
      this.group.worldToLocal(top);
    }
    this.smoke = new ChimneySmoke([top.add(new THREE.Vector3(0, 0.006, 0))], Math.max(4, Math.round(10 * this.quality.particles)));
    this.group.add(this.smoke.points);
  }

  // ================================================================== materials
  private swaying(mat: THREE.MeshStandardMaterial) {
    const shake = this.shake;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.uTime;
      sh.uniforms.uShake = { value: shake };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec4 uShake;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hk = smoothstep(0.03, 0.22, transformed.y);
        float w = sin(uTime * 1.6 + transformed.x * 14.0 + transformed.z * 11.0) * 0.5 + sin(uTime * 2.7 + transformed.x * 23.0) * 0.25;
        float sk = uShake.z * smoothstep(uShake.w, 0.0, distance(transformed.xz, uShake.xy));
        transformed.x += (w * 0.0022 + sk * sin(uTime * 34.0) * 0.006) * hk;
        transformed.z += (w * 0.0016 + sk * cos(uTime * 29.0) * 0.004) * hk;`,
      );
    };
    mat.customProgramCacheKey = () => 'duda-foliage';
    return mat;
  }

  private growing(mat: THREE.MeshStandardMaterial, field: FieldKind) {
    const grow = { value: 1 };
    mat.userData.grow = grow;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGrow = grow;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGrow;\nattribute float aRand;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float g = smoothstep(aRand * 0.45, aRand * 0.45 + 0.55, uGrow);
        transformed.y = mix(-0.004, transformed.y, g);`,
      );
    };
    mat.customProgramCacheKey = () => 'duda-crop';
    mat.name = `crop-${field}`;
    return mat;
  }

  // ================================================================== build: island under the board
  private buildBase(rng: () => number) {
    const batch = new StaticBatch();
    const vox = new Vox(batch).at(0, 0, 0);
    const hx = (NX * S) / 2;
    const hz = (NY * S) / 2;
    const G = 4 * S;
    const top = vy(0);
    for (let k = 1; k <= 8; k++) {
      const f = Math.pow(1 - k / 9.2, 0.8);
      const h = 0.05;
      const y = top - k * h;
      for (let x = -hx + G / 2; x < hx; x += G) {
        for (let z = -hz + G / 2; z < hz; z += G) {
          const e = Math.max(Math.abs(x) / (hx * f), Math.abs(z) / (hz * f));
          if (e > 1 || (e > 0.86 && rng() < 0.45)) continue;
          const c = k === 1 ? '#7b5233' : k === 2 ? '#6c4a30' : (k + Math.round(x / G) + Math.round(z / G)) % 3 === 0 ? '#6f625a' : k > 5 ? '#5e5560' : '#7a6b60';
          vox.box(x, y, z, G, h, G, c, batch, 0.08);
        }
      }
    }
    // roots and vines hanging off the rim
    for (let i = 0; i < 46; i++) {
      const side = i % 4;
      const u = range(rng, -0.95, 0.95);
      const x = side < 2 ? u * hx : (side === 2 ? -1 : 1) * (hx - S * 0.5);
      const z = side < 2 ? (side === 0 ? 1 : -1) * (hz - S * 0.5) : u * hz;
      const len = range(rng, 0.03, 0.13);
      vox.box(x, top - len, z, S * 0.8, len, S * 0.8, rng() < 0.6 ? '#3e8a3a' : '#6a4a2c', batch, 0.1);
      if (rng() < 0.4) vox.box(x, top - len - S, z, S * 1.6, S * 1.2, S * 1.6, '#f2a7c3', batch, 0.1);
    }
    const base = batch.build(this.voxMat, 'fazenda-base');
    base.castShadow = this.quality.shadows;
    this.group.add(base);

    // little floating islets
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const r = 1.08 + rng() * 0.12;
      const b = new StaticBatch();
      const v = new Vox(b).at(0, 0, 0);
      const s = range(rng, 0.05, 0.08);
      v.box(0, -s * 0.9, 0, s, s * 0.9, s, '#7a6b60', b, 0.1);
      v.box(0, -s * 1.5, 0, s * 0.6, s * 0.6, s * 0.6, '#6f625a', b, 0.1);
      v.box(0, 0, 0, s * 1.05, S * 1.4, s * 1.05, '#5fb043', b, 0.06);
      if (i % 2 === 0) {
        v.box(0, S * 1.4, 0, S, s * 0.7, S, '#6e4526', b, 0);
        v.box(0, S * 1.4 + s * 0.6, 0, s * 0.6, s * 0.6, s * 0.6, i === 2 ? '#f4a7c9' : '#3f9a3a', b, 0.1);
      } else v.box(s * 0.2, S * 1.4, -s * 0.15, S * 1.5, S * 1.5, S * 1.5, '#ffe14d', b, 0);
      const m = b.build(this.voxMat, 'ilhota');
      m.position.set(Math.cos(a) * r, range(rng, -0.32, -0.08), Math.sin(a) * r * 0.9);
      m.userData.y0 = m.position.y;
      m.userData.ph = rng() * 6;
      m.castShadow = this.quality.shadows;
      this.rocks.push(m);
      this.group.add(m);
    }
  }

  private buildPond() {
    const [x0, x1, y0, y1] = POND;
    const w = (x1 - x0 + 1) * S;
    const d = (y1 - y0 + 1) * S;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    const c = at(POND, 0);
    water.position.set(c.x, -0.0045, c.z);
    water.name = 'lago';
    water.receiveShadow = true;
    this.group.add(water);
  }

  private buildLamps() {
    const b = new StaticBatch();
    const v = new Vox(b);
    const tex = glowTexture();
    for (const [x, y] of [
      [26, 45],
      [48, 34.5],
      [68, 34.5],
      [88, 35.5],
      [68, 70],
    ]) {
      v.at(vx(x), 0, vz(y));
      v.box(0, 0, 0, S * 0.7, S * 6, S * 0.7, '#5a3d27', b, 0);
      v.box(0, S * 6, 0, S * 1.6, S * 1.5, S * 1.6, '#3b2c22', b, 0);
      v.box(0, S * 6.2, 0, S * 1.1, S * 1.1, S * 1.1, '#ffe9a8', b, 0);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffcf7e', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(vx(x), S * 6.8, vz(y));
      sp.scale.setScalar(0.07);
      this.lamps.push(sp);
      this.group.add(sp);
    }
    const posts = b.build(this.voxMat, 'lampioes');
    posts.castShadow = this.quality.shadows;
    this.group.add(posts);
  }

  // ================================================================== build: animals & secrets
  private buildDog() {
    const dog = new THREE.Group();
    const fur = '#d9a066';
    const dark = '#9a6334';
    dog.add(voxGroup([[0, 0.008, 0, 0.016, 0.014, 0.03, fur], ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * 0.005, 0, sz * 0.01, 0.005, 0.009, 0.005, fur] as [number, number, number, number, number, number, string]))], this.charMat));
    const head = new THREE.Group();
    head.position.set(0, 0.018, 0.017);
    head.add(
      voxGroup(
        [
          [0, 0, 0, 0.015, 0.013, 0.013, fur],
          [0, 0.001, 0.009, 0.008, 0.006, 0.007, '#f0d2a8'],
          [0, 0.005, 0.0125, 0.004, 0.003, 0.002, '#2a1c14'],
          [-0.0085, 0.004, -0.001, 0.003, 0.011, 0.007, dark],
          [0.0085, 0.004, -0.001, 0.003, 0.011, 0.007, dark],
          [-0.004, 0.008, 0.0066, 0.002, 0.002, 0.001, '#2a1c14'],
          [0.004, 0.008, 0.0066, 0.002, 0.002, 0.001, '#2a1c14'],
        ],
        this.charMat,
      ),
    );
    dog.add(head);
    const tail = new THREE.Group();
    tail.position.set(0, 0.018, -0.015);
    tail.add(voxGroup([[0, 0, -0.006, 0.004, 0.004, 0.012, dark]], this.charMat));
    tail.rotation.x = -0.6;
    dog.add(tail);
    dog.position.set(vx(DOG_BED.x), 0, vz(DOG_BED.y));
    dog.rotation.y = 0.6;
    dog.scale.y = 0.75; // curled up asleep
    this.group.add(dog);
    return { dog, tail, head };
  }

  private buildChickens(rng: () => number) {
    const b = { x0: vx(PEN[0]), x1: vx(PEN[1]), z0: vz(PEN[3]), z1: vz(PEN[2]) };
    for (let i = 0; i < 5; i++) {
      const root = new THREE.Group();
      const body = i === 2 ? '#c9874a' : '#f7f3ea';
      root.add(voxGroup([[0, 0.006, 0, 0.018, 0.016, 0.024, body], [0, 0.012, -0.012, 0.012, 0.012, 0.008, body], [-0.004, 0, 0, 0.003, 0.006, 0.003, '#e8a33a'], [0.004, 0, 0, 0.003, 0.006, 0.003, '#e8a33a']], this.charMat));
      const head = new THREE.Group();
      head.position.set(0, 0.02, 0.012);
      head.add(voxGroup([[0, 0, 0, 0.011, 0.012, 0.011, body], [0, 0.012, 0, 0.004, 0.005, 0.008, '#e3402f'], [0, 0.004, 0.007, 0.005, 0.004, 0.005, '#f2b23a']], this.charMat));
      root.add(head);
      root.scale.setScalar(0.7);
      const x = range(rng, b.x0, b.x1);
      const z = range(rng, b.z0, b.z1);
      root.position.set(x, 0, z);
      this.group.add(root);
      this.chickens.push({ root, head, target: new THREE.Vector2(x, z), bounds: b, speed: 0.04, wait: rng() * 2, hop: 0 });
    }
  }

  private buildEgg() {
    const g = new THREE.Group();
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffb21a', emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }));
    egg.scale.set(1, 1.3, 1);
    egg.position.y = 0.01;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe08a', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(0.05);
    halo.position.y = 0.012;
    g.add(egg, halo);
    g.position.set(vx(PEN[0] + 4), 0, vz(PEN[2] + 2));
    g.visible = false;
    this.group.add(g);
    return g;
  }

  private buildDucks() {
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Group();
      d.add(voxGroup([[0, 0, 0, 0.012, 0.009, 0.018, '#fafafa'], [0, 0.007, 0.008, 0.008, 0.009, 0.008, i ? '#2f8a5a' : '#fafafa'], [0, 0.009, 0.0135, 0.005, 0.003, 0.004, '#f2a23a']], this.charMat));
      d.userData.ph = i * Math.PI;
      this.ducks.push(d);
      this.group.add(d);
    }
  }

  private buildBees() {
    const n = Math.round(14 * Math.max(0.5, this.quality.particles));
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, 0.003, 0.005), new THREE.MeshBasicMaterial({ color: '#ffd23f' }), n);
    m.name = 'abelhas';
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  private buildButterflies(rng: () => number) {
    const colors = ['#ff9ad5', '#ffe14d', '#9fd3ff', '#ffffff', '#c7a6ff', '#ffb36b'];
    const homes: Array<[number, number]> = [
      [92, 22],
      [105, 28],
      [84, 30],
      [54, 58],
      [36, 30],
      [112, 18],
    ];
    homes.forEach(([x, y], i) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
      const wings: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.009, 0.007), mat);
        w.geometry.translate(0.0045 * s, 0, 0);
        w.rotation.x = -Math.PI / 2;
        const pivot = new THREE.Group();
        pivot.add(w);
        g.add(pivot);
        wings.push(pivot as unknown as THREE.Mesh);
      }
      const home = new THREE.Vector3(vx(x), 0.05, vz(y));
      g.position.copy(home);
      this.group.add(g);
      this.butterflies.push({ g, wings, home, seed: rng() * 10 });
    });
  }

  private buildHoney() {
    const g = voxGroup(
      [
        [0, 0, 0, 0.014, 0.014, 0.014, '#f7b21f'],
        [0, 0.014, 0, 0.016, 0.004, 0.016, '#e38b2c'],
        [0, 0.018, 0, 0.008, 0.003, 0.008, '#c9874a'],
      ],
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.3, emissive: '#ffb21a', emissiveIntensity: 0.35 }),
    );
    const c = at(HIVES, 9);
    g.position.set(c.x, c.y, c.z + 0.02);
    g.visible = false;
    this.group.add(g);
    return g;
  }

  private buildMoonFlower() {
    const g = new THREE.Group();
    const stem = voxGroup([[0, 0, 0, 0.003, 0.03, 0.003, '#3e8a3a'], [0.005, 0.012, 0, 0.008, 0.002, 0.004, '#4fb03f']], this.charMat);
    g.add(stem);
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.002, 0.014), this.moonMat);
      p.geometry.translate(0, 0, 0.007);
      p.position.y = 0.03;
      p.rotation.y = (i / 6) * Math.PI * 2;
      p.userData.petal = true;
      g.add(p);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#bfe9ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(0.1);
    halo.position.y = 0.03;
    g.userData.halo = halo;
    g.add(halo);
    const c = at(GREENHOUSE, 2);
    g.position.set(c.x, 0, c.z);
    g.scale.setScalar(2);
    this.group.add(g);

    // planters and seedlings inside the greenhouse (visible through the glass)
    const b = new StaticBatch();
    const v = new Vox(b).at(c.x, 0, c.z);
    const flowers = ['#ff7eb6', '#ffe14d', '#b48cff', '#ff4d4d', '#fffaf0'];
    for (const [dx, dz, w, d] of [
      [-0.06, -0.055, 0.03, 0.1],
      [0.06, -0.055, 0.03, 0.1],
      [-0.06, 0.06, 0.03, 0.06],
      [0.06, 0.06, 0.03, 0.06],
    ]) {
      v.box(dx, 0, dz, w, S * 1.6, d, '#9a6334', b, 0);
      v.box(dx, S * 1.6, dz, w * 0.8, S * 0.3, d * 0.9, '#6a4228', b, 0);
      for (let i = 0; i < Math.round(d / 0.016); i++) {
        const zz = dz - d / 2 + 0.008 + i * 0.016;
        v.box(dx, S * 1.9, zz, S * 0.6, S * 1.4, S * 0.6, '#4fb03f', b, 0.1);
        v.box(dx, S * 3.3, zz, S * 1.1, S * 0.9, S * 1.1, flowers[(i + Math.round(dx * 100)) % flowers.length], b, 0.1);
      }
    }
    const beds = b.build(this.voxMat, 'estufa-canteiros');
    beds.castShadow = this.quality.shadows;
    this.group.add(beds);
    return g;
  }

  private buildClover() {
    const g = new THREE.Group();
    const leaf = '#2fbf4a';
    g.add(
      voxGroup(
        [
          [0, 0, 0, 0.002, 0.008, 0.002, '#2a8a3a'],
          [-0.003, 0.008, 0, 0.005, 0.002, 0.005, leaf],
          [0.003, 0.008, 0, 0.005, 0.002, 0.005, leaf],
          [0, 0.008, -0.003, 0.005, 0.002, 0.005, leaf],
          [0, 0.008, 0.003, 0.005, 0.002, 0.005, leaf],
        ],
        this.charMat,
      ),
    );
    g.position.set(vx(CLOVER.x), 0, vz(CLOVER.y));
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#d6ffb0', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    spark.scale.setScalar(0.025);
    spark.position.y = 0.012;
    g.add(spark);
    this.group.add(g);
    return { g, spark };
  }

  private buildFishing() {
    const bobber = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff4d4d' }));
    bobber.visible = false;
    const mat = new THREE.MeshStandardMaterial({ color: '#9fd3ff', emissive: '#3a6cff', emissiveIntensity: 0.15, roughness: 0.4, flatShading: true });
    const fish = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.022), mat);
    fish.visible = false;
    this.group.add(bobber, fish);
    return { bobber, fish, mat };
  }

  private proxy(name: string, p: THREE.Vector3, r: number, h?: number, box?: [number, number, number]) {
    const geo = box ? new THREE.BoxGeometry(...box) : h ? new THREE.CylinderGeometry(r, r, h, 12) : new THREE.SphereGeometry(r, 10, 8);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    m.position.copy(p);
    m.name = `${name}-hit`;
    this.group.add(m);
    this.proxies[name] = m;
    return m;
  }

  // ================================================================== actions (used by the interactions)
  get isNight() {
    return this.night > 0.6;
  }

  get clock() {
    const h = Math.floor(this.timeOfDay * 24);
    const m = Math.floor((this.timeOfDay * 24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  skipTime(fraction: number) {
    this.timeOfDay = (this.timeOfDay + fraction) % 1;
  }

  /** Harvests a ripe field; returns false while it is still growing. */
  harvest(k: FieldKind) {
    if (this.growth[k] < 0.92) return false;
    this.growth[k] = 0;
    this.harvested.add(k);
    return true;
  }

  fieldCenter(k: FieldKind) {
    return at(FIELDS[k], 4);
  }

  shakeTree(t: FarmTree) {
    this.shake.set(t.center.x, t.center.z, 1, 0.09);
  }

  wakeDog() {
    const first = !this.dogAwake;
    this.dogAwake = true;
    this.dogHop = 1;
    this.dog.scale.y = 1;
    return first;
  }

  exciteChickens() {
    this.chickenExcite = 2.5;
    for (const c of this.chickens) {
      c.hop = 1;
      c.wait = 0;
    }
  }

  showEgg() {
    if (this.eggVisible) return false;
    this.eggVisible = true;
    this.egg.visible = true;
    return true;
  }

  takeEgg() {
    this.eggVisible = false;
    this.egg.visible = false;
  }

  /** Returns true on the tap that reveals the honey. */
  buzzHives() {
    this.beeBoost = 3;
    this.hiveTaps++;
    if (this.hiveTaps === 3) {
      this.honey.visible = true;
      return true;
    }
    return false;
  }

  bloomMoonFlower() {
    this.moonTarget = 1;
  }

  findClover() {
    this.clover.scale.setScalar(1.6);
    this.cloverSpark.scale.setScalar(0.06);
  }

  puffSmoke() {
    this.smokeBoost = 6;
    this.smoke?.puff(true);
  }

  cast(): boolean {
    if (this.fishing >= 0) return false;
    const c = at(POND, 2);
    this.bobber.position.set(c.x + range(Math.random, -0.08, 0.08), -0.004, c.z + range(Math.random, -0.05, 0.05));
    this.bobber.visible = true;
    this.fishing = 0;
    this.fishT = 0;
    return true;
  }

  /** Colours the next jumping fish (legendary = rainbow carp). */
  setFishLook(legendary: boolean) {
    this.fishMat.color.set(legendary ? '#ff7ad9' : '#9fd3ff');
    this.fishMat.emissive.set(legendary ? '#ffb21a' : '#3a6cff');
    this.fishMat.emissiveIntensity = legendary ? 0.6 : 0.15;
  }

  /** Duda faces the viewer for a while (she is being talked to). */
  greet(seconds = 4) {
    this.talk = Math.max(this.talk, seconds);
  }

  // ================================================================== world API used by Stage / Experience
  materials(): THREE.Material[] {
    const out = new Set<THREE.Material>([this.voxMat, this.foliageMat, this.glassMat, ...this.cropMats.values()]);
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => out.add(x));
    });
    return [...out];
  }

  setDetailDistance(_d: number) {
    /* voxel farm has no separate detail layer */
  }

  reset() {
    this.talk = 0;
  }

  /** Day/night lighting (called by the Stage every frame). */
  applyLighting(sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight) {
    const a = (this.timeOfDay - 0.25) * Math.PI * 2;
    const elev = Math.sin(a);
    const day = smoothstep(-0.08, 0.3, elev);
    this.night = 1 - day;
    sun.position.set(Math.cos(a) * 3.2, Math.max(0.6, elev * 4.4), 1.8);
    sun.intensity = 0.75 + 2.0 * day;
    sun.color.set('#ffb070').lerp(new THREE.Color('#fff1d6'), smoothstep(0.1, 0.5, elev));
    if (day < 0.2) sun.color.lerp(new THREE.Color('#8fa6ff'), 1 - day / 0.2);
    hemi.intensity = 1.0 + 0.4 * day;
    hemi.color.set('#e4ecff').lerp(new THREE.Color('#8ea2e6'), this.night);
    hemi.groundColor.set('#6a5848').lerp(new THREE.Color('#3c3a63'), this.night);
  }

  update(dt: number, t: number, camera?: THREE.Vector3) {
    this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / DAY_LENGTH) % 1;
    const n = this.night;

    // lights, fireflies, smoke
    for (const l of this.lamps) (l.material as THREE.SpriteMaterial).opacity = n * (0.7 + Math.sin(t * 3 + l.position.x * 20) * 0.06);
    this.glowMat.color.set('#ffd98a').multiplyScalar(0.5 + n);
    this.fireflies.mat.uniforms.uIntensity.value = n;
    if (this.smoke) {
      this.smoke.update(dt);
      if (this.smokeBoost > 0 && (this.smokeBoost -= dt) <= 0) this.smoke.puff(false);
    }

    // foliage tap-shake decays
    this.shake.z = Math.max(0, this.shake.z - dt * 1.2);

    // crops grow back after a harvest
    for (const k of Object.keys(this.growth) as FieldKind[]) {
      this.growth[k] = Math.min(1, this.growth[k] + dt / REGROW);
      const u = this.cropMats.get(k)!.userData.grow as { value: number };
      u.value = this.growth[k];
    }

    // floating islets bob
    for (const r of this.rocks) r.position.y = r.userData.y0 + Math.sin(t * 0.6 + r.userData.ph) * 0.012;

    this.updateDuda(dt, t, camera);
    this.updateDog(dt, t);
    this.updateChickens(dt, t);

    // ducks paddle around the pond
    const pc = at(POND, 0);
    this.ducks.forEach((d, i) => {
      const a = t * 0.18 + d.userData.ph;
      d.position.set(pc.x + Math.cos(a) * (0.07 + i * 0.03), -0.004 + Math.sin(t * 2 + i) * 0.0008, pc.z + Math.sin(a) * (0.05 + i * 0.015));
      d.rotation.y = -a;
    });

    // bees around the hives (more after a tap)
    this.beeBoost = Math.max(0, this.beeBoost - dt);
    const hc = at(HIVES, 7);
    const m = new THREE.Matrix4();
    const rad = 0.035 + this.beeBoost * 0.012;
    for (let i = 0; i < this.bees.count; i++) {
      const s = i * 1.7;
      const a = t * (1.4 + (i % 3) * 0.4) * (i % 2 ? 1 : -1) + s;
      m.makeRotationY(-a).setPosition(hc.x + Math.cos(a) * rad * (0.6 + (i % 4) * 0.15), hc.y + 0.01 + Math.sin(t * 5 + s) * 0.012, hc.z + Math.sin(a) * rad * 0.8);
      this.bees.setMatrixAt(i, m);
    }
    this.bees.instanceMatrix.needsUpdate = true;
    this.bees.visible = n < 0.8;

    // butterflies (daytime)
    for (const b of this.butterflies) {
      const k = t * 0.35 + b.seed;
      b.g.position.set(b.home.x + Math.sin(k * 1.3) * 0.06, b.home.y + Math.sin(k * 3.1) * 0.015, b.home.z + Math.cos(k) * 0.05);
      b.g.rotation.y = Math.atan2(Math.cos(k * 1.3) * 1.3, -Math.sin(k));
      const flap = Math.sin(t * 22 + b.seed) * 1.1;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
      b.g.visible = n < 0.5;
    }

    // golden egg & honey glow
    if (this.eggVisible) this.egg.rotation.y = t * 1.5;
    this.honey.rotation.y = Math.sin(t) * 0.3;

    // moon flower: blooms when found, glows at night
    this.moonBloom = damp(this.moonBloom, this.moonTarget, 1.5, dt);
    const glow = this.moonBloom * (0.35 + 0.65 * n);
    this.moonMat.opacity = this.moonBloom;
    this.moonFlower.children.forEach((c) => {
      if (c.userData.petal) c.rotation.x = -0.2 - (1 - this.moonBloom) * 1.1;
    });
    ((this.moonFlower.userData.halo as THREE.Sprite).material as THREE.SpriteMaterial).opacity = glow * (0.75 + Math.sin(t * 2) * 0.1);

    // clover twinkles
    (this.cloverSpark.material as THREE.SpriteMaterial).opacity = 0.25 + Math.max(0, Math.sin(t * 2.3)) * 0.5;

    // fishing
    if (this.fishing >= 0) {
      this.fishT += dt;
      this.bobber.position.y = -0.004 + Math.sin(this.fishT * 6) * 0.0015 - (this.fishT > 1.8 && this.fishT < 2.1 ? 0.004 : 0);
      if (this.fishT > 2.1 && this.fishing === 0) {
        this.fishing = 1;
        this.fish.visible = true;
        this.onCatch(this.bobber.position.clone());
      }
      if (this.fishing === 1) {
        const k = clamp((this.fishT - 2.1) / 1.1);
        const p0 = this.bobber.position;
        this.fish.position.set(p0.x + k * 0.05, -0.004 + Math.sin(k * Math.PI) * 0.12, p0.z + k * 0.02);
        this.fish.rotation.x = k * 6;
        if (k >= 1) {
          this.fishing = -1;
          this.fish.visible = false;
          this.bobber.visible = false;
        }
      }
    }
  }

  private dudaFacing = 0;

  private updateDuda(dt: number, t: number, camera?: THREE.Vector3) {
    const p = this.duda.root.position;
    const stop = ROUTE[this.stop];
    const act = stop[3];
    this.talk = Math.max(0, this.talk - dt);
    let moving = false;
    if (this.talk > 0 && camera) {
      const c = this.group.worldToLocal(camera.clone());
      this.dudaFacing = dampAngle(this.dudaFacing, Math.atan2(c.x - p.x, c.z - p.z), 6, dt);
      this.duda.raiseArm(Math.max(0, Math.sin(t * 6)) * 0.6);
    } else if (this.pause > 0) {
      this.pause -= dt;
      const watering = act === 'water';
      this.can.visible = watering;
      this.duda.raiseArm(watering ? 0.55 : act === 'wave' ? 0.7 + Math.sin(t * 8) * 0.3 : 0);
      if (watering) this.dudaFacing = dampAngle(this.dudaFacing, stop[1] > 50 ? Math.PI / 2 : Math.PI, 3, dt);
      if (act === 'look') this.dudaFacing = dampAngle(this.dudaFacing, Math.PI, 2, dt);
      if (act === 'house') this.dudaFacing = dampAngle(this.dudaFacing, 0, 3, dt);
    } else {
      const next = ROUTE[(this.stop + 1) % ROUTE.length];
      const tx = vx(next[0]);
      const tz = vz(next[1]);
      const dx = tx - p.x;
      const dz = tz - p.z;
      const dist = Math.hypot(dx, dz);
      const speed = 0.055;
      this.can.visible = false;
      this.duda.raiseArm(0);
      if (dist < speed * dt + 1e-4) {
        p.x = tx;
        p.z = tz;
        this.stop = (this.stop + 1) % ROUTE.length;
        this.pause = ROUTE[this.stop][2];
      } else {
        p.x += (dx / dist) * speed * dt;
        p.z += (dz / dist) * speed * dt;
        this.dudaFacing = dampAngle(this.dudaFacing, Math.atan2(dx, dz), 8, dt);
        moving = true;
      }
    }
    this.duda.root.rotation.y = this.dudaFacing;
    if (moving) this.dudaLeg += dt * 9;
    this.duda.walk(this.dudaLeg, moving ? 1 : 0);

    // watering droplets
    const watering = this.pause > 0 && act === 'water' && this.talk <= 0;
    const tip = this.can.getWorldPosition(new THREE.Vector3());
    this.group.worldToLocal(tip);
    const fwd = new THREE.Vector3(Math.sin(this.dudaFacing), 0, Math.cos(this.dudaFacing));
    this.droplets.forEach((d, i) => {
      d.visible = watering;
      if (!watering) return;
      const k = (t * 1.6 + i / this.droplets.length) % 1;
      d.position.set(tip.x + fwd.x * (0.012 + k * 0.012), tip.y - k * tip.y, tip.z + fwd.z * (0.012 + k * 0.012));
    });
  }

  private updateDog(dt: number, t: number) {
    const d = this.dog;
    this.zzz.visible = !this.dogAwake;
    if (!this.dogAwake) {
      this.zzz.position.set(d.position.x + 0.01, 0.035 + ((t * 0.4) % 1) * 0.02, d.position.z);
      (this.zzz.material as THREE.SpriteMaterial).opacity = 1 - ((t * 0.4) % 1);
      d.scale.y = 0.75 + Math.sin(t * 1.8) * 0.03;
      this.dogTail.rotation.y = 0;
      return;
    }
    // follow Duda, a step behind
    const p = this.duda.root.position;
    const back = new THREE.Vector3(Math.sin(this.dudaFacing), 0, Math.cos(this.dudaFacing)).multiplyScalar(-0.035);
    const target = new THREE.Vector3(p.x + back.x + 0.018, 0, p.z + back.z);
    const dx = target.x - d.position.x;
    const dz = target.z - d.position.z;
    const dist = Math.hypot(dx, dz);
    const moving = dist > 0.01;
    if (moving) {
      const sp = Math.min(dist * 3, 0.09);
      d.position.x += (dx / dist) * sp * dt;
      d.position.z += (dz / dist) * sp * dt;
      d.rotation.y = dampAngle(d.rotation.y, Math.atan2(dx, dz), 8, dt);
    } else d.rotation.y = dampAngle(d.rotation.y, Math.atan2(p.x - d.position.x, p.z - d.position.z), 3, dt);
    this.dogHop = Math.max(0, this.dogHop - dt * 1.2);
    d.position.y = (moving ? Math.abs(Math.sin(t * 14)) * 0.004 : 0) + Math.abs(Math.sin(this.dogHop * 12)) * this.dogHop * 0.02;
    this.dogTail.rotation.y = Math.sin(t * (moving || this.dogHop > 0 ? 18 : 6)) * 0.7;
    this.dogHead.rotation.x = moving ? 0 : Math.sin(t * 0.7) * 0.15;
  }

  private updateChickens(dt: number, t: number) {
    this.chickenExcite = Math.max(0, this.chickenExcite - dt);
    const fast = this.chickenExcite > 0 ? 2.4 : 1;
    for (const c of this.chickens) {
      c.hop = Math.max(0, c.hop - dt * 0.8);
      const p = c.root.position;
      if (c.wait > 0) {
        c.wait -= dt * fast;
        if (c.head) c.head.rotation.x = Math.max(0, Math.sin(t * 9 + p.x * 40)) * 0.8;
      } else {
        const dx = c.target.x - p.x;
        const dz = c.target.y - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.01) {
          c.wait = range(Math.random, 0.8, 3.5);
          c.target.set(range(Math.random, c.bounds.x0, c.bounds.x1), range(Math.random, c.bounds.z0, c.bounds.z1));
        } else {
          p.x += (dx / d) * c.speed * fast * dt;
          p.z += (dz / d) * c.speed * fast * dt;
          c.root.rotation.y = dampAngle(c.root.rotation.y, Math.atan2(dx, dz), 8, dt);
          if (c.head) c.head.rotation.x = 0;
        }
      }
      p.y = Math.abs(Math.sin(c.hop * 14)) * c.hop * 0.015;
    }
  }
}

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    clipping: true,
    uniforms: { uTime: shared.uTime },
    vertexShader: `#include <clipping_planes_pars_vertex>
      varying vec2 vP;
      void main(){ vP = position.xy; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform float uTime; varying vec2 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }
      void main(){
        #include <clipping_planes_fragment>
        vec2 c = floor(vP * 160.0);
        float tw = step(0.94, h(c + floor(uTime * 2.5)));
        float wave = 0.5 + 0.5 * sin(vP.x * 70.0 + vP.y * 45.0 + uTime * 2.0);
        vec3 col = mix(vec3(0.18,0.55,0.74), vec3(0.34,0.72,0.88), wave * 0.6);
        col = mix(col, vec3(0.92,0.98,1.0), tw * 0.7);
        gl_FragColor = vec4(col, 0.88);
        #include <colorspace_fragment>
      }`,
  });
}

let zzzTex: THREE.Texture | null = null;
function zzzTexture() {
  if (zzzTex) return zzzTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 34px Manrope, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(40,30,60,0.6)';
  ctx.lineWidth = 4;
  ctx.strokeText('z', 8, 50);
  ctx.fillText('z', 8, 50);
  ctx.font = 'bold 24px Manrope, sans-serif';
  ctx.strokeText('z', 34, 26);
  ctx.fillText('z', 34, 26);
  zzzTex = new THREE.CanvasTexture(c);
  zzzTex.colorSpace = THREE.SRGBColorSpace;
  return zzzTex;
}

