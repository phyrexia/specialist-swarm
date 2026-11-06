# Claude Managed Agents facts for the travel swarm (2026-11-06)

Research done by a `claude-code-guide` subagent against platform.claude.com/docs. The coordinator saved it verbatim.
Live probe on 2026-11-06, from the coordinator on the Mac, with the session's `ANTHROPIC_API_KEY`:
- With `anthropic` SDK 2.6.0, `beta.agents.list`, `beta.environments.list` and `beta.skills.list` all return OK.
- The workspace is **shared with other hackathon teams**: other teams' agents and environments show up in the list.
- The SDK exposes `beta.memory_stores`, `beta.user_profiles`, `beta.dreams`, `beta.tunnels`, `beta.vaults`, `beta.deployments` and `beta.webhooks`.

## Summary

1. Multi-agent is now `multiagent: {type: "multiagent_20261001", subagents: {predefined_agents: [...]}}`. The kit's `type: "coordinator"` is superseded but still accepted. It cannot start workflow runs or define inline subagents.
2. A predefined list holds at most 20 agents. A session holds at most 25 child threads at a time. Delegation is one level deep: a specialist cannot list subagents of its own.
3. Each specialist keeps its own model, system prompt, tools, MCP servers and skills. The coordinator pins each specialist reference to the version that was current when the coordinator was saved, so updating a specialist means updating the coordinator's list too.
4. Multi-turn works by sending another `user.message` to the same session. A turn ends at `session.status_idle`, whose `stop_reason.type` is `end_turn`, `requires_action` or `budget_reached`. The kit's stream loop breaks on any idle event.
5. Custom tools work like this: the agent emits `agent.custom_tool_use`, and the backend replies with `user.custom_tool_result` carrying `custom_tool_use_id`. Calls made by subagents are cross-posted to the primary stream. Permission policies do not apply to custom tools.
6. A remote MCP server must be reachable by Anthropic. The alternative is to wrap it as custom tools served by a self-hosted worker. Auth goes through vault credentials.
7. Memory stores are scoped to the workspace and attached when the session is created, up to 8 per session. They mount under `/mnt/memory/`. There is no per-user primitive; the docs suggest one store per end user.
8. Memory-store calls need the header `agent-memory-2026-07-22`. Sending it together with `managed-agents-2026-04-01` returns 400.
9. Session structured output is not documented. Use a custom tool such as `present_itinerary` with an `input_schema`, and validate the input on the server.
10. The Claude 5.5 ids (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) are accepted and Active. The kit's 4.x ids are also still Active.
11. No audio input or output is documented. Voice needs external STT and TTS.
12. `agent_toolset_20260401` includes `web_search` and `web_fetch`, both enabled by default. Domain lists are capped at 64.
13. The docs don't say whether web tools can return images. Image URLs need a custom tool.
14. Pricing:
    - tokens at the standard model rates
    - $0.08 per session-hour, billed only while the session is `running`
    - $10 per 1,000 searches

    Rate limits are 300 create requests and 1,200 read requests per minute per organization. Not ZDR- or HIPAA-eligible.
15. Use `budget` on session create to cap spend.

## Findings by question

### 1. Multi-agent shape
- The current type is `multiagent_20261001`. `subagents.predefined_agents` takes `{"type":"agent","id":...}`, a bare ID string, or `{"type":"self"}`. `subagents` and `workflows` are on by default; `advisor` is off by default. https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration
- `coordinator` is still accepted. To migrate, update the agent and send the whole `multiagent` block. (same page, "Move from the coordinator type")
- Limits:
  - up to 20 unique agents per predefined list
  - one level of delegation: listing an agent that has `multiagent` set fails with 400
  - at most 25 child threads per session; idle threads count until they are archived

  Sources: the same page, and https://platform.claude.com/docs/en/managed-agents/session-threads
