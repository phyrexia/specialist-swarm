# OpenAI Realtime and TTS: facts for a browser voice UI (VAD, barge-in, live transcript)

- Date verified: 2026-11-06
- Scope: browser voice UI with voice activity detection (VAD), barge-in and a live transcript; speaking text supplied by another brain.
- Method: official OpenAI docs (developers.openai.com) fetched with WebFetch, plus a live probe of the API with the Owner-authorised key.
- Status legend: **[V]** verified on an official page or by the probe. **[P]** partly verified: the official page was truncated or only lists the name. **[NV]** not verified; do not build on it without checking.

## 0. Live probe (2026-11-06, this Mac)

The key was read inside the process from the Keychain (`openai-tts-api-key`). It was not printed, written to disk or logged. Secret values were not printed; only status, keys and `expires_at`.

| Step | Request | HTTP | Result |
|---|---|---|---|
| (i) | `GET /v1/models` | 200 | 96 models in total. Ids that contain `realtime`, `transcribe` or `tts` are listed below. |
| (ii) | `POST /v1/realtime/client_secrets`, `session.type: "realtime"`, `model: "gpt-realtime"`, `audio.input.transcription.model: "gpt-4o-mini-transcribe"`, `turn_detection: {type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true}`, `audio.output.voice: "marin"`, `expires_after: {anchor: "created_at", seconds: 600}` | 200 | Top-level keys: `expires_at`, `session`, `value`. `expires_at` = 1793973986 (Unix seconds). `value` is a string of 35 characters (not printed). Returned `session.type = realtime`. |
| (iii) | `POST /v1/realtime/client_secrets`, `session.type: "transcription"`, `audio.input.transcription.model: "gpt-4o-mini-transcribe"`, `turn_detection: {type: "semantic_vad"}`, `noise_reduction: {type: "near_field"}` | 200 | Top-level keys: `expires_at`, `session`, `value`. `expires_at` = 1793973987. `value` is a string of 35 characters (not printed). Returned `session.type = transcription`. |

Probe notes:
- The probe did not test `gpt-realtime-2.1` or `gpt-realtime-2.1-mini`. It used `gpt-realtime`, which is scheduled for shutdown (see section 7).
- The probe confirms that the transcription session accepted `semantic_vad` with `gpt-4o-mini-transcribe`. The official transcription guide says `gpt-live-transcribe` does **not** support `server_vad` or `semantic_vad` (see 1.3). That is a different model, so the two results don't conflict, but the probe did not test `gpt-live-transcribe` with VAD.
- The probe did not exercise any audio, WebRTC or event stream.

Realtime-capable and transcription ids present in `GET /v1/models` at 2026-11-06 (filtered):

```
gpt-4o-mini-transcribe
gpt-4o-mini-transcribe-2025-03-20
gpt-4o-mini-transcribe-2025-12-15
gpt-4o-mini-tts
gpt-4o-mini-tts-2025-03-20
gpt-4o-mini-tts-2025-12-15
gpt-4o-transcribe
gpt-4o-transcribe-diarize
gpt-live-transcribe
gpt-realtime
gpt-realtime-1.5
gpt-realtime-2
gpt-realtime-2.1
gpt-realtime-2.1-mini
gpt-realtime-2025-08-28
gpt-realtime-mini
gpt-realtime-mini-2025-12-15
gpt-realtime-translate
gpt-realtime-whisper
gpt-transcribe
tts-1
tts-1-1106
tts-1-hd
tts-1-hd-1106
```

## 1. Model ids

