/* ==========================================================================
   SPECSOFT® threaded comments (post-comments.js)
   Used by projects.html (the hub) and, later, profile.html. One file, same comments everywhere.

   Needs: supabase-hub-v2.sql, post-social.css, and (optional, loaded by itself) chat-emoji.js + emoji-data.js
   Load AFTER supabase-config.js. No other file is required.

   const h = SpecComments.mount(hostElement, project, { sb, me, toast, onCount })
     project  { id, owner_id }       me  { id } or null       onCount(n) is called whenever the number changes
   h.refresh()  reloads the thread      h.destroy()  stops live updates (call it when the project closes)

   SpecComments.report({ sb, type: 'project' | 'comment' | 'user', id, label, toast })   opens the report form
   SpecComments.rich(text)  turns "hi :sob: https://x.com" into a fragment with emoji pictures and links
   ========================================================================== */
(function () {
    'use strict';

    var FLUENT_BASE = 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/';
    var MAX_IMG = 5 * 1024 * 1024;
    var IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

    /* ---------------------------------------------------------------- helpers */
    function el(tag, attrs) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            var v = attrs[k];
            if (v === null || v === undefined || v === false) return;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
            else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        });
        for (var i = 2; i < arguments.length; i++) put(node, arguments[i]);
        return node;
    }
    function put(parent) {
        for (var i = 1; i < arguments.length; i++) {
            var c = arguments[i];
            if (c === null || c === undefined || c === false) continue;
            if (Array.isArray(c)) { c.forEach(function (x) { put(parent, x); }); continue; }
            parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
        }
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    function httpsOnly(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : ''; }

    var ICON = {
        heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
        reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
        flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
        smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
        send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
        close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        chev: '<polyline points="6 9 12 15 18 9"/>'
    };
    function icon(n, filled) {
        var w = document.createElement('span');
        w.className = 'pc-ico';
        w.innerHTML = '<svg viewBox="0 0 24 24" fill="' + (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[n] || '') + '</svg>';
        return w;
    }

    function ago(iso) {
        var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm';
        if (s < 86400) return Math.floor(s / 3600) + 'h';
        if (s < 604800) return Math.floor(s / 86400) + 'd';
        try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
    }

    function loadScript(src) {
        return new Promise(function (res) {
            var s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = function () { res(true); };
            s.onerror = function () { res(false); };
            document.head.appendChild(s);
        });
    }

    function friendly(err) {
        var code = String(err && err.code || ''), msg = String(err && err.message || '').toLowerCase();
        if (code === 'PGRST202' || /project_comments_list|profile_comment_likes|sticker_url|parent_id/.test(msg)) return 'Run supabase-hub-v2.sql in your Supabase SQL Editor to turn on threaded comments.';
        if (code === '42501' || msg.indexOf('row-level security') >= 0) return 'Slow down: you can post about 8 comments a minute.';
        if (code === '23514') return 'That comment was not accepted (too long, or the image or sticker is not allowed).';
        if (msg.indexOf('failed to fetch') >= 0 || msg.indexOf('network') >= 0) return 'Cannot reach the server. Check your connection.';
        if (msg.indexOf('bucket not found') >= 0) return 'Run supabase-hub-v2.sql to create the comment image storage.';
        return 'Something went wrong. Please try again.';
    }

    /* ---------------------------------------------------------------- emoji + stickers */
    var EM = { ready: false, loading: null, custom: Object.create(null), byCode: Object.create(null), byChar: new Map(), list: [], cats: {}, store: Object.create(null), mine: new Map() };

    function slug(name) {
        return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/[\u2019'.,:()!"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function noVS(s) { return String(s).replace(/\uFE0F/g, ''); }
    function okEmojiUrl(u) { try { var p = new URL(u); return p.protocol === 'https:' && (/(^|\.)emoji\.gg$/i.test(p.hostname) || p.hostname === 'em-content.zobj.net'); } catch (e) { return false; } }

    function loadEmoji(sb) {
        if (EM.loading) return EM.loading;
        EM.loading = (async function () {
            try {
                if (!window.SPEC_CHAT_EMOJI) await loadScript('chat-emoji.js?v=1');
                if (!window.SPEC_EMOJI) await loadScript('emoji-data.js?v=1');
            } catch (e) { /* the comments still work without emoji files */ }

            var extra = window.SPEC_CHAT_EMOJI || {};
            Object.keys(extra).forEach(function (cat) {
                if (!Array.isArray(extra[cat])) return;
                var row = [];
                extra[cat].forEach(function (e) {
                    if (e && typeof e === 'object' && typeof e.image === 'string') {
                        var img = e.image.trim();
                        if (!/^https?:/i.test(img)) img = FLUENT_BASE + img.replace(/^\/+/, '');
                        if (/^[a-z0-9_+-]{1,32}$/i.test(e.name || '') && okEmojiUrl(img)) { EM.custom[e.name.toLowerCase()] = img; row.push({ name: e.name.toLowerCase(), url: img }); }
                    } else if (typeof e === 'string') row.push({ char: e });
                });
                if (row.length) EM.cats[cat] = row;
            });

            var data = window.SPEC_EMOJI;
            if (data && Array.isArray(data.list)) {
                data.list.forEach(function (r) {
                    var cps = String(r[0]).split('-'), c;
                    try { c = String.fromCodePoint.apply(null, cps.map(function (h) { return parseInt(h, 16); })); } catch (e) { return; }
                    var codes = r[2] ? String(r[2]).split(' ') : [];
                    var url = data.base + (r[4] || slug(r[1])) + '_' + cps.map(function (h) { return h.replace(/^0+(?=.)/, ''); }).join('-') + '.png';
                    var it = { c: c, n: r[1], codes: codes, url: url, hay: (r[1] + ' ' + codes.join(' ').replace(/[_+-]+/g, ' ') + ' ' + (r[3] || '')).toLowerCase() };
                    EM.list.push(it);
                    codes.forEach(function (k) { if (!EM.byCode[k]) EM.byCode[k] = it; });
                    EM.byChar.set(noVS(c), it);
                });
            }

            // store emotes (the ones people bought) work as :name: everywhere and as stickers for their owners
            if (sb) {
                try {
                    var r = await Promise.all([sb.rpc('chat_emotes'), sb.rpc('chat_my_emotes')]);
                    if (!r[0].error) (r[0].data || []).forEach(function (e) {
                        var k = String(e.emote_name || '').toLowerCase();
                        if (/^[a-z0-9_+-]{1,32}$/.test(k) && httpsOnly(e.image_url)) EM.store[k] = e.image_url;
                    });
                    if (!r[1].error) (r[1].data || []).forEach(function (e) {
                        var k = String(e.emote_name || '').toLowerCase();
                        if (EM.store[k]) EM.mine.set(k, EM.store[k]);
                    });
                } catch (e) { /* store SQL not installed: no stickers, everything else works */ }
            }
            EM.ready = true;
        })();
        return EM.loading;
    }

    var RE_EMOJI = null;
    try {
        RE_EMOJI = new RegExp('(?:[#*0-9]\\uFE0F?\\u20E3)|(?:(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)\\p{Emoji_Modifier}?(?:\\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F?)\\p{Emoji_Modifier}?)*\\uFE0F?)', 'gu');
    } catch (e) { RE_EMOJI = null; }

    function emojiImg(url, label, big) {
        var img = el('img', { class: 'pc-emoji' + (big ? ' is-big' : ''), src: url, alt: label, title: label, loading: 'lazy', draggable: 'false', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', function () { img.replaceWith(document.createTextNode(label)); });
        return img;
    }

    function shortcodeUrl(k) {
        k = String(k).toLowerCase();
        if (EM.store[k]) return EM.store[k];
        if (EM.custom[k]) return EM.custom[k];
        var it = EM.byCode[k];
        return it ? it.url : '';
    }

    // plain text with :shortcodes:, keyboard emoji and links -> a fragment
    function rich(text) {
        var frag = document.createDocumentFragment();
        var src = String(text || '');
        var tokens = /(:[a-z0-9_+-]{1,32}:)|(https:\/\/[^\s<]+)/gi;
        var last = 0, m, onlyEmoji = true;

        function plain(s) {
            if (!s) return;
            if (!RE_EMOJI || !EM.ready) { frag.appendChild(document.createTextNode(s)); if (s.trim()) onlyEmoji = false; return; }
            var l = 0, x;
            RE_EMOJI.lastIndex = 0;
            while ((x = RE_EMOJI.exec(s))) {
                var it = EM.byChar.get(noVS(x[0]));
                if (!it) continue;
                if (x.index > l) { var t = s.slice(l, x.index); frag.appendChild(document.createTextNode(t)); if (t.trim()) onlyEmoji = false; }
                frag.appendChild(emojiImg(it.url, x[0], false));
                l = x.index + x[0].length;
            }
            if (l < s.length) { var tail = s.slice(l); frag.appendChild(document.createTextNode(tail)); if (tail.trim()) onlyEmoji = false; }
        }

        while ((m = tokens.exec(src))) {
            plain(src.slice(last, m.index));
            if (m[1]) {
                var url = shortcodeUrl(m[1].slice(1, -1));
                if (url) frag.appendChild(emojiImg(url, m[1], false));
                else { frag.appendChild(document.createTextNode(m[1])); onlyEmoji = false; }
            } else {
                var href = m[2].replace(/[.,;:!?)]+$/, '');
                frag.appendChild(el('a', { class: 'pc-link', href: href, target: '_blank', rel: 'noopener noreferrer nofollow', text: href }));
                if (href.length < m[2].length) frag.appendChild(document.createTextNode(m[2].slice(href.length)));
                onlyEmoji = false;
            }
            last = m.index + m[0].length;
        }
        plain(src.slice(last));
        return frag;
    }

    /* ---------------------------------------------------------------- report dialog */
    var REASONS = [['spam', 'Spam or scam'], ['harassment', 'Harassment or hate'], ['inappropriate', 'Inappropriate content'], ['copyright', 'Copyright'], ['impersonation', 'Impersonation'], ['other', 'Something else']];
    var REPORT_ERR = {
        login: 'Log in to report.', restricted: 'Your account cannot send reports right now.', own_content: 'You cannot report your own content.',
        not_found: 'That item no longer exists.', too_many: 'You sent a lot of reports today. Try again tomorrow.', bad_reason: 'Pick a reason first.', bad_note: 'The note is too long (300 characters max).'
    };

    function report(opts) {
        opts = opts || {};
        var sb = opts.sb, say = opts.toast || function () { };
        if (!sb) return;
        var dlg = el('dialog', { class: 'pc-report', 'aria-label': 'Report' });
        var reason = '', busy = false;
        var msg = el('p', { class: 'pc-report-msg', role: 'alert' });
        var note = el('textarea', { class: 'pc-input', maxlength: '300', rows: '3', placeholder: 'Add details (optional)' });
        var send = el('button', { type: 'button', class: 'pc-btn pc-btn--solid', text: 'Send report', disabled: true });
        var list = el('div', { class: 'pc-reasons', role: 'radiogroup', 'aria-label': 'Reason' });

        REASONS.forEach(function (r) {
            var b = el('button', { type: 'button', class: 'pc-reason', role: 'radio', 'aria-checked': 'false', text: r[1],
                onclick: function () {
                    reason = r[0];
                    Array.prototype.forEach.call(list.children, function (x) { x.setAttribute('aria-checked', String(x === b)); x.classList.toggle('is-on', x === b); });
                    send.disabled = false;
                } });
            list.appendChild(b);
        });

        send.addEventListener('click', async function () {
            if (busy || !reason) return;
            busy = true; send.disabled = true; msg.textContent = '';
            try {
                var res = await sb.rpc('report_submit', { p_type: opts.type, p_target: opts.id, p_reason: reason, p_note: note.value.trim() || null });
                if (res.error) throw res.error;
                var d = res.data || {};
                if (d.ok === false) { msg.textContent = REPORT_ERR[d.error] || 'Could not send the report.'; busy = false; send.disabled = false; return; }
                dlg.close(); say('Thanks, the report was sent to staff.');
            } catch (e) {
                var code = String(e && e.code || '');
                msg.textContent = code === 'PGRST202' ? 'Run supabase-reports.sql in your Supabase SQL Editor to turn reports on.' : 'Could not send the report. Try again.';
                busy = false; send.disabled = false;
            }
        });

        put(dlg, el('div', { class: 'pc-report-card' },
            el('h3', { class: 'pc-report-h', text: 'Report ' + (opts.label || opts.type) }),
            el('p', { class: 'pc-report-p', text: 'Staff reviews every report. Pick what fits best.' }),
            list, note, msg,
            el('div', { class: 'pc-report-foot' }, el('button', { type: 'button', class: 'pc-btn', text: 'Cancel', onclick: function () { dlg.close(); } }), send)));
        dlg.addEventListener('close', function () { dlg.remove(); });
        dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
        document.body.appendChild(dlg);
        dlg.showModal();
    }

    /* ---------------------------------------------------------------- the thread */
    function mount(host, project, opts) {
        opts = opts || {};
        var sb = opts.sb, me = opts.me || null, say = opts.toast || function () { };
        var S = { rows: [], sort: 'top', replyTo: null, open: new Set(), pendingImg: null, sticker: '', busy: false, destroyed: false, picker: null };
        var channel = null, liveTimer = null;

        clear(host);
        host.classList.add('pc-root');

        var head = el('div', { class: 'pc-head' });
        var list = el('div', { class: 'pc-list', 'aria-live': 'polite' });
        var composerWrap = el('div', { class: 'pc-composer-wrap' });
        put(host, head, list, composerWrap);

        /* ---- data ---- */
        async function loadThreadRows() {
            if (!sb || !project || !project.id) return [];
            var res = await sb.rpc('project_comments_list', { p_project: project.id });
            if (res && res.error) throw res.error;
            return Array.isArray(res && res.data) ? res.data : [];
        }

        async function loadThreadRowsFallback() {
            if (!sb || !project || !project.id) return [];
            var rowsRes = await sb.from('profile_project_comments').select('*').eq('project_id', project.id).order('created_at', { ascending: true });
            if (rowsRes && rowsRes.error) throw rowsRes.error;
            var rows = Array.isArray(rowsRes && rowsRes.data) ? rowsRes.data : [];
            if (!rows.length) return [];

            var ids = rows.map(function (r) { return r.id; }).filter(Boolean);
            var userIds = rows.map(function (r) { return r.user_id; }).filter(Boolean);
            var userMap = Object.create(null);
            if (userIds.length) {
                var usersRes = await sb.from('profiles').select('id, username, display_name, avatar_url').in('id', userIds);
                if (!usersRes || !usersRes.error) {
                    (usersRes && usersRes.data || []).forEach(function (u) { userMap[u.id] = u; });
                }
            }

            var counts = Object.create(null);
            var liked = new Set();
            if (ids.length) {
                var likesRes = await sb.from('profile_comment_likes').select('comment_id, user_id').in('comment_id', ids);
                if (!likesRes || !likesRes.error) {
                    (likesRes && likesRes.data || []).forEach(function (like) {
                        counts[like.comment_id] = (counts[like.comment_id] || 0) + 1;
                        if (me && like.user_id === me.id) liked.add(like.comment_id);
                    });
                }
            }

            return rows.map(function (r) {
                return Object.assign({}, r, {
                    author: userMap[r.user_id] || null,
                    like_count: Number(counts[r.id] || 0),
                    liked: !!(me && liked.has(r.id))
                });
            });
        }

        async function load() {
            try {
                var rows;
                try {
                    rows = await loadThreadRows();
                } catch (rpcErr) {
                    var text = String(rpcErr && (rpcErr.message || rpcErr.code || ''));
                    if (rpcErr && (rpcErr.code === 'PGRST202' || /project_comments_list/.test(text) || /does not exist|not found/i.test(text))) {
                        console.warn('[comments] project_comments_list unavailable; using fallback query', rpcErr);
                        rows = await loadThreadRowsFallback();
                    } else {
                        throw rpcErr;
                    }
                }
                if (S.destroyed) return;
                S.rows = Array.isArray(rows) ? rows : [];
                paint();
                if (opts.onCount) opts.onCount(S.rows.length);
            } catch (e) {
                console.error('[comments] load/paint failed:', e);
                if (S.destroyed) return;
                clear(list).appendChild(el('p', { class: 'pc-empty', text: friendly(e) }));
            }
        }

        function schedule() { clearTimeout(liveTimer); liveTimer = setTimeout(load, 700); }

        function live() {
            try {
                channel = sb.channel('pc-' + project.id + '-' + Math.random().toString(36).slice(2, 7))
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_project_comments', filter: 'project_id=eq.' + project.id }, schedule)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_comment_likes' }, schedule)
                    .subscribe();
            } catch (e) { /* not fatal */ }
        }

        /* ---- rendering ---- */
        function authorName(c) { var a = c.author || {}; return a.display_name || a.username || 'member'; }

        function avatar(a) {
            a = a || {};
            var node = el('span', { class: 'pc-av', 'aria-hidden': 'true' });
            var u = httpsOnly(a.avatar_url), name = a.display_name || a.username || '?';
            if (u) { var img = el('img', { src: u, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }); img.addEventListener('error', function () { img.remove(); node.textContent = name.charAt(0).toUpperCase(); }); node.appendChild(img); }
            else node.textContent = name.charAt(0).toUpperCase();
            return node;
        }

        function lightbox(url) {
            var box = el('div', { class: 'pc-lightbox', role: 'dialog', 'aria-label': 'Image', tabindex: '-1' },
                el('img', { src: url, alt: 'Comment image', referrerpolicy: 'no-referrer' }),
                el('button', { type: 'button', class: 'pc-lightbox-x', 'aria-label': 'Close image', onclick: function () { box.remove(); } }, icon('close')));
            box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
            box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); box.remove(); } });
            (host.closest('dialog') || document.body).appendChild(box);
            box.focus();
        }

        function commentNode(c, isReply) {
            var mine = !!(me && c.user_id === me.id);
            var canDelete = !!(me && (mine || project.owner_id === me.id));
            var a = c.author || {};
            var body = null;
            if (c.body && String(c.body).trim()) body = el('p', { class: 'pc-body' }, rich(c.body));
            var sticker = httpsOnly(c.sticker_url) ? el('img', { class: 'pc-sticker', src: c.sticker_url, alt: 'Sticker', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null;
            var imgUrl = httpsOnly(c.image_url);
            var shot = imgUrl ? el('button', { type: 'button', class: 'pc-shot', 'aria-label': 'Open image', onclick: function () { lightbox(imgUrl); } },
                el('img', { src: imgUrl, alt: 'Comment image', loading: 'lazy', referrerpolicy: 'no-referrer' })) : null;

            var likeBtn = el('button', { type: 'button', class: 'pc-act' + (c.liked ? ' is-on' : ''), 'aria-pressed': String(!!c.liked), 'aria-label': c.liked ? 'Unlike' : 'Like',
                onclick: function () { toggleLike(c); } }, icon('heart', c.liked), el('span', { text: c.like_count > 0 ? String(c.like_count) : '' }));

            var acts = el('div', { class: 'pc-acts' },
                likeBtn,
                me ? el('button', { type: 'button', class: 'pc-act', onclick: function () { startReply(c); } }, icon('reply'), el('span', { text: 'Reply' })) : null,
                (me && !mine) ? el('button', { type: 'button', class: 'pc-act pc-act--quiet', title: 'Report this comment', 'aria-label': 'Report this comment',
                    onclick: function () { report({ sb: sb, type: 'comment', id: c.id, label: 'comment', toast: say }); } }, icon('flag')) : null,
                canDelete ? el('button', { type: 'button', class: 'pc-act pc-act--quiet pc-act--danger', title: 'Delete', 'aria-label': 'Delete comment', onclick: function () { remove(c); } }, icon('trash')) : null);

            return el('article', { class: 'pc-c' + (isReply ? ' is-reply' : ''), dataset: { id: c.id } },
                avatar(a),
                el('div', { class: 'pc-main' },
                    el('div', { class: 'pc-meta' },
                        el('a', { class: 'pc-name', href: 'profile.html?u=' + encodeURIComponent(a.username || ''), text: authorName(c) }),
                        project.owner_id === c.user_id ? el('span', { class: 'pc-op', text: 'OP' }) : null,
                        el('span', { class: 'pc-roles', dataset: { uid: c.user_id } }),
                        el('time', { class: 'pc-time', datetime: c.created_at, text: ago(c.created_at) })),
                    body, sticker, shot, acts));
        }

        function paint() {
            var tops = S.rows.filter(function (r) { return !r.parent_id; });
            var kids = {};
            S.rows.forEach(function (r) { if (r.parent_id) (kids[r.parent_id] = kids[r.parent_id] || []).push(r); });

            tops.sort(S.sort === 'new'
                ? function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }
                : function (a, b) { return (b.like_count - a.like_count) || (new Date(a.created_at) - new Date(b.created_at)); });

            clear(head);
            put(head, el('h3', { class: 'pc-title' }, 'Comments ', el('span', { class: 'pc-count', text: S.rows.length ? String(S.rows.length) : '' })),
                S.rows.length > 1 ? el('div', { class: 'pc-sort', role: 'group', 'aria-label': 'Sort comments' },
                    [['top', 'Top'], ['new', 'Newest']].map(function (s) {
                        return el('button', { type: 'button', class: 'pc-chip' + (S.sort === s[0] ? ' is-on' : ''), 'aria-pressed': String(S.sort === s[0]), text: s[1],
                            onclick: function () { S.sort = s[0]; paint(); } });
                    })) : null);

            var y = list.scrollTop;
            clear(list);
            if (!tops.length) {
                list.appendChild(el('p', { class: 'pc-empty', text: me ? 'No comments yet. Start the thread.' : 'No comments yet.' }));
            }
            tops.forEach(function (c) {
                var wrap = el('div', { class: 'pc-thread' }, commentNode(c, false));
                var replies = kids[c.id] || [];
                if (replies.length) {
                    var open = S.open.has(c.id);
                    var holder = el('div', { class: 'pc-replies', hidden: !open });
                    replies.forEach(function (r) { holder.appendChild(commentNode(r, true)); });
                    var toggle = el('button', { type: 'button', class: 'pc-more', 'aria-expanded': String(open),
                        onclick: function () {
                            var now = holder.hidden; holder.hidden = !now;
                            if (now) S.open.add(c.id); else S.open.delete(c.id);
                            toggle.setAttribute('aria-expanded', String(now));
                            clear(toggle); put(toggle, icon('chev'), now ? 'Hide replies' : (replies.length === 1 ? 'View 1 reply' : 'View ' + replies.length + ' replies'));
                        } }, icon('chev'), open ? 'Hide replies' : (replies.length === 1 ? 'View 1 reply' : 'View ' + replies.length + ' replies'));
                    wrap.appendChild(toggle); wrap.appendChild(holder);
                }
                list.appendChild(wrap);
            });
            list.scrollTop = y;
            window.dispatchEvent(new CustomEvent('specsoft:comments-painted', { detail: { host: host } }));
        }

        /* ---- actions ---- */
        async function toggleLike(c) {
            if (!me) { say('Log in to like comments.'); return; }
            var was = !!c.liked;
            c.liked = !was; c.like_count = Math.max(0, (c.like_count || 0) + (was ? -1 : 1));
            paint();
            try {
                var res = was
                    ? await sb.from('profile_comment_likes').delete().eq('comment_id', c.id).eq('user_id', me.id)
                    : await sb.from('profile_comment_likes').insert({ comment_id: c.id, user_id: me.id });
                if (res.error && res.error.code !== '23505') throw res.error;
            } catch (e) {
                c.liked = was; c.like_count = Math.max(0, c.like_count + (was ? 1 : -1)); paint(); say(friendly(e));
            }
        }

        async function remove(c) {
            if (!window.confirm('Delete this comment' + (S.rows.some(function (r) { return r.parent_id === c.id; }) ? ' and its replies?' : '?'))) return;
            try {
                var res = await sb.from('profile_project_comments').delete().eq('id', c.id);
                if (res.error) throw res.error;
                await load();
            } catch (e) { say(friendly(e)); }
        }

        function startReply(c) {
            S.replyTo = c.parent_id ? S.rows.filter(function (r) { return r.id === c.parent_id; })[0] || c : c;
            S.replyName = authorName(c);
            S.open.add(S.replyTo.id);
            paintComposer();
            var ta = composerWrap.querySelector('textarea');
            if (ta) { if (!ta.value) ta.value = ''; ta.focus(); }
        }

        async function uploadImage(file) {
            var ext = IMG_TYPES[file.type];
            var path = me.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
            var up = await sb.storage.from('comment-media').upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type });
            if (up.error) throw up.error;
            return sb.storage.from('comment-media').getPublicUrl(path).data.publicUrl;
        }

        async function submit(ta, sendBtn) {
            if (S.busy || !me) return;
            var text = ta.value.trim();
            if (!text && !S.pendingImg && !S.sticker) return;
            S.busy = true; sendBtn.disabled = true;
            try {
                var imageUrl = null;
                if (S.pendingImg) imageUrl = await uploadImage(S.pendingImg.file);
                var row = { project_id: project.id, user_id: me.id, body: text, image_url: imageUrl, sticker_url: S.sticker || null, parent_id: S.replyTo ? S.replyTo.id : null };
                var res = await sb.from('profile_project_comments').insert(row);
                if (res.error) throw res.error;
                if (S.pendingImg && S.pendingImg.preview) URL.revokeObjectURL(S.pendingImg.preview);
                S.pendingImg = null; S.sticker = ''; ta.value = '';
                if (S.replyTo) S.open.add(S.replyTo.id);
                S.replyTo = null;
                paintComposer();
                await load();
            } catch (e) { say(friendly(e)); }
            finally { S.busy = false; var b = composerWrap.querySelector('.pc-send'); if (b) b.disabled = false; }
        }

        /* ---- composer ---- */
        function closePicker() { if (S.picker) { S.picker.remove(); S.picker = null; } }

        function insertAtCursor(ta, s) {
            var a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd;
            ta.value = ta.value.slice(0, a) + s + ta.value.slice(b);
            var pos = a + s.length; ta.setSelectionRange(pos, pos); ta.focus();
            ta.dispatchEvent(new Event('input'));
        }

        function openPicker(anchor, ta) {
            if (S.picker) { closePicker(); return; }
            var tab = 'emoji', q = '';
            var pop = el('div', { class: 'pc-picker', role: 'dialog', 'aria-label': 'Emoji and stickers' });
            var tabs = el('div', { class: 'pc-picker-tabs', role: 'tablist' });
            var search = el('input', { class: 'pc-input pc-picker-search', type: 'search', placeholder: 'Search emoji', 'aria-label': 'Search emoji', autocomplete: 'off' });
            var grid = el('div', { class: 'pc-picker-grid' });

            function cell(url, label, onpick, big) {
                var b = el('button', { type: 'button', class: 'pc-pick' + (big ? ' is-sticker' : ''), title: label, 'aria-label': label, onclick: onpick }, emojiImg(url, label, false));
                return b;
            }

            function draw() {
                clear(grid);
                search.hidden = tab !== 'emoji';
                Array.prototype.forEach.call(tabs.children, function (t) { var on = t.dataset.tab === tab; t.classList.toggle('is-on', on); t.setAttribute('aria-selected', String(on)); });

                if (tab === 'stickers') {
                    if (!EM.mine.size) { grid.appendChild(el('p', { class: 'pc-empty', text: 'You have no stickers yet. Emotes you buy in the Store show up here.' })); return; }
                    EM.mine.forEach(function (url, name) {
                        grid.appendChild(cell(url, ':' + name + ':', function () { S.sticker = url; closePicker(); paintComposer(); }, true));
                    });
                    return;
                }
                if (q) {
                    var n = 0, low = q.toLowerCase();
                    Object.keys(EM.store).concat(Object.keys(EM.custom)).forEach(function (k) {
                        if (n < 80 && k.indexOf(low.replace(/\s+/g, '_')) >= 0) { n++; grid.appendChild(cell(EM.store[k] || EM.custom[k], ':' + k + ':', function () { insertAtCursor(ta, ':' + k + ': '); })); }
                    });
                    for (var i = 0; i < EM.list.length && n < 80; i++) {
                        var it = EM.list[i];
                        if (it.hay.indexOf(low) >= 0) { n++; (function (it) { grid.appendChild(cell(it.url, it.n, function () { insertAtCursor(ta, it.c); })); })(it); }
                    }
                    if (!n) grid.appendChild(el('p', { class: 'pc-empty', text: 'No emoji found.' }));
                    return;
                }
                var shown = 0;
                Object.keys(EM.cats).forEach(function (cat) {
                    grid.appendChild(el('h4', { class: 'pc-picker-cat', text: cat }));
                    EM.cats[cat].forEach(function (e) {
                        shown++;
                        if (e.url) grid.appendChild(cell(e.url, ':' + e.name + ':', function () { insertAtCursor(ta, ':' + e.name + ': '); }));
                        else {
                            var it = EM.byChar.get(noVS(e.char));
                            if (it) grid.appendChild(cell(it.url, it.n, function () { insertAtCursor(ta, e.char); }));
                            else grid.appendChild(el('button', { type: 'button', class: 'pc-pick', text: e.char, onclick: function () { insertAtCursor(ta, e.char); } }));
                        }
                    });
                });
                if (!shown) grid.appendChild(el('p', { class: 'pc-empty', text: EM.ready ? 'Type in the search box to find emoji.' : 'Loading emoji...' }));
            }

            [['emoji', 'Emoji'], ['stickers', 'Stickers']].forEach(function (t) {
                tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'pc-picker-tab', dataset: { tab: t[0] }, text: t[1], onclick: function () { tab = t[0]; draw(); } }));
            });
            search.addEventListener('input', function () { q = search.value.trim(); draw(); });
            put(pop, tabs, search, grid);
            composerWrap.appendChild(pop);
            S.picker = pop;
            loadEmoji(sb).then(draw);
            draw();
            pop.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closePicker(); anchor.focus(); } });
            setTimeout(function () {
                function away(e) { if (S.picker && !S.picker.contains(e.target) && !anchor.contains(e.target)) { closePicker(); document.removeEventListener('pointerdown', away, true); } }
                document.addEventListener('pointerdown', away, true);
            }, 0);
            if (!search.hidden) search.focus();
        }

        function paintComposer() {
            closePicker();
            clear(composerWrap);
            if (!me) {
                composerWrap.appendChild(el('p', { class: 'pc-guest' }, el('a', { href: 'login.html', text: 'Log in' }), ' to join the conversation.'));
                return;
            }
            var ta = el('textarea', { class: 'pc-input pc-ta', rows: '1', maxlength: '500', placeholder: S.replyTo ? 'Reply to ' + S.replyName + '...' : 'Add a comment...', 'aria-label': 'Write a comment' });
            var counter = el('span', { class: 'pc-counter', text: '' });
            var file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
            var sendBtn = el('button', { type: 'button', class: 'pc-send', 'aria-label': 'Post comment', title: 'Post' }, icon('send'));
            var emoBtn = el('button', { type: 'button', class: 'pc-tool', 'aria-label': 'Emoji and stickers', title: 'Emoji and stickers', 'aria-haspopup': 'dialog', onclick: function () { openPicker(emoBtn, ta); } }, icon('smile'));
            var imgBtn = el('button', { type: 'button', class: 'pc-tool', 'aria-label': 'Attach an image', title: 'Attach an image', onclick: function () { file.click(); } }, icon('image'));

            function fit() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; counter.textContent = ta.value.length > 400 ? (500 - ta.value.length) + '' : ''; }
            ta.addEventListener('input', fit);
            ta.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(ta, sendBtn); }
            });
            sendBtn.addEventListener('click', function () { submit(ta, sendBtn); });

            file.addEventListener('change', function () {
                var f = file.files && file.files[0];
                file.value = '';
                if (!f) return;
                if (!IMG_TYPES[f.type]) { say('Use a PNG, JPG, WEBP or GIF image.'); return; }
                if (f.size > MAX_IMG) { say('Images can be up to 5 MB.'); return; }
                if (S.pendingImg && S.pendingImg.preview) URL.revokeObjectURL(S.pendingImg.preview);
                S.pendingImg = { file: f, preview: URL.createObjectURL(f) };
                var keep = ta.value; paintComposer(); var t2 = composerWrap.querySelector('textarea'); if (t2) { t2.value = keep; t2.focus(); }
            });

            var chips = el('div', { class: 'pc-attached' });
            if (S.replyTo) chips.appendChild(el('span', { class: 'pc-replying' }, 'Replying to ', el('strong', { text: S.replyName }),
                el('button', { type: 'button', class: 'pc-x', 'aria-label': 'Cancel reply', onclick: function () { var keep = ta.value; S.replyTo = null; paintComposer(); composerWrap.querySelector('textarea').value = keep; } }, icon('close'))));
            if (S.pendingImg) chips.appendChild(el('span', { class: 'pc-attach' }, el('img', { src: S.pendingImg.preview, alt: 'Image to send' }),
                el('button', { type: 'button', class: 'pc-x', 'aria-label': 'Remove image', onclick: function () { URL.revokeObjectURL(S.pendingImg.preview); S.pendingImg = null; var keep = ta.value; paintComposer(); composerWrap.querySelector('textarea').value = keep; } }, icon('close'))));
            if (S.sticker) chips.appendChild(el('span', { class: 'pc-attach is-sticker' }, el('img', { src: S.sticker, alt: 'Sticker to send', referrerpolicy: 'no-referrer' }),
                el('button', { type: 'button', class: 'pc-x', 'aria-label': 'Remove sticker', onclick: function () { S.sticker = ''; var keep = ta.value; paintComposer(); composerWrap.querySelector('textarea').value = keep; } }, icon('close'))));

            put(composerWrap, chips.childNodes.length ? chips : null,
                el('div', { class: 'pc-bar' }, emoBtn, imgBtn, ta, counter, sendBtn, file));
            loadEmoji(sb);                                      // warm the emoji files so the picker opens instantly
        }

        paintComposer();
        paint();
        clear(list).appendChild(el('p', { class: 'pc-empty', text: 'Loading comments...' }));
      loadEmoji(sb).then(load, load);
setTimeout(function () { if (!S.rows.length && !S.destroyed) load(); }, 4000);
        live();

        return {
            refresh: load,
            destroy: function () {
                S.destroyed = true; clearTimeout(liveTimer); closePicker();
                if (S.pendingImg && S.pendingImg.preview) URL.revokeObjectURL(S.pendingImg.preview);
                try { if (channel) sb.removeChannel(channel); } catch (e) { /* ignore */ }
                clear(host);
            }
        };
    }

    window.SpecComments = { mount: mount, report: report, rich: rich, loadEmoji: loadEmoji };
})();
