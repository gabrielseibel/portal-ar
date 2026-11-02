import * as THREE from 'three';

export interface ModelEntry {
  /** Path relative to the site root, e.g. "models/windmill.glb". */
  src: string;
  /** Island-local position (island radius ≈ 1). */
  position?: [number, number, number];
  rotationY?: number;
  scale?: number;
}

const TIMEOUT_MS = 15000;

/**
 * Optional GLTF/GLB extension point. The shipped world is 100% procedural, but
 * extra models can be dropped into `public/models/` and listed in
 * `public/models/manifest.json`. Every failure (missing file, bad GLB, timeout)
 * is caught and logged: the experience never breaks because of an asset.
 */
export async function loadOptionalModels(parent: THREE.Object3D, base = import.meta.env.BASE_URL) {
  let entries: ModelEntry[] = [];
  try {
    const res = await fetch(`${base}models/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: ModelEntry[] };
    entries = Array.isArray(json.models) ? json.models : [];
  } catch {
    return [];
  }
  if (!entries.length) return [];

  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const loaded: THREE.Object3D[] = [];
  await Promise.all(
    entries.map(async (e) => {
      try {
        const gltf = await Promise.race([
          loader.loadAsync(`${base}${e.src}`),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
        ]);
        const obj = gltf.scene;
        if (e.position) obj.position.fromArray(e.position);
        obj.rotation.y = e.rotationY ?? 0;
        obj.scale.setScalar(e.scale ?? 1);
        obj.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
        });
        parent.add(obj);
        loaded.push(obj);
      } catch (err) {
        console.warn(`[assets] modelo opcional ignorado: ${e.src}`, err);
      }
    }),
  );
  return loaded;
}
