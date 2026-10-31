/* SPECSOFT® Studio, PHASE 2: node graph canvas (nodes, connections, pan/zoom,
   properties, validation). Persistence is done by studio.js via get()/load(). */
(function () {
    'use strict';
    var W = 148, H = 52, MAX_NODES = 200, NS = 'http://www.w3.org/2000/svg';
    var api = window.StudioGraph = { log: function () {}, onChange: function () {}, onReset: function () {}, openCode: function () {}, ext: {} };
    var G = { nodes: [], connections: [] }, ROOT = G, path = [], V = { x: 40, y: 40, k: 1 };
    var tool = 'select', sel = null, pend = null, open = false, drag = null, space = false;
    function $(id) { return document.getElementById(id); }
    var canvas = $('stCanvas');

    /* ---- DOM: world (pan/zoom) holds the wire layer and the node layer ---- */
    var world = document.createElement('div'); world.className = 'st-world';
    var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'st-wires');
    svg.innerHTML = '<defs><marker id="stArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>';
    var layer = document.createElementNS(NS, 'g'); svg.appendChild(layer);
    var nodesEl = document.createElement('div');
    world.appendChild(svg); world.appendChild(nodesEl); canvas.appendChild(world);
    var hint = document.createElement('p'); hint.className = 'st-hint2'; hint.hidden = true;
    hint.textContent = 'Empty graph. Press N, then click the canvas to place your first node.';
    canvas.appendChild(hint);

    /* ---- tool registry (Category and Branch arrive in Phase 4) ---- */
    var I = {
        select: '<path d="M5 3l14 8-6 2-2 6z"/>', move: '<path d="M12 2v20M2 12h20"/>',
        connect: '<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10"/>',
        cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20"/>',
        del: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>', node: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
        cat: '<path d="M3 7h6l2 2h10v10H3z"/>', branch: '<path d="M6 3v12a4 4 0 0 0 4 4h8M6 9a4 4 0 0 0 4 4h8"/>'
    };
    var TOOLS = [
        ['select', 'Select', 'V', I.select], ['move', 'Move canvas', 'H', I.move], ['connect', 'Connect', 'C', I.connect],
        ['cut', 'Cut connection', 'X', I.cut], ['delete', 'Delete', 'D', I.del], ['create', 'Create node', 'N', I.node],
        [null, 'Create category', 'coming later', I.cat], ['createbranch', 'Create branch', 'B', I.branch]
    ];
    TOOLS.forEach(function (t) {
        var b = document.createElement('button'); b.type = 'button';
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + t[3] + '</svg>';
        b.title = t[1] + ' (' + t[2] + ')'; b.setAttribute('aria-label', t[1]);
        if (t[0]) { b.dataset.tool = t[0]; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', function () { setTool(t[0]); }); }
        else b.setAttribute('aria-disabled', 'true');
        $('stTools').appendChild(b);
    });

    function setTool(t) {
        tool = t; pend = null; canvas.dataset.tool = t;
        Array.prototype.forEach.call($('stTools').querySelectorAll('[data-tool]'), function (b) {
            b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false');
        });
        render();
    }

    /* ---- graph model ---- */
    function byId(id) { for (var i = 0; i < G.nodes.length; i++) if (G.nodes[i].id === id) return G.nodes[i]; return null; }
    function uid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    function nextLabel(pre) {
        var m = 0, re = new RegExp('^' + pre + '(\\d+)$'); G.nodes.forEach(function (n) { var r = re.exec(n.label); if (r) m = Math.max(m, +r[1]); });
        return pre + (m + 1);
    }
    function reaches(a, b, seen) {                       // is b reachable from a?
        if (a === b) return true; seen = seen || {}; if (seen[a]) return false; seen[a] = 1;
        return G.connections.some(function (c) { return c.from === a && reaches(c.to, b, seen); });
    }
    function addNode(p, type) {
        if (G.nodes.length >= MAX_NODES) { api.log('warn', 'graph', 'Node limit reached (' + MAX_NODES + ')'); return; }
        var n = { id: uid(), label: nextLabel(type === 'branch' ? 'B' : 'N'), type: type || 'basic', x: Math.round(p.x - W / 2), y: Math.round(p.y - H / 2), enabled: true, status: 'idle', config: defaults(type || 'basic') };
        G.nodes.push(n); sel = n.id; api.log('ok', 'graph', 'Created ' + n.label); changed();
    }
    function connect(a, b) {
        var A = byId(a), B = byId(b);
        if (a === b) return api.log('warn', 'graph', 'A node cannot connect to itself');
        if (G.connections.some(function (c) { return c.from === a && c.to === b; })) return api.log('warn', 'graph', A.label + ' is already connected to ' + B.label);
        if (reaches(b, a)) return api.log('warn', 'graph', 'Rejected ' + A.label + ' to ' + B.label + ': it would create a loop');
        G.connections.push({ id: uid(), from: a, to: b }); api.log('ok', 'graph', 'Connected ' + A.label + ' to ' + B.label); changed();
    }
    function removeNode(id) {
        var n = byId(id); if (!n) return;
        G.nodes = G.nodes.filter(function (x) { return x.id !== id; });
        G.connections = G.connections.filter(function (c) { return c.from !== id && c.to !== id; });
        if (sel === id) sel = null; api.log('warn', 'graph', 'Deleted ' + n.label); changed();
    }
    function removeWire(id) {
        G.connections = G.connections.filter(function (c) { return c.id !== id; }); api.log('warn', 'graph', 'Removed a connection'); changed();
    }
    function changed() { render(); api.onChange(); }

    /* ---- rendering ---- */
    function applyView() { world.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(' + V.k + ')'; }
    function drawWires() {
        layer.textContent = '';
        G.connections.forEach(function (c) {
            var a = byId(c.from), b = byId(c.to); if (!a || !b) return;
            var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, dx = Math.max(40, Math.abs(x2 - x1) / 2);
            var d = 'M' + x1 + ' ' + y1 + 'C' + (x1 + dx) + ' ' + y1 + ',' + (x2 - dx) + ' ' + y2 + ',' + x2 + ' ' + y2;
            var g = document.createElementNS(NS, 'g'); g.setAttribute('data-id', c.id);
            var hit = document.createElementNS(NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'st-hit');
            var vis = document.createElementNS(NS, 'path'); vis.setAttribute('d', d); vis.setAttribute('class', 'st-wire'); vis.setAttribute('marker-end', 'url(#stArrow)');
            g.appendChild(hit); g.appendChild(vis); layer.appendChild(g);
        });
    }
    function render() {
        nodesEl.textContent = '';
        G.nodes.forEach(function (n) {
            var d = document.createElement('div');
            d.className = 'st-node' + (n.id === sel ? ' sel' : '') + (n.id === pend ? ' pend' : '') + (n.enabled ? '' : ' off') + ' s-' + n.status + ' t-' + n.type;
            d.dataset.id = n.id; d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
            var i = document.createElement('i'); i.className = 'st-port in';
            var o = document.createElement('i'); o.className = 'st-port out';
            var s = document.createElement('strong'); s.textContent = n.label;
            var t = document.createElement('small'); t.textContent = (n.type === 'branch' ? 'branch, ' + n.config.sub.nodes.length + ' nodes' : n.type === 'script' ? 'script, ' + ({ javascript: 'js' }[n.config.lang] || n.config.lang) : n.type) + (n.enabled ? '' : ' (disabled)');
            d.appendChild(i); d.appendChild(s); d.appendChild(t); d.appendChild(o); nodesEl.appendChild(d);
        });
        drawWires(); applyView(); hint.hidden = !(open && G.nodes.length === 0); drawCrumbs(); renderProps();
    }

    /* ---- properties panel ---- */
    function row(dl, name, valueNode) {
        var dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = name; if (typeof valueNode === 'string') dd.textContent = valueNode; else dd.appendChild(valueNode);
        dl.appendChild(dt); dl.appendChild(dd);
    }
    function renderProps() {
        var dl = $('stProps'); dl.textContent = ''; var n = byId(sel);
        if (!n) return row(dl, 'Nothing selected', 'Pick the Select tool and click a node to edit it.');
        var name = document.createElement('input'); name.type = 'text'; name.maxLength = 20; name.value = n.label; name.setAttribute('aria-label', 'Node label');
        name.addEventListener('input', function () {
            n.label = name.value.trim() || n.label;
            var el = nodesEl.querySelector('[data-id="' + n.id + '"] strong'); if (el) el.textContent = n.label; api.onChange();
        });
        var en = document.createElement('input'); en.type = 'checkbox'; en.checked = n.enabled; en.setAttribute('aria-label', 'Enabled');
        en.addEventListener('change', function () { n.enabled = en.checked; changed(); });
        var ins = G.connections.filter(function (c) { return c.to === n.id; }).length, outs = G.connections.filter(function (c) { return c.from === n.id; }).length;
        row(dl, 'Label', name); row(dl, 'Enabled', en); row(dl, 'Type', typeSelect(n)); extraProps(dl, n); var stEl = document.createElement('span'); stEl.className = 'st-status'; stEl.textContent = n.status; row(dl, 'Status', stEl);
        row(dl, 'Connections', ins + ' in, ' + outs + ' out'); row(dl, 'Position', n.x + ', ' + n.y); row(dl, 'Internal id', n.id);
    }

    /* ---- pointer, wheel and keyboard ---- */
    function toWorld(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - V.x) / V.k, y: (e.clientY - r.top - V.y) / V.k }; }
    canvas.addEventListener('pointerdown', function (e) {
        if (!open || e.target.closest('.st-crumbs')) return;
        var nodeEl = e.target.closest('.st-node'), wireG = e.target.closest('g[data-id]');
        if (e.button === 1 || tool === 'move' || space) { drag = { t: 'pan', sx: e.clientX, sy: e.clientY, vx: V.x, vy: V.y }; canvas.setPointerCapture(e.pointerId); return; }
        if (wireG) { if (tool === 'cut' || tool === 'delete') removeWire(wireG.getAttribute('data-id')); return; }
        if (nodeEl) {
            var id = nodeEl.dataset.id, n = byId(id);
            if (tool === 'select') {
                sel = id; var p = toWorld(e); drag = { t: 'node', id: id, ox: p.x - n.x, oy: p.y - n.y, moved: false };
                canvas.setPointerCapture(e.pointerId); render();
            } else if (tool === 'connect') {
                if (!pend) pend = id; else { if (pend !== id) connect(pend, id); pend = null; } render();
            } else if (tool === 'delete') removeNode(id);
            return;
        }
        if (tool === 'create' || tool === 'createbranch') addNode(toWorld(e), tool === 'createbranch' ? 'branch' : 'basic');
        else { sel = null; pend = null; drag = { t: 'pan', sx: e.clientX, sy: e.clientY, vx: V.x, vy: V.y }; canvas.setPointerCapture(e.pointerId); render(); }
    });
    canvas.addEventListener('pointermove', function (e) {
        if (!drag) return;
        if (drag.t === 'pan') { V.x = drag.vx + e.clientX - drag.sx; V.y = drag.vy + e.clientY - drag.sy; applyView(); return; }
        var n = byId(drag.id), p = toWorld(e); if (!n) return;
        n.x = Math.round(p.x - drag.ox); n.y = Math.round(p.y - drag.oy); drag.moved = true;
        var el = nodesEl.querySelector('[data-id="' + n.id + '"]'); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
        drawWires();
    });
    function endDrag() { var d = drag; drag = null; if (d && d.t === 'node' && d.moved) changed(); }
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) {
        if (!open) return; e.preventDefault();
        var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        var k = Math.min(2.5, Math.max(0.3, V.k * Math.exp(-e.deltaY * 0.0015))), f = k / V.k;
        V.x = mx - (mx - V.x) * f; V.y = my - (my - V.y) * f; V.k = k; applyView();
    }, { passive: false });
    document.addEventListener('keydown', function (e) {
        if (!open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        var map = { v: 'select', h: 'move', c: 'connect', x: 'cut', d: 'delete', n: 'create', b: 'createbranch' }, k = e.key.toLowerCase();
        if (map[k]) setTool(map[k]);
        else if (k === ' ') { space = true; e.preventDefault(); }
        else if ((k === 'delete' || k === 'backspace') && sel) removeNode(sel);
        else if (k === 'escape') setTool('select');
    });
    document.addEventListener('keyup', function (e) { if (e.key === ' ') space = false; });

    /* ---- Phase 4: node config, branches, script editor ---- */
    var MAX_DEPTH = 5, TYPES = ['basic', 'script', 'branch', 'database'], LANGS = ['javascript', 'html', 'css'];
    var TEMPLATE = "// input = results of the nodes connected into this one\nstudio.log('Hello from a script node');\nawait studio.delay(500);\nreturn { ok: true };";
    var TEMPLATES = { javascript: TEMPLATE, html: '<!-- HTML for your project -->\n<h1>Hello from SPECSOFT Studio</h1>', css: '/* CSS for your project */\nbody { font-family: sans-serif; }' };
    var SQL_TEMPLATE = "-- Runs against this project's database\nCREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT);\nINSERT INTO notes (text) VALUES ('hello');\nSELECT * FROM notes;";
    var crumbs = document.createElement('nav'); crumbs.className = 'st-crumbs'; crumbs.setAttribute('aria-label', 'Branch path'); crumbs.hidden = true; canvas.appendChild(crumbs);
    function clamp(v, lo, hi, d) { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; }
    function defaults(type) {
        var c = { aDelay: 0, eDelay: 0, oDelay: 0, unit: 'ms', timeout: 5000, mode: 'inline', code: type === 'script' ? TEMPLATE : '', lang: 'javascript', sql: type === 'database' ? SQL_TEMPLATE : '', waitEvent: '' };
        if (type === 'branch') c.sub = { nodes: [], connections: [] }; return c;
    }
    function cleanGraph(g, depth) {                      // rebuilds a graph from saved/untrusted data: only known fields survive
        g = g || {}; var ids = {};
        var nodes = (Array.isArray(g.nodes) ? g.nodes : []).slice(0, MAX_NODES).map(function (n) {
            n = n || {}; var type = TYPES.indexOf(n.type) > -1 ? n.type : 'basic', c = n.config || {}; ids[n.id] = 1;
            var cfg = { aDelay: clamp(c.aDelay, 0, 600000, 0), eDelay: clamp(c.eDelay, 0, 600000, 0), oDelay: clamp(c.oDelay, 0, 600000, 0), unit: c.unit === 's' ? 's' : 'ms',
                timeout: clamp(c.timeout, 100, 30000, 5000), mode: c.mode === 'independent' ? 'independent' : 'inline', code: type === 'script' ? String(c.code || '').slice(0, 20000) : '', lang: LANGS.indexOf(c.lang) > -1 ? c.lang : 'javascript',
                sql: type === 'database' ? String(c.sql || '').slice(0, 20000) : '', waitEvent: /^[A-Za-z0-9_-]{1,20}$/.test(c.waitEvent || '') ? c.waitEvent : '' };
            if (type === 'branch') cfg.sub = depth < MAX_DEPTH ? cleanGraph(c.sub, depth + 1) : { nodes: [], connections: [] };
            return { id: String(n.id), label: String(n.label || 'N').slice(0, 20), type: type, x: num(n.x), y: num(n.y), enabled: n.enabled !== false, status: 'idle', config: cfg };
        });
        var conns = (Array.isArray(g.connections) ? g.connections : []).filter(function (c) { return c && ids[c.from] && ids[c.to] && c.from !== c.to; })
            .map(function (c) { return { id: String(c.id || uid()), from: String(c.from), to: String(c.to) }; });
        return { nodes: nodes, connections: conns };
    }
    function findAny(id, g) {
        g = g || ROOT;
        for (var i = 0; i < g.nodes.length; i++) { var n = g.nodes[i]; if (n.id === id) return n; if (n.config && n.config.sub) { var r = findAny(id, n.config.sub); if (r) return r; } }
        return null;
    }
    function eachNode(g, fn) { g.nodes.forEach(function (n) { fn(n); if (n.config && n.config.sub) eachNode(n.config.sub, fn); }); }
    function enter(n) {
        if (!n || n.type !== 'branch') return;
        if (path.length >= MAX_DEPTH) return api.log('warn', 'graph', 'Branch nesting limit reached (' + MAX_DEPTH + ')');
        path.push(n); G = n.config.sub; sel = null; pend = null; V = { x: 40, y: 40, k: 1 }; render();
    }
    function goUp(d) { path.length = d; G = d ? path[d - 1].config.sub : ROOT; sel = null; pend = null; V = { x: 40, y: 40, k: 1 }; render(); }
    function drawCrumbs() {
        crumbs.textContent = ''; crumbs.hidden = !open;
        var items = [['Root', 0]].concat(path.map(function (n, i) { return [n.label, i + 1]; }));
        items.forEach(function (it, i) {
            var b = document.createElement('button'); b.type = 'button'; b.textContent = it[0];
            if (i === items.length - 1) b.setAttribute('aria-current', 'true');
            b.addEventListener('click', function () { goUp(it[1]); }); crumbs.appendChild(b);
            if (i < items.length - 1) { var s = document.createElement('span'); s.textContent = '/'; crumbs.appendChild(s); }
        });
    }
    canvas.addEventListener('dblclick', function (e) { var el = e.target.closest('.st-node'); if (open && el) enter(byId(el.dataset.id)); });

    function typeSelect(n) {
        var s = document.createElement('select'); s.setAttribute('aria-label', 'Node type');
        TYPES.forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t === 'script' ? 'script (JS, HTML, CSS)' : t; if (t === n.type) o.selected = true; s.appendChild(o); });
        s.addEventListener('change', function () {
            var t = s.value;
            if (n.type === 'branch' && n.config.sub.nodes.length && t !== 'branch') { api.log('warn', 'graph', 'Empty ' + n.label + ' before changing its type'); s.value = n.type; return; }
            n.type = t;
            if (t === 'branch') n.config.sub = n.config.sub || { nodes: [], connections: [] }; else delete n.config.sub;
            if (t === 'script' && !n.config.code) n.config.code = TEMPLATES[n.config.lang] || TEMPLATE;
            if (t === 'database' && !n.config.sql) n.config.sql = SQL_TEMPLATE;
            changed();
        });
        return s;
    }
    function numRow(dl, label, n, key, lo, hi) {
        var u = n.config.unit === 's' ? 1000 : 1, i = document.createElement('input');
        i.type = 'number'; i.min = lo / u; i.max = hi / u; i.step = u === 1 ? 50 : 0.1; i.value = n.config[key] / u; i.setAttribute('aria-label', label);
        i.addEventListener('input', function () { var v = parseFloat(i.value); if (!isFinite(v)) return; n.config[key] = Math.round(Math.min(hi, Math.max(lo, v * u))); api.onChange(); });
        row(dl, label, i);
    }
    function highlightJs(src) {
        function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
        var re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|if|else|for|while|await|async|new|try|catch|throw|true|false|null|undefined|of|in|break|continue)\b|(\b\d+(?:\.\d+)?\b)|\b(studio|input)\b/g;
        var out = '', last = 0, m;
        while ((m = re.exec(src))) { out += esc(src.slice(last, m.index)) + '<span class="h-' + (m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : m[4] ? 'n' : 'a') + '">' + esc(m[0]) + '</span>'; last = re.lastIndex; }
        return out + esc(src.slice(last)) + '\n';
    }
    function paintRe(src, re, cls) {
        function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
        var out = '', last = 0, m; re.lastIndex = 0;
        while ((m = re.exec(src))) {
            if (m[0] === '') { re.lastIndex++; continue; }
            var g = 1; while (g < m.length && m[g] === undefined) g++;
            out += esc(src.slice(last, m.index)) + '<span class="h-' + cls[g - 1] + '">' + esc(m[0]) + '</span>'; last = re.lastIndex;
        }
        return out + esc(src.slice(last)) + '\n';
    }
    function highlight(src, lang) {
        if (lang === 'html') return paintRe(src, /(<!--[\s\S]*?-->)|("[^"\n]*"|'[^'\n]*')|(<\/?[A-Za-z][\w-]*|\/?>)|(\b[\w-]+(?==))/g, ['c', 's', 'k', 'a']);
        if (lang === 'css') return paintRe(src, /(\/\*[\s\S]*?\*\/)|("[^"\n]*"|'[^'\n]*')|(@[\w-]+)|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)|([\w-]+(?=\s*:))/g, ['c', 's', 'k', 'n', 'a']);
        if (lang === 'sql') return paintRe(src, /(--[^\n]*)|('(?:[^']|'')*')|\b(select|from|where|and|or|not|insert|into|values|update|set|delete|create|table|drop|if|exists|order|by|asc|desc|limit|offset|like|in|is|null|primary|key|default|as|count|sum|avg|min|max|integer|int|text|real|varchar)\b|(\b\d+(?:\.\d+)?\b)/gi, ['c', 's', 'k', 'n']);
        return highlightJs(src);
    }
    function editor(n, key, lang) {                       // used by the Code Editor view (the Properties panel only links to it)
        var wrap = document.createElement('div'), pre = document.createElement('pre'), ta = document.createElement('textarea');
        wrap.className = 'st-code'; pre.setAttribute('aria-hidden', 'true'); ta.spellcheck = false; ta.maxLength = 20000; ta.value = n.config[key]; ta.setAttribute('aria-label', 'Code');
        function paint() { pre.innerHTML = highlight(ta.value, lang); }          // every highlighter escapes what it prints
        ta.addEventListener('input', function () { n.config[key] = ta.value; paint(); api.onChange(); });
        ta.addEventListener('scroll', function () { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; });
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') { e.preventDefault(); var a = ta.selectionStart; ta.value = ta.value.slice(0, a) + '  ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = a + 2; ta.dispatchEvent(new Event('input')); }
        });
        paint(); wrap.appendChild(pre); wrap.appendChild(ta); return wrap;
    }
    function extraProps(dl, n) {
        var u = document.createElement('select'); u.setAttribute('aria-label', 'Time unit');
        [['ms', 'milliseconds'], ['s', 'seconds']].forEach(function (x) { var o = document.createElement('option'); o.value = x[0]; o.textContent = x[1]; if (n.config.unit === x[0]) o.selected = true; u.appendChild(o); });
        u.addEventListener('change', function () { n.config.unit = u.value; api.onChange(); renderProps(); });
        row(dl, 'Time unit', u);
        numRow(dl, 'Activation delay', n, 'aDelay', 0, 600000); numRow(dl, 'Execution delay', n, 'eDelay', 0, 600000); numRow(dl, 'Output delay', n, 'oDelay', 0, 600000);
        var wi = document.createElement('input'); wi.type = 'text'; wi.maxLength = 20; wi.value = n.config.waitEvent || ''; wi.placeholder = 'none'; wi.setAttribute('aria-label', 'Wait for event');
        wi.addEventListener('change', function () { n.config.waitEvent = /^[A-Za-z0-9_-]{1,20}$/.test(wi.value) ? wi.value : ''; wi.value = n.config.waitEvent; api.onChange(); });
        row(dl, 'Wait for event', wi);
        if (n.type === 'script') {
            var lg = document.createElement('select'); lg.setAttribute('aria-label', 'Language');
            LANGS.forEach(function (x) { var o = document.createElement('option'); o.value = x; o.textContent = x; if (n.config.lang === x) o.selected = true; lg.appendChild(o); });
            lg.addEventListener('change', function () { api.setLang(n.id, lg.value); }); row(dl, 'Language', lg);
            if (n.config.lang === 'javascript') numRow(dl, 'Time limit', n, 'timeout', 100, 30000);
        }
        if (n.type === 'script' || n.type === 'database') {
            var ob = document.createElement('button'); ob.type = 'button'; ob.className = 'st-btn'; ob.textContent = 'Open in Code Editor'; ob.addEventListener('click', function () { api.openCode(n.id); });
            row(dl, 'Code', ob);
        }
        if (n.type === 'branch') {
            var m = document.createElement('select'); m.setAttribute('aria-label', 'Branch mode');
            [['inline', 'Part of the parent flow'], ['independent', 'Independent (parent does not wait)']].forEach(function (x) { var o = document.createElement('option'); o.value = x[0]; o.textContent = x[1]; if (n.config.mode === x[0]) o.selected = true; m.appendChild(o); });
            m.addEventListener('change', function () { n.config.mode = m.value; api.onChange(); });
            row(dl, 'Branch mode', m);
            var b = document.createElement('button'); b.type = 'button'; b.className = 'st-btn'; b.textContent = 'Open branch'; b.addEventListener('click', function () { enter(n); }); row(dl, 'Contents', b);
        }
    }

    /* ---- public API used by studio.js ---- */
    function num(v) { return isFinite(v) ? Math.round(+v) : 0; }
    api.load = function (g) {
        G = ROOT = cleanGraph(g, 0); path = [];
        Object.keys(api.ext).forEach(function (k) { api.ext[k].load(g && g[k]); });
        open = true; sel = null; pend = null; V = { x: 40, y: 40, k: 1 }; setTool('select'); api.onReset();
    };
    api.clear = function () { open = false; G = ROOT = { nodes: [], connections: [] }; path = []; Object.keys(api.ext).forEach(function (k) { api.ext[k].load(undefined); }); sel = null; pend = null; render(); api.onReset(); };
    api.get = function () { var c = cleanGraph(ROOT, 0); var out = { version: 3, nodes: c.nodes, connections: c.connections }; Object.keys(api.ext).forEach(function (k) { if (api.ext[k].save) out[k] = api.ext[k].save(); }); return out; };   // statuses are never saved
    api.isOpen = function () { return open; };
    function walk(g, labels, fn) { g.nodes.forEach(function (n) { fn(n, labels); if (n.config && n.config.sub) walk(n.config.sub, labels.concat(n.label), fn); }); }
    api.listNodes = function () { var out = []; walk(ROOT, [], function (n, pl) { out.push({ id: n.id, label: pl.concat(n.label).join(' / '), type: n.type }); }); return out; };
    api.hasNode = function (id) { return !!findAny(id); };
    api.node = function (id) { return findAny(id); };
    api.codeNodes = function () {
        var out = []; walk(ROOT, [], function (n, pl) { if (n.type === 'script' || n.type === 'database') out.push({ id: n.id, label: n.label, path: pl.join(' / '), type: n.type, lang: n.type === 'database' ? 'sql' : n.config.lang }); }); return out;
    };
    api.tree = function () {
        function conv(g) { return g.nodes.map(function (n) { return { id: n.id, label: n.label, type: n.type, lang: n.config.lang, children: n.config.sub ? conv(n.config.sub) : null }; }); }
        return conv(ROOT);
    };
    api.reveal = function (id) {                         // show the container that holds a node and select it
        var found = null;
        (function look(g, trail) { g.nodes.forEach(function (n) { if (found) return; if (n.id === id) found = { g: g, trail: trail }; else if (n.config && n.config.sub) look(n.config.sub, trail.concat(n)); }); })(ROOT, []);
        if (!found) return false; path = found.trail; G = found.g; sel = id; pend = null; V = { x: 40, y: 40, k: 1 }; render(); return true;
    };
    api.createCode = function (kind) {                   // kind: js | html | css | sql
        if (!open || G.nodes.length >= MAX_NODES) return null;
        var i = G.nodes.length, type = kind === 'sql' ? 'database' : 'script', lang = kind === 'html' ? 'html' : kind === 'css' ? 'css' : 'javascript';
        var n = { id: uid(), label: nextLabel('N'), type: type, x: 40 + (i % 5) * 180, y: 40 + Math.floor(i / 5) * 90, enabled: true, status: 'idle', config: defaults(type) };
        n.config.lang = lang; if (type === 'script') n.config.code = TEMPLATES[lang];
        G.nodes.push(n); sel = n.id; api.log('ok', 'graph', 'Created ' + n.label + ' (' + kind + ')'); changed(); return n.id;
    };
    api.setLang = function (id, lang) {
        var n = findAny(id); if (!n || n.type !== 'script' || LANGS.indexOf(lang) < 0) return;
        var c = n.config.code, isTpl = !c.trim() || Object.keys(TEMPLATES).some(function (k) { return TEMPLATES[k] === c; });
        n.config.lang = lang; if (isTpl) n.config.code = TEMPLATES[lang]; changed();
    };
    api.editorFor = function (n, key, lang) { return editor(n, key, lang); };
    api.select = function (id) { if (byId(id)) { sel = id; render(); } };
    api.setStatus = function (id, s) {
        var n = findAny(id); if (!n) return; n.status = s;
        var el = nodesEl.querySelector('[data-id="' + id + '"]'); if (el) el.className = el.className.replace(/ s-\S+/, '') + ' s-' + s;
        if (sel === id) { var p = document.querySelector('.st-status'); if (p) p.textContent = s; }
    };
    api.resetStatus = function () { eachNode(ROOT, function (n) { api.setStatus(n.id, 'idle'); }); };
    setTool('select');
})();
