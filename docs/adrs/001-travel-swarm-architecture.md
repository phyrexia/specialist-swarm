# ADR-001: Experience Atlas, a voice-first travel-agent swarm (poc)

- **Status**: proposed
- **Date**: 2026-11-06
- **Profile**: `poc` (branch `poc/travel-swarm`)
- **Grill**: `docs/specs/2026-11-06-travel-swarm-poc-grill.md`
- **Contracts (normative appendix)**: `docs/adrs/001-travel-swarm-architecture-contracts.md`
- **Build plan**: `docs/plans/2026-11-06-travel-swarm-build-plan.md`
- **Product**: Experience Atlas, "Your AI travel companion", by League of AI. Brand kit: `assets/brand/experience-atlas/`, `assets/brand/league-of-ai/`.

## Context

The Owner wants a personal travel agent built as a swarm. It starts from what the traveller wants to *do*, tailors the plan to who is travelling, learns priorities by suggesting things, and builds a morning/afternoon schedule that is consistent with the flights and hotel. Its first answer already looks like an itinerary, and every later turn is a visibly refined version. It asks one question at a time and never throws stored knowledge back at the user. Inventory is simulated but grounded in real places, airports and airlines. Memory persists between conversations. The website is photo- and video-rich, with voice next to text: voice activity detection (VAD), barge-in and a live transcript. The goal is a WOW demo at the Anthropic Partner Basecamp hackathon, so the swarm showcasing Claude matters.

The repo is the "Specialist Swarm" kit (`README.md`, `create_specialists.py`, `create_coordinator.py`, `run_deal_desk.py`). Its `multiagent: {type: "coordinator"}` shape is superseded by `multiagent_20261001`.

### What was consulted and what it contributed

| Source | Contribution |
|---|---|
| `docs/research/2026-11-06-managed-agents-facts.md` | API shapes, limits (20 agents, 25 threads, one level), custom-tool flow, memory header rule, budget, pricing |
| `docs/research/2026-11-06-managed-agents-spike.md` (3 runs, 9 turns, live) | Measured latency: `present_result` median 15.2 s and `end_turn` 18.0 s with 2 Haiku specialists. Memory discovery costs ≈5 s. `subagents.type: "enabled"` is required. Stop only on `session.status_idle` + `end_turn`. Threads are re-spawned on follow-ups. Cost $0.02–0.08 per session |
| `docs/research/2026-11-06-openai-realtime-events.md` (docs + live key probe) | `client_secrets` 200 for `realtime` and `transcription` sessions. Event names: transcription `delta`/`completed`, `speech_started`. Out-of-band `response.create` with `conversation: "none"`. Manual cancel uses `response.cancel` + `output_audio_buffer.clear`. Deprecations (`gpt-4o-mini-tts` 2027-01-06; replacement is the Realtime workflow) |
| `docs/research/2026-11-06-voice-video-imagery.md` | No-key media sources (Wikimedia Commons, YouTube embeds validated by oEmbed), Open-Meteo, Nominatim policy; Sora and Veo 3.1 preview are gone |
| `/tmp/travel-swarm/jarvis-voice-reference.md` (Jarvis, `phyrexia/quantum-hq@addd6f9`) | Production-proven pieces: ephemeral-secret minting, browser WebRTC straight to OpenAI, `semantic_vad` + `near_field` (server_vad cut turns on noise). Its ADR-0002 rejected proxying audio through the backend |
| Second Brain: memory `1787403293569` (Jarvis ADR 2026-08-22) | Compose delegated work server-side so it doesn't depend on the Realtime model's wording. This supports Claude as the only brain |
| Second Brain library: "Creating a future-proof enterprise agentic platform architecture" (2026-08-05) | A per-user memory layer from day one, with background extraction plus "hot path" updates. Multi-agent beats a monolith when each specialist owns one domain |
| SDK `anthropic` 2.6.0 types (`types/beta/...`) | Exact fields:<br>• `multiagent_20261001`, `predefined_agents` `{type, id, version}`<br>• `budget.max_list_cost` in cents<br>• `memory_store` resource `access`/`instructions`<br>• `events.stream(event_deltas=...)`, `user.interrupt`, `session.usage`<br>• `sessions.threads.archive`<br>• `model_config.effort`/`speed`, Messages `output_config.format` |
| `fixtures/demo-media/demo-media.json` (43 places, 3 scenarios) | The media fallback cache and the base of the `Place`/`MediaRef` contract |
| Live checks (2026-11-06) | `https://tiles.openfreemap.org/styles/liberty` → 200 JSON. Open-Meteo `archive-api` and `climate-api` answer without a key |

## Decision

### 1. Architecture: two-speed brain, one source of truth

