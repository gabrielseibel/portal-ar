/**
 * Vale da Duda — layout in island-local units (ground ≈ y 0, viewer on +Z).
 * Follows the reference valley map: the farm in the south-west, the town and
 * its plaza in the middle, a river coming down from the mountain lake in the
 * north-east to a bay with a pier in the south-east, and a forest in the west.
 */
export type P2 = readonly [number, number];
export type Rect = readonly [x0: number, x1: number, z0: number, z1: number];

export const inRect = (x: number, z: number, r: Rect, m = 0) => x > r[0] - m && x < r[1] + m && z > r[2] - m && z < r[3] + m;
export const rectCenter = (r: Rect): [number, number] => [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2];

/** Island footprint: a noisy super-ellipse. */
export const ISLAND = { a: 1.42, b: 1.18, n: 4 };

// ------------------------------------------------------------------ farm
export const FARM: Rect = [-1.27, -0.2, -0.1, 0.98];
export type FieldKind = 'tomato' | 'pumpkin' | 'blueberry' | 'cauli' | 'strawberry';
export const FIELDS: Record<FieldKind, Rect> = {
  tomato: [-0.7, -0.52, 0.08, 0.24],
  pumpkin: [-0.47, -0.29, 0.08, 0.24],
  blueberry: [-0.7, -0.52, 0.3, 0.46],
  cauli: [-0.47, -0.29, 0.3, 0.46],
  strawberry: [-0.86, -0.72, 0.62, 0.78],
};
export const FIELD_NAMES: Record<FieldKind, [string, string]> = {
  tomato: ['tomate', 'tomates'],
  pumpkin: ['abóbora', 'abóboras'],
  blueberry: ['mirtilo', 'mirtilos'],
  cauli: ['couve-flor', 'couves-flores'],
  strawberry: ['framboesa', 'framboesas'],
};
/** The user's farmhouse model (leveled + squared, 0.76 wide × 1 deep); depth in island units. */
export const HOUSE = { x: -1.0, z: 0.42, depth: 0.27 };
export const GREENHOUSE = { x: -1.06, z: 0.06, w: 0.22, d: 0.18 };
export const HIVES = { x: -0.8, z: 0.0 };
export const SHED = { x: -0.8, z: 0.28, w: 0.1, d: 0.09 };
export const BARN = { x: -0.33, z: -0.02, w: 0.2, d: 0.15 };
export const COOP = { x: -0.3, z: 0.6, w: 0.12, d: 0.1 };
export const PEN: Rect = [-0.4, -0.22, 0.68, 0.86];
export const POND = { x: -0.56, z: 0.8, r: 0.09 };
export const SCARECROW = { x: -0.495, z: 0.27 };
export const DOG_BED = { x: -0.9, z: 0.15 };
export const CLOVER = { x: -0.68, z: 0.94 };
export const MAILBOX = { x: -0.84, z: 0.6 };
export const ORCHARD: Rect = [-1.22, -0.92, 0.66, 0.94];
export const FARM_GATE: P2 = [-0.2, 0.34];

