/* ==========================================================================
   SPECSOFT® Projects Hub (projects.js)

   Reads the SAME rows the profile pages use (profile_projects), so every like,
   comment and repost a project already has shows up here and counts on both pages.
   Needs supabase-hub.sql installed (hub_projects) and projects.css.

   Load order on projects.html:  supabase-js, supabase-config.js, main.js, projects.js
   ========================================================================== */
(function () {
    'use strict';

    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var sb = window.getSupabaseClient ? window.getSupabaseClient() : (
        (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
            ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null
    );

    // To add or rename a category: change it here AND in the check constraint in supabase-hub.sql
    var CATS = [['ai', 'AI'], ['games', 'Games'], ['software', 'Software'], ['roblox', 'Roblox'], ['other', 'Other']];
    var PAGE = 24;
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    var S = {
        me: null, items: [], total: 0, indexed: null, savedCount: 0,
        q: '', cat: '', sort: 'newest', saved: false, view: 'grid',
        loading: false, seq: 0, nodes: new Map(), open: null, busy: new Set(), lastFocus: null
    };

    /* ----------------------------------------------------------------------
       helpers
       ---------------------------------------------------------------------- */
    function $(id) { return document.getElementById(id); }

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
        for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
        return node;
    }

    function add(parent, c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) { c.forEach(function (x) { add(parent, x); }); return; }
        parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }

    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

    var ICONS = {
        heart:   '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
        bookmark:'<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
        comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        repost:  '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
        share:   '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
        search:  '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
        chevron: '<polyline points="6 9 12 15 18 9"/>',
        grid:    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        list:    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
        play:    '<polygon points="7 4 20 12 7 20 7 4"/>',
        close:   '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        external:'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
        code:    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
        user:    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
    };

    function icon(name, filled) {
        var wrap = document.createElement('span');
        wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="' + (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
        return wrap.firstChild;
    }

    function safeHttps(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : ''; }

    function hashIndex(str, mod) {
        var h = 0;
        for (var i = 0; i < str.length; i++) h = (h + str.charCodeAt(i)) % 9973;
        return h % mod;
    }

    function youtubeId(v) {
        var url = safeHttps(v);
        if (!url) return null;
        try {
            var u = new URL(url);
            var host = (u.hostname || '').replace(/^www\./, '').toLowerCase();
            var first = function (val) { return val ? String(val).split(/[?&/]/)[0] || null : null; };
            if (host === 'youtu.be') return first(u.pathname.replace(/^\/+/, ''));
            if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
                return u.searchParams.get('v')
                    || (u.pathname.indexOf('/shorts/') === 0 ? first(u.pathname.replace('/shorts/', '')) : null)
                    || (u.pathname.indexOf('/embed/') === 0 ? first(u.pathname.replace('/embed/', '')) : null)
                    || (u.pathname.indexOf('/live/') === 0 ? first(u.pathname.replace('/live/', '')) : null);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function ytThumb(v) { var id = youtubeId(v); return id && /^[A-Za-z0-9_-]{6,15}$/.test(id) ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : ''; }
    function ytEmbed(v) { var id = youtubeId(v); return id && /^[A-Za-z0-9_-]{6,15}$/.test(id) ? 'https://www.youtube.com/embed/' + id : ''; }

    function catLabel(c) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === c) return CATS[i][1]; return 'Other'; }
    function fmtDate(iso) { try { return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } }
    function fmtCount(n) { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n); }

    function ownerName(p) { return p.owner.display_name || p.owner.username || 'member'; }
    function ownerHref(p) { return 'profile.html?u=' + encodeURIComponent(p.owner.username || ''); }
    function profileProjectHref(p) { return ownerHref(p) + '#project-' + encodeURIComponent(p.id); }
    function shareHref(p) { return location.href.split('#')[0].split('?')[0] + '#project-' + encodeURIComponent(p.id); }

    var toastTimer = null;
    function toast(msg) {
        var t = $('phToast');
        if (!t) { t = el('div', { class: 'ph-toast', id: 'phToast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
        var host = document.querySelector('dialog[open]') || document.body;     // dialogs sit in the top layer
        if (t.parentNode !== host) host.appendChild(t);
        t.textContent = msg;
        void t.offsetWidth;
        t.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2600);
    }

    function normalize(p) {
        p.owner = p.owner || { id: p.owner_id, username: '', display_name: '', avatar_url: '' };
        p.tags = Array.isArray(p.tags) ? p.tags : [];
        p.like_count = Number(p.like_count) || 0;
        p.comment_count = Number(p.comment_count) || 0;
        p.repost_count = Number(p.repost_count) || 0;
        p.liked = !!p.liked; p.reposted = !!p.reposted; p.saved = !!p.saved;
        return p;
    }

    function friendly(err) {
        var code = String(err && err.code || '');
        var msg = String(err && err.message || '').toLowerCase();
        if (code === 'PGRST202' || /hub_projects|profile_project_saves/.test(msg)) return 'Run supabase-hub.sql in your Supabase SQL Editor to turn on the hub.';
        if (code === '42501' || msg.indexOf('row-level security') >= 0) return 'You are not allowed to do that right now.';
        if (code === '23505') return 'You already did that.';
        if (msg.indexOf('failed to fetch') >= 0 || msg.indexOf('network') >= 0) return 'Cannot reach the server. Check your connection.';
        return 'Something went wrong. Please try again.';
    }

    /* ----------------------------------------------------------------------
       data
       ---------------------------------------------------------------------- */
    async function fetchHub(extra) {
        var args = {
            p_q: S.q || null, p_category: S.cat || null, p_sort: S.sort,
            p_limit: PAGE, p_offset: 0, p_saved_only: S.saved
        };
        Object.keys(extra || {}).forEach(function (k) { args[k] = extra[k]; });
        var res = await sb.rpc('hub_projects', args);
        if (res.error) throw res.error;
        var d = res.data || {};
        d.items = (d.items || []).map(normalize);
        return d;
    }

    function hasFilters() { return !!(S.q || S.cat || S.saved); }

    async function load(reset) {
        if (S.loading && !reset) return;
        var my = ++S.seq;
        S.loading = true;
        if (reset) { S.items = []; renderSkeleton(); }
        try {
            var d = await fetchHub({ p_offset: reset ? 0 : S.items.length });
            if (my !== S.seq) return;
            S.items = reset ? d.items : S.items.concat(d.items);
            S.total = Number(d.total) || 0;
            S.savedCount = Number(d.saved_count) || 0;
            if (!hasFilters()) S.indexed = S.total;
            render();
        } catch (err) {
            if (my !== S.seq) return;
            showError(friendly(err));
        } finally {
            if (my === S.seq) S.loading = false;
        }
    }

    async function loadHighlights() {
        try {
            var d = await fetchHub({ p_pinned_only: true, p_limit: 12, p_offset: 0, p_sort: 'liked', p_q: null, p_category: null, p_saved_only: false });
            renderStories(d.items);
        } catch (e) { renderStories([]); }
    }

    /* ----------------------------------------------------------------------
       rendering: toolbar
       ---------------------------------------------------------------------- */
    function paintToolbar() {
        $('phSearchIcon').appendChild(icon('search'));
        $('phSelectIcon').appendChild(icon('chevron'));
        $('phSavedIcon').appendChild(icon('bookmark'));
        $('phViewGrid').appendChild(icon('grid'));
        $('phViewList').appendChild(icon('list'));

        var chips = clear($('phChips'));
        [['', 'All']].concat(CATS).forEach(function (c) {
            chips.appendChild(el('button', {
                type: 'button', class: 'ph-chip' + (S.cat === c[0] ? ' is-on' : ''), 'aria-pressed': String(S.cat === c[0]), dataset: { cat: c[0] }, text: c[1],
                onclick: function () { S.cat = c[0]; syncToolbar(); load(true); }
            }));
        });
    }

    function syncToolbar() {
        Array.prototype.forEach.call($('phChips').children, function (b) {
            var on = b.dataset.cat === S.cat;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-pressed', String(on));
        });
        $('phSaved').setAttribute('aria-pressed', String(S.saved));
        $('phSaved').classList.toggle('is-on', S.saved);
        $('phSavedCount').textContent = String(S.savedCount);
        $('phSort').value = S.sort;
        $('phGrid').dataset.view = S.view;
        ['phViewGrid', 'phViewList'].forEach(function (id) {
            var b = $(id);
            b.setAttribute('aria-pressed', String(b.dataset.viewBtn === S.view));
        });
    }

    function metaText() {
        var parts = [S.total + (S.total === 1 ? ' project' : ' projects')];
        if (S.items.length < S.total) parts[0] = 'Showing ' + S.items.length + ' of ' + S.total + ' projects';
        if (S.cat) parts.push(catLabel(S.cat));
        if (S.saved) parts.push('saved');
        if (S.q) parts.push('matching \u201C' + S.q + '\u201D');
        return parts.join(' \u00B7 ');
    }

    /* ----------------------------------------------------------------------
       rendering: engagement (in place, so keyboard focus survives a click)
       ---------------------------------------------------------------------- */
    var ENG = {
        like:    { icon: 'heart',    on: 'liked',    count: 'like_count',    label: 'Like',    labelOn: 'Unlike' },
        comment: { icon: 'comment',  on: null,       count: 'comment_count', label: 'Comments' },
        repost:  { icon: 'repost',   on: 'reposted', count: 'repost_count',  label: 'Repost',  labelOn: 'Remove repost' },
        save:    { icon: 'bookmark', on: 'saved',    count: null,            label: 'Save',    labelOn: 'Unsave' }
    };

    function fillEng(node, kind, p) {
        var cfg = ENG[kind];
        var on = cfg.on ? !!p[cfg.on] : false;
        clear(node);
        node.classList.toggle('is-on', on);
        if (node.tagName === 'BUTTON') node.setAttribute('aria-pressed', cfg.on ? String(on) : 'false');
        var label = on ? cfg.labelOn : cfg.label;
        node.setAttribute('title', label);
        node.setAttribute('aria-label', label + (cfg.count ? ' (' + p[cfg.count] + ')' : ''));
        node.appendChild(icon(cfg.icon, on));
        if (cfg.count) node.appendChild(el('span', { class: 'ph-eng-n', text: fmtCount(p[cfg.count]) }));
    }

    function engBtn(kind, p, asLink) {
        var node = asLink
            ? el('a', { class: 'ph-eng', href: profileProjectHref(p), dataset: { kind: kind, pid: p.id } })
            : el('button', { type: 'button', class: 'ph-eng', dataset: { kind: kind, pid: p.id } });
        fillEng(node, kind, p);

        if (!asLink) node.addEventListener('click', function (e) {
            e.stopPropagation();
            if (kind === 'like') toggleLike(p);
            else if (kind === 'repost') toggleRepost(p);
            else if (kind === 'save') toggleSave(p);
            else if (kind === 'comment') openProject(p, node);
        });
        return node;
    }

    function syncEng(p) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-pid="' + p.id + '"][data-kind]'), function (n) { fillEng(n, n.dataset.kind, p); });
        if (S.open && S.open.id === p.id) paintDialogMeta(p);
    }

    function needLogin(what) {
        if (S.me) return false;
        toast('Log in to ' + what + '.');
        return true;
    }

    // optimistic: the UI changes instantly and rolls back if the server says no. Resolves true on success.
    async function toggle(key, p, apply, revert, run) {
        if (S.busy.has(key)) return false;
        S.busy.add(key);
        apply(); syncEng(p);
        try {
            var res = await run();
            if (res && res.error && res.error.code !== '23505') throw res.error;
            return true;
        } catch (err) {
            revert(); syncEng(p);
            toast(friendly(err));
            return false;
        } finally { S.busy.delete(key); }
    }

    function toggleLike(p) {
        if (needLogin('like projects')) return;
        var was = p.liked;
        toggle('like:' + p.id, p,
            function () { p.liked = !was; p.like_count = Math.max(0, p.like_count + (was ? -1 : 1)); },
            function () { p.liked = was; p.like_count = Math.max(0, p.like_count + (was ? 1 : -1)); },
            function () {
                return was
                    ? sb.from('profile_project_likes').delete().eq('project_id', p.id).eq('user_id', S.me.id)
                    : sb.from('profile_project_likes').insert({ project_id: p.id, user_id: S.me.id });
            });
    }

    function toggleRepost(p) {
        if (needLogin('repost projects')) return;
        if (S.me.id === p.owner_id) { toast('You cannot repost your own project.'); return; }
        var was = p.reposted;
        toggle('repost:' + p.id, p,
            function () { p.reposted = !was; p.repost_count = Math.max(0, p.repost_count + (was ? -1 : 1)); },
            function () { p.reposted = was; p.repost_count = Math.max(0, p.repost_count + (was ? 1 : -1)); },
            function () {
                return was
                    ? sb.from('profile_reposts').delete().eq('project_id', p.id).eq('user_id', S.me.id)
                    : sb.from('profile_reposts').insert({ project_id: p.id, user_id: S.me.id });
            }).then(function (ok) { if (ok) toast(was ? 'Repost removed' : 'Reposted to your profile'); });
    }

    function toggleSave(p) {
        if (needLogin('save projects')) return;
        var was = p.saved;
        toggle('save:' + p.id, p,
            function () { p.saved = !was; S.savedCount = Math.max(0, S.savedCount + (was ? -1 : 1)); $('phSavedCount').textContent = String(S.savedCount); },
            function () { p.saved = was; S.savedCount = Math.max(0, S.savedCount + (was ? 1 : -1)); $('phSavedCount').textContent = String(S.savedCount); },
            function () {
                return was
                    ? sb.from('profile_project_saves').delete().eq('project_id', p.id).eq('user_id', S.me.id)
                    : sb.from('profile_project_saves').insert({ project_id: p.id, user_id: S.me.id });
            }).then(function (ok) {
                if (ok && S.saved && !p.saved) {                      // un-saving inside the Saved view removes the card
                    S.items = S.items.filter(function (x) { return x.id !== p.id; });
                    S.total = Math.max(0, S.total - 1);
                    if (!(S.open && S.open.id === p.id)) render();
                }
            });
    }

    function shareProject(p) {
        var url = shareHref(p);
        if (navigator.share) { navigator.share({ title: p.title + ' | SPECSOFT', text: p.summary || 'Check out this project', url: url }).catch(function () { /* cancelled */ }); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, function () { toast('Could not copy the link'); });
        else toast('Could not copy the link');
    }

    /* ----------------------------------------------------------------------
       rendering: cards
       ---------------------------------------------------------------------- */
    function imgEl(src) {
        var img = el('img', { src: src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', function () { img.remove(); });
        return img;
    }

    function artEl(p) {
        return el('span', { class: 'ph-art ph-art--' + hashIndex(p.title || 'x', 4), 'aria-hidden': 'true' }, el('span', { class: 'ph-art-letter', text: (p.title || '?').charAt(0).toUpperCase() }));
    }

    function avatarEl(o) {
        var node = el('span', { class: 'ph-av', 'aria-hidden': 'true' });
        var url = safeHttps(o.avatar_url);
        var name = o.display_name || o.username || '?';
        if (url) { var img = imgEl(url); img.addEventListener('error', function () { node.textContent = name.charAt(0).toUpperCase(); }); node.appendChild(img); }
        else node.textContent = name.charAt(0).toUpperCase();
        return node;
    }

    function ownerRow(p) {
        return el('a', { class: 'ph-owner', href: ownerHref(p), onclick: function (e) { e.stopPropagation(); } },
            avatarEl(p.owner), el('span', { class: 'ph-owner-name', text: ownerName(p) }),
            el('span', { class: 'ph-roles', dataset: { uid: p.owner_id } }));
    }

    function card(p) {
        var cover = safeHttps(p.cover_url) || ytThumb(p.video_url);
        var media = el('button', { type: 'button', class: 'ph-media ph-card-media', 'aria-label': 'Open ' + p.title, onclick: function () { openProject(p, media); } },
            artEl(p), cover ? imgEl(cover) : null,
            p.video_url ? el('span', { class: 'ph-play', 'aria-hidden': 'true' }, icon('play', true)) : null,
            p.pinned ? el('span', { class: 'ph-pin', text: 'PINNED' }) : null,
            el('span', { class: 'ph-cat', text: catLabel(p.category) }));

        var tags = el('ul', { class: 'ph-tags' });
        p.tags.slice(0, 4).forEach(function (t) { tags.appendChild(el('li', { text: String(t) })); });

        var mine = !!(S.me && S.me.id === p.owner_id);
        var eng = el('div', { class: 'ph-card-eng' }, engBtn('like', p), engBtn('comment', p), mine ? null : engBtn('repost', p), el('span', { class: 'ph-eng-gap' }), engBtn('save', p));

        var node = el('article', { class: 'ph-card', dataset: { id: p.id } }, media,
            el('div', { class: 'ph-card-body' },
                ownerRow(p),
                el('h3', { class: 'ph-card-title' }, el('button', { type: 'button', class: 'ph-card-titlebtn', text: p.title, onclick: function (e) { openProject(p, e.currentTarget); } })),
                p.summary ? el('p', { class: 'ph-card-sum', text: p.summary }) : null,
                p.tags.length ? tags : null,
                eng));
        S.nodes.set(p.id, node);
        return node;
    }

    function renderSkeleton() {
        var grid = clear($('phGrid'));
        S.nodes.clear();
        $('phEmpty').hidden = true;
        removeMore();
        for (var i = 0; i < 6; i++) grid.appendChild(el('div', { class: 'ph-card ph-skel', 'aria-hidden': 'true' }, el('span', { class: 'ph-media' }), el('div', { class: 'ph-card-body' }, el('span', { class: 'ph-skel-line' }), el('span', { class: 'ph-skel-line ph-skel-line--s' }))));
        $('phMeta').textContent = 'Loading\u2026';
    }

    function removeMore() { var m = $('phMore'); if (m) m.remove(); }

    function render() {
        var grid = clear($('phGrid'));
        S.nodes.clear();
        removeMore();
        syncToolbar();
        $('hudCount').textContent = String(S.indexed === null ? S.total : S.indexed);

        if (!S.items.length) { showEmpty(); return; }
        $('phEmpty').hidden = true;
        S.items.forEach(function (p) { grid.appendChild(card(p)); });
        $('phMeta').textContent = metaText();
        paintRoles();

        if (S.items.length < S.total) {
            var more = el('div', { class: 'ph-more', id: 'phMore' },
                el('button', { type: 'button', class: 'btn-secondary', text: 'LOAD MORE', onclick: function (e) { e.currentTarget.disabled = true; e.currentTarget.textContent = 'LOADING\u2026'; load(false); } }));
            grid.parentNode.insertBefore(more, grid.nextSibling);
        }
    }

    function showEmpty() {
        var text;
        if (S.saved && !S.me) text = 'Log in to see the projects you saved.';
        else if (S.saved && !S.q && !S.cat) text = 'You have not saved anything yet. Tap the bookmark on a project to keep it here.';
        else if (hasFilters()) text = 'No projects match that. Try different words or clear the filters.';
        else text = 'No projects yet. Be the first: post one from your profile and it shows up here.';
        $('phEmptyText').textContent = text;
        $('phClear').hidden = !hasFilters();
        $('phEmpty').hidden = false;
        $('phMeta').textContent = hasFilters() ? metaText() : '';
    }

    function showError(msg) {
        clear($('phGrid'));
        removeMore();
        $('phEmptyText').textContent = msg;
        $('phClear').hidden = true;
        $('phEmpty').hidden = false;
        $('phMeta').textContent = '';
    }

    function paintRoles() {
        if (!window.SpecRoles) return false;
        Array.prototype.forEach.call(document.querySelectorAll('.ph-roles:not([data-done])'), function (slot) {
            slot.dataset.done = '1';
            slot.appendChild(window.SpecRoles.inline(slot.dataset.uid, { max: 3 }));
        });
        return true;
    }

    // roles.js loads on its own; fill the badges in as soon as it is there
    (function waitForRoles() {
        var tries = 0;
        var t = setInterval(function () { if (paintRoles() || ++tries > 40) clearInterval(t); }, 150);
    })();

    /* ----------------------------------------------------------------------
       highlights row (pinned projects)
       ---------------------------------------------------------------------- */
    function renderStories(items) {
        var box = clear($('phStories'));
        box.hidden = !items.length;
        items.forEach(function (p) {
            var cover = safeHttps(p.cover_url) || ytThumb(p.video_url);
            var ring = el('span', { class: 'ph-story-ring' }, el('span', { class: 'ph-story-img ph-media' }, artEl(p), cover ? imgEl(cover) : null));
            box.appendChild(el('div', { role: 'listitem' },
                el('button', { type: 'button', class: 'ph-story', 'aria-label': 'Open ' + p.title, onclick: function (e) { openProject(p, e.currentTarget); } },
                    ring, el('span', { class: 'ph-story-name', text: p.title }))));
        });
    }

    /* ----------------------------------------------------------------------
       detail dialog
       ---------------------------------------------------------------------- */
    function mediaFor(p) {
        var box = el('div', { class: 'ph-d-stage' });
        var embed = ytEmbed(p.video_url), vid = safeHttps(p.video_url), cover = safeHttps(p.cover_url);
        if (embed) {
            box.appendChild(el('iframe', {
                class: 'ph-d-video', src: embed, title: p.title + ' video', loading: 'lazy', allowfullscreen: true,
                allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share', referrerpolicy: 'strict-origin-when-cross-origin'
            }));
        } else if (vid) {
            var v = el('video', { class: 'ph-d-video', controls: true, playsinline: true, preload: 'metadata' });
            if (cover) v.setAttribute('poster', cover);
            v.appendChild(el('source', { src: vid, type: /\.mp4(?:$|[?#])|video\/mp4/i.test(vid) ? 'video/mp4' : 'video/webm' }));
            box.appendChild(v);
        } else {
            box.appendChild(artEl(p));
            if (cover) box.appendChild(imgEl(cover));
        }
        return box;
    }

    function metaRow(dl, k, v) { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); }

    function paintDialogMeta(p) {
        var dl = clear($('phDMeta'));
        metaRow(dl, 'Category', catLabel(p.category));
        metaRow(dl, 'Posted', fmtDate(p.created_at));
        metaRow(dl, 'Likes', String(p.like_count));
        metaRow(dl, 'Comments', String(p.comment_count));
        metaRow(dl, 'Reposts', String(p.repost_count));
    }

    function openProject(p, trigger) {
        var dlg = $('phDialog');
        S.open = p;
        S.lastFocus = trigger || document.activeElement;

        clear($('phDMedia')).appendChild(mediaFor(p));
        clear($('phDHead')).appendChild(el('div', { class: 'ph-d-owner' }, ownerRow(p), el('span', { class: 'ph-cat ph-cat--inline', text: catLabel(p.category) })));
        $('phDTitle').textContent = p.title;
        $('phDText').textContent = p.summary || '';
        $('phDText').hidden = !p.summary;
        paintDialogMeta(p);

        var tags = clear($('phDTags'));
        p.tags.forEach(function (t) { tags.appendChild(el('span', { class: 'ph-tag', text: String(t) })); });
        tags.hidden = !p.tags.length;

        var mine = !!(S.me && S.me.id === p.owner_id);
        var acts = clear($('phDActions'));
        acts.appendChild(engBtn('like', p));
        acts.appendChild(engBtn('comment', p, true));
        if (!mine) acts.appendChild(engBtn('repost', p));
        acts.appendChild(engBtn('save', p));
        acts.appendChild(el('button', { type: 'button', class: 'ph-eng', title: 'Share', 'aria-label': 'Share project', onclick: function () { shareProject(p); } }, icon('share')));

        var link = $('phDLink'), live = safeHttps(p.url);
        clear(link);
        if (live) { link.href = live; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.appendChild(document.createTextNode('OPEN PROJECT ')); link.appendChild(icon('external')); }
        else { link.href = profileProjectHref(p); link.removeAttribute('target'); link.removeAttribute('rel'); link.appendChild(document.createTextNode('VIEW ON PROFILE ')); link.appendChild(icon('user')); }

        var repo = safeHttps(p.repo_url);
        var side = $('phDActions').parentNode;
        var old = side.querySelector('.ph-repo');
        if (old) old.remove();
        if (repo) side.insertBefore(el('a', { class: 'ph-repo', href: repo, target: '_blank', rel: 'noopener noreferrer' }, icon('code'), ' Source code'), $('phDLink'));

        paintRoles();
        if (!dlg.open) dlg.showModal();
        try { history.replaceState(null, '', '#project-' + p.id); } catch (e) { /* ignore */ }
    }

    function closeDialogCleanup() {
        S.open = null;
        clear($('phDMedia'));                                  // stops any playing video
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
        if (S.lastFocus && S.lastFocus.isConnected) S.lastFocus.focus();
        if (S.saved) render();                                 // an item un-saved while the dialog was open
    }

    async function openFromHash() {
        var m = /^#project-([0-9a-fA-F-]{36})$/.exec(location.hash);
        if (!m || !UUID_RE.test(m[1])) return;
        var id = m[1].toLowerCase();
        var known = S.items.filter(function (p) { return p.id === id; })[0];
        if (known) { openProject(known, null); return; }
        try {
            var d = await fetchHub({ p_id: id, p_q: null, p_category: null, p_saved_only: false, p_limit: 1 });
            if (d.items[0]) openProject(d.items[0], null);
            else toast('That project is not on the hub (it may have been removed).');
        } catch (e) { toast(friendly(e)); }
    }

    /* ----------------------------------------------------------------------
       live updates: new projects, likes and comments without a refresh
       ---------------------------------------------------------------------- */
    var liveTimer = null;
    function scheduleRefresh() {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(refreshInPlace, 1200);
    }

    async function refreshInPlace() {
        if (document.hidden || S.loading || S.items.length > 60) return;
        var my = S.seq;
        try {
            var d = await fetchHub({ p_limit: Math.min(60, Math.max(PAGE, S.items.length)), p_offset: 0 });
            if (my !== S.seq) return;
            var y = window.scrollY;
            S.items = d.items; S.total = Number(d.total) || 0; S.savedCount = Number(d.saved_count) || 0;
            if (!hasFilters()) S.indexed = S.total;
            if (S.open) {                                       // keep the open dialog in step without rebuilding it
                var fresh = S.items.filter(function (p) { return p.id === S.open.id; })[0];
                if (fresh) { Object.assign(S.open, fresh); syncEng(S.open); }
            }
            render();
            window.scrollTo(0, y);
        } catch (e) { /* the next event will retry */ }
    }

    function startLive() {
        try {
            sb.channel('specsoft-hub')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_projects' }, scheduleRefresh)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_project_likes' }, scheduleRefresh)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_project_comments' }, scheduleRefresh)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_reposts' }, scheduleRefresh)
                .subscribe();
        } catch (e) { /* not fatal: the hub still works, it just needs a refresh to see new things */ }
    }

    /* ----------------------------------------------------------------------
       start
       ---------------------------------------------------------------------- */
    function wire() {
        var searchTimer = null;
        $('phSearch').addEventListener('input', function (e) {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () { S.q = e.target.value.trim(); load(true); }, 260);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
            var t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (e.target && e.target.isContentEditable) || $('phDialog').open) return;
            e.preventDefault();
            $('phSearch').focus();
        });

        $('phSort').addEventListener('change', function (e) { S.sort = e.target.value; load(true); });

        $('phSaved').addEventListener('click', function () {
            if (!S.me) { toast('Log in to see the projects you saved.'); return; }
            S.saved = !S.saved;
            syncToolbar();
            load(true);
        });

        Array.prototype.forEach.call(document.querySelectorAll('[data-view-btn]'), function (b) {
            b.addEventListener('click', function () {
                S.view = b.dataset.viewBtn;
                try { localStorage.setItem('specsoft-hub-view', S.view); } catch (e) { /* ignore */ }
                syncToolbar();
            });
        });

        $('phClear').addEventListener('click', function () {
            S.q = ''; S.cat = ''; S.saved = false;
            $('phSearch').value = '';
            syncToolbar();
            load(true);
        });

        var dlg = $('phDialog');
        $('phDClose').appendChild(icon('close'));
        $('phDClose').addEventListener('click', function () { dlg.close(); });
        dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
        dlg.addEventListener('close', closeDialogCleanup);

        window.addEventListener('hashchange', function () { if (/^#project-/.test(location.hash)) openFromHash(); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleRefresh(); });
    }

    async function init() {
        try { S.view = localStorage.getItem('specsoft-hub-view') === 'list' ? 'list' : 'grid'; } catch (e) { /* ignore */ }
        paintToolbar();
        wire();
        syncToolbar();

        if (!sb) { showError('The site could not reach Supabase.'); return; }

        try { var sess = (await sb.auth.getSession()).data.session; S.me = sess ? sess.user : null; } catch (e) { S.me = null; }
        if (sb.auth.onAuthStateChange) sb.auth.onAuthStateChange(function (_e, session) {
            var was = S.me && S.me.id, now = session && session.user ? session.user.id : null;
            S.me = session ? session.user : null;
            if (was !== now) { if (!S.me) S.saved = false; load(true); }
        });

        loadHighlights();
        await load(true);
        openFromHash();
        startLive();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();