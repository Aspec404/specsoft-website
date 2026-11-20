/* SPECSOFT® Spectra Stepper v1 (Math & LaTeX Interactive Stepper for Spectra Academics).
   Spectra writes a ```stepper block (one JSON object) and this draws it: sliders for the variables, the equation lines
   re-written live with KaTeX as you drag, an optional graph that moves with the sliders, and a "Next step" button that
   reveals the lines one at a time. No eval anywhere: formulas go through a tiny safe parser, every number is clamped,
   every label is escaped. Needs KaTeX (already on the page). API: SpectraStepper.mount(root)

   JSON shape:
   { "title": "Straight line",
     "vars": [ { "n": "m", "label": "slope m", "min": -5, "max": 5, "step": 0.5, "v": 2 }, { "n": "b", "min": -5, "max": 5, "step": 1, "v": 1 } ],
     "lines": [ "# Start with the rule", "y = {{m}}x {{+b}}", "# At x = 3", "y = {{(m)}}(3) {{+b}} = {{=m*3+b}}" ],
     "graph": "m*x+b", "graph2": "optional second formula", "xmin": -6, "xmax": 6, "ymin": -10, "ymax": 10 }
   Placeholders in lines: {{m}} the value, {{(m)}} the value in ( ) when negative, {{+b}} signed ("+ 3" or "- 3"), {{=m*3+b}} a computed result ({{=expr|2}} = 2 decimals).
   A line starting with "# " is a short plain-text caption. Variable names are single letters a-z. */
