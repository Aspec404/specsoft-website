/* ==========================================================================
   SPECSOFT® site-touch.js  -  tap effects for touch screens

   Phones and tablets have no pointer, so the desktop cursor never runs
   there. This gives them their own small set, controlled from
   Settings > Cursor > Touch screens:
     - tap effect   ripple / shapes / both / sparks
     - finger trail while you drag
     - hold ring    press and hold, a ring fills, then pops
     - vibration    Android only (iPhones do not allow it)

   Built for weak phones: effects are short, capped at 18 on screen at once,
   canvas is only created if the trail is on, nothing ever blocks scrolling
   or taps (passive listeners, no preventDefault), and everything switches
   off with Reduce motion.

   Loaded on demand by site-settings.js, only when a touch option is on
   (and on the settings page so the preview works with a mouse too).
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecTouch) return;

    var NS = 'http://www.w3.org/2000/svg';
    var S = window.SpecSettings;
    function val(k, d) {
        try { var v = S && S.view ? S.view(k) : undefined; return v === undefined ? d : v; } catch (e) { return d; }
    }
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function reduced() { return !!(mq && mq.matches) || val('reduceMotion', false) === true; }

    var css = document.createElement('style');
    css.textContent =
        '.tp-fx{position:fixed;left:0;top:0;pointer-events:none;z-index:2147483640;will-change:transform,opacity;' +
        'color:var(--sc-color,var(--text-primary,#f5f5f5))}' +
        '.tp-ripple{border:2px solid currentColor;border-radius:50%}' +
        '.tp-shape svg{display:block;overflow:visible}' +
        '.tp-spark{height:2px;border-radius:2px;background:currentColor;box-shadow:0 0 6px currentColor;transform-origin:0 50%}' +
        '.tp-hold{width:56px;height:56px;margin:-28px 0 0 -28px}' +
        '.tp-hold circle{fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round}' +
        '.tp-trail{position:fixed;left:0;top:0;pointer-events:none;z-index:2147483639;' +
        'color:var(--sc-color,var(--text-primary,#f5f5f5))}';
    document.head.appendChild(css);

    var live = 0, MAX = 18, down = null;

    function node(cls) {
        var n = document.createElement('div');
        n.className = 'tp-fx ' + (cls || '');
        return n;
    }
    function run(n, frames, opts) {
        if (!document.body || live >= MAX) return null;
        live++;
        document.body.appendChild(n);
        var a = n.animate(frames, opts);
        var done = function () { if (n.parentNode) n.remove(); live = Math.max(0, live - 1); };
        a.onfinish = done; a.oncancel = done;
        return a;
    }

    function ripple(x, y, size, delay, op) {
        var n = node('tp-ripple');
        n.style.width = n.style.height = size + 'px';
        n.style.marginLeft = n.style.marginTop = (-size / 2) + 'px';
        run(n, [
            { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(0.1)', opacity: op },
            { transform: 'translate3d(' + x + 'px,' + y + 'px,0) scale(1)', opacity: 0 }
        ], { duration: 560, delay: delay, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
    }

    function shapeSvg(kind, size) {
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', '0 0 20 20');
        var el;
        if (kind === 'tri') { el = document.createElementNS(NS, 'polygon'); el.setAttribute('points', '10,2 18,17 2,17'); }
        else if (kind === 'sq') {
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

    function shapes(x, y, count) {
        var kinds = ['tri', 'sq', 'circ'], off = Math.random() * Math.PI * 2;
        for (var i = 0; i < count; i++) {
            var size = 9 + Math.random() * 4;
            var ang = off + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            var dist = 30 + Math.random() * 30;
            var tx = x + Math.cos(ang) * dist, ty = y + Math.sin(ang) * dist;
            var spin = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 180);
            var n = node('tp-shape');
            n.style.marginLeft = n.style.marginTop = (-size / 2) + 'px';
            n.appendChild(shapeSvg(kinds[i % 3], size));
            run(n, [
                { transform: 'translate3d(' + x + 'px,' + y + 'px,0) rotate(0deg) scale(0.3)', opacity: 0.95 },
                { transform: 'translate3d(' + tx + 'px,' + ty + 'px,0) rotate(' + spin + 'deg) scale(1)', opacity: 0 }
            ], { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(.15,.8,.3,1)', fill: 'both' });
        }
    }

    function sparks(x, y, count) {
        var off = Math.random() * Math.PI * 2;
        for (var i = 0; i < count; i++) {
            var ang = off + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
            var dist = 24 + Math.random() * 40, len = 6 + Math.random() * 8;
            var deg = ang * 180 / Math.PI;
            var n = node('tp-spark');
            n.style.width = len + 'px';
            run(n, [
                { transform: 'translate3d(' + x + 'px,' + y + 'px,0) rotate(' + deg + 'deg) scaleX(0.2)', opacity: 1 },
                { transform: 'translate3d(' + (x + Math.cos(ang) * dist) + 'px,' + (y + Math.sin(ang) * dist) + 'px,0) rotate(' + deg + 'deg) scaleX(1)', opacity: 0 }
            ], { duration: 360 + Math.random() * 200, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'both' });
        }
    }

    function vibrate(ms) {
        if (val('tapVibrate', false) === true && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
    }

    function tap(x, y) {
        var fx = val('tapFx', 'none');
        if (fx === 'ripple' || fx === 'both') { ripple(x, y, 80, 0, 0.8); ripple(x, y, 120, 90, 0.4); }
        if (fx === 'burst' || fx === 'both') shapes(x, y, 5);
        if (fx === 'sparks') { ripple(x, y, 70, 0, 0.6); sparks(x, y, 8); }
        vibrate(8);
    }

    /* ---- hold ring ---- */
    var holdTimer = 0, holdAnim = null, holdNode = null, CIRC = 2 * Math.PI * 22;
    function cancelHold() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
        if (holdAnim) { var a = holdAnim; holdAnim = null; try { a.cancel(); } catch (e) { /* ignore */ } }
        if (holdNode) { holdNode.remove(); holdNode = null; }
    }
    function pop(x, y, target) {
        ripple(x, y, 150, 0, 0.9);
        if (val('tapFx', 'none') === 'sparks') sparks(x, y, 12); else shapes(x, y, 8);
        vibrate(22);
        try { window.dispatchEvent(new CustomEvent('sc:charge', { detail: { x: x, y: y, target: target } })); } catch (e) { /* ignore */ }
    }
    function startHold(x, y, target) {
        if (val('tapHold', false) !== true || !document.body) return;
        holdTimer = setTimeout(function () {
            holdTimer = 0;
            var n = node('tp-hold');
            n.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
            n.innerHTML = '<svg viewBox="0 0 56 56" width="56" height="56"><circle cx="28" cy="28" r="22" opacity="0.2"/>' +
                '<circle class="tp-hold-bar" cx="28" cy="28" r="22" transform="rotate(-90 28 28)" stroke-dasharray="' +
                CIRC.toFixed(1) + '" stroke-dashoffset="' + CIRC.toFixed(1) + '"/></svg>';
            document.body.appendChild(n);
            holdNode = n;
            var bar = n.querySelector('.tp-hold-bar');
            holdAnim = bar.animate([{ strokeDashoffset: CIRC }, { strokeDashoffset: 0 }], { duration: 600, easing: 'linear', fill: 'forwards' });
            holdAnim.onfinish = function () {
                holdAnim = null;
                if (holdNode) { holdNode.remove(); holdNode = null; }
                pop(x, y, target);
            };
        }, 350);
    }

    /* ---- finger trail (canvas is only created when this is turned on) ---- */
    var cv = null, cx = null, pts = [], raf = 0, rgb = '245,245,245', LIFE = 450;
    function sizeTrail() { if (cv) { cv.width = window.innerWidth; cv.height = window.innerHeight; } }
    function ensureTrail() {
        if (cv) return true;
        if (!document.body) return false;
        cv = document.createElement('canvas');
        cv.className = 'tp-trail';
        cx = cv.getContext ? cv.getContext('2d') : null;
        if (!cx) { cv = null; return false; }
        sizeTrail();
        document.body.appendChild(cv);
        return true;
    }
    function dropTrail() {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        pts.length = 0;
        if (cv) { cv.remove(); cv = null; cx = null; }
    }
    function readRGB() {
        var c = getComputedStyle(cv).color.match(/\d+(\.\d+)?/g);
        if (c && c.length >= 3) rgb = (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0);
    }
    function trailAdd(x, y) {
        if (val('tapTrail', 'off') === 'off' || !ensureTrail()) return;
        if (!pts.length) readRGB();
        pts.push({ x: x, y: y, t: performance.now() });
        if (pts.length > 40) pts.shift();
        if (!raf) raf = requestAnimationFrame(drawTrail);
    }
    function drawTrail(now) {
        raf = 0;
        if (!cx) return;
        cx.clearRect(0, 0, cv.width, cv.height);
        while (pts.length && now - pts[0].t > LIFE) pts.shift();
        if (!pts.length) return;
        var st = val('tapTrail', 'off'), i, p;
        cx.lineCap = 'round'; cx.lineJoin = 'round';
        if (st === 'dots') {
            for (i = 0; i < pts.length; i += 2) {
                p = pts[i];
                var l = 1 - (now - p.t) / LIFE;
                if (l <= 0) continue;
                cx.fillStyle = 'rgba(' + rgb + ',' + (l * 0.7).toFixed(3) + ')';
                cx.beginPath(); cx.arc(p.x, p.y, 1.5 + l * 2.5, 0, 6.2832); cx.fill();
            }
        } else {
            for (i = 1; i < pts.length; i++) {
                var a = pts[i - 1], b = pts[i], life = 1 - (now - b.t) / LIFE;
                if (life <= 0) continue;
                if (st === 'glow') {
                    cx.strokeStyle = 'rgba(' + rgb + ',' + (life * 0.14).toFixed(3) + ')';
                    cx.lineWidth = 6 + life * 10;
                    cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
                }
                cx.strokeStyle = 'rgba(' + rgb + ',' + (life * (st === 'glow' ? 0.85 : 0.55)).toFixed(3) + ')';
                cx.lineWidth = st === 'thin' ? 0.8 + life * 1.4 : 1.2 + life * 2.6;
                cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
            }
        }
        raf = requestAnimationFrame(drawTrail);
    }

    /* ---- events (touch only; passive so scrolling is never delayed) ---- */
    function isTouch(e) { return e.pointerType === 'touch'; }
    window.addEventListener('pointerdown', function (e) {
        if (!isTouch(e) || reduced()) return;
        down = { id: e.pointerId, x: e.clientX, y: e.clientY };
        tap(e.clientX, e.clientY);
        startHold(e.clientX, e.clientY, e.target);
        trailAdd(e.clientX, e.clientY);
    }, { passive: true });
    window.addEventListener('pointermove', function (e) {
        if (!down || e.pointerId !== down.id) return;
        if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 12) cancelHold();
        trailAdd(e.clientX, e.clientY);
    }, { passive: true });
    function end(e) { if (down && (!e || e.pointerId === down.id)) { down = null; cancelHold(); } }
    window.addEventListener('pointerup', end, { passive: true });
    window.addEventListener('pointercancel', end, { passive: true });
    window.addEventListener('resize', sizeTrail);

    function refresh() {
        if (val('tapTrail', 'off') === 'off' || reduced()) dropTrail();
        if (val('tapHold', false) !== true || reduced()) cancelHold();
    }

    // demo() lets the settings page preview a tap with a mouse
    window.SpecTouch = { refresh: refresh, demo: function (x, y) { if (!reduced()) tap(x, y); } };
})();
