# Claude Managed Agents latency spike (2026-11-06)

A throwaway spike that measures the latency of real multi-agent turns and confirms the API shapes against the live API, using `anthropic` SDK 2.6.0.

- Script: `spikes/ma-latency/spike.py`.
- Summarizer: `spikes/ma-latency/summarize.py`.
- Raw per-run data, with every event, server timelines per thread and usage: `spikes/ma-latency/out/run-*.json`.
- Console logs: `spikes/ma-latency/out-run{1,2,3}.log`.

## What ran

There were **3 full runs**, each building the same setup from scratch. All resources were prefixed `travelswarm-spike-` and were deleted or archived afterwards. A final check found no live agents, environments or memory stores with that prefix.

| Piece | Config |
|---|---|
| Environment | `cloud`, `networking: unrestricted` |
| 2 specialists | `claude-haiku-5-5`, tools `agent_toolset_20260401` + custom `lookup_fact {topic}`, answered by the client with a canned string labelled SIMULATED |
| Coordinator | `claude-sonnet-5-5`, tools `agent_toolset_20260401` + custom `present_result {summary, picks[]}`, with `multiagent_20261001` |
| Memory store | `travelswarm-spike-user-demo`, attached `read_write` to both sessions |
| Session 1 | Turn 1: "Family of 3, one parent and two kids, want sailing in Croatia in late June, mid budget. Plan quickly."<br>Turn 2: "Make it more comfortable, budget is less of a concern" |
| Session 2 | New session with the same memory store. Turn 1: "Where should I go next summer?" |

How the timings were taken:
- All timings are measured on the client, from the Mac, in seconds from the start of the `user.message` POST. The stream was already open at that point.
- Server-side figures compare `processed_at` with the client's wall clock at send time, which is NTP-synced. Treat them as accurate to about ±0.2 s.

Caveats:
- Specialists were told not to use web search, so these numbers are **orchestration plus model time only**. Real tools add their own latency on the specialists' critical path.
- In run 1, my canned `lookup_fact` routed by keyword and sent the insider the weather fact, so the insider spent extra thinking on it. This was fixed in runs 2–3, which route by calling thread.
- Run 1 turn 1 ran on a cold prompt cache: 27k cache-write tokens, compared with about 3k in runs 2–3.

## Timings

The tables use these columns:
- **memory tool**: the first `agent.tool_use` that touches `/mnt/memory`.
- **X done**: the `agent.thread_message_received` from that specialist, which is when the coordinator has the specialist's answer.
- **cost**: the session's cumulative `usage.list_cost` after the turn.

### Session 1, turn 1 (cold start of a conversation)

| run | first event | memory tool (glob) | 1st `thread_created` | weather done | insider done | `present_result` | `end_turn` | cost |
|---|---|---|---|---|---|---|---|---|
| 1 (cold cache, routing bug) | 1.0 | 3.6 | 4.4 | 8.4 | 10.1 | 15.2 | 18.0 | $0.06 |
| 2 | 1.1 | 4.5 | 5.5 | 9.4 | 11.2 | 15.4 | 18.1 | $0.02 |
| 3 | 1.0 | 3.4 | 4.0 | 11.3 | 8.9 | 14.6 | 17.3 | $0.02 |
| **median (range)** | **1.0** (1.0–1.1) | 3.6 (3.4–4.5) | **4.4** (4.0–5.5) | 9.4 (8.4–11.3) | 10.1 (8.9–11.2) | **15.2** (14.6–15.4) | **18.0** (17.3–18.1) | |

The second thread was created 0.15–0.3 s after the first. The coordinator issued the memory `glob` and both delegations in the same model response.

### Session 1, turn 2 (follow-up in the same session)

| run | first event | memory tool (write) | delegation | weather done | insider done | `present_result` | `end_turn` | cost (cum.) |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.8 | 6.0 | 6.5 (reused threads) | 9.2 | 10.7 | 15.1 | 17.6 | $0.08 |
| 2 | 0.9 | 6.5 | 7.4 (reused threads) | 11.8 | 14.0 | 18.9 | 21.6 | $0.05 |
| 3 | 0.8 | 4.5 | 5.9 (2 **new** threads) | 9.5 | 11.1 | 16.5 | 19.2 | $0.05 |
| **median (range)** | 0.8 | 6.0 (4.5–6.5) | 6.5 (5.9–7.4) | 9.5 (9.2–11.8) | 11.1 (10.7–14.0) | **16.5** (15.1–18.9) | **19.2** (17.6–21.6) | |

