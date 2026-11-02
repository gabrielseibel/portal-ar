"""Recolours the voxelized farm into the 'Fazenda da Duda' look.
Input: vox.npz (palette classes from the original model). Output: colored.npz + meta.json."""
import numpy as np, json, colorsys
from collections import deque

d = np.load('vox.npz')
occ = d['occ'][:, 11:, :].copy()          # crop empty rows (board starts at y=11)
NX, NY, NZ = occ.shape
Y0 = 11
def R(x0, x1, y0, y1):                     # rect in original coords -> cropped
    return (x0, x1, y0 - Y0, y1 - Y0)

PAL = [None]                                # index 0 = empty
NAMES = {}
def pal(name, hexc):
    if name not in NAMES:
        NAMES[name] = len(PAL)
        PAL.append(hexc)
    return NAMES[name]

GRASS = [pal('grass', '#5fb043'), pal('grass2', '#6fbe4a'), pal('grass3', '#549f3c')]
MEADOW = [pal('meadow', '#7cc24f'), pal('meadow2', '#8bcb57'), pal('clover', '#6bb646')]
SAND = [pal('sand', '#dcb46c'), pal('sand2', '#d2a85e')]
SOIL = [pal('soil', '#7b4f30'), pal('soil2', '#6a4228')]
DIRT = pal('dirt', '#8f5f37')
DIRT2 = pal('dirt2', '#6f4a2e')
STONE = pal('stone', '#8d8a86')
PONDBED = pal('pondbed', '#2f6f8f')
WOOD = pal('wood', '#a8743f')
WOOD_D = pal('wood_dark', '#7a4f2c')
TRUNK = pal('trunk', '#6e4526')
LEAF = [pal('leaf', '#3f9a3a'), pal('leaf2', '#2f8233'), pal('leaf3', '#56ad45'), pal('leaf4', '#4aa040')]
BLOSSOM = [pal('blossom', '#f4a7c9'), pal('blossom2', '#f7bdd6'), pal('blossom3', '#ea8fb8')]
AUTUMN = [pal('gold', '#f2b233'), pal('gold2', '#e89a2a'), pal('gold3', '#f7c94b')]
ORANGE_T = [pal('orange_tree', '#3e9640'), pal('orange_tree2', '#2f8233')]
APPLE = pal('apple', '#e5383b')
ORANGE = pal('orange', '#ff9b2f')
BUSH = [pal('bush', '#3b8c3a'), pal('bush2', '#4b9d44')]
FLOWERS = [pal('fl_pink', '#ff7eb6'), pal('fl_yellow', '#ffe14d'), pal('fl_white', '#fffaf0'), pal('fl_purple', '#b48cff'), pal('fl_red', '#ff4d4d')]
CROP_LEAF = [pal('crop_leaf', '#4fb03f'), pal('crop_leaf2', '#3e9a35')]
FRUITS = {'tomato': pal('tomato', '#e8463a'), 'pumpkin': pal('pumpkin', '#f08a24'), 'blueberry': pal('blueberry', '#4f6fe0'),
          'cauli': pal('cauli', '#f5f0d8'), 'strawberry': pal('strawberry', '#ff4f6d'), 'corn': pal('corn', '#ffd447')}
GLASS = pal('glass', '#a9e3ee')
GLASS_FRAME = pal('glass_frame', '#f3f6ea')
BARN_RED = pal('barn_red', '#b8423a')
BARN_TRIM = pal('barn_trim', '#f4ede0')
ROOF_GREY = pal('roof_grey', '#5b5f6e')
ROOF_DARK = pal('roof_dark', '#474a57')
COOP_WALL = pal('coop_wall', '#e3b071')
COOP_ROOF = pal('coop_roof', '#3f8f8a')
SHED_WALL = pal('shed_wall', '#c98b4e')
SHED_ROOF = pal('shed_roof', '#8e3b46')
HIVE = pal('hive', '#f1c75b')
HIVE_ROOF = pal('hive_roof', '#9a6334')
CRATE = pal('crate', '#b97c43')
DUCK = pal('duck', '#ffd23f')
SCARE = pal('scarecrow', '#d9a441')
LANTERN = pal('lantern', '#ffe9a8')

