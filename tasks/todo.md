# Experience Atlas: state (2026-11-06 15:23 CET, branch `poc/travel-swarm`, profile `poc`)

## Done
- [x] Research: Managed Agents API facts, voice/video/imagery, spike latency, OpenAI Realtime events (`docs/research/`)
- [x] ADR-001 (proposed) + poc grill; 30-min demo contract (`docs/demo-contract.md`)
- [x] Media cache: 43 places, 215 Commons photos, 81 YouTube embeds (`fixtures/demo-media/`)
- [x] Backend (FastAPI + Haiku concierge + Managed Agents swarm, SSE), frontend single page, voice (Realtime ears + TTS)
- [x] Live end-to-end run through the UI: Tokyo request → v1 itinerary at 41 s, $0.08; memory carried across conversations
- [x] Brand: League of AI + Experience Atlas assets; showcase publisher (`showcase/`) posting to smol.show

## Run
`./run.sh` (falls back to :8766 because :8765 is the Second Brain UI) → http://127.0.0.1:8766/

## Pending
- [ ] Voice in a real browser with a mic: live transcript, barge-in, TTS (server side verified: session mint 200, TTS mp3 OK)
- [ ] Latency: the swarm takes ~30–40 s to reach the itinerary; the ADR-001 reference-plan / v0 sketch would cut the perceived wait
- [ ] No automated tests (poc profile); any promotion to `feature` starts fresh from `main` with TDD + remote QA (qf-test)
- [ ] Auditor gate: not run (poc profile skips phase 3/5); required if promoted
- [ ] Clean up the `experience-atlas-*` agents, env and memory store in the shared workspace after the hackathon
