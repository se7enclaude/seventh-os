"""Seventh OS — icônes.
  build/icon.ico            : icône du hub (un « 7 » en verre sur le dégradé Studio Glass), 16 à 256 px
  ui/icons/seventh-os.png   : la même en 512 px pour l'interface
  ui/icons/<id>.png         : icône de chaque appli, tirée de son .ico (python tools/make_icons.py --app id fichier.ico)
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'ui' / 'fonts' / 'Anton-Regular.ttf'


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def hub(size=1024):
    """Le portail : fond encre profond, anneau lumineux rose -> teal (la « porte » vers toutes les applis), « 7 » blanc."""
    s = size
    import math
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    bg = Image.new('RGBA', (s, s))
    px = bg.load()
    for y in range(s):
        for x in range(s):
            t = (0.5 * y + 0.5 * x) / s
            px[x, y] = lerp((22, 34, 38), (11, 13, 14), t) + (255,)
    mask = Image.new('L', (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.23), fill=255)
    img.paste(bg, (0, 0), mask)
    empty = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    # anneau : dégradé le long du cercle (rose en haut à droite, teal en bas à gauche), avec un halo
    ring = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    cx, cy, r, wdt = s / 2, s / 2, s * 0.36, s * 0.055
    for k in range(720):
        a = 2 * math.pi * k / 720
        t = (math.sin(a - math.pi / 4) + 1) / 2
        col = lerp((241, 185, 178), (127, 167, 172), t)
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        rd.ellipse([x - wdt / 2, y - wdt / 2, x + wdt / 2, y + wdt / 2], fill=col + (255,))
    halo = ring.filter(ImageFilter.GaussianBlur(s * 0.035))
    img = Image.alpha_composite(img, Image.composite(halo, empty, mask))
    img = Image.alpha_composite(img, Image.composite(halo, empty, mask))
    img = Image.alpha_composite(img, ring)
    # le « 7 » : ombre douce, puis lettre blanche
    font = ImageFont.truetype(str(FONT), int(s * 0.5))
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), '7', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x, y = (s - w) / 2 - box[0], (s - h) / 2 - box[1] + s * 0.01
    sh = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((x, y + s * 0.025), '7', font=font, fill=(16, 48, 54, 150))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(s * 0.02)))
    ImageDraw.Draw(img).text((x, y), '7', font=font, fill=(255, 255, 255, 255))
    return img


def app_icon(app_id, ico):
    im = Image.open(ico)
    sizes = getattr(im, 'ico', None) and im.ico.sizes() or [im.size]
    best = max(sizes)
    try:
        im.size = best
    except Exception:  # noqa: BLE001
        pass
    im = im.convert('RGBA').resize((256, 256), Image.LANCZOS)
    out = ROOT / 'ui' / 'icons' / (app_id + '.png')
    im.save(out)
    print('icône', app_id, '<-', ico, best)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--app':
        app_icon(sys.argv[2], sys.argv[3])
    else:
        big = hub()
        big.resize((512, 512), Image.LANCZOS).save(ROOT / 'ui' / 'icons' / 'seventh-os.png')
        big.save(ROOT / 'build' / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        print('build/icon.ico + ui/icons/seventh-os.png')
