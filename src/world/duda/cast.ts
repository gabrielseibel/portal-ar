import type { Look } from './people';
import { CABIN, MINE, PLAZA, TOWN_BUILDINGS, TOWN_HOMES, type P2, type Rect } from './layout';

/**
 * Who lives in the valley: villagers (looks, where they spend the day, a
 * walking loop, what they say), pets and farm animals.
 */
const B = (id: string) => TOWN_BUILDINGS.find((b) => b.id === id)!;
/** Point in front of a building's door (local +Z rotated by its yaw). */
const door = (x: number, z: number, rot: number, d: number, out = 0.03): P2 => [x + Math.sin(rot) * (d / 2 + out), z + Math.cos(rot) * (d / 2 + out)];
const front = (id: string, out = 0.03) => {
  const b = B(id);
  return door(b.x, b.z, b.rot, b.d, out);
};
const home = (i: number, out = 0.06) => {
  const h = TOWN_HOMES[i];
  return door(h.x, h.z, h.rot, h.d, out);
};
const loop = ([x, z]: P2, r: number, n = 4): P2[] => Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * r, z + Math.sin((i / n) * Math.PI * 2) * r * 0.8] as P2);

// ------------------------------------------------------------------ new places
export const WIZARD_TOWER = { x: -1.45, z: 0.38 };
export const TENT = { x: 0.47, z: -0.56 };
export const FISH_SHOP = { x: 0.64, z: 0.71 };
export const BEACH_CABIN = { x: 0.99, z: 0.6 };
export const TRAILER = { x: 0.16, z: 0.52 };
export const OASIS = { x: -1.25, z: -0.7 };
export const RANCH: Rect = [-0.62, -0.18, -0.74, -0.5];
export const PASTURE: Rect = [-0.6, -0.38, -0.72, -0.52];
export const RANCH_HOUSE = { x: -0.28, z: -0.62 };
export const MANHOLE = { x: 0.2, z: 0.28 };

export interface VillagerSpec {
  name: string;
  look: Look;
  at: P2;
  /** Walking loop; omitted = stays around `at`. */
  route?: readonly P2[];
  lines: readonly string[];
  pitch?: number;
}

const P = (x: number, z: number): P2 => [x, z];
const plaza = P(PLAZA.x, PLAZA.z);