rng = np.random.default_rng(7)
def h2(x, y, s=0):
    v = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
    return ((v * 2654435761) & 0xffffffff) / 2**32

# --- regions (original coords) ----------------------------------------------
BUILD = {
    'greenhouse': R(28, 44, 90, 105),
    'house': R(18, 43, 58, 79),          # cleared: the textured farmhouse model goes here
    'shed': R(39, 48, 49, 56),
    'barn': R(92, 111, 93, 107),
    'coop': R(105, 121, 77, 87),
    'hives': R(71, 82, 100, 104),
    'crates': R(72, 82, 85, 91),
}
FIELDS = {  # crop kind per sub-field
    'tomato': R(71, 86, 70, 88), 'pumpkin': R(87, 103, 70, 88),
    'blueberry': R(71, 86, 52, 69), 'cauli': R(87, 103, 52, 69),
    'strawberry': R(46, 62, 59, 77),
}
POND = R(52, 74, 29, 46)
SCARECROW = R(57, 63, 48, 54)

def inr(x, y, r, m=0):
    return r[0] - m <= x <= r[1] + m and r[2] - m <= y <= r[3] + m
def region_of(x, y, table):
    for k, r in table.items():
        if inr(x, y, r):
            return k
    return None

col = np.zeros_like(occ)
part = np.zeros_like(occ)     # 0 static, 1 foliage (sways), 2 crop, 3 building
top = np.full((NX, NY), -1)
for x in range(NX):
    for y in range(NY):
        zs = np.nonzero(occ[x, y])[0]
        if len(zs): top[x, y] = zs.max()


# --- canopy components (for per-tree colour) -----------------------------------
canopy = np.zeros(occ.shape, bool)
for x in range(NX):
    for y in range(NY):
        if region_of(x, y, BUILD) not in (None, 'house') or region_of(x, y, FIELDS):
            continue
        for z in range(4, NZ):
            c = occ[x, y, z]
            if c and c != 3:
                canopy[x, y, z] = True
tree_id = np.zeros(occ.shape, np.int32)
trees = []
for s in zip(*np.nonzero(canopy)):
    if tree_id[s]:
        continue
    tid = len(trees) + 1
    q = deque([s]); tree_id[s] = tid; pts = []
    while q:
        p = q.popleft(); pts.append(p)
        x, y, z = p
        for dx, dy, dz in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)):
            X, Y, Z = x + dx, y + dy, z + dz
            if 0 <= X < NX and 0 <= Y < NY and 0 <= Z < NZ and canopy[X, Y, Z] and not tree_id[X, Y, Z]:
                tree_id[X, Y, Z] = tid; q.append((X, Y, Z))
    P = np.array(pts)
    cls = np.bincount(occ[tuple(P.T)], minlength=5)
    trees.append({'n': len(P), 'c': P.mean(0).tolist(), 'zmin': int(P[:, 2].min()), 'zmax': int(P[:, 2].max()),
                  'cls': int(np.argmax(cls))})
# tree kinds: most green, golden class -> autumn/blossom mix, a few fruit trees
for i, t in enumerate(trees):
    r = h2(int(t['c'][0]), int(t['c'][1]), 3)
    if t['n'] < 12:
        t['kind'] = 'bush'
    elif t['cls'] == 4:
        t['kind'] = 'blossom' if r < 0.45 else 'autumn'
    elif r < 0.18:
        t['kind'] = 'apple'
    elif r < 0.3:
        t['kind'] = 'orange'
    elif r < 0.38:
        t['kind'] = 'blossom'
    else:
        t['kind'] = 'green'

