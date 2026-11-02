/**
 * Island layout in island-local units (top surface base ≈ y 0, radius ≈ 1).
 * Viewer usually stands on +Z looking toward -Z, so "back" is -Z.
 */
export type P2 = readonly [number, number];

/** Height of the island top above the portal plane (stage units). */
export const ISLAND_Y = 1.05;
export const ISLAND_R = 1.0;
export const PORTAL_R = 1.15;

export const MOUNTAINS: ReadonlyArray<{ x: number; z: number; h: number; r: number }> = [
  { x: -0.5, z: -0.5, h: 0.72, r: 0.36 },
  { x: -0.18, z: -0.7, h: 0.55, r: 0.26 },
  { x: -0.76, z: -0.22, h: 0.48, r: 0.24 },
  { x: -0.7, z: -0.66, h: 0.6, r: 0.22 },
  { x: -0.34, z: -0.78, h: 0.42, r: 0.2 },
];

export const CASTLE = { x: 0.44, z: -0.44, r: 0.27, h: 0.22 };
export const VILLAGE = { x: 0.38, z: 0.32, r: 0.27 };
export const FOREST = { x: -0.56, z: 0.26, r: 0.36 };
export const CRYSTALS = { x: 0.08, z: -0.2 };
export const MEADOW = { x: 0.22, z: 0.66 };

/** River from the waterfall pool to the island edge, where it falls into the portal. */
export const RIVER: ReadonlyArray<P2> = [
  [-0.31, -0.33],
  [-0.24, -0.1],
  [-0.1, 0.1],
  [-0.1, 0.38],
  [-0.28, 0.64],
  [-0.4, 0.86],
  [-0.46, 1.02],
];

/** Mountain waterfall: from a ledge down to the pool (x, z). */
export const WATERFALL_TOP: P2 = [-0.4, -0.5];
export const WATERFALL_BOTTOM: P2 = [-0.31, -0.33];

export const PATHS: ReadonlyArray<ReadonlyArray<P2>> = [
  // village → castle gate
  [
    [0.33, 0.22],
    [0.42, 0.04],
    [0.44, -0.18],
  ],
  // village → bridge → forest
  [
    [0.26, 0.3],
    [0.08, 0.27],
    [-0.1, 0.25],
    [-0.3, 0.22],
    [-0.52, 0.2],
  ],
  // village → front meadow
  [
    [0.36, 0.44],
    [0.3, 0.64],
    [0.18, 0.84],
  ],
];

export const BRIDGE = { x: -0.1, z: 0.25, rot: 0 };
export const CHEST = { x: 0.9, z: 0.16 };
export const SECRET_DOOR = { x: 0.66, z: -0.33 };
export const SECRET_CRYSTAL = { x: -0.39, z: -0.47 };
export const BABY_DRAGON = { x: -0.66, z: 0.4 };
export const SINGING_MUSHROOMS = { x: -0.36, z: 0.5 };

/** Dragon perch on the real surface, next to the portal ring (stage units). */
export const PERCH = { x: 1.05, z: 0.78 };
