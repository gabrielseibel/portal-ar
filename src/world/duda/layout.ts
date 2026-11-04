/**
 * Vale da Duda — laid out after the reference world map in the project folder
 * (`529747_…jpg`, 1440 × 860 px inside the frame). Positions are written in
 * map pixels and converted with `M()` to island-local units (ground ≈ y 0,
 * viewer on +Z, north = −Z).
 */
export type P2 = readonly [number, number];
export type Rect = readonly [x0: number, x1: number, z0: number, z1: number];

/** Island units per map pixel. */
const K = 0.00243;
/** Map pixel (inside the frame) → island [x, z]. */
export const M = (mx: number, my: number): [number, number] => [(mx - 760) * K, (my - 470) * K];
const MR = (x0: number, x1: number, y0: number, y1: number): Rect => {
  const [a, b] = M(x0, y0);
  const [c, d] = M(x1, y1);
  return [a, c, b, d];
};

export const inRect = (x: number, z: number, r: Rect, m = 0) => x > r[0] - m && x < r[1] + m && z > r[2] - m && z < r[3] + m;
export const rectCenter = (r: Rect): [number, number] => [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2];

/** Island footprint: a rounded rectangle (super-ellipse) the shape of the map. */
export const ISLAND = { a: 1.8, b: 1.1, n: 6 };

// ------------------------------------------------------------------ the farm (left of town, like the map)
export const FARM: Rect = [-0.74, -0.08, -0.38, 0.25];
export type FieldKind = 'tomato' | 'pumpkin' | 'blueberry' | 'cauli' | 'strawberry';
export const FIELDS: Record<FieldKind, Rect> = {
  tomato: [-0.62, -0.5, -0.02, 0.08],
  pumpkin: [-0.47, -0.35, -0.02, 0.08],
  blueberry: [-0.62, -0.5, 0.11, 0.21],
  cauli: [-0.47, -0.35, 0.11, 0.21],
  strawberry: [-0.3, -0.19, 0.1, 0.19],
};
export const FIELD_NAMES: Record<FieldKind, [string, string]> = {
  tomato: ['tomate', 'tomates'],
  pumpkin: ['abóbora', 'abóboras'],
  blueberry: ['mirtilo', 'mirtilos'],
  cauli: ['couve-flor', 'couves-flores'],
  strawberry: ['framboesa', 'framboesas'],
};
/** The user's farmhouse model (leveled + squared, 0.76 wide × 1 deep); depth in island units. */
export const HOUSE = { x: -0.3, z: -0.24, depth: 0.2 };
export const GREENHOUSE = { x: -0.61, z: -0.28, w: 0.16, d: 0.13 };
/** Row of beehives along a short fence, front-left of the house (like the reference photo). */
export const HIVES = { x: -0.45, z: -0.165 };
export const SHED = { x: -0.68, z: 0.0, w: 0.07, d: 0.06 };
export const BARN = { x: -0.15, z: -0.29, w: 0.12, d: 0.1 };
export const COOP = { x: -0.15, z: -0.1, w: 0.09, d: 0.07 };
export const PEN: Rect = [-0.26, -0.11, -0.03, 0.07];
export const POND = { x: -0.655, z: 0.17, r: 0.048 };
export const SCARECROW = { x: -0.485, z: 0.095 };
export const DOG_BED = { x: -0.5, z: -0.3 };
export const CLOVER = { x: -0.4, z: 0.235 };
export const MAILBOX = { x: -0.215, z: -0.115 };
export const ORCHARD: Rect = [-0.74, -0.6, 0.06, 0.25];
/** Trees inside the farm fence (blossom by the well, fruit trees by the pond). */
export const FARM_TREES: ReadonlyArray<[number, number, 'blossom' | 'apple' | 'orange' | 'green']> = [
  [-0.11, 0.0, 'blossom'],
  [-0.715, 0.07, 'apple'],
  [-0.6, 0.235, 'orange'],
  [-0.715, 0.235, 'blossom'],
  [-0.69, -0.36, 'green'],
];
export const WELL = { x: -0.125, z: 0.17 };
export const KEG = { x: -0.205, z: -0.19 };
export const STUMPS: readonly P2[] = [
  [-0.72, -0.1],
  [-0.1, 0.23],
  [-0.56, -0.36],
];
export const FARM_GATE: P2 = [-0.08, -0.05];

