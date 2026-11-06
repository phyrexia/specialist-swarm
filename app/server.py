"""Experience Atlas FastAPI app: static UI + chat SSE + places/media + simulated booking."""

from __future__ import annotations

import asyncio
import json
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import concierge, preferences, swarm
from app.book import build_booking

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

app = FastAPI(title="Experience Atlas")

try:
    from app.voice import router as voice_router

    app.include_router(voice_router)
except Exception as _e:  # noqa: BLE001 - voice package may not exist yet
    print(f"[server] voice router not loaded: {type(_e).__name__}: {_e}", flush=True)

for _mount, _dir in (("/web", WEB), ("/assets", ROOT / "assets"), ("/fixtures", ROOT / "fixtures")):
    _dir.mkdir(parents=True, exist_ok=True)
    app.mount(_mount, StaticFiles(directory=_dir), name=_mount.strip("/"))

CONVERSATIONS: dict[str, swarm.Conversation] = {}
SKETCHES: dict[str, dict[str, Any]] = {}  # conversation id -> v0 (prebuilt or sketch), bookable until v1
_conv_lock = threading.Lock()
SKETCH_TIMEOUT_S = 25


@app.on_event("startup")
async def _warm() -> None:
    # Provision agents in the background so the first chat does not pay for it.
    def _go() -> None:
        try:
            st = swarm.ensure_resources()
            print(f"[server] swarm ready: coordinator={st['coordinator_id']}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[server] swarm provisioning failed: {type(e).__name__}: {str(e)[:300]}", flush=True)

    threading.Thread(target=_go, daemon=True).start()
    preferences.start_seed()  # chips from the memory store when .atlas_prefs.json does not exist yet


@app.get("/", response_class=HTMLResponse)
async def index() -> Any:
    page = WEB / "index.html"
    if page.exists():
        return FileResponse(page)
    return HTMLResponse("<h1>Experience Atlas</h1><p>UI is loading — web/index.html not built yet.</p>")


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "conversations": len(CONVERSATIONS)}


@app.get("/api/places")
async def api_places() -> list[dict[str, Any]]:
    return [
        {k: p.get(k) for k in ("id", "name", "country", "kind", "lat", "lon", "scenario")}
        for p in swarm.places()
    ]


@app.get("/api/media/{place_id}")
async def api_media(place_id: str) -> dict[str, Any]:
    for p in swarm.places():
        if p["id"] == place_id:
            return {
                "photos": [{k: ph.get(k) for k in ("url", "author", "license", "source_page")}
                           for ph in p.get("photos") or []],
                "videos": [{k: v.get(k) for k in ("provider", "id", "title", "author_name", "start_seconds", "url")}
                           for v in p.get("videos") or []],
            }
    raise HTTPException(status_code=404, detail="unknown place_id")


class ChatIn(BaseModel):
    conversation_id: str | None = None
    text: str


class BookIn(BaseModel):
    conversation_id: str | None = None


class PreferenceIn(BaseModel):
    text: str


