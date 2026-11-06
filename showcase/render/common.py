"""Shared drawing helpers for League of AI x Experience Atlas showcase cards (1920x1080)."""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SHOWCASE = ROOT / "showcase"
BRAND = ROOT / "assets" / "brand"

W, H = 1920, 1080

NAVY = (6, 14, 32)
OCEAN = (26, 62, 104)
AMBER = (214, 140, 76)
GOLD = (200, 155, 80)
CHAMPAGNE = (246, 230, 192)
MIST = (196, 214, 232)
SLATE = (128, 150, 178)

CREDIT = "League of AI — Gabriel González Pineda & Leonardo Eleuteri"

_DIDOT = "/System/Library/Fonts/Supplemental/Didot.ttc"
_AVENIR = "/System/Library/Fonts/Avenir Next.ttc"
_AVENIR_IDX = {"bold": 0, "demi": 2, "italic": 4, "medium": 5, "regular": 7, "heavy": 8, "light": 10}
_DIDOT_IDX = {"regular": 0, "italic": 1, "bold": 2}


def didot(size, style="regular"):
    return ImageFont.truetype(_DIDOT, size, index=_DIDOT_IDX[style])


def avenir(size, style="regular"):
    return ImageFont.truetype(_AVENIR, size, index=_AVENIR_IDX[style])


def background(seed=7, glows=None):
    """Navy base, ocean radial glow, optional amber glow, faint atlas grid, stars and vignette."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img = np.zeros((H, W, 3), np.float32) + np.array(NAVY, np.float32)
    glows = glows or [((1450, 260), 1250, OCEAN, 0.95), ((260, 980), 900, AMBER, 0.16)]
    for (cx, cy), r, col, strength in glows:
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
        a = np.clip(1 - d, 0, 1) ** 2 * strength
        img = img * (1 - a[..., None]) + np.array(col, np.float32) * a[..., None]
    d = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.62)) ** 2)
    img *= np.clip(1.12 - 0.45 * d**2, 0.55, 1.0)[..., None]
    base = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB").convert("RGBA")

    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(grid)
    cx, cy = W * 0.72, H * 1.35
    for i in range(1, 14):
        r = i * 140
        g.ellipse([cx - r * 1.6, cy - r, cx + r * 1.6, cy + r], outline=GOLD + (16,), width=1)
    for k in range(-8, 9):
        x = cx + k * 190
        g.line([(cx, cy), (x * 1.0, -200)], fill=GOLD + (10,), width=1)
    rng = np.random.default_rng(seed)
    for _ in range(170):
        x, y = rng.integers(0, W), rng.integers(0, H)
        s = rng.choice([1, 1, 1, 2])
        g.ellipse([x, y, x + s, y + s], fill=CHAMPAGNE + (int(rng.integers(25, 90)),))
    return Image.alpha_composite(base, grid)


def overlay(canvas, draw_fn):
    """Draw semi-transparent shapes on a separate layer and blend them (ImageDraw on RGBA does not blend)."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return Image.alpha_composite(canvas, layer)


def glow(canvas, box, color, radius=60, alpha=110, shape="ellipse"):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if shape == "ellipse":
        d.ellipse(box, fill=color + (alpha,))
    else:
        d.rounded_rectangle(box, radius=40, fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    return Image.alpha_composite(canvas, layer)


def glass_panel(canvas, box, radius=34, fill_alpha=92, border=GOLD, border_alpha=90, shadow=True):
    if shadow:
        sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        x0, y0, x1, y1 = box
        ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + 18, x1, y1 + 18], radius=radius, fill=(0, 0, 0, 120))
        canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(28)))
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=OCEAN + (fill_alpha,))
    # top sheen
    x0, y0, x1, y1 = box
    sheen = Image.new("L", (x1 - x0, y1 - y0), 0)
    arr = np.linspace(38, 0, y1 - y0, dtype=np.float32)[:, None].repeat(x1 - x0, 1)
    sheen = Image.fromarray(arr.astype(np.uint8), "L")
    mask = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, x1 - x0 - 1, y1 - y0 - 1], radius=radius, fill=255)
    white = Image.new("RGBA", (x1 - x0, y1 - y0), MIST + (0,))
    white.putalpha(Image.fromarray((np.asarray(sheen, np.float32) * np.asarray(mask, np.float32) / 255).astype(np.uint8)))
    layer.alpha_composite(white, (x0, y0))
    d.rounded_rectangle(box, radius=radius, outline=border + (border_alpha,), width=2)
    return Image.alpha_composite(canvas, layer)


