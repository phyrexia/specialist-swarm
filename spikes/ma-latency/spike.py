"""Throwaway spike: measure Claude Managed Agents multi-agent latency and confirm API shapes.

Creates (all prefixed `travelswarm-spike-`): one environment, two Haiku specialists with a
custom `lookup_fact` tool, one Sonnet coordinator (`multiagent_20261001`) with a custom
`present_result` tool, and one memory store. Runs two turns in one session and one turn in a
second session that shares the memory store, logging every event with client-side timings.
Cleans up only the resources it created (ids tracked in `.state.json`).

Run:     uv run --no-project --with anthropic python spikes/ma-latency/spike.py
Cleanup: uv run --no-project --with anthropic python spikes/ma-latency/spike.py --cleanup
"""

from __future__ import annotations

import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import anthropic
from anthropic import Anthropic

HERE = Path(__file__).resolve().parent
STATE_PATH = HERE / ".state.json"
OUT_DIR = HERE / "out"
PREFIX = "travelswarm-spike-"
ENV_NAME = f"{PREFIX}env"
STORE_NAME = f"{PREFIX}user-demo"
WEATHER_NAME = f"{PREFIX}weather-scout"
INSIDER_NAME = f"{PREFIX}insider"
COORD_NAME = f"{PREFIX}coordinator"
METADATA = {"team": "travelswarm", "purpose": "latency-spike"}

# $3.00 per session; amount is in cents as a decimal string.
BUDGET = {"type": "limit", "max_list_cost": {"amount": "300", "currency": "USD"}}

TURN_DEADLINE_S = 420
STREAM_READ_TIMEOUT_S = 240

LOOKUP_FACT_TOOL = {
    "type": "custom",
    "name": "lookup_fact",
    "description": (
        "Look up one curated travel fact from the travel company's knowledge base. "
        "Call it once with a short topic, e.g. 'late June weather Split Croatia'."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"topic": {"type": "string", "description": "Short topic to look up."}},
        "required": ["topic"],
    },
}

PRESENT_RESULT_TOOL = {
    "type": "custom",
    "name": "present_result",
    "description": "Render the final plan in the traveller's UI. Call exactly once per request.",
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "2-3 sentence plan summary."},
            "picks": {"type": "array", "items": {"type": "string"}, "description": "Short list of picks."},
        },
        "required": ["summary", "picks"],
    },
}

WEATHER_SYSTEM = """\
You are the Weather Scout on a travel-planning team.
When asked about a destination: call the lookup_fact tool exactly once with a short topic
(for example "late June weather Split Croatia"), then answer in at most 2 lines with the
typical June weather there (air and sea temperature, wind, rain).
Do not use web search, web fetch, bash or files. No preamble."""

INSIDER_SYSTEM = """\
You are the Insider on a travel-planning team.
When asked about a destination: call the lookup_fact tool exactly once with a short topic
(for example "hidden spots central Dalmatia"), then give exactly 2 non-touristy spots, one line each.
Do not use web search, web fetch, bash or files. No preamble."""

COORD_SYSTEM = f"""\
You are the lead travel planner coordinating a small team of specialists:
- {WEATHER_NAME}: typical June weather of a place, in 2 lines.
- {INSIDER_NAME}: 2 non-touristy spots.

For every planning request:
1. In ONE message, delegate to BOTH specialists in parallel: start both at once, do not wait for
   one before starting the other. Give each a one-sentence brief that names the destination.
2. When both have replied, call present_result exactly once with a 2-3 sentence summary and a
   short list of picks.
3. After present_result returns, end your turn with one short sentence.
Do not use web search or web fetch yourself. Be fast.

Memory: a traveller-preferences memory store is mounted under /mnt/memory/. At the start of a
conversation, check it for saved preferences and use them. When the traveller states stable
preferences (party, interests, budget style), save them there briefly. Never quote stored
preferences back verbatim."""

