# Experience Atlas: state (2026-11-06 15:44 CET, frozen by the Owner: "no more changes", branch `poc/travel-swarm`, profile `poc`)

## Done
- [x] Research: Managed Agents API facts, voice/video/imagery, spike latency, OpenAI Realtime events (`docs/research/`)
- [x] ADR-001 (proposed) + poc grill; 30-min demo contract (`docs/demo-contract.md`)
- [x] Media cache: 43 places, 215 Commons photos, 81 YouTube embeds (`fixtures/demo-media/`)
- [x] Backend (FastAPI + Haiku concierge + Managed Agents swarm, SSE), frontend single page, voice (Realtime ears + TTS)
- [x] Live end-to-end run through the UI: Tokyo request → v1 itinerary at 41 s, $0.08; memory carried across conversations
- [x] Brand: League of AI + Experience Atlas assets; showcase publisher (`showcase/`) posting to smol.show

- [x] Instant v0: chips replay a saved real itinerary (~0.02 s); free text gets a Haiku sketch (~5 s); v1 from the specialists in ~30–40 s
- [x] Premium light theme, Cormorant Garamond Italic, responsive from 360 to 2560 px
- [x] "Your travel specialists" framing; calm field notes instead of a seconds counter; prices only in the closing "Your trip, all together"
- [x] "My preferences" card: chips from memory, learned per turn, removable and addable
- [x] smol.show gallery: 8 items (4 by the Owner, then M1 team card + progress, then M3 live screenshots); auto-publishing stopped at 15:43

## Run
`./run.sh` (falls back to :8766 because :8765 is the Second Brain UI) → http://127.0.0.1:8766/

## Review (15:44)
The demo works live end to end on 127.0.0.1:8766. Verified: live swarm turns, v0→v1, booking, preferences routes, voice session mint and TTS. Not verified: voice with a real mic in the browser. The question posts (q01–q06) were never rendered or uploaded, because the publisher was stopped. ADR-001 is still `proposed`, and the demo is a cut of it.

## Pending
- [ ] Voice in a real browser with a mic: live transcript, barge-in, TTS (server side verified: session mint 200, TTS mp3 OK)
- [ ] Latency: the swarm takes ~30–40 s to reach the itinerary; the ADR-001 reference-plan / v0 sketch would cut the perceived wait
- [ ] No automated tests (poc profile); any promotion to `feature` starts fresh from `main` with TDD + remote QA (qf-test)
- [ ] Auditor gate: not run (poc profile skips phase 3/5); required if promoted
- [ ] Clean up the `experience-atlas-*` agents, env and memory store in the shared workspace after the hackathon