### 1.1 Conversation (realtime) models [V]
- Current candidates: `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` (released July 2026, per the changelog). Also in the list: `gpt-realtime-2`, `gpt-realtime-1.5`, `gpt-realtime`, `gpt-realtime-mini` (and dated snapshots).
- Recommended replacements: `gpt-realtime` and `gpt-realtime-mini` families shut down 2027-01-20. Replacements: `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`. Source: https://developers.openai.com/api/docs/deprecations
- Changelog for GPT-Realtime-2.1: "better alphanumeric recognition, silence and noise handling, and interruption behavior." Source: https://developers.openai.com/api/docs/changelog (via search; the changelog page was not fetched directly, so treat the wording as **[P]**).
- Model page for `gpt-realtime`: https://developers.openai.com/api/docs/models/gpt-realtime
- Sample of model examples in the `client_secrets` schema: `gpt-realtime`, `gpt-realtime-1.5`, `gpt-realtime-2`, `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-realtime-mini`, `gpt-audio-1.5`, `gpt-audio-mini`. Arbitrary strings are also accepted. Source: https://developers.openai.com/api/docs/api-reference/realtime-sessions/create-realtime-client-secret

### 1.2 Transcription models allowed in `audio.input.transcription.model` [V]
From the `client_secrets` schema enum: `whisper-1`, `gpt-transcribe`, `gpt-live-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, `gpt-realtime-whisper`. Source: https://developers.openai.com/api/docs/api-reference/realtime-sessions/create-realtime-client-secret

### 1.3 Which transcription model fits which session type [V for the guide wording; P for model-specific rules]
- The transcription guide recommends `gpt-live-transcribe` for streaming transcription in a transcription session. It also says `gpt-transcribe` works in a dedicated transcription session when transcription should start after a committed audio turn, or when detected-language output is needed. Source: https://developers.openai.com/api/docs/guides/realtime-transcription
- The same page says `gpt-live-transcribe` "doesn't support `server_vad` or `semantic_vad`" and recommends client-side VAD, then `input_audio_buffer.commit`. For `gpt-live-transcribe` and `gpt-transcribe`, `turn_detection` is set to `null`. Source: same page.
- The page does **not** list which models are valid for conversation sessions. **[NV]**
- `gpt-4o-mini-transcribe` is accepted (probe (iii)), but it is scheduled for shutdown (see 7.3).

### 1.4 Transcription model deprecations [V]
- `gpt-4o-mini-transcribe` (including `-2025-12-15`), `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, `whisper-1`: shut down 2027-02-26. Replacements: `gpt-live-transcribe` or `gpt-transcribe`. Source: https://developers.openai.com/api/docs/deprecations
- `gpt-4o-mini-transcribe-2025-03-20`: shut down 2027-01-20, replacement `gpt-4o-mini-transcribe-2025-12-15`. Source: same.

## 2. `POST /v1/realtime/client_secrets`

Source for all of 2: https://developers.openai.com/api/docs/api-reference/realtime-sessions/create-realtime-client-secret [V unless marked]

### 2.1 Top-level body
- `expires_after` (optional): `{ "anchor": "created_at", "seconds": <int> }`. `anchor` only supports `"created_at"` (default). `seconds` default 600, range 10–7200.
- `session` (optional): either a realtime or a transcription session config.

### 2.2 (a) Conversation session, `session.type: "realtime"`
- `model`: string or enum (see 1.1).
- `audio.input.transcription`: object, or `null` to turn off. Fields: `model` (enum in 1.2), `language`, `languages`, `keywords`, `prompt`, `delay`.
- `audio.input.turn_detection`: object, or `null` to turn off. Must be `null` for `gpt-realtime-whisper`.
  - `server_vad`: `type: "server_vad"` (default); `create_response` (bool, default `true`); `interrupt_response` (bool, default `true`); `threshold` (0.0–1.0, default 0.5); `prefix_padding_ms` (default 300); `silence_duration_ms` (default 500); `idle_timeout_ms` (5000–30000 or `null`).
  - `semantic_vad`: `type: "semantic_vad"`; `eagerness`: `low` | `medium` | `high` | `auto` (default; `auto` = `medium`). Maximum waits: 8 s (low), 4 s (medium), 2 s (high); `create_response` (default `true`); `interrupt_response` (default `true`).
  - The doc only says that `interrupt_response` and `create_response` appear alongside VAD; it does not separately describe `interrupt_response` alone. **[P]**
