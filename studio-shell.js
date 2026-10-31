/* SPECSOFT® Studio: sidebar, views, Explorer tree, Code Editor view, info pages and the profile footer.
   Views that are not built yet (Preview, Version Control, Dependencies, Publish, Assets) show an honest
   "not built yet" page instead of fake features. */
(function () {
    'use strict';
    var G = window.StudioGraph, S = window.StudioShell = {}, view = 'graph', codeSel = null, ui = {};
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

    var IC = {
        explorer: '<path d="M3 7h6l2 2h10v10H3z"/>', graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6.5l7 4M8.5 17.5l7-4"/>',
        code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>', database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
        assets: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>', preview: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        timeline: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>', console: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2M12 15h5"/>',
        debugger: '<path d="M8 8h8v8a4 4 0 0 1-8 0zM12 4v4M4 12h4M16 12h4M5 6l3 3M19 6l-3 3"/>', versions: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-12 2-12 5"/>',
        deps: '<path d="M12 3l9 5v8l-9 5-9-5V8zM12 12l9-4M12 12L3 8M12 12v9"/>', publish: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', docs: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/>'
    };
    var NAV = [
        ['Workspace', [['explorer', 'Explorer'], ['graph', 'Node Graphs'], ['code', 'Code Editor'], ['database', 'Database'], ['assets', 'Assets', 'soon']]],
        ['Development', [['preview', 'Preview', 'P6'], ['timeline', 'Timeline'], ['console', 'Console'], ['debugger', 'Debugger']]],
        ['Project', [['versions', 'Version Control', 'P7'], ['deps', 'Dependencies', 'P6'], ['publish', 'Publish', 'P7']]],
        [null, [['settings', 'Project Settings'], ['docs', 'Documentation']]]
    ];
    var MODE = { graph: 'graph', code: 'code', database: 'dock', timeline: 'dock', console: 'dock', debugger: 'dock' };
    var TAB = { database: 'data', timeline: 'time', console: 'log', debugger: 'hist' }, TAB2VIEW = { data: 'database', time: 'timeline', log: 'console', hist: 'debugger' };

    function buildNav() {
        var nav = $('stNav');
        NAV.forEach(function (sec) {
            if (sec[0]) nav.appendChild(el('h2', 'st-sec', sec[0]));
            sec[1].forEach(function (it) {
                var b = el('button', 'st-nav-i'); b.type = 'button'; b.dataset.view = it[0];
                b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[it[0]] + '</svg>';
                b.appendChild(el('span', '', it[1])); if (it[2]) b.appendChild(el('em', '', it[2]));
                if (it[0] === 'explorer') {
                    b.setAttribute('aria-expanded', 'true');
                    b.addEventListener('click', function () { var h = $('stExplorer').hidden = !$('stExplorer').hidden; b.setAttribute('aria-expanded', String(!h)); });
                } else b.addEventListener('click', function () { S.setView(it[0]); });
                nav.appendChild(b); if (it[0] === 'explorer') nav.appendChild($('stExplorer'));
            });
        });
    }
    S.setView = function (v) {
        view = v; var mode = MODE[v] || 'page';
        $('stApp').dataset.mode = mode; $('stCanvas').hidden = mode !== 'graph'; $('stCode').hidden = mode !== 'code'; $('stPage').hidden = mode !== 'page'; $('stDock').hidden = mode === 'page';
        if (mode === 'dock') document.querySelector('[data-tab="' + TAB[v] + '"]').click();
        if (mode === 'code') { renderCodeList(); renderEditor(); }
        if (mode === 'page') renderPage(v);
        Array.prototype.forEach.call(document.querySelectorAll('.st-nav-i[data-view]'), function (b) { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {          // keep the sidebar in step when the tabs are used directly
        b.addEventListener('click', function () { if ((MODE[view] || 'page') === 'dock' && TAB2VIEW[b.dataset.tab] !== view) { view = TAB2VIEW[b.dataset.tab]; S.setView(view); } });
    });

    /* ---- Explorer tree: branches and nodes of the open project ---- */
    function ext(n) { return n.type === 'database' ? '.sql' : n.type === 'script' ? (n.lang === 'html' ? '.html' : n.lang === 'css' ? '.css' : '.js') : ''; }
    function treeList(list) {
        var ul = el('ul', 'tr');
        list.forEach(function (n) {
            var li = el('li'), b = el('button', 't-' + n.type, n.label + ext(n)); b.type = 'button'; b.title = n.type;
            b.addEventListener('click', function () { if (n.type === 'script' || n.type === 'database') G.openCode(n.id); else { G.reveal(n.id); S.setView('graph'); } });
            if (n.children) { var d = el('details'), s = el('summary'); d.open = true; s.appendChild(b); d.appendChild(s); d.appendChild(n.children.length ? treeList(n.children) : el('p', 'st-hint', 'Empty branch')); li.appendChild(d); }
            else li.appendChild(b);
            ul.appendChild(li);
        });
        return ul;
    }
    function renderTree() {
        var box = $('stTree'); box.textContent = '';
        if (!G.isOpen()) return;
        var t = G.tree(); box.appendChild(el('h3', 'st-sub', 'Structure')); box.appendChild(t.length ? treeList(t) : el('p', 'st-hint', 'No nodes yet.'));
    }
    S.refresh = function () { renderTree(); if (view === 'code') renderCodeList(); };
    G.ext.shell = { load: function () { codeSel = null; S.refresh(); if (view === 'code') renderEditor(); } };      // no save(): nothing here is stored in the project
    G.openCode = function (id) { codeSel = id; S.setView('code'); };

    /* ---- Code Editor view ---- */
    function codeExt(c) { return c.type === 'database' ? '.sql' : c.lang === 'html' ? '.html' : c.lang === 'css' ? '.css' : '.js'; }
    function buildCode() {
        var root = $('stCode'); ui.list = el('div', 'cv-files'); ui.edit = el('div', 'cv-edit');
        var head = el('div', 'cv-new'); head.appendChild(el('span', '', 'New'));
        [['js', 'JS'], ['html', 'HTML'], ['css', 'CSS'], ['sql', 'SQL']].forEach(function (k) {
            var b = el('button', 'st-btn', k[1]); b.type = 'button'; b.title = 'New ' + k[1] + ' file';
            b.addEventListener('click', function () { var id = G.createCode(k[0]); if (!id) { G.log('warn', 'studio', 'Open a project first (or the node limit was reached)'); return; } codeSel = id; renderCodeList(); renderEditor(); });
            head.appendChild(b);
        });
        var side = el('div', 'cv-side'); side.appendChild(head); side.appendChild(ui.list); root.appendChild(side); root.appendChild(ui.edit);
    }
    function renderCodeList() {
        if (!ui.list) return; ui.list.textContent = ''; var files = G.codeNodes();
        if (codeSel && !files.some(function (f) { return f.id === codeSel; })) { codeSel = null; renderEditor(); }
        if (!codeSel && files.length) { codeSel = files[0].id; renderEditor(); }          // opening the view never shows an empty editor when files exist
        files.forEach(function (f) {
            var b = el('button', ''); b.type = 'button'; b.appendChild(el('span', '', f.label + codeExt(f))); if (f.path) b.appendChild(el('small', '', f.path));
            if (f.id === codeSel) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', function () { codeSel = f.id; renderCodeList(); renderEditor(); }); ui.list.appendChild(b);
        });
        if (!files.length) ui.list.appendChild(el('p', 'st-hint', G.isOpen() ? 'No code files yet. Create one above, or set a node to Script or Database.' : 'Open a project to edit its code.'));
    }
    function renderEditor() {
        if (!ui.edit) return; ui.edit.textContent = ''; var n = codeSel && G.node(codeSel);
        if (!n) { ui.edit.appendChild(el('p', 'st-hint', 'Pick a file on the left, or create one with the New buttons.')); return; }
        var db = n.type === 'database', lang = db ? 'sql' : n.config.lang, bar = el('div', 'cv-bar');
        bar.appendChild(el('strong', '', n.label + codeExt({ type: n.type, lang: n.config.lang })));
        if (!db) {
            var sel = el('select'); sel.setAttribute('aria-label', 'Language'); ['javascript', 'html', 'css'].forEach(function (x) { var o = el('option', '', x); o.value = x; if (x === lang) o.selected = true; sel.appendChild(o); });
            sel.addEventListener('change', function () { G.setLang(n.id, sel.value); renderCodeList(); renderEditor(); }); bar.appendChild(sel);
        }
        if (lang === 'javascript') {
            var tl = el('input'); tl.type = 'number'; tl.min = 100; tl.max = 30000; tl.step = 100; tl.value = n.config.timeout; tl.setAttribute('aria-label', 'Time limit in milliseconds');
            tl.addEventListener('change', function () { var v = +tl.value; n.config.timeout = isFinite(v) ? Math.min(30000, Math.max(100, Math.round(v))) : 5000; tl.value = n.config.timeout; G.onChange(); });
            var l = el('label', 'cv-lim'); l.appendChild(el('span', '', 'Time limit (ms)')); l.appendChild(tl); bar.appendChild(l);
        }
        var go = el('button', 'st-btn', 'Show in graph'); go.type = 'button'; go.addEventListener('click', function () { G.reveal(n.id); S.setView('graph'); }); bar.appendChild(go);
        ui.edit.appendChild(bar);
        var note = db ? 'Runs against the project database. Changes are kept only when the run finishes successfully.'
            : lang === 'javascript' ? 'Runs in a sandbox. Use await, return a value, and studio.log, studio.sql, studio.value, studio.emit and more (see Documentation).'
            : 'HTML and CSS files output their content when a run reaches them. The Preview (Phase 6) will assemble them into a page.';
        ui.edit.appendChild(el('p', 'cv-note', note));
        var ed = G.editorFor(n, db ? 'sql' : 'code', lang); ed.classList.add('big'); ui.edit.appendChild(ed);
    }

    /* ---- info pages ---- */
    var PH = {
        assets: ['Assets', 'Not built yet', 'Images, fonts and other files for your projects.', ['Needs file storage (Supabase Storage) and the Preview to be useful.', 'Planned alongside the Preview in Phase 6.']],
        preview: ['Preview', 'Phase 6', 'A live, sandboxed preview of your unpublished project.', ['HTML, CSS and JavaScript nodes will be assembled into a page and shown in an isolated frame.', 'Strict Content Security Policy and message validation, with no access to your session.', 'Right now HTML and CSS nodes only output their content to the run.']],
        versions: ['Version Control', 'Phase 7', 'Release history and rollback for published projects.', ['Version numbers, release notes and rollback arrive with Publishing.', 'Until then, use Save to keep the current state of a project.']],
        deps: ['Dependencies', 'Phase 6', 'External libraries your project can use in the Preview.', ['Will use pinned, reviewed script URLs only.', 'Not built yet, so nothing here changes your project.']],
        publish: ['Publish', 'Phase 7', 'Publish a finished project and get an Open Project link.', ['Static websites, HTML games and source-code projects first.', 'Preview and publishing stay separate operations.', 'Not built yet.']]
    };
    var DOCS = [
        ['Node types', ['Basic: runs a short step. Use it for structure and timing.', 'Script (JavaScript): runs in a sandbox with a time limit. Script (HTML / CSS): outputs its content to the run.', 'Branch: a nested graph. Open it with a double-click. Inline branches finish before the parent continues, independent ones do not wait.', 'Database: runs SQL against the project database.']],
        ['Studio API (JavaScript)', ['studio.log(...), await studio.delay(ms)', 'await studio.runNode("N2"), studio.result("N2"), studio.enableNode("N2"), studio.disableNode("N2")', 'await studio.spawnBranch("B1"), await studio.stopGroup("B1")', 'await studio.sql("SELECT * FROM t WHERE id = ?", [1]) returns { rows, changes, lastId }', 'await studio.value("speed") reads an animated value, await studio.time() reads the timeline clock, await studio.emit("name") fires an event', 'input holds the results of the nodes connected into this one. return a value to pass it on.']],
        ['SQL', ['CREATE TABLE, DROP TABLE, INSERT, SELECT, UPDATE, DELETE.', 'WHERE with = != < <= > >= LIKE IN IS NULL AND OR NOT, plus COUNT / SUM / AVG / MIN / MAX, ORDER BY and LIMIT.', 'No JOIN, GROUP BY or subqueries. It is a small built-in engine, not SQLite or Postgres.', 'Database changes from a run are kept only if the run finishes. Press Save to store them.']],
        ['Timeline', ['Node track markers: start (earliest start), stop, pause, resume, wait, toggle, spawn, custom event.', 'Value tracks hold keyframes. Values are interpolated linearly.', 'A node can wait for an event (Properties) and scripts can fire one with studio.emit.', 'Scrub the playhead on the ruler when no run is active.']],
        ['Shortcuts', ['V select, H move canvas, C connect, X cut, D delete, N create node, B create branch', 'Mouse wheel zooms, Space + drag pans, Esc returns to Select, Ctrl+S saves, Ctrl+Enter runs SQL.']],
        ['Limits', ['200 nodes per graph, 5 branch levels, 500 node runs per run, 25 spawns per run.', 'Scripts: 20,000 characters, 30 s max, 100 KB output. Database: 10 tables, 2,000 rows per table, 200 KB. Project: 450 KB.']]
    ];
    function list(items) { var ul = el('ul', 'pg-list'); items.forEach(function (t) { ul.appendChild(el('li', '', t)); }); return ul; }
    function renderPage(v) {
        var p = $('stPage'); p.textContent = ''; var w = el('div', 'pg');
        if (PH[v]) { var d = PH[v]; w.appendChild(el('h1', '', d[0])); w.appendChild(el('span', 'pg-badge', d[1])); w.appendChild(el('p', 'pg-lead', d[2])); w.appendChild(list(d[3])); }
        else if (v === 'docs') { w.appendChild(el('h1', '', 'Documentation')); DOCS.forEach(function (s) { w.appendChild(el('h2', '', s[0])); w.appendChild(list(s[1])); }); }
        else if (v === 'settings') {
            w.appendChild(el('h1', '', 'Project Settings'));
            if (!G.isOpen()) w.appendChild(el('p', 'pg-lead', 'Open a project to see its settings.'));
            else {
                var g = G.get(), tables = Object.keys((window.StudioData ? StudioData.get() : { tables: {} }).tables).length;
                w.appendChild(list(['Nodes (all branches): ' + G.listNodes().length, 'Database tables: ' + tables, 'Timeline tracks: ' + ((g.timeline && g.timeline.tracks.length) || 0), 'Saved size: ' + (JSON.stringify(g).length / 1000).toFixed(1) + ' KB of 450 KB', 'Rename the project with the title field above the canvas.']));
                var del = el('button', 'st-btn st-danger', 'Delete this project'); del.type = 'button'; del.addEventListener('click', function () { $('stDelete').click(); }); w.appendChild(del);
            }
        }
        p.appendChild(w);
    }

    /* ---- profile footer ---- */
    S.setUser = async function (user, sb) {
        var name = 'Guest', avatar = null;
        if (user) {
            name = (user.email || 'user').split('@')[0];
            try { var r = await sb.from('profiles').select('username,display_name,avatar_url').eq('id', user.id).maybeSingle(); if (r.data) { name = r.data.display_name || r.data.username || name; avatar = r.data.avatar_url; } } catch (e) {}
        }
        var box = $('stUser'); box.textContent = '';
        if (avatar && /^https:\/\//.test(avatar)) { var img = el('img', 'u-av'); img.src = avatar; img.alt = ''; img.referrerPolicy = 'no-referrer'; box.appendChild(img); }
        else box.appendChild(el('span', 'u-av u-init', name.charAt(0).toUpperCase()));
        var t = el('div', 'u-t'); t.appendChild(el('strong', '', name)); t.appendChild(el('small', '', 'Workspace Owner')); box.appendChild(t);
    };
    buildNav(); buildCode(); S.setUser(null); S.setView('graph');
})();
