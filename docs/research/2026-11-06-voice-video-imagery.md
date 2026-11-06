# Voice, photos and video for a travel-agent swarm: state of the art (2026)

Access date for every source: **2026-11-06**. Prices are quoted with their unit. "Date seen" is the date shown on the page itself, or "none shown" when the page has no date. Third-party figures are labelled as such and are not used as the basis for a recommendation.

**Important deprecations found while researching (verified on the primary pages):**
- OpenAI Sora 2 API (`sora-2`, `sora-2-pro`, Videos API): removed from the API on **2026-09-24**; "No one-to-one replacement API is available." Sources: https://developers.openai.com/api/docs/deprecations and https://developers.openai.com/api/docs/guides/video-generation
- Google Veo 3.1 preview models in the Gemini API: shut down **2026-10-22**; the page recommends Gemini Omni Flash (`gemini-omni-1.2-flash`). Source: https://aistudio.google.com/docs/video
- OpenAI `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd`: shutdown **2027-01-06**; replacement `gpt-realtime-2.1-mini` via Realtime API. Source: https://developers.openai.com/api/docs/deprecations
- OpenAI `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`: shutdown **2027-02-26**; replacements `gpt-live-transcribe` or `gpt-transcribe`. Source: https://developers.openai.com/api/docs/deprecations

These dates are after the hackathon, so the models still work for the demo, but they should not be the basis of a long-lived design.

---

## 1. Voice input (speech-to-text)

