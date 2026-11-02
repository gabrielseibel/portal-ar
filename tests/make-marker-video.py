"""Generates tests/fixtures/marker.y4m: a fake camera feed showing the PORTAL
marker lying on a table, seen in perspective and slowly moving. Used with
Chromium's --use-file-for-fake-video-capture to test marker tracking end to end.
Usage: python3 tests/make-marker-video.py
"""
import math, re, os
import numpy as np

W, H, FRAMES, FPS = 640, 480, 90, 30
root = os.path.dirname(os.path.abspath(__file__))
svg = open(os.path.join(root, '..', 'public', 'marker.svg')).read()
# rebuild the 10x10 cell grid from the generated SVG
grid = np.zeros((10, 10), dtype=np.uint8)
for x, y, w, h, fill in re.findall(r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(\w+)"', svg):
    x, y, w, h = map(int, (x, y, w, h))
    grid[y:y + h, x:x + w] = 255 if fill == 'white' else 0

def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(A, dtype=float))
    return vt[-1].reshape(3, 3) / vt[-1][-1]

ys, xs = np.mgrid[0:H, 0:W]
pix = np.stack([xs.ravel(), ys.ravel(), np.ones(W * H)])
rng = np.random.default_rng(1)
table = (150 + 18 * np.sin(xs / 37.0) * np.cos(ys / 53.0) + rng.normal(0, 4, (H, W))).clip(0, 255)

os.makedirs(os.path.join(root, 'fixtures'), exist_ok=True)
out = open(os.path.join(root, 'fixtures', 'marker.y4m'), 'wb')
out.write(f'YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n'.encode())
for f in range(FRAMES):
    t = f / FRAMES * 2 * math.pi
    cx, cy = W / 2 + 25 * math.sin(t), H / 2 + 40 + 12 * math.cos(t)
    s = 120
    # trapezoid: far edge narrower (marker lying on a table)
    a = 0.12 * math.sin(t)
    pts = []
    for (px, py) in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        persp = 0.72 if py < 0 else 1.0
        x = px * s * persp
        y = py * s * 0.62
        xr = x * math.cos(a) - y * math.sin(a)
        yr = x * math.sin(a) + y * math.cos(a)
        pts.append((cx + xr, cy + yr))
    Hm = homography([(0, 0), (10, 0), (10, 10), (0, 10)], pts)
    inv = np.linalg.inv(Hm)
    m = inv @ pix
    u = (m[0] / m[2]).reshape(H, W)
    v = (m[1] / m[2]).reshape(H, W)
    inside = (u >= 0) & (u < 10) & (v >= 0) & (v < 10)
    img = table.copy()
    img[inside] = grid[v[inside].astype(int), u[inside].astype(int)] * 0.92 + 8
    y = img.astype(np.uint8)
    out.write(b'FRAME\n')
    out.write(y.tobytes())
    out.write(np.full((H // 2) * (W // 2) * 2, 128, dtype=np.uint8).tobytes())
out.close()
print('tests/fixtures/marker.y4m written')
