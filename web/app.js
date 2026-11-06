/* Experience Atlas — frontend (no build step). Contract: docs/demo-contract.md */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const params = new URLSearchParams(location.search);
  const MOCK = params.get('mock') === '1';

  const AGENTS = [
    { key: 'Trip Architect', glyph: '🧭', model: 'Sonnet 5.5', color: '#C89B50' },
    { key: 'Explorer', glyph: '🗺️', model: 'Haiku 5.5', color: '#7FB3E6' },
    { key: 'Flights', glyph: '✈️', model: 'Haiku 5.5', color: '#9FD8F5' },
    { key: 'Stays', glyph: '🏡', model: 'Haiku 5.5', color: '#D68C4C' },
    { key: 'Experiences', glyph: '⛵', model: 'Haiku 5.5', color: '#5FD0B5' },
    { key: 'Local Insider', glyph: '🔑', model: 'Haiku 5.5', color: '#F6E6C0' },
  ];
  const COORD = AGENTS[0].key;

  const state = {
    conversationId: null, busy: false, queue: [], version: 0, itinerary: null, sketch: false,
    places: new Map(), media: new Map(), fixture: null,
    t0: null, timer: null, ttsOn: false, mockTurn: 0, voiceInited: false,
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
    beginTurnSwarm();
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
      if (state.t0 && !$('#swarm').classList.contains('done')) stopTimer();
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
      case 'itinerary': renderItinerary(ev.itinerary, ev.version, ev.prebuilt === true ? 'prebuilt' : ev.sketch === true ? 'sketch' : null); break;
      case 'usage':
        if (typeof ev.cost_usd === 'number') { const c = $('#costChip'); c.textContent = '$' + ev.cost_usd.toFixed(3); c.classList.remove('hidden'); }
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
        <div class="orb-name">${esc(a.key)}</div><div class="orb-model">${esc(a.model)}</div>`;
      orbsEl.appendChild(el);
      const rec = { a, el, x: 0, y: 0, lit: false, base: null, beam: null, flow: null, timer: null, bubbleTimer: null };
      if (i > 0) {
        rec.base = document.createElementNS(SVGNS, 'line'); rec.base.setAttribute('class', 'beam-base');
        rec.beam = document.createElementNS(SVGNS, 'line'); rec.beam.setAttribute('class', 'beam'); rec.beam.setAttribute('stroke', a.color); rec.beam.style.color = a.color;
        rec.flow = document.createElementNS(SVGNS, 'line'); rec.flow.setAttribute('class', 'beam-flow'); rec.flow.setAttribute('stroke', '#FFF6DE');
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
  function addTick(agent, kind, text) {
    const key = agentKey(agent);
    const a = AGENTS.find((x) => x.key === key);
    const el = document.createElement('div');
    el.className = 'tick';
    el.innerHTML = `<span class="tick-agent" style="color:${a.color}">${esc(a.glyph)} ${esc(key)}</span>${kind ? `<span class="tick-kind ${esc(kind)}">${esc(kind)}</span>` : ''}<span class="tick-text"></span>`;
    el.querySelector('.tick-text').textContent = text || '';
    const tk = $('#ticker');
    tk.prepend(el);
    while (tk.children.length > 24) tk.lastChild.remove();
  }
  function startTimer() {
    if (state.timer) return;
    state.t0 = performance.now();
    const out = $('#swarmElapsed');
    state.timer = setInterval(() => { out.textContent = ((performance.now() - state.t0) / 1000).toFixed(1); }, 100);
  }
  function stopTimer() {
    clearInterval(state.timer); state.timer = null;
    if (state.t0) $('#swarmElapsed').textContent = ((performance.now() - state.t0) / 1000).toFixed(1);
  }
  function setPill(cls, label) { const p = $('#swarmPill'); p.className = 'pill ' + cls; p.textContent = label; }
  function beginTurnSwarm() {
    const sw = $('#swarm');
    sw.classList.remove('done');
    orbMap.forEach((rec) => { rec.el.classList.remove('replied'); if (rec.el.classList.contains('lit') && rec.beam) { rec.el.classList.remove('lit'); rec.el.classList.add('standby'); rec.beam.classList.remove('lit'); rec.flow.classList.remove('lit'); } });
    if ($('#ticker').children.length) { const s = document.createElement('div'); s.className = 'tick sep'; s.textContent = '· new turn ·'; $('#ticker').prepend(s); }
    clearInterval(state.timer); state.timer = null; state.t0 = null;
    $('#swarmElapsed').textContent = '0.0';
    $('#swarmMsg').textContent = 'Atlas is listening…';
    setPill('starting', 'Thinking');
  }
  function swarmStatus(ev) {
    const sw = $('#swarm');
    const coord = orbMap.get(COORD).el;
    const msg = ev.message || '';
    if (msg) $('#swarmMsg').textContent = msg;
    switch (ev.status) {
      case 'starting':
        startTimer(); sw.classList.add('running'); lightOrb(COORD); coord.classList.add('running');
        setPill('starting', 'Starting');
        if (!msg) $('#swarmMsg').textContent = 'Trip Architect is briefing the specialists…';
        break;
      case 'running':
        startTimer(); sw.classList.add('running'); lightOrb(COORD); coord.classList.add('running');
        setPill(msg === 'replay' ? 'replay' : 'running', msg === 'replay' ? 'Replay' : 'Running');
        if (!msg) $('#swarmMsg').textContent = 'Specialists working in parallel…';
        break;
      case 'done': {
        stopTimer(); sw.classList.remove('running'); sw.classList.add('done'); coord.classList.remove('running');
        setPill(msg === 'replay' ? 'replay' : 'done', msg === 'replay' ? 'Replay' : 'Done');
        const secs = $('#swarmElapsed').textContent;
        $('#swarmMsg').textContent = (msg && msg !== 'replay' ? msg + ' · ' : '') + `composed in ${secs}s by ${countLit()} agents`;
        break;
      }
      case 'error':
        stopTimer(); sw.classList.remove('running'); coord.classList.remove('running');
        setPill('error', 'Error');
        break;
      default: break;
    }
  }
  const countLit = () => [...orbMap.values()].filter((r) => r.el.classList.contains('lit') || r.el.classList.contains('standby')).length;
  function agentSpawned(agent) {
    const key = agentKey(agent);
    if (!state.timer) { startTimer(); $('#swarm').classList.add('running'); lightOrb(COORD); orbMap.get(COORD).el.classList.add('running'); setPill('running', 'Running'); }
    lightOrb(key);
    burst(key, 6, true);
    addTick(key, 'spawned', 'joined the swarm');
  }
  function agentActivity(ev) {
    const key = agentKey(ev.agent);
    const kind = ev.kind || '';
    pulseOrb(key, ev.text);
    if (key === COORD) {
      if (ev.text) $('#swarmMsg').textContent = ev.text;
      if (kind === 'delegated') AGENTS.slice(1).forEach((a) => burst(a.key, 4, true));
    } else {
      burst(key, kind === 'replied' ? 10 : 4, kind === 'delegated');
      if (kind === 'replied') orbMap.get(key).el.classList.add('replied');
    }
    addTick(key, kind, ev.text);
  }

  /* ================= ITINERARY ================= */
  const SLOT = [['morning', '☀️', 'Morning'], ['afternoon', '🌤️', 'Afternoon'], ['evening', '🌙', 'Evening']];
  const MODE = { flight: '✈️', ferry: '⛴️', train: '🚆', boat: '⛵', car: '🚗', walk: '🚶' };
  const BUDGET = { budget: 'Budget', balanced: 'Balanced', comfort: 'Comfort', luxury: 'Luxury' };

  // v0 is a draft: a prebuilt plan for a quick-start chip (instant) or a Haiku sketch for free text.
  // v1+ come from the swarm. A draft never replaces a swarm version.
  const DRAFT = {
    prebuilt: { label: 'instant plan', note: 'the swarm is tailoring it to you…', chat: 'Instant plan v0 is on screen — the swarm is tailoring it to you' },
    sketch: { label: 'sketch by Atlas', note: 'the swarm is pricing &amp; refining…', chat: 'Sketch v0 is ready — the swarm is pricing & refining it' },
  };
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
    const verLabel = sketch ? `v${v} · ${draft.label}` : `v${v} · priced by 6 agents`;

    // Summary
    const sb = $('#summaryBody');
    sb.classList.toggle('is-v0', sketch);
    sb.innerHTML = `
      <div class="sum-top">
        <div class="version version-badge ${isNew ? 'flip' : ''} ${sketch ? 'is-v0' : ''}"><div class="version-inner">v${esc(v)}</div></div>
        <div>
          <span class="ver-label ${sketch ? 'is-v0' : ''}">${esc(verLabel)}</span>
          ${prevVersion !== null && isNew && !sketch ? '<span class="sum-new">NEW VERSION</span>' : ''}
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
      ${nextQ ? `<div class="next-q" id="nextQ"><div class="eyebrow">Atlas asks</div><div class="next-q-text">${esc(nextQ)}</div></div>` : ''}
      <div class="sum-bottom">
        <div><div class="total-label">${sketch ? 'First estimate' : 'Estimated total'}</div><div class="total">${esc(fmtEur(it.total_estimate_eur) || '—')}</div></div>
        <button class="book-btn" id="bookBtn" type="button">Book everything →</button>
      </div>`;
    sb.classList.remove('reveal'); void sb.offsetWidth; sb.classList.add('reveal');
    $('#bookBtn').addEventListener('click', book);
    const nq = $('#nextQ');
    if (nq) nq.addEventListener('click', () => { const i = $('#input'); i.focus(); i.placeholder = 'Answer: ' + nextQ; });

    if (isNew) {
      addMsg('system', sketch
        ? `✦ ${draft.chat}`
        : `✦ Itinerary v${v} is ready${prevVersion !== null ? ' — refined from v' + prevVersion : ''}`);
    }
    if (nextQ && isNew) addMsg('assistant', nextQ, 'question');

    renderDays(it.days || []);
    renderFlights(it.flights || []);
    renderExperiences(it.experiences || []);
    renderInsider(it.insider_tips || []);
    setTimeout(() => renderMap(it), firstTime ? 120 : 0);
  }

  // The turn ended with only the sketch on screen (swarm failed): stop promising a refinement.
  function endSketch() {
    if (!state.sketch) return;
    $('#stage').classList.remove('sketching');
    const n = $('#v0Shimmer');
    if (n) { n.classList.add('ended'); n.querySelector('.v0-shimmer-text').textContent = 'the swarm could not refine it this time'; }
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
          ${s && s.name ? `<div class="day-line"><span>🛏️</span><span><b>${esc(s.name)}</b>${s.type ? ' · ' + esc(s.type) : ''}${s.why ? `<br><span style="opacity:.75">${esc(s.why)}</span>` : ''}</span>${s.price_per_night_eur ? `<span class="price">${esc(fmtEur(s.price_per_night_eur))}/night</span>` : ''}</div>` : ''}
          ${t && (t.from || t.to) ? `<div class="day-line"><span>${MODE[t.mode] || '➜'}</span><span><b>${esc(t.from)} → ${esc(t.to)}</b>${t.carrier ? ' · ' + esc(t.carrier) : ''}${t.depart ? `<br><span style="opacity:.75">${esc(t.depart)}${t.arrive ? ' → ' + esc(t.arrive) : ''}</span>` : ''}</span>${t.price_eur ? `<span class="price">${esc(fmtEur(t.price_eur))}</span>` : ''}</div>` : ''}
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
    if (!flights.length) { el.innerHTML = '<div class="empty-note">Flights land here once the Flights agent replies.</div>'; return; }
    const code = (s) => { const m = String(s || '').match(/\b[A-Z]{3}\b/); return m ? m[0] : String(s || '').slice(0, 14); };
    el.innerHTML = flights.map((f) => `
      <div class="pass">
        <div><div class="code">${esc(code(f.from))}</div><div class="time">${esc(f.depart || '')}</div></div>
        <div class="arrow"><i>✈</i>${esc(f.duration || '')}<br>${esc(f.carrier || '')}</div>
        <div class="right"><div class="code">${esc(code(f.to))}</div><div class="time">${esc(f.arrive || '')}</div></div>
        <div class="fare"><b>${esc(fmtEur(f.price_eur))}</b><span>${esc(f.from || '')}</span></div>
      </div>`).join('');
  }
  function renderExperiences(exps) {
    const el = $('#experiences');
    if (!exps.length) { el.innerHTML = '<div class="empty-note">Experiences are on their way.</div>'; return; }
    const ico = (t) => (/sail|boat|cruise/i.test(t) ? '⛵' : /div|snork|swim/i.test(t) ? '🤿' : /para|fly/i.test(t) ? '🪂' : /food|taste|wine|lobster|dinner/i.test(t) ? '🍷' : /walk|hike|trail/i.test(t) ? '🥾' : '✨');
    el.innerHTML = exps.map((x) => `
      <div class="exp"><div class="exp-ico">${ico(x.title || '')}</div>
        <div><div class="exp-title">${esc(x.title)}</div>${x.why ? `<div class="exp-why">${esc(x.why)}</div>` : ''}</div>
        <div class="exp-price">${esc(fmtEur(x.price_eur))}</div></div>`).join('');
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
    const colors = ['#C89B50', '#D68C4C', '#F6E6C0', '#C4D6E8', '#5FD0B5', '#FFFFFF'];
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
    $('#ticker').innerHTML = '';
    orbMap.forEach((rec) => { rec.el.className = 'orb' + (rec.a.key === COORD ? ' coord' : ''); if (rec.beam) { rec.beam.classList.remove('lit'); rec.flow.classList.remove('lit'); } });
    clearInterval(state.timer); state.timer = null; state.t0 = null;
    $('#swarm').classList.remove('running', 'done');
    $('#swarmElapsed').textContent = '0.0'; $('#swarmMsg').textContent = 'Waiting for your first wish…'; setPill('idle', 'Idle');
    $('#costChip').classList.add('hidden');
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
  async function mockTurn(text) {
    state.mockTurn += 1;
    const turn = state.mockTurn;
    await emit({ type: 'conversation', conversation_id: 'mock-conv-1' }, 120);
    const pre = turn === 1 ? await mockPrebuilt(text) : null;
    if (pre) await emit({ type: 'itinerary', version: 0, prebuilt: true, itinerary: pre });
    await emit({ type: 'swarm.status', status: 'starting', message: 'Trip Architect is briefing the specialists' }, 150);
    const reply = turn === 1
      ? 'Sailing with the kids at the end of June — lovely. I’m sketching a week around Split, Hvar and Vis with short hops and calm mornings.'
      : 'There’s a villa with a pool above Stari Grad — I’m swapping it in for the Hvar nights now.';
    for (const w of reply.split(/(\s+)/)) await emit({ type: 'concierge.delta', text: w }, 28);
    await emit({ type: 'concierge.done', text: reply });
    await emit({ type: 'speak', text: reply });
    await emit({ type: 'agent.activity', agent: 'Trip Architect', kind: 'delegated', text: turn === 1 ? 'Briefing 5 specialists in parallel' : 'Re-briefing Stays and Experiences' }, 300);
    if (turn === 1 && !pre) await emit({ type: 'itinerary', version: 0, sketch: true, itinerary: mockSketch() }, 900);
    const all = ['Explorer', 'Flights', 'Stays', 'Experiences', 'Local Insider'];
    const team = turn === 1 ? all : ['Stays', 'Experiences', 'Local Insider'];
    for (const a of team) await emit({ type: 'agent.spawned', agent: a, thread_id: 'th_' + a.slice(0, 3) }, 220);
    await emit({ type: 'swarm.status', status: 'running', message: `${team.length} specialists working in parallel` }, 200);
    const acts = turn === 1 ? [
      ['Explorer', 'working', 'Late June in Dalmatia: 27 °C, sea 24 °C, calm mornings'],
      ['Flights', 'tool', 'Searching MUC → SPU, 27 Jun, 1 adult + 2 children'],
      ['Stays', 'working', 'Family rooms with 1 double + 2 singles in Hvar town'],
      ['Experiences', 'working', 'Comparing skippered day sails: Kornati vs Pakleni'],
      ['Local Insider', 'working', "Reading a Komiža fishermen's blog for a quiet cove"],
      ['Flights', 'replied', 'OU 4415 MUC 08:05 → SPU 09:40, €189 per seat'],
      ['Stays', 'replied', 'Apartment Dalmatina, Hvar — family suite, €145/night'],
      ['Experiences', 'replied', 'Blue Cave + Stiniva by speedboat at 8 am, before crowds'],
      ['Explorer', 'replied', 'Route Split → Hvar → Vis → Split, every hop under 1h30'],
      ['Local Insider', 'replied', 'Konoba Jastožera in Komiža — lobster in the old boathouse'],
      ['Trip Architect', 'working', 'Composing v1 around the 09:40 landing (light day 1)'],
    ] : [
      ['Stays', 'tool', 'Pool villas within 10 min of Stari Grad, 29 Jun – 1 Jul'],
      ['Experiences', 'working', 'Moving the sunset sail to day 4'],
      ['Local Insider', 'working', 'Checking quiet konobas near the villa'],
      ['Stays', 'replied', 'Villa Lavanda: private pool, +€60/night'],
      ['Experiences', 'replied', 'Gajeta sunset sail from Stari Grad, day 4'],
      ['Local Insider', 'replied', 'Konoba Kokot — lamb peka, order a day ahead'],
      ['Trip Architect', 'working', 'Composing v2'],
    ];
    for (const [agent, kind, t] of acts) await emit({ type: 'agent.activity', agent, kind, text: t }, 520 + Math.random() * 380);
    await emit({ type: 'itinerary', version: turn, itinerary: mockItinerary(turn) }, 700);
    await emit({ type: 'speak', text: 'Version ' + turn + ' is ready. ' + mockItinerary(turn).next_question });
    await emit({ type: 'usage', cost_usd: turn === 1 ? 0.072 : 0.031 }, 100);
    await emit({ type: 'swarm.status', status: 'done', message: `v${turn} ready` }, 150);
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
    wire();
    initVoice();
    await loadPlaces();
    if (MOCK) {
      toast('Mock mode: replaying a canned swarm turn', 'info');
      if (params.get('auto') === '1') setTimeout(() => sendTurn('Sailing in Europe with my two kids in late June, mid budget'), 600);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
