import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shared } from '../systems/SharedUniforms';
import { C } from './palette';
import { mulberry32, range, distToPolyline, smoothstep } from '../utils/math';
import { pathDistance, samplePoint, terrainHeight, edgeRadius } from './Terrain';
import { CASTLE, CRYSTALS, FOREST, RIVER, VILLAGE, BABY_DRAGON, SINGING_MUSHROOMS, MEADOW } from './layout';

function colored(g: THREE.BufferGeometry, color: THREE.Color) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  const cnt = n.attributes.position.count;
  const arr = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    // subtle vertical gradient: darker at the bottom
    const y = n.attributes.position.getY(i);
    const k = 0.82 + Math.min(1, Math.max(0, y * 6)) * 0.28;
    arr[i * 3] = color.r * k;
    arr[i * 3 + 1] = color.g * k;
    arr[i * 3 + 2] = color.b * k;
  }
  n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return n;
}

function pineGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.006, 0.009, 0.04, 5).translate(0, 0.02, 0);
  parts.push(colored(trunk, C.trunk));
  const tiers = [
    [0.05, 0.075, 0.035],
    [0.04, 0.065, 0.075],
    [0.028, 0.05, 0.11],
  ];
  tiers.forEach(([r, h, y], i) => {
    const cone = new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2 - 0.01, 0);
    cone.rotateY(i * 0.4);
    parts.push(colored(cone, i === 2 ? C.pine.clone().lerp(C.leafLight, 0.15) : C.pine));
  });
  return mergeGeometries(parts);
}

function roundTreeGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(colored(new THREE.CylinderGeometry(0.006, 0.01, 0.06, 5).translate(0, 0.03, 0), C.trunk));
  const blobs = [
    [0, 0.085, 0, 0.042],
    [0.022, 0.07, 0.012, 0.03],
    [-0.02, 0.072, -0.01, 0.032],
    [0.004, 0.11, -0.004, 0.028],
  ];
  for (const [x, y, z, r] of blobs) parts.push(colored(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), C.leaf));
  return mergeGeometries(parts);
}

