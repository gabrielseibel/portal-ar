import * as THREE from 'three';
import type { QualitySettings } from '../../systems/Quality';
import { shared } from '../../systems/SharedUniforms';
import { ChimneySmoke, Fireflies } from '../../effects/Ambient';
import { glowTexture } from '../../utils/textures';
import { clamp, damp, dampAngle, distToPolyline, mulberry32, range, smoothstep } from '../../utils/math';
import { buildTerrain, edgeFactor, heightAt } from './terrain';
import {
  Batcher, PaintedPerson, blob, characterMaterial, buildTrees, cone, createMats, cropGeometry, greenhouse, building, localMatrix, scatter, sphere, townBuilding, type Mats, type TreeSpot,
} from './kit';
import {
  BARN, BRIDGES, CLOVER, COOP, DOG_BED, FARM, FARM_GATE, FIELDS, FOREST, GREENHOUSE, HIVES, HOUSE, LAKE, MAILBOX, MINE, MOUNTAINS, ORCHARD, PATHS, PEN, PIER, PLAZA, POND, RIVER,
  RIVER_W, ROUTE, SCARECROW, SEA, SEA_Y, SHED, TOWN_BUILDINGS, TOWN_HOMES, WALKERS, WATERFALL, inRect, rectCenter, type FieldKind, type P2,
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

export interface Walker {
  name: string;
  p: PaintedPerson;
  lines: readonly string[];
  route: readonly P2[];
  u: number;
  pause: number;
  leg: number;
}

const gy = (x: number, z: number) => Math.max(heightAt(x, z), 0);

/**
 * Vale da Duda: a whole valley painted in the style of the user's farmhouse
 * model — farm, town with plaza, river from the mountain lake, beach and
 * pier, forest. The farmhouse and the town homes are the user's GLB; the rest
 * is built here with painted canvas textures and smooth low-poly shapes.
 */
export class DudaWorld {
  readonly kind = 'duda' as const;
  readonly group = new THREE.Group();
  readonly proxies: Record<string, THREE.Mesh> = {};
  readonly sounds: THREE.Vector3[] = [];
  readonly trees: FarmTree[] = [];
  readonly villagers: Walker[] = [];
  /** Resolves when the farmhouse model is in place (never rejects). */
  readonly ready: Promise<void>;
  loadError: string | null = null;

  timeOfDay = 0.32;
  timeScale = 1;
  private night = 0;
  private quality: QualitySettings;
  private mats: Mats;
  private waterMat: THREE.ShaderMaterial;
  private fallMat: THREE.ShaderMaterial;
  private shake = new THREE.Vector4(0, 0, 0, 0.1);
  private extraMats: THREE.Material[] = [];

  readonly growth: Record<FieldKind, number> = { tomato: 1, pumpkin: 1, blueberry: 1, cauli: 1, strawberry: 1 };
  readonly harvested = new Set<FieldKind>();
  private crops: Array<{ kind: FieldKind; mesh: THREE.InstancedMesh; plots: Array<{ x: number; z: number; y: number; r: number; s: number }>; shown: number }> = [];

  readonly duda: PaintedPerson;
  private dudaLeg = 0;
  private dudaFacing = 0;
  private stop = 0;
  private pause = 2;
  talk = 0;
  private droplets: THREE.Mesh[] = [];
  private can: THREE.Object3D;

  private dog: THREE.Group;
  private dogTail: THREE.Object3D;
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
  private butterflies: Array<{ g: THREE.Group; wings: THREE.Object3D[]; home: THREE.Vector3; seed: number }> = [];
  private honey: THREE.Group;
  hiveTaps = 0;
  private moonFlower: THREE.Group;
  private moonMat: THREE.MeshBasicMaterial;
  moonBloom = 0;
  private moonTarget = 0;
  private clover: THREE.Group;
  private cloverSpark: THREE.Sprite;
  private lamps: THREE.Sprite[] = [];
  private fireflies: Fireflies;
  private smoke: ChimneySmoke;
  private houseSmoke: ChimneySmoke | null = null;
  private smokeBoost = 0;
  private clockHands: THREE.Object3D[] = [];
  private bobber: THREE.Mesh;
  private fish: THREE.Mesh;
  private fishMat: THREE.MeshStandardMaterial;
  private fishing = -1;
  private fishT = 0;
  private bobberY = 0;
  onCatch: (where: THREE.Vector3) => void = () => {};

  constructor(q: QualitySettings) {
    this.quality = q;
    this.group.name = 'vale-da-duda';
    const rng = mulberry32(1712);
    const shadows = q.shadows;
    this.mats = createMats();
    this.waterMat = waterMaterial();
    this.fallMat = fallMaterial();

    // terrain, water, cliffs
    const t = buildTerrain(q.level === 'economico' ? 0.7 : 1, this.waterMat, this.fallMat);
    t.ground.receiveShadow = shadows;
    t.cliffs.receiveShadow = shadows;
    this.group.add(t.ground, t.cliffs, t.underside, t.fall, ...t.water);
    this.extraMats.push(t.ground.material as THREE.Material, t.cliffs.material as THREE.Material);

    // buildings and props (merged per material)
    const b = new Batcher();
    const chimneys: THREE.Vector3[] = [];
    this.buildFarmBuildings(b, chimneys);
    this.buildTown(b, chimneys);
    this.buildProps(b, rng);
    this.group.add(b.build('vale-construcoes', shadows));
    this.smoke = new ChimneySmoke(chimneys, Math.max(3, Math.round(7 * q.particles)));
    this.group.add(this.smoke.points);

    // nature
    this.plantTrees(rng, q.trees);
    this.scatterNature(rng);
    this.buildCrops();

    // characters & animals
    this.duda = new PaintedPerson({ skin: '#f3c6a0', hair: '#c4552c', shirt: '#f2a7c3', pants: '#4a6fb5', hat: '#ecc76a', longHair: true });
    const [sx, sz] = ROUTE[0];
    this.duda.root.position.set(sx, gy(sx, sz), sz);
    this.can = blob([[new THREE.CylinderGeometry(0.006, 0.007, 0.01, 10), '#7fb1c9', 0, 0, 0], [new THREE.CylinderGeometry(0.0012, 0.0012, 0.012, 5).rotateZ(1.1), '#7fb1c9', 0.008, 0.003, 0]]);
    this.can.position.set(0.016, 0.026, 0.01);
    this.can.visible = false;
    this.duda.root.add(this.can);
    this.group.add(this.duda.root);
    const dropMat = new THREE.MeshBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.85 });
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 5, 4), dropMat);
      d.visible = false;
      this.droplets.push(d);
      this.group.add(d);
    }
    for (const w of WALKERS) {
      const [skin, hair, shirt, pants, hat] = w.style;
      const p = new PaintedPerson({ skin, hair, shirt, pants, hat, longHair: w.name === 'Lia' || w.name === 'Nina' });
      const [x, z] = w.route[0];
      p.root.position.set(x, gy(x, z), z);
      this.group.add(p.root);
      this.villagers.push({ name: w.name, p, lines: w.lines, route: w.route, u: rng(), pause: 0, leg: 0 });
    }
    ({ dog: this.dog, tail: this.dogTail } = this.buildDog());
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

    // fireflies over the pond, the orchard, the forest edge and the lake
    const ff: THREE.Vector3[] = [];
    const zones: Array<[number, number, number]> = [
      [POND.x, POND.z, 0.12],
      [-1.07, 0.8, 0.15],
      [-0.7, -0.35, 0.25],
      [0.75, 0.3, 0.15],
    ];
    for (let i = 0; i < Math.round(70 * q.particles); i++) {
      const [x, z, r] = zones[i % zones.length];
      const px = x + range(rng, -r, r);
      const pz = z + range(rng, -r, r);
      ff.push(new THREE.Vector3(px, gy(px, pz) + range(rng, 0.03, 0.14), pz));
    }
    this.fireflies = new Fireflies(ff, [new THREE.Color('#fff09a'), new THREE.Color('#d6ff8a')], 0.026, 0.03);
    this.group.add(this.fireflies.points);

    this.buildProxies();
    this.sounds.push(new THREE.Vector3(WATERFALL.x, 0.1, WATERFALL.bottom), new THREE.Vector3(SEA.x - 0.25, 0, SEA.z - 0.15), new THREE.Vector3(PLAZA.x, 0.05, PLAZA.z));

    this.ready = this.load(import.meta.env.BASE_URL).catch((e) => {
      this.loadError = String(e);
      console.error('[vale-da-duda]', e);
    });
  }

  // ================================================================== the user's farmhouse (+ town copies)
  private async load(base: string) {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(`${base}models/fazenda-da-duda/casa.glb`);
    const proto = gltf.scene;
    const place = (obj: THREE.Object3D, x: number, z: number, rot: number) => {
      obj.scale.setScalar(HOUSE.depth);
      obj.position.set(x, gy(x, z), z);
      obj.rotation.y = rot;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = this.quality.shadows;
      });
      this.group.add(obj);
    };
    proto.name = 'casa-da-duda';
    place(proto, HOUSE.x, HOUSE.z, 0);
    proto.updateMatrixWorld(true);
    // smoke from the model's own chimney
    let chimney: THREE.Mesh | null = null;
    proto.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'Farmhouse_5') chimney = m;
    });
    if (chimney) {
      const box = new THREE.Box3().setFromObject(chimney);
      const top = box.getCenter(new THREE.Vector3());
      top.y = box.max.y;
      this.group.worldToLocal(top);
      this.houseSmoke = new ChimneySmoke([top.add(new THREE.Vector3(0, 0.004, 0))], Math.max(4, Math.round(10 * this.quality.particles)));
      this.group.add(this.houseSmoke.points);
    }
    // town homes: the same model with re-tinted roofs
    for (const h of TOWN_HOMES) {
      const copy = proto.clone(true);
      copy.name = 'casa-vila';
      copy.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.name === 'Farmhouse_2') m.material = hueShifted(mat, h.roof);
      });
      place(copy, h.x, h.z, h.rot);
    }
  }

  // ================================================================== build: farm
  private buildFarmBuildings(b: Batcher, chimneys: THREE.Vector3[]) {
    const m = this.mats;
    b.at(GREENHOUSE.x, gy(GREENHOUSE.x, GREENHOUSE.z), GREENHOUSE.z);
    greenhouse(b, m, GREENHOUSE.w, GREENHOUSE.d);
    b.at(BARN.x, gy(BARN.x, BARN.z), BARN.z);
    building(b, { w: BARN.w, d: BARN.d, h: 0.1, wall: m.wall.red, roof: m.roof('#5b5f6e'), mats: m, roofH: 0.07, bigDoor: true, windows: 0 });
    b.box(0, 0.075, BARN.d / 2 + 0.002, 0.03, 0.022, 0.002, m.white);
    b.at(COOP.x, gy(COOP.x, COOP.z), COOP.z, -Math.PI / 2);
    building(b, { w: COOP.w, d: COOP.d, h: 0.055, wall: m.wall.wood, roof: m.roof('#3f8f8a'), mats: m, windows: 1 });
    b.at(SHED.x, gy(SHED.x, SHED.z), SHED.z, Math.PI / 2);
    const c = building(b, { w: SHED.w, d: SHED.d, h: 0.055, wall: m.wall.wood, roof: m.roof('#8e3b46'), mats: m, windows: 1, chimney: true });
    if (c) chimneys.push(c.applyMatrix4(b.frame));
    // beehives
    for (let i = 0; i < 3; i++) {
      b.at(HIVES.x - 0.05 + i * 0.05, gy(HIVES.x, HIVES.z), HIVES.z);
      b.box(0, 0, 0, 0.026, 0.006, 0.026, m.darkWood);
      b.box(0, 0.006, 0, 0.022, 0.026, 0.022, m.wall.wood);
      b.box(0, 0.032, 0, 0.028, 0.006, 0.028, m.roof('#c9874a'));
    }
    // fences around the farm (gate on the east side) and around the chicken pen
    this.fence(b, [
      [FARM[0], FARM[2]],
      [FARM[1], FARM[2]],
      [FARM[1], FARM_GATE[1] - 0.05],
    ]);
    this.fence(b, [
      [FARM[1], FARM_GATE[1] + 0.05],
      [FARM[1], FARM[3]],
      [FARM[0], FARM[3]],
      [FARM[0], FARM[2]],
    ]);
    this.fence(b, [
      [PEN[0], PEN[2]],
      [PEN[0], PEN[3]],
      [PEN[1], PEN[3]],
      [PEN[1], PEN[2]],
      [PEN[0] + 0.07, PEN[2]],
    ]);
    // mailbox, well, scarecrow
    b.at(MAILBOX.x, gy(MAILBOX.x, MAILBOX.z), MAILBOX.z);
    b.box(0, 0, 0, 0.005, 0.03, 0.005, m.darkWood);
    b.box(0, 0.03, 0, 0.014, 0.012, 0.022, m.wall.blue);
    b.at(-0.9, gy(-0.9, 0.38), 0.38);
    b.add(new THREE.CylinderGeometry(0.022, 0.024, 0.026, 14, 1, true), m.stone, localMatrix(0, 0.013, 0));
    b.box(-0.02, 0, 0, 0.004, 0.05, 0.004, m.darkWood);
    b.box(0.02, 0, 0, 0.004, 0.05, 0.004, m.darkWood);
    b.add(new THREE.ConeGeometry(0.034, 0.02, 4).rotateY(Math.PI / 4), m.roof('#8e3b46'), localMatrix(0, 0.06, 0));
    b.at(SCARECROW.x, gy(SCARECROW.x, SCARECROW.z), SCARECROW.z);
    b.box(0, 0, 0, 0.004, 0.06, 0.004, m.darkWood);
    b.box(0, 0.042, 0, 0.04, 0.004, 0.004, m.darkWood);
    b.box(0, 0.032, 0, 0.016, 0.02, 0.01, m.wall.blue);
    b.add(new THREE.SphereGeometry(0.008, 10, 8), m.wall.plaster, localMatrix(0, 0.062, 0));
    b.add(new THREE.ConeGeometry(0.012, 0.012, 10), m.roof('#d9a441'), localMatrix(0, 0.072, 0));
  }

  private fence(b: Batcher, pts: P2[]) {
    const m = this.mats.darkWood;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(L / 0.06));
      const yaw = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const z = az + ((bz - az) * k) / n;
        b.at(x, gy(x, z), z, yaw);
        b.box(0, 0, 0, 0.005, 0.028, 0.005, m);
        if (k < n) {
          const seg = L / n;
          b.box(0, 0.01, seg / 2, 0.003, 0.004, seg, m);
          b.box(0, 0.021, seg / 2, 0.003, 0.004, seg, m);
        }
      }
    }
  }

  // ================================================================== build: town
  private buildTown(b: Batcher, chimneys: THREE.Vector3[]) {
    const m = this.mats;
    for (const s of TOWN_BUILDINGS) {
      const c = townBuilding(b, s, m, gy(s.x, s.z));
      if (c) chimneys.push(c.applyMatrix4(b.frame));
      if (s.tower) {
        // clock hands follow the time of day
        for (let i = 0; i < 2; i++) {
          const hand = new THREE.Mesh(new THREE.BoxGeometry(0.0022, i ? 0.016 : 0.011, 0.001).translate(0, i ? 0.008 : 0.0055, 0), new THREE.MeshBasicMaterial({ color: '#3a2a1e' }));
          hand.position.set(s.x, gy(s.x, s.z) + s.h + 0.065, s.z + 0.0315);
          this.clockHands.push(hand);
          this.group.add(hand);
        }
      }
    }
    // fountain in the plaza
    const fy = gy(PLAZA.x, PLAZA.z);
    b.at(PLAZA.x, fy, PLAZA.z);
    b.add(new THREE.CylinderGeometry(0.06, 0.064, 0.022, 24, 1), m.stone, localMatrix(0, 0.011, 0));
    b.add(new THREE.CylinderGeometry(0.012, 0.016, 0.05, 10), m.stone, localMatrix(0, 0.025, 0));
    b.add(new THREE.CylinderGeometry(0.026, 0.018, 0.008, 16), m.stone, localMatrix(0, 0.05, 0));
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.054, 24).rotateX(-Math.PI / 2), this.waterMat);
    water.position.set(PLAZA.x, fy + 0.02, PLAZA.z);
    this.group.add(water);
    // benches and lamps around the plaza
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = PLAZA.x + Math.cos(a) * (PLAZA.r - 0.03);
      const z = PLAZA.z + Math.sin(a) * (PLAZA.r - 0.03);
      b.at(x, gy(x, z), z, -a + Math.PI / 2);
      b.box(0, 0.01, 0, 0.04, 0.004, 0.014, m.wood);
      b.box(0, 0.014, -0.007, 0.04, 0.012, 0.003, m.wood);
      for (const s of [-1, 1]) b.box(s * 0.017, 0, 0, 0.003, 0.01, 0.012, m.darkWood);
    }
    const lampSpots: P2[] = [
      [PLAZA.x - 0.12, PLAZA.z - 0.12],
      [PLAZA.x + 0.12, PLAZA.z - 0.12],
      [PLAZA.x - 0.12, PLAZA.z + 0.12],
      [PLAZA.x + 0.12, PLAZA.z + 0.12],
      [-0.12, 0.3],
      [0.62, 0.08],
      [0.6, 0.62],
      [-0.86, 0.66],
      [-0.26, 0.38],
    ];
    const tex = glowTexture();
    for (const [x, z] of lampSpots) {
      const y = gy(x, z);
      b.at(x, y, z);
      b.box(0, 0, 0, 0.005, 0.06, 0.005, m.darkWood);
      b.box(0, 0.06, 0, 0.012, 0.012, 0.012, m.glass);
      b.box(0, 0.072, 0, 0.015, 0.003, 0.015, m.darkWood);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffcf7e', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.set(x, y + 0.066, z);
      sp.scale.setScalar(0.07);
      this.lamps.push(sp);
      this.group.add(sp);
    }
    // bridges, pier, boats, mine entrance, barrels by the tavern
    for (const [x, z, yaw] of BRIDGES) {
      b.at(x, -0.004, z, yaw);
      b.add(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20, 1, false, -0.36, 0.72).rotateZ(Math.PI / 2).translate(0, -0.15, 0), m.wood);
      for (const s of [-1, 1]) {
        b.box(s * 0.028, 0.015, 0, 0.004, 0.004, 0.15, m.darkWood);
        for (const zz of [-0.06, 0, 0.06]) b.box(s * 0.028, 0, zz, 0.004, 0.02, 0.004, m.darkWood);
      }
    }
    const [[px0, pz0], [px1, pz1]] = PIER;
    const pierYaw = Math.atan2(px1 - px0, pz1 - pz0);
    const pierLen = Math.hypot(px1 - px0, pz1 - pz0);
    b.at(px0, SEA_Y + 0.012, pz0, pierYaw);
    b.box(0, 0, pierLen / 2, 0.05, 0.006, pierLen, m.wood);
    for (let k = 0; k <= 4; k++) for (const s of [-1, 1]) b.box(s * 0.022, -0.04, (pierLen * k) / 4, 0.006, 0.05, 0.006, m.darkWood);
    for (const [x, z, yaw, col] of [
      [0.84, 0.94, 0.4, '#d9534f'],
      [0.98, 0.8, -0.8, '#4f8fd8'],
    ] as Array<[number, number, number, string]>) {
      b.at(x, SEA_Y + 0.002, z, yaw);
      b.add(new THREE.SphereGeometry(0.03, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.55, 0.45, 1.25), m.roof(col));
      b.box(0, 0.001, 0, 0.026, 0.003, 0.06, m.wood);
    }
    const my = gy(MINE.x, MINE.z + 0.03);
    b.at(MINE.x, my, MINE.z + 0.03);
    b.add(new THREE.PlaneGeometry(0.045, 0.05), new THREE.MeshBasicMaterial({ color: '#1a1410' }), localMatrix(0, 0.025, 0.003));
    for (const s of [-1, 1]) b.box(s * 0.025, 0, 0.005, 0.006, 0.055, 0.006, m.darkWood);
    b.box(0, 0.052, 0.005, 0.06, 0.007, 0.007, m.darkWood);
    for (let i = 0; i < 3; i++) {
      b.at(0.44 + i * 0.022, gy(0.44, 0.04), 0.04 + (i % 2) * 0.02);
      b.add(new THREE.CylinderGeometry(0.009, 0.009, 0.022, 12), m.wood, localMatrix(0, 0.011, 0));
    }
  }

  // ================================================================== build: small props
  private buildProps(b: Batcher, rng: () => number) {
    const m = this.mats;
    // crates near the store and the barn
    for (const [x, z] of [
      [-0.2, -0.04],
      [-0.2, 0.0],
      [-0.42, 0.06],
    ] as P2[]) {
      b.at(x, gy(x, z), z, rng());
      b.box(0, 0, 0, 0.018, 0.018, 0.018, m.wood);
    }
    // signposts at the farm gate and by the bridge
    for (const [x, z, text] of [
      [FARM_GATE[0] + 0.03, FARM_GATE[1] - 0.06, 'Fazenda'],
      [0.62, -0.04, 'Montanha'],
      [0.56, 0.6, 'Praia'],
    ] as Array<[number, number, string]>) {
      b.at(x, gy(x, z), z, 0);
      b.box(0, 0, 0, 0.004, 0.045, 0.004, m.darkWood);
      b.add(new THREE.PlaneGeometry(0.05, 0.013), m.sign(text), localMatrix(0, 0.04, 0.003));
    }
  }

  // ================================================================== nature
  private blocked(x: number, z: number, margin: number) {
    if (edgeFactor(x, z) > 0.94) return true;
    if (inRect(x, z, FARM, -0.0) && !inRect(x, z, ORCHARD)) return true;
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + margin + 0.02) return true;
    for (const s of TOWN_BUILDINGS) if (Math.abs(x - s.x) < s.w / 2 + margin + 0.03 && Math.abs(z - s.z) < s.w / 2 + margin + 0.03) return true;
    for (const h of TOWN_HOMES) if (Math.hypot(x - h.x, z - h.z) < 0.17 + margin) return true;
    for (const p of PATHS) if (distToPolyline(x, z, p).d < 0.04 + margin) return true;
    if (distToPolyline(x, z, RIVER).d < RIVER_W * 1.8 + margin) return true;
    if (Math.hypot((x - SEA.x) * 0.9, z - SEA.z) < SEA.r + 0.02) return true;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 0.05) return true;
    if (Math.abs(x - WATERFALL.x) < 0.07 && z > WATERFALL.top - 0.05 && z < WATERFALL.bottom + 0.06) return true;
    if (Math.hypot(x - MINE.x, z - MINE.z) < 0.08) return true;
    if (heightAt(x, z) > 0.33) return true;
    return false;
  }

  private plantTrees(rng: () => number, count: number) {
    const spots: TreeSpot[] = [];
    const tryPlace = (x: number, z: number, kind: TreeSpot['kind'], s: number) => {
      if (this.blocked(x, z, 0.01)) return false;
      if (spots.some((t) => Math.hypot(t.x - x, t.z - z) < 0.055 * Math.max(s, t.s))) return false;
      spots.push({ x, y: heightAt(x, z), z, s, kind });
      return true;
    };
    // farm orchard (rows)
    const [ox0, ox1, oz0, oz1] = ORCHARD;
    const kinds: TreeSpot['kind'][] = ['apple', 'orange', 'blossom', 'apple', 'autumn', 'orange', 'blossom', 'apple', 'orange'];
    let k = 0;
    for (let z = oz0 + 0.04; z < oz1; z += 0.1) for (let x = ox0 + 0.04; x < ox1; x += 0.1) spots.push({ x, y: heightAt(x, z), z, s: 0.95, kind: kinds[k++ % kinds.length] });
    // forest in the west
    const forestN = Math.round(count * 1.1);
    for (let i = 0, n = 0; i < forestN * 6 && n < forestN; i++) {
      const x = range(rng, FOREST[0], FOREST[1]);
      const z = range(rng, FOREST[2], FOREST[3]);
      if (tryPlace(x, z, rng() < 0.45 ? 'pine' : rng() < 0.1 ? 'autumn' : 'green', 0.85 + rng() * 0.5)) n++;
    }
    // pines on the mountain slopes
    for (let i = 0, n = 0; i < 600 && n < Math.round(count * 0.55); i++) {
      const mtn = MOUNTAINS[Math.floor(rng() * MOUNTAINS.length)];
      const x = mtn.x + range(rng, -mtn.r, mtn.r) * 1.2;
      const z = mtn.z + range(rng, -mtn.r, mtn.r) * 1.2;
      const h = heightAt(x, z);
      if (h < 0.03 || h > 0.3) continue;
      if (tryPlace(x, z, 'pine', 0.7 + rng() * 0.4)) n++;
    }
    // scattered trees in town, by the river and around the rim
    for (let i = 0, n = 0; i < 900 && n < Math.round(count * 0.6); i++) {
      const x = range(rng, -1.35, 1.35);
      const z = range(rng, -1.1, 1.1);
      if (heightAt(x, z) > 0.06) continue;
      const kind: TreeSpot['kind'] = rng() < 0.18 ? 'blossom' : rng() < 0.12 ? 'autumn' : 'green';
      if (tryPlace(x, z, kind, 0.8 + rng() * 0.4)) n++;
    }
    // a few trees inside the farm, along the back fence
    for (const x of [-1.2, -0.62, -0.55]) spots.push({ x, y: heightAt(x, -0.06), z: -0.06, s: 0.9, kind: x < -1 ? 'blossom' : 'green' });

    const { group, materials } = buildTrees(spots, this.shake, this.quality.shadows);
    this.extraMats.push(...materials);
    this.group.add(group);
    for (const s of spots) {
      const c = new THREE.Vector3(s.x, s.y + 0.08 * s.s, s.z);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.045 * s.s, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
      p.position.copy(c);
      p.name = 'tree-hit';
      this.group.add(p);
      this.trees.push({ proxy: p, kind: s.kind, center: c, top: s.y + 0.11 * s.s });
    }
  }

  private scatterNature(rng: () => number) {
    const flowers: Array<[number, number, number, number, number, string]> = [];
    const bushes: Array<[number, number, number, number, number, string]> = [];
    const rocks: Array<[number, number, number, number, number, string]> = [];
    const petal = ['#ffffff', '#ffe14d', '#ff8ab6', '#b48cff', '#ff6a4a', '#ffb36b'];
    for (let i = 0; i < 2600; i++) {
      const x = range(rng, -1.38, 1.38);
      const z = range(rng, -1.15, 1.15);
      if (this.blocked(x, z, -0.02)) continue;
      const h = heightAt(x, z);
      if (h > 0.08) {
        if (rng() < 0.5) rocks.push([x, h, z, 0.6 + rng() * 1.4, rng() * 6, rng() < 0.5 ? '#8a8378' : '#a09888']);
        continue;
      }
      if (flowers.length < 520 && rng() < 0.6) flowers.push([x, h + 0.003, z, 0.7 + rng() * 0.6, 0, petal[Math.floor(rng() * petal.length)]]);
      else if (bushes.length < 160) bushes.push([x, h, z, 0.7 + rng() * 0.8, rng() * 6, rng() < 0.5 ? '#4f9a3a' : '#3f8a34']);
    }
    // rocks along the bay rim and the river banks
    for (let i = 0; i < 70; i++) {
      const a = range(rng, -0.4, 1.9);
      const x = SEA.x + Math.cos(a) * SEA.r * range(rng, 0.92, 1.1);
      const z = SEA.z + Math.sin(a) * SEA.r * range(rng, 0.92, 1.1);
      if (edgeFactor(x, z) > 1) continue;
      rocks.push([x, Math.max(heightAt(x, z), SEA_Y), z, 1 + rng() * 1.6, rng() * 6, '#8f877c']);
    }
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
    const fMat = std({});
    const bMat = std({});
    const rMat = std({ flatShading: true, roughness: 1 });
    this.extraMats.push(fMat, bMat, rMat);
    this.group.add(
      scatter(new THREE.IcosahedronGeometry(0.0045, 0), fMat, flowers),
      scatter(new THREE.IcosahedronGeometry(0.018, 1).scale(1, 0.75, 1).translate(0, 0.01, 0), bMat, bushes, this.quality.shadows),
      scatter(new THREE.DodecahedronGeometry(0.014, 0).scale(1, 0.6, 1), rMat, rocks, this.quality.shadows),
    );
  }

  private buildCrops() {
    const rng = mulberry32(31);
    for (const k of Object.keys(FIELDS) as FieldKind[]) {
      const [x0, x1, z0, z1] = FIELDS[k];
      const plots: Array<{ x: number; z: number; y: number; r: number; s: number }> = [];
      for (let z = z0 + 0.016; z < z1 - 0.008; z += 0.026) for (let x = x0 + 0.014; x < x1 - 0.006; x += 0.026) plots.push({ x, z, y: heightAt(x, z), r: rng(), s: 0.9 + rng() * 0.3 });
      const mesh = new THREE.InstancedMesh(cropGeometry(k), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), plots.length);
      mesh.name = `plantacao-${k}`;
      mesh.castShadow = this.quality.shadows;
      mesh.receiveShadow = true;
      this.extraMats.push(mesh.material as THREE.Material);
      this.group.add(mesh);
      this.crops.push({ kind: k, mesh, plots, shown: -1 });
    }
    this.updateCrops();
  }

  private updateCrops() {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const c of this.crops) {
      const g = this.growth[c.kind];
      if (Math.abs(g - c.shown) < 0.004) continue;
      c.shown = g;
      c.plots.forEach((p, i) => {
        const k = smoothstep(p.r * 0.4, p.r * 0.4 + 0.6, g);
        const s = Math.max(0.0001, k) * p.s;
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.r * 6), new THREE.Vector3(0.4 * s + 0.6 * k * p.s, s, 0.4 * s + 0.6 * k * p.s));
        c.mesh.setMatrixAt(i, m);
      });
      c.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ================================================================== animals & secrets
  private buildDog() {
    const fur = '#d9a066';
    const dark = '#9a6334';
    const dog = new THREE.Group();
    dog.add(blob([
      [sphere(0.011, 0.9, 0.85, 1.5), fur, 0, 0.012, 0],
      [sphere(0.009), fur, 0, 0.02, 0.015],
      [sphere(0.005, 1, 0.8, 1.2), '#f0d2a8', 0, 0.017, 0.022],
      [sphere(0.0018), '#2a1c14', 0, 0.018, 0.027],
      [sphere(0.004, 0.6, 1.3, 1), dark, -0.0075, 0.02, 0.013],
      [sphere(0.004, 0.6, 1.3, 1), dark, 0.0075, 0.02, 0.013],
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => [new THREE.CylinderGeometry(0.0028, 0.0028, 0.01, 6), fur, sx * 0.006, 0.005, sz * 0.009] as [THREE.BufferGeometry, string, number, number, number])),
    ]));
    const tail = new THREE.Group();
    tail.position.set(0, 0.016, -0.015);
    tail.add(blob([[new THREE.CapsuleGeometry(0.002, 0.01, 2, 6).rotateX(-0.6), dark, 0, 0.004, -0.004]]));
    dog.add(tail);
    dog.position.set(DOG_BED.x, gy(DOG_BED.x, DOG_BED.z), DOG_BED.z);
    dog.rotation.y = 0.6;
    dog.scale.y = 0.75;
    this.group.add(dog);
    return { dog, tail };
  }

  private buildChickens(rng: () => number) {
    const bounds = { x0: PEN[0] + 0.02, x1: PEN[1] - 0.02, z0: PEN[2] + 0.02, z1: PEN[3] - 0.02 };
    for (let i = 0; i < 5; i++) {
      const body = i === 2 ? '#c9874a' : '#f7f3ea';
      const root = blob([[sphere(0.008, 1, 0.95, 1.2), body, 0, 0.009, 0], [sphere(0.004), '#f2b23a', 0, 0.002, 0], [cone(0.004, 0.009, -0.9), body, 0, 0.012, -0.009]]);
      const head = blob([[sphere(0.0055), body, 0, 0, 0], [sphere(0.0028, 0.6, 1, 1.2), '#e3402f', 0, 0.005, 0], [cone(0.0018, 0.004, Math.PI / 2), '#f2b23a', 0, 0, 0.006]]);
      head.position.set(0, 0.018, 0.007);
      root.add(head);
      const x = range(rng, bounds.x0, bounds.x1);
      const z = range(rng, bounds.z0, bounds.z1);
      root.position.set(x, gy(x, z), z);
      this.group.add(root);
      this.chickens.push({ root, head, target: new THREE.Vector2(x, z), bounds, speed: 0.04, wait: rng() * 2, hop: 0 });
    }
  }

  private buildEgg() {
    const g = new THREE.Group();
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 10), new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffb21a', emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }));
    egg.scale.set(1, 1.3, 1);
    egg.position.y = 0.009;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe08a', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(0.045);
    halo.position.y = 0.012;
    g.add(egg, halo);
    const [x, z] = rectCenter(PEN);
    g.position.set(x - 0.03, gy(x, z), z + 0.03);
    g.visible = false;
    this.group.add(g);
    return g;
  }

  private buildDucks() {
    for (let i = 0; i < 3; i++) {
      const d = blob([[sphere(0.007, 0.9, 0.7, 1.3), '#fafafa', 0, 0.003, 0], [sphere(0.0045), i === 1 ? '#2f8a5a' : '#fafafa', 0, 0.009, 0.006], [cone(0.002, 0.005, Math.PI / 2), '#f2a23a', 0, 0.008, 0.011]]);
      d.userData.ph = i * 2.1;
      d.userData.sea = i === 2;
      this.ducks.push(d);
      this.group.add(d);
    }
  }

  private buildBees() {
    const n = Math.round(14 * Math.max(0.5, this.quality.particles));
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0022, 5, 4).scale(1, 0.8, 1.3), new THREE.MeshBasicMaterial({ color: '#ffd23f' }), n);
    m.name = 'abelhas';
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  private buildButterflies(rng: () => number) {
    const colors = ['#ff9ad5', '#ffe14d', '#9fd3ff', '#ffffff', '#c7a6ff', '#ffb36b', '#ff9ad5', '#ffe14d'];
    const homes: P2[] = [
      [-0.68, 0.9],
      [-0.4, 0.92],
      [-0.85, 0.5],
      [0.1, 0.62],
      [0.4, 0.2],
      [-0.2, -0.3],
      [0.62, 0.42],
      [-0.1, 0.8],
    ];
    homes.forEach(([x, z], i) => {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
      const wings: THREE.Object3D[] = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CircleGeometry(0.005, 8).scale(1, 0.8, 1).translate(0.005 * s, 0, 0), mat);
        w.rotation.x = -Math.PI / 2;
        const pivot = new THREE.Group();
        pivot.add(w);
        g.add(pivot);
        wings.push(pivot);
      }
      const home = new THREE.Vector3(x, gy(x, z) + 0.05, z);
      g.position.copy(home);
      this.group.add(g);
      this.butterflies.push({ g, wings, home, seed: rng() * 10 });
    });
  }

  private buildHoney() {
    const g = blob([[new THREE.CylinderGeometry(0.007, 0.007, 0.013, 12), '#f7b21f', 0, 0.0065, 0], [new THREE.CylinderGeometry(0.0075, 0.0075, 0.003, 12), '#c9874a', 0, 0.0145, 0]]);
    g.position.set(HIVES.x, gy(HIVES.x, HIVES.z) + 0.038, HIVES.z);
    g.visible = false;
    this.group.add(g);
    return g;
  }

  private buildMoonFlower() {
    const g = new THREE.Group();
    g.add(blob([[new THREE.CylinderGeometry(0.0012, 0.0015, 0.03, 5), '#3e8a3a', 0, 0.015, 0], [sphere(0.004, 1.6, 0.4, 0.8), '#4fb03f', 0.005, 0.012, 0]]));
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6).scale(0.7, 0.25, 1.8).translate(0, 0, 0.006), this.moonMat);
      p.position.y = 0.03;
      p.rotation.y = (i / 6) * Math.PI * 2;
      p.userData.petal = true;
      g.add(p);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#bfe9ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(0.12);
    halo.position.y = 0.03;
    g.userData.halo = halo;
    g.add(halo);
    g.position.set(GREENHOUSE.x, gy(GREENHOUSE.x, GREENHOUSE.z) + 0.012, GREENHOUSE.z);
    g.scale.setScalar(1.4);
    this.group.add(g);
    // planters inside the greenhouse
    const pots: Array<[number, number, number, number, number, string]> = [];
    const cols = ['#ff7eb6', '#ffe14d', '#b48cff', '#ff4d4d', '#fffaf0'];
    for (let i = 0; i < 14; i++) {
      const row = i < 7 ? -1 : 1;
      pots.push([GREENHOUSE.x - 0.08 + (i % 7) * 0.027, gy(GREENHOUSE.x, GREENHOUSE.z) + 0.02, GREENHOUSE.z + row * 0.055, 1, 0, cols[i % cols.length]]);
    }
    const pm = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.extraMats.push(pm);
    this.group.add(scatter(new THREE.IcosahedronGeometry(0.008, 1), pm, pots));
    return g;
  }

  private buildClover() {
    const g = blob([
      [new THREE.CylinderGeometry(0.0007, 0.0007, 0.008, 4), '#2a8a3a', 0, 0.004, 0],
      ...[0, 1, 2, 3].map((i) => [sphere(0.0028, 1, 0.35, 1), '#2fbf4a', Math.cos((i * Math.PI) / 2) * 0.003, 0.008, Math.sin((i * Math.PI) / 2) * 0.003] as [THREE.BufferGeometry, string, number, number, number]),
    ]);
    g.position.set(CLOVER.x, gy(CLOVER.x, CLOVER.z), CLOVER.z);
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
    const mat = new THREE.MeshStandardMaterial({ color: '#9fd3ff', emissive: '#3a6cff', emissiveIntensity: 0.15, roughness: 0.4 });
    const fish = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8).scale(0.8, 1, 2.2), mat);
    fish.visible = false;
    this.group.add(bobber, fish);
    return { bobber, fish, mat };
  }

  private proxy(name: string, p: THREE.Vector3, r: number, h?: number, box?: [number, number, number], yaw = 0) {
    const geo = box ? new THREE.BoxGeometry(...box) : h ? new THREE.CylinderGeometry(r, r, h, 12) : new THREE.SphereGeometry(r, 10, 8);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    m.position.copy(p);
    m.rotation.y = yaw;
    m.name = `${name}-hit`;
    this.group.add(m);
    this.proxies[name] = m;
    return m;
  }

  private buildProxies() {
    const at = (x: number, z: number, dy: number) => new THREE.Vector3(x, gy(x, z) + dy, z);
    const hw = HOUSE.depth * 0.76;
    this.proxy('house', at(HOUSE.x, HOUSE.z, 0.08), 0, 0, [hw, 0.18, HOUSE.depth]);
    this.proxy('greenhouse', at(GREENHOUSE.x, GREENHOUSE.z, 0.05), 0, 0, [GREENHOUSE.w, 0.11, GREENHOUSE.d]);
    this.proxy('barn', at(BARN.x, BARN.z, 0.07), 0, 0, [BARN.w, 0.15, BARN.d]);
    this.proxy('coop', at(COOP.x, COOP.z, 0.04), 0, 0, [COOP.d, 0.09, COOP.w]);
    const [px, pz] = rectCenter(PEN);
    this.proxy('chickens', at(px, pz, 0.02), 0, 0, [PEN[1] - PEN[0], 0.05, PEN[3] - PEN[2]]);
    this.proxy('hives', at(HIVES.x, HIVES.z, 0.025), 0, 0, [0.15, 0.05, 0.04]);
    this.proxy('shed', at(SHED.x, SHED.z, 0.04), 0, 0, [SHED.d, 0.09, SHED.w]);
    this.proxy('pond', at(POND.x, POND.z, 0.0), POND.r, 0.03);
    this.proxy('scarecrow', at(SCARECROW.x, SCARECROW.z, 0.04), 0.018, 0.08);
    for (const k of Object.keys(FIELDS) as FieldKind[]) {
      const f = FIELDS[k];
      const [x, z] = rectCenter(f);
      this.proxy(`field:${k}`, at(x, z, 0.015), 0, 0, [f[1] - f[0], 0.04, f[3] - f[2]]);
    }
    for (const s of TOWN_BUILDINGS) this.proxy(s.id, at(s.x, s.z, s.h * 0.7), 0, 0, [s.w, s.h * 1.5, s.d], s.rot);
    TOWN_HOMES.forEach((h, i) => this.proxy(`home${i}`, at(h.x, h.z, 0.08), 0, 0, [hw, 0.18, HOUSE.depth], h.rot));
    this.proxy('fountain', at(PLAZA.x, PLAZA.z, 0.03), 0.065, 0.06);
    const [[ax, az], [bx, bz]] = PIER;
    this.proxy('pier', new THREE.Vector3((ax + bx) / 2, SEA_Y + 0.02, (az + bz) / 2), 0, 0, [0.06, 0.04, Math.hypot(bx - ax, bz - az)], Math.atan2(bx - ax, bz - az));
    this.proxy('mine', at(MINE.x, MINE.z + 0.03, 0.03), 0.035);
    this.proxy('waterfall', new THREE.Vector3(WATERFALL.x, LAKE.y * 0.5, (WATERFALL.top + WATERFALL.bottom) / 2), 0.05);
    this.proxy('dog', new THREE.Vector3(), 0.025);
    this.proxies.dog.removeFromParent();
    this.dog.add(this.proxies.dog);
    this.proxies.dog.position.set(0, 0.012, 0);
    this.proxy('egg', new THREE.Vector3(), 0.022);
    this.proxies.egg.removeFromParent();
    this.egg.add(this.proxies.egg);
    this.proxy('clover', this.clover.position.clone().setY(this.clover.position.y + 0.01), 0.025);
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

  harvest(k: FieldKind) {
    if (this.growth[k] < 0.92) return false;
    this.growth[k] = 0;
    this.harvested.add(k);
    return true;
  }

  fieldCenter(k: FieldKind) {
    const [x, z] = rectCenter(FIELDS[k]);
    return new THREE.Vector3(x, gy(x, z) + 0.03, z);
  }

  shakeTree(t: FarmTree) {
    this.shake.set(t.center.x, t.center.z, 1, 0.07);
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
    this.houseSmoke?.puff(true);
    this.smoke.puff(true);
  }

  /** Casts a line in the farm pond or off the pier. */
  cast(where: 'pond' | 'pier' = 'pond'): boolean {
    if (this.fishing >= 0) return false;
    if (where === 'pier') {
      const [, [x, z]] = PIER;
      this.bobber.position.set(x + range(Math.random, -0.03, 0.06), SEA_Y, z + range(Math.random, 0.02, 0.08));
    } else this.bobber.position.set(POND.x + range(Math.random, -0.05, 0.05), -0.017, POND.z + range(Math.random, -0.04, 0.04));
    this.bobberY = this.bobber.position.y;
    this.bobber.visible = true;
    this.fishing = 0;
    this.fishT = 0;
    return true;
  }

  setFishLook(legendary: boolean) {
    this.fishMat.color.set(legendary ? '#ff7ad9' : '#9fd3ff');
    this.fishMat.emissive.set(legendary ? '#ffb21a' : '#3a6cff');
    this.fishMat.emissiveIntensity = legendary ? 0.6 : 0.15;
  }

  greet(seconds = 4) {
    this.talk = Math.max(this.talk, seconds);
  }

  // ================================================================== world API used by Stage / Experience
  materials(): THREE.Material[] {
    const out = new Set<THREE.Material>([...this.extraMats, ...this.mats.all(), this.waterMat, this.fallMat, characterMaterial()]);
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => out.add(x));
    });
    return [...out];
  }

  setDetailDistance(_d: number) {
    /* no separate detail layer */
  }

  reset() {
    this.talk = 0;
  }

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

    for (const l of this.lamps) (l.material as THREE.SpriteMaterial).opacity = n * (0.7 + Math.sin(t * 3 + l.position.x * 20) * 0.06);
    this.mats.window.emissiveIntensity = n * 1.3;
    this.fireflies.mat.uniforms.uIntensity.value = n;
    this.smoke.update(dt);
    this.houseSmoke?.update(dt);
    if (this.smokeBoost > 0 && (this.smokeBoost -= dt) <= 0) {
      this.houseSmoke?.puff(false);
      this.smoke.puff(false);
    }
    const hours = this.timeOfDay * 24;
    if (this.clockHands.length === 2) {
      this.clockHands[0].rotation.z = -((hours % 12) / 12) * Math.PI * 2;
      this.clockHands[1].rotation.z = -((hours % 1) * Math.PI * 2);
    }

    this.shake.z = Math.max(0, this.shake.z - dt * 1.2);
    for (const k of Object.keys(this.growth) as FieldKind[]) this.growth[k] = Math.min(1, this.growth[k] + dt / REGROW);
    this.updateCrops();

    this.updateDuda(dt, t, camera);
    this.updateWalkers(dt);
    this.updateDog(dt, t);
    this.updateChickens(dt, t);

    this.ducks.forEach((d, i) => {
      const a = t * 0.16 + d.userData.ph;
      if (d.userData.sea) d.position.set(SEA.x - 0.25 + Math.cos(a) * 0.1, SEA_Y + Math.sin(t * 2 + i) * 0.0008, SEA.z - 0.12 + Math.sin(a) * 0.06);
      else d.position.set(POND.x + Math.cos(a) * (0.04 + i * 0.02), -0.017 + Math.sin(t * 2 + i) * 0.0008, POND.z + Math.sin(a) * (0.035 + i * 0.012));
      d.rotation.y = -a;
    });

    this.beeBoost = Math.max(0, this.beeBoost - dt);
    const hc = new THREE.Vector3(HIVES.x, gy(HIVES.x, HIVES.z) + 0.04, HIVES.z);
    const m = new THREE.Matrix4();
    const rad = 0.04 + this.beeBoost * 0.012;
    for (let i = 0; i < this.bees.count; i++) {
      const s = i * 1.7;
      const a = t * (1.4 + (i % 3) * 0.4) * (i % 2 ? 1 : -1) + s;
      m.makeRotationY(-a).setPosition(hc.x + Math.cos(a) * rad * (0.8 + (i % 4) * 0.15), hc.y + Math.sin(t * 5 + s) * 0.012, hc.z + Math.sin(a) * rad * 0.7);
      this.bees.setMatrixAt(i, m);
    }
    this.bees.instanceMatrix.needsUpdate = true;
    this.bees.visible = n < 0.8;

    for (const b of this.butterflies) {
      const k = t * 0.35 + b.seed;
      b.g.position.set(b.home.x + Math.sin(k * 1.3) * 0.06, b.home.y + Math.sin(k * 3.1) * 0.015, b.home.z + Math.cos(k) * 0.05);
      b.g.rotation.y = Math.atan2(Math.cos(k * 1.3) * 1.3, -Math.sin(k));
      const flap = Math.sin(t * 22 + b.seed) * 1.1;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
      b.g.visible = n < 0.5;
    }

    if (this.eggVisible) this.egg.rotation.y = t * 1.5;
    this.honey.rotation.y = Math.sin(t) * 0.3;

    this.moonBloom = damp(this.moonBloom, this.moonTarget, 1.5, dt);
    this.moonMat.opacity = this.moonBloom;
    this.moonFlower.children.forEach((c) => {
      if (c.userData.petal) c.rotation.x = -0.2 - (1 - this.moonBloom) * 1.1;
    });
    ((this.moonFlower.userData.halo as THREE.Sprite).material as THREE.SpriteMaterial).opacity = this.moonBloom * (0.35 + 0.65 * n) * (0.75 + Math.sin(t * 2) * 0.1);
    (this.cloverSpark.material as THREE.SpriteMaterial).opacity = 0.25 + Math.max(0, Math.sin(t * 2.3)) * 0.5;

    if (this.fishing >= 0) {
      this.fishT += dt;
      this.bobber.position.y = this.bobberY + Math.sin(this.fishT * 6) * 0.0015 - (this.fishT > 1.8 && this.fishT < 2.1 ? 0.004 : 0);
      if (this.fishT > 2.1 && this.fishing === 0) {
        this.fishing = 1;
        this.fish.visible = true;
        this.onCatch(this.bobber.position.clone());
      }
      if (this.fishing === 1) {
        const k = clamp((this.fishT - 2.1) / 1.1);
        const p0 = this.bobber.position;
        this.fish.position.set(p0.x + k * 0.05, p0.y + Math.sin(k * Math.PI) * 0.12, p0.z + k * 0.02);
        this.fish.rotation.x = k * 6;
        if (k >= 1) {
          this.fishing = -1;
          this.fish.visible = false;
          this.bobber.visible = false;
        }
      }
    }
  }

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
      if (watering) this.dudaFacing = dampAngle(this.dudaFacing, Math.PI, 3, dt);
      if (act === 'look') this.dudaFacing = dampAngle(this.dudaFacing, 0, 2, dt);
      if (act === 'house') this.dudaFacing = dampAngle(this.dudaFacing, Math.PI, 3, dt);
    } else {
      const next = ROUTE[(this.stop + 1) % ROUTE.length];
      const dx = next[0] - p.x;
      const dz = next[1] - p.z;
      const dist = Math.hypot(dx, dz);
      const speed = 0.06;
      this.can.visible = false;
      this.duda.raiseArm(0);
      if (dist < speed * dt + 1e-4) {
        p.x = next[0];
        p.z = next[1];
        this.stop = (this.stop + 1) % ROUTE.length;
        this.pause = ROUTE[this.stop][2];
      } else {
        p.x += (dx / dist) * speed * dt;
        p.z += (dz / dist) * speed * dt;
        this.dudaFacing = dampAngle(this.dudaFacing, Math.atan2(dx, dz), 8, dt);
        moving = true;
      }
    }
    p.y = gy(p.x, p.z);
    this.duda.root.rotation.y = this.dudaFacing;
    if (moving) this.dudaLeg += dt * 10;
    this.duda.walk(this.dudaLeg, moving ? 1 : 0);

    const watering = this.pause > 0 && act === 'water' && this.talk <= 0;
    const tip = this.can.getWorldPosition(new THREE.Vector3());
    this.group.worldToLocal(tip);
    const fwd = new THREE.Vector3(Math.sin(this.dudaFacing), 0, Math.cos(this.dudaFacing));
    this.droplets.forEach((d, i) => {
      d.visible = watering;
      if (!watering) return;
      const k = (t * 1.6 + i / this.droplets.length) % 1;
      d.position.set(tip.x + fwd.x * (0.012 + k * 0.012), tip.y - k * (tip.y - p.y), tip.z + fwd.z * (0.012 + k * 0.012));
    });
  }

  private updateWalkers(dt: number) {
    for (const v of this.villagers) {
      const p = v.p.root.position;
      if (v.pause > 0) {
        v.pause -= dt;
        v.p.walk(0, 0);
        continue;
      }
      const r = v.route;
      const total = r.reduce((s, _q, i) => s + Math.hypot(r[(i + 1) % r.length][0] - r[i][0], r[(i + 1) % r.length][1] - r[i][1]), 0);
      v.u = (v.u + (dt * 0.035) / total) % 1;
      let d = v.u * total;
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (d <= L) {
          const k = d / L;
          p.set(a[0] + (b[0] - a[0]) * k, 0, a[1] + (b[1] - a[1]) * k);
          v.p.root.rotation.y = dampAngle(v.p.root.rotation.y, Math.atan2(b[0] - a[0], b[1] - a[1]), 6, dt);
          break;
        }
        d -= L;
      }
      p.y = gy(p.x, p.z);
      v.leg += dt * 8;
      v.p.walk(v.leg, 1);
    }
  }

  private updateDog(dt: number, t: number) {
    const d = this.dog;
    this.zzz.visible = !this.dogAwake;
    if (!this.dogAwake) {
      this.zzz.position.set(d.position.x + 0.01, d.position.y + 0.035 + ((t * 0.4) % 1) * 0.02, d.position.z);
      (this.zzz.material as THREE.SpriteMaterial).opacity = 1 - ((t * 0.4) % 1);
      d.scale.y = 0.75 + Math.sin(t * 1.8) * 0.03;
      return;
    }
    const p = this.duda.root.position;
    const back = new THREE.Vector3(Math.sin(this.dudaFacing), 0, Math.cos(this.dudaFacing)).multiplyScalar(-0.035);
    const tx = p.x + back.x + 0.018;
    const tz = p.z + back.z;
    const dx = tx - d.position.x;
    const dz = tz - d.position.z;
    const dist = Math.hypot(dx, dz);
    const moving = dist > 0.01;
    if (moving) {
      const sp = Math.min(dist * 3, 0.1);
      d.position.x += (dx / dist) * sp * dt;
      d.position.z += (dz / dist) * sp * dt;
      d.rotation.y = dampAngle(d.rotation.y, Math.atan2(dx, dz), 8, dt);
    } else d.rotation.y = dampAngle(d.rotation.y, Math.atan2(p.x - d.position.x, p.z - d.position.z), 3, dt);
    this.dogHop = Math.max(0, this.dogHop - dt * 1.2);
    d.position.y = gy(d.position.x, d.position.z) + (moving ? Math.abs(Math.sin(t * 14)) * 0.004 : 0) + Math.abs(Math.sin(this.dogHop * 12)) * this.dogHop * 0.02;
    this.dogTail.rotation.y = Math.sin(t * (moving || this.dogHop > 0 ? 18 : 6)) * 0.7;
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
      p.y = gy(p.x, p.z) + Math.abs(Math.sin(c.hop * 14)) * c.hop * 0.015;
    }
  }
}

