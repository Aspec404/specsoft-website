/* SPECSOFT® Spectra Academics v5 (projects: edit popup with name, description, color + symbol pickers, reorder by drag or Move up/down, archive). v4: projects as folders, inline project creation, drag and drop, project menu, cooler sidebar. v3 (try again, edit + copy your message, new Video button + video-making card). v2: Talks to the same "spectra-chat" Edge Function with an `academics` field.
   v2: "+" menu (files, project, persona), Tools menu (level, web search, deep reasoning, deep research),
   chat three-dot menu (pin, rename, add to project, delete), no tracks for Elementary. */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const P = {
  back: 'M15 6l-6 6 6 6', plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z', menu: 'M4 7h16M4 12h16M4 17h16', send: 'M12 19V5M6 11l6-6 6 6', stop: 'M8 8h8v8H8z',
  panel: 'M4 5h16v14H4zM9 5v14', tools: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4', chev: 'M6 9l6 6 6-6', chevr: 'M9 6l6 6-6 6',
  clip: 'M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01', pin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17v4M17 19h4',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  copy: 'M9 9h10v10H9zM5 15V5h10', speaker: 'M4 9v6h4l5 4V5L8 9zM16.5 9a4 4 0 010 6M19 6.5a8 8 0 010 11',
  up: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 012 2v4h6a2 2 0 012 2l-1.5 7a2 2 0 01-2 1.5H7', down: 'M7 13V4H4v9zM7 13l4 7a2 2 0 002-2v-4h6a2 2 0 002-2l-1.5-7A2 2 0 0017.5 3H7',
  spin: 'M12 3a9 9 0 019 9', play: 'M8 5v14l11-7z', flag: 'M5 21V4M5 4h11l-2 4 2 4H5', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1', check: 'M5 12l5 5 9-10', blank: 'M0 0',
  refresh: 'M4 12a8 8 0 0113.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 01-13.7 5.6L4 15M4 20v-5h5',
  cards: 'M8 8h12v10H8zM4 15V6a2 2 0 012-2h9',
  vid: 'M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM10 9.2v5.6l4.8-2.8z',
  x: 'M6 6l12 12M18 6L6 18', arrup: 'M12 19V5M6 11l6-6 6 6', arrdn: 'M12 5v14M6 13l6 6 6-6', archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4', palette2: 'M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2.2-.5-1.2.3-2.3 1.6-2.3H17a4 4 0 004-4c0-5-4-9.5-9-9.5zM7.5 11h.01M10 7.5h.01M14 7.5h.01M16.5 11h.01',
  /* project symbols */
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13', flask: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3', calc: 'M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z', rocket: 'M12 2.5c3.6 2.6 5 6 5 9.5l-1.6 3.8H8.6L7 12c0-3.5 1.4-6.9 5-9.5zM9 15.5l-3.2 3.7 3.7-.7M15 15.5l3.2 3.7-3.7-.7M12 9h.01M10.6 19.2c.3 1.2.8 2 1.4 2.6.6-.6 1.1-1.4 1.4-2.6', bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.5.4.5 1 .5 1.6V16h6v-.5c0-.6 0-1.2.5-1.6A6 6 0 0012 3z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 11a3.5 3.5 0 100 7 3.5 3.5 0 000-7z', leaf: 'M5 19C5 10 10 5 20 4c0 10-5 15-14 15zM5 19l8-8',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM12 12h.01', trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H4v2a3 3 0 003 3M16 6h4v2a3 3 0 01-3 3M12 13v4M8 21h8M10 17h4', cap: 'M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8', puzzle: 'M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4H4a2 2 0 110-4h2V6h4z', compass: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5z', chat: 'M4 5h16v11H9l-5 4z'
};
const paint = r => (r || document).querySelectorAll('[data-ic]').forEach(e => { e.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + (P[e.dataset.ic] || '') + '"/></svg>'; });
const toast = t => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); setTimeout(() => e.classList.remove('on'), 2400); };
const SUBJ = ['Math', 'General Sciences', 'Social Studies', 'Languages', 'ICT/TVL', 'General Knowledge'], LEVELS = ['Elementary', 'Junior High', 'Senior High', 'College'];
const WEB_AUTO = ['Social Studies', 'General Knowledge'];
const PERS = [{ id: 'spectra', n: 'Spectra (Default)' }, { id: 'dev', n: 'Developer Mode' }, { id: 'creative', n: 'Creative' }, { id: 'custom', n: 'Custom' }];
let chats = LS('sa.acad.chats', []), projs = LS('sa.acad.proj', []), cur = null, proj = null, pend = null, busy = false, ctrl = null;
let subject = '', track = '', level = LS('sa.acad.level', 'Senior High'), web = false, think = false, research = false;
/* persona, custom persona, nickname and model are SHARED with Spectra Chat (sa.persona, sa.cfg, sa.model). Reply length + emojis are Academics-only (sa.acad.cfg). */
const CFGS = () => LS('sa.cfg', {}) || {};
const ACFG = () => Object.assign({ len: 'detailed', emo: 'few' }, LS('sa.acad.cfg', {}) || {});
let persona = LS('sa.persona', LS('sa.acad.persona', 'spectra')), custom = String(CFGS().persona || LS('sa.acad.custom', '') || '').slice(0, 400);
if (!PERS.some(p => p.id === persona) || (persona === 'custom' && !custom.trim())) persona = 'spectra';
const root = document.documentElement, main = $('#main'), comp = $('#comp'), inp = $('#in'), sd = $('#sd'), sc = $('#sc');
const save = () => { SS('sa.acad.chats', chats.filter(c => c.pin).concat(chats.filter(c => !c.pin)).slice(0, 40)); SS('sa.acad.proj', projs); };
const nm = () => (($('[data-user-name]') || {}).textContent || '').trim();
const noTrack = () => level === 'Elementary';

/* theme */
const th = $('#theme');
const setTh = t => { root.dataset.theme = t; SS('sa.acad.theme', t); th.dataset.ic = t === 'dark' ? 'sun' : 'moon'; paint(th.parentNode); };
th.onclick = () => setTh(root.dataset.theme === 'dark' ? 'light' : 'dark');