export const VILLAGERS: readonly VillagerSpec[] = [
  { name: 'Abigail', look: { skin: '#f3d0b4', hair: '#8a4fc4', hairStyle: 'bob', shirt: '#4f6a4a', pants: '#3a2f4a' }, at: P(0.2, -0.45), route: [P(0.2, -0.36), P(0.2, -0.5), P(0.17, -0.58), P(0.2, -0.5)], lines: ['O cemitério à noite é o lugar mais tranquilo do vale.', 'Quer ouvir minha flauta? Prometo que não é tão ruim.'], pitch: 1.3 },
  { name: 'Alex', look: { skin: '#e2a878', hair: '#7a4a2a', hairStyle: 'spiky', shirt: '#3f8a4f', pants: '#3a3a4a', big: true }, at: P(0.7, 0.72), route: [P(0.56, 0.68), P(0.86, 0.7), P(0.86, 0.74), P(0.56, 0.72)], lines: ['Um dia eu viro jogador profissional, pode anotar!', 'Treinar na areia deixa as pernas mais fortes.'], pitch: 0.9 },
  { name: 'Caroline', look: { skin: '#f0c8a8', hair: '#4fae6a', hairStyle: 'bob', shirt: '#4f7fb8', pants: '#3a3a4a' }, at: P(0.88, -0.24), lines: ['Nada como um chá no meu jardim depois do almoço.', 'O Pierre só pensa em vendas… alguém precisa cuidar das plantas.'], pitch: 1.2 },
  { name: 'Clint', look: { skin: '#e2b08a', hair: '#6a4a2e', beard: '#6a4a2e', shirt: '#7a6a5a', pants: '#3a2f2a', big: true }, at: front('smithy'), lines: ['Ah… oi. Precisa de alguma ferramenta?', 'A Emily… digo, a forja está quente hoje.'], pitch: 0.75 },
  { name: 'Demetrius', look: { skin: '#7a4a2e', hair: '#1a1410', shirt: '#4f6fb5', pants: '#3a3a4a' }, at: P(0.62, -0.62), lines: ['Estou medindo a temperatura do lago da montanha. Ciência!', 'Os sapos daqui têm um comportamento fascinante.'], pitch: 0.85 },
  { name: 'Anão', look: { skin: '#000', hair: '#000', shirt: '#000', pants: '#000', special: 'dwarf' }, at: P(MINE.x - 0.03, MINE.z + 0.05), lines: ['Hrm. Humanos não costumam subir até a mina.', 'Pedras brilhantes? Talvez eu tenha algumas…'], pitch: 0.6 },
  { name: 'Elliott', look: { skin: '#f0c8a8', hair: '#b8622a', hairStyle: 'long', shirt: '#b8423a', pants: '#3a2f2a' }, at: P(0.99, 0.66), lines: ['O mar inspira cada capítulo do meu romance.', 'Ah, o barulho das ondas… é poesia pura.'] },
  { name: 'Emily', look: { skin: '#f3d0b4', hair: '#3f8fe0', hairStyle: 'bob', shirt: '#d9343a', pants: '#3a3a4a', dress: '#d9343a' }, at: front('saloon', 0.04), route: [front('saloon', 0.04), home(1), P(0.2, 0.08)], lines: ['Você sente essa energia? Os cristais estão felizes hoje!', 'Costurei esta roupa eu mesma.'], pitch: 1.35 },
  { name: 'Evelyn', look: { skin: '#f0d0b8', hair: '#d9d4cc', hairStyle: 'bun', shirt: '#e88aa8', pants: '#5a4a6a', dress: '#8a6aa8' }, at: home(3), lines: ['Querida, acabei de assar biscoitos. Quer um?', 'As flores da praça precisam de água, sabia?'], pitch: 1.15 },
  { name: 'George', look: { skin: '#f0d0b8', hair: '#d9d4cc', hairStyle: 'bald', shirt: '#4f7a4a', pants: '#4a4a5a', special: 'wheelchair' }, at: P(TOWN_HOMES[3].x + 0.05, TOWN_HOMES[3].z + 0.1), lines: ['Hmpf. Estou tentando assistir TV.', 'Na minha época as coisas eram mais simples.'], pitch: 0.7 },
  { name: 'Gus', look: { skin: '#e2b08a', hair: '#6a4a2e', mustache: '#6a4a2e', shirt: '#e8a33a', pants: '#3a2f2a', big: true }, at: front('saloon', 0.02), lines: ['Bem-vinda ao Salão Fruta Estrelar! A pizza sai em cinco minutos.', 'Ninguém sai daqui com fome, essa é a regra da casa.'], pitch: 0.8 },
  { name: 'Haley', look: { skin: '#f3d0b4', hair: '#f2d06a', hairStyle: 'long', shirt: '#7ab8e8', pants: '#e8d8c0', dress: '#7ab8e8' }, at: home(1, 0.1), route: [home(1, 0.1), P(0.2, 0.1), P(0.29, 0.13)], lines: ['A luz do fim de tarde é perfeita para fotos.', 'Essa roupa? Comprei na cidade grande, claro.'], pitch: 1.4 },
  { name: 'Harvey', look: { skin: '#e8b890', hair: '#6a4a2e', mustache: '#6a4a2e', glasses: true, shirt: '#4f8a5a', pants: '#3a3a4a' }, at: front('clinic'), lines: ['Já fez seu check-up este ano? Por favor, faça.', 'Montei um aeromodelo novo. Não conte para ninguém.'] },
  { name: 'Jas', look: { skin: '#a8724e', hair: '#3a1a3a', hairStyle: 'bob', shirt: '#9a6ad8', pants: '#3a3a4a', dress: '#9a6ad8', hat: { kind: 'bow', color: '#4fae6a' }, child: true }, at: P(-0.3, -0.56), route: [P(-0.3, -0.56), P(-0.22, -0.56), P(-0.22, -0.66), P(-0.3, -0.66)], lines: ['A tia Marnie disse que posso escovar as vacas!', 'O Vincent sempre perde no pega-pega.'], pitch: 1.7 },
  { name: 'Jodi', look: { skin: '#f0c8a8', hair: '#d9653a', hairStyle: 'bob', shirt: '#c97ab8', pants: '#4a4a5a' }, at: home(2, 0.05), lines: ['Ufa, roupa lavada, almoço pronto… agora o jantar!', 'Você viu o Vincent? Ele sumiu de novo.'], pitch: 1.2 },
  { name: 'Kent', look: { skin: '#f0c8a8', hair: '#d9b84a', hairStyle: 'spiky', shirt: '#5a6a3a', pants: '#3a3a2a' }, at: P(TOWN_HOMES[2].x + 0.07, TOWN_HOMES[2].z - 0.02), lines: ['É bom estar em casa de novo.', 'O silêncio do vale ainda me surpreende.'], pitch: 0.85 },
  { name: 'Krobus', look: { skin: '#000', hair: '#000', shirt: '#000', pants: '#000', special: 'shadow' }, at: P(MANHOLE.x, MANHOLE.z), lines: ['Psiu. Não conte aos humanos que eu saio dos esgotos.', 'Tenho itens raros… se você tiver tempo.'], pitch: 0.65 },
  { name: 'Leah', look: { skin: '#f3d0b4', hair: '#c4552c', hairStyle: 'braid', shirt: '#6a8a3a', pants: '#3a3a4a' }, at: P(CABIN.x + 0.07, CABIN.z + 0.05), route: loop(P(CABIN.x + 0.04, CABIN.z + 0.1), 0.05), lines: ['Estou esculpindo um urso em madeira. Quer ver?', 'A floresta me dá todas as ideias que preciso.'], pitch: 1.2 },
  { name: 'Lewis', look: { skin: '#e8b890', hair: '#9a9a9a', mustache: '#d9d4cc', shirt: '#4f7a4a', pants: '#5a4030', hat: { kind: 'cap', color: '#6b4a2e' } }, at: plaza, route: loop(plaza, PLAZA.r + 0.03, 6), lines: ['Como prefeito, é meu dever dar as boas-vindas! Bem-vinda à vila.', 'Mais de vinte anos de prefeitura… e ainda tenho segredos.'], pitch: 0.8 },
  { name: 'Linus', look: { skin: '#e2b08a', hair: '#e8e4dc', hairStyle: 'long', beard: '#e8e4dc', shirt: '#d9a03a', pants: '#5a4a3a' }, at: P(0.52, -0.52), lines: ['A montanha me dá tudo de que preciso.', 'Se tiver frutas silvestres sobrando, eu agradeço.'], pitch: 0.75 },
  { name: 'Marnie', look: { skin: '#f0c8a8', hair: '#8a5a30', hairStyle: 'curly', shirt: '#d9883a', pants: '#4a4a5a' }, at: P(-0.33, -0.55), route: [P(-0.36, -0.52), P(-0.36, -0.7), P(-0.33, -0.55)], lines: ['As vacas estão felizes hoje. Quer comprar feno?', 'O Shane anda mais animado cuidando das galinhas.'], pitch: 1.05 },
  { name: 'Maru', look: { skin: '#a8724e', hair: '#2a1a1a', hairStyle: 'long', glasses: true, shirt: '#7a5ad8', pants: '#5a6a8a' }, at: P(B('clinic').x - 0.07, B('clinic').z + 0.06), lines: ['Meu robô novo quase funcionou desta vez!', 'Trabalhar na clínica me ensina muita coisa.'], pitch: 1.3 },
  { name: 'Pam', look: { skin: '#f0c8a8', hair: '#f2d06a', hairStyle: 'curly', shirt: '#e88aa8', pants: '#4a4a6a' }, at: P(TRAILER.x + 0.05, TRAILER.z + 0.05), lines: ['Ei, garota! Já dirigi o ônibus deste vale inteiro.', 'Uma passada no salão e o dia melhora.'], pitch: 1.0 },
  { name: 'Penny', look: { skin: '#f3d0b4', hair: '#d9653a', hairStyle: 'bun', shirt: '#f2d06a', pants: '#8a5a3a', dress: '#8a5a3a' }, at: P(0.24, -0.11), route: [P(0.24, -0.11), P(0.34, -0.12), P(0.27, 0.18), P(0.16, 0.45)], lines: ['Vou dar aula para a Jas e o Vincent hoje.', 'Estou lendo um livro lindo sobre o mar.'], pitch: 1.3 },
  { name: 'Pierre', look: { skin: '#f0c8a8', hair: '#6a4a2e', glasses: true, shirt: '#8a5a30', pants: '#3a3a4a' }, at: front('store'), lines: ['Sementes fresquinhas! Melhores que as da cidade grande.', 'Promoção de nabos só hoje, aproveite!'], pitch: 0.95 },
  { name: 'Robin', look: { skin: '#f0c8a8', hair: '#d9653a', hairStyle: 'ponytail', shirt: '#e8c84a', pants: '#4a5a8a' }, at: front('carpenter'), lines: ['Precisa de um celeiro novo? É só pedir.', 'Nada cheira melhor que madeira recém-cortada.'], pitch: 1.1 },
  { name: 'Sam', look: { skin: '#f0c8a8', hair: '#f2d06a', hairStyle: 'spiky', shirt: '#3f6fd8', pants: '#3a3a5a' }, at: P(0.36, 0.06), route: [P(0.4, 0.07), P(0.46, 0.3), P(0.4, 0.07)], lines: ['Tô montando uma banda! Topa ouvir um ensaio?', 'Hoje é dia de skate na praça.'], pitch: 1.0 },
  { name: 'Sandy', look: { skin: '#e8b890', hair: '#e8507a', hairStyle: 'ponytail', shirt: '#4fd0c8', pants: '#e8a33a', dress: '#9a6ad8' }, at: P(OASIS.x + 0.05, OASIS.z + 0.04), lines: ['Bem-vinda ao Oásis! Sementes do deserto, só aqui.', 'O calor daqui faz bem para a pele, sabia?'], pitch: 1.3 },
  { name: 'Sebastian', look: { skin: '#f3d0b4', hair: '#1a1424', hairStyle: 'bob', shirt: '#2a2a32', pants: '#2a2a3a' }, at: P(B('carpenter').x + 0.1, B('carpenter').z + 0.05), lines: ['Hm. Prefiro programar a conversar.', 'Quando chove dá vontade de dar uma volta de moto.'], pitch: 0.95 },
  { name: 'Shane', look: { skin: '#f0c8a8', hair: '#2a2236', hairStyle: 'short', shirt: '#3f6fa8', pants: '#3a3a3a' }, at: P(-0.24, -0.53), lines: ['…Oi. As galinhas são mais fáceis de lidar do que gente.', 'Tô tentando melhorar, um dia de cada vez.'], pitch: 0.85 },
  { name: 'Vincent', look: { skin: '#f0c8a8', hair: '#e88aa8', hairStyle: 'spiky', shirt: '#9a6ad8', pants: '#5a6a3a', child: true }, at: P(0.3, 0.12), route: loop(P(0.28, 0.0), 0.15, 5), lines: ['Achei um besouro gigante! Quer ver?', 'A Jas sempre ganha no pega-pega…'], pitch: 1.8 },
  { name: 'Willy', look: { skin: '#e2a878', hair: '#7a5a3a', beard: '#7a5a3a', shirt: '#8a3a2e', pants: '#3a3a4a', hat: { kind: 'cap', color: '#3a4a6a' } }, at: P(0.5, 0.9), lines: ['As carpas estão mordendo bem hoje!', 'O mar tem humor, garota. Respeite as marés.'], pitch: 0.75 },
  { name: 'Mago', look: { skin: '#8a7ac8', hair: '#5a3a8a', beard: '#5a3a8a', shirt: '#4a2a7a', pants: '#2a1a3a', special: 'robe', hat: { kind: 'wizard', color: '#1a1424' } }, at: P(WIZARD_TOWER.x + 0.08, WIZARD_TOWER.z + 0.05), lines: ['As forças elementais estão inquietas hoje…', 'Você sente? Um portal se abriu perto daqui.'], pitch: 0.7 },
];

