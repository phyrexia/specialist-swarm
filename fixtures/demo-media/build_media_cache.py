#!/usr/bin/env python3
"""Build demo-media.json: real places with Wikimedia Commons photos and
YouTube / Commons videos for the travel-agent demo.

Stdlib only. Run from anywhere:
    python3 -I build_media_cache.py

Coordinates come from the English Wikipedia (prop=coordinates) so they are
not hand-typed. Photos come from Wikimedia Commons (imageinfo, 1600px thumb).
YouTube candidates are validated with oEmbed at build time; any id that does
not return HTTP 200 is dropped and reported on stderr.
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "demo-media.json"

UA = "specialist-swarm-demo-media/1.0 (travel-agent demo fixture build; stdlib urllib)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKI_API = "https://en.wikipedia.org/w/api.php"
OEMBED_API = "https://www.youtube.com/oembed"

PHOTOS_PER_PLACE = 5
MAX_VIDEOS_PER_PLACE = 2
MIN_LANDSCAPE_WIDTH = 1200
SLEEP_S = 0.4
SKIP_TITLE = re.compile(
    r"\b(maps?|logos?|diagrams?|coat|flags?|plans?|locators?|charts?|icons?|svg|sketch|stamps?|posters?)\b|karte|mapa",
    re.I,
)

# id, name, cc, kind, parent_id, scenario, wiki (en.wikipedia title for coords),
# commons search text, youtube candidates [(video_id, start_seconds)]
S_SAIL, S_TOKYO, S_LISBON = "sailing-europe", "tokyo-japan", "lisbon-work-trip"
PLACES_SPEC = [
    # --- sailing-europe: base places
    ("split-hr", "Split", "HR", "city", None, S_SAIL, "Split, Croatia", "Split Croatia",
     [("8Ja0XpwP2EM", 0), ("COasBB5YoSM", 0)]),
    ("hvar-hr", "Hvar", "HR", "island", None, S_SAIL, "Hvar", "Hvar island Croatia",
     [("3439nojOCgg", 0), ("WkOEHfUKehs", 0)]),
    ("vis-hr", "Vis", "HR", "island", None, S_SAIL, "Vis Island", "Vis island Croatia",
     [("ALhk8lXDMcA", 0), ("mmraApokRGg", 0)]),
    ("naxos-gr", "Naxos", "GR", "island", None, S_SAIL, "Naxos", "Naxos Greece",
     [("gX3zCUt0tHc", 0), ("E112SUvdFCc", 0)]),
    ("paros-gr", "Paros", "GR", "island", None, S_SAIL, "Paros", "Paros Greece",
     [("nd8YSE18AkI", 0), ("owsSanLmM8Q", 0)]),
    ("maddalena-it", "La Maddalena archipelago", "IT", "island", None, S_SAIL,
     "La Maddalena", "La Maddalena archipelago Sardinia",
     [("TU-4nTW-bw0", 0), ("oBFLXIhmJrM", 0)]),
    # --- sailing-europe: experiences
    ("split-kornati-hr", "Kornati sailing day trip from Split", "HR", "experience", "split-hr", S_SAIL,
     "Kornati", "Kornati Croatia", [("5khrKTtYrbw", 0), ("Sd3FW-Bzfqs", 0)]),
    ("hvar-pakleni-hr", "Pakleni Islands", "HR", "experience", "hvar-hr", S_SAIL,
     "Pakleni Islands", "Pakleni islands Hvar", [("FjwbM669hw8", 0), ("TXr4JFi5XQ0", 0)]),
    ("vis-diving-hr", "Wreck diving off Vis", "HR", "experience", "vis-hr", S_SAIL,
     "Vis Island", "Vis Island Croatia", [("lL0xwCSmhjc", 0), ("qvU75acguaY", 0)]),
    ("naxos-portara-gr", "Portara (Temple of Apollo)", "GR", "experience", "naxos-gr", S_SAIL,
     "Portara", "Portara Naxos", [("AWcgyl2Nyuo", 0), ("WSLx-jWyJlk", 0)]),
    ("paros-antiparos-gr", "Antiparos boat trip", "GR", "experience", "paros-gr", S_SAIL,
     "Antiparos", "Antiparos Greece", [("Lijjb7W15s0", 0), ("RrDhmSPdG-Q", 0)]),
    ("maddalena-budelli-it", "Budelli pink beach boat trip", "IT", "experience", "maddalena-it", S_SAIL,
     "Budelli", "Budelli Spiaggia Rosa", [("SUquSxvlT6k", 0), ("OlLvDROFxuk", 0)]),
    # --- sailing-europe: insiders
    ("split-marjan-hr", "Marjan Hill", "HR", "insider", "split-hr", S_SAIL,
     "Marjan Hill", "Marjan Split", [("4K0zHspEUuY", 0), ("wJqotAU1FAc", 0)]),
    ("stari-grad-hr", "Stari Grad", "HR", "insider", "hvar-hr", S_SAIL,
     "Stari Grad, Croatia", "Stari Grad Hvar", [("EUOhyNuyCxU", 0), ("AIH8YtHuTF8", 0)]),
    ("komiza-hr", "Komiža", "HR", "insider", "vis-hr", S_SAIL,
     "Komiža", "Komiza Vis", [("ALhk8lXDMcA", 0)]),
    ("apeiranthos-gr", "Apeiranthos", "GR", "insider", "naxos-gr", S_SAIL,
     "Apeiranthos", "Apeiranthos Naxos", [("qhu9gFbSRlw", 0), ("24pN9HAi20w", 0)]),
    ("lefkes-gr", "Lefkes", "GR", "insider", "paros-gr", S_SAIL,
     "Lefkes", "Lefkes Paros", [("rG7Ro39FLOI", 0), ("cg1tNLyBZ2Q", 0)]),
    ("caprera-it", "Caprera", "IT", "insider", "maddalena-it", S_SAIL,
     "Caprera", "Caprera Garibaldi", [("skJ2bHLD5rQ", 0), ("e3s7mWaSUrQ", 0)]),
    # --- tokyo-japan: base places
    ("tokyo-jp", "Tokyo", "JP", "city", None, S_TOKYO, "Tokyo", "Tokyo Japan",
     [("eR7fq1r7DKc", 0), ("SL_icT5Twuw", 0)]),
    ("yanaka-jp", "Yanaka", "JP", "neighborhood", "tokyo-jp", S_TOKYO, "Yanaka, Tokyo", "Yanaka Tokyo",
     [("KWEIbp68KOk", 0), ("3T5YVAnvczU", 0)]),
    ("shimokitazawa-jp", "Shimokitazawa", "JP", "neighborhood", "tokyo-jp", S_TOKYO,
     "Shimokitazawa", "Shimokitazawa Tokyo", [("un9FkeEOMxo", 0), ("QPLq7uPJ51A", 0)]),
    ("naoshima-jp", "Naoshima", "JP", "island", None, S_TOKYO, "Naoshima", "Naoshima island",
     [("D3dxYscb9xc", 0), ("aN-aeyqbyGo", 0)]),
    ("ishigaki-jp", "Ishigaki", "JP", "island", None, S_TOKYO, "Ishigaki Island", "Ishigaki island Okinawa",
     [("Oc54GvGskhw", 0), ("S891J6Xd_kI", 0)]),
    # --- tokyo-japan: experiences
    ("tokyo-omoide-jp", "Omoide Yokocho food alley", "JP", "experience", "tokyo-jp", S_TOKYO,
     "Omoide Yokocho", "Omoide Yokocho Shinjuku", [("XRE9ddwO93U", 0)]),
    ("yanaka-ginza-jp", "Yanaka Ginza shopping street", "JP", "experience", "yanaka-jp", S_TOKYO,
     "Yanaka, Tokyo", "Yanaka Ginza", [("HGWJRw3KGCM", 0), ("Z0Op6gQAli4", 0)]),
    ("shimokitazawa-walk-jp", "Shimokitazawa vintage backstreets", "JP", "experience", "shimokitazawa-jp", S_TOKYO,
     "Shimokitazawa", "Shimokitazawa Tokyo", [("AmN8jaC3ZJI", 0), ("mka75MgXbJ4", 0)]),
    ("naoshima-chichu-jp", "Chichu Art Museum", "JP", "experience", "naoshima-jp", S_TOKYO,
     "Chichu Art Museum", "Chichu Art Museum Naoshima", [("rZoGG6Z7_dc", 0), ("lVVQd409iWY", 0)]),
    ("ishigaki-kabira-jp", "Kabira Bay", "JP", "experience", "ishigaki-jp", S_TOKYO,
     "Kabira Bay", "Kabira Bay Ishigaki", [("S891J6Xd_kI", 0), ("A3k96Me1Bp8", 0)]),
    # --- tokyo-japan: insiders
    ("kagurazaka-jp", "Kagurazaka", "JP", "insider", "tokyo-jp", S_TOKYO,
     "Kagurazaka", "Kagurazaka Tokyo", [("uDv-zApLmfg", 0), ("Wv_LDK1uxR0", 0)]),
    ("nezu-jp", "Nezu Shrine", "JP", "insider", "yanaka-jp", S_TOKYO,
     "Nezu Shrine", "Nezu Shrine Tokyo", [("glyNsH2Vdes", 0), ("9-BE5kZ8P7g", 0)]),
    ("gotokuji-jp", "Gotokuji temple", "JP", "insider", "shimokitazawa-jp", S_TOKYO,
     "Gotoku-ji", "Gotokuji temple Setagaya", [("ZNAI5g59Y90", 0)]),
    ("teshima-jp", "Teshima", "JP", "insider", "naoshima-jp", S_TOKYO,
     "Teshima", "Teshima art island", [("f99s1VVI4NA", 0)]),
    ("taketomi-jp", "Taketomi Island", "JP", "insider", "ishigaki-jp", S_TOKYO,
     "Taketomi, Okinawa", "Taketomi Island Okinawa", [("TfSWBwGuo1E", 0), ("DzYOieqX25U", 0)]),
    # --- lisbon-work-trip: base places
    ("lisbon-pt", "Lisbon", "PT", "city", None, S_LISBON, "Lisbon", "Lisbon Portugal",
     [("u44LT4kyCLU", 0), ("CQHtS09Y-Mc", 0)]),
    ("alfama-pt", "Alfama", "PT", "neighborhood", "lisbon-pt", S_LISBON, "Alfama", "Alfama Lisbon",
     [("oWw4-n_c0Bk", 0), ("i-5v3JLmqJY", 0)]),
    ("bairro-alto-pt", "Bairro Alto", "PT", "neighborhood", "lisbon-pt", S_LISBON,
     "Bairro Alto", "Bairro Alto Lisbon", [("rKwghOAf4N0", 0), ("DXZ88YZhyO0", 0)]),
    ("lx-factory-pt", "LX Factory", "PT", "neighborhood", "lisbon-pt", S_LISBON,
     "LX Factory", "LX Factory Lisbon", [("bSpvx3ay7nk", 0), ("9FOhMsPOfhM", 0)]),
    ("graca-pt", "Miradouro da Graça", "PT", "insider", "lisbon-pt", S_LISBON,
     "Graça, Lisbon", "Miradouro da Graça Lisbon", [("depfOKoq0bU", 0), ("nQHlk04o6yA", 0)]),
    # --- lisbon-work-trip: experiences
    ("tram-28-pt", "Tram 28 ride", "PT", "experience", "lisbon-pt", S_LISBON,
     "Basílica da Estrela", "Lisbon tram 28", [("qT_HSRg3Ri0", 0), ("SVnCYQqtMVQ", 0)]),
    # --- lisbon-work-trip: insiders
    ("mouraria-pt", "Mouraria", "PT", "insider", "lisbon-pt", S_LISBON,
     "Mouraria", "Mouraria Lisbon", [("YYPxlKxcp0Y", 0), ("9MlmzI452FA", 0)]),
    ("santa-luzia-pt", "Miradouro de Santa Luzia", "PT", "insider", "alfama-pt", S_LISBON,
     "Alfama", "Miradouro de Santa Luzia Lisbon", [("XeNLVv65QIU", 0), ("Mg4yLFkToNw", 0)]),
    ("principe-real-pt", "Príncipe Real", "PT", "insider", "bairro-alto-pt", S_LISBON,
     "Príncipe Real", "Príncipe Real Lisbon", [("AalaYsXmKB4", 0), ("2-Kr8yz5JUU", 0)]),
    ("cacilhas-pt", "Cacilhas", "PT", "insider", "lisbon-pt", S_LISBON,
     "Cacilhas", "Cacilhas Almada", [("IoX-N6Z2134", 0), ("LG3nWG763DQ", 0)]),
]


# Places whose English Wikipedia article has no usable coordinates (or whose
# lookup was rate-limited). Approximate centroids for demo map pins; the
# build prints a WARN line for each one so they stay visible.
COORD_FALLBACK = {
    "gotokuji-jp": (35.6494, 139.6553),
    "lx-factory-pt": (38.7036, -9.1771),
    "mouraria-pt": (38.7160, -9.1360),
    "tokyo-omoide-jp": (35.6938, 139.6996),
    "principe-real-pt": (38.7166, -9.1478),
    "lefkes-gr": (37.1000, 25.2400),
}


def get_json(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code in (429, 503) and attempt < 3:
                time.sleep(5 * 2 ** attempt)
                continue
            raise
    raise RuntimeError(f"giving up on {url}")


def strip_html(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()


def fetch_coords(wiki_titles):
    """Return {wiki_title: (lat, lon)} from en.wikipedia, following redirects."""
    coords = {}
    titles = sorted(set(wiki_titles))
    # The coordinates prop returns at most 10 titles per request (default colimit).
    for i in range(0, len(titles), 10):
        batch = titles[i:i + 10]
        data = get_json(WIKI_API, {
            "action": "query", "prop": "coordinates", "titles": "|".join(batch),
            "redirects": 1, "format": "json", "formatversion": 2,
        })
        q = data["query"]
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        found = {p["title"]: (p["coordinates"][0]["lat"], p["coordinates"][0]["lon"])
                 for p in q.get("pages", []) if p.get("coordinates")}
        for t in batch:
            resolved = redir.get(norm.get(t, t), norm.get(t, t))
            if resolved in found:
                coords[t] = found[resolved]
        time.sleep(1.5)  # Wikipedia answers 429 to bursts
    return coords


def commons_search(text, limit):
    data = get_json(COMMONS_API, {
        "action": "query", "generator": "search", "gsrsearch": text, "gsrnamespace": 6,
        "gsrlimit": limit, "prop": "imageinfo",
        "iiprop": "url|extmetadata|size|mime", "iiurlwidth": 1600,
        "format": "json", "formatversion": 2,
    })
    time.sleep(SLEEP_S)
    pages = data.get("query", {}).get("pages", [])
    return sorted(pages, key=lambda p: p.get("index", 0))


def commons_photos(query):
    out, seen = [], set()
    for page in commons_search(f"{query} filetype:bitmap", 40):
        info = (page.get("imageinfo") or [None])[0]
        if not info or info.get("mime") not in ("image/jpeg", "image/png"):
            continue
        if info["width"] < MIN_LANDSCAPE_WIDTH or info["width"] <= info["height"]:
            continue
        if SKIP_TITLE.search(page["title"]):
            continue
        if info["descriptionurl"] in seen:
            continue
        seen.add(info["descriptionurl"])
        meta = info.get("extmetadata", {})
        out.append({
            "url": info["thumburl"],
            "full_url": info["url"],
            "width": info["thumbwidth"],
            "height": info["thumbheight"],
            "author": strip_html(meta.get("Artist", {}).get("value")) or "Unknown",
            "license": meta.get("LicenseShortName", {}).get("value", "unknown"),
            "source_page": info["descriptionurl"],
        })
        if len(out) == PHOTOS_PER_PLACE:
            break
    return out


def commons_video(query):
    for page in commons_search(f"{query} filetype:video", 10):
        info = (page.get("imageinfo") or [None])[0]
        if not info or not info.get("mime", "").startswith("video/"):
            continue
        meta = info.get("extmetadata", {})
        return {
            "provider": "commons",
            "id": page["title"],
            "title": page["title"].removeprefix("File:"),
            "author_name": strip_html(meta.get("Artist", {}).get("value")) or "Unknown",
            "start_seconds": 0,
            "url": info["url"],
            "license": meta.get("LicenseShortName", {}).get("value", "unknown"),
        }
    return None


def youtube_video(video_id, start, problems):
    """Return a video entry only if oEmbed answers HTTP 200."""
    watch = f"https://www.youtube.com/watch?v={video_id}"
    try:
        data = get_json(OEMBED_API, {"url": watch, "format": "json"})
    except urllib.error.HTTPError as err:
        problems.append(f"youtube {video_id}: oEmbed HTTP {err.code}, dropped")
        return None
    except urllib.error.URLError as err:
        problems.append(f"youtube {video_id}: oEmbed unreachable ({err.reason}), dropped")
        return None
    finally:
        time.sleep(SLEEP_S)
    return {
        "provider": "youtube",
        "id": video_id,
        "title": data.get("title", ""),
        "author_name": data.get("author_name", ""),
        "start_seconds": start,
        "url": watch,
    }


def main():
    problems = []
    coords = fetch_coords(p[6] for p in PLACES_SPEC)
    places = []
    for pid, name, cc, kind, parent, scenario, wiki, query, yt in PLACES_SPEC:
        if wiki in coords:
            lat, lon = coords[wiki]
        elif pid in COORD_FALLBACK:
            lat, lon = COORD_FALLBACK[pid]
            problems.append(f"{pid}: no Wikipedia coordinates for '{wiki}', used fallback {lat},{lon}")
        else:
            sys.exit(f"no coordinates for {pid} ('{wiki}')")
        photos = commons_photos(query)
        if len(photos) < 3:
            problems.append(f"{pid}: only {len(photos)} Commons photos")
        videos = []
        for vid, start in yt:
            if len(videos) == MAX_VIDEOS_PER_PLACE:
                break
            entry = youtube_video(vid, start, problems)
            if entry:
                videos.append(entry)
        if len(videos) < MAX_VIDEOS_PER_PLACE:
            cv = commons_video(query)
            if cv:
                videos.append(cv)
        if not videos:
            problems.append(f"{pid}: no valid video")
        places.append({
            "id": pid,
            "name": name,
            "country": {"HR": "Croatia", "GR": "Greece", "IT": "Italy",
                        "JP": "Japan", "PT": "Portugal"}[cc],
            "country_code": cc,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "kind": kind,
            "parent_id": parent,
            "scenario": [scenario],
            "photos": photos,
            "videos": videos,
        })

    doc = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "places": places,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {OUT} ({len(places)} places)")
    for sc in sorted({p[5] for p in PLACES_SPEC}):
        n = sum(1 for p in places if p["scenario"] == [sc])
        ph = sum(len(p["photos"]) for p in places if p["scenario"] == [sc])
        vi = sum(len(p["videos"]) for p in places if p["scenario"] == [sc])
        print(f"  {sc}: {n} places, {ph} photos, {vi} videos")
    for msg in problems:
        print(f"WARN {msg}", file=sys.stderr)


if __name__ == "__main__":
    main()
