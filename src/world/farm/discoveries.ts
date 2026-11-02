import type { DiscoveryDef } from '../../interactions/Discoveries';

/** Secrets of Vale Alecrim (all original). */
export const FARM_DISCOVERIES: readonly DiscoveryDef[] = [
  { id: 'vale-mina', name: 'Mina da Cachoeira', icon: 'pickaxe', hint: 'Seu Olavo jura que existe algo atrás da água que cai do morro.', text: 'Atrás da cachoeira, uma mina antiga ainda brilha com cristais azuis.' },
  { id: 'vale-cogumelo', name: 'Cogumelo Gigante', icon: 'mushroom', hint: 'Na floresta a nordeste, algo vermelho e enorme se esconde entre as árvores.', text: 'Um cogumelo do tamanho de uma casa. À noite, ele brilha.' },
  { id: 'vale-galinha', name: 'Galinha Dourada', icon: 'bird', hint: 'Dê atenção às galinhas: às vezes uma delas é… diferente.', text: 'Rara como ouro, e igualmente brilhante. Ela gostou de você.' },
  { id: 'vale-peixe', name: 'Dourado Ancião', icon: 'fish', hint: 'Iara diz que no fundo do lago mora um peixe velho como o vale.', text: 'O peixe mais antigo do lago mordeu a sua isca e voltou para a água.' },
  { id: 'vale-tesouro', name: 'Tesouro do Avô', icon: 'chest', hint: 'Há um X desenhado na areia, perto do lago.', text: 'Uma caixinha enterrada com moedas antigas e um bilhete: “Cuide bem da fazenda.”' },
  { id: 'vale-espirito', name: 'Espírito do Vale', icon: 'spirit', hint: 'Alguém brilhante passeia perto da Árvore Anciã — mas só à noite.', text: 'Um cervo de luz que guarda o vale enquanto todos dormem.' },
  { id: 'vale-carta', name: 'Carta Misteriosa', icon: 'letter', hint: 'Continue abrindo a caixa de correio da fazenda.', text: 'Uma carta sem remetente, com uma pista sobre um tesouro na areia.' },
];