(function () {
'use strict';
const W = 360, H = 230;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v * 10) / 10;
let uid = 0;

(function () {
  const st = document.createElement('style');
  st.textContent =
    '.ac-stp{max-width:440px;margin:12px 0 18px;padding:10px 12px 12px;border:1px solid var(--line);border-radius:16px;background:var(--soft);box-shadow:0 10px 30px -16px rgba(0,0,0,.4);animation:stpin .45s cubic-bezier(.2,.9,.3,1.1)}' +
    '@keyframes stpin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '.ac-stp.ld{display:flex;align-items:center;gap:10px;padding:14px;color:var(--ink2);font-size:13px}' +
    '.stp-g{margin-top:2px}' +
    '.stp-eq{margin-top:10px;padding-top:6px;border-top:1px solid var(--line)}' +
    '.stp-l{overflow-x:auto;overflow-y:hidden;padding:0 2px;animation:stpin .35s ease-out}' +
    '.stp-l[hidden]{display:none}' +
    '.stp-l .katex-display{margin:6px 0;text-align:left}.stp-l .katex-display>.katex{text-align:left}' +
    '.stp-l .katex{font-size:1.08em}' +
    '.stp-n{margin:8px 0 0;color:var(--ink2);font:600 11.5px/1.5 Inter,sans-serif;letter-spacing:.01em}.stp-n[hidden]{display:none}' +
    '.stp-bar{display:flex;gap:8px;margin-top:10px}' +
    '.stp-bar button{border:1px solid var(--line);border-radius:99px;background:var(--card);color:var(--ink);font:600 12px Inter,sans-serif;padding:6px 14px;cursor:pointer;transition:background .15s,transform .1s}' +
    '.stp-bar button:hover{border-color:var(--ink2)}.stp-bar button:active{transform:scale(.96)}' +
    '.stp-bar button.go{background:var(--acc);color:var(--onacc);border-color:transparent}' +
    '.stp-bar[hidden]{display:none}' +
    '@media (prefers-reduced-motion:reduce){.ac-stp,.stp-l{animation:none}}';
  document.head.appendChild(st);
})();

/* ---------- safe formula parser: your variables, x, pi, e, numbers, + - * / ^, parentheses, a few functions ---------- */
const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, sign: Math.sign, cbrt: Math.cbrt };
const CONST = { pi: Math.PI, e: Math.E };
function compile(src, names) {   // returns f(env) -> number, or throws
  src = String(src).slice(0, 90).toLowerCase().replace(/\*\*/g, '^').replace(/\s+/g, '');
  const toks = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[0-9.]/.test(ch)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; const n = parseFloat(src.slice(i, j)); if (!isFinite(n)) throw 0; toks.push({ t: 'n', v: n }); i = j; }
    else if (/[a-z]/.test(ch)) {
      let j = i; while (j < src.length && /[a-z]/.test(src[j])) j++;
      const w = src.slice(i, j);
      if (FN[w] || CONST[w] || names.includes(w)) toks.push({ t: 'i', v: w });
      else if ([...w].every(c => names.includes(c) || c === 'e')) [...w].forEach(c => toks.push({ t: 'i', v: c }));   // "mx" = m * x
      else throw 0;
      i = j;
    }
    else if ('+-*/^()'.indexOf(ch) >= 0) { toks.push({ t: ch }); i++; }
    else throw 0;
  }
  let p = 0; const peek = () => toks[p] && toks[p].t, next = () => toks[p++];
  const expr = () => { let l = term(); while (peek() === '+' || peek() === '-') { const o = next().t, r = term(), a = l; l = o === '+' ? en => a(en) + r(en) : en => a(en) - r(en); } return l; };
  const term = () => {
    let l = unary();
    for (; ;) {
      const t = peek(), a = l;
      if (t === '*' || t === '/') { next(); const r = unary(); l = t === '*' ? en => a(en) * r(en) : en => a(en) / r(en); }
      else if (t === 'n' || t === 'i' || t === '(') { const r = unary(); l = en => a(en) * r(en); }
      else return l;
    }
  };
  const unary = () => { if (peek() === '-') { next(); const v = unary(); return en => -v(en); } if (peek() === '+') { next(); return unary(); } return power(); };
  const power = () => { const b = primary(); if (peek() === '^') { next(); const e = unary(); return en => Math.pow(b(en), e(en)); } return b; };
  const primary = () => {
    const t = next(); if (!t) throw 0;
    if (t.t === 'n') { const v = t.v; return () => v; }
    if (t.t === '(') { const e = expr(), c = next(); if (!c || c.t !== ')') throw 0; return e; }
    if (t.t === 'i') {
      const w = t.v;
      if (names.includes(w)) return en => en[w];   // your own variables win over pi and e
      if (CONST[w] != null) { const v = CONST[w]; return () => v; }
      if (FN[w]) { const c = next(); if (!c || c.t !== '(') throw 0; const a = expr(), d = next(); if (!d || d.t !== ')') throw 0; const fn = FN[w]; return en => fn(a(en)); }
    }
    throw 0;
  };
  const f = expr(); if (p !== toks.length) throw 0; return f;
}
const cNum = (v, d) => { if (typeof v === 'number' && isFinite(v)) return v; if (typeof v === 'string') { try { const r = compile(v, [])({}); if (isFinite(r)) return r; } catch (e) { } } return d; };

/* ---------- numbers and placeholders ---------- */
const nf = (v, d) => {
  if (!isFinite(v)) return '\\text{undefined}';
  if (Math.abs(v) < 5e-10) v = 0;
  const s = String(+v.toFixed(d == null ? 3 : d));
  return /e/i.test(s) ? v.toFixed(d == null ? 3 : d) : s;
};
const PH = /\{\{\s*([^{}]{1,70}?)\s*\}\}/g;
function fill(tpl, env, names, cache) {
  return tpl.replace(PH, (m, k) => {
    if (k[0] === '=') {
      let ex = k.slice(1), d = null; const bar = ex.lastIndexOf('|');
      if (bar >= 0) { d = Math.round(+ex.slice(bar + 1)); ex = ex.slice(0, bar); d = isFinite(d) ? clamp(d, 0, 6) : null; }
      let f = cache.get(ex); if (f === undefined) { try { f = compile(ex, names); } catch (e) { f = null; } cache.set(ex, f); }
      if (!f) return '?';
      let y; try { y = f(env); } catch (e) { y = NaN; } return nf(y, d);
    }
    let sign = false, par = false, n = k;
    if (n[0] === '+') { sign = true; n = n.slice(1); }
    if (n[0] === '(' && n.slice(-1) === ')') { par = true; n = n.slice(1, -1); }
    n = n.trim().toLowerCase();
    if (!names.includes(n)) return '?';
    const v = env[n];
    if (sign) return (v < 0 ? '- ' : '+ ') + nf(Math.abs(v));
    if (par && v < 0) return '(' + nf(v) + ')';
    return nf(v);
  });
}
const kx = tex => {
  if (window.katex) { try { return window.katex.renderToString(tex, { throwOnError: false, displayMode: true, strict: 'ignore', trust: false, maxSize: 20, maxExpand: 200 }); } catch (e) { } }
  return '<code>' + esc(tex) + '</code>';
};

