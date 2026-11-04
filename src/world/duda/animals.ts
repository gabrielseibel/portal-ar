import * as THREE from 'three';
import { paintedGeometry } from './kit';

/**
 * Pets and farm animals in the painted low-poly style, after the reference
 * sprite sheets: cats, dogs, turtles, chickens, ducks, rabbits, cows, goats
 * and pigs. Each one is a single vertex-coloured geometry (one draw call).
 * All face +Z and stand on y = 0.
 */
type Part = [THREE.BufferGeometry, string, number, number, number];
const sph = (r: number, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 10, 8).scale(sx, sy, sz);
const cyl = (r: number, h: number) => new THREE.CylinderGeometry(r, r, h, 7);
const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 6);
const legs = (hex: string, r: number, h: number, dx: number, dz: number, y = h / 2): Part[] =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [cyl(r, h), hex, sx * dx, y, sz * dz] as Part));
const eyes = (hex: string, r: number, dx: number, y: number, z: number): Part[] => [-1, 1].map((s) => [sph(r), hex, s * dx, y, z] as Part);

export type AnimalKind = 'cat' | 'dog' | 'turtle' | 'chicken' | 'duck' | 'rabbit' | 'cow' | 'goat' | 'pig';

/** Sitting cat (pets) — `sit` false gives a standing one. */
export function catGeometry(fur: string, belly = '#f4e8d0', eye = '#3a2a1e', sit = true) {
  const p: Part[] = sit
    ? [
        [sph(0.0085, 1, 1.15, 0.95), fur, 0, 0.009, 0],
        [sph(0.0045, 1, 1.2, 0.6), belly, 0, 0.009, 0.0065],
        [cyl(0.0022, 0.009), fur, -0.004, 0.0045, 0.006],
        [cyl(0.0022, 0.009), fur, 0.004, 0.0045, 0.006],
      ]
    : [[sph(0.008, 0.9, 0.8, 1.5), fur, 0, 0.011, 0], ...legs(fur, 0.0022, 0.008, 0.004, 0.007)];
  const hy = sit ? 0.022 : 0.019;
  const hz = sit ? 0.002 : 0.012;
  p.push(
    [sph(0.0075, 1.1, 0.95, 1), fur, 0, hy, hz],
    [cone(0.0032, 0.007), fur, -0.0045, hy + 0.0075, hz],
    [cone(0.0032, 0.007), fur, 0.0045, hy + 0.0075, hz],
    [sph(0.003, 1.2, 0.8, 0.6), belly, 0, hy - 0.002, hz + 0.0055],
    ...eyes(eye, 0.0013, 0.0028, hy + 0.001, hz + 0.0068),
    [new THREE.CapsuleGeometry(0.0018, 0.012, 2, 6).rotateX(sit ? 1.3 : 0.9), fur, 0, sit ? 0.004 : 0.016, sit ? -0.01 : -0.015],
  );
  return paintedGeometry(p);
}

/** Sitting dog with floppy or pointy ears and a collar. */
export function dogGeometry(fur: string, ears: string, pointy = false, collar = '#d9343a', sit = true) {
  const hy = sit ? 0.025 : 0.022;
  const hz = sit ? 0.004 : 0.015;
  const p: Part[] = sit
    ? [
        [sph(0.009, 1, 1.2, 1), fur, 0, 0.011, 0],
        [cyl(0.0025, 0.012), fur, -0.004, 0.006, 0.006],
        [cyl(0.0025, 0.012), fur, 0.004, 0.006, 0.006],
      ]
    : [[sph(0.009, 0.9, 0.85, 1.55), fur, 0, 0.013, 0], ...legs(fur, 0.0026, 0.01, 0.005, 0.009)];
  p.push(
    [new THREE.TorusGeometry(0.0055, 0.0012, 5, 12).rotateX(Math.PI / 2), collar, 0, hy - 0.006, hz - 0.001],
    [sph(0.0078), fur, 0, hy, hz],
    [sph(0.0042, 1, 0.85, 1.2), '#f0d6b0', 0, hy - 0.002, hz + 0.0065],
    [sph(0.0016), '#2a1c14', 0, hy - 0.0005, hz + 0.011],
    ...eyes('#2a1c14', 0.0012, 0.003, hy + 0.0025, hz + 0.0068),
    [new THREE.CapsuleGeometry(0.002, 0.01, 2, 6).rotateX(-0.6), fur, 0, sit ? 0.006 : 0.018, sit ? -0.011 : -0.016],
  );
  if (pointy) p.push([cone(0.0032, 0.009), ears, -0.0045, hy + 0.008, hz], [cone(0.0032, 0.009), ears, 0.0045, hy + 0.008, hz]);
  else p.push([sph(0.0034, 0.6, 1.4, 1), ears, -0.0075, hy, hz - 0.001], [sph(0.0034, 0.6, 1.4, 1), ears, 0.0075, hy, hz - 0.001]);
  return paintedGeometry(p);
}

export function turtleGeometry(shell: string, skin = '#6aa84a') {
  return paintedGeometry([
    [sph(0.011, 1, 0.55, 1.2), shell, 0, 0.006, 0],
    [sph(0.0115, 1, 0.12, 1.2), '#c9a066', 0, 0.002, 0],
    [sph(0.0042), skin, 0, 0.005, 0.015],
    ...eyes('#1a1410', 0.001, 0.002, 0.007, 0.018),
    ...legs(skin, 0.0025, 0.004, 0.008, 0.008, 0.002),
  ]);
}

