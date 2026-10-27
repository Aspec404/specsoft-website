/* ==========================================================================
   SPECSOFT® site-transitions.js  -  page transitions without a SPA

   This is still plain multi-page navigation (every page is its own real
   HTML file, loaded fresh) — there's no router here. What this adds is:
     - clicking a normal internal link fades the current page to black for
       ~280ms before the browser actually navigates, instead of a hard cut
     - the page you land on plays a one-shot scanline sweep across the top,
       on top of the already-rendered content (nothing is ever hidden while
       this script itself loads, so there's no flash/FOUC risk)

   Deliberately does NOT intercept: new-tab clicks (ctrl/cmd/shift/middle
   click), target="_blank" links, download links, external-origin links,
   same-page hash links (#section), or anything already handled elsewhere
   (e.g. the scroll rail's buttons aren't <a> tags, so they're untouched).
   ========================================================================== */
(function () {
    'use strict';
    function ssRead() { try { return JSON.parse(localStorage.getItem('specsoft.settings.v1') || '{}') || {}; } catch (e) { return {}; } }
    function ssOff(k) { return ssRead()[k] === false; }
    function ssOn(k) { return ssRead()[k] === true; }
    if (window.SpecTransitions) return;

    function reduceMotion() {
        return ssOn('reduceMotion') || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /* ---- arrival sweep, plays on top of the page, never hides anything ---- */
    function playArrival() {
        if (reduceMotion() || ssOff('transitions')) return;
        var bar = document.createElement('div');
        bar.className = 'pt-arrive';
        bar.setAttribute('aria-hidden', 'true');
        document.body.appendChild(bar);
        requestAnimationFrame(function () { bar.classList.add('pt-run'); });
        setTimeout(function () { bar.remove(); }, 800);
    }

    /* ---- leave fade, then real navigation ---- */
    var overlay = null;
    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.className = 'pt-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
        return overlay;
    }

    function qualifies(a, e) {
        if (ssOff('transitions')) return false;
        if (!a || !a.href) return false;
        if (e.defaultPrevented) return false;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
        if (a.target && a.target !== '' && a.target !== '_self') return false;
        if (a.hasAttribute('download')) return false;
        if (a.getAttribute('rel') === 'external') return false;

        var url;
        try { url = new URL(a.href, location.href); } catch (err) { return false; }
        if (url.origin !== location.origin) return false;

        // same-page hash link (e.g. "#about") — let normal in-page scrolling happen
        if (url.pathname === location.pathname && url.hash) return false;

        return true;
    }

    function onClick(e) {
        var a = e.target.closest ? e.target.closest('a[href]') : null;
        if (!qualifies(a, e)) return;

        e.preventDefault();
        var dest = a.href;

        if (reduceMotion()) { window.location.href = dest; return; }

        ensureOverlay().classList.add('is-leaving');
        setTimeout(function () { window.location.href = dest; }, 280);
    }

    function start() {
        document.addEventListener('click', onClick);
        playArrival();
    }

    window.SpecTransitions = {};

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