- `audio.input.noise_reduction`: object or `null`. `type`: `near_field` (close-talking mic) or `far_field` (distant mic). `strength` (0–1, default 1).
- `audio.input.format`: `audio/pcm` (24 kHz only), `audio/pcmu`, `audio/pcma`.
- `audio.output.voice`: `alloy` (default), `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar`, or `{ "id": "voice_..." }` (custom). Docs recommend `marin` or `cedar`.
- `audio.output.format` and `audio.output.speed` (0.25–1.5, default 1).
- `instructions`: string (system prompt).
- `tools`: array. Function tool: `{ "type": "function", "name", "description", "parameters": <JSON Schema> }`. MCP tool: `{ "type": "mcp", "server_label", ... }`.
- Other fields: `output_modalities` (`["audio"]` default, or `["text"]`), `max_output_tokens` (1–4096 or `"inf"`), `reasoning.effort`, `tool_choice`, `tracing`, `truncation`, `prompt`, `include`.

Probe (ii) body that returned 200:

```json
{
  "expires_after": {"anchor": "created_at", "seconds": 600},
  "session": {
    "type": "realtime",
    "model": "gpt-realtime",
    "audio": {
      "input": {
        "transcription": {"model": "gpt-4o-mini-transcribe"},
        "turn_detection": {"type": "semantic_vad", "eagerness": "auto",
                           "create_response": true, "interrupt_response": true}
      },
      "output": {"voice": "marin"}
    }
  }
}
```

### 2.3 (b) Transcription-only session, `session.type: "transcription"` [V]
- Accepts only `type`, `audio` (with `input`: `format`, `noise_reduction`, `transcription`, `turn_detection`), and `include`.
- Probe (iii) body that returned 200:

```json
{
  "expires_after": {"anchor": "created_at", "seconds": 600},
  "session": {
    "type": "transcription",
    "audio": {
      "input": {
        "transcription": {"model": "gpt-4o-mini-transcribe"},
        "turn_detection": {"type": "semantic_vad"},
        "noise_reduction": {"type": "near_field"}
      }
    }
  }
}
```

- The transcription guide (1.3) says `gpt-live-transcribe` must not use VAD. Use `gpt-live-transcribe` with `turn_detection: null` and client-side end-of-turn + `input_audio_buffer.commit`, not the probe (iii) body.

### 2.4 Response shape and TTL [V]
- `value` (string): the ephemeral client secret, `ek_...`. This is the field the browser uses as `Authorization: Bearer <value>`.
- `expires_at` (integer): Unix seconds.
- `session`: the effective session object (`RealtimeSessionCreateResponse` or `RealtimeTranscriptionSessionCreateResponse`).
- TTL: the secret expires `seconds` after `created_at` (default 600, max 7200). Expiry only stops new sessions from being created with the secret; a session that has started continues, and one secret can create multiple sessions before it expires.

## 3. WebRTC flow

Source: https://developers.openai.com/api/docs/guides/voice-webrtc (fetched) and the official WebRTC guide. The URL `https://developers.openai.com/api/docs/guides/realtime-webrtc` returned 404 and is not used.

