/* ==========================================================================
   SPECSOFT® seasons.js  -  seasonal themes for the WHOLE site
   Add  <script src="seasons.js"></script>  inside <head> of every page (add-seasons.js does it for you).

   What it does
     1. Asks the database "which season is on?" (site_theme_now, plain fetch: no SDK needed)
        and remembers the answer, so the next page paints the theme instantly with no flash.
     2. Sets  <html data-season="halloween">  and loads seasons.css (only while a season is on).
     3. Builds the decorations (moon, fog, cobwebs, lights...) and runs ONE canvas for particles.
   Staff control it from Console > Seasons (automatic by date, forced, or off).

   Built to stay light
     - one canvas, one requestAnimationFrame loop, sprites instead of per-frame gradients
     - particle counts scale with screen size, device power, data saver and the intensity setting
     - the loop pauses when the tab is hidden, drops to 30fps on weaker devices, and quietly
       lowers (then stops) the particles if the page ever struggles
     - respects "reduce motion", and visitors can switch effects off with the small button
   Public API: window.SpecSeasons { THEMES, current(), preview(id), endPreview(), refresh() }
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecSeasons) return;

    var SELF = (document.currentScript && document.currentScript.src) || '';
    var CSS_URL = SELF ? SELF.replace(/seasons\.js(\?.*)?$/, 'seasons.css$1') : 'seasons.css';
    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var CACHE_KEY = 'specsoft.season.v1', FX_KEY = 'specsoft.seasonfx', TTL = 3 * 60 * 1000;
    var root = document.documentElement;

    /* ------------------------------ registry ------------------------------ */
    // To add a theme: palette in seasons.css + an entry here. Staff pick it in Console > Seasons.
    var THEMES = {
        halloween: {
            name: 'Halloween', emoji: '\uD83C\uDF83', blurb: 'Violet nights, a pumpkin moon, drifting embers, fog, cobwebs and bats.',
            greet: 'Happy Halloween! Spooky season is on.', back: ['moon', 'fog'], front: ['web', 'spider'], fx: [{ t: 'embers', n: 60 }, { t: 'bats', n: 3 }],
            emojis: ['\uD83C\uDF83', '\uD83D\uDC7B', '\uD83E\uDD87', '\uD83D\uDD77\uFE0F', '\uD83D\uDD78\uFE0F', '\uD83D\uDC80', '\uD83E\uDDD9', '\uD83C\uDF6C', '\uD83C\uDF6D', '\uD83C\uDF19', '\u26B0\uFE0F', '\uD83E\uDDDB', '\uD83E\uDDDF', '\uD83D\uDD2E', '\uD83E\uDEA6', '\uD83D\uDE08']
        },
        christmas: {
            name: 'Christmas', emoji: '\uD83C\uDF84', blurb: 'Pine and berry colors, falling snow, twinkling lights and frosty edges.',
            greet: 'Merry Christmas! The holiday lights are on.', back: ['frost'], front: ['lights'], fx: [{ t: 'snow', n: 130 }],
            emojis: ['\uD83C\uDF84', '\uD83C\uDF85', '\uD83E\uDD36', '\u26C4', '\u2744\uFE0F', '\uD83C\uDF81', '\uD83E\uDD8C', '\uD83D\uDD14', '\u2B50', '\uD83C\uDF6A', '\uD83E\uDD5B', '\uD83E\uDDE6', '\uD83D\uDD6F\uFE0F', '\uD83C\uDFB6', '\u2728', '\uD83D\uDEF7']
        },
        newyear: {
            name: 'New Year', emoji: '\uD83C\uDF86', blurb: 'Midnight and gold, fireworks bursting over the page and falling confetti.',
            greet: 'Happy New Year! Let the fireworks begin.', back: ['beams'], front: [], fx: [{ t: 'fireworks', n: 1 }, { t: 'confetti', n: 52 }],
            emojis: ['\uD83C\uDF86', '\uD83C\uDF87', '\uD83E\uDD42', '\uD83C\uDF7E', '\uD83C\uDF89', '\uD83C\uDF8A', '\u2728', '\uD83D\uDD5B', '\uD83E\uDEA9', '\uD83D\uDCAB', '\uD83C\uDF88', '\uD83E\uDDE8']
        },
        valentine: {
            name: "Valentine's Day", emoji: '\uD83D\uDC98', blurb: 'Rose and blush tones with soft glows and hearts floating up.',
            greet: "Happy Valentine's Day!", back: ['heartglow'], front: [], fx: [{ t: 'hearts', n: 28 }],
            emojis: ['\uD83D\uDC98', '\uD83D\uDC96', '\uD83D\uDC9D', '\uD83D\uDC97', '\uD83D\uDC95', '\uD83D\uDC8C', '\uD83C\uDF39', '\uD83D\uDE0D', '\uD83E\uDD70', '\uD83D\uDE18', '\uD83D\uDC8B', '\uD83E\uDDF8']
        }
    };

    /* ------------------------------ state ------------------------------ */
    var state = { theme: null, effects: true, intensity: 'normal', ends_at: null, preview: false };
    var mounted = { id: null, back: null, front: null, css: null, toggle: null, fav: null, favMade: false, favOrig: null };
    var fxTimer = null, checkTimer = null, endTimer = null;

    function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function userOff() { try { return localStorage.getItem(FX_KEY) === 'off'; } catch (e) { return false; } }
    function liteMemory(v) { try { if (v === undefined) return sessionStorage.getItem('specsoft.season.lite') === '1'; sessionStorage.setItem('specsoft.season.lite', v ? '1' : '0'); } catch (e) { return false; } return v; }
    function slowMemory(v) { try { if (v === undefined) return parseFloat(sessionStorage.getItem('specsoft.season.scale')) || 1; sessionStorage.setItem('specsoft.season.scale', String(v)); } catch (e) { return 1; } return v; }
    function isLight() { return !!(document.body && document.body.classList.contains('light-mode')); }
    function whenBody(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true }); }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

    /* ------------------------------ decoration layers ------------------------------ */
    function cobweb() {
        var rays = [0, 22, 45, 68, 90].map(function (d) { var a = d * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; });
        var p = rays.map(function (r) { return 'M0 0L' + (r[0] * 200).toFixed(1) + ' ' + (r[1] * 200).toFixed(1); }).join('');
        [42, 82, 122, 160, 196].forEach(function (rad) {
            for (var i = 0; i < rays.length - 1; i++) {
                var ax = rays[i][0] * rad, ay = rays[i][1] * rad, bx = rays[i + 1][0] * rad, by = rays[i + 1][1] * rad;
                p += 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + 'Q' + ((ax + bx) * 0.41).toFixed(1) + ' ' + ((ay + by) * 0.41).toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1);
            }
        });
        return '<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" aria-hidden="true"><path d="' + p + '"/></svg>';
    }

    var SPIDER = '<svg viewBox="0 0 40 44" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<ellipse cx="20" cy="29" rx="8" ry="9" stroke="none"/><circle cx="20" cy="16" r="5" stroke="none"/><circle cx="18" cy="15" r="1.3" fill="#ff7a1a" stroke="none"/><circle cx="22" cy="15" r="1.3" fill="#ff7a1a" stroke="none"/>' +
        '<g fill="none"><path d="M13 24 L5 18 L2 24"/><path d="M12 28 L3 29 L1 36"/><path d="M13 32 L5 38 L4 43"/><path d="M14 20 L8 12 L3 13"/>' +
        '<path d="M27 24 L35 18 L38 24"/><path d="M28 28 L37 29 L39 36"/><path d="M27 32 L35 38 L36 43"/><path d="M26 20 L32 12 L37 13"/></g></svg>';

    function lights() {
        var n = Math.max(10, Math.min(38, Math.round(innerWidth / 56))), swags = Math.max(3, Math.round(n / 5));
        var cols = ['#ff4d4d', '#ffd34d', '#4dff88', '#4dc3ff', '#ff7ad9'], pts = [], bulbs = '';
        for (var s = 0; s <= 120; s++) { var t = (s / 120 * swags) % 1; pts.push((s / 120 * 1000).toFixed(1) + ',' + (3 + 10 * Math.sin(Math.PI * (s === 120 ? 1 : t))).toFixed(2)); }
        for (var i = 0; i < n; i++) {
            var u = (i + 0.5) / n, tt = (u * swags) % 1, y = 3 + 10 * Math.sin(Math.PI * tt);
            bulbs += '<i style="left:' + (u * 100).toFixed(2) + '%;top:' + (y + 1).toFixed(1) + 'px;--c:' + cols[i % cols.length] + ';animation-delay:-' + ((i * 0.43) % 2.6).toFixed(2) + 's"></i>';
        }
        return '<div class="ss-lights"><svg viewBox="0 0 1000 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts.join(' ') + '" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="1.4"/></svg>' + bulbs + '</div>';
    }

    var LAYERS = {
        moon: function () { return '<div class="ss-moon"></div>'; },
        fog: function () { return '<div class="ss-fog ss-fog-a"></div><div class="ss-fog ss-fog-b"></div>'; },
        web: function () { return '<div class="ss-web ss-web-l">' + cobweb() + '</div><div class="ss-web ss-web-r">' + cobweb() + '</div>'; },
        spider: function () { return '<div class="ss-spider">' + SPIDER + '</div>'; },
        lights: lights,
        frost: function () { return '<div class="ss-frost"></div>'; },
        beams: function () { return '<div class="ss-beams"></div>'; },
        heartglow: function () { return '<div class="ss-hearts-glow"></div>'; }
    };

    /* ------------------------------ canvas particle engine ------------------------------ */
    var FX = { on: false, canvas: null, ctx: null, w: 0, h: 0, dpr: 1, systems: [], raf: 0, last: 0, t: 0, scale: 1, ema: 16, lastAdjust: 0, cap30: false };
    var sprites = {};

    function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

    function glowSprite(hex, size) {
        var key = hex + size;
        if (sprites[key]) return sprites[key];
        var c = document.createElement('canvas'), r = size / 2;
        c.width = c.height = size;
        var g = c.getContext('2d'), grad = g.createRadialGradient(r, r, 0, r, r, r);
        grad.addColorStop(0, hexA(hex, 1)); grad.addColorStop(0.3, hexA(hex, 0.7)); grad.addColorStop(1, hexA(hex, 0));
        g.fillStyle = grad; g.fillRect(0, 0, size, size);
        return (sprites[key] = c);
    }
    function heartSprite(hex) {
        var key = 'h' + hex;
        if (sprites[key]) return sprites[key];
        var c = document.createElement('canvas'), g;
        c.width = c.height = 64; g = c.getContext('2d');
        g.shadowColor = hex; g.shadowBlur = 8; g.fillStyle = hex;
        g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(6, 36, 8, 12, 24, 12); g.bezierCurveTo(29, 12, 32, 16, 32, 20);
        g.bezierCurveTo(32, 16, 35, 12, 40, 12); g.bezierCurveTo(56, 12, 58, 36, 32, 54); g.closePath(); g.fill();
        return (sprites[key] = c);
    }

    function budget() {
        var inten = { low: 0.45, normal: 1, high: 1.7 }[state.intensity] || 1;
        var area = Math.max(0.7, Math.min(1.15, (innerWidth * innerHeight) / (1920 * 1080)));
        var dev = 1;
        if ((navigator.hardwareConcurrency || 8) <= 4) dev *= 0.7;
        if (navigator.deviceMemory && navigator.deviceMemory <= 4) dev *= 0.75;
        if (navigator.connection && navigator.connection.saveData) dev *= 0.5;
        if (innerWidth < 700) dev *= 0.7;
        return inten * area * dev * FX.scale;
    }

    var PAL = {
        embers: { d: ['#ff7a1a', '#ffb347', '#ff4d00', '#ffd08a'], l: ['#e8590c', '#c2410c', '#f08c00'] },
        snow: { d: ['#ffffff', '#e6f2ff'], l: ['#7fa8d6', '#9db8d8'] },
        party: { d: ['#f5c542', '#ffffff', '#818cf8', '#f472b6', '#34d399', '#22d3ee'], l: ['#a16207', '#4f46e5', '#db2777', '#059669', '#d97706'] },
        hearts: { d: ['#ff5c8a', '#f472b6', '#ffd1dc', '#fb7185'], l: ['#be185d', '#db2777', '#e11d48'] }
    };
    function colorFor(name) { return pick(PAL[name][isLight() ? 'l' : 'd']); }

    /* each system: { update(dt), draw(ctx) } and sizes itself from the live budget */
    function Embers(base) {
        var p = [];
        function make(init) { var life = rand(5, 11); return { x: rand(0, FX.w), y: init ? rand(0, FX.h) : FX.h + 12, vx: rand(-8, 8), vy: -rand(18, 58), s: rand(1.5, 4), ph: rand(0, 6.28), life: life, age: init ? rand(0, life) : 0, c: colorFor('embers') }; }
        return {
            update: function (dt) {
                var target = Math.round(base * budget());
                while (p.length < target) p.push(make(p.length < target * 0.9));
                if (p.length > target) p.length = target;
                for (var i = 0; i < p.length; i++) {
                    var e = p[i]; e.age += dt; e.x += (e.vx + Math.sin(e.age * 1.3 + e.ph) * 14) * dt; e.y += e.vy * dt;
                    if (e.age > e.life || e.y < -12) p[i] = make(false);
                }
            },
            draw: function (g) {
                g.globalCompositeOperation = isLight() ? 'source-over' : 'lighter';
                for (var i = 0; i < p.length; i++) {
                    var e = p[i], a = Math.sin(Math.PI * e.age / e.life) * (0.6 + 0.4 * Math.sin(e.age * 9 + e.ph)), r = e.s * 5;
                    g.globalAlpha = Math.max(0, a) * (isLight() ? 0.8 : 0.95);
                    g.drawImage(glowSprite(e.c, 32), e.x - r, e.y - r, r * 2, r * 2);
                }
                g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
            }
        };
    }

    function Bats(max) {
        var bats = [], next = rand(2, 5);
        function wing(g, tip) {
            g.beginPath(); g.moveTo(-2, -2); g.quadraticCurveTo(-12, tip - 6, -27, tip); g.quadraticCurveTo(-22, tip + 7, -18, tip + 8);
            g.quadraticCurveTo(-14, tip + 3, -10, tip + 10); g.quadraticCurveTo(-6, tip + 6, -2, 5); g.closePath(); g.fill(); g.stroke();
        }
        return {
            update: function (dt) {
                next -= dt;
                var cap = Math.max(1, Math.round(max * Math.min(1, budget() + 0.2)));
                if (next <= 0 && bats.length < cap) {
                    var dir = Math.random() < 0.5 ? 1 : -1, group = 1 + Math.floor(Math.random() * 2), by = rand(FX.h * 0.08, FX.h * 0.42), sp = rand(120, 210);
                    for (var i = 0; i < group && bats.length < cap; i++) bats.push({ x: dir > 0 ? -40 - i * 55 : FX.w + 40 + i * 55, y: by + rand(-26, 26), dir: dir, sp: sp * rand(0.9, 1.1), s: rand(0.8, 1.35), ph: rand(0, 6.28), t: 0 });
                    next = rand(6, 13);
                }
                for (var j = bats.length - 1; j >= 0; j--) {
                    var b = bats[j]; b.t += dt; b.x += b.dir * b.sp * dt; b.y += Math.sin(b.t * 2.2 + b.ph) * 22 * dt;
                    if (b.x < -120 || b.x > FX.w + 120) bats.splice(j, 1);
                }
            },
            draw: function (g) {
                var light = isLight();
                g.fillStyle = light ? '#2b1408' : '#1a0d2b'; g.strokeStyle = light ? 'rgba(194,65,12,.5)' : 'rgba(255,122,26,.42)'; g.lineWidth = 1;
                for (var i = 0; i < bats.length; i++) {
                    var b = bats[i], tip = -6 - 11 * Math.sin(b.t * 13 + b.ph);
                    g.save(); g.translate(b.x, b.y); g.scale(b.dir * b.s, b.s);
                    wing(g, tip); g.scale(-1, 1); wing(g, tip); g.scale(-1, 1);
                    g.beginPath(); g.ellipse(0, 0, 4.2, 6.5, 0, 0, 6.2832); g.fill(); g.stroke();
                    g.beginPath(); g.moveTo(-3, -5); g.lineTo(-2.4, -10); g.lineTo(0, -6); g.lineTo(2.4, -10); g.lineTo(3, -5); g.closePath(); g.fill();
                    g.restore();
                }
            }
        };
    }

    function Snow(base) {
        var p = [];
        function make(init) { var big = Math.random() < 0.08, r = big ? rand(3.5, 5.5) : rand(0.9, 3); return { x: rand(0, FX.w), y: init ? rand(0, FX.h) : -8, r: r, vy: big ? rand(16, 30) : 16 + r * 13, ph: rand(0, 6.28), amp: rand(6, 20), a: big ? 0.28 : rand(0.5, 0.95), c: colorFor('snow') }; }
        return {
            update: function (dt) {
                var target = Math.round(base * budget());
                while (p.length < target) p.push(make(p.length < target * 0.9));
                if (p.length > target) p.length = target;
                var wind = Math.sin(FX.t * 0.15) * 20;
                for (var i = 0; i < p.length; i++) {
                    var f = p[i]; f.y += f.vy * dt; f.x += (Math.sin(FX.t * 0.7 + f.ph) * f.amp + wind) * dt;
                    if (f.y > FX.h + 8) { p[i] = make(false); } else if (f.x < -10) f.x = FX.w + 10; else if (f.x > FX.w + 10) f.x = -10;
                }
            },
            draw: function (g) {
                for (var i = 0; i < p.length; i++) { var f = p[i], r = f.r * 2.4; g.globalAlpha = f.a; g.drawImage(glowSprite(f.c, 24), f.x - r, f.y - r, r * 2, r * 2); }
                g.globalAlpha = 1;
            }
        };
    }

    function Confetti(base) {
        var p = [];
        function make(init) { return { x: rand(0, FX.w), y: init ? rand(0, FX.h) : -14, w: rand(5, 9), h: rand(8, 13), vy: rand(38, 105), vx: rand(-18, 18), rot: rand(0, 6.28), vr: rand(-3, 3), fl: rand(0, 6.28), c: colorFor('party') }; }
        return {
            update: function (dt) {
                var target = Math.round(base * budget());
                while (p.length < target) p.push(make(p.length < target * 0.9));
                if (p.length > target) p.length = target;
                for (var i = 0; i < p.length; i++) {
                    var c = p[i]; c.y += c.vy * dt; c.x += (c.vx + Math.sin(FX.t + c.fl) * 24) * dt; c.rot += c.vr * dt; c.fl += dt * 5;
                    if (c.y > FX.h + 16) p[i] = make(false);
                }
            },
            draw: function (g) {
                for (var i = 0; i < p.length; i++) {
                    var c = p[i]; g.save(); g.translate(c.x, c.y); g.rotate(c.rot); g.scale(1, Math.cos(c.fl)); g.globalAlpha = 0.85; g.fillStyle = c.c; g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); g.restore();
                }
                g.globalAlpha = 1;
            }
        };
    }

    function Fireworks() {
        var rockets = [], sparks = [], next = 0.6;
        function burst(x, y) {
            var base = colorFor('party'), alt = colorFor('party'), n = Math.round(rand(26, 44) * Math.min(1.2, Math.max(0.5, budget())));
            for (var i = 0; i < n; i++) {
                var a = (i / n) * 6.2832 + rand(-0.08, 0.08), sp = rand(70, 250) * (Math.random() < 0.3 ? 0.55 : 1);
                sparks.push({ x: x, y: y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(1.0, 1.8), age: 0, c: Math.random() < 0.7 ? base : alt });
            }
        }
        return {
            update: function (dt) {
                next -= dt;
                if (next <= 0 && rockets.length < 2) { var tx = rand(FX.w * 0.15, FX.w * 0.85); rockets.push({ x: tx + rand(-30, 30), y: FX.h + 10, tx: tx, ty: rand(FX.h * 0.12, FX.h * 0.5), vy: -rand(420, 560) }); next = rand(1.1, 2.7); }
                for (var i = rockets.length - 1; i >= 0; i--) { var r = rockets[i]; r.y += r.vy * dt; r.x += (r.tx - r.x) * Math.min(1, dt * 2); if (r.y <= r.ty) { burst(r.x, r.y); rockets.splice(i, 1); } }
                for (var j = sparks.length - 1; j >= 0; j--) {
                    var s = sparks[j]; s.age += dt; s.px = s.x; s.py = s.y; s.vx *= 0.985; s.vy = s.vy * 0.985 + 120 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
                    if (s.age > s.life) sparks.splice(j, 1);
                }
                if (sparks.length > 240) sparks.splice(0, sparks.length - 240);
            },
            draw: function (g) {
                g.globalCompositeOperation = isLight() ? 'source-over' : 'lighter'; g.lineCap = 'round';
                for (var i = 0; i < rockets.length; i++) { var r = rockets[i]; g.globalAlpha = 0.9; g.drawImage(glowSprite('#ffe9a8', 24), r.x - 7, r.y - 7, 14, 14); }
                for (var j = 0; j < sparks.length; j++) {
                    var s = sparks[j], a = 1 - s.age / s.life;
                    g.globalAlpha = a; g.strokeStyle = s.c; g.lineWidth = 1.5 + a; g.beginPath(); g.moveTo(s.px, s.py); g.lineTo(s.x, s.y); g.stroke();
                    if (a > 0.6 && (j & 3) === 0) g.drawImage(glowSprite(s.c, 24), s.x - 5, s.y - 5, 10, 10);
                }
                g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
            }
        };
    }

    function Hearts(base) {
        var p = [];
        function make(init) { return { x: rand(0, FX.w), y: init ? rand(0, FX.h) : FX.h + 24, s: rand(8, 22), vy: -rand(22, 60), ph: rand(0, 6.28), amp: rand(8, 24), a: rand(0.35, 0.8), rot: rand(-0.3, 0.3), c: colorFor('hearts') }; }
        return {
            update: function (dt) {
                var target = Math.round(base * budget());
                while (p.length < target) p.push(make(p.length < target * 0.9));
                if (p.length > target) p.length = target;
                for (var i = 0; i < p.length; i++) { var h = p[i]; h.y += h.vy * dt; h.x += Math.sin(FX.t * 0.9 + h.ph) * h.amp * dt; if (h.y < -30) p[i] = make(false); }
            },
            draw: function (g) {
                for (var i = 0; i < p.length; i++) {
                    var h = p[i]; g.save(); g.translate(h.x, h.y); g.rotate(h.rot + Math.sin(FX.t + h.ph) * 0.15); g.globalAlpha = h.a * Math.min(1, Math.max(0, h.y / 90 + 0.3));
                    g.drawImage(heartSprite(h.c), -h.s / 2, -h.s / 2, h.s, h.s); g.restore();
                }
                g.globalAlpha = 1;
            }
        };
    }

    var MAKE = { embers: Embers, bats: Bats, snow: Snow, confetti: Confetti, fireworks: Fireworks, hearts: Hearts };

    function sizeCanvas() {
        if (!FX.canvas) return;
        FX.dpr = FX.cap30 ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
        FX.w = innerWidth; FX.h = innerHeight;
        FX.canvas.width = Math.floor(FX.w * FX.dpr); FX.canvas.height = Math.floor(FX.h * FX.dpr);
        FX.ctx.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0);
    }

    function loop(ts) {
        if (!FX.on) return;
        FX.raf = requestAnimationFrame(loop);
        var dt = (ts - FX.last) / 1000;
        if (FX.cap30 && dt < 0.029) return;
        FX.last = ts; if (dt > 0.05) dt = 0.05; FX.t += dt;

        FX.ema = FX.ema * 0.9 + dt * 1000 * 0.1;
        if (ts - FX.lastAdjust > 2000 && FX.ema > (FX.cap30 ? 42 : 29)) {           // struggling: 1) stop the big CSS animations, 2) fewer particles, 3) none
            FX.lastAdjust = ts; FX.ema = 16;
            if (!root.classList.contains('ss-lite')) { root.classList.add('ss-lite'); liteMemory(true); }
            else { FX.scale *= 0.72; slowMemory(FX.scale); }                                   // remembered for the rest of this visit
            if (FX.scale < 0.2) { stopFx(); root.classList.add('ss-calm'); return; }
        }
        var g = FX.ctx; g.clearRect(0, 0, FX.w, FX.h);
        for (var i = 0; i < FX.systems.length; i++) { FX.systems[i].update(dt); FX.systems[i].draw(g); }
    }

    function startFx(theme) {
        stopFx();
        if (!mounted.front || !theme.fx.length) return;
        FX.cap30 = (navigator.hardwareConcurrency || 8) <= 4 || !!(navigator.deviceMemory && navigator.deviceMemory <= 4);
        FX.canvas = document.createElement('canvas'); FX.canvas.id = 'ss-fx'; FX.canvas.setAttribute('aria-hidden', 'true');
        mounted.front.appendChild(FX.canvas);
        FX.ctx = FX.canvas.getContext('2d', { alpha: true });
        if (!FX.ctx) { stopFx(); return; }
        FX.scale = slowMemory(); FX.ema = 16; FX.t = 0; FX.lastAdjust = performance.now();
        sizeCanvas();
        FX.systems = theme.fx.map(function (f) { return MAKE[f.t](f.n); });
        FX.on = true; FX.last = performance.now();
        FX.raf = requestAnimationFrame(loop);
    }

    function stopFx() {
        FX.on = false;
        if (FX.raf) cancelAnimationFrame(FX.raf);
        FX.raf = 0; FX.systems = [];
        if (FX.canvas && FX.canvas.parentNode) FX.canvas.parentNode.removeChild(FX.canvas);
        FX.canvas = FX.ctx = null;
    }

    window.addEventListener('resize', function () { clearTimeout(fxTimer); fxTimer = setTimeout(sizeCanvas, 150); });
    document.addEventListener('visibilitychange', function () {
        if (!FX.canvas) return;
        if (document.hidden) { FX.on = false; if (FX.raf) cancelAnimationFrame(FX.raf); FX.raf = 0; }
        else if (!FX.on) { FX.on = true; FX.last = performance.now(); FX.raf = requestAnimationFrame(loop); }
    });

    /* ------------------------------ mount / unmount ------------------------------ */
    function fxAllowed() { return state.effects && !userOff() && !reduced() && slowMemory() >= 0.2; }

    function syncFx() {
        var theme = THEMES[state.theme];
        root.classList.toggle('ss-calm', !state.effects || userOff() || slowMemory() < 0.2);
        root.classList.toggle('ss-lite', liteMemory());
        if (theme && fxAllowed()) { if (!FX.on) startFx(theme); } else stopFx();
        if (mounted.toggle) mounted.toggle.setAttribute('aria-pressed', String(!userOff()));
    }

    function mountLayers(id) {
        var theme = THEMES[id];
        unmountLayers();
        mounted.back = document.createElement('div'); mounted.back.id = 'ss-back'; mounted.back.setAttribute('aria-hidden', 'true');
        mounted.front = document.createElement('div'); mounted.front.id = 'ss-front'; mounted.front.setAttribute('aria-hidden', 'true');
        mounted.back.innerHTML = theme.back.map(function (k) { return LAYERS[k](); }).join('');
        mounted.front.innerHTML = theme.front.map(function (k) { return LAYERS[k](); }).join('');
        document.body.insertBefore(mounted.back, document.body.firstChild);
        document.body.appendChild(mounted.front);
        mounted.id = id;
    }

    function unmountLayers() {
        stopFx();
        [mounted.back, mounted.front].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
        mounted.back = mounted.front = null; mounted.id = null;
    }

    function setFavicon(id) {
        var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>" + THEMES[id].emoji + '</text></svg>';
        var link = document.querySelector('link[rel~="icon"]');
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); mounted.favMade = true; }
        else if (mounted.favOrig === null) mounted.favOrig = [link.getAttribute('href'), link.getAttribute('type')];
        link.setAttribute('type', 'image/svg+xml'); link.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
        mounted.fav = link;
    }
    function restoreFavicon() {
        var link = mounted.fav;
        if (!link) return;
        if (mounted.favMade) link.parentNode && link.parentNode.removeChild(link);
        else if (mounted.favOrig) { link.setAttribute('href', mounted.favOrig[0]); if (mounted.favOrig[1]) link.setAttribute('type', mounted.favOrig[1]); else link.removeAttribute('type'); }
        mounted.fav = null; mounted.favMade = false; mounted.favOrig = null;
    }

    function setupToggle(id) {
        if (!mounted.toggle) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'ss-toggle'; b.title = 'Seasonal effects on or off'; b.setAttribute('aria-label', 'Turn seasonal effects on or off');
            b.addEventListener('click', function () {
                try { localStorage.setItem(FX_KEY, userOff() ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
                syncFx();
            });
            document.body.appendChild(b); mounted.toggle = b;
        }
        mounted.toggle.textContent = THEMES[id].emoji;
        mounted.toggle.setAttribute('aria-pressed', String(!userOff()));
    }

    function greet(id) {
        var day = new Date().toISOString().slice(0, 10), key = 'specsoft.season.greet.' + id;
        try { if (!state.preview && localStorage.getItem(key) === day) return; localStorage.setItem(key, day); } catch (e) { /* ignore */ }
        var n = document.createElement('div'); n.className = 'ss-greet'; n.setAttribute('role', 'status');
        n.innerHTML = '<b></b><span></span>'; n.firstChild.textContent = THEMES[id].emoji; n.lastChild.textContent = THEMES[id].greet;
        document.body.appendChild(n);
        setTimeout(function () { n.classList.add('is-on'); }, 700);
        setTimeout(function () { n.classList.remove('is-on'); }, 6200);
        setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 7200);
    }

    function ensureCss() {
        if (mounted.css && mounted.css.isConnected) return;
        var l = document.getElementById('ss-css') || document.createElement('link');
        l.id = 'ss-css'; l.rel = 'stylesheet'; l.href = CSS_URL;
        if (!l.parentNode) (document.head || root).appendChild(l);
        mounted.css = l;
    }

    function unmountAll() {
        root.removeAttribute('data-season'); root.classList.remove('ss-calm', 'ss-lite');
        unmountLayers(); restoreFavicon();
        if (mounted.toggle && mounted.toggle.parentNode) mounted.toggle.parentNode.removeChild(mounted.toggle);
        mounted.toggle = null;
        if (mounted.css && mounted.css.parentNode) mounted.css.parentNode.removeChild(mounted.css);
        mounted.css = null;
    }

    function apply(next) {
        var id = next && THEMES[next.theme] ? next.theme : null;
        if (id && next.ends_at && Date.parse(next.ends_at) < Date.now()) id = null;       // a remembered season that already ended
        var changed = id !== state.theme;
        state.theme = id; state.effects = !next || next.effects !== false; state.intensity = (next && next.intensity) || 'normal'; state.ends_at = (next && next.ends_at) || null;

        if (!id) { whenBody(function () { if (!state.theme) unmountAll(); }); if (changed) fire(); return; }
        root.setAttribute('data-season', id);
        ensureCss();
        whenBody(function () {
            if (state.theme !== id) return;
            if (changed || mounted.id !== id) { mountLayers(id); setFavicon(id); setupToggle(id); greet(id); }
            syncFx();
        });
        if (changed) fire();
        scheduleEnd();
    }

    function fire() { try { window.dispatchEvent(new CustomEvent('specseason', { detail: { theme: state.theme } })); } catch (e) { /* old browser */ } }

    function scheduleEnd() {                       // switch off by itself the moment the event ends, no reload needed
        clearTimeout(endTimer);
        if (!state.ends_at || state.preview) return;
        var ms = Date.parse(state.ends_at) - Date.now();
        if (ms > 0 && ms < 2147000000) endTimer = setTimeout(refresh, ms + 1500);
    }

    /* ------------------------------ data ------------------------------ */
    function readCache() { try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return c && c.data ? c : null; } catch (e) { return null; } }
    function writeCache(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* ignore */ } }

    function fetchNow() {
        return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/site_theme_now', {
            method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store'
        }).then(function (r) { if (!r.ok) throw new Error('season ' + r.status); return r.json(); });
    }

    function refresh() {
        if (state.preview) return Promise.resolve();
        return fetchNow().then(function (d) { writeCache(d); if (!state.preview) apply(d); }).catch(function () { /* offline or SQL not installed: keep what we have */ });
    }

    /* ------------------------------ preview (for staff) ------------------------------ */
    function preview(id, opts) {
        if (!THEMES[id]) return;
        state.preview = true; clearTimeout(endTimer);
        try { localStorage.removeItem('specsoft.season.greet.' + id); } catch (e) { /* ignore */ }
        apply({ theme: id, effects: true, intensity: (opts && opts.intensity) || 'normal' });
    }
    function endPreview() {
        state.preview = false;
        var c = readCache();
        apply(c ? c.data : null);
        refresh();
    }

    /* ------------------------------ boot ------------------------------ */
    var cached = readCache();
    if (cached) apply(cached.data);                                    // instant, no flash
    if (!cached || Date.now() - cached.at > TTL) refresh();
    checkTimer = setInterval(function () { if (!document.hidden) refresh(); }, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', function () { var c = readCache(); if (!document.hidden && (!c || Date.now() - c.at > TTL)) refresh(); });

    window.SpecSeasons = {
        THEMES: THEMES,
        current: function () { var t = THEMES[state.theme]; return t ? { id: state.theme, name: t.name, emoji: t.emoji, emojis: t.emojis.slice() } : null; },
        preview: preview, endPreview: endPreview, refresh: refresh,
        isPreview: function () { return state.preview; }
    };
})();
