/* SPECSOFT® Spectra Lesson (v3.1: fluid scenes + Spectre) = "Video" mode (bigger Spectra, glowing voice ring, word-by-word captions, animated board).
   Spectra writes a small lesson script (JSON). This player performs it live: board lines appear step by step,
   her profile picture floats, swaps faces by mood and pulses with her voice.
   Needs spectra-voice.js (falls back to timed, silent playback without it). KaTeX and spectra-viz.js are used when present.
   Voice fallback: when Spectra's voice is busy or out (or the free browser voice is used), her Spectre (the sphere drone) floats in and reads the lesson. Spectra goes "Muted".
   Fluid scenes (Batch C): the board shows ONE scene at a time. A step with items REPLACES the last scene (old items fade out), a step with no items keeps it.
   An equation (or a graph or shape of the same type) that comes back is matched to the old one (by id, else in order) and MORPHS in place instead of stacking a new row. Equation pieces glide (FLIP on the rendered KaTeX),
   \blue{} \pink{} \green{} \amber{} keep a piece's color, graphs and shapes tween (SpectraViz.morph). Old lessons without ids play exactly as before.
   API: SpectraLesson.parse(rawText) -> lesson | null, SpectraLesson.open(lesson), SpectraLesson.close() */
(function () {
'use strict';
const IMGDIR = 'assets/spectra-academics/';
const FACE = { think: 'spectra-think.webp', calm: 'spectra-calm.webp', happy: 'spectra-happy.webp', upset: 'spectra-upset.webp' };
const MOOD2 = { joy: 'happy', sparkle: 'happy', love: 'happy', smug: 'happy', shy: 'happy', thinking: 'think', confused: 'think', deadpan: 'think', speechless: 'think', sleepy: 'think', surprised: 'calm', shocked: 'calm', sad: 'upset', annoyed: 'upset', grumpy: 'upset', pout: 'upset' };
// her Spectre (sphere drone): speaks when Spectra's voice is busy/out. Six faces, all in IMGDIR.
const SP = { power: 'spectre-power.webp', happy: 'spectre-happy.webp', sparkle: 'spectre-sparkle.webp', idea: 'spectre-idea.webp', loading: 'spectre-loading.webp', pause: 'spectre-pause.webp' };
const SPM = { sparkle: 'sparkle', surprised: 'sparkle', shocked: 'sparkle', thinking: 'idea', confused: 'idea' };   // mood -> Spectre face (everything else = happy)
const SPECTRE_ON_FREE_VOICE = true;   // true: the free browser voice is read by the Spectre too (it is not Spectra's voice). false: only a fallback brings the Spectre.
const WHY = { busy: "Spectra's voice is busy, so her Spectre is reading this one.", rate: 'Too many voice requests, so her Spectre is stepping in.', daily: "You're out of credits for today. Her Spectre reads the rest for free.", off: "Spectra's voice isn't available right now, so her Spectre is reading this one." };
const VIZ_T = ['triangle', 'pythagoras', 'unitcircle', 'circle', 'polygon', 'graph'];
const VIZ_K = ['type', 'angle', 'a', 'b', 'r', 'sides', 'fn', 'fn2', 'xmin', 'xmax', 'ymin', 'ymax', 'x', 'title'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = (d, fill) => '<svg viewBox="0 0 24 24" fill="' + (fill ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
const IC = { mute: 'M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4zM16 9.5l5 5M21 9.5l-5 5', prev: 'M6 5v14M19 6l-9 6 9 6z', next: 'M18 5v14M5 6l9 6-9 6z', play: 'M8 5v14l11-7z', pause: 'M8 5v14M16 5v14', redo: 'M4 5v5h5M5.6 15a7.5 7.5 0 101.8-7.9L4 10', x: 'M6 6l12 12M18 6L6 18', check: 'M5 12l5 5 9-10', film: 'M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM10 9.2v5.6l4.8-2.8z' };

/* ---------- parse + sanitize the script the model wrote ---------- */
// models sometimes forget to double the backslashes in LaTeX, so repair that before JSON.parse
const fix = (s, withU) => s.replace(withU ? /\\\\|\\(?!["])/g : /\\\\|\\(?!["\/u])/g, m => m === '\\\\' ? m : '\\\\');
const str = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
const idOf = v => typeof v === 'string' && /^[a-z0-9]{1,8}$/i.test(v.trim()) ? v.trim().toLowerCase() : '';   // same id in a later step = the same object, it morphs
function clean(o) {
  const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, 12).map(s => {
    if (!s || typeof s !== 'object') return null;
    const say = str(s.say, 260); if (!say) return null;
    const show = []; let viz = false;
    (Array.isArray(s.show) ? s.show : []).slice(0, 4).forEach(x => {
      if (!x || typeof x !== 'object') return;
      if (x.t === 'eq') { const v = str(x.v, 200); if (v) show.push({ t: 'eq', v, note: str(x.note, 40), hl: x.hl === true, id: idOf(x.id) }); }
      else if (x.t === 'text') { const v = str(x.v, 110); if (v) show.push({ t: 'text', v }); }
      else if (x.t === 'clear') show.push({ t: 'clear' });
      else if (x.t === 'viz' && !viz && x.v && typeof x.v === 'object' && VIZ_T.indexOf(x.v.type) >= 0) {
        const v = {}; VIZ_K.forEach(k => { const w = x.v[k]; if ((typeof w === 'number' && isFinite(w)) || (typeof w === 'string' && w.length <= 60)) v[k] = w; });
        viz = true; show.push({ t: 'viz', v, id: idOf(x.id) });
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
let el, L, board, subEl, pfp, pulse, ring, glow, tagEl, tagTx, imgs, dotsEl, cnt, btnPlay, intro, prog, endEl, spG, spI, spR, spImgs, toastEl;
let tok = 0, idx = 0, shown = -1, eng = 'gemini', playing = false, speaking = false, done = false, started = false, raf = 0, lv = 0, cf = '', ki = 0, kw = [], tg = '', spk = 'spectra', spc = '', boot = 0, toastT = 0, spBad = {};   // spk = who reads this lesson now (spectra or spectre)
const V = () => window.SpectraVoice;
const wait = ms => new Promise(r => setTimeout(r, ms));
const est = () => { const s = L.steps.reduce((a, t) => a + t.say.length * .06 + .6, 0); return s < 90 ? 'about ' + Math.max(10, Math.round(s / 5) * 5) + ' sec' : 'about ' + Math.round(s / 60) + ' min'; };

function close() {
  sceneTok++; tok++; kStop(); if (V()) { try { V().stop(); V().cancelPrefetch(); } catch (e) { } }
  if (raf) cancelAnimationFrame(raf); raf = 0; document.removeEventListener('keydown', key, true);
  clearTimeout(toastT); if (el) el.remove(); el = null; started = false; playing = false; speaking = false; spk = 'spectra'; spc = ''; boot = 0;
}
function open(lesson) {
  close(); if (!lesson || !lesson.steps) return; L = lesson; idx = 0; shown = -1; done = false; cf = ''; tg = ''; spk = 'spectra'; spc = ''; boot = 0; spBad = {};   // every new lesson starts on Spectra's own voice again
  const n = L.steps.length, hasV = !!(V() && V().play);
  el = document.createElement('div'); el.className = 'sl';
  el.innerHTML = '<div class="sl-box" role="dialog" aria-modal="true" aria-label="Spectra video lesson">' +
    '<header class="sl-top"><span class="sl-badge">' + svg(IC.film) + '</span><b class="sl-ttl"></b><button type="button" class="sl-x" data-c="x" aria-label="Close">' + svg(IC.x) + '</button><div class="sl-prog"><i></i></div></header>' +
    '<div class="sl-stage"><div class="sl-bg"></div><div class="sl-board" id="slb"></div>' +
    '<div class="sl-end"><span>' + svg(IC.check) + 'Lesson complete</span><button type="button" data-c="redo">Watch again</button></div>' +
    '<div class="sl-intro"><span class="sl-kick">Video lesson</span><h2></h2><p class="sl-meta"></p>' +
    (hasV ? '<button type="button" class="sl-go" data-e="gemini">Play with Spectra\'s voice<small>uses about ' + n + ' credits, replays are free</small></button><button type="button" class="sl-go alt" data-e="browser">Play with free voice<small>' + (SPECTRE_ON_FREE_VOICE ? 'her Spectre reads it, with your device\'s voice' : 'your device\'s built-in voice') + '</small></button>' : '<button type="button" class="sl-go" data-e="silent">Play lesson<small>voice is not available here</small></button>') +
    '<span class="sl-warn">Spectra can make mistakes. Double-check important answers.</span></div>' +
    '<div class="sl-sub" aria-live="polite"></div>' +
    '<div class="sl-pfp"><div class="sl-glow"></div><div class="sl-pulse"><div class="sl-ring"></div><div class="sl-face"><span>S</span><img alt="" class="on"><img alt=""></div></div>' +
    '<div class="sl-sp" aria-hidden="true"><div class="sl-spg"></div><div class="sl-spi"><div class="sl-spr"></div><b class="sl-spf"></b><img alt="" class="on"><img alt=""></div></div>' +
    '<span class="sl-mute">' + svg(IC.mute) + 'Muted</span><div class="sl-tag"><i></i><em>Ready</em></div></div><div class="sl-toast" role="status"></div></div>' +
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
  spG = q('.sl-spg'); spI = q('.sl-spi'); spR = q('.sl-spr'); spImgs = [].slice.call(el.querySelectorAll('.sl-spi img')); toastEl = q('.sl-toast');
  dotsEl = q('.sl-dots'); cnt = q('.sl-cnt'); btnPlay = q('[data-c=play]'); intro = q('.sl-intro'); prog = q('.sl-prog i'); endEl = q('.sl-end');
  dotsEl.innerHTML = L.steps.map((s, i) => '<button type="button" class="sl-dot" data-i="' + i + '" aria-label="Go to step ' + (i + 1) + '"></button>').join('');
  imgs.forEach(i => { i.onerror = () => { i.style.display = 'none'; }; });
  Object.keys(FACE).forEach(k => { const p = new Image(); p.src = IMGDIR + FACE[k]; });   // preload the 4 faces
  Object.keys(SP).forEach(k => { const p = new Image(); p.src = IMGDIR + SP[k]; });   // and her Spectre's 6 faces, so the swap is instant
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
/* math helpers: Spectra sometimes writes $x$ in text rows, notes and captions */
const dl = t => String(t).replace(/(?<![\w$\\])\$(?!\s)([^$\n]{1,80}?)(?<!\s)\$(?![\w$])/g, (m, a) => '\\(' + a + '\\)');
const plain = t => String(t).replace(/(?<![\w$\\])\$(?!\s)([^$\n]{1,80}?)(?<!\s)\$(?![\w$])/g, '$1').replace(/\\[()\[\]]/g, '').replace(/\\(?:cdot)\b/g, '\u00b7').replace(/\\times\b/g, '\u00d7').replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2');
const TX = (n, v) => { if (/\$|\\[(\[]/.test(v) && window.renderMathInElement) { n.textContent = dl(v); try { window.renderMathInElement(n, { delimiters: [{ left: '$$', right: '$$', display: false }, { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: false }], throwOnError: false }); return; } catch (e) { } } n.textContent = plain(v); };
const eqv = v => String(v).trim().replace(/^\$\$?([\s\S]*?)\$\$?$/, '$1').replace(/^\\[(\[]([\s\S]*?)\\[)\]]$/, '$1');
const KM = { '\\blue': '\\htmlClass{sl-cb}{#1}', '\\pink': '\\htmlClass{sl-cp}{#1}', '\\green': '\\htmlClass{sl-cg}{#1}', '\\amber': '\\htmlClass{sl-ca}{#1}' };
const KT = (m, v) => { if (window.katex) { try { window.katex.render(v, m, { throwOnError: false, displayMode: false, macros: Object.assign({}, KM), trust: c => c.command === '\\htmlClass' && /^sl-c[bpga]$/.test(c.class || '') }); return; } catch (e) { } } m.textContent = v; };
/* fluid equations: the same id comes back = the row morphs. FLIP on the rendered KaTeX pieces: matched pieces glide, signs crossfade, new pieces fade in, old ones fade out. */
const SIGN = '+\u2212-\u00b1\u2213', vis = t => String(t).replace(/[\s\u200b]/g, '');
function leaves(m) {
  const root = m.querySelector('.katex-html'), out = [];
  if (root) root.querySelectorAll('*').forEach(n => { if (!n.children.length && vis(n.textContent)) out.push(n); });
  return out;
}
const colorOf = (n, m) => { for (let p = n; p && p !== m; p = p.parentNode) { const c = p.getAttribute && p.getAttribute('class'), k = c && c.match(/\bsl-c[bpga]\b/); if (k) return k[0]; } return ''; };
function matchLeaves(a, b) {   // a, b = [{t: text, c: color class}] in reading order
  const n = a.length, m = b.length, ka = a.map(x => x.t + '|' + x.c), kb = b.map(x => x.t + '|' + x.c);
  const dp = []; for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [], signs = [], ua = new Set(), ub = new Set(); a.forEach((_, i) => ua.add(i)); b.forEach((_, j) => ub.add(j));
  let i = 0, j = 0;
  while (i < n && j < m) { if (ka[i] === kb[j]) { pairs.push([i, j]); ua.delete(i); ub.delete(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  const near = (j2, ok) => { let best = -1, bd = 1e9; ua.forEach(i2 => { if (ok(a[i2])) { const d = Math.abs(i2 - j2); if (d < bd) { bd = d; best = i2; } } }); return best; };
  const isSign = x => x.t.length === 1 && SIGN.indexOf(x.t) >= 0;
  [...ub].sort((x, y) => x - y).forEach(j2 => { const i2 = near(j2, p => p.t === b[j2].t); if (i2 >= 0) { pairs.push([i2, j2]); ua.delete(i2); ub.delete(j2); } });   // same piece that moved to the other side of the equals sign
  [...ub].sort((x, y) => x - y).forEach(j2 => { if (!isSign(b[j2])) return; const i2 = near(j2, isSign); if (i2 >= 0) { signs.push([i2, j2]); ua.delete(i2); ub.delete(j2); } });   // + turning into - and so on
  return { pairs, signs, ua: [...ua], ub: [...ub] };
}
function morphEq(r, op, anim) {
  const m = r.querySelector('.sl-m'); if (!m) return; let nt = r.querySelector('.sl-n');
  const fin = () => {
    r.classList.toggle('hl', !!op.hl);
    if (op.note) { if (!nt) { nt = document.createElement('small'); nt.className = 'sl-n'; r.appendChild(nt); } TX(nt, op.note); } else if (nt) { nt.remove(); nt = null; }
  };
  if (!anim || !m.animate) { KT(m, eqv(op.v)); fin(); m.classList.add('mo'); return; }
  const A = leaves(m).map(n => ({ r: n.getBoundingClientRect(), t: vis(n.textContent), c: colorOf(n, m), fs: getComputedStyle(n).fontSize, h: n.cloneNode(true) }));   // snapshot the old pieces before they are replaced
  KT(m, eqv(op.v)); fin(); m.classList.add('mo', 'gl');
  const mr = m.getBoundingClientRect(), Bn = leaves(m), B = Bn.map(n => ({ r: n.getBoundingClientRect(), t: vis(n.textContent), c: colorOf(n, m) }));
  const R = matchLeaves(A, B), D = 950, E = 'cubic-bezier(.4,0,.2,1)', ghosts = [], moved = [];
  const gh = a => {   // a ghost of an old piece, so it can fade out where it used to be
    const g = document.createElement('span'), h = document.createElement('span'); g.className = 'katex sl-gh'; h.className = 'katex-html'; h.appendChild(a.h); g.appendChild(h);
    g.style.cssText = 'left:' + (a.r.left - mr.left) + 'px;top:' + (a.r.top - mr.top) + 'px;font-size:' + a.fs + ';line-height:' + a.r.height + 'px'; m.appendChild(g); ghosts.push(g); return g;
  };
  const from = (i, j) => ({ left: (A[i].r.left - B[j].r.left) + 'px', top: (A[i].r.top - B[j].r.top) + 'px' }), home = { left: '0px', top: '0px' };
  const go = (n, f, t) => { n.style.position = 'relative'; moved.push(n); n.animate([f, t], { duration: D, easing: E }); };
  R.pairs.forEach(([i, j]) => { const f = from(i, j); if (Math.abs(parseFloat(f.left)) < .5 && Math.abs(parseFloat(f.top)) < .5) return; go(Bn[j], f, home); });
  R.signs.forEach(([i, j]) => {
    go(Bn[j], Object.assign({ opacity: 0 }, from(i, j)), Object.assign({ opacity: 1 }, home));
    gh(A[i]).animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate(' + (B[j].r.left - A[i].r.left) + 'px,' + (B[j].r.top - A[i].r.top) + 'px)' }], { duration: D, easing: E, fill: 'forwards' });
  });
  R.ua.forEach(i => { gh(A[i]).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-in', fill: 'forwards' }); });
  R.ub.forEach(j => { Bn[j].animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: 380, easing: 'ease-out', fill: 'backwards' }); });
  m.classList.remove('fin');
  setTimeout(() => { ghosts.forEach(g => g.remove()); moved.forEach(n => { n.style.position = ''; }); m.classList.remove('gl'); if (op.hl) m.classList.add('fin'); }, D + 120);
}

/* board */
let focus = null, added = 0;
function mkRow(op, anim) {
  const r = document.createElement('div');
  r.className = 'sl-r ' + (op.t === 'eq' ? 'sl-eq' + (op.hl ? ' hl' : '') : op.t === 'text' ? 'sl-t' : 'sl-v') + (anim ? '' : ' ni');
  if (op.id) r.dataset.id = op.id;
  if (op.t === 'eq') {
    const m = document.createElement('span'); m.className = 'sl-m'; KT(m, eqv(op.v)); r.appendChild(m);
    if (op.note) { const n = document.createElement('small'); n.className = 'sl-n'; TX(n, op.note); r.appendChild(n); }
  } else if (op.t === 'text') TX(r, op.v);
  else { r.innerHTML = '<div class="ac-viz" data-v="' + esc(JSON.stringify(op.v)) + '"></div>'; }
  return r;
}
let sceneTok = 0;
const vtype = r => { try { const h = r.querySelector('.ac-viz'); return h ? String(JSON.parse(h.dataset.v).type) : ''; } catch (e) { return ''; } };
/* which new item takes over which old row (by id first, then in order); old rows nobody takes over fade out */
function planScene(ops, rows) {   // rows: [{id, kind: eq|viz|text, vt}]
  const wipe = ops.some(o => o.t === 'clear'); ops = ops.filter(o => o.t !== 'clear');
  const used = new Set(), pair = ops.map(() => -1);
  if (!wipe) {
    ops.forEach((op, n) => { if (op.id && (op.t === 'eq' || op.t === 'viz')) { const i = rows.findIndex((r, k) => !used.has(k) && r.id === op.id && r.kind === op.t); if (i >= 0) { used.add(i); pair[n] = i; } } });
    ops.forEach((op, n) => { if (pair[n] >= 0 || (op.t !== 'eq' && op.t !== 'viz')) return; const i = rows.findIndex((r, k) => !used.has(k) && r.kind === op.t && (op.t === 'eq' || r.vt === op.v.type)); if (i >= 0) { used.add(i); pair[n] = i; } });
  }
  return { ops, pair, gone: rows.map((_, k) => k).filter(k => !used.has(k)) };
}
function place(op, ex, anim) {   // ex = the old row this item turns into (or null = a new row)
  if (ex) {
    if (op.id) ex.dataset.id = op.id;
    if (op.t === 'eq') { morphEq(ex, op, anim); focus = ex; return; }
    if (op.t === 'viz') { const h = ex.querySelector('.ac-viz'); if (anim && h && window.SpectraViz && window.SpectraViz.morph && window.SpectraViz.morph(h, op.v, { dur: 1.4 })) { focus = ex; return; } }
  }
  const r = mkRow(op, anim);
  if (ex) ex.replaceWith(r); else { board.appendChild(r); if (anim) added++; }
  // shapes and graphs build themselves (slower than in chat, to match the narration); rebuilds after a jump show them finished
  if (op.t === 'viz' && window.SpectraViz) { try { window.SpectraViz.mount(r, { always: !!anim, still: !anim, now: true, speed: .8, static: true }); } catch (e) { } }
}
function leave(r, anim) {
  r.dataset.gone = '1';
  if (!anim || !r.animate) { r.remove(); return; }
  r.style.pointerEvents = 'none';
  r.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 340, easing: 'ease-in', fill: 'forwards' });
  setTimeout(() => r.remove(), 360);
}
function scene(ops0, anim) {   // one step = one scene. No items = the scene stays as it is.
  if (!ops0.length) return;
  focus = null; added = 0;
  const rows = [].slice.call(board.children).filter(r => !r.dataset.gone);
  const P = planScene(ops0, rows.map(r => ({ id: r.dataset.id || '', kind: r.classList.contains('sl-eq') ? 'eq' : r.classList.contains('sl-v') ? 'viz' : 'text', vt: vtype(r) })));
  const my = ++sceneTok, mv = [], fr = [];
  P.ops.forEach((op, n) => (P.pair[n] >= 0 ? mv : fr).push([op, rows[P.pair[n]]]));
  mv.forEach(x => place(x[0], x[1], anim));            // what carries over moves right away
  P.gone.forEach(k => leave(rows[k], anim));           // what does not fades out
  const add = () => {
    if (my !== sceneTok || !board.isConnected) return;
    fr.forEach(x => place(x[0], null, anim));          // brand-new items fade in once the old ones are gone
    if (anim) { if (focus && !added && focus.isConnected) focus.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); else board.scrollTo({ top: board.scrollHeight, behavior: 'smooth' }); }
  };
  if (anim && P.gone.length && fr.length) setTimeout(add, 380); else add();
}
function renderTo(i, anim) {
  for (let k = shown + 1; k <= i && k < L.steps.length; k++) scene(L.steps[k].show, anim && k === i);
  shown = Math.max(shown, i);
  if (!anim) board.scrollTo({ top: board.scrollHeight, behavior: 'auto' });
}
function rebuild(i) { sceneTok++; board.innerHTML = ''; shown = -1; if (i > 0) renderTo(i - 1, false); done = false; }

/* face, subtitles (words light up as she says them), controls */
function face(mood) {
  if (spk === 'spectre') return;   // she is muted behind her Spectre: keep her face still
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
  kStop(); subEl.innerHTML = plain(t).split(/(\s+)/).map(w => w && !/^\s+$/.test(w) ? '<span>' + esc(w) + '</span>' : w).join('');
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
  if (spk === 'spectre') {   // Spectra is muted: her Spectre's ring, glow and body follow the voice instead
    pulse.style.transform = ''; ring.style.opacity = '0'; glow.style.opacity = '0';
    spI.style.transform = 'scale(' + (1 + lv * .07).toFixed(3) + ')';
    spR.style.opacity = Math.min(1, lv * 2.2 + (speaking ? .25 : 0)).toFixed(2); spR.style.transform = 'scale(' + (1 + lv * .1).toFixed(3) + ')';
    spG.style.opacity = Math.min(.95, (speaking ? .34 : .16) + lv * 1.5).toFixed(2); spG.style.transform = 'scale(' + (1 + lv * .3).toFixed(3) + ')';
    spFace();
  } else {
    pulse.style.transform = 'scale(' + (1 + lv * .09).toFixed(3) + ')';
    ring.style.opacity = Math.min(1, lv * 2.2 + (speaking ? .25 : 0)).toFixed(2); ring.style.transform = 'scale(' + (1 + lv * .12).toFixed(3) + ')';
    glow.style.opacity = Math.min(.95, (speaking ? .34 : .16) + lv * 1.5).toFixed(2); glow.style.transform = 'scale(' + (1 + lv * .3).toFixed(3) + ')';
  }
  status();
}

/* her Spectre: takes over when Spectra's voice is busy/out. The voice layer calls takeover() before every line. */
function spWant() {   // which Spectre face fits right now
  if (boot) return 'power';                                   // booting up as it takes over from Spectra
  if (done) return 'sparkle';                                 // lesson finished
  if (started && !playing) return 'pause';                    // you paused
  if (pfp.classList.contains('ld')) return 'loading';         // getting the voice ready
  const st = L.steps[idx]; if (!st) return 'happy';
  return idx === L.steps.length - 1 ? 'sparkle' : (SPM[st.mood] || 'happy');   // final answer and excited moments sparkle, thinking moments get the lightbulb
}
function spFace() {
  let k = spWant(); if (spBad[k]) k = spBad.happy ? '' : 'happy';   // a face that will not load: use the happy one instead
  if (k === spc) return; spc = k;
  const box = spImgs[0].parentNode.parentNode; box.classList.toggle('err', !k);   // plain orb only if even the happy face is missing
  if (!k) return;
  const on = spImgs[0].classList.contains('on') ? spImgs[1] : spImgs[0], off = on === spImgs[0] ? spImgs[1] : spImgs[0];
  on.onload = () => box.classList.remove('err');
  on.onerror = () => { if (!on.dataset.r) { on.dataset.r = '1'; on.src = IMGDIR + SP[k] + '?r=' + Date.now(); return; } spBad[k] = true; spc = ''; };   // retry once, then give up on that face (next frame picks the fallback)
  on.dataset.r = ''; on.style.display = ''; on.src = IMGDIR + SP[k]; on.classList.add('on'); off.classList.remove('on');
}
function toast(msg) {
  if (!toastEl || !msg) return; clearTimeout(toastT);
  toastEl.textContent = msg; toastEl.classList.remove('on'); void toastEl.offsetWidth; toastEl.classList.add('on');
  toastT = setTimeout(() => { if (toastEl) toastEl.classList.remove('on'); }, 5600);
}
function takeover(who, why) {
  if (!el) return;
  if (who !== 'spectre') {   // a clip that was already loaded in Spectra's voice: she is back
    if (spk === 'spectre') { spk = 'spectra'; spc = ''; pfp.classList.remove('sp', 'boot'); }
    return;
  }
  if (spk === 'spectre') return;                                  // sticky: already on the Spectre
  if (why === 'chosen' && !SPECTRE_ON_FREE_VOICE) return;
  const e = el; spk = 'spectre'; boot = 1; spc = ''; spFace(); pfp.classList.add('sp', 'boot');
  if (why !== 'chosen') toast(WHY[why] || WHY.busy);
  return new Promise(r => setTimeout(() => { boot = 0; if (el === e) pfp.classList.remove('boot'); r(); }, 1150));   // the voice waits for the boot-up
}

/* playback */
async function speak(st, my) {
  const v = V(), t0 = Date.now(), floor = Math.max(2200, st.say.length * 55), ms = Math.max(1800, st.say.length * 58);
  if (eng === 'silent' || !v || !v.play) { kStart(my, floor); await wait(floor); fin(my); return; }
  speaking = false; pfp.classList.add('ld');
  try { await v.play('[mood:' + st.mood + '] ' + st.say, { engine: eng, speaker: spk === 'spectre' ? 'spectre' : 'auto', onWho: takeover, onStart: () => { if (my === tok) { speaking = true; pfp.classList.remove('ld'); kStart(my, ms); } } }); } catch (e) { }
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
    const nx = L.steps[i + 1]; if (nx && eng === 'gemini' && V() && V().prefetch) V().prefetch('[mood:' + nx.mood + '] ' + nx.say, 'gemini', spk === 'spectre' ? 'spectre' : 'auto');   // next clip loads while she talks
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
