/* ==========================================================================
   SPECSOFT® — APEX Credits pill (apex-credits.js)
   Shows  [icon 120]  in the topbar for signed-in members.
   Works on any page: add  <script src="apex-credits.js" defer></script>
   Needs: supabase-config.js + supabase-store.sql, and apex-credits.png in the site root.
   On store.html the pill already exists in the page, so this only fills it in.
   ========================================================================== */
(function () {
    'use strict';
    if (window.ApexCredits) return;

    var CFG = window.SPECSOFT_CONFIG || {};
    var ICON = 'apex-credits.png';
    var sb = null, uid = null, balance = null;

    function getClient() {
        if (sb) return sb;
        try {
            sb = window.getSupabaseClient ? window.getSupabaseClient()
                : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
        } catch (e) { sb = null; }
        return sb;
    }

    function fmt(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
        return n.toLocaleString('en-US');
    }

    function makePill(variant) {
        var a = document.createElement('a');
        a.className = 'apex-pill apex-pill--' + variant;
        a.href = 'store.html#credits';
        a.setAttribute('data-apex-pill', '');
        a.setAttribute('aria-label', 'APEX Credits balance. Open the store');
        a.title = 'APEX Credits';
        a.hidden = true;
        a.innerHTML = '<img class="apex-ico" src="' + ICON + '" alt="" width="18" height="18" decoding="async">' +
                      '<span class="apex-pill-n" data-apex-balance>0</span>';
        return a;
    }

    // put a pill next to the account chip (desktop HUD / phone header) or float it
    function inject() {
        if (document.querySelector('[data-apex-pill]')) return true;
        var hud = document.querySelector('.hud-right');
        var chipHud = document.querySelector('.sp-chip--hud');
        var chipMob = document.querySelector('.sp-chip--mobile');
        var mobHead = document.querySelector('.mobile-header');
        var made = false, p;

        if (chipHud && chipHud.parentNode) { p = makePill('hud'); chipHud.parentNode.insertBefore(p, chipHud); made = true; }
        else if (hud) { p = makePill('hud'); hud.insertBefore(p, hud.firstChild); made = true; }

        if (chipMob && chipMob.parentNode) { p = makePill('mobile'); chipMob.parentNode.insertBefore(p, chipMob); made = true; }
        else if (mobHead) { p = makePill('mobile'); var burger = mobHead.querySelector('.hamburger'); mobHead.insertBefore(p, burger || null); made = true; }

        if (!made) {
            var chipFloat = document.querySelector('.sp-chip--float');
            p = makePill('float');
            if (chipFloat) p.style.right = (24 + chipFloat.offsetWidth + 10) + 'px';
            document.body.appendChild(p);
            made = true;
        }
        return made;
    }

    function paint(n, animate) {
        balance = n;
        document.querySelectorAll('[data-apex-pill]').forEach(function (p) {
            p.hidden = false;
            var out = p.querySelector('[data-apex-balance]');
            if (out) {
                var changed = out.textContent !== fmt(n);
                out.textContent = fmt(n);
                if (animate && changed) { p.classList.remove('is-bump'); void p.offsetWidth; p.classList.add('is-bump'); }
            }
        });
        document.querySelectorAll('[data-apex-balance-big]').forEach(function (b) { b.textContent = fmt(n); });
        try { if (uid) localStorage.setItem('apex.bal.' + uid, String(n)); } catch (e) { /* storage blocked */ }
    }

    function hide() {
        document.querySelectorAll('[data-apex-pill]').forEach(function (p) { if (!p.hasAttribute('data-apex-keep')) p.hidden = true; });
    }

    async function refresh() {
        var c = getClient();
        if (!c) return null;
        try {
            var s = await c.auth.getSession();
            var user = s && s.data && s.data.session && s.data.session.user;
            if (!user) { uid = null; hide(); return null; }
            if (uid !== user.id) {
                uid = user.id;
                try { var cached = localStorage.getItem('apex.bal.' + uid); if (cached != null) paint(Number(cached), false); } catch (e) { /* ignore */ }
            }
            var r = await c.rpc('apex_wallet');
            if (r.error) throw r.error;
            paint(Number(r.data.balance) || 0, true);
            return r.data;
        } catch (e) { return null; }
    }

    window.ApexCredits = { refresh: refresh, set: function (n) { paint(Number(n) || 0, true); }, get: function () { return balance; }, format: fmt };
    window.addEventListener('apex:balance', function (e) { if (e && e.detail != null) paint(Number(e.detail.balance) || 0, true); });

    function start() {
        var tries = 0;
        (function place() {
            if (document.querySelector('[data-apex-pill]')) return refresh();
            // the account chip is added by another script a moment after load, so wait for it (up to ~2.5s)
            var ready = document.querySelector('.sp-chip--hud, .sp-chip--mobile, .sp-chip--float');
            if (!ready && ++tries < 8) return setTimeout(place, 350);
            inject();
            refresh();
        })();
        var c = getClient();
        if (c && c.auth && c.auth.onAuthStateChange) c.auth.onAuthStateChange(function () { setTimeout(refresh, 0); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