In turn 2 the coordinator wrote the updated preference to memory **before** delegating, which put the write on the critical path. In turn 1 the write ran while the specialists were working.

### Session 2, turn 1 (new session, same memory store)

| run | first event | memory glob → read | 1st `thread_created` | weather done | insider done | `present_result` | `end_turn` | cost |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.7 | 3.4 → 5.3 | 9.9 | 13.4 | 15.6 | 19.0 | 22.3 | $0.02 |
| 2 | 1.1 | 2.3 → 4.3 | 8.0 | 11.9 | 13.4 | 17.6 | 19.9 | $0.02 |
| 3 | 0.7 | 3.0 → 5.8 | 9.3 | 12.4 | 16.2 | 20.2 | 22.3 | $0.02 |
| **median (range)** | 0.7 | 3.0 → 5.3 | **9.3** (8.0–9.9) | 12.4 (11.9–13.4) | 15.6 (13.4–16.2) | **19.0** (17.6–20.2) | **22.3** (19.9–22.3) | |

The coordinator used three sequential model calls (glob, then read, then think and delegate), so delegation started about 5 s later than in session 1 turn 1.

### Component latencies (all 9 turns)

| Component | Observed |
|---|---|
| `events.send` POST of `user.message` (round trip) | 334–695 ms, median 427 |
| Send → first stream event (`session.status_running`) | 0.65–1.14 s, median 0.88 |
| Coordinator (Sonnet 5.5) per model call, from server spans | 1.0–5.6 s, median 2.0 (n=54). The synthesis call that emits `present_result` took 3.2–5.5 s, median 4.1 (n=9) |
| Specialist (Haiku 5.5) per model call | weather: 0.49–1.9 s, median 0.79 (n=26); insider: 0.47–3.0 s, median 0.91 (n=27) |
| Specialist turnaround: `thread_created` → reply received, including 1 custom tool and about 3 model calls | 3.9–7.3 s |
| POST of `user.custom_tool_result` (round trip) | 348–907 ms, median 518 |
| `present_result` → `end_turn` (a closing model call) | 2.1–3.3 s, median 2.7 |

One-off setup costs:

| Operation | Time |
|---|---|
| `environments.create` | 1.7–1.9 s |
| `agents.create` | about 0.25–0.35 s each |
| `memory_stores.create` | 0.24–0.42 s |
| `sessions.create`, with budget and memory resource | 0.52–0.63 s |

## Request shapes that worked (SDK 2.6.0, live API)

We used a plain `Anthropic()` client. SDK 2.6.0 sets the beta header per resource:
- `managed-agents-2026-04-01` for agents, environments, sessions and events.
- `agent-memory-2026-07-22` only, for `memory_stores.*`.

We did not test the kit's client-wide `default_headers`.

**Specialist:**
```python
client.beta.agents.create(name="travelswarm-spike-weather-scout", model="claude-haiku-5-5", system=...,
    tools=[{"type": "agent_toolset_20260401"},
           {"type": "custom", "name": "lookup_fact", "description": "...",
            "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]}}],
    metadata={...})
```

**Coordinator multiagent block.** The first attempt was accepted, so the `coordinator` fallback was not needed:
```python
multiagent={
    "type": "multiagent_20261001",
    "subagents": {
        "type": "enabled",                                  # REQUIRED (see errors)
        "predefined_agents": [{"type": "agent", "id": weather_id}, {"type": "agent", "id": insider_id}],
        "inline_agents": {"type": "disabled"},              # default is enabled
    },
    "workflows": {"type": "disabled"},                      # default is enabled
}
```

The API echoes it back with each agent pinned to its version and the advisor defaulted: `predefined_agents: [{"type":"agent","id":...,"version":1}, ...]`, `advisor: {"type":"disabled"}`.