- Parallelism is documented: "Agents can act in parallel with their own isolated context."
- Specialists can have their own tools, MCP servers and skills. Inline agents inherit the coordinator's config.
- Multi-agent is beta on all models, not a research preview. Dreams and MCP tunnels are the research-preview items.
- The coordinator and every listed agent must use the same inference geography.

### 2. Multi-turn conversation
- "To resume a session, send a `user.message` event to it as usual." https://platform.claude.com/docs/en/managed-agents/events-and-streaming
- A turn ends at `session.status_idle` with `stop_reason.type`:
  - `end_turn`
  - `requires_action`: answer each event listed in `stop_reason.event_ids`
  - `budget_reached`
- Subagent idle events are `session.thread_status_idle`. https://platform.claude.com/docs/en/managed-agents/session-threads
- A stream delivers only events emitted after it opens, so **open the stream before sending**. To reconnect, list the history, tail the stream, and skip IDs already seen.
- Sandbox state is kept for 30 days after the session is created.
- Latency is not documented.

### 3. Custom tools and remote MCP
- Declare one as `tools: [{"type":"custom","name":...,"description":...,"input_schema":{...}}]`.
  - Names are 1–128 characters from `[A-Za-z0-9_-]`.
  - Names cannot start with `mcp__` or `ant__`, and cannot clash with a built-in tool.
  - `tools` holds at most 256 entries.

  Sources: https://platform.claude.com/docs/en/managed-agents/tools, https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes-custom-tools
- The agent emits `agent.custom_tool_use`; its `id` is the one to reply to. Reply with `user.custom_tool_result` carrying `custom_tool_use_id`. **The exact JSON field names of the result body were not confirmed**, so check them against the SDK types before relying on them.
- If no client serves a declared tool, the session pauses with `requires_action`.
- Permission policies do not apply to custom tools, so put approval logic in our own code.
- Remote MCP needs streamable HTTP and must be reachable by Anthropic, directly or through an MCP tunnel (limited preview). Auth goes through `vault_ids` at session creation.

### 4. Persistent memory
- Memory stores persist across sessions. Beta header: `agent-memory-2026-07-22`. https://platform.claude.com/docs/en/managed-agents/memory
- A store is a "workspace-scoped collection of text documents". It mounts at `/mnt/memory/<slug>/`, and the agent reads and writes it with the normal file tools. Writes under a `read_write` mount persist.
- Attach a store at session creation only: `resources: [{"type":"memory_store","memory_store_id":...,"access":"read_write"|"read_only"}]`. At most 8 per session.
- The docs recommend one store per end user.
- Limits:
  - 100 kB per memory
  - 10,000 memories per store
  - versions kept for 30 days
- The header rule: `agent-memory-2026-07-22` must not be combined with `managed-agents-2026-04-01`. Session endpoints keep using `managed-agents-2026-04-01`.
- Prompt-injection warning: a `read_write` store written from untrusted input can feed malicious content into later sessions.
- Dreams consolidate a store from past sessions. They are a research preview, using the header `dreaming-2026-04-21` alongside `managed-agents-2026-04-01`. https://platform.claude.com/docs/en/managed-agents/dreams

### 5. Structured output for the UI
- Structured outputs (`output_config.format`) are documented for the Messages API only. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Use a custom tool (`present_itinerary`) whose `input_schema` defines the itinerary. The backend receives the input on `agent.custom_tool_use`. The alternative is a JSON file under `/mnt/session/outputs/`, downloaded through the Files API; files can appear a few seconds after idle. https://platform.claude.com/docs/en/managed-agents/files

### 6. Models
- `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5` are accepted, as are the 4.x ids. https://platform.claude.com/docs/en/managed-agents/overview
- Of the 4.x ids, only Sonnet 4.5 is deprecated (it retires on 2026-11-30). https://platform.claude.com/docs/en/about-claude/model-deprecations
- `temperature`, `top_p` and `top_k` are rejected on Claude 4.7 and later, and under API version `2026-10-21`.

