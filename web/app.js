/* Experience Atlas — frontend (no build step). Contract: docs/demo-contract.md */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const params = new URLSearchParams(location.search);
  const MOCK = params.get('mock') === '1';

  // `key` is the backend agent name (SSE contract); `label` and `role` are what the traveller sees.
  const AGENTS = [
    { key: 'Trip Architect', label: 'Your Trip Planner', role: 'brings it all together', glyph: '🧭', color: '#1E2A44' },
    { key: 'Explorer', label: 'Destination Expert', role: 'seasons & weather', glyph: '🗺️', color: '#0F766E' },
    { key: 'Flights', label: 'Flight Specialist', role: 'routes & fares', glyph: '✈️', color: '#3B82C4' },
    { key: 'Stays', label: 'Stays Curator', role: 'rooms that fit you', glyph: '🏡', color: '#C2603E' },
    { key: 'Experiences', label: 'Experience Curator', role: 'things worth doing', glyph: '⛵', color: '#E8664A' },
    { key: 'Local Insider', label: 'Local Insider', role: 'off the beaten path', glyph: '🔑', color: '#B8925A' },
  ];
  const COORD = AGENTS[0].key;
  const LABEL = Object.fromEntries(AGENTS.map((a) => [a.key, a.label]));

  const state = {
    conversationId: null, busy: false, queue: [], version: 0, itinerary: null, sketch: false,
    places: new Map(), media: new Map(), fixture: null,
    t0: null, cost: null, ttsOn: false, mockTurn: 0, voiceInited: false,
    map: null, mapLayer: null, particles: [], geo: null, assistantEl: null,
  };

  const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const fmtEur = (n) => (typeof n === 'number' && isFinite(n) ? eur.format(n) : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : '');

  /* ================= PLACES & MEDIA ================= */
  function loadFixture() {
    if (!state.fixture) {
      state.fixture = fetch('/fixtures/demo-media/demo-media.json')
        .then((r) => (r.ok ? r.json() : { places: [] }))
        .then((d) => { const m = new Map(); (d.places || []).forEach((p) => m.set(p.id, p)); return m; })
        .catch(() => new Map());
    }
    return state.fixture;
  }
  async function loadPlaces() {
    try {
      const r = await fetch('/api/places');
      if (!r.ok) throw new Error(String(r.status));
      const arr = await r.json();
      (Array.isArray(arr) ? arr : arr.places || []).forEach((p) => state.places.set(p.id, p));
      if (!state.places.size) throw new Error('empty');
    } catch {
      const fx = await loadFixture();
      fx.forEach((p, id) => state.places.set(id, p));
    }
  }
  function getMedia(id) {
    if (!id) return Promise.resolve(null);
    if (!state.media.has(id)) {
      const p = (MOCK ? Promise.resolve(null) : fetch('/api/media/' + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : null)).catch(() => null))
        .then(async (m) => {
          if (m && ((m.photos && m.photos.length) || (m.videos && m.videos.length))) return m;
          const fx = await loadFixture();
          const f = fx.get(id);
          return f ? { photos: f.photos || [], videos: f.videos || [] } : null;
        });
      state.media.set(id, p);
    }
    return state.media.get(id);
  }
  function resolvePlace(id, name) {
    if (id && state.places.has(id)) return state.places.get(id);
    if (!name) return null;
    const n = String(name).toLowerCase();
    for (const p of state.places.values()) {
      const pn = String(p.name || '').toLowerCase();
      if (pn && (pn === n || n.includes(pn) || pn.includes(n))) return p;
    }
    return null;
  }

  /* ================= CHAT ================= */
  const chat = $('#chat');
  function addMsg(role, text, extra = '') {
    const el = document.createElement('div');
    el.className = `msg ${role} ${extra}`.trim();
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    el.appendChild(b);
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    return el;
  }
  function assistantBubble() {
    if (!state.assistantEl) {
      state.assistantEl = addMsg('assistant', '');
      const b = state.assistantEl.firstChild;
      b.classList.add('streaming');
      b.dataset.text = '';
      b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    }
    return state.assistantEl.firstChild;
  }
  function appendAssistant(t) {
    const b = assistantBubble();
    b.dataset.text = (b.dataset.text || '') + (t || '');
    b.textContent = b.dataset.text;
    chat.scrollTop = chat.scrollHeight;
  }
  function setAssistant(t) {
    const b = assistantBubble();
    if (t) { b.dataset.text = t; b.textContent = t; }
    b.classList.remove('streaming');
    state.assistantEl = null;
    chat.scrollTop = chat.scrollHeight;
  }
  function finishAssistant() {
    if (!state.assistantEl) return;
    const b = state.assistantEl.firstChild;
    if (!b.dataset.text) state.assistantEl.remove(); else b.classList.remove('streaming');
    state.assistantEl = null;
  }

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .5s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 5000);
  }

  /* ================= SEND / SSE ================= */
  async function sendTurn(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (state.busy) {
      state.queue.push({ text, el: addMsg('user', text, 'queued') });
      return;
    }
    addMsg('user', text);
    await runTurn(text);
  }
  async function runTurn(text) {
    state.busy = true;
    beginTurnSwarm(text);
    try {
      if (MOCK) await mockTurn(text);
      else {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ conversation_id: state.conversationId, text }),
        });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) { handleBlock(buf.slice(0, i)); buf = buf.slice(i + 2); }
        }
        buf += dec.decode();
        if (buf.trim()) handleBlock(buf);
      }
    } catch (e) {
      toast('Connection problem: ' + (e && e.message ? e.message : e));
      swarmStatus({ status: 'error', message: 'Connection lost — try again' });
    } finally {
      finishAssistant();
      if (state.t0 && !$('#swarm').classList.contains('done')) logElapsed('turn ended');
      state.busy = false;
      const next = state.queue.shift();
      if (next) { next.el.classList.remove('queued'); runTurn(next.text); }
    }
  }
  function handleBlock(block) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return;
    let ev;
    try { ev = JSON.parse(data); } catch { console.warn('bad SSE payload', data); return; }
    try { handleEvent(ev); } catch (e) { console.error('event handler failed', ev, e); }
  }
  function handleEvent(ev) {
    switch (ev.type) {
      case 'conversation': if (ev.conversation_id) state.conversationId = ev.conversation_id; break;
      case 'concierge.delta': appendAssistant(ev.text); break;
      case 'concierge.done': setAssistant(ev.text); break;
      case 'speak': speak(ev.text); break;
      case 'swarm.status': swarmStatus(ev); break;
      case 'agent.spawned': agentSpawned(ev.agent); break;
      case 'agent.activity': agentActivity(ev); break;
      case 'itinerary': {
        const draft = ev.prebuilt === true ? 'prebuilt' : ev.sketch === true ? 'sketch' : null;
        renderItinerary(ev.itinerary, ev.version, draft);
        consultItinerary(draft, ev.itinerary);
        break;
      }
      case 'usage':
        if (typeof ev.cost_usd === 'number' && isFinite(ev.cost_usd)) { state.cost = ev.cost_usd; if ($('#swarm').classList.contains('done')) showCost(); }
        break;
      case 'turn.done':
        if (!$('#swarm').classList.contains('done') && state.t0) swarmStatus({ status: 'done', message: '' });
        endSketch();
        break;
      case 'error':
        endSketch();
        toast(ev.message || 'Something went wrong');
        swarmStatus({ status: 'error', message: ev.message || 'error' });
        break;
      default: break;
    }
  }

  /* ================= VOICE ================= */
  const micBtn = $('#micBtn');
  const dock = $('#voiceDock');
  const transcript = $('#transcript');
  const tText = $('#transcriptText');
  const vLabel = $('#voiceLabel');
  let liveText = '';
  const V = () => window.AtlasVoice;

  function initVoice() {
    if (state.voiceInited) return true;
    const v = V();
    if (!v || typeof v.init !== 'function') { micBtn.classList.add('unavailable'); micBtn.title = 'Voice unavailable, type instead'; return false; }
    try {
      v.init({
        onUserDelta: (t) => {
          t = String(t || '');
          liveText = t.startsWith(liveText) && liveText ? t : liveText + t;
          transcript.classList.add('live'); transcript.classList.remove('final');
          tText.textContent = liveText;
        },
        onUserFinal: (t) => {
          const text = String(t || liveText).trim();
          liveText = '';
          transcript.classList.remove('live'); transcript.classList.add('final');
          tText.textContent = text || '…';
          if (text) sendTurn(text);
        },
        onSpeechStarted: () => {
          liveText = '';
          dock.classList.add('voice-barge'); setTimeout(() => dock.classList.remove('voice-barge'), 450);
        },
        onState: (s) => setVoiceState(s),
      });
      state.voiceInited = true;
      micBtn.classList.remove('unavailable');
      return true;
    } catch (e) { console.warn('voice init failed', e); return false; }
  }
  const VOICE_LABELS = { idle: 'Tap to talk', connecting: 'Connecting…', listening: 'Listening…', speaking: 'Atlas is speaking', thinking: 'Thinking…', error: 'Voice unavailable', off: 'Tap to talk' };
  function setVoiceState(s) {
    s = String(s || 'idle');
    dock.className = 'voice-dock voice-' + s.replace(/[^a-z-]/gi, '');
    vLabel.textContent = VOICE_LABELS[s] || s;
    if (s === 'error') { tText.textContent = 'Mic not available — type below, Atlas still answers.'; }
  }
  async function toggleMic() {
    if (!initVoice()) { toast('Voice is unavailable here — text mode is on.', 'info'); return; }
    const v = V();
    try {
      if (v.isActive && v.isActive()) { await v.stop(); setVoiceState('idle'); }
      else {
        setVoiceState('connecting');
        state.ttsOn = true; $('#ttsBtn').classList.add('on'); $('#ttsBtn').textContent = '🔊';
        await v.start();
        if (v.isActive && v.isActive() && dock.classList.contains('voice-connecting')) setVoiceState('listening');
      }
    } catch (e) {
      setVoiceState('error');
      toast('Mic unavailable: ' + (e && e.message ? e.message : e) + ' — text mode still works.');
    }
  }
  function speak(text) {
    const v = V();
    if (!text || !v || typeof v.speak !== 'function') return;
    const active = state.ttsOn || (v.isActive && v.isActive());
    if (!active) return;
    try { const p = v.speak(text); if (p && p.catch) p.catch((e) => console.warn('speak failed', e)); } catch (e) { console.warn('speak failed', e); }
  }

  /* ================= SWARM ================= */
  const orbsEl = $('#orbs');
  const svg = $('#swarmSvg');
  const stageEl = $('#swarmStage');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const orbMap = new Map();

  function agentKey(name) {
    const n = String(name || '').toLowerCase();
    const hit = AGENTS.find((a) => a.key.toLowerCase() === n) || AGENTS.find((a) => n.includes(a.key.toLowerCase().split(' ').pop()));
    return hit ? hit.key : COORD;
  }
  function buildSwarm() {
    AGENTS.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'orb' + (i === 0 ? ' coord' : '');
      el.innerHTML = `<div class="orb-bubble"></div><div class="orb-core" style="--c:${a.color}">${a.glyph}<span class="orb-badge">✓</span></div>
        <div class="orb-name">${esc(a.label)}</div><div class="orb-model orb-role">${esc(a.role)}</div>`;
      orbsEl.appendChild(el);
      const rec = { a, el, x: 0, y: 0, lit: false, base: null, beam: null, flow: null, timer: null, bubbleTimer: null };
      if (i > 0) {
        rec.base = document.createElementNS(SVGNS, 'line'); rec.base.setAttribute('class', 'beam-base');
        rec.beam = document.createElementNS(SVGNS, 'line'); rec.beam.setAttribute('class', 'beam'); rec.beam.setAttribute('stroke', a.color); rec.beam.style.color = a.color;
        rec.flow = document.createElementNS(SVGNS, 'line'); rec.flow.setAttribute('class', 'beam-flow'); rec.flow.setAttribute('stroke', a.color);
        svg.append(rec.base, rec.beam, rec.flow);
      }
      orbMap.set(a.key, rec);
    });
    layoutSwarm();
    new ResizeObserver(layoutSwarm).observe(stageEl);
    requestAnimationFrame(tickParticles);
  }
  function layoutSwarm() {
    const w = stageEl.clientWidth, h = stageEl.clientHeight;
    if (!w || !h) return;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const cx = w / 2, cy = h / 2 + 4;
    const r = Math.min(w * 0.38, h * 0.40);
    AGENTS.forEach((a, i) => {
      const rec = orbMap.get(a.key);
      if (i === 0) { rec.x = cx; rec.y = cy; }
      else {
        const ang = -Math.PI / 2 + ((i - 1) * 2 * Math.PI) / 5;
        rec.x = cx + r * 1.12 * Math.cos(ang);
        rec.y = cy + r * Math.sin(ang);
      }
      rec.el.classList.toggle('side-right', i > 0 && rec.x > cx + 20);
      rec.el.classList.toggle('side-left', i > 0 && rec.x < cx - 20);
      rec.el.style.left = rec.x + 'px';
      rec.el.style.top = rec.y + 'px';
      if (rec.beam) {
        [rec.base, rec.beam, rec.flow].forEach((l) => { l.setAttribute('x1', cx); l.setAttribute('y1', cy); l.setAttribute('x2', rec.x); l.setAttribute('y2', rec.y); });
        const len = Math.hypot(rec.x - cx, rec.y - cy);
        rec.beam.style.setProperty('--len', len);
        rec.beam.setAttribute('stroke-dasharray', len);
      }
    });
    state.geo = { cx, cy };
  }
  function lightOrb(key) {
    const rec = orbMap.get(key);
    if (!rec) return;
    if (!rec.el.classList.contains('lit')) {
      rec.el.classList.remove('standby');
      rec.el.classList.add('lit');
      if (rec.beam) { rec.beam.classList.add('lit'); rec.flow.classList.add('lit'); }
      burst(key, 8, true);
    }
    rec.lit = true;
  }
  function pulseOrb(key, text) {
    const rec = orbMap.get(key);
    if (!rec) return;
    lightOrb(key);
    rec.el.classList.remove('pulse'); void rec.el.offsetWidth; rec.el.classList.add('pulse');
    clearTimeout(rec.timer); rec.timer = setTimeout(() => rec.el.classList.remove('pulse'), 1100);
    if (rec.flow) { rec.flow.classList.add('hot'); setTimeout(() => rec.flow.classList.remove('hot'), 1400); }
    if (text) {
      const b = rec.el.querySelector('.orb-bubble');
      b.textContent = text.length > 70 ? text.slice(0, 68) + '…' : text;
      rec.el.classList.add('talking');
      clearTimeout(rec.bubbleTimer); rec.bubbleTimer = setTimeout(() => rec.el.classList.remove('talking'), 2600);
    }
  }
  function burst(key, n, outward) {
    const rec = orbMap.get(key);
    if (!rec || !rec.beam) return;
    for (let i = 0; i < n; i++) state.particles.push({ key, t: -i * 0.07, speed: 0.012 + Math.random() * 0.008, out: !!outward, r: 2 + Math.random() * 1.6, el: null });
  }
  let lastAmbient = 0;
  function tickParticles(ts) {
    const g = state.geo;
    if (g && $('#swarm').classList.contains('running') && ts - lastAmbient > 260) {
      lastAmbient = ts;
      const lit = [...orbMap.values()].filter((r) => r.beam && r.el.classList.contains('lit'));
      if (lit.length) { const r = lit[(Math.random() * lit.length) | 0]; state.particles.push({ key: r.a.key, t: 0, speed: 0.008 + Math.random() * 0.006, out: Math.random() < 0.35, r: 1.6 + Math.random() * 1.4, el: null }); }
    }
    state.particles = state.particles.filter((p) => {
      p.t += p.speed;
      const rec = orbMap.get(p.key);
      if (!g || !rec || p.t >= 1) { if (p.el) p.el.remove(); return false; }
      if (p.t < 0) return true;
      if (!p.el) {
        p.el = document.createElementNS(SVGNS, 'circle');
        p.el.setAttribute('class', 'particle'); p.el.setAttribute('r', p.r);
        p.el.setAttribute('fill', p.out ? '#F6E6C0' : rec.a.color); p.el.style.color = rec.a.color;
        svg.appendChild(p.el);
      }
      const k = p.out ? p.t : 1 - p.t; // 0 = coordinator, 1 = agent
      p.el.setAttribute('cx', g.cx + (rec.x - g.cx) * k);
      p.el.setAttribute('cy', g.cy + (rec.y - g.cy) * k);
      p.el.setAttribute('opacity', Math.sin(Math.PI * p.t).toFixed(2));
      return true;
    });
    requestAnimationFrame(tickParticles);
  }
  // Timing stays in the console for debugging: the UI never shows seconds.
  function markStart() { if (!state.t0) state.t0 = performance.now(); }
  function logElapsed(label) {
    if (state.t0) console.debug(`[atlas] ${label}: ${((performance.now() - state.t0) / 1000).toFixed(1)}s`);
  }
  function setPill(cls, label) { const p = $('#swarmPill'); p.className = 'pill ' + cls; p.textContent = label; }
  function teamAtWork() {
    markStart();
    $('#swarm').classList.add('running');
    lightOrb(COORD);
    orbMap.get(COORD).el.classList.add('running');
  }
  function beginTurnSwarm(text) {
    const sw = $('#swarm');
    sw.classList.remove('done');
    orbMap.forEach((rec) => { rec.el.classList.remove('replied'); if (rec.el.classList.contains('lit') && rec.beam) { rec.el.classList.remove('lit'); rec.el.classList.add('standby'); rec.beam.classList.remove('lit'); rec.flow.classList.remove('lit'); } });
    state.t0 = null;
    hideCost();
    setPill('starting', 'Thinking');
    consultBeginTurn(text);
  }
  // Backend status messages are never shown (they carry timings); the copy here is ours.
  function swarmStatus(ev) {
    const sw = $('#swarm');
    const coord = orbMap.get(COORD).el;
    const replay = ev.message === 'replay';
    switch (ev.status) {
      case 'starting':
      case 'running':
        teamAtWork();
        if (replay) { setPill('replay', 'Saved plan'); consultLine(COORD, 'is bringing back a saved plan for you'); }
        else setPill(ev.status, ev.status === 'starting' ? 'Briefing' : 'Working');
        break;
      case 'done':
        logElapsed('turn composed' + (ev.message ? ` (${ev.message})` : ''));
        sw.classList.remove('running'); sw.classList.add('done'); coord.classList.remove('running');
        setPill(replay ? 'replay' : 'done', replay ? 'Saved plan' : 'Ready');
        consultPhase('ready');
        showCost();
        break;
      case 'error':
        logElapsed('turn interrupted');
        sw.classList.remove('running'); coord.classList.remove('running');
        setPill('error', 'Interrupted');
        consultPhase('error');
        break;
      default: break;
    }
  }
  const countLit = () => [...orbMap.values()].filter((r) => r.el.classList.contains('lit') || r.el.classList.contains('standby')).length;
  function agentSpawned(agent) {
    const key = agentKey(agent);
    if (!state.t0) { teamAtWork(); setPill('running', 'Working'); }
    lightOrb(key);
    burst(key, 6, true);
  }
  function agentActivity(ev) {
    const key = agentKey(ev.agent);
    const kind = ev.kind || '';
    pulseOrb(key, unpriced(ev.text));
    if (key === COORD) {
      if (kind === 'delegated') AGENTS.slice(1).forEach((a) => burst(a.key, 4, true));
    } else {
      burst(key, kind === 'replied' ? 10 : 4, kind === 'delegated');
      if (kind === 'replied') orbMap.get(key).el.classList.add('replied');
    }
    consultActivity(key, kind, ev.text || '');
  }

  /* ================= CONSULTING YOUR SPECIALISTS =================
     A calm narration built from real events: one italic line (.consult-line), five dots that fill
     as specialists reply (.specialist-dots) and a notebook of their findings (.field-note cards).
     Reveals are queued and released one every 600–900 ms; a final itinerary flushes them in ~1.5 s. */
  const SPECIALISTS = AGENTS.slice(1).map((a) => a.key);
  const SLUG = { 'Trip Architect': 'architect', Explorer: 'explorer', Flights: 'flights', Stays: 'stays', Experiences: 'experiences', 'Local Insider': 'insider' };
  const IDLE_LINE = 'Waiting for your first wish…';
  const NOTES_EMPTY = 'What each specialist finds for you will gather here, like notes from trusted sources.';
  const NOTES_MAX = 8;
  const LINE_MAX = 78; // characters, so a line never needs more than two rows
  // [with a place, without one]. The place always comes from the event text or the trip so far.
  const WORKING = {
    'Trip Architect': ['is shaping your plan around {p}', 'is briefing your specialists'],
    Explorer: ['is reading up on {p}', 'is reading up on the season and the route'],
    Flights: ['is comparing routes into {p}', 'is comparing routes and fares'],
    Stays: ['is looking at rooms in {p}', 'is looking at places to stay'],
    Experiences: ['is finding things to do around {p}', 'is finding things worth doing'],
    'Local Insider': ['is asking around in {p}', 'is asking around for local favourites'],
  };
  const REPLIED = {
    Explorer: ['has reported back on {p}', 'has reported back on the route'],
    Flights: ['has found a way into {p}', 'has found a way there'],
    Stays: ['has a place in mind in {p}', 'has a place in mind'],
    Experiences: ['has found something to do in {p}', 'has found something worth doing'],
    'Local Insider': ['has a tip from {p}', 'has heard about a local favourite'],
  };
  const PHASE_RANK = { idle: 0, consulting: 1, composing: 2, ready: 3, error: 3 };
  const NUM_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const GENERIC = /^(working|thinking|on it|busy)\W*$/i;
  const NOT_GERUND = new Set(['morning', 'evening', 'spring', 'thing', 'nothing', 'something', 'everything', 'anything', 'king', 'ring', 'wing', 'string', 'ceiling', 'building', 'wedding', 'during', 'beijing', 'nanjing', 'kunming', 'sterling', 'viking', 'darling', 'pudding', 'dumpling', 'bring', 'swing', 'sling', 'pending']);
  const STOP_TAIL = /\s+(and|or|with|for|to|the|a|an|of|in|on|at|from|via|by|so|that|which|but|is|are)$/i;
  const consult = {
    box: null, line: null, dots: null, list: null, count: null,
    q: [], timer: null, last: 0, flushing: false,
    phase: 'idle', queued: 'idle',
    replied: new Set(), spoke: new Set(), agentPlaces: new Map(), turnPlaces: [],
    notes: 0, sources: new Set(),
  };
  const speaker = (key) => (key === COORD ? LABEL[key] : 'Your ' + LABEL[key]);
  const words = (n) => NUM_WORDS[n] || String(n);
  const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function buildConsult() {
    consult.box = $('#consult');
    consult.line = $('#consultLine');
    consult.dots = $('#specialistDots');
    consult.list = $('#notesList');
    consult.count = $('#notesCount');
    consult.dots.innerHTML = SPECIALISTS.map((k) => `<span class="specialist-dot" data-agent="${SLUG[k]}" title="${esc(LABEL[k])}"></span>`).join('');
    consult.list.innerHTML = `<p class="notes-empty">${esc(NOTES_EMPTY)}</p>`;
  }

  /* ---- reading the event text ---- */
  function clean(t) {
    return String(t || '')
      .replace(/\*\*|__|`/g, '')
      .replace(/\s*\[[^\]]*\]/g, '')                                      // catalog ids
      .replace(/\s*\(([^)]*)\)/g, (m, inner) => (inner.length <= 6 ? m : '')) // asides, but keep (SPU)
      .replace(/\s*\([^)]*$/, '')                                         // an aside cut by the preview
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–•*]+/, '')
      .trim();
  }
  // Prices belong to the closing section only: drop the clauses that quote one.
  function unpriced(t) {
    return String(t || '')
      .replace(/(^|[,;:]\s*)[^,;:.]*?(?:€|\bEUR\b|\$)\s?\d[^,;.]*/g, (m, lead) => (lead.trim() === ':' ? ': ' : lead.trim() ? '' : ''))
      .replace(/\s*:\s*(?=[.…]|$)/g, '')
      .replace(/,\s*(?=[.…]|$)/g, '')
      .replace(/\s+([,.;])/g, '$1')
      .replace(/\.\s*\./g, '.')
      .replace(/^[\s,;:.]+/, '')
      .trim();
  }
  let placeRx = null;
  function placesIn(text) {
    if (!placeRx && state.places.size) {
      const names = [...state.places.values()]
        .filter((p) => /city|island|neighborhood|insider/.test(p.kind || '') && p.name && p.name.length <= 22)
        .map((p) => p.name).sort((a, b) => b.length - a.length);
      if (names.length) placeRx = new RegExp(`(^|[^\\p{L}])(${names.map(escRx).join('|')})(?![\\p{L}])`, 'gu');
    }
    if (!placeRx || !text) return [];
    const out = [];
    placeRx.lastIndex = 0;
    for (let m = placeRx.exec(text); m; m = placeRx.exec(text)) if (!out.includes(m[2])) out.push(m[2]);
    return out;
  }
  function firstSentence(s) {
    return s.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)[0].replace(/[.!?;:,\s]+$/, '');
  }
  function trimTo(s, n) {
    if (s.length <= n) return s;
    const cut = s.slice(0, n + 1);
    const soft = Math.max(...[', ', ': ', '; ', ' — ', ' – ', ' - ', ' and ', ' with ', ' because '].map((b) => cut.lastIndexOf(b)));
    let out = soft >= n * 0.45 ? cut.slice(0, soft) : cut.slice(0, Math.max(cut.lastIndexOf(' '), 1));
    for (let prev = ''; prev !== out;) { prev = out; out = out.replace(/[\s,;:—–\-+→&]+$/, '').replace(STOP_TAIL, ''); }
    return out;
  }
  // "Comparing routes into Split: …" -> "comparing routes into Split"
  function gerundGist(plain, budget) {
    const s = plain.replace(/(…|\.\.\.)$/, '').replace(/^(still|now|also|just|currently)\s+/i, '');
    const m = s.match(/^([A-Za-z]+ing)\b/);
    if (!m || m[1].length < 5 || NOT_GERUND.has(m[1].toLowerCase())) return '';
    const g = trimTo(firstSentence(s), Math.max(24, budget));
    return g.charAt(0).toLowerCase() + g.slice(1);
  }
  function phrase([withPlace, without], places, key) {
    const ps = (places || []).slice(0, key === 'Flights' || key === 'Local Insider' ? 1 : 2);
    return ps.length ? withPlace.replace('{p}', ps.join(' and ')) : without;
  }
  // A specialist reply (≤140-char preview) -> one or two lines worth keeping as a field note.
  function noteSummary(key, text) {
    const raw = String(text || '').trim();
    const cut = /(…|\.\.\.)$/.test(raw);
    let s = unpriced(clean(raw).replace(/(…|\.\.\.)$/, '').trim());
    let atEnd = true;
    s = s.replace(new RegExp(`^(${escRx(key)}|${escRx(LABEL[key])})\\s*[,:—–-]\\s*`, 'i'), '');
    const item = s.match(/^[^:]{0,100}:\s*[-–•*]\s+(.+)$/);          // "Header: - first item …"
    if (item) s = item[1];
    const best = s.match(/\b(?:best (?:option|pick|bet)|top pick|recommended|my pick)\s*:\s*(.{16,})$/i);
    if (best) s = best[1];
    const inline = s.split(/\s[-–•]\s/);                                 // keep one list item
    if (inline.length > 1) {
      if (/:\s*$/.test(inline[0])) { s = inline[1]; atEnd = inline.length === 2; } // "… Local picks: - X"
      else { s = inline[0]; atEnd = false; }
    }
    const parts = s.split(/(?<=[.!?])\s+/);
    const kept = parts.filter((p) => !/simulated|catalog/i.test(p));
    if (kept.length && kept.length < parts.length) { if (!kept.includes(parts[parts.length - 1])) atEnd = false; s = kept.join(' '); }
    let ell = false;
    if (cut && atEnd) {
      // The preview was cut mid-thought: end on the last full sentence, clause or word.
      const dangling = s.match(/^(.*\S):\s*[^:.]{0,14}$/);              // "… Best option: Luf"
      if (dangling) s = dangling[1];
      const stop = Math.max(s.lastIndexOf('. '), s.lastIndexOf('! '), s.lastIndexOf('? '));
      const tail = stop >= 0 ? s.slice(stop + 2) : s;
      if (stop >= 30 && tail.length < 20) s = s.slice(0, stop + 1);
      else if (dangling) ell = true;
      else {
        const comma = tail.lastIndexOf(', ');
        const head = stop >= 0 ? s.slice(0, stop + 2) : '';
        s = head + (comma >= 24 ? tail.slice(0, comma) : tail.slice(0, Math.max(tail.lastIndexOf(' '), 0)));
        ell = true;
      }
    }
    if (s.length > 160) { s = trimTo(s, 160); ell = true; }
    if (ell) for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/[\s,;:—–\-+→&]+$/, '').replace(STOP_TAIL, ''); }
    s = s.replace(/[\s,;:]+$/, '');
    if (!s) return 'Shared a finding with your Trip Planner.';
    return (s.charAt(0).toUpperCase() + s.slice(1) + (ell ? '…' : '')).replace(/[.,;:]+…$/, '…');
  }

  /* ---- queue & pacing ---- */
  function pump(reset) {
    if (reset && consult.timer) { clearTimeout(consult.timer); consult.timer = null; }
    if (consult.timer || !consult.q.length) return;
    const gap = consult.flushing ? Math.max(150, Math.min(600, 1500 / consult.q.length)) : 600 + Math.random() * 300;
    consult.timer = setTimeout(() => {
      consult.timer = null;
      consult.last = performance.now();
      const it = consult.q.shift();
      if (it) reveal(it);
      pump();
    }, Math.max(0, consult.last + gap - performance.now()));
  }
  // `verb` is "is reading …" / "has a tip …"; the speaker is prefixed here.
  function consultLine(key, verb, weak = false) {
    if (PHASE_RANK[consult.queued] >= 2 || !verb) return;
    if (weak && consult.spoke.has(key)) return;
    consult.spoke.add(key);
    const line = `${speaker(key)} ${verb}`;
    const pending = consult.q.find((it) => it.type === 'line' && it.key === key);
    if (pending) { pending.line = line; return; }
    const lines = consult.q.filter((it) => it.type === 'line');
    if (lines.length >= 3) consult.q.splice(consult.q.indexOf(lines[0]), 1);
    consult.q.push({ type: 'line', key, line });
    pump();
  }
  function consultPhase(phase) {
    if (phase === consult.queued || (phase !== 'error' && PHASE_RANK[phase] <= PHASE_RANK[consult.queued])) return;
    consult.queued = phase;
    consult.q = consult.q.filter((it) => it.type !== 'line');
    if (phase !== 'composing') consult.flushing = true;
    consult.q.push({ type: 'phase', phase });
    pump(consult.flushing);
  }
  function consultActivity(key, kind, text) {
    const plain = unpriced(clean(text));
    const budget = LINE_MAX - speaker(key).length - 5;
    if (key === COORD) {
      if (/present_itinerary/i.test(text)) { consultPhase('composing'); return; }
      if (kind === 'tool') {
        if (/memory|preferences/i.test(text)) consultLine(COORD, /^read\b/i.test(text) ? 'is recalling what you like…' : 'is noting your preferences…');
        return;
      }
      const g = gerundGist(plain, budget);
      if (g) consultLine(COORD, `is ${g}…`);
      return;
    }
    const places = placesIn(plain);
    if (kind === 'replied') {
      consult.q.push({ type: 'note', key, summary: noteSummary(key, text), line: `${speaker(key)} ${phrase(REPLIED[key], places.length ? places : consult.agentPlaces.get(key), key)}` });
      consult.replied.add(key);
      pump();
      if (SPECIALISTS.every((k) => consult.replied.has(k))) consultPhase('composing');
      return;
    }
    if (places.length) consult.agentPlaces.set(key, places);
    const generic = GENERIC.test(plain);
    const g = generic ? '' : gerundGist(plain, budget);
    consultLine(key, g ? `is ${g}…` : `${phrase(WORKING[key], consult.agentPlaces.get(key) || consult.turnPlaces, key)}…`, generic);
  }
  function consultItinerary(draftKind, it) {
    const ps = placesIn(((it && it.days) || []).map((d) => d.place_name || '').join(' · '));
    if (ps.length) consult.turnPlaces = ps;
    if (draftKind) return;
    consult.flushing = true;
    consultPhase('composing');
    pump(true);
  }

  /* ---- reveals ---- */
  function setLine(text) {
    const box = consult.line;
    const cur = box.querySelector('.consult-text:not(.is-leaving)');
    if (cur && cur.textContent === text) return;
    box.querySelectorAll('.is-leaving').forEach((e) => e.remove());
    const next = document.createElement('span');
    next.className = 'consult-text is-entering';
    next.textContent = text;
    box.appendChild(next);
    if (cur) { cur.classList.add('is-leaving'); setTimeout(() => cur.remove(), 450); }
    void next.offsetWidth;
    next.classList.remove('is-entering');
  }
  function syncDotsLabel() {
    const done = SPECIALISTS.filter((k) => consult.dots.querySelector(`[data-agent="${SLUG[k]}"]`).classList.contains('is-filled'));
    consult.dots.setAttribute('aria-label', done.length ? 'Replied: ' + done.map((k) => LABEL[k]).join(', ') : 'Waiting on your specialists');
  }
  function fillDot(key) {
    const d = consult.dots.querySelector(`[data-agent="${SLUG[key]}"]`);
    if (d) d.classList.add('is-filled');
    syncDotsLabel();
  }
  function syncCount() {
    const s = consult.sources.size, n = consult.notes;
    const t = n ? `${words(s)} specialist${s === 1 ? '' : 's'} · ${words(n)} note${n === 1 ? '' : 's'}` : '';
    consult.count.textContent = t.charAt(0).toUpperCase() + t.slice(1);
  }
  function addNote(key, summary) {
    const list = consult.list;
    const empty = list.querySelector('.notes-empty');
    if (empty) empty.remove();
    const el = document.createElement('article');
    el.className = 'field-note is-entering';
    el.dataset.agent = SLUG[key];
    el.innerHTML = `<div class="field-note-head"><span class="field-note-dot"></span><span class="field-note-agent">${esc(LABEL[key])}</span></div><p class="field-note-text"></p>`;
    el.querySelector('.field-note-text').textContent = summary;
    el.title = `${LABEL[key]} — ${summary}`;
    // FLIP: the notes already shown glide down instead of jumping.
    const cards = [...list.querySelectorAll('.field-note:not(.is-gone)')];
    const before = cards.map((c) => c.getBoundingClientRect().top);
    list.prepend(el);
    cards.forEach((c, i) => {
      const dy = before[i] - c.getBoundingClientRect().top;
      if (dy) { c.style.transition = 'none'; c.style.transform = `translateY(${dy}px)`; }
    });
    void list.offsetHeight;
    cards.forEach((c) => { c.style.transition = ''; c.style.transform = ''; });
    el.classList.remove('is-entering');
    cards.slice(NOTES_MAX - 1).forEach((c) => { c.classList.add('is-gone'); setTimeout(() => c.remove(), 450); });
    consult.notes += 1;
    consult.sources.add(key);
    syncCount();
  }
  function reveal(it) {
    const narrating = PHASE_RANK[consult.phase] < 2;
    if (it.type === 'line') { if (narrating) setLine(it.line); return; }
    if (it.type === 'note') { if (narrating) setLine(it.line); fillDot(it.key); addNote(it.key, it.summary); return; }
    consult.phase = it.phase;
    consult.box.dataset.phase = it.phase;
    setLine(it.phase === 'composing' ? 'Composing your plan…'
      : it.phase === 'ready' ? `Ready — prepared by your ${countLit()} travel specialists`
        : 'Your specialists were interrupted — try again');
  }

  /* ---- turn lifecycle ---- */
  function consultBeginTurn(text) {
    clearTimeout(consult.timer);
    Object.assign(consult, { timer: null, q: [], flushing: false, phase: 'consulting', queued: 'consulting', last: performance.now() });
    consult.replied.clear(); consult.spoke.clear(); consult.agentPlaces.clear();
    const ps = placesIn(text || '');
    if (ps.length) consult.turnPlaces = ps;
    consult.dots.querySelectorAll('.is-filled').forEach((d) => d.classList.remove('is-filled'));
    syncDotsLabel();
    consult.box.dataset.phase = 'consulting';
    setLine('Consulting your specialists…');
  }
  function consultReset() {
    clearTimeout(consult.timer);
    Object.assign(consult, { timer: null, q: [], flushing: false, phase: 'idle', queued: 'idle', notes: 0, turnPlaces: [] });
    consult.replied.clear(); consult.spoke.clear(); consult.agentPlaces.clear(); consult.sources.clear();
    consult.dots.querySelectorAll('.is-filled').forEach((d) => d.classList.remove('is-filled'));
    syncDotsLabel();
    consult.list.innerHTML = `<p class="notes-empty">${esc(NOTES_EMPTY)}</p>`;
    syncCount();
    consult.box.dataset.phase = 'idle';
    setLine(IDLE_LINE);
  }

  /* ================= ITINERARY ================= */
  const SLOT = [['morning', '☀️', 'Morning'], ['afternoon', '🌤️', 'Afternoon'], ['evening', '🌙', 'Evening']];
  const MODE = { flight: '✈️', ferry: '⛴️', train: '🚆', boat: '⛵', car: '🚗', walk: '🚶' };
  const BUDGET = { budget: 'Budget', balanced: 'Balanced', comfort: 'Comfort', luxury: 'Luxury' };

  // v0 is a draft: a prebuilt plan for a quick-start chip (instant) or a Haiku sketch for free text.
  // v1+ come from the specialists. A draft never replaces a specialist version.
  const DRAFT_COPY = { label: 'instant plan', note: 'your specialists are tailoring it for you…', chat: 'Your instant plan is ready — your specialists are tailoring it for you' };
  const DRAFT = { prebuilt: DRAFT_COPY, sketch: DRAFT_COPY };
  function renderItinerary(it, version, draftKind = null) {
    if (!it || typeof it !== 'object') return;
    const draft = DRAFT[draftKind] || null;
    const sketch = !!draft;
    if (sketch && state.itinerary && !state.sketch) return;
    const v = Number.isInteger(version) ? version : state.version + 1;
    const prevVersion = state.itinerary ? state.version : null;
    const isNew = prevVersion === null || v !== prevVersion || state.sketch !== sketch;
    state.version = v;
    state.itinerary = it;
    state.sketch = sketch;
    const stage = $('#stage');
    const firstTime = stage.classList.contains('empty');
    stage.classList.remove('empty');
    stage.classList.toggle('sketching', sketch);
    const nextQ = sketch ? '' : it.next_question;
    const verLabel = sketch ? draft.label : 'Prepared by your specialists';

    // Summary
    const sb = $('#summaryBody');
    sb.classList.toggle('is-v0', sketch);
    sb.innerHTML = `
      <div class="sum-top">
        <div class="version version-badge ${isNew ? 'flip' : ''} ${sketch ? 'is-v0' : ''}"><div class="version-inner">✦</div></div>
        <div>
          <span class="ver-label ${sketch ? 'is-v0' : ''}">${esc(verLabel)}</span>
          ${prevVersion !== null && isNew && !sketch ? '<span class="sum-new">UPDATED</span>' : ''}
          <h2 class="sum-title">${esc(it.title || 'Your trip')}</h2>
        </div>
      </div>
      ${sketch ? `<div class="v0-shimmer" id="v0Shimmer"><span class="v0-shimmer-dot"></span><span class="v0-shimmer-text">${draft.note}</span></div>` : ''}
      <p class="sum-summary">${esc(it.summary || '')}</p>
      <div class="meta">
        ${it.dates ? `<span>📅 <b>${esc(it.dates)}</b></span>` : ''}
        ${it.travellers ? `<span>👨‍👩‍👧 ${esc(it.travellers)}</span>` : ''}
        ${it.budget_style ? `<span>💎 ${esc(BUDGET[it.budget_style] || it.budget_style)}</span>` : ''}
        ${Array.isArray(it.days) ? `<span>🗓️ ${it.days.length} days</span>` : ''}
      </div>
      ${it.weather_note ? `<div class="weather"><span>🌤️</span><span>${esc(it.weather_note)}</span></div>` : ''}
      ${nextQ ? `<div class="next-q" id="nextQ"><div class="eyebrow">Atlas asks</div><div class="next-q-text">${esc(nextQ)}</div></div>` : ''}`;
    sb.classList.remove('reveal'); void sb.offsetWidth; sb.classList.add('reveal');
    const nq = $('#nextQ');
    if (nq) nq.addEventListener('click', () => { const i = $('#input'); i.focus(); i.placeholder = 'Answer: ' + nextQ; });

    if (isNew) {
      addMsg('system', sketch
        ? `✦ ${draft.chat}`
        : '✦ Your updated plan is ready — refined by your specialists');
    }
    if (nextQ && isNew) addMsg('assistant', nextQ, 'question');

    renderDays(it.days || []);
    renderFlights(it.flights || []);
    renderExperiences(it.experiences || []);
    renderInsider(it.insider_tips || []);
    renderTripTotal(it, sketch);
    setTimeout(() => renderMap(it), firstTime ? 120 : 0);
  }

  // The turn ended with only the draft on screen (the specialists failed): stop promising a refinement.
  function endSketch() {
    if (!state.sketch) return;
    $('#stage').classList.remove('sketching');
    const n = $('#v0Shimmer');
    if (n) { n.classList.add('ended'); n.querySelector('.v0-shimmer-text').textContent = 'your specialists could not refine it this time'; }
  }

  function renderDays(days) {
    const wrap = $('#days');
    wrap.innerHTML = '';
    days.forEach((d, idx) => {
      const place = resolvePlace(d.place_id, d.place_name);
      const card = document.createElement('article');
      card.className = 'panel day';
      card.style.animationDelay = idx * 70 + 'ms';
      const slots = SLOT.filter(([k]) => d[k] && (d[k].title || d[k].description)).map(([k, ico, label]) => `
        <div class="slot"><div class="slot-ico">${ico}</div><div>
          <div class="slot-when">${label}</div>
          <div class="slot-title">${esc(d[k].title)}</div>
          ${d[k].description ? `<div class="slot-desc">${esc(d[k].description)}</div>` : ''}
        </div></div>`).join('');
      const s = d.stay, t = d.transport;
      card.innerHTML = `
        <div class="day-media">
          <img alt="" />
          <span class="day-num">Day ${esc(d.day ?? idx + 1)}</span>
          <div class="day-place"><b>${esc(d.place_name || (place && place.name) || '')}</b><span>${esc(d.theme || '')}</span></div>
          <button class="play hidden" type="button" aria-label="Play video"><svg viewBox="0 0 24 24"><path d="M6 4l15 8-15 8z"/></svg></button>
        </div>
        <div class="credit">&nbsp;</div>
        <div class="day-body">
          ${slots}
          ${s && s.name ? `<div class="day-line"><span>🛏️</span><span><b>${esc(s.name)}</b>${s.type ? ' · ' + esc(s.type) : ''}${s.why ? `<br><span style="opacity:.75">${esc(s.why)}</span>` : ''}</span></div>` : ''}
          ${t && (t.from || t.to) ? `<div class="day-line"><span>${MODE[t.mode] || '➜'}</span><span><b>${esc(t.from)} → ${esc(t.to)}</b>${t.carrier ? ' · ' + esc(t.carrier) : ''}${t.depart ? `<br><span style="opacity:.75">${esc(t.depart)}${t.arrive ? ' → ' + esc(t.arrive) : ''}</span>` : ''}</span></div>` : ''}
        </div>`;
      wrap.appendChild(card);
      const mediaId = (place && place.id) || d.place_id || (d.morning && d.morning.place_id) || (d.afternoon && d.afternoon.place_id);
      attachMedia(card, mediaId, idx);
    });
  }
  async function attachMedia(card, id, idx) {
    const m = await getMedia(id);
    if (!m) return;
    const img = card.querySelector('.day-media img');
    const photos = (m.photos || []).filter((p) => safeUrl(p.url));
    if (photos.length) {
      const p = photos[idx % Math.min(photos.length, 3)] || photos[0];
      img.onload = () => img.classList.add('loaded');
      img.onerror = () => { if (photos[1] && img.src !== photos[1].url) img.src = photos[1].url; };
      img.src = p.url;
      const credit = card.querySelector('.credit');
      const src = safeUrl(p.source_page);
      credit.innerHTML = `Photo: ${src ? `<a href="${esc(src)}" target="_blank" rel="noopener">` : ''}${esc(p.author || 'Wikimedia Commons')} · ${esc(p.license || '')}${src ? '</a>' : ''}`;
    }
    const v = (m.videos || []).find((x) => x && /^[\w-]{6,20}$/.test(String(x.id || '')));
    if (v) {
      const btn = card.querySelector('.play');
      btn.classList.remove('hidden');
      btn.title = v.title || 'Play video';
      btn.addEventListener('click', () => {
        const media = card.querySelector('.day-media');
        const f = document.createElement('iframe');
        f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?start=${parseInt(v.start_seconds, 10) || 0}&autoplay=1`;
        f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        f.allowFullscreen = true;
        f.title = v.title || 'Video';
        media.appendChild(f);
        btn.classList.add('hidden');
      });
    }
  }

  function renderFlights(flights) {
    const el = $('#flights');
    if (!flights.length) { el.innerHTML = '<div class="empty-note">Flights land here once your Flight Specialist replies.</div>'; return; }
    const code = (s) => { const m = String(s || '').match(/\b[A-Z]{3}\b/); return m ? m[0] : String(s || '').slice(0, 14); };
    el.innerHTML = flights.map((f) => `
      <div class="pass">
        <div><div class="code">${esc(code(f.from))}</div><div class="time">${esc(f.depart || '')}</div></div>
        <div class="arrow"><i>✈</i>${esc(f.duration || '')}<br>${esc(f.carrier || '')}</div>
        <div class="right"><div class="code">${esc(code(f.to))}</div><div class="time">${esc(f.arrive || '')}</div></div>
      </div>`).join('');
  }
  function renderExperiences(exps) {
    const el = $('#experiences');
    if (!exps.length) { el.innerHTML = '<div class="empty-note">Experiences are on their way.</div>'; return; }
    const ico = (t) => (/sail|boat|cruise/i.test(t) ? '⛵' : /div|snork|swim/i.test(t) ? '🤿' : /para|fly/i.test(t) ? '🪂' : /food|taste|wine|lobster|dinner/i.test(t) ? '🍷' : /walk|hike|trail/i.test(t) ? '🥾' : '✨');
    el.innerHTML = exps.map((x) => `
      <div class="exp"><div class="exp-ico">${ico(x.title || '')}</div>
        <div><div class="exp-title">${esc(x.title)}</div>${x.why ? `<div class="exp-why">${esc(x.why)}</div>` : ''}</div></div>`).join('');
  }
  function renderInsider(tips) {
    const el = $('#insider');
    if (!tips.length) { el.innerHTML = '<div class="empty-note">The Local Insider is still asking around.</div>'; return; }
    el.innerHTML = tips.map((t, i) => {
      const p = resolvePlace(t.place_id, null);
      return `<div class="tip" style="animation-delay:${i * 90}ms"><span class="secret">🔑 Secret</span>
        <div class="tip-title">${esc(t.title)}</div><div class="tip-desc">${esc(t.description)}</div>
        ${p ? `<div class="tip-place">📍 ${esc(p.name)}</div>` : ''}</div>`;
    }).join('');
  }

  /* ================= YOUR TRIP, ALL TOGETHER =================
     The only place prices appear: a breakdown built from the itinerary fields, closing with the
     estimated total and the booking button. Falls back to total_estimate_eur alone. */
  const num = (n) => (typeof n === 'number' && isFinite(n) && n > 0 ? n : 0);
  function tripBreakdown(it) {
    const days = Array.isArray(it.days) ? it.days : [];
    const flightsList = Array.isArray(it.flights) && it.flights.length ? it.flights : days.map((d) => d.transport).filter((t) => t && t.mode === 'flight');
    const flights = flightsList.reduce((a, f) => a + num(f.price_eur), 0);
    const stays = new Map();
    days.forEach((d) => {
      const st = d.stay;
      if (!st || !st.name || !num(st.price_per_night_eur)) return;
      const key = st.name + '|' + st.price_per_night_eur;
      const rec = stays.get(key) || { name: st.name, rate: st.price_per_night_eur, nights: 0 };
      rec.nights += 1;
      stays.set(key, rec);
    });
    const stayList = [...stays.values()];
    const staysTotal = stayList.reduce((a, s) => a + s.nights * s.rate, 0);
    const experiences = (Array.isArray(it.experiences) ? it.experiences : []).reduce((a, x) => a + num(x.price_eur), 0);
    const known = flights + staysTotal + experiences;
    const total = num(it.total_estimate_eur) >= known ? num(it.total_estimate_eur) : known;
    return { flights, stayList, staysTotal, experiences, extras: total - known >= 1 ? total - known : 0, total };
  }
  function renderTripTotal(it, sketch) {
    const b = tripBreakdown(it);
    const nights = (n) => `${n} night${n === 1 ? '' : 's'}`;
    const stayDetail = b.stayList.length === 1
      ? `${nights(b.stayList[0].nights)} × ${fmtEur(b.stayList[0].rate)}`
      : b.stayList.map((s) => `${esc(s.name)}, ${nights(s.nights)} × ${fmtEur(s.rate)}`).join(' · ');
    const row = (label, amount, detail = '') => (amount ? `
      <div class="tt-row"><div class="tt-label">${label}${detail ? `<span class="tt-detail">${detail}</span>` : ''}</div><div class="tt-amount">${esc(fmtEur(amount))}</div></div>` : '');
    const rows = row('Flights', b.flights) + row('Stays', b.staysTotal, stayDetail)
      + row('Experiences', b.experiences) + row('Ferries, meals &amp; extras', b.extras);
    $('#tripTotalBody').innerHTML = `
      ${rows ? `<div class="tt-rows">${rows}</div><div class="tt-rule"></div>` : ''}
      <div class="tt-bottom">
        <div><div class="total-label">${sketch ? 'First estimate' : 'Estimated total'}</div><div class="total">${esc(fmtEur(b.total) || '—')}</div></div>
        <button class="book-btn" id="bookBtn" type="button">Book everything →</button>
      </div>
      <div class="tt-note">Simulated booking · no payment taken</div>`;
    $('#bookBtn').addEventListener('click', book);
  }
  // The planning cost shows once, quietly, after your specialists are done.
  function showCost() {
    if (state.cost == null) return;
    let el = $('#preparedCost');
    if (!el) { el = document.createElement('div'); el.id = 'preparedCost'; el.className = 'prepared-cost'; }
    el.textContent = `prepared for $${Math.max(0.01, state.cost).toFixed(2)}`;
    $('#swarm').appendChild(el); // last child: below the notes and any card attached later
    el.classList.remove('hidden');
  }
  function hideCost() { const el = $('#preparedCost'); if (el) el.classList.add('hidden'); }

  /* ================= MAP ================= */
  function renderMap(it) {
    if (!window.L) { $('#map').innerHTML = '<div class="empty-note" style="padding:20px">Map unavailable offline.</div>'; return; }
    if (!state.map) {
      state.map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(state.map);
    }
    state.map.invalidateSize();
    if (state.mapLayer) state.mapLayer.remove();
    const layer = L.layerGroup().addTo(state.map);
    state.mapLayer = layer;

    // Group consecutive days at the same base place into one numbered pin.
    const stops = [];
    (it.days || []).forEach((d, i) => {
      const p = resolvePlace(d.place_id, d.place_name);
      if (!p || typeof p.lat !== 'number') return;
      const last = stops[stops.length - 1];
      const n = d.day ?? i + 1;
      if (last && last.p.id === p.id) last.days.push(n); else stops.push({ p, days: [n] });
    });
    const seen = new Set(stops.map((s) => s.p.id));
    const extras = [];
    (it.days || []).forEach((d) => SLOT.forEach(([k]) => {
      const p = d[k] && resolvePlace(d[k].place_id, null);
      if (p && typeof p.lat === 'number' && !seen.has(p.id)) { seen.add(p.id); extras.push(p); }
    }));
    (it.insider_tips || []).concat(it.experiences || []).forEach((t) => {
      const p = resolvePlace(t.place_id, null);
      if (p && typeof p.lat === 'number' && !seen.has(p.id)) { seen.add(p.id); extras.push(p); }
    });

    const pts = stops.map((s) => [s.p.lat, s.p.lon]);
    if (pts.length > 1) {
      L.polyline(pts, { color: '#D68C4C', weight: 9, opacity: 0.18, className: 'route-glow' }).addTo(layer);
      L.polyline(pts, { color: '#F6E6C0', weight: 2.5, opacity: 0.95, className: 'route-line' }).addTo(layer);
    }
    extras.forEach((p) => {
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: '<div class="pin-dot"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) })
        .bindTooltip(esc(p.name), { direction: 'top' }).addTo(layer);
    });
    // One pin per place; a place visited twice (e.g. Split at start and end) lists every day.
    const pins = new Map();
    stops.forEach((s) => { const pin = pins.get(s.p.id); if (pin) pin.days.push(...s.days); else pins.set(s.p.id, { p: s.p, days: [...s.days] }); });
    pins.forEach((s) => {
      const runs = [];
      s.days.forEach((n) => { const r = runs[runs.length - 1]; if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]); });
      const label = runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(' · ');
      L.marker([s.p.lat, s.p.lon], {
        icon: L.divIcon({ className: '', html: `<div class="pin${label.length > 3 ? ' wide' : ''}"><span>${esc(label)}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 34] }),
        zIndexOffset: 1000,
      }).bindTooltip(`Day ${esc(label)} · ${esc(s.p.name)}`, { direction: 'top', offset: [0, -30] }).addTo(layer);
    });
    const all = pts.concat(extras.map((p) => [p.lat, p.lon]));
    $('#mapSub').textContent = stops.length ? stops.map((s) => s.p.name).join(' → ') : '';
    if (all.length === 1) state.map.setView(all[0], 10);
    else if (all.length) state.map.fitBounds(all, { padding: [46, 46], maxZoom: 11 });
    else state.map.setView([45, 10], 4);
    setTimeout(() => state.map && state.map.invalidateSize(), 400);
  }

  /* ================= BOOKING ================= */
  async function book() {
    const btn = $('#bookBtn');
    btn.disabled = true; btn.textContent = 'Booking…';
    try {
      let data;
      if (MOCK) { await sleep(700); data = mockBooking(); }
      else {
        const r = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: state.conversationId }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        data = await r.json();
      }
      showBooking(data);
    } catch (e) {
      toast('Booking failed: ' + (e && e.message ? e.message : e));
    } finally { btn.disabled = false; btn.textContent = 'Book everything →'; }
  }
  function showBooking(d) {
    const K = { flight: '✈️', stay: '🏡', experience: '⛵' };
    $('#confCode').textContent = d.confirmation || 'EA-?????';
    $('#confItems').innerHTML = (d.items || []).map((x, i) => `<div class="conf-item" style="animation-delay:${i * 90 + 200}ms"><span class="k">${K[x.kind] || '✦'}</span><span class="t">${esc(x.title)}</span><span class="p">${esc(fmtEur(x.price_eur))}</span></div>`).join('');
    $('#confTotal').textContent = fmtEur(d.total_eur) || '—';
    $('#modal').classList.remove('hidden');
    confetti();
    addMsg('system', `✓ Booked · confirmation ${d.confirmation || ''}`);
  }
  function confetti() {
    const c = $('#confetti');
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const colors = ['#0F766E', '#E8664A', '#3B82C4', '#B8925A', '#C2603E', '#1E2A44'];
    const ps = [];
    const origins = [[innerWidth * 0.5, innerHeight * 0.42], [innerWidth * 0.2, innerHeight * 0.9], [innerWidth * 0.8, innerHeight * 0.9]];
    origins.forEach(([ox, oy], oi) => {
      for (let i = 0; i < 110; i++) {
        const ang = oi === 0 ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * 1.1 + (oi === 1 ? 0.3 : -0.3);
        const sp = oi === 0 ? 4 + Math.random() * 9 : 10 + Math.random() * 9;
        ps.push({ x: ox, y: oy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, w: 5 + Math.random() * 7, h: 3 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: colors[(Math.random() * colors.length) | 0], circle: Math.random() < 0.25, life: 0 });
      }
    });
    const t0 = performance.now();
    (function frame(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach((p) => {
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t / 4200); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col;
        if (p.circle) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (t < 4300) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(t0);
  }

  /* ================= NEW TRIP ================= */
  function newTrip() {
    state.conversationId = null; state.version = 0; state.itinerary = null; state.sketch = false; state.queue = [];
    $('#stage').classList.remove('sketching'); $('#summaryBody').classList.remove('is-v0');
    chat.innerHTML = '';
    addMsg('assistant', 'Fresh canvas. Where would you like to go next?');
    $('#stage').classList.add('empty');
    $('#summaryBody').innerHTML = ''; $('#days').innerHTML = '';
    orbMap.forEach((rec) => { rec.el.className = 'orb' + (rec.a.key === COORD ? ' coord' : ''); if (rec.beam) { rec.beam.classList.remove('lit'); rec.flow.classList.remove('lit'); } });
    state.t0 = null;
    $('#swarm').classList.remove('running', 'done');
    setPill('idle', 'Idle');
    consultReset();
    state.cost = null; hideCost();
    $('#tripTotalBody').innerHTML = '';
  }

  /* ================= MOCK (dev hook: ?mock=1, &auto=1 to auto-run) ================= */
  const MOCK_IT = {
    title: 'Dalmatian Islands by Sail',
    summary: 'A gentle week hopping Split → Hvar → Vis by ferry and skippered boat: short crossings, calm mornings for the kids, and evenings in stone harbours.',
    travellers: '1 adult + 2 kids (7 & 10)',
    budget_style: 'balanced',
    dates: '27 Jun – 3 Jul 2027',
    weather_note: 'Late June: 27 °C days, sea at 24 °C, steady maestral breeze in the afternoons — ideal for beginner sailing.',
    total_estimate_eur: 3480,
    days: [
      { day: 1, place_id: 'split-hr', place_name: 'Split', theme: 'Soft landing',
        morning: { title: 'Land in Split 09:40', description: 'Transfer to the old town, early check-in arranged.', place_id: 'split-hr' },
        afternoon: { title: 'Swim at Bačvice beach', description: 'Shallow sandy water, perfect after the flight.', place_id: 'split-hr' },
        evening: { title: "Diocletian's Palace at dusk", description: 'Gelato on the Riva, early dinner.', place_id: 'split-hr' },
        stay: { name: 'Palace Loft Apartments', type: 'Family apartment', price_per_night_eur: 165, why: 'Two bedrooms inside the palace walls' },
        transport: { mode: 'flight', from: 'Munich (MUC)', to: 'Split (SPU)', carrier: 'Croatia Airlines OU 4415', depart: '08:05', arrive: '09:40', price_eur: 567 } },
      { day: 2, place_id: 'split-hr', place_name: 'Split', theme: 'First day on the water',
        morning: { title: 'Kornati day sail', description: 'Skippered catamaran, kids take the helm.', place_id: 'split-kornati-hr' },
        afternoon: { title: 'Snorkel stop in a turquoise cove', description: 'Masks and fins on board.', place_id: 'split-kornati-hr' },
        evening: { title: 'Sunset on Marjan Hill', description: 'Short pine-scented walk with city views.', place_id: 'split-marjan-hr' },
        stay: { name: 'Palace Loft Apartments', type: 'Family apartment', price_per_night_eur: 165, why: 'Same base, no repacking' } },
      { day: 3, place_id: 'hvar-hr', place_name: 'Hvar', theme: 'Island time',
        morning: { title: 'Catamaran to Hvar', description: 'One-hour hop, dolphins sometimes follow.', place_id: 'hvar-hr' },
        afternoon: { title: 'Fortica fortress climb', description: 'Views over the Pakleni islands.', place_id: 'hvar-hr' },
        evening: { title: 'Harbour promenade', description: 'Fresh fish and lavender ice cream.', place_id: 'hvar-hr' },
        stay: { name: 'Apartment Dalmatina', type: 'Family suite', price_per_night_eur: 145, why: '1 double + 2 singles, 3 min to the harbour' },
        transport: { mode: 'ferry', from: 'Split', to: 'Hvar', carrier: 'Jadrolinija', depart: '09:15', arrive: '10:20', price_eur: 54 } },
      { day: 4, place_id: 'hvar-pakleni-hr', place_name: 'Pakleni Islands', theme: 'Sail & swim',
        morning: { title: 'Taxi boat to Palmižana', description: 'Pine forest and clear shallow bays.', place_id: 'hvar-pakleni-hr' },
        afternoon: { title: 'Kayak around Jerolim', description: 'Guided, child-sized kayaks.', place_id: 'hvar-pakleni-hr' },
        evening: { title: 'Stari Grad old town', description: 'UNESCO plain and quiet konobas.', place_id: 'stari-grad-hr' },
        stay: { name: 'Apartment Dalmatina', type: 'Family suite', price_per_night_eur: 145, why: 'Easy walk back from the taxi boats' } },
      { day: 5, place_id: 'vis-hr', place_name: 'Vis', theme: 'The far island',
        morning: { title: 'Ferry to Vis', description: 'The most remote inhabited island of the archipelago.', place_id: 'vis-hr' },
        afternoon: { title: 'Wreck snorkel off Vis', description: 'Shallow wreck, visible from the surface.', place_id: 'vis-diving-hr' },
        evening: { title: 'Komiža harbour', description: 'Fishermen’s village at golden hour.', place_id: 'komiza-hr' },
        stay: { name: 'Kuća Komiža', type: 'Stone house', price_per_night_eur: 130, why: 'Courtyard, sea view, kitchen' },
        transport: { mode: 'boat', from: 'Hvar', to: 'Vis', carrier: 'Krilo catamaran', depart: '08:30', arrive: '09:45', price_eur: 48 } },
      { day: 6, place_id: 'split-hr', place_name: 'Split', theme: 'Last swim, fly home',
        morning: { title: 'Early boat back to Split', description: 'Breakfast on deck.', place_id: 'split-hr' },
        afternoon: { title: 'Green market & last swim', description: 'Pazar market for figs and cherries.', place_id: 'split-hr' },
        transport: { mode: 'flight', from: 'Split (SPU)', to: 'Munich (MUC)', carrier: 'Croatia Airlines OU 4416', depart: '18:20', arrive: '19:55', price_eur: 540 } },
    ],
    flights: [
      { from: 'Munich MUC', to: 'Split SPU', carrier: 'Croatia Airlines', depart: '27 Jun 08:05', arrive: '09:40', duration: '1h 35m', price_eur: 567 },
      { from: 'Split SPU', to: 'Munich MUC', carrier: 'Croatia Airlines', depart: '3 Jul 18:20', arrive: '19:55', duration: '1h 35m', price_eur: 540 },
    ],
    experiences: [
      { title: 'Skippered Kornati day sail', place_id: 'split-kornati-hr', price_eur: 390, why: 'Private catamaran, kids learn to steer' },
      { title: 'Blue Cave & Stiniva speedboat at 8 am', place_id: 'vis-hr', price_eur: 240, why: 'Before the crowds, calm water' },
      { title: 'Pakleni kayak & snorkel', place_id: 'hvar-pakleni-hr', price_eur: 135, why: 'Guided, child-sized kayaks' },
    ],
    insider_tips: [
      { title: 'Lobster in the old boathouse', description: 'Konoba Jastožera in Komiža serves lobster on planks over the water. Book the 18:30 table — kids watch the boats come in.', place_id: 'komiza-hr' },
      { title: 'Swim where Split swims', description: 'Skip Bačvice at noon: locals go to Kašjuni cove below Marjan at 8 am, shade and clear water.', place_id: 'split-marjan-hr' },
      { title: 'Stari Grad, not Hvar town', description: 'Take the evening in Stari Grad: the oldest town in Croatia, half the price, no party boats.', place_id: 'stari-grad-hr' },
    ],
    next_question: 'Would you like a villa with a pool above Stari Grad for €60 more a night?',
  };
  function mockItinerary(v) {
    const it = JSON.parse(JSON.stringify(MOCK_IT));
    if (v >= 2) {
      it.summary = 'Same easy rhythm, now with a pool villa above Stari Grad for the Hvar nights and the sunset sail moved to day 4.';
      it.budget_style = 'comfort';
      it.total_estimate_eur = 3600;
      [2, 3].forEach((i) => { it.days[i].stay = { name: 'Villa Lavanda', type: 'Villa with pool', price_per_night_eur: 205, why: 'Private pool, lavender fields, 5 min to Stari Grad' }; });
      it.days[3].evening = { title: 'Sunset sail from Stari Grad', description: 'Two hours on a traditional gajeta.', place_id: 'stari-grad-hr' };
      it.next_question = 'Shall I book the 8 am speedboat to the Blue Cave on day 5?';
    }
    return it;
  }
  function mockSketch() {
    const it = mockItinerary(1);
    it.title = 'Croatian Islands, Sail & Swim';
    it.summary = 'A first sketch: Split, Hvar and Vis with short hops and calm mornings for the kids.';
    it.total_estimate_eur = 3200;
    it.days.forEach((d) => SLOT.forEach(([k]) => { if (d[k]) d[k].description = d[k].description.split(/[,.]/)[0]; }));
    it.experiences = it.experiences.slice(0, 2);
    it.insider_tips = it.insider_tips.slice(0, 2);
    it.next_question = '';
    return it;
  }
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  async function mockPrebuilt(text) {
    try {
      const map = await fetch('/fixtures/demo-itineraries/prebuilt.json').then((r) => (r.ok ? r.json() : {}));
      const file = Object.entries(map).find(([k]) => norm(k) === norm(text));
      if (!file) return null;
      const it = await fetch('/fixtures/demo-itineraries/' + encodeURIComponent(file[1])).then((r) => (r.ok ? r.json() : null));
      if (it) it.next_question = '';
      return it;
    } catch { return null; }
  }
  async function emit(ev, ms = 0) { if (ms) await sleep(ms); handleEvent(ev); }
  // Shaped like real backend events: briefs as `delegated`, "working…", ≤140-char reply previews
  // (cut with "…"), present_itinerary, the memory edit and a done message that carries seconds.
  const MOCK_SCRIPT = [
    {
      opening: 'Reading the request and briefing 5 specialists',
      team: ['Explorer', 'Flights', 'Stays', 'Experiences', 'Local Insider'],
      briefs: {
        Explorer: 'Traveller: parent + 2 kids (7 and 10), mid budget, sailing in late June. Suggest the best route around Split, Hvar and Vis with weather…',
        Flights: 'Parent + 2 kids, late June, likely Munich to Split. Suggest 2 nonstop flights with civilised times and simulated EUR prices.',
        Stays: 'Parent + 2 kids, mid budget, 6 nights across Split, Hvar and Vis. One apartment with 1 double + 2 singles, near the harbour.',
        Experiences: 'Parent + 2 kids, late June, Split/Hvar/Vis. Suggest up to 4 kid-friendly sailing or snorkelling experiences with EUR prices.',
        'Local Insider': 'Parent + 2 kids, Split/Hvar/Vis, late June. Suggest 3 non-touristy, kid-friendly local spots (ids: komiza-hr, stari-grad-hr, split-…',
      },
      flow: [
        ['Explorer', 'working', 'Reading the late-June climate for Split and the islands', 900],
        ['Flights', 'working', 'Comparing routes into Split: nonstop from Munich vs via Zagreb', 700],
        ['Local Insider', 'working', 'Asking around in Komiža for a quiet cove the kids will love', 800],
        ['Stays', 'replied', 'Family lodging, Split and Hvar: - Palace Loft Apartments, Split: two bedrooms inside the palace walls, €165/night. - Apartment Dalmatina…', 1300],
        ['Experiences', 'working', 'Weighing skippered day sails: Kornati vs Pakleni', 500],
        ['Explorer', 'replied', '- Best pick: Split → Hvar → Vis, every hop under 1h30. Late June brings 27 °C days and a 24 °C sea, with the maestral breeze after 2 pm…', 1100],
        ['Experiences', 'replied', '- Kornati day sail (skippered catamaran, kids can steer): about €390 for the family. Blue Cave by speedboat at 8 am, before the crowds…', 900],
        ['Trip Architect', 'working', 'Still waiting on the flights and local-insider replies.', 600],
        ['Local Insider', 'replied', 'Local picks, Split/Hvar/Vis: - Komiža, Vis: Konoba Jastožera serves lobster on planks over the water. Book the 18:30 table so the kids…', 1200],
        ['Trip Architect', 'working', 'Still waiting on the flights reply.', 500],
        ['Flights', 'replied', 'Munich (MUC) → Split (SPU), 1 adult + 2 children, simulated fares. Best option: Croatia Airlines OU 4415, 08:05 → 09:40 nonstop, €189 a seat.', 1000],
      ],
    },
    {
      opening: 'Reading the change and re-briefing Stays, Experiences and the Local Insider',
      team: ['Stays', 'Experiences', 'Local Insider'],
      briefs: {
        Stays: 'Update: the traveller wants a pool villa near Stari Grad for the Hvar nights. Same dates, comfort over price.',
        Experiences: 'Update: villa base near Stari Grad. Move the sunset sail to day 4 and keep mornings calm for the kids.',
        'Local Insider': 'Update: base moves to a villa above Stari Grad. One quiet konoba nearby that locals book ahead.',
      },
      flow: [
        ['Stays', 'working', 'Checking pool villas within 10 minutes of Stari Grad', 900],
        ['Local Insider', 'working', 'Asking around in Stari Grad for a konoba locals book ahead', 800],
        ['Stays', 'replied', 'Pool villas near Stari Grad: - Villa Lavanda: private pool among lavender fields, 5 min to Stari Grad, about €60 a night more.', 1200],
        ['Experiences', 'replied', 'Moved the sunset sail: a traditional gajeta from Stari Grad on day 4, two hours on the water, about €180 for the family.', 1000],
        ['Local Insider', 'replied', '- Konoba Kokot, near Stari Grad: lamb peka slow-cooked under the bell. Order a day ahead, they only make what is booked.', 1100],
      ],
    },
  ];
  async function mockTurn(text) {
    state.mockTurn += 1;
    const turn = state.mockTurn;
    const S = MOCK_SCRIPT[turn === 1 ? 0 : 1];
    const t0 = performance.now();
    await emit({ type: 'conversation', conversation_id: 'mock-conv-1' }, 120);
    const pre = turn === 1 ? await mockPrebuilt(text) : null;
    if (pre) await emit({ type: 'itinerary', version: 0, prebuilt: true, itinerary: pre });
    await emit({ type: 'swarm.status', status: 'starting', message: 'Briefing the team' }, 150);
    const reply = turn === 1
      ? 'Sailing with the kids at the end of June — lovely. I’m sketching a week around Split, Hvar and Vis with short hops and calm mornings.'
      : 'There’s a villa with a pool above Stari Grad — I’m swapping it in for the Hvar nights now.';
    for (const w of reply.split(/(\s+)/)) await emit({ type: 'concierge.delta', text: w }, 28);
    await emit({ type: 'concierge.done', text: reply });
    await emit({ type: 'speak', text: reply });
    await emit({ type: 'agent.activity', agent: 'Trip Architect', kind: 'working', text: S.opening }, 300);
    if (turn === 1 && !pre) await emit({ type: 'itinerary', version: 0, sketch: true, itinerary: mockSketch() }, 900);
    for (const a of S.team) await emit({ type: 'agent.spawned', agent: a, thread_id: 'sthr_mock_' + a.slice(0, 3).toLowerCase() }, 140);
    await emit({ type: 'swarm.status', status: 'running', message: 'Trip Architect is delegating' }, 120);
    for (const a of S.team) {
      await emit({ type: 'agent.activity', agent: a, kind: 'delegated', text: S.briefs[a] }, 110);
      await emit({ type: 'agent.activity', agent: a, kind: 'working', text: 'working…' }, 60);
    }
    await emit({ type: 'agent.activity', agent: 'Trip Architect', kind: 'working', text: "Waiting for the specialists' replies." }, 200);
    for (const [agent, kind, t, ms] of S.flow) await emit({ type: 'agent.activity', agent, kind, text: t }, ms);
    const it = mockItinerary(turn);
    await emit({ type: 'agent.activity', agent: 'Trip Architect', kind: 'tool', text: `present_itinerary v${turn}: ${it.title}` }, 600);
    await emit({ type: 'itinerary', version: turn, itinerary: it }, 120);
    await emit({ type: 'agent.activity', agent: 'Trip Architect', kind: 'tool', text: 'edit {"file_path": "/mnt/memory/experience-atlas-traveller-demo/preferences.md", "new_string": "- Travels with two kids…' }, 300);
    await emit({ type: 'speak', text: 'Version ' + turn + ' is ready. ' + it.next_question });
    await emit({ type: 'usage', cost_usd: turn === 1 ? 0.072 : 0.031 }, 100);
    await emit({ type: 'swarm.status', status: 'done', message: `Version ${turn} in ${((performance.now() - t0) / 1000).toFixed(1)}s` }, 150);
    await emit({ type: 'turn.done' });
  }
  function mockBooking() {
    const it = state.itinerary || MOCK_IT;
    const items = [];
    (it.flights || []).forEach((f) => items.push({ kind: 'flight', title: `${f.carrier} · ${f.from} → ${f.to}`, price_eur: f.price_eur }));
    const stays = new Map();
    (it.days || []).forEach((d) => { if (d.stay && d.stay.name) { const s = stays.get(d.stay.name) || { n: 0, p: d.stay.price_per_night_eur || 0 }; s.n++; stays.set(d.stay.name, s); } });
    stays.forEach((s, name) => items.push({ kind: 'stay', title: `${name} · ${s.n} night${s.n > 1 ? 's' : ''}`, price_eur: s.n * s.p }));
    (it.experiences || []).slice(0, 2).forEach((x) => items.push({ kind: 'experience', title: x.title, price_eur: x.price_eur }));
    return { confirmation: 'EA-7K2Q9', status: 'confirmed', items, total_eur: items.reduce((a, b) => a + (b.price_eur || 0), 0) };
  }

  /* ================= WIRE UP ================= */
  function wire() {
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const i = $('#input');
      const t = i.value; i.value = ''; i.placeholder = "Where to? Who's going? What do you want to do?";
      sendTurn(t);
    });
    document.querySelectorAll('#chips .chip').forEach((c) => c.addEventListener('click', () => sendTurn(c.textContent)));
    micBtn.addEventListener('click', toggleMic);
    $('#ttsBtn').addEventListener('click', () => {
      state.ttsOn = !state.ttsOn;
      $('#ttsBtn').classList.toggle('on', state.ttsOn);
      $('#ttsBtn').textContent = state.ttsOn ? '🔊' : '🔈';
      if (!state.ttsOn && V() && V().stopSpeaking) try { V().stopSpeaking(); } catch { /* ignore */ }
    });
    $('#newTripBtn').addEventListener('click', newTrip);
    $('#modalX').addEventListener('click', () => $('#modal').classList.add('hidden'));
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').classList.add('hidden'); });
  }

  async function boot() {
    buildSwarm();
    buildConsult();
    wire();
    initVoice();
    await loadPlaces();
    if (MOCK) {
      toast('Demo mode: replaying a recorded planning session', 'info');
      if (params.get('auto') === '1') setTimeout(() => sendTurn('Sailing in Europe with my two kids in late June, mid budget'), 600);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
