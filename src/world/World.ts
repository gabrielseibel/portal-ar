import * as THREE from 'three';
import type { QualitySettings } from '../systems/Quality';
import { StaticBatch, sceneryMaterial } from './StaticBatch';
import { buildTerrain, terrainHeight } from './Terrain';
import { Water } from './Water';
import { buildVegetation } from './Vegetation';
import { Village } from './Village';
import { Castle } from './Castle';
import { Crystals } from './Crystals';
import { Props } from './Props';
import { ChimneySmoke, Fireflies } from '../effects/Ambient';
import { Critters } from '../characters/Critters';
import { Spirit } from '../characters/Spirit';
import { Dragon, DRAGON_PLUM } from '../characters/Dragon';
import { BABY_DRAGON, FOREST, MEADOW, SINGING_MUSHROOMS } from './layout';
import { mulberry32, range, damp } from '../utils/math';
import type { ParticlePool } from '../effects/ParticlePool';

/**
 * The floating island and everything living on it (island-local space).
 */
export class World {
  readonly group = new THREE.Group();
  readonly water: Water;
  readonly village: Village;
  readonly castle: Castle;
  readonly crystals: Crystals;
  readonly props: Props;
  readonly smoke: ChimneySmoke;
  readonly critters: Critters;
  readonly spirit: Spirit;
  readonly baby: Dragon;
  readonly babyProxy: THREE.Mesh;
  readonly singing: THREE.Group[];
  readonly singingProxy: THREE.Mesh;
  readonly waterfallProxy: THREE.Mesh;
  readonly detailLOD: THREE.LOD;
  private mushroomCaps: THREE.MeshStandardMaterial;
  private sing = -10;
  private babyPeek = 0;
  private babyFound = false;
  private babyTimer = 3;
  private babyBaseY = 0;
  private fireflies: Fireflies;