/* markdown + math (math is protected first so KaTeX auto-render can find it) */
function md(t, live) {
  const M = [];
  /* single-dollar math ($5$, $x$) -> \(..\). Strict: money like "$5 and $8" stays plain text. Code fences are skipped. */
  t = t.split('```').map((p, i) => i % 2 ? p : p.replace(/(?<![\w$\\])\$(?!\s)([^$\n]{1,80}?)(?<!\s)\$(?![\w$])/g, (m, a) => '\\(' + a + '\\)')).join('```');
  t = t.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, m => { M.push(m); return '\uE000' + (M.length - 1) + '\uE001'; });
  return t.split('```').map((p, i) => {
    if (i % 2) {
      if ((p.match(/^[^\n]*/) || [''])[0].trim().toLowerCase() === 'viz') {
        let ok = null; if (!live) { try { ok = JSON.stringify(JSON.parse(p.replace(/^[^\n]*\n?/, '').trim())); } catch (e) { ok = null; } }
        return ok ? '<div class="ac-viz" data-v="' + esc(ok) + '"></div>' : live ? '<div class="ac-viz ld"><span class="ac-dots"><i></i><i></i><i></i></span>Spectra is drawing...</div>' : '';
      }
      return '<pre><code>' + esc(p.replace(/^[^\n]*\n/, '')) + '</code></pre>';
    }
    let h = esc(p).replace(/^#{1,3} (.+)$/gm, '<h3>$1</h3>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/(<code>[^<]*<\/code>)|(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?![*\w])/gm, (m, c, a, b) => c || a + '<i>' + b + '</i>');
    h = h.replace(/(^|\n)((?:[-*] .+(?:\n|$))+)/g, (m, a, b) => a + '<ul>' + b.trim().split('\n').map(x => '<li>' + x.slice(2) + '</li>').join('') + '</ul>')
      .replace(/(^|\n)((?:\d+\. .+(?:\n|$))+)/g, (m, a, b) => a + '<ol>' + b.trim().split('\n').map(x => '<li>' + x.replace(/^\d+\. /, '') + '</li>').join('') + '</ol>');
    return h.replace(/\n/g, '<br>').replace(/(<\/(?:ul|ol|h3)>)<br>/g, '$1').replace(/<br>(<(?:ul|ol|h3))/g, '$1');
  }).join('').replace(/\uE000(\d+)\uE001/g, (x, k) => esc(M[k]));
}
const math = el => { if (window.renderMathInElement) try { renderMathInElement(el, { throwOnError: false, delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }] }); } catch (e) { } };
const clean = t => t.replace(/^\s*\[mood:[a-z]*\]?\s*/i, '');
const srcHtml = a => (a.src && a.src.length) ? '<div class="ac-src"><b>Sources</b><br>' + a.src.filter(s => s && /^https:\/\//i.test(s.u)).map(s => '<a href="' + esc(s.u) + '" target="_blank" rel="noopener noreferrer">' + esc(s.t || s.u.replace(/^https:\/\/(www\.)?/, '').split('/')[0]) + '</a>').join('') + '</div>' : '';
const aHtml = (a, live) => a.content ? md(a.content, live) + srcHtml(a) : '<span class="ac-dots"><i></i><i></i><i></i></span>' + (a.st ? '<span class="ac-st">' + esc(a.st) + '</span>' : '');

/* projects: folders hold their chats. Create them inline, drag chats in, or use "Add to project" from the menus. */
const PC = ['#7c5cff', '#22d3ee', '#34d399', '#f472b6', '#fb923c', '#60a5fa'];
const PCOL = PC.concat(['#f87171', '#facc15', '#a3e635', '#94a3b8']);   // colors in the picker (any other color works through the rainbow swatch)
const PIC = ['folder', 'book', 'flask', 'calc', 'globe', 'code', 'edit', 'star', 'heart', 'bolt', 'rocket', 'bulb', 'music', 'palette2', 'camera', 'leaf', 'target', 'trophy', 'cap', 'chart', 'puzzle', 'compass', 'chat', 'pin'];   // symbols in the picker
const pico = p => (p && PIC.indexOf(p.i) >= 0) ? p.i : 'folder';
const liveProjs = () => projs.filter(p => !p.a);   // archived projects are hidden from the pickers
const pcol = id => { const i = projs.findIndex(p => p.id === id); return (projs[i] && projs[i].c) || PC[(i < 0 ? 0 : i) % PC.length]; };
let pex = LS('sa.acad.pex', {}), creating = null, dragId = null, pmid = null, pmsure = false;
const sPex = () => SS('sa.acad.pex', pex);
const pname = id => (projs.find(p => p.id === id) || {}).n || '';
const inProj = c => !!c.proj && projs.some(p => p.id === c.proj);
function newProj(after) {
  creating = { after: after || null };
  if (shell.classList.contains('min')) setMin(false); shell.classList.add('drawer');
  plist(); const i = $('#pni'); if (i) i.focus();
}
function finishNew(ok) {
  if (!creating) return; const i = $('#pni'), v = ok && i ? i.value.trim().slice(0, 28) : '', after = creating.after; creating = null;
  if (!v) { plist(); return; }
  const id = 'p' + Date.now().toString(36); projs.push({ id, n: v, c: PC[projs.length % PC.length] }); pex[id] = true; sPex(); save(); plist(); toast('Project created'); if (after) after(id);
}
function setProj(id) { if (cur) { cur.proj = id || null; save(); } else pend = id || ''; if (id) { pex[id] = true; sPex(); } list(); tag(); }
function startIn(id) {
  if (busy) stop(); if (window.SpectraVoice) SpectraVoice.stop(); cur = null; pend = id; pex[id] = true; sPex();
  draw(); list(); closeDrawer(); inp.focus(); toast('New chat in ' + pname(id));
}
function delProj(id) {
  chats.forEach(c => { if (c.proj === id) c.proj = null; }); projs = projs.filter(p => p.id !== id); delete pex[id]; sPex(); if (pend === id) pend = null;
  save(); list(); tag(); toast('Project deleted, its chats are kept');
}
const row = (c, nest) => '<div class="ac-it' + (nest ? ' nest' : '') + (cur && cur.id === c.id ? ' on' : '') + (mid === c.id ? ' mo' : '') + '" data-id="' + c.id + '" draggable="true"><span class="ac-t">' + esc(c.title) + '</span>' + (c.pin ? '<i class="ac-pn" data-ic="pin"></i>' : '') + '<button class="ac-dot" data-o="' + c.id + '" type="button" aria-label="Chat options" data-ic="dots"></button></div>';
const prow = (p, arch) => {
  const cs = chats.filter(c => c.proj === p.id), open = pex[p.id] !== false;
  return '<div class="ac-pj' + (open ? ' open' : '') + (arch ? ' arch' : '') + (pmid === p.id ? ' mo' : '') + '" data-pid="' + p.id + '"><div class="ac-pr" data-pr="' + p.id + '"' + (arch ? '' : ' draggable="true"') + (p.d ? ' title="' + esc(p.d) + '"' : '') + '><i class="ac-cv" data-ic="chevr"></i><i class="ac-pc" style="--pc:' + pcol(p.id) + '" data-ic="' + pico(p) + '"></i><span class="ac-pt">' + esc(p.n) + '</span><em>' + cs.length + '</em>' +
    (arch ? '' : '<button class="ac-pa" data-pn="' + p.id + '" type="button" aria-label="New chat in this project" title="New chat here" data-ic="plus"></button>') + '<button class="ac-pa ac-pm" data-pm="' + p.id + '" type="button" aria-label="Project options" data-ic="dots"></button></div>' +
    '<div class="ac-pk">' + (p.d ? '<div class="ac-pd">' + esc(p.d) + '</div>' : '') + (cs.length ? cs.map(c => row(c, 1)).join('') : '<div class="ac-em">' + (arch ? 'No chats in it' : 'Drop chats here') + '</div>') + '</div></div>';
};
function plist() {
  const q = $('#q').value.trim(); $('#psec').hidden = !!q; if (q) return;
  const ni = $('#pni'), keep = ni ? ni.value : '', had = !!ni && document.activeElement === ni;
  let h = creating ? '<div class="ac-pj"><div class="ac-pr"><i class="ac-pc" style="--pc:' + PC[projs.length % PC.length] + '" data-ic="folder"></i><input class="ac-ri" id="pni" maxlength="28" placeholder="Project name" aria-label="Project name" autocomplete="off"></div></div>' : '';
  h += liveProjs().map(p => prow(p, 0)).join('');
  const ar = projs.filter(p => p.a), aop = pex.__arch === true;
  if (ar.length) h += '<div class="ac-ah' + (aop ? ' open' : '') + '" data-arch="1" role="button" tabindex="0"><i class="ac-cv" data-ic="chevr"></i><i class="ac-ai" data-ic="archive"></i><span>Archived</span><em>' + ar.length + '</em></div>' + (aop ? '<div class="ac-al">' + ar.map(p => prow(p, 1)).join('') + '</div>' : '');
  $('#pl').innerHTML = h || '<div class="ac-em">Group your chats into projects</div>'; paint($('#pl'));
  const i = $('#pni'); if (i) { i.value = keep; if (had || !keep) i.focus(); }
}

/* chat list: pinned first, then Today / Yesterday / Earlier. Each chat has a three-dot menu. */
let mid = null, mv = 'main', anc = null;
function drawChats() {
  const q = $('#q').value.trim().toLowerCase();
  const pool = chats.filter(c => (q || !inProj(c)) && c.title.toLowerCase().includes(q)), pins = q ? [] : pool.filter(c => c.pin), rest = q ? pool : pool.filter(c => !c.pin);
  $('#cl').innerHTML = (pins.length ? '<div class="ac-gl">Pinned</div>' + pins.map(c => row(c)).join('') : '') + (rest.length ? '<div class="ac-gl">' + (q ? 'Results' : 'Recents') + '</div>' + rest.map(c => row(c)).join('') : '') || (q ? '<div class="ac-em">No matches</div>' : '<div class="ac-em">No chats yet</div>');
  paint($('#cl'));
}
function list() { plist(); drawChats(); }
const cm = document.createElement('div'); cm.id = 'cm'; cm.className = 'ac-cm'; document.body.appendChild(cm);
function closeMenu() { if (mid === null) return; mid = null; cm.classList.remove('open'); list(); }
function place() {
  const w = cm.offsetWidth || 210, h = cm.offsetHeight;
  const l = Math.min(Math.max(8, anc.right - w), innerWidth - w - 8); let t = anc.bottom + 6;
  if (t + h > innerHeight - 8) t = Math.max(8, anc.top - h - 6);
  cm.style.left = l + 'px'; cm.style.top = t + 'px';
}
function menuDraw() {
  const c = chats.find(x => x.id === mid); if (!c) { closeMenu(); return; }
  const it = (a, ic, tx, cls) => '<button type="button" class="ac-mi' + (cls ? ' ' + cls : '') + '" data-a="' + a + '"><i data-ic="' + ic + '"></i><span>' + tx + '</span></button>';
  if (mv === 'main') cm.innerHTML = it('pin', 'pin', c.pin ? 'Unpin Chat' : 'Pin Chat') + it('ren', 'edit', 'Rename Chat') +
    '<button type="button" class="ac-mi" data-a="proj"><i data-ic="folder"></i><span>Add to project</span><i data-ic="chevr" class="ac-chv"></i></button><div class="ac-sep"></div>' + it('del', 'trash', 'Delete Chat', 'dg');
  else cm.innerHTML = '<button type="button" class="ac-mi" data-a="back"><i data-ic="back"></i><span>Add to project</span></button><div class="ac-sep"></div>' +
    [{ id: '', n: 'No project' }].concat(liveProjs()).map(p => '<button type="button" class="ac-mi" data-pj="' + (p.id || '') + '"><i data-ic="' + ((c.proj || '') === (p.id || '') ? 'check' : 'blank') + '"></i><span>' + esc(p.n) + '</span></button>').join('') +
    '<button type="button" class="ac-mi" data-pj="__new"><i data-ic="plus"></i><span>New project</span></button>';
  paint(cm); place();
}
function openMenu(id, btn) { mid = id; mv = 'main'; anc = btn.getBoundingClientRect(); cm.classList.add('open'); menuDraw(); list(); }
cm.onclick = e => {
  e.stopPropagation(); const c = chats.find(x => x.id === mid); if (!c) return;
  const pj = e.target.closest('[data-pj]');
  if (pj) {
    const id = pj.dataset.pj, cid = mid;
    if (id === '__new') { closeMenu(); newProj(nid => { const cc = chats.find(x => x.id === cid); if (cc) { cc.proj = nid; save(); list(); toast('Added to ' + pname(nid)); } }); return; }
    c.proj = id || null; if (id) { pex[id] = true; sPex(); } save(); closeMenu(); toast(id ? 'Added to ' + pname(id) : 'Removed from project'); return;
  }
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'proj') { mv = 'proj'; menuDraw(); return; } if (a === 'back') { mv = 'main'; menuDraw(); return; }
  const id = mid; closeMenu();
  if (a === 'pin') { c.pin = !c.pin; save(); list(); toast(c.pin ? 'Chat pinned' : 'Chat unpinned'); }
  else if (a === 'ren') rename(id); else if (a === 'del') del(id);
};
function rename(id) {
  const c = chats.find(x => x.id === id), sp = $('#sb [data-id="' + id + '"] .ac-t'); if (!c || !sp) return;
  const i = document.createElement('input'); i.className = 'ac-ri'; i.value = c.title; i.maxLength = 40; i.setAttribute('aria-label', 'Rename chat');
  sp.replaceWith(i); i.focus(); i.select(); let done = false;
  const fin = ok => { if (done) return; done = true; const v = i.value.trim(); if (ok && v) { c.title = v.slice(0, 40); save(); } list(); };
  i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') fin(false); e.stopPropagation(); };
  i.onblur = () => fin(true); i.onclick = e => e.stopPropagation();
}
function del(id) {
  chats = chats.filter(c => c.id !== id); if (cur && cur.id === id) { if (busy) stop(); cur = null; draw(); }
  save(); plist(); list(); toast('Chat deleted');
}
$('#sb').onclick = e => {
  const o = e.target.closest('[data-o]');
  if (o) { e._o = 1; const id = o.dataset.o; closePm(); if (mid === id) closeMenu(); else openMenu(id, o); return; }
  const pm = e.target.closest('[data-pm]');
  if (pm) { e._o = 1; const id = pm.dataset.pm; closeMenu(); if (pmid === id) closePm(); else openPm(id, pm); return; }
  const pn = e.target.closest('[data-pn]'); if (pn) { startIn(pn.dataset.pn); return; }
  if (e.target.closest('.ac-ri')) return;
  const ah = e.target.closest('[data-arch]'); if (ah) { pex.__arch = pex.__arch !== true; sPex(); plist(); return; }
  const pr = e.target.closest('[data-pr]'); if (pr) { const id = pr.dataset.pr; pex[id] = pex[id] === false; sPex(); plist(); return; }
  const it = e.target.closest('[data-id]'); if (!it) return;
  if (busy) stop(); if (window.SpectraVoice) SpectraVoice.stop(); cur = chats.find(c => c.id === it.dataset.id) || null; draw(); list(); closeDrawer();
};
$('#sb').addEventListener('scroll', () => { closeMenu(); closePm(); });
$('#sb').addEventListener('keydown', e => { if (e.target.id !== 'pni') return; if (e.key === 'Enter') { e.preventDefault(); finishNew(true); } else if (e.key === 'Escape') finishNew(false); e.stopPropagation(); });
$('#sb').addEventListener('focusout', e => { if (e.target.id === 'pni') setTimeout(() => { if (creating && document.activeElement !== $('#pni')) finishNew(true); }, 120); });
$('#q').oninput = list;
$('#np').onclick = () => newProj();

