/* ==========================================================================
   SPECSOFT® cursor.js  -  custom cursor v3

   - hides the real cursor (only after the first mouse move, so nothing breaks
     if this script fails)
   - dot (instant) + eased ring + crosshair ticks
   - monochrome trail on a canvas: tapered line + little square markers.
     Colour comes from --text-primary so it flips with body.light-mode
   - variants: default, pointer, text (I-beam), grab, grabbing, loading, disabled
       * text     -> inputs / textareas / contenteditable, and while you are
                     actually selecting text or after a double-click word select
       * grab     -> .cm-carousel-stage, .cr-stage  (and grabbing while dragging)
       * loading  -> [aria-busy="true"], .is-loading, .sidebar-logout:disabled
       * disabled -> :disabled / [aria-disabled="true"]
       * any element can opt in with data-cursor="pointer|text|grab|loading|disabled|default"
   - NEVER vanishes: coordinates are clamped to the viewport, so leaving the
     window parks the cursor on the nearest edge
   - click = ripple rings + small burst of triangle / square / circle outlines
   - tiny API:  SCCursor.busy(true|false)   SCCursor.setState('loading'|null)
   ========================================================================== */
(function () {
    'use strict';

    if (window.__scCursor) return;
    if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    window.__scCursor = true;

    /* ----- settings you can tweak ----- */
    var CFG = {
        trail: true,
        trailLife: 520,          // ms a trail point lives
        trailMarkerEvery: 38,    // px of travel between little square markers
        burst: true,
        textOverParagraphs: false // true = I-beam over every bit of body text
    };

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { CFG.trail = false; CFG.burst = false; }

    var NS = 'http://www.w3.org/2000/svg';
    var root = document.documentElement;
    var vw = window.innerWidth, vh = window.innerHeight;
    var mx = vw / 2, my = vh / 2;     // real pointer (clamped to viewport)
    var rx = mx, ry = my;             // eased ring
    var ready = false, down = false, dragging = false, selecting = false;
    var textUntil = 0, forced = null, busyFlag = false, state = '', needInspect = false;

    /* ----- selectors ----- */
    var TEXT_SEL  = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, [contenteditable=""], [contenteditable="true"]';
    var PARA_SEL  = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, code, .code-content';
    var HOVER_SEL = 'a, button, [role="button"], summary, label[for], select, input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], input[type="range"], input[type="file"], .faq-q, .project-card, .team-card, .build-card, .fx-rail-item, [data-cursor="pointer"]';
    var GRAB_SEL  = '.cm-carousel-stage, .cr-stage, [data-cursor="grab"]';
    var LOAD_SEL  = '[aria-busy="true"], .is-loading, .is-busy, .sidebar-logout:disabled, [data-cursor="loading"]';
    var DIS_SEL   = ':disabled, [aria-disabled="true"], [data-cursor="disabled"]';

    /* ----- build ----- */
    var GLYPH_GRAB = '<svg class="sc-glyph sc-glyph-grab" viewBox="0 0 52 52"><path d="M8 18V8h10M34 8h10v10M44 34v10H34M18 44H8V34"/></svg>';
    var GLYPH_SPIN = '<svg class="sc-glyph sc-glyph-spin" viewBox="0 0 52 52"><circle cx="26" cy="26" r="15" opacity="0.25"/><path class="sc-spin-arc" d="M26 11a15 15 0 0 1 15 15"/></svg>';
    var GLYPH_BAN  = '<svg class="sc-glyph sc-glyph-ban" viewBox="0 0 52 52"><circle cx="26" cy="26" r="13"/><line x1="17" y1="35" x2="35" y2="17"/></svg>';
    var IBEAM      = '<svg class="sc-ibeam" viewBox="0 0 10 26"><g class="sc-ibeam-blink"><path d="M2 2h6M5 2v22M2 24h6"/></g></svg>';

    var ringLayer = document.createElement('div');
    ringLayer.className = 'sc-layer sc-ring';
    ringLayer.innerHTML = '<div class="sc-ring-box"><div class="sc-ring-scale"><div class="sc-ring-rot"></div></div>' +
        GLYPH_GRAB + GLYPH_SPIN + GLYPH_BAN + '</div>';

    var dotLayer = document.createElement('div');
    dotLayer.className = 'sc-layer sc-dot';
    dotLayer.innerHTML = '<div class="sc-dot-core"></div>' + IBEAM;

    var canvas = document.createElement('canvas');
    canvas.className = 'sc-trail';
    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    var dpr = Math.min(2, window.devicePixelRatio || 1);

    function sizeCanvas() {
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function mount() {
        if (CFG.trail && ctx) { document.body.appendChild(canvas); sizeCanvas(); }
        document.body.appendChild(ringLayer);
        document.body.appendChild(dotLayer);
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

    /* ----- helpers ----- */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function setPos(x, y) { mx = clamp(x, 0, vw); my = clamp(y, 0, vh); }
    function isMouse(e) { return !e.pointerType || e.pointerType === 'mouse' || e.pointerType === 'pen'; }

    function show() {
        if (ready) return;
        ready = true;
        rx = mx; ry = my;
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
    function resolve(t) {
        if (forced) return forced;
        if (busyFlag) return 'loading';
        if (dragging) return 'grabbing';
        if (selecting) {
            var s = window.getSelection && window.getSelection();
            if (s && !s.isCollapsed) return 'text';
        }
        if (Date.now() < textUntil) return 'text';
        if (!t || !t.closest) return 'default';

        var explicit = t.closest('[data-cursor]');
        if (explicit) {
            var v = explicit.getAttribute('data-cursor');
            if (v === 'default' || v === 'pointer' || v === 'text' || v === 'grab' || v === 'loading' || v === 'disabled') {
                if (v === 'grab' && t.closest('.is-dragging')) return 'grabbing';
                return v;
            }
        }
        if (t.closest(LOAD_SEL)) return 'loading';
        if (t.closest(DIS_SEL))  return 'disabled';
        if (t.closest('.is-dragging')) return 'grabbing';
        if (t.closest('.cr-card.is-active')) return 'default';   // matches style.css (cursor: default)
        if (t.closest(GRAB_SEL)) return 'grab';
        if (t.closest(TEXT_SEL)) return 'text';
        if (t.closest(HOVER_SEL)) return 'pointer';
        if (CFG.textOverParagraphs && t.closest(PARA_SEL)) return 'text';
        return 'default';
    }
    function inspect(t) { applyState(resolve(t)); }

    /* ----- tracking ----- */
    window.addEventListener('pointermove', function (e) {
        if (!isMouse(e)) return;
        setPos(e.clientX, e.clientY);
        show();
        inspect(e.target);
    }, { passive: true });

    // leaving the window: park on the nearest edge and stay visible
    document.addEventListener('mouseleave', function (e) { setPos(e.clientX, e.clientY); });
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) setPos(e.clientX, e.clientY); });
    document.addEventListener('mouseenter', function (e) { setPos(e.clientX, e.clientY); show(); });

    window.addEventListener('resize', function () {
        vw = window.innerWidth; vh = window.innerHeight;
        setPos(mx, my);
        if (ctx) sizeCanvas();
    });
    window.addEventListener('scroll', function () { needInspect = true; }, { passive: true, capture: true });
    window.addEventListener('blur', function () { release(); });

    /* ----- press / release / selection ----- */
    function release() {
        down = false; dragging = false; selecting = false;
        ringLayer.classList.remove('is-down');
        dotLayer.classList.remove('is-down');
        needInspect = true;
    }

    window.addEventListener('pointerdown', function (e) {
        if (!isMouse(e)) return;
        setPos(e.clientX, e.clientY);
        show();
        down = true;
        ringLayer.classList.add('is-down');
        dotLayer.classList.add('is-down');

        var t = e.target, st = resolve(t);
        if (e.button === 0) {
            if (st === 'grab') dragging = true;
            else if (st === 'default' && !(t.closest && t.closest(HOVER_SEL))) selecting = true;
        }
        inspect(t);

        ripple(mx, my, 70, 0, 0.85);
        ripple(mx, my, 110, 90, 0.45);
        if (CFG.burst && st !== 'text' && st !== 'disabled') burst(mx, my);
    }, { passive: true });

    window.addEventListener('pointerup', function (e) {
        if (!isMouse(e)) return;
        release();
        inspect(document.elementFromPoint(mx, my));
    }, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });

    // double-click selects a word: keep the I-beam up for a moment
    document.addEventListener('dblclick', function () {
        var s = window.getSelection && window.getSelection();
        if (s && !s.isCollapsed) { textUntil = Date.now() + 900; needInspect = true; }
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

    function burst(x, y) {
        var kinds = ['tri', 'sq', 'circ', 'tri', 'sq', 'circ'];
        var count = 6, offset = Math.random() * Math.PI * 2;
        for (var i = 0; i < count; i++) {
            var size = 9 + Math.random() * 5;
            var angle = offset + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            var dist = 34 + Math.random() * 34;
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

    /* ----- trail (monochrome tapered line + tiny square markers) ----- */
    var pts = [], marks = [], lastX = mx, lastY = my, travelled = 0, trailColor = [245, 245, 245], colorTick = 0, drewLast = false;

    function readColor() {
        var c = getComputedStyle(dotLayer).color.match(/\d+(\.\d+)?/g);
        if (c && c.length >= 3) trailColor = [c[0] | 0, c[1] | 0, c[2] | 0];
    }

    function drawTrail(now) {
        if (!CFG.trail || !ctx || !ready) return;

        var show = state !== 'text' && state !== 'loading';
        var moved = Math.abs(mx - lastX) + Math.abs(my - lastY);
        if (show && moved > 0.5) {
            pts.push({ x: mx, y: my, t: now });
            travelled += Math.sqrt((mx - lastX) * (mx - lastX) + (my - lastY) * (my - lastY));
            if (travelled >= CFG.trailMarkerEvery) {
                travelled = 0;
                marks.push({ x: mx, y: my, t: now, r: 2 + Math.random() * 1.5 });
            }
        }
        lastX = mx; lastY = my;

        while (pts.length && now - pts[0].t > CFG.trailLife) pts.shift();
        while (marks.length && now - marks[0].t > CFG.trailLife * 1.6) marks.shift();

        if (!pts.length && !marks.length) {
            if (drewLast) { ctx.clearRect(0, 0, vw, vh); drewLast = false; }
            return;
        }
        drewLast = true;
        if (now - colorTick > 400) { colorTick = now; readColor(); }

        ctx.clearRect(0, 0, vw, vh);
        var rgb = trailColor.join(',');
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';

        for (var i = 1; i < pts.length; i++) {
            var a = pts[i - 1], b = pts[i];
            var life = 1 - (now - b.t) / CFG.trailLife;
            if (life <= 0) continue;
            ctx.strokeStyle = 'rgba(' + rgb + ',' + (life * 0.5).toFixed(3) + ')';
            ctx.lineWidth = 0.6 + life * 2.2;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }

        ctx.lineWidth = 1;
        for (var j = 0; j < marks.length; j++) {
            var m = marks[j];
            var ml = 1 - (now - m.t) / (CFG.trailLife * 1.6);
            if (ml <= 0) continue;
            ctx.strokeStyle = 'rgba(' + rgb + ',' + (ml * 0.55).toFixed(3) + ')';
            var sz = m.r * 2 * (0.6 + ml * 0.6);
            ctx.save();
            ctx.translate(m.x, m.y);
            ctx.rotate((1 - ml) * 1.2);
            ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
            ctx.restore();
        }
    }

    /* ----- main loop ----- */
    function frame(now) {
        rx += (mx - rx) * 0.18;
        ry += (my - ry) * 0.18;
        dotLayer.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
        ringLayer.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';

        if (needInspect && ready) {
            needInspect = false;
            inspect(document.elementFromPoint(mx, my));
        }
        drawTrail(now);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    /* ----- tiny public API ----- */
    window.SCCursor = {
        busy: function (on) { busyFlag = !!on; needInspect = true; },
        setState: function (name) { forced = name || null; needInspect = true; },
        burst: function (x, y) { if (CFG.burst) burst(x == null ? mx : x, y == null ? my : y); },
        config: CFG
    };
})();
