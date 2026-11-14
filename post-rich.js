/* ==========================================================================
   SPECSOFT® post-rich.js  (v2)
   Draws a post's formatted text ("doc") and its music on the page. Used by projects.js (hub) and profile.js (profile viewer).

   WHY THIS IS SAFE: a doc is plain DATA, never HTML. Every value is checked again HERE before it is drawn
   (colors must be #rrggbb, fonts / sizes / animations come from fixed lists, links must be https://, mentions must look
   like a username or a UUID, background images and songs must come from OUR storage buckets), because anyone could send
   anything to the database. Text is always added with textContent, never innerHTML.

   doc = { v: 1,
           bg: { k: 'solid', c, fg } | { k: 'grad', g: [c1, c2], fg } | { k: 'img', u, fg, ov },     (fg: 'light' | 'dark', ov: 0 | 30 | 60)
           blocks: [ { t: 'p' | 'h1' | 'h2' | 'h3', a: 'left' | 'center' | 'right' | 'justify',
                       r: [ { x: 'text', b, i, u, s, sp (spoiler), c (color), h (highlight), g [c1, c2] (gradient),
                              f (font key), z (size key), l (link),
                              a (moving text: wave | glow | pulse | shake | rainbow | bounce),
                              m (mention: 'u:username' or 'p:<project uuid>') } ] } ] }

   music = { mode: 'background' | 'showcase', tracks: [ { url, title, artist } ] }

   SpecRich.render(doc)        -> a <div class="sr-doc"> you can append
   SpecRich.music(music)       -> a music player you can append (or null)
   SpecRich.stopMusic()        -> stops whatever is playing
   SpecRich.plain(doc)         -> the same text with no styling
   SpecRich.statusLabel(post)  -> "Work", "Milestones & Achievements", the custom label, or ''
   ========================================================================== */