### 7. Audio
- No audio input or output is documented for the Messages API or Managed Agents. `user.message` accepts text, image and document content. https://platform.claude.com/docs/en/managed-agents/reference

### 8. Web tools
- `agent_toolset_20260401` includes `web_search` and `web_fetch`, both enabled by default. Domain lists are capped at 64 entries. https://platform.claude.com/docs/en/managed-agents/tools-web-restrictions
- Whether they can return images or image URLs is not documented, so plan a custom media tool.

### 9. Cost and limits
- Pricing:
  - tokens at the standard rates
  - $0.08 per session-hour while `running`
  - web search: $10 per 1,000

  https://platform.claude.com/docs/en/about-claude/pricing
- Rate limits are 300 create requests and 1,200 read requests per minute per organization. https://platform.claude.com/docs/en/managed-agents/reference
- Budget: `budget: {type:"limit", max_list_cost:{amount:"125", currency:"USD"}}`, with the amount in cents as a string. When it runs out, the session pauses with `budget_reached`. https://platform.claude.com/docs/en/managed-agents/sessions
- Other limits per session: 50 `initial_events`, a 32 MB request body, 500 files and 500 skills.
- The session wall-clock limit is not documented.

## Where the kit's code contradicts current docs
- `create_coordinator.py` uses `multiagent={"type":"coordinator","agents":[...]}`, a superseded type. The current form is `multiagent_20261001` with `subagents.predefined_agents`.
- `run_deal_desk.py` breaks out of the stream on the first `session.status_idle`, ignoring `requires_action` and `budget_reached`.
- `stretch-goals.md` S8 wants two-level delegation, which the one-level rule rejects.
- The kit sets only `anthropic-beta: managed-agents-2026-04-01`. The doc examples also send `anthropic-version: 2026-10-21`.

## Implications for the travel swarm
- Use `multiagent_20261001` with `subagents.predefined_agents` and five specialists, keeping them one level deep.
- Open one session per conversation and send each user turn as a `user.message`. Treat `end_turn` as the end of a turn, and handle `requires_action` and `budget_reached` explicitly. Open the stream before sending.
- Serve search and booking as custom tools from our backend, answering every `agent.custom_tool_use`, including those cross-posted from subagents. Label simulated results as simulated.
- Keep preferences in one memory store per end user, attached at session creation. Use the `agent-memory-2026-07-22` header on memory calls.
- Render the itinerary from the input of a `present_itinerary` custom tool and validate it on the server.
- Serve images and videos through a `find_media` custom tool backed by a source we control.
- Handle voice outside the API: STT on the client, text into the session, TTS on the reply.
- Cap cost with a per-session `budget`.
- Sessions and transcripts are not ZDR-eligible and persist until deleted, so this is fine for a demo but would need a retention policy before going live.

## Checked against the `anthropic` SDK 2.6.0 types (coordinator, 2026-11-06)
- `user.custom_tool_result` params: `custom_tool_use_id` (required), `type` (required), `content` (a list of text, image, document or search_result blocks) and `is_error` (optional). Source: `types/beta/sessions/beta_managed_agents_user_custom_tool_result_event_params.py`.
- `agent.custom_tool_use` event fields: `id`, `name`, `input`, `processed_at`, `type`, and an optional `session_thread_id`. `session_thread_id` is set when a subagent's call is cross-posted to the primary stream. The server routes the result by `custom_tool_use_id`, so the client answers on the primary session.
- Custom tool params: `{type:"custom", name, description, input_schema}`.
- `multiagent` is a union of the coordinator type and the `multiagent_20261001` type, which takes a `subagents` field built from `predefined_agent` params.
- Memory store resource: `{type:"memory_store", memory_store_id, access?: read_write|read_only, instructions?: str (≤4096 chars, rendered into the memory section of the system prompt)}`.
- `beta.memory_stores.create(name, description?)`.
