# Fazenda da Duda: pipeline dos modelos

Converte os modelos do projeto (FBX) nos arquivos que o site carrega em
`public/models/fazenda-da-duda/`. Os FBX originais ficam fora do repositório
(são grandes); aponte os scripts para onde eles estiverem.

Requisitos: Blender 4.x ou 5.x e Python 3 com `numpy` (e `Pillow`, só para as prévias).

## 1. Casa (textura pintada → GLB leve)

```bash
blender -b --factory-startup --python export_farmhouse.py -- Stardew_Valley_Farmhouse.fbx casa.glb
```

Remove o disco de grama separado, aplica as transformações, coloca a base no
centro com largura 1, reduz as texturas pela metade e as grava em WebP.

## 2. Fazenda (voxel → dados recoloridos)

```bash
blender -b --factory-startup --python voxelize.py -- My_Stardew_Valley_Farm.fbx vox.npz
python color.py           # lê vox.npz e grava fazenda.bin, fazenda.json e meta.json
```

- `voxelize.py` reconstrói a grade de voxels a partir da malha (que vem com faces
  mescladas), preenche o interior das colunas e descarta os pedaços soltos.
- `color.py` dá as cores novas por região e altura (grama, trilhas, canteiros,
  estufa, celeiro, galinheiro, árvores por tipo, flores…), limpa o terreno da
  casa e o caminho até a varanda, e grava `fazenda.bin`: 1 byte por voxel
  (`cor | parte << 6`), compactado em pares (quantidade, valor).

Copie `fazenda.bin` e `fazenda.json` para `public/models/fazenda-da-duda/`.

## Prévia sem o navegador

```bash
blender -b --factory-startup --python preview_vox.py -- colored.npz meta.json previa.png persp
```
