/* ==========================================================================
   SPECSOFT® rain-event.js  -  the RAIN THEME EVENT (a "theme / chill" event, live and synced for everyone)
   Loaded by seasons.js, so no page needs another tag. Skips admin.html / login.html.
   Idles quietly (one tiny request every 30s) until staff launch an event in Console > Events > Rain.

   What it draws (one canvas, one requestAnimationFrame loop)
     - streak rain in 3 depth layers (far = short and faint, near = long and bright), leaning with a slow wind and gusts
     - splashes: a flattened ripple plus a few droplets where the rain lands
     - window glass: water beads that sit, grow, then slide down leaving a trail
     - or APEX Credits instead of rain: coins that spin and fall, and sparkle where they land
   Plus: cold dark tint, a flickering sodium lamp, fog, a flashlight cursor, rare lightning, and sound made in the browser.

   Built to stay light: counts scale with screen size and device, the loop pauses when the tab is hidden, drops to 30fps
   on weaker devices, and quietly lowers (then stops) the particles if the page ever struggles.
   Visitors: two small buttons (sound, and "what falls": rain or APEX Credits). Reduce motion = no particles, no lightning.

   Public API: window.SpecRain { active(), kind(), setKind('rain'|'credits'|''), preview(cfg), endPreview() }
               fires  window 'specrain'  with { active, kind }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecRain) return;
    if (/(^|\/)(admin|login)(\.html)?\/?$/i.test(location.pathname)) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    function sibling(name) { return SELF ? SELF.replace(/rain-event\.js(\?.*)?$/, name + '$1') : name; }
    var CSS_URL = sibling('rain-event.css');
    var COIN_URL = sibling('apex-credits.png').replace(/\?.*$/, '');
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var KIND_KEY = 'specsoft.rain.kind', PREVIEW_KEY = 'rn.preview.cfg';
    var root = document.documentElement;

    /* ------------------------------ helpers ------------------------------ */
    function rand(a, b) { return a + Math.random() * (b - a); }
    function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    // Ultra Reduce Motion hook: return true here when the visitor turned URM on (no particles, no flicker, no lightning).
    function lite() {
        try { return root.classList.contains('urm') || root.getAttribute('data-urm') === '1' || localStorage.getItem('specsoft.urm') === '1'; } catch (e) { return false; }
    }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
    function whenBody(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true }); }
    function div(cls) { var d = document.createElement('div'); d.className = cls; return d; }

    /* ------------------------------ state ------------------------------ */
    var S = { ev: null, id: null, active: false, preview: false, skew: 0, cfg: null, kind: 'rain' };
    var N = { root: null, canvas: null, flash: null, dark: null, btns: null, bSnd: null, bKind: null, css: null, greet: null, prev: null };
    var T = { poll: 0, start: 0, end: 0, bolt: 0, thunder: 0, greet: 0 };
    var lightMode = false, themeObs = null;

    /* ------------------------------ canvas engine ------------------------------ */
    var FX = { on: false, ctx: null, w: 0, h: 0, dpr: 1, raf: 0, last: 0, t: 0, scale: 1, ema: 16, lastAdjust: 0, cap30: false,
               wind: 0, gust: 0, gustIn: 6 };
    var LAYERS = [
        { id: 'far',  n: 70, len: [7, 13],  sp: [520, 680],   w: 0.7, a: 0.20, size: [9, 12],  land: [0.50, 0.78], coinA: 0.55 },
        { id: 'mid',  n: 42, len: [15, 26], sp: [820, 1050],  w: 1.0, a: 0.34, size: [14, 19], land: [0.70, 0.92], coinA: 0.82 },
        { id: 'near', n: 20, len: [28, 48], sp: [1250, 1600], w: 1.5, a: 0.55, size: [22, 30], land: [0.86, 1.00], coinA: 1.0 }
    ];
    var drops = [[], [], []], splashes = [], bits = [], beads = [];
    var coin = { img: null, ok: false, fallback: null };

    function intensityMul() { return { 1: 0.55, 2: 1, 3: 1.7 }[S.cfg && S.cfg.intensity] || 1; }
    function budget() {
        var area = Math.max(0.7, Math.min(1.15, (innerWidth * innerHeight) / (1920 * 1080)));
        var dev = 1;
        if ((navigator.hardwareConcurrency || 8) <= 4) dev *= 0.7;
        if (navigator.deviceMemory && navigator.deviceMemory <= 4) dev *= 0.75;
        if (navigator.connection && navigator.connection.saveData) dev *= 0.5;
        if (innerWidth < 700) dev *= 0.7;
        return area * dev * FX.scale * intensityMul();
    }
    function credits() { return S.kind === 'credits'; }

    function loadCoin() {
        if (coin.img) return;
        coin.img = new Image();
        coin.img.onload = function () { coin.ok = true; };
        coin.img.onerror = function () { coin.ok = false; };
        coin.img.src = COIN_URL;
    }
    function coinSprite() {                           // plain gold disc, used until (or if) apex-credits.png loads
        if (coin.ok) return coin.img;
        if (coin.fallback) return coin.fallback;
        var c = document.createElement('canvas'), g;
        c.width = c.height = 64; g = c.getContext('2d');
        var gr = g.createRadialGradient(24, 22, 4, 32, 32, 30);
        gr.addColorStop(0, '#ffe9a0'); gr.addColorStop(0.6, '#f5c542'); gr.addColorStop(1, '#a8741a');
        g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 29, 0, 6.2832); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 21, 0, 6.2832); g.stroke();
        return (coin.fallback = c);
    }

    var glowCache = {};
    function glow(color, size) {
        var key = color + size;
        if (glowCache[key]) return glowCache[key];
        var c = document.createElement('canvas'), r = size / 2, g;
        c.width = c.height = size; g = c.getContext('2d');
        var gr = g.createRadialGradient(r, r, 0, r, r, r);
        gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(0, 0, size, size);
        return (glowCache[key] = c);
    }

    var beadCache = {};
    function beadSprite(warm) {                       // a water bead: dark body, bright rim low-right, tiny highlight up-left
        var key = warm ? 'w' : 'c';
        if (beadCache[key]) return beadCache[key];
        var c = document.createElement('canvas'), g;
        c.width = c.height = 64; g = c.getContext('2d');
        var rim = warm ? '255,200,120' : '190,215,230';
        var gr = g.createRadialGradient(28, 26, 4, 32, 32, 30);
        gr.addColorStop(0, 'rgba(120,150,170,.06)'); gr.addColorStop(0.7, 'rgba(14,26,38,.34)'); gr.addColorStop(1, 'rgba(' + rim + ',.55)');
        g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, 6.2832); g.fill();
        g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.ellipse(22, 20, 5, 3.4, -0.6, 0, 6.2832); g.fill();
        return (beadCache[key] = c);
    }

    function makeDrop(L, i, init) {
        var cr = credits(), sp = rand(L.sp[0], L.sp[1]) * (cr ? 0.42 : 1), ly = FX.h * rand(L.land[0], L.land[1]);
        return {
            x: rand(-FX.h * 0.4, FX.w + FX.h * 0.4), y: init ? rand(-20, ly) : -rand(L.len[1], L.len[1] + FX.h * 0.25),
            vy: sp, len: rand(L.len[0], L.len[1]), ly: ly, s: rand(L.size[0], L.size[1]),
            fl: rand(0, 6.28), sv: rand(2.5, 6) * (Math.random() < 0.5 ? -1 : 1)
        };
    }

    function splash(L, i, d) {
        var cr = credits(), cap = Math.round(70 * Math.min(1, FX.scale + 0.2));
        if (i === 0 && !cr) return;                                       // far rain is too small to splash
        if (splashes.length < cap) splashes.push({ x: d.x, y: d.ly, r: 1, max: rand(5, 10) * (i === 2 ? 1.5 : 1) * (cr ? 1.5 : 1), age: 0, life: cr ? 0.5 : 0.36, a: i === 2 ? 0.55 : 0.38 });
        var n = cr ? (i === 2 ? 5 : 3) : (i === 2 ? 3 : (i === 1 ? 1 : 0)), bcap = Math.round(130 * Math.min(1, FX.scale + 0.2));
        for (var k = 0; k < n && bits.length < bcap; k++) {
            var a = -rand(0.35, 2.8);
            bits.push({ x: d.x, y: d.ly, vx: Math.cos(a) * rand(20, cr ? 90 : 60), vy: Math.sin(a) * rand(40, cr ? 130 : 95), age: 0, life: rand(0.25, cr ? 0.6 : 0.4), gold: cr });
        }
    }

    function spawnBead(init) {
        var r = rand(1.6, 5.2);
        beads.push({ x: rand(0, FX.w), y: rand(0, FX.h * 0.92), r: r, a: 0, age: init ? rand(0, 10) : 0, hold: rand(2.5, 16), slide: false, vy: 0, pause: 0, flip: rand(0.3, 1.2), trail: [], fade: 0 });
    }

    function stepFx(dt) {
        var cr = credits(), b = budget();
        // wind: a slow lean that drifts, plus occasional gusts that fade out
        FX.gustIn -= dt;
        if (FX.gustIn <= 0) { FX.gust += rand(0.15, 0.32) * (Math.random() < 0.5 ? -1 : 1); FX.gustIn = rand(7, 19); }
        FX.gust *= Math.exp(-dt * 0.55);
        FX.wind = Math.max(-0.55, Math.min(0.55, Math.sin(FX.t * 0.11) * 0.10 + Math.sin(FX.t * 0.037 + 1.3) * 0.08 - 0.06 + FX.gust));

        for (var i = 0; i < 3; i++) {
            var L = LAYERS[i], arr = drops[i], target = Math.round(L.n * b * (cr ? 0.5 : 1));
            while (arr.length < target) arr.push(makeDrop(L, i, arr.length < target * 0.9));
            if (arr.length > target) arr.length = target;
            for (var j = 0; j < arr.length; j++) {
                var d = arr[j];
                d.y += d.vy * dt; d.x += d.vy * FX.wind * dt; d.fl += d.sv * dt;
                if (d.y >= d.ly) { splash(L, i, d); arr[j] = makeDrop(L, i, false); }
            }
        }
        for (var s = splashes.length - 1; s >= 0; s--) { var p = splashes[s]; p.age += dt; p.r = 1 + (p.max - 1) * (p.age / p.life); if (p.age >= p.life) splashes.splice(s, 1); }
        for (var q = bits.length - 1; q >= 0; q--) { var t = bits[q]; t.age += dt; t.vy += 380 * dt; t.x += t.vx * dt; t.y += t.vy * dt; if (t.age >= t.life) bits.splice(q, 1); }

        if (S.cfg && S.cfg.glass) {
            var maxB = Math.max(6, Math.min(40, Math.round(26 * b)));
            if (beads.length < maxB && Math.random() < dt * 1.2 * intensityMul()) spawnBead(false);
            while (beads.length > maxB) beads.pop();
            for (var k = beads.length - 1; k >= 0; k--) {
                var e = beads[k]; e.age += dt;
                if (e.age < 1.2) e.a = Math.min(1, e.a + dt * 1.2);
                if (!e.slide && e.age > e.hold) { if (e.r > 2.6) e.slide = true; else e.fade = 1; }
                if (e.fade) { e.a -= dt * 0.35; if (e.a <= 0) { beads.splice(k, 1); continue; } }
                if (e.slide) {
                    e.flip -= dt; if (e.flip <= 0) { e.pause = Math.random() < 0.35 ? rand(0.25, 0.9) : 0; e.flip = rand(0.3, 1.2); }
                    var want = e.pause > 0 ? 0 : e.r * 11 + 10; e.pause -= dt; e.vy += (want - e.vy) * Math.min(1, dt * 4);
                    var ny = e.y + e.vy * dt;
                    if (e.vy > 6) { e.r = Math.max(1.5, e.r - dt * 0.14); if (!e.trail.length || ny - e.trail[e.trail.length - 1][1] > 5) { e.trail.push([e.x + rand(-0.4, 0.4), ny]); if (e.trail.length > 18) e.trail.shift(); } }
                    e.y = ny;
                    if (e.y > FX.h + 12) beads.splice(k, 1);
                }
            }
        }
    }

    function drawFx(g) {
        var cr = credits(), i, j, d, L, arr;
        g.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0);
        g.clearRect(0, 0, FX.w, FX.h);
        var nx = FX.wind / Math.sqrt(1 + FX.wind * FX.wind), ny = 1 / Math.sqrt(1 + FX.wind * FX.wind);
        g.lineCap = 'round';

        for (i = 0; i < 3; i++) {
            L = LAYERS[i]; arr = drops[i];
            if (!cr) {                                                    // each streak = faint tail + brighter head, two strokes per layer
                g.lineWidth = L.w;
                g.strokeStyle = 'rgba(176,200,214,' + (L.a * 0.45).toFixed(3) + ')'; g.beginPath();
                for (j = 0; j < arr.length; j++) { d = arr[j]; g.moveTo(d.x - nx * d.len, d.y - ny * d.len); g.lineTo(d.x - nx * d.len * 0.5, d.y - ny * d.len * 0.5); }
                g.stroke();
                g.strokeStyle = 'rgba(200,220,232,' + L.a.toFixed(3) + ')'; g.beginPath();
                for (j = 0; j < arr.length; j++) { d = arr[j]; g.moveTo(d.x - nx * d.len * 0.5, d.y - ny * d.len * 0.5); g.lineTo(d.x, d.y); }
                g.stroke();
            } else {                                                      // faint gold trail, then the spinning coins
                g.lineWidth = Math.max(1, L.w); g.strokeStyle = 'rgba(245,197,66,' + (L.a * 0.32).toFixed(3) + ')'; g.beginPath();
                for (j = 0; j < arr.length; j++) { d = arr[j]; g.moveTo(d.x - nx * d.len * 1.6, d.y - ny * d.len * 1.6); g.lineTo(d.x, d.y); }
                g.stroke();
                var img = coinSprite(); g.globalAlpha = L.coinA;
                for (j = 0; j < arr.length; j++) {
                    d = arr[j];
                    var fx = Math.max(0.18, Math.abs(Math.cos(d.fl)));
                    g.setTransform(FX.dpr * fx, 0, 0, FX.dpr, FX.dpr * d.x, FX.dpr * d.y);
                    g.drawImage(img, -d.s / 2, -d.s / 2, d.s, d.s);
                }
                g.globalAlpha = 1; g.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0);
            }
        }

        // splashes: flattened ripples
        g.lineWidth = 1;
        for (i = 0; i < splashes.length; i++) {
            var p = splashes[i], k = 1 - p.age / p.life;
            g.strokeStyle = cr ? 'rgba(245,197,66,' + (p.a * k).toFixed(3) + ')' : 'rgba(190,212,224,' + (p.a * k).toFixed(3) + ')';
            g.beginPath(); g.ellipse(p.x, p.y, p.r, p.r * 0.32, 0, 0, 6.2832); g.stroke();
        }
        // droplets / sparkles
        for (i = 0; i < bits.length; i++) {
            var t = bits[i], a = 1 - t.age / t.life;
            if (t.gold) { g.globalAlpha = a; g.drawImage(glow('rgba(255,221,120,1)', 24), t.x - 4, t.y - 4, 8, 8); }
            else { g.globalAlpha = a * 0.7; g.fillStyle = 'rgb(200,222,234)'; g.fillRect(t.x - 0.7, t.y - 0.7, 1.4, 1.4); }
        }
        g.globalAlpha = 1;

        // window glass
        if (S.cfg && S.cfg.glass && beads.length) {
            var warm = cr, spr = beadSprite(warm);
            for (i = 0; i < beads.length; i++) {
                var e = beads[i];
                if (e.trail.length > 1) {
                    g.globalAlpha = 0.11 * e.a; g.lineWidth = Math.max(1, e.r * 0.5); g.strokeStyle = warm ? 'rgb(255,214,150)' : 'rgb(170,196,212)';
                    g.beginPath(); g.moveTo(e.trail[0][0], e.trail[0][1]);
                    for (j = 1; j < e.trail.length; j++) g.lineTo(e.trail[j][0], e.trail[j][1]);
                    g.lineTo(e.x, e.y); g.stroke();
                }
                g.globalAlpha = e.a; g.drawImage(spr, e.x - e.r * 1.4, e.y - e.r * 1.4, e.r * 2.8, e.r * 2.8);
            }
            g.globalAlpha = 1;
        }
    }

    function sizeCanvas() {
        if (!N.canvas) return;
        FX.dpr = FX.cap30 ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
        FX.w = innerWidth; FX.h = innerHeight;
        N.canvas.width = Math.floor(FX.w * FX.dpr); N.canvas.height = Math.floor(FX.h * FX.dpr);
    }

    function loop(ts) {
        if (!FX.on) return;
        FX.raf = requestAnimationFrame(loop);
        var dt = (ts - FX.last) / 1000;
        if (FX.cap30 && dt < 0.029) return;
        FX.last = ts; if (dt > 0.05) dt = 0.05; FX.t += dt;
        FX.ema = FX.ema * 0.9 + dt * 1000 * 0.1;
        if (ts - FX.lastAdjust > 2000 && FX.ema > (FX.cap30 ? 42 : 29)) {   // struggling: calm the CSS, then fewer particles, then none
            FX.lastAdjust = ts; FX.ema = 16;
            if (!root.classList.contains('rn-lite')) root.classList.add('rn-lite');
            else { FX.scale *= 0.72; try { sessionStorage.setItem('specsoft.rain.scale', String(FX.scale)); } catch (e) { /* ignore */ } }
            if (FX.scale < 0.2) { stopFx(); return; }
        }
        stepFx(dt); drawFx(FX.ctx);
    }

    function startFx() {
        if (FX.on || !N.canvas) return;
        FX.ctx = N.canvas.getContext('2d', { alpha: true });
        if (!FX.ctx) return;
        FX.cap30 = (navigator.hardwareConcurrency || 8) <= 4 || !!(navigator.deviceMemory && navigator.deviceMemory <= 4);
        FX.scale = 1; try { FX.scale = parseFloat(sessionStorage.getItem('specsoft.rain.scale')) || 1; } catch (e) { /* ignore */ }
        FX.ema = 16; FX.t = 0; FX.gust = 0; FX.gustIn = rand(3, 8); FX.lastAdjust = performance.now();
        drops = [[], [], []]; splashes = []; bits = []; beads = [];
        sizeCanvas();
        if (S.cfg && S.cfg.glass) { var n = Math.round(10 * intensityMul()); for (var i = 0; i < n; i++) spawnBead(true); beads.forEach(function (b) { b.a = 1; }); }
        FX.on = true; FX.last = performance.now(); FX.raf = requestAnimationFrame(loop);
    }
    function stopFx() {
        FX.on = false;
        if (FX.raf) cancelAnimationFrame(FX.raf);
        FX.raf = 0;
        if (FX.ctx && N.canvas) FX.ctx.clearRect(0, 0, N.canvas.width, N.canvas.height);
        drops = [[], [], []]; splashes = []; bits = []; beads = [];
    }
    function fxAllowed() { return !reduced() && !lite() && FX.scale >= 0.2; }
    function syncFx() {
        root.classList.toggle('rn-lite', lite() || reduced() || root.classList.contains('rn-lite'));
        if (S.active && fxAllowed()) startFx(); else stopFx();
        scheduleBolt();
    }

    window.addEventListener('resize', function () { clearTimeout(T.rs); T.rs = setTimeout(sizeCanvas, 150); });
    document.addEventListener('visibilitychange', function () {
        if (!FX.ctx || !S.active) return;
        if (document.hidden) { FX.on = false; if (FX.raf) cancelAnimationFrame(FX.raf); FX.raf = 0; }
        else if (!FX.on && fxAllowed()) { FX.on = true; FX.last = performance.now(); FX.raf = requestAnimationFrame(loop); }
    });

    /* ------------------------------ lightning + sound ------------------------------ */
    var AUD = { ctx: null, master: null, bed: null, rain: null, noise: null, on: false, tink: 0 };

    function noiseBuffer(ctx) {
        if (AUD.noise) return AUD.noise;
        var len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return (AUD.noise = buf);
    }
    function loopNoise(ctx, filters, gainVal) {
        var src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
        var node = src, g = ctx.createGain(); g.gain.value = gainVal;
        filters.forEach(function (f) { var b = ctx.createBiquadFilter(); b.type = f[0]; b.frequency.value = f[1]; node.connect(b); node = b; });
        node.connect(g); g.connect(AUD.master); src.start();
        return { src: src, gain: g };
    }
    function sndOn() {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        try {
            if (!AUD.ctx) {
                AUD.ctx = new AC(); AUD.master = AUD.ctx.createGain(); AUD.master.connect(AUD.ctx.destination);
                AUD.rain = loopNoise(AUD.ctx, [['highpass', 700], ['lowpass', 7500]], 0.15);   // the hiss of rain on pavement
                AUD.bed = loopNoise(AUD.ctx, [['lowpass', 240]], 0.11);                         // distant roar
                var lfo = AUD.ctx.createOscillator(), lg = AUD.ctx.createGain();               // gusts: the hiss swells and falls
                lfo.frequency.value = 0.07; lg.gain.value = 0.045; lfo.connect(lg); lg.connect(AUD.rain.gain.gain); lfo.start();
            }
            var vol = Math.max(0, Math.min(100, (S.cfg && S.cfg.volume != null) ? S.cfg.volume : 60)) / 100;
            AUD.master.gain.setTargetAtTime(vol * 0.9, AUD.ctx.currentTime, 0.4);
            AUD.rain.gain.gain.value = credits() ? 0.07 : 0.15;
            AUD.ctx.resume();
            AUD.on = true; scheduleTink();
            return true;
        } catch (e) { return false; }
    }
    function sndOff() {
        AUD.on = false; clearTimeout(AUD.tink);
        if (AUD.ctx) { try { AUD.ctx.close(); } catch (e) { /* ignore */ } }
        AUD.ctx = AUD.master = AUD.bed = AUD.rain = AUD.noise = null;
    }
    function scheduleTink() {                            // credits mode: soft coin "tinks" over the rain bed
        clearTimeout(AUD.tink);
        if (!AUD.on || !credits() || document.hidden) { if (AUD.on) AUD.tink = setTimeout(scheduleTink, 800); return; }
        try {
            var c = AUD.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
            o.type = 'triangle'; o.frequency.value = rand(1900, 3800);
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rand(0.02, 0.05), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
            o.connect(g); g.connect(AUD.master); o.start(t); o.stop(t + 0.2);
        } catch (e) { /* ignore */ }
        AUD.tink = setTimeout(scheduleTink, rand(90, 420) / Math.max(0.5, intensityMul()));
    }
    function thunder() {
        if (!AUD.on || !AUD.ctx) return;
        try {
            var c = AUD.ctx, t = c.currentTime, src = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
            src.buffer = noiseBuffer(c); src.loop = true; lp.type = 'lowpass';
            lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(80, t + 4);
            g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9, t + 0.3); g.gain.exponentialRampToValueAtTime(0.25, t + 1.6);
            g.gain.linearRampToValueAtTime(0.5, t + 2.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.2);
            src.connect(lp); lp.connect(g); g.connect(AUD.master); src.start(t, rand(0, 1.5)); src.stop(t + 5.4);
        } catch (e) { /* ignore */ }
    }

    function bolt() {
        if (!S.active || document.hidden || !N.flash || reduced() || lite()) return;
        N.flash.classList.remove('on'); void N.flash.offsetWidth; N.flash.classList.add('on');
        clearTimeout(T.thunder); T.thunder = setTimeout(thunder, rand(1200, 4200));    // light first, sound a few seconds later
    }
    function scheduleBolt() {
        clearTimeout(T.bolt);
        if (!S.active || !S.cfg || !S.cfg.lightning || reduced() || lite()) return;
        var gap = S.cfg.intensity >= 3 ? [18, 45] : S.cfg.intensity === 1 ? [50, 110] : [28, 75];
        T.bolt = setTimeout(function () { bolt(); scheduleBolt(); }, rand(gap[0], gap[1]) * 1000);
    }

    /* ------------------------------ layers, buttons, light mode ------------------------------ */
    function ensureCss() {
        if (N.css && N.css.isConnected) return;
        var l = document.getElementById('rn-css') || document.createElement('link');
        l.id = 'rn-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
        if (!l.parentNode) (document.head || root).appendChild(l);
        N.css = l;
    }

    function stripLight() {                              // the rain look is dark: pause light mode while it runs, give it back after
        var b = document.body;
        if (!b) return;
        if (b.classList.contains('light-mode')) { lightMode = true; b.classList.remove('light-mode'); }
        if (!themeObs && window.MutationObserver) {
            themeObs = new MutationObserver(function () { if (S.active && b.classList.contains('light-mode')) { lightMode = true; b.classList.remove('light-mode'); } });
            themeObs.observe(b, { attributes: true, attributeFilter: ['class'] });
        }
    }
    function giveLightBack() {
        if (themeObs) { themeObs.disconnect(); themeObs = null; }
        var b = document.body;
        var saved = lsGet('specsoft-theme') === 'light';
        if (b && (lightMode || saved)) b.classList.toggle('light-mode', saved);
        lightMode = false;
    }

    var mouse = { x: 0, y: 0, raf: 0 };
    function onMove(e) {
        mouse.x = e.clientX; mouse.y = e.clientY;
        if (mouse.raf) return;
        mouse.raf = requestAnimationFrame(function () {
            mouse.raf = 0;
            if (N.dark) { N.dark.style.setProperty('--mx', mouse.x + 'px'); N.dark.style.setProperty('--my', mouse.y + 'px'); }
        });
    }

    function kindIcon() { return credits() ? '\uD83E\uDE99' : '\uD83C\uDF27\uFE0F'; }
    function paintButtons() {
        if (N.bKind) {
            N.bKind.textContent = kindIcon();
            N.bKind.title = credits() ? 'Raining APEX Credits. Switch to regular rain' : 'Raining regular rain. Switch to APEX Credits';
            N.bKind.setAttribute('aria-label', N.bKind.title);
            N.bKind.setAttribute('aria-pressed', String(credits()));
        }
        if (N.bSnd) {
            N.bSnd.textContent = AUD.on ? '\uD83D\uDD0A' : '\uD83D\uDD07';
            N.bSnd.title = AUD.on ? 'Rain sound on. Tap to mute' : 'Rain sound is off. Tap to listen';
            N.bSnd.setAttribute('aria-label', N.bSnd.title);
            N.bSnd.setAttribute('aria-pressed', String(AUD.on));
        }
    }

    function mount() {
        if (N.root) return;
        ensureCss();
        root.setAttribute('data-rain', S.kind);
        stripLight();
        var r = div(''); r.id = 'rn-root'; r.setAttribute('aria-hidden', 'true');
        r.appendChild(div('rn-tint'));
        r.appendChild(div('rn-fog'));
        r.appendChild(div('rn-lamp'));
        if (S.cfg && S.cfg.flashlight && !!window.matchMedia && !matchMedia('(hover: none)').matches) {
            N.dark = div('rn-dark'); r.appendChild(N.dark); root.setAttribute('data-rain-flash', '1');
            window.addEventListener('pointermove', onMove, { passive: true });
        }
        var cv = document.createElement('canvas'); cv.id = 'rn-fx'; r.appendChild(cv); N.canvas = cv;
        N.flash = div('rn-flash'); r.appendChild(N.flash);
        document.body.appendChild(r); N.root = r;

        var wrap = div('rn-btns');
        N.bKind = document.createElement('button'); N.bKind.type = 'button'; N.bKind.className = 'rn-btn';
        N.bKind.addEventListener('click', function () { setKind(credits() ? 'rain' : 'credits'); });
        N.bSnd = document.createElement('button'); N.bSnd.type = 'button'; N.bSnd.className = 'rn-btn';
        N.bSnd.addEventListener('click', function () { if (AUD.on) sndOff(); else sndOn(); paintButtons(); });
        wrap.appendChild(N.bSnd); wrap.appendChild(N.bKind);
        document.body.appendChild(wrap); N.btns = wrap;
        paintButtons();
        loadCoin();
    }

    function unmount() {
        stopFx(); sndOff();
        clearTimeout(T.bolt); clearTimeout(T.thunder); clearTimeout(T.greet);
        window.removeEventListener('pointermove', onMove);
        [N.root, N.btns, N.greet, N.prev].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
        N.root = N.canvas = N.flash = N.dark = N.btns = N.bSnd = N.bKind = N.greet = N.prev = null;
        root.removeAttribute('data-rain'); root.removeAttribute('data-rain-flash'); root.classList.remove('rn-lite');
        if (N.css && N.css.parentNode) N.css.parentNode.removeChild(N.css);
        N.css = null;
        giveLightBack();
    }

    function greet() {
        var id = S.id || 'x', day = new Date().toISOString().slice(0, 10), key = 'specsoft.rain.greet.' + id;
        if (!S.preview) { if (lsGet(key) === day) return; lsSet(key, day); }
        var n = div('rn-greet'); n.setAttribute('role', 'status');
        n.textContent = (S.ev && S.ev.label) ? S.ev.label : (credits() ? 'It is raining APEX Credits.' : 'It is raining. Stay a while.');
        document.body.appendChild(n); N.greet = n;
        setTimeout(function () { n.classList.add('is-on'); }, 700);
        T.greet = setTimeout(function () { n.classList.remove('is-on'); setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 800); }, 6200);
    }

    function userKind() { var k = lsGet(KIND_KEY); return k === 'rain' || k === 'credits' ? k : ''; }
    function setKind(k) {                                // '' = go back to what staff chose
        if (k !== 'rain' && k !== 'credits' && k !== '') return;
        lsSet(KIND_KEY, k || null);
        S.kind = k || (S.cfg && S.cfg.kind) || 'rain';
        if (S.active) {
            root.setAttribute('data-rain', S.kind);
            drops = [[], [], []]; splashes = []; bits = []; beads = [];
            if (AUD.on && AUD.rain) { AUD.rain.gain.gain.value = credits() ? 0.07 : 0.15; scheduleTink(); }
            paintButtons();
        }
        fire();
    }

    function fire() { try { window.dispatchEvent(new CustomEvent('specrain', { detail: { active: S.active, kind: S.kind } })); } catch (e) { /* old browser */ } }

    /* ------------------------------ start / stop ------------------------------ */
    function start(cfg, id, ev) {
        if (S.active && S.id === id) return;
        S.cfg = cfg; S.id = id; S.ev = ev || null; S.active = true;
        S.kind = userKind() || cfg.kind || 'rain';
        whenBody(function () {
            if (!S.active || S.id !== id) return;
            mount(); syncFx(); greet(); fire();
        });
    }
    function stop() {
        if (!S.active && !N.root) return;
        S.active = false; S.id = null; S.ev = null;
        whenBody(function () { if (!S.active) { unmount(); fire(); } });
    }

    /* ------------------------------ server sync ------------------------------ */
    function fetchNow() {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/site_rain_now', {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('rain ' + r.status); return r.json(); });
    }

    function handle(ev) {
        clearTimeout(T.start); clearTimeout(T.end);
        if (!ev) { stop(); return; }
        var now = Date.now() + S.skew, s = Date.parse(ev.starts_at), e = Date.parse(ev.ends_at);
        if (!(e > now)) { stop(); return; }
        if (now >= s) {
            start({ kind: ev.kind, intensity: ev.intensity, lightning: ev.lightning, flashlight: ev.flashlight, glass: ev.glass, volume: ev.volume }, ev.id, ev);
            T.end = setTimeout(poll, Math.min(e - now + 1500, 2000000000));
        } else {
            stop();
            T.start = setTimeout(poll, Math.min(s - now + 300, 2000000000));
        }
    }

    function schedule() {
        clearTimeout(T.poll);
        if (S.preview) return;
        T.poll = setTimeout(poll, S.active ? 15000 : 30000);   // while it rains, staff aborts are noticed within about 15 seconds
    }
    function poll() {
        if (S.preview) return;
        if (document.hidden) { schedule(); return; }
        fetchNow().then(function (d) { S.skew = (Date.parse(d && d.now) || Date.now()) - Date.now(); handle(d && d.event); })
            .catch(function () { /* offline or SQL not installed: keep what we have */ })
            .then(schedule);
    }

    /* ------------------------------ staff preview (index.html#rain-preview) ------------------------------ */
    function preview(cfg) {
        var base = { kind: 'rain', intensity: 2, lightning: true, flashlight: true, glass: true, volume: 60 }, k;
        cfg = cfg || {};
        for (k in cfg) if (Object.prototype.hasOwnProperty.call(cfg, k) && cfg[k] != null) base[k] = cfg[k];
        S.preview = true; clearTimeout(T.poll); clearTimeout(T.start); clearTimeout(T.end);
        S.active = false; stop();
        whenBody(function () {
            start(base, 'preview', { label: null });
            var chip = div('rn-prev'); chip.innerHTML = '<span>Rain preview. Only you can see this.</span>';
            var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Close preview';
            b.addEventListener('click', endPreview); chip.appendChild(b);
            document.body.appendChild(chip); N.prev = chip;
        });
    }
    function endPreview() {
        S.preview = false; stop();
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
        poll();
    }

    window.SpecRain = {
        active: function () { return S.active; },
        kind: function () { return S.kind; },
        setKind: setKind, preview: preview, endPreview: endPreview
    };

    /* ------------------------------ boot ------------------------------ */
    if (/^#rain-preview/.test(location.hash)) {
        var pc = null;
        try { pc = JSON.parse(localStorage.getItem(PREVIEW_KEY) || 'null'); } catch (e) { pc = null; }
        preview(pc || {});
    } else {
        poll();
    }
})();
