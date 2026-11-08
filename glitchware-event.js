/* ==========================================================================
   SPECSOFT® glitchware-event.js  -  the GLITCHWARE EVENT, live and synced for every visitor

   Loaded automatically by seasons.js on every page that has seasons.js (nothing else to add).
   Skipped on admin.html and login.html, and on any page whose <html> has data-glitch-off or data-nuke-off.

   The story
     The page gets HIJACKED by glitchware: the screen tears, text scrambles, fake error windows pile up
     and the VILLAIN (the image staff upload in Console > Events > Glitchware) watches you.
     Hidden APEX Credits are scattered over the HUNT PAGES staff picked. Collect enough points (the goal)
     before the timer ends and the glitchware is PURGED. If the timer hits 0:00 first: the villain
     jumpscares you, crash screen, no rewards.

   How it works
     * Every 30s (5s when an event is near) the page asks the database: site_glitch_now().
       The answer carries SERVER time, so every timer matches no matter when you joined.
     * Phases, all computed from the server clock:
         wait   small "anomaly incoming" bar in the last 30s
         run    hijack takeover, glitch bursts, fake windows, hidden credits, scanner, timer
         outro  not purged = pile-up, jumpscare, crash screen (about 9s)   |   purged = nothing, you already won
         report ending screen: @username [ PURGED ] / [ INFECTED ]
     * Credits are counted by the SERVER (glitch_collect). Rewards are paid in the database.
       Signed-out visitors and the staff preview play in practice mode: no rewards, nothing is counted.
     * Credits only exist on the event's hunt pages (file name without .html, e.g. index, store, chats).
     * Nothing on the device is touched. The fake windows, errors and the scare are only pictures.
   Sound (5 slots, all optional): main OST (loops), panic OST (takes over for the last 30 seconds),
   jumpscare sound, crash screen ambience (loops), victory sting. Only plays when the visitor has sound ON
   (speaker toggle) or taps the sound button. Built-in synth sounds are used for the scare and the purge
   when nothing was uploaded.
   Reduce effects (OS setting, Settings page, or the button on the warning) turns on a calm version:
   no flashing glitches, no shaking, no villain peeking, slow windows and NO jumpscare (a plain crash screen instead).

   Staff preview (nobody else sees it, no rewards). The Console button fills in your CURRENT villain image,
   OSTs and look first, so you can hear and see them before launching:
        index.html#glitch-preview        a full run, 90 seconds
        index.html#glitch-preview-lose   a short run you cannot win (tests the jumpscare), 25 seconds
   Public API: window.SpecGlitch { preview(lose), state() }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecGlitch) return;

    var ROOT = document.documentElement;
    var PATH = (location.pathname || '').toLowerCase();
    var HASH = location.hash;
    var PREVIEW = HASH === '#glitch-preview' || HASH === '#glitch-preview-lose';
    if (/(^|\/)(admin|login)(\.html)?$/.test(PATH) || ROOT.hasAttribute('data-glitch-off') || ROOT.hasAttribute('data-nuke-off')) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    var CSS_URL = SELF ? SELF.replace(/glitchware-event\.js(\?.*)?$/, 'glitchware-event.css$1') : 'glitchware-event.css';
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var CALM_KEY = 'specsoft.nuke.calm';          // shared with the nuke event: one "Reduce effects" switch for all events
    var PREVIEW_KEY = 'gw.preview.cfg';           // the Console writes your current villain / OSTs here before opening a preview
    var INTRO_MS = 5200, OUTRO_MS = 9600;
    var T_CUT = 1500, T_SCARE = 2000, T_CRASH = 4100;   // loss sequence, ms after the timer hits 0:00
    var PANIC_S = 30;                                   // the panic OST takes over when this many seconds are left
    var CREDIT_ICON = 'apex-credits.png';

    // how wild each intensity is (bursts = glitch flashes, win = ms between new fake windows, cap = max windows)
    var LV = {
        low:    { burst: [1800, 3600], tears: 3,  scr: 2, win: 9000, cap: 5 },
        medium: { burst: [1000, 2400], tears: 6,  scr: 4, win: 5200, cap: 9 },
        chaos:  { burst: [500, 1400],  tears: 10, scr: 7, win: 2600, cap: 14 }
    };

    var S = {
        ev: null, off: 0, phase: 'none', loop: 0, pollT: 0, preview: false,
        user: null, name: '', pts: 0, got: {}, purged: false, joined: false,
        calm: false, snd: false, blocked: false, auds: {}, prog: 0,
        root: null, cbox: null, items: [], wins: [], inc: null, rep: null, reportShown: false, seen: false,
        burstT: 0, endBurstT: 0, winT: 0, pileI: 0, outT: [], outroOn: false, annT: 0,
        tears: [], scr: [], cand: null, candAt: 0, cx: 0, cy: 0, zTop: 30, vimg: null,
        ann40: false, ann60: false, ann15: false,
        pending: 0, verifying: false
    };
    S.cx = innerWidth / 2; S.cy = innerHeight / 2;

    /* ------------------------------ small helpers ------------------------------ */
    function nowMs() { return Date.now() + S.off; }
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    function mmss(sec) { sec = Math.max(0, Math.floor(sec)); return p2(Math.floor(sec / 60)) + ':' + p2(sec % 60); }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function small() { return innerWidth < 700; }
    function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

    function hashStr(s) { var x = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
    function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

    // which page are we on? (the server stores credits per page key, and staff pick the hunt pages by these keys)
    var PAGE = (function () {
        var p = (location.pathname || '/').split('/').pop().replace(/\.html?$/i, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return (p || 'index').slice(0, 32);
    })();
    // point value of a hidden credit: must match glitch_value() in supabase-glitchware.sql
    function valueOf(i) { return i % 6 === 0 ? 25 : (i % 3 === 0 ? 10 : 5); }
    function lv() { return LV[S.ev && S.ev.intensity] || LV.medium; }
    // is this page one of the hunt pages? (an empty list = everywhere, only used by the staff preview)
    function onHuntPage() { var p = S.ev && S.ev.pages; return !p || !p.length || p.indexOf(PAGE) >= 0; }
    function villainUrl() { return (S.ev && S.ev.villain) || ''; }
    function safeUrl(u) { return (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u)) ? u : ''; }

    function reducedMotion() {
        try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true; } catch (e) { /* ignore */ }
        try { if (window.SpecSettings && typeof window.SpecSettings.get === 'function' && window.SpecSettings.get('reduceMotion') === true) return true; } catch (e) { /* ignore */ }
        return lsGet(CALM_KEY) === '1';
    }
    function fmtDT(ms) {
        var d = new Date(ms);
        try {
            if (window.SpecSettings && SpecSettings.fmtDate && SpecSettings.fmtTime) {
                var a = SpecSettings.fmtDate(d), b = SpecSettings.fmtTime(d);
                if (typeof a === 'string' && typeof b === 'string') return a + ' \u00B7 ' + b;
            }
        } catch (e) { /* fall back */ }
        return d.toLocaleString();
    }
    function ensureCss() {
        if (document.getElementById('gw-css')) return;
        var l = document.createElement('link');
        l.id = 'gw-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
        (document.head || ROOT).appendChild(l);
    }
    function toast(msg) {
        ensureCss();
        var t = h('div', 'gw-toast', msg); t.setAttribute('role', 'status');
        ROOT.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5200);
    }
    function nukeBusy() { try { var st = window.SpecNuke && window.SpecNuke.state && window.SpecNuke.state(); return !!st && (st.phase === 'count' || st.phase === 'after'); } catch (e) { return false; } }
    // load the villain picture early so the jumpscare never waits for a download
    function preloadVillain(url) { if (!url) return; try { var im = new Image(); im.src = url; S.vimg = im; } catch (e) { /* ignore */ } }

    /* ------------------------------ data ------------------------------ */
    function plainRpc(name, args) {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + name, {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(args || {}), cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('glitch ' + r.status); return r.json(); });
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
            if (S.user && !S.name) {
                try {
                    Promise.resolve(c.from('profiles').select('username').eq('id', S.user.id).maybeSingle()).then(function (q) {
                        var n = q && q.data && q.data.username; if (n) S.name = String(n).slice(0, 24);
                    }).catch(function () { /* ignore */ });
                } catch (e) { /* ignore */ }
            }
            return S.user;
        }).catch(function () { return null; });
    }

    /* ------------------------------ saved progress (per tab session, so page changes keep your count) ------------------------------ */
    function stKey() { return 'gw.st.' + (S.ev ? S.ev.id : ''); }
    function saveState() { ssSet(stKey(), JSON.stringify({ p: S.pts, g: Object.keys(S.got), u: S.purged ? 1 : 0 })); }
    function loadState() {
        S.pts = 0; S.got = {}; S.purged = false;
        try {
            var o = JSON.parse(ssGet(stKey()) || 'null');
            if (o) { S.pts = o.p | 0; (o.g || []).forEach(function (k) { S.got[k] = 1; }); S.purged = !!o.u; }
        } catch (e) { /* ignore */ }
    }

    /* ------------------------------ sound ------------------------------ */
    function vol() { var v = S.ev && S.ev.volume != null ? S.ev.volume : 80; return Math.max(0, Math.min(1, v / 100)) * 0.9; }
    var AC = null;
    function ac() { if (AC) return AC; try { var C = window.AudioContext || window.webkitAudioContext; if (C) AC = new C(); } catch (e) { AC = null; } return AC; }
    function track(name, url, loop, pos) {
        stopTrack(name);
        if (!url) return;
        var a = new Audio();
        a.preload = 'auto'; a.loop = !!loop; a.volume = vol(); a.src = url;
        S.auds[name] = a;
        function go() {
            try { if (pos > 0 && isFinite(a.duration) && a.duration > 0) a.currentTime = loop ? (pos % a.duration) : Math.min(pos, a.duration - 0.1); } catch (e) { /* ignore */ }
            var p = a.play();
            if (p && p.catch) p.catch(function () { S.blocked = true; });
        }
        if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
    }
    function stopTrack(name, fade) {
        var a = S.auds[name];
        if (!a) return;
        delete S.auds[name];
        if (!fade) { try { a.pause(); } catch (e) { /* ignore */ } return; }
        var v = a.volume, i = setInterval(function () { v -= 0.08; if (v <= 0) { clearInterval(i); try { a.pause(); } catch (e) { /* ignore */ } } else a.volume = v; }, 80);
    }
    function stopAllAudio() { stopTrack('loop'); stopTrack('panic'); stopTrack('scare'); stopTrack('crash'); stopTrack('purge'); }
    function synth(fn) {
        var c = ac();
        if (!c || !S.snd) return;
        try { if (c.state === 'suspended') c.resume(); fn(c, vol() / 0.9); } catch (e) { /* ignore */ }
    }
    function blip() {                                   // tiny static crackle on every glitch burst
        synth(function (c, v) {
            var len = Math.floor(c.sampleRate * 0.07), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
            for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
            var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
            src.buffer = buf; f.type = 'bandpass'; f.frequency.value = rand(600, 3200); g.gain.value = 0.12 * v;
            src.connect(f); f.connect(g); g.connect(c.destination); src.start();
        });
    }
    function stinger() {                                // low dive when the page gets hijacked
        synth(function (c, v) {
            var o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime;
            o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.9);
            g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22 * v, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1);
            o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 1.05);
        });
    }
    function screech() {                                // the jumpscare sound (built in, used when no scare audio was uploaded)
        synth(function (c, v) {
            var t0 = c.currentTime, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
            o.type = 'sawtooth'; o2.type = 'square';
            o.frequency.setValueAtTime(1900, t0); o.frequency.exponentialRampToValueAtTime(260, t0 + 1.3);
            o2.frequency.setValueAtTime(1300, t0); o2.frequency.exponentialRampToValueAtTime(190, t0 + 1.3);
            g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.32 * v, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
            o.connect(g); o2.connect(g); g.connect(c.destination); o.start(t0); o2.start(t0); o.stop(t0 + 1.55); o2.stop(t0 + 1.55);
            var len = Math.floor(c.sampleRate * 1.2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
            for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.4);
            var src = c.createBufferSource(), ng = c.createGain(); src.buffer = buf; ng.gain.value = 0.35 * v; src.connect(ng); ng.connect(c.destination); src.start(t0);
        });
    }
    function chime() {                                  // purge jingle (built in, used when no purge audio was uploaded)
        synth(function (c, v) {
            [523.25, 659.25, 783.99, 1046.5].forEach(function (f, k) {
                var o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + k * 0.13;
                o.type = 'sine'; o.frequency.value = f;
                g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18 * v, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
                o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.55);
            });
        });
    }
    // which OST should be playing right now? main OST, then (if uploaded) the panic OST for the last PANIC_S seconds.
    // Called every clock tick: it only starts what is missing, so it is cheap.
    function audioTick(left) {
        if (!S.snd || !S.ev || S.purged || S.phase !== 'run') return;
        var a = S.ev.audio || {};
        if (a.panic && left <= PANIC_S) {
            if (!S.auds.panic) { stopTrack('loop', true); track('panic', a.panic, true, PANIC_S - left); }
        } else if (a.loop && !S.auds.loop) {
            track('loop', a.loop, true, (nowMs() - Date.parse(S.ev.starts_at)) / 1000);
        }
    }
    function phaseAudio() {
        if (!S.snd || !S.ev) return;
        S.blocked = false;
        if (S.phase === 'run' && !S.purged) audioTick(Math.max(0, (Date.parse(S.ev.ends_at) - nowMs()) / 1000));
        paintSoundBtn();
    }
    function setSound(on) {
        S.snd = !!on;
        if (S.snd) { var c = ac(); if (c && c.state === 'suspended') c.resume(); phaseAudio(); }
        else stopAllAudio();
        paintSoundBtn();
    }
    function paintSoundBtn() {
        if (!S.root) return;
        var b = S.root.querySelector('[data-a="snd"]');
        if (b) b.textContent = S.snd ? '\uD83D\uDD0A' : '\uD83D\uDD07';
    }
    // browsers refuse to play sound until the visitor touches the page: on the first touch, wake up whatever was refused
    document.addEventListener('pointerdown', function () {
        if (!S.snd || !S.blocked) return;
        S.blocked = false;
        Object.keys(S.auds).forEach(function (k) {
            try { var p = S.auds[k].play(); if (p && p.catch) p.catch(function () { S.blocked = true; }); } catch (e) { /* ignore */ }
        });
        phaseAudio();
    }, true);

    /* ------------------------------ layout ------------------------------ */
    function mount() {
        if (S.root) return;
        ensureCss();
        var r = document.createElement('div'); r.id = 'gw-root';
        S.root = r; ROOT.appendChild(r);
        r.addEventListener('click', onClick);
        S.seen = true;
    }
    function rootClass() { if (S.root) S.root.className = S.calm ? 'gw-calm' : ''; }

    function barsHtml() {
        var o = '<div class="gw-bars">';
        for (var i = 0; i < 7; i++) o += '<i style="--y:' + rand(2, 96).toFixed(1) + '%;--h:' + rand(3, 16).toFixed(0) + 'px;--t:' + rand(2.2, 5.5).toFixed(2) + 's;--d:-' + rand(0, 5).toFixed(2) + 's;--dx:' + rand(14, 70).toFixed(0) + 'px"></i>';
        return o + '</div>';
    }

    function renderRun(elapsed) {
        mount(); rootClass();
        var intro = elapsed < INTRO_MS - 400 && !S.purged;
        var title = 'THE PAGE HAS BEEN HIJACKED BY GLITCHWARE';
        S.root.innerHTML =
            '<div class="gw-scan"></div><div class="gw-roll"></div><div class="gw-noise"></div>' + barsHtml() + '<div class="gw-vig"></div>' +
            '<div class="gw-wins" data-wins></div>' +
            '<div class="gw-hud" data-hud><div class="gw-top"><span class="gw-tag" data-tag>SPECSOFT EVENT \u00B7 GLITCHWARE</span><span class="gw-btns"><button type="button" class="gw-mini" data-a="snd" aria-label="Sound"></button><button type="button" class="gw-mini" data-a="min" aria-label="Shrink or grow this panel">\u2013</button></span></div>' +
            '<div class="gw-time" data-time>--:--</div><div class="gw-sub" data-sub>TIME UNTIL SYSTEM FAILURE</div>' +
            '<div class="gw-meter"><i data-prog></i></div>' +
            '<div class="gw-count" data-count><img src="' + CREDIT_ICON + '" alt="" width="18" height="18"><b data-pts>0</b><span>/ <span data-goal>0</span> APEX</span></div>' +
            '<div class="gw-scanner" data-scan><span data-scantext>SCANNING...</span><div class="gw-sig"><i data-sig></i></div></div>' +
            '<div class="gw-reward" data-reward></div></div>' +
            '<div class="gw-ann" data-ann role="status" aria-live="assertive"></div>' +
            '<div class="gw-warn" data-warn>\u26A0 Event effects: glitching, fake error windows and a jump scare. Nothing on your device is affected. <button type="button" data-a="calm">Reduce effects</button><button type="button" data-a="warnx" aria-label="Dismiss">\u00D7</button></div>' +
            (intro ? '<div class="gw-intro" data-intro><div class="gw-intro-t" data-text="' + title + '">' + title + '</div><div class="gw-intro-s"><b>glitchware.exe</b> injected \u00B7 find the hidden APEX credits before the timer ends</div></div>' : '');
        var ev = S.ev, rw = [], rEl = S.root.querySelector('[data-reward]');
        if (ev.reward_xp > 0) rw.push('+' + ev.reward_xp + ' XP');
        if (ev.reward_ac > 0) rw.push('+' + ev.reward_ac + ' APEX Credits');
        rEl.textContent = S.preview ? 'PREVIEW \u00B7 nobody else sees this \u00B7 no rewards' : (rw.length ? 'PURGE IT TO EARN ' + rw.join(' \u00B7 ') : 'COLLECT ' + ev.goal + ' POINTS OF HIDDEN CREDITS TO PURGE IT');
        if (!S.preview) loadUser().then(function (u) { if (!u && rEl && S.root) rEl.textContent = 'PRACTICE MODE \u00B7 log in to be counted and earn rewards'; });
        S.root.querySelector('[data-goal]').textContent = String(ev.goal);
        var wn = S.root.querySelector('[data-warn]'); if (wn && ssGet('gw.warnx') === '1') wn.hidden = true;
        if (small()) S.root.querySelector('[data-hud]').classList.add('is-min');
        if (intro) {
            var it = S.root.querySelector('[data-intro]'); it.style.animationDelay = '-' + (elapsed / 1000).toFixed(2) + 's';
            var vu = villainUrl();
            if (vu) {      // the villain stares at you from the middle of the takeover
                var vi = new Image(); vi.className = 'gw-intro-v'; vi.alt = ''; vi.draggable = false;
                vi.onerror = function () { if (vi.parentNode) vi.parentNode.removeChild(vi); };
                vi.src = vu; it.insertBefore(vi, it.firstChild);
            }
            setTimeout(function () { if (it.parentNode) it.parentNode.removeChild(it); }, Math.max(0, INTRO_MS - elapsed) + 100);
            if (S.snd && elapsed < 600) stinger();
        }
        paintSoundBtn(); paintHud();
    }

    function paintHud() {
        if (!S.root || !S.ev) return;
        var g = S.ev.goal, v = Math.min(S.pts, g);
        var pt = S.root.querySelector('[data-pts]'); if (pt) pt.textContent = String(v);
        var pg = S.root.querySelector('[data-prog]'); if (pg) pg.style.width = (v / g * 100).toFixed(1) + '%';
    }
    function bumpHud() {
        var c = S.root && S.root.querySelector('[data-count]');
        if (c) { c.classList.remove('is-bump'); void c.offsetWidth; c.classList.add('is-bump'); }
    }
    function paintPurgedHud() {
        if (!S.root) return;
        var hud = S.root.querySelector('[data-hud]'); if (!hud) return;
        hud.classList.add('is-done'); hud.classList.remove('is-min');
        var tg = S.root.querySelector('[data-tag]'); if (tg) tg.textContent = 'GLITCHWARE PURGED';
        var sb = S.root.querySelector('[data-sub]'); if (sb) sb.textContent = 'EVENT ENDS IN';
        var rw = S.root.querySelector('[data-reward]'); if (rw) rw.textContent = S.rewardText || 'YOU SAVED YOUR PAGE';
        var wn = S.root.querySelector('[data-warn]'); if (wn) wn.hidden = true;
        paintHud();
    }

    /* ------------------------------ announcements + clock ------------------------------ */
    function announce(text) {
        if (!S.root) return;
        var a = S.root.querySelector('[data-ann]');
        if (a) { a.textContent = text; a.classList.add('is-on'); clearTimeout(S.annT); S.annT = setTimeout(function () { a.classList.remove('is-on'); }, 3400); }
        if (S.snd) blip();
    }
    function paintRun(t, s, e) {
        if (!S.root) return;
        var left = Math.ceil((e - t) / 1000);
        S.prog = clamp((t - s) / Math.max(1, e - s), 0, 1);
        var tm = S.root.querySelector('[data-time]'); if (tm) tm.textContent = mmss(left);
        S.root.style.setProperty('--gw-p', S.prog.toFixed(3));
        S.root.classList.toggle('gw-t60', left <= 60 && left > 15);
        S.root.classList.toggle('gw-low', left <= 15);
        if (S.purged) return;
        audioTick(left);
        if (S.cbox) S.cbox.className = S.prog >= 0.7 ? 'gw-h2' : (S.prog >= 0.4 ? 'gw-h1' : '');
        if (!S.ann40 && S.prog >= 0.4) { S.ann40 = true; announce('SIGNAL LEAK \u00B7 CREDITS ARE SHIMMERING'); }
        if (!S.ann60 && S.ev.duration_s > 75 && left <= 60) { S.ann60 = true; announce('T-MINUS 1 MINUTE'); }
        if (!S.ann15 && left <= 15) { S.ann15 = true; announce('SYSTEM FAILURE IN 15 SECONDS'); }
        scanTick();
    }

    /* ------------------------------ glitch bursts (tearing, scrambling, channel split) ------------------------------ */
    var SKIP = '#gw-root,#gw-credits,#gw-report,#gw-inc,.gw-toast,#nk-root,#nk-dark,#nk-rust,#nk-inc,#nk-report,.nk-toast,.ss-toggle,#ss-back,#ss-front,[id*="cursor"],[class*="cursor"],canvas,video,iframe,script,style,link,dialog,[data-nuke-keep],[data-glitch-keep]';
    var PICK = 'h1,h2,h3,h4,p,li,img,svg,button,figure,table,form,nav,aside,section>div,[class*="card"],[class*="panel"],[class*="tile"],[class*="btn"],[class*="item"],[class*="banner"]';
    var TXT = 'h1,h2,h3,h4,h5,p,li,a,button,span,label,td,th,small,strong';
    var GL = '\u2588\u2593\u2592\u2591#@%&?!<>/\\|01';

    function candidates() {
        var now = Date.now();
        if (S.cand && now - S.candAt < 2000) return S.cand;
        var out = { tear: [], txt: [] }, vw = innerWidth, vh = innerHeight, i, el, r, nodes;
        try { nodes = document.body.querySelectorAll(PICK); } catch (e) { nodes = []; }
        for (i = 0; i < nodes.length && out.tear.length < 160; i++) {
            el = nodes[i];
            if (el.closest(SKIP)) continue;
            r = el.getBoundingClientRect();
            if (r.width < 18 || r.height < 14 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw || r.width * r.height > vw * vh * 0.4) continue;
            out.tear.push(el);
        }
        try { nodes = document.body.querySelectorAll(TXT); } catch (e) { nodes = []; }
        for (i = 0; i < nodes.length && out.txt.length < 160; i++) {
            el = nodes[i];
            if (el.children.length || el.closest(SKIP)) continue;
            var tx = el.textContent || '';
            if (tx.replace(/\s/g, '').length < 3 || tx.length > 90) continue;
            r = el.getBoundingClientRect();
            if (r.width < 10 || r.height < 8 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
            out.txt.push(el);
        }
        S.cand = out; S.candAt = now;
        return out;
    }
    function pickSome(list, n) {
        var a = list.slice(), out = [];
        while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
        return out;
    }
    function scale() { return small() ? 0.6 : 1; }
    function tearSome() {
        var c = candidates(), L = lv(), n = Math.ceil(L.tears * scale());
        pickSome(c.tear, n).forEach(function (el) {
            var a = rand(0, 55), b = rand(0, 55);
            el.style.setProperty('--tx', rand(-46, 46).toFixed(0) + 'px');
            el.style.setProperty('--ty', rand(-6, 6).toFixed(0) + 'px');
            el.style.setProperty('--sk', rand(-9, 9).toFixed(1) + 'deg');
            el.style.setProperty('--cp', 'inset(' + a.toFixed(0) + '% 0 ' + b.toFixed(0) + '% 0)');
            el.classList.add('gw-tear'); S.tears.push(el);
        });
    }
    function untear() {
        S.tears.forEach(function (el) {
            el.classList.remove('gw-tear');
            ['--tx', '--ty', '--sk', '--cp'].forEach(function (p) { el.style.removeProperty(p); });
        });
        S.tears = [];
    }
    function scrambleText(t) {
        var o = '';
        for (var i = 0; i < t.length; i++) o += (/\s/.test(t[i]) || Math.random() > 0.38) ? t[i] : GL.charAt(Math.floor(Math.random() * GL.length));
        return o;
    }
    function scrambleSome() {
        var c = candidates(), L = lv(), n = Math.ceil(L.scr * scale());
        pickSome(c.txt, n).forEach(function (el) {
            var orig = el.textContent, now = scrambleText(orig);
            if (now === orig) return;
            el.textContent = now; S.scr.push({ el: el, orig: orig, now: now });
        });
    }
    function unscramble() {
        S.scr.forEach(function (x) { if (x.el.isConnected && x.el.textContent === x.now) x.el.textContent = x.orig; });
        S.scr = [];
    }
    // the villain pokes its head in from a random screen edge for a split second
    function peek() {
        var u = villainUrl();
        if (!u || S.calm || S.purged || !S.root) return;
        var im = new Image();
        im.className = 'gw-peek p' + Math.floor(Math.random() * 4); im.alt = ''; im.draggable = false;
        im.style.setProperty('--o', rand(12, 80).toFixed(0) + '%');
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); };
        im.src = u; S.root.appendChild(im);
        setTimeout(function () { if (im.parentNode) im.parentNode.removeChild(im); }, 760);
    }
    function doBurst(ms) {
        if (S.calm || S.purged) return;
        ROOT.classList.add('gw-burst');
        if (S.ev && S.ev.intensity !== 'low') ROOT.classList.add('gw-shake');
        tearSome(); scrambleSome();
        if (S.snd) blip();
        if (S.prog > 0.25 && Math.random() < 0.18) peek();
        clearTimeout(S.endBurstT);
        S.endBurstT = setTimeout(endBurst, ms);
    }
    function endBurst() { clearTimeout(S.endBurstT); ROOT.classList.remove('gw-burst', 'gw-shake'); untear(); unscramble(); }
    function scheduleBurst() {
        clearTimeout(S.burstT);
        if (S.calm || S.purged || S.phase !== 'run') return;
        var L = lv(), k = 1 - 0.45 * S.prog;
        S.burstT = setTimeout(function () { doBurst(rand(140, 380)); scheduleBurst(); }, rand(L.burst[0], L.burst[1]) * k);
    }

    /* ------------------------------ fake windows ------------------------------ */
    // vil: true = the villain's face is shown in the window (when a villain image was uploaded)
    var DEFS = [
        { t: 'ERROR 0xGL17CH', i: '\u2716', m: 'cursor.dll has been encrypted by glitchware.', b: ['OK', 'Cancel'], hydra: true },
        { t: 'glitchware.exe', i: '!', m: 'glitchware.exe has stopped responding.', b: ['Close program', 'Wait'], hydra: true },
        { t: 'System32', i: '\u26A0', m: 'Deleting System32...', bar: 'back', b: ['Stop'], hydra: true },
        { t: 'TICK TOCK', i: '\u23F1', m: 'TICK TOCK, {name}.\n{time} left.', b: ['No'], hydra: false },
        { t: 'Installer', i: '\u2B07', m: 'Installing 4,812 toolbars...', bar: 'fwd', b: ['Cancel'], hydra: true },
        { t: 'WARNING', i: '\u26A0', m: 'Your RAM has been downloaded.', b: ['Upload it back'], hydra: false },
        { t: 'glitchware_update', i: '\u21BB', m: 'Updating glitchware... 99%\n(restarting)', bar: 'stuck', b: ['Hurry up'], hydra: false },
        { t: 'FATAL', i: '\u2716', m: 'Task failed successfully.', b: ['OK'], hydra: true },
        { t: 'Antivirus', i: '\u26E8', m: 'antivirus.exe was deleted.\nReason: glitchware.', b: ['Why'], hydra: false },
        { t: 'mouse.sys', i: '?', m: 'Mouse not found. Please move the mouse to continue.', b: ['Moved it'], hydra: true },
        { t: 'ERROR 404', i: '?', m: 'Page not found.\nYou are on the page.', b: ['Oh'], hydra: false },
        { t: 'glitchware', i: '\u263A', m: 'hi :)', b: ['hi?', 'go away'], hydra: true, vil: true },
        { t: 'glitchware', i: '\u263A', m: 'i see you, {name}.', b: ['no', 'who?'], hydra: false, vil: true },
        { t: 'glitchware', i: '\u263A', m: 'did you really think\nyou could purge me?', b: ['yes'], hydra: true, vil: true }
    ];
    function winCap() { var c = Math.ceil(lv().cap * scale()); return S.calm ? Math.min(4, c) : c; }

    function leakText() {
        var live = liveItems();
        if (!live.length) return 'SIGNAL LEAK:\nthis page is clean. Try another page.';
        var best = null, bd = 1e9, r, dx, dy, d;
        live.forEach(function (it) { r = it.el.getBoundingClientRect(); dx = r.left + r.width / 2 - innerWidth / 2; dy = r.top + r.height / 2 - innerHeight / 2; d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = { dx: dx, dy: dy }; } });
        var v = best.dy < -innerHeight * 0.18 ? 'TOP' : (best.dy > innerHeight * 0.18 ? 'BOTTOM' : 'MIDDLE');
        var hz = best.dx < -innerWidth * 0.18 ? 'LEFT' : (best.dx > innerWidth * 0.18 ? 'RIGHT' : 'CENTER');
        return 'SIGNAL LEAK:\ncredit detected near the ' + (v === 'MIDDLE' && hz === 'CENTER' ? 'CENTER' : (v === 'MIDDLE' ? hz : (hz === 'CENTER' ? v : v + '-' + hz))) + ' of this page.';
    }
    function bringFront(w) { S.zTop += 1; w.style.zIndex = String(S.zTop); }

    function spawnWin(force, defIn) {
        if (!S.root) return null;
        var box = S.root.querySelector('[data-wins]');
        if (!box) return null;
        var def = defIn;
        if (!def) {
            if (S.prog > 0.35 && !S.calm && Math.random() < 0.2) def = { t: 'SCANNER LEAK', i: '\u25CE', leak: true, m: '', b: ['Thanks'], hydra: false };
            else def = DEFS[Math.floor(Math.random() * DEFS.length)];
        }
        var w = h('div', 'gw-win' + (def.leak ? ' leak' : ''));
        var bar = h('div', 'gw-win-bar');
        bar.appendChild(h('span', 'gw-win-t', def.t));
        var x = h('button', 'gw-win-x', '\u00D7'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
        bar.appendChild(x);
        var body = h('div', 'gw-win-body');
        var ico = h('div', 'gw-win-ico', def.i), vu = villainUrl();
        if (def.vil && vu) {
            ico.className = 'gw-win-ico vil'; ico.textContent = '';
            var vi = new Image(); vi.alt = ''; vi.draggable = false;
            vi.onerror = function () { ico.className = 'gw-win-ico'; ico.textContent = def.i; };
            vi.src = vu; ico.appendChild(vi);
        }
        body.appendChild(ico);
        var msg = def.leak ? leakText() : def.m.replace('{name}', (S.name || 'USER').toUpperCase()).replace('{time}', mmss((Date.parse(S.ev.ends_at) - nowMs()) / 1000));
        body.appendChild(h('div', 'gw-win-msg', msg));
        w.appendChild(bar); w.appendChild(body);
        if (def.bar) { var pg = h('div', 'gw-win-prog ' + def.bar); pg.appendChild(document.createElement('i')); w.appendChild(pg); }
        var bt = h('div', 'gw-win-btns');
        def.b.forEach(function (label) { var b = h('button', '', label); b.type = 'button'; b.addEventListener('click', function () { closeWin(w, def, true); }); bt.appendChild(b); });
        w.appendChild(bt);
        x.addEventListener('click', function () { closeWin(w, def, true); });
        var vw = innerWidth, vh = innerHeight, ww = small() ? Math.min(vw * 0.78, 250) : rand(240, 300);
        w.style.setProperty('--w', ww.toFixed(0) + 'px');
        w.style.left = rand(8, Math.max(9, vw - ww - 8)).toFixed(0) + 'px';
        w.style.top = rand(small() ? 150 : 120, Math.max(151, vh - 200)).toFixed(0) + 'px';
        bringFront(w);
        // drag by the title bar
        bar.addEventListener('pointerdown', function (e) {
            if (e.target.closest && e.target.closest('button')) return;
            bringFront(w);
            var r = w.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
            try { bar.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
            function mv(ev) { w.style.left = clamp(ev.clientX - dx, -60, innerWidth - 60) + 'px'; w.style.top = clamp(ev.clientY - dy, 0, innerHeight - 30) + 'px'; }
            function up() { bar.removeEventListener('pointermove', mv); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); }
            bar.addEventListener('pointermove', mv); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
            e.preventDefault();
        });
        w.addEventListener('pointerdown', function () { bringFront(w); });
        box.appendChild(w); S.wins.push(w);
        return w;
    }
    function closeWin(w, def, byUser) {
        var k = S.wins.indexOf(w); if (k < 0) return;
        S.wins.splice(k, 1);
        w.classList.add('is-out');
        setTimeout(function () { if (w.parentNode) w.parentNode.removeChild(w); }, 180);
        // hydra windows: close one, two more appear (never past the cap)
        if (byUser && def && def.hydra && !S.calm && !S.purged && S.phase === 'run' && S.wins.length < winCap() && Math.random() < 0.65) {
            setTimeout(function () { if (S.wins.length < winCap()) spawnWin(); }, 150);
            setTimeout(function () { if (S.wins.length < winCap()) spawnWin(); }, 320);
        }
    }
    function clearWins(cascade) {
        var list = S.wins.slice();
        list.forEach(function (w, k) { setTimeout(function () { closeWin(w, null, false); }, cascade ? 60 * k : 0); });
    }
    function scheduleWin() {
        clearTimeout(S.winT);
        if (S.purged || S.phase !== 'run') return;
        var L = lv(), k = 1 - 0.5 * S.prog, base = L.win * k * (S.calm ? 3 : 1);
        S.winT = setTimeout(function () { if (S.wins.length < winCap()) spawnWin(); scheduleWin(); }, base * rand(0.7, 1.3));
    }

    /* ------------------------------ hidden credits ------------------------------ */
    function sizeCredits() {
        if (!S.cbox) return;
        S.cbox.style.height = '0px';
        var hgt = Math.max(ROOT.scrollHeight, document.body ? document.body.scrollHeight : 0, innerHeight);
        S.cbox.style.height = hgt + 'px';
    }
    function removeCredits() {
        if (S.cbox && S.cbox.parentNode) S.cbox.parentNode.removeChild(S.cbox);
        S.cbox = null; S.items = [];
    }
    function liveItems() { return S.items.filter(function (it) { return !S.got[PAGE + ':' + it.i]; }); }
    function buildCredits() {
        removeCredits();
        if (!onHuntPage()) return;          // not a hunt page: nothing hidden here
        ensureCss();
        var box = document.createElement('div'); box.id = 'gw-credits';
        ROOT.appendChild(box); S.cbox = box;
        var rnd = mulberry(hashStr(S.ev.seed + ':' + PAGE));
        for (var i = 0; i < S.ev.density; i++) {
            var x = 3 + rnd() * 94, y = 2 + rnd() * 95, v = valueOf(i), dl = rnd() * 3;
            var b = h('button', 'gw-cr v' + v); b.type = 'button';
            b.setAttribute('data-i', String(i)); b.setAttribute('aria-label', 'Hidden APEX Credit, ' + v + ' points');
            b.style.left = x.toFixed(2) + '%'; b.style.top = y.toFixed(2) + '%'; b.style.setProperty('--d', '-' + dl.toFixed(2) + 's');
            var img = new Image(); img.src = CREDIT_ICON; img.alt = ''; img.draggable = false;
            img.onerror = function () { if (this.parentNode) this.parentNode.classList.add('noimg'); this.style.display = 'none'; };
            b.appendChild(img);
            if (S.got[PAGE + ':' + i]) b.classList.add('is-gone');
            box.appendChild(b); S.items.push({ i: i, el: b, val: v });
        }
        box.addEventListener('pointerdown', function (e) { var b2 = e.target.closest && e.target.closest('.gw-cr'); if (b2) { e.preventDefault(); collect(b2); } });
        box.addEventListener('click', function (e) { if (e.detail !== 0) return; var b2 = e.target.closest && e.target.closest('.gw-cr'); if (b2) collect(b2); });   // keyboard
        sizeCredits();
    }
    function applyGot() {
        S.items.forEach(function (it) { if (S.got[PAGE + ':' + it.i]) it.el.classList.add('is-gone'); });
    }
    function popText(b, txt) {
        if (!S.cbox) return;
        var p = h('div', 'gw-pop', txt); p.style.left = b.style.left; p.style.top = b.style.top;
        S.cbox.appendChild(p); setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 950);
    }
    function collect(b) {
        var i = +b.getAttribute('data-i'), key = PAGE + ':' + i;
        if (S.purged || S.got[key] || S.phase !== 'run' || !S.ev) return;
        var val = valueOf(i);
        S.got[key] = 1; b.classList.add('is-got');
        setTimeout(function () { b.classList.add('is-gone'); b.classList.remove('is-got'); }, 380);
        popText(b, '+' + val);
        S.pts += val; paintHud(); bumpHud(); saveState();
        if (S.snd) blip();
        if (S.preview) { if (S.pts >= S.ev.goal) doPurge(null); return; }
        if (S.user) { send(i, key, val, 0, b); return; }
        // FIX: the session may still be loading. Ask first, and only call it practice mode when really signed out
        S.pending++;
        loadUser().then(function (u) {
            S.pending = Math.max(0, S.pending - 1);
            if (u) send(i, key, val, 0, b);
            else if (S.pts >= S.ev.goal && !S.purged) doPurge(null);
        }, function () {
            S.pending = Math.max(0, S.pending - 1);
            if (S.pts >= S.ev.goal && !S.purged) doPurge(null);
        });
    }
    function send(i, key, val, n, b) {
        S.pending++;
        var done = false;
        function fin() { if (!done) { done = true; S.pending = Math.max(0, S.pending - 1); } }
        rpc('glitch_collect', { p_event: S.ev.id, p_page: PAGE, p_idx: i }).then(function (d) {
            fin();
            if (!d) return;
            if (typeof d.points === 'number') { S.pts = d.points; paintHud(); saveState(); }
            S.verifying = false;
            if (d.purged && !S.purged) doPurge(d);
        }).catch(function (err) {
            var m = String((err && err.message) || '');
            if (/too_fast/.test(m) && n < 3) { setTimeout(function () { fin(); send(i, key, val, n + 1, b); }, 330); return; }
            if (/too_fast/.test(m)) {
                // FIX: the server wants a real person to take a little time before the WINNING pickup counts.
                // Do not throw the credit away: keep trying every 2 s until the server accepts it (or the event is over).
                var closing = S.ev && Date.parse(S.ev.ends_at) + 1800 < nowMs();
                if (S.ev && S.pts >= S.ev.goal && !S.purged && !closing) {
                    if (!S.verifying) {
                        S.verifying = true;
                        var rw = S.root && S.root.querySelector('[data-reward]');
                        if (rw) rw.textContent = 'VERIFYING YOUR PURGE WITH THE SERVER...';
                    }
                    setTimeout(function () { fin(); if (!S.purged && S.ev) send(i, key, val, 3, b); }, 2000);
                    return;
                }
                fin();
                delete S.got[key]; S.pts = Math.max(0, S.pts - val); paintHud(); saveState();
                if (b) { b.classList.remove('is-gone', 'is-got'); }
                toast('Easy. The server says that was too fast. Try that one again.');
                return;
            }
            fin();
            if (/not_signed_in/.test(m)) { S.user = null; }
        });
    }

    /* the scanner: tells you how close the nearest hidden credit is to your pointer / finger */
    document.addEventListener('pointermove', function (e) { S.cx = e.clientX; S.cy = e.clientY; }, { passive: true });
    var ARROWS = ['\u2192', '\u2198', '\u2193', '\u2199', '\u2190', '\u2196', '\u2191', '\u2197'];
    function scanTick() {
        if (!S.root || S.purged) return;
        var txt = S.root.querySelector('[data-scantext]'), sig = S.root.querySelector('[data-sig]');
        if (!txt || !sig) return;
        var live = liveItems();
        if (!live.length) { txt.textContent = onHuntPage() ? 'PAGE CLEAN \u00B7 TRY ANOTHER PAGE' : 'NO SIGNAL HERE \u00B7 TRY ANOTHER PAGE'; sig.style.width = '0%'; return; }
        var bd = 1e9, bx = 0, by = 0;
        live.forEach(function (it) {
            var r = it.el.getBoundingClientRect(), dx = r.left + r.width / 2 - S.cx, dy = r.top + r.height / 2 - S.cy, d = Math.hypot(dx, dy);
            if (d < bd) { bd = d; bx = dx; by = dy; }
        });
        var pct = clamp(1 - Math.pow(bd / 900, 0.6), 0, 1);
        var label = bd < 70 ? 'HOT' : (bd < 200 ? 'WARM' : (bd < 450 ? 'COOL' : 'COLD'));
        var arrow = bd >= 70 ? ' ' + ARROWS[Math.round(((Math.atan2(by, bx) * 180 / Math.PI) + 360) % 360 / 45) % 8] : '';
        txt.textContent = 'SIGNAL ' + Math.round(pct * 100) + '% \u00B7 ' + label + arrow;
        sig.style.width = (pct * 100).toFixed(0) + '%';
    }

    /* ------------------------------ clicks ------------------------------ */
    function onClick(e) {
        var a = e.target.closest && e.target.closest('[data-a]');
        if (!a) return;
        var k = a.getAttribute('data-a');
        if (k === 'snd') setSound(!S.snd);
        else if (k === 'min') { var hd = S.root.querySelector('[data-hud]'); if (hd) hd.classList.toggle('is-min'); }
        else if (k === 'calm') {
            S.calm = true; lsSet(CALM_KEY, '1');
            if (S.root) S.root.classList.add('gw-calm');
            ROOT.classList.add('gw-calm-page');
            clearTimeout(S.burstT); endBurst();
            while (S.wins.length > 4) closeWin(S.wins[0], null, false);
            var w = S.root.querySelector('[data-warn]'); if (w) w.hidden = true; ssSet('gw.warnx', '1');
        }
        else if (k === 'warnx') { var w2 = S.root.querySelector('[data-warn]'); if (w2) w2.hidden = true; ssSet('gw.warnx', '1'); }
    }

    /* ------------------------------ WIN: purged ------------------------------ */
    function doPurge(d) {
        if (S.purged || !S.ev) return;
        S.purged = true;
        if (S.outroOn) cancelOutro();      // FIX: the server's answer can land AFTER the timer hit 0:00
        var parts = [];
        if (d && d.reward_xp > 0) parts.push('+' + d.reward_xp + ' XP');
        if (d && d.reward_ac > 0) parts.push('+' + d.reward_ac + ' APEX Credits');
        S.rewardText = d ? (parts.length ? 'REWARDS: ' + parts.join(' \u00B7 ') : 'YOU WILL BE LISTED AS PURGED') : (S.preview ? 'PREVIEW COMPLETE' : 'PRACTICE: LOG IN NEXT TIME TO EARN REWARDS');
        saveState();
        if (d) {
            try { if (window.ApexCredits) { if (d.balance != null && window.ApexCredits.set) window.ApexCredits.set(d.balance); else window.ApexCredits.refresh(); } } catch (e) { /* ignore */ }
            try { if (window.SpecXP) { if (d.xp && window.SpecXP.set) window.SpecXP.set(d.xp); else window.SpecXP.refresh(); } } catch (e) { /* ignore */ }
        }
        clearTimeout(S.burstT); clearTimeout(S.winT); endBurst(); stopTrack('loop', true); stopTrack('panic', true);
        removeCredits();
        if (!S.root) { return; }
        S.root.classList.add('gw-purging');
        clearWins(true);
        var o = h('div', 'gw-purge');
        o.appendChild(h('div', 'gw-purge-line'));
        o.appendChild(h('h2', '', 'GLITCHWARE PURGED'));
        o.appendChild(h('p', '', S.rewardText));
        S.root.appendChild(o);
        setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 3700);
        setTimeout(function () { if (!S.root) return; ['.gw-scan', '.gw-roll', '.gw-noise', '.gw-vig', '.gw-bars', '.gw-peek'].forEach(function (q) { S.root.querySelectorAll(q).forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); }); }, 1500);
        paintPurgedHud();
        if (S.snd) { var a = S.ev.audio || {}; if (a.purge) track('purge', a.purge, false, 0); else chime(); }
    }
    // already purged (earlier page, or the server says so): no show, just a calm panel
    function silentPurge() {
        S.purged = true; saveState();
        clearTimeout(S.burstT); clearTimeout(S.winT); endBurst(); stopTrack('loop'); stopTrack('panic');
        removeCredits(); clearWins(false);
        if (S.root) { ['.gw-scan', '.gw-roll', '.gw-noise', '.gw-vig', '.gw-bars', '[data-intro]'].forEach(function (q) { var n = S.root.querySelector(q); if (n && n.parentNode) n.parentNode.removeChild(n); }); paintPurgedHud(); }
    }

    /* ------------------------------ LOSS: pile-up, jumpscare, crash ------------------------------ */
    // undo a loss sequence that is already running (used when a late purge answer arrives)
    function cancelOutro() {
        S.outT.forEach(clearTimeout); S.outT = []; clearInterval(S.pileI);
        S.outroOn = false;
        stopTrack('scare'); stopTrack('crash');
        endBurst();
        if (S.root) ['.gw-cut', '.gw-scare', '.gw-crash'].forEach(function (q) { var n = S.root.querySelector(q); if (n && n.parentNode) n.parentNode.removeChild(n); });
    }
    function startLoss() {
        if (S.purged || S.phase !== 'outro' || !S.ev) return;
        runOutro(Math.max(0, nowMs() - Date.parse(S.ev.ends_at)));
    }
    // FIX: before ANYONE gets the jumpscare, make sure the server does not already count them as PURGED
    // (a pickup still on its way, a purge earned in another tab, or a page opened after 0:00)
    function gateOutro() {
        if (S.preview) { startLoss(); return; }
        var t0 = Date.now(), fin = false;
        function go() { if (fin) return; fin = true; startLoss(); }
        setTimeout(go, 2600);                       // never keep anyone waiting longer than this
        (function waitPending() {
            if (S.purged || fin) return;
            if (S.pending > 0 && Date.now() - t0 < 2600) { setTimeout(waitPending, 120); return; }
            loadUser().then(function (u) {
                if (S.purged || fin) return;
                if (!u) { go(); return; }
                Promise.resolve(rpc('glitch_join', { p_event: S.ev.id })).then(function (d) {
                    if (S.purged || fin) return;
                    if (d && d.ok !== false && d.purged) { fin = true; silentPurge(); } else go();
                }).catch(go);
            }).catch(go);
        })();
    }
    function runOutro(el) {
        if (S.outroOn || !S.ev || S.purged) return;
        S.outroOn = true;
        clearTimeout(S.burstT); clearTimeout(S.winT); stopTrack('loop', true); stopTrack('panic', true);
        removeCredits();
        mount(); rootClass();
        var scare = !!S.ev.jumpscare && !S.calm;
        function stage(ms, fn) { S.outT.push(setTimeout(fn, Math.max(0, ms - el))); }
        if (scare && el < T_CRASH - 200) {
            if (el < T_CUT) {
                var n = 0;
                S.pileI = setInterval(function () { if (n++ < 20) spawnWin(true); doBurst(110); }, 110);
                stage(T_CUT, function () { clearInterval(S.pileI); endBurst(); addTop(h('div', 'gw-cut')); });
            }
            stage(T_SCARE, showScare);
            stage(T_CRASH, showCrash);
        } else {
            stage(scare ? T_CRASH : 500, showCrash);
        }
    }
    function addTop(n) { if (S.root) S.root.appendChild(n); return n; }
    function showScare() {
        if (!S.root) return;
        clearInterval(S.pileI); endBurst();
        var c = S.root.querySelector('.gw-cut'); if (c && c.parentNode) c.parentNode.removeChild(c);
        var vu = villainUrl();
        var sc = h('div', 'gw-scare' + (vu ? ' is-vil' : '')), inn = h('div', 'gw-scare-in');
        var img = new Image(), img2 = new Image(), triedLogo = !vu;
        img.alt = ''; img2.alt = ''; img2.className = 'b';
        function fail() { if (inn.contains(img)) inn.removeChild(img); if (inn.contains(img2)) inn.removeChild(img2); if (!inn.querySelector('.gw-scare-txt')) inn.appendChild(h('div', 'gw-scare-txt', 'SPECSOFT\u00AE')); }
        // the villain picture failed to load: fall back to the logo, and if that fails too, to plain text
        img.onerror = function () {
            if (!triedLogo) { triedLogo = true; sc.classList.remove('is-vil'); img.src = 'logo.png'; if (img2.parentNode) img2.src = 'logo.png'; }
            else fail();
        };
        img2.onerror = function () { if (img2.parentNode) img2.parentNode.removeChild(img2); };
        img.src = vu || 'logo.png'; img2.src = vu || 'logo.png';
        inn.appendChild(img); inn.appendChild(img2);
        sc.appendChild(inn); sc.appendChild(h('div', 'gw-scare-bars'));
        S.root.appendChild(sc);
        if (S.snd) { var a = S.ev.audio || {}; if (a.scare) track('scare', a.scare, false, 0); else screech(); }
    }
    function showCrash() {
        if (!S.root) return;
        clearInterval(S.pileI); endBurst(); clearWins(false);
        ['.gw-cut', '.gw-scare', '.gw-scan', '.gw-roll', '.gw-noise', '.gw-vig', '.gw-bars', '[data-hud]', '[data-warn]', '[data-intro]', '[data-wins]'].forEach(function (q) { var n = S.root.querySelector(q); if (n && n.parentNode) n.parentNode.removeChild(n); });
        S.root.querySelectorAll('.gw-peek').forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        var c = h('div', 'gw-crash');
        c.appendChild(h('h2', '', ':('));
        c.appendChild(h('h3', '', 'SPECSOFT\u00AE \u00B7 GLITCHWARE WON \u00B7 ERROR 0xGL17CH'));
        c.appendChild(h('p', '', 'The timer ran out and your page was infected. This was only an event: nothing on your device was changed.'));
        var pg = h('div', 'gw-win-prog fwd'); pg.appendChild(document.createElement('i')); c.appendChild(pg);
        c.appendChild(h('p', '', 'REBOOTING THE SITE...'));
        S.root.appendChild(c);
        if (S.snd) { var a = S.ev.audio || {}; if (a.crash) track('crash', a.crash, true, 0); }
    }

    /* ------------------------------ ending screen ------------------------------ */
    function showReport() {
        var ev = S.ev;
        if (!ev || S.reportShown) return;
        S.reportShown = true;
        ensureCss();
        var wrap = h('div'); wrap.id = 'gw-report'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Event report');
        var card = h('div', 'gw-rep');
        var img = new Image(), vu = ev.villain || '', triedLogo = !vu; img.alt = '';
        img.onerror = function () { if (!triedLogo) { triedLogo = true; img.src = 'logo.png'; } else img.style.display = 'none'; };
        img.src = vu || 'logo.png';
        var hh = h('h2', '', 'SPECSOFT\u00AE EVENT REPORT');
        var sub = h('p', 'gw-rep-sub', (ev.label || 'GLITCHWARE').toUpperCase());
        var dl = h('dl');
        function row(k, v) { dl.appendChild(h('dt', '', k)); dl.appendChild(h('dd', '', v)); }
        row('HIJACKED', fmtDT(Date.parse(ev.starts_at)));
        row('ENDED', fmtDT(Date.parse(ev.ends_at)));
        var count = h('div', 'gw-rep-count'), list = h('div', 'gw-rep-list');
        list.appendChild(h('div', 'gw-rep-empty', 'Loading the infection log...'));
        var btn = h('button', 'gw-btn', 'CONTINUE'); btn.type = 'button';
        btn.addEventListener('click', function () {
            lsSet('gw.done.' + ev.id, '1');
            wrap.classList.remove('is-on');
            setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); S.rep = null; }, 700);
        });
        [img, hh, sub, dl, count, list, btn].forEach(function (n) { card.appendChild(n); });
        wrap.appendChild(card); ROOT.appendChild(wrap); S.rep = wrap;
        requestAnimationFrame(function () { wrap.classList.add('is-on'); });
        setTimeout(function () { try { btn.focus(); } catch (e) { /* ignore */ } }, 800);

        function fill(d) {
            list.innerHTML = '';
            if (!d || d.ok === false) { list.appendChild(h('div', 'gw-rep-empty', 'The infection log is not available right now.')); return; }
            count.innerHTML = '';
            function cd(cls, num, label) { var c = h('div', 'gw-rep-card ' + cls); c.appendChild(h('b', '', String(num))); c.appendChild(h('span', '', label)); return c; }
            count.appendChild(cd('a', d.purged, 'PURGED')); count.appendChild(cd('m', d.infected, 'INFECTED'));
            if (!d.players || !d.players.length) { list.appendChild(h('div', 'gw-rep-empty', 'Nobody signed in was here for this one.')); return; }
            d.players.forEach(function (p) {
                var r = h('div', 'gw-rep-row ' + (p.purged ? 'is-purged' : 'is-infected') + (p.me ? ' is-me' : ''));
                r.appendChild(h('span', 'n', '@' + p.u)); r.appendChild(h('span', 's', p.purged ? '[ PURGED ]' : '[ INFECTED ]'));
                list.appendChild(r);
            });
        }
        if (S.preview) {
            fill({ ok: true, purged: 3, infected: 2, players: [{ u: 'you', purged: S.purged, me: true }, { u: 'aspec_404', purged: true }, { u: 'solarnamer', purged: true }, { u: 'sleepyuser', purged: false }, { u: 'afk_andy', purged: false }] });
            return;
        }
        var c = client();
        var p = c ? rpc('glitch_report', { p_event: ev.id }) : plainRpc('glitch_report', { p_event: ev.id });
        p.then(fill).catch(function () { plainRpc('glitch_report', { p_event: ev.id }).then(fill).catch(function () { fill(null); }); });
    }

    /* ------------------------------ phases ------------------------------ */
    function joinEvent() {
        if (S.preview || S.joined || !S.ev) return;
        loadUser().then(function (u) {
            if (!u || S.joined || !S.ev) return;
            S.joined = true;
            rpc('glitch_join', { p_event: S.ev.id }).then(function (d) {
                if (!d || d.ok === false) return;
                if (typeof d.points === 'number') S.pts = d.points;
                if (d.got && d.got.length != null) { S.got = {}; d.got.forEach(function (k) { S.got[k] = 1; }); }
                applyGot(); paintHud(); saveState();
                if (d.purged && !S.purged) silentPurge();
            }).catch(function () { S.joined = false; });
        });
    }

    function paintIncoming(ms) {
        if (ms > 30000) { removeIncoming(); return; }
        if (!S.inc) { ensureCss(); S.inc = h('div'); S.inc.id = 'gw-inc'; S.inc.setAttribute('role', 'status'); ROOT.appendChild(S.inc); }
        S.inc.textContent = '\u26A0 ANOMALY DETECTED \u00B7 UNKNOWN SOFTWARE INCOMING IN ' + Math.ceil(ms / 1000) + 's';
    }
    function removeIncoming() { if (S.inc && S.inc.parentNode) S.inc.parentNode.removeChild(S.inc); S.inc = null; }

    function onPhase(ph, prev, t, s, e) {
        S.calm = reducedMotion();
        if (ph === 'run') {
            removeIncoming();
            var el = t - s;
            S.ann40 = S.prog >= 0.4; S.ann60 = (e - t) < 58000; S.ann15 = (e - t) < 14000;
            renderRun(el);
            ROOT.classList.toggle('gw-calm-page', S.calm);
            if (S.purged) { paintPurgedHud(); S.root.querySelectorAll('.gw-scan,.gw-roll,.gw-noise,.gw-vig,.gw-bars,[data-intro]').forEach(function (n) { n.parentNode.removeChild(n); }); }
            else {
                buildCredits(); scheduleBurst(); scheduleWin();
                var first = Math.max(300, INTRO_MS - 1400 - el);
                setTimeout(function () { if (S.phase === 'run' && !S.purged) { spawnWin(); if (!small()) spawnWin(); } }, first);
            }
            joinEvent();
            if (S.snd) phaseAudio();
        } else if (ph === 'outro') {
            removeIncoming();
            if (S.purged) { clearTimeout(S.burstT); clearTimeout(S.winT); stopAllAudio(); }
            else gateOutro();
        } else if (ph === 'report') {
            var wasIn = S.seen;
            teardown(false);
            if ((wasIn || (t - e) < 180000) && !lsGet('gw.done.' + S.ev.id)) showReport();
        }
    }

    function step() {
        var ev = S.ev;
        if (!ev) return;
        var t = nowMs(), s = Date.parse(ev.starts_at), e = Date.parse(ev.ends_at);
        var outroLen = S.purged ? 1200 : OUTRO_MS;
        var ph = t < s ? 'wait' : t < e ? 'run' : t < e + outroLen ? 'outro' : 'report';
        if (ph === 'run') S.prog = clamp((t - s) / Math.max(1, e - s), 0, 1);
        if (ph !== S.phase) { var prev = S.phase; S.phase = ph; onPhase(ph, prev, t, s, e); }
        if (ph === 'wait') paintIncoming(s - t);
        else if (ph === 'run') paintRun(t, s, e);
    }

    function teardown(abort) {
        stopAllAudio();
        clearTimeout(S.burstT); clearTimeout(S.winT); clearTimeout(S.annT); clearInterval(S.pileI);
        S.outT.forEach(clearTimeout); S.outT = [];
        endBurst(); removeCredits();
        S.wins = []; S.outroOn = false;
        if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
        S.root = null;
        removeIncoming();
        ROOT.classList.remove('gw-burst', 'gw-shake', 'gw-calm-page');
    }

    function resetFor(ev) {
        S.phase = 'none'; S.joined = false; S.reportShown = false; S.seen = false; S.outroOn = false;
        S.ann40 = false; S.ann60 = false; S.ann15 = false; S.prog = 0; S.cand = null; S.rewardText = '';
        loadState();
        S.calm = reducedMotion();
    }

    function setEvent(ev) {
        if (nukeBusy()) return;
        ev.audio = ev.audio || {};
        ev.pages = Array.isArray(ev.pages) ? ev.pages : [];
        ev.villain = ev.villain || '';
        var isNew = !S.ev || S.ev.id !== ev.id;
        if (isNew && S.ev) { teardown(true); if (S.rep && S.rep.parentNode) S.rep.parentNode.removeChild(S.rep); }
        S.ev = ev;
        if (isNew) {
            resetFor(ev);
            preloadVillain(ev.villain);
            try { if (window.SpecSound && typeof window.SpecSound.isEnabled === 'function') S.snd = !!window.SpecSound.isEnabled(); } catch (e) { /* ignore */ }
        }
        if (!S.loop) S.loop = setInterval(step, 200);
        step();
    }

    function endNow(announceIt) {
        if (S.loop) { clearInterval(S.loop); S.loop = 0; }
        teardown(true);
        if (announceIt && S.rep && S.rep.parentNode) { S.rep.parentNode.removeChild(S.rep); S.rep = null; }
        S.ev = null; S.phase = 'none';
        if (announceIt) toast('The event was called off by staff. Back to normal.');
    }

    /* ------------------------------ polling ------------------------------ */
    function handle(d, t0) {
        if (S.preview) return;
        var t1 = Date.now();
        if (d && d.now) S.off = Date.parse(d.now) - (t0 + t1) / 2;
        var ev = d && d.event;
        if (!ev) {
            if (S.ev) { var over = Date.parse(S.ev.ends_at) <= nowMs(); endNow(!over && S.phase !== 'none' && S.phase !== 'wait'); }
            return;
        }
        setEvent(ev);
    }
    function poll() {
        if (S.preview || document.hidden) return Promise.resolve();
        var t0 = Date.now();
        return plainRpc('site_glitch_now', {}).then(function (d) { handle(d, t0); }).catch(function () { /* offline, or the SQL is not installed: stay quiet */ });
    }
    function schedule() {
        clearTimeout(S.pollT);
        var ms = 30000;
        if (S.ev) { var t = nowMs(); if (Date.parse(S.ev.starts_at) - t < 120000 && Date.parse(S.ev.ends_at) + 600000 > t) ms = 5000; }
        S.pollT = setTimeout(function () { poll().then(schedule, schedule); }, ms);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !S.preview) poll(); });
    var rz = 0;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(sizeCredits, 200); });
    setInterval(function () { if (S.cbox) sizeCredits(); }, 1500);

    /* ------------------------------ preview (staff, local only) ------------------------------ */
    function startPreview(lose) {
        S.preview = true; clearTimeout(S.pollT);
        if (S.loop) { clearInterval(S.loop); S.loop = 0; }
        teardown(true);
        var n = Date.now(), dur = lose ? 25 : 90;
        try { sessionStorage.removeItem('gw.st.preview'); localStorage.removeItem('gw.done.preview'); } catch (e) { /* ignore */ }
        // the Console saves your current villain / OSTs / look here right before it opens the preview
        var pc = null, au = {};
        try { pc = JSON.parse(lsGet(PREVIEW_KEY) || 'null'); } catch (e) { pc = null; }
        pc = (pc && typeof pc === 'object') ? pc : {};
        ['loop', 'panic', 'scare', 'crash', 'purge'].forEach(function (k) { var u = safeUrl(pc.audio && pc.audio[k]); if (u) au[k] = u; });
        S.ev = null;
        setEvent({ id: 'preview', label: 'Preview', starts_at: new Date(n + 3000).toISOString(), ends_at: new Date(n + 3000 + dur * 1000).toISOString(),
            duration_s: dur, goal: lose ? 99999 : 120, density: 8, seed: Math.floor(Math.random() * 2000000000),
            intensity: (pc.intensity === 'low' || pc.intensity === 'chaos') ? pc.intensity : 'medium',
            jumpscare: pc.jumpscare !== false, volume: typeof pc.volume === 'number' ? clamp(pc.volume, 0, 100) : 70,
            reward_xp: 0, reward_ac: 0, pages: [], villain: safeUrl(pc.villain), audio: au });
        S.off = 0;
    }

    window.SpecGlitch = { preview: startPreview, state: function () { return { phase: S.phase, pts: S.pts, purged: S.purged, preview: S.preview }; } };

    function boot() { if (PREVIEW) startPreview(HASH === '#glitch-preview-lose'); else { poll().then(schedule, schedule); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
