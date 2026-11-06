/* Experience Atlas voice: Realtime as EARS (transcription only), /api/tts as MOUTH.
 *
 * window.AtlasVoice = {init, start, stop, speak, stopSpeaking, isActive}
 *   init({onUserDelta(text), onUserFinal(text), onSpeechStarted(), onState(state)})
 *   state: 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'
 *   start() -> Promise<boolean>  mic on (true once the Realtime channel is open)
 *   stop()                       mic off (does not cut speech; use stopSpeaking)
 *   speak(text)                  queues sentences, fetches them in order, plays as they arrive
 *   stopSpeaking()               pauses, clears the queue, aborts in-flight TTS fetches
 *   isActive()                   true while connecting or listening
 *
 * Realtime never answers: the session is minted with create_response=false,
 * remote audio is never attached, and any response.* that slips through is cancelled.
 */
(function () {
  'use strict';

  const REALTIME_CALLS = 'https://api.openai.com/v1/realtime/calls';
  const CONNECT_TIMEOUT_MS = 15000;
  const TTS_MAX_CHARS = 1200;
  const MERGE_MIN_CHARS = 80; // later chunks are merged up to this size; the first ships alone for a fast start

  const noop = function () {};
  const cb = { onUserDelta: noop, onUserFinal: noop, onSpeechStarted: noop, onState: noop };

  let state = 'idle';

  // ---- ears (Realtime over WebRTC) ----
  let pc = null;
  let dc = null;
  let mic = null;
  let attempt = 0;
  let connecting = false;
  let active = false;
  let connectAbort = null;
  const partial = new Map(); // item_id -> accumulated transcript
  const cancelled = new Set(); // response ids already cancelled

  // ---- mouth (TTS queue) ----
  let audioEl = null;
  let gen = 0; // bumps on stopSpeaking; stale work checks it and drops out
  let items = []; // [{url: Promise<string|null>}] in playback order
  let fetchChain = Promise.resolve();
  let playing = false;
  let endCurrent = null;
  const controllers = new Set();

  function safe(fn, arg) {
    try { fn(arg); } catch (e) { console.error('[AtlasVoice] callback error', e); }
  }

  function setState(s) {
    if (state === s) return;
    state = s;
    safe(cb.onState, s);
  }

  function refreshState() {
    setState(playing ? 'speaking' : connecting ? 'connecting' : active ? 'listening' : 'idle');
  }

  // ================= EARS =================

  function teardown() {
    active = false;
    connecting = false;
    if (dc) { dc.onopen = dc.onclose = dc.onmessage = null; try { dc.close(); } catch (e) { /* closed */ } }
    if (pc) { pc.onconnectionstatechange = null; try { pc.close(); } catch (e) { /* closed */ } }
    if (mic) mic.getTracks().forEach(function (t) { t.stop(); });
    dc = pc = mic = null;
    partial.clear();
    cancelled.clear();
  }

  function send(ev) {
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(ev));
  }

  function onEvent(ev) {
    const type = ev && ev.type;
    if (!type) return;
    switch (type) {
      case 'input_audio_buffer.speech_started':
        stopSpeaking(); // barge-in
        safe(cb.onSpeechStarted);
        return;
      case 'conversation.item.input_audio_transcription.delta': {
        const id = ev.item_id || '_';
        const text = (partial.get(id) || '') + (ev.delta || '');
        partial.set(id, text);
        safe(cb.onUserDelta, text);
        return;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const id = ev.item_id || '_';
        const text = (ev.transcript != null ? ev.transcript : partial.get(id) || '').trim();
        partial.delete(id);
        if (text) safe(cb.onUserFinal, text);
        return;
      }
      case 'conversation.item.input_audio_transcription.failed':
        partial.delete(ev.item_id || '_');
        console.warn('[AtlasVoice] transcription failed', ev.error || '');
        return;
      case 'error':
        console.warn('[AtlasVoice] realtime error', ev.error || ev);
        return;
    }
    // Safety net: Realtime must never answer. Cancel any response that starts.
    if (type.indexOf('response.') === 0 && type !== 'response.done') {
      const rid = (ev.response && ev.response.id) || ev.response_id || '_';
      if (!cancelled.has(rid)) {
        cancelled.add(rid);
        send({ type: 'response.cancel' });
      }
    }
  }

  async function start() {
    if (connecting || active) return active;
    const my = ++attempt;
    connecting = true;
    refreshState();
    connectAbort = new AbortController();
    const signal = connectAbort.signal;
    try {
      if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('voice not supported in this browser');
      }
      const sr = await fetch('/api/voice/session', { method: 'POST', signal: signal });
      if (!sr.ok) throw new Error('voice session mint failed (' + sr.status + ')');
      const ses = await sr.json();
      if (!ses || !ses.client_secret) throw new Error('voice session returned no secret');
      if (my !== attempt) return false;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (my !== attempt) { stream.getTracks().forEach(function (t) { t.stop(); }); return false; }
      mic = stream;

      const peer = new RTCPeerConnection();
      pc = peer;
      stream.getTracks().forEach(function (t) { peer.addTrack(t, stream); });
      // No ontrack handler: remote audio is never played (Realtime is ears only).

      const channel = peer.createDataChannel('oai-events');
      dc = channel;
      const opened = new Promise(function (resolve, reject) {
        const timer = setTimeout(function () { reject(new Error('voice channel timed out')); }, CONNECT_TIMEOUT_MS);
        channel.onopen = function () { clearTimeout(timer); resolve(); };
        signal.addEventListener('abort', function () { clearTimeout(timer); reject(new Error('aborted')); });
      });
      opened.catch(noop); // awaited below; avoid an unhandled rejection if start() bails out first
      channel.onmessage = function (e) {
        if (my !== attempt) return;
        let ev;
        try { ev = JSON.parse(e.data); } catch (err) { return; }
        onEvent(ev);
      };
      channel.onclose = function () {
        if (my !== attempt || !active) return;
        console.warn('[AtlasVoice] voice channel closed');
        attempt++;
        teardown();
        setState('error');
      };
      peer.onconnectionstatechange = function () {
        if (my !== attempt) return;
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          console.warn('[AtlasVoice] connection ' + peer.connectionState);
          attempt++;
          teardown();
          setState('error');
        }
      };

      const offer = await peer.createOffer();
      if (my !== attempt) return false;
      await peer.setLocalDescription(offer);
      const r = await fetch(REALTIME_CALLS, {
        method: 'POST',
        body: offer.sdp,
        signal: signal,
        headers: { Authorization: 'Bearer ' + ses.client_secret, 'Content-Type': 'application/sdp' },
      });
      const answer = await r.text();
      if (my !== attempt) return false;
      if (!r.ok || answer.indexOf('v=') !== 0) {
        let detail = answer.slice(0, 200);
        try { detail = JSON.parse(answer).error.message; } catch (err) { /* not JSON */ }
        throw new Error('OpenAI rejected the call (' + r.status + '): ' + detail);
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: answer });
      await opened;
      if (my !== attempt) return false;
      connecting = false;
      active = true;
      refreshState();
      return true;
    } catch (err) {
      if (my !== attempt) return false;
      console.warn('[AtlasVoice] start failed:', err && err.message ? err.message : err);
      attempt++;
      teardown();
      setState('error'); // UI falls back to text; speak() keeps working
      return false;
    } finally {
      if (my === attempt) connectAbort = null;
    }
  }

  function stop() {
    attempt++;
    if (connectAbort) { connectAbort.abort(); connectAbort = null; }
    teardown();
    refreshState();
  }

  function isActive() {
    return connecting || active;
  }

  // ================= MOUTH =================

  function ensureAudio() {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = 'auto';
    }
    return audioEl;
  }

  function splitSentences(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const raw = t.split(/(?<=[.!?…]["'”’)\]]*)\s+/);
    const out = [];
    let buf = '';
    for (const s of raw) {
      buf = buf ? buf + ' ' + s : s;
      if (out.length === 0 || buf.length >= MERGE_MIN_CHARS) { out.push(buf); buf = ''; }
    }
    if (buf) out.push(buf);
    return out.map(function (s) { return s.slice(0, TTS_MAX_CHARS); });
  }

  function fetchTTS(text, myGen) {
    if (myGen !== gen) return Promise.resolve(null);
    const ac = new AbortController();
    controllers.add(ac);
    return fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
      signal: ac.signal,
    })
      .then(function (r) {
        if (!r.ok) throw new Error('tts failed (' + r.status + ')');
        return r.blob();
      })
      .then(function (blob) { return myGen === gen ? URL.createObjectURL(blob) : null; })
      .finally(function () { controllers.delete(ac); });
  }

  function playUrl(url) {
    return new Promise(function (resolve) {
      const a = ensureAudio();
      let done = false;
      function finish() {
        if (done) return;
        done = true;
        a.onended = a.onerror = null;
        URL.revokeObjectURL(url);
        if (endCurrent === finish) endCurrent = null;
        resolve();
      }
      endCurrent = finish;
      a.onended = finish;
      a.onerror = finish;
      a.src = url;
      const p = a.play();
      if (p && p.catch) p.catch(function (err) { console.warn('[AtlasVoice] playback blocked:', err && err.message); finish(); });
    });
  }

  async function playLoop() {
    const myGen = gen;
    playing = true;
    refreshState();
    while (items.length && myGen === gen) {
      const it = items.shift();
      let url = null;
      try { url = await it.url; } catch (err) {
        if (!err || err.name !== 'AbortError') console.warn('[AtlasVoice]', err && err.message ? err.message : err);
        continue;
      }
      if (!url) continue;
      if (myGen !== gen) { URL.revokeObjectURL(url); break; }
      await playUrl(url);
    }
    if (myGen === gen) {
      playing = false;
      refreshState();
    }
  }

  function speak(text) {
    const parts = splitSentences(text);
    if (!parts.length) return;
    const myGen = gen;
    for (const part of parts) {
      const url = fetchChain.then(function () { return fetchTTS(part, myGen); });
      fetchChain = url.catch(function () { return null; }); // sequential fetches; one failure doesn't stall the rest
      items.push({ url: url });
    }
    if (!playing) playLoop();
  }

  function stopSpeaking() {
    gen++;
    items = [];
    fetchChain = Promise.resolve();
    controllers.forEach(function (c) { c.abort(); });
    controllers.clear();
    if (endCurrent) endCurrent();
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    }
    if (playing) {
      playing = false;
      refreshState();
    }
  }

  // ================= API =================

  function init(opts) {
    opts = opts || {};
    ['onUserDelta', 'onUserFinal', 'onSpeechStarted', 'onState'].forEach(function (k) {
      if (typeof opts[k] === 'function') cb[k] = opts[k];
    });
    ensureAudio();
    safe(cb.onState, state);
  }

  window.addEventListener('pagehide', function () { stopSpeaking(); stop(); });

  window.AtlasVoice = Object.freeze({
    init: init,
    start: start,
    stop: stop,
    speak: speak,
    stopSpeaking: stopSpeaking,
    isActive: isActive,
  });
})();
