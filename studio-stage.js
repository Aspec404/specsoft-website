/* SPECSOFT® Studio, PHASE 8b: Stage tab. Read-only 2D view of the project's bodies: either the start layout (as set in
   Properties, "Has a body") or the current / last run, live. X grows to the right, Y grows downward. Nothing here is stored
   and nothing here can change the project: positions are edited in Properties. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var G = window.StudioGraph, root = document.getElementById('stStage');
    if (!G || !root) return;
    var COLORS = { block: '#5b8def', activator: '#34d399', item: '#f5c542' }, GLYPH = { block: 'B', activator: 'A', item: 'I' }, STEPS = [1, 2, 5];
    var ui = {}, showStart = false, timer = 0, cache = null, cacheAt = 0, listAt = 0;
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    var S = window.StudioStage = {};

    function layout() {                                  // bodies as set in Properties, from every level of the project (cached for one second)
        if (cache && Date.now() - cacheAt < 1000) return cache;
        var out = [];
        (function walk(list) {
            (list || []).forEach(function (n) {
                var b = n.config && n.config.body;
                if (n.enabled !== false && b && b.on && out.length < 100) out.push({ id: n.id, label: n.label, x: +b.x || 0, y: +b.y || 0, w: Math.max(1, +b.w || 40), h: Math.max(1, +b.h || 40), role: b.role || 'block', tag: b.tag || '', a: b.a === undefined ? 1 : +b.a, alive: true });
                if (n.config && n.config.sub) walk(n.config.sub.nodes);
            });
        })(G.isOpen() ? G.get().nodes : []);
        cache = out; cacheAt = Date.now(); return out;
    }
    S.fit = function (bs, W, H) {                        // pure: scale and offset that fit every body into W x H with a margin (also used by tests)
        var minX = -150, maxX = 150, minY = -100, maxY = 100;
        if (bs.length) {
            minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
            bs.forEach(function (b) { minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2); minY = Math.min(minY, b.y - b.h / 2); maxY = Math.max(maxY, b.y + b.h / 2); });
        }
        var sx = Math.max(300, maxX - minX), sy = Math.max(200, maxY - minY), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, pad = 32;
        var sc = Math.max(0.0001, Math.min((W - pad * 2) / sx, (H - pad * 2) / sy));
        return { sc: sc, ox: W / 2 - cx * sc, oy: H / 2 - cy * sc };
    };
    function niceStep(sc) {                              // a grid step that is at least ~48 px wide on screen
        var mag = 1; for (var guard = 0; guard < 40; guard++) { for (var i = 0; i < STEPS.length; i++) { if (STEPS[i] * mag * sc >= 48) return STEPS[i] * mag; } mag *= 10; }
        return mag;
    }
    function draw(snap) {
        var cv = ui.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        var c = cv.getContext('2d'), fg = getComputedStyle(root).color || '#cccccc', f = S.fit(snap.bodies, W, H), now = Date.now();
        function X(x) { return x * f.sc + f.ox; } function Y(y) { return y * f.sc + f.oy; }
        c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); c.font = '11px monospace'; c.textBaseline = 'alphabetic';
        var st = niceStep(f.sc), x0 = Math.floor((-f.ox / f.sc) / st) * st, x1 = (W - f.ox) / f.sc, y0 = Math.floor((-f.oy / f.sc) / st) * st, y1 = (H - f.oy) / f.sc;
        c.strokeStyle = fg; c.fillStyle = fg; c.lineWidth = 1; c.globalAlpha = 0.1;
        for (var gx = x0; gx <= x1; gx += st) { c.beginPath(); c.moveTo(X(gx), 0); c.lineTo(X(gx), H); c.stroke(); }
        for (var gy = y0; gy <= y1; gy += st) { c.beginPath(); c.moveTo(0, Y(gy)); c.lineTo(W, Y(gy)); c.stroke(); }
        c.globalAlpha = 0.35; c.beginPath(); c.moveTo(X(0), 0); c.lineTo(X(0), H); c.moveTo(0, Y(0)); c.lineTo(W, Y(0)); c.stroke();
        c.globalAlpha = 0.5; c.fillText('0,0  (grid ' + st + ')', Math.min(W - 90, Math.max(4, X(0) + 4)), Math.min(H - 4, Math.max(12, Y(0) - 4)));
        var touching = {}; (snap.touching || []).forEach(function (k) { k.split('|').forEach(function (id) { touching[id] = true; }); });
        var flashing = {}; (snap.flash || []).forEach(function (fl) { if (now - fl.t < 600) { flashing[fl.a] = true; flashing[fl.b] = true; } });
        snap.bodies.forEach(function (b) {
            var rx = X(b.x - b.w / 2), ry = Y(b.y - b.h / 2), rw = b.w * f.sc, rh = b.h * f.sc, col = COLORS[b.role] || COLORS.block, al = Math.max(0.15, Math.min(1, b.a));
            c.setLineDash(b.alive ? [] : [4, 3]); c.lineWidth = 2;
            if (b.alive) { c.globalAlpha = al * 0.35; c.fillStyle = col; c.fillRect(rx, ry, rw, rh); }
            c.globalAlpha = b.alive ? al : 0.3; c.strokeStyle = col; c.strokeRect(rx, ry, rw, rh);
            if (b.alive && (touching[b.id] || flashing[b.id])) { c.globalAlpha = 1; c.lineWidth = 3; c.strokeStyle = flashing[b.id] ? '#ffffff' : '#ff5c5c'; c.strokeRect(rx - 2, ry - 2, rw + 4, rh + 4); }
            c.setLineDash([]); c.globalAlpha = b.alive ? 0.9 : 0.35; c.fillStyle = fg;
            c.fillText(b.label + (b.tag ? ' #' + b.tag : '') + (b.alive ? '' : ' (picked up)'), Math.max(2, Math.min(W - 80, rx)), Math.max(11, ry - 4));
            c.font = 'bold 12px monospace'; c.fillText(GLYPH[b.role] || 'B', rx + rw / 2 - 4, ry + rh / 2 + 4); c.font = '11px monospace';
        });
        c.globalAlpha = 1;
    }
    function describe(snap) {                            // the same information as text, for screen readers (rebuilt at most 4 times a second)
        if (Date.now() - listAt < 250) return; listAt = Date.now(); ui.list.textContent = '';
        if (!snap.bodies.length) { ui.list.appendChild(el('li', '', 'No bodies. Select a node and turn on "Has a body" in Properties.')); return; }
        snap.bodies.forEach(function (b) { ui.list.appendChild(el('li', '', b.label + ': ' + b.role + (b.tag ? ', tag ' + b.tag : '') + ', centre (' + (Math.round(b.x * 10) / 10) + ', ' + (Math.round(b.y * 10) / 10) + '), ' + b.w + ' by ' + b.h + (b.a < 1 ? ', opacity ' + Math.round(b.a * 100) / 100 : '') + (b.alive ? '' : ', picked up'))); });
    }
    function frame() {
        timer = 0; if (root.hidden) return;
        var E = window.StudioEngine, w = E && E.world ? E.world() : null, running = !!(w && !w.ended), snap;
        ui.toggle.disabled = !w; ui.toggle.textContent = showStart || !w ? 'Showing the start layout' + (w ? ' (click for the run)' : '') : 'Showing the run (click for the start layout)';
        if (w && !showStart) { snap = { bodies: w.bodies, touching: w.touching, flash: w.flash }; ui.status.textContent = 'Run ' + w.run + (w.ended ? ' (finished)' : ' (live)') + ', ' + (w.t / 1000).toFixed(2) + ' s, ' + w.hits + ' touch event(s)'; }
        else { snap = { bodies: layout(), touching: [], flash: [] }; ui.status.textContent = 'Start layout, as set in Properties'; }
        draw(snap); describe(snap);
        timer = setTimeout(frame, running ? 33 : 250);
    }
    function build() {
        ui.root = root; var bar = el('div', 'st-stage-bar');
        ui.status = el('span', '', 'Start layout'); ui.toggle = el('button', 'st-btn', 'Showing the start layout'); ui.toggle.type = 'button';
        ui.toggle.addEventListener('click', function () { showStart = !showStart; clearTimeout(timer); frame(); });
        bar.appendChild(ui.status); bar.appendChild(ui.toggle); bar.appendChild(el('span', '', 'B block, A activator, I item. X grows to the right, Y downward. Positions are set in Properties.'));
        ui.cv = el('canvas'); ui.cv.setAttribute('role', 'img'); ui.cv.setAttribute('aria-label', 'Stage: the bodies of this project. The same information is listed below as text.');
        ui.list = el('ul', 'st-stage-list'); ui.list.setAttribute('aria-label', 'Bodies');
        root.appendChild(bar); root.appendChild(ui.cv); root.appendChild(ui.list);
        new MutationObserver(function () { if (!root.hidden && !timer) frame(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
        if (!root.hidden) frame();
    }
    S.render = function () { cache = null; if (!root.hidden) { clearTimeout(timer); frame(); } };
    build();
})();
