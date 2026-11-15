/* SPECSOFT Spectra Bond
   Top pill + two rows in the sparkle menu (Gift Inventory, Bond Status) + their popouts.
   Needs spectra-bond.sql (run once in Supabase) and spectra-bond.css. Load AFTER spectra-ai.js.
   The chat edge function can push live changes with: data: {"bond": {...result of spectra_bond_apply...}} */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = t => {
    try { if (typeof toast === 'function') return toast(t); } catch (e) { }
    const el = $('#saToast'); if (el) { el.textContent = t; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 2200); }
  };

  /* extra icons for the sprite (the page's own sprite has no gift or heart) */
  document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    '<symbol id="i-gift" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7M7.5 8a2.5 2.5 0 010-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 010 5"/></symbol>' +
    '<symbol id="i-heart" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></symbol></svg>');
  const gic = (name, cls) => (window.SpectraGiftIcons ? window.SpectraGiftIcons.html(name, cls) : mic('gift'));   // gift icon picked by the gift name (no emoji)
  const mic = n => '<i class="sa-fi"><svg><use href="#i-' + n + '"/></svg></i>';

  /* ---- data ---- */
  const sbc = () => window.getSupabaseClient && window.getSupabaseClient();
  async function rpc(name, args) {
    const c = sbc(); if (!c) throw new Error('nosb');
    const r = await c.rpc(name, args || {}); if (r.error) throw r.error; return r.data;
  }
  let thanksFlag = false;
  let st = null, inv = [], view = '', gl = false, gerr = false, busyG = false, lastLoad = 0;
  const TIERS = [[1, 'Just met'], [10, 'Buddies'], [25, 'Besties'], [50, 'Partners in crime'], [75, 'Ride or die'], [100, 'Legendary bond']];
  const tier = l => { let t = TIERS[0][1]; TIERS.forEach(x => { if (l >= x[0]) t = x[1]; }); return t; };
  const pct = s => (s && s.xp_needed ? Math.max(0, Math.min(100, s.xp_into_level / s.xp_needed * 100)) : 100);

  /* ---- top pill ---- */
  const main = $('.sa-main'), pMenu = $('#saPMenu');
  const pill = document.createElement('button');
  pill.type = 'button'; pill.className = 'sb-pill'; pill.hidden = true; pill.setAttribute('aria-label', 'Bond status');
  pill.innerHTML = '<svg class="sb-ic"><use href="#i-heart"/></svg><span class="sb-lv">Lv 1</span><span class="sb-bar"><i></i></span>';
  if (main) main.appendChild(pill);
  pill.addEventListener('click', () => open('stat'));

  function tagMenu() { const em = pMenu && $('[data-bond="stat"] em', pMenu); if (em) em.textContent = st ? 'Lv ' + st.level : '\u203a'; }
  function drawPill() {
    if (!st) { pill.hidden = true; tagMenu(); return; }
    pill.hidden = false; $('.sb-lv', pill).textContent = 'Lv ' + st.level; $('.sb-bar i', pill).style.width = pct(st) + '%';
    pill.title = 'Bond Lv ' + st.level + ' · ' + tier(st.level); tagMenu();
  }
  function pulse() { pill.classList.remove('up'); void pill.offsetWidth; pill.classList.add('up'); }
  function float(d) {
    if (!d || !main) return; const f = document.createElement('div');
    f.className = 'sb-float' + (d < 0 ? ' neg' : ''); f.textContent = (d > 0 ? '+' : '\u2212') + Math.abs(d) + ' XP';
    main.appendChild(f); setTimeout(() => f.remove(), 1700);
  }
  function setStatus(j) {
    if (!j || j.level == null) return;
    st = { ...(st || {}), level: j.level, xp: j.xp, xp_into_level: j.xp_into_level, xp_needed: j.xp_needed, last_chat_at: j.last_chat_at !== undefined ? j.last_chat_at : (st && st.last_chat_at) };
    drawPill(); if (view === 'stat') render();
  }
  async function loadStatus() {
    try { const j = await rpc('spectra_bond_status'); st = j && j.ok ? j : null; }
    catch (e) { st = null; console.warn('Spectra bond unavailable:', (e && e.message) || e); }
    lastLoad = Date.now(); drawPill(); if (view === 'stat') render();
  }

  /* ---- popout shell ---- */
  const ov = document.createElement('div');
  ov.className = 'sb-ov'; ov.id = 'sbOv';
  ov.innerHTML = '<div class="sb-card" role="dialog" aria-modal="true" aria-labelledby="sbT"><div class="sb-h"><b id="sbT"></b><button class="sb-x" type="button" aria-label="Close">\u00d7</button></div><div class="sb-body" id="sbBody"></div></div>';
  document.body.appendChild(ov);
  const body = $('#sbBody', ov), title = $('#sbT', ov);
  const close = () => { ov.classList.remove('on'); view = ''; };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.sb-x')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && view) close(); });
  function open(v) {
    view = v; ov.classList.add('on'); render();
    if (v === 'stat') loadStatus(); else loadGifts();
  }
  const render = () => { if (view === 'stat') renderStat(); else if (view === 'inv') renderInv(); };

  /* ---- Bond Status ---- */
  function renderStat() {
    title.textContent = 'Bond Status';
    if (!st) { body.innerHTML = '<div class="sb-empty"><span class="e">' + mic('heart') + '</span><b>Bond is not available</b><p>Log in to build a bond with Spectra, then try again.</p></div>'; return; }
    const s = st, p = pct(s), C = 326.73, off = (C * (1 - p / 100)).toFixed(2);
    const d = s.last_chat_at ? Math.floor((Date.now() - new Date(s.last_chat_at).getTime()) / 864e5) : null;
    const ms = [10, 25, 50, 75, 100].find(x => x > s.level);
    const note = d === null ? '<div class="sb-note">Say hi to Spectra to start building your bond.</div>'
      : d >= 2 ? '<div class="sb-note warn">Spectra has not heard from you in ' + d + ' days, so your bond is starting to fade (-3 XP per day). Chat with her to stop it. It never drops below the start of Lv ' + s.level + '.</div>'
        : '<div class="sb-note">Your bond is safe. Chat within 2 days to keep it growing.</div>';
    body.innerHTML = '<div class="sb-ring"><svg viewBox="0 0 120 120"><circle class="sb-rt" cx="60" cy="60" r="52"/><circle class="sb-rp" cx="60" cy="60" r="52" stroke-dasharray="' + C + '" stroke-dashoffset="' + off + '" transform="rotate(-90 60 60)"/></svg><div><small>LEVEL</small><strong>' + s.level + '</strong></div></div>' +
      '<div class="sb-tier">' + esc(tier(s.level)) + '</div>' +
      (s.level < 100
        ? '<div class="sb-xp"><span>' + s.xp_into_level + ' / ' + s.xp_needed + ' XP</span><span>to Lv ' + (s.level + 1) + '</span></div><div class="sb-xbar"><i style="width:' + p + '%"></i></div>'
        : '<div class="sb-xp"><span>MAX LEVEL</span><span>' + s.xp + ' XP</span></div><div class="sb-xbar"><i style="width:100%"></i></div>') +
      (ms ? '<div class="sb-small" style="margin-top:8px">Next milestone: Lv ' + ms + ' (' + (ms - s.level) + ' to go)</div>' : '') +
      note +
      '<ul class="sb-rules"><li>Chatting with her (up to 40 a day)<b>+1 to +2 XP</b></li><li>Gifts (her favorite counts double)<b>+XP</b></li><li>Hostile messages (max 20 a day)<b class="neg">-5 XP</b></li></ul>' +
      '<div class="sb-small" style="margin-top:10px">Playful teasing is fine. Only real hostility lowers your bond.</div>' +
      '<button type="button" class="sb-cta" data-go="inv">Open Gift Inventory</button>';
  }

  /* ---- Gift Inventory (gifts are bought in the Store, where prices and stock live) ---- */
  const SHOP = 'store.html#gifts';
  async function loadGifts() {
    try { const i = await rpc('spectra_bond_gift_list'); inv = Array.isArray(i) ? i : []; gerr = false; }
    catch (e) { gerr = true; console.warn('Spectra gifts unavailable:', (e && e.message) || e); }
    gl = true; if (view === 'inv') render();
  }
  const rar = r => 'r-' + esc(r || 'common');
  function renderInv() {
    title.textContent = 'Gift Inventory';
    if (!gl) { body.innerHTML = '<div class="sb-empty"><p>Loading...</p></div>'; return; }
    if (gerr) { body.innerHTML = '<div class="sb-empty"><span class="e">' + gic('gift') + '</span><b>Gifts are not available</b><p>Log in and try again in a moment.</p></div>'; return; }
    body.innerHTML = inv.length
      ? '<div class="sb-grid">' + inv.map(g => '<div class="sb-gift ' + rar(g.rarity) + '"><span class="q">\u00d7' + g.qty + '</span><span class="e">' + gic(g.name) + '</span><span class="n">' + esc(g.name) + '</span><span class="m">+' + g.bond_xp + ' bond XP</span>' + (g.favorite ? '<span class="fav">\u2605 Her favorite \u00b7 2x XP</span>' : '') + '<button type="button" data-send="' + esc(g.id) + '">Send to Spectra</button></div>').join('') + '</div><a class="sb-cta ghost" href="' + SHOP + '">Buy more in the Store</a>'
      : '<div class="sb-empty"><span class="e">' + gic('gift') + '</span><b>No gifts yet</b><p>Buy gifts with APEX Credits in the Store, then send them to Spectra to grow your bond.</p><a class="sb-cta" href="' + SHOP + '">Go to Shop</a></div>';
  }

  async function send(id, b) {
    if (busyG) return; busyG = true; b.disabled = true; b.textContent = 'Sending...';
    try {
      const j = await rpc('spectra_bond_gift_send', { p_gift: id });
      if (!j || !j.ok) say(j && j.error === 'empty' ? 'You do not have that gift anymore' : j && j.error === 'login' ? 'Log in to send gifts' : 'Could not send the gift');
      else {
        setStatus(j);
        say('Sent ' + j.name + ' \u00b7 +' + j.gain + ' bond XP' + (j.favorite ? ' (her favorite!)' : '') + (j.leveled_up ? ' \u00b7 Bond Lv ' + j.level + '!' : ''));
        if (j.leveled_up) pulse();
        float(j.gain); close(); react(j);
      }
    } catch (e) { say('Could not send the gift. Try again'); }
    busyG = false; loadGifts();
  }
  /* Spectra reacts through the normal chat flow, so she answers in her own voice */
  function react(j) {
    const text = '*sends you a gift:* ' + j.name;                    // what Spectra reads; the chat shows an icon chip instead
    const go = n => {
      const C = window.SpectraChat;      // exposed by spectra-ai.js (the page code is wrapped, so we cannot call sendMsg directly)
      if (!C || typeof C.send !== 'function') { console.warn('Spectra bond: window.SpectraChat is missing, upload the newest spectra-ai.js'); say('Gift sent! Refresh the page so Spectra can thank you next time'); return; }
      try {
        if (C.busy() && n < 40) return setTimeout(() => go(n + 1), 500);   // wait for a running answer to finish
        thanksFlag = true; C.send(text, { name: j.name });
        setTimeout(() => { thanksFlag = false; }, 3000);                    // only this one message is the real gift
      } catch (e) { console.warn('Spectra bond: could not send the gift message', e); }
    };
    go(0);
  }

  body.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.go === 'inv') return open('inv');
    if (b.dataset.send) return send(b.dataset.send, b);
  });

  /* ---- two new rows in the sparkle menu (the page rebuilds the menu on every open, so re-add after each draw) ---- */
  function inject() {
    if (!pMenu || !pMenu.querySelector('[data-persona]') || pMenu.querySelector('[data-bond]')) return;
    const sep = pMenu.querySelector('.sa-sep'); if (!sep) return;
    const mk = (k, ic, label, tag) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.bond = k; b.innerHTML = mic(ic) + '<span>' + label + '</span><em>' + tag + '</em>'; return b; };
    const s2 = document.createElement('div'); s2.className = 'sa-sep';
    pMenu.insertBefore(s2, sep);
    pMenu.insertBefore(mk('inv', 'gift', 'Gift Inventory', '\u203a'), sep);
    pMenu.insertBefore(mk('stat', 'heart', 'Bond Status', st ? 'Lv ' + st.level : '\u203a'), sep);
  }
  if (pMenu) {
    new MutationObserver(inject).observe(pMenu, { childList: true });
    pMenu.addEventListener('click', e => { const b = e.target.closest('[data-bond]'); if (b) open(b.dataset.bond); });
    inject();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 6e4) loadStatus(); });

  /* hooks for the chat page */
  window.SpectraBond = {
    refresh: loadStatus, open,
    takeThanks() { const v = thanksFlag; thanksFlag = false; return v; },
    onMeta(j) { if (!j) return; setStatus(j); if (j.delta) float(j.delta); if (j.leveled_up) { pulse(); say('Bond level up! Lv ' + j.level); } }
  };
  loadStatus();
})();
