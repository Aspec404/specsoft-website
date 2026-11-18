/* SPECSOFT® Spectra Flashcards (v2). Spectra writes a small deck (JSON), this player lets you study it:
   tap to flip, "Got it" / "Still learning" (or swipe), review only the cards you missed, shuffle, keyboard shortcuts.
   KaTeX is used for math when present. API: SpectraFlash.parse(rawText) -> deck | null, SpectraFlash.open(deck), SpectraFlash.close() */
(function () {
'use strict';
const svg = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
const IC = { x: 'M6 6l12 12M18 6L6 18', shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5', redo: 'M4 5v5h5M5.6 15a7.5 7.5 0 101.8-7.9L4 10', check: 'M5 12l5 5 9-10', cards: 'M8 8h12v10H8zM4 15V6a2 2 0 012-2h9' };

/* ---------- parse + sanitize the deck the model wrote ---------- */
const fix = (s, withU) => s.replace(withU ? /\\\\|\\(?!["])/g : /\\\\|\\(?!["\/u])/g, m => m === '\\\\' ? m : '\\\\');   // repairs LaTeX backslashes the model forgot to double
const str = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
function clean(o) {
  const cards = (Array.isArray(o.cards) ? o.cards : []).slice(0, 20).map(c => {
    if (!c || typeof c !== 'object') return null;
    const q = str(c.q, 220), a = str(c.a, 320); if (!q || !a) return null;
    return { q, a, h: str(c.h, 90) };
  }).filter(Boolean);
  return cards.length >= 3 ? { title: str(o.title, 60) || 'Flashcards', cards } : null;
}
function parse(raw) {
  const t = String(raw || '').replace(/^\s*\[mood:[a-z]*\]?\s*/i, '');
  const f = t.match(/```(?:flashcards|json)?[ \t]*\n?([\s\S]*?)```/i);
  let j = f ? f[1] : t; const a = j.indexOf('{'), b = j.lastIndexOf('}');
  if (a < 0 || b <= a) return null; j = j.slice(a, b + 1);
  let o = null;
  for (const v of [fix(j, false), fix(j, true), j]) { try { o = JSON.parse(v); break; } catch (e) { } }
  return o && typeof o === 'object' ? clean(o) : null;
}

/* ---------- player ---------- */
let el, deck, card, inner, qEl, aEl, hintBtn, hintEl, cntEl, prog, done, ctl, btnYes, btnNo, btnFlip;
let queue = [], pos = 0, res = {}, flipped = false, busy = false, drag = null;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/* single-dollar math ($x$, $5$) -> \(..\); strict so money like "$5 and $8" stays text */
const dl = t => String(t).replace(/(?<![\w$\\])\$(?!\s)([^$\n]{1,80}?)(?<!\s)\$(?![\w$])/g, (m, a) => '\\(' + a + '\\)');
const math = n => { if (window.renderMathInElement) { try { window.renderMathInElement(n, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false }); } catch (e) { } } };

function close() { document.removeEventListener('keydown', key, true); if (el) el.remove(); el = null; }
function open(d) {
  close(); if (!d || !d.cards) return; deck = d;
  el = document.createElement('div'); el.className = 'fc';
  el.innerHTML = '<div class="fc-box" role="dialog" aria-modal="true" aria-label="Spectra flashcards">' +
    '<header class="fc-top"><span class="fc-badge">' + svg(IC.cards) + '</span><b class="fc-ttl"></b><span class="fc-cnt"></span>' +
    '<button type="button" class="fc-ib" data-c="shuffle" aria-label="Shuffle" title="Shuffle">' + svg(IC.shuffle) + '</button>' +
    '<button type="button" class="fc-ib" data-c="restart" aria-label="Start over" title="Start over">' + svg(IC.redo) + '</button>' +
    '<button type="button" class="fc-ib" data-c="x" aria-label="Close">' + svg(IC.x) + '</button><div class="fc-prog"><i></i></div></header>' +
    '<div class="fc-stage"><div class="fc-card" tabindex="0" role="button" aria-label="Flip card"><div class="fc-in">' +
    '<div class="fc-f"><small>Question</small><p></p><button type="button" class="fc-hintb">Show hint</button><em class="fc-hint"></em></div>' +
    '<div class="fc-b"><small>Answer</small><p></p></div></div></div>' +
    '<div class="fc-done"></div></div>' +
    '<footer class="fc-ctl"><button type="button" class="fc-no" data-c="no">Still learning</button><button type="button" class="fc-flip" data-c="flip">Flip card</button><button type="button" class="fc-yes" data-c="yes">Got it</button></footer></div>';
  document.body.appendChild(el);
  const q = s => el.querySelector(s);
  q('.fc-ttl').textContent = deck.title; card = q('.fc-card'); inner = q('.fc-in'); qEl = q('.fc-f p'); aEl = q('.fc-b p'); hintBtn = q('.fc-hintb'); hintEl = q('.fc-hint');
  cntEl = q('.fc-cnt'); prog = q('.fc-prog i'); done = q('.fc-done'); ctl = q('.fc-ctl'); btnYes = q('.fc-yes'); btnNo = q('.fc-no'); btnFlip = q('.fc-flip');
  el.addEventListener('click', e => {
    if (e.target === el) return close();
    const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
    if (c === 'x') close(); else if (c === 'flip') flip(); else if (c === 'yes') mark('k'); else if (c === 'no') mark('l');
    else if (c === 'shuffle') start(shuffle(all())); else if (c === 'restart') start(all());
    else if (c === 'missed') start(shuffle(missed())); else if (c === 'again') start(all());
  });
  hintBtn.addEventListener('click', e => { e.stopPropagation(); hintEl.hidden = false; hintBtn.hidden = true; });
  card.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); flip(); } });
  /* tap flips; swipe right = got it, swipe left = still learning (after flipping) */
  card.addEventListener('pointerdown', e => { if (busy || e.target.closest('button')) return; drag = { x: e.clientX, y: e.clientY, dx: 0 }; try { card.setPointerCapture(e.pointerId); } catch (er) { } });
  card.addEventListener('pointermove', e => { if (!drag) return; drag.dx = e.clientX - drag.x; if (flipped && Math.abs(drag.dx) > 12) { card.classList.add('drag'); card.style.transform = 'translateX(' + drag.dx + 'px) rotate(' + drag.dx / 22 + 'deg)'; } });
  const up = e => {
    if (!drag) return; const d = drag; drag = null; card.classList.remove('drag'); card.style.transform = '';
    if (Math.abs(d.dx) < 10 && Math.abs(e.clientY - d.y) < 14) flip();
    else if (flipped && d.dx > 80) mark('k'); else if (flipped && d.dx < -80) mark('l');
  };
  card.addEventListener('pointerup', up); card.addEventListener('pointercancel', () => { drag = null; card.classList.remove('drag'); card.style.transform = ''; });
  document.addEventListener('keydown', key, true);
  start(all()); try { card.focus({ preventScroll: true }); } catch (e) { }   // so Space / arrows work right away, even if the button that opened the deck still had focus
}
const all = () => deck.cards.map((_, i) => i);
const missed = () => Object.keys(res).filter(k => res[k] === 'l').map(Number);
function key(e) {
  if (!el) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (el.contains(e.target) && e.target.closest && e.target.closest('button')) return;   // a button inside the player handles its own keys
  if (e.key === ' ' || e.key === 'Enter') { if (done.classList.contains('on')) return; e.preventDefault(); flip(); }
  else if (e.key === 'ArrowRight') mark('k'); else if (e.key === 'ArrowLeft') mark('l');
}
function start(list) { queue = list; pos = 0; res = {}; busy = false; done.classList.remove('on'); card.hidden = false; ctl.hidden = false; show(); }
function show() {
  if (pos >= queue.length) return finish();
  const c = deck.cards[queue[pos]]; flipped = false; busy = false;
  card.classList.remove('flip', 'out-k', 'out-l'); card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  qEl.textContent = dl(c.q); aEl.textContent = dl(c.a); math(qEl); math(aEl);
  inner.dataset.sz = (c.q.length > 110 || c.a.length > 160) ? 's' : (c.q.length > 60 || c.a.length > 90) ? 'm' : 'l';
  hintEl.hidden = true; hintEl.textContent = dl(c.h || ''); math(hintEl); hintBtn.hidden = !c.h;
  cntEl.textContent = (pos + 1) + ' / ' + queue.length; prog.style.width = (pos / queue.length * 100) + '%';
  sync();
}
function sync() { btnYes.disabled = btnNo.disabled = !flipped; btnFlip.textContent = flipped ? 'Flip back' : 'Flip card'; }
function flip() { if (busy || card.hidden) return; flipped = !flipped; card.classList.toggle('flip', flipped); sync(); }
function mark(k) {
  if (busy || !flipped || card.hidden) return; busy = true; res[queue[pos]] = k;
  card.classList.add(k === 'k' ? 'out-k' : 'out-l');
  setTimeout(() => { if (!el) return; pos++; show(); }, 280);
}
function finish() {
  card.hidden = true; ctl.hidden = true; prog.style.width = '100%'; cntEl.textContent = 'Done';
  const total = queue.length, got = queue.filter(i => res[i] === 'k').length, miss = total - got;
  const msg = miss === 0 ? 'Perfect round! You know all of these.' : got >= total / 2 ? 'Nice work! A little more practice on the rest.' : 'Good start. Review the missed ones and try again.';
  done.innerHTML = '<div class="fc-ring" style="--p:' + Math.round(got / total * 100) + '"><b>' + got + '<small>/' + total + '</small></b></div><h3></h3><p>' + msg + '</p><div class="fc-acts">' +
    (miss ? '<button type="button" class="fc-yes" data-c="missed">Review missed (' + miss + ')</button>' : '') + '<button type="button" class="fc-alt" data-c="again">Study all again</button><button type="button" class="fc-alt" data-c="x">Close</button></div>';
  done.querySelector('h3').textContent = got + ' of ' + total + ' known'; done.classList.add('on');
}

window.SpectraFlash = { parse, open, close, _clean: clean };
})();