**Session with budget and memory store.** This needs only `managed-agents-2026-04-01`; the sessions endpoint did not ask for the memory header.
```python
client.beta.sessions.create(agent=coordinator_id, environment_id=env_id, title=..., metadata={...},
    budget={"type": "limit", "max_list_cost": {"amount": "300", "currency": "USD"}},   # cents, as a string
    resources=[{"type": "memory_store", "memory_store_id": store_id, "access": "read_write",
                "instructions": "Save stable traveller preferences to /mnt/memory/travelswarm-spike-user-demo/preferences.md as short markdown; never quote them back to the user."}])
```

The session's `resources[0]` comes back with the following fields:
- `mount_path: "/mnt/memory/travelswarm-spike-user-demo"`, derived from the store name.
- `name` and `description`, snapshotted at attach time.

The budget is echoed on the session and in every `session.usage` event.

**Memory store:** `client.beta.memory_stores.create(name=..., description=..., metadata=...)`.

To list contents: `client.beta.memory_stores.memories.list(store_id, view="full")`. Items look like `{type: "memory", id: "mem_…", path: "/preferences.md", content, content_size_bytes, content_sha256, memory_version_id, …}`. The path is relative to the store root.

**Stream and send:**
```python
with client.beta.sessions.events.stream(session_id, event_deltas=["agent.message"]) as stream:   # open BEFORE send
    client.beta.sessions.events.send(session_id, events=[{"type": "user.message", "content": [{"type": "text", "text": msg}]}])
    for ev in stream: ...
```

**Custom tool result.** This is sent on the primary session for both the coordinator's own calls and cross-posted subagent calls:
```python
client.beta.sessions.events.send(session_id, events=[{
    "type": "user.custom_tool_result",
    "custom_tool_use_id": ev.id,            # id of the agent.custom_tool_use event
    "content": [{"type": "text", "text": "..."}],
}])
```

**Cleanup.** All of these worked:
- `sessions.delete`
- `agents.archive`: the SDK has no `agents.delete`.
- `memory_stores.delete`
- `environments.delete`, after its sessions were deleted.

## Event semantics observed (matter for the client loop)

1. **Subagent custom tools.**
   - The child thread emits a cross-posted `session.thread_status_idle` with `stop_reason=requires_action`, then a cross-posted `agent.custom_tool_use` that carries `session_thread_id`.
   - A **session-level** `session.status_idle(requires_action)` that lists those ids appeared only once in 9 turns (run 2, session 2). That happened because the coordinator thread was itself idle at that moment.
   - So serve every `agent.custom_tool_use` as soon as it arrives, and treat `requires_action.event_ids` as a safety net.
   - The coordinator's own `present_result` always produced a session-level `requires_action` (9 of 9 turns).
2. **The coordinator thread goes idle mid-turn.** In 6 of 9 turns, the coordinator emitted `session.thread_status_idle` with `end_turn` while the specialists were still working. `session.status_idle(end_turn)` fired only once every thread was idle, in 9 of 9 turns. Stop on `session.status_idle` with `end_turn`, never on a thread-level idle.
3. **Thread reuse on follow-ups is not guaranteed.**
   - In turn 2, runs 1–2 messaged the existing specialist threads. Run 3 spawned 2 new threads.
   - A session caps child threads at 25, and idle threads count toward the cap. A conversation that re-spawns every turn would reach the cap after about 12 turns unless the prompt asks for reuse or the backend archives threads (`sessions.threads.archive`).
   - Reused threads keep their context: in run 1 turn 2, the weather scout answered without calling `lookup_fact` again.
4. **Each specialist reply triggers a coordinator model call**, often an interim `agent.message` such as "Still waiting on the insider." that costs about 1–2 s.
   - In run 1, the weather reply was sent at 6.98 s server time and delivered to the coordinator at 8.32 s. Delivery waited until the coordinator's in-flight model call ended at 8.21 s.
   - This is a single observation, but it suggests replies queue while the coordinator is busy.
5. **`event_deltas`** is accepted, but only `agent.message` and `agent.thinking` can be previewed. The `present_result` input cannot be streamed: it arrives whole. Only 2–18 delta events arrived per turn.
6. **`processed_at` lag:** stream events reached the client about 0.1–0.2 s after their server `processed_at`.

## Errors hit and resolution

