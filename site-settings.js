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
        { id: 'appearance', title: 'Appearance', blurb: 'How the site looks.',
          icon: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
          items: [
            sl('theme', 'Theme', 'Dark, light, or follow your device.', 'dark', [['dark', 'Dark'], ['light', 'Light'], ['system', 'Match my device']], { read: themeMode, write: themeWrite }),
            sl('accent', 'Accent color', 'Tints highlights, borders and buttons. The default keeps the black and white look.', 'default',
               [['default', 'White / black (default)'], ['blue', 'Blue'], ['green', 'Green'], ['purple', 'Purple'], ['red', 'Red'], ['amber', 'Amber']]),
            tg('reduceMotion', 'Reduce motion', 'Calms animations and turns off the motion-heavy effects. Your device setting is respected too.', false, { cls: 'ss-reduce-motion', clsOn: true, reload: true })
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
            tg('cursor', 'Custom cursor', 'The SPECSOFT cursor. Mouse and trackpad only.', true, { reload: true }),
            tg('transitions', 'Page transitions', 'The fade and scan sweep between pages.', true),
            tg('intro', 'Intro animation', 'Play the SPECSOFT intro when you open the site.', true)
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

    function coerce(it, v) {
        if (it.type === 'toggle') return (v === true || v === false) ? v : (v === 'true' ? true : (v === 'false' ? false : undefined));
        if (it.type === 'select') { for (var i = 0; i < it.options.length; i++) if (String(it.options[i][0]) === String(v)) return it.options[i][0]; }
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
        LIST.forEach(function (it) {
            if (!it.cls) return;
            var v = !!get(it.key);
            DOC.classList.toggle(it.cls, it.clsOn ? v : !v);
        });
        var acc = get('accent');
        if (acc && acc !== 'default') DOC.setAttribute('data-accent', acc); else DOC.removeAttribute('data-accent');
        applyTheme();
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
        lsSet(AT, String(Date.now()));
        queuePush();
        emit('__reset');
    }

    /* ------------------------------------------------------------------ boot */
    window.SpecSettings = {
        CATS: CATS, get: get, set: set, all: snapshot, reset: reset, exportJSON: exportJSON, importJSON: importJSON,
        on: function (fn) { listeners.push(fn); },
        status: function () { return { signedIn: !!uid, lastSync: state.lastSync, error: state.error }; },
        sync: sync
    };

    applyAll();
    function ready() { applyAll(); sync(); }
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