```
Browser (Vite + React, localhost:5173)
 ├── WebRTC audio + "oai-events" data channel ─────────► OpenAI Realtime: EARS (semantic_vad + transcription)
 │                                                        and MOUTH (out-of-band response.create); never a brain
 ├── WS /ws/conversations/{id}: typed JSON protocol ──┐
 └── HTTPS /api/*: voice mint, book, media, x-ray ────┤
                                                      ▼
Backend (Python 3.12+, uv, FastAPI, 127.0.0.1:8765)
 ├── TurnOrchestrator + TripState (single source of truth, single writer per field)
 ├── Concierge "Atlas" (Messages API, claude-haiku-5-5): reply (streamed) | brief (JSON) | sketch v0 (JSON) | narrate
 ├── SwarmRunner ──► Managed Agents session: Trip Architect (coordinator) + 5 specialists
 │      └── custom-tool dispatch ◄── simulator | media | publish_finding | present_itinerary
 ├── World: places registry, deterministic simulator, media resolver, itinerary validate + hydrate
 ├── Memory: store client + Curator (claude-sonnet-5-5) ──► one memory store per traveller
 └── Voice: mints ephemeral Realtime secrets (OpenAI key stays server-side), TTS fallback proxy
```

- **Fast lane: the Concierge "Atlas".** It authors every word the user reads or hears. It runs on the Messages API, so the first token arrives in well under a second, compared with ≈0.9 s for the swarm just to *wake*.
- **Deep lane: the swarm.** It is the only author of priced, bookable itinerary versions (v1, v2, …).
- **TripState** lives in the backend and is the only shared state. Each field has exactly one writer (contracts §C2.10):
  - `brief`: the Concierge brief extractor
  - `itinerary.v0`: the Concierge sketcher, only while no swarm version exists
  - `itinerary.v≥1`: the swarm, via `present_itinerary`
  - `findings`: specialists, via `publish_finding`
  - `booking`: the booking service
  - `history`: the orchestrator, which stores only what the user actually heard
- Neither lane reads the other's chat as instructions. The swarm receives the brief, a delta and the current plan, wrapped as data (contracts §C6). The Concierge receives a compact summary of the current version and of the fresh findings, and may only talk about items present in them.

### 2. Agent roster and models

Six Managed Agents resources, all named `experience-atlas-<key>`, with metadata `{"team":"league-of-ai","app":"experience-atlas"}`. The coordinator uses `multiagent_20261001`, `subagents: {type: "enabled", inline_agents: {type: "disabled"}, predefined_agents: [...]}` and `workflows: {type: "disabled"}`. This is the shape proven in the spike.

| Key | Role | Model (`effort`) | Tools |
|---|---|---|---|
| `architect` | Trip Architect (coordinator): delegates in parallel, builds a schedule consistent with flight times, presents the version | `claude-sonnet-5-5` (medium) | `present_itinerary`; built-ins `read`, `glob` only |
| `scout` | Destinations & Seasons: goal → places, route order, best dates, weather, what's on | `claude-sonnet-5-5` (medium) | `get_climate`, `find_media`, `publish_finding`, `web_search` (≤1/turn) |
| `flights` | Flight Finder: combinations, open-jaw, connection times, cheapest vs best, best day | `claude-haiku-5-5` (low) | `search_flights`, `publish_finding` |
| `stays` | Stay Matcher: hotel, apartment, villa, boat or ryokan that fits the party and the traveller's character | `claude-haiku-5-5` (low) | `search_stays`, `find_media`, `publish_finding` |
| `experiences` | Experience Curator: free tours, paragliding, diving and sailing days; age limits, fit to the time of day | `claude-haiku-5-5` (low) | `search_experiences`, `find_media`, `publish_finding` |
| `insider` | Local Insider (the secret sauce): what isn't easily found, a local's rhythm, no tourist lens | `claude-sonnet-5-5` (medium) | `find_media`, `publish_finding`, `web_search` (≤2/turn), `web_fetch` (≤1/turn); tourist aggregators in `blocked_domains` |

- Unused built-in tools are disabled: `default_config.enabled: false`, and only the listed built-ins are re-enabled. This cuts the tool-choice surface and removes container work.
- Each prompt's intent is in contracts §C5.
- `speed: "fast"` is attempted at provisioning for `architect` and `insider`. The fallback is `standard` if the API rejects it ("invalid combinations are rejected at create time"; SDK docstring).
- **No agent books anything.** Booking is a deterministic backend call against option ids (§7).
- **Threads.** The coordinator is told to reuse each specialist's thread on follow-ups. Reuse keeps context: in spike run 1, the scout answered without calling its tool again. After every `end_turn`, the backend archives duplicate threads per agent with `sessions.threads.archive`, keeping the newest one. It rolls over to a fresh session (§10) at ≥20 threads, well under the 25-thread cap.

### 3. Conversation and latency strategy

**Per user turn**, the orchestrator runs three Concierge calls in parallel, plus the swarm. All three calls use `claude-haiku-5-5`.