| Error | Resolution |
|---|---|
| A deliberate probe sent the brief's literal shape, `subagents: {predefined_agents: [...]}`, and got 400 `invalid_request_error`: `Failed to parse request: multiagent.subagents.type: Field required` (req `req_011CgmnvjyNXwypLGDxEDR2z`) | Add `"type": "enabled"` to `subagents` (see the SDK `BetaManagedAgentsMultiagentSubagentsEnabledParams`) |
| My own bug: the canned `lookup_fact` routed by keyword, and "june" in the insider's topic returned the weather fact | Route by `session_thread_id` → agent name. Fixed for runs 2–3 |

No other API errors occurred in 9 turns:
- no 400 on the memory resource
- no budget rejection (`model_not_budgetable` did not trigger for Haiku or Sonnet 5.5)
- no `session.error`
- no stream drops or reconnects

## Raw ordered event sequence, turn 1 (run 3, 54 events)

This is the primary stream; names in brackets are the thread or agent.

```
0.97 session.status_running            0.97 session.thread_status_running [coordinator]
1.04 user.message                      1.04 span.model_request_start
3.41 agent.tool_use (glob /mnt/memory) 3.41 span.model_request_end
3.79 agent.tool_result
4.04 session.thread_created [weather-scout]   4.04 agent.thread_message_sent [->weather-scout]
4.32 session.thread_created [insider]         4.32 agent.thread_message_sent [->insider]
4.36 session.thread_status_running [weather-scout]
4.39 span.model_request_start
4.70 session.thread_status_running [insider]
5.46 session.thread_status_idle [insider] (requires_action)
5.62 session.usage
5.64 agent.custom_tool_use [thread:insider] lookup_fact
6.28 session.thread_status_running [insider]
6.54 session.thread_status_idle [weather-scout] (requires_action)
6.58 session.usage
6.58 agent.custom_tool_use [thread:weather-scout] lookup_fact
7.21 agent.tool_use (write /mnt/memory/.../preferences.md)   7.21 span.model_request_end
7.23 session.thread_status_running [weather-scout]
7.28 agent.tool_result
7.42 user.custom_tool_result [thread:insider]
7.52 user.custom_tool_result [thread:weather-scout]
7.62 span.model_request_start
8.02 session.thread_status_idle [insider] (end_turn)
8.07 session.usage
8.79 span.model_request_end
8.86 agent.thread_message_received [<-insider]
9.02 span.model_request_start
9.98 session.thread_status_idle [weather-scout] (end_turn)
9.98 session.usage
11.14 agent.thinking
11.18 agent.message ("I have the insider's two spots. I'm still waiting on the weather scout.")
11.18 span.model_request_end
11.28 agent.thread_message_received [<-weather-scout]
11.28 span.model_request_start
14.56 agent.custom_tool_use present_result
15.36 span.model_request_end
15.36 session.thread_status_idle [coordinator] (requires_action)
15.36 session.usage
15.36 session.status_idle (requires_action)
15.36 user.custom_tool_result
15.64 session.status_running           15.64 session.thread_status_running [coordinator]
15.87 span.model_request_start
17.22 agent.message                    17.22 span.model_request_end
17.33 session.thread_status_idle [coordinator] (end_turn)
17.33 session.usage
17.33 session.status_idle (end_turn)
```

## Did memory carry over?

**Yes, in 3 of 3 runs.**

What session 1 stored:
- Turn 1 created `/preferences.md` in the store, at `/mnt/memory/travelswarm-spike-user-demo/preferences.md` in the container.
- Turn 2 updated the budget line. Run 1's final content:

  ```
  # Traveller preferences
  - Party: one parent + two kids (family of 3)
  - Interests: sailing; Croatia trip, late June
  - Budget style: comfort-first, budget less of a concern (was mid)
  ```

What session 2 did:
- With no context in the message, the coordinator globbed `/mnt/memory/**/*` at 2.3–3.4 s and read `preferences.md` at 4.3–5.8 s.
- It then proposed a late-June family sailing trip in central Dalmatia aimed at comfort. That answer could only have come from memory.
- The final message did not quote the file, as instructed.
- Session 2 did not modify the memory: `updated_at` was unchanged.

## Cost signals

