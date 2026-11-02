import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collects many small procedural pieces (each with a flat colour) and merges
 * them into a single vertex-coloured mesh: hundreds of props → one draw call.
 */
export class StaticBatch {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  get count() {
    return this.parts.length;
  }

  add(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    position: THREE.Vector3Like = { x: 0, y: 0, z: 0 },
    rotation: { x?: number; y?: number; z?: number } = {},
    scale: number | THREE.Vector3Like = 1,
    jitter = 0,
    rng: () => number = Math.random,
  ) {
    this.e.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
    this.q.setFromEuler(this.e);
    if (typeof scale === 'number') this.s.setScalar(scale);
    else this.s.set(scale.x, scale.y, scale.z);
    this.p.set(position.x, position.y, position.z);
    this.m.compose(this.p, this.q, this.s);
    this.addMatrix(geo, color, this.m, jitter, rng);
  }

  addMatrix(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix: THREE.Matrix4, jitter = 0, rng: () => number = Math.random) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color);
    if (jitter > 0) {
      const k = 1 + (rng() - 0.5) * jitter;
      c.multiplyScalar(k);
    }
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }

  /** Adds a pre-coloured geometry (must already carry a `color` attribute). */
  addColored(geo: THREE.BufferGeometry) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    this.parts.push(g);
  }

  build(material: THREE.Material, name = 'batch'): THREE.Mesh {
    const merged = this.parts.length ? mergeGeometries(this.parts, false) : new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    return mesh;
  }
}

/** Shared flat-shaded, vertex-coloured material for scenery. */
export function sceneryMaterial(opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.88,
    metalness: 0,
    ...opts,
  });
}

/** Right triangular prism (house roof) — ridge along X. */
export function roofGeometry(w: number, d: number, h: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}
