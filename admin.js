/* SPECSOFT build 2026-10-21 · admin.js · v4 (cases) */
/* ==========================================================================
   SPECSOFT® Console (admin.js)

   READ THIS FIRST: nothing in this file is a security measure.
   Anyone can open this file, read it, or edit it in dev tools. That is fine, because
   every action below is a call to a database function (see supabase-admin.sql) that
   re-checks on the server that you are staff, high enough, and unlocked with your own
   password. A visitor who edits this file only gets error messages back.
   ========================================================================== */
(function () {
    'use strict';

    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };   // same public (publishable) key profile.js already ships
    var sb = window.getSupabaseClient ? window.getSupabaseClient() : (
        (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
            ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY)
            : null
    );

    var RANK = { moderator: 1, admin: 2, owner: 3 };
    var CATS = [
        { id: 'general',  title: 'General roles',  multi: true },
        { id: 'cosmetic', title: 'Cosmetic roles', multi: true },
        { id: 'verified', title: 'Verified roles', multi: false },
        { id: 'level',    title: 'Level roles',    multi: false }
    ];
    var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var IDLE_MS = 30 * 60 * 1000;

    var S = {
        status: null, level: '', username: '',
        until: 0, view: 'dashboard', token: 0,
        defs: [], defMap: new Map(), vtimers: [], clock: null
    };

    var ERR = {
        not_authenticated: 'Please sign in again.',
        not_staff: 'You do not have access.',
        locked: 'The console is locked. Enter your password.',
        forbidden: 'Your staff level cannot do that.',
        bad_kind: 'That action type is not valid.',
        reason_required: 'A reason of at least 3 characters is required.',
        bad_mode: 'That mode is not valid.', bad_theme: 'Pick a theme first.', bad_dates: 'The end must be after the start.', bad_intensity: 'That intensity is not valid.',
        not_found: 'That user or item no longer exists.',
        not_yourself: 'You cannot do that to yourself.',
        target_outranks_you: 'That person outranks you.',
        already_active: 'That is already active on this account.',
        already_revoked: 'That was already lifted.',
        bad_duration: 'Pick a valid duration.',
        mods_max_72h: 'Moderators are limited to 72 hours and cannot make permanent restrictions.',
        only_one_allowed: 'Only one role is allowed in this category.',
        bad_role: 'One of those roles is not valid.',
        bad_category: 'That role category is not valid.',
        role_not_grantable: 'You are not allowed to give or remove one of those roles.',
        bad_input: 'Something in that form is not valid.',
        bad_note: 'Notes need 2 to 1000 characters.',
        bad_level: 'That staff level is not valid.',
        bad_target: 'That person is not valid for this action.',
        cannot_change_owner: 'Owners can only be changed from the SQL editor.',
        weak_password: 'Use at least 12 characters, and not your username.',
        bad_password: 'Wrong password.',
        too_many_attempts: 'Too many wrong tries. Locked for a while.',
        no_password: 'No admin password has been created yet.',
        network: 'Network error. Try again.',
        bad_status: 'Pick a valid status.',
        case_closed: 'That case is already closed. Reopen it first.',
        bad_assignee: 'Only staff can be assigned to a case.',
        bad_outcome: 'Pick an outcome.',
        conflict: 'You cannot handle a report about yourself or someone above your level.',
        already_open: 'There is already an open case about that.',
        bad_category: 'Pick Main, Events or System.',
        title_required: 'A title is required.',
        bad_link: 'The link must start with https://'
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
            else if (k === 'value') node.value = v;
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
        grid:   '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        user:   '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
        tag:    '<path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42Z"/><circle cx="7" cy="7" r="1.2"/>',
        log:    '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
        shield: '<path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z"/>',
        flag:   '<path d="M4 22V4m0 0h13l-2 4 2 4H4"/>',
        mail:   '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22 6 12 13 2 6"/>',
        file:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        bell:   '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        send:   '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
        sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'
    };

    function icon(name) {
        var wrap = document.createElement('span');
        wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
        return wrap.firstChild;
    }

    function rank() { return RANK[S.level] || 0; }
    function canAtLeast(level) { return rank() >= RANK[level]; }

    function toast(msg, bad) {
        var t = $('adToast');
        t.textContent = msg;
        t.classList.toggle('is-bad', !!bad);
        t.classList.add('is-show');
        clearTimeout(toast._t);
        toast._t = setTimeout(function () { t.classList.remove('is-show'); }, bad ? 4200 : 2400);
    }

    function copy(text, msg) {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(msg || 'Copied'); }, function () { toast('Could not copy', true); });
        else toast('Could not copy', true);
    }

    function safeHttps(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : ''; }

    function fmt(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; }
    }

    function ago(iso) {
        if (!iso) return 'never';
        var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 45) return 'just now';
        if (s < 3600) return Math.round(s / 60) + 'm ago';
        if (s < 86400) return Math.round(s / 3600) + 'h ago';
        if (s < 7 * 86400) return Math.round(s / 86400) + 'd ago';
        return fmt(iso);
    }

    function untilText(iso) { return iso ? 'until ' + fmt(iso) : 'permanent'; }

    function avatar(u, big) {
        var name = (u && (u.display_name || u.username)) || '?';
        var node = el('span', { class: 'ad-av' + (big ? ' ad-av--lg' : ''), 'aria-hidden': 'true' });
        var url = safeHttps(u && u.avatar_url);
        if (url) {
            var img = el('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
            img.addEventListener('error', function () { img.remove(); node.textContent = name.charAt(0).toUpperCase(); });
            node.appendChild(img);
        } else node.textContent = name.charAt(0).toUpperCase();
        return node;
    }

    function pill(text, kind) { return el('span', { class: 'ad-pill' + (kind ? ' ad-pill--' + kind : ''), text: text }); }

    // A role icon can be: an emoji / short symbol, a Flaticon image link, or a file on your site (badges/crown.png).
    // The database enforces the same rule (role_icon_ok in supabase-role-icons.sql).
    var ICON_URL_RE = /^https:\/\/(cdn-icons-png|cdn-icons-gif|cdn-icons|cdn-uicons|media)\.flaticon\.com\/[A-Za-z0-9_.\/%-]{3,250}$/;
    var ICON_OWN_RE = /^https:\/\/mcpjjmbvuzclzrniunkq\.supabase\.co\/storage\/v1\/object\/public\/[A-Za-z0-9_.\/%-]{3,250}$/;
    var ICON_FILE_RE = /^badges\/[A-Za-z0-9_-]{1,60}\.(png|svg|webp|gif)$/;

    function iconIsImage(v) { return typeof v === 'string' && (ICON_URL_RE.test(v) || ICON_OWN_RE.test(v) || ICON_FILE_RE.test(v)); }
    function iconValid(v) { return typeof v === 'string' && ((v.length >= 1 && v.length <= 8) || iconIsImage(v)); }

    function iconNode(def) {
        var ic = def && def.icon;
        if (iconIsImage(ic)) {
            var img = el('img', { class: 'ad-ico-img', src: ic, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
            img.addEventListener('error', function () { var f = document.createTextNode('\u2605'); if (img.parentNode) img.parentNode.replaceChild(f, img); });
            return img;
        }
        return document.createTextNode((typeof ic === 'string' && ic.length >= 1 && ic.length <= 8) ? ic : '\u2605');
    }

    function roleChip(def) {
        var chip = el('span', { class: 'ad-pill ad-pill--role', title: def.name }, iconNode(def), ' ' + def.name);
        if (COLOR_RE.test(def.color)) { chip.style.color = def.color; chip.style.borderColor = def.color; }
        return chip;
    }

    function nextToken() { S.token += 1; return S.token; }
    function stale(token) { return token !== S.token; }
    function stopViewTimers() { S.vtimers.forEach(clearInterval); S.vtimers = []; }
    function stopTimers() { stopViewTimers(); if (S.clock) { clearInterval(S.clock); S.clock = null; } }

    /* ----------------------------------------------------------------------
       talking to the server
       ---------------------------------------------------------------------- */
    async function rpc(name, args, opts) {
        opts = opts || {};
        var res;
        try { res = await sb.rpc(name, args || {}); }
        catch (e) { if (!opts.quiet) toast(ERR.network, true); return { ok: false, error: 'network' }; }

        if (res.error) {
            if (!opts.quiet) toast('The server refused that. Is supabase-admin.sql installed?', true);
            return { ok: false, error: 'server' };
        }

        var d = res.data;
        if (d && d.ok === false) {
            if (d.error === 'locked') { lockUi(); return d; }
            if (d.error === 'not_staff' || d.error === 'not_authenticated') { showGate('denied'); return d; }
            if (!opts.quiet) toast(ERR[d.error] || ('Action failed: ' + d.error), true);
            return d;
        }
        S.until = Date.now() + IDLE_MS;                          // server uses a sliding idle timeout
        return d === null || d === undefined ? { ok: true } : d;
    }

    /* ----------------------------------------------------------------------
       modal dialog
       ---------------------------------------------------------------------- */
    function dialog(opts) {
        var dlg = $('adDlg'), body = clear($('adDlgBody')), foot = clear($('adDlgFoot'));
        $('adDlgTitle').textContent = opts.title;
        add(body, opts.body);

        var primary = null;
        function close() { if (dlg.open) dlg.close(); }

        (opts.buttons || []).forEach(function (b) {
            var btn = el('button', { type: 'button', class: 'ad-btn' + (b.kind ? ' ad-btn--' + b.kind : (b.primary ? '' : ' ad-btn--ghost')), text: b.text });
            btn.addEventListener('click', async function () {
                if (!b.onClick) { close(); return; }
                btn.disabled = true;
                var keep = false;
                try { keep = (await b.onClick()) === false; } finally { btn.disabled = false; }
                if (!keep) close();
            });
            if (b.primary) primary = btn;
            foot.appendChild(btn);
        });

        $('adDlgForm').onsubmit = function (e) { e.preventDefault(); if (primary && !primary.disabled) primary.click(); };
        $('adDlgX').onclick = close;
        dlg.onclick = function (e) { if (e.target === dlg) close(); };
        if (!dlg.open) dlg.showModal();
        var first = body.querySelector('input:not([type=hidden]),textarea,select');
        if (first) setTimeout(function () { first.focus(); }, 40);
        return { close: close };
    }

    function field(label, control, help) {
        return [el('label', { class: 'ad-label', text: label }), control, help ? el('p', { class: 'ad-help', text: help }) : null];
    }

    /* ----------------------------------------------------------------------
       GATE: loading / sign in / not found / create password / unlock
       ---------------------------------------------------------------------- */
    function showGate(kind, extra) {
        stopTimers();
        $('adShell').hidden = true;
        $('adGate').hidden = false;
        var card = clear($('adGateCard'));
        var logo = el('img', { class: 'ad-gate-logo', src: 'logo.png', alt: '' });

        if (kind === 'loading') {
            add(card, [el('div', { class: 'ad-spinner' }), el('p', { text: 'Checking access\u2026' })]);
        } else if (kind === 'signin') {
            add(card, [logo, el('h2', { text: 'Sign in required' }), el('p', { text: 'Sign in with your SPECSOFT account first.' }),
                el('button', { type: 'button', class: 'ad-btn', text: 'Sign in', onclick: function () { location.assign('login.html?next=admin.html'); } })]);
        } else if (kind === 'denied') {
            // looks like any missing page on purpose: no hints about what lives here
            add(card, [el('h2', { text: '404' }), el('p', { text: 'This page could not be found.' }),
                el('button', { type: 'button', class: 'ad-btn ad-btn--ghost', text: 'Go home', onclick: function () { location.assign('index.html'); } })]);
        } else if (kind === 'create') {
            gateCreate(card, logo);
        } else if (kind === 'unlock') {
            gateUnlock(card, logo, extra);
        } else if (kind === 'error') {
            add(card, [logo, el('h2', { text: 'Could not load' }), el('p', { text: extra || 'Something went wrong. Is supabase-admin.sql installed?' }),
                el('button', { type: 'button', class: 'ad-btn', text: 'Try again', onclick: boot })]);
        }
    }

    function pwInput(id, autocomplete, placeholder) {
        return el('input', { class: 'ad-field', type: 'password', id: id, autocomplete: autocomplete, placeholder: placeholder || '', maxlength: '128', spellcheck: 'false' });
    }

    function gateCreate(card, logo) {
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        var p1 = pwInput('adNew1', 'new-password', 'At least 12 characters');
        var p2 = pwInput('adNew2', 'new-password', 'Type it again');
        var btn = el('button', { type: 'submit', class: 'ad-btn', text: 'Create password and unlock' });
        var form = el('form', { novalidate: true },
            el('input', { type: 'text', name: 'username', autocomplete: 'username', value: S.username, hidden: true, 'aria-hidden': 'true', tabindex: '-1' }),
            field('NEW ADMIN PASSWORD', p1, 'Your own password for this console, separate from your login. It is only ever stored as a bcrypt hash on the server.'),
            field('CONFIRM', p2), err, btn);
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            err.hidden = true;
            if (p1.value !== p2.value) { err.textContent = 'The two passwords do not match.'; err.hidden = false; return; }
            btn.disabled = true;
            var d = await rpc('admin_set_password', { p_current: null, p_new: p1.value }, { quiet: true });
            btn.disabled = false;
            if (d && d.ok) { await enter(); return; }
            err.textContent = ERR[d && d.error] || 'Could not save that password.';
            err.hidden = false;
        });
        add(card, [logo, el('h2', { text: 'Create your admin password' }),
            el('p', { text: 'Welcome, ' + S.username + '. Pick a long passphrase. You will enter it every time the console locks.' }), form]);
        setTimeout(function () { p1.focus(); }, 40);
    }

    function gateUnlock(card, logo, note) {
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        var pw = pwInput('adPw', 'current-password', 'Admin password');
        var btn = el('button', { type: 'submit', class: 'ad-btn', text: 'Unlock console' });
        var st = S.status || {};
        if (note) { err.textContent = note; err.hidden = false; }
        if (st.locked_until) { err.textContent = 'Too many wrong tries. Try again after ' + fmt(st.locked_until) + '.'; err.hidden = false; }

        var form = el('form', { novalidate: true },
            el('input', { type: 'text', name: 'username', autocomplete: 'username', value: S.username, hidden: true, 'aria-hidden': 'true', tabindex: '-1' }),
            field('ADMIN PASSWORD', pw), err, btn);
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (!pw.value) return;
            btn.disabled = true; err.hidden = true;
            var d = await rpc('admin_unlock', { p_password: pw.value }, { quiet: true });
            btn.disabled = false; pw.value = '';
            if (d && d.ok) { await enter(); return; }
            var msg = ERR[d && d.error] || 'Could not unlock.';
            if (d && d.error === 'bad_password') msg += ' ' + d.attempts_left + ' tries left before a lockout.';
            if (d && d.error === 'too_many_attempts' && d.retry_at) msg = 'Too many wrong tries. Try again after ' + fmt(d.retry_at) + '.';
            err.textContent = msg; err.hidden = false;
            pw.focus();
        });

        add(card, [logo, el('h2', { text: 'Console locked' }), el('p', { text: 'Signed in as ' + S.username + '. Enter your admin password to continue.' }), form]);
        setTimeout(function () { pw.focus(); }, 40);
    }

    async function lockUi(note) {
        stopTimers();
        var st = await fetchStatus();
        if (!st || !st.staff) { showGate('denied'); return; }
        S.status = st;
        showGate(st.password_set ? 'unlock' : 'create', note);
    }

    async function fetchStatus() {
        try {
            var res = await sb.rpc('admin_status');
            if (res.error) return null;
            return res.data;
        } catch (e) { return null; }
    }

    async function boot() {
        showGate('loading');
        if (!sb) { showGate('error', 'The site could not reach Supabase.'); return; }

        var sess = null;
        try { sess = (await sb.auth.getSession()).data.session; } catch (e) { /* ignore */ }
        if (!sess) { showGate('signin'); return; }

        var st = await fetchStatus();
        if (!st) { showGate('error'); return; }
        if (!st.staff) { showGate('denied'); return; }

        S.status = st; S.level = st.level; S.username = st.username || '';
        if (!st.password_set) { showGate('create'); return; }
        if (!st.unlocked) { showGate('unlock'); return; }
        S.until = st.unlocked_until ? new Date(st.unlocked_until).getTime() : Date.now() + IDLE_MS;
        await enter();
    }

    /* ----------------------------------------------------------------------
       SHELL
       ---------------------------------------------------------------------- */
    var NAV = [
        { id: 'dashboard', label: 'Dashboard', ico: 'grid',   min: 'moderator' },
        { id: 'users',     label: 'Users',     ico: 'user',   min: 'moderator' },
        { id: 'roles',     label: 'Roles',     ico: 'tag',    min: 'moderator' },
        { id: 'audit',     label: 'Audit log', ico: 'log',    min: 'moderator' },
        { id: 'appeals',   label: 'Appeals',   ico: 'mail',   min: 'moderator' },
        { id: 'staff',     label: 'Staff',     ico: 'shield', min: 'admin' },
        { id: 'notifications', label: 'Notifications', ico: 'bell', min: 'moderator' },
        { id: 'seasons',   label: 'Seasons',   ico: 'sparkle', min: 'admin' },
        { id: 'events',    label: 'Events',    ico: 'sparkle', min: 'admin' },
        { id: 'cases',     label: 'Cases',     ico: 'flag',   min: 'moderator' },
        { id: 'content',   label: 'Content',   ico: 'file',   min: 'moderator', soon: true }
    ];

    async function loadDefs() {
        var res = await sb.from('role_defs').select('*').order('rank', { ascending: true });
        S.defs = res.data || [];
        S.defMap = new Map(S.defs.map(function (d) { return [d.id, d]; }));
    }

    async function enter() {
        var st = await fetchStatus();
        if (!st || !st.staff || !st.unlocked) { showGate('unlock'); return; }
        S.status = st; S.level = st.level; S.username = st.username || S.username;
        if (st.unlocked_until) S.until = new Date(st.unlocked_until).getTime();

        await loadDefs();
        $('adGate').hidden = true;
        $('adShell').hidden = false;
        paintNav();
        paintMe();
        startClock();
        route();
    }

    function paintMe() {
        var me = clear($('adMe'));
        add(me, [avatar({ username: S.username }), el('div', { class: 'ad-me-name' }, S.username, el('small', { text: S.level }))]);
    }

    function paintNav() {
        var nav = clear($('adNav'));
        NAV.forEach(function (n) {
            if (!canAtLeast(n.min)) return;
            var b = el('button', { type: 'button', class: 'ad-nav-btn' + (S.view === n.id ? ' is-active' : ''), dataset: { view: n.id }, disabled: n.soon,
                onclick: function () { go(n.id); } }, icon(n.ico), n.label, n.soon ? el('span', { class: 'ad-soon', text: 'SOON' }) : null);
            nav.appendChild(b);
        });
    }

    function startClock() {
        stopTimers();
        S.clock = setInterval(function () {
            var left = S.until - Date.now();
            var t = $('adTimer');
            if (left <= 0) { lockUi('The console locked itself after 30 idle minutes.'); return; }
            var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
            t.textContent = 'Auto-lock in ' + m + ':' + (s < 10 ? '0' : '') + s;
            t.classList.toggle('is-low', left < 3 * 60000);
        }, 1000);
    }

    function go(view, id) {
        location.hash = id ? view + '/' + id : view;
    }

    function route() {
        var parts = (location.hash || '#dashboard').slice(1).split('/');
        var view = parts[0] || 'dashboard';
        var exists = NAV.some(function (n) { return n.id === view && !n.soon && canAtLeast(n.min); });
        if (!exists) view = 'dashboard';
        S.view = view;
        paintNav();

        var token = nextToken();
        stopViewTimers();                                  // auto refresh belongs to the dashboard only
        var title = { dashboard: 'Dashboard', users: 'Users', roles: 'Roles', audit: 'Audit log', staff: 'Staff', notifications: 'Notifications', seasons: 'Seasons', events: 'Events', appeals: 'Appeals', cases: 'Cases' }[view];
        $('adTitle').textContent = title;
        $('adTopSub').textContent = '';
        var root = clear($('adView'));
        $('adView').scrollTop = 0;

        if (view === 'dashboard') viewDashboard(root, token);
        else if (view === 'users') parts[1] && UUID_RE.test(parts[1]) ? viewUser(root, parts[1].toLowerCase(), token) : viewUsers(root, token);
        else if (view === 'roles') viewRoles(root, token);
        else if (view === 'audit') viewAudit(root, token, parts[1] && UUID_RE.test(parts[1]) ? parts[1].toLowerCase() : null);
        else if (view === 'staff') viewStaff(root, token);
        else if (view === 'notifications') viewNotifications(root, token);
        else if (view === 'seasons') viewSeasons(root, token);
        else if (view === 'events') viewEvents(root, token);
        else if (view === 'appeals') viewAppeals(root, token);
        else if (view === 'cases') { if (parts[1] && UUID_RE.test(parts[1])) viewCase(root, parts[1].toLowerCase(), token); else viewCases(root, token); }
    }

    /* ----------------------------------------------------------------------
       DASHBOARD
       ---------------------------------------------------------------------- */
    var ACTION_LABEL = {
        sanction_issue: 'Sanction issued', sanction_revoke: 'Sanction lifted', note_add: 'Staff note added',
        roles_set: 'Roles changed', role_def_upsert: 'Role definition edited', staff_set: 'Staff changed',
        password_create: 'Admin password created', password_change: 'Admin password changed', password_reset: 'Admin password reset',
        panel_unlock: 'Console unlock', hub_hide: 'Hub visibility changed', sanction_details: 'Ban details updated',
        appeal_submit: 'Mistake report sent', appeal_resolve: 'Mistake report answered',
        nuke_settings_set: 'Nuke event settings changed', nuke_launch: 'Nuke event launched', nuke_abort: 'Nuke event aborted', glitch_settings_set: 'Glitchware settings changed', glitch_launch: 'Glitchware launched', glitch_abort: 'Glitchware aborted', blackout_settings_set: 'Blackout settings changed', blackout_launch: 'Blackout launched', blackout_abort: 'Blackout aborted', kawaii_settings_set: 'Kawaii settings changed', kawaii_launch: 'Kawaii event launched', kawaii_abort: 'Kawaii event aborted', thethe_settings_set: 'tHE THE settings changed', thethe_launch: 'tHE THE event launched', thethe_abort: 'tHE THE event aborted', rain_settings_set: 'Rain settings changed', rain_launch: 'Rain event launched', rain_abort: 'Rain event aborted', seasons_set: 'Seasonal theme changed', seasons_schedule_save: 'Seasonal event saved', seasons_schedule_delete: 'Seasonal event deleted',
        case_assign: 'Case assigned', case_status: 'Case status changed', case_resolve: 'Case closed', case_note: 'Case note added'
    };

    function actionLabel(a) {
        if (ACTION_LABEL[a]) return ACTION_LABEL[a];
        if (a.indexOf('security:') === 0) {
            var k = a.slice(9);
            return { panel_probe: 'Non-staff opened the console', forbidden_probe: 'Non-staff called a staff function', unlock_probe: 'Non-staff tried to unlock',
                password_probe: 'Non-staff tried to set a password', forbidden_action: 'Staff tried something above their level' }[k] || ('Alert: ' + k.replace(/_/g, ' '));
        }
        return a.replace(/_/g, ' ');
    }

    function stat(label, value, sub, cls) {
        return el('div', { class: 'ad-stat' + (cls ? ' ' + cls : '') }, el('small', { text: label }), el('b', { text: String(value) }), sub ? el('span', { text: sub }) : null);
    }

    function panel(title, body, headExtra) {
        return el('section', { class: 'ad-panel' }, el('div', { class: 'ad-panel-head' }, el('h2', { text: title }), headExtra || null), body);
    }

    function userRow(u, extra) {
        var name = u.display_name || u.username;
        return el('button', { type: 'button', class: 'ad-row', onclick: function () { go('users', u.id); } },
            avatar(u),
            el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: name }), el('div', { class: 'ad-row-sub', text: '@' + u.username + (extra ? ' \u00B7 ' + extra : '') })));
    }

    async function paintDashboard(root, token) {
        var results = await Promise.all([rpc('admin_dashboard'), rpc('admin_online_users', {}, { quiet: true }), rpc('admin_appeals_list', { p_status: 'open', p_limit: 1 }, { quiet: true }), rpc('admin_cases_summary', {}, { quiet: true })]);
        var d = results[0], on = results[1];
        var apOpen = results[2] && results[2].ok ? (Number(results[2].open_count) || 0) : 0;
        var cs = results[3] && results[3].ok ? results[3] : { pending: 0, investigating: 0, unassigned: 0, mine: 0 };
        if (stale(token) || !d.ok) return;
        clear(root);

        $('adTopSub').textContent = 'UPDATED ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        root.appendChild(el('div', { class: 'ad-grid' },
            stat('Registered users', d.users_total, '+' + d.users_24h + ' in 24h'),
            stat('Online now', d.online_now, 'seen in the last 2 min', 'is-live'),
            stat('Staff online', d.staff_online),
            stat('Active warnings', d.warnings_active),
            stat('Suspended', d.suspensions_active),
            stat('Banned', d.bans_active),
            stat('Restricted', d.restrictions_active),
            stat('Open appeals', apOpen, 'mistake reports waiting', apOpen > 0 ? 'is-hot' : ''),
            stat('Open cases', (Number(cs.pending) || 0) + (Number(cs.investigating) || 0), (cs.pending || 0) + ' new \u00B7 ' + (cs.unassigned || 0) + ' unassigned', (cs.pending || 0) > 0 ? 'is-hot' : ''),
            stat('Staff actions', d.actions_24h, 'last 24h'),
            stat('Security alerts', d.alerts_24h, 'last 24h', d.alerts_24h > 0 ? 'is-hot' : '')));

        var recent = el('div', { class: 'ad-list' });
        (d.recent_actions || []).forEach(function (a) {
            recent.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' },
                    el('div', { class: 'ad-row-title', text: actionLabel(a.action) }),
                    el('div', { class: 'ad-row-sub', text: (a.actor_name || 'unknown') + (a.target_name ? ' \u2192 @' + a.target_name : '') + (a.reason ? ' \u00B7 ' + a.reason : '') })),
                el('div', { class: 'ad-row-end' }, a.success ? null : pill('FAILED', 'bad'), el('div', { text: ago(a.at) }))));
        });
        if (!(d.recent_actions || []).length) recent.appendChild(el('p', { class: 'ad-empty', text: 'No moderation actions yet.' }));

        var alerts = el('div', { class: 'ad-list' });
        (d.alerts || []).forEach(function (a) {
            alerts.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' },
                    el('div', { class: 'ad-row-title', text: actionLabel(a.action) }),
                    el('div', { class: 'ad-row-sub', text: (a.actor_name || 'someone not signed in') + (a.meta && a.meta.attempts ? ' \u00B7 attempt ' + a.meta.attempts : '') })),
                el('div', { class: 'ad-row-end', text: ago(a.at) })));
        });
        if (!(d.alerts || []).length) alerts.appendChild(el('p', { class: 'ad-empty', text: 'No security alerts. Quiet is good.' }));

        var online = el('div', { class: 'ad-list' });
        var onlineUsers = (on && on.ok && on.users) || [];
        onlineUsers.slice(0, 12).forEach(function (u) { online.appendChild(userRow(u, (u.page || '') + ' \u00B7 ' + ago(u.last_seen))); });
        if (!onlineUsers.length) online.appendChild(el('p', { class: 'ad-empty', text: 'Nobody has the site open right now (or roles.js is not loaded on those pages yet).' }));

        var newest = el('div', { class: 'ad-list' });
        (d.newest_users || []).forEach(function (u) { newest.appendChild(userRow(u, ago(u.created_at))); });

        root.appendChild(el('div', { class: 'ad-cols' },
            panel('Recent moderation', recent, el('button', { type: 'button', class: 'ad-row-btn', text: 'FULL LOG', onclick: function () { go('audit'); } })),
            panel('Security alerts', alerts),
            panel('Online now (' + onlineUsers.length + ')', online),
            panel('Newest members', newest)));

    }

    function viewDashboard(root, token) {
        paintDashboard(root, token);
        S.vtimers.push(setInterval(function () {
            if (document.hidden || S.view !== 'dashboard' || $('adDlg').open || stale(token)) return;
            var y = root.scrollTop;
            paintDashboard(root, token).then(function () { root.scrollTop = y; });
        }, 30000));
    }

    /* ----------------------------------------------------------------------
       USERS: search
       ---------------------------------------------------------------------- */
    function userBadges(u) {
        var row = el('div', { class: 'ad-pills' });
        if (u.staff_level) row.appendChild(pill(u.staff_level.toUpperCase(), 'info'));
        if (u.banned) row.appendChild(pill('BANNED', 'bad'));
        if (u.suspended) row.appendChild(pill('SUSPENDED', 'warn'));
        if (u.active_warnings) row.appendChild(pill(u.active_warnings + ' WARNING' + (u.active_warnings > 1 ? 'S' : ''), 'warn'));
        else if (u.active_sanctions && !u.banned && !u.suspended) row.appendChild(pill('RESTRICTED', 'warn'));
        (u.roles || []).map(function (id) { return S.defMap.get(id); }).filter(Boolean)
            .sort(function (a, b) { return a.rank - b.rank; }).slice(0, 4)
            .forEach(function (d) { row.appendChild(el('span', { class: 'ad-pill--ico', title: d.name }, iconNode(d))); });
        return row;
    }

    function viewUsers(root, token) {
        var input = el('input', { class: 'ad-field', type: 'search', placeholder: 'Search by username, display name, or paste a user ID', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Find users' });
        var results = el('div', { class: 'ad-list' });
        var holder = panel('Results', results);
        root.appendChild(el('div', { class: 'ad-toolbar' }, input));
        root.appendChild(holder);
        results.appendChild(el('p', { class: 'ad-empty', text: 'Type at least 2 characters.' }));

        var timer = null, seq = 0;
        input.addEventListener('input', function () {
            clearTimeout(timer);
            timer = setTimeout(async function () {
                var q = input.value.trim(), my = ++seq;
                if (q.length < 2) { clear(results).appendChild(el('p', { class: 'ad-empty', text: 'Type at least 2 characters.' })); return; }
                var d = await rpc('admin_find_users', { p_q: q });
                if (my !== seq || stale(token) || !d.ok) return;
                clear(results);
                (d.users || []).forEach(function (u) {
                    results.appendChild(el('button', { type: 'button', class: 'ad-row', onclick: function () { go('users', u.id); } },
                        avatar(u),
                        el('div', { class: 'ad-row-main' },
                            el('div', { class: 'ad-row-title', text: u.display_name || u.username }),
                            el('div', { class: 'ad-row-sub', text: '@' + u.username + ' \u00B7 joined ' + ago(u.created_at) + ' \u00B7 seen ' + ago(u.last_seen) }),
                            userBadges(u))));
                });
                if (!(d.users || []).length) results.appendChild(el('p', { class: 'ad-empty', text: 'No one matches "' + q + '".' }));
            }, 280);
        });
        setTimeout(function () { input.focus(); }, 40);
    }

    /* ----------------------------------------------------------------------
       USERS: one person
       ---------------------------------------------------------------------- */
    var KIND_LABEL = {
        warning: 'Warning', suspension: 'Suspension', ban: 'Ban',
        restrict_post: 'Posting restricted', restrict_comment: 'Commenting restricted', restrict_chat: 'Chat restricted'
    };

    async function viewUser(root, id, token) {
        var d = await rpc('admin_user_detail', { p_user: id });
        if (stale(token)) return;
        if (!d.ok) { root.appendChild(el('p', { class: 'ad-empty', text: ERR[d.error] || 'Could not load that user.' })); return; }
        clear(root);

        var p = d.profile;
        var outranks = RANK[d.staff_level] >= rank() && d.staff_level;      // UI hint only; the server decides
        $('adTitle').textContent = p.display_name || p.username;
        $('adTopSub').textContent = '@' + p.username;

        root.appendChild(el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm ad-back', text: '\u2190 All users', onclick: function () { go('users'); } }));

        // ----- header
        var active = (d.sanctions || []).filter(function (s) { return s.active; });
        var pills = el('div', { class: 'ad-pills' });
        if (d.staff_level) pills.appendChild(pill('STAFF \u00B7 ' + d.staff_level.toUpperCase(), 'info'));
        active.forEach(function (s) { pills.appendChild(pill(KIND_LABEL[s.kind].toUpperCase(), s.kind === 'warning' ? 'warn' : 'bad')); });
        if (!active.length) pills.appendChild(pill('GOOD STANDING', 'ok'));
        (d.roles || []).map(function (rid) { return S.defMap.get(rid); }).filter(Boolean).sort(function (a, b) { return a.rank - b.rank; })
            .forEach(function (def) { pills.appendChild(roleChip(def)); });

        var idBtn = el('button', { type: 'button', class: 'ad-idcopy', text: p.id, title: 'Copy user ID', onclick: function () { copy(p.id, 'User ID copied'); } });
        var actions = el('div', { class: 'ad-user-actions' });
        [['warning', 'Warn', 'ghost'], ['suspension', 'Suspend', 'ghost'], ['restrict_post', 'Restrict posting', 'ghost'], ['restrict_comment', 'Restrict comments', 'ghost'], ['restrict_chat', 'Restrict chat', 'ghost'], ['ban', 'Ban', 'danger']]
            .forEach(function (a) {
                if (a[0] === 'ban' && !canAtLeast('admin')) return;
                actions.appendChild(el('button', { type: 'button', class: 'ad-btn ad-btn--sm ad-btn--' + a[2], text: a[1], disabled: !!outranks,
                    onclick: function () { sanctionDialog(p, a[0], function () { route(); }); } }));
            });
        if (outranks) actions.appendChild(el('span', { class: 'ad-help', text: 'This person is staff at your level or above, so you cannot sanction them.' }));

        root.appendChild(el('section', { class: 'ad-panel' },
            el('div', { class: 'ad-user-head' }, avatar(p, true),
                el('div', {}, el('h2', { text: p.display_name || p.username }), el('div', { class: 'ad-sub', text: '@' + p.username + (p.headline ? ' \u00B7 ' + p.headline : '') }))),
            el('div', { style: 'margin-top:14px' }, pills),
            el('div', { class: 'ad-user-meta' }, el('span', {}, 'ID ', idBtn), el('span', { text: 'Joined ' + fmt(p.created_at) }), el('span', { text: 'Last seen ' + (d.last_seen ? ago(d.last_seen) : 'never') }), el('span', { text: 'Status ' + p.status })),
            p.bio ? el('p', { class: 'ad-help', style: 'white-space:pre-wrap;overflow-wrap:anywhere', text: p.bio }) : null,
            actions));

        // ----- roles
        root.appendChild(rolesPanel(p, d.roles || [], function () { route(); }));

        // ----- sanctions
        var sl = el('div', {});
        (d.sanctions || []).forEach(function (s) {
            var top = el('div', { class: 'ad-sanction-top' }, pill(KIND_LABEL[s.kind].toUpperCase(), s.active ? (s.kind === 'warning' ? 'warn' : 'bad') : ''),
                s.active ? pill('ACTIVE', 'ok') : (s.revoked_at ? pill('LIFTED') : pill('EXPIRED')),
                el('small', { text: untilText(s.ends_at) + ' \u00B7 by ' + (s.issued_by_name || 'unknown') + ' \u00B7 ' + fmt(s.created_at) }));
            if (s.active && (s.kind !== 'ban' || canAtLeast('admin')) && !outranks) {
                top.appendChild(el('button', { type: 'button', class: 'ad-row-btn', text: s.kind === 'ban' ? 'UNBAN' : s.kind === 'warning' ? 'REMOVE' : 'LIFT', onclick: function () { revokeDialog(s, function () { route(); }); } }));
            }
            if (s.active && (s.kind === 'ban' || s.kind === 'suspension') && !outranks) {
                top.appendChild(el('button', { type: 'button', class: 'ad-row-btn', text: 'ADD NOTE / EVIDENCE', onclick: function () { sanctionDetailsDialog(s, function () { route(); }); } }));
            }
            sl.appendChild(el('div', { class: 'ad-sanction' }, top, el('p', { text: s.reason }),
                s.revoked_at ? el('small', { text: 'Lifted by ' + (s.revoked_by_name || 'unknown') + ' on ' + fmt(s.revoked_at) + (s.revoke_reason ? ': ' + s.revoke_reason : '') }) : null));
        });
        if (!(d.sanctions || []).length) sl.appendChild(el('p', { class: 'ad-empty', text: 'Clean record.' }));
        root.appendChild(panel('Sanctions and warnings', sl));

        // ----- projects on the Projects Hub (staff can hide one without deleting it from the profile)
        var prRes = null;
        try { prRes = await sb.from('profile_projects').select('id,title,category,show_in_hub,hub_hidden_at,created_at').eq('owner_id', p.id).order('created_at', { ascending: false }).limit(30); } catch (e) { prRes = null; }
        if (stale(token)) return;
        if (prRes && !prRes.error && (prRes.data || []).length) {
            var pl = el('div', { class: 'ad-list' });
            prRes.data.forEach(function (pj) {
                var hidden = !!pj.hub_hidden_at;
                pl.appendChild(el('div', { class: 'ad-row' },
                    el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: pj.title }), el('div', { class: 'ad-row-sub', text: (pj.category || 'other') + ' \u00B7 ' + ago(pj.created_at) })),
                    el('div', { class: 'ad-row-end' }, hidden ? pill('HIDDEN BY STAFF', 'bad') : (pj.show_in_hub === false ? pill('OPTED OUT') : pill('ON HUB', 'ok')), ' ',
                        el('button', { type: 'button', class: 'ad-row-btn', text: hidden ? 'RESTORE' : 'HIDE FROM HUB', onclick: function () { hubHideDialog(pj, !hidden, function () { route(); }); } }))));
            });
            root.appendChild(panel('Projects on the hub', pl));
        }

        // ----- notes
        var noteInput = el('input', { class: 'ad-field', placeholder: 'Internal staff note (members never see this)', maxlength: '1000' });
        var noteBtn = el('button', { type: 'submit', class: 'ad-btn ad-btn--sm', text: 'ADD NOTE' });
        var noteForm = el('form', { class: 'ad-note-form', novalidate: true }, noteInput, noteBtn);
        noteForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (noteInput.value.trim().length < 2) return;
            noteBtn.disabled = true;
            var r = await rpc('admin_add_note', { p_user: p.id, p_note: noteInput.value });
            noteBtn.disabled = false;
            if (r.ok) { toast('Note added'); route(); }
        });
        var nl = el('div', {});
        (d.notes || []).forEach(function (n) { nl.appendChild(el('div', { class: 'ad-note' }, el('p', { text: n.note }), el('small', { text: (n.author_name || 'unknown') + ' \u00B7 ' + fmt(n.created_at) }))); });
        if (!(d.notes || []).length) nl.appendChild(el('p', { class: 'ad-empty', text: 'No notes yet.' }));
        root.appendChild(panel('Staff notes', [noteForm, nl]));

        // ----- recent actions about this person
        var al = el('div', { class: 'ad-list' });
        (d.audit || []).slice(0, 10).forEach(function (a) {
            al.appendChild(el('div', { class: 'ad-row' }, el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: actionLabel(a.action) }), el('div', { class: 'ad-row-sub', text: (a.actor_name || 'unknown') + (a.reason ? ' \u00B7 ' + a.reason : '') })),
                el('div', { class: 'ad-row-end' }, a.success ? null : pill('FAILED', 'bad'), el('div', { text: ago(a.at) }))));
        });
        if (!(d.audit || []).length) al.appendChild(el('p', { class: 'ad-empty', text: 'No staff actions yet.' }));
        root.appendChild(panel('Recent staff actions on this account', al, el('button', { type: 'button', class: 'ad-row-btn', text: 'FULL LOG', onclick: function () { go('audit', p.id); } })));
    }

    /* ----- sanction dialogs ----- */
    var DURATIONS = {
        warning:    [['168', '7 days'], ['720', '30 days'], ['2160', '90 days (default)'], ['4320', '180 days'], ['8760', '1 year']],
        suspension: [['1', '1 hour'], ['6', '6 hours'], ['12', '12 hours'], ['24', '1 day'], ['72', '3 days'], ['168', '7 days'], ['336', '14 days'], ['720', '30 days'], ['custom', 'Custom hours\u2026']],
        ban:        [['', 'Permanent'], ['24', '1 day'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days'], ['2160', '90 days'], ['8760', '1 year']],
        restrict:   [['', 'Permanent'], ['1', '1 hour'], ['12', '12 hours'], ['24', '1 day'], ['72', '3 days'], ['168', '7 days'], ['720', '30 days']]
    };

    function sanctionDialog(p, kind, done) {
        var key = kind.indexOf('restrict') === 0 ? 'restrict' : kind;
        var opts = DURATIONS[key].filter(function (o) {
            if (rank() > 1) return true;
            return o[0] !== '' && o[0] !== 'custom' && Number(o[0]) <= 72;          // moderators: up to 72h, never permanent
        });
        var select = el('select', { class: 'ad-select' }, opts.map(function (o) { return el('option', { value: o[0], text: o[1], selected: kind === 'warning' && o[0] === '2160' }); }));
        var custom = el('input', { class: 'ad-field', type: 'number', min: '1', max: rank() > 1 ? '8760' : '72', placeholder: 'Hours', hidden: true });
        select.addEventListener('change', function () { custom.hidden = select.value !== 'custom'; });
        var reason = el('textarea', { class: 'ad-area', maxlength: '500', placeholder: 'What happened? The member will see this reason.' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        var showScreen = kind === 'ban' || kind === 'suspension';          // these two show the member a ban screen
        var noteIn = el('input', { class: 'ad-field', maxlength: '500', placeholder: 'Optional. Shown to the member on their ban screen.' });
        var evIn = el('textarea', { class: 'ad-area', maxlength: '500', placeholder: 'Optional. What did you review? (post, message, screenshot...)' });

        var titles = { warning: 'Warn', suspension: 'Suspend', ban: 'Ban', restrict_post: 'Restrict posting for', restrict_comment: 'Restrict commenting for', restrict_chat: 'Restrict chat for' };
        var helps = {
            warning: 'A warning does not block anything. It is recorded, shown to the member, and fades after the chosen time.',
            suspension: 'Blocks posting, commenting, chatting and profile edits until it ends.',
            ban: 'Blocks everything the website allows members to do. This does not delete their account or stop them from logging in.',
            restrict_post: 'Blocks creating projects, highlights and reposts.',
            restrict_comment: 'Blocks commenting on projects.',
            restrict_chat: 'Blocks sending chat messages.'
        };

        dialog({
            title: titles[kind] + ' @' + p.username,
            body: [field(kind === 'warning' ? 'EXPIRES AFTER' : 'DURATION', [select, custom]), field('REASON (REQUIRED)', reason, helps[kind]), showScreen ? [field('MODERATOR NOTE (THE MEMBER SEES THIS)', noteIn), field('EVIDENCE YOU REVIEWED', evIn, 'Gets an Evidence ID on the ban screen. You can add more later from their profile.')] : null, err],
            buttons: [
                { text: 'Cancel' },
                { text: titles[kind].replace(/ for$/, ''), kind: kind === 'warning' ? 'warn' : 'danger', primary: true, onClick: async function () {
                    err.hidden = true;
                    if (reason.value.trim().length < 3) { err.textContent = ERR.reason_required; err.hidden = false; return false; }
                    var hours = select.value === 'custom' ? parseInt(custom.value, 10) : (select.value === '' ? null : parseInt(select.value, 10));
                    if (select.value === 'custom' && !(hours > 0)) { err.textContent = ERR.bad_duration; err.hidden = false; return false; }
                    var r = await rpc('admin_issue_sanction', { p_user: p.id, p_kind: kind, p_reason: reason.value.trim(), p_hours: hours });
                    if (!r.ok) { err.textContent = ERR[r.error] || 'Could not apply that.'; err.hidden = false; return false; }
                    if (showScreen && (noteIn.value.trim() || evIn.value.trim())) {
                        await rpc('admin_set_sanction_details', { p_sanction: r.id, p_mod_note: noteIn.value.trim() || null, p_evidence: evIn.value.trim() || null });
                    }
                    toast('Done. The member was notified.');
                    done();
                } }
            ]
        });
    }

    function revokeDialog(s, done) {
        var reason = el('textarea', { class: 'ad-area', maxlength: '500', placeholder: 'Why is this being lifted?' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({
            title: (s.kind === 'ban' ? 'Unban' : 'Lift') + ': ' + KIND_LABEL[s.kind],
            body: [el('p', { class: 'ad-help', text: 'Original reason: ' + s.reason }), field('REASON (REQUIRED)', reason), err],
            buttons: [{ text: 'Cancel' }, { text: 'Confirm', primary: true, onClick: async function () {
                err.hidden = true;
                if (reason.value.trim().length < 3) { err.textContent = ERR.reason_required; err.hidden = false; return false; }
                var r = await rpc('admin_revoke_sanction', { p_id: s.id, p_reason: reason.value.trim() });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not lift that.'; err.hidden = false; return false; }
                toast('Lifted');
                done();
            } }]
        });
    }

    /* ----------------------------------------------------------------------
       CASES (what members report: projects, comments, members, chat, bugs)
       Several reports about the same thing are ONE case. Closing a case tells every reporter.
       ---------------------------------------------------------------------- */
    var TYPE_LABEL = { project: 'Project', comment: 'Comment', user: 'Member', chat_message: 'Chat message', bug: 'Bug report' };
    var REASON_LABEL = { spam: 'Spam or scam', inappropriate: 'Inappropriate', harassment: 'Harassment or hate', copyright: 'Stolen work', impersonation: 'Impersonation', bug: 'Bug', other: 'Other' };
    var STATUS_KIND = { pending: 'warn', investigating: 'info', resolved: 'ok', dismissed: '' };
    var STATUS_LABEL = { pending: 'NEW', investigating: 'INVESTIGATING', resolved: 'RESOLVED', dismissed: 'DISMISSED' };
    var OUTCOME_LABEL = { action_taken: 'Action taken', no_violation: 'No violation', duplicate: 'Duplicate', other: 'Closed' };

    var myIdCache = null;
    async function getMyId() {
        if (myIdCache) return myIdCache;
        try { var u = await sb.auth.getUser(); myIdCache = u && u.data && u.data.user ? u.data.user.id : null; } catch (e) { myIdCache = null; }
        return myIdCache;
    }

    function viewCases(root, token) {
        var status = el('select', { class: 'ad-select', 'aria-label': 'Filter by status' },
            [['open', 'Open (new + investigating)'], ['pending', 'New'], ['investigating', 'Investigating'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'], ['', 'All']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        var type = el('select', { class: 'ad-select', 'aria-label': 'Filter by type' },
            [['', 'All types'], ['project', 'Projects'], ['comment', 'Comments'], ['user', 'Members'], ['chat_message', 'Chat messages'], ['bug', 'Bug reports']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        var mine = el('input', { type: 'checkbox' });
        var list = el('div', { class: 'ad-list' });

        root.appendChild(el('div', { class: 'ad-toolbar' }, status, type, el('label', { class: 'ad-role-opt' }, mine, el('span', { text: 'Assigned to me' }))));
        root.appendChild(panel('Cases', list));
        root.appendChild(el('p', { class: 'ad-help', text: 'Reports about the same thing are grouped into one case, most-reported first. Reporters are only visible to staff.' }));

        async function load() {
            var d = await rpc('admin_cases_list', { p_status: status.value || null, p_type: type.value || null, p_mine: mine.checked, p_limit: 50, p_offset: 0 });
            if (stale(token) || !d.ok) return;
            var c = d.counts || {};
            $('adTopSub').textContent = (c.pending || 0) + ' NEW \u00B7 ' + (c.investigating || 0) + ' INVESTIGATING \u00B7 ' + (c.unassigned || 0) + ' UNASSIGNED \u00B7 ' + (c.mine || 0) + ' MINE';
            clear(list);
            (d.cases || []).forEach(function (k) {
                list.appendChild(el('button', { type: 'button', class: 'ad-row', onclick: function () { go('cases', k.id); } },
                    el('div', { class: 'ad-row-main' },
                        el('div', { class: 'ad-row-title', text: '#' + k.case_no + ' \u00B7 ' + (k.summary || TYPE_LABEL[k.target_type] || k.target_type) }),
                        el('div', { class: 'ad-row-sub', text: (TYPE_LABEL[k.target_type] || k.target_type) + ' \u00B7 ' + k.report_count + (k.report_count === 1 ? ' report' : ' reports') + ' \u00B7 ' + (REASON_LABEL[k.top_reason] || k.top_reason || '') +
                            (k.target_name ? ' \u00B7 about @' + k.target_name : '') + ' \u00B7 last ' + ago(k.last_reported_at) + ' \u00B7 ' + (k.assigned_name ? 'with @' + k.assigned_name : 'unassigned') })),
                    el('div', { class: 'ad-row-end' }, pill(STATUS_LABEL[k.status] || k.status, STATUS_KIND[k.status]))));
            });
            if (!(d.cases || []).length) list.appendChild(el('p', { class: 'ad-empty', text: 'No cases here. Nice and quiet.' }));
        }
        [status, type, mine].forEach(function (c) { c.addEventListener('change', load); });
        load();
    }

    function kv(label, value) {
        return el('div', { class: 'ad-kv' }, el('small', { text: label }), el('div', {}, value));
    }

    function renderSnapshot(c) {
        var sn = c.snapshot || {};
        var box = el('div', {});
        if (c.target_type === 'project') {
            box.appendChild(kv('Title', sn.title || c.summary));
            box.appendChild(kv('Category', sn.category || 'other'));
            box.appendChild(kv('Owner', sn.owner_username ? '@' + sn.owner_username : 'unknown'));
            if (sn.summary) box.appendChild(kv('Summary', sn.summary));
            var url = safeHttps(sn.url);
            if (url) box.appendChild(kv('Link', el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url })));
        } else if (c.target_type === 'comment') {
            box.appendChild(kv('Comment', sn.body || '(no text)'));
            var img = safeHttps(sn.image_url);
            if (img) box.appendChild(kv('Attached image', el('a', { href: img, target: '_blank', rel: 'noopener noreferrer', text: 'Open image' })));
            box.appendChild(kv('Written by', sn.author_username ? '@' + sn.author_username : 'unknown'));
            box.appendChild(kv('On project', sn.project_title || 'unknown'));
        } else if (c.target_type === 'user') {
            box.appendChild(kv('Display name', sn.display_name || '(none)'));
            box.appendChild(kv('Username', '@' + (sn.username || '?')));
            if (sn.headline) box.appendChild(kv('Headline', sn.headline));
            if (sn.bio) box.appendChild(kv('Bio', sn.bio));
        } else {
            box.appendChild(kv('Chat', (sn.room_name || 'unknown') + ' \u00B7 sent ' + (sn.sent_at ? fmt(sn.sent_at) : '?') + (sn.sender_username ? ' by @' + sn.sender_username : '')));
            var bug = null;
            if (c.target_type === 'bug' && typeof sn.body === 'string' && sn.body.slice(0, 6) === '[[bug:') {
                try { bug = JSON.parse(sn.body.slice(6, -2)); } catch (e) { bug = null; }
            }
            if (bug) {
                box.appendChild(kv('Bug title', bug.t || ''));
                box.appendChild(kv('Severity', String(bug.s || 'medium')));
                if (bug.d) box.appendChild(kv('What happened', bug.d));
                if (bug.c) box.appendChild(kv('Code or error', el('pre', { text: bug.c })));
            } else box.appendChild(kv('Message', sn.body || ''));
        }
        box.appendChild(el('p', { class: 'ad-help', text: 'This is a copy taken when the first report came in, so it stays here even if the content is edited or deleted.' }));
        return box;
    }

    async function viewCase(root, id, token) {
        var results = await Promise.all([rpc('admin_case_detail', { p_case: id }), getMyId()]);
        var d = results[0], myId = results[1];
        if (stale(token)) return;
        if (!d.ok) { root.appendChild(el('p', { class: 'ad-empty', text: ERR[d.error] || 'Could not load that case.' })); return; }
        clear(root);

        var c = d.case, isOpen = c.status === 'pending' || c.status === 'investigating', blocked = !!d.conflict;
        $('adTitle').textContent = 'Case #' + c.case_no;
        $('adTopSub').textContent = (TYPE_LABEL[c.target_type] || c.target_type).toUpperCase();

        root.appendChild(el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm ad-back', text: '\u2190 All cases', onclick: function () { go('cases'); } }));

        // ----- header + actions
        var pills = el('div', { class: 'ad-pills' }, pill(STATUS_LABEL[c.status] || c.status, STATUS_KIND[c.status]), pill((TYPE_LABEL[c.target_type] || c.target_type).toUpperCase(), 'info'),
            pill(c.report_count + (c.report_count === 1 ? ' REPORT' : ' REPORTS'), c.report_count >= 3 ? 'bad' : ''));
        if (c.outcome) pills.appendChild(pill(String(OUTCOME_LABEL[c.outcome] || c.outcome).toUpperCase(), c.outcome === 'action_taken' ? 'ok' : ''));
        if (d.target && d.target.banned) pills.appendChild(pill('TARGET BANNED', 'bad'));
        if (d.target && d.target.suspended) pills.appendChild(pill('TARGET SUSPENDED', 'warn'));

        function act(text, kind, handler, extra) { return el('button', { type: 'button', class: 'ad-btn ad-btn--sm' + (kind ? ' ad-btn--' + kind : ''), text: text, onclick: handler }); }
        function call(fn, args, okMsg) {
            return async function () {
                var r = await rpc(fn, args);
                if (r.ok) { toast(okMsg); route(); }
            };
        }

        var actions = el('div', { class: 'ad-user-actions' });
        if (blocked) {
            actions.appendChild(el('p', { class: 'ad-help', text: 'This case is about you or someone above your level, so another staff member has to handle it.' }));
        } else if (isOpen) {
            if (c.assigned_to !== myId) actions.appendChild(act('Assign to me', '', call('admin_case_assign', { p_case: c.id, p_user: myId }, 'Assigned to you')));
            if (c.assigned_to) actions.appendChild(act('Unassign', 'ghost', call('admin_case_assign', { p_case: c.id, p_user: null }, 'Unassigned')));
            if (canAtLeast('admin')) actions.appendChild(act('Assign to\u2026', 'ghost', function () { caseAssignDialog(c, function () { route(); }); }));
            if (c.status === 'pending') actions.appendChild(act('Mark investigating', 'ghost', call('admin_case_status', { p_case: c.id, p_status: 'investigating' }, 'Marked investigating')));
            else actions.appendChild(act('Back to new', 'ghost', call('admin_case_status', { p_case: c.id, p_status: 'pending' }, 'Moved back to new')));
            actions.appendChild(act('Resolve\u2026', '', function () { caseResolveDialog(c, 'resolved', function () { route(); }); }));
            actions.appendChild(act('Dismiss\u2026', 'ghost', function () { caseResolveDialog(c, 'dismissed', function () { route(); }); }));
        } else {
            actions.appendChild(act('Reopen as new', 'ghost', call('admin_case_status', { p_case: c.id, p_status: 'pending' }, 'Reopened')));
            actions.appendChild(act('Reopen as investigating', 'ghost', call('admin_case_status', { p_case: c.id, p_status: 'investigating' }, 'Reopened')));
        }
        // shortcuts to deal with what was reported
        if (c.target_user) actions.appendChild(act('Open member', 'ghost', function () { go('users', c.target_user); }));
        if (c.target_type === 'project' && !blocked) actions.appendChild(act('Hide from hub\u2026', 'ghost', function () { hubHideDialog({ id: c.target_id, title: c.summary }, true, function () { route(); }); }));

        var owner = c.snapshot && c.snapshot.owner_username;
        root.appendChild(el('section', { class: 'ad-panel' },
            el('h2', { style: 'font-size:20px;letter-spacing:-.3px;margin-bottom:12px;overflow-wrap:anywhere', text: c.summary || (TYPE_LABEL[c.target_type] || 'Case') }), pills,
            el('div', { class: 'ad-user-meta' },
                el('span', { text: 'First report ' + fmt(c.first_reported_at) }), el('span', { text: 'Latest ' + ago(c.last_reported_at) }),
                el('span', { text: c.assigned_name ? 'Assigned to @' + c.assigned_name : 'Unassigned' }),
                c.resolved_at ? el('span', { text: 'Closed ' + fmt(c.resolved_at) + (c.resolved_by_name ? ' by @' + c.resolved_by_name : '') }) : null),
            c.outcome_note ? el('p', { class: 'ad-help', text: 'Message to reporters: ' + c.outcome_note }) : null,
            actions,
            (c.target_type === 'project' && owner) ? el('p', { class: 'ad-help' }, el('a', { href: 'profile.html?u=' + encodeURIComponent(owner) + '#project-' + encodeURIComponent(c.target_id), target: '_blank', rel: 'noopener', text: 'View the project on the site' })) : null));

        root.appendChild(panel('What was reported', renderSnapshot(c)));

        // ----- the reports themselves (reporters are only ever shown to staff)
        var rl = el('div', { class: 'ad-list' });
        (d.reports || []).forEach(function (r) {
            rl.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' },
                    el('div', { class: 'ad-row-title', text: r.reporter_name ? '@' + r.reporter_name : 'deleted account' }),
                    el('div', { class: 'ad-row-sub', text: (r.note ? '\u201C' + r.note + '\u201D' : 'No details written') })),
                el('div', { class: 'ad-row-end' }, pill(String(REASON_LABEL[r.reason] || r.reason).toUpperCase()), ' ', r.notified_at ? pill('NOTIFIED', 'ok') : null, el('div', { text: ago(r.created_at) }))));
        });
        root.appendChild(panel('Reports (' + (d.reports || []).length + ')', rl));

        // ----- notes
        var noteIn = el('input', { class: 'ad-field', placeholder: 'Internal note about this case (reporters never see it)', maxlength: '1000' });
        var noteBtn = el('button', { type: 'submit', class: 'ad-btn ad-btn--sm', text: 'ADD NOTE' });
        var noteForm = el('form', { class: 'ad-note-form', novalidate: true }, noteIn, noteBtn);
        noteForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (noteIn.value.trim().length < 2) return;
            noteBtn.disabled = true;
            var r = await rpc('admin_case_note', { p_case: c.id, p_note: noteIn.value });
            noteBtn.disabled = false;
            if (r.ok) { toast('Note added'); route(); }
        });
        var nl = el('div', {});
        (d.notes || []).forEach(function (n) { nl.appendChild(el('div', { class: 'ad-note' }, el('p', { text: n.note }), el('small', { text: (n.author_name || 'unknown') + ' \u00B7 ' + fmt(n.created_at) }))); });
        if (!(d.notes || []).length) nl.appendChild(el('p', { class: 'ad-empty', text: 'No notes yet.' }));
        root.appendChild(panel('Staff notes', [noteForm, nl]));

        // ----- timeline
        var tl = el('div', { class: 'ad-list' });
        (d.events || []).slice().reverse().forEach(function (ev) {
            tl.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: ev.text || ev.kind }), el('div', { class: 'ad-row-sub', text: ev.actor_name ? 'by @' + ev.actor_name : 'a member' })),
                el('div', { class: 'ad-row-end', text: ago(ev.at) })));
        });
        root.appendChild(panel('Timeline', tl));
    }

    function caseResolveDialog(c, status, done) {
        var closing = status === 'dismissed' ? 'Dismiss' : 'Resolve';
        var outcome = el('select', { class: 'ad-select' }, [['action_taken', 'Action taken (warned, removed, banned...)'], ['no_violation', 'No violation found'], ['duplicate', 'Duplicate of another case'], ['other', 'Something else']]
            .map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === (status === 'dismissed' ? 'no_violation' : 'action_taken') }); }));
        var msg = el('textarea', { class: 'ad-area', maxlength: '400', placeholder: 'Optional. Added after our standard message.' });
        var notify = el('input', { type: 'checkbox', checked: true });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        var n = c.report_count || 0;
        dialog({
            title: closing + ' case #' + c.case_no,
            body: [field('OUTCOME', outcome), field('MESSAGE FOR THE ' + (n === 1 ? 'REPORTER' : n + ' REPORTERS') + ' (OPTIONAL)', msg, 'They see a short standard update in their notification bell. We never tell them who or what action, only what you write here.'),
                el('label', { class: 'ad-role-opt', style: 'margin-top:14px' }, notify, el('span', { text: 'Notify the reporter' + (n === 1 ? '' : 's') })), err],
            buttons: [{ text: 'Cancel' }, { text: closing + ' case', primary: true, onClick: async function () {
                err.hidden = true;
                var r = await rpc('admin_case_resolve', { p_case: c.id, p_status: status, p_outcome: outcome.value, p_message: msg.value.trim() || null, p_notify: notify.checked });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not close that case.'; err.hidden = false; return false; }
                toast('Case closed' + (r.notified ? '. ' + r.notified + ' reporter(s) notified' : ''));
                done();
            } }]
        });
    }

    async function caseAssignDialog(c, done) {
        var d = await rpc('admin_staff_list');
        if (!d.ok) return;
        var sel = el('select', { class: 'ad-select' }, (d.staff || []).map(function (m) { return el('option', { value: m.id, text: '@' + m.username + ' (' + m.level + ')', selected: m.id === c.assigned_to }); }));
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({
            title: 'Assign case #' + c.case_no,
            body: [field('STAFF MEMBER', sel), err],
            buttons: [{ text: 'Cancel' }, { text: 'Assign', primary: true, onClick: async function () {
                var r = await rpc('admin_case_assign', { p_case: c.id, p_user: sel.value });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not assign that.'; err.hidden = false; return false; }
                toast('Case assigned');
                done();
            } }]
        });
    }

    /* ----------------------------------------------------------------------
       APPEALS ("report this as a mistake" from the ban screen)
       ---------------------------------------------------------------------- */
    function viewAppeals(root, token) {
        var statusSel = el('select', { class: 'ad-select', 'aria-label': 'Filter by status' },
            [['open', 'New'], ['reviewing', 'In review'], ['accepted', 'Accepted'], ['rejected', 'Answered / rejected'], ['', 'All']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        var list = el('div');
        root.appendChild(el('div', { class: 'ad-toolbar' }, statusSel));
        root.appendChild(list);
        root.appendChild(el('p', { class: 'ad-help', text: 'Banned or suspended members can send a "report this as a mistake" from their ban screen. Answer it here, then lift the ban from their profile if you agree with them.' }));

        async function load() {
            var d = await rpc('admin_appeals_list', { p_status: statusSel.value || null, p_limit: 50 });
            if (stale(token) || !d.ok) return;
            clear(list);
            $('adTopSub').textContent = (d.open_count || 0) + ' WAITING';
            (d.appeals || []).forEach(function (a) { list.appendChild(appealCard(a, load)); });
            if (!(d.appeals || []).length) list.appendChild(el('p', { class: 'ad-empty', text: 'Nothing here.' }));
        }
        statusSel.addEventListener('change', load);
        load();
    }

    function appealCard(a, reload) {
        var evidence = el('div');
        (a.evidence || []).forEach(function (e) { evidence.appendChild(el('p', { class: 'ad-help', text: e.ref + ' \u00B7 ' + fmt(e.reviewed_at) + ': ' + e.summary })); });

        var head = el('div', { class: 'ad-appeal-head' }, avatar({ username: a.username, display_name: a.display_name }),
            el('div', { class: 'ad-row-main' },
                el('div', { class: 'ad-row-title', text: a.display_name || a.username }),
                el('div', { class: 'ad-row-sub', text: '@' + a.username + ' \u00B7 sent ' + ago(a.created_at) })),
            pill(a.kind === 'mistake' ? 'MISTAKE REPORT' : 'APPEAL', 'info'),
            pill(String(a.status).toUpperCase(), a.status === 'accepted' ? 'ok' : (a.status === 'rejected' ? 'bad' : 'warn')));

        var card = el('section', { class: 'ad-panel ad-appeal' }, head,
            el('p', { class: 'ad-appeal-msg', text: a.message }),
            el('div', { class: 'ad-appeal-case' },
                el('small', { text: 'THEIR ' + String(KIND_LABEL[a.sanction_kind] || a.sanction_kind).toUpperCase() + ' \u00B7 ' + untilText(a.ends_at) }),
                el('p', { class: 'ad-help', text: 'Reason: ' + a.sanction_reason }),
                a.mod_note ? el('p', { class: 'ad-help', text: 'Moderator note: ' + a.mod_note }) : null,
                evidence),
            a.response ? el('p', { class: 'ad-help', text: 'Reply from ' + (a.handled_by_name ? '@' + a.handled_by_name : 'staff') + ': ' + a.response }) : null);

        var acts = el('div', { class: 'ad-user-actions' });
        acts.appendChild(el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Open user', onclick: function () { go('users', a.user_id); } }));
        if (a.status === 'open') {
            acts.appendChild(el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Mark in review', onclick: async function () {
                var r = await rpc('admin_appeal_resolve', { p_id: a.id, p_status: 'reviewing', p_response: null });
                if (r.ok) { toast('Marked in review'); reload(); }
            } }));
        }
        if (a.status === 'open' || a.status === 'reviewing') {
            acts.appendChild(el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Accept...', onclick: function () { appealReplyDialog(a, 'accepted', reload); } }));
            acts.appendChild(el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'Reject...', onclick: function () { appealReplyDialog(a, 'rejected', reload); } }));
        }
        card.appendChild(acts);
        return card;
    }

    function appealReplyDialog(a, status, done) {
        var reply = el('textarea', { class: 'ad-area', maxlength: '600', placeholder: status === 'accepted' ? 'What did you decide? The member sees this.' : 'Why is the action staying? The member sees this.' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({
            title: (status === 'accepted' ? 'Accept' : 'Reject') + ' the report from @' + a.username,
            body: [field('YOUR REPLY (REQUIRED)', reply, status === 'accepted' ? 'Accepting only records your decision and tells them. Lift the ban or suspension from their profile.' : null), err],
            buttons: [{ text: 'Cancel' }, { text: status === 'accepted' ? 'Accept report' : 'Reject report', kind: status === 'accepted' ? '' : 'danger', primary: true, onClick: async function () {
                err.hidden = true;
                if (reply.value.trim().length < 3) { err.textContent = ERR.reason_required; err.hidden = false; return false; }
                var r = await rpc('admin_appeal_resolve', { p_id: a.id, p_status: status, p_response: reply.value.trim() });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not save that.'; err.hidden = false; return false; }
                toast('Reply sent to the member');
                done();
            } }]
        });
    }

    function sanctionDetailsDialog(s, done) {
        var note = el('input', { class: 'ad-field', maxlength: '500', placeholder: 'Shown to the member on their ban screen' });
        var ev = el('textarea', { class: 'ad-area', maxlength: '500', placeholder: 'What did you review? Adds a new Evidence ID.' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({
            title: 'Add to this ' + String(KIND_LABEL[s.kind] || s.kind).toLowerCase(),
            body: [field('MODERATOR NOTE (OPTIONAL)', note, 'Replaces the current note.'), field('NEW EVIDENCE (OPTIONAL)', ev), err],
            buttons: [{ text: 'Cancel' }, { text: 'Save', primary: true, onClick: async function () {
                err.hidden = true;
                if (!note.value.trim() && !ev.value.trim()) { err.textContent = 'Fill in at least one of the two.'; err.hidden = false; return false; }
                var r = await rpc('admin_set_sanction_details', { p_sanction: s.id, p_mod_note: note.value.trim() || null, p_evidence: ev.value.trim() || null });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not save that.'; err.hidden = false; return false; }
                toast(r.evidence_ref ? 'Saved. Evidence ID ' + r.evidence_ref : 'Saved');
                done();
            } }]
        });
    }

    function hubHideDialog(pj, hide, done) {
        var reason = el('textarea', { class: 'ad-area', maxlength: '300', placeholder: hide ? 'Why is it coming off the hub? The member sees this.' : 'Why is it coming back?' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({
            title: (hide ? 'Hide from the hub: ' : 'Restore to the hub: ') + pj.title,
            body: [el('p', { class: 'ad-help', text: 'The project stays on the member\u2019s profile. This only controls the Projects Hub.' }), field('REASON (REQUIRED)', reason), err],
            buttons: [{ text: 'Cancel' }, { text: hide ? 'Hide project' : 'Restore project', kind: hide ? 'danger' : '', primary: true, onClick: async function () {
                err.hidden = true;
                if (reason.value.trim().length < 3) { err.textContent = ERR.reason_required; err.hidden = false; return false; }
                var r = await rpc('admin_hub_hide', { p_project: pj.id, p_hidden: hide, p_reason: reason.value.trim() });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not change that.'; err.hidden = false; return false; }
                toast(hide ? 'Hidden from the hub' : 'Restored to the hub');
                done();
            } }]
        });
    }

    /* ----- role editor (4 categories) ----- */
    function rolesPanel(p, current, done) {
        var wrap = el('section', { class: 'ad-panel' }, el('div', { class: 'ad-panel-head' }, el('h2', { text: 'Roles and badges' })));
        var have = new Set(current);

        CATS.forEach(function (cat) {
            var defs = S.defs.filter(function (d) { return d.category === cat.id && d.active; });
            var inputs = [];
            var list = el('div', { class: 'ad-roles', role: cat.multi ? 'group' : 'radiogroup', 'aria-label': cat.title });
            var groupName = 'role-' + cat.id;

            function option(def, none) {
                var id = none ? '' : def.id;
                var grantable = none ? true : RANK[def.min_grant] <= rank();
                var checked = none ? !defs.some(function (d) { return have.has(d.id); }) : have.has(def.id);
                var input = el('input', { type: cat.multi ? 'checkbox' : 'radio', name: groupName, value: id, checked: checked, disabled: !grantable && !none });
                if (none && !grantable) input.disabled = true;
                inputs.push(input);
                input.addEventListener('change', function () { dirty(); });
                return el('label', { class: 'ad-role-opt' + (input.disabled ? ' is-disabled' : ''), title: input.disabled ? 'Only a higher staff level can hand this role out' : '' },
                    input, el('span', { class: 'ad-role-ico' }, none ? '\u2205' : iconNode(def)), el('span', { text: none ? 'NONE' : def.name }));
            }

            if (!cat.multi) list.appendChild(option(null, true));
            defs.forEach(function (d) { list.appendChild(option(d, false)); });

            var reason = el('input', { class: 'ad-field', placeholder: 'Reason for this change (required)', maxlength: '500' });
            var save = el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'SAVE ' + cat.title.toUpperCase(), disabled: true });
            var clearBtn = cat.multi ? el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'SET TO NONE', onclick: function () { inputs.forEach(function (i) { if (!i.disabled) i.checked = false; }); dirty(); } }) : null;

            function selected() { return inputs.filter(function (i) { return i.checked && i.value; }).map(function (i) { return i.value; }); }
            function dirty() {
                var now = selected().sort().join(','), was = defs.filter(function (d) { return have.has(d.id); }).map(function (d) { return d.id; }).sort().join(',');
                save.disabled = now === was;
            }

            save.addEventListener('click', async function () {
                if (reason.value.trim().length < 3) { toast(ERR.reason_required, true); reason.focus(); return; }
                save.disabled = true;
                var r = await rpc('admin_set_roles', { p_user: p.id, p_category: cat.id, p_role_ids: selected(), p_reason: reason.value.trim() });
                if (r.ok) { toast(cat.title + ' updated'); done(); } else save.disabled = false;
            });

            wrap.appendChild(el('div', { class: 'ad-cat' }, el('h3', { text: cat.title + (cat.multi ? '' : ' (one at a time)') }), list,
                el('div', { class: 'ad-cat-foot' }, reason, clearBtn, save)));
        });
        return wrap;
    }

    /* ----------------------------------------------------------------------
       ROLES LIBRARY (owners edit icons, names, colors)
       ---------------------------------------------------------------------- */
    /* ----------------------------------------------------------------------
       SEASONS: themes for the whole site (Halloween, Christmas, ...)
       Automatic by date, forced on, or off. Everything staff change here is audit logged.
       ---------------------------------------------------------------------- */
    function seasonLocal(iso) { if (!iso) return ''; var d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

    async function viewSeasons(root, token) {
        add(root, el('p', { class: 'ad-help', text: 'Loading...' }));
        var d = await rpc('admin_seasons_get');
        if (stale(token)) return;
        clear(root);
        if (!d || d.ok === false) { add(root, el('p', { class: 'ad-help', text: 'Could not load seasons. Is supabase-seasons.sql installed?' })); return; }

        var SS = window.SpecSeasons, THEMES = SS ? SS.THEMES : {}, ids = Object.keys(THEMES);
        var st = d.settings || {}, now = d.now || {}, previewing = !!(SS && SS.isPreview());
        function again() { viewSeasons(clear($('adView')), token); }
        function themeName(id) { return THEMES[id] ? THEMES[id].emoji + ' ' + THEMES[id].name : id; }
        if (!SS) add(root, el('p', { class: 'ad-help', text: 'seasons.js is not loaded on this page, so previews are off. Add <script src="seasons.js"></script> to admin.html.' }));

        // ---- right now ----
        var live = now.theme ? THEMES[now.theme] : null;
        var nowText = !now.theme ? (st.mode === 'off' ? 'Seasonal themes are turned off.' : 'Nothing is scheduled right now.')
            : now.source === 'schedule' ? 'Following the schedule, until ' + fmt(now.ends_at) + '.' : 'Forced on by staff until someone changes it.';
        add(root, panel('Right now', el('div', { class: 'ad-now' },
            el('div', { class: 'ad-now-emoji', text: live ? live.emoji : '\u2600\uFE0F' }),
            el('div', {},
                el('div', { class: 'ad-row-title', text: live ? live.name : 'Normal site' }),
                el('div', { class: 'ad-row-sub', text: nowText }),
                el('div', { class: 'ad-row-sub', text: 'Last changed ' + ago(st.updated_at) })),
            el('div', { class: 'ad-row-end' }, pill(now.theme ? 'LIVE' : 'OFF', now.theme ? 'ok' : null), ' ', pill('Effects ' + (st.effects ? 'on' : 'off'), st.effects ? null : 'warn'))),
            previewing ? el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Stop preview', onclick: function () { SS.endPreview(); again(); } }) : null));

        // ---- control ----
        var mode = st.mode || 'auto';
        var modes = el('div', { class: 'ad-modes' });
        var themeSel = el('select', { class: 'ad-select', 'aria-label': 'Theme to force on' }, ids.map(function (id) { return el('option', { value: id, text: themeName(id) }); }));
        themeSel.value = st.forced_theme && THEMES[st.forced_theme] ? st.forced_theme : (ids[0] || '');
        [['auto', 'Automatic', 'Follow the schedule below. Themes switch on and off by themselves.'], ['theme', 'Always on', 'Force one theme for everyone until you change it.'], ['off', 'Off', 'No seasonal theme anywhere.']].forEach(function (m) {
            var r = el('input', { type: 'radio', name: 'ssmode', value: m[0] }); r.checked = mode === m[0];
            modes.appendChild(el('label', { class: 'ad-role-opt' }, r, el('span', {}, el('b', { text: m[1] }), el('br'), el('span', { class: 'ad-row-sub', text: m[2] })), m[0] === 'theme' ? themeSel : null));
        });
        var fx = el('input', { type: 'checkbox' }); fx.checked = st.effects !== false;
        var inten = el('select', { class: 'ad-select', 'aria-label': 'Effect intensity' }, [['low', 'Low (calmer, lighter)'], ['normal', 'Normal'], ['high', 'High (more particles)']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        inten.value = st.intensity || 'normal';
        var reason = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
        add(root, panel('Control', el('div', {},
            modes,
            el('label', { class: 'ad-role-opt' }, fx, el('span', {}, el('b', { text: 'Animated effects' }), el('br'), el('span', { class: 'ad-row-sub', text: 'Particles, bats, snow, fireworks and moving decorations. Off keeps just the colors and still decorations.' }))),
            field('Effect intensity', inten, 'How many particles. Phones and weaker computers always get fewer automatically.'),
            field('Reason', reason),
            el('div', { style: 'margin-top:14px' },
                el('button', { type: 'button', class: 'ad-btn', text: 'Save changes', onclick: async function (e) {
                    var m = (document.querySelector('input[name="ssmode"]:checked') || {}).value || 'auto';
                    if (m === 'theme' && !themeSel.value) { toast('Pick a theme.', true); return; }
                    e.target.disabled = true;
                    var r = await rpc('admin_seasons_set', { p_mode: m, p_theme: m === 'theme' ? themeSel.value : null, p_effects: fx.checked, p_intensity: inten.value, p_reason: reason.value.trim() || null });
                    e.target.disabled = false;
                    if (r && r.ok) { toast('Saved. Visitors get it within a few minutes.'); if (SS && !previewing) SS.refresh(); again(); }
                } })))));

        // ---- theme gallery ----
        var grid = el('div', { class: 'ad-themes' });
        ids.forEach(function (id) {
            var t = THEMES[id];
            grid.appendChild(el('div', { class: 'ad-theme' + (now.theme === id ? ' is-live' : '') },
                el('div', { class: 'ad-theme-emoji', text: t.emoji }), el('h3', { text: t.name }), el('p', { text: t.blurb }),
                el('div', { class: 'ad-theme-btns' },
                    SS ? el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Preview here', onclick: function () { SS.preview(id, { intensity: inten.value }); toast('Previewing ' + t.name + ' on this page only. Nobody else sees it.'); again(); } }) : null,
                    el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Turn on for everyone', onclick: function () {
                        dialog({ title: 'Turn on ' + t.name + '?', body: el('p', { class: 'ad-help', text: 'Every visitor will see the ' + t.name + ' theme until you switch it back to automatic or off.' }),
                            buttons: [{ text: 'Cancel' }, { text: 'Turn on', primary: true, onClick: async function () {
                                var r = await rpc('admin_seasons_set', { p_mode: 'theme', p_theme: id, p_effects: fx.checked, p_intensity: inten.value, p_reason: 'Forced ' + t.name + ' on' });
                                if (!(r && r.ok)) return false;
                                toast(t.name + ' is on for everyone.'); if (SS && !previewing) SS.refresh(); again();
                            } }] });
                    } }))));
        });
        add(root, panel('Themes', grid, previewing ? pill('Previewing on this page only', 'warn') : null));

        // ---- schedule ----
        function editEvent(ev) {
            var isNew = !ev, sel = el('select', { class: 'ad-select' }, ids.map(function (id) { return el('option', { value: id, text: themeName(id) }); }));
            sel.value = ev && THEMES[ev.theme] ? ev.theme : ids[0];
            var label = el('input', { class: 'ad-field', type: 'text', maxlength: '60', value: ev ? ev.label || '' : '', placeholder: 'Halloween 2027' });
            var s = el('input', { class: 'ad-field', type: 'datetime-local', value: ev ? seasonLocal(ev.starts_at) : '' });
            var e = el('input', { class: 'ad-field', type: 'datetime-local', value: ev ? seasonLocal(ev.ends_at) : '' });
            var on = el('input', { type: 'checkbox' }); on.checked = ev ? ev.enabled : true;
            dialog({ title: isNew ? 'Add event' : 'Edit event',
                body: el('div', {}, field('Theme', sel), field('Name (only staff see it)', label), field('Starts (your local time)', s), field('Ends (your local time)', e),
                    el('label', { class: 'ad-role-opt' }, on, el('span', { text: 'Enabled' }))),
                buttons: [{ text: 'Cancel' }, { text: 'Save', primary: true, onClick: async function () {
                    if (!s.value || !e.value) { toast('Pick a start and an end.', true); return false; }
                    var r = await rpc('admin_seasons_schedule_save', { p_id: ev ? ev.id : null, p_theme: sel.value, p_label: label.value.trim() || null, p_starts: new Date(s.value).toISOString(), p_ends: new Date(e.value).toISOString(), p_enabled: on.checked });
                    if (!(r && r.ok)) return false;
                    toast('Event saved.'); if (SS && !previewing) SS.refresh(); again();
                } }] });
        }
        var list = el('div', { class: 'ad-list' }), nowMs = Date.now();
        (d.schedule || []).forEach(function (ev) {
            var running = ev.enabled && Date.parse(ev.starts_at) <= nowMs && nowMs <= Date.parse(ev.ends_at), over = Date.parse(ev.ends_at) < nowMs;
            list.appendChild(el('div', { class: 'ad-row ad-evt' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: (ev.label || themeName(ev.theme)) }),
                    el('div', { class: 'ad-row-sub', text: themeName(ev.theme) + ' \u00B7 ' + fmt(ev.starts_at) + ' to ' + fmt(ev.ends_at) })),
                el('div', { class: 'ad-row-end' }, running ? pill('RUNNING', 'ok') : over ? pill('ENDED') : ev.enabled ? pill('UPCOMING', 'info') : pill('DISABLED', 'warn')),
                el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Edit', onclick: function () { editEvent(ev); } }),
                el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'Delete', onclick: function () {
                    dialog({ title: 'Delete this event?', body: el('p', { class: 'ad-help', text: (ev.label || themeName(ev.theme)) + ' will be removed from the schedule.' }),
                        buttons: [{ text: 'Cancel' }, { text: 'Delete', kind: 'danger', onClick: async function () {
                            var r = await rpc('admin_seasons_schedule_delete', { p_id: ev.id });
                            if (!(r && r.ok)) return false;
                            toast('Event deleted.'); if (SS && !previewing) SS.refresh(); again();
                        } }] });
                } })));
        });
        if (!(d.schedule || []).length) list.appendChild(el('p', { class: 'ad-help', text: 'No events yet. Add one and it will switch on by itself in Automatic mode.' }));
        add(root, panel('Schedule', list, el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Add event', onclick: function () { editEvent(null); } })));
    }

    /* ----------------------------------------------------------------------
       EVENTS: the NUKE EVENT (live and synced for every visitor)
       Launch now or schedule it, abort it, set timings + rewards, upload the music (mp3 / m4a, 15 MB max).
       Everything staff change here is audit logged.
       ---------------------------------------------------------------------- */
    var NUKE_MAX_BYTES = 15 * 1024 * 1024;
    var NUKE_SLOTS = [
        ['ost', 'Countdown music (loops)', 'Plays during the countdown, starting at the right spot for people who join late. Your OST goes here.'],
        ['alarm', 'Alarm blare (loops)', 'Plays during the whole countdown, on top of the music. Optional.'],
        ['boom', 'Explosion sound', 'Plays once at 0:00.'],
        ['after', 'Aftermath ambience (loops)', 'Optional. Plays during the dark 2 minutes.']
    ];
    var NUKE_ERR = { bad_countdown: 'Countdown must be 30 to 1800 seconds.', bad_aftermath: 'Aftermath must be 20 to 900 seconds.', bad_reward: 'Rewards must be 0 or more.', bad_volume: 'Volume is 0 to 100.', bad_audio_url: 'That audio link is not from the event-audio bucket.', bad_time: 'Pick a time at least 10 seconds from now.', event_overlap: 'Another nuke event is already scheduled around then.', not_active: 'That event is not running or scheduled any more.' };

    async function viewNukeEvent(root, token) {
        add(root, el('p', { class: 'ad-help', text: 'Loading...' }));
        var d = await rpc('admin_nuke_get');
        if (stale(token)) return;
        clear(root);
        if (!d || d.ok === false) { add(root, el('p', { class: 'ad-help', text: 'Could not load events. Is supabase-nuke.sql installed?' })); return; }

        var st = d.settings || {}, evs = d.events || [], nowMs = Date.parse(d.now) || Date.now();
        var cur = { ost: st.audio_ost || null, boom: st.audio_boom || null, after: st.audio_after || null, alarm: st.audio_alarm || null };
        function again() { viewEvents(clear($('adView')), token); }
        function phaseOf(e) {
            if (e.aborted_at) return ['ABORTED', 'warn'];
            var s = Date.parse(e.starts_at), b = Date.parse(e.boom_at), en = Date.parse(e.ends_at);
            if (nowMs < s) return ['SCHEDULED', 'info'];
            if (nowMs < b) return ['COUNTDOWN', 'ok'];
            if (nowMs < en) return ['AFTERMATH', 'ok'];
            return ['DONE', null];
        }
        function nerr(r) { return NUKE_ERR[r && r.error] || null; }

        // ---- right now ----
        var active = evs.find(function (e) { return !e.aborted_at && Date.parse(e.ends_at) > nowMs; });
        var nowBody;
        if (active) {
            var ph = phaseOf(active);
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\u2622\uFE0F' }),
                el('div', {},
                    el('div', { class: 'ad-row-title', text: active.label || 'Nuke event' }),
                    el('div', { class: 'ad-row-sub', text: 'Countdown ' + fmt(active.starts_at) + '  \u00B7  impact ' + fmt(active.boom_at) + '  \u00B7  over ' + fmt(active.ends_at) })),
                el('div', { class: 'ad-row-end' }, pill(ph[0], ph[1]), ' ',
                    el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'ABORT', onclick: function () {
                        var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (saved in the audit log)' });
                        dialog({ title: 'Abort the nuke event?', body: el('div', {}, el('p', { class: 'ad-help', text: 'Every open page cleans itself up within a few seconds and the site goes back to normal. Nobody gets rewards after this.' }), field('Reason', why)),
                            buttons: [{ text: 'Keep it running' }, { text: 'Abort now', kind: 'danger', onClick: async function () {
                                var r = await rpc('admin_nuke_abort', { p_event: active.id, p_reason: why.value.trim() || null });
                                if (!(r && r.ok)) { if (nerr(r)) toast(nerr(r), true); return false; }
                                toast('Event aborted.'); again();
                            } }] });
                    } })));
        } else {
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\u2600\uFE0F' }),
                el('div', {}, el('div', { class: 'ad-row-title', text: 'No nuke event running' }), el('div', { class: 'ad-row-sub', text: 'Launch one now, or schedule it for later. Preview it first: nobody else sees the preview.' })),
                el('div', { class: 'ad-row-end' }, pill('IDLE')));
        }
        function launchDialog(scheduled) {
            var label = el('input', { class: 'ad-field', type: 'text', maxlength: '60', placeholder: 'Name for the ending screen (optional)' });
            var when = el('input', { class: 'ad-field', type: 'datetime-local' });
            var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
            var mins = Math.round((st.countdown_s || 180) / 60 * 10) / 10, aft = Math.round((st.aftermath_s || 120) / 60 * 10) / 10;
            dialog({ title: scheduled ? 'Schedule the nuke event' : 'Launch the nuke event now?',
                body: el('div', {}, el('p', { class: 'ad-help', text: (scheduled ? 'It starts at the time you pick. ' : 'The countdown starts in about 45 seconds so every open page can catch it. ') + 'Countdown ' + mins + ' min, aftermath ' + aft + ' min. Rewards: ' + (st.reward_xp || 0) + ' XP and ' + (st.reward_ac || 0) + ' APEX Credits.' }),
                    field('Name', label), scheduled ? field('Starts (your local time)', when) : null, field('Reason', why)),
                buttons: [{ text: 'Cancel' }, { text: scheduled ? 'Schedule' : 'LAUNCH', primary: true, onClick: async function () {
                    if (scheduled && !when.value) { toast('Pick a start time.', true); return false; }
                    var r = await rpc('admin_nuke_launch', { p_starts: scheduled ? new Date(when.value).toISOString() : null, p_label: label.value.trim() || null, p_reason: why.value.trim() || null });
                    if (!(r && r.ok)) { if (nerr(r)) toast(nerr(r), true); return false; }
                    toast(scheduled ? 'Scheduled.' : 'Launching. Countdown starts in about 45 seconds.'); again();
                } }] });
        }
        add(root, panel('Nuke event', nowBody, el('div', { class: 'ad-row-end' },
            el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Preview (new tab)', onclick: function () { window.open('index.html#nuke-preview', '_blank', 'noopener'); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Schedule', onclick: function () { launchDialog(true); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Launch now', onclick: function () { launchDialog(false); } }))));

        // ---- settings ----
        function num(v, min, max, step) { return el('input', { class: 'ad-field', type: 'number', min: String(min), max: String(max), step: String(step || 1), value: String(v) }); }
        var iCount = num(st.countdown_s != null ? st.countdown_s : 180, 30, 1800), iAft = num(st.aftermath_s != null ? st.aftermath_s : 120, 20, 900);
        var iXp = num(st.reward_xp || 0, 0, 1000000), iAc = num(st.reward_ac || 0, 0, 1000000), iVol = num(st.volume != null ? st.volume : 80, 0, 100);
        var iSpare = el('input', { type: 'checkbox' }); iSpare.checked = st.spare_survivors !== false;
        var iWhy = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
        async function saveAll(reasonText, quiet) {
            var r = await rpc('admin_nuke_settings_set', {
                p_countdown: parseInt(iCount.value, 10), p_aftermath: parseInt(iAft.value, 10), p_xp: parseInt(iXp.value, 10) || 0, p_ac: parseInt(iAc.value, 10) || 0,
                p_spare: iSpare.checked, p_volume: parseInt(iVol.value, 10) || 0, p_ost: cur.ost, p_boom: cur.boom, p_after: cur.after, p_alarm: cur.alarm,
                p_reason: reasonText || iWhy.value.trim() || null });
            if (r && r.ok) { if (!quiet) toast('Saved. Applies to the NEXT launch (a running event keeps its own settings).'); return true; }
            if (nerr(r)) toast(nerr(r), true);
            return false;
        }
        add(root, panel('Settings', el('div', {},
            field('Countdown (seconds)', iCount, '180 = 3 minutes. The T-1:00 announcement and the red/pink/white pulse at 0:15 happen automatically.'),
            field('Aftermath (seconds)', iAft, '120 = 2 minutes of darkness before everything returns.'),
            field('Reward for surviving: XP', iXp, 'Paid by the database to members who really finish the tapper (100/100).'),
            field('Reward for surviving: APEX Credits', iAc),
            field('Music volume (0 to 100)', iVol),
            el('label', { class: 'ad-role-opt' }, iSpare, el('span', {}, el('b', { text: 'Spare survivors from the wreck' }), el('br'), el('span', { class: 'ad-row-sub', text: 'On: people who finished the pad watch the aftermath from a "bunker" and the site stays readable for them. Off: everyone sees the destruction.' }))),
            field('Reason', iWhy),
            el('div', { style: 'margin-top:14px' }, el('button', { type: 'button', class: 'ad-btn', text: 'Save settings', onclick: async function (e) { e.target.disabled = true; await saveAll(); e.target.disabled = false; } })))));

        // ---- audio ----
        var audioList = el('div', { class: 'ad-list' });
        NUKE_SLOTS.forEach(function (slot) {
            var key = slot[0], url = cur[key];
            var file = el('input', { type: 'file', accept: '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a', style: 'display:none' });
            var player = url ? el('audio', { controls: 'controls', preload: 'none', src: url, style: 'width:100%;max-width:420px;margin-top:6px' }) : null;
            var up = el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: url ? 'Replace' : 'Upload', onclick: function () { file.click(); } });
            file.addEventListener('change', async function () {
                var f = file.files && file.files[0];
                file.value = '';
                if (!f) return;
                var ext = ((f.name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
                if (ext !== 'mp3' && ext !== 'm4a') { toast('Only .mp3 or .m4a files.', true); return; }
                if (f.size > NUKE_MAX_BYTES) { toast('That file is ' + (f.size / 1048576).toFixed(1) + ' MB. The limit is 15 MB. Export it smaller (MP3 around 160 kbps).', true); return; }
                up.disabled = true; up.textContent = 'Uploading...';
                var path = 'nuke/' + key + '-' + Date.now() + '.' + ext;
                var res = await sb.storage.from('event-audio').upload(path, f, { contentType: ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4', cacheControl: '31536000', upsert: false });
                if (res.error) { up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; toast('Upload failed: ' + (res.error.message || 'unknown error') + '. Is supabase-nuke.sql installed and the console unlocked?', true); return; }
                var pub = sb.storage.from('event-audio').getPublicUrl(path);
                cur[key] = pub && pub.data && pub.data.publicUrl;
                var ok = await saveAll('Audio uploaded: ' + slot[1], true);
                if (ok) { toast('Uploaded and saved. The next launch uses it.'); again(); } else { up.disabled = false; up.textContent = 'Upload'; }
            });
            var rm = url ? el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'Remove', onclick: async function () {
                cur[key] = null;
                if (await saveAll('Audio removed: ' + slot[1], true)) { toast('Removed.'); again(); }
            } }) : null;
            audioList.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: slot[1] }), el('div', { class: 'ad-row-sub', text: url ? 'Uploaded' : (key === 'boom' ? 'Nothing uploaded. A built-in boom plays instead.' : 'Nothing uploaded. Nothing plays for this one.') }), el('div', { class: 'ad-row-sub', text: slot[2] }), player),
                el('div', { class: 'ad-row-end' }, up, ' ', rm, file)));
        });
        add(root, panel('Audio (mp3 or m4a, 15 MB each)', audioList, pill('Sound only plays for people who turned sound on', 'info')));

        // ---- history ----
        var hist = el('div', { class: 'ad-list' });
        evs.forEach(function (e) {
            var ph = phaseOf(e);
            hist.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: e.label || 'Nuke event' }),
                    el('div', { class: 'ad-row-sub', text: fmt(e.starts_at) + ' to ' + fmt(e.ends_at) + '  \u00B7  ' + (e.players || 0) + ' signed in, ' + (e.alive || 0) + ' ALIVE, ' + Math.max(0, (e.players || 0) - (e.alive || 0)) + ' MISSING' })),
                el('div', { class: 'ad-row-end' }, pill(ph[0], ph[1]))));
        });
        if (!evs.length) hist.appendChild(el('p', { class: 'ad-help', text: 'No events yet.' }));
        add(root, panel('History', hist));
    }

    /* ----------------------------------------------------------------------
       EVENTS: BLACKOUT (live and synced for every visitor)
       Launch now or schedule it, abort it, tune the goal / red lights / rewards, upload the OSTs (mp3 / m4a, 15 MB max).
       Everything staff change here is audit logged.
       ---------------------------------------------------------------------- */
    var BO_SLOTS = [
        ['ost', 'Main OST (loops)', 'Plays the whole blackout, starting at the right spot for people who join late. Your main Blackout OST goes here.'],
        ['danger', 'Red light danger loop (loops)', 'Optional. Starts silent and fades in as the red light on the page you are on gets stronger, then fades back out.'],
        ['gen', 'Generator online sting', 'Optional. Plays once when you fix a generator. A built-in sound plays if empty.'],
        ['dead', 'Terminated sting', 'Optional. Plays once when the red light terminates you.'],
        ['win', 'Power restored sting', 'Optional. Plays once when the community reaches the goal.'],
        ['fail', 'Blackout failed sting', 'Optional. Plays once when time runs out before the goal.']
    ];
    var BO_ERR = { bad_value: 'One of the numbers is not a number.', bad_duration: 'Duration must be 120 to 3600 seconds.', bad_goal: 'Goal must be 1 to 5000 generators.', bad_red_level: 'Red light level is 1 to 5.', bad_kill: 'Seconds in strong red must be 2 to 15.', bad_hint: 'Hint delay must be 0 to 1800 seconds (0 = never).', bad_cooldown: 'Cooldown must be 0 to 300 seconds.', bad_volume: 'Volume is 0 to 100.', bad_reward: 'Rewards must be 0 or more.', bad_pages: 'Add 2 to 30 pages. Page names can only use lowercase letters, numbers, - and _ (index, projects, community ...).', bad_per_player: 'Generators per player must be 1 to 30.', bad_audio_url: 'That audio link is not from the event-audio bucket.', bad_time: 'Pick a time at least 10 seconds from now.', event_overlap: 'Another event (blackout, nuke or glitchware) is already scheduled around then.', not_active: 'That event is not running or scheduled any more.' };

    async function viewBlackout(root, token) {
        add(root, el('p', { class: 'ad-help', text: 'Loading...' }));
        var d = await rpc('admin_blackout_get', {}, { quiet: true });
        if (stale(token)) return;
        clear(root);
        if (!d || d.ok === false) { add(root, el('p', { class: 'ad-help', text: 'Could not load Blackout. Is supabase-blackout.sql installed?' })); return; }

        var st = d.settings || {}, evs = d.events || [], nowMs = Date.parse(d.now) || Date.now();
        var cur = { ost: st.audio_ost || null, danger: st.audio_danger || null, gen: st.audio_gen || null, dead: st.audio_dead || null, win: st.audio_win || null, fail: st.audio_fail || null };
        function again() { viewEvents(clear($('adView')), token); }
        function berr(r) { return BO_ERR[r && r.error] || null; }
        function phaseOf(e) {
            if (e.aborted_at) return ['ABORTED', 'warn'];
            var s = Date.parse(e.starts_at), en = Date.parse(e.ends_at);
            if (nowMs < s) return ['SCHEDULED', 'info'];
            if (nowMs >= en) return e.won_at ? ['WON', 'ok'] : ['FAILED', null];
            return e.won_at ? ['POWER RESTORED', 'ok'] : ['BLACKOUT', 'ok'];
        }

        // ---- right now ----
        var active = evs.find(function (e) { return !e.aborted_at && Date.parse(e.ends_at) > nowMs; });
        var nowBody;
        if (active) {
            var ph = phaseOf(active);
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\uD83D\uDD26' }),
                el('div', {},
                    el('div', { class: 'ad-row-title', text: active.label || 'Blackout' }),
                    el('div', { class: 'ad-row-sub', text: 'Lights out ' + fmt(active.starts_at) + '  \u00B7  ends ' + fmt(active.ends_at) + '  \u00B7  ' + (active.fixed_total || 0) + '/' + active.goal + ' generators, ' + (active.players || 0) + ' players, ' + Math.max(0, (active.players || 0) - (active.alive || 0)) + ' terminated' })),
                el('div', { class: 'ad-row-end' }, pill(ph[0], ph[1]), ' ',
                    el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'ABORT', onclick: function () {
                        var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (saved in the audit log)' });
                        dialog({ title: 'Abort the blackout?', body: el('div', {}, el('p', { class: 'ad-help', text: 'Every open page cleans itself up within a few seconds and the site goes back to normal. Nobody gets rewards after this.' }), field('Reason', why)),
                            buttons: [{ text: 'Keep it running' }, { text: 'Abort now', kind: 'danger', onClick: async function () {
                                var r = await rpc('admin_blackout_abort', { p_event: active.id, p_reason: why.value.trim() || null }, { quiet: true });
                                if (!(r && r.ok)) { toast(berr(r) || 'Could not abort that one.', true); return false; }
                                toast('Event aborted.'); again();
                            } }] });
                    } })));
        } else {
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\uD83D\uDCA1' }),
                el('div', {}, el('div', { class: 'ad-row-title', text: 'No blackout running' }), el('div', { class: 'ad-row-sub', text: 'Launch one now, or schedule it for later. Preview it first: nobody else sees the preview.' })),
                el('div', { class: 'ad-row-end' }, pill('IDLE')));
        }
        function launchDialog(scheduled) {
            var label = el('input', { class: 'ad-field', type: 'text', maxlength: '60', placeholder: 'Name for the ending screen (optional)' });
            var when = el('input', { class: 'ad-field', type: 'datetime-local' });
            var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
            var mins = Math.round((st.duration_s || 600) / 60 * 10) / 10;
            dialog({ title: scheduled ? 'Schedule the blackout' : 'Launch the blackout now?',
                body: el('div', {}, el('p', { class: 'ad-help', text: (scheduled ? 'Lights go out at the time you pick. ' : 'Lights go out in about 45 seconds so every open page can catch it. ') + 'Goal ' + (st.goal || 50) + ' generators in ' + mins + ' min, ' + (st.per_player_max || 4) + ' per player, red light level ' + (st.red_level || 3) + '.' }),
                    field('Name', label), scheduled ? field('Starts (your local time)', when) : null, field('Reason', why)),
                buttons: [{ text: 'Cancel' }, { text: scheduled ? 'Schedule' : 'LAUNCH', primary: true, onClick: async function () {
                    if (scheduled && !when.value) { toast('Pick a start time.', true); return false; }
                    var r = await rpc('admin_blackout_launch', { p_starts: scheduled ? new Date(when.value).toISOString() : null, p_label: label.value.trim() || null, p_reason: why.value.trim() || null }, { quiet: true });
                    if (!(r && r.ok)) { toast(berr(r) || 'Could not launch. Is supabase-blackout.sql installed?', true); return false; }
                    toast(scheduled ? 'Scheduled.' : 'Launching. Lights go out in about 45 seconds.'); again();
                } }] });
        }

        // ---- settings ----
        function num(v, min, max) { return el('input', { class: 'ad-field', type: 'number', min: String(min), max: String(max), step: '1', value: String(v) }); }
        var iDur = num(st.duration_s != null ? st.duration_s : 600, 120, 3600), iGoal = num(st.goal != null ? st.goal : 50, 1, 5000), iMax = num(st.per_player_max != null ? st.per_player_max : 4, 1, 30);
        var iLvl = el('select', { class: 'ad-select' }, [['1', '1 - slow, gentle'], ['2', '2'], ['3', '3 - default'], ['4', '4'], ['5', '5 - three pages hot at once']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        iLvl.value = String(st.red_level || 3);
        var iKill = num(st.red_kill_s != null ? st.red_kill_s : 5, 2, 15), iHint = num(st.hint_after_s != null ? st.hint_after_s : 120, 0, 1800), iCool = num(st.fix_cooldown_s != null ? st.fix_cooldown_s : 15, 0, 300);
        var iPages = el('textarea', { class: 'ad-area', rows: '3', placeholder: 'index, projects, community, spectra-ai, settings' }); iPages.value = (st.pages || []).join(', ');
        var iGx = num(st.reward_gen_xp || 0, 0, 1000000), iGa = num(st.reward_gen_ac || 0, 0, 1000000), iWx = num(st.reward_win_xp || 0, 0, 1000000), iWa = num(st.reward_win_ac || 0, 0, 1000000), iVol = num(st.volume != null ? st.volume : 80, 0, 100);
        var iWhy = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
        function pagesList() { return iPages.value.split(/[\s,;]+/).map(function (x) { return x.trim().toLowerCase().replace(/\.html?$/, ''); }).filter(Boolean); }
        function cfgNow() {
            return { duration_s: parseInt(iDur.value, 10), goal: parseInt(iGoal.value, 10), per_player_max: parseInt(iMax.value, 10), red_level: parseInt(iLvl.value, 10), red_kill_s: parseInt(iKill.value, 10), hint_after_s: parseInt(iHint.value, 10),
                fix_cooldown_s: parseInt(iCool.value, 10), pages: pagesList(), reward_gen_xp: parseInt(iGx.value, 10) || 0, reward_gen_ac: parseInt(iGa.value, 10) || 0, reward_win_xp: parseInt(iWx.value, 10) || 0, reward_win_ac: parseInt(iWa.value, 10) || 0,
                volume: parseInt(iVol.value, 10) || 0, audio: { ost: cur.ost, danger: cur.danger, gen: cur.gen, dead: cur.dead, win: cur.win, fail: cur.fail } };
        }
        async function saveAll(reasonText, quiet) {
            var r = await rpc('admin_blackout_settings_set', { p_cfg: cfgNow(), p_reason: reasonText || iWhy.value.trim() || null }, { quiet: true });
            if (r && r.ok) { if (!quiet) toast('Saved. Applies to the NEXT launch (a running event keeps its own settings).'); return true; }
            toast(berr(r) || 'The server refused that. Is supabase-blackout.sql installed?', true);
            return false;
        }
        // the preview runs in another tab with your CURRENT OSTs and red light settings (even before you save)
        function openPreview() {
            try { var c = cfgNow(); localStorage.setItem('bo.preview.cfg', JSON.stringify({ audio: c.audio, red_level: c.red_level, red_kill_s: c.red_kill_s, volume: c.volume })); } catch (e) { /* storage blocked: the preview uses defaults */ }
            window.open('index.html#blackout-preview', '_blank', 'noopener');
        }
        add(root, panel('Blackout', nowBody, el('div', { class: 'ad-row-end' },
            el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Preview (new tab)', onclick: openPreview }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Schedule', onclick: function () { launchDialog(true); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Launch now', onclick: function () { launchDialog(false); } }))));

        add(root, panel('Settings', el('div', {},
            field('Goal (generators the whole community must fix)', iGoal, 'Players online x generators per player must be at least this, or nobody can win. 50 is great for a busy night, lower it when fewer people are around.'),
            field('Generators per player (max)', iMax, 'Each player gets their OWN random pages in their OWN order, one generator at a time. It can be higher than the number of pages below: pages then repeat (never twice in a row), and the pad hides in a new spot each time. 1 to 30.'),
            field('Blackout length (seconds)', iDur, '600 = 10 minutes. If the goal is reached early the power comes back and the event ends about 35 seconds later.'),
            field('Red light level', iLvl, 'Higher = shorter cycles and more pages glowing at once. The last minute always adds one more hot page. The first 25 seconds are always calm.'),
            field('Seconds in STRONG red before termination', iKill, '5 = five seconds. The glow and the flicker stages are free warnings: only the strong stage counts. Exposure drains when you leave.'),
            field('Hint after (seconds)', iHint, 'If a player is stuck this long, the HUD names the page that holds their next generator. 0 = never.'),
            field('Generator cooldown (seconds)', iCool, 'Minimum wait between two repairs by the same player.'),
            field('Pages with generators and red lights', iPages, 'Page file names without .html, separated by commas. Pages NOT listed here (like chats) are safe: no red light, no generators. Terminated players can still use chats.'),
            field('Reward per generator: XP', iGx, 'Paid by the database the moment a generator is really fixed.'),
            field('Reward per generator: APEX Credits', iGa),
            field('Power restored bonus: XP', iWx, 'Paid once to players who are still alive when the goal is reached and fixed at least one generator.'),
            field('Power restored bonus: APEX Credits', iWa),
            field('Music volume (0 to 100)', iVol),
            field('Reason', iWhy),
            el('div', { style: 'margin-top:14px' }, el('button', { type: 'button', class: 'ad-btn', text: 'Save settings', onclick: async function (e) { e.target.disabled = true; await saveAll(); e.target.disabled = false; } })))));

        // ---- audio ----
        var audioList = el('div', { class: 'ad-list' });
        BO_SLOTS.forEach(function (slot) {
            var key = slot[0], url = cur[key];
            var file = el('input', { type: 'file', accept: '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a', style: 'display:none' });
            var player = url ? el('audio', { controls: 'controls', preload: 'none', src: url, style: 'width:100%;max-width:420px;margin-top:6px' }) : null;
            var up = el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: url ? 'Replace' : 'Upload', onclick: function () { file.click(); } });
            file.addEventListener('change', async function () {
                var f = file.files && file.files[0];
                file.value = '';
                if (!f) return;
                var ext = ((f.name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
                if (ext !== 'mp3' && ext !== 'm4a') { toast('Only .mp3 or .m4a files.', true); return; }
                if (f.size > NUKE_MAX_BYTES) { toast('That file is ' + (f.size / 1048576).toFixed(1) + ' MB. The limit is 15 MB. Export it smaller (MP3 around 160 kbps).', true); return; }
                up.disabled = true; up.textContent = 'Uploading...';
                var path = 'blackout/' + key + '-' + Date.now() + '.' + ext;
                var res = await sb.storage.from('event-audio').upload(path, f, { contentType: ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4', cacheControl: '31536000', upsert: false });
                if (res.error) { up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; toast('Upload failed: ' + (res.error.message || 'unknown error') + '. Is supabase-nuke.sql installed and the console unlocked?', true); return; }
                var pub = sb.storage.from('event-audio').getPublicUrl(path);
                var old = cur[key];
                cur[key] = pub && pub.data && pub.data.publicUrl;
                var ok = await saveAll('Blackout audio uploaded: ' + slot[1], true);
                if (ok) { toast('Uploaded and saved. The next launch uses it.'); again(); } else { cur[key] = old; up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; }
            });
            var rm = url ? el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'Remove', onclick: async function () {
                var old = cur[key]; cur[key] = null;
                if (await saveAll('Blackout audio removed: ' + slot[1], true)) { toast('Removed.'); again(); } else cur[key] = old;
            } }) : null;
            audioList.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: slot[1] }), el('div', { class: 'ad-row-sub', text: url ? 'Uploaded' : 'Nothing uploaded.' }), el('div', { class: 'ad-row-sub', text: slot[2] }), player),
                el('div', { class: 'ad-row-end' }, up, ' ', rm, file)));
        });
        add(root, panel('OSTs (mp3 or m4a, 15 MB each)', audioList, pill('Sound only plays for people who turned sound on', 'info')));

        // ---- history ----
        var hist = el('div', { class: 'ad-list' });
        evs.forEach(function (e) {
            var p = phaseOf(e);
            hist.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: e.label || 'Blackout' }),
                    el('div', { class: 'ad-row-sub', text: fmt(e.starts_at) + ' to ' + fmt(e.ends_at) + '  \u00B7  ' + (e.fixed_total || 0) + '/' + e.goal + ' generators  \u00B7  ' + (e.players || 0) + ' signed in, ' + (e.alive || 0) + ' survived, ' + Math.max(0, (e.players || 0) - (e.alive || 0)) + ' terminated' })),
                el('div', { class: 'ad-row-end' }, pill(p[0], p[1]))));
        });
        if (!evs.length) hist.appendChild(el('p', { class: 'ad-help', text: 'No events yet.' }));
        add(root, panel('History', hist));
    }

    /* ----------------------------------------------------------------------
       EVENTS: KAWAII THEME (a "theme / chill" event, live and synced for every visitor)
       Launch now or schedule it, abort it, set the length / volume / sparkles, upload the music (mp3 / m4a, 15 MB max).
       No countdown and no rewards: the whole site turns white + pastel for everybody, then goes back to normal.
       Everything staff change here is audit logged.
       ---------------------------------------------------------------------- */
    var KK_ERR = { bad_value: 'One of the numbers is not a number.', bad_duration: 'Length must be 5 to 1440 minutes.', bad_volume: 'Volume is 0 to 100.', bad_sparkles: 'Sparkles is 0 to 3.', bad_audio_url: 'That music file is not from the event-audio bucket.', bad_time: 'Pick a start time at least 10 seconds from now.', event_overlap: 'There is already a kawaii event in that time slot.', not_active: 'That event is not running any more.' };

    async function viewKawaii(root, token) {
        add(root, el('p', { class: 'ad-help', text: 'Loading...' }));
        var d = await rpc('admin_kawaii_get', {}, { quiet: true });
        if (stale(token)) return;
        clear(root);
        if (!d || d.ok === false) { add(root, el('p', { class: 'ad-help', text: 'Could not load Kawaii. Is supabase-kawaii.sql installed?' })); return; }

        var st = d.settings || {}, evs = d.events || [], nowMs = Date.parse(d.now) || Date.now();
        var cur = { ost: st.audio_ost || null };
        function again() { viewEvents(clear($('adView')), token); }
        function kerr(r) { return KK_ERR[r && r.error] || null; }
        function phaseOf(e) {
            if (e.aborted_at) return ['ABORTED', 'warn'];
            var s = Date.parse(e.starts_at), en = Date.parse(e.ends_at);
            if (nowMs < s) return ['SCHEDULED', 'info'];
            if (nowMs >= en) return ['ENDED', null];
            return ['LIVE', 'ok'];
        }
        function lenText(sec) { var m = Math.round(sec / 60); return m >= 120 ? (Math.round(m / 6) / 10) + ' h' : m + ' min'; }

        // ---- right now ----
        var active = evs.find(function (e) { return !e.aborted_at && Date.parse(e.ends_at) > nowMs; });
        var nowBody;
        if (active) {
            var ph = phaseOf(active);
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\uD83C\uDF38' }),
                el('div', {},
                    el('div', { class: 'ad-row-title', text: active.label || 'Kawaii theme' }),
                    el('div', { class: 'ad-row-sub', text: 'Starts ' + fmt(active.starts_at) + '  \u00B7  ends ' + fmt(active.ends_at) + '  \u00B7  ' + lenText(active.duration_s) })),
                el('div', { class: 'ad-row-end' }, pill(ph[0], ph[1]), ' ',
                    el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'ABORT', onclick: function () {
                        var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (saved in the audit log)' });
                        dialog({ title: 'Abort the kawaii event?', body: el('div', {}, el('p', { class: 'ad-help', text: 'Every open page switches back to its normal look within a few seconds. Everybody keeps their own saved light / dark choice.' }), field('Reason', why)),
                            buttons: [{ text: 'Keep it running' }, { text: 'Abort now', kind: 'danger', onClick: async function () {
                                var r = await rpc('admin_kawaii_abort', { p_event: active.id, p_reason: why.value.trim() || null }, { quiet: true });
                                if (!(r && r.ok)) { toast(kerr(r) || 'Could not abort that one.', true); return false; }
                                toast('Event aborted.'); again();
                            } }] });
                    } })));
        } else {
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\uD83C\uDF80' }),
                el('div', {}, el('div', { class: 'ad-row-title', text: 'No kawaii event running' }), el('div', { class: 'ad-row-sub', text: 'Launch it now, or schedule it for later. Preview it first: nobody else sees the preview.' })),
                el('div', { class: 'ad-row-end' }, pill('IDLE')));
        }
        function launchDialog(scheduled) {
            var label = el('input', { class: 'ad-field', type: 'text', maxlength: '60', placeholder: 'Name (optional), shown in the welcome message' });
            var when = el('input', { class: 'ad-field', type: 'datetime-local' });
            var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
            dialog({ title: scheduled ? 'Schedule the kawaii event' : 'Launch the kawaii event now?',
                body: el('div', {}, el('p', { class: 'ad-help', text: (scheduled ? 'The whole site turns kawaii at the time you pick. ' : 'The whole site turns kawaii in about 30 seconds. ') + 'It lasts ' + lenText(st.duration_s || 3600) + ', sparkles level ' + (st.sparkles != null ? st.sparkles : 2) + (cur.ost ? ', with music.' : ', no music uploaded yet.') }),
                    field('Name', label), scheduled ? field('Starts (your local time)', when) : null, field('Reason', why)),
                buttons: [{ text: 'Cancel' }, { text: scheduled ? 'Schedule' : 'LAUNCH', primary: true, onClick: async function () {
                    if (scheduled && !when.value) { toast('Pick a start time.', true); return false; }
                    var r = await rpc('admin_kawaii_launch', { p_starts: scheduled ? new Date(when.value).toISOString() : null, p_label: label.value.trim() || null, p_reason: why.value.trim() || null }, { quiet: true });
                    if (!(r && r.ok)) { toast(kerr(r) || 'Could not launch. Is supabase-kawaii.sql installed?', true); return false; }
                    toast(scheduled ? 'Scheduled.' : 'Launching. The site turns kawaii in about 30 seconds.'); again();
                } }] });
        }

        // ---- settings ----
        function num(v, min, max, step) { return el('input', { class: 'ad-field', type: 'number', min: String(min), max: String(max), step: String(step || 1), value: String(v) }); }
        var iLen = num(Math.round((st.duration_s != null ? st.duration_s : 3600) / 60), 5, 1440);
        var iVol = num(st.volume != null ? st.volume : 60, 0, 100);
        var iSpk = el('select', { class: 'ad-select' }, [['0', '0 - none'], ['1', '1 - a few'], ['2', '2 - default'], ['3', '3 - lots']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        iSpk.value = String(st.sparkles != null ? st.sparkles : 2);
        var iWhy = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
        function cfgNow() {
            return { duration_s: Math.round((parseFloat(iLen.value) || 0) * 60), volume: parseInt(iVol.value, 10), sparkles: parseInt(iSpk.value, 10), audio: { ost: cur.ost } };
        }
        async function saveAll(reasonText, quiet) {
            var r = await rpc('admin_kawaii_settings_set', { p_cfg: cfgNow(), p_reason: reasonText || iWhy.value.trim() || null }, { quiet: true });
            if (r && r.ok) { if (!quiet) toast('Saved. Applies to the NEXT launch (a running event keeps its own settings).'); return true; }
            toast(kerr(r) || 'The server refused that. Is supabase-kawaii.sql installed?', true);
            return false;
        }
        // the preview runs in another tab with your CURRENT music, volume and sparkles (even before you save)
        function openPreview() {
            try { var c = cfgNow(); localStorage.setItem('kk.preview.cfg', JSON.stringify({ audio: c.audio, volume: c.volume, sparkles: c.sparkles })); } catch (e) { /* storage blocked: the preview uses defaults */ }
            window.open('index.html#kawaii-preview', '_blank', 'noopener');
        }
        add(root, panel('Kawaii theme', nowBody, el('div', { class: 'ad-row-end' },
            el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Preview (new tab)', onclick: openPreview }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Schedule', onclick: function () { launchDialog(true); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Launch now', onclick: function () { launchDialog(false); } }))));

        add(root, panel('Settings', el('div', {},
            field('Event length (minutes)', iLen, '60 = one hour, 1440 = a full day. The site goes back to normal by itself when the time is up.'),
            field('Sparkles', iSpk, 'Floating hearts and stars. Visitors with reduce motion on never see them.'),
            field('Music volume (0 to 100)', iVol, 'Visitors also get their own volume slider and mute button.'),
            field('Reason', iWhy),
            el('div', { style: 'margin-top:14px' }, el('button', { type: 'button', class: 'ad-btn', text: 'Save settings', onclick: async function (e) { e.target.disabled = true; await saveAll(); e.target.disabled = false; } })))));

        // ---- music ----
        var audioList = el('div', { class: 'ad-list' });
        (function () {
            var key = 'ost', url = cur[key], title = 'Kawaii site music (loops)';
            var file = el('input', { type: 'file', accept: '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a', style: 'display:none' });
            var player = url ? el('audio', { controls: 'controls', preload: 'none', src: url, style: 'width:100%;max-width:420px;margin-top:6px' }) : null;
            var up = el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: url ? 'Replace' : 'Upload', onclick: function () { file.click(); } });
            file.addEventListener('change', async function () {
                var f = file.files && file.files[0];
                file.value = '';
                if (!f) return;
                var ext = ((f.name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
                if (ext !== 'mp3' && ext !== 'm4a') { toast('Only .mp3 or .m4a files.', true); return; }
                if (f.size > NUKE_MAX_BYTES) { toast('That file is ' + (f.size / 1048576).toFixed(1) + ' MB. The limit is 15 MB. Export it smaller (MP3 around 160 kbps).', true); return; }
                up.disabled = true; up.textContent = 'Uploading...';
                var path = 'kawaii/' + key + '-' + Date.now() + '.' + ext;
                var res = await sb.storage.from('event-audio').upload(path, f, { contentType: ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4', cacheControl: '31536000', upsert: false });
                if (res.error) { up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; toast('Upload failed: ' + (res.error.message || 'unknown error') + '. Is supabase-nuke.sql installed and the console unlocked?', true); return; }
                var pub = sb.storage.from('event-audio').getPublicUrl(path);
                var old = cur[key];
                cur[key] = pub && pub.data && pub.data.publicUrl;
                var ok = await saveAll('Kawaii music uploaded', true);
                if (ok) { toast('Uploaded and saved. The next launch uses it.'); again(); } else { cur[key] = old; up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; }
            });
            var rm = url ? el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'Remove', onclick: async function () {
                var old = cur[key]; cur[key] = null;
                if (await saveAll('Kawaii music removed', true)) { toast('Removed.'); again(); } else cur[key] = old;
            } }) : null;
            audioList.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: title }), el('div', { class: 'ad-row-sub', text: url ? 'Uploaded' : 'Nothing uploaded.' }),
                    el('div', { class: 'ad-row-sub', text: 'Plays on every page while the event runs. It loops and stays in sync with the server clock. Visitors tap the music button once to start it (browsers block sound that starts by itself).' }), player),
                el('div', { class: 'ad-row-end' }, up, ' ', rm, file)));
        })();
        add(root, panel('Music (mp3 or m4a, 15 MB)', audioList, pill('Sound only plays for people who tap play', 'info')));

        // ---- history ----
        var hist = el('div', { class: 'ad-list' });
        evs.forEach(function (e) {
            var p = phaseOf(e);
            hist.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: e.label || 'Kawaii theme' }),
                    el('div', { class: 'ad-row-sub', text: fmt(e.starts_at) + ' to ' + fmt(e.ends_at) + '  \u00B7  ' + lenText(e.duration_s) })),
                el('div', { class: 'ad-row-end' }, pill(p[0], p[1]))));
        });
        if (!evs.length) hist.appendChild(el('p', { class: 'ad-help', text: 'No events yet.' }));
        add(root, panel('History', hist));
    }

    /* ----------------------------------------------------------------------
       EVENTS: tHE THE THEME (a "theme / chill" event, live and synced for every visitor)
       Launch now or schedule it, abort it, set the length / volume / fx, upload the music (mp3 / m4a, 15 MB max).
       No countdown and no rewards: the whole site gets the look of the old tHE THE website (orange, Inter, meme pop-ups, a tHE Credits badge) for everybody, then goes back to normal.
       Everything staff change here is audit logged.
       ---------------------------------------------------------------------- */
    var TT_ERR = { bad_value: 'One of the numbers is not a number.', bad_duration: 'Length must be 5 to 1440 minutes.', bad_volume: 'Volume is 0 to 100.', bad_fx: 'Sparkles is 0 to 3.', bad_audio_url: 'That music file is not from the event-audio bucket.', bad_time: 'Pick a start time at least 10 seconds from now.', event_overlap: 'There is already a tHE THE event in that time slot.', not_active: 'That event is not running any more.' };

    async function viewTheThe(root, token) {
        add(root, el('p', { class: 'ad-help', text: 'Loading...' }));
        var d = await rpc('admin_thethe_get', {}, { quiet: true });
        if (stale(token)) return;
        clear(root);
        if (!d || d.ok === false) { add(root, el('p', { class: 'ad-help', text: 'Could not load tHE THE. Is supabase-thethe.sql installed?' })); return; }

        var st = d.settings || {}, evs = d.events || [], nowMs = Date.parse(d.now) || Date.now();
        var cur = { ost: st.audio_ost || null };
        function again() { viewEvents(clear($('adView')), token); }
        function kerr(r) { return TT_ERR[r && r.error] || null; }
        function phaseOf(e) {
            if (e.aborted_at) return ['ABORTED', 'warn'];
            var s = Date.parse(e.starts_at), en = Date.parse(e.ends_at);
            if (nowMs < s) return ['SCHEDULED', 'info'];
            if (nowMs >= en) return ['ENDED', null];
            return ['LIVE', 'ok'];
        }
        function lenText(sec) { var m = Math.round(sec / 60); return m >= 120 ? (Math.round(m / 6) / 10) + ' h' : m + ' min'; }

        // ---- right now ----
        var active = evs.find(function (e) { return !e.aborted_at && Date.parse(e.ends_at) > nowMs; });
        var nowBody;
        if (active) {
            var ph = phaseOf(active);
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\uD83E\uDDE1' }),
                el('div', {},
                    el('div', { class: 'ad-row-title', text: active.label || 'tHE THE theme' }),
                    el('div', { class: 'ad-row-sub', text: 'Starts ' + fmt(active.starts_at) + '  \u00B7  ends ' + fmt(active.ends_at) + '  \u00B7  ' + lenText(active.duration_s) })),
                el('div', { class: 'ad-row-end' }, pill(ph[0], ph[1]), ' ',
                    el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'ABORT', onclick: function () {
                        var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (saved in the audit log)' });
                        dialog({ title: 'Abort the tHE THE event?', body: el('div', {}, el('p', { class: 'ad-help', text: 'Every open page switches back to the normal SPECSOFT look within a few seconds. Everybody keeps their own saved light / dark choice.' }), field('Reason', why)),
                            buttons: [{ text: 'Keep it running' }, { text: 'Abort now', kind: 'danger', onClick: async function () {
                                var r = await rpc('admin_thethe_abort', { p_event: active.id, p_reason: why.value.trim() || null }, { quiet: true });
                                if (!(r && r.ok)) { toast(kerr(r) || 'Could not abort that one.', true); return false; }
                                toast('Event aborted.'); again();
                            } }] });
                    } })));
        } else {
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\uD83D\uDDFF' }),
                el('div', {}, el('div', { class: 'ad-row-title', text: 'No tHE THE event running' }), el('div', { class: 'ad-row-sub', text: 'Launch it now, or schedule it for later. Preview it first: nobody else sees the preview. If the tHE THE event is running at the same time, whichever started first keeps the site and the other waits.' })),
                el('div', { class: 'ad-row-end' }, pill('IDLE')));
        }
        function launchDialog(scheduled) {
            var label = el('input', { class: 'ad-field', type: 'text', maxlength: '60', placeholder: 'Name (optional), shown in the welcome message' });
            var when = el('input', { class: 'ad-field', type: 'datetime-local' });
            var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
            dialog({ title: scheduled ? 'Schedule the tHE THE event' : 'Launch the tHE THE event now?',
                body: el('div', {}, el('p', { class: 'ad-help', text: (scheduled ? 'The whole site turns into tHE THE at the time you pick. ' : 'The whole site turns into tHE THE in about 30 seconds. ') + 'It lasts ' + lenText(st.duration_s || 3600) + ', effects level ' + (st.fx != null ? st.fx : 2) + (cur.ost ? ', with music.' : ', no music uploaded yet.') }),
                    field('Name', label), scheduled ? field('Starts (your local time)', when) : null, field('Reason', why)),
                buttons: [{ text: 'Cancel' }, { text: scheduled ? 'Schedule' : 'LAUNCH', primary: true, onClick: async function () {
                    if (scheduled && !when.value) { toast('Pick a start time.', true); return false; }
                    var r = await rpc('admin_thethe_launch', { p_starts: scheduled ? new Date(when.value).toISOString() : null, p_label: label.value.trim() || null, p_reason: why.value.trim() || null }, { quiet: true });
                    if (!(r && r.ok)) { toast(kerr(r) || 'Could not launch. Is supabase-thethe.sql installed?', true); return false; }
                    toast(scheduled ? 'Scheduled.' : 'Launching. The site turns into tHE THE in about 30 seconds.'); again();
                } }] });
        }

        // ---- settings ----
        function num(v, min, max, step) { return el('input', { class: 'ad-field', type: 'number', min: String(min), max: String(max), step: String(step || 1), value: String(v) }); }
        var iLen = num(Math.round((st.duration_s != null ? st.duration_s : 3600) / 60), 5, 1440);
        var iVol = num(st.volume != null ? st.volume : 60, 0, 100);
        var iSpk = el('select', { class: 'ad-select' }, [['0', '0 - colours only'], ['1', '1 - light'], ['2', '2 - default'], ['3', '3 - party']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        iSpk.value = String(st.fx != null ? st.fx : 2);
        var iWhy = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
        function cfgNow() {
            return { duration_s: Math.round((parseFloat(iLen.value) || 0) * 60), volume: parseInt(iVol.value, 10), fx: parseInt(iSpk.value, 10), audio: { ost: cur.ost } };
        }
        async function saveAll(reasonText, quiet) {
            var r = await rpc('admin_thethe_settings_set', { p_cfg: cfgNow(), p_reason: reasonText || iWhy.value.trim() || null }, { quiet: true });
            if (r && r.ok) { if (!quiet) toast('Saved. Applies to the NEXT launch (a running event keeps its own settings).'); return true; }
            toast(kerr(r) || 'The server refused that. Is supabase-thethe.sql installed?', true);
            return false;
        }
        // the preview runs in another tab with your CURRENT music, volume and fx (even before you save)
        function openPreview() {
            try { var c = cfgNow(); localStorage.setItem('tt.preview.cfg', JSON.stringify({ audio: c.audio, volume: c.volume, fx: c.fx })); } catch (e) { /* storage blocked: the preview uses defaults */ }
            window.open('index.html#thethe-preview', '_blank', 'noopener');
        }
        add(root, panel('tHE THE theme', nowBody, el('div', { class: 'ad-row-end' },
            el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Preview (new tab)', onclick: openPreview }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Schedule', onclick: function () { launchDialog(true); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Launch now', onclick: function () { launchDialog(false); } }))));

        add(root, panel('Settings', el('div', {},
            field('Event length (minutes)', iLen, '60 = one hour, 1440 = a full day. The site goes back to normal by itself when the time is up.'),
            field('Effects level', iSpk, 'Meme emoji pop-ups where people click, plus one short emoji rain when they first see it. 0 = only the colours and the music. Visitors with reduce motion on never see the movement.'),
            field('Music volume (0 to 100)', iVol, 'Visitors also get their own volume slider and mute button.'),
            field('Reason', iWhy),
            el('div', { style: 'margin-top:14px' }, el('button', { type: 'button', class: 'ad-btn', text: 'Save settings', onclick: async function (e) { e.target.disabled = true; await saveAll(); e.target.disabled = false; } })))));

        // ---- music ----
        var audioList = el('div', { class: 'ad-list' });
        (function () {
            var key = 'ost', url = cur[key], title = 'tHE THE OST (loops)';
            var file = el('input', { type: 'file', accept: '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a', style: 'display:none' });
            var player = url ? el('audio', { controls: 'controls', preload: 'none', src: url, style: 'width:100%;max-width:420px;margin-top:6px' }) : null;
            var up = el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: url ? 'Replace' : 'Upload', onclick: function () { file.click(); } });
            file.addEventListener('change', async function () {
                var f = file.files && file.files[0];
                file.value = '';
                if (!f) return;
                var ext = ((f.name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
                if (ext !== 'mp3' && ext !== 'm4a') { toast('Only .mp3 or .m4a files.', true); return; }
                if (f.size > NUKE_MAX_BYTES) { toast('That file is ' + (f.size / 1048576).toFixed(1) + ' MB. The limit is 15 MB. Export it smaller (MP3 around 160 kbps).', true); return; }
                up.disabled = true; up.textContent = 'Uploading...';
                var path = 'thethe/' + key + '-' + Date.now() + '.' + ext;
                var res = await sb.storage.from('event-audio').upload(path, f, { contentType: ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4', cacheControl: '31536000', upsert: false });
                if (res.error) { up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; toast('Upload failed: ' + (res.error.message || 'unknown error') + '. Is supabase-nuke.sql installed and the console unlocked?', true); return; }
                var pub = sb.storage.from('event-audio').getPublicUrl(path);
                var old = cur[key];
                cur[key] = pub && pub.data && pub.data.publicUrl;
                var ok = await saveAll('tHE THE music uploaded', true);
                if (ok) { toast('Uploaded and saved. The next launch uses it.'); again(); } else { cur[key] = old; up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; }
            });
            var rm = url ? el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'Remove', onclick: async function () {
                var old = cur[key]; cur[key] = null;
                if (await saveAll('tHE THE music removed', true)) { toast('Removed.'); again(); } else cur[key] = old;
            } }) : null;
            audioList.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: title }), el('div', { class: 'ad-row-sub', text: url ? 'Uploaded' : 'Nothing uploaded.' }),
                    el('div', { class: 'ad-row-sub', text: 'Plays on every page while the event runs. It loops and stays in sync with the server clock. Visitors tap the music button once to start it (browsers block sound that starts by itself).' }), player),
                el('div', { class: 'ad-row-end' }, up, ' ', rm, file)));
        })();
        add(root, panel('Music (mp3 or m4a, 15 MB)', audioList, pill('Sound only plays for people who tap play', 'info')));

        // ---- history ----
        var hist = el('div', { class: 'ad-list' });
        evs.forEach(function (e) {
            var p = phaseOf(e);
            hist.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: e.label || 'tHE THE theme' }),
                    el('div', { class: 'ad-row-sub', text: fmt(e.starts_at) + ' to ' + fmt(e.ends_at) + '  \u00B7  ' + lenText(e.duration_s) })),
                el('div', { class: 'ad-row-end' }, pill(p[0], p[1]))));
        });
        if (!evs.length) hist.appendChild(el('p', { class: 'ad-help', text: 'No events yet.' }));
        add(root, panel('History', hist));
    }

    /* ----------------------------------------------------------------------
       EVENTS: RAIN THEME (a "theme / chill" event, live and synced for every visitor)
       Launch now or schedule it, abort it, set the length, WHAT FALLS (regular rain or APEX Credits), how hard it rains,
       lightning, the flashlight cursor, window glass and the sound volume. Sound is made in the browser, nothing to upload.
       No countdown and no rewards: the whole site goes dark, cold and wet for everybody, then goes back to normal.
       Visitors can still switch what falls for themselves with the small button in the corner.
       Everything staff change here is audit logged.
       ---------------------------------------------------------------------- */
    var RN_ERR = { bad_value: 'One of the values is not valid.', bad_duration: 'Length must be 5 to 1440 minutes.', bad_kind: 'Pick regular rain or APEX Credits.', bad_intensity: 'Intensity is drizzle, steady or storm.', bad_volume: 'Volume is 0 to 100.', bad_time: 'Pick a start time at least 10 seconds from now.', event_overlap: 'Another rain, kawaii or tHE THE event is already scheduled in that time slot.', not_active: 'That event is not running any more.' };

    async function viewRain(root, token) {
        add(root, el('p', { class: 'ad-help', text: 'Loading...' }));
        var d = await rpc('admin_rain_get', {}, { quiet: true });
        if (stale(token)) return;
        clear(root);
        if (!d || d.ok === false) { add(root, el('p', { class: 'ad-help', text: 'Could not load Rain. Is supabase-rain.sql installed?' })); return; }

        var st = d.settings || {}, evs = d.events || [], nowMs = Date.parse(d.now) || Date.now();
        function again() { viewEvents(clear($('adView')), token); }
        function rerr(r) { return RN_ERR[r && r.error] || null; }
        function phaseOf(e) {
            if (e.aborted_at) return ['ABORTED', 'warn'];
            var s = Date.parse(e.starts_at), en = Date.parse(e.ends_at);
            if (nowMs < s) return ['SCHEDULED', 'info'];
            if (nowMs >= en) return ['ENDED', null];
            return ['LIVE', 'ok'];
        }
        function lenText(sec) { var m = Math.round(sec / 60); return m >= 120 ? (Math.round(m / 6) / 10) + ' h' : m + ' min'; }
        function kindText(k) { return k === 'credits' ? 'APEX Credits' : 'regular rain'; }
        function intText(n) { return n === 1 ? 'drizzle' : n === 3 ? 'storm' : 'steady'; }

        // ---- right now ----
        var active = evs.find(function (e) { return !e.aborted_at && Date.parse(e.ends_at) > nowMs; });
        var nowBody;
        if (active) {
            var ph = phaseOf(active);
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: active.kind === 'credits' ? '\uD83E\uDE99' : '\uD83C\uDF27\uFE0F' }),
                el('div', {},
                    el('div', { class: 'ad-row-title', text: active.label || 'Rain theme' }),
                    el('div', { class: 'ad-row-sub', text: 'Starts ' + fmt(active.starts_at) + '  \u00B7  ends ' + fmt(active.ends_at) + '  \u00B7  ' + lenText(active.duration_s) + '  \u00B7  ' + kindText(active.kind) + ', ' + intText(active.intensity) })),
                el('div', { class: 'ad-row-end' }, pill(ph[0], ph[1]), ' ',
                    el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'ABORT', onclick: function () {
                        var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (saved in the audit log)' });
                        dialog({ title: 'Abort the rain?', body: el('div', {}, el('p', { class: 'ad-help', text: 'Every open page goes back to its normal look within about 15 seconds. Everybody keeps their own saved light / dark choice.' }), field('Reason', why)),
                            buttons: [{ text: 'Keep it running' }, { text: 'Abort now', kind: 'danger', onClick: async function () {
                                var r = await rpc('admin_rain_abort', { p_event: active.id, p_reason: why.value.trim() || null }, { quiet: true });
                                if (!(r && r.ok)) { toast(rerr(r) || 'Could not abort that one.', true); return false; }
                                toast('Event aborted.'); again();
                            } }] });
                    } })));
        } else {
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\u2600\uFE0F' }),
                el('div', {}, el('div', { class: 'ad-row-title', text: 'No rain right now' }), el('div', { class: 'ad-row-sub', text: 'Launch it now, or schedule it for later. Preview it first: nobody else sees the preview.' })),
                el('div', { class: 'ad-row-end' }, pill('IDLE')));
        }
        function launchDialog(scheduled) {
            var label = el('input', { class: 'ad-field', type: 'text', maxlength: '60', placeholder: 'Message (optional), shown once when the rain starts' });
            var when = el('input', { class: 'ad-field', type: 'datetime-local' });
            var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
            dialog({ title: scheduled ? 'Schedule the rain' : 'Launch the rain now?',
                body: el('div', {}, el('p', { class: 'ad-help', text: (scheduled ? 'The whole site gets dark and wet at the time you pick. ' : 'The whole site gets dark and wet in about 30 seconds. ') + 'It lasts ' + lenText(st.duration_s || 3600) + ': ' + kindText(st.kind) + ', ' + intText(st.intensity || 2) + (st.lightning === false ? ', no lightning.' : ', with lightning.') }),
                    field('Message', label), scheduled ? field('Starts (your local time)', when) : null, field('Reason', why)),
                buttons: [{ text: 'Cancel' }, { text: scheduled ? 'Schedule' : 'LAUNCH', primary: true, onClick: async function () {
                    if (scheduled && !when.value) { toast('Pick a start time.', true); return false; }
                    var r = await rpc('admin_rain_launch', { p_starts: scheduled ? new Date(when.value).toISOString() : null, p_label: label.value.trim() || null, p_reason: why.value.trim() || null }, { quiet: true });
                    if (!(r && r.ok)) { toast(rerr(r) || 'Could not launch. Is supabase-rain.sql installed?', true); return false; }
                    toast(scheduled ? 'Scheduled.' : 'Launching. The rain starts in about 30 seconds.'); again();
                } }] });
        }

        // ---- settings ----
        function num(v, min, max, step) { return el('input', { class: 'ad-field', type: 'number', min: String(min), max: String(max), step: String(step || 1), value: String(v) }); }
        function sel(opts, v) { var s2 = el('select', { class: 'ad-select' }, opts.map(function (o) { return el('option', { value: o[0], text: o[1] }); })); s2.value = String(v); return s2; }
        function onOff(v) { return sel([['1', 'On'], ['0', 'Off']], v === false ? '0' : '1'); }
        var iLen = num(Math.round((st.duration_s != null ? st.duration_s : 3600) / 60), 5, 1440);
        var iKind = sel([['rain', 'Regular rain'], ['credits', 'APEX Credits']], st.kind || 'rain');
        var iInt = sel([['1', '1 - drizzle'], ['2', '2 - steady (default)'], ['3', '3 - storm']], st.intensity != null ? st.intensity : 2);
        var iLt = onOff(st.lightning), iFl = onOff(st.flashlight), iGl = onOff(st.glass);
        var iVol = num(st.volume != null ? st.volume : 60, 0, 100);
        var iWhy = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
        function cfgNow() {
            return { duration_s: Math.round((parseFloat(iLen.value) || 0) * 60), kind: iKind.value, intensity: parseInt(iInt.value, 10),
                     lightning: iLt.value === '1', flashlight: iFl.value === '1', glass: iGl.value === '1', volume: parseInt(iVol.value, 10) };
        }
        async function saveAll() {
            var r = await rpc('admin_rain_settings_set', { p_cfg: cfgNow(), p_reason: iWhy.value.trim() || null }, { quiet: true });
            if (r && r.ok) { toast('Saved. Applies to the NEXT launch (a running event keeps its own settings).'); return true; }
            toast(rerr(r) || 'The server refused that. Is supabase-rain.sql installed?', true);
            return false;
        }
        // the preview runs in another tab with your CURRENT settings (even before you save)
        function openPreview() {
            try { localStorage.setItem('rn.preview.cfg', JSON.stringify(cfgNow())); } catch (e) { /* storage blocked: the preview uses defaults */ }
            window.open('index.html#rain-preview', '_blank', 'noopener');
        }
        add(root, panel('Rain theme', nowBody, el('div', { class: 'ad-row-end' },
            el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Preview (new tab)', onclick: openPreview }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Schedule', onclick: function () { launchDialog(true); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Launch now', onclick: function () { launchDialog(false); } }))));

        add(root, panel('Settings', el('div', {},
            field('Event length (minutes)', iLen, '60 = one hour, 1440 = a full day. The site goes back to normal by itself when the time is up.'),
            field('What falls', iKind, 'Regular rain, or APEX Credits (spinning coins with sparkles where they land). Visitors can switch it for themselves with the small button in the corner.'),
            field('Intensity', iInt, 'Drizzle is calm and sparse. Storm is heavy, with more lightning. Weak devices automatically get less.'),
            field('Lightning', iLt, 'A rare soft flash with thunder a few seconds later. Never a strobe. Visitors with reduce motion on never see it.'),
            field('Flashlight cursor', iFl, 'The page is darker away from the mouse. Hidden on touch screens.'),
            field('Window glass', iGl, 'Water beads that sit on the screen, then slide down leaving a trail.'),
            field('Sound volume (0 to 100)', iVol, 'Rain, distant roar and thunder, all made in the browser. Visitors tap the sound button once to start it (browsers block sound that starts by itself).'),
            field('Reason', iWhy),
            el('div', { style: 'margin-top:14px' }, el('button', { type: 'button', class: 'ad-btn', text: 'Save settings', onclick: async function (e) { e.target.disabled = true; await saveAll(); e.target.disabled = false; } })))));

        // ---- history ----
        var hist = el('div', { class: 'ad-list' });
        evs.forEach(function (e) {
            var p = phaseOf(e);
            hist.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: e.label || 'Rain theme' }),
                    el('div', { class: 'ad-row-sub', text: fmt(e.starts_at) + ' to ' + fmt(e.ends_at) + '  \u00B7  ' + lenText(e.duration_s) + '  \u00B7  ' + kindText(e.kind) })),
                el('div', { class: 'ad-row-end' }, pill(p[0], p[1]))));
        });
        if (!evs.length) hist.appendChild(el('p', { class: 'ad-help', text: 'No events yet.' }));
        add(root, panel('History', hist));
    }

    /* ----------------------------------------------------------------------
       EVENTS: tabs, in two groups.
         Chaos events:            Nuke, Glitchware, Blackout
         Theme / chill events:    Kawaii, tHE THE, Rain
       ---------------------------------------------------------------------- */
    async function viewEvents(root, token) {
        var tab = S.evTab === 'glitch' ? 'glitch' : S.evTab === 'blackout' ? 'blackout' : S.evTab === 'kawaii' ? 'kawaii' : S.evTab === 'thethe' ? 'thethe' : S.evTab === 'rain' ? 'rain' : 'nuke';
        function tabBtn(id, label) {
            return el('button', { type: 'button', class: 'ad-btn ad-btn--sm' + (tab === id ? '' : ' ad-btn--ghost'), text: label, onclick: function () {
                if (tab === id) return;
                S.evTab = id; viewEvents(clear($('adView')), token);
            } });
        }
        add(root, el('div', { class: 'ad-help', text: 'Chaos events' }));
        add(root, el('div', { class: 'ad-toolbar' }, tabBtn('nuke', 'Nuke event'), tabBtn('glitch', 'Glitchware'), tabBtn('blackout', 'Blackout')));
        add(root, el('div', { class: 'ad-help', style: 'margin-top:10px', text: 'Theme / chill events' }));
        add(root, el('div', { class: 'ad-toolbar' }, tabBtn('kawaii', 'Kawaii'), tabBtn('thethe', 'tHE THE'), tabBtn('rain', 'Rain')));
        var body = el('div'); add(root, body);
        if (tab === 'glitch') return viewGlitchware(body, token);
        if (tab === 'blackout') return viewBlackout(body, token);
        if (tab === 'kawaii') return viewKawaii(body, token);
        if (tab === 'thethe') return viewTheThe(body, token);
        if (tab === 'rain') return viewRain(body, token);
        return viewNukeEvent(body, token);
    }

    /* ----------------------------------------------------------------------
       EVENTS: GLITCHWARE (live and synced for every visitor)
       Launch now or schedule it, abort it, set timer / goal / hunt pages / rewards,
       upload the VILLAIN image (png, webp, gif, jpg: 5 MB max) and 5 OST slots (mp3 / m4a, 15 MB max each).
       Everything staff change here is audit logged.
       ---------------------------------------------------------------------- */
    var GW_MAX_AUDIO = 15 * 1024 * 1024, GW_MAX_IMG = 5 * 1024 * 1024;
    var GW_SLOTS = [
        ['loop', 'Main OST (loops)', 'Plays while the page is hijacked, starting at the right spot for people who join late. Your main Glitchware OST goes here.'],
        ['panic', 'Panic OST (final 30 seconds, loops)', 'Optional. When 30 seconds are left the main OST fades out and this one takes over.'],
        ['scare', 'Jumpscare sound', 'Plays once when the villain jumpscares people who lost.'],
        ['crash', 'Crash screen ambience (loops)', 'Optional. Plays on the GLITCHWARE WON crash screen after the jumpscare.'],
        ['purge', 'Victory sting', 'Plays once when somebody purges the glitchware.']
    ];
    var GW_ERR = { bad_duration: 'Timer must be 30 to 1800 seconds.', bad_goal: 'Goal must be 10 to 5000 points.', bad_density: 'Credits per page must be 3 to 12.', bad_intensity: 'Pick low, medium or chaos.', bad_reward: 'Rewards must be 0 or more.', bad_volume: 'Volume is 0 to 100.', bad_audio_url: 'That audio link is not from the glitch-assets bucket.', bad_image_url: 'That image link is not from the glitch-assets bucket.', bad_pages: 'Pages can only use letters, numbers, - and _ (max 30 pages).', bad_time: 'Pick a time at least 10 seconds from now.', no_pages: 'Add at least one hunt page in Settings and save first.', goal_unreachable: 'The goal is too high for the pages and credits per page you set. Add pages, raise credits per page, or lower the goal.', event_overlap: 'Another event (nuke or glitchware) is already scheduled around then.', not_active: 'That event is not running or scheduled any more.' };
    // must match glitch_value() in supabase-glitchware.sql and valueOf() in glitchware-event.js
    function gwPts(i) { return i % 6 === 0 ? 25 : (i % 3 === 0 ? 10 : 5); }
    function gwPerPage(density) { var t = 0; for (var i = 0; i < density; i++) t += gwPts(i); return t; }
    // "index, Store, chats.html" -> ['index','store','chats']  (page = file name without .html, same as the event script uses)
    function gwParsePages(str) {
        var seen = {}, out = [];
        String(str || '').split(/[\s,]+/).forEach(function (p) {
            p = p.toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
            if (p && !seen[p]) { seen[p] = 1; out.push(p); }
        });
        return out;
    }

    async function viewGlitchware(root, token) {
        add(root, el('p', { class: 'ad-help', text: 'Loading...' }));
        var d = await rpc('admin_glitch_get', {}, { quiet: true });
        if (stale(token)) return;
        clear(root);
        if (!d || d.ok === false) {
            if (d && (d.error === 'locked' || d.error === 'not_staff' || d.error === 'not_authenticated')) return;
            add(root, el('p', { class: 'ad-help', text: 'Could not load Glitchware. Is supabase-glitchware.sql installed?' })); return;
        }

        var st = d.settings || {}, evs = d.events || [], nowMs = Date.parse(d.now) || Date.now();
        var cur = { villain: st.villain_url || null, loop: st.audio_loop || null, panic: st.audio_panic || null, scare: st.audio_scare || null, crash: st.audio_crash || null, purge: st.audio_purge || null };
        function again() { viewEvents(clear($('adView')), token); }
        function gfail(r) {
            if (r && (r.error === 'locked' || r.error === 'not_staff' || r.error === 'not_authenticated')) return;
            toast(GW_ERR[r && r.error] || (r && r.error === 'server' ? 'The server refused that. Is supabase-glitchware.sql installed?' : ('Action failed: ' + ((r && r.error) || 'unknown'))), true);
        }
        function phaseOf(e) {
            if (e.aborted_at) return ['ABORTED', 'warn'];
            var s = Date.parse(e.starts_at), en = Date.parse(e.ends_at);
            if (nowMs < s) return ['SCHEDULED', 'info'];
            if (nowMs < en) return ['HIJACKED', 'ok'];
            return ['DONE', null];
        }

        // ---- settings controls (built first: the preview button reads them) ----
        function num(v, min, max) { return el('input', { class: 'ad-field', type: 'number', min: String(min), max: String(max), step: '1', value: String(v) }); }
        var iDur = num(st.duration_s != null ? st.duration_s : 180, 30, 1800);
        var iGoal = num(st.goal != null ? st.goal : 300, 10, 5000);
        var iDen = num(st.density != null ? st.density : 8, 3, 12);
        var iInt = el('select', { class: 'ad-select' }, [['low', 'Low (gentle)'], ['medium', 'Medium'], ['chaos', 'Chaos (wild)']].map(function (o) {
            var op = el('option', { value: o[0], text: o[1] }); if ((st.intensity || 'medium') === o[0]) op.selected = true; return op;
        }));
        var iScare = el('input', { type: 'checkbox' }); iScare.checked = st.jumpscare !== false;
        var iPages = el('input', { class: 'ad-field', type: 'text', maxlength: '400', placeholder: 'index, store, chats', value: (st.pages || []).join(', ') });
        var iXp = num(st.reward_xp || 0, 0, 1000000), iAc = num(st.reward_ac || 0, 0, 1000000), iVol = num(st.volume != null ? st.volume : 80, 0, 100);
        var iWhy = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
        var math = el('p', { class: 'ad-help' });
        function paintMath() {
            var pg = gwParsePages(iPages.value), den = parseInt(iDen.value, 10) || 8, ppp = gwPerPage(den), total = pg.length * ppp, maxGoal = Math.floor(total * 0.8), goal = parseInt(iGoal.value, 10) || 0, msg, bad = false;
            if (!pg.length) { msg = 'Add at least one hunt page or the event cannot launch.'; bad = true; }
            else {
                msg = pg.length + (pg.length === 1 ? ' page' : ' pages') + ' x ' + ppp + ' points per page = ' + total + ' points hidden. The goal can be at most ' + maxGoal + ' (80% of what is hidden).';
                if (goal > maxGoal) { msg += ' Your goal of ' + goal + ' is too high: add pages, raise credits per page, or lower the goal.'; bad = true; }
            }
            math.textContent = msg; math.style.color = bad ? '#ff6b6b' : '';
        }
        [iPages, iDen, iGoal].forEach(function (i) { i.addEventListener('input', paintMath); }); paintMath();

        async function saveAll(reasonText, quiet) {
            var r = await rpc('admin_glitch_settings_set', {
                p_duration: parseInt(iDur.value, 10), p_goal: parseInt(iGoal.value, 10), p_density: parseInt(iDen.value, 10),
                p_intensity: iInt.value, p_jumpscare: iScare.checked,
                p_xp: parseInt(iXp.value, 10) || 0, p_ac: parseInt(iAc.value, 10) || 0, p_volume: parseInt(iVol.value, 10) || 0,
                p_villain: cur.villain, p_pages: gwParsePages(iPages.value),
                p_loop: cur.loop, p_panic: cur.panic, p_scare: cur.scare, p_crash: cur.crash, p_purge: cur.purge,
                p_reason: reasonText || iWhy.value.trim() || null }, { quiet: true });
            if (r && r.ok) { if (!quiet) toast('Saved. Applies to the NEXT launch (a running event keeps its own settings).'); return true; }
            gfail(r); return false;
        }
        // the preview runs in another tab with your CURRENT villain / OSTs / look (even before you save)
        function openPreview(hash) {
            try {
                localStorage.setItem('gw.preview.cfg', JSON.stringify({ villain: cur.villain, audio: { loop: cur.loop, panic: cur.panic, scare: cur.scare, crash: cur.crash, purge: cur.purge },
                    intensity: iInt.value, jumpscare: iScare.checked, volume: parseInt(iVol.value, 10) || 0 }));
            } catch (e) { /* storage blocked: the preview just uses the defaults */ }
            window.open('index.html' + hash, '_blank', 'noopener');
        }

        // ---- right now ----
        var active = evs.find(function (e) { return !e.aborted_at && Date.parse(e.ends_at) > nowMs; });
        var nowBody;
        if (active) {
            var ph = phaseOf(active);
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\uD83D\uDDA5\uFE0F' }),
                el('div', {},
                    el('div', { class: 'ad-row-title', text: active.label || 'Glitchware' }),
                    el('div', { class: 'ad-row-sub', text: 'Hijack ' + fmt(active.starts_at) + '  \u00B7  timer ends ' + fmt(active.ends_at) + '  \u00B7  goal ' + active.goal + ' points' })),
                el('div', { class: 'ad-row-end' }, pill(ph[0], ph[1]), ' ',
                    el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'ABORT', onclick: function () {
                        var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (saved in the audit log)' });
                        dialog({ title: 'Abort Glitchware?', body: el('div', {}, el('p', { class: 'ad-help', text: 'Every open page cleans itself up within a few seconds and the site goes back to normal. Nobody gets rewards after this.' }), field('Reason', why)),
                            buttons: [{ text: 'Keep it running' }, { text: 'Abort now', kind: 'danger', onClick: async function () {
                                var r = await rpc('admin_glitch_abort', { p_event: active.id, p_reason: why.value.trim() || null }, { quiet: true });
                                if (!(r && r.ok)) { gfail(r); return false; }
                                toast('Event aborted.'); again();
                            } }] });
                    } })));
        } else {
            nowBody = el('div', { class: 'ad-now' },
                el('div', { class: 'ad-now-emoji', text: '\u2600\uFE0F' }),
                el('div', {}, el('div', { class: 'ad-row-title', text: 'No Glitchware running' }), el('div', { class: 'ad-row-sub', text: 'Launch it now, or schedule it for later. Preview it first: nobody else sees the preview.' })),
                el('div', { class: 'ad-row-end' }, pill('IDLE')));
        }
        function launchDialog(scheduled) {
            var label = el('input', { class: 'ad-field', type: 'text', maxlength: '60', placeholder: 'Name for the ending screen (optional)' });
            var when = el('input', { class: 'ad-field', type: 'datetime-local' });
            var why = el('input', { class: 'ad-field', type: 'text', maxlength: '120', placeholder: 'Why? (optional, saved in the audit log)' });
            var mins = Math.round((st.duration_s || 180) / 60 * 10) / 10, npg = (st.pages || []).length;
            dialog({ title: scheduled ? 'Schedule Glitchware' : 'Launch Glitchware now?',
                body: el('div', {}, el('p', { class: 'ad-help', text: (scheduled ? 'It starts at the time you pick. ' : 'The hijack starts in about 45 seconds so every open page can catch it. ') + 'Timer ' + mins + ' min, goal ' + (st.goal || 300) + ' points, hidden on ' + npg + (npg === 1 ? ' page' : ' pages') + '. Rewards: ' + (st.reward_xp || 0) + ' XP and ' + (st.reward_ac || 0) + ' APEX Credits. These are the SAVED settings.' }),
                    field('Name', label), scheduled ? field('Starts (your local time)', when) : null, field('Reason', why)),
                buttons: [{ text: 'Cancel' }, { text: scheduled ? 'Schedule' : 'LAUNCH', primary: true, onClick: async function () {
                    if (scheduled && !when.value) { toast('Pick a start time.', true); return false; }
                    var r = await rpc('admin_glitch_launch', { p_starts: scheduled ? new Date(when.value).toISOString() : null, p_label: label.value.trim() || null, p_reason: why.value.trim() || null }, { quiet: true });
                    if (!(r && r.ok)) { gfail(r); return false; }
                    toast(scheduled ? 'Scheduled.' : 'Launching. The hijack starts in about 45 seconds.'); again();
                } }] });
        }
        add(root, panel('Glitchware', nowBody, el('div', { class: 'ad-row-end' },
            el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Preview (new tab)', onclick: function () { openPreview('#glitch-preview'); } }), ' ',
            el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Test jumpscare', onclick: function () { openPreview('#glitch-preview-lose'); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: 'Schedule', onclick: function () { launchDialog(true); } }), ' ',
            active ? null : el('button', { type: 'button', class: 'ad-btn ad-btn--sm', text: 'Launch now', onclick: function () { launchDialog(false); } }))));

        // ---- settings ----
        add(root, panel('Settings', el('div', {},
            field('Timer (seconds)', iDur, '180 = 3 minutes. The T-1:00 and 15-second announcements happen automatically, and the panic OST takes over at 30 seconds left.'),
            field('Goal (points)', iGoal, 'Points people must collect to purge the glitchware. Credits are worth 5, 10 or 25 points each.'),
            field('Hidden credits per page (3 to 12)', iDen, 'Every hunt page hides this many credits. More credits = more points per page = an easier hunt.'),
            field('Hunt pages', iPages, 'The pages that hide credits, by file name without .html (index, store, chats...). Only pages that load seasons.js work. Use commas.'),
            math,
            field('Glitch intensity', iInt, 'How often the screen tears and how fast fake windows spawn.'),
            el('label', { class: 'ad-role-opt' }, iScare, el('span', {}, el('b', { text: 'Villain jumpscare' }), el('br'), el('span', { class: 'ad-row-sub', text: 'On: people who fail get the villain jumpscare, then the crash screen. Off: they only see the crash screen. (Anyone who turned on Reduce effects never gets the jumpscare.)' }))),
            field('Reward for purging: XP', iXp, 'Paid by the database to members who really reach the goal.'),
            field('Reward for purging: APEX Credits', iAc),
            field('Sound volume (0 to 100)', iVol),
            field('Reason', iWhy),
            el('div', { style: 'margin-top:14px' }, el('button', { type: 'button', class: 'ad-btn', text: 'Save settings', onclick: async function (e) { e.target.disabled = true; await saveAll(); e.target.disabled = false; } })))));

        // ---- upload rows (the villain image and the OSTs work the same way) ----
        function assetRow(o) {
            var key = o.key, url = cur[key], isImg = o.kind === 'image';
            var file = el('input', { type: 'file', accept: isImg ? '.png,.webp,.gif,.jpg,.jpeg,image/png,image/webp,image/gif,image/jpeg' : '.mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a', style: 'display:none' });
            var preview = null;
            if (url) preview = isImg
                ? el('img', { src: url, alt: '', style: 'display:block;max-width:180px;max-height:180px;margin-top:8px;border-radius:10px;background:repeating-conic-gradient(#2a2a2e 0% 25%, #1a1a1d 0% 50%) 50% / 16px 16px' })
                : el('audio', { controls: 'controls', preload: 'none', src: url, style: 'width:100%;max-width:420px;margin-top:6px' });
            var up = el('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', text: url ? 'Replace' : 'Upload', onclick: function () { file.click(); } });
            file.addEventListener('change', async function () {
                var f = file.files && file.files[0];
                file.value = '';
                if (!f) return;
                var ext = ((f.name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '').toLowerCase();
                var okExt = isImg ? ['png', 'webp', 'gif', 'jpg', 'jpeg'] : ['mp3', 'm4a'];
                if (okExt.indexOf(ext) < 0) { toast(isImg ? 'Only .png, .webp, .gif or .jpg images.' : 'Only .mp3 or .m4a files.', true); return; }
                var max = isImg ? GW_MAX_IMG : GW_MAX_AUDIO;
                if (f.size > max) { toast('That file is ' + (f.size / 1048576).toFixed(1) + ' MB. The limit is ' + (max / 1048576) + ' MB.' + (isImg ? ' Shrink the image (about 1000 px wide is plenty).' : ' Export it smaller (MP3 around 160 kbps).'), true); return; }
                var ct = { mp3: 'audio/mpeg', m4a: 'audio/mp4', png: 'image/png', webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext];
                up.disabled = true; up.textContent = 'Uploading...';
                var path = (isImg ? 'villain/' : 'audio/') + key + '-' + Date.now() + '.' + ext;
                var res = await sb.storage.from('glitch-assets').upload(path, f, { contentType: ct, cacheControl: '31536000', upsert: false });
                if (res.error) { up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; toast('Upload failed: ' + (res.error.message || 'unknown error') + '. Is supabase-glitchware.sql installed and the console unlocked?', true); return; }
                var pub = sb.storage.from('glitch-assets').getPublicUrl(path);
                cur[key] = pub && pub.data && pub.data.publicUrl;
                var ok = await saveAll('Glitchware asset uploaded: ' + o.title, true);
                if (ok) { toast('Uploaded and saved. The next launch uses it.'); again(); } else { cur[key] = url; up.disabled = false; up.textContent = url ? 'Replace' : 'Upload'; }
            });
            var rm = url ? el('button', { type: 'button', class: 'ad-btn ad-btn--danger ad-btn--sm', text: 'Remove', onclick: async function () {
                var old = cur[key]; cur[key] = null;
                if (await saveAll('Glitchware asset removed: ' + o.title, true)) { toast('Removed.'); again(); } else cur[key] = old;
            } }) : null;
            return el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: o.title }), el('div', { class: 'ad-row-sub', text: url ? 'Uploaded' : o.empty }), el('div', { class: 'ad-row-sub', text: o.help }), preview),
                el('div', { class: 'ad-row-end' }, up, ' ', rm, file));
        }

        add(root, panel('Villain image (png, webp, gif or jpg, 5 MB)', el('div', { class: 'ad-list' }, assetRow({
            key: 'villain', kind: 'image', title: 'Glitchware villain',
            empty: 'Nothing uploaded. The SPECSOFT logo is used for the jumpscare instead.',
            help: 'Shows in the hijack intro, inside some fake error windows, peeking in from the screen edges, as the jumpscare, and on the ending screen. A transparent PNG about 1000 px wide works best.' })),
            pill('Preview shows your current picture', 'info')));

        var audioList = el('div', { class: 'ad-list' });
        GW_SLOTS.forEach(function (slot) {
            audioList.appendChild(assetRow({ key: slot[0], kind: 'audio', title: slot[1], help: slot[2],
                empty: slot[0] === 'scare' ? 'Nothing uploaded. A built-in screech plays instead.' : (slot[0] === 'purge' ? 'Nothing uploaded. A built-in chime plays instead.' : 'Nothing uploaded. Nothing plays for this one.') }));
        });
        add(root, panel('OSTs and sounds (mp3 or m4a, 15 MB each)', audioList, pill('Sound only plays for people who turned sound on', 'info')));

        // ---- history ----
        var hist = el('div', { class: 'ad-list' });
        evs.forEach(function (e) {
            var ph2 = phaseOf(e), pl = e.players || 0, pu = e.purged || 0;
            hist.appendChild(el('div', { class: 'ad-row' },
                el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: e.label || 'Glitchware' }),
                    el('div', { class: 'ad-row-sub', text: fmt(e.starts_at) + ' to ' + fmt(e.ends_at) + '  \u00B7  ' + pl + ' signed in, ' + pu + ' PURGED, ' + Math.max(0, pl - pu) + ' INFECTED' })),
                el('div', { class: 'ad-row-end' }, pill(ph2[0], ph2[1]))));
        });
        if (!evs.length) hist.appendChild(el('p', { class: 'ad-help', text: 'No events yet.' }));
        add(root, panel('History', hist));
    }

    function viewRoles(root, token) {
        var isOwner = canAtLeast('owner');
        $('adTopSub').textContent = isOwner ? 'OWNER: YOU CAN EDIT' : 'READ ONLY';
        if (isOwner) {
            root.appendChild(el('div', { class: 'ad-toolbar' }, el('button', { type: 'button', class: 'ad-btn', text: '+ New role', onclick: function () { roleDefDialog(null); } })));
        } else {
            root.appendChild(el('p', { class: 'ad-help', style: 'margin-bottom:14px', text: 'Role definitions (names, icons, colors) are edited by owners. Admins hand roles out from a member\u2019s profile page.' }));
        }

        var counts = new Map();
        sb.from('user_roles').select('role_id').then(function (r) {
            (r.data || []).forEach(function (x) { counts.set(x.role_id, (counts.get(x.role_id) || 0) + 1); });
            if (stale(token)) return;
            root.querySelectorAll('[data-count]').forEach(function (n) { n.textContent = (counts.get(n.dataset.count) || 0) + ' members'; });
        });

        CATS.forEach(function (cat) {
            var grid = el('div', { class: 'ad-role-table' });
            S.defs.filter(function (d) { return d.category === cat.id; }).forEach(function (d) {
                var card = el('div', { class: 'ad-role-card' }, roleChip(d),
                    el('div', { class: 'ad-row-main' },
                        el('div', { class: 'ad-row-sub', text: 'id: ' + d.id + ' \u00B7 rank ' + d.rank }),
                        el('div', { class: 'ad-row-sub' }, 'grant: ' + d.min_grant + (d.active ? '' : ' \u00B7 INACTIVE'), ' \u00B7 ', el('span', { dataset: { count: d.id }, text: '\u2026' }))),
                    isOwner ? el('button', { type: 'button', class: 'ad-row-btn', text: 'EDIT', onclick: function () { roleDefDialog(d); } }) : null);
                grid.appendChild(card);
            });
            root.appendChild(panel(cat.title + (cat.multi ? '' : ' \u00B7 one per member'), grid));
        });
    }

    function roleDefDialog(def) {
        var isNew = !def;
        var d = def || { id: '', category: 'cosmetic', name: '', icon: '\u2B50', color: '#9ca3af', rank: 300, min_grant: 'admin', active: true };
        var idIn = el('input', { class: 'ad-field', value: d.id, maxlength: '40', placeholder: 'lowercase_with_underscores', disabled: !isNew });
        var cat = el('select', { class: 'ad-select', disabled: !isNew }, CATS.map(function (c) { return el('option', { value: c.id, text: c.title, selected: c.id === d.category }); }));
        var name = el('input', { class: 'ad-field', value: d.name, maxlength: '60' });
        var ico = el('input', { class: 'ad-field', value: d.icon, maxlength: '300', 'aria-label': 'Icon: emoji, Flaticon image link, or badges/file.png' });
        var colorPick = el('input', { type: 'color', value: d.color, 'aria-label': 'Color' });
        var colorHex = el('input', { class: 'ad-field ad-mono', value: d.color, maxlength: '7' });
        var rk = el('input', { class: 'ad-field', type: 'number', value: String(d.rank), min: '0', max: '9999' });
        var grant = el('select', { class: 'ad-select' }, ['moderator', 'admin', 'owner'].map(function (g) { return el('option', { value: g, text: g, selected: g === d.min_grant }); }));
        var activeBox = el('input', { type: 'checkbox', checked: d.active });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        var preview = el('div', { style: 'margin-top:12px' });

        function paintPreview() {
            clear(preview);
            var c = COLOR_RE.test(colorHex.value) ? colorHex.value : '#9ca3af';
            preview.appendChild(roleChip({ id: idIn.value, name: name.value || 'Role name', icon: (ico.value.trim() && iconValid(ico.value.trim())) ? ico.value.trim() : (ico.value.trim() ? '\u26A0\uFE0F' : '\u2B50'), color: c }));
        }
        colorPick.addEventListener('input', function () { colorHex.value = colorPick.value; paintPreview(); });
        colorHex.addEventListener('input', function () { if (COLOR_RE.test(colorHex.value)) colorPick.value = colorHex.value; paintPreview(); });
        [name, ico, idIn].forEach(function (i) { i.addEventListener('input', paintPreview); });
        paintPreview();

        dialog({
            title: isNew ? 'New role' : 'Edit role',
            body: [
                field('ID', idIn, isNew ? 'Cannot be changed later.' : null), field('CATEGORY', cat),
                field('NAME', name),
                el('div', { class: 'ad-row2' }, el('div', {}, field('ICON', ico, 'An emoji, a Flaticon image link, or a file on your site like badges/crown.png')), el('div', {}, field('COLOR', el('div', { style: 'display:flex;gap:8px' }, colorPick, colorHex)))),
                el('div', { class: 'ad-row2' }, el('div', {}, field('RANK (LOWER SHOWS FIRST)', rk)), el('div', {}, field('WHO CAN HAND IT OUT', grant))),
                el('label', { class: 'ad-role-opt', style: 'margin-top:14px' }, activeBox, el('span', { text: 'Active (inactive roles stop showing on the site)' })),
                preview, err],
            buttons: [{ text: 'Cancel' }, { text: 'Save role', primary: true, onClick: async function () {
                err.hidden = true;
                if (!iconValid(ico.value.trim())) { err.textContent = 'That icon is not allowed. Use an emoji, a Flaticon image link (cdn-icons-png.flaticon.com/...), or badges/yourfile.png.'; err.hidden = false; return false; }
                var r = await rpc('admin_upsert_role_def', { p_id: idIn.value.trim(), p_category: cat.value, p_name: name.value, p_icon: ico.value.trim(), p_color: colorHex.value, p_rank: parseInt(rk.value, 10) || 100, p_min_grant: grant.value, p_active: activeBox.checked });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not save.'; err.hidden = false; return false; }
                toast('Role saved');
                await loadDefs();
                route();
            } }]
        });
    }

    /* ----------------------------------------------------------------------
       AUDIT LOG
       ---------------------------------------------------------------------- */
    var ACTION_FILTERS = [['', 'All actions'], ['sanction_', 'Sanctions'], ['roles_', 'Role changes'], ['role_def', 'Role definitions'], ['note_', 'Staff notes'],
        ['staff_', 'Staff changes'], ['panel_unlock', 'Console unlocks'], ['password_', 'Passwords'], ['case_', 'Cases'], ['hub_', 'Hub moderation'], ['appeal', 'Appeals'], ['security:', 'Security alerts']];

    function viewAudit(root, token, targetId) {
        var action = el('select', { class: 'ad-select', 'aria-label': 'Filter by action' }, ACTION_FILTERS.map(function (f) { return el('option', { value: f[0], text: f[1] }); }));
        var result = el('select', { class: 'ad-select', 'aria-label': 'Filter by result' }, [el('option', { value: '', text: 'Any result' }), el('option', { value: 'ok', text: 'Succeeded' }), el('option', { value: 'fail', text: 'Failed' })]);
        var target = el('input', { class: 'ad-field', placeholder: 'Filter by user ID (optional)', value: targetId || '', spellcheck: 'false' });
        root.appendChild(el('div', { class: 'ad-toolbar' }, action, result, target));

        var body = el('tbody');
        var table = el('table', { class: 'ad-table' }, el('thead', {}, el('tr', {}, ['When', 'Who', 'Action', 'Affected', 'Reason', 'Result'].map(function (h) { return el('th', { text: h }); }))), body);
        var more = el('button', { type: 'button', class: 'ad-btn ad-btn--ghost', text: 'Load older', hidden: true });
        root.appendChild(el('div', { class: 'ad-table-wrap' }, table));
        root.appendChild(el('div', { style: 'margin-top:14px' }, more));
        var empty = el('p', { class: 'ad-empty', text: 'Nothing matches.', hidden: true });
        root.appendChild(empty);

        var last = null, loading = false;

        function jsonBlock(label, v) {
            if (v === null || v === undefined) return null;
            return el('div', {}, el('small', { text: label }), el('pre', { text: JSON.stringify(v, null, 2) }));
        }

        function addRow(a) {
            var detail = el('tr', { hidden: true }, el('td', { colspan: '6' }, el('div', { class: 'ad-diff' }, jsonBlock('BEFORE', a.before), jsonBlock('AFTER', a.after), jsonBlock('DETAILS', a.meta),
                el('div', {}, el('small', { text: 'IDS' }), el('pre', { text: 'entry ' + a.id + '\nactor ' + (a.actor_id || '-') + '\ntarget ' + (a.target_user || '-') + (a.target_id ? '\nobject ' + (a.target_type || '') + ' ' + a.target_id : '') })))));
            var row = el('tr', { class: 'is-clickable', tabindex: '0', 'aria-expanded': 'false' },
                el('td', { class: 'ad-nowrap', title: fmt(a.at), text: ago(a.at) }),
                el('td', { text: a.actor_name || '-' }),
                el('td', { text: actionLabel(a.action) }),
                el('td', {}, a.target_name ? el('button', { type: 'button', class: 'ad-idcopy', text: '@' + a.target_name, onclick: function (e) { e.stopPropagation(); go('users', a.target_user); } }) : '-'),
                el('td', { class: 'ad-reason', text: a.reason || '' }),
                el('td', {}, a.success ? pill('OK', 'ok') : pill('FAILED', 'bad')));
            function toggle() { detail.hidden = !detail.hidden; row.setAttribute('aria-expanded', String(!detail.hidden)); }
            row.addEventListener('click', toggle);
            row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
            body.appendChild(row); body.appendChild(detail);
        }

        async function load(reset) {
            if (loading) return;
            loading = true;
            if (reset) { clear(body); last = null; }
            var tv = target.value.trim().toLowerCase();
            var args = { p_limit: 50, p_before: last, p_action: action.value || null, p_target: UUID_RE.test(tv) ? tv : null, p_success: result.value === 'ok' ? true : (result.value === 'fail' ? false : null) };
            var d = await rpc('admin_audit_list', args);
            loading = false;
            if (stale(token) || !d.ok) return;
            (d.entries || []).forEach(addRow);
            if ((d.entries || []).length) last = d.entries[d.entries.length - 1].id;
            more.hidden = (d.entries || []).length < 50;
            empty.hidden = body.children.length > 0;
        }

        [action, result].forEach(function (c) { c.addEventListener('change', function () { load(true); }); });
        var t = null;
        target.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { var v = target.value.trim(); if (!v || UUID_RE.test(v)) load(true); }, 350); });
        more.addEventListener('click', function () { load(false); });
        load(true);
    }

    /* ----------------------------------------------------------------------
       STAFF
       ---------------------------------------------------------------------- */
    async function viewStaff(root, token) {
        var d = await rpc('admin_staff_list');
        if (stale(token) || !d.ok) return;
        var isOwner = canAtLeast('owner');
        $('adTopSub').textContent = isOwner ? 'OWNER' : 'READ ONLY';

        if (isOwner) {
            root.appendChild(el('div', { class: 'ad-toolbar' }, el('button', { type: 'button', class: 'ad-btn', text: '+ Add staff member', onclick: addStaffDialog })));
        }

        var list = el('div', { class: 'ad-list' });
        (d.staff || []).forEach(function (m) {
            var self = m.username === S.username;
            var row = el('div', { class: 'ad-row' }, avatar(m),
                el('div', { class: 'ad-row-main' },
                    el('div', { class: 'ad-row-title', text: m.display_name || m.username }),
                    el('div', { class: 'ad-row-sub', text: '@' + m.username + ' \u00B7 seen ' + ago(m.last_seen) }),
                    el('div', { class: 'ad-pills', style: 'margin-top:6px' }, pill(m.level.toUpperCase(), m.level === 'owner' ? 'warn' : 'info'), m.password_set ? pill('PASSWORD SET', 'ok') : pill('NO PASSWORD YET'))),
                el('div', { class: 'ad-row-end' },
                    el('button', { type: 'button', class: 'ad-row-btn', text: 'PROFILE', onclick: function () { go('users', m.id); } }),
                    isOwner && !self && m.level !== 'owner' ? [' ',
                        el('button', { type: 'button', class: 'ad-row-btn', text: 'CHANGE', onclick: function () { staffDialog(m); } }), ' ',
                        el('button', { type: 'button', class: 'ad-row-btn', text: 'RESET PW', onclick: function () { resetPwDialog(m); } })] : null));
            list.appendChild(row);
        });
        root.appendChild(panel('Staff (' + (d.staff || []).length + ')', list));
        root.appendChild(el('p', { class: 'ad-help', text: 'Staff level controls what someone can do here. It is separate from badges: giving someone a badge never gives them access. Owners can only be changed in the SQL editor.' }));
    }

    function staffDialog(m) {
        var level = el('select', { class: 'ad-select' }, [['moderator', 'Moderator'], ['admin', 'Admin'], ['', 'Remove from staff']].map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === m.level }); }));
        var reason = el('input', { class: 'ad-field', maxlength: '500', placeholder: 'Reason (required)' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({ title: '@' + m.username, body: [field('STAFF LEVEL', level), field('REASON', reason), err],
            buttons: [{ text: 'Cancel' }, { text: 'Save', primary: true, onClick: async function () {
                var r = await rpc('admin_set_staff', { p_user: m.id, p_level: level.value || null, p_reason: reason.value.trim() });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not save.'; err.hidden = false; return false; }
                toast('Staff updated'); route();
            } }] });
    }

    function resetPwDialog(m) {
        var reason = el('input', { class: 'ad-field', maxlength: '500', placeholder: 'Reason (required)' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({ title: 'Reset password for @' + m.username,
            body: [el('p', { class: 'ad-help', text: 'This locks them out of the console until they create a new password. Use it if they forgot theirs or you think it leaked.' }), field('REASON', reason), err],
            buttons: [{ text: 'Cancel' }, { text: 'Reset', kind: 'danger', primary: true, onClick: async function () {
                if (reason.value.trim().length < 3) { err.textContent = ERR.reason_required; err.hidden = false; return false; }
                var r = await rpc('admin_reset_staff_password', { p_user: m.id, p_reason: reason.value.trim() });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not reset.'; err.hidden = false; return false; }
                toast('Password reset'); route();
            } }] });
    }

    function addStaffDialog() {
        var q = el('input', { class: 'ad-field', placeholder: 'Search username', autocomplete: 'off' });
        var list = el('div', { class: 'ad-list', style: 'margin-top:10px' });
        var reason = el('input', { class: 'ad-field', maxlength: '500', placeholder: 'Reason (required)' });
        var t = null;
        q.addEventListener('input', function () {
            clearTimeout(t);
            t = setTimeout(async function () {
                if (q.value.trim().length < 2) { clear(list); return; }
                var d = await rpc('admin_find_users', { p_q: q.value.trim() });
                if (!d.ok) return;
                clear(list);
                (d.users || []).slice(0, 6).forEach(function (u) {
                    if (u.staff_level) { list.appendChild(el('div', { class: 'ad-row' }, avatar(u), el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: '@' + u.username }), el('div', { class: 'ad-row-sub', text: 'Already staff (' + u.staff_level + ')' })))); return; }
                    function make(level) { return async function () {
                        if (reason.value.trim().length < 3) { toast(ERR.reason_required, true); reason.focus(); return; }
                        var r = await rpc('admin_set_staff', { p_user: u.id, p_level: level, p_reason: reason.value.trim() });
                        if (r.ok) { toast('@' + u.username + ' is now ' + level); $('adDlg').close(); route(); }
                    }; }
                    list.appendChild(el('div', { class: 'ad-row' }, avatar(u), el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: '@' + u.username })),
                        el('div', { class: 'ad-row-end' }, el('button', { type: 'button', class: 'ad-row-btn', text: 'MAKE MOD', onclick: make('moderator') }), ' ', el('button', { type: 'button', class: 'ad-row-btn', text: 'MAKE ADMIN', onclick: make('admin') }))));
                });
                if (!(d.users || []).length) list.appendChild(el('p', { class: 'ad-empty', text: 'No one found.' }));
            }, 280);
        });
        dialog({ title: 'Add staff member', body: [field('FIND THE PERSON', q), field('REASON', reason), list], buttons: [{ text: 'Close' }] });
    }

    /* ----------------------------------------------------------------------
       NOTIFICATIONS  (publish to Main / Events / System)
       ---------------------------------------------------------------------- */
    var N_CAT_LABEL = { main: 'Main', events: 'Events', system: 'System' };

    function notifRow(n) {
        var audience = n.target_user ? ('@' + (n.target_username || '?')) : 'Everyone';
        return el('div', { class: 'ad-row' },
            el('div', { class: 'ad-row-main' },
                el('div', { class: 'ad-row-title' }, pill(N_CAT_LABEL[n.category] || n.category, n.category === 'system' ? 'warn' : 'info'), ' ', n.title),
                el('div', { class: 'ad-row-sub', text: 'To ' + audience + ' \u00B7 by ' + (n.created_by_username ? '@' + n.created_by_username : 'unknown') + ' \u00B7 ' + ago(n.created_at) }),
                n.body ? el('div', { class: 'ad-row-sub', style: 'margin-top:4px', text: n.body }) : null),
            el('div', { class: 'ad-row-end' },
                el('button', { type: 'button', class: 'ad-row-btn', text: 'DELETE', onclick: async function () {
                    var r = await rpc('admin_delete_notification', { p_id: n.id });
                    if (r.ok) { toast('Deleted'); route(); }
                } })));
    }

    function viewNotifications(root, token) {
        root.appendChild(el('div', { class: 'ad-toolbar' },
            el('button', { type: 'button', class: 'ad-btn', text: '+ Publish announcement', onclick: function () { publishDialog(function () { route(); }); } })));
        root.appendChild(el('p', { class: 'ad-help', style: 'margin-bottom:14px',
            text: 'Main and Events reach everyone or one person; System is for one-off notices like maintenance or content removal. Warnings, suspensions and bans already notify people automatically and are not listed here.' }));

        var list = el('div', { class: 'ad-list' });
        var more = el('button', { type: 'button', class: 'ad-btn ad-btn--ghost', text: 'Load older', hidden: true });
        var empty = el('p', { class: 'ad-empty', text: 'No announcements published yet.', hidden: true });
        root.appendChild(panel('Published announcements', list));
        root.appendChild(el('div', { style: 'margin-top:14px' }, more));
        root.appendChild(empty);

        var last = null, loading = false;
        async function load(reset) {
            if (loading) return;
            loading = true;
            if (reset) { clear(list); last = null; }
            var d = await rpc('admin_list_notifications', { p_limit: 30, p_before: last });
            loading = false;
            if (stale(token) || !d.ok) return;
            (d.entries || []).forEach(function (n) { list.appendChild(notifRow(n)); });
            if ((d.entries || []).length) last = d.entries[d.entries.length - 1].created_at;
            more.hidden = (d.entries || []).length < 30;
            empty.hidden = list.children.length > 0;
        }
        more.addEventListener('click', function () { load(false); });
        load(true);
    }

    function publishDialog(done) {
        var cat = el('select', { class: 'ad-select' }, [['main', 'Main'], ['events', 'Events'], ['system', 'System']]
            .map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        var audEveryone = el('input', { type: 'radio', name: 'aud', value: 'everyone', checked: true });
        var audOne = el('input', { type: 'radio', name: 'aud', value: 'one' });
        var audWrap = el('div', { class: 'ad-roles' },
            el('label', { class: 'ad-role-opt' }, audEveryone, el('span', { text: 'Everyone' })),
            el('label', { class: 'ad-role-opt' }, audOne, el('span', { text: 'Specific person' })));

        var targetQ = el('input', { class: 'ad-field', placeholder: 'Search username', autocomplete: 'off', hidden: true });
        var targetResults = el('div', { class: 'ad-list', style: 'margin-top:8px', hidden: true });
        var targetPicked = el('div', { class: 'ad-help', hidden: true });
        var targetUser = null;

        function pickTarget(u) {
            targetUser = u;
            clear(targetResults); targetResults.hidden = true;
            targetQ.value = '';
            targetPicked.hidden = false;
            clear(targetPicked);
            targetPicked.appendChild(el('span', { text: 'Sending to @' + u.username + ' \u00B7 ' }));
            targetPicked.appendChild(el('button', { type: 'button', class: 'ad-row-btn', text: 'CHANGE', onclick: function () { targetUser = null; targetPicked.hidden = true; targetQ.hidden = false; targetQ.focus(); } }));
        }

        var tTimer = null;
        targetQ.addEventListener('input', function () {
            clearTimeout(tTimer);
            tTimer = setTimeout(async function () {
                if (targetQ.value.trim().length < 2) { clear(targetResults); targetResults.hidden = true; return; }
                var d = await rpc('admin_find_users', { p_q: targetQ.value.trim() }, { quiet: true });
                if (!d.ok) return;
                clear(targetResults);
                targetResults.hidden = false;
                (d.users || []).slice(0, 6).forEach(function (u) {
                    targetResults.appendChild(el('button', { type: 'button', class: 'ad-row', onclick: function () { targetQ.hidden = true; targetResults.hidden = true; pickTarget(u); } },
                        avatar(u), el('div', { class: 'ad-row-main' }, el('div', { class: 'ad-row-title', text: '@' + u.username }))));
                });
                if (!(d.users || []).length) targetResults.appendChild(el('p', { class: 'ad-empty', text: 'No one found.' }));
            }, 280);
        });

        function syncAudience() {
            var one = audOne.checked;
            targetQ.hidden = !one || !!targetUser;
            targetResults.hidden = true;
            targetPicked.hidden = !(one && targetUser);
            if (!one) { targetUser = null; targetPicked.hidden = true; }
        }
        audEveryone.addEventListener('change', syncAudience);
        audOne.addEventListener('change', function () { syncAudience(); targetQ.focus(); });

        var titleIn = el('input', { class: 'ad-field', maxlength: '120', placeholder: 'Short, clear title' });
        var bodyIn = el('textarea', { class: 'ad-area', maxlength: '600', placeholder: 'Optional details' });
        var linkIn = el('input', { class: 'ad-field', placeholder: 'Optional link, must start with https://' });
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });

        dialog({
            title: 'Publish announcement',
            body: [
                field('SEND TO TAB', cat, 'Main shows alongside likes and follows. Events is for event announcements. System is for one-off notices like maintenance or content removal.'),
                field('AUDIENCE', audWrap),
                el('div', {}, targetQ, targetResults, targetPicked),
                field('TITLE', titleIn),
                field('BODY', bodyIn),
                field('LINK (OPTIONAL)', linkIn),
                err
            ],
            buttons: [
                { text: 'Cancel' },
                { text: 'Publish', primary: true, onClick: async function () {
                    err.hidden = true;
                    if (titleIn.value.trim().length < 1) { err.textContent = ERR.title_required; err.hidden = false; return false; }
                    if (audOne.checked && !targetUser) { err.textContent = 'Search for and pick a person first.'; err.hidden = false; return false; }
                    var r = await rpc('admin_publish_notification', {
                        p_category: cat.value,
                        p_title: titleIn.value.trim(),
                        p_body: bodyIn.value.trim() || null,
                        p_link: linkIn.value.trim() || null,
                        p_target_user: audOne.checked ? targetUser.id : null
                    });
                    if (!r.ok) { err.textContent = ERR[r.error] || 'Could not publish that.'; err.hidden = false; return false; }
                    toast('Published');
                    done();
                } }
            ]
        });
    }

    /* ----------------------------------------------------------------------
       CHANGE MY PASSWORD
       ---------------------------------------------------------------------- */
    function changePasswordDialog() {
        var cur = pwInput('adCur', 'current-password', 'Current password');
        var n1 = pwInput('adN1', 'new-password', 'At least 12 characters');
        var n2 = pwInput('adN2', 'new-password', 'Type it again');
        var err = el('div', { class: 'ad-err', hidden: true, role: 'alert' });
        dialog({ title: 'Change admin password', body: [field('CURRENT PASSWORD', cur), field('NEW PASSWORD', n1), field('CONFIRM NEW PASSWORD', n2), err],
            buttons: [{ text: 'Cancel' }, { text: 'Change password', primary: true, onClick: async function () {
                err.hidden = true;
                if (n1.value !== n2.value) { err.textContent = 'The new passwords do not match.'; err.hidden = false; return false; }
                var r = await rpc('admin_set_password', { p_current: cur.value, p_new: n1.value }, { quiet: true });
                if (!r.ok) { err.textContent = ERR[r.error] || 'Could not change it.'; err.hidden = false; return false; }
                S.until = Date.now() + IDLE_MS;
                toast('Password changed');
            } }] });
    }

    /* ----------------------------------------------------------------------
       START
       ---------------------------------------------------------------------- */
    window.addEventListener('hashchange', function () { if (!$('adShell').hidden) route(); });

    document.addEventListener('DOMContentLoaded', function () {
        $('adLockBtn').addEventListener('click', async function () {
            try { await sb.rpc('admin_lock'); } catch (e) { /* ignore */ }
            S.until = 0;
            lockUi('Locked.');
        });
        $('adPwBtn').addEventListener('click', changePasswordDialog);
        if (sb && sb.auth && sb.auth.onAuthStateChange) {
            sb.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') { showGate('signin'); } });
        }
        boot();
    });
})();