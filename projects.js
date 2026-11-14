/* ==========================================================================
   SPECSOFT® Projects Hub v2 (projects.js)

   One live feed for PROJECTS and POSTS. Both are rows of profile_projects (a post has kind = 'post'),
   so every like, comment, repost and save counts on the hub AND on the profile page.

   Needs (run in this order): supabase-projects-hub.sql, supabase-hub-v2.sql  (+ supabase-reports.sql for Report)
   Files:  projects.html, projects.css, post-social.css, post-comments.js, post-composer.js, projects.js
   Load order on projects.html: supabase-js, supabase-config.js, roles.js, main.js, post-comments.js, post-composer.js, projects.js
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

    // To add or rename a category: change it here, in HUBCATS in studio-publish.js AND in the check constraint in supabase-projects-hub.sql
    var CATS = [['ai', 'AI'], ['games', 'Games'], ['software', 'Software'], ['roblox', 'Roblox'], ['other', 'Other']];
    var TYPES = [['', 'All'], ['project', 'Projects'], ['post', 'Posts']];
    var PAGE = 18;
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    var S = {
        me: null, items: [], total: 0, indexed: null, savedCount: 0,
        q: '', cat: '', kind: '', sort: 'trending', saved: false, view: 'feed',
        loading: false, seq: 0, nodes: new Map(), open: null, busy: new Set(), lastFocus: null,
        thread: null, legacy: false, io: null,
        spot: { items: [], i: 0, timer: null }
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
        flag:    '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
        search:  '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
        chevron: '<polyline points="6 9 12 15 18 9"/>',
        left:    '<polyline points="15 18 9 12 15 6"/>',
        right:   '<polyline points="9 18 15 12 9 6"/>',
        feed:    '<rect x="3" y="3" width="8" height="11" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="3" y="16" width="8" height="5" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/>',
        grid:    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        list:    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
        play:    '<polygon points="7 4 20 12 7 20 7 4"/>',
        close:   '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        external:'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
        code:    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
        user:    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        file:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        link:    '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
        pin:     '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>'
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

    function isPost(p) { return p.kind === 'post'; }
    // the badge on a post: its status (Work, Milestones...) or just POST
    function postTag(p) { return String((window.SpecRich && window.SpecRich.statusLabel(p)) || 'POST').toUpperCase(); }
    function catLabel(c) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === c) return CATS[i][1]; return 'Other'; }
    function fmtCount(n) { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n); }
    function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function ago(iso) {
        var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
        try { return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; }
    }
    function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }

    function ownerName(p) { return p.owner.display_name || p.owner.username || 'member'; }
    function ownerHref(p) { return 'profile.html?u=' + encodeURIComponent(p.owner.username || ''); }
    function profileProjectHref(p) { return ownerHref(p) + '#project-' + encodeURIComponent(p.id); }
    function shareHref(p) { return location.href.split('#')[0].split('?')[0] + '#project-' + encodeURIComponent(p.id); }

    // On a computer with a mouse: the only place "Create a project" (Studio) is offered
    var pcQuery = window.matchMedia ? window.matchMedia('(min-width: 901px) and (pointer: fine)') : null;
    function isPC() { return !pcQuery || pcQuery.matches; }

    var toastTimer = null;
    function toast(msg) {
        var t = $('phToast');
        if (!t) { t = el('div', { class: 'ph-toast', id: 'phToast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
        var hostNode = document.querySelector('dialog[open]') || document.body;     // dialogs sit in the top layer
        if (t.parentNode !== hostNode) hostNode.appendChild(t);
        t.textContent = msg;
        void t.offsetWidth;
        t.classList.add('is-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('is-show'); }, 2600);
    }

    function normalize(p) {
        p.owner = p.owner || { id: p.owner_id, username: '', display_name: '', avatar_url: '' };
        p.kind = p.kind === 'post' ? 'post' : 'project';
        p.tags = Array.isArray(p.tags) ? p.tags : [];
        p.attachments = Array.isArray(p.attachments) ? p.attachments.filter(function (a) { return a && safeHttps(a.url); }) : [];
        p.links = Array.isArray(p.links) ? p.links.filter(function (l) { return l && safeHttps(l.url); }) : [];
        p.like_count = Number(p.like_count) || 0;
        p.comment_count = Number(p.comment_count) || 0;
        p.repost_count = Number(p.repost_count) || 0;
        p.liked = !!p.liked; p.reposted = !!p.reposted; p.saved = !!p.saved;
        return p;
    }

    function images(p) { return p.attachments.filter(function (a) { return a.kind === 'image' || /^image\//.test(a.type || ''); }); }
    function otherFiles(p) { return p.attachments.filter(function (a) { return !(a.kind === 'image' || /^image\//.test(a.type || '')); }); }
    function excerpt(p, n) {
        var t = String(p.body || p.summary || '').replace(/\s+/g, ' ').trim();
        return t.length > n ? t.slice(0, n - 1).trimEnd() + '\u2026' : t;
    }

    function friendly(err) {
        var code = String(err && err.code || '');
        var msg = String(err && err.message || '').toLowerCase();
        if (code === 'PGRST202' || /hub_projects|profile_project_saves/.test(msg)) return 'Run supabase-projects-hub.sql and supabase-hub-v2.sql in your Supabase SQL Editor to turn on the hub.';
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
            p_q: S.q || null, p_category: S.cat || null, p_kind: S.kind || null, p_sort: S.sort,
            p_limit: PAGE, p_offset: 0, p_saved_only: S.saved
        };
        Object.keys(extra || {}).forEach(function (k) { args[k] = extra[k]; });
        var res = await sb.rpc('hub_projects', args);

        // supabase-hub-v2.sql not installed yet: fall back to the old function so the hub still shows projects
        if (res.error && String(res.error.code) === 'PGRST202' && 'p_kind' in args) {
            S.legacy = true;
            delete args.p_kind;
            if (args.p_sort === 'trending') args.p_sort = 'liked';
            res = await sb.rpc('hub_projects', args);
        }
        if (res.error) throw res.error;
        var d = res.data || {};
        d.items = (d.items || []).map(normalize);
        return d;
    }

    function hasFilters() { return !!(S.q || S.cat || S.kind || S.saved); }

    async function load(reset) {
        if (S.loading && !reset) return;
        var my = ++S.seq;
        S.loading = true;
        var before = S.items.length;
        if (reset) { S.items = []; renderSkeleton(); }
        try {
            var d = await fetchHub({ p_offset: reset ? 0 : S.items.length });
            if (my !== S.seq) return;
            S.items = reset ? d.items : S.items.concat(d.items);
            S.total = Number(d.total) || 0;
            S.savedCount = Number(d.saved_count) || 0;
            if (!hasFilters()) S.indexed = S.total;
            if (reset) render(); else appendCards(d.items, before);
        } catch (err) {
            if (my !== S.seq) return;
            if (reset) showError(friendly(err)); else toast(friendly(err));
        } finally {
            if (my === S.seq) S.loading = false;
        }
    }

    function countUp(node, to) {
        to = Number(to) || 0;
        var from = Number(node.dataset.n) || 0;
        node.dataset.n = String(to);
        if (REDUCED || from === to) { node.textContent = String(to); return; }
        var t0 = performance.now(), dur = 900;
        (function step(t) {
            var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
            node.textContent = String(Math.round(from + (to - from) * e));
            if (k < 1) requestAnimationFrame(step);
        })(t0);
    }

    async function loadStats() {
        try {
            var res = await sb.rpc('hub_stats');
            if (res.error || !res.data) throw res.error || new Error('no stats');
            countUp($('stProjects'), res.data.projects);
            countUp($('stPosts'), res.data.posts);
            countUp($('stMakers'), res.data.makers);
        } catch (e) { $('phStats').hidden = true; }                 // old SQL: just hide the numbers
    }

    /* ----------------------------------------------------------------------
       toolbar
       ---------------------------------------------------------------------- */
    function paintToolbar() {
        $('phSearchIcon').appendChild(icon('search'));
        $('phSelectIcon').appendChild(icon('chevron'));
        $('phSavedIcon').appendChild(icon('bookmark'));
        $('phViewFeed').appendChild(icon('feed'));
        $('phViewGrid').appendChild(icon('grid'));
        $('phViewList').appendChild(icon('list'));

        var types = clear($('phTypes'));
        TYPES.forEach(function (t) {
            types.appendChild(el('button', {
                type: 'button', dataset: { kind: t[0] }, 'aria-pressed': String(S.kind === t[0]), text: t[1],
                onclick: function () { S.kind = t[0]; syncToolbar(); load(true); }
            }));
        });

        var chips = clear($('phChips'));
        [['', 'All categories']].concat(CATS).forEach(function (c) {
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
        Array.prototype.forEach.call($('phTypes').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.kind === S.kind)); });
        $('phTypes').hidden = S.legacy;
        $('phSaved').setAttribute('aria-pressed', String(S.saved));
        $('phSaved').classList.toggle('is-on', S.saved);
        $('phSavedCount').textContent = String(S.savedCount);
        $('phSort').value = S.sort;
        $('phGrid').dataset.view = S.view;
        Array.prototype.forEach.call(document.querySelectorAll('[data-view-btn]'), function (b) {
            b.setAttribute('aria-pressed', String(b.dataset.viewBtn === S.view));
        });
    }

    function metaText() {
        var noun = S.kind === 'project' ? 'project' : S.kind === 'post' ? 'post' : 'item';
        var parts = [S.total + ' ' + noun + (S.total === 1 ? '' : 's')];
        if (S.items.length < S.total) parts[0] = 'Showing ' + S.items.length + ' of ' + S.total + ' ' + noun + 's';
        if (S.cat) parts.push(catLabel(S.cat));
        if (S.saved) parts.push('saved');
        if (S.q) parts.push('matching \u201C' + S.q + '\u201D');
        return parts.join(' \u00B7 ');
    }

    /* ----------------------------------------------------------------------
       engagement (updated in place so keyboard focus survives a click)
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

    function engBtn(kind, p) {
        var node = el('button', { type: 'button', class: 'ph-eng', dataset: { kind: kind, pid: p.id } });
        fillEng(node, kind, p);
        node.addEventListener('click', function (e) {
            e.stopPropagation();
            if (kind === 'like') toggleLike(p);
            else if (kind === 'repost') toggleRepost(p);
            else if (kind === 'save') toggleSave(p);
            else if (kind === 'comment') { if (S.open && S.open.id === p.id) focusThread(); else openProject(p, node, true); }
        });
        return node;
    }

    function syncEng(p) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-pid="' + p.id + '"][data-kind]'), function (n) { fillEng(n, n.dataset.kind, p); });
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

    function noun(p) { return isPost(p) ? 'post' : 'project'; }

    function toggleLike(p) {
        if (needLogin('like this ' + noun(p))) return;
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
        if (needLogin('repost this ' + noun(p))) return;
        if (S.me.id === p.owner_id) { toast('You cannot repost your own ' + noun(p) + '.'); return; }
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
        if (needLogin('save this ' + noun(p))) return;
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
        if (navigator.share && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) { navigator.share({ title: p.title + ' | SPECSOFT', text: excerpt(p, 120) || 'Check this out', url: url }).catch(function () { /* cancelled */ }); return; }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, function () { toast('Could not copy the link'); });
        else toast('Could not copy the link');
    }

    function reportProject(p) {
        if (needLogin('report this ' + noun(p))) return;
        if (!window.SpecComments) { toast('Reports are not available right now.'); return; }
        window.SpecComments.report({ sb: sb, type: 'project', id: p.id, label: noun(p), toast: toast });
    }

    /* ----------------------------------------------------------------------
       cards
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

    function ownerRow(p, withTime) {
        return el('a', { class: 'ph-owner', href: ownerHref(p), onclick: function (e) { e.stopPropagation(); } },
            avatarEl(p.owner), el('span', { class: 'ph-owner-name', text: ownerName(p) }),
            el('span', { class: 'ph-roles', dataset: { uid: p.owner_id } }),
            withTime ? el('span', { class: 'ph-owner-time', text: ago(p.created_at) }) : null);
    }

    function isLive(p) { return !!(typeof p.studio_slug === 'string' && p.studio_slug) || !!safeHttps(p.url); }

    function tagList(p, n) {
        var tags = el('ul', { class: 'ph-tags' });
        p.tags.slice(0, n).forEach(function (t) { tags.appendChild(el('li', { text: String(t) })); });
        return tags;
    }

    function engRow(p) {
        var mine = !!(S.me && S.me.id === p.owner_id);
        return el('div', { class: 'ph-card-eng' }, engBtn('like', p), engBtn('comment', p), mine ? null : engBtn('repost', p), el('span', { class: 'ph-eng-gap' }), engBtn('save', p));
    }

    function projectCard(p) {
        var cover = safeHttps(p.cover_url) || ytThumb(p.video_url);
        var media = el('button', { type: 'button', class: 'ph-media ph-card-media', 'aria-label': 'Open ' + p.title, onclick: function () { openProject(p, media); } },
            artEl(p), cover ? imgEl(cover) : null,
            p.video_url ? el('span', { class: 'ph-play', 'aria-hidden': 'true' }, icon('play', true)) : null,
            el('span', { class: 'ph-badges' },
                p.pinned ? el('span', { class: 'ph-badge ph-badge--pin' }, icon('pin'), 'PINNED') : null,
                isLive(p) ? el('span', { class: 'ph-badge ph-badge--live' }, el('i'), 'LIVE') : null),
            el('span', { class: 'ph-cat', text: catLabel(p.category) }));

        return el('article', { class: 'ph-card ph-card--project', dataset: { id: p.id } }, media,
            el('div', { class: 'ph-card-body' },
                ownerRow(p, true),
                el('h3', { class: 'ph-card-title' }, el('button', { type: 'button', class: 'ph-card-titlebtn', text: p.title, onclick: function (e) { openProject(p, e.currentTarget); } })),
                p.summary ? el('p', { class: 'ph-card-sum', text: p.summary }) : null,
                p.tags.length ? tagList(p, 4) : null,
                engRow(p)));
    }

    function mosaic(p, open) {
        var imgs = images(p);
        if (!imgs.length) return null;
        var shown = imgs.slice(0, 4);
        var node = el('button', { type: 'button', class: 'ph-mosaic ph-mosaic--' + shown.length, 'aria-label': 'Open ' + p.title, onclick: open });
        shown.forEach(function (a, i) {
            var cell = el('span', { class: 'ph-mosaic-cell' }, imgEl(a.url));
            if (i === 3 && imgs.length > 4) cell.appendChild(el('span', { class: 'ph-mosaic-more', text: '+' + (imgs.length - 4) }));
            node.appendChild(cell);
        });
        return node;
    }

    function postCard(p) {
        var files = otherFiles(p), vids = files.filter(function (a) { return /^video\//.test(a.type || ''); });
        var open = function (e) { openProject(p, e && e.currentTarget); };
        var chips = el('div', { class: 'ph-chipline' },
            files.length ? el('span', { class: 'ph-mini' }, icon('file'), files.length + (files.length === 1 ? ' file' : ' files')) : null,
            vids.length ? el('span', { class: 'ph-mini' }, icon('play'), vids.length + (vids.length === 1 ? ' video' : ' videos')) : null,
            p.music && p.music.tracks && p.music.tracks.length ? el('span', { class: 'ph-mini' }, icon('play'), 'Music') : null,
            p.links.length ? el('span', { class: 'ph-mini' }, icon('link'), p.links.length + (p.links.length === 1 ? ' link' : ' links')) : null);

        return el('article', { class: 'ph-card ph-card--post', dataset: { id: p.id } },
            el('div', { class: 'ph-card-body' },
                el('div', { class: 'ph-card-top' }, ownerRow(p, true), el('span', { class: 'ph-badge ph-badge--post' }, postTag(p))),
                el('h3', { class: 'ph-card-title' }, el('button', { type: 'button', class: 'ph-card-titlebtn', text: p.title, onclick: function (e) { openProject(p, e.currentTarget); } })),
                excerpt(p, 260) ? el('p', { class: 'ph-card-sum ph-card-sum--post', text: excerpt(p, 260) }) : null,
                mosaic(p, open),
                chips.childNodes.length ? chips : null,
                p.tags.length ? tagList(p, 4) : null,
                engRow(p)));
    }

    function card(p) {
        var node = isPost(p) ? postCard(p) : projectCard(p);
        S.nodes.set(p.id, node);
        return node;
    }

    function renderSkeleton() {
        var grid = clear($('phGrid'));
        S.nodes.clear();
        $('phEmpty').hidden = true;
        for (var i = 0; i < 6; i++) grid.appendChild(el('div', { class: 'ph-card ph-skel', 'aria-hidden': 'true' }, el('span', { class: 'ph-media' }), el('div', { class: 'ph-card-body' }, el('span', { class: 'ph-skel-line' }), el('span', { class: 'ph-skel-line ph-skel-line--s' }))));
        $('phMeta').textContent = 'Loading\u2026';
    }

    function render() {
        var grid = clear($('phGrid'));
        S.nodes.clear();
        syncToolbar();
        $('hudCount').textContent = String(S.indexed === null ? S.total : S.indexed);

        if (!S.items.length) { showEmpty(); return; }
        $('phEmpty').hidden = true;
        S.items.forEach(function (p) { grid.appendChild(card(p)); });
        $('phMeta').textContent = metaText();
        paintRoles();
        moreButton();
    }

    function appendCards(fresh, before) {
        var grid = $('phGrid');
        var seen = new Set();
        Array.prototype.forEach.call(grid.children, function (n) { if (n.dataset && n.dataset.id) seen.add(n.dataset.id); });
        fresh.forEach(function (p) { if (!seen.has(p.id)) grid.appendChild(card(p)); });
        $('phMeta').textContent = metaText();
        $('hudCount').textContent = String(S.indexed === null ? S.total : S.indexed);
        paintRoles();
        moreButton();
    }

    // infinite scroll (the sentinel below the feed); a button is the fallback for browsers without IntersectionObserver
    function moreButton() {
        var old = $('phMore'); if (old) old.remove();
        if (S.items.length >= S.total) return;
        if (S.io) return;
        $('phGrid').parentNode.insertBefore(el('div', { class: 'ph-more', id: 'phMore' },
            el('button', { type: 'button', class: 'btn-secondary', text: 'LOAD MORE', onclick: function () { load(false); } })), $('phSentinel'));
    }

    function startInfinite() {
        if (!('IntersectionObserver' in window)) return;
        S.io = new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting && !S.loading && S.items.length && S.items.length < S.total) load(false);
        }, { rootMargin: '700px 0px' });
        S.io.observe($('phSentinel'));
    }

    function showEmpty() {
        var text;
        if (S.saved && !S.me) text = 'Log in to see what you saved.';
        else if (S.saved && !S.q && !S.cat && !S.kind) text = 'You have not saved anything yet. Tap the bookmark on a project or post to keep it here.';
        else if (hasFilters()) text = 'Nothing matches that. Try different words or clear the filters.';
        else text = 'Nothing here yet. Create the first post and it shows up in this feed.';
        $('phEmptyText').textContent = text;
        $('phClear').hidden = !hasFilters();
        $('phEmpty').hidden = false;
        $('phMeta').textContent = hasFilters() ? metaText() : '';
    }

    function showError(msg) {
        clear($('phGrid'));
        $('phEmptyText').textContent = msg;
        $('phClear').hidden = true;
        $('phEmpty').hidden = false;
        $('phMeta').textContent = '';
    }

    function paintRoles() {
        if (!window.SpecRoles) return false;
        Array.prototype.forEach.call(document.querySelectorAll('.ph-roles:not([data-done]), .pc-roles:not([data-done])'), function (slot) {
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
    window.addEventListener('specsoft:comments-painted', paintRoles);

    /* ----------------------------------------------------------------------
       spotlight (pinned items, or the trending ones when nothing is pinned)
       ---------------------------------------------------------------------- */
    async function loadSpot() {
        try {
            var d = await fetchHub({ p_pinned_only: true, p_limit: 6, p_offset: 0, p_sort: S.legacy ? 'liked' : 'trending', p_q: null, p_category: null, p_kind: null, p_saved_only: false });
            var items = d.items;
            if (!items.length) {
                d = await fetchHub({ p_limit: 5, p_offset: 0, p_sort: S.legacy ? 'liked' : 'trending', p_q: null, p_category: null, p_kind: null, p_saved_only: false });
                items = d.items.filter(function (p) { return p.like_count + p.comment_count > 0 || d.items.length <= 3; });
            }
            renderSpot(items);
        } catch (e) { renderSpot([]); }
    }

    function spotSlide(p, i) {
        var cover = safeHttps(p.cover_url) || ytThumb(p.video_url) || (images(p)[0] && images(p)[0].url) || '';
        var go = function (e) { openProject(p, e && e.currentTarget); };
        return el('article', { class: 'ph-slide', role: 'group', 'aria-roledescription': 'slide', 'aria-label': (i + 1) + ' of ' + S.spot.items.length, dataset: { i: String(i) } },
            el('div', { class: 'ph-slide-bg ph-media' }, artEl(p), cover ? imgEl(cover) : null),
            el('div', { class: 'ph-slide-shade' }),
            el('div', { class: 'ph-slide-body' },
                el('div', { class: 'ph-slide-tags' },
                    el('span', { class: 'ph-badge ' + (isPost(p) ? 'ph-badge--post' : 'ph-badge--solid'), text: isPost(p) ? postTag(p) : catLabel(p.category).toUpperCase() }),
                    p.pinned ? el('span', { class: 'ph-badge ph-badge--pin' }, icon('pin'), 'FEATURED') : el('span', { class: 'ph-badge ph-badge--pin' }, 'TRENDING'),
                    !isPost(p) && isLive(p) ? el('span', { class: 'ph-badge ph-badge--live' }, el('i'), 'LIVE') : null),
                el('h2', { class: 'ph-slide-title', text: p.title }),
                excerpt(p, 150) ? el('p', { class: 'ph-slide-sum', text: excerpt(p, 150) }) : null,
                el('div', { class: 'ph-slide-foot' },
                    ownerRow(p, false),
                    el('span', { class: 'ph-slide-stat' }, icon('heart', true), fmtCount(p.like_count)),
                    el('span', { class: 'ph-slide-stat' }, icon('comment'), fmtCount(p.comment_count)),
                    el('button', { type: 'button', class: 'btn-primary ph-slide-open', onclick: go }, 'OPEN ', icon('external')))));
    }

    function renderSpot(items) {
        S.spot.items = items; S.spot.i = 0;
        var sec = $('phSpot');
        sec.hidden = !items.length;
        clear($('phSpotTrack')); clear($('phSpotDots'));
        if (!items.length) { stopSpot(); return; }
        items.forEach(function (p, i) {
            $('phSpotTrack').appendChild(spotSlide(p, i));
            $('phSpotDots').appendChild(el('button', { type: 'button', role: 'tab', class: 'ph-dot', 'aria-label': 'Show ' + p.title, 'aria-selected': 'false', onclick: function () { goSpot(i, true); } }));
        });
        $('phSpotPrev').hidden = $('phSpotNext').hidden = items.length < 2;
        $('phSpotDots').hidden = items.length < 2;
        goSpot(0, false);
        paintRoles();
        startSpot();
    }

    function goSpot(i, user) {
        var n = S.spot.items.length; if (!n) return;
        S.spot.i = (i + n) % n;
        $('phSpotTrack').style.transform = 'translateX(' + (-100 * S.spot.i) + '%)';
        Array.prototype.forEach.call($('phSpotTrack').children, function (s, k) {
            var on = k === S.spot.i;
            s.setAttribute('aria-hidden', String(!on));
            Array.prototype.forEach.call(s.querySelectorAll('button, a'), function (b) { b.tabIndex = on ? 0 : -1; });
        });
        Array.prototype.forEach.call($('phSpotDots').children, function (d, k) { d.setAttribute('aria-selected', String(k === S.spot.i)); d.classList.toggle('is-on', k === S.spot.i); });
        if (user) startSpot();
    }

    function stopSpot() { clearInterval(S.spot.timer); S.spot.timer = null; }
    function startSpot() {
        stopSpot();
        if (REDUCED || S.spot.items.length < 2) return;
        S.spot.timer = setInterval(function () {
            var sec = $('phSpot');
            if (document.hidden || sec.matches(':hover') || sec.contains(document.activeElement) || (S.open)) return;
            goSpot(S.spot.i + 1, false);
        }, 7000);
    }

    /* ----------------------------------------------------------------------
       viewer
       ---------------------------------------------------------------------- */
    function studioHref(p) {
        var s = typeof p.studio_slug === 'string' ? p.studio_slug : '';
        if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(s)) return '';
        try { return new URL('studio-view.html?p=' + encodeURIComponent(s), location.href).href; } catch (e) { return ''; }
    }

    function projectStage(p) {
        var box = el('div', { class: 'ph-d-stage' });
        var embed = ytEmbed(p.video_url), vid = safeHttps(p.video_url), cover = safeHttps(p.cover_url), live = studioHref(p);
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
        } else if (live) {                                      // click to play: nothing runs until the visitor asks for it
            box.style.position = 'relative';
            box.appendChild(artEl(p));
            if (cover) box.appendChild(imgEl(cover));
            box.appendChild(el('div', { class: 'ph-d-playwrap' },
                el('button', {
                    type: 'button', class: 'btn-primary', 'aria-label': 'Play ' + p.title + ' here',
                    onclick: function () {
                        clear(box);
                        box.appendChild(el('iframe', {
                            class: 'ph-d-video', src: live, title: p.title + ' (live)', allowfullscreen: true,
                            sandbox: 'allow-scripts allow-same-origin allow-popups allow-pointer-lock', referrerpolicy: 'strict-origin-when-cross-origin'
                        }));
                    }
                }, icon('play', true), ' PLAY LIVE')));
        } else {
            box.appendChild(artEl(p));
            if (cover) box.appendChild(imgEl(cover));
        }
        return box;
    }

    function zoom(url) {
        var box = el('div', { class: 'pc-lightbox', role: 'dialog', 'aria-label': 'Image', tabindex: '-1' },
            el('img', { src: url, alt: '', referrerpolicy: 'no-referrer' }),
            el('button', { type: 'button', class: 'pc-lightbox-x', 'aria-label': 'Close image', onclick: function () { box.remove(); } }, icon('close')));
        box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
        box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); box.remove(); } });
        $('phDialog').appendChild(box);
        box.focus();
    }

    function postStage(p) {
        var box = el('div', { class: 'ph-d-post' });
        var tune = window.SpecRich && p.music ? window.SpecRich.music(p.music) : null;     // the song player goes first
        if (tune) box.appendChild(tune);
        if (p.doc && window.SpecRich) box.appendChild(el('div', { class: 'ph-d-body' }, window.SpecRich.render(p.doc)));
        else if (p.body) box.appendChild(el('div', { class: 'ph-d-body' }, window.SpecComments ? window.SpecComments.rich(p.body) : document.createTextNode(p.body)));
        else if (p.summary) box.appendChild(el('div', { class: 'ph-d-body', text: p.summary }));

        var imgs = images(p);
        if (imgs.length) {
            var gal = el('div', { class: 'ph-gallery ph-gallery--' + Math.min(imgs.length, 4) });
            imgs.forEach(function (a) {
                gal.appendChild(el('button', { type: 'button', class: 'ph-gal-item', 'aria-label': 'Open image ' + (a.name || ''), onclick: function () { zoom(a.url); } }, imgEl(a.url)));
            });
            box.appendChild(gal);
        }

        otherFiles(p).forEach(function (a) {
            if (/^video\//.test(a.type || '')) {
                box.appendChild(el('video', { class: 'ph-d-vid', controls: true, playsinline: true, preload: 'metadata', src: a.url }));
                return;
            }
            box.appendChild(el('a', { class: 'ph-file', href: a.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
                icon('file'), el('span', { class: 'ph-file-n' }, el('strong', { text: a.name || 'File' }), el('small', { text: (a.size ? fmtBytes(a.size) + ' \u00B7 ' : '') + String(a.type || 'file') })), icon('external')));
        });

        p.links.forEach(function (l) {
            box.appendChild(el('a', { class: 'ph-file ph-file--link', href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow' },
                icon('link'), el('span', { class: 'ph-file-n' }, el('strong', { text: host(l.url) }), el('small', { text: l.url })), icon('external')));
        });
        return box;
    }

    function openProject(p, trigger, focusComments) {
        var dlg = $('phDialog');
        var wasOpen = dlg.open;
        S.open = p;
        if (!wasOpen) S.lastFocus = trigger || document.activeElement;
        if (S.thread) { S.thread.destroy(); S.thread = null; }

        dlg.classList.toggle('is-post', isPost(p));
        clear($('phDStage')).appendChild(isPost(p) ? postStage(p) : projectStage(p));

        clear($('phDHead')).appendChild(el('div', { class: 'ph-d-owner' }, ownerRow(p, true),
            isPost(p) ? el('span', { class: 'ph-badge ph-badge--post', text: postTag(p) }) : el('span', { class: 'ph-cat ph-cat--inline', text: catLabel(p.category) })));
        $('phDTitle').textContent = p.title;
        $('phDText').textContent = isPost(p) ? '' : (p.summary || '');
        $('phDText').hidden = isPost(p) || !p.summary;

        var tags = clear($('phDTags'));
        p.tags.forEach(function (t) { tags.appendChild(el('span', { class: 'ph-tag', text: String(t) })); });
        tags.hidden = !p.tags.length;

        var mine = !!(S.me && S.me.id === p.owner_id);
        var acts = clear($('phDActions'));
        acts.appendChild(engBtn('like', p));
        if (!mine) acts.appendChild(engBtn('repost', p));
        acts.appendChild(engBtn('save', p));
        acts.appendChild(el('button', { type: 'button', class: 'ph-eng', title: 'Share', 'aria-label': 'Share', onclick: function () { shareProject(p); } }, icon('share')));
        if (!mine) acts.appendChild(el('button', { type: 'button', class: 'ph-eng ph-eng--quiet', title: 'Report', 'aria-label': 'Report this ' + noun(p), onclick: function () { reportProject(p); } }, icon('flag')));

        var link = $('phDLink'), live = isPost(p) ? '' : (studioHref(p) || safeHttps(p.url));
        clear(link);
        if (live) { link.hidden = false; link.href = live; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.appendChild(document.createTextNode('OPEN PROJECT ')); link.appendChild(icon('external')); }
        else { link.hidden = false; link.href = profileProjectHref(p); link.removeAttribute('target'); link.removeAttribute('rel'); link.appendChild(document.createTextNode('VIEW ON PROFILE ')); link.appendChild(icon('user')); }

        var side = $('phDActions').parentNode;
        var old = side.querySelector('.ph-repo');
        if (old) old.remove();
        var repo = safeHttps(p.repo_url);
        if (repo && !isPost(p)) side.insertBefore(el('a', { class: 'ph-repo', href: repo, target: '_blank', rel: 'noopener noreferrer' }, icon('code'), ' Source code'), $('phDLink'));

        // the thread
        var tHost = clear($('phDThread'));
        if (window.SpecComments && sb) {
            S.thread = window.SpecComments.mount(tHost, p, {
                sb: sb, me: S.me, toast: toast,
                onCount: function (n) { if (p.comment_count !== n) { p.comment_count = n; syncEng(p); } }
            });
        } else tHost.appendChild(el('p', { class: 'ph-empty', text: 'Comments could not load. Check that post-comments.js is next to projects.html.' }));

        // prev / next inside the feed
        var idx = S.items.indexOf(p);
        $('phDPrev').hidden = idx <= 0;
        $('phDNext').hidden = idx < 0 || idx >= S.items.length - 1;

        $('phDInfo').scrollTop = 0; $('phDStage').scrollTop = 0;
        paintRoles();
        if (!dlg.open) dlg.showModal();
        try { history.replaceState(null, '', '#project-' + p.id); } catch (e) { /* ignore */ }
        if (focusComments) setTimeout(focusThread, 60);
    }

    function focusThread() {
        var ta = $('phDThread').querySelector('textarea');
        var th = $('phDThread');
        if (th.scrollIntoView) th.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
        if (ta) ta.focus({ preventScroll: true });
    }

    function stepViewer(d) {
        if (!S.open) return;
        var idx = S.items.indexOf(S.open), next = S.items[idx + d];
        if (next) openProject(next, null);
    }

    function closeDialogCleanup() {
        S.open = null;
        if (S.thread) { S.thread.destroy(); S.thread = null; }
        clear($('phDStage'));                                  // stops any playing video
        clear($('phDThread'));
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
            var d = await fetchHub({ p_id: id, p_q: null, p_category: null, p_kind: null, p_saved_only: false, p_limit: 1 });
            if (d.items[0]) openProject(d.items[0], null);
            else toast('That item is not on the hub (it may have been removed).');
        } catch (e) { toast(friendly(e)); }
    }

    /* ----------------------------------------------------------------------
       live updates: new posts, likes and comments without a refresh
       ---------------------------------------------------------------------- */
    var liveTimer = null;
    function scheduleRefresh() {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(refreshInPlace, 1400);
    }

    async function refreshInPlace() {
        if (document.hidden || S.loading || S.items.length > 60) return;
        var my = S.seq;
        try {
            var d = await fetchHub({ p_limit: Math.min(60, Math.max(PAGE, S.items.length)), p_offset: 0 });
            if (my !== S.seq) return;
            S.total = Number(d.total) || 0; S.savedCount = Number(d.saved_count) || 0;
            if (!hasFilters()) S.indexed = S.total;
            $('hudCount').textContent = String(S.indexed === null ? S.total : S.indexed);

            var sameOrder = d.items.length === S.items.length && d.items.every(function (p, i) { return p.id === S.items[i].id; });
            if (sameOrder) {                                   // only numbers changed: update them in place, nothing jumps
                d.items.forEach(function (fresh, i) {
                    var cur = S.items[i];
                    cur.like_count = fresh.like_count; cur.comment_count = fresh.comment_count; cur.repost_count = fresh.repost_count;
                    cur.liked = fresh.liked; cur.reposted = fresh.reposted; cur.saved = fresh.saved;
                    syncEng(cur);
                });
                $('phSavedCount').textContent = String(S.savedCount);
                return;
            }
            if (S.open) return;                                // do not reshuffle the feed behind an open viewer
            var y = window.scrollY;
            S.items = d.items;
            render();
            window.scrollTo(0, y);
            loadStats();
        } catch (e) { /* the next event will retry */ }
    }

    function startLive() {
        try {
            sb.channel('specsoft-hub-v2')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_projects' }, scheduleRefresh)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_project_likes' }, scheduleRefresh)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_project_comments' }, scheduleRefresh)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_reposts' }, scheduleRefresh)
                .subscribe();
        } catch (e) { /* not fatal: the hub still works, it just needs a refresh to see new things */ }
    }

    /* ----------------------------------------------------------------------
       create menu
       ---------------------------------------------------------------------- */
    function newPost() {
        if (!S.me) { toast('Log in to create a post.'); return; }
        if (!window.SpecComposer) { toast('The post editor could not load.'); return; }
        if (S.legacy) { toast('Run supabase-hub-v2.sql in your Supabase SQL Editor to turn on posts.'); return; }
        window.SpecComposer.open({ sb: sb, me: S.me, toast: toast, onCreated: function () { S.kind = ''; S.q = ''; S.cat = ''; S.saved = false; $('phSearch').value = ''; S.sort = 'newest'; syncToolbar(); load(true); loadStats(); } });
    }

    function syncPCOnly() {
        var pc = isPC();
        Array.prototype.forEach.call(document.querySelectorAll('.ph-pc-only'), function (n) { n.hidden = !pc; });
        if (!pc) closeMenu();
    }

    function closeMenu() {
        $('phCreateMenu').hidden = true;
        $('phCreateBtn').setAttribute('aria-expanded', 'false');
    }

    function wireCreate() {
        var btn = $('phCreateBtn'), menu = $('phCreateMenu');
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!isPC()) { newPost(); return; }                // phones and tablets: there is only one thing to create
            var open = menu.hidden;
            menu.hidden = !open;
            btn.setAttribute('aria-expanded', String(open));
            if (open) { var first = menu.querySelector('[role=menuitem]'); if (first) first.focus(); }
        });
        $('phNewPost').addEventListener('click', function () { closeMenu(); newPost(); });
        $('phNewProject').addEventListener('click', function (e) {
            if (!isPC()) { e.preventDefault(); return; }
            if (!S.me) { e.preventDefault(); toast('Log in to build a project in Studio.'); }
        });
        document.addEventListener('click', function (e) { if (!$('phCreate').contains(e.target)) closeMenu(); });
        menu.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeMenu(); btn.focus(); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                var items = Array.prototype.filter.call(menu.querySelectorAll('[role=menuitem]'), function (n) { return !n.hidden; });
                var i = items.indexOf(document.activeElement);
                e.preventDefault();
                items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
            }
        });
        if (pcQuery) { if (pcQuery.addEventListener) pcQuery.addEventListener('change', syncPCOnly); else if (pcQuery.addListener) pcQuery.addListener(syncPCOnly); }
        syncPCOnly();
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
            var t = e.target && e.target.tagName, typing = t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (e.target && e.target.isContentEditable);
            if ($('phDialog').open) {
                if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('.pc-lightbox')) {
                    if (e.key === 'ArrowRight') stepViewer(1);
                    else if (e.key === 'ArrowLeft') stepViewer(-1);
                }
                return;
            }
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typing) return;
            e.preventDefault();
            $('phSearch').focus();
        });

        $('phSort').addEventListener('change', function (e) { S.sort = e.target.value; load(true); });

        $('phSaved').addEventListener('click', function () {
            if (!S.me) { toast('Log in to see what you saved.'); return; }
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
            S.q = ''; S.cat = ''; S.kind = ''; S.saved = false;
            $('phSearch').value = '';
            syncToolbar();
            load(true);
        });

        $('phSpotPrev').appendChild(icon('left'));
        $('phSpotNext').appendChild(icon('right'));
        $('phSpotPrev').addEventListener('click', function () { goSpot(S.spot.i - 1, true); });
        $('phSpotNext').addEventListener('click', function () { goSpot(S.spot.i + 1, true); });
        $('phSpot').addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft') { goSpot(S.spot.i - 1, true); } else if (e.key === 'ArrowRight') { goSpot(S.spot.i + 1, true); }
        });

        var dlg = $('phDialog');
        $('phDClose').appendChild(icon('close'));
        $('phDPrev').appendChild(icon('left'));
        $('phDNext').appendChild(icon('right'));
        $('phDClose').addEventListener('click', function () { dlg.close(); });
        $('phDPrev').addEventListener('click', function () { stepViewer(-1); });
        $('phDNext').addEventListener('click', function () { stepViewer(1); });
        dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) dlg.close(); });
        dlg.addEventListener('close', closeDialogCleanup);

        wireCreate();

        window.addEventListener('hashchange', function () { if (/^#project-/.test(location.hash)) openFromHash(); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleRefresh(); });
    }

    async function init() {
        try {
            var v = localStorage.getItem('specsoft-hub-view');
            S.view = v === 'list' || v === 'grid' ? v : 'feed';
        } catch (e) { /* ignore */ }
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

        startInfinite();
        await load(true);
        syncToolbar();
        loadSpot();
        loadStats();
        openFromHash();
        startLive();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
