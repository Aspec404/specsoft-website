/* ==========================================================================
   SPECSOFT® freemium.js v2  -  free rewards + streak
   Drop it into ANY page (store, profile...):
       <script src="freemium.js" defer></script>
       <div data-freemium></div>                 <- the "Free rewards" card shows up here
       <span data-freemium-badge hidden></span>  <- (optional) any element: shown while a reward is ready
   Needs supabase-config.js, supabase-store-freemium.sql AND supabase-store-freemium-v2.sql.

   Flow:  1) your guaranteed rewards (NO ad yet)
          2) pick 1 of 3 face-down 3D cards, press "Select this one" to lock it in
          3) press "Claim"  ->  the ad plays (with the safety notice)
          4) the ad is done ->  everything is paid out, streak goes up
   The SERVER keeps the cooldown and the streak, rolls the cards, checks the ad ran and grants everything.
   This file only draws what the server answers.

   Streak: a counter like [🔥 13]. +1 per claim made within 12h of the last claim, warning from 11h, reset at 12h.
   Shields [🛡️ 2]: earned every 7 streak, used automatically if a claim comes within the grace time after a miss.

   Public API (window.SpecFreemium)
     open() / refresh() / status() / streak()
     setAdProvider(fn)   later: fn(container, seconds) -> Promise that resolves when the real ad finished
     onReward(fn)        fn({balance, xp}) after credits / XP changed
   A window event "freemium:reward" is fired too, with {balance, xp} as event.detail.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecFreemium) return;

    var CFG = window.SPECSOFT_CONFIG || {};
    var sb = null, uid = null, status = null, readyAt = 0, streakEndAt = 0, streakWarnAt = 0;
    var tickTimer = null, overlay = null, busy = false, flow = null, streakAsked = false;
    var listeners = [];

    function client() {
        if (sb) return sb;
        try {
            sb = window.getSupabaseClient ? window.getSupabaseClient()
                : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
        } catch (e) { sb = null; }
        return sb;
    }

    /* ------------------------------ tiny helpers ------------------------------ */
    function el(tag, props) {
        var n = document.createElement(tag);
        if (props) Object.keys(props).forEach(function (k) {
            var v = props[k];
            if (v == null || v === false) return;
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k === 'html') n.innerHTML = v;                       // only used with our own static svg strings
            else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v === true ? '' : v);
        });
        for (var i = 2; i < arguments.length; i++) {
            var c = arguments[i];
            if (c == null || c === false) continue;
            if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
            else n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return n;
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function fmtLeft(sec) {
        sec = Math.max(0, Math.floor(sec));
        var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s);
    }
    function fmtMin(min) {
        min = Number(min) || 0;
        if (min >= 1440 && min % 1440 === 0) return (min / 1440) + (min === 1440 ? ' day' : ' days');
        if (min >= 60 && min % 60 === 0) return (min / 60) + 'h';
        if (min > 60) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
        return min + ' min';
    }
    function fmtHours(h) { return fmtMin(Math.round((Number(h) || 0) * 60)); }
    function num(n) { return Number(n || 0).toLocaleString('en-US'); }
    function boostName(kind) { return kind === 'xp' ? 'XP' : 'Credit'; }

    var ERR = {
        not_signed_in: 'Log in to claim free rewards.',
        not_ready: 'Your next free reward is not ready yet.',
        pending_offer: 'You still have rewards waiting for you.',
        ad_not_watched: 'The ad did not finish. Please try again.',
        freemium_off: 'Free rewards are paused right now.',
        offer_missing: 'That offer is gone. Refresh and try again.',
        already_picked: 'You already claimed this reward.',
        already_selected: 'You already locked in a card for this reward.',
        not_selected: 'Select a card first.',
        offer_expired: 'That offer expired.',
        bad_card: 'That card is not valid.'
    };
    function friendly(e) {
        var m = String((e && (e.message || e.error)) || e || '');
        var hit = Object.keys(ERR).filter(function (k) { return m.indexOf(k) >= 0; })[0];
        if (hit) return ERR[hit];
        if (/freemium_(status|offer|select|begin|claim)/.test(m) && /function|schema|find/i.test(m)) return 'Free rewards are not set up yet (run supabase-store-freemium-v2.sql).';
        return 'Something went wrong. Please try again.';
    }

    /* ------------------------------ icons (own, inline) ------------------------------ */
    var ICON = {
        gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M12 8c-1.5-3-5-3.5-5-1.5S10 8 12 8zm0 0c1.5-3 5-3.5 5-1.5S14 8 12 8z"/></svg>',
        coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.7 2.5-1.7" stroke-linecap="round"/></svg>',
        bolt: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
        boost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c3 2 5 5 5 9l-2 4H9l-2-4c0-4 2-7 5-9z"/><circle cx="12" cy="10" r="1.6"/><path d="M9 16l-2 4M15 16l2 4"/></svg>',
        star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>',
        reticle: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="14" stroke-dasharray="2 4"/><path d="M32 4v9M32 51v9M4 32h9M51 32h9"/><path d="M32 23l9 9-9 9-9-9z"/></svg>'
    };

    var RARITY_COLOR = { common: '#9ca3af', uncommon: '#e5e7eb', rare: '#3b9cff', epic: '#a66bff', legendary: '#facc15', legacy: '#ff7a1a', mythic: '#ef2b3a' };
    function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

    /* ------------------------------ styles ------------------------------ */
    (function injectStyles() {
        if (document.getElementById('fr-styles')) return;
        var BR = 'content:"";position:absolute;width:12px;height:12px;border:1px solid var(--accent,#fff);pointer-events:none;transition:opacity .3s ease;';
        var css = [
            /* ---------- the card on the page ---------- */
            '.fr-widget{position:relative;display:flex;align-items:center;gap:14px;padding:20px 18px 20px 26px;border-radius:12px;border:1px solid var(--border-subtle,#202020);background:var(--bg-card,#080808);color:var(--text-primary,#f5f5f5);font-family:var(--font-sans,inherit);overflow:hidden;transition:border-color .3s ease,box-shadow .3s ease}',
            '.fr-widget::before{' + BR + 'top:8px;left:8px;border-right:0;border-bottom:0;opacity:.35}',
            '.fr-widget::after{' + BR + 'bottom:8px;right:8px;border-left:0;border-top:0;opacity:.35}',
            '.fr-widget.is-ready{border-color:var(--border-hover,#404040);box-shadow:0 0 30px var(--accent-glow,rgba(255,255,255,.1)),inset 0 0 24px var(--accent-dim,rgba(255,255,255,.05))}',
            '.fr-widget.is-ready::before,.fr-widget.is-ready::after{opacity:.9}',
            '.fr-widget.is-warn{border-color:#fbbf24}',
            '.fr-w-ico{flex:0 0 auto;display:grid;place-items:center;width:46px;height:46px;border-radius:10px;border:1px solid var(--border-hover,#404040);background:var(--accent-dim,rgba(255,255,255,.05));color:var(--text-primary,#f5f5f5);transition:all .3s ease}',
            '.fr-w-ico svg{width:23px;height:23px}',
            '.fr-widget.is-ready .fr-w-ico{background:var(--text-primary,#f5f5f5);color:var(--bg-base,#030303);animation:frWiggle 2.8s ease-in-out infinite}',
            '.fr-w-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}',
            '.fr-w-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
            '.fr-w-top strong{font-size:15px;font-weight:600}',
            '.fr-w-txt small{font-family:var(--font-mono,monospace);font-size:11.5px;line-height:1.45;color:var(--text-secondary,#999);font-variant-numeric:tabular-nums}',
            '.fr-widget.is-warn .fr-w-txt small{color:#fbbf24}',
            '.fr-streak{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--border-hover,#404040);font-family:var(--font-mono,monospace);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--text-primary,#f5f5f5);white-space:nowrap}',
            '.fr-streak[hidden]{display:none}',
            '.fr-streak.is-off{opacity:.5}',
            '.fr-streak.is-warn{border-color:#fbbf24;color:#fbbf24;animation:frWarn 1.4s ease-in-out infinite}',
            '.fr-shield.is-on{border-color:#38bdf8;color:#38bdf8}',
            '@keyframes frWarn{0%,100%{box-shadow:0 0 0 0 rgba(251,191,36,.45)}50%{box-shadow:0 0 0 5px rgba(251,191,36,0)}}',
            '@keyframes frWiggle{0%,86%,100%{transform:rotate(0)}90%{transform:rotate(-9deg)}94%{transform:rotate(8deg)}97%{transform:rotate(-4deg)}}',

            /* ---------- buttons (same family as .btn-primary / .btn-secondary) ---------- */
            '.fr-btn{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:10px;flex:0 0 auto;min-height:44px;padding:0 24px;border-radius:8px;cursor:pointer;font-family:var(--font-mono,monospace);font-size:12px;font-weight:600;white-space:nowrap;max-width:100%;color:var(--text-primary,#f5f5f5);background:transparent;border:1px solid var(--border-hover,#404040);transition:all .3s ease}',
            '.fr-btn:hover:not(:disabled){border-color:var(--accent,#fff);box-shadow:0 0 30px var(--accent-glow,rgba(255,255,255,.1)),inset 0 0 20px var(--accent-dim,rgba(255,255,255,.05))}',
            '.fr-btn:active:not(:disabled){transform:scale(.97)}',
            '.fr-btn:focus-visible{outline:2px solid var(--accent,#fff);outline-offset:3px}',
            '.fr-btn:disabled{opacity:.4;cursor:not-allowed}',
            '.fr-btn--go{background:var(--text-primary,#f5f5f5);color:var(--bg-base,#030303);border-color:var(--text-primary,#f5f5f5)}',
            '.fr-btn--go::before{content:"";position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,var(--accent-glow,rgba(255,255,255,.2)),transparent);transition:left .5s ease}',
            '.fr-btn--go:hover:not(:disabled)::before{left:100%}',
            '.fr-btn--go:hover:not(:disabled){background:transparent;color:var(--text-primary,#f5f5f5)}',
            '.fr-btn--wide{width:100%;min-height:50px;font-size:13px}',

            /* ---------- the claim screen ---------- */
            '.fr-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(2,2,2,.86);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:frFade .25s ease;overscroll-behavior:contain}',
            '@keyframes frFade{from{opacity:0}to{opacity:1}}',
            '.fr-panel{position:relative;width:min(580px,100%);max-height:calc(100dvh - 32px);overflow:auto;border-radius:16px;padding:26px 22px 22px;color:var(--text-primary,#f5f5f5);text-align:center;font-family:var(--font-sans,inherit);border:1px solid var(--border-hover,#404040);background-color:var(--bg-card,#080808);background-image:linear-gradient(var(--grid-line,rgba(255,255,255,.025)) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line,rgba(255,255,255,.025)) 1px,transparent 1px);background-size:32px 32px;box-shadow:0 30px 90px -30px #000}',
            '.fr-panel::before{' + BR + 'top:10px;left:10px;border-right:0;border-bottom:0;opacity:.7}',
            '.fr-panel::after{' + BR + 'bottom:10px;right:10px;border-left:0;border-top:0;opacity:.7}',
            '.fr-x{position:absolute;top:12px;right:14px;z-index:3;width:34px;height:34px;border-radius:8px;border:1px solid var(--border-subtle,#202020);background:var(--bg-card,#080808);color:inherit;font-size:19px;line-height:1;cursor:pointer;transition:border-color .2s ease}',
            '.fr-x:hover{border-color:var(--border-hover,#404040)}',
            '.fr-h{margin:0 0 6px;font-size:22px;font-weight:600;letter-spacing:-.3px}',
            '.fr-sub{margin:0 auto 18px;max-width:46ch;font-size:13.5px;line-height:1.5;color:var(--text-secondary,#999)}',
            '.fr-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}',

            /* the three stages: rewards, card, claim (a real sequence) */
            '.fr-steps{display:flex;gap:8px;margin:0 auto 22px;max-width:360px}',
            '.fr-step{flex:1;text-align:left;font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--text-tertiary,#4a4a4a);transition:color .3s ease}',
            '.fr-step i{display:block;height:2px;margin-bottom:7px;border-radius:2px;background:var(--border-subtle,#202020);transition:background .3s ease}',
            '.fr-step.is-done{color:var(--text-secondary,#999)} .fr-step.is-done i{background:var(--accent-strong,rgba(255,255,255,.35))}',
            '.fr-step.is-on{color:var(--text-primary,#f5f5f5)} .fr-step.is-on i{background:var(--accent,#fff)}',

            /* guaranteed rewards */
            '.fr-gl{display:grid;gap:10px;margin:0 0 16px}',
            '.fr-g{display:flex;align-items:center;gap:14px;padding:13px 16px;border-radius:10px;text-align:left;border:1px solid var(--border-subtle,#202020);border-left:2px solid var(--c,#fff);background:var(--bg-card,#080808);opacity:0;transform:translateX(-12px);animation:frIn .5s cubic-bezier(.2,.9,.3,1) forwards}',
            '.fr-g svg{flex:0 0 auto;width:26px;height:26px;color:var(--c,#fff)}',
            '.fr-g b{display:block;font-size:17px;font-weight:600} .fr-g small{display:block;margin-top:2px;font-family:var(--font-mono,monospace);font-size:11px;color:var(--text-secondary,#999)}',
            '.fr-g--credits{--c:#facc15} .fr-g--xp{--c:#38bdf8} .fr-g--boost{--c:#a66bff}',
            '.fr-g--card{background:color-mix(in srgb,var(--c) 9%,var(--bg-card,#080808))}',
            '@keyframes frIn{to{opacity:1;transform:none}}',

            /* notices */
            '.fr-note{margin:0 0 16px;padding:13px 15px;border-radius:10px;text-align:left;border:1px dashed var(--border-hover,#404040);background:var(--accent-dim,rgba(255,255,255,.05))}',
            '.fr-note strong{display:block;margin-bottom:5px;font-size:13.5px;font-weight:600}',
            '.fr-note p{margin:0 0 6px;font-size:12.5px;line-height:1.55;color:var(--text-secondary,#999)} .fr-note p:last-child{margin:0}',
            '.fr-warn{margin:0 0 16px;padding:14px 16px;border-radius:10px;text-align:left;border:1px solid rgba(251,191,36,.55);background:rgba(251,191,36,.07)}',
            '.fr-warn strong{display:block;margin-bottom:6px;font-size:14px;font-weight:600}',
            '.fr-warn p{margin:0 0 8px;font-size:12.5px;line-height:1.55;color:var(--text-secondary,#999)}',
            '.fr-warn ul{margin:0 0 10px;padding-left:18px;font-size:12.5px;line-height:1.6;color:var(--text-primary,#f5f5f5)}',
            '.fr-warn p:last-child{margin:0}',

            /* placeholder ad */
            '.fr-ad{position:relative;display:grid;place-items:center;gap:8px;min-height:170px;margin:0 0 12px;border-radius:12px;border:1px dashed var(--border-hover,#404040);overflow:hidden;background:repeating-linear-gradient(135deg,var(--accent-dim,rgba(255,255,255,.05)) 0 10px,transparent 10px 20px)}',
            '.fr-ad b{font-family:var(--font-mono,monospace);font-size:11px;letter-spacing:.14em;color:var(--text-secondary,#999)}',
            '.fr-ad span{font-size:14px}',
            '.fr-bar{height:4px;border-radius:99px;background:var(--border-subtle,#202020);overflow:hidden;margin:0 0 14px}',
            '.fr-bar i{display:block;height:100%;width:0;border-radius:99px;background:var(--accent,#fff);transition:width .25s linear}',

            /* ---------- the 3D cards ---------- */
            '.fr-stage{display:flex;justify-content:center;gap:clamp(10px,3vw,20px);margin:6px 0 18px;padding-top:16px;perspective:1100px}',
            '.fr-card{position:relative;width:clamp(94px,27vw,150px);aspect-ratio:3/4.3;border:0;padding:0;background:none;cursor:pointer;font:inherit;color:inherit;animation:frFloat 3.6s ease-in-out infinite alternate;animation-delay:calc(var(--i) * -1.2s);-webkit-tap-highlight-color:transparent;transition:opacity .35s ease,filter .35s ease}',
            '.fr-card:focus-visible{outline:2px solid var(--accent,#fff);outline-offset:8px;border-radius:14px}',
            '@keyframes frFloat{from{transform:translateY(-6px)}to{transform:translateY(6px)}}',
            '.fr-lift{position:absolute;inset:0;transition:transform .4s cubic-bezier(.2,.9,.3,1.2)}',
            '.fr-card.is-sel .fr-lift{transform:translateY(-14px) scale(1.08)}',
            '.fr-tilt{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));transition:transform .12s ease-out}',
            '.fr-card.is-reset .fr-tilt{transition:transform .5s cubic-bezier(.2,.8,.2,1)}',
            '.fr-flip{position:absolute;inset:0;transform-style:preserve-3d;transition:transform .85s cubic-bezier(.2,.8,.2,1)}',
            '.fr-card.is-flipped .fr-flip{transform:rotateY(180deg)}',
            '.fr-face{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:7px;padding:10px 8px;border-radius:12px;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;box-shadow:0 20px 34px -18px #000}',
            /* back: black glass with a fine grid, a spinning reticle and a foil sheen that follows the pointer */
            '.fr-back{color:#f5f5f5;background:radial-gradient(circle at var(--mx,50%) var(--my,30%),rgba(255,255,255,.2),transparent 48%),repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 10px),repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0 1px,transparent 1px 10px),#050505;border:1px solid rgba(255,255,255,.3);transition:border-color .3s ease,box-shadow .3s ease}',
            '.fr-back::before,.fr-back::after{content:"";position:absolute;width:14px;height:14px;border:1px solid rgba(255,255,255,.8)}',
            '.fr-back::before{top:8px;left:8px;border-right:0;border-bottom:0}',
            '.fr-back::after{bottom:8px;right:8px;border-left:0;border-top:0}',
            '.fr-back svg{position:relative;width:52%;height:auto;animation:frSpin 26s linear infinite;filter:drop-shadow(0 0 8px rgba(255,255,255,.55))}',
            '@keyframes frSpin{to{transform:rotate(360deg)}}',
            '.fr-back small{position:absolute;bottom:11px;left:0;right:0;text-align:center;font-family:var(--font-mono,monospace);font-size:9.5px;letter-spacing:.12em;opacity:.55}',
            '.fr-card.is-sel .fr-back{border-color:#fff;box-shadow:0 0 0 1px #fff,0 0 36px -4px rgba(255,255,255,.55),0 20px 34px -18px #000}',
            '.fr-stage.has-sel .fr-card:not(.is-sel){opacity:.4;filter:grayscale(1)}',
            /* front: rarity colour */
            '.fr-front{transform:rotateY(180deg);--c:#a66bff;background:radial-gradient(circle at var(--mx,50%) var(--my,20%),color-mix(in srgb,var(--c) 30%,transparent),transparent 55%),linear-gradient(165deg,color-mix(in srgb,var(--c) 26%,#0a0a0a),#060606 72%);border:1.5px solid var(--c);box-shadow:0 0 30px -6px var(--c),0 20px 34px -18px #000;color:#fff}',
            '.fr-front::before,.fr-front::after{content:"";position:absolute;width:12px;height:12px;border:1px solid var(--c);opacity:.9}',
            '.fr-front::before{top:7px;left:7px;border-right:0;border-bottom:0}',
            '.fr-front::after{bottom:7px;right:7px;border-left:0;border-top:0}',
            '.fr-front .fr-big{font-size:clamp(20px,6vw,28px);font-weight:700;line-height:1.1;color:var(--c);text-shadow:0 0 18px color-mix(in srgb,var(--c) 70%,transparent)}',
            '.fr-front .fr-lbl{font-size:11.5px;line-height:1.3;color:#e5e7eb;opacity:.92;word-break:break-word;padding:0 6px}',
            '.fr-front .fr-rar{font-family:var(--font-mono,monospace);font-size:9.5px;letter-spacing:.14em;color:var(--c)}',
            '.fr-front .fr-ico{width:30px;height:30px;color:var(--c)} .fr-front .fr-ico svg{width:100%;height:100%}',
            '.fr-front .fr-prev{display:flex;align-items:center;justify-content:center;max-width:100%;overflow:hidden;font-size:13px}',
            '.fr-front .fr-prev .spt{margin-left:0}',
            '.fr-avatar{position:relative;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#475569,#1e293b)}',
            '.fr-emo{width:56px;height:56px;object-fit:contain;filter:drop-shadow(0 0 10px color-mix(in srgb,var(--c) 60%,transparent))}',
            '.fr-card--mini .fr-emo{width:34px;height:34px}',
            '.fr-shine{position:absolute;inset:0;border-radius:12px;pointer-events:none;background:radial-gradient(circle at var(--mx,50%) var(--my,0%),rgba(255,255,255,.38),transparent 42%);mix-blend-mode:overlay;opacity:0;transition:opacity .2s ease}',
            '.fr-card:hover .fr-shine,.fr-card.is-touch .fr-shine,.fr-card.is-sel .fr-shine{opacity:1}',
            '.fr-card.is-won .fr-front{animation:frWin 1.1s ease-out}',
            '@keyframes frWin{0%{box-shadow:0 0 0 0 var(--c)}50%{box-shadow:0 0 64px 8px var(--c)}100%{box-shadow:0 0 30px -6px var(--c),0 20px 34px -18px #000}}',
            '.fr-card.is-locked{cursor:default}',
            '.fr-card--mini{width:clamp(70px,20vw,100px);animation:none;cursor:default;pointer-events:none}',
            '.fr-card--mini .fr-big{font-size:17px} .fr-card--mini .fr-lbl{font-size:9.5px} .fr-card--mini .fr-rar{display:none}',
            '.fr-card--mini.is-dim{opacity:.55;filter:saturate(.6)}',
            '.fr-hint{min-height:18px;margin:0 0 14px;font-family:var(--font-mono,monospace);font-size:11.5px;color:var(--text-secondary,#999)}',
            '.fr-confetti{position:absolute;left:50%;top:44%;width:0;height:0;pointer-events:none;z-index:4}',
            '.fr-confetti i{position:absolute;width:6px;height:11px;border-radius:2px;background:var(--c);animation:frConf 1.2s cubic-bezier(.1,.8,.3,1) forwards;opacity:0}',
            '@keyframes frConf{0%{opacity:1;transform:translate(0,0) rotate(0)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--rot))}}',

            /* results: streak + missed cards */
            '.fr-streakbox{display:flex;align-items:center;gap:14px;margin:0 0 16px;padding:14px 16px;border-radius:10px;text-align:left;border:1px solid var(--border-hover,#404040);background:var(--accent-dim,rgba(255,255,255,.05))}',
            '.fr-streakbox .fr-sn{flex:0 0 auto;font-family:var(--font-mono,monospace);font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;animation:frPop .6s cubic-bezier(.2,.9,.3,1.4)}',
            '.fr-streakbox p{margin:0;font-size:12.5px;line-height:1.5;color:var(--text-secondary,#999)} .fr-streakbox p b{color:var(--text-primary,#f5f5f5)}',
            '@keyframes frPop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}',
            '.fr-missed{margin:0 0 6px;font-family:var(--font-mono,monospace);font-size:10.5px;color:var(--text-tertiary,#4a4a4a)}',
            '.fr-minis{display:flex;justify-content:center;gap:10px;margin:0 0 18px;perspective:900px}',

            '@media (max-width:420px){.fr-panel{padding:22px 14px 16px}.fr-ad{min-height:130px}.fr-widget{flex-wrap:wrap;padding:20px 16px 16px 24px}.fr-widget .fr-btn{width:100%}}',
            '@media (prefers-reduced-motion:reduce){.fr-card,.fr-back svg,.fr-widget.is-ready .fr-w-ico,.fr-front,.fr-confetti i,.fr-streak.is-warn,.fr-streakbox .fr-sn{animation:none!important}.fr-flip,.fr-tilt,.fr-lift{transition:none}.fr-g{animation:none;opacity:1;transform:none}}'
        ].join('\n');
        var st = document.createElement('style');
        st.id = 'fr-styles';
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    })();

    /* ------------------------------ status + the card on the page ------------------------------ */
    function emitReward(r) {
        var d = { balance: r && r.balance, xp: r && r.xp };
        try { window.dispatchEvent(new CustomEvent('freemium:reward', { detail: d })); } catch (e) { /* old browser */ }
        listeners.slice().forEach(function (fn) { try { fn(d); } catch (e) { /* a listener failed */ } });
        if (r && r.xp && window.SpecXP && window.SpecXP.set) { try { window.SpecXP.set(r.xp); } catch (e) { /* ignore */ } }
    }

    function streakInfo() {
        if (!status) return { n: 0, left: 0, warn: false, lost: false };
        var n = Number(status.streak) || 0, now = Date.now();
        var left = n > 0 ? Math.max(0, Math.ceil((streakEndAt - now) / 1000)) : 0;
        return { n: n, left: left, warn: n > 0 && left > 0 && now >= streakWarnAt, lost: !!status.streak_lost && n === 0 };
    }

    function paintWidgets() {
        var ready = !!(status && status.ready && Date.now() >= readyAt - 50);
        var pending = !!(status && status.pending_offer);
        var sk = streakInfo();
        document.querySelectorAll('[data-freemium-badge]').forEach(function (b) { b.hidden = !(ready || pending); });
        document.querySelectorAll('[data-freemium]').forEach(function (box) {
            var w = box.querySelector('.fr-widget');
            if (!w) {
                w = el('div', { class: 'fr-widget' },
                    el('div', { class: 'fr-w-ico', html: ICON.gift }),
                    el('div', { class: 'fr-w-txt' },
                        el('div', { class: 'fr-w-top' }, el('strong', { text: 'Free rewards' }), el('span', { class: 'fr-streak', 'aria-label': 'Streak' }), el('span', { class: 'fr-streak fr-shield', 'aria-label': 'Streak shields' })),
                        el('small', { text: '' })),
                    el('button', { type: 'button', class: 'fr-btn fr-btn--go', text: 'Claim' }));
                w.querySelector('button').addEventListener('click', function () { open(); });
                box.appendChild(w);
            }
            var line = w.querySelector('small'), btn = w.querySelector('button'), chip = w.querySelector('.fr-streak');
            var left = status ? Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)) : 0;
            var warn = !!(uid && status && sk.warn);
            w.classList.toggle('is-ready', ready || pending);
            w.classList.toggle('is-warn', warn);
            chip.hidden = !(uid && status);
            chip.textContent = '\uD83D\uDD25 ' + sk.n;
            chip.classList.toggle('is-off', sk.n === 0);
            chip.classList.toggle('is-warn', warn);
            chip.title = status && status.best_streak ? 'Best streak: ' + status.best_streak : 'Claim again before the streak runs out';
            var shChip = w.querySelector('.fr-shield'), shN = status ? Number(status.shields) || 0 : 0;
            shChip.hidden = !(uid && status && Number(status.shield_max) > 0);
            shChip.textContent = '\uD83D\uDEE1\uFE0F ' + shN;
            shChip.classList.toggle('is-on', shN > 0);
            shChip.classList.toggle('is-off', shN === 0);
            shChip.title = 'Streak shields (' + shN + '/' + (status ? status.shield_max : 0) + '): one is used automatically if you miss a claim window. You earn one every ' + (status ? status.shield_every : 0) + ' streak.';
            if (!uid) { line.textContent = 'Log in to claim free rewards'; btn.textContent = 'Log in'; btn.disabled = true; }
            else if (!status) { line.textContent = 'Checking...'; btn.textContent = 'Claim'; btn.disabled = true; }
            else if (!status.enabled) { line.textContent = 'Paused for now'; btn.textContent = 'Claim'; btn.disabled = true; }
            else if (pending) { line.textContent = 'You have rewards waiting for you'; btn.textContent = 'Continue'; btn.disabled = false; }
            else if (left > 0) { line.textContent = 'Next reward in ' + fmtLeft(left) + (sk.n > 0 ? ' \u00b7 streak safe' : ''); btn.textContent = 'Claim'; btn.disabled = true; }
            else if (warn && status.shield_saving) { line.textContent = '\uD83D\uDEE1\uFE0F You missed the window. Claim within ' + fmtLeft(sk.left) + ' and a shield saves your streak.'; btn.textContent = 'Claim'; btn.disabled = false; }
            else if (warn) { line.textContent = '\u26A0\uFE0F Your streak ends in ' + fmtLeft(sk.left) + '. Claim now to keep it.' + (Number(status.shields) > 0 ? ' A shield is your backup.' : ''); btn.textContent = 'Claim'; btn.disabled = false; }
            else if (sk.lost) { line.textContent = 'Your streak was reset. Claim to start a new one.'; btn.textContent = 'Claim'; btn.disabled = false; }
            else if (sk.n > 0) { line.textContent = 'Ready! Claim to keep your streak going.'; btn.textContent = 'Claim'; btn.disabled = false; }
            else { line.textContent = 'Ready! Claim your free rewards.'; btn.textContent = 'Claim'; btn.disabled = false; }
        });
    }

    function refresh() {
        var c = client();
        if (!c || !uid) { status = null; paintWidgets(); return Promise.resolve(null); }
        return Promise.resolve(c.rpc('freemium_status')).then(function (r) {
            if (r.error) throw r.error;
            status = r.data;
            var now = Date.now();
            readyAt = now + (Number(status.seconds_left) || 0) * 1000;
            var sl = Number(status.streak_seconds_left) || 0;
            streakEndAt = sl > 0 ? now + sl * 1000 : 0;
            var gap = Math.max(0, (Number(status.streak_reset_hours) - Number(status.streak_warn_hours)) * 3600);
            streakWarnAt = status.shield_saving ? 1 : (streakEndAt ? streakEndAt - gap * 1000 : 0);
            streakAsked = false;
            paintWidgets();
            return status;
        }).catch(function () { status = null; paintWidgets(); return null; });
    }

    function tick() {
        if (!status) { paintWidgets(); return; }
        paintWidgets();
        // the cooldown or the streak just ran out: ask the server again so what the page shows is real
        var now = Date.now();
        if (!overlay && !streakAsked && status.enabled && ((!status.ready && !status.pending_offer && now >= readyAt) || (Number(status.streak) > 0 && now >= streakEndAt))) {
            streakAsked = true;
            refresh();
        }
    }

    /* ------------------------------ the claim screen ------------------------------ */
    var adProvider = null;

    function placeholderAd(box, seconds) {
        // stand-in for a real ad: a labelled box and a countdown. setAdProvider() swaps it for a real one later.
        return new Promise(function (resolve) {
            var left = Math.max(0, seconds);
            var bar = el('i'), txt = el('span', { text: left > 0 ? 'Your reward unlocks in ' + left + 's' : 'Loading your reward...' });
            box.appendChild(el('div', { class: 'fr-ad' }, el('b', { text: 'ADVERTISEMENT' }), el('span', { text: 'Ad placeholder' }), txt));
            box.appendChild(el('div', { class: 'fr-bar' }, bar));
            var t0 = Date.now(), total = Math.max(1, seconds) * 1000;
            var iv = setInterval(function () {
                var el_ = Date.now() - t0, pct = Math.min(100, (el_ / total) * 100);
                bar.style.width = pct + '%';
                left = Math.max(0, Math.ceil((total - el_) / 1000));
                txt.textContent = left > 0 ? 'Your reward unlocks in ' + left + 's' : 'Loading your reward...';
                if (el_ >= total) { clearInterval(iv); resolve(); }
            }, 200);
            if (overlay) overlay._stop = function () { clearInterval(iv); };
        });
    }

    function closeOverlay() {
        if (overlay) { if (overlay._stop) overlay._stop(); overlay.remove(); overlay = null; }
        document.removeEventListener('keydown', onKey);
        document.documentElement.style.overflow = '';
        busy = false; flow = null;
        refresh();
    }
    function onKey(e) { if (e.key === 'Escape' && overlay && !overlay._lock) closeOverlay(); }

    function openShell() {
        if (overlay) return null;
        var body = el('div', { class: 'fr-body' });
        var x = el('button', { type: 'button', class: 'fr-x', 'aria-label': 'Close', text: '\u00d7', onclick: function () { if (!overlay._lock) closeOverlay(); } });
        var panel = el('div', { class: 'fr-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Free rewards' }, x, body);
        overlay = el('div', { class: 'fr-overlay' }, panel);
        overlay.addEventListener('pointerdown', function (e) { if (e.target === overlay && !overlay._lock) closeOverlay(); });
        document.body.appendChild(overlay);
        document.documentElement.style.overflow = 'hidden';
        document.addEventListener('keydown', onKey);
        return body;
    }

    function stepsBar(active) {
        var names = ['Rewards', 'Card', 'Claim'];
        return el('div', { class: 'fr-steps', 'aria-label': 'Step ' + (active + 1) + ' of 3' }, names.map(function (n, i) {
            return el('div', { class: 'fr-step' + (i < active ? ' is-done' : i === active ? ' is-on' : '') }, el('i'), n);
        }));
    }

    function fail(body, err, retry) {
        if (!overlay) return;
        overlay._lock = false;
        body.textContent = '';
        body.appendChild(el('h2', { class: 'fr-h', text: 'Something went wrong' }));
        body.appendChild(el('p', { class: 'fr-sub', text: friendly(err) }));
        body.appendChild(el('div', { class: 'fr-row' },
            retry ? el('button', { type: 'button', class: 'fr-btn fr-btn--go', text: 'Try again', onclick: retry }) : null,
            el('button', { type: 'button', class: retry ? 'fr-btn' : 'fr-btn fr-btn--go', text: 'Close', onclick: closeOverlay })));
    }

    function open() {
        var c = client();
        if (!c || !uid || busy || overlay) return;
        var body = openShell();
        if (!body) return;
        busy = true;
        refresh().then(function (s) {
            if (!s) return fail(body, 'freemium_status function');
            if (!s.pending_offer && !s.ready) return fail(body, 'not_ready');
            // step 1 has NO ad: the server hands us the guaranteed rewards and 3 hidden cards
            return Promise.resolve(c.rpc('freemium_offer')).then(function (r) {
                if (r.error) throw r.error;
                flow = r.data;
                flow.sel = flow.selected;
                if (flow.selected != null) showCards(body);
                else if (flow.guaranteed) showGuaranteed(body);
                else showCards(body);
            });
        }).catch(function (e) { fail(body, e); });
    }

    /* ---- step 1: guaranteed rewards ---- */
    function guaranteedRows(g, delay0) {
        var b = g.booster || {};
        var rows = [
            { cls: 'credits', ico: ICON.coin, big: '+' + num(g.credits) + ' Credits', small: 'APEX Credits for your wallet' },
            { cls: 'xp', ico: ICON.bolt, big: '+' + num(g.xp) + ' XP', small: 'Added to your level' },
            b.kind ? {
                cls: 'boost', ico: ICON.boost,
                big: b.tier + 'x ' + boostName(b.kind) + ' booster',
                small: b.converted ? 'A stronger one is running, so you got +' + num(b.amount) + ' ' + boostName(b.kind) + 's instead' : fmtMin(b.minutes) + ' of online time'
            } : null
        ].filter(Boolean);
        var list = el('div', { class: 'fr-gl' });
        rows.forEach(function (r, i) {
            var n = el('div', { class: 'fr-g fr-g--' + r.cls }, el('span', { html: r.ico }), el('div', null, el('b', { text: r.big }), el('small', { text: r.small })));
            n.style.animationDelay = (delay0 + i * 0.22) + 's';
            list.appendChild(n);
        });
        return { list: list, count: rows.length };
    }

    function supportNote() {
        return el('div', { class: 'fr-note' },
            el('strong', { text: 'Support SPECSOFT' }),
            el('p', { text: 'This page directly helps fund the development and maintenance of free content on SPECSOFT.' }),
            el('p', { text: 'Reward claims are limited to one account per user, in accordance with our platform rules.' }),
            el('p', { text: 'Thank you for supporting SPECSOFT!' }));
    }

    function showGuaranteed(body) {
        body.textContent = '';
        body.appendChild(stepsBar(0));
        body.appendChild(el('h2', { class: 'fr-h', text: 'Your guaranteed rewards' }));
        body.appendChild(el('p', { class: 'fr-sub', text: 'These are yours for sure. Next you pick a random bonus card, then claim everything together.' }));
        body.appendChild(guaranteedRows(flow.guaranteed, 0.1).list);
        body.appendChild(supportNote());
        body.appendChild(el('div', { class: 'fr-row' }, el('button', { type: 'button', class: 'fr-btn fr-btn--go fr-btn--wide', text: 'Continue to card pick', onclick: function () { showCards(body); } })));
    }

    /* ---- step 2: the 3 face-down cards ---- */
    function frontOf(card) {
        var k = card.kind, c = '#a66bff', ico = '', big = '', lbl = '', prev = null, rar = '';
        if (k === 'credits') { c = '#facc15'; ico = ICON.coin; big = '+' + num(card.amount); lbl = 'APEX Credits'; }
        else if (k === 'xp') { c = '#38bdf8'; ico = ICON.bolt; big = '+' + num(card.amount); lbl = 'XP'; }
        else if (k === 'booster') { c = card.boost === 'xp' ? '#38bdf8' : '#facc15'; ico = ICON.boost; big = card.tier + 'x'; lbl = boostName(card.boost) + ' booster \u00b7 ' + fmtMin(card.minutes); }
        else if (k === 'title') {
            c = RARITY_COLOR[card.rarity] || '#a66bff'; ico = ICON.star; lbl = 'Title \u00b7 ' + card.name; rar = cap(card.rarity).toUpperCase();
            if (window.SpecTitles && card.data) { prev = el('div', { class: 'fr-prev' }); try { window.SpecTitles.apply(prev, card.data); } catch (e) { prev = null; } }
        } else if (k === 'frame') {
            c = RARITY_COLOR[card.rarity] || '#a66bff'; ico = ICON.star; lbl = 'Frame \u00b7 ' + card.name; rar = cap(card.rarity).toUpperCase();
            var av = el('div', { class: 'fr-avatar' });
            if (window.SpecFrames && card.data) { try { window.SpecFrames.apply(av, card.data); } catch (e) { /* plain avatar */ } }
            prev = el('div', { class: 'fr-prev' }, av);
        }
        if (k === 'emote') {
            c = RARITY_COLOR[card.rarity] || '#a66bff'; ico = ICON.star; lbl = 'Emote \u00b7 :' + (card.emote_name || card.name) + ':'; rar = cap(card.rarity).toUpperCase();
            if (card.image_url) prev = el('div', { class: 'fr-prev' }, el('img', { class: 'fr-emo', src: card.image_url, alt: card.name || 'Emote', draggable: 'false' }));
        }
        var face = el('div', { class: 'fr-face fr-front' });
        face.style.setProperty('--c', c);
        if (rar) face.appendChild(el('div', { class: 'fr-rar', text: rar }));
        if (prev) face.appendChild(prev);
        else face.appendChild(el('div', { class: 'fr-ico', html: ico }));
        if (big) face.appendChild(el('div', { class: 'fr-big', text: big }));
        face.appendChild(el('div', { class: 'fr-lbl', text: lbl }));
        return { face: face, color: c };
    }

    function whatCard(card) {
        card = card || {};
        return card.kind === 'credits' ? '+' + num(card.amount) + ' Credits'
            : card.kind === 'xp' ? '+' + num(card.amount) + ' XP'
            : card.kind === 'booster' ? card.tier + 'x ' + boostName(card.boost) + ' booster (' + fmtMin(card.minutes) + ')'
            : card.kind === 'title' ? 'Title: ' + card.name
            : card.kind === 'frame' ? 'Frame: ' + card.name
            : card.kind === 'emote' ? 'Emote: :' + (card.emote_name || card.name) + ':' : 'A reward';
    }

    function confetti(card, color) {
        var host = el('div', { class: 'fr-confetti' });
        host.style.setProperty('--c', color);
        for (var i = 0; i < 18; i++) {
            var p = el('i'), a = (Math.PI * 2 * i) / 18 + Math.random() * 0.4, d = 70 + Math.random() * 90;
            p.style.setProperty('--dx', Math.cos(a) * d + 'px');
            p.style.setProperty('--dy', Math.sin(a) * d - 20 + 'px');
            p.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
            p.style.animationDelay = Math.random() * 0.12 + 's';
            host.appendChild(p);
        }
        card.appendChild(host);
        setTimeout(function () { host.remove(); }, 1500);
    }

    function wireTilt(card) {
        function move(e) {
            var r = card.getBoundingClientRect();
            var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
            card.classList.remove('is-reset');
            card.style.setProperty('--ry', ((px - 0.5) * 28).toFixed(1) + 'deg');
            card.style.setProperty('--rx', ((0.5 - py) * 24).toFixed(1) + 'deg');
            card.style.setProperty('--mx', (px * 100).toFixed(0) + '%');
            card.style.setProperty('--my', (py * 100).toFixed(0) + '%');
        }
        function reset() {
            card.classList.add('is-reset'); card.classList.remove('is-touch');
            card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg');
        }
        card.addEventListener('pointermove', move);
        card.addEventListener('pointerdown', function (e) { card.classList.add('is-touch'); move(e); });
        card.addEventListener('pointerleave', reset);
        card.addEventListener('pointerup', function () { setTimeout(reset, 350); });
        card.addEventListener('pointercancel', reset);
    }

    function buildCard(idx, mini) {
        var back = el('div', { class: 'fr-face fr-back' }, el('span', { html: ICON.reticle, style: 'display:contents' }), el('small', { text: 'SPECSOFT\u00ae' }));
        var flip = el('div', { class: 'fr-flip' }, back);
        var tilt = el('div', { class: 'fr-tilt' }, flip, el('div', { class: 'fr-shine' }));
        var lift = el('div', { class: 'fr-lift' }, tilt);
        var card = el(mini ? 'div' : 'button', mini ? { class: 'fr-card fr-card--mini' } : { type: 'button', class: 'fr-card', 'aria-label': 'Card ' + (idx + 1) + ', face down. Press to choose it.' }, lift);
        card.style.setProperty('--i', String(idx));
        card._flip = flip;
        if (!mini) wireTilt(card);
        return card;
    }

    function revealOn(card, data, withConfetti) {
        var f = frontOf(data || { kind: 'credits', amount: 0 });
        card._flip.appendChild(f.face);
        card._color = f.color;
        card.classList.add('is-flipped');
        if (withConfetti && data && (data.kind === 'title' || data.kind === 'frame' || data.kind === 'emote' || data.kind === 'booster')) confetti(card, f.color);
    }

    function showCards(body) {
        overlay._lock = false;
        body.textContent = '';
        body.appendChild(stepsBar(1));
        body.appendChild(el('h2', { class: 'fr-h', text: 'Pick your random reward' }));
        var sub = el('p', { class: 'fr-sub', text: 'One bonus is hiding behind each card. Choose one, then lock it in.' });
        body.appendChild(sub);
        var stage = el('div', { class: 'fr-stage' });
        var cards = [], locked = false, sel = null;
        var hint = el('p', { class: 'fr-hint', text: 'Tap a card' });
        var action = el('div', { class: 'fr-row' });

        var selectBtn = el('button', { type: 'button', class: 'fr-btn fr-btn--go fr-btn--wide', text: 'Select this one', disabled: true });
        var claimBtn = el('button', { type: 'button', class: 'fr-btn fr-btn--go fr-btn--wide', text: 'Claim rewards' });

        for (var i = 0; i < 3; i++) (function (idx) {
            var card = buildCard(idx, false);
            card.addEventListener('click', function () { choose(idx); });
            cards.push(card);
            stage.appendChild(card);
        })(i);
        body.appendChild(stage);
        body.appendChild(hint);
        body.appendChild(action);

        function choose(idx) {
            if (locked) return;
            sel = idx;
            stage.classList.add('has-sel');
            cards.forEach(function (c, i) { c.classList.toggle('is-sel', i === idx); c.setAttribute('aria-pressed', String(i === idx)); });
            hint.textContent = 'Card ' + (idx + 1) + ' chosen. Not locked in yet.';
            selectBtn.disabled = false;
        }

        function lockIn(card) {
            locked = true;
            cards.forEach(function (c) { c.disabled = true; c.classList.add('is-locked'); });
            stage.classList.add('has-sel');
            cards.forEach(function (c, i) { c.classList.toggle('is-sel', i === flow.sel); });
            if (card) { cards[flow.sel].classList.add('is-won'); revealOn(cards[flow.sel], card, true); }
            sub.textContent = 'Locked in. Press claim to collect everything. A short ad plays first.';
            hint.textContent = 'Your pick: ' + whatCard(card);
            action.textContent = '';
            action.appendChild(claimBtn);
            claimBtn.focus();
        }

        selectBtn.addEventListener('click', function () {
            if (sel == null || locked) return;
            selectBtn.disabled = true; selectBtn.textContent = 'Locking in...';
            overlay._lock = true;
            Promise.resolve(client().rpc('freemium_select', { p_offer: flow.offer_id, p_idx: sel })).then(function (r) {
                if (r.error) throw r.error;
                overlay._lock = false;
                flow.sel = r.data.selected; flow.card = r.data.card;
                lockIn(r.data.card);
            }).catch(function (e) { fail(body, e); });
        });
        claimBtn.addEventListener('click', function () { runAd(body); });

        if (flow.sel != null && flow.card) { sel = flow.sel; lockIn(flow.card); }
        else action.appendChild(selectBtn);
    }

    /* ---- step 3 + 4: claim -> ad (with the safety notice) -> payout ---- */
    function safetyNotice() {
        return el('div', { class: 'fr-warn', role: 'note' },
            el('strong', { text: '\u26A0\uFE0F Stay Safe While Watching Ads' }),
            el('p', { text: 'Be cautious of suspicious, misleading, or potentially fraudulent advertisements while watching Freemium Rewards ads.' }),
            el('ul', null,
                el('li', { text: 'Avoid clicking suspicious links.' }),
                el('li', { text: 'Never share passwords or sensitive personal information.' }),
                el('li', { text: 'Don\u2019t download unfamiliar files or applications advertised to you.' }),
                el('li', { text: 'Report suspicious advertisements if you encounter them.' })),
            el('p', { text: 'SPECSOFT encourages users to stay safe while browsing third-party advertisements.' }));
    }

    function runAd(body) {
        overlay._lock = true;                                    // no closing by accident while the ad runs
        body.textContent = '';
        body.appendChild(stepsBar(2));
        body.appendChild(el('h2', { class: 'fr-h', text: 'Almost there' }));
        body.appendChild(el('p', { class: 'fr-sub', text: 'Watch this short ad. Your rewards are added as soon as it ends.' }));
        body.appendChild(safetyNotice());
        Promise.resolve(client().rpc('freemium_begin', { p_offer: flow.offer_id })).then(function (r) {
            if (r.error) throw r.error;
            var secs = Number(r.data && r.data.ad_seconds) || 0;
            var host = el('div');
            body.appendChild(host);
            return Promise.resolve(adProvider ? adProvider(host, secs) : placeholderAd(host, secs));
        }).then(function () { return doClaim(body); })
          .catch(function (e) { fail(body, e); });
    }

    function doClaim(body) {
        return Promise.resolve(client().rpc('freemium_claim', { p_offer: flow.offer_id })).then(function (r) {
            if (r.error) throw r.error;
            if (!overlay) return;
            overlay._lock = false;
            emitReward(r.data);
            streakAsked = false;
            showDone(body, r.data);
        }).catch(function (e) {
            // the ad already ran, so offer a retry of just the claim
            fail(body, e, /ad_not_watched|not_selected|offer_missing|already_picked|offer_expired/.test(String(e && e.message)) ? null : function () { body.textContent = ''; doClaim(body); });
        });
    }

    /* ---- done: everything paid out, streak shown ---- */
    function showDone(body, d) {
        body.textContent = '';
        var all = d.cards || [], won = all[d.picked] || {}, res = d.result || {};
        body.appendChild(el('h2', { class: 'fr-h', text: 'Rewards claimed' }));
        body.appendChild(el('p', { class: 'fr-sub', text: 'Everything has been added to your account.' }));

        var list = el('div', { class: 'fr-gl' });
        var delay = 0.05;
        if (d.guaranteed) {
            var gr = guaranteedRows({ credits: d.guaranteed.credits, xp: d.guaranteed.xp, booster: d.guaranteed.booster }, delay);
            list = gr.list; delay += gr.count * 0.22;
        }
        var wf = frontOf(won);
        var note = res.converted ? ' (you already had it, so it was paid out as +' + num(res.amount) + ')' : '';
        var cardRow = el('div', { class: 'fr-g fr-g--card' }, el('span', { html: ICON.star }), el('div', null, el('b', { text: whatCard(won) }), el('small', { text: 'Your bonus card' + note })));
        cardRow.style.setProperty('--c', wf.color);
        cardRow.style.animationDelay = delay + 's';
        list.appendChild(cardRow);
        body.appendChild(list);

        var sk = d.streak || {};
        var msg;
        if (sk.shield_used) msg = el('p', null, el('b', { text: '\uD83D\uDEE1\uFE0F A shield saved your streak!' }), ' You missed the window, so one shield was used. Claim again in ', el('b', { text: fmtHours(sk.cooldown_hours) }), ' to keep going.');
        else if (sk.was_reset) msg = el('p', null, 'Your old streak ended, so a fresh one starts now. Claim again in ', el('b', { text: fmtHours(sk.cooldown_hours) }), ' to build it up.');
        else if (sk.value > 1) msg = el('p', null, el('b', { text: 'Streak up!' }), ' Claim again in ', el('b', { text: fmtHours(sk.cooldown_hours) }), ' to keep it going. You get a warning at ', fmtHours(sk.warn_hours), ' and it resets at ', fmtHours(sk.reset_hours), ' without a claim.');
        else msg = el('p', null, el('b', { text: 'Streak started!' }), ' Claim again in ', el('b', { text: fmtHours(sk.cooldown_hours) }), ' to grow it. It resets after ', fmtHours(sk.reset_hours), ' without a claim.');
        var col = el('div', null, msg);
        if (sk.shield_earned) col.appendChild(el('p', { style: 'margin-top:6px' }, el('b', { text: '\uD83D\uDEE1\uFE0F +1 shield earned!' }), ' You have ' + sk.shields + '/' + sk.shield_max + '. A shield saves your streak if you miss the window.'));
        else if (sk.shield_max > 0 && sk.shield_every > 0) col.appendChild(el('p', { style: 'margin-top:6px' }, '\uD83D\uDEE1\uFE0F ' + sk.shields + '/' + sk.shield_max + ' shields. ' + (sk.shields >= sk.shield_max ? 'Shields are full.' : 'Next one at streak ' + ((Math.floor(sk.value / sk.shield_every) + 1) * sk.shield_every) + '.')));
        body.appendChild(el('div', { class: 'fr-streakbox' }, el('div', { class: 'fr-sn', text: '\uD83D\uDD25 ' + (sk.value || 0) }), col));

        if (all.length === 3) {
            body.appendChild(el('p', { class: 'fr-missed', text: 'The other cards hid:' }));
            var minis = el('div', { class: 'fr-minis' });
            all.forEach(function (c, i) {
                var m = buildCard(i, true);
                revealOn(m, c, false);
                if (i !== d.picked) m.classList.add('is-dim');
                minis.appendChild(m);
            });
            body.appendChild(minis);
        }
        body.appendChild(el('div', { class: 'fr-row' }, el('button', { type: 'button', class: 'fr-btn fr-btn--go fr-btn--wide', text: 'Done', onclick: closeOverlay })));
    }

    /* ------------------------------ boot ------------------------------ */
    function boot() {
        var c = client();
        paintWidgets();
        if (!c || !c.auth) return;
        function set(user) {
            var id = user ? user.id : null;
            if (id === uid) return;
            uid = id;
            status = null;
            paintWidgets();
            if (uid) refresh();
        }
        c.auth.getSession().then(function (s) { set(s && s.data && s.data.session && s.data.session.user); }).catch(function () { /* ignore */ });
        if (c.auth.onAuthStateChange) c.auth.onAuthStateChange(function (ev, session) { set(session && session.user); });
        tickTimer = setInterval(tick, 1000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden && uid && !overlay) refresh(); });
    }

    window.SpecFreemium = {
        open: open,
        refresh: refresh,
        status: function () { return status; },
        streak: function () { return streakInfo(); },
        setAdProvider: function (fn) { adProvider = typeof fn === 'function' ? fn : null; },
        onReward: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