/* project menu (three dots on a folder) */
const pmn = document.createElement('div'); pmn.id = 'pmn'; pmn.className = 'ac-cm'; document.body.appendChild(pmn);
function pmDraw() {
  const p = projs.find(x => x.id === pmid) || {}, act = liveProjs(), i = act.findIndex(x => x.id === pmid);
  const it = (a, ic, tx, cls, off) => '<button type="button" class="ac-mi' + (cls ? ' ' + cls : '') + (off ? ' off' : '') + '" data-a="' + a + '"' + (off ? ' disabled' : '') + '><i data-ic="' + ic + '"></i><span>' + tx + '</span></button>';
  pmn.innerHTML = (p.a ? '' : it('new', 'plus', 'New chat here')) + it('edit', 'palette2', 'Edit project') + it('ren', 'edit', 'Rename') +
    (p.a ? '<div class="ac-sep"></div>' + it('unarch', 'refresh', 'Unarchive') : '<div class="ac-sep"></div>' + it('up', 'arrup', 'Move up', '', i <= 0) + it('dn', 'arrdn', 'Move down', '', i < 0 || i >= act.length - 1) + it('arch', 'archive', 'Archive project')) +
    '<div class="ac-sep"></div>' + it('del', 'trash', pmsure ? 'Tap again to delete' : 'Delete project', 'dg'); paint(pmn);
}
function closePm() { if (pmid === null) return; pmid = null; pmsure = false; pmn.classList.remove('open'); plist(); }
function openPm(id, btn) {
  pmid = id; pmsure = false; const r = btn.getBoundingClientRect(); pmDraw(); pmn.classList.add('open');
  const w = pmn.offsetWidth || 210, h = pmn.offsetHeight; let t = r.bottom + 6; if (t + h > innerHeight - 8) t = Math.max(8, r.top - h - 6);
  pmn.style.left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8) + 'px'; pmn.style.top = t + 'px'; plist();
}
pmn.onclick = e => {
  e.stopPropagation(); const b = e.target.closest('[data-a]'); if (!b || pmid === null) return; const a = b.dataset.a, id = pmid;
  if (a === 'del' && !pmsure) { pmsure = true; pmDraw(); return; }
  closePm(); if (a === 'new') startIn(id); else if (a === 'ren') renameProj(id); else if (a === 'del') delProj(id);
  else if (a === 'edit') openPd(id); else if (a === 'up') moveProj(id, -1); else if (a === 'dn') moveProj(id, 1); else if (a === 'arch') archProj(id, true); else if (a === 'unarch') archProj(id, false);
};
function renameProj(id) {
  const p = projs.find(x => x.id === id), sp = $('#pl [data-pid="' + id + '"] .ac-pt'); if (!p || !sp) return;
  const i = document.createElement('input'); i.className = 'ac-ri'; i.value = p.n; i.maxLength = 28; i.setAttribute('aria-label', 'Rename project');
  const dr = sp.closest('.ac-pr'); if (dr) dr.draggable = false;
  sp.replaceWith(i); i.focus(); i.select(); let done = false;
  const fin = ok => { if (done) return; done = true; const v = i.value.trim(); if (ok && v) { p.n = v.slice(0, 28); save(); } list(); tag(); };
  i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') fin(false); e.stopPropagation(); };
  i.onblur = () => fin(true); i.onclick = e => e.stopPropagation();
}

