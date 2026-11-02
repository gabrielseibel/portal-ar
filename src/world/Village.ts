import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StaticBatch, roofGeometry } from './StaticBatch';
import { C } from './palette';
import { VILLAGE, PATHS } from './layout';
import { terrainHeight } from './Terrain';
import { mulberry32, range, damp } from '../utils/math';
import { glowTexture } from '../utils/textures';

interface HouseSpec {
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  roof: THREE.Color;
  wall: THREE.Color;
  tower?: boolean;
}

/**
 * Lumenvale: a handful of timber-framed cottages, a well, lanterns and
 * chimneys. Static pieces go into the shared batches; windows use a dedicated
 * emissive material so the village can "light up" when touched.
 */
export class Village {
  readonly group = new THREE.Group();
  readonly windowMat: THREE.MeshBasicMaterial;
  readonly chimneys: THREE.Vector3[] = [];
  readonly hitProxy: THREE.Mesh;
  private lanterns: THREE.Sprite[] = [];
  private glow = 0;
  private glowTarget = 0;
  private lit = 0;
  private baseWindow = C.windowWarm.clone().multiplyScalar(0.85);

  constructor(batch: StaticBatch, detailBatch: StaticBatch) {
    this.group.name = 'village';
    const rng = mulberry32(11);
    const cx = VILLAGE.x;
    const cz = VILLAGE.z;

    const houses: HouseSpec[] = [
      { x: cx - 0.13, z: cz - 0.08, rot: 0.3, w: 0.09, d: 0.07, h: 0.06, roof: C.roofRed, wall: C.plaster },
      { x: cx + 0.02, z: cz - 0.16, rot: -0.1, w: 0.08, d: 0.065, h: 0.07, roof: C.roofTeal, wall: C.plasterWarm },
      { x: cx + 0.15, z: cz - 0.06, rot: -0.7, w: 0.075, d: 0.06, h: 0.055, roof: C.roofTerracotta, wall: C.plaster },
      { x: cx + 0.15, z: cz + 0.1, rot: -1.4, w: 0.085, d: 0.065, h: 0.065, roof: C.roofPlum, wall: C.plasterWarm, tower: true },
      { x: cx - 0.14, z: cz + 0.1, rot: 1.2, w: 0.075, d: 0.06, h: 0.055, roof: C.roofSlate, wall: C.plaster },
      { x: cx + 0.01, z: cz + 0.2, rot: 3.3, w: 0.07, d: 0.06, h: 0.05, roof: C.roofRed, wall: C.plasterWarm },
      { x: cx - 0.04, z: cz + 0.02, rot: 0.9, w: 0.06, d: 0.05, h: 0.05, roof: C.roofTerracotta, wall: C.plaster },
    ];

    const box = new THREE.BoxGeometry(1, 1, 1);
    const windowsGeo: THREE.BufferGeometry[] = [];
    const winBox = new THREE.BoxGeometry(1, 1, 1);
    const tmp = new THREE.Object3D();

    const addWindow = (local: THREE.Vector3, sx: number, sy: number, sz: number, parent: THREE.Object3D) => {
      tmp.position.copy(local);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(sx, sy, sz);
      tmp.updateMatrix();
      const g = winBox.clone().applyMatrix4(tmp.matrix).applyMatrix4(parent.matrix);
      windowsGeo.push(g);
    };

    for (const hs of houses) {
      const y = terrainHeight(hs.x, hs.z);
      const frame = new THREE.Object3D();
      frame.position.set(hs.x, y, hs.z);
      frame.rotation.y = hs.rot;
      frame.updateMatrix();
      const put = (geo: THREE.BufferGeometry, color: THREE.Color, p: [number, number, number], s: [number, number, number], target = batch, ry = 0) => {
        tmp.position.set(...p);
        tmp.rotation.set(0, ry, 0);
        tmp.scale.set(...s);
        tmp.updateMatrix();
        const mm = frame.matrix.clone().multiply(tmp.matrix);
        target.addMatrix(geo, color, mm, 0.08, rng);
      };
      // stone foundation
      put(box, C.stoneDark, [0, 0.006, 0], [hs.w + 0.01, 0.014, hs.d + 0.01]);
      // walls
      put(box, hs.wall, [0, hs.h / 2 + 0.01, 0], [hs.w, hs.h, hs.d]);
      // roof
      const rh = hs.h * 0.75;
      const roof = roofGeometry(hs.w + 0.016, hs.d + 0.022, rh);
      tmp.position.set(0, hs.h + 0.008, 0);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      batch.addMatrix(roof, hs.roof, frame.matrix.clone().multiply(tmp.matrix), 0.06, rng);
      // timber beams (detail)
      const beam = 0.004;
      for (const sx of [-1, 1]) {
        put(box, C.woodDark, [(sx * hs.w) / 2, hs.h / 2 + 0.01, hs.d / 2 + 0.0008], [beam, hs.h, beam], detailBatch);
        put(box, C.woodDark, [(sx * hs.w) / 2, hs.h / 2 + 0.01, -hs.d / 2 - 0.0008], [beam, hs.h, beam], detailBatch);
      }
      put(box, C.woodDark, [0, hs.h * 0.55 + 0.01, hs.d / 2 + 0.0012], [hs.w, beam, beam], detailBatch);
      put(box, C.woodDark, [0, hs.h * 0.55 + 0.01, -hs.d / 2 - 0.0012], [hs.w, beam, beam], detailBatch);
      // door
      put(box, C.wood, [0, 0.022, hs.d / 2 + 0.0015], [0.016, 0.026, 0.004]);
      put(box, C.stoneLight, [0, 0.004, hs.d / 2 + 0.008], [0.022, 0.006, 0.012], detailBatch);
      // chimney
      const chX = hs.w * 0.28;
      const chH = hs.h + rh * 0.95;
      put(box, C.stone, [chX, chH - 0.005, -hs.d * 0.12], [0.012, 0.05, 0.012]);
      const chimneyTop = new THREE.Vector3(chX, chH + 0.022, -hs.d * 0.12).applyMatrix4(frame.matrix);
      this.chimneys.push(chimneyTop);
      // windows (emissive)
      const wy = hs.h * 0.62 + 0.01;
      addWindow(new THREE.Vector3(-hs.w * 0.28, wy - 0.012, hs.d / 2 + 0.001), 0.012, 0.014, 0.003, frame);
      addWindow(new THREE.Vector3(hs.w * 0.28, wy - 0.012, hs.d / 2 + 0.001), 0.012, 0.014, 0.003, frame);
      addWindow(new THREE.Vector3(hs.w / 2 + 0.001, wy - 0.01, 0), 0.003, 0.014, 0.014, frame);
      addWindow(new THREE.Vector3(-hs.w / 2 - 0.001, wy - 0.01, 0), 0.003, 0.014, 0.014, frame);
      addWindow(new THREE.Vector3(0, hs.h + rh * 0.38, hs.d / 2 + 0.006), 0.008, 0.01, 0.003, frame);
      if (hs.tower) {
        const tr = 0.022;
        const th = hs.h + 0.06;
        put(new THREE.CylinderGeometry(tr, tr * 1.08, th, 8), C.stoneLight, [-hs.w / 2, th / 2, hs.d / 2 - 0.01], [1, 1, 1]);
        put(new THREE.ConeGeometry(tr * 1.35, 0.05, 8), hs.roof, [-hs.w / 2, th + 0.025, hs.d / 2 - 0.01], [1, 1, 1]);
        addWindow(new THREE.Vector3(-hs.w / 2, th * 0.75, hs.d / 2 - 0.01 + tr + 0.001), 0.008, 0.012, 0.003, frame);
      }
    }

    // well
    const wy = terrainHeight(cx, cz + 0.05);
    batch.add(new THREE.CylinderGeometry(0.02, 0.022, 0.02, 10), C.stone, { x: cx + 0.05, y: wy + 0.01, z: cz + 0.06 });
    batch.add(new THREE.CylinderGeometry(0.015, 0.015, 0.004, 10), C.waterDeep, { x: cx + 0.05, y: wy + 0.019, z: cz + 0.06 });
    for (const s of [-1, 1]) batch.add(box, C.wood, { x: cx + 0.05 + s * 0.017, y: wy + 0.04, z: cz + 0.06 }, {}, { x: 0.004, y: 0.04, z: 0.004 });
    batch.add(roofGeometry(0.046, 0.04, 0.02), C.roofRed, { x: cx + 0.05, y: wy + 0.058, z: cz + 0.06 });

    // hay bales + crates + fences (detail)
    for (let i = 0; i < 5; i++) {
      const a = range(rng, 0, Math.PI * 2);
      const r = range(rng, 0.17, 0.24);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const yy = terrainHeight(x, z);
      if (i % 2) detailBatch.add(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8), C.hay, { x, y: yy + 0.012, z }, { z: Math.PI / 2, y: a });
      else detailBatch.add(box, C.woodLight, { x, y: yy + 0.008, z }, { y: a }, 0.016);
    }
    const fenceGeo = new THREE.BoxGeometry(0.003, 0.016, 0.003);
    const railGeo = new THREE.BoxGeometry(1, 0.0025, 0.0025);
    for (let i = 0; i < 18; i++) {
      const a = 0.6 + (i / 18) * 2.3;
      const r = VILLAGE.r * 1.02;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const yy = terrainHeight(x, z);
      detailBatch.add(fenceGeo, C.woodLight, { x, y: yy + 0.008, z });
      if (i < 17) {
        const a2 = 0.6 + ((i + 1) / 18) * 2.3;
        const x2 = cx + Math.cos(a2) * r;
        const z2 = cz + Math.sin(a2) * r;
        const len = Math.hypot(x2 - x, z2 - z);
        detailBatch.add(railGeo, C.woodLight, { x: (x + x2) / 2, y: yy + 0.011, z: (z + z2) / 2 }, { y: -Math.atan2(z2 - z, x2 - x) }, { x: len, y: 1, z: 1 });
      }
    }

