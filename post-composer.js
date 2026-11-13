/* ==========================================================================
   SPECSOFT® post composer v2 (post-composer.js)
   A post is saved as a profile_projects row with kind = 'post', so it shows up in the hub and on the profile
   and gets likes / comments / reposts / saves / reports for free.

   WHAT'S NEW IN v2
     - profile header + one big writing area (no title box: the title is taken from your first line)
     - floating dock:  Aa (text styles)  |  image  |  star (status)  |  video  |  more (settings + tools)
     - styles are saved as safe DATA (a "doc"), never raw HTML. See post-rich.js
     - post settings: Public / Followers only / People I follow / Only me
     - video up to 50 MB, images up to 10 MB, files up to 25 MB, 100 MB per post

   Needs: supabase-hub-v3.sql, post-rich.js (to DRAW formatted posts), post-social.css.

   SpecComposer.open({ sb, me, toast, onCreated })
   ========================================================================== */
(function () {
    'use strict';

    var MAX_IMAGES = 6, MAX_VIDEOS = 1, MAX_FILES = 5, MAX_LINKS = 5, MAX_TAGS = 6, MAX_TEXT = 5000;
    var MB = 1048576;
    var MAX_IMG = 10 * MB, MAX_VID = 50 * MB, MAX_FILE = 25 * MB, MAX_TOTAL = 100 * MB;

    // what the post-media bucket accepts (supabase-hub-v3.sql). The extension decides, because browsers report odd types for zip / md.
    var TYPES = {
        png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'], webp: ['image/webp', 'image'], gif: ['image/gif', 'image'],
        mp4: ['video/mp4', 'video'], webm: ['video/webm', 'video'],
        pdf: ['application/pdf', 'file'], zip: ['application/zip', 'file'], json: ['application/json', 'file'], txt: ['text/plain', 'file'], md: ['text/markdown', 'file']
    };
    var IMG_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif', VID_ACCEPT = '.mp4,.webm', FILE_ACCEPT = '.pdf,.zip,.json,.txt,.md';

    var VIS = [
        ['public', 'Public', 'Anyone can see this post'],
        ['followers', 'Followers only', 'Only people who follow me'],
        ['following', 'People I follow', 'Only people I follow'],
        ['private', 'Only me', 'Private, just for you']
    ];
    var STATUS = [
        ['work', 'Work'], ['updates', 'Updates'], ['milestones', 'Milestones & Achievements'], ['education', 'Education'],
        ['awareness', 'Awareness'], ['development', 'Development'], ['teams', 'Teams']
    ];
    var FONTS = [['', 'Default', ''], ['mono', 'Mono', "'JetBrains Mono', monospace"], ['serif', 'Serif', 'Georgia, serif'], ['script', 'Script', "'Segoe Script', 'Bradley Hand', cursive"], ['display', 'Display', "'Arial Black', Impact, sans-serif"]];
    var SIZES = [['s', 'Small', '0.85em'], ['', 'Normal', ''], ['l', 'Large', '1.25em'], ['xl', 'Huge', '1.6em'], ['xxl', 'Giant', '2.1em']];
    var SOLID = ['#ffffff', '#a3a3a3', '#171717', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
    var HILITE = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74', '#c4b5fd', '#fca5a5', '#67e8f9'];
    var GRADS = [['#f97316', '#ec4899'], ['#06b6d4', '#8b5cf6'], ['#22c55e', '#eab308'], ['#ef4444', '#f97316'], ['#3b82f6', '#22d3ee'], ['#a855f7', '#ec4899'], ['#fde047', '#f97316'], ['#ffffff', '#737373']];

    var ICON = {
        img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>',
        vid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
        star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>',
        dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
        at: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/></svg>',
        box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8"/></svg>'
    };

    /* ---------------------------------------------------------------------- tiny helpers */
    function el(tag, attrs) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            var v = attrs[k];
            if (v === null || v === undefined || v === false) return;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'html') node.innerHTML = v;                       // ONLY used with the constant ICON strings above
            else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        });
        for (var i = 2; i < arguments.length; i++) put(node, arguments[i]);
        return node;
    }
    function put(parent, c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) { c.forEach(function (x) { put(parent, x); }); return; }
        parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
    function bytes(n) { return n >= MB ? (n / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function safeName(n) { return String(n).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60) || 'file'; }
    function hex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null; }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function httpsUrl(v) { return typeof v === 'string' && v.length <= 300 && /^https:\/\/[^\s]+$/i.test(v) ? v : null; }

    function friendly(err) {
        var code = String(err && err.code || ''), msg = String(err && err.message || '').toLowerCase();
        if (code === 'PGRST204' || /column .*(kind|body|attachments|links|doc|visibility|status)|post-media|bucket not found/.test(msg)) return 'Run supabase-hub-v3.sql in your Supabase SQL Editor to turn on the new posts.';
        if (code === '42501' || msg.indexOf('row-level security') >= 0) return 'You reached the limit of 100 posts, or you are not allowed to post right now.';
        if (code === '23514') return 'Something is too long or not allowed (text 5000 characters, links must start with https://).';
        if (msg.indexOf('exceeded') >= 0 || msg.indexOf('too large') >= 0) return 'One of your files is too big for the server.';
        if (msg.indexOf('failed to fetch') >= 0 || msg.indexOf('network') >= 0) return 'Cannot reach the server. Check your connection.';
        return 'Something went wrong. Please try again.';
    }

    /* ---------------------------------------------------------------------- the composer */
    function open(opts) {
        opts = opts || {};
        var sb = opts.sb, me = opts.me, say = opts.toast || function () { };
        if (!sb) return;
        if (!me) { say('Log in to create a post.'); return; }
        if (document.getElementById('pcxDialog')) return;

        var S = {
            items: [], links: [], tags: '', vis: 'public', status: '', statusLabel: '', hub: true,
            sheet: null, colorTab: 'solid', busy: false, dirty: false
        };
        var saved = null;                                                    // last text selection inside the editor

        var dlg = el('dialog', { class: 'pcx', id: 'pcxDialog', 'aria-label': 'Create a post' });
        var msg = el('p', { class: 'pcx-msg', role: 'alert' });
        var bar = el('div', { class: 'pcx-progress', hidden: true }, el('i'));
        var counter = el('span', { class: 'pcx-counter', text: '0 / ' + MAX_TEXT });
        var tray = el('div', { class: 'pcx-tray' });
        var linksBox = el('div', { class: 'pcx-links' });
        var sheet = el('div', { class: 'pcx-sheet', hidden: true });
        var postBtn = el('button', { type: 'submit', class: 'pcx-post' }, 'Post');

        var imgPicker = el('input', { type: 'file', multiple: true, hidden: true, accept: IMG_ACCEPT });
        var vidPicker = el('input', { type: 'file', hidden: true, accept: VID_ACCEPT });
        var filePicker = el('input', { type: 'file', multiple: true, hidden: true, accept: FILE_ACCEPT });

        var editor = el('div', {
            class: 'pcx-ed is-empty', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Write your post',
            spellcheck: 'true', 'data-ph': 'What do you want to share? Updates, ideas, wins...'
        });
        editor.innerHTML = '<p><br></p>';                                    // constant markup

        function say2(t) { msg.textContent = t || ''; }
        function mark() { S.dirty = true; }

        /* ---- author header ---- */
        var avatar = el('span', { class: 'pcx-av', 'aria-hidden': 'true', text: '?' });
        var nameEl = el('strong', { class: 'pcx-name', text: 'You' });
        var visPill = el('button', { type: 'button', class: 'pcx-pill', onclick: function () { toggleSheet('more'); } });
        var statusPill = el('button', { type: 'button', class: 'pcx-pill pcx-pill--status', hidden: true, onclick: function () { toggleSheet('star'); } });

        function paintPills() {
            var v = VIS.filter(function (x) { return x[0] === S.vis; })[0];
            visPill.textContent = v[1] + '  \u25BE';
            var label = S.status === 'custom' ? S.statusLabel : (STATUS.filter(function (x) { return x[0] === S.status; })[0] || [0, ''])[1];
            statusPill.hidden = !label;
            statusPill.textContent = label;
        }
        function paintAuthor(p) {
            var name = (p && (p.display_name || p.username)) || 'You';
            nameEl.textContent = name;
            clear(avatar);
            if (p && httpsUrl(p.avatar_url)) avatar.appendChild(el('img', { src: p.avatar_url, alt: '', referrerpolicy: 'no-referrer' }));
            else avatar.textContent = name.charAt(0).toUpperCase();
        }
        try {
            sb.from('profiles').select('username,display_name,avatar_url').eq('id', me.id).maybeSingle()
                .then(function (r) { if (r && r.data) paintAuthor(r.data); }, function () { /* header just shows "You" */ });
        } catch (e0) { /* ignore */ }

        /* ---- selection helpers ---- */
        function onSel() {
            var s = window.getSelection();
            if (s && s.rangeCount && editor.contains(s.anchorNode) && editor.contains(s.focusNode)) saved = s.getRangeAt(0).cloneRange();
        }
        document.addEventListener('selectionchange', onSel);
        function restore() {
            editor.focus();
            if (saved) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); }
        }
        function blockOf(node) {
            while (node && node.parentNode !== editor) node = node.parentNode;
            return node;
        }
        function selRange() {
            restore();
            var s = window.getSelection();
            if (!s.rangeCount) return null;
            return s.getRangeAt(0);
        }
        function exec(cmd, val) {
            restore();
            try { document.execCommand('styleWithCSS', false, true); } catch (e1) { /* ignore */ }
            document.execCommand(cmd, false, val || null);
            afterEdit();
        }

        // wrap the selected text in a styled <span>, via insertHTML so undo (Ctrl+Z) keeps working
        var CSSKEY = { 'data-c': 'color', 'data-h': 'backgroundColor', 'data-g': 'backgroundImage', 'data-f': 'fontFamily', 'data-z': 'fontSize' };
        function styleSpan(strip, attrs, css) {
            var r = selRange();
            if (!r || r.collapsed) { say2('Select some text first.'); return; }
            if (blockOf(r.startContainer) !== blockOf(r.endContainer)) { say2('Select text inside ONE paragraph for this style.'); return; }
            say2('');
            var tmp = document.createElement('div');
            tmp.appendChild(r.cloneContents());
            strip.forEach(function (k) {
                Array.prototype.forEach.call(tmp.querySelectorAll('[' + k + ']'), function (n) {
                    n.removeAttribute(k);
                    if (CSSKEY[k]) n.style[CSSKEY[k]] = '';
                    if (k === 'data-g') { n.style.webkitBackgroundClip = ''; n.style.backgroundClip = ''; n.style.color = ''; }
                });
            });
            var html;
            if (attrs) {
                var a = Object.keys(attrs).map(function (k) { return k + '="' + esc(attrs[k]) + '"'; }).join(' ');
                html = '<span ' + a + (css ? ' style="' + esc(css) + '"' : '') + '>' + tmp.innerHTML + '</span>';
            } else html = tmp.innerHTML;
            document.execCommand('insertHTML', false, html);
            afterEdit();
        }
        function clearStyles() {
            var r = selRange();
            if (!r || r.collapsed) { say2('Select some text first.'); return; }
            if (blockOf(r.startContainer) !== blockOf(r.endContainer)) { say2('Select text inside ONE paragraph to clear it.'); return; }
            say2('');
            var tmp = document.createElement('div');
            tmp.appendChild(r.cloneContents());
            var all = tmp.querySelectorAll('*');
            for (var i = all.length - 1; i >= 0; i--) {
                var n = all[i];
                if (n.tagName === 'BR') continue;
                while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
                n.parentNode.removeChild(n);
            }
            document.execCommand('insertHTML', false, tmp.innerHTML);
            afterEdit();
        }

        /* ---- reading the editor back into safe data ---- */
        function styleFrom(node, base) {
            var s = {}; Object.keys(base).forEach(function (k) { s[k] = base[k]; });
            var tag = node.tagName;
            if (tag === 'B' || tag === 'STRONG') s.b = true;
            if (tag === 'I' || tag === 'EM') s.i = true;
            if (tag === 'U') s.u = true;
            if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.s = true;
            var st = node.style;
            if (st) {
                var fw = st.fontWeight; if (fw === 'bold' || (+fw >= 600)) s.b = true;
                if (st.fontStyle === 'italic') s.i = true;
                var td = (st.textDecorationLine || st.textDecoration || '');
                if (td.indexOf('underline') >= 0) s.u = true;
                if (td.indexOf('line-through') >= 0) s.s = true;
            }
            var d = node.dataset || {};
            if (d.c && hex(d.c)) s.c = hex(d.c);
            if (d.h && hex(d.h)) s.h = hex(d.h);
            if (d.g) { var gp = d.g.split(','); if (gp.length === 2 && hex(gp[0]) && hex(gp[1])) s.g = [hex(gp[0]), hex(gp[1])]; }
            if (d.f && /^(mono|serif|script|display)$/.test(d.f)) s.f = d.f;
            if (d.z && /^(s|l|xl|xxl)$/.test(d.z)) s.z = d.z;
            if (d.sp !== undefined) s.sp = true;
            if (d.l && httpsUrl(d.l)) s.l = d.l;
            return s;
        }
        function collect(node, style, out) {
            if (node.nodeType === 3) {
                var t = node.nodeValue.replace(/\u00A0/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');
                if (!t) return;
                var run = { x: t }; Object.keys(style).forEach(function (k) { run[k] = style[k]; });
                out.push(run);
                return;
            }
            if (node.nodeType !== 1) return;
            if (node.tagName === 'BR') { out.push({ x: '\n' }); return; }
            var st = styleFrom(node, style);
            for (var c = node.firstChild; c; c = c.nextSibling) collect(c, st, out);
        }
        function mergeRuns(runs) {
            var out = [];
            runs.forEach(function (r) {
                var prev = out[out.length - 1];
                if (prev && prev.x !== '\n' && r.x !== '\n') {
                    var a = JSON.stringify(Object.assign({}, prev, { x: '' })), b = JSON.stringify(Object.assign({}, r, { x: '' }));
                    if (a === b) { prev.x += r.x; return; }
                }
                out.push(r);
            });
            return out;
        }
        function blockFrom(n) {
            var t = ({ H1: 'h1', H2: 'h2', H3: 'h3' })[n.tagName] || 'p';
            var al = (n.style && n.style.textAlign) || n.getAttribute('align') || '';
            var runs = [];
            for (var c = n.firstChild; c; c = c.nextSibling) collect(c, {}, runs);
            if (runs.length && runs[runs.length - 1].x === '\n') runs.pop();   // the browser's own empty-line placeholder
            var b = { t: t, r: mergeRuns(runs) };
            if (/^(center|right|justify)$/.test(al)) b.a = al;
            return b;
        }
        function serialize() {
            var blocks = [], cur = null;
            Array.prototype.forEach.call(editor.childNodes, function (n) {
                if (n.nodeType === 1 && /^(P|DIV|H1|H2|H3)$/.test(n.tagName)) { blocks.push(blockFrom(n)); cur = null; }
                else {
                    if (!cur) { cur = { t: 'p', r: [] }; blocks.push(cur); }
                    collect(n, {}, cur.r);
                }
            });
            blocks.forEach(function (b) { b.r = mergeRuns(b.r); });
            while (blocks.length && !blocks[blocks.length - 1].r.length) blocks.pop();
            return blocks;
        }
        function plainOf(blocks) {
            return blocks.map(function (b) { return b.r.map(function (r) { return r.x; }).join(''); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
        }
        function hasFormat(blocks) {
            return blocks.some(function (b) {
                return b.t !== 'p' || b.a || b.r.some(function (r) { return Object.keys(r).length > 1; });
            });
        }

        function afterEdit() {
            if (!editor.firstChild) editor.innerHTML = '<p><br></p>';
            var plain = plainOf(serialize());
            editor.classList.toggle('is-empty', !plain && editor.querySelectorAll('p,h1,h2,h3,div').length <= 1);
            counter.textContent = plain.length + ' / ' + MAX_TEXT;
            counter.classList.toggle('is-over', plain.length > MAX_TEXT);
            mark();
        }
        editor.addEventListener('input', afterEdit);
        editor.addEventListener('focus', function () {
            try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, true); } catch (e2) { /* ignore */ }
        });
        editor.addEventListener('paste', function (e) {
            var cd = e.clipboardData;
            if (cd && cd.files && cd.files.length) { e.preventDefault(); addFiles(cd.files); return; }   // paste a screenshot straight in
            e.preventDefault();
            var text = cd ? cd.getData('text/plain') : '';
            if (text) { document.execCommand('insertText', false, text); afterEdit(); }                  // plain text only: no foreign styles
        });

        /* ---- files ---- */
        function totalBytes() { return S.items.reduce(function (n, i) { return n + i.file.size; }, 0); }
        function addFiles(list, only) {
            say2('');
            Array.prototype.forEach.call(list, function (f) {
                var e = ext(f.name), t = TYPES[e];
                if (!t || (only && t[1] !== only)) { say2('".' + e + '" is not supported here.'); return; }
                if (t[1] === 'image' && f.size > MAX_IMG) { say2(f.name + ' is over 10 MB. Images can be up to 10 MB.'); return; }
                if (t[1] === 'video' && f.size > MAX_VID) { say2(f.name + ' is over 50 MB. Videos can be up to 50 MB.'); return; }
                if (t[1] === 'file' && f.size > MAX_FILE) { say2(f.name + ' is over 25 MB. Files can be up to 25 MB.'); return; }
                if (totalBytes() + f.size > MAX_TOTAL) { say2('One post can hold up to 100 MB of uploads.'); return; }
                var n = function (k) { return S.items.filter(function (i) { return i.kind === k; }).length; };
                if (t[1] === 'image' && n('image') >= MAX_IMAGES) { say2('You can add up to ' + MAX_IMAGES + ' images.'); return; }
                if (t[1] === 'video' && n('video') >= MAX_VIDEOS) { say2('You can add 1 video per post.'); return; }
                if (t[1] === 'file' && n('file') >= MAX_FILES) { say2('You can add up to ' + MAX_FILES + ' files.'); return; }
                S.items.push({ file: f, kind: t[1], mime: t[0], preview: t[1] === 'image' ? URL.createObjectURL(f) : '' });
                mark();
            });
            paintTray();
        }
        function paintTray() {
            clear(tray);
            var firstImg = true;
            S.items.forEach(function (it, i) {
                var rm = el('button', { type: 'button', class: 'pcx-rm', 'aria-label': 'Remove ' + it.file.name, html: ICON.x, onclick: function () {
                    if (it.preview) URL.revokeObjectURL(it.preview);
                    S.items.splice(i, 1); paintTray();
                } });
                if (it.kind === 'image') {
                    tray.appendChild(el('div', { class: 'pcx-thumb' }, el('img', { src: it.preview, alt: it.file.name }), firstImg ? el('span', { class: 'pcx-cover', text: 'COVER' }) : null, rm));
                    firstImg = false;
                } else {
                    tray.appendChild(el('div', { class: 'pcx-file' }, el('span', { class: 'pcx-file-ext', text: it.kind === 'video' ? 'VIDEO' : ext(it.file.name).toUpperCase() }),
                        el('span', { class: 'pcx-file-n' }, el('strong', { text: it.file.name }), el('small', { text: bytes(it.file.size) })), rm));
                }
            });
        }
        imgPicker.addEventListener('change', function () { addFiles(imgPicker.files, 'image'); imgPicker.value = ''; });
        vidPicker.addEventListener('change', function () { addFiles(vidPicker.files, 'video'); vidPicker.value = ''; });
        filePicker.addEventListener('change', function () { addFiles(filePicker.files, 'file'); filePicker.value = ''; });
        ['dragenter', 'dragover'].forEach(function (n) { dlg.addEventListener(n, function (e) { if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) e.preventDefault(); }); });
        dlg.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

        /* ---- links ---- */
        function paintLinks() {
            clear(linksBox);
            S.links.forEach(function (v, i) {
                var inp = el('input', { class: 'pc-input', type: 'url', inputmode: 'url', maxlength: '300', placeholder: 'https://', value: v, 'aria-label': 'Link ' + (i + 1) });
                inp.addEventListener('input', function () { S.links[i] = inp.value; mark(); });
                linksBox.appendChild(el('div', { class: 'pcx-linkrow' }, inp,
                    el('button', { type: 'button', class: 'pcx-rm pcx-rm--row', 'aria-label': 'Remove link', html: ICON.x, onclick: function () { S.links.splice(i, 1); paintLinks(); } })));
            });
        }
        function addLinkRow() {
            if (S.links.length >= MAX_LINKS) { say2('You can add up to ' + MAX_LINKS + ' links.'); return; }
            S.links.push(''); paintLinks();
            var last = linksBox.querySelector('.pcx-linkrow:last-child input');
            S.sheet = null; paintSheet();
            if (last) last.focus();
        }

        /* ---- sheets (the panels that slide up from the dock) ---- */
        function chip(label, o) {
            o = o || {};
            var b = el('button', { type: 'button', class: 'pcx-chip' + (o.on ? ' is-on' : '') + (o.wide ? ' pcx-chip--wide' : ''), 'aria-pressed': o.on === undefined ? null : String(!!o.on), disabled: !!o.disabled, onclick: o.onclick }, label);
            if (o.style) b.setAttribute('style', o.style);
            if (o.title) b.title = o.title;
            return b;
        }
        function section(title, content, soon) {
            return el('div', { class: 'pcx-sec' }, el('div', { class: 'pcx-sec-h' }, title, soon ? el('em', { class: 'pcx-soon', text: 'SOON' }) : null), content);
        }
        function row() { var r = el('div', { class: 'pcx-row' }); for (var i = 0; i < arguments.length; i++) put(r, arguments[i]); return r; }

        function aaSheet() {
            var body = el('div', { class: 'pcx-sheet-body' });

            body.appendChild(section('Text styles', row(
                chip(el('b', { text: 'B' }), { onclick: function () { exec('bold'); }, title: 'Bold' }),
                chip(el('i', { text: 'I' }), { onclick: function () { exec('italic'); }, title: 'Italic' }),
                chip(el('u', { text: 'U' }), { onclick: function () { exec('underline'); }, title: 'Underline' }),
                chip(el('s', { text: 'S' }), { onclick: function () { exec('strikeThrough'); }, title: 'Strikethrough' }),
                chip('Spoiler', { onclick: function () { styleSpan(['data-sp'], { 'data-sp': '1' }, 'background:#555;color:#555;border-radius:3px;'); } }),
                chip('Clear', { onclick: clearStyles, title: 'Remove styles from the selected text' }))));

            var linkIn = el('input', { class: 'pc-input pcx-linkin', type: 'url', inputmode: 'url', maxlength: '300', placeholder: 'https://', 'aria-label': 'Link address' });
            body.appendChild(section('Link text', row(linkIn, chip('Add link', { onclick: function () {
                var u = httpsUrl(linkIn.value.trim());
                if (!u) { say2('Links must start with https://'); return; }
                styleSpan(['data-l'], { 'data-l': u }, 'text-decoration:underline;');
            } }))));

            body.appendChild(section('Headers', row(
                chip('Normal', { onclick: function () { exec('formatBlock', '<p>'); } }),
                chip('Heading 1', { onclick: function () { exec('formatBlock', '<h1>'); } }),
                chip('Heading 2', { onclick: function () { exec('formatBlock', '<h2>'); } }),
                chip('Heading 3', { onclick: function () { exec('formatBlock', '<h3>'); } }))));

            body.appendChild(section('Alignment', row(
                chip('Left', { onclick: function () { exec('justifyLeft'); } }),
                chip('Center', { onclick: function () { exec('justifyCenter'); } }),
                chip('Right', { onclick: function () { exec('justifyRight'); } }),
                chip('Justify', { onclick: function () { exec('justifyFull'); } }))));

            body.appendChild(section('Fonts', row(FONTS.map(function (f) {
                return chip(f[1], { style: f[2] ? 'font-family:' + f[2] : '', onclick: function () {
                    if (f[0]) styleSpan(['data-f'], { 'data-f': f[0] }, 'font-family:' + f[2] + ';');
                    else styleSpan(['data-f'], null);
                } });
            }))));

            body.appendChild(section('Resize font', row(SIZES.map(function (z) {
                return chip(z[1], { onclick: function () {
                    if (z[0]) styleSpan(['data-z'], { 'data-z': z[0] }, 'font-size:' + z[2] + ';');
                    else styleSpan(['data-z'], null);
                } });
            }))));

            // color: solid / highlight / gradient
            var tabs = el('div', { class: 'pcx-row' });
            [['solid', 'Solid'], ['highlight', 'Highlight'], ['gradient', 'Gradient']].forEach(function (t) {
                tabs.appendChild(chip(t[1], { on: S.colorTab === t[0], onclick: function () { S.colorTab = t[0]; paintSheet(); } }));
            });
            var sw = el('div', { class: 'pcx-swatches' });
            if (S.colorTab === 'solid') {
                SOLID.forEach(function (c) { sw.appendChild(el('button', { type: 'button', class: 'pcx-sw', style: 'background:' + c, 'aria-label': 'Text color ' + c, onclick: function () { styleSpan(['data-c', 'data-g'], { 'data-c': c }, 'color:' + c + ';'); } })); });
                sw.appendChild(el('label', { class: 'pcx-sw pcx-sw--custom', title: 'Custom color' }, '+', el('input', { type: 'color', value: '#3b82f6', 'aria-label': 'Custom text color', onchange: function (e) { var c = hex(e.target.value); if (c) styleSpan(['data-c', 'data-g'], { 'data-c': c }, 'color:' + c + ';'); } })));
                sw.appendChild(chip('Remove', { onclick: function () { styleSpan(['data-c', 'data-g'], null); } }));
            } else if (S.colorTab === 'highlight') {
                HILITE.forEach(function (c) { sw.appendChild(el('button', { type: 'button', class: 'pcx-sw', style: 'background:' + c, 'aria-label': 'Highlight ' + c, onclick: function () { styleSpan(['data-h'], { 'data-h': c }, 'background-color:' + c + ';'); } })); });
                sw.appendChild(el('label', { class: 'pcx-sw pcx-sw--custom', title: 'Custom highlight' }, '+', el('input', { type: 'color', value: '#fde047', 'aria-label': 'Custom highlight color', onchange: function (e) { var c = hex(e.target.value); if (c) styleSpan(['data-h'], { 'data-h': c }, 'background-color:' + c + ';'); } })));
                sw.appendChild(chip('Remove', { onclick: function () { styleSpan(['data-h'], null); } }));
            } else {
                GRADS.forEach(function (g) {
                    sw.appendChild(el('button', { type: 'button', class: 'pcx-sw pcx-sw--grad', style: 'background:linear-gradient(135deg,' + g[0] + ',' + g[1] + ')', 'aria-label': 'Gradient ' + g[0] + ' to ' + g[1], onclick: function () {
                        styleSpan(['data-g', 'data-c'], { 'data-g': g[0] + ',' + g[1] }, 'background-image:linear-gradient(90deg,' + g[0] + ',' + g[1] + ');-webkit-background-clip:text;background-clip:text;color:transparent;');
                    } }));
                });
                sw.appendChild(chip('Remove', { onclick: function () { styleSpan(['data-g', 'data-c'], null); } }));
            }
            body.appendChild(section('Color text', el('div', { class: 'pcx-stack' }, tabs, sw)));

            body.appendChild(section('Add moving text', el('p', { class: 'pcx-hint', text: 'Animated text presets are coming in the next update.' }), true));
            body.appendChild(section('Post background', el('p', { class: 'pcx-hint', text: 'Background styles and custom images are coming in the next update.' }), true));
            return body;
        }

        function starSheet() {
            var body = el('div', { class: 'pcx-sheet-body' });
            body.appendChild(el('p', { class: 'pcx-hint', text: 'Add a status so people know what kind of update this is.' }));
            var grid = el('div', { class: 'pcx-list' });
            STATUS.forEach(function (s) {
                grid.appendChild(el('button', { type: 'button', class: 'pcx-opt' + (S.status === s[0] ? ' is-on' : ''), 'aria-pressed': String(S.status === s[0]), onclick: function () {
                    S.status = S.status === s[0] ? '' : s[0]; S.statusLabel = ''; mark(); paintPills(); paintSheet();
                } }, el('strong', { text: s[1] })));
            });
            body.appendChild(grid);

            var own = el('input', { class: 'pc-input', type: 'text', maxlength: '24', placeholder: 'Create my own (max 24 characters)', value: S.status === 'custom' ? S.statusLabel : '', 'aria-label': 'Custom status' });
            body.appendChild(el('div', { class: 'pcx-own' }, own, chip('Use', { onclick: function () {
                var t = own.value.trim().replace(/\s+/g, ' ').slice(0, 24);
                if (!t) { S.status = ''; S.statusLabel = ''; } else { S.status = 'custom'; S.statusLabel = t; }
                mark(); paintPills(); paintSheet();
            } })));
            if (S.status) body.appendChild(chip('Remove status', { wide: true, onclick: function () { S.status = ''; S.statusLabel = ''; paintPills(); paintSheet(); } }));
            return body;
        }

        function moreSheet() {
            var body = el('div', { class: 'pcx-sheet-body' });

            var list = el('div', { class: 'pcx-list' });
            VIS.forEach(function (v) {
                list.appendChild(el('button', { type: 'button', class: 'pcx-opt' + (S.vis === v[0] ? ' is-on' : ''), role: 'radio', 'aria-checked': String(S.vis === v[0]), onclick: function () {
                    S.vis = v[0]; mark(); paintPills(); paintSheet();
                } }, el('strong', { text: v[1] }), el('span', { text: v[2] })));
            });
            body.appendChild(section('Post settings', list));

            var tagsIn = el('input', { class: 'pc-input', type: 'text', maxlength: '120', placeholder: 'Tags, separated by commas (max 6)', value: S.tags, 'aria-label': 'Tags' });
            tagsIn.addEventListener('input', function () { S.tags = tagsIn.value; mark(); });
            body.appendChild(section('Tags', tagsIn));

            var hubBox = el('input', { type: 'checkbox', id: 'pcxHub' });
            hubBox.checked = S.hub && S.vis !== 'private'; hubBox.disabled = S.vis === 'private';
            hubBox.addEventListener('change', function () { S.hub = hubBox.checked; mark(); });
            body.appendChild(el('label', { class: 'pcx-check' }, hubBox, el('span', { text: S.vis === 'private' ? 'Private posts are not shown in the Projects Hub' : 'Show this post in the Projects Hub' })));

            body.appendChild(section('Tools', row(
                chip('Add file', { onclick: function () { filePicker.click(); } }),
                chip('Add link card', { onclick: addLinkRow }))));
            body.appendChild(section('More tools', el('p', { class: 'pcx-hint', text: 'Embeds, footer, breakline, breakdowns, timeline, todo, table, cards and releases are coming in the next updates.' }), true));
            return body;
        }

        var SHEETS = { aa: ['Text', aaSheet], star: ['Status', starSheet], more: ['Settings and tools', moreSheet] };
        var dockBtns = {};
        function paintSheet() {
            Object.keys(dockBtns).forEach(function (k) {
                dockBtns[k].classList.toggle('is-on', S.sheet === k);
                dockBtns[k].setAttribute('aria-expanded', String(S.sheet === k));
            });
            clear(sheet);
            if (!S.sheet) { sheet.hidden = true; return; }
            var def = SHEETS[S.sheet];
            sheet.hidden = false;
            sheet.appendChild(el('div', { class: 'pcx-sheet-h' }, el('strong', { text: def[0] }),
                el('button', { type: 'button', class: 'pcx-done', text: 'Done', onclick: function () { S.sheet = null; paintSheet(); } })));
            sheet.appendChild(def[1]());
        }
        function toggleSheet(name) { S.sheet = S.sheet === name ? null : name; paintSheet(); }

        /* ---- the dock ---- */
        function dockBtn(key, label, content, onclick) {
            var b = el('button', { type: 'button', class: 'pcx-dk', 'aria-label': label, title: label, onclick: onclick }, content);
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep the text selection while you tap
            dockBtns[key] = b;
            return b;
        }
        var dock = el('div', { class: 'pcx-dock', role: 'toolbar', 'aria-label': 'Post tools' },
            dockBtn('aa', 'Text styles', el('span', { class: 'pcx-aa', text: 'Aa' }), function () { toggleSheet('aa'); }),
            dockBtn('img', 'Add images', el('span', { class: 'pcx-ic', html: ICON.img }), function () { imgPicker.click(); }),
            dockBtn('star', 'Status', el('span', { class: 'pcx-ic', html: ICON.star }), function () { toggleSheet('star'); }),
            dockBtn('vid', 'Add video', el('span', { class: 'pcx-ic', html: ICON.vid }), function () { vidPicker.click(); }),
            dockBtn('more', 'More: settings and tools', el('span', { class: 'pcx-ic', html: ICON.dots }), function () { toggleSheet('more'); }));
        sheet.addEventListener('mousedown', function (e) { if (!/^(INPUT|TEXTAREA|LABEL)$/.test(e.target.tagName)) e.preventDefault(); });

        /* ---- close ---- */
        function close(force) {
            if (S.busy) return;
            var has = plainOf(serialize()) || S.items.length || S.links.some(function (l) { return l.trim(); });
            if (!force && S.dirty && has && !window.confirm('Discard this post?')) return;
            dlg.close();
        }

        /* ---- save ---- */
        async function save(e) {
            e.preventDefault();
            if (S.busy) return;
            say2('');
            var blocks = serialize(), plain = plainOf(blocks);
            if (plain.length > MAX_TEXT) { say2('Your text is over ' + MAX_TEXT + ' characters.'); return; }

            var links = [];
            for (var i = 0; i < S.links.length; i++) {
                var l = S.links[i].trim();
                if (!l) continue;
                if (!httpsUrl(l)) { say2('Links must start with https://'); return; }
                links.push({ url: l });
            }
            if (!plain && !S.items.length && !links.length) { say2('Write something, or add an image, video, file or link.'); editor.focus(); return; }

            var firstLine = (plain.split('\n').filter(function (x) { return x.trim(); })[0] || '').trim();
            var title = (firstLine || 'Untitled post').slice(0, 80);
            var tagList = S.tags.split(',').map(function (x) { return x.trim().replace(/\s+/g, ' ').slice(0, 20); }).filter(Boolean);
            tagList = tagList.filter(function (x, i2) { return tagList.indexOf(x) === i2; }).slice(0, MAX_TAGS);

            S.busy = true; postBtn.disabled = true; bar.hidden = false;
            var uploaded = [], paths = [];
            try {
                var done = 0, total = S.items.length;
                for (var n = 0; n < S.items.length; n++) {
                    var it = S.items[n];
                    var path = me.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + safeName(it.file.name);
                    var up = await sb.storage.from('post-media').upload(path, it.file, { cacheControl: '31536000', upsert: false, contentType: it.mime });
                    if (up.error) throw up.error;
                    paths.push(path);
                    uploaded.push({ url: sb.storage.from('post-media').getPublicUrl(path).data.publicUrl, name: it.file.name.slice(0, 80), type: it.mime, size: it.file.size, kind: it.kind });
                    done++; bar.firstChild.style.width = Math.round(done / Math.max(1, total) * 90) + '%';
                }
                var cover = uploaded.filter(function (u) { return u.kind === 'image'; })[0];
                var row = {
                    owner_id: me.id, kind: 'post', title: title,
                    summary: plain ? plain.replace(/\s+/g, ' ').slice(0, 280) : null,
                    body: plain || null,
                    doc: hasFormat(blocks) ? { v: 1, blocks: blocks } : null,
                    attachments: uploaded, links: links, tags: tagList,
                    cover_url: cover ? cover.url : null, category: 'other',
                    show_in_hub: S.hub && S.vis !== 'private',
                    visibility: S.vis,
                    status: S.status || null,
                    status_label: S.status === 'custom' ? S.statusLabel : null
                };
                var res = await sb.from('profile_projects').insert(row).select('*').single();
                if (res.error) throw res.error;
                bar.firstChild.style.width = '100%';
                S.items.forEach(function (x) { if (x.preview) URL.revokeObjectURL(x.preview); });
                S.dirty = false; S.busy = false;
                dlg.close();
                say('Posted');
                if (opts.onCreated) opts.onCreated(res.data);
            } catch (err) {
                if (paths.length) { try { await sb.storage.from('post-media').remove(paths); } catch (e2) { /* ignore */ } }   // no orphan files
                try { console.error('[SpecComposer] post failed:', err); } catch (e3) { /* ignore */ }
                // DEBUG: the real error is shown after the friendly one so we can find out why a post fails. Remove the bracket part when done.
                say2(friendly(err) + ' [debug: ' + String(err && (err.code || err.statusCode) || 'no-code') + ' | ' + String(err && err.message || err).slice(0, 220) + ']');
                S.busy = false; postBtn.disabled = false; bar.hidden = true; bar.firstChild.style.width = '0';
            }
        }

        /* ---- build it ---- */
        var form = el('form', { class: 'pcx-form', novalidate: true, onsubmit: save },
            el('header', { class: 'pcx-top' },
                el('button', { type: 'button', class: 'pcx-x', 'aria-label': 'Close', html: ICON.x, onclick: function () { close(false); } }),
                el('h2', { class: 'pcx-h', text: 'Create a post' }),
                postBtn),
            bar,
            el('div', { class: 'pcx-scroll' },
                el('div', { class: 'pcx-author' }, avatar, el('div', { class: 'pcx-who' }, nameEl, el('div', { class: 'pcx-pills' }, visPill, statusPill))),
                el('div', { class: 'pcx-quick' },
                    el('button', { type: 'button', class: 'pcx-q', disabled: true, title: 'Coming in the next update' }, el('span', { class: 'pcx-ic', html: ICON.music }), 'Add music', el('em', { class: 'pcx-soon', text: 'SOON' })),
                    el('button', { type: 'button', class: 'pcx-q', disabled: true, title: 'Coming in the next update' }, el('span', { class: 'pcx-ic', html: ICON.at }), 'Mention people', el('em', { class: 'pcx-soon', text: 'SOON' })),
                    el('button', { type: 'button', class: 'pcx-q', disabled: true, title: 'Coming in the next update' }, el('span', { class: 'pcx-ic', html: ICON.box }), 'Mention projects', el('em', { class: 'pcx-soon', text: 'SOON' }))),
                editor,
                el('div', { class: 'pcx-meta' }, counter),
                tray, linksBox, msg,
                imgPicker, vidPicker, filePicker),
            sheet, dock);

        dlg.appendChild(form);
        dlg.addEventListener('cancel', function (e) {
            e.preventDefault();
            if (S.sheet) { S.sheet = null; paintSheet(); return; }          // Esc closes the open panel first
            close(false);
        });
        dlg.addEventListener('close', function () {
            document.removeEventListener('selectionchange', onSel);
            S.items.forEach(function (x) { if (x.preview) URL.revokeObjectURL(x.preview); });
            dlg.remove();
        });
        dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) close(false); });
        document.body.appendChild(dlg);
        paintPills(); paintTray(); paintLinks(); paintSheet();
        dlg.showModal();
        editor.focus();
    }

    window.SpecComposer = { open: open };
})();
