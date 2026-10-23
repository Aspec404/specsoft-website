/* ==========================================================================
   SPECSOFT® site-presence.js  -  real "X people here right now"

   Uses Supabase Realtime Presence, which is just a websocket feature of
   supabase-js — no table, no RLS, no SQL file needed. One shared channel
   across every page means the count is "online across the whole site" not
   per-page, which feels more like an actual community.

   Needs the Supabase SDK already on the page (same as roles.js /
   notifications.js). If it's not there, this just never shows a number —
   no error, no broken UI, the HUD bar looks exactly like it did before.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecPresence) return;

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

    function clientId() {
        try {
            var id = sessionStorage.getItem('specsoft-presence-id');
            if (!id) {
                id = Math.random().toString(36).slice(2) + Date.now().toString(36);
                sessionStorage.setItem('specsoft-presence-id', id);
            }
            return id;
        } catch (e) { return Math.random().toString(36).slice(2); }
    }

    var hudItem = null;
    function mountHud(count) {
        var hudLeft = document.querySelector('.hud-bar .hud-left');
        if (!hudLeft) return;
        hudItem = document.createElement('div');
        hudItem.className = 'hud-item';
        hudItem.innerHTML = '<span class="hud-dot"></span> ';
        hudItem.appendChild(document.createTextNode(count + ' ONLINE NOW'));
        hudLeft.appendChild(hudItem);
    }
    function paint(count) {
        if (!hudItem) { mountHud(count); return; }
        hudItem.innerHTML = '<span class="hud-dot"></span> ';
        hudItem.appendChild(document.createTextNode(count + ' ONLINE NOW'));
    }

    function start() {
        var sb = client();
        if (!sb || !sb.channel) return;

        try {
            var channel = sb.channel('presence:site', { config: { presence: { key: clientId() } } });

            channel.on('presence', { event: 'sync' }, function () {
                var state = channel.presenceState();
                var count = Object.keys(state || {}).length;
                if (count > 0) paint(count);
            });

            channel.subscribe(function (status) {
                if (status === 'SUBSCRIBED') {
                    channel.track({ online_at: new Date().toISOString() });
                }
            });

            window.addEventListener('beforeunload', function () {
                try { channel.untrack(); } catch (e) {}
            });
        } catch (e) { /* presence is a bonus, never worth breaking the page over */ }
    }

    window.SpecPresence = {};

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
