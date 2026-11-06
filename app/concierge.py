"""Concierge: fast warm 1-2 sentence reply from Claude Haiku (Messages API, streaming)."""

from __future__ import annotations

from typing import Any, AsyncIterator

from anthropic import AsyncAnthropic

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


async def stream_reply(history: list[dict[str, Any]], text: str) -> AsyncIterator[str]:
    """Yield text deltas. `history` is prior [{role, content}] turns (strings)."""
    messages = [*history[-8:], {"role": "user", "content": text}]
    async with client().messages.stream(
        model=MODEL, max_tokens=160, system=SYSTEM, messages=messages,
    ) as stream:
        async for delta in stream.text_stream:
            yield delta
