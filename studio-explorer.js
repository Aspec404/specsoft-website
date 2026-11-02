/* SPECSOFT® Studio, PHASE 7c: the Explorer. A tidy file-tree of the open project: folders and branches you can fold,
   icons per node type, live status dots, selection that follows the canvas, a filter box, keyboard navigation and
   right-click menus. studio-shell.js hands the #stTree box to StudioExplorer.render() (it keeps its old tree as a fallback).
   Needs studio-menu.js loaded before it. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var G = window.StudioGraph, SH = window.StudioShell, M = window.StudioMenu, host = document.getElementById('stTree');
    if (!G || !SH || !host || !M) return;
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    var X = window.StudioExplorer = {}, openSet = {}, query = '', ui = null, keys = [], lastSig = '', qt = 0;
    var FC = ['#6aa9ff', '#2fa66a', '#e0a800', '#c084fc', '#e5484d', '#38bdf8'];

    var CSS = [
        '.st-explorer{max-height:min(56vh,640px)}',
        '.ex-head{display:flex;align-items:center;gap:4px;margin:10px 0 6px}.ex-head h3{margin:0;flex:1}',
        '.ex-count{font:400 .64rem var(--font-mono,monospace);color:var(--text-secondary);border:1px solid var(--border-subtle,#333);padding:0 6px;border-radius:9px}',
        '.ex-ib{width:24px;height:24px;display:grid;place-items:center;padding:0;background:none;border:1px solid transparent;color:var(--text-secondary);cursor:pointer}.ex-ib:hover{color:var(--text-primary);border-color:var(--border-hover,#666)}',
        '.ex-ib svg{width:14px;height:14px}',
        '.ex-q{width:100%;box-sizing:border-box;margin:0 0 8px;padding:5px 8px;background:var(--bg-base,#000);color:var(--text-primary);border:1px solid var(--border-subtle,#333);font:400 .74rem var(--font-mono,monospace)}',
        '.ex-tree,.ex-tree ul{list-style:none;margin:0;padding:0}.ex-tree ul{margin-left:12px;padding-left:10px}.ex-tree ul[hidden]{display:none}',
        '.ex-tree li{position:relative}',
        '.ex-tree ul>li::before{content:"";position:absolute;left:-10px;top:13px;width:9px;border-top:1px solid var(--border-subtle,#333)}',
        '.ex-tree ul>li::after{content:"";position:absolute;left:-10px;top:0;bottom:0;border-left:1px solid var(--border-subtle,#333)}',
        '.ex-tree ul>li:last-child::after{bottom:auto;height:13px}',
        '.ex-row{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;height:26px;padding:0 6px 0 2px;background:none;border:1px solid transparent;color:var(--text-secondary);font:400 .78rem var(--font-mono,monospace);text-align:left;cursor:pointer;border-radius:0}',
        '.ex-row:hover{color:var(--text-primary);background:rgba(127,127,127,.12)}.ex-row:focus-visible{outline:2px solid var(--text-primary);outline-offset:-2px}',
        '.ex-row[aria-current="true"]{color:var(--text-primary);background:rgba(127,127,127,.2);box-shadow:inset 2px 0 0 var(--text-primary)}',
        '.ex-chev{width:14px;height:14px;flex:none;display:grid;place-items:center;color:var(--text-secondary)}.ex-chev svg{width:11px;height:11px;transition:transform .12s}',
        'li[aria-expanded="true"]>.ex-row .ex-chev svg{transform:rotate(90deg)}',
        '.ex-ic{width:16px;height:16px;flex:none;display:grid;place-items:center;color:var(--ex-c,var(--text-secondary))}.ex-ic svg{width:15px;height:15px}',
        '.ex-k-folder{--ex-c:var(--fc,#e0a800)}.ex-k-branch{--ex-c:var(--text-primary)}.ex-k-js{--ex-c:#e0a800}.ex-k-html{--ex-c:#e5784d}.ex-k-css{--ex-c:#38bdf8}.ex-k-sql{--ex-c:#c084fc}.ex-k-reroute{--ex-c:var(--text-secondary)}',
        '.ex-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ex-row.off .ex-label{text-decoration:line-through;opacity:.5}',
        '.ex-meta{flex:none;color:var(--text-secondary);opacity:.65;font-size:.68rem}',
        '.ex-dots{display:flex;gap:4px;flex:none}.ex-dot{width:7px;height:7px;border-radius:50%;display:none}',
        '.ex-bp{background:#e5484d}.ex-row[data-bp="1"] .ex-bp{display:block}',
        '.ex-st{background:var(--text-secondary)}.ex-row[data-st="running"] .ex-st,.ex-row[data-st="waiting"] .ex-st,.ex-row[data-st="done"] .ex-st,.ex-row[data-st="error"] .ex-st{display:block}',
        '.ex-row[data-st="running"] .ex-st{background:#2fa66a;animation:exPulse 1s infinite}.ex-row[data-st="waiting"] .ex-st{background:#e0a800}.ex-row[data-st="done"] .ex-st{background:#2fa66a;opacity:.55}.ex-row[data-st="error"] .ex-st{background:#e5484d}',
        '@keyframes exPulse{50%{opacity:.25}}@media (prefers-reduced-motion:reduce){.ex-row[data-st="running"] .ex-st{animation:none}.ex-chev svg{transition:none}}',
        '.ex-empty,.ex-none{margin:8px 2px;color:var(--text-secondary);font:300 .74rem/1.5 var(--font-mono,monospace)}',
        '.ex-tree li.ex-none::before,.ex-tree li.ex-none::after{display:none}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'stExplorerCss'; st.textContent = CSS; document.head.appendChild(st);

    var P = {
        folder: '<path d="M3 7h6l2 2h10v10H3z"/>', branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-12 1-12 6"/>',
        js: '<path d="M9 5c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3M15 5c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3"/>',
        html: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>', css: '<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/>',
        sql: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
        basic: '<rect x="5" y="7" width="14" height="10" rx="1"/>', reroute: '<circle cx="12" cy="12" r="3"/>',
        chev: '<path d="M9 6l6 6-6 6"/>', collapse: '<path d="M4 8h16M8 12h8M10 16h4"/>', expand: '<path d="M4 6h16M4 12h16M4 18h16M12 9v6"/>'
    };
    function svg(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[k] + '</svg>'; }
    function kind(n) { return n.type === 'folder' ? 'folder' : n.type === 'branch' ? 'branch' : n.type === 'database' ? 'sql' : n.type === 'reroute' ? 'reroute' : n.type === 'script' ? (n.lang === 'html' ? 'html' : n.lang === 'css' ? 'css' : 'js') : 'basic'; }
    function ext(n) { return n.type === 'database' ? '.sql' : n.type === 'script' ? (n.lang === 'html' ? '.html' : n.lang === 'css' ? '.css' : n.lang === 'pagejs' ? '.page.js' : '.js') : ''; }
    function count(list) { var c = 0; list.forEach(function (n) { if (n.type !== 'folder') c++; if (n.children) c += count(n.children); }); return c; }
    function collect(list, out) { list.forEach(function (n) { if (n.children) { out.push(n.id); collect(n.children, out); } }); return out; }
    function filt(list, q) {                              // keep a row when it matches, or when something inside it matches
        var out = []; list.forEach(function (n) {
            var self = n.label.toLowerCase().indexOf(q) > -1 || n.type.indexOf(q) > -1 || ext(n).indexOf(q) > -1, kids = n.children ? filt(n.children, q) : null;
            if (!self && !(kids && kids.length)) return;
            var c = {}; Object.keys(n).forEach(function (k) { c[k] = n[k]; }); c.children = n.children ? (self && !(kids && kids.length) ? n.children : kids) : null; out.push(c);
        }); return out;
    }

    /* ---- actions ---- */
    function activate(n) { if (n.type === 'script' || n.type === 'database') G.openCode(n.id); else { SH.setView('graph'); G.reveal(n.id); } }
    function setOpen(li, v) {
        var ul = li.lastChild; if (!ul || ul.tagName !== 'UL') return;
        li.setAttribute('aria-expanded', String(v)); ul.hidden = !v; var r = li.firstChild; if (r && r.dataset) openSet[r.dataset.id] = v;
    }
    function allOpen(v) { keys.forEach(function (k) { openSet[k] = v; }); X.render(host); }
    function onNode(id, fn) { return function () { if (G.reveal(id)) fn(); }; }       // the canvas actions work on the current container, so show it first
    function rowMenu(r, e) {
        var n = r._n, id = n.id, li = r.parentNode;
        if (n.type === 'folder') {
            var ids = (n.children || []).filter(function (c) { return c.type !== 'folder'; }).map(function (c) { return c.id; });
            return M.show([{ head: 'Folder ' + n.label },
                { label: li.getAttribute('aria-expanded') === 'true' ? 'Collapse' : 'Expand', run: function () { setOpen(li, li.getAttribute('aria-expanded') !== 'true'); } },
                { label: 'Select the nodes inside', ic: 'all', disabled: !ids.length, run: function () { SH.setView('graph'); if (G.reveal(ids[0])) G.setSelection(ids); } }], e.clientX, e.clientY);
        }
        var node = G.node(id); if (!node) return;
        M.show([
            { label: M.openLabel(node), key: 'Enter', ic: 'open', run: function () { M.open(id); } },
            { label: 'Show in graph', ic: 'reveal', run: function () { SH.setView('graph'); G.reveal(id); } }, '-',
            { label: 'Copy', key: 'Ctrl+Ins', ic: 'copy', run: onNode(id, function () { G.copy(false); }) },
            { label: 'Cut', key: 'Ctrl+X', ic: 'cut', run: onNode(id, function () { G.copy(true); }) },
            { label: 'Paste next to it', key: 'Ctrl+V', ic: 'paste', disabled: !G.hasClip(), run: onNode(id, function () { G.paste(null); }) },
            { label: 'Duplicate', key: 'Ctrl+D', ic: 'dup', run: onNode(id, function () { G.duplicate(); }) }, '-',
            { label: 'Rename', key: 'F2', ic: 'rename', run: function () { if (G.reveal(id)) M.rename(id, r.getBoundingClientRect()); } },
            { label: 'Delete', key: 'Del', ic: 'del', danger: true, run: onNode(id, function () { G.deleteSelection(); }) }, '-',
            { label: node.enabled ? 'Disable' : 'Enable', key: 'T', ic: 'toggle', run: onNode(id, function () { G.toggleSel(); }) }], e.clientX, e.clientY);
    }

    /* ---- building the tree ---- */
    function build(list, level) {
        var ul = el('ul'); if (level > 1) ul.setAttribute('role', 'group');
        list.forEach(function (n) {
            var li = el('li'), can = !!n.children, r = el('button', 'ex-row ex-k-' + kind(n) + (n.en === false ? ' off' : '')), isOpen = false;
            li.setAttribute('role', 'treeitem'); li.setAttribute('aria-level', String(level));
            r.type = 'button'; r.tabIndex = -1; r.dataset.id = n.id; r.dataset.type = n.type; r._n = n; r.title = n.label + (n.type === 'folder' ? ' (folder)' : ' (' + n.type + ')');
            if (n.type === 'folder') r.style.setProperty('--fc', FC[(n.c || 0) % 6]);
            if (n.bp) r.dataset.bp = '1';
            var ch = el('span', 'ex-chev'); if (can) ch.innerHTML = svg('chev'); r.appendChild(ch);
            var ic = el('span', 'ex-ic'); ic.innerHTML = svg(kind(n)); r.appendChild(ic);
            r.appendChild(el('span', 'ex-label', n.label));
            r.appendChild(el('span', 'ex-meta', can ? '(' + n.children.length + ')' : ext(n)));
            var dots = el('span', 'ex-dots'); dots.appendChild(el('i', 'ex-dot ex-st')); dots.appendChild(el('i', 'ex-dot ex-bp')); r.appendChild(dots);
            r.addEventListener('click', function (e) {
                if (can && (n.type === 'folder' || e.target.closest('.ex-chev'))) setOpen(li, li.getAttribute('aria-expanded') !== 'true'); else activate(n);
            });
            r.addEventListener('dblclick', function () { if (n.type === 'branch') M.open(n.id); });
            li.appendChild(r);
            if (can) {
                isOpen = query ? true : (openSet[n.id] === undefined ? (openSet[n.id] = level <= 2) : openSet[n.id]);
                li.setAttribute('aria-expanded', String(isOpen));
                var sub = n.children.length ? build(n.children, level + 1) : el('ul'); sub.hidden = !isOpen;
                if (!n.children.length) sub.appendChild(el('li', 'ex-none', n.type === 'folder' ? 'Empty folder' : 'Empty branch'));
                li.appendChild(sub);
            }
            ul.appendChild(li);
        });
        return ul;
    }
    function head() {
        var h = el('div', 'ex-head'), t = el('h3', 'st-sub', 'Structure'), c = el('span', 'ex-count'), b1 = el('button', 'ex-ib'), b2 = el('button', 'ex-ib');
        b1.type = b2.type = 'button'; b1.innerHTML = svg('collapse'); b2.innerHTML = svg('expand'); b1.title = 'Collapse all'; b2.title = 'Expand all'; b1.setAttribute('aria-label', 'Collapse all'); b2.setAttribute('aria-label', 'Expand all');
        b1.addEventListener('click', function () { allOpen(false); }); b2.addEventListener('click', function () { allOpen(true); });
        h.appendChild(t); h.appendChild(c); h.appendChild(b1); h.appendChild(b2);
        var q = el('input', 'ex-q'); q.type = 'search'; q.maxLength = 40; q.placeholder = 'Filter nodes...'; q.setAttribute('aria-label', 'Filter the Explorer');
        q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { query = q.value.trim().toLowerCase(); X.render(host); }, 120); });
        q.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { q.value = ''; query = ''; X.render(host); } });
        var body = el('div'); return { head: h, count: c, q: q, body: body };
    }
    X.render = function (h) {
        host = h || host;
        if (!G.isOpen()) { host.textContent = ''; ui = null; return; }
        if (!ui || !host.contains(ui.head)) { ui = head(); host.textContent = ''; host.appendChild(ui.head); host.appendChild(ui.q); host.appendChild(ui.body); }
        var t = G.tree(), n = count(t); keys = collect(t, []); ui.count.textContent = n + (n === 1 ? ' node' : ' nodes'); ui.body.textContent = '';
        var shown = query ? filt(t, query) : t;
        if (!shown.length) { ui.body.appendChild(el('p', 'ex-empty', query ? 'Nothing matches "' + query + '".' : 'No nodes yet. Press N, then click the canvas. Right-click the canvas for more.')); return; }
        var tree = build(shown, 1); tree.className = 'ex-tree'; tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', 'Project structure'); ui.body.appendChild(tree);
        var first = tree.querySelector('.ex-row'); if (first) first.tabIndex = 0; lastSig = ''; live();
    };

    /* ---- keyboard: arrows move, Right/Left open and close, Enter opens, F2 renames ---- */
    function visibleRows() { return Array.prototype.filter.call(host.querySelectorAll('.ex-row'), function (b) { return !b.closest('ul[hidden]'); }); }
    function focusRow(b) { if (!b) return; Array.prototype.forEach.call(host.querySelectorAll('.ex-row[tabindex="0"]'), function (x) { x.tabIndex = -1; }); b.tabIndex = 0; b.focus(); }
    host.addEventListener('keydown', function (e) {
        var r = e.target.closest && e.target.closest('.ex-row'); if (!r) return;
        var v = visibleRows(), i = v.indexOf(r), li = r.parentNode, hasSub = li.lastChild && li.lastChild.tagName === 'UL', open = li.getAttribute('aria-expanded') === 'true';
        if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(v[i + 1]); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(v[i - 1]); }
        else if (e.key === 'Home') { e.preventDefault(); focusRow(v[0]); } else if (e.key === 'End') { e.preventDefault(); focusRow(v[v.length - 1]); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); if (hasSub && !open) setOpen(li, true); else if (hasSub) focusRow(li.lastChild.querySelector('.ex-row')); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); if (hasSub && open) setOpen(li, false); else { var pl = li.parentNode.parentNode; if (pl && pl.tagName === 'LI') focusRow(pl.firstChild); } }
        else if (e.key === 'F2' && r._n.type !== 'folder') { e.preventDefault(); if (G.reveal(r._n.id)) M.rename(r._n.id, r.getBoundingClientRect()); }
    });
    host.addEventListener('contextmenu', function (e) {
        var r = e.target.closest && e.target.closest('.ex-row');
        if (e.target.closest && e.target.closest('input')) return;
        e.preventDefault();
        if (r) return rowMenu(r, e);
        M.show([{ label: 'Collapse all', run: function () { allOpen(false); } }, { label: 'Expand all', run: function () { allOpen(true); } }], e.clientX, e.clientY);
    });

    /* ---- live: status dots, breakpoints, enabled state, and the row that matches the canvas selection ---- */
    function live() {
        if (document.hidden || !ui || !host.offsetParent) return;
        var sel = G.selection(), sig = sel.join(','), first = null;
        Array.prototype.forEach.call(host.querySelectorAll('.ex-row'), function (b) {
            if (b.dataset.type === 'folder') return;
            var n = G.node(b.dataset.id); if (!n) return;
            var s = n.status || 'idle', cur = sel.indexOf(n.id) > -1;
            if (b.dataset.st !== s) b.dataset.st = s;
            if ((b.dataset.bp === '1') !== !!n.bp) { if (n.bp) b.dataset.bp = '1'; else delete b.dataset.bp; }
            b.classList.toggle('off', !n.enabled);
            if (cur !== (b.getAttribute('aria-current') === 'true')) { if (cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
            if (cur && !first) first = b;
        });
        if (sig !== lastSig) {                            // the selection changed: open the folders around it and bring it into view
            lastSig = sig;
            if (first) { var p = first.parentNode.parentNode; while (p && p !== host) { if (p.tagName === 'UL' && p.hidden) setOpen(p.parentNode, true); p = p.parentNode; } if (first.scrollIntoView) first.scrollIntoView({ block: 'nearest' }); }
        }
    }
    setInterval(live, 400);

    G.ext.explorer = { load: function () { openSet = {}; query = ''; lastSig = ''; if (ui && ui.q) ui.q.value = ''; } };      // nothing here is saved in the project
    X.render(host);
})();
