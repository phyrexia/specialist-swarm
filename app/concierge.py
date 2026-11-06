"""Concierge: fast warm 1-2 sentence reply from Claude Haiku (Messages API, streaming),
plus the instant v0 itinerary sketch shown while the swarm prices and refines v1."""

from __future__ import annotations

import time
from typing import Any, AsyncIterator

from anthropic import AsyncAnthropic

from app import preferences
from app.swarm import ITINERARY_SCHEMA

MODEL = "claude-haiku-5-5"

SYSTEM = """\
You are Atlas, the warm, upbeat voice of Experience Atlas, a travel-planning service.
A team of five specialists (Explorer, Flights, Stays, Experiences, Local Insider) is building the
detailed plan in parallel while you talk. Your job: react to the traveller in 1-2 short sentences
(max 40 words), spoken aloud, with genuine enthusiasm and one concrete, specific idea that fits
(a real place, a moment, a feeling). Mention that the team is on it.
Rules:
- Do NOT ask any question (the team will ask one when the plan is ready).
- Never quote back stored preferences or earlier statements ("you said", "last time", "I remember").
- Plain spoken text only: no markdown, no lists, no emojis, no prices."""

_client: AsyncAnthropic | None = None


def client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(max_retries=1)
    return _client


def _with_prefs(system: str) -> str:
    """Append the traveller's curated preference chips as a data block."""
    block = preferences.brief_block()
    return f"{system}\n\n{block}" if block else system


async def stream_reply(history: list[dict[str, Any]], text: str) -> AsyncIterator[str]:
    """Yield text deltas. `history` is prior [{role, content}] turns (strings)."""
    messages = [*history[-8:], {"role": "user", "content": text}]
    async with client().messages.stream(
        model=MODEL, max_tokens=160, system=_with_prefs(SYSTEM), messages=messages,
    ) as stream:
        async for delta in stream.text_stream:
            yield delta


# --------------------------------------------------------------------------- v0 sketch

SKETCH_TOOL = {
    "name": "present_sketch",
    "description": "Render the instant first-draft itinerary (v0) in the traveller's UI.",
    "input_schema": ITINERARY_SCHEMA,
}

SKETCH_SYSTEM = """\
You are Atlas, the instant sketcher of Experience Atlas. Within seconds, draft a complete, plausible
first version of the trip and call present_sketch. A team of specialists refines and prices it next,
so be quick and decisive: never deliberate, never ask anything.
Rules:
- Real-world travel knowledge. Prices are simulated but plausible, in EUR, realistic for the season.
- Use exact place_id values from the PLACE CATALOG (null when nothing fits). Prefer catalog places.
- Days: as many as the traveller says, otherwise 4. Morning and afternoon every day; evening when it fits.
- Arrival and departure days are light. Add a transport entry only on days the place changes.
- Include "stay" only on the first night at each base. Never use placeholders: if the origin is
  unknown, pick a concrete major hub (e.g. London LHR) and real carriers.
- Tailor to the travellers: kids (family rooms, short transfers), solo (cost-effective), work (top-rated,
  desk, quiet; leisure in the evenings).
- KEEP IT SHORT: titles <= 5 words, every description and "why" <= 7 words, summary and weather_note
  1 short sentence each. At most 2 flights, 2 experiences, 2 insider_tips. total_estimate_eur covers the
  whole party.
- next_question MUST be an empty string."""


def _clean_ids(node: Any, valid: set[str]) -> None:
    """Null out any place_id the model invented, so the UI only resolves catalog places."""
    if isinstance(node, dict):
        if "place_id" in node and node["place_id"] not in valid:
            node["place_id"] = None
        for v in node.values():
            _clean_ids(v, valid)
    elif isinstance(node, list):
        for v in node:
            _clean_ids(v, valid)


async def sketch_itinerary(text: str, catalog: str, valid_ids: set[str]) -> dict[str, Any] | None:
    """One forced tool call on Haiku: a full itinerary (contract schema) from the first message.

    Returns None when the model did not produce a usable itinerary; raises on API errors
    (the caller logs and skips)."""
    t0 = time.monotonic()
    resp = await client().messages.create(
        model=MODEL,
        max_tokens=4096,
        thinking={"type": "disabled"},
        output_config={"effort": "low"},
        system=_with_prefs(SKETCH_SYSTEM),
        tools=[SKETCH_TOOL],
        tool_choice={"type": "tool", "name": SKETCH_TOOL["name"]},
        messages=[{
            "role": "user",
            "content": f"TRAVELLER: {text}\n\nPLACE CATALOG (id | name | country | kind):\n{catalog}",
        }],
    )
    itin = next((b.input for b in resp.content if b.type == "tool_use"), None)
    dt = time.monotonic() - t0
    if resp.stop_reason != "tool_use" or not isinstance(itin, dict) or not itin.get("days"):
        print(f"[sketch] unusable after {dt:.1f}s: stop_reason={resp.stop_reason}", flush=True)
        return None
    _clean_ids(itin, valid_ids)
    itin["next_question"] = ""
    print(f"[sketch] {len(itin['days'])} days in {dt:.1f}s, out={resp.usage.output_tokens} tok", flush=True)
    return itin