// ------------------------------------------------------------------ town (centre of the map)
export const PLAZA = { x: M(885, 470)[0], z: M(885, 470)[1], r: 0.105 };
export interface BuildingSpec {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  wall: 'wood' | 'plaster' | 'stone' | 'red' | 'blue' | 'green';
  roof: string;
  title: string;
  sub: string;
  text: string;
  tower?: boolean;
}
const at = (mx: number, my: number) => {
  const [x, z] = M(mx, my);
  return { x, z };
};
export const TOWN_BUILDINGS: readonly BuildingSpec[] = [
  { id: 'center', x: 0.34, z: -0.2, w: 0.2, d: 0.11, h: 0.085, rot: 0, wall: 'stone', roof: '#3f6fa8', tower: true, title: 'Centro Comunitário', sub: 'O coração do vale', text: 'Aqui acontecem as festas da colheita, os bailes de inverno e as reuniões em que todo mundo fala ao mesmo tempo. O relógio da torre adianta cinco minutos, e ninguém conserta.' },
  { id: 'clinic', x: 0.53, z: -0.13, w: 0.11, d: 0.09, h: 0.07, rot: -Math.PI / 2, wall: 'plaster', roof: '#4f7fb8', title: 'Clínica do Vale', sub: 'Doutora Lia', text: 'Curativos, chás de camomila e uma placa: “Abelhas não são motivo de pânico.”' },
  { id: 'saloon', x: 0.52, z: 0.15, w: 0.14, d: 0.1, h: 0.075, rot: -Math.PI / 2, wall: 'red', roof: '#6b3a2a', title: 'Taverna Estrela', sub: 'Música aos sábados', text: 'Sopa de abóbora no inverno, suco de framboesa no verão e um piano que só toca três músicas.' },
  { id: 'store', x: 0.96, z: -0.16, w: 0.15, d: 0.1, h: 0.075, rot: -Math.PI / 2, wall: 'blue', roof: '#3f6fa8', title: 'Mercado do Vale', sub: 'Sementes e miudezas', text: 'Sementes da estação, regadores, fitas e aquele doce de leite que a Duda compra toda sexta.' },
  { id: 'smithy', x: 0.9, z: 0.15, w: 0.12, d: 0.09, h: 0.065, rot: 0, wall: 'stone', roof: '#5b5f6e', title: 'Ferreiro', sub: 'Ferramentas e ferraduras', text: 'O martelo começa às seis da manhã. A Duda diz que é o despertador oficial do vale.' },
  { id: 'carpenter', ...at(800, 105), w: 0.13, d: 0.1, h: 0.07, rot: 0, wall: 'wood', roof: '#3d8a4f', title: 'Carpintaria', sub: 'No pé da montanha', text: 'Tábuas cheirando a pinho e uma lista enorme de pedidos: celeiros, pontes, um banco novo para a praça.' },
];
/** Painted cottages of the townsfolk (the farmhouse model is Duda's alone). */
export interface CottageSpec {
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  wall: 'wood' | 'plaster' | 'stone' | 'red' | 'blue' | 'green';
  roof: string;
  trim: string;
}
export const TOWN_HOMES: readonly CottageSpec[] = [
  { x: 0.08, z: -0.19, rot: 0, w: 0.13, d: 0.1, h: 0.065, wall: 'green', roof: '#4f5a74', trim: '#f2e6c8' },
  { x: 0.08, z: 0.2, rot: Math.PI, w: 0.12, d: 0.1, h: 0.06, wall: 'plaster', roof: '#c9563c', trim: '#7a4f2c' },
  { x: 0.5, z: 0.4, rot: Math.PI, w: 0.12, d: 0.095, h: 0.06, wall: 'stone', roof: '#4f8fd8', trim: '#f2e6c8' },
  { ...at(930, 205), rot: 0, w: 0.13, d: 0.1, h: 0.065, wall: 'wood', roof: '#4fae6a', trim: '#5a3a22' },
];

