"""'Local insider tip' cards: a full-bleed demo-media photo with its Commons credit printed on the card.
Facts: fixtures/demo-media/demo-media.json (place, kind, parent, photo author and licence);
docs/adrs/001-travel-swarm-architecture.md (Local Insider charter).
Usage: python insider_tip.py <calendar-id> <place-id> <photo-index> <downloaded-photo.jpg> [focus-x focus-y]
The photo must be the demo-media `url` for that index, downloaded into an isolated directory.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import numpy as np
from PIL import Image, ImageDraw

from common import (AMBER, CHAMPAGNE, GOLD, MIST, ROOT, SHOWCASE, W, H, atlas_icon, avenir, cover,
                    didot, gradient_text, overlay, spaced)

SUBTITLE = {  # parent and scenario wording, from the place's parent_id and scenario fields
    "komiza-hr": "Island of Vis, Croatia",
    "graca-pt": "Lisbon, Portugal",
    "yanaka-jp": "Tokyo, Japan",
    "shimokitazawa-jp": "Tokyo, Japan",
    "gotokuji-jp": "Tokyo, Japan",
}
SCENARIO = {"sailing-europe": "Sailing Europe", "tokyo-japan": "Tokyo & Japan", "lisbon-work-trip": "Lisbon work trip"}


def main(cid, place_id, idx, photo_path, focus=(0.5, 0.5)):
    places = {p["id"]: p for p in json.loads((ROOT / "fixtures/demo-media/demo-media.json").read_text())["places"]}
    p = places[place_id]
    ph = p["photos"][idx]
    kind_label = "LOCAL INSIDER TIP" if p["kind"] == "insider" else "NEIGHBOURHOOD PICK"
    slug = place_id.rsplit("-", 1)[0]

    base = cover(Image.open(photo_path).convert("RGB"), (W, H), focus).convert("RGBA")
    # legibility: left-to-right navy wash plus a bottom fade
    xx = np.linspace(1, 0, W, dtype=np.float32)
    yy = np.linspace(0, 1, H, dtype=np.float32)
    a = np.clip(xx[None, :] * 1.6 - 0.5, 0, 0.86) + np.clip((yy[:, None] - 0.8) * 3.0, 0, 0.6)
    wash = Image.new("RGBA", (W, H), (6, 14, 32, 0))
    wash.putalpha(Image.fromarray((np.clip(a, 0, 0.92) * 255).astype(np.uint8), "L"))
    c = Image.alpha_composite(base, wash)

    mx = 110
    c.alpha_composite(atlas_icon(72), (mx, 92))
    d = ImageDraw.Draw(c)
    spaced(d, (mx + 96, 104), "EXPERIENCE ATLAS", avenir(20, "demi"), CHAMPAGNE, tracking=5)
    spaced(d, (mx + 96, 136), kind_label, avenir(20, "demi"), AMBER, tracking=5)

    c = gradient_text(c, (mx - 6, 300), p["name"], didot(150), top=CHAMPAGNE, bottom=(236, 200, 140), glow_alpha=60)
    d = ImageDraw.Draw(c)
    d.text((mx, 500), SUBTITLE.get(place_id, p["country"]), font=avenir(40, "medium"), fill=MIST)

    c = overlay(c, lambda o: o.line([(mx, 600), (mx + 90, 600)], fill=GOLD + (220,), width=3))
    d = ImageDraw.Draw(c)
    d.text((mx, 630), "“What isn’t easily found,", font=didot(46, "italic"), fill=CHAMPAGNE)
    d.text((mx, 690), "a local’s rhythm, no tourist lens.”", font=didot(46, "italic"), fill=CHAMPAGNE)
    d.text((mx, 768), "The Local Insider agent’s brief", font=avenir(24, "regular"), fill=MIST)

    chip = f"In the {SCENARIO[p['scenario'][0]]} demo  ·  real photos & video"
    f = avenir(21, "demi")
    tw = d.textlength(chip, font=f)
    c = overlay(c, lambda o: o.rounded_rectangle([mx, 832, mx + tw + 40, 874], radius=21, fill=(214, 140, 76, 60),
                                                 outline=GOLD + (170,), width=2))
    d = ImageDraw.Draw(c)
    d.text((mx + 20, 853), chip, font=f, fill=CHAMPAGNE, anchor="lm")

    # footer: team credit left, photo credit right (on the photo)
    d.text((mx, H - 56), "League of AI — Gabriel González Pineda & Leonardo Eleuteri", font=avenir(24, "medium"),
           fill=CHAMPAGNE)
    credit = f"Photo: {ph['author']} · {ph['license']} · Wikimedia Commons (cropped)"
    d.text((W - 60, H - 52), credit, font=avenir(20, "medium"), fill=(240, 244, 250), anchor="ra")

    out = SHOWCASE / f"{cid}-insider-{slug}.png"
    c.convert("RGB").save(out, optimize=True)
    print(out, "|", ph["source_page"])


if __name__ == "__main__":
    args = sys.argv[1:]
    focus = (float(args[4]), float(args[5])) if len(args) >= 6 else (0.5, 0.5)
    main(args[0], args[1], int(args[2]), args[3], focus)
