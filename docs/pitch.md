# Experience Atlas: presenter cheat sheet (2 minutes)

**Team:** League of AI (Gabriel González Pineda & Leonardo Eleuteri) · Anthropic Munich Day 2 hackathon · Specialist Swarm kit

## The pitch

Experience Atlas is your AI travel companion: say what you want to do, and six Claude agents plan the trip while you talk.

## The problem

Planning a trip means dozens of tabs, and most tools start from a destination instead of from what you want to do, then forget you next time.

## Run of show (0:00–2:00)

| Time | Say or click | Point at on screen |
|---|---|---|
| 0:00 | Open the page. "This is Experience Atlas, your AI travel companion. Six Claude agents plan the trip while we talk." | The header: logo, tagline, "Six Claude agents · one Trip Architect · real places". The Concierge greeting |
| 0:10 | Click the chip "Sailing in Europe with my two kids in late June, mid budget" (or say it) | Atlas's streaming reply in the Concierge chat. First text in about 1.4 s in measured runs |
| 0:25 | Narrate the lanes as the orbs light up: "Flights is searching flights. Stays is matching a family room. Experiences is looking at boat days. Local Insider is reading the local rhythm." | The Swarm panel: orbs ignite, beams join the Trip Architect, the elapsed counter and RUNNING badge, and the activity ticker |
| 0:40 | Read the one question in ATLAS ASKS and answer it by voice or text | The v0 sketch in the Itinerary panel: badge, title, summary, date and traveller chips, weather note |
| 0:50 | When v1 lands (about 30–40 s in measured runs): "Version one. Day one stays easy, with a swim and an early dinner." | The badge flips to v1. Day-by-day cards with real Wikimedia photos. Press ▶ on a card to play a YouTube video inline |
| 1:00 | Barge in mid-sentence: "Could it be a bit nicer? Maybe somewhere with a pool." | The voice stops at once. The live transcript strip shows what you said |
| 1:15 | Answer Atlas's next question: "Yes, do that." | The Swarm panel lights up again while the plan changes |
| 1:30 | v2 builds (about 25–35 s in measured runs). Point at the estimated total in € | The badge flips to v2. Flights as boarding-pass cards, experiences, and Local Insider tips with the gold "Secret" badge |
| 1:45 | Click "Book everything →". Say: "Book everything." Confetti. | The confirmation modal: EA-XXXXX code, booked items, "Simulated booking · no payment taken" |
| 1:55 | Close: "Five Claude specialists under one Trip Architect, and every plan and reply written by Claude." | The estimated total and the booked trip |

## Why it's different

- **A goal, not a destination.** You start with what you want to do, and the plan follows from it.
- **The Local Insider is the secret sauce.** It finds what is not easy to find: a local's rhythm, not the tourist lens.
- **It remembers without being creepy.** In a live run, a new Tokyo trip remembered "two kids" from an earlier sailing chat, and Atlas never mentioned it.

## How it's built

- **Messages API, Claude Haiku 5.5:** Atlas streams its replies, and structured JSON output drives the brief and the v0 sketch.
- **Managed Agents, multi-agent:** the Trip Architect on Claude Sonnet 5.5 coordinates five Claude Haiku 5.5 specialists (Explorer, Flights, Stays, Experiences and Local Insider), which run in parallel.
- **Custom tool:** `present_itinerary` hands the finished plan to the UI. The specialists estimate prices from real-world knowledge; the prices are simulated.
- **Memory store:** one store per traveller. The backend reads it at the start of each turn, and the swarm may update it.

## If something breaks

- **Voice fails → just type.** The chat takes typed text on the same path as voice.
- **The swarm is slow → narrate the agents.** Name each lane and read out one fresh find. The lanes are the show while the plan builds.
- **The API is down → the saved itineraries replay automatically.** The closest saved itinerary plays back in the same canvas.

## Q&A cheat sheet

1. **Is the booking real?** No. Bookings are simulated, but grounded in real airports, airlines and places, and labelled "Simulated booking · no payment taken".
2. **Why six agents, not one prompt?** Flights, stays, experiences and local knowledge run in parallel, so the wait is shorter and each agent stays focused on its own domain.
3. **Who writes the words?** Claude writes every plan and every reply. OpenAI only handles the audio: Realtime listens (voice activity, live transcript, barge-in) and gpt-4o-mini-tts speaks.
4. **Does it remember me? Isn't that creepy?** Memory is stored per traveller and read at the start of each turn. Atlas is built never to quote it back, so it uses what it knows without saying so.
5. **How do you stop made-up places?** Places come from a curated catalogue of 43 real places, with 215 Wikimedia Commons photos and 81 YouTube embeds. Prices are estimates from the specialists' real-world knowledge, and they are simulated.
