/* SPECSOFT® Studio, PHASE 1: project list, create/open/rename/save/delete,
   shell layout and a real Console. Graph canvas = Phase 2 (tools stay disabled).
   Needs supabase-studio.sql installed. */
(function () {
    'use strict';
    var CFG = window.SPECSOFT_CONFIG || {};
    var sb = window.getSupabaseClient ? window.getSupabaseClient() : (
        (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
            ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
    var S = { me: null, list: [], cur: null };
    function $(id) { return document.getElementById(id); }

    /* Console: every entry has time, severity, source and message */
    function log(sev, src, msg, nodeId) {
        var row = document.createElement('div');
        row.className = sev; if (nodeId) row.dataset.node = nodeId;
        [new Date().toLocaleTimeString(), sev, src, msg].forEach(function (t) {
            var s = document.createElement('span'); s.textContent = t; row.appendChild(s);
        });
        var box = $('stLog'); box.appendChild(row); box.scrollTop = box.scrollHeight;
    }

    function setOpen(on) {
        if (!on) StudioGraph.clear();
        ['stTitle', 'stSave', 'stDelete'].forEach(function (id) { $(id).disabled = !on; });
        $('stEmpty').hidden = on;
        $('stState').textContent = on ? 'Saved' : 'No project open';
    }

    function renderList() {
        var ul = $('stList'); ul.textContent = '';
        S.list.forEach(function (p) {
            var li = document.createElement('li'), b = document.createElement('button'), s = document.createElement('small');
            b.type = 'button'; b.textContent = p.title;
            s.textContent = 'Edited ' + new Date(p.updated_at).toLocaleDateString();
            b.appendChild(s);
            if (S.cur && S.cur.id === p.id) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', function () { openProject(p.id); });
            li.appendChild(b); ul.appendChild(li);
        });
        $('stListMsg').textContent = S.list.length ? '' : 'No projects yet. Name one above and press Create.';
    }

    function fail(where, err) {
        var m = (err && err.message) || 'Unknown error';
        if (/studio_projects/.test(m)) m += ' (run supabase-studio.sql in the Supabase SQL Editor)';
        log('error', where, m);
    }

    async function load() {
        var r = await sb.from('studio_projects').select('id,title,updated_at').eq('owner_id', S.me.id).order('updated_at', { ascending: false });
        if (r.error) { fail('projects', r.error); return; }
        S.list = r.data || []; renderList();
        log('ok', 'projects', S.list.length + ' project(s) loaded');
    }

    async function openProject(id) {
        var r = await sb.from('studio_projects').select('id,title,graph,updated_at').eq('id', id).single();
        if (r.error) { fail('open', r.error); return; }
        S.cur = r.data; $('stTitle').value = r.data.title; setOpen(true); renderList();
        var g = r.data.graph || {};
        StudioGraph.load(g);
        log('ok', 'studio', 'Opened "' + r.data.title + '" (' + ((g.nodes || []).length) + ' nodes)');
    }

    async function create() {
        var name = $('stNewName').value.trim() || 'Untitled project';
        var r = await sb.from('studio_projects').insert({ owner_id: S.me.id, title: name }).select('id').single();
        if (r.error) { fail('create', r.error); return; }
        $('stNewName').value = ''; log('ok', 'projects', 'Created "' + name + '"');
        await load(); openProject(r.data.id);
    }

    async function save() {
        var title = $('stTitle').value.trim();
        if (!title) { log('warn', 'save', 'Title cannot be empty'); return; }
        var graph = StudioGraph.get();
        if (JSON.stringify(graph).length > 450000) { log('error', 'save', 'This project is too large to save (450 KB max). Remove some nodes or code.'); return; }
        var r = await sb.from('studio_projects').update({ title: title, graph: S.cur.graph = graph }).eq('id', S.cur.id);
        if (r.error) { fail('save', r.error); return; }
        S.cur.title = title; $('stState').textContent = 'Saved'; log('ok', 'save', 'Saved "' + title + '"'); load();
    }

    async function del() {
        if (!window.confirm('Delete "' + S.cur.title + '"? This cannot be undone.')) return;
        var r = await sb.from('studio_projects').delete().eq('id', S.cur.id);
        if (r.error) { fail('delete', r.error); return; }
        log('warn', 'projects', 'Deleted "' + S.cur.title + '"'); S.cur = null; $('stTitle').value = ''; setOpen(false); load();
    }

    async function init() {
        $('stClear').addEventListener('click', function () { $('stLog').textContent = ''; });
        $('stFilter').addEventListener('change', function () { $('stLog').dataset.f = this.value; });
        $('stLog').addEventListener('click', function (e) { var r = e.target.closest('div[data-node]'); if (r) StudioGraph.select(r.dataset.node); });
        Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
            b.addEventListener('click', function () {
                var h = b.dataset.tab === 'hist'; $('stLog').hidden = h; $('stHist').hidden = !h; $('stFilter').hidden = h; $('stClear').hidden = h;
                Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
            });
        });
        if (!sb) { log('error', 'studio', 'Supabase is not configured'); return; }
        var sess = (await sb.auth.getSession()).data.session;
        if (!sess) {
            var m = $('stListMsg'); m.textContent = 'Sign in to use Studio. ';
            var a = document.createElement('a'); a.href = 'login.html'; a.textContent = 'Go to login'; m.appendChild(a);
            $('stNew').disabled = true; $('stNewName').disabled = true;
            log('warn', 'auth', 'Not signed in'); return;
        }
        S.me = sess.user;
        StudioGraph.log = log;
        StudioGraph.onChange = function () { if (S.cur) $('stState').textContent = 'Unsaved changes'; }; log('ok', 'studio', 'Studio ready (Phase 4)');
        $('stNew').addEventListener('click', create);
        $('stNewName').addEventListener('keydown', function (e) { if (e.key === 'Enter') create(); });
        $('stSave').addEventListener('click', save);
        $('stDelete').addEventListener('click', del);
        $('stTitle').addEventListener('input', function () { $('stState').textContent = 'Unsaved changes'; });
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's' && S.cur) { e.preventDefault(); save(); }
        });
        load();
    }
    init();
})();
