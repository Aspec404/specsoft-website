/* ==========================================================================
   SPECSOFT® ban.js  -  the ban / suspension screen

   When a signed-in member has an active ban or suspension, this takes over the whole
   page: it is the only thing they can see or use, on every page that loads it.

   INSTALL: put this as the FIRST script in <head> of every page, before gate.js:
       <script src="ban.js"></script>
       <script src="gate.js"></script>
   (Pages that load main.js also get it automatically, as a safety net.)

   HOW IT WORKS
     1. The last known ban is remembered in this browser, so a banned member sees the
        screen immediately on every page load instead of a flash of the real page.
     2. Every time, it asks the server (my_ban_status) and trusts that answer. If the
        ban was lifted or expired, the screen disappears by itself.

   HONEST LIMITS (read once)
     * This screen is a front door, not a lock. Anyone can delete it in dev tools.
       What actually stops a banned account is the database: supabase-admin.sql blocks
       posting, commenting, chat, likes, follows and profile edits server-side.
     * It applies to the signed-in account. A banned person who signs out is just a
       visitor, and public pages are public to every visitor. Stopping that needs a
       server in front of the site (IP / device bans), not browser code.
   ========================================================================== */
(function () {
    'use strict';
    if (window.__specBan) return;
    window.__specBan = true;

    /* ---- fill these in (leave '' to hide that link) ---------------------- */
    var DISCORD_URL = '';      // e.g. 'https://discord.gg/yourinvite'
    var APPEALS_URL = '';      // e.g. 'appeals.html' or a full https:// link
    /* ---------------------------------------------------------------------- */

    var CFG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'
    };
    var CACHE_KEY = 'specsoft-ban-v1';
    var SCREEN_ID = 'specBan';

    var current = null;          // the ban being shown right now
    var screen = null;
    var guard = null;
    var tickTimer = null;
    var sbClient = null;
    var lastVerify = 0;

    /* ----------------------------------------------------------------------
       small helpers
       ---------------------------------------------------------------------- */
    function safeUrl(u) {
        if (!u) return '';
        try {
            var url = new URL(u, location.href);
            return (url.protocol === 'https:' || url.origin === location.origin) ? url.href : '';
        } catch (e) { return ''; }
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = text;
        return n;
    }

    function fmtDate(iso) {
        try { return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; }
    }

    function fmtDateTime(iso) {
        try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; }
    }

    function remaining(iso) {
        var ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return 'ending now';
        var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
        if (d >= 2) return d + ' days ' + (h % 24) + ' hours left';
        if (h >= 1) return h + ' hours ' + (m % 60) + ' minutes left';
        return Math.max(1, m) + ' minutes left';
    }

    function expired(data) {
        return !!(data && data.sanction && data.sanction.ends_at && new Date(data.sanction.ends_at).getTime() <= Date.now());
    }

    /* ----------------------------------------------------------------------
       who is signed in (read from the saved session, so it works before any script loads)
       ---------------------------------------------------------------------- */
    function sessionUid() {
        try {
            var ref = new URL(CFG.SUPABASE_URL).hostname.split('.')[0];
            var raw = localStorage.getItem('sb-' + ref + '-auth-token');
            if (!raw) return null;
            var j = JSON.parse(raw);
            var u = j && (j.user || (j.currentSession && j.currentSession.user));
            return (u && u.id) || null;
        } catch (e) { return null; }
    }

    function readCache() {
        try { var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return c && c.uid && c.data ? c : null; } catch (e) { return null; }
    }
    function writeCache(uid, data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: uid, data: data, at: Date.now() })); } catch (e) { /* ignore */ } }
    function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ } }

    function client() {
        if (sbClient) return sbClient;
        try {
            sbClient = window.getSupabaseClient ? window.getSupabaseClient()
                : (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
        } catch (e) { sbClient = null; }
        return sbClient;
    }

    /* ----------------------------------------------------------------------
       styles
       ---------------------------------------------------------------------- */
    function injectStyles() {
        if (document.getElementById('specBanStyles')) return;
        var css = [
            // while a ban is showing, nothing else on the page is visible, focusable or scrollable
            'html.sb-lock{overflow:hidden!important}',
            'html.sb-lock body>*:not(#' + SCREEN_ID + '){display:none!important}',
            '#' + SCREEN_ID + '{position:fixed;inset:0;z-index:2147483000;overflow-y:auto;background:#050506;color:#f5f5f7;',
            'font-family:"Space Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}',
            '#' + SCREEN_ID + ' *{box-sizing:border-box}',
            '#' + SCREEN_ID + '::before{content:"";position:fixed;inset:0;pointer-events:none;',
            'background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);',
            'background-size:44px 44px;-webkit-mask-image:radial-gradient(ellipse at 50% 0%,#000,transparent 72%);mask-image:radial-gradient(ellipse at 50% 0%,#000,transparent 72%)}',
            '.sb-wrap{position:relative;display:flex;justify-content:center;min-height:100%;padding:max(28px,env(safe-area-inset-top,0px)) 16px max(28px,env(safe-area-inset-bottom,0px))}',
            '.sb-card{width:min(640px,100%);align-self:center;padding:34px 32px 28px;background:#0d0d10;border:1px solid rgba(255,255,255,.2);border-radius:20px;box-shadow:0 40px 110px rgba(0,0,0,.7)}',
            '.sb-tag{display:flex;align-items:center;gap:8px;color:#9a9aa3;font:500 10.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:2.2px}',
            '.sb-dot{width:8px;height:8px;border-radius:50%;background:#ff4d4f;box-shadow:0 0 12px #ff4d4f;animation:sbPulse 1.8s ease infinite}',
            '@keyframes sbPulse{50%{opacity:.35}}',
            '.sb-title{margin:16px 0 0;font-size:clamp(34px,8vw,52px);font-weight:700;letter-spacing:-1.5px;line-height:1}',
            '.sb-lead{margin:14px 0 0;color:#b6b6bf;font-size:15.5px;line-height:1.65}',
            '.sb-sec{margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,.12)}',
            '.sb-h{margin:0 0 12px;color:#9a9aa3;font:500 10.5px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:2px;text-transform:uppercase}',
            '.sb-row{display:flex;gap:10px;margin:0 0 9px;font-size:15px;line-height:1.55}',
            '.sb-row b{flex:0 0 auto;min-width:122px;color:#9a9aa3;font-weight:500}',
            '.sb-row span{min-width:0;overflow-wrap:anywhere;white-space:pre-wrap}',
            '.sb-muted{color:#7d7d86}',
            '.sb-more{margin-top:4px;padding:0;background:none;border:0;color:#f5f5f7;font:600 12px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.6px;text-decoration:underline;text-underline-offset:4px;cursor:pointer}',
            '.sb-ev{margin:10px 0 0;padding:12px 14px;border:1px solid rgba(255,255,255,.12);border-radius:12px;font-size:13.5px;line-height:1.55}',
            '.sb-ev b{display:block;margin-bottom:2px;font:600 11.5px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.6px}',
            '.sb-ev small{display:block;margin-top:4px;color:#7d7d86;font:11px "JetBrains Mono",ui-monospace,monospace}',
            '.sb-dur{display:inline-block;padding:6px 14px;border:1px solid rgba(255,255,255,.28);border-radius:999px;font:600 13px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.4px}',
            '.sb-appeal{margin:0;color:#b6b6bf;font-size:14.5px;line-height:1.7}',
            '.sb-appeal a,.sb-link{color:#f5f5f7;text-decoration:underline;text-underline-offset:3px}',
            '.sb-btn{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 18px;background:#f5f5f7;border:1px solid #f5f5f7;border-radius:11px;color:#050506;font:600 12px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.7px;cursor:pointer}',
            '.sb-btn:hover{opacity:.88}.sb-btn:disabled{opacity:.45;cursor:not-allowed}',
            '.sb-btn--ghost{background:transparent;color:#f5f5f7;border-color:rgba(255,255,255,.3)}',
            '.sb-btn:focus-visible,.sb-more:focus-visible,#' + SCREEN_ID + ' a:focus-visible,.sb-area:focus-visible{outline:2px solid #fff;outline-offset:3px}',
            '.sb-area{width:100%;min-height:96px;margin-top:12px;padding:12px 14px;resize:vertical;background:#050506;border:1px solid rgba(255,255,255,.28);border-radius:11px;color:#f5f5f7;font:inherit;font-size:14.5px;line-height:1.55}',
            '.sb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}',
            '.sb-err{margin-top:10px;color:#ff7b7e;font-size:13.5px}',
            '.sb-chip{display:inline-block;margin-top:10px;padding:4px 12px;border:1px solid rgba(255,255,255,.28);border-radius:999px;font:600 11px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.8px;text-transform:uppercase}',
            '.sb-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:26px;padding-top:18px;border-top:1px solid rgba(255,255,255,.12);color:#7d7d86;font:11px "JetBrains Mono",ui-monospace,monospace}',
            '@media(max-width:520px){.sb-card{padding:26px 20px 22px}.sb-row{flex-direction:column;gap:2px}.sb-row b{min-width:0}}',
            '@media(prefers-reduced-motion:reduce){.sb-dot{animation:none}}'
        ].join('');
        var st = document.createElement('style');
        st.id = 'specBanStyles';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    /* ----------------------------------------------------------------------
       the screen
       ---------------------------------------------------------------------- */
    function row(label, value, muted) {
        var r = el('p', 'sb-row');
        r.appendChild(el('b', '', label));
        r.appendChild(el('span', muted ? 'sb-muted' : '', value));
        return r;
    }

    function link(href, text) {
        var a = el('a', 'sb-link', text);
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        return a;
    }

    function appealLine() {
        var p = el('p', 'sb-appeal');
        var d = safeUrl(DISCORD_URL), a = safeUrl(APPEALS_URL);
        if (d && a) {
            p.appendChild(document.createTextNode('You can appeal in our '));
            p.appendChild(link(d, 'Discord server'));
            p.appendChild(document.createTextNode(' or go to '));
            p.appendChild(link(a, 'SPECSOFT Appeals'));
            p.appendChild(document.createTextNode(' if you really want to get unbanned.'));
        } else if (d || a) {
            p.appendChild(document.createTextNode('You can appeal in our '));
            p.appendChild(link(d || a, d ? 'Discord server' : 'SPECSOFT Appeals'));
            p.appendChild(document.createTextNode(' if you really want to get unbanned.'));
        } else {
            p.textContent = 'If you really want to get unbanned, use the report button below and explain what happened.';
        }
        return p;
    }

    function durationText(s) {
        if (!s.ends_at) return 'Permanent';
        return remaining(s.ends_at) + '  \u00B7  ends ' + fmtDateTime(s.ends_at);
    }

    function appealState(box, data) {
        // shows the mistake report form, or the status of the one already sent
        while (box.firstChild) box.removeChild(box.firstChild);
        var s = data.sanction, ap = data.appeal;
        var openNow = ap && (ap.status === 'open' || ap.status === 'reviewing');

        box.appendChild(el('p', 'sb-h', 'Did we make a mistake?'));

        if (ap) {
            var label = { open: 'Received. A moderator will look at it', reviewing: 'A moderator is reviewing it', accepted: 'Accepted', rejected: 'Reviewed' }[ap.status] || ap.status;
            box.appendChild(el('p', 'sb-appeal', 'You sent a report on ' + fmtDate(ap.created_at) + '.'));
            box.appendChild(el('span', 'sb-chip', label));
            if (ap.response) box.appendChild(el('p', 'sb-appeal', 'Moderator reply: ' + ap.response));
        }
        if (openNow) return;

        var openBtn = el('button', 'sb-btn sb-btn--ghost', ap ? 'SEND ANOTHER REPORT' : 'REPORT THIS AS A MISTAKE');
        openBtn.type = 'button';
        var holder = el('div');
        openBtn.addEventListener('click', function () {
            openBtn.hidden = true;
            var area = el('textarea', 'sb-area');
            area.maxLength = 1000;
            area.setAttribute('aria-label', 'What should we know?');
            area.placeholder = 'Tell us what you think we got wrong. Be specific and honest, it helps a lot.';
            var err = el('p', 'sb-err');
            err.hidden = true;
            var send = el('button', 'sb-btn', 'SEND REPORT');
            send.type = 'button';
            var cancel = el('button', 'sb-btn sb-btn--ghost', 'CANCEL');
            cancel.type = 'button';
            cancel.addEventListener('click', function () { while (holder.firstChild) holder.removeChild(holder.firstChild); openBtn.hidden = false; });
            send.addEventListener('click', function () {
                err.hidden = true;
                if (area.value.trim().length < 10) { err.textContent = 'Please write at least a sentence (10 characters).'; err.hidden = false; return; }
                var sb = client();
                if (!sb) { err.textContent = 'Could not reach the server. Try again in a moment.'; err.hidden = false; return; }
                send.disabled = true;
                Promise.resolve(sb.rpc('ban_submit_appeal', { p_sanction: s.id, p_kind: 'mistake', p_message: area.value.trim() })).then(function (res) {
                    var d = res && res.data;
                    if (d && d.ok) { verify(true); return; }
                    var map = {
                        bad_message: 'Please write at least a sentence (10 characters).',
                        already_open: 'You already have a report waiting for review.',
                        too_many: 'You sent a few reports today already. Try again tomorrow.',
                        not_found: 'This restriction is not active anymore. Refreshing\u2026'
                    };
                    err.textContent = (d && map[d.error]) || 'Could not send that. Try again in a moment.';
                    err.hidden = false;
                    send.disabled = false;
                    if (d && d.error === 'not_found') verify(true);
                }).catch(function () { err.textContent = 'Could not send that. Try again in a moment.'; err.hidden = false; send.disabled = false; });
            });
            var actions = el('div', 'sb-actions');
            actions.appendChild(send); actions.appendChild(cancel);
            holder.appendChild(area); holder.appendChild(err); holder.appendChild(actions);
            area.focus();
        });
        box.appendChild(openBtn);
        box.appendChild(holder);
    }

    function build(data) {
        var s = data.sanction;
        var isBan = s.kind === 'ban';
        var root = el('div');
        root.id = SCREEN_ID;
        root.setAttribute('role', 'alertdialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'sbTitle');
        root.setAttribute('aria-describedby', 'sbLead');

        var wrap = el('div', 'sb-wrap');
        var card = el('main', 'sb-card');

        var tag = el('div', 'sb-tag');
        tag.appendChild(el('span', 'sb-dot'));
        tag.appendChild(el('span', '', 'SPECSOFT  \u00B7  ACCOUNT ACTION'));
        card.appendChild(tag);

        var title = el('h1', 'sb-title', (isBan ? 'Banned' : 'Suspended') + ' \uD83D\uDEAB');
        title.id = 'sbTitle';
        card.appendChild(title);
        var lead = el('p', 'sb-lead', 'We ' + (isBan ? 'banned' : 'suspended') + ' your account due to breaking our rules and guidelines. We have taken action on your account.');
        lead.id = 'sbLead';
        card.appendChild(lead);

        var what = el('section', 'sb-sec');
        what.appendChild(el('p', 'sb-h', 'What happened'));
        what.appendChild(row('Reason', s.reason || 'Not provided'));
        what.appendChild(row('Moderator note', s.mod_note || 'No note was added.', !s.mod_note));
        card.appendChild(what);

        var ev = data.evidence || [];
        var latest = el('section', 'sb-sec');
        latest.appendChild(el('p', 'sb-h', 'Latest activity we\u2019ve reviewed'));
        if (ev.length) {
            latest.appendChild(row('Evidence ID', ev[0].ref));
            latest.appendChild(row('Review date', fmtDate(ev[0].reviewed_at)));
            if (ev[0].summary) latest.appendChild(row('What we saw', ev[0].summary));
            if (ev.length > 1) {
                var more = el('button', 'sb-more', 'View more (' + (ev.length - 1) + ')');
                more.type = 'button';
                more.setAttribute('aria-expanded', 'false');
                var list = el('div');
                list.hidden = true;
                ev.slice(1).forEach(function (e) {
                    var item = el('div', 'sb-ev');
                    item.appendChild(el('b', '', e.ref));
                    item.appendChild(el('span', '', e.summary || ''));
                    item.appendChild(el('small', '', 'Reviewed ' + fmtDate(e.reviewed_at)));
                    list.appendChild(item);
                });
                more.addEventListener('click', function () {
                    list.hidden = !list.hidden;
                    more.setAttribute('aria-expanded', String(!list.hidden));
                    more.textContent = list.hidden ? 'View more (' + (ev.length - 1) + ')' : 'View less';
                });
                latest.appendChild(more);
                latest.appendChild(list);
            }
        } else {
            latest.appendChild(row('Evidence ID', 'None attached yet', true));
            latest.appendChild(row('Review date', fmtDate(s.issued_at)));
        }
        card.appendChild(latest);

        var dur = el('section', 'sb-sec');
        dur.appendChild(el('p', 'sb-h', isBan ? 'Ban duration' : 'Suspension duration'));
        var chip = el('span', 'sb-dur', durationText(s));
        chip.id = 'sbDur';
        dur.appendChild(chip);
        card.appendChild(dur);

        var appeal = el('section', 'sb-sec');
        appeal.appendChild(appealLine());
        card.appendChild(appeal);

        var mistake = el('section', 'sb-sec');
        appealState(mistake, data);
        card.appendChild(mistake);

        var foot = el('div', 'sb-foot');
        foot.appendChild(el('span', '', data.username ? 'Signed in as @' + data.username : 'Signed in'));
        var out = el('button', 'sb-btn sb-btn--ghost', 'LOG OUT');
        out.type = 'button';
        out.addEventListener('click', function () {
            var sb = client();
            clearCache();
            Promise.resolve(sb && sb.auth ? sb.auth.signOut() : null).catch(function () { /* ignore */ }).then(function () { location.reload(); });
        });
        foot.appendChild(out);
        card.appendChild(foot);

        wrap.appendChild(card);
        root.appendChild(wrap);
        return root;
    }

    function show(data) {
        if (!document.body) { document.addEventListener('DOMContentLoaded', function () { show(data); }); return; }
        current = data;
        injectStyles();
        document.documentElement.classList.add('sb-lock');
        if (screen && screen.parentNode) screen.parentNode.removeChild(screen);
        screen = build(data);
        document.body.appendChild(screen);
        document.title = (data.sanction.kind === 'ban' ? 'Banned' : 'Suspended') + ' | SPECSOFT\u00AE';
        startTicker();
        startGuard();
        var t = screen.querySelector('#sbTitle');
        if (t) { t.tabIndex = -1; try { t.focus(); } catch (e) { /* ignore */ } }
    }

    function hide() {
        stopGuard();
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        document.documentElement.classList.remove('sb-lock');
        if (screen && screen.parentNode) screen.parentNode.removeChild(screen);
        screen = null; current = null;
    }

    function startTicker() {
        if (tickTimer) clearInterval(tickTimer);
        tickTimer = setInterval(function () {
            if (!current) return;
            if (expired(current)) { verify(true); return; }
            var chip = document.getElementById('sbDur');
            if (chip && current.sanction.ends_at) chip.textContent = durationText(current.sanction);
        }, 30000);
    }

    // if the screen (or the lock class) is removed from the page, put it straight back
    function startGuard() {
        stopGuard();
        if (!window.MutationObserver) return;
        guard = new MutationObserver(function () {
            if (!current) return;
            if (!document.documentElement.classList.contains('sb-lock')) document.documentElement.classList.add('sb-lock');
            if (screen && !document.getElementById(SCREEN_ID) && document.body) document.body.appendChild(screen);
        });
        guard.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        if (document.body) guard.observe(document.body, { childList: true });
    }
    function stopGuard() { if (guard) { guard.disconnect(); guard = null; } }

    /* ----------------------------------------------------------------------
       asking the server
       ---------------------------------------------------------------------- */
    function verify(force) {
        var uid = sessionUid();
        if (!uid) { clearCache(); if (current) hide(); return; }                   // signed out: this is about the account
        if (!force && Date.now() - lastVerify < 20000) return;
        var sb = client();
        if (!sb) return;
        lastVerify = Date.now();

        Promise.resolve(sb.rpc('my_ban_status')).then(function (res) {
            if (!res || res.error) return;                                          // function not installed / offline: keep what we know
            var d = res.data;
            if (d && d.banned && d.sanction) {
                writeCache(uid, d);
                if (!current || JSON.stringify(current) !== JSON.stringify(d)) show(d);     // only rebuild when something changed, so a half-written report is never wiped
            }
            else { clearCache(); if (current) { hide(); try { sessionStorage.removeItem('specsoft-intro-seen'); } catch (e) { /* ignore */ } } }
        }).catch(function () { /* the next check will retry */ });
    }

    function watchAuth() {
        var sb = client();
        if (sb && sb.auth && sb.auth.onAuthStateChange) {
            sb.auth.onAuthStateChange(function (event) {
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') setTimeout(function () { verify(true); }, 50);
            });
        }
    }

    /* ----------------------------------------------------------------------
       start
       ---------------------------------------------------------------------- */
    // 1) instant path: we already know this browser's account is banned
    var cached = readCache();
    var uid0 = sessionUid();
    if (cached && uid0 && cached.uid === uid0 && !expired(cached.data)) {
        try { sessionStorage.setItem('specsoft-intro-seen', '1'); } catch (e) { /* ignore */ }   // no intro animation for a banned member
        injectStyles();
        document.documentElement.classList.add('sb-lock');
        show(cached.data);
    } else if (cached) {
        clearCache();
    }

    // 2) always double-check with the server once the page (and the Supabase script) is ready
    function ready() {
        var tries = 0;
        (function wait() {
            if (client() || ++tries > 40) { watchAuth(); verify(true); return; }
            setTimeout(wait, 150);
        })();
    }
    if (document.readyState === 'complete') ready();
    else window.addEventListener('load', ready);

    document.addEventListener('visibilitychange', function () { if (!document.hidden) verify(false); });
})();