| Call | Output | Used for | Target |
|---|---|---|---|
| `reply` | Messages stream, ≤45 words: a reaction, one concrete suggestion from the current plan, at most one question | Chat and voice | First token p50 ≤ 1.0 s |
| `brief` | `output_config.format` JSON: `BriefUpdate` (merged brief, `swarm_action`, preference signals, intent) | Swarm input, memory hot path, booking intent | ≤ 3 s |
| `sketch` | JSON `ItineraryPlan`, first planning turn only | **v0 sketch**: the first answer already looks like an itinerary, with real photos and a map | Rendered ≤ 6 s |

When `brief` returns with `swarm_action ∈ {refine, replan}`, the swarm receives one `user.message` (format in contracts §C6). On the first message of a session, that message includes the traveller profile, so the coordinator never discovers memory itself (the spike measured that discovery at ≈5 s).

**Turn timeline.** Measured numbers come from the spike; the rest are targets.

| t after end of speech | What the user sees or hears |
|---|---|
| ≤ 0.15 s | Orb switches to "thinking"; the transcript line finalizes (local) |
| ≈ 0.3–1.0 s | Transcription `completed` (not measured: rehearsal measures it) |
| ≤ 2.0 s (p50 target) | Atlas starts speaking; text streams in the chat |
| ≈ 2–3 s | Brief sent to the swarm |
| ≤ 6 s | **v0 sketch** slides in: day cards, hero video, route on the map |
| ≈ 7 s | Five agent lanes light up (thread creation at 4.4 s after send in the spike) |
| ≈ 8–25 s | Search results and findings stream into the lanes and fly into day slots (`publish_finding`). After ≥12 s, Atlas may narrate one fresh find (at most 2 narrations per swarm turn, never a question) |
| ≤ 35 s (p50 target) | **v1** snaps in on `present_itinerary`, not on `end_turn`, which saves 2.1–3.3 s. Atlas announces "Version 1" and what changed in one or two sentences |

**Later turns.**
- Only the affected specialists are re-briefed (a refine).
- `replan` (destination, dates or party changed) sends `user.interrupt` first.
- A refine that arrives while a swarm turn is running is queued and merged into one pending message.
- Each version is a visible new iteration: a version pill, "what changed" chips and a reflow animation.

**Keeping the coordinator fast.** The synthesis call that emits `present_result` took 3.2–5.5 s for a tiny payload, and output tokens dominate it. So `present_itinerary` takes a compact **plan of references** (finding ids, option ids, place ids, short titles; contracts §C2.7), and the backend *hydrates* it into the full view from the simulator, the findings and the media resolver. Totals are computed by the server and never by the model. While other specialists are still working, the coordinator is told to end its turn silently, so the spike's interim "still waiting" calls cost less.

**Rules 6 and 7, enforced in code as well as in prompts.** `travel_swarm/guard.py` checks every user-facing sentence, from the Concierge and from hydrated itinerary text, before display or speech:
- it drops sentences that throw knowledge back ("you said", "last time", "I remember", "your profile", …; the list is in contracts §C8.5);
- it truncates after the first question.

`TripState.open_question` blocks a second question until the user answers the first.

**Challenging assumptions (rule 3).** `brief.stance` carries a `value`, a `confidence` and a `drift` in [-1, 1], updated from choices (upgrades picked, premium items asked about). When `drift ≥ 0.4` against the stated stance, `stays`/`experiences` add one "stretch" suggestion with its price delta. Atlas offers it as an option ("there's a villa with a pool for €60 more a night"), never as a contradiction. Every version carries 1–3 `extras` (upgrade, alternative or wildcard). The user's Keep/Skip reactions become preference signals: suggesting new things is how Atlas learns.

**Tailoring (rule 2).** This is enforced by tool parameters and by validation, not only by prompts:
- party → room configurations (one family room that sleeps 3 for a parent + 2 kids) and `min_age` filters;
- solo → the `budget` default and the cost-effective tag;
- `trip_kind: work` → rating ≥ 8.5/10, a desk, and `nightlife_walk_min` ≤ 10.

**Schedule consistency (rule 4).** The server-side validator (contracts §C3) rejects a plan that ignores arrival times:
- landing before 11:00 → a light morning and a slow evening;
- landing after 18:00 → an evening slot only;
- the last activity ends ≥ 3 h before departure;
- one transit slot on each day the route changes;
- nights, stays and experience times all line up.

Violations go back to the coordinator as `is_error: true`, with up to 2 retries. After that the plan is accepted with warnings: the schema and reference rules (V1, V7) stay hard, and every other rule becomes a warning.

### 4. Memory

