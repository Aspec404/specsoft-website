/* ==========================================================================
   SPECSOFT® blackout-event.js  -  the BLACKOUT EVENT, live and synced for every visitor

   Loaded automatically by seasons.js on every page that has seasons.js (nothing else to add).
   Skipped on admin.html and login.html, and on any page whose <html> has data-blackout-off.

   How it plays
     * The whole site goes dark. Your cursor (or finger) is the only light.
     * Every member gets THEIR OWN random list of pages. One generator pad is hidden on each of those pages,
       one at a time. Find it with your light, drag the matching wires, and the shared POWER counter goes up.
     * Red lights glow on random pages: faint glow -> flicker -> STRONG. Stay in the strong red for a few seconds
       and you are TERMINATED: locked out until the event ends. Chat and spectating stay open.
     * Reach the goal together and the power comes back for everyone.

   Everything that matters is decided by the SERVER (supabase-blackout.sql): your route of pages, red light
   exposure, who is terminated, generator counts, rewards. This file only draws it.
   Phases (server clock):  wait -> run -> win -> report      (or  run -> report when the time runs out)
   Sound only plays when the visitor has sound ON (speaker toggle) or taps the sound button.
   Reduce motion / "Reduce effects" turns on a calm version: no strobing red, no shake.

   Staff preview (local only, nobody else sees it, no rewards):  index.html#blackout-preview
   Public API: window.SpecBlackout { preview(), state() }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecBlackout) return;

    var ROOT = document.documentElement;
    var PATH = (location.pathname || '').toLowerCase();
    var PREVIEW = location.hash === '#blackout-preview';
    if (/(^|\/)(admin|login)(\.html)?$/.test(PATH) || ROOT.hasAttribute('data-blackout-off')) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    var CSS_URL = SELF ? SELF.replace(/blackout-event\.js(\?.*)?$/, 'blackout-event.css$1') : 'blackout-event.css';
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var CALM_KEY = 'specsoft.nuke.calm';       // same "reduce effects" switch the nuke event uses
    var GRACE = 25, WIRES = 5;                 // GRACE must match blackout_red() in supabase-blackout.sql; WIRES must match blackout_gen_finish
    var PALETTE = ['#ff4d6d', '#35e0ff', '#ffd23f', '#b86bff', '#4dff88', '#ffffff'];

    // "chats" is the safe house: it is never hot, and terminated players can still use it
    function slug() {
        var p = (location.pathname || '').toLowerCase().replace(/\/+$/, '');
        var f = (p.split('/').pop() || 'index').replace(/\.html?$/, '');
        return f || 'index';
    }
    var PAGE = slug();
    var IS_CHAT = PAGE === 'chats';

    var S = {
        ev: null, off: 0, phase: 'none', loop: 0, pollT: 0, tickT: 0, raf: 0, last: 0, preview: false, pv: null,
        user: null, uc: false, joined: false, joining: false, live: null, me: null, calm: false, snd: false, blocked: false, auds: {},
        root: null, light: null, dangerVol: 0, red: { st: 0, u: 0, slot: 0 }, exp: 0, forceAt: 0, buzzAt: 0, pulseAt: 0,
        pad: null, padKey: '', wire: null, dead: false, deadEl: null, specEl: null, inc: null, rep: null, reportShown: false,
        ann: {}, annT: 0, seen: false, claimed: false, pct: 0, minute: false, wasRun: false
    };

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
    function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* blocked */ } }
    function small() { return innerWidth < 700; }
    function pretty(pg) { return String(pg || '').replace(/[-_]/g, ' ').toUpperCase(); }
    function $(sel) { return S.root ? S.root.querySelector(sel) : null; }
    function txt(sel, v) { var n = $(sel); if (n && n.textContent !== v) n.textContent = v; }

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
    function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

    function ensureCss() {
        if (document.getElementById('bo-css')) return;
        var l = document.createElement('link');
        l.id = 'bo-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
        l.onload = function () { ROOT.classList.add('bo-css'); if (S.root) S.root.style.visibility = ''; };
        (document.head || ROOT).appendChild(l);
    }
    function toast(msg) {
        ensureCss();
        var t = document.createElement('div'); t.className = 'bo-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
        ROOT.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4200);
    }

    /* ------------------------------ data ------------------------------ */
    function plainRpc(name, args) {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + name, {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(args || {}), cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('blackout ' + r.status); return r.json(); });
    }
    function client() { try { return window.getSupabaseClient ? window.getSupabaseClient() : null; } catch (e) { return null; } }
    function rpc(name, args) {
        var c = client();
        if (!c) return Promise.reject(new Error('no_client'));
        return Promise.resolve(c.rpc(name, args || {})).then(function (r) { if (r.error) throw r.error; return r.data; });
    }
    function loadUser() {
        var c = client();
        if (!c || !c.auth) { S.uc = true; return Promise.resolve(null); }
        return Promise.resolve(c.auth.getSession()).then(function (r) {
            var u = r && r.data && r.data.session && r.data.session.user;
            S.user = u ? { id: u.id } : null; S.uc = true;
            return S.user;
        }).catch(function () { S.uc = true; return null; });
    }
    function errText(err) {
        var m = String((err && err.message) || err || '');
        if (/cooling_down/.test(m)) return 'The generator is still cooling down. Give it a few seconds.';
        if (/no_signal/.test(m)) return 'No signal yet. Wait a second and try again.';
        if (/wrong_page/.test(m)) return 'This is not your generator.';
        if (/terminated/.test(m)) return 'You were terminated.';
        if (/event_over/.test(m)) return 'The blackout is over.';
        if (/too_fast/.test(m)) return 'The server says that repair was too fast to be real. Try again.';
        if (/not_signed_in/.test(m)) return 'Log in first so the server can count you.';
        if (/quota_done/.test(m)) return 'You already fixed all of your generators.';
        return 'Could not reach the server. Try once more.';
    }

    /* ------------------------------ the red light schedule ------------------------------
       MUST match blackout_red() in supabase-blackout.sql (same hash, cycle, stages).
       0 none, 1 faint glow, 2 flicker, 3 STRONG (the only stage that counts as exposure).    */
    function redInfo(ev, page, t) {
        var pages = ev.pages || [], n = pages.length, idx = pages.indexOf(page);
        if (n < 2 || idx < 0 || t < GRACE || t >= ev.duration_s) return { st: 0, u: 0, slot: 0 };
        var lvl = ev.red_level || 3, cyc = 30 - 3 * lvl, tt = t - GRACE, slot = Math.floor(tt / cyc), u = (tt - slot * cyc) / cyc;
        var nhot = Math.min(1 + (lvl >= 3 ? 1 : 0) + (lvl >= 5 ? 1 : 0) + (t >= ev.duration_s - 60 ? 1 : 0), n - 1);
        function score(i) { return Math.imul((slot * 7919 + (i + 1) * 104729 + ev.seed) | 0, 0x9E3779B1 | 0) >>> 0; }
        var mine = score(idx), rank = 0;
        for (var j = 0; j < n; j++) { var sj = score(j); if (sj < mine || (sj === mine && j < idx)) rank++; }
        if (rank >= nhot) return { st: 0, u: 0, slot: slot };
        return { st: u < 0.25 ? 1 : u < 0.5 ? 2 : 3, u: u, slot: slot };
    }

    /* ------------------------------ sound ------------------------------ */
    function vol() { var v = S.ev && S.ev.volume != null ? S.ev.volume : 80; return clamp(v / 100, 0, 1) * 0.9; }
    var AC = null;
    function ac() { if (AC) return AC; try { var C = window.AudioContext || window.webkitAudioContext; if (C) AC = new C(); } catch (e) { AC = null; } return AC; }
    function tone(f, t0, dur, type, gain, f2) {
        var c = ac(); if (!c || !S.snd) return;
        try {
            if (c.state === 'suspended') c.resume();
            var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
            o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * (vol() / 0.9)), t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
        } catch (e) { /* ignore */ }
    }
    function sfxPowerDown() { tone(220, 0, 1.4, 'sawtooth', 0.18, 28); tone(90, 0, 1.6, 'sine', 0.3, 24); }
    function sfxGen() { [0, 0.09, 0.18, 0.3].forEach(function (d, i) { tone(330 * Math.pow(1.26, i), d, 0.28, 'triangle', 0.16); }); tone(60, 0, 0.6, 'sine', 0.3, 110); }
    function sfxDead() { tone(400, 0, 1.1, 'sawtooth', 0.2, 40); tone(70, 0.05, 1.3, 'sine', 0.35, 28); }
    function sfxWin() { [0, 0.14, 0.28, 0.42].forEach(function (d, i) { tone(262 * Math.pow(1.25, i), d, 0.9, 'triangle', 0.18); }); }
    function sfxPulse() { tone(140, 0, 0.18, 'square', 0.07, 90); }
    function sfxBuzz() { tone(110, 0, 0.12, 'sawtooth', 0.05); tone(135, 0.07, 0.1, 'sawtooth', 0.04); }
    function sfxSpark() { tone(900, 0, 0.12, 'square', 0.05, 300); }

    function track(name, url, loop, pos, v) {
        stopTrack(name);
        if (!url) return;
        var a = new Audio();
        a.preload = 'auto'; a.loop = !!loop; a.volume = v != null ? v : vol(); a.src = url;
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
        var v = a.volume, i = setInterval(function () { v -= 0.06; if (v <= 0) { clearInterval(i); try { a.pause(); } catch (e) { /* ignore */ } } else a.volume = v; }, 80);
    }
    function sting(name, synth) {
        if (!S.snd || !S.ev) return;
        var url = (S.ev.audio || {})[name];
        if (url) track('st-' + name, url, false, 0); else if (synth) synth();
    }
    function phaseAudio() {
        if (!S.snd || !S.ev) return;
        S.blocked = false;
        var t = nowMs(), s = Date.parse(S.ev.starts_at), a = S.ev.audio || {};
        if (S.phase === 'run') {
            if (a.ost && !S.auds.ost) track('ost', a.ost, true, (t - s) / 1000);
            if (a.danger && !S.auds.danger) track('danger', a.danger, true, (t - s) / 1000, 0);
        }
        paintSoundBtn();
    }
    function stopAllAudio() {
        Object.keys(S.auds).forEach(function (k) { stopTrack(k); });
    }
    function setSound(on) {
        S.snd = !!on; ssSet('bo.snd', S.snd ? '1' : '0');
        if (S.snd) { var c = ac(); if (c && c.state === 'suspended') c.resume(); phaseAudio(); } else stopAllAudio();
        paintSoundBtn();
    }
    function paintSoundBtn() {
        var b = $('[data-a="snd"]');
        if (b) b.textContent = small() ? (S.snd ? '\uD83D\uDD0A' : '\uD83D\uDD07') : (S.snd ? '\uD83D\uDD0A SOUND ON' : '\uD83D\uDD07 SOUND OFF');
    }
    document.addEventListener('pointerdown', function () { if (S.snd && S.blocked) phaseAudio(); }, true);

    /* ------------------------------ layout ------------------------------ */
    function mount() {
        if (S.root) return;
        ensureCss();
        var r = document.createElement('div'); r.id = 'bo-root'; r.setAttribute('data-bo', '');
        if (!ROOT.classList.contains('bo-css')) r.style.visibility = 'hidden';
        S.root = r; ROOT.appendChild(r);
        r.addEventListener('click', onClick);
        S.seen = true;
    }

    function buildRun() {
        mount();
        S.root.className = S.calm ? 'bo-calm' : '';
        S.root.innerHTML =
            '<div class="bo-dark" data-dark></div><div class="bo-red" data-red></div><div class="bo-flash" data-flash></div>' +
            '<div class="bo-hud" data-hud data-a="hud"><div class="bo-hud-top"><span class="bo-tag">BLACKOUT</span><span class="bo-clock" data-clock>--:--</span><button type="button" class="bo-mini" data-a="snd"></button></div>' +
            '<div class="bo-power"><b data-power>POWER 0/0</b><span class="bo-alive" data-alive></span></div><div class="bo-bar"><i data-bar></i></div>' +
            '<div class="bo-task" data-task></div>' +
            '<div class="bo-ex" data-ex hidden><span>RED LIGHT EXPOSURE</span><div class="bo-exbar"><i data-exbar></i></div><b data-exnum>0.0s</b></div></div>' +
            '<div class="bo-danger" data-danger hidden>\u26A0 THIS PAGE IS LOSING POWER \u00B7 SWITCH PAGES</div>' +
            '<div class="bo-warn" data-warn>\u26A0 Flickering red lights and loud sound. <button type="button" data-a="calm">Reduce effects</button><button type="button" data-a="warnx" aria-label="Dismiss">\u00D7</button></div>' +
            '<div class="bo-ann" data-ann role="status" aria-live="assertive"></div>';
        var wn = $('[data-warn]'); if (wn && ssGet('bo.warnx') === '1') wn.hidden = true;
        paintSoundBtn();
    }

    /* ------------------------------ the light + red light + pad loop ------------------------------ */
    function startLoop() {
        stopLoop();
        S.light = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2, moved: false };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerdown', onMove, { passive: true });
        window.addEventListener('touchstart', onTouch, { passive: true }); window.addEventListener('touchmove', onTouch, { passive: true });
        S.last = 0; S.raf = requestAnimationFrame(frame);
    }
    function stopLoop() {
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerdown', onMove);
        window.removeEventListener('touchstart', onTouch); window.removeEventListener('touchmove', onTouch);
        if (S.raf) cancelAnimationFrame(S.raf);
        S.raf = 0; S.light = null;
    }
    function onMove(e) { if (!S.light) return; S.light.tx = e.clientX; S.light.ty = e.clientY - (e.pointerType === 'touch' ? 52 : 0); S.light.moved = true; }   // on touch the light sits just above the finger so the finger never covers it
    function onTouch(e) { var t = e.touches && e.touches[0]; if (!t || !S.light) return; S.light.tx = t.clientX; S.light.ty = t.clientY - 52; S.light.moved = true; }

    function frame(ts) {
        S.raf = requestAnimationFrame(frame);
        var L = S.light, ev = S.ev;
        if (!L || !ev || !S.root) return;
        var dt = S.last ? Math.min(0.1, (ts - S.last) / 1000) : 0.016; S.last = ts;
        var dark = $('[data-dark]'), red = $('[data-red]');
        var t = (nowMs() - Date.parse(ev.starts_at)) / 1000;

        // flashlight
        if (!L.moved) { L.tx = innerWidth / 2 + Math.cos(ts / 2100) * innerWidth * 0.22; L.ty = innerHeight / 2 + Math.sin(ts / 1500) * innerHeight * 0.18; }
        L.x += (L.tx - L.x) * 0.32; L.y += (L.ty - L.y) * 0.32;
        var base = S.calm ? (small() ? 160 : 230) : (small() ? 135 : 190);
        var fl = S.calm ? 1 : 1 + Math.sin(ts / 95) * 0.02 + (Math.random() < 0.02 ? -0.2 : 0);
        var lr = base * fl;
        if (dark) { dark.style.setProperty('--fx', L.x.toFixed(1) + 'px'); dark.style.setProperty('--fy', L.y.toFixed(1) + 'px'); dark.style.setProperty('--fr', lr.toFixed(1) + 'px'); }

        // red light on THIS page
        var ri = S.phase === 'run' ? redInfo(ev, PAGE, t) : { st: 0, u: 0, slot: 0 };
        S.red = ri;
        var kill = ev.red_kill_s || 5, member = !!S.user || S.preview;
        if (member && !S.dead && S.phase === 'run' && !document.hidden) S.exp = ri.st === 3 ? S.exp + dt : Math.max(0, S.exp - dt * 1.5);
        var rl = 0;
        if (ri.st === 1) rl = 0.10 + ri.u / 0.25 * 0.12 + (S.calm ? 0 : Math.sin(ts / 700) * 0.03);
        else if (ri.st === 2) { rl = 0.22 + (ri.u - 0.25) / 0.25 * 0.3; if (!S.calm) rl *= (Math.random() < 0.09 ? 0.2 : 1 + Math.sin(ts / 60) * 0.12); }
        else if (ri.st === 3) rl = S.calm ? 0.7 : 0.62 + Math.sin(ts / 110) * 0.2;
        rl = clamp(rl, 0, 1);
        if (red) {
            red.style.setProperty('--rl', rl.toFixed(3));
            red.style.setProperty('--ex', clamp(S.exp / kill, 0, 1).toFixed(3));
            if (S.redSlot !== ri.slot) { S.redSlot = ri.slot; var rr = mulberry(hashStr(ev.id + ':' + ri.slot)); red.style.setProperty('--rx', (rr() * 100).toFixed(0) + '%'); red.style.setProperty('--ry', (rr() * 100).toFixed(0) + '%'); }
        }
        var dg = $('[data-danger]'); if (dg) dg.hidden = !(member && ri.st >= 2 && !S.dead);
        var exw = $('[data-ex]');
        if (exw) {
            var showEx = member && S.exp > 0.05 && !S.dead;
            exw.hidden = !showEx;
            if (showEx) { var eb = $('[data-exbar]'); if (eb) eb.style.width = clamp(S.exp / kill * 100, 0, 100).toFixed(1) + '%'; txt('[data-exnum]', Math.min(S.exp, kill).toFixed(1) + 's / ' + kill + 's'); }
        }
        ROOT.classList.toggle('bo-shake', !S.calm && member && S.red.st === 3 && !S.dead);

        // heartbeat of danger: pulse sound while the strong red is on this page, danger OST fades in with it
        if (S.snd && member && ri.st === 3 && ts - S.pulseAt > 900 && !(S.ev.audio || {}).danger) { S.pulseAt = ts; sfxPulse(); }
        var dTarget = (member && !S.dead) ? (ri.st === 3 ? 1 : ri.st === 2 ? 0.6 : ri.st === 1 ? 0.25 : 0) : 0;
        S.dangerVol += (dTarget - S.dangerVol) * Math.min(1, dt * 2.2);
        var da = S.auds.danger; if (da) { try { da.volume = clamp(vol() * S.dangerVol, 0, 1); } catch (e) { /* ignore */ } }
        var oa = S.auds.ost; if (oa) { try { oa.volume = clamp(vol() * (1 - S.dangerVol * 0.55), 0, 1); } catch (e) { /* ignore */ } }

        // out of time for the server to confirm? ask right now (at most once a second)
        if (!S.preview && member && !S.dead && S.exp >= kill - 0.05 && ts - S.forceAt > 1000) { S.forceAt = ts; tick(true); }
        if (S.preview && S.exp >= kill && !S.dead) onDead();

        // the generator pad: nearly invisible, only the light (or a hint) reveals it
        if (S.pad) {
            var pr = S.pad.getBoundingClientRect(), cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2;
            var d = Math.sqrt((cx - L.x) * (cx - L.x) + (cy - L.y) * (cy - L.y));
            var o = clamp(1 - (d - lr * 0.35) / (lr * 0.75), 0, 1);
            var hintHere = S.me && S.me.hint === PAGE;
            S.pad.style.opacity = String(Math.max(o, hintHere ? 0.6 : 0.16));
            if (o > 0.5 && S.snd && ts - S.buzzAt > 1600) { S.buzzAt = ts; sfxBuzz(); }
        }
    }

    function onClick(e) {
        var a = e.target.closest && e.target.closest('[data-a]');
        if (!a) return;
        var k = a.getAttribute('data-a');
        if (k === 'snd') setSound(!S.snd);
        else if (k === 'calm') { S.calm = true; lsSet(CALM_KEY, '1'); if (S.root) S.root.classList.add('bo-calm'); var w = $('[data-warn]'); if (w) w.hidden = true; ssSet('bo.warnx', '1'); ROOT.classList.remove('bo-shake'); }
        else if (k === 'warnx') { var w2 = $('[data-warn]'); if (w2) w2.hidden = true; ssSet('bo.warnx', '1'); }
        else if (k === 'spec') { if (S.specEl) S.specEl.classList.toggle('is-open'); }
        else if (k === 'hud') { var h = $('[data-hud]'); if (h) h.classList.toggle('is-open'); }
    }

    /* ------------------------------ announcements + hud ------------------------------ */
    function announce(text, big) {
        var a = $('[data-ann]');
        if (!a) return;
        a.textContent = text; a.classList.toggle('is-big', !!big); a.classList.add('is-on');
        clearTimeout(S.annT); S.annT = setTimeout(function () { a.classList.remove('is-on'); }, 3600);
    }
    function flash(cls) {
        var f = $('[data-flash]'); if (!f || S.calm) return;
        f.className = 'bo-flash'; void f.offsetWidth; f.className = 'bo-flash ' + cls;
    }
    function paintHud(t) {
        var ev = S.ev, d = S.live || {}, me = S.me;
        var left = (Date.parse(ev.ends_at) - t) / 1000;
        var goal = d.goal || ev.goal || 0, tot = d.fixed_total || 0;
        txt('[data-clock]', S.phase === 'win' ? 'POWER ON' : mmss(left));
        txt('[data-power]', 'POWER ' + Math.min(tot, goal) + '/' + goal);
        var bar = $('[data-bar]'); if (bar) bar.style.width = (goal ? clamp(tot / goal * 100, 0, 100) : 0).toFixed(1) + '%';
        txt('[data-alive]', d.players != null ? '\u2665 ' + (d.alive || 0) + ' ONLINE \u00B7 \u2620 ' + (d.dead || 0) : '');
        var task;
        if (S.phase === 'win') task = 'POWER RESTORED. THANK YOU.';
        else if (!S.uc && !S.preview) task = 'CONNECTING TO THE GRID...';
        else if (!S.user && !S.preview) task = 'LOG IN TO HELP FIX THE GENERATORS';
        else if (!me || !me.joined) task = 'CONNECTING TO THE GRID...';
        else if (me.fixed >= me.quota) task = 'YOUR GENERATORS ' + me.fixed + '/' + me.quota + ' DONE. STAY ALIVE AND KEEP WATCHING THE GRID.';
        else task = 'YOUR GENERATORS ' + me.fixed + '/' + me.quota + ' \u00B7 ' + (me.here ? 'A GENERATOR IS HIDDEN ON THIS PAGE. SWEEP YOUR LIGHT AROUND AND SCROLL.' : me.hint ? 'SIGNAL DETECTED ON: ' + pretty(me.hint) : 'EXPLORE THE PAGES AND FIND THE NEXT ONE WITH YOUR LIGHT.');
        txt('[data-task]', task);
        if (S.phase === 'run') {
            var pc = goal ? tot / goal : 0;
            [25, 50, 75].forEach(function (m) { if (pc * 100 >= m && !S.ann['p' + m]) { S.ann['p' + m] = 1; if (m > S.pct) { announce('POWER ' + m + '%', true); S.pct = m; } } });
            if (!S.minute && left <= 60 && left > 0) { S.minute = true; announce('FINAL MINUTE \u00B7 THE RED LIGHTS GET WORSE', true); }
        }
        if (S.dead) paintSpectate();
    }

    /* ------------------------------ the generator pad ------------------------------ */
    function padPos() {
        var uid = (S.user && S.user.id) || 'guest', r = mulberry(hashStr(uid + ':' + S.ev.id + ':' + PAGE));
        var W = Math.max(innerWidth, 320), H = Math.min(Math.max(document.documentElement.scrollHeight, innerHeight), innerHeight * 3);   // never buried deep in a super long page
        var n = (S.me && S.me.fixed) || 0; r = mulberry(hashStr(uid + ':' + S.ev.id + ':' + PAGE + ':' + n));                                 // new spot for every generator, even on the same page
        return { x: 14 + r() * (W - 100), y: 150 + r() * Math.max(120, H - 300) };
    }
    function syncPad() {
        var want = !!(S.me && S.me.here) && S.phase === 'run' && !S.dead && (S.user || S.preview);
        if (!want) { removePad(); return; }
        ensureCss();
        var key = S.ev.id + ':' + PAGE + ':' + S.me.fixed;
        if (S.pad && S.padKey === key) { var p0 = padPos(); S.pad.style.left = p0.x.toFixed(0) + 'px'; S.pad.style.top = p0.y.toFixed(0) + 'px'; return; }
        removePad();
        var b = document.createElement('button'); b.type = 'button'; b.className = 'bo-pad'; b.id = 'bo-pad'; b.setAttribute('aria-label', 'Generator control panel');
        b.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 3 43 14v20L24 45 5 34V14z"/><path d="M26 11 16 26h7l-2 11 11-16h-7z"/></svg><i class="bo-led"></i>';
        var p = padPos(); b.style.left = p.x.toFixed(0) + 'px'; b.style.top = p.y.toFixed(0) + 'px'; b.style.opacity = '0.16';
        b.addEventListener('click', openPad);
        ROOT.appendChild(b); S.pad = b; S.padKey = key;
    }
    function removePad() { if (S.pad && S.pad.parentNode) S.pad.parentNode.removeChild(S.pad); S.pad = null; S.padKey = ''; }

    function openPad() {
        if (S.wire || S.dead || S.phase !== 'run') return;
        if (S.preview) { showWire(); return; }
        if (!S.user) { toast('Log in to repair generators.'); return; }
        rpc('blackout_gen_start', { p_event: S.ev.id, p_page: PAGE }).then(showWire).catch(function (err) {
            if (/not_joined/.test(String((err && err.message) || ''))) { S.joined = false; joinEvent(); }
            toast(errText(err));
        });
    }

    /* ------------------------------ the wire puzzle ------------------------------ */
    function showWire() {
        ensureCss(); closeWire();
        var cols = PALETTE.slice().sort(function () { return Math.random() - 0.5; }).slice(0, WIRES);
        var right = cols.slice(); do { right.sort(function () { return Math.random() - 0.5; }); } while (right.join() === cols.join());
        var w = document.createElement('div'); w.className = 'bo-wire'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-label', 'Generator repair');
        var l = '', r = '';
        cols.forEach(function (c, i) { l += '<button type="button" class="bo-n l" data-c="' + c + '" style="--c:' + c + '" aria-label="Wire ' + (i + 1) + ' start"></button>'; });
        right.forEach(function (c, i) { r += '<button type="button" class="bo-n r" data-c="' + c + '" style="--c:' + c + '" aria-label="Terminal ' + (i + 1) + '"></button>'; });
        w.innerHTML = '<div class="bo-wire-card"><div class="bo-wire-head"><b>\u26A1 GENERATOR REPAIR</b><span data-wc>0/' + WIRES + '</span><button type="button" class="bo-mini" data-wx aria-label="Close">\u00D7</button></div>' +
            '<div class="bo-board" data-board><svg class="bo-wsvg" data-wsvg></svg><div class="bo-col">' + l + '</div><div class="bo-col">' + r + '</div></div>' +
            '<div class="bo-wnote" data-wn>Drag each wire to the terminal with the same color. (Or tap a wire, then its terminal.)</div></div>';
        ROOT.appendChild(w);
        var W = { el: w, done: 0, drag: null, sel: null, busy: false, svg: w.querySelector('[data-wsvg]'), board: w.querySelector('[data-board]') };
        S.wire = W;
        w.querySelector('[data-wx]').addEventListener('click', closeWire);
        w.addEventListener('pointerdown', wDown);
        w.addEventListener('click', wClick);
        window.addEventListener('pointermove', wMove); window.addEventListener('pointerup', wUp);
    }
    function closeWire() {
        var W = S.wire; if (!W) return;
        S.wire = null;
        window.removeEventListener('pointermove', wMove); window.removeEventListener('pointerup', wUp);
        if (W.el.parentNode) W.el.parentNode.removeChild(W.el);
    }
    function nodeXY(n) { var W = S.wire, b = W.board.getBoundingClientRect(), r = n.getBoundingClientRect(); return { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top }; }
    function wire(a, b, c, cls) {
        var W = S.wire, p = document.createElementNS('http://www.w3.org/2000/svg', 'path'), mx = (a.x + b.x) / 2;
        p.setAttribute('d', 'M' + a.x + ' ' + a.y + ' C' + mx + ' ' + a.y + ' ' + mx + ' ' + b.y + ' ' + b.x + ' ' + b.y);
        p.setAttribute('stroke', c); p.setAttribute('class', cls || ''); W.svg.appendChild(p); return p;
    }
    function wDown(e) {
        var W = S.wire, n = e.target.closest && e.target.closest('.bo-n.l');
        if (!W || !n || n.classList.contains('ok') || W.busy) return;
        e.preventDefault();
        var a = nodeXY(n);
        W.drag = { n: n, c: n.getAttribute('data-c'), a: a, line: wire(a, a, n.getAttribute('data-c'), 'tmp'), sx: e.clientX, sy: e.clientY, moved: false };
        n.classList.add('is-hold');
    }
    function wMove(e) {
        var W = S.wire; if (!W || !W.drag) return;
        var D = W.drag, b = W.board.getBoundingClientRect(), p = { x: e.clientX - b.left, y: e.clientY - b.top };
        if (Math.abs(e.clientX - D.sx) + Math.abs(e.clientY - D.sy) > 8) D.moved = true;
        var mx = (D.a.x + p.x) / 2; D.line.setAttribute('d', 'M' + D.a.x + ' ' + D.a.y + ' C' + mx + ' ' + D.a.y + ' ' + mx + ' ' + p.y + ' ' + p.x + ' ' + p.y);
    }
    function wUp(e) {
        var W = S.wire; if (!W || !W.drag) return;
        var D = W.drag; W.drag = null; D.n.classList.remove('is-hold');
        if (D.line.parentNode) D.line.parentNode.removeChild(D.line);
        if (!D.moved) { W.sel = D.n; W.el.querySelectorAll('.bo-n.l').forEach(function (x) { x.classList.toggle('is-sel', x === D.n); }); return; }
        var t = document.elementFromPoint(e.clientX, e.clientY), r = t && t.closest && t.closest('.bo-n.r');
        if (r) tryConnect(D.n, r);
    }
    function wClick(e) {
        var W = S.wire, r = e.target.closest && e.target.closest('.bo-n.r');
        if (!W || !r || !W.sel) return;
        var l = W.sel; W.sel = null; W.el.querySelectorAll('.bo-n.l').forEach(function (x) { x.classList.remove('is-sel'); });
        tryConnect(l, r);
    }
    function tryConnect(l, r) {
        var W = S.wire; if (!W || r.classList.contains('ok')) return;
        if (l.getAttribute('data-c') === r.getAttribute('data-c')) {
            l.classList.add('ok'); r.classList.add('ok'); wire(nodeXY(l), nodeXY(r), l.getAttribute('data-c'), 'on');
            W.done++; var c = W.el.querySelector('[data-wc]'); if (c) c.textContent = W.done + '/' + WIRES; sfxSpark();
            if (W.done >= WIRES) wireDone();
        } else {
            r.classList.add('bad'); setTimeout(function () { r.classList.remove('bad'); }, 300);
            var n = W.el.querySelector('[data-wn]'); if (n) n.textContent = 'Wrong terminal. Match the colors.';
        }
    }
    function wireDone() {
        var W = S.wire; W.busy = true;
        var n = W.el.querySelector('[data-wn]'); if (n) n.textContent = 'POWERING UP...';
        W.el.classList.add('is-done');
        if (S.preview) { setTimeout(function () { closeWire(); onFixed(pvFix()); }, 900); return; }
        rpc('blackout_gen_finish', { p_event: S.ev.id, p_wires: WIRES }).then(function (d) {
            setTimeout(function () { closeWire(); onFixed(d); }, 700);
        }).catch(function (err) { closeWire(); toast(errText(err)); tick(true); });
    }
    function onFixed(d) {
        if (!d) return;
        if (S.me) { S.me.fixed = d.fixed; S.me.quota = d.quota != null ? d.quota : S.me.quota; S.me.here = false; S.me.hint = null; }
        if (S.live) S.live.fixed_total = d.total;
        if (d.won && S.ev) { S.ev.won_at = new Date(nowMs()).toISOString(); if (S.preview) S.ev.ends_at = new Date(nowMs() + 20000).toISOString(); }
        removePad(); flash('is-gen'); sting('gen', sfxGen);
        var parts = []; if (d.reward_xp > 0) parts.push('+' + d.reward_xp + ' XP'); if (d.reward_ac > 0) parts.push('+' + d.reward_ac + ' APEX Credits');
        announce('GENERATOR ONLINE' + (parts.length ? ' \u00B7 ' + parts.join(' \u00B7 ') : ''), true);
        payload(d); paintHud(nowMs()); if (!S.preview) tick(true);
    }
    function payload(d) {
        try { if (window.ApexCredits) { if (d.balance != null && window.ApexCredits.set) window.ApexCredits.set(d.balance); else window.ApexCredits.refresh(); } } catch (e) { /* ignore */ }
        try { if (window.SpecXP) { if (d.xp && window.SpecXP.set) window.SpecXP.set(d.xp); else window.SpecXP.refresh(); } } catch (e) { /* ignore */ }
    }

    /* ------------------------------ terminated: locked out, chat + spectating stay ------------------------------ */
    function onDead() {
        if (S.dead) return;
        S.dead = true; if (S.ev && !S.preview) ssSet('bo.dead.' + S.ev.id, '1');
        closeWire(); removePad(); S.exp = 0; ROOT.classList.remove('bo-shake');
        stopTrack('ost', true); stopTrack('danger', true);
        if (S.seen) { sting('dead', sfxDead); flash('is-dead'); }
        buildDead();
    }
    function buildDead() {
        removeDead();
        mount(); ensureCss();
        var d = document.createElement('div');
        if (IS_CHAT) {
            d.className = 'bo-spec';
            d.innerHTML = '<button type="button" class="bo-spec-btn" data-a="spec">\u2620 TERMINATED \u00B7 SPECTATING <i data-spec-pw></i></button><div class="bo-spec-body" data-spec-body></div>';
        } else {
            d.className = 'bo-dead'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Terminated');
            d.innerHTML = '<div class="bo-dead-card"><div class="bo-dead-x">SIGNAL LOST</div><h2>YOU WERE TERMINATED</h2>' +
                '<p>The red light got you. You are locked out of the site until the blackout ends. ' + (S.preview ? '(Preview: reload the page to start over.)' : 'Chat stays open, and you can watch the others.') + '</p>' +
                '<div class="bo-dead-time" data-spec-time>--:--</div><div class="bo-bar"><i data-spec-bar></i></div><div class="bo-dead-pw" data-spec-pw></div>' +
                '<div class="bo-spec-body" data-spec-body></div>' +
                (S.preview ? '' : '<a class="bo-btn" href="chats.html">OPEN CHATS</a>') + '</div>';
        }
        S.root.appendChild(d); S.deadEl = d; S.specEl = d;
        S.root.classList.add('bo-is-dead');
        paintSpectate();
    }
    function paintSpectate() {
        var d = S.specEl, L = S.live || {};
        if (!d) return;
        var goal = L.goal || (S.ev && S.ev.goal) || 0, tot = L.fixed_total || 0;
        var pw = d.querySelectorAll('[data-spec-pw]'); for (var i = 0; i < pw.length; i++) pw[i].textContent = 'POWER ' + Math.min(tot, goal) + '/' + goal;
        var tm = d.querySelector('[data-spec-time]'); if (tm && S.ev) tm.textContent = mmss((Date.parse(S.ev.ends_at) - nowMs()) / 1000);
        var br = d.querySelector('[data-spec-bar]'); if (br) br.style.width = (goal ? clamp(tot / goal * 100, 0, 100) : 0).toFixed(1) + '%';
        var body = d.querySelector('[data-spec-body]');
        if (body && L.top) {
            var key = JSON.stringify(L.top);
            if (body.getAttribute('data-k') !== key) {
                body.setAttribute('data-k', key); body.innerHTML = '';
                L.top.forEach(function (p, i) {
                    var r = document.createElement('div'); r.className = 'bo-row' + (p.dead ? ' is-dead' : '') + (p.me ? ' is-me' : '');
                    var a = document.createElement('span'); a.className = 'n'; a.textContent = (i + 1) + '. @' + p.u;
                    var b = document.createElement('span'); b.className = 's'; b.textContent = '\u26A1' + p.fixed + ' \u00B7 ' + p.pts + ' pts' + (p.dead ? ' \u2620' : '');
                    r.appendChild(a); r.appendChild(b); body.appendChild(r);
                });
            }
        }
    }
    function removeDead() {
        if (S.deadEl && S.deadEl.parentNode) S.deadEl.parentNode.removeChild(S.deadEl);
        S.deadEl = null; S.specEl = null; if (S.root) S.root.classList.remove('bo-is-dead');
    }

    /* ------------------------------ ending screen ------------------------------ */
    function showReport() {
        var ev = S.ev;
        if (!ev || S.reportShown) return;
        S.reportShown = true; ensureCss();
        var wrap = document.createElement('div'); wrap.id = 'bo-report'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Event report');
        var card = document.createElement('div'); card.className = 'bo-rep';
        var img = document.createElement('img'); img.src = 'logo.png'; img.alt = ''; img.onerror = function () { img.style.display = 'none'; };
        var h = document.createElement('h2'); h.textContent = 'SPECSOFT\u00AE EVENT REPORT';
        var sub = document.createElement('p'); sub.className = 'bo-rep-sub'; sub.textContent = (ev.label || 'BLACKOUT').toUpperCase();
        var res = document.createElement('div'); res.className = 'bo-rep-res';
        var dl = document.createElement('dl');
        function row(k, v) { var dt = document.createElement('dt'); dt.textContent = k; var dd = document.createElement('dd'); dd.textContent = v; dl.appendChild(dt); dl.appendChild(dd); }
        row('LIGHTS OUT', fmtDT(Date.parse(ev.starts_at)));
        row('ENDED', fmtDT(Date.parse(ev.ends_at)));
        var count = document.createElement('div'); count.className = 'bo-rep-count';
        var list = document.createElement('div'); list.className = 'bo-rep-list';
        var load = document.createElement('div'); load.className = 'bo-rep-empty'; load.textContent = 'Loading the grid log...'; list.appendChild(load);
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'bo-btn'; btn.textContent = 'CONTINUE';
        btn.addEventListener('click', function () {
            lsSet('bo.done.' + ev.id, '1'); wrap.classList.remove('is-on');
            setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); S.rep = null; }, 600);
        });
        [img, h, sub, res, dl, count, list, btn].forEach(function (n) { card.appendChild(n); });
        wrap.appendChild(card); ROOT.appendChild(wrap); S.rep = wrap;
        requestAnimationFrame(function () { wrap.classList.add('is-on'); });
        setTimeout(function () { try { btn.focus(); } catch (e) { /* ignore */ } }, 700);

        function fill(d) {
            list.innerHTML = '';
            if (!d || d.ok === false) { var m = document.createElement('div'); m.className = 'bo-rep-empty'; m.textContent = 'The grid log is not available right now.'; list.appendChild(m); return; }
            wrap.classList.toggle('is-won', !!d.won); wrap.classList.toggle('is-lost', !d.won);
            res.textContent = d.won ? 'POWER RESTORED' : 'THE GRID NEVER CAME BACK';
            row('GENERATORS', d.total + ' / ' + d.goal);
            count.innerHTML = '';
            function c(cls, num, label) { var x = document.createElement('div'); x.className = 'bo-rep-card ' + cls; var b = document.createElement('b'); b.textContent = String(num); var s = document.createElement('span'); s.textContent = label; x.appendChild(b); x.appendChild(s); return x; }
            count.appendChild(c('a', d.alive, 'SURVIVED')); count.appendChild(c('m', d.dead, 'TERMINATED'));
            if (!d.players || !d.players.length) { var e0 = document.createElement('div'); e0.className = 'bo-rep-empty'; e0.textContent = 'Nobody signed in was here for this one.'; list.appendChild(e0); return; }
            d.players.forEach(function (p) {
                var r = document.createElement('div'); r.className = 'bo-rep-row ' + (p.dead ? 'is-dead' : 'is-alive') + (p.me ? ' is-me' : '');
                var n = document.createElement('span'); n.className = 'n'; n.textContent = '@' + p.u;
                var g = document.createElement('span'); g.className = 'g'; g.textContent = '\u26A1' + p.fixed;
                var s = document.createElement('span'); s.className = 's'; s.textContent = p.dead ? '[ TERMINATED ]' : '[ SURVIVED ]';
                r.appendChild(n); r.appendChild(g); r.appendChild(s); list.appendChild(r);
            });
        }
        if (S.preview) { fill({ ok: true, won: true, goal: 6, total: 6, alive: 3, dead: 2, players: [{ u: 'you', fixed: S.me ? S.me.fixed : 2, dead: S.dead, me: true }, { u: 'aspec_404', fixed: 3 }, { u: 'solarnamer', fixed: 1 }, { u: 'sleepyuser', fixed: 0, dead: true }] }); return; }
        var p = client() ? rpc('blackout_report', { p_event: ev.id }) : plainRpc('blackout_report', { p_event: ev.id });
        p.then(fill).catch(function () { plainRpc('blackout_report', { p_event: ev.id }).then(fill).catch(function () { fill(null); }); });
    }

    /* ------------------------------ live pulse (server) ------------------------------ */
    function joinEvent() {
        if (S.preview || S.joined || S.joining || !S.ev) return;
        S.joining = true;
        loadUser().then(function (u) {
            if (!u || !S.ev) { S.joining = false; return; }
            rpc('blackout_join', { p_event: S.ev.id }).then(function (d) {
                S.joining = false; S.joined = !!(d && d.ok);
                if (d && d.dead && !S.dead && S.phase === 'run') onDead();
                tick(true);
            }).catch(function () { S.joining = false; });
        });
    }
    function tick(now) {
        clearTimeout(S.tickT);
        if (!S.ev || S.preview) return;
        if (S.phase !== 'run' && S.phase !== 'win') { S.tickT = setTimeout(tick, 1500); return; }
        var args = { p_event: S.ev.id, p_page: document.hidden ? null : PAGE, p_top: !!(S.dead || S.phase === 'win') };
        var req = S.user ? rpc('blackout_live', args) : plainRpc('blackout_live', args);
        req.then(onLive).catch(function () { /* offline: keep the last picture */ }).then(function () {
            var fast = S.red.st >= 2 || S.exp > 0.2;
            clearTimeout(S.tickT); S.tickT = setTimeout(tick, fast ? 1000 : 2200);
        });
    }
    function onLive(d) {
        if (!d || !S.ev) return;
        if (d.ok === false) { if (d.error === 'not_found') poll(); return; }
        if (d.now) { var off = Date.parse(d.now) - Date.now(); S.off = S.off * 0.5 + off * 0.5; }
        S.live = d; S.me = d.me || null;
        if (d.ends_at) S.ev.ends_at = d.ends_at;
        if (d.won_at && !S.ev.won_at) S.ev.won_at = d.won_at;
        if (S.me && S.me.joined === false && S.user && !S.joined) joinEvent();
        if (S.me && S.me.joined) { S.joined = true; S.exp = S.me.exposure || 0; if (S.me.dead && !S.dead && S.phase === 'run') onDead(); }
        if (S.dead && S.me && S.me.joined && !S.me.dead && S.phase === 'run') { S.dead = false; removeDead(); }
        syncPad();
        if (S.phase === 'run' || S.phase === 'win') paintHud(nowMs());
        step();
    }

    /* ------------------------------ phases ------------------------------ */
    function paintIncoming(ms) {
        if (ms > 30000) { removeIncoming(); return; }
        if (!S.inc) { ensureCss(); S.inc = document.createElement('div'); S.inc.id = 'bo-inc'; S.inc.setAttribute('role', 'status'); ROOT.appendChild(S.inc); }
        S.inc.textContent = '\u26A0 POWER GRID FAILING \u00B7 BLACKOUT IN ' + Math.ceil(ms / 1000) + 's';
    }
    function removeIncoming() { if (S.inc && S.inc.parentNode) S.inc.parentNode.removeChild(S.inc); S.inc = null; }

    function onPhase(ph, prev, t, s, e) {
        S.calm = reducedMotion();
        if (ph === 'wait') { /* paintIncoming runs each step */ }
        else if (ph === 'run') {
            removeIncoming(); S.wasRun = true;
            S.pct = 0; S.ann = {}; S.minute = false;
            buildRun(); startLoop();
            if (ssGet('bo.dead.' + S.ev.id) === '1') { S.dead = true; buildDead(); }
            if (prev === 'wait') { flash('is-slam'); announce('BLACKOUT', true); if (S.snd) sfxPowerDown(); }
            joinEvent(); tick(true); phaseAudio();
        } else if (ph === 'win') {
            removeIncoming(); stopTrack('ost', true); stopTrack('danger', true); removePad(); closeWire();
            if (!S.root) { buildRun(); }
            S.dead = false; removeDead(); stopLoop();
            S.root.classList.add('bo-restored'); ROOT.classList.remove('bo-shake');
            flash('is-win'); announce('POWER RESTORED', true); sting('win', sfxWin);
            var dk = $('[data-dark]'); if (dk) dk.style.setProperty('--fr', '3000px');
            var rd = $('[data-red]'); if (rd) rd.style.setProperty('--rl', '0');
            if (S.preview) pvClaim(); else claim();
            tick(true);
        } else if (ph === 'report') {
            var wasIn = S.seen, won = !!S.ev.won_at;
            teardown(false);
            if (wasIn && !won) sting('fail', sfxDead);
            if ((wasIn || (t - e) < 180000) && !lsGet('bo.done.' + S.ev.id)) showReport();
        }
    }
    function claim() {
        if (S.claimed || !S.user) return; S.claimed = true;
        var go = function () {
            rpc('blackout_claim', { p_event: S.ev.id }).then(function (d) {
                if (!d || !d.ok || d.already) return;
                var parts = []; if (d.reward_xp > 0) parts.push('+' + d.reward_xp + ' XP'); if (d.reward_ac > 0) parts.push('+' + d.reward_ac + ' APEX Credits');
                if (parts.length) setTimeout(function () { announce('POWER BONUS \u00B7 ' + parts.join(' \u00B7 '), false); }, 2400);
                payload(d);
            }).catch(function () { S.claimed = false; });
        };
        setTimeout(go, 800);
    }

    function step() {
        var ev = S.ev;
        if (!ev) return;
        var t = nowMs(), s = Date.parse(ev.starts_at), e = Date.parse(ev.ends_at), won = !!ev.won_at;
        var ph = t < s ? 'wait' : t >= e ? 'report' : won ? 'win' : 'run';
        if (ph !== S.phase) { var prev = S.phase; S.phase = ph; onPhase(ph, prev, t, s, e); }
        if (ph === 'wait') paintIncoming(s - t);
        else if (ph === 'run' || ph === 'win') paintHud(t);
    }

    function teardown(abort) {
        stopAllAudio(); stopLoop(); clearTimeout(S.tickT); clearTimeout(S.annT);
        closeWire(); removePad(); removeDead(); removeIncoming();
        ROOT.classList.remove('bo-shake');
        if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
        S.root = null; S.redSlot = null;
    }

    function resetFor(ev) {
        S.phase = 'none'; S.joined = false; S.joining = false; S.live = null; S.me = null; S.claimed = false; S.reportShown = false; S.seen = false;
        S.dead = ssGet('bo.dead.' + ev.id) === '1'; S.exp = 0; S.dangerVol = 0; S.wasRun = false; S.calm = reducedMotion();
        var stored = ssGet('bo.snd');
        if (stored === '1' || stored === '0') S.snd = stored === '1';
        else { try { if (window.SpecSound && typeof window.SpecSound.isEnabled === 'function') S.snd = !!window.SpecSound.isEnabled(); } catch (e) { /* ignore */ } }
    }

    // another live event is on screen: wait, so two events never fight over the page
    function busy() {
        try { var n = window.SpecNuke && window.SpecNuke.state && window.SpecNuke.state(); if (n && (n.phase === 'count' || n.phase === 'after')) return true; } catch (e) { /* ignore */ }
        try { var g = window.SpecGlitch && window.SpecGlitch.state && window.SpecGlitch.state(); if (g && (g.phase === 'run' || g.phase === 'outro')) return true; } catch (e) { /* ignore */ }
        return false;
    }

    function setEvent(ev) {
        if (!S.ev && busy()) return;
        ev.audio = ev.audio || {}; ev.pages = ev.pages || [];
        var isNew = !S.ev || S.ev.id !== ev.id;
        if (isNew && S.ev) { teardown(true); if (S.rep && S.rep.parentNode) S.rep.parentNode.removeChild(S.rep); }
        if (!isNew) { ev.ends_at = S.ev.won_at ? S.ev.ends_at : ev.ends_at; ev.won_at = ev.won_at || S.ev.won_at; }
        S.ev = ev;
        if (isNew) resetFor(ev);
        if (!S.loop) S.loop = setInterval(step, 200);
        step();
    }
    function endNow(announceIt) {
        if (S.loop) { clearInterval(S.loop); S.loop = 0; }
        teardown(true);
        if (S.rep && S.rep.parentNode) { S.rep.parentNode.removeChild(S.rep); S.rep = null; }
        S.ev = null; S.phase = 'none'; ssDel('bo.ev');
        if (announceIt) toast('The blackout was called off by staff. Back to normal.');
    }

    /* ------------------------------ polling ------------------------------ */
    function handle(d, t0) {
        if (S.preview) return;
        var t1 = Date.now();
        if (d && d.now) S.off = Date.parse(d.now) - (t0 + t1) / 2;
        var ev = d && d.event;
        if (!ev) {
            ssDel('bo.ev');
            if (S.ev) { var over = Date.parse(S.ev.ends_at) <= nowMs(); endNow(!over && (S.phase === 'run' || S.phase === 'win')); }
            return;
        }
        ssSet('bo.ev', JSON.stringify({ ev: ev, off: S.off }));
        setEvent(ev);
    }
    function poll() {
        if (S.preview || document.hidden) return Promise.resolve();
        var t0 = Date.now();
        return plainRpc('site_blackout_now', {}).then(function (d) { handle(d, t0); }).catch(function () { /* offline, or the SQL is not installed: stay quiet */ });
    }
    function schedule() {
        clearTimeout(S.pollT);
        var ms = 30000;
        if (S.ev) { var t = nowMs(); if (Date.parse(S.ev.starts_at) - t < 120000 && Date.parse(S.ev.ends_at) + 600000 > t) ms = 5000; }
        S.pollT = setTimeout(function () { poll().then(schedule, schedule); }, ms);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !S.preview) { poll(); if (S.ev) tick(true); } });
    window.addEventListener('resize', function () { if (S.pad) syncPad(); paintSoundBtn(); });

    /* ------------------------------ preview (staff, local only) ------------------------------ */
    function pvFix() {
        var P = S.pv; P.fixed++; P.total++;
        var won = P.total >= P.goal;
        S.me.fixed = P.fixed; S.me.here = false; S.me.hint = null; P.coolUntil = Date.now() + 6000;
        return { fixed: P.fixed, quota: P.quota, total: P.total, won: won, reward_xp: 0, reward_ac: 0 };
    }
    function pvClaim() { setTimeout(function () { announce('PREVIEW \u00B7 no rewards are paid', false); }, 2400); }
    function pvLive() {
        var P = S.pv; if (!P || !S.ev || S.phase === 'report') return;
        var t = Date.now();
        if (S.phase === 'run') {
            if (Math.random() < 0.45 && P.total < P.goal - 1) P.total++;
            if (!S.me.here && !S.dead && P.fixed < P.quota && t >= P.coolUntil) S.me.here = true;
            if (!S.me.hint && !S.dead && P.fixed < P.quota && (t - P.last) > 25000) S.me.hint = PAGE;
        }
        S.me.exposure = S.exp;
        onLive({ ok: true, now: new Date(nowMs()).toISOString(), ends_at: S.ev.ends_at, won_at: S.ev.won_at || null, goal: P.goal, fixed_total: P.total, players: 9, alive: S.dead ? 7 : 8, dead: S.dead ? 2 : 1, me: S.me,
            top: [{ u: 'you', fixed: P.fixed, pts: P.fixed * 100, dead: S.dead, me: true }, { u: 'aspec_404', fixed: 3, pts: 300, dead: false }, { u: 'solarnamer', fixed: 2, pts: 200, dead: false }, { u: 'sleepyuser', fixed: 1, pts: 100, dead: true }] });
    }
    function startPreview() {
        S.preview = true; clearTimeout(S.pollT);
        if (S.loop) { clearInterval(S.loop); S.loop = 0; }
        teardown(true);
        var cfg = {}; try { cfg = JSON.parse(lsGet('bo.preview.cfg') || '{}') || {}; } catch (e) { cfg = {}; }
        var n = Date.now(), goal = 6, dur = 180;
        S.pv = { goal: goal, total: 0, fixed: 0, quota: 3, coolUntil: 0, last: n };
        S.me = { joined: true, dead: false, fixed: 0, quota: 3, here: true, hint: null, exposure: 0, cool: 0 };
        S.off = 0; S.user = null;
        setEvent({ id: 'preview', label: 'Preview', starts_at: new Date(n + 3000).toISOString(), ends_at: new Date(n + 3000 + dur * 1000).toISOString(), duration_s: dur, goal: goal, per_player_max: 3,
            red_level: cfg.red_level || 3, red_kill_s: cfg.red_kill_s || 5, hint_after_s: 25, pages: [PAGE, 'preview-a', 'preview-b'], seed: 4242, volume: cfg.volume != null ? cfg.volume : 70, audio: cfg.audio || {} });
        S.dead = false; S.exp = 0;
        setInterval(pvLive, 1000);
    }

    window.SpecBlackout = { preview: startPreview, state: function () { return { phase: S.phase, dead: S.dead, fixed: S.me ? S.me.fixed : 0, preview: S.preview }; } };

    function boot() {
        if (PREVIEW) { startPreview(); return; }
        try {
            var c = JSON.parse(ssGet('bo.ev') || 'null');       // instant dark on page change: no flash of light while we ask the server
            if (c && c.ev && Date.parse(c.ev.ends_at) + 60000 > Date.now() + (c.off || 0)) { S.off = c.off || 0; setEvent(c.ev); }
        } catch (e) { /* ignore */ }
        poll().then(schedule, schedule);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
