/* ==========================================================================
   SPECSOFT® — Superior cosmetics (superior.js)
   Needs: supabase-config.js, supabase-membership.sql + supabase-membership-cosmetics.sql,
          avatar-frames.js and name-titles.js (load those FIRST), superior.css.
   Add to any page that shows avatars or names (chats.html, profile.html, ...):
       <script src="superior.js" defer></script>

   What it does for every member whose Superior is active:
     - golden profile frame      (only when they have NOT equipped a frame of their own)
     - SUPERIOR profile title    (only when they have NOT equipped a title of their own)
     - golden chat bubbles with a crown   (chats: needs the one-line data-uid edit in chats.js)
     - gold interface accents    (for the signed-in Superior member only; they can switch it off)

   Public API (window.SpecSuperior)
     has(userId)        true if that member is known to be Superior
     forUsers([ids])    Promise, fills the cache for those members
     mine()             true if the signed-in member is Superior
     setGoldUi(on)      turn the gold interface accents on / off for this browser
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecSuperior) return;

    var CFG = window.SPECSOFT_CONFIG || {};
    var TTL = 5 * 60 * 1000;
    var UI_KEY = 'specsoft.superior.goldUi';

    var GOLD_FRAME = null, DEFAULT_FRAME = {
        v: 2, shape: 'circle', avatarShape: false,
        layers: [
            { type: 'gradient', colors: ['#fff1b8', '#f5c542', '#b8860b', '#f5c542'], dir: 1, width: 3.5, gap: 1, arc: 100, speed: 7 },
            { type: 'sparkles', colors: ['#fff3b0', '#f5c542', '#ffffff'], dir: 1, size: 7, count: 5, gap: 3, speed: 12, pulseSpeed: 2 },
            { type: 'glow', colors: ['#f5c542'], dir: 1, width: 1, blur: 10, gap: 1, opacity: 55 }
        ]
    };
    var GOLD_TITLE = {
        v: 1, text: 'SUPERIOR', font: 'engrave', caps: true, spacing: 2, weight: 700,
        fill: 'gradient', colors: ['#fff1b8', '#f5c542', '#b8860b'], angle: 90, flow: 4,
        effect: 'shimmer', speed: 3, left: '\u265b'
    };

    var sb = null;
    function client() {
        if (sb) return sb;
        try {
            sb = window.getSupabaseClient ? window.getSupabaseClient()
                : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
        } catch (e) { sb = null; }
        return sb;
    }

    /* ---------- who is Superior (batched + cached) ---------- */
    var cache = new Map();             // userId -> { at, on }
    var myId = null;

    function fresh(id) { var c = cache.get(id); return c && Date.now() - c.at < TTL ? c : null; }
    function norm(id) { return String(id || '').toLowerCase(); }
    function has(id) { var c = cache.get(norm(id)); return !!(c && c.on); }

    function forUsers(ids) {
        var c = client();
        var want = Array.from(new Set((ids || []).map(norm).filter(Boolean))).filter(function (id) { return !fresh(id); });
        if (!c || !want.length) return Promise.resolve();
        var chunks = [];
        for (var i = 0; i < want.length; i += 200) chunks.push(want.slice(i, i + 200));
        return Promise.all(chunks.map(function (chunk) {
            return Promise.resolve(c.rpc('superior_ids', { p_ids: chunk })).then(function (res) {
                var now = Date.now(), on = new Set();
                if (res && !res.error) (res.data || []).forEach(function (r) { on.add(norm(typeof r === 'object' && r ? (r.superior_ids || r.user_id) : r)); });
                var failed = !!(res && res.error);
                // on an error remember "not Superior" for only 30s so a missing SQL file does not hammer the server
                chunk.forEach(function (id) { cache.set(id, { at: failed ? now - TTL + 30000 : now, on: on.has(id) }); });
            }).catch(function () {
                chunk.forEach(function (id) { cache.set(id, { at: Date.now() - TTL + 30000, on: false }); });
            });
        }));
    }

    /* ---------- apply the cosmetics ---------- */
    var pending = new Set();
    var timer = null;

    function queue(node) {
        if (!node || node.nodeType !== 1) return;
        pending.add(node);
        if (!timer) timer = setTimeout(run, 60);
    }

    function collect(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches && root.matches('[data-sf-uid],[data-spt-uid],.ch-msg[data-uid]')) queue(root);
        if (root.querySelectorAll) root.querySelectorAll('[data-sf-uid],[data-spt-uid],.ch-msg[data-uid]').forEach(queue);
    }

    function uidOf(node) { return norm(node.getAttribute('data-sf-uid') || node.getAttribute('data-spt-uid') || node.getAttribute('data-uid')); }

    // the Superior frame staff picked in the store (an uploaded image frame); falls back to the built-in gold one
    var framePromise = null;
    function loadFrame() {
        if (framePromise) return framePromise;
        var c = client();
        framePromise = !c ? Promise.resolve() : Promise.resolve(c.rpc('superior_frame')).then(function (res) {
            var f = res && !res.error && res.data && window.SpecFrames ? window.SpecFrames.clean(res.data) : null;
            if (f) GOLD_FRAME = f;
        }).catch(function () { /* keep the built-in frame */ });
        return framePromise;
    }

    function run() {
        timer = null;
        var nodes = Array.from(pending); pending.clear();
        var ids = nodes.map(uidOf);
        Promise.all([forUsers(ids), loadFrame()]).then(function () {
            // give avatar-frames.js / name-titles.js a moment to put a member's OWN frame or title first
            var wait = (window.SpecFrames && window.SpecFrames.forUsers) ? window.SpecFrames.forUsers(ids) : Promise.resolve();
            var wait2 = (window.SpecTitles && window.SpecTitles.forUsers) ? window.SpecTitles.forUsers(ids) : Promise.resolve();
            return Promise.all([wait, wait2]);
        }).then(function () { return new Promise(function (r) { setTimeout(r, 160); }); }).then(function () {
            nodes.forEach(decorate);
        });
    }

    function decorate(node) {
        if (!node.isConnected) return;
        var id = uidOf(node);
        if (!has(id)) {
            if (node.classList.contains('ch-msg')) node.removeAttribute('data-superior');
            return;
        }
        if (node.hasAttribute('data-sf-uid') && window.SpecFrames && !node.classList.contains('sf-has')) {
            window.SpecFrames.apply(node, GOLD_FRAME || DEFAULT_FRAME);
        }
        if (node.hasAttribute('data-spt-uid') && window.SpecTitles && !node.classList.contains('spt-has')) {
            window.SpecTitles.apply(node, GOLD_TITLE);
        }
        if (node.classList.contains('ch-msg')) node.setAttribute('data-superior', '1');
    }

    function start() {
        collect(document.body);
        new MutationObserver(function (list) {
            list.forEach(function (m) {
                if (m.type === 'childList') m.addedNodes.forEach(collect);
                // a member took off their own frame / title: put the gold one back
                else if (m.type === 'attributes' && m.target.matches && m.target.matches('[data-sf-uid],[data-spt-uid]')) queue(m.target);
            });
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        loadMine();
        watchAuth();
    }

    /* ---------- the signed-in member: gold interface accents ---------- */
    function goldUiOn() { try { return localStorage.getItem(UI_KEY) !== 'off'; } catch (e) { return true; } }
    function paintUi() { document.body.classList.toggle('sp-superior', has(myId) && goldUiOn()); }
    function setGoldUi(on) {
        try { localStorage.setItem(UI_KEY, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
        paintUi();
    }
    function loadMine() {
        var c = client();
        if (!c) return;
        c.auth.getSession().then(function (s) {
            var u = s && s.data && s.data.session && s.data.session.user;
            if (!u) return;
            myId = norm(u.id);
            return forUsers([myId]).then(paintUi);
        }).catch(function () { /* signed out */ });
    }
    function watchAuth() {
        var c = client();
        if (c && c.auth && c.auth.onAuthStateChange) c.auth.onAuthStateChange(function () { setTimeout(loadMine, 0); });
    }

    window.SpecSuperior = { has: has, forUsers: forUsers, mine: function () { return has(myId); }, setGoldUi: setGoldUi };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
