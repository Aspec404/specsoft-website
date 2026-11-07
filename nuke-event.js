/* ==========================================================================
   SPECSOFT® nuke-event.js  -  the NUKE EVENT, live and synced for every visitor

   Loaded automatically by seasons.js on every page that has seasons.js (nothing else to add).
   Skipped on admin.html and login.html, and on any page whose <html> has data-nuke-off.

   How it works
     * Every 30s (5s when an event is near) the page asks the database: site_nuke_now().
       The answer carries SERVER time, so every countdown matches no matter when you joined.
     * Phases, all computed from the server clock:
         wait   small "incoming" bar in the last 30s
         count  red alarm, rushing effects, big timer, T-1:00 + 0:15 announcements, SAFE PAD tapper
         after  white flash + shake at 0:00, then darkness + a flashlight cursor, page pieces fall off
         report ending screen: logo, occurred / ended, @username [ ALIVE ] / [ MISSING ]
     * Survival is decided by the SERVER (nuke_pad_finish). Rewards are paid in the database.
     * Nothing is deleted: the "destruction" is only CSS transforms and everything is restored.
   Sound: only plays when the visitor has sound ON (speaker toggle) or taps the sound button.
   Reduce motion (OS setting or Settings page) turns on a calm version: no strobe, shake or falling.

   Staff preview (nobody else sees it, no rewards): open  index.html#nuke-preview
   Public API: window.SpecNuke { preview(), state() }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecNuke) return;

    var ROOT = document.documentElement;
    var PATH = (location.pathname || '').toLowerCase();
    var PREVIEW = location.hash === '#nuke-preview';
    if (/(^|\/)(admin|login)(\.html)?$/.test(PATH) || ROOT.hasAttribute('data-nuke-off')) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    var CSS_URL = SELF ? SELF.replace(/nuke-event\.js(\?.*)?$/, 'nuke-event.css$1') : 'nuke-event.css';
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var CALM_KEY = 'specsoft.nuke.calm';
    var TILES = 20, GOAL = 250;     // must match nuke_pad_finish in supabase-nuke.sql

    var S = {
        ev: null, off: 0, phase: 'none', loop: 0, pollT: 0, preview: false,
        user: null, safe: false, hits: 0, glow: -1, joined: false, padStarted: false, finishing: false,
        ann60: false, ann15: false, calm: false, snd: false, blocked: false, auds: {},
        root: null, dark: null, inc: null, rep: null, falls: [], destroyed: false, seen: false, reportShown: false,
        light: null, annT: 0
    };

    /* ------------------------------ small helpers ------------------------------ */
    function nowMs() { return Date.now() + S.off; }
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    function mmss(sec) { sec = Math.max(0, Math.floor(sec)); return p2(Math.floor(sec / 60)) + ':' + p2(sec % 60); }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* blocked */ } }
    function small() { return innerWidth < 700; }

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
        if (document.getElementById('nk-css')) return;
        var l = document.createElement('link');
        l.id = 'nk-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
        (document.head || ROOT).appendChild(l);
    }

    function toast(msg) {
        ensureCss();
        var t = document.createElement('div'); t.className = 'nk-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
        ROOT.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5200);
    }

    /* ------------------------------ data ------------------------------ */
    function plainRpc(name, args) {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + name, {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(args || {}), cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('nuke ' + r.status); return r.json(); });
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
    function synthBoom() {
        var c = ac();
        if (!c) return;
        try {
            if (c.state === 'suspended') c.resume();
            var len = Math.floor(c.sampleRate * 2.4), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
            for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
            var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
            src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 420; g.gain.value = 0.9 * (vol() / 0.9);
            src.connect(f); f.connect(g); g.connect(c.destination); src.start();
        } catch (e) { /* ignore */ }
    }
    function beeps() {
        var c = ac();
        if (!c) return;
        try {
            if (c.state === 'suspended') c.resume();
            for (var i = 0; i < 3; i++) {
                var o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + i * 0.28;
                o.type = 'square'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t0);
                g.gain.exponentialRampToValueAtTime(0.06 * (vol() / 0.9), t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
                o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.22);
            }
        } catch (e) { /* ignore */ }
    }
    function speak(text) {
        try {
            if (!window.speechSynthesis) return;
            var u = new SpeechSynthesisUtterance(text); u.rate = 0.95; u.pitch = 0.8; u.volume = Math.min(1, vol() + 0.1);
            window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
        } catch (e) { /* ignore */ }
    }
    function phaseAudio() {
        if (!S.snd || !S.ev) return;
        S.blocked = false;
        var t = nowMs(), s = Date.parse(S.ev.starts_at), b = Date.parse(S.ev.boom_at), a = S.ev.audio || {};
        if (S.phase === 'count') {
            if (a.ost && !S.auds.ost) track('ost', a.ost, true, (t - s) / 1000);
            if (a.alarm && !S.auds.alarm) track('alarm', a.alarm, true, (t - s) / 1000);
        } else if (S.phase === 'after') {
            if (a.after && !S.auds.after) track('after', a.after, true, (t - b) / 1000);
        }
        paintSoundBtn();
    }
    function stopAllAudio() { stopTrack('ost'); stopTrack('boom'); stopTrack('after'); stopTrack('alarm'); try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    function setSound(on) {
        S.snd = !!on;
        if (S.snd) { var c = ac(); if (c && c.state === 'suspended') c.resume(); phaseAudio(); }
        else stopAllAudio();
        paintSoundBtn();
    }
    function paintSoundBtn() {
        if (!S.root) return;
        var b = S.root.querySelector('[data-a="snd"]');
        if (b) b.textContent = S.snd ? '\uD83D\uDD0A SOUND ON' : '\uD83D\uDD07 SOUND OFF';
    }
    document.addEventListener('pointerdown', function () { if (S.snd && S.blocked) phaseAudio(); }, true);

    /* ------------------------------ layout ------------------------------ */
    function mount() {
        if (S.root) return;
        ensureCss();
        var r = document.createElement('div'); r.id = 'nk-root'; r.setAttribute('data-nk', '');
        S.root = r; ROOT.appendChild(r);
        r.addEventListener('click', onClick);
        r.addEventListener('pointerdown', onDown);
        S.seen = true;
    }
    function rootClass(extra) { S.root.className = (S.calm ? 'nk-calm ' : '') + (extra || ''); }

    function padHtml() {
        var b = '';
        for (var i = 0; i < TILES; i++) b += '<button type="button" class="nk-tile" data-i="' + i + '" aria-label="Tile ' + (i + 1) + '"></button>';
        return '<div class="nk-pad-head"><b>SAFE PAD</b><span data-count>0/' + GOAL + '</span><button type="button" class="nk-mini" data-a="padx" aria-label="Close pad">\u00D7</button></div>' +
            '<div class="nk-prog"><i data-prog></i></div><div class="nk-grid" data-grid>' + b + '</div><div class="nk-pad-note" data-note></div>';
    }

    // ADRENALINE SURGE: streaks shoot outward from the centre (random angle / length / speed) + two shock rings
    function rushHtml() {
        var h = '<div class="nk-rush"><b></b><b class="r2"></b>', n = 30;
        for (var i = 0; i < n; i++) {
            var a = (i * (360 / n) + rand(-6, 6)).toFixed(1), l = rand(10, 26).toFixed(1), t = rand(0.55, 1.25).toFixed(2), d = rand(0, 1.2).toFixed(2), w = rand(1.5, 3.4).toFixed(1);
            h += '<i style="--a:' + a + 'deg;--l:' + l + 'vmin;--t:' + t + 's;--d:-' + d + 's;--w:' + w + 'px"></i>';
        }
        return h + '</div>';
    }

    function renderCount() {
        mount(); rootClass('');
        S.root.innerHTML =
            '<div class="nk-alarm"></div><div class="nk-rays"></div>' + rushHtml() + '<div class="nk-pulse"></div><div class="nk-glitch"><i></i><i></i><i></i></div>' +
            '<div class="nk-hud"><div class="nk-stripe"></div><div class="nk-top"><span class="nk-tag" data-tag>\u2622 NUCLEAR STRIKE INBOUND</span><button type="button" class="nk-mini" data-a="snd"></button></div>' +
            '<div class="nk-time" data-time>--:--</div><div class="nk-sub">TIME TO IMPACT</div><div class="nk-meter"><i data-meter></i></div>' +
            '<div class="nk-actions"><button type="button" class="nk-btn" data-a="pad">SHOW SAFE PAD</button><span class="nk-safe" data-safe hidden>\uD83D\uDEE1 YOU ARE SAFE</span></div>' +
            '<div class="nk-reward" data-reward></div></div>' +
            '<div class="nk-pad" data-pad hidden>' + padHtml() + '</div>' +
            '<div class="nk-warn" data-warn>\u26A0 Flashing lights and loud sound. <button type="button" data-a="calm">Reduce effects</button><button type="button" data-a="warnx" aria-label="Dismiss">\u00D7</button></div>' +
            '<div class="nk-ann" data-ann role="status" aria-live="assertive"></div><div class="nk-flash" data-flash></div>';
        var ev = S.ev, rw = [];
        if (ev.reward_xp > 0) rw.push('+' + ev.reward_xp + ' XP');
        if (ev.reward_ac > 0) rw.push('+' + ev.reward_ac + ' APEX Credits');
        S.root.querySelector('[data-reward]').textContent = S.preview ? 'PREVIEW \u00B7 nobody else sees this \u00B7 no rewards' : (rw.length ? 'SURVIVE TO EARN ' + rw.join(' \u00B7 ') : 'HIT ' + GOAL + ' TILES ON THE SAFE PAD TO SURVIVE');
        if (S.preview) S.root.querySelector('[data-tag]').textContent = '\u2622 PREVIEW \u00B7 NUCLEAR STRIKE';
        paintSoundBtn(); paintPad(); paintSafe();
    }

    function renderAfter(late) {
        mount(); S.root.innerHTML = '';
        var spared = S.safe && S.ev.spare;
        rootClass('nk-after' + (spared ? ' nk-bunker' : ''));
        var html = '';
        if (!spared && !S.calm) { html += '<div class="nk-ash">'; for (var i = 0; i < 22; i++) html += '<i style="left:' + rand(0, 100).toFixed(1) + '%;animation-delay:-' + rand(0, 9).toFixed(1) + 's;animation-duration:' + rand(6, 12).toFixed(1) + 's"></i>'; html += '</div>'; }
        html += '<div class="nk-afterbar" data-bar></div><div class="nk-flash" data-flash></div>';
        S.root.innerHTML = html;
        if (!late) {
            var f = S.root.querySelector('[data-flash]'); void f.offsetWidth; f.classList.add('go');
            if (!S.calm) { ROOT.classList.add('nk-shake'); setTimeout(function () { ROOT.classList.remove('nk-shake'); }, 1500); }
        }
        if (!spared) { startLight(); setTimeout(destroy, late ? 200 : 450); }
    }

    /* ------------------------------ clicks ------------------------------ */
    function onClick(e) {
        var tile = e.target.closest && e.target.closest('.nk-tile');
        if (tile) { if (e.detail === 0) tap(+tile.getAttribute('data-i')); return; }      // keyboard only: pointerdown handles mouse and touch
        var a = e.target.closest && e.target.closest('[data-a]');
        if (!a) return;
        var k = a.getAttribute('data-a');
        if (k === 'pad') togglePad(true);
        else if (k === 'padx') togglePad(false);
        else if (k === 'snd') setSound(!S.snd);
        else if (k === 'calm') { S.calm = true; lsSet(CALM_KEY, '1'); if (S.root) S.root.classList.add('nk-calm'); var w = S.root.querySelector('[data-warn]'); if (w) w.hidden = true; }
        else if (k === 'warnx') { var w2 = S.root.querySelector('[data-warn]'); if (w2) w2.hidden = true; }
    }
    function onDown(e) {
        var tile = e.target.closest && e.target.closest('.nk-tile');
        if (!tile) return;
        e.preventDefault();
        tap(+tile.getAttribute('data-i'));
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.root) togglePad(false); });

    /* ------------------------------ the tapper ------------------------------ */
    function padKey() { return 'nk.hits.' + (S.ev ? S.ev.id : ''); }
    function togglePad(open) {
        if (!S.root || S.phase !== 'count') return;
        var p = S.root.querySelector('[data-pad]');
        if (!p) return;
        p.hidden = !open;
        if (!open) return;
        if (S.glow < 0) nextGlow();
        if (!S.padStarted) {
            S.padStarted = true;
            loadUser().then(function (u) {
                var n = S.root && S.root.querySelector('[data-note]');
                if (!S.preview && u) rpc('nuke_pad_start', { p_event: S.ev.id }).catch(function () { /* ignore */ });
                if (n && !S.safe) n.textContent = S.preview ? 'Preview: practice only.' : (u ? 'Hit the glowing tile. ' + GOAL + ' hits before 0:00 and you are safe.' : 'Practice mode: log in to be counted as ALIVE and earn rewards.');
            });
        }
        paintPad();
    }
    function nextGlow() { var n; do { n = Math.floor(Math.random() * TILES); } while (n === S.glow && TILES > 1); S.glow = n; }
    function paintPad() {
        if (!S.root) return;
        var c = S.root.querySelector('[data-count]');
        if (c) c.textContent = Math.min(S.hits, GOAL) + '/' + GOAL;
        var pg = S.root.querySelector('[data-prog]');
        if (pg) pg.style.width = (Math.min(S.hits, GOAL) / GOAL * 100).toFixed(1) + '%';
        var nt = S.root.querySelector('[data-note]');
        if (nt && S.hits > 0 && !S.safe && !S.finishing) {
            var pc = S.hits / GOAL;
            var msg = pc >= 0.9 ? 'ALMOST THERE. DO NOT STOP.' : pc >= 0.75 ? '75% DONE. KEEP GOING.' : pc >= 0.5 ? 'HALFWAY. FASTER.' : pc >= 0.25 ? '25% DONE. KEEP TAPPING.' : '';
            if (msg) nt.textContent = msg;
        }
        var tiles = S.root.querySelectorAll('.nk-tile');
        for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('is-glow', i === S.glow);
    }
    function paintSafe() {
        if (!S.root) return;
        var b = S.root.querySelector('[data-a="pad"]'), s = S.root.querySelector('[data-safe]');
        if (b) b.hidden = !!S.safe;
        if (s) s.hidden = !S.safe;
        if (S.safe) { var p = S.root.querySelector('[data-pad]'); if (p) p.hidden = true; }
    }
    function tap(i) {
        if (S.safe || S.finishing || S.phase !== 'count' || !S.root) return;
        if (i === S.glow) {
            S.hits++; ssSet(padKey(), String(S.hits));
            if (window.SpecSound && S.snd) { try { window.SpecSound.play('click'); } catch (e) { /* ignore */ } }
            var ht = S.root.querySelectorAll('.nk-tile')[i];
            if (ht && !S.calm) { ht.classList.remove('is-hit'); void ht.offsetWidth; ht.classList.add('is-hit'); setTimeout(function () { ht.classList.remove('is-hit'); }, 260); }
            if (S.hits >= GOAL) { paintPad(); finish(); return; }
            nextGlow();
        } else {
            var t = S.root.querySelectorAll('.nk-tile')[i];
            if (t) { t.classList.add('is-miss'); setTimeout(function () { t.classList.remove('is-miss'); }, 260); }
        }
        paintPad();
    }
    function padMessage(html) {
        var p = S.root && S.root.querySelector('[data-pad]');
        if (p) p.innerHTML = html;
    }
    function finish() {
        S.finishing = true;
        padMessage('<div class="nk-pad-done"><span>VERIFYING...</span></div>');
        if (S.preview || !S.user) { done(null); return; }
        rpc('nuke_pad_finish', { p_event: S.ev.id, p_hits: S.hits }).then(function (d) { done(d); }).catch(function (err) {
            var m = String((err && err.message) || '');
            S.finishing = false;
            var text = /too_fast/.test(m) ? 'The server says that run was too fast to be real. Try again.'
                : /too_late/.test(m) ? 'Too late. The strike already hit.'
                : /not_signed_in/.test(m) ? 'Log in first so the server can count you.'
                : 'Could not reach the server. Try once more.';
            S.hits = 0; ssSet(padKey(), '0'); S.glow = -1;
            padMessage(padHtml());
            var n = S.root && S.root.querySelector('[data-note]'); if (n) n.textContent = text;
            nextGlow(); paintPad();
        });
    }
    function done(d) {
        S.finishing = false; S.safe = true; ssSet('nk.safe.' + S.ev.id, '1');
        var parts = [];
        if (d && d.reward_xp > 0) parts.push('+' + d.reward_xp + ' XP');
        if (d && d.reward_ac > 0) parts.push('+' + d.reward_ac + ' APEX Credits');
        var practice = !d;
        padMessage('<div class="nk-pad-done"><b>SAFE</b><span>' + (practice ? (S.preview ? 'Preview complete.' : 'Practice complete. Log in next time to be counted.') : (parts.length ? 'Rewards: ' + parts.join(' \u00B7 ') : 'You will be listed as ALIVE.')) + '</span></div>');
        setTimeout(function () { var p = S.root && S.root.querySelector('[data-pad]'); if (p) p.hidden = true; }, 3200);
        paintSafe();
        if (d) {
            try { if (window.ApexCredits) { if (d.balance != null && window.ApexCredits.set) window.ApexCredits.set(d.balance); else window.ApexCredits.refresh(); } } catch (e) { /* ignore */ }
            try { if (window.SpecXP) { if (d.xp && window.SpecXP.set) window.SpecXP.set(d.xp); else window.SpecXP.refresh(); } } catch (e) { /* ignore */ }
        }
    }

    /* ------------------------------ announcements + timer ------------------------------ */
    function announce(text, voice) {
        if (!S.root) return;
        var a = S.root.querySelector('[data-ann]');
        if (a) { a.textContent = text; a.classList.add('is-on'); clearTimeout(S.annT); S.annT = setTimeout(function () { a.classList.remove('is-on'); }, 3800); }
        if (S.snd) { beeps(); if (voice) speak(voice); }
    }
    function paintCount(left) {
        if (!S.root) return;
        var tm = S.root.querySelector('[data-time]');
        if (tm) tm.textContent = mmss(left);
        var mt = S.root.querySelector('[data-meter]');
        if (mt && S.ev.countdown_s) mt.style.width = Math.max(0, Math.min(100, left / S.ev.countdown_s * 100)).toFixed(1) + '%';
        S.root.classList.toggle('nk-t60', left <= 60 && left > 15);
        S.root.classList.toggle('nk-t15', left <= 15);
        if (!S.ann60 && S.ev.countdown_s > 60 && left <= 60) { S.ann60 = true; announce('T-MINUS 1 MINUTE', 'One minute to impact.'); }
        if (!S.ann15 && left <= 15) { S.ann15 = true; announce('IMPACT IN 15 SECONDS', 'Fifteen seconds.'); }
    }

    /* ------------------------------ aftermath: flashlight + destruction ------------------------------ */
    function startLight() {
        stopLight();
        var d = document.createElement('div'); d.id = 'nk-dark'; ROOT.appendChild(d);
        if (S.calm) ROOT.classList.add('nk-calm-page');
        S.dark = d;
        S.light = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2, moved: false, raf: 0 };
        window.addEventListener('pointermove', onMove, { passive: true });
        S.light.raf = requestAnimationFrame(lightLoop);
    }
    function onMove(e) { if (!S.light) return; S.light.tx = e.clientX; S.light.ty = e.clientY; S.light.moved = true; }
    function lightLoop(ts) {
        var L = S.light;
        if (!L || !S.dark) return;
        L.raf = requestAnimationFrame(lightLoop);
        if (!L.moved) { L.tx = innerWidth / 2 + Math.cos(ts / 1800) * innerWidth * 0.25; L.ty = innerHeight / 2 + Math.sin(ts / 1300) * innerHeight * 0.2; }
        L.x += (L.tx - L.x) * 0.35; L.y += (L.ty - L.y) * 0.35;
        var base = S.calm ? (small() ? 150 : 250) : (small() ? 115 : 200);
        var fl = S.calm ? 1 : 1 + Math.sin(ts / 90) * 0.025 + (Math.random() < 0.025 ? -0.22 : 0);
        S.dark.style.setProperty('--fx', L.x.toFixed(1) + 'px');
        S.dark.style.setProperty('--fy', L.y.toFixed(1) + 'px');
        S.dark.style.setProperty('--fr', (base * fl).toFixed(1) + 'px');
    }
    function stopLight() {
        window.removeEventListener('pointermove', onMove);
        if (S.light && S.light.raf) cancelAnimationFrame(S.light.raf);
        S.light = null;
        if (S.dark && S.dark.parentNode) S.dark.parentNode.removeChild(S.dark);
        S.dark = null;
        ROOT.classList.remove('nk-calm-page');
    }

    var SKIP = '#nk-root,#nk-dark,#nk-inc,#nk-report,.nk-toast,.ss-toggle,#ss-back,#ss-front,[id*="cursor"],[class*="cursor"],canvas,video,iframe,script,style,link,dialog,[data-nuke-keep]';
    var PICK = 'h1,h2,h3,h4,h5,p,li,img,svg,button,figure,table,form,nav,aside,section>div,[class*="card"],[class*="panel"],[class*="tile"],[class*="btn"],[class*="item"],[class*="banner"]';

    function pickTargets() {
        var all = [], nodes, vw = innerWidth, vh = innerHeight;
        try { nodes = document.body.querySelectorAll(PICK); } catch (e) { return all; }
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (el.closest(SKIP)) continue;
            var r = el.getBoundingClientRect();
            if (r.width < 18 || r.height < 14 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
            if (r.width * r.height > vw * vh * 0.4) continue;
            var cs = getComputedStyle(el);
            if (cs.display === 'inline' || cs.display === 'none' || cs.visibility === 'hidden') continue;
            all.push(el);
        }
        for (var j = all.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)), t = all[j]; all[j] = all[k]; all[k] = t; }
        var max = small() ? 34 : 64, out = [];
        for (var n = 0; n < all.length && out.length < max; n++) {
            var c = all[n], clash = false;
            for (var m = 0; m < out.length; m++) { if (out[m].contains(c) || c.contains(out[m])) { clash = true; break; } }
            if (!clash) out.push(c);
        }
        return out;
    }

    function destroy() {
        if (S.calm || S.destroyed || S.phase !== 'after') return;
        S.destroyed = true;
        var list = pickTargets(), vh = innerHeight;
        list.forEach(function (el) {
            S.falls.push({ el: el, style: el.getAttribute('style') });
            var mode = Math.random(), tx, ty, rot, op, dur;
            var r = el.getBoundingClientRect();
            if (mode < 0.55) { ty = Math.max(60, (vh - r.top) * rand(0.45, 1) + rand(0, 90)); tx = rand(-240, 240); rot = rand(-110, 110); op = rand(0.35, 1); dur = rand(1.0, 2.4); }
            else if (mode < 0.8) { ty = rand(8, 70); tx = rand(-30, 30); rot = rand(-16, 16); op = 1; dur = rand(0.3, 0.8); }
            else { ty = rand(-20, 40); tx = rand(-60, 60); rot = rand(-40, 40); op = rand(0.25, 0.6); dur = rand(0.5, 1.2); }
            var delay = Math.pow(Math.random(), 1.8) * 20;
            el.style.willChange = 'transform';
            el.style.transition = 'transform ' + dur.toFixed(2) + 's cubic-bezier(.55,.02,.85,.45) ' + delay.toFixed(2) + 's, opacity ' + dur.toFixed(2) + 's linear ' + delay.toFixed(2) + 's';
            el.style.transform = 'translate(' + tx.toFixed(0) + 'px,' + ty.toFixed(0) + 'px) rotate(' + rot.toFixed(0) + 'deg)';
            el.style.opacity = op.toFixed(2);
        });
    }
    function putBack(x) { if (x.style === null) x.el.removeAttribute('style'); else x.el.setAttribute('style', x.style); }
    function restore(fast) {
        var f = S.falls; S.falls = []; S.destroyed = false;
        if (!f.length) return;
        if (fast) { f.forEach(putBack); return; }
        f.forEach(function (x) { x.el.style.transition = 'transform .9s cubic-bezier(.2,.8,.2,1), opacity .9s'; x.el.style.transform = ''; x.el.style.opacity = ''; });
        setTimeout(function () { f.forEach(putBack); }, 1100);
    }

    /* ------------------------------ ending screen ------------------------------ */
    function showReport() {
        var ev = S.ev;
        if (!ev || S.reportShown) return;
        S.reportShown = true;
        ensureCss();
        var wrap = document.createElement('div'); wrap.id = 'nk-report'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Event report');
        var card = document.createElement('div'); card.className = 'nk-rep';
        var img = document.createElement('img'); img.src = 'logo.png'; img.alt = ''; img.onerror = function () { img.style.display = 'none'; };
        var h = document.createElement('h2'); h.textContent = 'SPECSOFT\u00AE EVENT REPORT';
        var sub = document.createElement('p'); sub.className = 'nk-rep-sub'; sub.textContent = (ev.label || 'NUCLEAR STRIKE').toUpperCase();
        var dl = document.createElement('dl');
        function row(k, v) { var dt = document.createElement('dt'); dt.textContent = k; var dd = document.createElement('dd'); dd.textContent = v; dl.appendChild(dt); dl.appendChild(dd); }
        row('OCCURRED', fmtDT(Date.parse(ev.boom_at)));
        row('ENDED', fmtDT(Date.parse(ev.ends_at)));
        var count = document.createElement('div'); count.className = 'nk-rep-count';
        var list = document.createElement('div'); list.className = 'nk-rep-list';
        var load = document.createElement('div'); load.className = 'nk-rep-empty'; load.textContent = 'Loading survival log...'; list.appendChild(load);
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'nk-btn'; btn.textContent = 'CONTINUE';
        btn.addEventListener('click', function () {
            lsSet('nk.done.' + ev.id, '1');
            wrap.classList.remove('is-on');
            setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); S.rep = null; }, 700);
        });
        card.appendChild(img); card.appendChild(h); card.appendChild(sub); card.appendChild(dl); card.appendChild(count); card.appendChild(list); card.appendChild(btn);
        wrap.appendChild(card); ROOT.appendChild(wrap); S.rep = wrap;
        requestAnimationFrame(function () { wrap.classList.add('is-on'); });
        setTimeout(function () { try { btn.focus(); } catch (e) { /* ignore */ } }, 800);

        function fill(d) {
            list.innerHTML = '';
            if (!d || d.ok === false) { var m = document.createElement('div'); m.className = 'nk-rep-empty'; m.textContent = 'The survival log is not available right now.'; list.appendChild(m); return; }
            count.innerHTML = '';
            function card(cls, num, label) {
                var c = document.createElement('div'); c.className = 'nk-rep-card ' + cls;
                var b = document.createElement('b'); b.textContent = String(num);
                var s = document.createElement('span'); s.textContent = label;
                c.appendChild(b); c.appendChild(s); return c;
            }
            count.appendChild(card('a', d.alive, 'ALIVE')); count.appendChild(card('m', d.missing, 'MISSING'));
            if (!d.players || !d.players.length) { var e0 = document.createElement('div'); e0.className = 'nk-rep-empty'; e0.textContent = 'Nobody signed in was here for this one.'; list.appendChild(e0); return; }
            d.players.forEach(function (p) {
                var r = document.createElement('div'); r.className = 'nk-rep-row ' + (p.alive ? 'is-alive' : 'is-missing') + (p.me ? ' is-me' : '');
                var n = document.createElement('span'); n.className = 'n'; n.textContent = '@' + p.u;
                var s = document.createElement('span'); s.className = 's'; s.textContent = p.alive ? '[ ALIVE ]' : '[ MISSING ]';
                r.appendChild(n); r.appendChild(s); list.appendChild(r);
            });
        }
        if (S.preview) {
            fill({ ok: true, alive: 3, missing: 2, players: [{ u: 'you', alive: true, me: true }, { u: 'aspec_404', alive: true }, { u: 'solarnamer', alive: true }, { u: 'sleepyuser', alive: false }, { u: 'afk_andy', alive: false }] });
            return;
        }
        var c = client();
        var p = c ? rpc('nuke_report', { p_event: ev.id }) : plainRpc('nuke_report', { p_event: ev.id });
        p.then(fill).catch(function () { plainRpc('nuke_report', { p_event: ev.id }).then(fill).catch(function () { fill(null); }); });
    }

    /* ------------------------------ phases ------------------------------ */
    function joinEvent() {
        if (S.preview || S.joined || !S.ev) return;
        loadUser().then(function (u) {
            if (!u || S.joined || !S.ev) return;
            S.joined = true;
            rpc('nuke_join', { p_event: S.ev.id }).then(function (d) {
                if (d && d.safe && !S.safe) { S.safe = true; ssSet('nk.safe.' + S.ev.id, '1'); if (S.phase === 'count') paintSafe(); }
            }).catch(function () { S.joined = false; });
        });
    }

    function paintIncoming(ms) {
        if (ms > 30000) { if (S.inc) { if (S.inc.parentNode) S.inc.parentNode.removeChild(S.inc); S.inc = null; } return; }
        if (!S.inc) { ensureCss(); S.inc = document.createElement('div'); S.inc.id = 'nk-inc'; S.inc.setAttribute('role', 'status'); ROOT.appendChild(S.inc); }
        S.inc.textContent = '\u26A0 ALERT: NUCLEAR STRIKE DETECTED \u00B7 COUNTDOWN IN ' + Math.ceil(ms / 1000) + 's';
    }
    function removeIncoming() { if (S.inc && S.inc.parentNode) S.inc.parentNode.removeChild(S.inc); S.inc = null; }

    function onPhase(ph, prev, t, s, b, e) {
        S.calm = reducedMotion();
        if (ph === 'count') {
            removeIncoming();
            var left = Math.ceil((b - t) / 1000);
            S.ann60 = left < 58; S.ann15 = left < 14;
            renderCount(); joinEvent();
            if (S.snd) phaseAudio();
        } else if (ph === 'after') {
            removeIncoming();
            var late = (t - b) > 3500;
            renderAfter(late); joinEvent();
            if (!late) {
                stopTrack('ost', true); stopTrack('alarm', true);
                if (S.snd) { var a = S.ev.audio || {}; if (a.boom) track('boom', a.boom, false, 0); else synthBoom(); }
            } else { stopTrack('ost'); stopTrack('alarm'); }
            if (S.snd) phaseAudio();
        } else if (ph === 'report') {
            var wasIn = S.seen;
            teardown(false);
            if ((wasIn || (t - e) < 180000) && !lsGet('nk.done.' + S.ev.id)) showReport();
        } else if (ph === 'wait') { /* paintIncoming runs each step */ }
    }

    function step() {
        var ev = S.ev;
        if (!ev) return;
        var t = nowMs(), s = Date.parse(ev.starts_at), b = Date.parse(ev.boom_at), e = Date.parse(ev.ends_at);
        var ph = t < s ? 'wait' : t < b ? 'count' : t < e ? 'after' : 'report';
        if (ph !== S.phase) { var prev = S.phase; S.phase = ph; onPhase(ph, prev, t, s, b, e); }
        if (ph === 'wait') paintIncoming(s - t);
        else if (ph === 'count') paintCount(Math.ceil((b - t) / 1000));
        else if (ph === 'after' && S.root) {
            var left = Math.ceil((e - t) / 1000), bar = S.root.querySelector('[data-bar]');
            if (bar) bar.textContent = (S.safe && ev.spare ? '\uD83D\uDEE1 SAFE IN THE BUNKER' : '\u2622 AFTERMATH') + ' \u00B7 SYSTEM RECOVERING IN ' + mmss(left);
            if (S.dark && left <= 6) S.dark.classList.add('is-dawn');
            if (left <= 3 && S.falls.length && !S.rebuilding) { S.rebuilding = true; restore(false); }
        }
    }

    function teardown(abort) {
        stopAllAudio(); stopLight();
        restore(!!abort);
        S.rebuilding = false;
        if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
        S.root = null;
        removeIncoming();
        ROOT.classList.remove('nk-shake');
    }

    function resetFor(ev) {
        S.phase = 'none'; S.joined = false; S.padStarted = false; S.finishing = false; S.glow = -1; S.reportShown = false;
        S.destroyed = false; S.rebuilding = false; S.seen = false; S.ann60 = false; S.ann15 = false;
        S.safe = ssGet('nk.safe.' + ev.id) === '1';
        S.hits = parseInt(ssGet('nk.hits.' + ev.id) || '0', 10) || 0;
        S.calm = reducedMotion();
    }

    function setEvent(ev) {
        ev.audio = ev.audio || {};
        var isNew = !S.ev || S.ev.id !== ev.id;
        if (isNew && S.ev) { teardown(true); if (S.rep && S.rep.parentNode) S.rep.parentNode.removeChild(S.rep); }
        S.ev = ev;
        if (isNew) {
            resetFor(ev);
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
        return plainRpc('site_nuke_now', {}).then(function (d) { handle(d, t0); }).catch(function () { /* offline, or the SQL is not installed: stay quiet */ });
    }
    function schedule() {
        clearTimeout(S.pollT);
        var ms = 30000;
        if (S.ev) { var t = nowMs(); if (Date.parse(S.ev.starts_at) - t < 120000 && Date.parse(S.ev.ends_at) + 600000 > t) ms = 5000; }
        S.pollT = setTimeout(function () { poll().then(schedule, schedule); }, ms);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !S.preview) poll(); });

    /* ------------------------------ preview (staff, local only) ------------------------------ */
    function startPreview() {
        S.preview = true; clearTimeout(S.pollT);
        if (S.loop) { clearInterval(S.loop); S.loop = 0; }
        teardown(true);
        var n = Date.now();
        setEvent({ id: 'preview', label: 'Preview', starts_at: new Date(n + 3000).toISOString(), boom_at: new Date(n + 3000 + 45000).toISOString(), ends_at: new Date(n + 3000 + 45000 + 30000).toISOString(),
            countdown_s: 45, aftermath_s: 30, spare: false, volume: 70, reward_xp: 0, reward_ac: 0, audio: {} });
        S.off = 0; S.safe = false; S.hits = 0;
    }

    window.SpecNuke = { preview: startPreview, state: function () { return { phase: S.phase, safe: S.safe, hits: S.hits, preview: S.preview }; } };

    function boot() { if (PREVIEW) startPreview(); else { poll().then(schedule, schedule); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
