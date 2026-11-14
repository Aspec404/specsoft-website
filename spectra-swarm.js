/* SPECSOFT® Spectra Code: live Spectre swarm view. Add AFTER spectra-code.js (or before, it is standalone).
   API (called by spectra-code.js): SCSwarm.start(spectres), SCSwarm.set(id, status), SCSwarm.end()
   Rows = the real steps Spectra's planner wrote for each Spectre. Status comes from the real Spectre status. */
(function () {
'use strict';
const G = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'], END = { Completed: '✓', Failed: '✗', Cancelled: '⊘' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
let sp = [], st = {}, t0 = 0, timer = null, fr = 0, open = true, live = false;
const $ = () => document.getElementById('scSwarm');
const sec = (a, b) => Math.max(0, Math.round(((b || Date.now()) - a) / 1000)) + 's';

function build() {
  const el = $(); if (!el) return;
  const rows = [];
  sp.forEach(s => {
    const steps = s.steps && s.steps.length ? s.steps : [s.title], files = s.files && s.files.length ? s.files : ['file'];
    steps.forEach((n, k) => rows.push(`<div class="sw-r" data-sid="${s.id}" data-s="${st[s.id].s}" style="--k:${k}"><span class="sw-t">${k === steps.length - 1 ? '└─' : '├─'}</span><span class="sw-g">·</span><span class="sw-n" title="${esc(s.role)}">${esc(n)}</span><span class="sw-u"></span><span class="sw-c">Write(${esc(files[k % files.length])})</span></div>`));
  });
  el.innerHTML = `<div class="sw-h" data-sw="toggle"><span class="sw-g sw-hg">✻</span><b class="sw-title">Orchestrating</b><span class="sw-sum"></span><small class="sw-cnt"></small></div><div class="sw-grid">${rows.join('')}</div>`;
  el.classList.toggle('closed', !open);
}
function tick() {
  const el = $(); if (!el) return; fr++;
  let d = 0, r = 0, q = 0, f = 0, c = 0, i = 0;
  el.querySelectorAll('.sw-r').forEach(row => {
    const s = st[row.dataset.sid]; if (!s) return;
    if (row.dataset.s !== s.s) row.dataset.s = s.s;
    const g = row.querySelector('.sw-g'), u = row.querySelector('.sw-u');
    if (s.s === 'Running') { r++; g.textContent = calm ? '✻' : G[(fr + i * 3) % G.length]; u.textContent = sec(s.t); }
    else if (s.s === 'Queued') { q++; g.textContent = '·'; u.textContent = ''; }
    else { if (s.s === 'Completed') d++; else if (s.s === 'Failed') f++; else c++; g.textContent = END[s.s] || '·'; u.textContent = s.t ? sec(s.t, s.e) : ''; }
    i++;
  });
  const total = i, hg = el.querySelector('.sw-hg');
  hg.textContent = live ? (calm ? '✻' : G[fr % G.length]) : f ? '!' : c ? '■' : '✓';
  el.querySelector('.sw-title').textContent = live ? 'Orchestrating' : f ? 'Finished with errors' : c ? 'Stopped' : 'Done';
  el.querySelector('.sw-sum').textContent = sp.length + ' Spectre' + (sp.length > 1 ? 's' : '') + ' · ' + total + ' step' + (total > 1 ? 's' : '');
  el.querySelector('.sw-cnt').textContent = d + ' done · ' + r + ' running · ' + q + ' queued' + (f ? ' · ' + f + ' failed' : '') + ' · ' + sec(t0, live ? 0 : t0 + (st._dur || 0));
}
window.SCSwarm = {
  start(list) {
    const el = $(); if (!el || !list || !list.length) return;
    sp = list; st = {}; t0 = Date.now(); open = true; live = true; fr = 0;
    list.forEach(s => { st[s.id] = { s: s.st || 'Queued', t: 0, e: 0 }; });
    el.hidden = false; build(); tick(); clearInterval(timer); timer = setInterval(tick, 130);
  },
  set(id, status) {
    const s = st[id]; if (!s) return;
    if (status === 'Running' && !s.t) s.t = Date.now();
    if (status !== 'Running' && status !== 'Queued') { if (!s.t) s.t = Date.now(); s.e = Date.now(); }
    s.s = status;
  },
  end() {
    if (!live) return; live = false; clearInterval(timer); st._dur = Date.now() - t0;
    Object.keys(st).forEach(k => { const s = st[k]; if (s && s.s !== undefined && (s.s === 'Running' || s.s === 'Queued')) { s.s = 'Cancelled'; s.e = Date.now(); } });
    tick(); open = false; const el = $(); if (el) el.classList.add('closed');
  },
};
document.addEventListener('click', e => { const h = e.target.closest('[data-sw="toggle"]'); if (!h || live) return; open = !open; const el = $(); if (el) el.classList.toggle('closed', !open); });
})();
