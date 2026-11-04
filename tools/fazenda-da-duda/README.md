# Fazenda da Duda: pipeline da casa

Converte o modelo da casa (FBX com texturas pintadas) no `casa.glb` que o site
carrega de `public/models/fazenda-da-duda/`. O FBX original fica fora do
repositório; aponte o script para onde ele estiver.

Requisito: Blender 4.x ou 5.x.

```bash
blender -b --factory-startup --python export_farmhouse.py -- Stardew_Valley_Farmhouse.fbx casa.glb
```

O script:

- remove o disco de grama separado (o chão do vale é a base);
- **nivela** a casa: o FBX vem inclinado, então a média das faces quase horizontais vira o "para cima";
- **alinha** as paredes aos eixos (o FBX também vem girado), com a escada para a frente (+Z);
- coloca a base no centro com profundidade 1, reduz as texturas pela metade e as grava em WebP.

O resto do vale (terreno, prédios, árvores, personagens) é gerado no navegador em
`src/world/duda/` — não há outros arquivos 3D para exportar.
