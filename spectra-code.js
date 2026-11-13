/* SPECSOFT® Spectra Code IDE. Load AFTER main.js. Talks to the Supabase Edge Function "spectra-code".
   Flow: Spectra PLANS -> Spectres write files IN PARALLEL -> you review (Review tab / diff) -> edit in the built-in editor -> run the live preview. */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const EFF = ['low', 'medium', 'high', 'xhigh'], EFFN = ['Low', 'Medium', 'High', 'Extra High'];
let P = LS('sc_projects', []), cur = LS('sc_cur', null), busy = false, ctl = null, tick = null, mode = 'build', view = 'exp', bt = 'term', showDiff = false, showVer = false, verI = null, sq = '', lastSel = null, saveT = null, pvT = null, center = 'chat', ptab = 'props';
const fold = new Set();
function mk(name) { return { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 5), name, t: Date.now(), msgs: [], files: {}, open: [], sel: null }; }
if (!P.length) { P = [mk('New chat')]; cur = P[0].id; }
if (!P.find(p => p.id === cur)) cur = P[0].id;
const proj = () => { const p = P.find(x => x.id === cur); p.open = (p.open || []).filter(n => p.files[n]); if (p.sel && !p.files[p.sel]) p.sel = p.open[0] || null; return p; };
const save = () => { SS('sc_projects', P); SS('sc_cur', cur); };
const okPath = n => /^[\w][\w./-]{0,60}$/.test(n) && !n.includes('..') && !n.endsWith('/');

const nick = () => { const c = LS('sa.cfg', {}), el = $('[data-user-name]'); return String(c.nick || (el && el.textContent) || '').trim().slice(0, 20); };
async function req(body, signal) {
  const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session;
  if (!s) throw new Error('LOGIN');
  return fetch(window.SPECSOFT_CONFIG.SUPABASE_URL + '/functions/v1/spectra-code', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: window.SPECSOFT_CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify({ ...body, nick: nick(), hour: new Date().getHours() }) });
}

/* ---------- diff (line based) ---------- */
function diff(a, b) {
  const A = a ? a.split('\n') : [], B = b.split('\n');
  if (A.length * B.length > 360000) return B.map((l, i) => ({ k: '+', n: i + 1, l }));
  const m = A.length, n = B.length, L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let k = n - 1; k >= 0; k--) L[i][k] = A[i] === B[k] ? L[i + 1][k + 1] + 1 : Math.max(L[i + 1][k], L[i][k + 1]);
  const o = []; let i = 0, k = 0;
  while (i < m && k < n) { if (A[i] === B[k]) { o.push({ k: ' ', n: k + 1, l: B[k] }); i++; k++; } else if (L[i + 1][k] >= L[i][k + 1]) { o.push({ k: '-', n: i + 1, l: A[i] }); i++; } else { o.push({ k: '+', n: k + 1, l: B[k] }); k++; } }
  while (i < m) { o.push({ k: '-', n: i + 1, l: A[i++] }); } while (k < n) { o.push({ k: '+', n: k + 1, l: B[k++] }); }
  return o;
}
const stat = d => ({ a: d.filter(x => x.k === '+').length, d: d.filter(x => x.k === '-').length });
const statH = s => `<span class="sc-stat"><i class="a">+${s.a}</i>${s.d ? '<i class="d">−' + s.d + '</i>' : ''}</span>`;
function dview(d, max) {
  const keep = new Set(); d.forEach((x, i) => { if (x.k !== ' ') for (let q = i - 2; q <= i + 2; q++) keep.add(q); });
  let h = '', gap = 0, rows = 0;
  d.forEach((x, i) => {
    if (!keep.has(i)) { gap++; return; }
    if (gap) { h += `<div class="sc-gap">${gap} unmodified lines</div>`; gap = 0; }
    if (++rows > max) return;
    h += `<div class="sc-l ${x.k === '+' ? 'a' : x.k === '-' ? 'd' : ''}"><i>${x.n}</i><code>${esc(x.l) || ' '}</code></div>`;
  });
  if (gap) h += `<div class="sc-gap">${gap} unmodified lines</div>`;
  if (rows > max) h += `<div class="sc-gap">${rows - max} more lines</div>`;
  return h;
}
const fdiff = f => diff(f.old || '', f.content);
const log = t => { const el = $('#scTerm'); el.textContent += '[' + new Date().toLocaleTimeString() + '] ' + t + '\n'; el.scrollTop = 1e9; };