### 1a. Browser Web Speech API (`SpeechRecognition`)
- Support (MDN browser-compat-data, read raw): Chrome and Edge unprefixed from version 139 (webkit-prefixed from 33); Safari 14.1 with the `webkit` prefix; Firefox 160; Firefox for Android not supported. Source: https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/SpeechRecognition.json (the Firefox 160 value is MDN's data; confirm in a live Firefox build before relying on it).
- Cloud processing: MDN states: "On some browsers, like Chrome, using Speech Recognition on a web page involves a server-based recognition engine. Your audio is sent to a web service for recognition processing, so it won't work offline." Source: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- Safari's recognition routing to Apple: **not verified** on a primary page. Third-party sources claim Safari sends audio to Apple, which matches the general pattern; treat as unverified.
- Latency, accuracy and price: no price (free in the browser). Latency is not published by the platform. Not verified.
- Browser integration: easy (feature-detect `window.SpeechRecognition || window.webkitSpeechRecognition`). API key: none.

### 1b. OpenAI transcription (`gpt-4o-transcribe`, `gpt-4o-mini-transcribe`)
- Price (OpenAI pricing page, read 2026-11-06; date seen: none shown): gpt-4o-transcribe $2.50 per 1M input text tokens, $10.00 per 1M output tokens, estimated **$0.006 per minute**; gpt-4o-mini-transcribe $1.25 per 1M input, $5.00 per 1M output, estimated **$0.003 per minute**. The per-minute figures are OpenAI estimates; billing is by token. Source: https://developers.openai.com/api/docs/pricing
- Latency: not verified on a primary page for batch transcription.
- Integration: the browser records audio (MediaRecorder) and POSTs it to your backend, which calls the API. Key stays server-side. Effort: low.
- Deprecation: shutdown 2027-02-26 (see top of file).

### 1c. OpenAI Realtime API
- The Realtime guide (read 2026-11-06) names `gpt-realtime-2.1` for browser sessions over WebRTC (`/v1/realtime/calls`); browsers get ephemeral credentials from `POST /v1/realtime/client_secrets`; the server-side path uses WebSocket. Source: https://developers.openai.com/api/docs/guides/realtime
- The page gives "low first-audio latency" but no figures. Realtime token prices were **not retrieved** (the guide defers to a cost page); treat pricing as unverified.
- Recommended by OpenAI for the TTS replacement (`gpt-realtime-2.1-mini`), per the deprecations page above.
- Integration effort: higher than a recorded-clip POST, but it provides streaming audio in and out and built-in turn detection. API key: ephemeral token in the browser, long-lived key server-side only.

### 1d. Deepgram (Nova-3, Flux)
- Price (Deepgram pricing page, read 2026-11-06; date seen: only "Dec. 31, 2026" for a Flux TTS credit promotion, which does not affect STT): Pay-as-you-go **streaming** Nova-3 Monolingual **$0.0077/min** (about $0.46/hr); Nova-3 Multilingual $0.0092/min; Flux English $0.0077/min; **pre-recorded** Nova-3 Monolingual $0.0043/min; Multilingual $0.0052/min. "Free $200 credit" on pay-as-you-go. Source: https://deepgram.com/pricing
- A promotional Nova-3 rate of $0.0048/min circulates in third-party articles only; it is **not on the primary page** read today. Not verified.
- Latency: not verified on a primary page.
- Integration: stream from the browser via a short-lived token issued by your backend, or proxy through the backend. Browser-side token mechanism **not verified** here; check Deepgram's auth docs.

### 1e. ElevenLabs Scribe
- Price (ElevenLabs API pricing page, read 2026-11-06; date seen: a banner "Ends September 30" with no year and a countdown at zero, so promo status unclear): **Scribe v2 $0.22/hour** batch; **Scribe v2 Realtime $0.39/hour**; keyterm prompting +$0.05/hr (batch) and +$0.08/hr (realtime). Source: https://elevenlabs.io/pricing/api
- Latency: ElevenLabs claims about **150 ms** for Scribe v2 Realtime, per its product page, "excluding application and network latency." Source: https://elevenlabs.io/realtime-speech-to-text-api (cited by search result; not re-read as a primary fetch). Treat as vendor claim.
- Integration: server-side key; realtime token mechanism **not verified** (the cookbook page returned 403).

### 1f. Summary for STT

| Option | Price (unit, date seen) | Latency | Integration | Key server-side? |
|---|---|---|---|---|
| Web Speech API | free; no price | not published | very easy | no key; audio goes to vendor (Chrome) |
| gpt-4o-mini-transcribe | $0.003/min (estimate); none shown | not verified | easy (POST clip) | yes |
| gpt-4o-transcribe | $0.006/min (estimate); none shown | not verified | easy (POST clip) | yes |
| OpenAI Realtime | token price not retrieved | "low first-audio", no figures | medium | ephemeral token in browser |
| Deepgram Nova-3 | $0.0077/min streaming; $0.0043/min pre-recorded; Dec 31 2026 (only date) | not verified | medium | yes (token mechanism unverified) |
| ElevenLabs Scribe v2 Realtime | $0.39/hr; none shown (promo banner "Ends September 30") | ~150 ms (vendor claim) | medium | yes |

---

## 2. Voice output (text-to-speech)

### 2a. OpenAI `gpt-4o-mini-tts`
- Price (OpenAI pricing page, date seen: none shown): **$0.60 per 1M input text tokens; $12.00 per 1M output audio tokens**. No per-minute figure is listed officially. Third-party sites estimate about $0.015 per minute of audio and warn the figure may be low (unverified; one developer reports audio-token counts well above that). Source: https://developers.openai.com/api/docs/pricing and https://developers.openai.com/api/docs/models/gpt-4o-mini-tts
- Voices (TTS guide, read 2026-11-06): alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar. OpenAI recommends `marin` or `cedar` for best quality. The guide is inconsistent on the count (says "11" in one place and "13" in another). Source: https://developers.openai.com/api/docs/guides/text-to-speech
- Streaming: the guide says the Speech API supports "realtime audio streaming using chunk transfer encoding," so playback can start before the full file is generated. Recommended fast formats: `wav` or `pcm` (24 kHz, 16-bit signed little-endian, no header). Supported: mp3 (default), opus, aac, flac, wav, pcm. The exact `stream_format` values are not formally defined on that page. Source: https://developers.openai.com/api/docs/guides/text-to-speech
- Instructions parameter controls tone, accent, speed and whispering. Source: same page.
- Deprecation: shutdown 2027-01-06.

### 2b. ElevenLabs TTS
- Price (ElevenLabs API pricing page, date seen: promo banner only, see 1e): **Flash / Turbo $0.04 per 1K characters; v3 $0.08 per 1K characters**. Source: https://elevenlabs.io/pricing/api
- Latency (ElevenLabs capabilities page, read 2026-11-06): Eleven Flash v2.5 about **100 ms**, Eleven v4 Turbo about 100 ms median, Eleven v3 Conversational about 165 ms (footnote conditions not shown). "Time to first audio" is not defined on the page. Source: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- Streaming: "Stream real-time audio from text" is a listed capability; endpoint paths are in the API reference (not read). Model ids on the page: `eleven_flash_v2`, `eleven_flash_v2_5`.

### 2c. Browser `speechSynthesis`
- Free, no key, no network, works offline; voice quality depends on the OS voices. Quality and streaming behaviour **not verified** against a primary source in this session. Use it as the fallback when a network call fails.

### 2d. Streaming pattern for "speech starts before the full text is ready"
- Backend: call the TTS endpoint with streaming, forward chunks over a WebSocket or chunked HTTP response.
- Browser: decode chunks into an `AudioContext` queue (PCM is easiest to schedule) or use MediaSource for MP3/AAC. Start playback on the first chunk.
- Sentence-chunk the LLM output and send each sentence to TTS as soon as it completes; this gives the earliest first audio.

---

## 3. Conversation UX

- **Push-to-talk (PTT)** is the most robust choice for a demo: a press-and-hold button starts `MediaRecorder` (or the Web Speech API) and release sends the clip. It avoids false triggers from background noise and removes echo ambiguity. No primary source needed; this is an engineering judgement.
- **Voice activity detection (VAD)**: the Realtime API offers automatic turn detection; the guide links a VAD page (`https://developers.openai.com/api/docs/guides/realtime-vad`, not read). More moving parts than PTT.
- **Barge-in** (user interrupts TTS): with PTT, the simplest rule is "pressing the mic stops the current TTS audio and cancels the in-flight stream." This needs only an `AbortController` on the TTS fetch and `source.stop()` on the audio queue. Native barge-in with VAD requires the echo cancellation of a full-duplex stack (Realtime API or similar); not verified in detail here.
- **Live transcript beside the text chat**: show interim results from Web Speech (`interimResults = true`) or stream partials from Deepgram; on release, replace the interim text with the final text and send it as a normal chat message. Keep the text box as the source of truth so the demo works when voice fails.
- **Simplest robust hackathon pattern**: PTT button → `MediaRecorder` clip → `gpt-4o-mini-transcribe` (or Web Speech when supported, falling back to the clip path) → normal chat turn → sentence-chunked `gpt-4o-mini-tts` with streaming → an AudioContext queue that the mic button can stop.

---

## 4. Real destination photos

### 4a. Wikimedia Commons API
- Key: **none needed**.
- Rate limits (MediaWiki, read 2026-11-06; 2026 tiers, "new in 2026 and may change"): unidentified IP-only clients **10 req/min**; a compliant User-Agent bot **200 req/min**; authenticated established editors 2000 req/min; bot-flagged and WMCS clients exempt. Source: https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
- User-Agent: "include a meaningful User-Agent header that includes contact information such as an email or full URL." Example format: `CoolBot/0.0 (https://example.org/coolbot/; coolbot@example.org) generic-library/0.0`. Source: same page.
- Licensing: each file has its own licence on its file-description page; the Foundation "does not provide any warranty regarding the copyright status"; check each file. Attribution: credit the creator (not the uploader) and link the licence where it requires one. Source: https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- Fit for demo: many images are CC BY-SA and need credit overlays; quality and coverage vary by destination.

### 4b. Unsplash API
- Key: required (application).
- Rate limits (Unsplash documentation, read 2026-11-06): demo apps "rate-limited to **50 requests per hour**"; production apps "increased to **1000 requests per hour**" after approval. Only JSON calls to `api.unsplash.com` count; `images.unsplash.com` image loads do not count. Source: https://unsplash.com/documentation (third-party pages still list 5,000/h, which the primary page does not support).
- Hotlinking: "require the image URLs returned by the API to be directly used or embedded in your applications"; resized URLs "must keep" the `ixid` parameter.
- Attribution: "properly providing attribution for the photographer and Unsplash."
- Download endpoint: call it "every time your application performs a download of a photo." Source: https://unsplash.com/documentation
- Fit for live demo: 50 req/h is tight; cache results before the demo.

### 4c. Pexels API
- Key: required; default **200 requests per hour and 20,000 per month** per key. Increases are **paused**; the help centre says eligible apps can have limits removed. Source: https://help.pexels.com/hc/en-us/articles/900005852323-How-do-I-get-unlimited-requests and https://www.pexels.com/api/documentation/ (the second page is the source of the 200/20,000 numbers).
- Key issuance: a third-party blog claims Pexels has stopped issuing new keys since October 2026. **Not verified** on a primary page; check before relying on it. Existing keys work at default limits.
- Attribution: API guidelines ask for "a prominent link to Pexels" on every API request. Photographer credit "when possible." Source: https://www.pexels.com/api/documentation/
- Licence: "All photos and videos on Pexels are free to use"; "Attribution is not required"; you may modify. Prohibited: selling unaltered copies, redistributing on other stock/wallpaper platforms, using them as trademarks, implying endorsement by people or brands, showing identifiable people "in a bad light." AI/ML training is not mentioned on the licence page. Source: https://www.pexels.com/license/

### 4d. Which needs no key, which is safest for a live demo
- No key: Wikimedia Commons (most permissive on access, most work on licences).
- Safest for a live demo: **pre-fetch and cache** a fixed set of images for the demo destinations from Wikimedia (or Pexels if you have a key), store the file and licence metadata locally, and serve them from your own origin. This avoids live rate limits and the Unsplash demo ceiling. The Unsplash download-endpoint requirement applies only if you use Unsplash images.

---

## 5. Destination videos

### 5a. Existing real footage

**YouTube IFrame embed (policy and API, read 2026-11-06)**
- Embed: the IFrame Player API replaces an element with an `<iframe>`; the player needs a viewport of at least 200×200 px (480×270 recommended for 16:9); pages must implement `onYouTubeIframeAPIReady`; autoplay may be blocked, and `onAutoplayBlocked` fires. Source: https://developers.google.com/youtube/iframe_api_reference
- Policy limits relevant to a travel app: API clients must not "download, import, backup, cache, or store copies of YouTube audiovisual content without YouTube's prior written approval" and must not "make content available for offline playback"; "limited amounts of Non-Authorized Data" may be stored for no more than 30 days; must not "modify, build upon, or block any portion or functionality of a YouTube player"; must not charge users to watch embedded content. Source: https://developers.google.com/youtube/terms/developer-policies
- Quota (YouTube Data API): default **10,000 units per day** for other endpoints. `videos.list` is **1 unit per call**. For `search.list`, the fetched page is **contradictory**: one reading says "Each call costs 1 quota" with its own 100-calls/day bucket; the commonly documented cost is 100 units per search call. **Not verified; check the raw quota table before budgeting.** Source: https://developers.google.com/youtube/v3/determine_quota_cost
- Recommendation: do not search YouTube live during the demo. Pre-select video IDs and embed them.

**Pexels Videos API (read 2026-11-06)**
- Endpoints: `GET https://api.pexels.com/v1/videos/search`, `/v1/videos/popular`, `/v1/videos/videos/:id`. Same 200/hour, 20,000/month default limit. Attribution: prominent Pexels link. Source: https://www.pexels.com/api/documentation/
- Licence: free to use, no attribution required, modifications allowed (see 4c). Source: https://www.pexels.com/license/
- Caching/hotlinking rules: not stated on the API docs page. Confirm with the licence before serving files from your own origin.

**Wikimedia Commons video**
- Same licence and attribution regime as Commons photos (see 4a). Video format and playback support **not verified** in this session.

### 5b. AI-generated video

**Google Veo / Gemini Omni (latest)**
- Veo 3.1 preview models shut down on the Gemini API on **2026-10-22**. The replacement the page names is **Gemini Omni Flash (`gemini-omni-1.2-flash`)**: "up to 15-second video generation with native audio," 3–15 s. Source: https://aistudio.google.com/docs/video
- Price (AI Studio pricing page, read 2026-11-06, date seen: none on the row): output $12.00 per 1M video tokens; billed by tokens at 5,792 tokens per second of 720p video. The page's derived estimates: 360p about $0.023/s; **720p about $0.07/s** (about $0.70 for 10 s); 1080p about $0.104/s; 4K about $0.209/s. Source: https://aistudio.google.com/docs/pricing
- Generation latency: not stated on the video docs page. Not verified.
- Usage terms for real places: not verified in this session (the Gemini API terms page was not read).

**OpenAI Sora**
- **Not available.** Sora 2 and the Videos API were removed on 2026-09-24. Source: https://developers.openai.com/api/docs/deprecations. The guide's own policy text (no real people; human-likeness uploads blocked) is historical. Source: https://developers.openai.com/api/docs/guides/video-generation

**Runway (API pricing page, read 2026-11-06; date seen: "kling_4 20% discount through November 30, 2026 UTC; list prices from December 1, 2026")**
- Credits are **$0.01 each**. Per-second examples: `gen4_turbo` 5 credits = $0.05/s; `gen4.5` 12 credits = $0.12/s; `veo3.1` $0.40/s with audio, $0.20/s without; `veo3.1_fast` $0.15/s with audio, $0.10/s without; `wan3` $0.05/$0.10/$0.20 per second at 480p/720p/1080p. The page gives no maximum clip length for most models. Source: https://docs.dev.runwayml.com/guides/pricing/
- Real-places usage terms: not verified.

**Alibaba Wan via DashScope / Model Studio (Singapore, read 2026-11-06; page "Last Updated: Nov 06, 2026")**
- Per second of output video (USD): `wan2.6-t2v` $0.10/s at 720P, $0.15/s at 1080P; `wan2.7-t2v` same; `wan2.6-i2v-flash` $0.025/s (audio off) and $0.05/s (audio on) at 720P; `wan3.0-video` list $0.05/$0.10/$0.20 per second at 480P/720P/1080P with a limited-time 30% discount; `wan3.0-video-prime` $0.068/$0.14/$0.28 per second. Singapore free quota: 30 seconds for `wan3.0-video`. Failed requests are not billed. Source: https://www.alibabacloud.com/help/en/model-studio/billing-for-model-studio (page truncated; later rows not read).
- Max clip length, generation latency and real-place terms: not verified (the page was truncated; the Model Studio video docs were not read).

**Video price summary (per second, 720p, as the page states it)**

| Option | Price (unit, date seen) | Max length | Latency | Real-places terms |
|---|---|---|---|---|
| Gemini Omni Flash 1.2 | ~$0.07/s at 720p (token-derived estimate; no date shown) | 15 s with audio (page) | not verified | not verified |
| Runway veo3.1 via Runway | $0.20/s no audio, $0.40/s with audio (Runway credits, pricing page; discount note dated Nov 30 2026) | not stated | not verified | not verified |
| Runway wan3 | $0.10/s 720p (credit price) | not stated | not verified | not verified |
| Alibaba Wan 2.6 t2v | $0.10/s 720p, $0.15/s 1080p (Singapore; "Last Updated Nov 06, 2026") | not verified in this session | not verified | not verified |
| OpenAI Sora | **removed 2026-09-24** | — | — | — |

---

## 6. Real-world grounding for simulated data

### 6a. Open-Meteo (climate and historical weather)
- Key: free non-commercial access needs **no key** per the page; the `apikey` parameter is "Only required to commercial use." Commercial customers use `customer-api.open-meteo.com`. Source: https://open-meteo.com/en/docs/climate-api
- Free limits (Open-Meteo pricing page, read 2026-11-06; date seen: none shown): **600 calls/minute, 5,000/hour, 10,000/day, 300,000/month**. Source: https://open-meteo.com/en/pricing
- Commercial plans: API Standard (1M calls/month), Professional (5M), Enterprise (>50M). **Prices were not stated** on the page. Not verified.
- Climate endpoint (`/v1/climate`): CMIP6 HighResMIP downscaled models, up to 20 km, downscaled to 10 km; covers 1950–2050; the page warns past-period data is for model validation and "should not be mistaken for actual measurements." Historical actuals come from the separate Historical Weather API (ERA5-Land reference). Source: https://open-meteo.com/en/docs/climate-api
- Note: the climate API returns model output, not observations. Label simulated itineraries accordingly.

### 6b. Free geocoding: Nominatim (OpenStreetMap)
- Key: none. Usage policy (read 2026-11-06): absolute maximum **1 request per second**; scripts running longer than a day or on a schedule are limited to **4 requests per minute**; a valid User-Agent is required ("stock User-Agents as set by http libraries will not do"); "results must be cached on your side" for bulk tasks; **autocomplete is prohibited** on the client side; "bulk geocoding ... is not encouraged." User-triggered searches are fine at moderate volume. Source: https://operations.osmfoundation.org/policies/nominatim/
- Implication for a demo: geocode the fixed list of demo destinations once, cache the coordinates, and do not put Nominatim behind a live autocomplete box.

---

## Recommendation for a hackathon build

- **Voice in**: use push-to-talk. Record a clip with MediaRecorder and transcribe it server-side with `gpt-4o-mini-transcribe` ($0.003/min estimate). Keep the Web Speech API as a Chrome/Edge/Safari path only, and say that Chrome sends audio to a server. Do not depend on Firefox for Web Speech.
- **Voice out**: `gpt-4o-mini-tts` with chunked streaming (`wav` or `pcm`), sentence-chunked from the LLM output. Fall back to browser `speechSynthesis` if the call fails. Note the 2027-01-06 shutdown; it is safe for the demo, not for a product.
- **Barge-in**: a mic press stops TTS audio and aborts the fetch. No VAD needed for the demo.
- **Photos**: pre-fetch and cache destination photos from Wikimedia Commons (no key; keep the per-file licence and credit). Use Pexels only if you already hold a working key. Avoid Unsplash's 50 req/h demo tier for live use.
- **Videos (demo)**: use **real footage**, not generated video. Pre-select YouTube IDs and embed them with the IFrame API; do not search live. Do not cache or download YouTube media (policy).
- **AI-generated video**: if you add it, generate a few clips before the demo (Gemini Omni Flash at about $0.07/s at 720p, or Alibaba Wan 2.6 at $0.10/s at 720p) and store them. Do not use Sora (removed 2026-09-24) or Veo 3.1 preview (shut down 2026-10-22). Confirm real-place usage terms before showing generated footage of real destinations; this was not verified.
- **Geo and weather**: geocode the demo cities once with Nominatim and cache the results (1 req/s, no autocomplete). Use Open-Meteo's free tier (no key for non-commercial use) for climate normals and archive data; cache responses. Label climate-model output as model output, not observations.
- **Before the demo**: verify live the items marked "not verified" (Deepgram token mechanism, Pexels key issuance, YouTube `search.list` cost, Veo/Omni real-place terms, Wan max length and latency).

---

## Claims I could not verify

- Safari sends Web Speech audio to Apple; Firefox availability beyond MDN's "160" value.
- Latency for OpenAI transcription, Deepgram and Web Speech.
- Realtime API token prices (the guide defers to a cost page).
- OpenAI `gpt-4o-mini-tts` per-minute cost (~$0.015/min, third-party only; OpenAI publishes token prices only).
- Deepgram $0.0048/min promotional rate (third-party only; the primary page shows $0.0077/min).
- ElevenLabs promo status (banner "Ends September 30", no year).
- ElevenLabs Scribe realtime token mechanism and the 150 ms latency beyond the vendor's claim.
- Pexels new-key pause (third-party claim; help-centre page only says rate-limit increases are paused).
- YouTube `search.list` quota cost: the fetched page is internally contradictory (1 unit vs "100 quota per day"); confirm on the raw table.
- Open-Meteo commercial plan prices.
- Veo/Omni max clip length beyond 15 s, generation latency, and real-place usage terms; Runway max clip length; Wan max length, latency and real-place terms.
- Wikimedia Commons video formats and playback support.
- Browser-side Speech/TTS quality comparison (speechSynthesis).
- Gemini and Omni "date" for Omni 1.2 pricing (no effective date shown on the row).
