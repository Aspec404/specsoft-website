/* ==========================================================================
   SPECSOFT® — Store (store.js)
   Needs: supabase-config.js, supabase-store.sql (run once), apex-credits.js
   Quests + XP also need supabase-store-quests.sql and xp.js
   ========================================================================== */
(function () {
    'use strict';

    var CFG = window.SPECSOFT_CONFIG || {};
    var sb = window.getSupabaseClient ? window.getSupabaseClient()
        : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);

    var $ = function (id) { return document.getElementById(id); };
    var S = {
        user: null, wallet: null, items: [], featured: [], settings: null, packs: [], owned: [],
        cat: 'all', q: '', limit: 24, buying: null, busy: false,
        bundles: {}, equipped: null, equippedTitle: null, me: null,
        tx: [], txMore: false, txBefore: null, txFilter: 'all', txBusy: false, txReady: false, pendingSend: null, receipt: null,
        quests: null, questTab: 'normal', questBusy: false, questErr: '', questReloadAt: 0, skew: 0, xp: null
    };

    var PAGE = 24;   // items shown in the shop grid at first; Load more adds this many
    var CATS = [['all', 'All'], ['bundle', 'Bundles'], ['gift', 'Gifts'], ['frame', 'Frames'], ['emote', 'Emotes'], ['title', 'Titles'], ['theme', 'Themes'], ['boost', 'Boosts'], ['cosmetic', 'Cosmetics'], ['misc', 'Misc']];
    var RARITY = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', legacy: 'Legacy', mythic: 'Mythic' };
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
        receipt_not_found: 'No receipt with that number.',
        already_own_all: 'You already own everything in this bundle.',
        not_owned: 'You need to own that item first.',
        booster_blocked: 'A stronger booster of that kind is already running. Wait for it to end first. Nothing was charged.',
        booster_max: 'That would stack more than 30 days of that booster. Nothing was charged.',
        quest_not_done: 'That quest is not finished yet.',
        quest_already_claimed: 'You already claimed that quest.',
        quest_expired: 'That board just refreshed. Check the new quests.',
        quest_unavailable: 'That quest is not available anymore.'
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
        if (/quest_board|quest_claim|xp_ping|xp_status|quest_defs|user_xp/i.test(m)) return 'Quests are not set up yet. Run supabase-store-quests.sql in Supabase.';
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
    /* Spectra bond gifts are normal store items that carry bond_xp (see spectra-bond-shop.sql). They get their own Gifts tab. */
    function isGift(item) { return item.category === 'gift' || item.bond_xp != null; }
    function catOf(item) { return isGift(item) ? 'gift' : item.category; }

    /* ---------- data ---------- */
    async function loadPublic() {
        var r = await Promise.all([
            sb.from('store_items').select('*').eq('active', true).order('sort', { ascending: true }).order('created_at', { ascending: true }),
            sb.rpc('store_featured'),
            sb.from('store_settings').select('*').eq('id', 1).maybeSingle(),
            sb.from('credit_packs').select('*').eq('active', true).order('sort', { ascending: true }),
            sb.from('store_bundle_items').select('bundle_id,item_id')
        ]);
        if (r[0].error) throw r[0].error;
        S.items = r[0].data || [];
        S.featured = r[1].error ? [] : (r[1].data || []);
        S.settings = r[2].data || { rotation_days: 3, featured_discount: 20, daily_amount: 3, streak_every: 7, streak_bonus: 15 };
        S.packs = r[3].error ? [] : (r[3].data || []);
        S.bundles = {};
        (r[4].error ? [] : (r[4].data || [])).forEach(function (b) { (S.bundles[b.bundle_id] = S.bundles[b.bundle_id] || []).push(b.item_id); });
    }

    async function loadUser() {
        var s = await sb.auth.getSession();
        S.user = s && s.data && s.data.session ? s.data.session.user : null;
        S.wallet = null; S.owned = [];
        if (!S.user) return;
        var r = await Promise.all([
            sb.rpc('apex_wallet'),
            sb.from('store_purchases').select('id,item_id,item_name,price_paid,created_at').eq('user_id', S.user.id).order('created_at', { ascending: false }),
            sb.from('user_equipped').select('frame_item,title_item').eq('user_id', S.user.id).maybeSingle(),
            sb.from('profiles').select('username,display_name,avatar_url').eq('id', S.user.id).maybeSingle()
        ]);
        if (!r[0].error) S.wallet = r[0].data;
        if (!r[1].error) S.owned = r[1].data || [];
        S.equipped = (!r[2].error && r[2].data && r[2].data.frame_item) || null;
        S.equippedTitle = (!r[2].error && r[2].data && r[2].data.title_item) || null;
        S.me = (!r[3].error && r[3].data) || null;
        try { var a = await sb.rpc('store_is_admin'); $('stManage').hidden = !(a && a.data === true); } catch (e) { /* not an admin */ }
    }

    // a credit booster just paid out: pull the new balance without touching the rest of the screen
    async function refreshWalletQuiet() {
        if (!S.user) return;
        try {
            var r = await sb.rpc('apex_wallet');
            if (r && !r.error && r.data) { S.wallet = r.data; paintWallet(); window.dispatchEvent(new CustomEvent('apex:balance', { detail: { balance: r.data.balance } })); }
        } catch (e) { /* the next ping tries again */ }
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
    /* ---------- frames + bundles art ---------- */
    function frameAvatar(frame, size) {
        var name = S.me ? (S.me.display_name || S.me.username || 'You') : 'You';
        var node = el('span', { class: 'sp-avatar', style: '--sp-size:' + size + 'px' }, el('span', { class: 'sp-initial', text: String(name).charAt(0).toUpperCase() }));
        var url = S.me && safeUrl(S.me.avatar_url);
        if (url) { var img = el('img', { src: url, alt: '', referrerpolicy: 'no-referrer' }); img.onerror = function () { img.remove(); }; node.appendChild(img); }
        if (window.SpecFrames) window.SpecFrames.apply(node, frame);
        return node;
    }

    function durLabel(min) {
        min = Number(min) || 0;
        if (min % 1440 === 0 && min >= 1440) return (min / 1440) + (min === 1440 ? ' day' : ' days');
        if (min % 60 === 0 && min >= 60) return (min / 60) + 'h';
        if (min > 60) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
        return min + ' min';
    }
    function boostArt(d) {
        return el('div', { class: 'st-boost-art st-boost-art--' + d.kind },
            el('b', { text: d.tier + 'x' }), el('span', { text: d.kind === 'xp' ? 'XP' : 'Credits' }), el('small', { text: durLabel(d.minutes) }));
    }

    function titleArt(data, size) {
        var node = el('span', { class: 'st-title-art', style: 'font-size:' + (size || 18) + 'px' });
        if (window.SpecTitles) window.SpecTitles.apply(node, data);
        if (!node.firstChild) node.textContent = '';
        return node;
    }

    function bundleContents(item) { return (S.bundles[item.id] || []).map(function (id) { return S.items.find(function (i) { return i.id === id; }); }).filter(Boolean); }
    function ownsAllOfBundle(item) { var l = bundleContents(item); return l.length > 0 && l.every(isOwnedMax); }
    function bundleLine(item) {
        var l = bundleContents(item), worth = l.reduce(function (a, c) { return a + c.price; }, 0);
        return 'Bundle · ' + l.length + ' items' + (worth > item.price ? ' · worth ' + fmt(worth) : '');
    }
    function miniArt(c) {
        if (c.category === 'frame' && c.frame_data) return frameAvatar(c.frame_data, 28);
        if (c.category === 'title' && c.title_data) return titleArt(c.title_data, 11);
        return mediaOf(c);
    }
    function bundleArt(item) {
        var list = bundleContents(item), box = el('div', { class: 'st-bundle-art' });
        if (!list.length) return el('span', { class: 'st-emoji', text: item.emoji || '🎁' });
        list.slice(0, list.length > 4 ? 3 : 4).forEach(function (c) { box.appendChild(el('span', { class: 'st-bundle-cell' }, miniArt(c))); });
        if (list.length > 4) box.appendChild(el('span', { class: 'st-bundle-cell st-bundle-more', text: '+' + (list.length - 3) }));
        return box;
    }

    async function equipFrame(id, quiet) {
        if (S.busy || !S.user) return;
        S.busy = true;
        try {
            var r = await sb.rpc('store_equip', { p_item: id });
            if (r.error) throw r.error;
            S.equipped = r.data.item || null;
            if (window.SpecFrames) window.SpecFrames.setMine(S.user.id, r.data.frame);
            paintAll();
            if (!quiet) toast(id ? 'Frame equipped. It shows in chats and on your profile.' : 'Frame removed');
        } catch (err) { toast(friendly(err), true); }
        finally { S.busy = false; }
    }

    async function equipTitle(id, quiet) {
        if (S.busy || !S.user) return;
        S.busy = true;
        try {
            var r = await sb.rpc('store_equip_title', { p_item: id });
            if (r.error) throw r.error;
            S.equippedTitle = r.data.item || null;
            if (window.SpecTitles) window.SpecTitles.setMine(S.user.id, r.data.title);
            paintAll();
            if (!quiet) toast(id ? 'Title equipped. It shows next to your name in chats and on your profile.' : 'Title removed');
        } catch (err) { toast(friendly(err), true); }
        finally { S.busy = false; }
    }

    function mediaOf(item, big) {
        if (item.category === 'frame' && item.frame_data) return frameAvatar(item.frame_data, typeof big === 'number' ? big : (big ? 92 : 72));
        if (item.category === 'boost' && item.boost_data) return boostArt(item.boost_data);
        if (item.category === 'title' && item.title_data) return titleArt(item.title_data, typeof big === 'number' ? Math.round(big * 0.45) : (big ? 26 : 20));
        if (item.category === 'bundle') return bundleArt(item);
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
        if (item.category === 'frame' && S.user && isOwnedMax(item)) {
            var worn = S.equipped === item.id;
            btn.textContent = worn ? 'Unequip' : 'Equip'; btn.className = 'st-btn' + (worn ? '' : ' st-btn--primary');
            btn.addEventListener('click', function () { equipFrame(worn ? null : item.id); });
            return btn;
        }
        if (item.category === 'title' && S.user && isOwnedMax(item)) {
            var tw = S.equippedTitle === item.id;
            btn.textContent = tw ? 'Unequip' : 'Equip'; btn.className = 'st-btn' + (tw ? '' : ' st-btn--primary');
            btn.addEventListener('click', function () { equipTitle(tw ? null : item.id); });
            return btn;
        }
        if (item.category === 'bundle' && ownsAllOfBundle(item)) { btn.textContent = 'Owned'; btn.disabled = true; btn.className = 'st-btn'; return btn; }
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
        var card = el('article', { class: 'st-card is-' + item.rarity + (' st-card--' + item.category) + (feat ? ' st-card--feat' : '') + (isOwnedMax(item) ? ' is-owned' : '') });
        var media = el('div', { class: 'st-card-media' }, mediaOf(item, !!feat));
        if (f && f.discount) media.appendChild(el('span', { class: 'st-tag', text: '-' + f.discount + '%' }));
        if (feat && f && f.is_pinned) { var e = el('span', { class: 'st-ends', 'data-ends': f.ends_at, text: timeLeft(f.ends_at) + ' left' }); media.appendChild(e); }
        card.appendChild(media);
        card.appendChild(el('div', { class: 'st-card-body' },
            el('div', { class: 'st-card-top' },
                el('span', { class: 'st-rarity', text: RARITY[item.rarity] || 'Common' }),
                item.stock != null ? el('span', { class: 'st-stock', text: item.stock > 0 ? item.stock + ' left' : 'sold out' }) : null),
            el('h3', { text: item.name }),
            item.category === 'emote' && item.emote_name ? el('div', { class: 'st-emote-code', text: ':' + item.emote_name + ':' + (item.super_data ? '  \u26A1 SUPER EMOTE' : '') }) : null,
            item.category === 'bundle' ? el('div', { class: 'st-emote-code', text: bundleLine(item) }) : null,
            isGift(item) && item.bond_xp != null ? el('div', { class: 'st-emote-code', text: '+' + item.bond_xp + ' bond XP' + (item.bond_favorite ? ' \u2605 her favorite (2x)' : '') }) : null,
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
        paintQuestClock();
    }

    function paintChips() {
        var box = $('stChips');
        box.textContent = '';
        CATS.forEach(function (c) {
            if (c[0] !== 'all' && !S.items.some(function (i) { return catOf(i) === c[0]; })) return;
            box.appendChild(el('button', { type: 'button', class: 'st-chip', role: 'tab', 'aria-selected': String(S.cat === c[0]), text: c[1], onclick: function () { S.cat = c[0]; S.limit = PAGE; paintChips(); paintGrid(); } }));
        });
    }

    function gridList() {
        var q = S.q.toLowerCase();
        return S.items.filter(function (i) {
            return (S.cat === 'all' || catOf(i) === S.cat) && (!q || (i.name + ' ' + i.description).toLowerCase().indexOf(q) >= 0);
        });
    }

    // "Showing 24 of 61" and the Load more button (hidden once everything is on screen)
    function paintMore(total) {
        var wrap = $('stMoreWrap');
        if (!wrap) return;
        wrap.hidden = total <= S.limit;
        $('stMoreN').textContent = 'Showing ' + Math.min(S.limit, total) + ' of ' + total;
    }

    function paintGrid() {
        var grid = $('stGrid');
        grid.textContent = '';
        var list = gridList();
        $('stItemsSub').textContent = S.items.length ? S.items.length + ' item' + (S.items.length === 1 ? '' : 's') + ' in the store' : '';
        if (!list.length) {
            grid.appendChild(el('div', { class: 'st-empty', text: S.items.length ? 'Nothing matches that search. Try another word or category.' : 'The store is empty right now. New items are added often, so check back soon.' }));
            paintMore(0);
            return;
        }
        list.slice(0, S.limit).forEach(function (it) { grid.appendChild(buildCard(it, false)); });
        paintMore(list.length);
    }

    // adds the next page of cards without redrawing the ones already on screen
    function loadMore() {
        var list = gridList(), grid = $('stGrid'), from = Math.min(S.limit, list.length);
        S.limit += PAGE;
        list.slice(from, S.limit).forEach(function (it) { grid.appendChild(buildCard(it, false)); });
        paintMore(list.length);
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
            ['Finish quests', 'Every board has 3 quests that pay credits and XP. New normal quests arrive every ' + (c.quest_normal_hours || 5) + ' hours, plus daily and weekly boards.'],
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
            if (it.category === 'bundle') return;          // the items inside are listed on their own
            if (isGift(it)) return;                        // gifts live in the Gift Inventory in Spectra chat
            var isFrame = it.category === 'frame' && it.id, isTitle = it.category === 'title' && it.id, wearable = isFrame || isTitle;
            var worn = isFrame ? S.equipped === it.id : (isTitle && S.equippedTitle === it.id);
            box.appendChild(el('div', { class: 'st-own is-' + it.rarity + (worn ? ' is-equipped' : '') + (isTitle ? ' st-own--title' : '') },
                el('div', { class: 'st-own-ico' }, mediaOf(it, 46)),
                el('strong', { text: it.name }),
                el('small', { text: it.category === 'emote' ? 'In MY EMOTES' : (wearable ? (worn ? 'Equipped' : (isTitle ? 'Title' : 'Frame')) : (counts[key] > 1 ? 'x' + counts[key] : 'Owned')) }),
                wearable ? el('button', { type: 'button', class: 'st-btn st-own-btn', text: worn ? 'Unequip' : 'Equip', onclick: function () { if (isTitle) equipTitle(worn ? null : it.id); else equipFrame(worn ? null : it.id); } }) : null));
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
        var ul = $('stBuyList'), warn = $('stBuyWarn');
        ul.textContent = ''; ul.hidden = item.category !== 'bundle'; warn.hidden = true;
        if (item.category === 'bundle') {
            var have = 0;
            bundleContents(item).forEach(function (c) {
                var own = isOwnedMax(c); if (own) have++;
                ul.appendChild(el('li', { class: own ? 'is-owned' : '' }, el('span', { class: 'st-incl-ico' }, miniArt(c)), c.name + (own ? ' (you already own this)' : '')));
            });
            if (have) { warn.hidden = false; warn.textContent = 'You already own ' + have + ' of these. You still get the rest, at the same price.'; }
        }
        $('stBuyDesc').textContent = (item.description || '') + (item.category === 'emote' ? ((item.description ? ' ' : '') + 'Goes straight to MY EMOTES in chats. Type it as :' + item.emote_name + ':') : '')
            + (isGift(item) && item.bond_xp != null ? ((item.description ? ' ' : '') + 'Send it to Spectra from the sparkle menu in her chat for +' + item.bond_xp + ' bond XP' + (item.bond_favorite ? ' (double, it is her favorite).' : '.')) : '');
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
            var wasEquipped = S.equipped, wasTitle = S.equippedTitle, newFrame = null, newTitle = null;
            if (item.category === 'bundle') {
                await loadUser();                                   // the bundle added several items: reload what you own
                newFrame = bundleContents(item).find(function (c) { return c.category === 'frame' && (r.data.granted || []).indexOf(c.name) >= 0; }) || null;
                newTitle = bundleContents(item).find(function (c) { return c.category === 'title' && (r.data.granted || []).indexOf(c.name) >= 0; }) || null;
            } else {
                S.owned.unshift({ id: 'new', item_id: item.id, item_name: item.name, price_paid: r.data.price, created_at: new Date().toISOString() });
                if (item.category === 'frame') newFrame = item;
                if (item.category === 'title') newTitle = item;
            }
            if (item.stock != null) item.stock = Math.max(0, item.stock - 1);
            setBalance(Number(r.data.balance));
            if (window.SpecXP && r.data.boosters) window.SpecXP.setBoosters(r.data.boosters);
            var autoWear = !wasEquipped && newFrame, autoTitle = !wasTitle && newTitle;
            toast(item.category === 'emote' ? item.name + ' added to MY EMOTES in chats'
                : item.category === 'bundle' ? item.name + ': ' + (r.data.granted || []).length + ' items added' + (autoWear ? ' and your new frame is on' : '')
                : item.category === 'frame' ? item.name + (autoWear ? ' bought and equipped' : ' bought. Press Equip to wear it')
                : item.category === 'title' ? item.name + (autoTitle ? ' bought and equipped' : ' bought. Press Equip to wear it')
                : isGift(item) ? item.name + ' is in your Gift Inventory. Send it from the sparkle menu in Spectra chat'
                : item.category === 'boost' && item.boost_data ? item.name + ' is running: ' + item.boost_data.tier + 'x ' + (item.boost_data.kind === 'xp' ? 'XP' : 'credits') + ' for ' + durLabel(item.boost_data.minutes) + ' of online time'
                : 'Bought ' + item.name + ' for ' + fmt(r.data.price) + ' credits');
            if (autoWear) setTimeout(function () { equipFrame(newFrame.id, true); }, 60);
            if (autoTitle) setTimeout(function () { equipTitle(newTitle.id, true); }, autoWear ? 700 : 60);
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

    /* ---------- XP + quests ---------- */
    var QKINDS = [['normal', 'Normal'], ['daily', 'Daily'], ['weekly', 'Weekly']];
    var DIFF = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

    function paintXp() {
        var box = $('stXp'), x = S.xp;
        box.hidden = !(S.user && x);
        if (box.hidden) return;
        var pct = Math.max(0, Math.min(100, Number(x.pct) || 0));
        $('stXpLv').textContent = 'LV ' + x.level;
        $('stXpTotal').textContent = fmt(x.xp) + ' XP';
        $('stXpNext').textContent = fmt(x.into) + ' / ' + fmt(x.need) + ' to level ' + (Number(x.level) + 1);
        $('stXpFill').style.width = pct + '%';
        $('stXpBar').setAttribute('aria-valuenow', String(pct));
        var per = Number((S.settings || {}).xp_seconds_per_xp) || 180, cap = Number(x.day_cap) || 0;
        var mins = Math.round(per / 60 * 10) / 10;
        $('stXpHelp').textContent = 'Earn 1 XP for every ' + mins + ' minutes you are active here.' +
            (cap > 0 ? ' Time on site today: ' + fmt(x.day_xp) + ' / ' + fmt(cap) + ' XP. Quest XP is not limited.' : '');
    }

    function setXp(info, quiet) {
        if (!info) return;
        var prev = S.xp;
        S.xp = info;
        if (!quiet && prev && Number(info.level) > Number(prev.level)) toast('Level up! You are now level ' + info.level + '.');
        paintXp();
    }

    async function loadQuests() {
        S.questErr = '';
        if (!S.user) { S.quests = null; S.xp = null; paintQuests(); paintXp(); return; }
        try {
            var r = await sb.rpc('quest_board');
            if (r.error) throw r.error;
            S.quests = (r.data && r.data.boards) || null;
            S.skew = r.data && r.data.now ? new Date(r.data.now).getTime() - Date.now() : 0;
            if (r.data) setXp(r.data.xp, true);
        } catch (err) { S.quests = null; S.xp = null; S.questErr = friendly(err); }
        S.questReloadAt = Date.now();
        paintQuests(); paintXp();
    }

    function readyCount(kind) {
        var b = S.quests && S.quests[kind];
        return b ? (b.quests || []).filter(function (q) { return q.done && !q.claimed; }).length : 0;
    }

    function questCard(q) {
        var target = Math.max(1, Number(q.target) || 1);
        var pct = Math.max(0, Math.min(100, Math.round((Number(q.progress) || 0) / target * 100)));
        var canClaim = !!(q.done && !q.claimed);
        var unit = q.metric === 'online_minutes' ? ' min' : (q.metric === 'spend_credits' ? ' AC' : '');
        var fill = el('i'); fill.style.width = pct + '%';
        var btn = el('button', {
            type: 'button', class: 'st-btn' + (canClaim ? ' st-btn--primary' : ''), disabled: !canClaim || S.questBusy,
            text: q.claimed ? 'Claimed' : (q.done ? 'Claim' : 'In progress'),
            onclick: function () { claimQuest(q.id); }
        });
        return el('article', { class: 'st-quest' + (q.claimed ? ' is-claimed' : (q.done ? ' is-ready' : '')) },
            el('div', { class: 'st-quest-top' },
                el('span', { class: 'st-qtag st-qtag--' + q.difficulty, text: DIFF[q.difficulty] || q.difficulty }),
                el('span', { class: 'st-quest-num', text: fmt(q.progress) + ' / ' + fmt(q.target) + unit })),
            el('h3', { text: q.title }),
            q.description ? el('p', { text: q.description }) : null,
            el('div', { class: 'st-meter' }, fill),
            el('div', { class: 'st-quest-foot' },
                el('div', { class: 'st-rewards' },
                    Number(q.reward_ac) > 0 ? el('span', { class: 'st-reward', title: 'APEX Credits' }, '+' + fmt(q.reward_ac), apexIcon()) : null,
                    Number(q.reward_xp) > 0 ? el('span', { class: 'st-reward st-reward--xp', title: 'XP', text: '+' + fmt(q.reward_xp) + ' XP' }) : null),
                btn));
    }

    function paintQuests() {
        var tabs = $('stQuestTabs'), box = $('stQuests');
        tabs.textContent = ''; box.textContent = '';
        $('stQuestGuest').hidden = !!S.user;
        tabs.hidden = !(S.user && S.quests);
        if (!S.user) { $('stQuestClock').hidden = true; return; }
        if (!S.quests) {
            $('stQuestClock').hidden = true;
            box.appendChild(el('div', { class: 'st-empty', text: S.questErr || 'Loading quests...' }));
            return;
        }
        QKINDS.forEach(function (k) {
            var n = readyCount(k[0]);
            tabs.appendChild(el('button', { type: 'button', class: 'st-chip', role: 'tab', 'aria-selected': String(S.questTab === k[0]), onclick: function () { S.questTab = k[0]; paintQuests(); } },
                k[1], n ? el('span', { class: 'st-qdot', text: String(n), title: n + ' ready to claim' }) : null));
        });
        var list = (S.quests[S.questTab] && S.quests[S.questTab].quests) || [];
        if (!list.length) box.appendChild(el('div', { class: 'st-empty', text: 'No quests on this board right now. Check back soon.' }));
        list.forEach(function (q) { box.appendChild(questCard(q)); });
        paintQuestClock();
    }

    function paintQuestClock() {
        var clock = $('stQuestClock'), b = S.user && S.quests && S.quests[S.questTab];
        clock.hidden = !(b && b.ends_at);
        if (clock.hidden) return;
        var left = new Date(b.ends_at).getTime() - (Date.now() + S.skew);
        $('stQuestClockN').textContent = left <= 0 ? 'now' : timeLeft(new Date(Date.now() + left).toISOString());
        // the board rotated while the page was open: fetch the new one (at most every 15 seconds)
        if (left <= 0 && !S.questBusy && Date.now() - S.questReloadAt > 15000) loadQuests();
    }

    async function claimQuest(id) {
        if (S.questBusy || !S.user) return;
        S.questBusy = true; paintQuests();
        try {
            var r = await sb.rpc('quest_claim', { p_quest: id });
            if (r.error) throw r.error;
            var d = r.data, prev = S.xp;
            Object.keys(S.quests || {}).forEach(function (k) { ((S.quests[k] || {}).quests || []).forEach(function (q) { if (q.id === id) q.claimed = true; }); });
            if (S.wallet) S.wallet.lifetime = Number(S.wallet.lifetime || 0) + Number(d.reward_ac || 0);
            S.questReloadAt = Date.now();
            setXp(d.xp, true);
            if (window.SpecXP) window.SpecXP.set(d.xp);
            setBalance(Number(d.balance));
            var bits = [];
            if (Number(d.reward_ac) > 0) bits.push('+' + fmt(d.reward_ac) + ' APEX Credits');
            if (Number(d.reward_xp) > 0) bits.push('+' + fmt(d.reward_xp) + ' XP');
            var up = prev && d.xp && Number(d.xp.level) > Number(prev.level);
            toast('Quest complete: ' + (bits.join(', ') || d.quest) + (up ? '. Level up! You are level ' + d.xp.level + '.' : ''));
        } catch (err) { toast(friendly(err), true); await loadQuests(); }
        finally { S.questBusy = false; paintQuests(); }
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
        if ($('stMore')) $('stMore').addEventListener('click', loadMore);
        var t; $('stSearch').addEventListener('input', function (e) { var v = e.target.value; clearTimeout(t); t = setTimeout(function () { S.q = v.trim(); S.limit = PAGE; paintGrid(); }, 150); });
        setInterval(paintClock, 1000);
        window.addEventListener('hashchange', function () {
            if (location.hash !== '#gifts' || !S.items.some(isGift)) return;
            S.cat = 'gift'; S.limit = PAGE; paintChips(); paintGrid(); var sec = $('items'); if (sec && sec.scrollIntoView) sec.scrollIntoView();
        });
        // xp.js pings once a minute: when it answers, refresh the quest progress too (at most every 20 seconds)
        // free rewards (freemium.js): credits, XP, titles or frames may have just arrived, so refresh the wallet and your items
        window.addEventListener('freemium:reward', function () {
            refreshWalletQuiet();
            loadUser().then(function () { paintWallet(); paintAll(); });
        });
        if (window.SpecXP) window.SpecXP.onChange(function (i) {
            setXp(i);
            if (Number(i.booster_credits) > 0) refreshWalletQuiet();
            if (S.user && !S.questBusy && Date.now() - S.questReloadAt > 20000) loadQuests();
        });
        sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_OUT' || ev === 'SIGNED_IN') { loadUser().then(function () { paintWallet(); paintAll(); loadQuests(); }); } });
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
        if (S.user && window.SpecFrames) { var mine = S.items.find(function (i) { return i.id === S.equipped; }); window.SpecFrames.setMine(S.user.id, mine ? mine.frame_data : null); }
        if (S.user && window.SpecTitles) { var myT = S.items.find(function (i) { return i.id === S.equippedTitle; }); window.SpecTitles.setMine(S.user.id, myT ? myT.title_data : null); }
        if (location.hash === '#gifts' && S.items.some(isGift)) S.cat = 'gift';
        paintWallet(); paintChips(); paintGrid(); paintFeatured(); paintPacks(); paintEarn(); paintOwned();
        paintQuests(); loadQuests();
        if (S.user) loadTx(true);
        if (window.ApexCredits && S.wallet) window.ApexCredits.set(Number(S.wallet.balance));
        if (location.hash) { try { var t2 = document.querySelector(location.hash === '#gifts' ? '#items' : location.hash); if (t2 && t2.scrollIntoView) t2.scrollIntoView(); } catch (e3) { /* odd hash */ } }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/* ==========================================================================
   SUPERIOR MEMBERSHIP (Free / Superior plans, rewards, Youth Safety Commitment)
   Needs supabase-membership.sql, supabase-membership-cosmetics.sql, supabase-membership-rewards.sql
   ========================================================================== */
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
