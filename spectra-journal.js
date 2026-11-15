/* SPECSOFT Spectra Journal (v2)
   "My Journal" row in the sparkle menu + a notebook popout with TABS, a real page-flip animation, and a free "Make me write" button.
   PC = two page spread, phone = one page (swipe or tap Prev/Next). She writes about every 10 minutes while this page is open
   (and catches up when you come back). Everything she writes is in first person.
   Needs spectra-journal.sql + the spectra-journal edge function + spectra-journal.css. Load AFTER spectra-bond.js. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const say = t => {
    try { if (typeof toast === 'function') return toast(t); } catch (e) { }
    const el = $('#saToast'); if (el) { el.textContent = t; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 2400); }
  };
  const FLIP_MS = 700;
  const SHOP = 'store.html#gifts';
  const MOOD = { joy: '😄', thinking: '🤔', sparkle: '✨', love: '🥰', annoyed: '😒', sad: '😢', surprised: '😮', confused: '😕', shy: '😳', deadpan: '😐', smug: '😏', pout: '😤', shocked: '😱', sleepy: '😴', grumpy: '😠', speechless: '😶' };
  const TABMETA = { daily: ['📖', 'My Daily Life & Routines', 'Daily Life'], stories: ['🍳', 'Stories I Cooked', 'Stories'], favs: ['⭐', 'My Favorites', 'Favorites'], dreams: ['🌙', 'Dreams & Wishlist', 'Dreams'], secrets: ['🗝️', 'Secrets', 'Secrets'] };
  const WHY = { cooldown: 'give me a sec bro 😤', force_cap: 'i\u2019m done writing for today 😭', full: 'my journal is full 😭 get me another one??', daily_cap: 'i\u2019m out of words for today 😭', tab_unavailable: 'this tab is full 😭 i need more pages', no_pages: 'i don\u2019t have a journal yet 😭' };

  const pMenu = $('#saPMenu');
  if (!pMenu) return;

  document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    '<symbol id="i-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5z"/><path d="M4 19a2 2 0 012-2h13M9 7h6"/></symbol></svg>');

  /* ---- data ---- */
  const sbc = () => window.getSupabaseClient && window.getSupabaseClient();
  async function rpc(name, args) {
    const c = sbc(); if (!c) throw new Error('nosb');
    const r = await c.rpc(name, args || {}); if (r.error) throw r.error; return r.data;
  }
  let J = null, view = false, tab = LS('sj.tab', 'daily'), cps = {}, busy = false, busyF = false, flipping = false;
  let lastErr = '';
  const HINT = { '404': 'the spectra-journal function is not deployed', '400': 'the wrong code is deployed as spectra-journal', '401': 'log in again', login: 'log in again', plan: 'run spectra-journal.sql', no_gemini_key: 'the Gemini key is missing', ai_empty: 'the AI gave nothing usable', save: 'saving failed, check the function logs', '500': 'server error, check the function logs', '502': 'the AI gave nothing usable', rate: 'too fast, wait a minute', 'Failed to fetch': 'the function cannot be reached (is it deployed?)' };
  let fails = 0, lastTry = 0, lastLoad = 0, lastToast = 0, forceUntil = 0, newIds = new Set(), hold = false;
  const wide = () => window.matchMedia('(min-width:900px)').matches;
  const reduced = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  const cfg = () => LS('sa.cfg', {}) || {};
  const nick = () => String(cfg().nick || ($('[data-user-name]') || {}).textContent || '').trim().slice(0, 20);
  const aboutName = () => (nick() ? '@' + nick() : 'You');
  const meta = k => k === 'about' ? ['💌', 'About ' + aboutName(), 'About ' + aboutName()] : (TABMETA[k] || ['📄', k, k]);

  const maxId = () => (J && J.entries.length ? J.entries.reduce((m, e) => Math.max(m, +e.id), 0) : 0);
  const unread = () => (J && J.ok ? J.entries.filter(e => +e.id > LS('sj.seen', 0)).length : 0);
  const tabInfo = k => (J && J.tabs ? J.tabs.find(t => t.key === k) : null);
  const tabEntries = k => J.entries.filter(e => (e.tab || 'daily') === k);
  const tabPages = k => Math.max(1, tabEntries(k).reduce((m, e) => Math.max(m, e.page), 1));
  const lastSpread = k => { const tp = tabPages(k); return wide() ? (tp % 2 === 0 ? tp - 1 : tp) : tp; };
  const normL = k => { const tp = tabPages(k); let L = cps[k] == null ? lastSpread(k) : cps[k]; L = Math.max(1, Math.min(L, tp)); if (wide() && L % 2 === 0) L--; return L; };
  const curKey = () => { if (J && J.tabs && !J.tabs.some(t => t.key === tab)) tab = 'daily'; return tab; };

  async function load() {
    const before = maxId(), key = J && J.ok ? curKey() : null;
    const atEnd = !!(key && view && J.tabs && tabInfo(key) && tabInfo(key).unlocked && normL(key) === lastSpread(key));
    try { const j = await rpc('spectra_journal_list'); J = j && j.ok ? j : null; }
    catch (e) { J = null; console.warn('Spectra journal unavailable:', (e && e.message) || e); }
    lastLoad = Date.now();
    if (J) {
      forceUntil = Date.now() + (J.force && J.force.wait_s ? J.force.wait_s * 1000 : 0);
      newIds = new Set(before ? J.entries.filter(e => +e.id > before).map(e => +e.id) : []);
      if (atEnd && key && !hold) cps[key] = lastSpread(key);   // follow new pages, except while Make me write turns the page itself
      const open = J.tabs.filter(t => t.unlocked).map(t => t.key), prev = LS('sj.open', null);    // a tab just unlocked?
      if (Array.isArray(prev)) { const nu = open.filter(k => !prev.includes(k)); if (nu.length) say('New journal tab unlocked: ' + meta(nu[0])[1] + ' 🔓'); }
      SS('sj.open', open);
    }
    tagMenu(); if (view) render();
  }

  /* ---- writing: every ~10 minutes, or on demand (free) ---- */
  function recent() {            // her latest chat lines, only if "recall" is on in Spectra settings
    try {
      if (cfg().recall === false) return [];
      const out = [];
      (LS('sa.chats', []) || []).slice(0, 2).forEach(c => (c.messages || []).forEach(m => { if (m.role === 'user' && m.content && !m.giftSent) out.push(String(m.content).slice(0, 140)); }));
      return out.slice(-8);
    } catch (e) { return []; }
  }
  function notes() {             // the notes she keeps about you, only if "Use memory" is on
    try { if (cfg().memOn === false) return []; return (LS('sa.mem', []) || []).filter(x => x && typeof x.t === 'string').slice(0, 8).map(x => x.t.slice(0, 120)); } catch (e) { return []; }
  }
  async function generate(o) {
    o = o || {};
    if (busy) return null; busy = true; lastTry = Date.now(); lastErr = '';
    let out = null;
    try {
      const c = sbc(); const s = c && (await c.auth.getSession()).data.session; if (!s) { busy = false; return null; }
      const conf = window.SPECSOFT_CONFIG || {};
      const r = await fetch(conf.SUPABASE_URL + '/functions/v1/spectra-journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: conf.SUPABASE_ANON_KEY },
        body: JSON.stringify({ tz: new Date().getTimezoneOffset(), nick: nick(), hour: new Date().getHours(), recent: recent(), notes: notes(), force: !!o.force, tab: o.tab || '' })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || r.status);
      fails = 0; out = j;
      await load();
      if (j.added > 0 && !o.force && !view && Date.now() - lastToast > 30 * 60000) { lastToast = Date.now(); say('I wrote in my journal 📓'); }
    } catch (e) { lastErr = String((e && e.message) || e); if (!o.force) fails++; console.warn('Spectra journal: could not write an entry', (e && e.message) || e); }
    busy = false; return out;
  }
  function tick() {
    if (document.hidden || busy || busyF) return;
    if (!J || !J.ok) { if (Date.now() - lastLoad > 120000) load(); return; }
    if (J.pages < 1 || J.full) { if (Date.now() - lastLoad > 60000) load(); return; }   // picks up a new Journals gift
    const due = !J.last_at || Date.now() - new Date(J.last_at).getTime() >= (J.interval_min || 10) * 60000;
    const wait = Math.min(fails, 5) * 120000;                                              // back off after errors
    if (due && Date.now() - lastTry > Math.max(45000, wait)) generate();
  }
  async function force() {
    if (busyF || busy || !J || !J.ok) return;
    const key = curKey(), ti = tabInfo(key); if (!ti || !ti.unlocked) return;
    const before = normL(key); busyF = true; hold = true; drawForce();
    const j = await generate({ force: true, tab: key });
    busyF = false; hold = false;
    if (!j) say('I couldn\u2019t write: ' + (HINT[lastErr] || lastErr || 'unknown error') + (HINT[lastErr] ? ' (' + lastErr + ')' : '') + ' 😭');
    else if (j.added < 1) { say(WHY[j.reason] || 'not now bro 😤'); if (j.wait_s) forceUntil = Date.now() + j.wait_s * 1000; }
    if (view && J) {
      const to = lastSpread(key);
      if (j && j.added > 0 && to !== before && !flipping && J.tabs && tabInfo(key) && tabInfo(key).unlocked) flipTo(key, before, to, to > before ? 1 : -1);
      else render();
    }
    drawForce();
  }

  /* ---- popout shell ---- */
  const ov = document.createElement('div');
  ov.className = 'sj-ov'; ov.id = 'sjOv';
  ov.innerHTML = '<div class="sj-card" role="dialog" aria-modal="true" aria-labelledby="sjT"><div class="sj-h"><b id="sjT">My Journal</b><div class="sj-hr"><button class="sj-force" id="sjForce" type="button" hidden></button><button class="sj-x" type="button" aria-label="Close">\u00d7</button></div></div><div id="sjBody" style="display:flex;flex-direction:column;flex:1;min-height:0"></div></div>';
  document.body.appendChild(ov);
  const body = $('#sjBody', ov), fb = $('#sjForce', ov);
  let clock = 0;
  const close = () => { ov.classList.remove('on'); view = false; clearInterval(clock); };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.sj-x')) close(); });
  document.addEventListener('keydown', e => {
    if (!view) return;
    if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') flip(-1); else if (e.key === 'ArrowRight') flip(1);
  });
  function open() {
    view = true; ov.classList.add('on');
    if (J && J.tabs) { const t = tabInfo(tab); if (!t || !t.unlocked) tab = 'daily'; }
    render(); clearInterval(clock); clock = setInterval(drawForce, 1000);
    load().then(() => { if (view) { render(); markSeen(); } });
  }
  function markSeen() { if (J && J.ok) { SS('sj.seen', maxId()); tagMenu(); } }

  function drawForce() {
    if (!view) return;
    const ti = J && J.ok && J.pages > 0 ? tabInfo(curKey()) : null;
    if (!ti) { fb.hidden = true; return; }
    fb.hidden = false;
    const short = window.innerWidth < 600, left = Math.ceil((forceUntil - Date.now()) / 1000), f = J.force || {};
    let label = '✍️ ' + (short ? 'Write' : 'Make me write'), off = false;
    if (busyF) { label = '<i></i><i></i><i></i>'; off = true; }
    else if (!ti.unlocked) { off = true; }
    else if (J.full) { label = 'Full'; off = true; }
    else if (f.reason === 'force_cap') { label = 'Done today'; off = true; }
    else if (left > 0) { label = '✍️ ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); off = true; }
    fb.classList.toggle('busy', busyF); fb.disabled = off;
    if (fb.dataset.l !== label) { fb.innerHTML = label; fb.dataset.l = label; }
    fb.title = 'Make me write an entry right now (free)';
  }

  /* ---- pages ---- */
  const fmt = at => { try { return new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  function pageHtml(key, n) {
    if (n > tabPages(key)) return '<section class="sj-page sj-paper" aria-hidden="true"></section>';
    const es = tabEntries(key).filter(e => e.page === n), used = es.reduce((a, e) => a + e.body.length, 0);
    return '<section class="sj-page" aria-label="Page ' + n + '"><div class="sj-pn"><span>PAGE ' + n + '</span><span>' + used + ' / ' + J.chars_per_page + '</span></div>' +
      (es.length ? es.map(e => '<article class="sj-e' + (newIds.has(+e.id) ? ' new' : '') + '"><time><span>' + (MOOD[e.mood] || '✍️') + '</span>' + esc(fmt(e.at)) + (e.forced ? '<em>forced</em>' : '') + '</time><p>' + esc(e.body) + '</p></article>').join('')
        : '<div class="sj-blank">nothing here yet... i\u2019ll start writing in this tab soon ✍️</div>') +
      '<div class="sj-pf">' + n + '</div></section>';
  }
  const bookInner = (key, L, two) => pageHtml(key, L) + (two ? pageHtml(key, L + 1) : '');

  function flip(d) {
    if (!view || flipping || !J || !J.ok || J.pages < 1) return;
    const key = curKey(), ti = tabInfo(key); if (!ti || !ti.unlocked) return;
    const tp = tabPages(key), L = normL(key), nl = L + d * (wide() ? 2 : 1);
    if (nl < 1 || nl > tp) return;
    flipTo(key, L, nl, d);
  }
  /* the book page turn: the turning page has a front (old page) and a back (new page) and swings around the spine in 3D */
  function flipTo(key, ol, nl, dir) {
    const book = $('#sjBook');
    if (!book || reduced() || flipping || key !== curKey()) { cps[key] = nl; render(); return; }
    const two = book.classList.contains('two'), orr = ol + 1, nr = nl + 1, P = n => pageHtml(key, n);
    const paper = '<section class="sj-page sj-paper"></section>';
    let base, front, back, cls, kf;
    if (two && dir > 0) { base = P(ol) + P(nr); front = P(orr); back = P(nl); cls = 'r'; kf = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }]; }
    else if (two) { base = P(nl) + P(orr); front = P(ol); back = P(nr); cls = 'l'; kf = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }]; }
    else if (dir > 0) { base = P(nl); front = P(ol); back = paper; cls = 's'; kf = [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }]; }
    else { base = P(ol); front = P(nl); back = paper; cls = 's'; kf = [{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }]; }
    flipping = true;
    book.style.setProperty('--sj-ms', FLIP_MS + 'ms');
    book.innerHTML = base;
    const f = document.createElement('div');
    f.className = 'sj-flip ' + cls;
    f.innerHTML = '<div class="sj-face front">' + front + '</div><div class="sj-face back">' + back + '</div>';
    book.appendChild(f);
    let fin = false;
    const done = () => { if (fin) return; fin = true; f.remove(); flipping = false; cps[key] = nl; render(); };
    try { f.animate(kf, { duration: FLIP_MS, easing: 'cubic-bezier(.5,.05,.25,1)', fill: 'forwards' }).finished.then(done, done); } catch (e) { done(); }
    setTimeout(done, FLIP_MS + 300);
  }

  function lockHtml(t) {
    const m = meta(t ? t.key : 'daily'), needP = t ? Math.max(0, t.pages_needed - J.pages) : 0, needB = t && t.bond_needed > J.bond_level;
    return '<div class="sj-lockbox"><div class="sj-empty"><span class="e">🔒</span><b>' + esc(m[1]) + ' is locked</b><p>' +
      (needP ? 'i need <b>' + t.pages_needed + ' pages</b> to open this tab and i only have ' + J.pages + ' right now. ' : '') +
      (needB ? 'we also need to be closer first (bond Lv ' + t.bond_needed + '). ' : '') +
      'every Journals gift you send me adds 5 pages 📓</p><a class="sj-cta" href="' + SHOP + '">Get a Journal</a>' +
      (window.SpectraBond ? '<button type="button" class="sj-cta ghost" data-inv="1">Open Gift Inventory</button>' : '') + '</div></div>';
  }
  function render() {
    if (!view || flipping) return;
    drawForce();
    if (!J) { body.innerHTML = '<div class="sj-empty"><span class="e">📓</span><b>My journal is not available</b><p>Log in and try again in a moment.</p></div>'; return; }
    if (J.pages < 1) {
      body.innerHTML = '<div class="sj-empty"><span class="e">📓</span><b>i don\u2019t have a journal yet 😭</b><p>Give me a Journals gift and i\u2019ll start writing about my life. Every Journals gift adds 5 pages (2500 characters each) and unlocks more tabs.</p>' +
        '<a class="sj-cta" href="' + SHOP + '">Get me a Journal</a>' + (window.SpectraBond ? '<button type="button" class="sj-cta ghost" data-inv="1">Open Gift Inventory</button>' : '') + '</div>';
      return;
    }
    const key = curKey(), ti = tabInfo(key), two = wide(), unlocked = !!(ti && ti.unlocked);
    const oldTabs = $('#sjTabs', body);
    let main = '', nav = '';
    if (!unlocked) main = lockHtml(ti);
    else {
      const tp = tabPages(key), L = normL(key), right = two && L + 1 <= tp;
      main = '<div class="sj-book' + (two ? ' two' : '') + '" id="sjBook">' + bookInner(key, L, two) + '</div>';
      nav = '<div class="sj-nav"><button type="button" data-f="-1"' + (L <= 1 ? ' disabled' : '') + '>‹ Prev</button><span>' +
        (right ? 'Pages ' + L + '–' + (L + 1) + ' of ' + tp : 'Page ' + L + ' of ' + tp) + '</span><button type="button" data-f="1"' + (L + (two ? 2 : 1) > tp ? ' disabled' : '') + '>Next ›</button></div>';
    }
    const left = Math.max(0, J.pages - J.used_pages);
    body.innerHTML =
      '<div class="sj-meter"><div><span>' + J.used_pages + ' / ' + J.pages + ' pages used</span><span>' + left + ' left</span></div><div class="sj-bar"><i style="width:' + Math.min(100, J.used_pages / J.pages * 100) + '%"></i></div></div>' +
      '<div class="sj-tabs" id="sjTabs" role="tablist">' + J.tabs.map(t => { const m = meta(t.key); return '<button type="button" role="tab" class="sj-tab' + (t.key === key ? ' on' : '') + (t.unlocked ? '' : ' lock') + '" data-tab="' + esc(t.key) + '">' + (t.unlocked ? m[0] : '🔒') + ' ' + esc(m[2]) + '</button>'; }).join('') + '</div>' +
      (J.full ? '<div class="sj-full"><b>my journal is FULL 😭</b> i have so many thoughts and nowhere to put them... can u get me another one?</div>' : '') +
      (!J.entries.length && !J.full ? '<div class="sj-full">My first entry is on the way. i write about every ' + (J.interval_min || 10) + ' minutes while you are here (or hit <b>Make me write</b>).</div>' : '') +
      main + nav + '<div class="sj-foot">Every Journals gift you send me adds 5 pages. <a href="' + SHOP + '">Get another</a></div>';
    const tabs = $('#sjTabs', body), on = $('.sj-tab.on', body);
    if (tabs && on) tabs.scrollLeft = on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2;
    newIds = new Set();
  }

  body.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (t) { if (flipping) return; tab = t.dataset.tab; SS('sj.tab', tab); return render(); }
    const f = e.target.closest('[data-f]'); if (f) return flip(+f.dataset.f);
    if (e.target.closest('[data-inv]') && window.SpectraBond) { close(); window.SpectraBond.open('inv'); }
  });
  fb.addEventListener('click', force);
  let tx = 0, ty = 0;                                     // swipe to turn the page (phones)
  body.addEventListener('touchstart', e => { const t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY; }, { passive: true });
  body.addEventListener('touchend', e => {
    if (!e.target.closest('#sjBook')) return;
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) flip(dx < 0 ? 1 : -1);
  }, { passive: true });
  window.matchMedia('(min-width:900px)').addEventListener('change', () => { if (view && !flipping) render(); });

  /* ---- sparkle menu row (the page rebuilds this menu on every open, so add it again after each draw) ---- */
  function tagMenu() {
    const em = $('[data-journal] em', pMenu); if (!em) return;
    const n = unread();
    em.textContent = !J || !J.ok ? '\u203a' : J.pages < 1 ? 'Get one' : n > 0 ? n + ' new' : J.full ? 'Full' : '\u203a';
  }
  function inject() {
    if (!pMenu.querySelector('[data-persona]') || pMenu.querySelector('[data-journal]')) return;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.journal = '1';
    b.innerHTML = '<i class="sa-fi"><svg><use href="#i-book"/></svg></i><span>My Journal</span><em>\u203a</em>';
    const bonds = pMenu.querySelectorAll('[data-bond]'), last = bonds[bonds.length - 1];
    if (last) last.after(b); else { const sep = pMenu.querySelector('.sa-sep'); if (sep) pMenu.insertBefore(b, sep); else pMenu.appendChild(b); }
    tagMenu();
  }
  new MutationObserver(inject).observe(pMenu, { childList: true });
  pMenu.addEventListener('click', e => { if (e.target.closest('[data-journal]')) open(); });
  inject();

  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (Date.now() - lastLoad > 30000) load(); setTimeout(tick, 1500); } });
  setInterval(tick, 30000);

  window.SpectraJournal = { open, refresh: load };
  load().then(() => setTimeout(tick, 2500));
})();