/* ---------- syntax highlighting ---------- */
const KW = 'const|let|var|function|return|if|else|for|while|class|new|import|export|from|default|async|await|try|catch|throw|true|false|null|undefined|this|switch|case|break|typeof|of|in|def|elif|None|True|False|self|lambda|local|then|end|nil|not|and|or|do';
const STR = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/.source;
const mkrx = (c, k) => new RegExp('(' + c + ')|' + STR + '|\\b(\\d[\\d.]*)\\b|\\b(' + k + ')\\b', 'g');
const RX = {
  js: [mkrx('\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/', KW), 'c s n k'], py: [mkrx('#.*', KW), 'c s n k'], lua: [mkrx('--.*', KW), 'c s n k'],
  css: [/(\/\*[\s\S]*?\*\/)|("[^"]*"|'[^']*')|(#[0-9a-fA-F]{3,8}\b|\b\d[\d.]*(?:px|em|rem|%|vh|vw|s|ms|deg)?)|([\w-]+(?=\s*:)|@[\w-]+)/g, 'c s n k'],
  html: [/(<!--[\s\S]*?-->)|("[^"]*"|'[^']*')|(<\/?[a-zA-Z][\w-]*|\/?>)/g, 'c s k']
};
const lang = n => ({ js: 'js', mjs: 'js', ts: 'js', json: 'js', py: 'py', lua: 'lua', luau: 'lua', css: 'css', html: 'html', htm: 'html', xml: 'html', svg: 'html' }[(n.split('.').pop() || '').toLowerCase()] || 'txt');
function hl(src, l) {
  const r = RX[l]; if (!r) return esc(src);
  const re = r[0], cl = r[1].split(' '); re.lastIndex = 0; let o = '', i = 0, m;
  while ((m = re.exec(src))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const g = cl[m.slice(1).findIndex(x => x !== undefined)];
    o += esc(src.slice(i, m.index)) + `<span class="t${g}">${esc(m[0])}</span>`; i = m.index + m[0].length;
  }
  return o + esc(src.slice(i));
}
function lint(n) {
  const f = proj().files[n], l = lang(n); if (!f) return null;
  try {
    if (/\.json$/i.test(n)) JSON.parse(f.content);
    else if (l === 'js' && !/\.ts$/i.test(n) && !/^\s*(import|export)\s/m.test(f.content)) new Function(f.content);
  } catch (e) { if (e instanceof SyntaxError) return e.message; }
  return null;
}

/* ---------- editor ---------- */
function paint() {
  const p = proj(), f = p.files[p.sel]; if (!f) return;
  $('#hl').innerHTML = hl(f.content, lang(p.sel)) + '\n';
  $('#gut').textContent = Array.from({ length: f.content.split('\n').length }, (_, i) => i + 1).join('\n');
}
function etabs() {
  const p = proj();
  $('#edTabs').innerHTML = `<button class="ed-t ${center === 'chat' ? 'on' : ''}" data-chat>◆ Spectra</button>` + p.open.map(n => `<button class="ed-t ${center === 'file' && n === p.sel ? 'on' : ''}" data-open="${esc(n)}"><span>${esc(n.split('/').pop())}</span>${p.files[n].dirty ? '<i>●</i>' : ''}${p.files[n].err ? '<i style="color:#ff8d86">!</i>' : ''}<u data-cl="${esc(n)}">×</u></button>`).join('');
}
function renderEd() {
  const p = proj(), f = p.files[p.sel], q = esc(p.sel || ''); if (!f) center = 'chat'; etabs(); $('#chat').hidden = center !== 'chat'; $('#edMain').hidden = center !== 'file'; if (center !== 'file') { $('#edAct').innerHTML = '<button class="sc-btn ok" data-run>▶ Run</button>'; return; }
  $('#edAct').innerHTML = (f ? (f.state === 'pending' ? `<button class="sc-btn ok" data-acc="${q}">Accept</button><button class="sc-btn" data-rej="${q}">Reject</button>` : '')
    + `<button class="sc-btn ${showDiff ? 'on' : ''}" data-alt="diff">Diff</button><button class="sc-btn ${showVer ? 'on' : ''}" data-alt="ver">History</button><button class="sc-btn" data-cp="${q}">Copy</button><button class="sc-btn" data-dl="${q}">Download</button>` : '') + '<button class="sc-btn ok" data-run>▶ Run</button>';
  const alt = f && (showDiff || showVer);
  $('#edEmpty').hidden = !!f; $('#edWrap').hidden = !f || !!alt; $('#edAlt').hidden = !alt;
  if (alt) {
    if (showVer) {
      const vs = f.versions || [], vi = verI == null || verI >= vs.length ? vs.length - 1 : verI;
      $('#edAlt').innerHTML = vs.length ? `<div class="sc-vers">${vs.map((v, i) => `<button class="sc-btn ${i === vi ? 'on' : ''}" data-ver="${i}">v${i + 1} · ${new Date(v.t).toLocaleTimeString()}</button>`).join('')}${vi !== vs.length - 1 ? `<button class="sc-btn ok" data-restore="${vi}">Restore this version</button>` : ''}</div>`
        + vs[vi].content.split('\n').slice(0, 800).map((l, i) => `<div class="sc-l"><i>${i + 1}</i><code>${esc(l) || ' '}</code></div>`).join('') : '<p class="sc-note">No versions yet. Press Ctrl+S to save one.</p>';
    } else $('#edAlt').innerHTML = dview(fdiff(f), 800) || '<p class="sc-note">No changes against the previous version.</p>';
  } else if (f) {
    const t = $('#ta'); if (t.value !== f.content) t.value = f.content;
    if (lastSel !== p.sel) { t.scrollTop = 0; t.scrollLeft = 0; lastSel = p.sel; }
    paint(); pos();
  }
}
function pos() {
  const t = $('#ta'), el = $('#sbPos'); if (!el) return;
  const v = t.value.slice(0, t.selectionStart).split('\n'), n = t.selectionEnd - t.selectionStart;
  el.textContent = 'Ln ' + v.length + ', Col ' + (v[v.length - 1].length + 1) + (n ? ' (' + n + ' selected)' : '');
}
function renderSt() {
  const p = proj(), er = Object.values(p.files).filter(f => f.err).length;
  $('#sb').innerHTML = `<span>⎇ ${esc(p.name)}</span><span class="${er ? 'bad' : ''}">${er ? '✗ ' + er + ' problem' + (er > 1 ? 's' : '') : '✓ no problems'}</span><em></em><span id="sbPos"></span><span>${p.sel ? lang(p.sel).toUpperCase() : ''}</span><span>${mode}</span><span>Spaces: 2</span>`;
  pos();
}
function openF(n, df) {
  const p = proj(); if (!p.files[n]) return;
  if (!p.open.includes(n)) p.open.push(n);
  p.sel = n; center = 'file'; showDiff = !!df; showVer = false; verI = null; save(); ui();
  if (!df) setTimeout(() => $('#ta').focus(), 0);
}
function closeF(n) { const p = proj(), i = p.open.indexOf(n); p.open = p.open.filter(x => x !== n); if (p.sel === n) p.sel = p.open[Math.min(i, p.open.length - 1)] || null; save(); ui(); }
function goto(n, line) {
  openF(n); const f = proj().files[n], ls = f.content.split('\n'), off = ls.slice(0, line).join('\n').length + (line ? 1 : 0), t = $('#ta');
  setTimeout(() => { t.focus(); t.setSelectionRange(off, off + ls[line].length); t.scrollTop = Math.max(0, (line - 4) * 20); pos(); }, 0);
}
function saveF() {
  const p = proj(), f = p.files[p.sel]; if (!f) return;
  const vs = f.versions = f.versions || [];
  if (!vs.length || vs[vs.length - 1].content !== f.content) vs.push({ t: Date.now(), content: f.content });
  f.versions = vs.slice(-10); f.dirty = false; f.err = lint(p.sel); save();
  log(f.err ? '✗ ' + p.sel + ': ' + f.err : '✓ saved ' + p.sel); ui();
  if (ptab === 'prev' && !$('#app').classList.contains('no-ai')) run();
}
function newF() {
  const n = (prompt('New file path (e.g. src/app.js)') || '').trim().replace(/\s+/g, '-'); if (!n) return;
  const p = proj(); if (!okPath(n) || p.files[n]) { log('✗ invalid or existing path: ' + n); return; }
  p.files[n] = { content: '', old: '', state: 'accepted', versions: [] }; openF(n);
}
function renF(n) {
  const x = (prompt('Rename to', n) || '').trim(), p = proj(); if (!x || x === n) return;
  if (!okPath(x) || p.files[x]) { log('✗ invalid or existing path: ' + x); return; }
  p.files[x] = p.files[n]; delete p.files[n]; p.open = p.open.map(o => o === n ? x : o); if (p.sel === n) p.sel = x; save(); ui();
}
function delF(n) { if (!confirm('Delete ' + n + '?')) return; delete proj().files[n]; closeF(n); }
const acceptAll = () => { Object.values(proj().files).forEach(f => { f.state = 'accepted'; }); save(); ui(); };

/* ---------- preview ---------- */
function srcdoc() {
  const p = proj(), F = p.files, hn = /\.html?$/i.test(p.sel || '') ? p.sel : F['index.html'] ? 'index.html' : Object.keys(F).find(n => /\.html?$/i.test(n)); if (!hn) return null;
  const rd = u => { u = u.replace(/^\.?\//, ''); return F[u] ? F[u].content : null; };
  const shim = '<script>(function(){var s=function(t,a){parent.postMessage({sc:t,m:[].map.call(a,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" ")},"*")};["log","warn","error"].forEach(function(k){var o=console[k];console[k]=function(){s(k,arguments);o.apply(console,arguments)}});addEventListener("error",function(e){s("error",[e.message+" (line "+(e.lineno||0)+")"])})})()<\/script>';
  return '<style>html{scrollbar-width:none}::-webkit-scrollbar{display:none}</style>' + shim + F[hn].content
    .replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi, (m, u) => { const c = rd(u); return c == null ? m : '<style>' + c + '</style>'; })
    .replace(/<script([^>]*)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, u, b) => { const c = rd(u); return c == null ? m : '<script' + a + b + '>' + c.replace(/<\/script/gi, '<\\/script') + '<\/script>'; });
}
function btab() { $('#bt').hidden = false; }
function ptabs(k) { ptab = k; $$('.pp-h [data-pt]').forEach(b => b.classList.toggle('on', b.dataset.pt === k)); $('#ppB').hidden = k !== 'props'; $('#pv').hidden = k !== 'prev'; }
function run() {
  const s = srcdoc(); if (s == null) { log('✗ preview: no .html file in this project'); btab(); return; }
  $('#app').classList.remove('no-ai'); if ($('.pp').offsetWidth < 480) setSize('aw', 560);
  ptabs('prev'); $('#pv').srcdoc = s; log('▶ preview refreshed');
}
window.addEventListener('message', e => { if (e.source === $('#pv').contentWindow && e.data && e.data.sc) log('[preview ' + e.data.sc + '] ' + e.data.m); });

/* ---------- sidebar ---------- */
function tree() {
  const p = proj(), seen = new Set(); let h = '';
  Object.keys(p.files).sort().forEach(n => {
    const pr = n.split('/'), up = i => pr.slice(0, i).join('/');
    for (let i = 1; i < pr.length; i++) {
      const d = up(i); if (seen.has(d)) continue; seen.add(d);
      if (!pr.slice(0, i - 1).some((_, k) => fold.has(up(k + 1)))) h += `<div class="tr dir" style="--d:${i - 1}" data-fold="${esc(d)}">${fold.has(d) ? '▸' : '▾'} ${esc(pr[i - 1])}</div>`;
    }
    if (pr.slice(0, -1).some((_, k) => fold.has(up(k + 1)))) return;
    const f = p.files[n], q = esc(n);
    h += `<div class="tr ${n === p.sel ? 'on' : ''}" style="--d:${pr.length - 1}" data-open="${q}"><i class="sd2 ${f.state}"></i><span>${esc(pr[pr.length - 1])}</span>${f.old ? '<i style="color:#ffb86b">M</i>' : ''}<b class="act"><u data-ren="${q}">✎</u><u data-del="${q}">🗑</u></b></div>`;
  });
  return h;
}
function results() {
  if (!sq) return ''; const q = sq.toLowerCase(); let h = '';
  Object.entries(proj().files).forEach(([n, f]) => {
    const hit = []; f.content.split('\n').forEach((l, i) => { if (hit.length < 6 && l.toLowerCase().includes(q)) hit.push([i, l]); });
    if (hit.length) h += `<div class="sr-f">${esc(n)}</div>` + hit.map(([i, l]) => `<div class="tr sr-l" data-go="${esc(n)}:${i}"><i>${i + 1}</i><span>${esc(l.trim().slice(0, 80))}</span></div>`).join('');
  });
  return h || '<p class="sc-note">No matches.</p>';
}
function renderSide() {
  const p = proj(), H = { exp: 'Explorer', search: 'Search', git: 'Review', chats: 'Chats' }, pend = Object.entries(p.files).filter(([, f]) => f.state === 'pending');
  $('#sdH').innerHTML = `<span>${H[view]}</span>` + (view === 'exp' ? '<button class="sc-btn" data-newf>+ File</button>' : view === 'chats' ? '<button class="sc-btn" data-newp>+ New chat</button>' : '');
  $$('.ab [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === view)); $('#gitN').textContent = pend.length || '';
  let h = '';
  if (view === 'exp') h = Object.keys(p.files).length ? tree() : '<p class="sc-note">No files yet. Create one, import some from the + menu in the Spectra panel, or tell Spectra what to build.</p>';
  else if (view === 'search') h = `<input id="sq" class="sq" placeholder="Search in files" value="${esc(sq)}"><div id="sr">${results()}</div>`;
  else if (view === 'git') h = pend.length ? '<div class="sd-p"><button class="sc-btn ok" data-all>Accept all</button></div>' + pend.map(([n, f]) => { const q = esc(n); return `<div class="tr" data-open="${q}" data-df="1"><i class="sd2 pending"></i><span>${q}</span>${statH(stat(fdiff(f)))}<b class="act always"><u data-acc="${q}">✓</u><u data-rej="${q}">✕</u></b></div>`; }).join('') : '<p class="sc-note">Nothing to review. Files your Spectres write show up here.</p>';
  else {
    const grp = t => { const d = (Date.now() - (t || 0)) / 864e5; return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : 'Earlier'; }; let last = '';
    h = [...P].sort((a, b) => (b.t || 0) - (a.t || 0)).map(x => {
      const n = Object.keys(x.files).length, g = grp(x.t), um = [...x.msgs].reverse().find(m => m.r === 'u'), hd = g !== last ? `<div class="sr-f">${g}</div>` : ''; last = g;
      return hd + `<div class="tr pr ${x.id === cur ? 'on' : ''}" data-id="${x.id}"><span>${esc(x.name)}</span><small>${um ? esc(um.t.slice(0, 48)) : 'Empty chat'} · ${n} file${n === 1 ? '' : 's'}</small>${P.length > 1 ? `<b class="act"><u data-x="${x.id}">🗑</u></b>` : ''}</div>`;
    }).join('');
  }
  $('#sdB').innerHTML = h;
  if (view === 'search' && document.activeElement === document.body) { const i = $('#sq'); if (i) i.focus(); }
}
function setV(v) { view = v; $('#app').classList.remove('no-sd'); renderSide(); if (v === 'search') $('#sq').focus(); }
const tog = c => $('#app').classList.toggle(c);
const togBt = () => { if ($('#bt').hidden) btab(bt); else $('#bt').hidden = true; };
function renderProps() {
  const p = proj(), F = p.files, ns = Object.keys(F), pend = ns.filter(n => F[n].state === 'pending'), tot = ns.reduce((a, n) => { const s = stat(fdiff(F[n])); a.a += s.a; a.d += s.d; return a; }, { a: 0, d: 0 });
  const f = F[p.sel], last = [...p.msgs].reverse().find(x => x.sp), sp = last ? last.sp : [], row = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  $('#ppB').innerHTML = `<div class="sc-sec"><b>${esc(p.name)}</b><p>${esc(p.summary || 'Nothing built yet. Tell Spectra what to build.')}</p></div>`
    + `<div class="sc-sec">${row('Files', ns.length)}${row('To review', pend.length)}${row('Added', '+' + tot.a)}${row('Removed', '−' + tot.d)}${row('Messages', p.msgs.length)}</div>`
    + (f ? `<div class="sc-sec"><b>${esc(p.sel)}</b>${row('Language', lang(p.sel).toUpperCase())}${row('Lines', f.content.split('\n').length)}${row('Size', (f.content.length / 1024).toFixed(1) + ' KB')}${row('Status', f.state)}${row('Versions', (f.versions || []).length)}${row('Problems', f.err ? esc(f.err) : 'none')}</div>` : '')
    + (sp.length ? '<div class="sc-sec"><b>Spectres</b><div class="sc-tree">' + sp.map((s, i) => spCard(s, i === sp.length - 1)).join('') + '</div></div>' : '')
    + `<div class="sc-sec"><button class="sc-btn ok" data-run>▶ Run preview</button>${pend.length ? '<button class="sc-btn" data-all>Accept all</button>' : ''}<button class="sc-btn" data-t="dl">Download all</button></div>`;
}
function ui() { renderSide(); renderEd(); renderSt(); renderProps(); }

/* ---------- chat render ---------- */
function renderMsgs() {
  const m = proj().msgs, box = $('#scMsgs');
  box.innerHTML = m.length ? m.map(x => x.r === 'u' ? `<div class="sc-m u"><b>❯</b> ${esc(x.t)}</div>` : `<div class="sc-m ${x.err ? 'err' : ''}"><b class="sc-bul">●</b>${esc(x.t)}${x.sp ? '<div class="sc-tree">' + x.sp.map((s, i) => spCard(s, i === x.sp.length - 1)).join('') + '</div>' : ''}${x.files ? editCards(x.files) : ''}${x.go ? '<div><button class="sc-btn ok" data-go style="margin-top:10px">Build this plan</button></div>' : ''}</div>`).join('')
    : '<div class="sc-empty"><pre>  ◆ SPECTRA\n  Lumen 4 · Spectres online</pre>tell me what to build 😤 i plan it, then my Spectres write the files at the same time.<br><br>Ctrl+K commands · Ctrl+P open file · Ctrl+Enter run<span class="sc-cur"></span></div>';
  box.scrollTop = 1e9;
}
const editCards = names => { const f = proj().files, ok = names.filter(n => f[n]); return ok.length ? `<div class="sc-edit"><b class="sc-bul">●</b>Edited ${ok.length} file${ok.length > 1 ? 's' : ''}<div class="sc-tree">${ok.map((n, i) => `<button class="sc-tr sc-o" data-open="${esc(n)}" data-df="1"><span class="sc-br">${i === ok.length - 1 ? '└' : '├'}</span><em>${f[n].old ? 'M' : 'A'}</em><span class="sc-tt">${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button>`).join('')}</div></div>` : ''; };
const spCard = (s, last) => `<div class="sc-tr" data-sid="${s.id}"><span class="sc-br">${last ? '└' : '├'}</span><span class="sc-role">${s.role}</span><span class="sc-tt">${esc(s.title)}<small>${esc(s.files.join(', '))}</small></span><span class="sc-st" data-s="${s.st}">${s.st}</span></div>`;

/* ---------- build ---------- */
function status(on, txt) {
  const el = $('#scStatus'); el.hidden = !on; clearInterval(tick);
  if (!on) return;
  const t0 = Date.now(); $('#scStatusTxt').textContent = txt;
  tick = setInterval(() => { const tok = Math.round(Object.values(proj().files).reduce((a, f) => a + f.content.length, 0) / 4); $('#scStatusMeta').textContent = '(esc to stop · ' + Math.round((Date.now() - t0) / 1000) + 's · ↓ ' + tok + ' tokens)'; }, 500);
}
const setSt = (m, id, st) => { const s = m.sp.find(x => x.id === id); if (s) s.st = st; const c = document.querySelector(`[data-sid="${id}"] .sc-st`); if (c) { c.textContent = st; c.dataset.s = st; } };
const say = (t, extra) => { const p = proj(); const m = Object.assign({ r: 'a', t }, extra); p.msgs.push(m); save(); renderMsgs(); return m; };
const done = () => { save(); status(false); busy = false; ctl = null; $('#scSend').disabled = false; renderMsgs(); ui(); };
const fail = (e, m) => {
  const msg = e.name === 'AbortError' ? 'stopped 🫡' : { LOGIN: 'log in first bro, the Spectres only work for logged-in people 🫡', DAILY: 'you burned through all your Spectra credits for today 😭 they reset at midnight UTC.', RATE: 'slow down bro, too many requests 😤 give it a minute.', UPSTREAM: 'my brain didn\'t answer 😭 check the spectra-code function logs in Supabase (GEMINI_API_KEY and model names), then try again.' }[e.message] || 'couldn\'t plan that one 😭 try again or make the request simpler.';
  if (m && m.sp) m.sp.forEach(s => { if (s.st === 'Running' || s.st === 'Queued') s.st = 'Cancelled'; });
  say(msg, { err: 1 }); log('error: ' + e.message);
};
const ctxFiles = () => { const p = proj(); return Object.entries(p.files).sort(([a], [b]) => (b === p.sel) - (a === p.sel)).slice(0, 6).map(([path, f]) => ({ path, content: f.content.slice(0, 8000) })); };
function renderMode() {
  const el = $('#scModes'); el.hidden = mode === 'build';
  el.innerHTML = mode === 'build' ? '' : `<span class="sc-chip">${mode === 'plan' ? 'Plan Mode' : 'Ask Spectra'}<u data-m="off">×</u></span><span>${mode === 'plan' ? 'Plan first, approve before building.' : 'No files get written.'}</span>`;
  $('#scIn').placeholder = mode === 'ask' ? 'Ask Spectra about your code...' : mode === 'plan' ? 'Describe what to build. Spectra will plan it first.' : 'Tell Spectra what to build. Enter to send, Shift+Enter for a new line.';
  renderSt();
}
const setMode = m => { mode = mode === m ? 'build' : m; renderMode(); };
async function exec(m, plan, text, effort, model) {
  const p = proj(), changed = new Set(), notes = [];
  status(true, 'Deploying ' + m.sp.length + ' Spectres...');
  await Promise.all(m.sp.map(async s => {
    setSt(m, s.id, 'Running'); log(s.role + ' ' + s.id + ' -> ' + s.files.join(', '));
    try {
      const rr = await req({ mode: 'spectre', prompt: text, effort, model, summary: plan.summary, contract: plan.contract, task: s, files: ctxFiles() }, ctl.signal);
      if (!rr.ok) throw new Error('fail');
      const out = await rr.json(); if (out.note) notes.push(String(out.note).slice(0, 160));
      out.files.forEach(f => {
        const pv = p.files[f.path], vs = (pv ? (pv.versions || [{ t: Date.now(), content: pv.content }]) : []).concat([{ t: Date.now(), content: f.content }]).slice(-10);
        p.files[f.path] = { content: f.content, old: pv ? (pv.state === 'pending' ? pv.old : pv.content) : '', state: 'pending', versions: vs }; changed.add(f.path);
        if (!p.sel) p.sel = f.path;
      });
      setSt(m, s.id, 'Completed'); log(s.id + ' done: ' + out.files.map(f => f.path).join(', ')); ui();
    } catch (e) { const a = e.name === 'AbortError'; setSt(m, s.id, a ? 'Cancelled' : 'Failed'); log(s.id + (a ? ' cancelled' : ' failed')); }
  }));
  const bad = m.sp.filter(s => s.st !== 'Completed').length;
  say(bad ? 'ugh, ' + bad + ' Spectre(s) tripped on the way 😭 some files are missing. send it again and i\'ll retry them.' : 'all done 😤 check the Review tab, tweak stuff in the editor, then smash Run.' + (notes.length ? '\n' + notes.map(n => '· ' + n).join('\n') : ''), bad ? { err: 1, files: [...changed] } : { files: [...changed] });
}
async function build() {
  const input = $('#scIn'), text = input.value.trim();
  if (!text || busy) return;
  const p = proj(), effort = EFF[+$('#scEff').value], model = $('#scModel').value, md = mode;
  busy = true; $('#scSend').disabled = true; input.value = '';
  p.msgs.push({ r: 'u', t: text }); if (p.msgs.length === 1) p.name = text.slice(0, 22); p.t = Date.now(); save(); renderMsgs(); ui();
  ctl = new AbortController(); status(true, md === 'ask' ? 'Thinking...' : 'Orchestrating...'); log(md + ': effort=' + effort);
  let m;
  try {
    const r = await req({ mode: md === 'ask' ? 'ask' : 'plan', prompt: text, effort, model, files: ctxFiles() }, ctl.signal);
    if (!r.ok) { const tx = await r.text().catch(() => ''); log('plan failed: HTTP ' + r.status + ' ' + tx.slice(0, 60)); throw new Error(r.status === 429 ? (tx.startsWith('daily') ? 'DAILY' : 'RATE') : r.status === 401 ? 'LOGIN' : tx.startsWith('upstream') ? 'UPSTREAM' : 'PLAN'); }
    const left = r.headers.get('X-Spectra-Left'); if (left !== null) $('#scLeft').textContent = left + ' credits left';
    const plan = await r.json();
    if (!plan.spectres || !plan.spectres.length) { say(plan.reply || 'i\'m here 👀 tell me what to build.'); log(md === 'ask' ? 'ask reply' : 'chat reply'); return; }
    p.summary = plan.summary || '';
    const sp = plan.spectres.map(s => ({ ...s, st: 'Queued' }));
    if (md === 'plan') {
      m = say((plan.note ? plan.note + '\n' : '') + (plan.summary || 'ok here\'s the plan 👀'), { sp, go: true }); p.pending = { text, plan, effort, model };
      log('plan ready: ' + sp.length + ' Spectres, waiting for approval'); return;
    }
    m = say(plan.note || 'spectres, assemble 😤', { sp }); log('plan ok: ' + sp.length + ' Spectres');
    await exec(m, plan, text, effort, model);
  } catch (e) { fail(e, m); } finally { done(); }
}
async function go() {
  const p = proj(), pe = p.pending; if (!pe || busy) return;
  const m = p.msgs.find(x => x.go); if (!m) return;
  busy = true; $('#scSend').disabled = true; ctl = new AbortController(); m.go = false; p.pending = null; m.sp.forEach(s => { s.st = 'Queued'; }); renderMsgs(); log('plan approved');
  try { await exec(m, pe.plan, pe.text, pe.effort, pe.model); } catch (e) { fail(e, m); } finally { done(); }
}
function addSel() {
  const p = proj(), t = $('#ta'), i = $('#scIn'); if (!p.sel) return;
  const a = t.selectionStart, s = t.value.slice(a, t.selectionEnd), l1 = t.value.slice(0, a).split('\n').length;
  i.value += (i.value ? '\n' : '') + 'In ' + p.sel + (s ? ' (line ' + l1 + '):\n```\n' + s.slice(0, 1500) + '\n```\n' : ': ');
  center = 'chat'; ui(); i.focus();
}
$('#scFile').addEventListener('change', async e => {
  const p = proj(), added = [];
  for (const f of [...e.target.files].slice(0, 6)) {
    if (f.size > 60000) { log('skipped ' + f.name + ' (over 60 KB)'); continue; }
    const path = f.name.replace(/\s+/g, '-').replace(/[^\w./-]/g, ''); if (!okPath(path)) continue;
    const txt = await f.text(); p.files[path] = { content: txt, old: '', state: 'accepted', versions: [{ t: Date.now(), content: txt }] }; added.push(path);
    if (!p.open.includes(path)) p.open.push(path);
  }
  e.target.value = '';
  if (added.length) { if (!p.msgs.length) p.name = added[0]; p.sel = added[0]; say('got ' + added.join(', ') + ' 👀 the Spectres can read and change them now.'); log('added files: ' + added.join(', ')); save(); ui(); } else log('no files added');
});

/* ---------- command palette ---------- */
let palL = [], palI = 0;
const fz = (q, s) => { q = q.toLowerCase(); s = s.toLowerCase(); let i = 0; for (const c of s) if (c === q[i]) i++; return i === q.length ? (s.includes(q) ? 100 : 0) + (s.startsWith(q) ? 50 : 0) : -1; };
function tool(k) {
  const all = Object.entries(proj().files), dl = (n, c) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c], { type: 'text/plain' })); a.download = n.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  if (k === 'copy') navigator.clipboard.writeText(all.map(([n, f]) => '/* ===== ' + n + ' ===== */\n' + f.content).join('\n\n')).catch(() => { });
  if (k === 'dl') all.forEach(([n, f], i) => setTimeout(() => dl(n, f.content), i * 300));
  if (k === 'clear') $('#scTerm').textContent = '';
  if (k === 'one') { const p = proj(); if (p.sel) dl(p.sel, p.files[p.sel].content); }
}
function newP() { const n = mk('New chat'); P.push(n); cur = n.id; center = 'chat'; lastSel = null; save(); renderMsgs(); ui(); }
const alt = k => { if (k === 'diff') { showDiff = !showDiff; showVer = false; } else { showVer = !showVer; showDiff = false; verI = null; } renderEd(); };
const cmds = () => [
  { t: 'New file', run: newF }, { t: 'Save file', h: 'Ctrl+S', run: saveF }, { t: 'Run preview', h: 'Ctrl+Enter', run },
  { t: 'Toggle diff view', run: () => alt('diff') }, { t: 'File history', run: () => alt('ver') }, { t: 'Accept all files', run: acceptAll },
  { t: 'Find in files', h: 'Ctrl+Shift+F', run: () => setV('search') }, { t: 'Toggle sidebar', h: 'Ctrl+B', run: () => tog('no-sd') },
  { t: 'Toggle terminal / preview', h: 'Ctrl+J', run: togBt }, { t: 'Toggle properties panel', run: () => tog('no-ai') }, { t: 'Open Spectra chat', run: () => { center = 'chat'; ui(); } },
  { t: 'Add selection to Spectra', h: 'Ctrl+L', run: addSel }, { t: 'Plan mode', run: () => setMode('plan') }, { t: 'Ask mode', run: () => setMode('ask') },
  { t: 'New project', run: newP }, { t: 'Copy all files', run: () => tool('copy') }, { t: 'Download all files', run: () => tool('dl') }, { t: 'Clear terminal', run: () => tool('clear') }
];
function palRender() {
  const v = $('#palIn').value, c = v[0] === '>', q = (c ? v.slice(1) : v).trim(), p = proj();
  const items = c ? cmds() : Object.keys(p.files).map(n => ({ t: n, h: p.files[n].state, run: () => openF(n) }));
  palL = items.map(x => [q ? fz(q, x.t) : 0, x]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]).slice(0, 12).map(x => x[1]); palI = 0;
  $('#palList').innerHTML = palL.map((x, i) => `<div class="pi ${i ? '' : 'on'}" data-pi="${i}"><span>${esc(x.t)}</span><small>${esc(x.h || '')}</small></div>`).join('') || '<div class="pi"><span>No results</span></div>';
}
function openPal(c) { $('#pal').hidden = false; $('#palIn').value = c ? '>' : ''; palRender(); $('#palIn').focus(); }
const closePal = () => { $('#pal').hidden = true; };
const palGo = i => { const x = palL[i]; closePal(); if (x) x.run(); };
$('#palIn').addEventListener('input', palRender);
$('#palIn').addEventListener('keydown', e => {
  const mv = d => { palI = (palI + d + palL.length) % (palL.length || 1); $$('.pi').forEach((el, i) => el.classList.toggle('on', i === palI)); };
  if (e.key === 'ArrowDown') { e.preventDefault(); mv(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); mv(-1); } else if (e.key === 'Enter') { e.preventDefault(); palGo(palI); }
});

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target, d = k => t.closest('[' + k + ']') && t.closest('[' + k + ']').getAttribute(k), p = proj();
  if (t.closest('#pal') && !t.closest('.pal-b')) { closePal(); return; }
  const pi = d('data-pi'); if (pi !== null) { palGo(+pi); return; }
  if (t.dataset.x) { e.stopPropagation(); P = P.filter(x => x.id !== t.dataset.x); if (cur === t.dataset.x) cur = P[0].id; center = 'chat'; lastSel = null; save(); renderMsgs(); ui(); return; }
  const cl = d('data-cl'); if (cl) { closeF(cl); return; }
  if (t.closest('[data-chat]')) { center = 'chat'; ui(); return; }
  const pt = d('data-pt'); if (pt) { pt === 'prev' ? run() : ptabs(pt); return; }
  const acc = d('data-acc'), rej = d('data-rej'), dl = d('data-del'), rn = d('data-ren');
  if (acc) { p.files[acc].state = 'accepted'; save(); ui(); return; }
  if (rej) { delete p.files[rej]; closeF(rej); return; }
  if (dl) { delF(dl); return; } if (rn) { renF(rn); return; }
  const id = d('data-id'); if (id) { cur = id; center = 'chat'; lastSel = null; save(); renderMsgs(); ui(); return; }
  const fo = d('data-fold'); if (fo) { fold.has(fo) ? fold.delete(fo) : fold.add(fo); renderSide(); return; }
  const gt = d('data-go'); if (gt) { const i = gt.lastIndexOf(':'); goto(gt.slice(0, i), +gt.slice(i + 1)); return; }
  const op = d('data-open'); if (op) { openF(op, !!t.closest('[data-df]')); return; }
  const v = d('data-v'); if (v) { if (v === view && !$('#app').classList.contains('no-sd')) tog('no-sd'); else setV(v); return; }
  const al = d('data-alt'); if (al) { alt(al); return; }
  const bb = d('data-b'); if (bb) { if (bb === 'x') $('#bt').hidden = true; else btab(bb); return; }
  const cp = d('data-cp'), dn = d('data-dl'); if (cp) navigator.clipboard.writeText(p.files[cp].content).catch(() => { }); if (dn) tool('one');
  const ve = d('data-ver'), rs = d('data-restore');
  if (ve !== null) { verI = +ve; renderEd(); }
  if (rs !== null) { const f = p.files[p.sel], x = f.versions[+rs]; f.old = f.content; f.content = x.content; f.state = 'pending'; f.versions = f.versions.concat([{ t: Date.now(), content: x.content }]).slice(-10); showVer = false; save(); ui(); }
  if (t.closest('[data-all]')) acceptAll();
  if (t.closest('[data-newf]')) newF(); if (t.closest('[data-newp]')) newP();
  if (t.closest('[data-run],[data-refresh]')) run(); if (t.closest('[data-pal]')) openPal(true);
  const mm = d('data-m'), tl = d('data-t'), menu = $('#scMenu');
  if (t.closest('#scPlus')) menu.hidden = !menu.hidden; else if (!t.closest('#scMenu')) menu.hidden = true;
  if (mm) {
    if (mm === 'tools') $('#scTools').hidden = !$('#scTools').hidden; else menu.hidden = true;
    if (mm === 'files') $('#scFile').click();
    if (mm === 'plan' || mm === 'ask') setMode(mm);
    if (mm === 'off') { mode = 'build'; renderMode(); }
    if (mm === 'ver') alt('ver');
  }
  if (tl) { menu.hidden = true; tool(tl); }
  if (t.closest('[data-go]')) go();
  if (t.closest('#scSend')) build();
});
document.addEventListener('input', e => { if (e.target.id === 'sq') { sq = e.target.value; $('#sr').innerHTML = results(); } });
const ta = $('#ta');
ta.addEventListener('input', () => {
  const p = proj(), f = p.files[p.sel]; if (!f) return;
  f.content = ta.value; f.dirty = true; paint(); pos(); etabs();
  clearTimeout(saveT); saveT = setTimeout(save, 500);
  if (ptab === 'prev' && !$('#app').classList.contains('no-ai')) { clearTimeout(pvT); pvT = setTimeout(run, 700); }
});
ta.addEventListener('scroll', () => { const h = $('#hl'); h.scrollTop = ta.scrollTop; h.scrollLeft = ta.scrollLeft; $('#gut').scrollTop = ta.scrollTop; });
['keyup', 'click', 'select'].forEach(ev => ta.addEventListener(ev, pos));
ta.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
  else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    const b = ta.value.slice(0, ta.selectionStart), ln = b.slice(b.lastIndexOf('\n') + 1), ind = (ln.match(/^\s*/) || [''])[0] + (/[{[(]\s*$/.test(ln) ? '  ' : '');
    if (ind) { e.preventDefault(); document.execCommand('insertText', false, '\n' + ind); }
  }
});
$('#scIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } });
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { if (!$('#pal').hidden) closePal(); else if (ctl) ctl.abort(); return; }
  if (!c) return;
  if (k === 's') { e.preventDefault(); saveF(); }
  else if (k === 'p' && !e.shiftKey) { e.preventDefault(); openPal(false); }
  else if (k === 'k' || (k === 'p' && e.shiftKey)) { e.preventDefault(); openPal(true); }
  else if (k === 'f' && e.shiftKey) { e.preventDefault(); setV('search'); }
  else if (k === 'b') { e.preventDefault(); tog('no-sd'); }
  else if (k === 'j') { e.preventDefault(); togBt(); }
  else if (k === 'l') { e.preventDefault(); addSel(); }
  else if (e.key === 'Enter' && document.activeElement !== $('#scIn')) { e.preventDefault(); run(); }
});
$('#scEff').addEventListener('input', e => { $('#scEffTxt').textContent = EFFN[+e.target.value]; });
const LAY = LS('sc_layout', {});
function setSize(k, v) { if (k === 'bh') $('#bt').style.flexBasis = v + 'px'; else $('#app').style.setProperty('--' + k, v + 'px'); LAY[k] = v; SS('sc_layout', LAY); }
['sw', 'aw', 'bh'].forEach(k => { if (LAY[k]) setSize(k, LAY[k]); });
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-rz]'); if (!h) return; e.preventDefault();
  const k = h.dataset.rz, a = $('#app'), x0 = e.clientX, y0 = e.clientY, s0 = k === 'sw' ? $('.sd').offsetWidth : k === 'aw' ? $('.pp').offsetWidth : $('#bt').offsetHeight;
  a.classList.add('drag'); h.setPointerCapture(e.pointerId);
  const mv = ev => { const v = k === 'sw' ? s0 + ev.clientX - x0 : k === 'aw' ? s0 - (ev.clientX - x0) : s0 - (ev.clientY - y0); setSize(k, Math.round(Math.max(k === 'bh' ? 90 : k === 'aw' ? 280 : 180, Math.min(k === 'bh' ? innerHeight * .7 : innerWidth * .7, v)))); };
  const up = () => { a.classList.remove('drag'); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); };
  h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
});
renderMsgs(); renderMode(); ui(); ptabs('props'); log('Spectra Code IDE ready · Ctrl+K for commands');
})();
