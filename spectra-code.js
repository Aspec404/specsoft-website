/* SPECSOFT® Spectra Code. Load AFTER main.js. Talks to the Supabase Edge Function "spectra-code".
   Flow: Spectra PLANS (orchestrator) -> Spectres write files IN PARALLEL -> you review each file (Git tab) before accepting. */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
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
const log = t => { const el = $('#scTerm'); el.textContent += '[' + new Date().toLocaleTimeString() + '] ' + t + '\n'; el.parentNode.scrollTop = 1e9; };

/* ---------- render ---------- */
function renderTabs() {
  $('#scTabs').innerHTML = P.map(p => `<button class="sc-tab ${p.id === cur ? 'on' : ''}" data-id="${p.id}">${esc(p.name)}${P.length > 1 ? '<u data-x="' + p.id + '">×</u>' : ''}</button>`).join('');
  const grp = t => { const d = (Date.now() - (t || 0)) / 864e5; return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : 'Earlier'; };
  let last = '', hh = '';
  [...P].sort((a, b) => (b.t || 0) - (a.t || 0)).forEach(p => {
    const g = grp(p.t); if (g !== last) { hh += `<div class="sa-label">${g}</div>`; last = g; }
    const n = Object.keys(p.files).length, pend = Object.values(p.files).filter(f => f.state === 'pending').length;
    hh += `<div class="sa-item sc-it ${p.id === cur ? 'on' : ''}" data-id="${p.id}"><span><b>${esc(p.name)}</b><small>${n ? n + ' file' + (n > 1 ? 's' : '') + (pend ? ' · ' + pend + ' to review' : ' · accepted') : 'No files yet'}</small></span></div>`;
  });
  $('#scHist').innerHTML = hh;
}
function renderMsgs() {
  const m = proj().msgs, box = $('#scMsgs');
  box.innerHTML = m.length ? m.map(x => x.r === 'u' ? `<div class="sc-m u"><b>❯</b> ${esc(x.t)}</div>` : `<div class="sc-m ${x.err ? 'err' : ''}"><b class="sc-bul">●</b>${esc(x.t)}${x.sp ? '<div class="sc-tree">' + x.sp.map((s, i) => spCard(s, i === x.sp.length - 1)).join('') + '</div>' : ''}${x.files ? editCards(x.files) : ''}${x.go ? '<div><button class="sc-btn ok" data-go style="margin-top:10px">Build this plan</button></div>' : ''}</div>`).join('')
    : '<div class="sc-empty"><pre>  ◆ SPECTRA CODE\n  Lumen 4 · Spectres online</pre>Describe what to build. Spectra plans it, then her Spectres write the files at the same time.<span class="sc-cur"></span></div>';
  box.scrollTop = 1e9;
}
const editCards = names => { const f = proj().files, ok = names.filter(n => f[n]); return ok.length ? `<div class="sc-edit"><b class="sc-bul">●</b>Edited ${ok.length} file${ok.length > 1 ? 's' : ''}<div class="sc-tree">${ok.map((n, i) => `<button class="sc-tr sc-o" data-open="${esc(n)}"><span class="sc-br">${i === ok.length - 1 ? '└' : '├'}</span><em>${f[n].old ? 'M' : 'A'}</em><span class="sc-tt">${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button>`).join('')}</div></div>` : ''; };
const spCard = (s, last) => `<div class="sc-tr" data-sid="${s.id}"><span class="sc-br">${last ? '└' : '├'}</span><span class="sc-role">${s.role}</span><span class="sc-tt">${esc(s.title)}<small>${esc(s.files.join(', '))}</small></span><span class="sc-st" data-s="${s.st}">${s.st}</span></div>`;
let sel = null, vm = '', showVer = false, verI = null;
function tab(k) { $$('.sc-ptabs button').forEach(b => b.classList.toggle('on', b.dataset.p === k)); $$('.sc-pane').forEach(x => x.classList.toggle('on', x.id === 'p-' + k)); }
function renderFiles() {
  const p = proj(), f = p.files, names = Object.keys(f).sort();
  if (!f[sel]) { sel = names[0] || null; vm = ''; }
  const tot = names.reduce((a, n) => { const s = stat(fdiff(f[n])); a.a += s.a; a.d += s.d; return a; }, { a: 0, d: 0 });
  const pend = names.filter(n => f[n].state === 'pending'), last = [...p.msgs].reverse().find(x => x.sp), sp = last ? last.sp : [];
  $('#p-sum').innerHTML = names.length || sp.length ? `<div class="sc-sec"><b>${esc(p.name)}</b><p>${esc(p.summary || 'Nothing built yet.')}</p></div><div class="sc-kv"><div><b>${names.length}</b>files</div><div><b>${pend.length}</b>to review</div><div class="g"><b>+${tot.a}</b>added</div><div class="r"><b>−${tot.d}</b>removed</div></div>`
    + (pend.length ? '<div class="sc-sec"><button class="sc-btn ok" data-all>Accept all files</button></div>' : '')
    + (sp.length ? '<div class="sc-sec"><b>Spectres</b><div class="sc-tree">' + sp.map((s, i) => spCard(s, i === sp.length - 1)).join('') + '</div></div>' : '')
    : '<p class="sc-note">Nothing here yet. Tell Spectra what to build and the summary shows up here.</p>';
  if (!names.length) { $('#p-files').innerHTML = '<p class="sc-note">No files yet. Your Spectres will write them here.</p>'; renderTabs(); return; }
  const c = f[sel], d = fdiff(c), mode = vm || (c.old && c.state === 'pending' ? 'diff' : 'code'), q = esc(sel);
  const vs = c.versions || [], vi = verI == null || verI >= vs.length ? vs.length - 1 : verI;
  const codeOf = s => s.split('\n').slice(0, 800).map((l, i) => `<div class="sc-l"><i>${i + 1}</i><code>${esc(l) || ' '}</code></div>`).join('');
  const body = showVer && vs.length ? `<div class="sc-vers">${vs.map((v, i) => `<button class="sc-btn ${i === vi ? 'on' : ''}" data-ver="${i}">v${i + 1} · ${new Date(v.t).toLocaleTimeString()}</button>`).join('')}${vi !== vs.length - 1 ? '<button class="sc-btn ok" data-restore="' + vi + '">Restore this version</button>' : ''}</div>` + codeOf(vs[vi].content) : mode === 'diff' ? dview(d, 500) : codeOf(c.content);
  $('#p-files').innerHTML = `<div class="sc-ft">${names.map(n => `<button class="sc-fi2 ${n === sel ? 'on' : ''}" data-sel="${esc(n)}"><i class="sc-sd ${f[n].state}"></i><span>${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button>`).join('')}</div>`
    + `<div class="sc-view"><div class="sc-vh"><span>${q}</span>${statH(stat(d))}</div><div class="sc-vb"><button class="sc-btn ${mode === 'code' ? 'on' : ''}" data-vm="code">Code</button><button class="sc-btn ${mode === 'diff' ? 'on' : ''}" data-vm="diff">Diff</button><button class="sc-btn ${showVer ? 'on' : ''}" data-vm="ver">Versions</button>`
    + (c.state === 'pending' ? `<button class="sc-btn ok" data-acc="${q}">Accept</button><button class="sc-btn" data-rej="${q}">Reject</button>` : `<span class="sc-st">${c.state}</span>`)
    + `<button class="sc-btn" data-cp="${q}">Copy</button><button class="sc-btn" data-dl="${q}">Download</button></div><div class="sc-diff big">${body}</div></div>`;
  renderTabs();
}
function renderAll() { renderTabs(); renderMsgs(); renderFiles(); }

/* ---------- build ---------- */
function status(on, txt) {
  const el = $('#scStatus'); el.hidden = !on; clearInterval(tick);
  if (!on) return;
  const t0 = Date.now(); $('#scStatusTxt').textContent = txt;
  tick = setInterval(() => { const tok = Math.round(Object.values(proj().files).reduce((a, f) => a + f.content.length, 0) / 4); $('#scStatusMeta').textContent = '(Press esc to interrupt · ' + Math.round((Date.now() - t0) / 1000) + 's · ↓ ' + tok + ' tokens)'; }, 500);
}
const setSt = (m, id, st) => { const s = m.sp.find(x => x.id === id); if (s) s.st = st; const c = document.querySelector(`[data-sid="${id}"] .sc-st`); if (c) { c.textContent = st; c.dataset.s = st; } };
const say = (t, extra) => { const p = proj(); const m = Object.assign({ r: 'a', t }, extra); p.msgs.push(m); save(); renderMsgs(); return m; };

let mode = 'build';
const done = () => { save(); status(false); busy = false; ctl = null; $('#scSend').disabled = false; renderAll(); };
const fail = (e, m) => {
  const msg = e.name === 'AbortError' ? 'Stopped.' : { LOGIN: 'Log in to use Spectra Code.', DAILY: 'You used all your Spectra credits for today. They reset at midnight UTC.', RATE: 'Too many requests. Wait a minute and try again.', UPSTREAM: 'Spectra got no answer from her brain. Check the spectra-code function logs in Supabase (GEMINI_API_KEY and model names), then try again.' }[e.message] || 'Spectra could not plan that. Try again or make the request simpler.';
  if (m && m.sp) m.sp.forEach(s => { if (s.st === 'Running' || s.st === 'Queued') s.st = 'Cancelled'; });
  say(msg, { err: 1 }); log('error: ' + e.message);
};
const ctxFiles = () => Object.entries(proj().files).slice(0, 6).map(([path, f]) => ({ path, content: f.content.slice(0, 8000) }));
function renderMode() {
  const el = $('#scModes'); el.hidden = mode === 'build';
  el.innerHTML = mode === 'build' ? '' : `<span class="sc-chip">${mode === 'plan' ? 'Plan Mode' : 'Ask Spectra'}<u data-m="off">×</u></span><span>${mode === 'plan' ? 'Spectra plans first, you approve before the Spectres build.' : 'Ask about your code. No files get written.'}</span>`;
  $('#scIn').placeholder = mode === 'ask' ? 'Ask Spectra about your code...' : mode === 'plan' ? 'Describe what to build. Spectra will plan it first.' : 'Tell Spectra what to build. Enter to send, Shift+Enter for a new line.';
}
async function exec(m, plan, text, effort, model) {
  const p = proj(), changed = new Set();
  status(true, 'Deploying ' + m.sp.length + ' Spectres...');
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
      setSt(m, s.id, 'Completed'); log(s.id + ' done: ' + out.files.map(f => f.path).join(', ')); renderFiles();
    } catch (e) { const a = e.name === 'AbortError'; setSt(m, s.id, a ? 'Cancelled' : 'Failed'); log(s.id + (a ? ' cancelled' : ' failed')); }
  }));
  const bad = m.sp.filter(s => s.st !== 'Completed').length;
  say(bad ? bad + ' Spectre(s) did not finish, so some files are missing. Send the request again to retry them.' : 'All done. Open the Files tab and accept the files you want.', bad ? { err: 1, files: [...changed] } : { files: [...changed] });
}
async function build() {
  const input = $('#scIn'), text = input.value.trim();
  if (!text || busy) return;
  const p = proj(), effort = EFF[+$('#scEff').value], model = $('#scModel').value, md = mode;
  busy = true; $('#scSend').disabled = true; input.value = '';
  p.msgs.push({ r: 'u', t: text }); if (p.msgs.length === 1) p.name = text.slice(0, 22); p.t = Date.now(); save(); renderAll();
  ctl = new AbortController(); status(true, md === 'ask' ? 'Thinking...' : 'Orchestrating...'); log(md + ': effort=' + effort);
  let m;
  try {
    const r = await req({ mode: md === 'ask' ? 'ask' : 'plan', prompt: text, effort, model, files: ctxFiles() }, ctl.signal);
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

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target, d = k => t.closest('[' + k + ']') && t.closest('[' + k + ']').getAttribute(k), p = proj();
  if (t.dataset.x) { e.stopPropagation(); P = P.filter(x => x.id !== t.dataset.x); if (cur === t.dataset.x) cur = P[0].id; save(); renderAll(); return; }
  const id = d('data-id'); if (id && (t.closest('.sc-tab') || t.closest('.sa-item'))) { cur = id; save(); renderAll(); return; }
  if (t.closest('#scNew, #scNew2')) { const n = mk('Project ' + (P.length + 1)); P.push(n); cur = n.id; save(); renderAll(); return; }
  if (t.closest('.sc-ptabs [data-p]')) { tab(t.closest('[data-p]').dataset.p); return; }
  const cp = d('data-cp'), dl = d('data-dl'), acc = d('data-acc'), rej = d('data-rej');
  if (cp) navigator.clipboard.writeText(p.files[cp].content).catch(() => { });
  if (dl) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([p.files[dl].content], { type: 'text/plain' })); a.download = dl.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  if (acc) { p.files[acc].state = 'accepted'; save(); renderFiles(); }
  if (rej) { delete p.files[rej]; save(); renderFiles(); }
  if (t.closest('[data-all]')) { Object.values(p.files).forEach(f => { f.state = 'accepted'; }); save(); renderFiles(); }
  const op = d('data-open'), sl = d('data-sel'), vv = d('data-vm');
  if (op) { sel = op; vm = ''; tab('files'); renderFiles(); }
  if (sl) { sel = sl; vm = ''; showVer = false; verI = null; renderFiles(); }
  if (vv) { if (vv === 'ver') showVer = !showVer; else { vm = vv; showVer = false; } renderFiles(); }
  const mm = d('data-m'), tl = d('data-t'), ve = d('data-ver'), rs = d('data-restore'), menu = $('#scMenu');
  if (ve !== null) { verI = +ve; renderFiles(); }
  if (rs !== null) { const f = p.files[sel], v = f.versions[+rs]; f.old = f.content; f.content = v.content; f.state = 'pending'; f.versions = f.versions.concat([{ t: Date.now(), content: v.content }]).slice(-10); showVer = false; save(); renderFiles(); }
  if (t.closest('#scPlus')) menu.hidden = !menu.hidden; else if (!t.closest('#scMenu')) menu.hidden = true;
  if (mm) {
    if (mm === 'tools') $('#scTools').hidden = !$('#scTools').hidden; else menu.hidden = true;
    if (mm === 'files') $('#scFile').click();
    if (mm === 'plan' || mm === 'ask') { mode = mode === mm ? 'build' : mm; renderMode(); }
    if (mm === 'off') { mode = 'build'; renderMode(); }
    if (mm === 'ver') { tab('files'); showVer = true; renderFiles(); }
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
$('#scIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ctl) ctl.abort(); });
$('#scEff').addEventListener('input', e => { $('#scEffTxt').textContent = EFFN[+e.target.value]; });
renderAll(); renderMode(); log('Spectra Code ready');
})();
