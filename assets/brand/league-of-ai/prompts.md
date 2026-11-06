# League of AI: image-generation prompts

Model: `gpt-image-2.6-sunburst` (newest `gpt-image*` id returned by `GET /v1/models` on 2026-11-06), endpoint `POST /v1/images/generations`, `quality: high`, `n: 1`.
Generations spent: 2 of 4. Neither prompt was refused and the title rendered cleanly both times, so no retry was needed.

## 1. league-of-ai-banner.png (1536x1024)

```text
Epic wide esports tournament banner illustration. Original design, not based on any existing game's characters or logos.
Six original robotic-arcane "AI champion" figures stand in dramatic backlit silhouette in a semicircle around a towering glowing neural crystal at the center of a circular stone fantasy arena. Each champion is a distinct invented character: a tall commander with a staff whose light threads connect to the crystal (the coordinator), a cloaked explorer with a lantern-like sensor eye, a sleek winged aerial scout, a sturdy armored guardian carrying a shield, a graceful performer holding a ribbon of light, and a hooded local guide holding an unrolled glowing map.
The crystal is a faceted brain-like gem made of light, emitting arcane-blue and teal energy, with glowing circuit-like traces branching across the arena floor toward each champion.
Ornate gold heraldic filigree frames the upper corners; tall hanging banners with abstract geometric sigils; distant stadium lights and a starry night sky.
Palette: deep navy, midnight teal, luminous arcane blue, burnished gold. Cinematic rim lighting, volumetric light rays, floating embers and particles, painterly high-fantasy concept art, sharp detail, premium esports key art.
Title text "LEAGUE OF AI" in large elegant engraved gold serif capital letters centered in the upper third, spelled exactly L-E-A-G-U-E O-F A-I. No other text, no logos, no watermarks.
```

## 2. league-of-ai-team-card.png (1024x1024)

```text
Square esports team profile card. Original design, not based on any existing game's characters or logos.
At the center, a glowing faceted neural crystal shaped like a brain made of light, with circuit traces and arcane-blue and teal energy radiating outward, held inside an ornate gold hexagonal heraldic crest with bevelled filigree and laurel wings.
Six small original gold emblem medallions orbit the crest on a ring of light, linked to it by threads of blue energy: a crown of connected nodes, a compass, a feathered wing, a house key, a theatre star mask, and a map pin.
Background: deep navy to midnight teal gradient, faint circular stone arena and floating arcane particles, soft vignette.
Below the crest, a gold ribbon banner with the text "LEAGUE OF AI" in engraved serif capital letters, spelled exactly L-E-A-G-U-E O-F A-I. No other text, no logos, no watermarks.
Premium symmetrical esports team emblem art, polished metal and light, high detail.
```

## Derived files (no generation)

- `league-of-ai-share.jpg`: banner cropped to 1.905:1 and resized to 1200x630 with Pillow.
- `league-of-ai-square.jpg`: crest PNG composited on a navy-to-teal radial gradient with an arcane-blue glow, 1080x1080.
