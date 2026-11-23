/* Spectra Tasks v1: the "My Tasks" dashboard inside Spectra Academics, saved in Supabase (table spectra_tasks, see supabase-spectra-tasks.sql) so it follows you on every device.
   Statuses: Pending, Ongoing, Completed are saved. MISSING is worked out by the page: not completed + due date already passed.
   Load this file AFTER spectra-academics.js. It needs the sidebar button #tk, the badge #tkc and the section #tasks (see spectra-academics.html).
   It wires itself (like the Lab), and uses window.SpectraAcad.toast when it exists.
   Public API:
     SpectraTasks.open() / .close()
     SpectraTasks.add(o)     -> o = { title, subject, due: 'YYYY-MM-DD', priority: 'low'|'medium'|'high', notes }. Saves a task, resolves the saved row. Rejects with Error('LOGIN' | 'SETUP' | 'LIMIT' | 'TITLE' | message).
     SpectraTasks.counts()   -> { completed, pending, ongoing, missing } (v2 hook for "Spectra adds your tasks") */
(function () {
  'use strict';
  var TB = 'spectra_tasks', MAXT = 500, MAXS = 20;
  var SUBJ = ['Math', 'General Sciences', 'Social Studies', 'Languages', 'ICT/TVL', 'General Knowledge'];
  var SC = { 'Math': '#7c5cff', 'General Sciences': '#14b8a6', 'Social Studies': '#f59e0b', 'Languages': '#ec4899', 'ICT/TVL': '#3b82f6', 'General Knowledge': '#64748b' };
  var KIND = {
    missing: { n: 'Missing', c: '#ef4444', i: 'alert' }, ongoing: { n: 'Ongoing', c: '#3b82f6', i: 'play' },
    pending: { n: 'Pending', c: '#f59e0b', i: 'clock' }, completed: { n: 'Completed', c: '#22c55e', i: 'check' }
  };
  var KORDER = ['missing', 'ongoing', 'pending', 'completed'];
  var PRI = { low: 'Low', medium: 'Medium', high: 'High' }, PRC = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  var ICO = {
    check: 'M5 12l5 5 9-10', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
    play: 'M8 5v14l11-7z', alert: 'M12 3l10 18H2zM12 10v5M12 18h.01', list: 'M10 6h10M10 12h10M10 18h10M3.5 5.5l1.2 1.2 2.3-2.4M3.5 11.5l1.2 1.2 2.3-2.4M3.5 17.5l1.2 1.2 2.3-2.4',
    chev: 'M6 9l6 6 6-6', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', cal: 'M5 5h14v15H5zM5 10h14M9 3v4M15 3v4',
    flame: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.4 2-4.4.2 1.6 1 2.6 2 2.8-.6-3.4-.4-5.4 1-8.4z'
  };
  var ic = function (n) { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICO[n] + '"/></svg>'; };

  var root = null, btn = null, badge = null, mainEl = null;
  var S = { tasks: [], loaded: false, busy: false, err: '', open: false, f: 'all', sj: '', more: false, exp: {}, ed: null };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var byId = function (id) { for (var i = 0; i < S.tasks.length; i++) if (S.tasks[i].id === id) return S.tasks[i]; return null; };
  var toast = function (t) { if (window.SpectraAcad && window.SpectraAcad.toast) window.SpectraAcad.toast(t); };
  var calm = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };

  /* ---------- dates (all local time, "YYYY-MM-DD") ---------- */
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  var today = function () { return ymd(new Date()); };
  var dayNum = function (s) { var a = String(s).split('-'); return Math.round(Date.UTC(+a[0], +a[1] - 1, +a[2]) / 864e5); };
  var fmtDate = function (s) { var a = String(s).split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); };
  var okDate = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')); };

  /* ---------- status logic ---------- */
  function cat(t) { if (t.status === 'completed') return 'completed'; if (t.due && t.due < today()) return 'missing'; return t.status === 'ongoing' ? 'ongoing' : 'pending'; }
  function counts() {
    var c = { completed: 0, pending: 0, ongoing: 0, missing: 0 };
    S.tasks.forEach(function (t) { c[cat(t)]++; });
    return c;
  }
  function dueToday() { var d = today(), n = 0; S.tasks.forEach(function (t) { if (t.status !== 'completed' && t.due === d) n++; }); return n; }
  function dueInfo(t) {
    if (!t.due) return null;
    if (t.status === 'completed') return { txt: fmtDate(t.due), cls: '' };
    var d = dayNum(t.due) - dayNum(today());
    if (d < 0) return { txt: 'Late by ' + (-d) + 'd', cls: 'late' };
    if (d === 0) return { txt: 'Due today', cls: 'soon' };
    if (d === 1) return { txt: 'Tomorrow', cls: 'soon' };
    if (d <= 7) return { txt: 'In ' + d + ' days', cls: '' };
    return { txt: fmtDate(t.due), cls: '' };
  }
  var PW = { high: 0, medium: 1, low: 2 };
  function cmp(a, b) {
    var da = a.due || '9999', db = b.due || '9999'; if (da !== db) return da < db ? -1 : 1;
    if (PW[a.priority] !== PW[b.priority]) return PW[a.priority] - PW[b.priority];
    return a.created_at < b.created_at ? 1 : -1;
  }
  function cmpDone(a, b) { return (a.completed_at || '') < (b.completed_at || '') ? 1 : -1; }
  function streak() {
    var days = {}; S.tasks.forEach(function (t) { if (t.status === 'completed' && t.completed_at) days[ymd(new Date(t.completed_at))] = 1; });
    var d = new Date(), n = 0; if (!days[ymd(d)]) d.setDate(d.getDate() - 1);
    while (days[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function says(c, total, dt) {
    var seed = dayNum(today()) + total + c.missing * 7 + c.completed * 3, left = c.pending + c.ongoing;
    var pick = function (a) { return a[Math.abs(seed) % a.length]; };
    if (!total) return pick(['Your list is empty, bro. Time to add something \uD83D\uDE0E', 'Fresh start. Add your first task \uD83D\uDE80']);
    if (c.missing) return pick([c.missing + ' missing, bro. Let\u2019s rescue them \uD83D\uDE2D', c.missing + ' slipped away. We can still catch up \uD83D\uDCAA']);
    if (!left) return pick(['Everything is done!! Absolute W bro \uD83D\uDD25', 'Zero left. Go touch grass, you earned it \uD83C\uDF31']);
    if (dt) return pick([dt + ' due today. You got this \uD83D\uDCAA', dt + ' for today, one at a time bro \uD83D\uDE24']);
    return pick([left + ' on deck. One at a time bro \uD83D\uDE24', 'Steady progress wins. ' + left + ' to go \u2728']);
  }

  /* ---------- Supabase ---------- */
  function fail(e) {
    var m = (e && e.message) || '';
    if (e && (e.code === '42P01' || e.code === 'PGRST205' || /schema cache|does not exist/i.test(m)) && !/column/i.test(m)) return new Error('SETUP');
    if (/limit reached/i.test(m)) return new Error('LIMIT');
    return e instanceof Error ? e : new Error(m || 'DB');
  }
  async function auth() {
    var sb = window.getSupabaseClient && window.getSupabaseClient(); if (!sb) throw new Error('SETUP');
    var r = await sb.auth.getSession(); if (!r.data || !r.data.session) throw new Error('LOGIN');
    return sb;
  }
  var errMsg = function (e) {
    var m = e && e.message;
    return m === 'LOGIN' ? 'Log in first to use My Tasks' : m === 'SETUP' ? 'My Tasks needs the database setup first' : m === 'LIMIT' ? 'Task limit reached. Delete some old tasks first.' : m === 'TITLE' ? 'Give your task a title, bro' : 'Could not save the task';
  };
  async function load(force) {
    if (S.busy || (S.loaded && !force)) return;
    S.busy = true; S.err = ''; if (S.open) draw();
    try {
      var sb = await auth(), r = await sb.from(TB).select('*').order('created_at', { ascending: false }).limit(MAXT);
      if (r.error) throw fail(r.error);
      S.tasks = (r.data || []).map(function (t) { t.subtasks = Array.isArray(t.subtasks) ? t.subtasks : []; return t; }); S.loaded = true;
    } catch (e) { S.err = e.message || 'DB'; }
    S.busy = false; badgeDraw(); if (S.open) draw();
  }
  async function patch(id, f) {   // optimistic: the page updates first, and goes back if the save fails
    var t = byId(id); if (!t) return false;
    var prev = {}; Object.keys(f).forEach(function (k) { prev[k] = t[k]; }); Object.assign(t, f); badgeDraw(); if (S.open) draw();
    try {
      var sb = await auth(), r = await sb.from(TB).update(f).eq('id', id).select('*').single();
      if (r.error) throw fail(r.error);
      t.updated_at = r.data.updated_at;
    } catch (e) { Object.assign(t, prev); badgeDraw(); if (S.open) draw(); toast(errMsg(e)); return false; }
    return true;
  }
  function clean(o) {
    var title = String(o.title || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (!title) throw new Error('TITLE');
    var subs = (Array.isArray(o.subtasks) ? o.subtasks : []).map(function (s) { return { t: String(s.t || '').replace(/\s+/g, ' ').trim().slice(0, 100), d: !!s.d }; }).filter(function (s) { return s.t; }).slice(0, MAXS);
    return {
      title: title, subject: SUBJ.indexOf(o.subject) >= 0 ? o.subject : '', priority: PRI[o.priority] ? o.priority : 'medium',
      due: okDate(o.due) ? o.due : null, notes: String(o.notes || '').trim().slice(0, 600), subtasks: subs
    };
  }
  async function add(o) {
    var f = clean(o || {}); if (S.tasks.length >= MAXT) throw new Error('LIMIT');
    var sb = await auth(), r = await sb.from(TB).insert(f).select('*').single();
    if (r.error) throw fail(r.error);
    r.data.subtasks = Array.isArray(r.data.subtasks) ? r.data.subtasks : [];
    S.tasks.unshift(r.data); S.loaded = true; badgeDraw(); if (S.open) draw();
    return r.data;
  }

  /* ---------- sidebar badge ---------- */
  function badgeDraw() {
    if (!badge) return; var c = counts(), n = c.pending + c.ongoing + c.missing;
    badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = !S.loaded || n === 0; badge.classList.toggle('bad', c.missing > 0);
  }

  /* ---------- the dashboard ---------- */
  function shell() {
    return '<div class="tk-wrap"><div class="tk-hd"><div><h2>My Tasks</h2><p>Plan it, do it, tick it.</p></div>' +
      '<button class="tk-add" type="button" data-a="add"><i>' + ic('plus') + '</i>Add task</button></div>' +
      '<div class="tk-qa"><input id="tkq" type="text" maxlength="120" placeholder="Quick add: type a task and press Enter" autocomplete="off" aria-label="Quick add a task"></div>' +
      '<div id="tkd"></div></div><div class="tk-ov" id="tkov" hidden></div><div class="tk-fx" id="tkfx" aria-hidden="true"></div>';
  }
  function ring(pct, label) {
    var C = 2 * Math.PI * 34, off = (C * (1 - pct / 100)).toFixed(1);
    return '<div class="tk-ring" role="img" aria-label="' + esc(label) + '"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" class="tk-rb"/><circle cx="40" cy="40" r="34" class="tk-rf" style="stroke-dasharray:' + C.toFixed(1) + ';stroke-dashoffset:' + off + '"/></svg><b>' + pct + '%</b></div>';
  }
  function draw() {
    var d = $('#tkd', root); if (!d) return;
    if (S.busy && !S.loaded) { d.innerHTML = '<div class="tk-none">Loading your tasks...</div>'; return; }
    if (S.err) {
      var m = S.err === 'LOGIN' ? 'Log in to use My Tasks.' : S.err === 'SETUP' ? 'My Tasks needs the database setup first. Run supabase-spectra-tasks.sql in Supabase.' : 'Could not load your tasks.';
      d.innerHTML = '<div class="tk-none">' + esc(m) + (S.err === 'LOGIN' ? '' : '<br><button class="tk-more" type="button" data-a="retry">Try again</button>') + '</div>'; return;
    }
    var c = counts(), total = S.tasks.length, pct = total ? Math.round(c.completed / total * 100) : 0, st = streak(), dt = dueToday();
    var h = '<section class="tk-hero"><div class="tk-hl">' + ring(pct, c.completed + ' of ' + total + ' tasks done') + '<div><b>' + c.completed + ' of ' + total + ' done</b><p>' + esc(says(c, total, dt)) + '</p></div></div>' +
      '<div class="tk-hc"><span class="tk-chip' + (st ? ' hot' : '') + '" title="Days in a row with a finished task">' + ic('flame') + (st ? st + ' day streak' : 'No streak yet') + '</span>' +
      '<span class="tk-chip">' + ic('cal') + dt + ' due today</span></div></section>';
    h += '<div class="tk-sts">' + ['completed', 'pending', 'ongoing', 'missing'].map(function (k) {
      return '<button type="button" class="tk-st' + (S.f === k ? ' on' : '') + '" data-a="f" data-f="' + k + '" style="--kc:' + KIND[k].c + '" aria-pressed="' + (S.f === k) + '"><i>' + ic(KIND[k].i) + '</i><b>' + c[k] + '</b><span>' + KIND[k].n + '</span></button>';
    }).join('') + '</div>';
    var seen = {}; S.tasks.forEach(function (t) { if (t.subject) seen[t.subject] = 1; });
    var subs = SUBJ.filter(function (s) { return seen[s]; });
    h += '<div class="tk-flt"><button type="button" data-a="f" data-f="all" class="' + (S.f === 'all' ? 'on' : '') + '">All</button>' +
      (subs.length ? '<span class="tk-sep"></span>' + subs.map(function (s) { return '<button type="button" data-a="sj" data-s="' + esc(s) + '" class="' + (S.sj === s ? 'on' : '') + '"><s style="background:' + SC[s] + '"></s>' + esc(s) + '</button>'; }).join('') : '') + '</div>';
    d.innerHTML = h + listHtml();
  }
  function emptyHtml() {
    return '<div class="tk-em"><div class="tk-emi">\uD83C\uDF89</div><p>Wohoo! You\'re all caught up! Add a task to get started with your tasks.</p>' +
      '<button class="tk-add" type="button" data-a="add"><i>' + ic('plus') + '</i>Add task</button></div>';
  }
  function listHtml() {
    if (!S.tasks.length) return emptyHtml();
    var items = S.tasks.filter(function (t) { return (S.f === 'all' || cat(t) === S.f) && (!S.sj || t.subject === S.sj); });
    if (!items.length) return '<div class="tk-none">Nothing here, bro \uD83D\uDC40</div>';
    var h = '';
    if (S.f === 'all') {
      KORDER.forEach(function (k) {
        var g = items.filter(function (t) { return cat(t) === k; }); if (!g.length) return;
        g.sort(k === 'completed' ? cmpDone : cmp);
        var lim = k === 'completed' && !S.more ? 5 : g.length;
        h += '<h3 class="tk-gh" style="--kc:' + KIND[k].c + '"><i></i>' + KIND[k].n + '<em>' + g.length + '</em></h3><div class="tk-list">' + g.slice(0, lim).map(card).join('') + '</div>';
        if (g.length > lim) h += '<button class="tk-more" type="button" data-a="more">Show all ' + g.length + ' completed</button>';
      });
    } else { items.sort(S.f === 'completed' ? cmpDone : cmp); h = '<div class="tk-list">' + items.map(card).join('') + '</div>'; }
    return h;
  }
  function card(t) {
    var k = cat(t), subs = t.subtasks || [], dn = subs.filter(function (s) { return s.d; }).length, di = dueInfo(t), open = !!S.exp[t.id], doneT = t.status === 'completed';
    var h = '<article class="tk-card k-' + k + '" data-id="' + esc(t.id) + '" style="--kc:' + KIND[k].c + '">' +
      '<button type="button" class="tk-ck" data-a="ck" aria-label="' + (doneT ? 'Mark as not done' : 'Mark as done') + '">' + ic('check') + '</button>' +
      '<div class="tk-bd" data-a="edit" role="button" tabindex="0" aria-label="Edit task: ' + esc(t.title) + '"><div class="tk-tt">' + esc(t.title) + '</div><div class="tk-mt">' +
      '<u class="tk-k">' + KIND[k].n + '</u>' + (t.subject ? '<u class="tk-sj"><s style="background:' + (SC[t.subject] || '#64748b') + '"></s>' + esc(t.subject) + '</u>' : '') +
      '<u class="tk-pr" title="' + PRI[t.priority] + ' priority"><s style="background:' + PRC[t.priority] + '"></s>' + PRI[t.priority] + '</u>' +
      (di ? '<u class="tk-du ' + di.cls + '">' + ic('cal') + esc(di.txt) + '</u>' : '') + '</div>' +
      (t.notes ? '<div class="tk-nt">' + esc(t.notes) + '</div>' : '') +
      (subs.length && !doneT ? '<div class="tk-pg"><i style="width:' + Math.round(dn / subs.length * 100) + '%"></i></div>' : '') + '</div><div class="tk-ac">' +
      (t.status === 'pending' ? '<button type="button" class="tk-go" data-a="start">' + ic('play') + 'Start</button>' : '') +
      (subs.length ? '<button type="button" class="tk-ex' + (open ? ' on' : '') + '" data-a="exp" aria-expanded="' + open + '" aria-label="Subtasks">' + dn + '/' + subs.length + ic('chev') + '</button>' : '') + '</div>';
    if (open && subs.length) h += '<div class="tk-subs">' + subs.map(function (s, i) { return '<label class="tk-sub' + (s.d ? ' d' : '') + '"><input type="checkbox" data-a="sub" data-i="' + i + '"' + (s.d ? ' checked' : '') + '><span>' + esc(s.t) + '</span></label>'; }).join('') + '</div>';
    return h + '</article>';
  }

  /* ---------- actions ---------- */
  function burst(el) {
    var fx = $('#tkfx', root); if (!fx || calm() || !el) return;
    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, cols = ['#22c55e', '#f59e0b', '#3b82f6', '#ec4899', '#7c5cff', '#14b8a6'];
    for (var i = 0; i < 16; i++) {
      var p = document.createElement('i'), a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 70;
      p.className = 'tk-cf'; p.style.cssText = 'left:' + x + 'px;top:' + y + 'px;background:' + cols[i % cols.length] + ';--dx:' + Math.round(Math.cos(a) * v) + 'px;--dy:' + Math.round(Math.sin(a) * v - 30) + 'px;--rot:' + Math.round(Math.random() * 540) + 'deg';
      fx.appendChild(p); setTimeout((function (n) { return function () { n.remove(); }; })(p), 950);
    }
  }
  var WIN = ['W bro, task done \uD83C\uDF89', 'Another one down \uD83D\uDD25', 'Look at you go \uD83D\uDE24', 'Done!! Big W \uD83D\uDCAA', 'Cooked that one \uD83C\uDF73'];
  function complete(id, from) {
    var t = byId(id); if (!t) return;
    burst(from); toast(WIN[Math.floor(Math.random() * WIN.length)]);
    patch(id, { status: 'completed', completed_at: new Date().toISOString() });
  }
  function reopen(id) {
    var t = byId(id); if (!t) return; var any = (t.subtasks || []).some(function (s) { return s.d; });
    patch(id, { status: any ? 'ongoing' : 'pending', completed_at: null });
  }
  function toggleSub(id, i, on, from) {
    var t = byId(id); if (!t || !t.subtasks[i]) return;
    var subs = t.subtasks.map(function (s, j) { return j === i ? { t: s.t, d: on } : s; }), all = subs.every(function (s) { return s.d; }), f = { subtasks: subs };
    if (all) { f.status = 'completed'; f.completed_at = new Date().toISOString(); burst(from); toast('All subtasks done, task completed \uD83C\uDF89'); }
    else if (t.status === 'completed') { f.status = 'ongoing'; f.completed_at = null; }
    else if (on && t.status === 'pending') f.status = 'ongoing';
    patch(id, f);
  }

  /* ---------- add / edit window ---------- */
  function edOpen(id) {
    var t = id && byId(id);
    S.ed = t ? { id: t.id, title: t.title, subject: t.subject, due: t.due || '', priority: t.priority, notes: t.notes, subs: t.subtasks.map(function (s) { return { t: s.t, d: s.d }; }), del: false, busy: false, anim: true }
      : { id: null, title: '', subject: '', due: '', priority: 'medium', notes: '', subs: [], del: false, busy: false, anim: true };
    edDraw(); var ov = $('#tkov', root); ov.hidden = false; var i = $('#tkt', root); if (i && !t) i.focus();
  }
  function edClose() { var ov = $('#tkov', root); S.ed = null; if (ov) { ov.hidden = true; ov.innerHTML = ''; } }
  function edDraw(focus) {
    var e = S.ed, ov = $('#tkov', root); if (!e || !ov) return;
    var old = $('.tk-sh', ov), keep = old ? old.scrollTop : 0, pop = e.anim; e.anim = false;   // the pop-in plays only when the window opens, not on every redraw
    ov.innerHTML = '<div class="tk-sh' + (pop ? ' in' : '') + '" role="dialog" aria-modal="true" aria-label="' + (e.id ? 'Edit task' : 'New task') + '">' +
      '<div class="tk-sh-h"><b>' + (e.id ? 'Edit task' : 'New task') + '</b><button type="button" class="tk-x" data-a="cancel" aria-label="Close">' + ic('x') + '</button></div>' +
      '<label class="tk-fl">Title<input id="tkt" data-f="title" type="text" maxlength="120" value="' + esc(e.title) + '" placeholder="What do you need to do?" autocomplete="off"></label>' +
      '<div class="tk-row"><label class="tk-fl">Subject<select data-f="subject"><option value="">No subject</option>' + SUBJ.map(function (s) { return '<option' + (e.subject === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>' +
      '<label class="tk-fl">Due date<input data-f="due" type="date" value="' + esc(e.due) + '"></label></div>' +
      '<div class="tk-fl">Priority<div class="tk-seg">' + ['low', 'medium', 'high'].map(function (p) { return '<button type="button" data-a="pri" data-v="' + p + '" class="' + (e.priority === p ? 'on' : '') + '"><s style="background:' + PRC[p] + '"></s>' + PRI[p] + '</button>'; }).join('') + '</div></div>' +
      '<label class="tk-fl">Notes<textarea data-f="notes" rows="2" maxlength="600" placeholder="Optional details">' + esc(e.notes) + '</textarea></label>' +
      '<div class="tk-fl">Subtasks <small>' + e.subs.length + '/' + MAXS + '</small><div class="tk-sl">' + e.subs.map(function (s, i) {
        return '<div class="tk-sr"><input data-si="' + i + '" type="text" maxlength="100" value="' + esc(s.t) + '" aria-label="Subtask ' + (i + 1) + '"><button type="button" data-a="srm" data-i="' + i + '" aria-label="Remove subtask">' + ic('x') + '</button></div>';
      }).join('') + (e.subs.length < MAXS ? '<div class="tk-sr"><input id="tksn" type="text" maxlength="100" placeholder="Add a subtask and press Enter" aria-label="New subtask"><button type="button" data-a="sadd" aria-label="Add subtask">' + ic('plus') + '</button></div>' : '') + '</div></div>' +
      '<div class="tk-sh-f">' + (e.id ? (e.del ? '<span class="tk-cf-t">Delete this task?</span><button type="button" class="tk-bt dg" data-a="delc"' + (e.busy ? ' disabled' : '') + '>Yes, delete</button><button type="button" class="tk-bt" data-a="delk">Keep it</button>'
        : '<button type="button" class="tk-bt dg ico" data-a="del" aria-label="Delete task">' + ic('trash') + '</button><span class="tk-fill"></span><button type="button" class="tk-bt" data-a="cancel">Cancel</button><button type="button" class="tk-bt pri" data-a="save"' + (e.busy ? ' disabled' : '') + '>Save</button>')
        : '<span class="tk-fill"></span><button type="button" class="tk-bt" data-a="cancel">Cancel</button><button type="button" class="tk-bt pri" data-a="save"' + (e.busy ? ' disabled' : '') + '>Add task</button>') + '</div></div>';
    var sh = $('.tk-sh', ov); if (sh && keep) sh.scrollTop = keep;
    if (focus) { var f = $(focus, ov); if (f) f.focus(); }
  }
  function pendingSub() { var n = $('#tksn', root), v = n ? n.value.replace(/\s+/g, ' ').trim() : ''; return v; }
  function subAdd() {
    var e = S.ed, v = pendingSub(); if (!e || !v || e.subs.length >= MAXS) return;
    e.subs.push({ t: v.slice(0, 100), d: false }); edDraw('#tksn');
  }
  async function edSave() {
    var e = S.ed; if (!e || e.busy) return;
    var v = pendingSub(); if (v && e.subs.length < MAXS) e.subs.push({ t: v, d: false });
    var f; try { f = clean({ title: e.title, subject: e.subject, due: e.due, priority: e.priority, notes: e.notes, subtasks: e.subs }); } catch (x) { toast(errMsg(x)); var i = $('#tkt', root); if (i) i.focus(); return; }
    e.busy = true; edDraw();
    try {
      if (e.id) {
        var t = byId(e.id), ok = await patch(e.id, f);
        if (!ok) { e.busy = false; edDraw(); return; }
        if (t && t.status !== 'completed' && f.subtasks.length && f.subtasks.every(function (s) { return s.d; })) { complete(t.id, null); }
        toast('Task saved \u2705');
      } else { await add(f); toast('Task added \uD83D\uDCDD'); }
      edClose();
    } catch (x) { toast(errMsg(x)); if (S.ed) { e.busy = false; edDraw(); } }
  }
  async function edDelete() {
    var e = S.ed; if (!e || !e.id || e.busy) return; e.busy = true; edDraw();
    try {
      var sb = await auth(), r = await sb.from(TB).delete().eq('id', e.id); if (r.error) throw fail(r.error);
      S.tasks = S.tasks.filter(function (t) { return t.id !== e.id; }); delete S.exp[e.id]; badgeDraw(); edClose(); draw(); toast('Task deleted');
    } catch (x) { toast(errMsg(x)); if (S.ed) { e.busy = false; edDraw(); } }
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target;
    if (t.id === 'tkov') { edClose(); return; }
    var a = t.closest('[data-a]'); if (!a || !root.contains(a)) return;
    var k = a.dataset.a, cd = a.closest('.tk-card'), id = cd && cd.dataset.id;
    if (k === 'add') edOpen(null);
    else if (k === 'edit') edOpen(id);
    else if (k === 'ck') { var tk = byId(id); if (tk) { if (tk.status === 'completed') reopen(id); else complete(id, a); } }
    else if (k === 'start') patch(id, { status: 'ongoing' });
    else if (k === 'exp') { S.exp[id] = !S.exp[id]; draw(); }
    else if (k === 'f') { S.f = S.f === a.dataset.f && a.dataset.f !== 'all' ? 'all' : a.dataset.f; draw(); }
    else if (k === 'sj') { S.sj = S.sj === a.dataset.s ? '' : a.dataset.s; draw(); }
    else if (k === 'more') { S.more = true; draw(); }
    else if (k === 'retry') load(true);
    else if (k === 'cancel') edClose();
    else if (k === 'save') edSave();
    else if (k === 'pri' && S.ed) { S.ed.priority = a.dataset.v; edDraw(); }
    else if (k === 'sadd') subAdd();
    else if (k === 'srm' && S.ed) { S.ed.subs.splice(+a.dataset.i, 1); edDraw(); }
    else if (k === 'del' && S.ed) { S.ed.del = true; edDraw(); }
    else if (k === 'delk' && S.ed) { S.ed.del = false; edDraw(); }
    else if (k === 'delc') edDelete();
  }
  function onChange(e) {
    var a = e.target.closest && e.target.closest('input[data-a="sub"]'); if (!a) return;
    var cd = a.closest('.tk-card'); if (cd) toggleSub(cd.dataset.id, +a.dataset.i, a.checked, a);
  }
  function onInput(e) {
    var t = e.target; if (!S.ed) return;
    if (t.dataset.f) S.ed[t.dataset.f] = t.value;
    else if (t.dataset.si != null && S.ed.subs[+t.dataset.si]) S.ed.subs[+t.dataset.si].t = t.value;
  }
  async function quick(inp) {
    var v = inp.value.replace(/\s+/g, ' ').trim(); if (!v || inp.disabled) return;
    inp.disabled = true;
    try { await add({ title: v }); inp.value = ''; toast('Task added \uD83D\uDCDD'); } catch (x) { toast(errMsg(x)); }
    inp.disabled = false; inp.focus();
  }
  function onKey(e) {
    var t = e.target;
    if (e.key === 'Enter' && t.id === 'tkq') { e.preventDefault(); quick(t); return; }
    if (e.key === 'Enter' && t.id === 'tksn') { e.preventDefault(); subAdd(); return; }
    if (e.key === 'Enter' && t.id === 'tkt') { e.preventDefault(); edSave(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && t.classList && t.classList.contains('tk-bd')) { e.preventDefault(); edOpen(t.closest('.tk-card').dataset.id); }
  }

  /* ---------- show / hide ---------- */
  function closeDrawer() { var sh = $('#app'); if (sh) sh.classList.remove('drawer'); }
  function show() {
    if (!root || S.open) return;
    if (window.SpectraLab && SpectraLab.close) SpectraLab.close();
    if (window.SpectraNotes && SpectraNotes.close) SpectraNotes.close();
    S.open = true; mainEl.classList.add('tasking'); btn.classList.add('on'); closeDrawer();
    if (!S.loaded || S.err) load(true);
    draw(); root.scrollTop = 0;
  }
  function hide() { if (!S.open) return; edClose(); S.open = false; mainEl.classList.remove('tasking'); btn.classList.remove('on'); }

  function init() {
    root = $('#tasks'); btn = $('#tk'); badge = $('#tkc'); mainEl = $('#main'); if (!root || !btn || !mainEl) return;
    root.innerHTML = shell();
    btn.addEventListener('click', function () { if (S.open) { edClose(); draw(); } else show(); });
    root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput); root.addEventListener('keydown', onKey);
    document.addEventListener('keydown', function (e) { if (S.open && S.ed && e.key === 'Escape') { e.preventDefault(); edClose(); } });
    var side = $('#side');   // opening Notes, the Lab, a chat or a new chat leaves My Tasks
    if (side) side.addEventListener('click', function (e) { if (S.open && e.target.closest('#nt, #lab, .ac-it, .ac-new, [data-pn]')) hide(); }, true);
    var app = $('#app');   // tooltip on the button while the sidebar is collapsed
    var tip = function () { if (app.classList.contains('min')) btn.title = 'My Tasks'; else btn.removeAttribute('title'); };
    if (app) { new MutationObserver(tip).observe(app, { attributes: true, attributeFilter: ['class'] }); tip(); }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { badgeDraw(); if (S.open && !S.ed) draw(); } });   // a new day can turn tasks Missing
    setTimeout(function () { load(); }, 900);
  }

  window.SpectraTasks = { open: show, close: hide, add: add, counts: counts };
  init();
})();
