/* SPECSOFT® Studio: sidebar, views, Explorer tree, Code Editor view, info pages and the profile footer.
   Views that are not built yet (Preview, Version Control, Dependencies, Publish, Assets) show an honest
   "not built yet" page instead of fake features. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var G = window.StudioGraph, S = window.StudioShell = {}, view = 'graph', codeSel = null, split = false, ui = {};
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

    var IC = {
        explorer: '<path d="M3 7h6l2 2h10v10H3z"/>', graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6.5l7 4M8.5 17.5l7-4"/>',
        code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>', database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
        assets: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>', preview: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        timeline: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>', console: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10l3 2-3 2M12 15h5"/>',
        debugger: '<path d="M8 8h8v8a4 4 0 0 1-8 0zM12 4v4M4 12h4M16 12h4M5 6l3 3M19 6l-3 3"/>', versions: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-12 2-12 5"/>',
        deps: '<path d="M12 3l9 5v8l-9 5-9-5V8zM12 12l9-4M12 12L3 8M12 12v9"/>', publish: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>', docs: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/>',
        stage: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="7" y="8" width="5" height="5"/><circle cx="16" cy="15" r="2"/>'
    };
    var NAV = [
        ['Workspace', [['explorer', 'Explorer'], ['graph', 'Node Graphs'], ['code', 'Code Editor'], ['database', 'Database'], ['assets', 'Assets']]],
        ['Development', [['preview', 'Preview'], ['timeline', 'Timeline'], ['stage', 'Stage'], ['console', 'Console'], ['debugger', 'Debugger']]],
        ['Project', [['versions', 'Version Control'], ['deps', 'Dependencies', 'soon'], ['publish', 'Publish']]],
        [null, [['settings', 'Project Settings'], ['docs', 'Documentation']]]
    ];
    var MODE = { graph: 'graph', code: 'code', preview: 'preview', database: 'dock', timeline: 'dock', stage: 'dock', console: 'dock', debugger: 'dock' };
    var TAB = { database: 'data', timeline: 'time', stage: 'stage', console: 'log', debugger: 'hist' }, TAB2VIEW = { data: 'database', time: 'timeline', stage: 'stage', log: 'console', hist: 'debugger' };

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
        $('stApp').dataset.mode = mode; $('stCanvas').hidden = mode !== 'graph'; $('stCode').hidden = mode !== 'code'; $('stPage').hidden = mode !== 'page'; $('stPreview').hidden = mode !== 'preview'; $('stDock').hidden = mode === 'page';
        if (mode === 'preview') StudioPreview.mount($('stPreview'));
        if (mode === 'dock') document.querySelector('[data-tab="' + TAB[v] + '"]').click();
        if (mode === 'code') { renderCodeList(); renderEditor(); if (split) StudioPreview.mount($('cvPv')); }
        if (mode === 'page') renderPage(v);
        Array.prototype.forEach.call(document.querySelectorAll('.st-nav-i[data-view]'), function (b) { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {          // keep the sidebar in step when the tabs are used directly
        b.addEventListener('click', function () { if ((MODE[view] || 'page') === 'dock' && TAB2VIEW[b.dataset.tab] !== view) { view = TAB2VIEW[b.dataset.tab]; S.setView(view); } });
    });

    /* ---- Explorer tree: branches and nodes of the open project ---- */
    function ext(n) { return n.type === 'database' ? '.sql' : n.type === 'script' ? (n.lang === 'html' ? '.html' : n.lang === 'css' ? '.css' : n.lang === 'pagejs' ? '.page.js' : n.lang === 'json' ? '.json' : '.js') : ''; }
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
        var box = $('stTree'); if (window.StudioExplorer) return StudioExplorer.render(box);       // the new Explorer (studio-explorer.js); the old tree below is the fallback
        box.textContent = '';
        if (!G.isOpen()) return;
        var t = G.tree(); box.appendChild(el('h3', 'st-sub', 'Structure')); box.appendChild(t.length ? treeList(t) : el('p', 'st-hint', 'No nodes yet.'));
    }
    S.refresh = function () { renderTree(); if (view === 'code') renderCodeList(); if (window.StudioPreview) StudioPreview.onChange(); };
    G.ext.shell = { load: function () { codeSel = null; S.refresh(); if (view === 'code') renderEditor(); } };      // no save(): nothing here is stored in the project
    G.openCode = function (id) { codeSel = id; S.setView('code'); };

    /* ---- Code Editor view ---- */
    function codeExt(c) { return c.type === 'database' ? '.sql' : c.lang === 'html' ? '.html' : c.lang === 'css' ? '.css' : c.lang === 'pagejs' ? '.page.js' : c.lang === 'json' ? '.json' : '.js'; }
    function runCode(id) {                                // Run (or Ctrl+Enter) in the Code Editor: JavaScript and SQL run alone and print to the Console; page files open the Preview
        var n = G.node(id); if (!n) return;
        if (n.type === 'database' || (n.type === 'script' && n.config.lang === 'javascript')) { if (window.StudioSTools && StudioSTools.runFile) StudioSTools.runFile(id); else G.log('warn', 'run', 'Run needs studio-stools.js'); }
        else if (n.type === 'script' && n.config.lang === 'json') {      // JSON: check it here and print the parsed value to the Console
            if (!String(n.config.code || '').trim()) { G.log('warn', 'script', n.label + ' has no JSON', id); return; }
            var jr = G.parseJson(n.config.code);
            if (!jr.ok) { G.log('error', 'script', n.label + ' is not valid JSON: ' + jr.error, id); return; }
            var js = JSON.stringify(jr.value); G.log('ok', 'script', n.label + ' is valid JSON: ' + (js.length > 2000 ? js.slice(0, 2000) + ' ...' : js), id);
        }
        else { S.setView('preview'); if (window.StudioPreview) StudioPreview.run(); }
    }
    function buildCode() {
        var root = $('stCode'); ui.list = el('div', 'cv-files'); ui.edit = el('div', 'cv-edit');
        var head = el('div', 'cv-new'); head.appendChild(el('span', '', 'New'));
        [['js', 'JS'], ['html', 'HTML'], ['css', 'CSS'], ['json', 'JSON'], ['sql', 'SQL']].forEach(function (k) {
            var b = el('button', 'st-btn', k[1]); b.type = 'button'; b.title = 'New ' + k[1] + ' file';
            b.addEventListener('click', function () { var id = G.createCode(k[0]); if (!id) { G.log('warn', 'studio', 'Open a project first (or the node limit was reached)'); return; } codeSel = id; renderCodeList(); renderEditor(); });
            head.appendChild(b);
        });
        ui.edit.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && codeSel) { e.preventDefault(); runCode(codeSel); } });
        var side = el('div', 'cv-side'); side.appendChild(head); side.appendChild(ui.list); root.appendChild(side); root.appendChild(ui.edit);
        var pv = el('div', 'cv-pv'); pv.id = 'cvPv'; pv.hidden = true; root.appendChild(pv);
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
            var sel = el('select'); sel.setAttribute('aria-label', 'Language'); ['javascript', 'html', 'css', 'pagejs', 'json'].forEach(function (x) { var o = el('option', '', x === 'pagejs' ? 'javascript (page)' : x); o.value = x; if (x === lang) o.selected = true; sel.appendChild(o); });
            sel.addEventListener('change', function () { G.setLang(n.id, sel.value); renderCodeList(); renderEditor(); }); bar.appendChild(sel);
        }
        if (lang === 'javascript') {
            var tl = el('input'); tl.type = 'number'; tl.min = 100; tl.max = 30000; tl.step = 100; tl.value = n.config.timeout; tl.setAttribute('aria-label', 'Time limit in milliseconds');
            tl.addEventListener('change', function () { var v = +tl.value; n.config.timeout = isFinite(v) ? Math.min(30000, Math.max(100, Math.round(v))) : 5000; tl.value = n.config.timeout; G.onChange(); });
            var l = el('label', 'cv-lim'); l.appendChild(el('span', '', 'Time limit (ms)')); l.appendChild(tl); bar.appendChild(l);
        }
        var runB = el('button', 'st-btn', lang === 'javascript' || db ? 'Run' : lang === 'json' ? 'Check JSON' : 'Run in Preview'); runB.type = 'button'; runB.title = (lang === 'javascript' || db ? 'Run this file alone and list its output in the Console' : lang === 'json' ? 'Check that this is valid JSON and print it in the Console' : 'Open the Preview and run it') + ' (Ctrl+Enter)';
        runB.addEventListener('click', function () { runCode(n.id); }); bar.appendChild(runB);
        var sp = el('button', 'st-btn', split ? 'Hide live preview' : 'Live preview'); sp.type = 'button'; sp.title = 'Show the Preview next to the editor (turn on Auto-refresh to see changes as you type)';
        sp.addEventListener('click', function () { split = !split; $('stCode').classList.toggle('split', split); $('cvPv').hidden = !split; sp.textContent = split ? 'Hide live preview' : 'Live preview'; if (split) StudioPreview.mount($('cvPv')); else StudioPreview.stop(true); });
        bar.appendChild(sp);
        var go = el('button', 'st-btn', 'Show in graph'); go.type = 'button'; go.addEventListener('click', function () { G.reveal(n.id); S.setView('graph'); }); bar.appendChild(go);
        ui.edit.appendChild(bar);
        var note = db ? 'Runs against the project database. Changes are kept only when the run finishes successfully.'
            : lang === 'pagejs' ? 'Runs INSIDE the Preview page, not in the graph. Use console.log and normal browser code. No network access.'
            : lang === 'json' ? 'Plain data, never run as code. When a run reaches this file, the parsed value becomes its output for the nodes after it (100 KB max). Invalid JSON stops the run with the line number.'
            : lang === 'javascript' ? 'Runs in a sandbox. Use await, return a value, and studio.log, studio.sql, studio.value, studio.emit and more (see Documentation).'
            : 'HTML and CSS files output their content when a run reaches them. The Preview (Phase 6) will assemble them into a page.';
        ui.edit.appendChild(el('p', 'cv-note', note));
        var ed = G.editorFor(n, db ? 'sql' : 'code', lang); ed.classList.add('big'); ui.edit.appendChild(ed);
    }

    /* ---- info pages ---- */
    var PH = {
        assets: ['Assets', 'Not built yet', 'Images, fonts and other files for your projects.', ['Needs file storage (Supabase Storage) and the Preview to be useful.', 'Planned alongside the Preview in Phase 6.']],
        versions: ['Version Control', 'Phase 7', 'Release history and rollback for published projects.', ['Version numbers, release notes and rollback arrive with Publishing.', 'Until then, use Save to keep the current state of a project.']],
        deps: ['Dependencies', 'Not built yet', 'External libraries for your project.', ['The Preview blocks ALL external scripts on purpose (no network), so libraries will need a vetted list that gets inlined into the page.', 'Until then, paste library code into a JavaScript (page) file.']],
        publish: ['Publish', 'Phase 7', 'Publish a finished project and get an Open Project link.', ['Static websites, HTML games and source-code projects first.', 'Preview and publishing stay separate operations.', 'Not built yet.']]
    };
    var DOCS = [
        ['Node types', ['Basic: runs a short step. Use it for structure and timing.', 'Script (JavaScript): graph logic, runs in a sandbox with a time limit. Script (HTML / CSS / JavaScript (page)): the files that make up your Preview page.', 'Branch: a nested graph. Open it with a double-click. Inline branches finish before the parent continues, independent ones do not wait.', 'Database: runs SQL against the project database.']],
        ['Studio API (JavaScript)', ['studio.log(...), await studio.delay(ms)', 'await studio.runNode("N2"), studio.result("N2"), studio.enableNode("N2"), studio.disableNode("N2")', 'await studio.spawnBranch("B1"), await studio.stopGroup("B1")', 'await studio.sql("SELECT * FROM t WHERE id = ?", [1]) returns { rows, changes, lastId }', 'await studio.value("speed") reads an animated value, await studio.time() reads the timeline clock, await studio.emit("name") fires an event', 'input holds the results of the nodes connected into this one. return a value to pass it on.']],
        ['SQL', ['CREATE TABLE, DROP TABLE, INSERT, SELECT, UPDATE, DELETE.', 'WHERE with = != < <= > >= LIKE IN IS NULL AND OR NOT, plus COUNT / SUM / AVG / MIN / MAX, ORDER BY and LIMIT.', 'No JOIN, GROUP BY or subqueries. It is a small built-in engine, not SQLite or Postgres.', 'Database changes from a run are kept only if the run finishes. Press Save to store them.']],
        ['Preview', ['Run preview builds one page from your enabled HTML (body), CSS and JavaScript (page) files, in Explorer order, and shows it in a locked-down sandbox.', 'No network: remote images, scripts, fonts, frames and form posts are blocked. Use data: images and inline code.', 'console.log and errors appear in the Console. Errors from page JS link back to the file and line.', 'Source can be the current draft or the last saved version. Auto-refresh reloads shortly after you edit. Live preview in the Code Editor shows it next to your code.', 'A page that stops responding is removed after 5 seconds. Preview never publishes anything.']],
        ['Timeline', ['Node track markers: start (earliest start), stop, pause, resume, wait, toggle, spawn, custom event.', 'Value tracks hold keyframes. Values are interpolated linearly.', 'A node can wait for an event (Properties) and scripts can fire one with studio.emit.', 'Scrub the playhead on the ruler when no run is active.']],
        ['Shortcuts', ['S select, G grab, C cut, D delete, L lasso, F frame, N node, B branch, R reroute, W wait, I inspect, A align, / find, T toggle, P pulse', 'Ctrl+D duplicate, Ctrl+G group, Ctrl+Shift+G ungroup, Ctrl+C connect, Ctrl+A select all', 'V fit view, + and - zoom, 0 reset view', 'Ctrl+Z undo, Ctrl+Y redo, Ctrl+X cut, Ctrl+V paste, Ctrl+Insert copy, F2 rename, Enter open', 'Mouse wheel zooms, Space + drag pans, Esc returns to Select, Ctrl+S saves, Ctrl+Enter runs SQL.']],
        ['STools', ['The tool bar has four sections: Canvas, Graphs, Runtime and Diagnostics. Click a section name to fold it.', 'Step releases the next node of a paused run. Pulse is a dry run that only animates the wires. Spawn starts another copy of the selected branch during a run.', 'Debug: click a node to set a breakpoint (red dot). The run pauses when that node starts. Trace shows run order and time on every node. Monitor shows live counts.', 'Resize panels by dragging the top edge of the bottom panel or the right edge of the workspace (arrow keys work too). Double-click the top edge to fold the bottom panel. Sizes are remembered on this device.', 'The Console has search, Copy and Export, a red badge for new errors, and keeps the last 500 lines. Monitor also reports when the page was busy for over 400 ms.', 'Right-click a node for Open, Copy, Cut, Paste, Rename, Delete and more. Right-click a connection, a frame or the empty canvas for their own menus. Cut moves the nodes when you paste, so nothing is lost if you never paste. You can paste into another branch or even another project.', 'The Explorer shows folders and branches as a tree. Click the arrow to fold, double-click a branch to open it, use the arrow keys to move, and right-click a row for its menu. The box at the top filters by name, type or extension.', 'Undo and Redo cover the graph (nodes, connections, code, delays, frames, folders). They do not cover database rows or the timeline, and they wait while a run is active.', 'Validate checks loops, empty or broken scripts, wrong node names in studio.runNode and friends, unfired events and size limits. Click a result to jump to its node.']],
        ['Run and output', ['Run (or Ctrl+Enter) in the Code Editor runs one JavaScript or SQL file on its own. Everything it prints with console.log, console.warn, console.error or studio.log appears in the Console, then the value it returned.', 'In the Console, pick "Program output" in the filter to see only what your code printed, and tick "Clear on run" to start each run with a clean Console.', 'Scripts can print up to 1,000 lines per run.']],
        ['Version Control and Publish', ['Version Control: save named snapshots of your project, compare one with your draft, restore it as a draft, delete it. 15 snapshots per project.', 'Publish: pick a type, title, link name, visibility, cover and version number. A release is built from the last SAVED version and never changes. Roll back by making an older release live. Unpublish hides it without deleting anything.', 'Open Project opens the standalone viewer (studio-view.html?p=link-name). It runs your project in a locked-down sandbox with no network access.', 'Projects hub: tick "Also show it on the Projects hub" and set Visibility to Public. Publishing then adds a card to the Projects tab, and later releases update the same card. Unpublish keeps the card (and its likes and comments) but removes its link. Remove from hub deletes the card.']],
        ['Triggers', ['A Trigger node has no input. Wire it to what should happen each time it fires, and use Validate to check the wiring.', 'Timer: fires after a delay or every N ms (50 ms minimum). On Event: fires each time studio.emit("name") or a timeline marker fires that event. On Error: when a node in the same graph fails, the run keeps going, the nodes after that node are skipped, and the error (message, node) goes to the trigger.', 'While a trigger is armed the run keeps listening until you press Stop. Each trigger stops itself after its Max fires (default 20, up to 200). Scripts after a trigger read its details from input.<TriggerLabel> (trigger, count, plus event, or message and node).', 'Stop while the run is only waiting for triggers (nothing is running) counts as finished, so database changes are kept. Stop while nodes are running cancels the run.']],
        ['Flow nodes', ['Flow nodes sit in the middle of a graph and decide what runs after them. The nodes wired after a Counter, Loop, Sequence or Randomizer belong to it, so feed them only from that node (Validate checks this).', 'Counter: counts how often it is reached (also across trigger fires) and passes on when its rule says so. Loop: runs the nodes after it N times, one run after the other (max 100). Sequence: runs the nodes after it one at a time, top to bottom on the canvas. Randomizer: picks ONE of the nodes after it by weight (0 = never).', 'Reset Node sets counters back to their start value. Spawn Node starts extra copies of a branch (shares the 25 spawns per run limit). Scripts after a flow node read input.<FlowLabel> (count, index, chosen, node).']],
        ['World', ['Give a node a body (Properties, Has a body): its centre X and Y, a width and height, a role and an optional tag. Roles: Block (solid), Activator, Item (something to pick up). These numbers are separate from where the node sits on the canvas. The Stage tab shows the bodies live while a run is going.', 'Move and Fade are Flow nodes. They tween one body, or a whole group by tag, on the run clock, so Pause freezes them. Move can stop at the first touch. The path is checked in small steps, so a fast move cannot skip through a body.', 'Collision trigger: fires when the chosen body starts touching another body (optionally with a tag), or stops touching. "Only after touching ALL" waits until it has touched every body with that tag. Pickup trigger: the same, but the touched Item is removed. Bodies that already overlap when a run starts fire nothing until they separate and meet again. Reset Node can put bodies back at their start. Limits: 100 bodies, 100 movements at once.']],
        ['Assets', ['Assets page: upload images (png, jpg, gif, webp, up to 5 MB each) and text files (txt, json, csv, md, js, css, html) for this project. Limits: 60 files and 20 MB per project. They are private to you.', 'In HTML, CSS and Page JS files write asset:name.png wherever an image address goes. In Page JS, studioAsset("data.json") returns a text asset as a string. The Preview loads only the assets your files mention (images up to 2 MB, text up to 1 MB each). Assets are not part of published releases yet.']],
        ['Signal range and reroutes', ['Project Settings has a Signal range in px (0 = off). When it is set, a wire longer than the range, measured from the output dot to the input dot, carries no signal: the node at its end, and anything reachable only through it, will not run. Those wires and nodes are drawn in red and Validate lists them.', 'A reroute node is a wire joint: put reroute nodes between far-apart nodes so every hop is within range. A reroute passes the signal on instantly, and scripts after it still read the inputs from before it.']],
        ['Limits', ['200 nodes per graph, 5 branch levels, 500 node runs per run, 25 spawns per run.', 'Scripts: 200,000 characters per file (a paste that is too big is offered a split, never cut silently), 30 s max, 100 KB output. Database: 10 tables, 2,000 rows per table, 200 KB. Project: 500 KB to save, 450 KB to publish a copy.']]
    ];
    function list(items) { var ul = el('ul', 'pg-list'); items.forEach(function (t) { ul.appendChild(el('li', '', t)); }); return ul; }
    function renderPage(v) {
        var p = $('stPage'); p.textContent = ''; if (v === 'assets' && window.StudioAssets) return StudioAssets.render(p);
        if ((v === 'versions' || v === 'publish') && window.StudioPublish) return StudioPublish.render(v, p);       // Phase 7 pages live in studio-publish.js
        var w = el('div', 'pg');
        if (PH[v]) { var d = PH[v]; w.appendChild(el('h1', '', d[0])); w.appendChild(el('span', 'pg-badge', d[1])); w.appendChild(el('p', 'pg-lead', d[2])); w.appendChild(list(d[3])); }
        else if (v === 'docs') { w.appendChild(el('h1', '', 'Documentation')); DOCS.forEach(function (s) { w.appendChild(el('h2', '', s[0])); w.appendChild(list(s[1])); }); }
        else if (v === 'settings') {
            w.appendChild(el('h1', '', 'Project Settings'));
            if (!G.isOpen()) w.appendChild(el('p', 'pg-lead', 'Open a project to see its settings.'));
            else {
                var g = G.get(), tables = Object.keys((window.StudioData ? StudioData.get() : { tables: {} }).tables).length;
                w.appendChild(list(['Nodes (all branches): ' + G.listNodes().length, 'Database tables: ' + tables, 'Timeline tracks: ' + ((g.timeline && g.timeline.tracks.length) || 0), 'Saved size: ' + (JSON.stringify(g).length / 1000).toFixed(1) + ' KB of 500 KB', 'Rename the project with the title field above the canvas.']));
                var rg = el('label', 'pg-set'); rg.appendChild(el('span', '', 'Signal range in px (0 = off). A wire longer than this carries no signal, so far-away nodes need reroute nodes as relays. ')); var ri = el('input'); ri.type = 'number'; ri.min = 0; ri.max = 5000; ri.step = 10; ri.value = StudioSettings.range(); ri.setAttribute('aria-label', 'Signal range in pixels');
                ri.addEventListener('change', function () { StudioSettings.setRange(ri.value); ri.value = StudioSettings.range(); }); rg.appendChild(ri); w.appendChild(rg);
                var del = el('button', 'st-btn st-danger', 'Delete this project'); del.type = 'button'; del.addEventListener('click', function () { $('stDelete').click(); }); w.appendChild(del);
            }
        }
        if (v === 'settings') {                          // this device only
            w.appendChild(el('h2', '', 'This device'));
            var sbl = el('label', 'pg-set'), sbi = el('input'); sbi.type = 'checkbox'; try { sbi.checked = localStorage.getItem('studio-scrollbars') === '1'; } catch (e) {}
            sbi.addEventListener('change', function () { sbPref(sbi.checked); try { localStorage.setItem('studio-scrollbars', sbi.checked ? '1' : '0'); } catch (e) {} });
            sbl.appendChild(sbi); sbl.appendChild(el('span', '', ' Show scrollbars (they are hidden by default; scrolling with the wheel, touch or keyboard still works)')); w.appendChild(sbl);
        }
        p.appendChild(w);
    }

    /* ---- project setting (signal range, saved with the project) and a device setting (scrollbars) ---- */
    var SET = { range: 0 };
    G.ext.settings = { load: function (d) { var r = d && +d.range; SET = { range: isFinite(r) ? Math.max(0, Math.min(5000, Math.round(r))) : 0 }; if (G.redraw) G.redraw(); }, save: function () { return { range: SET.range }; } };
    window.StudioSettings = { range: function () { return SET.range; }, setRange: function (v) { var r = Math.max(0, Math.min(5000, Math.round(+v) || 0)); if (r === SET.range) return; SET.range = r; G.onChange(); if (G.redraw) G.redraw(); } };
    function sbPref(on) { document.documentElement.classList.toggle('st-sb', !!on); }
    try { sbPref(localStorage.getItem('studio-scrollbars') === '1'); } catch (e) {}

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
