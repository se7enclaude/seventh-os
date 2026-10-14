"""Seventh OS — icônes.
  build/icon.ico            : icône du hub (« 7 » blanc sur verre teal / rose, trois points = les applis), 16 à 256 px
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


APP_DOTS = [(237, 47, 47), (205, 222, 224), (212, 245, 60)]  # se7en Download, se7en IA, se7en DualSense


def _seven(S, scale=1.0, dy=0.0):
    """« 7 » épais dessiné à la main (même tracé que les icônes des applis se7en)."""
    m = Image.new('L', (S, S), 0)
    top, bar, x0, x1, leg, bottom = 0.25 * S, 0.17 * S, 0.24 * S, 0.78 * S, 0.20 * S, 0.79 * S
    pts = [(x0, top), (x1, top), (x1, top + bar * 0.95), (0.52 * S, bottom), (0.52 * S - leg, bottom), (x1 - leg * 1.08, top + bar), (x0, top + bar)]
    c = S / 2
    ImageDraw.Draw(m).polygon([((x - c) * scale + c, (y - c) * scale + c + dy) for x, y in pts], fill=255)
    return m


def _blob(S, cx, cy, r, col, alpha):
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((cx - r, cy - r, cx + r, cy + r), fill=col + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(r * 0.55))


def hub(size=1024, dots=True):
    """Le hub : verre teal profond éclairé de rose poudré (Studio Glass), « 7 » blanc,
    et trois points aux couleurs des applis qu'il réunit (rouge, argent, citron)."""
    S = size * 2
    bg = Image.new('RGBA', (S, S))
    g = ImageDraw.Draw(bg)
    for y in range(S):
        g.line([(0, y), (S, y)], fill=lerp((38, 70, 78), (14, 30, 35), y / S) + (255,))
    for layer in (_blob(S, S * 0.82, S * 0.16, S * 0.46, (246, 206, 200), 215), _blob(S, S * 0.98, S * 0.62, S * 0.30, (233, 161, 154), 150),
                  _blob(S, S * 0.12, S * 0.92, S * 0.46, (127, 167, 172), 170)):
        bg = Image.alpha_composite(bg, layer)
    # « 7 » : remonté pour laisser la place aux points, centré et plus grand sans eux
    seven = _seven(S, scale=0.92, dy=-S * 0.035) if dots else _seven(S, scale=1.08, dy=S * 0.0)
    bg = Image.composite(Image.new('RGBA', (S, S), (255, 255, 255, 255)), bg, seven)
    if dots:
        d = ImageDraw.Draw(bg)
        r, cy = S * 0.038, S * 0.84
        for i, col in enumerate(APP_DOTS):
            cx = S / 2 + (i - 1) * S * 0.12
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col + (255,))
    # Reflet de verre en diagonale, liseré clair
    sheen = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    for i in range(S):
        sd.line([(i, 0), (0, i)], fill=(255, 255, 255, int(70 * max(0, 1 - i / S / 0.55) ** 1.6)), width=2)
    bg = Image.alpha_composite(bg, sheen)
    ImageDraw.Draw(bg).rounded_rectangle((2, 2, S - 3, S - 3), radius=int(S * 0.2), outline=(255, 255, 255, 70), width=max(2, S // 120))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.2), fill=255)
    out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


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
        hub(512).save(ROOT / 'ui' / 'icons' / 'seventh-os.png')
        sizes = [16, 24, 32, 48, 64, 128, 256]
        # chaque taille dessinée à part : sans les points sous 48 px, où ils deviendraient du bruit
        frames = [hub(n, dots=n >= 48) for n in sizes]
        frames[-1].save(ROOT / 'build' / 'icon.ico', sizes=[(n, n) for n in sizes], append_images=frames[:-1])
        print('build/icon.ico + ui/icons/seventh-os.png')
