/* ==========================================================================
   SPECSOFT® profile "Create" menu (profile-create.js)
   On YOUR profile, the first card ("Post a project") becomes a Create menu:
     - Create a post     opens the post editor (text, images, files, links)
     - Create a project  goes to studio.html. PC ONLY: it is not offered on phones and tablets.
   On a phone the card opens the post editor directly (there is only one thing to create).

   It listens for clicks on the existing ".pf-card--add" card, so profile.js does not need to change for the menu itself.
   Needs: post-social.css, post-composer.js, supabase-hub-v2.sql. Load AFTER profile.js.
   ========================================================================== */
(function () {
    'use strict';

    var sb = window.getSupabaseClient ? window.getSupabaseClient() : null;
    var pcQuery = window.matchMedia ? window.matchMedia('(min-width: 901px) and (pointer: fine)') : null;
    function isPC() { return !pcQuery || pcQuery.matches; }

    var menu = null, toastTimer = null;

    function toast(msg) {
        var t = document.getElementById('pcToast');
        if (!t) { t = document.createElement('div'); t.id = 'pcToast'; t.className = 'pc-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
        var host = document.querySelector('dialog[open]') || document.body;
        if (t.parentNode !== host) host.appendChild(t);
        t.textContent = msg; void t.offsetWidth; t.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2600);
    }

    function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener('keydown', onKey, true); } }
    function onKey(e) { if (e.key === 'Escape') closeMenu(); }

    async function me() {
        if (!sb) return null;
        try { var s = (await sb.auth.getSession()).data.session; return s ? s.user : null; } catch (e) { return null; }
    }

    async function newPost() {
        closeMenu();
        var user = await me();
        if (!user) { toast('Log in to create a post.'); return; }
        if (!window.SpecComposer) { toast('The post editor could not load. Check that post-composer.js is on this page.'); return; }
        window.SpecComposer.open({ sb: sb, me: user, toast: toast, onCreated: function () { setTimeout(function () { location.reload(); }, 700); } });
    }

    function openMenu(card) {
        closeMenu();
        var r = card.getBoundingClientRect();
        menu = document.createElement('div');
        menu.className = 'pc-menu'; menu.setAttribute('role', 'menu');

        var post = document.createElement('button');
        post.type = 'button'; post.className = 'pc-menu-item'; post.setAttribute('role', 'menuitem');
        post.innerHTML = '<strong>Create a post</strong><span>Text, images, files and links</span>';
        post.addEventListener('click', newPost);

        var proj = document.createElement('a');
        proj.href = 'studio.html'; proj.className = 'pc-menu-item pc-pc-only'; proj.setAttribute('role', 'menuitem');
        proj.innerHTML = '<strong>Create a project</strong><span>Build it in SPECSOFT Studio</span>';

        menu.appendChild(post); menu.appendChild(proj);
        document.body.appendChild(menu);
        var w = menu.offsetWidth || 280;
        menu.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
        menu.style.top = Math.min(r.bottom + 8, window.innerHeight - menu.offsetHeight - 12) + 'px';
        post.focus();
        document.addEventListener('keydown', onKey, true);
    }

    // capture phase: runs before profile.js's own handler, so the old "New project" form is not opened
    document.addEventListener('click', function (e) {
        var card = e.target.closest ? e.target.closest('.pf-card--add') : null;
        if (card) {
            e.preventDefault(); e.stopImmediatePropagation();
            if (!isPC()) { newPost(); return; }
            if (menu) closeMenu(); else openMenu(card);
            return;
        }
        if (menu && !menu.contains(e.target)) closeMenu();
    }, true);

    if (pcQuery) {
        var onChange = function () { if (!isPC()) closeMenu(); };
        if (pcQuery.addEventListener) pcQuery.addEventListener('change', onChange); else if (pcQuery.addListener) pcQuery.addListener(onChange);
    }
    window.addEventListener('resize', closeMenu);
})();