/* projects: move up/down, drag to reorder (computers), archive, and the edit popup (name, description, color, symbol) */
function flashProj(id) { const el = $('#pl [data-pid="' + id + '"]'); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
function moveProjTo(id, tid, after) {   // put project id before or after project tid
  const i = projs.findIndex(p => p.id === id), t = projs.findIndex(p => p.id === tid); if (i < 0 || t < 0 || id === tid) return;
  const [p] = projs.splice(i, 1), j = projs.findIndex(x => x.id === tid); projs.splice(after ? j + 1 : j, 0, p); save(); plist(); flashProj(id);
}
function moveProj(id, d) {
  const act = liveProjs(), i = act.findIndex(p => p.id === id), j = i + d; if (i < 0 || j < 0 || j >= act.length) return;
  moveProjTo(id, act[j].id, d > 0);
}
function archProj(id, on) {
  const p = projs.find(x => x.id === id); if (!p) return; p.a = !!on; if (on) { if (pend === id) pend = null; }
  save(); list(); tag(); toast(on ? 'Project archived' : 'Project restored');
}
let pdrag = null;
const pdMark = () => $$('#sb .pdz-a,#sb .pdz-b,#sb .pdrag').forEach(x => x.classList.remove('pdz-a', 'pdz-b', 'pdrag'));
const pdAfter = (t, e) => { const h = t.querySelector('.ac-pr').getBoundingClientRect(); return e.clientY > h.top + h.height / 2; };
$('#sb').addEventListener('dragstart', e => {
  const r = e.target.closest && e.target.closest('.ac-pr[data-pr]'); if (!r || r.closest('.arch') || r.querySelector('.ac-ri')) return;
  pdrag = r.dataset.pr; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'project:' + pdrag); } catch (x) { } r.closest('.ac-pj').classList.add('pdrag');
});
$('#sb').addEventListener('dragover', e => {
  if (!pdrag) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch)'); if (!t || t.dataset.pid === pdrag) return;
  e.preventDefault(); $$('#sb .pdz-a,#sb .pdz-b').forEach(x => x.classList.remove('pdz-a', 'pdz-b')); t.classList.add(pdAfter(t, e) ? 'pdz-a' : 'pdz-b');
});
$('#sb').addEventListener('drop', e => {
  if (!pdrag) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch)'); if (!t || t.dataset.pid === pdrag) return;
  e.preventDefault(); const id = pdrag, after = pdAfter(t, e); pdrag = null; pdMark(); moveProjTo(id, t.dataset.pid, after);
});
$('#sb').addEventListener('dragend', () => { pdrag = null; pdMark(); });

let pd = null;   // the project being edited in the popup: { id, n, d, c, i }
const pdb = document.createElement('div'); pdb.className = 'ac-pdb'; pdb.id = 'pdb'; document.body.appendChild(pdb);
pdb.innerHTML = '<div class="ac-pdx" role="dialog" aria-modal="true" aria-label="Edit project">' +
  '<div class="ac-pdh"><span class="ac-pdv" id="pdv"></span><b>Edit project</b><button class="ac-ib" data-a="cancel" type="button" aria-label="Close" data-ic="x"></button></div>' +
  '<label class="ac-pdl"><span>Name</span><input id="pdn" maxlength="28" autocomplete="off" placeholder="Project name"></label>' +
  '<label class="ac-pdl"><span>Description <small id="pdc"></small></span><textarea id="pdd" rows="3" maxlength="140" placeholder="What is this project about? (optional)"></textarea></label>' +
  '<div class="ac-pdl"><span>Color</span><div class="ac-pcols" id="pdcol"></div></div>' +
  '<div class="ac-pdl"><span>Symbol</span><div class="ac-pics" id="pdic"></div></div>' +
  '<div class="ac-pdf"><button type="button" class="ac-pbt ghost" data-a="arch" id="pda"></button><span></span><button type="button" class="ac-pbt" data-a="cancel">Cancel</button><button type="button" class="ac-pbt pri" data-a="save">Save</button></div></div>';