**Where the API reports usage:**
- `session.usage` events arrive on the stream at every thread idle. Each one carries cumulative values:
  - `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation.{ephemeral_5m,1h}`
  - `list_cost: {amount: "<cents>", currency: "USD"}`
  - `active_seconds`
  - `server_tool_use.{web_search_requests, web_fetch_requests}`
  - the session `budget`
- `sessions.retrieve(id).usage` has the same fields.
  - Its `usage.active_seconds` counts overlapping threads once, which is the billing basis.
  - `stats.active_seconds` sums the threads instead.
- `sessions.threads.list` returns per-thread `usage.list_cost`, rounded to cents. The specialists showed $0.00 each.

**What it cost:**

| Turn | List cost |
|---|---|
| Turn 1 | $0.06 with a cold cache, $0.02 warm |
| Session 1 after 2 turns | $0.05–0.08 |
| Session 2, single turn | $0.02 |

- Tokens are dominated by cache reads: about 107k–155k per turn, across about 10 model calls.
- Runtime is 16–22 active seconds per turn, about $0.0004 at $0.08 per session-hour.
- The whole spike (3 runs, 9 turns) cost about $0.24 at list price.

## Implications for the design

**Latency budget**, measured with 2 Haiku specialists, 1 fast custom tool each, a Sonnet coordinator and no web search:

| Phase | Median, s after send |
|---|---|
| Session wakes | 0.9 |
| Coordinator's first decision; delegation issued | 4.4 |
| Each specialist done | +4–7 after spawn |
| Synthesis | +3.2–5.5 |
| **`present_result`** | **15.2** (range 14.6–18.9 across new and follow-up turns) |
| Closing message | +2.7 |
| **`end_turn`** | **18.0** (17.3–21.6) |

A fresh session that first reads memory adds about 4–5 s: `present_result` lands at 19.0 s and `end_turn` at 22.3 s.

Recommendations:

1. **Render the itinerary on `present_result`, not on `end_turn`.** This saves 2.1–3.3 s of perceived latency, because the closing sentence is pure overhead. Also tell the coordinator to end its turn without a summary sentence.
2. **Stream progress to the UI.** Use `thread_created` at about 4 s and each specialist reply at about 9–11 s. Otherwise the screen is blank for about 15 s, and `event_deltas` cannot stream the tool payload.
3. **Take memory reads off the critical path.** Have the backend read the store with `memories.list(view="full")`, which is one API call (not timed in the spike; `memory_stores.create` took 0.24–0.42 s), and inject the preferences into the first `user.message`. Also tell the coordinator to save preferences only *after* `present_result`. In this spike, discovering memory cost about 5 s in a fresh session. In turn 2, with the write issued first, delegation came about 2 s later than in turn 1 (median 6.5 s against 4.4 s).
4. **Serve custom tools concurrently.** Use async or a thread pool. Serving them one at a time delayed the second specialist's result by one POST round trip, 0.35–0.9 s. Real tool backends must answer fast: every second they take adds directly to the specialist's critical path.
5. **Fix the client loop's stop rules.**
   - Stop only on `session.status_idle` with `end_turn`.
   - Answer `agent.custom_tool_use` as soon as it arrives, whichever thread it comes from.
   - Use `requires_action.event_ids` only as a safety net.
   - Handle `budget_reached`.
6. **Manage threads.** Tell the coordinator to reuse existing specialist threads on follow-ups, or archive them, because of the 25-thread cap.
7. **Expect five specialists to cost more, not less.** This is an estimate, not measured:
   - Spawns are serial, about 0.15–0.3 s apart.
   - Every specialist reply triggers a coordinator model call of about 1–2 s, and replies queue while it is busy.
   - The slowest specialist plus its real tools sets the floor.
   - A reasonable expectation is `present_result` at about 18–25 s without web search. Each `web_search` adds several seconds on that specialist's path.
8. **Create agents and environments at deploy time, not per conversation.** Environment creation takes about 1.8 s and agent creation about 0.3 s each. Per conversation, only `sessions.create` (about 0.55 s) is needed, plus about 0.9 s of wake-up on the first send.
9. **The budget is not a practical constraint at this scale.** Observed cost was $0.02–0.08 per session, so a $3 cap is 40–150× headroom and only matters for runaway web-search or tool loops. A $1 per-session cap would still be safe for a demo.
