/* SPECSOFT® Studio: node graph canvas. PHASE 2 (nodes, wires, pan/zoom) + PHASE 7a (STools support: multi-select, lasso,
   frames, groups, folders, reroutes, breakpoints, trace badges, pulse, find). Persistence is done by studio.js via get()/load(). */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var W = 148, H = 52, RW = 18, MAX_NODES = 200, MAX_FRAMES = 50, MAX_GROUPS = 50, MAX_FOLDERS = 30, NS = 'http://www.w3.org/2000/svg';
    var api = window.StudioGraph = { log: function () {}, onChange: function () {}, onReset: function () {}, openCode: function () {}, onTool: function () {}, onInspect: function () {}, onToggleNodes: function () {}, ext: {} };
    var G = { nodes: [], connections: [], frames: [], groups: [], folders: [] }, ROOT = G, path = [], V = { x: 40, y: 40, k: 1 };
    var tool = 'select', sel = null, SEL = [], selFrame = null, pend = null, open = false, drag = null, space = false, traceOn = false, trace = {}, hits = {};
    var clip = null, hist = { undo: [], redo: [], cur: null, t: 0, pending: false, busy: false };   // PHASE 7c: clipboard + undo history
    (function () {                                       // studio.js assigns api.onChange later; wrap it so every change also notes the history
        var user = api.onChange;
        Object.defineProperty(api, 'onChange', { configurable: true, enumerable: true, get: function () { return function () { histNote(); return user.apply(this, arguments); }; }, set: function (f) { user = f; } });
    })();
    function $(id) { return document.getElementById(id); }
    var canvas = $('stCanvas');

    /* ---- DOM: world (pan/zoom) holds frames/groups (behind), the wire layer, and the node layer ---- */
    var world = document.createElement('div'); world.className = 'st-world';
    var underEl = document.createElement('div'); underEl.className = 'st-under';
    var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'st-wires');
    svg.innerHTML = '<defs><marker id="stArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>';
    var layer = document.createElementNS(NS, 'g'); svg.appendChild(layer);
    var lassoEl = document.createElementNS(NS, 'polyline'); lassoEl.setAttribute('class', 'st-lasso'); svg.appendChild(lassoEl);
    var nodesEl = document.createElement('div');
    world.appendChild(underEl); world.appendChild(svg); world.appendChild(nodesEl); canvas.appendChild(world);
    var hint = document.createElement('p'); hint.className = 'st-hint2'; hint.hidden = true;
    hint.textContent = 'Empty graph. Press N, then click the canvas to place your first node.';
    canvas.appendChild(hint);

    function setTool(t) { tool = t; pend = null; canvas.dataset.tool = t; api.onTool(t); render(); }

    /* ---- graph model ---- */
    function ens(g) { g.frames = g.frames || []; g.groups = g.groups || []; g.folders = g.folders || []; return g; }
    function dw(n) { return n.type === 'reroute' ? RW : W; }
    function dh(n) { return n.type === 'reroute' ? RW : H; }
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
    function selOnly(id) { sel = id || null; SEL = id ? [id] : []; selFrame = null; }
    function selClear() { selOnly(null); }
    function selSet(ids, primary) { SEL = []; ids.forEach(function (i) { if (byId(i) && SEL.indexOf(i) < 0) SEL.push(i); }); sel = SEL.indexOf(primary) > -1 ? primary : (SEL.length ? SEL[SEL.length - 1] : null); selFrame = null; }
    function isSel(id) { return SEL.indexOf(id) > -1; }
    function frameById(id) { return G.frames.filter(function (f) { return f.id === id; })[0] || null; }
    function expandGroups(ids) {                         // moving one member of a group moves the whole group
        var gs = {}; ids.forEach(function (i) { var n = byId(i); if (n && n.group) gs[n.group] = 1; });
        var out = ids.slice(); G.nodes.forEach(function (n) { if (n.group && gs[n.group] && out.indexOf(n.id) < 0) out.push(n.id); }); return out;
    }
    function makeNode(p, type, opts) {
        if (G.nodes.length >= MAX_NODES) { api.log('warn', 'graph', 'Node limit reached (' + MAX_NODES + ')'); return null; }
        opts = opts || {}; type = type || 'basic';
        var pre = opts.prefix || (type === 'branch' ? 'B' : type === 'reroute' ? 'R' : 'N'), w = type === 'reroute' ? RW : W, h = type === 'reroute' ? RW : H;
        var n = { id: uid(), label: nextLabel(pre), type: type, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), enabled: true, status: 'idle', group: null, folder: null, bp: false, config: defaults(type) };
        Object.keys(opts.config || {}).forEach(function (k) { n.config[k] = opts.config[k]; });
        G.nodes.push(n); return n;
    }
    function addNode(p, type, opts) { var n = makeNode(p, type, opts); if (!n) return null; selOnly(n.id); api.log('ok', 'graph', 'Created ' + n.label); changed(); return n; }
    function spliceAt(wireId, p, type, opts) {           // put a node ON a connection (reroute / wait)
        var c = G.connections.filter(function (x) { return x.id === wireId; })[0]; if (!c) return;
        var n = makeNode(p, type, opts); if (!n) return;
        G.connections = G.connections.filter(function (x) { return x !== c; });
        G.connections.push({ id: uid(), from: c.from, to: n.id }, { id: uid(), from: n.id, to: c.to });
        selOnly(n.id); api.log('ok', 'graph', 'Inserted ' + n.label + ' on a connection'); changed();
    }
    function connect(a, b) {
        var A = byId(a), B = byId(b);
        if (a === b) return api.log('warn', 'graph', 'A node cannot connect to itself');
        if (G.connections.some(function (c) { return c.from === a && c.to === b; })) return api.log('warn', 'graph', A.label + ' is already connected to ' + B.label);
        if (reaches(b, a)) return api.log('warn', 'graph', 'Rejected ' + A.label + ' to ' + B.label + ': it would create a loop');
        G.connections.push({ id: uid(), from: a, to: b }); api.log('ok', 'graph', 'Connected ' + A.label + ' to ' + B.label); changed();
    }
    function dropNode(id) { G.nodes = G.nodes.filter(function (x) { return x.id !== id; }); G.connections = G.connections.filter(function (c) { return c.from !== id && c.to !== id; }); SEL = SEL.filter(function (x) { return x !== id; }); if (sel === id) sel = SEL.length ? SEL[SEL.length - 1] : null; }
    function removeNode(id) { var n = byId(id); if (!n) return; dropNode(id); api.log('warn', 'graph', 'Deleted ' + n.label); changed(); }
    function removeWire(id) { G.connections = G.connections.filter(function (c) { return c.id !== id; }); api.log('warn', 'graph', 'Removed a connection'); changed(); }
    function removeFrame(id) { G.frames = G.frames.filter(function (f) { return f.id !== id; }); if (selFrame === id) selFrame = null; api.log('warn', 'graph', 'Removed a frame'); changed(); }
    function pruneGroups() { G.groups = G.groups.filter(function (g) { return G.nodes.filter(function (n) { return n.group === g.id; }).length > 1; }); G.nodes.forEach(function (n) { if (n.group && !G.groups.some(function (g) { return g.id === n.group; })) n.group = null; }); }
    function changed() { pruneGroups(); render(); api.onChange(); }

    /* ---- rendering ---- */
    function applyView() { world.style.transform = 'translate(' + V.x + 'px,' + V.y + 'px) scale(' + V.k + ')'; }
    function traceText(t) { return '#' + t.n + (t.ms == null ? ' ...' : ' \u00b7 ' + (t.ms / 1000).toFixed(2) + 's'); }
    function drawWires() {
        layer.textContent = '';
        G.connections.forEach(function (c) {
            var a = byId(c.from), b = byId(c.to); if (!a || !b) return;
            var x1 = a.x + dw(a), y1 = a.y + dh(a) / 2, x2 = b.x, y2 = b.y + dh(b) / 2, dx = Math.max(40, Math.abs(x2 - x1) / 2);
            var d = 'M' + x1 + ' ' + y1 + 'C' + (x1 + dx) + ' ' + y1 + ',' + (x2 - dx) + ' ' + y2 + ',' + x2 + ' ' + y2;
            var g = document.createElementNS(NS, 'g'); g.setAttribute('data-id', c.id);
            var hit = document.createElementNS(NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'st-hit');
            var vis = document.createElementNS(NS, 'path'); vis.setAttribute('d', d); vis.setAttribute('class', 'st-wire'); vis.setAttribute('marker-end', 'url(#stArrow)');
            g.appendChild(hit); g.appendChild(vis); layer.appendChild(g);
        });
    }
    function drawUnder() {
        underEl.textContent = '';
        G.groups.forEach(function (g) {
            var m = G.nodes.filter(function (n) { return n.group === g.id; }); if (!m.length) return;
            var x0 = Math.min.apply(null, m.map(function (n) { return n.x; })) - 16, y0 = Math.min.apply(null, m.map(function (n) { return n.y; })) - 28;
            var x1 = Math.max.apply(null, m.map(function (n) { return n.x + dw(n); })) + 16, y1 = Math.max.apply(null, m.map(function (n) { return n.y + dh(n); })) + 16;
            var d = document.createElement('div'); d.className = 'st-group'; d.style.cssText = 'left:' + x0 + 'px;top:' + y0 + 'px;width:' + (x1 - x0) + 'px;height:' + (y1 - y0) + 'px';
            var s = document.createElement('span'); s.textContent = g.label; d.appendChild(s); underEl.appendChild(d);
        });
        G.frames.forEach(function (f) {
            var d = document.createElement('div'); d.className = 'st-frame' + (selFrame === f.id ? ' sel' : ''); d.dataset.id = f.id;
            d.style.cssText = 'left:' + f.x + 'px;top:' + f.y + 'px;width:' + f.w + 'px;height:' + f.h + 'px';
            var bar = document.createElement('div'); bar.className = 'st-frame-bar'; bar.textContent = f.label;
            var rs = document.createElement('div'); rs.className = 'st-frame-rs'; d.appendChild(bar); d.appendChild(rs); underEl.appendChild(d);
        });
    }
    function nodeEl(n) {
        var fo = G.folders.filter(function (f) { return f.id === n.folder; })[0];
        var d = document.createElement('div');
        d.className = 'st-node' + (isSel(n.id) ? ' sel' : '') + (n.id === sel ? ' prim' : '') + (n.id === pend ? ' pend' : '') + (n.enabled ? '' : ' off') + ' s-' + n.status + ' t-' + n.type + (n.bp ? ' bp' : '') + (hits[n.id] ? ' hit' : '') + (fo ? ' fc-' + (fo.c % 6) : '') + (clip && clip.cut && clip.g === G && clip.ids.indexOf(n.id) > -1 ? ' is-cut' : '');
        d.dataset.id = n.id; d.style.left = n.x + 'px'; d.style.top = n.y + 'px'; if (fo) d.title = 'Folder: ' + fo.name;
        var i = document.createElement('i'); i.className = 'st-port in'; var o = document.createElement('i'); o.className = 'st-port out'; d.appendChild(i);
        if (n.type !== 'reroute') {
            var s = document.createElement('strong'); s.textContent = n.label;
            var t = document.createElement('small'); t.textContent = (n.type === 'branch' ? 'branch, ' + n.config.sub.nodes.length + ' nodes' : n.type === 'script' ? 'script, ' + ({ javascript: 'js', pagejs: 'page js' }[n.config.lang] || n.config.lang) : n.type) + (n.enabled ? '' : ' (disabled)');
            d.appendChild(s); d.appendChild(t);
        }
        d.appendChild(o);
        if (n.bp) { var u = document.createElement('u'); u.className = 'st-bp'; u.title = 'Breakpoint'; d.appendChild(u); }
        if (traceOn && trace[n.id]) { var b = document.createElement('b'); b.className = 'st-trace'; b.textContent = traceText(trace[n.id]); d.appendChild(b); }
        return d;
    }
    function render() {
        ens(G); pruneGroups(); nodesEl.textContent = '';
        G.nodes.forEach(function (n) { nodesEl.appendChild(nodeEl(n)); });
        drawUnder(); drawWires(); applyView(); hint.hidden = !(open && G.nodes.length === 0 && G.frames.length === 0); drawCrumbs(); renderProps();
    }

    /* ---- properties panel ---- */
    function row(dl, name, valueNode) {
        var dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = name; if (typeof valueNode === 'string') dd.textContent = valueNode; else dd.appendChild(valueNode);
        dl.appendChild(dt); dl.appendChild(dd);
    }
    function textInput(val, max, label, fn) { var i = document.createElement('input'); i.type = 'text'; i.maxLength = max; i.value = val; i.setAttribute('aria-label', label); i.addEventListener('input', function () { fn(i.value); }); return i; }
    function smallBtn(text, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'st-btn'; b.textContent = text; b.addEventListener('click', fn); return b; }
    function nodeExtras(dl, n) {
        var fs = document.createElement('select'); fs.setAttribute('aria-label', 'Folder');
        var none = document.createElement('option'); none.value = ''; none.textContent = '(none)'; fs.appendChild(none);
        G.folders.forEach(function (f) { var o = document.createElement('option'); o.value = f.id; o.textContent = f.name; if (n.folder === f.id) o.selected = true; fs.appendChild(o); });
        fs.addEventListener('change', function () { n.folder = fs.value || null; changed(); }); row(dl, 'Folder', fs);
        var g = G.groups.filter(function (x) { return x.id === n.group; })[0];
        if (g) { var w = document.createElement('div'); w.appendChild(textInput(g.label, 24, 'Group name', function (v) { g.label = v.trim() || g.label; drawUnder(); api.onChange(); })); w.appendChild(smallBtn('Ungroup', function () { selSet(SEL.length ? SEL : [n.id]); api.ungroup(); })); row(dl, 'Group', w); }
        var bp = document.createElement('input'); bp.type = 'checkbox'; bp.checked = !!n.bp; bp.setAttribute('aria-label', 'Breakpoint');
        bp.addEventListener('change', function () { n.bp = bp.checked; changed(); }); row(dl, 'Breakpoint', bp);
    }
    function renderProps() {
        var dl = $('stProps'); dl.textContent = '';
        if (selFrame) {
            var f = frameById(selFrame); if (f) {
                row(dl, 'Frame', textInput(f.label, 40, 'Frame label', function (v) { f.label = v || 'Frame'; var b = underEl.querySelector('.st-frame[data-id="' + f.id + '"] .st-frame-bar'); if (b) b.textContent = f.label; api.onChange(); }));
                row(dl, 'Size', Math.round(f.w) + ' x ' + Math.round(f.h)); row(dl, 'Tip', 'Drag the title bar to move the frame and the nodes inside it. Drag the corner to resize.');
                row(dl, 'Delete', smallBtn('Delete frame', function () { removeFrame(f.id); })); return;
            }
        }
        if (SEL.length > 1) {
            row(dl, 'Selected', SEL.length + ' nodes'); row(dl, 'Nodes', SEL.map(function (i) { return byId(i).label; }).join(', '));
            row(dl, 'Tip', 'Use Align, Group, Duplicate, Folder, Toggle or Delete from the STools bar.'); return;
        }
        var n = byId(sel);
        if (!n) return row(dl, 'Nothing selected', 'Pick the Select tool and click a node to edit it. Shift+click adds to the selection, Lasso selects many.');
        var name = textInput(n.label, 20, 'Node label', function (v) {
            n.label = v.trim() || n.label; var el = nodesEl.querySelector('[data-id="' + n.id + '"] strong'); if (el) el.textContent = n.label; api.onChange();
        });
        var en = document.createElement('input'); en.type = 'checkbox'; en.checked = n.enabled; en.setAttribute('aria-label', 'Enabled');
        en.addEventListener('change', function () { n.enabled = en.checked; changed(); });
        var ins = G.connections.filter(function (c) { return c.to === n.id; }).length, outs = G.connections.filter(function (c) { return c.from === n.id; }).length;
        row(dl, 'Label', name); row(dl, 'Enabled', en); if (n.type !== 'reroute') row(dl, 'Type', typeSelect(n)); extraProps(dl, n); nodeExtras(dl, n);
        var stEl = document.createElement('span'); stEl.className = 'st-status'; stEl.textContent = n.status; row(dl, 'Status', stEl);
        row(dl, 'Connections', ins + ' in, ' + outs + ' out'); row(dl, 'Position', n.x + ', ' + n.y); row(dl, 'Internal id', n.id);
    }

    /* ---- pointer, wheel and keyboard ---- */
    function toWorld(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - V.x) / V.k, y: (e.clientY - r.top - V.y) / V.k }; }
    function startPan(e) { drag = { t: 'pan', sx: e.clientX, sy: e.clientY, vx: V.x, vy: V.y }; canvas.setPointerCapture(e.pointerId); }
    function cx(n) { return n.x + dw(n) / 2; } function cy(n) { return n.y + dh(n) / 2; }
    function inPoly(x, y, pts) {
        var c = false; for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            if (((pts[i][1] > y) !== (pts[j][1] > y)) && (x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0])) c = !c;
        } return c;
    }
    canvas.addEventListener('pointerdown', function (e) {
        if (!open || e.target.closest('.st-crumbs,.st-pop,.st-find,.st-inspect')) return;
        var nodeE = e.target.closest('.st-node'), wireG = e.target.closest('g[data-id]'), bar = e.target.closest('.st-frame-bar'), rs = e.target.closest('.st-frame-rs');
        var p = toWorld(e), additive = e.shiftKey || e.ctrlKey || e.metaKey;
        if (e.button === 1 || tool === 'move' || space) return startPan(e);
        if (bar || rs) {
            var f = frameById((bar || rs).parentNode.dataset.id); if (!f) return;
            if (tool === 'delete' || tool === 'cut') return removeFrame(f.id);
            selClear(); selFrame = f.id;
            if (rs) drag = { t: 'frs', id: f.id, moved: false };
            else drag = { t: 'fmove', id: f.id, ox: p.x - f.x, oy: p.y - f.y, fx: f.x, fy: f.y, moved: false,
                carry: G.nodes.filter(function (n) { return cx(n) >= f.x && cx(n) <= f.x + f.w && cy(n) >= f.y && cy(n) <= f.y + f.h; }).map(function (n) { return { id: n.id, x: n.x, y: n.y }; }) };
            canvas.setPointerCapture(e.pointerId); render(); return;
        }
        if (wireG) {
            var wid = wireG.getAttribute('data-id');
            if (tool === 'cut' || tool === 'delete') removeWire(wid);
            else if (tool === 'reroute') spliceAt(wid, p, 'reroute', {});
            else if (tool === 'wait') spliceAt(wid, p, 'basic', { prefix: 'W', config: { eDelay: 1000 } });
            return;
        }
        if (nodeE && ['select', 'connect', 'delete', 'inspect', 'debug'].indexOf(tool) > -1) {
            var id = nodeE.dataset.id, n = byId(id); if (!n) return;
            if (tool === 'select') {
                if (additive) { if (isSel(id)) selSet(SEL.filter(function (x) { return x !== id; })); else selSet(SEL.concat(id), id); render(); return; }
                if (!isSel(id)) selOnly(id); else sel = id;                  // dragging a member keeps the whole selection
                var ids = expandGroups(SEL.slice());
                drag = { t: 'node', ids: ids, start: ids.map(function (i) { return { id: i, x: byId(i).x, y: byId(i).y }; }), px: p.x, py: p.y, moved: false };
                canvas.setPointerCapture(e.pointerId); render();
            } else if (tool === 'connect') { if (!pend) pend = id; else { if (pend !== id) connect(pend, id); pend = null; } render(); }
            else if (tool === 'delete') { if (isSel(id) && SEL.length > 1) api.deleteSelection(); else removeNode(id); }
            else if (tool === 'inspect') { selOnly(id); render(); api.onInspect(id); }
            else if (tool === 'debug') { n.bp = !n.bp; api.log('info', 'debug', n.label + (n.bp ? ': breakpoint set' : ': breakpoint removed')); changed(); }
            return;
        }
        if (tool === 'create' || tool === 'createbranch') addNode(p, tool === 'createbranch' ? 'branch' : 'basic');
        else if (tool === 'reroute') addNode(p, 'reroute');
        else if (tool === 'wait') addNode(p, 'basic', { prefix: 'W', config: { eDelay: 1000 } });
        else if (tool === 'frame') {
            var t = document.createElement('div'); t.className = 'st-frame tmp'; underEl.appendChild(t);
            drag = { t: 'fcreate', x: p.x, y: p.y, w: 0, h: 0, el: t }; canvas.setPointerCapture(e.pointerId);
        } else if (tool === 'lasso') { drag = { t: 'lasso', pts: [[p.x, p.y]], add: additive }; canvas.setPointerCapture(e.pointerId); }
        else { if (!additive) { selClear(); } pend = null; startPan(e); render(); }
    });
    canvas.addEventListener('pointermove', function (e) {
        if (!drag) return; var p = toWorld(e);
        if (drag.t === 'pan') { V.x = drag.vx + e.clientX - drag.sx; V.y = drag.vy + e.clientY - drag.sy; applyView(); return; }
        if (drag.t === 'node') {
            var dx = Math.round(p.x - drag.px), dy = Math.round(p.y - drag.py); drag.moved = drag.moved || dx !== 0 || dy !== 0;
            drag.start.forEach(function (s) { var n = byId(s.id); if (!n) return; n.x = s.x + dx; n.y = s.y + dy; var el = nodesEl.querySelector('[data-id="' + n.id + '"]'); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } });
            drawWires(); drawUnder(); return;
        }
        if (drag.t === 'fmove') {
            var f = frameById(drag.id); if (!f) return; var fx = Math.round(p.x - drag.ox), fy = Math.round(p.y - drag.oy); drag.moved = true;
            f.x = fx; f.y = fy; drag.carry.forEach(function (c) { var n = byId(c.id); if (n) { n.x = c.x + (fx - drag.fx); n.y = c.y + (fy - drag.fy); var el = nodesEl.querySelector('[data-id="' + n.id + '"]'); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } } }); drawWires(); drawUnder(); return;
        }
        if (drag.t === 'frs') { var g = frameById(drag.id); if (!g) return; g.w = Math.max(80, Math.round(p.x - g.x)); g.h = Math.max(60, Math.round(p.y - g.y)); drag.moved = true; drawUnder(); return; }
        if (drag.t === 'fcreate') {
            drag.w = p.x - drag.x; drag.h = p.y - drag.y;
            drag.el.style.cssText = 'left:' + Math.min(drag.x, p.x) + 'px;top:' + Math.min(drag.y, p.y) + 'px;width:' + Math.abs(drag.w) + 'px;height:' + Math.abs(drag.h) + 'px'; return;
        }
        if (drag.t === 'lasso') {
            var lp = drag.pts[drag.pts.length - 1];       // skip tiny moves and cap the length so a long drag cannot slow the page down
            if (drag.pts.length >= 600 || Math.abs(p.x - lp[0]) + Math.abs(p.y - lp[1]) < 4 / V.k) return;
            drag.pts.push([p.x, p.y]); lassoEl.setAttribute('points', drag.pts.map(function (q) { return q[0] + ',' + q[1]; }).join(' '));
        }
    });
    function endDrag() {
        var d = drag; drag = null; if (!d) return;
        if ((d.t === 'node' || d.t === 'fmove' || d.t === 'frs') && d.moved) changed();
        else if (d.t === 'fcreate') {
            d.el.remove(); var w = Math.abs(d.w), h = Math.abs(d.h);
            if (w >= 40 && h >= 30 && G.frames.length < MAX_FRAMES) { var fr = { id: uid(), x: Math.round(Math.min(d.x, d.x + d.w)), y: Math.round(Math.min(d.y, d.y + d.h)), w: Math.round(w), h: Math.round(h), label: 'Frame' }; G.frames.push(fr); selClear(); selFrame = fr.id; api.log('ok', 'graph', 'Created a frame'); changed(); }
        } else if (d.t === 'lasso') {
            lassoEl.setAttribute('points', '');
            if (d.pts.length > 2) { var ids = G.nodes.filter(function (n) { return inPoly(cx(n), cy(n), d.pts); }).map(function (n) { return n.id; }); selSet(d.add ? SEL.concat(ids) : ids); api.log('info', 'graph', 'Lasso selected ' + SEL.length + ' node(s)'); render(); }
        }
    }
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', function (e) {
        if (!open) return; e.preventDefault();
        var r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        var k = Math.min(2.5, Math.max(0.3, V.k * Math.exp(-e.deltaY * 0.0015))), f = k / V.k;
        V.x = mx - (mx - V.x) * f; V.y = my - (my - V.y) * f; V.k = k; applyView();
    }, { passive: false });
    document.addEventListener('keydown', function (e) {         // single-key tool shortcuts live in studio-stools.js
        if (!open || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        var k = e.key.toLowerCase();
        if (k === ' ') { space = true; e.preventDefault(); }
        else if (k === 'delete' || k === 'backspace') { if (selFrame) removeFrame(selFrame); else if (SEL.length) api.deleteSelection(); }
        else if (k === 'escape') { selClear(); setTool('select'); }
    });
    document.addEventListener('keyup', function (e) { if (e.key === ' ') space = false; });

    /* ---- Phase 4: node config, branches, script editor ---- */
    var MAX_DEPTH = 5, MAX_TEXT = 5 * 1024 * 1024, TYPES = ['basic', 'script', 'branch', 'database', 'reroute'], LANGS = ['javascript', 'html', 'css', 'pagejs'];
    var TEMPLATE = "// input = results of the nodes connected into this one\nstudio.log('Hello from a script node');\nawait studio.delay(500);\nreturn { ok: true };";
    var TEMPLATES = { javascript: TEMPLATE, html: '<!-- HTML for your project -->\n<h1>Hello from SPECSOFT Studio</h1>', css: '/* CSS for your project */\nbody { font-family: sans-serif; }',
        pagejs: "// Runs inside the Preview page (not in the graph)\nconsole.log('page ready');\ndocument.body.insertAdjacentHTML('beforeend', '<p>Hello from page JS</p>');" };
    var SQL_TEMPLATE = "-- Runs against this project's database\nCREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT);\nINSERT INTO notes (text) VALUES ('hello');\nSELECT * FROM notes;";
    var crumbs = document.createElement('nav'); crumbs.className = 'st-crumbs'; crumbs.setAttribute('aria-label', 'Branch path'); crumbs.hidden = true; canvas.appendChild(crumbs);
    function clamp(v, lo, hi, d) { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; }
    function defaults(type) {
        var c = { aDelay: 0, eDelay: 0, oDelay: 0, unit: 'ms', timeout: 5000, mode: 'inline', code: type === 'script' ? TEMPLATE : '', lang: 'javascript', sql: type === 'database' ? SQL_TEMPLATE : '', waitEvent: '' };
        if (type === 'branch') c.sub = { nodes: [], connections: [] }; return c;
    }
    function cleanGraph(g, depth) {                      // rebuilds a graph from saved/untrusted data: only known fields survive
        g = g || {}; var ids = {}, str = function (v, n) { return String(v == null ? '' : v).slice(0, n); };
        var folders = (Array.isArray(g.folders) ? g.folders : []).slice(0, MAX_FOLDERS).filter(function (f) { return f && f.id; }).map(function (f) { return { id: str(f.id, 60), name: str(f.name, 24) || 'Folder', c: clamp(f.c, 0, 5, 0) }; });
        var groups = (Array.isArray(g.groups) ? g.groups : []).slice(0, MAX_GROUPS).filter(function (x) { return x && x.id; }).map(function (x) { return { id: str(x.id, 60), label: str(x.label, 24) || 'Group' }; });
        var fids = {}, gids = {}; folders.forEach(function (f) { fids[f.id] = 1; }); groups.forEach(function (x) { gids[x.id] = 1; });
        var nodes = (Array.isArray(g.nodes) ? g.nodes : []).slice(0, MAX_NODES).map(function (n) {
            n = n || {}; var type = TYPES.indexOf(n.type) > -1 ? n.type : 'basic', c = n.config || {}; ids[n.id] = 1;
            var cfg = { aDelay: clamp(c.aDelay, 0, 600000, 0), eDelay: clamp(c.eDelay, 0, 600000, 0), oDelay: clamp(c.oDelay, 0, 600000, 0), unit: c.unit === 's' ? 's' : 'ms',
                timeout: clamp(c.timeout, 100, 30000, 5000), mode: c.mode === 'independent' ? 'independent' : 'inline', code: type === 'script' ? String(c.code || '').slice(0, MAX_TEXT) : '', lang: LANGS.indexOf(c.lang) > -1 ? c.lang : 'javascript',
                sql: type === 'database' ? String(c.sql || '').slice(0, MAX_TEXT) : '', waitEvent: /^[A-Za-z0-9_-]{1,20}$/.test(c.waitEvent || '') ? c.waitEvent : '' };
            if (type === 'branch') cfg.sub = depth < MAX_DEPTH ? cleanGraph(c.sub, depth + 1) : { nodes: [], connections: [], frames: [], groups: [], folders: [] };
            return { id: String(n.id), label: String(n.label || 'N').slice(0, 20), type: type, x: num(n.x), y: num(n.y), enabled: n.enabled !== false, status: 'idle',
                group: gids[n.group] ? n.group : null, folder: fids[n.folder] ? n.folder : null, bp: n.bp === true, config: cfg };
        });
        var conns = (Array.isArray(g.connections) ? g.connections : []).filter(function (c) { return c && ids[c.from] && ids[c.to] && c.from !== c.to; })
            .map(function (c) { return { id: String(c.id || uid()), from: String(c.from), to: String(c.to) }; });
        var frames = (Array.isArray(g.frames) ? g.frames : []).slice(0, MAX_FRAMES).filter(function (f) { return f && f.id; })
            .map(function (f) { return { id: str(f.id, 60), x: num(f.x), y: num(f.y), w: clamp(f.w, 80, 4000, 200), h: clamp(f.h, 60, 4000, 120), label: str(f.label, 40) || 'Frame' }; });
        return { nodes: nodes, connections: conns, frames: frames, groups: groups, folders: folders };
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
        path.push(n); G = n.config.sub; selClear(); pend = null; V = { x: 40, y: 40, k: 1 }; render();
    }
    function goUp(d) { path.length = d; G = d ? path[d - 1].config.sub : ROOT; selClear(); pend = null; V = { x: 40, y: 40, k: 1 }; render(); }
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
        TYPES.filter(function (t) { return t !== 'reroute'; }).forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t === 'script' ? 'script (JS, HTML, CSS)' : t; if (t === n.type) o.selected = true; s.appendChild(o); });
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
        wrap.className = 'st-code'; pre.setAttribute('aria-hidden', 'true'); ta.spellcheck = false; ta.maxLength = MAX_TEXT; ta.value = n.config[key]; ta.setAttribute('aria-label', 'Code');
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
            LANGS.forEach(function (x) { var o = document.createElement('option'); o.value = x; o.textContent = x === 'pagejs' ? 'javascript (page)' : x; if (n.config.lang === x) o.selected = true; lg.appendChild(o); });
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
        open = true; selClear(); pend = null; V = { x: 40, y: 40, k: 1 }; setTool('select'); api.onReset(); histReset();
    };
    api.clear = function () { open = false; G = ROOT = { nodes: [], connections: [] }; path = []; Object.keys(api.ext).forEach(function (k) { api.ext[k].load(undefined); }); selClear(); pend = null; render(); api.onReset(); histReset(); };
    api.get = function () { var c = cleanGraph(ROOT, 0); var out = { version: 3, nodes: c.nodes, connections: c.connections, frames: c.frames, groups: c.groups, folders: c.folders }; Object.keys(api.ext).forEach(function (k) { if (api.ext[k].save) out[k] = api.ext[k].save(); }); return out; };   // statuses are never saved
    api.isOpen = function () { return open; };
    function walk(g, labels, fn) { g.nodes.forEach(function (n) { fn(n, labels); if (n.config && n.config.sub) walk(n.config.sub, labels.concat(n.label), fn); }); }
    api.listNodes = function () { var out = []; walk(ROOT, [], function (n, pl) { out.push({ id: n.id, label: pl.concat(n.label).join(' / '), type: n.type }); }); return out; };
    api.hasNode = function (id) { return !!findAny(id); };
    api.node = function (id) { return findAny(id); };
    api.codeNodes = function () {
        var out = []; walk(ROOT, [], function (n, pl) { if (n.type === 'script' || n.type === 'database') out.push({ id: n.id, label: n.label, path: pl.join(' / '), type: n.type, lang: n.type === 'database' ? 'sql' : n.config.lang }); }); return out;
    };
    api.tree = function () {
        function conv(g) {
            ens(g); var out = [], fm = {};
            g.folders.forEach(function (f) { var it = { id: 'f:' + f.id, label: f.name, type: 'folder', c: f.c, children: [] }; fm[f.id] = it; out.push(it); });
            g.nodes.forEach(function (n) { var it = { id: n.id, label: n.label, type: n.type, lang: n.config.lang, en: n.enabled, bp: !!n.bp, children: n.config.sub ? conv(n.config.sub) : null }; (n.folder && fm[n.folder] ? fm[n.folder].children : out).push(it); });
            return out;
        }
        return conv(ROOT);
    };
    api.reveal = function (id) {                         // show the container that holds a node and select it
        var found = null;
        (function look(g, trail) { g.nodes.forEach(function (n) { if (found) return; if (n.id === id) found = { g: g, trail: trail }; else if (n.config && n.config.sub) look(n.config.sub, trail.concat(n)); }); })(ROOT, []);
        if (!found) return false; path = found.trail; G = found.g; selOnly(id); pend = null; V = { x: 40, y: 40, k: 1 }; render(); return true;
    };
    api.createCode = function (kind) {                   // kind: js | html | css | sql
        if (!open || G.nodes.length >= MAX_NODES) return null;
        var i = G.nodes.length, type = kind === 'sql' ? 'database' : 'script', lang = kind === 'html' ? 'html' : kind === 'css' ? 'css' : 'javascript';
        var n = { id: uid(), label: nextLabel('N'), type: type, x: 40 + (i % 5) * 180, y: 40 + Math.floor(i / 5) * 90, enabled: true, status: 'idle', config: defaults(type) };
        n.config.lang = lang; if (type === 'script') n.config.code = TEMPLATES[lang];
        G.nodes.push(n); selOnly(n.id); api.log('ok', 'graph', 'Created ' + n.label + ' (' + kind + ')'); changed(); return n.id;
    };
    api.setLang = function (id, lang) {
        var n = findAny(id); if (!n || n.type !== 'script' || LANGS.indexOf(lang) < 0) return;
        var c = n.config.code, isTpl = !c.trim() || Object.keys(TEMPLATES).some(function (k) { return TEMPLATES[k] === c; });
        n.config.lang = lang; if (isTpl) n.config.code = TEMPLATES[lang]; changed();
    };
    api.editorFor = function (n, key, lang) { return editor(n, key, lang); };
    api.select = function (id) { if (byId(id)) { selOnly(id); render(); } };
    api.setStatus = function (id, s) {
        var n = findAny(id); if (!n) return; n.status = s;
        var el = nodesEl.querySelector('[data-id="' + id + '"]'); if (el) el.className = el.className.replace(/ s-\S+/, '') + ' s-' + s;
        if (sel === id) { var p = document.querySelector('.st-status'); if (p) p.textContent = s; }
    };
    api.resetStatus = function () { eachNode(ROOT, function (n) { api.setStatus(n.id, 'idle'); }); };
    /* ---- Phase 7c: undo / redo, clipboard, rename, open, and helpers for the right-click menus ---- */
    function depthOf(g) { var d = 0; g.nodes.forEach(function (n) { if (n.config && n.config.sub) d = Math.max(d, 1 + depthOf(n.config.sub)); }); return d; }
    function snap() { var c = cleanGraph(ROOT, 0); return JSON.stringify({ nodes: c.nodes, connections: c.connections, frames: c.frames, groups: c.groups, folders: c.folders }); }
    function histCommit() {                              // the state before a burst of edits becomes one undo step
        hist.pending = false; if (!open || hist.busy) return;
        var s = snap(); if (s === hist.cur) return;
        if (hist.cur !== null) {
            hist.undo.push(hist.cur); var tot = 0; hist.undo.forEach(function (x) { tot += x.length; });
            while (hist.undo.length > 40 || (tot > 8000000 && hist.undo.length > 1)) tot -= hist.undo.shift().length;
        }
        hist.cur = s; hist.redo = [];
    }
    function histNote() { if (hist.busy || !open) return; hist.pending = true; clearTimeout(hist.t); hist.t = setTimeout(histCommit, 400); }
    function histReset() { clearTimeout(hist.t); hist.pending = false; hist.undo = []; hist.redo = []; hist.cur = open ? snap() : null; }
    function restore(s) {
        hist.busy = true;
        try {
            var ids = path.map(function (n) { return n.id; });
            ROOT = cleanGraph(JSON.parse(s), 0); G = ROOT; path = [];
            ids.forEach(function (id) { var n = G.nodes.filter(function (x) { return x.id === id && x.type === 'branch'; })[0]; if (n) { path.push(n); G = n.config.sub; } });   // stay inside the same branch when it still exists
            selClear(); pend = null; drag = null; render(); api.onChange();
        } finally { hist.busy = false; }
    }
    api.undo = function () {
        if (!open) return false; clearTimeout(hist.t); histCommit();
        if (!hist.undo.length) { api.log('info', 'graph', 'Nothing to undo'); return false; }
        hist.redo.push(hist.cur); hist.cur = hist.undo.pop(); restore(hist.cur); api.log('info', 'graph', 'Undo'); return true;
    };
    api.redo = function () {
        if (!open) return false; clearTimeout(hist.t); histCommit();
        if (!hist.redo.length) { api.log('info', 'graph', 'Nothing to redo'); return false; }
        hist.undo.push(hist.cur); hist.cur = hist.redo.pop(); restore(hist.cur); api.log('info', 'graph', 'Redo'); return true;
    };
    api.canUndo = function () { return open && (hist.undo.length > 0 || hist.pending); };
    api.canRedo = function () { return open && hist.redo.length > 0; };

    api.hasClip = function () { return !!clip; };
    api.copy = function (cut) {                          // copy or cut the selected nodes (a cut moves them when you paste)
        var ids = SEL.slice(); if (!ids.length) return api.log('warn', 'graph', (cut ? 'Cut' : 'Copy') + ': select one or more nodes first');
        var set = {}; ids.forEach(function (i) { set[i] = 1; });
        clip = { cut: !!cut, g: G, ids: ids, k: 0,
            nodes: ids.map(function (i) { var c = JSON.parse(JSON.stringify(byId(i))); c.status = 'idle'; c.group = null; return c; }),
            folds: ids.map(function (i) { var f = G.folders.filter(function (x) { return x.id === byId(i).folder; })[0]; return f ? f.name : null; }),
            conns: G.connections.filter(function (c) { return set[c.from] && set[c.to]; }).map(function (c) { return { from: c.from, to: c.to }; }) };
        api.log('info', 'graph', (cut ? 'Cut ' : 'Copied ') + ids.length + ' node(s)' + (cut ? '. They move when you paste.' : '')); render();
    };
    api.paste = function (at) {                          // at = a world position (right-click), or nothing for a small offset
        if (!open) return false; if (!clip) { api.log('warn', 'graph', 'Paste: nothing copied yet'); return false; }
        var d = clip, rm = d.cut ? d.ids : [];
        if (rm.length && path.some(function (p) { return rm.indexOf(p.id) > -1; })) { api.log('warn', 'graph', 'You cannot paste a cut branch into itself'); return false; }
        var deep = 0; d.nodes.forEach(function (x) { if (x.config && x.config.sub) deep = Math.max(deep, 1 + depthOf(x.config.sub)); });
        if (path.length + deep > MAX_DEPTH) { api.log('warn', 'graph', 'Paste: branches can only nest ' + MAX_DEPTH + ' levels deep'); return false; }
        var freed = (d.cut && d.g === G) ? rm.filter(function (i) { return byId(i); }).length : 0;
        if (G.nodes.length - freed + d.nodes.length > MAX_NODES) { api.log('warn', 'graph', 'Node limit reached (' + MAX_NODES + ')'); return false; }
        if (d.cut) {                                     // the originals leave only now, so a cut that is never pasted loses nothing
            var src = d.g; src.nodes = src.nodes.filter(function (x) { return rm.indexOf(x.id) < 0; });
            src.connections = src.connections.filter(function (c) { return rm.indexOf(c.from) < 0 && rm.indexOf(c.to) < 0; }); d.cut = false;
        }
        var minX = Infinity, minY = Infinity; d.nodes.forEach(function (x) { minX = Math.min(minX, num(x.x)); minY = Math.min(minY, num(x.y)); });
        d.k++; var dx = at ? Math.round(at.x - minX) : 30 * d.k, dy = at ? Math.round(at.y - minY) : 30 * d.k, map = {}, made = [];
        var raw = d.nodes.map(function (o) { var c = JSON.parse(JSON.stringify(o)); c.id = uid(); map[o.id] = c.id; c.x = num(c.x) + dx; c.y = num(c.y) + dy; if (c.config && c.config.sub) reid(c.config.sub); return c; });
        var cl = cleanGraph({ nodes: raw, connections: d.conns.map(function (c) { return { id: uid(), from: map[c.from], to: map[c.to] }; }) }, path.length);
        cl.nodes.forEach(function (c, i) {
            if (G.nodes.some(function (x) { return x.label === c.label; })) c.label = nextLabelFor(c);
            var fn = d.folds[i];
            if (fn) { var f = G.folders.filter(function (x) { return x.name.toLowerCase() === fn.toLowerCase(); })[0]; if (!f && G.folders.length < MAX_FOLDERS) { f = { id: uid(), name: fn, c: G.folders.length % 6 }; G.folders.push(f); } if (f) c.folder = f.id; }
            G.nodes.push(c); made.push(c.id);
        });
        G.connections = G.connections.concat(cl.connections); selSet(made); api.log('ok', 'graph', 'Pasted ' + made.length + ' node(s)'); changed(); return true;
    };
    api.rename = function (id, label) {
        var n = byId(id); label = String(label == null ? '' : label).trim().slice(0, 20); if (!n || !label || label === n.label) return false;
        if (G.nodes.some(function (x) { return x !== n && x.label === label; })) api.log('warn', 'graph', 'Another node here is already called "' + label + '". Scripts find nodes by label, so only the first can be reached.');
        else if (!/^[A-Za-z0-9_ -]+$/.test(label)) api.log('info', 'graph', '"' + label + '" has characters that studio.runNode("...") cannot use. It still works as a label.');
        n.label = label; api.log('ok', 'graph', 'Renamed to ' + label); changed(); return true;
    };
    api.enterBranch = function (id) { var n = byId(id); if (!n || n.type !== 'branch') return false; enter(n); return true; };
    api.worldAt = function (x, y) { return toWorld({ clientX: x, clientY: y }); };
    api.addAt = function (p, type) { return open ? addNode(p, type === 'branch' ? 'branch' : 'basic') : null; };
    api.splice = function (wireId, p, kind) { if (!open) return; if (kind === 'wait') spliceAt(wireId, p, 'basic', { prefix: 'W', config: { eDelay: 1000 } }); else spliceAt(wireId, p, 'reroute', {}); };
    api.removeWire = function (id) { removeWire(id); };
    api.removeFrame = function (id) { removeFrame(id); };
    api.renameFrame = function (id, label) { var f = frameById(id); label = String(label == null ? '' : label).trim().slice(0, 40); if (!f || !label) return false; f.label = label; drawUnder(); api.onChange(); return true; };
    api.frameLabel = function (id) { var f = frameById(id); return f ? f.label : null; };
    api.toggleBp = function (id) { var n = byId(id); if (!n) return; n.bp = !n.bp; api.log('info', 'graph', (n.bp ? 'Breakpoint set on ' : 'Breakpoint removed from ') + n.label); changed(); };

    api.fit = function () {                              // zoom and pan so every node and frame is visible
        if (!open || (!G.nodes.length && !G.frames.length)) return false;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        G.nodes.forEach(function (n) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + dw(n)); y1 = Math.max(y1, n.y + dh(n)); });
        G.frames.forEach(function (f) { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); });
        var r = canvas.getBoundingClientRect(), pad = 60, w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
        V.k = Math.min(1.5, Math.max(0.3, Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)));
        V.x = (r.width - w * V.k) / 2 - x0 * V.k; V.y = (r.height - h * V.k) / 2 - y0 * V.k; applyView(); return true;
    };
    api.zoomBy = function (f) {                          // zoom around the middle of the canvas
        var r = canvas.getBoundingClientRect(), mx = r.width / 2, my = r.height / 2, k = Math.min(2.5, Math.max(0.3, V.k * f)), q = k / V.k;
        V.x = mx - (mx - V.x) * q; V.y = my - (my - V.y) * q; V.k = k; applyView();
    };
    api.resetView = function () { V = { x: 40, y: 40, k: 1 }; applyView(); };
    setTool('select');

    /* ---- Phase 7a: STools API (the toolbar and shortcuts live in studio-stools.js) ---- */
    function nextLabelFor(n) { return nextLabel(n.type === 'branch' ? 'B' : n.type === 'reroute' ? 'R' : /^W\d+$/.test(n.label) ? 'W' : 'N'); }
    function reid(g) { var m = {}; (g.nodes || []).forEach(function (n) { var o = n.id; n.id = uid(); m[o] = n.id; if (n.config && n.config.sub) reid(n.config.sub); }); (g.connections || []).forEach(function (c) { c.id = uid(); c.from = m[c.from]; c.to = m[c.to]; }); }
    function sized(ids) { return ids.map(byId).filter(Boolean); }
    api.getTool = function () { return tool; }; api.setTool = setTool;
    api.selection = function () { return SEL.slice(); };
    api.setSelection = function (ids) { selSet(ids); render(); };
    api.selectAll = function () { selSet(G.nodes.map(function (n) { return n.id; })); render(); };
    api.deleteSelection = function () { var ids = SEL.slice(); if (!ids.length) return; ids.forEach(dropNode); api.log('warn', 'graph', 'Deleted ' + ids.length + ' node(s)'); changed(); };
    api.duplicate = function () {
        var ids = SEL.slice(); if (!ids.length) return api.log('warn', 'graph', 'Duplicate: select one or more nodes first');
        if (G.nodes.length + ids.length > MAX_NODES) return api.log('warn', 'graph', 'Node limit reached (' + MAX_NODES + ')');
        var map = {}, copies = [];
        ids.forEach(function (id) {
            var n = byId(id), c = JSON.parse(JSON.stringify(n)); c.id = uid(); c.label = nextLabelFor(n); c.x += 30; c.y += 30; c.status = 'idle'; c.group = null; if (c.config.sub) reid(c.config.sub);
            map[id] = c.id; G.nodes.push(c); copies.push(c.id);
        });
        G.connections.slice().forEach(function (cn) { if (map[cn.from] && map[cn.to]) G.connections.push({ id: uid(), from: map[cn.from], to: map[cn.to] }); });
        selSet(copies); api.log('ok', 'graph', 'Duplicated ' + copies.length + ' node(s)'); changed();
    };
    api.group = function () {
        if (SEL.length < 2) return api.log('warn', 'graph', 'Group: select two or more nodes first');
        if (G.groups.length >= MAX_GROUPS) return api.log('warn', 'graph', 'Group limit reached');
        var g = { id: uid(), label: 'Group ' + (G.groups.length + 1) }; G.groups.push(g); SEL.forEach(function (id) { byId(id).group = g.id; });
        api.log('ok', 'graph', 'Grouped ' + SEL.length + ' nodes as "' + g.label + '"'); changed();
    };
    api.ungroup = function () {
        var gs = {}; SEL.forEach(function (id) { var n = byId(id); if (n && n.group) gs[n.group] = 1; });
        if (!Object.keys(gs).length) return api.log('warn', 'graph', 'Ungroup: the selection has no group');
        G.nodes.forEach(function (n) { if (gs[n.group]) n.group = null; }); api.log('info', 'graph', 'Ungrouped'); changed();
    };
    api.setFolder = function (name) {
        if (!SEL.length) return api.log('warn', 'graph', 'Folder: select one or more nodes first');
        name = String(name || '').trim().slice(0, 24);
        if (!name) { SEL.forEach(function (id) { byId(id).folder = null; }); api.log('info', 'graph', 'Removed from folder'); return changed(); }
        var f = G.folders.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
        if (!f) { if (G.folders.length >= MAX_FOLDERS) return api.log('warn', 'graph', 'Folder limit reached'); f = { id: uid(), name: name, c: G.folders.length % 6 }; G.folders.push(f); }
        SEL.forEach(function (id) { byId(id).folder = f.id; }); api.log('ok', 'graph', SEL.length + ' node(s) moved to folder "' + f.name + '"'); changed();
    };
    api.folders = function () { return G.folders.map(function (f) { return f.name; }); };
    api.align = function (kind) {
        var ns = sized(SEL); if (ns.length < 2) return api.log('warn', 'graph', 'Align: select two or more nodes first');
        var l = Math.min.apply(null, ns.map(function (n) { return n.x; })), r = Math.max.apply(null, ns.map(function (n) { return n.x + dw(n); }));
        var t = Math.min.apply(null, ns.map(function (n) { return n.y; })), b = Math.max.apply(null, ns.map(function (n) { return n.y + dh(n); }));
        ns.forEach(function (n) {
            if (kind === 'left') n.x = l; else if (kind === 'right') n.x = r - dw(n); else if (kind === 'hcenter') n.x = Math.round((l + r) / 2 - dw(n) / 2);
            else if (kind === 'top') n.y = t; else if (kind === 'bottom') n.y = b - dh(n); else if (kind === 'vcenter') n.y = Math.round((t + b) / 2 - dh(n) / 2);
        });
        if (kind === 'distH' || kind === 'distV') {
            var h = kind === 'distH', s = ns.slice().sort(function (a, c) { return h ? a.x - c.x : a.y - c.y; }), size = function (n) { return h ? dw(n) : dh(n); };
            var start = h ? s[0].x : s[0].y, end = h ? s[s.length - 1].x + size(s[s.length - 1]) : s[s.length - 1].y + size(s[s.length - 1]);
            var total = s.reduce(function (a, n) { return a + size(n); }, 0), gap = (end - start - total) / (s.length - 1), pos = start;
            s.forEach(function (n) { if (h) n.x = Math.round(pos); else n.y = Math.round(pos); pos += size(n) + gap; });
        }
        api.log('ok', 'graph', 'Aligned ' + ns.length + ' nodes (' + kind + ')'); changed();
    };
    api.toggleSel = function () {
        var ns = sized(SEL); if (!ns.length) return api.log('warn', 'graph', 'Toggle: select one or more nodes first');
        ns.forEach(function (n) { n.enabled = !n.enabled; }); api.onToggleNodes(ns.map(function (n) { return n.id; }));
        api.log('info', 'graph', ns.map(function (n) { return n.label + (n.enabled ? ' on' : ' off'); }).join(', ')); changed();
    };
    function flash(el) { if (!el) return; el.classList.add('pulse'); setTimeout(function () { el.classList.remove('pulse'); }, 700); }
    api.pulse = function (ids) {                         // dry-run visual: a signal travels along the wires, nothing is executed
        var starts = ids && ids.length ? ids.slice() : G.nodes.filter(function (n) { return !G.connections.some(function (c) { return c.to === n.id; }); }).map(function (n) { return n.id; });
        var depth = {}, order = [], q = starts.slice(); starts.forEach(function (i) { depth[i] = 0; });
        while (q.length) { var i = q.shift(); order.push(i); G.connections.forEach(function (c) { if (c.from === i && depth[c.to] === undefined) { depth[c.to] = depth[i] + 1; q.push(c.to); } }); }
        order.forEach(function (i) { setTimeout(function () { flash(nodesEl.querySelector('[data-id="' + i + '"]')); }, depth[i] * 350); });
        G.connections.forEach(function (c) { if (depth[c.from] !== undefined && depth[c.to] === depth[c.from] + 1) setTimeout(function () { flash(layer.querySelector('g[data-id="' + c.id + '"]')); }, depth[c.from] * 350 + 120); });
        return order.map(function (i) { return byId(i).label; });
    };
    api.setTraceOn = function (on) { traceOn = !!on; render(); }; api.getTraceOn = function () { return traceOn; };
    api.traceReset = function () { trace = {}; hits = {}; if (traceOn) render(); };
    api.traceUpdate = function (id, info) {
        trace[id] = info; if (!traceOn) return; var el = nodesEl.querySelector('[data-id="' + id + '"]'); if (!el) return;
        var b = el.querySelector('.st-trace'); if (!b) { b = document.createElement('b'); b.className = 'st-trace'; el.appendChild(b); } b.textContent = traceText(info);
    };
    api.getTrace = function (id) { return id ? trace[id] : trace; };
    api.setBreakHit = function (id, on) { if (on) hits[id] = 1; else delete hits[id]; var el = nodesEl.querySelector('[data-id="' + id + '"]'); if (el) el.classList.toggle('hit', !!on); };
    api.search = function (q) {
        q = String(q || '').trim().toLowerCase(); if (!q) return []; var out = [];
        walk(ROOT, [], function (n, pl) {
            if (out.length >= 50) return; var full = pl.concat(n.label).join(' / '), c = n.config || {}, field = null, snip = '';
            if (n.label.toLowerCase().indexOf(q) > -1) field = 'label'; else if (n.type.indexOf(q) > -1) field = 'type';
            else { [['code', c.code], ['sql', c.sql], ['event', c.waitEvent]].some(function (p) { var i = String(p[1] || '').toLowerCase().indexOf(q); if (i > -1) { field = p[0]; snip = String(p[1]).slice(Math.max(0, i - 20), i + 40).replace(/\s+/g, ' '); return true; } return false; }); }
            if (field) out.push({ id: n.id, label: full, type: n.type, field: field, snippet: snip });
        });
        return out;
    };
    api.nodeInfo = function (id) {
        var n = findAny(id); if (!n) return null; var c = containerOf(id) || G;
        var lab = function (i) { var x = c.nodes.filter(function (y) { return y.id === i; })[0]; return x ? x.label : '?'; };
        var f = (c.folders || []).filter(function (x) { return x.id === n.folder; })[0], g = (c.groups || []).filter(function (x) { return x.id === n.group; })[0];
        return { node: n, ins: c.connections.filter(function (x) { return x.to === id; }).map(function (x) { return lab(x.from); }), outs: c.connections.filter(function (x) { return x.from === id; }).map(function (x) { return lab(x.to); }), folder: f ? f.name : null, group: g ? g.label : null };
    };
    function containerOf(id, g) { g = g || ROOT; for (var i = 0; i < g.nodes.length; i++) { var n = g.nodes[i]; if (n.id === id) return g; if (n.config && n.config.sub) { var r = containerOf(id, n.config.sub); if (r) return r; } } return null; }
    api.runGraph = function (ids) {                      // the selected nodes of the open container plus everything downstream of them, as a stand-alone graph
        var keep = {}, q = ids.slice(); ids.forEach(function (i) { keep[i] = 1; });
        while (q.length) { var i = q.shift(); G.connections.forEach(function (c) { if (c.from === i && !keep[c.to]) { keep[c.to] = 1; q.push(c.to); } }); }
        var c = cleanGraph(G, path.length), out = { version: 3, nodes: c.nodes.filter(function (n) { return keep[n.id]; }), connections: c.connections.filter(function (x) { return keep[x.from] && keep[x.to]; }), frames: [], groups: [], folders: [] };
        Object.keys(api.ext).forEach(function (k) { if (api.ext[k].save) out[k] = api.ext[k].save(); }); return out;
    };
})();