- Ephemeral key path [V]: the server calls `POST /v1/realtime/client_secrets` (section 2) and returns `value` to the browser. The browser calls `POST https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer <ephemeral key>` and `Content-Type: application/sdp`. Body: the SDP offer. Response: the SDP answer, which is applied as the remote description.
- `?model=` query parameter: the page's example does not pass it; the session config is set when the client secret is created. A community thread reports an empty 400 when `?model=` was appended to `/v1/realtime/calls`. Use no query string. Source: https://community.openai.com/t/realtime-webrtc-returns-empty-400-when-hitting-v1-realtime-calls-model/1363928 (secondary; **[P]**).
- Server-side unified variant [V]: the backend `POST`s `https://api.openai.com/v1/realtime/calls` as `multipart/form-data` with an `sdp` part and a `session` JSON part, using the standard API key. The browser-to-server leg uses `application/sdp`.
- Data channel [V]: label `oai-events`. Create it and register its listeners **before** creating the SDP offer. Audio goes over the media track. Events (transcript, tool calls, errors) travel as JSON on the data channel. Do not send `session.start` (that is a GPT-Live event; see below).
- GPT-Live (`/v1/live/sessions`, model `gpt-live-1`) is a separate product and uses a different flow: the server calls `POST /v1/live/sessions` with `transport: {type: "webrtc", sdp}` and the browser never calls OpenAI directly. Source: https://developers.openai.com/api/docs/guides/voice-webrtc **[V]**. Not used in this plan.

## 4. Event names and payloads

### 4.1 Client events (sent by the browser)
| Event | Payload fields | Status |
|---|---|---|
| `session.update` | `session` (same shape as 2.2) | [V] https://developers.openai.com/api/docs/guides/realtime-conversations |
| `conversation.item.create` | `item` with `type`, `role`, `content` parts (`input_text`, `input_audio`, `input_image`). Function results: `type: "function_call_output"`, `call_id`, `output`. | [V] same page |
| `response.create` | `response` with `output_modalities`, `conversation` (`"none"` for out-of-band), `metadata`, `instructions`, `input`, `tools` | [V] same page |
| `input_audio_buffer.append` | `audio` (base64). Each chunk ≤ 15 MB. | [V] same page (WebSocket; WebRTC uses the media track) |
| `input_audio_buffer.commit` | none listed | [V] same page |
| `input_audio_buffer.clear` | none listed | [V] same page |
| `conversation.item.truncate` | `item_id`, `content_index`, `audio_end_ms` | [V] same page (WebSocket; not needed over WebRTC) |
| `response.cancel` | none listed | [V] same page |
| `output_audio_buffer.clear` | none listed (WebRTC/SIP) | [V] same page |

