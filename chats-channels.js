/* ==========================================================================
   SPECSOFT® — Chats: community sections + channels (chats-channels.js)
   Needs: supabase-community-channels.sql (run once) and the small hooks in chats.js.
   Load this BEFORE chats.js. It exposes window.SPCH, chats.js calls it in a few
   places and hands it the tools it needs through SPCH.attach().

   What it does
     * when a community is open, the left column swaps "My chats" for the
       community's sections + channels
     * messages, sending and unread counts are scoped to the open channel
     * channel types: text, announcements, spoiler, sensitive (+ private flag).
       discussion / roadmap / event exist but show a "coming soon" panel
     * per-community notification level: all | mentions | none
   If the SQL has not been run, everything falls back to the old behavior.
   ========================================================================== */
(function () {
    'use strict';

    var H = null;                      // tools from chats.js (set by attach)

    var KEY_COLLAPSED = 'specsoft.chx.collapsed';
    var KEY_LAST = 'specsoft.chx.last.';        // + roomId  -> last open channel
    var KEY_GATE = 'specsoft.chx.gate';         // sensitive channels you said OK to

    var TYPES = {
        text:          { label: 'Text',                 hint: 'Regular chat. Everyone in the community can post.' },
        announcements: { label: 'Announcements',        hint: 'Only owners and admins can post. Everyone can read.' },
        discussion:    { label: 'Discussion (forum)',   hint: 'Forum-style posts. Anyone can start a post and reply.', panel: true },
        spoiler:       { label: 'Spoiler',              hint: 'Every message is blurred until someone clicks it.' },
        sensitive:     { label: 'Sensitive',            hint: 'Members see a warning before they can read the channel.' },
        roadmap:       { label: 'Roadmap',              hint: 'A board of what is planned. Admins edit it, everyone can vote.', panel: true },
        event:         { label: 'Event',                hint: 'Upcoming events with RSVPs. Admins create them.', panel: true }
    };

    var LEVELS = [
        { v: 'all',      t: 'All',       help: 'You get a notification for every message.' },
        { v: 'mentions', t: '@Mentions', help: 'Only when someone @mentions you.' },
        { v: 'none',     t: 'None',      help: 'No banners, sounds or badges from this community.' }
    ];

    var ST = {
        roomId: null,                  // the community that is open (channel mode)
        show: false,                   // true = the left column shows channels
        sections: [], channels: [], channel: null,
        cache: new Map(),              // roomId -> { sections, channels }  (for unread counts of communities that are not open)
        levels: new Map(),             // roomId -> 'mentions' | 'none'   (missing = 'all')
        levelsAt: 0,
        collapsed: readSet(KEY_COLLAPSED),
        gateOk: readSet(KEY_GATE),
        revealed: new Set(),
        locked: false,
        sub: null, subRoom: null,
        reloadT: null, readT: null,
        dlg: null,
        thread: null, threadInfo: null,      // forum: the open post
        reorder: false,                      // reorder mode in the channel list
        panel: null,                         // the mounted forum / roadmap / event panel
        live: null                           // { id, ch, subs } the ping channel of the open panel channel
    };

    /* ----------------------------------------------------------------------
       small helpers
       ---------------------------------------------------------------------- */
    function readSet(key) {
        try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { return new Set(); }
    }
    function writeSet(key, set) {
        try { localStorage.setItem(key, JSON.stringify(Array.from(set).slice(-300))); } catch (e) { /* private mode */ }
    }

    var SVG = {
        hash:      '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
        announce:  '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
        forum:     '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/>',
        spoiler:   '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
        sensitive: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        roadmap:   '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
        event:     '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
        lock:      '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        caret:     '<polyline points="6 9 12 15 18 9"/>',
        back:      '<polyline points="15 18 9 12 15 6"/>',
        right:     '<polyline points="9 18 15 12 9 6"/>',
        up:        '<polyline points="18 15 12 9 6 15"/>',
        updown:    '<polyline points="8 9 12 5 16 9"/><polyline points="8 15 12 19 16 15"/>',
        grip:      '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
        pin:       '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>',
        check:     '<polyline points="20 6 9 17 4 12"/>',
        search:    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
        plus:      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        gear:      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    };

    // static markup only (never user text), so innerHTML is safe here
    function svg(name, cls) {
        var s = document.createElement('span');
        s.className = 'chx-ico' + (cls ? ' ' + cls : '');
        s.setAttribute('aria-hidden', 'true');
        s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + SVG[name] + '</svg>';
        return s;
    }

    function typeIconName(t) {
        return { announcements: 'announce', discussion: 'forum', spoiler: 'spoiler', sensitive: 'sensitive', roadmap: 'roadmap', event: 'event' }[t] || 'hash';
    }

    function typeIcon(c) {
        var wrap = H.el('span', { class: 'chx-type' }, svg(typeIconName(c.type)));
        if (c.is_private) wrap.appendChild(svg('lock', 'chx-lock'));
        return wrap;
    }

    var CERR = {
        thread_locked: 'This post is locked.',
        thread_not_found: 'That post is no longer available.',
        bad_title: 'Give it a title (3 to 100 characters).',
        bad_date: 'Pick a valid start time. The end must be after the start.',
        bad_status: 'That status is not valid.',
        bad_layout: 'Could not save that order. Try again.',
        item_not_found: 'That item is no longer available.',
        event_not_found: 'That event is no longer available.',
        roadmap_limit: 'A roadmap can have up to 200 items.',
        event_limit: 'That channel has too many events.',
        no_send: 'You do not have permission to talk here.',
        timed_out: 'You are in a timeout. You cannot post right now.',
        banned: 'You are banned from this community.',
        private_community: 'This community is private. You need an invite from a member.'
    };
    function fe(err) {
        var m = String(err && err.message || '');
        for (var k in CERR) if (Object.prototype.hasOwnProperty.call(CERR, k) && m.indexOf(k) >= 0) return CERR[k];
        return H.friendly(err);
    }
    function isPanel(c) { return !!(c && TYPES[c.type] && TYPES[c.type].panel); }

    function chanById(id) { for (var i = 0; i < ST.channels.length; i++) if (ST.channels[i].id === id) return ST.channels[i]; return null; }
    function curChannel() { return ST.channel ? chanById(ST.channel) : null; }
    function defaultChannel() {
        for (var i = 0; i < ST.channels.length; i++) if (ST.channels[i].is_default) return ST.channels[i];
        return ST.channels[0] || null;
    }
    function active(roomId) { return !!(ST.roomId && roomId === ST.roomId && ST.channel); }
    function roomNow() { return (ST.roomId && H.S.roomMap.get(ST.roomId)) || H.S.current || null; }
    /* ---- permissions (custom roles, supabase-community-settings.sql) ----
       Old-style owners and admins can do everything. Everybody else gets what their roles allow.
       If the SQL has not been run, the permission list is simply unknown and the old rules stay. */
    var PERMS = new Map();                       // roomId -> { perms: Set, owner: bool, rank: int }
    function legacyAdmin(r) { return !!r && (r.role === 'owner' || r.role === 'admin'); }
    function can(key, room) {
        var r = room || roomNow();
        if (!r || r.kind !== 'community') return false;
        if (legacyAdmin(r)) return true;
        var p = PERMS.get(r.room_id);
        return !!(p && p.perms.has(key));
    }
    function canTalk(room) {                     // unknown permissions never lock anybody out
        var r = room || roomNow();
        if (!r || r.kind !== 'community' || legacyAdmin(r) || !PERMS.has(r.room_id)) return true;
        return can('send_messages', r);
    }
    function canManage(key) { return can(key || 'manage_channels'); }
    async function loadPerms(roomId) {
        try {
            var res = await H.sb.rpc('chat_my_perms', { p_room: roomId });
            if (res.error) throw res.error;
            var d = res.data || {};
            PERMS.set(roomId, { perms: new Set(d.perms || []), owner: !!d.owner, rank: d.rank || 0 });
        } catch (e) { PERMS.delete(roomId); }
    }
    var permsT = null;
    function permsChanged() {                    // somebody changed roles: refresh what this person may do
        clearTimeout(permsT);
        permsT = setTimeout(async function () {
            var id = ST.roomId;
            if (!id) return;
            await loadPerms(id);
            if (ST.roomId !== id) return;
            H.renderList();
            SP.lockComposer();
            SP.paintHeader();
        }, 400);
    }
    function lvl(roomId) { return ST.levels.get(roomId) || 'all'; }
    function lvlHelp(v) { for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].v === v) return LEVELS[i].help; return ''; }

    function saveLast(roomId, id) { try { localStorage.setItem(KEY_LAST + roomId, id); } catch (e) { /* ignore */ } }
    function readLast(roomId) { try { return localStorage.getItem(KEY_LAST + roomId); } catch (e) { return null; } }

    /* ----------------------------------------------------------------------
       data
       ---------------------------------------------------------------------- */
    async function fetchThread(id) {
        try {
            var res = await H.sb.rpc('chat_thread_get', { p_thread: id });
            if (res.error) return undefined;                    // could not check
            return (res.data && res.data[0]) || null;           // null = deleted or hidden
        } catch (e) { return undefined; }
    }

    async function fetchStructure(roomId) {
        var res = await H.sb.rpc('chat_channels_list', { p_room: roomId });
        if (res.error) throw res.error;
        var d = res.data || {};
        var channels = (d.channels || []).map(function (c) { c.unread = Number(c.unread) || 0; return c; });
        return { sections: d.sections || [], channels: channels };
    }

    function applyStructure(roomId, data) {
        ST.sections = data.sections;
        ST.channels = data.channels;
        ST.cache.set(roomId, { sections: data.sections, channels: data.channels });
    }

    function reloadSoon() {
        clearTimeout(ST.reloadT);
        ST.reloadT = setTimeout(reload, 350);
    }

    async function reload() {
        var roomId = ST.roomId;
        if (!roomId) return;
        if (typeof DRAG !== 'undefined' && DRAG) { reloadSoon(); return; }
        try {
            var data = await fetchStructure(roomId);
            if (roomId !== ST.roomId) return;
            applyStructure(roomId, data);
            if (!chanById(ST.channel)) {                       // the open channel was deleted or hidden
                var dc = defaultChannel();
                if (dc) { H.toast('That channel is no longer available.'); H.openRoom(roomId, { channel: dc.id, keepRoomCh: true }); return; }
            }
            H.renderList();
            SP.paintHeader();
        } catch (e) { /* the next event tries again */ }
    }

    function subscribeStructure(roomId) {
        if (ST.sub && ST.subRoom === roomId) return;
        unsubscribeStructure();
        ST.subRoom = roomId;
        try {
            ST.sub = H.sb.channel('specsoft-chs-' + roomId)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_channels', filter: 'room_id=eq.' + roomId }, reloadSoon)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_sections', filter: 'room_id=eq.' + roomId }, reloadSoon)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_member_roles', filter: 'room_id=eq.' + roomId }, permsChanged)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_roles', filter: 'room_id=eq.' + roomId }, permsChanged)
                .subscribe();
        } catch (e) { ST.sub = null; }
    }

    function unsubscribeStructure() {
        if (ST.sub) { try { H.sb.removeChannel(ST.sub); } catch (e) { /* ignore */ } }
        ST.sub = null; ST.subRoom = null;
    }

    /* ----------------------------------------------------------------------
       notification level (per community)
       ---------------------------------------------------------------------- */
    SP_loadLevels.busy = false;
    async function SP_loadLevels(force) {
        if (!H || !H.S.me) return;
        if (SP_loadLevels.busy) return;
        if (!force && Date.now() - ST.levelsAt < 8000) return;
        SP_loadLevels.busy = true;
        try {
            var res = await H.sb.rpc('chat_notif_levels');
            if (res.error) return;                                   // SQL not run yet: everything stays on "all"
            var next = new Map();
            (res.data || []).forEach(function (r) { next.set(r.room_id, r.level); });
            ST.levels = next;
            ST.levelsAt = Date.now();
            H.updateBadges();
        } catch (e) { /* ignore */ }
        finally { SP_loadLevels.busy = false; }
    }

    async function setLevel(v) {
        var roomId = ST.roomId;
        if (!roomId) return;
        var before = lvl(roomId);
        if (v === before) return;
        if (v === 'all') ST.levels.delete(roomId); else ST.levels.set(roomId, v);
        H.updateBadges();
        H.renderList();
        try {
            var res = await H.sb.rpc('chat_set_notif', { p_room: roomId, p_level: v });
            if (res.error) throw res.error;
            ST.levelsAt = Date.now();
            H.toast(v === 'all' ? 'Notifications on' : v === 'mentions' ? 'Only @mentions will notify you' : 'Notifications off for this community');
        } catch (err) {
            if (before === 'all') ST.levels.delete(roomId); else ST.levels.set(roomId, before);
            H.updateBadges();
            H.renderList();
            H.toast(fe(err));
        }
    }

    /* ----------------------------------------------------------------------
       public hooks (called from chats.js)
       ---------------------------------------------------------------------- */
    var SP = window.SPCH = {};

    SP.attach = function (host) {
        H = host;
        wireSpoiler();
    };

    // after login: load notification levels
    SP.start = function () { SP_loadLevels(true); };
    SP.loadLevels = function () { SP_loadLevels(false); };

    // used by chats.js badge counters and notifications
    SP.isNone = function (r) { return !!(r && r.kind === 'community' && lvl(r.room_id) === 'none'); };
    SP.quiet = function (room, mention) {
        if (!room || room.kind !== 'community') return false;
        var v = lvl(room.room_id);
        if (v === 'none') return true;
        if (v === 'mentions') return !mention;
        return false;
    };

    // openRoom(): decide the channel BEFORE the first message fetch
    SP.beforeOpen = async function (room, opts) {
        opts = opts || {};
        if (!room || room.kind !== 'community') { SP.close(); return; }

        var data;
        try {
            var reuse = ST.roomId === room.room_id && opts.channel && ST.channels.length;
            data = reuse ? { sections: ST.sections, channels: ST.channels } : await fetchStructure(room.room_id);
        } catch (err) {
            console.warn('[channels] falling back to a plain community chat:', err);
            SP.close();
            return;
        }
        if (!data.channels.length) { SP.close(); return; }

        if (H.S.tl && H.S.tl.has(room.room_id)) H.S.tl.delete(room.room_id);     // drop typing from the channel you are leaving
        await loadPerms(room.room_id);
        ST.roomId = room.room_id;
        applyStructure(room.room_id, data);

        var id = opts.channel;
        if (!id || !chanById(id)) id = readLast(room.room_id);
        if (!id || !chanById(id)) id = (defaultChannel() || {}).id;
        ST.channel = id;
        saveLast(room.room_id, id);
        ST.thread = null; ST.threadInfo = null;
        var cc = chanById(id);
        if (opts.thread && cc && cc.type === 'discussion') {
            var info = opts.threadInfo || await fetchThread(opts.thread);
            if (info && info.channel_id === id) { ST.thread = info.id; ST.threadInfo = info; }
        }
        ST.show = true;
        subscribeStructure(room.room_id);
    };

    // openRoom(): the chat is on screen, mark the channel read
    SP.afterOpen = function () {
        if (!active(H.S.current && H.S.current.room_id)) return;
        SP.readNow();
    };

    // leaving channel mode (the community can stay open, the left column goes back to My chats)
    SP.leave = function () { ST.show = false; };

    // the community was closed or another kind of chat opened
    SP.close = function () {
        ST.show = false;
        ST.roomId = null;
        ST.channel = null;
        ST.sections = []; ST.channels = [];
        ST.thread = null; ST.threadInfo = null; ST.reorder = false;
        clearThreadActions();
        liveClose();
        unsubscribeStructure();
        removeOverlay();
        var feed = H && H.$('chFeed');
        if (feed) feed.classList.remove('chx-spoiler');
    };

    // fetchMessages / fetchNewer: only this channel's messages
    // (old messages with channel_id NULL belong to the default channel)
    SP.scope = function (q, roomId) {
        if (!active(roomId)) return q;
        var c = curChannel();
        if (!c) return q;
        if (c.type === 'discussion') {                       // forum: a post's messages, or nothing while the post list is showing
            return ST.thread ? q.eq('channel_id', c.id).eq('thread_id', ST.thread) : q.eq('channel_id', c.id).is('thread_id', null);
        }
        return c.is_default ? q.or('channel_id.eq.' + c.id + ',channel_id.is.null') : q.eq('channel_id', c.id);
    };

    // sendMessage(): same shape as sb.rpc('chat_send', ...)
    SP.send = async function (room, body, replyId) {
        if (active(room.room_id)) {
            if (ST.thread) {
                var tr = await H.sb.rpc('chat_send_thread', { p_thread: ST.thread, p_body: body, p_reply: replyId || null });
                if (tr.error && /thread_(not_found|locked)/.test(String(tr.error.message || ''))) {
                    if (ST.threadInfo && /locked/.test(tr.error.message)) { ST.threadInfo.locked = true; SP.lockComposer(); }
                }
                return tr;
            }
            var res = await H.sb.rpc('chat_send_channel', { p_channel: ST.channel, p_body: body, p_reply: replyId || null });
            if (res.error && /channel_not_found/.test(String(res.error.message || ''))) reloadSoon();
            return res;
        }
        return H.sb.rpc('chat_send', { p_room: room.room_id, p_body: body, p_reply: replyId || null });
    };

    // typing is broadcast to the whole community room, so every typing message carries
    // the channel (and post) it came from. Receivers ignore the ones from somewhere else.
    SP.typingKey = function () {
        var r = H.S.current;
        if (!r || !active(r.room_id)) return null;
        return ST.channel + (ST.thread ? ':' + ST.thread : '');
    };
    SP.typingOk = function (key) { return (key || null) === (SP.typingKey() || null); };

    SP.sub = function (r) {
        if (!r || !active(r.room_id)) return null;
        var c = curChannel();
        if (!c) return null;
        if (c.type === 'spoiler') return 'Spoiler channel. Click a message to reveal it.';
        if (c.type === 'announcements' && !can('post_announcements')) return 'Announcements. Only admins can post.';
        if (ST.thread && ST.threadInfo) return ST.threadInfo.title + (ST.threadInfo.locked ? ' (locked)' : '');
        if (isPanel(c)) return c.topic || TYPES[c.type].label;
        return c.topic || (r.name + ' · ' + r.member_count + ' member' + (r.member_count === 1 ? '' : 's'));
    };

    SP.paintHeader = function () {
        var r = H.S.current;
        if (!r || !active(r.room_id)) { removeOverlay(); clearThreadActions(); return; }
        var c = curChannel();
        if (!c) return;
        H.$('chRoomName').textContent = '# ' + c.name;
        var sub = SP.sub(r);
        if (sub) H.$('chRoomSub').textContent = sub;
        paintThreadActions();
        applyChannelUi();
    };

    // announcements (members) and "coming soon" channels have no composer
    SP.lockComposer = function () {
        var r = H.S.current;
        var c = r && active(r.room_id) ? curChannel() : null;
        var threadLocked = !!(c && ST.thread && ST.threadInfo && ST.threadInfo.locked && !can('manage_threads'));
        var noTalk = !!c && !canTalk(r) && !isPanel(c);
        var lock = !!c && ((c.type === 'announcements' && !can('post_announcements')) || (isPanel(c) && !ST.thread) || threadLocked || noTalk);
        var input = H.$('chInput');
        if (!input) return;
        if (lock) {
            input.setAttribute('contenteditable', 'false');
            input.setAttribute('aria-disabled', 'true');
            input.dataset.placeholder = threadLocked ? 'This post is locked.' : isPanel(c) ? 'Use the panel above to take part.' : (noTalk && c.type !== 'announcements') ? 'You do not have permission to talk here.' : 'Only owners and admins can post in announcements.';
            ['chAttachBtn', 'chEmojiBtn', 'chGifBtn', 'chDevBtn', 'chMicBtn', 'chSend'].forEach(function (id) { var b = H.$(id); if (b) b.disabled = true; });
            ST.locked = true;
        } else if (ST.locked) {
            input.setAttribute('contenteditable', 'true');
            input.removeAttribute('aria-disabled');
            input.dataset.placeholder = 'Message...';
            ST.locked = false;
        }
    };

    // onMsgInsert(): return true when this module fully handled the message
    SP.onMessage = function (room, m, mine) {
        if (!room || room.kind !== 'community') return false;

        if (active(m.room_id)) {
            var def = defaultChannel();
            var cid = m.channel_id || (def && def.id);
            if (cid === ST.channel) {
                var cch = curChannel();
                if (cch && cch.type === 'discussion' && m.thread_id !== ST.thread) {   // another post (or the post list is showing)
                    if (ST.panel && ST.panel.onMessage) ST.panel.onMessage(m);
                    return true;
                }
                SP.touchRead();
                return false;                                                       // the open channel: the normal flow draws it
            }
            bumpOther(room, m, cid, mine);
            return true;
        }

        // a community that is not open
        var cache = ST.cache.get(room.room_id);
        if (cache && !mine) {
            var def2 = null, hit = null;
            cache.channels.forEach(function (c) { if (c.is_default) def2 = c; if (c.id === m.channel_id) hit = c; });
            hit = hit || (!m.channel_id ? def2 : null);
            if (hit && lvl(room.room_id) !== 'none') hit.unread = (hit.unread || 0) + 1;
        }
        if (lvl(room.room_id) === 'none') {                                      // silenced: no unread bump, no banner
            room.last_body = m.body; room.last_at = m.created_at; room.last_sender = m.sender_id;
            H.bumpRoom(room);
            return true;
        }
        return false;
    };

    function bumpOther(room, m, cid, mine) {
        room.last_body = m.body; room.last_at = m.created_at; room.last_sender = m.sender_id;
        var ch = chanById(cid);
        if (!ch) { reloadSoon(); H.bumpRoom(room); return; }                     // a channel we have not seen yet
        if (!mine) {
            var v = lvl(room.room_id);
            if (v !== 'none') ch.unread = (ch.unread || 0) + 1;
            var mention = H.mentionsUser(m.body, H.S.profile && H.S.profile.username);
            if (v === 'all' || (v === 'mentions' && mention)) notifyOther(room, ch, m, mention);
        }
        H.bumpRoom(room);
    }

    async function notifyOther(room, ch, m, mention) {
        try { await H.cacheProfiles([m.sender_id]); } catch (e) { /* ignore */ }
        var sender = H.S.profiles.get(m.sender_id) || {};
        var who = H.nameOf(sender);
        var preview = H.safePreview(m.body, m.sender_id) || 'Sent a message';
        H.pushNotice({
            key: room.room_id + ':' + ch.id,
            title: room.name + ' · #' + ch.name,
            text: mention ? who + ' mentioned you: ' + preview : who + ': ' + preview,
            profile: sender,
            icon: room.icon,
            onOpen: function () { try { window.focus(); } catch (e) { /* ignore */ } H.openRoom(room.room_id, { channel: ch.id, keepRoomCh: !!(H.S.current && H.S.current.room_id === room.room_id) }); }
        });
    }

    // read tracking (debounced so a busy channel is one request, not one per message)
    SP.touchRead = function () {
        clearTimeout(ST.readT);
        ST.readT = setTimeout(function () { if (!document.hidden) SP.readNow(); }, 1500);
    };

    SP.readNow = function () {
        var c = curChannel();
        if (!c) return;
        var had = c.unread;
        c.unread = 0;
        if (had) H.renderList();
        H.sb.rpc('chat_channel_read', { p_channel: c.id }).then(function () { /* ok */ }, function () { /* not critical */ });
    };

    SP.openChannel = function (id) {
        var r = H.S.current;
        if (!r || r.room_id !== ST.roomId) return;
        if (id === ST.channel) { H.$('chApp').dataset.view = 'chat'; return; }
        H.openRoom(r.room_id, { channel: id, keepRoomCh: true });
    };

    /* ----------------------------------------------------------------------
       left column: sections + channels
       ---------------------------------------------------------------------- */
    function byPos(a, b) { return (a.position || 0) - (b.position || 0); }
    function sortedSections() { return ST.sections.slice().sort(byPos); }
    function sectionKnown(id) { return !!id && ST.sections.some(function (s) { return s.id === id; }); }

    // '' = uncategorized (always shown FIRST), then every section in order
    function containers() {
        var map = new Map();
        map.set('', []);
        sortedSections().forEach(function (s) { map.set(s.id, []); });
        ST.channels.slice().sort(byPos).forEach(function (c) { map.get(sectionKnown(c.section_id) ? c.section_id : '').push(c); });
        return map;
    }

    SP.renderList = function () {
        var room = H.S.current;
        if (!ST.show || !room || room.room_id !== ST.roomId) return false;
        var el = H.el;
        var manage = canManage();
        if (!manage) ST.reorder = false;

        // header
        H.$('chListTitle').textContent = room.name || 'Community';
        var acts = H.$('chListActions');
        acts.textContent = '';
        if (manage) {
            acts.appendChild(el('button', {
                type: 'button', class: 'ch-iconbtn' + (ST.reorder ? ' is-on' : ''), 'aria-pressed': String(ST.reorder),
                'aria-label': ST.reorder ? 'Finish reordering' : 'Reorder channels', title: ST.reorder ? 'Finish reordering' : 'Reorder channels',
                onclick: function () { ST.reorder = !ST.reorder; H.renderList(); }
            }, svg('updown')));
            if (!ST.reorder) {
                acts.appendChild(el('button', { type: 'button', class: 'ch-iconbtn', 'aria-label': 'Create channel', title: 'Create channel', onclick: function () { openChannelDlg(null, null); } }, svg('plus')));
            }
        }
        H.$('chSearchWrap').hidden = true;
        document.querySelectorAll('#chSide [data-nav]').forEach(function (b) {
            var on = b.dataset.nav === 'communities';
            b.classList.toggle('is-active', on);
            if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });

        // body
        var body = H.$('chListBody');
        var keep = body.scrollTop;
        body.textContent = '';

        if (ST.reorder) {
            body.appendChild(el('div', { class: 'chx-reorder-bar', role: 'status' },
                el('p', { text: 'Drag the handles to reorder. Drop a channel on a section to move it there. You can also focus a handle and press the up or down arrow.' }),
                el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: function () { ST.reorder = false; H.renderList(); } }, 'Done')));
        } else {
            body.appendChild(el('button', { type: 'button', class: 'chx-back', onclick: function () { H.setNav('mine'); } }, svg('back'), el('span', { text: 'My chats' })));
            if (window.SPCS) {
                body.appendChild(el('button', { type: 'button', class: 'chx-comm', 'aria-label': 'Open community settings', onclick: function () { window.SPCS.open(room); } },
                    window.SPCS.art(room, 34),
                    el('span', { class: 'chx-comm-text' }, el('strong', { text: room.name || 'Community' }), el('small', { text: 'Community settings' })),
                    svg('gear', 'chx-comm-gear')));
            }
            body.appendChild(notifControl(room));
        }

        var cont = containers();

        // uncategorized channels go at the very top
        var loose = cont.get('');
        if (loose.length || ST.reorder) {
            var lg = el('div', { class: 'chx-group chx-group--loose', dataset: { loose: '1' } });
            if (ST.reorder) lg.appendChild(el('div', { class: 'chx-sec chx-sec--static' }, el('span', { class: 'chx-sec-name', text: 'No section (always on top)' })));
            loose.forEach(function (c) { lg.appendChild(channelRow(c)); });
            if (ST.reorder && !loose.length) lg.appendChild(el('p', { class: 'chx-empty', text: 'Drop a channel here to take it out of its section.' }));
            body.appendChild(lg);
        }
        sortedSections().forEach(function (s) { body.appendChild(sectionBlock(s, cont.get(s.id) || [])); });

        if (manage && !ST.reorder) {
            body.appendChild(el('button', { type: 'button', class: 'chx-newsec', onclick: function () { openSectionDlg(null); } }, svg('plus'), el('span', { text: 'New section' })));
        }
        body.scrollTop = keep;
        return true;
    };

    function notifControl(room) {
        var el = H.el;
        var cur = lvl(room.room_id);
        var seg = el('div', { class: 'chx-seg' });
        LEVELS.forEach(function (o) {
            seg.appendChild(el('button', {
                type: 'button', role: 'radio', class: cur === o.v ? 'is-on' : '', 'aria-checked': String(cur === o.v), title: o.help,
                onclick: function () { setLevel(o.v); }
            }, o.t));
        });
        return el('div', { class: 'chx-notif', role: 'radiogroup', 'aria-label': 'Notifications for this community' },
            el('span', { class: 'chx-notif-label', text: 'Notifications' }),
            seg,
            el('p', { class: 'chx-notif-help', text: lvlHelp(cur) }));
    }

    function grip(type, id, label) {
        var b = H.el('button', { type: 'button', class: 'chx-grip', 'aria-label': 'Reorder ' + label + '. Drag it, or press the up or down arrow.', title: 'Drag to reorder' }, svg('grip'));
        b.addEventListener('pointerdown', function (e) { onGripDown(e, type, id); });
        b.addEventListener('keydown', function (e) { onGripKey(e, type, id); });
        return b;
    }

    function sectionBlock(sec, chans) {
        var el = H.el;
        var open = ST.reorder ? true : !ST.collapsed.has(sec.id);
        var head;
        if (ST.reorder) {
            head = el('div', { class: 'chx-sec chx-sec--static' }, grip('sec', sec.id, 'section ' + sec.name), el('span', { class: 'chx-sec-name', text: sec.name }));
        } else {
            head = el('div', { class: 'chx-sec' },
                el('button', {
                    type: 'button', class: 'chx-sec-toggle', 'aria-expanded': String(open),
                    onclick: function () {
                        if (ST.collapsed.has(sec.id)) ST.collapsed.delete(sec.id); else ST.collapsed.add(sec.id);
                        writeSet(KEY_COLLAPSED, ST.collapsed);
                        H.renderList();
                    }
                }, svg('caret', 'chx-caret'), el('span', { text: sec.name })));
            if (canManage()) {
                head.appendChild(el('button', { type: 'button', class: 'chx-mini', 'aria-label': 'Create channel in ' + sec.name, title: 'Create channel', onclick: function () { openChannelDlg(null, sec.id); } }, svg('plus')));
                head.appendChild(el('button', { type: 'button', class: 'chx-mini', 'aria-label': 'Edit section ' + sec.name, title: 'Edit section', onclick: function () { openSectionDlg(sec); } }, svg('gear')));
            }
        }
        var wrap = el('div', { class: 'chx-group' + (open ? '' : ' is-collapsed'), dataset: { sid: sec.id } }, head);
        var shown = open ? chans : chans.filter(function (c) { return c.id === ST.channel || (c.unread > 0 && lvl(ST.roomId) !== 'none'); });
        shown.forEach(function (c) { wrap.appendChild(channelRow(c)); });
        if (open && !chans.length) wrap.appendChild(el('p', { class: 'chx-empty', text: ST.reorder ? 'Drop a channel here.' : 'No channels yet.' }));
        return wrap;
    }

    function channelRow(c) {
        var el = H.el;
        if (ST.reorder) {
            return el('div', { class: 'chx-row', dataset: { cid: c.id } },
                grip('ch', c.id, '#' + c.name),
                el('span', { class: 'chx-ch chx-ch--static' }, typeIcon(c), el('span', { class: 'chx-name', text: c.name })));
        }
        var on = c.id === ST.channel;
        var v = lvl(ST.roomId);
        var unread = c.unread > 0 && !on && v !== 'none';
        var count = unread && v === 'all';
        var btn = el('button', {
            type: 'button',
            class: 'chx-ch' + (on ? ' is-active' : '') + (unread ? ' is-unread' : ''),
            'aria-current': on ? 'true' : null,
            title: c.topic || null,
            onclick: function () { SP.openChannel(c.id); }
        },
            typeIcon(c),
            el('span', { class: 'chx-name', text: c.name }),
            count ? el('span', { class: 'ch-unread', text: c.unread > 99 ? '99+' : String(c.unread) })
                  : (unread ? el('i', { class: 'chx-dot', 'aria-label': 'Unread' }) : null));
        var row = el('div', { class: 'chx-row', dataset: { cid: c.id } }, btn);
        if (canManage()) {
            row.appendChild(el('button', { type: 'button', class: 'chx-mini chx-gear', 'aria-label': 'Edit #' + c.name, title: 'Edit channel', onclick: function () { openChannelDlg(c, null); } }, svg('gear')));
        }
        return row;
    }

    /* ----------------------------------------------------------------------
       drag to reorder (pointer events: mouse, touch and pen) + arrow keys
       ---------------------------------------------------------------------- */
    var DRAG = null;

    function clearMarks() {
        document.querySelectorAll('.chx-drop-before, .chx-drop-after, .chx-drop-into').forEach(function (n) {
            n.classList.remove('chx-drop-before', 'chx-drop-after', 'chx-drop-into');
        });
    }

    function onGripDown(e, type, id) {
        if (DRAG || (e.button != null && e.button > 0)) return;
        e.preventDefault();
        var g = e.currentTarget;
        var node = type === 'ch' ? g.closest('.chx-row') : g.closest('.chx-group');
        if (!node) return;
        DRAG = { type: type, id: id, node: node, grip: g, pid: e.pointerId, target: null };
        try { g.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        node.classList.add('is-dragging');
        document.body.classList.add('chx-dragging');
        g.addEventListener('pointermove', onGripMove);
        g.addEventListener('pointerup', onGripUp);
        g.addEventListener('pointercancel', onGripCancel);
    }

    function onGripMove(e) {
        if (!DRAG || e.pointerId !== DRAG.pid) return;
        var body = H.$('chListBody');
        var br = body.getBoundingClientRect();
        if (e.clientY < br.top + 36) body.scrollTop -= 14;
        else if (e.clientY > br.bottom - 36) body.scrollTop += 14;

        clearMarks();
        DRAG.target = null;
        var under = document.elementFromPoint(e.clientX, e.clientY);
        if (!under || !body.contains(under)) return;

        if (DRAG.type === 'ch') {
            var row = under.closest('.chx-row[data-cid]');
            if (row) {
                if (row === DRAG.node) return;
                var rc = row.getBoundingClientRect();
                var after = e.clientY > rc.top + rc.height / 2;
                row.classList.add(after ? 'chx-drop-after' : 'chx-drop-before');
                DRAG.target = { kind: 'row', id: row.dataset.cid, after: after };
                return;
            }
            var grp = under.closest('.chx-group');
            if (grp) {
                grp.classList.add('chx-drop-into');
                DRAG.target = { kind: 'group', sid: grp.dataset.sid || '', start: !!under.closest('.chx-sec') };
            }
        } else {
            var g = under.closest('.chx-group[data-sid]');
            if (!g || g === DRAG.node) return;
            var gc = g.getBoundingClientRect();
            var aft = e.clientY > gc.top + gc.height / 2;
            g.classList.add(aft ? 'chx-drop-after' : 'chx-drop-before');
            DRAG.target = { kind: 'sec', id: g.dataset.sid, after: aft };
        }
    }

    function onGripUp(e) { if (DRAG && e.pointerId === DRAG.pid) finishDrag(true); }
    function onGripCancel() { finishDrag(false); }

    function finishDrag(commit) {
        var d = DRAG;
        if (!d) return;
        DRAG = null;
        d.grip.removeEventListener('pointermove', onGripMove);
        d.grip.removeEventListener('pointerup', onGripUp);
        d.grip.removeEventListener('pointercancel', onGripCancel);
        try { d.grip.releasePointerCapture(d.pid); } catch (err) { /* ignore */ }
        d.node.classList.remove('is-dragging');
        document.body.classList.remove('chx-dragging');
        clearMarks();
        if (commit && d.target) commitDrop(d);
    }

    function commitDrop(d) {
        var t = d.target;
        if (d.type === 'ch') {
            var ch = chanById(d.id);
            if (!ch) return;
            var cont = containers();
            cont.forEach(function (list) { var i = list.indexOf(ch); if (i >= 0) list.splice(i, 1); });
            var key, list, idx;
            if (t.kind === 'row') {
                var tgt = chanById(t.id);
                if (!tgt) return;
                key = sectionKnown(tgt.section_id) ? tgt.section_id : '';
                list = cont.get(key);
                idx = list.indexOf(tgt) + (t.after ? 1 : 0);
            } else {
                key = cont.has(t.sid) ? t.sid : '';
                list = cont.get(key);
                idx = t.start ? 0 : list.length;
            }
            list.splice(idx, 0, ch);
            ch.section_id = key || null;
            cont.forEach(function (l) { l.forEach(function (c, i) { c.position = i; }); });
        } else {
            var secs = sortedSections();
            var s = secs.filter(function (x) { return x.id === d.id; })[0];
            var ts = secs.filter(function (x) { return x.id === t.id; })[0];
            if (!s || !ts) return;
            secs.splice(secs.indexOf(s), 1);
            secs.splice(secs.indexOf(ts) + (t.after ? 1 : 0), 0, s);
            secs.forEach(function (x, i) { x.position = i; });
        }
        H.renderList();
        saveLayout();
    }

    function onGripKey(e, type, id) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        var dir = e.key === 'ArrowUp' ? -1 : 1;
        if (type === 'sec') {
            var secs = sortedSections();
            var i = secs.findIndex(function (s) { return s.id === id; });
            var j = i + dir;
            if (i < 0 || j < 0 || j >= secs.length) return;
            var tmp = secs[i]; secs[i] = secs[j]; secs[j] = tmp;
            secs.forEach(function (s, k) { s.position = k; });
        } else {
            var cont = containers(), keys = Array.from(cont.keys()), ch = chanById(id);
            if (!ch) return;
            var key = sectionKnown(ch.section_id) ? ch.section_id : '';
            var list = cont.get(key), a = list.indexOf(ch), b = a + dir;
            if (b >= 0 && b < list.length) { list.splice(a, 1); list.splice(b, 0, ch); }
            else {                                                      // past the edge: hop into the next / previous group
                var ki = keys.indexOf(key) + dir;
                if (ki < 0 || ki >= keys.length) return;
                list.splice(a, 1);
                var nk = keys[ki], nl = cont.get(nk);
                if (dir < 0) nl.push(ch); else nl.unshift(ch);
                ch.section_id = nk || null;
            }
            cont.forEach(function (l) { l.forEach(function (c, k) { c.position = k; }); });
        }
        H.renderList();
        saveLayout();
        var g = document.querySelector(type === 'sec' ? '.chx-group[data-sid="' + id + '"] .chx-grip' : '.chx-row[data-cid="' + id + '"] .chx-grip');
        if (g) g.focus();
    }

    async function saveLayout() {
        var roomId = ST.roomId;
        if (!roomId) return;
        var layout = {
            sections: ST.sections.map(function (s) { return { id: s.id, position: s.position || 0 }; }),
            channels: ST.channels.map(function (c) { return { id: c.id, section_id: sectionKnown(c.section_id) ? c.section_id : null, position: c.position || 0 }; })
        };
        try {
            var res = await H.sb.rpc('chat_layout_save', { p_room: roomId, p_layout: layout });
            if (res.error) throw res.error;
        } catch (err) { H.toast(fe(err)); reload(); }
    }

    /* ----------------------------------------------------------------------
       channel types: spoiler blur, sensitive gate, "coming soon"
       ---------------------------------------------------------------------- */
    function removeOverlay() {
        if (ST.panel && ST.panel.teardown) { try { ST.panel.teardown(); } catch (e) { /* ignore */ } }
        ST.panel = null;
        var old = document.getElementById('chxOverlay');
        if (old) old.remove();
        var feed = document.getElementById('chFeed');
        var comp = document.querySelector('#chConvo .ch-composer');
        if (feed) feed.inert = false;
        if (comp) comp.inert = false;
    }

    function applyChannelUi() {
        var c = curChannel();
        var feed = H.$('chFeed');
        feed.classList.toggle('chx-spoiler', !!c && c.type === 'spoiler');
        removeOverlay();
        if (!c) return;
        if (isPanel(c)) liveOpen(c); else liveClose();
        if (isPanel(c) && !ST.thread) showPanel(c);
        else if (c.type === 'sensitive' && !ST.gateOk.has(c.id)) showOverlay(c, 'sensitive');
    }

    function backToSafe() {
        var dc = defaultChannel();
        if (dc && dc.id !== ST.channel && dc.type !== 'sensitive') SP.openChannel(dc.id);
        else H.setNav('mine');
    }

    function showOverlay(c, kind) {
        var el = H.el;
        var convo = H.$('chConvo');
        var card;
        if (kind === 'sensitive') {
            card = el('div', { class: 'chx-card' },
                svg('sensitive', 'chx-card-ico'),
                el('h3', { text: '#' + c.name + ' is a sensitive channel' }),
                el('p', { text: 'It can contain content some people find upsetting. You choose whether to read it.' }),
                el('div', { class: 'chx-card-actions' },
                    el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', onclick: backToSafe }, 'Take me back'),
                    el('button', { type: 'button', class: 'ch-btn', onclick: function () { ST.gateOk.add(c.id); writeSet(KEY_GATE, ST.gateOk); removeOverlay(); SP.lockComposer(); var i = H.$('chInput'); if (i) i.focus(); } }, 'I understand, show it')));
        }
        var box = el('div', { id: 'chxOverlay', class: 'chx-overlay', role: 'group', 'aria-label': kind === 'sensitive' ? 'Sensitive channel warning' : 'Channel type not available yet' }, card);
        convo.appendChild(box);
        H.$('chFeed').inert = true;
        var comp = convo.querySelector('.ch-composer');
        if (comp) comp.inert = true;
    }

    // spoiler channel: blurred until clicked (capture phase so links and images do not open first)
    function wireSpoiler() {
        var feed = H.$('chFeed');
        if (!feed || feed.dataset.chxWired) return;
        feed.dataset.chxWired = '1';
        feed.addEventListener('click', function (e) {
            if (!feed.classList.contains('chx-spoiler')) return;
            var msg = e.target.closest && e.target.closest('.ch-msg');
            if (!msg || msg.classList.contains('chx-revealed')) return;
            if (e.target.closest('.ch-tools, .ch-msg-more, .ch-reactions, .ch-msg-head')) return;
            if (!e.target.closest('.ch-bubble, .ch-attachment')) return;
            e.preventDefault();
            e.stopPropagation();
            ST.revealed.add(msg.dataset.id);
            msg.classList.add('chx-revealed');
        }, true);
        // chats.js redraws messages often: keep the ones you already revealed open
        new MutationObserver(function (list) {
            if (!feed.classList.contains('chx-spoiler') || !ST.revealed.size) return;
            list.forEach(function (m) {
                m.addedNodes.forEach(function (n) {
                    if (n.nodeType === 1 && n.classList.contains('ch-msg') && ST.revealed.has(n.dataset.id)) n.classList.add('chx-revealed');
                });
            });
        }).observe(feed, { childList: true });
    }

    /* ----------------------------------------------------------------------
       dialogs (built once, with the same classes as the rest of chats.html)
       ---------------------------------------------------------------------- */
    function buildDialogs() {
        if (ST.dlg) return ST.dlg;
        var wrap = document.createElement('div');
        var opts = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '">' + TYPES[k].label + '</option>'; }).join('');
        // static markup only, no user text
        wrap.innerHTML =
            '<dialog class="ch-dlg ch-dlg--small chx-dlg" id="chxChDlg" aria-labelledby="chxChTitle">' +
            '<form id="chxChForm" novalidate>' +
            '<header class="ch-dlg-head"><h2 id="chxChTitle">Create channel</h2><button type="button" class="ch-iconbtn" data-chx-close aria-label="Close"></button></header>' +
            '<div class="ch-dlg-body">' +
            '<div class="ch-msgbox" id="chxChMsg" role="alert"></div>' +
            '<label class="ch-label" for="chxChName">NAME</label>' +
            '<input class="ch-field" id="chxChName" maxlength="32" autocomplete="off" spellcheck="false" autocapitalize="none" placeholder="general">' +
            '<label class="ch-label" for="chxChType">TYPE</label>' +
            '<select class="ch-field" id="chxChType">' + opts + '</select>' +
            '<p class="ch-help" id="chxChHint"></p>' +
            '<label class="ch-label" for="chxChSec">SECTION</label>' +
            '<select class="ch-field" id="chxChSec"></select>' +
            '<label class="ch-label" for="chxChTopic">TOPIC (OPTIONAL)</label>' +
            '<input class="ch-field" id="chxChTopic" maxlength="200" autocomplete="off" placeholder="What is this channel for?">' +
            '<label class="ch-check"><input type="checkbox" id="chxChPrivate"><span class="ch-box" aria-hidden="true"></span><span>Private channel: only owners, admins and people you add can see it</span></label>' +
            '<div class="chx-members" id="chxMembers" hidden>' +
            '<span class="ch-label">PEOPLE WITH ACCESS</span>' +
            '<div class="chx-members-add"><input class="ch-field" id="chxMemName" maxlength="20" autocomplete="off" spellcheck="false" autocapitalize="none" placeholder="username"><button type="button" class="ch-btn ch-btn--ghost" id="chxMemAdd">Add</button></div>' +
            '<div class="chx-members-list" id="chxMemList"></div>' +
            '</div>' +
            '</div>' +
            '<footer class="ch-dlg-foot">' +
            '<button type="button" class="ch-btn ch-btn--ghost ch-btn--danger" id="chxChDel" hidden>Delete</button>' +
            '<button type="button" class="ch-btn ch-btn--ghost" data-chx-close>Cancel</button>' +
            '<button type="submit" class="ch-btn" id="chxChSave"><span class="ch-btn-label">Create</span><span class="ch-spin" aria-hidden="true"></span></button>' +
            '</footer></form></dialog>' +

            '<dialog class="ch-dlg ch-dlg--small chx-dlg" id="chxSecDlg" aria-labelledby="chxSecTitle">' +
            '<form id="chxSecForm" novalidate>' +
            '<header class="ch-dlg-head"><h2 id="chxSecTitle">New section</h2><button type="button" class="ch-iconbtn" data-chx-close aria-label="Close"></button></header>' +
            '<div class="ch-dlg-body">' +
            '<div class="ch-msgbox" id="chxSecMsg" role="alert"></div>' +
            '<label class="ch-label" for="chxSecName">NAME</label>' +
            '<input class="ch-field" id="chxSecName" maxlength="40" autocomplete="off" placeholder="Dev talk">' +
            '<p class="ch-help" id="chxSecNote" hidden>Deleting a section keeps its channels. They just move out of the section.</p>' +
            '</div>' +
            '<footer class="ch-dlg-foot">' +
            '<button type="button" class="ch-btn ch-btn--ghost ch-btn--danger" id="chxSecDel" hidden>Delete</button>' +
            '<button type="button" class="ch-btn ch-btn--ghost" data-chx-close>Cancel</button>' +
            '<button type="submit" class="ch-btn" id="chxSecSave"><span class="ch-btn-label">Create</span><span class="ch-spin" aria-hidden="true"></span></button>' +
            '</footer></form></dialog>';

        var chDlg = wrap.querySelector('#chxChDlg');
        var secDlg = wrap.querySelector('#chxSecDlg');
        document.body.appendChild(chDlg);
        document.body.appendChild(secDlg);

        [chDlg, secDlg].forEach(function (d) {
            d.querySelectorAll('.ch-iconbtn[data-chx-close]').forEach(function (b) { b.textContent = '×'; });
            d.addEventListener('click', function (e) {
                if (e.target === d || (e.target.closest && e.target.closest('[data-chx-close]'))) d.close();
            });
        });

        var typeSel = chDlg.querySelector('#chxChType');
        typeSel.addEventListener('change', function () { chDlg.querySelector('#chxChHint').textContent = (TYPES[typeSel.value] || {}).hint || ''; });
        chDlg.querySelector('#chxChForm').addEventListener('submit', submitChannel);
        secDlg.querySelector('#chxSecForm').addEventListener('submit', submitSection);
        chDlg.querySelector('#chxChPrivate').addEventListener('change', function () { paintMembersBlock(); });
        chDlg.querySelector('#chxMemAdd').addEventListener('click', function () { changeMember(true); });
        chDlg.querySelector('#chxMemName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); changeMember(true); } });
        chDlg.querySelector('#chxChDel').addEventListener('click', deleteChannel);
        secDlg.querySelector('#chxSecDel').addEventListener('click', deleteSection);

        ST.dlg = { ch: chDlg, sec: secDlg, editing: null, section: null };
        return ST.dlg;
    }

    function msg(id, text) {
        var b = document.getElementById(id);
        if (!b) return;
        b.className = 'ch-msgbox' + (text ? ' is-error' : '');
        b.textContent = text || '';
    }

    /* ----- channel dialog ----- */
    function openChannelDlg(channel, sectionId) {
        var D = buildDialogs();
        var d = D.ch;
        D.editing = channel;
        msg('chxChMsg', '');
        d.querySelector('#chxChTitle').textContent = channel ? 'Edit #' + channel.name : 'Create channel';
        d.querySelector('#chxChSave .ch-btn-label').textContent = channel ? 'Save changes' : 'Create';
        d.querySelector('#chxChName').value = channel ? channel.name : '';
        d.querySelector('#chxChTopic').value = channel && channel.topic ? channel.topic : '';
        var typeSel = d.querySelector('#chxChType');
        typeSel.value = channel ? channel.type : 'text';
        d.querySelector('#chxChHint').textContent = (TYPES[typeSel.value] || {}).hint || '';

        var secSel = d.querySelector('#chxChSec');
        secSel.textContent = '';
        var none = document.createElement('option'); none.value = ''; none.textContent = 'No section'; secSel.appendChild(none);
        ST.sections.forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; secSel.appendChild(o); });
        secSel.value = channel ? (channel.section_id || '') : (sectionId || (ST.sections[0] && ST.sections[0].id) || '');

        var priv = d.querySelector('#chxChPrivate');
        priv.checked = !!(channel && channel.is_private);
        priv.disabled = !!(channel && channel.is_default);       // the default channel stays open to everyone
        d.querySelector('#chxChDel').hidden = !channel || !!channel.is_default;
        paintMembersBlock();
        d.showModal();
        d.querySelector('#chxChName').focus();
    }

    function paintMembersBlock() {
        var D = ST.dlg;
        var d = D.ch;
        var show = !!D.editing && d.querySelector('#chxChPrivate').checked && D.editing.is_private;
        d.querySelector('#chxMembers').hidden = !show;
        if (show) loadChannelMembers();
    }

    async function loadChannelMembers() {
        var D = ST.dlg, ch = D.editing;
        var list = D.ch.querySelector('#chxMemList');
        if (!ch) return;
        list.textContent = '';
        try {
            var res = await H.sb.rpc('chat_channel_members_list', { p_channel: ch.id });
            if (res.error) throw res.error;
            if (D.editing !== ch) return;
            var rows = res.data || [];
            if (!rows.length) { list.appendChild(H.el('p', { class: 'ch-help', text: 'Only owners and admins can see this channel right now.' })); return; }
            rows.forEach(function (u) {
                list.appendChild(H.el('div', { class: 'chx-member' },
                    H.el('span', { text: (u.display_name || u.username) + ' (@' + u.username + ')' }),
                    H.el('button', { type: 'button', class: 'ch-btn ch-btn--ghost ch-btn--sm', onclick: function () { changeMember(false, u.username); } }, 'Remove')));
            });
        } catch (err) { msg('chxChMsg', fe(err)); }
    }

    async function changeMember(add, username) {
        var D = ST.dlg, ch = D.editing;
        if (!ch) return;
        var input = D.ch.querySelector('#chxMemName');
        var name = (username || input.value || '').trim().replace(/^@/, '');
        if (!name) return;
        msg('chxChMsg', '');
        try {
            var res = await H.sb.rpc('chat_channel_member_set', { p_channel: ch.id, p_username: name, p_add: add });
            if (res.error) throw res.error;
            if (add) input.value = '';
            loadChannelMembers();
        } catch (err) { msg('chxChMsg', fe(err)); }
    }

    async function submitChannel(e) {
        e.preventDefault();
        var D = ST.dlg, d = D.ch, ch = D.editing;
        var btn = d.querySelector('#chxChSave');
        var name = d.querySelector('#chxChName').value;
        var type = d.querySelector('#chxChType').value;
        var section = d.querySelector('#chxChSec').value || null;
        var topic = d.querySelector('#chxChTopic').value;
        var priv = d.querySelector('#chxChPrivate').checked;
        if (!name.trim()) { msg('chxChMsg', 'Give the channel a name.'); return; }
        msg('chxChMsg', '');
        H.setLoading(btn, true);
        try {
            var newId = null;
            if (ch) {
                var up = await H.sb.rpc('chat_channel_update', { p_channel: ch.id, p_name: name, p_topic: topic, p_type: type, p_section: section, p_private: priv, p_move: true });
                if (up.error) throw up.error;
            } else {
                var cr = await H.sb.rpc('chat_channel_create', { p_room: ST.roomId, p_name: name, p_type: type, p_section: section, p_private: priv, p_topic: topic });
                if (cr.error) throw cr.error;
                newId = cr.data;
            }
            d.close();
            await reload();
            if (newId && chanById(newId)) SP.openChannel(newId);
            else if (ch && ch.id === ST.channel) { H.paintHeader(); }
        } catch (err) { msg('chxChMsg', fe(err)); }
        finally { H.setLoading(btn, false); }
    }

    async function deleteChannel() {
        var D = ST.dlg, ch = D.editing;
        if (!ch) return;
        if (!window.confirm('Delete #' + ch.name + '? Its messages are deleted too. This cannot be undone.')) return;
        var btn = D.ch.querySelector('#chxChDel');
        H.setLoading(btn, true);
        try {
            var res = await H.sb.rpc('chat_channel_delete', { p_channel: ch.id });
            if (res.error) throw res.error;
            D.ch.close();
            await reload();
            H.toast('Channel deleted');
        } catch (err) { msg('chxChMsg', fe(err)); }
        finally { H.setLoading(btn, false); }
    }

    /* ----- section dialog ----- */
    function openSectionDlg(section) {
        var D = buildDialogs();
        var d = D.sec;
        D.section = section;
        msg('chxSecMsg', '');
        d.querySelector('#chxSecTitle').textContent = section ? 'Edit section' : 'New section';
        d.querySelector('#chxSecSave .ch-btn-label').textContent = section ? 'Save changes' : 'Create';
        d.querySelector('#chxSecName').value = section ? section.name : '';
        d.querySelector('#chxSecDel').hidden = !section;
        d.querySelector('#chxSecNote').hidden = !section;
        d.showModal();
        d.querySelector('#chxSecName').focus();
    }

    async function submitSection(e) {
        e.preventDefault();
        var D = ST.dlg, d = D.sec, sec = D.section;
        var btn = d.querySelector('#chxSecSave');
        var name = d.querySelector('#chxSecName').value.trim();
        if (!name) { msg('chxSecMsg', 'Give the section a name.'); return; }
        msg('chxSecMsg', '');
        H.setLoading(btn, true);
        try {
            var res = sec
                ? await H.sb.rpc('chat_section_update', { p_section: sec.id, p_name: name })
                : await H.sb.rpc('chat_section_create', { p_room: ST.roomId, p_name: name });
            if (res.error) throw res.error;
            d.close();
            await reload();
        } catch (err) { msg('chxSecMsg', fe(err)); }
        finally { H.setLoading(btn, false); }
    }

    async function deleteSection() {
        var D = ST.dlg, sec = D.section;
        if (!sec) return;
        if (!window.confirm('Delete the section "' + sec.name + '"? Its channels are kept.')) return;
        var btn = D.sec.querySelector('#chxSecDel');
        H.setLoading(btn, true);
        try {
            var res = await H.sb.rpc('chat_section_delete', { p_section: sec.id });
            if (res.error) throw res.error;
            D.sec.close();
            await reload();
        } catch (err) { msg('chxSecMsg', fe(err)); }
        finally { H.setLoading(btn, false); }
    }

    /* ----------------------------------------------------------------------
       forum: open / close a post, pin / lock / delete
       ---------------------------------------------------------------------- */
    SP.openThread = function (id, info) {
        var r = H.S.current;
        if (!r || r.room_id !== ST.roomId) return;
        H.openRoom(r.room_id, { channel: ST.channel, thread: id, threadInfo: info || null, keepRoomCh: true });
    };

    SP.closeThread = function () {
        if (!ST.roomId) return;
        H.openRoom(ST.roomId, { channel: ST.channel, keepRoomCh: true });
    };

    function clearThreadActions() {
        document.querySelectorAll('#chConvo .ch-head-actions .chx-thr').forEach(function (n) { n.remove(); });
    }

    function paintThreadActions() {
        clearThreadActions();
        var box = document.querySelector('#chConvo .ch-head-actions');
        if (!box || !ST.thread || !ST.threadInfo) return;
        var t = ST.threadInfo, me = H.S.me && H.S.me.id, nodes = [];
        function b(label, fn, danger) {
            return H.el('button', { type: 'button', class: 'ch-btn ch-btn--ghost ch-btn--sm chx-thr' + (danger ? ' ch-btn--danger' : ''), onclick: fn }, label);
        }
        nodes.push(b('All posts', SP.closeThread));
        if (canManage('manage_threads')) {
            nodes.push(b(t.pinned ? 'Unpin' : 'Pin', function () { setThread({ p_pinned: !t.pinned }); }));
            nodes.push(b(t.locked ? 'Unlock' : 'Lock', function () { setThread({ p_locked: !t.locked }); }));
        }
        if (canManage('manage_threads') || t.author_id === me) nodes.push(b('Delete post', deleteThread, true));
        nodes.reverse().forEach(function (n) { box.insertBefore(n, box.firstChild); });
    }

    async function setThread(args) {
        var t = ST.threadInfo;
        if (!t) return;
        try {
            var res = await H.sb.rpc('chat_thread_set', Object.assign({ p_thread: t.id }, args));
            if (res.error) throw res.error;
            if ('p_pinned' in args) t.pinned = args.p_pinned;
            if ('p_locked' in args) t.locked = args.p_locked;
            paintThreadActions();
            SP.lockComposer();
            H.$('chRoomSub').textContent = SP.sub(H.S.current) || '';
            SP.api.ping();
            H.toast('p_pinned' in args ? (t.pinned ? 'Post pinned' : 'Post unpinned') : (t.locked ? 'Post locked' : 'Post unlocked'));
        } catch (err) { H.toast(fe(err)); }
    }

    async function deleteThread() {
        var t = ST.threadInfo;
        if (!t || !window.confirm('Delete this post and all its replies? This cannot be undone.')) return;
        try {
            var res = await H.sb.rpc('chat_thread_delete', { p_thread: t.id });
            if (res.error) throw res.error;
            H.toast('Post deleted');
            SP.api.ping();
            SP.closeThread();
        } catch (err) { H.toast(fe(err)); }
    }

    /* ----------------------------------------------------------------------
       panels (forum list, roadmap board, events). They live in
       chats-channels-panels.js and register themselves in SP.panels.
       ---------------------------------------------------------------------- */
    function showPanel(c) {
        var el = H.el, convo = H.$('chConvo');
        var body = el('div', { class: 'chx-panel-body' });
        convo.appendChild(el('div', { id: 'chxOverlay', class: 'chx-overlay chx-panel', role: 'region', 'aria-label': (TYPES[c.type] || {}).label || 'Channel' }, body));
        H.$('chFeed').inert = true;
        var comp = convo.querySelector('.ch-composer');
        if (comp) comp.inert = true;
        var impl = SP.panels[c.type];
        if (!impl) { body.appendChild(el('p', { class: 'chx-empty', text: 'This channel type could not load. Check that chats-channels-panels.js is on the page.' })); return; }
        try { ST.panel = impl.mount(body, c) || {}; }
        catch (err) { console.error(err); body.textContent = 'Could not open this channel.'; }
    }

    /* ----------------------------------------------------------------------
       one reusable form dialog for posts, roadmap items and events
         openForm({ title, submit, fields:[{key,label,type,value,placeholder,maxlength,rows,options,help}],
                    danger:{label,onClick}, onSubmit: async function(values) {} })
       onSubmit may throw: the message is shown inside the dialog.
       ---------------------------------------------------------------------- */
    function openForm(o) {
        var el = H.el;
        var dlg = el('dialog', { class: 'ch-dlg ch-dlg--small chx-dlg', 'aria-label': o.title });
        var msgBox = el('div', { class: 'ch-msgbox', role: 'alert' });
        var body = el('div', { class: 'ch-dlg-body' }, msgBox);
        var inputs = {};
        var stamp = Date.now();

        o.fields.forEach(function (f, i) {
            var id = 'chxF' + stamp + '_' + i, input;
            if (f.type === 'textarea') {
                input = el('textarea', { class: 'ch-field', id: id, rows: f.rows || 4, maxlength: f.maxlength || null, placeholder: f.placeholder || null });
            } else if (f.type === 'select') {
                input = el('select', { class: 'ch-field', id: id });
                f.options.forEach(function (op) { input.appendChild(el('option', { value: op[0], text: op[1] })); });
            } else {
                input = el('input', { class: 'ch-field', id: id, type: f.type === 'datetime' ? 'datetime-local' : 'text', maxlength: f.maxlength || null, placeholder: f.placeholder || null, autocomplete: 'off' });
            }
            input.value = f.value == null ? '' : f.value;
            inputs[f.key] = input;
            body.appendChild(el('label', { class: 'ch-label', for: id, text: f.label }));
            body.appendChild(input);
            if (f.help) body.appendChild(el('p', { class: 'ch-help', text: f.help }));
        });

        var saveBtn = el('button', { type: 'submit', class: 'ch-btn' }, el('span', { class: 'ch-btn-label', text: o.submit || 'Save' }), el('span', { class: 'ch-spin', 'aria-hidden': 'true' }));
        var foot = el('footer', { class: 'ch-dlg-foot' });
        if (o.danger) {
            foot.appendChild(el('button', {
                type: 'button', class: 'ch-btn ch-btn--ghost ch-btn--danger',
                onclick: async function (e) {
                    var b = e.currentTarget;
                    if (o.danger.confirm && !window.confirm(o.danger.confirm)) return;
                    H.setLoading(b, true);
                    try { await o.danger.onClick(); dlg.close(); }
                    catch (err) { msgBox.className = 'ch-msgbox is-error'; msgBox.textContent = fe(err); }
                    finally { H.setLoading(b, false); }
                }
            }, o.danger.label));
        }
        foot.appendChild(el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', onclick: function () { dlg.close(); } }, 'Cancel'));
        foot.appendChild(saveBtn);

        var form = el('form', { novalidate: true },
            el('header', { class: 'ch-dlg-head' }, el('h2', { text: o.title }), el('button', { type: 'button', class: 'ch-iconbtn', 'aria-label': 'Close', text: '×', onclick: function () { dlg.close(); } })),
            body, foot);
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var values = {};
            Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
            msgBox.className = 'ch-msgbox'; msgBox.textContent = '';
            H.setLoading(saveBtn, true);
            try { await o.onSubmit(values); dlg.close(); }
            catch (err) { msgBox.className = 'ch-msgbox is-error'; msgBox.textContent = fe(err); }
            finally { H.setLoading(saveBtn, false); }
        });
        dlg.appendChild(form);
        dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
        dlg.addEventListener('close', function () { dlg.remove(); });
        document.body.appendChild(dlg);
        dlg.showModal();
        var first = dlg.querySelector('input, textarea, select');
        if (first) first.focus();
        return dlg;
    }

    /* ----------------------------------------------------------------------
       live updates for forum / roadmap / events.
       One tiny realtime "ping" channel per open panel channel. Whoever changes
       something pings it, everybody who has that channel open re-reads (after a
       short random delay so a big crowd does not hit the server in the same instant).
       No data travels in the ping, so nothing private can leak through it.
       Votes and RSVPs are private rows, so table realtime could never deliver them.
       ---------------------------------------------------------------------- */
    function liveFire() {
        if (!ST.live) return;
        ST.live.subs.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    }

    function liveOpen(c) {
        if (ST.live && ST.live.id === c.id) return;
        liveClose();
        var live = { id: c.id, ch: null, subs: new Set(), t: null };
        ST.live = live;
        live.subs.add(refreshThread);
        try {
            live.ch = H.sb.channel('specsoft-live-' + c.id, { config: { broadcast: { self: false } } });
            live.ch.on('broadcast', { event: 'changed' }, function () {
                clearTimeout(live.t);
                live.t = setTimeout(liveFire, 350 + Math.random() * 650);
            });
            live.ch.subscribe();
        } catch (e) { live.ch = null; }
    }

    function liveClose() {
        var live = ST.live;
        if (!live) return;
        ST.live = null;
        clearTimeout(live.t);
        if (live.ch) { try { H.sb.removeChannel(live.ch); } catch (e) { /* ignore */ } }
    }

    // while a post is open: pin / lock / delete done by someone else
    async function refreshThread() {
        var id = ST.thread;
        if (!id) return;
        var info = await fetchThread(id);
        if (id !== ST.thread || info === undefined) return;
        if (info === null) { H.toast('That post was deleted.'); SP.closeThread(); return; }
        ST.threadInfo = info;
        paintThreadActions();
        SP.lockComposer();
        var sub = SP.sub(H.S.current);
        if (sub) H.$('chRoomSub').textContent = sub;
    }

    // coming back to the tab: catch up on anything the ping missed
    document.addEventListener('visibilitychange', function () { if (!document.hidden) liveFire(); });

    // permissions + reorder, used by chats.js and by the community settings screen
    SP.can = function (key, room) { return can(key, room); };
    SP.reloadPerms = async function (roomId) {
        await loadPerms(roomId);
        if (ST.roomId === roomId) { H.renderList(); SP.lockComposer(); SP.paintHeader(); }
    };
    SP.startReorder = function () {
        if (!ST.roomId || !canManage()) return false;
        ST.reorder = true;
        H.renderList();
        return true;
    };

    SP.panels = SP.panels || {};
    SP.api = {
        H: function () { return H; }, ST: ST, svg: svg, fe: fe, TYPES: TYPES,
        canManage: canManage, can: can, openForm: openForm,
        // panels: live(fn) runs fn when somebody else changed this channel. Returns a function that stops it.
        live: function (fn) {
            if (!ST.live) return function () {};
            var live = ST.live;
            live.subs.add(fn);
            return function () { live.subs.delete(fn); };
        },
        // tell everybody who has this channel open that something changed
        ping: function () {
            if (ST.live && ST.live.ch) { try { ST.live.ch.send({ type: 'broadcast', event: 'changed', payload: {} }); } catch (e) { /* ignore */ } }
        }
    };
})();