// ------------------------------------------------------------------ town
export const PLAZA = { x: 0.22, z: 0.04, r: 0.17 };
export interface BuildingSpec {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  wall: 'wood' | 'plaster' | 'stone' | 'red' | 'blue';
  roof: string;
  title: string;
  sub: string;
  text: string;
  tower?: boolean;
}
export const TOWN_BUILDINGS: readonly BuildingSpec[] = [
  { id: 'center', x: 0.22, z: -0.3, w: 0.3, d: 0.16, h: 0.11, rot: 0, wall: 'stone', roof: '#3f6fa8', tower: true, title: 'Centro Comunitário', sub: 'O coração do vale', text: 'Aqui acontecem as festas da colheita, os bailes de inverno e as reuniões em que todo mundo fala ao mesmo tempo. O relógio da torre adianta cinco minutos, e ninguém conserta.' },
  { id: 'store', x: -0.09, z: -0.1, w: 0.18, d: 0.14, h: 0.09, rot: Math.PI / 2, wall: 'wood', roof: '#3d8a4f', title: 'Mercado do Vale', sub: 'Sementes e miudezas', text: 'Sementes da estação, regadores, fitas e aquele doce de leite que a Duda compra toda sexta.' },
  { id: 'saloon', x: 0.55, z: -0.06, w: 0.2, d: 0.15, h: 0.1, rot: -Math.PI / 2, wall: 'red', roof: '#6b3a2a', title: 'Taverna Estrela', sub: 'Música aos sábados', text: 'Sopa de abóbora no inverno, suco de framboesa no verão e um piano que só toca três músicas.' },
  { id: 'clinic', x: 0.52, z: 0.3, w: 0.16, d: 0.13, h: 0.085, rot: -Math.PI / 2, wall: 'plaster', roof: '#4f7fb8', title: 'Clínica do Vale', sub: 'Doutora Lia', text: 'Curativos, chás de camomila e uma placa: “Abelhas não são motivo de pânico.”' },
  { id: 'smithy', x: -0.06, z: -0.48, w: 0.15, d: 0.12, h: 0.08, rot: 0, wall: 'stone', roof: '#5b5f6e', title: 'Ferreiro', sub: 'Ferramentas e ferraduras', text: 'O martelo começa às seis da manhã. A Duda diz que é o despertador oficial do vale.' },
];
/** Copies of the user's farmhouse used as town homes (roof tint, rotation). */
export const TOWN_HOMES: ReadonlyArray<{ x: number; z: number; rot: number; roof: string }> = [
  { x: 0.0, z: 0.36, rot: 0, roof: '#4f8fd8' },
  { x: 0.3, z: 0.52, rot: 0, roof: '#9a6ad8' },
  { x: 0.5, z: -0.42, rot: Math.PI, roof: '#e0a23a' },
  { x: 0.32, z: -0.62, rot: Math.PI, roof: '#4fae6a' },
];

// ------------------------------------------------------------------ water, mountains, beach
export const LAKE = { x: 0.98, z: -0.86, r: 0.17, y: 0.2 };
export const WATERFALL = { x: 0.9, top: -0.7, bottom: -0.56 };
export const RIVER: readonly P2[] = [
  [0.9, -0.56],
  [0.84, -0.32],
  [0.78, -0.06],
  [0.76, 0.18],
  [0.83, 0.44],
  [0.95, 0.66],
  [1.05, 0.84],
];
export const RIVER_W = 0.045;
export const SEA = { x: 1.12, z: 1.02, r: 0.5 };
export const SEA_Y = -0.032;
export const PIER: readonly P2[] = [
  [0.62, 0.84],
  [0.76, 1.0],
];
export const MINE = { x: 0.6, z: -0.68 };
export const MOUNTAINS: ReadonlyArray<{ x: number; z: number; h: number; r: number }> = [
  { x: 0.72, z: -1.02, h: 0.42, r: 0.26 },
  { x: 1.2, z: -0.72, h: 0.36, r: 0.24 },
  { x: 1.24, z: -1.04, h: 0.46, r: 0.22 },
  { x: 0.46, z: -0.98, h: 0.3, r: 0.22 },
  { x: 0.98, z: -1.12, h: 0.44, r: 0.24 },
  { x: -0.12, z: -1.04, h: 0.14, r: 0.3 },
  { x: 0.16, z: -1.08, h: 0.17, r: 0.24 },
];
export const FOREST: Rect = [-1.42, -0.34, -1.18, -0.18];
export const BEACH = { x: 0.82, z: 0.96, r: 0.62 };
/** Bridges over the river: [x, z, yaw]. */
export const BRIDGES: ReadonlyArray<[number, number, number]> = [[0.78, 0.0, Math.PI / 2]];

