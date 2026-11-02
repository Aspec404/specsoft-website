/* SPECSOFT® Studio, PHASE 7c: right-click menus. A small menu engine (StudioMenu.show / ask) plus the menus for the canvas:
   node (Open, Copy, Cut, Paste, Rename, Delete ...), connection, frame and empty canvas. Also the clipboard shortcuts.
   Needs studio-graph.js (7c) and, in studio.html, <script src="studio-menu.js"> after studio-stools.js and before studio-explorer.js.
   The Explorer (studio-explorer.js) reuses StudioMenu and the helpers below. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var G = window.StudioGraph, E = window.StudioEngine, canvas = document.getElementById('stCanvas');
    if (!G || !canvas) return;
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function say(sev, src, msg, id) { G.log(sev, src, msg, id); }
    var M = window.StudioMenu = {}, cur = null;

    var CSS = [
        '.sm-menu{position:fixed;z-index:1000;min-width:220px;max-width:320px;max-height:calc(100vh - 16px);overflow:auto;padding:4px;background:var(--bg-card,#101010);border:1px solid var(--border-hover,#666);box-shadow:0 10px 30px rgba(0,0,0,.5);font:400 .78rem var(--font-mono,monospace);color:var(--text-primary)}',
        '.sm-i{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:7px 10px;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
        '.sm-i:hover:not(:disabled),.sm-i:focus-visible{background:rgba(127,127,127,.22);outline:none}.sm-i:disabled{opacity:.38;cursor:default}',
        '.sm-i.danger{color:#e5484d}.sm-i svg{width:15px;height:15px;flex:none;opacity:.85}.sm-i .sm-s{width:15px;flex:none}',
        '.sm-k{margin-left:auto;padding-left:18px;color:var(--text-secondary);font-size:.68rem;white-space:nowrap}',
        '.sm-sep{height:1px;margin:4px 6px;background:var(--border-subtle,#333)}.sm-h{padding:6px 10px 3px;color:var(--text-secondary);font-size:.64rem;letter-spacing:.08em;text-transform:uppercase}',
        '.sm-ask{position:fixed;z-index:1001;padding:8px;background:var(--bg-card,#101010);border:1px solid var(--text-primary);box-shadow:0 10px 30px rgba(0,0,0,.5);font:400 .72rem var(--font-mono,monospace);color:var(--text-secondary)}',
        '.sm-ask input{display:block;width:220px;box-sizing:border-box;margin-top:5px;padding:6px 8px;background:var(--bg-base,#000);color:var(--text-primary);border:1px solid var(--border-subtle,#333);font:inherit;font-size:.82rem;user-select:text;-webkit-user-select:text}',
        '.st-node.is-cut{opacity:.45;border-style:dashed}'
    ].join('\n');
    var st = document.createElement('style'); st.id = 'stMenuCss'; st.textContent = CSS; document.head.appendChild(st);

    var IC = {
        open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/>',
        cut: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>', paste: '<rect x="5" y="5" width="14" height="16" rx="1"/><path d="M9 5V3h6v2M9 12h6M9 16h6"/>',
        rename: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>', del: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
        dup: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4M14 11v6M11 14h6"/>', toggle: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.5"/>',
        bp: '<circle cx="12" cy="12" r="5"/>', group: '<path stroke-dasharray="3 2" d="M3 3h18v18H3z"/><rect x="6" y="6" width="5" height="5"/><rect x="13" y="13" width="5" height="5"/>',
        inspect: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M10 9v4M10 6.8v.2"/>', pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>', run: '<path d="M7 4l13 8-13 8z"/>',
        node: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M12 9.5v5M9.5 12h5"/>', branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-12 1-12 6"/>',
        all: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/>', fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
        reroute: '<path d="M3 12h5M16 12h5"/><circle cx="12" cy="12" r="3"/>', wait: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>', reveal: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>',
        chevron: '<path d="M9 6l6 6-6 6"/>'
    };
    M.icon = function (id) { return IC[id] ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[id] + '</svg>' : ''; };

    /* ---- the menu engine ---- */
    M.close = function () {
        if (!cur) return; var c = cur; cur = null;
        document.removeEventListener('pointerdown', c.down, true); document.removeEventListener('keydown', c.key, true);
        window.removeEventListener('resize', M.close); window.removeEventListener('blur', M.close); document.removeEventListener('scroll', M.close, true);
        c.el.remove(); if (c.back && c.back.focus) try { c.back.focus(); } catch (e) {}
    };
    M.isOpen = function () { return !!cur; };
    M.show = function (items, x, y) {
        M.close();
        var m = el('div', 'sm-menu'); m.setAttribute('role', 'menu');
        items.forEach(function (it) {
            if (it === '-') { m.appendChild(el('div', 'sm-sep')); return; }
            if (it.head) { m.appendChild(el('div', 'sm-h', it.head)); return; }
            var b = el('button', 'sm-i' + (it.danger ? ' danger' : '')); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.disabled = !!it.disabled;
            var ic = el('span', 'sm-s'); if (it.ic) ic.innerHTML = M.icon(it.ic); b.appendChild(ic); b.appendChild(el('span', '', it.label)); if (it.key) b.appendChild(el('span', 'sm-k', it.key));
            b.addEventListener('click', function () { if (it.disabled) return; M.close(); it.run(); });
            m.appendChild(b);
        });
        document.body.appendChild(m);
        var r = m.getBoundingClientRect(), W = window.innerWidth || 1000, H = window.innerHeight || 800;
        m.style.left = Math.max(8, Math.min(x, W - r.width - 8)) + 'px'; m.style.top = Math.max(8, Math.min(y, H - r.height - 8)) + 'px';
        var btns = function () { return Array.prototype.filter.call(m.querySelectorAll('.sm-i'), function (b) { return !b.disabled; }); };
        var c = cur = { el: m, back: document.activeElement,
            down: function (e) { if (!m.contains(e.target)) M.close(); },
            key: function (e) {
                var b = btns(), i = b.indexOf(document.activeElement);
                if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); M.close(); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); if (b.length) b[(i + 1) % b.length].focus(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (b.length) b[(i - 1 + b.length) % b.length].focus(); }
                else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); if (b.length) b[e.key === 'Home' ? 0 : b.length - 1].focus(); }
            } };
        document.addEventListener('pointerdown', c.down, true); document.addEventListener('keydown', c.key, true);
        window.addEventListener('resize', M.close); window.addEventListener('blur', M.close); document.addEventListener('scroll', M.close, true);
        var f = btns()[0]; if (f) f.focus();
    };
    /* a small "type a new name" box next to a rectangle (a node, a frame bar, an Explorer row) */
    M.ask = function (rect, value, max, label, done) {
        M.close(); var box = el('div', 'sm-ask'), inp = el('input'), fin = false; box.appendChild(el('span', '', label)); inp.type = 'text'; inp.maxLength = max; inp.value = value; inp.setAttribute('aria-label', label); box.appendChild(inp);
        document.body.appendChild(box);
        var W = window.innerWidth || 1000, H = window.innerHeight || 800, r = box.getBoundingClientRect();
        box.style.left = Math.max(8, Math.min(rect.left, W - r.width - 8)) + 'px'; box.style.top = Math.max(8, Math.min(rect.bottom + 6, H - r.height - 8)) + 'px';
        function end(ok) { if (fin) return; fin = true; var v = inp.value; box.remove(); if (ok) done(v); }
        inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
        inp.addEventListener('blur', function () { end(true); }); inp.focus(); inp.select();
    };

    /* ---- shared actions (the Explorer uses these too) ---- */
    function idle() { var t = ($('stRunState') || {}).textContent || ''; return !/running|paused/.test(t); }
    function nodeRect(id) {
        var all = canvas.querySelectorAll('.st-node'), e = Array.prototype.filter.call(all, function (x) { return x.dataset.id === id; })[0];
        if (e) return e.getBoundingClientRect(); var r = canvas.getBoundingClientRect(); return { left: r.left + 40, top: r.top + 40, bottom: r.top + 60, right: r.left + 200 };
    }
    M.open = function (id) {                              // "Open": a branch opens its graph, a script or SQL node opens the Code Editor, any other node shows its details
        var n = G.node(id); if (!n) return;
        if (n.type === 'branch') { if (window.StudioShell) window.StudioShell.setView('graph'); G.reveal(id); G.enterBranch(id); }
        else if (n.type === 'script' || n.type === 'database') G.openCode(id);
        else { if (window.StudioShell) window.StudioShell.setView('graph'); G.reveal(id); G.onInspect(id); }
    };
    M.openLabel = function (n) { return n.type === 'branch' ? 'Open branch' : (n.type === 'script' || n.type === 'database') ? 'Open in Code Editor' : 'Open details'; };
    M.rename = function (id, rect) {
        var n = G.node(id); if (!n) return;
        M.ask(rect || nodeRect(id), n.label, 20, 'Rename ' + n.label, function (v) { G.rename(id, v); });
    };
    function pulseFrom(sel) { var o = G.pulse(sel); say('info', 'pulse', o.length ? 'Pulse (dry run, nothing executed): ' + o.join(' > ') : 'Pulse: no nodes to send a signal through'); }
    function runFrom(sel) {
        if (!E || typeof E.spawn !== 'function') return say('warn', 'run', 'Run from here needs the updated studio-engine.js');
        if (E.isActive()) return say('warn', 'run', 'A run is already active. Stop it first.');
        var sub = G.runGraph(sel); say('info', 'run', 'Starting from the selection: ' + sub.nodes.length + ' node(s)'); E.start({ graph: sub });
    }

    /* ---- the canvas menus ---- */
    function nodeMenu(id, e, at) {
        var sel = G.selection(); if (sel.indexOf(id) < 0) { G.setSelection([id]); sel = G.selection(); }
        var multi = sel.length > 1, n = G.node(id); if (!n) return;
        var items = [
            { label: M.openLabel(n), key: 'Enter', ic: 'open', run: function () { M.open(id); } }, '-',
            { label: multi ? 'Copy ' + sel.length + ' nodes' : 'Copy', key: 'Ctrl+Ins', ic: 'copy', run: function () { G.copy(false); } },
            { label: 'Cut', key: 'Ctrl+X', ic: 'cut', run: function () { G.copy(true); } },
            { label: 'Paste here', key: 'Ctrl+V', ic: 'paste', disabled: !G.hasClip(), run: function () { G.paste(at); } },
            { label: 'Duplicate', key: 'Ctrl+D', ic: 'dup', run: function () { G.duplicate(); } }, '-',
            { label: 'Rename', key: 'F2', ic: 'rename', run: function () { M.rename(id); } },
            { label: multi ? 'Delete ' + sel.length + ' nodes' : 'Delete', key: 'Del', ic: 'del', danger: true, run: function () { G.deleteSelection(); } }, '-',
            { label: n.enabled ? (multi ? 'Disable selected' : 'Disable') : (multi ? 'Enable selected' : 'Enable'), key: 'T', ic: 'toggle', run: function () { G.toggleSel(); } },
            { label: n.bp ? 'Remove breakpoint' : 'Set breakpoint', ic: 'bp', run: function () { G.toggleBp(id); } }
        ];
        if (multi) items.push({ label: 'Group', key: 'Ctrl+G', ic: 'group', run: function () { G.group(); } });
        if (n.group) items.push({ label: 'Ungroup', key: 'Ctrl+Shift+G', ic: 'group', run: function () { G.ungroup(); } });
        items.push('-', { label: 'Inspect', ic: 'inspect', run: function () { G.onInspect(id); } }, { label: 'Pulse from here', key: 'P', ic: 'pulse', run: function () { pulseFrom(sel); } });
        if (E && typeof E.spawn === 'function') items.push({ label: 'Run from here', ic: 'run', disabled: !idle(), run: function () { runFrom(sel); } });
        M.show(items, e.clientX, e.clientY);
    }
    function wireMenu(wid, e, at) {
        M.show([{ head: 'Connection' },
            { label: 'Insert reroute here', ic: 'reroute', run: function () { G.splice(wid, at, 'reroute'); } },
            { label: 'Insert wait here', ic: 'wait', run: function () { G.splice(wid, at, 'wait'); } }, '-',
            { label: 'Delete connection', ic: 'del', danger: true, run: function () { G.removeWire(wid); } }], e.clientX, e.clientY);
    }
    function frameMenu(fid, bar, e) {
        M.show([{ head: 'Frame' },
            { label: 'Rename frame', ic: 'rename', run: function () { M.ask(bar.getBoundingClientRect(), G.frameLabel(fid) || '', 40, 'Rename frame', function (v) { G.renameFrame(fid, v); }); } }, '-',
            { label: 'Delete frame', ic: 'del', danger: true, run: function () { G.removeFrame(fid); } }], e.clientX, e.clientY);
    }
    function emptyMenu(e, at) {
        M.show([
            { label: 'New node here', ic: 'node', run: function () { G.addAt(at, 'basic'); } },
            { label: 'New branch here', ic: 'branch', run: function () { G.addAt(at, 'branch'); } }, '-',
            { label: 'Paste here', key: 'Ctrl+V', ic: 'paste', disabled: !G.hasClip(), run: function () { G.paste(at); } },
            { label: 'Select all', key: 'Ctrl+A', ic: 'all', run: function () { G.selectAll(); } }, '-',
            { label: 'Undo', key: 'Ctrl+Z', ic: 'undo', disabled: !(G.canUndo && G.canUndo()) || !idle(), run: function () { G.undo(); } },
            { label: 'Redo', key: 'Ctrl+Y', ic: 'redo', disabled: !(G.canRedo && G.canRedo()) || !idle(), run: function () { G.redo(); } }, '-',
            { label: 'Fit view', key: 'V', ic: 'fit', run: function () { if (G.fit) G.fit(); } }], e.clientX, e.clientY);
    }
    /* a right-click must never reach the tools: with the Delete tool on it would delete what you right-clicked */
    canvas.addEventListener('pointerdown', function (e) { if (e.button === 2 && G.isOpen()) e.stopPropagation(); }, true);
    canvas.addEventListener('contextmenu', function (e) {
        if (!G.isOpen()) return;
        if (e.target.closest('.st-pop,.st-find,.st-inspect,.st-crumbs')) return;       // panels keep the normal browser menu (copy/paste in their inputs)
        e.preventDefault();
        var ne = e.target.closest('.st-node'), fb = e.target.closest('.st-frame-bar'), wg = e.target.closest('g[data-id]'), at = G.worldAt(e.clientX, e.clientY);
        if (ne) nodeMenu(ne.dataset.id, e, at); else if (fb) frameMenu(fb.parentNode.dataset.id, fb, e); else if (wg) wireMenu(wg.dataset.id, e, at); else emptyMenu(e, at);
    });

    /* ---- clipboard and open/rename shortcuts (graph view only, never while typing) ---- */
    document.addEventListener('keydown', function (e) {
        if (cur || e.altKey || !G.isOpen() || $('stApp').dataset.mode !== 'graph') return;
        var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        var ctl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase(), sel = G.selection();
        if (ctl && !e.shiftKey && k === 'x') { e.preventDefault(); G.copy(true); }
        else if (ctl && !e.shiftKey && k === 'v') { e.preventDefault(); G.paste(null); }
        else if (ctl && !e.shiftKey && k === 'insert') { e.preventDefault(); G.copy(false); }
        else if (!ctl && e.shiftKey && k === 'insert') { e.preventDefault(); G.paste(null); }
        else if (!ctl && !e.shiftKey && k === 'f2' && sel.length) { e.preventDefault(); M.rename(sel[sel.length - 1]); }
        else if (!ctl && !e.shiftKey && k === 'enter' && sel.length === 1 && !/^(BUTTON|A|SUMMARY)$/.test(t ? t.tagName : '')) { e.preventDefault(); M.open(sel[0]); }
    });
})();
