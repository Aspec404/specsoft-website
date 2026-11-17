/* SPECSOFT® Spectra Lesson (v2) = "Video" mode (bigger Spectra, glowing voice ring, word-by-word captions, animated board).
   Spectra writes a small lesson script (JSON). This player performs it live: board lines appear step by step,
   her profile picture floats, swaps faces by mood and pulses with her voice.
   Needs spectra-voice.js (falls back to timed, silent playback without it). KaTeX and spectra-viz.js are used when present.
   API: SpectraLesson.parse(rawText) -> lesson | null, SpectraLesson.open(lesson), SpectraLesson.close() */
(function () {
'use strict';
const IMGDIR = 'assets/spectra-academics/';
const FACE = { think: 'spectra-think.webp', calm: 'spectra-calm.webp', happy: 'spectra-happy.webp', upset: 'spectra-upset.webp' };
const MOOD2 = { joy: 'happy', sparkle: 'happy', love: 'happy', smug: 'happy', shy: 'happy', thinking: 'think', confused: 'think', deadpan: 'think', speechless: 'think', sleepy: 'think', surprised: 'calm', shocked: 'calm', sad: 'upset', annoyed: 'upset', grumpy: 'upset', pout: 'upset' };
const VIZ_T = ['triangle', 'pythagoras', 'unitcircle', 'circle', 'polygon', 'graph'];
const VIZ_K = ['type', 'angle', 'a', 'b', 'r', 'sides', 'fn', 'fn2', 'xmin', 'xmax', 'ymin', 'ymax', 'title'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (d, fill) => '<svg viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
const IC = { prev: 'M6 5v14M19 6l-9 6 9 6z', next: 'M18 5v14M5 6l9 6-9 6z', play: 'M8 5v14l11-7z', pause: 'M8 5v14M16 5v14', redo: 'M4 5v5h5M5.6 15a7.5 7.5 0 101.8-7.9L4 10', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10', film: 'M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM10 9.2v5.6l4.8-2.8z' };

/* ---------- parse + sanitize the script the model wrote ---------- */
// models sometimes forget to double the backslashes in LaTeX, so repair that before JSON.parse
const fix = (s, withU) => s.replace(withU ? /\\\\|\\(?!["])/g : /\\\\|\\(?!["\/u])/g, m => m === '\\\\' ? m : '\\\\');
const str = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
function clean(o) {
  const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, 12).map(s => {
    if (!s || typeof s !== 'object') return null;
    const say = str(s.say, 260); if (!say) return null;
    const show = []; let viz = false;
    (Array.isArray(s.show) ? s.show : []).slice(0, 4).forEach(x => {
      if (!x || typeof x !== 'object') return;
      if (x.t === 'eq') { const v = str(x.v, 140); if (v) show.push({ t: 'eq', v, note: str(x.note, 40), hl: x.hl === true }); }
      else if (x.t === 'text') { const v = str(x.v, 110); if (v) show.push({ t: 'text', v }); }
      else if (x.t === 'clear') show.push({ t: 'clear' });
      else if (x.t === 'viz' && !viz && x.v && typeof x.v === 'object' && VIZ_T.indexOf(x.v.type) >= 0) {
        const v = {}; VIZ_K.forEach(k => { const w = x.v[k]; if ((typeof w === 'number' && isFinite(w)) || (typeof w === 'string' && w.length <= 60)) v[k] = w; });
        viz = true; show.push({ t: 'viz', v });
      }
    });
    const m = String(s.mood || '').toLowerCase();
    return { say, mood: MOOD2[m] ? m : 'joy', show };
  }).filter(Boolean);
  return steps.length >= 2 ? { title: str(o.title, 60) || 'Quick lesson', steps } : null;
}
function parse(raw) {
  const t = String(raw || '').replace(/^\s*\[mood:[a-z]*\]?\s*/i, '');
  const f = t.match(/```(?:lesson|json)?[ \t]*\n?([\s\S]*?)```/i);
  let j = f ? f[1] : t; const a = j.indexOf('{'), b = j.lastIndexOf('}');
  if (a < 0 || b <= a) return null; j = j.slice(a, b + 1);
  let o = null;
  for (const v of [fix(j, false), fix(j, true), j]) { try { o = JSON.parse(v); break; } catch (e) { } }
  return o && typeof o === 'object' ? clean(o) : null;
}

/* ---------- player ---------- */
let el, L, board, subEl, pfp, pulse, ring, glow, tagEl, tagTx, imgs, dotsEl, cnt, btnPlay, intro, prog, endEl;
let tok = 0, idx = 0, shown = -1, eng = 'gemini', playing = false, speaking = false, done = false, started = false, raf = 0, lv = 0, cf = '', ki = 0, kw = [], tg = '';
const V = () => window.SpectraVoice;
const wait = ms => new Promise(r => setTimeout(r, ms));
const est = () => { const s = L.steps.reduce((a, t) => a + t.say.length * .06 + .6, 0); return s < 90 ? 'about ' + Math.max(10, Math.round(s / 5) * 5) + ' sec' : 'about ' + Math.round(s / 60) + ' min'; };

function close() {
  tok++; kStop(); if (V()) { try { V().stop(); V().cancelPrefetch(); } catch (e) { } }
  if (raf) cancelAnimationFrame(raf); raf = 0; document.removeEventListener('keydown', key, true);
  if (el) el.remove(); el = null; started = false; playing = false; speaking = false;
}
function open(lesson) {
  close(); if (!lesson || !lesson.steps) return; L = lesson; idx = 0; shown = -1; done = false; cf = ''; tg = '';
  const n = L.steps.length, hasV = !!(V() && V().play);
  el = document.createElement('div'); el.className = 'sl';
  el.innerHTML = '<div class="sl-box" role="dialog" aria-modal="true" aria-label="Spectra video lesson">' +
    '<header class="sl-top"><span class="sl-badge">' + svg(IC.film) + '</span><b class="sl-ttl"></b><button type="button" class="sl-x" data-c="x" aria-label="Close">' + svg(IC.x) + '</button><div class="sl-prog"><i></i></div></header>' +
    '<div class="sl-stage"><div class="sl-bg"></div><div class="sl-board" id="slb"></div>' +
    '<div class="sl-end"><span>' + svg(IC.check) + 'Lesson complete</span><button type="button" data-c="redo">Watch again</button></div>' +
    '<div class="sl-intro"><span class="sl-kick">Video lesson</span><h2></h2><p class="sl-meta"></p>' +
    (hasV ? '<button type="button" class="sl-go" data-e="gemini">Play with Spectra\'s voice<small>uses about ' + n + ' credits, replays are free</small></button><button type="button" class="sl-go alt" data-e="browser">Play with free voice<small>your device\'s built-in voice</small></button>' : '<button type="button" class="sl-go" data-e="silent">Play lesson<small>voice is not available here</small></button>') +
    '<span class="sl-warn">Spectra can make mistakes. Double-check important answers.</span></div>' +
    '<div class="sl-sub" aria-live="polite"></div>' +
    '<div class="sl-pfp"><div class="sl-glow"></div><div class="sl-pulse"><div class="sl-ring"></div><div class="sl-face"><span>S</span><img alt="" class="on"><img alt=""></div></div><div class="sl-tag"><i></i><em>Ready</em></div></div></div>' +
    '<footer class="sl-ctl"><button type="button" class="sl-b" data-c="prev" aria-label="Previous step">' + svg(IC.prev) + '</button>' +
    '<button type="button" class="sl-b sl-p" data-c="play" aria-label="Pause">' + svg(IC.pause) + '</button>' +
    '<button type="button" class="sl-b" data-c="next" aria-label="Next step">' + svg(IC.next) + '</button>' +
    '<button type="button" class="sl-b" data-c="redo" aria-label="Watch again">' + svg(IC.redo) + '</button>' +
    '<div class="sl-dots"></div><span class="sl-cnt"></span></footer></div>';
  document.body.appendChild(el);
  const q = s => el.querySelector(s);
  q('.sl-ttl').textContent = L.title; q('.sl-intro h2').textContent = L.title;
  q('.sl-meta').textContent = n + ' steps \u00b7 ' + est() + ' \u00b7 Spectra explains out loud';
  board = q('.sl-board'); subEl = q('.sl-sub'); pfp = q('.sl-pfp'); pulse = q('.sl-pulse'); ring = q('.sl-ring'); glow = q('.sl-glow'); tagEl = q('.sl-tag'); tagTx = q('.sl-tag em');
  imgs = [].slice.call(el.querySelectorAll('.sl-face img'));
  dotsEl = q('.sl-dots'); cnt = q('.sl-cnt'); btnPlay = q('[data-c=play]'); intro = q('.sl-intro'); prog = q('.sl-prog i'); endEl = q('.sl-end');
  dotsEl.innerHTML = L.steps.map((s, i) => '<button type="button" class="sl-dot" data-i="' + i + '" aria-label="Go to step ' + (i + 1) + '"></button>').join('');
  imgs.forEach(i => { i.onerror = () => { i.style.display = 'none'; }; });
  Object.keys(FACE).forEach(k => { const p = new Image(); p.src = IMGDIR + FACE[k]; });   // preload the 4 faces
  face('joy'); dots(); setPlay();
  el.addEventListener('click', e => {
    if (e.target === el) return close();
    const g = e.target.closest('[data-e]'); if (g) return begin(g.dataset.e);
    const d = e.target.closest('[data-i]'); if (d) return jump(+d.dataset.i);
    const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
    if (c === 'x') close(); else if (c === 'play') toggle(); else if (c === 'next') jump(idx + 1); else if (c === 'prev') jump(idx - 1); else if (c === 'redo') { if (!started) return; jump(0); }
  });
  document.addEventListener('keydown', key, true);
  raf = requestAnimationFrame(loop);
}
function begin(e) {
  eng = e; started = true; intro.classList.add('off');
  if (V() && V().prime) V().prime();   // unlocks audio inside this tap so iOS and Safari let her speak
  jump(0);
}
function key(e) {
  if (!el) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (!started) return;
  if (e.key === ' ' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowRight') jump(idx + 1); else if (e.key === 'ArrowLeft') jump(idx - 1);
}

/* board */
const KT = (m, v) => { if (window.katex) { try { window.katex.render(v, m, { throwOnError: false, displayMode: false }); return; } catch (e) { } } m.textContent = v; };
function apply(op, anim) {
  if (op.t === 'clear') { board.innerHTML = ''; return; }
  const r = document.createElement('div');
  r.className = 'sl-r ' + (op.t === 'eq' ? 'sl-eq' + (op.hl ? ' hl' : '') : op.t === 'text' ? 'sl-t' : 'sl-v') + (anim ? '' : ' ni');
  if (op.t === 'eq') {
    const m = document.createElement('span'); m.className = 'sl-m'; KT(m, op.v); r.appendChild(m);
    if (op.note) { const n = document.createElement('small'); n.className = 'sl-n'; n.textContent = op.note; r.appendChild(n); }
  } else if (op.t === 'text') r.textContent = op.v;
  else { r.innerHTML = '<div class="ac-viz" data-v="' + esc(JSON.stringify(op.v)) + '"></div>'; }
  board.appendChild(r);
  // shapes and graphs build themselves (slower than in chat, to match the narration); rebuilds after a jump show them finished
  if (op.t === 'viz' && window.SpectraViz) { try { window.SpectraViz.mount(r, { always: !!anim, still: !anim, now: true, speed: .8, static: true }); } catch (e) { } }
}
function renderTo(i, anim) {
  for (let k = shown + 1; k <= i && k < L.steps.length; k++) L.steps[k].show.forEach(op => apply(op, anim && k === i));
  shown = Math.max(shown, i);
  board.scrollTo({ top: board.scrollHeight, behavior: anim ? 'smooth' : 'auto' });
}
function rebuild(i) { board.innerHTML = ''; shown = -1; if (i > 0) renderTo(i - 1, false); done = false; }

/* face, subtitles (words light up as she says them), controls */
function face(mood) {
  const k = MOOD2[mood] || 'calm';
  if (k !== cf) {
    cf = k; const on = imgs[0].classList.contains('on') ? imgs[1] : imgs[0], off = on === imgs[0] ? imgs[1] : imgs[0];
    on.style.display = ''; on.src = IMGDIR + FACE[k]; on.classList.add('on'); off.classList.remove('on');
  }
  pfp.classList.remove('bump'); void pfp.offsetWidth; pfp.classList.add('bump');
}
function kStop() { if (ki) clearInterval(ki); ki = 0; }
const lit = n => kw.forEach((w, i) => w.classList.toggle('on', i < n));
function kStart(my, ms) {
  kStop(); const t0 = Date.now();
  ki = setInterval(() => { if (my !== tok) return kStop(); lit(Math.floor(kw.length * Math.min(.95, (Date.now() - t0) / ms))); }, 70);
}
function fin(my) { if (my !== tok) return; kStop(); lit(kw.length); }
function sub(t) {
  kStop(); subEl.innerHTML = t.split(/(\s+)/).map(w => w && !/^\s+$/.test(w) ? '<span>' + esc(w) + '</span>' : w).join('');
  kw = [].slice.call(subEl.querySelectorAll('span')); subEl.classList.remove('in'); void subEl.offsetWidth; subEl.classList.add('in');
}
function dots() {
  const n = L.steps.length;
  [].forEach.call(dotsEl.children, (d, i) => { d.className = 'sl-dot' + (done || i < idx ? ' done' : i === idx ? ' on' : ''); });
  cnt.textContent = done ? 'Done' : (idx + 1) + ' / ' + n;
  prog.style.width = (done ? 100 : started ? (idx + .5) / n * 100 : 0) + '%'; endEl.classList.toggle('on', done);
}
function setPlay() { btnPlay.innerHTML = svg(playing ? IC.pause : IC.play, !playing); btnPlay.classList.toggle('live', playing); btnPlay.setAttribute('aria-label', playing ? 'Pause' : done ? 'Watch again' : 'Play'); }
function status() {
  const s = !started ? 'Ready' : done ? 'Done' : !playing ? 'Paused' : pfp.classList.contains('ld') ? 'Getting ready' : speaking ? 'Speaking' : 'Explaining';
  if (s !== tg) { tg = s; tagTx.textContent = s; tagEl.dataset.s = s === 'Speaking' ? 'on' : ''; }
}

/* her profile glows and pulses with her voice (real volume for Spectra's voice, a soft fake pulse for the browser voice) */
function loop(t) {
  raf = requestAnimationFrame(loop); if (!el) return;
  let target = 0;
  if (speaking) { const real = V() && V().level ? V().level() : null; target = real != null ? real : .3 + .2 * Math.sin(t / 95) + .1 * Math.sin(t / 37); }
  lv += (target - lv) * .3;
  pulse.style.transform = 'scale(' + (1 + lv * .09).toFixed(3) + ')';
  ring.style.opacity = Math.min(1, lv * 2.2 + (speaking ? .25 : 0)).toFixed(2); ring.style.transform = 'scale(' + (1 + lv * .12).toFixed(3) + ')';
  glow.style.opacity = Math.min(.95, (speaking ? .34 : .16) + lv * 1.5).toFixed(2); glow.style.transform = 'scale(' + (1 + lv * .3).toFixed(3) + ')';
  status();
}

/* playback */
async function speak(st, my) {
  const v = V(), t0 = Date.now(), floor = Math.max(2200, st.say.length * 55), ms = Math.max(1800, st.say.length * 58);
  if (eng === 'silent' || !v || !v.play) { kStart(my, floor); await wait(floor); fin(my); return; }
  speaking = false; pfp.classList.add('ld');
  try { await v.play('[mood:' + st.mood + '] ' + st.say, { engine: eng, onStart: () => { if (my === tok) { speaking = true; pfp.classList.remove('ld'); kStart(my, ms); } } }); } catch (e) { }
  speaking = false; pfp.classList.remove('ld');
  if (my === tok && Date.now() - t0 < 300) { kStart(my, floor); await wait(floor); }   // the voice failed instantly: keep the pace readable
  fin(my);
}
async function run(from) {
  const my = ++tok; playing = true; done = false; setPlay();
  for (let i = from; i < L.steps.length; i++) {
    if (my !== tok) return;
    idx = i; dots(); const st = L.steps[i];
    renderTo(i, true); face(st.mood); sub(st.say);
    const nx = L.steps[i + 1]; if (nx && eng === 'gemini' && V() && V().prefetch) V().prefetch('[mood:' + nx.mood + '] ' + nx.say, 'gemini');   // next clip loads while she talks
    await speak(st, my); if (my !== tok) return;
    await wait(450); if (my !== tok) return;
  }
  if (my !== tok) return;
  playing = false; done = true; dots(); setPlay();
}
function pause() { tok++; kStop(); playing = false; speaking = false; if (V()) V().stop(); pfp.classList.remove('ld'); setPlay(); }
function jump(i) {
  if (!started) return; i = Math.max(0, Math.min(L.steps.length - 1, i));
  tok++; kStop(); if (V()) V().stop(); speaking = false; rebuild(i); run(i);
}
function toggle() { if (!started) return; if (playing) pause(); else if (done) jump(0); else run(idx); }

window.SpectraLesson = { parse, open, close, _clean: clean };
})();
