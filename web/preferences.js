/* Experience Atlas — "My preferences" card.
   Self-contained: mounts into #swarm (below the orbs) whenever that element exists, before or after
   app.js loads. Talks to GET/POST /api/preferences and DELETE /api/preferences/{id}. */
(() => {
  'use strict';
  if (window.AtlasPreferences) return;

  const API = '/api/preferences';
  const POLL_MS = 4000;
  const MAX_WORDS = 4;
  const MAX_CHARS = 40;

  const ui = {};
  const chips = new Map(); // id -> <li>
  const state = { sig: null, seq: 0, inFlight: false, mounted: false };

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const sigOf = (items) => JSON.stringify(items.map((i) => [i.id, i.text, i.source]));

  function build() {
    const card = h('section', 'prefs-card is-empty');
    card.id = 'prefsCard';
    card.setAttribute('aria-labelledby', 'prefsTitle');

    const head = h('div', 'prefs-head');
    const title = h('h3', 'prefs-title');
    title.id = 'prefsTitle';
    const heart = h('span', 'prefs-heart', '♡');
    heart.setAttribute('aria-hidden', 'true');
    title.append(heart, document.createTextNode('My preferences'));
    head.append(title, h('span', 'prefs-sub', 'saved for you'));

    const empty = h('p', 'prefs-empty', 'Atlas notes what matters to you as you chat. You decide what stays.');

    const list = h('ul', 'prefs-chips');
    list.setAttribute('aria-label', 'Your saved preferences');

    const addSlot = h('li', 'prefs-add-slot');
    const addBtn = h('button', 'prefs-add', '+ add a preference');
    addBtn.type = 'button';
    addBtn.setAttribute('aria-expanded', 'false');
    const form = h('form', 'prefs-form');
    form.hidden = true;
    form.noValidate = true;
    const input = h('input', 'prefs-input');
    Object.assign(input, { type: 'text', maxLength: MAX_CHARS, placeholder: 'e.g. no early flights', autocomplete: 'off' });
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('aria-label', 'New preference, up to 4 words');
    form.append(input);
    addSlot.append(addBtn, form);
    list.append(addSlot);

    const hint = h('p', 'prefs-hint');
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');

    card.append(head, empty, list, hint);
    Object.assign(ui, { card, list, addSlot, addBtn, form, input, hint });

    addBtn.addEventListener('click', openForm);
    form.addEventListener('submit', (e) => { e.preventDefault(); addChip(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeForm(true); } });
    input.addEventListener('input', () => setHint(''));
    input.addEventListener('blur', () => { setTimeout(() => { if (!input.value.trim() && !input.disabled && document.activeElement !== input) closeForm(false); }, 120); });
    list.addEventListener('click', (e) => {
      const x = e.target.closest('.prefs-x');
      if (x) removeChip(x.closest('.prefs-chip').dataset.id);
    });
  }

  function mount() {
    const host = document.getElementById('swarm');
    if (!host) return false;
    if (!ui.card) build();
    if (ui.card.parentNode !== host) host.appendChild(ui.card);
    state.mounted = true;
    return true;
  }

  // ---------------------------------------------------------------- rendering (diff only)
  function chipEl(it) {
    const li = h('li', 'prefs-chip');
    li.dataset.id = it.id;
    const text = h('span', 'prefs-chip-text', it.text);
    const x = h('button', 'prefs-x', '×');
    x.type = 'button';
    li.append(text, x);
    setChip(li, it);
    return li;
  }

  function setChip(li, it) {
    li.dataset.source = it.source;
    li.title = it.source === 'user' ? 'Added by you' : 'Learned by Atlas';
    const t = li.querySelector('.prefs-chip-text');
    if (t.textContent !== it.text) t.textContent = it.text;
    li.querySelector('.prefs-x').setAttribute('aria-label', `Remove preference ${it.text}`);
  }

  function leave(li) {
    li.classList.remove('is-new');
    li.classList.add('is-leaving');
    li.setAttribute('aria-hidden', 'true');
    li.querySelector('.prefs-x').tabIndex = -1;
    setTimeout(() => li.remove(), 260);
  }

  function render(items) {
    const sig = sigOf(items);
    if (sig === state.sig) return;
    const first = state.sig === null;
    state.sig = sig;
    const want = new Set(items.map((i) => i.id));
    for (const [id, li] of chips) if (!want.has(id)) { leave(li); chips.delete(id); }
    let prev = null;
    for (const it of items) {
      let li = chips.get(it.id);
      if (!li) {
        li = chipEl(it);
        chips.set(it.id, li);
        if (!first) {
          li.classList.add('is-new');
          li.addEventListener('animationend', () => li.classList.remove('is-new'), { once: true });
        }
      } else {
        setChip(li, it);
      }
      const ref = prev ? prev.nextSibling : ui.list.firstChild; // chips always stay before the add slot
      if (ref !== li) ui.list.insertBefore(li, ref);
      prev = li;
    }
    ui.card.classList.toggle('is-empty', items.length === 0);
  }

  // ---------------------------------------------------------------- network
  async function refresh() {
    if (state.inFlight || !state.mounted) return;
    state.inFlight = true;
    const seq = state.seq;
    try {
      const r = await fetch(API, { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (seq === state.seq && Array.isArray(d.items)) render(d.items); // a newer add/remove wins
    } catch (_) { /* offline: keep what is on screen */ } finally {
      state.inFlight = false;
    }
  }

  async function removeChip(id) {
    const li = chips.get(id);
    if (!li || li.classList.contains('is-leaving')) return;
    const text = li.querySelector('.prefs-chip-text').textContent;
    const next = li.nextElementSibling;
    const my = ++state.seq;
    // optimistic: the chip leaves at once; focus moves to the next control
    const items = [...chips.entries()].filter(([k]) => k !== id).map(([k, el]) => ({ id: k, text: el.querySelector('.prefs-chip-text').textContent, source: el.dataset.source }));
    render(items);
    (next && next.querySelector('.prefs-x, .prefs-add') || ui.addBtn).focus({ preventScroll: true });
    setHint(`Removed “${text}”. Atlas won’t assume it again.`);
    try {
      const r = await fetch(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (my === state.seq && Array.isArray(d.items)) render(d.items);
      else if (!r.ok) { setHint('Could not remove that one. Try again.'); refresh(); }
    } catch (_) {
      setHint('Offline. The preference was not removed.');
      refresh();
    }
  }

  async function addChip(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) { closeForm(true); return; }
    if (text.split(' ').length > MAX_WORDS) { setHint('Keep it to 4 words or fewer.'); return; }
    const my = ++state.seq;
    ui.input.disabled = true;
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setHint(typeof d.detail === 'string' ? d.detail : 'Could not save that one.'); return; }
      ui.input.value = '';
      setHint('');
      if (my === state.seq && Array.isArray(d.items)) render(d.items);
      closeForm(true);
    } catch (_) {
      setHint('Offline. Try again in a moment.');
    } finally {
      ui.input.disabled = false;
      if (!ui.form.hidden) ui.input.focus();
    }
  }

  // ---------------------------------------------------------------- add form
  function openForm() {
    ui.addBtn.hidden = true;
    ui.addBtn.setAttribute('aria-expanded', 'true');
    ui.form.hidden = false;
    ui.input.focus();
  }

  function closeForm(restoreFocus) {
    ui.form.hidden = true;
    ui.input.value = '';
    ui.addBtn.hidden = false;
    ui.addBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) ui.addBtn.focus({ preventScroll: true });
  }

  function setHint(msg) { ui.hint.textContent = msg; }

  // ---------------------------------------------------------------- boot
  function tick() {
    if (document.hidden) return;
    if (!ui.card || !ui.card.isConnected) mount();
    refresh();
  }

  function start() {
    if (mount()) refresh();
    else {
      const mo = new MutationObserver(() => { if (mount()) { mo.disconnect(); refresh(); } });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
    setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  }

  window.AtlasPreferences = { refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
