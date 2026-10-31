/* SPECSOFT® Studio, PHASE 5: project database (Data tab). The data lives in the project's graph JSON
   (graph.db) and is saved with the project. Database nodes and scripts (studio.sql) change a COPY during
   a run; the copy is kept only when the run finishes successfully. The SQL box below changes it directly. */
(function () {
    'use strict';
    var G = window.StudioGraph, SQL = window.StudioSQL, db = { tables: {} }, shown = null, ui = {};
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    var D = window.StudioData = {};
    D.get = function () { return db; };
    D.commit = function (next, runId) {
        db = SQL.clean(next); render(); G.onChange();
        G.log('ok', 'data', 'Database changes from Run ' + runId + ' were kept. Press Save to store them with the project.');
    };
    G.ext.db = { load: function (d) { db = SQL.clean(d); shown = null; render(); showResult(null); }, save: function () { return JSON.parse(JSON.stringify(db)); } };

    function grid(cols, rows, max) {
        var wrap = el('div', 'dt-wrap'), t = el('table', 'dt'), h = el('tr');
        cols.forEach(function (c) { h.appendChild(el('th', '', c)); }); t.appendChild(h);
        rows.slice(0, max || 100).forEach(function (r) {
            var tr = el('tr'); cols.forEach(function (c) { var v = r[c]; tr.appendChild(el('td', v === null || v === undefined ? 'dt-null' : '', v === null || v === undefined ? 'NULL' : String(v))); }); t.appendChild(tr);
        });
        wrap.appendChild(t);
        if (rows.length > (max || 100)) wrap.appendChild(el('p', 'st-hint', 'Showing ' + (max || 100) + ' of ' + rows.length + ' rows'));
        return wrap;
    }
    function render() {
        if (!ui.list) return;
        ui.list.textContent = ''; var names = Object.keys(db.tables);
        if (!names.length) ui.list.appendChild(el('p', 'st-hint', 'No tables yet. Create one with the SQL box.'));
        names.forEach(function (n) {
            var b = el('button', '', n + ' (' + db.tables[n].rows.length + ')'); b.type = 'button'; if (n === shown) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', function () { shown = n; render(); }); ui.list.appendChild(b);
        });
        ui.view.textContent = '';
        if (shown && db.tables[shown]) ui.view.appendChild(grid(db.tables[shown].cols, db.tables[shown].rows));
        else if (names.length) ui.view.appendChild(el('p', 'st-hint', 'Pick a table to see its rows.'));
    }
    function showResult(r, err) {
        if (!ui.out) return; ui.out.textContent = '';
        if (err) { ui.out.appendChild(el('p', 'dt-err', err)); return; }
        if (!r) return;
        if (r.isSelect) ui.out.appendChild(r.rows.length ? grid(r.columns, r.rows, 100) : el('p', 'st-hint', 'No rows.'));
        else ui.out.appendChild(el('p', 'st-hint', 'Done. ' + r.changes + ' row(s) changed.'));
    }
    function run() {
        if (!G.isOpen()) { showResult(null, 'Open a project first.'); return; }
        try {
            var r = SQL.exec(db, ui.sql.value, []);
            if (r.changed) { G.onChange(); G.log('info', 'data', 'SQL ran: ' + r.changes + ' row(s) changed'); }
            if (r.isSelect === false && r.changed) shown = shown || Object.keys(db.tables)[0] || null;
            render(); showResult(r);
        } catch (e) { showResult(null, e.message); G.log('error', 'data', e.message); }
    }
    function build() {
        var root = $('stData'); if (!root) return;
        ui.list = el('div', 'dt-tables'); ui.view = el('div', 'dt-view');
        ui.sql = el('textarea', 'dt-sql'); ui.sql.spellcheck = false; ui.sql.maxLength = 20000; ui.sql.setAttribute('aria-label', 'SQL');
        ui.sql.placeholder = "CREATE TABLE scores (id INTEGER PRIMARY KEY, name TEXT, points INTEGER);\nINSERT INTO scores (name, points) VALUES ('Ann', 10);\nSELECT * FROM scores;";
        var go = el('button', 'st-btn', 'Run SQL'); go.type = 'button'; go.title = 'Ctrl+Enter';
        ui.out = el('div', 'dt-out'); ui.sql.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
        go.addEventListener('click', run);
        var left = el('div', 'dt-left'); left.appendChild(el('h3', '', 'Tables')); left.appendChild(ui.list);
        var mid = el('div', 'dt-mid'); mid.appendChild(ui.view);
        var right = el('div', 'dt-right'); right.appendChild(ui.sql); right.appendChild(go); right.appendChild(ui.out);
        root.appendChild(left); root.appendChild(mid); root.appendChild(right); render();
    }
    build();
})();
