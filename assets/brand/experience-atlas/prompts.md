# Experience Atlas: image-generation prompts

Model: `gpt-image-2.6-sunburst`, endpoint `POST /v1/images/generations`, `quality: high`, `n: 1`.
Generations spent: 2 of 3. The hero title rendered cleanly on the first try, so the optional retry was not used.

## 1. experience-atlas-hero.png (1536x1024)

```text
Cinematic, vibrant wide key visual for a premium AI travel app. Original artwork; no real brand logos.
An elegant antique-meets-futuristic world atlas spreads across the lower half of the frame at golden hour: a beautiful map of continents and oceans drawn in fine gold linework on deep ocean-blue paper, softly glowing, with warm sunset light raking across it.
Above the map, five luminous travel "moments" float like glowing postcards or windows of light, each a vivid photographic scene: a sailboat with a family in a turquoise Croatian cove beneath limestone cliffs; a lantern-lit narrow Tokyo alley at dusk; a yellow vintage tram climbing a steep hill in Lisbon; a paraglider soaring over green alpine mountains; a scuba diver gliding over a colorful coral reef.
Five small glowing orbs of light, an AI agent swarm, trace luminous gold and soft cyan light paths between the moments, weaving a single elegant travel route across the atlas, with tiny sparkles along the trail.
Palette: deep ocean blue and navy, warm gold, sunset amber and coral, turquoise sea accents. Premium travel magazine aesthetic, cinematic depth of field, volumetric golden light, refined and modern, not fantasy, not a game.
Title text "EXPERIENCE ATLAS" in large refined modern serif capital letters, white with subtle gold, centered in the upper third with generous clean space around it, spelled exactly E-X-P-E-R-I-E-N-C-E A-T-L-A-S. Directly beneath it, smaller elegant sans-serif text "Your AI travel companion". No other text, no logos, no watermarks.
```

## 2. experience-atlas-icon.png (1024x1024)

```text
Premium app icon, square, centered, flat-to-soft-3D modern design. Original artwork; no real brand logos.
A minimal, bold mark: a refined compass rose fused with a stylized atlas globe (a few elegant meridian and latitude lines), and overlaid on it a small constellation of exactly 5 glowing nodes connected by thin luminous lines, representing a swarm of AI agents tracing a route.
The mark is rendered in a warm gradient from rich gold to sunset amber and coral, with soft inner glow, on a deep ocean-blue to navy background with a subtle radial light behind the mark.
Clean geometric shapes, strong silhouette that reads at small sizes, generous padding, no clutter, no text, no letters, no watermarks.
```

## Derived files (no generation)

- `experience-atlas-share.jpg`: top of the hero cropped to 1.905:1 (1536x806) and resized to 1200x630 with Pillow.
- `experience-atlas-square.jpg`: the icon inset 10 px to drop its white corners, resized to 580 px, re-masked with rounded corners and placed on a navy radial gradient with a warm halo and soft shadow. Text: "EXPERIENCE ATLAS" (Didot), "Your AI travel companion" (Avenir Next), "BY LEAGUE OF AI".
