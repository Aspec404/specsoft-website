/* SPECSOFT® Spectra widgets: ready-made interactive cards (todo, calculator, stats, gallery).
   Spectra asks for one with a fenced block tagged "widget" holding ONE small JSON object.
   Nothing here ever runs code from the model: the JSON only picks a type and fills in text, and every string is set with textContent.
   Load BEFORE spectra-ai.js. */
(function () {
'use strict';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, d) => { v = parseFloat(v); return isFinite(v) ? v : d; };
let streaming = false;

function parse(code) { try { const j = JSON.parse(String(code).trim()); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch (e) { return null; } }
function mk(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function head(el, spec, fallback) { const h = mk('div', 'wg-h'); h.appendChild(mk('b', '', clip(spec.title, 60) || fallback)); el.appendChild(h); return h; }

/* ---------------- TODO ---------------- */
function todo(el, spec, ctx) {
  const st = ctx.state, src = st && Array.isArray(st.items) ? st.items : (Array.isArray(spec.items) ? spec.items : []);
  const items = src.slice(0, 40).map(x => typeof x === 'string' ? { t: clip(x, 120), done: false } : { t: clip(x && (x.t || x.text || x.task), 120), done: !!(x && x.done) }).filter(x => x.t);
  el.classList.add('todo');
  const h = head(el, spec, 'To-do list'), cnt = mk('span', 'wg-c'); h.appendChild(cnt);
  const bar = mk('div', 'wg-bar'), fill = mk('i'); bar.appendChild(fill); el.appendChild(bar);
  const ul = mk('ul', 'wg-list'); el.appendChild(ul);
  const add = mk('div', 'wg-add'), inp = mk('input'), btn = mk('button', '', 'Add');
  inp.maxLength = 120; inp.placeholder = 'Add a task...'; inp.setAttribute('aria-label', 'Add a task'); btn.type = 'button';
  add.append(inp, btn); el.appendChild(add);
  const draw = () => {
    const d = items.filter(x => x.done).length;
    cnt.textContent = d + '/' + items.length + (items.length && d === items.length ? ' done!' : '');
    fill.style.width = (items.length ? Math.round(d / items.length * 100) : 0) + '%';
    ul.textContent = '';
    if (!items.length) { ul.appendChild(mk('li', 'wg-empty', 'Nothing here yet. Add something below.')); return; }
    items.forEach((x, i) => {
      const li = mk('li', x.done ? 'done' : ''), ck = mk('button', 'wg-ck'), tx = mk('span', 'wg-t', x.t), rm = mk('button', 'wg-x', '\u00d7');
      ck.type = rm.type = 'button'; ck.dataset.i = rm.dataset.i = i; ck.setAttribute('role', 'checkbox'); ck.setAttribute('aria-checked', x.done ? 'true' : 'false'); ck.setAttribute('aria-label', x.t); rm.setAttribute('aria-label', 'Remove task');
      ck.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      li.append(ck, tx, rm); ul.appendChild(li);
    });
  };
  const keep = () => { ctx.save({ items: items.map(x => ({ t: x.t, done: x.done })) }); draw(); };
  ul.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.i == null) return; const i = +b.dataset.i; if (!items[i]) return;
    if (b.classList.contains('wg-x')) items.splice(i, 1); else items[i].done = !items[i].done;
    keep();
  });
  const addIt = () => { const t = clip(inp.value, 120); if (!t || items.length >= 40) return; items.push({ t, done: false }); inp.value = ''; keep(); inp.focus(); };
  btn.addEventListener('click', addIt);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
  draw();
}

