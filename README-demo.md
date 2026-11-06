# Experience Atlas demo (poc)

A voice-first travel planner. A Claude Haiku concierge answers in about 1 s while a Claude Managed Agents swarm builds the plan: a Trip Architect on Sonnet 5.5 coordinates 5 Haiku 5.5 specialists (Explorer, Flights, Stays, Experiences and Local Insider). The binding contract is `docs/demo-contract.md`.

## Run

```bash
./run.sh            # needs ANTHROPIC_API_KEY in env; reads OPENAI_API_KEY from the Keychain (openai-tts-api-key)
```

- The server listens on http://127.0.0.1:8765/.
- If 8765 is already taken, `run.sh` falls back to **8766** and says so on stderr. On Gabriel's Mac, the Second Brain web UI holds 8765.
- To use another port: `PORT=9000 ./run.sh`.
- Keys are never printed.

On the first start, the backend creates the Managed Agents resources and caches their ids in `.atlas_state.json`, which is gitignored. All of them are named `experience-atlas-*`:
- the environment
- the 5 specialists
- the coordinator
- the memory store `experience-atlas-traveller-demo`

To re-create the agents after a prompt change, bump `CONFIG_VERSION` in `app/swarm.py`. The old agents are archived.

## Smoke test

```bash
curl -N -X POST localhost:8766/api/chat -H 'content-type: application/json' \
  -d '{"conversation_id":null,"text":"Sailing in Europe with my two kids in late June, mid budget"}'
```

The stream sends these events, in order:
1. `conversation`
2. `concierge.delta`… and `concierge.done`, then `speak`
3. `swarm.status`
4. `agent.spawned` ×5 and `agent.activity`…
5. `itinerary` (v1), then `speak` (summary + one question)
6. `swarm.status` done
7. `turn.done`

For a second turn, reuse the `conversation_id`; the itinerary comes back as v2. To book: `POST /api/book {"conversation_id": "..."}`.

## Files

| File | Role |
|---|---|
| `app/server.py` | FastAPI. Serves the static mounts (`/`, `/web`, `/assets`, `/fixtures`), `/api/chat` (SSE), `/api/places`, `/api/media/{id}` and `/api/book`, and includes the voice router from `app/voice.py`. |
| `app/concierge.py` | Haiku 5.5 streaming reply: 1–2 sentences, no question, never quotes stored preferences back. |
| `app/swarm.py` | Agent provisioning, one session per conversation, mapping from events to SSE, `present_itinerary` → `itinerary`, and the fallback replay. |
| `app/book.py` | Simulated booking built from the latest itinerary. |
| `fixtures/demo-itineraries/` | Every successful itinerary is saved here. If the swarm fails, the closest one is replayed (`swarm.status` message `replay`). |

## Measured on this Mac (2026-11-06, live API)

| Turn | Concierge text | 5 agents spawned | `itinerary` | `turn.done` |
|---|---|---|---|---|
| Turn 1 | 1.4 s | 7.7–8.6 s | 34.6 s | 39 s |
| Turn 2 (same session, threads reused) | 1.3 s | ≈9 s | 31.0 s | 37 s |

The coordinator runs with `effort: low`. Sonnet 5.5 rejects `speed: fast`, so it runs at standard speed.