MEMORY_INSTRUCTIONS = (
    f"Save stable traveller preferences to /mnt/memory/{STORE_NAME}/preferences.md as short "
    "markdown; never quote them back to the user."
)

CANNED_WEATHER = (
    "SIMULATED FACT: Central Dalmatia (Split, Hvar, Vis) in late June: air 27-30 C by day, "
    "19-21 C at night; sea 23-24 C; about 2 rainy days; afternoon maestral NW wind 10-15 kn, "
    "calm mornings - ideal for family sailing."
)
CANNED_INSIDER = (
    "SIMULATED FACT: Little-known spots: (1) Stiniva cove on Vis, best reached by boat early "
    "morning; (2) Pakleni islands' Vlaka bay off Hvar, quiet anchorage with a family konoba."
)

state: dict[str, Any] = {
    "created": {"session": [], "agent": [], "memory_store": [], "environment": []},
    "reused": {},
    "errors": [],
    "shapes": {},
}


# --------------------------------------------------------------------------- helpers

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_state() -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, default=str))


def track(kind: str, rid: str) -> None:
    state["created"][kind].append(rid)
    save_state()


def record_error(step: str, exc: BaseException) -> dict[str, Any]:
    err: dict[str, Any] = {"step": step, "class": type(exc).__name__, "message": str(exc)[:2000]}
    if isinstance(exc, anthropic.APIStatusError):
        err["status_code"] = exc.status_code
        try:
            err["body"] = exc.response.json()
        except Exception:  # noqa: BLE001 - body may be non-JSON
            err["body"] = exc.response.text[:2000]
        err["request_id"] = exc.response.headers.get("request-id")
    state["errors"].append(err)
    save_state()
    print(f"  !! {step}: {err.get('status_code', '')} {err['message'][:400]}", flush=True)
    return err


