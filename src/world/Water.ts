import * as THREE from 'three';
import { shared, POINT_SIZE_GLSL } from '../systems/SharedUniforms';
import { pointOnPolyline, riverLevel, riverWidth, terrainHeight } from './Terrain';
import { RIVER, WATERFALL_BOTTOM, WATERFALL_TOP } from './layout';
import { C } from './palette';
import { glowTexture } from '../utils/textures';
import { lerp } from '../utils/math';

const riverVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const riverFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uSpeed;
varying vec2 vUv;
varying vec3 vWorld;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  vec2 flow = vec2(vUv.x * 3.0, vUv.y * 22.0 - uTime * uSpeed);
  float n = vnoise(flow) * 0.6 + vnoise(flow * 2.3 + 3.1) * 0.4;
  vec3 col = mix(uDeep, uShallow, smoothstep(0.1, 1.0, across) * 0.7 + n * 0.25);
  float streak = smoothstep(0.72, 0.95, vnoise(vec2(vUv.x * 10.0, vUv.y * 40.0 - uTime * uSpeed * 1.6)));
  float edgeFoam = smoothstep(0.7, 1.0, across) * (0.5 + 0.5 * n);
  col = mix(col, uFoam, clamp(streak * 0.55 + edgeFoam * 0.65, 0.0, 1.0));
  // fake sky glint
  col += vec3(0.08, 0.1, 0.12) * pow(n, 3.0);
  gl_FragColor = vec4(col, 0.94);
  #include <colorspace_fragment>
}`;

const fallFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uSpeed;
uniform float uFadeStart;
uniform float uOpacity;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float v = vUv.y;
  float s1 = vnoise(vec2(vUv.x * 14.0, v * 6.0 + uTime * uSpeed));
  float s2 = vnoise(vec2(vUv.x * 30.0 + 7.0, v * 12.0 + uTime * uSpeed * 1.5));
  float streaks = smoothstep(0.35, 0.9, s1 * 0.6 + s2 * 0.4);
  vec3 col = mix(uDeep, uFoam, 0.35 + streaks * 0.65);
  float alpha = (0.55 + streaks * 0.45) * (1.0 - smoothstep(0.75, 1.0, across));
  // foam / fade at the end of the fall
  alpha *= 1.0 - smoothstep(uFadeStart, 1.0, v);
  col = mix(col, uFoam, smoothstep(uFadeStart - 0.2, 1.0, v));
  gl_FragColor = vec4(col, alpha * uOpacity);
  #include <colorspace_fragment>
}`;

const mistVert = /* glsl */ `
${POINT_SIZE_GLSL}
uniform float uTime;
uniform float uSize;
attribute vec3 aSeed;
varying float vAlpha;
void main() {
  float life = fract(uTime * (0.22 + aSeed.x * 0.2) + aSeed.y);
  vec3 p = position;
  float a = aSeed.z * 6.2831;
  p.x += cos(a) * life * 0.08;
  p.z += sin(a) * life * 0.08;
  p.y += life * 0.07 * (0.5 + aSeed.x);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = worldPointSize(uSize * (0.5 + life), mv);
  vAlpha = sin(life * 3.14159) * 0.55;
}`;

const mistFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor, t.a * vAlpha);
}`;

export class Water {
  readonly group = new THREE.Group();
  readonly waterfall: THREE.Mesh;
  private fallMat: THREE.ShaderMaterial;
  private partTarget = 1;
  private part = 1;

  constructor(particleScale: number) {
    this.group.name = 'water';

    // ---------- river ribbon ----------
    const steps = 90;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = pointOnPolyline(RIVER, t);
      const pn = pointOnPolyline(RIVER, Math.min(1, t + 0.01));
      const pp = pointOnPolyline(RIVER, Math.max(0, t - 0.01));
      let dx = pn[0] - pp[0];
      let dz = pn[1] - pp[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const w = riverWidth(t) * 1.25;
      const y = riverLevel(t);
      pos.push(p[0] - dz * w, y, p[1] + dx * w);
      pos.push(p[0] + dz * w, y, p[1] - dx * w);
      uv.push(0, t, 1, t);
      if (i < steps) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const riverMat = new THREE.ShaderMaterial({
      vertexShader: riverVert,
      fragmentShader: riverFrag,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: shared.uTime,
        uDeep: { value: C.waterDeep.clone() },
        uShallow: { value: C.water.clone() },
        uFoam: { value: C.waterFoam.clone() },
        uSpeed: { value: 0.9 },
      },
    });
    const river = new THREE.Mesh(rg, riverMat);
    river.name = 'river';
    river.renderOrder = 1;
    this.group.add(river);

    // pool under the mountain waterfall
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), riverMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(WATERFALL_BOTTOM[0], riverLevel(0) + 0.001, WATERFALL_BOTTOM[1]);
    this.group.add(pool);

    // ---------- falls ----------
    this.fallMat = new THREE.ShaderMaterial({
      vertexShader: riverVert,
      fragmentShader: fallFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: shared.uTime,
        uDeep: { value: C.water.clone().lerp(C.waterFoam, 0.25) },
        uFoam: { value: C.waterFoam.clone() },
        uSpeed: { value: 2.2 },
        uFadeStart: { value: 0.86 },
        uOpacity: { value: 1 },
      },
    });

    // Mountain cascade: drape a ribbon over the slope, slightly lifted.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = lerp(WATERFALL_TOP[0], WATERFALL_BOTTOM[0], t);
      const z = lerp(WATERFALL_TOP[1], WATERFALL_BOTTOM[1], t);
      const y = Math.max(terrainHeight(x, z), riverLevel(0)) + 0.016;
      pts.push(new THREE.Vector3(x, y, z));
    }
    this.waterfall = new THREE.Mesh(ribbon(pts, 0.05, 0.075), this.fallMat);
    this.waterfall.name = 'waterfall';
    this.waterfall.renderOrder = 3;
    this.group.add(this.waterfall);

    // Edge fall: the river pours off the island, down into the portal.
    const end = pointOnPolyline(RIVER, 0.985);
    const ey = riverLevel(0.985);
    const dir = new THREE.Vector2(end[0], end[1]).normalize();
    const edgePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const out = Math.sin(Math.min(1, t * 3) * Math.PI * 0.5) * 0.07;
      edgePts.push(new THREE.Vector3(end[0] + dir.x * out, ey - t * t * 0.15 - t * 0.85, end[1] + dir.y * out));
    }
    const edgeMat = this.fallMat.clone();
    edgeMat.uniforms.uTime = shared.uTime;
    edgeMat.uniforms.uFadeStart.value = 0.55;
    edgeMat.uniforms.uSpeed.value = 2.8;
    const edgeFall = new THREE.Mesh(ribbon(edgePts, 0.06, 0.09), edgeMat);
    edgeFall.name = 'edge-fall';
    edgeFall.renderOrder = 3;
    this.group.add(edgeFall);

    // ---------- mist ----------
    const mistMat = new THREE.ShaderMaterial({
      vertexShader: mistVert,
      fragmentShader: mistFrag,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: shared.uTime, uSize: { value: 0.07 }, uMap: { value: glowTexture() }, uColor: { value: new THREE.Color('#eaf8ff') }, uViewportHeight: shared.uViewportHeight },
    });
    const n = Math.round(40 * particleScale);
    const mp = new Float32Array(n * 3);
    const ms = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const atEdge = i % 3 === 0;
      const base = atEdge ? edgePts[11] : pts[pts.length - 1];
      mp[i * 3] = base.x + (Math.random() - 0.5) * 0.05;
      mp[i * 3 + 1] = base.y - 0.01;
      mp[i * 3 + 2] = base.z + (Math.random() - 0.5) * 0.05;
      ms[i * 3] = Math.random();
      ms[i * 3 + 1] = Math.random();
      ms[i * 3 + 2] = Math.random();
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 3));
    const mist = new THREE.Points(mg, mistMat);
    mist.frustumCulled = false;
    mist.renderOrder = 4;
    this.group.add(mist);
  }

  /** Briefly parts the waterfall (used by the hidden crystal discovery). */
  setParted(open: boolean) {
    this.partTarget = open ? 0.25 : 1;
  }

  update(dt: number) {
    this.part += (this.partTarget - this.part) * Math.min(1, dt * 4);
    this.fallMat.uniforms.uOpacity.value = this.part;
  }

  get waterfallPosition() {
    return new THREE.Vector3(WATERFALL_TOP[0], terrainHeight(WATERFALL_TOP[0], WATERFALL_TOP[1]) * 0.6, WATERFALL_TOP[1]);
  }
}

/** Ribbon geometry along a polyline, facing roughly toward +Z/outward, width tapering a→b. */
function ribbon(points: THREE.Vector3[], wa: number, wb: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const side = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    tan.subVectors(b, a).normalize();
    side.crossVectors(tan, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    // horizontal direction of travel for vertical falls
    const flat = new THREE.Vector3(points[points.length - 1].x - points[0].x, 0, points[points.length - 1].z - points[0].z);
    if (Math.abs(tan.y) > 0.9 && flat.lengthSq() > 1e-6) side.crossVectors(flat.normalize(), up).normalize();
    const t = i / (points.length - 1);
    const w = lerp(wa, wb, t) / 2;
    pos.push(p.x - side.x * w, p.y, p.z - side.z * w, p.x + side.x * w, p.y, p.z + side.z * w);
    uv.push(0, t, 1, t);
    if (i < points.length - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
