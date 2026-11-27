/* ==========================================================================
   SPECSOFT® turkey-hunt.js  -  the THANKSGIVING TURKEY HUNT

   Loaded by seasons.js, and ONLY while the Thanksgiving theme is on (nothing else to add to any page).
   Skipped on admin.html and login.html, and on any page whose <html> has data-turkey-off.

   How it works
     * Hidden turkeys sit on the HUNT PAGES staff picked (Console > Seasons > Turkey hunt).
       A page's turkeys are always in the same spots for everybody, so scroll and look around.
     * Click one: it gobbles, you score, it is gone for you. Every 4th turkey on a page is GOLDEN (50 points, others 10).
     * Catches are counted by the SERVER (turkey_collect), one time per turkey per account, so they follow
       you to every page and every device. Signed-out visitors can look around but nothing is counted.
     * The little turkey button (bottom right) shows your count and opens the LEADERBOARD.
     * When the Thanksgiving theme ends, everything here removes itself, no reload needed.
   Public API: window.SpecTurkey { state(), open(), close() }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecTurkey) return;

    var ROOT = document.documentElement;
    var PATH = (location.pathname || '').toLowerCase();
    if (/(^|\/)(admin|login)(\.html)?$/.test(PATH) || ROOT.hasAttribute('data-turkey-off')) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    var CSS_URL = SELF ? SELF.replace(/turkey-hunt\.js(\?.*)?$/, 'turkey-hunt.css$1') : 'turkey-hunt.css';
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var CFG_KEY = 'tk.cfg.v1', CFG_TTL = 60 * 1000, DONE_KEY = 'tk.alldone.';
    var BOARD_MS = 25000;

    // which page are we on? (staff pick the hunt pages by these keys: file name without .html)
    var PAGE = (function () {
        var p = (location.pathname || '/').split('/').pop().replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return (p || 'index').slice(0, 32);
    })();

    var S = {
        on: false, gen: 0, cfg: null, user: null,
        got: {}, pts: 0, count: 0, rank: null,
        box: null, items: [], hud: null, panel: null, list: null, me: null, bar: null, foot: null, toastEl: null,
        panelOpen: false, boardT: 0, near: null, nearAt: 0, css: null, sizeT: 0, toastT: 0
    };

    /* ------------------------------ tiny helpers ------------------------------ */
    function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function whenBody(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true }); }
    function hashStr(s) { var x = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
    function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function safeUrl(u) { return (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u)) ? u : ''; }
    function prettyPage(p) { p = String(p || '').replace(/[-_]+/g, ' '); return p === 'index' ? 'Home' : p.charAt(0).toUpperCase() + p.slice(1); }

    // point value of a turkey: must match turkey_value() in supabase-turkeys.sql
    function valueOf(i) { return i % 4 === 3 ? 50 : 10; }
    function total() { return S.cfg ? S.cfg.pages.length * S.cfg.density : 0; }
    function onHuntPage() { return !!(S.cfg && S.cfg.pages.indexOf(PAGE) >= 0); }

    /* ------------------------------ data ------------------------------ */
    function plainRpc(name, args) {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + name, {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(args || {}), cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('turkey ' + r.status); return r.json(); });
    }
    function client() { try { return window.getSupabaseClient ? window.getSupabaseClient() : null; } catch (e) { return null; } }
    function rpc(name, args) {
        var c = client();
        if (!c) return Promise.reject(new Error('no_client'));
        return Promise.resolve(c.rpc(name, args || {})).then(function (r) { if (r.error) throw r.error; return r.data; });
    }
    function loadUser() {
        var c = client();
        if (!c || !c.auth) return Promise.resolve(null);
        return Promise.resolve(c.auth.getSession()).then(function (r) {
            var u = r && r.data && r.data.session && r.data.session.user;
            S.user = u ? { id: u.id } : null;
            return S.user;
        }).catch(function () { return null; });
    }
    function getCfg() {                                  // tiny cache so changing pages does not ask again every time
        try {
            var c = JSON.parse(ssGet(CFG_KEY) || 'null');
            if (c && c.data && Date.now() - c.at < CFG_TTL) return Promise.resolve(c.data);
        } catch (e) { /* ignore */ }
        return plainRpc('site_turkey_now', {}).then(function (d) { ssSet(CFG_KEY, JSON.stringify({ at: Date.now(), data: d })); return d; });
    }

    function ensureCss() {
        if (S.css && S.css.isConnected) return;
        var l = document.getElementById('tk-css') || document.createElement('link');
        l.id = 'tk-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
        if (!l.parentNode) (document.head || ROOT).appendChild(l);
        S.css = l;
    }

    /* ------------------------------ the turkey drawing ------------------------------ */
    function turkeySvg(gold) {
        var feathers = gold ? ['#ffe27a', '#f6c945', '#fff1a8', '#f6c945', '#ffe27a'] : ['#c0392b', '#e8832a', '#f2c46d', '#e8832a', '#c0392b'];
        var tail = '';
        [-62, -31, 0, 31, 62].forEach(function (a, i) { tail += '<ellipse cx="24" cy="12.5" rx="5.2" ry="11" fill="' + feathers[i] + '" transform="rotate(' + a + ' 24 29)"/>'; });
        return '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">' + tail +
            '<ellipse cx="24" cy="31" rx="12" ry="11" fill="' + (gold ? '#e3a91f' : '#8a5a2b') + '"/>' +
            '<ellipse cx="24" cy="34" rx="7.5" ry="6.5" fill="' + (gold ? '#f6c945' : '#a8693a') + '"/>' +
            '<circle cx="24" cy="21.5" r="6.2" fill="' + (gold ? '#f0b82a' : '#a8693a') + '"/>' +
            '<circle cx="21.6" cy="20.4" r="1.7" fill="#fff"/><circle cx="26.4" cy="20.4" r="1.7" fill="#fff"/>' +
            '<circle cx="21.9" cy="20.6" r="0.85" fill="#1b0f08"/><circle cx="26.1" cy="20.6" r="0.85" fill="#1b0f08"/>' +
            '<path d="M22.4 23.2 L25.6 23.2 L24 26.6 Z" fill="#f2b134"/>' +
            '<path d="M24 26.4 q-2.3 4.6 0 5.8 q2.3 -1.2 0 -5.8" fill="#d63b2f"/>' +
            '<path d="M19.5 41.5 v4 M28.5 41.5 v4 M17.5 46 h4 M26.5 46 h4" stroke="#f2b134" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
    }

    /* ------------------------------ HUD button ------------------------------ */
    function buildHud() {
        if (S.hud) return;
        var b = h('button', 'tk-hud'); b.type = 'button'; b.id = 'tk-hud';
        b.setAttribute('aria-label', 'Turkey hunt and leaderboard');
        b.addEventListener('click', function () { if (S.panelOpen) closePanel(); else openPanel(); });
        S.hud = b; whenBody(function () { if (S.hud === b) document.body.appendChild(b); });
        paintHud();
    }
    function paintHud() {
        if (!S.hud) return;
        var t = total(), done = t > 0 && S.count >= t;
        S.hud.textContent = '';
        S.hud.appendChild(h('span', 'tk-hud-ico', '\uD83E\uDD83'));
        S.hud.appendChild(h('span', 'tk-hud-n', (S.user ? S.count : 0) + '/' + t));
        S.hud.classList.toggle('is-done', done);
        if (S.panelOpen) paintMe();
    }

    /* ------------------------------ the hidden turkeys ------------------------------ */
    function sizeBox() {
        if (!S.box) return;
        S.box.style.height = '0px';                       // measure the page WITHOUT our own layer stretching it
        var hgt = Math.max(ROOT.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight);
        S.box.style.height = hgt + 'px';
    }
    function removeTurkeys() {
        if (S.box && S.box.parentNode) S.box.parentNode.removeChild(S.box);
        S.box = null; S.items = []; S.near = null;
    }
    function buildTurkeys() {
        removeTurkeys();
        if (!onHuntPage()) return;                        // not a hunt page: nothing hidden here
        var box = h('div'); box.id = 'tk-box'; box.setAttribute('aria-hidden', 'false');
        ROOT.appendChild(box); S.box = box;
        var rnd = mulberry(hashStr(S.cfg.hunt + ':' + PAGE));
        for (var i = 0; i < S.cfg.density; i++) {
            var x = 4 + rnd() * 90, y = 3 + rnd() * 93, v = valueOf(i), gold = v >= 50, d = rnd() * 3;
            var b = h('button', 'tk' + (gold ? ' tk--gold' : '')); b.type = 'button';
            b.setAttribute('data-i', String(i));
            b.setAttribute('aria-label', 'Hidden ' + (gold ? 'golden ' : '') + 'turkey, ' + v + ' points');
            b.style.left = x.toFixed(2) + '%'; b.style.top = y.toFixed(2) + '%'; b.style.setProperty('--d', '-' + d.toFixed(2) + 's');
            b.innerHTML = turkeySvg(gold);
            if (S.got[PAGE + ':' + i]) b.classList.add('is-gone');
            box.appendChild(b); S.items.push({ i: i, el: b, x: 0, y: 0 });
        }
        box.addEventListener('pointerdown', function (e) { var b2 = e.target.closest && e.target.closest('.tk'); if (b2) { e.preventDefault(); collect(b2); } });
        box.addEventListener('click', function (e) { if (e.detail !== 0) return; var b2 = e.target.closest && e.target.closest('.tk'); if (b2) collect(b2); });   // keyboard
        sizeBox();
    }

    function pop(b, txt) {
        if (!S.box) return;
        var p = h('div', 'tk-pop', txt); p.style.left = b.style.left; p.style.top = b.style.top;
        S.box.appendChild(p); setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 1000);
    }

    function collect(b) {
        var i = +b.getAttribute('data-i'), key = PAGE + ':' + i;
        if (!S.on || S.got[key]) return;
        if (!S.user) { b.classList.remove('is-shake'); void b.offsetWidth; b.classList.add('is-shake'); toast('Sign in to catch turkeys and join the leaderboard.'); return; }
        var val = valueOf(i);
        S.got[key] = 1; S.count++; S.pts += val;
        b.classList.add('is-got'); setTimeout(function () { b.classList.add('is-gone'); b.classList.remove('is-got'); }, 420);
        pop(b, (val >= 50 ? 'GOLDEN +' : '+') + val);
        paintHud();
        send(i, key, val, 0, b);
    }

    function revert(key, val, b) {
        delete S.got[key]; S.count = Math.max(0, S.count - 1); S.pts = Math.max(0, S.pts - val);
        if (b) b.classList.remove('is-gone', 'is-got');
        paintHud();
    }

    function send(i, key, val, n, b) {
        var gen = S.gen;
        rpc('turkey_collect', { p_page: PAGE, p_idx: i }).then(function (d) {
            if (gen !== S.gen || !d) return;
            if (typeof d.points === 'number') S.pts = d.points;
            if (typeof d.found === 'number') S.count = d.found;
            paintHud();
            var t = total();
            if (t > 0 && S.count >= t && !ssGet(DONE_KEY + S.cfg.hunt)) { ssSet(DONE_KEY + S.cfg.hunt, '1'); toast('ALL ' + t + ' TURKEYS FOUND! You are a legend.'); }
        }).catch(function (err) {
            if (gen !== S.gen) return;
            var m = String((err && err.message) || '');
            if (/too_fast/.test(m) && n < 3) { setTimeout(function () { if (gen === S.gen) send(i, key, val, n + 1, b); }, 400); return; }
            revert(key, val, b);
            if (/not_signed_in/.test(m)) { S.user = null; toast('Sign in to catch turkeys and join the leaderboard.'); }
            else if (/hunt_off|bad_page|bad_turkey/.test(m)) toast('The turkey hunt just changed. Refresh the page.');
            else if (/too_fast/.test(m)) toast('Easy! Slow down a little and try that one again.');
            else toast('Could not save that turkey. Try again.');
        });
    }

    /* the warm-up hint: a turkey you are close to peeks out and wiggles */
    document.addEventListener('pointermove', function (e) {
        if (!S.on || !S.items.length) return;
        var now = e.timeStamp; if (now - S.nearAt < 80) return; S.nearAt = now;
        var px = e.pageX, py = e.pageY, best = null, bd = 120 * 120;
        for (var k = 0; k < S.items.length; k++) {
            var it = S.items[k]; if (S.got[PAGE + ':' + it.i]) continue;
            var r = it.el.getBoundingClientRect(), cx = r.left + r.width / 2 + (window.pageXOffset || 0), cy = r.top + r.height / 2 + (window.pageYOffset || 0);
            var dx = cx - px, dy = cy - py, dd = dx * dx + dy * dy;
            if (dd < bd) { bd = dd; best = it; }
        }
        if (best !== S.near) { if (S.near) S.near.el.classList.remove('is-near'); if (best) best.el.classList.add('is-near'); S.near = best; }
    }, { passive: true });

    window.addEventListener('resize', function () { clearTimeout(S.sizeT); S.sizeT = setTimeout(sizeBox, 200); });
    window.addEventListener('load', function () { sizeBox(); setTimeout(sizeBox, 1200); });

    /* ------------------------------ toast ------------------------------ */
    function toast(msg) {
        if (!S.toastEl) { S.toastEl = h('div', 'tk-toast'); S.toastEl.setAttribute('role', 'status'); whenBody(function () { document.body.appendChild(S.toastEl); }); }
        S.toastEl.textContent = msg;
        void S.toastEl.offsetWidth; S.toastEl.classList.add('is-on');
        clearTimeout(S.toastT); S.toastT = setTimeout(function () { if (S.toastEl) S.toastEl.classList.remove('is-on'); }, 3600);
    }

    /* ------------------------------ leaderboard panel ------------------------------ */
    function buildPanel() {
        if (S.panel) return;
        var p = h('div', 'tk-panel'); p.id = 'tk-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Turkey hunt leaderboard');
        var head = h('div', 'tk-p-head');
        head.appendChild(h('b', '', '\uD83E\uDD83 Turkey Hunt'));
        var x = h('button', 'tk-x', '\u00D7'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', closePanel);
        head.appendChild(x);
        S.me = h('div', 'tk-me');
        var bar = h('div', 'tk-bar'); S.bar = h('i'); bar.appendChild(S.bar);
        var title = h('div', 'tk-sub', 'TOP HUNTERS');
        S.list = h('ol', 'tk-list');
        S.foot = h('p', 'tk-foot');
        p.appendChild(head); p.appendChild(S.me); p.appendChild(bar); p.appendChild(title); p.appendChild(S.list); p.appendChild(S.foot);
        S.panel = p; whenBody(function () { if (S.panel === p) document.body.appendChild(p); });
    }
    function paintMe() {
        if (!S.me) return;
        var t = total(), c = S.user ? S.count : 0;
        S.me.textContent = '';
        if (!S.user) { S.me.appendChild(h('span', 'tk-me-line', 'Sign in to start catching turkeys.')); }
        else {
            S.me.appendChild(h('span', 'tk-me-line', 'You found ' + c + ' / ' + t + ' turkeys'));
            S.me.appendChild(h('span', 'tk-me-pts', S.pts + ' pts' + (S.rank ? '  \u00B7  Rank #' + S.rank : '')));
        }
        if (S.bar) S.bar.style.width = (t ? Math.min(100, Math.round(c / t * 100)) : 0) + '%';
        if (S.foot && S.cfg) S.foot.textContent = 'Turkeys hide on: ' + S.cfg.pages.map(prettyPage).join(', ') + '. Golden ones are worth 50!';
    }
    function medal(n) { return n === 1 ? '\uD83E\uDD47' : n === 2 ? '\uD83E\uDD48' : n === 3 ? '\uD83E\uDD49' : '#' + n; }
    function paintBoard(d) {
        if (!S.list) return;
        var rows = (d && d.rows) || [];
        if (d && d.me) {
            if (typeof d.me.points === 'number') S.pts = d.me.points;
            if (typeof d.me.found === 'number') S.count = d.me.found;
            S.rank = d.me.rank || null; paintHud();
        }
        S.list.textContent = '';
        if (!rows.length) { S.list.appendChild(h('li', 'tk-empty', 'Nobody has caught a turkey yet. Be the first!')); return; }
        rows.forEach(function (r) {
            var li = h('li', 'tk-row' + (r.is_me ? ' is-me' : ''));
            li.appendChild(h('span', 'tk-rk', medal(r.rank)));
            var av = h('span', 'tk-av'), src = safeUrl(r.avatar);
            if (src) { var im = new Image(); im.src = src; im.alt = ''; im.loading = 'lazy'; im.draggable = false; im.onerror = function () { im.remove(); av.textContent = String(r.name || '?').charAt(0).toUpperCase(); }; av.appendChild(im); }
            else av.textContent = String(r.name || '?').charAt(0).toUpperCase();
            li.appendChild(av);
            var nm = h('span', 'tk-nm'); nm.appendChild(h('b', '', String(r.name || r.username || '').slice(0, 24))); nm.appendChild(h('small', '', r.found + ' found'));
            li.appendChild(nm);
            li.appendChild(h('span', 'tk-pt', r.points + ' pts'));
            S.list.appendChild(li);
        });
        if (d && d.hunters > rows.length) S.list.appendChild(h('li', 'tk-empty', d.hunters + ' hunters so far'));
    }
    function loadBoard() {
        var gen = S.gen, call = S.user ? rpc('turkey_leaderboard', { p_limit: 20 }) : plainRpc('turkey_leaderboard', { p_limit: 20 });
        call.then(function (d) { if (gen === S.gen && S.panelOpen) paintBoard(d); }).catch(function () {
            if (S.list && !S.list.children.length) S.list.appendChild(h('li', 'tk-empty', 'Could not load the leaderboard. Try again in a moment.'));
        });
    }
    function openPanel() {
        if (!S.on || !S.cfg) return;
        buildPanel(); paintMe();
        S.panelOpen = true; S.panel.classList.add('is-on'); if (S.hud) S.hud.setAttribute('aria-expanded', 'true');
        loadBoard(); clearInterval(S.boardT); S.boardT = setInterval(function () { if (!document.hidden) loadBoard(); }, BOARD_MS);
    }
    function closePanel() {
        S.panelOpen = false; clearInterval(S.boardT);
        if (S.panel) S.panel.classList.remove('is-on');
        if (S.hud) S.hud.setAttribute('aria-expanded', 'false');
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.panelOpen) closePanel(); });

    /* ------------------------------ start / stop (follows the Thanksgiving theme) ------------------------------ */
    function themeId() { try { var c = window.SpecSeasons && window.SpecSeasons.current(); return c ? c.id : null; } catch (e) { return null; } }
    function previewing() { try { return !!(window.SpecSeasons && window.SpecSeasons.isPreview()); } catch (e) { return false; } }

    function start() {
        if (S.on) return;
        S.on = true; S.gen++;
        var gen = S.gen;
        ensureCss();
        getCfg().then(function (cfg) {
            if (!S.on || gen !== S.gen || !cfg || !cfg.enabled || !cfg.pages || !cfg.pages.length) return null;
            S.cfg = cfg;
            return loadUser().then(function (u) { return u ? rpc('turkey_me', {}).catch(function () { return null; }) : null; }).then(function (me) {
                if (!S.on || gen !== S.gen) return;
                S.got = {}; S.pts = 0; S.count = 0;
                if (me && me.signed_in) {
                    (me.found || []).forEach(function (k) { S.got[k] = 1; });
                    S.pts = me.points || 0; S.count = me.count || 0;
                }
                buildHud(); buildTurkeys();
            });
        }).catch(function () { /* offline, or the SQL is not installed: stay quiet */ });
    }

    function stop() {
        if (!S.on) return;
        S.on = false; S.gen++;
        closePanel(); removeTurkeys();
        [S.hud, S.panel, S.toastEl].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
        S.hud = S.panel = S.toastEl = S.list = S.me = S.bar = S.foot = null; S.cfg = null; S.got = {};
        if (S.css && S.css.parentNode) S.css.parentNode.removeChild(S.css);
        S.css = null;
    }

    function sync() { if (themeId() === 'thanksgiving' && !previewing()) start(); else stop(); }
    window.addEventListener('specseason', sync);
    sync();

    window.SpecTurkey = {
        state: function () { return { on: S.on, page: PAGE, found: S.count, points: S.pts, total: total(), rank: S.rank }; },
        open: openPanel, close: closePanel
    };
})();