### 4.2 Server events (received by the browser)
| Event | Payload | Status |
|---|---|---|
| `session.created` / `session.updated` | session state | [V] https://developers.openai.com/api/docs/guides/realtime-conversations |
| `input_audio_buffer.speech_started` / `speech_stopped` / `committed` | Speech boundaries (`audio_start_ms` / `audio_end_ms`, `item_id` expected). The guide gives no field list. | [P] same page; fields from the reference were not confirmed |
| `conversation.item.input_audio_transcription.delta` | `item_id`, `content_index`, `delta` | [V] https://developers.openai.com/api/docs/guides/realtime-transcription |
| `conversation.item.input_audio_transcription.completed` | `item_id`, `content_index`, `transcript`. With `gpt-transcribe`, also `languages` (array of `{code}`; empty if no reliable prediction). `gpt-live-transcribe` returns no language. | [V] same page |
| `conversation.item.input_audio_transcription.failed` | not documented in the guide; name appears in the Go example | [P] |
| `response.output_audio_transcript.delta` / `.done` | assistant audio transcript progress | [P] named on realtime-conversations; payload not confirmed |
| `response.output_text.delta` / `.done` | assistant text progress | [V] named on realtime-conversations |
| `response.output_audio.delta` | base64 audio chunk | [V] same page |
| `response.output_audio.done` | transcript-only marker, no audio bytes | [V] same page |
| `response.function_call_arguments.delta` | streaming function arguments | [V] same page |
| `response.function_call_arguments.done` | final JSON string `arguments`, `call_id`. Also fires when a response is interrupted or cancelled; check `response.status` before running the function. | [P] only from a Microsoft Azure reference (https://learn.microsoft.com/en-us/azure/foundry-classic/openai/realtime-audio-reference-ga) and a search snippet; not on an OpenAI page that was fetched |
| `response.done` | `response.status`, `status_details`, `output` (items with `type`, `name`, `call_id`, `arguments`), `metadata` | [V] realtime-conversations |
| `conversation.item.added` / `.done`, `response.created`, `response.output_item.added/done`, `response.content_part.added/done` | lifecycle markers | [V] names only |
| `output_audio_buffer.cleared` | fired when the user interrupts in VAD mode or the client cuts audio; preceded by `response.cancel`. WebRTC/SIP only. | [P] Microsoft Azure reference + search snippet; not confirmed on an OpenAI page |
| `output_audio_buffer.started` / `.stopped` | not verified | [NV] |
| `conversation.item.truncated` | not verified | [NV] |
| `error` | `error.type`, `error.code`, `error.message`, `error.param`, `event_id` (the id of the causing client event) | [V] https://developers.openai.com/api/reference/resources/realtime/server-events (partly fetched) and realtime-conversations |
| `rate_limits.updated` | listed in lifecycle tables | [V] name only |

Caution: for every item marked [P] or [NV] above, read the current OpenAI Realtime server-events reference before coding. The reference page was truncated in the fetch at `conversation.item.done`.

## 5. Barge-in over WebRTC

- Automatic handling [V] (realtime-conversations, WebRTC section): with VAD enabled the server detects user speech, cancels the ongoing response, starts a new one, and "will automatically truncate unplayed audio when there's a user interruption." The client sends **no** events before sending audio over WebRTC.
- `interrupt_response` (default `true`) and `create_response` (default `true`) are the settings that control this. Setting both to `false` keeps VAD but stops automatic response creation. The doc does not separately describe `interrupt_response: false` alone. **[P]**
- Client events needed for automatic barge-in: none.
- Manual or push-to-talk (VAD off) [V]: on press, send `input_audio_buffer.clear`. If a response is in progress, send `response.cancel`. If audio is still playing, send `output_audio_buffer.clear`. On release, send `input_audio_buffer.commit`, then `response.create`.
- Truncation signals [P]:
  - Server truncation over WebRTC is automatic (above). The client does not send `conversation.item.truncate` on WebRTC.
  - `output_audio_buffer.cleared`: fires when the user interrupts in VAD mode or the client cuts audio (Azure reference + search; not on an OpenAI page). **[P]**
  - `conversation.item.truncate` (`item_id`, `content_index`, `audio_end_ms`): the WebSocket procedure, where the client tracks playback; the doc says it "removes the unplayed portion from the conversation." **[V]** (realtime-conversations).
- Playback position for the live transcript: over WebRTC the client does not own playback, so the transcript shown should use the `response.output_audio_transcript.*` deltas. If the UI must show only what was actually heard, that needs a check against the audio playback clock; the docs did not verify how to get the played-up-to time over WebRTC. **[NV]**

## 6. Speaking supplied text (from another brain) and injecting context

Source: https://developers.openai.com/api/docs/guides/realtime-conversations (fetched) [V unless marked]

- Out-of-band response: `response.create` with `response: { conversation: "none", input: [], instructions: "...", metadata: {...} }`. Setting `conversation: "none"` makes the response not added to the default conversation state. `input: []` excludes existing context. Use `metadata` to match the response in `response.done`. **[V]**
- Near-verbatim speech of given text: the docs describe an out-of-band `response.create` with `instructions` that carry the text. They do not document an explicit "read this exact string" mode. The reliable approach the docs support is: out-of-band `response.create` whose `instructions` state the exact text to say and forbid paraphrase. Verbatim fidelity is **not verified** by the docs. **[P]**
- Injecting a context or system message mid-session without triggering a response [V, partly]: `conversation.item.create` adds an item to the conversation (the doc describes it as "similar to sending a user message"). It does not, by itself, trigger a response, because responses are created only by `response.create` or by VAD with `create_response: true`. To keep it silent, either set `create_response: false` in turn detection or send the item without a following `response.create`. The `session.update` `instructions` field can also be changed mid-session ("most session properties can be updated at any time"). **[V for update rules; the no-response behaviour of `conversation.item.create` is inferred from the docs wording and not stated explicitly — check.]**
- Note: `conversation.item.create` with `role: "system"` or `role: "developer"` is not confirmed in the fetched text. **[NV]**
- Assistant-role item to make the model "remember" spoken text: `conversation.item.create` with an assistant-role item is implied by the docs but not confirmed here. **[NV]**

## 7. Text-to-speech: `gpt-4o-mini-tts` via `/v1/audio/speech`

Source: https://developers.openai.com/api/docs/guides/text-to-speech (fetched) unless noted.

- Endpoint: `POST /v1/audio/speech`. Model `gpt-4o-mini-tts` (examples). Other listed models: `tts-1`, `tts-1-hd`.
- Request params shown in examples: `model` (required), `voice` (required), `input` (required), `instructions` (for `gpt-4o-mini-tts`), `response_format`. `speed` is not on the page **[NV]**.
- `response_format`: `mp3` (default), `opus`, `aac`, `flac`, `wav`, `pcm`. PCM = raw 24 kHz, 16-bit signed little-endian, no header. **[V]**
- `stream_format`: appears only in the Java and Ruby streaming examples, with value `audio`. The page does **not** list `sse`. **[P]** — treat `sse` as unverified.
- Voices: `marin` and `cedar` are listed and recommended ("we recommend using `marin` or `cedar`"). Full list on the page: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar. The page is internally inconsistent: it says "11 built-in voices" in one place and lists 13 elsewhere. **[P]** on the count.
- Deprecation [V] (https://developers.openai.com/api/docs/deprecations, 2026-10-01 announcement): `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` (both snapshots `gpt-4o-mini-tts-2025-03-20` and `gpt-4o-mini-tts-2025-12-15`) shut down **2027-01-06**. Replacement: `gpt-realtime-2.1-mini`.
- The TTS page states that `gpt-realtime-2.1-mini` "isn't a supported model for `/v1/audio/speech`." So the migration is a change of workflow (the Realtime API), not a model-id swap. Source: https://developers.openai.com/api/docs/guides/text-to-speech **[V]**.

Practical consequence for this project: `/v1/audio/speech` is usable today (deprecated only from 2027-01-06), but the UI should not depend on it long term. The speak-supplied-text path (section 6) inside Realtime is the migration target.

## 8. Deprecation summary (realtime and audio)

Source: https://developers.openai.com/api/docs/deprecations [V]

| Model id | Shutdown | Replacement |
|---|---|---|
| `gpt-realtime` (`gpt-realtime-2025-08-28`), `gpt-4o-realtime` | 2027-01-20 | `gpt-realtime-2.1` |
| `gpt-realtime-mini` (`gpt-realtime-mini-2025-12-15`), `gpt-4o-mini-realtime` | 2027-01-20 | `gpt-realtime-2.1-mini` |
| `gpt-4o-mini-transcribe-2025-03-20` | 2027-01-20 | `gpt-4o-mini-transcribe-2025-12-15` |
| `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` (all snapshots) | 2027-01-06 | `gpt-realtime-2.1-mini` |
| `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` (incl. `-2025-12-15`), `gpt-4o-transcribe-diarize` | 2027-02-26 | `gpt-live-transcribe` or `gpt-transcribe` |
| Realtime API Beta (`OpenAI-Beta: realtime=v1`) | 2026-05-12 (already removed) | Realtime API |
| `gpt-4o-realtime-preview` (dated variants) | 2026-05-07 (already removed) | `gpt-realtime-1.5` |

## 9. Recommendation for the project (derived from the facts above)

1. Conversation: use `gpt-realtime-2.1` (not `gpt-realtime`, which shuts down 2027-01-20). Re-run probe (ii) against `gpt-realtime-2.1` before coding; the probe above did not test it.
2. Live transcript: the user transcript comes from `conversation.item.input_audio_transcription.delta/.completed` [V], with transcription model `gpt-4o-mini-transcribe` (accepted now, shut down 2027-02-26) or `gpt-transcribe` (the listed replacement; not probed). Do not combine `gpt-live-transcribe` with `server_vad`/`semantic_vad`.
3. VAD and barge-in: `semantic_vad` with `interrupt_response: true` and `create_response: true` gives server-side barge-in over WebRTC with no client events [V]. Expect `output_audio_buffer.cleared` on interruption only as **[P]**.
4. Speaking Claude text: out-of-band `response.create` with `conversation: "none"` and `instructions` [V for the mechanism; verbatim behaviour **[P]**]. Verify verbatim fidelity with a test.
5. Tool calls: parse arguments from `response.function_call_arguments.done` (**[P]** payload), but check `response.status` in `response.done` before executing.

## 10. Not verified (do not build on these without checking)

- Exact payload of `input_audio_buffer.speech_started` / `speech_stopped` (fields `audio_start_ms`, `audio_end_ms`, `item_id`): **[P]**. The reference page was truncated before this part.
- `response.output_audio_transcript.delta/.done` and `response.output_text.delta/.done` payload fields: **[P]**.
- `response.function_call_arguments.done` payload: **[P]**.
- `output_audio_buffer.cleared`, `output_audio_buffer.started/stopped`, `conversation.item.truncated` on an official OpenAI page: **[P]/[NV]**.
- `interrupt_response: false` alone (without `create_response`): **[P]**.
- Speech-to-text payload differences between `gpt-transcribe` and `gpt-live-transcribe` beyond `languages`: **[NV]**.
- Whether `conversation.item.create` with a system/developer/assistant role is supported for mid-session injection: **[NV]**.
- Played-up-to position for the transcript over WebRTC: **[NV]**.
- Whether `/v1/audio/speech` supports `stream_format: "sse"`: **[P]** (not on the fetched page).
- Whether `gpt-live-transcribe` in a transcription session accepts VAD in the live API as opposed to the docs: the doc says no; the probe did not test it. **[P]**
- Whether the probe's `semantic_vad` on `gpt-4o-mini-transcribe` (transcription session) accepted only the schema or also runs VAD in practice: the 200 confirms the schema, not the runtime behaviour. **[P]**

## 11. Sources

- Client secrets API reference: https://developers.openai.com/api/docs/api-reference/realtime-sessions/create-realtime-client-secret
- Realtime conversations guide: https://developers.openai.com/api/docs/guides/realtime-conversations
- WebRTC guide: https://developers.openai.com/api/docs/guides/voice-webrtc
- Realtime transcription guide: https://developers.openai.com/api/docs/guides/realtime-transcription
- Realtime server events reference: https://developers.openai.com/api/reference/resources/realtime/server-events (truncated)
- Text-to-speech guide: https://developers.openai.com/api/docs/guides/text-to-speech
- Deprecations: https://developers.openai.com/api/docs/deprecations
- Changelog: https://developers.openai.com/api/docs/changelog (not fetched directly; from search)
- Secondary (not authoritative; used only where marked **[P]**): Microsoft Azure realtime audio reference https://learn.microsoft.com/en-us/azure/foundry-classic/openai/realtime-audio-reference-ga ; OpenAI developer community thread on `/v1/realtime/calls?model=` https://community.openai.com/t/realtime-webrtc-returns-empty-400-when-hitting-v1-realtime-calls-model/1363928

## 12. Not done

- No code was written. No commit was made. The AgentBus was not touched.
- The probe did not test audio, WebRTC or event streams, and it did not test `gpt-realtime-2.1`.
