/* ==========================================================================
   SPECSOFT® index-fx.js  -  homepage-ONLY pieces of the "LIVE TERMINAL OS"

   Everything page-agnostic (radar glow, 3D tilt, cursor reticle, scroll
   reveal, magnetic buttons, data-pulse, the 3D background) now lives in
   site-fx.js, auto-loaded on every page by main.js. What's left here only
   makes sense on index.html, because each one assumes a piece of markup
   only the homepage has:
     1. headline decode — assumes .hero-left h1 (the homepage hero)
     2. terminal boot   — assumes .code-window (the homepage hero terminal)
     3. scroll rail     — assumes this exact page's section ids

   A future page that wants its own version of any of these should get its
   own small script, not this file — the ids and assumptions below are
   index.html's alone.
   ========================================================================== */
(function () {
    'use strict';

    function reduceMotion() {
        return !!(window.matchMedia && (
            window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
            window.matchMedia('(hover: none)').matches
        ));
    }

    /* ----------------------------------------------------------------------
       1. HEADLINE DECODE
       ---------------------------------------------------------------------- */
    var SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01#%&$@*+-/<>[]{}';

    function scrambleInto(textNode, finalText, duration) {
        var span = document.createElement('span');
        span.className = 'fx-scramble';
        textNode.parentNode.replaceChild(span, textNode);

        var len = finalText.length;
        var totalFrames = Math.max(10, Math.round(duration / 40));
        var frame = 0;
        var timer = setInterval(function () {
            frame++;
            var revealed = Math.min(len, Math.floor((frame / totalFrames) * len));
            var out = '';
            for (var k = 0; k < len; k++) {
                var ch = finalText[k];
                out += (ch === ' ' || k < revealed) ? ch : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
            }
            span.textContent = out;
            if (revealed >= len) { clearInterval(timer); span.textContent = finalText; }
        }, 40);
    }

    function initScramble() {
        if (reduceMotion()) return;
        var h1 = document.querySelector('.hero-left h1');
        if (!h1) return;
        var nodes = Array.prototype.slice.call(h1.childNodes).filter(function (n) {
            return n.nodeType === 3 && n.textContent.trim().length > 0;
        });
        nodes.forEach(function (n, i) {
            var text = n.textContent.trim();
            setTimeout(function () { scrambleInto(n, text, 550); }, 150 + i * 500);
        });
    }

    /* ----------------------------------------------------------------------
       2. TERMINAL BOOT (hero code window types itself out)
       ---------------------------------------------------------------------- */
    function initTypewriter() {
        if (reduceMotion()) return;
        var win = document.querySelector('.code-window');
        if (!win) return;
        var lines = Array.prototype.slice.call(win.querySelectorAll('.code-line'));
        if (!lines.length) return;

        win.classList.add('fx-typing');
        var caret = null;

        function revealLine(i) {
            if (i >= lines.length) return;
            var line = lines[i];
            line.classList.add('fx-typed');
            var content = line.querySelector('.code-content');
            if (caret) caret.remove();
            if (content) {
                caret = document.createElement('span');
                caret.className = 'fx-caret';
                content.appendChild(caret);
            }
            var len = content ? content.textContent.length : 0;
            var delay = Math.max(90, Math.min(380, len * 16));
            setTimeout(function () { revealLine(i + 1); }, delay);
        }

        setTimeout(function () { revealLine(0); }, 650);
    }

    /* ----------------------------------------------------------------------
       3. SCROLL RAIL
       ---------------------------------------------------------------------- */
    var RAIL_SECTIONS = [
        { id: 'home', label: 'HOME' },
        { id: 'about', label: '02 \u00B7 ABOUT' },
        { id: 'stats', label: '03 \u00B7 STATS' },
        { id: 'build', label: '04 \u00B7 BUILD' },
        { id: 'projects', label: '05 \u00B7 WORK' },
        { id: 'timeline', label: '06 \u00B7 TIMELINE' },
        { id: 'team', label: '07 \u00B7 TEAM' },
        { id: 'roblox', label: '08 \u00B7 ROBLOX' },
        { id: 'voices', label: '09 \u00B7 VOICES' },
        { id: 'faq', label: '10 \u00B7 FAQ' },
        { id: 'contact', label: 'CONTACT' }
    ];

    function initRail() {
        if (reduceMotion()) return;
        var present = RAIL_SECTIONS.filter(function (s) { return document.getElementById(s.id); });
        if (present.length < 2) return;

        var rail = document.createElement('nav');
        rail.className = 'fx-rail';
        rail.setAttribute('aria-label', 'Section navigation');

        var items = present.map(function (s) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'fx-rail-item';
            var label = document.createElement('span');
            label.className = 'fx-rail-label';
            label.textContent = s.label;
            var d = document.createElement('span');
            d.className = 'fx-rail-dot';
            btn.appendChild(label);
            btn.appendChild(d);
            btn.addEventListener('click', function () {
                var el = document.getElementById(s.id);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            rail.appendChild(btn);
            return btn;
        });
        document.body.appendChild(rail);

        var home = document.getElementById('home');
        var showAt = home ? home.getBoundingClientRect().height * 0.6 : 400;
        function syncVisibility() {
            rail.classList.toggle('fx-rail-visible', window.scrollY > showAt);
        }
        syncVisibility();
        window.addEventListener('scroll', syncVisibility, { passive: true });

        var sectionEls = present.map(function (s) { return document.getElementById(s.id); });
        function setActive(idx) {
            items.forEach(function (btn, i) { btn.classList.toggle('fx-active', i === idx); });
        }
        if ('IntersectionObserver' in window) {
            var ratios = sectionEls.map(function () { return 0; });
            var steps = [];
            for (var s = 0; s <= 20; s++) steps.push(s / 20);
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    var idx = sectionEls.indexOf(entry.target);
                    if (idx !== -1) ratios[idx] = entry.isIntersecting ? entry.intersectionRatio : 0;
                });
                var best = 0;
                for (var i = 1; i < ratios.length; i++) if (ratios[i] > ratios[best]) best = i;
                if (ratios[best] > 0) setActive(best);
            }, { threshold: steps });
            sectionEls.forEach(function (el) { io.observe(el); });
        }
        setActive(0);
    }

    /* ----------------------------------------------------------------------
       boot
       ---------------------------------------------------------------------- */
    function start() {
        try { initScramble(); } catch (e) {}
        try { initTypewriter(); } catch (e) {}
        try { initRail(); } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();