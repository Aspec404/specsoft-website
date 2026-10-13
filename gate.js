/* ==========================================================================
   SPECSOFT® — Intro Gate
   Runs before paint on every page. Fires intro.html on first visit per session.
   Load with a plain <script src> in <head>, NOT defer/async.
   ========================================================================== */
(function () {
    'use strict';

    var KEY = 'specsoft-intro-seen';
    var RETURN_KEY = 'specsoft-intro-return';

    // Users who've opted out of motion never see the intro
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
        return;
    }

    // Already seen this session → let page render normally
    try {
        if (sessionStorage.getItem(KEY) === '1') return;
    } catch (e) {
        // sessionStorage disabled (private mode, cookies blocked) — skip intro
        return;
    }

    // Don't redirect if we're already on intro.html (prevents loop)
    var page = location.pathname.split('/').pop() || 'index.html';
    if (page === 'intro.html') return;

    try {
        sessionStorage.setItem(KEY, '1');
        sessionStorage.setItem(RETURN_KEY, page + location.hash + location.search);
    } catch (e) {}

    window.location.replace('intro.html');
})();