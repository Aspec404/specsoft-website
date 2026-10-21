/* ==========================================================================
   SPECSOFT® roles.js  -  badges, "online" heartbeat, account standing banner
   Load with  <script src="roles.js" defer></script>  on any page (main.js already
   does this for you on every page that uses main.js).

   Public API (window.SpecRoles)
     defs()                      Promise<Map id -> role definition>
     forUsers([ids])             Promise<Map userId -> [role definitions, best first]>
     badge(def, {label:false})   a badge element
     mount(el, userId)           fills el with full badges (profile page)
     inline(userId, {max:3})     small icon strip that fills itself in (chat names)

   Everything here is cosmetic and read-only. Badges never grant access: staff access
   lives only in the database (staff_members) and is checked on the server.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecRoles) return;

    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };   // same public (publishable) key profile.js already ships
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

    var COLOR_RE = /^#[0-9a-fA-F]{6}$/;

    // A role icon is an emoji / short symbol, a Flaticon image link, or a file on the site (badges/crown.png).
    // Same rule as the database (role_icon_ok in supabase-role-icons.sql); anything else is shown as text, never loaded.
    var ICON_URL_RE = /^https:\/\/(cdn-icons-png|cdn-icons-gif|cdn-icons|cdn-uicons|media)\.flaticon\.com\/[A-Za-z0-9_.\/%-]{3,250}$/;
    var ICON_OWN_RE = /^https:\/\/mcpjjmbvuzclzrniunkq\.supabase\.co\/storage\/v1\/object\/public\/[A-Za-z0-9_.\/%-]{3,250}$/;
    var ICON_FILE_RE = /^badges\/[A-Za-z0-9_-]{1,60}\.(png|svg|webp|gif)$/;
    function iconSrc(v) { return typeof v === 'string' && (ICON_URL_RE.test(v) || ICON_OWN_RE.test(v) || ICON_FILE_RE.test(v)) ? v : ''; }
    var CAT_ORDER = { general: 0, cosmetic: 1, verified: 2, level: 3 };

    /* ------------------------------ styles ------------------------------ */
    (function injectStyles() {
        if (document.getElementById('sr-styles')) return;
        var css = [
            '.sr-badges{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}',
            '.sr-badge{--sr-color:#9ca3af;display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 10px 3px 8px;',
            'border:1px solid color-mix(in srgb,var(--sr-color) 55%,transparent);background:color-mix(in srgb,var(--sr-color) 13%,transparent);',
            'border-radius:999px;color:var(--text-primary,#fff);font:600 11px/1.4 var(--font-mono,ui-monospace,monospace);letter-spacing:.3px;white-space:nowrap}',
            '.sr-badge-ico{font-size:13px;line-height:1}',
            '.sr-badge-ico svg{display:block;width:14px;height:14px}',
            '.sr-badge-ico img{display:block;width:16px;height:16px;object-fit:contain}',
            '.sr-badge-txt{overflow:hidden;text-overflow:ellipsis}',
            '.sr-badge--icon{padding:2px 6px}',
            '.sr-inline{display:inline-flex;align-items:center;gap:3px;margin-left:6px;vertical-align:middle}',
            '.sr-inline .sr-badge{padding:1px 4px;border-radius:7px;background:transparent;border-color:transparent}',
            '.sr-inline .sr-badge-ico{font-size:12px}',
            '.sr-stack{position:fixed;top:max(10px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:10050;',
            'display:flex;flex-direction:column;gap:8px;width:min(560px,calc(100vw - 20px));pointer-events:none}',
            '.sr-card{pointer-events:auto;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:var(--bg-card,#14141a);',
            'border:1px solid var(--border-hover,rgba(255,255,255,.25));border-left:3px solid var(--sr-accent,#f0b429);border-radius:12px;',
            'color:var(--text-primary,#fff);box-shadow:0 18px 44px rgba(0,0,0,.5);font:14px/1.5 var(--font-sans,system-ui,sans-serif)}',
            '.sr-card--bad{--sr-accent:#ff6b6f}.sr-card--info{--sr-accent:#38bdf8}',
            '.sr-card strong{display:block;font-size:14px}',
            '.sr-card p{margin:2px 0 0;color:var(--text-secondary,#aaa);font-size:13px;overflow-wrap:anywhere}',
            '.sr-card-main{flex:1;min-width:0}',
            '.sr-card button{flex:0 0 auto;padding:5px 11px;background:none;border:1px solid var(--border-hover,rgba(255,255,255,.3));',
            'border-radius:8px;color:var(--text-primary,#fff);font:600 11px var(--font-mono,monospace);letter-spacing:.5px;cursor:pointer}',
            '.sr-card button:hover{background:color-mix(in srgb,var(--text-primary,#fff) 10%,transparent)}'
        ].join('');
        var st = document.createElement('style');
        st.id = 'sr-styles';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    })();

    /* ------------------------------- badges ------------------------------ */
    var defsPromise = null;
    function defs() {
        if (defsPromise) return defsPromise;
        var sb = client();
        if (!sb) return Promise.resolve(new Map());
        defsPromise = Promise.resolve(sb.from('role_defs').select('id,category,name,icon,color,rank,active').eq('active', true))
            .then(function (res) {
                var map = new Map();
                (res.data || []).forEach(function (d) { map.set(d.id, d); });
                return map;
            })
            .catch(function () { defsPromise = null; return new Map(); });
        // refresh definitions every 10 minutes so an owner's icon edit shows up without a reload
        setTimeout(function () { defsPromise = null; }, 10 * 60 * 1000);
        return defsPromise;
    }

    var userCache = new Map();          // userId -> { at, list }
    var TTL = 5 * 60 * 1000;

    function sortRoles(list) {
        return list.slice().sort(function (a, b) {
            var ca = CAT_ORDER[a.category] || 0, cb = CAT_ORDER[b.category] || 0;
            return ca - cb || (a.rank - b.rank);
        });
    }

    function forUsers(ids) {
        var sb = client();
        var want = [];
        (ids || []).forEach(function (id) {
            var c = userCache.get(id);
            if (id && (!c || Date.now() - c.at > TTL) && want.indexOf(id) < 0) want.push(id);
        });
        var done = function () {
            var out = new Map();
            (ids || []).forEach(function (id) { var c = userCache.get(id); out.set(id, c ? c.list : []); });
            return out;
        };
        if (!sb || !want.length) return Promise.resolve(done());

        return defs().then(function (map) {
            return Promise.resolve(sb.from('user_roles').select('user_id,role_id').in('user_id', want.slice(0, 200)))
                .then(function (res) {
                    var by = new Map();
                    want.forEach(function (id) { by.set(id, []); });
                    (res.data || []).forEach(function (r) {
                        var d = map.get(r.role_id);
                        if (d && by.has(r.user_id)) by.get(r.user_id).push(d);
                    });
                    by.forEach(function (list, id) { userCache.set(id, { at: Date.now(), list: sortRoles(list) }); });
                    return done();
                });
        }).catch(function () { return done(); });
    }

    function checkSvg() {
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        var c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '11'); c.setAttribute('fill', 'currentColor');
        var p = document.createElementNS(ns, 'path');
        p.setAttribute('d', 'M7 12.5l3.2 3.2L17 8.8'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#fff');
        p.setAttribute('stroke-width', '2.4'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(c); svg.appendChild(p);
        return svg;
    }

    function badge(def, opts) {
        opts = opts || {};
        var showLabel = opts.label !== false;
        var el = document.createElement('span');
        el.className = 'sr-badge' + (showLabel ? '' : ' sr-badge--icon');
        el.title = def.name;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', def.name);
        if (COLOR_RE.test(def.color)) el.style.setProperty('--sr-color', def.color);

        var ico = document.createElement('span');
        ico.className = 'sr-badge-ico';
        var src = iconSrc(def.icon);
        if (src) {
            var img = document.createElement('img');
            img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
            img.addEventListener('error', function () { ico.textContent = '\u2605'; });
            ico.appendChild(img);
        } else if (def.category === 'verified' && def.id !== 'verified_none') {
            ico.style.color = COLOR_RE.test(def.color) ? def.color : '#3b82f6';
            ico.appendChild(checkSvg());
        } else {
            ico.textContent = (typeof def.icon === 'string' && def.icon.length <= 8) ? def.icon : '\u2605';   // never print a long, unapproved string
        }
        el.appendChild(ico);

        if (showLabel) {
            var t = document.createElement('span');
            t.className = 'sr-badge-txt';
            t.textContent = def.name;
            el.appendChild(t);
        }
        return el;
    }

    function mount(container, userId) {
        if (!container || !userId) return;
        container.textContent = '';
        forUsers([userId]).then(function (map) {
            var list = (map.get(userId) || []).filter(function (d) { return d.id !== 'verified_none'; });
            container.textContent = '';
            container.hidden = !list.length;
            list.forEach(function (d) {
                var li = document.createElement('li');
                li.appendChild(badge(d));
                container.appendChild(li);
            });
        });
    }

    // batches lookups: ten messages from the same people = one request
    var queue = [], queued = false;
    function inline(userId, opts) {
        opts = opts || {};
        var max = opts.max || 3;
        var span = document.createElement('span');
        span.className = 'sr-inline';
        if (!userId) return span;
        queue.push({ id: userId, span: span, max: max });
        if (!queued) {
            queued = true;
            setTimeout(function () {
                var batch = queue; queue = []; queued = false;
                forUsers(batch.map(function (b) { return b.id; })).then(function (map) {
                    batch.forEach(function (b) {
                        var list = (map.get(b.id) || []).filter(function (d) { return d.id !== 'verified_none'; });
                        // verified check first, then the most important roles
                        list.sort(function (x, y) { return (y.category === 'verified') - (x.category === 'verified'); });
                        list.slice(0, b.max).forEach(function (d) { b.span.appendChild(badge(d, { label: false })); });
                    });
                });
            }, 40);
        }
        return span;
    }

    /* ------------------- "online" heartbeat (staff dashboard) ------------------- */
    function startHeartbeat() {
        var sb = client();
        if (!sb || !sb.auth) return;
        var page = (location.pathname.split('/').pop() || 'index.html').slice(0, 60);
        var signedIn = false;

        function beat() {
            if (document.hidden || !signedIn) return;
            Promise.resolve(sb.rpc('presence_touch', { p_page: page })).catch(function () { /* ignore */ });
        }

        Promise.resolve(sb.auth.getSession()).then(function (r) {
            signedIn = !!(r && r.data && r.data.session);
            beat();
        }).catch(function () { /* ignore */ });

        if (sb.auth.onAuthStateChange) sb.auth.onAuthStateChange(function (_e, session) { signedIn = !!session; if (signedIn) beat(); });
        setInterval(beat, 60 * 1000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) beat(); });
    }

    /* --------------------- account standing (warnings, suspensions) --------------------- */
    function fmtUntil(iso) {
        if (!iso) return 'until further notice';
        try { return 'until ' + new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
        catch (e) { return ''; }
    }

    var KIND_TITLE = {
        ban: 'Your account is banned',
        suspension: 'Your account is suspended',
        restrict_post: 'Posting is restricted on your account',
        restrict_comment: 'Commenting is restricted on your account',
        restrict_chat: 'Chat is restricted on your account'
    };

    function card(kind, title, body, buttonText, onButton) {
        var c = document.createElement('div');
        c.className = 'sr-card sr-card--' + kind;
        c.setAttribute('role', 'status');
        var main = document.createElement('div');
        main.className = 'sr-card-main';
        var s = document.createElement('strong'); s.textContent = title;
        main.appendChild(s);
        if (body) { var p = document.createElement('p'); p.textContent = body; main.appendChild(p); }
        c.appendChild(main);
        if (buttonText) {
            var b = document.createElement('button');
            b.type = 'button'; b.textContent = buttonText;
            b.addEventListener('click', function () { onButton(c); });
            c.appendChild(b);
        }
        return c;
    }

    function showStanding() {
        var sb = client();
        if (!sb) return;
        Promise.resolve(sb.rpc('my_standing')).then(function (res) {
            var d = res && res.data;
            if (!d) return;
            var sanctions = d.sanctions || [], notices = d.notices || [];
            if (!sanctions.length && !notices.length) return;

            var stack = document.createElement('div');
            stack.className = 'sr-stack';
            document.body.appendChild(stack);

            sanctions.forEach(function (s) {
                var hidden = false;
                try { hidden = sessionStorage.getItem('sr-hide-' + s.id) === '1'; } catch (e) { /* ignore */ }
                if (hidden) return;
                stack.appendChild(card('bad', (KIND_TITLE[s.kind] || 'Account restriction') + ' ' + fmtUntil(s.ends_at), s.reason, 'HIDE', function (c) {
                    try { sessionStorage.setItem('sr-hide-' + s.id, '1'); } catch (e) { /* ignore */ }
                    c.remove();
                }));
            });

            var covered = [];
            notices.forEach(function (n) {
                var kind = (n.kind === 'warning' || n.kind === 'restriction') ? '' : 'info';
                if (n.kind === 'ban' || n.kind === 'suspension') { covered.push(n.id); return; }     // the card above already says it
                stack.appendChild(card(kind, n.title, n.body, 'GOT IT', function (c) {
                    c.remove();
                    Promise.resolve(sb.rpc('notice_mark_read', { p_ids: [n.id] })).catch(function () { /* ignore */ });
                }));
            });
            if (covered.length) Promise.resolve(sb.rpc('notice_mark_read', { p_ids: covered })).catch(function () { /* ignore */ });
        }).catch(function () { /* not installed yet */ });
    }

    window.SpecRoles = { defs: defs, forUsers: forUsers, badge: badge, mount: mount, inline: inline };

    function start() {
        startHeartbeat();
        setTimeout(showStanding, 1200);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();