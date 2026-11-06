"""Voice routes: Realtime ephemeral secret (ears) and TTS proxy (mouth).

The browser opens WebRTC straight to OpenAI with the ephemeral secret; this
server never sees the audio. Realtime is configured as a transcriber only
(`create_response: false`), and speech comes from `/api/tts`.
"""

import logging
import os

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter()

OPENAI = "https://api.openai.com/v1"
REALTIME_MODEL = "gpt-realtime"
TTS_MODEL = "gpt-4o-mini-tts"
VOICE = "marin"
TTS_MAX_CHARS = 1200
TTS_INSTRUCTIONS = "Warm, upbeat, concise travel concierge; natural pace."

SESSION_CONFIG = {
    "type": "realtime",
    "model": REALTIME_MODEL,
    "instructions": "You are only a transcriber. Never respond.",
    "audio": {
        "input": {
            "noise_reduction": {"type": "near_field"},
            "transcription": {"model": "gpt-4o-mini-transcribe"},
            "turn_detection": {
                "type": "semantic_vad",
                "eagerness": "auto",
                "create_response": False,
                "interrupt_response": True,
            },
        },
        "output": {"voice": VOICE},
    },
}


def _api_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "OPENAI_API_KEY not configured")
    return key


@router.post("/api/voice/session")
async def voice_session():
    key = _api_key()
    try:
        async with httpx.AsyncClient(timeout=20) as cx:
            r = await cx.post(
                f"{OPENAI}/realtime/client_secrets",
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "expires_after": {"anchor": "created_at", "seconds": 600},
                    "session": SESSION_CONFIG,
                },
            )
    except httpx.HTTPError as e:
        log.warning("realtime mint failed: %s", type(e).__name__)
        raise HTTPException(502, "OpenAI realtime unreachable") from None
    if r.status_code >= 400:
        log.warning("realtime mint rejected: %s", r.status_code)
        raise HTTPException(502, f"OpenAI realtime: {r.status_code}")
    d = r.json()
    secret = d.get("value") or (d.get("client_secret") or {}).get("value")
    if not secret:
        raise HTTPException(502, "OpenAI realtime: no client secret")
    return {"client_secret": secret, "model": REALTIME_MODEL}


class TTSIn(BaseModel):
    text: str


@router.post("/api/tts")
async def tts(body: TTSIn):
    text = body.text.strip()[:TTS_MAX_CHARS]
    if not text:
        raise HTTPException(422, "text is empty")
    key = _api_key()
    cx = httpx.AsyncClient(timeout=httpx.Timeout(30, read=60))
    req = cx.build_request(
        "POST",
        f"{OPENAI}/audio/speech",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": TTS_MODEL,
            "voice": VOICE,
            "input": text,
            "response_format": "mp3",
            "instructions": TTS_INSTRUCTIONS,
        },
    )
    try:
        r = await cx.send(req, stream=True)
    except httpx.HTTPError as e:
        await cx.aclose()
        log.warning("tts failed: %s", type(e).__name__)
        raise HTTPException(502, "OpenAI TTS unreachable") from None
    if r.status_code >= 400:
        await r.aclose()
        await cx.aclose()
        log.warning("tts rejected: %s", r.status_code)
        raise HTTPException(502, f"OpenAI TTS: {r.status_code}")

    async def audio():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()
            await cx.aclose()

    return StreamingResponse(
        audio(), media_type="audio/mpeg", headers={"Cache-Control": "no-store"}
    )