    // windows mesh
    this.windowMat = new THREE.MeshBasicMaterial({ color: this.baseWindow.clone(), toneMapped: false });
    const wins = new THREE.Mesh(mergeAll(windowsGeo), this.windowMat);
    wins.name = 'village-windows';
    this.group.add(wins);

    // lanterns along the paths (glow sprites over small posts)
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffcf7a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
    const lanternSpots: Array<[number, number]> = [];
    for (const path of PATHS) for (let i = 1; i < path.length; i++) lanternSpots.push([path[i][0] + 0.03, path[i][1] + 0.02]);
    for (const [x, z] of lanternSpots.slice(0, 8)) {
      const yy = terrainHeight(x, z);
      detailBatch.add(new THREE.CylinderGeometry(0.0018, 0.0022, 0.04, 5), C.woodDark, { x, y: yy + 0.02, z });
      detailBatch.add(box, C.windowWarm, { x, y: yy + 0.043, z }, {}, 0.007);
      const s = new THREE.Sprite(glowMat.clone());
      s.position.set(x, yy + 0.043, z);
      s.scale.setScalar(0.04);
      this.group.add(s);
      this.lanterns.push(s);
    }

    // generous invisible touch target covering the village
    this.hitProxy = new THREE.Mesh(new THREE.CylinderGeometry(VILLAGE.r * 0.95, VILLAGE.r * 0.95, 0.16, 16), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitProxy.position.set(cx, terrainHeight(cx, cz) + 0.06, cz);
    this.hitProxy.name = 'village-hit';
    this.group.add(this.hitProxy);
  }

  /** Lights up every window and lantern for a while. */
  celebrate() {
    this.glowTarget = 1;
    this.lit = 7;
  }

  get isCelebrating() {
    return this.lit > 0;
  }

  update(dt: number, t: number, night: number) {
    if (this.lit > 0) {
      this.lit -= dt;
      if (this.lit <= 0) this.glowTarget = 0;
    }
    this.glow = damp(this.glow, this.glowTarget, 3, dt);
    const flicker = 0.92 + Math.sin(t * 13) * 0.04 + Math.sin(t * 7.3) * 0.04;
    const k = (0.75 + night * 0.5 + this.glow * 2.2) * flicker;
    this.windowMat.color.copy(this.baseWindow).multiplyScalar(k);
    for (let i = 0; i < this.lanterns.length; i++) {
      const s = this.lanterns[i];
      const m = s.material as THREE.SpriteMaterial;
      m.opacity = 0.35 + this.glow * 0.55 + Math.sin(t * 3 + i) * 0.05;
      s.scale.setScalar(0.035 + this.glow * 0.035);
    }
  }
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  const nonIdx = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  });
  return mergeGeometries(nonIdx, false) ?? new THREE.BufferGeometry();
}
