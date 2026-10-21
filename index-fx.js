/* ==========================================================================
   SPECSOFT® index-fx.js  -  homepage-only "LIVE TERMINAL OS" depth layer

   Everything here is progressive enhancement: if this file never runs (ad
   blocker, JS error, slow network), the page still reads fine top to bottom
   with its existing fadeInUp animations — nothing here hides content by
   default in HTML/CSS, hiding only ever happens via a class THIS file adds
   right before it animates that same thing back in.

   Systems, each independent and individually skipped for
   prefers-reduced-motion / touch devices:
     1. radar glow     — cursor-tracked grid highlight (#gridGlow)
     2. 3D tilt+glare  — hero terminal + project/clan cards
     3. cursor reticle — crosshair that trails the pointer, echoes the
                          four static HUD crosshairs already in the corners
     4. headline decode— the two plain headline lines scramble into place
     5. terminal boot  — the hero code block types itself out, line by line
     6. scroll reveal  — sections/cards fade up with a scanline sweep
     7. scroll rail    — desktop HUD nav dots tracking the active section
     8. magnetic CTAs  — primary/secondary buttons drift slightly toward the cursor
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
       1. RADAR GLOW
       ---------------------------------------------------------------------- */
    function initRadar() {
        var glow = document.getElementById('gridGlow');
        if (!glow || reduceMotion()) return;

        glow.classList.add('fx-live');
        glow.style.opacity = '0';

        var raf = null, tx = 50, ty = 50;
        function queue(x, y) {
            tx = x; ty = y;
            if (!raf) raf = requestAnimationFrame(apply);
        }
        function apply() {
            raf = null;
            glow.style.setProperty('--glow-x', tx + '%');
            glow.style.setProperty('--glow-y', ty + '%');
            glow.style.opacity = '1';
        }
        function onMove(e) {
            var p = e.touches ? e.touches[0] : e;
            queue((p.clientX / window.innerWidth) * 100, (p.clientY / window.innerHeight) * 100);
        }
        window.addEventListener('mousemove', onMove, { passive: true });
        document.addEventListener('mouseleave', function () { glow.style.opacity = '0'; });
    }

    /* ----------------------------------------------------------------------
       2. 3D TILT + GLARE
       ---------------------------------------------------------------------- */
    function makeTilt(el, opts) {
        opts = opts || {};
        var maxDeg = opts.maxDeg || 8;
        var lift = opts.lift || 0;
        var scale = opts.scale || 1;

        var glare = document.createElement('div');
        glare.className = 'fx-glare';
        glare.setAttribute('aria-hidden', 'true');
        el.appendChild(glare);
        el.classList.add('fx-tilt');

        var rect = null, raf = null, px = 0.5, py = 0.5, savedTransition = '';

        function onEnter() {
            rect = el.getBoundingClientRect();
            el.classList.add('fx-tilt-active');
            savedTransition = el.style.transition;
            el.style.transition = 'transform 70ms linear';
        }
        function onMove(e) {
            if (!rect) rect = el.getBoundingClientRect();
            px = (e.clientX - rect.left) / rect.width;
            py = (e.clientY - rect.top) / rect.height;
            if (!raf) raf = requestAnimationFrame(apply);
        }
        function apply() {
            raf = null;
            var rx = (0.5 - py) * maxDeg * 2;
            var ry = (px - 0.5) * maxDeg * 2;
            el.style.transform = 'perspective(1000px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' +
                ry.toFixed(2) + 'deg) translateY(' + lift + 'px) scale(' + scale + ')';
            glare.style.background = 'radial-gradient(circle at ' + (px * 100).toFixed(1) + '% ' +
                (py * 100).toFixed(1) + '%, rgba(255,255,255,0.22), transparent 60%)';
        }
        function onLeave() {
            el.classList.remove('fx-tilt-active');
            el.style.transition = savedTransition;
            el.style.transform = '';
            glare.style.background = '';
            rect = null;
        }

        el.addEventListener('mouseenter', onEnter);
        el.addEventListener('mousemove', onMove);
        el.addEventListener('mouseleave', onLeave);
        window.addEventListener('resize', function () { rect = null; });
    }

    function initTilts() {
        if (reduceMotion()) return;
        var hero = document.querySelector('.code-window');
        if (hero) makeTilt(hero, { maxDeg: 10, lift: -6, scale: 1.015 });
        document.querySelectorAll('.project-card, .clan-card, .pillar-card, .build-card, .voice-card').forEach(function (card) {
            makeTilt(card, { maxDeg: 5 });
        });
    }

    /* ----------------------------------------------------------------------
       3. CURSOR RETICLE
       ---------------------------------------------------------------------- */
    function initReticle() {
        if (reduceMotion()) return;

        var dot = document.createElement('div');
        dot.className = 'fx-reticle';
        dot.setAttribute('aria-hidden', 'true');
        var ring = document.createElement('div');
        ring.className = 'fx-reticle-ring';
        dot.appendChild(ring);
        document.body.appendChild(dot);

        var tx = 0, ty = 0, cx = 0, cy = 0, raf = null, shown = false;

        function loop() {
            cx += (tx - cx) * 0.22;
            cy += (ty - cy) * 0.22;
            dot.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)';
            if (Math.abs(tx - cx) > 0.3 || Math.abs(ty - cy) > 0.3) raf = requestAnimationFrame(loop);
            else raf = null;
        }
        function onMove(e) {
            tx = e.clientX; ty = e.clientY;
            if (!shown) { shown = true; cx = tx; cy = ty; dot.classList.add('fx-visible'); }
            if (!raf) raf = requestAnimationFrame(loop);
        }

        document.addEventListener('mousemove', onMove, { passive: true });
        document.addEventListener('mouseleave', function () { dot.classList.remove('fx-visible'); });

        var hot = 'a, button, .project-card, .clan-card, .fx-rail-item, input, select, textarea';
        document.addEventListener('mouseover', function (e) {
            if (e.target.closest && e.target.closest(hot)) dot.classList.add('fx-hot');
        });
        document.addEventListener('mouseout', function (e) {
            if (!e.target.closest || !e.target.closest(hot)) return;
            var to = e.relatedTarget;
            if (!to || !to.closest || !to.closest(hot)) dot.classList.remove('fx-hot');
        });
    }

    /* ----------------------------------------------------------------------
       4. HEADLINE DECODE
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
       5. TERMINAL BOOT (hero code window types itself out)
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
       6. SCROLL REVEAL (+ scanline sweep)
       ---------------------------------------------------------------------- */
    function sweepOnce(el) {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        var sweep = document.createElement('div');
        sweep.className = 'fx-sweep';
        el.appendChild(sweep);
        requestAnimationFrame(function () { sweep.classList.add('fx-sweep-run'); });
        setTimeout(function () { sweep.remove(); }, 1000);
    }

    var revealObserver = null;
    function ensureRevealObserver() {
        if (revealObserver || !('IntersectionObserver' in window)) return revealObserver;
        revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('fx-in');
                sweepOnce(entry.target);
                revealObserver.unobserve(entry.target);
            });
        }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
        return revealObserver;
    }

    // registers one element with the reveal system — used for the static page
    // content below, and callable later by index-content.js for cards it
    // injects after a Supabase fetch (team roster, extra live projects)
    function registerReveal(el, delayMs) {
        if (!el) return;
        el.classList.add('fx-reveal');
        if (delayMs) el.style.transitionDelay = delayMs + 'ms';
        if (reduceMotion()) { el.classList.add('fx-in'); return; }
        var obs = ensureRevealObserver();
        if (obs) obs.observe(el); else el.classList.add('fx-in');
    }

    function initReveal() {
        var targets = document.querySelectorAll(
            '.section-header, .project-card, .clan-card, .roblox-section > p, .footer-cta, ' +
            '.pillar-card, .build-card, .stat-tile, .timeline-item, .voice-card, .faq-item'
        );
        targets.forEach(function (el, i) { registerReveal(el, Math.min(i % 4, 3) * 70); });

        // safety net: if anything is ever stuck, force it visible
        setTimeout(function () {
            document.querySelectorAll('.fx-reveal:not(.fx-in)').forEach(function (el) { el.classList.add('fx-in'); });
        }, 6000);
    }

    /* ----------------------------------------------------------------------
       7. SCROLL RAIL
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

        // only show once scrolled past the hero, so it never sits on top of the terminal
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
            // sections can be short enough that two are on screen at once, so track every
            // section's own visible ratio and always activate whichever is most visible,
            // rather than whichever observer entry happens to fire last in a batch
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
       8. MAGNETIC BUTTONS
       ---------------------------------------------------------------------- */
    function initMagnetic() {
        if (reduceMotion()) return;
        document.querySelectorAll('.btn-primary, .btn-secondary').forEach(function (btn) {
            btn.classList.add('fx-magnetic');
            var rect = null;
            btn.addEventListener('mouseenter', function () {
                rect = btn.getBoundingClientRect();
                btn.style.transition = 'transform 120ms ease-out';
            });
            btn.addEventListener('mousemove', function (e) {
                if (!rect) rect = btn.getBoundingClientRect();
                var x = e.clientX - (rect.left + rect.width / 2);
                var y = e.clientY - (rect.top + rect.height / 2);
                btn.style.transform = 'translate(' + (x * 0.18).toFixed(1) + 'px,' + (y * 0.28).toFixed(1) + 'px)';
            });
            btn.addEventListener('mouseleave', function () {
                btn.style.transition = '';
                btn.style.transform = '';
                rect = null;
            });
        });
    }

    /* ----------------------------------------------------------------------
       boot
       ---------------------------------------------------------------------- */
    function start() {
        try { initRadar(); } catch (e) {}
        try { initTilts(); } catch (e) {}
        try { initReticle(); } catch (e) {}
        try { initScramble(); } catch (e) {}
        try { initTypewriter(); } catch (e) {}
        try { initReveal(); } catch (e) {}
        try { initRail(); } catch (e) {}
        try { initMagnetic(); } catch (e) {}
    }

    window.SpecFX = {
        tilt: function (el, opts) { if (el && !reduceMotion()) makeTilt(el, opts); },
        reveal: registerReveal
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();