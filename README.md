# PORTAL

> *Existe outro mundo logo abaixo da sua realidade.*

**PORTAL** é uma experiência de realidade aumentada que roda direto no navegador do celular: você abre um link, permite a câmera, aponta para uma mesa e um portal circular se abre na superfície. Dele sobe uma pequena ilha flutuante, com vila medieval, castelo, montanhas, cachoeiras que caem de volta para dentro do portal e um dragãozinho que vem cumprimentar você.

Não há aplicativo para instalar, nem cadastro, servidor, banco de dados ou chave de API. É um site estático publicado no GitHub Pages.

---

## Sumário

- [O que tem dentro](#o-que-tem-dentro)
- [Três mundos](#três-mundos)
- [Como a realidade aumentada funciona (três modos reais)](#como-a-realidade-aumentada-funciona-três-modos-reais)
- [Tecnologias](#tecnologias)
- [Como executar localmente](#como-executar-localmente)
- [Como publicar no GitHub Pages](#como-publicar-no-github-pages)
- [Instruções de uso](#instruções-de-uso)
- [Compatibilidade](#compatibilidade)
- [Limitações conhecidas](#limitações-conhecidas)
- [Testes](#testes)
- [Desempenho e qualidade gráfica](#desempenho-e-qualidade-gráfica)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Modelos GLB opcionais](#modelos-glb-opcionais)
- [Créditos e licenças](#créditos-e-licenças)

---

## O que tem dentro

| | |
|---|---|
| **Tela inicial** | Neblina animada, partículas, portal com runas girando e tipografia cinematográfica. Botões **ABRIR MEU PORTAL** e **Explorar sem câmera**. |
| **Abertura do portal (~3 s)** | Círculo de runas desenhado aos poucos, anel de energia que se acende, partículas orbitais que se reúnem, vórtice com distorção e ondulações, coluna de luz volumétrica simulada, ondas na superfície, clarão e som sintetizado. A ilha **atravessa o portal** (recorte por plano de clipping) e o dragão sai voando de dentro dele. |
| **O mundo** | Ilha flutuante com montanhas nevadas, castelo, vila com 7 casas, rio, ponte, cachoeira da montanha, cachoeira que cai da borda da ilha para dentro do portal, floresta, cristais, cogumelos luminosos, pedras flutuantes e nuvens. |
| **Vida** | Água correndo, árvores balançando ao vento (shader), fumaça nas chaminés, janelas e lanternas tremeluzindo, vaga-lumes, pássaros, criaturinhas (*lanudos*) passeando pelas trilhas, nuvens e rochas em órbita, sol que se move devagar. |
| **Dragão** | Totalmente procedural: respiração, piscadas, olhar que acompanha você, cauda articulada, asas que dobram e batem, pulinhos, alongamentos, voos periódicos ao redor da ilha com pouso, e pequenas chamas. |
| **Interações** | Dragão (olha para a câmera, ruge, bate as asas, solta chama e diz *"Finalmente alguém encontrou meu mundo!"*), vila (casas iluminam, sinos, informações), castelo (janelas acendem, portões abrem, fanfarra), cristais (brilho, partículas, sinos). |
| **Descobertas** | 7 segredos: cristal atrás da cachoeira, dragãozinho tímido na floresta, passagem secreta no castelo, baú escondido, espírito da floresta (só aparece depois de um tempo), pássaro dourado e coro dos cogumelos. Painel **Descobertas do Portal** com progresso salvo no `localStorage`. |
| **Som** | 100% sintetizado com Web Audio API (nenhum arquivo de áudio): abertura do portal, vento, água espacializada (HRTF), pássaros, trilha ambiente, dragão, chamas, cristais, sinos, fanfarra, baú. |

> Observação: o enunciado pedia um painel chamado “DESCUBRAS DO PORTAL”. Interpretei como erro de digitação e usei **“Descobertas do Portal”**.

## Três mundos

Na tela inicial você escolhe o que sai do portal (são três mundos):

- **Ilha Encantada**: a ilha de fantasia com dragão, castelo e cristais.
- **Vale Alecrim**: uma fazenda e uma vila aconchegantes em estilo voxel, 100% originais:
  - **Fazenda**: casa, horta com plantações que crescem (toque para colher), celeiro, galinheiro, vacas, gato na varanda, lago com píer de pesca e caixa de correio.
  - **Vila**: praça com chafariz, torre do relógio (os ponteiros seguem a hora do dia), padaria, taverna, armazém, forja, biblioteca e quadro de avisos.
  - **Moradores com rotina e falas**: Lia, Celeste, Dalva, Seu Olavo, Bento, Iara, Nina e Téo.
  - **Ciclo de dia e noite**: janelas e lampiões acendem e vaga-lumes aparecem à noite. O sino da torre adianta o tempo.
  - **Quatro estações**: toque na Árvore Anciã para mudar. Cada estação tem folhagem própria e pétalas, folhas ou neve caindo, e no inverno o chão fica coberto de neve.
  - **7 segredos próprios**: mina atrás da cachoeira, cogumelo gigante, galinha dourada, peixe lendário, tesouro enterrado, espírito noturno e uma carta misteriosa.

### Fazenda da Duda (um vale inteiro no estilo da casa)

O terceiro mundo é um vale pintado à mão no estilo do modelo da **casa da fazenda**, seguindo o mapa e as imagens de referência do projeto.

- **Casa da Duda**: o modelo da casa com as texturas pintadas originais (`casa.glb`, ~250 KB, WebP). No export ela é nivelada (o FBX vinha inclinado 19,6°) e alinhada (girada 33,5°), e sai fumaça da chaminé do próprio modelo. **Cópias da casa** com telhados de outras cores são as casas da vila.
- **O vale**: relevo e chão pintados no navegador (pinceladas de grama, trilhas de terra, praça de pedras, canteiros arados, areia, rocha e neve), com:
  - **fazenda** a sudoeste, cercada, com estufa de vidro, celeiro, galinheiro, galpão, colmeias, poço, espantalho, pomar, lago e 5 plantações;
  - **vila** no centro: praça com chafariz, Centro Comunitário com torre do relógio (os ponteiros seguem a hora), Mercado, Taverna, Clínica, Ferreiro, bancos e lampiões;
  - **rio** que desce do **lago da montanha** por uma cachoeira, com duas pontes, até a **baía** com praia, píer e barquinhos;
  - **montanhas** a nordeste com pinheiros e a entrada de uma mina, e **floresta** a oeste.
- **Vida**: a Duda faz a rotina dela (rega, visita a vila, acena para as galinhas), quatro moradores passeiam e conversam, árvores balançam, galinhas ciscam, patos nadam no lago e na baía, abelhas, borboletas, vaga-lumes, lampiões e janelas acesas à noite.
- **Interações**: Duda e moradores (falam), plantações (colher), árvores, casa (descansar e adiantar o dia), prédios da vila e casas (cartões), chafariz, píer e lago (pescar), mina e cachoeira.
- **7 segredos**: Biscoito, Ovo Dourado, Mel Encantado, Carpa Arco-íris, Trevo da Sorte, Flor da Lua (só à noite, na estufa) e Colheita Completa.

## Como a realidade aumentada funciona (três modos reais)

Ao tocar em **ABRIR MEU PORTAL**, o PORTAL verifica o que o aparelho realmente suporta e escolhe sozinho o melhor modo disponível. Nenhum modo finge um recurso que não existe.

| Modo | Quando é usado | O que faz de verdade |
|---|---|---|
| **1. WebXR (superfícies)** | `navigator.xr.isSessionSupported('immersive-ar')` retorna `true` (Chrome para Android com ARCore, por exemplo). | Sessão `immersive-ar` com **hit-test**. Um retículo aparece sobre superfícies **detectadas**; um toque abre o portal ali. Usa *DOM Overlay* para a interface e *XR Anchors* quando disponíveis, para o mundo ficar preso à mesa. |
| **2. Câmera + giroscópio** (padrão sem WebXR) | Sem WebXR, mas com câmera (iPhone/Safari, navegadores Android sem ARCore, desktop). A câmera abre direto, sem escolhas nem marcador. | A câmera aparece ao fundo e o portal é colocado num **plano assumido** (o chão, a ~1 m do celular; a interface avisa que a superfície *não* é detectada). O giroscópio faz a câmera virtual acompanhar a rotação do celular (3DoF); no iPhone a permissão de movimento é pedida no mesmo toque de *ABRIR MEU PORTAL*. Sem giroscópio, você arrasta o anel. Se algo der errado, o PORTAL sugere a **exploração em 3D**. |
| **Marcador impresso** (opcional, `?mode=marker`) | Só por parâmetro de URL. | Rastreamento de imagem real: o marcador [ArUco MIP 36h12 nº 7](public/marcador.html) é detectado em cada quadro da câmera (`js-aruco2`) e a pose 6DoF é estimada com POSIT. O mundo fica ancorado sobre o marcador, com suavização de tremores. Se o marcador sai de vista, o mundo permanece onde estava, com um aviso. |
| **Exploração 3D** | Botão **Explorar sem câmera**, ou quando a câmera não está disponível ou foi negada. | O mesmo mundo, sobre um altar de pedra num céu estrelado, com órbita, zoom e rotação automática. |

**Por que não MindAR?** O MindAR exige compilar o alvo (`.mind`) e carrega TensorFlow.js (~1 MB+). O marcador ArUco é **leve** (~13 KB gzip), **robusto** (36 bits, distância de Hamming 12, praticamente sem falsos positivos), fácil de imprimir e gerado de forma reproduzível pelo próprio repositório (`scripts/generate-marker.mjs`).

## Tecnologias

- **Vite** + **TypeScript** (modo estrito)
- **Three.js** (WebGL): shaders próprios (portal, água, cachoeiras, partículas na GPU, vento nas árvores, bandeiras), *instancing*, geometria mesclada, LOD
- **WebXR Device API**: `immersive-ar`, `hit-test`, `dom-overlay`, `anchors`
- **js-aruco2** (MIT, *vendorizado* como módulo ES) para detectar o marcador e estimar a pose
- **getUserMedia** (câmera traseira) e **DeviceOrientation** (giroscópio)
- **Web Audio API**: síntese, `PannerNode` HRTF, reverb por convolução
- **GLTF/GLB**: ponto de extensão opcional com `GLTFLoader` (veja [Modelos GLB opcionais](#modelos-glb-opcionais))
- **CSS moderno**: *glassmorphism*, `backdrop-filter`, `safe-area-inset`, `prefers-reduced-motion`
- Fontes auto-hospedadas via **@fontsource** (Cinzel, Cormorant Garamond, Manrope). Nada é carregado de CDN.
- **GitHub Actions** + **GitHub Pages**

Parâmetros de URL úteis:

| Parâmetro | Efeito |
|---|---|
| `?quality=economico\|equilibrado\|alto` | Força o nível de qualidade |
| `?mode=marker` / `?mode=manual` | Força o modo de câmera ao tocar em *ABRIR MEU PORTAL* |
| `?xr=off` | Ignora o WebXR (útil para testar o modo marcador num Android com ARCore) |
| `?autostart=explore` | Entra direto no modo 3D |
| `?world=fantasia\|vila\|duda` | Escolhe o mundo |
| `?timescale=3` | Acelera o relógio do mundo (usado nos testes automatizados) |

## Instruções de uso

1. Abra o link no celular e toque em **ABRIR MEU PORTAL**. Permita o uso da câmera.
2. **Android com WebXR:** mova o celular devagar, apontando para uma mesa ou para o chão. Quando o anel aparecer sobre a superfície, toque na tela.
3. **iPhone e outros:** a câmera abre direto. Permita o acesso ao movimento (giroscópio), aponte para o chão e toque em **Abrir portal aqui**. Se a câmera ou o giroscópio não funcionarem, toque em **Explorar em 3D**.
4. Assista à abertura do portal, toque no dragão, na vila, no castelo e nos cristais.
5. Procure os 7 segredos. O ícone de estrela mostra quantos você encontrou.
6. Controles:
   - **Arraste** com um dedo para girar o mundo; **pince** com dois dedos para mudar o tamanho; **gire** com dois dedos para rotacionar.
   - **Escala**: *Tamanho do mundo* (até 6×) e *Altura da ilha* (subir/abaixar a ilha sobre o portal), com controles deslizantes e botões.
   - **Reposicionar**: escolhe outro lugar para o portal.
   - **Explorar**: girar, aproximar/afastar, órbita automática e **Reiniciar** (repete a abertura).
   - **Som**: liga/desliga (a preferência fica salva). **X**: sai do modo AR e volta à tela inicial.

## Compatibilidade

| Plataforma | Modo usado | Situação |
|---|---|---|
| Android + Chrome (ARCore / Google Play Services for AR) | WebXR com detecção de superfícies | ✅ melhor experiência |
| Android sem ARCore, Firefox, Samsung Internet sem WebXR | Câmera + giroscópio | ✅ |
| iPhone/iPad (Safari, Chrome iOS) | Câmera + giroscópio (com permissão) | ✅ (o Safari não oferece WebXR AR) |
| Desktop (Chrome, Edge, Firefox, Safari) | Webcam (arrastar o anel) ou exploração 3D | ✅ |
| Navegadores sem WebGL | Mensagem explicativa na tela inicial | ⚠️ |

Requisitos: HTTPS, WebGL 1 ou 2, ES2020.

## Limitações conhecidas

- **WebXR no iOS**: o Safari não oferece `immersive-ar`, por isso iPhones usam a câmera com giroscópio (3DoF: o mundo acompanha a rotação, não os passos). O PORTAL não usa *Quick Look*/USDZ, porque o mundo é interativo e procedural.
- **Escala real no modo marcador**: o campo de visão da câmera não é exposto pelos navegadores, então assumimos ~64° no lado maior do sensor. O alinhamento visual fica correto; a distância *absoluta* pode variar alguns centímetros entre aparelhos.
- **Modo manual** não detecta a superfície: ela é assumida (a interface avisa). Sem giroscópio, o mundo fica fixo na tela.
- **Iluminação**: fixa e estilizada (não usa *light estimation*), para manter a identidade visual.
- **Som no iPhone**: o botão físico de silencioso também silencia a Web Audio API.
- **Testes automatizados** rodam no Chromium headless com GPU por software. O WebXR real (ARCore) **não pode ser emulado** ali: a lógica de fallback do WebXR é testada com um `navigator.xr` simulado, mas a detecção de superfícies precisa ser validada num Android real.
- O mundo é **procedural**, sem arquivos GLB. Isso deixa o download leve (~250 KB de JS comprimido), mas não tem o nível de detalhe de modelos esculpidos à mão.

## Testes

```bash
npm run build
npm test
```

`tests/run-e2e.mjs` (Playwright + Chromium headless) serve o `dist/` em `/portal-ar/` e verifica:

1. Abertura da página (título, subtítulo, botões)
2. Permissão de câmera concedida (câmera falsa) **e negada** (orientação clara + alternativa)
3. Detecção de WebXR, sem afirmar o que não existe; com `navigator.xr` simulado que falha → *fallback*
4. Entrada no modo AR
5. Posicionamento: o **marcador real é detectado** num vídeo sintético (`tests/make-marker-video.py`) e a pose é estimada; o modo manual também é testado
6. Abertura do portal (`hidden → opening → open`)
7. Renderização do mundo (draw calls, triângulos, objetos visíveis)
8. Interações (dragão + fala, vila + cartão, castelo + portões, cristais) e descobertas + painel + `localStorage`
9. Áudio (`AudioContext` em execução após o gesto)
10. Redimensionamento / orientação
11. Retorno à tela inicial (câmera liberada)
12. Subdiretório do GitHub Pages: nenhum 404, caminhos relativos, marcador acessível

As capturas de tela ficam em `tests/output/`. Requisitos: `npx playwright install chromium` e Python 3 com `numpy` (para gerar o vídeo do marcador).

## Desempenho e qualidade gráfica

Três níveis, detectados automaticamente (memória, núcleos, GPU via `WEBGL_debug_renderer_info`) e ajustáveis na tela inicial:

| | Econômico | Equilibrado | Alto |
|---|---|---|---|
| Pixel ratio máx. | 1 | 1.5 | 2 |
| Antialias | não | sim | sim |
| Sombras | não | 1024² | 2048² |
| Partículas | 45% | 75% | 100% |
| Árvores | 34 | 58 | 84 |
| Detalhe da malha | baixo | médio | alto |
| Resolução da detecção do marcador | 360 px | 480 px | 640 px |

Otimizações:

- **Geometria mesclada**: centenas de peças do cenário viram 2 *draw calls* (cores por vértice).
- **Instancing**: árvores, cogumelos, grama e flores.
- **Personagens “cozidos”** por parte rígida: o dragão passou de 70 malhas para 28, e todas as articulações continuam animadas.
- **Partículas na GPU** (fumaça, vaga-lumes, névoa, órbitas do portal) e *pools* sem alocação por quadro.
- **LOD**: pequenos detalhes (vigas, ameias, cercas, pedrinhas) somem com a distância, e a distância acompanha a escala real do diorama.
- **Shaders pré-compilados** antes da revelação (`compileAsync`), sem engasgos.
- **Qualidade adaptativa**: se a média de quadros cair, o nível desce automaticamente.
- Detecção do marcador numa cópia reduzida do quadro, pulando quadros quando fica cara.
- **Perda de contexto WebGL** tratada (aviso + restauração).
- Carregamento em etapas: a tela inicial tem ~23 KB de JS e aparece na hora; Three.js e o mundo são carregados e construídos em segundo plano.