# clear the farmhouse lot: the original voxel house plus any tree touching it (whole trees, trunks too)
CORRIDOR = R(18, 40, 45, 58)   # porch -> main path, Duda walks here
hx0, hx1, hy0, hy1 = BUILD['house']
cx0, cx1, cy0, cy1 = CORRIDOR
kill = (set(np.unique(tree_id[hx0:hx1 + 1, hy0:hy1 + 1, :]).tolist()) | set(np.unique(tree_id[cx0:cx1 + 1, cy0:cy1 + 1, :]).tolist())) - {0}
for tid in kill:
    m = tree_id == tid
    cols2 = m.any(2)
    occ[m] = 0; canopy[m] = False; tree_id[m] = 0
    for x, y in zip(*np.nonzero(cols2)):
        occ[x, y, 2:][occ[x, y, 2:] == 3] = 0
    trees[tid - 1]['n'] = 0
for (a0, a1, b0, b1) in (BUILD['house'], CORRIDOR):
    occ[a0:a1 + 1, b0:b1 + 1, 2:] = 0
    canopy[a0:a1 + 1, b0:b1 + 1, :] = False
PORCH_PATHS = (R(20, 23, 47, 58), R(20, 40, 47, 50))

def noise(x, y, s):
    # cheap value noise blobs
    gx, gy = x / 9.0, y / 9.0
    ix, iy = int(gx), int(gy); fx, fy = gx - ix, gy - iy
    a = h2(ix, iy, s); b = h2(ix + 1, iy, s); c = h2(ix, iy + 1, s); e = h2(ix + 1, iy + 1, s)
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy

