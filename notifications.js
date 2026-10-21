/* ==========================================================================
   SPECSOFT® notifications.js  -  the bell: Main / Events / System

   Load with  <script src="notifications.js" defer></script>  on any page that
   already loads supabase-config.js and main.js (the bell mounts next to the
   account chip main.js already draws, in .hud-bar .hud-right on desktop and
   .mobile-header on phones). Needs supabase-notifications.sql installed.

   Everything here is display + convenience. The real access control lives in
   the database functions it calls (my_notifications, notifications_mark_read,
   admin_publish_notification, ...), same as roles.js and admin.js.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecNotifications) return;

    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var _sb = null;
    function client() {
        if (_sb) return _sb;
        try {
            _sb = window.getSupabaseClient ? window.getSupabaseClient() : (
                (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
                    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null
            );
        } catch (e) { _sb = null; }
        return _sb;
    }

    var TABS = [
        { id: 'main',   label: 'Main' },
        { id: 'events', label: 'Events' },
        { id: 'system', label: 'System' }
    ];
    var TYPE_ICON = { like: '\u2764\uFE0F', follow: '\u2795', announcement: '\uD83D\uDCE3' };
    var CAT_ICON  = { main: '\uD83D\uDCE3', events: '\uD83D\uDCC5', system: '\uD83D\uDEE0\uFE0F' };

    /* ------------------------------ styles ------------------------------ */
    (function injectStyles() {
        if (document.getElementById('sn-styles')) return;
        var css = [
            '.sn-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;',
            'margin-right:6px;background:color-mix(in srgb,var(--text-primary,#fff) 6%,transparent);border:1px solid var(--border-hover,rgba(255,255,255,.18));',
            'border-radius:10px;color:var(--text-primary,#fff);cursor:pointer;flex:0 0 auto}',
            '.sn-bell:hover{background:color-mix(in srgb,var(--text-primary,#fff) 11%,transparent)}',
            '.sn-bell svg{width:17px;height:17px}',
            '.mobile-header .sn-bell{margin-left:auto;margin-right:8px}',
            '.mobile-header .sp-chip--mobile{margin-left:0}',
            '.sn-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;display:none;align-items:center;justify-content:center;',
            'background:var(--ad-bad,#ff4d4f);color:#fff;border-radius:999px;font:700 10px/16px var(--font-mono,ui-monospace,monospace)}',
            '.sn-badge.is-show{display:flex}',
            '.sn-panel{position:fixed;z-index:10060;width:min(380px,calc(100vw - 20px));max-height:min(70vh,560px);display:none;flex-direction:column;',
            'background:var(--bg-card,#14141a);border:1px solid var(--border-hover,rgba(255,255,255,.2));border-radius:14px;overflow:hidden;',
            'box-shadow:0 20px 50px rgba(0,0,0,.5);font:14px/1.5 var(--font-sans,system-ui,sans-serif);color:var(--text-primary,#fff)}',
            '.sn-panel.is-open{display:flex}',
            '.sn-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 0}',
            '.sn-head h3{margin:0;font-size:14px;font-weight:700}',
            '.sn-markall{background:none;border:0;color:var(--text-secondary,#999);font:600 11px var(--font-mono,monospace);letter-spacing:.4px;cursor:pointer;padding:4px}',
            '.sn-markall:hover{color:var(--text-primary,#fff)}',
            '.sn-tabs{display:flex;gap:4px;padding:10px 14px 0;flex:0 0 auto}',
            '.sn-tab{flex:1;display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 6px;background:none;border:1px solid transparent;',
            'border-radius:8px;color:var(--text-secondary,#999);font:600 11.5px var(--font-mono,monospace);letter-spacing:.3px;cursor:pointer}',
            '.sn-tab:hover{color:var(--text-primary,#fff)}',
            '.sn-tab.is-active{color:var(--text-primary,#fff);background:color-mix(in srgb,var(--text-primary,#fff) 9%,transparent);border-color:var(--border-hover,rgba(255,255,255,.18))}',
            '.sn-tab-n{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 3px;background:var(--ad-bad,#ff4d4f);color:#fff;border-radius:999px;font-size:9.5px}',
            '.sn-list{flex:1;min-height:0;overflow-y:auto;padding:8px 6px 10px;display:flex;flex-direction:column;gap:3px}',
            '.sn-row{display:flex;gap:10px;align-items:flex-start;width:100%;padding:9px 8px;background:none;border:0;border-radius:10px;text-align:left;color:inherit;cursor:pointer}',
            '.sn-row:hover{background:color-mix(in srgb,var(--text-primary,#fff) 6%,transparent)}',
            '.sn-row.is-unread{background:color-mix(in srgb,var(--accent,#60a5fa) 10%,transparent)}',
            '.sn-ico{flex:0 0 auto;width:30px;height:30px;display:grid;place-items:center;font-size:15px;background:color-mix(in srgb,var(--text-primary,#fff) 7%,transparent);border-radius:50%}',
            '.sn-main{flex:1;min-width:0}',
            '.sn-title{font-size:13px;font-weight:600;overflow-wrap:anywhere}',
            '.sn-body{margin-top:2px;color:var(--text-secondary,#999);font-size:12.5px;overflow-wrap:anywhere}',
            '.sn-time{margin-top:4px;color:var(--text-secondary,#777);font-family:var(--font-mono,monospace);font-size:10.5px;letter-spacing:.3px}',
            '.sn-dot{flex:0 0 auto;width:8px;height:8px;margin-top:6px;background:var(--accent,#60a5fa);border-radius:50%}',
            '.sn-empty{padding:34px 14px;text-align:center;color:var(--text-secondary,#999);font-size:13px}',
            '.sn-more{margin:4px 10px 8px;padding:8px;background:none;border:1px solid var(--border-hover,rgba(255,255,255,.18));border-radius:9px;',
            'color:var(--text-secondary,#999);font:600 11px var(--font-mono,monospace);letter-spacing:.3px;cursor:pointer}',
            '.sn-more:hover{color:var(--text-primary,#fff)}',
            '@media (max-width:560px){.sn-panel{left:10px!important;right:10px!important;width:auto!important;top:calc(var(--sn-top,60px) + 6px)!important}}'
        ].join('');
        var st = document.createElement('style');
        st.id = 'sn-styles';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    })();

    /* ------------------------------- state ------------------------------- */
    var S = {
        signedIn: false,
        open: false,
        tab: 'main',
        counts: { main: 0, events: 0, system: 0, total: 0 },
        data: { main: null, events: null, system: null },   // {items, before, done}
        bellEls: [],
        panel: null
    };

    function ago(iso) {
        if (!iso) return '';
        var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        if (s < 604800) return Math.floor(s / 86400) + 'd ago';
        try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
    }

    /* ------------------------------- bell UI ------------------------------- */
    function bellIcon() {
        var wrap = document.createElement('span');
        wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';
        return wrap.firstChild;
    }

    function makeBell() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sn-bell';
        btn.setAttribute('aria-label', 'Notifications');
        btn.appendChild(bellIcon());
        var badge = document.createElement('span');
        badge.className = 'sn-badge';
        btn.appendChild(badge);
        btn.addEventListener('click', function (e) { e.stopPropagation(); togglePanel(btn); });
        return btn;
    }

    function mountBells() {
        unmountBells();
        if (!S.signedIn) return;

        // The HUD remains visible while the mobile header is active at tablet
        // widths. Mount one bell in the active header to prevent duplicates.
        if (window.matchMedia('(max-width: 850px)').matches) {
            var header = document.querySelector('.mobile-header');
            if (header) {
                var m = makeBell();
                var ham = header.querySelector('.hamburger');
                var chip = header.querySelector('.sp-chip');
                header.insertBefore(m, chip || ham || null);
                S.bellEls.push(m);
            }
        } else {
            var hudRight = document.querySelector('.hud-bar .hud-right');
            if (hudRight) {
                var d = makeBell();
                hudRight.insertBefore(d, hudRight.firstChild);
                S.bellEls.push(d);
            }
        }

        paintBadges();
    }

    function unmountBells() {
        S.bellEls.forEach(function (b) { b.remove(); });
        S.bellEls = [];
    }

    function paintBadges() {
        var n = S.counts.total;
        S.bellEls.forEach(function (b) {
            var badge = b.querySelector('.sn-badge');
            if (!badge) return;
            badge.textContent = n > 9 ? '9+' : String(n);
            badge.classList.toggle('is-show', n > 0);
        });
    }

    /* ------------------------------- panel UI ------------------------------- */
    function buildPanel() {
        if (S.panel) return S.panel;
        var panel = document.createElement('div');
        panel.className = 'sn-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Notifications');

        var head = document.createElement('div');
        head.className = 'sn-head';
        var h3 = document.createElement('h3'); h3.textContent = 'Notifications';
        var markAll = document.createElement('button');
        markAll.type = 'button'; markAll.className = 'sn-markall'; markAll.textContent = 'MARK ALL READ';
        markAll.addEventListener('click', function () { markAllRead(S.tab); });
        head.appendChild(h3); head.appendChild(markAll);

        var tabsRow = document.createElement('div');
        tabsRow.className = 'sn-tabs';
        TABS.forEach(function (t) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sn-tab' + (t.id === S.tab ? ' is-active' : '');
            btn.dataset.tab = t.id;
            btn.innerHTML = '';
            btn.appendChild(document.createTextNode(t.label));
            var n = document.createElement('span');
            n.className = 'sn-tab-n';
            n.textContent = '';
            n.style.display = 'none';
            btn.appendChild(n);
            btn.addEventListener('click', function () { selectTab(t.id); });
            tabsRow.appendChild(btn);
        });

        var list = document.createElement('div');
        list.className = 'sn-list';

        panel.appendChild(head);
        panel.appendChild(tabsRow);
        panel.appendChild(list);
        document.body.appendChild(panel);

        panel._tabsRow = tabsRow;
        panel._list = list;
        S.panel = panel;
        return panel;
    }

    function positionPanel(anchor) {
        var panel = S.panel;
        if (window.innerWidth <= 560) {
            var header = document.querySelector('.mobile-header');
            var top = header ? header.getBoundingClientRect().bottom : 56;
            document.documentElement.style.setProperty('--sn-top', top + 'px');
            return;
        }
        var r = anchor.getBoundingClientRect();
        var w = 380;
        var left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
        panel.style.top = (r.bottom + 8) + 'px';
        panel.style.left = left + 'px';
    }

    function togglePanel(anchor) {
        if (S.open) { closePanel(); return; }
        openPanel(anchor);
    }

    function openPanel(anchor) {
        var panel = buildPanel();
        positionPanel(anchor);
        panel.classList.add('is-open');
        S.open = true;
        paintTabCounts();
        loadTab(S.tab, false);
        setTimeout(function () {
            document.addEventListener('click', onDocClick);
            document.addEventListener('keydown', onEsc);
        }, 0);
    }

    function closePanel() {
        if (!S.panel) return;
        S.panel.classList.remove('is-open');
        S.open = false;
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onEsc);
    }

    function onDocClick(e) {
        if (!S.panel || S.panel.contains(e.target)) return;
        if (S.bellEls.indexOf(e.target.closest ? e.target.closest('.sn-bell') : null) !== -1) return;
        closePanel();
    }
    function onEsc(e) { if (e.key === 'Escape') closePanel(); }

    function selectTab(id) {
        S.tab = id;
        if (!S.panel) return;
        Array.prototype.forEach.call(S.panel._tabsRow.children, function (btn) {
            btn.classList.toggle('is-active', btn.dataset.tab === id);
        });
        loadTab(id, false);
    }

    function paintTabCounts() {
        if (!S.panel) return;
        Array.prototype.forEach.call(S.panel._tabsRow.children, function (btn) {
            var n = S.counts[btn.dataset.tab] || 0;
            var badge = btn.querySelector('.sn-tab-n');
            badge.textContent = n > 9 ? '9+' : String(n);
            badge.style.display = n > 0 ? '' : 'none';
        });
    }

    function rowIcon(item) {
        var ico = document.createElement('div');
        ico.className = 'sn-ico';
        ico.textContent = TYPE_ICON[item.type] || CAT_ICON[item.category] || '\uD83D\uDD14';
        return ico;
    }

    function renderRow(item) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'sn-row' + (!item.read ? ' is-unread' : '');

        var main = document.createElement('div');
        main.className = 'sn-main';
        var title = document.createElement('div'); title.className = 'sn-title'; title.textContent = item.title;
        main.appendChild(title);
        if (item.body) { var body = document.createElement('div'); body.className = 'sn-body'; body.textContent = item.body; main.appendChild(body); }
        var time = document.createElement('div'); time.className = 'sn-time'; time.textContent = ago(item.created_at); main.appendChild(time);

        row.appendChild(rowIcon(item));
        row.appendChild(main);
        if (!item.read) row.appendChild(el2('span', 'sn-dot'));

        row.addEventListener('click', function () {
            if (!item.read) { item.read = true; row.classList.remove('is-unread'); var dot = row.querySelector('.sn-dot'); if (dot) dot.remove(); markRead([item.id]); }
            var dest = item.link_url || (item.project_id ? 'projects.html#' + item.project_id : null);
            if (dest) location.href = dest;
        });

        return row;
    }

    function el2(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }

    async function loadTab(tab, more) {
        var sb = client();
        if (!sb) return;
        var panel = S.panel;
        var list = panel._list;
        var state = S.data[tab];

        if (!more) {
            if (!state) {
                clearList(list);
                list.appendChild(el2('div', 'sn-empty'));
                list.lastChild.textContent = 'Loading\u2026';
            } else {
                paintList(tab);
                return;    // already cached, just show it; a manual refresh happens via mark-all/new items
            }
        }

        var before = more && state ? state.before : null;
        var d = await rpcCall(sb, 'my_notifications', { p_category: tab, p_limit: 20, p_before: before });
        var items = (d && d.ok !== false) ? (Array.isArray(d) ? d : (d.items || d)) : [];
        if (!Array.isArray(items)) items = [];

        if (!state) state = S.data[tab] = { items: [], before: null, done: false };
        state.items = more ? state.items.concat(items) : items;
        state.before = items.length ? items[items.length - 1].created_at : state.before;
        state.done = items.length < 20;

        if (S.tab === tab) paintList(tab);
    }

    function clearList(list) { while (list.firstChild) list.removeChild(list.firstChild); }

    function paintList(tab) {
        var list = S.panel._list;
        var state = S.data[tab];
        clearList(list);
        if (!state || !state.items.length) {
            var empty = el2('div', 'sn-empty');
            empty.textContent = { main: 'Nothing here yet.', events: 'No event announcements yet.', system: 'No system notices.' }[tab] || 'Nothing here yet.';
            list.appendChild(empty);
            return;
        }
        state.items.forEach(function (item) { list.appendChild(renderRow(item)); });
        if (!state.done) {
            var more = document.createElement('button');
            more.type = 'button'; more.className = 'sn-more'; more.textContent = 'LOAD MORE';
            more.addEventListener('click', function () { more.textContent = 'LOADING\u2026'; loadTab(tab, true); });
            list.appendChild(more);
        }
    }

    // my_notifications / my_notification_counts return raw jsonb (an array or object), not {ok,...}
    async function rpcCall(sb, name, args) {
        try {
            var res = await sb.rpc(name, args || {});
            if (res.error) return null;
            return res.data;
        } catch (e) { return null; }
    }

    async function markRead(ids) {
        var sb = client();
        if (!sb || !ids || !ids.length) return;
        await rpcCall(sb, 'notifications_mark_read', { p_ids: ids });
        refreshCounts();
    }

    async function markAllRead(tab) {
        var sb = client();
        if (!sb) return;
        await rpcCall(sb, 'notifications_mark_all_read', { p_category: tab });
        S.data[tab] = null;
        loadTab(tab, false);
        refreshCounts();
    }

    async function refreshCounts() {
        var sb = client();
        if (!sb || !S.signedIn) return;
        var d = await rpcCall(sb, 'my_notification_counts', {});
        if (d && typeof d === 'object') {
            S.counts = { main: d.main || 0, events: d.events || 0, system: d.system || 0, total: d.total || 0 };
            paintBadges();
            paintTabCounts();
        }
    }

    /* ------------------------------- boot ------------------------------- */
    function setSignedIn(signedIn) {
        if (signedIn === S.signedIn) return;
        S.signedIn = signedIn;
        if (signedIn) { mountBells(); refreshCounts(); }
        else { unmountBells(); closePanel(); S.data = { main: null, events: null, system: null }; }
    }

    function start() {
        var sb = client();
        if (!sb || !sb.auth) return;

        Promise.resolve(sb.auth.getSession()).then(function (r) {
            setSignedIn(!!(r && r.data && r.data.session));
        }).catch(function () { /* ignore */ });

        if (sb.auth.onAuthStateChange) {
            sb.auth.onAuthStateChange(function (_e, session) { setSignedIn(!!session); });
        }

        setInterval(function () { if (!document.hidden) refreshCounts(); }, 60 * 1000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshCounts(); });
        var mobileLayout = window.matchMedia('(max-width: 850px)');
        var lastMobileLayout = mobileLayout.matches;
        window.addEventListener('resize', function () {
            if (mobileLayout.matches !== lastMobileLayout) {
                lastMobileLayout = mobileLayout.matches;
                mountBells();
            }
            if (S.open && S.bellEls.length) positionPanel(S.bellEls[0]);
        });
    }

    window.SpecNotifications = { refresh: refreshCounts };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
