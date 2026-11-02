import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualitySettings } from '../../systems/Quality';
import { shared, POINT_SIZE_GLSL } from '../../systems/SharedUniforms';
import { StaticBatch } from '../StaticBatch';
import { ChimneySmoke, Fireflies } from '../../effects/Ambient';
import { glowTexture } from '../../utils/textures';
import { clamp, damp, distToPolyline, lerp, mulberry32, range, smoothstep } from '../../utils/math';
import { bakeRigidParts } from '../../utils/merge';
import { Vox, VoxPerson, voxGroup, type PersonStyle } from './Voxel';
import {
  ANCIENT_TREE, BARN, BRIDGE_Z, COOP, DOCK, FARMHOUSE, FIELD, FOREST, GIANT_MUSHROOM, HILL_Z1, HILL_Z2, MAILBOX, MINE, PASTURE, PATHS, PEN, PLAZA, POND,
  RIVER_HALF, RIVER_START_Z, RIVER_X, TREASURE, V, WATER_Y,
} from './layout';

export type Season = 0 | 1 | 2 | 3;
export const SEASON_NAMES = ['Primavera', 'Verão', 'Outono', 'Inverno'] as const;

const DAY_LENGTH = 240; // seconds for a full day

/* ------------------------------------------------------------------ terrain helpers */
function edgeR(th: number) {
  return 0.95 + 0.035 * Math.sin(th * 3 + 0.4) + 0.02 * Math.sin(th * 5 + 1.2);
}
const inRect = (x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const inPlaza = (x: number, z: number, m = 0) => Math.abs(x - PLAZA.x) < PLAZA.half + m && Math.abs(z - PLAZA.z) < PLAZA.half + m;
const isRiver = (x: number, z: number) => Math.abs(x - RIVER_X) < RIVER_HALF && z > HILL_Z2 - 0.1;
const isPond = (x: number, z: number) => Math.hypot(x - POND.x, z - POND.z) < POND.r;
const pathDist = (x: number, z: number) => Math.min(...PATHS.map((p) => distToPolyline(x, z, p).d));
const isHill = (x: number, z: number) => x < 0.32 && z < HILL_Z1;

/** Ground height (top of the column) in island-local units. */
export function groundY(x: number, z: number) {
  let h = 0;
  if (isHill(x, z)) h = z < HILL_Z2 ? 0.2 : 0.12;
  if (isRiver(x, z)) h = z < RIVER_START_Z ? h - 0.04 : -0.06;
  if (isPond(x, z)) h = -0.06;
  return h;
}

function waterLevelAt(x: number, z: number) {
  if (isPond(x, z)) return WATER_Y;
  if (isRiver(x, z)) return z < RIVER_START_Z ? groundY(x, z) + 0.028 : WATER_Y;
  return null;
}

interface Walker {
  p: VoxPerson;
  route: Array<[number, number]>;
  u: number;
  speed: number;
  pause: number;
  phase: number;
  lines: string[];
  name: string;
  role: string;
  loop: boolean;
  dir: number;
}

interface Critter {
  root: THREE.Object3D;
  head?: THREE.Object3D;
  target: THREE.Vector2;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  speed: number;
  wait: number;
  hop: number;
}

/**
 * Vale Alecrim: an original cozy farm and village in voxel style,
 * with a day/night cycle, four seasons, villagers, animals and secrets.
 */
export class FarmWorld {
  readonly kind = 'vila' as const;
  readonly group = new THREE.Group();
  readonly snow = { value: 0 };
  season: Season = 0;
  timeOfDay = 0.3;
  night = 0;
  timeScale = 1;

  // interaction proxies
  readonly proxies: Record<string, THREE.Mesh> = {};
  readonly villagers: Walker[] = [];
  readonly sounds: THREE.Vector3[] = [];

  private voxMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private furnaceMat: THREE.MeshBasicMaterial;
  private oreMat: THREE.MeshStandardMaterial;
  private mushroomMat: THREE.MeshStandardMaterial;
  private waterMat: THREE.ShaderMaterial;
  private fallMat: THREE.ShaderMaterial;
  private foliage: THREE.InstancedMesh;
  private foliageKind: Array<'leaf' | 'pine' | 'blossom' | 'ancient'> = [];
  private foliageJitter: number[] = [];
  private crops: Array<{ mesh: THREE.InstancedMesh; plots: Array<{ x: number; z: number; g: number; rate: number }> }> = [];
  private smoke: ChimneySmoke;
  private fireflies: Fireflies;
  private seasonFx: THREE.Points;
  private seasonMat: THREE.ShaderMaterial;
  private lamps: THREE.Sprite[] = [];
  private chickens: Critter[] = [];
  private cows: Critter[] = [];
  private golden: Critter | null = null;
  private goldenRoot: THREE.Object3D;
  private cat: THREE.Group;
  private catTail: THREE.Object3D;
  private catAwake = 0;
  private kids: VoxPerson[] = [];
  private smith: VoxPerson;
  private fisher: VoxPerson;
  private bobber: THREE.Mesh;
  private fishMesh: THREE.Mesh;
  private fishing = -1;
  private fishT = 0;
  private clockHands: THREE.Object3D[] = [];
  private droplets: THREE.Mesh[] = [];
  private spirit: THREE.Group;
  private spiritMat: THREE.MeshBasicMaterial;
  private spiritVis = 0;
  private ancient: THREE.Group;
  private ancientShake = 0;
  private mushroom: THREE.Group;
  private mushroomBounce = -10;
  private mineOpen = 0;
  private mineTarget = 0;
  private treasureX: THREE.Group;
  private chest: THREE.Group;
  private chestLid: THREE.Object3D;
  private dig = 0;
  private digTarget = 0;
  private mailFlag: THREE.Object3D;
  private letterReady = true;
  private letterTimer = 0;
  private elapsed = 0;

  constructor(q: QualitySettings) {
    this.group.name = 'vale-alecrim';
    const rng = mulberry32(2024);
    this.voxMat = this.snowy(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }));
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: '#ffcf7e', toneMapped: false });
    const batch = new StaticBatch();
    const glow = new StaticBatch();
    const vox = new Vox(batch, glow);

    this.buildTerrain(batch, rng);
    this.buildFarm(vox, rng);
    this.buildVillage(vox);
    this.buildProps(vox, rng);

    // trees (trunks static, foliage instanced so seasons can recolour it)
    const leafSpots = this.plantTrees(vox, rng, q.trees);
    const foliageMat = this.snowy(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }));
    this.foliage = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), foliageMat, leafSpots.length);
    this.foliage.name = 'foliage';
    leafSpots.forEach((l, i) => this.foliage.setMatrixAt(i, l.m));
    this.foliageKind = leafSpots.map((l) => l.kind);
    this.foliageJitter = leafSpots.map(() => 0.88 + rng() * 0.24);
    this.foliage.castShadow = q.shadows;
    this.group.add(this.foliage);

    const scenery = batch.build(this.voxMat, 'vale-scenery');
    scenery.castShadow = scenery.receiveShadow = q.shadows;
    const windows = glow.build(this.glowMat, 'vale-windows');
    this.group.add(scenery, windows);

    this.waterMat = waterMaterial();
    this.fallMat = fallMaterial();
    this.buildWater();
    this.buildCrops();

    // furnace, ore, giant mushroom, spirit
    this.furnaceMat = new THREE.MeshBasicMaterial({ color: '#ff8a2a', toneMapped: false });
    const furnace = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.012), this.furnaceMat);
    furnace.position.set(0.56, 0.035, 0.5 - 0.075);
    this.group.add(furnace);
    this.oreMat = new THREE.MeshStandardMaterial({ color: '#9ff3ff', emissive: '#4fd8ff', emissiveIntensity: 0.2, flatShading: true });
    for (const [dx, dy, s] of [
      [-0.012, 0.03, 0.012],
      [0.01, 0.05, 0.009],
      [0.004, 0.018, 0.008],
    ]) {
      const o = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), this.oreMat);
      o.position.set(MINE.x + dx, dy, MINE.z - 0.012);
      this.group.add(o);
    }
    this.mushroomMat = new THREE.MeshStandardMaterial({ color: '#d8423a', emissive: '#ff5a4a', emissiveIntensity: 0.1, flatShading: true });
    this.mushroom = this.buildGiantMushroom();
    this.ancient = this.buildAncientTree();
    this.spiritMat = new THREE.MeshBasicMaterial({ color: '#bffcff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.spirit = this.buildSpirit();
    ({ x: this.treasureX, chest: this.chest, lid: this.chestLid } = this.buildTreasure());

    // smoke from chimneys
    this.smoke = new ChimneySmoke(this.chimneys, Math.max(4, Math.round(10 * q.particles)));
    this.group.add(this.smoke.points);

    // fireflies (night) over meadow, pond and forest
    const ff: THREE.Vector3[] = [];
    for (let i = 0; i < Math.round(60 * q.particles); i++) {
      const zone = [POND, FOREST, { x: -0.1, z: 0.6, r: 0.3 }][i % 3];
      const x = zone.x + range(rng, -0.22, 0.22);
      const z = zone.z + range(rng, -0.18, 0.18);
      ff.push(new THREE.Vector3(x, Math.max(0, groundY(x, z)) + range(rng, 0.03, 0.12), z));
    }
    this.fireflies = new Fireflies(ff, [new THREE.Color('#fff09a'), new THREE.Color('#d6ff8a')], 0.026, 0.03);
    this.group.add(this.fireflies.points);

    // season particles (petals / leaves / snow)
    this.seasonMat = seasonMaterial();
    this.seasonFx = seasonPoints(Math.round(220 * Math.max(0.4, q.particles)), this.seasonMat);
    this.group.add(this.seasonFx);

    this.buildLamps();
    this.goldenRoot = new THREE.Group();
    this.buildAnimals(rng);
    this.cat = new THREE.Group();
    this.catTail = new THREE.Object3D();
    this.buildCat();
    this.smith = this.buildVillagers();
    this.fisher = this.villagersStatic.fisher;
    this.kids = this.villagersStatic.kids;
    ({ bobber: this.bobber, fish: this.fishMesh } = this.buildFishing());
    this.mailFlag = this.buildMailbox();

    this.sounds.push(new THREE.Vector3(RIVER_X, 0.06, -0.48), new THREE.Vector3(PLAZA.x, 0.05, PLAZA.z));
    this.applySeason(true);
  }

  // ================================================================== build: terrain
  private chimneys: THREE.Vector3[] = [];

  private snowy<T extends THREE.Material>(mat: T): T {
    const snow = this.snow;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = snow;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vUpN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUpN = objectNormal.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSnow;\nvarying float vUpN;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.75, 0.95, vUpN));');
    };
    mat.customProgramCacheKey = () => 'snowy';
    return mat;
  }

  private buildTerrain(batch: StaticBatch, rng: () => number) {
    const vox = new Vox(batch).at(0, 0, 0);
    const N = Math.ceil(1 / V);
    for (let i = -N; i < N; i++) {
      for (let j = -N; j < N; j++) {
        const x = (i + 0.5) * V;
        const z = (j + 0.5) * V;
        const r = Math.hypot(x, z);
        if (r > edgeR(Math.atan2(z, x))) continue;
        const h = groundY(x, z);
        const checker = (i + j) & 1;
        let top: string;
        if (isRiver(x, z) || isPond(x, z)) top = '#9c8f74';
        else if (inPlaza(x, z)) top = checker ? '#bdb6a8' : '#ada69a';
        else if (inRect(x, z, FIELD)) top = (j & 1) ? '#6e4527' : '#7d5130';
        else if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.07 || Math.abs(x - RIVER_X) < RIVER_HALF + 0.04) top = checker ? '#e3d19a' : '#d9c68f';
        else if (pathDist(x, z) < 0.035) top = checker ? '#cfa872' : '#c39d68';
        else if (Math.hypot(x - TREASURE.x, z - TREASURE.z) < 0.1) top = '#e0cd95';
        else if (h > 0.05) top = checker ? '#5fa046' : '#58983f';
        else top = rng() < 0.08 ? '#93cf62' : checker ? '#79bf55' : '#71b74e';
        const side = h > 0.05 ? '#8b6b4c' : '#8a5a35';
        vox.box(x, h - 0.02, z, V, 0.02, V, top, batch, 0.04);
        vox.box(x, -0.16, z, V, h - 0.02 + 0.16, V, side, batch, 0.06);
      }
    }
    // underside: stepped rock layers
    const G = 0.1;
    for (let k = 1; k <= 7; k++) {
      const rr = 0.93 * Math.pow(1 - k / 8, 0.85);
      const y = -0.16 - k * 0.07;
      for (let i = -10; i < 10; i++) {
        for (let j = -10; j < 10; j++) {
          const x = (i + 0.5) * G;
          const z = (j + 0.5) * G;
          const d = Math.hypot(x, z);
          if (d > rr || (d > rr - G && rng() < 0.35)) continue;
          const c = (k + i + j) % 3 === 0 ? '#6f625a' : k > 4 ? '#5e5560' : '#7a6b60';
          vox.box(x, y, z, G, 0.07, G, c, batch, 0.08);
        }
      }
    }
  }

  // ================================================================== build: farm
  private buildFarm(vox: Vox, rng: () => number) {
    // farmhouse
    const F = FARMHOUSE;
    vox.at(F.x, 0, F.z);
    vox.box(0, 0, 0, 0.27, 0.02, 0.21, '#9a8f80');
    vox.box(0, 0.02, 0, 0.24, 0.12, 0.18, '#c08a5c');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) vox.box(sx * 0.118, 0.02, sz * 0.088, 0.014, 0.12, 0.014, '#7b5435');
    vox.box(0, 0.02, 0.091, 0.04, 0.075, 0.006, '#6b4226');
    vox.win(-0.075, 0.065, 0.092, 0.035, 0.035, 0.005).win(0.075, 0.065, 0.092, 0.035, 0.035, 0.005).win(0.121, 0.065, 0, 0.004, 0.035, 0.04);
    vox.box(-0.075, 0.05, 0.097, 0.045, 0.012, 0.01, '#8a5a35').box(0.075, 0.05, 0.097, 0.045, 0.012, 0.01, '#8a5a35');
    for (const x of [-0.088, -0.068, 0.068, 0.088]) vox.box(x, 0.062, 0.099, 0.008, 0.008, 0.008, x < 0 ? '#ff7aa8' : '#ffd84a', undefined, 0);
    // porch
    vox.box(0, 0, 0.125, 0.26, 0.012, 0.06, '#a4744a');
    for (const x of [-0.12, 0.12]) vox.box(x, 0.012, 0.15, 0.01, 0.1, 0.01, '#7b5435');
    vox.box(0, 0.112, 0.13, 0.27, 0.01, 0.07, '#a8473a');
    vox.roof(0.28, 0.22, 0.14, 5, 0.022, '#c0563e', '#a8473a');
    vox.box(0.08, 0.14, -0.04, 0.032, 0.11, 0.032, '#9b9187');
    this.chimneys.push(vox.point(0.08, 0.26, -0.04));

    // barn + silo
    vox.at(BARN.x, 0, BARN.z);
    vox.box(0, 0, 0, 0.2, 0.13, 0.16, '#b6423a');
    for (const sx of [-1, 1]) vox.box(sx * 0.098, 0, 0.078, 0.01, 0.13, 0.01, '#f3ece0');
    vox.box(0, 0, 0.081, 0.08, 0.1, 0.004, '#8e2f29').box(0, 0.1, 0.082, 0.09, 0.008, 0.004, '#f3ece0');
    vox.box(0, 0.048, 0.083, 0.08, 0.006, 0.004, '#f3ece0').box(0, 0, 0.083, 0.006, 0.1, 0.004, '#f3ece0');
    vox.box(0, 0.11, 0.082, 0.03, 0.02, 0.004, '#3a2a22');
    vox.roof(0.22, 0.18, 0.13, 5, 0.022, '#5b4a44', '#4d3e39');
    vox.box(-0.14, 0, -0.03, 0.07, 0.2, 0.07, '#c7c0b5');
    for (let i = 0; i < 3; i++) vox.box(-0.14, 0.2 + i * 0.012, -0.03, 0.07 - i * 0.02, 0.012, 0.07 - i * 0.02, '#8a9aa6');
    vox.box(-0.14, 0.04, 0.006, 0.02, 0.012, 0.004, '#b6423a');

    // chicken coop + pen fence
    vox.at(COOP.x, 0, COOP.z);
    vox.box(0, 0.02, 0, 0.09, 0.06, 0.08, '#ead6a6');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) vox.box(sx * 0.04, 0, sz * 0.035, 0.01, 0.02, 0.01, '#7b5435');
    vox.roof(0.1, 0.1, 0.08, 3, 0.016, '#7b5a3c');
    vox.box(0, 0.02, 0.041, 0.022, 0.03, 0.004, '#3a2a22');
    vox.box(0, 0.008, 0.06, 0.02, 0.006, 0.04, '#a4744a');
    this.fence(vox, PEN, '#e9e2d2');
    this.fence(vox, PASTURE, '#a4744a');

    // scarecrow
    vox.at(-0.25, 0, 0.3);
    vox.box(0, 0, 0, 0.008, 0.11, 0.008, '#7b5435').box(0, 0.07, 0, 0.07, 0.008, 0.008, '#7b5435');
    vox.box(0, 0.055, 0, 0.032, 0.04, 0.02, '#4c7fb5').box(0, 0.095, 0, 0.024, 0.024, 0.024, '#e8cf93');
    vox.box(0, 0.118, 0, 0.05, 0.006, 0.05, '#d9b45a').box(0, 0.124, 0, 0.026, 0.014, 0.026, '#d9b45a');
    // hay bales & barrels
    for (const [x, z] of [
      [-0.21, -0.22],
      [-0.19, -0.19],
      [-0.23, -0.18],
    ])
      vox.at(x, 0, z).box(0, 0, 0, 0.04, 0.028, 0.028, '#e2c062');
    // well
    vox.at(-0.76, 0, 0.0);
    vox.box(0, 0, 0, 0.05, 0.03, 0.05, '#a39a8e').box(0, 0.026, 0, 0.034, 0.005, 0.034, '#3f8fb0', undefined, 0);
    for (const sx of [-1, 1]) vox.box(sx * 0.022, 0.03, 0, 0.006, 0.05, 0.006, '#7b5435');
    vox.roof(0.064, 0.05, 0.08, 2, 0.012, '#a8473a');
    void rng;
  }

  private fence(vox: Vox, r: { x0: number; x1: number; z0: number; z1: number }, color: string) {
    vox.at(0, 0, 0);
    const step = 0.05;
    for (let x = r.x0; x <= r.x1 + 1e-6; x += step) {
      for (const z of [r.z0, r.z1]) vox.box(x, 0, z, 0.008, 0.035, 0.008, color);
    }
    for (let z = r.z0; z <= r.z1 + 1e-6; z += step) for (const x of [r.x0, r.x1]) vox.box(x, 0, z, 0.008, 0.035, 0.008, color);
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    for (const y of [0.012, 0.026]) {
      vox.box((r.x0 + r.x1) / 2, y, r.z0, w, 0.005, 0.004, color).box((r.x0 + r.x1) / 2, y, r.z1, w, 0.005, 0.004, color);
      vox.box(r.x0, y, (r.z0 + r.z1) / 2, 0.004, 0.005, d, color).box(r.x1, y, (r.z0 + r.z1) / 2, 0.004, 0.005, d, color);
    }
  }

  // ================================================================== build: village
  private buildVillage(vox: Vox) {
    // fountain
    vox.at(PLAZA.x, 0, PLAZA.z);
    for (const [x, z, w, d] of [
      [0, -0.05, 0.12, 0.02],
      [0, 0.05, 0.12, 0.02],
      [-0.05, 0, 0.02, 0.08],
      [0.05, 0, 0.02, 0.08],
    ])
      vox.box(x, 0, z, w, 0.03, d, '#c9c1b2');
    vox.box(0, 0, 0, 0.08, 0.012, 0.08, '#8fa7b0');
    vox.box(0, 0, 0, 0.02, 0.07, 0.02, '#c9c1b2').box(0, 0.07, 0, 0.05, 0.01, 0.05, '#c9c1b2');
    // benches & flower boxes
    for (const [x, z, ry] of [
      [-0.13, 0.13, 0],
      [0.13, 0.13, 0],
      [-0.13, -0.05, 0],
    ]) {
      vox.at(PLAZA.x + x, 0, PLAZA.z + z, ry);
      vox.box(0, 0.012, 0, 0.06, 0.006, 0.02, '#9a6a42').box(-0.025, 0, 0, 0.006, 0.012, 0.016, '#5b5b5b').box(0.025, 0, 0, 0.006, 0.012, 0.016, '#5b5b5b');
      vox.box(0, 0.018, -0.01, 0.06, 0.016, 0.004, '#9a6a42');
    }

    // clock tower (back of plaza)
    vox.at(PLAZA.x, 0, PLAZA.z - PLAZA.half - 0.06);
    vox.box(0, 0, 0, 0.1, 0.3, 0.1, '#d3c8b2');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) vox.box(sx * 0.049, 0, sz * 0.049, 0.012, 0.3, 0.012, '#b0a58f');
    vox.box(0, 0.22, 0.051, 0.06, 0.06, 0.004, '#f6f1e6');
    vox.box(0, 0.3, 0, 0.11, 0.015, 0.11, '#b0a58f');
    vox.box(0, 0.315, 0, 0.03, 0.04, 0.03, '#d9a93f');
    for (let i = 0; i < 4; i++) vox.box(0, 0.355 + i * 0.022, 0, 0.11 - i * 0.026, 0.022, 0.11 - i * 0.026, i % 2 ? '#35607e' : '#3f6d8e');
    vox.box(0, 0, 0.051, 0.03, 0.05, 0.004, '#6b4226');
    const face = vox.point(0, 0.25, 0.054);
    const handMat = new THREE.MeshBasicMaterial({ color: '#2b2420' });
    for (const [len, w] of [
      [0.018, 0.005],
      [0.025, 0.003],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.copy(face);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.002), handMat);
      hand.position.y = len / 2;
      pivot.add(hand);
      this.group.add(pivot);
      this.clockHands.push(pivot);
    }

    // bakery
    vox.at(0.18, 0, -0.33);
    vox.box(0, 0, 0, 0.17, 0.11, 0.13, '#f1d7b0');
    vox.box(0, 0, 0.066, 0.035, 0.065, 0.005, '#7b4a2a');
    vox.win(-0.05, 0.04, 0.067, 0.04, 0.035, 0.004).win(0.05, 0.04, 0.067, 0.04, 0.035, 0.004);
    for (let i = 0; i < 6; i++) vox.box(-0.075 + i * 0.03, 0.085, 0.085, 0.03, 0.008, 0.035, i % 2 ? '#ffffff' : '#e0703c');
    vox.box(0, 0.095, 0.07, 0.05, 0.02, 0.006, '#7b4a2a').box(0, 0.1, 0.074, 0.03, 0.01, 0.004, '#e8b366');
    vox.roof(0.19, 0.15, 0.11, 4, 0.022, '#d27a3a', '#bf6a2e');
    vox.box(-0.05, 0.12, -0.03, 0.026, 0.08, 0.026, '#a39a8e');
    this.chimneys.push(vox.point(-0.05, 0.21, -0.03));
    this.proxy('bakery', vox.point(0, 0.08, 0), 0.1);

    // tavern (two storeys)
    vox.at(0.67, 0, -0.31);
    vox.box(0, 0, 0, 0.2, 0.07, 0.15, '#8f7a68');
    vox.box(0, 0.07, 0, 0.21, 0.08, 0.16, '#ecdfc4');
    for (const x of [-0.1, -0.035, 0.035, 0.1]) vox.box(x, 0.07, 0.081, 0.01, 0.08, 0.004, '#6b4a33');
    vox.box(0, 0.11, 0.082, 0.21, 0.008, 0.004, '#6b4a33');
    vox.box(0, 0, 0.076, 0.04, 0.06, 0.005, '#5a3a24');
    vox.win(-0.065, 0.025, 0.077, 0.04, 0.03, 0.004).win(0.065, 0.025, 0.077, 0.04, 0.03, 0.004);
    vox.win(-0.068, 0.088, 0.082, 0.03, 0.03, 0.004).win(0, 0.088, 0.082, 0.03, 0.03, 0.004).win(0.068, 0.088, 0.082, 0.03, 0.03, 0.004);
    vox.box(0.11, 0.1, 0.09, 0.004, 0.004, 0.03, '#3a2a22').box(0.11, 0.075, 0.105, 0.03, 0.025, 0.004, '#6b4a33').box(0.11, 0.08, 0.108, 0.012, 0.014, 0.004, '#e6b844');
    vox.roof(0.23, 0.18, 0.15, 5, 0.022, '#6e3f5a', '#5e3550');
    vox.box(0.07, 0.17, -0.03, 0.026, 0.09, 0.026, '#a39a8e');
    this.chimneys.push(vox.point(0.07, 0.27, -0.03));
    this.proxy('tavern', vox.point(0, 0.1, 0), 0.12);

    // general store (faces the plaza, −X)
    vox.at(0.79, 0, 0.1, -Math.PI / 2);
    vox.box(0, 0, 0, 0.17, 0.11, 0.13, '#e9e2cf');
    vox.box(0, 0, 0.066, 0.04, 0.07, 0.005, '#4a6b48');
    vox.win(-0.055, 0.035, 0.067, 0.045, 0.04, 0.004).win(0.055, 0.035, 0.067, 0.045, 0.04, 0.004);
    for (let i = 0; i < 6; i++) vox.box(-0.075 + i * 0.03, 0.085, 0.086, 0.03, 0.008, 0.04, i % 2 ? '#ffffff' : '#4f8a5b');
    vox.roof(0.19, 0.15, 0.11, 4, 0.022, '#4f8a5b', '#43784e');
    for (const [x, c] of [
      [-0.07, '#e04a3a'],
      [-0.035, '#f2b23a'],
      [0.035, '#7fbf4a'],
    ])
      vox.box(Number(x), 0, 0.1, 0.026, 0.02, 0.022, '#a4744a').box(Number(x), 0.02, 0.1, 0.022, 0.006, 0.018, String(c));
    this.proxy('store', vox.point(0, 0.07, 0), 0.1);

    // forge (faces the plaza, −Z)
    vox.at(0.56, 0, 0.5, Math.PI);
    vox.box(0, 0, 0, 0.17, 0.1, 0.12, '#8d8a86');
    vox.box(0, 0.015, 0.061, 0.06, 0.05, 0.004, '#2e2622');
    vox.roof(0.19, 0.14, 0.1, 3, 0.02, '#4b4b52');
    vox.box(0.05, 0.1, -0.02, 0.035, 0.1, 0.035, '#77736f');
    this.chimneys.push(vox.point(0.05, 0.21, -0.02));
    vox.box(-0.04, 0, 0.1, 0.03, 0.02, 0.018, '#3d3d42').box(-0.04, 0.02, 0.1, 0.04, 0.01, 0.02, '#4a4a50');
    for (let i = 0; i < 3; i++) vox.box(0.045 + i * 0.012, 0, 0.11, 0.008, 0.03, 0.008, '#7b5435');
    this.proxy('forge', vox.point(0, 0.05, 0.06), 0.09);

    // library
    vox.at(0.23, 0, 0.5, Math.PI);
    vox.box(0, 0, 0, 0.16, 0.12, 0.12, '#dccdb0');
    for (const x of [-0.06, -0.02, 0.02, 0.06]) vox.box(x, 0, 0.065, 0.01, 0.1, 0.01, '#f1ead8');
    vox.box(0, 0, 0.061, 0.032, 0.06, 0.004, '#5a3a24');
    vox.win(-0.042, 0.065, 0.062, 0.022, 0.03, 0.004).win(0.042, 0.065, 0.062, 0.022, 0.03, 0.004);
    vox.roof(0.18, 0.14, 0.12, 4, 0.02, '#5a5f8f', '#4d5280');
    this.proxy('library', vox.point(0, 0.07, 0), 0.09);

    // houses
    for (const [x, z, ry, wall, roof] of [
      [0.82, -0.13, -Math.PI / 2, '#ecc9a0', '#c96a4a'],
      [0.8, 0.36, -Math.PI / 2, '#d4e1c6', '#7a5a8c'],
      [0.07, 0.36, Math.PI, '#f0e2c8', '#3f7a78'],
    ] as const) {
      vox.at(x, 0, z, ry);
      vox.box(0, 0, 0, 0.13, 0.09, 0.11, wall);
      vox.box(0, 0, 0.056, 0.03, 0.06, 0.005, '#6b4226');
      vox.win(-0.042, 0.035, 0.057, 0.03, 0.03, 0.004).win(0.042, 0.035, 0.057, 0.03, 0.03, 0.004);
      vox.roof(0.15, 0.13, 0.09, 4, 0.02, roof);
    }

    // notice board & market stall
    vox.at(0.22, 0, -0.04);
    vox.box(-0.03, 0, 0, 0.008, 0.07, 0.008, '#7b5435').box(0.03, 0, 0, 0.008, 0.07, 0.008, '#7b5435');
    vox.box(0, 0.035, 0.004, 0.07, 0.04, 0.006, '#a4744a');
    for (const [x, y, c] of [
      [-0.018, 0.05, '#f6f1e6'],
      [0.012, 0.045, '#fde7a8'],
      [0.02, 0.062, '#f6f1e6'],
    ] as const)
      vox.box(x, y, 0.008, 0.02, 0.016, 0.002, c);
    this.proxy('notices', vox.point(0, 0.05, 0), 0.06);
    vox.at(0.3, 0, 0.29);
    vox.box(0, 0, 0, 0.08, 0.035, 0.04, '#a4744a');
    for (const [x, c] of [
      [-0.025, '#e04a3a'],
      [0, '#f2b23a'],
      [0.025, '#7f4fb0'],
    ] as const)
      vox.box(x, 0.035, 0, 0.022, 0.01, 0.03, c);
    for (const x of [-0.038, 0.038]) vox.box(x, 0.035, -0.018, 0.005, 0.05, 0.005, '#7b5435');
    for (let i = 0; i < 4; i++) vox.box(-0.03 + i * 0.02, 0.085, 0, 0.02, 0.006, 0.05, i % 2 ? '#ffffff' : '#d9603b');

    // bridge over the river
    vox.at(RIVER_X, 0, BRIDGE_Z);
    for (let i = 0; i < 9; i++) vox.box(-0.08 + i * 0.02, -0.004 + Math.sin((i / 8) * Math.PI) * 0.014, 0, 0.018, 0.008, 0.06, i % 2 ? '#a4744a' : '#8f6340');
    for (const sz of [-1, 1]) for (const x of [-0.08, 0, 0.08]) vox.box(x, 0, sz * 0.03, 0.006, 0.035 + (x === 0 ? 0.012 : 0), 0.006, '#7b5435');
    for (const sz of [-1, 1]) vox.box(0, 0.032, sz * 0.03, 0.16, 0.005, 0.004, '#7b5435');

    // plaza proxy (bells) + clock tower
    this.proxy('tower', new THREE.Vector3(PLAZA.x, 0.2, PLAZA.z - PLAZA.half - 0.06), 0.09, 0.42);
  }

  // ================================================================== build: props
  private buildProps(vox: Vox, rng: () => number) {
    // dock on the pond
    vox.at(DOCK.x, 0, DOCK.z);
    for (let i = 0; i < 5; i++) vox.box(-i * 0.022, -0.008, 0, 0.02, 0.008, 0.04, i % 2 ? '#a4744a' : '#8f6340');
    for (const x of [0, -0.088]) for (const sz of [-1, 1]) vox.box(x, -0.05, sz * 0.02, 0.008, 0.06, 0.008, '#6b4a33');
    // mine entrance in the hill face (hidden behind the waterfall)
    vox.at(MINE.x, 0, MINE.z);
    vox.box(0, -0.03, 0.0, 0.07, 0.11, 0.012, '#1a1412');
    vox.box(-0.04, -0.03, 0.004, 0.01, 0.11, 0.01, '#6b4a33').box(0.04, -0.03, 0.004, 0.01, 0.11, 0.01, '#6b4a33').box(0, 0.08, 0.004, 0.09, 0.012, 0.01, '#6b4a33');
    // rocks
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 0.9;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.blocked(x, z, 0.02) || isRiver(x, z) || isPond(x, z)) continue;
      const s = range(rng, 0.012, 0.03);
      vox.at(x, groundY(x, z), z).box(0, 0, 0, s, s * 0.7, s * 0.9, rng() < 0.5 ? '#a19a91' : '#8d867e');
    }
    // flowers
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * 0.9;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.blocked(x, z, 0.01) || isRiver(x, z) || isPond(x, z) || inPlaza(x, z) || pathDist(x, z) < 0.04) continue;
      const c = ['#ff7aa8', '#ffd84a', '#ffffff', '#b98cff', '#ff8a5a'][i % 5];
      vox.at(x, groundY(x, z), z).box(0, 0, 0, 0.003, 0.012, 0.003, '#4f8a3a').box(0, 0.012, 0, 0.008, 0.006, 0.008, c, undefined, 0);
    }
  }

  /** Building / feature footprints that trees and props must avoid. */
  private blocked(x: number, z: number, m: number) {
    const rects: Array<[number, number, number, number]> = [
      [FARMHOUSE.x, FARMHOUSE.z, 0.17, 0.17],
      [BARN.x - 0.04, BARN.z, 0.18, 0.11],
      [COOP.x, COOP.z, 0.06, 0.06],
      [0.18, -0.33, 0.11, 0.12],
      [0.67, -0.31, 0.13, 0.13],
      [0.79, 0.1, 0.1, 0.12],
      [0.56, 0.5, 0.11, 0.1],
      [0.23, 0.5, 0.1, 0.09],
      [0.82, -0.13, 0.08, 0.09],
      [0.8, 0.36, 0.08, 0.09],
      [0.07, 0.36, 0.09, 0.08],
      [PLAZA.x, PLAZA.z - PLAZA.half - 0.06, 0.07, 0.07],
      [-0.76, 0, 0.04, 0.04],
      [-0.25, 0.3, 0.04, 0.04],
      [0.3, 0.29, 0.06, 0.05],
      [0.22, -0.04, 0.05, 0.03],
      [ANCIENT_TREE.x, ANCIENT_TREE.z, 0.12, 0.12],
      [GIANT_MUSHROOM.x, GIANT_MUSHROOM.z, 0.07, 0.07],
      [TREASURE.x, TREASURE.z, 0.05, 0.05],
      [MAILBOX.x, MAILBOX.z, 0.03, 0.03],
    ];
    if (rects.some(([cx, cz, hw, hd]) => Math.abs(x - cx) < hw + m && Math.abs(z - cz) < hd + m)) return true;
    return inRect(x, z, FIELD, m) || inRect(x, z, PEN, m) || inRect(x, z, PASTURE, m) || inPlaza(x, z, m) || Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.05 + m;
  }

  // ================================================================== trees
  private plantTrees(vox: Vox, rng: () => number, count: number) {
    const spots: Array<{ m: THREE.Matrix4; kind: 'leaf' | 'pine' | 'blossom' | 'ancient' }> = [];
    const placed: Array<[number, number]> = [];
    const m = new THREE.Matrix4();
    const addCube = (x: number, y: number, z: number, s: number, kind: 'leaf' | 'pine' | 'blossom' | 'ancient', sy = s) => {
      m.compose(new THREE.Vector3(x, y + sy / 2, z), new THREE.Quaternion(), new THREE.Vector3(s, sy, s));
      spots.push({ m: m.clone(), kind });
    };
    const n = Math.round(count * 0.9);
    for (let i = 0; i < n * 4 && placed.length < n; i++) {
      const forest = i % 2 === 0;
      const a = rng() * Math.PI * 2;
      const r = forest ? Math.sqrt(rng()) * FOREST.r : Math.sqrt(rng()) * 0.9;
      const x = forest ? FOREST.x + Math.cos(a) * r : Math.cos(a) * r;
      const z = forest ? FOREST.z + Math.sin(a) * r : Math.sin(a) * r;
      if (Math.hypot(x, z) > edgeR(Math.atan2(z, x)) - 0.06) continue;
      if (this.blocked(x, z, 0.05) || isRiver(x, z) || pathDist(x, z) < 0.06) continue;
      if (Math.abs(x - RIVER_X) < 0.09) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.07)) continue;
      if (!forest && !isHill(x, z) && (rng() < 0.7 || (x > 0.0 && Math.abs(z) < 0.6))) continue;
      placed.push([x, z]);
      const y = groundY(x, z);
      const pine = isHill(x, z) || (forest && rng() < 0.35);
      const s = range(rng, 0.85, 1.2);
      vox.at(x, y, z).box(0, 0, 0, 0.022 * s, (pine ? 0.05 : 0.07) * s, 0.022 * s, '#6a4a33');
      if (pine) {
        for (let k = 0; k < 3; k++) addCube(x, y + (0.04 + k * 0.045) * s, z, (0.1 - k * 0.028) * s, 'pine', 0.045 * s);
      } else {
        const kind = rng() < 0.18 ? 'blossom' : 'leaf';
        addCube(x, y + 0.06 * s, z, 0.11 * s, kind);
        addCube(x + range(rng, -0.02, 0.02), y + 0.15 * s, z + range(rng, -0.02, 0.02), 0.07 * s, kind);
      }
    }
    // the ancient tree (big, at the edge of the plaza) is part of the foliage too
    const A = ANCIENT_TREE;
    vox.at(A.x, 0, A.z).box(0, 0, 0, 0.05, 0.16, 0.05, '#5d3f2a').box(0.03, 0, 0, 0.03, 0.03, 0.02, '#5d3f2a').box(-0.02, 0, 0.03, 0.02, 0.03, 0.03, '#5d3f2a');
    addCube(A.x, 0.14, A.z, 0.2, 'ancient', 0.12);
    addCube(A.x + 0.05, 0.24, A.z - 0.02, 0.13, 'ancient');
    addCube(A.x - 0.05, 0.22, A.z + 0.03, 0.12, 'ancient');
    return spots;
  }

  private applySeason(instant = false) {
    const pal: Record<'leaf' | 'blossom' | 'ancient' | 'pine', string[]> = {
      leaf: ['#7fc75a', '#4f9e3f', '#e08a3a', '#b9c4b0'],
      blossom: ['#f6b3cf', '#5aa648', '#d9603b', '#c2cdbb'],
      ancient: ['#9ad66a', '#3f8f3a', '#e6b844', '#d6e2dc'],
      pine: ['#2f7048', '#2b6842', '#2f6744', '#2f6043'],
    };
    const c = new THREE.Color();
    for (let i = 0; i < this.foliageKind.length; i++) {
      c.set(pal[this.foliageKind[i]][this.season]).multiplyScalar(this.foliageJitter[i]);
      this.foliage.setColorAt(i, c);
    }
    if (this.foliage.instanceColor) this.foliage.instanceColor.needsUpdate = true;
    const colors = [new THREE.Color('#ffc2dc'), new THREE.Color('#fff2a8'), new THREE.Color('#e8913a'), new THREE.Color('#ffffff')];
    this.seasonMat.uniforms.uColor.value.copy(colors[this.season]);
    this.seasonMat.uniforms.uMode.value = this.season;
    if (instant) this.snow.value = this.season === 3 ? 1 : 0;
  }

  nextSeason() {
    this.season = ((this.season + 1) % 4) as Season;
    this.applySeason();
    this.ancientShake = 1;
    return SEASON_NAMES[this.season];
  }

  // ================================================================== water
  private buildWater() {
    const quads: THREE.BufferGeometry[] = [];
    const N = Math.ceil(1 / V);
    for (let i = -N; i < N; i++)
      for (let j = -N; j < N; j++) {
        const x = (i + 0.5) * V;
        const z = (j + 0.5) * V;
        if (Math.hypot(x, z) > edgeR(Math.atan2(z, x))) continue;
        const wl = waterLevelAt(x, z);
        if (wl === null) continue;
        quads.push(new THREE.PlaneGeometry(V, V).rotateX(-Math.PI / 2).translate(x, wl, z));
      }
    // fountain basin
    quads.push(new THREE.PlaneGeometry(0.08, 0.08).rotateX(-Math.PI / 2).translate(PLAZA.x, 0.022, PLAZA.z));
    const g = mergeAll(quads);
    const water = new THREE.Mesh(g, this.waterMat);
    water.name = 'vale-water';
    water.renderOrder = 2;
    this.group.add(water);

    // waterfalls: hill terrace → river (in front of the mine) and upper terrace
    const fall = (x: number, z: number, top: number, bottom: number, w: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, top - bottom), this.fallMat);
      m.position.set(x, (top + bottom) / 2, z);
      m.renderOrder = 3;
      this.group.add(m);
      return m;
    };
    fall(RIVER_X, MINE.z + 0.012, 0.12 + 0.028 - 0.04, WATER_Y, 0.08);
    fall(RIVER_X, HILL_Z2 + 0.004, 0.2 - 0.012, 0.12 - 0.012, 0.07);
    // fountain droplets
    const dm = new THREE.MeshBasicMaterial({ color: '#cdeeff', transparent: true, opacity: 0.85 });
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.006), dm);
      this.group.add(d);
      this.droplets.push(d);
    }
    this.proxy('mine', new THREE.Vector3(MINE.x, 0.05, MINE.z + 0.02), 0.07);
    this.proxy('pond', new THREE.Vector3(POND.x, 0, POND.z), POND.r * 0.95, 0.04);
  }

  // ================================================================== crops
  private buildCrops() {
    const kinds = [
      { parts: [[0, 0, 0, 0.006, 0.03, 0.006, '#4f8a3a'], [0, 0.02, 0, 0.026, 0.014, 0.026, '#5fa046'], [0.006, 0.026, 0.006, 0.014, 0.014, 0.014, '#e3402f'], [-0.007, 0.03, -0.004, 0.012, 0.012, 0.012, '#e3402f']] },
      { parts: [[0, 0, 0, 0.034, 0.008, 0.034, '#5fa046'], [0, 0.004, 0, 0.03, 0.022, 0.03, '#f08a24'], [0, 0.026, 0, 0.005, 0.008, 0.005, '#6a4a33']] },
      { parts: [[0, 0, 0, 0.03, 0.022, 0.03, '#8fcf5a'], [0, 0.006, 0, 0.022, 0.024, 0.022, '#b6e27a']] },
      { parts: [[0, 0, 0, 0.008, 0.07, 0.008, '#6aa84a'], [0.006, 0.035, 0, 0.012, 0.008, 0.004, '#6aa84a'], [-0.006, 0.05, 0, 0.012, 0.008, 0.004, '#6aa84a'], [0.004, 0.04, 0.004, 0.008, 0.022, 0.008, '#f2d14a']] },
    ] as Array<{ parts: Array<[number, number, number, number, number, number, string]> }>;
    const cols = 8;
    const rows = 4;
    const dx = (FIELD.x1 - FIELD.x0) / cols;
    const dz = (FIELD.z1 - FIELD.z0) / rows;
    kinds.forEach((k, row) => {
      const mesh = voxGroup(k.parts, this.voxMat);
      const im = new THREE.InstancedMesh(mesh.geometry, this.voxMat, cols);
      im.name = 'crops';
      im.castShadow = true;
      const plots = [];
      for (let c = 0; c < cols; c++) plots.push({ x: FIELD.x0 + (c + 0.5) * dx, z: FIELD.z0 + (row + 0.5) * dz, g: 0.35 + ((c * 37 + row * 11) % 10) / 15, rate: 1 / (18 + ((c * 13) % 9)) });
      this.group.add(im);
      this.crops.push({ mesh: im, plots });
    });
    this.proxy('field', new THREE.Vector3((FIELD.x0 + FIELD.x1) / 2, 0.02, (FIELD.z0 + FIELD.z1) / 2), 0.1, 0.06, [(FIELD.x1 - FIELD.x0) * 0.98, 0.08, (FIELD.z1 - FIELD.z0) * 0.98]);
  }

  /** Harvests every ripe plot; returns how many were picked and where (island-local). */
  harvest(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    if (this.season === 3) return out;
    for (const c of this.crops)
      for (const p of c.plots)
        if (p.g > 0.7) {
          p.g = 0;
          out.push(new THREE.Vector3(p.x, 0.04, p.z));
        }
    return out;
  }

  // ================================================================== lamps
  private buildLamps() {
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffcf7a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const postMat = new THREE.MeshStandardMaterial({ color: '#3a3a40', flatShading: true });
    const spots: Array<[number, number]> = [
      [PLAZA.x - PLAZA.half, PLAZA.z - PLAZA.half],
      [PLAZA.x + PLAZA.half, PLAZA.z - PLAZA.half],
      [PLAZA.x - PLAZA.half, PLAZA.z + PLAZA.half],
      [PLAZA.x + PLAZA.half, PLAZA.z + PLAZA.half],
      [0.02, 0.16],
      [-0.2, 0.16],
      [-0.44, 0.0],
      [0.5, -0.32],
    ];
    for (const [x, z] of spots) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.07, 0.006), postMat);
      post.position.set(x, 0.035, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.014), this.glowMat);
      head.position.set(x, 0.075, z);
      const s = new THREE.Sprite(mat.clone());
      s.position.set(x, 0.076, z);
      s.scale.setScalar(0.08);
      this.group.add(post, head, s);
      this.lamps.push(s);
    }
  }

  // ================================================================== animals
  private buildAnimals(rng: () => number) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    const chicken = (gold: boolean) => {
      const root = new THREE.Group();
      const body = gold ? '#ffd24a' : '#f7f3ea';
      root.add(voxGroup([[0, 0.006, 0, 0.018, 0.016, 0.024, body], [0, 0.012, -0.012, 0.012, 0.012, 0.008, body], [-0.004, 0, 0, 0.003, 0.006, 0.003, '#e8a33a'], [0.004, 0, 0, 0.003, 0.006, 0.003, '#e8a33a']], mat));
      const head = new THREE.Group();
      head.position.set(0, 0.02, 0.012);
      head.add(voxGroup([[0, 0, 0, 0.011, 0.012, 0.011, body], [0, 0.012, 0, 0.004, 0.005, 0.008, '#e3402f'], [0, 0.004, 0.007, 0.005, 0.004, 0.005, '#f2b23a'], [0, -0.002, 0.006, 0.003, 0.004, 0.003, '#e3402f']], mat));
      root.add(head);
      return { root, head };
    };
    for (let i = 0; i < 6; i++) {
      const c = chicken(false);
      const x = range(rng, PEN.x0 + 0.03, PEN.x1 - 0.03);
      const z = range(rng, PEN.z0 + 0.03, PEN.z1 - 0.03);
      c.root.position.set(x, 0, z);
      this.group.add(c.root);
      this.chickens.push({ root: c.root, head: c.head, target: new THREE.Vector2(x, z), bounds: { x0: PEN.x0 + 0.02, x1: PEN.x1 - 0.02, z0: PEN.z0 + 0.02, z1: PEN.z1 - 0.02 }, speed: 0.05, wait: rng() * 2, hop: 0 });
    }
    const g = chicken(true);
    g.root.scale.setScalar(1.15);
    this.goldenRoot = g.root;
    g.root.visible = false;
    g.root.position.set(PEN.x0 + 0.06, 0, PEN.z1 - 0.06);
    this.group.add(g.root);
    this.golden = { root: g.root, head: g.head, target: new THREE.Vector2(g.root.position.x, g.root.position.z), bounds: { x0: PEN.x0 + 0.02, x1: PEN.x1 - 0.02, z0: PEN.z0 + 0.02, z1: PEN.z1 - 0.02 }, speed: 0.06, wait: 0, hop: 0 };
    this.proxy('golden', new THREE.Vector3(), 0.04);
    this.proxies.golden.removeFromParent();
    g.root.add(this.proxies.golden);
    this.proxies.golden.position.set(0, 0.02, 0);
    this.proxy('coop', new THREE.Vector3((PEN.x0 + PEN.x1) / 2, 0.03, (PEN.z0 + PEN.z1) / 2), 0.1, 0.06, [PEN.x1 - PEN.x0, 0.08, PEN.z1 - PEN.z0]);

    // cows
    for (let i = 0; i < 2; i++) {
      const root = new THREE.Group();
      const spots: Array<[number, number, number, number, number, number, string]> = [
        [0, 0.022, 0, 0.034, 0.028, 0.056, '#f6f2ea'],
        [0.012, 0.035, 0.01, 0.012, 0.016, 0.02, '#2c2626'],
        [-0.012, 0.03, -0.015, 0.012, 0.018, 0.016, '#2c2626'],
        [0, 0.03, 0.034, 0.024, 0.024, 0.02, '#f6f2ea'],
        [0, 0.026, 0.046, 0.02, 0.012, 0.008, '#e8a7a0'],
        [-0.014, 0.046, 0.034, 0.006, 0.006, 0.004, '#cfc6b8'],
        [0.014, 0.046, 0.034, 0.006, 0.006, 0.004, '#cfc6b8'],
      ];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) spots.push([sx * 0.011, 0, sz * 0.02, 0.008, 0.022, 0.008, '#f6f2ea']);
      root.add(voxGroup(spots, mat));
      const x = range(rng, PASTURE.x0 + 0.05, PASTURE.x1 - 0.05);
      const z = range(rng, PASTURE.z0 + 0.05, PASTURE.z1 - 0.05);
      root.position.set(x, 0, z);
      this.group.add(root);
      this.cows.push({ root, target: new THREE.Vector2(x, z), bounds: { x0: PASTURE.x0 + 0.04, x1: PASTURE.x1 - 0.04, z0: PASTURE.z0 + 0.04, z1: PASTURE.z1 - 0.04 }, speed: 0.018, wait: rng() * 4, hop: 0 });
    }
    this.proxy('cows', new THREE.Vector3((PASTURE.x0 + PASTURE.x1) / 2, 0.03, (PASTURE.z0 + PASTURE.z1) / 2), 0.1, 0.06, [PASTURE.x1 - PASTURE.x0, 0.08, PASTURE.z1 - PASTURE.z0]);
  }

  private buildCat() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.cat.add(
      voxGroup(
        [
          [0, 0, 0, 0.022, 0.012, 0.03, '#e89a4a'],
          [0, 0.004, 0.018, 0.016, 0.014, 0.014, '#e89a4a'],
          [-0.005, 0.018, 0.02, 0.004, 0.006, 0.004, '#c97a32'],
          [0.005, 0.018, 0.02, 0.004, 0.006, 0.004, '#c97a32'],
          [0, 0.008, 0.026, 0.006, 0.003, 0.002, '#ffffff'],
          [-0.004, 0.012, 0.0255, 0.003, 0.002, 0.002, '#2a1c14'],
          [0.004, 0.012, 0.0255, 0.003, 0.002, 0.002, '#2a1c14'],
        ],
        mat,
      ),
    );
    this.catTail.position.set(0, 0.006, -0.015);
    this.catTail.add(voxGroup([[0, 0, -0.012, 0.005, 0.005, 0.024, '#c97a32']], mat));
    this.cat.add(this.catTail);
    this.cat.position.set(FARMHOUSE.x + 0.07, 0.012, FARMHOUSE.z + 0.125);
    this.cat.rotation.y = -0.6;
    this.group.add(this.cat);
    this.proxy('cat', this.cat.position.clone().setY(0.025), 0.035);
  }

  // ================================================================== villagers (original characters)
  private villagersStatic!: { fisher: VoxPerson; kids: VoxPerson[] };

  private buildVillagers() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
    const make = (style: PersonStyle) => {
      const p = new VoxPerson(style, mat);
      bakeRigidParts(p.root, mat);
      this.group.add(p.root);
      return p;
    };
    const walker = (name: string, role: string, style: PersonStyle, route: Array<[number, number]>, lines: string[], speed = 0.04, loop = false) => {
      const p = make(style);
      p.hitProxy.name = `npc:${name}`;
      this.villagers.push({ p, route, u: Math.random(), speed, pause: 0, phase: Math.random() * 6, lines, name, role, loop, dir: 1 });
      return p;
    };
    walker('Lia', 'fazendeira', { skin: '#f0c8a0', hair: '#7a3f22', shirt: '#4f8fc0', pants: '#3e4f73', hat: '#e6c56a' }, [[-0.47, -0.05], [-0.4, 0.04], [-0.32, 0.05], [-0.3, -0.18]], [
      'Os tomates estão quase no ponto. Toque na horta para colher!',
      'Dizem que tem uma galinha dourada aparecendo no galinheiro…',
      'Meu avô plantou essa fazenda inteira com as próprias mãos.',
      'Já viu o lago à noite? Os vaga-lumes fazem festa por lá.',
    ]);
    walker('Celeste', 'padeira', { skin: '#c99a76', hair: '#2b1d16', shirt: '#f2efe6', pants: '#7b5a8c', apron: '#ffffff' }, [[0.18, -0.24], [0.3, -0.06], [0.44, -0.06], [0.56, -0.06]], [
      'Pão de queijo quentinho saindo do forno!',
      'Acordo às quatro da manhã. O fermento não espera ninguém.',
      'O bolo de fubá de hoje tem um segredo: erva-doce da horta da Lia.',
    ]);
    walker('Dalva', 'prefeita', { skin: '#8d5a3f', hair: '#d8d4cc', shirt: '#7a2f3f', pants: '#2f2a35' }, [[0.29, 0.25], [0.59, 0.25], [0.59, -0.05], [0.29, -0.05], [0.29, 0.25]], [
      'Bem-vinda ao Vale Alecrim! Sinta-se em casa.',
      'O relógio da torre nunca atrasa. Bom, quase nunca.',
      'Toque na Árvore Anciã e veja as estações mudarem.',
      'Tem um bilhete novo no quadro de avisos. Já leu?',
    ], 0.025, true);
    walker('Seu Olavo', 'bibliotecário', { skin: '#e8c4a4', hair: '#e9e6df', shirt: '#4b5d3a', pants: '#5a4a3a', beard: '#e9e6df' }, [[0.23, 0.42], [0.12, 0.42], [0.12, 0.3]], [
      'Os livros mais antigos falam de uma mina atrás da água que cai.',
      'Shh… alguns segredos só aparecem à noite.',
      'Um cogumelo do tamanho de uma casa? Já li sobre isso. Na floresta, dizem.',
    ], 0.018);
    this.smith = make({ skin: '#b07a55', hair: '#1e1714', shirt: '#7a4a2e', pants: '#3a3330', apron: '#4a3a30', beard: '#1e1714' });
    this.smith.root.position.set(0.53, 0, 0.6);
    this.smith.root.rotation.y = Math.PI * 0.9;
    this.smith.hitProxy.name = 'npc:Bento';
    this.villagers.push({ p: this.smith, route: [], u: 0, speed: 0, pause: 0, phase: 0, lines: ['Ferro bom é ferro paciente.', 'Precisa de uma ferradura? Ou de uma enxada nova?', 'Essa forja era do meu pai. E do pai dele.'], name: 'Bento', role: 'ferreiro', loop: false, dir: 1 });
    const fisher = make({ skin: '#d9a77d', hair: '#3d2a1e', shirt: '#2f7a7a', pants: '#3a4a5a', hat: '#a4744a' });
    fisher.root.position.set(DOCK.x - 0.085, -0.005, DOCK.z);
    fisher.root.rotation.y = -Math.PI / 2 - 0.4;
    fisher.hitProxy.name = 'npc:Iara';
    this.villagers.push({ p: fisher, route: [], u: 0, speed: 0, pause: 0, phase: 0, lines: ['Toque no lago para lançar a linha.', 'Paciência é a melhor isca.', 'Dizem que no fundo do lago mora um peixe dourado, velho como o vale.'], name: 'Iara', role: 'pescadora', loop: false, dir: 1 });
    const kidA = make({ skin: '#f0c8a0', hair: '#e0b04a', shirt: '#e86a5a', pants: '#3e5f8a', child: true });
    const kidB = make({ skin: '#8d5a3f', hair: '#1e1714', shirt: '#6ac06a', pants: '#5a4a7a', child: true });
    kidA.hitProxy.name = 'npc:Nina';
    kidB.hitProxy.name = 'npc:Téo';
    this.villagers.push({ p: kidA, route: [], u: 0, speed: 0, pause: 0, phase: 0, lines: ['Pega-pega! Você tá com ele!', 'Eu vi um bichinho brilhante perto da árvore grande ontem à noite!'], name: 'Nina', role: 'criança', loop: false, dir: 1 });
    this.villagers.push({ p: kidB, route: [], u: 0, speed: 0, pause: 0, phase: 0, lines: ['A Nina nunca me pega!', 'Tem um X desenhado na areia perto do lago. Será que é tesouro?'], name: 'Téo', role: 'criança', loop: false, dir: 1 });
    this.villagersStatic = { fisher, kids: [kidA, kidB] };
    for (const v of this.villagers) {
      v.p.hitProxy.removeFromParent();
      v.p.root.add(v.p.hitProxy);
    }
    return this.smith;
  }

  // ================================================================== fishing
  private buildFishing() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    const bobber = voxGroup([[0, 0, 0, 0.008, 0.005, 0.008, '#ffffff'], [0, 0.005, 0, 0.008, 0.005, 0.008, '#e3402f']], mat);
    bobber.visible = false;
    const fish = voxGroup([[0, 0, 0, 0.008, 0.012, 0.026, '#f2b23a'], [0, 0, -0.016, 0.004, 0.012, 0.008, '#e08a24']], mat);
    fish.visible = false;
    this.group.add(bobber, fish);
    return { bobber, fish };
  }

  /** Starts a cast; resolves (via update) with a catch after a short wait. */
  cast(): boolean {
    if (this.fishing >= 0) return false;
    this.fishing = 0;
    this.fishT = 0;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * POND.r * 0.6;
    this.bobber.position.set(POND.x + Math.cos(a) * r, WATER_Y, POND.z + Math.sin(a) * r);
    this.bobber.visible = true;
    return true;
  }

  onCatch: (where: THREE.Vector3) => void = () => {};

  // ================================================================== secrets
  private buildGiantMushroom() {
    const g = new THREE.Group();
    const stemMat = new THREE.MeshStandardMaterial({ color: '#efe6d6', flatShading: true, roughness: 0.8 });
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.04), stemMat);
    stem.position.y = 0.045;
    const cap = new THREE.Group();
    cap.position.y = 0.09;
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.13), this.mushroomMat);
    c1.position.y = 0.02;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.09), this.mushroomMat);
    c2.position.y = 0.055;
    cap.add(c1, c2);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#fff7ea' });
    for (const [x, y, z] of [
      [0.04, 0.041, 0.03],
      [-0.03, 0.041, -0.04],
      [-0.045, 0.03, 0.066],
      [0.066, 0.025, -0.02],
      [0.0, 0.071, 0.0],
    ]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.004, 0.018), dotMat);
      d.position.set(x, y, z);
      cap.add(d);
    }
    g.add(stem, cap);
    g.position.set(GIANT_MUSHROOM.x, 0, GIANT_MUSHROOM.z);
    g.userData.cap = cap;
    this.group.add(g);
    this.proxy('mushroom', new THREE.Vector3(GIANT_MUSHROOM.x, 0.08, GIANT_MUSHROOM.z), 0.09);
    return g;
  }

  private buildAncientTree() {
    const g = new THREE.Group();
    // swing hanging from the ancient tree
    const mat = new THREE.MeshStandardMaterial({ color: '#8f6340', flatShading: true });
    const ropeMat = new THREE.MeshStandardMaterial({ color: '#d9c49a' });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.012), mat);
    seat.position.set(0, -0.07, 0);
    const pivot = new THREE.Group();
    pivot.position.set(ANCIENT_TREE.x + 0.07, 0.13, ANCIENT_TREE.z + 0.06);
    for (const sx of [-1, 1]) {
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.07, 0.002), ropeMat);
      rope.position.set(sx * 0.013, -0.035, 0);
      pivot.add(rope);
    }
    pivot.add(seat);
    g.add(pivot);
    g.userData.swing = pivot;
    this.group.add(g);
    this.proxy('ancient', new THREE.Vector3(ANCIENT_TREE.x, 0.15, ANCIENT_TREE.z), 0.12);
    return g;
  }

  private buildSpirit() {
    const g = new THREE.Group();
    const parts: Array<[number, number, number, number, number, number]> = [
      [0, 0.03, 0, 0.02, 0.018, 0.036],
      [0, 0.05, 0.02, 0.014, 0.016, 0.016],
      [-0.006, 0.066, 0.018, 0.003, 0.016, 0.003],
      [0.006, 0.066, 0.018, 0.003, 0.016, 0.003],
      [-0.008, 0.08, 0.016, 0.012, 0.003, 0.003],
      [0.008, 0.08, 0.016, 0.012, 0.003, 0.003],
      [-0.007, 0.012, 0.012, 0.004, 0.022, 0.004],
      [0.007, 0.012, 0.012, 0.004, 0.022, 0.004],
      [-0.007, 0.012, -0.012, 0.004, 0.022, 0.004],
      [0.007, 0.012, -0.012, 0.004, 0.022, 0.004],
    ];
    for (const [x, y, z, w, h, d] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.spiritMat);
      m.position.set(x, y + h / 2 - 0.009, z);
      g.add(m);
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#9ff6ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(0.16);
    halo.position.y = 0.04;
    g.add(halo);
    g.userData.halo = halo;
    g.visible = false;
    this.group.add(g);
    this.proxy('spirit', new THREE.Vector3(), 0.06);
    this.proxies.spirit.removeFromParent();
    g.add(this.proxies.spirit);
    this.proxies.spirit.position.y = 0.04;
    return g;
  }

  private buildTreasure() {
    const x = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#b23a2a', flatShading: true });
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.003, 0.01), mat);
      b.rotation.y = r;
      b.position.y = 0.002;
      x.add(b);
    }
    x.position.set(TREASURE.x, 0, TREASURE.z);
    const chest = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#7a4f2e', flatShading: true });
    const gold = new THREE.MeshStandardMaterial({ color: '#e0b04a', metalness: 0.7, roughness: 0.35, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.022, 0.028), wood);
    base.position.y = 0.011;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.004, 0.03), gold);
    band.position.y = 0.018;
    const lid = new THREE.Group();
    lid.position.set(0, 0.022, -0.014);
    const lidM = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.028), wood);
    lidM.position.set(0, 0.006, 0.014);
    lid.add(lidM);
    chest.add(base, band, lid);
    chest.position.set(TREASURE.x, -0.04, TREASURE.z);
    chest.visible = false;
    this.group.add(x, chest);
    this.proxy('treasure', new THREE.Vector3(TREASURE.x, 0.01, TREASURE.z), 0.05);
    return { x, chest, lid };
  }

  private buildMailbox() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    const box = voxGroup([[0, 0, 0, 0.006, 0.045, 0.006, '#7b5435'], [0, 0.045, 0, 0.018, 0.016, 0.028, '#3f6d8e']], mat);
    box.position.set(MAILBOX.x, 0, MAILBOX.z);
    const flag = new THREE.Group();
    flag.position.set(MAILBOX.x + 0.011, 0.05, MAILBOX.z - 0.004);
    flag.add(voxGroup([[0, 0, 0, 0.002, 0.018, 0.002, '#3a3a40'], [0, 0.012, 0.005, 0.002, 0.008, 0.01, '#e3402f']], mat));
    this.group.add(box, flag);
    this.proxy('mailbox', new THREE.Vector3(MAILBOX.x, 0.04, MAILBOX.z), 0.04);
    return flag;
  }

  /** Invisible touch volume. */
  private proxy(name: string, at: THREE.Vector3, r: number, h?: number, box?: [number, number, number]) {
    const geo = box ? new THREE.BoxGeometry(...box) : h ? new THREE.CylinderGeometry(r, r, h, 12) : new THREE.SphereGeometry(r, 10, 8);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    m.position.copy(at);
    m.name = `${name}-hit`;
    this.group.add(m);
    this.proxies[name] = m;
    return m;
  }

  // ================================================================== actions used by interactions
  get isNight() {
    return this.night > 0.6;
  }

  get letterWaiting() {
    return this.letterReady;
  }

  takeLetter() {
    this.letterReady = false;
    this.letterTimer = 18;
  }

  showGolden(): boolean {
    if (this.goldenRoot.visible) return false;
    this.goldenRoot.visible = true;
    return true;
  }

  hideGolden() {
    this.goldenRoot.visible = false;
  }

  get goldenVisible() {
    return this.goldenRoot.visible;
  }

  excite(kind: 'chickens' | 'cows') {
    for (const c of kind === 'chickens' ? [...this.chickens, ...(this.golden && this.goldenRoot.visible ? [this.golden] : [])] : this.cows) c.hop = 1;
  }

  wakeCat() {
    this.catAwake = 2.5;
  }

  bounceMushroom() {
    this.mushroomBounce = this.elapsed;
  }

  openMine() {
    this.mineTarget = 1;
  }

  digTreasure() {
    if (this.digTarget > 0) return false;
    this.digTarget = 1;
    this.chest.visible = true;
    return true;
  }

  skipTime(fraction: number) {
    this.timeOfDay = (this.timeOfDay + fraction) % 1;
  }

  get spiritVisible() {
    return this.spirit.visible && this.spiritVis > 0.3;
  }

  /** Clock string for UI. */
  get clock() {
    const mins = Math.floor(this.timeOfDay * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  // ================================================================== common world interface
  materials(): THREE.Material[] {
    const out = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => out.add(x));
    });
    return [...out];
  }

  setDetailDistance(_d: number) {
    /* voxel world has no separate detail layer */
  }

  reset() {
    this.spiritVis = 0;
    this.spirit.visible = false;
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
    // moonlit nights stay readable: cool, soft light instead of darkness
    hemi.intensity = 1.0 + 0.4 * day;
    hemi.color.set('#e4ecff').lerp(new THREE.Color('#8ea2e6'), this.night);
    hemi.groundColor.set('#6a5848').lerp(new THREE.Color('#3c3a63'), this.night);
  }

  // ================================================================== update
  update(dt: number, t: number, _camera?: THREE.Vector3, _center?: THREE.Vector3) {
    this.elapsed = t;
    this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / DAY_LENGTH) % 1;
    const n = this.night;

    // seasons: snow cover eases in/out
    this.snow.value = damp(this.snow.value, this.season === 3 ? 1 : 0, 0.8, dt);
    this.seasonMat.uniforms.uStrength.value = damp(this.seasonMat.uniforms.uStrength.value, this.season === 1 ? 0 : 1, 1, dt);

    // lights at night
    this.glowMat.color.set('#ffcf7e').multiplyScalar(0.45 + n * 1.6);
    for (const l of this.lamps) (l.material as THREE.SpriteMaterial).opacity = n * (0.65 + Math.sin(t * 3 + l.position.x * 20) * 0.05);
    this.fireflies.mat.uniforms.uIntensity.value = n * (this.season === 3 ? 0.2 : 1);
    this.furnaceMat.color.set('#ff8a2a').multiplyScalar(0.8 + Math.sin(t * 9) * 0.15 + Math.sin(t * 23) * 0.08);
    this.mushroomMat.emissiveIntensity = 0.1 + n * 0.7 + (t - this.mushroomBounce < 3 ? 1.2 : 0);
    this.smoke.update(dt);

    // clock hands follow the time of day
    const hours = this.timeOfDay * 24;
    this.clockHands[0].rotation.z = -((hours % 12) / 12) * Math.PI * 2;
    this.clockHands[1].rotation.z = -((hours % 1) * Math.PI * 2);

    // fountain droplets
    this.droplets.forEach((d, i) => {
      const k = (t * 0.9 + i / this.droplets.length) % 1;
      const a = (i / this.droplets.length) * Math.PI * 2;
      d.position.set(PLAZA.x + Math.cos(a) * k * 0.035, 0.08 + Math.sin(k * Math.PI) * 0.03 - k * 0.04, PLAZA.z + Math.sin(a) * k * 0.035);
    });

    // crops grow (not in winter)
    const m = new THREE.Matrix4();
    for (const c of this.crops) {
      c.plots.forEach((p, i) => {
        if (this.season !== 3) p.g = Math.min(1, p.g + dt * p.rate);
        const g = this.season === 3 ? 0 : p.g;
        const s = 0.15 + 0.85 * g;
        m.compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion(), new THREE.Vector3(0.4 + 0.6 * s, s, 0.4 + 0.6 * s));
        c.mesh.setMatrixAt(i, m);
      });
      c.mesh.instanceMatrix.needsUpdate = true;
    }

    this.updateCritters(dt, t);
    this.updateVillagers(dt, t);

    // cat
    this.catAwake = Math.max(0, this.catAwake - dt);
    this.catTail.rotation.y = Math.sin(t * (this.catAwake > 0 ? 8 : 1.5)) * 0.5;
    this.cat.position.y = 0.012 + (this.catAwake > 0 ? Math.abs(Math.sin(this.catAwake * 6)) * 0.01 : 0);

    // fishing
    if (this.fishing >= 0) {
      this.fishT += dt;
      this.bobber.position.y = WATER_Y + Math.sin(this.fishT * 6) * 0.002 - (this.fishT > 1.8 && this.fishT < 2.1 ? 0.006 : 0);
      if (this.fishT > 2.1 && this.fishing === 0) {
        this.fishing = 1;
        this.fishMesh.visible = true;
        this.onCatch(this.bobber.position.clone());
      }
      if (this.fishing === 1) {
        const k = clamp((this.fishT - 2.1) / 0.9);
        this.fishMesh.position.set(lerp(this.bobber.position.x, DOCK.x - 0.09, k), WATER_Y + Math.sin(k * Math.PI) * 0.12, lerp(this.bobber.position.z, DOCK.z, k));
        this.fishMesh.rotation.x = k * 6;
        if (k >= 1) {
          this.fishing = -1;
          this.fishMesh.visible = false;
          this.bobber.visible = false;
        }
      }
    }
    this.fisher.raiseArm(this.fishing >= 0 ? 0.7 : 0.45 + Math.sin(t * 0.8) * 0.05);

    // ancient tree swing + season shake
    const swing = this.ancient.userData.swing as THREE.Object3D;
    swing.rotation.x = Math.sin(t * 1.6) * 0.35;
    this.ancientShake = Math.max(0, this.ancientShake - dt);

    // giant mushroom bounce
    const since = t - this.mushroomBounce;
    const cap = this.mushroom.userData.cap as THREE.Object3D;
    const b = since < 2 ? Math.abs(Math.sin(since * 8)) * Math.exp(-since * 2) : 0;
    cap.scale.set(1 + b * 0.15, 1 - b * 0.25, 1 + b * 0.15);

    // mine / waterfall parting
    this.mineOpen = damp(this.mineOpen, this.mineTarget, 2, dt);
    this.fallMat.uniforms.uOpacity.value = 1 - this.mineOpen * 0.75;
    this.oreMat.emissiveIntensity = 0.2 + this.mineOpen * (2 + Math.sin(t * 3) * 0.4);

    // treasure dig
    this.dig = damp(this.dig, this.digTarget, 2.5, dt);
    this.chest.position.y = -0.04 + this.dig * 0.045;
    this.chestLid.rotation.x = -smoothstep(0.7, 1, this.dig) * 1.8;
    this.treasureX.scale.setScalar(1 - this.dig);

    // mailbox flag
    if (!this.letterReady) {
      this.letterTimer -= dt;
      if (this.letterTimer <= 0) this.letterReady = true;
    }
    this.mailFlag.rotation.z = damp(this.mailFlag.rotation.z, this.letterReady ? 0 : -Math.PI / 2, 4, dt);

    // night spirit near the ancient tree
    const show = this.isNight;
    this.spiritVis = damp(this.spiritVis, show ? 1 : 0, 1.5, dt);
    this.spirit.visible = this.spiritVis > 0.02;
    if (this.spirit.visible) {
      const a = t * 0.25;
      const x = ANCIENT_TREE.x + Math.cos(a) * 0.17;
      const z = ANCIENT_TREE.z + 0.05 + Math.sin(a) * 0.12;
      this.spirit.position.set(x, 0.005 + Math.sin(t * 2) * 0.004, z);
      this.spirit.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a) * 0.7);
      this.spiritMat.opacity = this.spiritVis * (0.55 + Math.sin(t * 5) * 0.08);
      ((this.spirit.userData.halo as THREE.Sprite).material as THREE.SpriteMaterial).opacity = this.spiritVis * 0.6;
    }
  }

  private updateCritters(dt: number, t: number) {
    const all = [...this.chickens, ...this.cows, ...(this.golden && this.goldenRoot.visible ? [this.golden] : [])];
    for (const c of all) {
      c.hop = Math.max(0, c.hop - dt * 0.8);
      const p = c.root.position;
      if (c.wait > 0) {
        c.wait -= dt;
        if (c.head) c.head.rotation.x = Math.max(0, Math.sin(t * 9 + p.x * 40)) * 0.8;
      } else {
        const dx = c.target.x - p.x;
        const dz = c.target.y - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.005) {
          c.wait = 0.8 + Math.random() * 3;
          c.target.set(range(Math.random, c.bounds.x0, c.bounds.x1), range(Math.random, c.bounds.z0, c.bounds.z1));
        } else {
          const step = Math.min(d, c.speed * dt * (c.hop > 0 ? 2 : 1));
          p.x += (dx / d) * step;
          p.z += (dz / d) * step;
          c.root.rotation.y = Math.atan2(dx, dz);
          if (c.head) c.head.rotation.x = 0;
        }
      }
      p.y = c.hop > 0 ? Math.abs(Math.sin(c.hop * 14)) * 0.012 : 0;
    }
  }

  private updateVillagers(dt: number, t: number) {
    for (const v of this.villagers) {
      if (!v.route.length) continue;
      if (v.pause > 0) {
        v.pause -= dt;
        v.p.walk(0, 0);
        continue;
      }
      const len = routeLength(v.route);
      v.u += (v.dir * v.speed * dt) / len;
      if (v.loop) v.u = ((v.u % 1) + 1) % 1;
      else if (v.u > 1 || v.u < 0) {
        v.u = clamp(v.u);
        v.dir *= -1;
        v.pause = 2 + Math.random() * 3;
      }
      const [x, z] = routePoint(v.route, v.u);
      const [nx, nz] = routePoint(v.route, clamp(v.u + v.dir * 0.01));
      v.p.root.position.set(x, groundY(x, z), z);
      if (Math.hypot(nx - x, nz - z) > 1e-5) v.p.root.rotation.y = Math.atan2(nx - x, nz - z);
      v.phase += dt * 9;
      v.p.walk(v.phase, 1);
    }
    // the smith hammers, the kids run around the fountain
    const h = Math.max(0, Math.sin(t * 5));
    this.smith.raiseArm(h);
    this.kids.forEach((k, i) => {
      const a = t * 1.1 + i * Math.PI;
      const r = 0.09;
      k.root.position.set(PLAZA.x + Math.cos(a) * r, 0, PLAZA.z + Math.sin(a) * r);
      k.root.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      k.walk(t * 14 + i, 1);
    });
  }

  /** World position of an island-local point (helper for effects). */
  local(v: THREE.Vector3) {
    return this.group.localToWorld(v.clone());
  }
}

