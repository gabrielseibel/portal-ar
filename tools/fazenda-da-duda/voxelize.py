"""Voxelizes the greedy-meshed farm FBX back into a voxel grid (Blender python).
Writes vox.npz with: occ (X,Y,Z uint8 class+1), and prints analysis."""
import bpy, sys, numpy as np
from collections import deque, Counter

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
img = bpy.data.images[0]
W, H = img.size
px = np.array(img.pixels[:]).reshape(H, W, 4)
PAL = np.array([(134, 128, 114), (165, 130, 110), (173, 139, 105), (96, 107, 97)], float) / 255.0

verts, tris, uvs = [], [], []
off = 0
for o in objs:
    me = o.data
    co = np.array([v.co[:] for v in me.vertices])
    verts.append(co)
    uvl = me.uv_layers[0].data
    for p in me.polygons:
        vs = list(p.vertices)
        tris.append([vs[0] + off, vs[1] + off, vs[2] + off])
        uvs.append(uvl[p.loop_start].uv[:])
    off += len(co)
V = np.concatenate(verts)
T = np.array(tris)
UV = np.array(uvs)

grid = []
for ax in range(3):
    vals = np.unique(np.round(V[:, ax], 2))
    grid.append(vals)
G = np.stack([np.abs(V[:, ax:ax + 1] - grid[ax][None, :]).argmin(1) for ax in range(3)], 1)
NX, NY, NZ = (len(g) - 1 for g in grid)
print("grid", NX, NY, NZ)

# palette class per triangle
pxs = np.clip((UV[:, 0] * W).astype(int), 0, W - 1)
pys = np.clip((UV[:, 1] * H).astype(int), 0, H - 1)
cols = px[pys, pxs, :3]
cls = np.argmin(((cols[:, None, :] - PAL[None]) ** 2).sum(2), 1)

occ = np.zeros((NX, NY, NZ), np.uint8)        # class+1
faces = np.zeros((NX, NY, NZ), np.uint8)      # bitmask of seen faces: +x1 -x2 +y4 -y8 +z16 -z32
for ti in range(len(T)):
    g = G[T[ti]]                     # 3x3 int grid coords
    a = int(np.argmin(g.max(0) - g.min(0)))   # constant axis
    f = g[0, a]
    o1, o2 = [ax for ax in range(3) if ax != a]
    # outward side: use real normal sign
    p0, p1, p2 = V[T[ti]]
    n = np.cross(p1 - p0, p2 - p0)
    s = 1 if n[a] > 0 else -1
    layer = f - 1 if s > 0 else f
    if layer < 0 or layer >= (NX, NY, NZ)[a]:
        continue
    A = g[:, [o1, o2]].astype(float)
    umin, vmin = A.min(0).astype(int)
    umax, vmax = A.max(0).astype(int)
    for u in range(umin, umax):
        for v in range(vmin, vmax):
            px_, py_ = u + 0.5, v + 0.5
            # barycentric inside test
            (x0, y0), (x1, y1), (x2, y2) = A
            d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(d) < 1e-9:
                continue
            l0 = ((y1 - y2) * (px_ - x2) + (x2 - x1) * (py_ - y2)) / d
            l1 = ((y2 - y0) * (px_ - x2) + (x0 - x2) * (py_ - y2)) / d
            l2 = 1 - l0 - l1
            if l0 < -1e-6 or l1 < -1e-6 or l2 < -1e-6:
                continue
            idx = [0, 0, 0]
            idx[a] = layer; idx[o1] = u; idx[o2] = v
            x, y, z = idx
            if occ[x, y, z] == 0:
                occ[x, y, z] = cls[ti] + 1
            bit = {(0, 1): 1, (0, -1): 2, (1, 1): 4, (1, -1): 8, (2, 1): 16, (2, -1): 32}[(a, s)]
            faces[x, y, z] |= bit

# fill column gaps that are enclosed (lower has no +z face, upper has no -z face)
filled = 0
for x in range(NX):
    for y in range(NY):
        zs = np.nonzero(occ[x, y])[0]
        for z1, z2 in zip(zs[:-1], zs[1:]):
            if z2 - z1 > 1 and not (faces[x, y, z1] & 16) and not (faces[x, y, z2] & 32):
                occ[x, y, z1 + 1:z2] = occ[x, y, z1]
                filled += z2 - z1 - 1
print("filled", filled, "voxels", int((occ > 0).sum()))

# keep largest 6-connected component
lab = np.zeros(occ.shape, np.int32)
sizes = []
cur = 0
for start in zip(*np.nonzero(occ)):
    if lab[start]:
        continue
    cur += 1
    q = deque([start]); lab[start] = cur; n = 0
    while q:
        x, y, z = q.popleft(); n += 1
        for dx, dy, dz in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)):
            X, Y, Z = x+dx, y+dy, z+dz
            if 0 <= X < NX and 0 <= Y < NY and 0 <= Z < NZ and occ[X, Y, Z] and not lab[X, Y, Z]:
                lab[X, Y, Z] = cur; q.append((X, Y, Z))
    sizes.append(n)
big = int(np.argmax(sizes)) + 1
print("components", len(sizes), "largest", max(sizes), "others", sorted(sizes)[-6:-1])
occ[lab != big] = 0
np.savez_compressed(out, occ=occ, gx=grid[0], gy=grid[1], gz=grid[2])

# column analysis
top = np.full((NX, NY), -1)
for x in range(NX):
    for y in range(NY):
        zs = np.nonzero(occ[x, y])[0]
        if len(zs): top[x, y] = zs.min()
print("bottom z hist", Counter(top.flatten().tolist()).most_common(6))
ys_used = np.nonzero(occ.any((0, 2)))[0]; xs_used = np.nonzero(occ.any((1, 2)))[0]
print("x range", xs_used.min(), xs_used.max(), "y range", ys_used.min(), ys_used.max())
# lowest contiguous run from bottom = terrain top
tt = np.full((NX, NY), -1)
for x in range(NX):
    for y in range(NY):
        col = occ[x, y]
        z = 0
        if not col[0]:
            continue
        while z + 1 < NZ and col[z + 1]:
            z += 1
        tt[x, y] = z
print("terrain-run top hist", Counter(tt.flatten().tolist()).most_common(12))
