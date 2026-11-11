/* ==========================================================================
   SPECSOFT® bottom-nav.js  -  floating bottom navigation + mobile toggle ball

   Loaded on every page that uses main.js (main.js loads it, see the loader at
   the end of main.js). It only builds itself on pages that have the normal
   left sidebar (#sidebar), so Chats and Spectra AI (own layouts) are skipped
   and nothing ever sits on top of their message bar.

   It does NOTHING visible unless Settings > Appearance > Navigation type is
   "Bottom navigation" (the <html> element gets the class ss-nav-bottom).

   TO EDIT THE MENU: change the NAV list below. Each item is
     { key, label, href, icon (svg inner), match: [page names], menu: {title, links} }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecBottomNav) return;

    var DOC = document.documentElement;
    var HIDE_KEY = 'specsoft.bottomnav.hidden';

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

    var NAV = [
        { key: 'home', label: 'Home', href: 'index.html', match: ['', 'index', 'home'],
          icon: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>' },
        { key: 'chats', label: 'Chats', href: 'chats.html', match: ['community', 'chats'],
          icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
          menu: { title: 'Chats', links: [['Community Hub', 'community.html'], ['Chats', 'chats.html']] } },
        { key: 'projects', label: 'Projects', href: 'projects.html', match: ['projects', 'spectra-ai', 'studio'],
          icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
          menu: { title: 'Projects', links: [['Projects Hub', 'projects.html'], ['Spectra AI', 'spectra-ai.html'], ['SPECSOFT Studios', 'studio.html']] } },
        { key: 'store', label: 'Store', href: 'store.html', match: ['store'],
          icon: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>' }
    ];
    var PROFILE_ICON = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';

    function eligible() {
        var b = document.body;
        if (!b) return false;
        if (b.classList.contains('ch-body') || b.classList.contains('sa-page')) return false;   // chats + Spectra keep their own menus
        return !!document.getElementById('sidebar');
    }

    function el(tag, cls, attrs) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
        return n;
    }
    function svg(inner) { return '<svg viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'; }
    function pageKey() { return (location.pathname.split('/').pop() || 'index.html').replace('.html', ''); }

    var root, dock, ball, profileItem, openItem = null, lastAuthed = null;

    /* ----------------------------------------------------------- menus */
    function makeMenu(title, rows) {
        var menu = el('div', 'bn-menu', { role: 'menu' });
        var t = el('div', 'bn-menu-title'); t.textContent = title; menu.appendChild(t);
        var cur = pageKey();
        rows.forEach(function (r) {
            var a;
            if (r.href) {
                a = el('a', 'bn-sub', { href: r.href, role: 'menuitem' });
                if (r.href.replace('.html', '') === cur) a.classList.add('is-current');
            } else {
                a = el('button', 'bn-sub', { type: 'button', role: 'menuitem', 'data-act': r.act });
            }
            a.appendChild(el('i', 'bn-dot'));
            var s = document.createElement('span'); s.textContent = r.label; a.appendChild(s);
            menu.appendChild(a);
        });
        return menu;
    }

    function makeItem(def) {
        var item = el('div', 'bn-item', { 'data-bn': def.key });
        var btn = el('a', 'bn-btn', { href: def.href });
        btn.innerHTML = svg(def.icon) + '<span class="bn-l"></span>';
        btn.querySelector('.bn-l').textContent = def.label;
        item.appendChild(btn);
        if (def.menu) {
            btn.setAttribute('aria-haspopup', 'true');
            btn.setAttribute('aria-expanded', 'false');
            item.classList.add('bn-has-menu');
            item.appendChild(makeMenu(def.menu.title, def.menu.links.map(function (l) { return { label: l[0], href: l[1] }; })));
        }
        if (def.match && def.match.indexOf(pageKey()) !== -1) item.classList.add('is-active');
        return item;
    }

    function isAuthed() {
        if (DOC.classList.contains('sp-authed')) return true;
        try { return !!(window.SpecAuth && window.SpecAuth.getUser && window.SpecAuth.getUser()); } catch (e) { return false; }
    }

    // My Profile / Log In item. Also the only way to reach Settings, theme and log out while the sidebar is hidden.
    function fillProfile() {
        var authed = isAuthed();
        lastAuthed = authed;
        var btn = profileItem.querySelector('.bn-btn');
        profileItem.classList.add('bn-has-menu');          // without this openMenu() skips the item
        btn.setAttribute('aria-haspopup', 'true');
        if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');
        btn.href = authed ? 'profile.html' : 'login.html';
        var lbl = btn.querySelector('.bn-l');
        lbl.textContent = '';
        if (authed) { var pre = document.createElement('i'); pre.textContent = 'My '; lbl.appendChild(pre); lbl.appendChild(document.createTextNode('Profile')); }
        else lbl.textContent = 'Log In';
        var rows = [{ label: authed ? 'My Profile' : 'Log In', href: authed ? 'profile.html' : 'login.html' },
                    { label: 'Settings', href: 'settings.html' }];
        if (authed) rows.push({ label: 'Log Out', act: 'logout' });
        if (openItem === profileItem) closeMenu(profileItem);
        var old = profileItem.querySelector('.bn-menu');
        var fresh = makeMenu('My Profile', rows);
        if (old) profileItem.replaceChild(fresh, old); else profileItem.appendChild(fresh);
        var k = pageKey();
        profileItem.classList.toggle('is-active', k === 'profile' || k === 'login');
    }

    /* ------------------------------------------------------ open / close */
    function canHover() { return !!(window.matchMedia && window.matchMedia('(hover: hover)').matches); }

    function place(item) {
        var menu = item.querySelector('.bn-menu');
        if (!menu) return;
        menu.style.setProperty('--bn-shift', '0px');
        var r = menu.getBoundingClientRect(), m = 10, vw = DOC.clientWidth, shift = 0;
        if (r.left < m) shift = m - r.left;
        else if (r.right > vw - m) shift = vw - m - r.right;
        menu.style.setProperty('--bn-shift', Math.round(shift) + 'px');
    }
    function openMenu(item) {
        if (!item.classList.contains('bn-has-menu')) return;
        if (openItem && openItem !== item) closeMenu(openItem);
        item.classList.add('is-open');
        var b = item.querySelector('.bn-btn'); if (b) b.setAttribute('aria-expanded', 'true');
        place(item);
        openItem = item;
    }
    function closeMenu(item) {
        if (!item) return;
        item.classList.remove('is-open');
        var b = item.querySelector('.bn-btn'); if (b) b.setAttribute('aria-expanded', 'false');
        if (openItem === item) openItem = null;
    }

    function wireItem(item) {
        if (!item.classList.contains('bn-has-menu') && item !== profileItem) return;
        var btn = item.querySelector('.bn-btn');

        // mouse: hover opens, leaving closes (small delay so the pointer can travel into the menu)
        item.addEventListener('pointerenter', function (e) {
            if (e.pointerType === 'touch') return;
            clearTimeout(item._t); openMenu(item);
        });
        item.addEventListener('pointerleave', function (e) {
            if (e.pointerType === 'touch') return;
            clearTimeout(item._t); item._t = setTimeout(function () { closeMenu(item); }, 160);
        });

        // touch: first tap opens the menu instead of following the link
        btn.addEventListener('pointerdown', function (e) { btn._pt = e.pointerType; });
        btn.addEventListener('click', function (e) {
            if (btn._pt === 'touch' || !canHover()) {
                e.preventDefault();
                if (item === openItem) closeMenu(item); else openMenu(item);
            }
            btn._pt = '';
        });

        // keyboard: focusing with Tab opens it, leaving closes it
        item.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches(':focus-visible')) openMenu(item); });
        item.addEventListener('focusout', function (e) { if (!item.contains(e.relatedTarget)) closeMenu(item); });
    }

    function runAction(act) {
        var id = act === 'theme' ? 'themeToggle' : act === 'logout' ? 'logoutBtn' : '';
        var t = id && document.getElementById(id);   // the (hidden) sidebar buttons still hold the real logic
        if (t) t.click();
    }

    /* ------------------------------------------------ show / hide (phones) */
    function isMobile() { return !!(window.matchMedia && window.matchMedia('(max-width: 850px)').matches); }
    function setHidden(h) {
        DOC.classList.toggle('bn-hidden', h);
        lsSet(HIDE_KEY, h ? '1' : '0');
        if (h && openItem) closeMenu(openItem);
        if (ball) {
            ball.setAttribute('aria-label', h ? 'Show navigation' : 'Hide navigation');
            ball.setAttribute('aria-expanded', String(!h));
        }
    }
    function measure() { if (dock) DOC.style.setProperty('--bn-h', dock.offsetHeight + 'px'); }

    /* ------------------------------------------------------------ build */
    function build() {
        if (!eligible() || document.getElementById('bnRoot')) return;

        root = el('div', 'bn-root', { id: 'bnRoot' });
        dock = el('nav', 'bn-dock', { 'aria-label': 'Main navigation' });
        NAV.forEach(function (d) { dock.appendChild(makeItem(d)); });
        profileItem = makeItem({ key: 'profile', label: 'Profile', href: 'profile.html', icon: PROFILE_ICON });
        dock.appendChild(profileItem);
        root.appendChild(dock);

        ball = el('button', 'bn-ball', { type: 'button', id: 'bnBall', 'aria-controls': 'bnRoot' });
        ball.innerHTML =
            '<svg class="bn-ic-show" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="14" width="18" height="6" rx="3"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="11" y1="4" x2="13" y2="4"/></svg>' +
            '<svg class="bn-ic-hide" viewBox="0 0 24 24" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        ball.addEventListener('click', function () { setHidden(!DOC.classList.contains('bn-hidden')); });

        document.body.appendChild(root);
        document.body.appendChild(ball);

        fillProfile();
        NAV.forEach(function (d, i) { wireItem(dock.children[i]); });
        wireItem(profileItem);

        root.addEventListener('click', function (e) {
            var a = e.target.closest && e.target.closest('[data-act]');
            if (!a) return;
            runAction(a.getAttribute('data-act'));
            if (openItem) closeMenu(openItem);
        });
        document.addEventListener('pointerdown', function (e) { if (openItem && !root.contains(e.target)) closeMenu(openItem); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openItem) closeMenu(openItem); });

        // log in / out elsewhere flips <html class="sp-authed">: redraw the profile item
        new MutationObserver(function () { if (isAuthed() !== lastAuthed) fillProfile(); }).observe(DOC, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('storage', function (e) {
            if (e.key === HIDE_KEY) setHidden(e.newValue === '1');
        });
        window.addEventListener('resize', function () { measure(); if (openItem) place(openItem); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

        setHidden(lsGet(HIDE_KEY) === '1');
        DOC.classList.add('bn-ready');
        measure();
    }

    window.SpecBottomNav = { rebuild: build, hide: function () { setHidden(true); }, show: function () { setHidden(false); } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
