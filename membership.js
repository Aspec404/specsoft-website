/* ==========================================================================
   SPECSOFT® — Membership (membership.js)
   Needs: supabase-config.js, supabase-membership.sql (run once), store.css,
          membership.css. Load AFTER store.js on store.html.
   Adds a "Membership" section above "Get more APEX Credits", and shows the
   Youth Safety Commitment once to signed-in users who have not accepted it.
   ========================================================================== */
(function () {
    'use strict';

    var CFG = window.SPECSOFT_CONFIG || {};
    var sb = window.getSupabaseClient ? window.getSupabaseClient()
        : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
    if (!sb) return;

    var M = { user: null, plans: {}, cur: 'USD', member: null, admin: false, rewards: null, frames: [], frameItem: null };
    var DEFAULT_PLANS = { PHP: { price_label: '₱149', checkout_url: null }, USD: { price_label: '$8', checkout_url: null } };
    var CUR_KEY = 'specsoft.membership.currency';

    var FREE = [
        'All core features',
        'All settings unlocked',
        'Daily check-in, quests and APEX Credits',
        'Spectra AI with the standard allowance'
    ];
    var SUPERIOR = [
        ['Appearance', [
            'Gold interface accents',
            'Golden chat bubbles with a crown',
            'SUPERIOR profile title',
            'Golden profile frame',
            'Advanced profile customization',
            'Exclusive Superior badges and cosmetics'
        ]],
        ['Spectra AI', [
            'Higher Spectra AI and Lumen 4 usage',
            'Longer, more advanced Spectra Code sessions',
            'Early access to selected Spectra AI models',
            'Early access to experimental AI features'
        ]],
        ['APEX Credits', [
            '2,000 AC every month',
            '600 AC every week',
            'Exclusive Superior cosmetics'
        ]],
        ['SPECSOFT privileges', [
            'Early access to selected website features',
            'Exclusive Superior events',
            'Experimental feature previews',
            'Additional customization options',
            'Everything in Free'
        ]]
    ];
    var YOUTH = [
        'Maintaining accessible core features.',
        'Promoting responsible AI usage.',
        'Protecting users\u2019 personal information.',
        'Providing reporting and moderation mechanisms.',
        'Maintaining appropriate safeguards for younger users.',
        'Making subscriptions optional and transparent.'
    ];

    /* ---------- helpers ---------- */
    function el(tag, props) {
        var n = document.createElement(tag);
        if (props) Object.keys(props).forEach(function (k) {
            var v = props[k];
            if (v == null || v === false) return;
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v === true ? '' : v);
        });
        for (var i = 2; i < arguments.length; i++) {
            [].concat(arguments[i]).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        }
        return n;
    }
    function safeUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : null; }
    function toast(msg, bad) {
        var t = document.getElementById('stToast');
        if (!t) return;
        t.textContent = msg; t.classList.toggle('is-bad', !!bad); t.classList.add('is-on');
        clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 4200);
    }
    function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; } }
    function list(items) { return el('ul', { class: 'ms-list' }, items.map(function (t) { return el('li', { text: t }); })); }

    function guessCurrency() {
        try {
            var saved = localStorage.getItem(CUR_KEY);
            if (saved === 'PHP' || saved === 'USD') return saved;
        } catch (e) { /* storage blocked */ }
        try {
            var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
            var lang = (navigator.language || '').toLowerCase();
            if (tz === 'Asia/Manila' || /-ph$/.test(lang) || lang === 'fil' || lang === 'tl') return 'PHP';
        } catch (e) { /* fall through */ }
        return 'USD';
    }

    /* ---------- data ---------- */
    async function load() {
        var s = await sb.auth.getSession();
        M.user = s && s.data && s.data.session ? s.data.session.user : null;
        M.plans = JSON.parse(JSON.stringify(DEFAULT_PLANS));
        var p = await sb.from('membership_plans').select('currency,price_label,checkout_url').eq('active', true);
        if (!p.error && p.data) p.data.forEach(function (r) { M.plans[r.currency] = r; });
        M.cur = guessCurrency();
        if (!M.user) return;
        var r = await Promise.all([sb.rpc('my_membership'), sb.rpc('store_is_admin')]);
        if (!r[0].error && r[0].data && r[0].data.active) M.member = r[0].data;
        M.admin = !!(r[1] && r[1].data === true);
        if (M.member) {
            var rw = await sb.rpc('superior_rewards');
            if (!rw.error && rw.data && rw.data.active) M.rewards = rw.data;
        }
        if (M.admin) {
            var f = await Promise.all([
                sb.from('store_items').select('id,name,active').eq('category', 'frame').order('created_at', { ascending: false }),
                sb.from('membership_settings').select('frame_item').eq('id', 1).maybeSingle()
            ]);
            M.frames = f[0].error ? [] : (f[0].data || []);
            M.frameItem = (!f[1].error && f[1].data && f[1].data.frame_item) || null;
        }
    }

    /* ---------- section ---------- */
    var CROWN = '<svg class="ms-crown" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2.6 13h12.8v1.5H5.6V20z"/></svg>';

    function sparks() {
        var spots = [[12, 14], [78, 9], [90, 38], [8, 52], [70, 72], [28, 90], [92, 88]];
        return spots.map(function (p, i) {
            var s = el('i', { class: 'ms-spark', 'aria-hidden': 'true' });
            s.style.left = p[0] + '%'; s.style.top = p[1] + '%';
            s.style.setProperty('--d', (3.4 + (i % 3) * 0.9) + 's');
            s.style.setProperty('--delay', (i * 0.7) + 's');
            return s;
        });
    }

    function paint() {
        var host = document.getElementById('membership');
        if (!host) return;
        host.querySelectorAll('.ms-body').forEach(function (n) { n.remove(); });
        var plan = M.plans[M.cur] || DEFAULT_PLANS[M.cur];
        var other = M.cur === 'PHP' ? 'USD' : 'PHP';
        var url = safeUrl(plan.checkout_url);

        var free = el('article', { class: 'ms-card ms-free' },
            el('h3', { text: 'Free' }),
            el('p', { class: 'ms-tag', text: 'Everything you need to chat, build and earn. Free stays free.' }),
            el('div', { class: 'ms-price' }, el('strong', { text: M.cur === 'PHP' ? '\u20B10' : '$0' }), el('span', { text: 'forever' })),
            list(FREE),
            el('div', { class: 'ms-foot' }, el('span', { class: 'ms-current', text: M.member ? 'Included with Superior' : 'Your current plan' })));

        var cta = el('button', { type: 'button', class: 'ms-cta', text: M.member ? 'Extend Superior' : 'Get Superior' });
        if (!url) { cta.disabled = true; cta.textContent = 'Coming soon'; }
        else cta.addEventListener('click', function () {
            if (!M.user) { toast('Sign in first so we can add Superior to your account.', true); return; }
            window.open(url, '_blank', 'noopener');
            toast('After you pay, send your receipt to staff and Superior is added to your account.');
        });

        var curBtn = el('button', { type: 'button', class: 'ms-cur', text: 'Show price in ' + (other === 'PHP' ? '\u20B1 PHP' : '$ USD'), onclick: function () {
            M.cur = other;
            try { localStorage.setItem(CUR_KEY, M.cur); } catch (e) { /* ignore */ }
            paint();
        } });

        var gold = el('article', { class: 'ms-card ms-gold' },
            sparks(),
            el('h3', null, el('span', { class: 'ms-crown-wrap' }), 'Superior', el('span', { class: 'ms-badge', text: 'Premium' })),
            el('p', { class: 'ms-tag', text: 'More style, more Spectra and a monthly APEX Credits bonus.' }),
            el('div', { class: 'ms-price' }, el('strong', { text: plan.price_label }), el('span', { text: 'per month' }), curBtn),
            M.member ? el('div', { class: 'ms-active', text: 'Active until ' + fmtDate(M.member.expires_at) }) : null,
            SUPERIOR.map(function (g) { return el('div', { class: 'ms-group' }, el('h4', { text: g[0] }), list(g[1])); }),
            el('div', { class: 'ms-foot' }, cta,
                el('p', { class: 'ms-small', text: 'Optional. Superior lasts 30 days from activation and does not renew on its own. Renew early and the days stack. If you are under 18, ask a parent or guardian before you pay.' })));
        gold.querySelector('.ms-crown-wrap').outerHTML = CROWN;

        var youth = el('details', { class: 'ms-youth' },
            el('summary', { text: 'SPECSOFT\u00AE Youth Safety Commitment' }),
            el('div', { class: 'ms-youth-body' },
                el('p', { text: 'SPECSOFT aims to provide a welcoming and accessible environment for users of different ages and experience levels.' }),
                el('p', { text: 'We recognize that younger individuals may use our platform to explore programming, technology, artificial intelligence, and creativity.' }),
                el('p', null, el('strong', { text: 'Our commitments include:' })),
                el('ul', null, YOUTH.map(function (t) { return el('li', { text: t }); })),
                el('p', { text: 'We believe technology and learning opportunities should be accessible regardless of someone\u2019s financial circumstances.' })));

        host.appendChild(el('div', { class: 'ms-body' }, el('div', { class: 'ms-grid' }, free, gold), M.rewards ? rewardsBox() : null, youth, M.admin ? adminBox() : null));
    }

    function timeLeft(iso) {
        var ms = new Date(iso).getTime() - Date.now();
        if (!(ms > 0)) return 'now';
        var m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
        return d ? d + 'd ' + h + 'h' : (h ? h + 'h ' + (m % 60) + 'm' : (m % 60) + 'm');
    }
    var REWARD_ERR = { not_ready: 'That bonus is not ready yet.', not_superior: 'Superior is not active on your account.', not_signed_in: 'Sign in to do that.' };

    function rewardRow(kind, label, d) {
        var btn = el('button', { type: 'button', class: 'ms-claim', text: d.available ? 'Claim ' + d.amount.toLocaleString('en-US') + ' AC' : 'Ready in ' + timeLeft(d.next_at) });
        btn.disabled = !d.available;
        btn.addEventListener('click', async function () {
            btn.disabled = true;
            var r = await sb.rpc('superior_claim', { p_kind: kind });
            if (r.error) {
                var key = Object.keys(REWARD_ERR).filter(function (k) { return r.error.message.indexOf(k) >= 0; })[0];
                toast(REWARD_ERR[key] || 'Could not claim that. Try again in a moment.', true);
            } else {
                toast('+' + Number(r.data.amount).toLocaleString('en-US') + ' APEX Credits added.');
                window.dispatchEvent(new CustomEvent('apex:balance', { detail: { balance: Number(r.data.balance) || 0 } }));
            }
            var rw = await sb.rpc('superior_rewards');
            if (!rw.error && rw.data && rw.data.active) M.rewards = rw.data;
            paint();
        });
        return el('div', { class: 'ms-reward' },
            el('div', null, el('strong', { text: label }), el('span', { text: d.amount.toLocaleString('en-US') + ' APEX Credits' })), btn);
    }
    function rewardsBox() {
        return el('div', { class: 'ms-rewards' },
            el('h4', { text: 'Your Superior rewards' }),
            rewardRow('weekly', 'Weekly bonus', M.rewards.weekly),
            rewardRow('monthly', 'Monthly bonus', M.rewards.monthly),
            el('p', { class: 'ms-small', text: 'Each bonus can be claimed again 7 or 30 days after you last claimed it, as long as Superior is active.' }));
    }

    function framePicker() {
        var sel = el('select', { class: 'st-field', 'aria-label': 'Superior frame' },
            el('option', { value: '', text: 'Built-in gold frame' }),
            M.frames.map(function (f) { return el('option', { value: f.id, text: f.name + (f.active ? ' (on sale)' : '') }); }));
        sel.value = M.frameItem || '';
        async function save(id) {
            var r = await sb.from('membership_settings').update({ frame_item: id || null }).eq('id', 1);
            if (r.error) { toast('Could not save: ' + r.error.message, true); return; }
            M.frameItem = id || null;
            toast(id ? 'Superior frame set. Members see it after a refresh.' : 'Superior frame reset to the built-in gold one.');
        }
        return el('div', { class: 'ms-admin-row ms-admin-frame' }, sel,
            el('button', { type: 'button', class: 'st-btn st-btn--primary', text: 'Use as Superior frame', onclick: function () { save(sel.value); } }));
    }

    function adminBox() {
        var who = el('input', { type: 'text', class: 'st-field', placeholder: 'username', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Username' });
        var days = el('input', { type: 'number', class: 'st-field', value: '30', min: '1', max: '400', 'aria-label': 'Days' });
        function run(rpc, args, okMsg) {
            return async function () {
                var u = who.value.trim().replace(/^@/, '');
                if (!u) { who.focus(); return; }
                var r = await sb.rpc(rpc, Object.assign({ p_username: u }, args()));
                if (r.error) { toast(/user_not_found/.test(r.error.message) ? 'No member with that username.' : 'That did not work: ' + r.error.message, true); return; }
                toast(okMsg(u, r.data));
            };
        }
        return el('div', { class: 'ms-admin' },
            el('h4', { text: 'Staff: activate Superior after a payment' }),
            el('div', { class: 'ms-admin-row' }, who, days,
                el('button', { type: 'button', class: 'st-btn st-btn--primary', text: 'Grant days', onclick: run('store_admin_grant_superior', function () { return { p_days: Math.floor(Number(days.value)) || 30 }; }, function (u, d) { return '@' + u + ' is Superior until ' + fmtDate(d && d.expires_at) + '.'; }) }),
                el('button', { type: 'button', class: 'st-btn', text: 'Revoke', onclick: run('store_admin_revoke_superior', function () { return {}; }, function (u) { return 'Superior removed from @' + u + '.'; }) })),
            el('h4', { class: 'ms-admin-sub', text: 'Staff: custom Superior profile frame' }),
            framePicker(),
            el('p', { class: 'ms-small', text: 'Create an image frame in Store Manager first (category Frame), switch it off so it is not sold, then pick it here.' }));
    }

    /* ---------- Youth Safety acknowledgment (first visit, signed in) ---------- */
    async function ensureYouthAck() {
        var s = await sb.auth.getSession();
        var u = s && s.data && s.data.session ? s.data.session.user : null;
        if (!u || document.getElementById('msYouthDlg')) return;
        var r = await sb.from('youth_safety_acks').select('user_id').eq('user_id', u.id).maybeSingle();
        if (r.error || r.data) return;
        var ok = el('button', { type: 'submit', class: 'st-btn st-btn--primary', text: 'I understand' });
        var dlg = el('dialog', { class: 'st-dlg', id: 'msYouthDlg', 'aria-labelledby': 'msYouthT' },
            el('form', { method: 'dialog', onsubmit: async function () { ok.disabled = true; try { await sb.rpc('youth_safety_ack'); } catch (e) { /* asks again next visit */ } } },
                el('h3', { id: 'msYouthT', text: 'Youth Safety Commitment' }),
                el('p', { class: 'st-dlg-desc', text: 'SPECSOFT is for people of all ages and experience levels, including younger users. Here is what we commit to:' }),
                el('ul', { class: 'st-incl' }, YOUTH.map(function (t) { return el('li', { text: t }); })),
                el('p', { class: 'st-help', text: 'Technology and learning should be accessible regardless of someone\u2019s financial circumstances. Subscriptions are always optional.' }),
                el('div', { class: 'st-dlg-foot' }, ok)));
        document.body.appendChild(dlg);
        dlg.showModal();
    }
    window.SpecsoftYouth = { ensure: ensureYouthAck };   // call this from other pages too

    /* ---------- boot ---------- */
    async function init() {
        var credits = document.getElementById('credits');
        if (credits && !document.getElementById('membership')) {
            var sec = el('section', { class: 'st-section ms-wrap', id: 'membership', 'aria-labelledby': 'msTitle' },
                el('header', { class: 'st-sechead' }, el('div', null,
                    el('h2', { id: 'msTitle', text: 'Membership' }),
                    el('p', { class: 'st-sub', text: 'Two plans. Core features stay free for everyone.' }))));
            credits.parentNode.insertBefore(sec, credits);
            var nav = document.querySelector('.st-links a[href="#credits"]');
            if (nav) nav.parentNode.insertBefore(el('a', { href: '#membership', text: 'Membership' }), nav);
        }
        try { await load(); } catch (e) { M.plans = JSON.parse(JSON.stringify(DEFAULT_PLANS)); M.cur = guessCurrency(); }
        paint();
        ensureYouthAck();
    }
    init();
})();
