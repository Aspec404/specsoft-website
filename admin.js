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
        network: 'Network error. Try again.'
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
        file:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
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

    function roleChip(def) {
        var chip = el('span', { class: 'ad-pill', title: def.name, text: def.icon + ' ' + def.name });
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
            var btn = el('button', { type: 'button', class: 'ad-btn' + (b.kind ? ' ad-btn--' + b.kind : ''), text: b.text });
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
        { id: 'staff',     label: 'Staff',     ico: 'shield', min: 'admin' },
        { id: 'reports',   label: 'Reports',   ico: 'flag',   min: 'moderator', soon: true },
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
        var title = { dashboard: 'Dashboard', users: 'Users', roles: 'Roles', audit: 'Audit log', staff: 'Staff' }[view];
        $('adTitle').textContent = title;
        $('adTopSub').textContent = '';
        var root = clear($('adView'));
        $('adView').scrollTop = 0;

        if (view === 'dashboard') viewDashboard(root, token);
        else if (view === 'users') parts[1] && UUID_RE.test(parts[1]) ? viewUser(root, parts[1].toLowerCase(), token) : viewUsers(root, token);
        else if (view === 'roles') viewRoles(root, token);
        else if (view === 'audit') viewAudit(root, token, parts[1] && UUID_RE.test(parts[1]) ? parts[1].toLowerCase() : null);
        else if (view === 'staff') viewStaff(root, token);
    }

    /* ----------------------------------------------------------------------
       DASHBOARD
       ---------------------------------------------------------------------- */
    var ACTION_LABEL = {
        sanction_issue: 'Sanction issued', sanction_revoke: 'Sanction lifted', note_add: 'Staff note added',
        roles_set: 'Roles changed', role_def_upsert: 'Role definition edited', staff_set: 'Staff changed',
        password_create: 'Admin password created', password_change: 'Admin password changed', password_reset: 'Admin password reset',
        panel_unlock: 'Console unlock'
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
        var results = await Promise.all([rpc('admin_dashboard'), rpc('admin_online_users', {}, { quiet: true })]);
        var d = results[0], on = results[1];
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
            stat('Project reports', d.reports_total, 'all time (cases arrive in Phase 2)'),
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
            .forEach(function (d) { row.appendChild(el('span', { title: d.name, text: d.icon })); });
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
            sl.appendChild(el('div', { class: 'ad-sanction' }, top, el('p', { text: s.reason }),
                s.revoked_at ? el('small', { text: 'Lifted by ' + (s.revoked_by_name || 'unknown') + ' on ' + fmt(s.revoked_at) + (s.revoke_reason ? ': ' + s.revoke_reason : '') }) : null));
        });
        if (!(d.sanctions || []).length) sl.appendChild(el('p', { class: 'ad-empty', text: 'Clean record.' }));
        root.appendChild(panel('Sanctions and warnings', sl));

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
            body: [field(kind === 'warning' ? 'EXPIRES AFTER' : 'DURATION', [select, custom]), field('REASON (REQUIRED)', reason, helps[kind]), err],
            buttons: [
                { text: 'Cancel' },
                { text: titles[kind].replace(/ for$/, ''), kind: kind === 'warning' ? 'warn' : 'danger', primary: true, onClick: async function () {
                    err.hidden = true;
                    if (reason.value.trim().length < 3) { err.textContent = ERR.reason_required; err.hidden = false; return false; }
                    var hours = select.value === 'custom' ? parseInt(custom.value, 10) : (select.value === '' ? null : parseInt(select.value, 10));
                    if (select.value === 'custom' && !(hours > 0)) { err.textContent = ERR.bad_duration; err.hidden = false; return false; }
                    var r = await rpc('admin_issue_sanction', { p_user: p.id, p_kind: kind, p_reason: reason.value.trim(), p_hours: hours });
                    if (!r.ok) { err.textContent = ERR[r.error] || 'Could not apply that.'; err.hidden = false; return false; }
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
                    input, el('span', { class: 'ad-role-ico', text: none ? '\u2205' : def.icon }), el('span', { text: none ? 'NONE' : def.name }));
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
        var ico = el('input', { class: 'ad-field', value: d.icon, maxlength: '8', 'aria-label': 'Icon (emoji or short symbol)' });
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
            preview.appendChild(roleChip({ id: idIn.value, name: name.value || 'Role name', icon: ico.value || '\u2B50', color: c }));
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
                el('div', { class: 'ad-row2' }, el('div', {}, field('ICON', ico)), el('div', {}, field('COLOR', el('div', { style: 'display:flex;gap:8px' }, colorPick, colorHex)))),
                el('div', { class: 'ad-row2' }, el('div', {}, field('RANK (LOWER SHOWS FIRST)', rk)), el('div', {}, field('WHO CAN HAND IT OUT', grant))),
                el('label', { class: 'ad-role-opt', style: 'margin-top:14px' }, activeBox, el('span', { text: 'Active (inactive roles stop showing on the site)' })),
                preview, err],
            buttons: [{ text: 'Cancel' }, { text: 'Save role', primary: true, onClick: async function () {
                err.hidden = true;
                var r = await rpc('admin_upsert_role_def', { p_id: idIn.value.trim(), p_category: cat.value, p_name: name.value, p_icon: ico.value, p_color: colorHex.value, p_rank: parseInt(rk.value, 10) || 100, p_min_grant: grant.value, p_active: activeBox.checked });
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
        ['staff_', 'Staff changes'], ['panel_unlock', 'Console unlocks'], ['password_', 'Passwords'], ['security:', 'Security alerts']];

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