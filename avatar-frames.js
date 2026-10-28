/* ==========================================================================
   SPECSOFT® avatar-frames.js  -  CSS-only profile frames (no images)
   Add  <script src="avatar-frames.js"></script>  to any page that shows avatars.
   Needs supabase-config.js (only to look up who wears what) and supabase-store-frames.sql.

   Public API (window.SpecFrames)
     STYLES                      list of frame styles
     clean(frame)                a safe {style,c1,c2,speed} or null
     apply(node, frame)          put a frame on one avatar (null removes it)
     adorn(node, userId)         look up that member's equipped frame and apply it
     setMine(userId, frame)      tell every avatar on the page about a new frame
     forUsers([ids])             Promise, fills the cache for those members

   Works on the round ".sp-avatar" element used across the site. The frame is a
   decoration child, so the avatar itself (image, letter, status dot) is untouched.
   Everything is validated here AND in the database, so a frame can never inject CSS.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecFrames) return;

    var STYLES = ['spin', 'rainbow', 'pulse', 'orbit', 'neon', 'fire', 'dots', 'aurora', 'twin'];
    var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    var TTL = 5 * 60 * 1000;

    var CFG = window.SPECSOFT_CONFIG || {};
    var _sb = null;
    function client() {
        if (_sb) return _sb;
        try {
            _sb = window.getSupabaseClient ? window.getSupabaseClient() : (
                (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
                    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null
            );
        } catch (e) { _sb = null; }
        return _sb;
    }

    /* ------------------------------ styles ------------------------------ */
    (function injectStyles() {
        if (document.getElementById('sf-styles')) return;
        var ring = '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t)),#000 calc(100% - var(--sf-t)));' +
                   'mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t)),#000 calc(100% - var(--sf-t)))';
        var css = [
            '.sf-has{--sf-t:clamp(2px,.17em,7px);overflow:visible!important}',
            '.sf-has>img{border-radius:50%}',
            '.sf-fx{position:absolute;inset:calc(-1 * (var(--sf-t) + 1px));border-radius:50%;pointer-events:none;z-index:3;font-style:normal;font-size:inherit;--sf-d:calc(var(--sf-speed,3) * 1s)}',
            '.sf-fx::before,.sf-fx::after{content:"";position:absolute;inset:0;border-radius:50%;box-sizing:border-box}',

            '.sf-s-spin .sf-fx::before{background:conic-gradient(from 0deg,transparent 0 38%,var(--sf-c1) 78%,var(--sf-c2) 100%);' + ring + ';animation:sfSpin var(--sf-d) linear infinite}',

            '.sf-s-rainbow .sf-fx::before{background:conic-gradient(#ff4d4d,#ffb84d,#f6ff4d,#4dff88,#4dc3ff,#9a4dff,#ff4dd2,#ff4d4d);' + ring + ';animation:sfSpin var(--sf-d) linear infinite}',

            '.sf-s-pulse .sf-fx::before{border:var(--sf-t) solid var(--sf-c1);animation:sfPulse var(--sf-d) ease-in-out infinite}',

            '.sf-s-orbit .sf-fx::before{border:var(--sf-t) dashed var(--sf-c1);animation:sfSpin calc(var(--sf-d) * 3) linear infinite}',
            '.sf-s-orbit .sf-fx::after{inset:var(--sf-t);border:1px solid var(--sf-c2);opacity:.7}',

            '.sf-s-neon .sf-fx::before{border:calc(var(--sf-t) * .7) solid var(--sf-c1);box-shadow:0 0 .35em var(--sf-c1),inset 0 0 .35em var(--sf-c1);animation:sfFlicker calc(var(--sf-d) * 2) linear infinite}',
            '.sf-s-neon .sf-fx::after{inset:calc(var(--sf-t) * -1);border:1px solid var(--sf-c2);box-shadow:0 0 .6em var(--sf-c2);opacity:.85;animation:sfFlicker calc(var(--sf-d) * 3) linear infinite reverse}',

            '.sf-s-fire .sf-fx{filter:drop-shadow(0 0 .22em var(--sf-c1))}',
            '.sf-s-fire .sf-fx::before{inset:calc(var(--sf-t) * -.5);background:conic-gradient(from 0deg,var(--sf-c1),var(--sf-c2),var(--sf-c1),var(--sf-c2),var(--sf-c1));' +
                '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t) * 1.6),#000 calc(100% - var(--sf-t) * 1.6));mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t) * 1.6),#000 calc(100% - var(--sf-t) * 1.6));' +
                'animation:sfSpin calc(var(--sf-d) * .7) linear infinite}',
            '.sf-s-fire .sf-fx::after{background:conic-gradient(from 180deg,transparent 0 35%,var(--sf-c2) 62%,transparent 90%);' + ring + ';animation:sfSpin calc(var(--sf-d) * 1.1) linear infinite reverse,sfFlame 1.1s ease-in-out infinite alternate}',

            '.sf-s-dots .sf-fx::before{border:var(--sf-t) dotted var(--sf-c1);animation:sfSpin var(--sf-d) linear infinite}',
            '.sf-s-dots .sf-fx::after{inset:calc(var(--sf-t) * -1.8);border:calc(var(--sf-t) * .6) dotted var(--sf-c2);animation:sfSpin calc(var(--sf-d) * 1.4) linear infinite reverse}',

            '.sf-s-aurora .sf-fx{filter:drop-shadow(0 0 .3em var(--sf-c1)) drop-shadow(0 0 .7em var(--sf-c2))}',
            '.sf-s-aurora .sf-fx::before{background:conic-gradient(from 0deg,var(--sf-c1),var(--sf-c2),var(--sf-c1));' + ring + ';animation:sfSpin calc(var(--sf-d) * 2) linear infinite}',
            '.sf-s-aurora .sf-fx::after{inset:calc(var(--sf-t) * -.9);background:conic-gradient(from 90deg,transparent 0 30%,var(--sf-c2) 60%,transparent 90%);' + ring + ';opacity:.8;animation:sfSpin calc(var(--sf-d) * 1.5) linear infinite reverse}',

            '.sf-s-twin .sf-fx::before{background:conic-gradient(from 0deg,transparent 0 45%,var(--sf-c1) 100%);' + ring + ';animation:sfSpin var(--sf-d) linear infinite}',
            '.sf-s-twin .sf-fx::after{inset:calc(var(--sf-t) * -1.7);background:conic-gradient(from 180deg,transparent 0 45%,var(--sf-c2) 100%);' + ring + ';animation:sfSpin calc(var(--sf-d) * 1.3) linear infinite reverse}',

            '.sf-has .sf-fx::before,.sf-has .sf-fx::after{will-change:transform}',
            '@keyframes sfSpin{to{transform:rotate(360deg)}}',
            '@keyframes sfPulse{0%,100%{box-shadow:0 0 .35em .02em var(--sf-c1),inset 0 0 .2em var(--sf-c1)}50%{box-shadow:0 0 1em .25em var(--sf-c2),inset 0 0 .4em var(--sf-c2)}}',
            '@keyframes sfFlicker{0%,18%,22%,25%,53%,57%,100%{opacity:1}20%,24%,55%{opacity:.45}}',
            '@keyframes sfFlame{from{opacity:.55}to{opacity:1}}',
            '@media (prefers-reduced-motion:reduce){.sf-fx::before,.sf-fx::after{animation:none!important}}'
        ].join('\n');
        var st = document.createElement('style');
        st.id = 'sf-styles';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    })();

    /* ------------------------------ core ------------------------------ */
    function clean(f) {
        if (!f || typeof f !== 'object') return null;
        var style = String(f.style || '');
        if (STYLES.indexOf(style) < 0) return null;
        var c1 = String(f.c1 || ''), c2 = String(f.c2 || f.c1 || '');
        if (!COLOR_RE.test(c1) || !COLOR_RE.test(c2)) return null;
        var speed = Number(f.speed);
        if (!isFinite(speed)) speed = 3;
        speed = Math.min(20, Math.max(0.5, speed));
        return { style: style, c1: c1, c2: c2, speed: speed };
    }

    function apply(node, frame) {
        if (!node || !node.classList) return;
        var old = node.querySelector(':scope > .sf-fx');
        if (old) old.remove();
        STYLES.forEach(function (s) { node.classList.remove('sf-s-' + s); });
        var f = clean(frame);
        if (!f) {
            node.classList.remove('sf-has');
            node.style.removeProperty('--sf-c1'); node.style.removeProperty('--sf-c2'); node.style.removeProperty('--sf-speed');
            return;
        }
        node.classList.add('sf-has', 'sf-s-' + f.style);
        node.style.setProperty('--sf-c1', f.c1);
        node.style.setProperty('--sf-c2', f.c2);
        node.style.setProperty('--sf-speed', String(f.speed));
        var fx = document.createElement('i');
        fx.className = 'sf-fx';
        fx.setAttribute('aria-hidden', 'true');
        node.appendChild(fx);
    }

    /* ------------------- who wears what (batched + cached) ------------------- */
    var cache = new Map();          // userId -> { at, frame }
    var waiting = new Map();        // userId -> Set(nodes) waiting for the answer
    var timer = null;

    function fresh(id) { var c = cache.get(id); return c && Date.now() - c.at < TTL ? c : null; }

    function flush() {
        timer = null;
        var ids = Array.from(waiting.keys()).slice(0, 200);
        if (!ids.length) return;
        var batch = new Map();
        ids.forEach(function (id) { batch.set(id, waiting.get(id)); waiting.delete(id); });
        if (waiting.size) timer = setTimeout(flush, 30);
        fetchFrames(ids).then(function () {
            batch.forEach(function (nodes, id) {
                var c = cache.get(id);
                nodes.forEach(function (n) { apply(n, c ? c.frame : null); });
            });
        });
    }

    function fetchFrames(ids) {
        var sb = client();
        var want = ids.filter(function (id) { return !fresh(id); });
        if (!sb || !want.length) return Promise.resolve();
        return Promise.resolve(sb.rpc('frames_for', { p_ids: want.slice(0, 200) })).then(function (res) {
            var now = Date.now(), got = new Map();
            if (res && !res.error) (res.data || []).forEach(function (r) { got.set(r.user_id, clean(r.frame_data)); });
            var failed = !!(res && res.error);
            want.forEach(function (id) {
                // on an error remember "no frame" for only 30s so a missing SQL file does not hammer the server
                cache.set(id, { at: failed ? now - TTL + 30000 : now, frame: got.get(id) || null });
            });
        }).catch(function () {
            want.forEach(function (id) { cache.set(id, { at: Date.now() - TTL + 30000, frame: null }); });
        });
    }

    function adorn(node, userId) {
        if (!node || !userId) return node;
        userId = String(userId).toLowerCase();
        node.setAttribute('data-sf-uid', userId);
        var c = fresh(userId);
        if (c) { apply(node, c.frame); return node; }
        if (!waiting.has(userId)) waiting.set(userId, new Set());
        waiting.get(userId).add(node);
        if (!timer) timer = setTimeout(flush, 40);
        return node;
    }

    function setMine(userId, frame) {
        if (!userId) return;
        userId = String(userId).toLowerCase();
        var f = clean(frame);
        cache.set(userId, { at: Date.now(), frame: f });
        document.querySelectorAll('[data-sf-uid="' + userId + '"]').forEach(function (n) { apply(n, f); });
    }

    function forUsers(ids) { return fetchFrames((ids || []).map(function (i) { return String(i).toLowerCase(); })); }

    window.SpecFrames = { STYLES: STYLES, clean: clean, apply: apply, adorn: adorn, setMine: setMine, forUsers: forUsers };
})();
