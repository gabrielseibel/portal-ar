import * as THREE from 'three';
import { POINT_SIZE_GLSL, shared } from '../systems/SharedUniforms';
import { glowTexture } from '../utils/textures';

const vert = /* glsl */ `
${POINT_SIZE_GLSL}
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = worldPointSize(aSize, mv);
}`;
const frag = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, t.a * vColor.a);
  if (gl_FragColor.a < 0.004) discard;
}`;

export interface EmitOptions {
  life?: number;
  size?: number;
  sizeEnd?: number;
  color?: THREE.ColorRepresentation;
  colorEnd?: THREE.ColorRepresentation;
  gravity?: number;
  drag?: number;
}

/**
 * CPU-simulated pooled particles (sparkles, coins, flames). A fixed-size ring
 * buffer means zero allocations per frame.
 */
export class ParticlePool {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private size: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private alive = 0;
  private geo: THREE.BufferGeometry;
  private tmpA = new THREE.Color();
  private tmpB = new THREE.Color();

  constructor(max: number, blending: THREE.Blending = THREE.AdditiveBlending, texture: THREE.Texture = glowTexture()) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { uMap: { value: texture }, uViewportHeight: shared.uViewportHeight },
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(p: THREE.Vector3Like, v: THREE.Vector3Like, o: EmitOptions = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.tmpA.set(o.color ?? '#ffffff');
    this.tmpB.set(o.colorEnd ?? o.color ?? '#ffffff');
    this.c0[i * 3] = this.tmpA.r;
    this.c0[i * 3 + 1] = this.tmpA.g;
    this.c0[i * 3 + 2] = this.tmpA.b;
    this.c1[i * 3] = this.tmpB.r;
    this.c1[i * 3 + 1] = this.tmpB.g;
    this.c1[i * 3 + 2] = this.tmpB.b;
    this.s0[i] = o.size ?? 0.03;
    this.s1[i] = o.sizeEnd ?? (o.size ?? 0.03) * 0.3;
    this.maxLife[i] = this.life[i] = o.life ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 1.2;
    this.alive = Math.min(this.max, this.alive + 1);
  }

  /** Radial burst of sparkles. */
  burst(p: THREE.Vector3Like, count: number, speed: number, o: EmitOptions = {}) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(p, { x: Math.cos(a) * r * s, y: Math.abs(u) * s * 1.1, z: Math.sin(a) * r * s }, { ...o, life: (o.life ?? 1) * (0.6 + Math.random() * 0.6) });
    }
  }

  update(dt: number) {
    if (this.alive === 0) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.col[i * 4 + 3] !== 0) {
          this.col[i * 4 + 3] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const k = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * k;
      this.col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * k;
      this.col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * k;
      this.col[i * 4 + 3] = Math.min(1, (1 - k) * 2.2) * Math.min(1, k * 12);
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
    }
    if (!any) this.alive = 0;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}