export interface AnimalSpec {
  name: string;
  kind: 'cat' | 'dog' | 'turtle' | 'chicken' | 'duck' | 'rabbit' | 'cow' | 'goat' | 'pig';
  colors: string[];
  at: P2;
  /** Wander area; omitted = stays put (pets). */
  area?: Rect;
  owner?: string;
}

const around = ([x, z]: P2, r: number): Rect => [x - r, x + r, z - r, z + r];

/** Pets (the yellow cat is Duda's own and lives on the farm). */
export const PETS: readonly AnimalSpec[] = [
  { name: 'Mingau', kind: 'cat', colors: ['#8a8a8a', '#f2f2f2'], at: P(0.87, -0.08), owner: 'Pierre e Caroline' },
  { name: 'Neve', kind: 'cat', colors: ['#f4ece4', '#f8d0d8'], at: P(0.03, 0.11), owner: 'Emily e Haley' },
  { name: 'Sombra', kind: 'cat', colors: ['#3a2e48', '#4a3a5a', '#e8c84a'], at: P(WIZARD_TOWER.x + 0.03, WIZARD_TOWER.z + 0.08), owner: 'o Mago' },
  { name: 'Ruivo', kind: 'cat', colors: ['#e8782a', '#f4d8b0'], at: P(0.45, 0.22), owner: 'Gus' },
  { name: 'Bolinha', kind: 'dog', colors: ['#c98a4a', '#8a5a30'], at: P(0.15, -0.11), area: around(P(0.15, -0.11), 0.04), owner: 'Lewis' },
  { name: 'Pirata', kind: 'dog', colors: ['#3a3434', '#f2f2f2', 'pointy'], at: P(-0.25, -0.6), area: around(P(-0.28, -0.6), 0.06), owner: 'Marnie' },
  { name: 'Areia', kind: 'dog', colors: ['#e8b45c', '#c98a4a'], at: P(0.7, 0.69), owner: 'Willy' },
  { name: 'Canela', kind: 'dog', colors: ['#b8763a', '#7a4a26', 'pointy'], at: P(0.43, 0.33), area: around(P(0.44, 0.33), 0.04), owner: 'Jodi e Kent' },
  { name: 'Ametista', kind: 'turtle', colors: ['#8a5ad8'], at: P(0.14, 0.27), area: around(P(0.14, 0.27), 0.03), owner: 'Emily' },
  { name: 'Musgo', kind: 'turtle', colors: ['#4f8a3a'], at: P(-0.92, 0.26), area: around(P(-0.92, 0.26), 0.04) },
];