- **One store per traveller**: `beta.memory_stores.create(name="experience-atlas-mem-<user_id>", description=…, metadata={team, app, user_id})`. It mounts at `/mnt/memory/experience-atlas-mem-<user_id>/`, a path derived from the name (spike).
- **Attachment**: the store is attached to each swarm session at creation with `access: "read_only"` and the `instructions` text in contracts §C9.4, which enforces "never throw it back". The store is read-only in sessions because the insider reads web pages, and the research note warns that a `read_write` store written from untrusted input can poison later sessions. It also keeps writes off the turn's critical path: in the spike, a memory write issued before delegating delayed it by ≈2 s.
- **Writer**: the backend only, through `memories.create`/`update` with a `content_sha256` precondition.
  - **Hot path, per turn:** stable `preference_signals` from the brief call are appended to `/signals/<conversation_id>.md`. There is no LLM call, and nothing is lost if the tab closes.
  - **Background:** the Curator (`claude-sonnet-5-5`, structured output) rewrites `/traveler.md` (≤ 3,000 chars) and writes `/trips/<date>-<slug>.md`. It runs on "End trip", after a booking, after 60 s of WebSocket silence, or as catch-up at the next conversation start when uncurated signals exist. Its input is our own structured signals plus the final brief and the booking, **never raw web or chat text**.
- **Readers**:
  - At conversation start, the backend reads the store once (`memories.list(..., view="full")`) and passes `traveler.md` to the Concierge as a *quiet defaults* block, and to the swarm inside the first message.
  - The mount stays available for past-trip files.
  - The format is in contracts §C9.
- **Demo across two conversations**:
  1. Conversation 1 (family sailing) ends with a booking, which triggers curation; X-ray shows the memory diff.
  2. "New trip": the presenter asks for "Tokyo and maybe an island in April". The v0 sketch already has a family room, a slow first morning and kid-friendly picks.
  3. Atlas never mentions the past.

  `scripts/seed_memory.py` writes a known profile as a fallback if conversation 1 is skipped.

### 5. Simulated-data strategy

- **Real world, simulated inventory.** Real facts come from curated fixtures plus model knowledge:
  - `fixtures/world/airports.json`: real IATA codes, coordinates and IANA time zones;
  - `airlines.json`: real carriers with their hubs and network type;
  - places from `fixtures/demo-media/demo-media.json`, plus a geocoded registry for other places (Nominatim at 1 request/s, cached, with a proper User-Agent, no autocomplete).
- **Deterministic generators.** Flights, stays and experiences are pure functions of `(query, seed = sha256(normalized query))`, so the same option id resolves identically later, and booking and hydration stay consistent across versions.
  - **Flights**: duration = great-circle distance ÷ 800 km/h + 40 min. Connections go through real carrier hubs, with 45–180 min layovers. Prices scale with distance × season × carrier type, with ±noise.
  - **Stays**: room configurations come from party size, names from locale templates, ratings 7.0–9.7.
  - **Experiences**: a curated per-place catalog for demo places (including free walking tours, paragliding, scuba and sailing days) and a category generator elsewhere, with real time slots and `min_age`.
- **Climate**: `fixtures/world/climate.json` holds monthly normals for demo places. `scripts/build_climate_cache.py` refreshes it from the Open-Meteo archive API (no key, non-commercial). Unknown places fall back to `source: "estimate"`, which is labelled.
- **Labelling**: every price, option and booking carries `simulated: true`. The UI shows a small "Simulated" badge, and booking reads "Simulated booking, no payment".

### 6. Media pipeline

- **Order of resolution:**
  1. the fixture cache (`fixtures/demo-media/demo-media.json`, 43 places with photos and YouTube or Commons videos validated by oEmbed);
  2. local files from `scripts/download_media.py` for offline use (Commons licences allow copying with credit; YouTube is never cached, per its policy);
  3. live Wikimedia Commons search (2.5 s timeout, compliant User-Agent);
  4. a gradient-and-map placeholder.
- **Agent-proposed YouTube links** (found through `web_search`) are accepted only if they match `youtube.com/watch?v=` or `youtu.be/` and pass oEmbed (`https://www.youtube.com/oembed?url=…&format=json` → 200). There is no live YouTube search, because there is no key.
- **Backend fetch allowlist**: `commons.wikimedia.org`, `upload.wikimedia.org`, `thumb.wikimedia.org`, `www.youtube.com/oembed`, `nominatim.openstreetmap.org`, `archive-api.open-meteo.com`. There is no arbitrary URL fetch, which guards against server-side request forgery (SSRF).
- **Credits**: every `MediaRef` carries the author and licence, and the UI shows a small credit on hover.
- **Itinerary references**: itineraries reference `media_id`s, and hydration embeds the full `MediaRef`s.

### 7. Booking

"Book everything" (button or voice intent `book`) calls `POST /api/book` with `{conversation_id, version}`:
- the server re-resolves every option id in that version through the simulator and recomputes totals;
- it returns one confirmation: a PNR-style code per flight, `H-XXXXXX` per stay and `E-XXXX` per experience, all `simulated: true`;
- this takes under 100 ms, with no model involved;
- it then triggers memory curation.

### 8. Voice pipeline: Claude is the brain, OpenAI Realtime is the ears and mouth