/** Dirt paths (polylines). */
export const PATHS: ReadonlyArray<ReadonlyArray<P2>> = [
  // farm gate → plaza
  [FARM_GATE, [-0.05, 0.22], [0.08, 0.1]],
  // farmhouse porch → gate, through the farm
  [[-1.0, 0.58], [-0.86, 0.56], [-0.62, 0.53], [-0.4, 0.53], [-0.24, 0.42], FARM_GATE],
  // between the fields
  [[-0.5, 0.06], [-0.5, 0.53]],
  [[-0.86, 0.56], [-0.86, 0.12], [-0.9, 0.0]],
  // plaza → community center
  [[0.22, -0.13], [0.22, -0.22]],
  // plaza → bridge → mountain trail → mine
  [[0.39, 0.0], [0.62, 0.0], [0.92, -0.02], [0.98, -0.24], [0.8, -0.42], [0.62, -0.6]],
  // plaza → clinic → beach → pier
  [[0.33, 0.16], [0.52, 0.42], [0.64, 0.66], [0.62, 0.84]],
  // plaza → homes
  [[0.12, 0.17], [0.03, 0.28]],
  [[0.27, 0.21], [0.3, 0.42]],
  // north: smithy and homes behind the community center
  [[0.08, -0.16], [-0.04, -0.4]],
  [[0.36, -0.2], [0.46, -0.34], [0.36, -0.54]],
];

/** Duda's day: around the farm, a visit to town, back home. [x, z, pause s, activity] */
export type Stop = readonly [x: number, z: number, pause: number, act?: 'water' | 'look' | 'house' | 'wave'];
export const ROUTE: readonly Stop[] = [
  [-1.0, 0.6, 3, 'house'],
  [-0.86, 0.56, 0],
  [-0.62, 0.53, 0],
  [-0.61, 0.27, 3.5, 'water'],
  [-0.5, 0.27, 0],
  [-0.38, 0.27, 3.5, 'water'],
  [-0.5, 0.53, 0],
  [-0.4, 0.53, 0],
  [-0.31, 0.66, 2.5, 'wave'],
  [-0.24, 0.42, 0],
  [-0.2, 0.34, 0],
  [-0.05, 0.22, 0],
  [0.08, 0.1, 0],
  [0.16, 0.12, 3, 'look'],
  [0.08, 0.1, 0],
  [-0.05, 0.22, 0],
  [-0.2, 0.34, 0],
  [-0.24, 0.42, 0],
  [-0.4, 0.53, 0],
  [-0.62, 0.53, 0],
  [-0.66, 0.74, 2.5, 'look'],
  [-0.62, 0.53, 0],
  [-0.86, 0.56, 0],
];

/** Town folk walking loops. */
export const WALKERS: ReadonlyArray<{ name: string; route: readonly P2[]; lines: readonly string[]; style: [skin: string, hair: string, shirt: string, pants: string, hat?: string] }> = [
  {
    name: 'Seu Tonico',
    route: [[0.1, -0.06], [0.34, -0.06], [0.34, 0.14], [0.1, 0.14]],
    lines: ['Bom dia! A fonte da praça está mais cheia hoje.', 'Na minha época, as abóboras eram do tamanho de carroças.'],
    style: ['#e8b58e', '#d9d4cc', '#7a8a5a', '#4a3b2f', '#6b4a2e'],
  },
  {
    name: 'Lia',
    route: [[0.33, 0.16], [0.52, 0.42], [0.64, 0.66], [0.52, 0.42]],
    lines: ['Vai à praia? Leve chapéu, o sol do vale engana.', 'Se uma abelha te picar, passe na clínica.'],
    style: ['#c98e6a', '#2a1c14', '#ffffff', '#4a6fb5'],
  },
  {
    name: 'Bento',
    route: [[0.39, 0.0], [0.62, 0.0], [0.92, -0.02], [0.62, 0.0]],
    lines: ['Já subiu até o lago da montanha? Tem uma mina atrás da cachoeira.', 'O rio desce gelado lá de cima.'],
    style: ['#a8724e', '#3a2618', '#c9874a', '#3d3a4f'],
  },
  {
    name: 'Nina',
    route: [[0.03, 0.28], [0.12, 0.17], [0.27, 0.21], [0.3, 0.42]],
    lines: ['Você viu o Biscoito? Ele adora dormir perto da estufa.', 'Quando eu crescer quero ter uma fazenda igual à da Duda!'],
    style: ['#f1c19a', '#e0a23a', '#ff8ab6', '#7a5ad8'],
  },
];
