import * as THREE from 'three';

const frag = /* glsl */ `
uniform float uTime;
uniform float uFound;
varying vec2 vP;
void main(){
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  float ring = smoothstep(0.035, 0.0, abs(r - 0.82));
  float dashes = smoothstep(0.03, 0.0, abs(r - 0.96)) * step(0.5, fract(a * 4.0 / 3.14159 + uTime * 0.3));
  float pulse = smoothstep(0.05, 0.0, abs(r - fract(uTime * 0.7) * 0.8)) * (1.0 - fract(uTime * 0.7));
  float dot_ = smoothstep(0.09, 0.06, r);
  float v = ring + dashes * 0.8 + pulse * 0.6 * uFound + dot_;
  vec3 col = mix(vec3(1.0), vec3(0.37, 0.95, 0.84), uFound);
  float alpha = v * mix(0.45, 0.95, uFound);
  gl_FragColor = vec4(col, alpha);
}`;
const vert = /* glsl */ `
varying vec2 vP;
void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Placement indicator drawn on detected (or assumed) surfaces. */
export class Reticle {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(uTime: { value: number }) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { uTime, uFound: { value: 0 } },
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), this.mat);
    this.mesh.renderOrder = 50;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  setFound(found: boolean) {
    this.mat.uniforms.uFound.value += ((found ? 1 : 0) - this.mat.uniforms.uFound.value) * 0.2;
  }
}
