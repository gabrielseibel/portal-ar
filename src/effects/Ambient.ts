import * as THREE from 'three';
import { POINT_SIZE_GLSL, shared } from '../systems/SharedUniforms';
import { glowTexture, smokeTexture } from '../utils/textures';

/* ------------------------------------------------------------------ */
/* Chimney smoke — fully GPU driven                                    */
/* ------------------------------------------------------------------ */
const smokeVert = /* glsl */ `
${POINT_SIZE_GLSL}
uniform float uTime;
uniform float uBoost;
attribute vec2 aSeed;
varying float vAlpha;
void main() {
  float life = fract(uTime * (0.16 + aSeed.x * 0.06) + aSeed.y);
  vec3 p = position;
  p.y += life * (0.13 + uBoost * 0.05);
  p.x += sin(life * 5.0 + aSeed.y * 6.28) * 0.01 + life * 0.035;
  p.z += cos(life * 4.0 + aSeed.x * 6.28) * 0.008;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = worldPointSize(0.025 + life * 0.06, mv);
  vAlpha = smoothstep(0.0, 0.12, life) * (1.0 - life) * (0.5 + uBoost * 0.3);
}`;
const smokeFrag = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vec3(0.93, 0.91, 0.9), t.a * vAlpha);
}`;

export class ChimneySmoke {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private boost = 0;
  private boostTarget = 0;

  constructor(emitters: THREE.Vector3[], perEmitter: number) {
    const n = emitters.length * perEmitter;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 2);
    let k = 0;
    for (const e of emitters) {
      for (let i = 0; i < perEmitter; i++, k++) {
        pos[k * 3] = e.x;
        pos[k * 3 + 1] = e.y;
        pos[k * 3 + 2] = e.z;
        seed[k * 2] = Math.random();
        seed[k * 2 + 1] = i / perEmitter + Math.random() * 0.05;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: smokeVert,
      fragmentShader: smokeFrag,
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: shared.uTime, uBoost: { value: 0 }, uMap: { value: smokeTexture() }, uViewportHeight: shared.uViewportHeight },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'chimney-smoke';
  }

  puff(on: boolean) {
    this.boostTarget = on ? 1 : 0;
  }

  update(dt: number) {
    this.boost += (this.boostTarget - this.boost) * Math.min(1, dt * 2);
    this.mat.uniforms.uBoost.value = this.boost;
  }
}

/* ------------------------------------------------------------------ */
/* Fireflies + floating magic motes                                    */
/* ------------------------------------------------------------------ */
const ffVert = /* glsl */ `
${POINT_SIZE_GLSL}
uniform float uTime;
uniform float uSize;
uniform float uRadius;
attribute vec4 aSeed;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime * (0.3 + aSeed.x * 0.4) + aSeed.y * 40.0;
  p.x += sin(t * 1.1) * uRadius + sin(t * 2.3) * uRadius * 0.4;
  p.y += sin(t * 0.9 + aSeed.z * 6.0) * uRadius * 0.6;
  p.z += cos(t * 1.3) * uRadius + cos(t * 1.7) * uRadius * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed.w * 3.0) + aSeed.z * 30.0);
  vAlpha = smoothstep(0.1, 0.9, blink);
  gl_PointSize = worldPointSize(uSize * (0.6 + aSeed.w * 0.8), mv);
  vColor = aColor;
}`;
const ffFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uIntensity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb * uIntensity, t.a * vAlpha);
}`;

export class Fireflies {
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;

  constructor(positions: THREE.Vector3[], colors: THREE.Color[], size: number, radius: number) {
    const n = positions.length;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    positions.forEach((p, i) => {
      pos.set([p.x, p.y, p.z], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      const c = colors[i % colors.length];
      col.set([c.r, c.g, c.b], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: ffVert,
      fragmentShader: ffFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: shared.uTime,
        uSize: { value: size },
        uRadius: { value: radius },
        uIntensity: { value: 1 },
        uMap: { value: glowTexture() },
        uViewportHeight: shared.uViewportHeight,
      },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }
}
