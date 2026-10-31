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
    function log(sev, src, msg) {
        var row = document.createElement('div');
        row.className = sev;
        [new Date().toLocaleTimeString(), sev, src, msg].forEach(function (t) {
            var s = document.createElement('span'); s.textContent = t; row.appendChild(s);
        });
        var box = $('stLog'); box.appendChild(row); box.scrollTop = box.scrollHeight;
    }

    /* Tool registry: the real tools arrive in Phase 2 */
    var TOOLS = [
        ['Select', '<path d="M5 3l14 8-6 2-2 6z"/>'],
        ['Move', '<path d="M12 2v20M2 12h20"/>'],
        ['Connect', '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10"/>'],
        ['Cut', '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20"/>'],
        ['Delete', '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'],
        ['Create node', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>'],
        ['Create category', '<path d="M3 7h6l2 2h10v10H3z"/>'],
        ['Create branch', '<path d="M6 3v12a4 4 0 0 0 4 4h8M6 9a4 4 0 0 0 4 4h8"/>']
    ];
    TOOLS.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button'; b.title = t[0] + ' (Phase 2)'; b.setAttribute('aria-label', t[0] + ', available in Phase 2');
        b.setAttribute('aria-disabled', 'true');
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t[1] + '</svg>';
        $('stTools').appendChild(b);
    });

    function setOpen(on) {
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
        var r = await sb.from('studio_projects').update({ title: title, graph: S.cur.graph || { nodes: [], connections: [] } }).eq('id', S.cur.id);
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
        if (!sb) { log('error', 'studio', 'Supabase is not configured'); return; }
        var sess = (await sb.auth.getSession()).data.session;
        if (!sess) {
            var m = $('stListMsg'); m.textContent = 'Sign in to use Studio. ';
            var a = document.createElement('a'); a.href = 'login.html'; a.textContent = 'Go to login'; m.appendChild(a);
            $('stNew').disabled = true; $('stNewName').disabled = true;
            log('warn', 'auth', 'Not signed in'); return;
        }
        S.me = sess.user; log('ok', 'studio', 'Studio ready (Phase 1)');
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
