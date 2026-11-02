import * as THREE from 'three';
import { POINT_SIZE_GLSL, shared } from '../systems/SharedUniforms';
import { PORTAL_R } from '../world/layout';
import { glowTexture } from '../utils/textures';
import { clamp, easeOutBack, smoothstep, damp } from '../utils/math';

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

const flatVert = /* glsl */ `
varying vec2 vUv;
varying vec2 vP;
void main(){
  vUv = uv;
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/* Vortex: log-polar tunnel that reads as depth through the table. */
const vortexFrag = /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform float uRadius;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying vec2 vP;
${NOISE_GLSL}
void main(){
  vec2 p = vP / uRadius;
  float r = length(p);
  float a = atan(p.y, p.x);
  // opening mask with a living, noisy edge
  float edgeN = fbm(vec2(a * 3.0, uTime * 0.7)) * 0.12;
  float mask = 1.0 - smoothstep(uOpen - 0.08 + edgeN, uOpen + 0.02 + edgeN, r);
  if (mask <= 0.001) discard;
  // distortion: swirl + ripples
  float twist = a + uTime * 0.35 + (1.0 - r) * 3.2;
  float ripple = sin(r * 26.0 - uTime * 5.0) * 0.015 * (1.0 - r);
  float depth = 0.32 / (r + 0.06 + ripple) - uTime * 0.9;
  vec2 tc = vec2(twist * 1.6, depth);
  float n = fbm(tc * vec2(1.0, 1.2));
  float rings = smoothstep(0.55, 0.95, sin(depth * 7.0 + n * 3.0) * 0.5 + 0.5);
  float arms = smoothstep(0.35, 0.95, fbm(vec2(cos(twist), sin(twist)) * 2.0 + depth * 0.3));
  vec3 col = mix(uA, uB * 0.55, n * n);
  col = mix(col, uC * 0.8, arms * 0.45);
  col += uB * rings * 0.28 * (1.0 - r * 0.6);
  // the centre falls away into darkness
  float hole = smoothstep(0.0, 0.7, r);
  col *= mix(0.04, 1.0, hole * hole);
  // tiny stars far below
  vec2 sc = tc * vec2(10.0, 14.0);
  float st = step(0.975, hash21(floor(sc))) * smoothstep(0.32, 0.0, length(fract(sc) - 0.5)) * (1.0 - hole * 0.8) * 1.4;
  col += vec3(st);
  // luminous lip near the rim
  col += uB * smoothstep(0.82, 1.0, r) * 0.45;
  gl_FragColor = vec4(col, mask * 0.96);
  #include <colorspace_fragment>
}`;