// ------------------------------------------------------------------ materials
/** Roof recoloured by rotating its hue toward `hex` (keeps the painted detail of the texture). */
function hueShifted(src: THREE.MeshStandardMaterial, hex: string) {
  const mat = src.clone();
  const target = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  target.getHSL(hsl);
  const shift = hsl.h * Math.PI * 2 - 0.05 * Math.PI * 2; // the roof texture is red-orange (≈ 0.03)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHue = { value: shift };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHue;').replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 yiq = toYIQ * diffuseColor.rgb;
        float c = cos(uHue), s = sin(uHue);
        yiq.yz = mat2(c, -s, s, c) * yiq.yz;
        diffuseColor.rgb = max(toRGB * yiq, 0.0);
      }`,
    );
  };
  mat.customProgramCacheKey = () => `hue-${hex}`;
  return mat;
}

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    clipping: true,
    uniforms: { uTime: shared.uTime },
    vertexShader: `#include <clipping_planes_pars_vertex>
      varying vec3 vW;
      void main(){ vW = position; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }
      void main(){
        #include <clipping_planes_fragment>
        vec2 p = vW.xz * 40.0;
        float wave = 0.5 + 0.5 * sin(p.x * 1.7 + p.y * 1.1 + uTime * 1.8) * sin(p.y * 1.3 - uTime * 1.2);
        vec2 c = floor(vW.xz * 140.0);
        float tw = step(0.95, h(c + floor(uTime * 2.0)));
        vec3 col = mix(vec3(0.16,0.5,0.72), vec3(0.36,0.74,0.9), wave * 0.65);
        col = mix(col, vec3(0.95,0.99,1.0), tw * 0.6);
        gl_FragColor = vec4(col, 0.86);
        #include <colorspace_fragment>
      }`,
  });
}

function fallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: { uTime: shared.uTime },
    vertexShader: `#include <clipping_planes_pars_vertex>
      varying vec2 vUv; void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform float uTime; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9,78.2)))*43758.5); }
      void main(){
        #include <clipping_planes_fragment>
        vec2 c = floor(vec2(vUv.x * 10.0, vUv.y * 16.0 + uTime * 9.0));
        vec3 col = mix(vec3(0.42,0.74,0.9), vec3(0.96,0.99,1.0), step(0.55, h(c)));
        float foam = smoothstep(0.15, 0.0, vUv.y);
        col = mix(col, vec3(1.0), foam);
        gl_FragColor = vec4(col, 0.85 + foam * 0.12);
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