def _sse(ev: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode()


def _get_conv(cid: str | None) -> swarm.Conversation:
    with _conv_lock:
        if cid and cid in CONVERSATIONS:
            return CONVERSATIONS[cid]
        conv = swarm.Conversation(cid or uuid.uuid4().hex)
        CONVERSATIONS[conv.id] = conv
        return conv


@app.post("/api/chat")
async def api_chat(body: ChatIn) -> StreamingResponse:
    text = (body.text or "").strip()[:2000]
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    conv = _get_conv(body.conversation_id)
    preferences.learn_in_background(text)  # fire-and-forget Haiku call; never delays this turn
    first_turn = conv.version == 0 and not conv.history
    # v0 on the first turn: a quick-start chip gets its prebuilt plan at 0 s (and the swarm refines it);
    # free text gets the Haiku sketch a few seconds in.
    prebuilt = swarm.prebuilt_for(text) if first_turn else None
    if prebuilt:
        prebuilt["next_question"] = ""
        conv.base_plan = prebuilt
        SKETCHES[conv.id] = prebuilt
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def emit(ev: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, ev)

    async def run_concierge() -> None:
        full = ""
        try:
            async for delta in concierge.stream_reply(conv.history, text):
                full += delta
                await queue.put({"type": "concierge.delta", "text": delta})
        except Exception as e:  # noqa: BLE001
            print(f"[concierge] {type(e).__name__}: {str(e)[:300]}", flush=True)
            if not full:
                full = "Love it. The team is already working on your plan."
                await queue.put({"type": "concierge.delta", "text": full})
        full = full.strip()
        await queue.put({"type": "concierge.done", "text": full})
        await queue.put({"type": "speak", "text": full})
        conv.history.append({"role": "user", "content": text})
        conv.history.append({"role": "assistant", "content": full})

    async def run_sketch() -> None:
        # v0: an instant Haiku sketch, first turn only, dropped if the swarm's v1 got there first.
        try:
            itin = await asyncio.wait_for(
                concierge.sketch_itinerary(text, swarm.catalog_text(), {p["id"] for p in swarm.places()}),
                timeout=SKETCH_TIMEOUT_S,
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - the sketch is a nice-to-have
            print(f"[sketch] skipped: {type(e).__name__}: {str(e)[:300]}", flush=True)
            return
        if not itin:
            return
        if conv.version != 0:
            print("[sketch] dropped: the swarm version arrived first", flush=True)
            return
        SKETCHES[conv.id] = itin
        queue.put_nowait({"type": "itinerary", "version": 0, "sketch": True, "itinerary": itin})

    def run_swarm() -> None:
        if not conv.lock.acquire(timeout=300):
            emit({"type": "error", "message": "A previous turn is still running."})
            return
        try:
            swarm.run_swarm_turn(conv, text, emit)
        finally:
            conv.lock.release()

    async def gen():
        yield _sse({"type": "conversation", "conversation_id": conv.id})
        if prebuilt:
            yield _sse({"type": "itinerary", "version": 0, "prebuilt": True, "itinerary": prebuilt})
        sk_task = asyncio.create_task(run_sketch()) if first_turn and not prebuilt else None
        c_task = asyncio.create_task(run_concierge())
        s_task = asyncio.create_task(asyncio.to_thread(run_swarm))

        async def closer() -> None:
            await asyncio.gather(c_task, s_task, return_exceptions=True)
            # The turn never waits for the sketch: once the swarm is done, v0 is moot.
            if sk_task and not sk_task.done():
                sk_task.cancel()
                await asyncio.gather(sk_task, return_exceptions=True)
            await queue.put(None)

        close_task = asyncio.create_task(closer())
        errored = False
        try:
            while True:
                ev = await queue.get()
                if ev is None:
                    break
                if ev.get("type") == "error":
                    errored = True
                yield _sse(ev)
            if not errored:
                yield _sse({"type": "turn.done"})
        finally:
            close_task.cancel() if not close_task.done() else None
            if sk_task and not sk_task.done():
                sk_task.cancel()

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/book")
async def api_book(body: BookIn) -> dict[str, Any]:
    cid = body.conversation_id or ""
    conv = CONVERSATIONS.get(cid)
    itin = (conv.latest_itinerary if conv else None) or SKETCHES.get(cid)
    if not itin:
        raise HTTPException(status_code=404, detail="no itinerary to book yet")
    return build_booking(itin)


# --------------------------------------------------------------------------- "My preferences" card

@app.get("/api/preferences")
async def api_preferences() -> dict[str, Any]:
    return {"items": preferences.items()}


@app.post("/api/preferences")
async def api_preferences_add(body: PreferenceIn) -> dict[str, Any]:
    try:
        item = preferences.add_user(body.text)
    except preferences.PrefsFull as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"item": item, "items": preferences.items()}


@app.delete("/api/preferences/{item_id}")
async def api_preferences_remove(item_id: str) -> dict[str, Any]:
    if not preferences.remove(item_id):
        raise HTTPException(status_code=404, detail="unknown preference")
    return {"items": preferences.items()}