/* ---------------- CALCULATOR (own tiny parser, no eval) ---------------- */
function evalExpr(s) {
  const t = s.match(/\d+\.?\d*|\.\d+|[+\-\u00d7\u00f7%]/g) || []; let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const prim = () => { const x = next(); if (x === '-') return -prim(); if (x === '+') return prim(); const n = parseFloat(x); if (isNaN(n)) throw 0; return n; };
  const pct = () => { let v = prim(); while (peek() === '%') { next(); v /= 100; } return v; };
  const mul = () => { let v = pct(); while (peek() === '\u00d7' || peek() === '\u00f7') { const o = next(), r = pct(); if (o === '\u00f7' && r === 0) throw 0; v = o === '\u00d7' ? v * r : v / r; } return v; };
  const addp = () => { let v = mul(); while (peek() === '+' || peek() === '-') { const o = next(), r = mul(); v = o === '+' ? v + r : v - r; } return v; };
  const v = addp(); if (i < t.length || !isFinite(v)) throw 0; return parseFloat(v.toPrecision(12));
}
function calc(el, spec) {
  el.classList.add('calc'); el.tabIndex = 0;
  head(el, spec, 'Calculator');
  const scr = mk('div', 'wg-scr'), ex = mk('div', 'wg-ex'), out = mk('div', 'wg-out', '0'); scr.append(ex, out); el.appendChild(scr);
  const keys = mk('div', 'wg-keys'); el.appendChild(keys);
  let expr = '', done = false, err = false;
  const OPS = '+-\u00d7\u00f7';
  const show = () => { ex.textContent = expr && !done ? '' : ex.textContent; out.textContent = err ? 'Error' : (expr || '0'); out.classList.toggle('err', err); };
  const press = k => {
    if (err) { expr = ''; err = false; ex.textContent = ''; }
    if (k === 'C') { expr = ''; done = false; ex.textContent = ''; return show(); }
    if (k === '\u232b') { if (done) { expr = ''; done = false; ex.textContent = ''; } else expr = expr.slice(0, -1); return show(); }
    if (k === '=') {
      if (!expr) return;
      try { const r = String(evalExpr(expr)); ex.textContent = expr + ' ='; expr = r; done = true; } catch (e) { err = true; ex.textContent = expr; expr = ''; }
      return show();
    }
    if (expr.length >= 40) return;
    const last = expr.slice(-1), isOp = OPS.indexOf(k) > -1;
    if (done) { done = false; ex.textContent = ''; if (!isOp && k !== '%') expr = ''; }
    if (isOp) {
      if (!expr) { if (k === '-') expr = '-'; return show(); }
      if (OPS.indexOf(last) > -1) expr = expr.slice(0, -1);
      if (expr === '-' ) return show();
      expr += k;
    } else if (k === '%') { if (/[\d.]$/.test(expr) || last === '%') expr += '%'; }
    else if (k === '.') { const cur = expr.split(/[+\-\u00d7\u00f7%]/).pop(); if (cur.indexOf('.') < 0) expr += cur === '' ? '0.' : '.'; }
    else { if (last === '%') expr += '\u00d7'; expr += k; }
    show();
  };
  [['C', 'fn'], ['\u232b', 'fn'], ['%', 'fn'], ['\u00f7', 'op'], ['7'], ['8'], ['9'], ['\u00d7', 'op'], ['4'], ['5'], ['6'], ['-', 'op', '\u2212'], ['1'], ['2'], ['3'], ['+', 'op'], ['0', 'z'], ['.'], ['=', 'eq']].forEach(([k, c, label]) => {
    const b = mk('button', 'wg-k ' + (c || ''), label || k); b.type = 'button'; b.dataset.k = k; keys.appendChild(b);
  });
  keys.addEventListener('click', e => { const b = e.target.closest('button'); if (b) press(b.dataset.k); });
  el.addEventListener('keydown', e => {
    if (e.target !== el) return; let k = e.key;
    if (/^[0-9.]$/.test(k) || k === '+' || k === '-' || k === '%') press(k);
    else if (k === '*' || k === 'x') press('\u00d7'); else if (k === '/') { e.preventDefault(); press('\u00f7'); }
    else if (k === 'Enter' || k === '=') { e.preventDefault(); press('='); }
    else if (k === 'Backspace') press('\u232b'); else if (k === 'Escape' || k === 'Delete') press('C');
  });
}

/* ---------------- STATS ---------------- */
function stats(el, spec) {
  el.classList.add('stats'); head(el, spec, 'Stats');
  const arr = (Array.isArray(spec.stats) ? spec.stats : Array.isArray(spec.items) ? spec.items : []).slice(0, 8);
  const g = mk('div', 'wg-grid');
  arr.forEach(s => {
    if (!s || typeof s !== 'object') return;
    const c = mk('div', 'wg-card'); c.appendChild(mk('div', 'wg-l', clip(s.label, 40))); c.appendChild(mk('div', 'wg-v', clip(s.value, 20)));
    if (s.note) c.appendChild(mk('div', 'wg-n', clip(s.note, 60)));
    if (s.pct != null && isFinite(parseFloat(s.pct))) { const b = mk('div', 'wg-bar'), f = mk('i'); f.style.width = Math.max(0, Math.min(100, num(s.pct, 0))) + '%'; b.appendChild(f); c.appendChild(b); }
    g.appendChild(c);
  });
  if (!g.children.length) throw 0;
  el.appendChild(g);
}

/* ---------------- GALLERY (https links only, never data: or javascript:) ---------------- */
const okUrl = u => typeof u === 'string' && u.length < 600 && /^https:\/\/[^\s"'<>]+$/i.test(u);
function gallery(el, spec) {
  el.classList.add('gal'); head(el, spec, 'Gallery');
  const arr = (Array.isArray(spec.images) ? spec.images : []).filter(x => x && okUrl(x.src)).slice(0, 12);
  if (!arr.length) throw 0;
  const g = mk('div', 'wg-gal'); let bad = 0;
  arr.forEach(x => {
    const f = mk('a', 'wg-fig'), im = new Image();
    f.href = x.src; f.target = '_blank'; f.rel = 'noopener noreferrer';
    im.alt = clip(x.caption, 80) || 'image'; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer';
    im.onerror = () => { f.remove(); if (++bad >= arr.length) { g.remove(); el.appendChild(mk('div', 'wg-empty', "These images didn't load.")); } };
    im.src = x.src; f.appendChild(im);
    if (x.caption) f.appendChild(mk('span', 'wg-cap', clip(x.caption, 80)));
    g.appendChild(f);
  });
  el.appendChild(g);
}

const BUILD = { todo, calc, calculator: calc, stats, gallery };

/* ---------------- public API ---------------- */
function html(code) {
  if (streaming) return '<div class="sa-wg building"><span class="sa-dots"><i></i><i></i><i></i></span><span>Building a widget...</span></div>';
  return '<div class="sa-wg" data-spec="' + esc(String(code).trim().slice(0, 8000)) + '"></div>';
}
function mount(root, m, onSave) {
  root.querySelectorAll('.sa-wg[data-spec]').forEach((el, idx) => {
    const spec = parse(el.dataset.spec || ''), B = spec && BUILD[String(spec.type).toLowerCase()];
    const bad = () => { el.textContent = ''; el.className = 'sa-wg bad'; el.textContent = "Couldn't build this widget"; };
    if (!B) return bad();
    const ctx = { state: m && m.wstate && m.wstate[idx], save: s => { if (!m) return; m.wstate = m.wstate || {}; m.wstate[idx] = s; if (onSave) onSave(); } };
    el.textContent = '';
    try { B(el, spec, ctx); } catch (e) { bad(); }
  });
}
window.SpectraWidgets = { html, mount, stream: on => { streaming = !!on; } };
})();