def gradient_text(canvas, xy, text, font, top=CHAMPAGNE, bottom=AMBER, anchor="la", glow_color=AMBER, glow_alpha=90):
    """Text filled with a vertical gradient plus a soft glow."""
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=font, fill=255, anchor=anchor)
    bbox = mask.getbbox()
    if not bbox:
        return canvas
    if glow_alpha:
        gl = Image.new("RGBA", canvas.size, glow_color + (0,))
        gl.putalpha(mask.filter(ImageFilter.GaussianBlur(18)).point(lambda v: v * glow_alpha // 255))
        canvas = Image.alpha_composite(canvas, gl)
    y0, y1 = bbox[1], bbox[3]
    t = np.clip((np.arange(H) - y0) / max(1, y1 - y0), 0, 1)[:, None, None]
    grad = (np.array(top) * (1 - t) + np.array(bottom) * t).repeat(W, 1)
    fill = Image.fromarray(grad.astype(np.uint8), "RGB").convert("RGBA")
    fill.putalpha(mask)
    return Image.alpha_composite(canvas, fill)


def spaced(draw, xy, text, font, fill, tracking=4, anchor_right=False):
    """Letter-spaced small caps style label. Returns end x."""
    x, y = xy
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    if anchor_right:
        x -= total
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking
    return x


def atlas_icon(size):
    """Experience Atlas icon with its white rounded corners cropped (rounded-square alpha mask)."""
    im = Image.open(BRAND / "experience-atlas" / "experience-atlas-icon.png").convert("RGB")
    n = im.size[0]
    # find the corner radius: first non-white pixel along the diagonal
    d = next(i for i in range(n // 2) if sum(im.getpixel((i, i))) < 600)
    r = int(d / (1 - 2**-0.5)) + 6
    inset = 6
    big = Image.new("L", (n * 4, n * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle([inset * 4, inset * 4, (n - inset) * 4, (n - inset) * 4], radius=r * 4, fill=255)
    mask = big.resize((n, n), Image.LANCZOS)
    out = im.convert("RGBA")
    out.putalpha(mask)
    out = out.crop((inset, inset, n - inset, n - inset))
    return out.resize((size, size), Image.LANCZOS)


def crest(size):
    im = Image.open(BRAND / "league-of-ai" / "league-of-ai-crest.png").convert("RGBA")
    return im.resize((size, size), Image.LANCZOS)


def footer(canvas, left=CREDIT, right="Munich Day 2 Hackathon", y=H - 70):
    canvas = overlay(canvas, lambda o: o.line([(100, y - 26), (W - 100, y - 26)], fill=GOLD + (70,), width=1))
    d = ImageDraw.Draw(canvas)
    d.text((100, y), left, font=avenir(24, "medium"), fill=CHAMPAGNE)
    d.text((W - 100, y), right, font=avenir(22, "regular"), fill=SLATE, anchor="ra")
    return canvas


def cover(im, size, focus=(0.5, 0.5)):
    """Crop-to-fill an image into size=(w, h) around a focal point (fractions)."""
    w, h = size
    s = max(w / im.width, h / im.height)
    r = im.resize((max(w, round(im.width * s)), max(h, round(im.height * s))), Image.LANCZOS)
    x = int(min(max(r.width * focus[0] - w / 2, 0), r.width - w))
    y = int(min(max(r.height * focus[1] - h / 2, 0), r.height - h))
    return r.crop((x, y, x + w, y + h))


def rounded(im, radius):
    im = im.convert("RGBA")
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=radius, fill=255)
    im.putalpha(m)
    return im


def orb(canvas, center, r, color=AMBER, core=CHAMPAGNE, intensity=1.0):
    """A glowing agent orb: outer bloom, radial body, bright core."""
    cx, cy = center
    canvas = glow(canvas, (cx - r * 1.9, cy - r * 1.9, cx + r * 1.9, cy + r * 1.9), color, radius=r * 0.8,
                  alpha=int(120 * intensity))
    size = int(r * 2)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    d = np.sqrt((xx - r * 0.82) ** 2 + (yy - r * 0.78) ** 2) / r
    t = np.clip(d, 0, 1)[..., None]
    body = np.array(core, np.float32) * (1 - t) + np.array(color, np.float32) * t
    body = body * (1 - 0.35 * np.clip(d - 0.7, 0, 1)[..., None])
    im = Image.fromarray(np.clip(body, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    im.putalpha(m.resize((size, size), Image.LANCZOS))
    canvas.alpha_composite(im, (int(cx - r), int(cy - r)))
    return canvas
