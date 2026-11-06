# Showcase Publisher brief: League of AI × Experience Atlas

**Mission:** at each milestone, make one or two share-worthy 1920x1080 visuals about Experience Atlas ("Your AI travel companion": a swarm of Claude agents with voice, photos, video and memory) and post them to the smol.show gallery "Munich Day 2 Hackathon", team "League of AI". Every claim on a card must come from a file in this repo.

**Milestones**
| id | Content | Trigger | Status |
|---|---|---|---|
| M1 | Team card with LinkedIn QR codes, plus progress #1 stat tiles | concept + spike done | posted |
| M2 | Architecture: coordinator, specialists, memory, voice | after the ADR lands in `docs/adrs/` | queued |
| M3 | First itinerary on screen (real UI screenshot) | first end-to-end render | queued |
| M4 | Voice conversation clip (MP4 ≤20 s) | voice loop working | queued |
| M5 | Final demo still and clip | demo rehearsal | queued |
Engagement posts between milestones are queued in `CALENDAR.md`.

**Caption style:** one punchy line plus a credit tail, e.g. "Progress #1: the swarm is alive … · League of AI — Gabriel González Pineda & Leonardo Eleuteri". Every card also carries that credit.

**Brand:** navy `#060E20` background, ocean `#1A3E68` glow and glass panels, amber `#D68C4C` and gold `#C89B50` accents, champagne `#F6E6C0` text, mist `#C4D6E8` body, slate `#8096B2` secondary. Didot for headlines; Avenir Next for numbers, labels and body text (Didot's old-style figures read badly). Assets: `assets/brand/experience-atlas/` and `assets/brand/league-of-ai/`.

**Render:** `uv run --no-project --with pillow --with qrcode --with numpy python showcase/render/<script>.py`. Shared helpers live in `showcase/render/common.py`. Look at each PNG before uploading, and decode any QR code (OpenCV `QRCodeDetector`) at 1/3 scale.

**Upload (Playwright MCP, shared browser):**
1. Open `https://smol.show/upload`. You should be logged in as Gabriel González Pineda, team League of AI.
2. If you are logged out: get the event password with `security find-generic-password -a "$USER" -s smol-show-event-password -w` (never print it), enter the name "Gabriel González Pineda" and join "League of AI".
3. Take a snapshot. Click "Drop screenshots & videos or tap to choose", then call `browser_file_upload` with absolute paths.
4. Wait until each new item appears in "Your showcase". Type its caption into "Add a caption (optional)", then press Tab (blur) to save. Verified for M1: captions survive a reload.
5. Reload `/upload` and confirm the item count went up and the captions persisted.

**Rules**
- Never remove or edit existing gallery items. Touch only the items you uploaded, and only to add their captions.
- Never upload secrets, keys, tokens, private data or screenshots that show them.
- Log every upload in `showcase/posted.json` as `{file, caption, milestone, uploaded_at}`, with `uploaded_at` as an ISO time.
- Use real facts only. If a number is not in the repo, leave it off the card.
