"""'Meet the swarm' cards, one per agent. Roles, models and tools come from the agent table in
docs/adrs/001-travel-swarm-architecture.md; the personality line is playful copy, and every hard claim is from the ADR.
Usage: python meet_swarm.py <key> <calendar-id>   e.g.  python meet_swarm.py architect c02
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import ImageDraw

from common import (AMBER, CHAMPAGNE, GOLD, MIST, SHOWCASE, SLATE, W, H, atlas_icon, avenir, background,
                    didot, footer, glass_panel, gradient_text, orb, overlay, spaced)

ORDER = ["architect", "insider", "scout", "flights", "stays", "experiences"]  # calendar order
SHORT = {"architect": "Architect", "scout": "Scout", "flights": "Flights", "stays": "Stays",
         "experiences": "Experiences", "insider": "Insider"}
AGENTS = {
    "architect": dict(name="Trip Architect", role="The coordinator", model="claude-sonnet-5-5",
                      personality="The calm conductor.",
                      power=["Sends five specialists out in parallel,", "then builds a schedule that respects",
                             "your flight times."],
                      tools=["present_itinerary", "read", "glob"],
                      fact="Measured live: specialist threads spawn 0.15–0.3 s apart"),
    "insider": dict(name="Local Insider", role="The secret sauce", model="claude-sonnet-5-5",
                    personality="Allergic to tourist traps.",
                    power=["Finds what isn't easily found,", "at a local's rhythm, with no tourist lens."],
                    tools=["web_search ≤2/turn", "web_fetch ≤1/turn", "find_media"],
                    fact="Tourist aggregators are on its blocked-domains list"),
    "scout": dict(name="Destinations & Seasons", role="The scout", model="claude-sonnet-5-5",
                  personality="Always checks the sky first.",
                  power=["Turns what you want to do into places,", "route order, best dates and weather."],
                  tools=["get_climate", "find_media", "web_search ≤1/turn"],
                  fact="Starts from your goal, not from a destination"),
    "flights": dict(name="Flight Finder", role="The route nerd", model="claude-haiku-5-5",
                    personality="Lives for a good open-jaw.",
                    power=["Combinations, connection times,", "cheapest vs best, best day to fly."],
                    tools=["search_flights", "publish_finding"],
                    fact="Layovers of 45–180 min through real carrier hubs (simulated inventory)"),
    "stays": dict(name="Stay Matcher", role="The host whisperer", model="claude-haiku-5-5",
                  personality="Reads the room before booking it.",
                  power=["A hotel, apartment, villa, boat or ryokan", "that fits the party and their character."],
                  tools=["search_stays", "find_media", "publish_finding"],
                  fact="Room configurations come from the party size"),
    "experiences": dict(name="Experience Curator", role="The day-maker", model="claude-haiku-5-5",
                        personality="Knows the age limits by heart.",
                        power=["Free tours, paragliding, diving, sailing days,", "fitted to the time of day."],
                        tools=["search_experiences", "find_media", "publish_finding"],
                        fact="Every experience carries real time slots and a min_age"),
}


def constellation(c, cx, cy, key):
    """Trip Architect in the middle, five specialists around it. The featured agent glows."""
    specialists = [k for k in ORDER if k != "architect"]
    R = 250
    pos = {"architect": (cx, cy)}
    for i, k in enumerate(specialists):
        a = -math.pi / 2 + i * 2 * math.pi / 5
        pos[k] = (cx + R * math.cos(a), cy + R * math.sin(a))

    def radius(k):
        if k == "architect":
            return 92
        return 62 if k == key else 50

    def links(o):
        ra = radius("architect")
        for k in specialists:
            (x, y), rk = pos[k], radius(k)
            dx, dy = x - cx, y - cy
            L = math.hypot(dx, dy)
            ux, uy = dx / L, dy / L
            o.line([(cx + ux * (ra + 8), cy + uy * (ra + 8)), (x - ux * (rk + 8), y - uy * (rk + 8))],
                   fill=GOLD + (150 if key in ("architect", k) else 55,), width=3)
        o.ellipse([cx - R, cy - R, cx + R, cy + R], outline=GOLD + (34,), width=2)
    c = overlay(c, links)
    for k, (x, y) in pos.items():
        feat = key in (k, "architect") if k != "architect" else True
        hot = k == key
        r = radius(k)
        if hot or k == "architect":
            c = orb(c, (x, y), r, intensity=1.0 if hot else 0.75)
        elif feat:
            c = orb(c, (x, y), r, color=(176, 120, 70), core=(232, 200, 150), intensity=0.55)
        else:
            c = orb(c, (x, y), r, color=(26, 62, 104), core=(96, 128, 168), intensity=0.25)
            c = overlay(c, lambda o, x=x, y=y, r=r: o.ellipse([x - r, y - r, x + r, y + r], outline=GOLD + (90,), width=2))
        d = ImageDraw.Draw(c)
        if k == "architect":
            d.text((x, y + 2), "Architect", font=avenir(26, "demi"), fill=(6, 14, 32), anchor="mm")
            continue
        ux, uy = (x - cx) / R, (y - cy) / R
        lx, ly = x + ux * (r + 34), y + uy * (r + 30)
        anchor = "mm" if abs(ux) < 0.3 else ("lm" if ux > 0 else "rm")
        if abs(ux) >= 0.3:
            lx, ly = x + ux * (r + 18), y + uy * (r + 18) + 4
        d.text((lx, ly), SHORT[k], font=avenir(26 if hot else 22, "demi" if hot else "medium"),
               fill=CHAMPAGNE if hot else (MIST if feat else SLATE), anchor=anchor)
    return c


def main(key, cid):
    a = AGENTS[key]
    n = ORDER.index(key) + 1
    c = background(seed=40 + n, glows=[((520, 540), 900, (26, 62, 104), 0.95), ((520, 540), 520, AMBER, 0.12)])
    c = constellation(c, 520, 540, key)

    x = 1000
    d = ImageDraw.Draw(c)
    c.alpha_composite(atlas_icon(64), (x, 92))
    d = ImageDraw.Draw(c)
    spaced(d, (x + 84, 112), f"MEET THE SWARM  ·  #{n} OF 6", avenir(22, "demi"), AMBER, tracking=5)
    size = 92 if len(a["name"]) <= 16 else 70
    c = gradient_text(c, (x - 4, 180), a["name"], didot(size), top=CHAMPAGNE, bottom=(236, 200, 140), glow_alpha=45)
    d = ImageDraw.Draw(c)
    d.text((x, 300), a["role"], font=avenir(34, "medium"), fill=AMBER)
    # model chip
    chip = a["model"]
    f = avenir(22, "demi")
    tw = d.textlength(chip, font=f)
    cx0 = x + d.textlength(a["role"], font=avenir(34, "medium")) + 28
    c = overlay(c, lambda o: o.rounded_rectangle([cx0, 302, cx0 + tw + 36, 344], radius=21, fill=(26, 62, 104, 200),
                                                 outline=GOLD + (140,), width=2))
    d = ImageDraw.Draw(c)
    d.text((cx0 + 18, 323), chip, font=f, fill=CHAMPAGNE, anchor="lm")

    d.text((x, 390), f"“{a['personality']}”", font=didot(52, "italic"), fill=CHAMPAGNE)

    c = glass_panel(c, (x, 492, W - 100, 800), fill_alpha=80)
    d = ImageDraw.Draw(c)
    spaced(d, (x + 40, 526), "SUPERPOWER", avenir(19, "demi"), AMBER, tracking=5)
    for i, line in enumerate(a["power"]):
        d.text((x + 40, 566 + i * 44), line, font=avenir(32, "medium"), fill=MIST)
    ty = 566 + len(a["power"]) * 44 + 22
    tx = x + 40
    for t in a["tools"]:
        tf = avenir(19, "medium")
        w = d.textlength(t, font=tf)
        c = overlay(c, lambda o, tx=tx, w=w: o.rounded_rectangle([tx, ty, tx + w + 28, ty + 34], radius=17,
                                                                 fill=(6, 14, 32, 150), outline=SLATE + (120,), width=1))
        d = ImageDraw.Draw(c)
        d.text((tx + 14, ty + 17), t, font=tf, fill=MIST, anchor="lm")
        tx += w + 40
    d.text((x, 836), a["fact"], font=avenir(24, "regular"), fill=SLATE)

    c = footer(c, right="Experience Atlas · Your AI travel companion", y=H - 56)
    out = SHOWCASE / f"{cid}-meet-{key}.png"
    c.convert("RGB").save(out, optimize=True)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