**Chosen (option c, a variant of the brief's option b).** One WebRTC Realtime session per page is the ears and the mouth. Its `client_secrets` body is in contracts §C13.1:
- `type: "realtime"`;
- `audio.input.noise_reduction: near_field`;
- `audio.input.transcription.model: gpt-4o-mini-transcribe`;
- `turn_detection: {type: "semantic_vad", eagerness: "auto", create_response: false, interrupt_response: true}`;
- voice `marin`.

**Behaviour:**
- **VAD**: OpenAI's `semantic_vad` emits `input_audio_buffer.speech_started`/`speech_stopped`. With `create_response: false`, Realtime never answers on its own.
- **Live transcript**: user captions stream from `conversation.item.input_audio_transcription.delta`/`completed` [V]. Assistant captions come from `response.output_audio_transcript.delta` [P], so the transcript shows what was actually spoken. The chat shows Claude's text.
- **Turn**: on `completed`, the browser sends `user.message{source:"voice"}` over the WebSocket. Typed text takes the same path.
- **Mouth**: the browser speaks Atlas's sentences with out-of-band `response.create` `{conversation:"none", input:[], instructions:"<say>…</say>"}` [V for the mechanism]. The first sentence goes as soon as it completes, and the rest of the reply follows as one chunk. Audio comes back as the WebRTC remote track, so the browser's echo canceller has its reference, and no audio passes through our backend (Jarvis ADR-0002).
- **Barge-in, "duck then stop"**:
  - on `speech_started` while speaking or generating, set the output volume to 20% at once;
  - if speech is still going 300 ms later, send `response.cancel` + `output_audio_buffer.clear` [V], drop the queue and send `user.barge_in{turn_id, heard_text}`;
  - the server cancels the Claude stream and stores only the heard text;
  - `interrupt_response: true` may already cancel the response server-side [P]; the manual events are idempotent;
  - barge-in never interrupts the swarm.
- **Fallbacks**, behind one `Mouth` interface:
  - `TS_VOICE_MOUTH=tts`: backend proxy to `/v1/audio/speech` with `gpt-4o-mini-tts`, streamed as PCM to an AudioContext queue; barge-in = stop the player and abort the fetch;
  - `TS_VOICE_MOUTH=browser`: `speechSynthesis`;
  - push-to-talk (hold Space): `session.update` with `turn_detection: null`; on press send `input_audio_buffer.clear`/`response.cancel`/`output_audio_buffer.clear`, on release send `input_audio_buffer.commit` [V procedure]. This is for a room too noisy for VAD.
- **Models**: `TS_REALTIME_MODELS="gpt-realtime-2.1-mini,gpt-realtime-2.1,gpt-realtime"`. The mint endpoint tries them in order:
  - `gpt-realtime` is probed and proven in Jarvis, and shuts down 2027-01-20;
  - `gpt-realtime-2.1-mini` is OpenAI's named replacement for `gpt-4o-mini-tts`.

  The live smoke run picks the default by verbatim fidelity (§9 of the plan).
- **Keys**: the OpenAI key is read from the Keychain into the backend's environment by `scripts/dev.sh`. The browser only gets the ephemeral `value` (default TTL 600 s).

### 9. UI and wow moments

**Stack**: Vite + React + TypeScript + Tailwind CSS v4 + Motion + Zustand + MapLibre GL with the OpenFreeMap `liberty` style (no key). The palette and icon come from the brand kit (navy `#060E20`, ocean `#1A3E68`, amber `#D68C4C`, gold `#C89B50`, champagne `#F6E6C0`).

**Layout**:
- Left column (≈32%): the **conversation**, with chat bubbles, a voice orb (idle, listening with a level meter, thinking, speaking) and a **live transcript** pane beside the chat (user and Atlas captions).
- Right side: the **trip canvas**, with these parts:
  - a cinematic hero, showing a muted YouTube loop or a Commons video, or a Ken Burns photo, which crossfades per day and place;
  - the version bar (`v0 sketch → v1 → v2`, with "what changed" chips);
  - day cards with morning, afternoon and evening bands;
  - boarding-pass flight cards and stay cards;
  - 1–3 "Also consider" suggestions (Keep/Skip);
  - a map with animated great-circle flight arcs and numbered day pins;
  - totals and the **Book everything** button.
- Above the canvas: the **swarm strip**, five agent avatars with model badges, status rings and a live activity ticker ("Flights: 6 options MUC→SPU", "Insider: reading a Komiža fishermen's blog").

**Wow moments, in demo order**:
1. Atlas speaks in about 2 s, and the itinerary sketch with real footage appears before you finish reading the reply.
2. Five agents light up in parallel, and their findings visibly fly into day slots.
3. v1 snaps into a schedule that respects the 09:40 landing (a light first day).
4. A mid-sentence barge-in stops Atlas instantly, and the plan adapts.
5. The comfort-drift challenge ("a villa with a pool for €60 more a night?").
6. One tap books flights, the villa and two experiences, with confirmation cards.
7. A new conversation starts already tailored, and Atlas never says why.

**Presenter-only X-ray** (shortcut `Shift+X`) shows:
- Managed Agents event stream, thread ids and per-phase timings (T_voice, T_sketch, T_v1);
- live `session.usage.list_cost` against the budget;
- guard hits;
- the memory files and their diff after curation.

It shows judges the swarm and the memory without breaking rule 7 for the traveller.

**Landing**: the brand hero and icon, then "Who's travelling?" with a name field and two personas (Ana, a parent of two; Leo, solo and on work trips).

### 10. Cost caps, failure modes and fallbacks

**Caps:**
- Session `budget = {type:"limit", max_list_cost:{amount:"200", currency:"USD"}}`. That is 25–100× the spike's $0.02–0.08 per session, and it exists to stop runaway tool or search loops.
- Backend daily guard: ≤ $20 of summed `session.usage.list_cost`, ≤ 500 Messages calls and ≤ 40 voice-secret mints. When a cap is hit, new swarm turns are refused, and the demo falls back to replay.
- Web search is capped by prompt (scout ≤1, insider ≤2 per turn) and counted from `server_tool_use.web_search_requests`.
- The Realtime session disconnects after 5 minutes of silence.

**Failure modes:**

| Failure | Detection | Fallback |
|---|---|---|
| Swarm turn slow | No `present_itinerary` after 45 s | Atlas narrates a finding. At 60 s, send `user.interrupt` + "present the best version you have now". The current version stays on screen |
| Plan invalid | Validator | Violations returned with `is_error: true`, ≤2 retries, then accepted with `warnings` |
| Custom tool raises an error or exceeds 5 s | Dispatcher | `user.custom_tool_result{is_error:true}`. Never left unanswered; `requires_action.event_ids` is a safety net |
| `budget_reached`, `retries_exhausted`, `session.error` | Stream | One retry after 3 s for overloaded or rate-limited errors. Otherwise the swarm is disabled for the conversation; Atlas continues on the last version |
| Stream drop | Exception or EOF | Reconnect: `events.list` plus dedupe by event id, then re-answer pending tool calls |
| ≥20 threads or `session.status_terminated` | Counter or event | Roll over: a new session whose first message carries the profile, the brief and the current plan |
| Concierge error or no first token in 4 s | Timeout | One retry, after a spoken "One moment". If the brief JSON is invalid, keep the previous brief and set `swarm_action` to `none` |
| Memory API failure | Exception | Proceed without the profile. Signals are also kept under `.experience-atlas/signals/` and curated later |
| Voice mint fails for all models, or WebRTC fails | HTTP or ICE state | One reconnect, then text-only mode with a banner |
| Echo causes false barge-ins | X-ray counter | Duck then stop, push-to-talk, or a headset |
| Media missing | Resolver | Fixture → local file → live Commons → placeholder. A blocked YouTube embed falls back to a Commons video, then to a Ken Burns photo |
| Venue network down | Health check | **Replay mode** (`TS_REPLAY=recordings/<file>.jsonl`): the server→client protocol recorded in the live smoke run, replayed with its original timing. Voice falls back to `speechSynthesis` |

## Alternatives rejected

| Alternative | Measurable reason for rejecting it |
|---|---|
| (a) OpenAI Realtime as the conversational brain, with tools delegating to the swarm (the Jarvis pattern as is) | Claude would author 0% of spoken words in a Claude hackathon. Voice and text would need two persona implementations, or text through Realtime. The one-question and no-throwback rules would live in a GPT prompt. Jarvis itself moved composition out of the Realtime prompt (SB `1787403293569`) |
| (b) Realtime transcription-only, plus `/v1/audio/speech` with `gpt-4o-mini-tts` as the mouth, as the primary path | It adds a backend audio proxy (+1 hop per sentence; Jarvis ADR-0002 rejected proxying audio). TTS played through an AudioContext is not a WebRTC remote track, so the echo-canceller reference is not guaranteed [NV], and barge-in can fire on its own echo with laptop speakers. The model shuts down 2027-01-06, with the Realtime workflow named as its replacement. Kept only as the fallback mouth |
| The swarm alone, with no fast layer | Measured `present_result` median 15.2 s and `end_turn` 18.0 s for a trivial 2-specialist turn, against the voice target of ≤2 s: about 8× too slow |
| A single Messages-API agent with all tools | It drops the Managed Agents multi-agent and memory showcase. Five domains run sequentially instead of in parallel: the spike measured 3.9–7.3 s per specialist in parallel, so five sequential specialists would take about 20–35 s for their part alone |
| The coordinator discovers memory with file tools | The spike measured +≈5 s (three sequential model calls) before delegation |
| The coordinator writes memory (`read_write` mount) | A write placed before delegation added ≈2 s (spike turn 2). It also opens a prompt-injection path from web content (research note) |
| `present_itinerary` carries the full itinerary | The model would generate about 2,000–3,000 output tokens, against ≤800 for a plan of references. The synthesis call is the largest single step on the critical path (3.2–5.5 s even for a tiny payload). Model-computed totals can also drift |
| Agents perform bookings through a tool | That adds at least 2 model calls (≈2–4 s at the measured 1.0–2.0 s per call) and model-computed totals, against a deterministic backend call under 100 ms |
| Push-to-talk as the primary mode (the research recommendation) | The Owner requires VAD and barge-in. Kept as a fallback |
| Web Speech API for speech-to-text | No VAD or barge-in integration, Firefox gaps (MDN), and Chrome sends audio to a server anyway. The Realtime ears are already needed for the mouth |
| Generated video (Sora, Veo, Omni) | Sora was removed 2026-09-24 and Veo 3.1 preview shut down 2026-10-22. There is no authorized key for Omni or Runway |
| Live YouTube search, Pexels, Unsplash | There are no keys, and YouTube policy forbids caching. The fixture plus oEmbed validation covers the demo |
| One event stream per specialist thread | It would mean 5 extra streams per turn. The primary stream already carries cross-posted thread status and custom-tool calls (spike), and `publish_finding` gives structured progress |
| Server-Sent Events plus POST instead of a WebSocket | That needs 2 channels and makes barge-in ordering relative to deltas harder. A WebSocket is one ordered, bidirectional channel |
| Next.js | Server-side rendering is not needed for a localhost demo. Vite starts in about a second and has fewer moving parts for 2 parallel UI implementers |
| The kit's `multiagent: {type: "coordinator"}` | Superseded. `multiagent_20261001` was proven live |

## Consequences

**Positive:**
- Claude authors every user-facing word (the Concierge) and every plan (the swarm).
- Audio never touches our backend.
- Every package is testable headless and without keys through the ports and fakes in contracts §C14.
- The swarm's wait is filled with visible, structured progress.
- Booking and totals are deterministic.

**Negative:**
- Two vendors sit on the voice path. If OpenAI is down, the demo is text-only.
- v0 has a second writer (the sketcher), so the rule that the sketch is superseded by v1 must hold.
- Realtime verbatim speech is not guaranteed [P]. It is gated by a smoke test, with the `tts` fallback behind it.
- Deprecations to watch: `gpt-realtime` (2027-01-20), `gpt-4o-mini-tts` (2027-01-06, fallback only) and `gpt-4o-mini-transcribe` (2027-02-26).
- Workspace and data:
  - the workspace is shared, so names are prefixed and cleanup is by prefix and metadata;
  - memory stores and session transcripts persist and are not ZDR-eligible, so only demo personas are used.
- Per the poc rule, this code is reference material and not a base. Promotion means a fresh `feature` grill from `main`.

## What would revisit this decision

| Trigger | Change |
|---|---|
| Rehearsal: v1 p50 > 60 s | Discard criterion in the grill |
| Rehearsal: voice first word p50 > 3 s | Discard criterion in the grill |
| Realtime verbatim fidelity < 95% word match on the 10-sentence smoke set | Switch the mouth to `tts` |
| False barge-ins > 1 per minute with speakers | Push-to-talk or a headset for the demo |
| A swarm turn costs > $0.50 | Review the models and the search caps |
| Managed Agents adds structured session output or audio | Re-evaluate |
| The Owner asks for Spanish | The Concierge prompt and voice instructions change language |
| Promotion to a product | Real inventory APIs, auth, retention policy, and replacing the deprecated audio models |

## Calls made by the Designer (for Owner review)

1. **Voice**: Claude is the only brain; OpenAI Realtime is ears and mouth (option c). `tts` and `browser` mouths and push-to-talk are fallbacks.
2. **Fast lane**: the Concierge "Atlas" runs on `claude-haiku-5-5` (Messages API) for reply, brief, sketch and narration. The Curator runs on `claude-sonnet-5-5`.
3. **Swarm models**: the coordinator, `scout` and `insider` run on `claude-sonnet-5-5`; `flights`, `stays` and `experiences` run on `claude-haiku-5-5`. `speed: "fast"` is attempted.
4. **v0 sketch**: the Concierge writes it in about 5 s. Swarm versions start at v1, which is rendered on `present_itinerary`.
5. **Plan of references**: `present_itinerary` takes references, and the server hydrates and computes totals.
6. **No agent books**: booking is a backend endpoint and also triggers memory curation.
7. **Memory**: the swarm mounts it `read_only`. The backend writes it: hot-path signals every turn, and Curator rewrites in the background. The profile is injected into the first swarm message.
8. **Threads**: the prompt asks for reuse, the backend archives duplicates after each turn, and a session rolls over at 20 threads.
9. **Turns**: one swarm turn at a time. A refine is queued and merged; a replan interrupts.
10. **Narration**: at most 2 progress lines per swarm turn, after ≥12 s, never a question. Each version is announced in one or two sentences.
11. **Guard**: the throwback guard and the one-question guard are code, applied to everything the user sees or hears.
12. **Stretch suggestions**: offered when `stance.drift ≥ 0.4`. Every version carries 1–3 extras with Keep/Skip.
13. **Simulator**: deterministic and seeded, with real airports, airlines and places, EUR prices, and "Simulated" labels everywhere.
14. **Default origin**: Munich (MUC), the hackathon city. Demo dates are in 2027 (late June for sailing, April for Tokyo).
15. **Media**: the fixture first, then local copies, then live Commons, then a placeholder. YouTube is embed-only and must pass oEmbed. No generated media.
16. **UI stack**: Vite, React, Tailwind v4, Motion, Zustand and MapLibre with the OpenFreeMap `liberty` style.
17. **Protocol**: one WebSocket per conversation with a versioned envelope (`v: 1`).
18. **Budgets**: $2 per session and $20 per day, plus call and mint caps.
19. **Replay mode**: recorded protocol streams serve as the venue fallback.
20. **X-ray**: a presenter-only view; the traveller UI never shows stored knowledge.
21. **Names**: English only. The persona is called "Atlas". Demo personas are Ana and Leo, picked by name, with no auth.
22. **Resource naming**: the `experience-atlas-` prefix, metadata `{"team":"league-of-ai","app":"experience-atlas"}`, and an idempotent provisioner that reconciles by name and prompt hash.
23. **Web search**: limited to `scout` (≤1) and `insider` (≤2 search + ≤1 fetch). The insider blocks tourist aggregators.

## Two-minute demo script

Setup: laptop speakers. Ana is selected. Conversation 1 is fresh. X-ray is closed. The replay file is ready in case the network drops.

| Time | Presenter / Ana (voice) | Experience Atlas |
|---|---|---|
| 0:00 | Landing: "Experience Atlas, your AI travel companion". Click **Ana** | Hero fades into the empty canvas |
| 0:05 | "I want to go sailing in Europe with my two kids at the end of June." | ≤2 s: "Sailing with the kids at the end of June, lovely. Here's a first shape: a week around Split, Hvar and Vis, with short hops and calm mornings. Are you flying from Munich?" The v0 sketch slides in with Split drone footage and a route on the map. Five agent lanes light up |
| 0:12 | Ana: "Yes, Munich. The kids are seven and ten." | "Seven and ten, great ages for boat days." Lanes keep working, and findings fly into slots: a direct MUC→SPU flight at 08:05, a family room in Hvar, Stiniva cove by boat at 8 am |
| 0:35 | Presenter points at the swarm strip | **v1** snaps in, and Atlas starts: "Version one: you land in Split at 9:40, so day one stays easy: a swim, then an early dinner…" |
| 0:42 | Ana barges in mid-sentence: "Could it be a bit nicer? Maybe somewhere with a pool." | Atlas stops instantly: "There's a villa with a pool above Stari Grad for €60 more a night. Want it for the Hvar nights?" (the stretch challenge; a single question) |
| 1:05 | Ana: "Yes, do that." | v2 builds; the stays and experiences lanes pulse. v2 lands with "what changed: Villa Lavanda, sunset sail moved to day 4" |
| 1:25 | Ana: "Book everything." | Confirmation cards: 2 flights (PNRs), a villa, a guesthouse, a boat trip; "Simulated booking, no payment". X-ray toast for the presenter: memory updated |
| 1:35 | Click **New trip** (same user). Ana: "Tokyo, and maybe an island, in April." | v0 already has a family room, a slow first morning after the long flight, Yanaka and Naoshima for the kids. Atlas asks one question and never mentions the last trip |
| 1:50 | Presenter opens X-ray (`Shift+X`): the memory file and the swarm timings | "Five Claude specialists, one memory, every word by Claude." |

Fallback cues:
- v1 not in by 0:40: Ana barges in on Atlas's narration of a finding instead of the v1 announcement; the rest of the script is unchanged.
- Network down: start replay mode.
- Echo cutting turns: hold Space (push-to-talk).

## Unverified items (flagged; must be checked in the build or the live smoke run)

- Realtime: verbatim fidelity of out-of-band speech [P]; payloads of `response.output_audio_transcript.delta` [P] and of `speech_started` [P]; `interrupt_response` behaviour with `create_response: false` [P]; whether input audio is billed when no response consumes it [NV]; the played-up-to position for exact heard text over WebRTC [NV] (heard text is approximated by transcript deltas).
- Browser echo cancellation with a WebRTC remote track as reference [standard behaviour, NV in the venue].
- Which 5.5 models accept `speed: "fast"` [NV]. The provisioner falls back.
- Managed Agents: whether memory `instructions` render for subagent threads or only the coordinator [NV] (the coordinator relays constraints in its briefs anyway); whether API writes to a store are visible in an already-mounted session [NV] (not relied on); latency of five specialists with real tools [estimate 18–25 s without search, per the spike].
- Token prices for the 5.5 models and Realtime [NV]. Caps use `list_cost` reported by the API and call counts, not price tables.
- Transcription latency after `speech_stopped` [NV]. Measured in rehearsal.
