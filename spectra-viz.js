/* SPECSOFT® Spectra Viz v3 (Batch C: SpectraViz.morph = same id glides one graph or shape into the next; v2: smooth pop-in, glowing curve tracer, auto demo sweep of the first slider). v1: Spectra writes a ```viz block (one line of JSON) and this draws it as an interactive
   illustration that assembles slowly, piece by piece. No eval anywhere: graph formulas go through a tiny safe parser,
   every number is clamped and every label is escaped. Types: triangle, pythagoras, unitcircle, circle, polygon, graph. */
(function () {
'use strict';
const W = 360, H = 260, RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d, a, b) => { v = +v; if (!isFinite(v)) v = d; return Math.min(b, Math.max(a, v)); };
const r1 = v => Math.round(v * 10) / 10;
const fx = (v, n) => { if (!isFinite(v)) return 'undefined'; if (Math.abs(v) < 5e-10) v = 0; return String(+v.toFixed(n == null ? 3 : n)); };
const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
const radTxt = d => { d = Math.round(d); if (d === 0) return '0'; const g = gcd(d, 180), n = d / g, m = 180 / g; return (n === 1 ? '' : n) + '\u03c0' + (m === 1 ? '' : '/' + m); };
const seen = new Set(); let uid = 0, NS = 'http://www.w3.org/2000/svg';
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
(function () {
  const st = document.createElement('style');
  st.textContent = '.vz-svg [data-st]{transform-box:fill-box;transform-origin:center}' +
    '.vz-tr{fill:var(--v1);filter:drop-shadow(0 0 6px var(--v1));pointer-events:none}.vz-tr.c2{fill:var(--v2);filter:drop-shadow(0 0 6px var(--v2))}' +
    '.ac-viz{transition:box-shadow .3s,border-color .3s}.vz-s input{cursor:pointer}.vz-static .vz-c,.vz-static .vz-re{display:none}.vz-static .vz-svg{pointer-events:none}';
  document.head.appendChild(st);
})();

/* ---------- safe formula parser: x, pi, e, numbers, + - * / ^, parentheses, a few functions ---------- */
const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, sign: Math.sign, cbrt: Math.cbrt, sec: v => 1 / Math.cos(v), csc: v => 1 / Math.sin(v), cot: v => 1 / Math.tan(v) };
function compile(src) {
  src = String(src).slice(0, 90).toLowerCase().replace(/\*\*/g, '^').replace(/\s+/g, '');
  const toks = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[0-9.]/.test(ch)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; const n = parseFloat(src.slice(i, j)); if (!isFinite(n)) throw 0; toks.push({ t: 'n', v: n }); i = j; }
    else if (/[a-z]/.test(ch)) { let j = i; while (j < src.length && /[a-z]/.test(src[j])) j++; toks.push({ t: 'i', v: src.slice(i, j) }); i = j; }
    else if ('+-*/^()'.indexOf(ch) >= 0) { toks.push({ t: ch }); i++; }
    else throw 0;
  }
  let p = 0; const peek = () => toks[p] && toks[p].t, next = () => toks[p++];
  const expr = () => { let l = term(); while (peek() === '+' || peek() === '-') { const o = next().t, r = term(), a = l; l = o === '+' ? x => a(x) + r(x) : x => a(x) - r(x); } return l; };
  const term = () => {
    let l = unary();
    for (; ;) {
      const t = peek(), a = l;
      if (t === '*' || t === '/') { next(); const r = unary(); l = t === '*' ? x => a(x) * r(x) : x => a(x) / r(x); }
      else if (t === 'n' || t === 'i' || t === '(') { const r = unary(); l = x => a(x) * r(x); }
      else return l;
    }
  };
  const unary = () => { if (peek() === '-') { next(); const v = unary(); return x => -v(x); } if (peek() === '+') { next(); return unary(); } return power(); };
  const power = () => { const b = primary(); if (peek() === '^') { next(); const e = unary(); return x => Math.pow(b(x), e(x)); } return b; };
  const primary = () => {
    const t = next(); if (!t) throw 0;
    if (t.t === 'n') { const v = t.v; return () => v; }
    if (t.t === '(') { const e = expr(), c = next(); if (!c || c.t !== ')') throw 0; return e; }
    if (t.t === 'i') {
      if (t.v === 'x') return x => x; if (t.v === 'pi') return () => Math.PI; if (t.v === 'e') return () => Math.E;
      if (FN[t.v]) { const c = next(); if (!c || c.t !== '(') throw 0; const a = expr(), d = next(); if (!d || d.t !== ')') throw 0; const fn = FN[t.v]; return x => fn(a(x)); }
    }
    throw 0;
  };
  const fnc = expr(); if (p !== toks.length) throw 0; return fnc;
}
const cv = (v, d) => { if (typeof v === 'number' && isFinite(v)) return v; if (typeof v === 'string') { try { const r = compile(v)(0); if (isFinite(r)) return r; } catch (e) { } } return d; };

