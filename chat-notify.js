/* ==========================================================================
   SPECSOFT® — chat-notify.js
   Chat notifications on EVERY page (not only chats.html).

   Add these lines to the END of every page (after your other scripts). If the page
   already loads supabase-js and supabase-config.js, you only need the last line:

       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3"></script>
       <script src="supabase-config.js"></script>
       <script src="chat-notify.js" defer></script>

   What it does (the same rules as the Chats page):
     * a banner slides in, with the sender, the chat name and a preview. Click it to open that chat
     * a "ding" (Chats > sound button) and a desktop notification when you are in another tab or app
       (Chats > bell button turns desktop notifications on)
     * muted chats stay quiet unless somebody @mentions you; blocked people never notify
     * the sensitive-word filter hides bad words in previews, like in the Chats page
     * (N) in the tab title, and a red number on any link to chats.html
     * new chat invites notify too
   It stays silent on chats.html itself (that page has its own notifications).

   Optional switches (put BEFORE this script):
       window.SPEC_CHAT_NOTIFY = { autoBadge: false, chatsUrl: 'chats.html' };
     autoBadge:false  -> do not add the red number to links; put <span data-chat-badge hidden></span>
                         wherever you want the number instead.
   Turn it off for this browser:  localStorage.setItem('specsoft.chat.sitewide', 'off')
   Console helpers: SpecChatNotify.enableDesktop(), .unread(), .refresh(), .stop()
   ========================================================================== */
