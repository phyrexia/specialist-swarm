"""C01 poll card: Hvar vs Naxos vs La Maddalena for a family sailing week.
Facts: fixtures/demo-media/demo-media.json (places, sailing-day experiences, photo credits).
Usage: python c01_poll.py <hvar.jpg> <naxos.jpg> <maddalena.jpg>
(the photos are the demo-media `url` thumbnails, downloaded into an isolated directory)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import numpy as np
from PIL import Image, ImageDraw, ImageChops

from common import (AMBER, CHAMPAGNE, GOLD, MIST, NAVY, SHOWCASE, SLATE, W, H, atlas_icon, avenir,
                    background, cover, didot, footer, glow, gradient_text, overlay, rounded, spaced)

OPTIONS = [  # letter, place, country, sailing-day experience, credit, focus
    ("A", "Hvar", "Croatia", "Pakleni Islands", "Carsten Steger · CC BY-SA 4.0", (0.42, 0.5)),
    ("B", "Naxos", "Greece", "Portara, Temple of Apollo", "Jules Verne Times Two · CC BY-SA 4.0", (0.40, 0.5)),
    ("C", "La Maddalena", "Italy", "Budelli pink beach by boat", "Eppa00 · CC0", (0.55, 0.5)),
]


def main(paths):
    c = background(seed=21, glows=[((960, 0), 1200, (26, 62, 104), 0.9), ((960, 1080), 900, AMBER, 0.10)])
    mx = 100
    c.alpha_composite(atlas_icon(88), (mx, 60))
    d = ImageDraw.Draw(c)
    spaced(d, (mx + 112, 58), "EXPERIENCE ATLAS  ·  QUICK POLL", avenir(21, "demi"), AMBER, tracking=5)
    d.text((W - mx, 70), "A family sailing week in Europe.", font=avenir(28, "medium"), fill=MIST, anchor="ra")
    d.text((W - mx, 108), "Pick one: A, B or C.", font=avenir(28, "demi"), fill=AMBER, anchor="ra")
    c = gradient_text(c, (mx + 108, 82), "Where would the swarm send you?", didot(68), top=CHAMPAGNE,
                      bottom=(236, 200, 140), glow_alpha=45)

    top, gap = 196, 40
    pw = (W - 2 * mx - 2 * gap) // 3
    photo_h = 520
    for i, ((letter, place, country, exp, credit, focus), path) in enumerate(zip(OPTIONS, paths)):
        x0 = mx + i * (pw + gap)
        # card shadow + frame
        c = glow(c, (x0 + 10, top + 30, x0 + pw - 10, top + photo_h + 250), (0, 0, 0), radius=30, alpha=150,
                 shape="rect")
        c = overlay(c, lambda o: o.rounded_rectangle([x0, top, x0 + pw, top + photo_h + 236], radius=30,
                                                     fill=(26, 62, 104, 110), outline=GOLD + (110,), width=2))
        ph = cover(Image.open(path).convert("RGB"), (pw - 20, photo_h), focus)
        c.alpha_composite(rounded(ph, 22), (x0 + 10, top + 10))
        # bottom fade on the photo for the credit
        ramp = np.linspace(0, 170, 70, dtype=np.float32)[:, None].repeat(pw - 20, 1).astype(np.uint8)
        corners = rounded(Image.new("RGB", (pw - 20, photo_h)), 22).getchannel("A").crop((0, photo_h - 70, pw - 20, photo_h))
        fade = Image.new("RGBA", (pw - 20, 70), NAVY + (0,))
        fade.putalpha(ImageChops.darker(Image.fromarray(ramp, "L"), corners))
        c.alpha_composite(fade, (x0 + 10, top + 10 + photo_h - 70))
        d = ImageDraw.Draw(c)
        d.text((x0 + pw - 26, top + photo_h - 6), f"Photo: {credit}",
               font=avenir(16, "regular"), fill=(230, 236, 244), anchor="rs")
        # letter badge
        bx, by = x0 + 46, top + 54
        c = glow(c, (bx - 40, by - 40, bx + 40, by + 40), AMBER, radius=18, alpha=120)
        c = overlay(c, lambda o: o.ellipse([bx - 32, by - 32, bx + 32, by + 32], fill=GOLD + (255,),
                                           outline=CHAMPAGNE + (255,), width=2))
        d = ImageDraw.Draw(c)
        d.text((bx, by + 2), letter, font=avenir(36, "bold"), fill=NAVY, anchor="mm")
        # text block
        ty = top + photo_h + 28
        d = ImageDraw.Draw(c)
        spaced(d, (x0 + 34, ty), country.upper(), avenir(17, "demi"), SLATE, tracking=5)
        c = gradient_text(c, (x0 + 32, ty + 22), place, didot(62), top=CHAMPAGNE, bottom=(236, 206, 150), glow_alpha=30)
        d = ImageDraw.Draw(c)
        spaced(d, (x0 + 34, ty + 112), "ON THE SWARM'S LIST", avenir(17, "demi"), AMBER, tracking=4)
        d.text((x0 + 34, ty + 138), exp, font=avenir(28, "medium"), fill=MIST)

    c = footer(c, right="Photos: Wikimedia Commons, cropped · real places from the Experience Atlas demo set", y=H - 56)
    out = SHOWCASE / "c01-poll-sailing.png"
    c.convert("RGB").save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1:4])