paint(pdb);
function pdDraw() {
  const col = pd.c, list = PCOL.indexOf(col) >= 0 ? PCOL : PCOL.concat([col]);
  pdb.style.setProperty('--pc', col);
  $('#pdv').innerHTML = '<i data-ic="' + pd.i + '"></i>'; $('#pdc').textContent = pd.d.length + '/140';
  $('#pdcol').innerHTML = list.map(c => '<button type="button" class="ac-sw' + (c === col ? ' on' : '') + '" data-c="' + c + '" style="--c:' + c + '" aria-label="Color ' + c + '"></button>').join('') + '<label class="ac-sw ac-swu" title="Custom color"><input type="color" id="pdu" value="' + col + '" aria-label="Custom color"></label>';
  $('#pdic').innerHTML = PIC.map(k => '<button type="button" class="ac-pi' + (k === pd.i ? ' on' : '') + '" data-i="' + k + '" aria-label="Symbol ' + k + '" data-ic="' + k + '"></button>').join('');
  paint(pdb);
}
function openPd(id) {
  const p = projs.find(x => x.id === id); if (!p) return;
  pd = { id, n: p.n, d: p.d || '', c: pcol(id), i: pico(p) }; closeMenu(); closePm();
  $('#pdn').value = pd.n; $('#pdd').value = pd.d; $('#pda').textContent = p.a ? 'Unarchive' : 'Archive'; pdDraw();
  pdb.classList.add('on'); if (!matchMedia('(hover:none) and (pointer:coarse)').matches) setTimeout(() => { const n = $('#pdn'); if (n && pdb.classList.contains('on')) { n.focus(); n.select(); } }, 60);   // not on phones: the keyboard would cover the pickers
}
function closePd() { pd = null; pdb.classList.remove('on'); }
function applyPd() {
  const p = projs.find(x => x.id === pd.id), n = $('#pdn').value.trim().slice(0, 28);
  if (!n) { toast('Give the project a name'); $('#pdn').focus(); return false; }
  p.n = n; p.d = pd.d.trim().slice(0, 140); p.c = pd.c; p.i = pd.i; if (!p.d) delete p.d; save(); return true;
}
pdb.addEventListener('click', e => {
  if (e.target === pdb) { closePd(); return; } if (!pd) return;
  const c = e.target.closest('.ac-sw[data-c]'); if (c) { pd.c = c.dataset.c; pdDraw(); return; }
  const k = e.target.closest('.ac-pi[data-i]'); if (k) { pd.i = k.dataset.i; pdDraw(); return; }
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'cancel') closePd();
  else if (a === 'save') { if (applyPd()) { closePd(); list(); tag(); toast('Project updated'); } }
  else if (a === 'arch') { const id = pd.id, was = !!(projs.find(x => x.id === id) || {}).a; if (applyPd()) { closePd(); archProj(id, !was); } }
});
pdb.addEventListener('input', e => {
  if (!pd) return;
  if (e.target.id === 'pdd') { pd.d = e.target.value; $('#pdc').textContent = pd.d.length + '/140'; }
  else if (e.target.id === 'pdu' && /^#[0-9a-f]{6}$/i.test(e.target.value)) { pd.c = e.target.value.toLowerCase(); pdb.style.setProperty('--pc', pd.c); $$('#pdcol .ac-sw.on').forEach(x => x.classList.remove('on')); }
});
pdb.addEventListener('change', e => { if (pd && e.target.id === 'pdu') pdDraw(); });
document.addEventListener('keydown', e => {
  if (!pd) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePd(); }
  else if (e.key === 'Enter' && (e.target.id === 'pdn' || e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (applyPd()) { closePd(); list(); tag(); toast('Project updated'); } }
}, true);

/* drag a chat onto a project (or back onto Recents) */
$('#sb').addEventListener('dragstart', e => { const it = e.target.closest && e.target.closest('.ac-it'); if (!it) return; dragId = it.dataset.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { } it.classList.add('drag'); });
$('#sb').addEventListener('dragend', () => { dragId = null; $$('#sb .dz,#sb .drag').forEach(x => x.classList.remove('dz', 'drag')); });
$('#sb').addEventListener('dragover', e => { if (!dragId) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch),#cl'); if (!t) return; e.preventDefault(); $$('#sb .dz').forEach(x => x !== t && x.classList.remove('dz')); t.classList.add('dz'); });
$('#sb').addEventListener('dragleave', e => { const t = e.target.closest('.dz'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('dz'); });
$('#sb').addEventListener('drop', e => {
  if (!dragId) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch),#cl'); if (!t) return; e.preventDefault();
  const c = chats.find(x => x.id === dragId), id = t.dataset.pid || ''; dragId = null; $$('#sb .dz,#sb .drag').forEach(x => x.classList.remove('dz', 'drag')); if (!c) return;
  c.proj = id || null; if (id) { pex[id] = true; sPex(); } save(); list(); toast(id ? 'Added to ' + pname(id) : 'Moved to Recents');
});
$('#nw').onclick = () => { if (busy) stop(); if (window.SpectraVoice) SpectraVoice.stop(); cur = null; pend = null; draw(); list(); closeDrawer(); inp.focus(); };

/* message actions: copy, TTS, like, dislike, three-dot (report legal issue, share message link) */
const mkId = m => m.id || (m.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const bt = (k, ic, lb, on) => '<button type="button" class="ac-ab' + (on ? ' on' : '') + '" data-k="' + k + '" aria-label="' + lb + '" title="' + lb + '" data-ic="' + ic + '"></button>';
const ttsBtn = '<button type="button" class="ac-ab ac-tts" data-k="tts" data-a="speak" aria-label="Read aloud" title="Read aloud"><i class="v-i" data-ic="speaker"></i><i class="v-s" data-ic="stop"></i><i class="v-l" data-ic="spin"></i></button>';
const vidBtn = m => '<button type="button" class="ac-ab ac-vid' + (socOn() ? ' sk-off' : '') + '" data-k="video" title="' + (socOn() ? 'Off while Socratic Tutor is on' : 'Watch Spectra explain it as a video') + '" aria-label="Video"><i data-ic="vid"></i><span>' + (m.lesson ? 'Watch' : 'Video') + '</span></button>';
const fcBtn = m => '<button type="button" class="ac-ab ac-fc' + (socOn() ? ' sk-off' : '') + '" data-k="flash" title="' + (socOn() ? 'Off while Socratic Tutor is on' : 'Turn this answer into flashcards') + '" aria-label="Flashcards"><i data-ic="cards"></i><span>' + (m.cards ? 'Study' : 'Flashcards') + '</span></button>';
const VM = new WeakMap(), vm = m => { let s = VM.get(m); if (!s) { s = {}; VM.set(m, s); } s.content = plain(m); return s; };
const bar = (m, last) => '<div class="ac-acts">' + bt('copy', 'copy', 'Copy') + ttsBtn + bt('up', 'up', 'Good answer', m.fb === 'up') + bt('down', 'down', 'Bad answer', m.fb === 'down') + (last ? bt('regen', 'refresh', 'Try again') : '') + bt('more', 'dots', 'More') + vidBtn(m) + fcBtn(m) + '</div>';
const uBar = '<div class="ac-uacts">' + bt('ucopy', 'copy', 'Copy message') + bt('uedit', 'edit', 'Edit message') + '</div>';
const plain = m => m.content.replace(/```viz[\s\S]*?```/g, '').trim();
const copyTxt = t => (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).catch(() => { const x = document.createElement('textarea'); x.value = t; x.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); } catch (e) { } x.remove(); });
const mm = document.createElement('div'); mm.className = 'ac-cm ac-mm'; document.body.appendChild(mm); let mmm = null;
const closeMM = () => { mmm = null; mm.classList.remove('open'); };
function openMM(m, btn) {
  if (mmm === m.id) return closeMM(); mmm = m.id;
  mm.innerHTML = '<button type="button" class="ac-mi" data-z="share"><i data-ic="link"></i><span>Share Message Link</span></button><div class="ac-sep"></div><button type="button" class="ac-mi dg" data-z="legal"><i data-ic="flag"></i><span>Report Legal Issue</span></button>';
  paint(mm); mm.classList.add('open'); const r = btn.getBoundingClientRect(), w = mm.offsetWidth, h = mm.offsetHeight;
  mm.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 8) + 'px'; mm.style.top = (r.bottom + h + 14 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
}
async function reportLegal(m) {
  const d = (prompt('What is the legal issue with this message? (copyright, privacy, harmful content...)') || '').trim(); if (!d) return;
  if (d.length < 10) { toast('Add a bit more detail (10+ characters)'); return; }
  try {
    const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session; if (!s) { toast('Log in first to send a report'); return; }
    const C = window.SPECSOFT_CONFIG, i = cur.msgs.indexOf(m);
    const r = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY },
      body: JSON.stringify({ mode: 'bug', category: 'legal', message: d, info: 'Academics legal report | msg ' + m.id + ' | ' + (subject || 'General Knowledge') + ' | ' + level, chat: cur.msgs.slice(Math.max(0, i - 5), i + 1).map(x => ({ role: x.role, content: x.content })) }) });
    toast(r.ok ? 'Report sent. Thank you!' : r.status === 429 ? 'Too many reports, try again later' : 'Could not send the report');
  } catch (e) { toast('Could not send the report'); }
}
/* Flashcards button: Spectra writes a small deck from her answer (1 credit once, then it is saved on the message), the player lets you study it */
let fcBusy = false;
async function flash(m, b) {
  if (!window.SpectraFlash) { toast('Flashcards are not loaded'); return; }
  if (m.cards) { SpectraFlash.open(m.cards); return; }
  if (fcBusy) { toast('Spectra is still making flashcards'); return; }
  const i = cur ? cur.msgs.indexOf(m) : -1; if (i < 0 || !m.content) return;
  fcBusy = true; b.disabled = true; b.classList.add('ld'); const lb = b.querySelector('span'); if (lb) lb.textContent = 'Making...';
  const pn = vidPanel(b.closest('.ac-m.a'), 'Making your flashcards', ['Reading the answer', 'Picking the key ideas', 'Writing questions and answers', 'Checking every card']);
  const hist = cur.msgs.slice(0, i + 1).slice(-7).map(x => ({ role: x.role, content: x.content }));
  hist.push({ role: 'user', content: '[FLASHCARDS REQUEST] Turn your last answer into study flashcards.' });
  let raw = '';
  try {
    await ask(hist, t => { raw += t; }, new AbortController().signal, null, null, { flash: true, search: false, research: false, think: false, academics: { subject: cur.subject || subject || 'General Knowledge', level, track: '' } });
    const D = SpectraFlash.parse(raw); if (!D) throw new Error('PARSE');
    m.cards = D; save(); SpectraFlash.open(D);
  } catch (e) {
    toast(e.message === 'LOGIN' ? 'Log in first to make flashcards' : e.st === 429 ? 'Spectra is busy or you hit today\'s limit' : 'Spectra could not make flashcards. Try again.');
  }
  pn.end(); fcBusy = false; if (b.isConnected) { b.disabled = false; b.classList.remove('ld'); if (lb) lb.textContent = m.cards ? 'Study' : 'Flashcards'; }
}
/* Video button: Spectra writes a lesson script (costs 2 credits once, then it is saved on the message), the player performs it */
/* the "making your video" card: animated gradient outline, sound bars, rotating status lines */
function vidPanel(w, ttl, steps) {
  if (!w) return { end() { } };
  const S = steps || ['Reading the answer', 'Writing the script', 'Setting up the board', 'Timing every step', 'Adding the final touches'];
  const p = document.createElement('div'); p.className = 'ac-vmk'; p.setAttribute('role', 'status');
  p.innerHTML = '<div class="ac-vmb"><i></i><i></i><i></i><i></i><i></i></div><div class="ac-vmx"><b>' + (ttl || 'Making your video') + '</b><span>' + S[0] + '</span></div><div class="ac-vmp"></div>';
  w.appendChild(p); try { p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { }
  const sp = p.querySelector('.ac-vmx span'); let k = 0;
  const iv = setInterval(() => {
    if (!p.isConnected) { clearInterval(iv); return; }
    if (k >= S.length - 1) return; k++; sp.classList.add('sw'); setTimeout(() => { sp.textContent = S[k]; sp.classList.remove('sw'); }, 250);
  }, 2600);
  return { end() { clearInterval(iv); p.remove(); } };
}
let vidBusy = false;
async function video(m, b) {
  if (!window.SpectraLesson) { toast('Video mode is not loaded'); return; }
  if (m.lesson) { SpectraLesson.open(m.lesson); return; }
  if (vidBusy) { toast('Spectra is still making a video'); return; }
  const i = cur ? cur.msgs.indexOf(m) : -1; if (i < 0 || !m.content) return;
  vidBusy = true; b.disabled = true; b.classList.add('ld'); const lb = b.querySelector('span'); if (lb) lb.textContent = 'Making...'; const pn = vidPanel(b.closest('.ac-m.a'));
  const hist = cur.msgs.slice(0, i + 1).slice(-7).map(x => ({ role: x.role, content: x.content }));
  hist.push({ role: 'user', content: '[VIDEO LESSON REQUEST] Turn your last answer into a step-by-step video lesson with as many steps as the topic really needs.' });
  let raw = '';
  try {
    await ask(hist, t => { raw += t; }, new AbortController().signal, null, null, { lesson: true, search: false, research: false, think: false, academics: { subject: cur.subject || subject || 'General Knowledge', level, track: '' } });
    const L = SpectraLesson.parse(raw); if (!L) throw new Error('PARSE');
    m.lesson = L; save(); SpectraLesson.open(L);
  } catch (e) {
    toast(e.message === 'LOGIN' ? 'Log in first to make videos' : e.st === 429 ? 'Spectra is busy or you hit today\'s limit' : 'Spectra could not make that video. Try again.');
  }
  pn.end(); vidBusy = false; if (b.isConnected) { b.disabled = false; b.classList.remove('ld'); if (lb) lb.textContent = m.lesson ? 'Watch' : 'Video'; }
}
/* try again (last answer only), plus copy + edit on your own messages */
function regen(m) {
  if (busy) { toast('Spectra is still answering'); return; }
  if (!cur || m !== cur.msgs[cur.msgs.length - 1]) return;
  const u = cur.msgs[cur.msgs.length - 2]; if (!u || u.role !== 'user') return;
  if (u.img) toast('Images are not re-sent when trying again');
  if (window.SpectraVoice) SpectraVoice.stop();
  cur.msgs.pop(); run(undefined, m);
}
const cutAt = c => { const k = c.indexOf('\n\n[Attached:'); return k < 0 ? [c, ''] : [c.slice(0, k), c.slice(k)]; };
function cancelEd() { $$('.ac-ed').forEach(x => { const w = x.parentNode; x.remove(); w.classList.remove('editing'); }); }
function editMsg(w, m) {
  if (busy) { toast('Wait for Spectra to finish first'); return; }
  cancelEd(); const parts = cutAt(m.content), tail = parts[1];
  const ed = document.createElement('div'); ed.className = 'ac-ed';
  ed.innerHTML = '<textarea rows="1" aria-label="Edit your message"></textarea><div class="ac-edb"><button type="button" data-e="x">Cancel</button><button type="button" data-e="ok" class="pri">Save &amp; send</button></div>';
  const t = ed.firstChild; t.value = parts[0]; t.maxLength = Math.max(50, 3900 - tail.length);
  const fit = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 240) + 'px'; };
  t.oninput = fit;
  t.onkeydown = ev => { if (ev.key === 'Escape') cancelEd(); else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ed.querySelector('[data-e=ok]').click(); } };
  ed.onclick = ev => {
    const b = ev.target.closest('[data-e]'); if (!b) return; if (b.dataset.e === 'x') { cancelEd(); return; }
    const v = t.value.trim(); if (!v) { toast('Message cannot be empty'); return; }
    const i = cur ? cur.msgs.indexOf(m) : -1; if (i < 0 || busy) return;
    if (m.img) toast('Images are not re-sent when editing');
    if (window.SpectraVoice) SpectraVoice.stop();
    m.content = v + tail; cur.msgs.length = i + 1; run();
  };
  w.classList.add('editing'); w.appendChild(ed); fit(); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
}
$('#ms').addEventListener('click', e => {
  const b = e.target.closest('.ac-uacts .ac-ab'), w = b && b.closest('[data-uid]'), m = w && cur && cur.msgs.find(x => x.id === w.dataset.uid); if (!m) return;
  e.stopPropagation(); closeMM();
  if (b.dataset.k === 'ucopy') copyTxt(cutAt(m.content)[0]).then(() => toast('Copied')); else editMsg(w, m);
});
$('#ms').addEventListener('click', e => {
  const b = e.target.closest('.ac-ab'), w = b && b.closest('[data-mid]'), m = w && cur && cur.msgs.find(x => x.id === w.dataset.mid); if (!m) return;
  e.stopPropagation(); const k = b.dataset.k; if (k !== 'more') closeMM();
  if (k === 'copy') copyTxt(plain(m)).then(() => toast('Copied'));
  else if (k === 'tts') { if (window.SpectraVoice && window.SpectraVoice.toggle) window.SpectraVoice.toggle(vm(m), b); else toast('Spectra voice is coming soon'); }
  else if (k === 'up' || k === 'down') { m.fb = m.fb === k ? undefined : k; save(); b.parentNode.querySelectorAll('[data-k=up],[data-k=down]').forEach(x => x.classList.toggle('on', x.dataset.k === m.fb)); toast(m.fb ? 'Thanks for the feedback' : 'Feedback removed'); }
  else if (k === 'more') openMM(m, b);
  else if (k === 'regen') regen(m);
  else if ((k === 'video' || k === 'flash') && socOn()) toast('Socratic Tutor is on, so no answer reveals. Switch the skill to use this.');
  else if (k === 'video') video(m, b);
  else if (k === 'flash') flash(m, b);
});
mm.onclick = e => {
  e.stopPropagation(); const z = (e.target.closest('[data-z]') || {}).dataset; if (!z) return; const m = cur && cur.msgs.find(x => x.id === mmm); closeMM(); if (!m) return;
  if (z.z === 'share') copyTxt(location.origin + location.pathname + '#m=' + m.id).then(() => toast('Message link copied'));
  else reportLegal(m);
};
document.addEventListener('click', closeMM); document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMM(); }); addEventListener('resize', closeMM); $('#sc').addEventListener('scroll', closeMM);
function openHash() {
  const id = (location.hash.match(/^#m=([a-z0-9]+)$/) || [])[1]; if (!id) return; const c = chats.find(x => x.msgs.some(y => y.id === id)); if (!c) { toast('That message is not on this device'); return; }
  cur = c; draw(); list(); const el = $('[data-mid="' + id + '"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('ac-flash'); setTimeout(() => el.classList.remove('ac-flash'), 1800); }
}
addEventListener('hashchange', openHash);

/* chat view */
function draw() {
  const has = cur && cur.msgs.length;
  main.classList.toggle('chatting', !!has); tag();
  (has ? $('#dock') : $('#slot')).appendChild(comp);
  $('#ms').innerHTML = has ? cur.msgs.map(m => m.role === 'user'
    ? '<div class="ac-ur" data-uid="' + mkId(m) + '"><div class="ac-m u">' + esc(m.content.split('\n\n[Attached:')[0]).replace(/\n/g, '<br>') + (m.att && m.att.length ? '<div class="ac-ua">' + m.att.map(n => '<span>' + esc(n) + '</span>').join('') + '</div>' : '') + '</div>' + uBar + '</div>'
    : '<div class="ac-m a" data-mid="' + mkId(m) + '">' + aHtml(m) + (m.content && !(busy && m === cur.msgs[cur.msgs.length - 1]) ? bar(m, m === cur.msgs[cur.msgs.length - 1]) : '') + '</div>').join('') : '';
  paint($('#ms')); if (window.SpectraVoice && cur) $$('.ac-m.a[data-mid]').forEach(el => { const m = cur.msgs.find(x => x.id === el.dataset.mid); if (m) SpectraVoice.sync(el, vm(m)); });
  $$('.ac-m.a').forEach(math); if (window.SpectraViz) SpectraViz.mount($('#ms')); down();
}
const down = () => { sc.scrollTop = sc.scrollHeight; };
const setBtn = () => { sd.dataset.ic = busy ? 'stop' : 'send'; paint(sd.parentNode); };
const stop = () => { if (ctrl) ctrl.abort(); };

/* Skills & Capabilities choice (ids only; the server owns the real instructions) */
const EQ = () => { const v = LS('sa.acad.eq', null); return v && typeof v === 'object' ? v : null; };
const socOn = () => { const e = EQ(); return !!e && e.skill === 'socratic'; };   // Socratic Tutor never reveals answers, so Video and Flashcards are off
async function ask(msgs, onTok, sig, imgs, onEv, extra) {
  const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session;
  if (!s) throw new Error('LOGIN');
  const C = window.SPECSOFT_CONFIG;
  const r = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', {
    method: 'POST', signal: sig, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY },
    body: JSON.stringify(Object.assign({
      messages: msgs, persona: persona, custom: persona === 'custom' ? custom : '', model: model().id, think: think && !research, search: web && !research, research: research,
      nick: (CFGS().nick || nm()).slice(0, 20), hour: new Date().getHours(), memory: [], recent: [], style: { len: ACFG().len, emo: ACFG().emo }, images: imgs && imgs.length ? imgs : undefined,
      academics: { subject: subject || 'General Knowledge', level, track: noTrack() ? '' : track }, equip: EQ() || undefined
    }, extra || {}))
  });
  const lf = r.headers.get('X-Spectra-Left'), lm = r.headers.get('X-Spectra-Limit');
  if (lf !== null && lm !== null && +lm > 0) { SS('sa.left', { left: +lf, limit: +lm, day: new Date().toISOString().slice(0, 10) }); cred(); }
  if (r.headers.get('X-Spectra-Search') === 'failed') toast('Web search failed, answered without it');
  if (!r.ok || !r.body) { const e = new Error('HTTP'); e.st = r.status; throw e; }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (; ;) {
    const { done, value } = await rd.read(); if (done) return;
    buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop();
    for (const l of ls) {
      if (l.indexOf('data:') !== 0) continue; const x = l.slice(5).trim(); if (x === '[DONE]') return;
      try { const j = JSON.parse(x); const c = j.choices && j.choices[0].delta.content; if (c) onTok(c); if (onEv && (j.status || j.sources)) onEv(j); } catch (e) { }
    }
  }
}
async function send() {
  let t = inp.value.trim(); if (busy) return stop(); if (!t && !att.length) return;
  if (!t) t = 'Please take a look at this.';
  const imgs = att.filter(a => a.k === 'img').map(a => a.d), names = att.map(a => a.n);
  let content = t, room = 3900 - t.length;
  att.filter(a => a.k === 'txt').forEach(f => { const blk = '\n\n[Attached: ' + f.n.replace(/[\[\]\n]/g, '') + ']\n', take = room - blk.length; if (take < 50) return; const s = f.d.slice(0, take); content += blk + s; room -= blk.length + s.length; });
  att.length = 0; attDraw();
  if (!cur) { cur = { id: Date.now().toString(36), title: t.slice(0, 32), proj: pend === null ? proj : (pend || null), subject, msgs: [], t: Date.now() }; chats.unshift(cur); pend = null; }
  cur.msgs.push({ role: 'user', content, att: names.length ? names : undefined, img: imgs.length ? 1 : undefined });
  inp.value = ''; grow();
  await run(imgs);
}
/* AI chat title: after the first answer Spectra names the chat (free, same 'title' mode Spectra Chat uses). Only renames chats still carrying the default title (the start of your first message). */
async function autoTitle(chat) {
  const u = chat.msgs.find(m => m.role === 'user'), a = chat.msgs.find(m => m.role === 'assistant'); if (!u || !a || !a.content || chat.tt) return;
  const first = u.content.split('\n\n[Attached:')[0].trim(); if (chat.title !== first.slice(0, 32)) return;
  try {
    const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session; if (!s) return;
    const C = window.SPECSOFT_CONFIG;
    const r = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY },
      body: JSON.stringify({ mode: 'title', user: first.slice(0, 400), assistant: clean(a.content).slice(0, 300) }) });
    if (!r.ok) return; const d = await r.json(), tt = d && typeof d.title === 'string' ? d.title.trim() : '';
    if (!tt || chat.title !== first.slice(0, 32)) return;   // empty answer, or you renamed it meanwhile
    chat.title = tt.slice(0, 40); chat.tt = 1; save(); list(); plist();
  } catch (e) { }
}
/* one Spectra reply for the chat as it stands (its last message is the user's).
   fallback = the old answer: put back if a "try again" fails or is stopped before anything arrives */