(function () {
    'use strict';

    var TAGS = { p: 'p', h1: 'h1', h2: 'h2', h3: 'h3' };
    var ALIGN = { left: 1, center: 1, right: 1, justify: 1 };
    var FONTS = {
        mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
        serif: "Georgia, 'Times New Roman', serif",
        script: "'Segoe Script', 'Bradley Hand', 'Snell Roundhand', cursive",
        display: "'Arial Black', 'Helvetica Neue', Impact, sans-serif"
    };
    var SIZES = { s: '0.85em', l: '1.25em', xl: '1.6em', xxl: '2.1em' };
    var ANIMS = { wave: 1, glow: 1, pulse: 1, shake: 1, rainbow: 1, bounce: 1 };
    var STATUS = {
        work: 'Work', updates: 'Updates', milestones: 'Milestones & Achievements', education: 'Education',
        awareness: 'Awareness', development: 'Development', teams: 'Teams'
    };
    var MAX_BLOCKS = 400, MAX_RUNS = 4000, MAX_WAVE_CHARS = 120;
    var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    function hex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; }
    function https(v) {
        if (typeof v !== 'string' || v.length > 300 || !/^https:\/\/[^\s]+$/i.test(v)) return null;
        try { var u = new URL(v); return u.protocol === 'https:' ? u.href : null; } catch (e) { return null; }
    }
    // a file that lives in one of OUR public storage buckets (and has nothing in it that could break out of a CSS url())
    function storageUrl(v, bucket) {
        var u = https(v);
        if (!u || u.indexOf('/storage/v1/object/public/' + bucket + '/') < 0 || !/^[^"'()\\\s]+$/.test(u)) return null;
        return u;
    }
    function mention(m) {
        if (typeof m !== 'string') return null;
        var x = /^u:([A-Za-z0-9_]{1,20})$/.exec(m);
        if (x) return { href: 'profile.html?u=' + encodeURIComponent(x[1]), cls: 'sr-mention' };
        x = /^p:([0-9a-f-]{36})$/i.exec(m);
        if (x && UUID.test(x[1])) return { href: 'projects.html#project-' + x[1].toLowerCase(), cls: 'sr-mention sr-mention--p' };
        return null;
    }

    // visitors who switched motion off in Settings, or whose device asks for less motion, get still text
    function still() {
        try {
            if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
            if (window.SpecSettings && (SpecSettings.get('ultraReduceMotion') === true || SpecSettings.get('reduceMotion') === true)) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    function fillWave(node, text) {                       // one tiny span per letter so each can bob a little later than the one before it
        node.setAttribute('aria-label', text);
        var i = 0;
        text.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { node.appendChild(document.createTextNode(part)); return; }
            var w = document.createElement('span');
            w.className = 'sr-w';
            w.setAttribute('aria-hidden', 'true');
            part.split('').forEach(function (ch) {
                var c = document.createElement('span');
                c.className = 'sr-ch';
                c.style.animationDelay = (i++ * 70) + 'ms';
                c.textContent = ch;
                w.appendChild(c);
            });
            node.appendChild(w);
        });
    }

    function run(r, calm) {
        if (!r || typeof r.x !== 'string') return null;
        if (r.x === '\n') return document.createElement('br');

        var men = mention(r.m);
        var link = men ? null : https(r.l);
        var node = document.createElement(men || link ? 'a' : 'span');
        var anim = typeof r.a === 'string' && ANIMS[r.a] && !calm ? r.a : '';
        var cls = [];

        if (anim === 'wave' && r.x.length <= MAX_WAVE_CHARS) { fillWave(node, r.x); cls.push('sr-anim', 'sr-a-wave'); }
        else {
            node.textContent = r.x;
            if (anim) { cls.push('sr-anim', 'sr-a-' + (anim === 'wave' ? 'bounce' : anim)); }
        }

        if (men) {
            node.href = men.href;
            cls.push.apply(cls, men.cls.split(' '));
        } else if (link) {
            node.href = link; node.target = '_blank'; node.rel = 'noopener noreferrer nofollow';
            cls.push('sr-link');
        }
        if (r.b === true) node.style.fontWeight = '700';
        if (r.i === true) node.style.fontStyle = 'italic';
        var deco = [];
        if (r.u === true) deco.push('underline');
        if (r.s === true) deco.push('line-through');
        if (deco.length) node.style.textDecoration = deco.join(' ');

        var c = hex(r.c), h = hex(r.h);
        var g = Array.isArray(r.g) && r.g.length === 2 && hex(r.g[0]) && hex(r.g[1]) ? [hex(r.g[0]), hex(r.g[1])] : null;
        if (h) { node.style.backgroundColor = h; cls.push('sr-hl'); }
        if (c) node.style.color = c;
        if (g) {
            node.style.backgroundImage = 'linear-gradient(90deg,' + g[0] + ',' + g[1] + ')';
            node.style.setProperty('-webkit-background-clip', 'text');
            node.style.backgroundClip = 'text';
            node.style.color = 'transparent';
            cls.push('sr-grad');
        }
        if (typeof r.f === 'string' && FONTS[r.f]) node.style.fontFamily = FONTS[r.f];
        if (typeof r.z === 'string' && SIZES[r.z]) node.style.fontSize = SIZES[r.z];

        if (r.sp === true) {
            cls.push('sr-spoiler');
            node.setAttribute('role', 'button');
            node.setAttribute('tabindex', '0');
            node.setAttribute('aria-label', 'Spoiler. Press to reveal.');
            var flip = function (e) {
                if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                node.classList.toggle('is-revealed');
                node.setAttribute('aria-label', node.classList.contains('is-revealed') ? 'Spoiler, revealed' : 'Spoiler. Press to reveal.');
            };
            node.addEventListener('click', flip);
            node.addEventListener('keydown', flip);
        }
        if (cls.length) node.className = cls.join(' ');
        return node;
    }

    function applyBg(root, bg) {
        if (!bg || typeof bg !== 'object') return;
        var fg = bg.fg === 'dark' ? '#0a0a0a' : '#ffffff';
        var ok = false;
        if (bg.k === 'solid' && hex(bg.c)) { root.style.backgroundColor = hex(bg.c); ok = true; }
        else if (bg.k === 'grad' && Array.isArray(bg.g) && bg.g.length === 2 && hex(bg.g[0]) && hex(bg.g[1])) {
            root.style.backgroundImage = 'linear-gradient(135deg,' + hex(bg.g[0]) + ',' + hex(bg.g[1]) + ')'; ok = true;
        } else if (bg.k === 'img') {
            var u = storageUrl(bg.u, 'post-media');
            if (u) {
                var ov = bg.ov === 30 || bg.ov === 60 ? bg.ov / 100 : 0;
                root.style.backgroundImage = (ov ? 'linear-gradient(rgba(0,0,0,' + ov + '),rgba(0,0,0,' + ov + ')),' : '') + 'url("' + u + '")';
                ok = true;
            }
        }
        if (!ok) return;
        root.style.color = fg;
        root.classList.add('sr-has-bg');
    }

    function render(doc) {
        var root = document.createElement('div');
        root.className = 'sr-doc';
        if (!doc || typeof doc !== 'object' || !Array.isArray(doc.blocks)) return root;
        applyBg(root, doc.bg);

        var calm = still(), runs = 0;
        doc.blocks.slice(0, MAX_BLOCKS).forEach(function (b) {
            if (!b || typeof b !== 'object') return;
            var node = document.createElement(TAGS[b.t] || 'p');
            if (typeof b.a === 'string' && ALIGN[b.a] && b.a !== 'left') node.style.textAlign = b.a;
            var any = false;
            (Array.isArray(b.r) ? b.r : []).forEach(function (r) {
                if (runs >= MAX_RUNS) return;
                var n = run(r, calm);
                if (n) { node.appendChild(n); runs++; any = true; }
            });
            if (!any) node.appendChild(document.createElement('br'));     // an empty line keeps its height
            root.appendChild(node);
        });
        return root;
    }

    function plain(doc) {
        if (!doc || !Array.isArray(doc.blocks)) return '';
        return doc.blocks.slice(0, MAX_BLOCKS).map(function (b) {
            return (b && Array.isArray(b.r) ? b.r : []).map(function (r) { return r && typeof r.x === 'string' ? r.x : ''; }).join('');
        }).join('\n').trim();
    }

    function statusLabel(p) {
        if (!p) return '';
        if (p.status === 'custom') return String(p.status_label || '').slice(0, 24);
        return STATUS[p.status] || '';
    }

    /* ======================================================================= MUSIC
       One song plays at a time on the whole page. It starts only when someone taps (browsers block sound that starts by itself,
       and it would be rude anyway). Volume comes from Settings > Interface & Sound > Post music volume (it starts quiet).
       Playback stops by itself when the post is closed, or you move to another one.                                         */
    var ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
    var ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1"/><rect x="13.8" y="5" width="4.2" height="14" rx="1"/></svg>';
    var ICON_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';

    var cur = { audio: null, ui: null, timer: 0 };

    function volume() {
        var v = NaN;
        try { if (window.SpecSettings && SpecSettings.get) v = Number(SpecSettings.get('postMusicVol')); } catch (e) { /* ignore */ }
        if (!isFinite(v)) {
            try { v = Number((JSON.parse(localStorage.getItem('specsoft.settings.v1') || '{}') || {}).postMusicVol); } catch (e2) { v = NaN; }
        }
        if (!isFinite(v)) v = 25;                           // the safe default
        return Math.min(1, Math.max(0, v / 100));
    }

    function stopMusic() {
        if (cur.timer) { clearInterval(cur.timer); cur.timer = 0; }
        if (cur.audio) { try { cur.audio.pause(); } catch (e) { /* ignore */ } }
        if (cur.ui) cur.ui.reset();
        cur.audio = null; cur.ui = null;
    }

    function start(track, loop, ui) {
        stopMusic();
        var a = new Audio();
        a.preload = 'none';
        a.loop = !!loop;
        a.volume = volume();
        a.src = track.url;
        cur.audio = a; cur.ui = ui;

        a.addEventListener('timeupdate', function () { if (cur.audio === a) ui.progress(a.duration ? a.currentTime / a.duration : 0); });
        a.addEventListener('ended', function () { if (cur.audio === a) stopMusic(); });
        a.addEventListener('error', function () { if (cur.audio === a) { stopMusic(); ui.fail(); } });

        var p = a.play();
        if (p && p.catch) p.catch(function () { if (cur.audio === a) { stopMusic(); ui.fail(); } });
        ui.playing(true);

        cur.timer = setInterval(function () {
            if (cur.audio !== a) return;
            a.volume = volume();                                            // follows the Settings slider while it plays
            if (!ui.node.isConnected || ui.node.getClientRects().length === 0) stopMusic();   // the post was closed
        }, 500);
    }

    function toggle(track, loop, ui) {
        if (cur.ui === ui && cur.audio) {
            if (cur.audio.paused) { var q = cur.audio.play(); if (q && q.catch) q.catch(function () { stopMusic(); ui.fail(); }); ui.playing(true); }
            else { cur.audio.pause(); ui.playing(false); }
            return;
        }
        start(track, loop, ui);
    }

    function track(t, loop) {
        var node = document.createElement('button');
        node.type = 'button';
        node.className = 'sr-track';
        node.setAttribute('aria-pressed', 'false');
        node.setAttribute('aria-label', 'Play ' + t.title + (t.artist ? ' by ' + t.artist : ''));

        var ic = document.createElement('span'); ic.className = 'sr-play'; ic.innerHTML = ICON_PLAY;             // constant markup
        var meta = document.createElement('span'); meta.className = 'sr-track-t';
        var title = document.createElement('strong'); title.textContent = t.title;
        var sub = document.createElement('small');
        meta.appendChild(title); meta.appendChild(sub);
        var bar = document.createElement('i'); bar.className = 'sr-bar';
        var fill = document.createElement('b'); bar.appendChild(fill);
        node.appendChild(ic); node.appendChild(meta); node.appendChild(bar);

        function idle() { sub.textContent = (t.artist ? t.artist + '  \u00B7  ' : '') + 'TAP TO PLAY'; }
        idle();

        var ui = {
            node: node,
            playing: function (on) {
                node.classList.toggle('is-on', on);
                node.setAttribute('aria-pressed', String(on));
                ic.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
                sub.textContent = (t.artist ? t.artist + '  \u00B7  ' : '') + (on ? 'PLAYING' : 'PAUSED');
            },
            progress: function (f) { fill.style.width = Math.round(Math.min(1, Math.max(0, f)) * 100) + '%'; },
            reset: function () { node.classList.remove('is-on'); node.setAttribute('aria-pressed', 'false'); ic.innerHTML = ICON_PLAY; fill.style.width = '0'; idle(); },
            fail: function () { node.classList.remove('is-on'); ic.innerHTML = ICON_PLAY; sub.textContent = 'COULD NOT PLAY THIS SONG'; }
        };
        node.addEventListener('click', function () { toggle(t, loop, ui); });
        return node;
    }

    function music(m) {
        if (!m || typeof m !== 'object' || (m.mode !== 'background' && m.mode !== 'showcase') || !Array.isArray(m.tracks)) return null;
        var list = [];
        m.tracks.slice(0, m.mode === 'background' ? 1 : 5).forEach(function (t) {
            var url = t && storageUrl(t.url, 'post-audio');
            if (!url) return;
            list.push({
                url: url,
                title: String(t.title || 'Untitled').slice(0, 60) || 'Untitled',
                artist: String(t.artist || '').slice(0, 40)
            });
        });
        if (!list.length) return null;

        var loop = m.mode === 'background';
        var box = document.createElement('div');
        box.className = 'sr-music sr-music--' + m.mode;
        var head = document.createElement('div');
        head.className = 'sr-music-h';
        var hi = document.createElement('span'); hi.className = 'sr-music-ic'; hi.innerHTML = ICON_NOTE;           // constant markup
        var ht = document.createElement('span');
        ht.textContent = loop ? 'BACKGROUND MUSIC  \u00B7  LOOPS' : 'MUSIC  \u00B7  ' + list.length + (list.length === 1 ? ' TRACK' : ' TRACKS');
        head.appendChild(hi); head.appendChild(ht);
        box.appendChild(head);
        list.forEach(function (t) { box.appendChild(track(t, loop)); });
        return box;
    }

    window.SpecRich = {
        render: render, music: music, stopMusic: stopMusic, plain: plain, statusLabel: statusLabel,
        STATUS: STATUS, FONTS: FONTS, SIZES: SIZES, ANIMS: ANIMS, hex: hex, https: https, storageUrl: storageUrl
    };
})();
