/* SPECSOFT® Spectra Canvas v1 (Persistent Canvas capability for Spectra Academics).
   Spectra writes long text or code as a canvas block inside her answer:
       ~~~canvas doc | Essay about rivers          (a document, markdown)
       ~~~canvas python | Two Sum solver           (code, the word is the language)
       ...content...
       ~~~
   The chat shows a small card for it. Click the card and the Canvas opens beside the chat (a full screen sheet on phones):
   edit by hand, preview, copy, download, save a document as PDF, and flip between versions when Spectra rewrites it.
   Everything is stored inside the message text itself, so it is saved with the chat and Spectra sees your edits next time.
   API: SpectraCanvas.hide(text, htmlList) / strip(text, noCanvas) (used by the page's markdown), open(msg, n), close(), live(msg), refresh() */
(function () {
'use strict';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = () => window.SpectraAcad || {};
const msgsNow = () => (A().msgs ? A().msgs() : []);
const ico = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
const I = {
  doc: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h4', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  copy: 'M9 9h10a2 2 0 012 2v9a2 2 0 01-2 2H9a2 2 0 01-2-2v-9a2 2 0 012-2zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  down: 'M12 4v11M7 11l5 5 5-5M5 20h14', pdf: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M12 11v6M9 14l3 3 3-3',
  x: 'M6 6l12 12M18 6L6 18', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z', edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  prev: 'M15 6l-6 6 6 6', next: 'M9 6l6 6-6 6'
};
const LANGN = { js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', py: 'Python', python: 'Python', java: 'Java', cpp: 'C++', 'c++': 'C++', c: 'C', cs: 'C#', 'c#': 'C#', csharp: 'C#', html: 'HTML', css: 'CSS', sql: 'SQL', lua: 'Lua', bash: 'Bash', sh: 'Shell', json: 'JSON', rust: 'Rust', go: 'Go', php: 'PHP', ruby: 'Ruby', swift: 'Swift', kotlin: 'Kotlin', text: 'Text' };
const EXT = { js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', py: 'py', python: 'py', java: 'java', cpp: 'cpp', 'c++': 'cpp', c: 'c', cs: 'cs', 'c#': 'cs', csharp: 'cs', html: 'html', css: 'css', sql: 'sql', lua: 'lua', bash: 'sh', sh: 'sh', json: 'json', rust: 'rs', go: 'go', php: 'php', ruby: 'rb', swift: 'swift', kotlin: 'kt', text: 'txt' };

/* ---------- reading blocks out of a message ---------- */
const RX = () => /(^|\n)~~~canvas([^\n]*)(?:\n([\s\S]*?))??(\n~~~[ \t]*(?=\n|$)|$)/g;   // the body group is optional (lazy), so an empty block closes cleanly instead of swallowing the text after it
function info(s) {
  s = String(s || '').trim();
  const i = s.indexOf('|'), tok = (i < 0 ? s : s.slice(0, i)).trim().toLowerCase();
  let type = 'doc', title = i < 0 ? '' : s.slice(i + 1).trim();
  if (/^[a-z0-9+#._-]{1,16}$/.test(tok)) type = tok; else if (i < 0) title = s;
  return { type, title: (title || (type === 'doc' ? 'Untitled document' : 'Untitled code')).slice(0, 80) };
}
function blocks(t) {
  const out = [];
  for (const m of String(t || '').matchAll(RX())) {
    const f = info(m[2]), closed = !!m[4];
    out.push({ i: m.index, len: m[0].length, lead: m[1], type: f.type, title: f.title, body: closed ? (m[3] || '') : (m[3] || '').replace(/\n~{1,3}$/, ''), closed });
  }
  return out;
}
const words = s => (String(s).trim().match(/\S+/g) || []).length;
const lines = s => (String(s) === '' ? 0 : String(s).split('\n').length);
const kind = b => b.type === 'doc' ? 'Document' : (LANGN[b.type] || b.type.toUpperCase());
const stat = b => b.type === 'doc' ? words(b.body) + ' words' : lines(b.body) + ' lines';
const cardMeta = b => b.closed ? kind(b) + ' \u00b7 ' + stat(b) : 'Spectra is writing in Canvas...';

/* the chat card that replaces the block in the answer */
function card(n, b) {
  return '<div class="ac-cv' + (b.closed ? '' : ' ld') + '" data-cv="' + n + '" role="button" tabindex="0" aria-label="Open Canvas: ' + esc(b.title) + '"><span class="cv-ic">' + ico(b.type === 'doc' ? I.doc : I.code) + '</span><span class="cv-tx"><b>' + esc(b.title) + '</b><small>' + esc(cardMeta(b)) + '</small></span>' +
    (b.closed ? '<span class="cv-go">Open</span>' : '<span class="ac-dots"><i></i><i></i><i></i></span>') + '</div>';
}
/* page markdown: swap each block for a placeholder, push its card into list */
function hide(t, list) {
  const bs = blocks(t); if (!bs.length) return t;
  let out = '', at = 0;
  bs.forEach((b, n) => { out += t.slice(at, b.i) + b.lead + '\n\uE002' + list.length + '\uE003\n'; list.push(card(n, b)); at = b.i + b.len; });
  return out + t.slice(at);
}
/* plain text of an answer: the canvas text itself (or nothing for read-aloud) */
function strip(t, none) {
  const bs = blocks(t); if (!bs.length) return t;
  let out = '', at = 0;
  bs.forEach(b => { out += t.slice(at, b.i) + b.lead + (none ? '' : b.type === 'doc' ? b.body : '```' + b.type + '\n' + b.body + '\n```'); at = b.i + b.len; });
  return out + t.slice(at);
}
function write(m, n, ch) {
  const b = blocks(m.content)[n]; if (!b) return false;
  const body = ('body' in ch ? ch.body : b.body).replace(/^~~~/gm, '~\u200b~~'), title = ('title' in ch ? ch.title : b.title).replace(/[\n\r|]/g, ' ').trim() || b.title;
  m.content = m.content.slice(0, b.i) + b.lead + '~~~canvas ' + b.type + ' | ' + title + '\n' + body + '\n~~~' + m.content.slice(b.i + b.len);
  return true;
}

/* ---------- styles ---------- */
(function () {
  const st = document.createElement('style');
  st.textContent =
    '.ac-cv{display:flex;align-items:center;gap:12px;max-width:440px;margin:12px 0;padding:11px 12px;border:1px solid var(--line);border-radius:16px;background:var(--soft);cursor:pointer;transition:background .15s,transform .1s,border-color .15s;animation:cvin .35s cubic-bezier(.2,.9,.3,1.1)}' +
    '.ac-cv:hover{border-color:var(--ink2)}.ac-cv:active{transform:scale(.985)}.ac-cv:focus-visible{outline:2px solid var(--ink2);outline-offset:2px}.ac-cv.ld{cursor:default}' +
    '.cv-ic{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:12px;background:var(--acc);color:var(--onacc)}.cv-ic svg{width:20px;height:20px}' +
    '.cv-tx{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}.cv-tx b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13.5px Inter,sans-serif;color:var(--ink)}.cv-tx small{color:var(--ink2);font:500 12px Inter,sans-serif}' +
    '.cv-go{flex:none;padding:6px 13px;border-radius:99px;background:var(--acc);color:var(--onacc);font:600 12px Inter,sans-serif}' +
    '@keyframes cvin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    /* panel: docked on wide screens, a sheet over the page on small ones */
    '.ac-cvp{flex:none;display:flex;flex-direction:column;width:min(46%,700px);min-width:0;margin:12px 12px 12px 0;border:1px solid var(--line);border-radius:20px;background:var(--card);color:var(--ink);box-shadow:0 10px 34px rgba(0,0,0,.12);overflow:hidden;animation:cvp .28s cubic-bezier(.2,.9,.3,1.05);font-family:Inter,system-ui,sans-serif}' +
    '.ac-cvp[hidden]{display:none}@keyframes cvp{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}' +
    '.cvh{display:flex;align-items:center;gap:8px;flex:none;padding:10px 10px 10px 16px;border-bottom:1px solid var(--line)}' +
    '.cvt{display:flex;flex-direction:column;min-width:0;flex:1}.cv-title{width:100%;min-width:0;padding:2px 0;border:0;border-bottom:1px solid transparent;background:none;color:var(--ink);font:700 15px Inter,sans-serif;outline:0}.cv-title:hover{border-bottom-color:var(--line)}.cv-title:focus{border-bottom-color:var(--ink2)}' +
    '.cv-kind{color:var(--ink2);font:500 11.5px Inter,sans-serif}' +
    '.cvv{display:inline-flex;align-items:center;gap:2px;flex:none;color:var(--ink2);font:600 11.5px Inter,sans-serif}.cvv[hidden]{display:none}' +
    '.cvb2{display:grid;place-items:center;flex:none;min-width:34px;height:34px;padding:0 9px;border:1px solid var(--line);border-radius:10px;background:none;color:var(--ink2);font:600 12px Inter,sans-serif;gap:6px;cursor:pointer;transition:background .15s,color .15s}' +
    '.cvb2.t{display:inline-flex;align-items:center}.cvb2 svg{width:16px;height:16px}.cvb2:hover:not(:disabled){background:var(--soft);color:var(--ink)}.cvb2:disabled{opacity:.4;cursor:default}.cvb2[hidden]{display:none}.cvb2.on{background:var(--soft);color:var(--ink);border-color:var(--ink2)}' +
    '.cvv .cvb2{min-width:28px;height:28px;padding:0;border-color:transparent}' +
    '.cva{display:flex;align-items:center;gap:6px;flex:none}' +
    '.cvbody{position:relative;flex:1;min-height:0;display:flex}' +
    '.cv-ed{flex:1;width:100%;min-height:0;resize:none;border:0;outline:0;margin:0;padding:18px 20px 28px;background:transparent;color:var(--ink);font:400 15px/1.75 Inter,system-ui,sans-serif;tab-size:2}' +
    '.cv-ed.code{font:400 13px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow:auto}' +
    '.cv-ed:read-only{opacity:.92}' +
    '.cv-pv{flex:1;min-height:0;overflow:auto;padding:18px 22px 30px;font-size:15px;line-height:1.7}.cv-pv[hidden]{display:none}.cv-pv h3{margin:18px 0 6px;font-size:18px}' +
    '.cvf{display:flex;justify-content:space-between;gap:10px;flex:none;padding:8px 16px;border-top:1px solid var(--line);color:var(--ink2);font:500 11.5px Inter,sans-serif}.cv-st.w{color:var(--ink)}' +
    /* rewrite bar (shows when text is selected) */
    '.cvsel{position:absolute;left:12px;right:12px;bottom:12px;z-index:3;display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--line);border-radius:16px;background:var(--card);box-shadow:0 14px 40px -10px rgba(0,0,0,.35);animation:cvin .2s ease-out}.cvsel[hidden]{display:none}' +
    '.cvs-h{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--ink2);font:600 11.5px Inter,sans-serif}.cvs-h b{display:inline-flex;align-items:center;gap:6px;color:var(--ink);font:700 12px Inter,sans-serif}.cvs-h b i{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#7c5cff,#22d3ee);box-shadow:0 0 8px rgba(124,92,255,.6)}' +
    '.cvs-q{display:flex;flex-wrap:wrap;gap:6px}.cvq{height:30px;padding:0 12px;border:1px solid var(--line);border-radius:99px;background:none;color:var(--ink);font:600 12px Inter,sans-serif;cursor:pointer;transition:background .15s,transform .1s}.cvq:hover:not(:disabled){background:var(--soft)}.cvq:active:not(:disabled){transform:scale(.96)}.cvq:disabled{opacity:.45;cursor:default}' +
    '.cvs-r{display:flex;gap:6px}.cvs-in{flex:1;min-width:0;height:34px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--soft);color:var(--ink);font:500 13px Inter,sans-serif;outline:0}.cvs-in:focus{border-color:var(--ink2)}.cvs-in:disabled{opacity:.5}' +
    '.cvs-go{flex:none;height:34px;padding:0 14px;border:0;border-radius:10px;background:var(--acc);color:var(--onacc);font:700 12px Inter,sans-serif;cursor:pointer}.cvs-go:disabled{opacity:.45;cursor:default}.cvs-go small{margin-left:5px;font-weight:500;opacity:.75}' +
    '.cvs-w{display:none;align-items:center;gap:8px;color:var(--ink);font:600 12.5px Inter,sans-serif}.cvsel.w .cvs-w{display:flex}.cvsel.w .cvs-q,.cvsel.w .cvs-r{display:none}.cvs-w .cvb2{margin-left:auto;height:28px}' +
    '.cv-undo{margin-left:10px;padding:0 8px;height:22px;border:1px solid var(--line);border-radius:99px;background:none;color:var(--ink);font:600 11px Inter,sans-serif;cursor:pointer}.cv-undo:hover{background:var(--soft)}.cv-undo[hidden]{display:none}' +
    '.cv-ed::selection{background:rgba(124,92,255,.32)}' +
    '@media (max-width:1179px){.ac-cvp{position:fixed;z-index:60;inset:0 0 0 auto;width:min(560px,100%);margin:0;border-width:0 0 0 1px;border-radius:0;box-shadow:-18px 0 60px -10px rgba(0,0,0,.45);padding-top:env(safe-area-inset-top,0px)}}' +
    '@media (max-width:700px){.ac-cvp{width:100%;border:0}.cvh{padding-left:12px}.cvb2.t span{display:none}.cvf{padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}.cv-ed{font-size:16px}.cv-ed.code{font-size:13px}}' +
    '@media (prefers-reduced-motion:reduce){.ac-cv,.ac-cvp{animation:none}}';
  document.head.appendChild(st);
})();

/* ---------- the panel ---------- */
let pan = null, ed, pv, ttl, kd, vs, vl, stt, cnt, bEd, bPv, bPdf, selb, selq, selc, selin, selgo, undo, rw = null, hist = [], cur = null, mode = 'edit', saveT = 0, ro = false, raf = 0;
const seen = new Set();
const isOpen = () => !!pan && !pan.hidden;
const last = () => { const a = msgsNow(); return a[a.length - 1]; };
const msgOf = id => msgsNow().find(x => x.id === id);
function entry() { if (!cur) return null; const m = msgOf(cur.id); if (!m) return null; const b = blocks(m.content)[cur.n]; return b ? { m, b } : null; }
const streaming = e => !e.b.closed || (!!(A().busy && A().busy()) && last() === e.m);
function st(t, w) { if (stt) { stt.textContent = t; stt.classList.toggle('w', !!w); } }

function build() {
  if (pan) return;
  pan = document.createElement('aside'); pan.className = 'ac-cvp'; pan.hidden = true; pan.setAttribute('aria-label', 'Canvas');
  pan.innerHTML =
    '<header class="cvh"><div class="cvt"><input class="cv-title" maxlength="80" aria-label="Canvas title"><small class="cv-kind"></small></div>' +
    '<div class="cvv" hidden><button type="button" class="cvb2" data-c="prev" aria-label="Older version">' + ico(I.prev) + '</button><span class="cv-vl"></span><button type="button" class="cvb2" data-c="next" aria-label="Newer version">' + ico(I.next) + '</button></div>' +
    '<div class="cva"><button type="button" class="cvb2 t" data-c="mode"></button><button type="button" class="cvb2" data-c="copy" aria-label="Copy" title="Copy">' + ico(I.copy) + '</button>' +
    '<button type="button" class="cvb2" data-c="dl" aria-label="Download" title="Download">' + ico(I.down) + '</button><button type="button" class="cvb2 t" data-c="pdf" title="Save as PDF">' + ico(I.pdf) + '<span>PDF</span></button>' +
    '<button type="button" class="cvb2" data-c="x" aria-label="Close Canvas" title="Close">' + ico(I.x) + '</button></div></header>' +
    '<div class="cvbody"><textarea class="cv-ed" spellcheck="true" aria-label="Canvas text"></textarea><div class="cv-pv ac-m a" hidden></div>' +
    '<div class="cvsel" hidden><div class="cvs-h"><b><i></i>Rewrite with Spectra</b><span class="cvs-c"></span></div><div class="cvs-q"></div>' +
    '<div class="cvs-r"><input class="cvs-in" maxlength="300" placeholder="Or tell her what to change..." aria-label="Rewrite instruction" autocomplete="off"><button type="button" class="cvs-go">Rewrite<small>1 credit</small></button></div>' +
    '<div class="cvs-w"><span class="ac-dots"><i></i><i></i><i></i></span><span>Spectra is rewriting...</span><button type="button" class="cvb2 t cvs-stop">Stop</button></div></div></div>' +
    '<footer class="cvf"><span><span class="cv-st">Saved</span><button type="button" class="cv-undo" hidden>Undo rewrite</button></span><span class="cv-n"></span></footer>';
  (document.getElementById('app') || document.body).appendChild(pan);
  ed = pan.querySelector('.cv-ed'); pv = pan.querySelector('.cv-pv'); ttl = pan.querySelector('.cv-title'); kd = pan.querySelector('.cv-kind');
  vs = pan.querySelector('.cvv'); vl = pan.querySelector('.cv-vl'); stt = pan.querySelector('.cv-st'); cnt = pan.querySelector('.cv-n');
  bEd = pan.querySelector('[data-c=mode]'); bPdf = pan.querySelector('[data-c=pdf]');
  selb = pan.querySelector('.cvsel'); selq = pan.querySelector('.cvs-q'); selc = pan.querySelector('.cvs-c'); selin = pan.querySelector('.cvs-in'); selgo = pan.querySelector('.cvs-go'); undo = pan.querySelector('.cv-undo');
  ['select', 'mouseup', 'keyup', 'touchend', 'input', 'focus'].forEach(t => ed.addEventListener(t, () => setTimeout(selUpdate, 0)));
  document.addEventListener('selectionchange', () => { if (document.activeElement === ed) selUpdate(); });
  selq.addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) rewrite(b.dataset.q, ''); });
  selgo.addEventListener('click', () => { const v = selin.value.trim(); if (v) rewrite('', v); else selin.focus(); });
  selin.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); selgo.click(); } });
  pan.querySelector('.cvs-stop').addEventListener('click', () => { if (rw) rw.abort(); });
  undo.addEventListener('click', undoRw);
  ed.addEventListener('input', () => { if (ro) return; st('Saving...'); clearTimeout(saveT); saveT = setTimeout(commit, 400); counts(); });
  ed.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey && !ro && ed.classList.contains('code')) { e.preventDefault(); const s = ed.selectionStart; ed.setRangeText('  ', s, ed.selectionEnd, 'end'); ed.dispatchEvent(new Event('input')); } });
  ttl.addEventListener('input', () => { const e = entry(); if (!e || ro) return; write(e.m, cur.n, { title: ttl.value }); persist(e.m); cardSync(e.m, cur.n); versions(); });
  pan.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) act(b.dataset.c); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen() && matchMedia('(max-width:1179px)').matches) { e.preventDefault(); close(); } });
}
function persist(m) { if (A().save) A().save(); }
function commit() {
  clearTimeout(saveT); saveT = 0;
  const e = entry(); if (!e || ro) return;
  if (e.b.body !== ed.value) { write(e.m, cur.n, { body: ed.value }); persist(e.m); cardSync(e.m, cur.n); }
  st('Saved');
}
function cardSync(m, n) {
  const c = document.querySelector('[data-mid="' + m.id + '"] .ac-cv[data-cv="' + n + '"]'), b = blocks(m.content)[n];
  if (!c || !b) return;
  const t = c.querySelector('b'), s = c.querySelector('small'); if (t) t.textContent = b.title; if (s) s.textContent = cardMeta(b);
}
function counts() { const e = entry(); if (!e) return; const b = { type: e.b.type, body: ed.value }; cnt.textContent = stat(b); }
function versions() {
  const e = entry(); if (!e) return { list: [], at: -1 };
  const list = [], key = e.b.title.toLowerCase();
  msgsNow().forEach(m => { if (m.role !== 'assistant' || !m.id) return; blocks(m.content || '').forEach((b, n) => { if (b.title.toLowerCase() === key) list.push({ m, n }); }); });
  const at = list.findIndex(x => x.m === e.m && x.n === cur.n);
  vs.hidden = list.length < 2 || at < 0;
  if (!vs.hidden) { vl.textContent = 'v' + (at + 1) + '/' + list.length; vs.querySelector('[data-c=prev]').disabled = at <= 0; vs.querySelector('[data-c=next]').disabled = at >= list.length - 1; }
  return { list, at };
}
function view() {
  const e = entry(), doc = !!e && e.b.type === 'doc', pre = doc && mode === 'preview';
  bEd.hidden = !doc; bPdf.hidden = !doc;
  bEd.innerHTML = ico(pre ? I.edit : I.eye) + '<span>' + (pre ? 'Edit' : 'Preview') + '</span>';
  ed.hidden = pre; pv.hidden = !pre; if (pre && selb) selb.hidden = true;
  if (pre && e) { pv.innerHTML = A().md ? A().md(ed.value) : esc(ed.value).replace(/\n/g, '<br>'); if (A().math) A().math(pv); }
}
function fill(force) {
  const e = entry(); if (!e) { close(); return; }
  const live = streaming(e);
  ro = live; ed.readOnly = live || !!rw; ed.classList.toggle('code', e.b.type !== 'doc'); ed.wrap = e.b.type === 'doc' ? 'soft' : 'off';
  if (document.activeElement !== ttl || force) ttl.value = e.b.title; ttl.readOnly = live;
  kd.textContent = kind(e.b);
  if (force || live || document.activeElement !== ed) { if (ed.value !== e.b.body) ed.value = e.b.body; }
  if (live) { ed.scrollTop = ed.scrollHeight; st('Spectra is writing...', true); } else if (!saveT) st('Saved');
  if (e.b.type !== 'doc') mode = 'edit';
  counts(); versions(); view(); selUpdate();
}
function open(m, n) {
  if (!m || !m.id) return;
  if (isOpen() && cur && saveT) commit();
  build(); if (!cur || cur.id !== m.id || cur.n !== (n | 0)) { hist = []; undo.hidden = true; if (rw) rw.abort(); } cur = { id: m.id, n: n | 0 }; pan.hidden = false; const b0 = blocks(m.content)[cur.n]; if (!b0 || b0.type !== 'doc') mode = 'edit';
  fill(true);
}
function close() { if (rw) rw.abort(); if (saveT) commit(); if (pan) pan.hidden = true; cur = null; hist = []; if (undo) undo.hidden = true; }
function act(c) {
  const e = entry(); if (!e && c !== 'x') return;
  if (c === 'x') return close();
  if (c === 'mode') { if (saveT) commit(); mode = mode === 'preview' ? 'edit' : 'preview'; return view(); }
  if (c === 'copy') { if (saveT) commit(); return clip(ed.value).then(() => A().toast && A().toast('Copied')); }
  if (c === 'dl') { if (saveT) commit(); return download(e.b.title, e.b.type, ed.value); }
  if (c === 'pdf') { if (saveT) commit(); return A().pdf ? A().pdf(ed.value, e.b.title) : (A().toast && A().toast('PDF is not ready yet')); }
  if (c === 'prev' || c === 'next') { if (saveT) commit(); const v = versions(), t = v.list[v.at + (c === 'next' ? 1 : -1)]; if (t) open(t.m, t.n); }
}
function clip(t) {
  return (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).catch(() => { const x = document.createElement('textarea'); x.value = t; x.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); } catch (e) { } x.remove(); });
}
function download(title, type, text) {
  const name = (String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'canvas') + '.' + (type === 'doc' ? 'md' : (EXT[type] || 'txt'));
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- highlight-to-rewrite ---------- */
const QUICK = {
  doc: [['shorter', 'Shorter'], ['simpler', 'Simpler'], ['longer', 'Longer'], ['grammar', 'Fix grammar']],
  code: [['comments', 'Add comments'], ['simpler', 'Simplify'], ['fix', 'Fix bugs']]
};
const eqOn = () => { const q = window.SpectraEquip; try { if (!q) return true; const e = q.get(); return e.caps.indexOf('canvas') >= 0 && e.skill !== 'socratic' && e.skill !== 'hints'; } catch (e) { return true; } };   // capability on and no answer-hiding skill (Socratic Tutor, Step by Step Hint); the server checks this too
function selUpdate() {
  if (!selb || rw) return;
  const e = entry(), a = ed.selectionStart, z = ed.selectionEnd, txt = e ? ed.value.slice(a, z) : '';
  const on = !!e && !ro && !ed.hidden && !ed.readOnly && eqOn() && z > a && txt.trim().length > 0;
  selb.hidden = !on; if (!on) return;
  const k = e.b.type === 'doc' ? 'doc' : 'code';
  if (selq.dataset.k !== k) { selq.dataset.k = k; selq.innerHTML = QUICK[k].map(x => '<button type="button" class="cvq" data-q="' + x[0] + '">' + x[1] + '</button>').join(''); }
  selc.textContent = k === 'doc' ? words(txt) + ' words selected' : lines(txt) + ' lines selected';
}
function tidy(out, sel) {
  let t = String(out).replace(/\r/g, '').trim();
  const fence = t.match(/^```[a-z0-9+#._-]*\n([\s\S]*?)\n?```$/i);
  if (fence && !/^\s*```/.test(sel)) t = fence[1];
  if (/^"[\s\S]*"$/.test(t) && !/^\s*"/.test(sel)) t = t.slice(1, -1);
  return (sel.match(/^\s*/)[0]) + t.trim() + (sel.match(/\s*$/)[0]);   // keep the spaces and line breaks around the selection
}
function toast(t) { if (A().toast) A().toast(t); }
async function rewrite(q, ins) {
  if (rw || ro || !cur) return;
  const e = entry(); if (!e) return;
  const full = ed.value, s = ed.selectionStart, t = ed.selectionEnd, sel = full.slice(s, t);
  if (!sel.trim()) return;
  if (sel.length > 6000) { toast('Select a smaller part (about 6000 characters max)'); return; }
  if (!A().ask) { toast('Rewrite is not ready yet'); return; }
  if (saveT) commit();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 60000), at = { id: cur.id, n: cur.n };
  rw = ctl; selb.classList.add('w'); selb.hidden = false; ed.readOnly = true; selin.value = ''; st('Rewriting...', true);
  let out = '', fail = '';
  try {
    await A().ask(tok => { out += tok; }, ctl.signal, { mode: 'rewrite', rewrite: { q: q || undefined, ins: ins || undefined, sel, before: full.slice(Math.max(0, s - 1200), s), after: full.slice(t, t + 1200), type: e.b.type, title: e.b.title } });
  } catch (x) {
    fail = x && x.name === 'AbortError' ? 'stopped' : x && x.st === 429 ? 'Daily credit limit reached' : x && x.st === 422 ? 'Spectra will not rewrite that one' : x && x.st === 403 ? 'Turn on Persistent Canvas in Skills & Capabilities (it pauses while Socratic Tutor or Step by Step Hint is on)' : x && x.message === 'LOGIN' ? 'Log in first' : 'Rewrite failed, no credit lost. Try again';
  }
  clearTimeout(timer); rw = null; selb.classList.remove('w');
  const same = isOpen() && cur && cur.id === at.id && cur.n === at.n && ed.value === full;   // panel closed or switched meanwhile: drop the result
  if (same) ed.readOnly = false;
  const res = fail ? '' : tidy(out, sel);
  if (!same) { st('Saved'); return; }
  if (fail || !res.trim()) { st('Saved'); if (fail !== 'stopped') toast(fail || 'Spectra sent nothing back, try again'); selUpdate(); return; }
  hist.push(full); if (hist.length > 10) hist.shift();
  ed.setRangeText(res, s, t, 'select'); ed.focus(); ed.dispatchEvent(new Event('input'));
  undo.hidden = false; toast('Rewritten. Tap Undo rewrite if you do not like it');
  selUpdate();
}
function undoRw() {
  if (!hist.length || ro || rw) return;
  ed.value = hist.pop(); ed.dispatchEvent(new Event('input')); undo.hidden = !hist.length; selUpdate();
}

/* the newest canvas of a chat when it is too old to be among the messages the page sends (the page passes it along as extra context) */
function older(all, sent) {
  if (!eqOn()) return null;
  if (sent.some(m => m.role === 'assistant' && String(m.content || '').indexOf('~~~canvas') >= 0)) return null;
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i]; if (!m || m.role !== 'assistant' || String(m.content || '').indexOf('~~~canvas') < 0) continue;
    const bs = blocks(m.content), b = bs[bs.length - 1];
    if (b && b.closed && b.body.trim()) return { type: b.type, title: b.title, text: b.body.slice(0, 24000) };
  }
  return null;
}

/* hooks the page calls */
function live(a) {   // every streamed token of an answer that holds a canvas
  if (!a || !a.id || String(a.content).indexOf('~~~canvas') < 0) return;
  const n = blocks(a.content).length - 1; if (n < 0) return;
  const key = a.id + ':' + n;
  if (!seen.has(key)) { seen.add(key); if (isOpen() || matchMedia('(min-width:1180px)').matches) open(a, n); return; }
  if (isOpen() && cur && cur.id === a.id && cur.n === n && !raf) raf = requestAnimationFrame(() => { raf = 0; const e = entry(); if (!e) return; ed.value = e.b.body; ed.scrollTop = ed.scrollHeight; ttl.value = e.b.title; kd.textContent = kind(e.b); counts(); });
}
function refresh() {   // after the page redraws: stream finished, chat switched, message deleted
  if (!isOpen()) return;
  const e = entry(); if (!e) { close(); return; }
  fill(ro && !streaming(e));
}
document.addEventListener('click', e => {
  const c = e.target.closest('.ac-cv'); if (!c || c.classList.contains('ld')) return;
  const w = c.closest('[data-mid]'), m = w && msgOf(w.dataset.mid); if (m) open(m, +c.dataset.cv);
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ac-cv') && !e.target.classList.contains('ld')) { e.preventDefault(); e.target.click(); }
});
window.SpectraCanvas = { hide, strip, open, close, live, refresh, blocks, isOpen, older };
})();