/** Wind sway injected into a standard material; amplitude grows with height. */
function windMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hh = max(position.y, 0.0) * 10.0;
        float sway = sin(uTime * 1.6 + ip.x * 9.0 + ip.z * 6.0) * 0.6 + sin(uTime * 3.1 + ip.z * 13.0) * 0.25;
        transformed.x += sway * hh * hh * 0.0018;
        transformed.z += cos(uTime * 1.2 + ip.x * 7.0) * hh * hh * 0.0012;`,
      );
  };
  mat.customProgramCacheKey = () => 'wind';
  return mat;
}

export interface VegetationResult {
  group: THREE.Group;
  mushroomCaps: THREE.MeshStandardMaterial;
  singing: THREE.Group[];
}

export function buildVegetation(treeCount: number, shadows: boolean): VegetationResult {
  const rng = mulberry32(42);
  const group = new THREE.Group();
  group.name = 'vegetation';

  const clear = (x: number, z: number, margin = 0) => {
    const r = Math.hypot(x, z);
    if (r > edgeRadius(Math.atan2(z, x)) * 0.9) return false;
    if (distToPolyline(x, z, RIVER).d < 0.075 + margin) return false;
    if (pathDistance(x, z) < 0.04 + margin) return false;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r * 1.05) return false;
    if (Math.hypot(x - CASTLE.x, z - CASTLE.z) < CASTLE.r * 1.15) return false;
    if (Math.hypot(x - CRYSTALS.x, z - CRYSTALS.z) < 0.12) return false;
    if (Math.hypot(x - BABY_DRAGON.x, z - BABY_DRAGON.z) < 0.05) return false;
    if (Math.hypot(x - SINGING_MUSHROOMS.x, z - SINGING_MUSHROOMS.z) < 0.06) return false;
    if (Math.hypot(x - MEADOW.x, z - MEADOW.z) < 0.16) return false;
    if (terrainHeight(x, z) > 0.4) return false;
    return true;
  };

  const pines: THREE.Matrix4[] = [];
  const rounds: THREE.Matrix4[] = [];
  const roundColors: THREE.Color[] = [];
  const pineColors: THREE.Color[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const placed: Array<[number, number]> = [];

  const tooClose = (x: number, z: number, d: number) => placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < d);

  const forestCount = Math.round(treeCount * 0.62);
  for (let i = 0; i < treeCount; i++) {
    const inForest = i < forestCount;
    const p = samplePoint(rng, (x, z) => {
      if (!clear(x, z)) return false;
      if (inForest) return Math.hypot(x - FOREST.x, z - FOREST.z) < FOREST.r * (0.6 + rng() * 0.6) || terrainHeight(x, z) > 0.16;
      return true;
    });
    if (!p || tooClose(p[0], p[1], inForest ? 0.045 : 0.07)) continue;
    placed.push(p);
    const [x, z] = p;
    const y = terrainHeight(x, z) - 0.004;
    const s = range(rng, 0.75, 1.35) * (inForest ? 1.1 : 0.9);
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * range(rng, 0.9, 1.2), s));
    const high = terrainHeight(x, z) > 0.12;
    const usePine = high || (inForest ? rng() < 0.65 : rng() < 0.3);
    if (usePine) {
      pines.push(m.clone());
      pineColors.push(new THREE.Color(1, 1, 1).multiplyScalar(range(rng, 0.85, 1.12)));
    } else {
      rounds.push(m.clone());
      const roll = rng();
      const c = roll < 0.14 ? C.leafAutumn : roll < 0.24 ? C.leafGold : roll < 0.6 ? C.leaf : C.leafLight;
      // instanceColor multiplies vertex colour; express relative to base leaf colour
      roundColors.push(new THREE.Color(c.r / C.leaf.r, c.g / C.leaf.g, c.b / C.leaf.b).multiplyScalar(range(rng, 0.9, 1.05)));
    }
  }

  const mat = windMaterial();
  const make = (geo: THREE.BufferGeometry, mats: THREE.Matrix4[], cols: THREE.Color[], name: string) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
    im.name = name;
    im.count = mats.length;
    mats.forEach((mm, i) => {
      im.setMatrixAt(i, mm);
      im.setColorAt(i, cols[i]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = shadows;
    im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
  };
  // Round tree trunks would also be tinted by instanceColor — keep the tint mild.
  make(pineGeometry(), pines, pineColors, 'pines');
  make(roundTreeGeometry(), rounds, roundColors, 'trees');

  // ---------- glowing mushrooms ----------
  const capsMat = new THREE.MeshStandardMaterial({
    color: '#f2d9ff',
    emissive: new THREE.Color('#b97cff'),
    emissiveIntensity: 0.9,
    roughness: 0.5,
    flatShading: true,
  });
  const stemGeo = new THREE.CylinderGeometry(0.004, 0.006, 0.022, 6).translate(0, 0.011, 0);
  const capGeo = new THREE.SphereGeometry(0.014, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.02, 0);
  const stemMat = new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.8 });
  const stems: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  for (let i = 0; i < 26; i++) {
    const near = i < 16 ? FOREST : CRYSTALS;
    const p = samplePoint(rng, (x, z) => Math.hypot(x - near.x, z - near.z) < (i < 16 ? FOREST.r : 0.2) && clear(x, z, -0.03) !== false);
    if (!p) continue;
    const s = range(rng, 0.6, 1.4);
    q.setFromAxisAngle(new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(), range(rng, 0, 0.25));
    m.compose(new THREE.Vector3(p[0], terrainHeight(p[0], p[1]) - 0.002, p[1]), q, new THREE.Vector3(s, s, s));
    stems.push(m.clone());
    caps.push(m.clone());
  }
  const stemsIM = new THREE.InstancedMesh(stemGeo, stemMat, stems.length);
  const capsIM = new THREE.InstancedMesh(capGeo, capsMat, caps.length);
  stems.forEach((mm, i) => stemsIM.setMatrixAt(i, mm));
  caps.forEach((mm, i) => capsIM.setMatrixAt(i, mm));
  stemsIM.name = 'mushroom-stems';
  capsIM.name = 'mushroom-caps';
  group.add(stemsIM, capsIM);

  // Singing mushrooms (interactive, individually animated)
  const singing: THREE.Group[] = [];
  const singColors = ['#ff9ad5', '#9ad8ff', '#ffe08a', '#b6ff9a'];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const x = SINGING_MUSHROOMS.x + Math.cos(a) * 0.026;
    const z = SINGING_MUSHROOMS.z + Math.sin(a) * 0.026;
    g.position.set(x, terrainHeight(x, z) - 0.002, z);
    const s = 1.2 + (i % 2) * 0.5;
    g.scale.setScalar(s);
    const stem = new THREE.Mesh(stemGeo, stemMat);
    const cm = capsMat.clone();
    cm.emissive = new THREE.Color(singColors[i]);
    cm.color = new THREE.Color(singColors[i]).lerp(new THREE.Color('#ffffff'), 0.6);
    const cap = new THREE.Mesh(capGeo, cm);
    cap.name = 'cap';
    g.add(stem, cap);
    group.add(g);
    singing.push(g);
  }

  // ---------- grass tufts & flowers (cheap instanced cones) ----------
  const tuftGeo = new THREE.ConeGeometry(0.006, 0.02, 3).translate(0, 0.01, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ color: C.grassLight, flatShading: true, roughness: 1 });
  const flowerGeo = new THREE.IcosahedronGeometry(0.005, 0).translate(0, 0.012, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, emissive: '#000000' });
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 160);
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 90);
  let tc = 0;
  let fc = 0;
  const flowerCols = ['#f4e3a1', '#f2a5b8', '#c9b3f5', '#ffffff', '#f6c27a'];
  for (let i = 0; i < 400 && (tc < 160 || fc < 90); i++) {
    const p = samplePoint(rng, (x, z) => clear(x, z, -0.03) && terrainHeight(x, z) < 0.16, 10);
    if (!p) continue;
    const y = terrainHeight(p[0], p[1]);
    const meadowBoost = smoothstep(0.0, 0.7, p[1]);
    if (fc < 90 && rng() < 0.25 + meadowBoost * 0.4) {
      m.compose(new THREE.Vector3(p[0], y, p[1]), q.identity(), new THREE.Vector3(1, 1, 1).multiplyScalar(range(rng, 0.7, 1.3)));
      flowers.setMatrixAt(fc, m);
      flowers.setColorAt(fc, new THREE.Color(flowerCols[Math.floor(rng() * flowerCols.length)]));
      fc++;
    } else if (tc < 160) {
      q.setFromAxisAngle(up, rng() * 6.28);
      m.compose(new THREE.Vector3(p[0], y - 0.002, p[1]), q, new THREE.Vector3(1, range(rng, 0.6, 1.5), 1));
      tufts.setMatrixAt(tc, m);
      tc++;
    }
  }
  tufts.count = tc;
  flowers.count = fc;
  tufts.name = 'grass';
  flowers.name = 'flowers';
  group.add(tufts, flowers);

  return { group, mushroomCaps: capsMat, singing };
}
