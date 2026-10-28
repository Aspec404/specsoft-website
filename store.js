/* ==========================================================================
   SPECSOFT® — Store (store.js)
   Needs: supabase-config.js, supabase-store.sql (run once), apex-credits.js
   ========================================================================== */
(function () {
    'use strict';

    var CFG = window.SPECSOFT_CONFIG || {};
    var sb = window.getSupabaseClient ? window.getSupabaseClient()
        : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);

    var $ = function (id) { return document.getElementById(id); };
    var S = {
        user: null, wallet: null, items: [], featured: [], settings: null, packs: [], owned: [],
        cat: 'all', q: '', buying: null, busy: false,
        tx: [], txMore: false, txBefore: null, txFilter: 'all', txBusy: false, txReady: false, pendingSend: null, receipt: null
    };

    var CATS = [['all', 'All'], ['emote', 'Emotes'], ['badge', 'Badges'], ['theme', 'Themes'], ['boost', 'Boosts'], ['cosmetic', 'Cosmetics'], ['misc', 'Misc']];
    var RARITY = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
    var ERR = {
        not_signed_in: 'Sign in to do that.',
        not_enough_credits: 'You do not have enough APEX Credits for that.',
        sold_out: 'That item just sold out.',
        limit_reached: 'You already own the most of this item you can have.',
        item_unavailable: 'That item is not available anymore.',
        already_claimed: 'You already claimed today. Come back after the reset.',
        bad_code: 'That code is not valid or has expired.',
        code_used_up: 'That code has no uses left.',
        code_already_used: 'You already redeemed that code.',
        transfers_off: 'Sending credits is paused right now.',
        bad_amount: 'Enter a whole number of credits, at least 1.',
        self_transfer: 'You cannot send credits to yourself.',
        user_not_found: 'No member with that username.',
        cap_reached: 'That would go over your 24 hour sending limit.',
        account_too_new: 'Your account is too new to send credits yet.',
        receipt_not_found: 'No receipt with that number.'
    };

    /* ---------- tiny helpers ---------- */
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
    function fmt(n) { return (Number(n) || 0).toLocaleString('en-US'); }
    function safeUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : null; }
    function apexIcon(cls) { return el('img', { class: 'apex-ico' + (cls ? ' ' + cls : ''), src: 'apex-credits.png', alt: '', width: '16', height: '16' }); }

    var toastTimer;
    function toast(msg, bad) {
        var t = $('stToast');
        t.textContent = msg;
        t.classList.toggle('is-bad', !!bad);
        t.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 3200);
    }
    function friendly(err) {
        var m = String((err && (err.message || err.hint || err.details)) || err || '');
        var keys = Object.keys(ERR);
        for (var i = 0; i < keys.length; i++) if (m.indexOf(keys[i]) >= 0) return ERR[keys[i]];
        if (/relation .* does not exist|function .* does not exist|schema cache/i.test(m)) return 'The store is not set up yet. Run supabase-store.sql in Supabase.';
        return 'Something went wrong. Try again in a moment.';
    }

    function timeLeft(iso) {
        var ms = new Date(iso).getTime() - Date.now();
        if (ms <= 0) return 'now';
        var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
        if (d > 0) return d + 'd ' + h + 'h ' + String(m).padStart(2, '0') + 'm';
        if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
        return m + 'm ' + String(sec).padStart(2, '0') + 's';
    }

    /* ---------- pricing (mirrors store_buy in the SQL) ---------- */
    function featInfo(item) { return S.featured.find(function (f) { return f.item_id === item.id; }) || null; }
    function priceOf(item) {
        var f = featInfo(item);
        if (!f || !f.discount) return item.price;
        return Math.max(0, Math.round(item.price * (100 - f.discount) / 100));
    }
    function ownedCount(item) { return S.owned.filter(function (p) { return p.item_id === item.id; }).length; }
    function isOwnedMax(item) { return item.per_user_limit != null && ownedCount(item) >= item.per_user_limit; }

    /* ---------- data ---------- */
    async function loadPublic() {
        var r = await Promise.all([
            sb.from('store_items').select('*').eq('active', true).order('sort', { ascending: true }).order('created_at', { ascending: true }),
            sb.rpc('store_featured'),
            sb.from('store_settings').select('*').eq('id', 1).maybeSingle(),
            sb.from('credit_packs').select('*').eq('active', true).order('sort', { ascending: true })
        ]);
        if (r[0].error) throw r[0].error;
        S.items = r[0].data || [];
        S.featured = r[1].error ? [] : (r[1].data || []);
        S.settings = r[2].data || { rotation_days: 3, featured_discount: 20, daily_amount: 3, streak_every: 7, streak_bonus: 15 };
        S.packs = r[3].error ? [] : (r[3].data || []);
    }

    async function loadUser() {
        var s = await sb.auth.getSession();
        S.user = s && s.data && s.data.session ? s.data.session.user : null;
        S.wallet = null; S.owned = [];
        if (!S.user) return;
        var r = await Promise.all([
            sb.rpc('apex_wallet'),
            sb.from('store_purchases').select('id,item_id,item_name,price_paid,created_at').eq('user_id', S.user.id).order('created_at', { ascending: false })
        ]);
        if (!r[0].error) S.wallet = r[0].data;
        if (!r[1].error) S.owned = r[1].data || [];
        try { var a = await sb.rpc('store_is_admin'); $('stManage').hidden = !(a && a.data === true); } catch (e) { /* not an admin */ }
    }

    function setBalance(n) {
        if (S.wallet) S.wallet.balance = n;
        window.dispatchEvent(new CustomEvent('apex:balance', { detail: { balance: n } }));
        paintWallet();
        paintAll();
        if (S.txReady) loadTx(true);
    }

    /* ---------- hero: wallet + daily ---------- */
    function nextResetMs() { var n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime(); }

    function paintWallet() {
        var signed = !!S.user;
        $('stGuest').hidden = signed;
        $('stSignin').hidden = signed;
        $('stPill').hidden = !signed;
        $('stBalance').textContent = signed && S.wallet ? fmt(S.wallet.balance) : '0';
        var life = $('stLifetime');
        life.hidden = !(signed && S.wallet && Number(S.wallet.lifetime) > 0);
        if (!life.hidden) life.textContent = fmt(S.wallet.lifetime) + ' earned all time';
        if (signed && S.wallet) {
            var pill = $('stPill').querySelector('[data-apex-balance]');
            if (pill) pill.textContent = fmt(S.wallet.balance);
        }
        paintDaily();
        paintSend();
    }

    function paintDaily() {
        var cfg = S.settings || {}, every = Number(cfg.streak_every) || 0, amt = Number(cfg.daily_amount) || 0, bonus = Number(cfg.streak_bonus) || 0;
        var streak = S.wallet ? Number(S.wallet.streak) || 0 : 0;
        var can = !!(S.wallet && S.wallet.can_claim);
        var cycle = every > 0 ? every : 7;
        var doneInCycle = streak % cycle;
        if (streak > 0 && doneInCycle === 0 && !can) doneInCycle = cycle;           // finished a full cycle today
        var todayIdx = can ? doneInCycle : -1;                                         // the pip you are about to fill

        var pips = $('stPips');
        pips.textContent = '';
        for (var i = 0; i < cycle; i++) {
            var done = i < doneInCycle;
            pips.appendChild(el('li', { class: 'st-pip' + (done ? ' is-done' : '') + (i === todayIdx ? ' is-today' : '') + (every > 0 && i === cycle - 1 ? ' is-bonus' : ''), title: every > 0 && i === cycle - 1 ? 'Day ' + (i + 1) + ': +' + bonus + ' bonus' : 'Day ' + (i + 1) },
                el('span', { text: String(i + 1) }), apexIcon()));
        }

        var btn = $('stClaim'), help = $('stDailyHelp');
        $('stReset').textContent = 'Resets in ' + timeLeft(new Date(Date.now() + nextResetMs()).toISOString());
        if (!S.user) { btn.disabled = true; btn.textContent = 'Sign in to claim'; help.textContent = 'Check in every day for +' + amt + ' credits.' + (every ? ' Day ' + every + ' pays +' + bonus + ' extra.' : ''); return; }
        if (can) {
            var nextDay = (streak > 0 ? streak : 0) + 1;
            var isBonus = every > 0 && nextDay % every === 0;
            btn.disabled = false;
            btn.textContent = 'Claim ' + (amt + (isBonus ? bonus : 0)) + ' credits';
            help.textContent = isBonus ? 'Streak day ' + nextDay + ': bonus day.' : 'Streak day ' + nextDay + '.' + (every ? ' Miss a day and the streak starts over.' : '');
        } else {
            btn.disabled = true;
            btn.textContent = 'Claimed today';
            help.textContent = 'Come back after the reset to keep your ' + streak + '-day streak.';
        }
    }

    async function claimDaily() {
        if (S.busy || !S.user) return;
        S.busy = true; $('stClaim').disabled = true;
        try {
            var r = await sb.rpc('apex_claim_daily');
            if (r.error) throw r.error;
            S.wallet.streak = r.data.streak; S.wallet.can_claim = false;
            S.wallet.lifetime = Number(S.wallet.lifetime || 0) + Number(r.data.amount);
            setBalance(Number(r.data.balance));
            toast('+' + r.data.amount + ' APEX Credits' + (r.data.bonus ? ' (streak bonus!)' : ''));
        } catch (err) { toast(friendly(err), true); await loadUser(); paintWallet(); }
        finally { S.busy = false; paintDaily(); }
    }

    async function redeem(e) {
        e.preventDefault();
        var code = $('stCode').value.trim();
        if (!code) { $('stCode').focus(); return; }
        if (!S.user) { toast('Sign in to redeem a code.', true); return; }
        var btn = $('stRedeemBtn'); btn.disabled = true;
        try {
            var r = await sb.rpc('apex_redeem_code', { p_code: code });
            if (r.error) throw r.error;
            $('stCode').value = '';
            if (S.wallet) S.wallet.lifetime = Number(S.wallet.lifetime || 0) + Number(r.data.amount);
            setBalance(Number(r.data.balance));
            toast('Code redeemed: +' + fmt(r.data.amount) + ' APEX Credits');
        } catch (err) { toast(friendly(err), true); }
        finally { btn.disabled = false; }
    }

    /* ---------- cards ---------- */
    function mediaOf(item, big) {
        var url = safeUrl(item.image_url);
        if (url) {
            var img = el('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
            img.onerror = function () { img.replaceWith(el('span', { class: 'st-emoji', text: item.emoji || '🎁' })); };
            return img;
        }
        return el('span', { class: 'st-emoji', text: item.emoji || '🎁' });
    }

    function buyButton(item, price) {
        var btn = el('button', { type: 'button', class: 'st-btn st-btn--primary' });
        var bal = S.wallet ? Number(S.wallet.balance) : 0;
        if (isOwnedMax(item)) { btn.textContent = 'Owned'; btn.disabled = true; btn.className = 'st-btn'; }
        else if (item.stock != null && item.stock <= 0) { btn.textContent = 'Sold out'; btn.disabled = true; btn.className = 'st-btn'; }
        else if (!S.user) { btn.textContent = 'Sign in'; btn.className = 'st-btn'; btn.addEventListener('click', function () { location.href = 'login.html'; }); }
        else if (bal < price) { btn.textContent = 'Need ' + fmt(price - bal) + ' more'; btn.disabled = true; btn.className = 'st-btn'; }
        else { btn.textContent = 'Buy'; btn.addEventListener('click', function () { openBuy(item); }); }
        return btn;
    }

    function priceView(item) {
        var p = priceOf(item), wrap = el('span', { class: 'st-price' }, apexIcon(), String(fmt(p)));
        if (p !== item.price) wrap.appendChild(el('s', { text: fmt(item.price) }));
        return wrap;
    }

    function buildCard(item, feat) {
        var f = featInfo(item), price = priceOf(item);
        var card = el('article', { class: 'st-card is-' + item.rarity + (item.category === 'emote' ? ' st-card--emote' : '') + (feat ? ' st-card--feat' : '') + (isOwnedMax(item) ? ' is-owned' : '') });
        var media = el('div', { class: 'st-card-media' }, mediaOf(item));
        if (f && f.discount) media.appendChild(el('span', { class: 'st-tag', text: '-' + f.discount + '%' }));
        if (feat && f && f.is_pinned) { var e = el('span', { class: 'st-ends', 'data-ends': f.ends_at, text: timeLeft(f.ends_at) + ' left' }); media.appendChild(e); }
        card.appendChild(media);
        card.appendChild(el('div', { class: 'st-card-body' },
            el('div', { class: 'st-card-top' },
                el('span', { class: 'st-rarity', text: RARITY[item.rarity] || 'Common' }),
                item.stock != null ? el('span', { class: 'st-stock', text: item.stock > 0 ? item.stock + ' left' : 'sold out' }) : null),
            el('h3', { text: item.name }),
            item.category === 'emote' && item.emote_name ? el('div', { class: 'st-emote-code', text: ':' + item.emote_name + ':' }) : null,
            item.description ? el('p', { text: item.description }) : null,
            el('div', { class: 'st-card-foot' }, priceView(item), buyButton(item, price))));
        return card;
    }

    function paintFeatured() {
        var box = $('stFeatured');
        box.textContent = '';
        var list = S.featured.map(function (f) { return S.items.find(function (i) { return i.id === f.item_id; }); }).filter(Boolean);
        $('featured').hidden = !list.length;
        if (!list.length) return;
        list.forEach(function (it) { box.appendChild(buildCard(it, true)); });
        var disc = S.settings && S.settings.featured_discount;
        $('stFeatSub').textContent = (disc ? 'Featured items cost ' + disc + '% less. ' : '') + 'The lineup changes every ' + (S.settings && S.settings.rotation_days || 3) + ' days.';
        paintClock();
    }

    function paintClock() {
        var rot = S.featured.filter(function (f) { return !f.is_pinned; });
        var next = (rot[0] || S.featured[0] || {}).ends_at;
        $('stClock').hidden = !next;
        if (next) $('stClockN').textContent = timeLeft(next);
        document.querySelectorAll('[data-ends]').forEach(function (n) { n.textContent = timeLeft(n.getAttribute('data-ends')) + ' left'; });
        if (S.user) $('stReset').textContent = 'Resets in ' + timeLeft(new Date(Date.now() + nextResetMs()).toISOString());
    }

    function paintChips() {
        var box = $('stChips');
        box.textContent = '';
        CATS.forEach(function (c) {
            if (c[0] !== 'all' && !S.items.some(function (i) { return i.category === c[0]; })) return;
            box.appendChild(el('button', { type: 'button', class: 'st-chip', role: 'tab', 'aria-selected': String(S.cat === c[0]), text: c[1], onclick: function () { S.cat = c[0]; paintChips(); paintGrid(); } }));
        });
    }

    function paintGrid() {
        var grid = $('stGrid');
        grid.textContent = '';
        var q = S.q.toLowerCase();
        var list = S.items.filter(function (i) {
            return (S.cat === 'all' || i.category === S.cat) && (!q || (i.name + ' ' + i.description).toLowerCase().indexOf(q) >= 0);
        });
        $('stItemsSub').textContent = S.items.length ? S.items.length + ' item' + (S.items.length === 1 ? '' : 's') + ' in the store' : '';
        if (!list.length) {
            grid.appendChild(el('div', { class: 'st-empty', text: S.items.length ? 'Nothing matches that search. Try another word or category.' : 'The store is empty right now. New items are added often, so check back soon.' }));
            return;
        }
        list.forEach(function (it) { grid.appendChild(buildCard(it, false)); });
    }

    function paintPacks() {
        var box = $('stPacks');
        box.textContent = '';
        if (!S.packs.length) { box.appendChild(el('div', { class: 'st-empty', text: 'Credit packs are not available yet.' })); return; }
        S.packs.forEach(function (p) {
            var url = safeUrl(p.checkout_url);
            var btn = el('button', { type: 'button', class: 'st-btn st-btn--primary', text: url ? 'Buy' : 'Coming soon' });
            if (!url) btn.disabled = true;
            else btn.addEventListener('click', function () {
                if (!S.user) { toast('Sign in first so we can add the credits to your account.', true); return; }
                window.open(url, '_blank', 'noopener');
                toast('After you pay, send your receipt to staff and your credits are added.');
            });
            box.appendChild(el('article', { class: 'st-pack' + (p.badge ? ' st-pack--hot' : '') },
                p.badge ? el('span', { class: 'st-pack-badge', text: p.badge }) : null,
                el('h3', { text: p.name }),
                el('div', { class: 'st-pack-amt' }, apexIcon(), fmt(p.credits)),
                el('div', { class: 'st-pack-bonus', text: p.bonus > 0 ? '+' + fmt(p.bonus) + ' bonus credits' : '' }),
                el('div', { class: 'st-pack-foot' }, el('span', { class: 'st-pack-price', text: p.price_label }), btn)));
        });
    }

    function paintEarn() {
        var c = S.settings || {};
        var rows = [
            ['Check in daily', '+' + (c.daily_amount || 3) + ' credits a day. ' + (c.streak_every ? 'Every ' + c.streak_every + ' days in a row adds +' + (c.streak_bonus || 0) + ' more.' : '')],
            ['Redeem event codes', 'Codes drop during events, giveaways and in the community. Enter them under Daily check-in.'],
            ['Top up', 'Need something now? Buy a credit pack. Packs never expire.']
        ];
        var box = $('stEarn');
        box.textContent = '';
        rows.forEach(function (r) { box.appendChild(el('div', { class: 'st-earn-item' }, el('h3', { text: r[0] }), el('p', { text: r[1] }))); });
    }

    function paintOwned() {
        var sec = $('owned'), box = $('stOwned');
        sec.hidden = !S.user;
        box.textContent = '';
        if (!S.user) return;
        var counts = {};
        S.owned.forEach(function (p) { counts[p.item_id || p.item_name] = (counts[p.item_id || p.item_name] || 0) + 1; });
        var seen = {};
        S.owned.forEach(function (p) {
            var key = p.item_id || p.item_name;
            if (seen[key]) return; seen[key] = true;
            var it = S.items.find(function (i) { return i.id === p.item_id; }) || { name: p.item_name, rarity: 'common', emoji: '🎁' };
            box.appendChild(el('div', { class: 'st-own is-' + it.rarity },
                el('div', { class: 'st-own-ico' }, mediaOf(it)),
                el('strong', { text: it.name }),
                el('small', { text: it.category === 'emote' ? 'In MY EMOTES' : (counts[key] > 1 ? 'x' + counts[key] : 'Owned') })));
        });
        $('stOwnSub').textContent = S.owned.length ? '' : 'Nothing yet. Items you buy show up here.';
        if (!S.owned.length) box.appendChild(el('div', { class: 'st-empty', text: 'Your items will appear here after your first purchase.' }));
    }

    function paintAll() { paintFeatured(); paintGrid(); paintOwned(); }

    /* ---------- buying ---------- */
    function openBuy(item) {
        var price = priceOf(item), bal = S.wallet ? Number(S.wallet.balance) : 0;
        S.buying = item;
        var media = $('stBuyMedia'); media.textContent = ''; media.appendChild(mediaOf(item));
        $('stBuyTitle').textContent = item.name;
        $('stBuyDesc').textContent = (item.description || '') + (item.category === 'emote' ? ((item.description ? ' ' : '') + 'Goes straight to MY EMOTES in chats. Type it as :' + item.emote_name + ':') : '');
        [['stBuyPrice', price], ['stBuyBal', bal], ['stBuyAfter', bal - price]].forEach(function (x) {
            var n = $(x[0]); n.textContent = ''; n.appendChild(apexIcon()); n.appendChild(document.createTextNode(fmt(x[1])));
        });
        $('stBuyOk').disabled = bal < price;
        $('stBuy').showModal();
    }

    async function confirmBuy(e) {
        e.preventDefault();
        var item = S.buying;
        if (!item || S.busy) return;
        S.busy = true; $('stBuyOk').disabled = true;
        try {
            var r = await sb.rpc('store_buy', { p_item: item.id });
            if (r.error) throw r.error;
            $('stBuy').close();
            S.owned.unshift({ id: 'new', item_id: item.id, item_name: item.name, price_paid: r.data.price, created_at: new Date().toISOString() });
            if (item.stock != null) item.stock = Math.max(0, item.stock - 1);
            setBalance(Number(r.data.balance));
            toast(item.category === 'emote' ? item.name + ' added to MY EMOTES in chats' : 'Bought ' + item.name + ' for ' + fmt(r.data.price) + ' credits');
        } catch (err) {
            $('stBuy').close();
            toast(friendly(err), true);
            try { await Promise.all([loadPublic(), loadUser()]); paintWallet(); paintAll(); } catch (e2) { /* keep screen as is */ }
        } finally { S.busy = false; S.buying = null; }
    }

    /* ---------- send credits ---------- */
    function feeFor(amount) { var p = (S.wallet && S.wallet.transfer && Number(S.wallet.transfer.fee_percent)) || 0; return Math.ceil(amount * p / 100); }

    function paintSend() {
        $('send').hidden = !S.user; $('history').hidden = !S.user;
        if (!S.user) return;
        var tr = (S.wallet && S.wallet.transfer) || {}, info = $('stSendInfo');
        info.textContent = '';
        var off = tr.enabled === false;
        ['stSendTo', 'stSendAmt', 'stSendNote', 'stSendBtn'].forEach(function (id) { $(id).disabled = off; });
        if (off) { info.appendChild(el('p', { text: 'Sending credits is paused right now.' })); return; }
        var cap = Number(tr.daily_cap) || 0, sent = Number((S.wallet && S.wallet.sent_24h) || 0);
        info.appendChild(el('p', { text: tr.fee_percent > 0 ? 'Fee: ' + tr.fee_percent + '% on top of what you send.' : 'No fee. The person gets exactly what you send.' }));
        if (cap > 0) {
            info.appendChild(el('p', {}, 'Sent in the last 24 hours: ', el('strong', { text: fmt(sent) + ' / ' + fmt(cap) })));
            var bar = el('div', { class: 'st-meter', 'aria-hidden': 'true' }, el('i')); bar.firstChild.style.width = Math.min(100, sent / cap * 100) + '%';
            info.appendChild(bar);
        }
        if (tr.min_age_days > 0) info.appendChild(el('p', { text: 'Your account must be at least ' + tr.min_age_days + ' days old to send.' }));
        info.appendChild(el('p', { text: 'Every transfer creates a receipt number. Send it to the other person if they want proof.' }));
    }

    async function reviewTransfer(e) {
        e.preventDefault();
        if (!S.user) { toast('Sign in to send credits.', true); return; }
        var to = $('stSendTo').value.trim().replace(/^@/, ''), amt = Math.floor(Number($('stSendAmt').value)), note = $('stSendNote').value.trim();
        if (!to) { $('stSendTo').focus(); toast('Enter who to send to.', true); return; }
        if (!(amt >= 1)) { $('stSendAmt').focus(); toast(ERR.bad_amount, true); return; }
        var fee = feeFor(amt), bal = S.wallet ? Number(S.wallet.balance) : 0;
        if (bal < amt + fee) { toast(ERR.not_enough_credits, true); return; }
        var btn = $('stSendBtn'); btn.disabled = true;
        try {
            var r = await sb.rpc('apex_lookup_user', { p_username: to });
            if (r.error) throw r.error;
            if (r.data.is_self) throw new Error('self_transfer');
            var who = $('stWho'); who.textContent = '';
            var av = el('span', { class: 'st-who-av' });
            var url = safeUrl(r.data.avatar_url);
            if (url) { var img = el('img', { src: url, alt: '', referrerpolicy: 'no-referrer' }); img.onerror = function () { img.remove(); av.textContent = (r.data.username || '?').charAt(0).toUpperCase(); }; av.appendChild(img); }
            else av.textContent = (r.data.username || '?').charAt(0).toUpperCase();
            who.appendChild(av);
            who.appendChild(el('div', {}, el('strong', { text: r.data.display_name || r.data.username }), el('small', { text: '@' + r.data.username })));
            [['stSdAmt', amt], ['stSdFee', fee], ['stSdTotal', amt + fee], ['stSdAfter', bal - amt - fee]].forEach(function (x) {
                var n = $(x[0]); n.textContent = ''; n.appendChild(apexIcon()); n.appendChild(document.createTextNode(fmt(x[1])));
            });
            $('stSdNote').textContent = note ? 'Note: ' + note : '';
            S.pendingSend = { to: r.data.username, amount: amt, note: note };
            $('stSendDlg').showModal();
        } catch (err) { toast(friendly(err), true); }
        finally { btn.disabled = false; }
    }

    async function confirmTransfer(e) {
        e.preventDefault();
        var p = S.pendingSend;
        if (!p || S.busy) return;
        S.busy = true; $('stSdOk').disabled = true;
        try {
            var r = await sb.rpc('apex_transfer', { p_to: p.to, p_amount: p.amount, p_note: p.note || null });
            if (r.error) throw r.error;
            $('stSendDlg').close();
            $('stSendForm').reset();
            if (S.wallet) S.wallet.sent_24h = Number(S.wallet.sent_24h || 0) + p.amount;
            setBalance(Number(r.data.balance));
            showReceipt(r.data, 'sender');
        } catch (err) {
            $('stSendDlg').close();
            toast(friendly(err), true);
            try { await loadUser(); paintWallet(); } catch (e2) { /* ignore */ }
        } finally { S.busy = false; S.pendingSend = null; $('stSdOk').disabled = false; }
    }

    /* ---------- receipts ---------- */
    function showReceipt(d, viewer) {
        S.receipt = d;
        var me = viewer || d.viewer;
        $('stRcptSub').textContent = me === 'recipient' ? '@' + d.from + ' sent you credits' : me === 'sender' ? 'Sent to @' + d.to : '@' + d.from + ' sent credits to @' + d.to;
        $('stRcptAmt').textContent = fmt(d.amount);
        var rows = [['Receipt', d.receipt_no], ['Date', new Date(d.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })], ['From', '@' + d.from], ['To', '@' + d.to]];
        if (Number(d.fee) > 0) rows.push(['Fee', fmt(d.fee)]);
        if (d.note) rows.push(['Note', d.note]);
        rows.push(['Status', 'Delivered']);
        var box = $('stRcptRows'); box.textContent = '';
        rows.forEach(function (r) { box.appendChild(el('div', {}, el('dt', { text: r[0] }), el('dd', { text: r[1] }))); });
        var dlg = $('stRcptDlg'); if (!dlg.open) dlg.showModal();
    }

    function copyReceipt() {
        var d = S.receipt; if (!d) return;
        var text = ['APEX Credits receipt', 'Receipt: ' + d.receipt_no, 'Date: ' + new Date(d.at).toLocaleString(), 'From: @' + d.from, 'To: @' + d.to, 'Amount: ' + fmt(d.amount) + (Number(d.fee) > 0 ? ' (fee ' + fmt(d.fee) + ')' : ''), d.note ? 'Note: ' + d.note : null, 'Status: Delivered'].filter(Boolean).join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Receipt copied'); }, function () { toast('Could not copy', true); });
        else toast('Could not copy', true);
    }

    async function openReceipt(no) {
        try {
            var r = await sb.rpc('apex_receipt', { p_no: no });
            if (r.error) throw r.error;
            showReceipt(r.data);
        } catch (err) { toast(friendly(err), true); }
    }

    function verifyReceipt(e) {
        e.preventDefault();
        var v = $('stVerifyNo').value.trim();
        if (!v) { $('stVerifyNo').focus(); return; }
        openReceipt(v);
    }

    /* ---------- my transactions ---------- */
    function txKind(r) {
        var t = String(r.reason || '');
        if (/^Sent to/i.test(t)) return 'Sent';
        if (/^Received from/i.test(t)) return 'Received';
        if (/^Bought/i.test(t)) return 'Purchase';
        if (/^Daily check-in/i.test(t)) return 'Check-in';
        if (/^Code:/i.test(t)) return 'Code';
        return Number(r.delta) >= 0 ? 'Credit' : 'Debit';
    }

    async function loadTx(reset) {
        if (!S.user || S.txBusy) return;
        S.txBusy = true;
        try {
            var r = await sb.rpc('apex_my_transactions', { p_limit: 30, p_before: reset ? null : S.txBefore });
            if (r.error) throw r.error;
            var rows = r.data || [];
            S.tx = reset ? rows : S.tx.concat(rows);
            S.txMore = rows.length === 30;
            if (rows.length) S.txBefore = rows[rows.length - 1].id;
            S.txReady = true;
        } catch (err) { S.txReady = true; if (reset) S.tx = []; S.txErr = friendly(err); }
        finally { S.txBusy = false; paintTx(); }
    }

    function paintTx() {
        var chips = $('stTxChips'); chips.textContent = '';
        [['all', 'All'], ['in', 'Money in'], ['out', 'Money out']].forEach(function (c) {
            chips.appendChild(el('button', { type: 'button', class: 'st-chip', role: 'tab', 'aria-selected': String(S.txFilter === c[0]), text: c[1], onclick: function () { S.txFilter = c[0]; paintTx(); } }));
        });
        var box = $('stTx'); box.textContent = '';
        var list = S.tx.filter(function (r) { return S.txFilter === 'all' || (S.txFilter === 'in' ? Number(r.delta) > 0 : Number(r.delta) < 0); });
        if (!list.length) {
            box.appendChild(el('div', { class: 'st-empty', text: !S.txReady ? 'Loading...' : (S.tx.length ? 'Nothing in this filter yet.' : (S.txErr || 'No transactions yet. Claim your daily credits to get started.')) }));
        }
        list.forEach(function (r) {
            var inn = Number(r.delta) > 0;
            var sub = el('div', { class: 'st-tx-sub' }, new Date(r.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
            if (r.ref) { sub.appendChild(document.createTextNode(' · ')); sub.appendChild(el('button', { type: 'button', text: 'Receipt ' + r.ref, onclick: function () { openReceipt(r.ref); } })); }
            box.appendChild(el('div', { class: 'st-tx-row ' + (inn ? 'is-in' : 'is-out') },
                el('span', { class: 'st-tx-tag', text: txKind(r) }),
                el('div', { class: 'st-tx-main' }, el('div', { class: 'st-tx-title', text: r.reason }), sub),
                el('div', { class: 'st-tx-amt' }, (inn ? '+' : '') + fmt(r.delta), el('small', { text: 'Balance ' + fmt(r.balance_after) }))));
        });
        $('stTxMore').hidden = !S.txMore;
    }

    /* ---------- start ---------- */
    function wire() {
        $('stTheme').addEventListener('click', function () {
            var light = document.body.classList.toggle('light-mode');
            try { localStorage.setItem('specsoft-theme', light ? 'light' : 'dark'); } catch (e) { /* ignore */ }
        });
        $('stClaim').addEventListener('click', claimDaily);
        $('stRedeem').addEventListener('submit', redeem);
        $('stBuyForm').addEventListener('submit', confirmBuy);
        $('stBuyCancel').addEventListener('click', function () { $('stBuy').close(); });
        $('stSendForm').addEventListener('submit', reviewTransfer);
        $('stSendDlgForm').addEventListener('submit', confirmTransfer);
        $('stSdCancel').addEventListener('click', function () { $('stSendDlg').close(); });
        $('stRcptCopy').addEventListener('click', copyReceipt);
        $('stRcptClose').addEventListener('click', function () { $('stRcptDlg').close(); });
        $('stVerifyForm').addEventListener('submit', verifyReceipt);
        $('stTxMore').addEventListener('click', function () { loadTx(false); });
        ['stSendDlg', 'stRcptDlg'].forEach(function (id) { $(id).addEventListener('click', function (e) { if (e.target === $(id)) $(id).close(); }); });
        $('stBuy').addEventListener('click', function (e) { if (e.target === $('stBuy')) $('stBuy').close(); });
        var t; $('stSearch').addEventListener('input', function (e) { var v = e.target.value; clearTimeout(t); t = setTimeout(function () { S.q = v.trim(); paintGrid(); }, 150); });
        setInterval(paintClock, 1000);
        sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' || ev === 'SIGNED_IN') { loadUser().then(function () { paintWallet(); paintAll(); }); } });
    }

    async function start() {
        wire();
        $('stGrid').appendChild(el('div', { class: 'st-skel' })); $('stGrid').appendChild(el('div', { class: 'st-skel' })); $('stGrid').appendChild(el('div', { class: 'st-skel' }));
        if (!sb) { $('stGrid').textContent = ''; $('stGrid').appendChild(el('div', { class: 'st-empty', text: 'The store cannot connect. Check supabase-config.js.' })); return; }
        try {
            await loadPublic();
            await loadUser();
        } catch (err) {
            $('stGrid').textContent = '';
            $('stGrid').appendChild(el('div', { class: 'st-empty', text: friendly(err) }));
            $('featured').hidden = true;
            return;
        }
        paintWallet(); paintChips(); paintGrid(); paintFeatured(); paintPacks(); paintEarn(); paintOwned();
        if (S.user) loadTx(true);
        if (window.ApexCredits && S.wallet) window.ApexCredits.set(Number(S.wallet.balance));
        if (location.hash) { try { var t2 = document.querySelector(location.hash); if (t2 && t2.scrollIntoView) t2.scrollIntoView(); } catch (e3) { /* odd hash */ } }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