export function chickenGeometry(body: string) {
  return paintedGeometry([
    [sph(0.008, 1, 0.95, 1.2), body, 0, 0.009, 0],
    [new THREE.ConeGeometry(0.004, 0.009, 6).rotateX(-0.9), body, 0, 0.012, -0.009],
    [sph(0.0055), body, 0, 0.018, 0.007],
    [sph(0.0026, 0.6, 1, 1.3), '#e3402f', 0, 0.023, 0.007],
    [new THREE.ConeGeometry(0.0018, 0.004, 5).rotateX(Math.PI / 2), '#f2b23a', 0, 0.018, 0.013],
    ...eyes('#1a1410', 0.0008, 0.0035, 0.0195, 0.0105),
    [cyl(0.001, 0.005), '#f2b23a', -0.003, 0.0025, 0],
    [cyl(0.001, 0.005), '#f2b23a', 0.003, 0.0025, 0],
  ]);
}

export function duckGeometry(head = '#2f8a5a', body = '#f4f1e8') {
  return paintedGeometry([
    [sph(0.0075, 0.9, 0.7, 1.3), body, 0, 0.004, 0],
    [sph(0.0047), head, 0, 0.011, 0.007],
    [new THREE.ConeGeometry(0.002, 0.006, 5).rotateX(Math.PI / 2), '#f2a23a', 0, 0.0105, 0.0125],
    [sph(0.0035, 1, 0.5, 1.4), '#c9b89a', 0, 0.006, -0.002],
  ]);
}

export function rabbitGeometry(fur: string) {
  return paintedGeometry([
    [sph(0.0075, 1, 0.9, 1.25), fur, 0, 0.008, 0],
    [sph(0.0052), fur, 0, 0.015, 0.008],
    [sph(0.0019, 0.7, 2.6, 0.7), fur, -0.0025, 0.024, 0.006],
    [sph(0.0019, 0.7, 2.6, 0.7), '#f2b4b4', 0.0025, 0.024, 0.006],
    [sph(0.0026), '#ffffff', 0, 0.009, -0.009],
    ...eyes('#1a1410', 0.0009, 0.0028, 0.0165, 0.0125),
  ]);
}

export function cowGeometry(base: string, spot: string) {
  return paintedGeometry([
    [sph(0.015, 1, 0.85, 1.55), base, 0, 0.021, 0],
    [sph(0.0062, 1, 0.8, 1.2), spot, 0.007, 0.027, 0.006],
    [sph(0.0055, 1, 0.8, 1.2), spot, -0.008, 0.024, -0.011],
    [sph(0.0085, 1, 0.95, 1.1), base, 0, 0.03, 0.023],
    [sph(0.006, 1.1, 0.7, 0.8), '#e8a7a0', 0, 0.026, 0.031],
    [cone(0.0018, 0.006), '#e9dfcf', -0.006, 0.039, 0.022],
    [cone(0.0018, 0.006), '#e9dfcf', 0.006, 0.039, 0.022],
    ...eyes('#1a1410', 0.0012, 0.0045, 0.033, 0.03),
    ...legs(base, 0.003, 0.014, 0.008, 0.013),
    [sph(0.0035, 1, 0.6, 1), '#f2b4b4', 0, 0.011, 0.006],
  ]);
}

export function goatGeometry(fur = '#e8c86a') {
  return paintedGeometry([
    [sph(0.011, 0.95, 0.85, 1.5), fur, 0, 0.018, 0],
    [sph(0.0065, 1, 1, 1.25), fur, 0, 0.028, 0.017],
    [cone(0.0018, 0.008), '#8a7a6a', -0.003, 0.036, 0.014],
    [cone(0.0018, 0.008), '#8a7a6a', 0.003, 0.036, 0.014],
    [cone(0.0018, 0.006), '#f4ead2', 0, 0.02, 0.022],
    ...eyes('#1a1410', 0.001, 0.0035, 0.03, 0.024),
    ...legs(fur, 0.0024, 0.012, 0.006, 0.009),
  ]);
}

export function pigGeometry(skin = '#f2a7b8') {
  return paintedGeometry([
    [sph(0.012, 1, 0.85, 1.35), skin, 0, 0.014, 0],
    [cyl(0.0042, 0.004).rotateX(Math.PI / 2), '#e58aa0', 0, 0.015, 0.018],
    [cone(0.0025, 0.005), skin, -0.005, 0.024, 0.01],
    [cone(0.0025, 0.005), skin, 0.005, 0.024, 0.01],
    ...eyes('#1a1410', 0.001, 0.004, 0.019, 0.0145),
    ...legs(skin, 0.0025, 0.007, 0.006, 0.008),
  ]);
}

export function animalGeometry(kind: AnimalKind, colors: string[] = []) {
  const [a = '#e8a33a', b = '#f4e8d0', c] = colors;
  switch (kind) {
    case 'cat':
      return catGeometry(a, b, c);
    case 'dog':
      return dogGeometry(a, b, c === 'pointy');
    case 'turtle':
      return turtleGeometry(a);
    case 'chicken':
      return chickenGeometry(a);
    case 'duck':
      return duckGeometry(a, b);
    case 'rabbit':
      return rabbitGeometry(a);
    case 'cow':
      return cowGeometry(a, b);
    case 'goat':
      return goatGeometry(a);
    case 'pig':
      return pigGeometry(a);
  }
}