/* Ground light + expanding ripples on the real surface. */
const groundFrag = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uRipple;
uniform float uRadius;
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vP;
void main(){
  float r = length(vP) / uRadius;
  float glow = exp(-pow(max(r - 1.0, 0.0) * 2.6, 2.0)) * smoothstep(0.6, 1.0, r) * 0.6;
  glow += exp(-max(r - 1.0, 0.0) * 1.4) * 0.22 * step(1.0, r);
  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float ph = fract(uTime * 0.35 + float(i) / 3.0);
    float rr = 1.0 + ph * 1.2;
    rings += exp(-pow((r - rr) * 18.0, 2.0)) * (1.0 - ph);
  }
  vec3 col = mix(uA, uB, 0.5 + 0.5 * sin(atan(vP.y, vP.x) * 2.0 + uTime * 0.6));
  float a = glow * uGlow + rings * uRipple * 0.8;
  a *= 1.0 - smoothstep(1.9, 2.3, r);
  gl_FragColor = vec4(col * a, a);
}`;

/* Rune circle drawn progressively around the portal. */
const runeFrag = /* glsl */ `
uniform float uTime;
uniform float uDraw;
uniform float uIntensity;
uniform vec3 uColor;
uniform float uInner;
uniform float uOuter;
varying vec2 vP;
${NOISE_GLSL}
void main(){
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float u = (a + 3.14159265) / 6.2831853;
  float rot = u + uTime * 0.01;
  float k = (r - uInner) / (uOuter - uInner);
  float band1 = smoothstep(0.02, 0.0, abs(k - 0.08)) ;
  float band2 = smoothstep(0.02, 0.0, abs(k - 0.92));
  // glyphs: 48 cells, each a random combination of strokes
  float cells = 48.0;
  float cell = floor(rot * cells);
  vec2 g = vec2(fract(rot * cells), (k - 0.2) / 0.6);
  float h = hash21(vec2(cell, 3.0));
  float glyph = 0.0;
  if (g.y > 0.0 && g.y < 1.0) {
    float lw = 0.035;
    glyph += step(abs(g.x - 0.5), lw) * step(0.45, h);
    glyph += step(abs(g.y - 0.62), lw) * step(abs(g.x - 0.5), 0.22) * step(0.3, fract(h * 7.0));
    glyph += step(abs(g.x - g.y), lw * 1.3) * step(0.6, fract(h * 13.0)) * step(abs(g.x - 0.5), 0.22);
    glyph += step(abs(length(g - 0.5) - 0.22), lw) * step(0.72, fract(h * 29.0));
    glyph *= step(0.12, g.y) * step(g.y, 0.88);
  }
  float drawn = step(u, uDraw);
  float lead = smoothstep(0.05, 0.0, abs(u - uDraw)) * step(uDraw, 0.999);
  float v = (band1 + band2 * 0.6 + clamp(glyph, 0.0, 1.0) * 0.6) * drawn + lead * 0.8;
  v *= 0.8 + 0.2 * sin(uTime * 2.0 + cell);
  float alpha = v * uIntensity;
  gl_FragColor = vec4(uColor * alpha, alpha);
}`;

const ringVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main(){
  vUv = uv;
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const ringFrag = /* glsl */ `
uniform float uTime;
uniform float uIgnite;
uniform float uPower;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uGold;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
void main(){
  float a = atan(vObj.y, vObj.x);
  float u = (a + 3.14159265) / 6.2831853;
  float lit = smoothstep(uIgnite, uIgnite - 0.04, u);
  float flow = 0.5 + 0.5 * sin(a * 6.0 - uTime * 3.0) * sin(a * 2.0 + uTime * 1.3);
  vec3 col = mix(uA, uB, flow);
  float fres = pow(1.0 - abs(dot(vN, vV)), 2.0);
  col = mix(col, uGold, fres * 0.5);
  float spark = smoothstep(0.03, 0.0, abs(u - uIgnite)) * step(uIgnite, 0.999);
  vec3 c = col * (0.35 + 1.4 * lit * uPower) + vec3(1.0, 0.95, 0.8) * spark * 3.0;
  gl_FragColor = vec4(c, 1.0);
}`;

/* Volumetric-looking shaft of light rising from the portal. */
const columnVert = /* glsl */ `
varying vec2 vUv;
varying float vFres;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFres = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;
const columnFrag = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFres;
${NOISE_GLSL}
void main(){
  float y = vUv.y;
  float streaks = fbm(vec2(vUv.x * 28.0, y * 2.0 - uTime * 0.9));
  float fade = pow(1.0 - y, 1.8) * smoothstep(0.0, 0.04, y);
  float soft = pow(vFres, 1.3);
  float a = fade * soft * (0.35 + streaks * 0.9) * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}`;

const orbitVert = /* glsl */ `
${POINT_SIZE_GLSL}
uniform float uTime;
uniform float uGather;
uniform float uRadius;
uniform float uSize;
attribute vec4 aSeed;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float speed = 0.25 + aSeed.y * 0.5;
  float ang = aSeed.x * 6.2831 + uTime * speed * (aSeed.w > 0.5 ? 1.0 : -0.7);
  float spread = mix(2.6, 1.0, uGather);
  float r = uRadius * (1.0 + (aSeed.z - 0.5) * 0.18) * spread;
  float h = aSeed.w * 0.9 * (0.4 + 0.6 * uGather) * (0.4 + 0.6 * fract(aSeed.y * 7.0 + uTime * 0.08));
  vec3 p = vec3(cos(ang) * r, h + sin(uTime * 1.3 + aSeed.x * 20.0) * 0.03, sin(ang) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = worldPointSize(uSize * (0.5 + aSeed.z), mv);
  vAlpha = uGather * (0.55 + 0.45 * sin(uTime * 3.0 + aSeed.x * 50.0)) * (1.0 - h * 0.7);
  vColor = aColor;
}`;
const orbitFrag = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb * vAlpha, t.a * vAlpha);
}`;

