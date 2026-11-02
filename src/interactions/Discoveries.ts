import { Storage } from '../systems/Storage';

export type DiscoveryId = string;

export interface DiscoveryDef {
  id: DiscoveryId;
  name: string;
  hint: string;
  text: string;
  icon: string;
}

export const DISCOVERIES: readonly DiscoveryDef[] = [
  { id: 'cristal-cachoeira', name: 'Cristal da Cachoeira', icon: 'crystal', hint: 'Algo dourado brilha por trás da água que desce da montanha.', text: 'Escondido atrás da cachoeira, um cristal que guarda a primeira luz do mundo.' },
  { id: 'dragaozinho', name: 'Dragãozinho Tímido', icon: 'dragon', hint: 'Entre os pinheiros da floresta, alguém espia você.', text: 'Um filhote de dragão vive na floresta. Agora ele confia em você.' },
  { id: 'passagem-castelo', name: 'Passagem Secreta', icon: 'door', hint: 'Uma pedra com runas, na encosta do castelo, parece fora do lugar.', text: 'A pedra rúnica deslizou e revelou um túnel iluminado sob o castelo.' },
  { id: 'bau', name: 'Baú Esquecido', icon: 'chest', hint: 'Na beira do penhasco, atrás de uma rocha, há algo de madeira.', text: 'Moedas de um reino que ninguém mais lembra.' },
  { id: 'espirito', name: 'Espírito da Floresta', icon: 'spirit', hint: 'Fique um tempo no mundo e observe a campina.', text: 'Ele só aparece para quem tem paciência. Você teve.' },
  { id: 'passaro-dourado', name: 'Pássaro Dourado', icon: 'bird', hint: 'Um dos pássaros brilha mais que os outros.', text: 'Dizem que quem toca o pássaro dourado volta a este mundo um dia.' },
  { id: 'coro-cogumelos', name: 'Coro dos Cogumelos', icon: 'mushroom', hint: 'Perto do rio, quatro cogumelos coloridos parecem esperar uma deixa.', text: 'Os cogumelos cantam quando alguém finalmente presta atenção.' },
];

/** Session collection of secrets, optionally persisted in localStorage (no server). One collection per world. */
export class Discoveries {
  private found: Set<DiscoveryId>;
  constructor(
    readonly defs: readonly DiscoveryDef[] = DISCOVERIES,
    private key = 'discoveries',
  ) {
    this.found = new Set(Storage.get<DiscoveryId[]>(key, []).filter((id) => defs.some((d) => d.id === id)));
  }
  onFound: (d: DiscoveryDef, count: number) => void = () => {};
  onChange: () => void = () => {};

  has(id: DiscoveryId) {
    return this.found.has(id);
  }

  get count() {
    return this.found.size;
  }

  get total() {
    return this.defs.length;
  }

  /** Returns true when this is a new discovery. */
  find(id: DiscoveryId) {
    if (this.found.has(id)) return false;
    this.found.add(id);
    Storage.set(this.key, [...this.found]);
    const def = this.defs.find((d) => d.id === id)!;
    this.onFound(def, this.found.size);
    this.onChange();
    return true;
  }

  reset() {
    this.found.clear();
    Storage.remove(this.key);
    this.onChange();
  }
}
