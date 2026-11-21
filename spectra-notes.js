/* Spectra Notes (v2 + tabs view): a notebook inside Spectra Academics, saved in Supabase (table spectra_notes, see supabase-spectra-notes.sql and supabase-spectra-notes-v2.sql) so it follows you on every device.
   Tabs view: "Open in tabs view" in the note menu shows open notes in a tab bar (links, merges and new notes open as tabs). Browser-side only, no new SQL.
   v2 adds: Graph view, [[Back links]], Source mode, Find & Replace, Merge note with..., Add to my projects, Share (copy, .md, .txt, PDF, device share).
   Send to Spectra attaches the note as a .md file (host.toChatFile) and falls back to pasting the text.
   Public API:
     SpectraNotes.init(host)          -> wires the sidebar button and the notes view.
        host = { md, math, paint, toast, copy, subject(), summarize(text, question), merge(a, b), projects(), toChat(text), toChatFile(name, text, prompt), closeDrawer() }
     SpectraNotes.addFromAnswer(o)    -> "Add to notes": o = { text, question, subject, chat, msg }. Spectra summarizes, the note is saved, resolves { dup, note }. Rejects with Error('LOGIN' | 'SETUP' | message).
     SpectraNotes.open()              -> shows the notes view */
(function () {
  'use strict';
  var TB = 'spectra_notes', MAXN = 300, MAXB = 20000;
  var CATS = ['Math', 'General Sciences', 'Social Studies', 'Languages', 'ICT/TVL', 'General Knowledge'];
  var TABS = [['all', 'All'], ['pin', 'Pinned'], ['mark', 'Bookmarked'], ['arch', 'Archived']];
  var CATCOL = { 'Math': '#7c5cff', 'General Sciences': '#14b8a6', 'Social Studies': '#f59e0b', 'Languages': '#ec4899', 'ICT/TVL': '#3b82f6', 'General Knowledge': '#64748b' };
  var EXTRA = ['#ef4444', '#22c55e', '#06b6d4', '#a855f7'];
  var ICO = {   // small icons this file draws itself (the rest come from the page's data-ic set)
    graph: 'M7 6m-2 0a2 2 0 104 0a2 2 0 10-4 0M18 9m-2 0a2 2 0 104 0a2 2 0 10-4 0M10 18m-2 0a2 2 0 104 0a2 2 0 10-4 0M8.9 6.5l7.2 2M7.6 7.9l1.6 8.4M16.6 10.6l-5 5.8',
    merge: 'M6 3v4a5 5 0 005 5M18 3v4a5 5 0 01-5 5M12 12v9',
    share: 'M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6',
    dl: 'M12 4v11M8 11l4 4 4-4M5 19h14',
    repl: 'M4 8h13l-3.5-3.5M20 16H7l3.5 3.5',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    tabs: 'M3 19V8a1 1 0 011-1h5l1.5 2H20a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1zM3 7V5a1 1 0 011-1h4l1.5 2',
    list: 'M4 6h16M4 12h16M4 18h16', x: 'M6 6l12 12M18 6L6 18'
  };
  var ic = function (n) { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICO[n] + '"/></svg>'; };

  var H = null, root = null, btn = null, badge = null, mainEl = null;
  var S = {
    notes: [], loaded: false, busy: false, err: '', open: false, tab: 'all', cat: '', pf: '', q: '', id: null, mode: 'read',
    menu: false, del: false, view: 'list', find: false, ov: null, gsel: null, gcats: false, tabsOn: false, tabs: []
  };
  var F = { q: '', r: '', cs: false };
  var dirty = {}, dirtyId = null, timer = null, TM = null, lkc = {}, selMem = null, G = null;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var byId = function (id) { for (var i = 0; i < S.notes.length; i++) if (S.notes[i].id === id) return S.notes[i]; return null; };
  var paint = function (el) { if (H && H.paint) H.paint(el || root); };
  var toast = function (t) { if (H && H.toast) H.toast(t); };
  var fmt = function (d) {
    var t = new Date(d); if (isNaN(t)) return '';
    var n = new Date(), day = 864e5, diff = Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / day);
    if (diff === 0) return 'Today ' + t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (diff === 1) return 'Yesterday';
    return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: t.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
  };
  var snip = function (b) { return String(b || '').replace(/```[\s\S]*?```/g, ' ').replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, function (m, a, b2) { return b2 || a; }).replace(/^\s*[-*+]\s+|^\s*\d+[.)]\s+|^\s*#{1,4}\s+|^\s*>\s?/gm, '').replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150); };
  var projs = function () { try { return (H && H.projects && H.projects()) || []; } catch (e) { return []; } };
  var pn = function (id) { for (var i = 0, p = projs(); i < p.length; i++) if (p[i].id === id) return p[i]; return null; };
  var hash = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  var catColor = function (c) { return CATCOL[c] || EXTRA[hash(String(c)) % EXTRA.length]; };

  /* ---------- tabs view ---------- */
  function tabAdd(id) { if (S.tabsOn && S.tabs.indexOf(id) < 0) S.tabs.push(id); }
  function dropTab(id) {   // removes a tab and returns the neighbour to show next (or null)
    var i = S.tabs.indexOf(id); if (i < 0) return null;
    S.tabs.splice(i, 1);
    var live = S.tabs.filter(function (x) { var n = byId(x); return n && !n.archived && x !== id; });
    if (!live.length) { S.tabsOn = false; S.tabs = []; return null; }
    return live[Math.min(i, live.length - 1)];
  }
  function tabBar() {
    if (!S.tabsOn) return '';
    var ids = S.tabs.filter(function (x) { var n = byId(x); return n && (!n.archived || x === S.id); });
    if (!ids.length) return '';
    return '<div class="nt-tbar" role="tablist" aria-label="Open notes">' + ids.map(function (x) {
      var n = byId(x), on = x === S.id;
      return '<div class="nt-tab' + (on ? ' on' : '') + '" role="tab" tabindex="0" aria-selected="' + (on ? 'true' : 'false') + '" data-tabn="' + x + '" title="' + esc(n.title) + '"><span>' + esc(n.title) + '</span><button type="button" class="nt-tcl" data-tabx="' + x + '" aria-label="Close tab ' + esc(n.title) + '">' + ic('x') + '</button></div>';
    }).join('') + '<button type="button" class="nt-ib nt-ta" data-a="tabadd" aria-label="Open another note in a tab" title="Open another note">' + ic('plus') + '</button>' +
      '<button type="button" class="nt-ib nt-ta" data-a="tabsoff" aria-label="Close tabs view" title="Close tabs view">' + ic('list') + '</button></div>';
  }

  /* ---------- database ---------- */
  function fail(e) {
    var m = (e && e.message) || '';
    if (e && (e.code === '42P01' || e.code === 'PGRST205' || /schema cache|does not exist/i.test(m)) && !/column/i.test(m)) return new Error('SETUP');
    if (e && (e.code === '42703' || e.code === 'PGRST204' || /column .*project|project.*column/i.test(m))) return new Error('SETUP2');
    return e instanceof Error ? e : new Error(m || 'DB');
  }
  async function auth() {
    var sb = window.getSupabaseClient && window.getSupabaseClient(); if (!sb) throw new Error('SETUP');
    var r = await sb.auth.getSession(); if (!r.data || !r.data.session) throw new Error('LOGIN');
    return sb;
  }
  async function load(force) {
    if (S.busy || (S.loaded && !force)) return;
    S.busy = true; S.err = '';
    try {
      var sb = await auth(), r = await sb.from(TB).select('*').order('updated_at', { ascending: false }).limit(MAXN);
      if (r.error) throw fail(r.error);
      S.notes = r.data || []; S.loaded = true;
    } catch (e) { S.err = e.message || 'DB'; }
    S.busy = false; badgeDraw(); if (S.open) draw();
  }
  async function insert(f) {
    var sb = await auth(), r = await sb.from(TB).insert(f).select('*').single();
    if (r.error) { var e = fail(r.error); if (/limit reached/i.test(r.error.message || '')) e = new Error('LIMIT'); throw e; }
    return r.data;
  }
  async function upd(id, f) {   // one direct update (used where the result matters: project, merge)
    var sb = await auth(), r = await sb.from(TB).update(f).eq('id', id).select('*').single();
    if (r.error) throw fail(r.error);
    var n = byId(id); if (n) Object.assign(n, r.data);
    return r.data;
  }

  /* ---------- autosave (one note is edited at a time) ---------- */
  function sv(t) { var e = $('#ntsv'); if (e) { e.textContent = t; e.className = 'nt-sv' + (t === 'Not saved' ? ' bad' : ''); } }
  function queue(id, f, now) {
    var n = byId(id); if (!n) return;
    if (dirtyId && dirtyId !== id) flush();
    dirtyId = id; Object.assign(dirty, f); Object.assign(n, f); sv('Saving...');
    if ('title' in f || 'archived' in f) TM = null;
    clearTimeout(timer); timer = now ? null : setTimeout(flush, 700); if (now) flush();
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!dirtyId || !Object.keys(dirty).length) return;
    var id = dirtyId, f = dirty; dirty = {}; dirtyId = null;
    try {
      var sb = await auth(), r = await sb.from(TB).update(f).eq('id', id).select('updated_at').single();
      if (r.error) throw fail(r.error);
      var n = byId(id); if (n && r.data) n.updated_at = r.data.updated_at; sv('Saved');
    } catch (e) {
      sv('Not saved'); toast('Could not save your note');
      if (!dirtyId) { dirty = f; dirtyId = id; } else dirty = Object.assign({}, f, dirty);
    }
  }
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });

  /* ---------- [[links]] between notes ---------- */
  var LRE = '\\[\\[([^\\[\\]\\n|]{1,120})(?:\\|([^\\[\\]\\n]{1,120}))?\\]\\]';
  function linksOf(n) {   // { keys: ['lowercase title', ...], disp: { key: 'Title as typed' } }, cached until the text changes
    var c = lkc[n.id]; if (c && c.b === n.body) return c.v;
    var keys = [], disp = {}, re = new RegExp(LRE, 'g'), m, s = n.body || '';
    while ((m = re.exec(s))) { var k = m[1].trim().toLowerCase(); if (k && !disp[k]) { disp[k] = m[1].trim(); keys.push(k); } }
    var v = { keys: keys, disp: disp }; lkc[n.id] = { b: n.body, v: v }; return v;
  }
  function tm() {   // lowercase title -> the note that owns it (newest wins). Archived notes do not take part.
    if (TM) return TM;
    TM = {};
    S.notes.filter(function (n) { return !n.archived; }).sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).forEach(function (n) {
      var k = (n.title || '').trim().toLowerCase(); if (k && !TM[k]) TM[k] = n;
    });
    return TM;
  }
  function backlinks(n) {
    var k = (n.title || '').trim().toLowerCase(); if (!k || tm()[k] !== n) return [];
    return S.notes.filter(function (x) { return x.id !== n.id && !x.archived && linksOf(x).keys.indexOf(k) >= 0; });
  }
  function outlinks(n) {
    var l = linksOf(n);
    return l.keys.filter(function (k) { return k !== (n.title || '').trim().toLowerCase(); }).map(function (k) { return { d: l.disp[k], note: tm()[k] || null }; });
  }
  function wikify(el) {   // turns [[Title]] in the rendered note into tappable links
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (t) {
        var p = t.parentNode;
        if (p && p.closest && p.closest('code, pre, .katex, .katex-display, .nt-wl')) return NodeFilter.FILTER_REJECT;
        return t.nodeValue.indexOf('[[') >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    }), nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(function (t) {
      var s = t.nodeValue, re = new RegExp(LRE, 'g'), last = 0, m, any = false, frag = document.createDocumentFragment();
      while ((m = re.exec(s))) {
        any = true; if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var name = m[1].trim(), alias = (m[2] || '').trim(), hit = tm()[name.toLowerCase()], a = document.createElement('span');
        a.className = 'nt-wl' + (hit ? '' : ' miss'); a.setAttribute('role', 'link'); a.tabIndex = 0; a.setAttribute('data-wl', name);
        a.title = hit ? 'Open note' : 'Create this note'; a.textContent = alias || name; frag.appendChild(a); last = m.index + m[0].length;
      }
      if (any) { if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last))); t.parentNode.replaceChild(frag, t); }
    });
  }

  /* ---------- Add to notes (from the three-dot menu on Spectra's answers) ---------- */
  function fallbackNote(text, subject) {
    var t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/\r/g, '').trim();
    var first = (t.split('\n').filter(function (l) { return l.trim(); })[0] || 'Saved answer').replace(/^[#>*\-\s]+|[*_`]/g, '').trim();
    var body = t.slice(0, 1200); if (t.length > 1200) { var cut = body.lastIndexOf('\n'); body = (cut > 500 ? body.slice(0, cut) : body) + '\n\n...'; }
    return { title: first.slice(0, 60) || 'Saved answer', category: CATS.indexOf(subject) >= 0 ? subject : 'General Knowledge', body: body };
  }
  async function addFromAnswer(o) {
    o = o || {}; var text = String(o.text || '').trim(); if (!text) throw new Error('EMPTY');
    var sb = await auth();
    if (o.msg) {   // the same answer is never saved twice
      var have = S.loaded && S.notes.filter(function (n) { return n.source_msg === o.msg; })[0];
      if (!have) { var d = await sb.from(TB).select('*').eq('source_msg', o.msg).limit(1); if (d.error) throw fail(d.error); have = d.data && d.data[0]; }
      if (have) return { dup: true, note: have };
    }
    var fb = fallbackNote(text, o.subject), r = null;
    try { r = await H.summarize(text, o.question || ''); } catch (e) { r = null; }
    var useAI = !!(r && r.body && r.body.trim().length > 10);
    var row = await insert({
      title: ((useAI && r.title) || fb.title).slice(0, 120) || 'Saved answer',
      body: (useAI ? r.body : fb.body).slice(0, MAXB),
      category: (useAI && CATS.indexOf(r.category) >= 0 ? r.category : fb.category),
      source_chat: o.chat ? String(o.chat).slice(0, 60) : null, source_msg: o.msg ? String(o.msg).slice(0, 60) : null
    });
    if (S.loaded) { S.notes.unshift(row); TM = null; } badgeDraw(true); if (S.open && !S.id && S.view === 'list') draw();
    return { dup: false, note: row, ai: useAI };
  }

  /* ---------- list view ---------- */
  function visible() {
    var q = S.q.trim().toLowerCase();
    return S.notes.filter(function (n) {
      if (S.tab === 'arch' ? !n.archived : n.archived) return false;
      if (S.tab === 'pin' && !n.pinned) return false;
      if (S.tab === 'mark' && !n.bookmarked) return false;
      if (S.cat && n.category !== S.cat) return false;
      if (S.pf && n.project !== S.pf) return false;
      return !q || n.title.toLowerCase().indexOf(q) >= 0 || (n.body || '').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)); });
  }
  function badgeDraw(pulse) {
    if (!badge) return;
    var n = S.notes.filter(function (x) { return !x.archived; }).length;
    badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = !S.loaded || n === 0;
    if (pulse && btn) { btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse'); }
  }
  function msgBox(t, sub) { return '<div class="nt-em"><i data-ic="notes"></i><b>' + t + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>'; }
  function gridHtml() {
    if (S.busy && !S.loaded) return '<div class="nt-sk"><i></i><i></i><i></i></div>';
    if (S.err === 'LOGIN') return msgBox('Log in to see your notes', 'Your notes sync across all your devices.');
    if (S.err === 'SETUP') return msgBox('Notes need a one-time database setup', 'Run supabase-spectra-notes.sql in the Supabase SQL editor, then reload this page.');
    if (S.err) return msgBox('Could not load your notes', 'Check your connection and <button type="button" class="nt-lk" data-a="retry">try again</button>.');
    var ns = visible();
    if (!ns.length) return S.notes.length ? msgBox('Nothing here', S.q ? 'No notes match your search.' : 'No notes in this view yet.') : msgBox('No notes yet', 'Tap the three dots on any Spectra answer and choose <b>Add to notes</b>, or make your own with <b>New Note</b>.');
    return '<div class="nt-grid">' + ns.map(function (n) {
      var p = n.project && pn(n.project);
      return '<button type="button" class="nt-card' + (n.pinned ? ' pin' : '') + '" data-id="' + n.id + '"><span class="nt-ct"><b>' + esc(n.title) + '</b>' + (n.pinned ? '<i data-ic="pin"></i>' : '') + (n.bookmarked ? '<i data-ic="bookmark"></i>' : '') + '</span><span class="nt-cs">' + (esc(snip(n.body)) || '<em>Empty note</em>') + '</span><span class="nt-cf"><span class="nt-tg"><u>' + esc(n.category) + '</u>' + (p ? '<u class="pj"><s style="--pc:' + esc(p.c || '#7c5cff') + '"></s>' + esc(p.n) + '</u>' : '') + '</span><small>' + fmt(n.updated_at) + '</small></span></button>';
    }).join('') + '</div>';
  }
  function drawGrid() { var g = $('#ntg'); if (!g) return; g.innerHTML = gridHtml(); paint(g); }
  function listHtml() {
    var live = S.notes.filter(function (n) { return !n.archived; }), cnt = {}, pc = {};
    S.notes.forEach(function (n) { if (S.tab === 'arch' ? n.archived : !n.archived) { cnt[n.category] = (cnt[n.category] || 0) + 1; if (n.project) pc[n.project] = (pc[n.project] || 0) + 1; } });
    var h = '<div class="nt-wrap">' + tabBar() + '<header class="nt-hd"><div><h2>Notes</h2><p>' + (S.loaded ? live.length + (live.length === 1 ? ' note' : ' notes') : '&nbsp;') + '</p></div><div class="nt-ha"><button type="button" class="nt-gb" data-a="graph" aria-label="Open graph view" title="Graph view">' + ic('graph') + '<span>Graph</span></button><button type="button" class="nt-add" data-a="new"><i data-ic="plus"></i><span>New Note</span></button></div></header>';
    h += '<label class="nt-s"><i data-ic="search"></i><input id="ntq" type="search" placeholder="Search notes" autocomplete="off" value="' + esc(S.q) + '"></label>';
    h += '<div class="nt-tabs" role="tablist">' + TABS.map(function (t) { return '<button type="button" role="tab" class="' + (S.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    h += '<div class="nt-cats"><button type="button" class="' + (S.cat ? '' : 'on') + '" data-cat="">All categories</button>' + CATS.filter(function (c) { return cnt[c] || S.cat === c; }).map(function (c) { return '<button type="button" class="' + (S.cat === c ? 'on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '<em>' + (cnt[c] || 0) + '</em></button>'; }).join('') + '</div>';
    var pl = projs().filter(function (p) { return pc[p.id] || S.pf === p.id; });
    if (pl.length) h += '<div class="nt-cats nt-pcs"><button type="button" class="' + (S.pf ? '' : 'on') + '" data-pf="">All projects</button>' + pl.map(function (p) { return '<button type="button" class="' + (S.pf === p.id ? 'on' : '') + '" data-pf="' + esc(p.id) + '"><s style="--pc:' + esc(p.c || '#7c5cff') + '"></s>' + esc(p.n) + '<em>' + (pc[p.id] || 0) + '</em></button>'; }).join('') + '</div>';
    return h + '<div id="ntg">' + gridHtml() + '</div></div>';
  }

  /* ---------- note view (Read, Edit, Source) ---------- */
  function srcHtml(n) {
    var lines = String(n.body || '').split('\n');
    return '<div class="nt-src" role="region" aria-label="Raw note text"><div class="nt-sb"><span>Raw markdown, ' + lines.length + (lines.length === 1 ? ' line' : ' lines') + '</span><button type="button" class="nt-bt sm" data-a="copyraw"><i data-ic="copy"></i><span>Copy raw</span></button></div><ol>' +
      lines.map(function (l) { return '<li><code>' + (esc(l).replace(/\[\[([^\[\]]{1,160})\]\]/g, '<span class="nt-sl">[[$1]]</span>') || ' ') + '</code></li>'; }).join('') + '</ol></div>';
  }
  function chip(n) { return '<button type="button" class="nt-ch" data-open="' + n.id + '"><i data-ic="notes"></i>' + esc(n.title) + '</button>'; }
  function relHtml(n) {
    var back = backlinks(n), outs = outlinks(n);
    var h = '<section class="nt-rl" aria-label="Linked notes"><div class="nt-rh"><b>Linked from</b><em>' + back.length + '</em></div>';
    h += back.length ? '<div class="nt-chs">' + back.map(chip).join('') + '</div>' : '<p class="nt-mu">No note links here yet. Type <code>[[' + esc(n.title) + ']]</code> inside another note to link it.</p>';
    if (outs.length) h += '<div class="nt-rh"><b>Links to</b><em>' + outs.length + '</em></div><div class="nt-chs">' + outs.map(function (o) { return o.note ? chip(o.note) : '<button type="button" class="nt-ch miss" data-wl="' + esc(o.d) + '"><i data-ic="plus"></i>' + esc(o.d) + '<small>create</small></button>'; }).join('') + '</div>';
    return h + '</section>';
  }
  function findHtml() {
    return '<div class="nt-fb" role="search"><div class="nt-fr"><input id="ntfq" placeholder="Find" autocomplete="off" aria-label="Find" value="' + esc(F.q) + '"><span class="nt-fn" id="ntfc"></span>' +
      '<button type="button" class="nt-ib" data-a="fprev" aria-label="Previous match"><i data-ic="arrup"></i></button><button type="button" class="nt-ib" data-a="fnext" aria-label="Next match"><i data-ic="arrdn"></i></button>' +
      '<button type="button" class="nt-ib nt-aa' + (F.cs ? ' on' : '') + '" data-a="fcase" aria-label="Match case" title="Match case">Aa</button><button type="button" class="nt-ib" data-a="fx" aria-label="Close find"><i data-ic="x"></i></button></div>' +
      '<div class="nt-fr"><input id="ntfr" placeholder="Replace with" autocomplete="off" aria-label="Replace with" value="' + esc(F.r) + '"><button type="button" class="nt-bt sm" data-a="frep">Replace</button><button type="button" class="nt-bt sm" data-a="frall">Replace all</button></div></div>';
  }
  function editHtml(n) {
    var rd = S.mode !== 'edit', cats = CATS.indexOf(n.category) >= 0 ? CATS : CATS.concat([n.category]), pl = projs();
    var h = '<div class="nt-wrap nt-ed">' + tabBar() + '<header class="nt-eh"><button type="button" class="nt-bk" data-a="back" aria-label="Back to notes"><i data-ic="back"></i><span>Notes</span></button><span class="nt-sv" id="ntsv"></span>';
    h += '<div class="nt-seg">' + [['read', 'Read'], ['edit', 'Edit'], ['source', 'Source']].map(function (m) { return '<button type="button" data-m="' + m[0] + '" class="' + (S.mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>';
    h += '<button type="button" class="nt-ib' + (n.pinned ? ' on' : '') + '" data-a="pin" aria-label="' + (n.pinned ? 'Unpin note' : 'Pin note') + '" title="' + (n.pinned ? 'Unpin note' : 'Pin note') + '"><i data-ic="pin"></i></button>';
    h += '<button type="button" class="nt-ib' + (n.bookmarked ? ' on' : '') + '" data-a="mark" aria-label="' + (n.bookmarked ? 'Remove bookmark' : 'Bookmark note') + '" title="' + (n.bookmarked ? 'Remove bookmark' : 'Bookmark note') + '"><i data-ic="bookmark"></i></button>';
    h += '<span class="nt-mw"><button type="button" class="nt-ib" data-a="more" aria-label="More" aria-haspopup="menu"><i data-ic="dots"></i></button>';
    if (S.menu) {
      var mi = function (a, i, t, c, raw) { return '<button type="button" role="menuitem"' + (c ? ' class="' + c + '"' : '') + ' data-a="' + a + '"><i' + (raw ? '>' + ic(i) : ' data-ic="' + i + '">') + '</i><span>' + t + '</span></button>'; };
      h += '<div class="nt-mn" role="menu">' + mi('rename', 'edit', 'Rename Note') + mi('toproj', 'folder', 'Add to my projects') + mi('merge', 'merge', 'Merge with...', '', 1) + mi('find', 'search', 'Find &amp; Replace') + mi('share', 'share', 'Share note', '', 1) + mi('ngraph', 'graph', 'Open in graph view', '', 1) + mi('tabsv', 'tabs', S.tabsOn ? 'Close tabs view' : 'Open in tabs view', '', 1) +
        '<div class="nt-sp"></div>' + mi('arch', 'archive', n.archived ? 'Unarchive Note' : 'Archive Note') + mi('del', 'trash', S.del ? 'Tap again to delete' : 'Delete Note', 'dg') + '</div>';
    }
    h += '</span></header>';
    if (S.find && S.mode === 'edit') h += findHtml();
    h += '<input class="nt-ti" id="ntt" maxlength="120" placeholder="Untitled note" aria-label="Note title" value="' + esc(n.title === 'Untitled note' && !n.body ? '' : n.title) + '"' + (rd ? ' readonly' : '') + '>';
    h += '<div class="nt-mt"><select id="ntc" aria-label="Category">' + cats.map(function (c) { return '<option' + (c === n.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>';
    if (pl.length || n.project) h += '<select id="ntp" aria-label="Project"><option value="">No project</option>' + pl.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === n.project ? ' selected' : '') + '>' + esc(p.n) + '</option>'; }).join('') + '</select>';
    h += '<span>Edited ' + fmt(n.updated_at) + '</span></div>';
    if (S.mode === 'edit') {
      h += '<div class="nt-tb"><button type="button" class="nt-bt sm" data-a="linkpick"><i data-ic="link"></i><span>Link a note</span></button><button type="button" class="nt-bt sm" data-a="find"><i data-ic="search"></i><span>Find &amp; Replace</span></button></div>';
      h += '<textarea class="nt-tx" id="ntx" maxlength="' + MAXB + '" placeholder="Write your note here. Markdown works: **bold**, # headings, - lists, $math$. Link notes with [[Note Title]]." aria-label="Note text">' + esc(n.body) + '</textarea>';
    } else if (S.mode === 'source') h += srcHtml(n);
    else h += '<div class="nt-md ac-m a" id="ntm"></div>' + relHtml(n);
    h += '<div class="nt-ft"><button type="button" class="nt-bt" data-a="send"><i data-ic="send"></i><span>Send to Spectra</span></button></div></div>';
    return h;
  }
  function draw() {
    if (!root || !S.open) return;
    TM = null; root.classList.toggle('gmode', S.view === 'graph' && !S.id);
    var n = S.id && byId(S.id);
    if (S.id && !n) S.id = null;
    if (!n && S.view === 'graph') { gStop(); root.innerHTML = graphHtml(); paint(root); gInit(); renderOv(); return; }
    gStop();
    var keepQ = document.activeElement && document.activeElement.id === 'ntq', pos = keepQ ? document.activeElement.selectionStart : 0;
    root.innerHTML = n ? editHtml(n) : listHtml(); paint(root);
    if (n) {
      if (S.mode === 'read') { var m = $('#ntm'); if (m) { m.innerHTML = n.body.trim() ? H.md(n.body) : '<p class="nt-mu">Nothing here yet. Switch to Edit and start writing.</p>'; H.math(m); wikify(m); } }
      else if (S.mode === 'edit') { var t = $('#ntx'); if (t) grow(t); if (S.find) fUpdate(); }
    } else if (keepQ) { var q = $('#ntq'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) { } } }
    renderOv();
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight + 2, 260) + 'px'; }

  /* ---------- Find & Replace (works on the text box in Edit mode) ---------- */
  function fMatches(txt) {
    if (!F.q) return [];
    var hay = F.cs ? txt : txt.toLowerCase(), nd = F.cs ? F.q : F.q.toLowerCase(), out = [], i = 0;
    while ((i = hay.indexOf(nd, i)) >= 0 && out.length < 3000) { out.push(i); i += nd.length; }
    return out;
  }
  function fUpdate() {
    var x = $('#ntx'), c = $('#ntfc'); if (!x || !c) return;
    var ms = fMatches(x.value), cur = -1;
    for (var i = 0; i < ms.length; i++) if (ms[i] === x.selectionStart && x.selectionEnd - x.selectionStart === F.q.length) cur = i;
    c.textContent = !F.q ? '' : ms.length ? (cur >= 0 ? (cur + 1) + ' / ' : '') + ms.length : 'None';
  }
  function caretY(x, pos) {   // how far down the text box the character at pos sits
    var d = document.createElement('div'), cs = getComputedStyle(x), s = d.style;
    s.cssText = 'position:absolute;visibility:hidden;top:0;left:0;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;';
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].forEach(function (k) { s[k] = cs[k]; });
    s.width = x.offsetWidth + 'px'; d.textContent = x.value.slice(0, pos); var m = document.createElement('span'); m.textContent = '|'; d.appendChild(m);
    document.body.appendChild(d); var y = m.offsetTop; d.remove(); return y;
  }
  function fGo(dir) {
    var x = $('#ntx'); if (!x || !F.q) return;
    var ms = fMatches(x.value); if (!ms.length) { fUpdate(); return; }
    var from = dir > 0 ? x.selectionEnd : x.selectionStart, hit = -1, i;
    if (dir > 0) { for (i = 0; i < ms.length; i++) if (ms[i] >= from) { hit = i; break; } if (hit < 0) hit = 0; }
    else { for (i = ms.length - 1; i >= 0; i--) if (ms[i] + F.q.length <= from) { hit = i; break; } if (hit < 0) hit = ms.length - 1; }
    x.focus({ preventScroll: true }); x.setSelectionRange(ms[hit], ms[hit] + F.q.length);
    var r = x.getBoundingClientRect(), rr = root.getBoundingClientRect();
    root.scrollTop += (r.top - rr.top) + caretY(x, ms[hit]) - rr.height / 3;
    fUpdate();
  }
  function fSet(v) { var n = byId(S.id), x = $('#ntx'); if (!n || !x) return; x.value = v; grow(x); queue(n.id, { body: v }); }
  function fRep() {
    var x = $('#ntx'); if (!x || !F.q) return;
    var s = x.value.slice(x.selectionStart, x.selectionEnd);
    if (!(F.cs ? s === F.q : s.toLowerCase() === F.q.toLowerCase())) { fGo(1); return; }
    var v = x.value.slice(0, x.selectionStart) + F.r + x.value.slice(x.selectionEnd);
    if (v.length > MAXB) { toast('That would make the note too long'); return; }
    var p = x.selectionStart + F.r.length; fSet(v); x.setSelectionRange(p, p); fGo(1);
  }
  function fRepAll() {
    var x = $('#ntx'); if (!x || !F.q) return;
    var ms = fMatches(x.value); if (!ms.length) { toast('Nothing to replace'); return; }
    var v = x.value, i;
    for (i = ms.length - 1; i >= 0; i--) v = v.slice(0, ms[i]) + F.r + v.slice(ms[i] + F.q.length);
    if (v.length > MAXB) { toast('That would make the note too long'); return; }
    fSet(v); fUpdate(); toast('Replaced ' + ms.length + (ms.length === 1 ? ' match' : ' matches'));
  }
  function openFind() {
    var n = S.id && byId(S.id); if (!n) return;
    S.menu = false; S.find = true; S.mode = 'edit'; draw();
    var q = $('#ntfq'); if (q) { q.focus(); q.select(); }
  }

  /* ---------- pop-up sheets: link a note, merge, project, share ---------- */
  function ovClose() { S.ov = null; var o = $('#ntov'); if (o) o.remove(); }
  function ovOpen(o) { S.menu = false; S.ov = o; var m = $('.nt-mn'); if (m) m.remove(); renderOv(); var q = $('#ntovq'); if (q) q.focus(); }
  function pickList() {
    var o = S.ov, cur = S.id, q = (o.q || '').trim().toLowerCase();
    if (o.k === 'link' || o.k === 'merge' || o.k === 'tabs') {
      var ns = S.notes.filter(function (n) { return !n.archived && n.id !== cur && (o.k !== 'tabs' || S.tabs.indexOf(n.id) < 0) && (!q || n.title.toLowerCase().indexOf(q) >= 0); }).sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).slice(0, 80);
      return ns.length ? ns.map(function (n) { return '<button type="button" class="nt-pi" data-pk="' + n.id + '"><i data-ic="notes"></i><span><b>' + esc(n.title) + '</b><small>' + esc(n.category) + '</small></span></button>'; }).join('') : '<p class="nt-mu nt-pe">' + (o.k === 'tabs' ? (q ? 'No notes match.' : 'All your notes are already open in tabs.') : S.notes.length > 1 ? 'No notes match.' : 'You need another note first.') + '</p>';
    }
    if (o.k === 'proj') {
      var n = byId(cur), pl = projs();
      return '<button type="button" class="nt-pi" data-pj=""><i data-ic="' + (n && !n.project ? 'check' : 'blank') + '"></i><span><b>No project</b></span></button>' +
        (pl.length ? pl.map(function (p) { return '<button type="button" class="nt-pi" data-pj="' + esc(p.id) + '"><i data-ic="' + (n && n.project === p.id ? 'check' : 'blank') + '"></i><span><b><s style="--pc:' + esc(p.c || '#7c5cff') + '"></s>' + esc(p.n) + '</b></span></button>'; }).join('') : '<p class="nt-mu nt-pe">No projects yet. Make one with the + next to Projects in the sidebar, then come back.</p>');
    }
    return '';
  }
  function ovHtml() {
    var o = S.ov; if (!o) return '';
    var n = S.id && byId(S.id), h = '<div class="nt-ov" id="ntov"><div class="nt-sh" role="dialog" aria-modal="true">';
    var head = function (t) { return '<header><b>' + t + '</b><button type="button" class="nt-ib" data-a="ovx" aria-label="Close"><i data-ic="x"></i></button></header>'; };
    if (o.k === 'link') h += head('Link a note') + '<label class="nt-s"><i data-ic="search"></i><input id="ntovq" type="search" placeholder="Search your notes" autocomplete="off" value="' + esc(o.q || '') + '"></label><div class="nt-pl" id="ntpl">' + pickList() + '</div>';
    else if (o.k === 'tabs') h += head('Open in a tab') + '<label class="nt-s"><i data-ic="search"></i><input id="ntovq" type="search" placeholder="Search your notes" autocomplete="off" value="' + esc(o.q || '') + '"></label><div class="nt-pl" id="ntpl">' + pickList() + '</div>';
    else if (o.k === 'merge') h += head('Merge with...') + '<p class="nt-pd">Pick the note to combine with <b>' + esc(n ? n.title : '') + '</b>.</p><label class="nt-s"><i data-ic="search"></i><input id="ntovq" type="search" placeholder="Search your notes" autocomplete="off" value="' + esc(o.q || '') + '"></label><div class="nt-pl" id="ntpl">' + pickList() + '</div>';
    else if (o.k === 'proj') h += head('Add to my projects') + '<div class="nt-pl" id="ntpl">' + pickList() + '</div>';
    else if (o.k === 'mopt') {
      var b = byId(o.b);
      h += head('Merge notes') + '<p class="nt-pd"><b>' + esc(n ? n.title : '') + '</b> + <b>' + esc(b ? b.title : '') + '</b></p><div class="nt-opts">' +
        '<button type="button" class="nt-op' + (o.ai ? ' on' : '') + '" data-mo="ai"><b>Let Spectra combine them</b><small>She cleans it up, removes repeats and organizes it.</small></button>' +
        '<button type="button" class="nt-op' + (o.ai ? '' : ' on') + '" data-mo="join"><b>Just join them</b><small>Both texts stay exactly as written, one after the other.</small></button></div>' +
        '<button type="button" class="nt-ck' + (o.arch ? ' on' : '') + '" data-a="march" role="checkbox" aria-checked="' + (o.arch ? 'true' : 'false') + '"><i data-ic="' + (o.arch ? 'check' : 'blank') + '"></i><span>Archive the two original notes afterward</span></button>' +
        '<p class="nt-pd sm">The merged note is a brand new note, so your originals are never lost.</p>' +
        '<div class="nt-pf"><button type="button" class="nt-bt" data-a="ovx"' + (o.busy ? ' disabled' : '') + '>Cancel</button><button type="button" class="nt-bt pr" data-a="mgo"' + (o.busy ? ' disabled' : '') + '>' + (o.busy ? '<i data-ic="spin" class="nt-spin"></i><span>Merging...</span>' : ic('merge') + '<span>Merge</span>') + '</button></div>';
    } else if (o.k === 'share') {
      var sb = function (a, i, t, s, raw) { return '<button type="button" class="nt-pi" data-sh="' + a + '"><i' + (raw ? '>' + ic(i) : ' data-ic="' + i + '">') + '</i><span><b>' + t + '</b><small>' + s + '</small></span></button>'; };
      h += head('Share note') + '<div class="nt-pl">' + sb('copy', 'copy', 'Copy as text', 'Title and note, ready to paste') + sb('md', 'dl', 'Download as Markdown', 'A .md file, works in other note apps', 1) + sb('txt', 'dl', 'Download as text', 'A plain .txt file', 1) +
        (window.SpectraAcad && window.SpectraAcad.pdf ? sb('pdf', 'pdf', 'Save as PDF', 'Opens a print page, choose Save as PDF') : '') + (navigator.share ? sb('native', 'share', 'Share with an app...', 'Messages, email and more', 1) : '') + '</div>';
    }
    return h + '</div></div>';
  }
  function renderOv() { var old = $('#ntov'); if (old) old.remove(); if (!S.ov || !root) return; root.insertAdjacentHTML('beforeend', ovHtml()); paint($('#ntov')); }
  function drawPl() { var l = $('#ntpl'); if (l && S.ov) { l.innerHTML = pickList(); paint(l); } }
  function insertLink(title) {
    var n = byId(S.id), x = $('#ntx'); if (!n || !x) return;
    var a = selMem ? selMem[0] : x.selectionStart, b = selMem ? selMem[1] : x.selectionEnd, picked = x.value.slice(a, b).trim();
    var ins = '[[' + title + (picked && picked.toLowerCase() !== title.toLowerCase() ? '|' + picked.replace(/[\[\]\n]/g, ' ') : '') + ']]', v = x.value.slice(0, a) + ins + x.value.slice(b);
    if (v.length > MAXB) { toast('That would make the note too long'); return; }
    fSet(v); x.focus(); x.setSelectionRange(a + ins.length, a + ins.length); toast('Linked to ' + title);
  }
  function pickNote(id) {
    var o = S.ov, t = byId(id); if (!o || !t) return;
    if (o.k === 'link') { ovClose(); insertLink(t.title); }
    else if (o.k === 'tabs') { ovClose(); openNote(id, S.id ? S.mode : 'read'); }
    else if (o.k === 'merge') { S.ov = { k: 'mopt', b: id, ai: true, arch: true, busy: false }; renderOv(); }
  }
  async function setProject(pid) {
    var n = byId(S.id); if (!n) return; ovClose(); await flush();
    try { await upd(n.id, { project: pid || null }); var p = pid && pn(pid); toast(pid ? 'Added to ' + (p ? p.n : 'project') : 'Removed from project'); }
    catch (e) { toast(e.message === 'SETUP2' ? 'Run supabase-spectra-notes-v2.sql first (it adds the project column)' : 'Could not change the project'); }
    draw();
  }
  async function doMerge() {
    var o = S.ov, a = byId(S.id), b = o && byId(o.b); if (!a || !b || o.busy) return;
    if (S.notes.length >= MAXN) { toast('Note limit reached (' + MAXN + '). Delete or archive some first.'); return; }
    o.busy = true; renderOv(); await flush();
    var res = null, joinedLen = a.body.length + b.body.length, tooLong = joinedLen > 9000, aiOk = false;
    if (o.ai && !tooLong && H.merge) { try { res = await H.merge({ title: a.title, body: a.body }, { title: b.title, body: b.body }); } catch (e) { res = null; } }
    aiOk = !!(res && res.body && res.body.trim().length > 10);
    var title, body, cat = a.category;
    if (aiOk) { title = (res.title || a.title).slice(0, 120); body = res.body; if (CATS.indexOf(res.category) >= 0) cat = res.category; }
    else { title = (a.title + ' + ' + b.title).slice(0, 120); body = '## ' + a.title + '\n\n' + a.body.trim() + '\n\n---\n\n## ' + b.title + '\n\n' + b.body.trim(); }
    if (body.length > MAXB) { o.busy = false; renderOv(); toast('Those notes are too long to merge (20,000 character limit)'); return; }
    try {
      var f = { title: title, body: body, category: cat }, pj = a.project || b.project; if (pj) f.project = pj;
      var row = await insert(f); S.notes.unshift(row); TM = null;
      if (o.arch) { await upd(a.id, { archived: true }); await upd(b.id, { archived: true }); }
      if (o.arch) { dropTab(a.id); dropTab(b.id); if (!S.tabs.length) S.tabsOn = false; }
      badgeDraw(); ovClose(); S.id = row.id; tabAdd(row.id); S.mode = 'read'; S.find = false; draw(); root.scrollTop = 0;
      toast(aiOk ? 'Merged by Spectra' + (o.arch ? '. Originals archived.' : '.') : (o.ai ? (tooLong ? 'Too long for Spectra, so I joined them.' : 'Spectra was busy, so I joined them.') : 'Notes joined') + (o.arch ? ' Originals archived.' : ''));
    } catch (e) { o.busy = false; renderOv(); toast(e.message === 'LIMIT' ? 'Note limit reached. Delete some first.' : 'Could not merge the notes'); }
  }
  function noteText(n) { return (n.title ? '# ' + n.title + '\n\n' : '') + (n.body || ''); }
  function fname(t) { return (String(t || 'note').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'note'); }
  function download(name, text, type) {
    var u = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function doShare(k) {
    var n = byId(S.id); if (!n) return;
    if (k === 'copy') { H.copy(noteText(n)).then(function () { toast('Note copied'); }); ovClose(); }
    else if (k === 'md') { download(fname(n.title) + '.md', noteText(n), 'text/markdown'); ovClose(); toast('Downloading .md'); }
    else if (k === 'txt') { download(fname(n.title) + '.txt', noteText(n), 'text/plain'); ovClose(); toast('Downloading .txt'); }
    else if (k === 'pdf') { ovClose(); try { window.SpectraAcad.pdf(n.body || '', n.title || 'Note'); } catch (e) { toast('Could not make the PDF'); } }
    else if (k === 'native') { ovClose(); try { navigator.share({ title: n.title, text: noteText(n) }).catch(function () { }); } catch (e) { } }
  }

  /* ---------- graph view ---------- */
  function graphHtml() {
    var live = S.notes.filter(function (n) { return !n.archived; });
    var bar = function (extra) { return '<div class="nt-gt"><button type="button" class="nt-bk" data-a="glist" aria-label="Back to notes">' + ic('list') + '<span>Notes</span></button><b>Graph</b>' + (extra || '') + '</div>'; };
    if (S.err || (S.busy && !S.loaded) || !live.length) return '<div class="nt-wrap">' + bar() + (S.busy && !S.loaded ? '<div class="nt-sk"><i></i><i></i><i></i></div>' : S.err ? gridHtml() : msgBox('Nothing to draw yet', 'Add some notes first. Notes you link with <b>[[Note Title]]</b> get connected here.')) + '</div>';
    var cats = {}; live.forEach(function (n) { cats[n.category] = 1; });
    var h = '<div class="nt-g" id="ntg2">' + bar('<span class="nt-gs"></span><button type="button" class="nt-sw' + (S.gcats ? ' on' : '') + '" data-a="gcats" role="switch" aria-checked="' + (S.gcats ? 'true' : 'false') + '"><i></i><span>Categories</span></button>');
    h += '<canvas id="ntcv" aria-label="Graph of your notes. Linked notes are connected."></canvas>';
    h += '<div class="nt-gz"><button type="button" class="nt-ib" data-a="gin" aria-label="Zoom in">' + ic('plus') + '</button><button type="button" class="nt-ib" data-a="gout" aria-label="Zoom out">' + ic('minus') + '</button><button type="button" class="nt-ib" data-a="gfit" aria-label="Fit to screen">' + ic('fit') + '</button></div>';
    h += '<div class="nt-gl">' + Object.keys(cats).map(function (c) { return '<span><s style="--pc:' + catColor(c) + '"></s>' + esc(c) + '</span>'; }).join('') + '</div>';
    h += '<div class="nt-gh" id="ntgh" hidden></div><div class="nt-gc" id="ntgc" hidden></div></div>';
    return h;
  }
  function gColors() {
    var cs = getComputedStyle(root), v = function (n, f) { var x = cs.getPropertyValue(n).trim(); return x || f; };
    return { ink: v('--ink', '#111'), ink2: v('--ink2', '#666'), line: v('--line', '#ddd'), card: v('--card', '#fff') };
  }
  function gBuild() {
    var live = S.notes.filter(function (n) { return !n.archived; }), T = tm(), nodes = [], map = {}, edges = [], seen = {}, links = 0;
    live.forEach(function (n, i) {
      var a = (i / Math.max(live.length, 1)) * Math.PI * 2, r = 50 + Math.sqrt(live.length) * 20;
      var d = { id: n.id, note: n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, deg: 0, r: 5, col: catColor(n.category), hub: false };
      nodes.push(d); map[n.id] = d;
    });
    live.forEach(function (n) {
      linksOf(n).keys.forEach(function (k) {
        var t = T[k]; if (!t || t.id === n.id || !map[t.id]) return;
        var key = n.id < t.id ? n.id + '|' + t.id : t.id + '|' + n.id; if (seen[key]) return; seen[key] = 1;
        edges.push({ a: map[n.id], b: map[t.id], cat: false }); map[n.id].deg++; map[t.id].deg++; links++;
      });
    });
    if (S.gcats) {
      var hubs = {};
      live.forEach(function (n) {
        var h = hubs[n.category];
        if (!h) { h = hubs[n.category] = { id: 'cat:' + n.category, note: null, x: (Math.random() - .5) * 60, y: (Math.random() - .5) * 60, vx: 0, vy: 0, deg: 0, r: 9, col: catColor(n.category), hub: true, name: n.category }; nodes.push(h); map[h.id] = h; }
        edges.push({ a: map[n.id], b: h, cat: true }); h.deg++;
      });
    }
    nodes.forEach(function (d) { d.r = d.hub ? 9 + Math.min(8, d.deg * .5) : 5 + Math.min(7, d.deg * 1.3); });
    G.nodes = nodes; G.edges = edges; G.map = map; G.links = links; G.alpha = 1;
  }
  function gTick() {
    var ns = G.nodes, es = G.edges, a = G.alpha, i, j, n, m, dx, dy, d2, d, f, e, rest, k;
    for (i = 0; i < ns.length; i++) {
      n = ns[i];
      for (j = i + 1; j < ns.length; j++) {
        m = ns[j]; dx = n.x - m.x; dy = n.y - m.y; d2 = dx * dx + dy * dy; if (d2 > 90000) continue;
        if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = dx * dx + dy * dy + .01; }
        d = Math.sqrt(d2); f = Math.min(9, 2600 / d2) * a; dx = dx / d * f; dy = dy / d * f;
        n.vx += dx; n.vy += dy; m.vx -= dx; m.vy -= dy;
      }
    }
    for (i = 0; i < es.length; i++) {
      e = es[i]; dx = e.b.x - e.a.x; dy = e.b.y - e.a.y; d = Math.sqrt(dx * dx + dy * dy) || 1;
      rest = e.cat ? 85 : 62; k = (d - rest) * (e.cat ? .018 : .04) * a; dx = dx / d * k; dy = dy / d * k;
      e.a.vx += dx; e.a.vy += dy; e.b.vx -= dx; e.b.vy -= dy;
    }
    for (i = 0; i < ns.length; i++) {
      n = ns[i]; n.vx -= n.x * .0035 * a; n.vy -= n.y * .0035 * a; n.vx *= .82; n.vy *= .82;
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; }
      else { n.x += Math.max(-14, Math.min(14, n.vx)); n.y += Math.max(-14, Math.min(14, n.vy)); }
    }
    G.alpha *= .992;
  }
  function gDraw() {
    if (!G || !G.cv) return;
    var c = G.ctx, col = gColors(), k = G.k, foc = G.hov || (G.sel && G.map[G.sel]) || null, nb = {}, i, e, d;
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0); c.clearRect(0, 0, G.w, G.h); c.save(); c.translate(G.x, G.y); c.scale(k, k);
    if (foc) G.edges.forEach(function (e2) { if (e2.a === foc) nb[e2.b.id] = 1; else if (e2.b === foc) nb[e2.a.id] = 1; });
    c.lineCap = 'round';
    for (i = 0; i < G.edges.length; i++) {
      e = G.edges[i]; var on = foc && (e.a === foc || e.b === foc);
      c.globalAlpha = on ? .95 : foc ? .14 : e.cat ? .22 : .5; c.strokeStyle = on ? col.ink : e.cat ? e.a.col : col.ink2; c.lineWidth = (on ? 1.8 : 1.2) / k;
      c.setLineDash(e.cat ? [3 / k, 4 / k] : []); c.beginPath(); c.moveTo(e.a.x, e.a.y); c.lineTo(e.b.x, e.b.y); c.stroke();
    }
    c.setLineDash([]);
    for (i = 0; i < G.nodes.length; i++) {
      d = G.nodes[i]; var dim = foc && d !== foc && !nb[d.id];
      c.globalAlpha = dim ? .38 : 1; c.beginPath(); c.arc(d.x, d.y, d.r, 0, 6.2832); c.fillStyle = d.col; c.fill();
      c.lineWidth = 1.6 / k; c.strokeStyle = col.card; c.stroke();
      if (d.hub) { c.beginPath(); c.arc(d.x, d.y, d.r + 3 / k, 0, 6.2832); c.strokeStyle = d.col; c.lineWidth = 1.2 / k; c.stroke(); }
      else if (d.note.pinned) { c.beginPath(); c.arc(d.x, d.y, d.r + 3 / k, 0, 6.2832); c.strokeStyle = col.ink2; c.lineWidth = 1.2 / k; c.stroke(); }
      if (G.sel === d.id) { c.beginPath(); c.arc(d.x, d.y, d.r + 5 / k, 0, 6.2832); c.strokeStyle = col.ink; c.lineWidth = 2 / k; c.stroke(); }
    }
    c.textAlign = 'center'; c.lineJoin = 'round';
    for (i = 0; i < G.nodes.length; i++) {
      d = G.nodes[i]; var show = d.hub || d === foc || nb[d.id] || G.nodes.length <= 30 || k >= 1.15;
      if (!show || (foc && d !== foc && !nb[d.id] && !d.hub)) continue;
      var txt = d.hub ? d.name : d.note.title; if (txt.length > 28) txt = txt.slice(0, 27) + '...';
      c.globalAlpha = 1; c.font = (d.hub ? '700 ' : '600 ') + (12 / k) + 'px Inter,sans-serif';
      c.lineWidth = 3.5 / k; c.strokeStyle = col.card; c.strokeText(txt, d.x, d.y + d.r + 13 / k); c.fillStyle = col.ink; c.fillText(txt, d.x, d.y + d.r + 13 / k);
    }
    c.restore(); c.globalAlpha = 1;
  }
  function gLoop() {
    G.raf = 0; if (!G) return;
    if (G.alpha > .015 || G.drag) { gTick(); G.raf = requestAnimationFrame(gLoop); }
    gDraw();
  }
  function gRun() { if (G && !G.raf) G.raf = requestAnimationFrame(gLoop); }
  function gFit() {
    if (!G || !G.nodes.length) return;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; G.nodes.forEach(function (d) { x0 = Math.min(x0, d.x - d.r); x1 = Math.max(x1, d.x + d.r); y0 = Math.min(y0, d.y - d.r); y1 = Math.max(y1, d.y + d.r + 16); });
    var w = Math.max(x1 - x0, 80), h = Math.max(y1 - y0, 80), k = Math.min((G.w - 90) / w, (G.h - 150) / h, 1.6);
    G.k = Math.max(.15, k); G.x = G.w / 2 - ((x0 + x1) / 2) * G.k; G.y = G.h / 2 - ((y0 + y1) / 2) * G.k + 12;
  }
  function gZoom(f, px, py) {
    var k = Math.max(.15, Math.min(3.5, G.k * f)); f = k / G.k; if (px == null) { px = G.w / 2; py = G.h / 2; }
    G.x = px - (px - G.x) * f; G.y = py - (py - G.y) * f; G.k = k; gDraw();
  }
  function gSize() {
    var cv = G.cv, r = G.box.getBoundingClientRect(); G.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    G.w = Math.max(r.width, 200); G.h = Math.max(r.height, 240); cv.width = Math.round(G.w * G.dpr); cv.height = Math.round(G.h * G.dpr); cv.style.width = G.w + 'px'; cv.style.height = G.h + 'px';
  }
  function gPos(e) { var r = G.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function gWorld(p) { return { x: (p.x - G.x) / G.k, y: (p.y - G.y) / G.k }; }
  function gHit(p, touch) {
    var w = gWorld(p), pad = (touch ? 12 : 5) / G.k, i, d, dx, dy;
    for (i = G.nodes.length - 1; i >= 0; i--) { d = G.nodes[i]; dx = d.x - w.x; dy = d.y - w.y; if (dx * dx + dy * dy <= (d.r + pad) * (d.r + pad)) return d; }
    return null;
  }
  function gCard() {
    var c = $('#ntgc'), hint = $('#ntgh'), lg = $('.nt-gl'), d = G && G.sel && G.map[G.sel];
    if (lg) lg.hidden = !!d;
    if (hint) { hint.hidden = !!d || G.links > 0 || S.gcats; hint.innerHTML = 'No links yet. Type <b>[[Note Title]]</b> in a note to connect two notes, or turn on <b>Categories</b>.'; }
    if (!c) return;
    if (!d) { c.hidden = true; c.innerHTML = ''; return; }
    c.hidden = false;
    if (d.hub) { c.innerHTML = '<div class="nt-gc1"><b>' + esc(d.name) + '</b><u>' + d.deg + (d.deg === 1 ? ' note' : ' notes') + '</u></div><button type="button" class="nt-ib" data-a="gx" aria-label="Close">' + ic('x') + '</button>'; return; }
    var n = d.note, bl = backlinks(n).length, ol = outlinks(n).length;
    c.innerHTML = '<div class="nt-gc1"><b>' + esc(n.title) + '</b><u style="--pc:' + d.col + '">' + esc(n.category) + '</u><small>' + bl + ' linked from, ' + ol + ' links to</small><p>' + (esc(snip(n.body)).slice(0, 110) || '<em>Empty note</em>') + '</p></div><div class="nt-gc2"><button type="button" class="nt-bt pr" data-a="gopen" data-id="' + n.id + '"><span>Open note</span></button><button type="button" class="nt-ib" data-a="gx" aria-label="Close">' + ic('x') + '</button></div>';
  }
  function gSelect(id) { G.sel = id; gCard(); gDraw(); }
  function gInit() {
    var cv = $('#ntcv'); if (!cv) return;
    G = { cv: cv, ctx: cv.getContext('2d'), box: $('#ntg2'), k: 1, x: 0, y: 0, w: 0, h: 0, dpr: 1, raf: 0, alpha: 1, ptr: {}, drag: null, pan: null, pinch: null, hov: null, sel: S.gsel && byId(S.gsel) && !byId(S.gsel).archived ? S.gsel : null, links: 0 };
    S.gsel = null; gSize(); gBuild();
    var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, i;
    for (i = 0; i < (calm ? 420 : 170); i++) gTick();
    if (calm) G.alpha = 0;
    gFit(); gCard(); gDraw(); if (G.alpha > .015) gRun();
    if (G.sel) { var d = G.map[G.sel]; if (d) { G.k = Math.max(G.k, 1.1); G.x = G.w / 2 - d.x * G.k; G.y = G.h / 2 - d.y * G.k - 30; gDraw(); } }
    G.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function () { if (G) { gSize(); gDraw(); } }) : null; if (G.ro) G.ro.observe(G.box);
    G.mo = new MutationObserver(function () { gDraw(); }); G.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    cv.addEventListener('pointerdown', function (e) {
      if (!G) return; try { cv.setPointerCapture(e.pointerId); } catch (x) { }
      var p = gPos(e); G.ptr[e.pointerId] = p; var ids = Object.keys(G.ptr);
      if (ids.length === 2) {
        G.drag = null; G.pan = null; var a = G.ptr[ids[0]], b = G.ptr[ids[1]], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, w = gWorld({ x: mx, y: my });
        G.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: G.k, wx: w.x, wy: w.y }; return;
      }
      var hit = gHit(p, e.pointerType !== 'mouse');
      if (hit) { G.drag = { n: hit, moved: false, sx: p.x, sy: p.y }; hit.fx = hit.x; hit.fy = hit.y; G.alpha = Math.max(G.alpha, .3); gRun(); }
      else G.pan = { sx: p.x, sy: p.y, ox: G.x, oy: G.y, moved: false };
    });
    cv.addEventListener('pointermove', function (e) {
      if (!G) return; var p = gPos(e);
      if (G.ptr[e.pointerId]) G.ptr[e.pointerId] = p;
      var ids = Object.keys(G.ptr);
      if (G.pinch && ids.length >= 2) {
        var a = G.ptr[ids[0]], b = G.ptr[ids[1]], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        G.k = Math.max(.15, Math.min(3.5, G.pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / G.pinch.d))); G.x = mx - G.pinch.wx * G.k; G.y = my - G.pinch.wy * G.k; gDraw(); return;
      }
      if (G.drag) {
        if (Math.hypot(p.x - G.drag.sx, p.y - G.drag.sy) > 4) G.drag.moved = true;
        var w = gWorld(p); G.drag.n.fx = w.x; G.drag.n.fy = w.y; G.alpha = Math.max(G.alpha, .25); gRun();
      } else if (G.pan) {
        if (Math.hypot(p.x - G.pan.sx, p.y - G.pan.sy) > 4) G.pan.moved = true;
        G.x = G.pan.ox + (p.x - G.pan.sx); G.y = G.pan.oy + (p.y - G.pan.sy); gDraw();
      } else if (e.pointerType === 'mouse') {
        var h = gHit(p); if (h !== G.hov) { G.hov = h; cv.style.cursor = h ? 'pointer' : 'grab'; gDraw(); }
      }
    });
    var up = function (e) {
      if (!G) return; delete G.ptr[e.pointerId];
      if (Object.keys(G.ptr).length < 2) G.pinch = null;
      if (G.drag) { var d = G.drag; G.drag = null; d.n.fx = null; d.n.fy = null; if (!d.moved) gSelect(d.n.id); gRun(); }
      else if (G.pan) { var pn2 = G.pan; G.pan = null; if (!pn2.moved && G.sel) { G.sel = null; gCard(); gDraw(); } }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', function (e) { if (G && e.pointerType === 'mouse' && G.hov) { G.hov = null; gDraw(); } });
    cv.addEventListener('dblclick', function (e) { var h = G && gHit(gPos(e)); if (h && h.note) gOpen(h.id); });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); var p = gPos(e); gZoom(Math.exp(-e.deltaY * .0015), p.x, p.y); }, { passive: false });
    cv.style.cursor = 'grab';
  }
  function gStop() {
    if (!G) return; if (G.raf) cancelAnimationFrame(G.raf); if (G.ro) G.ro.disconnect(); if (G.mo) G.mo.disconnect(); G = null;
  }
  function gOpen(id) { S.view = 'list'; openNote(id, 'read'); }
  function toGraph(sel) { flush(); S.view = 'graph'; S.id = null; S.menu = false; S.del = false; S.find = false; S.gsel = sel || null; ovClose(); draw(); }

  /* ---------- actions ---------- */
  function show() {
    if (!root) return; S.open = true; S.menu = false; S.del = false;
    mainEl.classList.add('noting'); btn.classList.add('on'); if (H.closeDrawer) H.closeDrawer();
    if (S.err || !S.loaded) load(!!S.err);
    draw();
  }
  function hide() {
    if (!S.open) return; flush(); gStop(); ovClose(); S.open = false; S.menu = false; S.id = null; S.find = false;
    root.classList.remove('gmode'); mainEl.classList.remove('noting'); btn.classList.remove('on');
  }
  function openNote(id, mode) {
    flush(); gStop(); S.view = 'list'; S.id = id; tabAdd(id); S.mode = mode || 'read'; S.menu = false; S.del = false; S.find = false; ovClose(); draw(); if (root) root.scrollTop = 0;
    if (S.mode === 'edit') { var t = $('#ntt'), n = byId(id); if (n && !n.body && t) t.focus(); else { var x = $('#ntx'); if (x) x.focus(); } }
  }
  async function newNote(title) {
    if (S.notes.length >= MAXN) { toast('Note limit reached (' + MAXN + '). Delete or archive some first.'); return; }
    try {
      var f = { title: title || 'Untitled note', body: '', category: S.cat || (CATS.indexOf(H.subject()) >= 0 ? H.subject() : 'General Knowledge') };
      if (S.pf) f.project = S.pf;
      var row = await insert(f);
      S.notes.unshift(row); TM = null; S.loaded = true; S.err = ''; badgeDraw(); openNote(row.id, 'edit');
    } catch (e) { toast(e.message === 'LOGIN' ? 'Log in first to make notes' : e.message === 'SETUP' ? 'Notes need the database setup first' : e.message === 'SETUP2' ? 'Run supabase-spectra-notes-v2.sql first' : e.message === 'LIMIT' ? 'Note limit reached. Delete some first.' : 'Could not make a note'); }
  }
  function followLink(name) {
    var t = tm()[String(name).trim().toLowerCase()];
    if (t) openNote(t.id, 'read'); else newNote(String(name).trim().slice(0, 120));
  }
  async function removeNote(id) {
    try {
      var sb = await auth(), r = await sb.from(TB).delete().eq('id', id); if (r.error) throw fail(r.error);
      if (dirtyId === id) { dirty = {}; dirtyId = null; clearTimeout(timer); }
      S.notes = S.notes.filter(function (n) { return n.id !== id; }); TM = null; S.id = dropTab(id); S.menu = false; S.del = false; badgeDraw(); draw(); toast('Note deleted');
    } catch (e) { toast('Could not delete the note'); }
  }
  function setMode(m) {
    var t = $('#ntt'), n = S.id && byId(S.id);
    if (n && t && S.mode === 'edit') { var v = t.value.trim().slice(0, 120) || 'Untitled note'; if (v !== n.title) queue(n.id, { title: v }); }
    S.mode = m; S.menu = false; if (m !== 'edit') S.find = false; draw();
    if (m === 'edit') { var x = $('#ntx'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target;
    if (t.id === 'ntov') { ovClose(); return; }
    var wl = t.closest('[data-wl]'); if (wl) { e.preventDefault(); followLink(wl.dataset.wl); return; }
    var tx = t.closest('[data-tabx]');
    if (tx) {
      var tid = tx.dataset.tabx, was = tid === S.id, nx = dropTab(tid);
      if (was) { if (nx) openNote(nx, S.mode); else { flush(); S.id = null; S.find = false; draw(); } } else draw();
      return;
    }
    var tn = t.closest('[data-tabn]'); if (tn) { if (tn.dataset.tabn !== S.id) openNote(tn.dataset.tabn, S.id ? S.mode : 'read'); return; }
    var op = t.closest('[data-open]'); if (op) { openNote(op.dataset.open, 'read'); return; }
    var pk = t.closest('[data-pk]'); if (pk) { pickNote(pk.dataset.pk); return; }
    var pj = t.closest('[data-pj]'); if (pj) { setProject(pj.dataset.pj); return; }
    var sh = t.closest('[data-sh]'); if (sh) { doShare(sh.dataset.sh); return; }
    var mo = t.closest('[data-mo]'); if (mo && S.ov && S.ov.k === 'mopt' && !S.ov.busy) { S.ov.ai = mo.dataset.mo === 'ai'; renderOv(); return; }
    var card = t.closest('.nt-card'); if (card) { openNote(card.dataset.id, 'read'); return; }
    var tab = t.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; draw(); return; }
    var cat = t.closest('[data-cat]'); if (cat) { S.cat = cat.dataset.cat; draw(); return; }
    var pf = t.closest('[data-pf]'); if (pf) { S.pf = pf.dataset.pf; draw(); return; }
    var md = t.closest('[data-m]'); if (md) { if (md.dataset.m !== S.mode) setMode(md.dataset.m); return; }
    var a = t.closest('[data-a]');
    if (!a) { if (S.menu) { S.menu = false; S.del = false; draw(); } return; }
    var k = a.dataset.a, n = S.id && byId(S.id);
    if (k === 'new') newNote();
    else if (k === 'retry') load(true);
    else if (k === 'graph') toGraph();
    else if (k === 'glist') { S.view = 'list'; draw(); }
    else if (k === 'gcats') { S.gcats = !S.gcats; var keep = G && G.sel; S.gsel = keep || null; draw(); }
    else if (k === 'gin' && G) gZoom(1.3);
    else if (k === 'gout' && G) gZoom(1 / 1.3);
    else if (k === 'gfit' && G) { gFit(); gDraw(); }
    else if (k === 'gx' && G) { G.sel = null; gCard(); gDraw(); }
    else if (k === 'gopen') gOpen(a.dataset.id);
    else if (k === 'ovx') ovClose();
    else if (k === 'march' && S.ov) { S.ov.arch = !S.ov.arch; renderOv(); }
    else if (k === 'mgo') doMerge();
    else if (k === 'back') { flush(); S.id = null; S.menu = false; S.del = false; S.find = false; draw(); }
    else if (k === 'more') { S.menu = !S.menu; S.del = false; draw(); }
    else if (n && k === 'pin') { queue(n.id, { pinned: !n.pinned }, true); S.menu = false; draw(); toast(n.pinned ? 'Note pinned' : 'Note unpinned'); }
    else if (n && k === 'mark') { queue(n.id, { bookmarked: !n.bookmarked }, true); S.menu = false; draw(); toast(n.bookmarked ? 'Note bookmarked' : 'Bookmark removed'); }
    else if (n && k === 'rename') { S.menu = false; S.find = false; if (S.mode !== 'edit') S.mode = 'edit'; draw(); var ti = $('#ntt'); if (ti) { ti.focus(); ti.select(); } }
    else if (n && k === 'toproj') ovOpen({ k: 'proj' });
    else if (n && k === 'merge') ovOpen({ k: 'merge', q: '' });
    else if (n && k === 'share') ovOpen({ k: 'share' });
    else if (n && k === 'ngraph') toGraph(n.id);
    else if (n && k === 'find') openFind();
    else if (n && k === 'tabsv') { S.menu = false; if (S.tabsOn) { S.tabsOn = false; S.tabs = []; toast('Tabs view closed'); } else { S.tabsOn = true; S.tabs = [n.id]; toast('Tabs view on. Open more notes and they stack up here.'); } draw(); }
    else if (k === 'tabadd') ovOpen({ k: 'tabs', q: '' });
    else if (k === 'tabsoff') { S.tabsOn = false; S.tabs = []; draw(); }
    else if (n && k === 'linkpick') { var x = $('#ntx'); selMem = x ? [x.selectionStart, x.selectionEnd] : null; ovOpen({ k: 'link', q: '' }); }
    else if (n && k === 'copyraw') { H.copy(n.body || '').then(function () { toast('Raw text copied'); }); }
    else if (k === 'fx') { S.find = false; draw(); }
    else if (k === 'fnext') fGo(1);
    else if (k === 'fprev') fGo(-1);
    else if (k === 'fcase') { F.cs = !F.cs; a.classList.toggle('on', F.cs); fUpdate(); }
    else if (k === 'frep') fRep();
    else if (k === 'frall') fRepAll();
    else if (n && k === 'arch') { var was = n.archived; queue(n.id, { archived: !was }, true); S.menu = false; S.id = was ? n.id : dropTab(n.id); badgeDraw(); draw(); toast(was ? 'Note restored' : 'Note archived'); }
    else if (n && k === 'del') { if (!S.del) { S.del = true; draw(); setTimeout(function () { if (S.del) { S.del = false; if (S.menu) draw(); } }, 3000); } else removeNote(n.id); }
    else if (n && k === 'send') {
      flush(); var nm = fname(n.title) + '.md';
      if (H.toChatFile) { hide(); H.toChatFile(nm, noteText(n), 'Help me with my note "' + n.title + '".'); }
      else { var tx = 'Help me with my note "' + n.title + '":\n\n' + n.body; hide(); H.toChat(tx); }
    }
  }
  function onInput(e) {
    var t = e.target, n = S.id && byId(S.id);
    if (t.id === 'ntq') { S.q = t.value; drawGrid(); return; }
    if (t.id === 'ntovq' && S.ov) { S.ov.q = t.value; drawPl(); return; }
    if (t.id === 'ntfq') { F.q = t.value; fUpdate(); return; }
    if (t.id === 'ntfr') { F.r = t.value; return; }
    if (!n) return;
    if (t.id === 'ntt') queue(n.id, { title: t.value.trim().slice(0, 120) || 'Untitled note' });
    else if (t.id === 'ntx') { grow(t); queue(n.id, { body: t.value }); if (S.find) fUpdate(); }
  }
  function onChange(e) {
    var n = S.id && byId(S.id); if (!n) return;
    if (e.target.id === 'ntc') queue(n.id, { category: e.target.value }, true);
    else if (e.target.id === 'ntp') setProject(e.target.value);
  }
  function onKey(e) {
    if (!S.open) return;
    if (e.key === 'Escape') {
      if (S.ov) { ovClose(); e.preventDefault(); }
      else if (S.find) { S.find = false; draw(); }
      else if (S.menu) { S.menu = false; S.del = false; draw(); }
      else if (G && G.sel) { G.sel = null; gCard(); gDraw(); }
      return;
    }
    var t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('nt-wl')) { e.preventDefault(); followLink(t.dataset.wl); return; }
    if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('nt-tab')) { e.preventDefault(); t.click(); return; }
    if (e.key === 'Enter' && t.id === 'ntfq') { e.preventDefault(); fGo(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Enter' && t.id === 'ntfr') { e.preventDefault(); fRep(); }
  }

  function init(host) {
    H = host; root = $('#notes'); btn = $('#nt'); badge = $('#ntc'); mainEl = $('#main');
    if (!root || !btn || !mainEl) return;
    btn.addEventListener('click', function () { if (S.open) { S.id = null; S.view = 'list'; S.find = false; ovClose(); draw(); } else show(); });
    root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    var side = $('#side');   // opening a chat or starting a new one leaves the notes view
    if (side) side.addEventListener('click', function (e) { if (S.open && !e.target.closest('#nt') && e.target.closest('.ac-it, .ac-new, [data-pn]')) hide(); }, true);
    setTimeout(function () { load(); }, 700);
  }

  window.SpectraNotes = { init: init, addFromAnswer: addFromAnswer, open: show };
})();
