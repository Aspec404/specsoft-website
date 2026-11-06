/* ==========================================================================
   SPECSOFT\u00ae name-titles.js  -  member titles (styled text next to a name)
   Add  <script src="name-titles.js"></script>  to any page that shows member names.
   Needs supabase-config.js (to look up who wears what) and supabase-store-titles.sql.

   A title is DATA, never code:
     {"v":1,"text":"Night Owl","font":"serif","weight":700,"italic":false,"caps":false,
      "spacing":1,"size":1,"fill":"gradient","colors":["#a66bff","#38bdf8"],"angle":90,
      "flow":2,"effect":"shimmer","strength":50,"speed":3,
      "outline":null,"deco":"pill","left":"\u2726","right":"\u2726"}

   Every value is whitelisted or clamped and every color must be #rrggbb, and the CSS is built
   here, so a title can never inject CSS or HTML (text is always set as plain text).

   Public API (window.SpecTitles)
     FONTS, EFFECTS, EFFECT_GROUPS, DECOS, SYMBOLS, LIMITS, TEMPLATES   lists for the editor
     iconOk(url), iconFromLink(text)   icon link checks (store-icons bucket or Flaticon CDN)
     clean(title)            a safe, clamped copy, or null
     render(title)           a DOM element for that title (or null)
     apply(node, title)      put a title inside one container (null empties it)
     adorn(node, userId)     look up that member's equipped title and apply it
     setMine(userId, title)  tell every title slot on the page about a new title
     forUsers([ids])         Promise, fills the cache for those members

   Usage on a profile or in chat:
     var slot = document.createElement('span');       // an empty container next to the name
     nameEl.after(slot);
     SpecTitles.adorn(slot, userId);                   // fills itself in (and stays empty if no title)
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecTitles) return;

    var FONTS = {
        sans:    ['Clean',      "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"],
        rounded: ['Rounded',    "'Trebuchet MS','Arial Rounded MT Bold','Varela Round',system-ui,sans-serif"],
        serif:   ['Serif',      "Georgia,'Times New Roman',Times,serif"],
        classic: ['Classic',    "'Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif"],
        display: ['Heavy',      "Impact,'Arial Black','Helvetica Neue',sans-serif"],
        mono:    ['Terminal',   "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace"],
        script:  ['Script',     "'Brush Script MT','Segoe Script','Lucida Handwriting',cursive"],
        comic:   ['Playful',    "'Comic Sans MS','Chalkboard SE','Comic Neue',cursive"],
        engrave: ['Engraved',   "Copperplate,'Copperplate Gothic Light','Gill Sans',Optima,fantasy"],
        /* web fonts (Google Fonts, loaded only when a title uses them; the fallback shows until then) */
        orbitron:  ['Orbitron (HUD)',        "'Orbitron','Segoe UI',system-ui,sans-serif"],
        audiowide: ['Audiowide (tech)',      "'Audiowide','Segoe UI',system-ui,sans-serif"],
        righteous: ['Righteous (retro)',     "'Righteous','Trebuchet MS',system-ui,sans-serif"],
        bungee:    ['Bungee (signage)',      "'Bungee',Impact,'Arial Black',sans-serif"],
        bebas:     ['Bebas (tall caps)',     "'Bebas Neue',Impact,'Arial Narrow',sans-serif"],
        pixel:     ['Pixel (8-bit)',         "'Press Start 2P',ui-monospace,Menlo,Consolas,monospace"],
        vt323:     ['VT323 (old terminal)',  "'VT323',ui-monospace,Menlo,Consolas,monospace"],
        cinzel:    ['Cinzel (epic)',         "'Cinzel',Georgia,'Times New Roman',serif"],
        playfair:  ['Playfair (fancy)',      "'Playfair Display',Georgia,'Times New Roman',serif"],
        gothic:    ['Gothic (old English)',  "'UnifrakturCook','Old English Text MT',Georgia,serif"],
        creepster: ['Creepster (spooky)',    "'Creepster',Impact,'Arial Black',sans-serif"],
        pacifico:  ['Pacifico (surf script)',"'Pacifico','Brush Script MT','Segoe Script',cursive"],
        lobster:   ['Lobster (bold script)', "'Lobster','Brush Script MT','Segoe Script',cursive"],
        caveat:    ['Caveat (handwriting)',  "'Caveat','Segoe Script','Comic Sans MS',cursive"],
        marker:    ['Marker (graffiti)',     "'Permanent Marker','Comic Sans MS','Chalkboard SE',cursive"],
        fredoka:   ['Fredoka (bubbly)',      "'Fredoka','Trebuchet MS','Arial Rounded MT Bold',system-ui,sans-serif"]
    };
    // Google Fonts "family" query values (exact weights each family really has, or the css2 request fails)
    var GFONTS = {
        orbitron: 'Orbitron:wght@400..900', audiowide: 'Audiowide', righteous: 'Righteous', bungee: 'Bungee',
        bebas: 'Bebas+Neue', pixel: 'Press+Start+2P', vt323: 'VT323', cinzel: 'Cinzel:wght@400..900',
        playfair: 'Playfair+Display:wght@400..900', gothic: 'UnifrakturCook:wght@700', creepster: 'Creepster',
        pacifico: 'Pacifico', lobster: 'Lobster', caveat: 'Caveat:wght@400..700', marker: 'Permanent+Marker',
        fredoka: 'Fredoka:wght@300..700'
    };
    var fontLoaded = {};
    function ensureFont(key) {
        if (!GFONTS[key] || fontLoaded[key]) return;
        fontLoaded[key] = true;
        try {
            var l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + GFONTS[key] + '&display=swap';
            (document.head || document.documentElement).appendChild(l);
        } catch (e) { /* offline or blocked: the fallback font is used */ }
    }
    // Effects are grouped by what they animate. A title can use up to 3 effects at once; two effects from the
    // SAME group replace each other (the later one wins), effects from different groups stack.
    var EFFECT_GROUPS = [
        ['Glow & light',  { glow: 'Soft glow', neon: 'Neon (flickering)', halo: 'White halo', shadow: 'Drop shadow' }],
        ['Movement',      { float: 'Float', bounce: 'Bounce', shake: 'Shake', swing: 'Swing', heartbeat: 'Heartbeat' }],
        ['Fade',          { pulse: 'Pulse', flicker: 'Flicker', blink: 'Blink', fade: 'Slow fade' }],
        ['Colour shift',  { rainbow: 'Rainbow cycle', hueshift: 'Hue sway' }],
        ['Text FX',       { shimmer: 'Shimmer', glitch: 'Glitch', ghost: 'Ghost echo', scanline: 'Scan line' }],
        ['Letter by letter', { wave: 'Wave', hop: 'Hop', jitter: 'Jitter', spectrum: 'Spectrum letters' }],
        ['Extras',        { sparkle: 'Sparkle' }]
    ];
    var EFFECTS = { none: 'None' }, EFFECT_SLOT = {};
    EFFECT_GROUPS.forEach(function (g, gi) { Object.keys(g[1]).forEach(function (k) { EFFECTS[k] = g[1][k]; EFFECT_SLOT[k] = gi; }); });
    var LETTER_SLOT = 5;
    var DECOS = {
        none: 'None', pill: 'Pill background', gradpill: 'Gradient pill', glass: 'Glass pill', tag: 'Angled tag',
        underline: 'Gradient underline', outline: 'Outlined box', dashed: 'Dashed box', double: 'Double border',
        neonbox: 'Neon box', corners: 'Corner marks', brackets: 'Brackets', wings: 'Wings \u00ab \u00bb', stars: 'Star sparks'
    };
    var SYMBOLS = ['', '\u2726', '\u2605', '\u2756', '\u263e', '\u26a1', '\u265b', '\u2744', '\u2764', '\u2620', '\u273f', '\u2694', '\u2666', '\u2727', '\u2600', '\u27a4'];
    var LIMITS = {
        weight:   [400, 900, 700],
        spacing:  [-1, 8, 0],
        size:     [0.8, 1.5, 1],
        angle:    [0, 360, 90],
        flow:     [0, 12, 0],
        strength: [0, 100, 50],
        speed:    [0.5, 12, 3],
        iconSize: [0.6, 2, 1]
    };
    var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    // icons: only https links into our own store-icons bucket (same rule as the database)
    var ICON_RE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/storage\/v1\/object\/public\/store-icons\/[A-Za-z0-9._\/-]+$/;
    // Flaticon CDN images: https://cdn-icons-png.flaticon.com/<size>/<folder>/<id>.png
    var FLAT_RE = /^https:\/\/cdn-icons-png\.flaticon\.com\/[0-9]{2,3}\/[0-9]{1,6}\/[0-9]{1,9}\.(png|webp)$/;
    function iconOk(u) { return typeof u === 'string' && u.length <= 300 && u.indexOf('..') < 0 && (ICON_RE.test(u) || FLAT_RE.test(u)); }
    // accepts a direct Flaticon image link, or a Flaticon icon PAGE link (.../free-icon/name_1234567), and returns a usable image link (or null)
    function iconFromLink(t) {
        t = String(t || '').trim();
        if (iconOk(t)) return t;
        var m = t.match(/^https:\/\/(?:www\.)?flaticon\.com\/[^?#\s]*_([0-9]{1,9})(?:[?#]|$)/);
        if (!m) return null;
        var id = Number(m[1]);
        var u = 'https://cdn-icons-png.flaticon.com/128/' + Math.floor(id / 1000) + '/' + id + '.png';
        return iconOk(u) ? u : null;
    }
    var TTL = 5 * 60 * 1000;
    var TEXT_MAX = 24;

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
        if (document.getElementById('spt-styles')) return;
        var css = [
            '.spt{display:inline-flex;align-items:center;gap:.3em;vertical-align:middle;max-width:100%;white-space:nowrap;line-height:1.25;font-size:calc(1em * var(--spt-size,1));' +
                'font-family:var(--spt-font);font-weight:var(--spt-weight,700);font-style:var(--spt-style,normal);letter-spacing:calc(var(--spt-ls,0) * .05em);text-transform:var(--spt-case,none);' +
                'margin-left:.4em;pointer-events:none;user-select:none}',
            '.spt-x{position:relative;display:inline-block;white-space:pre;color:var(--spt-c0)}',
            '.spt-x.is-grad{background:var(--spt-bg);background-size:var(--spt-bgs,100% 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}',
            '.spt-x.is-flow{animation:sptFlow calc(var(--spt-flow) * 1s) linear infinite}',
            '.spt-x.is-stroke{-webkit-text-stroke:var(--spt-sw,1px) var(--spt-sc)}',
            '.spt-c{display:inline-block;white-space:pre}',
            '.spt-i{display:inline-block;flex:none;height:calc(1.15em * var(--spt-isz,1));width:auto;max-width:3.5em;object-fit:contain;vertical-align:middle}',
            '.spt-d{display:inline-block;color:var(--spt-c0);font-style:normal;font-weight:400;font-family:system-ui,sans-serif;font-size:.9em}',

            /* layers: .spt (glow) > .spt-m (movement) > .spt-f (fade) > .spt-h (colour shift) > .spt-in (decoration + content) */
            '.spt-m,.spt-f,.spt-h,.spt-in{display:inline-flex;align-items:center}',
            '.spt-in{gap:.3em;position:relative}',

            /* decorations around the whole title */
            '.spt-deco-pill{padding:.12em .7em;border-radius:99px;background:color-mix(in srgb,var(--spt-c0) 16%,transparent);border:1px solid color-mix(in srgb,var(--spt-c0) 45%,transparent)}',
            '.spt-deco-gradpill{padding:.12em .8em;border-radius:99px;background:var(--spt-bg)}',
            '.spt-deco-gradpill .spt-x,.spt-deco-gradpill .spt-x.is-grad{background:none;-webkit-text-fill-color:#fff;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45)}',
            '.spt-deco-gradpill .spt-c{color:#fff!important}',
            '.spt-deco-glass{padding:.12em .75em;border-radius:99px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}',
            '.spt-deco-tag{padding:.12em .85em;background:color-mix(in srgb,var(--spt-c0) 22%,transparent);clip-path:polygon(.45em 0,100% 0,calc(100% - .45em) 100%,0 100%)}',
            '.spt-deco-outline{padding:.08em .55em;border-radius:.35em;border:1.5px solid var(--spt-c0);box-shadow:inset 0 0 .5em color-mix(in srgb,var(--spt-c0) 30%,transparent)}',
            '.spt-deco-dashed{padding:.08em .55em;border-radius:.35em;border:1.5px dashed var(--spt-c0)}',
            '.spt-deco-double{padding:.06em .55em;border-radius:.3em;border:3px double var(--spt-c0)}',
            '.spt-deco-neonbox{padding:.08em .6em;border-radius:.3em;border:1.5px solid var(--spt-c0);box-shadow:0 0 .35em var(--spt-c0),inset 0 0 .35em color-mix(in srgb,var(--spt-c0) 55%,transparent)}',
            '.spt-deco-corners{padding:.14em .65em;background:linear-gradient(var(--spt-c0),var(--spt-c0)) 0 0/.5em 1.5px no-repeat,linear-gradient(var(--spt-c0),var(--spt-c0)) 0 0/1.5px .5em no-repeat,linear-gradient(var(--spt-c0),var(--spt-c0)) 100% 0/.5em 1.5px no-repeat,linear-gradient(var(--spt-c0),var(--spt-c0)) 100% 0/1.5px .5em no-repeat,linear-gradient(var(--spt-c0),var(--spt-c0)) 0 100%/.5em 1.5px no-repeat,linear-gradient(var(--spt-c0),var(--spt-c0)) 0 100%/1.5px .5em no-repeat,linear-gradient(var(--spt-c0),var(--spt-c0)) 100% 100%/.5em 1.5px no-repeat,linear-gradient(var(--spt-c0),var(--spt-c0)) 100% 100%/1.5px .5em no-repeat}',
            '.spt-deco-brackets{padding:0 .2em}',
            '.spt-deco-brackets::before{content:"[";color:var(--spt-c0);font-weight:400}',
            '.spt-deco-brackets::after{content:"]";color:var(--spt-c0);font-weight:400}',
            '.spt-deco-wings::before{content:"\\00ab";color:var(--spt-c0);font-weight:400}',
            '.spt-deco-wings::after{content:"\\00bb";color:var(--spt-c0);font-weight:400}',
            '.spt-deco-stars::before{content:"\\2726";color:var(--spt-c0);font-weight:400;font-size:.7em;margin-right:.1em}',
            '.spt-deco-stars::after{content:"\\2726";color:var(--spt-c0);font-weight:400;font-size:.7em;margin-left:.1em}',
            '.spt-deco-underline{padding-bottom:.18em;background:var(--spt-bg) 0 100%/100% .14em no-repeat}',

            /* effects. glow group: filter on the whole title */
            '.spt-fx-glow{filter:drop-shadow(0 0 calc(var(--spt-gl) * .12em) var(--spt-c0))}',
            '.spt-fx-neon{filter:drop-shadow(0 0 .08em var(--spt-c0)) drop-shadow(0 0 calc(var(--spt-gl) * .1em) var(--spt-c0)) drop-shadow(0 0 calc(var(--spt-gl) * .22em) var(--spt-c1,var(--spt-c0)))}',
            '.spt-fx-neon .spt-f{animation:sptFlicker calc(var(--spt-sp) * 2.2s) linear infinite}',
            '.spt-fx-halo{filter:drop-shadow(0 0 .06em #fff) drop-shadow(0 0 calc(var(--spt-gl) * .16em) var(--spt-c0))}',
            '.spt-fx-shadow{filter:drop-shadow(.07em .07em 0 rgba(0,0,0,.65)) drop-shadow(.14em .14em calc(var(--spt-gl) * .04em) var(--spt-c0))}',
            /* movement group */
            '.spt-fx-float .spt-m{animation:sptFloat calc(var(--spt-sp) * 1s) ease-in-out infinite}',
            '.spt-fx-bounce .spt-m{animation:sptBounce calc(var(--spt-sp) * .5s) ease-in-out infinite}',
            '.spt-fx-shake .spt-m{animation:sptShake calc(var(--spt-sp) * .12s) linear infinite}',
            '.spt-fx-swing .spt-m{transform-origin:50% 0;animation:sptSwing calc(var(--spt-sp) * .7s) ease-in-out infinite}',
            '.spt-fx-heartbeat .spt-m{animation:sptBeat calc(var(--spt-sp) * .45s) ease-in-out infinite}',
            /* fade group */
            '.spt-fx-pulse .spt-f{animation:sptPulse calc(var(--spt-sp) * 1s) ease-in-out infinite}',
            '.spt-fx-flicker .spt-f{animation:sptFlicker calc(var(--spt-sp) * 1.6s) linear infinite}',
            '.spt-fx-blink .spt-f{animation:sptBlink calc(var(--spt-sp) * .5s) steps(1) infinite}',
            '.spt-fx-fade .spt-f{animation:sptFade calc(var(--spt-sp) * 1s) ease-in-out infinite}',
            /* colour shift group */
            '.spt-fx-rainbow .spt-h{animation:sptHue calc(var(--spt-sp) * 2s) linear infinite}',
            '.spt-fx-hueshift .spt-h{animation:sptHueShift calc(var(--spt-sp) * 1.5s) ease-in-out infinite}',
            /* text FX group */
            '.spt-fx-shimmer .spt-x::after{content:attr(data-text);position:absolute;left:0;top:0;white-space:pre;color:transparent;-webkit-text-fill-color:transparent;' +
                'background:linear-gradient(110deg,transparent 38%,rgba(255,255,255,.95) 50%,transparent 62%) 0 0/250% 100% no-repeat;-webkit-background-clip:text;background-clip:text;animation:sptShine calc(var(--spt-sp) * 1s) ease-in-out infinite}',
            '.spt-fx-scanline .spt-x::after{content:attr(data-text);position:absolute;left:0;top:0;white-space:pre;color:transparent;-webkit-text-fill-color:transparent;' +
                'background:linear-gradient(180deg,transparent 40%,rgba(255,255,255,.95) 50%,transparent 60%) 0 0/100% 300% no-repeat;-webkit-background-clip:text;background-clip:text;animation:sptScan calc(var(--spt-sp) * .8s) linear infinite}',
            '.spt-fx-ghost .spt-x::before{content:attr(data-text);position:absolute;left:0;top:0;white-space:pre;color:var(--spt-c1,var(--spt-c0));-webkit-text-fill-color:currentColor;background:none;opacity:.4;animation:sptGhost calc(var(--spt-sp) * .9s) ease-in-out infinite}',
            '.spt-fx-glitch .spt-x::before,.spt-fx-glitch .spt-x::after{content:attr(data-text);position:absolute;left:0;top:0;white-space:pre;-webkit-text-fill-color:currentColor;background:none}',
            '.spt-fx-glitch .spt-x::before{color:#00e5ff;animation:sptGlA calc(var(--spt-sp) * 1s) steps(1) infinite}',
            '.spt-fx-glitch .spt-x::after{color:#ff2bd6;animation:sptGlB calc(var(--spt-sp) * 1s) steps(1) infinite}',
            /* letter by letter group */
            '.spt-fx-wave .spt-c{animation:sptWave calc(var(--spt-sp) * .9s) ease-in-out infinite;animation-delay:calc(var(--i) * .09s)}',
            '.spt-fx-hop .spt-c{animation:sptHop calc(var(--spt-sp) * .8s) ease-in-out infinite;animation-delay:calc(var(--i) * .12s)}',
            '.spt-fx-jitter .spt-c{animation:sptJit calc(var(--spt-sp) * .3s) steps(1) infinite;animation-delay:calc(var(--i) * -.07s)}',
            '.spt-fx-spectrum .spt-c{animation:sptHue calc(var(--spt-sp) * 2s) linear infinite;animation-delay:calc(var(--i) * -.18s)}',
            /* extras */
            '.spt-fx-sparkle{position:relative}',
            '.spt-fx-sparkle::before,.spt-fx-sparkle::after{content:"";position:absolute;width:.42em;height:.42em;background:#fff;pointer-events:none;' +
                'clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);animation:sptTwinkle calc(var(--spt-sp) * .7s) ease-in-out infinite;filter:drop-shadow(0 0 .2em var(--spt-c0))}',
            '.spt-fx-sparkle::before{left:12%;top:-.18em}',
            '.spt-fx-sparkle::after{right:10%;bottom:-.14em;animation-delay:calc(var(--spt-sp) * .35s)}',

            '@keyframes sptFlow{to{background-position:200% 0}}',
            '@keyframes sptPulse{0%,100%{opacity:1;filter:drop-shadow(0 0 .05em var(--spt-c0))}50%{opacity:.8;filter:drop-shadow(0 0 calc(var(--spt-gl) * .2em) var(--spt-c0)) brightness(1.25)}}',
            '@keyframes sptFlicker{0%,18%,22%,25%,53%,57%,100%{opacity:1}20%,24%,55%{opacity:.45}}',
            '@keyframes sptBlink{0%,49%{opacity:1}50%,100%{opacity:.12}}',
            '@keyframes sptFade{0%,100%{opacity:1}50%{opacity:.3}}',
            '@keyframes sptHue{to{filter:hue-rotate(360deg)}}',
            '@keyframes sptHueShift{0%,100%{filter:hue-rotate(-45deg)}50%{filter:hue-rotate(45deg)}}',
            '@keyframes sptFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-.22em)}}',
            '@keyframes sptBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-.32em)}}',
            '@keyframes sptShake{0%,100%{transform:translateX(0) rotate(0)}25%{transform:translateX(-.05em) rotate(-2deg)}75%{transform:translateX(.05em) rotate(2deg)}}',
            '@keyframes sptSwing{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}',
            '@keyframes sptBeat{0%,100%{transform:scale(1)}15%{transform:scale(1.15)}30%{transform:scale(1)}45%{transform:scale(1.1)}}',
            '@keyframes sptShine{0%{background-position:100% 0}60%,100%{background-position:0% 0}}',
            '@keyframes sptScan{0%{background-position:0 0}100%{background-position:0 100%}}',
            '@keyframes sptGhost{0%,100%{transform:translate(-.1em,.03em)}50%{transform:translate(.1em,-.03em)}}',
            '@keyframes sptWave{0%,100%{transform:translateY(0)}50%{transform:translateY(-.28em)}}',
            '@keyframes sptHop{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-.4em)}}',
            '@keyframes sptJit{0%{transform:translate(0)}20%{transform:translate(.04em,-.04em)}40%{transform:translate(-.04em,.03em)}60%{transform:translate(.03em,.04em)}80%{transform:translate(-.03em,-.03em)}}',
            '@keyframes sptGlA{0%,84%,100%{transform:translate(0);clip-path:none}86%{transform:translate(-.08em,.03em);clip-path:inset(0 0 55% 0)}91%{transform:translate(.07em,-.03em);clip-path:inset(45% 0 0 0)}95%{transform:translate(-.05em,0);clip-path:inset(20% 0 30% 0)}}',
            '@keyframes sptGlB{0%,86%,100%{transform:translate(0);clip-path:none}88%{transform:translate(.08em,-.03em);clip-path:inset(50% 0 0 0)}93%{transform:translate(-.07em,.03em);clip-path:inset(0 0 45% 0)}97%{transform:translate(.05em,0);clip-path:inset(30% 0 20% 0)}}',
            '@keyframes sptTwinkle{0%,100%{transform:scale(.1);opacity:.1}50%{transform:scale(1);opacity:1}}',
            '@media (prefers-reduced-motion:reduce){.spt,.spt *,.spt::before,.spt::after,.spt *::before,.spt *::after{animation:none!important}}'
        ].join('\n');
        var st = document.createElement('style');
        st.id = 'spt-styles';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    })();

    /* ------------------------------ cleaning ------------------------------ */
    function round2(n) { return Math.round(n * 100) / 100; }
    function num(v, k) {
        var lim = LIMITS[k], n = Number(v);
        if (v === null || v === '' || !isFinite(n)) n = lim[2];
        return round2(Math.min(lim[1], Math.max(lim[0], n)));
    }
    function cleanText(t) {
        // plain text only: drop control characters and angle brackets, collapse spaces, cap the length
        var s = String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
        return Array.from(s).slice(0, TEXT_MAX).join('');
    }
    function clean(f) {
        if (!f || typeof f !== 'object') return null;
        var text = cleanText(f.text);
        if (!text) return null;
        var colors = (Array.isArray(f.colors) ? f.colors : []).filter(function (c) { return typeof c === 'string' && COLOR_RE.test(c); }).slice(0, 5);
        if (!colors.length) return null;
        var o = {
            v: 1, text: text,
            font: FONTS[f.font] ? f.font : 'sans',
            weight: Math.round(num(f.weight, 'weight') / 100) * 100,
            italic: f.italic === true,
            caps: f.caps === true,
            spacing: num(f.spacing, 'spacing'),
            size: num(f.size, 'size'),
            fill: f.fill === 'gradient' && colors.length > 1 ? 'gradient' : 'solid',
            colors: colors,
            angle: num(f.angle, 'angle'),
            flow: num(f.flow, 'flow'),
            effect: EFFECTS[f.effect] ? f.effect : 'none',
            effect2: EFFECTS[f.effect2] ? f.effect2 : 'none',
            effect3: EFFECTS[f.effect3] ? f.effect3 : 'none',
            strength: num(f.strength, 'strength'),
            speed: num(f.speed, 'speed'),
            outline: typeof f.outline === 'string' && COLOR_RE.test(f.outline) ? f.outline : null,
            deco: DECOS[f.deco] ? f.deco : 'none',
            left: SYMBOLS.indexOf(f.left) >= 0 ? f.left : '',
            right: SYMBOLS.indexOf(f.right) >= 0 ? f.right : '',
            iconL: iconOk(f.iconL) ? f.iconL : null,
            iconR: iconOk(f.iconR) ? f.iconR : null,
            iconSize: num(f.iconSize, 'iconSize')
        };
        return o;
    }

    /* ------------------------------ rendering ------------------------------ */
    function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    function colorAt(colors, t) {
        if (colors.length === 1) return colors[0];
        var x = Math.min(0.9999, Math.max(0, t)) * (colors.length - 1), i = Math.floor(x), k = x - i;
        var a = hexToRgb(colors[i]), b = hexToRgb(colors[i + 1]);
        function h(n) { var s = Math.round(n).toString(16); return s.length < 2 ? '0' + s : s; }
        return '#' + h(a[0] + (b[0] - a[0]) * k) + h(a[1] + (b[1] - a[1]) * k) + h(a[2] + (b[2] - a[2]) * k);
    }
    function gradientCss(f, loop) {
        var stops = f.colors.slice();
        if (loop) stops.push(f.colors[0]);          // wrap around so a flowing gradient has no seam
        return 'linear-gradient(' + f.angle + 'deg,' + stops.join(',') + ')';
    }
    function icon(url) {
        var im = document.createElement('img');
        im.className = 'spt-i'; im.alt = ''; im.decoding = 'async'; im.loading = 'lazy';
        im.setAttribute('referrerpolicy', 'no-referrer'); im.setAttribute('aria-hidden', 'true');
        im.src = url;
        im.onerror = function () { if (im.parentNode) im.parentNode.removeChild(im); };
        return im;
    }
    function sym(ch) { var d = document.createElement('i'); d.className = 'spt-d'; d.setAttribute('aria-hidden', 'true'); d.textContent = ch; return d; }

    function render(title) {
        var f = clean(title);
        if (!f) return null;
        var root = document.createElement('span'), st = root.style;
        ensureFont(f.font);
        // resolve up to 3 effects: one per group (the later one wins inside a group)
        var bySlot = {}, ids = [];
        [f.effect, f.effect2, f.effect3].forEach(function (k) { if (k && k !== 'none') bySlot[EFFECT_SLOT[k]] = k; });
        Object.keys(bySlot).forEach(function (g) { ids.push(bySlot[g]); });
        var letters = bySlot[LETTER_SLOT] !== undefined;
        root.className = 'spt ' + (ids.length ? ids.map(function (k) { return 'spt-fx-' + k; }).join(' ') : 'spt-fx-none');
        var inner = document.createElement('span');
        inner.className = 'spt-in' + (f.deco !== 'none' ? ' spt-deco-' + f.deco : '');
        root.setAttribute('title', f.text);
        st.setProperty('--spt-font', FONTS[f.font][1]);
        st.setProperty('--spt-weight', String(f.weight));
        st.setProperty('--spt-style', f.italic ? 'italic' : 'normal');
        st.setProperty('--spt-case', f.caps ? 'uppercase' : 'none');
        st.setProperty('--spt-ls', String(f.spacing));
        st.setProperty('--spt-size', String(f.size));
        st.setProperty('--spt-gl', String(round2(f.strength / 25)));
        st.setProperty('--spt-sp', String(f.speed));
        st.setProperty('--spt-isz', String(f.iconSize));
        f.colors.forEach(function (c, i) { st.setProperty('--spt-c' + i, c); });

        var grad = f.fill === 'gradient', flow = grad && f.flow > 0;
        if (grad) {
            st.setProperty('--spt-bg', gradientCss(f, flow || f.deco === 'underline' || f.deco === 'gradpill'));
            if (flow) { st.setProperty('--spt-bgs', '200% 100%'); st.setProperty('--spt-flow', String(f.flow)); }
        } else if (f.deco === 'underline' || f.deco === 'gradpill') {
            st.setProperty('--spt-bg', 'linear-gradient(90deg,' + f.colors[0] + ',' + f.colors[0] + ')');
        }
        if (f.outline) { st.setProperty('--spt-sc', f.outline); st.setProperty('--spt-sw', '1px'); }

        if (f.iconL) inner.appendChild(icon(f.iconL));
        if (f.left) inner.appendChild(sym(f.left));

        var x = document.createElement('span');
        x.className = 'spt-x' + (grad && !letters ? ' is-grad' : '') + (flow && !letters ? ' is-flow' : '') + (f.outline ? ' is-stroke' : '');
        x.setAttribute('data-text', f.text);
        if (letters) {
            // each letter bobs on its own, and gets its own point of the gradient as a plain color
            var chars = Array.from(f.text);
            chars.forEach(function (ch, i) {
                var c = document.createElement('span');
                c.className = 'spt-c';
                c.style.setProperty('--i', String(i));
                c.style.color = grad ? colorAt(f.colors, chars.length > 1 ? i / (chars.length - 1) : 0) : f.colors[0];
                c.textContent = ch;
                x.appendChild(c);
            });
        } else x.textContent = f.text;
        inner.appendChild(x);

        if (f.right) inner.appendChild(sym(f.right));
        if (f.iconR) inner.appendChild(icon(f.iconR));
        var wm = document.createElement('span'); wm.className = 'spt-m';
        var wf = document.createElement('span'); wf.className = 'spt-f';
        var wh = document.createElement('span'); wh.className = 'spt-h';
        wh.appendChild(inner); wf.appendChild(wh); wm.appendChild(wf); root.appendChild(wm);
        return root;
    }

    function apply(node, title) {
        if (!node) return;
        node.textContent = '';
        var el = title ? render(title) : null;
        if (el) { node.appendChild(el); node.classList.add('spt-has'); } else node.classList.remove('spt-has');
    }

    /* ------------------------------ templates ------------------------------ */
    function T(id, name, o) { return { id: id, name: name, title: clean(o) }; }
    var TEMPLATES = [
        T('aurora', 'Aurora', { text: 'Aurora', font: 'rounded', fill: 'gradient', colors: ['#22d3ee', '#a855f7', '#f472b6'], angle: 90, flow: 4, effect: 'glow', strength: 40 }),
        T('neon', 'Neon Sign', { text: 'NEON', font: 'mono', caps: true, spacing: 3, fill: 'solid', colors: ['#38bdf8', '#a78bfa'], effect: 'neon', strength: 60, speed: 3 }),
        T('royal', 'Royal', { text: 'Royalty', font: 'classic', italic: true, fill: 'gradient', colors: ['#fde68a', '#f59e0b', '#fde68a'], angle: 100, flow: 5, effect: 'shimmer', speed: 3, left: '\u265b', right: '\u265b' }),
        T('inferno', 'Inferno', { text: 'Inferno', font: 'display', fill: 'gradient', colors: ['#ffd54f', '#ff7a1a', '#ef2b3a'], angle: 0, flow: 3, effect: 'glow', strength: 70, left: '\u26a1' }),
        T('frost', 'Frostbite', { text: 'Frostbite', font: 'engrave', fill: 'gradient', colors: ['#e0f2fe', '#7dd3fc', '#ffffff'], angle: 90, flow: 6, effect: 'sparkle', speed: 3, left: '\u2744', right: '\u2744' }),
        T('wave', 'Surfer', { text: 'Wave Rider', font: 'comic', fill: 'gradient', colors: ['#34d399', '#22d3ee', '#a78bfa'], angle: 90, effect: 'wave', speed: 3 }),
        T('glitch', 'Glitch', { text: 'GLITCH', font: 'mono', caps: true, weight: 800, spacing: 2, fill: 'solid', colors: ['#e5e7eb'], effect: 'glitch', speed: 3 }),
        T('rainbow', 'Rainbow', { text: 'Rainbow', font: 'rounded', fill: 'gradient', colors: ['#ff4d4d', '#ffb84d', '#4dff88', '#4dc3ff', '#9a4dff'], angle: 90, flow: 4, effect: 'rainbow', speed: 3, deco: 'pill' }),
        T('mythic', 'Mythic', { text: 'Mythic', font: 'engrave', caps: true, spacing: 3, fill: 'gradient', colors: ['#ef2b3a', '#ff7a1a', '#ef2b3a'], angle: 90, flow: 3, effect: 'pulse', strength: 70, speed: 2.4, deco: 'brackets' }),
        T('owl', 'Night Owl', { text: 'Night Owl', font: 'serif', italic: true, fill: 'gradient', colors: ['#a78bfa', '#38bdf8'], angle: 90, effect: 'float', speed: 3, left: '\u263e' }),
        T('ghost', 'Ghost Pill', { text: 'Ghost', font: 'sans', fill: 'solid', colors: ['#cbd5e1'], effect: 'flicker', speed: 3, deco: 'pill' }),
        T('toxic', 'Toxic', { text: 'Toxic', font: 'display', fill: 'gradient', colors: ['#a3e635', '#22c55e'], angle: 90, effect: 'neon', strength: 55, deco: 'underline', right: '\u2620' })
    ];

    /* ------------------- who wears what (batched + cached) ------------------- */
    var cache = new Map();          // userId -> { at, title }
    var waiting = new Map();        // userId -> Set(nodes) waiting for the answer
    var timer = null;

    function fresh(id) { var c = cache.get(id); return c && Date.now() - c.at < TTL ? c : null; }

    function fetchTitles(ids) {
        var sb = client();
        var want = ids.filter(function (id) { return !fresh(id); });
        if (!sb || !want.length) return Promise.resolve();
        return Promise.resolve(sb.rpc('titles_for', { p_ids: want.slice(0, 200) })).then(function (res) {
            var now = Date.now(), got = new Map();
            if (res && !res.error) (res.data || []).forEach(function (r) { got.set(r.user_id, clean(r.title_data)); });
            var failed = !!(res && res.error);
            // on an error remember "no title" for only 30s so a missing SQL file does not hammer the server
            want.forEach(function (id) { cache.set(id, { at: failed ? now - TTL + 30000 : now, title: got.get(id) || null }); });
        }).catch(function () {
            want.forEach(function (id) { cache.set(id, { at: Date.now() - TTL + 30000, title: null }); });
        });
    }

    function flush() {
        timer = null;
        var ids = Array.from(waiting.keys()).slice(0, 200);
        if (!ids.length) return;
        var batch = new Map();
        ids.forEach(function (id) { batch.set(id, waiting.get(id)); waiting.delete(id); });
        if (waiting.size) timer = setTimeout(flush, 30);
        fetchTitles(ids).then(function () {
            batch.forEach(function (nodes, id) {
                var c = cache.get(id);
                nodes.forEach(function (n) { apply(n, c ? c.title : null); });
            });
        });
    }

    function adorn(node, userId) {
        if (!node || !userId) return node;
        userId = String(userId).toLowerCase();
        node.setAttribute('data-spt-uid', userId);
        var c = fresh(userId);
        if (c) { apply(node, c.title); return node; }
        if (!waiting.has(userId)) waiting.set(userId, new Set());
        waiting.get(userId).add(node);
        if (!timer) timer = setTimeout(flush, 40);
        return node;
    }

    function setMine(userId, title) {
        if (!userId) return;
        userId = String(userId).toLowerCase();
        var t = clean(title);
        cache.set(userId, { at: Date.now(), title: t });
        document.querySelectorAll('[data-spt-uid="' + userId + '"]').forEach(function (n) { apply(n, t); });
    }

    function forUsers(ids) { return fetchTitles((ids || []).map(function (i) { return String(i).toLowerCase(); })); }

    window.SpecTitles = {
        FONTS: FONTS, EFFECTS: EFFECTS, EFFECT_GROUPS: EFFECT_GROUPS, DECOS: DECOS, SYMBOLS: SYMBOLS, LIMITS: LIMITS, TEXT_MAX: TEXT_MAX, TEMPLATES: TEMPLATES,
        clean: clean, iconOk: iconOk, iconFromLink: iconFromLink, ensureFont: ensureFont, render: render, apply: apply, adorn: adorn, setMine: setMine, forUsers: forUsers
    };
})();
