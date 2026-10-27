/* ==========================================================================
   SPECSOFT® cursor.js  -  custom cursor v4

   - real cursor hidden (only after the first mouse move)
   - dot (instant, set straight from the pointer event) + eased ring
   - variants: default, pointer, text (I-beam), grab, grabbing, loading, disabled
       text     -> inputs / textareas / contenteditable, while selecting text,
                   and after a double-click word select
       grab     -> .cm-carousel-stage, .cr-stage (grabbing while dragging)
       loading  -> [aria-busy="true"], .is-loading, .sidebar-logout:disabled
       disabled -> :disabled / [aria-disabled="true"]
       any element can opt in with data-cursor="pointer|text|grab|loading|disabled|default"
   - MAGNET: over small buttons/links the ring snaps onto them and wraps their
       edges (turn off per element with data-cursor-magnet="off")
   - LABELS: tiny mono tag next to the pointer. Automatic for drag / loading /
       locked / project cards / external links / FAQ rows, or set your own with
       data-cursor-label="COPY"   (empty string = no label)
   - VELOCITY STRETCH: dot + ring stretch in the direction you move fast
   - HOLD TO CHARGE: hold the mouse down on a button/blank space and a ring
       fills; at 100% it pops and fires a 'sc:charge' event on window
       (detail: x, y, target) so you can hook easter eggs onto it
   - TRAIL: monochrome tapered line + tiny square markers (canvas, dirty-rect
       cleared so it stays cheap). Colour follows --text-primary / light-mode
   - NEVER vanishes: coordinates are clamped, so leaving the window parks the
       cursor on the nearest edge
   - API: SCCursor.busy(true|false)  SCCursor.setState('loading'|null)
          SCCursor.burst(x, y)       SCCursor.config
   ========================================================================== */
