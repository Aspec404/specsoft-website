/* ==========================================================================
   SPECSOFT® super-emotes.js  -  "super emotes": sticker emotes with effects + sound
   Add  <script src="super-emotes.js"></script>  BEFORE chats.js (chats.html) and on
   store-manager.html (the Super Emotes Lab). Needs supabase-store-super-emotes.sql.

   A super emote is a normal store emote (category "emote") that also carries design data:
     {
       "v": 1,
       "hl": "#a78bfa",                 highlight color (picker glow + sticker glow)
       "size": 72, "tilt": 0,           sticker size in px (48-128); tilt is always 0 now (stickers are straight, no outline)
       "intro": "zoom",                 how the sticker appears   (pop bounce wiggle spin zoom dash drop flip rubber glitch fade none)
       "loop": "pulse",                 what it does while the effects run (spin pulse float wiggle heartbeat shake swing tada flicker none)
       "outro": "hop",                  its closing move, then it settles back (spin hop shrink fadedip shake dash none)
       "impact": true,                  zoom / dash / drop landing also fires a shockwave + screen shake
       "glow": true,
       "dur": 3000,                     how long the effects run, in ms (1000-6000)
       "sound": { "src": "https://<project>.supabase.co/storage/v1/object/public/store-super/sounds/x.mp3", "vol": 0.8 },
       "fx": [ { "type": "fire", "colors": ["#ff5a1f", "#ffd24a"], "amount": 6, "speed": 5, "delay": 0 } ]
     }                                  (0 to 4 effect layers)

   Public API (window.SpecSuper)
     COOLDOWN_MS            10000, the wait between two super emotes
     FX                     [[id, label], ...] every effect type
     TEMPLATES              ready-made designs [{ id, name, design }]
     clean(design)          a safe, clamped copy, or null
     validSound(url)        true when the url is a file in the store-super bucket
     decorate(img, design)  turns an <img> into a sticker (size, tilt, glow, entrance animation)
     play(design, opts)     runs the effects + sound. opts: { host, origin:{x,y}, force, silent }
                            returns { stop() }. Only one super emote plays at a time.
     stop()                 stops whatever is playing
     motionOff()            true when Reduce motion / Ultra reduce motion / the OS setting is on
     soundOn()              true unless the member turned Chat sounds off

   Rules it follows: effects stay inside the "host" element (the chat pane) and never block clicks;
   they also show with Reduce motion on, and are switched off only by Ultra reduce motion (or the device's own
   reduced-motion setting), in which case only the sticker and the sound show; the sound follows Settings >
   Chat sounds; every number is clamped and every color must be #rrggbb.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecSuper) return;

    var COOLDOWN_MS = 10000;
    var HEX = /^#[0-9a-fA-F]{6}$/;
    var SOUND_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/storage\/v1\/object\/public\/store-super\/[A-Za-z0-9._\/-]+$/;
    var FX = [
        ['burst', 'Burst (from the emote)'], ['confetti', 'Confetti'], ['fire', 'Fire'], ['rain', 'Rain / tears'],
        ['hearts', 'Floating hearts'], ['stars', 'Twinkling stars'], ['snow', 'Snowfall'], ['lightning', 'Lightning'],
        ['shockwave', 'Shockwave rings'], ['shake', 'Screen shake'], ['flash', 'Flash'], ['glitch', 'Glitch'],
        ['vignette', 'Color pulse (screen edges)'],
        ['sparkles', 'Sparkles'], ['bubbles', 'Bubbles'], ['petals', 'Falling petals'], ['coins', 'Coin shower'],
        ['meteors', 'Meteor shower'], ['smoke', 'Smoke'], ['fireworks', 'Fireworks'], ['speedlines', 'Anime speed lines'],
        ['rays', 'Light rays'], ['spotlight', 'Spotlight'], ['matrix', 'Matrix code rain'], ['scanlines', 'CRT scanlines'],
        ['pixelburst', 'Pixel burst'], ['emojirain', 'Emote rain (uses the emote image)'], ['emojiburst', 'Emote burst (uses the emote image)']
    ];
    var FXID = {}; FX.forEach(function (f) { FXID[f[0]] = true; });
    var INTROS = [['none', 'None'], ['pop', 'Pop in'], ['bounce', 'Bounce in'], ['wiggle', 'Wiggle in'], ['spin', 'Spin in'], ['zoom', 'Zoom slam (impact)'], ['dash', 'Dash in (impact)'], ['drop', 'Drop (impact)'], ['flip', 'Flip in'], ['rubber', 'Rubber band'], ['glitch', 'Glitch in'], ['fade', 'Fade in']];
    var LOOPS = [['none', 'None'], ['spin', 'Spin'], ['pulse', 'Pulse'], ['float', 'Float'], ['wiggle', 'Wiggle'], ['heartbeat', 'Heartbeat'], ['shake', 'Shake'], ['swing', 'Swing'], ['tada', 'Tada'], ['flicker', 'Flicker']];
    var OUTROS = [['none', 'None'], ['spin', 'Spin'], ['hop', 'Hop'], ['shrink', 'Shrink + spring back'], ['fadedip', 'Fade dip'], ['shake', 'Shake it off'], ['dash', 'Dash away and back']];
    function idMap(list) { var m = {}; list.forEach(function (x) { m[x[0]] = true; }); return m; }
    var INTROID = idMap(INTROS), LOOPID = idMap(LOOPS), OUTROID = idMap(OUTROS);
    var LIMITS = { size: [48, 128], tilt: [-20, 20], dur: [1000, 6000], vol: [0.05, 1], amount: [1, 10], speed: [1, 10], delay: [0, 2000], layers: 4, colors: 4 };

    function num(v, lo, hi, def) { v = Number(v); if (!isFinite(v)) v = def; return Math.min(hi, Math.max(lo, v)); }
    function validSound(u) { return typeof u === 'string' && u.length <= 300 && SOUND_RE.test(u) && u.indexOf('..') < 0; }

    function cleanLayer(l) {
        if (!l || typeof l !== 'object' || !FXID[l.type]) return null;
        var cols = (Array.isArray(l.colors) ? l.colors : []).filter(function (c) { return typeof c === 'string' && HEX.test(c); }).slice(0, LIMITS.colors);
        if (!cols.length) cols = ['#ffffff'];
        return { type: l.type, colors: cols, amount: Math.round(num(l.amount, 1, 10, 5)), speed: Math.round(num(l.speed, 1, 10, 5)), delay: Math.round(num(l.delay, 0, 2000, 0)) };
    }
    function clean(d) {
        if (!d || typeof d !== 'object') return null;
        var out = {
            v: 1,
            hl: typeof d.hl === 'string' && HEX.test(d.hl) ? d.hl : '#a78bfa',
            size: Math.round(num(d.size, 48, 128, 72)),
            tilt: 0,                                              // stickers are never tilted
            intro: INTROID[d.intro] ? d.intro : (INTROID[d.anim] ? d.anim : 'pop'),      // older designs used "anim"
            loop: LOOPID[d.loop] ? d.loop : 'none',
            outro: OUTROID[d.outro] ? d.outro : 'none',
            impact: d.impact === true,
            glow: d.glow === true,                                // no glow / outline unless asked for
            dur: Math.round(num(d.dur, 1000, 6000, 3000)),
            sound: null,
            fx: []
        };
        if (d.sound && typeof d.sound === 'object' && validSound(d.sound.src)) out.sound = { src: d.sound.src, vol: Math.round(num(d.sound.vol, 0.05, 1, 0.8) * 100) / 100 };
        (Array.isArray(d.fx) ? d.fx : []).slice(0, LIMITS.layers).forEach(function (l) { var c = cleanLayer(l); if (c) out.fx.push(c); });
        return out;
    }

    /* ---- ready-made designs (the Lab starts from these) ---- */
    function T(id, name, hl, dur, fx, extra) { return { id: id, name: name, design: clean(Object.assign({ v: 1, hl: hl, dur: dur, fx: fx }, extra || {})) }; }
    var TEMPLATES = [
        T('inferno', 'Inferno', '#ff6a2b', 3400, [
            { type: 'fire', colors: ['#ff4d1a', '#ffb02e'], amount: 8, speed: 6 }, { type: 'vignette', colors: ['#ff3b1a'], amount: 5, speed: 5 }, { type: 'shake', colors: ['#ffffff'], amount: 4, speed: 5 }], { intro: 'drop', loop: 'pulse', outro: 'shrink', impact: true }),
        T('skull', 'Skull drop', '#ef4444', 2800, [
            { type: 'shockwave', colors: ['#ff2a2a'], amount: 7, speed: 5 }, { type: 'flash', colors: ['#ff1f1f'], amount: 7, speed: 5 }, { type: 'shake', colors: ['#ffffff'], amount: 8, speed: 5 }, { type: 'vignette', colors: ['#7f0000'], amount: 6, speed: 5 }], { intro: 'zoom', loop: 'shake', outro: 'shake', impact: true }),
        T('party', 'Party time', '#f472b6', 3800, [
            { type: 'confetti', colors: ['#f472b6', '#facc15', '#38bdf8', '#4ade80'], amount: 8, speed: 5 }, { type: 'burst', colors: ['#ffffff', '#facc15'], amount: 7, speed: 6 }], { intro: 'bounce', loop: 'tada', outro: 'hop' }),
        T('sadrain', 'Sad rain', '#60a5fa', 4400, [
            { type: 'rain', colors: ['#7dd3fc', '#60a5fa'], amount: 8, speed: 5 }, { type: 'vignette', colors: ['#1d4ed8'], amount: 4, speed: 5 }], { intro: 'fade', loop: 'float', outro: 'fadedip' }),
        T('thunder', 'Thunderstruck', '#facc15', 2600, [
            { type: 'lightning', colors: ['#fde047', '#ffffff'], amount: 8, speed: 5 }, { type: 'flash', colors: ['#ffffff'], amount: 6, speed: 5 }, { type: 'shake', colors: ['#ffffff'], amount: 6, speed: 5 }], { intro: 'dash', loop: 'flicker', outro: 'dash', impact: true }),
        T('glitch', 'Glitch mode', '#22d3ee', 3000, [
            { type: 'glitch', colors: ['#22d3ee', '#f43f5e', '#ffffff'], amount: 8, speed: 6 }, { type: 'shake', colors: ['#ffffff'], amount: 5, speed: 5 }, { type: 'flash', colors: ['#22d3ee'], amount: 3, speed: 5 }], { intro: 'glitch', loop: 'shake', outro: 'shake' }),
        T('love', 'Love bomb', '#fb7185', 3600, [
            { type: 'hearts', colors: ['#fb7185', '#f472b6', '#fda4af'], amount: 8, speed: 5 }, { type: 'burst', colors: ['#fda4af', '#ffffff'], amount: 6, speed: 5 }], { intro: 'pop', loop: 'heartbeat', outro: 'shrink' }),
        T('frost', 'Frostbite', '#7dd3fc', 4400, [
            { type: 'snow', colors: ['#ffffff', '#bae6fd'], amount: 8, speed: 5 }, { type: 'stars', colors: ['#e0f2fe'], amount: 5, speed: 5 }, { type: 'vignette', colors: ['#38bdf8'], amount: 4, speed: 4 }], { intro: 'flip', loop: 'swing', outro: 'spin' }),
        T('spinner', 'Spin cycle', '#a78bfa', 3200, [
            { type: 'burst', colors: ['#a78bfa', '#ffffff'], amount: 6, speed: 6 }, { type: 'stars', colors: ['#ddd6fe'], amount: 6, speed: 5 }], { intro: 'spin', loop: 'spin', outro: 'spin' }),
        T('matrix', 'Matrix', '#22c55e', 3600, [
            { type: 'matrix', colors: ['#22c55e', '#86efac'], amount: 8, speed: 5 }, { type: 'scanlines', colors: ['#22c55e'], amount: 6, speed: 5 }, { type: 'vignette', colors: ['#052e16'], amount: 5, speed: 5 }], { intro: 'glitch', loop: 'flicker', outro: 'shake' }),
        T('fireworks', 'Fireworks night', '#f59e0b', 4200, [
            { type: 'fireworks', colors: ['#f59e0b', '#ef4444', '#38bdf8', '#a3e635'], amount: 7, speed: 5 }, { type: 'sparkles', colors: ['#fde68a'], amount: 5, speed: 5 }, { type: 'vignette', colors: ['#1e1b4b'], amount: 4, speed: 5 }], { intro: 'pop', loop: 'pulse', outro: 'hop' }),
        T('coins', 'Coin shower', '#facc15', 3600, [
            { type: 'coins', colors: ['#facc15', '#fbbf24'], amount: 8, speed: 5 }, { type: 'sparkles', colors: ['#fff7cc'], amount: 6, speed: 5 }], { intro: 'bounce', loop: 'tada', outro: 'hop' }),
        T('anime', 'Anime impact', '#e5e7eb', 2600, [
            { type: 'speedlines', colors: ['#ffffff'], amount: 8, speed: 5 }, { type: 'shockwave', colors: ['#ffffff'], amount: 6, speed: 5 }, { type: 'flash', colors: ['#ffffff'], amount: 5, speed: 5 }, { type: 'shake', colors: ['#ffffff'], amount: 7, speed: 5 }], { intro: 'zoom', loop: 'shake', outro: 'shake', impact: true }),
        T('spotlight', 'Spotlight', '#fde68a', 3600, [
            { type: 'spotlight', colors: ['#fef3c7'], amount: 7, speed: 5 }, { type: 'rays', colors: ['#fef3c7'], amount: 5, speed: 5 }, { type: 'sparkles', colors: ['#ffffff'], amount: 4, speed: 5 }], { intro: 'fade', loop: 'float', outro: 'fadedip' }),
        T('meteors', 'Meteor shower', '#93c5fd', 4200, [
            { type: 'meteors', colors: ['#bfdbfe', '#ffffff'], amount: 8, speed: 5 }, { type: 'stars', colors: ['#e0f2fe'], amount: 5, speed: 5 }, { type: 'vignette', colors: ['#1e3a8a'], amount: 4, speed: 5 }], { intro: 'drop', loop: 'float', outro: 'spin', impact: true }),
        T('petals', 'Petal storm', '#f9a8d4', 4000, [
            { type: 'petals', colors: ['#f9a8d4', '#fbcfe8', '#fda4af'], amount: 8, speed: 5 }, { type: 'sparkles', colors: ['#ffffff'], amount: 3, speed: 5 }], { intro: 'spin', loop: 'swing', outro: 'spin' }),
        T('emojirain', 'Emote rain', '#a78bfa', 3800, [
            { type: 'emojirain', colors: ['#ffffff'], amount: 7, speed: 5 }, { type: 'emojiburst', colors: ['#ffffff'], amount: 6, speed: 5 }], { intro: 'rubber', loop: 'wiggle', outro: 'hop' })
    ];

    /* ---- environment checks ---- */
    // true = effects and sticker animations are OFF. Reduce motion keeps them; only Ultra reduce motion (or the
    // device's own reduced-motion setting) switches them off.
    function motionOff() {
        var S = window.SpecSettings;
        try { if (S && typeof S.get === 'function' && S.get('ultraReduceMotion') === true) return true; } catch (e) { /* ignore */ }
        try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
    }
    function soundOn() {
        try { var S = window.SpecSettings; if (S && typeof S.get === 'function') { var v = S.get('chatSound'); if (v === false) return false; if (v === true) return true; } } catch (e) { /* ignore */ }
        try { return localStorage.getItem('specsoft.chat.sound') !== 'off'; } catch (e) { return true; }
    }

    /* ---- sticker look (also used by the Lab preview) ---- */
    var CSS = '' +
        '.sp-sx-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:40}' +
        '.sp-sx-layer canvas{display:block;width:100%;height:100%}' +
        '.sp-sticker{--sx-glow:none;width:var(--sx-size,72px);height:var(--sx-size,72px);max-width:none;object-fit:contain;display:inline-block;vertical-align:middle;margin:4px 3px;border-radius:0;' +
        'transform:rotate(var(--sx-tilt,0deg));-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none;' +
        'filter:var(--sx-glow)}' +
        '.sp-sticker.sp-sx-glow{--sx-glow:drop-shadow(0 0 12px var(--sup,#a78bfa))}' +
        '';
    function ensureCss() {
        if (document.getElementById('sp-sx-css')) return;
        var s = document.createElement('style'); s.id = 'sp-sx-css'; s.textContent = CSS; (document.head || document.documentElement).appendChild(s);
    }
    // opts.noIntro: do not play the entrance (the Lab preview paints often)
    function decorate(img, design, opts) {
        var d = clean(design); if (!img || !d) return img;
        ensureCss();
        img.classList.add('sp-sticker');
        if (d.glow) img.classList.add('sp-sx-glow');
        img.style.setProperty('--sx-size', d.size + 'px');
        img.style.setProperty('--sx-tilt', d.tilt + 'deg');
        img.style.setProperty('--sup', d.hl);
        if (!(opts && opts.noIntro) && d.intro !== 'none' && window.requestAnimationFrame) {
            window.requestAnimationFrame(function () { if (img.isConnected) animateSticker(img, d, false, false); });   // when it first shows up in the chat
        }
        return img;
    }

    /* ---- sticker animations: intro, loop, outro (they move the emote itself; fire / snow etc. are the background effects) ---- */
    function R(t, a, extra) { return 'rotate(' + (t + a) + 'deg)' + (extra ? ' ' + extra : ''); }
    function K(t, a, extra, o, off) { var f = { transform: R(t, a, extra) }; if (o != null) f.opacity = o; if (off != null) f.offset = off; return f; }
    var INTRO = {
        pop: function (t) { return { ms: 600, ease: 'cubic-bezier(.2,1.5,.4,1)', f: [K(t, 0, 'scale(.15)', 0), K(t, -8, 'scale(1.18)', 1, 0.6), K(t, 0, 'scale(1)', 1)] }; },
        bounce: function (t) { return { ms: 800, ease: 'cubic-bezier(.3,0,.3,1)', f: [K(t, 0, 'translateY(-40px) scale(.9)', 0), K(t, 0, 'translateY(0) scale(1.08,.9)', 1, 0.45), K(t, 0, 'translateY(-12px)', 1, 0.7), K(t, 0, 'translateY(0)', 1)] }; },
        wiggle: function (t) { return { ms: 700, ease: 'ease-in-out', f: [K(t, 0, 'scale(.5)', 0), K(t, 14, 'scale(1.1)', 1, 0.3), K(t, -12, null, 1, 0.55), K(t, 6, null, 1, 0.8), K(t, 0, null, 1)] }; },
        spin: function (t) { return { ms: 750, ease: 'cubic-bezier(.2,.8,.3,1)', f: [K(t, -540, 'scale(.1)', 0), K(t, 0, 'scale(1)', 1)] }; },
        zoom: function (t) { return { ms: 650, ease: 'cubic-bezier(.1,.9,.2,1)', impactAt: 0.7, f: [K(t, 0, 'scale(3.2)', 0), K(t, 0, 'scale(.88)', 1, 0.7), K(t, 0, 'scale(1)', 1)] }; },
        dash: function (t) { return { ms: 600, ease: 'cubic-bezier(.2,.8,.2,1)', impactAt: 0.72, f: [K(t, 0, 'translateX(-280px) skewX(-28deg) scaleX(1.5)', 0), K(t, 0, 'translateX(14px) skewX(6deg)', 1, 0.72), K(t, 0, 'translateX(0) skewX(0deg)', 1)] }; },
        drop: function (t) { return { ms: 750, ease: 'ease-in', impactAt: 0.55, f: [K(t, 0, 'translateY(-130px) scale(.9,1.1)', 0), K(t, 0, 'translateY(0) scale(1.25,.7)', 1, 0.55), K(t, 0, 'translateY(-14px) scale(.95,1.05)', 1, 0.75), K(t, 0, 'translateY(0) scale(1)', 1)] }; },
        flip: function (t) { return { ms: 700, ease: 'cubic-bezier(.2,.8,.3,1)', f: [K(t, 0, 'perspective(500px) rotateY(-100deg)', 0), K(t, 0, 'perspective(500px) rotateY(0deg)', 1)] }; },
        rubber: function (t) { return { ms: 850, ease: 'ease-out', f: [K(t, 0, 'scale(.2)', 0), K(t, 0, 'scale(1.25,.75)', 1, 0.3), K(t, 0, 'scale(.78,1.22)', 1, 0.4), K(t, 0, 'scale(1.15,.85)', 1, 0.5), K(t, 0, 'scale(.95,1.05)', 1, 0.65), K(t, 0, 'scale(1.05,.95)', 1, 0.75), K(t, 0, 'scale(1)', 1)] }; },
        glitch: function (t) { return { ms: 600, ease: 'linear', f: [K(t, 0, 'translateX(-10px) skewX(12deg)', 0), K(t, 0, 'translateX(8px)', 1, 0.15), K(t, 0, 'translateX(-5px) skewX(-8deg)', 0.25, 0.3), K(t, 0, 'translateX(4px)', 1, 0.45), K(t, 0, 'translateX(-2px)', 0.5, 0.6), K(t, 0, 'translateX(0)', 1)] }; },
        fade: function (t) { return { ms: 520, ease: 'ease-out', f: [K(t, 0, 'scale(.9)', 0), K(t, 0, 'scale(1)', 1)] }; }
    };
    var LOOP = {
        spin: function (t) { return { ms: 1400, ease: 'linear', f: [K(t, 0), K(t, 360)] }; },
        pulse: function (t) { return { ms: 900, ease: 'ease-in-out', f: [K(t, 0, 'scale(1)'), K(t, 0, 'scale(1.14)', null, 0.5), K(t, 0, 'scale(1)')] }; },
        float: function (t) { return { ms: 2000, ease: 'ease-in-out', f: [K(t, 0, 'translateY(0)'), K(t, 0, 'translateY(-9px)', null, 0.5), K(t, 0, 'translateY(0)')] }; },
        wiggle: function (t) { return { ms: 700, ease: 'ease-in-out', f: [K(t, 0), K(t, 9, null, null, 0.25), K(t, -9, null, null, 0.75), K(t, 0)] }; },
        heartbeat: function (t) { return { ms: 1000, ease: 'ease-in-out', f: [K(t, 0, 'scale(1)'), K(t, 0, 'scale(1.2)', null, 0.14), K(t, 0, 'scale(1)', null, 0.28), K(t, 0, 'scale(1.14)', null, 0.42), K(t, 0, 'scale(1)', null, 0.7), K(t, 0, 'scale(1)')] }; },
        shake: function (t) { return { ms: 420, ease: 'linear', f: [K(t, 0, 'translateX(0)'), K(t, 0, 'translateX(-3px)', null, 0.2), K(t, 0, 'translateX(3px)', null, 0.4), K(t, 0, 'translateX(-2px)', null, 0.6), K(t, 0, 'translateX(2px)', null, 0.8), K(t, 0, 'translateX(0)')] }; },
        swing: function (t) { return { ms: 1600, ease: 'ease-in-out', f: [K(t, -12), K(t, 12, null, null, 0.5), K(t, -12)] }; },
        tada: function (t) { return { ms: 1000, ease: 'ease-in-out', f: [K(t, 0, 'scale(1)'), K(t, -3, 'scale(.9)', null, 0.1), K(t, -3, 'scale(.9)', null, 0.2), K(t, 3, 'scale(1.12)', null, 0.3), K(t, -3, 'scale(1.12)', null, 0.4), K(t, 3, 'scale(1.12)', null, 0.5), K(t, -3, 'scale(1.12)', null, 0.6), K(t, 3, 'scale(1.12)', null, 0.7), K(t, 0, 'scale(1)')] }; },
        flicker: function (t) { return { ms: 800, ease: 'linear', f: [K(t, 0, null, 1), K(t, 0, null, 0.3, 0.1), K(t, 0, null, 1, 0.2), K(t, 0, null, 0.55, 0.35), K(t, 0, null, 1, 0.5), K(t, 0, null, 1)] }; }
    };
    var OUTRO = {
        spin: function (t) { return { ms: 900, ease: 'ease-in-out', f: [K(t, 0, 'scale(1)'), K(t, 180, 'scale(.7)', null, 0.5), K(t, 360, 'scale(1)')] }; },
        hop: function (t) { return { ms: 700, ease: 'ease-out', f: [K(t, 0, 'translateY(0) scale(1)'), K(t, 0, 'translateY(-34px) scale(.95,1.08)', null, 0.4), K(t, 0, 'translateY(0) scale(1.18,.8)', null, 0.75), K(t, 0, 'translateY(0) scale(1)')] }; },
        shrink: function (t) { return { ms: 800, ease: 'ease-in-out', f: [K(t, 0, 'scale(1)'), K(t, 0, 'scale(.4)', null, 0.35), K(t, 0, 'scale(1.15)', null, 0.65), K(t, 0, 'scale(1)')] }; },
        fadedip: function (t) { return { ms: 1000, ease: 'ease-in-out', f: [K(t, 0, null, 1), K(t, 0, null, 0.12, 0.5), K(t, 0, null, 1)] }; },
        shake: function (t) { return { ms: 600, ease: 'linear', f: [K(t, 0, 'translateX(0)'), K(t, 0, 'translateX(-8px)', null, 0.15), K(t, 0, 'translateX(7px)', null, 0.3), K(t, 0, 'translateX(-5px)', null, 0.5), K(t, 0, 'translateX(3px)', null, 0.7), K(t, 0, 'translateX(0)')] }; },
        dash: function (t) { return { ms: 800, ease: 'ease-in-out', f: [K(t, 0, 'translateX(0)', 1), K(t, 0, 'translateX(160px) skewX(-22deg)', 0.3, 0.35), K(t, 0, 'translateX(-160px) skewX(22deg)', 0.3, 0.5), K(t, 0, 'translateX(0) skewX(0deg)', 1)] }; }
    };

    function cancelSticker(img) {
        if (!img) return;
        img._spRun = (img._spRun || 0) + 1;
        if (img._spA) { try { img._spA.cancel(); } catch (e) { /* ignore */ } img._spA = null; }
    }
    // intro (always), then loop + outro when "live" (the message was just sent); afterwards the sticker rests normally
    function animateSticker(img, d, live, force) {
        if (!img || !img.animate || (!force && motionOff())) return null;
        cancelSticker(img);
        var run = img._spRun, t = d.tilt, seq = [];
        var intro = d.intro !== 'none' && INTRO[d.intro] ? INTRO[d.intro](t) : null;
        var outro = live && d.outro !== 'none' && OUTRO[d.outro] ? OUTRO[d.outro](t) : null;
        if (intro) seq.push({ f: intro.f, o: { duration: intro.ms, easing: intro.ease } });
        if (live && d.loop !== 'none' && LOOP[d.loop]) {
            var lp = LOOP[d.loop](t), room = d.dur - (intro ? intro.ms : 0) - (outro ? outro.ms : 0), it = Math.round(room / lp.ms);
            if (it >= 1) seq.push({ f: lp.f, o: { duration: lp.ms, easing: lp.ease, iterations: Math.min(it, 40) } });
        }
        if (outro) seq.push({ f: outro.f, o: { duration: outro.ms, easing: outro.ease } });
        var i = 0;
        (function next() {
            if (img._spRun !== run) return;
            if (i >= seq.length) { img._spA = null; return; }
            var s = seq[i++], a;
            try { a = img.animate(s.f, s.o); } catch (e) { return; }
            img._spA = a; a.onfinish = next;
        })();
        return { cancel: function () { if (img._spRun === run) cancelSticker(img); } };
    }
    // the shockwave + screen shake fired when a zoom / dash / drop intro lands
    function impactLayers(d) {
        var I = d.impact && INTRO[d.intro] ? INTRO[d.intro](d.tilt) : null;
        if (!I || !I.impactAt) return [];
        var at = Math.round(I.ms * I.impactAt);
        return [{ type: 'shockwave', colors: [d.hl, '#ffffff'], amount: 5, speed: 6, delay: at }, { type: 'shake', colors: ['#ffffff'], amount: 4, speed: 5, delay: at }];
    }

    /* ---- the effects engine ---- */
    function rgb(hex) { return parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' + parseInt(hex.slice(5, 7), 16); }
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function heartPath(c, s) { c.beginPath(); c.moveTo(0, s * 0.3); c.bezierCurveTo(-s * 0.9, -s * 0.35, -s * 0.5, -s * 0.95, 0, -s * 0.45); c.bezierCurveTo(s * 0.5, -s * 0.95, s * 0.9, -s * 0.35, 0, s * 0.3); c.closePath(); }
    function starPath(c, s) { c.beginPath(); for (var i = 0; i < 10; i++) { var r = i % 2 ? s * 0.45 : s, a = -Math.PI / 2 + i * Math.PI / 5; if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); }
    function sparkPath(c, s) { c.beginPath(); for (var i = 0; i < 8; i++) { var r = i % 2 ? s * 0.22 : s, a = -Math.PI / 2 + i * Math.PI / 4; if (i) c.lineTo(Math.cos(a) * r, Math.sin(a) * r); else c.moveTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); }
    var MCH = '01<>/\\{}[]=+*#$%&';
    function dropPath(c, s) { c.beginPath(); c.moveTo(0, -s * 1.4); c.quadraticCurveTo(s * 0.9, 0, 0, s * 0.7); c.quadraticCurveTo(-s * 0.9, 0, 0, -s * 1.4); c.closePath(); }

    var cur = null;
    function stop() { if (!cur) return; var c = cur; cur = null; c.kill(); }

    function play(design, opts) {
        opts = opts || {};
        var d = clean(design); if (!d) return null;
        stop();
        ensureCss();
        var killed = false, raf = 0, audio = null, audioTimer = 0, layer = null, host = opts.host || null, prevTransform = '', stickerH = null;
        var handle = { stop: function () { if (cur && cur.handle === handle) stop(); else kill(); } };

        function kill() {
            if (killed) return; killed = true;
            if (raf && window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
            if (audioTimer) clearTimeout(audioTimer);
            if (audio) { try { audio.pause(); } catch (e) { /* ignore */ } }
            if (host && host.style) host.style.transform = prevTransform;
            if (stickerH) stickerH.cancel();
            if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
            if (cur && cur.handle === handle) cur = null;
            if (typeof opts.onDone === 'function') { try { opts.onDone(); } catch (e) { /* ignore */ } }
        }
        cur = { kill: kill, handle: handle };

        /* sound */
        if (d.sound && !opts.silent && (opts.force || soundOn())) {
            try {
                audio = new Audio(d.sound.src); audio.volume = d.sound.vol;
                var pr = audio.play(); if (pr && pr.catch) pr.catch(function () { /* blocked until the page was clicked */ });
                audioTimer = setTimeout(function () { try { audio.pause(); } catch (e) { /* ignore */ } }, 12000);
            } catch (e) { audio = null; }
        }

        /* the sticker itself: intro, loop while the effects run, outro */
        if (opts.sticker) stickerH = animateSticker(opts.sticker, d, true, !!opts.force);

        /* visuals */
        var allFx = d.fx.concat(impactLayers(d));
        if (!host || (!opts.force && motionOff()) || !allFx.length) {
            var endAt = setTimeout(function () { if (cur && cur.handle === handle) kill(); }, audio ? 12000 : 50);
            var k0 = kill; kill = function () { clearTimeout(endAt); k0(); };
            cur.kill = kill;
            return handle;
        }
        try { if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) { /* ignore */ }
        layer = document.createElement('div'); layer.className = 'sp-sx-layer'; layer.setAttribute('aria-hidden', 'true');
        var cv = document.createElement('canvas'); layer.appendChild(cv); host.appendChild(layer);
        var W = Math.max(50, host.clientWidth || 600), H = Math.max(50, host.clientHeight || 400);
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        var ctx = cv.getContext('2d');
        if (!ctx) { kill(); return handle; }
        ctx.scale(dpr, dpr);
        prevTransform = host.style.transform || '';

        var ox = opts.origin && isFinite(opts.origin.x) ? opts.origin.x : W / 2;
        var oy = opts.origin && isFinite(opts.origin.y) ? opts.origin.y : H * 0.72;
        var parts = [], bolts = [], rings = [], flashes = [], vigs = [], glitches = [], bgFields = [], fgFields = [], shake = null;
        var emoImg = null;                                    // the emote's own picture, for Emote rain / burst
        try { var esrc = opts.imageUrl || (opts.sticker && (opts.sticker.currentSrc || opts.sticker.src)); if (esrc && window.Image) { emoImg = new window.Image(); emoImg.referrerPolicy = 'no-referrer'; emoImg.src = esrc; } } catch (e) { emoImg = null; }
        function emoReady() { return !!(emoImg && emoImg.complete && emoImg.naturalWidth > 0); }
        var layers = allFx.map(function (l) { return { L: l, started: false, until: 0 }; });
        var spanFor = function (l) { return Math.max(500, d.dur - l.delay); };
        var total = 0; layers.forEach(function (x) { total = Math.max(total, x.L.delay + spanFor(x.L)); });
        total = Math.min(total, 7000);

        function colOf(L) { return L.colors[(Math.random() * L.colors.length) | 0]; }
        function add(p) { if (parts.length < 320) { p.rgb = rgb(p.col); p.max = p.life; p.ph = Math.random() * 6; parts.push(p); } }

        function startLayer(x, t) {
            var L = x.L, sp = L.speed / 5, i, n, a, s, cx;
            x.started = true; x.until = t + spanFor(L);
            if (L.type === 'burst') {
                n = L.amount * 9;
                for (i = 0; i < n; i++) { a = rnd(0, 6.283); s = (2 + rnd(0, 5)) * sp * (1 + L.amount / 10); cx = Math.random() < 0.5; add({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, ay: 0.12, drag: 0.985, life: rnd(50, 90), size: cx ? rnd(5, 9) : rnd(3, 6), rot: rnd(0, 6), vr: rnd(-0.3, 0.3), col: colOf(L), shape: cx ? 'star' : 'circle', add: true }); }
            } else if (L.type === 'confetti') {
                n = L.amount * 6;
                for (i = 0; i < n; i++) add({ x: ox, y: oy, vx: rnd(-5, 5) * sp, vy: -rnd(5, 13) * sp, ay: 0.28, drag: 0.99, life: rnd(110, 170), size: rnd(6, 11), rot: rnd(0, 6), vr: rnd(-0.3, 0.3), col: colOf(L), shape: 'rect' });
            } else if (L.type === 'shockwave') {
                n = Math.ceil(L.amount / 3);
                for (i = 0; i < n; i++) rings.push({ x: ox, y: oy, t: -i * 8, dur: 50 / Math.max(0.5, sp), max: Math.max(W, H) * (0.45 + L.amount * 0.04), col: L.colors[i % L.colors.length], w: 3 + L.amount * 0.5 });
            } else if (L.type === 'flash') {
                flashes.push({ col: L.colors[0], peak: Math.min(0.7, 0.16 + L.amount * 0.05), life: 28 + L.amount * 3, max: 28 + L.amount * 3, wait: 0 });
                if (L.amount >= 6) flashes.push({ col: L.colors[L.colors.length - 1], peak: Math.min(0.6, 0.12 + L.amount * 0.04), life: 24, max: 24, wait: 14 });
            } else if (L.type === 'lightning') {
                n = 2 + Math.floor(L.amount / 4);
                for (i = 0; i < n; i++) {
                    var x0 = rnd(W * 0.15, W * 0.85), pts = [[x0, 0]], segs = 14, yy = 0, xx = x0, tx = clampX(x0 + rnd(-W * 0.25, W * 0.25)), ty = rnd(H * 0.55, H * 0.95);
                    for (var j = 1; j <= segs; j++) { yy = ty * j / segs; xx = x0 + (tx - x0) * j / segs + rnd(-1, 1) * (H / segs) * 0.9; pts.push([xx, yy]); }
                    var wt = i * Math.round(rnd(9, 20));
                    bolts.push({ pts: pts, life: 18, max: 18, wait: wt, col: L.colors[0], core: L.colors[L.colors.length - 1] });
                    flashes.push({ col: L.colors[L.colors.length - 1], peak: 0.22, life: 16, max: 16, wait: wt });
                }
            } else if (L.type === 'shake') {
                shake = { amp: L.amount * 1.1, from: t, until: t + Math.min(1500, 600 + L.amount * 80) };
            } else if (L.type === 'vignette') {
                vigs.push({ col: L.colors[0], peak: Math.min(0.75, 0.2 + L.amount * 0.06), from: t, until: t + spanFor(L), pulses: 1 + Math.floor(L.amount / 4) });
            } else if (L.type === 'glitch') {
                glitches.push({ L: L, until: t + spanFor(L), bars: [], tick: 0 });
            } else if (L.type === 'pixelburst') {
                n = L.amount * 8;
                for (i = 0; i < n; i++) { a = rnd(0, 6.283); s = (2 + rnd(0, 6)) * sp; add({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.5, ay: 0.18, drag: 0.985, life: rnd(40, 75), size: rnd(4, 9), col: colOf(L), shape: 'pixel' }); }
            } else if (L.type === 'emojiburst') {
                if (emoReady()) { n = L.amount * 2 + 6; for (i = 0; i < n; i++) { a = rnd(0, 6.283); s = (3 + rnd(0, 4)) * sp; add({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, ay: 0.14, drag: 0.99, life: rnd(60, 100), size: rnd(16, 30), col: '#ffffff', shape: 'img', vr: rnd(-0.12, 0.12), rot: rnd(0, 6) }); } }
            } else if (L.type === 'speedlines') {
                fgFields.push({ kind: 'speedlines', L: L, from: t, until: t + spanFor(L), tick: 0, lines: [] });
            } else if (L.type === 'scanlines') {
                fgFields.push({ kind: 'scanlines', L: L, from: t, until: t + spanFor(L) });
            } else if (L.type === 'rays' || L.type === 'spotlight') {
                bgFields.push({ kind: L.type, L: L, from: t, until: t + spanFor(L) });
            }
        }
        function clampX(v) { return Math.min(W * 0.95, Math.max(W * 0.05, v)); }

        function emit(x, dtF, t) {
            var L = x.L, sp = L.speed / 5, rate = 0, n, i, a2, s2;
            if (t > x.until) return;
            if (L.type === 'fire') rate = L.amount * 0.9;
            else if (L.type === 'rain') rate = L.amount * 0.7;
            else if (L.type === 'hearts') rate = L.amount * 0.25;
            else if (L.type === 'stars') rate = L.amount * 0.3;
            else if (L.type === 'snow') rate = L.amount * 0.5;
            else if (L.type === 'confetti') rate = L.amount * 0.5;
            else if (L.type === 'sparkles') rate = L.amount * 0.35;
            else if (L.type === 'bubbles') rate = L.amount * 0.25;
            else if (L.type === 'petals') rate = L.amount * 0.3;
            else if (L.type === 'coins') rate = L.amount * 0.3;
            else if (L.type === 'meteors') rate = L.amount * 0.12;
            else if (L.type === 'smoke') rate = L.amount * 0.3;
            else if (L.type === 'matrix') rate = L.amount * 0.6;
            else if (L.type === 'emojirain') { if (!emoReady()) return; rate = L.amount * 0.3; }
            else if (L.type === 'fireworks') {
                x.fw = (x.fw === undefined ? 0 : x.fw) - dtF;
                if (x.fw <= 0) {
                    x.fw = rnd(14, 34) / (0.5 + L.amount / 10);
                    var fx0 = rnd(W * 0.15, W * 0.85), fy0 = rnd(H * 0.12, H * 0.5), fc = colOf(L), nn = 18 + L.amount * 3;
                    for (i = 0; i < nn; i++) { a2 = rnd(0, 6.283); s2 = rnd(1.5, 4.5) * sp; add({ x: fx0, y: fy0, vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2, ay: 0.05, drag: 0.975, life: rnd(40, 75), size: rnd(2, 4), col: Math.random() < 0.25 ? '#ffffff' : fc, shape: 'circle', add: true }); }
                }
                return;
            }
            else return;
            rate *= dtF; n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
            for (i = 0; i < n; i++) {
                if (L.type === 'fire') add({ x: rnd(0, W), y: H + 10, vx: rnd(-0.6, 0.6), vy: -rnd(2, 5.5) * sp * (0.8 + L.amount / 12), ay: -0.01, drag: 0.99, life: rnd(40, 75), size: rnd(10, 28), col: colOf(L), shape: 'glow', add: true, shrink: true });
                else if (L.type === 'rain') add({ x: rnd(0, W), y: -12, vx: -0.4, vy: rnd(7, 13) * sp, ay: 0.05, drag: 1, life: (H + 40) / Math.max(4, 7 * sp) + 20, size: rnd(2.5, 5), col: colOf(L), shape: 'drop' });
                else if (L.type === 'hearts') add({ x: rnd(0, W), y: H + 20, vx: 0, vy: -rnd(1.4, 3.4) * sp, ay: 0, drag: 1, life: (H + 60) / Math.max(1, 1.4 * sp), size: rnd(8, 20), col: colOf(L), shape: 'heart', wob: true, vr: rnd(-0.02, 0.02) });
                else if (L.type === 'stars') add({ x: rnd(0, W), y: rnd(0, H), vx: 0, vy: -0.3, ay: 0, drag: 1, life: rnd(40, 80), size: rnd(4, 12), col: colOf(L), shape: 'star', add: true, vr: rnd(-0.1, 0.1), twinkle: true });
                else if (L.type === 'snow') add({ x: rnd(0, W), y: -10, vx: rnd(-0.5, 0.5), vy: rnd(1.2, 3.2) * sp, ay: 0, drag: 1, life: (H + 30) / Math.max(0.8, 1.2 * sp), size: rnd(2, 5.5), col: colOf(L), shape: 'circle', wob: true });
                else if (L.type === 'confetti') add({ x: rnd(0, W), y: -10, vx: rnd(-1.5, 1.5), vy: rnd(2, 5) * sp, ay: 0.02, drag: 0.998, life: (H + 40) / Math.max(1.5, 2 * sp), size: rnd(6, 11), col: colOf(L), shape: 'rect', vr: rnd(-0.25, 0.25), rot: rnd(0, 6) });
                else if (L.type === 'sparkles') add({ x: rnd(0, W), y: rnd(0, H), vx: 0, vy: 0, ay: 0, drag: 1, life: rnd(25, 50), size: rnd(5, 14), col: colOf(L), shape: 'spark4', add: true, twinkle: true });
                else if (L.type === 'bubbles') add({ x: rnd(0, W), y: H + 14, vx: 0, vy: -rnd(1, 3.2) * sp, ay: 0, drag: 1, life: (H + 60) / Math.max(1, 1.2 * sp), size: rnd(6, 22), col: colOf(L), shape: 'ring', wob: true });
                else if (L.type === 'petals') add({ x: rnd(0, W), y: -14, vx: rnd(-0.8, 0.8), vy: rnd(1, 2.6) * sp, ay: 0, drag: 1, life: (H + 40) / Math.max(0.8, 1.2 * sp), size: rnd(5, 10), col: colOf(L), shape: 'petal', wob: true, vr: rnd(-0.06, 0.06), rot: rnd(0, 6) });
                else if (L.type === 'coins') add({ x: rnd(0, W), y: -20, vx: rnd(-0.6, 0.6), vy: rnd(3, 6) * sp, ay: 0.06, drag: 1, life: (H + 60) / Math.max(2, 3 * sp) + 30, size: rnd(8, 13), col: colOf(L), shape: 'coin' });
                else if (L.type === 'meteors') add({ x: rnd(W * 0.3, W), y: -20, vx: -rnd(5, 9) * sp, vy: rnd(6, 10) * sp, ay: 0, drag: 1, life: (H + 60) / Math.max(3, 6 * sp), size: rnd(1.5, 3), len: rnd(40, 100), col: colOf(L), shape: 'streak', add: true });
                else if (L.type === 'smoke') add({ x: ox + rnd(-30, 30), y: oy + rnd(0, 20), vx: rnd(-0.4, 0.4), vy: -rnd(0.6, 1.8) * sp, ay: 0, drag: 0.995, life: rnd(70, 120), size: rnd(10, 18), grow: 0.35, a: 0.3, col: colOf(L), shape: 'glow' });
                else if (L.type === 'matrix') add({ x: Math.round(rnd(0, W) / 16) * 16, y: -12, vx: 0, vy: rnd(3, 7) * sp, ay: 0, drag: 1, life: (H + 40) / Math.max(2, 3 * sp), size: rnd(11, 16), col: colOf(L), shape: 'char', ch: MCH.charAt((Math.random() * MCH.length) | 0), add: true });
                else if (L.type === 'emojirain') add({ x: rnd(0, W), y: -30, vx: rnd(-0.5, 0.5), vy: rnd(2.5, 5.5) * sp, ay: 0.02, drag: 1, life: (H + 60) / Math.max(1.5, 3 * sp) + 20, size: rnd(18, 34), col: '#ffffff', shape: 'img', vr: rnd(-0.06, 0.06), rot: rnd(0, 6) });
            }
        }

        function drawParticle(p) {
            var k = p.life / p.max, al = Math.min(1, p.life / (p.max * 0.35));
            if (p.twinkle) al *= 0.5 + 0.5 * Math.sin(p.ph * 3);
            var sz = p.shrink ? p.size * (0.3 + 0.7 * k) : p.size;
            ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, al)); ctx.translate(p.x, p.y); if (p.rot) ctx.rotate(p.rot);
            if (p.shape === 'glow') {
                var ga = p.a == null ? 1 : p.a, g = ctx.createRadialGradient(0, 0, 0, 0, 0, sz);
                g.addColorStop(0, 'rgba(' + p.rgb + ',' + ga + ')'); g.addColorStop(1, 'rgba(' + p.rgb + ',0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sz, 0, 6.283); ctx.fill();
            } else if (p.shape === 'img') {
                if (emoReady()) ctx.drawImage(emoImg, -sz / 2, -sz / 2, sz, sz);
            } else if (p.shape === 'streak') {
                var ang = Math.atan2(p.vy, p.vx), tx = -Math.cos(ang) * p.len, ty = -Math.sin(ang) * p.len;
                var sg = ctx.createLinearGradient(0, 0, tx, ty); sg.addColorStop(0, 'rgba(' + p.rgb + ',1)'); sg.addColorStop(1, 'rgba(' + p.rgb + ',0)');
                ctx.strokeStyle = sg; ctx.lineWidth = sz; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tx, ty); ctx.stroke();
            } else if (p.shape === 'char') {
                ctx.fillStyle = p.col; ctx.font = Math.round(sz) + 'px monospace'; ctx.fillText(p.ch || '0', 0, 0);
            } else if (p.shape === 'ring') {
                ctx.strokeStyle = p.col; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, sz, 0, 6.283); ctx.stroke();
                ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.arc(-sz * 0.35, -sz * 0.35, sz * 0.22, 0, 6.283); ctx.fillStyle = p.col; ctx.fill();
            } else if (p.shape === 'coin') {
                ctx.scale(Math.abs(Math.cos(p.ph * 3)) * 0.9 + 0.1, 1);
                ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(0, 0, sz, 0, 6.283); ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, sz * 0.65, 0, 6.283); ctx.stroke();
            } else {
                ctx.fillStyle = p.col;
                if (p.shape === 'rect') ctx.fillRect(-sz / 2, -sz / 3, sz, sz * 0.66);
                else if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, sz, 0, 6.283); ctx.fill(); }
                else if (p.shape === 'heart') { heartPath(ctx, sz); ctx.fill(); }
                else if (p.shape === 'star') { starPath(ctx, sz); ctx.fill(); }
                else if (p.shape === 'spark4') { sparkPath(ctx, sz); ctx.fill(); }
                else if (p.shape === 'drop') { dropPath(ctx, sz); ctx.fill(); }
                else if (p.shape === 'pixel') ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
                else if (p.shape === 'petal') { ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.5, 0, 0, 6.283); ctx.fill(); }
            }
            ctx.restore();
        }

        var startTs = 0, lastTs = 0;
        function frame(ts) {
            if (killed) return;
            raf = window.requestAnimationFrame(frame);
            if (!startTs) { startTs = ts; lastTs = ts; }
            var t = ts - startTs, dtF = Math.min(3, Math.max(0.2, (ts - lastTs) / 16.667)); lastTs = ts;
            var i, p;
            layers.forEach(function (x) { if (!x.started && t >= x.L.delay) startLayer(x, t); if (x.started) emit(x, dtF, t); });

            ctx.clearRect(0, 0, W, H);
            /* edge color pulses */
            for (i = vigs.length - 1; i >= 0; i--) {
                var v = vigs[i], pr = (t - v.from) / (v.until - v.from);
                if (pr >= 1) { vigs.splice(i, 1); continue; }
                var va = v.peak * Math.pow(Math.max(0, Math.sin(pr * v.pulses * Math.PI)), 2);
                var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
                vg.addColorStop(0, 'rgba(' + rgb(v.col) + ',0)'); vg.addColorStop(1, 'rgba(' + rgb(v.col) + ',' + va.toFixed(3) + ')');
                ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
            }
            /* background fields: light rays, spotlight */
            for (i = bgFields.length - 1; i >= 0; i--) {
                var bf = bgFields[i], bp = (t - bf.from) / (bf.until - bf.from);
                if (bp >= 1) { bgFields.splice(i, 1); continue; }
                var env = Math.max(0, Math.min(1, bp * 6, (1 - bp) * 4));
                if (bf.kind === 'rays') {
                    var nr = 6 + bf.L.amount, base = (t - bf.from) * 0.0005 * (bf.L.speed / 5), R0 = Math.max(W, H) * 1.5, hw = Math.PI / nr * 0.5;
                    ctx.save(); ctx.globalCompositeOperation = 'lighter';
                    ctx.fillStyle = 'rgba(' + rgb(bf.L.colors[0]) + ',' + ((0.05 + bf.L.amount * 0.014) * env).toFixed(3) + ')';
                    for (var kk = 0; kk < nr; kk++) { var ra = base + kk * 6.283 / nr; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(ra - hw) * R0, oy + Math.sin(ra - hw) * R0); ctx.lineTo(ox + Math.cos(ra + hw) * R0, oy + Math.sin(ra + hw) * R0); ctx.closePath(); ctx.fill(); }
                    ctx.restore();
                } else {
                    var cw = Math.max(60, Math.min(W, H) * 0.2 * (0.8 + bf.L.amount * 0.05)), fy = oy + 60;
                    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,' + (0.38 * env).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H);
                    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000';
                    ctx.beginPath(); ctx.moveTo(ox - cw * 0.25, 0); ctx.lineTo(ox + cw * 0.25, 0); ctx.lineTo(ox + cw, fy); ctx.lineTo(ox - cw, fy); ctx.closePath(); ctx.fill();
                    ctx.beginPath(); ctx.ellipse(ox, fy, cw * 1.1, cw * 0.28, 0, 0, 6.283); ctx.fill();
                    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(' + rgb(bf.L.colors[0]) + ',' + (0.12 * env).toFixed(3) + ')';
                    ctx.beginPath(); ctx.moveTo(ox - cw * 0.25, 0); ctx.lineTo(ox + cw * 0.25, 0); ctx.lineTo(ox + cw, fy); ctx.lineTo(ox - cw, fy); ctx.closePath(); ctx.fill();
                    ctx.restore();
                }
            }
            /* particles */
            for (i = parts.length - 1; i >= 0; i--) {
                p = parts[i]; p.life -= dtF;
                if (p.life <= 0) { parts.splice(i, 1); continue; }
                p.vy += (p.ay || 0) * dtF; p.vx *= Math.pow(p.drag || 1, dtF);
                p.x += p.vx * dtF; p.y += p.vy * dtF;
                if (p.vr) p.rot = (p.rot || 0) + p.vr * dtF;
                p.ph += 0.06 * dtF; if (p.wob) p.x += Math.sin(p.ph) * 0.7 * dtF;
                if (p.grow) p.size += p.grow * dtF;
                if (p.shape === 'char' && Math.random() < 0.08) p.ch = MCH.charAt((Math.random() * MCH.length) | 0);
                if (p.y < -120 || p.y > H + 100 || p.x < -220 || p.x > W + 220) { parts.splice(i, 1); continue; }
            }
            ctx.globalCompositeOperation = 'source-over';
            for (i = 0; i < parts.length; i++) if (!parts[i].add) drawParticle(parts[i]);
            ctx.globalCompositeOperation = 'lighter';
            for (i = 0; i < parts.length; i++) if (parts[i].add) drawParticle(parts[i]);
            ctx.globalCompositeOperation = 'source-over';
            /* shockwaves */
            for (i = rings.length - 1; i >= 0; i--) {
                var r = rings[i]; r.t += dtF;
                if (r.t < 0) continue;
                var rp = r.t / r.dur; if (rp >= 1) { rings.splice(i, 1); continue; }
                var ease = 1 - Math.pow(1 - rp, 3);
                ctx.save(); ctx.globalAlpha = (1 - rp) * 0.85; ctx.strokeStyle = r.col; ctx.lineWidth = r.w * (1 - rp * 0.6);
                ctx.beginPath(); ctx.arc(r.x, r.y, r.max * ease, 0, 6.283); ctx.stroke(); ctx.restore();
            }
            /* lightning */
            for (i = bolts.length - 1; i >= 0; i--) {
                var b = bolts[i];
                if (b.wait > 0) { b.wait -= dtF; continue; }
                b.life -= dtF; if (b.life <= 0) { bolts.splice(i, 1); continue; }
                var ba = Math.min(1, b.life / b.max * 1.6) * (Math.random() < 0.15 ? 0.4 : 1);
                ctx.save(); ctx.globalAlpha = ba; ctx.lineJoin = 'round'; ctx.shadowColor = b.col; ctx.shadowBlur = 18;
                ctx.strokeStyle = b.col; ctx.lineWidth = 4; ctx.beginPath();
                b.pts.forEach(function (q, qi) { if (qi) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
                ctx.shadowBlur = 0; ctx.strokeStyle = b.core; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
            }
            /* glitch bars */
            for (i = glitches.length - 1; i >= 0; i--) {
                var gl = glitches[i];
                if (t > gl.until) { glitches.splice(i, 1); continue; }
                gl.tick -= dtF;
                if (gl.tick <= 0) {
                    gl.tick = rnd(2, 5); gl.bars = [];
                    var nb = gl.L.amount + 2;
                    for (var q = 0; q < nb; q++) gl.bars.push({ y: rnd(0, H), h: rnd(2, 18), x: rnd(-40, W * 0.6), w: rnd(W * 0.2, W * 0.9), col: gl.L.colors[(Math.random() * gl.L.colors.length) | 0], a: rnd(0.2, 0.55) });
                }
                gl.bars.forEach(function (bar) { ctx.globalAlpha = bar.a; ctx.fillStyle = bar.col; ctx.fillRect(bar.x, bar.y, bar.w, bar.h); });
                ctx.globalAlpha = 1;
            }
            /* foreground fields: anime speed lines, CRT scanlines */
            for (i = fgFields.length - 1; i >= 0; i--) {
                var ff = fgFields[i], fp = (t - ff.from) / (ff.until - ff.from);
                if (fp >= 1) { fgFields.splice(i, 1); continue; }
                var fe = Math.max(0, Math.min(1, fp * 8, (1 - fp) * 5));
                if (ff.kind === 'speedlines') {
                    ff.tick -= dtF;
                    if (ff.tick <= 0) {
                        ff.tick = rnd(2, 4); ff.lines = [];
                        for (var nl = 18 + ff.L.amount * 5; nl > 0; nl--) { var an = rnd(0, 6.283); ff.lines.push({ a: an, r0: rnd(0.28, 0.55) * Math.min(W, H), len: rnd(0.25, 0.8) * Math.max(W, H), w: rnd(0.8, 2.6), col: ff.L.colors[(Math.random() * ff.L.colors.length) | 0] }); }
                    }
                    ctx.save(); ctx.globalAlpha = 0.65 * fe;
                    ff.lines.forEach(function (ln) { ctx.strokeStyle = ln.col; ctx.lineWidth = ln.w; ctx.beginPath(); ctx.moveTo(ox + Math.cos(ln.a) * ln.r0, oy + Math.sin(ln.a) * ln.r0); ctx.lineTo(ox + Math.cos(ln.a) * (ln.r0 + ln.len), oy + Math.sin(ln.a) * (ln.r0 + ln.len)); ctx.stroke(); });
                    ctx.restore();
                } else {
                    var sc = rgb(ff.L.colors[0]);
                    ctx.save(); ctx.globalAlpha = 0.5 * fe; ctx.fillStyle = 'rgba(' + sc + ',' + (0.04 + ff.L.amount * 0.008).toFixed(3) + ')';
                    for (var sy = 0; sy < H; sy += 4) ctx.fillRect(0, sy, W, 1.4);
                    var by = ((t - ff.from) * 0.35 * (ff.L.speed / 5)) % (H + 80) - 40, sbg = ctx.createLinearGradient(0, by - 40, 0, by + 40);
                    sbg.addColorStop(0, 'rgba(' + sc + ',0)'); sbg.addColorStop(0.5, 'rgba(' + sc + ',0.22)'); sbg.addColorStop(1, 'rgba(' + sc + ',0)');
                    ctx.globalAlpha = fe; ctx.fillStyle = sbg; ctx.fillRect(0, by - 40, W, 80); ctx.restore();
                }
            }
            /* flashes */
            for (i = flashes.length - 1; i >= 0; i--) {
                var f = flashes[i];
                if (f.wait > 0) { f.wait -= dtF; continue; }
                f.life -= dtF; if (f.life <= 0) { flashes.splice(i, 1); continue; }
                ctx.globalAlpha = f.peak * Math.pow(f.life / f.max, 1.5); ctx.fillStyle = f.col; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
            }
            /* screen shake */
            if (shake) {
                if (t >= shake.until) { host.style.transform = prevTransform; shake = null; }
                else { var dec = 1 - (t - shake.from) / (shake.until - shake.from); host.style.transform = 'translate(' + (rnd(-1, 1) * shake.amp * dec).toFixed(2) + 'px,' + (rnd(-1, 1) * shake.amp * dec).toFixed(2) + 'px)'; }
            }
            /* done? */
            var allStarted = layers.every(function (x) { return x.started; });
            var busy = parts.length || bolts.length || rings.length || flashes.length || vigs.length || glitches.length || bgFields.length || fgFields.length || shake;
            if (t > 9000 || (allStarted && t > total && !busy)) kill();
        }
        raf = window.requestAnimationFrame(frame);
        return handle;
    }

    window.SpecSuper = {
        COOLDOWN_MS: COOLDOWN_MS, FX: FX, INTROS: INTROS, LOOPS: LOOPS, OUTROS: OUTROS, ANIMS: INTROS, LIMITS: LIMITS, TEMPLATES: TEMPLATES,
        clean: clean, validSound: validSound, decorate: decorate, animateSticker: animateSticker, play: play, stop: stop, motionOff: motionOff, soundOn: soundOn
    };
})();
