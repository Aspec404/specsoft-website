/* SPECSOFT Spectra Headpat
   "Headpat" row in the sparkle menu + a little scene: hold and stroke over her head (or tap the Pat button) and she reacts.
   Reactions are instant canned lines (no AI credits). Pats are counted by the database (spectra-headpat.sql):
   +1 bond XP per 10 pats, max 5 bond XP a day. Everything is friendly and PG.
   Needs spectra-headpat.sql + spectra-headpat.css. Load AFTER spectra-bond.js. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const pMenu = $('#saPMenu'); if (!pMenu) return;
  const REDUCED = () => window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  const exprOn = () => (LS('sa.cfg', {}) || {}).expr !== false;     // "Live expressions" setting

  /* her face images (same files the chat page uses) */
  const N = { joy: 1, thinking: 2, sparkle: 3, love: 4, annoyed: 5, sad: 6, surprised: 7, confused: 8, shy: 9, deadpan: 10, smug: 11, pout: 12, shocked: 13, sleepy: 14, grumpy: 15, speechless: 16 };
  const PFP = 'assets/spectra/spectra-pfp.jpg';
  const faceSrc = m => 'assets/spectra/expressions/spectra-exp-' + String(N[m]).padStart(2, '0') + '-' + m + '.png';

  /* her reactions: [mood, line] by how many pats in a row */
  const LINES = [
    [['surprised', 'eh?? what are you doing 😳'], ['shy', 'o-oh. ok. hi?? 😳'], ['surprised', 'w-wait, hold on 👀']],
    [['joy', 'ok that\u2019s actually kinda nice ✨'], ['smug', 'don\u2019t stop. i mean... whatever 😤'], ['joy', 'mm okay. you can stay 😌']],
    [['sparkle', 'careful, the hairclip!! 😭'], ['shy', 'okay okay i get it, you like pats 😳'], ['smug', 'you\u2019re really not gonna stop huh 💀']],
    [['pout', 'bro that\u2019s enough 😤'], ['annoyed', 'you\u2019re gonna mess up my hair 😭'], ['pout', 'i said ENOUGH... ok one more']]
  ];
  const COOL = [['grumpy', 'ok that\u2019s a LOT of pats. i need a break 😤'], ['grumpy', 'headpat limit reached. go touch grass 💀'], ['pout', 'my hair needs a minute!! 😭']];
  const BACK = ['shy', 'ok i\u2019m back 😳 ...you can pat again'];
  const IDLE = 'go on, pat me. i dare you 😤';
  const LIMIT = 18, COOL_MS = 8000, GAP_MS = 280;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const level = b => (b <= 3 ? 0 : b <= 8 ? 1 : b <= 14 ? 2 : 3);

  document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
    '<symbol id="i-hand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 013 0V12"/><path d="M11 5.5v-2a1.5 1.5 0 013 0V12"/><path d="M14 5.5a1.5 1.5 0 013 0V12"/><path d="M17 7.5a1.5 1.5 0 013 0V16a6 6 0 01-6 6h-2a6 6 0 01-5-2.7l-.2-.3c-.3-.5-1.4-2.4-3.3-5.7a1.5 1.5 0 01.5-2 1.9 1.9 0 012.3.3L8 15"/></symbol></svg>');

  /* ---- data ---- */
  const sbc = () => window.getSupabaseClient && window.getSupabaseClient();
  async function rpc(name, args) { const c = sbc(); if (!c) throw new Error('nosb'); const r = await c.rpc(name, args || {}); if (r.error) throw r.error; return r.data; }
  let total = 0, today = 0, xpLeft = 5, burst = 0, pending = 0, sending = false, guest = false;
  let lastPat = 0, lastLvl = -1, cool = 0, strokeAcc = 0, lastX = null, down = false, downAt = null, open = false, burstT = 0, flushT = 0;

  /* ---- popout ---- */
  const ov = document.createElement('div');
  ov.className = 'sh-ov'; ov.id = 'shOv';
  ov.innerHTML = '<div class="sh-card" role="dialog" aria-modal="true" aria-labelledby="shT"><div class="sh-h"><b id="shT">Headpat</b><button class="sh-x" type="button" aria-label="Close">\u00d7</button></div>' +
    '<div class="sh-stage" id="shStage"><div class="sh-glow"></div><img class="sh-face" id="shFace" alt="Spectra" draggable="false"><div class="sh-zone" id="shZone"></div>' +
    '<div class="sh-hand" id="shHand"><svg viewBox="0 0 24 24"><use href="#i-hand"/></svg></div></div>' +
    '<div class="sh-say" id="shSay"></div><div class="sh-stats" id="shStats"></div>' +
    '<button type="button" class="sh-btn" id="shBtn">Pat Me</button>' +
    '<p class="sh-tip" id="shTip">Hold and stroke over my head, or tap the button. Friendly pats only.</p></div>';
  document.body.appendChild(ov);
  const stage = $('#shStage', ov), face = $('#shFace', ov), zone = $('#shZone', ov), hand = $('#shHand', ov), say = $('#shSay', ov), stats = $('#shStats', ov), btn = $('#shBtn', ov), tip = $('#shTip', ov);

  function setFace(m) {
    const src = exprOn() && N[m] ? faceSrc(m) : PFP;
    if (face.dataset.s === src) return; face.dataset.s = src;
    face.style.opacity = 0;
    setTimeout(() => { face.onerror = () => { face.onerror = null; face.src = PFP; }; face.src = src; face.style.opacity = 1; }, 120);
  }
  function talk(m, text) {
    setFace(m); say.textContent = text; say.classList.remove('pop'); void say.offsetWidth; say.classList.add('pop');
  }
  function drawStats() {
    const used = 5 - xpLeft;
    stats.innerHTML = '<span>Pats today <b>' + today + '</b></span><span>All time <b>' + total + '</b></span><span>' + (xpLeft > 0 ? 'Bond XP today <b>' + used + '/5</b>' : 'Bond XP today <b>max \u2713</b>') + '</span>';
    btn.disabled = Date.now() < cool; btn.textContent = Date.now() < cool ? 'Resting...' : 'Pat me';
  }

  /* ---- patting ---- */
  function pat(px, py) {
    const now = Date.now(); if (now < cool || now - lastPat < GAP_MS) return; lastPat = now;
    burst++; pending++; today++; total++;
    clearTimeout(burstT); burstT = setTimeout(endBurst, 6000);
    if (burst >= LIMIT) startCool();
    else { const L = level(burst); if (L !== lastLvl || now - (pat.lastSay || 0) > 1100) { const r = pick(LINES[L]); talk(r[0], r[1]); pat.lastSay = now; } lastLvl = L; }
    fx(px, py); squish(); handPat(); drawStats(); queue();
  }
  function startCool() {
    cool = Date.now() + COOL_MS; stage.classList.add('cool'); const r = pick(COOL); talk(r[0], r[1]); drawStats();
    setTimeout(() => { cool = 0; burst = 0; lastLvl = -1; stage.classList.remove('cool'); talk(BACK[0], BACK[1]); drawStats(); }, COOL_MS);
  }
  function endBurst() { burst = 0; lastLvl = -1; if (Date.now() >= cool) talk('sparkle', IDLE); }
  function squish() { if (REDUCED()) return; face.classList.add('sq'); setTimeout(() => face.classList.remove('sq'), 150); }
  function handPat() { if (REDUCED()) return; hand.classList.remove('pat'); void hand.offsetWidth; hand.classList.add('pat'); }
  function fx(x, y) {
    if (REDUCED() || stage.querySelectorAll('.sh-p').length > 14) return;
    for (let i = 0; i < 2; i++) {
      const p = document.createElement('span'); p.className = 'sh-p'; p.textContent = pick(['\u2726', '\u2727', '\u2728']);
      p.style.left = (x + (Math.random() * 44 - 22)) + 'px'; p.style.top = (y - 10 + (Math.random() * 16 - 8)) + 'px';
      p.style.setProperty('--dx', (Math.random() * 50 - 25) + 'px'); stage.appendChild(p); setTimeout(() => p.remove(), 950);
    }
  }

  /* ---- hand + pointer ---- */
  const rel = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const inZone = e => { const r = zone.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
  function moveHand(x, y) { hand.classList.add('on'); hand.style.transform = 'translate(' + (x - 28) + 'px,' + (y - 34) + 'px)'; }
  stage.addEventListener('pointermove', e => {
    const p = rel(e); moveHand(p.x, p.y);
    if (e.pointerType === 'mouse' || down) {                                  // mouse: just stroke over her. touch: hold and drag
      if (inZone(e)) { if (lastX != null) strokeAcc += Math.abs(p.x - lastX); lastX = p.x; if (strokeAcc >= 70) { strokeAcc = 0; pat(p.x, p.y); } }
      else { lastX = null; strokeAcc = 0; }
    }
  });
  stage.addEventListener('pointerdown', e => { down = true; try { stage.setPointerCapture(e.pointerId); } catch (x) { } const p = rel(e); downAt = { x: p.x, y: p.y, t: Date.now() }; moveHand(p.x, p.y); });
  stage.addEventListener('pointerup', e => {
    down = false; lastX = null; strokeAcc = 0; const p = rel(e);
    if (downAt && Date.now() - downAt.t < 280 && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 14 && inZone(e)) pat(p.x, p.y);   // a quick tap = one pat
    downAt = null; if (e.pointerType !== 'mouse') setTimeout(() => { if (!down) hand.classList.remove('on'); }, 450);
  });
  stage.addEventListener('pointercancel', () => { down = false; lastX = null; strokeAcc = 0; hand.classList.remove('on'); });
  stage.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { hand.classList.remove('on'); lastX = null; strokeAcc = 0; } });
  btn.addEventListener('click', () => {                                        // the button works for everyone (keyboard, touch, mouse)
    const z = zone.getBoundingClientRect(), s = stage.getBoundingClientRect(), x = z.left - s.left + z.width / 2, y = z.top - s.top + z.height * .35;
    moveHand(x, y); pat(x, y); setTimeout(() => { if (!down) hand.classList.remove('on'); }, 500);
  });

  /* ---- saving pats (small batches; the database counts them and gives the bond XP) ---- */
  function queue() { if (guest) return; if (pending >= 10) return flush(); clearTimeout(flushT); flushT = setTimeout(flush, 1500); }
  async function flush() {
    clearTimeout(flushT); if (!pending || sending || guest) return;
    const n = Math.min(pending, 20); sending = true; pending -= n;
    try {
      const j = await rpc('spectra_headpat', { p_count: n });
      if (!j || !j.ok) { if (j && j.error === 'login') { guest = true; tip.textContent = 'Log in to save your pats and earn bond XP.'; } }
      else {
        total = Number(j.total) + pending; today = Number(j.today) + pending; xpLeft = Number(j.xp_left);
        if (j.xp_gain > 0 && window.SpectraBond && window.SpectraBond.onMeta) window.SpectraBond.onMeta(j);   // updates the bond pill, "+1 XP", level ups
        drawStats();
      }
    } catch (e) { console.warn('Spectra headpat: could not save pats', (e && e.message) || e); pending += n; guest = guest || /nosb/.test(String(e && e.message)); }
    sending = false; if (pending >= 10) flush();
  }
  async function loadStatus() {
    try {
      const j = await rpc('spectra_headpat_status');
      if (j && j.ok) { total = Number(j.total) + pending; today = Number(j.today) + pending; xpLeft = Number(j.xp_left); guest = false; }
      else if (j && j.error === 'login') { guest = true; tip.textContent = 'Log in to save your pats and earn bond XP.'; }
    } catch (e) { console.warn('Spectra headpat unavailable:', (e && e.message) || e); }
    drawStats();
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  /* ---- open / close ---- */
  function openIt() {
    open = true; ov.classList.add('on'); burst = 0; lastLvl = -1; face.dataset.s = '';
    talk('sparkle', IDLE); drawStats(); loadStatus();
  }
  function close() { ov.classList.remove('on'); open = false; hand.classList.remove('on'); flush(); }
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.sh-x')) close(); });
  document.addEventListener('keydown', e => { if (open && e.key === 'Escape') close(); });

  /* ---- sparkle menu row (the page rebuilds this menu on every open, so add it again after each draw) ---- */
  function inject() {
    if (!pMenu.querySelector('[data-persona]') || pMenu.querySelector('[data-headpat]')) return;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.headpat = '1';
    b.innerHTML = '<i class="sa-fi"><svg><use href="#i-hand"/></svg></i><span>Headpat</span><em>\u203a</em>';
    const rows = pMenu.querySelectorAll('[data-journal],[data-bond]'), last = rows[rows.length - 1];
    if (last) last.after(b); else { const sep = pMenu.querySelector('.sa-sep'); if (sep) pMenu.insertBefore(b, sep); else pMenu.appendChild(b); }
  }
  new MutationObserver(inject).observe(pMenu, { childList: true });
  pMenu.addEventListener('click', e => { if (e.target.closest('[data-headpat]')) openIt(); });
  inject();
  window.SpectraHeadpat = { open: openIt };
})();
