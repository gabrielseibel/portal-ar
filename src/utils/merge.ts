import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function prepare(m: THREE.Mesh, withColor: boolean) {
  m.updateMatrix();
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.applyMatrix4(m.matrix);
  if (withColor) {
    const c = (m.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

/**
 * Bakes every *rigid* set of sibling meshes (same parent) into one vertex-coloured
 * mesh, keeping the parent hierarchy (and therefore every animated joint) intact.
 * Only opaque, front-sided meshes accepted by `accept` are merged.
 */
export function bakeRigidParts(root: THREE.Object3D, material: THREE.Material, accept: (m: THREE.Mesh) => boolean = defaultAccept) {
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => parents.push(o));
  let removed = 0;
  for (const p of parents) {
    const meshes = p.children.filter((c) => (c as THREE.Mesh).isMesh && accept(c as THREE.Mesh)) as THREE.Mesh[];
    if (meshes.length < 2) continue;
    const merged = mergeGeometries(meshes.map((m) => prepare(m, true)), false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    mesh.name = `${p.name || 'part'}-baked`;
    for (const m of meshes) p.remove(m);
    p.add(mesh);
    removed += meshes.length - 1;
  }
  return removed;
}

function defaultAccept(m: THREE.Mesh) {
  const mat = m.material as THREE.Material;
  if (Array.isArray(m.material) || !mat.visible || mat.transparent || mat.side !== THREE.FrontSide) return false;
  return (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial === true || (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;
}

/** Merges the direct static children of `group` that share a material (one draw call per material). */
export function mergeByMaterial(group: THREE.Object3D) {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of [...group.children]) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) continue;
    const list = buckets.get(m.material) ?? [];
    list.push(m);
    buckets.set(m.material, list);
  }
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const merged = mergeGeometries(meshes.map((m) => prepare(m, false)), false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    for (const m of meshes) group.remove(m);
    group.add(mesh);
  }
}
