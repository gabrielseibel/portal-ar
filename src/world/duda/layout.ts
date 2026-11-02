/**
 * Fazenda da Duda — layout in *voxel* coordinates of the farm model
 * (x: 0..NX left→right, y: 0..NY front→back, z: up; ground top at z = 2).
 * `vx`/`vz` convert to island-local units (viewer on +Z, ground top at y = 0).
 */
export const NX = 126;
export const NY = 115;
export const NZ = 26;
/** Size of one voxel in island units: the 126 × 115 board spans ≈ 1.64 × 1.50. */
export const S = 0.013;
export const GROUND_Z = 2;

export const vx = (x: number) => (x - NX / 2) * S;
export const vz = (y: number) => (NY / 2 - y) * S;
export const vy = (z: number) => (z - GROUND_Z) * S;

export type Rect = readonly [x0: number, x1: number, y0: number, y1: number];
export const rectCenter = (r: Rect): [number, number] => [(r[0] + r[1] + 1) / 2, (r[2] + r[3] + 1) / 2];
export const inRect = (x: number, y: number, r: Rect) => x >= r[0] && x <= r[1] && y >= r[2] && y <= r[3];

export type FieldKind = 'tomato' | 'pumpkin' | 'blueberry' | 'cauli' | 'strawberry';
export const FIELDS: Record<FieldKind, Rect> = {
  tomato: [71, 86, 59, 77],
  pumpkin: [87, 103, 59, 77],
  blueberry: [71, 86, 41, 58],
  cauli: [87, 103, 41, 58],
  strawberry: [46, 62, 48, 66],
};
export const FIELD_NAMES: Record<FieldKind, [string, string]> = {
  tomato: ['tomate', 'tomates'],
  pumpkin: ['abóbora', 'abóboras'],
  blueberry: ['mirtilo', 'mirtilos'],
  cauli: ['couve-flor', 'couves-flores'],
  strawberry: ['framboesa', 'framboesas'],
};

export const HOUSE_LOT: Rect = [18, 43, 47, 68];
/** Farmhouse model placement: centre of its footprint and depth in voxels (the model is 0.82 wide × 1 deep). */
export const HOUSE = { x: 31, y: 57.5, depth: 20, width: 16.4 };
export const GREENHOUSE: Rect = [28, 44, 79, 94];
export const SHED: Rect = [39, 48, 38, 45];
export const BARN: Rect = [92, 111, 82, 96];
export const COOP: Rect = [105, 121, 66, 76];
export const HIVES: Rect = [71, 82, 89, 93];
export const POND: Rect = [52, 74, 18, 35];
export const SCARECROW = { x: 60, y: 40 };
/** Where the chickens wander (in front of the coop). */
export const PEN: Rect = [104, 119, 55, 64];
export const CLOVER = { x: 98, y: 17 };
export const DOG_BED = { x: 47, y: 79 };

/** Duda's daily walk along the farm paths: [x, y, pause seconds, activity]. */
export type Stop = readonly [x: number, y: number, pause: number, act?: 'water' | 'look' | 'house' | 'wave'];
export const ROUTE: readonly Stop[] = [
  [32, 46, 3, 'house'],
  [32, 38.5, 0],
  [40, 37.5, 0],
  [56, 37.5, 2.5, 'look'],
  [63, 37.5, 0],
  [78, 39, 3.5, 'water'],
  [95, 39, 3.5, 'water'],
  [104, 39, 0],
  [104, 52, 2.5, 'wave'],
  [104, 39, 0],
  [65, 38, 0],
  [65, 60, 3, 'water'],
  [65, 78, 0],
  [65, 86, 2.5, 'look'],
  [65, 60, 0],
  [65, 38, 0],
  [40, 37.5, 0],
  [32, 38.5, 0],
];
