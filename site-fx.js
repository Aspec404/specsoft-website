/* ==========================================================================
   SPECSOFT® site-fx.js  -  the generic "LIVE TERMINAL OS" layer, every page

   This is the page-agnostic half of what used to all live in index-fx.js.
   main.js auto-loads this file the same way it auto-loads roles.js and
   notifications.js, so it's already running on every page without you
   adding a single tag — including pages that don't exist yet (roblox.html,
   contact.html), the moment they include main.js like everything else does.

   What's in here only touches things that exist on (almost) every page:
     1. radar glow     — cursor-tracked grid highlight (#gridGlow), part of
                          the shared background layer every page already has
     2. 3D tilt+glare  — applies to the common card classes already in use
                          (.project-card, .clan-card, .pillar-card,
                          .build-card, .voice-card, .code-window) PLUS any
                          element anywhere, on any page, with a
                          data-tilt="8" attribute — no JS edits ever needed
                          to light up a new card, just add the attribute
     3. cursor reticle — crosshair trailing the pointer
     4. scroll reveal  — fade-up + scanline sweep, same common classes plus
                          a data-reveal attribute for anything else
     5. magnetic CTAs  — .btn-primary / .btn-secondary drift toward the cursor
     6. data-pulse     — a dot traveling along any .section-line .line

   What's NOT in here (stayed in index-fx.js, homepage only): the headline
   scramble-decode, the hero terminal typewriter boot, and the scroll rail —
   all three assume index.html's specific hero and section layout, so
   cloning them onto other pages would either do nothing or do something
   broken. See index-fx.js if a future page wants its own version of those.

   Progressive enhancement throughout: nothing here hides anything by
   default, and everything is skipped for prefers-reduced-motion / touch.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecFX) return;

    function reduceMotion() {
        return !!(window.matchMedia && (
            window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
            window.matchMedia('(hover: none)').matches
        ));
    }

    /* ----------------------------------------------------------------------
       1. RADAR GLOW — only does anything on a page that has #gridGlow
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
        if (!el || el.__fxTilted) return;
        el.__fxTilted = true;
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

        var sel = '.project-card, .clan-card, .pillar-card, .build-card, .voice-card, .team-card, [data-tilt]';
        document.querySelectorAll(sel).forEach(function (card) {
            var attr = card.getAttribute('data-tilt');
            makeTilt(card, { maxDeg: attr ? Number(attr) || 5 : 5 });
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

        var hot = 'a, button, .project-card, .clan-card, [data-tilt], .fx-rail-item, input, select, textarea';
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
       4. SCROLL REVEAL (+ scanline sweep) — exposed so any page's own JS
          (index-content.js, a future roblox.js, whatever) can register a
          card it builds after a fetch, the same way index-content.js does
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

    function registerReveal(el, delayMs) {
        if (!el || el.__fxRevealed) return;
        el.__fxRevealed = true;
        el.classList.add('fx-reveal');
        if (delayMs) el.style.transitionDelay = delayMs + 'ms';
        if (reduceMotion()) { el.classList.add('fx-in'); return; }
        var obs = ensureRevealObserver();
        if (obs) obs.observe(el); else el.classList.add('fx-in');
    }

    function initReveal() {
        var sel = '.section-header, .project-card, .clan-card, .roblox-section > p, .footer-cta, ' +
            '.pillar-card, .build-card, .stat-tile, .timeline-item, .voice-card, .faq-item, .team-card, [data-reveal]';
        var targets = document.querySelectorAll(sel);
        targets.forEach(function (el, i) { registerReveal(el, Math.min(i % 4, 3) * 70); });

        // safety net: if anything is ever stuck, force it visible
        setTimeout(function () {
            document.querySelectorAll('.fx-reveal:not(.fx-in)').forEach(function (el) { el.classList.add('fx-in'); });
        }, 6000);
    }

    /* ----------------------------------------------------------------------
       5. MAGNETIC BUTTONS
       ---------------------------------------------------------------------- */
    function initMagnetic() {
        if (reduceMotion()) return;
        document.querySelectorAll('.btn-primary, .btn-secondary, [data-magnetic]').forEach(function (btn) {
            if (btn.__fxMagnetic) return;
            btn.__fxMagnetic = true;
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
       6. DATA-PULSE — a dot traveling along any section's dashed header line
       ---------------------------------------------------------------------- */
    function initLinePulse() {
        if (reduceMotion()) return;
        document.querySelectorAll('.section-line .line').forEach(function (line, i) {
            if (line.__fxPulsed) return;
            line.__fxPulsed = true;
            var pulse = document.createElement('span');
            pulse.className = 'fx-pulse';
            pulse.setAttribute('aria-hidden', 'true');
            pulse.style.animationDelay = (i * 0.6) + 's';
            line.appendChild(pulse);
        });
    }

    /* ----------------------------------------------------------------------
       boot
       ---------------------------------------------------------------------- */
    function start() {
        try { initRadar(); } catch (e) {}
        try { initTilts(); } catch (e) {}
        try { initReticle(); } catch (e) {}
        try { initReveal(); } catch (e) {}
        try { initMagnetic(); } catch (e) {}
        try { initLinePulse(); } catch (e) {}
    }

    window.SpecFX = {
        tilt: function (el, opts) { if (el && !reduceMotion()) makeTilt(el, opts); },
        reveal: registerReveal
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
