/* ==========================================================================
   SPECSOFT® thethe-event.js  -  the tHE THE THEME EVENT, live and synced for every visitor
   (a "theme / chill" event: no countdown, no survivors, no rewards, just nostalgia)

   The site turns back into tHE THE, the old meme-community website (2022): orange #FF6B35, Inter, clean cards.
   Loaded automatically by seasons.js on every page that has seasons.js (nothing else to add).
   Skipped on admin.html and login.html, and on any page whose <html> has data-thethe-off.

   How it works
     * Every 30s (5s when an event is about to start, 20s while it runs) the page asks the database:
       site_thethe_now(). The answer carries SERVER time, so everybody switches on and off together.
     * While the event runs:
         - html + body get the class  tt-on  (thethe-event.css swaps the palette to the old tHE THE look)
         - it FOLLOWS the visitor's own light / dark choice (the old site had both), we never touch their theme class
         - the browser tab says "tHE THE - Official Homepage" and gets an orange "tT" favicon (both restored after)
         - a "tHE Credits" badge (bottom right, your real APEX balance, click it) and a music pill (bottom left, the OST)
         - meme emoji pop up where you click, and one short emoji rain the first time you see it (full effects only)
         - Thea and Mirai (the original tHE THE mascots, sprites in assets/the-the/): their avatars on the toasts, a few of them in the
           rain, and now and then one of their emotes pops up where you click (full effects, normal devices). Ultra reduce motion loads no sprites.
         - Thea and Mirai also PEEK IN from the screen edges every so often (full effects): they slide in, say something nostalgic in a
           speech bubble (some of it makes them cry), and slide back out. Click them: they react (and if you keep poking, they get emotional).
           The very first visit of a session is a short reunion with both of them. Reduce motion: one still companion that talks on click.
           Lines live in PAL_LINES / PAL_POKE / PAL_MISS in thethe-event.js, the look is thethe-event.css section 3b.
         - the site's custom cursor (cursor.js) turns orange
         - the sidebar / mobile logo says "tHE THE" (with an orange tT mark) instead of SPECSOFT®
         - a floating rounded bottom nav (Home / Projects / Chats / Store / Profile), like the old tHE THE site
         - the Chats page (chats.html): brand "tHE THE CHATS" + tT mark, and thethe-event.css section 8 restyles it like the old chats
         - "APEX Credits" becomes "tHE Credits" everywhere on the page (the topbar pill, the store ...), same balance
           (only what you SEE changes: every original text is remembered and put back when the event ends)
       Music NEVER starts by itself on a first visit (browsers block that, and it is rude): the visitor taps play
       once, and after that it keeps playing on every page, in sync with the server clock.
     * When the event ends (or staff abort it) everything is removed. Nothing is ever deleted.

   MOTION MODES, switched live (no reload) when the visitor changes Settings or their OS:
     full  everything, minus the heavy bits on weak devices (fewer pop-ups, no opening rain)
     rm    Reduce motion (html.ss-reduce-motion or the OS setting): same look, nothing moves
     min   Ultra reduce motion (html.ss-urm): palette + badge + music pill only. No layers, no extra font.

   If the Kawaii event is running at the same moment, whichever started first keeps the site and the other waits.

   Staff preview (nobody else sees it): Console > Events > tHE THE > "Preview (new tab)"
   or open  index.html#thethe-preview
   Public API: window.SpecTheThe { preview(), end(), state() }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecTheThe) return;

    var ROOT = document.documentElement;
    var PATH = (location.pathname || '').toLowerCase();
    var PREVIEW = location.hash === '#thethe-preview';
    if (/(^|\/)(admin|login)(\.html)?$/.test(PATH) || ROOT.hasAttribute('data-thethe-off')) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    var CSS_URL = SELF ? SELF.replace(/thethe-event\.js(\?.*)?$/, 'thethe-event.css$1') : 'thethe-event.css';
    var FONT_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var K_CACHE = 'tt.cache', K_SND = 'tt.snd', K_VOL = 'tt.vol', K_MUTE = 'tt.mute', K_PREV = 'tt.preview.cfg';
    var TITLE = 'tHE THE - Official Homepage';
    var ICON = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#FF6B35'/><text x='32' y='44' font-size='34' font-family='Arial,sans-serif' font-weight='700' text-anchor='middle' fill='white'>tT</text></svg>");
    // memes: moai, skull, crying, fire, orange heart, sparkles, laughing
    var MEMES = ['\uD83D\uDDFF', '\uD83D\uDC80', '\uD83D\uDE2D', '\uD83D\uDD25', '\uD83E\uDDE1', '\u2728', '\uD83D\uDE02'];
    /* Thea and Mirai (the original tHE THE mascots): sprites live in assets/the-the/ next to this script.
       NAME.png = full size, NAME-s.webp = small version used for pop-ups, rain and the toast avatar. */
    var ASSET_DIR = SELF ? SELF.replace(/thethe-event\.js(\?.*)?$/, 'assets/the-the/') : 'assets/the-the/';
    var MASCOTS = {
        thea:  { icon: 'thea-icon',  emotes: ['thea-angry', 'thea-happy', 'thea-confused', 'thea-sleepy', 'thea-cat', 'thea-silent'] },
        mirai: { icon: 'mirai-icon', emotes: ['mirai-excited', 'mirai-angry', 'mirai-confused', 'mirai-love', 'mirai-surprised', 'mirai-sleepy'] }
    };
    var MASCOT_LINES = [
        ['thea', 'Thea: ...finally. you took forever \uD83D\uDE24'],
        ['mirai', 'Mirai: WELCOME BACK!! \uD83D\uDD25'],
        ['thea', 'Thea: hi. (don\u2019t make it weird)'],
        ['mirai', 'Mirai: did you miss us?? \uD83E\uDDE1']
    ];
    var BYE_LINES = [
        ['thea', 'Thea: ...so that\u2019s it. thanks for staying.'],
        ['mirai', 'Mirai: BYE!! come back soon okay?? \uD83E\uDDE1'],
        ['thea', 'Thea: don\u2019t be a stranger. (i mean it)'],
        ['mirai', 'Mirai: this is NOT goodbye, it\u2019s see-you-later \uD83D\uDE2D']
    ];
    var POPS = [0, 3, 5, 8];      // click pop-ups per click, by effects level
    var RAIN = [0, 0, 14, 26];    // opening emoji rain, by effects level
    var LINES = [
        'welcome back to tHE THE \uD83D\uDDFF',
        'the oldest website is back (since 2022) \uD83E\uDDE1',
        'tHE THE never died \uD83D\uDC80',
        'you came from tHE THE, didn\u2019t you \uD83D\uDC40',
        'tHE THE is live. the memes have returned \uD83D\uDD25'
    ];
    var CREDIT_LINES_REAL = [
        'your APEX balance, wearing a tHE THE costume \uD83D\uDC80',
        'tHE Credits are real now. go spend them \uD83E\uDDE1',
        'rich in tHE Credits, poor in 2022 memories \uD83D\uDE2D',
        'you were supposed to spend those \uD83E\uDDE1'
    ];
    var CREDIT_LINES = [
        'tHE Credits moved out. balance: 0 \uD83D\uDDFF',
        '0 tHE Credits. same as 2022 \uD83D\uDC80',
        'this currency is not accepted anywhere anymore \uD83D\uDE2D',
        'you were supposed to spend those \uD83E\uDDE1'
    ];

    var S = {
        ev: null, off: 0, active: false, preview: false, pollT: 0, tickT: 0,
        root: null, pill: null, credits: null, imgs: {}, crB: null, bal: null, balFn: null, balT: 0, bn: null, bnFn: null, bnY: 0, toastEl: null, mo: null, modeMo: null, outT: 0,
        aud: null, playing: false, blocked: false, gestureArmed: false, btn: null, muteBtn: null, vol: null,
        lastPop: 0, fadeT: 0, mode: 'full', lite: false, key: '', hooked: false,
        idDone: false, oldTitle: '', oldIcons: [], newIcon: null,
        palT: 0, palTok: 0, pals: [], palLast: '', palIdx: { thea: -1, mirai: -1 }, palPokes: 0
    };

    /* ------------------------------ small helpers ------------------------------ */
    function nowMs() { return Date.now() + S.off; }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function small() { return innerWidth < 700; }
    function calm() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function plainRpc(name, args) {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + name, {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(args || {}), cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('thethe ' + r.status); return r.json(); });
    }

    // Which motion mode are we in? Ultra reduce motion beats Reduce motion beats full effects.
    function mode() {
        var c = ROOT.classList;
        if (c.contains('ss-urm')) return 'min';
        if (c.contains('ss-reduce-motion') || calm()) return 'rm';
        return 'full';
    }
    // weak device? (few cores, little memory, or Data Saver on): the full mode runs on a lighter budget
    function lite() {
        try {
            var n = navigator;
            return !!((n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 4) || (n.connection && n.connection.saveData));
        } catch (e) { return false; }
    }
    function modeKey() { return mode() + '|' + (mode() === 'full' && lite()); }
    function applyMode() {
        S.mode = mode();
        S.lite = S.mode === 'full' && lite();
        preloadSprites();
        S.key = modeKey();
        var c = ROOT.classList;
        c.remove('tt-fx'); c.remove('tt-rm'); c.remove('tt-min'); c.remove('tt-lite');
        c.add(S.mode === 'full' ? 'tt-fx' : S.mode === 'rm' ? 'tt-rm' : 'tt-min');
        if (S.lite) c.add('tt-lite');
    }
    function loadAssets() {
        if (!document.getElementById('tt-css')) {
            var l = mk('link'); l.id = 'tt-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
            (document.head || ROOT).appendChild(l);
        }
        if (S.mode !== 'min' && !document.getElementById('tt-font')) {
            var f = mk('link'); f.id = 'tt-font'; f.rel = 'stylesheet'; f.href = FONT_URL;
            (document.head || ROOT).appendChild(f);
        }
    }

    /* ------------------------------ toast ------------------------------ */
    /* ------------------------------ Thea + Mirai sprites ------------------------------ */
    function spr(n) { return ASSET_DIR + n + '-s.webp'; }
    function mascotImg(cls, name, px) {
        var im = document.createElement('img');
        im.className = cls; im.alt = ''; im.decoding = 'async'; im.draggable = false; im.src = spr(name);
        if (px) im.style.width = px + 'px';
        return im;
    }
    function anyIcon() { return pick([MASCOTS.thea.icon, MASCOTS.mirai.icon]); }
    // icons straight away (tiny); the emotes a moment later, full effects on normal devices only. Ultra reduce motion loads nothing.
    function preloadSprites() {
        if (!S.active || S.mode === 'min') return;
        function load(n) { if (S.imgs[n]) return; var im = new Image(); im.decoding = 'async'; im.src = spr(n); S.imgs[n] = im; }
        load(MASCOTS.thea.icon); load(MASCOTS.mirai.icon);
        if (S.mode === 'full' && !S.lite) {
            setTimeout(function () {
                if (!S.active || S.mode !== 'full') return;
                MASCOTS.thea.emotes.concat(MASCOTS.mirai.emotes).forEach(load);
            }, 1800);
        }
    }
    function readyEmote() {
        var n = pick(MASCOTS.thea.emotes.concat(MASCOTS.mirai.emotes)), im = S.imgs[n];
        return (im && im.complete && im.naturalWidth) ? n : null;
    }

    function toast(msg, ms, face) {
        if (!document.body) return;
        if (!S.toastEl) { S.toastEl = mk('div', 'tt-toast'); S.toastEl.setAttribute('role', 'status'); document.body.appendChild(S.toastEl); }
        S.toastEl.textContent = '';
        if (face && S.mode !== 'min') { S.toastEl.appendChild(mascotImg('tt-face', face, 34)); S.toastEl.classList.add('tt-has-face'); }
        else S.toastEl.classList.remove('tt-has-face');
        S.toastEl.appendChild(mk('span', null, msg));
        void S.toastEl.offsetWidth;
        S.toastEl.classList.add('tt-show');
        clearTimeout(S.toastEl._t);
        S.toastEl._t = setTimeout(function () { if (S.toastEl) S.toastEl.classList.remove('tt-show'); }, ms || 4200);
    }

    /* ------------------------------ the tHE Credits badge = your real APEX balance ------------------------------ */
    // Same wallet as the APEX pill (apex_wallet RPC). Uses the site's own signed-in client, so nothing new is stored.
    // Order: what apex-credits.js already knows, then the number it cached for you, then a fresh read from the database.
    function fmtBal(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
        return n.toLocaleString('en-US');
    }
    function paintBal(n) {
        n = Number(n);
        if (!isFinite(n)) return;
        S.bal = n;
        if (S.crB) S.crB.textContent = fmtBal(n);
    }
    function loadBalance() {
        try { if (window.ApexCredits && window.ApexCredits.get && window.ApexCredits.get() != null) paintBal(window.ApexCredits.get()); } catch (e) { /* ignore */ }
        if (S.bal == null) {
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf('apex.bal.') === 0) { paintBal(localStorage.getItem(k)); break; }
                }
            } catch (e) { /* storage blocked */ }
        }
        if (!S.balFn) {
            S.balFn = function (e) { if (e && e.detail && e.detail.balance != null) paintBal(e.detail.balance); };
            window.addEventListener('apex:balance', S.balFn);
        }
        var c = null;
        try { c = window.getSupabaseClient ? window.getSupabaseClient() : null; } catch (e) { c = null; }
        if (c && c.auth && c.rpc) {
            c.auth.getSession().then(function (s) {
                var u = s && s.data && s.data.session && s.data.session.user;
                if (!u) return null;
                return c.rpc('apex_wallet').then(function (r) { if (r && !r.error && r.data) paintBal(r.data.balance); });
            }).catch(function () { /* signed out, offline, or the store SQL is not installed: keep what we have */ });
        }
        clearTimeout(S.balT);
        if (S.bal == null) S.balT = setTimeout(function () { if (S.credits) loadBalance(); }, 3000);   // the sign-in can land a moment after the page
    }

    /* ------------------------------ floating bottom nav (like the old tHE THE site) ------------------------------ */
    // A rounded bar at the bottom centre: Home, Projects, Chats, Store, Profile. Not on the Chats page (it has its own composer).
    // Full effects: it slides away when you scroll down and comes back when you scroll up. Other modes: always there, nothing moves.
    var BN_ITEMS = [
        ['index.html', 'Home', '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>'],
        ['projects.html', 'Projects', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
        ['chats.html', 'Chats', '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>'],
        ['store.html', 'Store', '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>'],
        ['profile.html', 'Profile', '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>']
    ];
    function buildBottomNav() {
        if (S.bn || !document.body || document.body.classList.contains('ch-body')) return;
        var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        if (here === 'chats.html' || here === 'login.html' || here === 'intro.html') return;
        var nav = mk('nav', 'tt-bottomnav');
        nav.setAttribute('aria-label', 'Quick navigation');
        BN_ITEMS.forEach(function (it) {
            var a = mk('a', 'tt-bn-item' + (here === it[0] ? ' tt-active' : ''));
            a.href = it[0];
            if (here === it[0]) a.setAttribute('aria-current', 'page');
            a.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + it[2] + '</svg><span>' + it[1] + '</span>';
            nav.appendChild(a);
        });
        document.body.appendChild(nav);
        S.bn = nav;
        S.bnY = window.pageYOffset || 0;
        S.bnFn = function () {
            if (!S.bn || S.mode !== 'full') { if (S.bn) S.bn.classList.remove('tt-hide'); return; }
            var y = window.pageYOffset || 0, d = y - S.bnY;
            if (Math.abs(d) < 8) return;
            S.bn.classList.toggle('tt-hide', d > 0 && y > 120);
            S.bnY = y;
        };
        window.addEventListener('scroll', S.bnFn, { passive: true });
    }

    /* ------------------------------ rebrand: SPECSOFT -> tHE THE, APEX Credits -> tHE Credits ------------------------------ */
    // Only visible text changes, nothing is saved. Every original is remembered and put back when the event ends.
    // New content (the sidebar is injected by main.js, the credits pill by apex-credits.js) is caught by a small observer.
    var RB = { log: [], mo: null, q: [], raf: 0, on: false };
    function rbApex(s) {
        return s.replace(/APEX[\s\u00a0]+Credits/gi, function (m) { return m === m.toUpperCase() ? 'tHE CREDITS' : 'tHE Credits'; });
    }
    function rbText(n) {
        var v = n.nodeValue, p = n.parentNode;
        if (!v || !p || p.nodeType !== 1) return;
        var t = p.nodeName;
        if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'NOSCRIPT') return;
        var out = v;
        if (/apex/i.test(out)) out = rbApex(out);
        if (/specsoft/i.test(out) && p.closest && p.closest('.logo, .ch-brand-text')) out = out.replace(/SPECSOFT\u00ae?/i, 'tHE THE');
        else if (v.trim() === 'S' && p.closest && p.closest('.ch-brand-mark')) out = v.replace('S', 'tT');       // chats sidebar mark
        if (out !== v) { RB.log.push({ n: n, v: v, o: out }); n.nodeValue = out; }
    }
    function rbAttrs(el) {
        if (!el.getAttribute) return;
        ['title', 'aria-label'].forEach(function (a) {
            var v = el.getAttribute(a);
            if (v && /apex[\s\u00a0]+credits/i.test(v)) { var o = rbApex(v); RB.log.push({ el: el, a: a, v: v, o: o }); el.setAttribute(a, o); }
        });
    }
    function rbScan(root) {
        if (!root) return;
        if (root.nodeType === 3) { rbText(root); return; }
        if (root.nodeType !== 1) return;
        var t = root.nodeName, i, l;
        if (t === 'SCRIPT' || t === 'STYLE') return;
        rbAttrs(root);
        try { l = root.querySelectorAll('[title*="apex" i],[aria-label*="apex" i]'); for (i = 0; i < l.length; i++) rbAttrs(l[i]); } catch (e) { /* ignore */ }
        var w = document.createTreeWalker(root, 4, null), n;      // 4 = SHOW_TEXT
        while ((n = w.nextNode())) rbText(n);
    }
    function rbFlush() {
        RB.raf = 0;
        var q = RB.q; RB.q = [];
        if (!RB.on) return;
        for (var i = 0; i < q.length; i++) if (q[i].isConnected) rbScan(q[i]);
    }
    function rebrand(on) {
        if (on) {
            if (RB.on || !document.body) return;
            RB.on = true;
            rbScan(document.body);
            if (window.MutationObserver && !RB.mo) {
                RB.mo = new MutationObserver(function (muts) {
                    for (var i = 0; i < muts.length; i++) {
                        var a = muts[i].addedNodes;
                        for (var j = 0; j < a.length; j++) RB.q.push(a[j]);
                    }
                    if (RB.q.length && !RB.raf) RB.raf = requestAnimationFrame(rbFlush);
                });
                RB.mo.observe(document.body, { childList: true, subtree: true });
            }
        } else {
            if (!RB.on) return;
            RB.on = false;
            if (RB.mo) { RB.mo.disconnect(); RB.mo = null; }
            if (RB.raf) { cancelAnimationFrame(RB.raf); RB.raf = 0; }
            RB.q = [];
            for (var i = RB.log.length - 1; i >= 0; i--) {
                var r = RB.log[i];
                try {
                    if (r.n) { if (r.n.nodeValue === r.o) r.n.nodeValue = r.v; }
                    else if (r.el.getAttribute(r.a) === r.o) r.el.setAttribute(r.a, r.v);
                } catch (e) { /* ignore */ }
            }
            RB.log = [];
        }
    }

    /* ------------------------------ theme on / off ------------------------------ */
    // the tab title and favicon become tHE THE's, and are put back exactly as they were
    function identity(on) {
        if (on) {
            if (S.idDone) return;
            S.idDone = true;
            S.oldTitle = document.title;
            document.title = TITLE;
            S.oldIcons = [];
            try {
                var ls = document.querySelectorAll('link[rel~="icon"]');
                for (var i = 0; i < ls.length; i++) { S.oldIcons.push({ el: ls[i], rel: ls[i].getAttribute('rel') }); ls[i].setAttribute('rel', 'x-tt-off-icon'); }
            } catch (e) { /* ignore */ }
            S.newIcon = mk('link'); S.newIcon.id = 'tt-icon'; S.newIcon.rel = 'icon'; S.newIcon.type = 'image/svg+xml'; S.newIcon.href = ICON;
            (document.head || ROOT).appendChild(S.newIcon);
        } else {
            if (!S.idDone) return;
            S.idDone = false;
            if (document.title === TITLE) document.title = S.oldTitle;
            if (S.newIcon && S.newIcon.parentNode) S.newIcon.parentNode.removeChild(S.newIcon);
            S.newIcon = null;
            S.oldIcons.forEach(function (o) { try { o.el.setAttribute('rel', o.rel || 'icon'); } catch (e) { /* ignore */ } });
            S.oldIcons = [];
        }
    }
    function setTheme(on) {
        var b = document.body;
        if (!b) return;
        if (on) {
            ROOT.classList.add('tt-on'); b.classList.add('tt-on');
            if (!S.mo && window.MutationObserver) {
                // some page script re-wrote body.className? put our marker back
                S.mo = new MutationObserver(function () { if (S.active && !b.classList.contains('tt-on')) b.classList.add('tt-on'); });
                S.mo.observe(b, { attributes: true, attributeFilter: ['class'] });
            }
        } else {
            if (S.mo) { S.mo.disconnect(); S.mo = null; }
            if (S.modeMo) { S.modeMo.disconnect(); S.modeMo = null; }
            var rc = ROOT.classList;
            rc.remove('tt-on'); rc.remove('tt-fx'); rc.remove('tt-rm'); rc.remove('tt-min'); rc.remove('tt-lite');
            b.classList.remove('tt-on');
        }
    }

    /* ------------------------------ meme pop-ups + opening rain ------------------------------ */
    function burstAt(x, y, count) {
        if (S.mode === 'full' && !S.lite && count > 1 && Math.random() < 0.3) {
            var en = readyEmote();
            if (en) {
                var mp = mascotImg('tt-pop tt-mascot', en, Math.round(rand(64, 92)));
                mp.style.left = x + 'px'; mp.style.top = y + 'px';
                mp.style.setProperty('--tt-x', Math.round(rand(-40, 40)) + 'px');
                mp.style.setProperty('--tt-y', Math.round(rand(-110, -60)) + 'px');
                mp.style.setProperty('--tt-r', Math.round(rand(-14, 14)) + 'deg');
                document.body.appendChild(mp);
                setTimeout(function () { if (mp.parentNode) mp.parentNode.removeChild(mp); }, 1000);
                count -= 1;
            }
        }
        for (var i = 0; i < count; i++) {
            var p = mk('span', 'tt-pop', pick(MEMES));
            p.style.left = x + 'px'; p.style.top = y + 'px';
            p.style.fontSize = Math.round(rand(16, 28)) + 'px';
            p.style.setProperty('--tt-x', Math.round(rand(-70, 70)) + 'px');
            p.style.setProperty('--tt-y', Math.round(rand(-120, -40)) + 'px');
            p.style.setProperty('--tt-r', Math.round(rand(-60, 60)) + 'deg');
            document.body.appendChild(p);
            (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(p);
        }
    }
    function onPop(e) {
        if (!S.active || S.mode !== 'full' || !(S.ev && S.ev.fx > 0)) return;
        var t = Date.now();
        if (t - S.lastPop < 90) return;
        S.lastPop = t;
        if (typeof e.clientX !== 'number') return;
        var n = POPS[Math.max(0, Math.min(3, S.ev.fx | 0))] || 0;
        burstAt(e.clientX, e.clientY, S.lite ? Math.max(1, Math.round(n / 2)) : n);
    }
    // one short shower of memes, the first time this visitor sees the event in a session (full effects, normal devices)
    function rain() {
        if (!S.root || S.mode !== 'full' || S.lite || !S.ev || calm()) return;
        var n = RAIN[Math.max(0, Math.min(3, S.ev.fx | 0))] || 0;
        if (small()) n = Math.round(n * 0.6);
        for (var i = 0; i < n; i++) {
            var d = (i % 7 === 3) ? mascotImg('tt-drop', anyIcon(), Math.round(rand(34, 52))) : mk('span', 'tt-drop', pick(MEMES));
            d.style.left = rand(0, 96).toFixed(1) + '%';
            if (d.tagName !== 'IMG') d.style.fontSize = Math.round(rand(18, 34)) + 'px';
            d.style.setProperty('--tt-d', rand(3.2, 5.5).toFixed(1) + 's');
            d.style.setProperty('--tt-delay', rand(0, 2.2).toFixed(1) + 's');
            d.style.setProperty('--tt-sway', Math.round(rand(-60, 60)) + 'px');
            d.style.setProperty('--tt-rot', Math.round(rand(-240, 240)) + 'deg');
            S.root.appendChild(d);
            (function (n2) { setTimeout(function () { if (n2.parentNode) n2.parentNode.removeChild(n2); }, 9000); })(d);
        }
    }

    /* ------------------------------ companions: Thea + Mirai peek in from the screen edges ------------------------------ */
    // [emote, line, crying?]   Thea is quiet and pretends she doesn't care. Mirai is loud and cries first.
    var PAL_LINES = {
        thea: [
            ['thea-sleepy',   '...it\u2019s been a while. i kept your seat warm.', 1],
            ['thea-silent',   '...thanks for coming back. don\u2019t tell anyone i said that.', 0],
            ['thea-sleepy',   'i fell asleep waiting for the server to wake up...', 0],
            ['thea-cat',      'the cat missed you too. i did not. (i did)', 0],
            ['thea-angry',    'if you say \u201Cwe should have never abandoned it\u201D i will cry. i\u2019m not crying.', 1],
            ['thea-confused', 'wait. you actually remember us?', 0],
            ['thea-happy',    'hey. stay a little longer, okay?', 0]
        ],
        mirai: [
            ['mirai-surprised', 'WAIT it\u2019s actually YOU?! i thought everyone left \uD83D\uDE2D', 1],
            ['mirai-love',      'you were here since day one, weren\u2019t you \uD83E\uDDE1', 0],
            ['mirai-excited',   'remember the 3am memes?? we were SO unhinged \uD83D\uDC80', 0],
            ['mirai-sleepy',    'the server went quiet... but we never left.', 1],
            ['mirai-confused',  'why am i crying?? it\u2019s just a website... \uD83D\uDE2D', 1],
            ['mirai-excited',   'SPECSOFT is cool but tHE THE was HOME \uD83E\uDDE1', 0],
            ['mirai-love',      '2022 us would be SO proud of you \uD83E\uDDE1', 1]
        ]
    };
    var PAL_POKE = {
        thea:  [['thea-angry', 'h-hey. don\u2019t poke me.'], ['thea-happy', '...okay that was a little nice.'], ['thea-confused', 'stop. (do it again)']],
        mirai: [['mirai-excited', 'HEHE that tickles!!'], ['mirai-love', 'you found me!! \uD83E\uDDE1'], ['mirai-surprised', 'again again AGAIN']]
    };
    // every 6th poke: they break
    var PAL_MISS = {
        thea:  ['thea-happy', '...you really did miss us. me too. a little.'],
        mirai: ['mirai-love', 'I\u2019M NOT CRYING YOU\u2019RE CRYING \uD83D\uDE2D\uD83E\uDDE1']
    };
    function palName(w) { return w === 'thea' ? 'Thea' : 'Mirai'; }
    function palSlots() {
        if (document.body && document.body.classList.contains('ch-body')) return ['right'];     // the chats page: right edge only, the composer + sidebar stay clear
        var s = ['left', 'right'];
        if (innerWidth >= 1000) s.push('bottom');
        return s;
    }
    function palLine(who) {
        var a = PAL_LINES[who], i = Math.floor(Math.random() * a.length);
        if (i === S.palIdx[who] && a.length > 1) i = (i + 1) % a.length;
        S.palIdx[who] = i;
        return a[i];
    }
    function palClear() {
        S.palTok++;
        clearTimeout(S.palT);
        S.pals.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        S.pals = [];
    }
    function palSwap(im, name) {      // swap the expression without a flash: load first, then switch
        var t = new Image();
        t.onload = function () { im.src = t.src; };
        t.src = spr(name);
        if (t.complete && t.naturalWidth) im.src = t.src;
    }
    function palTears(el, tok, n) {
        for (var i = 0; i < n; i++) {
            (function (k) {
                setTimeout(function () {
                    if (tok !== S.palTok || !el.parentNode) return;
                    var t = mk('span', 'tt-tear', '\uD83D\uDCA7');
                    t.style.setProperty('--tx', ((k % 2 ? 58 : 30) + Math.round(rand(-4, 4))) + '%');
                    el.appendChild(t);
                    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 1200);
                }, k * 420);
            })(i);
        }
    }
    function palLeave(el, tok) {
        if (tok !== S.palTok || !el.parentNode || el._gone) return;
        el._gone = true;
        el.classList.remove('tt-talk'); el.classList.remove('tt-in');
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
            var i = S.pals.indexOf(el);
            if (i > -1) S.pals.splice(i, 1);
            if (tok === S.palTok && el._done) el._done();
        }, 800);
    }
    function palPoke(el, who, tok) {
        if (tok !== S.palTok || el._gone) return;
        if (el._still) { toast(palName(who) + ': ' + pick(PAL_LINES[who])[1], 4200, MASCOTS[who].icon); return; }      // Reduce motion: no movement, the line goes to the toast
        S.palPokes++;
        var miss = S.palPokes % 6 === 0;
        var spec = miss ? PAL_MISS[who] : pick(PAL_POKE[who]);
        var im = el.querySelector('.tt-pal-img'), b = el.querySelector('.tt-bubble');
        if (im) palSwap(im, spec[0]);
        if (b) b.textContent = spec[1];
        el.classList.add('tt-talk');
        el.classList.remove('tt-hit'); void el.offsetWidth; el.classList.add('tt-hit');
        var r = el.getBoundingClientRect();
        burstAt(Math.max(20, Math.min(innerWidth - 20, r.left + r.width / 2)), r.top + r.height * 0.3, S.lite ? 2 : 4);
        if (miss) palTears(el, tok, 6);
        clearTimeout(el._life);
        el._life = setTimeout(function () { palLeave(el, tok); }, miss ? 4600 : 2400);
    }
    // spec = [emote, line, crying?]. still = Reduce motion: shown at once, stays, talks on click.
    function palShow(who, slot, spec, hold, done, still) {
        if (!S.root) return null;
        var tok = S.palTok, el = mk('div', 'tt-pal tt-' + slot);
        el.style.width = (small() ? 76 : Math.round(rand(96, 116))) + 'px';
        if (slot === 'bottom') el.style.left = Math.round(innerWidth * (Math.random() < 0.5 ? rand(0.26, 0.4) : rand(0.62, 0.74))) + 'px';
        else el.style.top = Math.round(innerHeight * rand(0.36, 0.6)) + 'px';
        el.appendChild(mascotImg('tt-pal-img tt-mascot', spec[0]));
        el.appendChild(mk('div', 'tt-bubble', spec[1]));
        el._done = done; el._still = !!still;
        el.addEventListener('pointerdown', function () { palPoke(el, who, tok); });
        S.root.appendChild(el);
        S.pals.push(el);
        void el.offsetWidth;
        el.classList.add('tt-in');
        if (still) return el;
        setTimeout(function () {
            if (tok !== S.palTok || el._gone) return;
            el.classList.add('tt-talk');
            if (spec[2]) palTears(el, tok, 5);
        }, 650);
        el._life = setTimeout(function () { palLeave(el, tok); }, hold);
        return el;
    }
    function palPeek() {
        if (!S.active || S.mode !== 'full' || !S.root) return;
        if (document.hidden || S.pals.length) { palSchedule(false); return; }
        var tok = S.palTok, slots = palSlots(), tk = 'tt.pal.' + (S.ev ? S.ev.id : '');
        function again() { if (tok === S.palTok) palSchedule(false); }
        // first time this session: a little reunion. Thea first (quiet, sleepy), then Mirai bursts in crying.
        if (!ssGet(tk)) {
            ssSet(tk, '1');
            var tl = PAL_LINES.thea[0], ml = PAL_LINES.mirai[0];
            if (slots.length > 1) {
                palShow('thea', 'left', tl, 6200, null);
                setTimeout(function () { if (tok === S.palTok) palShow('mirai', 'right', ml, 6200, again); }, 1700);
            } else palShow('mirai', slots[0], ml, 6200, again);
            S.palLast = 'mirai';
            return;
        }
        var who = Math.random() < 0.5 ? 'thea' : 'mirai';
        if (who === S.palLast && Math.random() < 0.7) who = who === 'thea' ? 'mirai' : 'thea';
        S.palLast = who;
        var spec = palLine(who);
        palShow(who, pick(slots), spec, Math.max(4200, Math.min(8000, 3600 + spec[1].length * 55)), again);
    }
    function palSchedule(first) {
        clearTimeout(S.palT);
        if (!S.active || S.mode !== 'full') return;
        S.palT = setTimeout(palPeek, first ? rand(6500, 9500) : (S.lite ? rand(30000, 50000) : rand(16000, 30000)));
    }
    // (re)start for the current motion mode: full = they come and go, Reduce motion = one still companion, Ultra = nobody
    function palSync() {
        palClear();
        if (!S.active || !S.root) return;
        if (S.mode === 'full') palSchedule(true);
        else if (S.mode === 'rm') {
            var who = pick(['thea', 'mirai']);
            palShow(who, pick(palSlots()), pick(PAL_LINES[who]), 0, null, true);
        }
    }

    /* ------------------------------ music (the OST) ------------------------------ */
    function userVol() { var v = parseFloat(lsGet(K_VOL)); return isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; }
    function targetVol() { return Math.max(0, Math.min(1, ((S.ev && S.ev.volume != null ? S.ev.volume : 60) / 100) * userVol())); }
    function syncPos() {
        var a = S.aud;
        if (!a || !S.ev || !isFinite(a.duration) || a.duration <= 0) return;
        var pos = (nowMs() - Date.parse(S.ev.starts_at)) / 1000;
        if (pos < 0) pos = 0;
        try { a.currentTime = pos % a.duration; } catch (e) { /* ignore */ }
    }
    function paintBtn() {
        if (!S.btn) return;
        S.btn.textContent = S.playing ? '\u275A\u275A' : '\u266A';     // pause / note
        S.btn.title = S.playing ? 'Pause the OST' : 'Play the OST';
        S.btn.classList.toggle('tt-ask', !S.playing && !lsGet(K_SND));
        if (S.muteBtn) { var m = lsGet(K_MUTE) === '1'; S.muteBtn.textContent = m ? '\uD83D\uDD07' : '\uD83D\uDD0A'; S.muteBtn.title = m ? 'Unmute' : 'Mute'; }
    }
    function fadeTo(a, to, ms, done) {
        clearInterval(S.fadeT);
        var from = a.volume, steps = Math.max(1, Math.round(ms / 60)), i = 0;
        S.fadeT = setInterval(function () {
            i++;
            try { a.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps))); } catch (e) { /* ignore */ }
            if (i >= steps) { clearInterval(S.fadeT); if (done) done(); }
        }, 60);
    }
    function ensureAudio() {
        if (S.aud || !S.ev || !S.ev.audio || !S.ev.audio.ost) return;
        var a = new Audio();
        a.preload = 'auto'; a.loop = true; a.volume = 0; a.src = S.ev.audio.ost; a.muted = lsGet(K_MUTE) === '1';
        a.addEventListener('pause', function () { S.playing = false; paintBtn(); });
        a.addEventListener('playing', function () { S.playing = true; S.blocked = false; paintBtn(); });
        S.aud = a;
    }
    function play(fromUser) {
        ensureAudio();
        var a = S.aud;
        if (!a) return;
        function go() {
            syncPos();
            var p = a.play();
            if (p && p.then) {
                p.then(function () { fadeTo(a, targetVol(), 1500); }).catch(function () { S.blocked = true; S.playing = false; paintBtn(); armGesture(); });
            } else fadeTo(a, targetVol(), 1500);
        }
        if (fromUser) lsSet(K_SND, '1');
        if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
        paintBtn();
    }
    function pause(fromUser) {
        var a = S.aud;
        if (fromUser) lsSet(K_SND, '0');
        if (!a) return;
        fadeTo(a, 0, 500, function () { try { a.pause(); } catch (e) { /* ignore */ } });
    }
    // browsers only allow sound after a tap: if the visitor chose sound before, the first tap anywhere resumes it
    function armGesture() {
        if (S.gestureArmed || lsGet(K_SND) !== '1') return;
        S.gestureArmed = true;
        function fire() {
            S.gestureArmed = false;
            document.removeEventListener('pointerdown', fire, true);
            document.removeEventListener('keydown', fire, true);
            if (S.active && lsGet(K_SND) === '1' && !S.playing) play(false);
        }
        document.addEventListener('pointerdown', fire, true);
        document.addEventListener('keydown', fire, true);
    }
    function stopMusic() {
        clearInterval(S.fadeT);
        var a = S.aud; S.aud = null; S.playing = false;
        if (!a) return;
        var v = a.volume;
        var i = setInterval(function () { v -= 0.1; if (v <= 0) { clearInterval(i); try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { /* ignore */ } } else { try { a.volume = v; } catch (e) { /* ignore */ } } }, 80);
    }

    /* ------------------------------ credits badge + music pill ------------------------------ */
    function buildBadges() {
        // the "tHE Credits" badge: your REAL APEX balance (0 for guests), under the tHE Credits name
        var cr = mk('button', 'tt-credits'); cr.type = 'button'; cr.title = 'tHE Credits';
        S.crB = mk('b', null, '0');
        cr.appendChild(mk('span', 'tt-coin', '$')); cr.appendChild(S.crB); cr.appendChild(mk('small', null, 'tHE Credits'));
        loadBalance();
        cr.addEventListener('click', function (e) {
            toast(pick((S.bal || 0) > 0 ? CREDIT_LINES_REAL : CREDIT_LINES), 3200, anyIcon());
            if (S.mode === 'full') { var r = cr.getBoundingClientRect(); burstAt(r.left + r.width / 2, r.top, S.lite ? 3 : 7); }
        });
        document.body.appendChild(cr);
        S.credits = cr;
        void cr.offsetWidth;
        cr.classList.add('tt-show');

        var hasMusic = !!(S.ev && S.ev.audio && S.ev.audio.ost);
        if (!hasMusic && !S.preview) return;
        var pill = mk('div', 'tt-pill');
        pill.setAttribute('role', 'group'); pill.setAttribute('aria-label', 'tHE THE music');
        if (hasMusic) {
            S.btn = mk('button', 'tt-btn', '\u266A'); S.btn.type = 'button';
            S.btn.addEventListener('click', function () { if (S.playing) pause(true); else play(true); });
            var lbl = mk('span', 'tt-lbl', 'tHE THE OST');
            S.vol = mk('input', 'tt-vol'); S.vol.type = 'range'; S.vol.min = '0'; S.vol.max = '100'; S.vol.step = '1'; S.vol.value = String(Math.round(userVol() * 100));
            S.vol.setAttribute('aria-label', 'Music volume');
            S.vol.addEventListener('input', function () { lsSet(K_VOL, String(S.vol.value / 100)); if (S.aud && S.playing) { clearInterval(S.fadeT); try { S.aud.volume = targetVol(); } catch (e) { /* ignore */ } } });
            S.muteBtn = mk('button', 'tt-btn tt-mute', '\uD83D\uDD0A'); S.muteBtn.type = 'button';
            S.muteBtn.addEventListener('click', function () {
                var m = lsGet(K_MUTE) === '1' ? '0' : '1'; lsSet(K_MUTE, m);
                if (S.aud) S.aud.muted = m === '1';
                paintBtn();
            });
            pill.appendChild(S.btn); pill.appendChild(lbl); pill.appendChild(S.vol); pill.appendChild(S.muteBtn);
        }
        if (S.preview) {
            var x = mk('button', 'tt-btn tt-mute', '\u2715'); x.type = 'button'; x.title = 'Exit the preview';
            x.addEventListener('click', function () { endNow(false); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } });
            pill.appendChild(x);
        }
        document.body.appendChild(pill);
        S.pill = pill;
        void pill.offsetWidth;
        pill.classList.add('tt-show');
        paintBtn();
    }

    /* ------------------------------ mode changes while the event runs ------------------------------ */
    function refreshMode() {
        if (!S.active) return;
        if (modeKey() === S.key) return;
        applyMode();
        loadAssets();
        paintBtn();
        palSync();
    }
    function hookWatchers() {
        if (!S.modeMo && window.MutationObserver) {
            S.modeMo = new MutationObserver(refreshMode);
            S.modeMo.observe(ROOT, { attributes: true, attributeFilter: ['class'] });
        }
        if (S.hooked) return;
        S.hooked = true;
        try { var ss = window.SpecSettings; if (ss && typeof ss.on === 'function') ss.on(function () { refreshMode(); }); } catch (e) { /* ignore */ }
        try {
            var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
            if (mq) { if (mq.addEventListener) mq.addEventListener('change', refreshMode); else if (mq.addListener) mq.addListener(refreshMode); }
        } catch (e) { /* ignore */ }
        // tab hidden: freeze the animations, nothing runs in a background tab
        document.addEventListener('visibilitychange', function () { if (S.root) S.root.classList.toggle('tt-paused', document.hidden); });
    }

    /* ------------------------------ activate / deactivate ------------------------------ */
    function activate() {
        if (S.active || !S.ev || !document.body) return;
        if (ROOT.classList.contains('kk-on')) return;           // the Kawaii event has the site right now: wait for it to end
        clearTimeout(S.outT);
        S.active = true;
        applyMode();
        loadAssets();
        setTheme(true);
        identity(true);
        rebrand(true);

        S.root = mk('div'); S.root.id = 'tt-root'; S.root.setAttribute('aria-hidden', 'true');
        if (document.hidden) S.root.classList.add('tt-paused');
        document.body.appendChild(S.root);
        buildBadges();
        buildBottomNav();
        preloadSprites();
        palSync();
        document.addEventListener('pointerdown', onPop, true);
        hookWatchers();

        if (lsGet(K_SND) === '1') { ensureAudio(); play(false); }

        var tk = 'tt.toast.' + S.ev.id;
        var first = S.preview || !ssGet(tk);
        if (first) {
            ssSet(tk, '1');
            rain();
            var line, face = anyIcon();
            if (S.ev.label) line = S.ev.label + ' \uD83D\uDDFF';
            else if (S.mode !== 'min' && Math.random() < 0.6) { var ml = pick(MASCOT_LINES); line = ml[1]; face = MASCOTS[ml[0]].icon; }
            else line = pick(LINES);
            toast(S.preview ? 'tHE THE preview \uD83D\uDDFF only you can see this' : (line + (S.ev.audio && S.ev.audio.ost && lsGet(K_SND) !== '1' ? '  \u00B7  tap \u266A for the OST' : '')), 5200, face);
        }
    }
    function deactivate(announce) {
        if (!S.active) return;
        S.active = false;
        document.removeEventListener('pointerdown', onPop, true);
        palClear();
        stopMusic();
        identity(false);
        rebrand(false);
        if (S.pill) S.pill.classList.remove('tt-show');
        if (S.credits) S.credits.classList.remove('tt-show');
        if (S.bnFn) { window.removeEventListener('scroll', S.bnFn); S.bnFn = null; }
        if (S.balFn) { window.removeEventListener('apex:balance', S.balFn); S.balFn = null; }
        clearTimeout(S.balT); S.crB = null;
        if (S.bn) S.bn.classList.add('tt-hide');
        var root = S.root, pill = S.pill, credits = S.credits, bn = S.bn;
        S.root = null; S.pill = null; S.credits = null; S.bn = null; S.btn = null; S.muteBtn = null; S.vol = null;
        clearTimeout(S.outT);
        S.outT = setTimeout(function () {
            [root, pill, credits, bn].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
            if (!S.active) setTheme(false);
        }, 900);
        if (announce) { var by = pick(BYE_LINES); toast(by[1] + '  \u00B7  back to SPECSOFT', 5600, MASCOTS[by[0]].icon); }
    }
    function endNow(announce) {
        if (S.tickT) { clearInterval(S.tickT); S.tickT = 0; }
        var was = S.active;
        deactivate(announce && was);
        S.ev = null;
        lsDel(K_CACHE);
    }

    /* ------------------------------ clock ------------------------------ */
    function tick() {
        if (!S.ev) return;
        var t = nowMs(), s = Date.parse(S.ev.starts_at), e = Date.parse(S.ev.ends_at);
        if (t >= e) { endNow(S.active && !S.preview); return; }
        if (t >= s) activate();
    }
    function setEvent(ev) {
        S.ev = ev;
        if (!S.preview) lsSet(K_CACHE, JSON.stringify({ ev: ev, off: S.off, at: Date.now() }));
        if (!S.tickT) S.tickT = setInterval(tick, 1000);
        tick();
    }

    /* ------------------------------ polling ------------------------------ */
    function handle(d, t0) {
        if (S.preview) return;
        var t1 = Date.now();
        if (d && d.now) S.off = Date.parse(d.now) - (t0 + t1) / 2;
        var ev = d && d.event;
        if (!ev) { if (S.ev) endNow(S.active); return; }
        setEvent(ev);
    }
    function poll() {
        if (S.preview || document.hidden) return Promise.resolve();
        var t0 = Date.now();
        return plainRpc('site_thethe_now', {}).then(function (d) { handle(d, t0); }).catch(function () { /* offline, or the SQL is not installed: stay quiet */ });
    }
    function schedule() {
        clearTimeout(S.pollT);
        var ms = 30000;
        if (S.ev) {
            var t = nowMs(), s = Date.parse(S.ev.starts_at);
            if (s - t < 120000 && t < s + 60000) ms = 5000; else if (S.active) ms = 20000;
        }
        S.pollT = setTimeout(function () { poll().then(schedule, schedule); }, ms);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !S.preview) poll(); });

    /* ------------------------------ preview (staff, local only) ------------------------------ */
    function startPreview() {
        S.preview = true; clearTimeout(S.pollT);
        var cfg = {};
        try { cfg = JSON.parse(lsGet(K_PREV) || '{}') || {}; } catch (e) { cfg = {}; }
        var n = Date.now();
        S.off = 0;
        setEvent({
            id: 'preview', label: 'Preview', starts_at: new Date(n - 1000).toISOString(), ends_at: new Date(n + 3600000).toISOString(),
            duration_s: 3600, volume: cfg.volume != null ? cfg.volume : 60, fx: cfg.fx != null ? cfg.fx : 2,
            audio: { ost: (cfg.audio && cfg.audio.ost) || null }
        });
    }

    /* ------------------------------ boot ------------------------------ */
    function boot() {
        if (PREVIEW) { startPreview(); return; }
        // instant, no flash: if the last page saw a live event that is still running, switch on right away
        try {
            var c = JSON.parse(lsGet(K_CACHE) || 'null');
            if (c && c.ev && Date.now() - c.at < 6 * 3600000) {
                S.off = c.off || 0;
                var t = nowMs();
                if (t >= Date.parse(c.ev.starts_at) && t < Date.parse(c.ev.ends_at)) setEvent(c.ev);
            }
        } catch (e) { /* ignore */ }
        poll().then(schedule, schedule);
    }
    if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot, { once: true });

    window.SpecTheThe = {
        preview: startPreview,
        end: function () { endNow(false); },
        state: function () { return { active: S.active, playing: S.playing, preview: S.preview, event: S.ev && S.ev.id }; }
    };
})();
