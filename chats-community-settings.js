/* ==========================================================================
   SPECSOFT® — Chats: community settings screen (chats-community-settings.js)
   Needs: supabase-community-settings.sql (run once).
   Load AFTER chats-channels-panels.js and BEFORE chats.js. Exposes window.SPCS.

   Screens: Profile, Members, Roles, Invites, Moderation (log + bans),
            Channels & categories, Pinned/Media (old dialog), Leave / Delete.
   The server checks every action. The browser only hides buttons you cannot use.
   ========================================================================== */
(function () {
    'use strict';

    var BUCKET = 'community-assets';
    var SP = window.SPCH;
    var DAY = 86400000;

    var PERMS = [
        { k: 'send_messages',      g: 'General',    t: 'Send messages',          d: 'Talk in text channels and reply in forum posts.' },
        { k: 'create_posts',       g: 'General',    t: 'Start forum posts',      d: 'Create new posts in discussion channels.' },
        { k: 'post_announcements', g: 'General',    t: 'Post announcements',     d: 'Write in announcement channels.' },
        { k: 'manage_messages',    g: 'Moderation', t: 'Delete messages',        d: 'Delete messages from people ranked below you.' },
        { k: 'manage_threads',     g: 'Moderation', t: 'Manage forum posts',     d: 'Pin, lock and delete forum posts.' },
        { k: 'timeout_members',    g: 'Moderation', t: 'Timeout members',        d: 'Stop someone from posting for a while.' },
        { k: 'kick_members',       g: 'Moderation', t: 'Kick members',           d: 'Remove people. They can come back.' },
        { k: 'ban_members',        g: 'Moderation', t: 'Ban members',            d: 'Remove people and block them from joining again.' },
        { k: 'view_mod_log',       g: 'Moderation', t: 'View moderation log',    d: 'Read the log of who did what.' },
        { k: 'manage_events',      g: 'Community',  t: 'Manage roadmap & events', d: 'Edit roadmap boards and events.' },
        { k: 'manage_channels',    g: 'Community',  t: 'Manage channels',        d: 'Create, edit, delete and reorder channels and sections.' },
        { k: 'manage_invites',     g: 'Community',  t: 'Manage invites',         d: 'Change who can find and join, and make new invite codes.' },
        { k: 'manage_roles',       g: 'Community',  t: 'Manage roles',           d: 'Create roles and give them to people ranked below you.' },
        { k: 'manage_community',   g: 'Community',  t: 'Edit community profile', d: 'Picture, banner, name, description and tags.' }
    ];

    var TPL = [
        { k: 'title',     t: 'Title',     d: 'Cosmetic only. A name and a color, no permissions.' },
        { k: 'member',    t: 'Member',    d: 'Can talk and do the basics.' },
        { k: 'moderator', t: 'Moderator', d: 'Can delete messages, timeout, kick and ban.' },
        { k: 'manager',   t: 'Manager',   d: 'Runs the community: channels, events, invites and people.' },
        { k: 'admin',     t: 'Admin',     d: 'Everything, including roles and the community profile.' }
    ];
    var TPL_FALLBACK = {
        title: [], member: ['send_messages', 'create_posts'],
        moderator: ['send_messages', 'create_posts', 'manage_messages', 'manage_threads', 'timeout_members', 'kick_members', 'ban_members', 'view_mod_log'],
        manager: ['send_messages', 'create_posts', 'post_announcements', 'manage_messages', 'manage_threads', 'manage_events', 'timeout_members', 'kick_members', 'ban_members', 'view_mod_log', 'manage_channels', 'manage_invites'],
        admin: PERMS.map(function (p) { return p.k; })
    };

    var SW = ['#e5484d', '#f5a524', '#e8c547', '#3ddc84', '#2dd4bf', '#4aa8ff', '#8b7bff', '#d46bff', '#ff6bb0', '#9aa0a6'];

    var VIS = [
        { k: 'discoverable', t: 'Discoverable', d: 'Shows up in Discover. Anyone can find it and join.' },
        { k: 'invite_only',  t: 'Invite only',  d: 'Hidden from Discover. People join with the invite code or an invite from you.' },
        { k: 'private',      t: 'Private',      d: 'Hidden and locked. The invite code stops working. Only people you invite by username can join.' }
    ];

    var ERR = {
        bad_color: 'That color is not valid.', bad_permission: 'That permission is not valid.',
        perm_above_you: 'You can only give permissions you have yourself.',
        role_above_you: 'That role is as high as yours or higher.',
        rank_too_low: 'Their role is as high as yours or higher.',
        role_not_found: 'That role no longer exists.', role_limit: 'A community can have up to 25 roles.',
        role_name_taken: 'Another role already has that name.', default_role: 'The default role cannot be deleted.',
        too_many_tags: 'Use up to 8 tags.', bad_path: 'That picture could not be saved.',
        bad_duration: 'Pick a duration up to 28 days.', confirm_mismatch: 'The name you typed does not match.',
        banned: 'That person is banned.', bad_layout: 'Could not save that order. Try again.'
    };

    var META = new Map();                 // roomId -> { avatar_path, banner_path, tags }
    var metaQ = new Set(), metaT = null, metaOff = false;
    var ST = null;                        // state of the open dialog
    var DLG = null, SUB = null;

    /* ----------------------------------------------------------------------
       helpers
       ---------------------------------------------------------------------- */
    function H() { return SP && SP.api ? SP.api.H() : null; }
    function el() { var h = H(); return h.el.apply(null, arguments); }
    function rpc(n, a) { return H().sb.rpc(n, a || {}); }
    function ok(res) { if (res && res.error) throw res.error; return res; }
    function msg(err) {
        var m = String(err && err.message || '');
        for (var k in ERR) if (Object.prototype.hasOwnProperty.call(ERR, k) && m.indexOf(k) >= 0) return ERR[k];
        if (/chat_(community|roles?|member|mod|my_perms|members|bans)/.test(m) && /(schema cache|does not exist|could not find)/i.test(m)) return 'Run supabase-community-settings.sql in your Supabase SQL Editor first.';
        return H().friendly(err);
    }
    function ico(name, cls) {
        var s = document.createElement('span');
        s.className = 'csx-ico' + (cls ? ' ' + cls : '');
        s.setAttribute('aria-hidden', 'true');
        s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
        return s;
    }
    var ICONS = {
        profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
        users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        shield: '<path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z"/>',
        link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
        gavel: '<path d="M14 13l-8.5 8.5a2 2 0 0 1-3-3L11 10"/><path d="M16 16l6-6"/><path d="M8 8l6-6"/><path d="M9 7l8 8"/><path d="M21 11l-8-8"/>',
        layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
        pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
        up: '<polyline points="18 15 12 9 6 15"/>', down: '<polyline points="6 9 12 15 18 9"/>',
        more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
        plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
        close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
        hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
    };

    function btn(label, cls, fn, extra) {
        var p = { type: 'button', class: 'ch-btn ' + (cls || ''), onclick: fn };
        if (extra) for (var k in extra) p[k] = extra[k];
        return el('button', p, el('span', { class: 'ch-btn-label', text: label }), el('span', { class: 'ch-spin', 'aria-hidden': 'true' }));
    }
    function box(kind) { return el('div', { class: 'ch-msgbox csx-msg', role: kind === 'ok' ? 'status' : 'alert' }); }
    function say(b, text, good) { b.className = 'ch-msgbox csx-msg' + (text ? (good ? ' is-ok' : ' is-error') : ''); b.textContent = text || ''; }
    function field(label, input, hint) {
        return el('div', { class: 'csx-field' }, el('label', { class: 'ch-label', text: label }), input, hint ? el('p', { class: 'ch-help', text: hint }) : null);
    }
    function name(p) { return (p && (p.display_name || p.username)) || 'Someone'; }
    function ago(iso) {
        var s = (Date.now() - new Date(iso).getTime()) / 1000;
        if (!isFinite(s)) return '';
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
        return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function left(iso) {
        var ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return 'ending';
        var m = Math.ceil(ms / 60000);
        if (m < 60) return m + 'm';
        if (m < 1440) return Math.round(m / 60) + 'h';
        return Math.round(m / 1440) + 'd';
    }
    function copy(text, ok2) {
        function done() { H().toast(ok2); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { H().toast('Could not copy'); });
        else H().toast('Could not copy');
    }
    function pubUrl(path) {
        if (!path) return null;
        try { return H().sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; } catch (e) { return null; }
    }

    /* ----------------------------------------------------------------------
       community picture + tags in the rest of the app
       ---------------------------------------------------------------------- */
    function queueMeta(id) {
        if (metaOff || !id || META.has(id) || metaQ.has(id)) return;
        metaQ.add(id);
        if (metaT) return;
        metaT = setTimeout(async function () {
            var ids = Array.from(metaQ).slice(0, 100);
            metaQ.clear(); metaT = null;
            try {
                var res = await rpc('chat_community_meta', { p_rooms: ids });
                if (res.error) throw res.error;
                var got = new Set();
                (res.data || []).forEach(function (r) { got.add(r.room_id); META.set(r.room_id, { avatar_path: r.avatar_path, banner_path: r.banner_path, tags: r.tags || [] }); });
                ids.forEach(function (id) { if (!got.has(id)) META.set(id, { avatar_path: null, banner_path: null, tags: [] }); });
                var any = (res.data || []).some(function (r) { return r.avatar_path || (r.tags && r.tags.length); });
                if (any) { try { H().renderList(); } catch (e) { /* ignore */ } }
            } catch (e) { metaOff = true; }       // SQL not run yet: keep the emoji icons
        }, 60);
    }
    function imgEl(url, cls) {
        var i = document.createElement('img');
        i.src = url; i.alt = ''; i.loading = 'lazy'; i.className = cls;
        return i;
    }

    /* ----------------------------------------------------------------------
       image resize (square picture, wide banner). Always re-encoded, so no SVG or odd files get through.
       ---------------------------------------------------------------------- */
    function loadBitmap(file) {
        if (window.createImageBitmap) return createImageBitmap(file);
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file), im = new Image();
            im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
            im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad_image')); };
            im.src = url;
        });
    }
    async function resize(file, w, h) {
        if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('Pick a PNG, JPG, WebP or GIF image.');
        if (file.size > 12 * 1024 * 1024) throw new Error('That image is too big (12 MB max).');
        var bmp = await loadBitmap(file);
        var iw = bmp.width, ih = bmp.height;
        var sc = Math.max(w / iw, h / ih);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, (w - iw * sc) / 2, (h - ih * sc) / 2, iw * sc, ih * sc);
        var blob = await new Promise(function (r) { c.toBlob(r, 'image/webp', 0.86); });
        if (!blob || blob.type !== 'image/webp') blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.88); });
        if (!blob) throw new Error('Could not read that image.');
        return blob;
    }

    /* ----------------------------------------------------------------------
       dialog shell
       ---------------------------------------------------------------------- */
    var NAV = [
        { k: 'profile',    t: 'Profile',               i: 'profile', show: function () { return true; } },
        { k: 'members',    t: 'Members',               i: 'users',   show: function () { return true; } },
        { k: 'roles',      t: 'Roles',                 i: 'shield',  show: function () { return true; } },
        { k: 'invites',    t: 'Invites',               i: 'link',    show: function () { return has('manage_invites'); } },
        { k: 'moderation', t: 'Moderation',            i: 'gavel',   show: function () { return has('view_mod_log') || has('ban_members'); } },
        { k: 'layout',     t: 'Channels & categories', i: 'layout',  show: function () { return has('manage_channels'); } },
        { k: 'background', t: 'Chat background',     i: 'image',   show: function () { return has('manage_community'); }, bg: true },
        { k: 'pinned',     t: 'Pinned messages',       i: 'pin',     show: function () { return true; }, legacy: 'pinned' },
        { k: 'media',      t: 'Media & files',         i: 'image',   show: function () { return true; }, legacy: 'media' },
        { k: 'danger',     t: 'Leave / delete',        i: 'trash',   show: function () { return true; }, danger: true }
    ];

    function has(k) { return !!(ST && ST.perms && (ST.perms.all || ST.perms.set.has(k))); }
    function myRank() { return ST && ST.perms ? ST.perms.rank : 0; }

    function buildDialog() {
        if (DLG) return;
        DLG = document.createElement('dialog');
        DLG.className = 'ch-dlg csx-dlg';
        DLG.setAttribute('aria-labelledby', 'csxTitle');
        DLG.innerHTML =
            '<header class="ch-dlg-head"><h2 id="csxTitle">Community settings</h2>' +
            '<button type="button" class="ch-iconbtn" id="csxClose" aria-label="Close"></button></header>' +
            '<div class="csx-wrap"><nav class="csx-nav" id="csxNav" role="tablist" aria-label="Community settings"></nav>' +
            '<div class="csx-body" id="csxBody" role="tabpanel" tabindex="-1"></div></div>';
        document.body.appendChild(DLG);
        var close = DLG.querySelector('#csxClose');
        close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.close + '</svg>';
        close.addEventListener('click', function () { DLG.close(); });
        DLG.addEventListener('click', function (e) { if (e.target === DLG) DLG.close(); });
        DLG.addEventListener('close', function () { ST = null; if (SUB && SUB.open) SUB.close(); });
    }

    function paintNav() {
        var nav = DLG.querySelector('#csxNav');
        nav.textContent = '';
        NAV.forEach(function (n) {
            if (!n.show()) return;
            var label = n.k === 'danger' ? (ST.owner ? 'Delete community' : 'Leave community') : n.t;
            var b = el('button', {
                type: 'button', role: 'tab', class: 'csx-tab' + (n.danger ? ' is-danger' : '') + (ST.tab === n.k ? ' is-active' : ''),
                'aria-selected': String(ST.tab === n.k), dataset: { tab: n.k },
                onclick: function () { go(n); }
            }, ico(n.i), el('span', { text: label }));
            nav.appendChild(b);
        });
    }

    function go(n) {
        if (n.legacy) { var h = H(); DLG.close(); h.openSettings(n.legacy); return; }
        if (n.bg) { var rm = ST.room; DLG.close(); openBgDialog(rm, 'community'); return; }
        ST.tab = n.k;
        paintNav();
        paintBody();
    }

    function paintBody() {
        var b = DLG.querySelector('#csxBody');
        b.textContent = '';
        b.scrollTop = 0;
        ST.token = (ST.token || 0) + 1;
        var fn = { profile: panelProfile, members: panelMembers, roles: panelRoles, invites: panelInvites, moderation: panelModeration, layout: panelLayout, danger: panelDanger }[ST.tab];
        if (fn) fn(b, ST.token);
    }
    function stale(token) { return !ST || ST.token !== token; }
    function spinner() { return el('div', { class: 'ch-feed-loading' }, el('div', { class: 'ch-spinner', 'aria-hidden': 'true' })); }
    function heading(t, sub) { return el('header', { class: 'csx-head' }, el('h3', { text: t }), sub ? el('p', { text: sub }) : null); }

    /* ----------------------------------------------------------------------
       small second dialog (confirmations, timeout, roles of one person)
       ---------------------------------------------------------------------- */
    function sub(title, build, buttons) {
        if (!SUB) {
            SUB = document.createElement('dialog');
            SUB.className = 'ch-dlg ch-dlg--small csx-sub';
            document.body.appendChild(SUB);
            SUB.addEventListener('click', function (e) { if (e.target === SUB) SUB.close(); });
        }
        SUB.textContent = '';
        var close = el('button', { type: 'button', class: 'ch-iconbtn', 'aria-label': 'Close', onclick: function () { SUB.close(); } });
        close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.close + '</svg>';
        var body = el('div', { class: 'ch-dlg-body csx-sub-body' });
        var m = box();
        body.appendChild(m);
        build(body, m);
        var foot = el('footer', { class: 'ch-dlg-foot' });
        buttons(foot, m, function () { SUB.close(); });
        SUB.appendChild(el('header', { class: 'ch-dlg-head' }, el('h2', { text: title }), close));
        SUB.appendChild(body);
        SUB.appendChild(foot);
        if (!SUB.open) SUB.showModal();
    }

    /* ----------------------------------------------------------------------
       open
       ---------------------------------------------------------------------- */
    async function load(room) {
        var res = await Promise.all([rpc('chat_community_get', { p_room: room.room_id }), rpc('chat_my_perms', { p_room: room.room_id })]);
        ok(res[0]); ok(res[1]);
        var pm = res[1].data || {};
        ST.info = res[0].data || {};
        ST.owner = !!pm.owner || room.role === 'owner';
        var all = room.role === 'owner' || room.role === 'admin' || ST.owner;
        ST.perms = { set: new Set(pm.perms || []), all: all, rank: all ? (ST.owner ? 1000000 : 100000) : (pm.rank || 0) };
        if (pm.rank != null && !all) ST.perms.rank = pm.rank;
    }

    async function open(room, tab) {
        if (!SP || !H() || !room || room.kind !== 'community') return false;
        buildDialog();
        ST = { room: room, tab: tab || 'profile', token: 0, owner: room.role === 'owner', perms: null, info: null, roles: null };
        DLG.querySelector('#csxTitle').textContent = (room.name || 'Community') + ' · settings';
        DLG.querySelector('#csxNav').textContent = '';
        var body = DLG.querySelector('#csxBody');
        body.textContent = '';
        body.appendChild(spinner());
        if (!DLG.open) DLG.showModal();
        var mine = ST;
        try {
            await load(room);
            if (ST !== mine) return true;
            paintNav();
            paintBody();
        } catch (err) {
            if (ST !== mine) return true;
            body.textContent = '';
            body.appendChild(el('div', { class: 'csx-empty' },
                el('p', { text: msg(err) }),
                btn('Open the old settings', 'ch-btn--ghost ch-btn--sm', function () { var h = H(); DLG.close(); h.openSettings('general'); })));
        }
        return true;
    }

    /* ======================================================================
       PROFILE
       ====================================================================== */
    function panelProfile(root, token) {
        var info = ST.info, room = ST.room, can = has('manage_community');
        var draft = { avatar: null, banner: null, clearAvatar: false, clearBanner: false, tags: (info.tags || []).slice() };

        var bannerEl = el('div', { class: 'csx-banner' });
        var avatarEl = el('div', { class: 'csx-pfp' });
        function paintArt() {
            var bUrl = draft.clearBanner ? null : (draft.banner ? draft.banner.url : pubUrl(info.banner_path));
            bannerEl.textContent = '';
            bannerEl.classList.toggle('has-img', !!bUrl);
            if (bUrl) bannerEl.appendChild(imgEl(bUrl, 'csx-banner-img'));
            var aUrl = draft.clearAvatar ? null : (draft.avatar ? draft.avatar.url : pubUrl(info.avatar_path));
            avatarEl.textContent = '';
            if (aUrl) avatarEl.appendChild(imgEl(aUrl, 'csx-pfp-img'));
            else avatarEl.appendChild(el('span', { class: 'csx-pfp-emoji', text: iconIn.value.trim() ? Array.from(iconIn.value.trim())[0] : (info.icon || '💬') }));
        }

        var iconIn = el('input', { class: 'ch-field', maxlength: '8', autocomplete: 'off', value: info.icon || '', disabled: !can, 'aria-label': 'Icon' });
        var nameIn = el('input', { class: 'ch-field', maxlength: '40', autocomplete: 'off', value: info.name || '', disabled: !can, 'aria-label': 'Name' });
        var descIn = el('textarea', { class: 'ch-field', rows: '3', maxlength: '200', disabled: !can, 'aria-label': 'Description' });
        descIn.value = info.description || '';
        var descN = el('span', { class: 'csx-count', text: descIn.value.length + '/200' });
        descIn.addEventListener('input', function () { descN.textContent = descIn.value.length + '/200'; });
        var welIn = el('textarea', { class: 'ch-field', rows: '4', maxlength: '500', disabled: !can, 'aria-label': 'Welcome message' });
        welIn.value = info.welcome || '';
        iconIn.addEventListener('input', function () { if (!draft.avatar && !info.avatar_path) paintArt(); });

        function pick(kind) {
            var f = document.createElement('input');
            f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp,image/gif';
            f.addEventListener('change', async function () {
                var file = f.files && f.files[0];
                if (!file) return;
                try {
                    var blob = await (kind === 'avatar' ? resize(file, 256, 256) : resize(file, 960, 320));
                    var url = URL.createObjectURL(blob);
                    if (draft[kind]) URL.revokeObjectURL(draft[kind].url);
                    draft[kind] = { blob: blob, url: url };
                    draft[kind === 'avatar' ? 'clearAvatar' : 'clearBanner'] = false;
                    say(msgB, '');
                    paintArt();
                } catch (err) { say(msgB, err.message || 'Could not use that image.'); }
            });
            f.click();
        }
        function clear(kind) {
            draft[kind] = null;
            draft[kind === 'avatar' ? 'clearAvatar' : 'clearBanner'] = true;
            paintArt();
        }

        var tagWrap = el('div', { class: 'csx-tagbox' });
        var tagIn = el('input', { class: 'csx-taginput', maxlength: '24', placeholder: can ? 'Add a tag and press Enter' : '', disabled: !can, 'aria-label': 'Add a tag' });
        function paintTags() {
            tagWrap.textContent = '';
            draft.tags.forEach(function (t, i) {
                tagWrap.appendChild(el('span', { class: 'csx-chip' }, '#' + t,
                    can ? el('button', { type: 'button', 'aria-label': 'Remove tag ' + t, onclick: function () { draft.tags.splice(i, 1); paintTags(); } }, '×') : null));
            });
            tagWrap.appendChild(tagIn);
        }
        function addTag() {
            var v = tagIn.value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20);
            tagIn.value = '';
            if (v.length < 2 || draft.tags.indexOf(v) >= 0) return;
            if (draft.tags.length >= 8) { say(msgB, 'Use up to 8 tags.'); return; }
            draft.tags.push(v); paintTags(); tagIn.focus();
        }
        tagIn.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
            else if (e.key === 'Backspace' && !tagIn.value && draft.tags.length) { draft.tags.pop(); paintTags(); tagIn.focus(); }
        });
        tagIn.addEventListener('blur', addTag);

        var msgB = box();
        var save = btn('Save changes', '', async function () {
            say(msgB, '');
            var nm = nameIn.value.trim();
            if (nm.length < 2) { say(msgB, 'Pick a name between 2 and 40 characters.'); return; }
            H().setLoading(save, true);
            var uploaded = [];
            try {
                var avPath = null, bnPath = null;
                if (draft.avatar) { avPath = room.room_id + '/avatar-' + Date.now() + (draft.avatar.blob.type === 'image/webp' ? '.webp' : '.jpg'); ok(await H().sb.storage.from(BUCKET).upload(avPath, draft.avatar.blob, { contentType: draft.avatar.blob.type, cacheControl: '31536000' })); uploaded.push(avPath); }
                if (draft.banner) { bnPath = room.room_id + '/banner-' + Date.now() + (draft.banner.blob.type === 'image/webp' ? '.webp' : '.jpg'); ok(await H().sb.storage.from(BUCKET).upload(bnPath, draft.banner.blob, { contentType: draft.banner.blob.type, cacheControl: '31536000' })); uploaded.push(bnPath); }
                var icn = Array.from(iconIn.value.trim()).slice(0, 2).join('') || info.icon || '💬';
                ok(await rpc('chat_community_profile_save', {
                    p_room: room.room_id, p_name: nm, p_desc: descIn.value.trim().slice(0, 200) || null, p_icon: icn,
                    p_tags: draft.tags, p_welcome: welIn.value.trim().slice(0, 500) || null,
                    p_avatar_path: avPath, p_banner_path: bnPath, p_clear_avatar: draft.clearAvatar, p_clear_banner: draft.clearBanner
                }));
                var old = [];
                if ((avPath || draft.clearAvatar) && info.avatar_path) old.push(info.avatar_path);
                if ((bnPath || draft.clearBanner) && info.banner_path) old.push(info.banner_path);
                if (old.length) { try { await H().sb.storage.from(BUCKET).remove(old); } catch (e) { /* best effort */ } }
                info.name = nm.slice(0, 40); info.description = descIn.value.trim().slice(0, 200) || null; info.icon = icn;
                info.tags = draft.tags.slice(); info.welcome = welIn.value.trim() || null;
                if (draft.clearAvatar) info.avatar_path = null; if (avPath) info.avatar_path = avPath;
                if (draft.clearBanner) info.banner_path = null; if (bnPath) info.banner_path = bnPath;
                room.name = info.name; room.description = info.description; room.icon = info.icon;
                META.set(room.room_id, { avatar_path: info.avatar_path, banner_path: info.banner_path, tags: info.tags });
                draft.avatar = draft.banner = null; draft.clearAvatar = draft.clearBanner = false;
                DLG.querySelector('#csxTitle').textContent = room.name + ' · settings';
                try { H().paintHeader(); H().renderList(); } catch (e) { /* ignore */ }
                say(msgB, 'Saved.', true);
                paintArt();
            } catch (err) {
                if (uploaded.length) { try { await H().sb.storage.from(BUCKET).remove(uploaded); } catch (e) { /* ignore */ } }
                say(msgB, msg(err));
            } finally { H().setLoading(save, false); }
        });
        save.hidden = !can;

        root.appendChild(heading('Community profile', can ? 'How your community looks to everyone.' : 'Only people with the "Edit community profile" permission can change this.'));
        root.appendChild(el('div', { class: 'csx-card csx-hero' },
            bannerEl, avatarEl,
            can ? el('div', { class: 'csx-hero-actions' },
                btn('Upload banner', 'ch-btn--ghost ch-btn--sm', function () { pick('banner'); }),
                btn('Remove banner', 'ch-btn--ghost ch-btn--sm', function () { clear('banner'); }),
                btn('Upload picture', 'ch-btn--ghost ch-btn--sm', function () { pick('avatar'); }),
                btn('Remove picture', 'ch-btn--ghost ch-btn--sm', function () { clear('avatar'); })) : null));
        root.appendChild(msgB);
        root.appendChild(el('div', { class: 'csx-row2' }, field('ICON (SHOWN WITHOUT A PICTURE)', iconIn), field('NAME', nameIn)));
        root.appendChild(field('DESCRIPTION', descIn));
        root.appendChild(el('div', { class: 'csx-right' }, descN));
        root.appendChild(field('TAGS', tagWrap, 'Up to 8. They help people find you in Discover.'));
        root.appendChild(field('WELCOME MESSAGE', welIn, 'A short note for new members (500 characters max).'));
        root.appendChild(save);
        paintArt(); paintTags();

        // activity (only for people who run the community)
        if (has('manage_community') || has('manage_channels') || has('view_mod_log')) {
            var card = el('div', { class: 'csx-card csx-insights' }, el('h4', { text: 'Last 7 days' }), spinner());
            root.appendChild(card);
            rpc('chat_community_insights', { p_room: room.room_id }).then(function (res) {
                if (stale(token)) return;
                if (res.error) { card.remove(); return; }
                var d = res.data || {};
                card.textContent = '';
                card.appendChild(el('h4', { text: 'Last 7 days' }));
                card.appendChild(el('div', { class: 'csx-stats' },
                    stat(d.members, 'members'), stat(d.messages_7d, 'messages'), stat(d.active_7d, 'people talked')));
                var top = d.top_channels || [], max = top.reduce(function (a, c) { return Math.max(a, c.messages); }, 1);
                if (top.length) {
                    var list = el('div', { class: 'csx-bars' });
                    top.forEach(function (c) {
                        list.appendChild(el('div', { class: 'csx-bar' }, ico('hash'), el('span', { class: 'csx-bar-name', text: c.name }),
                            el('span', { class: 'csx-bar-track' }, el('i', { style: 'width:' + Math.max(4, Math.round(c.messages / max * 100)) + '%' })),
                            el('span', { class: 'csx-bar-n', text: String(c.messages) })));
                    });
                    card.appendChild(list);
                }
            });
        }
    }
    function stat(n, label) { return el('div', { class: 'csx-stat' }, el('strong', { text: String(n == null ? 0 : n) }), el('span', { text: label })); }


    /* ======================================================================
       ROLES (shared helpers)
       ====================================================================== */
    async function loadRoles(force) {
        if (ST.roles && !force) return ST.roles;
        var res = ok(await rpc('chat_roles_list', { p_room: ST.room.room_id }));
        ST.roles = res.data || { roles: [], catalog: [], templates: {} };
        return ST.roles;
    }
    function roleById(id) {
        var rs = (ST.roles && ST.roles.roles) || [];
        for (var i = 0; i < rs.length; i++) if (rs[i].id === id) return rs[i];
        return null;
    }
    function roleRank(r) { return r.is_default ? 0 : 1000 - r.position; }
    function tplPerms(k) { return ((ST.roles && ST.roles.templates && ST.roles.templates[k]) || TPL_FALLBACK[k] || []).slice(); }
    function dot(color) { var d = el('i', { class: 'csx-dot' }); if (color) d.style.background = color; else d.classList.add('is-none'); return d; }
    function roleChip(r) {
        var c = el('span', { class: 'csx-rchip' }, dot(r.color), r.name);
        return c;
    }

    /* ======================================================================
       MEMBERS
       ====================================================================== */
    function panelMembers(root, token) {
        var me = H().S.me.id;
        var q = '', offset = 0, total = 0, rows = [];
        var list = el('div', { class: 'csx-members' });
        var more = btn('Load more', 'ch-btn--ghost', function () { fetchMembers(false); });
        more.hidden = true;
        var count = el('span', { class: 'csx-count' });
        var search = el('input', { class: 'ch-field csx-search', type: 'search', placeholder: 'Search members', 'aria-label': 'Search members', autocomplete: 'off', maxlength: '40' });
        var t = null;
        search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { q = search.value; fetchMembers(true); }, 280); });

        root.appendChild(heading('Members', 'Everyone in the community. People with the right permissions can manage them here.'));
        root.appendChild(el('div', { class: 'csx-toolbar' }, search, count));
        root.appendChild(list);
        root.appendChild(more);

        async function fetchMembers(reset) {
            if (reset) { offset = 0; rows = []; list.textContent = ''; list.appendChild(spinner()); }
            var mine = token;
            try {
                await loadRoles(false);
                var res = ok(await rpc('chat_members_list', { p_room: ST.room.room_id, p_query: q || null, p_limit: 50, p_offset: offset }));
                if (stale(mine)) return;
                var d = res.data || {};
                total = d.total || 0;
                if (reset) list.textContent = '';
                (d.members || []).forEach(function (m) { rows.push(m); list.appendChild(memberRow(m)); });
                offset += (d.members || []).length;
                count.textContent = total + (total === 1 ? ' member' : ' members');
                more.hidden = offset >= total;
                if (!rows.length) list.appendChild(el('p', { class: 'csx-empty-line', text: q ? 'Nobody matches that.' : 'No members.' }));
            } catch (err) {
                if (stale(mine)) return;
                list.textContent = '';
                list.appendChild(el('p', { class: 'csx-empty-line', text: msg(err) }));
            }
        }

        function actions(m) {
            var isMe = m.user_id === me, outrank = !isMe && myRank() > m.rank;
            var a = [];
            if (!isMe) a.push({ t: 'Send message', run: function () { var h = H(); DLG.close(); h.startDm(m.user_id); } });
            if (has('manage_roles') && outrank) a.push({ t: 'Roles…', run: function () { rolesDialog(m); } });
            if (has('timeout_members') && outrank) a.push(m.timeout_until ? { t: 'Remove timeout', run: function () { doTimeout(m, 0, null); } } : { t: 'Timeout…', run: function () { timeoutDialog(m); } });
            if (has('kick_members') && outrank) a.push({ t: 'Kick…', danger: true, run: function () { reasonDialog(m, 'kick'); } });
            if (has('ban_members') && outrank) a.push({ t: 'Ban…', danger: true, run: function () { reasonDialog(m, 'ban'); } });
            return a;
        }

        function memberRow(m) {
            var p = { id: m.user_id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url };
            var chips = el('span', { class: 'csx-chips' });
            if (m.is_owner) chips.appendChild(el('span', { class: 'csx-rchip is-owner', text: 'OWNER' }));
            else if (m.base_role === 'admin') chips.appendChild(el('span', { class: 'csx-rchip is-owner', text: 'ADMIN' }));
            (m.role_ids || []).forEach(function (id) { var r = roleById(id); if (r) chips.appendChild(roleChip(r)); });
            if (m.timeout_until) chips.appendChild(el('span', { class: 'csx-rchip is-timeout', title: 'In timeout' }, ico('clock'), left(m.timeout_until)));
            var acts = actions(m);
            var row = el('div', { class: 'csx-member' },
                el('span', { class: 'csx-member-av' }, H().avatar(p, 38)),
                el('span', { class: 'csx-member-main' },
                    el('strong', { text: name(p) + (m.user_id === me ? ' (you)' : '') }),
                    el('small', { text: '@' + (m.username || 'member') }), chips),
                acts.length ? el('button', { type: 'button', class: 'ch-iconbtn', 'aria-label': 'Manage ' + name(p), title: 'Manage', onclick: function () { manageDialog(m, p, acts); } }, ico('more')) : null);
            return row;
        }

        function refreshRow() { fetchMembers(true); }

        function manageDialog(m, p, acts) {
            sub(name(p), function (body) {
                body.appendChild(el('p', { class: 'ch-help', text: '@' + (m.username || 'member') }));
                var l = el('div', { class: 'csx-actions' });
                acts.forEach(function (a) {
                    l.appendChild(el('button', { type: 'button', class: 'csx-action' + (a.danger ? ' is-danger' : ''), onclick: function () { a.run(); } }, a.t));
                });
                body.appendChild(l);
            }, function (foot, mb, close) { foot.appendChild(btn('Close', 'ch-btn--ghost', close)); });
        }

        function rolesDialog(m) {
            var roles = ((ST.roles && ST.roles.roles) || []).filter(function (r) { return !r.is_default; });
            var picked = new Set(m.role_ids || []);
            sub('Roles for ' + name(m), function (body) {
                if (!roles.length) body.appendChild(el('p', { class: 'ch-help', text: 'There are no roles yet. Make some in the Roles tab.' }));
                roles.forEach(function (r) {
                    var allowed = ST.perms.all || roleRank(r) < myRank();
                    var cb = el('input', { type: 'checkbox', checked: picked.has(r.id), disabled: !allowed });
                    cb.addEventListener('change', function () { if (cb.checked) picked.add(r.id); else picked.delete(r.id); });
                    body.appendChild(el('label', { class: 'ch-check csx-rolepick' }, cb, el('span', { class: 'ch-box', 'aria-hidden': 'true' }), dot(r.color),
                        el('span', { text: r.name + (allowed ? '' : ' (above you)') })));
                });
            }, function (foot, mb, close) {
                foot.appendChild(btn('Cancel', 'ch-btn--ghost', close));
                var s = btn('Save roles', '', async function () {
                    H().setLoading(s, true);
                    try {
                        ok(await rpc('chat_member_roles_set', { p_room: ST.room.room_id, p_user: m.user_id, p_role_ids: Array.from(picked) }));
                        close(); H().toast('Roles updated'); refreshRow();
                    } catch (err) { say(mb, msg(err)); }
                    finally { H().setLoading(s, false); }
                });
                foot.appendChild(s);
            });
        }

        async function doTimeout(m, minutes, reason) {
            try {
                ok(await rpc('chat_member_timeout', { p_room: ST.room.room_id, p_user: m.user_id, p_minutes: minutes, p_reason: reason }));
                H().toast(minutes > 0 ? 'Timeout set' : 'Timeout removed');
                if (SUB && SUB.open) SUB.close();
                refreshRow();
            } catch (err) { H().toast(msg(err)); }
        }

        function timeoutDialog(m) {
            var mins = 10, reason = el('input', { class: 'ch-field', maxlength: '200', placeholder: 'Reason (optional)', 'aria-label': 'Reason' });
            var opts = [[5, '5 minutes'], [10, '10 minutes'], [60, '1 hour'], [1440, '1 day'], [10080, '1 week']];
            sub('Timeout ' + name(m), function (body) {
                body.appendChild(el('p', { class: 'ch-help', text: 'They can read, but they cannot post until it ends.' }));
                var seg = el('div', { class: 'csx-seg', role: 'radiogroup', 'aria-label': 'Duration' });
                opts.forEach(function (o) {
                    var b = el('button', { type: 'button', role: 'radio', class: o[0] === mins ? 'is-on' : '', 'aria-checked': String(o[0] === mins), onclick: function () {
                        mins = o[0];
                        seg.querySelectorAll('button').forEach(function (x) { x.classList.remove('is-on'); x.setAttribute('aria-checked', 'false'); });
                        b.classList.add('is-on'); b.setAttribute('aria-checked', 'true');
                    } }, o[1]);
                    seg.appendChild(b);
                });
                body.appendChild(seg);
                body.appendChild(reason);
            }, function (foot, mb, close) {
                foot.appendChild(btn('Cancel', 'ch-btn--ghost', close));
                foot.appendChild(btn('Timeout', '', function () { doTimeout(m, mins, reason.value.trim() || null); }));
            });
        }

        function reasonDialog(m, kind) {
            var reason = el('input', { class: 'ch-field', maxlength: '200', placeholder: 'Reason (optional)', 'aria-label': 'Reason' });
            var ban = kind === 'ban';
            sub((ban ? 'Ban ' : 'Kick ') + name(m), function (body) {
                body.appendChild(el('p', { class: 'ch-help', text: ban ? 'They are removed and cannot join again until you unban them.' : 'They are removed, but they can join again with an invite.' }));
                body.appendChild(reason);
            }, function (foot, mb, close) {
                foot.appendChild(btn('Cancel', 'ch-btn--ghost', close));
                var go2 = btn(ban ? 'Ban' : 'Kick', 'ch-btn--danger', async function () {
                    H().setLoading(go2, true);
                    try {
                        ok(await rpc(ban ? 'chat_member_ban' : 'chat_member_kick', { p_room: ST.room.room_id, p_user: m.user_id, p_reason: reason.value.trim() || null }));
                        close(); H().toast(ban ? 'Banned' : 'Kicked'); refreshRow();
                        try { H().S.current && (H().S.current.member_count = Math.max(0, (H().S.current.member_count || 1) - 1)); H().paintHeader(); } catch (e) { /* ignore */ }
                    } catch (err) { say(mb, msg(err)); }
                    finally { H().setLoading(go2, false); }
                });
                foot.appendChild(go2);
            });
        }

        fetchMembers(true);
    }

    /* ======================================================================
       ROLES
       ====================================================================== */
    function panelRoles(root, token) {
        var canEdit = has('manage_roles');
        var listEl = el('div', { class: 'csx-rolelist' });
        var edEl = el('div', { class: 'csx-roleed' });
        var sel = null;                    // selected role id, or 'new'
        var draft = null;

        root.appendChild(heading('Roles', canEdit ? 'Roles give people a color and permissions. Higher roles outrank lower ones.' : 'The roles in this community. Only people with the "Manage roles" permission can change them.'));
        root.appendChild(el('div', { class: 'csx-roles' }, listEl, edEl));
        listEl.appendChild(spinner());

        loadRoles(true).then(function () { if (stale(token)) return; paintList(); select(firstEditable()); }).catch(function (err) {
            if (stale(token)) return;
            listEl.textContent = ''; listEl.appendChild(el('p', { class: 'csx-empty-line', text: msg(err) }));
        });

        function roles() { return ST.roles.roles; }
        function editable(r) { return canEdit && (r.is_default || ST.perms.all || roleRank(r) < myRank()); }
        function firstEditable() { var rs = roles(); return rs.length ? rs[0].id : null; }

        function paintList() {
            listEl.textContent = '';
            if (canEdit) listEl.appendChild(btn('New role', 'ch-btn--sm csx-newrole', function () { newPicker(); }));
            var rs = roles(), movable = rs.filter(function (r) { return !r.is_default; });
            rs.forEach(function (r) {
                var i = movable.indexOf(r);
                var up = null, dn = null;
                if (editable(r) && !r.is_default) {
                    var pv = movable[i - 1], nx = movable[i + 1];
                    if (pv && editable(pv)) up = el('button', { type: 'button', class: 'ch-iconbtn csx-mini', 'aria-label': 'Move ' + r.name + ' up', title: 'Move up', onclick: function (e) { e.stopPropagation(); move(i, -1); } }, ico('up'));
                    if (nx && editable(nx)) dn = el('button', { type: 'button', class: 'ch-iconbtn csx-mini', 'aria-label': 'Move ' + r.name + ' down', title: 'Move down', onclick: function (e) { e.stopPropagation(); move(i, 1); } }, ico('down'));
                }
                listEl.appendChild(el('div', { class: 'csx-roleitem' + (sel === r.id ? ' is-active' : '') },
                    el('button', { type: 'button', class: 'csx-rolebtn', onclick: function () { select(r.id); } },
                        dot(r.color), el('span', { class: 'csx-rolename', text: r.name }),
                        el('small', { text: r.is_default ? 'everyone' : (r.members + (r.members === 1 ? ' person' : ' people')) })),
                    up, dn));
            });
        }

        async function move(i, dir) {
            var ids = roles().filter(function (r) { return !r.is_default; }).map(function (r) { return r.id; });
            var j = i + dir;
            if (j < 0 || j >= ids.length) return;
            var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
            try {
                ok(await rpc('chat_roles_reorder', { p_room: ST.room.room_id, p_ids: ids }));
                await loadRoles(true);
                if (stale(token)) return;
                paintList();
                SP.reloadPerms && SP.reloadPerms(ST.room.room_id);
            } catch (err) { H().toast(msg(err)); }
        }

        function select(id) {
            sel = id;
            var r = id ? roleById(id) : null;
            if (!r) { paintList(); edEl.textContent = ''; return; }
            draft = { id: r.id, name: r.name, color: r.color, template: r.template || 'custom', perms: new Set(r.perms), isDefault: r.is_default, members: r.members };
            paintList(); paintEditor(editable(r));
        }

        function newPicker() {
            sel = 'new'; draft = null; paintList();
            edEl.textContent = '';
            edEl.appendChild(el('h4', { class: 'csx-edtitle', text: 'Start from a template' }));
            var grid = el('div', { class: 'csx-tpls' });
            TPL.concat([{ k: 'custom', t: 'Blank', d: 'Start empty and pick permissions yourself.' }]).forEach(function (t) {
                grid.appendChild(el('button', { type: 'button', class: 'csx-tpl', onclick: function () {
                    var perms = t.k === 'custom' ? [] : tplPerms(t.k).filter(function (p) { return ST.perms.all || has(p); });
                    draft = { id: null, name: t.k === 'custom' ? 'New role' : t.t, color: null, template: t.k, perms: new Set(perms), isDefault: false, members: 0 };
                    paintEditor(true);
                } }, el('strong', { text: t.t }), el('span', { text: t.d })));
            });
            edEl.appendChild(grid);
        }

        function paintEditor(canChange) {
            edEl.textContent = '';
            var d = draft, m = box();
            var nameIn = el('input', { class: 'ch-field', maxlength: '32', value: d.name, disabled: !canChange, 'aria-label': 'Role name' });
            nameIn.addEventListener('input', function () { d.name = nameIn.value; });

            var colorIn = el('input', { type: 'color', class: 'csx-color', value: d.color || '#9aa0a6', disabled: !canChange, 'aria-label': 'Custom color' });
            var sw = el('div', { class: 'csx-swatches' });
            function paintSw() {
                sw.textContent = '';
                sw.appendChild(el('button', { type: 'button', class: 'csx-sw is-none' + (!d.color ? ' is-on' : ''), disabled: !canChange, 'aria-label': 'No color', title: 'No color', onclick: function () { d.color = null; paintSw(); } }, '∅'));
                SW.forEach(function (c) {
                    var b = el('button', { type: 'button', class: 'csx-sw' + (d.color === c ? ' is-on' : ''), disabled: !canChange, 'aria-label': 'Color ' + c, onclick: function () { d.color = c; colorIn.value = c; paintSw(); } });
                    b.style.background = c; sw.appendChild(b);
                });
                sw.appendChild(colorIn);
            }
            colorIn.addEventListener('input', function () { d.color = colorIn.value; paintSw(); });
            paintSw();

            var permsBox = el('div', { class: 'csx-perms' });
            function paintPerms() {
                permsBox.textContent = '';
                var title = d.template === 'title';
                if (title) permsBox.appendChild(el('p', { class: 'ch-help', text: 'Title roles are cosmetic. Pick another template to give permissions.' }));
                var group = null;
                PERMS.forEach(function (p) {
                    if (p.g !== group) { group = p.g; permsBox.appendChild(el('h5', { class: 'csx-pgroup', text: p.g })); }
                    var mayGive = ST.perms.all || has(p.k) || d.perms.has(p.k);
                    var cb = el('input', { type: 'checkbox', checked: d.perms.has(p.k) && !title, disabled: !canChange || title || !mayGive });
                    cb.addEventListener('change', function () { if (cb.checked) d.perms.add(p.k); else d.perms.delete(p.k); d.template = 'custom'; });
                    permsBox.appendChild(el('label', { class: 'ch-check csx-perm' }, cb, el('span', { class: 'ch-box', 'aria-hidden': 'true' }),
                        el('span', { class: 'csx-perm-text' }, el('strong', { text: p.t }), el('small', { text: mayGive ? p.d : 'You do not have this permission yourself.' }))));
                });
            }
            paintPerms();

            var tplRow = el('div', { class: 'csx-tplrow', role: 'group', 'aria-label': 'Apply a template' });
            if (canChange) {
                TPL.forEach(function (t) {
                    tplRow.appendChild(el('button', { type: 'button', class: 'csx-chipbtn' + (d.template === t.k ? ' is-on' : ''), title: t.d, onclick: function () {
                        d.template = t.k;
                        d.perms = new Set(t.k === 'title' ? [] : tplPerms(t.k).filter(function (p) { return ST.perms.all || has(p) || d.perms.has(p); }));
                        paintEditor(canChange);
                    } }, t.t));
                });
            }

            var save = btn(d.id ? 'Save role' : 'Create role', '', async function () {
                say(m, '');
                if (!d.name.trim()) { say(m, 'Give the role a name.'); return; }
                H().setLoading(save, true);
                try {
                    var res = ok(await rpc('chat_role_save', { p_room: ST.room.room_id, p_id: d.id, p_name: d.name.trim(), p_color: d.color, p_perms: d.template === 'title' ? [] : Array.from(d.perms), p_template: d.template }));
                    await loadRoles(true);
                    if (stale(token)) return;
                    select(res.data || d.id);
                    SP.reloadPerms && SP.reloadPerms(ST.room.room_id);
                    H().toast('Role saved');
                } catch (err) { say(m, msg(err)); }
                finally { H().setLoading(save, false); }
            });
            var del = d.id && !d.isDefault ? btn('Delete role', 'ch-btn--ghost ch-btn--danger', function () {
                sub('Delete "' + d.name + '"?', function (body) {
                    body.appendChild(el('p', { class: 'ch-help', text: 'People who have this role lose it. This cannot be undone.' }));
                }, function (foot, mb, close) {
                    foot.appendChild(btn('Cancel', 'ch-btn--ghost', close));
                    var yes = btn('Delete', 'ch-btn--danger', async function () {
                        H().setLoading(yes, true);
                        try {
                            ok(await rpc('chat_role_delete', { p_role: d.id }));
                            close(); await loadRoles(true);
                            if (stale(token)) return;
                            sel = null; draft = null; paintList(); select(firstEditable());
                            SP.reloadPerms && SP.reloadPerms(ST.room.room_id);
                        } catch (err) { say(mb, msg(err)); }
                        finally { H().setLoading(yes, false); }
                    });
                    foot.appendChild(yes);
                });
            }) : null;

            edEl.appendChild(el('h4', { class: 'csx-edtitle', text: d.id ? 'Edit role' : 'New role' }));
            if (d.isDefault) edEl.appendChild(el('p', { class: 'ch-help', text: 'Everyone in the community has this role. Its permissions apply to all members.' }));
            if (!canChange) edEl.appendChild(el('p', { class: 'ch-help', text: canEdit ? 'This role is as high as yours or higher, so you can only look at it.' : 'You can look at this role, but not change it.' }));
            edEl.appendChild(m);
            edEl.appendChild(field('NAME', nameIn));
            edEl.appendChild(field('COLOR', sw));
            if (canChange) edEl.appendChild(field('TEMPLATE', tplRow, 'Templates fill in the permissions below. You can still change them.'));
            edEl.appendChild(field('PERMISSIONS', permsBox));
            if (canChange) edEl.appendChild(el('div', { class: 'csx-btnrow' }, save, del));
        }
    }

    /* ======================================================================
       INVITES
       ====================================================================== */
    function panelInvites(root, token) {
        var info = ST.info, room = ST.room;
        var m = box();
        var visBox = el('div', { class: 'csx-vis', role: 'radiogroup', 'aria-label': 'Who can find this community' });
        var codeBox = el('div', { class: 'csx-codebox' });

        function paintVis() {
            visBox.textContent = '';
            VIS.forEach(function (v) {
                var on = info.visibility === v.k;
                visBox.appendChild(el('button', { type: 'button', role: 'radio', class: 'csx-visopt' + (on ? ' is-on' : ''), 'aria-checked': String(on), onclick: function () { setVis(v.k); } },
                    el('strong', { text: v.t }), el('span', { text: v.d })));
            });
        }
        async function setVis(k) {
            if (k === info.visibility) return;
            say(m, '');
            try {
                ok(await rpc('chat_community_visibility_set', { p_room: room.room_id, p_visibility: k }));
                info.visibility = k;
                room.is_public = k === 'discoverable';
                paintVis(); paintCode();
                say(m, 'Saved.', true);
            } catch (err) { say(m, msg(err)); }
        }
        function paintCode() {
            codeBox.textContent = '';
            if (info.visibility === 'private') {
                codeBox.appendChild(el('p', { class: 'ch-help', text: 'The invite code is turned off while the community is private. Invite people by username below.' }));
                return;
            }
            var code = info.invite_code || room.invite_code;
            codeBox.appendChild(el('span', { class: 'ch-label', text: 'INVITE CODE' }));
            codeBox.appendChild(el('div', { class: 'ch-set-code' },
                el('code', { text: code || '—' }),
                btn('Copy', 'ch-btn--ghost', function () { if (code) copy(code, 'Invite code copied'); }),
                btn('New code', 'ch-btn--ghost', function () {
                    sub('Make a new code?', function (body) { body.appendChild(el('p', { class: 'ch-help', text: 'The old code stops working right away.' })); },
                        function (foot, mb, close) {
                            foot.appendChild(btn('Cancel', 'ch-btn--ghost', close));
                            var y = btn('New code', '', async function () {
                                H().setLoading(y, true);
                                try {
                                    var res = ok(await rpc('chat_community_regen_code', { p_room: room.room_id }));
                                    info.invite_code = String(res.data || ''); room.invite_code = info.invite_code;
                                    close(); paintCode(); H().toast('New invite code ready');
                                } catch (err) { say(mb, msg(err)); }
                                finally { H().setLoading(y, false); }
                            });
                            foot.appendChild(y);
                        });
                })));
        }

        var userIn = el('input', { class: 'ch-field', maxlength: '21', placeholder: '@username', autocomplete: 'off', 'aria-label': 'Username to invite' });
        var im = box();
        var send = btn('Send invite', '', async function () {
            var u = userIn.value.trim().replace(/^@/, '');
            if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) { say(im, 'Enter a valid username.'); return; }
            H().setLoading(send, true);
            try {
                ok(await rpc('chat_invite', { p_room: room.room_id, p_username: u }));
                userIn.value = ''; say(im, 'Invite sent to @' + u + '.', true);
            } catch (err) { say(im, msg(err)); }
            finally { H().setLoading(send, false); }
        });

        root.appendChild(heading('Invites', 'Choose who can find and join this community.'));
        root.appendChild(m);
        root.appendChild(visBox);
        root.appendChild(codeBox);
        root.appendChild(el('div', { class: 'csx-card' }, el('h4', { text: 'Invite someone by username' }), im, el('div', { class: 'csx-inline' }, userIn, send)));
        paintVis(); paintCode();
    }

    /* ======================================================================
       MODERATION: log + bans
       ====================================================================== */
    var GROUPS = [['', 'All'], ['moderation', 'Moderation'], ['members', 'Joins & leaves'], ['roles', 'Roles'], ['channels', 'Channels'], ['community', 'Community']];

    function who(p) { return el('strong', { class: 'csx-who', text: p && p.id ? name(p) : 'Someone' }); }
    function describe(e) {
        var a = who(e.actor), t = who(e.target), mt = e.meta || {};
        var reason = mt.reason ? el('em', { class: 'csx-reason', text: ' "' + mt.reason + '"' }) : null;
        switch (e.action) {
            case 'member.join':          return [t, ' joined'];
            case 'member.leave':         return [t, ' left'];
            case 'member.kick':          return [a, ' kicked ', t, reason];
            case 'member.ban':           return [a, ' banned ', t, reason];
            case 'member.unban':         return [a, ' unbanned ', t];
            case 'member.timeout':       return [a, ' timed out ', t, ' for ' + (mt.minutes >= 1440 ? Math.round(mt.minutes / 1440) + 'd' : mt.minutes >= 60 ? Math.round(mt.minutes / 60) + 'h' : mt.minutes + 'm'), reason];
            case 'member.timeout_clear': return [a, ' removed the timeout of ', t];
            case 'message.delete':       return [a, ' deleted a message by ', t];
            case 'member.roles':         return [a, ' changed roles of ', t, ': ' + [].concat((mt.added || []).map(function (x) { return '+' + x; }), (mt.removed || []).map(function (x) { return '−' + x; })).join(', ')];
            case 'role.save':            return [a, mt.created ? ' created role ' : ' updated role ', el('strong', { text: mt.name || '' })];
            case 'role.delete':          return [a, ' deleted role ', el('strong', { text: mt.name || '' })];
            case 'role.reorder':         return [a, ' reordered the roles'];
            case 'channel.create':       return [a, ' created #' + (mt.name || 'channel')];
            case 'channel.update':       return [a, ' edited #' + (mt.name || 'channel')];
            case 'channel.delete':       return [a, ' deleted #' + (mt.name || 'channel')];
            case 'channel.member_add':   return [a, ' added ', t, ' to a private channel'];
            case 'channel.member_remove': return [a, ' removed ', t, ' from a private channel'];
            case 'section.create':       return [a, ' created section ' + (mt.name || '')];
            case 'section.update':       return [a, ' renamed a section to ' + (mt.name || '')];
            case 'section.delete':       return [a, ' deleted a section'];
            case 'layout.update':        return [a, ' reordered channels and sections'];
            case 'thread.update':        return [a, ' changed a forum post'];
            case 'thread.delete':        return [a, ' deleted the forum post "' + (mt.title || '') + '"'];
            case 'community.profile':    return [a, ' updated the community profile'];
            case 'community.background': return [a, ' changed the community background'];
            case 'invite.visibility':    return [a, ' set the community to ' + String(mt.visibility || '').replace('_', ' ')];
            case 'invite.regen':         return [a, ' made a new invite code'];
            default:                     return [a, ' ' + e.action];
        }
    }
    function plain(e) {
        var d = describe(e), s = '';
        d.forEach(function (x) { if (x == null) return; s += typeof x === 'string' ? x : x.textContent; });
        return s;
    }

    function panelModeration(root, token) {
        var showLog = has('view_mod_log'), showBans = has('ban_members');
        var view = showLog ? 'log' : 'bans';
        var body = el('div', { class: 'csx-modbody' });
        var seg = el('div', { class: 'csx-seg csx-seg--tabs', role: 'tablist' });
        function paintSeg() {
            seg.textContent = '';
            if (showLog) seg.appendChild(el('button', { type: 'button', role: 'tab', class: view === 'log' ? 'is-on' : '', 'aria-selected': String(view === 'log'), onclick: function () { view = 'log'; paintSeg(); paintView(); } }, 'Moderation log'));
            if (showBans) seg.appendChild(el('button', { type: 'button', role: 'tab', class: view === 'bans' ? 'is-on' : '', 'aria-selected': String(view === 'bans'), onclick: function () { view = 'bans'; paintSeg(); paintView(); } }, 'Bans'));
        }
        root.appendChild(heading('Moderation', 'See what happened and who did it.'));
        if (showLog && showBans) root.appendChild(seg);
        root.appendChild(body);
        paintSeg(); paintView();
        function paintView() { body.textContent = ''; if (view === 'log') logView(body, token); else bansView(body, token); }
    }

    function logView(root, token) {
        var group = '', rows = [], done = false, busy = false;
        var chips = el('div', { class: 'csx-filters', role: 'radiogroup', 'aria-label': 'Filter the log' });
        var list = el('div', { class: 'csx-log' });
        var more = btn('Load more', 'ch-btn--ghost', function () { fetchLog(false); });
        more.hidden = true;
        function paintChips() {
            chips.textContent = '';
            GROUPS.forEach(function (g) {
                chips.appendChild(el('button', { type: 'button', role: 'radio', 'aria-checked': String(group === g[0]), class: 'csx-chipbtn' + (group === g[0] ? ' is-on' : ''), onclick: function () { group = g[0]; paintChips(); fetchLog(true); } }, g[1]));
            });
        }
        var exp = btn('Export CSV', 'ch-btn--ghost ch-btn--sm', function () {
            if (!rows.length) { H().toast('Nothing to export'); return; }
            function q(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; }
            var csv = ['time,action,actor,target,details'].concat(rows.map(function (e) {
                return [q(e.created_at), q(e.action), q(e.actor && e.actor.username), q(e.target && e.target.username), q(plain(e))].join(',');
            })).join('\n');
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            a.download = 'moderation-log.csv';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        });
        root.appendChild(el('div', { class: 'csx-toolbar' }, chips, exp));
        root.appendChild(list);
        root.appendChild(more);
        paintChips(); fetchLog(true);

        async function fetchLog(reset) {
            if (busy) return;
            busy = true;
            if (reset) { rows = []; done = false; list.textContent = ''; list.appendChild(spinner()); }
            try {
                var before = !reset && rows.length ? rows[rows.length - 1].created_at : null;
                var res = ok(await rpc('chat_mod_log_list', { p_room: ST.room.room_id, p_before: before, p_limit: 40, p_group: group || null }));
                if (stale(token)) return;
                var data = res.data || [];
                if (reset) list.textContent = '';
                data.forEach(function (e) { rows.push(e); list.appendChild(logRow(e)); });
                done = data.length < 40;
                more.hidden = done;
                if (!rows.length) list.appendChild(el('p', { class: 'csx-empty-line', text: 'Nothing here yet.' }));
            } catch (err) {
                if (stale(token)) return;
                list.textContent = ''; list.appendChild(el('p', { class: 'csx-empty-line', text: msg(err) }));
            } finally { busy = false; }
        }
        function logRow(e) {
            var d = describe(e), txt = el('span', { class: 'csx-log-text' });
            d.forEach(function (x) { if (x == null) return; txt.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
            return el('div', { class: 'csx-logrow' }, el('i', { class: 'csx-logdot' }), txt, el('time', { datetime: e.created_at, title: new Date(e.created_at).toLocaleString(), text: ago(e.created_at) }));
        }
    }

    function bansView(root, token) {
        var list = el('div', { class: 'csx-bans' });
        root.appendChild(list);
        list.appendChild(spinner());
        load();
        async function load() {
            try {
                var res = ok(await rpc('chat_bans_list', { p_room: ST.room.room_id }));
                if (stale(token)) return;
                list.textContent = '';
                var data = res.data || [];
                if (!data.length) { list.appendChild(el('p', { class: 'csx-empty-line', text: 'Nobody is banned.' })); return; }
                data.forEach(function (b) {
                    var p = { id: b.user_id, username: b.username, display_name: b.display_name, avatar_url: b.avatar_url };
                    list.appendChild(el('div', { class: 'csx-member' },
                        el('span', { class: 'csx-member-av' }, H().avatar(p, 38)),
                        el('span', { class: 'csx-member-main' }, el('strong', { text: name(p) }), el('small', { text: '@' + (b.username || 'member') + ' · banned ' + ago(b.created_at) + (b.banned_by ? ' by ' + b.banned_by : '') }),
                            b.reason ? el('small', { class: 'csx-reason', text: '"' + b.reason + '"' }) : null),
                        btn('Unban', 'ch-btn--ghost ch-btn--sm', async function () {
                            try { ok(await rpc('chat_member_unban', { p_room: ST.room.room_id, p_user: b.user_id })); H().toast('Unbanned'); load(); }
                            catch (err) { H().toast(msg(err)); }
                        })));
                });
            } catch (err) {
                if (stale(token)) return;
                list.textContent = ''; list.appendChild(el('p', { class: 'csx-empty-line', text: msg(err) }));
            }
        }
    }

    /* ======================================================================
       CHANNELS & CATEGORIES
       ====================================================================== */
    function panelLayout(root) {
        var api = SP.api, cs = api.ST;
        root.appendChild(heading('Channels & categories', 'Drag categories and the channels inside them into the order you want.'));
        root.appendChild(el('div', { class: 'csx-card' },
            el('p', { class: 'ch-help', text: 'Reorder mode lets you drag a category (its channels move with it), drag channels between categories, or use the arrow keys on a handle. Changes save as you drop.' }),
            btn('Reorder categories & channels', '', function () {
                DLG.close();
                if (!SP.startReorder()) H().toast('Open the community first.');
            })));
        if (cs.roomId !== ST.room.room_id) return;
        var secs = cs.sections.slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
        var byS = new Map(); byS.set('', []);
        secs.forEach(function (s) { byS.set(s.id, []); });
        cs.channels.slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); }).forEach(function (c) {
            var k = c.section_id && byS.has(c.section_id) ? c.section_id : '';
            byS.get(k).push(c);
        });
        var tree = el('div', { class: 'csx-tree' });
        function group(title, chans) {
            var g = el('div', { class: 'csx-tgroup' }, el('h5', { text: title }));
            chans.forEach(function (c) { g.appendChild(el('div', { class: 'csx-tchan' }, ico('hash'), el('span', { text: c.name }), c.is_private ? el('small', { text: 'private' }) : null)); });
            if (!chans.length) g.appendChild(el('p', { class: 'csx-empty-line', text: 'No channels' }));
            return g;
        }
        if (byS.get('').length) tree.appendChild(group('No category', byS.get('')));
        secs.forEach(function (s) { tree.appendChild(group(s.name, byS.get(s.id))); });
        root.appendChild(el('div', { class: 'csx-card' }, el('h4', { text: 'Right now' }), tree));
    }

    /* ======================================================================
       LEAVE / DELETE
       ====================================================================== */
    function panelDanger(root) {
        var room = ST.room, m = box();
        if (!ST.owner) {
            root.appendChild(heading('Leave community', 'You can join again later if it is public or you get an invite.'));
            root.appendChild(m);
            var leave = btn('Leave ' + (room.name || 'community'), 'ch-btn--ghost ch-btn--danger', function () {
                sub('Leave "' + room.name + '"?', function (body) { body.appendChild(el('p', { class: 'ch-help', text: 'You will lose your roles here.' })); },
                    function (foot, mb, close) {
                        foot.appendChild(btn('Cancel', 'ch-btn--ghost', close));
                        var y = btn('Leave', 'ch-btn--danger', async function () {
                            H().setLoading(y, true);
                            try {
                                ok(await rpc('chat_leave', { p_room: room.room_id }));
                                close(); DLG.close();
                                await H().loadRooms(); H().closeRoom(); H().toast('You left the community');
                            } catch (err) { say(mb, msg(err)); }
                            finally { H().setLoading(y, false); }
                        });
                        foot.appendChild(y);
                    });
            });
            root.appendChild(leave);
            return;
        }
        var typed = el('input', { class: 'ch-field', autocomplete: 'off', placeholder: room.name, 'aria-label': 'Type the community name to confirm' });
        var del = btn('Delete community', 'ch-btn--danger', async function () {
            if (typed.value.trim() !== room.name) { say(m, 'Type the exact community name to confirm.'); return; }
            H().setLoading(del, true);
            try {
                try {                                                       // clean up the picture + banner first (best effort)
                    var files = await H().sb.storage.from(BUCKET).list(room.room_id);
                    if (files && files.data && files.data.length) await H().sb.storage.from(BUCKET).remove(files.data.map(function (f) { return room.room_id + '/' + f.name; }));
                } catch (e) { /* ignore */ }
                ok(await rpc('chat_community_delete', { p_room: room.room_id, p_confirm: typed.value.trim() }));
                META.delete(room.room_id);
                DLG.close();
                await H().loadRooms(); H().closeRoom(); H().toast('Community deleted');
            } catch (err) { say(m, msg(err)); }
            finally { H().setLoading(del, false); }
        });
        root.appendChild(heading('Delete community', 'This removes the community, every channel, message, role and member for everyone.'));
        root.appendChild(m);
        root.appendChild(el('div', { class: 'csx-card csx-danger' },
            el('p', { class: 'ch-help', text: 'This cannot be undone. Type "' + room.name + '" to confirm.' }), typed, del));
    }

    /* ======================================================================
       CHAT BACKGROUNDS (supabase-chat-backgrounds.sql)
       Community background: set by people who can edit the community profile, everybody sees it.
       My background: only me, any chat. It wins over the community one.
       ====================================================================== */
    var BG_ME = 'chat-backgrounds';
    var BGD = null, BG = { room: null, data: null, token: 0, sub: null, subRoom: null };
    var BG_DEF = { opacity: 35, blur: 0, dim: 25 };

    function bgBucket(kind, roomKind) { return kind === 'community' && roomKind === 'community' ? BUCKET : BG_ME; }
    function bgUrl(path, kind, roomKind) {
        if (!path) return null;
        try { return H().sb.storage.from(bgBucket(kind, roomKind)).getPublicUrl(path).data.publicUrl; } catch (e) { return null; }
    }
    // who may make a background here? communities: only people who edit the profile. DMs + groups: everybody for "mine".
    function canBgHere(room) { return !!room && (room.kind !== 'community' || !!(SP && SP.can && SP.can('manage_community', room))); }
    function canShareHere(room) {
        if (!room) return false;
        if (room.kind === 'community') return !!(SP && SP.can && SP.can('manage_community', room));
        if (room.kind === 'dm') return true;
        return room.role === 'owner' || room.role === 'admin';
    }
    function syncBgBtn() {
        var b = document.getElementById('csxBgBtn'), cur = H() && H().S.current;
        if (b) b.hidden = !canBgHere(cur);
    }
    function setLayer(node, url, s) {
        node.style.setProperty('--csx-img', url ? 'url("' + String(url).replace(/"/g, '%22') + '")' : 'none');
        node.style.setProperty('--csx-op', String((s.opacity == null ? BG_DEF.opacity : s.opacity) / 100));
        node.style.setProperty('--csx-blur', (s.blur == null ? BG_DEF.blur : s.blur) + 'px');
        node.style.setProperty('--csx-dim', String((s.dim == null ? BG_DEF.dim : s.dim) / 100));
    }
    function bgLayer() {
        var convo = document.getElementById('chConvo');
        if (!convo) return null;
        var l = document.getElementById('csxBg');
        if (!l) {
            l = document.createElement('div');
            l.id = 'csxBg'; l.className = 'csx-bg'; l.setAttribute('aria-hidden', 'true');
            convo.insertBefore(l, convo.firstChild);
        }
        return l;
    }
    function paintBg() {
        var convo = document.getElementById('chConvo'), l = bgLayer();
        if (!convo || !l) return;
        var cur = H().S.current, rk = cur && cur.kind, mineOk = canBgHere(cur);
        var d = BG.data, s = null, kind = null;
        if (d) {
            if (mineOk && d.mine && d.mine.path) { s = d.mine; kind = 'mine'; }
            else if (d.community && !(mineOk && d.mine && d.mine.hide_community)) { s = d.community; kind = 'community'; }
        }
        syncBgBtn();
        var url = s && bgUrl(s.path, kind, rk);
        if (!url) { convo.classList.remove('has-csx-bg'); return; }
        setLayer(l, url, s);
        convo.classList.add('has-csx-bg');
    }
    function bgUnsub() {
        if (BG.sub) { try { H().sb.removeChannel(BG.sub); } catch (e) { /* ignore */ } }
        BG.sub = null; BG.subRoom = null;
    }
    async function loadBg(room) {
        var tok = ++BG.token;
        BG.room = room.room_id;
        try {
            var res = await rpc('chat_bg_get', { p_room: room.room_id });
            if (res.error) throw res.error;
            if (tok !== BG.token) return;
            BG.data = res.data || {};
        } catch (e) { if (tok === BG.token) BG.data = null; }        // SQL not run yet: no backgrounds
        if (tok !== BG.token) return;
        paintBg();
        if (BG.data && BG.subRoom !== room.room_id) {
            bgUnsub();
            try {
                BG.subRoom = room.room_id;
                BG.sub = H().sb.channel('specsoft-bg-' + room.room_id)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_community_settings', filter: 'room_id=eq.' + room.room_id }, function () {
                        var cur = H().S.current;
                        if (cur && cur.room_id === room.room_id) loadBg(cur);
                    }).subscribe();
            } catch (e) { BG.sub = null; }
        }
    }
    function ensureBgBtn() {
        if (document.getElementById('csxBgBtn')) return;
        var box = document.querySelector('#chConvo .ch-head-actions');
        if (!box) return;
        var b = el('button', { type: 'button', class: 'ch-iconbtn', id: 'csxBgBtn', 'aria-label': 'Chat background', title: 'Chat background', onclick: function () {
            var r = H().S.current;
            if (r) openBgDialog(r);
        } }, ico('image'));
        box.insertBefore(b, document.getElementById('chMembersBtn') || box.firstChild);
        syncBgBtn();
    }
    function onOpen(room) {
        if (!room) return;
        ensureBgBtn();
        if (BG.room !== room.room_id) { BG.data = null; paintBg(); }
        if (BG.subRoom && BG.subRoom !== room.room_id) bgUnsub();
        loadBg(room);
    }
    function onClose() {
        BG.token++; BG.room = null; BG.data = null;
        bgUnsub();
        paintBg();
    }

    async function resizeFit(file, max) {
        if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('Pick a PNG, JPG, WebP or GIF image.');
        if (file.size > 15 * 1024 * 1024) throw new Error('That image is too big (15 MB max).');
        var bmp = await loadBitmap(file);
        var sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
        var g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, 0, 0, c.width, c.height);
        var blob = await new Promise(function (r) { c.toBlob(r, 'image/webp', 0.82); });
        if (!blob || blob.type !== 'image/webp') blob = await new Promise(function (r) { c.toBlob(r, 'image/jpeg', 0.85); });
        if (!blob) throw new Error('Could not read that image.');
        return blob;
    }

    function slider(label, min, max, unit, val, onInput) {
        var out = el('output', { class: 'csx-sval', text: val + unit });
        var inp = el('input', { type: 'range', class: 'csx-range', min: String(min), max: String(max), value: String(val), 'aria-label': label });
        inp.addEventListener('input', function () { out.textContent = inp.value + unit; onInput(Number(inp.value)); });
        return { node: el('div', { class: 'csx-slider' }, el('div', { class: 'csx-slabel' }, el('span', { text: label }), out), inp), set: function (v) { inp.value = String(v); out.textContent = v + unit; } };
    }

    // one editor, used for "My background" and "Community background"
    function bgEditor(room, kind, tabs) {
        var d = BG.data || {};
        var base = kind === 'community' ? d.community : d.mine;
        var st = {
            path: base && base.path || null,
            opacity: base ? base.opacity : BG_DEF.opacity, blur: base ? base.blur : BG_DEF.blur, dim: base ? base.dim : BG_DEF.dim,
            hide: !!(d.mine && d.mine.hide_community), pending: null, clear: false
        };
        var m = box();
        var prev = el('div', { class: 'csx-bgprev' }, el('div', { class: 'csx-bgprev-layer' }),
            el('div', { class: 'csx-bgprev-msgs' },
                el('div', { class: 'csx-bgmsg' }, el('b', { text: 'Alex' }), 'this is how messages look 👀'),
                el('div', { class: 'csx-bgmsg is-me' }, 'looks good, bro 🔥'),
                el('div', { class: 'csx-bgmsg' }, el('b', { text: 'Sam' }), 'can you read this part?')));
        var layer = prev.firstChild;
        function url() { return st.clear ? null : (st.pending ? st.pending.url : bgUrl(st.path, kind, room.kind)); }
        function paint() { setLayer(layer, url(), st); prev.classList.toggle('is-empty', !url()); }

        var sOp = slider('Opacity', 5, 100, '%', st.opacity, function (v) { st.opacity = v; paint(); });
        var sBl = slider('Blur', 0, 20, 'px', st.blur, function (v) { st.blur = v; paint(); });
        var sDm = slider('Dim (easier to read)', 0, 80, '%', st.dim, function (v) { st.dim = v; paint(); });

        function pick() {
            var f = document.createElement('input');
            f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp,image/gif';
            f.addEventListener('change', async function () {
                var file = f.files && f.files[0];
                if (!file) return;
                try {
                    var blob = await resizeFit(file, 1600);
                    if (st.pending) URL.revokeObjectURL(st.pending.url);
                    st.pending = { blob: blob, url: URL.createObjectURL(blob) };
                    st.clear = false; say(m, ''); paint();
                } catch (err) { say(m, err.message || 'Could not use that image.'); }
            });
            f.click();
        }

        var hideCb = null;
        if (kind === 'mine') {
            hideCb = el('input', { type: 'checkbox', checked: st.hide });
            hideCb.addEventListener('change', function () { st.hide = hideCb.checked; });
        }

        var save = btn('Save', '', async function () {
            say(m, '');
            H().setLoading(save, true);
            var uid = H().S.me.id, newPath = null, bucket = bgBucket(kind, room.kind);
            try {
                if (st.pending) {
                    var ext = st.pending.blob.type === 'image/webp' ? '.webp' : '.jpg';
                    newPath = kind === 'community' && room.kind === 'community' ? room.room_id + '/bg-' + Date.now() + ext : uid + '/' + room.room_id + '-' + (kind === 'community' ? 'shared-' : '') + Date.now() + ext;
                    ok(await H().sb.storage.from(bucket).upload(newPath, st.pending.blob, { contentType: st.pending.blob.type, cacheControl: '31536000' }));
                }
                var args = kind === 'community'
                    ? { p_room: room.room_id, p_path: newPath, p_opacity: st.opacity, p_blur: st.blur, p_dim: st.dim, p_clear: st.clear }
                    : { p_room: room.room_id, p_path: newPath, p_opacity: st.opacity, p_blur: st.blur, p_dim: st.dim, p_hide: st.hide, p_clear: st.clear };
                try { ok(await rpc(kind === 'community' ? 'chat_shared_bg_save' : 'chat_my_bg_save', args)); }
                catch (err) { if (newPath) { try { await H().sb.storage.from(bucket).remove([newPath]); } catch (e) { /* ignore */ } } throw err; }
                if ((newPath || st.clear) && st.path) { try { await H().sb.storage.from(bucket).remove([st.path]); } catch (e) { /* best effort */ } }
                var nextPath = st.clear ? null : (newPath || st.path);
                BG.data = BG.data || {};
                if (kind === 'community') BG.data.community = nextPath ? { path: nextPath, opacity: st.opacity, blur: st.blur, dim: st.dim } : null;
                else BG.data.mine = { path: nextPath, opacity: st.opacity, blur: st.blur, dim: st.dim, hide_community: st.hide };
                st.path = nextPath; st.pending = null; st.clear = false;
                paintBg(); paint();
                say(m, 'Saved.', true);
            } catch (err) { say(m, msg(err)); }
            finally { H().setLoading(save, false); }
        });

        var wrap = el('div', { class: 'csx-bgedit' },
            tabs || null,
            el('p', { class: 'ch-help', text: kind === 'community' ? (room.kind === 'dm' ? 'Both of you see this background, and either of you can change it.' : 'Everybody in this chat sees this background.') : 'Only you see this background. The other people in the chat do not.' }),
            m, prev,
            el('div', { class: 'csx-btnrow' },
                btn('Choose image', 'ch-btn--ghost ch-btn--sm', pick),
                btn('Remove image', 'ch-btn--ghost ch-btn--sm', function () { if (st.pending) URL.revokeObjectURL(st.pending.url); st.pending = null; st.clear = true; paint(); }),
                btn('Reset sliders', 'ch-btn--ghost ch-btn--sm', function () {
                    st.opacity = BG_DEF.opacity; st.blur = BG_DEF.blur; st.dim = BG_DEF.dim;
                    sOp.set(st.opacity); sBl.set(st.blur); sDm.set(st.dim); paint();
                })),
            sOp.node, sBl.node, sDm.node,
            hideCb ? el('label', { class: 'ch-check' }, hideCb, el('span', { class: 'ch-box', 'aria-hidden': 'true' }), el('span', { text: 'Hide the shared background (just for me)' })) : null,
            el('div', { class: 'csx-btnrow' }, save));
        paint();
        return wrap;
    }

    async function openBgDialog(room, startTab) {
        if (!room) return;
        if (BG.room !== room.room_id) await loadBg(room);
        if (!BGD) {
            BGD = document.createElement('dialog');
            BGD.className = 'ch-dlg csx-bgdlg';
            BGD.setAttribute('aria-labelledby', 'csxBgTitle');
            BGD.innerHTML = '<header class="ch-dlg-head"><h2 id="csxBgTitle">Chat background</h2><button type="button" class="ch-iconbtn" aria-label="Close"></button></header><div class="ch-dlg-body" id="csxBgBody"></div>';
            document.body.appendChild(BGD);
            var x = BGD.querySelector('button');
            x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS.close + '</svg>';
            x.addEventListener('click', function () { BGD.close(); });
            BGD.addEventListener('click', function (e) { if (e.target === BGD) BGD.close(); });
        }
        var body = BGD.querySelector('#csxBgBody');
        if (!canBgHere(room)) { H().toast('Only people who can edit the community can change its background.'); return; }
        var canCommunity = canShareHere(room);
        var tab = startTab === 'community' && canCommunity ? 'community' : (room.kind === 'community' && canCommunity && !(BG.data && BG.data.mine) ? 'community' : 'mine');
        function draw() {
            body.textContent = '';
            var tabs = null;
            if (canCommunity) {
                tabs = el('div', { class: 'csx-seg csx-seg--tabs', role: 'tablist' },
                    el('button', { type: 'button', role: 'tab', class: tab === 'mine' ? 'is-on' : '', 'aria-selected': String(tab === 'mine'), onclick: function () { tab = 'mine'; draw(); } }, 'My background'),
                    el('button', { type: 'button', role: 'tab', class: tab === 'community' ? 'is-on' : '', 'aria-selected': String(tab === 'community'), onclick: function () { tab = 'community'; draw(); } }, 'Shared with everyone'));
            }
            body.appendChild(bgEditor(room, tab, tabs));
        }
        draw();
        if (!BGD.open) BGD.showModal();
    }

    /* ----------------------------------------------------------------------
       public API
       ---------------------------------------------------------------------- */
    function artEl(room) {
        if (!room) return null;
        var m = META.get(room.room_id);
        if (!m) { queueMeta(room.room_id); return null; }
        var u = pubUrl(m.avatar_path);
        return u ? imgEl(u, 'ch-art ch-art--img') : null;
    }
    window.SPCS = {
        open: function (room, tab) {
            if (!SP || !H() || !room || room.kind !== 'community') return false;
            open(room, tab);
            return true;
        },
        onOpen: onOpen,
        onClose: onClose,
        openBg: openBgDialog,
        artEl: artEl,
        art: function (room, size) {
            var a = artEl(room);
            if (!a) a = el('span', { class: 'ch-art', text: room.icon || '💬' });
            a.classList.add('csx-art');
            if (size) { a.style.width = size + 'px'; a.style.height = size + 'px'; }
            return a;
        },
        cardArt: function (c) {
            if (!c) return null;
            var m = META.get(c.room_id);
            if (!m) { queueMeta(c.room_id); return null; }
            var u = pubUrl(m.avatar_path);
            if (!u) return null;
            var w = el('span', { class: 'ch-card-icon ch-card-icon--img' });
            w.appendChild(imgEl(u, 'csx-card-img'));
            return w;
        },
        tagsEl: function (c) {
            if (!c) return null;
            var m = META.get(c.room_id);
            if (!m) { queueMeta(c.room_id); return null; }
            if (!m.tags || !m.tags.length) return null;
            var w = el('div', { class: 'csx-tags' });
            m.tags.slice(0, 6).forEach(function (t) { w.appendChild(el('span', { class: 'csx-chip is-static', text: '#' + t })); });
            return w;
        }
    };
})();