/* ------------------------------------------------------------------ helpers */
function routeLength(r: Array<[number, number]>) {
  let l = 0;
  for (let i = 1; i < r.length; i++) l += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
  return Math.max(l, 1e-4);
}
function routePoint(r: Array<[number, number]>, u: number): [number, number] {
  const total = routeLength(r);
  let d = u * total;
  for (let i = 1; i < r.length; i++) {
    const l = Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    if (d <= l || i === r.length - 1) {
      const k = l > 0 ? clamp(d / l) : 0;
      return [lerp(r[i - 1][0], r[i][0], k), lerp(r[i - 1][1], r[i][1], k)];
    }
    d -= l;
  }
  return r[r.length - 1];
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false) ?? new THREE.BufferGeometry();
}

function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: shared.uTime },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; varying vec2 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }
      void main(){
        vec2 c = floor(vP * 120.0);
        float tw = step(0.93, h(c + floor(uTime * 2.5)));
        float wave = 0.5 + 0.5 * sin(vP.x * 60.0 + vP.y * 40.0 + uTime * 2.0);
        vec3 col = mix(vec3(0.20,0.52,0.70), vec3(0.32,0.68,0.84), wave * 0.6);
        col = mix(col, vec3(0.92,0.98,1.0), tw * 0.7);
        gl_FragColor = vec4(col, 0.9);
        #include <colorspace_fragment>
      }`,
  });
}

function fallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: shared.uTime, uOpacity: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uOpacity; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9,78.2)))*43758.5); }
      void main(){
        vec2 c = floor(vec2(vUv.x * 10.0, vUv.y * 14.0 + uTime * 9.0));
        float s = h(c);
        vec3 col = mix(vec3(0.42,0.72,0.88), vec3(0.95,0.99,1.0), step(0.6, s));
        float foam = smoothstep(0.15, 0.0, vUv.y);
        col = mix(col, vec3(1.0), foam);
        gl_FragColor = vec4(col, (0.82 + foam * 0.15) * uOpacity);
        #include <colorspace_fragment>
      }`,
  });
}

function seasonMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color('#ffc2dc') }, uMode: { value: 0 }, uStrength: { value: 1 }, uViewportHeight: shared.uViewportHeight },
    vertexShader: `${POINT_SIZE_GLSL}
      uniform float uTime; uniform float uMode; attribute vec3 aSeed; varying float vA;
      void main(){
        float speed = uMode > 2.5 ? 0.05 : 0.08;
        float life = fract(uTime * speed * (0.6 + aSeed.x) + aSeed.y);
        vec3 p = position;
        p.y = 0.9 - life * 1.0;
        p.x += sin(uTime * 1.3 + aSeed.z * 20.0) * 0.04;
        p.z += cos(uTime * 1.1 + aSeed.x * 20.0) * 0.04;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = worldPointSize(uMode > 2.5 ? 0.014 : 0.012, mv);
        vA = smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.85, life);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; uniform float uMode; varying float vA;
      void main(){
        vec2 q = abs(gl_PointCoord - 0.5);
        if (max(q.x, q.y) > 0.38) discard;
        gl_FragColor = vec4(uColor, vA * uStrength * 0.9);
      }`,
  });
}

function seasonPoints(n: number, mat: THREE.ShaderMaterial) {
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 0.95;
    pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
    seed.set([Math.random(), Math.random(), Math.random()], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  p.renderOrder = 6;
  return p;
}