async function run(imgs, fallback) {
  const chat = cur, a = { role: 'assistant', content: '', st: research ? 'Researching the web...' : web ? 'Searching the web...' : think ? 'Thinking it through...' : '' }; chat.msgs.push(a);
  busy = true; setBtn(); draw(); plist(); list();
  const hist = chat.msgs.slice(0, -1).slice(-12).map(m => ({ role: m.role, content: m.content })); ctrl = new AbortController(); let raw = '', failed = false;
  const el = () => cur === chat ? $$('.ac-m.a').pop() : null;
  try {
    await ask(hist, tok => { raw += tok; a.content = clean(raw); const e = el(); if (e) { e.innerHTML = aHtml(a, true); down(); } }, ctrl.signal, imgs, j => {
      if (j.status) a.st = research ? 'Researching the web...' : 'Searching the web...';
      if (j.sources) a.src = j.sources.slice(0, 10);
      const e = el(); if (e) { e.innerHTML = aHtml(a, true); if (a.content) math(e); }
    });
  } catch (e) {
    if (e.name !== 'AbortError') { failed = true; a.content = (a.content ? a.content + '\n\n' : '') + (e.message === 'LOGIN' ? 'Log in first, then come back so I can teach you!' : e.st === 429 ? 'Spectra is busy or you hit today\'s limit. Try again in a bit.' : 'Spectra had a problem answering. Try again.'); }
  }
  delete a.st;
  if (fallback && (failed || !a.content)) { chat.msgs.pop(); chat.msgs.push(fallback); toast(failed ? 'Could not try again, kept the old answer' : 'Kept the old answer'); }
  else if (!a.content) chat.msgs.pop();
  busy = false; ctrl = null; setBtn(); save(); draw(); plist(); list();
  if (!failed && !fallback && a.content) autoTitle(chat);
}

