# Experience Atlas: 30-minute demo contract (Coordinator, 2026-11-06 15:20)

This is a scope cut of ADR-001 (`docs/adrs/001-travel-swarm-architecture.md`) so we have a working demo in 30 minutes. The ADR is the reference for intent and wow. **This file is the binding contract.** Three implementers work in parallel. File ownership is strict: never edit a file you don't own.

| Package | Owner | Files |
|---|---|---|
| BACKEND | implementer 1 | `app/__init__.py`, `app/server.py`, `app/swarm.py`, `app/concierge.py`, `app/book.py`, `pyproject.toml`, `run.sh`, `README-demo.md` |
| FRONTEND | implementer 2 | `web/index.html`, `web/app.js`, `web/styles.css` |
| VOICE | implementer 3 | `app/voice.py`, `web/voice.js` |

## Run
- `./run.sh` reads the OpenAI key `OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s openai-tts-api-key -w)"`; `ANTHROPIC_API_KEY` is already in env. It then runs `uv run uvicorn app.server:app --host 127.0.0.1 --port 8765`. Open http://127.0.0.1:8765/.
- Python ≥3.12 via `pyproject.toml` deps: fastapi, uvicorn[standard], anthropic>=2.6.0, httpx, sse-starlette (optional).
- Static: `GET /` serves `web/index.html`, `/web/*` is the `web/` dir, `/assets/*` is the `assets/` dir (brand images), `/fixtures/*` is the `fixtures/` dir.
- Never log or return secrets.

## HTTP API (BACKEND owns all except /api/voice/*, /api/tts)
- `GET /api/places` returns `[{id, name, country, kind, lat, lon, scenario:[...]}]` from `fixtures/demo-media/demo-media.json`.
- `GET /api/media/{place_id}` returns `{photos:[{url, author, license, source_page}], videos:[{provider, id, title, author_name, start_seconds, url}]}`, or 404.
- `POST /api/chat` with body `{conversation_id: str|null, text: str}` returns a `text/event-stream` response for THIS turn. Each SSE message is `data: <json>\n\n`. The first event is always `{"type":"conversation","conversation_id":"..."}`. The stream closes after `turn.done` or `error`.
- `POST /api/book` with body `{conversation_id}` returns `{"confirmation":"EA-7K2Q9","status":"confirmed","items":[{kind:"flight|stay|experience", title, price_eur}], "total_eur": n}`. This is simulated, built from the latest itinerary.
- VOICE: `POST /api/voice/session` returns `{client_secret, model}`, and `POST /api/tts` with `{text}` returns audio (mp3, streamed). Implemented in `app/voice.py` as `router = APIRouter()`. BACKEND includes it: `from app.voice import router as voice_router; app.include_router(voice_router)`.

## SSE events (`POST /api/chat` stream), in rough order
- `{"type":"conversation","conversation_id"}`
- `{"type":"concierge.delta","text"}` … `{"type":"concierge.done","text"}`: a fast warm 1–2 sentence reply from Claude Haiku (Messages API, streaming). It never quotes back stored preferences ("you said before…").
- `{"type":"speak","text"}`: text the UI should SPEAK via `voice.speak()`. It is emitted with the concierge reply and again with the itinerary summary plus `next_question`.
- `{"type":"swarm.status","status":"starting|running|done|error","message"}`
- `{"type":"agent.spawned","agent":"Explorer|Flights|Stays|Experiences|Local Insider","thread_id"}`
- `{"type":"agent.activity","agent","kind":"delegated|working|replied|tool","text"}`: short previews, ≤140 chars.
- `{"type":"itinerary","version":0,"prebuilt":true|"sketch":true,"itinerary":{...}}`: instant v0 on the FIRST turn. The 3 quick-start chips map to saved real swarm itineraries in `fixtures/demo-itineraries/prebuilt.json` and arrive at about 0.02 s. Free text gets a Haiku sketch at about 5 s. A v0 has no `next_question`.
- `{"type":"itinerary","version":n,"itinerary":{...schema below...}}`: swarm versions v1, v2 and so on (v1 ≈ 30 s)
- `{"type":"usage","cost_usd":n}` (optional)
- `{"type":"turn.done"}` / `{"type":"error","message"}`

## Agents (BACKEND, Managed Agents)
Agents are created once and cached in `.atlas_state.json` (gitignored). The name prefix is `experience-atlas-`, because the workspace is shared. Reuse the working code from `spikes/ma-latency/spike.py`, and the shapes in `docs/research/2026-11-06-managed-agents-spike.md`, which include `multiagent_20261001` with `subagents.type="enabled"`.
- Coordinator "Trip Architect" on `claude-sonnet-5-5`. It has the custom tool `present_itinerary(input_schema = the schema below)`, plus predefined subagents.
- Specialists on `claude-haiku-5-5`:
  - Explorer: destinations, weather, events, best season
  - Flights: routes, connections, carriers, simulated prices
  - Stays: lodging that fits the traveller, e.g. one room for a parent and 2 kids
  - Experiences: tours, sailing, diving, paragliding
  - Local Insider: non-touristy spots, "live like a local"
