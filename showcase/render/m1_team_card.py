"""M1: League of AI x Experience Atlas team card with scannable LinkedIn QR codes."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import qrcode
from PIL import Image, ImageDraw

from common import (AMBER, CHAMPAGNE, GOLD, MIST, NAVY, SHOWCASE, SLATE, W, H,
                    atlas_icon, avenir, background, crest, didot, footer, glass_panel,
                    glow, gradient_text, overlay, spaced)

MEMBERS = [
    ("Gabriel", "González Pineda", "https://www.linkedin.com/in/gabrielgonzalezpineda",
     "linkedin.com/in/gabrielgonzalezpineda"),
    ("Leonardo", "Eleuteri", "https://www.linkedin.com/in/leonardo-eleuteri/",
     "linkedin.com/in/leonardo-eleuteri"),
]


def qr_tile(url, box=9):
    qr = qrcode.QRCode(version=4, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=box, border=4)
    qr.add_data(url)
    qr.make(fit=False)
    return qr.make_image(fill_color=NAVY, back_color=(255, 255, 255)).convert("RGBA")


def main():
    c = background(seed=11, glows=[((1500, 300), 1300, (26, 62, 104), 0.95), ((330, 330), 620, AMBER, 0.20)])

    # ---------- left column: brand ----------
    lx = 110
    c = glow(c, (lx + 10, 60, lx + 330, 380), AMBER, radius=70, alpha=70)
    c.alpha_composite(crest(320), (lx, 60))
    d = ImageDraw.Draw(c)
    d.text((lx + 352, 220), "×", font=didot(64), fill=GOLD, anchor="mm")
    ic = atlas_icon(200)
    c = glow(c, (lx + 390, 120, lx + 590, 320), AMBER, radius=40, alpha=80, shape="rect")
    c.alpha_composite(ic, (lx + 390, 120))

    c = gradient_text(c, (lx, 430), "League of AI", didot(96), top=CHAMPAGNE, bottom=(232, 196, 140), glow_alpha=50)
    c = gradient_text(c, (lx, 545), "× Experience Atlas", didot(64), top=(236, 190, 120), bottom=AMBER, glow_alpha=70)
    d = ImageDraw.Draw(c)
    d.text((lx, 650), "Your AI travel companion", font=avenir(34, "medium"), fill=CHAMPAGNE)
    for i, line in enumerate(["A swarm of Claude agents that plans your trip,",
                              "with voice, photos, video and memory."]):
        d.text((lx, 712 + i * 38), line, font=avenir(25, "regular"), fill=MIST)
    # event chip
    chip_txt = "MUNICH DAY 2 HACKATHON"
    f = avenir(18, "demi")
    tw = sum(d.textlength(ch, font=f) for ch in chip_txt) + 3 * (len(chip_txt) - 1)
    c = overlay(c, lambda o: o.rounded_rectangle([lx, 822, lx + tw + 44, 866], radius=22,
                                                 fill=(214, 140, 76, 38), outline=GOLD + (150,), width=2))
    d = ImageDraw.Draw(c)
    spaced(d, (lx + 22, 832), chip_txt, f, AMBER, tracking=3)

    # ---------- right column: members ----------
    rx0, rx1 = 790, 1810
    d = ImageDraw.Draw(c)
    end = spaced(d, (rx0, 62), "SCAN TO CONNECT", avenir(26, "demi"), AMBER, tracking=6)
    c = overlay(c, lambda o: o.line([(end + 24, 78), (rx1, 78)], fill=GOLD + (90,), width=2))
    d = ImageDraw.Draw(c)
    d.text((rx1, 96), "Point your phone camera at a code", font=avenir(20, "regular"), fill=SLATE, anchor="ra")

    ph, gap, top = 396, 28, 136
    for i, (first, last, url, handle) in enumerate(MEMBERS):
        y0 = top + i * (ph + gap)
        c = glass_panel(c, (rx0, y0, rx1, y0 + ph))
        tile = qr_tile(url)
        ts = tile.size[0]
        tx, ty = rx0 + 26, y0 + (ph - ts) // 2
        c = glow(c, (tx, ty, tx + ts, ty + ts), CHAMPAGNE, radius=26, alpha=70, shape="rect")
        m = Image.new("L", tile.size, 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, ts - 1, ts - 1], radius=18, fill=255)
        tile.putalpha(m)
        c.alpha_composite(tile, (tx, ty))

        x = tx + ts + 54
        d = ImageDraw.Draw(c)
        spaced(d, (x, y0 + 62), "LEAGUE OF AI", avenir(19, "demi"), AMBER, tracking=5)
        c = gradient_text(c, (x - 2, y0 + 96), first, didot(70), top=CHAMPAGNE, bottom=(236, 206, 150), glow_alpha=35)
        c = gradient_text(c, (x - 2, y0 + 176), last, didot(70), top=CHAMPAGNE, bottom=(236, 206, 150), glow_alpha=35)
        # LinkedIn badge + handle
        by = y0 + 300
        c = overlay(c, lambda o: o.rounded_rectangle([x, by, x + 40, by + 40], radius=8, fill=GOLD + (255,)))
        d = ImageDraw.Draw(c)
        d.text((x + 20, by + 21), "in", font=avenir(25, "bold"), fill=NAVY, anchor="mm")
        d.text((x + 56, by + 5), handle, font=avenir(25, "medium"), fill=MIST)

    c = footer(c, right="Experience Atlas · built with Claude", y=H - 56)
    out = SHOWCASE / "m1-team-card.png"
    c.convert("RGB").save(out, optimize=True)
    print(out, c.size)


if __name__ == "__main__":
    main()
