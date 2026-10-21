/* ==========================================================================
   SPECSOFT® — Profile page (profile.js)
   Load AFTER main.js and after the Supabase CDN script.

   SETUP:
   1. Paste the SAME two values you used in auth.js (Supabase dashboard >
      Project Settings > API). Only the "anon public" key goes here, NEVER
      the "service_role" key.
   2. Run supabase-profiles.sql once in the Supabase SQL Editor.
   ========================================================================== */
(function () {
    'use strict';

    const CONFIG = window.SPECSOFT_CONFIG || {
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',        // e.g. 'https://abcdxyz.supabase.co'
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7'    // the long "anon public" key
    };

    /* ----------------------------------------------------------------------
       1. HELPERS (pure functions, no page access)
       ---------------------------------------------------------------------- */
    /* HELPERS START */
    const RE_USER = /^[A-Za-z0-9_]{3,20}$/;

    function sanitizeUsername(raw) {
        return String(raw == null ? '' : raw).normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
    }

    function randDigits(n) {
        let out = '';
        for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 10);
        return out;
    }

    // picks a starting username from the login metadata (Discord name, email name, ...)
    function baseUsername(meta, email) {
        meta = meta || {};
        const candidates = [meta.username, meta.user_name, meta.full_name, meta.name, String(email || '').split('@')[0]];
        for (let i = 0; i < candidates.length; i++) {
            const s = sanitizeUsername(candidates[i]);
            if (s.length >= 3) return s;
        }
        return 'member' + randDigits(4);
    }

    // empty is fine (returns null). Anything else must be an https:// link.
    function httpsUrl(v) {
        const s = String(v == null ? '' : v).trim();
        if (!s) return { ok: true, value: null };
        if (s.length > 300) return { ok: false, value: null };
        return /^https:\/\/[^\s]+\.[^\s]+$/i.test(s) ? { ok: true, value: s } : { ok: false, value: null };
    }

    // only plain #rrggbb colors are accepted (blocks url(...) and other CSS tricks hidden in saved themes)
    function hexColor(v, fallback) {
        return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
    }

    function safeHttps(v) {
        return typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) ? v : null;
    }

    function youtubeEmbedUrl(v) {
        const url = safeHttps(v);
        if (!url) return null;
        try {
            const u = new URL(url);
            const host = (u.hostname || '').replace(/^www\./, '').toLowerCase();
            const maybeId = function (val) {
                if (!val) return null;
                return String(val).split(/[?&/]/)[0] || null;
            };

            if (host === 'youtu.be') {
                const id = maybeId(u.pathname.replace(/^\/+/, ''));
                return id ? 'https://www.youtube.com/embed/' + id : null;
            }

            if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'www.youtube.com') {
                const id = u.searchParams.get('v')
                    || (u.pathname.startsWith('/shorts/') ? maybeId(u.pathname.replace(/^\/shorts\//, '')) : null)
                    || (u.pathname.startsWith('/embed/') ? maybeId(u.pathname.replace(/^\/embed\//, '')) : null)
                    || (u.pathname.startsWith('/live/') ? maybeId(u.pathname.replace(/^\/live\//, '')) : null);
                return id ? 'https://www.youtube.com/embed/' + id : null;
            }
        } catch (err) {
            return null;
        }
        return null;
    }

    function parseTags(str, max, maxLen) {
        const seen = new Set();
        const out = [];
        String(str || '').split(',').forEach(function (t) {
            t = t.trim().slice(0, maxLen);
            const key = t.toLowerCase();
            if (t && !seen.has(key)) { seen.add(key); out.push(t); }
        });
        return out.slice(0, max);
    }

    // % and _ are wildcards in LIKE searches, so they must be escaped
    function escapeLike(s) {
        return String(s == null ? '' : s).replace(/[\\%_]/g, function (m) { return '\\' + m; });
    }

    function shortId(id) {
        return String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase();
    }

    // turns a public storage URL back into its file path (used to delete old images)
    function storagePath(url, bucket) {
        const marker = '/storage/v1/object/public/' + bucket + '/';
        const s = String(url || '');
        const i = s.indexOf(marker);
        if (i < 0) return null;
        try { return decodeURIComponent(s.slice(i + marker.length).split('?')[0]); } catch (e) { return null; }
    }

    function hashIndex(str, mod) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h + str.charCodeAt(i)) % 9973;
        return h % mod;
    }
    /* HELPERS END */

    /* ----------------------------------------------------------------------
       2. SMALL DOM TOOLKIT
       ---------------------------------------------------------------------- */
    const $ = id => document.getElementById(id);
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function el(tag, props) {
        const n = document.createElement(tag);
        if (props) {
            Object.keys(props).forEach(function (k) {
                const v = props[k];
                if (v == null || v === false) return;
                if (k === 'class') n.className = v;
                else if (k === 'text') n.textContent = v;
                else if (k === 'dataset') Object.keys(v).forEach(function (d) { n.dataset[d] = v[d]; });
                else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
                else n.setAttribute(k, v === true ? '' : v);
            });
        }
        for (let i = 2; i < arguments.length; i++) {
            const kids = [].concat(arguments[i]);
            kids.forEach(function (c) {
                if (c == null || c === false) return;
                n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
            });
        }
        return n;
    }

    const svg = inner => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';

    const ICON = {
        pencil:   svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
        trash:    svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
        plus:     svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
        external: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
        code:     svg('<polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/><line x1="14" y1="5" x2="10" y2="19"/>'),
        globe:    svg('<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
        share:    svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>'),
        heart:    svg('<path d="M12 20.5s-7.5-4.35-9.5-8.18C1.2 9.82 2.2 5.5 6.15 5.5A4.36 4.36 0 0 1 12 8.19 4.36 4.36 0 0 1 17.85 5.5c3.95 0 4.95 4.32 3.65 6.82C19.5 16.15 12 20.5 12 20.5z"/>'),
        repost:   svg('<path d="M7 7h9a4 4 0 0 1 4 4v1"/><path d="M17 3l4 4-4 4"/><path d="M17 17H8a4 4 0 0 1-4-4v-1"/><path d="M7 21l-4-4 4-4"/>'),
        comment:  svg('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>'),
        more:     svg('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
        pin:      svg('<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3z"/>'),
        location: svg('<path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
        calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>'),
        id:       svg('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h4M14 14h4"/>'),
        search:   svg('<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>'),
        github:   svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.8a5.3 5.3 0 0 0-1.4-3.7 5 5 0 0 0-.1-3.7s-1.1-.3-3.8 1.4a13 13 0 0 0-7 0C6.3 2.8 5.2 3.1 5.2 3.1a5 5 0 0 0-.1 3.7A5.3 5.3 0 0 0 3.7 10.5c0 5.3 3.2 6.5 6.2 6.8a3.4 3.4 0 0 0-.9 2.6V22"/>'),
        roblox:   svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
        discord:  svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>')
    };

    function icon(name) {
        const holder = document.createElement('span');
        holder.innerHTML = ICON[name];
        return holder.firstChild;
    }

    // Discord-style presence icons (same as the credits cards)
    const STATUS = {
        online:  { label: 'ACTIVE',         aria: 'Active' },
        dnd:     { label: 'DO NOT DISTURB', aria: 'Do not disturb' },
        idle:    { label: 'IDLE',           aria: 'Idle' },
        offline: { label: 'OFFLINE',        aria: 'Offline' }
    };

    function statusIcon(s) {
        switch (s) {
            case 'dnd':
                return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="#f23f43"/><rect class="pf-dnd-bar" x="4.5" y="8.4" width="11" height="3.2" rx="1.6"/></svg>';
            case 'idle':
                return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#f0b232"/></svg>';
            case 'offline':
                return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="#80848e"/></svg>';
            default:
                return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="#23a55a"/></svg>';
        }
    }

    const PRESETS = ['grid', 'rings', 'scan', 'dots', 'diag', 'wave'];

    const NAME_FONT_FAMILIES = {
        default: '"Space Grotesk", "Segoe UI", sans-serif',
        tempo: '"Trebuchet MS", "Segoe UI", sans-serif',
        lora: '"Lora", Georgia, serif',
        medieval: '"Cinzel Decorative", Georgia, serif',
        pixel: '"Press Start 2P", "Courier New", monospace',
        typewriter: '"Courier Prime", "Courier New", monospace',
        sakura: '"Pacifico", "Segoe Print", cursive',
        mainframe: '"VT323", Consolas, monospace',
        aesthetic: '"Cormorant Garamond", Georgia, serif'
    };

    const DEFAULT_DISPLAY_STYLE = {
        font: 'default',
        style: 'solid',
        animated: false,
        gradientColors: ['#7c3aed', '#22d3ee', '#f472b6', '#fbbf24', '#a78bfa'],
        glowColor: '#7c3aed'
    };

    function normalizeDisplayStyle(raw) {
        const source = (raw && typeof raw === 'object') ? raw : {};
        const gradientColors = Array.isArray(source.gradientColors) ? source.gradientColors : [];
        const merged = [];
        for (let i = 0; i < 5; i++) merged.push(hexColor(gradientColors[i], DEFAULT_DISPLAY_STYLE.gradientColors[i] || '#7c3aed'));
        const font = NAME_FONT_FAMILIES[source.font] ? source.font : DEFAULT_DISPLAY_STYLE.font;
        const style = ['solid', 'gradient', 'neon', 'prism', 'pop'].indexOf(source.style) >= 0 ? source.style : DEFAULT_DISPLAY_STYLE.style;
        return {
            font: font,
            style: style,
            animated: !!source.animated,
            gradientColors: merged,
            glowColor: hexColor(source.glowColor, DEFAULT_DISPLAY_STYLE.glowColor)
        };
    }

    function applyDisplayNameStyle(profile) {
        const node = $('pfName');
        if (!node) return;
        const style = normalizeDisplayStyle(profile && profile.display_style);
        const g = style.gradientColors;
        node.style.fontFamily = NAME_FONT_FAMILIES[style.font] || NAME_FONT_FAMILIES.default;
        node.style.setProperty('--pf-name-glow', style.glowColor || '#7c3aed');
        node.style.setProperty('--pf-name-color-1', g[0] || '#7c3aed');
        node.style.setProperty('--pf-name-color-2', g[1] || '#22d3ee');
        node.style.setProperty('--pf-name-color-3', g[2] || '#f472b6');
        node.style.setProperty('--pf-name-color-4', g[3] || '#fbbf24');
        node.style.setProperty('--pf-name-color-5', g[4] || '#a78bfa');
        node.style.setProperty('--pf-name-grad-angle', '135deg');
        node.style.setProperty('--pf-name-gradient-animated', style.animated && (style.style === 'gradient' || style.style === 'prism') ? '1' : '0');
        node.classList.remove('pf-name--gradient', 'pf-name--neon', 'pf-name--prism', 'pf-name--pop');
        if (style.style !== 'solid') node.classList.add('pf-name--' + style.style);
    }

    function updateNameStyleControls() {
        const style = $('edNameStyle') ? $('edNameStyle').value : 'solid';
        const advancedRow = $('pfNameStyleRow');
        const prismColors = $('pfPrismColors');
        const showAnimated = style === 'gradient' || style === 'prism';
        const showPrism = style === 'prism';
        if (advancedRow) advancedRow.style.display = showAnimated ? '' : 'none';
        if (prismColors) prismColors.style.display = showPrism ? '' : 'none';

        const preview = $('edNameFontPreview');
        if (!preview) return;
        const selectedFont = ($('edNameFont') || {}).value || 'default';
        const glow = ($('edNameGlowColor') || {}).value || '#7c3aed';
        const gradientColors = [
            ($('edNameGrad1') || {}).value || '#7c3aed',
            ($('edNameGrad2') || {}).value || '#22d3ee',
            ($('edNameGrad3') || {}).value || '#f472b6',
            ($('edNameGrad4') || {}).value || '#fbbf24',
            ($('edNameGrad5') || {}).value || '#a78bfa'
        ];

        preview.className = 'pf-font-preview';
        if (style === 'gradient') preview.classList.add('pf-font-preview--gradient');
        if (style === 'neon') preview.classList.add('pf-font-preview--neon');
        if (style === 'prism') preview.classList.add('pf-font-preview--prism');
        if (style === 'pop') preview.classList.add('pf-font-preview--pop');
        preview.style.fontFamily = NAME_FONT_FAMILIES[selectedFont] || NAME_FONT_FAMILIES.default;
        preview.style.setProperty('--pf-preview-glow', glow);
        preview.style.setProperty('--pf-preview-color-1', gradientColors[0]);
        preview.style.setProperty('--pf-preview-color-2', gradientColors[1]);
        preview.style.setProperty('--pf-preview-color-3', gradientColors[2]);
        preview.style.setProperty('--pf-preview-color-4', gradientColors[3]);
        preview.style.setProperty('--pf-preview-color-5', gradientColors[4]);
    }

    // profile picture: uses the shared SpecAuth.avatar from main.js (falls back to a plain letter)
    function avatarEl(user) {
        if (window.SpecAuth && window.SpecAuth.avatar) return window.SpecAuth.avatar(user);
        const wrap = el('span', { class: 'sp-avatar' }, el('span', { class: 'sp-initial', text: (user.name || '?').charAt(0).toUpperCase() }));
        if (user.avatar) {
            const img = el('img', { src: user.avatar, alt: '', referrerpolicy: 'no-referrer' });
            img.addEventListener('error', function () { img.remove(); });
            wrap.appendChild(img);
        }
        return wrap;
    }

    let toastTimer = null;
    function toast(msg) {
        const t = $('pfToast');
        const host = document.querySelector('dialog[open]') || document.body;   // dialogs sit in the top layer
        if (t.parentNode !== host) host.appendChild(t);
        t.textContent = msg;
        void t.offsetWidth;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
    }

    function setLoading(btn, on) {
        btn.classList.toggle('is-loading', on);
        btn.disabled = on;
        btn.setAttribute('aria-busy', String(on));
    }

    function showMsg(id, text, kind) {
        const box = $(id);
        box.className = 'pf-msg' + (text ? ' is-' + (kind || 'error') : '');
        box.textContent = text || '';
        if (text) box.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function fmtDate(iso, opts) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleDateString(undefined, opts || { year: 'numeric', month: 'short' });
    }

    function themeForProfile(profile) {
        const raw = (profile && profile.theme && typeof profile.theme === 'object') ? profile.theme : {};
        return {
            primary: hexColor(raw.primary, '#7c3aed'),
            secondary: hexColor(raw.secondary, '#22d3ee'),
            top: hexColor(raw.top, '#0f172a'),
            bottom: hexColor(raw.bottom, '#1e293b')
        };
    }

    function applyProfileTheme(profile) {
        const root = $('pfProfile');
        if (!root) return;
        const t = themeForProfile(profile);
        root.style.setProperty('--pf-accent', t.primary);
        root.style.setProperty('--pf-accent-2', t.secondary);
        root.style.setProperty('--pf-top-grad', t.top);
        root.style.setProperty('--pf-bottom-grad', t.bottom);
    }

    /* ----------------------------------------------------------------------
       3. BACKEND + STATE
       ---------------------------------------------------------------------- */
    const sb = window.getSupabaseClient ? window.getSupabaseClient() : (
        (window.supabase && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY)
            ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
            : null
    );

    const state = {
        me: null,            // the logged-in auth user (or null)
        profile: null,       // the profile row being shown
        projects: [],
        reposts: [],
        highlights: [],
        followerIds: [],
        followingIds: [],
        followCounts: { followers: 0, following: 0 },
        isFollowing: false,
        isOwner: false,
        tab: 'projects'
    };

    function isMissingTables(err) {
        if (!err) return false;
        const code = err.code;
        const msg = (err && err.message || '').toLowerCase();
        const relations = ['profiles', 'profile_projects', 'profile_highlights', 'profile_follows'];

        if (code === '42P01' || code === 'PGRST205' || msg.includes('schema cache')) return true;
        if (!msg.includes('does not exist')) return false;
        return relations.some(function (name) { return msg.includes(name); });
    }

    function friendly(err) {
        const code = String(err && err.code || '');
        const msg = String(err && err.message || '').toLowerCase();
        if (code === '23505') return msg.includes('username') ? 'That username is already taken.' : 'You already did that.';
        if (code === 'PGRST202' || /profile_project_stats|profile_reposts|profile_project_comments|profile_project_reports/.test(msg)) return 'Run supabase-project-social.sql in your Supabase SQL Editor to turn on likes, reposts and comments.';
        if (code === '42501' || msg.includes('row-level security') || msg.includes('row level security')) return 'You have hit a limit (12 projects, 10 highlights) or you are not allowed to do that.';
        if (code === '23514') return 'One of the fields is too long or has a value that is not allowed.';
        if (isMissingTables(err)) return 'Profiles are not set up yet. Run supabase-profiles.sql in your Supabase SQL Editor.';
        if (msg.includes('failed to fetch') || msg.includes('network')) return 'Cannot reach the server. Check your connection.';
        if (msg.includes('mime') || msg.includes('not supported')) return 'That image type is not allowed. Use PNG, JPG or WebP.';
        if (err && (err.statusCode === '413' || msg.includes('too large') || msg.includes('exceeded'))) return 'That image is too large.';
        return 'Something went wrong. Please try again.';
    }

    /* ----------------------------------------------------------------------
       4. PAGE STATES (loading, errors, logged out)
       ---------------------------------------------------------------------- */
    function showState(kind, extra) {
        const box = $('pfState');
        box.textContent = '';
        box.hidden = false;
        $('pfProfile').hidden = true;

        const add = (title, text, actions) => {
            box.appendChild(el('h2', { text: title }));
            if (text) box.appendChild(el('p', { text: text }));
            if (actions) box.appendChild(el('div', { class: 'pf-state-actions' }, actions));
        };
        const btn = (label, href, ghost) => el('a', { class: 'pf-btn' + (ghost ? ' pf-btn--ghost' : ''), href: href, text: label });

        if (kind === 'loading') {
            box.appendChild(el('div', { class: 'pf-spinner', 'aria-hidden': 'true' }));
            box.appendChild(el('p', { text: 'Loading profile...' }));
        } else if (kind === 'setup') {
            add('Backend not connected', 'Add your Supabase URL and anon key at the top of profile.js (the same two values as in auth.js).');
        } else if (kind === 'tables') {
            add('Profiles are not set up yet', 'Run supabase-profiles.sql once in your Supabase SQL Editor, then refresh this page.');
        } else if (kind === 'notfound') {
            add('Profile not found', 'There is no member with that username. Try searching below.', [btn('Home', 'index.html', true)]);
        } else if (kind === 'guest') {
            add('Log in to see your profile', 'Create an account to get your own profile with projects, highlights and a banner. You can still browse other members below.',
                [btn('Log in', 'login.html'), btn('Sign up', 'login.html?mode=signup', true)]);
        } else {
            add('Something went wrong', extra || 'Please refresh the page and try again.');
        }
    }

    /* ----------------------------------------------------------------------
       5. LOADING DATA
       ---------------------------------------------------------------------- */
    async function fetchByUsername(u) {
        const res = await sb.from('profiles').select('*').ilike('username', escapeLike(u)).limit(5);
        if (res.error) throw res.error;
        const rows = res.data || [];
        return rows.find(function (r) { return r.username.toLowerCase() === u.toLowerCase(); }) || null;
    }

    async function createProfile(me) {
        const meta = me.user_metadata || {};
        const base = baseUsername(meta, me.email);
        const avatar = safeHttps(meta.sp_avatar || meta.avatar_url || meta.picture || '');
        const display = String(meta.full_name || meta.name || '').trim().slice(0, 40) || null;

        for (let i = 0; i < 6; i++) {
            const name = i === 0 ? base : base.slice(0, 15) + randDigits(4);
            const res = await sb.from('profiles').insert({
                id: me.id,
                username: name,
                display_name: display,
                avatar_url: avatar,
                status: 'online',
                display_style: DEFAULT_DISPLAY_STYLE,
                theme: {
                    primary: '#7c3aed',
                    secondary: '#22d3ee',
                    top: '#0f172a',
                    bottom: '#1e293b'
                }
            }).select().single();

            if (!res.error) return res.data;
            if (res.error.code !== '23505') throw res.error;

            // 23505 = either the username is taken, or the profile appeared in the meantime
            const again = await sb.from('profiles').select('*').eq('id', me.id).maybeSingle();
            if (again.data) return again.data;
        }
        throw new Error('Could not pick a free username.');
    }

    async function ensureMyProfile(me) {
        const res = await sb.from('profiles').select('*').eq('id', me.id).maybeSingle();
        if (res.error) throw res.error;
        if (res.data) return res.data;

        const created = await createProfile(me);
        // keep the login data in step so the top bar shows the same username
        try { await sb.auth.updateUser({ data: { username: created.username } }); } catch (e) { /* not critical */ }
        if (window.SpecAuth) window.SpecAuth.refresh();
        return created;
    }

    async function loadContent() {
        const id = state.profile.id;
        const [pr, hl] = await Promise.all([
            sb.from('profile_projects').select('*').eq('owner_id', id).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
            sb.from('profile_highlights').select('*').eq('owner_id', id).order('created_at', { ascending: true })
        ]);
        if (pr.error) throw pr.error;
        if (hl.error) throw hl.error;
        state.projects = pr.data || [];
        state.highlights = hl.data || [];
        await loadStatsSafe(state.projects);
        await loadRepostsSafe();
    }

    async function loadFollowMeta() {
        if (!sb || !state.profile) return;
        const profileId = state.profile.id;
        const [followersRes, followingRes, meFollowRes] = await Promise.all([
            sb.from('profile_follows').select('follower_id').eq('following_id', profileId),
            sb.from('profile_follows').select('following_id').eq('follower_id', profileId),
            state.me && state.me.id
                ? sb.from('profile_follows').select('id').eq('follower_id', state.me.id).eq('following_id', profileId).maybeSingle()
                : Promise.resolve({ data: null })
        ]);

        if (followersRes.error) throw followersRes.error;
        if (followingRes.error) throw followingRes.error;
        if (meFollowRes && meFollowRes.error) throw meFollowRes.error;

        state.followerIds = (followersRes.data || []).map(function (row) { return row.follower_id; });
        state.followingIds = (followingRes.data || []).map(function (row) { return row.following_id; });
        state.followCounts = {
            followers: state.followerIds.length,
            following: state.followingIds.length
        };
        state.isFollowing = !!(meFollowRes && meFollowRes.data);
    }

    async function fetchProfilesByIds(ids) {
        if (!ids || !ids.length) return [];
        const res = await sb.from('profiles').select('id, username, display_name, avatar_url').in('id', ids);
        if (res.error) throw res.error;
        const map = new Map((res.data || []).map(function (p) { return [p.id, p]; }));
        return ids.map(function (id) { return map.get(id); }).filter(Boolean);
    }

    let followBusy = false;

    async function toggleFollow() {
        if (!sb) return;
        if (!state.me) {
            window.location.href = 'login.html';
            return;
        }
        if (state.isOwner || followBusy) return;
        followBusy = true;

        try {
            const already = state.isFollowing;
            if (already) {
                const res = await sb.from('profile_follows').delete().eq('follower_id', state.me.id).eq('following_id', state.profile.id);
                if (res.error) throw res.error;
            } else {
                const res = await sb.from('profile_follows').insert({ follower_id: state.me.id, following_id: state.profile.id });
                if (res.error) throw res.error;
            }

            await loadFollowMeta();
            renderProfile();
            toast(already ? 'Unfollowed' : 'Followed');
        } catch (err) {
            if (err && err.code === '23505') {
                // already following (double click or two tabs): just refresh the state
                try { await loadFollowMeta(); renderProfile(); } catch (e) { /* ignore */ }
            } else {
                toast(friendly(err));
            }
        } finally {
            followBusy = false;
        }
    }

    async function openFollowList(kind) {
        if (!sb) return;
        const list = kind === 'followers' ? state.followerIds : state.followingIds;
        const title = kind === 'followers' ? 'Followers' : 'Following';
        const box = $('flList');
        if (!box) return;

        box.textContent = '';
        $('flTitle').textContent = title;

        if (!list.length) {
            box.appendChild(el('p', { class: 'pf-empty-list', text: kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.' }));
            openDlg($('flDlg'));
            return;
        }

        try {
            const rows = await fetchProfilesByIds(list);
            rows.forEach(function (p) {
                const name = p.display_name || p.username;
                const item = el('a', {
                    class: 'pf-follow-item',
                    href: 'profile.html?u=' + encodeURIComponent(p.username),
                    title: '@' + p.username
                },
                    avatarEl({ name: name, avatar: safeHttps(p.avatar_url) || '' }),
                    el('span', { class: 'pf-follow-text' },
                        el('span', { class: 'pf-follow-name', text: name }),
                        el('span', { class: 'pf-follow-sub', text: '@' + p.username })));
                box.appendChild(item);
            });
            if (!rows.length) {
                box.appendChild(el('p', { class: 'pf-empty-list', text: 'No public profiles found.' }));
            }
            openDlg($('flDlg'));
        } catch (err) {
            box.appendChild(el('p', { class: 'pf-empty-list', text: friendly(err) }));
            openDlg($('flDlg'));
        }
    }

    async function reloadProjects() {
        const res = await sb.from('profile_projects').select('*').eq('owner_id', state.profile.id)
            .order('pinned', { ascending: false }).order('created_at', { ascending: false });
        if (res.error) throw res.error;
        state.projects = res.data || [];
        await loadStatsSafe(state.projects);
        renderStats();
        renderProjects();
    }

    function highlightDurationMs(value) {
        const map = {
            permanent: null,
            '10d': 1000 * 60 * 60 * 24 * 10,
            '3d': 1000 * 60 * 60 * 24 * 3,
            '24h': 1000 * 60 * 60 * 24,
            '8h': 1000 * 60 * 60 * 8,
            '1h': 1000 * 60 * 60,
            '30m': 1000 * 60 * 30,
            '5m': 1000 * 60 * 5
        };
        return map[value] ?? null;
    }

    function getHighlightExpiryIso(value) {
        const ms = highlightDurationMs(value);
        if (ms === null) return null;
        return new Date(Date.now() + ms).toISOString();
    }

    async function purgeExpiredHighlights() {
        if (!sb) return;
        try {
            const nowIso = new Date().toISOString();
            const res = await sb.from('profile_highlights').select('id').lt('expires_at', nowIso);
            if (res.error) {
                const msg = (res.error && res.error.message || '').toLowerCase();
                if (msg.includes('does not exist') || msg.includes('column') || msg.includes('expires_at')) return;
                throw res.error;
            }
            const ids = (res.data || []).map(function (h) { return h.id; });
            if (!ids.length) return;
            const del = await sb.from('profile_highlights').delete().in('id', ids);
            if (del.error) throw del.error;
        } catch (err) {
            // Expired highlight cleanup is best-effort; if the column is missing, just skip.
        }
    }

    async function reloadHighlights() {
        await purgeExpiredHighlights();
        const res = await sb.from('profile_highlights').select('*').eq('owner_id', state.profile.id).order('created_at', { ascending: true });
        if (res.error) throw res.error;
        const now = Date.now();
        state.highlights = (res.data || []).filter(function (h) {
            if (!h.expires_at) return true;
            return new Date(h.expires_at).getTime() > now;
        });
        renderStats();
        renderRings();
    }

    /* ----------------------------------------------------------------------
       6. RENDERING
       ---------------------------------------------------------------------- */
    function profileLink() {
        return location.href.split('#')[0].split('?')[0] + '?u=' + encodeURIComponent(state.profile.username);
    }

    async function copyText(text, okMsg) {
        try {
            await navigator.clipboard.writeText(text);
            toast(okMsg);
        } catch (e) {
            const ta = el('textarea', { style: 'position:fixed;opacity:0' });
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
            ta.remove();
            toast(ok ? okMsg : 'Could not copy. Copy it by hand.');
        }
    }

    function renderProfile() {
        const p = state.profile;
        state.isOwner = !!(state.me && state.me.id === p.id);

        $('pfState').hidden = true;
        $('pfProfile').hidden = false;
        applyProfileTheme(p);

        const profileRoot = $('pfProfile');
        const customBg = safeHttps(p.background_url);
        document.body.classList.toggle('pf-custom-bg', !!customBg);
        profileRoot.classList.toggle('pf-profile--bg-image', !!customBg);
        if (customBg) profileRoot.style.setProperty('--pf-profile-bg', 'url("' + customBg + '")');
        else profileRoot.style.removeProperty('--pf-profile-bg');

        const name = p.display_name || p.username;
        document.title = name + ' (@' + p.username + ') | SPECSOFT®';

        // banner
        const banner = $('pfBanner');
        banner.className = 'pf-banner pf-banner--' + (PRESETS.indexOf(p.banner_preset) >= 0 ? p.banner_preset : 'grid');
        banner.textContent = '';
        const bUrl = safeHttps(p.banner_url);
        if (bUrl) {
            const img = el('img', { src: bUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
            img.addEventListener('error', function () { img.remove(); });
            banner.appendChild(img);
        }

        // avatar + status badge
        const wrap = $('pfAvatarWrap');
        wrap.textContent = '';
        wrap.appendChild(avatarEl({ name: name, avatar: safeHttps(p.avatar_url) || '' }));
        const st = STATUS[p.status] || STATUS.offline;
        const badge = el('span', { class: 'pf-status-badge', role: 'img', 'aria-label': st.aria });
        badge.innerHTML = statusIcon(p.status);
        wrap.appendChild(badge);

        // names
        $('pfName').textContent = name;
        applyDisplayNameStyle(p);
        $('pfHandle').textContent = '@' + p.username;
        if (window.SpecRoles && $('pfRoles')) window.SpecRoles.mount($('pfRoles'), p.id);
        $('pfHeadline').textContent = p.headline || '';

        // actions
        const actions = $('pfActions');
        actions.textContent = '';
        if (state.isOwner) {
            actions.appendChild(el('button', { type: 'button', class: 'pf-btn', onclick: openEdit }, icon('pencil'), 'Edit profile'));
        } else if (state.me) {
            actions.appendChild(el('button', {
                type: 'button',
                class: 'pf-btn pf-btn--ghost',
                onclick: function () { window.location.assign('chats.html?dm=' + encodeURIComponent(state.profile.username)); }
            }, icon('dm'), 'Message'));
            actions.appendChild(el('button', {
                type: 'button',
                class: 'pf-btn' + (state.isFollowing ? ' pf-btn--ghost' : ''),
                onclick: toggleFollow
            }, state.isFollowing ? 'Following' : 'Follow'));
        }
        actions.appendChild(el('button', {
            type: 'button', class: 'pf-btn pf-btn--ghost',
            onclick: function () { copyText(profileLink(), 'Profile link copied'); }
        }, icon('share'), 'Share'));

        // meta chips
        const meta = $('pfMeta');
        meta.textContent = '';
        const statusChip = el('li', { class: 'pf-chip' });
        statusChip.innerHTML = statusIcon(p.status);
        statusChip.firstChild.style.width = '13px';
        statusChip.firstChild.style.height = '13px';
        statusChip.appendChild(document.createTextNode(st.label));
        meta.appendChild(statusChip);
        if (p.location) meta.appendChild(el('li', { class: 'pf-chip' }, icon('location'), p.location));
        meta.appendChild(el('li', { class: 'pf-chip' }, icon('calendar'), 'Joined ' + fmtDate(p.created_at)));
        meta.appendChild(el('li', { class: 'pf-chip', title: 'Member ID' }, icon('id'), 'ID ' + shortId(p.id)));

        // links
        const links = $('pfLinks');
        links.textContent = '';
        const L = (p.links && typeof p.links === 'object') ? p.links : {};
        const ext = (label, ico, url) => {
            const safe = safeHttps(url);
            if (!safe) return;
            links.appendChild(el('li', null, el('a', { class: 'pf-link', href: safe, target: '_blank', rel: 'noopener noreferrer' }, icon(ico), label)));
        };
        ext('GitHub', 'github', L.github);
        ext('Roblox', 'roblox', L.roblox);
        ext('Website', 'globe', L.website);
        if (typeof L.discord === 'string' && L.discord.trim()) {
            const handle = L.discord.trim().slice(0, 40);
            links.appendChild(el('li', null, el('button', {
                type: 'button', class: 'pf-link', title: 'Copy Discord username',
                onclick: function () { copyText(handle, 'Discord username copied'); }
            }, icon('discord'), handle)));
        }

        // about
        $('pfBio').textContent = p.bio || (state.isOwner ? 'Add a bio from Edit profile.' : 'No bio yet.');
        const skills = $('pfSkills');
        skills.textContent = '';
        (p.skills || []).forEach(function (s) { skills.appendChild(el('li', { text: String(s) })); });
        if (!(p.skills || []).length) skills.appendChild(el('li', { text: state.isOwner ? 'Add your tech stack from Edit profile' : 'Nothing listed yet' }));

        renderStats();
        renderRings();
        renderProjects();
        renderReposts();
        switchTab(state.tab);
    }

    function renderStats() {
        const p = state.profile;
        const box = $('pfStats');
        box.textContent = '';
        const cell = (num, label, click) => {
            const node = click ? el('button', {
                type: 'button',
                class: 'pf-stat pf-stat--button',
                onclick: click
            }, el('span', { class: 'pf-stat-num', text: String(num) }), el('span', { class: 'pf-stat-label', text: label })) : el('div', { class: 'pf-stat' },
                el('span', { class: 'pf-stat-num', text: String(num) }),
                el('span', { class: 'pf-stat-label', text: label }));
            box.appendChild(node);
        };
        cell(state.projects.length, 'PROJECTS');
        cell(state.highlights.length, 'HIGHLIGHTS');
        cell(state.followCounts.followers, 'FOLLOWERS', function () { openFollowList('followers'); });
        cell(state.followCounts.following, 'FOLLOWING', function () { openFollowList('following'); });
        cell((p.skills || []).length, 'IN TECH STACK');
    }

    function renderRings() {
        const box = $('pfRings');
        box.textContent = '';

        state.highlights.forEach(function (h) {
            box.appendChild(el('button', { type: 'button', class: 'pf-ring-btn', onclick: function () { openHighlight(h); } },
                el('span', { class: 'pf-ring' }, el('span', { class: 'pf-ring-core', text: h.icon || '★' })),
                el('span', { class: 'pf-ring-label', text: h.title })));
        });

        if (state.isOwner && state.highlights.length < 10) {
            box.appendChild(el('button', { type: 'button', class: 'pf-ring-btn pf-ring-btn--add', onclick: openNewHighlight },
                el('span', { class: 'pf-ring' }, el('span', { class: 'pf-ring-core' }, icon('plus'))),
                el('span', { class: 'pf-ring-label', text: 'New' })));
        }
    }

    function renderProjects() {
        const grid = $('pfProjects');
        const empty = $('pfProjectsEmpty');
        grid.textContent = '';

        if (state.isOwner) {
            // the "add" card is always first for the owner
            if (state.projects.length < 12) {
                grid.appendChild(el('button', { type: 'button', class: 'pf-card pf-card--add', onclick: function () { openProject(null); } },
                    el('span', { class: 'pf-art-letter' }, icon('plus')),
                    el('span', { class: 'pf-card-title', text: 'Post a project' })));
            }
        }

        const list = state.projects.filter(function (p) { return state.isOwner || !hiddenIds.has(p.id); });
        list.forEach(function (pj) { grid.appendChild(projectCard(pj)); });

        empty.hidden = list.length > 0 || state.isOwner;
        if (!empty.hidden) empty.textContent = 'No projects posted yet.';
    }

    /* ----------------------------------------------------------------------
       6b. PROJECT SOCIAL: likes, reposts, comments, the three-dot menu, reports
       START project-social
       ---------------------------------------------------------------------- */
    state.socialReady = true;      // turns false if supabase-project-social.sql has not been run yet

    const HIDE_KEY = 'specsoft.hidden.projects';

    function readHidden() {
        try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]')); } catch (e) { return new Set(); }
    }

    const hiddenIds = readHidden();

    function saveHidden() {
        try { localStorage.setItem(HIDE_KEY, JSON.stringify(Array.from(hiddenIds).slice(-300))); } catch (e) { /* storage blocked */ }
    }

    function isSocialMissing(err) {
        const code = String(err && err.code || '');
        const msg = String(err && err.message || '').toLowerCase();
        return code === 'PGRST202' || /profile_project_stats|profile_reposts|profile_project_comments|profile_project_reports/.test(msg);
    }

    function zeroStats(list) {
        (list || []).forEach(function (p) {
            p.like_count = p.like_count || 0;
            p.comment_count = p.comment_count || 0;
            p.repost_count = p.repost_count || 0;
            p.is_liked = !!p.is_liked;
            p.is_reposted = !!p.is_reposted;
        });
    }

    // likes + comments + reposts for many projects in ONE request
    async function loadProjectStats(list) {
        const ids = Array.from(new Set((list || []).map(function (p) { return p.id; })));
        if (!ids.length) return;
        const res = await sb.rpc('profile_project_stats', { p_ids: ids.slice(0, 200) });
        if (res.error) throw res.error;

        const by = {};
        (res.data || []).forEach(function (r) { by[r.project_id] = r; });
        list.forEach(function (p) {
            const s = by[p.id];
            p.like_count = s ? Number(s.like_count) : 0;
            p.comment_count = s ? Number(s.comment_count) : 0;
            p.repost_count = s ? Number(s.repost_count) : 0;
            p.is_liked = !!(s && s.liked);
            p.is_reposted = !!(s && s.reposted);
        });
    }

    async function loadStatsSafe(list) {
        try {
            await loadProjectStats(list);
        } catch (err) {
            if (!isSocialMissing(err)) throw err;
            state.socialReady = false;
            zeroStats(list);
        }
    }

async function loadReposts() {
    const res = await sb.from('profile_reposts')
        .select('created_at, project:profile_projects(*, owner:profiles!profile_projects_owner_id_fkey(id,username,display_name,avatar_url))')
        .eq('user_id', state.profile.id)
        .order('created_at', { ascending: false })
        .limit(60);

    if (res.error) throw res.error;

        state.reposts = (res.data || []).filter(function (r) { return r.project; }).map(function (r) {
            return Object.assign({}, r.project, { reposted_at: r.created_at, owner_profile: r.project.owner });
        });
        await loadProjectStats(state.reposts);
    }

    async function loadRepostsSafe() {
        try {
            await loadReposts();
        } catch (err) {
            if (!isSocialMissing(err)) throw err;
            state.socialReady = false;
            state.reposts = [];
        }
    }

    function needSocial() {
        if (state.socialReady) return true;
        toast('Run supabase-project-social.sql in Supabase to turn this on.');
        return false;
    }

    function socialError(err, ctx) {
        const code = String(err && err.code || '');
        if (code === '42501') {
            if (ctx === 'comment') return 'Slow down: you can post about 8 comments a minute.';
            if (ctx === 'repost') return 'You cannot repost your own project (or you reached the 100 repost limit).';
            if (ctx === 'report') return 'You cannot report your own project.';
        }
        if (code === '23505') return ctx === 'report' ? 'You already reported this project.' : 'Already done.';
        return friendly(err);
    }

    function timeAgo(iso) {
        const t = new Date(iso).getTime();
        if (isNaN(t)) return '';
        const s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        if (s < 604800) return Math.floor(s / 86400) + 'd ago';
        return fmtDate(iso, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    /* ---------- like / comment / repost buttons ---------- */
    const ENG_ICON = { like: 'heart', comment: 'comment', repost: 'repost' };
    const engBusy = new Set();

    function paintEng(btn, pj) {
        const kind = btn.dataset.eng;
        let n = 0, on = false, label = '';
        if (kind === 'like')    { n = pj.like_count || 0;    on = !!pj.is_liked;    label = on ? 'Unlike' : 'Like'; }
        if (kind === 'comment') { n = pj.comment_count || 0; label = 'Comments'; }
        if (kind === 'repost')  { n = pj.repost_count || 0;  on = !!pj.is_reposted; label = on ? 'Undo repost' : 'Repost'; }

        btn.classList.toggle('is-on', on);
        btn.querySelector('.pf-eng-n').textContent = n > 0 ? String(n) : '';
        btn.title = label;
        btn.setAttribute('aria-label', label + ', ' + n);
        if (kind !== 'comment') btn.setAttribute('aria-pressed', String(on));
    }

    // updates every copy of this project's buttons on the page (card + popup) without redrawing
    function syncEng(pj) {
        document.querySelectorAll('[data-eng][data-id="' + pj.id + '"]').forEach(function (b) { paintEng(b, pj); });
    }

    function engBtn(kind, pj) {
        const b = el('button', { type: 'button', class: 'pf-eng pf-eng--' + kind, dataset: { eng: kind, id: pj.id } },
            icon(ENG_ICON[kind]), el('span', { class: 'pf-eng-n' }));
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            if (kind === 'like') toggleProjectLike(pj);
            else if (kind === 'repost') toggleRepost(pj);
            else openDetails(pj, true);
        });
        paintEng(b, pj);
        return b;
    }

    async function toggleProjectLike(pj) {
        if (!needSocial()) return;
        if (!state.me) { toast('Log in to like projects.'); return; }
        const key = 'like:' + pj.id;
        if (engBusy.has(key)) return;
        engBusy.add(key);

        const was = !!pj.is_liked;
        pj.is_liked = !was;
        pj.like_count = Math.max(0, (pj.like_count || 0) + (was ? -1 : 1));
        syncEng(pj);

        try {
            const res = was
                ? await sb.from('profile_project_likes').delete().eq('project_id', pj.id).eq('user_id', state.me.id)
                : await sb.from('profile_project_likes').insert({ project_id: pj.id, user_id: state.me.id });
            if (res.error && !(res.error.code === '23505' && !was)) throw res.error;
        } catch (err) {
            pj.is_liked = was;
            pj.like_count = Math.max(0, (pj.like_count || 0) + (was ? 1 : -1));
            syncEng(pj);
            toast(socialError(err, 'like'));
        } finally {
            engBusy.delete(key);
        }
    }

    async function toggleRepost(pj) {
        if (!needSocial()) return;
        if (!state.me) { toast('Log in to repost projects.'); return; }
        if (state.me.id === pj.owner_id) { toast('You cannot repost your own project.'); return; }
        const key = 'repost:' + pj.id;
        if (engBusy.has(key)) return;
        engBusy.add(key);

        const was = !!pj.is_reposted;
        pj.is_reposted = !was;
        pj.repost_count = Math.max(0, (pj.repost_count || 0) + (was ? -1 : 1));
        syncEng(pj);

        try {
            const res = was
                ? await sb.from('profile_reposts').delete().eq('project_id', pj.id).eq('user_id', state.me.id)
                : await sb.from('profile_reposts').insert({ project_id: pj.id, user_id: state.me.id });
            if (res.error && !(res.error.code === '23505' && !was)) throw res.error;

            toast(was ? 'Repost removed' : 'Reposted to your profile');
            if (state.isOwner) { await loadRepostsSafe(); renderReposts(); }   // your Reposts tab updates right away
        } catch (err) {
            pj.is_reposted = was;
            pj.repost_count = Math.max(0, (pj.repost_count || 0) + (was ? 1 : -1));
            syncEng(pj);
            toast(socialError(err, 'repost'));
        } finally {
            engBusy.delete(key);
        }
    }

    function shareProject(pj) {
        const owner = pj.owner_profile ? pj.owner_profile.username : state.profile.username;
        const url = location.href.split('#')[0].split('?')[0] + '?u=' + encodeURIComponent(owner) + '#project-' + encodeURIComponent(pj.id || '');
        if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
            navigator.share({ title: (pj.title || 'Project') + ' | SPECSOFT', text: pj.summary || 'Check out this project', url: url }).catch(function () {});
            return;
        }
        copyText(url, 'Project link copied');
    }

    function hideProject(pj) {
        hiddenIds.add(pj.id);
        saveHidden();
        renderProjects();
        renderReposts();
        toast('Hidden on this device');
    }

    /* ---------- the three-dot menu (one shared menu, placed on the page itself) ----------
       It is NOT inside the card any more, so card edges, hover effects and animations
       can no longer clip it or move it around. */
    let menuEl = null, menuPj = null, menuBtn = null;

    function closeProjectMenu(returnFocus) {
        if (!menuEl || menuEl.hidden) return;
        menuEl.hidden = true;
        if (menuBtn) {
            menuBtn.setAttribute('aria-expanded', 'false');
            if (returnFocus) menuBtn.focus();
        }
        menuPj = null;
        menuBtn = null;
    }

    function menuItems(pj) {
        const mine = !!(state.me && pj.owner_id === state.me.id);
        const items = [{ act: 'details', label: 'Project details' }, { act: 'share', label: 'Share link' }];
        if (!mine) {
            if (state.me) items.push({ act: 'repost', label: pj.is_reposted ? 'Undo repost' : 'Repost' });
            items.push({ act: 'hide', label: 'Not interested' });
            if (state.me) items.push({ act: 'report', label: 'Report project', danger: true });
        }
        return items;
    }

    function projectMenuAction(pj, act) {
        if (act === 'details') openDetails(pj, false);
        else if (act === 'share') shareProject(pj);
        else if (act === 'repost') toggleRepost(pj);
        else if (act === 'hide') hideProject(pj);
        else if (act === 'report') openReport(pj);
    }

    function openProjectMenu(pj, btn) {
        if (menuEl && !menuEl.hidden && menuPj === pj) { closeProjectMenu(true); return; }
        closeProjectMenu(false);

        if (!menuEl) {
            menuEl = el('div', { class: 'pf-menu', role: 'menu', hidden: true });
            document.body.appendChild(menuEl);

            menuEl.addEventListener('click', function (e) {
                const item = e.target.closest('[data-act]');
                if (!item) return;
                const target = menuPj;
                closeProjectMenu(false);
                if (target) projectMenuAction(target, item.dataset.act);
            });

            menuEl.addEventListener('keydown', function (e) {
                const items = Array.prototype.slice.call(menuEl.querySelectorAll('.pf-menu-item'));
                const i = items.indexOf(document.activeElement);
                if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
                else if (e.key === 'Tab') { closeProjectMenu(false); }
            });
        }

        menuEl.textContent = '';
        menuItems(pj).forEach(function (it) {
            menuEl.appendChild(el('button', {
                type: 'button', role: 'menuitem',
                class: 'pf-menu-item' + (it.danger ? ' pf-menu-item--danger' : ''),
                dataset: { act: it.act }, text: it.label
            }));
        });

        menuPj = pj;
        menuBtn = btn;
        btn.setAttribute('aria-expanded', 'true');
        menuEl.hidden = false;

        // place it under the button, flip upwards when there is no room, keep it on screen
        const r = btn.getBoundingClientRect();
        const w = menuEl.offsetWidth || 200;
        const h = menuEl.offsetHeight || 160;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        const vh = window.innerHeight;
        const left = Math.min(Math.max(8, r.right - w), Math.max(8, vw - w - 8));
        let top = r.bottom + 6;
        if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
        menuEl.style.left = left + 'px';
        menuEl.style.top = top + 'px';

        const first = menuEl.querySelector('.pf-menu-item');
        if (first) first.focus({ preventScroll: true });
    }

    document.addEventListener('click', function (e) {
        if (menuEl && !menuEl.hidden && !menuEl.contains(e.target) && !(menuBtn && menuBtn.contains(e.target))) closeProjectMenu(false);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && menuEl && !menuEl.hidden) closeProjectMenu(true);
    });
    window.addEventListener('scroll', function () { closeProjectMenu(false); }, true);
    window.addEventListener('resize', function () { closeProjectMenu(false); });

    /* ---------- the project card ---------- */
    function projectMedia(pj) {
        const media = el('div', { class: 'pf-card-media' });
        const videoUrl = safeHttps(pj.video_url);
        const cover = safeHttps(pj.cover_url);
        const ytEmbed = youtubeEmbedUrl(pj.video_url);

        if (videoUrl && ytEmbed) {
            const iframe = el('iframe', {
                class: 'pf-card-video pf-card-video--embed',
                src: ytEmbed,
                title: (pj.title || 'Project video') + ' video',
                allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
                allowfullscreen: true,
                referrerpolicy: 'strict-origin-when-cross-origin'
            });
            media.appendChild(iframe);
        } else if (videoUrl) {
            const video = el('video', { class: 'pf-card-video', controls: true, playsinline: true, preload: 'metadata' });
            if (cover) video.setAttribute('poster', cover);
            video.appendChild(el('source', { src: videoUrl, type: /\.mp4(?:$|[?#])|video\/mp4/i.test(videoUrl) ? 'video/mp4' : 'video/webm' }));
            media.appendChild(video);
        } else {
            media.appendChild(el('div', { class: 'pf-art pf-art--' + hashIndex(pj.title || 'x', 4) },
                el('span', { class: 'pf-art-letter', text: (pj.title || '?').charAt(0).toUpperCase() })));
            if (cover) {
                const img = el('img', { src: cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
                img.addEventListener('error', function () { img.remove(); });
                media.appendChild(img);
            }
        }

        if (pj.pinned) media.appendChild(el('span', { class: 'pf-pin', text: 'PINNED' }));
        return media;
    }

    function projectLinks(pj) {
        const row = el('div', { class: 'pf-card-links' });
        const live = safeHttps(pj.url), repo = safeHttps(pj.repo_url);
        if (live) row.appendChild(el('a', { class: 'pf-linkbtn', href: live, target: '_blank', rel: 'noopener noreferrer' }, 'Open', icon('external')));
        if (repo) row.appendChild(el('a', { class: 'pf-linkbtn', href: repo, target: '_blank', rel: 'noopener noreferrer' }, 'Code', icon('code')));
        return row;
    }

    function projectCard(pj) {
        const mine = !!(state.me && pj.owner_id === state.me.id);
        const owner = pj.owner_profile;

        const credit = (pj.reposted_at && owner)
            ? el('a', { class: 'pf-credit', href: 'profile.html?u=' + encodeURIComponent(owner.username) },
                icon('repost'), 'Reposted from ', el('strong', { text: '@' + owner.username }))
            : null;

        const tags = el('ul', { class: 'pf-tags' });
        (pj.tags || []).forEach(function (t) { tags.appendChild(el('li', { text: String(t) })); });

        const links = projectLinks(pj);

        const eng = el('div', { class: 'pf-card-eng' });
        eng.appendChild(engBtn('like', pj));
        eng.appendChild(engBtn('comment', pj));
        if (!mine) eng.appendChild(engBtn('repost', pj));
        eng.appendChild(el('button', {
            type: 'button', class: 'pf-eng pf-eng--share', title: 'Share', 'aria-label': 'Share project',
            onclick: function (e) { e.stopPropagation(); shareProject(pj); }
        }, icon('share')));

        const more = el('button', {
            type: 'button', class: 'pf-eng pf-eng--more', title: 'More actions',
            'aria-label': 'More project actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false'
        }, icon('more'));
        more.addEventListener('click', function (e) { e.stopPropagation(); openProjectMenu(pj, more); });
        eng.appendChild(more);

        if (mine) {
            eng.appendChild(el('div', { class: 'pf-owner-tools' },
                el('button', { type: 'button', class: 'pf-iconbtn', 'aria-label': 'Edit ' + pj.title, title: 'Edit', onclick: function () { openProject(pj); } }, icon('pencil')),
                el('button', { type: 'button', class: 'pf-iconbtn pf-iconbtn--danger', 'aria-label': 'Delete ' + pj.title, title: 'Delete', onclick: function () { deleteProject(pj); } }, icon('trash'))));
        }

        return el('article', { class: 'pf-card' },
            credit,
            projectMedia(pj),
            el('div', { class: 'pf-card-body' },
                el('h3', { class: 'pf-card-title' },
                    el('button', { type: 'button', class: 'pf-card-titlebtn', text: pj.title, onclick: function () { openDetails(pj, false); } })),
                pj.summary ? el('p', { class: 'pf-card-sum', text: pj.summary }) : null,
                (pj.tags || []).length ? tags : null,
                links.children.length ? links : null,
                eng));
    }

    function renderReposts() {
        const grid = $('pfReposts');
        const empty = $('pfRepostsEmpty');
        if (!grid || !empty) return;
        grid.textContent = '';

        const list = state.reposts.filter(function (p) { return !hiddenIds.has(p.id); });
        list.forEach(function (pj) { grid.appendChild(projectCard(pj)); });

        empty.hidden = list.length > 0;
        if (!empty.hidden) {
            empty.textContent = state.isOwner
                ? 'You have not reposted anything yet. Tap Repost on a project you like and it shows up here.'
                : 'No reposts yet.';
        }
    }

    /* ---------- project details + comments popup ---------- */
    let detailPj = null;
    let detailComments = [];
    let postingComment = false;
    let reportPj = null;

    const REPORT_REASONS = [
        ['spam', 'Spam or scam'],
        ['inappropriate', 'Inappropriate content'],
        ['harassment', 'Harassment or hate'],
        ['copyright', 'Stolen work'],
        ['other', 'Something else']
    ];

    function buildSocialDialogs() {
        if ($('pdDlg')) return;

        // ----- details + comments -----
        const detail = el('dialog', { class: 'pf-dlg pf-dlg--wide', id: 'pdDlg', 'aria-labelledby': 'pdTitle' },
            el('header', { class: 'pf-dlg-head' },
                el('h2', { id: 'pdTitle' }),
                el('button', { type: 'button', class: 'pf-x', 'data-close': '', 'aria-label': 'Close' })),
            el('div', { class: 'pf-dlg-body', id: 'pdBody' },
                el('div', { class: 'pd-media', id: 'pdMedia' }),
                el('p', { class: 'pd-by', id: 'pdBy' }),
                el('p', { class: 'pd-summary', id: 'pdSummary' }),
                el('ul', { class: 'pf-tags', id: 'pdTags' }),
                el('div', { id: 'pdLinks' }),
                el('div', { class: 'pd-eng', id: 'pdEng' }),
                el('h3', { class: 'pf-h3 pd-h3' }, 'COMMENTS ', el('span', { id: 'pdCount' })),
                el('div', { class: 'pd-comments', id: 'pdComments' })),
            el('form', { class: 'pd-compose', id: 'pdForm', novalidate: '' },
                el('label', { class: 'pf-sr', for: 'pdInput', text: 'Write a comment' }),
                el('textarea', { class: 'pf-input pf-textarea pd-input', id: 'pdInput', rows: '1', maxlength: '500', placeholder: 'Write a comment...' }),
                el('button', { type: 'submit', class: 'pf-btn', id: 'pdPost' },
                    el('span', { class: 'pf-btn-label', text: 'Post' }), el('span', { class: 'pf-spin', 'aria-hidden': 'true' }))));
        document.body.appendChild(detail);

        detail.addEventListener('close', function () {
            $('pdMedia').textContent = '';       // also stops any playing video
            detailPj = null;
            try { if (/^#project-/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
        });

        $('pdForm').addEventListener('submit', submitComment);
        $('pdInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if ($('pdForm').requestSubmit) $('pdForm').requestSubmit(); else submitComment(new Event('submit', { cancelable: true }));
            }
        });

        // ----- report -----
        const reasons = el('div', { class: 'rp-reasons', role: 'radiogroup', 'aria-label': 'Reason' });
        REPORT_REASONS.forEach(function (r, i) {
            reasons.appendChild(el('label', { class: 'rp-reason' },
                el('input', { type: 'radio', name: 'rpReason', value: r[0], checked: i === 0 }),
                el('span', { text: r[1] })));
        });

        const report = el('dialog', { class: 'pf-dlg pf-dlg--small', id: 'rpDlg', 'aria-labelledby': 'rpTitle' },
            el('form', { id: 'rpForm', novalidate: '' },
                el('header', { class: 'pf-dlg-head' },
                    el('h2', { id: 'rpTitle', text: 'Report project' }),
                    el('button', { type: 'button', class: 'pf-x', 'data-close': '', 'aria-label': 'Close' })),
                el('div', { class: 'pf-dlg-body' },
                    el('div', { class: 'pf-msg', id: 'rpMsg', role: 'alert' }),
                    el('p', { class: 'pf-help', text: 'Tell us what is wrong. Only the site team can see reports.' }),
                    reasons,
                    el('div', { class: 'pf-field' },
                        el('label', { class: 'pf-label', for: 'rpNote' }, 'DETAILS (OPTIONAL)'),
                        el('textarea', { class: 'pf-input pf-textarea', id: 'rpNote', rows: '3', maxlength: '300' }))),
                el('footer', { class: 'pf-dlg-foot' },
                    el('button', { type: 'button', class: 'pf-btn pf-btn--ghost', 'data-close': '' }, 'Cancel'),
                    el('button', { type: 'submit', class: 'pf-btn', id: 'rpSend' },
                        el('span', { class: 'pf-btn-label', text: 'Send report' }), el('span', { class: 'pf-spin', 'aria-hidden': 'true' })))));
        document.body.appendChild(report);

        $('rpForm').addEventListener('submit', submitReport);
    }

    function commentNode(c) {
        const a = c.author || {};
        const name = a.display_name || a.username || 'member';
        const canDelete = !!(state.me && detailPj && (c.user_id === state.me.id || detailPj.owner_id === state.me.id));
        const av = avatarEl({ name: name, avatar: safeHttps(a.avatar_url) || '' });
        const profileHref = a.username ? 'profile.html?u=' + encodeURIComponent(a.username) : null;

        return el('article', { class: 'pd-cmt', dataset: { id: c.id } },
            profileHref ? el('a', { class: 'pd-cmt-av', href: profileHref, 'aria-label': name }, av) : av,
            el('div', { class: 'pd-cmt-main' },
                el('div', { class: 'pd-cmt-head' },
                    profileHref ? el('a', { class: 'pd-cmt-name', href: profileHref, text: name }) : el('span', { class: 'pd-cmt-name', text: name }),
                    el('time', { class: 'pd-cmt-time', datetime: c.created_at, text: timeAgo(c.created_at) })),
                el('p', { class: 'pd-cmt-body', text: c.body })),
            canDelete
                ? el('button', { type: 'button', class: 'pf-iconbtn pf-iconbtn--danger pd-cmt-del', 'aria-label': 'Delete comment', title: 'Delete', onclick: function () { deleteComment(c); } }, icon('trash'))
                : null);
    }

    function renderComments() {
        const box = $('pdComments');
        box.textContent = '';
        if (!detailComments.length) {
            box.appendChild(el('p', { class: 'pf-empty pd-empty', text: 'No comments yet. Be the first.' }));
        } else {
            detailComments.forEach(function (c) { box.appendChild(commentNode(c)); });
        }
        $('pdCount').textContent = detailComments.length ? '(' + detailComments.length + ')' : '';
        if (detailPj) { detailPj.comment_count = detailComments.length; syncEng(detailPj); }
    }

    async function loadComments(pj) {
        const res = await sb.from('profile_project_comments')
            .select('id,user_id,body,created_at,author:profiles(username,display_name,avatar_url)')
            .eq('project_id', pj.id)
            .order('created_at', { ascending: true })
            .limit(200);
        if (res.error) throw res.error;
        return res.data || [];
    }

    function openDetails(pj, focusInput) {
        buildSocialDialogs();
        closeProjectMenu(false);
        detailPj = pj;
        detailComments = [];

        $('pdTitle').textContent = pj.title;
        const media = $('pdMedia');
        media.textContent = '';
        media.appendChild(projectMedia(pj));

        const by = $('pdBy');
        by.textContent = '';
        const owner = pj.owner_profile || (state.profile && state.profile.id === pj.owner_id ? state.profile : null);
        if (owner) {
            by.appendChild(document.createTextNode('By '));
            by.appendChild(el('a', { href: 'profile.html?u=' + encodeURIComponent(owner.username), text: '@' + owner.username }));
        }

        $('pdSummary').textContent = pj.summary || '';
        $('pdSummary').hidden = !pj.summary;

        const tags = $('pdTags');
        tags.textContent = '';
        (pj.tags || []).forEach(function (t) { tags.appendChild(el('li', { text: String(t) })); });
        tags.hidden = !(pj.tags || []).length;

        const links = $('pdLinks');
        links.textContent = '';
        links.appendChild(projectLinks(pj));

        const eng = $('pdEng');
        eng.textContent = '';
        const mine = !!(state.me && pj.owner_id === state.me.id);
        eng.appendChild(engBtn('like', pj));
        if (!mine) eng.appendChild(engBtn('repost', pj));
        eng.appendChild(el('button', { type: 'button', class: 'pf-eng pf-eng--share', title: 'Share', 'aria-label': 'Share project', onclick: function () { shareProject(pj); } }, icon('share')));

        $('pdForm').hidden = !state.me;
        $('pdInput').value = '';
        $('pdComments').textContent = '';
        $('pdComments').appendChild(el('p', { class: 'pf-empty pd-empty', text: 'Loading comments...' }));
        if (!state.me) {
            $('pdComments').appendChild(el('p', { class: 'pd-guest' }, el('a', { href: 'login.html', text: 'Log in' }), ' to comment.'));
        }

        openDlg($('pdDlg'));
        try { history.replaceState(null, '', location.pathname + location.search + '#project-' + pj.id); } catch (e) { /* ignore */ }

        loadComments(pj).then(function (rows) {
            if (detailPj !== pj) return;
            detailComments = rows;
            renderComments();
            if (!state.me) $('pdComments').appendChild(el('p', { class: 'pd-guest' }, el('a', { href: 'login.html', text: 'Log in' }), ' to comment.'));
        }).catch(function (err) {
            if (detailPj !== pj) return;
            $('pdComments').textContent = '';
            $('pdComments').appendChild(el('p', { class: 'pf-empty pd-empty', text: isSocialMissing(err) ? 'Run supabase-project-social.sql in Supabase to turn on comments.' : friendly(err) }));
        });

        if (focusInput && state.me) setTimeout(function () { $('pdInput').focus(); }, 60);
    }

    async function submitComment(e) {
        e.preventDefault();
        if (!state.me || !detailPj || postingComment) return;
        const input = $('pdInput');
        const body = input.value.trim();
        if (!body) return;
        if (!needSocial()) return;

        postingComment = true;
        const btn = $('pdPost');
        setLoading(btn, true);
        try {
            const res = await sb.from('profile_project_comments')
                .insert({ project_id: detailPj.id, user_id: state.me.id, body: body })
                .select('id,user_id,body,created_at,author:profiles(username,display_name,avatar_url)')
                .single();
            if (res.error) throw res.error;
            detailComments.push(res.data);
            input.value = '';
            renderComments();
            const bodyEl = $('pdBody');
            bodyEl.scrollTop = bodyEl.scrollHeight;
        } catch (err) {
            toast(socialError(err, 'comment'));
        } finally {
            postingComment = false;
            setLoading(btn, false);
        }
    }

    async function deleteComment(c) {
        if (!window.confirm('Delete this comment?')) return;
        try {
            const res = await sb.from('profile_project_comments').delete().eq('id', c.id);
            if (res.error) throw res.error;
            detailComments = detailComments.filter(function (x) { return x.id !== c.id; });
            renderComments();
        } catch (err) {
            toast(friendly(err));
        }
    }

    function openReport(pj) {
        buildSocialDialogs();
        if (!state.me) { toast('Log in to report a project.'); return; }
        reportPj = pj;
        showMsg('rpMsg', '');
        $('rpNote').value = '';
        const first = document.querySelector('input[name="rpReason"]');
        if (first) first.checked = true;
        openDlg($('rpDlg'));
    }

    async function submitReport(e) {
        e.preventDefault();
        if (!state.me || !reportPj || saving) return;
        if (!needSocial()) return;
        const reason = (document.querySelector('input[name="rpReason"]:checked') || {}).value || 'other';
        const btn = $('rpSend');
        saving = true;
        setLoading(btn, true);
        try {
            const res = await sb.from('profile_project_reports').insert({
                project_id: reportPj.id, reporter_id: state.me.id, reason: reason, note: $('rpNote').value.trim() || null
            });
            if (res.error) throw res.error;
            $('rpDlg').close();
            toast('Thanks, the team will take a look');
        } catch (err) {
            showMsg('rpMsg', socialError(err, 'report'));
        } finally {
            saving = false;
            setLoading(btn, false);
        }
    }

    // a shared link ends in #project-<id>: open that project's popup
    function openHashProject() {
        const m = /^#project-([0-9a-fA-F-]{36})$/.exec(location.hash);
        if (!m) return;
        const id = m[1].toLowerCase();
        const pj = state.projects.concat(state.reposts).find(function (p) { return String(p.id).toLowerCase() === id; });
        if (pj) openDetails(pj, false);
    }

    /* ---------- tabs: Projects | About Me | Reposts ---------- */
    function ensureTabs() {
        const tabs = document.querySelector('.pf-tabs');
        if (!tabs) return;

        const pj = $('pfTabProjects'), about = $('pfTabAbout');
        if (pj) pj.textContent = 'PROJECTS';
        if (about) about.textContent = 'ABOUT ME';

        if (!$('pfTabReposts')) {
            tabs.appendChild(el('button', {
                type: 'button', class: 'pf-tab', role: 'tab', id: 'pfTabReposts', text: 'REPOSTS',
                'aria-selected': 'false', 'aria-controls': 'pfPanelReposts', dataset: { tab: 'reposts' }
            }));
        }

        if (!$('pfPanelReposts')) {
            const panel = el('section', { class: 'pf-panel', id: 'pfPanelReposts', role: 'tabpanel', 'aria-labelledby': 'pfTabReposts', hidden: true },
                el('div', { class: 'pf-grid', id: 'pfReposts' }),
                el('p', { class: 'pf-empty', id: 'pfRepostsEmpty', hidden: true }));
            const after = $('pfPanelAbout') || $('pfPanelProjects');
            if (after && after.parentNode) after.parentNode.insertBefore(panel, after.nextSibling);
        }

        tabs.addEventListener('click', function (e) {
            const t = e.target.closest('.pf-tab');
            if (t) switchTab(t.dataset.tab);
        });
    }

    function switchTab(name) {
        if (['projects', 'about', 'reposts'].indexOf(name) < 0) name = 'projects';
        state.tab = name;
        document.querySelectorAll('.pf-tab').forEach(function (t) {
            t.setAttribute('aria-selected', String(t.dataset.tab === name));
        });
        [['projects', 'pfPanelProjects'], ['about', 'pfPanelAbout'], ['reposts', 'pfPanelReposts']].forEach(function (p) {
            const node = $(p[1]);
            if (node) node.hidden = name !== p[0];
        });
        closeProjectMenu(false);
    }

    ensureTabs();
    buildSocialDialogs();       // created before the dialog wiring below, so they get the same close/backdrop handling
    /* END project-social */


    /* ----------------------------------------------------------------------
       7. DISCOVER MEMBERS
       ---------------------------------------------------------------------- */
    let searchTimer = null;

    async function loadMembers(q) {
        const box = $('pfMembers');
        const empty = $('pfMembersEmpty');
        q = (q || '').trim().replace(/^@/, '');
        let query = sb.from('profiles').select('username,display_name,avatar_url,headline');
        if (q) query = query.ilike('username', '%' + escapeLike(q) + '%');

        const res = await query.order('created_at', { ascending: false }).limit(12);
        box.textContent = '';
        if (res.error) {
            empty.hidden = false;
            empty.textContent = isMissingTables(res.error) ? 'Profiles are not set up yet.' : 'Could not load members.';
            return;
        }

        (res.data || []).forEach(function (m) {
            const name = m.display_name || m.username;
            box.appendChild(el('a', { class: 'pf-member', href: 'profile.html?u=' + encodeURIComponent(m.username) },
                avatarEl({ name: name, avatar: safeHttps(m.avatar_url) || '' }),
                el('span', { class: 'pf-member-text' },
                    el('span', { class: 'pf-member-name', text: name }),
                    el('span', { class: 'pf-member-sub', text: '@' + m.username }))));
        });

        empty.hidden = (res.data || []).length > 0;
        if (!empty.hidden) empty.textContent = q ? 'No members match that search.' : 'No members yet.';
    }

    $('pfSearchIcon').innerHTML = ICON.search;
    $('pfSearch').addEventListener('input', function (e) {
        clearTimeout(searchTimer);
        const v = e.target.value;
        searchTimer = setTimeout(function () { if (sb) loadMembers(v); }, 300);
    });

    /* ----------------------------------------------------------------------
       8. DIALOG PLUMBING
       ---------------------------------------------------------------------- */
    let lastFocus = null;

    function openDlg(dlg) {
        lastFocus = document.activeElement;
        dlg.showModal();
        document.documentElement.classList.add('pf-lock');
    }

    document.querySelectorAll('.pf-dlg').forEach(function (dlg) {
        dlg.addEventListener('close', function () {
            if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('pf-lock');
            if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        });
        dlg.addEventListener('click', function (e) {
            if (e.target === dlg) dlg.close();
            if (e.target.closest && e.target.closest('[data-close]')) dlg.close();
        });
    });

    function counter(inputId, countId, max) {
        const input = $(inputId), out = $(countId);
        const update = function () { out.textContent = input.value.length + '/' + max; };
        input.addEventListener('input', update);
        return update;
    }

    const updBio = counter('edBio', 'edBioCount', 500);
    const updPj = counter('pjSummary', 'pjSummaryCount', 280);
    const updHl = counter('hlBody', 'hlBodyCount', 280);

    /* ----------------------------------------------------------------------
       9. EDIT PROFILE
       ---------------------------------------------------------------------- */
    const edit = { avatarBlob: null, avatarType: '', avatarReset: false, avatarPreviewUrl: '',
                   bannerBlob: null, bannerType: '', bannerReset: false,
                   backgroundBlob: null, backgroundType: '', backgroundReset: false };

    // presets + status options are built once
    (function buildChoices() {
        const presets = $('edPresets');
        PRESETS.forEach(function (p) {
            presets.appendChild(el('label', { class: 'pf-preset' },
                el('input', { type: 'radio', name: 'edPreset', value: p, 'aria-label': p + ' banner' }),
                el('span', { class: 'pf-preset-prev pf-banner--' + p })));
        });

        const sts = $('edStatuses');
        Object.keys(STATUS).forEach(function (k) {
            const card = el('span', { class: 'pf-status-card' });
            card.innerHTML = statusIcon(k);
            card.appendChild(document.createTextNode(STATUS[k].label));
            sts.appendChild(el('label', { class: 'pf-status-opt' },
                el('input', { type: 'radio', name: 'edStatus', value: k }), card));
        });
    })();

    function paintAvatarPreview() {
        const p = state.profile;
        const box = $('edAvatarPreview');
        box.textContent = '';
        const name = $('edDisplay').value.trim() || p.username;
        let url = '';
        if (edit.avatarBlob) url = edit.avatarPreviewUrl;
        else if (!edit.avatarReset) url = safeHttps(p.avatar_url) || '';
        box.appendChild(avatarEl({ name: name, avatar: url }));
    }

    function openEdit() {
        const p = state.profile;
        edit.avatarBlob = null; edit.avatarReset = false; edit.bannerBlob = null; edit.bannerReset = false;
        edit.backgroundBlob = null; edit.backgroundReset = false;
        if (edit.avatarPreviewUrl) { URL.revokeObjectURL(edit.avatarPreviewUrl); edit.avatarPreviewUrl = ''; }
        $('edAvatarFile').value = '';
        $('edBannerFile').value = '';
        $('edBackgroundFile').value = '';
        $('edBannerName').textContent = p.banner_url ? 'Current image kept' : '';
        $('edBackgroundName').textContent = p.background_url ? 'Current image kept' : '';
        showMsg('edMsg', '');

        $('edDisplay').value = p.display_name || '';
        $('edUsername').value = p.username;
        $('edHeadline').value = p.headline || '';
        $('edLocation').value = p.location || '';
        $('edBio').value = p.bio || '';
        $('edSkills').value = (p.skills || []).join(', ');
        const L = (p.links && typeof p.links === 'object') ? p.links : {};
        $('edGithub').value = L.github || '';
        $('edRoblox').value = L.roblox || '';
        $('edWebsite').value = L.website || '';
        $('edDiscord').value = L.discord || '';

        const preset = document.querySelector('input[name="edPreset"][value="' + (PRESETS.indexOf(p.banner_preset) >= 0 ? p.banner_preset : 'grid') + '"]');
        if (preset) preset.checked = true;
        const stat = document.querySelector('input[name="edStatus"][value="' + (STATUS[p.status] ? p.status : 'online') + '"]');
        if (stat) stat.checked = true;

        const theme = themeForProfile(p);
        $('edThemePrimary').value = theme.primary;
        $('edThemeSecondary').value = theme.secondary;
        $('edThemeTop').value = theme.top;
        $('edThemeBottom').value = theme.bottom;

        const formStyle = normalizeDisplayStyle(p.display_style);
        $('edNameFont').value = formStyle.font;
        $('edNameStyle').value = formStyle.style;
        $('edNameAnimatedGradient').checked = !!formStyle.animated;
        $('edNameGlowColor').value = formStyle.glowColor || '#7c3aed';
        $('edNameGrad1').value = formStyle.gradientColors[0] || '#7c3aed';
        $('edNameGrad2').value = formStyle.gradientColors[1] || '#22d3ee';
        $('edNameGrad3').value = formStyle.gradientColors[2] || '#f472b6';
        $('edNameGrad4').value = formStyle.gradientColors[3] || '#fbbf24';
        $('edNameGrad5').value = formStyle.gradientColors[4] || '#a78bfa';
        updateNameStyleControls();

        updBio();
        paintAvatarPreview();
        openDlg($('edDlg'));
    }

    $('edDisplay').addEventListener('input', function () { if (!edit.avatarBlob && (edit.avatarReset || !safeHttps(state.profile.avatar_url))) paintAvatarPreview(); });
    $('edNameFont').addEventListener('change', updateNameStyleControls);
    $('edNameStyle').addEventListener('change', updateNameStyleControls);
    $('edNameGlowColor').addEventListener('input', updateNameStyleControls);
    $('edNameGrad1').addEventListener('input', updateNameStyleControls);
    $('edNameGrad2').addEventListener('input', updateNameStyleControls);
    $('edNameGrad3').addEventListener('input', updateNameStyleControls);
    $('edNameGrad4').addEventListener('input', updateNameStyleControls);
    $('edNameGrad5').addEventListener('input', updateNameStyleControls);

    // downscale + crop in the browser: small files, and it strips camera/location metadata
    async function resizeToBlob(file, maxW, maxH, square) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise(function (resolve, reject) {
                const i = new Image();
                i.onload = function () { resolve(i); };
                i.onerror = function () { reject(new Error('That file is not a readable image.')); };
                i.src = url;
            });

            let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
            if (square) {
                const s = Math.min(sw, sh);
                sx = Math.floor((sw - s) / 2); sy = Math.floor((sh - s) / 2); sw = s; sh = s;
            }
            const ratio = Math.min(1, maxW / sw, maxH / sh);
            const w = Math.max(1, Math.round(sw * ratio)), h = Math.max(1, Math.round(sh * ratio));

            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

            const type = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
            const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, type, 0.86); });
            if (!blob) throw new Error('Could not process that image.');
            return { blob: blob, type: type };
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function checkImageFile(file) {
        if (!file) return 'No file chosen.';
        if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) < 0) return 'Use a PNG, JPG or WebP image.';
        if (file.size > 12 * 1024 * 1024) return 'That image is over 12 MB. Pick a smaller one.';
        return '';
    }

    $('edAvatarFile').addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const bad = checkImageFile(file);
        if (bad) { showMsg('edMsg', bad); e.target.value = ''; return; }
        try {
            const out = await resizeToBlob(file, 256, 256, true);
            edit.avatarBlob = out.blob; edit.avatarType = out.type; edit.avatarReset = false;
            if (edit.avatarPreviewUrl) URL.revokeObjectURL(edit.avatarPreviewUrl);
            edit.avatarPreviewUrl = URL.createObjectURL(out.blob);
            showMsg('edMsg', '');
            paintAvatarPreview();
        } catch (err) { showMsg('edMsg', err.message || 'Could not use that image.'); }
    });

    $('edAvatarReset').addEventListener('click', function () {
        edit.avatarBlob = null; edit.avatarReset = true;
        $('edAvatarFile').value = '';
        paintAvatarPreview();
    });

    $('edBannerFile').addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const bad = checkImageFile(file);
        if (bad) { showMsg('edMsg', bad); e.target.value = ''; return; }
        try {
            const out = await resizeToBlob(file, 1600, 600, false);
            edit.bannerBlob = out.blob; edit.bannerType = out.type; edit.bannerReset = false;
            $('edBannerName').textContent = file.name;
            showMsg('edMsg', '');
        } catch (err) { showMsg('edMsg', err.message || 'Could not use that image.'); }
    });

    $('edBannerReset').addEventListener('click', function () {
        edit.bannerBlob = null; edit.bannerReset = true;
        $('edBannerFile').value = '';
        $('edBannerName').textContent = 'Image will be removed when you save';
    });

    $('edBackgroundFile').addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const bad = checkImageFile(file);
        if (bad) { showMsg('edMsg', bad); e.target.value = ''; return; }
        try {
            const out = await resizeToBlob(file, 1800, 1200, false);
            edit.backgroundBlob = out.blob; edit.backgroundType = out.type; edit.backgroundReset = false;
            $('edBackgroundName').textContent = file.name;
            showMsg('edMsg', '');
        } catch (err) { showMsg('edMsg', err.message || 'Could not use that image.'); }
    });

    $('edBackgroundReset').addEventListener('click', function () {
        edit.backgroundBlob = null; edit.backgroundReset = true;
        $('edBackgroundFile').value = '';
        $('edBackgroundName').textContent = 'Image will be removed when you save';
    });

    async function uploadImage(bucket, blob, type) {
        const ext = type === 'image/webp' ? 'webp' : 'jpg';
        const path = state.me.id + '/' + Date.now() + '.' + ext;
        const up = await sb.storage.from(bucket).upload(path, blob, { contentType: type, cacheControl: '3600', upsert: false });
        if (up.error) throw up.error;
        return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }

    async function removeOldImage(bucket, url) {
        const path = storagePath(url, bucket);
        if (!path || path.indexOf(state.me.id + '/') !== 0) return;
        try { await sb.storage.from(bucket).remove([path]); } catch (e) { /* best effort */ }
    }

    let saving = false;

    $('edForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        if (saving || !state.isOwner) return;
        const btn = $('edSave');
        showMsg('edMsg', '');

        // ---- validate ----
        const username = $('edUsername').value.trim();
        if (!RE_USER.test(username)) { showMsg('edMsg', 'Username: 3 to 20 characters, letters, numbers and underscores only.'); $('edUsername').focus(); return; }

        const links = {};
        const urlFields = [['github', 'edGithub', 'GitHub'], ['roblox', 'edRoblox', 'Roblox'], ['website', 'edWebsite', 'Website']];
        for (let i = 0; i < urlFields.length; i++) {
            const r = httpsUrl($(urlFields[i][1]).value);
            if (!r.ok) { showMsg('edMsg', urlFields[i][2] + ' link must start with https:// and be a real address.'); $(urlFields[i][1]).focus(); return; }
            if (r.value) links[urlFields[i][0]] = r.value;
        }
        const discord = $('edDiscord').value.trim().slice(0, 40);
        if (discord) links.discord = discord;

        const preset = (document.querySelector('input[name="edPreset"]:checked') || {}).value || 'grid';
        const status = (document.querySelector('input[name="edStatus"]:checked') || {}).value || 'online';
        const theme = {
            primary: $('edThemePrimary').value || '#7c3aed',
            secondary: $('edThemeSecondary').value || '#22d3ee',
            top: $('edThemeTop').value || '#0f172a',
            bottom: $('edThemeBottom').value || '#1e293b'
        };

        const displayStyle = normalizeDisplayStyle({
            font: $('edNameFont').value || 'default',
            style: $('edNameStyle').value || 'solid',
            animated: $('edNameAnimatedGradient').checked,
            glowColor: $('edNameGlowColor').value || '#7c3aed',
            gradientColors: [
                $('edNameGrad1').value || '#7c3aed',
                $('edNameGrad2').value || '#22d3ee',
                $('edNameGrad3').value || '#f472b6',
                $('edNameGrad4').value || '#fbbf24',
                $('edNameGrad5').value || '#a78bfa'
            ]
        });

        const patch = {
            username: username,
            display_name: $('edDisplay').value.trim() || null,
            headline: $('edHeadline').value.trim() || null,
            location: $('edLocation').value.trim() || null,
            bio: $('edBio').value.trim() || null,
            skills: parseTags($('edSkills').value, 12, 24),
            links: links,
            theme: theme,
            display_style: displayStyle,
            status: status,
            banner_preset: preset,
            updated_at: new Date().toISOString()
        };

        saving = true;
        setLoading(btn, true);
        const old = { avatar: state.profile.avatar_url, banner: state.profile.banner_url, background: state.profile.background_url };

        try {
            if (edit.avatarBlob) patch.avatar_url = await uploadImage('avatars', edit.avatarBlob, edit.avatarType);
            else if (edit.avatarReset) patch.avatar_url = null;

            if (edit.bannerBlob) patch.banner_url = await uploadImage('banners', edit.bannerBlob, edit.bannerType);
            else if (edit.bannerReset) patch.banner_url = null;

            if (edit.backgroundBlob) patch.background_url = await uploadImage('banners', edit.backgroundBlob, edit.backgroundType);
            else if (edit.backgroundReset) patch.background_url = null;

            const res = await sb.from('profiles').update(patch).eq('id', state.me.id).select().single();
            if (res.error) throw res.error;
            state.profile = res.data;

            // keep the login data in step: this is what updates the top bar chip on every page
            try {
                await sb.auth.updateUser({ data: { username: res.data.username, sp_avatar: res.data.avatar_url || '' } });
            } catch (err) { /* profile is saved; the top bar catches up at the next login */ }

            // clean up replaced images (best effort)
            if (patch.avatar_url !== undefined && old.avatar && old.avatar !== patch.avatar_url) removeOldImage('avatars', old.avatar);
            if (patch.banner_url !== undefined && old.banner && old.banner !== patch.banner_url) removeOldImage('banners', old.banner);
            if (patch.background_url !== undefined && old.background && old.background !== patch.background_url) removeOldImage('banners', old.background);

            if (new URLSearchParams(location.search).get('u')) {
                try { history.replaceState(null, '', location.pathname + '?u=' + encodeURIComponent(res.data.username)); } catch (err) { /* ignore */ }
            }

            $('edDlg').close();
            renderProfile();
            if (window.SpecAuth) window.SpecAuth.refresh();
            toast('Profile saved');
        } catch (err) {
            showMsg('edMsg', friendly(err));
        } finally {
            saving = false;
            setLoading(btn, false);
        }
    });

    /* ----------------------------------------------------------------------
       10. PROJECTS (add, edit, delete)
       ---------------------------------------------------------------------- */
    function openProject(pj) {
        showMsg('pjMsg', '');
        $('pjTitleH').textContent = pj ? 'Edit project' : 'New project';
        $('pjId').value = pj ? pj.id : '';
        $('pjTitle').value = pj ? pj.title : '';
        $('pjSummary').value = pj && pj.summary ? pj.summary : '';
        $('pjUrl').value = pj && pj.url ? pj.url : '';
        $('pjRepo').value = pj && pj.repo_url ? pj.repo_url : '';
        $('pjCover').value = pj && pj.cover_url ? pj.cover_url : '';
        $('pjVideo').value = pj && pj.video_url ? pj.video_url : '';
        $('pjTags').value = pj ? (pj.tags || []).join(', ') : '';
        $('pjPinned').checked = !!(pj && pj.pinned);
        if ($('pjCategory')) $('pjCategory').value = pj && pj.category ? pj.category : 'other';
        if ($('pjHub')) $('pjHub').checked = pj ? pj.show_in_hub !== false : true;
        updPj();
        openDlg($('pjDlg'));
    }

    $('pjForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        if (saving || !state.isOwner) return;
        const btn = $('pjSave');
        showMsg('pjMsg', '');

        const title = $('pjTitle').value.trim();
        if (!title) { showMsg('pjMsg', 'Give your project a title.'); $('pjTitle').focus(); return; }

        const fields = [['url', 'pjUrl', 'Live link'], ['repo_url', 'pjRepo', 'Code link'], ['cover_url', 'pjCover', 'Cover image link'], ['video_url', 'pjVideo', 'Video link']];
        const row = {
            title: title,
            summary: $('pjSummary').value.trim() || null,
            tags: parseTags($('pjTags').value, 6, 20),
            pinned: $('pjPinned').checked
        };
        // Projects Hub fields (only sent when the form has them, so nothing breaks before supabase-hub.sql is installed)
        if ($('pjCategory')) row.category = $('pjCategory').value;
        if ($('pjHub')) row.show_in_hub = $('pjHub').checked;
        for (let i = 0; i < fields.length; i++) {
            const r = httpsUrl($(fields[i][1]).value);
            if (!r.ok) { showMsg('pjMsg', fields[i][2] + ' must start with https:// and be a real address.'); $(fields[i][1]).focus(); return; }
            row[fields[i][0]] = r.value;
        }

        saving = true;
        setLoading(btn, true);
        try {
            const id = $('pjId').value;
            const res = id
                ? await sb.from('profile_projects').update(row).eq('id', id)
                : await sb.from('profile_projects').insert(Object.assign({ owner_id: state.me.id }, row));
            if (res.error) throw res.error;

            await reloadProjects();
            $('pjDlg').close();
            toast(id ? 'Project updated' : ($('pjHub') && $('pjHub').checked ? 'Project posted to your profile and the Projects Hub' : 'Project posted'));
        } catch (err) {
            showMsg('pjMsg', friendly(err));
        } finally {
            saving = false;
            setLoading(btn, false);
        }
    });

    async function deleteProject(pj) {
        if (!window.confirm('Delete "' + pj.title + '"? This cannot be undone.')) return;
        try {
            const res = await sb.from('profile_projects').delete().eq('id', pj.id);
            if (res.error) throw res.error;
            await reloadProjects();
            toast('Project deleted');
        } catch (err) { toast(friendly(err)); }
    }

    /* ----------------------------------------------------------------------
       11. HIGHLIGHTS
       ---------------------------------------------------------------------- */
    let viewing = null;

    function checkHighlightImageFile(file) {
        if (!file) return 'No file chosen.';
        if (['image/gif', 'image/jpeg', 'image/png'].indexOf(file.type) < 0) return 'Use a GIF, PNG or JPG highlight image.';
        if (file.size > 8 * 1024 * 1024) return 'That highlight image is over 8 MB. Pick a smaller one.';
        return '';
    }

    async function uploadHighlightImage(file) {
        const extMap = { 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/png': 'png' };
        const ext = extMap[file.type] || 'jpg';
        const path = state.me.id + '/highlight-' + Date.now() + '.' + ext;
        const up = await sb.storage.from('banners').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
        if (up.error) throw up.error;
        return sb.storage.from('banners').getPublicUrl(path).data.publicUrl;
    }

    function resetHighlightThumbnailUi() {
        $('hlThumbFile').value = '';
        $('hlThumbName').textContent = 'GIF, JPG or PNG only.';
        const preview = $('hlThumbPreview');
        preview.hidden = true;
        preview.style.backgroundImage = 'none';
        preview.removeAttribute('style');
        preview.textContent = '';
    }

    $('hlThumbFile').addEventListener('change', function (e) {
        const file = e.target.files[0];
        const preview = $('hlThumbPreview');
        const name = $('hlThumbName');
        if (!file) return;
        const bad = checkHighlightImageFile(file);
        if (bad) { showMsg('hlMsg', bad); e.target.value = ''; return; }
        name.textContent = file.name;
        const url = URL.createObjectURL(file);
        preview.hidden = false;
        preview.style.backgroundImage = 'url("' + url + '")';
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.title = file.name;
        showMsg('hlMsg', '');
    });

    $('hlThumbReset').addEventListener('click', function () {
        resetHighlightThumbnailUi();
        showMsg('hlMsg', '');
    });

    function openNewHighlight() {
        showMsg('hlMsg', '');
        $('hlIcon').value = '★';
        $('hlTitle').value = '';
        $('hlBody').value = '';
        $('hlDuration').value = 'permanent';
        resetHighlightThumbnailUi();
        updHl();
        openDlg($('hlDlg'));
    }

    $('hlForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        if (saving || !state.isOwner) return;
        const btn = $('hlSave');
        const title = $('hlTitle').value.trim();
        const icon_ = Array.from($('hlIcon').value.trim()).slice(0, 2).join('') || '★';
        const duration = $('hlDuration').value || 'permanent';
        if (!title) { showMsg('hlMsg', 'Give your highlight a title.'); $('hlTitle').focus(); return; }

        saving = true;
        setLoading(btn, true);
        try {
            let thumbUrl = null;
            const highlightFile = $('hlThumbFile').files && $('hlThumbFile').files[0];
            if (highlightFile) {
                const bad = checkHighlightImageFile(highlightFile);
                if (bad) { showMsg('hlMsg', bad); return; }
                thumbUrl = await uploadHighlightImage(highlightFile);
            }
            const res = await sb.from('profile_highlights').insert({
                owner_id: state.me.id,
                title: title,
                icon: icon_,
                body: $('hlBody').value.trim() || null,
                thumbnail_url: thumbUrl,
                expires_at: getHighlightExpiryIso(duration)
            });
            if (res.error) throw res.error;
            await reloadHighlights();
            $('hlDlg').close();
            toast('Highlight added');
        } catch (err) {
            showMsg('hlMsg', friendly(err));
        } finally {
            saving = false;
            setLoading(btn, false);
        }
    });

    function openHighlight(h) {
        viewing = h;
        $('hvIcon').textContent = h.icon || '★';
        $('hvTitle').textContent = h.title;
        $('hvBody').textContent = h.body || '';
        $('hvBody').hidden = !h.body;
        const thumb = $('hvThumb');
        if (h.thumbnail_url) {
            thumb.src = safeHttps(h.thumbnail_url) || '';
            thumb.hidden = false;
        } else {
            thumb.removeAttribute('src');
            thumb.hidden = true;
        }
        $('hvFoot').hidden = !state.isOwner;
        openDlg($('hlView'));
    }

    $('hvDelete').addEventListener('click', async function () {
        if (!viewing || !window.confirm('Delete this highlight?')) return;
        try {
            const res = await sb.from('profile_highlights').delete().eq('id', viewing.id);
            if (res.error) throw res.error;
            $('hlView').close();
            await reloadHighlights();
            toast('Highlight deleted');
        } catch (err) { toast(friendly(err)); }
    });

    /* ----------------------------------------------------------------------
       12. START UP
       ---------------------------------------------------------------------- */
    async function start() {
        showState('loading');

        if (!sb) { showState('setup'); return; }

        $('pfDiscover').hidden = false;

        let session = null;
        try { session = (await sb.auth.getSession()).data.session; } catch (e) { session = null; }
        state.me = session && session.user ? session.user : null;

        sb.auth.onAuthStateChange(function (event) {
            if (event === 'SIGNED_OUT') location.reload();
        });

        try {
            const wanted = new URLSearchParams(location.search).get('u');

            if (wanted) {
                if (!RE_USER.test(wanted)) { showState('notfound'); loadMembers(''); return; }
                const row = await fetchByUsername(wanted);
                if (!row) { showState('notfound'); loadMembers(''); return; }
                state.profile = row;
            } else if (state.me) {
                state.profile = await ensureMyProfile(state.me);
            } else {
                showState('guest');
                loadMembers('');
                return;
            }

            await loadContent();
            await loadFollowMeta();
            renderProfile();
            openHashProject();
            loadMembers('');
        } catch (err) {
            console.error('Profile load failed:', err);
console.error('Error details:', JSON.stringify(err, null, 2));
            if (isMissingTables(err)) showState('tables');
            else showState('error', friendly(err));
        }
    }

    start();
})();