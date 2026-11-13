/* ==========================================================================
   SPECSOFT® post-rich.js
   Draws a post's formatted text ("doc") on the page. Used by projects.js (hub) and profile.js (profile viewer).

   WHY THIS IS SAFE: a doc is plain DATA, never HTML. Every value is checked again HERE before it is drawn
   (colors must be #rrggbb, fonts and sizes come from fixed lists, links must be https://), because anyone
   could send anything to the database. Text is always added with textContent, never innerHTML.

   doc = { v: 1, blocks: [ { t: 'p' | 'h1' | 'h2' | 'h3', a: 'left' | 'center' | 'right' | 'justify',
                             r: [ { x: 'text', b, i, u, s, sp (spoiler), c (color), h (highlight), g [c1, c2] (gradient),
                                    f (font key), z (size key), l (link) } ] } ] }

   SpecRich.render(doc)        -> a <div class="sr-doc"> you can append
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
    var STATUS = {
        work: 'Work', updates: 'Updates', milestones: 'Milestones & Achievements', education: 'Education',
        awareness: 'Awareness', development: 'Development', teams: 'Teams'
    };
    var MAX_BLOCKS = 400, MAX_RUNS = 4000;

    function hex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; }
    function https(v) {
        if (typeof v !== 'string' || v.length > 300 || !/^https:\/\/[^\s]+$/i.test(v)) return null;
        try { var u = new URL(v); return u.protocol === 'https:' ? u.href : null; } catch (e) { return null; }
    }

    function run(r) {
        if (!r || typeof r.x !== 'string') return null;
        if (r.x === '\n') return document.createElement('br');

        var link = https(r.l);
        var node = document.createElement(link ? 'a' : 'span');
        node.textContent = r.x;
        var cls = [];

        if (link) {
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
                if (link && !node.classList.contains('is-revealed')) e.preventDefault();
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

    function render(doc) {
        var root = document.createElement('div');
        root.className = 'sr-doc';
        if (!doc || typeof doc !== 'object' || !Array.isArray(doc.blocks)) return root;

        var runs = 0;
        doc.blocks.slice(0, MAX_BLOCKS).forEach(function (b) {
            if (!b || typeof b !== 'object') return;
            var tag = TAGS[b.t] || 'p';
            var node = document.createElement(tag);
            if (typeof b.a === 'string' && ALIGN[b.a] && b.a !== 'left') node.style.textAlign = b.a;
            var any = false;
            (Array.isArray(b.r) ? b.r : []).forEach(function (r) {
                if (runs >= MAX_RUNS) return;
                var n = run(r);
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

    window.SpecRich = { render: render, plain: plain, statusLabel: statusLabel, STATUS: STATUS, FONTS: FONTS, SIZES: SIZES, hex: hex, https: https };
})();