const TEAL = new THREE.Color('#4ff0d2');
const VIOLET = new THREE.Color('#8f5cff');
const DEEP = new THREE.Color('#1a0f3a');
const GOLD = new THREE.Color('#ffd58a');

/**
 * The portal: rune circle, energy ring, swirling vortex, light column,
 * orbiting motes and surface ripples. `progress` drives the ~3 s opening.
 */
export class Portal {
  readonly group = new THREE.Group();
  /** 0..1 opening progress (driven by the experience timeline). */
  progress = 0;
  private opened = false;
  private closing = false;
  private idleColumn = 0.18;
  private column: THREE.ShaderMaterial;
  private ring: THREE.ShaderMaterial;
  private ringMesh: THREE.Group;
  private vortex: THREE.ShaderMaterial;
  private ground: THREE.ShaderMaterial;
  private runes: THREE.ShaderMaterial;
  private orbit: THREE.ShaderMaterial;
  private columnBoost = 0;

  constructor(particleScale: number) {
    this.group.name = 'portal';
    const R = PORTAL_R;
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;

    this.ground = new THREE.ShaderMaterial({
      vertexShader: flatVert,
      fragmentShader: groundFrag,
      ...additive,
      uniforms: { uTime: shared.uTime, uGlow: { value: 0 }, uRipple: { value: 0 }, uRadius: { value: R }, uA: { value: TEAL.clone() }, uB: { value: VIOLET.clone() } },
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 5, R * 5), this.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.003;
    ground.renderOrder = 2;

    this.runes = new THREE.ShaderMaterial({
      vertexShader: flatVert,
      fragmentShader: runeFrag,
      ...additive,
      side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uDraw: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: GOLD.clone().lerp(TEAL, 0.25) }, uInner: { value: R * 1.07 }, uOuter: { value: R * 1.26 } },
    });
    const runes = new THREE.Mesh(new THREE.RingGeometry(R * 1.07, R * 1.26, 160, 1), this.runes);
    runes.rotation.x = -Math.PI / 2;
    runes.position.y = 0.005;
    runes.renderOrder = 3;

    this.vortex = new THREE.ShaderMaterial({
      vertexShader: flatVert,
      fragmentShader: vortexFrag,
      transparent: true,
      depthWrite: true,
      uniforms: { uTime: shared.uTime, uOpen: { value: 0 }, uRadius: { value: R }, uA: { value: DEEP.clone() }, uB: { value: TEAL.clone() }, uC: { value: VIOLET.clone() } },
    });
    const vortex = new THREE.Mesh(new THREE.CircleGeometry(R * 1.02, 96), this.vortex);
    vortex.rotation.x = -Math.PI / 2;
    vortex.position.y = 0.007;
    vortex.renderOrder = 1;

