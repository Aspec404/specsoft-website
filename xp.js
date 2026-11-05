/* ==========================================================================
   SPECSOFT® — XP heartbeat (xp.js)
   Add to every page where people hang out (after supabase-config.js):
       <script src="xp.js" defer></script>
   On a page that should count for a "visit" quest, name it:
       <script src="xp.js" data-visit="store" defer></script>      (store | profile | chats)

   How it works
     * Once a minute, while the tab is visible AND the person moved / typed / scrolled in the last 2 minutes,
       it asks the server (xp_ping). The SERVER measures the time, so this file cannot give extra XP.
     * If the tab was hidden or idle, the next ping says "resume": no credit for the gap.
     * Needs supabase-store-quests.sql. If that file is missing it quietly stops after 3 errors.

   Public API (window.SpecXP)
     get()            the last known XP info {xp, level, into, need, pct, day_xp, day_cap}
     refresh()        Promise, asks the server for the current XP (no time credited)
     onChange(fn)     fn(info) is called whenever XP changes
     set(info)        other scripts (the quest board) can push a fresh XP info in

   Also fills any element with  data-xp-level  data-xp-total  data-xp-into  data-xp-need
   and sets the width of  data-xp-fill  to the percent to the next level.
   A window event "xp:update" is fired with the info as event.detail.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecXP) return;

    var CFG = window.SPECSOFT_CONFIG || {};
    var PING_MS = 60 * 1000;          // how often we ask
    var IDLE_MS = 2 * 60 * 1000;      // no input for this long = away
    var MAX_ERRORS = 3;

    var script = document.currentScript;
    var visitPage = script && script.getAttribute('data-visit');

    var sb = null, uid = null, timer = null, errors = 0, info = null;
    var lastActive = Date.now(), needsResume = true, listeners = [];

    function client() {
        if (sb) return sb;
        try {
            sb = window.getSupabaseClient ? window.getSupabaseClient()
                : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
        } catch (e) { sb = null; }
        return sb;
    }

    /* ---------- paint ---------- */
    function set(next) {
        if (!next || typeof next !== 'object') return;
        info = next;
        document.querySelectorAll('[data-xp-level]').forEach(function (n) { n.textContent = String(next.level); });
        document.querySelectorAll('[data-xp-total]').forEach(function (n) { n.textContent = Number(next.xp).toLocaleString('en-US'); });
        document.querySelectorAll('[data-xp-into]').forEach(function (n) { n.textContent = Number(next.into).toLocaleString('en-US'); });
        document.querySelectorAll('[data-xp-need]').forEach(function (n) { n.textContent = Number(next.need).toLocaleString('en-US'); });
        document.querySelectorAll('[data-xp-fill]').forEach(function (n) { n.style.width = Math.max(0, Math.min(100, Number(next.pct) || 0)) + '%'; });
        listeners.slice().forEach(function (fn) { try { fn(next); } catch (e) { /* a listener failed, ignore */ } });
        try { window.dispatchEvent(new CustomEvent('xp:update', { detail: next })); } catch (e) { /* old browser */ }
    }

    /* ---------- activity ---------- */
    function active() {
        var now = Date.now();
        if (now - lastActive > IDLE_MS) needsResume = true;   // came back after being idle
        lastActive = now;
    }
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'].forEach(function (ev) {
        window.addEventListener(ev, active, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) needsResume = true; else active();
    });

    /* ---------- talking to the server ---------- */
    function ping() {
        var c = client();
        if (!c || !uid) return Promise.resolve();
        var resume = needsResume;
        needsResume = false;
        return Promise.resolve(c.rpc('xp_ping', { p_resume: resume })).then(function (r) {
            if (r.error) throw r.error;
            errors = 0;
            if (r.data) set(r.data);
        }).catch(function () {
            errors++;
            needsResume = true;
            if (errors >= MAX_ERRORS) stop();   // SQL not installed, or the server is down: stop asking
        });
    }

    function tick() {
        if (document.hidden) { needsResume = true; return; }
        if (Date.now() - lastActive > IDLE_MS) { needsResume = true; return; }
        ping();
    }

    function refresh() {
        var c = client();
        if (!c) return Promise.resolve(null);
        return Promise.resolve(c.rpc('xp_status')).then(function (r) {
            if (r.error) throw r.error;
            if (r.data) set(r.data);
            return r.data || null;
        }).catch(function () { return null; });
    }

    function visit() {
        if (!visitPage) return;
        var key = 'xp.visit.' + visitPage, now = Date.now();
        try {
            var last = Number(sessionStorage.getItem(key) || 0);
            if (last && now - last < 10 * 60 * 1000) return;
            sessionStorage.setItem(key, String(now));
        } catch (e) { /* storage blocked: the server still only counts it once per board */ }
        var c = client();
        if (c) Promise.resolve(c.rpc('quest_visit', { p_page: visitPage })).catch(function () { /* ignore */ });
    }

    function start(userId) {
        if (uid === userId) return;
        stop();
        uid = userId;
        errors = 0;
        needsResume = true;
        visit();
        ping();                                   // first ping only sets the clock, it credits nothing
        timer = setInterval(tick, PING_MS);
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
        uid = null;
    }

    function boot() {
        var c = client();
        if (!c || !c.auth) return;
        c.auth.getSession().then(function (s) {
            var user = s && s.data && s.data.session && s.data.session.user;
            if (user) start(user.id);
        }).catch(function () { /* ignore */ });
        if (c.auth.onAuthStateChange) {
            c.auth.onAuthStateChange(function (event, session) {
                var user = session && session.user;
                if (user) start(user.id); else stop();
            });
        }
    }

    window.SpecXP = {
        get: function () { return info; },
        refresh: refresh,
        set: set,
        onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