(function () {
    'use strict';

    if (window.__scCursor) return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    window.__scCursor = true;

    /* ----- settings you can tweak ----- */
    var CFG = {
        trail: true,
        trailLife: 520,           // ms a trail point lives
        trailMarkerEvery: 38,     // px of travel between little square markers
        burst: true,
        magnet: true,
        magnetMaxW: 360,          // only snap to things smaller than this
        magnetMaxH: 90,
        magnetPull: 0.18,         // 0 = ring sits dead-centre on the button, 1 = ignores it
        labels: true,
        stretch: true,
        charge: true,
        chargeDelay: 160,         // ms before the ring starts to fill (so normal clicks never flash it)
        chargeTime: 650,          // ms to fill
        textOverParagraphs: false // true = I-beam over every bit of body text
    };

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { CFG.trail = false; CFG.burst = false; CFG.stretch = false; }

    var NS = 'http://www.w3.org/2000/svg';
    var root = document.documentElement;
    var vw = window.innerWidth, vh = window.innerHeight;
    var mx = vw / 2, my = vh / 2;     // real pointer (clamped to viewport)
    var rx = mx, ry = my;             // eased ring
    var px = mx, py = my;             // previous pointer (for velocity)
    var ready = false, dragging = false, selecting = false;
    var textUntil = 0, forced = null, busyFlag = false, state = '';
    var needInspect = false, pendingTarget = null;

    /* ----- selectors ----- */
    var TEXT_SEL   = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, [contenteditable=""], [contenteditable="true"]';
    var PARA_SEL   = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, code, .code-content';
    var HOVER_SEL  = 'a, button, [role="button"], summary, label[for], select, input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], input[type="range"], input[type="file"], .faq-q, .project-card, .team-card, .build-card, .fx-rail-item, [data-cursor="pointer"]';
    var GRAB_SEL   = '.cm-carousel-stage, .cr-stage, [data-cursor="grab"]';
    var LOAD_SEL   = '[aria-busy="true"], .is-loading, .is-busy, .sidebar-logout:disabled, [data-cursor="loading"]';
    var DIS_SEL    = ':disabled, [aria-disabled="true"], [data-cursor="disabled"]';
    var MAGNET_SEL = 'a, button, [role="button"], summary, .fx-rail-item, [data-cursor-magnet="on"]';

    /* ----- build ----- */
    var GLYPH_GRAB = '<svg class="sc-glyph sc-glyph-grab" viewBox="0 0 52 52"><path d="M8 18V8h10M34 8h10v10M44 34v10H34M18 44H8V34"/></svg>';
    var GLYPH_SPIN = '<svg class="sc-glyph sc-glyph-spin" viewBox="0 0 52 52"><circle cx="26" cy="26" r="15" opacity="0.25"/><path class="sc-spin-arc" d="M26 11a15 15 0 0 1 15 15"/></svg>';
    var GLYPH_BAN  = '<svg class="sc-glyph sc-glyph-ban" viewBox="0 0 52 52"><circle cx="26" cy="26" r="13"/><line x1="17" y1="35" x2="35" y2="17"/></svg>';
    var IBEAM      = '<svg class="sc-ibeam" viewBox="0 0 10 26"><g class="sc-ibeam-blink"><path d="M2 2h6M5 2v22M2 24h6"/></g></svg>';
    var CIRC       = 2 * Math.PI * 18;
    var CHARGE     = '<svg class="sc-charge" viewBox="0 0 44 44"><circle class="sc-charge-track" cx="22" cy="22" r="18"/>' +
                     '<circle class="sc-charge-bar" cx="22" cy="22" r="18" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="' + CIRC.toFixed(2) + '"/></svg>';

    var ringLayer = document.createElement('div');
    ringLayer.className = 'sc-layer sc-ring';
    ringLayer.innerHTML = '<div class="sc-ring-box"><div class="sc-ring-scale"><div class="sc-ring-rot"></div></div>' +
        GLYPH_GRAB + GLYPH_SPIN + GLYPH_BAN + '</div>';
    var ringBox = ringLayer.firstChild;
    var ringRot = ringBox.querySelector('.sc-ring-rot');

    var dotLayer = document.createElement('div');
    dotLayer.className = 'sc-layer sc-dot';
    dotLayer.innerHTML = '<div class="sc-dot-stretch"><div class="sc-dot-core"></div></div>' + IBEAM + CHARGE + '<div class="sc-label"></div>';
    var dotStretch = dotLayer.firstChild;
    var chargeSvg = dotLayer.querySelector('.sc-charge');
    var chargeBar = dotLayer.querySelector('.sc-charge-bar');
    var labelEl = dotLayer.querySelector('.sc-label');

    var canvas = document.createElement('canvas');
    canvas.className = 'sc-trail';
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);

    function sizeCanvas() {
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function mount() {
        // park off-screen so the first paint happens before anyone sees it
        ringLayer.style.transform = dotLayer.style.transform = 'translate3d(-300px,-300px,0)';
        if (CFG.trail && ctx) { document.body.appendChild(canvas); sizeCanvas(); }
        document.body.appendChild(ringLayer);
        document.body.appendChild(dotLayer);
        watchTheme();
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    /* ----- helpers ----- */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function setPos(x, y) { mx = clamp(x, 0, vw); my = clamp(y, 0, vh); }
    function isMouse(e) { return !e.pointerType || e.pointerType === 'mouse' || e.pointerType === 'pen'; }
    function placeDot() { dotLayer.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)'; }

    function show() {
        if (ready) return;
        ready = true;
        rx = mx; ry = my; px = mx; py = my;
        placeDot();
        ringLayer.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
        ringLayer.classList.add('is-ready');
        dotLayer.classList.add('is-ready');
        root.classList.add('sc-cursor-on');   // real cursor disappears only now
        applyState('default');
    }

    function applyState(next) {
        if (next === state) return;
        state = next;
        ringLayer.setAttribute('data-state', next);
        dotLayer.setAttribute('data-state', next);
    }

    /* ----- which variant right now? ----- */
    var cacheT = null, cacheV = 'default', cacheAt = 0;

    function domState(t) {
        var now = performance.now();
        if (t === cacheT && now - cacheAt < 150) return cacheV;
        var v = 'default';
        if (t && t.closest) {
            var explicit = t.closest('[data-cursor]');
            var ev = explicit ? explicit.getAttribute('data-cursor') : '';
            if (ev === 'default' || ev === 'pointer' || ev === 'text' || ev === 'grab' || ev === 'loading' || ev === 'disabled') {
                v = (ev === 'grab' && t.closest('.is-dragging')) ? 'grabbing' : ev;
            } else if (t.closest(LOAD_SEL)) v = 'loading';
            else if (t.closest(DIS_SEL)) v = 'disabled';
            else if (t.closest('.is-dragging')) v = 'grabbing';
            else if (t.closest('.cr-card.is-active')) v = 'default';   // style.css says cursor: default
            else if (t.closest(GRAB_SEL)) v = 'grab';
            else if (t.closest(TEXT_SEL)) v = 'text';
            else if (t.closest(HOVER_SEL)) v = 'pointer';
            else if (CFG.textOverParagraphs && t.closest(PARA_SEL)) v = 'text';
        }
        cacheT = t; cacheV = v; cacheAt = now;
        return v;
    }

    function resolve(t) {
        if (forced) return forced;
        if (busyFlag) return 'loading';
        if (dragging) return 'grabbing';
        if (selecting) {
            var s = window.getSelection && window.getSelection();
            if (s && !s.isCollapsed) return 'text';
        }
        if (Date.now() < textUntil) return 'text';
        return domState(t);
    }

    /* ----- magnet ----- */
    var magnetEl = null, magnetT = null, magnetCand = null, magnetBox = null, magnetMeasured = 0;

    function findMagnet(t) {
        if (!CFG.magnet || !t || !t.closest) return null;
        if (t === magnetT) return magnetCand;
        magnetT = t;
        magnetCand = null;
        var el = t.closest(MAGNET_SEL);
        if (!el || el.closest('[data-cursor-magnet="off"]')) return null;
        var r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.width > CFG.magnetMaxW || r.height > CFG.magnetMaxH) return null;
        magnetCand = el;
        return el;
    }

    function measureMagnet() {
        if (!magnetEl) return;
        magnetMeasured = performance.now();
        var r = magnetEl.getBoundingClientRect();
        if (!r.width) { setMagnet(null); return; }
        var w = Math.round(r.width + 14), h = Math.round(r.height + 14);
        var rad = parseFloat(getComputedStyle(magnetEl).borderTopLeftRadius) || 0;
        var radius = Math.min(rad + 6, Math.min(w, h) / 2);
        magnetBox = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        ringBox.style.width = w + 'px';
        ringBox.style.height = h + 'px';
        ringBox.style.marginLeft = (-w / 2) + 'px';
        ringBox.style.marginTop = (-h / 2) + 'px';
        ringRot.style.setProperty('--sc-r', radius + 'px');
    }

    function setMagnet(el) {
        if (el === magnetEl) return;
        magnetEl = el;
        ringLayer.classList.toggle('is-magnet', !!el);
        if (el) { measureMagnet(); }
        else {
            magnetBox = null;
            ringBox.style.width = ringBox.style.height = ringBox.style.marginLeft = ringBox.style.marginTop = '';
            ringRot.style.removeProperty('--sc-r');
        }
    }

    /* ----- labels ----- */
    var labelText = '', labelFlip = false, labelUp = false;

    function labelFor(t, st) {
        if (t && t.closest) {
            var custom = t.closest('[data-cursor-label]');
            if (custom) return custom.getAttribute('data-cursor-label') || '';
        }
        if (st === 'grab' || st === 'grabbing') return 'DRAG';
        if (st === 'loading') return 'LOADING';
        if (st === 'disabled') return 'LOCKED';
        if (st === 'pointer' && t && t.closest) {
            if (t.closest('.fx-rail-item')) return '';          // the rail already has its own labels
            if (t.closest('.project-card')) return 'VIEW';
            if (t.closest('a[target="_blank"]')) return 'OPEN \u2197';
            if (t.closest('.faq-q')) return 'TOGGLE';
        }
        return '';
    }

    function setLabel(text) {
        if (!CFG.labels) text = '';
        if (text === labelText) return;
        labelText = text;
        if (text) labelEl.textContent = text;
        labelEl.classList.toggle('is-on', !!text);
    }

    /* ----- inspect (runs at most once per frame) ----- */
    function inspect(t) {
        var st = resolve(t);
        applyState(st);
        setMagnet(st === 'pointer' ? findMagnet(t) : null);
        setLabel(labelFor(t, st));
    }

    /* ----- tracking ----- */
    window.addEventListener('pointermove', function (e) {
        if (!isMouse(e)) return;
        setPos(e.clientX, e.clientY);
        if (!ready) show();
        placeDot();                    // dot never waits for a frame
        pendingTarget = e.target;
        needInspect = true;
    }, { passive: true });

    // leaving the window: park on the nearest edge and stay visible
    document.addEventListener('mouseleave', function (e) { setPos(e.clientX, e.clientY); placeDot(); });
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) { setPos(e.clientX, e.clientY); placeDot(); } });
    document.addEventListener('mouseenter', function (e) { setPos(e.clientX, e.clientY); show(); placeDot(); });

    window.addEventListener('resize', function () {
        vw = window.innerWidth; vh = window.innerHeight;
        setPos(mx, my);
        if (ctx) sizeCanvas();
        if (magnetEl) measureMagnet();
    });
    window.addEventListener('scroll', function () { pendingTarget = null; needInspect = true; magnetT = null; }, { passive: true, capture: true });
    window.addEventListener('blur', function () { release(); });

    /* ----- hold to charge ----- */
    var arm = null, popped = false;

    function cancelCharge() {
        arm = null; popped = false;
        chargeSvg.style.opacity = '0';
        chargeBar.style.strokeDashoffset = CIRC.toFixed(2);
    }

    function pop() {
        popped = true;
        var target = arm && arm.target;
        ringLayer.classList.add('is-pop');
        setTimeout(function () { ringLayer.classList.remove('is-pop'); }, 320);
        ripple(mx, my, 150, 0, 0.9);
        ripple(mx, my, 210, 110, 0.4);
        if (CFG.burst) burst(mx, my, 12);
        chargeSvg.style.opacity = '0';
        try { window.dispatchEvent(new CustomEvent('sc:charge', { detail: { x: mx, y: my, target: target } })); } catch (err) {}
    }

    function tickCharge(now) {
        if (!arm) return;
        if (Math.abs(mx - arm.x) + Math.abs(my - arm.y) > 10 && !popped) { cancelCharge(); return; }  // it's a drag, not a hold
        if (popped) return;
        var el = now - arm.t - CFG.chargeDelay;
        if (el <= 0) return;
        var p = Math.min(1, el / CFG.chargeTime);
        chargeSvg.style.opacity = '1';
        chargeBar.style.strokeDashoffset = (CIRC * (1 - p)).toFixed(2);
        if (p >= 1) pop();
    }

    /* ----- press / release / selection ----- */
    function release() {
        dragging = false; selecting = false;
        ringLayer.classList.remove('is-down');
        dotLayer.classList.remove('is-down');
        cancelCharge();
        pendingTarget = null; needInspect = true;
    }

    window.addEventListener('pointerdown', function (e) {
        if (!isMouse(e)) return;
        setPos(e.clientX, e.clientY);
        if (!ready) show();
        placeDot();
        ringLayer.classList.add('is-down');
        dotLayer.classList.add('is-down');

        var t = e.target, st = resolve(t);
        if (e.button === 0) {
            if (st === 'grab') dragging = true;
            else if (st === 'default') selecting = true;
            if (CFG.charge && (st === 'pointer' || st === 'default')) {
                arm = { t: performance.now(), x: mx, y: my, target: t };
                popped = false;
            }
        }
        pendingTarget = t; needInspect = true;

        ripple(mx, my, 70, 0, 0.85);
        ripple(mx, my, 110, 90, 0.45);
        if (CFG.burst && st !== 'text' && st !== 'disabled') burst(mx, my, 6);
    }, { passive: true });

    window.addEventListener('pointerup', function (e) { if (isMouse(e)) release(); }, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });

    // double-click selects a word: keep the I-beam up for a moment
    document.addEventListener('dblclick', function () {
        var s = window.getSelection && window.getSelection();
        if (s && !s.isCollapsed) { textUntil = Date.now() + 900; pendingTarget = null; needInspect = true; }
    });

    /* ----- click FX ----- */
    function svgShape(kind, size) {
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', size); svg.setAttribute('height', size);
        svg.setAttribute('viewBox', '0 0 20 20');
        var el;
        if (kind === 'tri') {
            el = document.createElementNS(NS, 'polygon'); el.setAttribute('points', '10,2 18,17 2,17');
        } else if (kind === 'sq') {
            el = document.createElementNS(NS, 'rect');
            el.setAttribute('x', 3); el.setAttribute('y', 3); el.setAttribute('width', 14); el.setAttribute('height', 14);
        } else {
            el = document.createElementNS(NS, 'circle');
            el.setAttribute('cx', 10); el.setAttribute('cy', 10); el.setAttribute('r', 7);
        }
        el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
        el.setAttribute('stroke-width', '1.6'); el.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(el);
        return svg;
    }

    function ripple(x, y, size, delay, opacity) {
        if (reduce) return;
        var r = document.createElement('div');
        r.className = 'sc-ripple';
        r.style.width = r.style.height = size + 'px';
        r.style.marginLeft = r.style.marginTop = (-size / 2) + 'px';
        document.body.appendChild(r);
        var a = r.animate([
            { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(0.1)', opacity: opacity },
            { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(1)', opacity: 0 }
        ], { duration: 650, delay: delay, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
        a.onfinish = function () { r.remove(); };
    }

    function burst(x, y, count) {
        var kinds = ['tri', 'sq', 'circ'];
        count = count || 6;
        if (lite) count = Math.min(count, 3);
        var offset = Math.random() * Math.PI * 2;
        for (var i = 0; i < count; i++) {
            var size = 9 + Math.random() * 5;
            var angle = offset + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            var dist = (count > 6 ? 50 : 34) + Math.random() * (count > 6 ? 50 : 34);
            var tx = x + Math.cos(angle) * dist, ty = y + Math.sin(angle) * dist;
            var spin = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 180);

            var s = document.createElement('div');
            s.className = 'sc-shape';
            s.style.marginLeft = s.style.marginTop = (-size / 2) + 'px';
            s.appendChild(svgShape(kinds[i % kinds.length], size));
            document.body.appendChild(s);

            (function (node) {
                var a = node.animate([
                    { transform: 'translate3d(' + x + 'px,' + y + 'px,0) rotate(0deg) scale(0.3)', opacity: 0.95 },
                    { transform: 'translate3d(' + tx + 'px,' + ty + 'px,0) rotate(' + spin + 'deg) scale(1)', opacity: 0 }
                ], { duration: 600 + Math.random() * 250, easing: 'cubic-bezier(.15,.8,.3,1)', fill: 'both' });
                a.onfinish = function () { node.remove(); };
            })(s);
        }
    }

    /* ----- theme colour (read only when the theme actually changes) ----- */
    var trailRGB = '245,245,245';
    function readColor() {
        var c = getComputedStyle(dotLayer).color.match(/\d+(\.\d+)?/g);
        if (c && c.length >= 3) trailRGB = (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0);
    }
    function watchTheme() {
        readColor();
        if (!window.MutationObserver) return;
        var mo = new MutationObserver(readColor);
        mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }

    /* ----- trail: dirty-rect cleared, so only the area it touches is repainted ----- */
    var pts = [], marks = [], lastX = mx, lastY = my, travelled = 0, prevBox = null;

    function drawTrail(now) {
        if (!CFG.trail || !ctx || !ready) return;

        var visible = state !== 'text' && state !== 'loading';
        var dx = mx - lastX, dy = my - lastY;
        if (visible && (dx > 0.5 || dx < -0.5 || dy > 0.5 || dy < -0.5)) {
            pts.push({ x: mx, y: my, t: now });
            travelled += Math.sqrt(dx * dx + dy * dy);
            if (travelled >= CFG.trailMarkerEvery) {
                travelled = 0;
                marks.push({ x: mx, y: my, t: now, r: 2 + Math.random() * 1.5 });
            }
        }
        lastX = mx; lastY = my;

        while (pts.length && now - pts[0].t > CFG.trailLife) pts.shift();
        while (marks.length && now - marks[0].t > CFG.trailLife * 1.6) marks.shift();

        if (!pts.length && !marks.length) {
            if (prevBox) { ctx.clearRect(prevBox.x, prevBox.y, prevBox.w, prevBox.h); prevBox = null; }
            return;
        }

        // bounding box of everything we're about to draw
        var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, i, p;
        for (i = 0; i < pts.length; i++) {
            p = pts[i];
            if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
        }
        for (i = 0; i < marks.length; i++) {
            p = marks[i];
            if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
        }
        var box = { x: x0 - 10, y: y0 - 10, w: x1 - x0 + 20, h: y1 - y0 + 20 };
        var ux = box.x, uy = box.y, uw = box.w, uh = box.h;
        if (prevBox) {
            ux = Math.min(box.x, prevBox.x); uy = Math.min(box.y, prevBox.y);
            uw = Math.max(box.x + box.w, prevBox.x + prevBox.w) - ux;
            uh = Math.max(box.y + box.h, prevBox.y + prevBox.h) - uy;
        }
        ctx.clearRect(ux, uy, uw, uh);
        prevBox = box;

        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (i = 1; i < pts.length; i++) {
            var a = pts[i - 1], b = pts[i];
            var life = 1 - (now - b.t) / CFG.trailLife;
            if (life <= 0) continue;
            ctx.strokeStyle = 'rgba(' + trailRGB + ',' + (life * 0.5).toFixed(3) + ')';
            ctx.lineWidth = 0.6 + life * 2.2;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }

        ctx.lineWidth = 1;
        for (var j = 0; j < marks.length; j++) {
            var m = marks[j];
            var ml = 1 - (now - m.t) / (CFG.trailLife * 1.6);
            if (ml <= 0) continue;
            ctx.strokeStyle = 'rgba(' + trailRGB + ',' + (ml * 0.55).toFixed(3) + ')';
            var sz = m.r * 2 * (0.6 + ml * 0.6);
            ctx.save();
            ctx.translate(m.x, m.y);
            ctx.rotate((1 - ml) * 1.2);
            ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
            ctx.restore();
        }
    }

    /* ----- velocity stretch ----- */
    var spd = 0, ang = 0, lastStretch = '', lastRingStretch = '';

    function applyStretch() {
        var dx = mx - px, dy = my - py;
        px = mx; py = my;
        var sp = Math.sqrt(dx * dx + dy * dy);
        spd += (sp - spd) * 0.25;
        if (sp > 0.8) ang = Math.atan2(dy, dx);

        var allow = CFG.stretch && !magnetEl && (state === 'default' || state === 'pointer');
        var k = allow ? Math.min(spd / 28, 1) : 0;

        var dotT = k > 0.03 ? 'rotate(' + ang.toFixed(3) + 'rad) scale(' + (1 + k * 1.7).toFixed(3) + ',' + (1 - k * 0.35).toFixed(3) + ')' : '';
        if (dotT !== lastStretch) { dotStretch.style.transform = dotT; lastStretch = dotT; }

        var ringT = k > 0.03 ? 'rotate(' + ang.toFixed(3) + 'rad) scale(' + (1 + k * 0.22).toFixed(3) + ',' + (1 - k * 0.14).toFixed(3) + ')' : '';
        if (ringT !== lastRingStretch) { ringBox.style.transform = ringT; lastRingStretch = ringT; }
    }

    /* ----- adaptive performance guard -----
       If the page is struggling (3D background booting, heavy scripts...) the
       cursor drops the expensive extras (trail, stretch, big bursts) on its own
       and brings them back once frames are smooth again.                      */
    var lastFrame = 0, ema = 16, lite = false, calmSince = 0;

    function clearTrail() {
        pts.length = 0; marks.length = 0;
        if (prevBox && ctx) { ctx.clearRect(prevBox.x, prevBox.y, prevBox.w, prevBox.h); prevBox = null; }
    }

    function perfGuard(now) {
        if (lastFrame) {
            var d = now - lastFrame;
            if (d < 250) ema += (d - ema) * 0.1;      // ignore gaps from tab switches
        }
        lastFrame = now;
        if (!lite) {
            if (ema > 26) {                           // slower than ~38fps
                lite = true; calmSince = 0;
                clearTrail();
                dotStretch.style.transform = ringBox.style.transform = '';
                lastStretch = lastRingStretch = '';
            }
        } else if (ema < 20) {                        // smooth again for 1.5s
            if (!calmSince) calmSince = now;
            else if (now - calmSince > 1500) lite = false;
        } else calmSince = 0;
    }

    /* ----- main loop ----- */
    function frame(now) {
        requestAnimationFrame(frame);
        perfGuard(now);
        if (!ready) return;

        if (needInspect) {
            needInspect = false;
            inspect(pendingTarget || document.elementFromPoint(mx, my));
        }
        if (magnetEl && now - magnetMeasured > 160) measureMagnet();

        // ring eases toward the pointer, or toward the centre of its magnet
        var tx = mx, ty = my;
        if (magnetEl && magnetBox) {
            tx = magnetBox.cx + (mx - magnetBox.cx) * CFG.magnetPull;
            ty = magnetBox.cy + (my - magnetBox.cy) * CFG.magnetPull;
        }
        var ease = magnetEl ? 0.28 : 0.18;
        rx += (tx - rx) * ease;
        ry += (ty - ry) * ease;
        ringLayer.style.transform = 'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0)';

        if (!lite) { applyStretch(); drawTrail(now); }
        tickCharge(now);

        // keep the label on-screen
        if (labelText) {
            var flip = mx > vw - 150, up = my > vh - 50;
            if (flip !== labelFlip) { labelFlip = flip; labelEl.classList.toggle('is-flip', flip); }
            if (up !== labelUp) { labelUp = up; labelEl.classList.toggle('is-up', up); }
        }
    }
    requestAnimationFrame(frame);

    /* ----- tiny public API ----- */
    window.SCCursor = {
        busy: function (on) { busyFlag = !!on; pendingTarget = null; needInspect = true; },
        setState: function (name) { forced = name || null; pendingTarget = null; needInspect = true; },
        burst: function (x, y, n) { if (CFG.burst) burst(x == null ? mx : x, y == null ? my : y, n); },
        perf: function () { return { frameMs: +ema.toFixed(1), fps: Math.round(1000 / ema), lite: lite }; },
        config: CFG
    };
})();