/** Farm and ranch animals. */
export const ANIMALS: readonly AnimalSpec[] = [
  { name: 'Mimosa', kind: 'cow', colors: ['#f4f0e6', '#5a4030'], at: P(-0.55, -0.6), area: PASTURE },
  { name: 'Estrela', kind: 'cow', colors: ['#f4f0e6', '#7a4a2e'], at: P(-0.45, -0.66), area: PASTURE },
  { name: 'Canjica', kind: 'cow', colors: ['#8a5a30', '#5e3a20'], at: P(-0.5, -0.56), area: PASTURE },
  { name: 'Cabrita', kind: 'goat', colors: ['#e8c86a'], at: P(-0.42, -0.58), area: PASTURE },
  { name: 'Barbicha', kind: 'goat', colors: ['#f4ece0'], at: P(-0.57, -0.68), area: PASTURE },
  { name: 'Torresmo', kind: 'pig', colors: ['#f2a7b8'], at: P(-0.47, -0.69), area: PASTURE },
  { name: 'Rosinha', kind: 'pig', colors: ['#f7bccb'], at: P(-0.41, -0.54), area: PASTURE },
  { name: 'Pipoca', kind: 'rabbit', colors: ['#e8c8a8'], at: P(-0.5, 0.3), area: [-0.6, -0.36, 0.27, 0.33] },
  { name: 'Algodão', kind: 'rabbit', colors: ['#f4f0e8'], at: P(-0.42, 0.31), area: [-0.6, -0.36, 0.27, 0.33] },
];