// ------------------------------------------------------------------ water
export const SEA_Y = -0.032;
/** Coastline (map): south of / east of this line is sea. Monotonic in x. */
export const COAST: readonly P2[] = [
  M(470, 900),
  M(500, 800),
  M(640, 800),
  M(760, 790),
  M(880, 772),
  M(1000, 795),
  M(1200, 782),
  M(1290, 640),
  M(1340, 560),
  M(1480, 540),
];
/** Main river: from the mountain lake, down the east side of town, to the bay. */
export const RIVER: readonly P2[] = [M(1050, 250), M(1040, 330), M(1030, 420), M(1040, 520), M(1050, 600), M(1095, 700), M(1110, 790)];
/** South river: from the main river, west below the town and the farm, down to the sea in the south-west. */
export const RIVER_SOUTH: readonly P2[] = [M(1040, 600), M(960, 625), M(860, 610), M(760, 600), M(660, 625), M(580, 660), M(500, 705), M(450, 770), M(475, 880)];
/** East river: from the mountains far east straight into the sea. */
export const RIVER_EAST: readonly P2[] = [M(1235, 190), M(1285, 300), M(1315, 430), M(1350, 540)];
/** Stream from the western mountains down to the forest pond. */
export const STREAM: readonly P2[] = [M(430, 300), M(440, 380), M(428, 470), M(432, 565)];
export const RIVERS: ReadonlyArray<{ pts: readonly P2[]; w: number; top: number; bottom: number }> = [
  { pts: RIVER, w: 0.036, top: -0.01, bottom: SEA_Y },
  { pts: RIVER_SOUTH, w: 0.032, top: -0.02, bottom: SEA_Y },
  { pts: RIVER_EAST, w: 0.03, top: -0.006, bottom: SEA_Y },
  { pts: STREAM, w: 0.018, top: 0.0, bottom: -0.018 },
];
export const LAKE = { x: M(1050, 190)[0], z: M(1050, 190)[1], r: 0.09, y: 0.13 };
export const FOREST_POND = { x: M(425, 605)[0], z: M(425, 605)[1], r: 0.07 };
/** Ponds in the western forest, with sandy rims (like the forest reference photo). */
export const FOREST_PONDS: ReadonlyArray<{ x: number; z: number; r: number }> = [
  FOREST_POND,
  { x: M(300, 700)[0], z: M(300, 700)[1], r: 0.09 },
  { x: M(170, 520)[0], z: M(170, 520)[1], r: 0.06 },
  { x: M(330, 830)[0], z: M(330, 830)[1], r: 0.05 },
];
/** Woodcutter's cabin by the forest pond. */
export const CABIN = { x: M(340, 560)[0], z: M(340, 560)[1] };
/** Sandy trails winding through the forest. */
export const FOREST_TRAILS: ReadonlyArray<ReadonlyArray<P2>> = [
  [M(400, 470), M(360, 540), M(330, 620), M(300, 700), M(260, 780), M(330, 830)],
  [M(330, 620), M(250, 600), M(170, 520), M(110, 430)],
  [M(360, 540), M(420, 560)],
];
/** A rocky ledge north of the farm and the forest (cliffs like the reference photos). */
export const TERRACE = { z: M(0, 300)[1] - 0.03, x1: M(700, 0)[0], h: 0.055 };
export const WATERFALL = { x: M(1050, 0)[0], top: M(1050, 190)[1] + 0.08, bottom: M(1050, 250)[1] };
export const PIERS: readonly (readonly [P2, P2])[] = [
  [M(962, 765), M(962, 845)],
  [M(1180, 772), M(1180, 840)],
];
export const BEACH: readonly [number, number] = [M(920, 0)[0], M(1215, 0)[0]];
/** Bridges over the rivers: [x, z, yaw] (yaw π/2 spans east–west). */
export const BRIDGES: ReadonlyArray<[number, number, number]> = [
  [...M(1031, 470), Math.PI / 2],
  [...M(880, 612), 0],
  [...M(620, 643), 0.3],
];

// ------------------------------------------------------------------ land
export const DESERT: Rect = MR(40, 395, 40, 230);
export const DESERT_ROAD: readonly P2[] = [M(40, 135), M(465, 135), M(465, 260)];
export const MOUNTAINS: ReadonlyArray<{ x: number; z: number; h: number; r: number }> = [
  // western range (between the desert and the forest)
  { ...at(120, 255), h: 0.3, r: 0.17 },
  { ...at(260, 235), h: 0.36, r: 0.18 },
  { ...at(380, 265), h: 0.28, r: 0.15 },
  // northern mountains (top right) around the lake
  { ...at(1000, 90), h: 0.3, r: 0.18 },
  { ...at(1150, 75), h: 0.4, r: 0.2 },
  { ...at(1320, 90), h: 0.38, r: 0.2 },
  { ...at(1450, 120), h: 0.3, r: 0.18 },
  { ...at(1180, 200), h: 0.16, r: 0.12 },
  // gentle hills north of town
  { ...at(760, 120), h: 0.1, r: 0.25 },
  { ...at(620, 200), h: 0.08, r: 0.2 },
];
export const MINE = { x: M(1150, 160)[0], z: M(1150, 160)[1] };
export const FOREST_WEST: Rect = MR(40, 470, 290, 900);
export const FOREST_SOUTH: Rect = MR(470, 760, 650, 820);
export const FOREST_NORTH: Rect = MR(470, 1000, 40, 300);
export const FOREST_EAST: Rect = MR(1150, 1480, 160, 540);

