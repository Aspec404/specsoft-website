/* ==========================================================================
   SPECSOFT® avatar-frames.js  -  profile frames (CSS rings and uploaded images)
   Add  <script src="avatar-frames.js"></script>  to any page that shows avatars.
   Needs supabase-config.js (to look up who wears what, and to know where frame images may come from)
   and supabase-store-frames.sql. Image frames also need supabase-store-frames-images.sql.

   Three kinds of frame data are understood:
     v1  {"style":"spin","c1":"#7F77DD","c2":"#D4537E","speed":3}          the original 9 templates
     v2  {"v":2,"shape":"circle","avatarShape":false,"layers":[ {...}, ]}   the layered designer (up to 4 layers)
     v3  {"v":3,"shape":"circle","layers":[ 0 to 4 ],"image":{"src":"https://.../store-frames/frames/x.png","scale":1.35,"x":0,"y":0,"rot":0}}
                                                                              an uploaded PNG / GIF / WebP on top of the avatar, optional layers underneath

   Public API (window.SpecFrames)
     STYLES, SHAPES, LAYER_TYPES, LIMITS   lists
     TEMPLATES                    ready-made v2 frames [{id,name,frame}]
     clean(frame)                 a safe, clamped copy of v1 or v2 data, or null
     toV2(frame)                  any frame as v2 (this is how the designer opens old frames)
     apply(node, frame)           put a frame on one avatar (null removes it)
     adorn(node, userId)          look up that member's equipped frame and apply it
     setMine(userId, frame)       tell every avatar on the page about a new frame
     forUsers([ids])              Promise, fills the cache for those members

   Works on the round ".sp-avatar" element used across the site. A frame is a decoration
   child, so the avatar itself (image, letter, status dot) is untouched.
   Frames are DATA: every number is clamped and every color must be #rrggbb, and the CSS is
   built here, so a frame can never inject CSS or cover the page. An image can only come from this project's
   public "store-frames" storage bucket (only store admins can upload there).
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecFrames) return;

    var STYLES = ['spin', 'rainbow', 'pulse', 'orbit', 'neon', 'fire', 'dots', 'aurora', 'twin'];
    var SHAPES = { circle: '50%', squircle: '32%', rounded: '18%', square: '5%', petal: '50% 6% 50% 6%', blob: '58% 42% 52% 48% / 46% 56% 44% 54%' };
    var LAYER_TYPES = ['ring', 'gradient', 'dashed', 'dotted', 'glow', 'dots', 'sparkles', 'ripple', 'lightning', 'hearts', 'stars', 'snow', 'shimmer', 'glitch'];
    var LAB = { lightning: 1, hearts: 1, stars: 1, snow: 1, shimmer: 1, glitch: 1 };   // the Frame Lab effects
    var BLENDS = ['normal', 'screen', 'lighten', 'overlay', 'color-dodge', 'difference'];
    var LIMITS = { width: [0.5, 14], gap: [-8, 30], opacity: [5, 100], speed: [0, 40], pulse: [0, 100], pulseSpeed: [0.4, 10], flicker: [0, 100], count: [1, 12], size: [1, 16], arc: [5, 100], blur: [0, 40], delay: [0, 10], hue: [0, 30] };
    var DEFAULTS = { width: 4, gap: 1, opacity: 100, speed: 3, pulse: 0, pulseSpeed: 2, flicker: 0, count: 6, size: 5, arc: 60, blur: 10, delay: 0, hue: 0 };
    var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    var TTL = 5 * 60 * 1000;
    var IMG_LIMITS = { scale: [0.5, 3, 1.35], x: [-50, 50, 0], y: [-50, 50, 0], rot: [-180, 180, 0] };

    var CFG = window.SPECSOFT_CONFIG || {};
    // frame images may only come from this project's public "store-frames" bucket
    var IMG_PREFIX = CFG.SUPABASE_URL ? String(CFG.SUPABASE_URL).replace(/\/+$/, '') + '/storage/v1/object/public/store-frames/' : '';
    function imgOk(src) {
        return !!IMG_PREFIX && typeof src === 'string' && src.length < 300 && src.indexOf(IMG_PREFIX) === 0 &&
            /^[A-Za-z0-9._\/-]+$/.test(src.slice(IMG_PREFIX.length)) && src.indexOf('..') < 0;
    }
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

    /* ------------------------------ styles ------------------------------ */
    (function injectStyles() {
        if (document.getElementById('sf-styles')) return;
        var ring = '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t)),#000 calc(100% - var(--sf-t)));' +
                   'mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t)),#000 calc(100% - var(--sf-t)))';
        var css = [
            '.sf-has{--sf-t:clamp(2px,.17em,7px);--sf-u:calc(var(--sp-size,32px) / 100);overflow:visible!important}',
            '.sf-has>img{border-radius:50%}',
            '.sf-fx{position:absolute;inset:calc(-1 * (var(--sf-t) + 1px));border-radius:50%;pointer-events:none;z-index:3;font-style:normal;font-size:inherit;--sf-d:calc(var(--sf-speed,3) * 1s)}',
            '.sf-fx::before,.sf-fx::after{content:"";position:absolute;inset:0;border-radius:50%;box-sizing:border-box}',

            '.sf-s-spin .sf-fx::before{background:conic-gradient(from 0deg,transparent 0 38%,var(--sf-c1) 78%,var(--sf-c2) 100%);' + ring + ';animation:sfSpin var(--sf-d) linear infinite}',
            '.sf-s-rainbow .sf-fx::before{background:conic-gradient(#ff4d4d,#ffb84d,#f6ff4d,#4dff88,#4dc3ff,#9a4dff,#ff4dd2,#ff4d4d);' + ring + ';animation:sfSpin var(--sf-d) linear infinite}',
            '.sf-s-pulse .sf-fx::before{border:var(--sf-t) solid var(--sf-c1);animation:sfPulse var(--sf-d) ease-in-out infinite}',
            '.sf-s-orbit .sf-fx::before{border:var(--sf-t) dashed var(--sf-c1);animation:sfSpin calc(var(--sf-d) * 3) linear infinite}',
            '.sf-s-orbit .sf-fx::after{inset:var(--sf-t);border:1px solid var(--sf-c2);opacity:.7}',
            '.sf-s-neon .sf-fx::before{border:calc(var(--sf-t) * .7) solid var(--sf-c1);box-shadow:0 0 .35em var(--sf-c1),inset 0 0 .35em var(--sf-c1);animation:sfFlicker calc(var(--sf-d) * 2) linear infinite}',
            '.sf-s-neon .sf-fx::after{inset:calc(var(--sf-t) * -1);border:1px solid var(--sf-c2);box-shadow:0 0 .6em var(--sf-c2);opacity:.85;animation:sfFlicker calc(var(--sf-d) * 3) linear infinite reverse}',
            '.sf-s-fire .sf-fx{filter:drop-shadow(0 0 .22em var(--sf-c1))}',
            '.sf-s-fire .sf-fx::before{inset:calc(var(--sf-t) * -.5);background:conic-gradient(from 0deg,var(--sf-c1),var(--sf-c2),var(--sf-c1),var(--sf-c2),var(--sf-c1));' +
                '-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t) * 1.6),#000 calc(100% - var(--sf-t) * 1.6));mask:radial-gradient(farthest-side,transparent calc(100% - var(--sf-t) * 1.6),#000 calc(100% - var(--sf-t) * 1.6));' +
                'animation:sfSpin calc(var(--sf-d) * .7) linear infinite}',
            '.sf-s-fire .sf-fx::after{background:conic-gradient(from 180deg,transparent 0 35%,var(--sf-c2) 62%,transparent 90%);' + ring + ';animation:sfSpin calc(var(--sf-d) * 1.1) linear infinite reverse,sfFlame 1.1s ease-in-out infinite alternate}',
            '.sf-s-dots .sf-fx::before{border:var(--sf-t) dotted var(--sf-c1);animation:sfSpin var(--sf-d) linear infinite}',
            '.sf-s-dots .sf-fx::after{inset:calc(var(--sf-t) * -1.8);border:calc(var(--sf-t) * .6) dotted var(--sf-c2);animation:sfSpin calc(var(--sf-d) * 1.4) linear infinite reverse}',
            '.sf-s-aurora .sf-fx{filter:drop-shadow(0 0 .3em var(--sf-c1)) drop-shadow(0 0 .7em var(--sf-c2))}',
            '.sf-s-aurora .sf-fx::before{background:conic-gradient(from 0deg,var(--sf-c1),var(--sf-c2),var(--sf-c1));' + ring + ';animation:sfSpin calc(var(--sf-d) * 2) linear infinite}',
            '.sf-s-aurora .sf-fx::after{inset:calc(var(--sf-t) * -.9);background:conic-gradient(from 90deg,transparent 0 30%,var(--sf-c2) 60%,transparent 90%);' + ring + ';opacity:.8;animation:sfSpin calc(var(--sf-d) * 1.5) linear infinite reverse}',
            '.sf-s-twin .sf-fx::before{background:conic-gradient(from 0deg,transparent 0 45%,var(--sf-c1) 100%);' + ring + ';animation:sfSpin var(--sf-d) linear infinite}',
            '.sf-s-twin .sf-fx::after{inset:calc(var(--sf-t) * -1.7);background:conic-gradient(from 180deg,transparent 0 45%,var(--sf-c2) 100%);' + ring + ';animation:sfSpin calc(var(--sf-d) * 1.3) linear infinite reverse}',
            '.sf-has .sf-fx::before,.sf-has .sf-fx::after{will-change:transform}',

            /* ---- v2 layered frames ---- */
            '.sf-v2>img{border-radius:inherit}',
            '.sf-v2 .sf-fx{inset:0;border-radius:var(--sf-r,50%)}',
            '.sf-v2 .sf-fx::before,.sf-v2 .sf-fx::after{display:none}',
            '.sf-l{position:absolute;box-sizing:border-box;border-radius:var(--sf-r,50%);opacity:var(--lo,1);will-change:transform}',
            '.sf-t-gradient{background-origin:border-box;background-clip:border-box;-webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0) border-box;-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0) border-box;mask-composite:exclude}',
            '.sf-t-dots,.sf-t-sparkles{border-radius:50%}',
            '.sf-d{position:absolute;inset:0;pointer-events:none}',
            '.sf-img{position:absolute;pointer-events:none;user-select:none;-webkit-user-drag:none}',
            '.sf-d::before{content:"";position:absolute;left:50%;top:0;width:var(--ds);height:var(--ds);margin:calc(var(--ds) / -2) 0 0 calc(var(--ds) / -2);border-radius:50%;background:var(--dc);box-shadow:0 0 calc(var(--ds) * 1.1) var(--dc)}',
            '.sf-t-sparkles .sf-d::before{border-radius:0;box-shadow:none;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);animation:sfTwinkle var(--tw,1.8s) ease-in-out infinite;animation-delay:var(--td,0s)}',

            /* ---- Frame Lab ---- */
            '.sf-p{position:absolute;width:var(--ps);height:var(--ps);margin:calc(var(--ps) / -2) 0 0 calc(var(--ps) / -2);opacity:0;pointer-events:none}',
            '.sf-p-stars{background:var(--dc);clip-path:polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)}',
            '.sf-p-snow{background:var(--dc);border-radius:50%;box-shadow:0 0 calc(var(--ps) * .9) var(--dc)}',
            '.sf-p-hearts::before,.sf-p-hearts::after{content:\"\";position:absolute;top:0;width:50%;height:80%;background:var(--dc);border-radius:50% 50% 0 0}',
            '.sf-p-hearts::before{left:50%;transform:rotate(-45deg);transform-origin:0 100%}',
            '.sf-p-hearts::after{left:0;transform:rotate(45deg);transform-origin:100% 100%}',
            '.sf-t-lightning .sf-d{filter:drop-shadow(0 0 calc(var(--ds) * .35) var(--dc))}',
            '.sf-t-lightning .sf-d::before{width:calc(var(--ds) * .62);height:calc(var(--ds) * 1.5);margin:calc(var(--ds) * -.75) 0 0 calc(var(--ds) * -.31);border-radius:0;box-shadow:none;background:var(--dc);clip-path:polygon(55% 0,18% 56%,46% 56%,30% 100%,86% 40%,56% 40%,78% 0);opacity:0;animation:sfBolt var(--tw,3s) linear infinite;animation-delay:var(--td,0s)}',
            '.sf-t-glitch{border-style:solid;border-color:transparent}',
            '@keyframes sfHue{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(360deg)}}',
            '@keyframes sfShine{0%{background-position:0% 0}45%,100%{background-position:100% 0}}',
            '@keyframes sfFloat{0%{opacity:0;transform:translate(0,0) scale(.4)}18%{opacity:1}100%{opacity:0;transform:translate(var(--dx,0),var(--dy,0)) scale(1)}}',
            '@keyframes sfBolt{0%,84%,100%{opacity:0}86%{opacity:1}89%{opacity:.2}92%{opacity:1}96%{opacity:0}}',
            '@keyframes sfGlitchA{0%,86%,100%{translate:0 0;clip-path:none}88%{translate:6% -3%;clip-path:inset(0 0 55% 0)}91%{translate:-7% 2%;clip-path:inset(45% 0 0 0)}94%{translate:4% 4%;clip-path:inset(20% 0 30% 0)}97%{translate:-3% -2%;clip-path:none}}',
            '@keyframes sfGlitchB{0%,86%,100%{translate:0 0;clip-path:none}89%{translate:-6% 3%;clip-path:inset(50% 0 0 0)}92%{translate:7% -2%;clip-path:inset(0 0 45% 0)}95%{translate:-4% -4%;clip-path:inset(30% 0 20% 0)}98%{translate:3% 2%;clip-path:none}}',

            '@property --ga{syntax:"<angle>";inherits:false;initial-value:0deg}',
            '@keyframes sfAng{to{--ga:360deg}}',
            '@keyframes sfSpin{to{transform:rotate(360deg)}}',
            '@keyframes sfPulse{0%,100%{box-shadow:0 0 .35em .02em var(--sf-c1),inset 0 0 .2em var(--sf-c1)}50%{box-shadow:0 0 1em .25em var(--sf-c2),inset 0 0 .4em var(--sf-c2)}}',
            '@keyframes sfFlicker{0%,18%,22%,25%,53%,57%,100%{opacity:1}20%,24%,55%{opacity:.45}}',
            '@keyframes sfFlame{from{opacity:.55}to{opacity:1}}',
            '@keyframes sfBreathe{from{scale:1}to{scale:var(--lz,1.1)}}',
            '@keyframes sfFlick2{0%,18%,22%,25%,53%,57%,100%{opacity:var(--lo,1)}20%,24%,55%{opacity:calc(var(--lo,1) * (1 - var(--lf,.4)))}}',
            '@keyframes sfRipple{from{scale:1;opacity:var(--lo,1)}to{scale:var(--rx,1.3);opacity:0}}',
            '@keyframes sfTwinkle{0%,100%{scale:.15;opacity:.15}50%{scale:1;opacity:1}}',
            '@media (prefers-reduced-motion:reduce){.sf-fx::before,.sf-fx::after,.sf-l,.sf-p,.sf-t-sparkles .sf-d::before,.sf-t-lightning .sf-d::before{animation:none!important}.sf-p{opacity:.8}}'
        ].join('\n');
        var st = document.createElement('style');
        st.id = 'sf-styles';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    })();

    /* ------------------------------ cleaning ------------------------------ */
    function round2(n) { return Math.round(n * 100) / 100; }

    function clean1(f) {
        var style = String(f.style || '');
        if (STYLES.indexOf(style) < 0) return null;
        var c1 = String(f.c1 || ''), c2 = String(f.c2 || f.c1 || '');
        if (!COLOR_RE.test(c1) || !COLOR_RE.test(c2)) return null;
        var speed = Number(f.speed);
        if (!isFinite(speed)) speed = 3;
        return { style: style, c1: c1, c2: c2, speed: Math.min(20, Math.max(0.5, speed)) };
    }

    function num(v, k) {
        var n = Number(v);
        if (!isFinite(n)) n = DEFAULTS[k];
        return round2(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n)));
    }

    function cleanLayer(l) {
        if (!l || typeof l !== 'object' || LAYER_TYPES.indexOf(l.type) < 0) return null;
        var colors = (Array.isArray(l.colors) ? l.colors : []).filter(function (c) { return typeof c === 'string' && COLOR_RE.test(c); }).slice(0, 5);
        if (!colors.length) return null;
        var o = { type: l.type, colors: colors, dir: Number(l.dir) < 0 ? -1 : 1, blend: BLENDS.indexOf(l.blend) >= 0 ? l.blend : 'normal' };
        Object.keys(LIMITS).forEach(function (k) { o[k] = num(l[k], k); });
        return o;
    }

    function clean2(f) {
        var layers = (Array.isArray(f.layers) ? f.layers : []).slice(0, 4).map(cleanLayer).filter(Boolean);
        if (!layers.length) return null;
        return { v: 2, shape: SHAPES[f.shape] ? f.shape : 'circle', avatarShape: f.avatarShape === true, layers: layers };
    }

    function imgNum(v, k) {
        var lim = IMG_LIMITS[k], n = Number(v);
        if (!isFinite(n)) n = lim[2];
        return round2(Math.min(lim[1], Math.max(lim[0], n)));
    }

    // v3: an uploaded image (required) plus 0 to 4 optional CSS layers
    function clean3(f) {
        var im = f.image;
        if (!im || typeof im !== 'object' || !imgOk(im.src)) return null;
        var layers = (Array.isArray(f.layers) ? f.layers : []).slice(0, 4).map(cleanLayer).filter(Boolean);
        return { v: 3, shape: SHAPES[f.shape] ? f.shape : 'circle', avatarShape: f.avatarShape === true, layers: layers,
            image: { src: im.src, scale: imgNum(im.scale, 'scale'), x: imgNum(im.x, 'x'), y: imgNum(im.y, 'y'), rot: imgNum(im.rot, 'rot') } };
    }

    function clean(f) {
        if (!f || typeof f !== 'object') return null;
        var v = Number(f.v);
        return v === 3 ? clean3(f) : v === 2 ? clean2(f) : clean1(f);
    }

    /* ------------------------------ templates ------------------------------ */
    function L(type, colors, o) { var l = { type: type, colors: colors, dir: 1 }; Object.keys(o || {}).forEach(function (k) { l[k] = o[k]; }); return l; }

    var BUILD = {
        spin: function (a, b, s) { return [L('gradient', [a, b], { width: 5, gap: 1, arc: 62, speed: s })]; },
        rainbow: function (a, b, s) { return [L('gradient', ['#ff4d4d', '#ffb84d', '#4dff88', '#4dc3ff', '#9a4dff'], { width: 5, gap: 1, arc: 100, speed: s })]; },
        pulse: function (a, b, s) { return [L('ring', [a], { width: 4, gap: 1, pulse: 6, pulseSpeed: s * 0.8 }), L('glow', [a, b], { width: 1, blur: 14, gap: 2, pulse: 25, pulseSpeed: s * 0.8 })]; },
        orbit: function (a, b, s) { return [L('dashed', [a], { width: 3.5, gap: 2, speed: s * 3 }), L('ring', [b], { width: 1, gap: 1, opacity: 70 })]; },
        neon: function (a, b) { return [L('ring', [a], { width: 3, gap: 1, flicker: 55 }), L('glow', [a], { width: 1, blur: 9, gap: 1, opacity: 80, flicker: 55 }), L('ring', [b], { width: 1, gap: 5, opacity: 85, flicker: 40 }), L('glow', [b], { width: 1, blur: 12, gap: 5, opacity: 70, flicker: 40 })]; },
        fire: function (a, b, s) { return [L('gradient', [a, b, a, b], { width: 6, gap: 0, arc: 100, speed: s * 0.7 }), L('gradient', [b], { width: 3, gap: 1, arc: 35, speed: s * 1.1, dir: -1, flicker: 45 }), L('glow', [a], { width: 1, blur: 10, gap: 1, opacity: 70, pulse: 12, pulseSpeed: 1.1 })]; },
        dots: function (a, b, s) { return [L('dotted', [a], { width: 3.5, gap: 1, speed: s }), L('dotted', [b], { width: 2.5, gap: 8, speed: s * 1.4, dir: -1 })]; },
        aurora: function (a, b, s) { return [L('gradient', [a, b], { width: 4, gap: 1, arc: 100, speed: s * 2 }), L('gradient', [b], { width: 3, gap: 2, arc: 30, speed: s * 1.5, dir: -1, opacity: 80 }), L('glow', [a, b], { width: 1, blur: 14, gap: 1, opacity: 75 })]; },
        twin: function (a, b, s) { return [L('gradient', [a], { width: 4, gap: 1, arc: 55, speed: s }), L('gradient', [b], { width: 4, gap: 6, arc: 55, speed: s * 1.3, dir: -1 })]; }
    };

    function fromV1(f) {
        return clean2({ v: 2, shape: 'circle', layers: BUILD[f.style](f.c1, f.c2, f.speed) });
    }

    function toV2(f) {
        if (!f || typeof f !== 'object') return null;
        if (Number(f.v) === 3) return clean3(f);
        if (Number(f.v) === 2) return clean2(f);
        var c = clean1(f);
        return c ? fromV1(c) : null;
    }

    function T(id, name, shape, avatarShape, layers) { return { id: id, name: name, frame: clean2({ v: 2, shape: shape, avatarShape: avatarShape, layers: layers }) }; }
    var TEMPLATES = [
        T('spin', 'Violet spin', 'circle', false, BUILD.spin('#7F77DD', '#D4537E', 3)),
        T('rainbow', 'Rainbow ring', 'circle', false, BUILD.rainbow('#ff4d4d', '#4dc3ff', 4)),
        T('pulse', 'Mint pulse', 'circle', false, BUILD.pulse('#1D9E75', '#5DCAA5', 2.4)),
        T('orbit', 'Dashed orbit', 'circle', false, BUILD.orbit('#D85A30', '#F0997B', 4)),
        T('neon', 'Neon sky', 'circle', false, BUILD.neon('#38bdf8', '#a78bfa', 3)),
        T('fire', 'Inferno', 'circle', false, BUILD.fire('#ff4d00', '#ffd54f', 3)),
        T('dots', 'Dotted rings', 'circle', false, BUILD.dots('#EF9F27', '#D4537E', 3)),
        T('aurora', 'Aurora', 'circle', false, BUILD.aurora('#22d3ee', '#a855f7', 4)),
        T('twin', 'Twin rings', 'circle', false, BUILD.twin('#7F77DD', '#1D9E75', 3)),
        T('sparkle', 'Sparkle halo', 'circle', false, [L('ring', ['#EF9F27'], { width: 2, gap: 2, opacity: 90, pulse: 4, pulseSpeed: 2.4 }), L('sparkles', ['#fff3b0', '#EF9F27', '#ffffff'], { size: 8, count: 6, gap: 4, speed: 14, pulseSpeed: 1.8 })]),
        T('orbitdots', 'Orbiting dots', 'circle', false, [L('dots', ['#38bdf8', '#a78bfa'], { size: 5, count: 6, gap: 3, speed: 6 }), L('ring', ['#38bdf8'], { width: 1.5, gap: 1, opacity: 60 })]),
        T('ripple', 'Ripple', 'circle', false, [L('ring', ['#22d3ee'], { width: 3, gap: 1 }), L('ripple', ['#22d3ee'], { width: 2, gap: 1, size: 8, count: 2, speed: 2.6 })]),
        T('squircle', 'Squircle neon', 'squircle', true, [L('ring', ['#38bdf8'], { width: 3, gap: 1, flicker: 40 }), L('glow', ['#a78bfa', '#38bdf8'], { width: 1, blur: 12, gap: 1, opacity: 80 })]),
        T('petal', 'Petal', 'petal', true, [L('gradient', ['#f472b6', '#fb7185', '#fbbf24'], { width: 4, gap: 1, arc: 100, speed: 5 }), L('glow', ['#f472b6'], { width: 1, blur: 10, gap: 1, opacity: 60 })]),
        T('jelly', 'Jelly blob', 'blob', true, [L('gradient', ['#34d399', '#22d3ee', '#a78bfa'], { width: 4, gap: 1, arc: 100, speed: 6 }), L('ring', ['#34d399'], { width: 1, gap: 6, opacity: 50, pulse: 30, pulseSpeed: 2.2 })]),
        /* Frame Lab presets */
        T('thunder', 'Thunderstorm', 'circle', false, [L('ring', ['#7dd3fc'], { width: 2.5, gap: 1, flicker: 35 }), L('lightning', ['#fef08a', '#ffffff', '#7dd3fc'], { size: 6, count: 5, gap: 3, speed: 3.2 }), L('glow', ['#38bdf8'], { width: 1, blur: 12, gap: 1, opacity: 70, pulse: 20, pulseSpeed: 2.6 })]),
        T('love', 'Lovestruck', 'circle', false, [L('gradient', ['#fb7185', '#f472b6', '#fda4af'], { width: 3.5, gap: 1, arc: 100, speed: 7 }), L('hearts', ['#fb7185', '#f472b6', '#ffe4e6'], { size: 5, count: 6, gap: 2, speed: 3.4, blur: 14 }), L('glow', ['#f472b6'], { width: 1, blur: 10, gap: 1, opacity: 55 })]),
        T('frozen', 'Frozen', 'circle', false, [L('ring', ['#bae6fd'], { width: 2.5, gap: 1 }), L('snow', ['#ffffff', '#e0f2fe'], { size: 3, count: 9, gap: 1, speed: 4.5, blur: 16 }), L('shimmer', ['#ffffff'], { opacity: 55, speed: 4.5, arc: 50 })]),
        T('starfall', 'Starfall', 'circle', false, [L('gradient', ['#fde68a', '#f59e0b'], { width: 3, gap: 1, arc: 55, speed: 5 }), L('stars', ['#fde68a', '#ffffff', '#fbbf24'], { size: 5, count: 6, gap: 2, speed: 3.2, blur: 14 })]),
        T('glitch', 'Glitch', 'circle', false, [L('glitch', ['#e5e7eb', '#00e5ff', '#ff2bd6'], { width: 3, gap: 1, speed: 2.6 })]),
        T('holo', 'Holo', 'circle', false, [L('gradient', ['#a78bfa', '#38bdf8', '#34d399'], { width: 4, gap: 1, arc: 100, speed: 6, hue: 6 }), L('shimmer', ['#ffffff'], { opacity: 45, speed: 3.6, arc: 50 }), L('glow', ['#a78bfa'], { width: 1, blur: 12, gap: 1, opacity: 60, hue: 6 })])
    ];

    /* ------------------------------ v2 renderer ------------------------------ */
    function U(n) { return 'calc(var(--sf-u) * ' + n + ')'; }
    function mk(cls) { var e = document.createElement('i'); e.className = cls; return e; }

    /* ------------------------------ Frame Lab effects ------------------------------ */
    function labEls(l) {
        var t = l.type, c = l.colors, base = mk('sf-l sf-t-' + t), bs = base.style, out = [base], anims = [], delay = l.delay;
        var hue = l.hue > 0 ? 'sfHue ' + l.hue + 's linear infinite' : '';
        bs.setProperty('--lo', String(l.opacity / 100));
        if (l.blend && l.blend !== 'normal') bs.mixBlendMode = l.blend;

        function put(e, list, dl) {
            if (hue) list = list.concat([hue]);
            if (list.length) { e.style.animation = list.join(','); e.style.animationDelay = dl + 's'; }
        }

        if (t === 'shimmer') {
            // a soft diagonal band of light sweeps over the avatar, then rests until the next pass
            var dur = Math.max(0.8, l.speed || 3.5), band = round2(Math.max(4, l.arc * 0.45));
            bs.inset = '0';
            bs.background = c[1]
                ? 'linear-gradient(115deg,transparent calc(50% - ' + band + '%),' + c[0] + ' calc(50% - ' + round2(band / 3) + '%),' + c[1] + ' calc(50% + ' + round2(band / 3) + '%),transparent calc(50% + ' + band + '%)) 0 0 / 250% 100% no-repeat'
                : 'linear-gradient(115deg,transparent calc(50% - ' + band + '%),' + c[0] + ' 50%,transparent calc(50% + ' + band + '%)) 0 0 / 250% 100% no-repeat';
            anims.push('sfShine ' + dur + 's ease-in-out infinite');
            put(base, anims, delay);
        } else if (t === 'hearts' || t === 'stars' || t === 'snow') {
            // little shapes drift away from the ring: hearts and stars rise, snow falls
            var n = Math.round(l.count), dd = Math.max(1.2, l.speed || 3.5), drift = l.blur;
            bs.inset = 'calc(-1 * ' + U(l.gap) + ')';
            for (var i = 0; i < n; i++) {
                var p = mk('sf-p sf-p-' + t), ps = p.style, a = Math.PI * 2 * i / n + (i % 2 ? 0.35 : 0);
                ps.left = round2(50 + 50 * Math.cos(a)) + '%';
                ps.top = round2(50 + 50 * Math.sin(a)) + '%';
                ps.setProperty('--ps', U(round2(l.size * (0.75 + ((i * 5) % 4) * 0.1))));
                ps.setProperty('--dc', c[i % c.length]);
                ps.setProperty('--dx', U(round2(Math.sin(i * 2.3) * drift * 0.25)));
                ps.setProperty('--dy', U(t === 'snow' ? drift : -drift));
                ps.animation = 'sfFloat ' + dd + 's ' + (t === 'snow' ? 'linear' : 'ease-out') + ' infinite';
                ps.animationDelay = round2(delay + i * dd / n) + 's';
                base.appendChild(p);
            }
            put(base, [], 0);
        } else if (t === 'lightning') {
            // bolts flash at staggered moments around the avatar
            var nb = Math.round(l.count), cyc = Math.max(0.8, l.speed || 3);
            bs.inset = 'calc(-1 * ' + U(l.gap + l.size / 2) + ')';
            for (var j = 0; j < nb; j++) {
                var b = mk('sf-d'), bd = b.style;
                bd.transform = 'rotate(' + round2(360 / nb * j) + 'deg)';
                bd.setProperty('--dc', c[j % c.length]);
                bd.setProperty('--ds', U(round2(l.size)));
                bd.setProperty('--tw', cyc + 's');
                bd.setProperty('--td', round2(delay + ((j * 0.618) % 1) * cyc) + 's');
                base.appendChild(b);
            }
            put(base, [], 0);
        } else {
            // glitch: a ring plus two color-split ghosts that jump around in short bursts
            var gc = Math.max(0.8, l.speed || 3);
            var lw = 'max(1px, ' + U(l.width) + ')', inset = 'calc(-1 * (var(--lw) + ' + U(l.gap) + '))';
            var ring = function (e, color) {
                e.style.setProperty('--lo', String(l.opacity / 100));
                e.style.setProperty('--lw', lw);
                e.style.inset = inset;
                e.style.border = 'var(--lw) solid ' + color;
            };
            ring(base, c[0]);
            if (l.flicker > 0) { bs.setProperty('--lf', String(l.flicker / 100)); anims.push('sfFlick2 3.2s linear infinite'); }
            put(base, anims, delay);
            var g1 = mk('sf-l sf-t-glitch'), g2 = mk('sf-l sf-t-glitch');
            ring(g1, c[1] || '#00e5ff'); ring(g2, c[2] || '#ff2bd6');
            g1.style.mixBlendMode = 'screen'; g2.style.mixBlendMode = 'screen';
            put(g1, ['sfGlitchA ' + gc + 's steps(1,end) infinite'], delay);
            put(g2, ['sfGlitchB ' + gc + 's steps(1,end) infinite'], delay + gc * 0.07);
            out.push(g1, g2);
        }
        return out;
    }

    function layerEls(l, shape) {
        var t = l.type, c = l.colors, d = mk('sf-l sf-t-' + t), s = d.style, anims = [];
        if (LAB[t]) return labEls(l);
        s.setProperty('--lo', String(l.opacity / 100));
        if (l.blend && l.blend !== 'normal') s.mixBlendMode = l.blend;
        s.setProperty('--lw', 'max(1px, ' + U(l.width) + ')');
        var ringInset = 'calc(-1 * (var(--lw) + ' + U(l.gap) + '))';

        if (t === 'ripple') {
            var waves = Math.max(1, Math.min(3, Math.round(l.count))), dur = Math.max(0.8, l.speed || 2.5), out = [];
            for (var w = 0; w < waves; w++) {
                var r = mk('sf-l sf-t-ripple'), rs = r.style;
                rs.setProperty('--lo', String(l.opacity / 100));
                rs.setProperty('--lw', 'max(1px, ' + U(l.width) + ')');
                rs.setProperty('--rx', String(1 + l.size * 0.04));
                rs.inset = 'calc(-1 * ' + U(l.gap) + ')';
                rs.border = 'var(--lw) solid ' + c[0];
                rs.animation = 'sfRipple ' + dur + 's ease-out infinite' + (l.hue > 0 ? ',sfHue ' + l.hue + 's linear infinite' : '');
                if (l.blend && l.blend !== 'normal') rs.mixBlendMode = l.blend;
                rs.animationDelay = (l.delay + w * dur / waves) + 's';
                out.push(r);
            }
            return out;
        }

        // dashes and dots only spin the whole box on a circle (a tilted rounded square would drift off the avatar);
        // gradients animate their own angle, so they travel around ANY shape
        var dir = l.dir < 0 ? ' reverse' : '';
        if (l.speed > 0) {
            if (t === 'gradient') anims.push('sfAng ' + l.speed + 's linear infinite' + dir);
            else if (t === 'dots' || t === 'sparkles' || ((t === 'dashed' || t === 'dotted') && shape === 'circle')) anims.push('sfSpin ' + l.speed + 's linear infinite' + dir);
        }
        if (l.pulse > 0 && t !== 'sparkles') { s.setProperty('--lz', String(1 + l.pulse / 100 * 0.14)); anims.push('sfBreathe ' + l.pulseSpeed + 's ease-in-out infinite alternate'); }
        if (l.flicker > 0) { s.setProperty('--lf', String(l.flicker / 100)); anims.push('sfFlick2 3.2s linear infinite'); }

        if (t === 'ring' || t === 'dashed' || t === 'dotted') {
            s.inset = ringInset;
            s.border = 'var(--lw) ' + (t === 'ring' ? 'solid' : t) + ' ' + c[0];
        } else if (t === 'gradient') {
            s.inset = ringInset;
            s.border = 'var(--lw) solid transparent';
            var stops = l.arc >= 99.5 ? c.concat([c[0]]).join(',') : 'transparent ' + (100 - l.arc) + '%,' + c.join(',');
            s.background = 'conic-gradient(from var(--ga),' + stops + ') border-box';
        } else if (t === 'glow') {
            s.inset = 'calc(-1 * ' + U(l.gap) + ')';
            var sh = '0 0 ' + U(l.blur) + ' ' + U(l.width) + ' ' + c[0];
            if (c[1]) sh += ',0 0 ' + U(l.blur * 1.8) + ' ' + U(l.width / 2) + ' ' + c[1];
            s.boxShadow = sh;
        } else {   // dots + sparkles orbit a circle
            var n = Math.round(l.count);
            s.inset = 'calc(-1 * ' + U(l.gap + l.size / 2) + ')';
            for (var i = 0; i < n; i++) {
                var dot = mk('sf-d'), ds = dot.style;
                ds.transform = 'rotate(' + round2(360 / n * i) + 'deg)';
                ds.setProperty('--dc', c[i % c.length]);
                ds.setProperty('--ds', U(round2(l.size * (t === 'sparkles' && i % 2 ? 0.7 : 1))));
                if (t === 'sparkles') { ds.setProperty('--tw', l.pulseSpeed + 's'); ds.setProperty('--td', round2((i * 0.37) % l.pulseSpeed) + 's'); }
                d.appendChild(dot);
            }
        }
        if (l.hue > 0) anims.push('sfHue ' + l.hue + 's linear infinite');
        if (anims.length) { s.animation = anims.join(','); s.animationDelay = l.delay + 's'; }
        return [d];
    }

    function imageEl(im) {
        var img = document.createElement('img');
        img.className = 'sf-img';
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        img.setAttribute('aria-hidden', 'true');
        var st = img.style, size = round2(im.scale * 100) + '%';
        // size and position are relative to the avatar box. !important so a generic ".sp-avatar img" rule cannot crop or round it
        st.setProperty('width', size, 'important');
        st.setProperty('height', size, 'important');
        st.setProperty('max-width', 'none', 'important');
        st.setProperty('object-fit', 'contain', 'important');
        st.setProperty('border-radius', '0', 'important');
        st.left = round2(50 + im.x) + '%';
        st.top = round2(50 + im.y) + '%';
        st.transform = 'translate(-50%,-50%) rotate(' + im.rot + 'deg)';
        img.src = im.src;
        return img;
    }

    function renderV2(node, f) {
        node.classList.add('sf-has', 'sf-v2');
        node.style.setProperty('--sf-r', SHAPES[f.shape]);
        if (f.avatarShape && f.shape !== 'circle') { node.style.borderRadius = SHAPES[f.shape]; node.setAttribute('data-sf-br', '1'); }
        var fx = document.createElement('i');
        fx.className = 'sf-fx';
        fx.setAttribute('aria-hidden', 'true');
        f.layers.forEach(function (l) { layerEls(l, f.shape).forEach(function (e) { fx.appendChild(e); }); });
        if (f.image) fx.appendChild(imageEl(f.image));
        node.appendChild(fx);
    }

    /* ------------------------------ apply ------------------------------ */
    function apply(node, frame) {
        if (!node || !node.classList) return;
        var old = node.querySelector(':scope > .sf-fx');
        if (old) old.remove();
        STYLES.forEach(function (s) { node.classList.remove('sf-s-' + s); });
        node.classList.remove('sf-v2');
        if (node.hasAttribute('data-sf-br')) { node.style.removeProperty('border-radius'); node.removeAttribute('data-sf-br'); }
        node.style.removeProperty('--sf-r');
        var f = clean(frame);
        if (!f) {
            node.classList.remove('sf-has');
            node.style.removeProperty('--sf-c1'); node.style.removeProperty('--sf-c2'); node.style.removeProperty('--sf-speed');
            return;
        }
        if (f.v === 2 || f.v === 3) { renderV2(node, f); return; }
        node.classList.add('sf-has', 'sf-s-' + f.style);
        node.style.setProperty('--sf-c1', f.c1);
        node.style.setProperty('--sf-c2', f.c2);
        node.style.setProperty('--sf-speed', String(f.speed));
        var fx = document.createElement('i');
        fx.className = 'sf-fx';
        fx.setAttribute('aria-hidden', 'true');
        node.appendChild(fx);
    }

    /* ------------------- who wears what (batched + cached) ------------------- */
    var cache = new Map();          // userId -> { at, frame }
    var waiting = new Map();        // userId -> Set(nodes) waiting for the answer
    var timer = null;

    function fresh(id) { var c = cache.get(id); return c && Date.now() - c.at < TTL ? c : null; }

    function flush() {
        timer = null;
        var ids = Array.from(waiting.keys()).slice(0, 200);
        if (!ids.length) return;
        var batch = new Map();
        ids.forEach(function (id) { batch.set(id, waiting.get(id)); waiting.delete(id); });
        if (waiting.size) timer = setTimeout(flush, 30);
        fetchFrames(ids).then(function () {
            batch.forEach(function (nodes, id) {
                var c = cache.get(id);
                nodes.forEach(function (n) { apply(n, c ? c.frame : null); });
            });
        });
    }

    function fetchFrames(ids) {
        var sb = client();
        var want = ids.filter(function (id) { return !fresh(id); });
        if (!sb || !want.length) return Promise.resolve();
        return Promise.resolve(sb.rpc('frames_for', { p_ids: want.slice(0, 200) })).then(function (res) {
            var now = Date.now(), got = new Map();
            if (res && !res.error) (res.data || []).forEach(function (r) { got.set(r.user_id, clean(r.frame_data)); });
            var failed = !!(res && res.error);
            want.forEach(function (id) {
                // on an error remember "no frame" for only 30s so a missing SQL file does not hammer the server
                cache.set(id, { at: failed ? now - TTL + 30000 : now, frame: got.get(id) || null });
            });
        }).catch(function () {
            want.forEach(function (id) { cache.set(id, { at: Date.now() - TTL + 30000, frame: null }); });
        });
    }

    function adorn(node, userId) {
        if (!node || !userId) return node;
        userId = String(userId).toLowerCase();
        node.setAttribute('data-sf-uid', userId);
        var c = fresh(userId);
        if (c) { apply(node, c.frame); return node; }
        if (!waiting.has(userId)) waiting.set(userId, new Set());
        waiting.get(userId).add(node);
        if (!timer) timer = setTimeout(flush, 40);
        return node;
    }

    function setMine(userId, frame) {
        if (!userId) return;
        userId = String(userId).toLowerCase();
        var f = clean(frame);
        cache.set(userId, { at: Date.now(), frame: f });
        document.querySelectorAll('[data-sf-uid="' + userId + '"]').forEach(function (n) { apply(n, f); });
    }

    function forUsers(ids) { return fetchFrames((ids || []).map(function (i) { return String(i).toLowerCase(); })); }

    window.SpecFrames = {
        STYLES: STYLES, SHAPES: Object.keys(SHAPES), LAYER_TYPES: LAYER_TYPES, LIMITS: LIMITS, BLENDS: BLENDS, TEMPLATES: TEMPLATES,
        clean: clean, toV2: toV2, apply: apply, adorn: adorn, setMine: setMine, forUsers: forUsers, imageOk: imgOk, IMAGE_LIMITS: IMG_LIMITS
    };
})();
