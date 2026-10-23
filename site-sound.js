/* ==========================================================================
   SPECSOFT® site-sound.js  -  tiny synthesized UI sounds, default OFF

   No audio files — every sound is a couple milliseconds of an oscillator
   with a short gain envelope, so there's nothing to host or load. Off by
   default (autoplay rules mean nothing plays before a click anyway, but
   more importantly: a site minors use shouldn't make noise without asking
   first). A visitor turns it on from the speaker toggle in the HUD bar,
   and that choice is remembered in localStorage.

   Other scripts call window.SpecSound.play('hover' | 'click' | 'open' | 'close')
   and this quietly no-ops if sound is off, unsupported, or anything errors.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecSound) return;

    var KEY = 'specsoft-sound';
    var enabled = false;
    try { enabled = localStorage.getItem(KEY) === 'on'; } catch (e) {}

    var ctx = null;
    function audioCtx() {
        if (ctx) return ctx;
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        } catch (e) { ctx = null; }
        return ctx;
    }

    var RECIPES = {
        hover: { freq: 950, to: 950, dur: 0.035, gain: 0.03, type: 'sine' },
        click: { freq: 520, to: 300, dur: 0.07, gain: 0.05, type: 'square' },
        open: { freq: 300, to: 760, dur: 0.12, gain: 0.05, type: 'sine' },
        close: { freq: 600, to: 220, dur: 0.1, gain: 0.05, type: 'sine' }
    };

    function play(name) {
        if (!enabled) return;
        var c = audioCtx();
        if (!c) return;
        var r = RECIPES[name];
        if (!r) return;
        try {
            if (c.state === 'suspended') c.resume();
            var osc = c.createOscillator();
            var gain = c.createGain();
            osc.type = r.type;
            var t0 = c.currentTime;
            osc.frequency.setValueAtTime(r.freq, t0);
            osc.frequency.exponentialRampToValueAtTime(Math.max(40, r.to), t0 + r.dur);
            gain.gain.setValueAtTime(r.gain, t0);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + r.dur);
            osc.connect(gain);
            gain.connect(c.destination);
            osc.start(t0);
            osc.stop(t0 + r.dur + 0.02);
        } catch (e) {}
    }

    function setEnabled(v) {
        enabled = v;
        try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch (e) {}
        paintToggles();
        if (v) play('click');
    }

    /* ---- the HUD toggle button (mounted wherever the notification bell/
       terminal trigger live, same visual language) ---- */
    var toggles = [];
    function iconFor(on) {
        var span = document.createElement('span');
        span.innerHTML = on
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 7 9 11 5 11 19 7 15 3 15 3 9"></polygon><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18 6a8.5 8.5 0 0 1 0 12"></path></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 7 9 11 5 11 19 7 15 3 15 3 9"></polygon><line x1="16" y1="9" x2="21" y2="14"></line><line x1="21" y1="9" x2="16" y2="14"></line></svg>';
        return span.firstChild;
    }
    function paintToggles() {
        toggles.forEach(function (btn) {
            btn.innerHTML = '';
            btn.appendChild(iconFor(enabled));
            btn.setAttribute('aria-label', enabled ? 'Mute sound' : 'Unmute sound');
            btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        });
    }
    function mountToggle() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'st-trigger';
        btn.addEventListener('click', function () { setEnabled(!enabled); });
        toggles.push(btn);

        var hudRight = document.querySelector('.hud-bar .hud-right');
        if (hudRight) hudRight.insertBefore(btn, hudRight.firstChild);

        paintToggles();
    }

    /* ---- wire a light, non-spammy set of hover/click sounds ---- */
    function wireInteractions() {
        var clickSel = '.btn-primary, .btn-secondary, .sn-bell, .st-trigger, .faq-q';
        document.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest(clickSel)) play('click');
        });

        var hoverSel = '.fx-rail-item, .sidebar a, .mobile-header a';
        var lastHover = 0;
        document.addEventListener('mouseover', function (e) {
            if (!e.target.closest || !e.target.closest(hoverSel)) return;
            var now = Date.now();
            if (now - lastHover < 120) return;
            lastHover = now;
            play('hover');
        });
    }

    function start() {
        mountToggle();
        wireInteractions();
    }

    window.SpecSound = { play: play, setEnabled: setEnabled, isEnabled: function () { return enabled; } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