/* composer */
const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 180) + 'px'; comp.classList.toggle('typing', inp.value.length > 0); };
inp.oninput = grow; sd.onclick = send;
const touchUI = matchMedia('(hover:none) and (pointer:coarse)');   // phones and tablets: Enter = new line, the Send button sends. On a computer Enter still sends (Shift+Enter = new line).
if (touchUI.matches) inp.enterKeyHint = 'enter';
inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { if (touchUI.matches) return; e.preventDefault(); send(); } };

/* attachments: up to 3 images (shrunk before sending) or text files (first ~3000 characters) */
const att = [], TXT = /\.(txt|md|csv|json|js|ts|py|html|css|java|c|cpp|cs|lua|sql|xml|yml|yaml|log)$/i;
const FILE_I = 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5';
function attDraw() {
  const b = $('#att'); b.hidden = !att.length;
  b.innerHTML = att.map((a, i) => '<span class="ac-chip">' + (a.k === 'img' ? '<img src="' + a.d + '" alt="">' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + FILE_I + '"/></svg>') + '<em>' + esc(a.n) + '</em><button type="button" data-r="' + i + '" aria-label="Remove">\u00d7</button></span>').join('');
}
$('#att').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; att.splice(+b.dataset.r, 1); attDraw(); };
function readImg(f) {
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const go = (max, q) => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k)); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); };
      let d = go(1024, .82); if (d.length > 1.2e6) d = go(768, .6);
      if (d.length > 1.2e6) { toast('That image is too big'); return; }
      if (att.length >= 3) { toast('Max 3 attachments'); return; }
      att.push({ n: f.name, k: 'img', d }); attDraw();
    };
    im.onerror = () => toast('Could not read that image'); im.src = fr.result;
  };
  fr.readAsDataURL(f);
}
function readTxt(f) {
  if (f.size > 300000) { toast('That file is too big'); return; }
  const fr = new FileReader();
  fr.onload = () => { const s = String(fr.result); if (att.length >= 3) { toast('Max 3 attachments'); return; } if (s.length > 3000) toast('Long file: sending the first 3,000 characters'); att.push({ n: f.name, k: 'txt', d: s.slice(0, 3000) }); attDraw(); };
  fr.readAsText(f);
}
function addFiles(fl) {
  [...fl].forEach(f => { if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) readImg(f); else if (f.type.indexOf('text/') === 0 || TXT.test(f.name)) readTxt(f); else toast('Images and text files only for now'); });
}
$('#fi').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
inp.addEventListener('paste', e => { const fs = [...((e.clipboardData || {}).files || [])].filter(f => f.type.indexOf('image/') === 0); if (fs.length) { e.preventDefault(); addFiles(fs); } });

/* academic tracks (Senior High and up; Elementary has none) */
const TR = { 'ICT/TVL': [
  ['TVL/ICT', ['Computer Programming', 'Computer Systems Servicing', 'Animation', 'Illustration', 'Technical Drafting']],
  ['TVL/Home Economics', ['Cookery', 'Bread and Pastry', 'Food and Beverage', 'Housekeeping', 'Dressmaking', 'Caregiving']],
  ['TVL/Industrial Arts', ['Electrical Installation', 'Automotive Servicing', 'Welding', 'Carpentry', 'Plumbing', 'Electronics']],
  ['TVL/Agri-Fishery Arts', ['Crop Production', 'Animal Production', 'Aquaculture', 'Food Processing']],
  ['STEM', ['Pre-Calculus', 'Basic Calculus', 'General Chemistry', 'General Physics', 'General Biology']],
  ['ABM', ['Business Math', 'Fundamentals of ABM', 'Business Finance', 'Organization and Management', 'Principles of Marketing']],
  ['HUMSS', ['Creative Writing', 'Philippine Politics and Governance', 'World Religions', 'Community Engagement', 'Disciplines in the Social Sciences']],
  ['GAS', ['Humanities', 'Social Sciences', 'Applied Economics', 'Disaster Readiness and Risk Reduction']]] };
const hasTr = () => !noTrack() && !!TR[subject];
function trk() {
  const L = hasTr() ? TR[subject] : null, el = $('#trk'); el.hidden = !L; if (!L) { el.innerHTML = ''; return; }
  el.innerHTML = L.map(t => '<div class="ac-tk"><button type="button" class="ac-tn" data-t="' + t[0] + '">' + t[0] + '</button><button type="button" class="ac-tx" data-x="1">Expand more<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button><div class="ac-ts">' + t[1].map(s => '<button type="button" data-t="' + t[0] + ': ' + s + '">' + s + '</button>').join('') + '</div></div>').join('');
}
$('#trk').onclick = e => {
  const x = e.target.closest('[data-x]'); if (x) { x.parentNode.classList.toggle('open'); return; }
  const b = e.target.closest('[data-t]'); if (!b) return; track = track === b.dataset.t ? '' : b.dataset.t;
  $$('#trk .ac-tk').forEach(k => k.classList.toggle('on', !!track && track.split(': ')[0] === k.querySelector('.ac-tn').dataset.t));
  $$('#trk .ac-ts button').forEach(s => s.classList.toggle('on', s.dataset.t === track)); tag();
};

/* tag line + modes */
const tag = () => {
  const m = [(noTrack() ? '' : track) || subject || 'Any subject', level];
  if (research) m.push('Deep research'); else { if (web) m.push('Web'); if (think) m.push('Reasoning'); }
  if (persona !== 'spectra') m.push(PERS.find(p => p.id === persona).n);
  const pj = curProj(); if (pj && pname(pj)) m.push(pname(pj));
  $('#tg').textContent = m.join(' \u00b7 '); inp.placeholder = subject ? 'Ask about ' + subject + '...' : 'Ask me anything...';
  $('#tl').classList.toggle('lit', web || think || research);
  const gm = research ? 'res' : (think && web) ? 'tw' : think ? 't' : web ? 'w' : ''; if (gm) comp.dataset.gm = gm; else delete comp.dataset.gm;
};
const syncModes = () => { $('#tw').checked = web; $('#tt').checked = think; $('#tr').checked = research; tag(); };
$('#tw').onchange = e => { web = e.target.checked; if (web) research = false; syncModes(); };
$('#tt').onchange = e => { think = e.target.checked; if (think) research = false; syncModes(); };
$('#tr').onchange = e => { research = e.target.checked; if (research) { web = false; think = false; } syncModes(); };