/* ---------- read and clean the JSON ---------- */
function model(s) {
  if (!s || typeof s !== 'object') return null;
  const vars = [], names = [];
  (Array.isArray(s.vars) ? s.vars : []).slice(0, 4).forEach(v => {
    if (!v || typeof v !== 'object') return;
    const n = String(v.n || '').trim().toLowerCase(); if (!/^[a-z]$/.test(n) || names.includes(n)) return;
    let a = cNum(v.min, null), b = cNum(v.max, null); if (a == null || b == null) return;
    a = clamp(a, -1e4, 1e4); b = clamp(b, -1e4, 1e4); if (!(b > a)) return;
    let st = cNum(v.step, 0); if (!(st > 0)) st = (b - a) / 100; st = Math.max(st, (b - a) / 2000);
    const val = clamp(cNum(v.v != null ? v.v : v.val, (a + b) / 2), a, b);
    vars.push({ n, label: String(v.label || n).slice(0, 26), min: a, max: b, step: st, val });
    names.push(n);
  });
  if (!vars.length) return null;
  const lines = (Array.isArray(s.lines) ? s.lines : []).filter(l => typeof l === 'string' && l.trim()).slice(0, 8).map(l => l.slice(0, 220));
  if (!lines.length) return null;
  const gnames = names.includes('x') ? names : names.concat('x'), fns = [];
  [s.graph, s.graph2].filter(v => typeof v === 'string' && v.trim()).slice(0, 2).forEach(src => { try { fns.push({ src: String(src).slice(0, 60), f: compile(src, gnames) }); } catch (e) { } });
  return { title: String(s.title || 'Interactive math').slice(0, 50), vars, names, lines, fns, gnames, s };
}