    this.ring = new THREE.ShaderMaterial({
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      toneMapped: false,
      uniforms: { uTime: shared.uTime, uIgnite: { value: 0 }, uPower: { value: 1 }, uA: { value: TEAL.clone() }, uB: { value: VIOLET.clone() }, uGold: { value: GOLD.clone() } },
    });
    this.ringMesh = new THREE.Group();
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R, 0.034, 14, 180), this.ring);
    const thin = new THREE.Mesh(new THREE.TorusGeometry(R * 1.045, 0.009, 8, 180), new THREE.MeshStandardMaterial({ color: '#d9b26a', metalness: 0.9, roughness: 0.3, emissive: '#6b4a1a', emissiveIntensity: 0.4 }));
    torus.rotation.x = thin.rotation.x = Math.PI / 2;
    this.ringMesh.add(torus, thin);
    this.ringMesh.position.y = 0.03;

    this.column = new THREE.ShaderMaterial({
      vertexShader: columnVert,
      fragmentShader: columnFrag,
      ...additive,
      side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uIntensity: { value: 0 }, uColor: { value: TEAL.clone().lerp(new THREE.Color('#ffffff'), 0.25) } },
    });
    const H = 2.6;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.96, R * 0.9, H, 64, 1, true).translate(0, H / 2, 0), this.column);
    column.renderOrder = 8;

    // orbiting motes
    const n = Math.round(200 * particleScale);
    const seeds = new Float32Array(n * 4);
    const cols = new Float32Array(n * 3);
    const palette = [TEAL, VIOLET, GOLD, new THREE.Color('#ffffff')];
    for (let i = 0; i < n; i++) {
      seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      const c = palette[i % palette.length];
      cols.set([c.r, c.g, c.b], i * 3);
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    og.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    og.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
    this.orbit = new THREE.ShaderMaterial({
      vertexShader: orbitVert,
      fragmentShader: orbitFrag,
      ...additive,
      uniforms: { uTime: shared.uTime, uGather: { value: 0 }, uRadius: { value: R }, uSize: { value: 0.07 }, uMap: { value: glowTexture() }, uViewportHeight: shared.uViewportHeight },
    });
    const orbit = new THREE.Points(og, this.orbit);
    orbit.frustumCulled = false;
    orbit.renderOrder = 9;

    this.group.add(ground, vortex, runes, this.ringMesh, column, orbit);
    this.apply(0, 0);
  }

  get isOpen() {
    return this.opened;
  }

  /** Brief extra surge of light (e.g. when the world finishes rising). */
  surge() {
    this.columnBoost = 1;
  }

  reset() {
    this.progress = 0;
    this.opened = false;
    this.closing = false;
    this.apply(0, 0);
  }

  close() {
    this.closing = true;
  }

  markOpen() {
    this.opened = true;
  }

  private apply(p: number, t: number) {
    this.runes.uniforms.uDraw.value = smoothstep(0.0, 0.38, p);
    this.runes.uniforms.uIntensity.value = smoothstep(0.0, 0.1, p) * 0.6;
    this.ground.uniforms.uGlow.value = smoothstep(0.05, 0.4, p) * (0.7 + 0.3 * Math.sin(t * 1.5));
    this.ground.uniforms.uRipple.value = smoothstep(0.45, 0.7, p) * (p >= 1 ? 0.45 : 1);
    const ig = smoothstep(0.14, 0.55, p);
    this.ring.uniforms.uIgnite.value = ig * 1.04;
    this.ring.uniforms.uPower.value = 0.7 + 0.3 * Math.sin(t * 2.2) + this.columnBoost * 0.6;
    const s = p < 0.12 ? 0.001 : 0.55 + 0.45 * easeOutBack(clamp((p - 0.12) / 0.4), 1.4);
    this.ringMesh.scale.setScalar(s);
    this.ringMesh.visible = p > 0.12;
    this.orbit.uniforms.uGather.value = smoothstep(0.1, 0.75, p);
    this.vortex.uniforms.uOpen.value = smoothstep(0.42, 0.88, p) * 1.0;
    const peak = smoothstep(0.65, 0.92, p) * (1 - smoothstep(0.95, 1.0, p) * (1 - this.idleColumn));
    this.column.uniforms.uIntensity.value = Math.max(peak, p >= 1 ? this.idleColumn : 0) + this.columnBoost * 0.8;
  }

  update(dt: number, t: number) {
    if (this.closing) {
      this.progress = Math.max(0, this.progress - dt * 0.9);
      if (this.progress <= 0) this.closing = false;
    }
    this.columnBoost = damp(this.columnBoost, 0, 1.5, dt);
    this.apply(this.progress, t);
    this.ringMesh.rotation.y += dt * 0.15;
  }
}
