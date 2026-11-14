/* SPECSOFT® Spectra Code. Load AFTER main.js. Talks to the Supabase Edge Function "spectra-code".
   Flow: Spectra PLANS (orchestrator) -> Spectres write files IN PARALLEL -> you review each file (Git tab) before accepting. */
(function () {
'use strict';
const GHOST = {};  // a missing element becomes a harmless detached <div>, so a revamped layout can never crash this script
const $ = s => document.querySelector(s) || (GHOST[s] = GHOST[s] || document.createElement('div')), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const EFF = ['low', 'medium', 'high', 'xhigh'], EFFN = ['Low', 'Medium', 'High', 'Extra High'];
let P = LS('sc_projects', []), cur = LS('sc_cur', null), busy = false, ctl = null, tick = null;
if (!P.length) { P = [mk('Project 1')]; cur = P[0].id; }
if (!P.find(p => p.id === cur)) cur = P[0].id;
function mk(name) { return { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 5), name, t: Date.now(), msgs: [], files: {} }; }
const proj = () => P.find(p => p.id === cur);
const save = () => { SS('sc_projects', P); SS('sc_cur', cur); };

async function req(body, signal) {
  const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session;
  if (!s) throw new Error('LOGIN');
  return fetch(window.SPECSOFT_CONFIG.SUPABASE_URL + '/functions/v1/spectra-code', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: window.SPECSOFT_CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
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
const fcard = (n, f, max, btns) => { const d = fdiff(f); return `<div class="sc-f"><div class="sc-fh"><em>${f.old ? 'M' : 'A'}</em><span>${esc(n)}</span>${statH(stat(d))}${btns}</div><div class="sc-diff">${dview(d, max)}</div></div>`; };
const log = t => { const el = $('#scTerm'); el.textContent += '[' + new Date().toLocaleTimeString() + '] ' + t + '\n'; if (el.parentNode) el.parentNode.scrollTop = 1e9; };

/* ---------- render ---------- */
function renderTabs() { }
function renderMsgs() {
  const m = proj().msgs, box = $('#scMsgs');
  box.innerHTML = m.length ? m.map(x => x.r === 'u' ? `<div class="sc-m u"><b>❯</b> ${esc(x.t)}</div>` : `<div class="sc-m ${x.err ? 'err' : ''}"><b class="sc-bul">●</b>${esc(x.t)}${x.sp ? '<div class="sc-tree">' + x.sp.map((s, i) => spCard(s, i === x.sp.length - 1)).join('') + '</div>' : ''}${x.files ? editCards(x.files) : ''}${x.go ? '<div><button class="sc-btn ok" data-go style="margin-top:10px">Build this plan</button></div>' : ''}</div>`).join('')
    : '<div class="sc-empty"><pre>  ◆ SPECTRA CODE\n  Lumen 4 · Spectres online</pre>Describe what to build. Spectra plans it, then her Spectres write the files at the same time.<span class="sc-cur"></span></div>';
  box.scrollTop = 1e9;
}
const editCards = names => { const f = proj().files, ok = names.filter(n => f[n]); return ok.length ? `<div class="sc-edit"><b class="sc-bul">●</b>Edited ${ok.length} file${ok.length > 1 ? 's' : ''}<div class="sc-tree">${ok.map((n, i) => `<button class="sc-tr sc-o" data-open="${esc(n)}"><span class="sc-br">${i === ok.length - 1 ? '└' : '├'}</span><em>${f[n].old ? 'M' : 'A'}</em><span class="sc-tt">${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button>`).join('')}</div></div>` : ''; };
const spCard = (s, last) => `<div class="sc-tr" data-sid="${s.id}"><span class="sc-br">${last ? '└' : '├'}</span><span class="sc-role">${s.role}</span><span class="sc-tt">${esc(s.title)}<small>${esc(s.files.join(', '))}</small></span><span class="sc-st" data-s="${s.st}">${s.st}</span></div>`;
let sel = null, view = 'exp', act = 'chat', alt = null, ptab = 'props', openT = [], q = '', verI = null, palI = 0, palItems = [];
const base = n => n.split('/').pop();
const codeOf = s => s.split('\n').slice(0, 800).map((l, i) => `<div class="sc-l"><i>${i + 1}</i><code>${esc(l) || ' '}</code></div>`).join('');
const HLRX = /(\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(<\/?[a-zA-Z][\w-]*|\/?>)|\b(const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|try|catch|switch|case|break|continue|true|false|null|undefined|this)\b|(\b\d+(?:\.\d+)?\b)/g;
function hl(src) {
  let o = '', i = 0, m; HLRX.lastIndex = 0;
  while ((m = HLRX.exec(src))) { o += esc(src.slice(i, m.index)); o += `<span class="${m[1] ? 'hc' : m[2] ? 'hs' : m[3] ? 'ht' : m[4] ? 'hk' : 'hn'}">${esc(m[0])}</span>`; i = m.index + m[0].length; if (!m[0].length) HLRX.lastIndex++; }
  return o + esc(src.slice(i));
}
const VT = { exp: 'Explorer', search: 'Search', git: 'Review changes', chats: 'Projects' };
function hits() {
  if (!q.trim()) return '<p class="sc-note">Type to search every file in this project.</p>';
  const f = proj().files, ql = q.toLowerCase(), out = [];
  Object.keys(f).sort().forEach(n => f[n].content.split('\n').forEach((l, i) => { if (out.length < 80 && l.toLowerCase().includes(ql)) out.push(`<button class="ide-hit" data-open="${esc(n)}" data-line="${i + 1}"><b>${esc(n)}:${i + 1}</b><span>${esc(l.trim().slice(0, 90))}</span></button>`); }));
  return out.join('') || '<p class="sc-note">No matches.</p>';
}
function renderSide() {
  const p = proj(), f = p.files, names = Object.keys(f).sort(), pend = names.filter(n => f[n].state === 'pending');
  $$('.ab-b[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  $('#gitN').textContent = pend.length || '';
  $('#sdH').innerHTML = `<span>${VT[view]}</span>` + (view === 'exp' ? '<button class="ide-ib" data-m="files" title="Add files">+</button>' : view === 'chats' ? '<button class="ide-ib" data-newp title="New project">+</button>' : view === 'git' && pend.length ? '<button class="ide-ib" data-all title="Accept all">✓</button>' : '');
  let h = '';
  if (view === 'exp') h = names.length ? `<div class="ide-g">${esc(p.name)}</div>` + names.map(n => `<button class="ide-f ${act === n ? 'on' : ''}" data-open="${esc(n)}"><i class="ide-sd ${f[n].state}"></i><span>${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button>`).join('') : '<p class="sc-note">No files yet. Ask Spectra to build something, or add your own with +.</p>';
  else if (view === 'search') h = `<input class="ide-q" id="ideQ" placeholder="Search in files" value="${esc(q)}" autocomplete="off" spellcheck="false"><div id="ideHits">${hits()}</div>`;
  else if (view === 'git') h = pend.length ? pend.map(n => `<div class="ide-r"><button class="ide-f" data-open="${esc(n)}"><i class="ide-sd pending"></i><span>${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button><div class="ide-rb"><button class="sc-btn ok" data-acc="${esc(n)}">Accept</button><button class="sc-btn" data-rej="${esc(n)}">Reject</button></div></div>`).join('') : '<p class="sc-note">Nothing to review. New and changed files from your Spectres land here first.</p>';
  else h = [...P].sort((a, b) => (b.t || 0) - (a.t || 0)).map(x => { const n = Object.keys(x.files).length; return `<div class="ide-p ${x.id === cur ? 'on' : ''}" data-id="${x.id}"><span><b>${esc(x.name)}</b><small>${n ? n + ' file' + (n > 1 ? 's' : '') : 'No files yet'}</small></span>${P.length > 1 ? `<u data-x="${x.id}">×</u>` : ''}</div>`; }).join('');
  $('#sdB').innerHTML = h;
}
function renderEdTabs() {
  const p = proj(); openT = openT.filter(n => p.files[n]); if (act !== 'chat' && !p.files[act]) act = 'chat';
  $('#edTabs').innerHTML = `<button class="ide-t ${act === 'chat' ? 'on' : ''}" data-act="chat">Chat</button>` + openT.map(n => `<button class="ide-t ${act === n ? 'on' : ''}" data-act="${esc(n)}"><i class="ide-sd ${p.files[n].state}"></i>${esc(base(n))}<u data-ct="${esc(n)}">×</u></button>`).join('');
  const f = p.files[act];
  $('#edAct').innerHTML = f ? (f.state === 'pending' ? `<button class="sc-btn ok" data-acc="${esc(act)}">Accept</button><button class="sc-btn" data-rej="${esc(act)}">Reject</button>` : '') + `<button class="sc-btn ${alt === 'diff' ? 'on' : ''}" data-alt="diff">Diff</button><button class="sc-btn ${alt === 'hist' ? 'on' : ''}" data-alt="hist">History</button><button class="sc-btn" data-cp="${esc(act)}">Copy</button><button class="sc-btn" data-dl="${esc(act)}">Download</button>` : `<span class="ide-hint">${esc(p.name)}</span>`;
}
function histHtml(f) {
  const vs = f.versions || [], vi = verI == null || verI >= vs.length ? vs.length - 1 : verI;
  if (!vs.length) return '<p class="sc-note">No saved versions yet.</p>';
  return `<div class="sc-vers">${vs.map((v, i) => `<button class="sc-btn ${i === vi ? 'on' : ''}" data-ver="${i}">v${i + 1} · ${new Date(v.t).toLocaleTimeString()}</button>`).join('')}${vi !== vs.length - 1 ? `<button class="sc-btn ok" data-restore="${vi}">Restore this version</button>` : ''}</div><div class="sc-diff big">${codeOf(vs[vi].content)}</div>`;
}
function paint(src) {
  const n = src.split('\n').length, code = /\.(html?|css|js|ts|json|svg|xml)$/i.test(act);
  $('#gut').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  $('#hl').innerHTML = (code ? hl(src) : esc(src)) + '\n';
}
function renderEditor() {
  const f = proj().files[act], chat = act === 'chat' || !f;
  $('#chat').hidden = !chat; $('#edMain').hidden = chat;
  if (chat) return;
  $('#edEmpty').hidden = true;
  if (alt) { $('#edWrap').hidden = true; $('#edAlt').hidden = false; $('#edAlt').innerHTML = alt === 'diff' ? `<div class="sc-diff big">${dview(fdiff(f), 800)}</div>` : histHtml(f); return; }
  $('#edAlt').hidden = true; $('#edWrap').hidden = false;
  const ta = $('#ta'); if (ta.dataset.f !== act || ta.value !== f.content) { ta.value = f.content; ta.dataset.f = act; }
  paint(f.content);
}
function renderProps() {
  $('#ppB').hidden = ptab !== 'props'; $('#pv').hidden = ptab !== 'prev';
  $$('.pp-h [data-pt]').forEach(b => b.classList.toggle('on', b.dataset.pt === ptab));
  if (ptab !== 'props') return;
  const p = proj(), f = p.files, names = Object.keys(f), pend = names.filter(n => f[n].state === 'pending');
  const tot = names.reduce((a, n) => { const s = stat(fdiff(f[n])); a.a += s.a; a.d += s.d; return a; }, { a: 0, d: 0 });
  const last = [...p.msgs].reverse().find(x => x.sp), sp = last ? last.sp : [], cf = f[act];
  $('#ppB').innerHTML = `<div class="sc-sec"><b>${esc(p.name)}</b><p>${esc(p.summary || 'Nothing built yet.')}</p></div><div class="sc-kv"><div><b>${names.length}</b>files</div><div><b>${pend.length}</b>to review</div><div class="g"><b>+${tot.a}</b>added</div><div class="r"><b>−${tot.d}</b>removed</div></div>`
    + (cf ? `<div class="sc-sec"><b>${esc(act)}</b><p>${cf.content.split('\n').length} lines · ${cf.content.length} characters · ${cf.state}</p></div>` : '')
    + (pend.length ? '<div class="sc-sec"><button class="sc-btn ok" data-all>Accept all files</button></div>' : '')
    + (sp.length ? '<div class="sc-sec"><b>Spectres</b><div class="sc-tree">' + sp.map((s, i) => spCard(s, i === sp.length - 1)).join('') + '</div></div>' : '');
}
function preview() {
  const f = proj().files, e = f['index.html'] ? 'index.html' : Object.keys(f).find(n => /\.html?$/i.test(n));
  if (!e) { $('#pv').srcdoc = '<body style="font:14px sans-serif;color:#888;background:#0a0a0a;padding:24px">Nothing to preview yet. Build a page with an index.html first.</body>'; return; }
  let h = f[e].content;
  h = h.replace(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi, (m, u) => /stylesheet/i.test(m) && f[u] ? '<style>' + f[u].content + '</style>' : m);
  h = h.replace(/<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi, (m, a, u) => f[u] ? '<script>' + f[u].content.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt>' : m);
  $('#pv').srcdoc = h;
}
function renderSb() {
  const p = proj(), n = Object.keys(p.files).length, pend = Object.values(p.files).filter(f => f.state === 'pending').length;
  $('#sb').innerHTML = `<span>◆ ${esc(p.name)}</span><span>${n} file${n === 1 ? '' : 's'}</span><span>${pend} to review</span><span class="ide-sp"></span><span>${busy ? 'Spectres working...' : 'Idle'}</span><button class="ide-sbb" data-term>Terminal</button>`;
}
function renderFiles() { renderEdTabs(); renderEditor(); renderSide(); renderProps(); renderSb(); }
function renderAll() { renderTabs(); renderMsgs(); renderFiles(); }
function openFile(n, line) {
  const f = proj().files[n]; if (!f) return;
  if (!openT.includes(n)) openT.push(n);
  act = n; sel = n; alt = f.state === 'pending' && f.old ? 'diff' : null; verI = null; renderFiles();
  if (line && !alt) { const ta = $('#ta'), lh = parseFloat(getComputedStyle(ta).lineHeight) || 19; ta.scrollTop = Math.max(0, (line - 4) * lh); ta.dispatchEvent(new Event('scroll')); }
}
const newProject = () => { const n = mk('Project ' + (P.length + 1)); P.push(n); cur = n.id; act = 'chat'; openT = []; save(); renderAll(); };
const acceptAll = () => { Object.values(proj().files).forEach(f => { f.state = 'accepted'; }); save(); renderFiles(); };
const toggleTerm = () => { const b = $('#bt'); b.hidden = !b.hidden; };
const setView = v => { view = v; renderSide(); if (v === 'search') setTimeout(() => $('#ideQ').focus(), 0); };

/* ---------- build ---------- */
function status(on, txt) {
  const el = $('#scStatus'); el.hidden = !on; clearInterval(tick);
  if (!on) return;
  const t0 = Date.now(); $('#scStatusTxt').textContent = txt;
  tick = setInterval(() => { const tok = Math.round(Object.values(proj().files).reduce((a, f) => a + f.content.length, 0) / 4); $('#scStatusMeta').textContent = '(Press esc to interrupt · ' + Math.round((Date.now() - t0) / 1000) + 's · ↓ ' + tok + ' tokens)'; }, 500);
}
const setSt = (m, id, st) => { const s = m.sp.find(x => x.id === id); if (s) s.st = st; const c = document.querySelector(`[data-sid="${id}"] .sc-st`); if (c) { c.textContent = st; c.dataset.s = st; } if (window.SCSwarm) SCSwarm.set(id, st); };
const say = (t, extra) => { const p = proj(); const m = Object.assign({ r: 'a', t }, extra); p.msgs.push(m); save(); renderMsgs(); return m; };

let mode = 'build';
const done = () => { if (window.SCSwarm) SCSwarm.end(); save(); status(false); busy = false; ctl = null; $('#scSend').disabled = false; renderAll(); };
const fail = (e, m) => {
  const msg = e.name === 'AbortError' ? 'Stopped.' : { LOGIN: 'Log in to use Spectra Code.', DAILY: 'You used all your Spectra credits for today. They reset at midnight UTC.', RATE: 'Too many requests. Wait a minute and try again.', UPSTREAM: 'Spectra got no answer from her brain. Check the spectra-code function logs in Supabase (GEMINI_API_KEY and model names), then try again.' }[e.message] || 'Spectra could not plan that. Try again or make the request simpler.';
  if (m && m.sp) m.sp.forEach(s => { if (s.st === 'Running' || s.st === 'Queued') s.st = 'Cancelled'; });
  say(msg, { err: 1 }); log('error: ' + e.message);
};
const nick = () => ((document.querySelector('[data-user-name]') || {}).textContent || '').trim().slice(0, 20);
const ctxFiles = () => Object.entries(proj().files).slice(0, 6).map(([path, f]) => ({ path, content: f.content.slice(0, 8000) }));
function renderMode() {
  const el = $('#scModes'); el.hidden = mode === 'build';
  el.innerHTML = mode === 'build' ? '' : `<span class="sc-chip">${mode === 'plan' ? 'Plan Mode' : 'Ask Spectra'}<u data-m="off">×</u></span><span>${mode === 'plan' ? 'Spectra plans first, you approve before the Spectres build.' : 'Ask about your code. No files get written.'}</span>`;
  $('#scIn').placeholder = mode === 'ask' ? 'Ask Spectra about your code...' : mode === 'plan' ? 'Describe what to build. Spectra will plan it first.' : 'Tell Spectra what to build. Enter to send, Shift+Enter for a new line.';
}
async function exec(m, plan, text, effort, model) {
  const p = proj(), changed = new Set();
  status(true, 'Deploying ' + m.sp.length + ' Spectres...');
  if (window.SCSwarm) SCSwarm.start(m.sp);
  await Promise.all(m.sp.map(async s => {
    setSt(m, s.id, 'Running'); log(s.role + ' ' + s.id + ' -> ' + s.files.join(', '));
    try {
      const rr = await req({ mode: 'spectre', prompt: text, effort, model, summary: plan.summary, contract: plan.contract, task: s, files: ctxFiles() }, ctl.signal);
      if (!rr.ok) throw new Error('fail');
      const out = await rr.json();
      out.files.forEach(f => {
        const pv = p.files[f.path], vs = (pv ? (pv.versions || [{ t: Date.now(), content: pv.content }]) : []).concat([{ t: Date.now(), content: f.content }]).slice(-10);
        p.files[f.path] = { content: f.content, old: pv ? (pv.state === 'pending' ? pv.old : pv.content) : '', state: 'pending', versions: vs }; changed.add(f.path);
      });
      setSt(m, s.id, 'Completed'); log(s.id + ' done: ' + out.files.map(f => f.path).join(', ')); if (out.note) log(s.id + ': ' + out.note); renderFiles();
    } catch (e) { const a = e.name === 'AbortError'; setSt(m, s.id, a ? 'Cancelled' : 'Failed'); log(s.id + (a ? ' cancelled' : ' failed')); }
  }));
  const bad = m.sp.filter(s => s.st !== 'Completed').length;
  say(bad ? bad + ' Spectre(s) did not finish, so some files are missing. Send the request again to retry them.' : 'All done. Open the Files tab and accept the files you want.', bad ? { err: 1, files: [...changed] } : { files: [...changed] });
}
async function build() {
  const input = $('#scIn'), text = input.value.trim();
  if (!text || busy) return;
  const p = proj(), effort = EFF[+($('#scEff').value || 1)], model = $('#scModel').value, md = mode;
  busy = true; $('#scSend').disabled = true; input.value = '';
  p.msgs.push({ r: 'u', t: text }); if (p.msgs.length === 1) p.name = text.slice(0, 22); p.t = Date.now(); save(); renderAll();
  ctl = new AbortController(); status(true, md === 'ask' ? 'Thinking...' : 'Orchestrating...'); log(md + ': effort=' + effort);
  let m;
  try {
    const r = await req({ mode: md === 'ask' ? 'ask' : 'plan', prompt: text, effort, model, files: ctxFiles(), nick: nick(), hour: new Date().getHours() }, ctl.signal);
    if (!r.ok) { const tx = await r.text().catch(() => ''); log('plan failed: HTTP ' + r.status + ' ' + tx.slice(0, 60)); throw new Error(r.status === 429 ? (tx.startsWith('daily') ? 'DAILY' : 'RATE') : r.status === 401 ? 'LOGIN' : tx.startsWith('upstream') ? 'UPSTREAM' : 'PLAN'); }
    const left = r.headers.get('X-Spectra-Left'); if (left !== null) $('#scLeft').textContent = left + ' credits left today';
    const plan = await r.json();
    if (!plan.spectres || !plan.spectres.length) { say(plan.reply || 'I am here. Tell me what to build.'); log(md === 'ask' ? 'ask reply' : 'chat reply'); return; }
    p.summary = plan.summary || '';
    const sp = plan.spectres.map(s => ({ ...s, st: 'Queued' }));
    if (md === 'plan') {
      m = say((plan.note ? plan.note + '\n' : '') + (plan.summary || 'Here is the plan.'), { sp, go: true }); p.pending = { text, plan, effort, model };
      log('plan ready: ' + sp.length + ' Spectres, waiting for approval'); return;
    }
    m = say(plan.note || 'Deploying Spectres!', { sp }); log('plan ok: ' + sp.length + ' Spectres');
    await exec(m, plan, text, effort, model);
  } catch (e) { fail(e, m); } finally { done(); }
}
async function go() {
  const p = proj(), pe = p.pending; if (!pe || busy) return;
  const m = p.msgs.find(x => x.go); if (!m) return;
  busy = true; $('#scSend').disabled = true; ctl = new AbortController(); m.go = false; p.pending = null; m.sp.forEach(s => { s.st = 'Queued'; }); renderMsgs(); log('plan approved');
  try { await exec(m, pe.plan, pe.text, pe.effort, pe.model); } catch (e) { fail(e, m); } finally { done(); }
}
$('#scFile').addEventListener('change', async e => {
  const p = proj(), added = [];
  for (const f of [...e.target.files].slice(0, 6)) {
    if (f.size > 60000) { log('skipped ' + f.name + ' (over 60 KB)'); continue; }
    const path = f.name.replace(/\s+/g, '-').replace(/[^\w./-]/g, ''); if (!/^[\w][\w./-]{0,60}$/.test(path)) continue;
    const txt = await f.text(); p.files[path] = { content: txt, old: '', state: 'accepted', versions: [{ t: Date.now(), content: txt }] }; added.push(path);
  }
  e.target.value = '';
  if (added.length) { if (!p.msgs.length) p.name = added[0]; sel = added[0]; say('Added ' + added.join(', ') + '. Your Spectres can read and change them now.'); log('added files: ' + added.join(', ')); renderAll(); } else log('no files added');
});

/* ---------- command palette ---------- */
const setMode = k => { mode = mode === k ? 'build' : k; renderMode(); };
const CMD = [['New project', newProject], ['Toggle terminal', toggleTerm], ['Open Chat', () => { act = 'chat'; renderFiles(); }], ['Accept all changes', acceptAll], ['Plan Mode (toggle)', () => setMode('plan')], ['Ask Spectra (toggle)', () => setMode('ask')], ['Add files', () => $('#scFile').click()], ['Show Explorer', () => setView('exp')], ['Show Search', () => setView('search')], ['Review changes', () => setView('git')], ['Show Projects', () => setView('chats')]];
function palList() {
  const v = $('#palIn').value, k = v.replace(/^>/, '').trim().toLowerCase();
  palItems = (v.startsWith('>') ? CMD.filter(c => c[0].toLowerCase().includes(k)).map(c => ({ t: '> ' + c[0], run: c[1] })) : Object.keys(proj().files).sort().filter(n => n.toLowerCase().includes(k)).map(n => ({ t: n, run: () => openFile(n) }))).slice(0, 20);
  palI = Math.min(palI, Math.max(palItems.length - 1, 0));
  $('#palList').innerHTML = palItems.length ? palItems.map((x, i) => `<button class="ide-pi ${i === palI ? 'on' : ''}" data-pi="${i}">${esc(x.t)}</button>`).join('') : '<p class="sc-note">' + (v.startsWith('>') ? 'No commands match.' : 'No files yet. Type > for commands.') + '</p>';
}
const openPal = pre => { $('#pal').hidden = false; $('#palIn').value = pre || ''; palI = 0; palList(); $('#palIn').focus(); };
const closePal = () => { $('#pal').hidden = true; };
const runPal = i => { const it = palItems[i]; closePal(); if (it) it.run(); };

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target, d = k => { const x = t.closest('[' + k + ']'); return x ? x.getAttribute(k) : null; }, p = proj(), menu = $('#scMenu');
  if (t === $('#pal')) { closePal(); return; }
  if (t.dataset && t.dataset.x) { e.stopPropagation(); P = P.filter(x => x.id !== t.dataset.x); if (cur === t.dataset.x) { cur = P[0].id; act = 'chat'; openT = []; } save(); renderAll(); return; }
  const ct = d('data-ct'); if (ct !== null) { openT = openT.filter(n => n !== ct); if (act === ct) act = 'chat'; renderFiles(); return; }
  const pi = d('data-pi'); if (pi !== null) { runPal(+pi); return; }
  const pid = d('data-id'); if (pid && t.closest('.ide-p')) { cur = pid; act = 'chat'; openT = []; save(); renderAll(); return; }
  const v = d('data-v'); if (v) { setView(v); return; }
  if (t.closest('[data-pal]')) { openPal(''); return; }
  if (t.closest('[data-newp]')) { newProject(); return; }
  const ac = d('data-act'); if (ac !== null) { act = ac; sel = ac; alt = null; renderFiles(); return; }
  const op = d('data-open'); if (op !== null) { openFile(op, +d('data-line') || 0); return; }
  const al = d('data-alt'); if (al !== null) { alt = alt === al ? null : al; verI = null; renderFiles(); return; }
  const pt = d('data-pt'); if (pt) { ptab = pt; renderProps(); if (pt === 'prev') preview(); return; }
  if (t.closest('[data-refresh]')) { preview(); return; }
  if (t.closest('[data-term]')) { toggleTerm(); return; }
  if (d('data-b') === 'x') { $('#bt').hidden = true; return; }
  const cp = d('data-cp'), dl = d('data-dl'), acc = d('data-acc'), rej = d('data-rej'), mm = d('data-m'), tl = d('data-t'), ve = d('data-ver'), rs = d('data-restore');
  if (cp) navigator.clipboard.writeText(p.files[cp].content).catch(() => { });
  if (dl) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([p.files[dl].content], { type: 'text/plain' })); a.download = dl.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  if (acc) { p.files[acc].state = 'accepted'; save(); renderFiles(); }
  if (rej) { delete p.files[rej]; save(); renderFiles(); }
  if (t.closest('[data-all]')) acceptAll();
  if (ve !== null) { verI = +ve; renderFiles(); }
  if (rs !== null) { const f = p.files[act], x = f && f.versions[+rs]; if (x) { f.old = f.content; f.content = x.content; f.state = 'pending'; f.versions = f.versions.concat([{ t: Date.now(), content: x.content }]).slice(-10); alt = null; save(); renderFiles(); } }
  if (t.closest('#scPlus')) menu.hidden = !menu.hidden; else if (!t.closest('#scMenu')) menu.hidden = true;
  if (mm) {
    if (mm === 'tools') $('#scTools').hidden = !$('#scTools').hidden; else menu.hidden = true;
    if (mm === 'files') $('#scFile').click();
    if (mm === 'plan' || mm === 'ask') setMode(mm);
    if (mm === 'off') { mode = 'build'; renderMode(); }
    if (mm === 'ver') { if (act === 'chat') { const n = Object.keys(p.files)[0]; if (n) openFile(n); } if (act !== 'chat') { alt = 'hist'; renderFiles(); } else log('add or build a file first, then use History'); }
  }
  if (tl) {
    const all = Object.entries(p.files); menu.hidden = true;
    if (tl === 'copy') navigator.clipboard.writeText(all.map(([n, f]) => '/* ===== ' + n + ' ===== */\n' + f.content).join('\n\n')).catch(() => { });
    if (tl === 'dl') all.forEach(([n, f], i) => setTimeout(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.content], { type: 'text/plain' })); a.download = n.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, i * 300));
    if (tl === 'clear') $('#scTerm').textContent = '';
  }
  if (t.closest('[data-go]')) go();
  if (t.closest('#scSend')) build();
});
document.addEventListener('input', e => { if (e.target.id === 'ideQ') { q = e.target.value; $('#ideHits').innerHTML = hits(); } });
$('#scIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } });
$('#scEff').addEventListener('input', e => { $('#scEffTxt').textContent = EFFN[+e.target.value]; });
$('#palIn').addEventListener('input', () => { palI = 0; palList(); });
$('#palIn').addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); palI = Math.min(palI + 1, palItems.length - 1); palList(); } else if (e.key === 'ArrowUp') { e.preventDefault(); palI = Math.max(palI - 1, 0); palList(); } else if (e.key === 'Enter') { e.preventDefault(); runPal(palI); } });
document.addEventListener('keydown', e => {
  const k = (e.key || '').toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (c && k === 'k') { e.preventDefault(); openPal(''); } else if (c && k === 'j') { e.preventDefault(); toggleTerm(); } else if (c && k === 'b') { e.preventDefault(); setView('exp'); } else if (c && e.shiftKey && k === 'f') { e.preventDefault(); setView('search'); }
  else if (k === 'escape') { if (!$('#pal').hidden) closePal(); else if (ctl) ctl.abort(); $('#scMenu').hidden = true; }
});
/* editor */
const ta = $('#ta');
ta.addEventListener('input', () => { const f = proj().files[act]; if (!f) return; f.content = ta.value; paint(ta.value); save(); });
ta.addEventListener('scroll', () => { $('#hl').scrollTop = ta.scrollTop; $('#hl').scrollLeft = ta.scrollLeft; $('#gut').scrollTop = ta.scrollTop; });
ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
ta.addEventListener('change', () => { const f = proj().files[act]; if (!f) return; const vs = f.versions || (f.versions = []); if (!vs.length || vs[vs.length - 1].content !== f.content) { vs.push({ t: Date.now(), content: f.content }); f.versions = vs.slice(-10); save(); } });
/* resizers (sets CSS variables --sw / --aw / --bh and the element size) */
document.addEventListener('mousedown', e => {
  const r = e.target.closest && e.target.closest('[data-rz]'); if (!r) return; e.preventDefault();
  const kind = r.dataset.rz, app = $('#app'), pv = $('#pv'); pv.style.pointerEvents = 'none';
  const mv = ev => {
    if (kind === 'sw') { const w = Math.max(160, Math.min(520, ev.clientX - app.getBoundingClientRect().left - ($('.ab').offsetWidth || 0))); app.style.setProperty('--sw', w + 'px'); $('.sd').style.width = w + 'px'; }
    if (kind === 'aw') { const w = Math.max(240, Math.min(720, window.innerWidth - ev.clientX)); app.style.setProperty('--aw', w + 'px'); $('.pp').style.width = w + 'px'; }
    if (kind === 'bh') { const h = Math.max(80, Math.min(window.innerHeight * 0.7, window.innerHeight - ev.clientY - ($('#sb').offsetHeight || 0))); app.style.setProperty('--bh', h + 'px'); $('#bt').style.height = h + 'px'; }
  };
  const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); pv.style.pointerEvents = ''; };
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
});
/* swarm panel mount (spectra-swarm.js fills it) */
if (!document.getElementById('scSwarm') && document.getElementById('scStatus')) { const sw = document.createElement('div'); sw.className = 'sc-swarm'; sw.id = 'scSwarm'; sw.hidden = true; document.getElementById('scStatus').parentNode.insertBefore(sw, document.getElementById('scStatus')); }
const need = ['scMsgs', 'scIn', 'scSend', 'scModel', 'scEff', 'scStatus', 'scTerm', 'sdB', 'sdH', 'edTabs', 'edAct', 'edMain', 'ta', 'hl', 'gut', 'ppB', 'pv', 'sb', 'pal', 'chat'], miss = need.filter(i => !document.getElementById(i));
if (miss.length) console.warn('Spectra Code: these elements are not on the page, so those parts are skipped: ' + miss.join(', '));
renderAll(); renderMode(); log('Spectra Code ready');
})();
