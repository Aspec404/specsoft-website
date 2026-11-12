/* ==========================================================================
   SPECSOFT® chats-resize.js
   Drag the edge of the chat list (the "My chats" panel) to make it wider or
   narrower. PC ONLY: mouse / trackpad and a window wider than 1100px.
   Phones and tablets are untouched.

   - drag the thin line on the right edge of the chat list
   - double-click it (or press Home while it is focused) to reset
   - Left / Right arrow keys resize it when the handle is focused
   - the width is remembered on this device

   Load AFTER chats.js:   <script src="chats-resize.js"></script>
   It injects its own CSS, so there is no other file to change.
   ========================================================================== */
(function () {
    'use strict';

    var KEY = 'specsoft.chats.listWidth';
    var MIN_LIST = 260;          // narrowest the list can get
    var MIN_MAIN = 420;          // the chat itself always keeps at least this much room
    var MAX_LIST = 720;
    var STEP = 16;

    var pc = window.matchMedia ? window.matchMedia('(min-width: 1101px) and (pointer: fine)') : null;
    function isPC() { return !!pc && pc.matches; }

    var app = null, list = null, handle = null, side = null;
    var width = 0;               // 0 = default (the CSS decides)
    var dragging = false;

    /* ---- css ---- */
    var css = document.createElement('style');
    css.id = 'chResizeStyle';
    css.textContent = [
        '.ch-resizer { display: none; }',
        '@media (min-width: 1101px) and (pointer: fine) {',
        '  .ch-app { grid-template-columns: minmax(220px, 250px) var(--ch-list-w, minmax(280px, 340px)) minmax(0, 1fr); }',
        '  .ch-list { position: relative; }',
        '  .ch-resizer { display: block; position: absolute; top: 0; bottom: 0; right: -5px; width: 11px; z-index: 30; touch-action: none; outline: none; }',
        '  .ch-resizer::before { content: ""; position: absolute; top: 0; bottom: 0; left: 5px; width: 2px; border-radius: 2px; background: var(--text-primary, #f5f5f5); opacity: 0; transition: opacity 0.15s ease; }',
        '  .ch-resizer:hover::before, .ch-resizer:focus-visible::before, .ch-resizer.is-dragging::before { opacity: 0.45; }',
        '  .ch-resizer.is-dragging::before { opacity: 0.8; }',
        '  .ch-app.ch-resizing, .ch-app.ch-resizing * { user-select: none !important; -webkit-user-select: none !important; }',
        '  .ch-app.ch-resizing { cursor: col-resize; }',
        '}'
    ].join('\n');
    document.head.appendChild(css);

    /* ---- helpers ---- */
    function clamp(w) {
        var sideW = side ? side.getBoundingClientRect().width : 250;
        var max = Math.min(MAX_LIST, window.innerWidth - sideW - MIN_MAIN);
        if (max < MIN_LIST) max = MIN_LIST;
        return Math.round(Math.max(MIN_LIST, Math.min(max, w)));
    }

    function apply(w) {
        width = w ? clamp(w) : 0;
        if (!app) return;
        if (width && isPC()) app.style.setProperty('--ch-list-w', width + 'px');
        else app.style.removeProperty('--ch-list-w');
        if (handle) {
            handle.setAttribute('aria-valuenow', String(width || Math.round(list.getBoundingClientRect().width)));
        }
    }

    function save() {
        try { if (width) localStorage.setItem(KEY, String(width)); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    }

    function load() {
        try { var v = parseInt(localStorage.getItem(KEY), 10); return v > 0 ? v : 0; } catch (e) { return 0; }
    }

    /* ---- dragging ---- */
    function onDown(e) {
        if (!isPC() || (e.button !== undefined && e.button !== 0)) return;
        dragging = true;
        handle.classList.add('is-dragging');       // the custom cursor shows "grabbing" while this class is on
        app.classList.add('ch-resizing');
        try { handle.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        e.preventDefault();
    }

    function onMove(e) {
        if (!dragging) return;
        apply(e.clientX - list.getBoundingClientRect().left);
    }

    function onUp(e) {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('is-dragging');
        app.classList.remove('ch-resizing');
        try { handle.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        save();
    }

    function onKey(e) {
        if (!isPC()) return;
        var cur = width || Math.round(list.getBoundingClientRect().width);
        if (e.key === 'ArrowLeft')       { apply(cur - STEP); save(); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { apply(cur + STEP); save(); e.preventDefault(); }
        else if (e.key === 'Home' || e.key === 'Enter') { apply(0); save(); e.preventDefault(); }
    }

    /* ---- start ---- */
    function init() {
        app = document.querySelector('.ch-app');
        list = document.getElementById('chList');
        side = document.getElementById('chSide');
        if (!app || !list || list.querySelector('.ch-resizer')) return;

        handle = document.createElement('div');
        handle.className = 'ch-resizer';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', 'Resize the chat list');
        handle.setAttribute('aria-valuemin', String(MIN_LIST));
        handle.setAttribute('aria-valuemax', String(MAX_LIST));
        handle.setAttribute('data-cursor', 'grab');
        handle.title = 'Drag to resize. Double-click to reset.';
        handle.tabIndex = 0;
        list.appendChild(handle);

        handle.addEventListener('pointerdown', onDown);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
        handle.addEventListener('dblclick', function () { apply(0); save(); });
        handle.addEventListener('keydown', onKey);

        apply(load());

        // keep the saved width valid when the window changes size
        window.addEventListener('resize', function () { if (width) apply(width); });
        if (pc) {
            var change = function () { apply(width); };
            if (pc.addEventListener) pc.addEventListener('change', change); else if (pc.addListener) pc.addListener(change);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