- Specialists use real-world knowledge, with plausible simulated prices and availability. **No web search** (speed).
- The coordinator delegates to ALL 5 in ONE message, in parallel, then calls `present_itinerary`. On later turns it reuses the existing threads.
- Every user turn includes the compact place catalog (`id | name | country | kind`), so the itinerary can reference `place_id` exactly.
- Memory: one memory store `experience-atlas-traveller-demo`, attached `read_write` with instructions: save stable preferences briefly, and NEVER quote them back.
- Session `budget` is about $3.
- Stop the turn only on `session.status_idle` with `stop_reason.type == "end_turn"`. Emit `itinerary` as soon as `present_itinerary` arrives, then reply `user.custom_tool_result` with "ok".
- Fallback: save each successful itinerary to `fixtures/demo-itineraries/<slug>.json`. If the swarm errors, replay the closest saved one, with `swarm.status` message "replay".

## Itinerary schema (`present_itinerary` input, and `itinerary` event payload)
```json
{"title":"str","summary":"str","travellers":"str","budget_style":"budget|balanced|comfort|luxury",
 "dates":"str","weather_note":"str","total_estimate_eur":0,
 "days":[{"day":1,"place_id":"str|null","place_name":"str","theme":"str",
   "morning":{"title":"str","description":"str","place_id":"str|null"},
   "afternoon":{"title":"str","description":"str","place_id":"str|null"},
   "evening":{"title":"str","description":"str","place_id":"str|null"},
   "stay":{"name":"str","type":"str","price_per_night_eur":0,"why":"str"},
   "transport":{"mode":"flight|ferry|train|boat|car|walk","from":"str","to":"str","carrier":"str","depart":"str","arrive":"str","price_eur":0}}],
 "flights":[{"from":"str","to":"str","carrier":"str","depart":"str","arrive":"str","duration":"str","price_eur":0}],
 "experiences":[{"title":"str","place_id":"str|null","price_eur":0,"why":"str"}],
 "insider_tips":[{"title":"str","description":"str","place_id":"str|null"}],
 "next_question":"str — ONE question to refine the next version"}
```
`evening`, `stay` and `transport` are optional per day.

## Voice (VOICE package) — `web/voice.js` exposes `window.AtlasVoice`
- `init({onUserDelta(text), onUserFinal(text), onSpeechStarted(), onState(state)})`
- `start()`: mic on. It mints via `POST /api/voice/session` and opens WebRTC to `https://api.openai.com/v1/realtime/calls`, following the Jarvis pattern in `/tmp/travel-swarm/jarvis-voice-reference.md`.
- `stop()`, `speak(text)`, `stopSpeaking()`, `isActive()`
- Realtime session = EARS ONLY:
  - `type: "realtime"`, model `gpt-realtime` (works; probe-verified)
  - `audio.input.transcription.model: "gpt-4o-mini-transcribe"`
  - `turn_detection: {type: "semantic_vad", create_response: false, interrupt_response: true}`
  - `noise_reduction: near_field`
  - Never let Realtime answer.
- MOUTH = `POST /api/tts` (`gpt-4o-mini-tts`, voice `marin`, mp3), played through an `<audio>` element.
- Barge-in: on `input_audio_buffer.speech_started`, call `stopSpeaking()` and `onSpeechStarted()`.
- Live transcript: `conversation.item.input_audio_transcription.delta` goes to `onUserDelta`, and `.completed` goes to `onUserFinal`. FRONTEND sends `onUserFinal` text as a chat turn.
- If no mic or no key, `speak()` still works when possible, and the UI falls back to text-only.

## FRONTEND
- A single page, no build step. CDNs are OK: Tailwind, Leaflet + OSM tiles, Google Fonts.
- Palette from `assets/brand/experience-atlas/README.md`. Logo: `/assets/brand/experience-atlas/experience-atlas-icon.png`. Hero: `.../experience-atlas-hero.png`.
- Layout:
  - left: the chat, a live transcript strip and a big mic button with animated rings while listening
  - center: the "Swarm" panel. Six agent orbs (Trip Architect + 5) light up and pulse on `agent.spawned`/`agent.activity`, with a live activity ticker.
  - right/bottom: the itinerary, with a version badge (v1→v2 animated)
- Day cards show morning/afternoon/evening, using a Commons photo (credit line: author · license) and a YouTube embed (`youtube-nocookie.com/embed/{id}?start=`) for the `place_id`. Add a Leaflet map with markers and a route line from the places' lat/lon, plus flights, stays, experiences and insider-tip sections.
- "Book everything" calls `POST /api/book` and shows the confirmation code with a celebratory animation.
- Quick-start chips:
  - "Sailing in Europe with my two kids in late June, mid budget"
  - "Tokyo and maybe an island, 10 days in April"
  - "Work trip to Lisbon for 3 days — good reviews, nightlife nearby"
- Consume `POST /api/chat` with `fetch` + `ReadableStream`, parsing `data:` lines. Keep `conversation_id` for later turns. On `speak`, call `AtlasVoice.speak(text)` if voice is enabled.
- Footer: "Experience Atlas · by League of AI — Gabriel González Pineda & Leonardo Eleuteri".