  constructor(q: QualitySettings, fire: ParticlePool, fireSpace: THREE.Object3D) {
    this.group.name = 'island';
    const shadows = q.shadows;
    const batch = new StaticBatch();
    const detail = new StaticBatch();

    // terrain
    const terrain = buildTerrain(q.geometryDetail);
    const topMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: q.geometryDetail < 2, side: THREE.DoubleSide });
    const top = new THREE.Mesh(terrain.top, topMat);
    top.name = 'terrain';
    top.receiveShadow = shadows;
    top.castShadow = shadows;
    const under = new THREE.Mesh(terrain.under, sceneryMaterial({ side: THREE.DoubleSide }));
    under.name = 'island-underside';
    under.castShadow = shadows;
    this.group.add(top, under);

    this.water = new Water(q.particles);
    this.village = new Village(batch, detail);
    this.castle = new Castle(batch, detail);
    this.crystals = new Crystals();
    this.props = new Props(batch, detail);
    const veg = buildVegetation(q.trees, shadows);
    this.mushroomCaps = veg.mushroomCaps;
    this.singing = veg.singing;
    this.group.add(this.water.group, this.village.group, this.castle.group, this.crystals.group, this.props.group, veg.group);

    // merged scenery
    const mat = sceneryMaterial();
    const scenery = batch.build(mat, 'scenery');
    scenery.castShadow = shadows;
    scenery.receiveShadow = shadows;
    this.group.add(scenery);
    const detailMesh = detail.build(mat, 'scenery-detail');
    detailMesh.castShadow = false;
    detailMesh.receiveShadow = shadows;
    this.detailLOD = new THREE.LOD();
    this.detailLOD.name = 'detail-lod';
    this.detailLOD.addLevel(detailMesh, 0);
    this.detailLOD.addLevel(new THREE.Object3D(), q.detailDistance);
    this.group.add(this.detailLOD);

    // chimney smoke
    this.smoke = new ChimneySmoke(this.village.chimneys, Math.max(4, Math.round(12 * q.particles)));
    this.group.add(this.smoke.points);

    // fireflies in the forest + motes over the meadow
    const rng = mulberry32(8);
    const ffPos: THREE.Vector3[] = [];
    const nFF = Math.round(70 * q.particles);
    for (let i = 0; i < nFF; i++) {
      const zone = i % 3 === 0 ? MEADOW : FOREST;
      const x = zone.x + range(rng, -0.25, 0.25);
      const z = zone.z + range(rng, -0.2, 0.2);
      ffPos.push(new THREE.Vector3(x, terrainHeight(x, z) + range(rng, 0.03, 0.14), z));
    }
    this.fireflies = new Fireflies(ffPos, [new THREE.Color('#ffe48a'), new THREE.Color('#c8ff8a'), new THREE.Color('#8affea')], 0.03, 0.025);
    this.group.add(this.fireflies.points);

    // creatures
    this.critters = new Critters();
    this.spirit = new Spirit();
    this.group.add(this.critters.group, this.spirit.group);

    // shy baby dragon hiding in the forest
    this.baby = new Dragon(DRAGON_PLUM, fire, fireSpace);
    this.baby.canFly = false;
    this.baby.root.scale.setScalar(0.045);
    this.babyBaseY = terrainHeight(BABY_DRAGON.x, BABY_DRAGON.z) - 0.004;
    this.baby.setHome(new THREE.Vector3(BABY_DRAGON.x, this.babyBaseY - 0.05, BABY_DRAGON.z), 0.6);
    this.baby.showAtHome();
    this.group.add(this.baby.root);
    this.babyProxy = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.babyProxy.position.set(BABY_DRAGON.x, this.babyBaseY + 0.04, BABY_DRAGON.z);
    this.babyProxy.name = 'baby-dragon-hit';
    this.group.add(this.babyProxy);

    this.singingProxy = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.singingProxy.position.set(SINGING_MUSHROOMS.x, terrainHeight(SINGING_MUSHROOMS.x, SINGING_MUSHROOMS.z) + 0.02, SINGING_MUSHROOMS.z);
    this.singingProxy.name = 'mushrooms-hit';
    this.group.add(this.singingProxy);

    this.waterfallProxy = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.12), new THREE.MeshBasicMaterial({ visible: false }));
    const wf = this.water.waterfallPosition;
    this.waterfallProxy.position.set(wf.x + 0.03, wf.y, wf.z + 0.05);
    this.waterfallProxy.rotation.y = 0.5;
    this.waterfallProxy.name = 'waterfall-hit';
    this.group.add(this.waterfallProxy);

  }

  get babyPosition() {
    return this.baby.root.getWorldPosition(new THREE.Vector3());
  }

  singMushrooms(t: number) {
    this.sing = t;
  }

  findBaby() {
    this.babyFound = true;
    this.babyPeek = 1;
    this.baby.bounce();
    this.baby.react();
  }

  /** Every material on the island, used to set the "rising through the portal" clip plane. */
  materials(): THREE.Material[] {
    const out = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((x) => out.add(x));
    });
    return [...out];
  }

  setDetailDistance(d: number) {
    if (this.detailLOD.levels[1]) this.detailLOD.levels[1].distance = d;
  }

  update(dt: number, t: number, cameraWorld: THREE.Vector3, islandCenterStage: THREE.Vector3) {
    this.water.update(dt);
    this.village.update(dt, t, 0);
    this.castle.update(dt, t);
    this.crystals.update(dt, t);
    this.props.update(dt, t);
    this.smoke.update(dt);
    this.critters.update(dt, t);
    this.spirit.update(dt, t);

    // mushrooms: soft pulse, and a joyful bounce when they sing
    this.mushroomCaps.emissiveIntensity = 0.7 + Math.sin(t * 1.7) * 0.25;
    const since = t - this.sing;
    this.singing.forEach((g, i) => {
      const k = Math.max(0, since - i * 0.18);
      const b = k < 2.4 ? Math.abs(Math.sin(k * 7)) * Math.exp(-k * 1.2) : 0;
      const cap = g.getObjectByName('cap') as THREE.Mesh;
      cap.scale.set(1 + b * 0.25, 1 - b * 0.3 + Math.sin(t * 2 + i) * 0.03, 1 + b * 0.25);
      (cap.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + b * 2.5 + Math.sin(t * 2.3 + i) * 0.2;
    });

    // baby dragon peeks out from behind the trees now and then
    this.babyTimer -= dt;
    if (!this.babyFound && this.babyTimer <= 0) {
      this.babyPeek = this.babyPeek > 0.5 ? 0 : 1;
      this.babyTimer = this.babyPeek ? 2.5 + Math.random() * 2 : 4 + Math.random() * 5;
    }
    const peekY = this.babyBaseY - 0.05 + this.babyPeek * 0.05;
    const cur = this.baby.root.position.y;
    this.baby.setHome(new THREE.Vector3(BABY_DRAGON.x, damp(cur, peekY, 3, dt), BABY_DRAGON.z), 0.6);
    this.baby.update(dt, t, cameraWorld, islandCenterStage);
  }
}
