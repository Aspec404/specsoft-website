/* SPECSOFT® Studio, PHASE 5: master timeline and keyframes (Timeline tab).
   NODE TRACKS hold markers for one node:  start = earliest time the node may begin (it still waits for its inputs),
     stop / pause / resume / wait / toggle / spawn act on the node at that time, custom = fires a named event
     (a node can wait for an event in Properties, and scripts can call studio.emit('name')).
   VALUE TRACKS hold keyframes; scripts read the animated value with studio.value('name') (linear between keys).
   The engine owns the clock while a run is active; when idle you can scrub the playhead to preview values. */
(function () {
    'use strict';
    var G = window.StudioGraph, PX = 80, SNAP = 50, NAME = /^[A-Za-z0-9_ -]{1,20}$/, EVT = /^[A-Za-z0-9_-]{1,20}$/;
    var ACTS = ['start', 'stop', 'pause', 'resume', 'wait', 'toggle', 'spawn', 'custom'];
    var LETTER = { start: 'S', stop: 'X', pause: 'P', resume: 'R', wait: 'W', toggle: 'T', spawn: 'B', custom: 'E' };
    var TL = { duration: 10000, tracks: [] }, sel = null, head = 0, addAct = 'start', ui = {};
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function uid() { return 'k' + Math.random().toString(36).slice(2, 10); }
    function num(v, lo, hi, d) { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; }
    function snap(t) { return Math.round(t / SNAP) * SNAP; }
    var T = window.StudioTimeline = {};

    function clean(t) {
        t = t || {}; var dur = num(t.duration, 1000, 600000, 10000);
        var tracks = (Array.isArray(t.tracks) ? t.tracks : []).slice(0, 20).map(function (x) {
            x = x || {}; var id = String(x.id || uid()).slice(0, 40);
            if (x.type === 'value') {
                if (!NAME.test(x.name || '')) return null;
                var keys = (Array.isArray(x.keys) ? x.keys : []).slice(0, 100).map(function (k) { k = k || {}; return { id: String(k.id || uid()).slice(0, 40), t: num(k.t, 0, dur, 0), v: isFinite(+k.v) ? Math.max(-1e9, Math.min(1e9, +k.v)) : 0 }; });
                keys.sort(function (a, b) { return a.t - b.t; }); return { id: id, type: 'value', name: x.name, keys: keys };
            }
            if (typeof x.nodeId !== 'string') return null;
            var ms = (Array.isArray(x.markers) ? x.markers : []).slice(0, 100).map(function (m) {
                m = m || {}; return { id: String(m.id || uid()).slice(0, 40), t: num(m.t, 0, dur, 0), a: ACTS.indexOf(m.a) > -1 ? m.a : 'custom', d: num(m.d, 50, 600000, 1000), name: EVT.test(m.name || '') ? m.name : '' };
            });
            ms.sort(function (a, b) { return a.t - b.t; }); return { id: id, type: 'node', nodeId: x.nodeId.slice(0, 80), markers: ms };
        }).filter(Boolean);
        return { duration: dur, tracks: tracks };
    }
    T.valueAt = function (tl, name, t) {
        var tr = ((tl && tl.tracks) || []).filter(function (x) { return x.type === 'value' && x.name === name; })[0];
        if (!tr || !tr.keys.length) return null;
        var k = tr.keys; if (t <= k[0].t) return k[0].v; if (t >= k[k.length - 1].t) return k[k.length - 1].v;
        for (var i = 1; i < k.length; i++) if (t <= k[i].t) { var a = k[i - 1], b = k[i]; return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t); }
        return null;
    };
    G.ext.timeline = {
        load: function (d) { TL = clean(d); sel = null; head = 0; render(); renderSel(); },
        save: function () { var c = clean(TL); c.tracks = c.tracks.filter(function (x) { return x.type === 'value' || G.hasNode(x.nodeId); }); return c; }
    };
    function changed() { G.onChange(); render(); renderSel(); }
    function find(trId) { return TL.tracks.filter(function (x) { return x.id === trId; })[0]; }
    function item() { if (!sel) return null; var tr = find(sel.tr); if (!tr) return null; var list = tr.type === 'node' ? tr.markers : tr.keys; return list.filter(function (i) { return i.id === sel.id; })[0] || null; }
    function label(tr) {
        if (tr.type === 'value') return tr.name;
        var n = G.listNodes().filter(function (x) { return x.id === tr.nodeId; })[0]; return n ? n.label + ' (' + n.type + ')' : '(deleted node)';
    }

    function updateHead() {
        if (!ui.line) return; ui.line.style.left = (130 + head * PX / 1000) + 'px'; ui.time.textContent = (head / 1000).toFixed(2) + 's';
        Array.prototype.forEach.call(document.querySelectorAll('.tl-val'), function (s) { var v = T.valueAt(TL, s.dataset.name, head); s.textContent = v === null ? '' : ' = ' + Math.round(v * 100) / 100; });
    }
    T.setPlayhead = function (ms) { head = Math.max(0, ms); updateHead(); };
    function running() { return window.StudioEngine && StudioEngine.isActive && StudioEngine.isActive(); }

    function addItem(tr, t) {
        if (tr.type === 'node') { if (tr.markers.length >= 100) return; var m = { id: uid(), t: t, a: addAct, d: 1000, name: addAct === 'custom' ? 'event1' : '' }; tr.markers.push(m); tr.markers.sort(function (a, b) { return a.t - b.t; }); sel = { tr: tr.id, id: m.id }; }
        else { if (tr.keys.length >= 100) return; var k = { id: uid(), t: t, v: T.valueAt(TL, tr.name, t) || 0 }; tr.keys.push(k); tr.keys.sort(function (a, b) { return a.t - b.t; }); sel = { tr: tr.id, id: k.id }; }
        changed();
    }
    function itemEl(tr, it, isKey, lane) {
        var b = el('button', 'tl-m ' + (isKey ? 'tl-key' : 'a-' + it.a), isKey ? '' : LETTER[it.a]); b.type = 'button';
        b.style.left = (it.t * PX / 1000) + 'px'; b.title = (isKey ? 'keyframe ' + it.v : it.a + (it.name ? ' ' + it.name : '')) + ' at ' + (it.t / 1000).toFixed(2) + 's';
        b.setAttribute('aria-label', b.title); if (sel && sel.id === it.id) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('pointerdown', function (e) {
            e.stopPropagation(); sel = { tr: tr.id, id: it.id }; renderSel(); b.setPointerCapture(e.pointerId);
            Array.prototype.forEach.call(document.querySelectorAll('.tl-m'), function (x) { x.removeAttribute('aria-pressed'); }); b.setAttribute('aria-pressed', 'true');
            var left = lane.getBoundingClientRect().left, moved = false;
            function mv(ev) { it.t = Math.max(0, Math.min(TL.duration, snap((ev.clientX - left) / PX * 1000))); b.style.left = (it.t * PX / 1000) + 'px'; moved = true; }
            function up() { b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); if (moved) { (tr.type === 'node' ? tr.markers : tr.keys).sort(function (x, y) { return x.t - y.t; }); changed(); } }
            b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up);
        });
        return b;
    }
    function render() {
        if (!ui.body) return;
        var open = G.isOpen(); ui.empty.hidden = open; ui.wrap.hidden = !open; ui.bar.hidden = !open; if (!open) return;
        ui.dur.value = TL.duration / 1000; fillNodes();
        var w = Math.round(TL.duration / 1000 * PX); ui.body.textContent = '';
        var rr = el('div', 'tl-row'), rn = el('div', 'tl-name', 'Time'), ruler = el('div', 'tl-lane tl-ruler'); ruler.style.width = w + 'px'; rr.appendChild(rn); rr.appendChild(ruler);
        for (var s = 0; s <= TL.duration / 1000; s++) { var tk = el('span', 'tl-tick', s + 's'); tk.style.left = (s * PX) + 'px'; ruler.appendChild(tk); }
        ruler.addEventListener('pointerdown', function (e) {
            if (running()) return; ruler.setPointerCapture(e.pointerId);
            function at(ev) { head = Math.max(0, Math.min(TL.duration, snap((ev.clientX - ruler.getBoundingClientRect().left) / PX * 1000))); updateHead(); }
            at(e); ruler.addEventListener('pointermove', at); ruler.addEventListener('pointerup', function () { ruler.removeEventListener('pointermove', at); }, { once: true });
        });
        ui.body.appendChild(rr);
        TL.tracks.forEach(function (tr) {
            var row = el('div', 'tl-row'), name = el('div', 'tl-name'), nm = el('span', '', label(tr)); name.appendChild(nm);
            if (tr.type === 'value') { var v = el('span', 'tl-val'); v.dataset.name = tr.name; name.appendChild(v); }
            var del = el('button', 'tl-del', 'x'); del.type = 'button'; del.setAttribute('aria-label', 'Remove track ' + label(tr));
            del.addEventListener('click', function () { TL.tracks = TL.tracks.filter(function (x) { return x !== tr; }); if (sel && sel.tr === tr.id) sel = null; changed(); });
            name.appendChild(del);
            var lane = el('div', 'tl-lane'); lane.style.width = w + 'px'; lane.title = 'Click to add';
            lane.addEventListener('pointerdown', function (e) { if (e.target === lane) addItem(tr, Math.max(0, Math.min(TL.duration, snap((e.clientX - lane.getBoundingClientRect().left) / PX * 1000)))); });
            (tr.type === 'node' ? tr.markers : tr.keys).forEach(function (it) { lane.appendChild(itemEl(tr, it, tr.type === 'value', lane)); });
            row.appendChild(name); row.appendChild(lane); ui.body.appendChild(row);
        });
        if (!TL.tracks.length) ui.body.appendChild(el('p', 'st-hint', 'No tracks yet. Add a node track to schedule a node, or a value track to animate a number.'));
        ui.line = el('div', 'tl-head'); ui.body.appendChild(ui.line); updateHead();
    }
    function fillNodes() {
        var cur = ui.node.value; ui.node.textContent = '';
        G.listNodes().forEach(function (n) { var o = el('option', '', n.label + ' (' + n.type + ')'); o.value = n.id; ui.node.appendChild(o); }); if (cur) ui.node.value = cur;
    }
    function field(form, text, input) { var l = el('label', 'tl-f'); l.appendChild(el('span', '', text)); l.appendChild(input); form.appendChild(l); }
    function numIn(v, step) { var i = el('input'); i.type = 'number'; i.value = v; i.step = step || 50; return i; }
    function renderSel() {
        if (!ui.sel) return; ui.sel.textContent = ''; var it = item(), tr = sel && find(sel.tr);
        if (!it) { ui.sel.appendChild(el('span', 'st-hint', 'Click a track to add a marker or keyframe. Click one to edit it, drag to move it.')); return; }
        var t = numIn(it.t); t.addEventListener('change', function () { it.t = snap(num(t.value, 0, TL.duration, it.t)); (tr.type === 'node' ? tr.markers : tr.keys).sort(function (a, b) { return a.t - b.t; }); changed(); }); field(ui.sel, 'Time (ms)', t);
        if (tr.type === 'value') { var v = numIn(it.v, 'any'); v.addEventListener('change', function () { it.v = isFinite(+v.value) ? +v.value : 0; changed(); }); field(ui.sel, 'Value', v); }
        else {
            var a = el('select'); ACTS.forEach(function (x) { var o = el('option', '', x); o.value = x; if (x === it.a) o.selected = true; a.appendChild(o); });
            a.addEventListener('change', function () { it.a = a.value; if (it.a === 'custom' && !it.name) it.name = 'event1'; changed(); }); field(ui.sel, 'Action', a);
            if (it.a === 'wait') { var d = numIn(it.d); d.addEventListener('change', function () { it.d = num(d.value, 50, 600000, 1000); changed(); }); field(ui.sel, 'Hold for (ms)', d); }
            if (it.a === 'custom') { var nmI = el('input'); nmI.type = 'text'; nmI.maxLength = 20; nmI.value = it.name; nmI.addEventListener('change', function () { if (EVT.test(nmI.value)) it.name = nmI.value; changed(); }); field(ui.sel, 'Event name', nmI); }
        }
        var rm = el('button', 'st-btn st-danger', 'Delete'); rm.type = 'button';
        rm.addEventListener('click', function () { if (tr.type === 'node') tr.markers = tr.markers.filter(function (x) { return x !== it; }); else tr.keys = tr.keys.filter(function (x) { return x !== it; }); sel = null; changed(); }); ui.sel.appendChild(rm);
    }
    function build() {
        var root = $('stTime'); if (!root) return;
        ui.empty = el('p', 'st-hint', 'Open a project to edit its timeline.'); ui.bar = el('div', 'tl-bar'); ui.wrap = el('div', 'tl-scroll'); ui.body = el('div', 'tl-body'); ui.sel = el('div', 'tl-sel');
        var play = el('button', 'st-btn', 'Play'); play.type = 'button'; play.title = 'Starts a run. The timeline controls when nodes start, stop and pause.';
        play.addEventListener('click', function () { if (window.StudioEngine) StudioEngine.start(); });
        var stop = el('button', 'st-btn', 'Stop'); stop.type = 'button'; stop.addEventListener('click', function () { if (window.StudioEngine) StudioEngine.stop(); });
        ui.time = el('span', 'tl-time', '0.00s');
        ui.dur = el('input'); ui.dur.type = 'number'; ui.dur.min = 1; ui.dur.max = 600; ui.dur.step = 1; ui.dur.addEventListener('change', function () { TL.duration = num(ui.dur.value * 1000, 1000, 600000, TL.duration); TL = clean(TL); changed(); });
        ui.node = el('select'); ui.node.setAttribute('aria-label', 'Node for new track');
        var addN = el('button', 'st-btn', 'Add node track'); addN.type = 'button';
        addN.addEventListener('click', function () { var id = ui.node.value; if (!id || TL.tracks.length >= 20 || TL.tracks.some(function (x) { return x.nodeId === id; })) return; TL.tracks.push({ id: uid(), type: 'node', nodeId: id, markers: [] }); changed(); });
        ui.vname = el('input'); ui.vname.type = 'text'; ui.vname.maxLength = 20; ui.vname.placeholder = 'value name'; ui.vname.setAttribute('aria-label', 'Name for new value track');
        var addV = el('button', 'st-btn', 'Add value track'); addV.type = 'button';
        addV.addEventListener('click', function () { var n = ui.vname.value.trim(); if (!NAME.test(n) || TL.tracks.length >= 20 || TL.tracks.some(function (x) { return x.name === n; })) return; TL.tracks.push({ id: uid(), type: 'value', name: n, keys: [] }); ui.vname.value = ''; changed(); });
        var act = el('select'); act.setAttribute('aria-label', 'Marker type to add'); ACTS.forEach(function (x) { var o = el('option', '', x); o.value = x; act.appendChild(o); }); act.addEventListener('change', function () { addAct = act.value; });
        [play, stop, ui.time].forEach(function (x) { ui.bar.appendChild(x); });
        field(ui.bar, 'Length (s)', ui.dur); ui.bar.appendChild(ui.node); ui.bar.appendChild(addN); ui.bar.appendChild(ui.vname); ui.bar.appendChild(addV); field(ui.bar, 'Click adds', act);
        ui.wrap.appendChild(ui.body); [ui.empty, ui.bar, ui.sel, ui.wrap].forEach(function (x) { root.appendChild(x); });
        T.render = function () { render(); renderSel(); }; render(); renderSel();
    }
    T.render = function () {}; build();
})();