/* ---------- svg bits. data-st = assembly step (the order things appear); v-d pieces draw themselves, the rest fade in ---------- */
const Ln = (x1, y1, x2, y2, st, c) => '<line class="v-d ' + (c || '') + '" data-st="' + st + '" x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '"/>';
const Gl = (x1, y1, x2, y2, st) => '<line class="v-gl" data-st="' + st + '" x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '"/>';
const Tx = (x, y, s, st, c, an) => '<text class="v-t ' + (c || '') + '" data-st="' + st + '" x="' + r1(x) + '" y="' + r1(y) + '"' + (an ? ' text-anchor="' + an + '"' : '') + '>' + esc(s) + '</text>';
const Ci = (cx, cy, r, st, c) => '<circle class="v-d ' + (c || '') + '" data-st="' + st + '" cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(r) + '"/>';
const Dt = (cx, cy, r, st, c) => '<circle class="v-dot ' + (c || '') + '" data-st="' + st + '" cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(r) + '"/>';
const Pa = (d, st, c, clip) => '<path class="v-d ' + (c || '') + '" data-st="' + st + '"' + (clip ? ' clip-path="url(#' + clip + ')"' : '') + ' d="' + d + '"/>';
const Pg = (pts, st, c, outline) => '<polygon class="' + (outline ? 'v-d ' : 'v-f ') + (c || '') + '" data-st="' + st + '" points="' + pts.map(p => r1(p[0]) + ',' + r1(p[1])).join(' ') + '"/>';

