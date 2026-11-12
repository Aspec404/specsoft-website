/* ==========================================================================
   SPECSOFT® chats-collapse.js
   The left sidebar of the chats page can shrink to an icon-only rail.
   PC ONLY: mouse / trackpad and a window wider than 1100px. Phones and
   tablets keep their drawer exactly as it is.

   - click the little round arrow on the sidebar's right edge to collapse / expand
   - in the collapsed rail "My chats" and "Communities" become icons
   - badges stay visible, and every icon shows its name as a tooltip
   - your choice is remembered on this device

   Load AFTER chats.js:   <script src="chats-collapse.js"></script>
   It injects its own CSS, so there is no other file to change.
   ========================================================================== */
(function () {
    'use strict';

    var KEY = 'specsoft.chats.sideCollapsed';
    var RAIL = 72;      // width of the collapsed rail, in px

    var ICON_CHAT = '<svg class="ch-nav-subico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>';
    var ICON_USERS = '<svg class="ch-nav-subico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';

    var pc = window.matchMedia ? window.matchMedia('(min-width: 1101px) and (pointer: fine)') : null;
    var app = null, side = null, btn = null;
    var collapsed = false;

    /* ---- css ---- */
    var css = document.createElement('style');
    css.id = 'chCollapseStyle';
    css.textContent = [
        '.ch-side-toggle { display: none; }',
        '.ch-nav-item > svg.ch-nav-subico { display: none; }',
        '@media (min-width: 1101px) and (pointer: fine) {',
        '  .ch-side { position: relative; z-index: 5; }',
        '  .ch-side-toggle { display: grid; place-items: center; position: absolute; top: 26px; right: -13px; z-index: 40; width: 26px; height: 26px; padding: 0; border-radius: 50%; border: 1px solid var(--border-hover, #404040); background: var(--bg-card, #080808); color: var(--text-secondary, #999); cursor: pointer; opacity: 0.75; transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease; }',
        '  .ch-side-toggle:hover, .ch-side-toggle:focus-visible { opacity: 1; color: var(--text-primary, #f5f5f5); background: var(--accent-dim, rgba(255,255,255,0.06)); }',
        '  .ch-side-toggle svg { width: 14px; height: 14px; transition: transform 0.2s ease; }',
        '  .ch-app.ch-side-collapsed .ch-side-toggle svg { transform: rotate(180deg); }',

        '  .ch-app.ch-side-collapsed { grid-template-columns: ' + RAIL + 'px var(--ch-list-w, minmax(280px, 340px)) minmax(0, 1fr); }',
        '  .ch-app.ch-side-collapsed .ch-side { padding-left: 10px; padding-right: 10px; }',

        '  .ch-app.ch-side-collapsed .ch-brand { justify-content: center; padding: 4px 0 18px; }',
        '  .ch-app.ch-side-collapsed .ch-brand-text { display: none; }',

        '  .ch-app.ch-side-collapsed .ch-nav-item { justify-content: center; gap: 0; padding: 0; }',
        '  .ch-app.ch-side-collapsed .ch-nav-text,',
        '  .ch-app.ch-side-collapsed .ch-nav-parent { display: none; }',

        /* the "Chats" group row is hidden, its two items become icons (shown even if the group was folded) */
        '  .ch-app.ch-side-collapsed .ch-nav-sub, .ch-app.ch-side-collapsed .ch-nav-sub[hidden] { display: flex !important; margin: 0; padding: 0; border: 0; gap: 4px; }',
        '  .ch-app.ch-side-collapsed .ch-nav-subitem { min-height: 46px; }',
        '  .ch-app.ch-side-collapsed .ch-nav-item > svg.ch-nav-subico { display: block; width: 19px; height: 19px; flex: 0 0 auto; }',

        /* badges become a small pill on the icon's corner */
        '  .ch-app.ch-side-collapsed .ch-nav-item .ch-badge { position: absolute; top: 4px; right: 6px; min-width: 16px; height: 16px; padding: 0 4px; font-size: 9px; }',

        '  .ch-app.ch-side-collapsed .ch-side-foot { justify-content: center; padding-left: 0; padding-right: 0; }',
        '  .ch-app.ch-side-collapsed .ch-me { flex: 0 0 auto; justify-content: center; }',
        '  .ch-app.ch-side-collapsed .ch-me-text, .ch-app.ch-side-collapsed .ch-me-caret { display: none; }',
        '}'
    ].join('\n');
    document.head.appendChild(css);

    /* ---- helpers ---- */
    function load() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
    function save() { try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch (e) { /* private mode */ } }

    // tooltips for the icon-only rail (removed again when it opens)
    function paintTips() {
        var on = collapsed && pc && pc.matches;
        side.querySelectorAll('.ch-nav-item').forEach(function (a) {
            if (on) {
                var t = a.querySelector('.ch-nav-text');
                if (t && !a.title) { a.title = t.textContent.trim(); a.setAttribute('data-ch-tip', ''); }
            } else if (a.hasAttribute('data-ch-tip')) {
                a.removeAttribute('title');
                a.removeAttribute('data-ch-tip');
            }
        });
    }

    function apply() {
        app.classList.toggle('ch-side-collapsed', collapsed);
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', collapsed ? 'Expand the sidebar' : 'Collapse the sidebar');
        btn.title = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar';
        paintTips();
    }

    function init() {
        app = document.getElementById('chApp') || document.querySelector('.ch-app');
        side = document.getElementById('chSide');
        if (!app || !side || side.querySelector('.ch-side-toggle')) return;

        // icons for the two sub items (only visible in the collapsed rail)
        var mine = side.querySelector('.ch-nav-subitem[data-nav="mine"]');
        var comm = side.querySelector('.ch-nav-subitem[data-nav="communities"]');
        if (mine && !mine.querySelector('.ch-nav-subico')) mine.insertAdjacentHTML('afterbegin', ICON_CHAT);
        if (comm && !comm.querySelector('.ch-nav-subico')) comm.insertAdjacentHTML('afterbegin', ICON_USERS);

        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ch-side-toggle';
        btn.setAttribute('aria-controls', 'chSide');
        btn.innerHTML = ICON_ARROW;
        btn.addEventListener('click', function () { collapsed = !collapsed; save(); apply(); });
        side.appendChild(btn);

        collapsed = load();
        apply();

        if (pc) {
            var change = function () { paintTips(); };
            if (pc.addEventListener) pc.addEventListener('change', change); else if (pc.addListener) pc.addListener(change);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