def dump(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    return obj


def short(value: Any, n: int = 160) -> str:
    s = value if isinstance(value, str) else json.dumps(value, default=str)
    return s if len(s) <= n else s[: n - 3] + "..."


def ms_since(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)


# --------------------------------------------------------------------------- resources

class _SkipProbe(Exception):
    pass


def get_or_create_env(client: Anthropic) -> str:
    for env in client.beta.environments.list(limit=100):
        if env.name == ENV_NAME and not getattr(env, "archived_at", None):
            state["reused"]["environment"] = env.id
            save_state()
            print(f"  reusing environment {env.id}")
            return env.id
    env = client.beta.environments.create(
        name=ENV_NAME,
        config={"type": "cloud", "networking": {"type": "unrestricted"}},
        metadata=METADATA,
    )
    track("environment", env.id)
    print(f"  created environment {env.id}")
    return env.id


def create_specialist(client: Anthropic, name: str, system: str) -> str:
    agent = client.beta.agents.create(
        name=name,
        model="claude-haiku-5-5",
        system=system,
        tools=[{"type": "agent_toolset_20260401"}, LOOKUP_FACT_TOOL],
        metadata=METADATA,
    )
    track("agent", agent.id)
    print(f"  created specialist {name} -> {agent.id} (v{agent.version})")
    return agent.id


def create_coordinator(client: Anthropic, specialist_ids: list[str]) -> tuple[str, str]:
    refs = [{"type": "agent", "id": sid} for sid in specialist_ids]
    common = dict(
        model="claude-sonnet-5-5",
        system=COORD_SYSTEM,
        tools=[{"type": "agent_toolset_20260401"}, PRESENT_RESULT_TOOL],
        metadata=METADATA,
    )

    # Probe: the shape as written in the brief, without `type` on `subagents`.
    probe = {"type": "multiagent_20261001", "subagents": {"predefined_agents": refs}}
    try:
        if "--no-probe" in sys.argv:
            raise _SkipProbe
        a = client.beta.agents.create(name=f"{COORD_NAME}-probe", multiagent=probe, **common)
        track("agent", a.id)
        state["shapes"]["probe_subagents_without_type"] = {"accepted": True, "stored": dump(a.multiagent)}
        print(f"  probe (subagents without type) ACCEPTED -> {a.id}; archiving now")
        client.beta.agents.archive(a.id)
    except _SkipProbe:
        pass
    except anthropic.APIError as e:
        state["shapes"]["probe_subagents_without_type"] = {"accepted": False, "error": record_error("probe_subagents_without_type", e)}

    attempts = [
        (
            "multiagent_20261001_full",
            {
                "type": "multiagent_20261001",
                "subagents": {
                    "type": "enabled",
                    "predefined_agents": refs,
                    "inline_agents": {"type": "disabled"},
                },
                "workflows": {"type": "disabled"},
            },
        ),
        (
            "multiagent_20261001_minimal",
            {"type": "multiagent_20261001", "subagents": {"type": "enabled", "predefined_agents": refs}},
        ),
        ("coordinator_fallback", {"type": "coordinator", "agents": refs}),
    ]
    for label, multiagent in attempts:
        try:
            agent = client.beta.agents.create(name=COORD_NAME, multiagent=multiagent, **common)
        except anthropic.APIError as e:
            record_error(f"create_coordinator:{label}", e)
            continue
        track("agent", agent.id)
        state["shapes"]["coordinator_multiagent_sent"] = multiagent
        state["shapes"]["coordinator_multiagent_stored"] = dump(agent.multiagent)
        state["shapes"]["coordinator_shape_label"] = label
        save_state()
        print(f"  created coordinator via {label} -> {agent.id} (v{agent.version})")
        return agent.id, label
    raise SystemExit("All coordinator shapes failed; see .state.json errors")


def create_memory_store(client: Anthropic) -> str:
    store = client.beta.memory_stores.create(
        name=STORE_NAME,
        description="Spike: stable traveller preferences for one demo user.",
        metadata=METADATA,
    )
    track("memory_store", store.id)
    print(f"  created memory store {store.id}")
    return store.id


def create_session(client: Anthropic, coord_id: str, env_id: str, store_id: str, title: str) -> Any:
    resources = [
        {
            "type": "memory_store",
            "memory_store_id": store_id,
            "access": "read_write",
            "instructions": MEMORY_INSTRUCTIONS,
        }
    ]
    state["shapes"]["session_create"] = {
        "agent": "<coordinator id>",
        "environment_id": "<env id>",
        "budget": BUDGET,
        "resources": [{**resources[0], "memory_store_id": "<memstore id>"}],
    }
    t0 = time.monotonic()
    try:
        session = client.beta.sessions.create(
            agent=coord_id, environment_id=env_id, title=title, budget=BUDGET,
            resources=resources, metadata=METADATA,
        )
        state["shapes"]["session_create_headers"] = "anthropic-beta: managed-agents-2026-04-01 (SDK default)"
    except anthropic.APIStatusError as e:
        record_error("create_session:managed-agents-only", e)
        session = client.beta.sessions.create(
            agent=coord_id, environment_id=env_id, title=title, budget=BUDGET,
            resources=resources, metadata=METADATA, betas=["agent-memory-2026-07-22"],
        )
        state["shapes"]["session_create_headers"] = "anthropic-beta: agent-memory-2026-07-22,managed-agents-2026-04-01"
    create_ms = ms_since(t0)
    track("session", session.id)
    print(f"  created session {session.id} in {create_ms} ms (status={session.status})")
    return session, create_ms


def list_memories(client: Anthropic, store_id: str) -> list[dict[str, Any]]:
    out = []
    for item in client.beta.memory_stores.memories.list(store_id, view="full", limit=20):
        d = dump(item)
        out.append({k: d.get(k) for k in ("type", "id", "path", "content", "content_size_bytes", "created_at", "updated_at") if k in d})
    return out


# --------------------------------------------------------------------------- turn runner

def lookup_fact_text(topic: str, thread_agent: str | None) -> str:
    # Route by the calling specialist; run 1 routed by keyword and sent the insider the weather fact.
    if thread_agent == INSIDER_NAME:
        return CANNED_INSIDER
    if thread_agent == WEATHER_NAME:
        return CANNED_WEATHER
    t = topic.lower()
    return CANNED_WEATHER if any(k in t for k in ("weather", "temperature", "climate")) else CANNED_INSIDER


def event_actor(ev: Any, thread_names: dict[str, str]) -> str:
    for attr in ("agent_name", "to_agent_name", "from_agent_name"):
        v = getattr(ev, attr, None)
        if v:
            prefix = {"to_agent_name": "->", "from_agent_name": "<-"}.get(attr, "")
            return prefix + v.replace(PREFIX, "")
    tid = getattr(ev, "session_thread_id", None)
    if tid:
        return "thread:" + thread_names.get(tid, tid).replace(PREFIX, "")
    return ""


def run_turn(client: Anthropic, session_id: str, text: str, label: str, thread_names: dict[str, str]) -> dict[str, Any]:
    print(f"\n=== {label}: {text!r}", flush=True)
    rec: dict[str, Any] = {
        "label": label, "session_id": session_id, "text": text, "events": [], "marks": {},
        "deltas": {"count": 0, "first_ms": None}, "custom_tool_calls": [], "agent_messages": [],
        "tool_uses": [], "usage_events": [], "idle_events": [], "errors": [], "reconnects": 0,
    }
    marks = rec["marks"]
    seen: set[str] = set()
    answered: set[str] = set()
    tool_events: dict[str, Any] = {}
    created_threads: set[str] = set()
    idle_threads: set[str] = set()

    def mark(key: str, t: int) -> None:
        marks.setdefault(key, t)

    def answer(ev: Any, t0: float) -> None:
        if ev.id in answered:
            return
        inp = ev.input or {}
        if ev.name == "present_result":
            result = "Rendered in the traveller's UI."
            mark("present_result", ms_since(t0))
            rec["present_result_input"] = inp
        elif ev.name == "lookup_fact":
            result = lookup_fact_text(str(inp.get("topic", "")), thread_names.get(ev.session_thread_id or ""))
        else:
            result = f"Unknown tool {ev.name}"
        body = {
            "type": "user.custom_tool_result",
            "custom_tool_use_id": ev.id,
            "content": [{"type": "text", "text": result}],
        }
        ts = time.monotonic()
        client.beta.sessions.events.send(session_id, events=[body])
        answered.add(ev.id)
        rec["custom_tool_calls"].append({
            "name": ev.name, "id": ev.id, "input": inp, "t_ms": int((ts - t0) * 1000),
            "send_rtt_ms": ms_since(ts), "thread": thread_names.get(ev.session_thread_id or "", ev.session_thread_id),
        })
        if "custom_tool_result_shape" not in state["shapes"]:
            state["shapes"]["custom_tool_result_shape"] = {**body, "custom_tool_use_id": "<agent.custom_tool_use event id>"}

    def catch_up(t0: float) -> None:
        """After a reconnect, answer custom tool calls we may have missed."""
        for ev in client.beta.sessions.events.list(session_id, order="desc", limit=50, types=["agent.custom_tool_use"]):
            if ev.id not in answered:
                rec["errors"].append({"catch_up_answered": ev.id})
                answer(ev, t0)

    def open_stream(with_deltas: bool):
        kw: dict[str, Any] = {"timeout": STREAM_READ_TIMEOUT_S}
        if with_deltas:
            kw["event_deltas"] = ["agent.message"]
        return client.beta.sessions.events.stream(session_id, **kw)

    try:
        stream = open_stream(True)
        rec["event_deltas"] = True
    except anthropic.APIError as e:
        rec["errors"].append(record_error(f"{label}:open_stream_with_deltas", e))
        stream = open_stream(False)
        rec["event_deltas"] = False

    t0 = time.monotonic()
    rec["send_wall_utc"] = now_iso()
    client.beta.sessions.events.send(
        session_id, events=[{"type": "user.message", "content": [{"type": "text", "text": text}]}]
    )
    rec["send_rtt_ms"] = ms_since(t0)
    done = False
    while not done:
        try:
            with stream:
                for ev in stream:
                    t = ms_since(t0)
                    if t > TURN_DEADLINE_S * 1000:
                        rec["timeout"] = True
                        done = True
                        break
                    et = ev.type
                    if et in ("event_start", "event_delta"):
                        rec["deltas"]["count"] += 1
                        if rec["deltas"]["first_ms"] is None:
                            rec["deltas"]["first_ms"] = t
                        continue
                    if getattr(ev, "id", None) in seen:
                        continue
                    seen.add(ev.id)
                    if et == "session.thread_created":
                        thread_names[ev.session_thread_id] = ev.agent_name
                        created_threads.add(ev.session_thread_id)
                    actor = event_actor(ev, thread_names)
                    rec["events"].append({
                        "t_ms": t, "type": et, "actor": actor,
                        "processed_at": str(getattr(ev, "processed_at", "") or ""),
                    })
                    extra = ""
                    mark("first_event", t)
                    if not et.startswith("user."):
                        mark("first_non_user_event", t)
                    if et == "session.thread_created":
                        mark("first_thread_created", t)
                        mark(f"thread_created:{ev.agent_name.replace(PREFIX, '')}", t)
                    elif et == "agent.thread_message_sent":
                        mark(f"delegate_to:{(ev.to_agent_name or 'primary').replace(PREFIX, '')}", t)
                    elif et == "agent.thread_message_received":
                        mark(f"reply_from:{(ev.from_agent_name or 'primary').replace(PREFIX, '')}", t)
                        extra = short(" ".join(getattr(b, "text", "") for b in ev.content), 140)
                    elif et == "session.thread_status_idle":
                        idle_threads.add(ev.session_thread_id)
                        mark(f"thread_idle:{ev.agent_name.replace(PREFIX, '')}", t)
                        extra = f"stop={ev.stop_reason.type}"
                    elif et == "span.model_request_start":
                        mark("first_model_request_start", t)
                    elif et == "agent.message":
                        mark("first_agent_message", t)
                        txt = " ".join(getattr(b, "text", "") for b in ev.content)
                        rec["agent_messages"].append({"t_ms": t, "text": txt})
                        extra = short(txt, 140)
                    elif et == "agent.tool_use":
                        rec["tool_uses"].append({"t_ms": t, "name": ev.name, "input": ev.input, "actor": actor})
                        if "/mnt/memory" in json.dumps(ev.input, default=str):
                            mark("first_memory_tool_use", t)
                        extra = f"{ev.name} {short(ev.input, 120)}"
                    elif et == "agent.custom_tool_use":
                        tool_events[ev.id] = ev
                        mark(f"custom_tool_use:{ev.name}", t)
                        extra = f"{ev.name} {short(ev.input, 120)}"
                        answer(ev, t0)
                    elif et == "session.usage":
                        rec["usage_events"].append({"t_ms": t, "usage": dump(ev.usage)})
                    elif et == "session.error":
                        rec["errors"].append({"t_ms": t, "session_error": dump(ev.error)})
                        extra = short(dump(ev.error), 200)
                    elif et == "session.status_idle":
                        sr = ev.stop_reason.type
                        rec["idle_events"].append({"t_ms": t, "stop_reason": dump(ev.stop_reason)})
                        extra = f"stop={sr}"
                        if sr == "requires_action":
                            mark("first_requires_action", t)
                            for eid in ev.stop_reason.event_ids:
                                if eid not in answered:
                                    if eid in tool_events:
                                        answer(tool_events[eid], t0)
                                    else:
                                        catch_up(t0)
                        elif sr == "end_turn":
                            open_threads = created_threads - idle_threads
                            if "present_result" in marks or not open_threads:
                                marks["end_turn"] = t
                                done = True
                            else:
                                mark("end_turn_with_open_threads", t)
                        else:
                            marks[f"stop:{sr}"] = t
                            done = True
                    elif et == "session.status_terminated":
                        marks["terminated"] = t
                        done = True
                    print(f"  {t:>7} ms  {et:<34} {actor:<22} {extra}", flush=True)
                    if done:
                        break
            if not done:
                raise RuntimeError("stream ended before end_turn")
        except (anthropic.APIError, RuntimeError) as e:
            rec["errors"].append({"stream_error": f"{type(e).__name__}: {str(e)[:300]}", "t_ms": ms_since(t0)})
            print(f"  !! stream interrupted: {e}", flush=True)
            if rec["reconnects"] >= 2 or ms_since(t0) > TURN_DEADLINE_S * 1000:
                rec["timeout"] = True
                break
            rec["reconnects"] += 1
            stream = open_stream(False)
            catch_up(t0)
    rec["wall_ms"] = ms_since(t0)
    return rec


def collect_session_stats(client: Anthropic, session_id: str, send_wall_utc: str) -> dict[str, Any]:
    """Session usage/cost plus a server-side timeline per thread (processed_at vs send time)."""
    sess = client.beta.sessions.retrieve(session_id)
    send_dt = datetime.fromisoformat(send_wall_utc)
    threads = []
    for th in client.beta.sessions.threads.list(session_id, limit=50):
        d = dump(th)
        timeline = []
        try:
            for ev in client.beta.sessions.threads.events.list(th.id, session_id=session_id, limit=100):
                pa = getattr(ev, "processed_at", None)
                rel = int((pa - send_dt).total_seconds() * 1000) if pa else None
                item: dict[str, Any] = {"type": ev.type, "server_ms_since_send": rel}
                if ev.type in ("agent.tool_use", "agent.custom_tool_use"):
                    item["name"] = ev.name
                timeline.append(item)
        except anthropic.APIError as e:
            timeline = [{"error": str(e)[:300]}]
        threads.append({
            "id": th.id, "agent": (d.get("agent") or {}).get("name"), "status": d.get("status"),
            "parent_thread_id": d.get("parent_thread_id"), "stats": d.get("stats"), "usage": d.get("usage"),
            "timeline": timeline,
        })
    return {"session": {"status": sess.status, "usage": dump(sess.usage), "stats": dump(sess.stats),
                        "budget": dump(sess.budget), "resources": [dump(r) for r in sess.resources]},
            "threads": threads}


def full_history(client: Anthropic, session_id: str) -> list[dict[str, Any]]:
    out = []
    for ev in client.beta.sessions.events.list(session_id, order="asc", limit=100):
        out.append({"type": ev.type, "processed_at": str(getattr(ev, "processed_at", "") or ""),
                    "actor": event_actor(ev, {})})
    return out


# --------------------------------------------------------------------------- cleanup

def cleanup(client: Anthropic) -> dict[str, list[str]]:
    report: dict[str, list[str]] = {"ok": [], "failed": []}
    c = state["created"]

    def attempt(desc: str, fn) -> None:
        try:
            fn()
            report["ok"].append(desc)
            print(f"  cleaned {desc}")
        except anthropic.NotFoundError:
            report["ok"].append(f"{desc} (already gone)")
        except anthropic.APIError as e:
            report["failed"].append(f"{desc}: {str(e)[:200]}")
            print(f"  !! cleanup failed {desc}: {str(e)[:200]}")

    for sid in c["session"]:
        attempt(f"session {sid} delete", lambda sid=sid: client.beta.sessions.delete(sid))
    for aid in reversed(c["agent"]):  # coordinator before specialists
        def arch(aid=aid):
            a = client.beta.agents.retrieve(aid)
            if a.archived_at is None:
                client.beta.agents.archive(aid)
        attempt(f"agent {aid} archive", arch)
    for mid in c["memory_store"]:
        attempt(f"memory_store {mid} delete", lambda mid=mid: client.beta.memory_stores.delete(mid))
    for eid in c["environment"]:
        attempt(f"environment {eid} delete", lambda eid=eid: client.beta.environments.delete(eid))
    return report


# --------------------------------------------------------------------------- main

def main() -> None:
    global state
    client = Anthropic(max_retries=2)
    if "--cleanup" in sys.argv:
        state = json.loads(STATE_PATH.read_text())
        print(json.dumps(cleanup(client), indent=2))
        return
    if STATE_PATH.exists():
        prev = json.loads(STATE_PATH.read_text())
        if any(prev.get("created", {}).values()) and not prev.get("cleaned"):
            raise SystemExit("Previous run left resources; run with --cleanup first.")

    OUT_DIR.mkdir(exist_ok=True)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    results: dict[str, Any] = {"run_id": run_id, "sdk_version": anthropic.__version__, "setup_ms": {}}
    save_state()
    try:
        t = time.monotonic()
        env_id = get_or_create_env(client)
        results["setup_ms"]["environment"] = ms_since(t)
        t = time.monotonic()
        weather_id = create_specialist(client, WEATHER_NAME, WEATHER_SYSTEM)
        insider_id = create_specialist(client, INSIDER_NAME, INSIDER_SYSTEM)
        results["setup_ms"]["two_specialists"] = ms_since(t)
        t = time.monotonic()
        coord_id, shape = create_coordinator(client, [weather_id, insider_id])
        results["setup_ms"]["coordinator_incl_probe"] = ms_since(t)
        results["coordinator_shape"] = shape
        t = time.monotonic()
        store_id = create_memory_store(client)
        results["setup_ms"]["memory_store"] = ms_since(t)

        thread_names: dict[str, str] = {}
        s1, s1_ms = create_session(client, coord_id, env_id, store_id, f"{PREFIX}session-1")
        results["setup_ms"]["session_1_create"] = s1_ms
        results["session_1_resources"] = [dump(r) for r in s1.resources]
        turn1 = run_turn(client, s1.id,
                         "Family of 3, one parent and two kids, want sailing in Croatia in late June, "
                         "mid budget. Plan quickly.", "turn1", thread_names)
        results["turn1"] = turn1
        results["turn1_stats"] = collect_session_stats(client, s1.id, turn1["send_wall_utc"])
        turn2 = run_turn(client, s1.id, "Make it more comfortable, budget is less of a concern",
                         "turn2", thread_names)
        results["turn2"] = turn2
        results["turn2_stats"] = collect_session_stats(client, s1.id, turn2["send_wall_utc"])
        results["session_1_history"] = full_history(client, s1.id)
        results["memories_after_session_1"] = list_memories(client, store_id)

        s2, s2_ms = create_session(client, coord_id, env_id, store_id, f"{PREFIX}session-2")
        results["setup_ms"]["session_2_create"] = s2_ms
        turn3 = run_turn(client, s2.id, "Where should I go next summer?", "session2_turn1", {})
        results["session2_turn1"] = turn3
        results["session2_stats"] = collect_session_stats(client, s2.id, turn3["send_wall_utc"])
        results["memories_after_session_2"] = list_memories(client, store_id)
    except Exception as e:  # noqa: BLE001 - record and still clean up
        results["fatal"] = traceback.format_exc()
        record_error("fatal", e)
    finally:
        results["shapes"] = state["shapes"]
        results["errors"] = state["errors"]
        results["created"] = state["created"]
        results["reused"] = state["reused"]
        out_path = OUT_DIR / f"run-{run_id}.json"
        out_path.write_text(json.dumps(results, indent=2, default=str))
        print(f"\nResults written to {out_path}")
        if "--keep" not in sys.argv:
            results["cleanup"] = cleanup(client)
            state["cleaned"] = not results["cleanup"]["failed"]
            save_state()
            out_path.write_text(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main()