/* ---------- widgets ---------- */
function wTriangle(s) {
  const a0 = Math.round(num(s.angle, 35, 5, 85));
  return {
    title: 'Right triangle', ctl: [{ id: 'a', label: 'Angle \u03b8', min: 5, max: 85, step: 1, val: a0, fmt: v => v + '\u00b0' }],
    draw(p) {
      const t = p.a * Math.PI / 180, co = Math.cos(t), si = Math.sin(t), L = 190, x0 = 64, y0 = 228, bx = L * co, by = L * si, bX = x0 + bx, cY = y0 - by;
      let o = Ln(x0, y0, bX, y0, 1, 'v-c1') + Ln(bX, y0, bX, cY, 2, 'v-c2') + Ln(bX, cY, x0, y0, 3, '');
      o += Pa('M' + r1(bX - 12) + ' ' + y0 + 'L' + r1(bX - 12) + ' ' + (y0 - 12) + 'L' + r1(bX) + ' ' + (y0 - 12), 4, 'v-m');
      o += Pa('M' + r1(x0 + 34) + ' ' + y0 + 'A34 34 0 0 0 ' + r1(x0 + 34 * co) + ' ' + r1(y0 - 34 * si), 5, 'v-m');
      o += Tx(x0 + 58 * Math.cos(t / 2), Math.min(y0 - 8, y0 - 58 * Math.sin(t / 2) + 4), '\u03b8', 5.5, '');
      o += Tx((x0 + bX) / 2, y0 + 18, 'adjacent', 6, 'v-tc1', 'middle') + Tx(bX + 10, (y0 + cY) / 2 + 4, 'opposite', 6, 'v-tc2') + Tx((x0 + bX) / 2 - 10, (y0 + cY) / 2 - 8, 'hypotenuse', 6, '', 'end');
      return { svg: o, info: [
        '<span class="vz-k2">sin \u03b8</span> = opposite \u00f7 hypotenuse = <b>' + fx(si) + '</b>',
        '<span class="vz-k1">cos \u03b8</span> = adjacent \u00f7 hypotenuse = <b>' + fx(co) + '</b>',
        'tan \u03b8 = opposite \u00f7 adjacent = <b>' + fx(si / co) + '</b>'] };
    }
  };
}
function wPyth(s) {
  const a0 = Math.round(num(s.a, 3, 1, 12)), b0 = Math.round(num(s.b, 4, 1, 12));
  return {
    title: 'Pythagorean theorem', ctl: [{ id: 'a', label: 'Side a', min: 1, max: 12, step: 1, val: a0, fmt: v => v }, { id: 'b', label: 'Side b', min: 1, max: 12, step: 1, val: b0, fmt: v => v }],
    draw(p) {
      const a = p.a, b = p.b, k = Math.min(340 / (a + 2 * b), 240 / (2 * a + b), 30);
      const x0 = (W - (a + 2 * b) * k) / 2 + b * k, y0 = (H - (2 * a + b) * k) / 2 + (a + b) * k;
      const R = [x0, y0], A = [x0 + a * k, y0], B = [x0, y0 - b * k], n = [b * k, -a * k];
      const c2 = a * a + b * b, c = Math.sqrt(c2);
      let o = Pg([R, A, B], 1, '', true);
      o += Pg([R, A, [A[0], A[1] + a * k], [R[0], R[1] + a * k]], 2, 'v-fc1') + Pg([R, B, [B[0] - b * k, B[1]], [R[0] - b * k, R[1]]], 3, 'v-fc2') + Pg([A, B, [B[0] + n[0], B[1] + n[1]], [A[0] + n[0], A[1] + n[1]]], 4, 'v-fc3');
      const m = Math.min(12, a * k * .4, b * k * .4);
      o += Pa('M' + r1(x0 + m) + ' ' + y0 + 'L' + r1(x0 + m) + ' ' + r1(y0 - m) + 'L' + r1(x0) + ' ' + r1(y0 - m), 4.5, 'v-m');
      o += Tx(x0 + a * k / 2, y0 + a * k / 2 + 4, 'a\u00b2 = ' + fx(a * a, 1), 5, 'v-tc1', 'middle') + Tx(x0 - b * k / 2, y0 - b * k / 2 + 4, 'b\u00b2 = ' + fx(b * b, 1), 5, 'v-tc2', 'middle');
      o += Tx((A[0] + B[0]) / 2 + n[0] / 2, (A[1] + B[1]) / 2 + n[1] / 2 + 4, 'c\u00b2 = ' + fx(c2, 2), 5.5, 'v-tc3', 'middle');
      return { svg: o, info: [
        '<span class="vz-k1">' + fx(a, 1) + '\u00b2</span> + <span class="vz-k2">' + fx(b, 1) + '\u00b2</span> = ' + fx(a * a, 1) + ' + ' + fx(b * b, 1) + ' = <b>' + fx(c2, 2) + '</b>',
        '<span class="vz-k3">c</span> = \u221a' + fx(c2, 2) + ' = <b>' + fx(c, 3) + '</b>' + (Math.abs(c - Math.round(c)) < 1e-9 ? '  (a Pythagorean triple!)' : '')] };
    }
  };
}
function wUnit(s) {
  const a0 = Math.round(num(s.angle, 45, 0, 360));
  return {
    title: 'Unit circle', ctl: [{ id: 'a', label: 'Angle \u03b8', min: 0, max: 360, step: 1, val: a0, fmt: v => v + '\u00b0' }],
    draw(p) {
      const d = p.a, t = d * Math.PI / 180, co = Math.cos(t), si = Math.sin(t), cx = 180, cy = 130, R = 100, px = cx + R * co, py = cy - R * si;
      let o = Ln(cx - 122, cy, cx + 122, cy, 1, 'v-ax') + Ln(cx, cy - 122, cx, cy + 122, 1, 'v-ax') + Ci(cx, cy, R, 2, 'v-slow');
      o += Tx(cx + R + 6, cy + 14, '0\u00b0', 2.5, 'v-s') + Tx(cx + 6, cy - R - 6, '90\u00b0', 2.5, 'v-s') + Tx(cx - R - 6, cy + 14, '180\u00b0', 2.5, 'v-s', 'end') + Tx(cx + 6, cy + R + 14, '270\u00b0', 2.5, 'v-s');
      o += Ln(cx, cy, px, py, 3, '');
      if (d > 0 && d < 360) o += Pa('M' + (cx + 24) + ' ' + cy + 'A24 24 0 ' + (d > 180 ? 1 : 0) + ' 0 ' + r1(cx + 24 * co) + ' ' + r1(cy - 24 * si), 4, 'v-m');
      o += Ln(cx, cy, px, cy, 5, 'v-c1 v-bold') + Ln(px, cy, px, py, 5.6, 'v-c2 v-bold') + Dt(px, py, 5, 6, '') + Tx(px + co * 16 + (co < -.2 ? -2 : 2), py - si * 14 + 4, 'P', 6.4, '', co < -.2 ? 'end' : 'start');
      const q = d % 90 === 0 ? 'on an axis' : 'Quadrant ' + ['I', 'II', 'III', 'IV'][Math.floor(d / 90) % 4];
      return { svg: o, info: [
        '\u03b8 = <b>' + d + '\u00b0</b> = <b>' + radTxt(d) + '</b> rad  (' + q + ')',
        '<span class="vz-k1">cos \u03b8</span> = x-coordinate = <b>' + fx(co) + '</b>',
        '<span class="vz-k2">sin \u03b8</span> = y-coordinate = <b>' + fx(si) + '</b>',
        'tan \u03b8 = sin \u00f7 cos = <b>' + (Math.abs(co) < 1e-9 ? 'undefined' : fx(si / co)) + '</b>'] };
    }
  };
}
function wCircle(s) {
  const r0 = Math.round(num(s.r, 5, 1, 10));
  return {
    title: 'Circle', ctl: [{ id: 'r', label: 'Radius r', min: 1, max: 10, step: 1, val: r0, fmt: v => v }],
    draw(p) {
      const r = p.r, R = r * 11, cx = 180, cy = 130, d35 = 35 * Math.PI / 180, d30 = 30 * Math.PI / 180;
      let o = Ci(cx, cy, R, 1, 'v-slow') + Dt(cx, cy, 3.5, 2, '') + Tx(cx - 8, cy + 14, 'O', 2.2, '', 'end');
      o += Ln(cx, cy, cx + R * Math.cos(d35), cy + R * Math.sin(d35), 3, 'v-c1 v-bold') + Ln(cx - R, cy, cx + R, cy, 4, 'v-c2');
      o += Ln(cx - R * Math.cos(d30), cy - R * Math.sin(d30), cx + R * Math.cos(d30), cy - R * Math.sin(d30), 5, 'v-c3');
      o += Tx(cx + R * Math.cos(d35) / 2 + 8, cy + R * Math.sin(d35) / 2 + 12, 'r', 6, 'v-tc1') + Tx(cx - R + 4, cy - 6, 'diameter', 6, 'v-tc2') + Tx(cx, cy - R * Math.sin(d30) - 8, 'chord', 6, 'v-tc3', 'middle');
      return { svg: o, info: [
        '<span class="vz-k1">radius</span> r = <b>' + fx(r, 1) + '</b>   <span class="vz-k2">diameter</span> d = 2r = <b>' + fx(2 * r, 1) + '</b>',
        'circumference C = 2\u03c0r = <b>' + fx(2 * Math.PI * r, 2) + '</b>',
        'area A = \u03c0r\u00b2 = <b>' + fx(Math.PI * r * r, 2) + '</b>'] };
    }
  };
}
const NAMES = ['', '', '', 'Triangle', 'Square', 'Pentagon', 'Hexagon', 'Heptagon', 'Octagon', 'Nonagon', 'Decagon', 'Hendecagon', 'Dodecagon'];
function wPoly(s) {
  const n0 = Math.round(num(s.sides, 6, 3, 12));
  return {
    title: 'Polygon', ctl: [{ id: 'n', label: 'Sides', min: 3, max: 12, step: 1, val: n0, fmt: v => v }],
    draw(p) {
      const n = p.n, cx = 180, cy = 134, R = 100, V = [];
      for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + 2 * Math.PI * k / n; V.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
      let o = '', st = 1;
      for (let k = 0; k < n; k++) { const a = V[k], b = V[(k + 1) % n]; o += Ln(a[0], a[1], b[0], b[1], r1(1 + k * .45), ''); }
      st = 1 + n * .45;
      o += Pg(V, st, 'v-fi');
      for (let k = 2; k <= n - 2; k++) o += Ln(V[0][0], V[0][1], V[k][0], V[k][1], r1(st + .4 + k * .2), 'v-g');
      o += Dt(cx, cy, 3, st + 1, '');
      return { svg: o, info: [
        '<b>' + NAMES[n] + '</b>: ' + n + ' sides, ' + n + ' corners',
        'angles add up to (' + n + ' \u2212 2) \u00d7 180\u00b0 = <b>' + (n - 2) * 180 + '\u00b0</b>',
        'each angle (if all equal) = <b>' + fx((n - 2) * 180 / n, 2) + '\u00b0</b>',
        'it splits into <b>' + (n - 2) + '</b> triangle' + (n - 2 > 1 ? 's' : '')] };
    }
  };
}
const gNice = (span, cnt) => { const raw = span / cnt, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
const gTk = (a, b, st) => { const o = []; for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9 && o.length < 14; v += st) o.push(+v.toFixed(10)); return o; };
function gInfo(s) {   // everything a graph needs to be drawn (also used to morph one graph into another)
  const fns = []; [s.fn, s.fn2].filter(v => typeof v === 'string' && v.trim()).slice(0, 2).forEach(src => { try { fns.push({ src: String(src).slice(0, 60), f: compile(src) }); } catch (e) { } });
  if (!fns.length) return null;
  let x0 = cv(s.xmin, -6.3), x1 = cv(s.xmax, 6.3); x0 = Math.max(x0, -1e4); x1 = Math.min(x1, 1e4); if (!(x1 - x0 > 1e-6)) { x0 = -6.3; x1 = 6.3; }
  const N = 320, xs = [], ys = fns.map(() => []), all = [];
  for (let i = 0; i <= N; i++) { const x = x0 + (x1 - x0) * i / N; xs.push(x); fns.forEach((g, k) => { let y; try { y = g.f(x); } catch (e) { y = NaN; } if (!isFinite(y)) y = NaN; ys[k].push(y); if (isFinite(y)) all.push(y); }); }
  if (all.length < 5) return null;
  all.sort((a, b) => a - b);
  let lo = cv(s.ymin, null), hi = cv(s.ymax, null);
  if (lo == null) lo = all[Math.floor(all.length * .02)]; if (hi == null) hi = all[Math.min(all.length - 1, Math.ceil(all.length * .98))];
  if (!(hi > lo)) { lo -= 1; hi += 1; } const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  return { fns, x0, x1, lo, hi, xs, ys, N };
}
function wGraph(s) {
  const G = gInfo(s); if (!G) return null;
  const { fns, x0, x1, lo, hi, xs, ys, N } = G;
  const PX0 = 44, PX1 = 346, PY0 = 14, PY1 = 230, id = 'vzc' + (++uid);
  const mx = x => PX0 + (x - x0) / (x1 - x0) * (PX1 - PX0), my = y => PY1 - (y - lo) / (hi - lo) * (PY1 - PY0);
  const ax = x0 < 0 && x1 > 0 ? mx(0) : PX0, ay = lo < 0 && hi > 0 ? my(0) : PY1;
  const nice = (span, cnt) => { const raw = span / cnt, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
  const tk = (a, b, st) => { const o = []; for (let v = Math.ceil(a / st - 1e-9) * st; v <= b + 1e-9 && o.length < 14; v += st) o.push(+v.toFixed(10)); return o; };
  const sx = nice(x1 - x0, 6), sy = nice(hi - lo, 5);
  let base = '<defs><clipPath id="' + id + '"><rect x="' + PX0 + '" y="' + PY0 + '" width="' + (PX1 - PX0) + '" height="' + (PY1 - PY0) + '"/></clipPath></defs>';
  tk(x0, x1, sx).forEach(t => { base += Gl(mx(t), PY0, mx(t), PY1, 0.5); if (Math.abs(t) > 1e-9 || ax === PX0) base += Tx(mx(t), Math.min(ay + 13, 246), fx(t, 4), 1.5, 'v-s', 'middle'); });
  tk(lo, hi, sy).forEach(t => { base += Gl(PX0, my(t), PX1, my(t), 0.5); if (Math.abs(t) > 1e-9 || ay === PY1) base += Tx(ax - 5, my(t) + 3.5, fx(t, 4), 1.5, 'v-s', 'end'); });
  base += Ln(PX0, ay, PX1, ay, 1, 'v-ax') + Ln(ax, PY0, ax, PY1, 1, 'v-ax');
  const pathFor = k => {
    let d = '', pen = false, prev = null;
    for (let i = 0; i <= N; i++) {
      const y = ys[k][i]; if (!isFinite(y)) { pen = false; prev = null; continue; }
      const px = mx(xs[i]), py = my(y); if (py < PY0 - 400 || py > PY1 + 400) { pen = false; prev = null; continue; }
      if (prev !== null && Math.abs(py - prev) > (PY1 - PY0) * 1.5) pen = false;
      d += (pen ? 'L' : 'M') + r1(px) + ' ' + r1(py); pen = true; prev = py;
    }
    return d;
  };
  fns.forEach((g, k) => { base += Pa(pathFor(k), 2 + k, 'v-slow ' + (k ? 'v-c2' : 'v-c1'), id); });
  const drop = s.x != null, xv = Math.min(x1, Math.max(x0, cv(s.x, x0 + (x1 - x0) * .6)));   // x given = a marked point with dashed drop lines
  return {
    G, drop,
    title: 'Graph', ctl: [{ id: 'x', label: 'x', min: x0, max: x1, step: (x1 - x0) / 300, val: xv, fmt: v => fx(v, 2) }],
    draw(p) {
      const x = p.x; let pre = '', dots = ''; const info = ['x = <b>' + fx(x, 3) + '</b>'];
      fns.forEach((g, k) => {
        let y; try { y = g.f(x); } catch (e) { y = NaN; }
        if (isFinite(y) && my(y) >= PY0 - 2 && my(y) <= PY1 + 2) { dots += Dt(mx(x), my(y), 4.5, 4.4, k ? 'v-dc2' : 'v-dc1'); if (drop && k === 0) pre = Ln(mx(x), my(y), mx(x), ay, 4, 'v-g') + Ln(ax, my(y), mx(x), my(y), 4, 'v-g'); }
        info.push('<span class="vz-sw s' + (k + 1) + '"></span>' + esc(g.src) + ' = <b>' + fx(y) + '</b>');
      });
      if (!drop) pre = Ln(mx(x), PY0, mx(x), PY1, 4, 'v-g');
      return { svg: base + pre + dots, info };
    }
  };
}
function build(s) {
  if (!s || typeof s !== 'object') return null; let w = null;
  try { switch (String(s.type)) { case 'triangle': w = wTriangle(s); break; case 'pythagoras': w = wPyth(s); break; case 'unitcircle': w = wUnit(s); break; case 'circle': w = wCircle(s); break; case 'polygon': w = wPoly(s); break; case 'graph': w = wGraph(s); break; } } catch (e) { return null; }
  if (w) w.title = String(s.title || w.title).slice(0, 40); return w;
}

/* ---------- the slow assembly: lines draw themselves one after another, labels fade in ---------- */
function play(svg, o) {
  if (RM) { svg.classList.remove('vz-pre'); return 0; }
  const sp = (o && o.speed) || 1, tr = [];
  const els = [...svg.querySelectorAll('[data-st]')], isD = e => e.classList.contains('v-d') && e.getTotalLength;
  let max = 0;
  els.forEach(e => {
    e.style.transition = 'none';
    if (isD(e)) { const L = Math.ceil(e.getTotalLength()) + 2; e._L = L; e.style.strokeDasharray = L; e.style.strokeDashoffset = L; }
    else { e.style.opacity = 0; e.style.transform = e.classList.contains('v-t') ? 'translateY(6px)' : 'scale(.7)'; }
  });
  svg.classList.remove('vz-pre'); svg.getBoundingClientRect();
  els.forEach(e => {
    const d = (0.2 + (+e.dataset.st) * 0.7) * sp, dur = (e.classList.contains('v-slow') ? 1.8 : 0.9) * sp; max = Math.max(max, d + dur);
    if (isD(e)) {
      if (e.tagName === 'path' && e.classList.contains('v-slow')) tr.push([e, d, dur]);   // curves: a glowing dot rides the line while it draws
      else { e.style.transition = 'stroke-dashoffset ' + dur + 's ease-in-out ' + d.toFixed(2) + 's'; e.style.strokeDashoffset = 0; }
    } else {
      const t = d.toFixed(2);
      e.style.transition = 'opacity .6s ease ' + t + 's, transform .75s cubic-bezier(.34,1.56,.64,1) ' + t + 's';
      e.style.opacity = 1; e.style.transform = 'none';
    }
  });
  tr.forEach(x => trace(svg, x[0], x[1], x[2]));
  setTimeout(() => els.forEach(e => { e.style.transition = ''; e.style.strokeDasharray = ''; e.style.strokeDashoffset = ''; e.style.opacity = ''; e.style.transform = ''; }), (max + .6) * 1000);
  return max + .6;
}
function trace(svg, e, delay, dur) {
  const L = e._L, tot = e.getTotalLength(), dot = document.createElementNS(NS, 'circle'), cp = e.getAttribute('clip-path');
  dot.setAttribute('r', 5); dot.setAttribute('class', 'vz-tr' + (e.classList.contains('v-c2') ? ' c2' : '')); dot.style.opacity = 0; if (cp) dot.setAttribute('clip-path', cp);
  svg.appendChild(dot); const t0 = performance.now() + delay * 1000;
  const step = now => {
    if (!dot.isConnected || !e.isConnected) { dot.remove(); return; }
    const k = Math.min(1, Math.max(0, (now - t0) / (dur * 1000))), q = ease(k);
    e.style.strokeDashoffset = L * (1 - q);
    if (k > 0 && k < 1) { const p = e.getPointAtLength(Math.min(tot, tot * q)); dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.style.opacity = 1; }
    if (k >= 1) { e.style.strokeDashoffset = 0; dot.style.transition = 'opacity .4s'; dot.style.opacity = 0; setTimeout(() => dot.remove(), 450); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Batch C: morph. Same id + same type in a lesson = the old picture turns into the new one ---------- */
const sf = (f, x) => { try { const y = f(x); return isFinite(y) ? y : NaN; } catch (e) { return NaN; } };
function gFrame(A, B, k, xv, drop, cid) {   // one in-between frame of graph A turning into graph B (k = 0..1, already eased)
  const X0 = 44, X1 = 346, Y0 = 14, Y1 = 230, L = (a, b) => a + (b - a) * k;
  const x0 = L(A.x0, B.x0), x1 = L(A.x1, B.x1), lo = L(A.lo, B.lo), hi = L(A.hi, B.hi);
  const mx = x => X0 + (x - x0) / (x1 - x0) * (X1 - X0), my = y => Y1 - (y - lo) / (hi - lo) * (Y1 - Y0);
  const ax = x0 < 0 && x1 > 0 ? mx(0) : X0, ay = lo < 0 && hi > 0 ? my(0) : Y1;
  const op = a => ' style="opacity:' + a.toFixed(2) + '"';
  let o = '<defs><clipPath id="' + cid + '"><rect x="' + X0 + '" y="' + Y0 + '" width="' + (X1 - X0) + '" height="' + (Y1 - Y0) + '"/></clipPath></defs>';
  const tick = (a, b, vert) => {   // old and new tick marks crossfade while the axes glide
    const ta = gTk(a[0], a[1], gNice(a[1] - a[0], vert ? 6 : 5)), tb = gTk(b[0], b[1], gNice(b[1] - b[0], vert ? 6 : 5)), key = v => v.toFixed(8), sa = new Set(ta.map(key)), sb = new Set(tb.map(key));
    const all = new Map(); ta.concat(tb).forEach(v => all.set(key(v), v));
    all.forEach((t, kk) => {
      const al = sa.has(kk) && sb.has(kk) ? 1 : sb.has(kk) ? k : 1 - k; if (al < .03) return;
      if (vert) { const px = mx(t); if (px < X0 - .5 || px > X1 + .5) return; o += '<line class="v-gl"' + op(al) + ' x1="' + r1(px) + '" y1="' + Y0 + '" x2="' + r1(px) + '" y2="' + Y1 + '"/>'; if (Math.abs(t) > 1e-9 || ax === X0) o += '<text class="v-t v-s"' + op(al) + ' x="' + r1(px) + '" y="' + r1(Math.min(ay + 13, 246)) + '" text-anchor="middle">' + esc(fx(t, 4)) + '</text>'; }
      else { const py = my(t); if (py < Y0 - .5 || py > Y1 + .5) return; o += '<line class="v-gl"' + op(al) + ' x1="' + X0 + '" y1="' + r1(py) + '" x2="' + X1 + '" y2="' + r1(py) + '"/>'; if (Math.abs(t) > 1e-9 || ay === Y1) o += '<text class="v-t v-s"' + op(al) + ' x="' + r1(ax - 5) + '" y="' + r1(py + 3.5) + '" text-anchor="end">' + esc(fx(t, 4)) + '</text>'; }
    });
  };
  tick([A.x0, A.x1], [B.x0, B.x1], true); tick([A.lo, A.hi], [B.lo, B.hi], false);
  o += Ln(X0, ay, X1, ay, 1, 'v-ax') + Ln(ax, Y0, ax, Y1, 1, 'v-ax');
  const yAt = (kf, x) => { const fa = A.fns[kf], fb = B.fns[kf]; if (fa && fb) return L(sf(fa.f, x), sf(fb.f, x)); return sf((fb || fa).f, x); };
  const nf = Math.max(A.fns.length, B.fns.length), n = 240;
  for (let kf = 0; kf < nf; kf++) {
    const al = A.fns[kf] && B.fns[kf] ? 1 : B.fns[kf] ? k : 1 - k; let d = '', pen = false, prev = null;
    for (let i = 0; i <= n; i++) {
      const xx = x0 + (x1 - x0) * i / n, y = yAt(kf, xx); if (!isFinite(y)) { pen = false; prev = null; continue; }
      const px = mx(xx), py = my(y); if (py < Y0 - 400 || py > Y1 + 400) { pen = false; prev = null; continue; }
      if (prev !== null && Math.abs(py - prev) > (Y1 - Y0) * 1.5) pen = false;
      d += (pen ? 'L' : 'M') + r1(px) + ' ' + r1(py); pen = true; prev = py;
    }
    o += '<path class="v-d ' + (kf ? 'v-c2' : 'v-c1') + '"' + op(al) + ' clip-path="url(#' + cid + ')" d="' + d + '"/>';
  }
  const y0 = yAt(0, xv);
  if (!drop) o += Ln(mx(xv), Y0, mx(xv), Y1, 4, 'v-g');
  if (isFinite(y0) && my(y0) >= Y0 - 2 && my(y0) <= Y1 + 2) { if (drop) o += Ln(mx(xv), my(y0), mx(xv), ay, 4, 'v-g') + Ln(ax, my(y0), mx(xv), my(y0), 4, 'v-g'); o += Dt(mx(xv), my(y0), 4.5, 4.4, 'v-dc1'); }
  return o;
}
function morph(host, spec, o) {   // true = it is morphing; false = the caller should replace the picture instead
  const S = host && host._vz; if (!S || !host.isConnected || !host.classList.contains('vz-static') || !spec || typeof spec !== 'object' || String(spec.type) !== S.type) return false;
  const w2 = build(spec); if (!w2) return false;
  S.stop(); const P2 = {}; w2.ctl.forEach(c => { P2[c.id] = c.val; });
  host.dataset.v = JSON.stringify(spec);
  const hb = host.querySelector('.vz-h b'); if (hb) hb.textContent = w2.title;
  const w1 = S.w, P1 = Object.assign({}, S.P), my = ++S.mt, D = (((o && o.dur) || 1.3)) * 1000, cid = 'vzm' + (++uid);
  const put = r => { S.svg.innerHTML = r.svg; S.ib.innerHTML = r.info.map(l => '<div>' + l + '</div>').join(''); };
  const fin = () => { S.w = w2; S.P = P2; put(w2.draw(P2)); };
  if (RM) { fin(); return true; }
  const t0 = performance.now(), f = now => {
    if (my !== S.mt || !host.isConnected) return;
    const k = Math.min(1, (now - t0) / D), e = ease(k);
    if (k >= 1) { fin(); return; }
    if (S.type === 'graph' && w1.G && w2.G) S.svg.innerHTML = gFrame(w1.G, w2.G, e, P1.x + (P2.x - P1.x) * e, w2.drop, cid);
    else { const Pk = {}; w2.ctl.forEach(c => { const a = P1[c.id], b = P2[c.id]; Pk[c.id] = a == null ? b : a + (b - a) * e; }); if (S.type === 'polygon') Pk.n = Math.round(Pk.n); put(w2.draw(Pk)); }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f); return true;
}

function mount(host, o) {
  o = o || {};
  if (host.dataset.m) return; host.dataset.m = '1';
  let spec; try { spec = JSON.parse(host.dataset.v); } catch (e) { host.remove(); return; }
  const w = build(spec); if (!w) { host.remove(); return; }
  const key = host.dataset.v, played = !!o.still || (!o.always && seen.has(key));
  host.classList.remove('ld'); if (o.static) host.classList.add('vz-static');
  host.innerHTML = '<div class="vz-h"><b>' + esc(w.title) + '</b><button class="vz-re" type="button">Replay</button></div><svg class="vz-svg' + (played ? '' : ' vz-pre') + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(w.title) + '"></svg><div class="vz-c"></div><div class="vz-i"></div>';
  const svg = host.querySelector('svg'), cb = host.querySelector('.vz-c'), ib = host.querySelector('.vz-i'), P = {};
  const P0 = {}; w.ctl.forEach(c => { P[c.id] = P0[c.id] = c.val; });
  cb.innerHTML = w.ctl.map(c => '<label class="vz-s"><span>' + esc(c.label) + '</span><input type="range" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + c.val + '" data-k="' + c.id + '"><output>' + esc(c.fmt(c.val)) + '</output></label>').join('');
  const draw = () => { const r = w.draw(P); svg.innerHTML = r.svg; ib.innerHTML = r.info.map(l => '<div>' + l + '</div>').join(''); };
  draw();
  host._vz = { type: String(spec.type), w, P, svg, ib, mt: 0, stop: () => stopSweep() };   // lets morph() find this picture later
  /* after the pieces have drawn themselves, the first slider glides out and back once so you can see how the shape reacts */
  let sw = 0, tm = 0;
  const setUI = () => w.ctl.forEach(c => { const i = cb.querySelector('[data-k="' + c.id + '"]'); if (i) { i.value = P[c.id]; i.nextElementSibling.textContent = c.fmt(P[c.id]); } });
  const stopSweep = () => { if (sw) { cancelAnimationFrame(sw); sw = 0; } clearTimeout(tm); };
  const sweep = () => {
    const c = w.ctl[0]; if (!c || RM || !host.isConnected) return;
    const v0 = c.val, far = (c.max - v0 >= v0 - c.min) ? c.max : c.min, t0 = performance.now(), D = 2600;
    const qz = v => Math.min(c.max, Math.max(c.min, Math.round((v - c.min) / c.step) * c.step + c.min));
    const f = now => {
      if (!host.isConnected) { sw = 0; return; }
      const k = Math.min(1, (now - t0) / D), e = (1 - Math.cos(Math.PI * k)) / 2, v = k >= 1 ? v0 : qz(v0 + (far - v0) * Math.sin(Math.PI * e));
      if (v !== P[c.id]) { P[c.id] = v; setUI(); draw(); }
      sw = k < 1 ? requestAnimationFrame(f) : 0;
    };
    sw = requestAnimationFrame(f);
  };
  const first = () => { const t = play(svg, o); tm = setTimeout(sweep, t * 1000 + 200); };
  cb.addEventListener('pointerdown', stopSweep);
  cb.addEventListener('input', e => { stopSweep(); const i = e.target.closest('input'); if (!i) return; const c = w.ctl.find(c => c.id === i.dataset.k); P[c.id] = +i.value; i.nextElementSibling.textContent = c.fmt(+i.value); draw(); });
  host.querySelector('.vz-re').onclick = () => { stopSweep(); Object.assign(P, P0); setUI(); draw(); svg.classList.add('vz-pre'); first(); };
  if (played) return;
  seen.add(key);
  if (o.now) { setTimeout(first, 380); return; }
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(en => en.isIntersecting)) { io.disconnect(); first(); } }, { threshold: .4 }); io.observe(svg); } else first();
}
window.SpectraViz = { mount: (root, o) => (root || document).querySelectorAll('.ac-viz[data-v]').forEach(h => mount(h, o)), morph };
})();
