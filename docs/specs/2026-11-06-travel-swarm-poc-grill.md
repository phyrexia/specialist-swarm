# Grill (poc): Experience Atlas, a travel-agent swarm

- **Date**: 2026-11-06
- **Profile**: `poc` (branch `poc/travel-swarm`; never a PR to `main` or `staging`)
- **Participants**: Gabriel (Owner, vision), Designer (grill). The Owner's answers are the decisions in the Designer brief (`/tmp/travel-swarm/designer-brief.md`, items 1–13) and the Coordinator's follow-up messages from the same day.
- **Origin**: "A swarm of agents acting as a personal travel agent, not a travel portal. Fast and incredible, with a WOW effect. Fan out and build it completely." Built for the Anthropic Partner Basecamp hackathon. Product name **Experience Atlas**, tagline "Your AI travel companion", by the team League of AI.

## Problem (one line, no solution)

People know what they want to *do* on a trip, but turning that goal into a concrete, bookable plan that fits who is travelling takes hours of portal searching and still doesn't let them feel the trip before they pay.

## Hypothesis

A voice-and-text concierge that answers in under 2 s, backed by five Claude specialist agents working in parallel, can do three things:
- turn a goal ("sailing in Europe with my two kids") into a first itinerary that *looks* like an itinerary within 6 s;
- deliver a validated, schedule-consistent itinerary from the swarm within 35 s;
- produce a visibly better version on every later turn, without feeling intrusive.

If all three hold, the swarm wait becomes the show rather than lag, and that is the demo.

## Assumptions challenged

| Assumption | Question | Owner's answer | Status |
|---|---|---|---|
| A swarm can hold a voice conversation | Measured coordinator + 2 specialists: `present_result` median 15.2 s, `end_turn` 18.0 s (`docs/research/2026-11-06-managed-agents-spike.md`). Voice needs < 2 s. Who talks while the swarm thinks? | "Decide explicitly whether a fast conversational layer fronts the swarm" (brief) | confirmed: a fast Claude concierge fronts the swarm (ADR-001) |
| The user names a destination | Can the system start from a goal with no place in it? | "It understands the user's goal, what they want to do, rather than where" | confirmed |
| More questions give a better plan | How many questions per turn? | "One question at a time; never overwhelm" | confirmed |
| Showing what it remembers builds trust | Should memory be visible to the traveller? | "The user must never feel the agent knows too much" | confirmed: memory is silent; presenter-only X-ray |
| Real inventory is needed for credibility | Real bookings? | "Simulated, with real-world knowledge"; booking returns a mock confirmation | confirmed |
| Generated video gives the wow | Which video provider? | No authorized key; Sora and Veo 3.1 preview are gone. Use real footage | confirmed |
| OpenAI voice should be the conversational brain | Who authors what the user hears? | "This is an Anthropic hackathon, so the swarm showcasing Claude matters"; pick with measurable reasons | confirmed: Claude is the only brain, OpenAI Realtime is ears and mouth |

## Hard constraints (with numbers)

- **Who uses it and how often:** 1 presenter in a 2-minute live demo, plus rehearsals (about 10 conversations and 40 turns in total). Not a product.
- **Baseline without it:** the kit's Deal Desk runs one batch turn with no conversation, voice, UI or memory.
- **Latency targets:**
  - end of speech to first spoken word: p50 ≤ 2.0 s
  - first message to sketch (v0) rendered: ≤ 6 s
  - first message to swarm version 1: p50 ≤ 35 s
- **Cost:**
  - Managed Agents session `budget` of $2.00 (`"200"` cents)
  - backend daily guard of $20 on Managed Agents `list_cost`
  - spike cost was $0.02–0.08 per session
- **Platform limits:**
  - ≤ 20 predefined agents
  - ≤ 25 child threads per session
  - delegation one level deep
  - memory: 100 kB per memory
  - `instructions` ≤ 4,096 chars
- **Data touched:** a traveller profile in one Managed Agents memory store per user (workspace shared with other teams; not ZDR-eligible). Only demo personas, no real personal data.
- **Keys:** `ANTHROPIC_API_KEY` (env) and the OpenAI key from the macOS Keychain (`openai-tts-api-key`). The OpenAI key is never written to a file and never sent to the browser except as an ephemeral `ek_` secret.
- **Tests:** headless and without keys, on remote QA workers through `qf-test`; nothing runs on the Mac except the Coordinator's live smoke run.
- **Irreversible:** nothing. All Managed Agents resources are prefixed `experience-atlas-`, carry metadata `{"team":"league-of-ai","app":"experience-atlas"}`, and can be archived or deleted.

## What is NOT built (explicit)

- Real inventory, payments, real bookings or any supplier API. Prices and availability are simulated.
- Accounts, authentication, multiple devices, mobile layout, or a deployment beyond `localhost` on the Owner's Mac.
- Generated video and generated destination photos.
- A user-facing "what I know about you" screen; memory editing or deletion UI (out of scope for the poc).
- Languages other than English for UI and voice.
- Live YouTube search (no key) and Pexels or Unsplash (no key).
- A PR to `main` or `staging` (poc rule).

## Discard criterion (measurable)

Across 3 rehearsal runs of the demo script, with real keys on the Mac, **drop the live swarm architecture** and demo from the replay recording only, then record `Resultado: descartada` if any of these hold:
1. Swarm version 1 latency p50 > 60 s.
2. End of speech to first spoken word p50 > 3.0 s.
3. `present_itinerary` still fails server validation after 2 retries in ≥ 2 of 3 runs.
4. The throwback guard or the one-question rule is violated in > 1 of 10 scripted turns, counted after the guard runs, on what the user actually hears or reads.
5. Memory does not change the second conversation's first draft (family room and slow first morning) in ≥ 2 of 3 runs.

## Deadline

- Build and demo: 2026-11-06, the hackathon day.
- poc closure line below: 2026-11-20 (14 days).

## Open questions for the Owner

- Approve the Designer calls listed in ADR-001 ("Calls made by the Designer"), in particular:
  - the voice split, with Claude as brain and OpenAI Realtime as ears and mouth;
  - English-only;
  - Munich (MUC) as the default origin.

## Next step

- ADR: `docs/adrs/001-travel-swarm-architecture.md` (Status: proposed), with contracts in `docs/adrs/001-travel-swarm-architecture-contracts.md`.
- Build plan: `docs/plans/2026-11-06-travel-swarm-build-plan.md`.
- The poc profile skips the adversarial audit of the spec (delivery-lifecycle, phase 3).

Resultado: _pending_ (write `Resultado: descartada, <date>` or `Resultado: promovida a <feature grill path>, <date>`)
