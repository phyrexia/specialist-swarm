# Demo media cache

Curated real photos and videos for the travel-agent demo. `demo-media.json` holds 43 places across three scenarios: `sailing-europe`, `tokyo-japan` and `lisbon-work-trip`. Each place is a city, island, neighborhood, experience or insider spot.

**Rebuild:** `python3 -I build_media_cache.py` (stdlib only, no API key, needs network, about 3 minutes). Commons and Wikipedia answer HTTP 429 to bursts; if that happens, wait a minute and run it again.

**Sources and checks:**
- Coordinates come from the English Wikipedia (`prop=coordinates`). Six places have no usable article coordinates and use `COORD_FALLBACK` in the script; the build prints a WARN for each.
- Photos come from Wikimedia Commons (`imageinfo`, 1600px thumb), landscape only, maps and logos excluded. Results are in search-relevance order, not by date.
- YouTube ids are checked with oEmbed at build time; ids that fail are dropped.
- Last verification: 215 photo URLs answered HTTP 200/206 (two needed a retry after 429); 81 YouTube ids returned oEmbed HTTP 200; the JSON parses.

**Licence and attribution (mandatory in the UI):**
- Commons photos and videos: show the author, the licence short name and a link to `source_page` next to each image. Do not strip the credit.
- YouTube: embed with the official player only. Never download, re-host, transcode or cut the videos. The `title` and `author_name` fields are for display.

**Known gaps:**
- `start_seconds` is 0 everywhere; no moment was picked.
- No validated fado video was found, so there is no Lisbon fado experience.
- Four places have one video only: Komiža (reuses the Vis drone video), Omoide Yokocho, Gotokuji and Teshima.
- Commons URLs are thumbnails of files that can be deleted; a rebuild refreshes them.
