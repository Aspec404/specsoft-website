/* ==========================================================================
   SPECSOFT® kawaii-event.js  -  the KAWAII THEME EVENT, live and synced for every visitor
   (a "theme / chill" event: no countdown, no survivors, no rewards, just vibes)

   Loaded automatically by seasons.js on every page that has seasons.js (nothing else to add).
   Skipped on admin.html and login.html, and on any page whose <html> has data-kawaii-off.

   How it works
     * Every 30s (5s when an event is about to start, 20s while it runs) the page asks the database:
       site_kawaii_now(). The answer carries SERVER time, so everybody switches on and off together.
     * While the event runs:
         - html + body get the class  kk-on  (kawaii-event.css swaps the palette to white + pastel)
         - body also gets  light-mode  so the rest of the site (logos, seasons particles ...) behaves like light mode
         - floating sparkles, cherry blossom petals, a soft pastel wash, a lace edge, bows, a heart cursor,
           a sparkle trail behind the mouse and little hearts when you click
         - a music pill (bottom left): play / pause, mute, volume. Music NEVER starts by itself on a
           first visit (browsers block that and it is rude): the visitor taps play once, and after that
           it keeps playing on every page, in sync with the server clock.
     * When the event ends (or staff abort it) everything is removed and the visitor's own saved
       light / dark choice (localStorage "specsoft-theme") is put back. Nothing is ever deleted.
   MOTION MODES, switched live (no reload) when the visitor changes Settings or their OS:
     full  everything, minus the heavy bits on weak devices (fewer particles, no shimmer / heartbeat / trail)
     rm    Reduce motion (html.ss-reduce-motion or the OS setting): same pastel look, decorations are STILL
     min   Ultra reduce motion (html.ss-urm): palette + music pill only. No effect layers, no extra font.
   HEART CURSOR: while the event runs <html> has the class kk-hc. cursor.js (the site's custom cursor) turns its dot into a
   heart and its click bursts / trail markers into hearts. Without cursor.js running (cursor off in Settings, Ultra reduce
   motion, touch) the CSS falls back to a native heart cursor (class kk-heart).

   If the tHE THE event is running at the same moment, whichever started first keeps the site and the other waits.

   Staff preview (nobody else sees it): Console > Events > Kawaii > "Preview (new tab)"
   or open  index.html#kawaii-preview
   Public API: window.SpecKawaii { preview(), end(), state() }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecKawaii) return;

    var ROOT = document.documentElement;
    var PATH = (location.pathname || '').toLowerCase();
    var PREVIEW = location.hash === '#kawaii-preview';
    if (/(^|\/)(admin|login)(\.html)?$/.test(PATH) || ROOT.hasAttribute('data-kawaii-off')) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    var CSS_URL = SELF ? SELF.replace(/kawaii-event\.js(\?.*)?$/, 'kawaii-event.css$1') : 'kawaii-event.css';
    var FONT_URL = 'https://fonts.googleapis.com/css2?family=Quicksand:wght@500;600;700&display=swap';
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var K_CACHE = 'kk.cache', K_SND = 'kk.snd', K_VOL = 'kk.vol', K_MUTE = 'kk.mute', K_PREV = 'kk.preview.cfg';
    var BITS = ['\u2726', '\u2661', '\u2727', '\u2605', '\u2665', '\u273F', '\u2606', '\u2740'];   // ✦ ♡ ✧ ★ ♥ ✿ ☆ ❀
    var POPS = ['\u2661', '\u2665', '\u2726', '\u2605', '\u273F'];
    var LEVELS = [0, 10, 18, 30];
    var PETALS = [0, 6, 12, 20];
    var TRAIL = ['\u2726', '\u2727', '\u2661', '\u2740'];
    var KAO = ['(\uFF61\u2665\u203F\u2665\uFF61)', '(\u0E51>\u1D17<\u0E51)', '(\u25D5\u203F\u25D5\u273F)', '\u2606*:.\uFF61.o(\u2267\u25BD\u2266)o.\uFF61.:*\u2606', '(\u2740\u25E0\u203F\u25E0)'];

    var S = {
        ev: null, off: 0, active: false, preview: false, pollT: 0, tickT: 0,
        root: null, fx: null, petals: null, pill: null, toastEl: null, mo: null, outT: 0,
        aud: null, playing: false, blocked: false, gestureArmed: false, btn: null, muteBtn: null, vol: null,
        lastPop: 0, popFn: null, fadeT: 0, lastTrail: 0, trailN: 0,
        mode: 'full', lite: false, key: '', modeMo: null, hooked: false, small: false, resizeT: 0
    };

    /* ------------------------------ small helpers ------------------------------ */
    function nowMs() { return Date.now() + S.off; }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* blocked */ } }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function small() { return innerWidth < 700; }
    function calm() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
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
        S.key = modeKey();
        var c = ROOT.classList;
        c.remove('kk-fx'); c.remove('kk-rm'); c.remove('kk-min'); c.remove('kk-lite');
        c.add(S.mode === 'full' ? 'kk-fx' : S.mode === 'rm' ? 'kk-rm' : 'kk-min');
        if (S.lite) c.add('kk-lite');
        c.add('kk-heart'); c.add('kk-hc');
    }
    function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function plainRpc(name, args) {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + name, {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(args || {}), cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('kawaii ' + r.status); return r.json(); });
    }

    function loadAssets() {
        if (!document.getElementById('kk-css')) {
            var l = mk('link'); l.id = 'kk-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
            (document.head || ROOT).appendChild(l);
        }
        if (S.mode !== 'min' && !document.getElementById('kk-font')) {
            var f = mk('link'); f.id = 'kk-font'; f.rel = 'stylesheet'; f.href = FONT_URL;
            (document.head || ROOT).appendChild(f);
        }
    }

    /* ------------------------------ toast ------------------------------ */
    function toast(msg, ms) {
        if (!S.toastEl) { S.toastEl = mk('div', 'kk-toast'); S.toastEl.setAttribute('role', 'status'); document.body.appendChild(S.toastEl); }
        S.toastEl.textContent = msg;
        void S.toastEl.offsetWidth;
        S.toastEl.classList.add('kk-show');
        clearTimeout(S.toastEl._t);
        S.toastEl._t = setTimeout(function () { if (S.toastEl) S.toastEl.classList.remove('kk-show'); }, ms || 4200);
    }

    /* ------------------------------ theme on / off ------------------------------ */
    function setTheme(on) {
        var b = document.body;
        if (!b) return;
        if (on) {
            ROOT.classList.add('kk-on'); b.classList.add('kk-on'); b.classList.add('light-mode');
            if (!S.mo && window.MutationObserver) {
                // if the visitor flips the theme toggle during the event, keep the light-mode class (their click is still saved for later)
                S.mo = new MutationObserver(function () {
                    if (S.active && !b.classList.contains('light-mode')) b.classList.add('light-mode');
                    if (S.active && !b.classList.contains('kk-on')) b.classList.add('kk-on');
                });
                S.mo.observe(b, { attributes: true, attributeFilter: ['class'] });
            }
        } else {
            if (S.mo) { S.mo.disconnect(); S.mo = null; }
            if (S.modeMo) { S.modeMo.disconnect(); S.modeMo = null; }
            var rc = ROOT.classList;
            rc.remove('kk-on'); rc.remove('kk-fx'); rc.remove('kk-rm'); rc.remove('kk-min'); rc.remove('kk-lite'); rc.remove('kk-heart'); rc.remove('kk-hc');
            b.classList.remove('kk-on');
            // put the visitor's own choice back (dark is the site default)
            if (lsGet('specsoft-theme') === 'light') b.classList.add('light-mode'); else b.classList.remove('light-mode');
        }
    }

    /* ------------------------------ sparkles + click hearts ------------------------------ */
    function buildSparkles(level) {
        if (!S.fx) return;
        S.fx.textContent = '';
        if (S.mode !== 'full') return;
        var n = LEVELS[Math.max(0, Math.min(3, level | 0))] || 0;
        if (small()) n = Math.round(n * 0.55);
        if (S.lite) n = Math.round(n * 0.5);
        for (var i = 0; i < n; i++) {
            var s = mk('span', 'kk-bit c' + (1 + Math.floor(Math.random() * 4)), BITS[Math.floor(Math.random() * BITS.length)]);
            s.style.left = rand(0, 98).toFixed(1) + '%';
            s.style.fontSize = Math.round(rand(11, 27)) + 'px';
            s.style.setProperty('--kk-d', rand(11, 22).toFixed(1) + 's');
            s.style.setProperty('--kk-delay', (-rand(0, 20)).toFixed(1) + 's');
            s.style.setProperty('--kk-sway', Math.round(rand(-60, 60)) + 'px');
            S.fx.appendChild(s);
        }
    }
    function buildPetals(level) {
        if (!S.petals) return;
        S.petals.textContent = '';
        if (S.mode !== 'full') return;
        var n = PETALS[Math.max(0, Math.min(3, level | 0))] || 0;
        if (small()) n = Math.round(n * 0.6);
        if (S.lite) n = Math.round(n * 0.5);
        for (var i = 0; i < n; i++) {
            var p = mk('span', 'kk-petal');
            p.style.left = rand(0, 98).toFixed(1) + '%';
            p.style.setProperty('--kk-s', Math.round(rand(9, 17)) + 'px');
            p.style.setProperty('--kk-d', rand(13, 24).toFixed(1) + 's');
            p.style.setProperty('--kk-delay', (-rand(0, 22)).toFixed(1) + 's');
            p.style.setProperty('--kk-sway', Math.round(rand(-70, 90)) + 'px');
            S.petals.appendChild(p);
        }
    }
    // little sparkles that follow a real mouse (not touch), capped so it never gets heavy
    function onTrail(e) {
        if (!S.active || S.mode !== 'full' || S.lite || e.pointerType !== 'mouse' || !(S.ev && S.ev.sparkles > 0)) return;
        var t = Date.now();
        if (t - S.lastTrail < 70 || S.trailN > 18) return;
        S.lastTrail = t;
        var s = mk('span', 'kk-trail', TRAIL[Math.floor(Math.random() * TRAIL.length)]);
        s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px';
        s.style.fontSize = Math.round(rand(9, 17)) + 'px';
        s.style.color = ['#ff8fc4', '#b9a4ff', '#8fd8ff', '#ffd37a'][Math.floor(Math.random() * 4)];
        s.style.setProperty('--kk-dx', Math.round(rand(-14, 14)) + 'px');
        document.body.appendChild(s);
        S.trailN++;
        setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); S.trailN = Math.max(0, S.trailN - 1); }, 850);
    }
    // builds the effect layers for the CURRENT mode (called on activate and again whenever the mode changes)
    function buildLayers() {
        if (!S.root) return;
        S.root.textContent = '';
        S.fx = null; S.petals = null;
        S.small = small();
        if (S.mode === 'min') return;                       // Ultra reduce motion: nothing to draw
        S.root.appendChild(mk('div', 'kk-wash'));
        if (S.mode === 'full') {
            S.fx = mk('div', 'kk-fx'); S.root.appendChild(S.fx);
            S.petals = mk('div', 'kk-fx kk-petals'); S.root.appendChild(S.petals);
        }
        S.root.appendChild(mk('div', 'kk-lace'));
        S.root.appendChild(mk('div', 'kk-bow b1', '\uD83C\uDF80'));
        S.root.appendChild(mk('div', 'kk-bow b2', '\uD83C\uDF80'));
        if (S.mode === 'full' && S.ev) { buildSparkles(S.ev.sparkles); buildPetals(S.ev.sparkles); }
    }
    // the visitor changed Settings (or the OS did): re-check the mode and rebuild only if something really changed
    function refreshMode() {
        if (!S.active) return;
        if (modeKey() === S.key) return;
        applyMode();
        loadAssets();
        buildLayers();
        if (S.root) S.root.classList.add('kk-in');
        paintBtn();
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
        window.addEventListener('resize', function () {
            clearTimeout(S.resizeT);
            S.resizeT = setTimeout(function () { if (S.active && S.mode === 'full' && small() !== S.small) buildLayers(); }, 500);
        });
        // tab hidden: freeze the animations, nothing runs in a background tab
        document.addEventListener('visibilitychange', function () { if (S.root) S.root.classList.toggle('kk-paused', document.hidden); });
    }
    function onPop(e) {
        if (!S.active || S.mode !== 'full') return;
        var t = Date.now();
        if (t - S.lastPop < 90) return;
        S.lastPop = t;
        var x = e.clientX, y = e.clientY;
        if (typeof x !== 'number') return;
        for (var i = 0; i < (S.lite ? 3 : 5); i++) {
            var p = mk('span', 'kk-pop c' + (1 + Math.floor(Math.random() * 4)), POPS[Math.floor(Math.random() * POPS.length)]);
            p.style.left = x + 'px'; p.style.top = y + 'px';
            p.style.fontSize = Math.round(rand(12, 22)) + 'px';
            p.style.color = ['#ff8fc4', '#b9a4ff', '#8fd8ff', '#ffd37a'][i % 4];
            p.style.setProperty('--kk-x', Math.round(rand(-55, 55)) + 'px');
            p.style.setProperty('--kk-y', Math.round(rand(-90, -30)) + 'px');
            p.style.setProperty('--kk-r', Math.round(rand(-70, 70)) + 'deg');
            document.body.appendChild(p);
            (function (n) { setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000); })(p);
        }
    }

    /* ------------------------------ music ------------------------------ */
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
        S.btn.textContent = S.playing ? '\u275A\u275A' : '\u266A';     // ❚❚ / ♪
        S.btn.title = S.playing ? 'Pause the music' : 'Play the music';
        S.btn.classList.toggle('kk-ask', !S.playing && !lsGet(K_SND));
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

    function buildPill() {
        var hasMusic = !!(S.ev && S.ev.audio && S.ev.audio.ost);
        if (!hasMusic && !S.preview) return;
        var pill = mk('div', 'kk-pill');
        pill.setAttribute('role', 'group'); pill.setAttribute('aria-label', 'Kawaii music');
        if (hasMusic) {
            S.btn = mk('button', 'kk-btn', '\u266A'); S.btn.type = 'button';
            S.btn.addEventListener('click', function () { if (S.playing) pause(true); else play(true); });
            var lbl = mk('span', 'kk-lbl', 'kawaii vibes');
            S.vol = mk('input', 'kk-vol'); S.vol.type = 'range'; S.vol.min = '0'; S.vol.max = '100'; S.vol.step = '1'; S.vol.value = String(Math.round(userVol() * 100));
            S.vol.setAttribute('aria-label', 'Music volume');
            S.vol.addEventListener('input', function () { lsSet(K_VOL, String(S.vol.value / 100)); if (S.aud && S.playing) { clearInterval(S.fadeT); try { S.aud.volume = targetVol(); } catch (e) { /* ignore */ } } });
            S.muteBtn = mk('button', 'kk-btn kk-mute', '\uD83D\uDD0A'); S.muteBtn.type = 'button';
            S.muteBtn.addEventListener('click', function () {
                var m = lsGet(K_MUTE) === '1' ? '0' : '1'; lsSet(K_MUTE, m);
                if (S.aud) S.aud.muted = m === '1';
                paintBtn();
            });
            pill.appendChild(S.btn); pill.appendChild(lbl); pill.appendChild(S.vol); pill.appendChild(S.muteBtn);
        }
        if (S.preview) {
            var x = mk('button', 'kk-btn kk-mute', '\u2715'); x.type = 'button'; x.title = 'Exit the preview';
            x.addEventListener('click', function () { endNow(false); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ } });
            pill.appendChild(x);
        }
        document.body.appendChild(pill);
        S.pill = pill;
        void pill.offsetWidth;
        pill.classList.add('kk-show');
        paintBtn();
    }

    /* ------------------------------ activate / deactivate ------------------------------ */
    function activate() {
        if (S.active || !S.ev || !document.body) return;
        if (ROOT.classList.contains('tt-on')) return;           // the tHE THE event has the site right now: wait for it to end
        clearTimeout(S.outT);
        S.active = true;
        applyMode();
        loadAssets();
        setTheme(true);

        S.root = mk('div'); S.root.id = 'kk-root'; S.root.setAttribute('aria-hidden', 'true');
        if (document.hidden) S.root.classList.add('kk-paused');
        document.body.appendChild(S.root);
        buildLayers();
        void S.root.offsetWidth;
        S.root.classList.add('kk-in');
        hookWatchers();

        buildPill();
        document.addEventListener('pointerdown', onPop, true);
        document.addEventListener('pointermove', onTrail, true);

        if (lsGet(K_SND) === '1') { ensureAudio(); play(false); }

        var tk = 'kk.toast.' + S.ev.id;
        if (S.preview || !ssGet(tk)) {
            ssSet(tk, '1');
            var kao = KAO[Math.floor(Math.random() * KAO.length)];
            toast(S.preview ? 'Kawaii preview ' + kao + ' only you can see this' : ((S.ev.label ? S.ev.label + ' ' + kao + ' ' : 'Kawaii mode is ON ' + kao + ' ') + (S.ev.audio && S.ev.audio.ost && lsGet(K_SND) !== '1' ? 'tap \u266A for music' : 'enjoy the vibes')));
        }
    }
    function deactivate(announce) {
        if (!S.active) return;
        S.active = false;
        document.removeEventListener('pointerdown', onPop, true);
        document.removeEventListener('pointermove', onTrail, true);
        stopMusic();
        if (S.root) { S.root.classList.remove('kk-in'); S.root.classList.add('kk-out'); }
        if (S.pill) S.pill.classList.remove('kk-show');
        var root = S.root, pill = S.pill;
        S.root = null; S.fx = null; S.petals = null; S.pill = null; S.btn = null; S.muteBtn = null; S.vol = null;
        clearTimeout(S.outT);
        S.outT = setTimeout(function () {
            if (root && root.parentNode) root.parentNode.removeChild(root);
            if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
            if (!S.active) setTheme(false);
        }, 1500);
        if (announce) toast('Kawaii mode is over. Back to normal \uD83C\uDF38');
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
        if (t >= e) { endNow(S.active && !S.preview); if (S.preview) { /* nothing */ } return; }
        if (t >= s) activate();
    }
    function setEvent(ev) {
        var same = S.ev && S.ev.id === ev.id;
        S.ev = ev;
        if (!S.preview) lsSet(K_CACHE, JSON.stringify({ ev: ev, off: S.off, at: Date.now() }));
        if (!same && S.active) { buildSparkles(ev.sparkles); buildPetals(ev.sparkles); }
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
        return plainRpc('site_kawaii_now', {}).then(function (d) { handle(d, t0); }).catch(function () { /* offline, or the SQL is not installed: stay quiet */ });
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
            duration_s: 3600, volume: cfg.volume != null ? cfg.volume : 60, sparkles: cfg.sparkles != null ? cfg.sparkles : 2,
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

    window.SpecKawaii = {
        preview: startPreview,
        end: function () { endNow(false); },
        state: function () { return { active: S.active, playing: S.playing, preview: S.preview, event: S.ev && S.ev.id }; }
    };
})();
