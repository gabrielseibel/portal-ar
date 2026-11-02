/**
 * Vale Alecrim — an original cozy farm + village, voxel style.
 * Island-local units (radius ≈ 1, ground top at y = 0). Viewer on +Z.
 * West (−X): the farm. East (+X): the village. North (−Z): hill, waterfall, forest.
 */
export const V = 0.05; // horizontal voxel size
export const HSTEP = 0.04; // vertical step

export const RIVER_X = -0.09;
export const RIVER_HALF = 0.045;
export const RIVER_START_Z = -0.5;
export const HILL_Z1 = -0.5; // first terrace
export const HILL_Z2 = -0.7; // second terrace
export const WATER_Y = -0.028;

export const POND = { x: -0.46, z: 0.6, r: 0.14 };
export const FIELD = { x0: -0.78, x1: -0.3, z0: 0.08, z1: 0.38 };
export const FARMHOUSE = { x: -0.56, z: -0.17 };
export const BARN = { x: -0.27, z: -0.37 };
export const COOP = { x: -0.84, z: -0.2 };
export const PEN = { x0: -0.95, x1: -0.72, z0: -0.38, z1: -0.04 };
export const PASTURE = { x0: -0.95, x1: -0.66, z0: 0.46, z1: 0.75 };
export const MAILBOX = { x: -0.38, z: -0.03 };
export const DOCK = { x: -0.34, z: 0.52 };
export const TREASURE = { x: -0.22, z: 0.8 };

export const PLAZA = { x: 0.44, z: 0.1, half: 0.19 };
export const BRIDGE_Z = 0.1;
export const ANCIENT_TREE = { x: 0.12, z: -0.12 };
export const MINE = { x: RIVER_X, z: -0.505 };
export const GIANT_MUSHROOM = { x: 0.66, z: -0.68 };
export const FOREST = { x: 0.55, z: -0.66, r: 0.3 };

export type P2 = readonly [number, number];
export const PATHS: ReadonlyArray<ReadonlyArray<P2>> = [
  // farmhouse porch → bridge → plaza
  [
    [-0.56, -0.05],
    [-0.4, 0.04],
    [-0.2, 0.1],
    [0.0, 0.1],
    [0.25, 0.1],
  ],
  // farmhouse → barn
  [
    [-0.5, -0.1],
    [-0.3, -0.25],
  ],
  // farm → pond dock
  [
    [-0.4, 0.04],
    [-0.36, 0.44],
  ],
  // plaza → forest
  [
    [0.44, -0.09],
    [0.5, -0.45],
  ],
];