/** Dirt paths (polylines). */
export const PATHS: ReadonlyArray<ReadonlyArray<P2>> = [
  // farm gate → plaza
  [FARM_GATE, [0.02, -0.02], [PLAZA.x - PLAZA.r, PLAZA.z]],
  // inside the farm: porch → gate, and between the fields
  [[-0.3, -0.12], [-0.3, -0.06], [-0.15, -0.05], FARM_GATE],
  [[-0.3, -0.06], [-0.56, -0.06], [-0.66, -0.06]],
  [[-0.485, -0.06], [-0.485, 0.22]],
  [[-0.3, -0.06], [-0.3, 0.22]],
  // plaza → north road → carpenter
  [[PLAZA.x - PLAZA.r * 0.8, PLAZA.z - PLAZA.r * 0.6], [0.2, -0.12], [0.2, -0.36], [0.15, -0.6], [0.1, -0.8]],
  [[0.2, -0.36], [0.4, -0.5], TOWN_HOMES[3] ? [TOWN_HOMES[3].x, TOWN_HOMES[3].z + 0.1] : [0.41, -0.54]],
  // plaza → east bridge → store, smithy and the mountain lake
  [[PLAZA.x + PLAZA.r, PLAZA.z], M(1010, 470), M(1060, 470), M(1090, 440), M(1080, 330), M(1095, 250), M(1150, 180)],
  [M(1060, 470), [0.9, 0.08]],
  [M(1090, 440), [0.88, -0.16]],
  // plaza → south bridge → beach → pier
  [[PLAZA.x, PLAZA.z + PLAZA.r], M(880, 560), M(880, 650), M(930, 720), PIERS[0][0]],
  [M(930, 720), M(1080, 740), PIERS[1][0]],
  // homes and clinic
  [[PLAZA.x - PLAZA.r * 0.7, PLAZA.z + PLAZA.r * 0.7], [0.12, 0.1]],
  [[PLAZA.x - PLAZA.r * 0.7, PLAZA.z - PLAZA.r * 0.7], [0.12, -0.09]],
  [M(880, 560), [0.42, 0.3], [0.5, 0.3]],
  // farm → west forest → desert road
  [[-0.74, -0.06], M(400, 470), M(420, 380), M(465, 260)],
  // farm → south bridge → southern woods
  [[-0.3, 0.25], M(620, 600), M(620, 700)],
];

/** Duda's day: around the farm, a visit to town, back home. [x, z, pause s, activity] */
export type Stop = readonly [x: number, z: number, pause: number, act?: 'water' | 'look' | 'house' | 'wave'];
export const ROUTE: readonly Stop[] = [
  [-0.3, -0.12, 3, 'house'],
  [-0.3, -0.06, 0],
  [-0.485, -0.06, 0],
  [-0.485, 0.03, 3.5, 'water'],
  [-0.485, 0.16, 3.5, 'water'],
  [-0.485, -0.06, 0],
  [-0.3, -0.06, 0],
  [-0.3, 0.16, 3, 'water'],
  [-0.3, -0.06, 0],
  [-0.2, -0.05, 2.5, 'wave'],
  [-0.08, -0.05, 0],
  [0.02, -0.02, 0],
  [PLAZA.x - PLAZA.r, PLAZA.z, 3, 'look'],
  [0.02, -0.02, 0],
  [-0.08, -0.05, 0],
  [-0.15, -0.05, 0],
  [-0.3, -0.06, 0],
];

/** Town folk walking loops. */
export const WALKERS: ReadonlyArray<{ name: string; route: readonly P2[]; lines: readonly string[]; style: [skin: string, hair: string, shirt: string, pants: string, hat?: string] }> = [
  {
    name: 'Seu Tonico',
    route: [M(840, 430), M(930, 430), M(930, 510), M(840, 510)],
    lines: ['Bom dia! A fonte da praça está mais cheia hoje.', 'Na minha época, as abóboras eram do tamanho de carroças.'],
    style: ['#e8b58e', '#d9d4cc', '#7a8a5a', '#4a3b2f', '#6b4a2e'],
  },
  {
    name: 'Lia',
    route: [M(880, 560), M(880, 650), M(930, 720), M(880, 650)],
    lines: ['Vai à praia? Leve chapéu, o sol do vale engana.', 'Se uma abelha te picar, passe na clínica.'],
    style: ['#c98e6a', '#2a1c14', '#ffffff', '#4a6fb5'],
  },
  {
    name: 'Bento',
    route: [M(1010, 470), M(1060, 470), M(1100, 440), M(1110, 300), M(1100, 440), M(1060, 470)],
    lines: ['Já subiu até o lago da montanha? Tem uma mina lá em cima.', 'O rio desce gelado lá de cima.'],
    style: ['#a8724e', '#3a2618', '#c9874a', '#3d3a4f'],
  },
  {
    name: 'Nina',
    route: [M(800, 520), M(830, 495), M(940, 495), M(985, 515), M(940, 495), M(830, 495)],
    lines: ['Você viu o Biscoito? Ele adora dormir perto da estufa.', 'Quando eu crescer quero ter uma fazenda igual à da Duda!'],
    style: ['#f1c19a', '#e0a23a', '#ff8ab6', '#7a5ad8'],
  },
];