/* ---------- the graph (fixed window, so the curve visibly moves when a slider moves) ---------- */
const gNice = (span, cnt) => { const raw = span / cnt, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
const gTk = (a, b, st) => { const o = []; for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9 && o.length < 14; v += st) o.push(+v.toFixed(10)); return o; };
const tickTxt = v => { if (Math.abs(v) < 5e-10) v = 0; return String(+v.toFixed(4)); };
function graphSetup(M) {
  if (!M.fns.length) return null;
  const s = M.s; let x0 = cNum(s.xmin, -10), x1 = cNum(s.xmax, 10); x0 = Math.max(x0, -1e4); x1 = Math.min(x1, 1e4); if (!(x1 - x0 > 1e-6)) { x0 = -10; x1 = 10; }
  let lo = cNum(s.ymin, null), hi = cNum(s.ymax, null);
  const env = {}, ys = [0];
  if (lo == null || hi == null) {   // find a window that fits the curve around the starting values and half way out to each end of the sliders (the curve may leave the window at the extremes, like a real graph)
    const others = M.vars.filter(v => v.n !== 'x'), combos = [{}];
    others.forEach(v => { const nx = []; combos.forEach(c => [v.val, v.val + (v.min - v.val) / 2, v.val + (v.max - v.val) / 2].forEach(val => nx.push(Object.assign({}, c, { [v.n]: val })))); combos.length = 0; nx.forEach(c => combos.push(c)); });
    combos.forEach(c => { Object.assign(env, c); M.fns.forEach(g => { for (let i = 0; i <= 60; i++) { env.x = x0 + (x1 - x0) * i / 60; let y; try { y = g.f(env); } catch (e) { y = NaN; } if (isFinite(y) && Math.abs(y) < 1e6) ys.push(y); } }); });
    ys.sort((a, b) => a - b);
    if (lo == null) lo = ys[Math.floor(ys.length * .02)]; if (hi == null) hi = ys[Math.min(ys.length - 1, Math.ceil(ys.length * .98))];
  }
  if (!(hi > lo)) { lo -= 1; hi += 1; } const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  return { x0, x1, lo, hi, id: 'stpc' + (++uid) };
}
function graphSvg(M, G, env) {
  const PX0 = 44, PX1 = 346, PY0 = 12, PY1 = 206, { x0, x1, lo, hi, id } = G;
  const mx = x => PX0 + (x - x0) / (x1 - x0) * (PX1 - PX0), my = y => PY1 - (y - lo) / (hi - lo) * (PY1 - PY0);
  const ax = x0 < 0 && x1 > 0 ? mx(0) : PX0, ay = lo < 0 && hi > 0 ? my(0) : PY1;
  let o = '<defs><clipPath id="' + id + '"><rect x="' + PX0 + '" y="' + PY0 + '" width="' + (PX1 - PX0) + '" height="' + (PY1 - PY0) + '"/></clipPath></defs>';
  gTk(x0, x1, gNice(x1 - x0, 6)).forEach(t => { o += '<line class="v-gl" x1="' + r1(mx(t)) + '" y1="' + PY0 + '" x2="' + r1(mx(t)) + '" y2="' + PY1 + '"/>'; if (Math.abs(t) > 1e-9 || ax === PX0) o += '<text class="v-t v-s" x="' + r1(mx(t)) + '" y="' + r1(Math.min(ay + 13, 224)) + '" text-anchor="middle">' + esc(tickTxt(t)) + '</text>'; });
  gTk(lo, hi, gNice(hi - lo, 5)).forEach(t => { o += '<line class="v-gl" x1="' + PX0 + '" y1="' + r1(my(t)) + '" x2="' + PX1 + '" y2="' + r1(my(t)) + '"/>'; if (Math.abs(t) > 1e-9 || ay === PY1) o += '<text class="v-t v-s" x="' + r1(ax - 5) + '" y="' + r1(my(t) + 3.5) + '" text-anchor="end">' + esc(tickTxt(t)) + '</text>'; });
  o += '<line class="v-ax" x1="' + PX0 + '" y1="' + r1(ay) + '" x2="' + PX1 + '" y2="' + r1(ay) + '"/><line class="v-ax" x1="' + r1(ax) + '" y1="' + PY0 + '" x2="' + r1(ax) + '" y2="' + PY1 + '"/>';
  const N = 240, e2 = Object.assign({}, env), hasX = M.names.includes('x');
  M.fns.forEach((g, k) => {
    let d = '', pen = false, prev = null;
    for (let i = 0; i <= N; i++) {
      const x = x0 + (x1 - x0) * i / N; e2.x = x; let y; try { y = g.f(e2); } catch (e) { y = NaN; }
      if (!isFinite(y)) { pen = false; prev = null; continue; }
      const px = mx(x), py = my(y); if (py < PY0 - 400 || py > PY1 + 400) { pen = false; prev = null; continue; }
      if (prev !== null && Math.abs(py - prev) > (PY1 - PY0) * 1.5) pen = false;
      d += (pen ? 'L' : 'M') + r1(px) + ' ' + r1(py); pen = true; prev = py;
    }
    o += '<path class="v-d ' + (k ? 'v-c2' : 'v-c1') + '" clip-path="url(#' + id + ')" d="' + d + '"/>';
  });
  if (hasX && env.x >= x0 && env.x <= x1) {   // a variable named x = a marked point on the first curve
    let y; try { y = M.fns[0].f(env); } catch (e) { y = NaN; }
    if (isFinite(y) && my(y) >= PY0 - 2 && my(y) <= PY1 + 2) o += '<line class="v-g" x1="' + r1(mx(env.x)) + '" y1="' + r1(my(y)) + '" x2="' + r1(mx(env.x)) + '" y2="' + r1(ay) + '"/><line class="v-g" x1="' + r1(ax) + '" y1="' + r1(my(y)) + '" x2="' + r1(mx(env.x)) + '" y2="' + r1(my(y)) + '"/><circle class="v-dot v-dc1" cx="' + r1(mx(env.x)) + '" cy="' + r1(my(y)) + '" r="4.8"/>';
  }
  return o;
}