plants = {}
for x in range(NX):
    for y in range(NY):
        zs = np.nonzero(occ[x, y])[0]
        if not len(zs):
            continue
        ztop = zs.max()
        b = region_of(x, y, BUILD)
        f = region_of(x, y, FIELDS)
        in_pond = inr(x, y, POND)
        for z in zs:
            c = occ[x, y, z]
            v = 0; p = 0
            if z <= 1:  # ---------------------------------------------- ground
                is_top = z == ztop or not occ[x, y, z + 1]
                if not is_top:
                    v = DIRT if z == 1 else DIRT2
                elif in_pond and z == 0:
                    v = PONDBED
                elif f and c == 1:
                    v = SOIL[(y + (x // 3)) % 2]
                elif any(inr(x, y, r) for r in PORCH_PATHS):
                    v = SAND[int(h2(x, y) * 2)]
                elif c == 1:
                    v = SAND[int(h2(x, y) * 2)]
                elif c == 2:
                    v = GRASS[int(h2(x, y) * 3)]
                else:
                    n = noise(x, y, 1)
                    v = MEADOW[0 if n < 0.55 else 1] if h2(x, y, 9) > 0.08 else MEADOW[2]
            elif b:  # ---------------------------------------------- buildings
                p = 3
                if b == 'greenhouse':
                    v = GLASS if c == 3 and z > 3 else GLASS_FRAME if c == 2 else WOOD
                elif b == 'barn':
                    v = (ROOF_GREY if c == 3 else ROOF_DARK) if z >= 9 else (BARN_TRIM if c == 2 else BARN_RED)
                elif b == 'coop':
                    v = COOP_WALL if c == 3 else COOP_ROOF
                elif b == 'shed':
                    v = SHED_WALL if c == 3 else SHED_ROOF
                elif b == 'hives':
                    v = HIVE if z < ztop else HIVE_ROOF
                else:
                    v = CRATE if c != 2 else WOOD_D
            elif f:  # ---------------------------------------------- crops
                p = 2
                is_top = z == ztop
                v = FRUITS[f] if is_top else CROP_LEAF[(x + y) % 2]
                key = (x // 3, y // 3)
                plants.setdefault(f, set()).add((x, y))
            elif inr(x, y, SCARECROW) and not canopy[x, y, z]:
                v = SCARE if c != 3 else WOOD_D
            elif canopy[x, y, z]:  # ---------------------------------------- trees
                t = trees[tree_id[x, y, z] - 1]
                k = t['kind']; hh = h2(x * 7 + z, y * 3 + z, 5)
                p = 1
                if k == 'blossom':
                    v = BLOSSOM[int(hh * 3)]
                elif k == 'autumn':
                    v = AUTUMN[int(hh * 3)]
                elif k == 'bush':
                    v = BUSH[int(hh * 2)]
                else:
                    v = LEAF[int(hh * 4)]
                    surface = z == ztop or not occ[x, y, min(z + 1, NZ - 1)] or any(
                        not occ[min(max(x + dx, 0), NX - 1), min(max(y + dy, 0), NY - 1), z] for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)))
                    if surface and k in ('apple', 'orange') and h2(x, y * 5 + z, 11) < 0.13:
                        v = APPLE if k == 'apple' else ORANGE
            else:  # -------------------------------------------------------- misc
                if in_pond:
                    v = DUCK
                elif c == 3:
                    under_canopy = canopy[x, y, z:].any()
                    v = TRUNK if under_canopy else WOOD
                elif ztop <= 4 or z <= 3:
                    if z == ztop and h2(x, y, 21) < 0.35:
                        v = FLOWERS[int(h2(x, y, 22) * 5)]
                    else:
                        v = BUSH[int(h2(x, y, 23) * 2)]
                else:
                    v = BUSH[int(h2(x, y, 24) * 2)]
            col[x, y, z] = v
            part[x, y, z] = p

col[occ == 0] = 0
part[occ == 0] = 0

# crop plants = 2D connected clusters of crop columns
crop_cols = np.zeros((NX, NY), bool)
for k, s in plants.items():
    for (x, y) in s:
        crop_cols[x, y] = True
pl = []
seen = np.zeros((NX, NY), bool)
for x in range(NX):
    for y in range(NY):
        if crop_cols[x, y] and not seen[x, y]:
            q = deque([(x, y)]); seen[x, y] = True; pts = []
            while q:
                a, b2 = q.popleft(); pts.append((a, b2))
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    X, Y = a + dx, b2 + dy
                    if 0 <= X < NX and 0 <= Y < NY and crop_cols[X, Y] and not seen[X, Y]:
                        seen[X, Y] = True; q.append((X, Y))
            P = np.array(pts)
            zt = max(int(np.nonzero(occ[a, b2])[0].max()) for a, b2 in pts)
            pl.append({'x': round(float(P[:, 0].mean()) + 0.5, 2), 'y': round(float(P[:, 1].mean()) + 0.5, 2), 'top': zt + 1,
                       'kind': region_of(int(P[0, 0]), int(P[0, 1]), FIELDS), 'n': len(pts)})

# drop voxels that are not visible (fully enclosed) -> nothing to do; mesher culls faces
meta = {
    'dims': [NX, NY, NZ],
    'groundTop': 2,  # top face of ground layer z=1 -> y = 2
    'palette': PAL[1:],
    'names': {k: v for k, v in NAMES.items()},
    'buildings': {k: list(v) for k, v in BUILD.items()},
    'fields': {k: list(v) for k, v in FIELDS.items()},
    'pond': list(POND),
    'trees': [{'x': round(t['c'][0] + 0.5, 2), 'y': round(t['c'][1] + 0.5, 2), 'z': round(t['c'][2] + 0.5, 2), 'top': t['zmax'] + 1, 'kind': t['kind'], 'n': t['n']} for t in trees if t['n'] >= 12],
    'plants': pl,
}
np.savez_compressed('colored.npz', col=col, part=part)
# compact runtime format: byte = colour | part << 6, run-length encoded as (count, value) pairs, x fastest
flat = (col | (part << 6)).transpose(2, 1, 0).reshape(-1)
rle = bytearray(); i = 0
while i < len(flat):
    v = flat[i]; n = 1
    while i + n < len(flat) and flat[i + n] == v and n < 255: n += 1
    rle += bytes((n, int(v))); i += n
open('fazenda.bin', 'wb').write(rle)
print('rle bytes', len(rle))
json.dump(meta, open('meta.json', 'w'), indent=1)
# what the site loads next to fazenda.bin
json.dump({'dims': meta['dims'], 'palette': meta['palette'], 'glass': NAMES['glass'], 'trees': meta['trees']}, open('fazenda.json', 'w'), separators=(',', ':'))
print('palette', len(PAL) - 1, 'trees', len(meta['trees']), 'plants', len(pl), 'voxels', int((col > 0).sum()))
from collections import Counter
print(Counter(t['kind'] for t in meta['trees']))
print(Counter(p['kind'] for p in pl))
