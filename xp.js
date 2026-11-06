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

   Boosters: put  <div data-xp-boosters></div>  anywhere to show the member's running XP / credit boosters
   with a live countdown (needs supabase-store-boosters.sql). setBoosters(list) / boosters() are also available.

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

    var sb = null, uid = null, timer = null, errors = 0, info = null, boosters = [], bTimer = null;
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
        // answers that carry no booster list (quest claims...) must not wipe the booster chips
        if (!('boosters' in next) && info && info.boosters) next.boosters = info.boosters;
        info = next;
        if ('boosters' in next) setBoosters(next.boosters);
        document.querySelectorAll('[data-xp-level]').forEach(function (n) { n.textContent = String(next.level); });
        document.querySelectorAll('[data-xp-total]').forEach(function (n) { n.textContent = Number(next.xp).toLocaleString('en-US'); });
        document.querySelectorAll('[data-xp-into]').forEach(function (n) { n.textContent = Number(next.into).toLocaleString('en-US'); });
        document.querySelectorAll('[data-xp-need]').forEach(function (n) { n.textContent = Number(next.need).toLocaleString('en-US'); });
        document.querySelectorAll('[data-xp-fill]').forEach(function (n) { n.style.width = Math.max(0, Math.min(100, Number(next.pct) || 0)) + '%'; });
        listeners.slice().forEach(function (fn) { try { fn(next); } catch (e) { /* a listener failed, ignore */ } });
        try { window.dispatchEvent(new CustomEvent('xp:update', { detail: next })); } catch (e) { /* old browser */ }
    }

    /* ---------- boosters (chips for the signed-in member: any element with data-xp-boosters) ---------- */
    var BOOST_CSS = '.xpb-row{display:flex;flex-wrap:wrap;gap:8px}.xpb-row:empty{display:none}' +
        '.xpb{--c:#38bdf8;display:inline-flex;align-items:center;gap:7px;padding:5px 11px 5px 6px;border-radius:99px;font:600 12.5px/1.2 system-ui,sans-serif;white-space:nowrap;' +
        'color:inherit;background:color-mix(in srgb,var(--c) 15%,transparent);border:1px solid color-mix(in srgb,var(--c) 55%,transparent)}' +
        '.xpb--credits{--c:#facc15}' +
        '.xpb b{display:inline-grid;place-items:center;min-width:26px;height:22px;padding:0 6px;border-radius:99px;background:var(--c);color:#111;font-weight:800;font-size:12px}' +
        '.xpb time{font-variant-numeric:tabular-nums;opacity:.85;font-weight:600}' +
        '@media (prefers-reduced-motion:no-preference){.xpb b{animation:xpbPulse 2.4s ease-in-out infinite}}' +
        '@keyframes xpbPulse{50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 28%,transparent)}}';
    (function () { var st = document.createElement('style'); st.id = 'xpb-styles'; st.textContent = BOOST_CSS; (document.head || document.documentElement).appendChild(st); })();

    function fmtLeft(sec) {
        sec = Math.max(0, Math.floor(sec));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        if (h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
        if (h >= 1) return h + 'h ' + m + 'm';
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function paintBoosters() {
        var now = Date.now();
        boosters = boosters.filter(function (b) { return b.endsAtMs > now; });
        document.querySelectorAll('[data-xp-boosters]').forEach(function (box) {
            box.classList.add('xpb-row');
            var have = {};
            Array.prototype.slice.call(box.children).forEach(function (c) { have[c.getAttribute('data-k')] = c; });
            var keep = {};
            boosters.forEach(function (b) {
                var key = b.kind + b.tier;
                keep[key] = true;
                var chip = have[key];
                if (!chip) {
                    chip = document.createElement('span');
                    chip.className = 'xpb xpb--' + b.kind;
                    chip.setAttribute('data-k', key);
                    chip.title = b.tier + 'x ' + (b.kind === 'xp' ? 'XP' : 'credits') + ' per online minute';
                    var t = document.createElement('b'); t.textContent = b.tier + 'x';
                    var l = document.createElement('span'); l.textContent = b.kind === 'xp' ? 'XP' : 'Credits';
                    var tm = document.createElement('time');
                    chip.appendChild(t); chip.appendChild(l); chip.appendChild(tm);
                    box.appendChild(chip);
                }
                chip.querySelector('time').textContent = fmtLeft((b.endsAtMs - now) / 1000);
            });
            Object.keys(have).forEach(function (k) { if (!keep[k]) have[k].remove(); });
        });
        if (!boosters.length && bTimer) { clearInterval(bTimer); bTimer = null; }
    }
    function setBoosters(list) {
        var now = Date.now();
        boosters = (Array.isArray(list) ? list : []).filter(function (b) { return b && (b.kind === 'xp' || b.kind === 'credits') && Number(b.seconds_left) > 0; })
            .map(function (b) { return { kind: b.kind, tier: Number(b.tier) || 2, endsAtMs: now + Number(b.seconds_left) * 1000 }; });
        if (info) info.boosters = list || [];
        paintBoosters();
        if (boosters.length && !bTimer) bTimer = setInterval(paintBoosters, 1000);
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
        setBoosters: setBoosters,
        boosters: function () { return boosters.map(function (b) { return { kind: b.kind, tier: b.tier, seconds_left: Math.max(0, Math.floor((b.endsAtMs - Date.now()) / 1000)) }; }); },
        onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); paintBoosters(); }); else { boot(); paintBoosters(); }
})();