/* ---------- mount ---------- */
function mount(host) {
  if (host.dataset.m) return; host.dataset.m = '1';
  let spec; try { spec = JSON.parse(host.dataset.v); } catch (e) { host.remove(); return; }
  const M = model(spec); if (!M) { host.remove(); return; }
  const G = graphSetup(M), cache = new Map(), env = {}, V0 = {};
  M.vars.forEach(v => { env[v.n] = V0[v.n] = v.val; });
  /* a "step" = any captions (# ...) plus the equation line that follows them; Next step reveals one step at a time */
  const isCap = l => /^\s*#/.test(l), ends = []; M.lines.forEach((l, i) => { if (!isCap(l) || i === M.lines.length - 1) ends.push(i + 1); });
  if (ends[ends.length - 1] !== M.lines.length) ends.push(M.lines.length);
  let shown = 1, tries = 0, raf = 0;
  host.classList.remove('ld');
  host.setAttribute('role', 'group'); host.setAttribute('aria-label', M.title);
  host.innerHTML =
    '<div class="vz-h"><b>' + esc(M.title) + '</b><button class="vz-re" type="button" data-a="reset">Reset</button></div>' +
    (G ? '<svg class="vz-svg stp-g" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(M.title) + ' graph"></svg>' : '') +
    '<div class="vz-c">' + M.vars.map(v => '<label class="vz-s"><span>' + esc(v.label) + '</span><input type="range" min="' + v.min + '" max="' + v.max + '" step="' + v.step + '" value="' + v.val + '" data-k="' + v.n + '"><output>' + esc(nf(v.val, 2)) + '</output></label>').join('') + '</div>' +
    '<div class="stp-eq" aria-live="polite"></div>' +
    '<div class="stp-bar"' + (ends.length > 1 ? '' : ' hidden') + '><button type="button" class="go" data-a="next">Next step</button><button type="button" data-a="all">Show all</button></div>';
  const svg = host.querySelector('svg'), eq = host.querySelector('.stp-eq'), bar = host.querySelector('.stp-bar'), cb = host.querySelector('.vz-c');
  const render = () => {
    raf = 0;
    if (svg) svg.innerHTML = graphSvg(M, G, env);
    const old = eq.children.length === M.lines.length;
    if (!old) eq.innerHTML = M.lines.map(l => isCap(l) ? '<div class="stp-n"></div>' : '<div class="stp-l"></div>').join('');
    M.lines.forEach((l, i) => {
      const el = eq.children[i], t = fill(isCap(l) ? l.replace(/^\s*#+\s*/, '') : l, env, M.names, cache);
      if (isCap(l)) el.textContent = t; else el.innerHTML = kx(t);
      const hid = i >= ends[shown - 1]; if (el.hidden !== hid) el.hidden = hid;
    });
    const next = bar.querySelector('[data-a="next"]'), all = bar.querySelector('[data-a="all"]'), done = shown >= ends.length;
    next.hidden = done; all.hidden = done;
    bar.hidden = ends.length < 2 || done;
    if (!window.katex && tries++ < 12) setTimeout(() => { if (host.isConnected) { eq.innerHTML = ''; render(); } }, 350);   // KaTeX is still loading: try again shortly
  };
  const draw = () => { if (!raf) raf = requestAnimationFrame(render); };
  cb.addEventListener('input', e => {
    const i = e.target.closest('input'); if (!i) return;
    const v = M.vars.find(x => x.n === i.dataset.k); if (!v) return;
    env[v.n] = +i.value; i.nextElementSibling.textContent = nf(+i.value, 2); draw();
  });
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'next') { shown = Math.min(ends.length, shown + 1); render(); }
    else if (a === 'all') { shown = ends.length; render(); }
    else if (a === 'reset') { M.vars.forEach(v => { env[v.n] = V0[v.n]; const i = cb.querySelector('[data-k="' + v.n + '"]'); if (i) { i.value = V0[v.n]; i.nextElementSibling.textContent = nf(V0[v.n], 2); } }); shown = 1; render(); }
  });
  render();
}
window.SpectraStepper = { mount: root => (root || document).querySelectorAll('.ac-stp[data-v]').forEach(mount) };
})();
