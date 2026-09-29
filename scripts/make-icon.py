"""OptiTrace — genera build/icon.png (1024) y build/icon.ico (16–256).
Lupa sobre una pequeña red de nodos, degradado violeta→cian de la marca.
Uso:  python scripts/make-icon.py
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
ROOT = os.path.join(os.path.dirname(__file__), '..')
C1, C2 = (124, 92, 255), (34, 211, 238)   # #7c5cff → #22d3ee


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# Fondo: cuadrado redondeado con degradado diagonal
grad = Image.new('RGB', (S, S))
px = grad.load()
for y in range(S):
    for x in range(S):
        px[x, y] = lerp(C1, C2, (x + y) / (2 * S))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=230, fill=255)
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
img.paste(grad, (0, 0), mask)

# Brillo superior suave
gloss = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(gloss).ellipse([-200, -620, S + 200, 430], fill=(255, 255, 255, 38))
img = Image.alpha_composite(img, Image.composite(gloss, Image.new('RGBA', (S, S)), mask))

d = ImageDraw.Draw(img)
W = (255, 255, 255, 255)

# Lente de la lupa
cx, cy, r = 430, 420, 250
ring = 62
# Red de nodos dentro de la lente
nodes = [(cx - 120, cy - 70), (cx + 95, cy - 110), (cx + 20, cy + 40), (cx - 95, cy + 125), (cx + 130, cy + 110)]
edges = [(0, 2), (1, 2), (2, 3), (2, 4), (0, 1)]
for a, b in edges:
    d.line([nodes[a], nodes[b]], fill=(255, 255, 255, 200), width=18)
for i, (x, y) in enumerate(nodes):
    rr = 44 if i == 2 else 32
    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=W)
# Aro
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=W, width=ring)
# Mango
ang = math.radians(45)
x0, y0 = cx + (r + ring / 2 - 10) * math.cos(ang), cy + (r + ring / 2 - 10) * math.sin(ang)
x1, y1 = x0 + 250 * math.cos(ang), y0 + 250 * math.sin(ang)
d.line([(x0, y0), (x1, y1)], fill=W, width=110)
d.ellipse([x1 - 55, y1 - 55, x1 + 55, y1 + 55], fill=W)

# Sombra ligera bajo los trazos blancos
shadow = img.split()[3].point(lambda a: 0)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('ok')
