import * as THREE from 'three';

export interface Tappable {
  object: THREE.Object3D;
  name: string;
  onTap: (hit: THREE.Intersection) => void;
  enabled?: () => boolean;
  /** Higher wins when several targets are hit at almost the same depth. */
  priority?: number;
}

function visibleInHierarchy(o: THREE.Object3D | null): boolean {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

/** Ray-casts screen taps (or XR rays) against generous invisible touch targets. */
export class InteractionSystem {
  private raycaster = new THREE.Raycaster();
  private targets: Tappable[] = [];
  private ndc = new THREE.Vector2();
  private invProj = new THREE.Matrix4();
  enabled = true;

  clear() {
    this.targets = [];
  }

  add(t: Tappable) {
    this.targets.push(t);
    return t;
  }

  /** x, y in CSS pixels relative to the viewport. */
  tapScreen(x: number, y: number, w: number, h: number, camera: THREE.PerspectiveCamera) {
    this.ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    camera.updateMatrixWorld();
    const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    this.invProj.copy(camera.projectionMatrix).invert();
    const dir = new THREE.Vector3(this.ndc.x, this.ndc.y, 0.5).applyMatrix4(this.invProj).applyMatrix4(camera.matrixWorld).sub(origin).normalize();
    return this.tapRay(origin, dir);
  }

  /**
   * Picks the target the ray goes *most centrally* through (relative to the
   * target's size), not merely the nearest one: big touch volumes (village)
   * must not swallow taps meant for small things right behind them (crystals).
   */
  tapRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    if (!this.enabled) return null;
    this.raycaster.set(origin, dir);
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;
    let best: { t: Tappable; hit: THREE.Intersection; score: number } | null = null;
    const center = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (const t of this.targets) {
      if (t.enabled && !t.enabled()) continue;
      if (!visibleInHierarchy(t.object.parent)) continue;
      const hits = this.raycaster.intersectObject(t.object, false);
      if (!hits.length) continue;
      const hit = hits[0];
      const geo = (t.object as THREE.Mesh).geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      center.copy(geo.boundingSphere!.center).applyMatrix4(t.object.matrixWorld);
      t.object.getWorldScale(scale);
      const radius = geo.boundingSphere!.radius * Math.max(scale.x, scale.y, scale.z);
      const off = this.raycaster.ray.distanceToPoint(center) / Math.max(radius, 1e-6);
      const score = off - (t.priority ?? 0) * 0.12;
      if (!best || score < best.score) best = { t, hit, score };
    }
    if (best) best.t.onTap(best.hit);
    return best?.t.name ?? null;
  }
}