/* subjects + level */
const SI = { 'Math': 'M5 4h14l-7 8 7 8H5', 'General Sciences': 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3', 'Social Studies': P.globe, 'Languages': 'M4 5h9M8.5 3v2M6 5c0 4 3 7 7 8M11 5c0 3-3 6-7 8M14 21l4-10 4 10M15.5 17.5h5', 'ICT/TVL': 'M4 5h16v11H4zM9 20h6M12 16v4', 'General Knowledge': 'M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z' };
$('#pills').innerHTML = SUBJ.map(s => '<button class="ac-pill" type="button" data-s="' + s + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + SI[s] + '"/></svg>' + s + '</button>').join('');
$('#pills').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; subject = subject === b.dataset.s ? '' : b.dataset.s; track = ''; trk(); web = WEB_AUTO.includes(subject); if (web) research = false; syncModes(); $$('.ac-pill').forEach(x => x.classList.toggle('on', x.dataset.s === subject)); if (!hasTr()) inp.focus(); };
$('#lv').innerHTML = LEVELS.map(l => '<button type="button" data-l="' + l + '">' + l + '</button>').join('');
const lvDraw = () => $$('#lv button').forEach(b => b.classList.toggle('on', b.dataset.l === level));
$('#lv').onclick = e => {
  const b = e.target.closest('[data-l]'); if (!b) return; level = b.dataset.l; SS('sa.acad.level', level);
  if (noTrack()) { if (TR[subject]) toast('Elementary keeps it simple, no tracks needed'); track = ''; }
  trk(); lvDraw(); tag();
};

/* "+" menu: add files, add to project, persona */
const pops = { ap: '#pp', tl: '#pop', md: '#mpop' };
const closePops = () => { Object.values(pops).forEach(s => $(s).classList.remove('open')); $('#ap').classList.remove('open'); };
const togglePop = id => { const o = !$(pops[id]).classList.contains('open'); closePops(); if (!o) return; $(pops[id]).classList.add('open'); if (id === 'ap') { $('#ap').classList.add('open'); $$('#pp .ac-sub,#pp .ac-mi.sb').forEach(x => x.classList.remove('open')); $('#pcur').textContent = PERS.find(p => p.id === persona).n; } };
const curProj = () => cur ? (cur.proj || '') : (pend === null ? (proj || '') : (pend || ''));
function ppjDraw() {
  const c = curProj();
  $('#ppj').innerHTML = [{ id: '', n: 'No project' }].concat(liveProjs()).map(p => '<button type="button" class="ac-mi" data-pj="' + p.id + '"><i data-ic="' + (c === p.id ? 'check' : 'blank') + '"></i><span>' + esc(p.n) + '</span></button>').join('') + '<button type="button" class="ac-mi" data-pj="__new"><i data-ic="plus"></i><span>New project</span></button>';
  paint($('#ppj'));
}
function ppsDraw() {
  $('#pps').innerHTML = PERS.map(p => '<button type="button" class="ac-mi" data-pe="' + p.id + '"><i data-ic="' + (persona === p.id ? 'check' : 'blank') + '"></i><span>' + p.n + '</span></button>').join('');
  paint($('#pps'));
}
$('#pp').onclick = e => {
  const pj = e.target.closest('[data-pj]');
  if (pj) {
    const id = pj.dataset.pj;
    if (id === '__new') { closePops(); newProj(nid => { setProj(nid); toast('Added to ' + pname(nid)); }); return; }
    setProj(id); closePops(); toast(id ? 'Added to ' + pname(id) : 'No project'); return;
  }
  const pe = e.target.closest('[data-pe]');
  if (pe) {
    const id = pe.dataset.pe;
    if (id === 'custom' && !custom.trim()) { closePops(); if (window.SpectraAcadSettings) SpectraAcadSettings.open('personal', 'custom'); else toast('Settings are not loaded'); return; }
    persona = id; SS('sa.persona', persona); tag(); closePops(); toast(PERS.find(p => p.id === id).n + ' on'); return;
  }
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'file') { closePops(); $('#fi').click(); return; }
  const s = $(a === 'proj' ? '#ppj' : '#pps'), o = !s.classList.contains('open');
  $$('#pp .ac-sub,#pp .ac-mi.sb').forEach(x => x.classList.remove('open'));
  if (o) { s.classList.add('open'); b.classList.add('open'); if (a === 'proj') ppjDraw(); else ppsDraw(); }
};
$('#ap').onclick = e => { e.stopPropagation(); togglePop('ap'); };
$('#tl').onclick = e => { e.stopPropagation(); togglePop('tl'); };

/* model picker: same models and same saved choice ('sa.model') as Spectra Chat */
const MODELS = [{ id: '2.5', n: 'Spectrum 2.5', d: 'Fastest', g: 'Spectrum Series' }, { id: '3', n: 'Spectrum 3', d: 'Balanced', g: 'Spectrum Series' }, { id: '3.5', n: 'Spectrum 3.5', d: 'Smartest', g: 'Spectrum Series' }, { id: 'lumen4', n: 'Lumen 4', d: 'Newest', g: 'Lumen Series' }];
const model = () => MODELS.find(x => x.id === String(LS('sa.model', '3.5'))) || MODELS[2];
function mdraw() { let g = ''; $('#mn').textContent = model().n; $('#mpop').innerHTML = MODELS.map(m => (m.g !== g ? (g = m.g, '<b>' + g + '</b>') : '') + '<button type="button" data-m="' + m.id + '" class="' + (m.id === model().id ? 'on' : '') + '"><span>' + m.n + '</span><small>' + m.d + '</small></button>').join(''); }
$('#md').onclick = e => { e.stopPropagation(); togglePop('md'); };
$('#mpop').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; SS('sa.model', b.dataset.m); mdraw(); closePops(); toast(model().n + ' on'); };
document.addEventListener('click', e => { if (!e.target.closest('.ac-pop')) closePops(); if (mid !== null && !e._o && !e.target.closest('#cm')) closeMenu(); if (pmid !== null && !e._o && !e.target.closest('#pmn')) closePm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePops(); closeMenu(); closePm(); } });
addEventListener('resize', () => { closeMenu(); closePm(); });

/* greeting, credits, drawer */
const gr = () => { $('#gr').textContent = 'Hi ' + ((CFGS().nick || '').trim() || nm() || 'there') + ', what do we learn about today?'; };
const cred = () => { const u = LS('sa.left', null); $('#cr').textContent = u && u.day === new Date().toISOString().slice(0, 10) && u.limit > 0 ? u.left + ' / ' + u.limit + ' credits' : 'Credits'; };
const un = $('[data-user-name]'); if (un) new MutationObserver(gr).observe(un, { childList: true, characterData: true, subtree: true });
const shell = $('#app'), closeDrawer = () => shell.classList.remove('drawer');
$('#bg').onclick = () => shell.classList.add('drawer'); $('#bk').onclick = closeDrawer;
const colb = $('#col'), setMin = m => { shell.classList.toggle('min', m); SS('sa.acad.min', m); colb.setAttribute('aria-label', m ? 'Expand sidebar' : 'Collapse sidebar'); };
colb.onclick = () => setMin(!shell.classList.contains('min'));
$('.ac-s').addEventListener('click', () => { if (shell.classList.contains('min')) { setMin(false); setTimeout(() => $('#q').focus(), 260); } });
if (LS('sa.acad.min', false)) setMin(true);

/* settings module hooks */
function sync() { persona = LS('sa.persona', LS('sa.acad.persona', 'spectra')); custom = String(CFGS().persona || LS('sa.acad.custom', '') || '').slice(0, 400); if (!PERS.some(p => p.id === persona) || (persona === 'custom' && !custom.trim())) persona = 'spectra'; tag(); mdraw(); gr(); cred(); }
window.SpectraAcad = { md, math, paint, toast, redraw: draw, setTheme: setTh, sync, msgs: () => (cur ? cur.msgs : []) };
addEventListener('storage', e => { if (!e.key || e.key === 'sa.persona' || e.key === 'sa.cfg' || e.key === 'sa.model') sync(); });
th.dataset.ic = root.dataset.theme === 'dark' ? 'sun' : 'moon';
mdraw(); paint(); gr(); cred(); syncModes(); lvDraw(); plist(); list(); draw(); setBtn(); openHash();
})();
