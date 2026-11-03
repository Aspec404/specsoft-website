/* ==========================================================================
   SPECSOFT® — Chats: channel panels (chats-channels-panels.js)
   Forum list, roadmap board and events for the "discussion", "roadmap" and
   "event" channel types. Load AFTER chats-channels.js and BEFORE chats.js.
   Needs: supabase-community-channels-v2.sql (run once).

   A panel is registered as SPCH.panels[type] = { mount(body, channel) }.
   mount() draws into `body` and returns { onMessage(m), teardown() } (both optional).
   ========================================================================== */
(function () {
    'use strict';

    var SP = window.SPCH;
    if (!SP || !SP.panels) { console.warn('[panels] load chats-channels.js first'); return; }

    function A() { return SP.api; }
    function H() { return SP.api.H(); }
    function el() { return H().el.apply(null, arguments); }
    function svg(n, c) { return A().svg(n, c); }
    function rpc(name, args) { return H().sb.rpc(name, args); }

    function fail(res) { if (res && res.error) throw res.error; return res; }

    function ago(iso) {
        var s = (Date.now() - new Date(iso).getTime()) / 1000;
        if (!isFinite(s)) return '';
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
        return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function head(title, sub, action) {
        return el('header', { class: 'chx-phead' },
            el('div', { class: 'chx-phead-text' }, el('h3', { text: title }), sub ? el('p', { text: sub }) : null),
            action || null);
    }

    function loading() { return el('div', { class: 'ch-feed-loading' }, el('div', { class: 'ch-spinner', 'aria-hidden': 'true' })); }
    function empty(title, text) { return el('div', { class: 'chx-pempty' }, el('h4', { text: title }), el('p', { text: text })); }
    function errorBox(err) { return el('div', { class: 'chx-pempty' }, el('h4', { text: 'Could not load this' }), el('p', { text: A().fe(err) })); }

    /* ======================================================================
       FORUM  (discussion)
       ====================================================================== */
    // text -> nodes with the searched words wrapped in <mark> (built with DOM nodes, never HTML)
    function highlight(text, q) {
        var s = String(text == null ? '' : text);
        if (!q) return [document.createTextNode(s)];
        var out = [], low = s.toLowerCase(), needle = q.toLowerCase(), from = 0, i;
        while ((i = low.indexOf(needle, from)) >= 0) {
            if (i > from) out.push(document.createTextNode(s.slice(from, i)));
            var mk = document.createElement('mark');
            mk.textContent = s.slice(i, i + needle.length);
            out.push(mk);
            from = i + needle.length;
        }
        if (from < s.length) out.push(document.createTextNode(s.slice(from)));
        return out;
    }

    var SCOPES = [
        { key: 'all',     label: 'All posts' },
        { key: 'mine',    label: 'My posts',   help: 'Posts you started' },
        { key: 'replied', label: 'Replied to', help: 'Posts by others where you replied' }
    ];

    SP.panels.discussion = {
        mount: function (body, c) {
            var state = { threads: [], cursor: null, more: false, dead: false, timer: null, seq: 0, query: '', scope: 'all', legacy: false };
            var list = el('div', { class: 'chx-threads', role: 'list' });
            var moreBtn = el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', hidden: true, onclick: function () { load(false); } }, 'Load more');
            var newBtn = el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: newPost }, svg('plus'), el('span', { text: 'New post' }));

            // ----- search + filters (built once, so typing never loses focus when the list refreshes)
            var input = el('input', { type: 'search', class: 'ch-field chx-search-input', placeholder: 'Search posts and replies', maxlength: 60, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search posts' });
            var chips = el('div', { class: 'chx-chips', role: 'radiogroup', 'aria-label': 'Filter posts' });
            var status = el('p', { class: 'chx-search-status', role: 'status', 'aria-live': 'polite' });
            var tools = el('div', { class: 'chx-ptools' }, el('div', { class: 'chx-search' }, svg('search'), input), chips, status);

            SCOPES.forEach(function (s) {
                var b = el('button', { type: 'button', role: 'radio', class: 'chx-chip' + (s.key === state.scope ? ' is-on' : ''), 'aria-checked': String(s.key === state.scope), title: s.help || null, dataset: { scope: s.key },
                    onclick: function () { setScope(s.key); } }, s.label);
                chips.appendChild(b);
            });

            function setScope(k) {
                if (state.scope === k) return;
                state.scope = k;
                chips.querySelectorAll('.chx-chip').forEach(function (b) {
                    var on = b.dataset.scope === k;
                    b.classList.toggle('is-on', on);
                    b.setAttribute('aria-checked', String(on));
                });
                load(true);
            }

            input.addEventListener('input', function () {
                clearTimeout(state.timer);
                state.timer = setTimeout(function () {
                    var q = input.value.trim();
                    if (q.length === 1) q = '';                      // the server needs at least 2 characters
                    if (q === state.query) return;
                    state.query = q;
                    load(true);
                }, 300);
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; clearTimeout(state.timer); state.query = ''; load(true); }
            });

            body.appendChild(head('Posts', c.topic || 'Start a discussion or jump into one.', newBtn));
            body.appendChild(tools);
            body.appendChild(list);
            body.appendChild(el('div', { class: 'chx-pfoot' }, moreBtn));

            function filtered() { return !!state.query || state.scope !== 'all'; }

            function card(t) {
                var q = state.query;
                var who = t.author_display || t.author_username || 'someone';
                var meta = who + ' · ' + t.post_count + (t.post_count === 1 ? ' reply' : ' replies') + ' · ' + ago(t.last_post_at);
                var showPin = t.pinned && !filtered();
                var text = t.snippet || t.excerpt;
                return el('button', {
                    type: 'button', role: 'listitem', class: 'chx-thread' + (showPin ? ' is-pinned' : ''),
                    onclick: function () { SP.openThread(t.id, t); }
                },
                    el('span', { class: 'chx-thread-title' },
                        t.pinned ? svg('pin', 'chx-badge') : null,
                        t.locked ? svg('lock', 'chx-badge') : null,
                        el('span', {}, highlight(t.title, q))),
                    text ? el('span', { class: 'chx-thread-excerpt' }, t.snippet ? el('b', { class: 'chx-reply-tag', text: 'In a reply: ' }) : null, highlight(text, q)) : null,
                    el('span', { class: 'chx-thread-meta', text: meta }));
            }

            function paint() {
                list.textContent = '';
                if (!state.threads.length) {
                    if (state.query) list.appendChild(empty('No posts match', 'Nothing in this channel matches \u201C' + state.query + '\u201D. Try fewer or different words.'));
                    else if (state.scope === 'mine') list.appendChild(empty('You have not started any posts', 'Posts you start in this channel show up here.'));
                    else if (state.scope === 'replied') list.appendChild(empty('No replies yet', 'Posts by others where you replied show up here.'));
                    else list.appendChild(empty('No posts yet', 'Be the first to start a discussion.'));
                } else {
                    state.threads.forEach(function (t) { list.appendChild(card(t)); });
                }
                moreBtn.hidden = !state.more;
                status.textContent = state.query && state.threads.length ? state.threads.length + (state.more ? '+' : '') + ' result' + (state.threads.length === 1 && !state.more ? '' : 's') : '';
            }

            async function fetchPage(before) {
                var args = { p_channel: c.id, p_before: before, p_limit: 40 };
                if (!state.legacy) { args.p_query = state.query || null; args.p_scope = state.scope; }
                var res = await rpc('chat_threads_list', args);
                // the v3 SQL has not been run yet: fall back to the plain list and hide the search
                if (res.error && !state.legacy && /PGRST202|could not find the function/i.test(String(res.error.code || '') + ' ' + String(res.error.message || ''))) {
                    state.legacy = true; state.query = ''; state.scope = 'all'; tools.hidden = true;
                    res = await rpc('chat_threads_list', { p_channel: c.id, p_before: before, p_limit: 40 });
                }
                return fail(res);
            }

            // Every call gets a number. If a newer call starts, the older answer is thrown away,
            // so fast typing can never show results for words that are already gone.
            // silent = keep what is on screen while the new list loads (live updates)
            async function load(reset, silent) {
                if (state.dead) return;
                var my = ++state.seq;
                if (reset && !silent) { list.textContent = ''; list.appendChild(loading()); }
                try {
                    var res = await fetchPage(reset ? null : state.cursor);
                    if (state.dead || my !== state.seq) return;
                    var rows = res.data || [];
                    state.threads = reset ? rows : state.threads.concat(rows);
                    // pinned-first lists page past the pinned ones; filtered lists are plain newest-first
                    var base = filtered() ? state.threads : state.threads.filter(function (t) { return !t.pinned; });
                    state.cursor = base.length ? base[base.length - 1].last_post_at : null;
                    state.more = rows.length >= 40 && !!state.cursor;
                    paint();
                } catch (err) {
                    if (!state.dead && my === state.seq && !silent) { list.textContent = ''; list.appendChild(errorBox(err)); }
                }
            }

            function refresh() { load(true, true); }

            function newPost() {
                A().openForm({
                    title: 'New post', submit: 'Post',
                    fields: [
                        { key: 'title', label: 'TITLE', maxlength: 100, placeholder: 'What do you want to talk about?' },
                        { key: 'body', label: 'MESSAGE', type: 'textarea', rows: 6, maxlength: 2000, placeholder: 'Write the first message of the post' }
                    ],
                    onSubmit: async function (v) {
                        if (v.title.trim().length < 3) throw new Error('bad_title');
                        if (!v.body.trim()) throw new Error('empty_message');
                        var res = fail(await rpc('chat_thread_create', { p_channel: c.id, p_title: v.title, p_body: v.body }));
                        A().ping();
                        SP.openThread(res.data);
                    }
                });
            }

            load(true);
            var stopLive = A().live(refresh);       // somebody pinned, locked, deleted or started a post
            return {
                // a message landed in some post while the list is showing: refresh counts and order (debounced)
                onMessage: function () {
                    clearTimeout(state.refreshTimer);
                    state.refreshTimer = setTimeout(refresh, 700);
                },
                teardown: function () { state.dead = true; clearTimeout(state.timer); clearTimeout(state.refreshTimer); stopLive(); }
            };
        }
    };

    /* ======================================================================
       ROADMAP
       ====================================================================== */
    var COLS = [
        { key: 'considering', label: 'Considering' },
        { key: 'planned',     label: 'Planned' },
        { key: 'in_progress', label: 'In progress' },
        { key: 'shipped',     label: 'Shipped' }
    ];

    SP.panels.roadmap = {
        mount: function (body, c) {
            var state = { items: [], dead: false };
            var board = el('div', { class: 'chx-board' });
            var manage = A().canManage('manage_events');
            var addBtn = manage ? el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: function () { editItem(null); } }, svg('plus'), el('span', { text: 'Add item' })) : null;
            body.appendChild(head('Roadmap', c.topic || (manage ? 'Add what you are working on. Members can vote.' : 'Vote for what you want next.'), addBtn));
            body.appendChild(board);

            function statusIndex(s) { for (var i = 0; i < COLS.length; i++) if (COLS[i].key === s) return i; return 0; }

            function card(it) {
                var idx = statusIndex(it.status);
                var vote = el('button', {
                    type: 'button', class: 'chx-vote' + (it.voted ? ' is-on' : ''), 'aria-pressed': String(!!it.voted),
                    'aria-label': (it.voted ? 'Remove your vote for ' : 'Vote for ') + it.title, title: it.voted ? 'Remove your vote' : 'Vote',
                    onclick: function () { toggleVote(it); }
                }, svg('up'), el('b', { text: String(it.votes || 0) }));
                var foot = el('div', { class: 'chx-rm-foot' }, vote,
                    it.target ? el('span', { class: 'chx-pill', text: it.target }) : null);
                if (manage) {
                    var tools = el('span', { class: 'chx-rm-tools' });
                    if (idx > 0) tools.appendChild(el('button', { type: 'button', class: 'chx-mini', 'aria-label': 'Move to ' + COLS[idx - 1].label, title: 'Move to ' + COLS[idx - 1].label, onclick: function () { move(it, COLS[idx - 1].key); } }, svg('back')));
                    if (idx < COLS.length - 1) tools.appendChild(el('button', { type: 'button', class: 'chx-mini', 'aria-label': 'Move to ' + COLS[idx + 1].label, title: 'Move to ' + COLS[idx + 1].label, onclick: function () { move(it, COLS[idx + 1].key); } }, svg('right')));
                    tools.appendChild(el('button', { type: 'button', class: 'chx-mini', 'aria-label': 'Edit ' + it.title, title: 'Edit', onclick: function () { editItem(it); } }, svg('gear')));
                    foot.appendChild(tools);
                }
                return el('article', { class: 'chx-rm-card' },
                    el('h4', { text: it.title }),
                    it.description ? el('p', { text: it.description }) : null,
                    foot);
            }

            function paint() {
                board.textContent = '';
                COLS.forEach(function (col) {
                    var items = state.items.filter(function (i) { return i.status === col.key; });
                    var colEl = el('section', { class: 'chx-col', 'aria-label': col.label },
                        el('h4', { class: 'chx-col-head' }, el('span', { text: col.label }), el('span', { class: 'chx-col-n', text: String(items.length) })));
                    if (items.length) items.forEach(function (i) { colEl.appendChild(card(i)); });
                    else colEl.appendChild(el('p', { class: 'chx-empty', text: 'Nothing here yet.' }));
                    board.appendChild(colEl);
                });
            }

            async function load(silent) {
                if (!silent) { board.textContent = ''; board.appendChild(loading()); }
                try {
                    var res = fail(await rpc('chat_roadmap_list', { p_channel: c.id }));
                    if (state.dead) return;
                    state.items = res.data || [];
                    paint();
                } catch (err) { if (!state.dead && !silent) { board.textContent = ''; board.appendChild(errorBox(err)); } }
            }

            async function toggleVote(it) {
                var next = !it.voted;
                it.voted = next; it.votes = Math.max(0, (it.votes || 0) + (next ? 1 : -1));
                paint();
                try { fail(await rpc('chat_roadmap_vote', { p_item: it.id, p_vote: next })); A().ping(); }
                catch (err) { it.voted = !next; it.votes = Math.max(0, (it.votes || 0) + (next ? -1 : 1)); paint(); H().toast(A().fe(err)); }
            }

            async function move(it, status) {
                var before = it.status;
                it.status = status;
                paint();
                try { fail(await rpc('chat_roadmap_move', { p_item: it.id, p_status: status })); A().ping(); }
                catch (err) { it.status = before; paint(); H().toast(A().fe(err)); }
            }

            function editItem(it) {
                A().openForm({
                    title: it ? 'Edit roadmap item' : 'Add roadmap item', submit: it ? 'Save changes' : 'Add',
                    fields: [
                        { key: 'title', label: 'TITLE', maxlength: 80, value: it ? it.title : '', placeholder: 'Dark mode for the website' },
                        { key: 'description', label: 'DETAILS (OPTIONAL)', type: 'textarea', rows: 3, maxlength: 500, value: it && it.description ? it.description : '' },
                        { key: 'status', label: 'STATUS', type: 'select', value: it ? it.status : 'planned', options: COLS.map(function (x) { return [x.key, x.label]; }) },
                        { key: 'target', label: 'TARGET (OPTIONAL)', maxlength: 24, value: it && it.target ? it.target : '', placeholder: 'Q3, v2.0, March' }
                    ],
                    danger: it ? { label: 'Delete', confirm: 'Delete "' + it.title + '" from the roadmap?', onClick: async function () { fail(await rpc('chat_roadmap_delete', { p_item: it.id })); await load(true); A().ping(); } } : null,
                    onSubmit: async function (v) {
                        if (!v.title.trim()) throw new Error('bad_title');
                        fail(await rpc('chat_roadmap_save', { p_channel: c.id, p_id: it ? it.id : null, p_title: v.title, p_desc: v.description, p_status: v.status, p_target: v.target }));
                        await load(true);
                        A().ping();
                    }
                });
            }

            load();
            var stopLive = A().live(function () { load(true); });
            return { teardown: function () { state.dead = true; stopLive(); } };
        }
    };

    /* ======================================================================
       EVENTS
       ====================================================================== */
    function fmtWhen(ev) {
        var s = new Date(ev.starts_at);
        var opts = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
        var out = s.toLocaleString(undefined, opts);
        if (ev.ends_at) {
            var e = new Date(ev.ends_at);
            out += ' to ' + (e.toDateString() === s.toDateString()
                ? e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                : e.toLocaleString(undefined, opts));
        }
        return out;
    }

    // ISO string -> value for <input type="datetime-local"> (in the person's own time zone)
    function toLocalInput(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    SP.panels.event = {
        mount: function (body, c) {
            var state = { upcoming: [], past: null, dead: false };
            var manage = A().canManage('manage_events');
            var list = el('div', { class: 'chx-events' });
            var pastBox = el('div', { class: 'chx-events chx-events--past' });
            var pastBtn = el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', onclick: togglePast }, 'Show past events');
            var addBtn = manage ? el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: function () { editEvent(null); } }, svg('plus'), el('span', { text: 'New event' })) : null;
            body.appendChild(head('Events', c.topic || 'Upcoming events. Let people know if you are coming.', addBtn));
            body.appendChild(list);
            body.appendChild(el('div', { class: 'chx-pfoot' }, pastBtn));
            body.appendChild(pastBox);

            function card(ev, past) {
                var d = new Date(ev.starts_at);
                var people = [];
                if (ev.going) people.push(ev.going + ' going');
                if (ev.maybe) people.push(ev.maybe + ' maybe');
                var names = (ev.going_names || []).join(', ');
                var rsvp = null;
                if (!past) {
                    rsvp = el('div', { class: 'chx-rsvp', role: 'group', 'aria-label': 'Your answer' });
                    [['going', 'Going'], ['maybe', 'Maybe'], ['no', 'Can\u2019t go']].forEach(function (o) {
                        rsvp.appendChild(el('button', {
                            type: 'button', class: ev.mine === o[0] ? 'is-on' : '', 'aria-pressed': String(ev.mine === o[0]),
                            onclick: function () { answer(ev, ev.mine === o[0] ? null : o[0]); }
                        }, o[1]));
                    });
                }
                var tools = manage ? el('button', { type: 'button', class: 'chx-mini', 'aria-label': 'Edit ' + ev.title, title: 'Edit event', onclick: function () { editEvent(ev); } }, svg('gear')) : null;
                return el('article', { class: 'chx-event' + (past ? ' is-past' : '') },
                    el('div', { class: 'chx-date', 'aria-hidden': 'true' },
                        el('span', { class: 'chx-date-m', text: d.toLocaleString(undefined, { month: 'short' }) }),
                        el('span', { class: 'chx-date-d', text: String(d.getDate()) })),
                    el('div', { class: 'chx-event-main' },
                        el('h4', {}, el('span', { text: ev.title }), tools),
                        el('p', { class: 'chx-event-when', text: fmtWhen(ev) }),
                        ev.location ? el('p', { class: 'chx-event-where', text: ev.location }) : null,
                        ev.description ? el('p', { class: 'chx-event-desc', text: ev.description }) : null,
                        people.length ? el('p', { class: 'chx-event-people', text: people.join(' · ') + (names ? ' (' + names + (ev.going > 4 ? ' and more' : '') + ')' : '') }) : null,
                        rsvp));
            }

            function paint() {
                list.textContent = '';
                if (!state.upcoming.length) list.appendChild(empty('No upcoming events', manage ? 'Create the first one with New event.' : 'Nothing is scheduled right now.'));
                else state.upcoming.forEach(function (e) { list.appendChild(card(e, false)); });
            }

            function paintPast() {
                pastBox.textContent = '';
                if (state.past === null) return;
                if (!state.past.length) pastBox.appendChild(empty('No past events', 'Events that finished show up here.'));
                else state.past.forEach(function (e) { pastBox.appendChild(card(e, true)); });
            }

            async function load(silent) {
                if (!silent) { list.textContent = ''; list.appendChild(loading()); }
                try {
                    var res = fail(await rpc('chat_events_list', { p_channel: c.id, p_past: false }));
                    if (state.dead) return;
                    state.upcoming = res.data || [];
                    paint();
                } catch (err) { if (!state.dead && !silent) { list.textContent = ''; list.appendChild(errorBox(err)); } }
            }

            // live update: the upcoming list, and the past list too if it is open
            async function refreshAll() {
                await load(true);
                if (state.past === null || state.dead) return;
                try {
                    var res = fail(await rpc('chat_events_list', { p_channel: c.id, p_past: true }));
                    if (!state.dead && state.past !== null) { state.past = res.data || []; paintPast(); }
                } catch (err) { /* keep what is shown */ }
            }

            async function togglePast() {
                if (state.past !== null) {                       // hide again
                    state.past = null; pastBox.textContent = ''; pastBtn.textContent = 'Show past events';
                    return;
                }
                pastBtn.disabled = true;
                try {
                    var res = fail(await rpc('chat_events_list', { p_channel: c.id, p_past: true }));
                    if (state.dead) return;
                    state.past = res.data || [];
                    pastBtn.textContent = 'Hide past events';
                    paintPast();
                } catch (err) { H().toast(A().fe(err)); }
                finally { pastBtn.disabled = false; }
            }

            async function answer(ev, status) {
                var before = { mine: ev.mine, going: ev.going, maybe: ev.maybe };
                if (ev.mine === 'going') ev.going = Math.max(0, ev.going - 1);
                if (ev.mine === 'maybe') ev.maybe = Math.max(0, ev.maybe - 1);
                if (status === 'going') ev.going++;
                if (status === 'maybe') ev.maybe++;
                ev.mine = status;
                paint();
                try { fail(await rpc('chat_event_rsvp', { p_event: ev.id, p_status: status })); A().ping(); }
                catch (err) { ev.mine = before.mine; ev.going = before.going; ev.maybe = before.maybe; paint(); H().toast(A().fe(err)); }
            }

            function editEvent(ev) {
                A().openForm({
                    title: ev ? 'Edit event' : 'New event', submit: ev ? 'Save changes' : 'Create',
                    fields: [
                        { key: 'title', label: 'TITLE', maxlength: 100, value: ev ? ev.title : '', placeholder: 'Community game night' },
                        { key: 'starts', label: 'STARTS', type: 'datetime', value: ev ? toLocalInput(ev.starts_at) : '' },
                        { key: 'ends', label: 'ENDS (OPTIONAL)', type: 'datetime', value: ev ? toLocalInput(ev.ends_at) : '' },
                        { key: 'location', label: 'WHERE (OPTIONAL)', maxlength: 120, value: ev && ev.location ? ev.location : '', placeholder: 'A voice channel, a link, an address' },
                        { key: 'description', label: 'DETAILS (OPTIONAL)', type: 'textarea', rows: 3, maxlength: 1000, value: ev && ev.description ? ev.description : '' }
                    ],
                    danger: ev ? { label: 'Delete', confirm: 'Delete "' + ev.title + '"? RSVPs are deleted too.', onClick: async function () { fail(await rpc('chat_event_delete', { p_event: ev.id })); await load(true); A().ping(); } } : null,
                    onSubmit: async function (v) {
                        if (!v.title.trim()) throw new Error('bad_title');
                        var starts = v.starts ? new Date(v.starts) : null;
                        var ends = v.ends ? new Date(v.ends) : null;
                        if (!starts || isNaN(starts.getTime()) || (ends && (isNaN(ends.getTime()) || ends <= starts))) throw new Error('bad_date');
                        fail(await rpc('chat_event_save', {
                            p_channel: c.id, p_id: ev ? ev.id : null, p_title: v.title, p_desc: v.description, p_location: v.location,
                            p_starts: starts.toISOString(), p_ends: ends ? ends.toISOString() : null
                        }));
                        await load(true);
                        if (state.past !== null) { state.past = null; pastBtn.textContent = 'Show past events'; pastBox.textContent = ''; }
                        A().ping();
                    }
                });
            }

            load();
            var stopLive = A().live(refreshAll);
            return { teardown: function () { state.dead = true; stopLive(); } };
        }
    };
})();
