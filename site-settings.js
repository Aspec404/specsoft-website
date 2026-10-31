/* ==========================================================================
   SPECSOFT® site-settings.js  -  site-wide user settings (every page)

   HOW IT WORKS
   - Settings live in localStorage ("specsoft.settings.v1") so they apply
     instantly on every page, and sync to Supabase (table user_settings)
     when the visitor is logged in, so they follow the account.
   - Older keys keep working: theme ("specsoft-theme"), UI sounds
     ("specsoft-sound") and the chat prefs ("specsoft.chat.*") are read and
     written in place, so nothing you or your members already chose resets.
   - Settings are PREFERENCES ONLY. Bans, roles and admin stay enforced by
     Supabase, never by anything in here.

   ADDING A NEW SETTING LATER
   1. Add one line to CATS below (tg = toggle, sl = select).
   2. Toggle that only hides/shows CSS? Give it  cls:'ss-no-thing'  and add
      a rule in site-settings.css:  .ss-no-thing .thing { display:none }
   3. JS feature? Read it with  SpecSettings.get('key')  or, in a file that
      loads before this one, check localStorage JSON like site-fx.js does.
   4. If it can't switch live, add  reload:true  (the page shows a
      "Reload to apply" bar).
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecSettings) return;

    var KEY = 'specsoft.settings.v1';
    var AT = 'specsoft.settings.at';
    var DOC = document.documentElement;

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function readStore() {
        try { var o = JSON.parse(lsGet(KEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
        catch (e) { return {}; }
    }
    function writeStore(o) { lsSet(KEY, JSON.stringify(o)); }

    /* ---------------------------------------------------------------- schema */
    function tg(key, label, desc, def, x) { return Object.assign({ key: key, type: 'toggle', label: label, desc: desc, def: def }, x || {}); }
    function sl(key, label, desc, def, options, x) { return Object.assign({ key: key, type: 'select', label: label, desc: desc, def: def, options: options }, x || {}); }
    function rg(key, label, desc, def, min, max, step, unit, x) { return Object.assign({ key: key, type: 'range', label: label, desc: desc, def: def, min: min, max: max, step: step, unit: unit || '' }, x || {}); }
    function tx(key, label, desc, def, max, placeholder, x) { return Object.assign({ key: key, type: 'text', label: label, desc: desc, def: def, max: max, placeholder: placeholder || '' }, x || {}); }
    function pal(key, label, desc, def, options, x) { return Object.assign({ key: key, type: 'palette', label: label, desc: desc, def: def, options: options }, x || {}); }
    // select / palette options are [value, label, premium?, hex?]. premium ones are locked until
    // window.SpecShop.owns('<settingKey>:<value>') returns true (the shop plugs in here later).

    function themeMode() { return readStore().theme === 'system' ? 'system' : (lsGet('specsoft-theme') === 'light' ? 'light' : 'dark'); }
    function themeWrite(v) {
        var s = readStore();
        if (v === 'system') s.theme = 'system'; else { delete s.theme; lsSet('specsoft-theme', v); }
        writeStore(s);
    }
    function notifRead() {
        try { return lsGet('specsoft.chat.notif') !== 'off' && 'Notification' in window && Notification.permission === 'granted'; }
        catch (e) { return false; }
    }
    function notifWrite(v) { lsSet('specsoft.chat.notif', v ? 'on' : 'off'); }
    function notifAfter(v) {
        if (!v || !('Notification' in window) || Notification.permission !== 'default') return;
        try { Notification.requestPermission().then(function () { emit('chatNotif'); }); } catch (e) { /* ignore */ }
    }

    var CATS = [
        { id: 'general', title: 'General', blurb: 'Time, date and region.',
          icon: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
          items: [
            sl('timeFormat', 'Time format', 'How times look in chats and across the site.', 'auto',
               [['auto', 'Automatic (your device)'], ['12h', '12-hour (1:00 PM)'], ['24h', '24-hour (13:00)']]),
            sl('dateFormat', 'Date format', 'Which comes first, the month or the day.', 'auto',
               [['auto', 'Automatic (your device)'], ['mdy', 'Month first (Oct 29)'], ['dmy', 'Day first (29 Oct)']]),
            sl('timezone', 'Time zone', 'Show times in another time zone. Automatic follows your device.', 'auto',
               [['auto', 'Automatic (your device)'], ['UTC', 'UTC'], ['Asia/Manila', 'Philippines (Manila)'], ['Asia/Tokyo', 'Japan (Tokyo)'],
                ['Asia/Seoul', 'Korea (Seoul)'], ['Asia/Shanghai', 'China (Shanghai)'], ['Asia/Singapore', 'Singapore'], ['Asia/Dubai', 'UAE (Dubai)'],
                ['Europe/Moscow', 'Russia (Moscow)'], ['Europe/Berlin', 'Germany (Berlin)'], ['Europe/Madrid', 'Spain (Madrid)'], ['Europe/London', 'UK (London)'],
                ['America/Sao_Paulo', 'Brazil (Sao Paulo)'], ['America/Mexico_City', 'Mexico (Mexico City)'], ['America/New_York', 'US Eastern (New York)'],
                ['America/Chicago', 'US Central (Chicago)'], ['America/Denver', 'US Mountain (Denver)'], ['America/Los_Angeles', 'US Pacific (Los Angeles)'],
                ['Australia/Sydney', 'Australia (Sydney)']]),
            { key: 'g_preview', type: 'readout', label: 'Preview', desc: 'This is how the current time looks with your choices.' }
          ] },
        { id: 'appearance', title: 'Appearance', blurb: 'How the site looks.',
          icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
          items: [
            sl('theme', 'Theme', 'Dark, light, or follow your device.', 'dark', [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match my device']], { read: themeMode, write: themeWrite }),
            sl('accent', 'Accent color', 'Tints highlights, borders and buttons. The default keeps the black and white look.', 'default',
               [['default', 'White / black (default)'], ['blue', 'Blue'], ['green', 'Green'], ['purple', 'Purple'], ['red', 'Red'], ['amber', 'Amber']]),
            tg('reduceMotion', 'Reduce motion', 'Calms animations and turns off the motion-heavy effects. Your device setting is respected too. This one is per device.', false, { cls: 'ss-reduce-motion', clsOn: true, reload: true, local: true }),
            tg('autoReduceMotion', 'Auto reduce motion when lag', 'If your page drops to 10 FPS or below, low detail mode switches on by itself so the site stays usable.', true)
          ] },
        { id: 'effects', title: 'Effects', blurb: 'The HUD and motion layers. Turn off anything that feels heavy.',
          icon: '<polygon points="12 2 15 9 22 9.5 16.5 14 18 21 12 17.5 6 21 7.5 14 2 9.5 9 9"/>',
          items: [
            tg('fxScanlines', 'Scanlines', 'The faint horizontal lines and the scanning bar.', true, { cls: 'ss-no-scanlines' }),
            tg('fxVignette', 'Screen vignette', 'Darkened edges of the screen.', true, { cls: 'ss-no-vignette' }),
            tg('fxGlow', 'Ambient glow', 'Soft background lights and the grid glow.', true, { cls: 'ss-no-glow' }),
            tg('fxShapes', 'Floating shapes', 'The rings, triangles and dot grid in the background.', true, { cls: 'ss-no-shapes' }),
            tg('fxCrosshairs', 'HUD corner crosshairs', 'The corner marks on every page.', true, { cls: 'ss-no-crosshairs' }),
            tg('fx3d', '3D background', 'The WebGL background. Turning it off also saves battery.', true, { cls: 'ss-no-3d', reload: true }),
            tg('fxHover', 'Hover effects', 'Card tilt and glare, magnetic buttons and the radar glow.', true, { reload: true }),
            tg('fxReveal', 'Scroll animations', 'Sections fading in as you scroll, plus the pulsing lines.', true, { reload: true }),
            tg('transitions', 'Page transitions', 'The fade and scan sweep between pages.', true),
            tg('intro', 'Intro animation', 'Play the SPECSOFT intro when you open the site.', true)
          ] },
        { id: 'cursor', title: 'Cursor', blurb: 'Design your own cursor. Only you see it.',
          icon: '<polygon points="5 3 19 12 12 13 9 20 5 3"/>',
          items: [
            tg('cursor', 'Custom cursor', 'Use the SPECSOFT cursor instead of your system one. Mouse and trackpad only.', true, { reload: true }),
            { key: 'c_pad', type: 'pad', group: 'Try it', label: 'Practice pad', desc: 'Hover, click, type, drag and hold on these to see every cursor state.' },
            { key: 'c_presets', type: 'presets', group: 'Presets', label: 'Presets', desc: 'One-tap looks, then tweak anything. Locked looks are preview only until you own them.' },
            sl('cursorDot', 'Dot shape', 'The small dot that sits right on your pointer.', 'circle', [['circle', 'Circle'], ['square', 'Square'], ['diamond', 'Diamond'], ['none', 'Hidden']], { group: 'Pointer' }),
            rg('cursorDotSize', 'Dot size', 'How big the dot is.', 6, 3, 14, 1, 'px'),
            sl('cursorRing', 'Ring shape', 'The ring that follows behind the dot.', 'circle', [['circle', 'Circle'], ['rounded', 'Rounded square'], ['square', 'Square'], ['diamond', 'Diamond'], ['none', 'Hidden']], { group: 'Ring' }),
            rg('cursorRingSize', 'Ring size', 'How big the ring is.', 40, 28, 72, 2, 'px'),
            tg('cursorSpin', 'Spinning ring', 'Slowly rotates the ring.', true),
            tg('cursorTicks', 'Crosshair ticks', 'The four small tick marks on the ring.', true),
            tg('cursorCross', 'Full crosshair lines', 'Faint lines across the whole screen that cross at your pointer.', false, { group: 'Crosshair' }),
            sl('cursorFollow', 'Ring follow speed', 'Snappy sticks to the dot, floaty drifts behind it.', 'normal', [['snappy', 'Snappy'], ['normal', 'Normal'], ['floaty', 'Floaty']], { group: 'Movement' }),
            pal('cursorColor', 'Color', 'Theme follows dark and light mode. Locked colors are preview only.', 'default',
                [['default', 'Theme', false, null], ['blue', 'Blue', false, '#3b82f6'], ['green', 'Green', false, '#22c55e'], ['purple', 'Purple', false, '#8b5cf6'],
                 ['red', 'Red', false, '#ef4444'], ['amber', 'Amber', false, '#f59e0b'], ['pink', 'Pink', true, '#ec4899'], ['cyan', 'Cyan', true, '#06b6d4'], ['gold', 'Gold', true, '#eab308']], { group: 'Color' }),
            sl('cursorTrail', 'Trail', 'What follows behind your pointer when you move.', 'classic', [['off', 'Off'], ['classic', 'Classic'], ['thin', 'Thin line'], ['dots', 'Dots'], ['glow', 'Glow', true]], { group: 'Trail' }),
            sl('cursorTrailLen', 'Trail length', 'How long the trail lingers.', 'normal', [['short', 'Short'], ['normal', 'Normal'], ['long', 'Long']]),
            sl('cursorClick', 'Click effect', 'What happens when you click.', 'both', [['both', 'Ripple + shapes'], ['ripple', 'Ripple'], ['burst', 'Shapes'], ['sparks', 'Sparks', true], ['none', 'None']], { group: 'Clicks' }),
            tg('cursorMagnet', 'Magnetic buttons', 'The ring snaps onto buttons and links.', true, { group: 'Behavior' }),
            tg('cursorLabels', 'Cursor labels', 'Tiny tags like VIEW or DRAG next to the pointer.', true),
            tg('cursorStretch', 'Speed stretch', 'The dot stretches when you move fast.', true),
            tg('cursorCharge', 'Hold to charge', 'Hold the mouse down and a ring fills up.', true),
            sl('tapFx', 'Tap effect', 'What happens where you tap. Phones and tablets only.', 'none', [['none', 'None'], ['ripple', 'Ripple'], ['burst', 'Shapes'], ['both', 'Ripple + shapes'], ['sparks', 'Sparks', true]], { group: 'Touch screens' }),
            sl('tapTrail', 'Finger trail', 'A line that follows your finger while you drag.', 'off', [['off', 'Off'], ['thin', 'Thin line'], ['dots', 'Dots'], ['glow', 'Glow', true]]),
            tg('tapHold', 'Hold ring', 'Press and hold: a ring fills, then pops.', false),
            tg('tapVibrate', 'Tap vibration', 'A tiny buzz on tap. Android only, iPhones do not allow it.', false),
            { key: 'c_code', type: 'code', group: 'Share', label: 'Share code', desc: 'Copy your code to share your look, or paste a friend\u2019s code and press Apply.' },
            { key: 'a_resetcursor', type: 'action', action: 'resetCursor', label: 'Reset cursor', desc: 'Puts every cursor and touch option back to default.', button: 'Reset', danger: true }
          ] },
        { id: 'interface', title: 'Interface & Sound', blurb: 'The top bar tools and UI sounds.',
          icon: '<rect x="3" y="4" width="18" height="12" rx="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>',
          items: [
            tg('sound', 'UI sounds', 'Small clicks and hovers. Off by default.', false,
               { ls: { key: 'specsoft-sound', on: 'on', off: 'off' }, after: function (v) { if (window.SpecSound && window.SpecSound.isEnabled() !== v) window.SpecSound.setEnabled(v); } }),
            tg('terminal', 'Command terminal', 'The terminal button and the / shortcut.', true, { reload: true }),
            tg('presence', 'Online counter', 'The "online now" number in the top bar.', true, { reload: true })
          ] },
        { id: 'chats', title: 'Chats', blurb: 'How chats behave for you.',
          icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
          items: [
            tx('typingText', 'Custom typing indicator', 'What other people see while you type. Up to 50 characters. Type <@username> where your name should go. Leave it empty for the normal "is typing".', '', 50, '<@username> is cooking...'),
            sl('chatEnter', 'Sending messages', 'Choose which key sends a message on desktop. Phones always use the send button.', 'enter', [['enter', 'Enter sends (Shift+Enter for a new line)'], ['ctrl', 'Ctrl+Enter sends (Enter for a new line)']]),
            tg('chatSound', 'Chat sounds', 'A soft ping for new messages.', true, { ls: { key: 'specsoft.chat.sound', on: 'on', off: 'off' } }),
            tg('chatFilter', 'Hide sensitive messages', 'Covers harsh messages with a notice. Only you see the cover.', true, { ls: { key: 'specsoft.chat.filter', on: 'on', off: 'off' } }),
            tg('chatImg', 'Blur sensitive images', 'Checks images on your device and blurs the explicit ones.', true, { ls: { key: 'specsoft.chat.img', on: 'on', off: 'off' } }),
            tg('chatNotif', 'Desktop notifications', 'Your browser asks for permission the first time. This one is per device.', true, { read: notifRead, write: notifWrite, after: notifAfter, local: true })
          ] },
        { id: 'data', title: 'Data & Sync', blurb: 'Back up, move or reset your settings.',
          icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
          items: [
            { key: 'a_export', type: 'action', action: 'export', label: 'Export settings', desc: 'Download your settings as a JSON file.', button: 'Export' },
            { key: 'a_import', type: 'action', action: 'import', label: 'Import settings', desc: 'Load a settings file you exported before.', button: 'Import' },
            { key: 'a_reset', type: 'action', action: 'reset', label: 'Reset to defaults', desc: 'Puts every setting back to how it came.', button: 'Reset', danger: true }
          ] }
    ];

    var ITEMS = {}, LIST = [];
    CATS.forEach(function (c) { c.items.forEach(function (it) { ITEMS[it.key] = it; LIST.push(it); }); });

    /* ------------------------------------------------------------- get / set */
    var listeners = [];
    function emit(key, val) { listeners.forEach(function (fn) { try { fn(key, val); } catch (e) { /* ignore */ } }); }

    function ownedId(id) {
        try { return !!(window.SpecShop && typeof window.SpecShop.owns === 'function' && window.SpecShop.owns(id)); } catch (e) { return false; }
    }
    function optionOf(it, v) {
        if (!it.options) return null;
        for (var i = 0; i < it.options.length; i++) if (String(it.options[i][0]) === String(v)) return it.options[i];
        return null;
    }
    function isLocked(it, v) { var o = optionOf(it, v); return !!(o && o[2] && !ownedId(it.key + ':' + o[0])); }

    function coerce(it, v, ignoreLock) {
        if (it.type === 'toggle') return (v === true || v === false) ? v : (v === 'true' ? true : (v === 'false' ? false : undefined));
        if (it.type === 'select' || it.type === 'palette') {
            var o = optionOf(it, v);
            if (!o || (!ignoreLock && isLocked(it, o[0]))) return undefined;
            return o[0];
        }
        if (it.type === 'text') {
            if (typeof v !== 'string') return undefined;
            return v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '').slice(0, it.max || 50);
        }
        if (it.type === 'range') {
            var n = Number(v);
            if (!isFinite(n)) return undefined;
            n = Math.min(it.max, Math.max(it.min, n));
            var st = it.step || 1;
            return +(Math.round(n / st) * st).toFixed(4);
        }
        return undefined;
    }

    function get(key) {
        var it = ITEMS[key];
        if (!it || it.type === 'action') return undefined;
        if (it.read) return it.read();
        if (it.ls) { var v = lsGet(it.ls.key); return v === null ? it.def : v === it.ls.on; }
        var s = readStore();
        var cur = coerce(it, s[key]);
        return cur === undefined ? it.def : cur;
    }

    function set(key, val, o) {
        o = o || {};
        var it = ITEMS[key];
        if (!it || it.type === 'action') return false;
        var v = coerce(it, val);
        if (v === undefined) return false;
        delete preview[key];
        if (it.write) it.write(v);
        else if (it.ls) lsSet(it.ls.key, v ? it.ls.on : it.ls.off);
        else { var s = readStore(); s[key] = v; writeStore(s); }
        if (!o.noStamp) lsSet(AT, String(Date.now()));
        applyAll();
        emit(key, v);
        if (it.after) { try { it.after(v); } catch (e) { /* ignore */ } }
        if (!o.noPush) queuePush();
        return true;
    }

    function snapshot() {
        var out = {};
        LIST.forEach(function (it) { if (it.type !== 'action' && !it.local) out[it.key] = get(it.key); });
        return out;
    }

    /* ---------------------------------------------------------- time and date format
       Any page can call SpecSettings.fmtTime(date), fmtDate(date, opts) and dayKey(date).
       They follow Settings > General (time format, date format, time zone).        */
    var fmtCache = {};
    function localeList() { return undefined; }            // the Language setting will plug in here later
    function tzName() { var z = get('timezone'); return (z && z !== 'auto') ? z : undefined; }
    function dtf(locale, o) {
        var k = (locale || '') + '|' + JSON.stringify(o);
        if (!fmtCache[k]) {
            try { fmtCache[k] = new Intl.DateTimeFormat(locale, o); }
            catch (e) { var o2 = Object.assign({}, o); delete o2.timeZone; fmtCache[k] = new Intl.DateTimeFormat(undefined, o2); }
        }
        return fmtCache[k];
    }
    function withTz(o) { var z = tzName(); if (z) o.timeZone = z; return o; }
    function fmtTime(d) {
        var f = get('timeFormat'), o = { hour: 'numeric', minute: '2-digit' };
        if (f === '12h') o.hourCycle = 'h12'; else if (f === '24h') { o.hourCycle = 'h23'; o.hour = '2-digit'; }
        return dtf(localeList(), withTz(o)).format(d);
    }
    function fmtDate(d, opts) {
        var order = get('dateFormat'), loc = order === 'mdy' ? 'en-US' : (order === 'dmy' ? 'en-GB' : localeList());
        return dtf(loc, withTz(Object.assign({}, opts))).format(d);
    }
    function dayKey(d) { return dtf('en-CA', withTz({ year: 'numeric', month: '2-digit', day: '2-digit' })).format(d); }

    /* ---------------------------------------------------------- cursor extras */
    var preview = {};                 // unsaved "try it" values (locked styles); cursor.js reads window.__ssPreview
    window.__ssPreview = preview;

    var CURSOR_KEYS = ['cursorDot', 'cursorDotSize', 'cursorRing', 'cursorRingSize', 'cursorSpin', 'cursorTicks', 'cursorCross', 'cursorFollow',
        'cursorColor', 'cursorTrail', 'cursorTrailLen', 'cursorClick', 'cursorMagnet', 'cursorLabels', 'cursorStretch', 'cursorCharge'];
    var TAP_KEYS = ['tapFx', 'tapTrail', 'tapHold', 'tapVibrate'];
    var SHARE_KEYS = CURSOR_KEYS.concat(TAP_KEYS);
    var CURSOR_DEFAULTS = {};
    CURSOR_KEYS.forEach(function (k) { CURSOR_DEFAULTS[k] = ITEMS[k].def; });

    function preset(id, name, desc, over) { return { id: id, name: name, desc: desc, map: Object.assign({}, CURSOR_DEFAULTS, over) }; }
    var PRESETS = [
        preset('classic', 'Classic', 'The original SPECSOFT cursor.', {}),
        preset('minimal', 'Minimal', 'Just a dot. Light on weak PCs.', { cursorRing: 'none', cursorTrail: 'off', cursorClick: 'ripple', cursorStretch: false, cursorCharge: false, cursorDotSize: 7 }),
        preset('crosshair', 'Crosshair', 'Lines across the screen, sniper style.', { cursorDot: 'square', cursorDotSize: 4, cursorRing: 'square', cursorRingSize: 34, cursorSpin: false, cursorCross: true, cursorTrail: 'off', cursorClick: 'ripple' }),
        preset('terminal', 'Terminal', 'Green blocks and dotted trail.', { cursorDot: 'square', cursorDotSize: 8, cursorRing: 'square', cursorRingSize: 30, cursorSpin: false, cursorTicks: false, cursorTrail: 'dots', cursorClick: 'burst', cursorColor: 'green', cursorFollow: 'snappy', cursorStretch: false }),
        preset('neon', 'Neon', 'Cyan glow, sparks and a long trail.', { cursorColor: 'cyan', cursorTrail: 'glow', cursorTrailLen: 'long', cursorClick: 'sparks', cursorRing: 'rounded', cursorFollow: 'floaty' }),
        preset('royal', 'Royal', 'Gold diamonds with a glowing trail.', { cursorColor: 'gold', cursorDot: 'diamond', cursorRing: 'diamond', cursorRingSize: 44, cursorTrail: 'glow', cursorClick: 'sparks' })
    ];

    function view(key) { return Object.prototype.hasOwnProperty.call(preview, key) ? preview[key] : get(key); }
    function setPreview(key, val) {
        var it = ITEMS[key], v = (it && it.type !== 'action') ? coerce(it, val, true) : undefined;
        if (v === undefined) return false;
        preview[key] = v;
        refreshLive(); emit('__preview');
        return true;
    }
    function clearPreview() {
        Object.keys(preview).forEach(function (k) { delete preview[k]; });
        refreshLive(); emit('__preview');
    }
    function previewing() { return Object.keys(preview); }

    // free parts are saved, locked parts are only previewed (and lost on reload)
    function applyPreset(map) {
        var applied = 0, locked = 0;
        Object.keys(preview).forEach(function (k) { delete preview[k]; });
        Object.keys(map).forEach(function (k) {
            var it = ITEMS[k];
            if (!it || it.type === 'action') return;
            var free = coerce(it, map[k]);
            if (free !== undefined) { if (set(k, free, { noPush: true })) applied++; }
            else {
                var raw = coerce(it, map[k], true);
                if (raw !== undefined) { preview[k] = raw; locked++; }
            }
        });
        if (applied) queuePush();
        refreshLive(); emit('__preview');
        return { applied: applied, locked: locked };
    }
    function resetCursor() {
        Object.keys(preview).forEach(function (k) { delete preview[k]; });
        SHARE_KEYS.forEach(function (k) { set(k, ITEMS[k].def, { noPush: true }); });
        queuePush(); refreshLive(); emit('__preview');
    }

    function b64(s) {
        var bytes = new TextEncoder().encode(s), bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function unb64(s) {
        s = s.replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        var bin = atob(s), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }
    function exportCursorCode() {
        var o = {};
        SHARE_KEYS.forEach(function (k) { o[k] = view(k); });
        return 'SPEC1-' + b64(JSON.stringify(o));
    }
    function importCursorCode(code) {
        code = String(code || '').trim();
        if (code.indexOf('SPEC1-') !== 0 || code.length > 1500) return null;
        var o;
        try { o = JSON.parse(unb64(code.slice(6))); } catch (e) { return null; }
        if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
        var map = {};
        SHARE_KEYS.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(o, k)) map[k] = o[k]; });
        return applyPreset(map);
    }

    function applyColor() {
        var it = ITEMS.cursorColor, o = it && optionOf(it, view('cursorColor'));
        if (o && o[3]) DOC.style.setProperty('--sc-color', o[3]); else DOC.style.removeProperty('--sc-color');
    }
    // phone tap effects live in their own file, loaded only when a touch option is on
    // (and on the settings page, so the preview works with a mouse)
    function ensureTouch() {
        if (window.SpecTouch || document.querySelector('script[src^="site-touch.js"]')) return;
        var on = view('tapFx') !== 'none' || view('tapTrail') !== 'off' || view('tapHold') === true || view('tapVibrate') === true;
        var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        var onSettings = /settings(\.html)?$/.test(location.pathname);
        if (!(on && coarse) && !onSettings) return;
        if (!document.head) return;
        var s = document.createElement('script');
        s.src = 'site-touch.js';
        document.head.appendChild(s);
    }
    function refreshLive() {
        applyColor();
        try { if (window.SCCursor && window.SCCursor.refresh) window.SCCursor.refresh(); } catch (e) { /* ignore */ }
        try { if (window.SpecTouch && window.SpecTouch.refresh) window.SpecTouch.refresh(); } catch (e) { /* ignore */ }
        ensureTouch();
    }

    /* ----------------------------------------------------------------- apply */
    function resolveTheme() {
        var m = themeMode();
        if (m !== 'system') return m;
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    function applyTheme() {
        var t = resolveTheme();
        if (themeMode() === 'system') lsSet('specsoft-theme', t);
        if (!document.body) return;
        document.body.classList.toggle('light-mode', t === 'light');
        var label = document.getElementById('themeLabel');
        if (label) label.textContent = t === 'light' ? 'LIGHT MODE' : 'DARK MODE';
    }
    function applyAll() {
        fmtCache = {};
        LIST.forEach(function (it) {
            if (!it.cls) return;
            var v = !!get(it.key);
            DOC.classList.toggle(it.cls, it.clsOn ? v : !v);
        });
        var acc = get('accent');
        if (acc && acc !== 'default') DOC.setAttribute('data-accent', acc); else DOC.removeAttribute('data-accent');
        applyTheme();
        refreshLive();
        var link = document.getElementById('settingsLink');
        if (link && /settings\.html$/.test(location.pathname)) link.classList.add('active');
    }

    /* -------------------------------------------------------------- sync (Supabase) */
    var uid = null, pushTimer = null, state = { lastSync: 0, error: '' };
    function client() { try { return window.getSupabaseClient ? window.getSupabaseClient() : null; } catch (e) { return null; } }

    function applyRemote(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
        var n = 0;
        Object.keys(obj).forEach(function (k) {
            var it = ITEMS[k];
            if (!it || it.type === 'action' || it.local) return;
            if (set(k, obj[k], { noPush: true, noStamp: true })) n++;
        });
        return n;
    }

    function queuePush() { clearTimeout(pushTimer); pushTimer = setTimeout(push, 900); }
    async function push() {
        var c = client();
        if (!c || !uid) return;
        try {
            var at = Number(lsGet(AT)) || Date.now();
            var r = await c.from('user_settings').upsert({ user_id: uid, settings: snapshot(), updated_at: new Date(at).toISOString() });
            if (r.error) throw r.error;
            state.lastSync = Date.now(); state.error = '';
        } catch (e) { state.error = 'Could not sync right now. Your settings are saved on this device.'; }
        emit('__status');
    }

    var syncing = false, authHooked = false;
    async function sync() {
        var c = client();
        if (!c || syncing) return;
        syncing = true;
        try {
            if (!authHooked && c.auth && c.auth.onAuthStateChange) {
                authHooked = true;
                c.auth.onAuthStateChange(function (ev, session) {
                    if (session && session.user) { if (uid !== session.user.id) setTimeout(sync, 0); }
                    else if (ev === 'SIGNED_OUT') { uid = null; emit('__status'); }
                });
            }
            var r = await c.auth.getSession();
            var sess = r && r.data && r.data.session;
            if (!sess) { uid = null; return; }
            uid = sess.user.id;
            var q = await c.from('user_settings').select('settings, updated_at').eq('user_id', uid).maybeSingle();
            if (q.error) { state.error = 'Sync is not set up yet.'; return; }
            var localAt = Number(lsGet(AT)) || 0;
            if (q.data) {
                var remoteAt = Date.parse(q.data.updated_at) || 0;
                if (remoteAt > localAt) { applyRemote(q.data.settings); lsSet(AT, String(remoteAt)); }
                else if (localAt > remoteAt) await push();
            } else if (localAt) await push();
            state.lastSync = Date.now(); state.error = '';
        } catch (e) { state.error = 'Could not sync right now. Your settings are saved on this device.'; }
        finally { syncing = false; emit('__status'); }
    }

    /* ----------------------------------------------------------- import / export / reset */
    function exportJSON() { return JSON.stringify({ app: 'specsoft-settings', version: 1, settings: snapshot() }, null, 2); }
    function importJSON(text) {
        var o;
        try { o = JSON.parse(text); } catch (e) { return null; }
        if (o && o.settings && typeof o.settings === 'object') o = o.settings;
        if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
        var n = applyRemote(o);
        if (n) { lsSet(AT, String(Date.now())); queuePush(); }
        return { applied: n };
    }
    function reset() {
        LIST.forEach(function (it) { if (it.type !== 'action' && !it.local) set(it.key, it.def, { noPush: true, noStamp: true }); });
        set('reduceMotion', false, { noPush: true, noStamp: true });      // per device, so it is not in the loop above
        lsSet(AT, String(Date.now()));
        queuePush();
        emit('__reset');
    }


    /* ------------------------------------------------------------- lag watchdog
       If the page stays at 10 FPS or below for about 3 seconds in a row, Reduce motion
       switches on by itself (this device only) and a notice explains why.
       Turn it off with  Settings > Appearance > Auto reduce motion when lag.
       Hidden tabs are ignored (browsers pause them) and the first 4 seconds after a
       page opens are skipped, so loading hiccups never trigger it.                   */
    var LAG_FPS = 10, LAG_WINDOWS = 3, LAG_GRACE = 4000, lagRunning = false;
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssPut(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function lagEligible() { return get('autoReduceMotion') === true && get('reduceMotion') !== true && ssGet('ss.lagcool') !== '1'; }

    function lagBanner() {
        if (!document.body || document.getElementById('ssLagBanner')) return;
        if (!document.getElementById('ssLagStyle')) {
            var st = document.createElement('style');
            st.id = 'ssLagStyle';
            st.textContent = '#ssLagBanner{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000;max-width:560px;margin:0 auto;padding:12px 14px;border-radius:12px;background:var(--bg-card,#111);color:var(--text-primary,#fff);border:1px solid var(--border-hover,#666);box-shadow:0 12px 36px rgba(0,0,0,.45);font:13px/1.5 "Space Grotesk",system-ui,sans-serif}'
                + '#ssLagBanner p{margin:0 0 10px}#ssLagBanner div{display:flex;flex-wrap:wrap;gap:8px}'
                + '#ssLagBanner button,#ssLagBanner a{font:inherit;font-size:12px;padding:7px 12px;border-radius:9px;border:1px solid var(--border-hover,#666);background:transparent;color:inherit;cursor:pointer;text-decoration:none}'
                + '#ssLagBanner button:hover,#ssLagBanner a:hover{background:var(--accent-dim,rgba(255,255,255,.12))}';
            document.head.appendChild(st);
        }
        var b = document.createElement('div');
        b.id = 'ssLagBanner'; b.setAttribute('role', 'status');
        var p = document.createElement('p');
        p.textContent = 'Reduce motion (low detail mode) enabled. Your page dropped to 10fps or below. To add details again, turn off the "auto reduce motion when lag" or turn off the reduce motion setting itself.';
        var row = document.createElement('div');
        var link = document.createElement('a'); link.href = 'settings.html#appearance'; link.textContent = 'Open settings';
        var reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Reload page';
        reload.addEventListener('click', function () { location.reload(); });
        var close = document.createElement('button'); close.type = 'button'; close.textContent = 'Dismiss';
        close.addEventListener('click', function () { b.remove(); });
        row.appendChild(link); row.appendChild(reload); row.appendChild(close);
        b.appendChild(p); b.appendChild(row);
        document.body.appendChild(b);
    }

    function lagTrigger() {
        lagRunning = false;
        if (!lagEligible()) return;
        set('reduceMotion', true, { noPush: true, noStamp: true });
        lagBanner();
    }

    function lagKick() {
        if (lagRunning || !window.requestAnimationFrame || !lagEligible()) return;
        lagRunning = true;
        var t0 = performance.now(), winStart = 0, frames = 0, low = 0;
        function resetWin() { winStart = 0; frames = 0; low = 0; }
        function tick(now) {
            if (!lagRunning) return;
            if (!lagEligible()) { lagRunning = false; return; }
            if (document.hidden || now - t0 < LAG_GRACE) { resetWin(); requestAnimationFrame(tick); return; }
            if (!winStart) { winStart = now; frames = 0; }
            frames++;
            var span = now - winStart;
            if (span >= 1000) {
                low = (frames * 1000 / span) <= LAG_FPS ? low + 1 : 0;
                winStart = now; frames = 0;
                if (low >= LAG_WINDOWS) { lagTrigger(); return; }
            }
            requestAnimationFrame(tick);
        }
        document.addEventListener('visibilitychange', function () { if (document.hidden) resetWin(); });
        requestAnimationFrame(tick);
    }

    listeners.push(function (key, val) {
        // turning Reduce motion off by hand stops the watchdog from turning it back on until the tab is closed
        if (key === 'reduceMotion' && val === false && lagRunning === false) ssPut('ss.lagcool', '1');
        if (key === 'autoReduceMotion' && val === true) { try { sessionStorage.removeItem('ss.lagcool'); } catch (e) { /* ignore */ } }
        lagKick();
    });

    /* ------------------------------------------------------------------ boot */
    window.SpecSettings = {
        CATS: CATS, PRESETS: PRESETS, fmtTime: fmtTime, fmtDate: fmtDate, dayKey: dayKey, get: get, view: view, set: set,
        item: function (k) { return ITEMS[k]; }, isLocked: isLocked,
        setPreview: setPreview, clearPreview: clearPreview, previewing: previewing,
        applyPreset: applyPreset, resetCursor: resetCursor, exportCursorCode: exportCursorCode, importCursorCode: importCursorCode, all: snapshot, reset: reset, exportJSON: exportJSON, importJSON: importJSON,
        on: function (fn) { listeners.push(fn); },
        status: function () { return { signedIn: !!uid, lastSync: state.lastSync, error: state.error }; },
        sync: sync
    };

    applyAll();
    function ready() { applyAll(); sync(); lagKick(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();

    if (window.matchMedia) {
        var mq = window.matchMedia('(prefers-color-scheme: light)');
        var onMq = function () { if (themeMode() === 'system') { applyTheme(); emit('theme'); } };
        if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    window.addEventListener('storage', function (e) {
        if (!e.key || e.key === KEY || e.key === 'specsoft-theme' || e.key === 'specsoft-sound' || e.key.indexOf('specsoft.chat.') === 0) { applyAll(); emit('__ext'); }
    });
})();