(function () {
    'use strict';
    if (window.__specChatNotify) return;
    if (/(^|\/)chats(\.html)?\/?$/i.test(location.pathname)) return;      // the Chats page notifies by itself
    window.__specChatNotify = true;

    const CFG = Object.assign({ autoBadge: true, chatsUrl: 'chats.html', maxBanners: 3 }, window.SPEC_CHAT_NOTIFY || {});
    const TAB = Math.random().toString(36).slice(2);

    /* ---------- tiny helpers ---------- */
    function ls(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function soundOn() { return ls('specsoft.chat.sound') !== 'off'; }
    function filterOn() { return ls('specsoft.chat.filter') !== 'off'; }
    function sitewideOn() { return ls('specsoft.chat.sitewide') !== 'off'; }
    function notifSupported() { return typeof window.Notification !== 'undefined'; }
    function deskOn() { return notifSupported() && Notification.permission === 'granted' && ls('specsoft.chat.notif') !== 'off'; }
    function safeHttps(v) { return typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) ? v : null; }
    function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

    /* ---------- the sensitive-word filter: an exact copy of the one in chats.js ---------- */
    // STRONG: the word itself plus anything stuck to the end (fuck, fucking, fucker...)
    const FILTER_STRONG = [
        'fuck', 'motherfuck', 'shit', 'bullshit', 'horseshit', 'dipshit', 'cunt', 'bitch', 'asshole', 'dumbass', 'jackass',
        'dickhead', 'cocksuck', 'bastard', 'wanker', 'twat', 'whore', 'nigger', 'nigga', 'faggot', 'retard',
        // Tagalog / Bisaya
        'putang', 'tangina', 'tanginamo', 'gago', 'ulol', 'tarantado', 'pakyu', 'pakshet', 'punyeta', 'bwisit', 'buwisit',
        'siraulo', 'kantot', 'pekpek', 'yawa', 'pisti', 'piste', 'bilat'
    ];
    // EXACT: only the whole word (plus s / es / ed / ing / er) so "class" and "assistant" stay safe
    const FILTER_EXACT = [
        'ass', 'dick', 'pussy', 'slut', 'piss', 'prick', 'douche', 'bollocks', 'bobo', 'tanga', 'inutil', 'tite', 'boang', 'buang'
    ];
    // PHRASES: harsh things people say to hurt each other
    const FILTER_PHRASES = [
        'kill yourself', 'kys', 'go die', 'hope you die', 'hang yourself', 'neck yourself', 'end yourself',
        'nobody likes you', 'you are worthless', 'you re worthless', 'hayop ka'
    ];

    function filterNormalize(text) {
        let s = String(text || '')
            .replace(/https?:\/\/\S+/gi, ' ')                    // links are not text
            .replace(/:[a-z0-9_+-]{1,32}:/gi, ' ')               // :custom_emoji: codes are not text
            .normalize('NFKD')
            .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF]/g, '')   // accents + invisible characters
            .toLowerCase()
            .replace(/shii?take/g, ' ');                          // harmless words that look like a bad one
        // sneaky spellings: f4ck, sh!t, $hit, a$$ (only inside words, so "5 minutes" is left alone)
        s = s.replace(/[a-z0-9@$!|*]+/g, function (tok) {
            if (!/[a-z]/.test(tok)) return tok;
            return tok
                .replace(/([a-z])[!|]([a-z])/g, '$1i$2')
                .replace(/@/g, 'a').replace(/\$/g, 's')
                .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
        });
        return s;
    }

    function filterPattern(word, tail) {
        const parts = word.split('').map(function (ch) {
            if (ch === ' ') return '[^a-z]+';
            return (/[aeiou]/.test(ch) ? '[' + ch + '*]' : ch) + '+';     // fuuuck, f*ck
        });
        return new RegExp('(?:^|[^a-z])' + parts.join('[.\\-_]{0,2}') + tail + '(?![a-z])');   // f.u.c.k
    }

    const FILTER_RES = []
        .concat(FILTER_STRONG.map(function (w) { return filterPattern(w, '[a-z]{0,8}'); }))
        .concat(FILTER_EXACT.map(function (w) { return filterPattern(w, '(?:s|es|ed|ing|er|ers|y)?'); }))
        .concat(FILTER_PHRASES.map(function (w) { return filterPattern(w, ''); }));

    const sensCache = new Map();
    function isSensitive(text) {
        const s = String(text || '');
        if (!s || s.slice(0, 6) === '[[bug:') return false;
        if (sensCache.has(s)) return sensCache.get(s);
        const n = filterNormalize(s);
        const hit = FILTER_RES.some(function (re) { return re.test(n); });
        if (sensCache.size > 600) sensCache.clear();
        sensCache.set(s, hit);
        return hit;
    }

    /* ---------- state ---------- */
    const N = { sb: null, me: null, username: '', rooms: new Map(), blocked: new Set(), profiles: new Map(),
        ch: null, seen: new Set(), banners: new Map(), audio: null, bc: null, started: false, timer: 0, roomsTimer: 0, badgeTimer: 0, authSub: null };

    /* ---------- text ---------- */
    function mentions(body) {
        if (!N.username) return false;
        return new RegExp('(?<![A-Za-z0-9_])@' + N.username.replace(/[^A-Za-z0-9_]/g, '') + '(?![A-Za-z0-9_])', 'i').test(body || '');
    }

    function previewOf(body) {
        const t = String(body || '').trim();
        if (!t) return '';
        if (/^https:\/\/(?:media\d*|i)\.giphy\.com\/\S+\.(?:gif|webp)$/i.test(t)) return 'GIF';
        if (/^Attachment:\s*voice-\S+\.(webm|m4a|mp4|ogg)$/i.test(t)) return '\uD83C\uDFA4 Voice message';
        if (t.slice(0, 6) === '[[bug:') return '\uD83D\uDC1B Bug report';
        const att = /^Attachment:\s*(.+)$/i.exec(t);
        if (att) return '\uD83D\uDCCE ' + att[1].slice(0, 60);
        if (filterOn() && isSensitive(t)) return 'Sensitive message hidden';
        return t.replace(/```[\s\S]*?```/g, '[code]').replace(/\s+/g, ' ').trim().slice(0, 90);
    }

    /* ---------- data ---------- */
    async function refreshRooms() {
        if (!N.sb || !N.me) return;
        const res = await N.sb.rpc('chat_my_rooms');
        if (res.error) throw res.error;
        const next = new Map();
        (res.data || []).forEach(function (r) {
            r.unread = Number(r.unread) || 0; r.muted = !!r.muted; r.blocked_by_me = !!r.blocked_by_me;
            next.set(r.room_id, r);
        });
        N.rooms = next;
        paintBadge();
    }
    function refreshRoomsSoon() { clearTimeout(N.roomsTimer); N.roomsTimer = setTimeout(function () { refreshRooms().catch(function () {}); }, 500); }

    async function loadBlocks() {
        try {
            const res = await N.sb.from('chat_blocks').select('blocked_id').eq('blocker_id', N.me);
            if (!res.error) N.blocked = new Set((res.data || []).map(function (r) { return r.blocked_id; }));
        } catch (e) { /* optional */ }
    }

    async function getProfile(id) {
        if (N.profiles.has(id)) return N.profiles.get(id);
        let p = null;
        try {
            const res = await N.sb.from('profiles').select('id,username,display_name,avatar_url').eq('id', id).maybeSingle();
            p = res && res.data ? res.data : null;
        } catch (e) { /* ignore */ }
        N.profiles.set(id, p);
        return p;
    }
    const nameOf = function (p) { return (p && (p.display_name || p.username)) || 'Someone'; };
    function roomTitle(r) { return r.kind === 'dm' ? (r.other_display || r.other_username || 'Chat') : (r.name || 'Chat'); }

    /* ---------- badge: tab title + links + [data-chat-badge] ---------- */
    function totalUnread() { let n = 0; N.rooms.forEach(function (r) { if (!r.muted) n += r.unread || 0; }); return n; }

    function chatLinks() {
        const out = [];
        document.querySelectorAll('a[href]').forEach(function (a) {
            if (a.closest('.cn-host, .ch-app')) return;
            try {
                const u = new URL(a.getAttribute('href'), location.href);
                if (u.origin === location.origin && /(^|\/)chats(\.html)?\/?$/i.test(u.pathname) && !a.querySelector('[data-chat-badge]')) out.push(a);
            } catch (e) { /* not a url */ }
        });
        return out;
    }

    function paintBadge() {
        const n = totalUnread();
        const label = n > 99 ? '99+' : String(n);
        document.querySelectorAll('[data-chat-badge]').forEach(function (b) { b.textContent = label; b.hidden = n <= 0; });
        if (CFG.autoBadge) {
            chatLinks().forEach(function (a) {
                let b = a.querySelector(':scope > .cn-badge');
                if (n <= 0) { if (b) b.remove(); return; }
                if (!b) { b = el('span', 'cn-badge'); b.setAttribute('aria-hidden', 'true'); a.classList.add('cn-has-badge'); a.appendChild(b); }
                b.textContent = label;
            });
        }
        const base = document.title.replace(/^\(\d+\+?\)\s*/, '');
        document.title = (n > 0 ? '(' + label + ') ' : '') + base;
    }

    /* ---------- how you get told ---------- */
    let audioCtx = null;
    function ping() {
        if (!soundOn()) return;
        try {
            const C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            audioCtx = audioCtx || new C();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const t = audioCtx.currentTime;
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = 880;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(t); o.stop(t + 0.2);
        } catch (e) { /* sound is optional */ }
    }

    // several tabs of the site can be open: only one of them should ding
    function claim(id) {
        return new Promise(function (resolve) {
            const k = 'specsoft.chat.nt';
            try {
                const cur = JSON.parse(localStorage.getItem(k) || 'null');
                if (cur && cur.id === id) { resolve(false); return; }
                localStorage.setItem(k, JSON.stringify({ id: id, tab: TAB, at: Date.now() }));
                setTimeout(function () {
                    try { const back = JSON.parse(localStorage.getItem(k) || 'null'); resolve(!back || back.tab === TAB); } catch (e) { resolve(true); }
                }, 80);
            } catch (e) { resolve(true); }
        });
    }
    // ...and if the Chats page is open in another tab it dings by itself
    function chatsTabOpen() {
        return new Promise(function (resolve) {
            if (!('BroadcastChannel' in window)) { resolve(false); return; }
            let done = false;
            try {
                N.bc = N.bc || new BroadcastChannel('specsoft-chat-notify');
                const on = function (e) { if (e.data && e.data.t === 'here') { done = true; resolve(true); } };
                N.bc.addEventListener('message', on);
                N.bc.postMessage({ t: 'ask' });
                setTimeout(function () { N.bc.removeEventListener('message', on); if (!done) resolve(false); }, 150);
            } catch (e) { resolve(false); }
        });
    }

    function host() {
        let h = document.getElementById('cnHost');
        if (!h) { h = el('div', 'cn-host'); h.id = 'cnHost'; h.setAttribute('aria-live', 'polite'); document.body.appendChild(h); }
        return h;
    }

    function removeBanner(rec) {
        if (!rec) return;
        clearTimeout(rec.timer);
        if (N.banners.get(rec.key) === rec) N.banners.delete(rec.key);
        rec.node.classList.remove('is-in');
        setTimeout(function () { rec.node.remove(); }, 260);
    }

    function showBanner(o) {
        const h = host();
        removeBanner(N.banners.get(o.key));
        while (h.children.length >= CFG.maxBanners) h.firstChild.remove();

        const rec = { key: o.key, node: null, timer: 0 };
        const arm = function () { clearTimeout(rec.timer); rec.timer = setTimeout(function () { removeBanner(rec); }, 6500); };

        const av = el('span', 'cn-av');
        const pic = o.avatar && safeHttps(o.avatar);
        if (pic) { const img = el('img'); img.alt = ''; img.src = pic; img.addEventListener('error', function () { img.remove(); av.textContent = o.icon || '\uD83D\uDCAC'; }); av.appendChild(img); }
        else av.textContent = o.icon || '\uD83D\uDCAC';

        const main = el('button', 'cn-main');
        main.type = 'button';
        main.appendChild(av);
        const text = el('span', 'cn-text');
        text.appendChild(el('strong', null, o.title));
        text.appendChild(el('span', null, o.text));
        main.appendChild(text);
        main.addEventListener('click', function () { removeBanner(rec); open(o); });

        const x = el('button', 'cn-x', '\u00D7');
        x.type = 'button'; x.setAttribute('aria-label', 'Dismiss');
        x.addEventListener('click', function () { removeBanner(rec); });

        rec.node = el('div', 'cn-card');
        rec.node.setAttribute('role', 'status');
        rec.node.appendChild(main); rec.node.appendChild(x);
        rec.node.addEventListener('mouseenter', function () { clearTimeout(rec.timer); });
        rec.node.addEventListener('mouseleave', arm);

        h.appendChild(rec.node);
        N.banners.set(o.key, rec);
        requestAnimationFrame(function () { rec.node.classList.add('is-in'); });
        arm();
    }

    function open(o) {
        location.href = CFG.chatsUrl + (o.roomId ? '?room=' + encodeURIComponent(o.roomId) : '');
    }

    async function deliver(o) {
        const away = document.hidden || !document.hasFocus();
        if (away && deskOn()) {
            try {
                const n = new Notification(o.title, { body: o.text, tag: 'specsoft-' + o.key, renotify: true, silent: true, icon: (o.avatar && safeHttps(o.avatar)) || undefined });
                n.onclick = function () { try { window.focus(); } catch (e) { /* ignore */ } n.close(); open(o); };
                setTimeout(function () { try { n.close(); } catch (e) { /* ignore */ } }, 8000);
            } catch (e) { if (!document.hidden) showBanner(o); }       // some phones throw here: use the banner instead
        } else if (!document.hidden) {
            showBanner(o);
        }
        if (soundOn() && (await claim(o.id)) && !(await chatsTabOpen())) ping();
    }

    /* ---------- live events ---------- */
    async function onMessage(m) {
        if (!sitewideOn() || !m || !N.me || m.sender_id === N.me || m.deleted_at || N.seen.has(m.id)) return;
        N.seen.add(m.id);
        if (N.seen.size > 300) N.seen = new Set(Array.from(N.seen).slice(-100));

        let room = N.rooms.get(m.room_id);
        if (!room) {                                                   // a brand new chat (for example a new DM)
            try { await refreshRooms(); } catch (e) { return; }
            room = N.rooms.get(m.room_id);
            if (!room) return;
        }
        if (room.blocked_by_me || N.blocked.has(m.sender_id)) return;

        room.unread = (room.unread || 0) + 1;
        paintBadge();

        const mention = mentions(m.body);
        if (room.muted && !mention) return;                            // muted chats stay quiet, unless it is an @mention

        const sender = await getProfile(m.sender_id);
        const dm = room.kind === 'dm';
        const who = dm ? roomTitle(room) : nameOf(sender);
        const preview = previewOf(m.body) || 'Sent a message';
        deliver({
            id: m.id, key: room.room_id, roomId: room.room_id,
            title: dm ? who : roomTitle(room),
            text: mention ? who + ' mentioned you: ' + preview : (dm ? preview : who + ': ' + preview),
            avatar: dm ? room.other_avatar : (sender && sender.avatar_url),
            icon: room.icon
        });
    }

    async function onInbox(row) {
        if (!sitewideOn() || !row || row.kind !== 'invite' || N.seen.has('inv-' + row.id)) return;
        N.seen.add('inv-' + row.id);
        let who = 'Someone', name = 'a chat', icon = '\uD83D\uDC8C';
        try {
            const res = await N.sb.rpc('chat_my_invites');
            const inv = (res.data || []).find(function (i) { return i.room_id === row.room_id; });
            if (inv) { who = inv.invited_by_display || inv.invited_by_username || who; name = inv.room_name || name; icon = inv.room_icon || icon; }
        } catch (e) { /* generic text is fine */ }
        deliver({ id: 'inv-' + row.id, key: 'invite-' + row.room_id, roomId: null, title: 'New invite', text: who + ' invited you to ' + name, icon: icon });
    }

    function subscribe() {
        if (N.ch) { try { N.sb.removeChannel(N.ch); } catch (e) { /* ignore */ } }
        let wasDown = false;
        N.ch = N.sb.channel('specsoft-notify-' + N.me)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, function (p) { onMessage(p.new); })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_inbox', filter: 'user_id=eq.' + N.me }, function (p) { onInbox(p.new); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, refreshRoomsSoon)       // read / joined / left
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_prefs', filter: 'user_id=eq.' + N.me }, refreshRoomsSoon)   // muted / unmuted
            .subscribe(function (status) {
                if (status === 'SUBSCRIBED') { if (wasDown) { wasDown = false; refreshRooms().catch(function () {}); } }
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') wasDown = true;
            });
    }

    /* ---------- start / stop ---------- */
    async function begin(session) {
        if (N.started || !session || !session.user) return;
        N.started = true;
        N.me = session.user.id;
        try {
            const res = await N.sb.from('profiles').select('username').eq('id', N.me).maybeSingle();
            N.username = (res && res.data && res.data.username) || '';
            await Promise.all([refreshRooms(), loadBlocks()]);
        } catch (e) {                                                  // chats are not set up for this account: stay quiet
            N.started = false; N.me = null;
            return;
        }
        subscribe();
        N.timer = setInterval(function () { if (!document.hidden) refreshRooms().catch(function () {}); }, 45000);
        document.addEventListener('visibilitychange', onVisible);
        if (CFG.autoBadge && window.MutationObserver) {
            new MutationObserver(function () { clearTimeout(N.badgeTimer); N.badgeTimer = setTimeout(paintBadge, 400); })
                .observe(document.body, { childList: true, subtree: true });
        }
    }
    function onVisible() { if (!document.hidden) refreshRooms().catch(function () {}); }

    function stop() {
        if (N.ch && N.sb) { try { N.sb.removeChannel(N.ch); } catch (e) { /* ignore */ } }
        N.ch = null; N.started = false; N.me = null; N.rooms = new Map();
        clearInterval(N.timer);
        document.removeEventListener('visibilitychange', onVisible);
        paintBadge();
    }

    function css() {
        if (document.getElementById('cnStyle')) return;
        const s = document.createElement('style');
        s.id = 'cnStyle';
        s.textContent = [
            '.cn-host{position:fixed;top:calc(14px + env(safe-area-inset-top,0px));right:14px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 28px));pointer-events:none}',
            '.cn-card{position:relative;display:flex;align-items:stretch;overflow:hidden;background:var(--bg-card,#16181d);color:var(--text-primary,#f2f3f5);border:1px solid var(--border-hover,rgba(255,255,255,.18));border-radius:16px;box-shadow:0 16px 44px rgba(0,0,0,.45);opacity:0;transform:translateX(26px);transition:opacity .22s ease,transform .22s ease;pointer-events:auto}',
            '.cn-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--text-primary,#f2f3f5)}',
            '.cn-card.is-in{opacity:1;transform:none}',
            '.cn-main{display:flex;align-items:center;gap:12px;flex:1 1 auto;min-width:0;padding:12px 6px 12px 16px;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
            '.cn-av{display:grid;place-items:center;flex:0 0 auto;width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--accent-dim,rgba(255,255,255,.1));font-size:20px}',
            '.cn-av img{width:100%;height:100%;object-fit:cover}',
            '.cn-text{display:flex;flex-direction:column;gap:2px;min-width:0}',
            '.cn-text strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}',
            '.cn-text span{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;color:var(--text-secondary,#9aa0a6)}',
            '.cn-x{display:grid;place-items:center;flex:0 0 auto;width:38px;padding:0;background:none;border:0;color:var(--text-secondary,#9aa0a6);font-size:20px;cursor:pointer}',
            '.cn-x:hover{color:var(--text-primary,#f2f3f5)}',
            '.cn-has-badge{position:relative}',
            '.cn-badge{position:absolute;top:-6px;right:-8px;box-sizing:border-box;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ff4d4f;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;pointer-events:none}',
            '@media (prefers-reduced-motion:reduce){.cn-card{transition:none}}'
        ].join('\n');
        document.head.appendChild(s);
    }

    function boot() {
        if (document.getElementById('chApp')) return;                   // this IS the Chats page
        css();
        let tries = 0;
        (function wait() {
            N.sb = window.getSupabaseClient ? window.getSupabaseClient() : null;
            if (!N.sb) {
                if (++tries > 40) { console.warn('[chat-notify] Supabase is not loaded on this page. Add supabase-js and supabase-config.js before chat-notify.js.'); return; }
                setTimeout(wait, 250);
                return;
            }
            N.sb.auth.getSession().then(function (r) { return begin(r && r.data && r.data.session); }).catch(function () {});
            N.sb.auth.onAuthStateChange(function (event, session) {
                if (event === 'SIGNED_IN') setTimeout(function () { begin(session); }, 0);       // never call Supabase inside this callback
                else if (event === 'SIGNED_OUT') stop();
            });
        })();
    }

    window.SpecChatNotify = {
        unread: totalUnread,
        refresh: function () { return refreshRooms(); },
        stop: stop,
        enableDesktop: async function () {
            if (!notifSupported()) return false;
            let perm = Notification.permission;
            if (perm === 'default') { try { perm = (await Notification.requestPermission()) || Notification.permission; } catch (e) { perm = 'denied'; } }
            if (perm === 'granted') { try { localStorage.setItem('specsoft.chat.notif', 'on'); } catch (e) { /* ignore */ } return true; }
            return false;
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
