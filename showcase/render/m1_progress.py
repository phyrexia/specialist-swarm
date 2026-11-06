"""M1: Progress #1, the swarm is alive. Every number comes from repo evidence:
- docs/research/2026-11-06-managed-agents-spike.md (3 live runs; medians)
- docs/research/2026-11-06-openai-realtime-events.md (live API probe, section 0)
- fixtures/demo-media/README.md (43 places, 215 photos, 81 videos, all links checked)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import ImageDraw

from common import (AMBER, CHAMPAGNE, GOLD, MIST, SHOWCASE, SLATE, W, H, atlas_icon,
                    avenir, background, didot, footer, glass_panel, glow, gradient_text, spaced)

TILES = [
    # (big value, label, detail lines)
    (("~1", " s"), "First agent event", ["The swarm wakes and starts streaming", "(median 1.0 s over 3 live runs)"]),
    (("~15", " s"), "Itinerary ready", ["A coordinator plus parallel specialists", "deliver the plan (median 15.2 s)"]),
    (("3/3", " runs"), "Remembers you", ["A brand-new conversation recalled your", "travel preferences in 3 of 3 runs"]),
    (("Realtime", ""), "Voice with VAD + barge-in", ["OpenAI Realtime session with semantic VAD and",
                                              "interrupt-on-speech, accepted by the live API"]),
    (("43 · 215 · 81", ""), "Real places · photos · videos", ["Curated from Wikimedia Commons and YouTube,",
                                                       "every link checked, credits kept"]),
]


def tile(c, box, value, label, detail, big=118):
    c = glass_panel(c, box, fill_alpha=84)
    x0, y0, x1, y1 = box
    px = x0 + 44
    num, unit = value
    fnum = avenir(big, "medium")
    base_y = y0 + 44 + big  # shared baseline for number and unit
    c = gradient_text(c, (px - 4, base_y), num, fnum, top=CHAMPAGNE, bottom=AMBER, anchor="ls", glow_alpha=80)
    d = ImageDraw.Draw(c)
    if unit:
        ux = px - 4 + d.textlength(num, font=fnum)
        d.text((ux, base_y), unit, font=avenir(big * 2 // 5, "medium"), fill=GOLD, anchor="ls")
    ly = y1 - 132
    d.text((px, ly), label, font=avenir(32, "demi"), fill=CHAMPAGNE)
    for i, line in enumerate(detail):
        d.text((px, ly + 48 + i * 32), line, font=avenir(23, "regular"), fill=MIST)
    return c


def main():
    c = background(seed=3, glows=[((1500, 120), 1250, (26, 62, 104), 0.95), ((160, 120), 700, AMBER, 0.14)])
    mx = 100

    ic = atlas_icon(116)
    c = glow(c, (mx, 64, mx + 116, 180), AMBER, radius=30, alpha=80, shape="rect")
    c.alpha_composite(ic, (mx, 64))
    d = ImageDraw.Draw(c)
    spaced(d, (mx + 146, 74), "EXPERIENCE ATLAS  ·  PROGRESS #1", avenir(22, "demi"), AMBER, tracking=5)
    c = gradient_text(c, (mx + 142, 104), "The swarm is alive", didot(74), top=CHAMPAGNE, bottom=(236, 200, 140),
                      glow_alpha=45)
    d = ImageDraw.Draw(c)
    d.text((W - mx, 82), "Measured on the live Claude Managed Agents API", font=avenir(22, "medium"),
           fill=MIST, anchor="ra")
    d.text((W - mx, 116), "3 full runs · 2026-11-06 · medians", font=avenir(22, "regular"), fill=SLATE, anchor="ra")

    top, gap = 232, 32
    inner = W - 2 * mx
    h1, h2 = 350, 330
    w3 = (inner - 2 * gap) // 3
    for i in range(3):
        x0 = mx + i * (w3 + gap)
        c = tile(c, (x0, top, x0 + w3, top + h1), *TILES[i])
    w2 = (inner - gap) // 2
    y2 = top + h1 + gap
    for i in range(2):
        x0 = mx + i * (w2 + gap)
        c = tile(c, (x0, y2, x0 + w2, y2 + h2), *TILES[3 + i], big=100)

    c = footer(c, right="Munich Day 2 Hackathon · Your AI travel companion", y=H - 56)
    out = SHOWCASE / "m1-progress.png"
    c.convert("RGB").save(out, optimize=True)
    print(out, c.size)


if __name__ == "__main__":
    main()
