/* ==========================================================================
   SPECSOFT® avatar-frames.js  -  CSS-only profile frames (no images)
   Add  <script src="avatar-frames.js"></script>  to any page that shows avatars.
   Needs supabase-config.js (only to look up who wears what) and supabase-store-frames.sql.

   Two kinds of frame data are understood:
     v1  {"style":"spin","c1":"#7F77DD","c2":"#D4537E","speed":3}          the original 9 templates
     v2  {"v":2,"shape":"circle","avatarShape":false,"layers":[ {...}, ]}   the layered designer (up to 4 layers)

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
   built here, so a frame can never inject CSS, load a URL, or cover the page.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecFrames) return;

    var STYLES = ['spin', 'rainbow', 'pulse', 'orbit', 'neon', 'fire', 'dots', 'aurora', 'twin'];
    var SHAPES = { circle: '50%', squircle: '32%', rounded: '18%', square: '5%', petal: '50% 6% 50% 6%', blob: '58% 42% 52% 48% / 46% 56% 44% 54%' };
    var LAYER_TYPES = ['ring', 'gradient', 'dashed', 'dotted', 'glow', 'dots', 'sparkles', 'ripple'];
    var LIMITS = { width: [0.5, 14], gap: [-8, 30], opacity: [5, 100], speed: [0, 40], pulse: [0, 100], pulseSpeed: [0.4, 10], flicker: [0, 100], count: [1, 12], size: [1, 16], arc: [5, 100], blur: [0, 40], delay: [0, 10] };
    var DEFAULTS = { width: 4, gap: 1, opacity: 100, speed: 3, pulse: 0, pulseSpeed: 2, flicker: 0, count: 6, size: 5, arc: 60, blur: 10, delay: 0 };
    var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    var TTL = 5 * 60 * 1000;

    var CFG = window.SPECSOFT_CONFIG || {};
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
            '.sf-d::before{content:"";position:absolute;left:50%;top:0;width:var(--ds);height:var(--ds);margin:calc(var(--ds) / -2) 0 0 calc(var(--ds) / -2);border-radius:50%;background:var(--dc);box-shadow:0 0 calc(var(--ds) * 1.1) var(--dc)}',
            '.sf-t-sparkles .sf-d::before{border-radius:0;box-shadow:none;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);animation:sfTwinkle var(--tw,1.8s) ease-in-out infinite;animation-delay:var(--td,0s)}',

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
            '@media (prefers-reduced-motion:reduce){.sf-fx::before,.sf-fx::after,.sf-l,.sf-t-sparkles .sf-d::before{animation:none!important}}'
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
        var o = { type: l.type, colors: colors, dir: Number(l.dir) < 0 ? -1 : 1 };
        Object.keys(LIMITS).forEach(function (k) { o[k] = num(l[k], k); });
        return o;
    }

    function clean2(f) {
        var layers = (Array.isArray(f.layers) ? f.layers : []).slice(0, 4).map(cleanLayer).filter(Boolean);
        if (!layers.length) return null;
        return { v: 2, shape: SHAPES[f.shape] ? f.shape : 'circle', avatarShape: f.avatarShape === true, layers: layers };
    }

    function clean(f) {
        if (!f || typeof f !== 'object') return null;
        return Number(f.v) === 2 ? clean2(f) : clean1(f);
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
        T('jelly', 'Jelly blob', 'blob', true, [L('gradient', ['#34d399', '#22d3ee', '#a78bfa'], { width: 4, gap: 1, arc: 100, speed: 6 }), L('ring', ['#34d399'], { width: 1, gap: 6, opacity: 50, pulse: 30, pulseSpeed: 2.2 })])
    ];

    /* ------------------------------ v2 renderer ------------------------------ */
    function U(n) { return 'calc(var(--sf-u) * ' + n + ')'; }
    function mk(cls) { var e = document.createElement('i'); e.className = cls; return e; }

    function layerEls(l, shape) {
        var t = l.type, c = l.colors, d = mk('sf-l sf-t-' + t), s = d.style, anims = [];
        s.setProperty('--lo', String(l.opacity / 100));
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
                rs.animation = 'sfRipple ' + dur + 's ease-out infinite';
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
        if (anims.length) { s.animation = anims.join(','); s.animationDelay = l.delay + 's'; }
        return [d];
    }

    function renderV2(node, f) {
        node.classList.add('sf-has', 'sf-v2');
        node.style.setProperty('--sf-r', SHAPES[f.shape]);
        if (f.avatarShape && f.shape !== 'circle') { node.style.borderRadius = SHAPES[f.shape]; node.setAttribute('data-sf-br', '1'); }
        var fx = document.createElement('i');
        fx.className = 'sf-fx';
        fx.setAttribute('aria-hidden', 'true');
        f.layers.forEach(function (l) { layerEls(l, f.shape).forEach(function (e) { fx.appendChild(e); }); });
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
        if (f.v === 2) { renderV2(node, f); return; }
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
        STYLES: STYLES, SHAPES: Object.keys(SHAPES), LAYER_TYPES: LAYER_TYPES, LIMITS: LIMITS, TEMPLATES: TEMPLATES,
        clean: clean, toV2: toV2, apply: apply, adorn: adorn, setMine: setMine, forUsers: forUsers
    };
})();
