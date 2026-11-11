/* ==========================================================================
   SPECSOFT® — Chats (chats.js)
   Needs: supabase-config.js (your keys) and supabase-chats.sql (run once).
   ========================================================================== */
(function () {
    'use strict';

    const CFG = window.SPECSOFT_CONFIG || {};
    // Ultra reduce motion (Settings > Appearance) loads fewer messages at a time, so weak PCs have less to draw.
    // Read straight from storage because this file loads before the settings engine.
    const URM = (function () { try { return JSON.parse(localStorage.getItem('specsoft.settings.v1') || '{}').ultraReduceMotion === true; } catch (e) { return false; } })();
    window.SS_URM = URM;     // other chat files (chats-community-settings.js...) can check this to skip images and GIFs
    const PAGE = URM ? 20 : 40;
    // true when the visitor wants less motion: device setting, Reduce motion, or Ultra reduce motion
    function noMotion() {
        try {
            if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
            const cl = document.documentElement.classList;
            return cl.contains('ss-reduce-motion') || cl.contains('ss-urm');
        } catch (e) { return false; }
    }

    /* ----------------------------------------------------------------------
       1. HELPERS (pure functions)
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

    function baseUsername(meta, email) {
        meta = meta || {};
        const list = [meta.username, meta.user_name, meta.full_name, meta.name, String(email || '').split('@')[0]];
        for (let i = 0; i < list.length; i++) {
            const s = sanitizeUsername(list[i]);
            if (s.length >= 3) return s;
        }
        return 'member' + randDigits(4);
    }

    function escapeLike(s) {
        return String(s == null ? '' : s).replace(/[\\%_]/g, function (m) { return '\\' + m; });
    }

    function safeHttps(v) {
        return typeof v === 'string' && /^https:\/\/[^\s]+$/i.test(v) ? v : null;
    }

    // languages we recognise after ``` (what you type -> highlight.js name)
    const LANGS = {
        js: 'javascript', javascript: 'javascript', jsx: 'javascript', ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
        py: 'python', python: 'python', lua: 'lua', luau: 'lua', html: 'xml', xml: 'xml', css: 'css', json: 'json', sql: 'sql',
        bash: 'bash', sh: 'bash', shell: 'bash', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', cs: 'csharp', csharp: 'csharp',
        go: 'go', rust: 'rust', rs: 'rust', php: 'php', ruby: 'ruby', rb: 'ruby', kotlin: 'kotlin', swift: 'swift',
        yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown', diff: 'diff'
    };
    function isLang(x) { return typeof x === 'string' && Object.prototype.hasOwnProperty.call(LANGS, x); }
    const AUTO_LANGS = ['javascript', 'typescript', 'python', 'lua', 'css', 'xml', 'json', 'sql', 'bash', 'java', 'cpp', 'csharp', 'go', 'rust', 'php'];

    // splits a message into code blocks and normal text. ```js\ncode``` keeps the language.
    function parseMessage(text) {
        const out = [];
        const re = /```([\s\S]*?)```/g;
        let last = 0, m;
        while ((m = re.exec(text))) {
            if (m.index > last) out.push({ t: 'inline', v: text.slice(last, m.index) });
            let raw = m[1], lang = '';
            const lm = raw.match(/^([A-Za-z+#]{1,10})[ \t]*\r?\n/);
            if (lm && isLang(lm[1].toLowerCase())) { lang = lm[1].toLowerCase(); raw = raw.slice(lm[0].length); }
            else raw = raw.replace(/^\r?\n/, '');
            out.push({ t: 'block', v: raw.replace(/\r?\n$/, ''), lang: lang });
            last = m.index + m[0].length;
        }
        if (last < text.length) out.push({ t: 'inline', v: text.slice(last) });
        return out;
    }

    // ----- streak invite cards: a message whose body is exactly  [[streak:invite]]
    const STREAK_INVITE_BODY = '[[streak:invite]]';
    function isStreakInvite(body) { return body === STREAK_INVITE_BODY; }

    // ----- bug report cards: a message whose body is  [[bug:{json}]]
    const BUG_SEV = ['low', 'medium', 'high', 'critical'];
    const BUG_STATUS = { open: 'Open', investigating: 'Investigating', fixed: 'Fixed', wontfix: "Won't fix" };
    const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    function parseBug(body) {
        if (typeof body !== 'string' || body.slice(0, 6) !== '[[bug:' || body.slice(-2) !== ']]') return null;
        try {
            const o = JSON.parse(body.slice(6, -2));
            if (!o || typeof o !== 'object' || typeof o.t !== 'string' || !o.t.trim()) return null;
            return {
                t: o.t.slice(0, 80),
                s: BUG_SEV.indexOf(o.s) >= 0 ? o.s : 'medium',
                l: isLang(o.l) ? o.l : '',
                d: typeof o.d === 'string' ? o.d.slice(0, 700) : '',
                c: typeof o.c === 'string' ? o.c.slice(0, 1200) : ''
            };
        } catch (e) { return null; }
    }

    function buildBugBody(b) {
        return '[[bug:' + JSON.stringify({ t: b.t, s: b.s, l: b.l || undefined, d: b.d || undefined, c: b.c || undefined }) + ']]';
    }

    // link helpers for the rich previews
    function snippetIdFromUrl(url) {
        try {
            const u = new URL(url);
            if (u.origin !== location.origin) return null;
            const id = u.searchParams.get('snippet');
            return id && RE_UUID.test(id) ? id.toLowerCase() : null;
        } catch (e) { return null; }
    }

    function githubRepoFromUrl(url) {
        const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?(?:[?#].*)?$/i.exec(url);
        return m ? { owner: m[1], repo: m[2] } : null;
    }

    function fmtNum(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(n);
    }

    // **bold** *italic* _italic_ ~~strike~~ ||spoiler|| `code` https links @mentions
    function parseInline(str) {
        const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\|\|[^|\n]+\|\||\*[^*\n]+\*|(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9])|https:\/\/[^\s<]+|(?<![A-Za-z0-9_])@[A-Za-z0-9_]{3,20})/g;
        const out = [];
        let last = 0, m;
        while ((m = re.exec(str))) {
            if (m.index > last) out.push({ t: 'text', v: str.slice(last, m.index) });
            let tok = m[0];
            if (tok[0] === '`') out.push({ t: 'code', v: tok.slice(1, -1) });
            else if (tok.indexOf('**') === 0) out.push({ t: 'b', v: tok.slice(2, -2) });
            else if (tok.indexOf('~~') === 0) out.push({ t: 's', v: tok.slice(2, -2) });
            else if (tok.indexOf('||') === 0) out.push({ t: 'spoiler', v: tok.slice(2, -2) });
            else if (tok[0] === '*' || tok[0] === '_') out.push({ t: 'i', v: tok.slice(1, -1) });
            else if (tok.indexOf('https://') === 0) {
                let trail = '';
                while (/[.,!?;:)\]]$/.test(tok)) { trail = tok.slice(-1) + trail; tok = tok.slice(0, -1); }
                out.push({ t: 'link', v: tok });
                if (trail) out.push({ t: 'text', v: trail });
            } else out.push({ t: 'mention', v: tok.slice(1) });
            last = m.index + m[0].length;
        }
        if (last < str.length) out.push({ t: 'text', v: str.slice(last) });
        return out;
    }

    function sameDay(a, b) {
        const x = new Date(a), y = new Date(b);
        return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
    }

    function fmtTime(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    function fmtDay(iso) {
        const d = new Date(iso), n = new Date();
        if (sameDay(d, n)) return 'Today';
        const y = new Date(n); y.setDate(n.getDate() - 1);
        if (sameDay(d, y)) return 'Yesterday';
        return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    }

    function fmtListTime(iso) {
        if (!iso) return '';
        const d = new Date(iso), n = new Date();
        if (sameDay(d, n)) return fmtTime(iso);
        if ((n - d) / 86400000 < 7) return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    // same person, same day, under 5 minutes apart, not a reply
    function shouldGroup(prev, cur) {
        return !!prev && prev.sender_id === cur.sender_id && !prev.deleted_at && !cur.reply_to &&
            sameDay(prev.created_at, cur.created_at) &&
            (new Date(cur.created_at) - new Date(prev.created_at)) < 5 * 60000;
    }

    function previewText(body) {
        if (gifMediaUrl(body)) return 'GIF';
        if (/^Attachment:\s*voice-\S+\.(webm|m4a|mp4|ogg)$/i.test(String(body || '').trim())) return '\uD83C\uDFA4 Voice message';
        if (isStreakInvite(body)) return '\uD83D\uDD25 Streak invite';
        if (String(body || '').slice(0, 6) === '[[bug:') { const b = parseBug(body); return '\uD83D\uDC1B Bug' + (b ? ': ' + b.t : ' report'); }
        return String(body || '').replace(/```[\s\S]*?```/g, '[code]').replace(/:([a-z0-9_+-]{1,32}):/gi, flShortcodeToChar).replace(/\s+/g, ' ').trim().slice(0, 90);
    }

    function mentionsUser(text, username) {
        if (!username) return false;
        return new RegExp('(?<![A-Za-z0-9_])@' + username + '(?![A-Za-z0-9_])', 'i').test(text || '');
    }

    // /shrug, /me
    function applySlash(text) {
        const t = text.trim();
        if (/^\/shrug(\s|$)/i.test(t)) return (t.slice(6).trim() + ' ¯\\_(ツ)_/¯').trim();
        if (/^\/me\s+\S/i.test(t)) return '*' + t.slice(4).trim() + '*';
        return text;
    }
    /* HELPERS END */

    /* ----------------------------------------------------------------------
       SENSITIVE MESSAGE FILTER
       Runs on the VIEWER's screen only. Nothing is changed in the database and
       the sender is never told. Edit the word lists below to tune it.
       ---------------------------------------------------------------------- */
    // STRONG: the word itself plus anything stuck to the end (fuck, fucking, fucker...)
    const FILTER_STRONG = [
        'fuck', 'motherfuck', 'shit', 'bullshit', 'horseshit', 'dipshit', 'cunt', 'bitch', 'asshole', 'dumbass', 'jackass',
        'dickhead', 'cocksuck', 'bastard', 'wanker', 'twat', 'whore', 'nigger', 'nigga', 'faggot', 'retard',
        // Tagalog / Bisaya
        'putang', 'tangina', 'tanginamo', 'gago', 'ulol', 'tarantado', 'pakyu', 'pakshet', 'punyeta', 'bwisit', 'buwisit',
        'siraulo', 'kantot', 'pekpek', 'yawa', 'pisti', 'piste', 'bilat'
    ];
    // EXACT: only the whole word (plus s / es / ed / ing / er) so "class" and "assistant" stay safe
    const FILTER_EXACT = [
        'ass', 'dick', 'pussy', 'slut', 'piss', 'prick', 'douche', 'bollocks', 'bobo', 'tanga', 'inutil', 'tite', 'boang', 'buang'
    ];
    // PHRASES: harsh things people say to hurt each other
    const FILTER_PHRASES = [
        'kill yourself', 'kys', 'go die', 'hope you die', 'hang yourself', 'neck yourself', 'end yourself',
        'nobody likes you', 'you are worthless', 'you re worthless', 'hayop ka'
    ];

    function filterNormalize(text) {
        let s = String(text || '')
            .replace(/https?:\/\/\S+/gi, ' ')                    // links are not text
            .replace(/:[a-z0-9_+-]{1,32}:/gi, ' ')               // :custom_emoji: codes are not text
            .normalize('NFKD')
            .replace(/[\u0300-\u036f\u200B-\u200D\uFEFF]/g, '')   // accents + invisible characters
            .toLowerCase()
            .replace(/shii?take/g, ' ');                          // harmless words that look like a bad one
        // sneaky spellings: f4ck, sh!t, $hit, a$$ (only inside words, so "5 minutes" is left alone)
        s = s.replace(/[a-z0-9@$!|*]+/g, function (tok) {
            if (!/[a-z]/.test(tok)) return tok;
            return tok
                .replace(/([a-z])[!|]([a-z])/g, '$1i$2')
                .replace(/@/g, 'a').replace(/\$/g, 's')
                .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
        });
        return s;
    }

    function filterPattern(word, tail) {
        const parts = word.split('').map(function (ch) {
            if (ch === ' ') return '[^a-z]+';
            return (/[aeiou]/.test(ch) ? '[' + ch + '*]' : ch) + '+';     // fuuuck, f*ck
        });
        return new RegExp('(?:^|[^a-z])' + parts.join('[.\\-_]{0,2}') + tail + '(?![a-z])');   // f.u.c.k
    }

    const FILTER_RES = []
        .concat(FILTER_STRONG.map(function (w) { return filterPattern(w, '[a-z]{0,8}'); }))
        .concat(FILTER_EXACT.map(function (w) { return filterPattern(w, '(?:s|es|ed|ing|er|ers|y)?'); }))
        .concat(FILTER_PHRASES.map(function (w) { return filterPattern(w, ''); }));

    const sensCache = new Map();
    function isSensitive(text) {
        const s = String(text || '');
        if (!s || s.slice(0, 6) === '[[bug:') return false;
        if (sensCache.has(s)) return sensCache.get(s);
        const n = filterNormalize(s);
        const hit = FILTER_RES.some(function (re) { return re.test(n); });
        if (sensCache.size > 600) sensCache.clear();
        sensCache.set(s, hit);
        return hit;
    }

    // previews (chat list, reply bar, banners) must not leak the words either
    function safePreview(body, senderId) {
        const theirs = !!(senderId && S.me && senderId !== S.me.id);
        if (theirs && S.blocked.has(senderId)) return 'Message from a blocked user';
        if (theirs && S.filterOn && !gifMediaUrl(body) && isSensitive(body)) return 'Sensitive message hidden';
        return previewText(body);
    }

    // which messages get covered for THIS viewer ('blocked' | 'sensitive' | null)
    function hideKindFor(m, mine, deleted, bug) {
        if (deleted || mine || bug || m.pending) return null;
        if (S.blocked.has(m.sender_id)) return 'blocked';
        if (S.filterOn && !gifMediaUrl(m.body) && isSensitive(m.body)) return 'sensitive';
        return null;
    }

    /* ----------------------------------------------------------------------
       2. DOM TOOLKIT + ICONS
       ---------------------------------------------------------------------- */
    const $ = id => document.getElementById(id);

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
            [].concat(arguments[i]).forEach(function (c) {
                if (c == null || c === false) return;
                n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
            });
        }
        return n;
    }

    const svg = inner => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';

    const ICON = {
        menu:    svg('<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>'),
        close:   svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
        back:    svg('<polyline points="15 18 9 12 15 6"/>'),
        chevup:  svg('<polyline points="6 15 12 9 18 15"/>'),
        chevdown: svg('<polyline points="6 9 12 15 18 9"/>'),
        send:    svg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
        smile:   svg('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9.5" x2="9.01" y2="9.5"/><line x1="15" y1="9.5" x2="15.01" y2="9.5"/>'),
        users:   svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
        userplus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>'),
        reply:   svg('<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
        edit:    svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
        trash:   svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
        search:  svg('<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>'),
        plus:    svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
        sound:   svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
        muted:   svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
        sun:     svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
        moon:    svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
        check:   svg('<polyline points="20 6 9 17 4 12"/>'),
        hash:    svg('<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>'),
        dm:      svg('<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>'),
        group:   svg('<circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/>'),
        attach:  svg('<path d="m21.4 11.1-8.5 8.5a5.7 5.7 0 0 1-8.1-8.1l9.2-9.2a3.8 3.8 0 0 1 5.4 5.4l-9.2 9.2a1.9 1.9 0 0 1-2.7-2.7l8.5-8.5"/>'),
        code:    svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
        bug:     svg('<rect x="8" y="8" width="8" height="12" rx="4"/><path d="M9 8a3 3 0 0 1 6 0"/><line x1="4" y1="13" x2="8" y2="13"/><line x1="16" y1="13" x2="20" y2="13"/><line x1="5" y1="7" x2="8" y2="9.5"/><line x1="19" y1="7" x2="16" y2="9.5"/><line x1="5" y1="19" x2="8" y2="16.5"/><line x1="19" y1="19" x2="16" y2="16.5"/>'),
        copy:    svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
        link:    svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
        more:    svg('<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>'),
        user:    svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
        pin:     svg('<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>'),
        tag:     svg('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>'),
        bell:    svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
        belloff: svg('<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/>'),
        settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
        flag:    svg('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'),
        shield:  svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
        shieldoff: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="3" y1="3" x2="21" y2="21"/>'),
        mic:     svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
        play:    svg('<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>'),
        pause:   svg('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>'),
        checks:  svg('<path d="M1.5 13l4 4L13 8"/><path d="M9.5 16.5l1 1L22 6"/>'),
        info:    svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
        ban:     svg('<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>'),
        xcircle: svg('<circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>'),
        logout:  svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
        github:  svg('<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.3 6.4-1.5 6.4-6.9a5.4 5.4 0 0 0-1.5-3.7 5 5 0 0 0-.1-3.7s-1.2-.3-3.9 1.5a13.4 13.4 0 0 0-7 0C6.3 2.8 5.1 3.1 5.1 3.1a5 5 0 0 0-.1 3.7A5.4 5.4 0 0 0 3.5 10.5c0 5.4 3.3 6.6 6.4 6.9a3.4 3.4 0 0 0-.9 2.6V22"/>')
    };

    function icon(name) {
        const holder = document.createElement('span');
        holder.innerHTML = ICON[name];
        return holder.firstChild;
    }

    function setIcon(id, name) { const n = $(id); if (n) n.innerHTML = ICON[name]; }

    // round avatar (uses the shared .sp-avatar look from style.css)
    // member title (name-titles.js): an empty slot next to a name that fills itself in if that member wears one
    function titleSlot(userId) {
        if (!userId || !window.SpecTitles) return null;
        const slot = el('span', { class: 'ch-title-slot' });
        window.SpecTitles.adorn(slot, userId);
        return slot;
    }

    function avatar(p, size) {
        const name = (p && (p.display_name || p.username)) || '?';
        const wrap = el('span', { class: 'sp-avatar' }, el('span', { class: 'sp-initial', text: name.charAt(0).toUpperCase() }));
        if (size) wrap.style.setProperty('--sp-size', size + 'px');
        if (p && p.id && window.SpecFrames) window.SpecFrames.adorn(wrap, p.id);      // profile frame (avatar-frames.js)
        const url = p && safeHttps(p.avatar_url);
        if (url) {
            const img = el('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
            img.addEventListener('error', function () { img.remove(); });
            wrap.appendChild(img);
        }
        return wrap;
    }

    /* ----------------------------------------------------------------------
       3. STATE + BACKEND
       ---------------------------------------------------------------------- */
    const sb = window.getSupabaseClient ? window.getSupabaseClient() : (
        (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY)
            ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY)
            : null
    );

    const S = {
        me: null, profile: null,
        rooms: [], roomMap: new Map(),
        streaks: new Map(), streaksReady: false, streakPop: null, restoreInfo: null,
        invites: [], inbox: [], discover: [],
        nav: 'mine', query: '',
        current: null,              // the room object that is open
        messages: [], byId: new Map(), extra: new Map(),
        profiles: new Map(),
        online: new Set(), typing: new Map(),
        replyTo: null, editing: null,
        newFromId: null, atBottom: true, newCount: 0,
        loadingMore: false, noMore: false,
        roomCh: null, globalCh: null,
        sound: true, tmp: 0, pickerFor: null, members: [],
        pendingFile: null, fileUrls: new Map(), sending: false,
        tl: new Map(),                 // typing, per room: roomId -> Map(userId -> {name, until})
        onlineAll: new Set(),          // everybody who is online right now (global presence)
        userCh: null, presCh: null, outCh: new Map(),
        menu: null, lastClosed: null, lpFired: false, nickRoom: null,
        desk: false, banners: new Map(),
        filterOn: true, revealed: new Set(), blocked: new Set(), pinIds: new Set(),
        imgOn: true
    };

    const ERR = {
        not_authenticated: 'Please log in again.',
        no_profile: 'Set up your profile first (open your profile page once).',
        bad_kind: 'That chat type is not valid.',
        bad_name: 'Pick a name between 2 and 40 characters.',
        room_limit: 'You can own up to 10 chats.',
        room_not_found: 'That chat was not found.',
        bad_code: 'That code is not valid.',
        bad_user: 'You cannot do that with yourself.',
        user_not_found: 'No member has that username.',
        not_member: 'You are not in this chat.',
        not_allowed: 'You are not allowed to do that.',
        announce_only: 'Only owners and admins can post in announcements.',
        channel_not_found: 'That channel is no longer available.',
        channel_type_unsupported: 'This channel type is not ready yet.',
        bad_channel_name: 'Channel names use letters, numbers, - and _ (up to 32).',
        name_taken: 'A channel with that name already exists.',
        channel_limit: 'A community can have up to 50 channels.',
        section_limit: 'A community can have up to 20 sections.',
        default_channel: 'The default channel cannot be made private or deleted.',
        already_member: 'They are already in this chat.',
        invite_not_found: 'That invite is no longer available.',
        empty_message: 'Write something first.',
        too_long: 'That message is too long (2000 max).',
        rate_limited: 'Slow down a little.',
        bad_emoji: 'That emoji is not allowed.',
        too_many_reactions: 'That message has too many different reactions.',
        bad_status: 'That status is not valid.',
        not_a_bug: 'That message is not a bug report.',
        blocked: 'You cannot message this user.',
        snippet_not_found: 'That snippet was not found.',
        too_many_snippets: 'You have saved the maximum number of snippets (300).',
        pin_limit: 'This chat already has 50 pinned messages. Unpin one first.',
        message_not_found: 'That message is no longer available.',
        emote_not_owned: 'You can only send emotes you own. Get it in the Store.',
        super_cooldown: 'Super emotes are recharging. Try again in a few seconds.',
        super_one_per_message: 'Only one super emote per message.',
        no_send: 'You do not have permission to talk here.',
        timed_out: 'You are in a timeout. You cannot post right now.',
        banned: 'You are banned from this community.',
        private_community: 'This community is private. You need an invite from a member.',
        rank_too_low: 'Their role is as high as yours or higher.'
    };

    function isSetupMissing(err) {
        const code = String(err && err.code || '');
        const msg = String(err && err.message || '').toLowerCase();
        return code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01' ||
            (/chat_/.test(msg) && /(schema cache|does not exist|could not find)/.test(msg));
    }

    function friendly(err) {
        const msg = String(err && err.message || '');
        if (/attachment_path|chat-attachments|bucket not found/i.test(msg)) return 'Run the updated supabase-chats.sql in Supabase SQL Editor to enable attachments.';
        if (/chat_set_pref|chat_prefs|chat_set_block|chat_blocks|chat_delete_room|other_id|pinned/i.test(msg) && isSetupMissing(err)) return 'Run supabase-chats-v3.sql in your Supabase SQL Editor to turn this on.';
        const keys = Object.keys(ERR);
        for (let i = 0; i < keys.length; i++) if (msg.indexOf(keys[i]) >= 0) return ERR[keys[i]];
        if (isSetupMissing(err)) return 'Chats are not set up yet. Run supabase-chats.sql in your Supabase SQL Editor.';
        if (/failed to fetch|network/i.test(msg)) return 'Cannot reach the server. Check your connection.';
        return 'Something went wrong. Please try again.';
    }

    let toastTimer = null;
    function toast(msg) {
        const t = $('chToast');
        const host = document.querySelector('dialog[open]') || document.body;
        if (t.parentNode !== host) host.appendChild(t);
        t.textContent = msg;
        void t.offsetWidth;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
    }

    function setLoading(btn, on) {
        btn.classList.toggle('is-loading', on);
        btn.disabled = on;
        btn.setAttribute('aria-busy', String(on));
    }

    function showBox(id, text) {
        const b = $(id);
        b.className = 'ch-msgbox' + (text ? ' is-error' : '');
        b.textContent = text || '';
    }

    async function copyText(text, ok) {
        try { await navigator.clipboard.writeText(text); toast(ok); }
        catch (e) { toast('Could not copy. Copy it by hand.'); }
    }

    /* ----------------------------------------------------------------------
       4. SCREENS: gate, theme, sound, viewport
       ---------------------------------------------------------------------- */
    function gate(kind, text) {
        const g = $('chGate'), card = $('chGateCard');
        g.hidden = false;
        card.textContent = '';
        const add = function (title, body, actions) {
            card.appendChild(el('h2', { text: title }));
            if (body) card.appendChild(el('p', { text: body }));
            if (actions) card.appendChild(el('div', { class: 'ch-gate-actions' }, actions));
        };
        const link = function (label, href, ghost) { return el('a', { class: 'ch-btn' + (ghost ? ' ch-btn--ghost' : ''), href: href, text: label }); };

        if (kind === 'loading') { card.appendChild(el('div', { class: 'ch-spinner', 'aria-hidden': 'true' })); card.appendChild(el('p', { text: 'Loading chats...' })); }
        else if (kind === 'setup') add('Backend not connected', 'Paste your Supabase URL and anon key into supabase-config.js, then refresh.', [link('Home', 'index.html', true)]);
        else if (kind === 'login') add('Log in to chat', 'Chats are for logged-in members. It only takes a moment.', [link('Log in', 'login.html?next=chats.html'), link('Sign up', 'login.html?mode=signup&next=chats.html', true)]);
        else if (kind === 'sql') add('Chats are not set up yet', 'Run supabase-chats.sql once in your Supabase SQL Editor (after supabase-profiles.sql), then refresh.', [link('Home', 'index.html', true)]);
        else add('Something went wrong', text || 'Please refresh the page.', [el('button', { type: 'button', class: 'ch-btn', onclick: function () { location.reload(); } }, 'Refresh'), link('Home', 'index.html', true)]);
    }

    function hideGate() { $('chGate').hidden = true; }

    function applyTheme(light) {
        document.body.classList.toggle('light-mode', !!light);
        setIcon('chThemeBtn', light ? 'moon' : 'sun');
    }

    function initTheme() {
        let light = false;
        try { light = localStorage.getItem('specsoft-theme') === 'light'; } catch (e) { /* ignore */ }
        applyTheme(light);
        if ($('chThemeBtn')) $('chThemeBtn').addEventListener('click', function () {
            light = !document.body.classList.contains('light-mode');
            if (window.SpecSettings) SpecSettings.set('theme', light ? 'light' : 'dark');
            else { try { localStorage.setItem('specsoft-theme', light ? 'light' : 'dark'); } catch (e) { /* ignore */ } }
            applyTheme(light);
        });
    }

    let audioCtx = null;
    function ping() {
        if (!S.sound) return;
        try {
            const C = window.AudioContext || window.webkitAudioContext;
            if (!C) return;
            audioCtx = audioCtx || new C();
            const t = audioCtx.currentTime;
            const o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'sine'; o.frequency.value = 880;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(t); o.stop(t + 0.2);
        } catch (e) { /* sound is optional */ }
    }

    function initSound() {
        try { S.sound = localStorage.getItem('specsoft.chat.sound') !== 'off'; } catch (e) { /* ignore */ }
    }

    function toggleSound() {
        S.sound = !S.sound;
        try { localStorage.setItem('specsoft.chat.sound', S.sound ? 'on' : 'off'); } catch (e) { /* ignore */ }
        if (S.sound) ping();
    }

    // phones: size the app to the visible area so the keyboard never covers the message box
    function fitViewport() {
        const vv = window.visualViewport;
        const app = $('chApp');
        const apply = function () {
            app.style.top = (vv ? vv.offsetTop : 0) + 'px';
            app.style.height = (vv ? vv.height : window.innerHeight) + 'px';
        };
        apply();
        if (vv) { vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); }
        window.addEventListener('resize', apply);
    }

    function updateTitle() {
        const n = S.rooms.reduce(function (a, r) { return a + ((r.muted || (window.SPCH && SPCH.isNone(r))) ? 0 : (r.unread || 0)); }, 0);
        document.title = (n > 0 ? '(' + (n > 99 ? '99+' : n) + ') ' : '') + 'Chats | SPECSOFT®';
    }

    function paintBadge(id, n) {
        const b = $(id);
        if (!b) return;
        b.hidden = !(n > 0);
        b.textContent = n > 99 ? '99+' : String(n);
    }

    function updateBadges() {
        paintBadge('chBadgeChats', S.rooms.reduce(function (a, r) { return a + ((r.muted || (window.SPCH && SPCH.isNone(r))) ? 0 : (r.unread || 0)); }, 0));
        paintBadge('chBadgeInvites', S.invites.length);
        paintBadge('chBadgeInbox', S.inbox.filter(function (i) { return !i.read_at; }).length);
        updateTitle();
    }

    /* ----------------------------------------------------------------------
       5. LOADING DATA
       ---------------------------------------------------------------------- */
    async function ensureProfile(me) {
        const got = await sb.from('profiles').select('id,username,display_name,avatar_url').eq('id', me.id).maybeSingle();
        if (got.error) throw got.error;
        if (got.data) return got.data;

        const meta = me.user_metadata || {};
        const base = baseUsername(meta, me.email);
        const av = safeHttps(meta.sp_avatar || meta.avatar_url || meta.picture || '');
        const display = String(meta.full_name || meta.name || '').trim().slice(0, 40) || null;
        for (let i = 0; i < 6; i++) {
            const name = i === 0 ? base : base.slice(0, 15) + randDigits(4);
            const res = await sb.from('profiles').insert({ id: me.id, username: name, display_name: display, avatar_url: av, status: 'online' })
                .select('id,username,display_name,avatar_url').single();
            if (!res.error) return res.data;
            if (res.error.code !== '23505') throw res.error;
            const again = await sb.from('profiles').select('id,username,display_name,avatar_url').eq('id', me.id).maybeSingle();
            if (again.data) return again.data;
        }
        throw new Error('Could not pick a free username.');
    }

    function indexRooms() {
        S.roomMap = new Map();
        S.rooms.forEach(function (r) {
            r.unread = Number(r.unread) || 0;
            r.member_count = Number(r.member_count) || 0;
            r.pinned = !!r.pinned; r.muted = !!r.muted;
            r.blocked_by_me = !!r.blocked_by_me; r.blocked_me = !!r.blocked_me;
            S.roomMap.set(r.room_id, r);
        });
        // keep the open chat pointing at the fresh object
        if (S.current && S.roomMap.has(S.current.room_id)) S.current = S.roomMap.get(S.current.room_id);
        pinFirst();
    }

    // pinned chats first (newest pin on top), everything else keeps its order
    function pinFirst() {
        const pins = S.rooms.filter(function (r) { return r.pinned; })
            .sort(function (a, b) { return new Date(b.pinned_at || 0) - new Date(a.pinned_at || 0); });
        S.rooms = pins.concat(S.rooms.filter(function (r) { return !r.pinned; }));
    }

    async function loadRooms() {
        const res = await sb.rpc('chat_my_rooms');
        if (res.error) throw res.error;
        S.rooms = res.data || [];
        indexRooms();
        updateBadges();
        if (window.SPCH) SPCH.loadLevels();
        loadStreaks();
        refreshStatuses();
    }

    /* ----------------------------------------------------------------------
       CHAT STREAKS (DMs only)
       The server (supabase-chat-streaks.sql) does the counting, the restores
       and the milestones. Here we load the numbers, draw the flame, open the
       streak sheet and celebrate.
       Tiers: 1-19 yellow | 20-69 yellow+orange | 70-199 orange+red |
              200-299 red fire | 300-399 blue fire | 400+ violet fire
       ---------------------------------------------------------------------- */
    const STREAK_NAMES = ['', 'Spark', 'Blaze', 'Inferno', 'Wildfire', 'Blue Flame', 'Violet Flame'];
    const STREAK_TIER_AT = [0, 1, 20, 70, 200, 300, 400];
    const STREAK_MILESTONES = [3, 7, 14, 20, 30, 50, 70, 100, 150, 200, 250, 300, 365, 400, 500];   // keep in sync with chat_streak_is_milestone()
    const FLAME_PATH = 'M12 1.5c.6 3.2 2.6 4.6 4.4 6.9 1.7 2.1 3.1 4.4 3.1 7.2A7.5 7.5 0 0 1 12 22.5a7.5 7.5 0 0 1-7.5-6.9c0-2.2.9-3.9 2.1-5.3.5 1.1 1.2 1.8 2 2.2C8.2 9 9.7 4.4 12 1.5z';
    const FLAME_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path class="sk-o" d="' + FLAME_PATH + '"/>' +
        '<path class="sk-m" transform="translate(12 22.5) scale(.68) translate(-12 -22.5)" d="' + FLAME_PATH + '"/>' +
        '<path class="sk-c" transform="translate(12 22.5) scale(.38) translate(-12 -22.5)" d="' + FLAME_PATH + '"/></svg>';
    let streakTimer = null, streakBusy = false, streakAgain = false;

    function streakTier(n) { return n >= 400 ? 6 : n >= 300 ? 5 : n >= 200 ? 4 : n >= 70 ? 3 : n >= 20 ? 2 : 1; }
    function nextMilestone(n) {
        for (let i = 0; i < STREAK_MILESTONES.length; i++) if (STREAK_MILESTONES[i] > n) return STREAK_MILESTONES[i];
        return (Math.floor(n / 100) + 1) * 100;
    }
    function flameEl(extra) {
        const f = el('span', { class: 'ch-flame' + (extra ? ' ' + extra : '') });
        f.innerHTML = FLAME_SVG;                       // constant markup, no user data
        return f;
    }
    function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

    function streakInfo(r) {
        if (!r || r.kind !== 'dm' || r.blocked_by_me || r.blocked_me) return null;
        const s = S.streaks.get(r.room_id);
        return s && s.status === 'on' && (s.streak > 0 || s.restorable > 0) ? s : null;
    }

    function streakTip(r, s) {
        const who = r.other_display || r.other_username || 'them';
        if (s.streak <= 0) return 'Your ' + plural(s.restorable, 'day') + ' streak with ' + who + ' ended. Tap to restore it';
        let t = plural(s.streak, 'day') + ' streak with ' + who + ' (' + STREAK_NAMES[s.tier] + ')';
        if (s.best > s.streak) t += ' · best ' + s.best;
        t += s.risk ? (s.meToday ? ' · waiting for ' + who + ' to chat today' : s.otherToday ? ' · ' + who + ' chatted, your turn' : ' · you both need to chat today') : ' · today is done';
        if (s.restorable > 0) t += ' · restore available';
        return t;
    }

    function streakChip(r, head) {
        const s = streakInfo(r);
        if (!s) return null;
        const broken = s.streak <= 0;
        const n = broken ? s.restorable : s.streak;
        const tip = streakTip(r, s);
        const chip = el(head ? 'button' : 'span', {
            type: head ? 'button' : null,
            class: 'ch-streak' + (head ? ' ch-streak--head' : '') + (s.risk && !broken ? ' is-risk' : '') + (broken ? ' is-broken' : '') + (S.streakPop === r.room_id ? ' is-pop' : ''),
            dataset: { tier: String(broken ? streakTier(n) : s.tier) }, title: tip, 'aria-label': tip, role: head ? null : 'img'
        }, flameEl(), el('b', { text: String(n) }), (head && s.restorable > 0) ? el('span', { class: 'ch-sk-pill', text: 'Restore' }) : null);
        if (head) chip.addEventListener('click', function (e) { e.stopPropagation(); openStreakDlg(r); });
        return chip;
    }

    function paintStreakHead() {
        const h = $('chRoomName');
        if (!h) return;
        const chip = S.current ? streakChip(S.current, true) : null;
        if (!chip && !h.classList.contains('has-streak')) return;
        h.textContent = '';
        if (chip) {
            h.classList.add('has-streak');
            h.appendChild(el('span', { class: 'ch-room-name-text', text: roomTitle(S.current) }));
            h.appendChild(chip);
        } else {
            h.classList.remove('has-streak');
            if (S.current) h.textContent = roomTitle(S.current);
        }
    }

    /* ---- seen-milestone bookkeeping (so a celebration plays once per device) ---- */
    function seenKey(id) { return 'specsoft.streak.seen.' + (S.me ? S.me.id : '') + '.' + id; }
    function getSeen(id) { try { return localStorage.getItem(seenKey(id)); } catch (e) { return null; } }
    function setSeen(id, at) { try { localStorage.setItem(seenKey(id), at); } catch (e) { /* ignore */ } }

    function celebrateMilestone(room, s) {
        if (document.querySelector('.ch-sk-cele')) return;
        const who = roomTitle(room);
        const tier = streakTier(s.milestone);
        const tierUp = STREAK_TIER_AT.indexOf(s.milestone) > 1;
        let timer = null;
        const close = function () {
            clearTimeout(timer);
            document.removeEventListener('keydown', onKey);
            root.classList.add('is-out');
            setTimeout(function () { root.remove(); }, noMotion() ? 0 : 220);
        };
        const onKey = function (e) { if (e.key === 'Escape') close(); };
        const btn = el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: close, text: 'Keep it burning' });
        const root = el('div', { class: 'ch-sk-cele ch-sk-theme', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Streak milestone', dataset: { tier: String(tier) } },
            el('div', { class: 'ch-sk-cele-card' },
                flameEl('ch-sk-cele-flame'),
                el('div', { class: 'ch-sk-cele-kicker', text: tierUp ? 'STREAK LEVEL UP!' : 'STREAK MILESTONE!' }),
                el('div', { class: 'ch-sk-cele-num', text: String(s.milestone) }),
                el('div', { class: 'ch-sk-cele-sub', text: 'days in a row with ' + who }),
                tierUp ? el('div', { class: 'ch-sk-cele-tier', text: STREAK_NAMES[tier] + ' unlocked' }) : null,
                btn));
        if (!noMotion()) {
            const box = el('div', { class: 'ch-sk-embers', 'aria-hidden': 'true' });
            for (let i = 0; i < 16; i++) {
                box.appendChild(el('i', { style: 'left:' + Math.round(Math.random() * 100) + '%;animation-delay:' + (Math.random() * 2.2).toFixed(2) + 's;animation-duration:' + (2.4 + Math.random() * 2).toFixed(2) + 's;width:' + (3 + Math.round(Math.random() * 4)) + 'px;height:' + (3 + Math.round(Math.random() * 4)) + 'px' }));
            }
            root.insertBefore(box, root.firstChild);
        }
        root.addEventListener('click', function (e) { if (e.target === root) close(); });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(root);
        btn.focus();
        timer = setTimeout(close, 9000);
    }

    function announceStreaks(prev, next, skipId) {
        let done = false;
        next.forEach(function (s, id) {
            if (done || id === skipId) return;
            const before = prev.get(id);
            const room = S.roomMap.get(id);
            const who = room ? roomTitle(room) : 'your friend';
            if (s.status === 'pending' && !s.invitedByMe && (!before || before.status !== 'pending')) {
                done = true;
                toast('🔥 ' + who + ' sent you a streak invite!');
                return;
            }
            if (s.status === 'on' && before && before.status === 'pending' && before.invitedByMe) {
                done = true;
                toast('🔥 ' + who + ' accepted your streak invite!');
                return;
            }
            if (before && before.streak > 0 && s.streak <= 0 && s.restorable > 0) {
                done = true;
                toast('💔 Your streak with ' + who + ' ended. You can restore it!');
                return;
            }
            if (!before || s.streak <= before.streak) return;
            done = true;
            S.streakPop = id;
            setTimeout(function () { if (S.streakPop === id) S.streakPop = null; }, 1800);
            toast(s.tier > before.tier
                ? '🔥 STREAK LEVEL UP! ' + STREAK_NAMES[s.tier] + ' unlocked with ' + who + ' (' + s.streak + ')'
                : '🔥 Streak up! ' + s.streak + ' with ' + who);
        });
    }

    function syncTimezone() {
        if (S.tzSent) return;
        S.tzSent = true;
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (tz) sb.rpc('chat_set_timezone', { p_tz: tz }).then(function () {}, function () {});
        } catch (e) { /* ignore */ }
    }

    async function loadStreaks() {
        if (!S.me) return;
        syncTimezone();
        if (streakBusy) { streakAgain = true; return; }
        streakBusy = true;
        try {
            const res = await sb.rpc('chat_my_streaks');
            if (res.error) throw res.error;
            const next = new Map();
            (res.data || []).forEach(function (row) {
                const n = Number(row.streak) || 0, rest = Number(row.restorable) || 0;
                const status = row.status || 'on';
                const base = { invitedAt: row.invited_at || null, best: 0, tier: 1, restorable: 0, daysLeft: 0, milestone: 0, milestoneAt: null, done: false, risk: false, meToday: !!row.me_today, otherToday: !!row.other_today, tz: row.tz || 'Asia/Manila', resetAt: Date.now() + (Number(row.resets_in) || 0) * 1000 };
                if (status !== 'on') {                         // a streak invite that is waiting for an answer
                    next.set(row.room_id, Object.assign({}, base, { status: status, invitedByMe: !!row.invited_by_me, streak: 0 }));
                    return;
                }
                if (n <= 0 && rest <= 0) {                     // streak is ON but today's first round is not done yet
                    next.set(row.room_id, Object.assign({}, base, { status: 'on', best: Number(row.best) || 0, streak: 0 }));
                    return;
                }
                next.set(row.room_id, {
                    status: 'on', invitedAt: row.invited_at || null, streak: n, best: Math.max(Number(row.best) || 0, n), done: !!row.done_today, risk: !!row.at_risk, tier: streakTier(n > 0 ? n : rest),
                    meToday: !!row.me_today, otherToday: !!row.other_today, tz: row.tz || 'Asia/Manila', resetAt: Date.now() + (Number(row.resets_in) || 0) * 1000,
                    restorable: rest, daysLeft: Number(row.restore_days_left) || 0,
                    milestone: Number(row.milestone) || 0, milestoneAt: row.milestone_at || null
                });
            });
            const prev = S.streaks;
            S.streaks = next;

            // a milestone nobody has seen yet on this device? celebrate it (one at a time)
            let cele = null;
            next.forEach(function (s, id) {
                if (!s.milestone || !s.milestoneAt || s.streak < s.milestone) return;
                const seen = getSeen(id);
                if (seen && new Date(s.milestoneAt) <= new Date(seen)) return;
                setSeen(id, s.milestoneAt);
                if (!cele && Date.now() - new Date(s.milestoneAt).getTime() < 24 * 3600 * 1000) cele = { id: id, s: s };
            });

            if (S.streaksReady) announceStreaks(prev, next, cele ? cele.id : null);
            S.streaksReady = true;
            renderList();
            paintStreakHead();
            refreshStreakCards();
            if (cele && S.roomMap.get(cele.id)) celebrateMilestone(S.roomMap.get(cele.id), cele.s);
            const dlg = document.querySelector('.ch-sk-dlg');
            if (dlg && dlg._repaint) dlg._repaint();
        } catch (e) { /* streak SQL not installed yet: chats keep working without flames */ }
        finally {
            streakBusy = false;
            if (streakAgain) { streakAgain = false; loadStreaksSoon(); }
        }
    }
    function loadStreaksSoon() { clearTimeout(streakTimer); streakTimer = setTimeout(loadStreaks, 500); }

    async function loadRestoreInfo() {
        try {
            const res = await sb.rpc('chat_streak_restores_left');
            if (res.error) throw res.error;
            const row = (res.data || [])[0];
            if (row) S.restoreInfo = { left: Number(row.restores_left) || 0, total: Number(row.restores_total) || 7, refill: row.refill_day || null };
        } catch (e) { /* keep the old numbers */ }
    }

    function fmtRefill(d) {
        if (!d) return 'the 1st of next month';
        const t = new Date(d + 'T00:00:00');
        return isNaN(t) ? 'the 1st of next month' : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function closeStreakDlg() { const d = document.querySelector('.ch-sk-dlg'); if (d) d.close(); }

    function openStreakDlg(r) {
        if (!r || r.kind !== 'dm') return;
        closeStreakDlg();
        const dlg = el('dialog', { class: 'ch-dlg ch-dlg--small ch-sk-dlg', 'aria-labelledby': 'chSkTitle' });
        const x = el('button', { type: 'button', class: 'ch-iconbtn', 'aria-label': 'Close', onclick: function () { dlg.close(); } });
        x.innerHTML = ICON.close;
        const body = el('div', { class: 'ch-dlg-body ch-sk-body' });
        dlg.appendChild(el('header', { class: 'ch-dlg-head' }, el('h2', { id: 'chSkTitle', text: 'Streak with ' + roomTitle(r) }), x));
        dlg.appendChild(body);
        dlg._repaint = function () { paintStreakBody(body, r, dlg); };
        dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
        dlg.addEventListener('close', function () { dlg.remove(); });
        dlg._repaint();
        document.body.appendChild(dlg);
        if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
        loadRestoreInfo().then(function () { if (dlg.isConnected) dlg._repaint(); });
    }

    function paintStreakBody(body, r, dlg) {
        const s = streakInfo(r);
        if (!s) { paintStreakIntro(body, r, dlg, skRow(r)); return; }
        const broken = s.streak <= 0;
        const n = broken ? s.restorable : s.streak;
        const tier = broken ? streakTier(n) : s.tier;
        const info = S.restoreInfo;
        body.textContent = '';

        body.appendChild(el('div', { class: 'ch-sk-hero ch-sk-theme' + (broken ? ' is-broken' : (s.risk ? ' is-pending' : '')), dataset: { tier: String(tier) } },
            flameEl('ch-sk-hero-flame'),
            el('div', { class: 'ch-sk-hero-n', text: String(n) }),
            el('div', { class: 'ch-sk-hero-t', text: broken ? 'Streak ended' : STREAK_NAMES[tier] })));

        const who = roomTitle(r);
        body.appendChild(el('p', { class: 'ch-sk-status' + (s.risk && !broken ? ' is-risk' : ''),
            text: broken ? 'Your ' + plural(n, 'day') + ' streak with ' + who + ' ended.'
                : s.done ? '✅ Today is done. You both chatted.'
                : s.meToday ? '✅ You chatted today. Waiting for ' + who + '. The streak only goes up when you BOTH chat.'
                : s.otherToday ? '✅ ' + who + ' already chatted. Your turn! Send a message to keep the streak.'
                : '⏳ Neither of you has chatted yet today. You both need to send a message.' }));
        if (!broken) {
            const left = Math.max(0, Math.round((s.resetAt - Date.now()) / 60000));
            body.appendChild(el('p', { class: 'ch-sk-reset', text: 'The day resets at 12:00 AM (' + s.tz.replace(/_/g, ' ') + '), in ' + Math.floor(left / 60) + 'h ' + (left % 60) + 'm.' }));
        }

        if (!broken) {
            const next = nextMilestone(s.streak);
            const prevMs = STREAK_MILESTONES.filter(function (m) { return m <= s.streak; }).pop() || 0;
            const pct = Math.max(4, Math.min(100, Math.round(((s.streak - prevMs) / (next - prevMs)) * 100)));
            body.appendChild(el('div', { class: 'ch-sk-prog ch-sk-theme', dataset: { tier: String(tier) } },
                el('div', { class: 'ch-sk-prog-top' }, el('span', { text: 'Next milestone' }), el('b', { text: plural(next - s.streak, 'day') + ' to go' })),
                el('div', { class: 'ch-sk-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(next), 'aria-valuenow': String(s.streak) }, el('i', { style: 'width:' + pct + '%' })),
                el('div', { class: 'ch-sk-prog-sub', text: s.streak + ' / ' + next + (tier < 6 ? '  ·  next flame: ' + STREAK_NAMES[tier + 1] + ' at ' + STREAK_TIER_AT[tier + 1] : '') })));
        }

        body.appendChild(el('div', { class: 'ch-sk-stats' },
            el('div', null, el('b', { text: String(Math.max(s.best, n)) }), el('span', { text: 'Best streak' })),
            el('div', null, el('b', { text: info ? info.left + '/' + info.total : '...' }), el('span', { text: 'Restores left' }))));

        if (s.restorable > 0) {
            const out = info && info.left <= 0;
            const btn = el('button', { type: 'button', class: 'ch-btn', disabled: out ? true : null,
                text: out ? 'No restores left' : 'Restore streak' + (info ? ' (' + info.left + ' left)' : '') });
            btn.addEventListener('click', function () { doRestore(btn, r, dlg); });
            body.appendChild(el('div', { class: 'ch-sk-restore' },
                el('strong', { text: 'Restore it' }),
                el('p', { text: 'Bring back ' + plural(s.restorable, 'day') + (s.streak > 0 ? ' on top of your current ' + s.streak : '') + '. ' +
                    'You have ' + plural(s.daysLeft, 'day') + ' left to do it. One restore is taken from YOUR monthly restores, and they refill on ' + fmtRefill(info && info.refill) + '.' }),
                btn));
        } else {
            body.appendChild(el('p', { class: 'ch-sk-foot', text: (info ? 'You have ' + info.left + ' of ' + info.total + ' streak restores this month. They refill on ' + fmtRefill(info.refill) + '.' : 'Streak restores refill every month.') }));
        }
        body.appendChild(streakOffBtn(r));
    }

    /* ---- streak invites: a streak only starts once BOTH people agree ---- */
    function skRow(r) {
        if (!r || r.kind !== 'dm' || r.blocked_by_me || r.blocked_me) return null;
        return S.streaks.get(r.room_id) || null;
    }

    async function skAction(btn, name, args, okMsg) {
        if (btn) setLoading(btn, true);
        try {
            const res = await sb.rpc(name, args);
            if (res.error) throw res.error;
            if (okMsg) toast(okMsg);
            await loadStreaks();
            return true;
        } catch (e) {
            const m = String((e && e.message) || '');
            toast(m.indexOf('invite_cooldown') >= 0 ? 'You can not send another invite just yet. Try again a bit later.'
                : m.indexOf('blocked') >= 0 ? 'You can not do that with a blocked user.'
                : m.indexOf('already_on') >= 0 ? 'You already have a streak with them.'
                : m.indexOf('already_invited') >= 0 ? 'Your invite is already waiting for an answer.'
                : 'Could not do that. Try again.');
            loadStreaks();
            return false;
        } finally { if (btn && btn.isConnected) setLoading(btn, false); }
    }

    function streakOffBtn(r) {
        const b = el('button', { type: 'button', class: 'ch-sk-off', text: 'Turn off streak' });
        let armed = null;
        b.addEventListener('click', function () {
            if (!armed) {
                b.textContent = 'Tap again to turn it off (this resets it)';
                b.classList.add('is-armed');
                armed = setTimeout(function () { armed = null; b.textContent = 'Turn off streak'; b.classList.remove('is-armed'); }, 4000);
                return;
            }
            clearTimeout(armed); armed = null;
            skAction(b, 'chat_streak_off', { p_room: r.room_id }, 'Streak turned off').then(function (ok) { if (ok) closeStreakDlg(); });
        });
        return b;
    }

    // sheet body when there is no running streak yet: no invite / invite sent / invite received / just turned on
    function paintStreakIntro(body, r, dlg, row) {
        const who = roomTitle(r);
        const started = !!row && row.status === 'on';
        const pending = !!row && row.status === 'pending';
        const mine = pending && row.invitedByMe;
        body.textContent = '';
        body.appendChild(el('div', { class: 'ch-sk-hero ch-sk-theme is-pending', dataset: { tier: '1' } },
            flameEl('ch-sk-hero-flame'),
            el('div', { class: 'ch-sk-hero-t', text: started ? 'Streak is on' : mine ? 'Invite sent' : pending ? 'Streak invite' : 'No streak yet' })));

        let text;
        if (started) text = row.meToday ? '✅ You chatted today. Waiting for ' + who + ' so the streak can light up.'
            : row.otherToday ? '✅ ' + who + ' already chatted. Your turn! Send a message to start the streak.'
            : '⏳ The streak is on. When you BOTH chat today, it lights up at day 1.';
        else if (mine) text = 'Waiting for ' + who + ' to accept. Messages do not count until they do.';
        else if (pending) text = who + ' wants to start a streak with you! It starts when you accept, then you both chat every day to keep it going.';
        else text = 'A streak is a flame you and ' + who + ' build by BOTH chatting every day. It only starts after they accept your invite, so random messages never waste a streak.';
        body.appendChild(el('p', { class: 'ch-sk-status', text: text }));

        if (started) {
            const left = Math.max(0, Math.round((row.resetAt - Date.now()) / 60000));
            body.appendChild(el('p', { class: 'ch-sk-reset', text: 'The day resets at 12:00 AM (' + row.tz.replace(/_/g, ' ') + '), in ' + Math.floor(left / 60) + 'h ' + (left % 60) + 'm.' }));
            body.appendChild(streakOffBtn(r));
            return;
        }
        const actions = el('div', { class: 'ch-sk-actions' });
        if (mine) {
            const b = el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', text: 'Cancel invite' });
            b.addEventListener('click', function () { skAction(b, 'chat_streak_off', { p_room: r.room_id }, 'Invite canceled'); });
            actions.appendChild(b);
        } else if (pending) {
            const yes = el('button', { type: 'button', class: 'ch-btn', text: 'Accept streak' });
            const no = el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', text: 'Not now' });
            yes.addEventListener('click', function () { skAction(yes, 'chat_streak_respond', { p_room: r.room_id, p_accept: true }, '🔥 Streak is on! Chat every day to build it.'); });
            no.addEventListener('click', function () { skAction(no, 'chat_streak_respond', { p_room: r.room_id, p_accept: false }, null).then(function (ok) { if (ok) closeStreakDlg(); }); });
            actions.appendChild(yes); actions.appendChild(no);
        } else {
            const b = el('button', { type: 'button', class: 'ch-btn', text: 'Send streak invite' });
            b.addEventListener('click', function () { skAction(b, 'chat_streak_invite', { p_room: r.room_id }, '🔥 Streak invite sent to ' + who); });
            actions.appendChild(b);
        }
        body.appendChild(actions);
    }

    // the streak card inside the chat (sender: "Streak invite sent", receiver: "Accept Invite from @user")
    function buildStreakCard(m) {
        const mine = !!(S.me && m.sender_id === S.me.id);
        const sender = senderOf(m);
        const who = '@' + (sender.username || nameOf(sender));
        const room = S.current;
        const other = room ? roomTitle(room) : 'them';
        const row = room ? skRow(room) : null;
        const t = new Date(m.created_at).getTime();
        const latest = !!row && !!row.invitedAt && Math.abs(new Date(row.invitedAt).getTime() - t) < 10000;     // only the newest invite is alive
        const state = !latest ? 'closed' : (row.status === 'pending' || row.status === 'on' || row.status === 'declined') ? row.status : 'closed';
        const rid = m.room_id || (room && room.room_id);
        const btns = [];
        let title, sub;

        if (state === 'pending' && mine) {
            title = 'Streak invite sent';
            sub = 'Waiting for ' + other + ' to accept. Messages do not count until they do.';
            const c = el('button', { type: 'button', class: 'ch-btn ch-btn--sm ch-btn--ghost', text: 'Cancel invite' });
            c.addEventListener('click', function () { skAction(c, 'chat_streak_off', { p_room: rid }, 'Invite canceled'); });
            btns.push(c);
        } else if (state === 'pending') {
            title = 'Streak invite';
            sub = who + ' wants to start a streak with you. Chat every day to keep it going.';
            const yes = el('button', { type: 'button', class: 'ch-btn ch-btn--sm', text: 'Accept Invite from ' + who });
            const no = el('button', { type: 'button', class: 'ch-btn ch-btn--sm ch-btn--ghost', text: 'Not now' });
            yes.addEventListener('click', function () { skAction(yes, 'chat_streak_respond', { p_room: rid, p_accept: true }, '🔥 Streak is on! Chat every day to build it.'); });
            no.addEventListener('click', function () { skAction(no, 'chat_streak_respond', { p_room: rid, p_accept: false }, null); });
            btns.push(yes, no);
        } else if (state === 'on') {
            title = 'Streak is on 🔥';
            sub = row.streak > 0 ? 'Current streak: ' + row.streak + (row.streak === 1 ? ' day' : ' days') : 'You both need to chat today to light it up.';
        } else if (state === 'declined') {
            title = mine ? 'Streak invite declined' : 'You said not now';
            sub = mine ? 'You can invite again tomorrow.' : 'They can invite you again tomorrow.';
        } else {
            title = 'Streak invite';
            sub = 'This invite is closed.';
        }

        const tier = (state === 'on' && row.streak > 0) ? row.tier : 2;
        return el('div', { class: 'ch-sk-card ch-sk-theme is-' + state, dataset: { tier: String(tier) } },
            el('div', { class: 'ch-sk-card-top' },
                flameEl(),
                el('div', { class: 'ch-sk-card-txt' }, el('strong', { text: title }), el('span', { text: sub }))),
            btns.length ? el('div', { class: 'ch-sk-card-btns' }, btns) : null);
    }

    // streak state changed: redraw the invite cards in the open chat
    function refreshStreakCards() {
        if (!S.current || S.current.kind !== 'dm' || !S.messages) return;
        S.messages.forEach(function (m) { if (!m.deleted_at && isStreakInvite(m.body)) rebuildNode(m); });
    }

    // list row pill for an invite you received
    function inviteChip(r) {
        const row = skRow(r);
        if (!row || row.status !== 'pending' || row.invitedByMe) return null;
        return el('span', { class: 'ch-streak is-invite', dataset: { tier: '3' }, title: 'Streak invite', 'aria-label': 'Streak invite' }, flameEl(), el('b', { text: 'Invite' }));
    }

    async function doRestore(btn, r, dlg) {
        setLoading(btn, true);
        try {
            const res = await sb.rpc('chat_restore_streak', { p_room: r.room_id });
            if (res.error) throw res.error;
            const row = (res.data || [])[0];
            if (row && S.restoreInfo) S.restoreInfo.left = Number(row.restores_left) || 0;
            toast('🔥 Streak restored! You are back at ' + (row ? row.streak : 'it'));
            S.streakPop = r.room_id;
            setTimeout(function () { if (S.streakPop === r.room_id) S.streakPop = null; }, 1800);
            await loadStreaks();
            if (dlg.isConnected) dlg.close();
        } catch (e) {
            setLoading(btn, false);
            const m = String((e && e.message) || '');
            toast(m.indexOf('no_restores') >= 0 ? 'No restores left this month. They refill on the 1st.'
                : m.indexOf('nothing_to_restore') >= 0 ? 'Too late, that streak can not be restored anymore.'
                : m.indexOf('blocked') >= 0 ? 'You can not restore a streak with a blocked user.'
                : 'Could not restore the streak. Try again.');
            loadStreaks();
        }
    }


    async function loadInvites() {
        const res = await sb.rpc('chat_my_invites');
        if (res.error) throw res.error;
        S.invites = res.data || [];
        updateBadges();
    }

    const INBOX_SELECT = 'id,kind,room_id,message_id,preview,read_at,created_at,from_id,sender:profiles!from_id(id,username,display_name,avatar_url),room:chat_rooms(name,icon,kind)';

    // The server writes an inbox row for EVERY message. The Inbox tab should only show
    // invites and messages that @mention you, otherwise it is just a copy of every chat.
    async function loadInbox() {
        const name = S.profile && S.profile.username;
        const jobs = [
            sb.from('chat_inbox').select(INBOX_SELECT).eq('kind', 'invite').order('created_at', { ascending: false }).limit(40)
        ];
        if (name) {
            jobs.push(sb.from('chat_inbox').select(INBOX_SELECT).eq('kind', 'message').neq('from_id', S.me.id)
                .ilike('preview', '%@' + escapeLike(name) + '%').order('created_at', { ascending: false }).limit(40));
        }
        const out = await Promise.all(jobs);
        out.forEach(function (r) { if (r.error) throw r.error; });
        const rows = [];
        out.forEach(function (r) { (r.data || []).forEach(function (row) { rows.push(row); }); });
        S.inbox = rows
            .filter(function (i) { return i.kind === 'invite' || mentionsUser(i.preview, name); })
            .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
            .slice(0, 60);
        updateBadges();
    }

    async function loadDiscover() {
        const res = await sb.rpc('chat_discover');
        if (res.error) throw res.error;
        S.discover = res.data || [];
    }

    function roomTitle(r) {
        if (r.kind === 'dm') return r.nickname || r.other_display || r.other_username || 'Direct message';
        return r.name || 'Chat';
    }

    function realName(r) { return r.other_display || r.other_username || 'this user'; }

    function roomArt(r, size) {
        if (r.kind === 'dm') return avatar({ id: r.other_id, display_name: r.other_display, username: r.other_username, avatar_url: r.other_avatar }, size);
        if (r.kind === 'community' && window.SPCS) { const a = window.SPCS.artEl(r); if (a) return a; }
        return el('span', { class: 'ch-art' + (size ? '' : ''), text: r.icon || '💬' });
    }

    /* ----------------------------------------------------------------------
       6. SIDEBAR + LIST COLUMN
       ---------------------------------------------------------------------- */
    const TITLES = { mine: 'My chats', communities: 'Communities', invites: 'Community Invites', inbox: 'Inbox' };

    function renderNav() {
        const app = $('chApp');
        app.dataset.nav = S.nav;
        document.querySelectorAll('[data-nav]').forEach(function (b) {
            if (b.closest && b.closest('#chApp') === null) return;
            b.classList.toggle('is-active', b.dataset.nav === S.nav);
            if (b.dataset.nav === S.nav) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
    }

    function actionBtn(label, ico, onclick) {
        return el('button', { type: 'button', class: 'ch-iconbtn', 'aria-label': label, title: label, onclick: onclick }, icon(ico));
    }

    function renderListHead() {
        $('chListTitle').textContent = TITLES[S.nav];
        const acts = $('chListActions');
        acts.textContent = '';
        if (S.nav === 'mine') {
            acts.appendChild(actionBtn('New message', 'dm', openDm));
            acts.appendChild(actionBtn('New group', 'plus', function () { openCreate('group'); }));
        } else if (S.nav === 'communities') {
            acts.appendChild(actionBtn('Join with a code', 'hash', openCode));
            acts.appendChild(actionBtn('Create a community', 'plus', function () { openCreate('community'); }));
        } else if (S.nav === 'inbox') {
            acts.appendChild(actionBtn('Mark all read', 'check', markAllInboxRead));
        }
        $('chSearchWrap').hidden = !(S.nav === 'mine' || S.nav === 'communities');
        $('chSearch').placeholder = S.nav === 'communities' ? 'Search communities' : 'Search chats';
    }

    function emptyBox(title, text, actions) {
        return el('div', { class: 'ch-list-empty' }, el('h3', { text: title }), el('p', { text: text }), actions ? el('div', { class: 'ch-list-empty-actions' }, actions) : null);
    }

    function renderList() {
        renderNav();
        if (window.SPCH && SPCH.renderList()) return;       // a community is open: show its channels instead of My chats
        renderListHead();
        const body = $('chListBody');
        body.textContent = '';
        const q = S.query.trim().toLowerCase();

        if (S.nav === 'mine') {
            const rooms = S.rooms.filter(function (r) { return !q || (roomTitle(r) + ' ' + (r.other_display || '') + ' ' + (r.other_username || '') + ' ' + (r.last_body || '')).toLowerCase().indexOf(q) >= 0; });
            if (!rooms.length) {
                body.appendChild(q ? emptyBox('No chats match', 'Try a different search.')
                    : emptyBox('No chats yet', 'Message someone, make a group, or join a community.', [
                        el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: openDm }, 'New message'),
                        el('button', { type: 'button', class: 'ch-btn ch-btn--ghost ch-btn--sm', onclick: function () { setNav('communities'); } }, 'Browse communities')]));
                return;
            }
            rooms.forEach(function (r) { body.appendChild(roomRow(r)); });
        } else if (S.nav === 'communities') {
            const list = S.discover.filter(function (c) { return !q || ((c.name || '') + ' ' + (c.description || '')).toLowerCase().indexOf(q) >= 0; });
            if (!list.length) { body.appendChild(emptyBox('No public communities', q ? 'Nothing matches that search.' : 'Be the first: create one and make it public.', q ? null : [el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: function () { openCreate('community'); } }, 'Create a community')])); return; }
            list.forEach(function (c) { body.appendChild(communityCard(c)); });
        } else if (S.nav === 'invites') {
            if (!S.invites.length) { body.appendChild(emptyBox('No invites', 'When someone invites you to a chat, it shows up here.')); return; }
            S.invites.forEach(function (i) { body.appendChild(inviteCard(i)); });
        } else {
            if (!S.inbox.length) { body.appendChild(emptyBox('Inbox is empty', 'Mentions, replies and invites show up here.')); return; }
            S.inbox.forEach(function (i) { body.appendChild(inboxRow(i)); });
        }
    }

    function subText(r) {
        const mineLast = r.last_sender && S.me && r.last_sender === S.me.id;
        return r.last_body ? (mineLast ? 'You: ' : '') + safePreview(r.last_body, r.last_sender) : (r.kind === 'dm' ? 'Say hi' : (r.description || 'No messages yet'));
    }

    function roomRow(r) {
        const active = S.current && S.current.room_id === r.room_id;
        const typing = activeTyping(r.room_id).length > 0;
        const online = r.kind === 'dm' && !r.blocked_by_me && S.onlineAll.has(r.other_id);
        const sk = streakChip(r, false) || inviteChip(r);

        const item = el('button', { type: 'button', 'aria-label': 'Open chat with ' + roomTitle(r), class: 'ch-item' + (active ? ' is-active' : '') + (r.unread ? ' is-unread' : '') + (r.muted ? ' is-muted' : ''), dataset: typing ? { room: r.room_id, typing: '1' } : { room: r.room_id },
            onclick: function (e) {
                e.preventDefault(); e.stopPropagation();
                if (S.lpFired) { S.lpFired = false; return; }       // that click was the end of a long-press
                openRoom(r.room_id);
            } },
            el('span', { class: 'ch-item-av' }, roomArt(r, 46), (r.kind === 'dm' && !r.blocked_by_me) ? stDot(r.other_id, S.onlineAll.has(r.other_id), 'ch-item-st') : null),
            el('span', { class: 'ch-item-main' },
                el('span', { class: 'ch-item-title' + (sk ? ' has-streak' : '') }, r.pinned ? el('span', { class: 'ch-pin', title: 'Pinned' }, icon('pin')) : null, sk ? el('span', { class: 'ch-item-name', text: roomTitle(r) }) : roomTitle(r), sk),
                el('span', { class: 'ch-item-sub' + (typing ? ' is-typing' : ''), text: typing ? 'typing…' : subText(r) }),
                (r.kind === 'dm' && !r.blocked_by_me) ? csNode(r.other_id, 'ch-item-cs') : null),
            el('span', { class: 'ch-item-meta' },
                el('time', { text: fmtListTime(r.last_at) }),
                r.muted ? el('span', { class: 'ch-muted-ico', title: 'Muted' }, icon('belloff')) : null,
                r.unread ? el('span', { class: 'ch-unread' + (r.muted ? ' is-muted' : ''), text: r.unread > 99 ? '99+' : String(r.unread) }) : null));

        const more = el('button', { type: 'button', class: 'ch-more', 'aria-label': 'Options for ' + roomTitle(r), 'aria-haspopup': 'menu', title: 'Options', dataset: { room: r.room_id } }, icon('more'));

        return el('div', { class: 'ch-row', role: 'listitem', dataset: { row: r.room_id } }, item, more);
    }

    function communityCard(c) {
        return el('article', { class: 'ch-card', role: 'listitem' },
            (window.SPCS && window.SPCS.cardArt(c)) || el('span', { class: 'ch-card-icon', text: c.icon || '💬' }),
            el('div', { class: 'ch-card-main' },
                el('h3', { text: c.name }),
                c.description ? el('p', { text: c.description }) : null,
                window.SPCS ? window.SPCS.tagsEl(c) : null,
                el('small', { text: Number(c.member_count) + ' member' + (Number(c.member_count) === 1 ? '' : 's') })),
            c.joined
                ? el('button', { type: 'button', class: 'ch-btn ch-btn--ghost ch-btn--sm', onclick: function () { openRoom(c.room_id); } }, 'Open')
                : el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: function (e) { joinPublic(c, e.currentTarget); } }, 'Join'));
    }

    function inviteCard(i) {
        return el('article', { class: 'ch-card', role: 'listitem' },
            el('span', { class: 'ch-card-icon', text: i.room_icon || '💬' }),
            el('div', { class: 'ch-card-main' },
                el('h3', { text: i.room_name || 'A chat' }),
                el('p', { text: 'Invited by @' + (i.invited_by_username || i.inviter_username || 'someone') }),
                el('small', { text: fmtListTime(i.created_at) })),
            el('div', { class: 'ch-card-actions' },
                el('button', { type: 'button', class: 'ch-btn ch-btn--sm', onclick: function (e) { respondInvite(i, true, e.currentTarget); } }, 'Accept'),
                el('button', { type: 'button', class: 'ch-btn ch-btn--ghost ch-btn--sm', onclick: function (e) { respondInvite(i, false, e.currentTarget); } }, 'Decline')));
    }

    function inboxRow(i) {
        const who = i.sender ? (i.sender.display_name || i.sender.username) : 'Someone';
        const where = i.room ? (i.room.name || 'a chat') : 'a chat';
        const text = i.kind === 'invite' ? who + ' invited you to ' + where
            : i.kind === 'reply' ? who + ' replied to you in ' + where
            : who + ' mentioned you in ' + where;
        return el('button', { type: 'button', role: 'listitem', class: 'ch-item ch-item--inbox' + (i.read_at ? '' : ' is-unread'), onclick: function () { openInboxItem(i); } },
            el('span', { class: 'ch-item-av' }, avatar(i.sender || {}, 46)),
            el('span', { class: 'ch-item-main' },
                el('span', { class: 'ch-item-title', text: text }),
                i.preview && i.kind !== 'invite' ? el('span', { class: 'ch-item-sub', text: safePreview(i.preview, i.from_id) }) : null),
            el('span', { class: 'ch-item-meta' }, el('time', { text: fmtListTime(i.created_at) }), i.read_at ? null : el('span', { class: 'ch-dot', 'aria-label': 'Unread' })));
    }

    async function setNav(name) {
        if (window.SPCH) SPCH.leave();
        S.nav = name;
        S.query = '';
        $('chSearch').value = '';
        $('chApp').dataset.view = 'list';
        closeDrawer();
        renderList();
        try {
            if (name === 'communities') { await loadDiscover(); renderList(); }
            if (name === 'invites') { await loadInvites(); renderList(); }
            if (name === 'inbox') { await loadInbox(); renderList(); }
        } catch (err) { toast(friendly(err)); }
    }

    function openDrawer() {
        const app = $('chApp');
        const opening = !app.classList.contains('is-drawer');
        app.classList.toggle('is-drawer', opening);
        $('chMenuBtn').setAttribute('aria-expanded', String(opening));
        if ($('chMenuBtnConvo')) $('chMenuBtnConvo').setAttribute('aria-expanded', String(opening));
    }
    function closeDrawer() {
        $('chApp').classList.remove('is-drawer');
        $('chMenuBtn').setAttribute('aria-expanded', 'false');
        if ($('chMenuBtnConvo')) $('chMenuBtnConvo').setAttribute('aria-expanded', 'false');
    }

    /* ----------------------------------------------------------------------
       7. CONVERSATION
       ---------------------------------------------------------------------- */
    function atBottomNow() {
        const f = $('chFeed');
        return f.scrollHeight - f.scrollTop - f.clientHeight < 90;
    }

    function scrollToBottom() {
        const f = $('chFeed');
        f.scrollTop = f.scrollHeight;
        S.atBottom = true;
        S.newCount = 0;
        paintJump();
    }

    function paintJump() {
        const j = $('chJump');
        j.hidden = S.atBottom;
        $('chJumpN').textContent = S.newCount > 0 ? String(S.newCount) : '';
    }

    async function cacheProfiles(ids) {
        const need = Array.from(new Set(ids)).filter(function (id) { return id && !S.profiles.has(id); });
        if (!need.length) return;
        const res = await sb.from('profiles').select('id,username,display_name,avatar_url').in('id', need);
        (res.data || []).forEach(function (p) { S.profiles.set(p.id, p); });
    }

    const MSG_SELECT = 'id,room_id,sender_id,body,reply_to,created_at,edited_at,deleted_at,attachment_path,attachment_name,attachment_type,attachment_size,sender:profiles(id,username,display_name,avatar_url),reactions:chat_reactions(emoji,user_id)';

    async function fetchMessages(roomId, before) {
        let q = sb.from('chat_messages').select(MSG_SELECT).eq('room_id', roomId);
        const rm = S.roomMap.get(roomId);
        if (rm && rm.cleared_at) q = q.gt('created_at', rm.cleared_at);     // "Delete chat" hides older history for you
        if (window.SPCH) q = SPCH.scope(q, roomId);                             // community: only the open channel
        if (before) q = q.lt('created_at', before);
        const res = await q.order('created_at', { ascending: false }).limit(PAGE);
        if (res.error) throw res.error;
        const rows = (res.data || []).reverse();
        rows.forEach(function (m) { if (m.sender) S.profiles.set(m.sender_id, m.sender); m.reactions = m.reactions || []; });
        await loadBugStatuses(rows);
        return rows;
    }

    async function fetchParents(rows) {
        const have = new Set(rows.map(function (m) { return m.id; }));
        const need = Array.from(new Set(rows.map(function (m) { return m.reply_to; }).filter(function (id) { return id && !have.has(id) && !S.byId.has(id) && !S.extra.has(id); })));
        if (!need.length) return;
        const res = await sb.from('chat_messages').select('id,sender_id,body,deleted_at,sender:profiles(id,username,display_name)').in('id', need);
        (res.data || []).forEach(function (m) { S.extra.set(m.id, m); });
    }

    function senderOf(m) { return m.sender || S.profiles.get(m.sender_id) || { username: 'member' }; }
    function nameOf(p) {
        p = p || {};
        // a nickname you set for a DM partner is used everywhere inside that DM
        if (p.id && S.current && S.current.kind === 'dm' && S.current.nickname && p.id === S.current.other_id) return S.current.nickname;
        return p.display_name || p.username || 'member';
    }
    function sameRoom(r) { return !!(r && S.current && S.current.room_id === r.room_id); }

    // ---- rich text ----
    function getJumboEmojiCount(text) {
        const value = String(text || '').trim();
        if (!value) return 0;
        const normalized = value.replace(/https:\/\/cdn\d+\.emoji\.gg\/[\w./%+-]+\.(?:png|gif|webp|jpe?g)(?:[?#][^\s]*)?/gi, function (url) {
            return isCustomEmojiUrl(url) ? ':customemoji:' : url;
        });
        const token = '(?:\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?)*(?:\\p{Emoji_Modifier})?|\\p{Regional_Indicator}{2}|:[a-z0-9_+-]{1,32}:)';
        const only = new RegExp('^(?:' + token + ')+$', 'u');
        if (!only.test(normalized)) return 0;
        const tokens = normalized.match(new RegExp(token, 'gu')) || [];
        return tokens.length;
    }

    function renderRich(text, mine, jumboEmoji) {
        const frag = document.createDocumentFragment();
        const myName = S.profile && S.profile.username;
        const cards = [];
        parseMessage(text).forEach(function (blk) {
            if (blk.t === 'block') { frag.appendChild(buildCodeBlock(blk.v, blk.lang)); return; }
            const inlineText = blk.v.replace(/:([a-z0-9_+-]{1,32}):/gi, function (match, name, offset, whole) {
                const k = name.toLowerCase();
                if (CUSTOM_EMOJI[k]) return '\u0000' + k + '\u0000';
                // standard emoji (:sob:, :loudly_crying_face:...). not when glued to a word, like 12:100:5
                if (FL.byCode[k] && !(offset > 0 && /[A-Za-z0-9]/.test(whole.charAt(offset - 1)))) return '\u0000' + k + '\u0000';
                return match;
            }).replace(/https:\/\/cdn\d+\.emoji\.gg\/[\w./%+-]+\.(?:png|gif|webp|jpe?g)(?:[?#][^\s]*)?/gi, function (url) {
                return isCustomEmojiUrl(url) ? '\u0000url:' + url + '\u0000' : url;
            });
            parseInline(inlineText).forEach(function (tok) {
                if (tok.t === 'text' && tok.v.indexOf('\u0000') >= 0) {
                    tok.v.split(/(\u0000(?:[a-z0-9_+-]{1,32}|url:https:\/\/[^\u0000]+)\u0000)/i).forEach(function (piece) {
                        const match = /^\u0000([a-z0-9_+-]{1,32}|url:https:\/\/[^\u0000]+)\u0000$/i.exec(piece);
                        if (match && match[1].indexOf('url:') === 0) frag.appendChild(makeCustomEmoji(match[1].slice(4), 'Custom emoji', jumboEmoji));
                        else if (match) {
                            const k = match[1].toLowerCase();
                            if (CUSTOM_EMOJI[k]) frag.appendChild(SUPER[k] && STORE_EMOTE[k] ? makeSuperSticker(k) : makeCustomEmoji(CUSTOM_EMOJI[k], ':' + match[1] + ':', jumboEmoji));
                            else if (FL.byCode[k]) frag.appendChild(makeFluentEmoji(FL.byCode[k], jumboEmoji));
                            else frag.appendChild(document.createTextNode(':' + k + ':'));
                        }
                        else if (piece) appendTextWithEmoji(frag, piece, jumboEmoji);
                    });
                    return;
                }
                if (tok.t === 'text') appendTextWithEmoji(frag, tok.v, jumboEmoji);
                else if (tok.t === 'b') frag.appendChild(el('strong', { text: unmark(tok.v) }));
                else if (tok.t === 'i') frag.appendChild(el('em', { text: unmark(tok.v) }));
                else if (tok.t === 's') frag.appendChild(el('s', { text: unmark(tok.v) }));
                else if (tok.t === 'code') frag.appendChild(el('code', { class: 'ch-code', text: unmark(tok.v) }));
                else if (tok.t === 'spoiler') frag.appendChild(el('span', { class: 'ch-spoiler', role: 'button', tabindex: '0', title: 'Reveal', onclick: function (e) { e.stopPropagation(); e.currentTarget.classList.toggle('is-open'); } }, unmark(tok.v)));
                else if (tok.t === 'link') {
                    const u = safeHttps(tok.v);
                    if (u && isCustomEmojiUrl(u)) frag.appendChild(makeCustomEmoji(u, tok.label || 'Custom emoji', jumboEmoji));
                    else frag.appendChild(u ? el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', class: 'ch-link', text: tok.label || tok.v }) : document.createTextNode(tok.v));
                    if (u && cards.length < 2) {
                        const sid = snippetIdFromUrl(u), gh = githubRepoFromUrl(u);
                        if (sid) cards.push(snippetCard(sid));
                        else if (gh) cards.push(githubCard(gh));
                    }
                }
                else if (tok.t === 'mention') frag.appendChild(el('span', { class: 'ch-mention' + (myName && tok.v.toLowerCase() === myName.toLowerCase() ? ' is-me' : ''), text: '@' + tok.v }));
            });
        });
        cards.forEach(function (c) { frag.appendChild(c); });
        return frag;
    }

    function makeCustomEmoji(url, label, jumboEmoji) {
        // a plain picture: no link, nothing to click, nothing to drag
        const img = el('img', { class: 'ch-inline-emoji' + (jumboEmoji ? ' ch-inline-emoji--jumbo' : ''), src: url, alt: label, title: label, loading: 'lazy', draggable: 'false' });
        img.onerror = function () { img.replaceWith(document.createTextNode(label)); };
        return img;
    }

    // image hosts we trust for emoji pictures (emoji.gg memes + Microsoft 3D Fluent emoji from Emojipedia's CDN)
    function isCustomEmojiUrl(url) {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname;
            const okHost = /(^|\.)emoji\.gg$/i.test(host) || /^em-content\.zobj\.net$/i.test(host);
            return parsed.protocol === 'https:' && okHost && /\.(?:png|gif|webp|jpe?g)$/i.test(parsed.pathname);
        } catch (e) { return false; }
    }

    function groupReactions(m) {
        const map = new Map();
        (m.reactions || []).forEach(function (r) {
            const g = map.get(r.emoji) || { emoji: r.emoji, n: 0, mine: false };
            g.n++;
            if (S.me && r.user_id === S.me.id) g.mine = true;
            map.set(r.emoji, g);
        });
        return Array.from(map.values());
    }

    function replyQuote(m) {
        const p = S.byId.get(m.reply_to) || S.extra.get(m.reply_to);
        const who = p ? nameOf(senderOf(p)) : 'a message';
        const txt = p ? (p.deleted_at ? 'Message deleted' : safePreview(p.body, p.sender_id)) : 'Original message not loaded';
        return el('button', { type: 'button', class: 'ch-replyq', onclick: function (e) { e.stopPropagation(); jumpToMessage(m.reply_to); } },
            el('strong', { text: who }), el('span', { text: txt }));
    }

    async function signedFileUrl(path) {
        const cached = S.fileUrls.get(path);
        if (cached && cached.expires > Date.now()) return cached.url;
        const res = await sb.storage.from('chat-attachments').createSignedUrl(path, 3600);
        if (res.error) throw res.error;
        const url = res.data.signedUrl;
        S.fileUrls.set(path, { url: url, expires: Date.now() + 55 * 60 * 1000 });
        return url;
    }

    function renderAttachment(m, bubble) {
        if (!m.attachment_path || m.deleted_at) return;
        const card = el('div', { class: 'ch-attachment ch-attachment--loading', text: 'Loading attachment…' });
        bubble.appendChild(card);
        signedFileUrl(m.attachment_path).then(function (url) {
            if (!card.isConnected) return;
            if (/^video\//i.test(String(m.attachment_type || ''))) { renderVideoCard(card, m, url); return; }
            if (/^audio\//i.test(String(m.attachment_type || ''))) { renderAudioCard(card, m, url); return; }
            const link = el('a', { class: 'ch-attachment-link', href: url, target: '_blank', rel: 'noopener noreferrer', download: m.attachment_name || 'attachment' });
            if (String(m.attachment_type || '').indexOf('image/') === 0) {
                link.classList.add('ch-attachment-link--image');
                link.appendChild(el('img', { class: 'ch-attachment-image', src: url, alt: m.attachment_name || 'Shared image', loading: 'lazy' }));
            } else {
                link.appendChild(el('span', { class: 'ch-attachment-file-icon', text: '↧' }));
                link.appendChild(el('span', { class: 'ch-attachment-file-name', text: m.attachment_name || 'Download file' }));
                link.appendChild(el('small', { text: formatBytes(m.attachment_size || 0) }));
            }
            card.classList.remove('ch-attachment--loading');
            card.textContent = '';
            card.appendChild(link);
            if (String(m.attachment_type || '').indexOf('image/') === 0) guardImage(card, m.attachment_path, url, !!(S.me && m.sender_id === S.me.id), false);
        }).catch(function () {
            if (card.isConnected) card.textContent = 'Attachment unavailable';
        });
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function buildMsg(m, grouped) {
        const mine = !!(S.me && m.sender_id === S.me.id);
        const sender = senderOf(m);
        const deleted = !!m.deleted_at;
        const mentioned = !deleted && !mine && mentionsUser(m.body, S.profile && S.profile.username);

        const bug = deleted ? null : (parseBug(m.body) || (isStreakInvite(m.body) ? { streak: true } : null));
        const jumboEmoji = !deleted && !bug && !m.attachment_path && !m.reply_to && !m.edited_at && !m.deleted_at && getJumboEmojiCount(m.body) > 0 && getJumboEmojiCount(m.body) <= 6;
        const hideKind = hideKindFor(m, mine, deleted, bug);
        const hidden = !!hideKind && !S.revealed.has(m.id);
        const imageAttachment = !deleted && !hidden && !!m.attachment_path && /^(image|video|audio)\//i.test(m.attachment_type || '');      // images AND videos sit under the bubble as their own card
        const imageOnlyAttachment = imageAttachment && (!String(m.body || '').trim() || /^Attachment:\s*/i.test(m.body));
        const gifUrl = (!deleted && !bug && !m.attachment_path) ? gifMediaUrl(m.body) : null;
        const bubble = el('div', { class: 'ch-bubble' + (gifUrl && !hidden ? ' ch-bubble--image-only ch-bubble--gif' : '') + (bug ? ' ch-bubble--card' : '') + (jumboEmoji && !hidden ? ' ch-bubble--emoji-only' : '') + (imageOnlyAttachment ? ' ch-bubble--image-only' : '') + (hidden ? ' ch-bubble--sensitive' : '') }, deleted ? el('em', { class: 'ch-deleted', text: 'Message deleted' }) : (hidden ? buildSensitiveCard(m, hideKind) : (bug ? (bug.streak ? buildStreakCard(m) : buildBugCard(m, bug)) : (imageOnlyAttachment ? null : (gifUrl ? makeGifView(gifUrl) : renderRich(m.body, mine, jumboEmoji))))));
        const imageAttachmentView = imageAttachment ? el('div', { class: 'ch-attachment ch-attachment--standalone' }) : null;
        if (imageAttachmentView) renderAttachment(m, imageAttachmentView);
        else if (!deleted && m.attachment_path && !hidden) renderAttachment(m, bubble);

        const reactions = el('div', { class: 'ch-reactions' });
        groupReactions(m).forEach(function (g) {
            const customReaction = /^:([a-z0-9_+-]{1,32}):$/i.exec(g.emoji);
            const flReaction = customReaction ? null : flByChar(g.emoji);
            const reactionContent = customReaction && CUSTOM_EMOJI[customReaction[1].toLowerCase()]
                ? el('img', { class: 'ch-reaction-emoji', src: CUSTOM_EMOJI[customReaction[1].toLowerCase()], alt: g.emoji, title: g.emoji })
                : (flReaction ? makeFluentImg(flReaction, 'ch-reaction-emoji') : el('span', { text: g.emoji }));
            reactions.appendChild(el('button', { type: 'button', class: 'ch-react' + (g.mine ? ' is-mine' : ''), 'aria-pressed': String(g.mine), 'aria-label': g.emoji + ' ' + g.n, onclick: function (e) { e.stopPropagation(); toggleReaction(m, g.emoji); } },
                reactionContent, el('b', { text: String(g.n) })));
        });

        const tools = el('div', { class: 'ch-tools', role: 'toolbar', 'aria-label': 'Message actions' });
        if (!deleted && !m.pending) {
            tools.appendChild(el('button', { type: 'button', class: 'ch-tool', title: 'React', 'aria-label': 'React', onclick: function (e) { e.stopPropagation(); openQuick(m, e.currentTarget); } }, icon('smile')));
            tools.appendChild(el('button', { type: 'button', class: 'ch-tool', title: 'Reply', 'aria-label': 'Reply', onclick: function (e) { e.stopPropagation(); startReply(m); } }, icon('reply')));
            if (mine && !bug) tools.appendChild(el('button', { type: 'button', class: 'ch-tool', title: 'Edit', 'aria-label': 'Edit', onclick: function (e) { e.stopPropagation(); startEdit(m); } }, icon('edit')));
            if (!bug && canPinHere(S.current)) tools.appendChild(el('button', { type: 'button', class: 'ch-tool', title: S.pinIds.has(m.id) ? 'Unpin message' : 'Pin message', 'aria-label': S.pinIds.has(m.id) ? 'Unpin message' : 'Pin message', onclick: function (e) { e.stopPropagation(); togglePinMessage(m); } }, icon('pin')));
            if (!mine && !bug) tools.appendChild(el('button', { type: 'button', class: 'ch-tool ch-tool--danger', title: 'Report', 'aria-label': 'Report message', onclick: function (e) { e.stopPropagation(); openReport(m); } }, icon('flag')));
        }
        // phones: the hover toolbar is hidden there, so this always-visible button opens the same sheet (React, Reply, Edit...)
        const moreBtn = (!deleted && !m.pending)
            ? el('button', { type: 'button', class: 'ch-msg-more', title: 'Message actions', 'aria-label': 'Message actions', onclick: function (e) { e.stopPropagation(); openMsgSheet(m, e.currentTarget.closest('.ch-msg')); } }, icon('more'))
            : null;
        const canDelete = !deleted && !m.pending && (mine || (S.current && (S.current.role === 'owner' || S.current.role === 'admin')) || modCan('manage_messages'));
        if (canDelete) tools.appendChild(el('button', { type: 'button', class: 'ch-tool ch-tool--danger', title: 'Delete', 'aria-label': 'Delete', onclick: function (e) { e.stopPropagation(); deleteMessage(m); } }, icon('trash')));

        const head = grouped ? null : el('div', { class: 'ch-msg-head' },
            sender.username ? el('a', { class: 'ch-msg-name', href: 'profile.html?u=' + encodeURIComponent(sender.username), text: nameOf(sender) }) : el('span', { class: 'ch-msg-name', text: nameOf(sender) }),
            titleSlot(m.sender_id || sender.id),
            el('time', { class: 'ch-msg-time', datetime: m.created_at, text: fmtTime(m.created_at) }),
            m.edited_at && !deleted ? el('span', { class: 'ch-edited', text: '(edited)' }) : null);

        const node = el('article', {
            class: 'ch-msg' + (mine ? ' ch-msg--own' : '') + (grouped ? ' is-grouped' : '') + (m.pending ? ' is-pending' : '') + (mentioned ? ' is-mentioned' : ''),
            dataset: { id: m.id }
        },
            grouped ? el('span', { class: 'ch-msg-gap', 'aria-hidden': 'true' }) : el('span', { class: 'ch-msg-av' }, avatar(sender, 36)),
            el('div', { class: 'ch-msg-body' }, head, m.reply_to && !deleted ? replyQuote(m) : null, bubble, imageAttachmentView, reactions.children.length ? reactions : null),
            tools,
            moreBtn);

        // phones: a plain tap does nothing. Hold the message to get the action sheet (see wireMessageSheet)
        return node;
    }

    /* ----------------------------------------------------------------------
       HIDDEN-MESSAGE CARD, BLOCK, REPORT, FILTER SETTINGS
       ---------------------------------------------------------------------- */
    function buildSensitiveCard(m, kind) {
        const blocked = kind === 'blocked';
        const stop = function (fn) { return function (e) { e.stopPropagation(); fn(); }; };
        const link = function (label, fn) { return el('button', { type: 'button', class: 'ch-sensitive-link', onclick: stop(fn) }, label); };

        const line = blocked
            ? el('p', { class: 'ch-sensitive-text' }, 'You blocked this user, so their message is hidden. ', link('Unblock', function () { setSenderBlock(m, false); }))
            : el('p', { class: 'ch-sensitive-text' }, 'This message contains harmful or sensitive content. You can ',
                link('block', function () { setSenderBlock(m, true); }), ' and ', link('report', function () { openReport(m); }), ' the sender.');

        return el('div', { class: 'ch-sensitive', role: 'group', 'aria-label': 'Hidden message' },
            el('div', { class: 'ch-sensitive-head' }, icon('info'), line),
            el('button', { type: 'button', class: 'ch-sensitive-show', onclick: stop(function () { S.revealed.add(m.id); rebuildNode(m); }) }, 'Show message'),
            blocked ? null : el('button', { type: 'button', class: 'ch-sensitive-why', onclick: stop(openFilterDlg) }, 'Why am I seeing this? Learn more.'));
    }

    async function loadBlocks() {
        try {
            const res = await sb.from('chat_blocks').select('blocked_id').eq('blocker_id', S.me.id);
            if (res.error) return;
            S.blocked = new Set((res.data || []).map(function (r) { return r.blocked_id; }));
        } catch (e) { /* blocking is optional, the page works without it */ }
    }

    async function setSenderBlock(m, block) {
        const who = nameOf(senderOf(m));
        if (block && !window.confirm('Block ' + who + '?\n\nTheir messages will be hidden for you, and you will not be able to message each other in DMs until you unblock them.')) return;
        try {
            const res = await sb.rpc('chat_set_block', { p_user: m.sender_id, p_block: block });
            if (res.error) throw res.error;
            if (block) S.blocked.add(m.sender_id); else S.blocked.delete(m.sender_id);
            S.rooms.forEach(function (r) { if (r.kind === 'dm' && r.other_id === m.sender_id) r.blocked_by_me = block; });
            if (S.current && S.current.kind === 'dm' && S.current.other_id === m.sender_id) { S.current.blocked_by_me = block; paintHeader(); }
            toast(block ? 'Blocked ' + who : 'Unblocked ' + who);
            renderFeed({ keepScroll: true });
            renderList();
        } catch (err) { toast(friendly(err)); }
    }

    // ----- report a message (uses report_submit from supabase-reports.sql) -----
    const REPORT_ERR = {
        login: 'Please log in again.',
        restricted: 'Your account cannot send reports right now.',
        bad_reason: 'Pick a reason first.',
        bad_note: 'Keep the note under 300 characters.',
        too_many: 'You have sent a lot of reports today. Try again tomorrow.',
        own_content: 'You cannot report your own message.',
        not_found: 'That message is no longer available.'
    };
    let reportTarget = null;

    function openReport(m) {
        reportTarget = m;
        showBox('reportMsg', '');
        $('reportReason').value = 'harassment';
        $('reportNote').value = '';
        openDlg('reportDlg');
    }

    async function submitReport(e) {
        e.preventDefault();
        if (!reportTarget) return;
        const btn = $('reportSave');
        setLoading(btn, true);
        try {
            const res = await sb.rpc('report_submit', {
                p_type: 'chat_message',
                p_target: reportTarget.id,
                p_reason: $('reportReason').value,
                p_note: $('reportNote').value.trim() || null
            });
            if (res.error) throw res.error;
            const out = res.data || {};
            if (out.ok === false) { showBox('reportMsg', REPORT_ERR[out.error] || 'Could not send the report. Please try again.'); return; }
            closeDlg('reportDlg');
            toast('Report sent. Thanks for helping keep SPECSOFT safe.');
        } catch (err) {
            const msg = String(err && err.message || '');
            showBox('reportMsg', /report_submit/.test(msg) && isSetupMissing(err) ? 'Run supabase-reports.sql in your Supabase SQL Editor to turn on reporting.' : friendly(err));
        } finally { setLoading(btn, false); }
    }

    // ----- the "hide sensitive messages" switch -----
    function paintFilterBtn() {
        const b = $('chFilterBtn');
        if (!b) return;
        setIcon('chFilterBtn', S.filterOn ? 'shield' : 'shieldoff');
        b.setAttribute('aria-pressed', String(S.filterOn));
    }

    function initFilter() {
        try { S.filterOn = localStorage.getItem('specsoft.chat.filter') !== 'off'; } catch (e) { /* ignore */ }
        loadImgPrefs();
        paintFilterBtn();
    }

    function setFilter(on) {
        S.filterOn = !!on;
        try { localStorage.setItem('specsoft.chat.filter', S.filterOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
        paintFilterBtn();
        if (S.current) renderFeed({ keepScroll: true });
        renderList();
    }

    function openFilterDlg() {
        $('filterToggle').checked = S.filterOn;
        $('filterImgToggle').checked = S.imgOn;
        paintScannerStatus();
        openDlg('filterDlg');
    }

    function dayLabel(iso) { return el('div', { class: 'ch-day', role: 'separator' }, el('span', { text: fmtDay(iso) })); }
    function newLabel() { return el('div', { class: 'ch-new', role: 'separator', id: 'chNewLine' }, el('span', { text: 'NEW' })); }

    function renderFeed(opts) {
        opts = opts || {};
        const feed = $('chFeed');
        const prevH = feed.scrollHeight, prevTop = feed.scrollTop;
        feed.textContent = '';
        let prev = null;
        S.messages.forEach(function (m) {
            if (!prev || !sameDay(prev.created_at, m.created_at)) feed.appendChild(dayLabel(m.created_at));
            if (S.newFromId && m.id === S.newFromId) feed.appendChild(newLabel());
            const grouped = shouldGroup(prev, m) && !(S.newFromId && m.id === S.newFromId);
            feed.appendChild(buildMsg(m, grouped));
            prev = m;
        });
        if (opts.keepScroll) feed.scrollTop = prevTop + (feed.scrollHeight - prevH);
    }

    function rebuildNode(m) {
        const node = $('chFeed').querySelector('[data-id="' + m.id + '"]');
        if (!node) return;
        node.replaceWith ? node.replaceWith(buildMsg(m, node.classList.contains('is-grouped'))) : renderFeed({ keepScroll: true });
    }

    function appendMessage(m) {
        const feed = $('chFeed');
        const prev = S.messages.length > 1 ? S.messages[S.messages.length - 2] : null;
        if (!prev || !sameDay(prev.created_at, m.created_at)) feed.appendChild(dayLabel(m.created_at));
        const node = buildMsg(m, shouldGroup(prev, m));
        node.classList.add('is-fresh');
        feed.appendChild(node);
    }

    function addToState(m) {
        S.messages.push(m);
        S.byId.set(m.id, m);
    }

    async function openRoom(roomId, opts) {
        opts = opts || {};
        let room = S.roomMap.get(roomId);
        if (!room) { try { await loadRooms(); room = S.roomMap.get(roomId); } catch (e) { /* ignore */ } }
        if (!room) { toast('That chat was not found.'); return; }

        if (!opts.keepRoomCh) leaveRoomChannel();
        closeMention();
        closeEmojiSuggest();
        S.current = room;
        if (window.SPCH) {                                  // community: pick the channel BEFORE the first fetch
            try { await SPCH.beforeOpen(room, opts); } catch (e) { console.error(e); }
            if (!sameRoom(room)) return;
        }
        S.pinIds = new Set();
        loadPinIds(room);
        S.pendingFile = null;
        paintPendingFile();
        S.messages = []; S.byId = new Map(); S.extra = new Map();
        S.replyTo = null; S.editing = null; S.noMore = false; S.newFromId = null; S.newCount = 0; S.atBottom = true;
        if (!opts.keepRoomCh) S.online = new Set();
        cancelCompose(true);
        closeMembers();
        $('chEmoji').hidden = true;
        closeGif();

        $('chApp').dataset.view = 'chat';
        closeDrawer();
        closeMenu();
        $('chEmpty').hidden = true;
        $('chConvo').hidden = false;
        paintHeader();
        paintTyping();
        renderList();

        const snap = room.last_read_at;
        $('chFeed').textContent = '';
        $('chFeed').appendChild(el('div', { class: 'ch-feed-loading' }, el('div', { class: 'ch-spinner', 'aria-hidden': 'true' })));
        S.opening = true;

        try {
            const rows = await fetchMessages(room.room_id);
            if (!sameRoom(room)) return;                       // switched chats while loading
            await fetchParents(rows);
            // a live message can land while the history is still loading: keep both, once, in order
            const early = S.messages.slice();
            S.messages = []; S.byId = new Map();
            rows.concat(early).forEach(function (m) { if (!S.byId.has(m.id)) addToState(m); });
            S.messages.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
            S.noMore = rows.length < PAGE;
            const firstUnread = rows.find(function (m) { return m.sender_id !== S.me.id && !m.deleted_at && new Date(m.created_at) > new Date(snap); });
            S.newFromId = firstUnread ? firstUnread.id : null;
            renderFeed();

            if (opts.jump && S.byId.has(opts.jump)) jumpToMessage(opts.jump);
            else if (S.newFromId && $('chNewLine')) $('chNewLine').scrollIntoView({ block: 'center' });
            else scrollToBottom();
            S.atBottom = atBottomNow();
            paintJump();
        } catch (err) {
            $('chFeed').textContent = '';
            $('chFeed').appendChild(el('div', { class: 'ch-feed-loading', text: friendly(err) }));
        }

        S.opening = false;
        markRead(room.room_id);
        if (window.SPCH) SPCH.afterOpen();
        if (!URM && window.SPCS && window.SPCS.onOpen) window.SPCS.onOpen(room);       // chat background (skipped by Ultra reduce motion: no images or GIFs)
        if (!opts.keepRoomCh || !S.roomCh) joinRoomChannel(room.room_id);
        loadSeen(room.room_id);
        holdHint();
        vmCancel(true);
        if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) $('chInput').focus();
    }

    function closeRoom() {
        leaveRoomChannel();
        if (window.SPCH) SPCH.close();
        if (window.SPCS && window.SPCS.onClose) window.SPCS.onClose();
        S.current = null;
        S.opening = false;
        $('chConvo').hidden = true;
        $('chEmpty').hidden = false;
        $('chApp').dataset.view = 'list';
        closeMembers();
        renderList();
    }

    function paintSub() {
        const r = S.current;
        if (!r) return;
        let sub = '', full = '';
        if (r.kind === 'dm') {
            const typing = activeTyping(r.room_id).length > 0;
            sub = typing ? 'typing…' : (r.blocked_by_me ? 'Blocked' : (ST_SUB[stateOf(r.other_id, S.onlineAll.has(r.other_id))] || 'Direct message'));
            if (r.nickname) full = realName(r) + (r.other_username ? ' (@' + r.other_username + ')' : '');
        } else {
            sub = (window.SPCH && SPCH.sub(r)) || (r.member_count + ' member' + (r.member_count === 1 ? '' : 's') + (r.description ? ' · ' + r.description : ''));
            full = r.description || '';
        }
        const p = $('chRoomSub');
        if (p.textContent !== sub) p.textContent = sub;
        p.classList.toggle('is-typing', r.kind === 'dm' && sub === 'typing…');
        p.classList.toggle('is-online', r.kind === 'dm' && sub === 'Online');
        if (full) p.setAttribute('title', full); else p.removeAttribute('title');
        paintHeaderCs();
    }

    // DMs with someone you blocked (or who blocked you) are read-only
    function paintComposerLock() {
        const r = S.current;
        if (!r) return;
        const lockedMine = r.kind === 'dm' && r.blocked_by_me;
        const lockedThem = r.kind === 'dm' && r.blocked_me && !r.blocked_by_me;
        const lock = lockedMine || lockedThem;
        const input = $('chInput');
        input.disabled = lock;
        input.placeholder = lockedMine ? 'You blocked this user. Unblock them to chat again.' : lockedThem ? 'You can no longer message this user.' : 'Message...';
        ['chAttachBtn', 'chEmojiBtn', 'chGifBtn', 'chDevBtn', 'chMicBtn'].forEach(function (id) { $(id).disabled = lock; });
        $('chSend').disabled = lock || (!input.value.trim() && !S.pendingFile);
        if (window.SPCH) SPCH.lockComposer();               // announcements / coming-soon channels
    }

    function paintHeader() {
        const r = S.current;
        if (!r) return;
        $('chRoomName').textContent = roomTitle(r);
        paintStreakHead();
        const icn = $('chRoomIcon');
        icn.textContent = '';
        icn.appendChild(roomArt(r, 40));

        paintSub();

        $('chInviteBtn').hidden = r.kind === 'dm' || (r.kind === 'community' && r.role === 'member');
        $('chMembersBtn').hidden = false;
        $('chLeaveBtn').hidden = r.kind === 'dm';
        paintOnline();
        paintComposerLock();
        paintAbout();
        if (window.SPCH) SPCH.paintHeader();                // community: "# channel-name" in the header
    }

    // full (wrapped) description lives in the members drawer, the header only shows one line
    function paintAbout() {
        const box = $('chAbout'), r = S.current;
        if (!box) return;
        const text = r && r.kind !== 'dm' ? (r.description || '') : '';
        box.hidden = !text;
        $('chAboutText').textContent = text;
    }

    function paintOnline() {
        const n = S.online.size;
        $('chOnline').hidden = !(S.current && n > 0);
        $('chOnlineN').textContent = String(n);
    }

    async function markRead(roomId) {
        sendSeen(roomId);
        const room = S.roomMap.get(roomId);
        if (room) room.unread = 0;
        updateBadges();
        renderList();
        try { await sb.rpc('chat_mark_read', { p_room: roomId }); if (room) room.last_read_at = new Date().toISOString(); } catch (e) { /* not critical */ }
    }

    function jumpToMessage(id) {
        const node = $('chFeed').querySelector('[data-id="' + id + '"]');
        if (!node) { toast('That message is further back. Scroll up to load more.'); return; }
        node.scrollIntoView({ block: 'center', behavior: noMotion() ? 'auto' : 'smooth' });
        node.classList.add('is-flash');
        setTimeout(function () { node.classList.remove('is-flash'); }, 1600);
    }

    async function loadOlder() {
        if (S.loadingMore || S.noMore || !S.current || !S.messages.length) return;
        S.loadingMore = true;
        const room = S.current;
        try {
            const rows = await fetchMessages(room.room_id, S.messages[0].created_at);
            if (!sameRoom(room)) return;
            await fetchParents(rows);
            S.noMore = rows.length < PAGE;
            const fresh = rows.filter(function (m) { return !S.byId.has(m.id); });
            fresh.forEach(function (m) { S.byId.set(m.id, m); });
            S.messages = fresh.concat(S.messages);
            renderFeed({ keepScroll: true });
        } catch (err) { toast(friendly(err)); }
        finally { S.loadingMore = false; }
    }

    /* ----------------------------------------------------------------------
       8. SENDING, REPLYING, EDITING, DELETING, REACTING
       ---------------------------------------------------------------------- */
    /* ----------------------------------------------------------------------
       COMPOSER
       The message box is a contenteditable div, so a custom emoji is ONE real
       image inside the text (no hidden :name: text taking up space, no overlay
       that drifts out of line). Everything else in this file still reads and
       writes it through  $('chInput').value  exactly like the old textarea.
       ---------------------------------------------------------------------- */
    let composerRange = null;

    // DOM -> plain text (emoji images turn back into their :name: code)
    function serializeComposer(root) {
        let out = '';
        const nodes = root.childNodes;
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n.nodeType === 3) out += n.nodeValue;
            else if (n.nodeType === 1) {
                if (n.nodeName === 'IMG') out += n.getAttribute('data-code') || n.getAttribute('alt') || '';
                else if (n.nodeName === 'BR') { if (i !== nodes.length - 1) out += '\n'; }   // a last <br> is only the browser's caret placeholder
                else {
                    const inner = serializeComposer(n);                                       // <div> = a new line
                    if (out && out.slice(-1) !== '\n') out += '\n';
                    out += inner;
                }
            }
        }
        return out.replace(/\u200B/g, '');
    }

    function makeComposerEmoji(code, url) {
        const img = el('img', { class: 'ch-input-emoji', src: url, alt: code, 'data-code': code, draggable: 'false', contenteditable: 'false' });
        img.addEventListener('error', function () { img.replaceWith(document.createTextNode(code)); });     // picture missing: back to plain text
        return img;
    }

    // plain text -> DOM nodes (:name: becomes an image, \n becomes <br>)
    function composerNodes(text) {
        const nodes = [];
        const re = /:([a-z0-9_+-]{1,32}):/gi;
        let last = 0, m;
        // keyboard / picker emoji inside a piece of text become Windows 11 pictures too
        const pushLine = function (line) {
            const er = new RegExp(RE_EMOJI_SRC, 'gu');
            let from = 0, em;
            while (FL.ready && (em = er.exec(line))) {
                const item = flByChar(em[0]);
                if (!item) continue;
                if (em.index > from) nodes.push(document.createTextNode(line.slice(from, em.index)));
                nodes.push(makeComposerEmoji(em[0], item.url));
                from = em.index + em[0].length;
            }
            if (from < line.length) nodes.push(document.createTextNode(line.slice(from)));
        };
        const pushText = function (t) {
            t.split('\n').forEach(function (line, i) {
                if (i) nodes.push(document.createElement('br'));
                if (line) pushLine(line);
            });
        };
        while ((m = re.exec(text))) {
            let node = null;
            const url = composerEmojiUrl(m[1]);
            if (url) node = makeComposerEmoji(m[0], url);
            else {
                const item = flByCode(m[1]);
                if (item && !(m.index > 0 && /[A-Za-z0-9]/.test(text.charAt(m.index - 1)))) node = makeComposerEmoji(m[0], item.url);
            }
            if (!node) { re.lastIndex = m.index + 1; continue; }    // not an emoji: leave as text, keep scanning
            if (m.index > last) pushText(text.slice(last, m.index));
            nodes.push(node);
            last = re.lastIndex;
        }
        if (last < text.length) pushText(text.slice(last));
        return nodes;
    }

    function setComposerValue(text) {
        const root = $('chInput');
        text = String(text == null ? '' : text);
        root.textContent = '';
        composerNodes(text).forEach(function (n) { root.appendChild(n); });
        root.classList.toggle('is-empty', !text);
        composerRange = null;
        if (typeof closeMention === 'function') closeMention();
        if (typeof closeEmojiSuggest === 'function') closeEmojiSuggest();
    }

    // keeps  $('chInput').value / .placeholder / .disabled working like on a textarea
    function installComposer() {
        const root = $('chInput');
        Object.defineProperty(root, 'value', {
            configurable: true,
            get: function () { return serializeComposer(root); },
            set: function (v) { setComposerValue(v); }
        });
        Object.defineProperty(root, 'placeholder', {
            configurable: true,
            get: function () { return root.getAttribute('data-placeholder') || ''; },
            set: function (v) { root.setAttribute('data-placeholder', v); }
        });
        Object.defineProperty(root, 'disabled', {
            configurable: true,
            get: function () { return root.getAttribute('aria-disabled') === 'true'; },
            set: function (v) {
                root.setAttribute('contenteditable', v ? 'false' : 'true');
                root.setAttribute('aria-disabled', String(!!v));
            }
        });
    }

    function composerCaretRange() {
        const root = $('chInput');
        const sel = window.getSelection();
        if (sel && sel.rangeCount && root.contains(sel.anchorNode)) return sel.getRangeAt(0);
        if (composerRange && root.contains(composerRange.startContainer)) return composerRange;
        const r = document.createRange();
        r.selectNodeContents(root);
        r.collapse(false);
        return r;
    }

    // type / paste / pick something at the caret (works for emoji codes too)
    function insertIntoComposer(text) {
        const root = $('chInput');
        if (root.disabled) return;
        root.focus();
        const range = composerCaretRange();
        range.deleteContents();
        const frag = document.createDocumentFragment();
        composerNodes(String(text)).forEach(function (n) { frag.appendChild(n); });
        const lastNode = frag.lastChild;
        range.insertNode(frag);
        if (lastNode) { range.setStartAfter(lastNode); range.collapse(true); }
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        composerRange = range.cloneRange();
    }

    // ----- settings for the emoji helpers (Settings > Chats). On unless switched off. -----
    function chatOpt(key) {
        try { return !(window.SpecSettings && window.SpecSettings.get(key) === false); } catch (e) { return true; }
    }

    // ----- emoticons: ":)" becomes a real emoji when you press space or send. It only counts when it stands alone
    //       (so "http://" and "8) next step" are left alone). Add or remove lines freely, keys are lowercase. -----
    const EMOTICONS = {
        ':)': '\uD83D\uDE42', ':-)': '\uD83D\uDE42', ':(': '\uD83D\uDE41', ':-(': '\uD83D\uDE41',
        ':d': '\uD83D\uDE03', ':-d': '\uD83D\uDE03', ';)': '\uD83D\uDE09', ';-)': '\uD83D\uDE09',
        ':p': '\uD83D\uDE1B', ':-p': '\uD83D\uDE1B', ';p': '\uD83D\uDE1C', ':o': '\uD83D\uDE2E', ':-o': '\uD83D\uDE2E',
        ":'(": '\uD83D\uDE22', ":')": '\uD83E\uDD72', ':*': '\uD83D\uDE18', ':-*': '\uD83D\uDE18',
        '<3': '\u2764\uFE0F', '</3': '\uD83D\uDC94', 'xd': '\uD83D\uDE06',
        ':|': '\uD83D\uDE10', ':-|': '\uD83D\uDE10', ':/': '\uD83D\uDE15', ':-/': '\uD83D\uDE15',
        '>:(': '\uD83D\uDE20', '>:)': '\uD83D\uDE08', '^_^': '\uD83D\uDE0A', 't_t': '\uD83D\uDE2D', '-_-': '\uD83D\uDE11', 'o_o': '\uD83D\uDE33'
    };
    // dragged out ( :)))  :DDD  XDDD  :(((  <333 ) gives a bigger emoji. Needs 2 or more extra characters.
    const EMO_STRONG = {
        ':)': '\uD83D\uDE04', ':-)': '\uD83D\uDE04', ':(': '\uD83D\uDE22', ':-(': '\uD83D\uDE22',
        ':d': '\uD83D\uDE01', ':-d': '\uD83D\uDE01', 'xd': '\uD83E\uDD23', ':p': '\uD83D\uDE1D', ':-p': '\uD83D\uDE1D',
        ':o': '\uD83D\uDE32', ':-o': '\uD83D\uDE32', '<3': '\uD83D\uDC95'
    };
    const EMO_KEYS = Object.keys(EMOTICONS).sort(function (a, b) { return b.length - a.length; });
    const EMO_STRETCH = /[)(dpo3]$/;                     // keys ending like this can be dragged out
    const emoEsc = function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    const EMO_RE = new RegExp('(^|\\s)(' + EMO_KEYS.map(function (k) {
        return emoEsc(k) + (EMO_STRETCH.test(k) ? '(?:' + emoEsc(k.slice(-1)) + '){0,9}' : '');
    }).join('|') + ')(\\s*)$', 'i');

    // ":)))" -> the emoji for ":)" (bigger one when dragged out), or null
    function emoticonFor(tok) {
        const t = tok.toLowerCase();
        for (let i = 0; i < EMO_KEYS.length; i++) {
            const k = EMO_KEYS[i];
            if (t.indexOf(k) !== 0) continue;
            const rest = t.slice(k.length);
            if (rest && !(EMO_STRETCH.test(k) && rest === new Array(rest.length + 1).join(k.slice(-1)))) continue;
            return (rest.length >= 2 && EMO_STRONG[k]) || EMOTICONS[k];
        }
        return null;
    }

    // "hi :) " -> "hi (emoji) "   (needSpace: only when a space was just typed after it)
    function emoticonize(str, needSpace) {
        const m = EMO_RE.exec(str);
        if (!m || (needSpace && !m[3])) return null;
        const emoji = emoticonFor(m[2]);
        if (!emoji) return null;
        return str.slice(0, m.index + m[1].length) + emoji + m[3];
    }

    function convertTypedEmoticon() {
        const root = $('chInput');
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== 3 || !root.contains(node)) return;
        if (root.textContent.indexOf('```') !== -1) return;                 // leave code blocks alone
        const at = sel.anchorOffset;
        const out = emoticonize(node.nodeValue.slice(0, at), true);
        if (!out) return;
        node.nodeValue = out + node.nodeValue.slice(at);
        const r = document.createRange();
        r.setStart(node, out.length);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
    }

    // an emoticon at the very end of the message (no space after it) is converted when you send
    function emoticonAtEnd() {
        try {
            const root = $('chInput');
            if (root.textContent.indexOf('```') !== -1) return;
            let n = root;
            while (n.lastChild) n = n.lastChild;
            if (n.nodeType !== 3) return;
            const out = emoticonize(n.nodeValue, false);
            if (out) n.nodeValue = out;
        } catch (e) { /* ignore */ }
    }

    // typing  :name:  turns it into the emoji right away
    // secret: typing  :name\x5>:  puts that emoji 5 times in a row (any shortcode, from 1 to 15)
    function convertTypedEmoji() {
        const root = $('chInput');
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== 3 || !root.contains(node)) return;
        const upto = node.nodeValue.slice(0, sel.anchorOffset);

        let times = 1;
        let m = /:([a-z0-9_+-]{1,32})\\x(\d{1,2})>:$/i.exec(upto);
        if (m) times = Math.max(1, Math.min(15, parseInt(m[2], 10) || 1));
        else m = /:([a-z0-9_+-]{1,32}):$/i.exec(upto);
        if (!m) return;

        const code = ':' + m[1] + ':';
        let src = composerEmojiUrl(m[1]);
        if (!src) {
            const item = flByCode(m[1]);                                   // :sob: typed by hand -> Windows 11 picture
            const before = m.index > 0 ? upto.charAt(m.index - 1) : '';
            if (item && !/[A-Za-z0-9]/.test(before)) src = item.url;
        }
        if (!src) return;

        const imgs = [];
        for (let i = 0; i < times; i++) imgs.push(makeComposerEmoji(code, src));

        const after = node.nodeValue.slice(sel.anchorOffset);
        const parent = node.parentNode;
        const ref = node.nextSibling;
        node.nodeValue = node.nodeValue.slice(0, m.index);
        imgs.forEach(function (img) { parent.insertBefore(img, ref); });
        let tail = null;
        if (after) { tail = document.createTextNode(after); parent.insertBefore(tail, ref); }
        const r = document.createRange();
        if (tail) r.setStart(tail, 0); else r.setStartAfter(imgs[imgs.length - 1]);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
    }

    function autosize() {
        const t = $('chInput');
        const v = t.value;
        t.classList.toggle('is-empty', !v);                    // shows the placeholder (the box grows by itself)
        t.parentNode.classList.toggle('is-typing', !!v);       // on phones the attach and code buttons tuck away while you type
        $('chSend').disabled = !v.trim() && !S.pendingFile;
    }

    function paintPendingFile() {
        const file = S.pendingFile;
        $('chFilePreview').hidden = !file;
        $('chFileName').textContent = file ? file.name + ' · ' + formatBytes(file.size) : '';
        // a video gets a little picture next to its name
        const oldThumb = $('chFileThumb');
        if (oldThumb) oldThumb.remove();
        if (S.pendingThumb) { try { URL.revokeObjectURL(S.pendingThumb); } catch (e) { /* ignore */ } S.pendingThumb = null; }
        if (file && (isVideoFile(file) || /^image\//i.test(fileMime(file)))) {
            try {
                S.pendingThumb = URL.createObjectURL(file);
                let thumb;
                if (isVideoFile(file)) {
                    thumb = el('video', { id: 'chFileThumb', class: 'ch-file-thumb', playsinline: true, preload: 'metadata', 'aria-hidden': 'true' });
                    thumb.muted = true;
                    thumb.src = S.pendingThumb + '#t=0.1';
                } else {
                    thumb = el('img', { id: 'chFileThumb', class: 'ch-file-thumb', alt: '', draggable: 'false', 'aria-hidden': 'true' });
                    thumb.src = S.pendingThumb;
                }
                $('chFilePreview').insertBefore(thumb, $('chFileName'));
            } catch (e) { /* the name alone is fine */ }
        }
        autosize();
    }

    function chooseFile(file) {
        if (!file) return;
        const video = isVideoFile(file);
        if (file.size > (video ? MAX_VIDEO_BYTES : MAX_FILE_BYTES)) { toast(video ? 'Videos must be 50 MB or smaller.' : 'Files must be 30 MB or smaller.'); $('chFileInput').value = ''; return; }
        S.pendingFile = file;
        $('chFileInput').value = '';
        paintPendingFile();
    }

    function cancelCompose(keepText) {
        S.replyTo = null; S.editing = null;
        $('chReplyBar').hidden = true;
        if (!keepText) { $('chInput').value = ''; autosize(); }
    }

    function showBar(title, text) {
        $('chReplyTitle').textContent = title;
        $('chReplyText').textContent = text;
        $('chReplyBar').hidden = false;
    }

    function startReply(m) {
        S.editing = null;
        S.replyTo = m;
        showBar('Replying to ' + nameOf(senderOf(m)), safePreview(m.body, m.sender_id));
        $('chInput').focus();
    }

    function startEdit(m) {
        S.replyTo = null;
        S.editing = m;
        showBar('Editing message', previewText(m.body));
        $('chInput').value = m.body;
        autosize();
        $('chInput').focus();
    }

    // ----- upload with a live progress bar (falls back to the normal upload if anything is missing) -----
    function setUploadProgress(pct, done) {
        const box = $('chFilePreview');
        if (!box || box.hidden) return;
        let bar = $('chUploadBar');
        if (!bar) {
            bar = el('div', { id: 'chUploadBar', class: 'ch-upload-bar', 'aria-hidden': 'true' }, el('i', {}));
            box.insertBefore(bar, box.querySelector('.ch-iconbtn') || null);
        }
        const p = Math.max(0, Math.min(100, Math.round(pct)));
        bar.firstChild.style.width = p + '%';
        const f = S.pendingFile;
        if (f) $('chFileName').textContent = (done ? 'Sending… ' : 'Uploading ' + p + '% · ') + f.name + ' · ' + formatBytes(f.size);
    }

    function clearUploadProgress() {
        const bar = $('chUploadBar');
        if (bar) bar.remove();
        if (S.pendingFile) paintPendingFile();
    }

    async function uploadWithProgress(path, file, onProgress) {
        const plain = function () {
            return sb.storage.from('chat-attachments').upload(path, file, { cacheControl: '3600', upsert: false, contentType: fileMime(file) });
        };
        let token, base, key;
        try {
            const sess = await sb.auth.getSession();
            token = sess && sess.data && sess.data.session && sess.data.session.access_token;
            base = (sb.storage && sb.storage.url) || (CFG && CFG.SUPABASE_URL ? CFG.SUPABASE_URL + '/storage/v1' : '');
            key = sb.supabaseKey || (CFG && CFG.SUPABASE_ANON_KEY);
        } catch (e) { /* fall back below */ }
        if (!token || !base || !key || typeof XMLHttpRequest === 'undefined') return plain();
        return new Promise(function (resolve) {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', base + '/object/chat-attachments/' + path.split('/').map(encodeURIComponent).join('/'));
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.setRequestHeader('apikey', key);
            xhr.setRequestHeader('x-upsert', 'false');
            xhr.setRequestHeader('cache-control', 'max-age=3600');
            xhr.setRequestHeader('Content-Type', fileMime(file));
            xhr.upload.onprogress = function (ev) { if (ev.lengthComputable) onProgress((ev.loaded / ev.total) * 100); };
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) { resolve({ error: null }); return; }
                let m = 'Upload failed (' + xhr.status + ')';
                try { const j = JSON.parse(xhr.responseText); m = j.message || j.error || m; } catch (e) { /* keep default */ }
                resolve({ error: new Error(m) });
            };
            xhr.onerror = function () { resolve({ error: new Error('Failed to fetch') }); };
            xhr.send(file);
        });
    }

    async function sendMessage() {
        if (!S.current || !sb || S.sending) return;
        if (chatOpt('chatEmoticons')) emoticonAtEnd();
        const raw = $('chInput').value;
        const file = S.pendingFile;
        let body = applySlash(raw).trim();
        if (!body && file) body = ('Attachment: ' + file.name).slice(0, 2000);
        if (!body) return;

        if (/^\/help\b/i.test(raw.trim())) { toast('Commands: /shrug, /me, /bug. Formatting: **bold** *italic* ~~strike~~ ||spoiler|| `code` ```js code```'); $('chInput').value = ''; autosize(); return; }
        if (/^\/bug\b/i.test(raw.trim())) { const rest = raw.trim().slice(4).trim(); $('chInput').value = ''; autosize(); openBug(rest); return; }

        const room = S.current;
        if (room.kind === 'dm' && (room.blocked_by_me || room.blocked_me)) { toast(ERR.blocked); return false; }

        // super emotes: one per message, and the 10 second cooldown (the server checks both too)
        const superUsed = S.editing ? [] : superCodesIn(body);
        if (superUsed.length > 1) { toast(ERR.super_one_per_message); return false; }
        if (superUsed.length && superLeft() > 0) { toast('Super emotes are recharging: ' + Math.ceil(superLeft() / 1000) + 's left.'); return false; }

        // ----- editing -----
        if (S.editing) {
            const target = S.editing;
            if (body === target.body) { cancelCompose(); return true; }
            try {
                const res = await sb.rpc('chat_edit', { p_id: target.id, p_body: body });
                if (res.error) throw res.error;
                Object.assign(target, { body: res.data.body, edited_at: res.data.edited_at });
                cancelCompose();
                rebuildNode(target);
                return true;
            } catch (err) { toast(friendly(err)); return false; }
        }

        // ----- new message with optional private room attachment -----
        const reply = S.replyTo;
        S.sending = true;
        let uploadedPath = null;
        let temp = null;
        let createdMessageId = null;
        try {
            if (file) {
                const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100) || 'file';
                const uniqueId = window.crypto && typeof window.crypto.randomUUID === 'function'
                    ? window.crypto.randomUUID()
                    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
                uploadedPath = room.room_id + '/' + S.me.id + '/' + uniqueId + '-' + safeName;
                setUploadProgress(0);
                const uploaded = await uploadWithProgress(uploadedPath, file, setUploadProgress);
                if (uploaded.error) throw uploaded.error;
                setUploadProgress(100, true);
            }

            temp = { id: 'tmp-' + (++S.tmp), room_id: room.room_id, sender_id: S.me.id, body: body, reply_to: reply ? reply.id : null,
                created_at: new Date().toISOString(), sender: S.profile, reactions: [], pending: true,
                attachment_path: uploadedPath, attachment_name: file && file.name, attachment_type: file && fileMime(file), attachment_size: file && file.size };
        addToState(temp);
        appendMessage(temp);
        cancelCompose();
        scrollToBottom();

            const res = await (window.SPCH ? SPCH.send(room, body, reply ? reply.id : null) : sb.rpc('chat_send', { p_room: room.room_id, p_body: body, p_reply: reply ? reply.id : null }));
            if (res.error) throw res.error;
            let real = Object.assign({}, res.data, { sender: S.profile, reactions: [] });
            createdMessageId = real.id;
            if (file) {
                const attached = await sb.rpc('chat_attach', {
                    p_msg: real.id, p_path: uploadedPath, p_name: file.name,
                    p_type: fileMime(file), p_size: file.size
                });
                if (attached.error) throw attached.error;
                const a = attached.data || {};
                Object.assign(real, { attachment_path: a.attachment_path, attachment_name: a.attachment_name, attachment_type: a.attachment_type, attachment_size: a.attachment_size });
            }
            S.messages = S.messages.filter(function (x) { return x !== temp; });
            S.byId.delete(temp.id);
            if (S.byId.has(real.id)) { const old = $('chFeed').querySelector('[data-id="' + temp.id + '"]'); if (old) old.remove(); }
            else {
                S.messages.push(real); S.byId.set(real.id, real);
                const node = $('chFeed').querySelector('[data-id="' + temp.id + '"]');
                if (node && node.replaceWith) node.replaceWith(buildMsg(real, node.classList.contains('is-grouped'))); else renderFeed({ keepScroll: true });
            }
            if (file) { S.pendingFile = null; paintPendingFile(); }
            const live = S.roomMap.get(room.room_id) || room;
            live.last_body = real.body; live.last_at = real.created_at; live.last_sender = S.me.id;
            bumpRoom(live);
            if (superUsed.length) superSent(real.id, superUsed[0]);        // effects + sound + start the cooldown
            return true;
        } catch (err) {
            if (temp) {
                S.messages = S.messages.filter(function (x) { return x !== temp; });
                S.byId.delete(temp.id);
                const node = $('chFeed').querySelector('[data-id="' + temp.id + '"]');
                if (node) node.remove();
            }
            if (uploadedPath) {
                if (createdMessageId) {
                    try { await sb.rpc('chat_delete', { p_id: createdMessageId }); } catch (e) { /* best effort rollback */ }
                }
                try { await sb.storage.from('chat-attachments').remove([uploadedPath]); } catch (e) { /* best effort cleanup */ }
            }
            if (!$('chInput').value) { $('chInput').value = raw; autosize(); }
            if (/\bblocked\b/.test(String(err && err.message || ''))) {
                const rr = S.roomMap.get(room.room_id);
                if (rr) { rr.blocked_me = true; if (sameRoom(rr)) paintComposerLock(); }
            }
            const cd = /super_cooldown:(\d+)/.exec(String(err && err.message || ''));
            if (cd) { SUPER_UNTIL = Date.now() + Number(cd[1]) * 1000; startSuperTicker(); }
            let outMsg = friendly(err);
            if (outMsg === 'Something went wrong. Please try again.' && err && err.message) outMsg = 'Send failed: ' + err.message;
            toast(outMsg);
            return false;
        } finally {
            S.sending = false;
            clearUploadProgress();
        }
    }

    function bumpRoom(room) {
        S.rooms.sort(function (a, b) { return new Date(b.last_at || 0) - new Date(a.last_at || 0); });
        pinFirst();
        renderList();
    }

    async function deleteMessage(m) {
        if (!window.confirm('Delete this message?')) return;
        try {
            const legacy = !!(S.current && (S.current.role === 'owner' || S.current.role === 'admin'));
            const asMod = !!S.me && m.sender_id !== S.me.id && !legacy && modCan('manage_messages');
            const res = asMod ? await sb.rpc('chat_mod_delete_message', { p_message: m.id }) : await sb.rpc('chat_delete', { p_id: m.id });
            if (res.error) throw res.error;
            m.deleted_at = new Date().toISOString(); m.body = ''; m.reactions = [];
            rebuildNode(m);
        } catch (err) { toast(friendly(err)); }
    }

    async function toggleReaction(m, emoji) {
        if (!S.me || m.pending) return;
        const customName = /^:([a-z0-9_+-]{1,32}):$/i.exec(emoji);
        if (customName && !CUSTOM_EMOJI[customName[1].toLowerCase()]) { toast('That custom emoji is not configured in this chat.'); return; }
        if (customName && STORE_EMOTE[customName[1].toLowerCase()] && !MY_EMOTES.has(customName[1].toLowerCase())) { toast('Buy this emote in the Store to react with it.'); return; }
        const list = m.reactions || (m.reactions = []);
        const idx = list.findIndex(function (r) { return r.emoji === emoji && r.user_id === S.me.id; });
        const had = idx >= 0;
        if (had) list.splice(idx, 1); else list.push({ emoji: emoji, user_id: S.me.id });
        rebuildNode(m);
        try {
            const res = await sb.rpc('chat_toggle_reaction', { p_msg: m.id, p_emoji: emoji });
            if (res.error) throw res.error;
        } catch (err) {
            if (had) list.push({ emoji: emoji, user_id: S.me.id });
            else { const i2 = list.findIndex(function (r) { return r.emoji === emoji && r.user_id === S.me.id; }); if (i2 >= 0) list.splice(i2, 1); }
            rebuildNode(m);
            toast(friendly(err));
        }
    }

    async function refreshAllReactions() {
        if (!S.current) return;
        const ids = S.messages.filter(function (m) { return !m.pending && !m.deleted_at; }).slice(-200).map(function (m) { return m.id; });
        if (!ids.length) return;
        const res = await sb.from('chat_reactions').select('message_id,emoji,user_id').in('message_id', ids);
        if (res.error) return;
        const by = new Map();
        (res.data || []).forEach(function (r) {
            if (!by.has(r.message_id)) by.set(r.message_id, []);
            by.get(r.message_id).push({ emoji: r.emoji, user_id: r.user_id });
        });
        const sig = function (list) { return (list || []).map(function (r) { return r.emoji + ':' + r.user_id; }).sort().join('|'); };
        ids.forEach(function (id) {
            const m = S.byId.get(id);
            if (!m) return;
            const next = by.get(id) || [];
            if (sig(next) !== sig(m.reactions)) { m.reactions = next; rebuildNode(m); }
        });
    }

    async function refreshReactions(messageId) {
        const m = S.byId.get(messageId);
        if (!m) return;
        const res = await sb.from('chat_reactions').select('emoji,user_id').eq('message_id', messageId);
        if (res.error) return;
        m.reactions = res.data || [];
        rebuildNode(m);
    }

    /* ----------------------------------------------------------------------
       MENTIONS: type @ and pick a member of this group / community
       ---------------------------------------------------------------------- */
    const MEN = { open: false, items: [], index: 0, token: 0, node: null };

    async function ensureMentionPool() {
        if (!S.current || S.current.kind === 'dm') return [];
        const fresh = S.membersRoom === S.current.room_id && S.members.length && Date.now() - (S.membersAt || 0) < 60000;
        if (!fresh) { try { await loadMembers(); } catch (e) { /* use what we have */ } }
        return S.membersRoom === (S.current && S.current.room_id) ? S.members : [];
    }

    // is the caret right after "@something"?
    function mentionContext() {
        const root = $('chInput');
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== 3 || !root.contains(node)) return null;
        const upto = node.nodeValue.slice(0, sel.anchorOffset);
        const m = /(^|[\s(])@([A-Za-z0-9_]{0,20})$/.exec(upto);
        if (!m) return null;
        return { node: node, start: m.index + m[1].length, end: sel.anchorOffset, query: m[2] };
    }

    function closeMention() {
        MEN.open = false;
        MEN.token++;
        const pop = $('chMentionPop');
        if (pop) pop.hidden = true;
        $('chInput').removeAttribute('aria-activedescendant');
    }

    function paintMention() {
        let pop = $('chMentionPop');
        if (!pop) {
            pop = el('div', { class: 'ch-mention-pop', id: 'chMentionPop', role: 'listbox', 'aria-label': 'Members to mention', hidden: true });
            pop.addEventListener('mousedown', function (e) { e.preventDefault(); });      // keep the caret in the message box
            document.querySelector('.ch-composer').appendChild(pop);
        }
        pop.textContent = '';
        pop.appendChild(el('div', { class: 'ch-mention-head', text: 'MEMBERS' }));
        MEN.items.forEach(function (it, i) {
            const p = it.profile;
            pop.appendChild(el('button', {
                type: 'button', id: 'chMen' + i, role: 'option', 'aria-selected': String(i === MEN.index),
                class: 'ch-mention-item' + (i === MEN.index ? ' is-active' : ''),
                onclick: function () { pickMention(it); }
            },
                avatar(p, 28),
                el('span', { class: 'ch-mention-name' }, el('strong', { text: p.display_name || p.username }), el('small', { text: '@' + p.username })),
                it.role === 'owner' || it.role === 'admin' ? el('span', { class: 'ch-mention-role', text: it.role.toUpperCase() }) : null,
                S.onlineAll.has(it.user_id) ? el('i', { class: 'ch-mention-dot', title: 'Online' }) : null));
        });
        pop.hidden = false;
        MEN.open = true;
        $('chInput').setAttribute('aria-activedescendant', 'chMen' + MEN.index);
        const active = $('chMen' + MEN.index);
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    async function updateMention() {
        if (!S.current || S.current.kind === 'dm' || !mentionContext()) { closeMention(); return; }
        const token = ++MEN.token;
        const pool = await ensureMentionPool();
        if (token !== MEN.token) return;                    // typed on while the list was loading
        const ctx = mentionContext();
        if (!ctx) { closeMention(); return; }
        const q = ctx.query.toLowerCase();
        const items = pool.filter(function (mm) {
            const p = mm.profile;
            return p && p.username && mm.user_id !== S.me.id &&
                (!q || p.username.toLowerCase().indexOf(q) >= 0 || String(p.display_name || '').toLowerCase().indexOf(q) >= 0);
        }).map(function (mm) {
            const p = mm.profile;
            const starts = p.username.toLowerCase().indexOf(q) === 0 || String(p.display_name || '').toLowerCase().indexOf(q) === 0;
            return { user_id: mm.user_id, role: mm.role, profile: p, rank: (starts ? 0 : 4) + (S.onlineAll.has(mm.user_id) ? 0 : 2) };
        }).sort(function (a, b) {
            return a.rank - b.rank || a.profile.username.localeCompare(b.profile.username);
        }).slice(0, 6);
        if (!items.length) { closeMention(); return; }
        MEN.items = items;
        MEN.index = 0;
        paintMention();
    }

    function pickMention(it) {
        const ctx = mentionContext();
        if (!ctx) { closeMention(); return; }
        const text = '@' + it.profile.username + ' ';
        const v = ctx.node.nodeValue;
        ctx.node.nodeValue = v.slice(0, ctx.start) + text + v.slice(ctx.end);
        const r = document.createRange();
        r.setStart(ctx.node, ctx.start + text.length);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        composerRange = r.cloneRange();
        closeMention();
        autosize();
        $('chInput').focus();
    }

    // arrow keys / Enter / Tab / Escape while the list is open. returns true when it used the key
    function handleMentionKey(e) {
        if (!MEN.open) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            MEN.index = (MEN.index + (e.key === 'ArrowDown' ? 1 : -1) + MEN.items.length) % MEN.items.length;
            paintMention();
            return true;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
            if (e.isComposing) return false;
            e.preventDefault();
            pickMention(MEN.items[MEN.index]);
            return true;
        }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMention(); return true; }
        return false;
    }

    /* ----------------------------------------------------------------------
       CHAT SETTINGS: General, Pinned messages, Media & files
       (needs supabase-chat-settings.sql)
       ---------------------------------------------------------------------- */
    const SET = { tab: 'general', kind: 'images', media: [], more: false, loading: false };

    function canManage(r) { return !!r && r.kind !== 'dm' && (r.role === 'owner' || r.role === 'admin'); }
    // community permission (custom roles). False when the community SQL / roles are not set up.
    function modCan(key) { return !!(S.current && window.SPCH && window.SPCH.can && window.SPCH.can(key, S.current)); }
    function canPinHere(r) { return !!r && (r.kind === 'dm' || canManage(r)); }

    function settingsErr(err) {
        const msg = String(err && err.message || '');
        if (isSetupMissing(err) && /chat_(update_room|regen_invite|set_pin|pinned|pins|room_media|audit)/.test(msg)) {
            return 'Run supabase-chat-settings.sql in your Supabase SQL Editor first.';
        }
        return friendly(err);
    }

    function memberName(id) {
        const r = S.current;
        if (S.me && id === S.me.id) return 'You';
        if (r && r.kind === 'dm' && id === r.other_id) return r.other_display || r.other_username || 'Them';
        const mm = (S.membersRoom === (r && r.room_id) ? S.members : []).find(function (x) { return x.user_id === id; });
        return mm && mm.profile ? (mm.profile.display_name || mm.profile.username) : 'Member';
    }

    function openSettings(tab) {
        const r = S.current;
        if (!r) return;
        if (r.kind === 'community' && !tab && window.SPCS && window.SPCS.open(r)) return;      // new community settings screen
        const dm = r.kind === 'dm';
        $('setTitle').textContent = dm ? 'Chat info' : (r.kind === 'community' ? 'Community settings' : 'Group settings');
        $('setTabGeneral').hidden = dm;
        showBox('setMsg', '');
        paintSettingsGeneral();
        selectSettingsTab(tab && !(dm && tab === 'general') ? tab : (dm ? 'pinned' : 'general'));
        openDlg('settingsDlg');
    }

    function selectSettingsTab(tab) {
        SET.tab = tab;
        ['general', 'pinned', 'media'].forEach(function (t) {
            const on = t === tab;
            const btn = $('setTab' + t.charAt(0).toUpperCase() + t.slice(1));
            btn.setAttribute('aria-selected', String(on));
            btn.classList.toggle('is-active', on);
            $('setPanel' + t.charAt(0).toUpperCase() + t.slice(1)).hidden = !on;
        });
        if (tab === 'pinned') loadPinnedPanel();
        if (tab === 'media') { SET.media = []; SET.more = false; loadMedia(true); }
    }

    // ----- General -----
    function paintSettingsGeneral() {
        const r = S.current;
        if (!r || r.kind === 'dm') return;
        const manage = canManage(r), owner = r.role === 'owner';
        $('setIcon').value = r.icon || '';
        $('setName').value = r.name || '';
        $('setDesc').value = r.description || '';
        $('setDescN').textContent = String(($('setDesc').value || '').length);
        $('setPublic').checked = !!r.is_public;
        ['setIcon', 'setName', 'setDesc'].forEach(function (id) { $(id).disabled = !manage; });
        $('setPublic').disabled = !owner;
        $('setPublicLabel').textContent = r.kind === 'community' ? 'Public: anyone can find and join this community' : 'Public: anyone can find and join this group';
        $('setSave').hidden = !manage;
        $('setNote').textContent = !manage ? 'Only the owner and admins can edit this chat.' : (!owner ? 'Only the owner can change who can find this chat.' : '');
        $('setInviteGroup').hidden = !(manage || r.kind === 'group') || !r.invite_code;
        $('setCode').textContent = r.invite_code || '';
        $('setRegen').hidden = !manage;
        $('setMute').checked = !!r.muted;
        $('setDelete').hidden = r.role !== 'owner';
    }

    async function saveSettings(e) {
        e.preventDefault();
        const r = S.current;
        if (!r || !canManage(r)) return;
        const name = $('setName').value.trim();
        if (name.length < 2) { showBox('setMsg', ERR.bad_name); return; }
        const desc = $('setDesc').value.trim().slice(0, 200);
        const icn = Array.from($('setIcon').value.trim()).slice(0, 2).join('') || r.icon || '💬';
        const btn = $('setSave');
        showBox('setMsg', '');
        setLoading(btn, true);
        try {
            const res = await sb.rpc('chat_update_room', {
                p_room: r.room_id, p_name: name, p_desc: desc || null, p_icon: icn,
                p_public: r.role === 'owner' ? $('setPublic').checked : null
            });
            if (res.error) throw res.error;
            r.name = name.slice(0, 40);
            r.description = desc || null;
            r.icon = icn;
            if (r.role === 'owner') r.is_public = $('setPublic').checked;
            paintHeader();
            renderList();
            paintSettingsGeneral();
            toast('Settings saved');
        } catch (err) { showBox('setMsg', settingsErr(err)); }
        finally { setLoading(btn, false); }
    }

    async function regenInvite() {
        const r = S.current;
        if (!r || !canManage(r)) return;
        if (!window.confirm('Make a new invite code?\n\nThe old code will stop working.')) return;
        try {
            const res = await sb.rpc('chat_regen_invite', { p_room: r.room_id });
            if (res.error) throw res.error;
            r.invite_code = String(res.data || '');
            paintSettingsGeneral();
            toast('New invite code ready');
        } catch (err) { toast(settingsErr(err)); }
    }

    // ----- Pinned messages -----
    async function loadPinIds(room) {
        try {
            const res = await sb.from('chat_pins').select('message_id').eq('room_id', room.room_id);
            if (res.error || !sameRoom(room)) return;
            S.pinIds = new Set((res.data || []).map(function (x) { return x.message_id; }));
            S.messages.forEach(function (m) { if (S.pinIds.has(m.id)) rebuildNode(m); });
        } catch (e) { /* pins are optional until the SQL is run */ }
    }

    async function togglePinMessage(m) {
        const r = S.current;
        if (!r || !canPinHere(r)) return;
        const next = !S.pinIds.has(m.id);
        try {
            const res = await sb.rpc('chat_set_pin', { p_room: r.room_id, p_message: m.id, p_pin: next });
            if (res.error) throw res.error;
            if (next) S.pinIds.add(m.id); else S.pinIds.delete(m.id);
            const live = S.byId.get(m.id);
            if (live) rebuildNode(live);
            toast(next ? 'Message pinned' : 'Message unpinned');
        } catch (err) { toast(settingsErr(err)); }
    }

    async function loadPinnedPanel() {
        const r = S.current, box = $('setPinned');
        box.textContent = '';
        box.appendChild(el('p', { class: 'ch-set-empty', text: 'Loading pinned messages…' }));
        try {
            if (r.kind !== 'dm') await ensureMentionPool();       // so we can show names
            const res = await sb.rpc('chat_pinned', { p_room: r.room_id });
            if (res.error) throw res.error;
            if (!sameRoom(r)) return;
            const rows = res.data || [];
            S.pinIds = new Set(rows.map(function (x) { return x.message_id; }));
            box.textContent = '';
            if (!rows.length) {
                box.appendChild(el('p', { class: 'ch-set-empty', text: canPinHere(r) ? 'Nothing pinned yet. Use the pin button on a message to keep it here.' : 'Nothing pinned yet.' }));
                return;
            }
            rows.forEach(function (x) {
                const text = x.body ? safePreview(x.body, x.sender_id) : (x.attachment_name ? 'Attachment: ' + x.attachment_name : 'Message');
                box.appendChild(el('article', { class: 'ch-pin' },
                    el('div', { class: 'ch-pin-meta' }, el('strong', { text: memberName(x.sender_id) }), el('span', { text: fmtDay(x.created_at) + ' · ' + fmtTime(x.created_at) })),
                    el('p', { class: 'ch-pin-text', text: text }),
                    el('div', { class: 'ch-pin-actions' },
                        el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', onclick: function () { closeDlg('settingsDlg'); jumpToMessage(x.message_id); } }, 'Jump to message'),
                        canPinHere(r) ? el('button', { type: 'button', class: 'ch-btn ch-btn--ghost', onclick: async function () { await togglePinMessage({ id: x.message_id }); loadPinnedPanel(); } }, 'Unpin') : null)));
            });
        } catch (err) {
            box.textContent = '';
            box.appendChild(el('p', { class: 'ch-set-empty', text: settingsErr(err) }));
        }
    }

    // ----- Media & files -----
    async function loadMedia(reset) {
        const r = S.current;
        if (!r || SET.loading) return;
        SET.loading = true;
        const box = $('setMedia');
        if (reset) { box.textContent = ''; box.appendChild(el('p', { class: 'ch-set-empty', text: 'Loading…' })); }
        try {
            const last = SET.media.length ? SET.media[SET.media.length - 1].created_at : null;
            const res = await sb.rpc('chat_room_media', { p_room: r.room_id, p_before: reset ? null : last, p_limit: 60 });
            if (res.error) throw res.error;
            if (!sameRoom(r)) return;
            const rows = res.data || [];
            SET.more = rows.length >= 60;
            SET.media = reset ? rows : SET.media.concat(rows);
            paintMedia();
        } catch (err) {
            box.textContent = '';
            box.appendChild(el('p', { class: 'ch-set-empty', text: settingsErr(err) }));
        } finally { SET.loading = false; }
    }

    function paintMedia() {
        const box = $('setMedia');
        const isImg = function (x) { return String(x.attachment_type || '').indexOf('image/') === 0; };
        const items = SET.media.filter(function (x) { return SET.kind === 'images' ? isImg(x) : !isImg(x); });
        box.textContent = '';
        $('setKindImages').classList.toggle('is-active', SET.kind === 'images');
        $('setKindFiles').classList.toggle('is-active', SET.kind === 'files');
        $('setMore').hidden = !SET.more;
        if (!items.length) {
            box.appendChild(el('p', { class: 'ch-set-empty', text: SET.more ? 'None in the newest items. Load more to look further back.' : (SET.kind === 'images' ? 'No images shared yet.' : 'No files shared yet.') }));
            return;
        }
        const wrap = el('div', { class: SET.kind === 'images' ? 'ch-media-grid' : 'ch-media-files' });
        items.forEach(function (x) {
            if (SET.kind === 'images') {
                const tile = el('div', { class: 'ch-media-tile' });
                const a = el('a', { target: '_blank', rel: 'noopener noreferrer', title: (x.attachment_name || 'Image') + ' · ' + memberName(x.sender_id) });
                tile.appendChild(a);
                wrap.appendChild(tile);
                signedFileUrl(x.attachment_path).then(function (url) {
                    a.href = url;
                    a.appendChild(el('img', { src: url, alt: x.attachment_name || 'Shared image', loading: 'lazy' }));
                    guardImage(tile, x.attachment_path, url, !!(S.me && x.sender_id === S.me.id), true);
                }).catch(function () { a.textContent = '?'; });
            } else {
                const row = el('a', { class: 'ch-media-file', target: '_blank', rel: 'noopener noreferrer', download: x.attachment_name || 'file' },
                    el('span', { class: 'ch-attachment-file-icon', text: /^video\//i.test(x.attachment_type || '') ? '▶' : (/^audio\//i.test(x.attachment_type || '') ? '♪' : '↧') }),
                    el('span', { class: 'ch-media-file-name' }, el('strong', { text: x.attachment_name || 'File' }), el('small', { text: memberName(x.sender_id) + ' · ' + fmtDay(x.created_at) + ' · ' + formatBytes(Number(x.attachment_size) || 0) })));
                wrap.appendChild(row);
                signedFileUrl(x.attachment_path).then(function (url) { row.href = url; }).catch(function () { /* stays inert */ });
            }
        });
        box.appendChild(wrap);
    }

    function wireSettings() {
        $('chSettingsBtn').addEventListener('click', function () { openSettings(); });
        $('setForm').addEventListener('submit', saveSettings);
        $('setDesc').addEventListener('input', function () { $('setDescN').textContent = String($('setDesc').value.length); });
        document.querySelectorAll('#settingsDlg .ch-set-tab').forEach(function (b) {
            b.addEventListener('click', function () { selectSettingsTab(b.dataset.tab); });
        });
        $('setCopy').addEventListener('click', function () { if (S.current && S.current.invite_code) copyText(S.current.invite_code, 'Invite code copied'); });
        $('setRegen').addEventListener('click', regenInvite);
        $('setMute').addEventListener('change', function () { if (S.current) toggleMute(S.current); });
        $('setLeave').addEventListener('click', async function () {
            const r = S.current;
            if (!r) return;
            await leaveChat(r);
            if (!S.roomMap.has(r.room_id)) closeDlg('settingsDlg');
        });
        $('setDelete').addEventListener('click', async function () {
            const r = S.current;
            if (!r) return;
            await deleteChat(r);
            if (!S.roomMap.has(r.room_id)) closeDlg('settingsDlg');
        });
        $('setKindImages').addEventListener('click', function () { SET.kind = 'images'; paintMedia(); });
        $('setKindFiles').addEventListener('click', function () { SET.kind = 'files'; paintMedia(); });
        $('setMore').addEventListener('click', function () { loadMedia(false); });
    }

    /* ----------------------------------------------------------------------
       IMAGE FILTER (NSFWJS)
       Every viewer's own browser checks a shared image BEFORE it is shown and
       keeps it blurred if it looks explicit. Nothing is uploaded for the check,
       and the uploader cannot switch it off. It cannot detect graphic violence.
       ---------------------------------------------------------------------- */
    const NSFW_CFG = {
        // false = download NSFWJS from a public CDN (works with no setup).
        // true  = use your own copy at nsfw/nsfwjs.min.js next to chats.html. The NSFWJS authors
        //         recommend hosting it yourself, so switch this on once the file is there.
        selfHosted: false,
        local: 'nsfw/nsfwjs.min.js',
        cdn: ['https://cdn.jsdelivr.net/npm/nsfwjs@4.4.0/dist/browser/nsfwjs.min.js', 'https://unpkg.com/nsfwjs@4.4.0'],
        // The browser version of NSFWJS does NOT contain the AI model, so the model files have to live on your site:
        // nsfw/mobilenet_v2_mid/model.json  (+ the shard files that sit next to it in the same folder)
        // (If you copied the plain 'mobilenet_v2' folder instead, use model: 'nsfw/mobilenet_v2/' and modelType: ''.)
        model: 'nsfw/mobilenet_v2_mid/',
        modelType: 'graph', // the _mid model is a "graph" model, the plain mobilenet_v2 is not
        explicit: 0.55,     // Porn + Hentai at or above this = explicit
        suggestive: 0.75    // Sexy at or above this = also counted as sensitive
    };

    const NSFW = { state: 'idle', model: null, promise: null, scanned: 0, unreadable: 0, error: '', readError: '', logged: {} };
    const nsfwCache = new Map();          // attachment path -> { x: porn+hentai, s: sexy }
    let nsfwQueue = Promise.resolve();
    let nsfwSaveTimer = null;

    function loadScript(url) {
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            if (/^https?:/i.test(url)) { s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
            s.onload = function () { resolve(); };
            s.onerror = function () { s.remove(); reject(new Error('could not load ' + url)); };
            document.head.appendChild(s);
        });
    }

    async function loadFirst(urls, ready) {
        let last = null;
        for (let i = 0; i < urls.length; i++) {
            try { await loadScript(urls[i]); if (ready()) return; } catch (e) { last = e; }
        }
        throw last || new Error('script did not start');
    }

    // loads TensorFlow.js + NSFWJS + the model once, the first time an image needs checking
    function ensureNsfw() {
        if (NSFW.promise) return NSFW.promise;
        NSFW.state = 'loading';
        paintScannerStatus();
        NSFW.promise = (async function () {
            try {
                // the NSFWJS file already contains TensorFlow.js, so it is the only script we load
                if (!window.nsfwjs) await loadFirst(NSFW_CFG.selfHosted ? [NSFW_CFG.local] : NSFW_CFG.cdn, function () { return !!window.nsfwjs; });
                NSFW.model = NSFW_CFG.model ? await window.nsfwjs.load(new URL(NSFW_CFG.model, location.href).href, NSFW_CFG.modelType ? { type: NSFW_CFG.modelType } : undefined) : await window.nsfwjs.load();
                NSFW.state = 'ready';
            } catch (e) {
                NSFW.model = null;
                NSFW.state = 'failed';
                NSFW.error = String((e && e.message) || e || 'unknown error').slice(0, 140);
                console.warn('[SPECSOFT chats] the image scanner could not start, images will show normally:', e);
            }
            paintScannerStatus();
            return NSFW.model;
        })();
        return NSFW.promise;
    }

    // Reads the picture's bytes ourselves instead of re-using the browser's picture cache. The cached copy of an
    // image the page already shows can come back "tainted" (blocked from being read), which made the check fail.
    async function loadImageForScan(url) {
        const res = await fetch(url, { mode: 'cors', cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new Error('image download failed (HTTP ' + res.status + ')');
        const objUrl = URL.createObjectURL(await res.blob());
        try {
            const img = await new Promise(function (resolve, reject) {
                const im = new Image();
                im.onload = function () { resolve(im); };
                im.onerror = function () { reject(new Error('image could not be decoded')); };
                im.setAttribute('data-origin', url);
                im.src = objUrl;
            });
            return { img: img, objUrl: objUrl };
        } catch (e) {
            URL.revokeObjectURL(objUrl);
            throw e;
        }
    }

    function nsfwScores(preds) {
        const p = {};
        (preds || []).forEach(function (x) { p[x.className] = x.probability; });
        return { x: Math.round(((p.Porn || 0) + (p.Hentai || 0)) * 1000) / 1000, s: Math.round((p.Sexy || 0) * 1000) / 1000 };
    }

    // 'explicit' | 'suggestive' | 'safe' | 'unknown'
    function nsfwVerdict(entry) {
        if (!entry) return 'unknown';
        if (entry.x >= NSFW_CFG.explicit) return 'explicit';
        if (entry.s >= NSFW_CFG.suggestive) return 'suggestive';
        return 'safe';
    }

    // the model often files explicit art under "suggestive", so both count as one thing: sensitive
    function shouldBlur(verdict) {
        return !!S.imgOn && (verdict === 'explicit' || verdict === 'suggestive');
    }

    function saveNsfwCache() {
        clearTimeout(nsfwSaveTimer);
        nsfwSaveTimer = setTimeout(function () {
            try {
                const o = {};
                Array.from(nsfwCache.entries()).slice(-300).forEach(function (kv) { o[kv[0]] = kv[1]; });
                localStorage.setItem('specsoft.nsfw.cache', JSON.stringify(o));
            } catch (e) { /* storage is optional */ }
        }, 800);
    }

    // one image at a time keeps phones responsive
    function scanImage(path, url) {
        if (nsfwCache.has(path)) return Promise.resolve(nsfwCache.get(path));
        const job = nsfwQueue.then(async function () {
            if (nsfwCache.has(path)) return nsfwCache.get(path);
            const model = await ensureNsfw();
            if (!model) return null;
            try {
                const loaded = await loadImageForScan(url);
                let preds;
                try { preds = await model.classify(loaded.img); } finally { URL.revokeObjectURL(loaded.objUrl); }
                const entry = nsfwScores(preds);
                try {
                    if (localStorage.getItem('specsoft.nsfw.debug') === '1') {   // tuning helper: shows what the model thinks of each image
                        const o = {};
                        (preds || []).forEach(function (x) { o[x.className] = Math.round(x.probability * 1000) / 1000; });
                        console.log('[nsfw]', path, JSON.stringify(o), '=>', nsfwVerdict(entry));
                    }
                } catch (e) { /* ignore */ }
                nsfwCache.set(path, entry);
                NSFW.scanned++;
                saveNsfwCache();
                paintScannerStatus();
                return entry;
            } catch (e) {
                NSFW.unreadable++;
                NSFW.readError = String((e && e.message) || e || 'unknown error').slice(0, 120);
                if (!NSFW.logged[path]) { NSFW.logged[path] = 1; console.warn('[nsfw] could not check this image, it will show normally:', path, e); }
                paintScannerStatus();
                return null;
            }
        });
        nsfwQueue = job.catch(function () { /* keep the queue moving */ });
        return job;
    }

    // keeps one image blurred under a veil until it has been checked (and while it is flagged)
    // testing helper: run  localStorage.setItem('specsoft.nsfw.testown','1')  in the console and reload to check your OWN images too
    function scanOwnImages() { try { return localStorage.getItem('specsoft.nsfw.testown') === '1'; } catch (e) { return false; } }

    function guardImage(card, path, url, mine, compact) {
        if ((mine && !scanOwnImages()) || !S.imgOn || !card) return;
        const key = 'img:' + path;
        card.classList.add('ch-imgguard');
        if (S.revealed.has(key)) return;
        card.classList.add('is-scanning');
        const veil = el('div', { class: 'ch-imgveil' + (compact ? ' ch-imgveil--compact' : ''), role: 'group', 'aria-label': 'Image hidden while it is checked' },
            el('span', { class: 'ch-imgveil-text', text: 'Checking image…' }));
        card.appendChild(veil);

        scanImage(path, url).then(function (entry) {
            if (!veil.isConnected) return;
            const verdict = nsfwVerdict(entry);
            if (!shouldBlur(verdict)) {                              // clean, or the scanner could not run: show it
                card.classList.remove('is-scanning', 'is-blurred');
                veil.remove();
                return;
            }
            card.classList.remove('is-scanning');
            card.classList.add('is-blurred');
            veil.textContent = '';
            veil.setAttribute('aria-label', 'Sensitive image hidden');
            veil.appendChild(icon('info'));
            veil.appendChild(el('span', { class: 'ch-imgveil-text', text: 'This image may contain nudity or other sensitive content.' }));
            veil.appendChild(el('button', {
                type: 'button', class: 'ch-imgveil-btn',
                onclick: function (e) {
                    e.preventDefault(); e.stopPropagation();
                    S.revealed.add(key);
                    card.classList.remove('is-blurred');
                    veil.remove();
                }
            }, compact ? 'Show' : 'Show image'));
            if (!compact) veil.appendChild(el('button', { type: 'button', class: 'ch-imgveil-why', onclick: function (e) { e.preventDefault(); e.stopPropagation(); openFilterDlg(); } }, 'Why am I seeing this? Learn more.'));
        });
    }

    // ----- the viewer's choices -----
    function loadImgPrefs() {
        try {
            S.imgOn = localStorage.getItem('specsoft.chat.img') !== 'off';
            const c = JSON.parse(localStorage.getItem('specsoft.nsfw.cache') || '{}');
            Object.keys(c).forEach(function (k) { if (c[k] && typeof c[k].x === 'number') nsfwCache.set(k, c[k]); });
        } catch (e) { /* ignore */ }
    }

    function setImgPrefs(on) {
        S.imgOn = !!on;
        try { localStorage.setItem('specsoft.chat.img', S.imgOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
        if (S.current) renderFeed({ keepScroll: true });
        if ($('settingsDlg').open && SET.tab === 'media') paintMedia();
        paintScannerStatus();
    }

    function paintScannerStatus() {
        const box = $('filterImgStatus');
        if (!box) return;
        const t = {
            idle: 'The image checker starts the first time someone shares an image.',
            loading: 'Image checker: loading…',
            ready: 'Image checker: ready.' + (NSFW.unreadable ? ' It could not check ' + NSFW.unreadable + ' image(s)' + (NSFW.readError ? ' (' + NSFW.readError + ')' : '') + ', so they show normally.' : ''),
            failed: 'The image checker could not load, so images show normally for now.' + (NSFW.error ? ' (' + NSFW.error + ')' : '') + (/model/i.test(NSFW.error) ? ' The model files are probably missing from the nsfw folder.' : '')
        };
        box.textContent = t[NSFW.state] || '';
    }

    /* ----------------------------------------------------------------------
       9. EMOJI PICKER + QUICK REACTIONS
       ---------------------------------------------------------------------- */
    // The emoji picker lists (Emoticons, People, Things, Symbols, Meme Emojis...) and the quick reactions now live in chat-emoji.js.
    const CUSTOM_EMOJI = Object.create(null);
    const EMOJI = {};
    // the quick bar that pops up when you react to a message. These are only the fallback: chat-emoji.js (SPEC_CHAT_QUICK) replaces them.
    const QUICK = ['👍', '❤️', '😂', '🔥', '😭', '🎉', '💀'];
    // Windows 11 pictures live here. In chat-emoji.js you can write just the file name, like 'loudly-crying-face_1f62d.png'
    const FLUENT_BASE = 'https://em-content.zobj.net/source/microsoft-3D-fluent/473/';
    function registerCustomEmoji() {
        const one = function (entry) {
            if (entry && typeof entry === 'object' && typeof entry.image === 'string') {
                entry.image = entry.image.trim();
                if (!/^https?:/i.test(entry.image)) entry.image = FLUENT_BASE + entry.image.replace(/^\/+/, '');
            }
            if (entry && typeof entry === 'object' && /^[a-z0-9_+-]{1,32}$/i.test(entry.name || '') && isCustomEmojiUrl(entry.image)) {
                CUSTOM_EMOJI[entry.name.toLowerCase()] = entry.image;
            }
        };
        Object.keys(EMOJI).forEach(function (category) { EMOJI[category].forEach(one); });
        QUICK.forEach(one);                                   // quick reactions can bring their own { name, image } too
    }

    // chat-emoji.js (next to chats.js) adds more emoji categories. Loaded in the background at start-up.
    let customEmojiLoading = null;
    function loadCustomEmoji() {
        if (customEmojiLoading) return customEmojiLoading;
        customEmojiLoading = (async function () {
            try {
                if (!window.SPEC_CHAT_EMOJI) await loadScript('chat-emoji.js?v=1');
                const extra = window.SPEC_CHAT_EMOJI || {};
                Object.keys(extra).forEach(function (cat) {
                    if (Array.isArray(extra[cat])) EMOJI[cat] = (EMOJI[cat] || []).concat(extra[cat]);
                });
                if (Array.isArray(window.SPEC_CHAT_QUICK) && window.SPEC_CHAT_QUICK.length) {
                    QUICK.length = 0;
                    window.SPEC_CHAT_QUICK.forEach(function (q) { QUICK.push(q); });
                }
                registerCustomEmoji();
            } catch (e) {
                console.warn('[SPECSOFT chats] chat-emoji.js was not found next to chats.js, your own emoticons are not shown:', e);
            }
        })();
        return customEmojiLoading;
    }
    registerCustomEmoji();

    /* ----------------------------------------------------------------------
       WINDOWS 11 EMOJI  (needs emoji-data.js, it is loaded automatically)
       1. a search box in the emoji picker
       2. :shortcode: suggestions while typing  (just ":" or ":so")
       3. :sob: / :loudly_crying_face: / a keyboard emoji like the crying face, sent from
          anywhere, are SHOWN as the Windows 11 (Fluent 3D) picture.
       The message text is never changed. The picture is only drawn when it is displayed.
       ---------------------------------------------------------------------- */
    /* EMOJI-FLUENT START */
    const FL = { ready: false, items: [], byCode: Object.create(null), byChar: new Map(), loading: null };
    // one emoji = a picture-style emoji, a keycap, or a ZWJ combo. Plain text symbols like (c) are left alone.
    const RE_EMOJI_SRC = '(?:[#*0-9]\\uFE0F?\\u20E3)|(?:(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)\\p{Emoji_Modifier}?(?:\\u200D(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F?)\\p{Emoji_Modifier}?)*\\uFE0F?)';
    // shown when you type just ":" (edit freely, use shortcodes)
    const POPULAR = ['joy', 'sob', 'heart', 'fire', 'skull', '+1', 'pleading_face', 'smile', '100', 'eyes', 'thinking', 'tada'];

    function stripVS(s) { return String(s).replace(/\uFE0F/g, ''); }

    // "loudly crying face" -> "loudly-crying-face" (how the picture files are named)
    function flSlug(name) {
        return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
            .replace(/[\u2019'.,:()!"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function flByCode(k) { return FL.ready ? (FL.byCode[String(k).toLowerCase()] || null) : null; }
    function flByChar(ch) { return FL.ready ? (FL.byChar.get(stripVS(ch)) || null) : null; }

    // ----- standard emoji groups for the picker. emoji-data.js has no categories, so they come from the code point. -----
    const FL_GROUPS = [
        { key: 'smileys', label: 'Smileys & Emotion', icon: '😀' },
        { key: 'people', label: 'People & Body', icon: '👋' },
        { key: 'nature', label: 'Animals & Nature', icon: '🐻' },
        { key: 'food', label: 'Food & Drink', icon: '🍔' },
        { key: 'activities', label: 'Activities', icon: '⚽' },
        { key: 'travel', label: 'Travel & Places', icon: '🚗' },
        { key: 'objects', label: 'Objects', icon: '💡' },
        { key: 'symbols', label: 'Symbols', icon: '🔣' },
        { key: 'flags', label: 'Flags', icon: '🏁' }
    ];
    // checked in this order, first match wins. Anything not listed is an object.
    const FL_RANGES = [
        ['flags', [[0x1f1e6, 0x1f1ff], [0x1f3f3, 0x1f3f4], [0x1f3c1, 0x1f3c1], [0x1f6a9, 0x1f6a9], [0x1f38c, 0x1f38c]]],
        ['smileys', [[0x1f600, 0x1f644], [0x1f648, 0x1f64a], [0x1f910, 0x1f915], [0x1f917, 0x1f917], [0x1f920, 0x1f925], [0x1f927, 0x1f92f],
            [0x1f970, 0x1f976], [0x1f978, 0x1f97a], [0x1f9d0, 0x1f9d0], [0x1f9cc, 0x1f9cc], [0x1fae0, 0x1fae8], [0x1fae9, 0x1faea], [0x263a, 0x263a], [0x2639, 0x2639],
            [0x2620, 0x2620], [0x1f480, 0x1f480], [0x1f479, 0x1f47b], [0x1f47d, 0x1f47f], [0x1f4a9, 0x1f4a9], [0x1f916, 0x1f916],
            [0x1f493, 0x1f49f], [0x2763, 0x2764], [0x1f9e1, 0x1f9e1], [0x1f90d, 0x1f90e], [0x1f5a4, 0x1f5a4], [0x1fa75, 0x1fa77],
            [0x1f48b, 0x1f48c], [0x1f4a2, 0x1f4a6], [0x1f4a8, 0x1f4a8], [0x1f4ab, 0x1f4ad], [0x1f4af, 0x1f4af], [0x1f573, 0x1f573], [0x1f5e8, 0x1f5e8], [0x1f5ef, 0x1f5ef]]],
        ['people', [[0x1f440, 0x1f450], [0x1f464, 0x1f478], [0x1f47c, 0x1f47c], [0x1f481, 0x1f487], [0x1f48f, 0x1f48f], [0x1f491, 0x1f491], [0x1f4aa, 0x1f4aa],
            [0x1f385, 0x1f385], [0x1f3c2, 0x1f3c4], [0x1f3c7, 0x1f3c7], [0x1f3ca, 0x1f3cc], [0x1f574, 0x1f575], [0x1f57a, 0x1f57a], [0x1f590, 0x1f590],
            [0x1f595, 0x1f596], [0x1f5e3, 0x1f5e3], [0x1f645, 0x1f647], [0x1f64b, 0x1f64f], [0x1f6a3, 0x1f6a3], [0x1f6b4, 0x1f6b6], [0x1f6c0, 0x1f6c0], [0x1f6cc, 0x1f6cc],
            [0x1f90c, 0x1f90c], [0x1f90f, 0x1f90f], [0x1f918, 0x1f91f], [0x1f926, 0x1f926], [0x1f930, 0x1f939], [0x1f93c, 0x1f93e], [0x1f977, 0x1f977],
            [0x1f9b0, 0x1f9b9], [0x1f9bb, 0x1f9bf], [0x1f9cd, 0x1f9cf], [0x1f9d1, 0x1f9df], [0x1f9e0, 0x1f9e0], [0x1fac0, 0x1fac5], [0x1faf0, 0x1faf8],
            [0x261d, 0x261d], [0x26f9, 0x26f9], [0x270a, 0x270d]]],
        ['nature', [[0x1f400, 0x1f43f], [0x1f980, 0x1f9ae], [0x1f331, 0x1f335], [0x1f337, 0x1f33c], [0x1f33e, 0x1f344], [0x1f490, 0x1f490], [0x1f940, 0x1f940],
            [0x1fab0, 0x1fabf], [0x1face, 0x1facf], [0x1f54a, 0x1f54a], [0x1f577, 0x1f578], [0x1f98b, 0x1f98b], [0x2618, 0x2618], [0x1f3f5, 0x1f3f5]]],
        ['food', [[0x1f32d, 0x1f32f], [0x1f330, 0x1f330], [0x1f336, 0x1f336], [0x1f33d, 0x1f33d], [0x1f345, 0x1f37f], [0x1f37d, 0x1f37d], [0x1f942, 0x1f944],
            [0x1f950, 0x1f96f], [0x1f382, 0x1f382], [0x1f3fa, 0x1f3fa], [0x1f9c0, 0x1f9c0], [0x1f9c1, 0x1f9cb], [0x1fad0, 0x1fad9], [0x2615, 0x2615], [0x1f9c2, 0x1f9c2]]],
        ['activities', [[0x1f383, 0x1f384], [0x1f386, 0x1f38b], [0x1f38d, 0x1f391], [0x1f3a3, 0x1f3a3], [0x1f3a8, 0x1f3a8], [0x1f3aa, 0x1f3ab], [0x1f3ad, 0x1f3b4],
            [0x1f3bd, 0x1f3c0], [0x1f3c5, 0x1f3c6], [0x1f3c8, 0x1f3c9], [0x1f3cf, 0x1f3d3], [0x1f3f8, 0x1f3f9], [0x1f947, 0x1f94f], [0x1f93a, 0x1f93a], [0x1f93f, 0x1f93f],
            [0x1f9e9, 0x1f9e9], [0x1f9f8, 0x1f9f8], [0x1f380, 0x1f381], [0x1fa80, 0x1fa86], [0x26bd, 0x26be], [0x26f3, 0x26f3], [0x26f8, 0x26f8], [0x1f0cf, 0x1f0cf], [0x1f004, 0x1f004],
            [0x1f579, 0x1f579], [0x2728, 0x2728], [0x2660, 0x2660], [0x2663, 0x2663], [0x2665, 0x2666], [0x26f7, 0x26f7], [0x1f396, 0x1f397], [0x1f39f, 0x1f39f]]],
        ['travel', [[0x1f300, 0x1f30c], [0x1f30d, 0x1f320], [0x1f321, 0x1f321], [0x1f324, 0x1f32c], [0x2600, 0x2604], [0x2614, 0x2614], [0x2744, 0x2744], [0x26a1, 0x26a1],
            [0x26c4, 0x26c5], [0x26c8, 0x26c8], [0x2b50, 0x2b50], [0x1f525, 0x1f525], [0x1f4a7, 0x1f4a7], [0x1f3d4, 0x1f3df], [0x1f3e0, 0x1f3f0], [0x1f3a0, 0x1f3a2],
            [0x1f488, 0x1f488], [0x1f5fa, 0x1f5ff], [0x1f680, 0x1f6a8], [0x1f6b2, 0x1f6b2], [0x1f6d1, 0x1f6d1], [0x1f6d5, 0x1f6d7], [0x1f6dd, 0x1f6df], [0x1f6e2, 0x1f6e5],
            [0x1f6e9, 0x1f6e9], [0x1f6eb, 0x1f6ec], [0x1f6f0, 0x1f6f0], [0x1f6f3, 0x1f6fc], [0x1f9ed, 0x1f9ed], [0x1fa90, 0x1fa90], [0x1f550, 0x1f567], [0x23f0, 0x23f3],
            [0x231a, 0x231b], [0x1f570, 0x1f570], [0x26e9, 0x26ea], [0x26f0, 0x26f2], [0x26f4, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2693, 0x2693], [0x2708, 0x2708],
            [0x1f54b, 0x1f54d], [0x1f3cd, 0x1f3ce], [0x1f492, 0x1f492]]],
        ['symbols', [[0x23, 0x23], [0x2a, 0x2a], [0x30, 0x39], [0xa9, 0xa9], [0xae, 0xae], [0x203c, 0x203c], [0x2049, 0x2049], [0x2122, 0x2122], [0x2139, 0x2139],
            [0x2194, 0x21aa], [0x23cf, 0x23cf], [0x23e9, 0x23ec], [0x23f8, 0x23fa], [0x24c2, 0x24c2], [0x25aa, 0x25ab], [0x25b6, 0x25b6], [0x25c0, 0x25c0], [0x25fb, 0x25fe],
            [0x2611, 0x2611], [0x2622, 0x2623], [0x2626, 0x2626], [0x262a, 0x262a], [0x262e, 0x262f], [0x2638, 0x2638], [0x2640, 0x2642], [0x2648, 0x2653], [0x267b, 0x267b],
            [0x267e, 0x267f], [0x2695, 0x2695], [0x269b, 0x269c], [0x26a0, 0x26a0], [0x26aa, 0x26ab], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x2705, 0x2705], [0x2714, 0x2714],
            [0x2716, 0x2716], [0x271d, 0x271d], [0x2721, 0x2721], [0x2733, 0x2734], [0x2747, 0x2747], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757],
            [0x2795, 0x2797], [0x27a1, 0x27a1], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2934, 0x2935], [0x2b05, 0x2b07], [0x2b1b, 0x2b1c], [0x2b55, 0x2b55], [0x3030, 0x3030],
            [0x303d, 0x303d], [0x3297, 0x3297], [0x3299, 0x3299], [0x1f170, 0x1f171], [0x1f17e, 0x1f17f], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f201, 0x1f202],
            [0x1f21a, 0x1f21a], [0x1f22f, 0x1f22f], [0x1f232, 0x1f23a], [0x1f250, 0x1f251], [0x1f4a0, 0x1f4a0], [0x1f4f3, 0x1f4f6], [0x1f500, 0x1f506], [0x1f518, 0x1f524],
            [0x1f530, 0x1f53d], [0x1f549, 0x1f549], [0x1f54e, 0x1f54e], [0x1f6ab, 0x1f6ab], [0x1f6ad, 0x1f6af], [0x1f6b0, 0x1f6b1], [0x1f6b3, 0x1f6b3], [0x1f6b7, 0x1f6bc],
            [0x1f6be, 0x1f6be], [0x1f6c2, 0x1f6c5], [0x1f6d0, 0x1f6d0], [0x1f6dc, 0x1f6dc], [0x1f7e0, 0x1f7eb], [0x1f7f0, 0x1f7f0], [0x23ed, 0x23ef], [0x1f52f, 0x1f52f], [0x26a7, 0x26a7]]]
    ];
    function flGroupOf(cps) {
        const cp = cps[0];
        for (let g = 0; g < FL_RANGES.length; g++) {
            const rs = FL_RANGES[g][1];
            for (let i = 0; i < rs.length; i++) if (cp >= rs[i][0] && cp <= rs[i][1]) return FL_RANGES[g][0];
        }
        return 'objects';
    }

    function flIndex(data) {
        if (!data || !Array.isArray(data.list)) return false;
        FL.items = []; FL.byCode = Object.create(null); FL.byChar = new Map();
        data.list.forEach(function (r) {
            const cps = String(r[0]).split('-');
            let c;
            try { c = String.fromCodePoint.apply(null, cps.map(function (h) { return parseInt(h, 16); })); } catch (e) { return; }
            const codes = r[2] ? String(r[2]).split(' ') : [];
            const tail = (r[4] || flSlug(r[1])) + '_' + cps.map(function (h) { return h.replace(/^0+(?=.)/, ''); }).join('-') + '.png';
            const it = {
                c: c, n: r[1], codes: codes, key: codes[0] || '', url: data.base + tail,
                cps: cps.map(function (h) { return parseInt(h, 16); }),
                hay: (r[1] + ' ' + codes.join(' ').replace(/[_+-]+/g, ' ') + ' ' + (r[3] || '')).toLowerCase()
            };
            FL.items.push(it);
            codes.forEach(function (k) { if (!FL.byCode[k]) FL.byCode[k] = it; });
            FL.byChar.set(stripVS(c), it);
        });
        // the picker's category sections (codepoint order keeps the faces, hearts, animals... together)
        FL.groups = Object.create(null);
        FL_GROUPS.forEach(function (g) { FL.groups[g.key] = []; });
        FL.items.slice().sort(function (a, b) { return a.cps[0] - b.cps[0] || a.cps.length - b.cps.length || (a.n < b.n ? -1 : 1); })
            .forEach(function (it) { FL.groups[flGroupOf(it.cps)].push(it); });
        FL.ready = FL.items.length > 0;
        return FL.ready;
    }

    function loadEmojiData() {
        if (FL.loading) return FL.loading;
        FL.loading = (async function () {
            try {
                if (!window.SPEC_EMOJI) await loadScript('emoji-data.js?v=1');
                flIndex(window.SPEC_EMOJI);
            } catch (e) {
                console.warn('[SPECSOFT chats] emoji-data.js was not found next to chats.js, Windows 11 emoji search and shortcodes are off:', e);
            }
            return FL.ready;
        })();
        return FL.loading;
    }

    // data arrived: redraw the picker, the open chat and the chat list so :sob: becomes a picture
    function onEmojiData(ready) {
        if (!ready) return;
        try { buildPicker(); } catch (e) { /* picker not ready yet */ }
        try { if (S.current) renderFeed({ keepScroll: true }); renderList(); } catch (e) { /* not logged in yet */ }
    }

    // a Windows 11 emoji picture. If the file is missing it turns back into the normal emoji.
    function makeFluentImg(item, cls) {
        const img = el('img', { class: cls, src: item.url, alt: item.c, title: ':' + item.key + ':', loading: 'lazy', draggable: 'false' });
        img.addEventListener('error', function () { img.replaceWith(document.createTextNode(item.c)); });
        return img;
    }

    function makeFluentEmoji(item, jumbo) {
        return makeFluentImg(item, 'ch-inline-emoji ch-inline-emoji--fluent' + (jumbo ? ' ch-inline-emoji--jumbo' : ''));
    }

    // text with keyboard emoji in it -> text + Windows 11 pictures
    function appendTextWithEmoji(frag, text, jumbo) {
        text = String(text == null ? '' : text);
        const re = new RegExp(RE_EMOJI_SRC, 'gu');
        let last = 0, m;
        while ((m = re.exec(text))) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            const item = flByChar(m[0]);
            if (item) frag.appendChild(makeFluentEmoji(item, jumbo));
            else frag.appendChild(jumbo ? el('span', { class: 'ch-jumbo-native', text: m[0] }) : document.createTextNode(m[0]));
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    }

    // :sob: marks that were swapped for a hidden placeholder, put back as plain text (inside bold, code, spoilers...)
    function unmark(s) {
        return String(s).replace(/\u0000url:([^\u0000]+)\u0000/g, '$1').replace(/\u0000([a-z0-9_+-]{1,32})\u0000/gi, ':$1:');
    }

    // used by the chat list preview: ":sob:" -> the emoji character
    function flShortcodeToChar(match, k) {
        const it = flByCode(k);
        return it ? it.c : match;
    }

    // a picker / reaction button: the Windows 11 picture when we have one, the plain emoji otherwise
    function fillEmojiBtn(button, ch) {
        const it = flByChar(ch);
        if (!it) { button.textContent = ch; return; }
        button.textContent = '';
        button.appendChild(makeFluentImg(it, 'ch-fl-img'));
    }

    // ----- search (used by the picker box and by the typing suggestions) -----
    function stdResult(it, code) { return { custom: false, code: code || it.key, label: it.n, url: it.url, ch: it.c }; }

    function popularEmoji() {
        const out = [];
        POPULAR.forEach(function (k) { const it = flByCode(k); if (it && out.length < 8) out.push(stdResult(it, k)); });
        return out;
    }

    function searchEmoji(query, limit) {
        const q = String(query || '').toLowerCase().trim().replace(/^:+|:+$/g, '');
        if (!q) return [];
        const words = q.replace(/[_\s]+/g, ' ').split(' ').filter(Boolean);
        const scored = [];
        const mine = Object.create(null);

        // 0 exact shortcode, 1 shortcode starts with it, 2 every word starts a word of the name, 3 every word is somewhere in it
        const rate = function (codes, hay) {
            let i;
            for (i = 0; i < codes.length; i++) if (codes[i] === q) return { s: 0, best: codes[i] };
            for (i = 0; i < codes.length; i++) if (codes[i].indexOf(q) === 0) return { s: 1, best: codes[i] };
            const hw = hay.split(' ');
            if (words.every(function (w) { return hw.some(function (x) { return x.indexOf(w) === 0; }); })) return { s: 2, best: codes[0] };
            if (words.every(function (w) { return hay.indexOf(w) >= 0; })) return { s: 3, best: codes[0] };
            return null;
        };

        // your own emoticons / meme emojis / store emotes first
        Object.keys(CUSTOM_EMOJI).forEach(function (k) {
            const url = composerEmojiUrl(k);
            if (!url) return;
            // same Windows 11 picture as a standard emoji? let the standard one show up instead (it knows :sob: style nicknames too)
            if (FL.ready && flByCode(k) && /^https:\/\/em-content\.zobj\.net\//.test(url)) return;
            mine[k] = true;
            const r = rate([k], k.replace(/[_+-]+/g, ' '));
            if (r) scored.push({ s: r.s, o: 0, len: k.length, res: { custom: true, code: k, label: k.replace(/_/g, ' '), url: url, ch: null } });
        });
        if (FL.ready) {
            FL.items.forEach(function (it) {
                if (it.codes.some(function (k) { return mine[k]; })) return;      // you already have this one as a custom emoji
                const r = rate(it.codes, it.hay);
                if (r) scored.push({ s: r.s, o: 1, len: (r.best || '').length, res: stdResult(it, r.best) });
            });
        }
        scored.sort(function (a, b) { return a.s - b.s || a.len - b.len || a.o - b.o; });      // better match, then shorter shortcode, then your own custom emoji
        return scored.slice(0, limit || 60).map(function (x) { return x.res; });
    }

    // ----- search box inside the picker -----
    let pickSearch = null, pickResults = null, pickMain = null, pickTimer = null;

    function ensurePickSearch() {
        if (pickSearch) return pickSearch;
        pickSearch = el('input', { class: 'ch-field ch-emoji-q', type: 'search', id: 'chEmojiSearch', placeholder: 'Search emoji (try sob, fire, heart)', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search emoji' });
        pickSearch.addEventListener('input', function () { clearTimeout(pickTimer); pickTimer = setTimeout(runPickerSearch, 60); });
        pickSearch.addEventListener('keydown', function (e) {
            if (e.isComposing) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                const first = pickResults && pickResults.querySelector('.ch-emoji-btn:not([disabled])');
                if (first) first.click();
            } else if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                if (pickSearch.value) { pickSearch.value = ''; runPickerSearch(); }
                else { $('chEmoji').hidden = true; $('chEmojiBtn').setAttribute('aria-expanded', 'false'); $('chInput').focus(); }
            }
        });
        return pickSearch;
    }

    function searchBtn(r) {
        const value = r.custom ? ':' + r.code + ':' : r.ch;
        const btn = el('button', { type: 'button', class: 'ch-emoji-btn is-custom', 'aria-label': r.label, title: ':' + r.code + ':', onclick: function () { pickEmoji(value); } });
        const img = el('img', { src: r.url, alt: r.label, loading: 'lazy' });
        img.addEventListener('error', function () { if (r.ch) btn.textContent = r.ch; else btn.disabled = true; });
        btn.appendChild(img);
        return btn;
    }

    function runPickerSearch() {
        if (!pickSearch || !pickResults || !pickMain) return;
        const q = pickSearch.value.trim();
        pickMain.hidden = !!q;
        pickResults.hidden = !q;
        pickResults.textContent = '';
        if (!q) return;
        const res = searchEmoji(q, 150);
        if (!res.length) {
            pickResults.appendChild(el('p', { class: 'ch-emoji-empty', text: FL.ready ? 'No emoji found. Try another word.' : 'Loading emoji...' }));
            return;
        }
        pickResults.appendChild(el('div', { class: 'ch-emoji-cat', text: 'RESULTS' }));
        const grid = el('div', { class: 'ch-emoji-grid' });
        res.forEach(function (r) { grid.appendChild(searchBtn(r)); });
        pickResults.appendChild(grid);
    }

    // ----- suggestions while typing  ":"  or  ":so" -----
    const EMS = { open: false, items: [], index: 0, nav: false, q: '' };

    // is the caret right after ":something" (and not in the middle of a word or a time like 10:30)?
    function emojiContext() {
        const root = $('chInput');
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== 3 || !root.contains(node)) return null;
        const upto = node.nodeValue.slice(0, sel.anchorOffset);
        const m = /(^|[\s(\[{>])(:)([a-z0-9_+-]{0,32})$/i.exec(upto);
        if (!m) return null;
        return { node: node, start: m.index + m[1].length, end: sel.anchorOffset, query: m[3] };
    }

    function closeEmojiSuggest() {
        EMS.open = false;
        const pop = $('chEmojiSug');
        if (pop) pop.hidden = true;
    }

    function paintEmojiSuggest() {
        let pop = $('chEmojiSug');
        if (!pop) {
            pop = el('div', { class: 'ch-mention-pop ch-emsug', id: 'chEmojiSug', role: 'listbox', 'aria-label': 'Emoji suggestions', hidden: true });
            pop.addEventListener('mousedown', function (e) { e.preventDefault(); });      // keep the caret in the message box
            document.querySelector('.ch-composer').appendChild(pop);
        }
        pop.textContent = '';
        pop.appendChild(el('div', { class: 'ch-mention-head', text: EMS.q ? 'EMOJI MATCHING :' + EMS.q.toUpperCase() : 'POPULAR EMOJI' }));
        EMS.items.forEach(function (it, i) {
            const img = el('img', { class: 'ch-emsug-img', src: it.url, alt: it.ch || ':' + it.code + ':', loading: 'lazy' });
            img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
            pop.appendChild(el('button', {
                type: 'button', id: 'chEms' + i, role: 'option', 'aria-selected': String(i === EMS.index),
                class: 'ch-mention-item' + (i === EMS.index ? ' is-active' : ''),
                onclick: function () { pickEmojiSuggest(it); }
            }, img, el('span', { class: 'ch-mention-name' }, el('strong', { text: ':' + it.code + ':' }), el('small', { text: it.label }))));
        });
        pop.hidden = false;
        EMS.open = true;
        const active = $('chEms' + EMS.index);
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function updateEmojiSuggest() {
        const root = $('chInput');
        const ctx = root.disabled ? null : emojiContext();
        if (!ctx || (ctx.query && !/^(?:[a-z0-9+]|-1)/i.test(ctx.query))) { closeEmojiSuggest(); return; }     // ":-)" is a smiley, not a search
        const items = ctx.query ? searchEmoji(ctx.query, 8) : popularEmoji();
        if (!items.length) { closeEmojiSuggest(); return; }
        const same = EMS.open && EMS.q === ctx.query;
        EMS.items = items;
        EMS.q = ctx.query;
        if (!same) { EMS.index = 0; EMS.nav = false; }
        paintEmojiSuggest();
    }

    function pickEmojiSuggest(it) {
        const ctx = emojiContext();
        if (!ctx || !it) { closeEmojiSuggest(); return; }
        const code = it.custom ? ':' + it.code + ':' : it.ch;
        const url = it.custom ? composerEmojiUrl(it.code) : it.url;
        if (!url) { closeEmojiSuggest(); return; }
        recentAdd(code);
        const img = makeComposerEmoji(code, url);
        const v = ctx.node.nodeValue, parent = ctx.node.parentNode;
        let after = v.slice(ctx.end);
        const addSpace = !/^\s/.test(after);
        if (addSpace) after = ' ' + after;
        ctx.node.nodeValue = v.slice(0, ctx.start);
        parent.insertBefore(img, ctx.node.nextSibling);
        const tail = document.createTextNode(after);
        parent.insertBefore(tail, img.nextSibling);
        const r = document.createRange();
        r.setStart(tail, addSpace ? 1 : 0);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        composerRange = r.cloneRange();
        closeEmojiSuggest();
        autosize();
        $('chInput').focus();
    }

    // arrows / Tab / Enter / Escape while the list is open. returns true when it used the key
    function handleEmojiKey(e) {
        if (!EMS.open) return false;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            EMS.nav = true;
            EMS.index = (EMS.index + (e.key === 'ArrowDown' ? 1 : -1) + EMS.items.length) % EMS.items.length;
            paintEmojiSuggest();
            return true;
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
            if (e.isComposing) return false;
            if (e.key === 'Enter' && !EMS.nav && EMS.q.length < 2) return false;      // ":D" + Enter still just sends ":D"
            e.preventDefault();
            pickEmojiSuggest(EMS.items[EMS.index]);
            return true;
        }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEmojiSuggest(); return true; }
        return false;
    }

    // the few styles this feature needs (kept here so you only have to replace two files)
    function injectEmojiStyles() {
        if ($('chEmojiStyle')) return;
        const css = [
            '.ch-emoji-search { position: sticky; top: 0; z-index: 2; margin: -10px -12px 6px; padding: 10px 12px 6px; background: var(--bg-card); }',
            '.ch-emoji-search .ch-field { margin: 0; min-height: 38px; padding: 8px 12px; font-size: 14px; border-radius: 10px; }',
            '.ch-emoji-results[hidden], .ch-emoji-main[hidden] { display: none !important; }',
            '.ch-fl-img { display: block; width: 28px; height: 28px; object-fit: contain; pointer-events: none; }',
            '.ch-quick-btn .ch-fl-img { width: 24px; height: 24px; }',
            '.ch-emsug-img { width: 28px; height: 28px; object-fit: contain; flex: 0 0 auto; }',
            '.ch-bubble .ch-inline-emoji--fluent { border-radius: 0; }'
        ].join('\n');
        const s = document.createElement('style');
        s.id = 'chEmojiStyle';
        s.textContent = css;
        document.head.appendChild(s);
    }
    /* EMOJI-FLUENT END */

    /* ----------------------------------------------------------------------
       MY EMOTES: custom emoji bought in the Store (supabase-store-emotes.sql)
       Everybody can SEE every store emote in messages; only owners can SEND them.
       ---------------------------------------------------------------------- */
    const STORE_EMOTE = Object.create(null);   // every store emote: name -> image url
    let MY_EMOTES = new Map();                 // emotes this member owns: name -> image url
    let emotesAt = 0;

    /* ----------------------------------------------------------------------
       SUPER EMOTES (super-emotes.js + supabase-store-super-emotes.sql)
       A super emote is a store emote shown as a bigger sticker. Sending one plays its effects and
       sound for everybody who has that chat open. One per message, 10 second cooldown (the server
       enforces both; the timer here just shows it).
       ---------------------------------------------------------------------- */
    const SUPER = Object.create(null);         // super emote name -> its cleaned design
    let SUPER_UNTIL = 0;                       // when the cooldown ends (ms since 1970)
    let superTick = null;

    function superSig() { return JSON.stringify(Object.keys(SUPER).sort().map(function (n) { return [n, SUPER[n].hl]; })); }

    function superCodesIn(text) {
        const out = [], re = /:([a-z0-9_+-]{1,32}):/gi;
        let m;
        while ((m = re.exec(String(text || '')))) { const k = m[1].toLowerCase(); if (SUPER[k]) out.push(k); }
        return out;
    }

    function superLeft() { return Math.max(0, SUPER_UNTIL - Date.now()); }

    // dims every super emote button and shows the seconds left while the cooldown runs
    function paintSuperCd() {
        const left = superLeft();
        document.querySelectorAll('.ch-emoji-btn.is-super').forEach(function (b) {
            b.classList.toggle('is-cooling', left > 0);
            b.setAttribute('aria-disabled', left > 0 ? 'true' : 'false');
            const t = b.querySelector('.ch-super-timer');
            if (t) t.textContent = left > 0 ? String(Math.ceil(left / 1000)) : '';
        });
        if (left <= 0 && superTick) { clearInterval(superTick); superTick = null; }
    }

    function startSuperTicker() {
        paintSuperCd();
        if (!superTick && superLeft() > 0) superTick = setInterval(paintSuperCd, 250);
    }

    // the colored highlight + timer on a picker button
    function superMark(button, k) {
        const d = SUPER[k];
        if (!d) return;
        button.classList.add('is-super');
        button.style.setProperty('--sup', d.hl);
        button.appendChild(el('span', { class: 'ch-super-timer', 'aria-hidden': 'true' }));
    }

    // a super emote inside a message: a bigger sticker
    function makeSuperSticker(k) {
        const img = el('img', { class: 'ch-inline-emoji ch-super-sticker', src: STORE_EMOTE[k], alt: ':' + k + ':', title: ':' + k + ':', loading: 'lazy', draggable: 'false', referrerpolicy: 'no-referrer' });
        if (window.SpecSuper) window.SpecSuper.decorate(img, SUPER[k]);
        img.onerror = function () { img.replaceWith(document.createTextNode(':' + k + ':')); };
        return img;
    }

    // run the effects + sound of a super emote that just landed in the open chat
    function playSuper(msgId, k) {
        const d = SUPER[k];
        const host = $('chMain');
        if (!d || !host || !window.SpecSuper) return;
        let origin = null;
        const node = $('chFeed').querySelector('[data-id="' + msgId + '"] .ch-super-sticker');
        if (node) {
            const a = node.getBoundingClientRect(), b = host.getBoundingClientRect();
            origin = { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
        }
        window.SpecSuper.play(d, { host: host, origin: origin, sticker: node });
    }

    // my own super emote was accepted: start the cooldown and play it for me too
    function superSent(msgId, k) {
        SUPER_UNTIL = Date.now() + (window.SpecSuper ? window.SpecSuper.COOLDOWN_MS : 10000);
        startSuperTicker();
        playSuper(msgId, k);
    }

    // picking a super emote for the message box: refuse during the cooldown, and only one per message
    function superGuard() {
        const left = superLeft();
        if (left > 0) { toast('Super emotes are recharging: ' + Math.ceil(left / 1000) + 's left.'); return false; }
        if (superCodesIn($('chInput').value).length) { toast(ERR.super_one_per_message); return false; }
        return true;
    }

    function composerEmojiUrl(name) {
        const k = String(name).toLowerCase();
        if (STORE_EMOTE[k]) return MY_EMOTES.has(k) ? STORE_EMOTE[k] : null;   // not yours: stays plain text
        return CUSTOM_EMOJI[k] || null;
    }

    async function loadEmotes() {
        if (!sb) return false;
        try {
            const supBefore = superSig();
            const r = await Promise.all([sb.rpc('chat_emotes'), sb.rpc('chat_my_emotes'), sb.rpc('chat_super_emotes')]);
            if (r[0].error) return false;                                   // store SQL not installed yet: chats keep working
            (r[0].data || []).forEach(function (e) {
                const k = String(e.emote_name || '').toLowerCase();
                if (!/^[a-z0-9_+-]{1,32}$/.test(k) || !/^https:\/\/[^\s]+$/i.test(e.image_url || '')) return;
                if (CUSTOM_EMOJI[k] && !STORE_EMOTE[k]) return;             // never replace a built-in emoji
                STORE_EMOTE[k] = e.image_url; CUSTOM_EMOJI[k] = e.image_url;
            });
            const next = new Map();
            if (!r[1].error) (r[1].data || []).forEach(function (e) { const k = String(e.emote_name || '').toLowerCase(); if (STORE_EMOTE[k]) next.set(k, STORE_EMOTE[k]); });
            const sig = function (m) { return Array.from(m.keys()).sort().join('|'); };
            const changed = sig(next) !== sig(MY_EMOTES);
            MY_EMOTES = next; emotesAt = Date.now();
            if (!r[2].error) {                                              // super emote SQL not installed yet: they simply stay normal emotes
                Object.keys(SUPER).forEach(function (n) { delete SUPER[n]; });
                (r[2].data || []).forEach(function (e) {
                    const k = String(e.emote_name || '').toLowerCase();
                    const d = window.SpecSuper ? window.SpecSuper.clean(e.super_data) : null;
                    if (d && STORE_EMOTE[k]) SUPER[k] = d;
                });
            }
            return changed || superSig() !== supBefore;
        } catch (e) { return false; }
    }

    async function refreshEmotes(force) {
        if (!force && Date.now() - emotesAt < 15000) return;
        if (await loadEmotes()) buildPicker();
    }

    function appendMyEmotes(box) {
        box.appendChild(el('div', { class: 'ch-emoji-cat', text: 'MY EMOTES' }));
        const names = Array.from(MY_EMOTES.keys());
        if (!names.length) {
            box.appendChild(el('p', { class: 'ch-emoji-empty' }, 'Custom emotes you buy show up here. ', el('a', { class: 'ch-link', href: 'store.html#items' }, 'Open the store')));
            return;
        }
        const grid = el('div', { class: 'ch-emoji-grid' });
        names.forEach(function (name) {
            const button = el('button', { type: 'button', class: 'ch-emoji-btn is-custom', 'aria-label': name, title: ':' + name + ':' + (SUPER[name] ? ' (super emote)' : ''), onclick: function () { pickEmoji(':' + name + ':'); } });
            superMark(button, name);
            const img = el('img', { src: MY_EMOTES.get(name), alt: name, loading: 'lazy', referrerpolicy: 'no-referrer' });
            img.onerror = function () { button.disabled = true; };
            button.appendChild(img);
            grid.appendChild(button);
        });
        grid.appendChild(el('a', { class: 'ch-emoji-btn ch-emoji-more', href: 'store.html#items', title: 'Get more emotes', 'aria-label': 'Get more emotes', text: '+' }));
        box.appendChild(grid);
        paintSuperCd();
    }

    /* seasonal emoji (seasons.js): while a season is on, the picker gets a section of matching emoji */
    function appendSeasonal(box) {
        const s = window.SpecSeasons && window.SpecSeasons.current();
        if (!s || !s.emojis || !s.emojis.length) return;
        box.appendChild(el('div', { class: 'ch-emoji-cat', text: s.name.toUpperCase() + ' ' + s.emoji }));
        const grid = el('div', { class: 'ch-emoji-grid' });
        s.emojis.forEach(function (ch) {
            const sb_ = el('button', { type: 'button', class: 'ch-emoji-btn', 'aria-label': ch, title: ch, onclick: function () { pickEmoji(ch); } });
            fillEmojiBtn(sb_, ch);
            grid.appendChild(sb_);
        });
        box.appendChild(grid);
    }
    window.addEventListener('specseason', function () { try { buildPicker(); } catch (e) { /* picker not ready yet */ } });

    /* ----- recently used (kept in this browser, newest first) ----- */
    const RECENT_KEY = 'specsoft_emoji_recent_v1', RECENT_MAX = 24;
    let recentBox = null;

    function recentGet() {
        try {
            const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
            return Array.isArray(a) ? a.filter(function (s) { return typeof s === 'string' && s && s.length <= 40; }).slice(0, RECENT_MAX) : [];
        } catch (e) { return []; }
    }
    function recentAdd(value) {
        value = String(value == null ? '' : value).trim();
        if (!value || value.length > 40) return;
        try {
            const next = [value].concat(recentGet().filter(function (x) { return x !== value; })).slice(0, RECENT_MAX);
            localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch (e) { /* private mode or full storage: just no history */ }
    }
    function recentClear() {
        try { localStorage.removeItem(RECENT_KEY); } catch (e) { /* ignore */ }
        paintRecent();
    }
    // one button for a remembered value: '😭', ':sob:' or one of your own :emotes:
    function recentButton(value) {
        let url = null, label = value, ch = value;
        const m = /^:([a-z0-9_+-]{1,32}):$/i.exec(value);
        if (m) {
            const k = m[1].toLowerCase();
            if (STORE_EMOTE[k]) {
                if (!MY_EMOTES.has(k)) return null;                 // an emote you no longer own is not shown
                url = MY_EMOTES.get(k); label = k; ch = null;
            } else {
                const q = resolveQuick(value);
                if (!q) return null;
                url = q.url; label = q.label; ch = q.ch;
                if (!url && !ch) return null;
            }
        }
        const button = el('button', { type: 'button', class: 'ch-emoji-btn' + (url && !ch ? ' is-custom' : ''), 'aria-label': label, title: label, onclick: function () { pickEmoji(value); } });
        if (m) superMark(button, m[1].toLowerCase());
        if (url && !ch) {
            const img = el('img', { src: url, alt: label, loading: 'lazy' });
            img.onerror = function () { button.disabled = true; };
            button.appendChild(img);
        } else if (url) {
            button.appendChild(makeFluentImg({ url: url, c: ch, key: label }, 'ch-fl-img'));
        } else fillEmojiBtn(button, ch);
        return button;
    }
    function paintRecent() {
        if (!recentBox) return;
        recentBox.textContent = '';
        const list = recentGet();
        recentBox.appendChild(el('div', { class: 'ch-emoji-cat ch-emoji-cat--row' },
            el('span', { text: 'RECENTLY USED' }),
            list.length ? el('button', { type: 'button', class: 'ch-emoji-clear', onclick: recentClear }, 'Clear') : null));
        const grid = el('div', { class: 'ch-emoji-grid' });
        list.forEach(function (v) { const b = recentButton(v); if (b) grid.appendChild(b); });
        if (!grid.children.length) { recentBox.appendChild(el('p', { class: 'ch-emoji-empty', text: 'Emoji you use show up here.' })); return; }
        recentBox.appendChild(grid);
    }

    // small icon for a category tab (the Windows 11 picture when we have it)
    function tabIcon(ch) {
        const it = flByChar(ch);
        const wrap = el('span', { class: 'ch-emoji-tabico', 'aria-hidden': 'true' });
        if (it) wrap.appendChild(makeFluentImg(it, 'ch-fl-img')); else wrap.textContent = ch;
        return wrap;
    }
    const TAB_ICON = { emoticons: '😀', people: '👋', things: '🎮', symbols: '✅', 'meme emojis': '😭' };

    function buildPicker() {
        const box = $('chEmoji');
        const search = ensurePickSearch();
        const hadFocus = document.activeElement === search;
        box.textContent = '';
        const tabs = el('div', { class: 'ch-emoji-tabs', role: 'toolbar', 'aria-label': 'Emoji categories' });
        box.appendChild(el('div', { class: 'ch-emoji-search' }, search, tabs));
        pickResults = el('div', { class: 'ch-emoji-results', hidden: true });
        pickMain = el('div', { class: 'ch-emoji-main' });
        box.appendChild(pickResults);
        box.appendChild(pickMain);
        const secs = [];                                       // one entry per section: the tabs jump to them
        recentBox = el('div', { class: 'ch-emoji-recent' });
        pickMain.appendChild(recentBox);
        secs.push({ label: 'Recently used', icon: '🕒', node: recentBox });
        paintRecent();
        const mineAt = pickMain.children.length;
        appendMyEmotes(pickMain);
        secs.push({ label: 'My emotes', icon: '⭐', node: pickMain.children[mineAt] });
        appendSeasonal(pickMain);
        Object.keys(EMOJI).forEach(function (cat) {
            const catHead = el('div', { class: 'ch-emoji-cat', text: cat.toUpperCase() });
            pickMain.appendChild(catHead);
            secs.push({ label: cat, icon: TAB_ICON[cat.toLowerCase()] || '✨', node: catHead });
            const grid = el('div', { class: 'ch-emoji-grid' });
            EMOJI[cat].forEach(function (entry) {
                const custom = typeof entry === 'object' && entry !== null;
                const value = custom ? ':' + entry.name + ':' : entry;
                const label = custom ? (entry.name || 'Custom emoji') : entry;
                const button = el('button', { type: 'button', class: 'ch-emoji-btn' + (custom ? ' is-custom' : ''), 'aria-label': label, title: label, onclick: function () { pickEmoji(value); } });
                if (custom) {
                    const img = el('img', { src: entry.image, alt: label, loading: 'lazy' });
                    img.onerror = function () { button.disabled = true; button.title = label + ' (image unavailable)'; };
                    button.appendChild(img);
                } else { fillEmojiBtn(button, entry); }
                grid.appendChild(button);
            });
            pickMain.appendChild(grid);
        });
        // every standard emoji, as Windows 11 (Fluent 3D) pictures, in categories
        if (FL.ready && FL.groups) {
            FL_GROUPS.forEach(function (g) {
                const items = FL.groups[g.key];
                if (!items || !items.length) return;
                const head = el('div', { class: 'ch-emoji-cat', text: g.label.toUpperCase() });
                pickMain.appendChild(head);
                secs.push({ label: g.label, icon: g.icon, node: head });
                const grid = el('div', { class: 'ch-emoji-grid' });
                items.forEach(function (it) {
                    const b = el('button', { type: 'button', class: 'ch-emoji-btn', 'aria-label': it.n, title: it.n, onclick: function () { pickEmoji(it.c); } });
                    b.appendChild(makeFluentImg(it, 'ch-fl-img'));
                    grid.appendChild(b);
                });
                pickMain.appendChild(grid);
            });
        }
        secs.forEach(function (s) {
            if (!s.node) return;
            tabs.appendChild(el('button', {
                type: 'button', class: 'ch-emoji-tab', title: s.label, 'aria-label': s.label,
                onclick: function () {
                    if (search.value) { search.value = ''; runPickerSearch(); }
                    const reduce = noMotion();
                    s.node.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
                }
            }, tabIcon(s.icon)));
        });
        if (search.value.trim()) runPickerSearch();
        if (hadFocus) search.focus();
    }

    function pickEmoji(e) {
        const sm = /^:([a-z0-9_+-]{1,32}):$/i.exec(e);
        if (!S.pickerFor && sm && SUPER[sm[1].toLowerCase()] && !superGuard()) return;     // super emote: cooldown / one per message
        recentAdd(e);
        if (S.pickerFor) {
            const m = S.byId.get(S.pickerFor);
            S.pickerFor = null;
            $('chEmoji').hidden = true;
            if (m) toggleReaction(m, e);
            return;
        }
        insertIntoComposer(e);
        autosize();
    }

    function toggleEmoji(forMsg) {
        closeGif();
        const box = $('chEmoji');
        const open = !box.hidden && !forMsg;
        S.pickerFor = forMsg ? forMsg.id : null;
        box.hidden = open;
        $('chEmojiBtn').setAttribute('aria-expanded', String(!box.hidden));
        if (!box.hidden) {
            paintRecent();
            paintSuperCd();
            box.scrollTop = 0;
            refreshEmotes(false);                            // pick up emotes just bought in the store
            if (pickSearch && !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) pickSearch.focus();
        }
    }

    /* ----------------------------------------------------------------------
       9b. GIFS (GIPHY)
       A GIF is sent as a normal message whose whole body is one GIPHY media
       link. Every client turns that link into an <img>, so no database change
       is needed. Only giphy.com media hosts are ever rendered as images.
       ---------------------------------------------------------------------- */
    const GIPHY_KEY = String(window.GIPHY_API_KEY || '').trim();
    const GIPHY_READY = !!GIPHY_KEY && !/^PASTE_/i.test(GIPHY_KEY);
    const GIF = { q: '', offset: 0, loading: false, done: false, heights: [0, 0], seq: 0, timer: null };

    // returns a clean https GIPHY media url if the whole body is exactly one, else null
    function gifMediaUrl(body) {
        const t = String(body || '').trim();
        if (!/^https:\/\/[^\s]+$/i.test(t)) return null;
        try {
            const u = new URL(t);
            if (/^(?:media\d*|i)\.giphy\.com$/i.test(u.hostname) && /\.(?:gif|webp)$/i.test(u.pathname)) return t;
        } catch (e) { /* not a url */ }
        return null;
    }

    function makeGifView(url) {
        const img = el('img', { class: 'ch-gif-img', src: url, alt: 'GIF', loading: 'lazy', referrerpolicy: 'no-referrer' });
        const link = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'ch-gif-link', 'aria-label': 'Open GIF' }, img);
        img.onerror = function () { link.replaceWith(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'ch-link', text: 'GIF unavailable, open link' })); };
        return link;
    }

    function gifStatus(text) { $('chGifStatus').textContent = text || ''; }

    function giphyFetch(q, offset) {
        const p = new URLSearchParams({ api_key: GIPHY_KEY, limit: '24', offset: String(offset || 0), rating: 'pg-13', lang: 'en' });
        if (q) p.set('q', q);
        return fetch('https://api.giphy.com/v1/gifs/' + (q ? 'search' : 'trending') + '?' + p.toString())
            .then(function (r) { if (!r.ok) throw new Error('giphy ' + r.status); return r.json(); });
    }

    function gifReset(q) {
        GIF.q = q; GIF.offset = 0; GIF.done = false; GIF.loading = false; GIF.heights = [0, 0]; GIF.seq++;
        const cols = $('chGifCols').children;
        cols[0].textContent = ''; cols[1].textContent = '';
        $('chGifBody').scrollTop = 0;
        gifStatus('');
        gifLoad(false);
    }

    function gifAdd(r) {
        const im = r.images || {};
        const prev = im.fixed_width_small || im.fixed_width || im.downsized;
        const send = im.downsized || im.fixed_width || prev;
        if (!prev || !send || !/^https:\/\//i.test(prev.url || '')) return;
        const clean = String(send.url || '').split('?')[0];     // drop tracking params, keeps the message short
        if (!gifMediaUrl(clean)) return;
        const w = Number(prev.width) || 1, h = Number(prev.height) || 1;
        const col = GIF.heights[0] <= GIF.heights[1] ? 0 : 1;
        GIF.heights[col] += h / w + 0.02;
        const label = r.title || 'GIF';
        const img = el('img', { src: prev.url, alt: label, loading: 'lazy', referrerpolicy: 'no-referrer' });
        const btn = el('button', { type: 'button', class: 'ch-gif-item', title: label, 'aria-label': 'Send GIF: ' + label, onclick: function () { pickGif(clean); } }, img);
        btn.style.aspectRatio = w + ' / ' + h;
        img.onerror = function () { btn.remove(); };
        $('chGifCols').children[col].appendChild(btn);
    }

    async function gifLoad(more) {
        if (GIF.loading || (more && GIF.done)) return;
        if (!GIPHY_READY) { gifStatus('GIFs are not set up yet. Add your GIPHY API key in chats.html.'); return; }
        const seq = GIF.seq;
        GIF.loading = true;
        gifStatus('Loading GIFs...');
        try {
            const data = await giphyFetch(GIF.q, GIF.offset);
            if (seq !== GIF.seq) return;
            const list = data.data || [];
            list.forEach(gifAdd);
            const pg = data.pagination || {};
            GIF.offset = (pg.offset || GIF.offset) + (pg.count || list.length);
            if (!list.length || (pg.total_count && GIF.offset >= pg.total_count)) GIF.done = true;
            const any = $('chGifCols').querySelector('.ch-gif-item');
            gifStatus(any ? '' : 'No GIFs found. Try another word.');
        } catch (err) {
            if (seq !== GIF.seq) return;
            gifStatus('Could not load GIFs. Check your connection or GIPHY key.');
        } finally {
            if (seq === GIF.seq) GIF.loading = false;
        }
    }

    function closeGif() {
        const box = $('chGif');
        if (box) box.hidden = true;
        const btn = $('chGifBtn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    function toggleGif() {
        const box = $('chGif');
        if (!box.hidden) { closeGif(); return; }
        $('chEmoji').hidden = true; $('chEmojiBtn').setAttribute('aria-expanded', 'false');
        closeDev(); closeQuick();
        box.hidden = false;
        $('chGifBtn').setAttribute('aria-expanded', 'true');
        if (!$('chGifCols').querySelector('.ch-gif-item') && !GIF.loading) gifReset($('chGifSearch').value.trim());
        if (!(window.matchMedia && matchMedia('(pointer: coarse)').matches)) $('chGifSearch').focus();
    }

    function pickGif(url) {
        closeGif();
        sendGif(url);
    }

    async function sendGif(url) {
        if (!S.current || S.sending || !gifMediaUrl(url)) return;
        if (S.editing) { toast('Finish editing first, then send a GIF.'); return; }
        if (S.pendingFile) { toast('Remove the attached file first, then send a GIF.'); return; }
        const input = $('chInput');
        const draft = input.value;            // keep whatever they were typing
        input.value = url;
        autosize();
        try { await sendMessage(); }
        finally { input.value = draft; autosize(); }
    }

    function wireGif() {
        $('chGifBtn').addEventListener('click', function (e) { e.stopPropagation(); toggleGif(); });
        $('chGifSearch').addEventListener('input', function (e) {
            const v = e.target.value.trim();
            clearTimeout(GIF.timer);
            GIF.timer = setTimeout(function () { if (v !== GIF.q) gifReset(v); }, 350);
        });
        $('chGifBody').addEventListener('scroll', function () {
            const b = $('chGifBody');
            if (b.scrollTop + b.clientHeight >= b.scrollHeight - 160) gifLoad(true);
        });
        document.addEventListener('click', function (e) {
            const box = $('chGif');
            if (!box.hidden && !box.contains(e.target) && !$('chGifBtn').contains(e.target)) closeGif();
        });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeGif(); });
    }

    let quickEl = null;
    function closeQuick() { if (quickEl) quickEl.hidden = true; }

    // one quick-reaction entry -> what to show and what to send.
    //   '😭'                          normal emoji (shown as the Windows 11 picture)
    //   ':sob:'                        any shortcode: your own emoji from chat-emoji.js, or one of the 1,600+ standard ones
    //   { name: 'x', image: '...' }    a brand new emoji with your own picture / link
    function resolveQuick(entry) {
        if (entry && typeof entry === 'object') {
            const k = String(entry.name || '').toLowerCase();
            return CUSTOM_EMOJI[k] ? { value: ':' + k + ':', label: k, url: CUSTOM_EMOJI[k], ch: null } : null;
        }
        const str = String(entry == null ? '' : entry).trim();
        if (!str) return null;
        const m = /^:([a-z0-9_+-]{1,32}):$/i.exec(str);
        if (!m) return { value: str, label: str, url: null, ch: str };
        const k = m[1].toLowerCase();
        if (CUSTOM_EMOJI[k]) return { value: ':' + k + ':', label: k, url: CUSTOM_EMOJI[k], ch: null };
        const it = flByCode(k);
        return it ? { value: it.c, label: it.n, url: it.url, ch: it.c } : null;      // a standard emoji is sent as the real emoji
    }

    function openQuick(m, btn) {
        if (!quickEl) {
            quickEl = el('div', { class: 'ch-quick', role: 'menu', hidden: true });
            document.body.appendChild(quickEl);
        }
        quickEl.textContent = '';
        QUICK.forEach(function (entry) {
            const q = resolveQuick(entry);
            if (!q) return;                                   // unknown :name: -> skipped, never a broken button
            const qb = el('button', { type: 'button', class: 'ch-quick-btn', role: 'menuitem', 'aria-label': 'React ' + q.label, title: q.label, onclick: function () { closeQuick(); toggleReaction(m, q.value); } });
            if (q.url) {
                const img = el('img', { class: 'ch-fl-img', src: q.url, alt: q.label, draggable: 'false' });
                img.addEventListener('error', function () { img.replaceWith(document.createTextNode(q.ch || ':' + q.label + ':')); });
                qb.appendChild(img);
            } else fillEmojiBtn(qb, q.ch);
            quickEl.appendChild(qb);
        });
        quickEl.appendChild(el('button', { type: 'button', class: 'ch-quick-btn ch-quick-more', 'aria-label': 'More emoji', onclick: function () { closeQuick(); toggleEmoji(m); } }, icon('plus')));
        quickEl.hidden = false;
        const r = btn.getBoundingClientRect();
        const w = quickEl.offsetWidth || 260, h = quickEl.offsetHeight || 48;
        const vw = document.documentElement.clientWidth || window.innerWidth;
        quickEl.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), Math.max(8, vw - w - 8)) + 'px';
        quickEl.style.top = Math.max(8, r.top - h - 8) + 'px';
    }

    /* ----------------------------------------------------------------------
       10. REALTIME (live updates, typing, who is online)
       ---------------------------------------------------------------------- */
    let wasDown = false;
    function onGlobalStatus(status) {
        if (status === 'SUBSCRIBED') { if (wasDown) { wasDown = false; resync(); } }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') wasDown = true;
    }

    let rxTimer = null, roomsTimer = null;
    function refreshReactionsSoon() { clearTimeout(rxTimer); rxTimer = setTimeout(refreshAllReactions, 250); }
    function refreshRoomsSoon() { clearTimeout(roomsTimer); roomsTimer = setTimeout(function () { resync({ light: true }); }, 400); }

    function subscribeGlobal() {
        const uid = S.me.id;
        S.globalCh = sb.channel('specsoft-chat-' + uid)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, function (p) { onMsgInsert(p.new); })
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, function (p) { onMsgUpdate(p.new); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, function (p) {
                // DELETE events only carry the row id, so when we cannot tell which message it was we re-check the open chat
                const row = p.new && p.new.message_id ? p.new : (p.old && p.old.message_id ? p.old : null);
                if (row) refreshReactions(row.message_id); else refreshReactionsSoon();
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_inbox', filter: 'user_id=eq.' + uid }, function (p) { onInboxInsert(p.new); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_invites', filter: 'invited_user_id=eq.' + uid }, function () {
                loadInvites().then(function () { if (S.nav === 'invites') renderList(); }).catch(function () {});
            })
            // people joining / leaving / being removed: member counts, new chats, "you were removed"
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members' }, function () { refreshRoomsSoon(); })
            // a streak grew, broke, was restored or hit a milestone
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_streaks' }, function () { loadStreaksSoon(); })
            // pin / mute / nickname changed from another device
            .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_prefs', filter: 'user_id=eq.' + uid }, function () { refreshRoomsSoon(); })
            .subscribe(onGlobalStatus);
    }

    function onInboxInsert(row) {
        if (!row) return;
        const name = S.profile && S.profile.username;
        const relevant = row.kind === 'invite' || (row.from_id !== S.me.id && mentionsUser(row.preview, name));
        if (!relevant) return;                    // plain messages are handled by onMsgInsert
        loadInbox().then(function () { if (S.nav === 'inbox') renderList(); }).catch(function () {});
        if (row.kind === 'invite') {
            loadInvites().then(function () {
                if (S.nav === 'invites') renderList();
                const inv = S.invites.find(function (i) { return i.room_id === row.room_id; });
                const who = inv ? (inv.invited_by_display || inv.invited_by_username || 'Someone') : 'Someone';
                pushNotice({ key: 'invite-' + row.room_id, title: 'New invite', text: who + ' invited you to ' + (inv && inv.room_name || 'a chat'), icon: (inv && inv.room_icon) || '💌', onOpen: function () { setNav('invites'); } });
            }).catch(function () {});
        }
    }

    async function onMsgInsert(m) {
        if (!m || S.byId.has(m.id)) return;
        const room = S.roomMap.get(m.room_id);
        const mine = m.sender_id === S.me.id;

        if (!room) {
            // a chat we do not have yet: a brand new DM, or a closed DM that just woke up
            try { await loadRooms(); } catch (e) { return; }
            const fresh = S.roomMap.get(m.room_id);
            renderList();
            if (fresh && !mine) { try { await cacheProfiles([m.sender_id]); } catch (e) { /* ignore */ } notifyMessage(fresh, m); }
            return;
        }

        if (window.SPCH && SPCH.onMessage(room, m, mine)) return;     // community: other channel / silenced
        room.last_body = m.body; room.last_at = m.created_at; room.last_sender = m.sender_id;
        const here = !!(S.current && S.current.room_id === m.room_id);
        clearTyping(m.room_id, m.sender_id);

        if (here) {
            if (mine && S.messages.some(function (x) { return x.pending; })) { bumpRoom(room); return; }   // the send call will place it
            try { await cacheProfiles([m.sender_id]); } catch (e) { /* ignore */ }
            if (S.byId.has(m.id)) return;
            const row = Object.assign({}, m, { sender: S.profiles.get(m.sender_id), reactions: [] });
            if (row.reply_to) { try { await fetchParents([row]); } catch (e) { /* ignore */ } }
            const wasBottom = S.atBottom || atBottomNow();
            addToState(row);
            appendMessage(row);
            if (!mine && !document.hidden) {                       // somebody sent a super emote: play it (only live ones, never old history)
                const sc = superCodesIn(row.body);
                if (sc.length && Date.now() - new Date(row.created_at).getTime() < 20000) playSuper(row.id, sc[0]);
            }
            if (wasBottom && !document.hidden) { scrollToBottom(); markRead(room.room_id); }
            else if (!mine) { S.newCount++; S.atBottom = false; paintJump(); room.unread++; updateBadges(); }
            if (!mine) {
                if (document.hidden || !document.hasFocus()) notifyMessage(room, row);
                else if (!wasBottom) ping();
            }
        } else if (!mine) {
            room.unread++;
            try { await cacheProfiles([m.sender_id]); } catch (e) { /* ignore */ }
            notifyMessage(room, m);
        }
        bumpRoom(room);
        updateBadges();
    }

    function onMsgUpdate(m) {
        if (!m) return;
        const have = S.byId.get(m.id);
        if (have) {
            have.body = m.body; have.edited_at = m.edited_at; have.deleted_at = m.deleted_at;
            have.attachment_path = m.attachment_path;
            have.attachment_name = m.attachment_name;
            have.attachment_type = m.attachment_type;
            have.attachment_size = m.attachment_size;
            if (have.deleted_at) have.reactions = [];
            rebuildNode(have);
        }
        const room = S.roomMap.get(m.room_id);
        if (room && room.last_at === m.created_at && m.deleted_at) { room.last_body = ''; renderList(); }
    }

    function joinRoomChannel(roomId) {
        const topic = 'specsoft-room-' + roomId;
        if (S.roomCh) { try { sb.removeChannel(S.roomCh); } catch (e) { /* ignore */ } S.roomCh = null; }

        const ch = sb.channel(topic, { config: { presence: { key: S.me.id }, broadcast: { self: false } } });
        S.roomCh = ch;

        ch.on('presence', { event: 'sync' }, function () {
            const st = ch.presenceState ? ch.presenceState() : {};
            S.online = new Set(Object.keys(st));
            paintOnline();
            if (!$('chMembers').hidden) paintMembers();
        });
        ch.on('broadcast', { event: 'typing' }, function (msg) {
            const p = msg && msg.payload;
            if (!p || p.uid === S.me.id) return;
            if (window.SPCH && !SPCH.typingOk(p.ch)) return;       // typing in another channel / post of this community
            setTyping(roomId, p.uid, p.name, p.txt);
        });
        ch.on('broadcast', { event: 'seen' }, function (msg) {
            const p = msg && msg.payload;
            if (!p || p.uid === S.me.id || p.room !== roomId || !receiptsOn()) return;
            noteSeen(p.uid, Number(p.upto));
        });
        ch.subscribe(function (status) {
            if (status === 'SUBSCRIBED') {
                if (ch.track) ch.track({ uid: S.me.id, name: nameOf(S.profile) });
                S.roomChReady = roomId;
                broadcastSeen(roomId);                       // tell the others how far I have read
            }
        });
    }

    function leaveRoomChannel() {
        if (S.roomCh) { try { sb.removeChannel(S.roomCh); } catch (e) { /* ignore */ } }
        S.roomCh = null;
        S.roomChReady = null;
        S.online = new Set();
        paintTyping();
    }

    // ----- typing: per room, shown in the chat, the header and the chat list -----
    // custom typing text (Settings > Chats). It comes from another person's device, so it is cleaned again here
    // Strict on purpose: max 25 characters, only <@username> for < > @, nothing rude, suggestive or harmful, no links.
    // The check lives in site-settings.js. If it is not loaded yet, the custom text is simply not used (normal "is typing").
    function cleanTyping(t) {
        if (typeof t !== 'string' || !t) return '';
        const SS = window.SpecSettings;
        if (!SS || typeof SS.typingCheck !== 'function') return '';
        const r = SS.typingCheck(t);
        return r && r.ok ? r.text : '';
    }
    function myTypingText() {
        try { return cleanTyping(String((window.SpecSettings && window.SpecSettings.get('typingText')) || '')); } catch (e) { return ''; }
    }

    function setTyping(roomId, uid, name, txt) {
        const room = S.roomMap.get(roomId);
        if (!room || room.blocked_by_me) return;
        let m = S.tl.get(roomId);
        if (!m) { m = new Map(); S.tl.set(roomId, m); }
        m.set(uid, { name: name || 'Someone', txt: cleanTyping(txt), until: Date.now() + 3500 });
        tickTyping();
    }

    function clearTyping(roomId, uid) {
        const m = S.tl.get(roomId);
        if (m) { m.delete(uid); if (!m.size) S.tl.delete(roomId); }
        tickTyping();
    }

    function typersOf(roomId) {
        const m = S.tl.get(roomId);
        if (!m) return [];
        const now = Date.now(), out = [];
        m.forEach(function (v, k) { if (v.until < now) m.delete(k); else out.push(v); });
        if (!m.size) S.tl.delete(roomId);
        return out;
    }

    function activeTyping(roomId) {
        return typersOf(roomId).map(function (v) { return v.name; });
    }

    // The pill under the messages. It is only rebuilt when its words change, so the dots keep bouncing smoothly
    // (it used to be rebuilt every second, which restarted the animation).
    let typingSig = '', typingLeave = null;
    function shortName(n) { n = String(n || 'Someone'); return n.length > 20 ? n.slice(0, 19) + '\u2026' : n; }

    function typingLine(r, typers) {
        // one person with a custom indicator: show theirs (also hidden if your sensitive filter dislikes it)
        if (typers.length === 1 && typers[0].txt && !(S.filterOn && isSensitive(typers[0].txt))) {
            const who = r.kind === 'dm' ? roomTitle(r) : typers[0].name;
            return { text: typers[0].txt.replace(/<@username>/gi, shortName(who)).slice(0, 80), custom: true };
        }
        if (r.kind === 'dm') return { text: shortName(roomTitle(r)) + ' is typing', custom: false };
        const n = typers.map(function (v) { return shortName(v.name); });
        if (n.length === 1) return { text: n[0] + ' is typing', custom: false };
        if (n.length === 2) return { text: n[0] + ' and ' + n[1] + ' are typing', custom: false };
        if (n.length === 3) return { text: n[0] + ', ' + n[1] + ' and ' + n[2] + ' are typing', custom: false };
        return { text: n[0] + ', ' + n[1] + ' and ' + (n.length - 2) + ' others are typing', custom: false };
    }

    function paintTyping() {
        const box = $('chTyping');
        const r = S.current;
        const typers = r ? typersOf(r.room_id) : [];
        paintSub();
        const line = typers.length ? typingLine(r, typers) : null;
        const sig = line ? (line.custom ? 'c|' : 'd|') + line.text : '';
        if (sig === typingSig && (!sig || box.firstChild)) return;      // same words: leave the dots alone
        typingSig = sig;
        clearTimeout(typingLeave);
        if (!line) {
            const old = box.firstChild;
            if (!old) return;
            old.classList.add('is-leaving');                            // fade out, then remove
            typingLeave = setTimeout(function () { if (!typingSig) box.textContent = ''; }, 180);
            return;
        }
        box.textContent = '';
        box.appendChild(el('div', { class: 'ch-typing-pill' + (line.custom ? ' is-custom' : '') },
            el('span', { class: 'ch-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
            el('span', { class: 'ch-typing-text', text: line.text })));
    }

    // the chat list is repainted in place so a hover or an open menu is never disturbed
    function paintListTyping() {
        document.querySelectorAll('#chListBody .ch-item[data-room]').forEach(function (b) {
            const sub = b.querySelector('.ch-item-sub');
            if (!sub) return;
            const rid = b.dataset.room;
            if (activeTyping(rid).length) {
                if (b.dataset.typing !== '1') { b.dataset.typing = '1'; sub.textContent = 'typing…'; sub.classList.add('is-typing'); }
            } else if (b.dataset.typing === '1') {
                delete b.dataset.typing;
                sub.classList.remove('is-typing');
                const r = S.roomMap.get(rid);
                sub.textContent = r ? subText(r) : '';
            }
        });
    }

    function tickTyping() { paintTyping(); paintListTyping(); }

    let lastTypingSent = 0;
    function sendTyping() {
        const room = S.current;
        if (!room) return;
        const now = Date.now();
        if (now - lastTypingSent < 2500) return;
        try {
            if (room.kind === 'dm') {
                if (!room.other_id || room.blocked_by_me || room.blocked_me) return;
                const c = outChannel(room.other_id);
                if (c.state !== 'joined') return;
                lastTypingSent = now;
                c.send({ type: 'broadcast', event: 'typing', payload: { room: room.room_id, uid: S.me.id, name: nameOf(S.profile), txt: myTypingText() } });
            } else if (S.roomCh) {
                lastTypingSent = now;
                S.roomCh.send({ type: 'broadcast', event: 'typing', payload: { uid: S.me.id, name: nameOf(S.profile), txt: myTypingText(), ch: window.SPCH ? SPCH.typingKey() : null } });
            }
        } catch (e) { /* ignore */ }
    }

    // personal channel: DMs can show "typing…" in your list even when that chat is not open
    function subscribeUser() {
        try {
            S.userCh = sb.channel('specsoft-user-' + S.me.id, { config: { broadcast: { self: false } } })
                .on('broadcast', { event: 'typing' }, function (msg) {
                    const p = msg && msg.payload;
                    if (!p || !p.room || !p.uid || p.uid === S.me.id) return;
                    const room = S.roomMap.get(p.room);
                    if (!room || room.kind !== 'dm' || room.other_id !== p.uid) return;
                    setTyping(p.room, p.uid, p.name, p.txt);
                })
                .subscribe();
        } catch (e) { /* typing in the list is a bonus */ }
    }

    function outChannel(otherId) {
        let c = S.outCh.get(otherId);
        if (!c) {
            if (S.outCh.size >= 8) {
                const oldest = S.outCh.keys().next().value;
                try { sb.removeChannel(S.outCh.get(oldest)); } catch (e) { /* ignore */ }
                S.outCh.delete(oldest);
            }
            c = sb.channel('specsoft-user-' + otherId, { config: { broadcast: { self: false } } });
            c.subscribe();
            S.outCh.set(otherId, c);
        }
        return c;
    }

    // global presence: green dot on DMs when the other person is online
    function subscribePresence() {
        try {
            const ch = sb.channel('specsoft-online', { config: { presence: { key: S.me.id } } });
            S.presCh = ch;
            ch.on('presence', { event: 'sync' }, function () {
                const st = ch.presenceState ? ch.presenceState() : {};
                S.onlineAll = new Set(Object.keys(st));
                paintListPresence();
                paintSub();
                refreshStatuses();
            }).subscribe(function (status) {
                if (status === 'SUBSCRIBED' && ch.track) ch.track({ at: Date.now() });
            });
            setInterval(function () { refreshStatuses(); paintListPresence(); paintSub(); }, 60000);      // pick up status changes (someone going Do Not Disturb)
        } catch (e) { /* presence is a bonus */ }
    }

    // ----- status dots: same states and icons as the profile page (active / idle / do not disturb / offline) -----
    // Presence says IF someone is here; the saved profile status says WHICH status they chose to show.
    const ST_META = { online: 'Active', dnd: 'Do not disturb', idle: 'Idle', offline: 'Offline' };
    const ST_SUB = { online: 'Online', dnd: 'Do not disturb', idle: 'Idle' };
    const statusMap = new Map();      // userId -> saved status
    const statusAt = new Map();       // userId -> when we last asked

    function stIcon(s) {
        switch (s) {
            case 'dnd':
                return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="#f23f43"/><rect class="ch-dnd-bar" x="4.5" y="8.4" width="11" height="3.2" rx="1.6"/></svg>';
            case 'idle':
                return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#f0b232"/></svg>';
            case 'offline':
                return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="#80848e"/></svg>';
            default:
                return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="10" fill="#23a55a"/></svg>';
        }
    }

    function stateOf(userId, live) {
        if (!userId || !live) return 'offline';
        const saved = statusMap.get(userId);
        if (saved === 'dnd' || saved === 'idle' || saved === 'offline') return saved;    // 'offline' = chose to appear offline
        return 'online';
    }

    function stDot(userId, live, cls) {
        const s = stateOf(userId, live);
        const i = el('i', { class: 'ch-st ' + (cls || ''), title: ST_META[s], role: 'img', 'aria-label': ST_META[s] });
        i.dataset.st = s;
        i.innerHTML = stIcon(s);
        return i;
    }

    // ----- custom status (text, thumbnail, music, expiry) -----
    const CS_COLS_V5 = 'id,status,status_text,status_expires_at,status_thumb_path,status_music_title,status_music_artist';
    const CS_COLS_V6 = CS_COLS_V5 + ',status_music_url,status_music_art,status_music_start';
    const CS_COLS_V7 = CS_COLS_V6 + ',status_music_path';
    let csCols = CS_COLS_V7;         // steps down if supabase-chat-status-music.sql / supabase-chat-status.sql has not been run
    const CS_CLIP = 30;              // use the full 30 second iTunes preview as the selectable clip
    const csMap = new Map();         // userId -> { text, until, thumb, mt, ma }
    let csReady = true;              // false until supabase-chat-status.sql has been run

    function applyStatusRow(r) {
        let changed = false;
        if (statusMap.get(r.id) !== r.status) { statusMap.set(r.id, r.status); changed = true; }
        if (csReady) {
            const mu = csMusicUrlOk(r.status_music_url) ? r.status_music_url : '';
            const mp = csAudioPathOk(r.status_music_path) ? r.status_music_path : '';
            const c = (r.status_text || r.status_thumb_path || r.status_music_title) ? {
                text: r.status_text || '', until: r.status_expires_at ? new Date(r.status_expires_at).getTime() : 0,
                thumb: r.status_thumb_path || '', mt: r.status_music_title || '', ma: r.status_music_artist || '',
                mu: mp ? '' : mu, art: (mu && !mp && csArtUrlOk(r.status_music_art)) ? r.status_music_art : '', ms: (mu && !mp) ? (Number(r.status_music_start) || 0) : 0, mp: mp
            } : null;
            const before = csMap.get(r.id);
            if (JSON.stringify(before || null) !== JSON.stringify(c)) { if (c) csMap.set(r.id, c); else csMap.delete(r.id); changed = true; }
        }
        return changed;
    }

    // the custom status someone is showing right now (an expired one counts as none)
    function csOf(id) {
        const c = id && csMap.get(id);
        if (!c) return null;
        if (c.until && c.until < Date.now()) return null;
        return c;
    }
    function csSig(c) { return c ? [c.text, c.thumb, c.mt, c.ma, c.mu, c.ms, c.mp].join('|') : ''; }

    function csThumbUrl(path) {
        if (!path || !/^[0-9a-f-]{36}\/[\w.-]{1,80}$/i.test(path)) return '';
        try { return sb.storage.from('status-media').getPublicUrl(path).data.publicUrl || ''; } catch (e) { return ''; }
    }

    // ----- status music: iTunes 30 second previews, one shared player so two clips never overlap -----
    function csMusicUrlOk(u) { return /^https:\/\/audio-ssl\.itunes\.apple\.com\/[^\s<>"']{1,500}$/.test(u || ''); }
    function csArtUrlOk(u) { return /^https:\/\/is\d-ssl\.mzstatic\.com\/[^\s<>"']{1,500}$/.test(u || ''); }
    // an uploaded clip: a 30 second WAV in the status-audio bucket, kept as <user id>/<file>
    function csAudioPathOk(p) { return /^[0-9a-f-]{36}\/[\w.-]{1,80}$/i.test(p || ''); }
    function csAudioBase() {
        try { return sb.storage.from('status-audio').getPublicUrl('x').data.publicUrl.replace(/x$/, ''); } catch (e) { return ''; }
    }
    function csAudioUrl(path) { return csAudioPathOk(path) ? csAudioBase() + path : ''; }
    function csPlayUrl(c) { return c ? (c.mp ? csAudioUrl(c.mp) : c.mu) : ''; }
    // only Apple previews, clips in our own bucket, and (inside the dialog) the file you just picked
    function csPlayable(key, url) {
        if (csMusicUrlOk(url)) return true;
        if (key === 'draft' && /^blob:/.test(url || '')) return true;
        const base = csAudioBase();
        return !!base && (url || '').indexOf(base) === 0 && csAudioPathOk((url || '').slice(base.length));
    }
    function csClock(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

    const csAudio = new Audio();
    csAudio.preload = 'auto';        // the source is only set when someone presses play
    let csDraftDur = 30;             // length of the song being previewed in the dialog, for the playhead
    let csNow = null;                // { key, start }  key is a user id, or 'draft' for the preview inside the status dialog

    function csSyncPlay() {
        document.querySelectorAll('.ch-cs-play, #stMusPlay').forEach(function (b) {
            const on = !!csNow && csNow.key === b.dataset.key && !csAudio.paused;
            b.classList.toggle('is-playing', on);
            b.setAttribute('aria-pressed', String(on));
            const i = b.querySelector('.ch-cs-play-ico');
            if (i) i.innerHTML = ICON[on ? 'pause' : 'play'];
        });
        const head = $('stMusHead');
        if (head) {
            const draft = !!csNow && csNow.key === 'draft' && !csAudio.paused;
            head.classList.toggle('is-on', draft);
            if (draft) head.style.left = Math.min(99, (csAudio.currentTime / csDraftDur) * 100) + '%';
        }
    }

    function csStop() {
        csAudio.pause();
        csNow = null;
        csSyncPlay();
    }

    function csPlayErrorDetail(err, url) {
        const bits = [];
        const audioErr = csAudio && csAudio.error ? csAudio.error : null;
        if (err && (err.name || err.message)) bits.push(err.name || 'Error');
        if (err && err.message) bits.push(String(err.message));
        if (audioErr && typeof audioErr.code === 'number') bits.push('mediaErrorCode=' + audioErr.code);
        if (audioErr && audioErr.message) bits.push(String(audioErr.message));
        const host = url ? url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] : 'unknown host';
        bits.push('host=' + host);
        return bits.filter(Boolean).slice(0, 4).join(' | ');
    }

    function csPlayFail(msgKey, err, url) {
        const detail = csPlayErrorDetail(err, url);
        const text = 'This clip is not playable in this browser or the link is dead. Pick a different song or save the status without music. Details: ' + detail + '.';
        toast(text);
        if (csNow && csNow.key === msgKey) csStop();
        csAudio.src = '';
    }

    function csPlay(key, url, start) {
        if (!csPlayable(key, url)) return;
        if (csNow && csNow.key === key && !csAudio.paused) { csStop(); return; }
        csAudio.pause();
        csNow = { key: key, start: Math.max(0, Math.min(30, Number(start) || 0)) };
        const startClip = function () {
            if (!csNow) return;
            try { csAudio.currentTime = csNow.start; } catch (e) { /* ignore */ }
            try {
                const p = csAudio.play();
                if (p && p.catch) p.catch(function (err) { csPlayFail(key, err, url); });
            } catch (e) {
                csPlayFail(key, e, url);
            }
            csSyncPlay();
        };
        if (csAudio.src !== url) csAudio.src = url;
        else if (csAudio.readyState === 0) csAudio.load();
        if (csAudio.readyState >= 1) startClip();
        else {
            csAudio.load();
            startClip();
        }
        csSyncPlay();
    }

    // loop inside the chosen part of the preview
    csAudio.addEventListener('timeupdate', function () {
        if (!csNow) return;
        if (csAudio.currentTime >= csNow.start + CS_CLIP) csAudio.currentTime = csNow.start;
        const head = $('stMusHead');
        if (head && csNow.key === 'draft') head.style.left = Math.min(99, (csAudio.currentTime / csDraftDur) * 100) + '%';
    });
    csAudio.addEventListener('ended', function () {
        if (!csNow) return;
        csAudio.currentTime = csNow.start;
        const p = csAudio.play();
        if (p && p.catch) p.catch(function (err) {
            csPlayFail(csNow && csNow.key, err, csAudio.currentSrc || '');
        });
    });
    csAudio.addEventListener('error', function () {
        if (!csNow) return;
        const detail = csPlayErrorDetail(null, csAudio.currentSrc || '');
        const key = csNow && csNow.key;
        toast('Status music failed to load. Details: ' + detail + '.');
        csStop();
    });
    csAudio.addEventListener('pause', csSyncPlay);
    csAudio.addEventListener('play', csSyncPlay);
    document.addEventListener('visibilitychange', function () { if (document.hidden && csNow) csStop(); });

    function csNode(id, cls) {
        const c = csOf(id);
        if (!c) return null;
        const url = csThumbUrl(c.thumb);
        const node = el('span', { class: 'ch-cs ' + (cls || '') });
        node.dataset.sig = csSig(c);
        if (url) {
            const img = el('img', { class: 'ch-cs-thumb', src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
            img.addEventListener('error', function () { img.remove(); });
            node.appendChild(img);
        }
        if (c.text) node.appendChild(el('span', { class: 'ch-cs-text', text: c.text }));
        const pUrl = csPlayUrl(c);
        if (pUrl && id) {
            const go = function (e) { e.stopPropagation(); e.preventDefault(); csPlay(id, pUrl, c.ms); };
            const play = el('span', { class: 'ch-cs-play' + (c.art ? '' : ' ch-cs-play--noart'), role: 'button', tabindex: '0', 'aria-pressed': 'false', 'aria-label': 'Play a clip of ' + c.mt, title: 'Play a clip', onclick: go });
            play.dataset.key = id;
            play.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') go(e); });
            if (c.art) {
                const art = el('img', { src: c.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
                art.addEventListener('error', function () { art.remove(); });
                play.appendChild(art);
            }
            const ico = el('span', { class: 'ch-cs-play-ico' });
            ico.innerHTML = ICON.play;
            play.appendChild(ico);
            node.appendChild(play);
            if (csNow) setTimeout(csSyncPlay, 0);
        }
        if (c.mt) node.appendChild(el('span', { class: 'ch-cs-music', text: '\u266A ' + c.mt + (c.ma ? ' - ' + c.ma : '') }));
        return node;
    }

    function paintHeaderCs() {
        const p = $('chRoomCs');
        if (!p) return;
        const r = S.current;
        const c = (r && r.kind === 'dm' && !r.blocked_by_me) ? csOf(r.other_id) : null;
        const sig = (r && c ? r.other_id : '') + '#' + csSig(c);
        if (p.dataset.sig === sig) return;
        p.dataset.sig = sig;
        p.textContent = '';
        p.hidden = !c;
        if (c) p.appendChild(csNode(r.other_id, 'ch-head-cs'));
    }

    // select profile columns, stepping down if the SQL files have not all been run yet
    async function csSelect(build) {
        let res = await build(csCols);
        if (!res.error || !csReady) return res;
        const levels = [CS_COLS_V7, CS_COLS_V6, CS_COLS_V5, 'id,status'];
        const steps = levels.slice(levels.indexOf(csCols) + 1);
        for (let i = 0; i < steps.length; i++) {
            const r = await build(steps[i]);
            if (!r.error) { csCols = steps[i]; if (steps[i] === 'id,status') csReady = false; return r; }
        }
        return res;
    }

    async function loadStatuses(ids) {
        const now = Date.now();
        const need = Array.from(new Set((ids || []).filter(Boolean))).filter(function (id) { return now - (statusAt.get(id) || 0) > 45000; });
        if (!need.length) return;
        need.forEach(function (id) { statusAt.set(id, now); });
        try {
            const res = await csSelect(function (cols) { return sb.from('profiles').select(cols).in('id', need.slice(0, 200)); });
            if (res.error) return;
            let changed = false;
            (res.data || []).forEach(function (r) { if (applyStatusRow(r)) changed = true; });
            if (changed) repaintStatus();
        } catch (e) { /* status dots are a bonus */ }
    }

    function refreshStatuses() {
        const ids = [];
        (S.rooms || []).forEach(function (r) { if (r.kind === 'dm' && r.other_id) ids.push(r.other_id); });
        (S.members || []).forEach(function (m) { ids.push(m.user_id); });
        loadStatuses(ids);
    }

    function repaintStatus() {
        paintListPresence();
        paintSub();
        if ($('chMembers') && !$('chMembers').hidden) paintMembers();
    }

    function paintListPresence() {
        document.querySelectorAll('#chListBody .ch-row[data-row]').forEach(function (row) {
            const r = S.roomMap.get(row.dataset.row);
            if (!r || r.kind !== 'dm') return;
            const av = row.querySelector('.ch-item-av');
            if (!av) return;
            const dot = av.querySelector('.ch-st');
            if (r.blocked_by_me) { if (dot) dot.remove(); return; }
            const live = S.onlineAll.has(r.other_id);
            const s = stateOf(r.other_id, live);
            if (!dot) av.appendChild(stDot(r.other_id, live, 'ch-item-st'));
            else if (dot.dataset.st !== s) dot.replaceWith(stDot(r.other_id, live, 'ch-item-st'));

            const main = row.querySelector('.ch-item-main');
            if (main) {
                const old = main.querySelector('.ch-item-cs');
                const want = r.blocked_by_me ? null : csOf(r.other_id);
                if ((old ? old.dataset.sig : '') !== csSig(want)) {
                    if (old) old.remove();
                    if (want) main.appendChild(csNode(r.other_id, 'ch-item-cs'));
                }
            }
        });
    }

    // ----- catch-up: after a dropped connection, a sleeping tab, or as a safety net -----
    async function fetchNewer() {
        const room = S.current;
        if (!room || S.opening) return;
        const real = S.messages.filter(function (m) { return !m.pending; });
        if (!real.length) return;
        const last = real[real.length - 1].created_at;
        let nq = sb.from('chat_messages').select(MSG_SELECT).eq('room_id', room.room_id);
        if (window.SPCH) nq = SPCH.scope(nq, room.room_id);
        const res = await nq.gt('created_at', last).order('created_at', { ascending: true }).limit(100);
        if (res.error || !sameRoom(room)) return;
        const rows = (res.data || []).filter(function (m) { return !S.byId.has(m.id); });
        if (!rows.length) return;
        rows.forEach(function (m) { if (m.sender) S.profiles.set(m.sender_id, m.sender); m.reactions = m.reactions || []; });
        await loadBugStatuses(rows);
        await fetchParents(rows);
        if (!sameRoom(room)) return;
        const wasBottom = S.atBottom || atBottomNow();
        let theirs = 0;
        rows.forEach(function (m) {
            if (S.byId.has(m.id)) return;
            addToState(m); appendMessage(m);
            if (m.sender_id !== S.me.id) theirs++;
        });
        if (wasBottom && !document.hidden) scrollToBottom();
        else if (theirs) { S.newCount += theirs; S.atBottom = false; paintJump(); }
    }

    let syncing = false;
    async function resync(opts) {
        if (syncing || !S.me) return;
        syncing = true;
        try {
            const jobs = [loadRooms()];
            if (!(opts && opts.light)) jobs.push(loadInvites(), loadInbox());
            await Promise.all(jobs);
            if (S.current && !S.roomMap.has(S.current.room_id)) { toast('You are no longer in that chat.'); closeRoom(); return; }
            if (S.current) { paintHeader(); if (!$('chMembers').hidden) refreshMembers(); }
            renderList();
            await fetchNewer();
            if (S.current && S.atBottom && !document.hidden && S.current.unread) markRead(S.current.room_id);
        } catch (e) { /* the next tick tries again */ }
        finally { syncing = false; }
    }

    /* ----------------------------------------------------------------------
       11. MEMBERS DRAWER
       ---------------------------------------------------------------------- */
    function closeMembers() { $('chMembers').hidden = true; }

    async function loadMembers() {
        const rid = S.current.room_id;
        const res = await sb.from('chat_members').select('user_id,role,joined_at,profile:profiles(id,username,display_name,avatar_url)').eq('room_id', rid).order('joined_at', { ascending: true });
        if (res.error) throw res.error;
        if (!S.current || S.current.room_id !== rid) return;      // switched chats while loading
        S.members = res.data || [];
        S.membersRoom = rid;
        S.membersAt = Date.now();
        loadStatuses(S.members.map(function (m) { return m.user_id; }));
    }

    async function openMembers() {
        if (!S.current) return;
        $('chMembers').hidden = false;
        paintAbout();
        $('chMembersTitle').textContent = 'Members';
        $('chMembersList').textContent = '';
        $('chMembersList').appendChild(el('div', { class: 'ch-feed-loading' }, el('div', { class: 'ch-spinner', 'aria-hidden': 'true' })));
        try { await loadMembers(); paintMembers(); }
        catch (err) { $('chMembersList').textContent = friendly(err); }
    }

    async function refreshMembers() {
        if (!S.current || $('chMembers').hidden) return;
        try { await loadMembers(); paintMembers(); } catch (e) { /* ignore */ }
    }

    function paintMembers() {
        const box = $('chMembersList');
        box.textContent = '';
        $('chMembersTitle').textContent = 'Members (' + S.members.length + ')';
        const rank = { owner: 0, admin: 1, member: 2 };
        S.members.slice().sort(function (a, b) {
            const oa = S.online.has(a.user_id) ? 0 : 1, ob = S.online.has(b.user_id) ? 0 : 1;
            return (rank[a.role] - rank[b.role]) || (oa - ob);
        }).forEach(function (mm) {
            const p = mm.profile || {};
            const isMe = mm.user_id === S.me.id;
            const mine = S.current.role;
            const canRemove = !isMe && S.current.kind !== 'dm' && (mine === 'owner' || (mine === 'admin' && mm.role === 'member'));
            box.appendChild(el('div', { class: 'ch-member' },
                el('span', { class: 'ch-member-av' }, avatar(p, 38), stDot(mm.user_id, S.onlineAll.has(mm.user_id) || S.online.has(mm.user_id), 'ch-member-st')),
                el('a', { class: 'ch-member-main', href: p.username ? 'profile.html?u=' + encodeURIComponent(p.username) : '#' },
                    el('strong', { text: nameOf(p) + (isMe ? ' (you)' : '') }),
                    titleSlot(mm.user_id),
                    el('small', { text: '@' + (p.username || 'member') })),
                mm.role !== 'member' ? el('span', { class: 'ch-role', text: mm.role.toUpperCase() }) : null,
                !isMe ? el('button', { type: 'button', class: 'ch-iconbtn', title: 'Message', 'aria-label': 'Message ' + nameOf(p), onclick: function () { startDm(mm.user_id); } }, icon('dm')) : null,
                canRemove ? el('button', { type: 'button', class: 'ch-iconbtn ch-iconbtn--danger', title: 'Remove', 'aria-label': 'Remove ' + nameOf(p), onclick: function () { removeMember(mm, p); } }, icon('trash')) : null));
        });
    }

    async function removeMember(mm, p) {
        if (!window.confirm('Remove ' + nameOf(p) + ' from this chat?')) return;
        try {
            const res = await sb.rpc('chat_remove_member', { p_room: S.current.room_id, p_user: mm.user_id });
            if (res.error) throw res.error;
            S.members = S.members.filter(function (x) { return x.user_id !== mm.user_id; });
            S.current.member_count = Math.max(0, S.current.member_count - 1);
            paintMembers(); paintHeader();
        } catch (err) { toast(friendly(err)); }
    }

    async function leaveRoom() {
        if (!S.current) return;
        if (!window.confirm('Leave "' + roomTitle(S.current) + '"?')) return;
        const id = S.current.room_id;
        try {
            const res = await sb.rpc('chat_leave', { p_room: id });
            if (res.error) throw res.error;
            await loadRooms();
            closeRoom();
            toast('You left the chat');
        } catch (err) { toast(friendly(err)); }
    }

    /* ----------------------------------------------------------------------
       12. ACTIONS: DM, create, join, invites, inbox
       ---------------------------------------------------------------------- */
    async function startDm(userId) {
        try {
            const res = await sb.rpc('chat_start_dm', { p_other: userId });
            if (res.error) throw res.error;
            await loadRooms();
            closeDlg('dmDlg');
            setNavQuiet('mine');
            openRoom(res.data);
        } catch (err) { showBox('dmMsg', friendly(err)); toast(friendly(err)); }
    }

    function setNavQuiet(name) { S.nav = name; S.query = ''; $('chSearch').value = ''; renderList(); }

    async function joinPublic(c, btn) {
        setLoading(btn, true);
        try {
            const res = await sb.rpc('chat_join_public', { p_room: c.room_id });
            if (res.error) throw res.error;
            await loadRooms();
            setNavQuiet('mine');
            openRoom(c.room_id);
        } catch (err) { toast(friendly(err)); setLoading(btn, false); }
    }

    async function respondInvite(i, accept, btn) {
        setLoading(btn, true);
        try {
            const res = await sb.rpc('chat_respond_invite', { p_invite: i.invite_id, p_accept: accept });
            if (res.error) throw res.error;
            await Promise.all([loadInvites(), loadRooms()]);
            renderList();
            if (accept && res.data) { setNavQuiet('mine'); openRoom(res.data); }
            else toast(accept ? 'Joined' : 'Declined');
        } catch (err) { toast(friendly(err)); setLoading(btn, false); }
    }

    async function openInboxItem(i) {
        if (!i.read_at) {
            i.read_at = new Date().toISOString();
            updateBadges();
            sb.from('chat_inbox').update({ read_at: i.read_at }).eq('id', i.id).then(function () {});
        }
        if (i.kind === 'invite') { setNav('invites'); return; }
        if (i.room_id && S.roomMap.has(i.room_id)) { setNavQuiet('mine'); openRoom(i.room_id, { jump: i.message_id }); }
        else { renderList(); toast('You are not in that chat any more.'); }
    }

    async function markAllInboxRead() {
        try {
            const now = new Date().toISOString();
            const res = await sb.from('chat_inbox').update({ read_at: now }).eq('user_id', S.me.id).is('read_at', null);
            if (res.error) throw res.error;
            S.inbox.forEach(function (i) { if (!i.read_at) i.read_at = now; });
            updateBadges(); renderList();
        } catch (err) { toast(friendly(err)); }
    }

    // ---- dialogs ----
    let lastFocus = null;
    function openDlg(id) {
        lastFocus = document.activeElement;
        const dlg = $(id);
        if (typeof dlg.showModal === 'function') dlg.showModal();
        else { dlg.setAttribute('open', ''); dlg.setAttribute('aria-modal', 'true'); }
    }
    function closeDlg(id) { const d = $(id); if (d && d.open) d.close(); }

    function wireDialogs() {
        ['dmDlg', 'roomDlg', 'codeDlg', 'invDlg', 'bugDlg', 'snipDlg', 'nickDlg', 'filterDlg', 'reportDlg', 'settingsDlg', 'statusDlg', 'accountsDlg'].forEach(function (id) {
            const d = $(id);
            d.addEventListener('click', function (e) {
                if (e.target === d || (e.target.closest && e.target.closest('[data-close]'))) {
                    if (typeof d.close === 'function') d.close();
                    else d.removeAttribute('open');
                }
            });
            d.addEventListener('close', function () { if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); });
        });
    }

    // direct message dialog
    let dmTimer = null;
    let dmSearchToken = 0;
    function openDm() {
        showBox('dmMsg', '');
        $('dmSearch').value = '';
        $('dmResults').textContent = '';
        openDlg('dmDlg');
        searchMembers('');
    }

    async function searchMembers(q) {
        const box = $('dmResults');
        const token = ++dmSearchToken;
        q = q.trim().replace(/^@/, '');
        let query = sb.from('profiles').select('id,username,display_name,avatar_url').neq('id', S.me.id);
        if (q) query = query.ilike('username', '%' + escapeLike(q) + '%');
        const res = await query.order('created_at', { ascending: false }).limit(12);
        if (token !== dmSearchToken || !$('dmDlg').open) return;
        box.textContent = '';
        if (res.error) { box.appendChild(el('p', { class: 'ch-help', text: friendly(res.error) })); return; }
        if (!(res.data || []).length) { box.appendChild(el('p', { class: 'ch-help', text: q ? 'No member matches that.' : 'No other members yet.' })); return; }
        res.data.forEach(function (p) {
            box.appendChild(el('button', { type: 'button', class: 'ch-result', onclick: function () { startDm(p.id); } },
                avatar(p, 38), el('span', { class: 'ch-result-main' }, el('strong', { text: nameOf(p) }), el('small', { text: '@' + p.username }))));
        });
    }

    // create dialog
    function openCreate(kind) {
        showBox('roomMsg', '');
        document.querySelector('input[name="rmKind"][value="' + kind + '"]').checked = true;
        $('rmName').value = ''; $('rmDesc').value = ''; $('rmIcon').value = kind === 'community' ? '🌐' : '💬'; $('rmPublic').checked = false;
        syncKind();
        openDlg('roomDlg');
    }

    function syncKind() {
        const kind = (document.querySelector('input[name="rmKind"]:checked') || {}).value || 'group';
        $('rmPublicWrap').hidden = kind !== 'community';
        $('roomTitle').textContent = kind === 'community' ? 'Create a community' : 'Create a group';
    }

    async function submitCreate(e) {
        e.preventDefault();
        const kind = (document.querySelector('input[name="rmKind"]:checked') || {}).value || 'group';
        const name = $('rmName').value.trim();
        if (name.length < 2) { showBox('roomMsg', ERR.bad_name); return; }
        const btn = $('roomSave');
        setLoading(btn, true);
        try {
            const icon_ = Array.from($('rmIcon').value.trim()).slice(0, 2).join('') || '💬';
            const res = await sb.rpc('chat_create_room', { p_kind: kind, p_name: name, p_desc: $('rmDesc').value.trim(), p_icon: icon_, p_public: kind === 'community' && $('rmPublic').checked });
            if (res.error) throw res.error;
            await loadRooms();
            closeDlg('roomDlg');
            setNavQuiet('mine');
            openRoom(res.data);
            toast('Created');
        } catch (err) { showBox('roomMsg', friendly(err)); }
        finally { setLoading(btn, false); }
    }

    // join with code
    function openCode() { showBox('codeMsg', ''); $('cdCode').value = ''; openDlg('codeDlg'); }

    async function submitCode(e) {
        e.preventDefault();
        const code = $('cdCode').value.trim().toLowerCase();
        if (!code) { showBox('codeMsg', ERR.bad_code); return; }
        const btn = $('codeSave');
        setLoading(btn, true);
        try {
            const res = await sb.rpc('chat_join_code', { p_code: code });
            if (res.error) throw res.error;
            await loadRooms();
            closeDlg('codeDlg');
            setNavQuiet('mine');
            openRoom(res.data);
        } catch (err) { showBox('codeMsg', friendly(err)); }
        finally { setLoading(btn, false); }
    }

    // invite dialog
    function openInvite() {
        if (!S.current) return;
        showBox('invMsg', '');
        $('ivUser').value = '';
        const code = S.current.invite_code;
        $('ivCodeBox').hidden = !code;
        $('ivCode').textContent = code || '';
        $('invTitle').textContent = 'Invite to ' + roomTitle(S.current);
        openDlg('invDlg');
    }

    async function submitInvite(e) {
        e.preventDefault();
        const name = $('ivUser').value.trim().replace(/^@/, '');
        if (!RE_USER.test(name)) { showBox('invMsg', 'Enter a valid username.'); return; }
        const btn = $('ivSave');
        setLoading(btn, true);
        try {
            const res = await sb.rpc('chat_invite', { p_room: S.current.room_id, p_username: name });
            if (res.error) throw res.error;
            $('ivUser').value = '';
            showBox('invMsg', '');
            toast('Invite sent to @' + name);
        } catch (err) { showBox('invMsg', friendly(err)); }
        finally { setLoading(btn, false); }
    }

    /* ----------------------------------------------------------------------
       12b. DEVELOPER MODE
            code blocks (highlight + copy + share), bug cards, snippets, GitHub previews
       ---------------------------------------------------------------------- */
    function highlightInto(node, code, lang) {
        const hl = window.hljs;
        node.textContent = code;                       // always safe fallback
        if (!hl) return;
        try {
            let res = null;
            const name = isLang(lang) ? LANGS[lang] : null;
            if (name && hl.getLanguage(name)) res = hl.highlight(code, { language: name, ignoreIllegals: true });
            else if (!lang && code.length > 24) {
                const subset = AUTO_LANGS.filter(function (n) { return hl.getLanguage(n); });
                if (subset.length) res = hl.highlightAuto(code, subset);
            }
            if (res && res.value) node.innerHTML = res.value;   // highlight.js escapes the source text
        } catch (e) { node.textContent = code; }
    }

    function codeBtn(label, ico, title, onclick) {
        return el('button', { type: 'button', class: 'ch-codebtn', title: title, 'aria-label': title, onclick: onclick }, icon(ico), el('span', { text: label }));
    }

    function buildCodeBlock(code, lang) {
        const codeEl = el('code');
        highlightInto(codeEl, code, lang);
        const copyBtn = codeBtn('COPY', 'copy', 'Copy code', function (e) {
            e.stopPropagation();
            const btn = e.currentTarget, label = btn.querySelector('span');
            const done = function () {
                label.textContent = 'COPIED'; btn.classList.add('is-done');
                setTimeout(function () { label.textContent = 'COPY'; btn.classList.remove('is-done'); }, 1500);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { toast('Could not copy. Copy it by hand.'); });
            else toast('Could not copy. Copy it by hand.');
        });
        const shareBtn = codeBtn('SNIPPET', 'link', 'Save as a shareable snippet and copy the link', function (e) {
            e.stopPropagation();
            saveSnippet(code, lang, e.currentTarget);
        });
        return el('div', { class: 'ch-codewrap' },
            el('div', { class: 'ch-codehead' }, el('span', { class: 'ch-codelang', text: lang ? lang.toUpperCase() : 'CODE' }), el('span', { class: 'ch-codebtns' }, copyBtn, shareBtn)),
            el('pre', { class: 'ch-codeblock' }, codeEl));
    }

    // ----- bug report cards -----
    function buildBugCard(m, bug) {
        const status = BUG_STATUS[m.bugStatus] ? m.bugStatus : 'open';
        const role = S.current && S.current.role;
        const canTriage = !m.pending && !!S.me && (m.sender_id === S.me.id || role === 'owner' || role === 'admin');
        const card = el('div', { class: 'ch-bug ch-bug--' + bug.s },
            el('div', { class: 'ch-bug-head' },
                el('span', { class: 'ch-bug-tag' }, icon('bug'), 'BUG REPORT'),
                el('span', { class: 'ch-sev ch-sev--' + bug.s, text: bug.s.toUpperCase() }),
                el('span', { class: 'ch-status ch-status--' + status, text: BUG_STATUS[status] })),
            el('h4', { class: 'ch-bug-title', text: bug.t }));
        if (bug.d) card.appendChild(el('p', { class: 'ch-bug-desc', text: bug.d }));
        if (bug.c) card.appendChild(buildCodeBlock(bug.c, bug.l));
        if (canTriage) {
            const row = el('div', { class: 'ch-bug-triage', role: 'group', 'aria-label': 'Set status' });
            Object.keys(BUG_STATUS).forEach(function (key) {
                row.appendChild(el('button', { type: 'button', class: 'ch-bug-st' + (key === status ? ' is-active' : ''), 'aria-pressed': String(key === status), onclick: function (e) { e.stopPropagation(); setBugStatus(m, key); } }, BUG_STATUS[key]));
            });
            card.appendChild(row);
        }
        return card;
    }

    async function loadBugStatuses(rows) {
        const ids = rows.filter(function (m) { return !m.deleted_at && String(m.body || '').slice(0, 6) === '[[bug:'; }).map(function (m) { return m.id; });
        if (!ids.length) return;
        try {
            const res = await sb.from('chat_bug_status').select('message_id,status').in('message_id', ids);
            if (res.error) return;                       // table not installed yet: cards just show "Open"
            const map = new Map((res.data || []).map(function (r) { return [r.message_id, r.status]; }));
            rows.forEach(function (m) { if (map.has(m.id)) m.bugStatus = map.get(m.id); });
        } catch (e) { /* ignore */ }
    }

    async function setBugStatus(m, status) {
        const prev = m.bugStatus || 'open';
        if (prev === status) return;
        m.bugStatus = status; rebuildNode(m);
        try {
            const res = await sb.rpc('chat_set_bug_status', { p_msg: m.id, p_status: status });
            if (res.error) throw res.error;
        } catch (err) { m.bugStatus = prev; rebuildNode(m); toast(friendly(err)); }
    }

    // its own channel, so a missing table can never take chat realtime down with it
    function subscribeBugs() {
        try {
            S.bugCh = sb.channel('specsoft-bugs-' + S.me.id)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_bug_status' }, function (p) {
                    const row = p.new && p.new.message_id ? p.new : null;
                    const m = row && S.byId.get(row.message_id);
                    if (m && m.bugStatus !== row.status) { m.bugStatus = row.status; rebuildNode(m); }
                })
                .subscribe();
        } catch (e) { /* ignore */ }
    }

    function bugDraft() {
        return buildBugBody({ t: $('bugTitle').value.trim() || 'x', s: $('bugSev').value, l: $('bugLang').value, d: $('bugDesc').value.trim(), c: $('bugCode').value.replace(/\s+$/, '') });
    }

    function updateBugCount() {
        const n = bugDraft().length, c = $('bugCount');
        c.textContent = n + ' / 2000';
        c.classList.toggle('is-over', n > 2000);
    }

    function openBug(title) {
        if (!S.current) return;
        if (S.editing) { toast('Finish editing first.'); return; }
        showBox('bugMsg', '');
        $('bugTitle').value = String(title || '').slice(0, 80);
        $('bugSev').value = 'medium'; $('bugLang').value = ''; $('bugDesc').value = ''; $('bugCode').value = '';
        updateBugCount();
        openDlg('bugDlg');
        setTimeout(function () { $('bugTitle').focus(); }, 60);
    }

    async function submitBug(e) {
        e.preventDefault();
        const title = $('bugTitle').value.trim();
        if (title.length < 3) { showBox('bugMsg', 'Give the bug a short title (3+ characters).'); return; }
        const body = bugDraft();
        if (body.length > 2000) { showBox('bugMsg', 'Too long by ' + (body.length - 2000) + ' characters. Trim the details or the code.'); return; }
        const btn = $('bugSave'), input = $('chInput'), prev = input.value;
        setLoading(btn, true);
        input.value = body; autosize();
        const ok = await sendMessage();                  // reuses the normal send pipeline (reply + attachment work too)
        input.value = prev; autosize();
        setLoading(btn, false);
        if (ok) closeDlg('bugDlg');
    }

    // ----- composer helpers -----
    function closeDev() { $('chDevMenu').hidden = true; $('chDevBtn').setAttribute('aria-expanded', 'false'); }

    function insertCodeBlock() {
        const root = $('chInput');
        if (root.disabled) return;
        root.focus();
        const range = composerCaretRange();
        const selected = serializeComposer(range.cloneContents());
        range.deleteContents();
        const frag = document.createDocumentFragment();
        const lang = document.createTextNode('js');
        frag.appendChild(document.createTextNode('```'));
        frag.appendChild(lang);
        composerNodes('\n' + selected + '\n```').forEach(function (n) { frag.appendChild(n); });
        range.insertNode(frag);
        const pick = document.createRange();             // "js" is selected so you can retype the language
        pick.setStart(lang, 0);
        pick.setEnd(lang, 2);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(pick);
        composerRange = pick.cloneRange();
        autosize();
    }

    // ----- shareable snippets -----
    const snipCache = new Map();
    let snipCurrent = null;

    function snippetUrl(id) { return location.origin + location.pathname + '?snippet=' + id; }

    function getSnippet(id) {
        if (!snipCache.has(id)) {
            const p = sb.rpc('chat_get_snippet', { p_id: id }).then(function (res) {
                if (res.error) throw res.error;
                const row = Array.isArray(res.data) ? res.data[0] : res.data;
                if (!row) throw new Error('snippet_not_found');
                return row;
            });
            snipCache.set(id, p);
            p.catch(function () { snipCache.delete(id); });
        }
        return snipCache.get(id);
    }

    async function saveSnippet(code, lang, btn) {
        if (btn) btn.disabled = true;
        try {
            const firstLine = (code.split('\n').find(function (l) { return l.trim(); }) || 'Snippet').trim().slice(0, 50);
            const res = await sb.rpc('chat_save_snippet', { p_title: (lang ? lang.toUpperCase() + ' \u00B7 ' : '') + firstLine, p_lang: lang || null, p_code: code });
            if (res.error) throw res.error;
            await copyText(snippetUrl(res.data), 'Snippet link copied. Paste it in any chat.');
        } catch (err) { toast(friendly(err)); }
        finally { if (btn) btn.disabled = false; }
    }

    function snippetCard(id) {
        const title = el('strong', { text: 'Code snippet' }), sub = el('small', { text: 'Loading\u2026' });
        const card = el('button', { type: 'button', class: 'ch-card', onclick: function (e) { e.stopPropagation(); openSnippet(id); } },
            el('span', { class: 'ch-card-ico' }, icon('code')),
            el('span', { class: 'ch-card-main' }, title, sub),
            el('span', { class: 'ch-card-go', text: 'OPEN' }));
        getSnippet(id).then(function (sn) {
            title.textContent = sn.title;
            sub.textContent = (sn.language ? sn.language.toUpperCase() + ' \u00B7 ' : '') + sn.code.split('\n').length + ' lines \u00B7 by @' + sn.owner_username;
        }).catch(function () { sub.textContent = 'Snippet unavailable'; });
        return card;
    }

    async function openSnippet(id) {
        snipCurrent = null;
        $('snipTitle').textContent = 'Snippet';
        $('snipMeta').textContent = 'Loading\u2026';
        $('snipCode').textContent = '';
        openDlg('snipDlg');
        try {
            const sn = await getSnippet(id);
            snipCurrent = sn;
            $('snipTitle').textContent = sn.title;
            $('snipMeta').textContent = [sn.language ? sn.language.toUpperCase() : 'CODE', sn.code.split('\n').length + ' lines', 'by @' + sn.owner_username, fmtListTime(sn.created_at)].join(' \u00B7 ');
            highlightInto($('snipCode'), sn.code, sn.language);
        } catch (err) { $('snipMeta').textContent = friendly(err); }
    }

    // ----- GitHub repo previews (public API, cached so we stay under the rate limit) -----
    const ghCache = new Map();
    const GH_TTL = 30 * 60 * 1000;

    function fetchRepo(owner, repo) {
        const key = (owner + '/' + repo).toLowerCase();
        if (ghCache.has(key)) return ghCache.get(key);
        const p = new Promise(function (resolve, reject) {
            try {
                const hit = JSON.parse(sessionStorage.getItem('specsoft-gh:' + key) || 'null');
                if (hit && Date.now() - hit.at < GH_TTL) { resolve(hit.d); return; }
            } catch (e) { /* ignore */ }
            fetch('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), { headers: { Accept: 'application/vnd.github+json' } })
                .then(function (r) { if (!r.ok) throw new Error('gh_' + r.status); return r.json(); })
                .then(function (j) {
                    const d = { full: String(j.full_name || key), desc: String(j.description || ''), stars: +j.stargazers_count || 0, forks: +j.forks_count || 0, issues: +j.open_issues_count || 0, lang: String(j.language || '') };
                    try { sessionStorage.setItem('specsoft-gh:' + key, JSON.stringify({ at: Date.now(), d: d })); } catch (e) { /* ignore */ }
                    resolve(d);
                })
                .catch(reject);
        });
        ghCache.set(key, p);                              // failures stay cached too, so a bad link never spams the API
        return p;
    }

    function githubCard(gh) {
        const title = el('strong', { text: gh.owner + '/' + gh.repo });
        const desc = el('small', { class: 'ch-card-desc', text: 'Loading repository\u2026' });
        const meta = el('span', { class: 'ch-card-meta' });
        const card = el('a', { class: 'ch-card', href: 'https://github.com/' + gh.owner + '/' + gh.repo, target: '_blank', rel: 'noopener noreferrer', onclick: function (e) { e.stopPropagation(); } },
            el('span', { class: 'ch-card-ico' }, icon('github')),
            el('span', { class: 'ch-card-main' }, title, desc, meta),
            el('span', { class: 'ch-card-go', text: 'GITHUB' }));
        fetchRepo(gh.owner, gh.repo).then(function (d) {
            title.textContent = d.full;
            desc.textContent = d.desc || 'No description.';
            if (d.lang) meta.appendChild(el('span', { text: d.lang }));
            meta.appendChild(el('span', { text: '\u2605 ' + fmtNum(d.stars) }));
            meta.appendChild(el('span', { text: '\u2442 ' + fmtNum(d.forks) }));
            meta.appendChild(el('span', { text: d.issues + ' open issues' }));
        }).catch(function () { card.remove(); });          // private / missing / rate limited: the plain link is still there
        return card;
    }

    /* ----------------------------------------------------------------------
       12c. CHAT MENU
            three dots, hover, right-click or long-press on a chat in the list
       ---------------------------------------------------------------------- */
    /* ----------------------------------------------------------------------
       HEADER THREE-DOT MENU
       The image / members / settings buttons fold into one menu (saves space on
       phones). The old buttons stay in the page, hidden, and the menu clicks them,
       so all their old behaviour keeps working.
       ---------------------------------------------------------------------- */
    ICON.image = ICON.image || svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>');
    ICON.flame = ICON.flame || svg('<path d="M12 2c.6 3.2 2.6 4.6 4.4 6.9 1.7 2.1 3.1 4.4 3.1 7.2A7.5 7.5 0 0 1 12 22.5a7.5 7.5 0 0 1-7.5-6.9c0-2.2.9-3.9 2.1-5.3.5 1.1 1.2 1.8 2 2.2C8.2 9 9.7 4.4 12 2z"/>');
    ICON.userplus = ICON.userplus || ICON.user;

    function headMenuItems(r) {
        const list = [];
        const own = { chInviteBtn: 1, chMembersBtn: 1, chSettingsBtn: 1, chHeadMore: 1 };
        // any other button living in the header (the custom chat image / background one) joins the menu
        Array.from(document.querySelectorAll('.ch-head-actions button')).forEach(function (b) {
            if (own[b.id] || b.hidden) return;
            const label = b.getAttribute('aria-label') || b.title || '';
            const isImg = /image|background|wallpaper|photo|picture/i.test(label) || !label;
            list.push({ ico: 'image', label: isImg ? 'Set Custom Image' : label, run: function () { b.click(); } });
        });
        const members = $('chMembers');
        list.push({ ico: 'users', label: members && !members.hidden ? 'Hide Members' : 'See Members', run: function () { $('chMembersBtn').click(); } });
        if (!$('chInviteBtn').hidden) list.push({ ico: 'userplus', label: 'Invite Someone', run: function () { $('chInviteBtn').click(); } });
        list.push({ ico: 'settings', label: 'Chat Settings', run: function () { $('chSettingsBtn').click(); } });
        if (r.kind === 'dm' && !r.blocked_by_me && !r.blocked_me) {
            const row = skRow(r);
            const label = !row ? 'Send Streak Invite'
                : row.status === 'pending' ? (row.invitedByMe ? 'Streak Invite Sent' : 'Answer Streak Invite')
                : 'See Streak Milestone';
            list.push({ ico: 'flame', label: label, run: function () { openStreakDlg(r); } });
        }
        return list;
    }

    function initHeadMenu() {
        const box = document.querySelector('.ch-head-actions');
        if (!box || $('chHeadMore')) return;
        const b = el('button', { type: 'button', class: 'ch-iconbtn ch-kebab', id: 'chHeadMore', 'aria-label': 'More options', 'aria-haspopup': 'menu', title: 'More' });
        b.innerHTML = ICON.more;
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            if (S.current) openRoomMenu(S.current, b, null, headMenuItems(S.current));
        });
        box.appendChild(b);
    }

    function closeMenu() {
        const m = S.menu;
        if (!m) return;
        S.menu = null;
        m.nodes.forEach(function (n) { n.remove(); });
        if (m.row) m.row.classList.remove('is-menu');
        const meBtn = $('chMe');
        if (meBtn) meBtn.setAttribute('aria-expanded', 'false');
        if (m.refocus && document.contains(m.refocus)) { try { m.refocus.focus(); } catch (e) { /* ignore */ } }
    }

    function menuItems(r) {
        const dm = r.kind === 'dm';
        const list = [];
        if (dm) list.push({ ico: 'user', label: 'View Profile', run: function () { viewProfile(r); } });
        list.push({ ico: 'pin', label: r.pinned ? 'Unpin Conversation' : 'Pin Conversation', run: function () { togglePin(r); } });
        if (dm) list.push({ ico: 'tag', label: r.nickname ? 'Edit Nickname' : 'Set Nickname', run: function () { openNick(r); } });
        list.push({ ico: r.muted ? 'bell' : 'belloff', label: r.muted ? 'Unmute' : 'Mute', run: function () { toggleMute(r); } });
        list.push({ ico: 'copy', label: dm ? 'Copy User ID' : 'Copy Chat ID', run: function () { copyId(r); } });
        list.push({ ico: 'check', label: 'Mark as read', disabled: !r.unread, run: function () { markRead(r.room_id); } });
        list.push('sep');
        if (dm) {
            list.push({ ico: 'ban', label: r.blocked_by_me ? 'Unblock User' : 'Block User', danger: !r.blocked_by_me, run: function () { toggleBlock(r); } });
            list.push({ ico: 'xcircle', label: 'Close DM', run: function () { closeDm(r); } });
            list.push({ ico: 'trash', label: 'Delete Chat', danger: true, run: function () { deleteChat(r); } });
        } else if (r.role === 'owner') {
            list.push({ ico: 'trash', label: 'Delete Chat', danger: true, run: function () { deleteChat(r); } });
        } else {
            list.push({ ico: 'logout', label: 'Leave Chat', danger: true, run: function () { leaveChat(r); } });
        }
        return list;
    }

    function openRoomMenu(r, anchor, point, items) {
        if (!r) return;
        closeMenu();
        const sheet = !!(window.matchMedia && window.matchMedia('(max-width: 700px), (pointer: coarse)').matches);
        const menu = el('div', { class: 'ch-menu' + (sheet ? ' is-sheet' : ''), role: 'menu', 'aria-label': 'Options for ' + roomTitle(r) });

        if (sheet) menu.appendChild(el('div', { class: 'ch-menu-head' }, el('span', { class: 'ch-menu-art' }, roomArt(r, 36)), el('strong', { text: roomTitle(r) })));

        (items || menuItems(r)).forEach(function (it) {
            if (it === 'sep') { menu.appendChild(el('div', { class: 'ch-menu-sep', role: 'separator' })); return; }
            menu.appendChild(el('button', {
                type: 'button', role: 'menuitem', disabled: it.disabled,
                class: 'ch-menu-item' + (it.danger ? ' is-danger' : ''),
                onclick: function () { closeMenu(); it.run(); }
            }, icon(it.ico), el('span', { text: it.label })));
        });

        const nodes = [];
        if (sheet) nodes.push(el('div', { class: 'ch-menu-scrim' }));
        nodes.push(menu);
        nodes.forEach(function (n) { document.body.appendChild(n); });

        const row = document.querySelector('#chListBody .ch-row[data-row="' + r.room_id + '"]');
        if (row) row.classList.add('is-menu');
        S.menu = { room: r.room_id, nodes: nodes, el: menu, row: row, refocus: anchor || null };

        if (!sheet) {
            const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
            const w = menu.offsetWidth, h = menu.offsetHeight;
            let x, y;
            if (anchor) {
                const b = anchor.getBoundingClientRect();
                x = b.right - w; y = b.bottom + 6;
                if (y + h > vh - 8) y = b.top - h - 6;
            } else {
                x = point.x; y = point.y;
            }
            menu.style.left = Math.max(8, Math.min(x, vw - w - 8)) + 'px';
            menu.style.top = Math.max(8, Math.min(y, vh - h - 8)) + 'px';
            const first = menu.querySelector('.ch-menu-item:not([disabled])');
            if (first && anchor) first.focus();
        }

        menu.addEventListener('keydown', function (e) {
            const items = Array.from(menu.querySelectorAll('.ch-menu-item:not([disabled])'));
            const i = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
            else if (e.key === 'Tab') closeMenu();
        });
    }

    // ----- the actions -----
    function viewProfile(r) {
        if (r.other_username) location.href = 'profile.html?u=' + encodeURIComponent(r.other_username);
        else toast('That profile is not available.');
    }

    async function savePref(r, field, bool, text) {
        const res = await sb.rpc('chat_set_pref', { p_room: r.room_id, p_field: field, p_bool: bool, p_text: text });
        if (res.error) throw res.error;
    }

    async function togglePin(r) {
        const next = !r.pinned;
        r.pinned = next; r.pinned_at = next ? new Date().toISOString() : null;
        bumpRoom(r);
        try { await savePref(r, 'pinned', next, null); toast(next ? 'Conversation pinned' : 'Conversation unpinned'); }
        catch (err) { r.pinned = !next; r.pinned_at = null; bumpRoom(r); toast(friendly(err)); }
    }

    async function toggleMute(r) {
        const next = !r.muted;
        r.muted = next; updateBadges(); renderList();
        try { await savePref(r, 'muted', next, null); toast(next ? 'Muted ' + roomTitle(r) : 'Unmuted ' + roomTitle(r)); }
        catch (err) { r.muted = !next; updateBadges(); renderList(); toast(friendly(err)); }
    }

    function copyId(r) {
        const id = r.kind === 'dm' ? r.other_id : r.room_id;
        if (!id) { toast('No ID available for this chat.'); return; }
        copyText(id, r.kind === 'dm' ? 'User ID copied' : 'Chat ID copied');
    }

    function openNick(r) {
        S.nickRoom = r;
        showBox('nickMsg', '');
        $('nickTitle').textContent = 'Nickname for ' + realName(r);
        $('nickInput').value = r.nickname || '';
        $('nickClear').hidden = !r.nickname;
        openDlg('nickDlg');
        setTimeout(function () { $('nickInput').focus(); $('nickInput').select(); }, 60);
    }

    async function saveNick(value) {
        const r = S.nickRoom;
        if (!r) return;
        value = String(value || '').trim().slice(0, 32);
        const btn = $('nickSave');
        setLoading(btn, true);
        try {
            await savePref(r, 'nickname', null, value);
            const live = S.roomMap.get(r.room_id) || r;
            live.nickname = value || null;
            closeDlg('nickDlg');
            renderList();
            if (sameRoom(live)) { paintHeader(); renderFeed({ keepScroll: true }); }
            toast(value ? 'Nickname saved' : 'Nickname removed');
        } catch (err) { showBox('nickMsg', friendly(err)); }
        finally { setLoading(btn, false); }
    }

    async function toggleBlock(r) {
        const block = !r.blocked_by_me;
        if (block && !window.confirm('Block ' + realName(r) + '?\n\nYou will not be able to message each other until you unblock them.')) return;
        try {
            const res = await sb.rpc('chat_set_block', { p_user: r.other_id, p_block: block });
            if (res.error) throw res.error;
            const live = S.roomMap.get(r.room_id) || r;
            live.blocked_by_me = block;
            if (block) S.blocked.add(live.other_id); else S.blocked.delete(live.other_id);
            if (sameRoom(live)) renderFeed({ keepScroll: true });
            if (block) S.tl.delete(live.room_id);
            toast(block ? 'Blocked ' + realName(r) : 'Unblocked ' + realName(r));
            if (sameRoom(live)) paintHeader();
            renderList();
        } catch (err) { toast(friendly(err)); }
    }

    function dropRoomLocal(r) {
        const wasOpen = sameRoom(r);
        S.rooms = S.rooms.filter(function (x) { return x.room_id !== r.room_id; });
        S.roomMap.delete(r.room_id);
        S.tl.delete(r.room_id);
        updateBadges();
        if (wasOpen) closeRoom(); else renderList();
    }

    async function closeDm(r) {
        try {
            await savePref(r, 'closed', true, null);
            dropRoomLocal(r);
            toast('DM closed. It comes back when there is a new message.');
        } catch (err) { toast(friendly(err)); }
    }

    async function deleteChat(r) {
        const dm = r.kind === 'dm';
        const ask = dm
            ? 'Delete this chat?\n\nThe history is cleared for you only. ' + realName(r) + ' keeps their copy.'
            : 'Delete "' + roomTitle(r) + '" for EVERYONE?\n\nAll messages are removed. This cannot be undone.';
        if (!window.confirm(ask)) return;
        try {
            const res = await sb.rpc('chat_delete_room', { p_room: r.room_id });
            if (res.error) throw res.error;
            dropRoomLocal(r);
            toast('Chat deleted');
        } catch (err) { toast(friendly(err)); }
    }

    async function leaveChat(r) {
        if (!window.confirm('Leave "' + roomTitle(r) + '"?')) return;
        try {
            const res = await sb.rpc('chat_leave', { p_room: r.room_id });
            if (res.error) throw res.error;
            dropRoomLocal(r);
            toast('You left the chat');
        } catch (err) { toast(friendly(err)); }
    }

    /* ----------------------------------------------------------------------
       MESSAGE SHEET (touch screens)
            hold a message to get: quick reactions + Reply, Edit, Copy, Pin, Report, Delete.
            Mouse users keep the hover toolbar. Phones never show those little buttons,
            so nobody taps Reply or Report by accident while scrolling or tapping the chat.
       ---------------------------------------------------------------------- */
    function closeMsgSheet() {
        const s = S.msgSheet;
        if (!s) return;
        S.msgSheet = null;
        s.nodes.forEach(function (n) { n.remove(); });
        if (s.node) s.node.classList.remove('is-pressing');
    }

    function messageSheetItems(m) {
        const mine = !!(S.me && m.sender_id === S.me.id);
        const bug = !!parseBug(m.body) || isStreakInvite(m.body);
        const list = [];

        list.push({ ico: 'reply', label: 'Reply', run: function () { startReply(m); } });
        if (mine && !bug) list.push({ ico: 'edit', label: 'Edit', run: function () { startEdit(m); } });
        if (!bug && String(m.body || '').trim()) list.push({ ico: 'copy', label: 'Copy text', run: function () { copyText(m.body, 'Message copied'); } });
        if (!bug && canPinHere(S.current)) {
            const pinned = S.pinIds.has(m.id);
            list.push({ ico: 'pin', label: pinned ? 'Unpin message' : 'Pin message', run: function () { togglePinMessage(m); } });
        }

        const canDelete = mine || !!(S.current && (S.current.role === 'owner' || S.current.role === 'admin')) || modCan('manage_messages');
        const canReport = !mine && !bug;
        if (canReport || canDelete) list.push('sep');
        if (canReport) list.push({ ico: 'flag', label: 'Report message', danger: true, run: function () { openReport(m); } });
        if (canDelete) list.push({ ico: 'trash', label: 'Delete message', danger: true, run: function () { deleteMessage(m); } });
        return list;
    }

    function openMsgSheet(m, node) {
        closeMsgSheet();
        closeQuick();
        if (!m || m.deleted_at || m.pending) return;

        const sheet = el('div', { class: 'ch-menu is-sheet ch-menu--msg', role: 'menu', 'aria-label': 'Message actions' });

        sheet.appendChild(el('div', { class: 'ch-menu-head ch-menu-head--msg' },
            el('strong', { text: nameOf(senderOf(m)) }),
            el('span', { class: 'ch-menu-preview', text: safePreview(m.body, m.sender_id) })));

        // quick reactions (same list as the hover bar: Windows 11 + your own emoji from chat-emoji.js)
        const mineSet = new Set();
        groupReactions(m).forEach(function (g) { if (g.mine) mineSet.add(g.emoji); });
        const row = el('div', { class: 'ch-sheet-react', role: 'group', 'aria-label': 'Quick reactions' });
        QUICK.forEach(function (entry) {
            const q = resolveQuick(entry);
            if (!q) return;                                   // unknown :name: -> skipped, never a broken button
            const qb = el('button', {
                type: 'button', class: 'ch-quick-btn' + (mineSet.has(q.value) ? ' is-mine' : ''),
                'aria-label': 'React ' + q.label, title: q.label,
                onclick: function () { closeMsgSheet(); toggleReaction(m, q.value); }
            });
            if (q.url) {
                const img = el('img', { class: 'ch-fl-img', src: q.url, alt: q.label, draggable: 'false' });
                img.addEventListener('error', function () { img.replaceWith(document.createTextNode(q.ch || ':' + q.label + ':')); });
                qb.appendChild(img);
            } else fillEmojiBtn(qb, q.ch);
            row.appendChild(qb);
        });
        // the emoji can scroll sideways, but the + stays pinned on the right so it can always be tapped
        const rowWrap = el('div', { class: 'ch-sheet-react-wrap' });
        rowWrap.appendChild(row);
        rowWrap.appendChild(el('button', {
            type: 'button', class: 'ch-quick-btn ch-quick-more', 'aria-label': 'More emoji', title: 'More emoji',
            onclick: function () { closeMsgSheet(); toggleEmoji(m); }
        }, icon('plus')));
        sheet.appendChild(rowWrap);

        messageSheetItems(m).forEach(function (it) {
            if (it === 'sep') { sheet.appendChild(el('div', { class: 'ch-menu-sep', role: 'separator' })); return; }
            sheet.appendChild(el('button', {
                type: 'button', role: 'menuitem',
                class: 'ch-menu-item' + (it.danger ? ' is-danger' : ''),
                onclick: function () { closeMsgSheet(); it.run(); }
            }, icon(it.ico), el('span', { text: it.label })));
        });

        const scrim = el('div', { class: 'ch-menu-scrim' });
        scrim.addEventListener('click', closeMsgSheet);
        document.body.appendChild(scrim);
        document.body.appendChild(sheet);

        if (node) node.classList.add('is-pressing');
        S.msgSheet = { nodes: [scrim, sheet], el: sheet, node: node || null, at: Date.now() };
    }

    // the dots button is off by default now, so tell people once that holding a message opens the menu
    function holdHint() {
        try {
            if (!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches)) return;
            if (localStorage.getItem('specsoft.chat.holdhint')) return;
            localStorage.setItem('specsoft.chat.holdhint', '1');
            setTimeout(function () { toast('Tip: hold a message to react, reply or more'); }, 1200);
        } catch (e) { /* ignore */ }
    }

    function wireMessageSheet() {
        const feed = $('chFeed');
        if (!feed) return;
        const touchy = function () { return !!(window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches); };
        let holdTimer = null, pressTimer = null, start = null, node = null, firedAt = 0;

        const cancel = function () {
            clearTimeout(holdTimer); clearTimeout(pressTimer);
            holdTimer = pressTimer = null;
            if (node && !(S.msgSheet && S.msgSheet.node === node)) node.classList.remove('is-pressing');
            node = null; start = null;
        };

        feed.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse') return;                       // desktop keeps the hover toolbar
            if (e.target.closest && e.target.closest('input, textarea, select, video, audio')) return;
            const n = e.target.closest && e.target.closest('.ch-msg');
            if (!n || n.classList.contains('is-pending')) return;
            const m = S.messages.find(function (x) { return String(x.id) === n.dataset.id; });
            if (!m || m.deleted_at) return;

            cancel();
            node = n;
            start = { x: e.clientX, y: e.clientY };
            pressTimer = setTimeout(function () { if (node) node.classList.add('is-pressing'); }, 140);
            holdTimer = setTimeout(function () {
                holdTimer = null;
                const target = node;
                firedAt = Date.now();
                try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* ignore */ }
                start = null;
                openMsgSheet(m, target);
            }, 380);
        });

        feed.addEventListener('pointermove', function (e) {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { feed.addEventListener(t, cancel); });
        feed.addEventListener('scroll', cancel, { passive: true });

        // Android fires its own "context menu" on a long press: swallow it so only our sheet shows
        // (and if the system's long press arrives before ours finishes, it opens the sheet itself)
        feed.addEventListener('contextmenu', function (e) {
            if (!touchy()) return;
            const n = e.target.closest && e.target.closest('.ch-msg');
            if (!n) return;
            if (e.target.closest && e.target.closest('video')) return;
            e.preventDefault();
            if (S.msgSheet || Date.now() - firedAt < 800 || n.classList.contains('is-pending')) return;
            const m = S.messages.find(function (x) { return String(x.id) === n.dataset.id; });
            if (!m || m.deleted_at) return;
            cancel();
            firedAt = Date.now();
            openMsgSheet(m, n);
        });

        // the click that ends a long press must never hit a link, a reaction or a sheet button underneath the finger
        document.addEventListener('click', function (e) {
            const recent = Date.now() - firedAt < 600 || (S.msgSheet && Date.now() - S.msgSheet.at < 600);
            if (recent && (S.msgSheet || (feed.contains(e.target)))) { e.preventDefault(); e.stopPropagation(); }
        }, true);

        window.addEventListener('resize', closeMsgSheet);
    }

    /* ----------------------------------------------------------------------
       VIDEO MESSAGES
            Videos go through the same private "chat-attachments" bucket as every file.
            They play right inside the chat (renderVideoCard) instead of being a download link.
       ---------------------------------------------------------------------- */
    const MAX_FILE_BYTES = 30 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
    const VIDEO_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };

    // some phones / browsers send a video with an empty type: fall back to the file ending
    function fileMime(file) {
        if (!file) return 'application/octet-stream';
        if (file.type) return file.type;
        const ext = String(file.name || '').split('.').pop().toLowerCase();
        return VIDEO_EXT[ext] || 'application/octet-stream';
    }
    function isVideoFile(file) { return /^video\//i.test(fileMime(file)); }

    function renderVideoCard(card, m, url) {
        const name = m.attachment_name || 'Video';
        const box = el('div', { class: 'ch-video' });
        const v = el('video', { class: 'ch-video-player', controls: true, playsinline: true, preload: 'metadata', 'aria-label': name });
        v.addEventListener('error', function () {
            // the browser can't play this format (for example an iPhone .mov in some browsers): offer the download instead
            card.textContent = '';
            card.appendChild(el('a', { class: 'ch-attachment-link', href: url, target: '_blank', rel: 'noopener noreferrer', download: name },
                el('span', { class: 'ch-attachment-file-icon', text: '▶' }),
                el('span', { class: 'ch-attachment-file-name', text: name + ' (tap to download)' }),
                el('small', { text: formatBytes(m.attachment_size || 0) })));
        }, { once: true });
        v.addEventListener('play', function () {                     // one video at a time
            document.querySelectorAll('.ch-video-player').forEach(function (o) { if (o !== v) o.pause(); });
            if (nowPlayingAudio) nowPlayingAudio.pause();
        });
        v.src = url + '#t=0.1';                                      // shows the first frame as the cover
        box.appendChild(v);
        box.appendChild(el('div', { class: 'ch-video-cap' },
            el('span', { text: name }),
            el('small', { text: formatBytes(m.attachment_size || 0) }),
            el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', download: name, title: 'Download', 'aria-label': 'Download video', text: '↧' })));
        card.classList.remove('ch-attachment--loading');
        card.textContent = '';
        card.appendChild(box);
    }

    /* ----------------------------------------------------------------------
       READ RECEIPTS: "Sent" / "Seen"
            Shown under YOUR newest message. Seen = the other person opened the chat and
            reached that message. If you turn read receipts off (SpecSettings 'readReceipts'),
            you stop sending them AND stop seeing other people's.
            Live: broadcast on the room channel. Remembered: table chat_reads (see the .sql file).
       ---------------------------------------------------------------------- */
    S.seen = new Map();                // user id -> time (ms) of the newest message they have seen in the open chat
    S.seenSent = new Map();            // room id -> newest time (ms) I already reported
    S.receiptsOK = true;               // becomes false when the SQL has not been run yet (then nothing is shown)
    S.roomChReady = null;

    function receiptsOn() {
        try { return !(window.SpecSettings && typeof window.SpecSettings.get === 'function' && window.SpecSettings.get('readReceipts') === false); }
        catch (e) { return true; }
    }

    function newestRealMessage() {
        for (let i = S.messages.length - 1; i >= 0; i--) {
            const x = S.messages[i];
            if (!x.pending && !String(x.id).startsWith('tmp-')) return x;
        }
        return null;
    }

    function sendSeen(roomId) {
        if (!receiptsOn() || !S.receiptsOK || !S.current || S.current.room_id !== roomId) return;
        const last = newestRealMessage();
        if (!last) return;
        const ms = Date.parse(last.created_at);
        if (!isFinite(ms) || (S.seenSent.get(roomId) || 0) >= ms) return;
        S.seenSent.set(roomId, ms);
        broadcastSeen(roomId);
        sb.rpc('chat_seen', { p_room: roomId, p_upto: last.created_at }).then(function (res) {
            if (res && res.error && (res.error.code === 'PGRST202' || res.error.code === '42883' || /could not find the function|chat_seen/i.test(res.error.message || ''))) {
                S.receiptsOK = false; paintReceipt();
            }
        }, function () { /* receipts are a bonus */ });
    }

    function broadcastSeen(roomId) {
        const ms = S.seenSent.get(roomId);
        if (!ms || !S.roomCh || S.roomChReady !== roomId || !receiptsOn()) return;
        try { S.roomCh.send({ type: 'broadcast', event: 'seen', payload: { room: roomId, uid: S.me.id, upto: ms } }); } catch (e) { /* ignore */ }
    }

    function noteSeen(uid, ms) {
        if (!uid || !isFinite(ms) || (S.seen.get(uid) || 0) >= ms) return;
        S.seen.set(uid, ms);
        schedulePaintReceipt();
    }

    async function loadSeen(roomId) {
        S.seen = new Map();
        schedulePaintReceipt();
        if (!S.receiptsOK) return;
        try {
            const res = await sb.from('chat_reads').select('user_id,seen_upto').eq('room_id', roomId);
            if (!S.current || S.current.room_id !== roomId) return;
            if (res.error) {
                if (res.error.code === '42P01' || res.error.code === 'PGRST205' || /chat_reads|schema cache|does not exist/i.test(res.error.message || '')) S.receiptsOK = false;
                schedulePaintReceipt();
                return;
            }
            (res.data || []).forEach(function (r) { if (r.user_id !== S.me.id) noteSeen(r.user_id, Date.parse(r.seen_upto)); });
        } catch (e) { /* ignore */ }
    }

    let receiptRaf = 0;
    function schedulePaintReceipt() {
        if (receiptRaf) return;
        receiptRaf = requestAnimationFrame(function () { receiptRaf = 0; paintReceipt(); });
    }

    function paintReceipt() {
        const feed = $('chFeed');
        if (!feed) return;
        feed.querySelectorAll('.ch-receipt').forEach(function (n) { n.remove(); });
        if (!S.current || !S.receiptsOK || !receiptsOn()) return;
        let last = null;
        for (let i = S.messages.length - 1; i >= 0; i--) {
            const x = S.messages[i];
            if (S.me && x.sender_id === S.me.id && !x.deleted_at) { last = x; break; }
        }
        if (!last) return;
        const node = feed.querySelector('[data-id="' + last.id + '"]');
        const host = node && node.querySelector('.ch-msg-body');
        if (!host) return;

        let cls = 'ch-receipt', ico = 'check', text = 'Sent';
        if (last.pending) { cls += ' is-pending'; ico = null; text = 'Sending…'; }
        else {
            const t = Date.parse(last.created_at);
            const stillIn = S.membersRoom === S.current.room_id && S.members.length
                ? function (uid) { return S.members.some(function (mm) { return mm.user_id === uid; }); }
                : function () { return true; };
            const names = [];
            S.seen.forEach(function (upto, uid) { if (uid !== S.me.id && upto >= t && stillIn(uid)) names.push(memberName(uid)); });
            if (names.length) {
                cls += ' is-seen'; ico = 'checks';
                text = S.current.kind === 'dm' ? 'Seen' : (names.length <= 2 ? 'Seen by ' + names.join(', ') : 'Seen by ' + names.length);
            }
        }
        host.appendChild(el('div', { class: cls }, ico ? icon(ico) : null, el('span', { text: text })));
    }

    function wireReceipts() {
        const feed = $('chFeed');
        if (!feed || !window.MutationObserver) return;
        // the feed is rebuilt in many places: whenever its messages change, put the receipt back under the newest one
        new MutationObserver(schedulePaintReceipt).observe(feed, { childList: true });
    }

    /* ----------------------------------------------------------------------
       VOICE MESSAGES (record in the message box, play in the chat)
            Mic button -> recording bar (timer + live bars) -> send. The recording is sent like any
            other attachment (private "chat-attachments" bucket). The length in seconds is written into
            the file name ("voice-202610310412-37s.webm") so the player can show it before it loads.
            Also plays normal audio files (mp3, m4a, wav...) that people attach.
       ---------------------------------------------------------------------- */
    const VM_MAX_SECS = 300;           // 5 minutes
    const VM_MIN_SECS = 1;
    const VM = { rec: null, stream: null, chunks: [], t0: 0, timer: 0, ctx: null, an: null, buf: null, hist: [], bars: [], room: null, mime: '', sendOnStop: false, busy: false };

    function vmClock(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    function vmPickMime() {
        if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
        const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        for (let i = 0; i < list.length; i++) { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; }
        return '';
    }
    function vmExt(base) { return /mp4|aac/.test(base) ? 'm4a' : /ogg/.test(base) ? 'ogg' : 'webm'; }

    function vmCleanup() {
        if (VM.timer) { clearInterval(VM.timer); VM.timer = 0; }
        if (VM.stream) { VM.stream.getTracks().forEach(function (t) { t.stop(); }); }
        if (VM.ctx) { try { VM.ctx.close(); } catch (e) { /* ignore */ } }
        VM.rec = null; VM.stream = null; VM.ctx = null; VM.an = null; VM.buf = null; VM.chunks = []; VM.hist = []; VM.busy = false;
        const box = $('chRec');
        if (box) box.hidden = true;
        const comp = document.querySelector('.ch-composer');
        if (comp) comp.classList.remove('is-recording');
    }

    function vmTick() {
        if (!VM.rec) return;
        const secs = (Date.now() - VM.t0) / 1000;
        $('chRecTime').textContent = vmClock(secs);
        if (VM.an) {
            VM.an.getByteTimeDomainData(VM.buf);
            let peak = 0;
            for (let i = 0; i < VM.buf.length; i++) { const v = Math.abs(VM.buf[i] - 128); if (v > peak) peak = v; }
            VM.hist.push(Math.min(1, peak / 70));
            if (VM.hist.length > VM.bars.length) VM.hist.shift();
            const off = VM.bars.length - VM.hist.length;
            VM.bars.forEach(function (b, i) { const v = i < off ? 0.08 : Math.max(0.08, VM.hist[i - off]); b.style.height = Math.round(v * 100) + '%'; });
        }
        if (secs >= VM_MAX_SECS) { toast('5 minute limit reached. Sending.'); vmStop(true); }
    }

    async function vmStart() {
        if (VM.rec || VM.busy || !S.current) return;
        const room = S.current;
        if (room.kind === 'dm' && (room.blocked_by_me || room.blocked_me)) { toast(ERR.blocked); return; }
        if (S.editing) { toast('Finish editing first.'); return; }
        if (S.pendingFile) { toast('Remove the attached file first, then record.'); return; }
        if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
            toast('Voice messages need a modern browser and an https:// page.');
            return;
        }
        VM.busy = true;
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (err) {
            VM.busy = false;
            const n = err && err.name;
            toast(n === 'NotAllowedError' || n === 'SecurityError' ? 'The microphone is blocked. Allow it for this site, then try again.'
                : n === 'NotFoundError' ? 'No microphone found.' : 'Could not open the microphone.');
            return;
        }
        let rec;
        const mime = vmPickMime();
        try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
        catch (err) { stream.getTracks().forEach(function (t) { t.stop(); }); VM.busy = false; toast('This browser cannot record audio.'); return; }

        VM.stream = stream; VM.rec = rec; VM.chunks = []; VM.room = room.room_id; VM.sendOnStop = false;
        VM.mime = rec.mimeType || mime || 'audio/webm';
        rec.ondataavailable = function (e) { if (e.data && e.data.size) VM.chunks.push(e.data); };
        rec.onstop = vmFinish;

        // live bars
        const wave = $('chRecWave');
        if (!wave.children.length) { for (let i = 0; i < 28; i++) wave.appendChild(document.createElement('i')); }
        VM.bars = Array.prototype.slice.call(wave.children);
        VM.hist = [];
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                VM.ctx = new AC();
                if (VM.ctx.state === 'suspended') VM.ctx.resume();
                VM.an = VM.ctx.createAnalyser();
                VM.an.fftSize = 512;
                VM.ctx.createMediaStreamSource(stream).connect(VM.an);
                VM.buf = new Uint8Array(VM.an.fftSize);
            }
        } catch (e) { VM.an = null; }

        VM.t0 = Date.now();
        rec.start(1000);
        $('chRecTime').textContent = '0:00';
        document.querySelector('.ch-composer').classList.add('is-recording');
        $('chRec').hidden = false;
        VM.timer = setInterval(vmTick, 90);
        VM.busy = false;
    }

    function vmStop(send) {
        if (!VM.rec) return;
        VM.sendOnStop = !!send;
        VM.secs = Math.round((Date.now() - VM.t0) / 1000);
        if (VM.timer) { clearInterval(VM.timer); VM.timer = 0; }
        try { VM.rec.stop(); } catch (e) { vmCleanup(); }
    }

    function vmCancel(silent) {
        if (!VM.rec) return;
        const rec = VM.rec;
        rec.onstop = null; rec.ondataavailable = null;
        try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* ignore */ }
        vmCleanup();
        if (!silent) toast('Voice message discarded');
    }

    async function vmFinish() {
        const send = VM.sendOnStop, chunks = VM.chunks.slice(), mime = VM.mime, room = VM.room, secs = VM.secs || 0;
        vmCleanup();
        if (!send || !chunks.length) return;
        if (secs < VM_MIN_SECS) { toast('Too short. Hold on a little longer.'); return; }
        if (!S.current || S.current.room_id !== room) { toast('Voice message cancelled because you left that chat.'); return; }
        const base = (mime.split(';')[0] || 'audio/webm').toLowerCase();
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        const file = new File([new Blob(chunks, { type: base })], 'voice-' + stamp + '-' + secs + 's.' + vmExt(base), { type: base });
        if (file.size > MAX_FILE_BYTES) { toast('That voice message is too big.'); return; }
        S.pendingFile = file;
        paintPendingFile();
        await sendMessage();         // normal send: reply, receipts and failure messages all work; if it fails the file stays attached so you can press send again
    }

    // ---- the player inside the chat ----
    let nowPlayingAudio = null;

    function renderAudioCard(card, m, url) {
        const name = m.attachment_name || 'Audio';
        const voice = /^voice-/i.test(name);
        const hint = /-(\d{1,4})s\.[a-z0-9]+$/i.exec(name);
        const hinted = hint ? Number(hint[1]) : 0;

        const audio = el('audio', { preload: 'metadata' });
        const play = el('button', { type: 'button', class: 'ch-aud-play', 'aria-label': 'Play' }, icon('play'));
        const seek = el('input', { type: 'range', class: 'ch-aud-seek', min: '0', max: '1000', value: '0', step: '1', 'aria-label': 'Seek' });
        const time = el('span', { class: 'ch-aud-time', text: vmClock(hinted) });
        const speed = el('button', { type: 'button', class: 'ch-aud-speed', title: 'Playback speed', 'aria-label': 'Playback speed', text: '1x' });
        const meta = el('div', { class: 'ch-aud-meta' }, time, voice ? null : el('span', { class: 'ch-aud-name', text: name }));
        const box = el('div', { class: 'ch-aud' + (voice ? ' is-voice' : '') }, play, el('div', { class: 'ch-aud-mid' }, seek, meta), speed);
        if (!voice) box.appendChild(el('a', { class: 'ch-aud-dl', href: url, target: '_blank', rel: 'noopener noreferrer', download: name, title: 'Download', 'aria-label': 'Download audio', text: '↧' }));

        const dur = function () { return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : hinted; };
        const paint = function () {
            const d = dur(), t = audio.currentTime || 0;
            const p = d ? Math.min(1000, Math.round(t / d * 1000)) : 0;
            seek.value = String(p);
            seek.style.setProperty('--p', (p / 10) + '%');
            time.textContent = vmClock(audio.paused && t === 0 ? d : t);
        };
        const setIconTo = function (n) { play.textContent = ''; play.appendChild(icon(n)); play.setAttribute('aria-label', n === 'pause' ? 'Pause' : 'Play'); };

        play.addEventListener('click', function () {
            if (!audio.paused) { audio.pause(); return; }
            if (nowPlayingAudio && nowPlayingAudio !== audio) nowPlayingAudio.pause();
            document.querySelectorAll('.ch-video-player').forEach(function (v) { v.pause(); });
            nowPlayingAudio = audio;
            const started = audio.play();
            if (started && started.catch) started.catch(function () { toast('Could not play this audio here.'); });
        });
        audio.addEventListener('play', function () { setIconTo('pause'); });
        audio.addEventListener('pause', function () { setIconTo('play'); paint(); });
        audio.addEventListener('ended', function () { audio.currentTime = 0; setIconTo('play'); paint(); });
        audio.addEventListener('timeupdate', paint);
        audio.addEventListener('durationchange', paint);
        audio.addEventListener('loadedmetadata', function () {
            if (audio.duration === Infinity) {                       // recordings made in the browser have no length inside: this makes the browser work it out
                const back = function () { audio.removeEventListener('timeupdate', back); audio.currentTime = 0; paint(); };
                audio.addEventListener('timeupdate', back);
                audio.currentTime = 1e101;
            }
            paint();
        });
        audio.addEventListener('error', function () {
            card.textContent = '';
            card.appendChild(el('a', { class: 'ch-attachment-link', href: url, target: '_blank', rel: 'noopener noreferrer', download: name },
                el('span', { class: 'ch-attachment-file-icon', text: '♪' }),
                el('span', { class: 'ch-attachment-file-name', text: (voice ? 'Voice message' : name) + ' (tap to download)' }),
                el('small', { text: formatBytes(m.attachment_size || 0) })));
        }, { once: true });
        seek.addEventListener('input', function () { const d = dur(); if (d) { audio.currentTime = (Number(seek.value) / 1000) * d; paint(); } });
        speed.addEventListener('click', function () {
            const next = audio.playbackRate >= 2 ? 1 : (audio.playbackRate >= 1.5 ? 2 : 1.5);
            audio.playbackRate = next;
            speed.textContent = (next === 1.5 ? '1.5' : String(next)) + 'x';
        });

        audio.src = url;
        card.classList.remove('ch-attachment--loading');
        card.textContent = '';
        card.appendChild(box);
    }

    function wireVoiceMessages() {
        setIcon('chMicBtn', 'mic');
        setIcon('chRecCancel', 'trash');
        setIcon('chRecSend', 'send');
        $('chMicBtn').addEventListener('click', vmStart);
        $('chRecCancel').addEventListener('click', function () { vmCancel(); });
        $('chRecSend').addEventListener('click', function () { vmStop(true); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && VM.rec) { e.preventDefault(); vmCancel(); } });
        window.addEventListener('pagehide', function () { vmCancel(true); });
    }

    /* ----------------------------------------------------------------------
       PASTE + DROP FILES
            Ctrl+V (or long-press > Paste on a phone) with a screenshot / copied picture / copied file
            attaches it, exactly like the paperclip. Press send to post it (add a caption first if you like).
       ---------------------------------------------------------------------- */
    function clipboardFiles(dt) {
        const out = [];
        if (!dt) return out;
        if (dt.files && dt.files.length) {
            for (let i = 0; i < dt.files.length; i++) out.push(dt.files[i]);
        } else if (dt.items) {
            for (let i = 0; i < dt.items.length; i++) {
                if (dt.items[i].kind === 'file') { const f = dt.items[i].getAsFile(); if (f) out.push(f); }
            }
        }
        return out;
    }

    // screenshots arrive called "image.png": give them a real name
    function pastedFileName(file) {
        const type = String(file.type || '').toLowerCase();
        if (!/^image\//.test(type) || (file.name && !/^image\.[a-z0-9]+$/i.test(file.name))) return file;
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' }[type] || 'png';
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        try { return new File([file], 'screenshot-' + stamp + '.' + ext, { type: file.type, lastModified: Date.now() }); }
        catch (e) { return file; }
    }

    function stagePastedFiles(files) {
        const file = files && files[0];
        if (!file || !S.current) return false;
        const room = S.current;
        if (room.kind === 'dm' && (room.blocked_by_me || room.blocked_me)) { toast(ERR.blocked); return true; }
        if (S.editing) { toast('Finish editing first, then add the file.'); return true; }
        if (typeof VM !== 'undefined' && VM.rec) return true;                 // busy recording a voice message
        chooseFile(pastedFileName(file));
        if (S.pendingFile) {
            const isImg = /^image\//i.test(fileMime(S.pendingFile));
            toast(files.length > 1 ? 'Added the first file. Press send.' : (isImg ? 'Picture ready. Press send.' : 'File ready. Press send.'));
            if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) { try { $('chInput').focus(); } catch (e) { /* ignore */ } }
        }
        return true;
    }

    function wireMenu() {
        const body = $('chListBody');

        body.addEventListener('click', function (e) {
            const more = e.target.closest && e.target.closest('.ch-more');
            if (more) { e.preventDefault(); e.stopPropagation(); openRoomMenu(S.roomMap.get(more.dataset.room), more); return; }
            const row = e.target.closest && e.target.closest('.ch-item[data-room]');
            if (!row) return;
            e.preventDefault();
            openRoom(row.dataset.room);
        });

        // right-click on desktop
        body.addEventListener('contextmenu', function (e) {
            const row = e.target.closest && e.target.closest('.ch-row');
            if (!row) return;
            e.preventDefault();
            if (S.lpFired) return;                               // long-press already opened it
            openRoomMenu(S.roomMap.get(row.dataset.row), null, { x: e.clientX, y: e.clientY });
        });

        // long-press on touch screens
        let timer = null, start = null;
        const cancel = function () { clearTimeout(timer); timer = null; start = null; };
        body.addEventListener('pointerdown', function (e) {
            S.lpFired = false;
            if (e.pointerType === 'mouse' || (e.target.closest && e.target.closest('.ch-more'))) return;
            const row = e.target.closest && e.target.closest('.ch-row');
            if (!row) return;
            start = { x: e.clientX, y: e.clientY };
            clearTimeout(timer);
            timer = setTimeout(function () {
                timer = null;
                S.lpFired = true;
                try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) { /* ignore */ }
                openRoomMenu(S.roomMap.get(row.dataset.row), null, start || { x: 24, y: 120 });
            }, 460);
        });
        body.addEventListener('pointermove', function (e) {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { body.addEventListener(t, cancel); });
        body.addEventListener('scroll', function () { cancel(); closeMenu(); }, { passive: true });

        // a new touch is a new gesture
        document.addEventListener('pointerdown', function () { if (!timer) S.lpFired = false; }, true);

        // click outside closes the menu and does nothing else (the click that ends a long-press is ignored)
        document.addEventListener('click', function (e) {
            if (!S.menu) return;
            if (S.lpFired) { S.lpFired = false; e.preventDefault(); e.stopPropagation(); return; }
            if (!S.menu.el.contains(e.target)) { e.preventDefault(); e.stopPropagation(); closeMenu(); }
        }, true);
        window.addEventListener('resize', closeMenu);

        // nickname dialog
        $('nickForm').addEventListener('submit', function (e) { e.preventDefault(); saveNick($('nickInput').value); });
        $('nickClear').addEventListener('click', function () { saveNick(''); });
    }

    /* ----------------------------------------------------------------------
       12d. NOTIFICATIONS
            in-page banners everywhere, plus real desktop notifications when the tab is in the background
       ---------------------------------------------------------------------- */
    function notifSupported() { return typeof window.Notification !== 'undefined'; }

    function paintNotifBtn() {
        const b = $('chNotifBtn');
        if (!b) return;
        setIcon('chNotifBtn', S.desk ? 'bell' : 'belloff');
        b.setAttribute('aria-pressed', String(S.desk));
        b.title = S.desk ? 'Desktop notifications: on' : 'Desktop notifications: off';
    }

    function initNotif() {
        let pref = null;
        try { pref = localStorage.getItem('specsoft.chat.notif'); } catch (e) { /* ignore */ }
        S.desk = notifSupported() && Notification.permission === 'granted' && pref !== 'off';
        paintNotifBtn();
    }

    async function toggleNotif() {
        const save = function (v) { try { localStorage.setItem('specsoft.chat.notif', v); } catch (e) { /* ignore */ } };
        if (!notifSupported()) { toast('This browser does not support desktop notifications.'); return; }
        if (S.desk) { S.desk = false; save('off'); paintNotifBtn(); toast('Desktop notifications off'); return; }
        let perm = Notification.permission;
        if (perm === 'default') {
            try { perm = (await Notification.requestPermission()) || Notification.permission; } catch (e) { perm = 'denied'; }
        }
        if (perm === 'granted') { S.desk = true; save('on'); paintNotifBtn(); toast('Desktop notifications on'); }
        else toast('Notifications are blocked. Allow them in your browser site settings.');
    }

    function removeBanner(rec) {
        if (!rec) return;
        clearTimeout(rec.timer);
        if (S.banners.get(rec.key) === rec) S.banners.delete(rec.key);
        rec.node.classList.remove('is-in');
        setTimeout(function () { rec.node.remove(); }, 260);
    }

    function showBanner(o) {
        const host = $('chNotifs');
        if (!host) return;
        removeBanner(S.banners.get(o.key));
        while (host.children.length >= 3) host.firstChild.remove();

        const rec = { key: o.key, node: null, timer: null };
        const arm = function () { clearTimeout(rec.timer); rec.timer = setTimeout(function () { removeBanner(rec); }, 6500); };
        const art = o.profile ? avatar(o.profile, 40) : el('span', { class: 'ch-art ch-art--sm', text: o.icon || '💬' });

        rec.node = el('div', { class: 'ch-notif', role: 'status' },
            el('button', { type: 'button', class: 'ch-notif-main', onclick: function () { removeBanner(rec); o.onOpen(); } },
                el('span', { class: 'ch-notif-av' }, art),
                el('span', { class: 'ch-notif-text' }, el('strong', { text: o.title }), el('span', { text: o.text }))),
            el('button', { type: 'button', class: 'ch-notif-x', 'aria-label': 'Dismiss', onclick: function () { removeBanner(rec); } }, icon('close')));
        rec.node.addEventListener('mouseenter', function () { clearTimeout(rec.timer); });
        rec.node.addEventListener('mouseleave', arm);

        host.appendChild(rec.node);
        S.banners.set(o.key, rec);
        requestAnimationFrame(function () { rec.node.classList.add('is-in'); });
        arm();
    }

    function openChatFromNotice(roomId) {
        if (!S.roomMap.has(roomId)) { toast('You are not in that chat any more.'); return; }
        setNavQuiet('mine');
        openRoom(roomId);
    }

    // one place decides how you get told: sound + (desktop notification when away, banner when here)
    function pushNotice(o) {
        ping();
        const away = document.hidden || !document.hasFocus();
        if (away && S.desk && notifSupported() && Notification.permission === 'granted') {
            try {
                const n = new Notification(o.title, {
                    body: o.text, tag: 'specsoft-' + o.key, renotify: true, silent: true,
                    icon: (o.profile && safeHttps(o.profile.avatar_url)) || undefined
                });
                n.onclick = function () { try { window.focus(); } catch (e) { /* ignore */ } n.close(); o.onOpen(); };
                setTimeout(function () { try { n.close(); } catch (e) { /* ignore */ } }, 8000);
                return;
            } catch (e) { /* some phones throw here: use the banner instead */ }
        }
        if (!document.hidden) showBanner(o);
    }

    function notifyMessage(room, m) {
        if (!room || !m || !S.me || m.sender_id === S.me.id) return;
        if (room.blocked_by_me) return;
        const mention = mentionsUser(m.body, S.profile && S.profile.username);
        if (room.muted && !mention) return;                                   // muted chats stay quiet, unless it is an @mention
        if (window.SPCH && SPCH.quiet(room, mention)) return;                  // community notification level
        const watching = S.current && S.current.room_id === room.room_id && !document.hidden && document.hasFocus();
        if (watching) return;

        const sender = m.sender || S.profiles.get(m.sender_id) || {};
        const dm = room.kind === 'dm';
        const who = dm ? roomTitle(room) : nameOf(sender);
        const preview = safePreview(m.body, m.sender_id) || 'Sent a message';
        const text = mention ? who + ' mentioned you: ' + preview : (dm ? preview : who + ': ' + preview);

        pushNotice({
            key: room.room_id,
            title: dm ? who : roomTitle(room),
            text: text,
            profile: dm ? { display_name: room.other_display, username: room.other_username, avatar_url: room.other_avatar } : null,
            icon: room.icon,
            onOpen: function () { openChatFromNotice(room.room_id); }
        });
    }

    /* ----------------------------------------------------------------------
       13. WIRING + START
       ---------------------------------------------------------------------- */
    function wire() {
        setIcon('chSideClose', 'close'); setIcon('chMenuBtn', 'menu'); setIcon('chMenuBtnConvo', 'menu'); setIcon('chBack', 'back');
        setIcon('chEmojiBtn', 'smile'); setIcon('chSend', 'send'); setIcon('chReplyCancel', 'close'); setIcon('chAttachBtn', 'attach'); setIcon('chFileClear', 'close');
        setIcon('chInviteBtn', 'userplus'); setIcon('chMembersBtn', 'users'); setIcon('chSettingsBtn', 'settings'); setIcon('chMembersClose', 'close'); initHeadMenu();
        setIcon('chSearchIcon', 'search');
        document.querySelectorAll('.ch-dlg .ch-iconbtn[data-close]').forEach(function (b) { b.innerHTML = ICON.close; });

        // Only sidebar navigation controls switch sections. The app shell also
        // carries data-nav for state, so binding every [data-nav] made every
        // click inside the app reset the view and instantly close open DMs.
        document.querySelectorAll('#chSide [data-nav]').forEach(function (b) {
            b.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                setNav(b.dataset.nav);
            });
        });

        $('chChatsToggle').addEventListener('click', function () {
            const open = $('chChatsToggle').getAttribute('aria-expanded') !== 'true';
            $('chChatsToggle').setAttribute('aria-expanded', String(open));
            $('chChatsSub').hidden = !open;
        });

        $('chMenuBtn').addEventListener('click', openDrawer);
        $('chMenuBtnConvo').addEventListener('click', openDrawer);
        $('chSideClose').addEventListener('click', closeDrawer);
        $('chScrim').addEventListener('click', closeDrawer);
        $('chBack').addEventListener('click', function () { $('chApp').dataset.view = 'list'; });

        $('chSearch').addEventListener('input', function (e) { S.query = e.target.value; renderList(); });
        wireMenu();
        wireMessageSheet();
        wireVoiceMessages();
        wireReceipts();

        // composer
        const input = $('chInput');
        input.addEventListener('input', function (e) {
            if (e.inputType === 'insertText' && e.data === ':' && !e.isComposing && chatOpt('chatEmojiCodes')) convertTypedEmoji();
            if (e.inputType === 'insertText' && /^[ \u00a0]$/.test(e.data || '') && !e.isComposing && chatOpt('chatEmoticons')) convertTypedEmoticon();
            autosize();
            updateMention();
            updateEmojiSuggest();
            if (input.value.trim()) sendTyping();
        });
        input.addEventListener('click', function () { updateMention(); updateEmojiSuggest(); });
        input.addEventListener('keyup', function (e) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') { updateMention(); updateEmojiSuggest(); } });
        input.addEventListener('blur', function () { setTimeout(function () { closeMention(); closeEmojiSuggest(); }, 150); });
        input.addEventListener('beforeinput', function (e) {            // 2000 character limit, like the old maxlength
            if (e.inputType && e.inputType.indexOf('insert') === 0 && e.inputType !== 'insertCompositionText') {
                const sel = window.getSelection();
                if (sel && sel.isCollapsed && serializeComposer(input).length >= 2000) e.preventDefault();
            }
        });
        input.addEventListener('paste', function (e) {                  // always paste as plain text (:emoji: codes still become images)
            e.preventDefault();
            const pastedFiles = clipboardFiles(e.clipboardData);
            if (pastedFiles.length) { stagePastedFiles(pastedFiles); return; }       // a screenshot / picture / file: attach it
            const text = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\r\n?/g, '\n');
            if (!text) return;
            insertIntoComposer(text.slice(0, Math.max(0, 2000 - serializeComposer(input).length)));
            autosize();
            sendTyping();
        });
        input.addEventListener('drop', function (e) { e.preventDefault(); });
        input.addEventListener('beforeinput', function (e) {            // some phone keyboards paste pictures this way instead
            if (e.inputType === 'insertFromPaste' && e.dataTransfer) {
                const f = clipboardFiles(e.dataTransfer);
                if (f.length) { e.preventDefault(); stagePastedFiles(f); }
            }
        });
        document.addEventListener('paste', function (e) {               // Ctrl+V works even when the message box is not focused
            if (e.defaultPrevented || !S.current || document.querySelector('dialog[open]')) return;
            const t = e.target;
            if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
            const f = clipboardFiles(e.clipboardData);
            if (f.length) { e.preventDefault(); stagePastedFiles(f); }
        });
        const convoBox = $('chConvo');
        if (convoBox) {                                                  // drag a file onto the chat
            convoBox.addEventListener('dragover', function (e) {
                if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
            });
            convoBox.addEventListener('drop', function (e) {
                const f = clipboardFiles(e.dataTransfer);
                if (f.length) { e.preventDefault(); stagePastedFiles(f); }
            });
        }
        document.addEventListener('selectionchange', function () {      // remember the caret so the emoji picker inserts in the right place
            const sel = window.getSelection();
            if (sel && sel.rangeCount && input.contains(sel.anchorNode)) composerRange = sel.getRangeAt(0).cloneRange();
        });
        input.addEventListener('keydown', function (e) {
            if (handleMentionKey(e)) return;
            if (handleEmojiKey(e)) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
                // Settings > Chats > "Sending messages": Enter sends, or Ctrl/Cmd+Enter sends
                let ctrlMode = false;
                try { ctrlMode = (JSON.parse(localStorage.getItem('specsoft.settings.v1') || '{}') || {}).chatEnter === 'ctrl'; } catch (x) { /* ignore */ }
                if (!isTouch && (!ctrlMode || e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMessage(); }
            }
            else if (e.key === 'Escape') { if (S.replyTo || S.editing) cancelCompose(); else $('chEmoji').hidden = true; }
            else if (e.key === 'ArrowUp' && !input.value) {
                const mine = S.messages.slice().reverse().find(function (m) { return m.sender_id === S.me.id && !m.deleted_at && !m.pending && !parseBug(m.body) && !isStreakInvite(m.body); });
                if (mine) { e.preventDefault(); startEdit(mine); }
            }
        });
        $('chSend').addEventListener('click', sendMessage);
        $('filterToggle').addEventListener('change', function (e) { setFilter(e.target.checked); });
        $('filterImgToggle').addEventListener('change', function (e) { setImgPrefs(e.target.checked); });
        $('reportForm').addEventListener('submit', submitReport);
        wireSettings();
        $('chAttachBtn').addEventListener('click', function () { $('chFileInput').click(); });
        $('chFileInput').addEventListener('change', function (e) { chooseFile(e.target.files && e.target.files[0]); });
        $('chFileClear').addEventListener('click', function () { S.pendingFile = null; paintPendingFile(); });
        $('chReplyCancel').addEventListener('click', function () { cancelCompose(); });
        $('chEmojiBtn').addEventListener('click', function () { toggleEmoji(null); });
        buildPicker();
        wireGif();

        // feed
        $('chFeed').addEventListener('scroll', function () {
            const was = S.atBottom;
            S.atBottom = atBottomNow();
            if (S.atBottom) { S.newCount = 0; if (!was && S.current && S.current.unread) markRead(S.current.room_id); }
            paintJump();
            if ($('chFeed').scrollTop < 140) loadOlder();
            closeQuick();
        });
        $('chJump').addEventListener('click', scrollToBottom);

        $('chMembersBtn').addEventListener('click', function () { if ($('chMembers').hidden) openMembers(); else closeMembers(); });
        $('chMembersClose').addEventListener('click', closeMembers);
        $('chLeaveBtn').addEventListener('click', leaveRoom);
        $('chInviteBtn').addEventListener('click', openInvite);

        $('dmSearch').addEventListener('input', function (e) { clearTimeout(dmTimer); const v = e.target.value; dmTimer = setTimeout(function () { searchMembers(v); }, 250); });
        document.querySelectorAll('input[name="rmKind"]').forEach(function (r) { r.addEventListener('change', syncKind); });
        $('roomForm').addEventListener('submit', submitCreate);
        $('codeForm').addEventListener('submit', submitCode);
        $('invForm').addEventListener('submit', submitInvite);
        $('ivCopy').addEventListener('click', function () { copyText($('ivCode').textContent, 'Invite code copied'); });
        wireDialogs();

        // close popups on outside click / Escape
        document.addEventListener('click', function (e) {
            if (quickEl && !quickEl.hidden && !quickEl.contains(e.target)) closeQuick();
            const box = $('chEmoji');
            if (!box.hidden && !box.contains(e.target) && !$('chEmojiBtn').contains(e.target) && !(quickEl && quickEl.contains(e.target))) { box.hidden = true; $('chEmojiBtn').setAttribute('aria-expanded', 'false'); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { if (S.msgSheet) { closeMsgSheet(); return; } if (S.menu) { closeMenu(); return; } closeQuick(); if (!$('chMembers').hidden) closeMembers(); closeDrawer(); }
        });

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) return;
            if (S.current && S.atBottom && S.current.unread) markRead(S.current.room_id);
            resync({ light: true });                      // woke up: catch up on anything that was missed
            refreshEmotes(false);                         // you may have just bought an emote in another tab
        });
        window.addEventListener('online', function () { resync(); });
        window.addEventListener('focus', function () { if (S.current && S.atBottom && S.current.unread) markRead(S.current.room_id); });

        // ----- developer mode -----
        setIcon('chDevBtn', 'code'); setIcon('chDevCodeIco', 'code'); setIcon('chDevBugIco', 'bug');
        $('chDevBtn').addEventListener('click', function (e) {
            e.stopPropagation();
            const menu = $('chDevMenu');
            menu.hidden = !menu.hidden;
            $('chDevBtn').setAttribute('aria-expanded', String(!menu.hidden));
            if (!menu.hidden) { $('chEmoji').hidden = true; $('chEmojiBtn').setAttribute('aria-expanded', 'false'); closeGif(); }
        });
        $('chDevCode').addEventListener('click', function () { closeDev(); insertCodeBlock(); });
        $('chDevBug').addEventListener('click', function () { closeDev(); openBug(''); });
        document.addEventListener('click', function (e) {
            const menu = $('chDevMenu');
            if (!menu.hidden && !menu.contains(e.target) && !$('chDevBtn').contains(e.target)) closeDev();
        });
        $('bugForm').addEventListener('submit', submitBug);
        ['bugTitle', 'bugDesc', 'bugCode', 'bugSev', 'bugLang'].forEach(function (id) { $(id).addEventListener('input', updateBugCount); $(id).addEventListener('change', updateBugCount); });
        $('snipCopy').addEventListener('click', function () { if (snipCurrent) copyText(snipCurrent.code, 'Code copied'); });
        $('snipCopyLink').addEventListener('click', function () { if (snipCurrent) copyText(snippetUrl(snipCurrent.id), 'Snippet link copied'); });

        setInterval(tickTyping, 1000);
        // safety net: if the websocket ever goes quiet the chat still catches up by itself
        setInterval(function () { if (!document.hidden) resync({ light: true }); }, 45000);
    }

    // chat-notify.js (the notifications on every other page) asks "is Chats open?" before it dings, so you never get two dings
    function answerNotifyPing() {
        if (!('BroadcastChannel' in window)) return;
        try {
            const bc = new BroadcastChannel('specsoft-chat-notify');
            bc.onmessage = function (e) { if (e.data && e.data.t === 'ask') bc.postMessage({ t: 'here' }); };
        } catch (e) { /* optional */ }
    }

    function handleDeepLink() {
        const q = new URLSearchParams(location.search);
        const snip = q.get('snippet');
        if (snip && RE_UUID.test(snip)) openSnippet(snip.toLowerCase());
        const room = q.get('room');
        if (room && S.roomMap.has(room)) { openRoom(room); return; }
        const dm = q.get('dm');
        if (dm && RE_USER.test(dm)) {
            sb.from('profiles').select('id').ilike('username', escapeLike(dm)).limit(1).then(function (res) {
                const row = res.data && res.data[0];
                if (row && row.id !== S.me.id) startDm(row.id);
            });
        }
    }

    /* ----------------------------------------------------------------------
       12e. PROFILE MENU (bottom of the sidebar)
            one profile button -> dropdown: profile, status, notifications, sounds,
            image checker, switch accounts, copy user id
       ---------------------------------------------------------------------- */
    const ACC_KEY = 'specsoft.chat.accounts.v1';
    const STATUS_IDEAS = ['😴 Sleeping', '🎮 Gaming', '📚 Studying', '🔥 Busy', '🌱 Touching grass'];

    function readAccounts() {
        try {
            const a = JSON.parse(localStorage.getItem(ACC_KEY) || '[]');
            return Array.isArray(a) ? a.filter(function (x) { return x && x.id && x.refresh_token; }) : [];
        } catch (e) { return []; }
    }
    function writeAccounts(list) { try { localStorage.setItem(ACC_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ } }

    // keep the newest login tokens of every account you use here, so switching needs no password
    function rememberAccount(sess) {
        try {
            if (!sess || !sess.user || !sess.refresh_token) return;
            const list = readAccounts();
            const old = list.find(function (a) { return a.id === sess.user.id; });
            if (!old && list.length >= 6) return;
            const mine = !!(S.me && S.profile && S.me.id === sess.user.id);
            const rec = {
                id: sess.user.id,
                name: mine ? nameOf(S.profile) : ((old && old.name) || sess.user.email || 'Account'),
                username: mine ? (S.profile.username || '') : ((old && old.username) || ''),
                avatar_url: mine ? (S.profile.avatar_url || null) : ((old && old.avatar_url) || null),
                access_token: sess.access_token,
                refresh_token: sess.refresh_token
            };
            writeAccounts(old ? list.map(function (a) { return a.id === rec.id ? rec : a; }) : list.concat(rec));
        } catch (e) { /* ignore */ }
    }

    async function rememberCurrent() {
        try { const r = await sb.auth.getSession(); rememberAccount(r && r.data && r.data.session); } catch (e) { /* ignore */ }
    }

    async function switchAccount(id) {
        const acc = readAccounts().find(function (a) { return a.id === id; });
        if (!acc || (S.me && acc.id === S.me.id)) return;
        toast('Switching account...');
        await rememberCurrent();
        try {
            const res = await sb.auth.setSession({ access_token: acc.access_token, refresh_token: acc.refresh_token });
            if (res.error || !res.data || !res.data.session) throw (res.error || new Error('no session'));
            location.reload();
        } catch (e) {
            writeAccounts(readAccounts().filter(function (a) { return a.id !== id; }));
            toast('That account needs to log in again.');
        }
    }

    async function addAccount() {
        await rememberCurrent();
        try {
            Object.keys(localStorage).filter(function (k) { return /^sb-.+-auth-token/.test(k); }).forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) { /* ignore */ }
        location.href = 'login.html?next=chats.html';
    }

    function paintAccountsDlg() {
        const box = $('accList');
        box.textContent = '';
        readAccounts().forEach(function (a) {
            const cur = !!(S.me && a.id === S.me.id);
            box.appendChild(el('div', { class: 'ch-acct' + (cur ? ' is-current' : '') },
                avatar({ id: a.id, display_name: a.name, avatar_url: a.avatar_url }, 36),
                el('span', { class: 'ch-acct-text' },
                    el('strong', { text: a.name }),
                    el('small', { text: cur ? 'Signed in now' : (a.username ? '@' + a.username : 'Saved on this device') })),
                cur ? null : el('button', { type: 'button', class: 'ch-btn ch-btn--ghost ch-btn--sm', text: 'Switch', onclick: function () { closeDlg('accountsDlg'); switchAccount(a.id); } }),
                cur ? null : el('button', { type: 'button', class: 'ch-iconbtn ch-iconbtn--danger', title: 'Remove from this device', 'aria-label': 'Remove ' + a.name,
                    onclick: function () { writeAccounts(readAccounts().filter(function (x) { return x.id !== a.id; })); paintAccountsDlg(); } }, icon('trash'))));
        });
    }

    function openAccountsDlg() { paintAccountsDlg(); openDlg('accountsDlg'); }

    // ----- online status + custom status (saved in the profile, everyone you chat with can see it) -----
    const ST_OPTS = [['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do Not Disturb'], ['offline', 'Offline']];
    const ST_TYPES = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    let stDraft = null;      // { status, path, file, objUrl, music: { url, art, start } | null }

    function myState() { return (S.me && statusMap.get(S.me.id)) || 'online'; }

    function paintMeStatus() {
        if (!S.me) return;
        const s = myState();
        const c = csOf(S.me.id);
        const sub = $('chMeSub');
        if (sub) sub.textContent = (c && (c.text || (c.mt && ('\u266A ' + c.mt)))) || ST_SUB[s] || 'Offline';
        const av = $('chMeAv');
        if (av) {
            let dot = av.querySelector('.ch-me-st');
            if (!dot || dot.dataset.st !== s) {
                if (dot) dot.remove();
                dot = el('i', { class: 'ch-st ch-me-st', title: ST_META[s], role: 'img', 'aria-label': ST_META[s] });
                dot.dataset.st = s;
                dot.innerHTML = stIcon(s);
                av.appendChild(dot);
            }
        }
    }

    async function loadMyStatus() {
        if (!S.me) return;
        try {
            const res = await csSelect(function (cols) { return sb.from('profiles').select(cols).eq('id', S.me.id).maybeSingle(); });
            if (res.error || !res.data) return;
            applyStatusRow(res.data);
            paintMeStatus();
        } catch (e) { /* ignore */ }
    }

    function stDraftThumbUrl() {
        if (!stDraft) return '';
        return stDraft.objUrl || csThumbUrl(stDraft.path);
    }

    function paintStThumb() {
        const box = $('stThumb');
        box.textContent = '';
        const url = stDraftThumbUrl();
        if (url) box.appendChild(el('img', { src: url, alt: '' }));
        else box.appendChild(icon('plus'));
        $('stThumbDel').hidden = !url;
    }

    function paintStStates() {
        const box = $('stStates');
        box.textContent = '';
        ST_OPTS.forEach(function (o) {
            const on = stDraft.status === o[0];
            const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'ch-stopt' + (on ? ' is-on' : ''),
                onclick: function () { stDraft.status = o[0]; paintStStates(); } });
            const dot = el('i', { class: 'ch-stopt-dot' });
            dot.innerHTML = stIcon(o[0]);
            b.appendChild(dot);
            b.appendChild(el('span', { text: o[1] }));
            box.appendChild(b);
        });
    }

    // ----- music picker: iTunes search, 10 second clip, start slider -----
    let msTimer = 0, msSeq = 0, msCtl = null;

    function itunesJsonp(url) {
        return new Promise(function (resolve, reject) {
            const cb = '__spItunes' + Math.floor(Math.random() * 1e9);
            const s = document.createElement('script');
            let t = 0;
            const end = function () { clearTimeout(t); delete window[cb]; s.remove(); };
            t = setTimeout(function () { end(); reject(new Error('itunes_timeout')); }, 8000);
            window[cb] = function (d) { end(); resolve(d); };
            s.onerror = function () { end(); reject(new Error('itunes_blocked')); };
            s.src = url + '&callback=' + cb;
            document.head.appendChild(s);
        });
    }

    function itunesSearch(term) {
        const url = 'https://itunes.apple.com/search?media=music&entity=song&limit=12&term=' + encodeURIComponent(term);
        if (msCtl) msCtl.abort();
        msCtl = window.AbortController ? new AbortController() : null;
        return fetch(url, msCtl ? { signal: msCtl.signal } : {})
            .then(function (r) { if (!r.ok) throw new Error('itunes_' + r.status); return r.json(); })
            .catch(function (e) { if (e && e.name === 'AbortError') throw e; return itunesJsonp(url); })
            .then(function (d) {
                const out = [];
                ((d && d.results) || []).forEach(function (r) {
                    const t = String((r && r.trackName) || '').trim().slice(0, 60);
                    const a = String((r && r.artistName) || '').trim().slice(0, 60);
                    const u = String((r && r.previewUrl) || '');
                    const art = String((r && r.artworkUrl100) || '');
                    if (!t || !csMusicUrlOk(u)) return;
                    out.push({ title: t, artist: a, url: u, art: csArtUrlOk(art) ? art : '' });
                });
                return out;
            });
    }

    function msHelp(text) { $('stMusHelp').textContent = text; }

    function paintMsResults(list) {
        const box = $('stMusList');
        box.textContent = '';
        list.forEach(function (t) {
            const art = t.art
                ? el('img', { class: 'ch-mus-art', src: t.art, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
                : el('span', { class: 'ch-mus-art' });
            box.appendChild(el('button', { type: 'button', class: 'ch-mus-item', onclick: function () { pickTrack(t); } },
                art, el('span', { class: 'ch-mus-meta' }, el('strong', { text: t.title }), el('small', { text: t.artist }))));
        });
        box.hidden = !list.length;
    }

    function runMusicSearch() {
        const q = $('stMusQ').value.trim();
        const seq = ++msSeq;
        if (q.length < 2) { paintMsResults([]); msHelp(MUS_HELP); return; }
        msHelp('Searching...');
        itunesSearch(q).then(function (list) {
            if (seq !== msSeq) return;
            paintMsResults(list);
            msHelp(list.length ? 'Tap a song to hear it and pick your part.' : 'No songs with a preview found. Try another search.');
        }).catch(function (e) {
            if (seq !== msSeq || (e && e.name === 'AbortError')) return;
            paintMsResults([]);
            msHelp('Could not reach iTunes right now. Check your connection, or type the song yourself below.');
        });
    }

    const MUS_MAX_BYTES = 15 * 1024 * 1024;   // the file you pick; only the 30 seconds you choose is uploaded
    const MUS_RATE = 32000;                   // the uploaded clip is mono 32 kHz, about 1.9 MB
    const MUS_HELP = 'Pick a song and everyone you chat with can play a 30 second clip of it from your status. Songs come from iTunes, or upload your own file.';

    function musDur(m) { return Math.max(1, Number(m && m.dur) || 30); }

    function paintStClip() {
        const m = stDraft && stDraft.music;
        if (!m) return;
        const dur = musDur(m);
        const max = Math.max(0, Math.floor((dur - CS_CLIP) * 2) / 2);     // furthest start that still leaves a full 30 second clip
        m.start = Math.min(m.start || 0, max);
        const s = m.start;
        csDraftDur = dur;
        const range = $('stMusStart');
        range.max = String(max);
        range.disabled = max <= 0;
        range.value = String(s);
        range.setAttribute('aria-valuetext', 'Starts at ' + csClock(s));
        $('stMusWin').style.left = (s / dur * 100) + '%';
        $('stMusWin').style.width = (Math.min(CS_CLIP, dur) / dur * 100) + '%';
        $('stMusStartT').textContent = csClock(s);
        $('stMusEndT').textContent = csClock(Math.min(dur, s + CS_CLIP));
        $('stMusNote').textContent = max > 0
            ? 'Your song is ' + csClock(dur) + ' long. Slide to pick the 30 seconds everyone hears.'
            : (m.kind === 'itunes' ? 'iTunes previews are exactly 30 seconds, so the whole preview plays. Upload your own MP3 or M4A to pick a part of a longer song.'
            : (m.kind === 'saved' ? 'This uploaded clip is already trimmed to 30 seconds. Upload the file again to pick a different part.'
            : 'This file is 30 seconds or shorter, so all of it plays.'));
    }

    function paintStMusic() {
        const m = stDraft && stDraft.music;
        const pick = $('stMusPick');
        pick.hidden = !m;
        if (!m) return;
        const art = $('stMusArt');
        art.textContent = '';
        if (m.art) art.appendChild(el('img', { src: m.art, alt: '', referrerpolicy: 'no-referrer' }));
        $('stMusNowT').textContent = $('stMusicT').value.trim() || 'Your song';
        $('stMusNowA').textContent = $('stMusicA').value.trim();
        $('stMusPlay').querySelector('.ch-cs-play-ico').innerHTML = ICON[csNow && csNow.key === 'draft' && !csAudio.paused ? 'pause' : 'play'];
        paintStClip();
    }

    function freeMusicFile() {
        const m = stDraft && stDraft.music;
        if (m && m.objUrl) { try { URL.revokeObjectURL(m.objUrl); } catch (e) { /* ignore */ } }
    }

    function pickTrack(t) {
        if (!stDraft) return;
        freeMusicFile();
        $('stMusicT').value = t.title;
        $('stMusicA').value = t.artist;
        stDraft.music = { kind: 'itunes', url: t.url, art: t.art, start: 0, dur: 30 };
        $('stMusQ').value = '';
        paintMsResults([]);
        msHelp('The preview is 30 seconds long, so the whole preview plays.');
        paintStMusic();
        csStop();
        csPlay('draft', t.url, 0);
    }

    function dropTrack() {
        freeMusicFile();
        if (stDraft) stDraft.music = null;
        if (csNow && csNow.key === 'draft') csStop();
        paintStMusic();
    }

    // ----- your own MP3 / M4A: read it here, trim the 30 seconds you picked, upload only that -----
    async function decodeAudioFile(f) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('no_audio');
        const ctx = new Ctx();
        try {
            const data = await f.arrayBuffer();
            return await new Promise(function (res, rej) {
                const p = ctx.decodeAudioData(data, res, rej);
                if (p && p.catch) p.catch(rej);
            });
        } finally { try { ctx.close(); } catch (e) { /* ignore */ } }
    }

    function encodeWav(samples, rate) {
        const n = samples.length;
        const ab = new ArrayBuffer(44 + n * 2);
        const v = new DataView(ab);
        const w = function (o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Blob([ab], { type: 'audio/wav' });
    }

    async function trimToWav(f, start) {
        const buf = await decodeAudioFile(f);
        const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Off) throw new Error('no_audio');
        const from = Math.max(0, Math.min(Number(start) || 0, Math.max(0, buf.duration - 1)));
        const len = Math.min(CS_CLIP, buf.duration - from);
        const off = new Off(1, Math.max(1, Math.floor(len * MUS_RATE)), MUS_RATE);
        const src = off.createBufferSource();
        src.buffer = buf;
        src.connect(off.destination);
        src.start(0, from, len);
        const out = await new Promise(function (res, rej) {
            const p = off.startRendering();
            if (p && p.then) p.then(res, rej); else off.oncomplete = function (e) { res(e.renderedBuffer); };
        });
        return encodeWav(out.getChannelData(0), MUS_RATE);
    }

    async function pickMusicFile(f) {
        if (!f || !stDraft) return;
        if (!/^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac)$/i.test(f.type) && !/\.(mp3|m4a)$/i.test(f.name)) { showBox('stMsg', 'Use an MP3 or M4A file.'); return; }
        if (f.size > MUS_MAX_BYTES) { showBox('stMsg', 'That file is over 15 MB.'); return; }
        showBox('stMsg', '');
        msHelp('Reading your file...');
        let dur = 0;
        try { const buf = await decodeAudioFile(f); dur = buf.duration; } catch (e) { dur = 0; }
        if (!stDraft) return;
        if (!(dur > 0)) { msHelp(MUS_HELP); showBox('stMsg', 'Could not read that audio file. Try another MP3 or M4A.'); return; }
        freeMusicFile();
        const objUrl = URL.createObjectURL(f);
        $('stMusicT').value = f.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim().slice(0, 60) || 'My song';
        $('stMusicA').value = '';
        $('stMusManual').open = true;
        stDraft.music = { kind: 'file', file: f, url: objUrl, objUrl: objUrl, dur: dur, start: 0 };
        $('stMusQ').value = '';
        paintMsResults([]);
        msHelp('Edit the title and artist below if you want. Only the 30 seconds you pick gets uploaded.');
        paintStMusic();
        csStop();
        csPlay('draft', objUrl, 0);
    }

    function openStatusDlg() {
        if (!S.me) return;
        const c = csOf(S.me.id) || { text: '', thumb: '', mt: '', ma: '', until: 0 };
        freeMusicFile();
        stDraft = { status: myState(), path: c.thumb || '', file: null, objUrl: '', music: c.mp ? { kind: 'saved', path: c.mp, url: csAudioUrl(c.mp), dur: 30, start: 0 } : (c.mu ? { kind: 'itunes', url: c.mu, art: c.art || '', start: c.ms || 0, dur: 30 } : null) };
        showBox('stMsg', '');
        $('stInput').value = c.text || '';
        $('stMusicT').value = c.mt || '';
        $('stMusicA').value = c.ma || '';
        $('stDur').value = 'never';
        $('stDurHelp').textContent = c.until ? 'Your current status ends around ' + new Date(c.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '. Saving again restarts the timer.' : '';
        $('stClear').hidden = !(c.text || c.thumb || c.mt);
        $('stMusQ').value = '';
        paintMsResults([]);
        msHelp(MUS_HELP);
        $('stMusManual').open = !!(c.mt && !c.mu && !c.mp);
        paintStStates();
        paintStThumb();
        paintStMusic();
        openDlg('statusDlg');
    }

    function pickStatusFile(f) {
        if (!f) return;
        if (!ST_TYPES[f.type]) { showBox('stMsg', 'Use a PNG, JPG, WebP or GIF image.'); return; }
        if (f.size > 3 * 1024 * 1024) { showBox('stMsg', 'That image is over 3 MB.'); return; }
        showBox('stMsg', '');
        if (stDraft.objUrl) URL.revokeObjectURL(stDraft.objUrl);
        stDraft.file = f;
        stDraft.objUrl = URL.createObjectURL(f);
        paintStThumb();
    }

    function minutesToMidnight() {
        const n = new Date();
        const m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
        return Math.max(1, Math.round((m - n) / 60000));
    }

    async function saveStatusForm(e) {
        if (e) e.preventDefault();
        if (!stDraft || !S.me) return;
        const btn = $('stSave');
        setLoading(btn, true);
        showBox('stMsg', '');
        const oldPath = (csOf(S.me.id) || {}).thumb || '';
        const oldAudio = (csOf(S.me.id) || {}).mp || '';
        try {
            let path = stDraft.path || '';
            if (stDraft.file) {
                const f = stDraft.file;
                path = S.me.id + '/' + Date.now() + '.' + ST_TYPES[f.type];
                const up = await sb.storage.from('status-media').upload(path, f, { contentType: f.type, cacheControl: '3600', upsert: false });
                if (up.error) throw up.error;
            }
            const text = $('stInput').value.trim();
            const mt = $('stMusicT').value.trim();
            const ma = $('stMusicA').value.trim();
            const dur = $('stDur').value;
            const minutes = dur === 'never' ? null : (dur === 'today' ? minutesToMidnight() : Number(dur));

            const mus = (mt && stDraft.music) ? stDraft.music : null;
            const args = {
                p_text: text || null, p_minutes: (text || path || mt) ? minutes : null,
                p_thumb: path || null, p_music_title: mt || null, p_music_artist: ma || null
            };
            // music fields are only sent when there is a clip, so a status without one still saves if the music SQL has not been run yet
            let audioPath = '';
            if (mus && mus.kind === 'file') {
                let wav;
                try { wav = await trimToWav(mus.file, mus.start || 0); } catch (x) { throw new Error('Could not trim that audio file. Try another one.'); }
                audioPath = S.me.id + '/' + Date.now() + '.wav';
                const upa = await sb.storage.from('status-audio').upload(audioPath, wav, { contentType: 'audio/wav', cacheControl: '3600', upsert: false });
                if (upa.error) throw upa.error;
                args.p_music_path = audioPath;
            } else if (mus && mus.kind === 'saved' && csAudioPathOk(mus.path)) {
                audioPath = mus.path;
                args.p_music_path = audioPath;
            } else if (mus && mus.kind === 'itunes' && csMusicUrlOk(mus.url)) {
                args.p_music_url = mus.url;
                args.p_music_art = csArtUrlOk(mus.art) ? mus.art : null;
                args.p_music_start = Math.max(0, Math.min(30, Number(mus.start) || 0));
            }
            const r1 = await sb.rpc('profile_set_custom_status', args);
            if (r1.error) throw r1.error;

            if (stDraft.status !== myState()) {
                const r2 = await sb.from('profiles').update({ status: stDraft.status }).eq('id', S.me.id);
                if (r2.error) throw r2.error;
            }

            if (oldPath && oldPath !== path) { try { await sb.storage.from('status-media').remove([oldPath]); } catch (x) { /* ignore */ } }
            if (oldAudio && oldAudio !== audioPath) { try { await sb.storage.from('status-audio').remove([oldAudio]); } catch (x) { /* ignore */ } }
            if (stDraft.objUrl) URL.revokeObjectURL(stDraft.objUrl);
            freeMusicFile();
            stDraft = null;
            statusAt.delete(S.me.id);
            await loadMyStatus();
            closeDlg('statusDlg');
            toast('Status updated');
        } catch (err) {
            showBox('stMsg', (isSetupMissing(err) || /bucket not found|status-media/i.test(String(err && err.message || ''))) ? 'Run supabase-chat-status.sql, then supabase-chat-status-music.sql, in your Supabase SQL Editor to turn on custom status and music.' : (function () {
                const f = friendly(err), m = String(err && err.message || '');
                return (/^Something went wrong/.test(f) && m) ? 'Could not save the status: ' + m : f;
            })());
        } finally { setLoading(btn, false); }
    }

    // ----- the dropdown -----
    function openMeMenu() {
        if (S.menu) { closeMenu(); return; }
        const anchor = $('chMe');
        const sheet = !!(window.matchMedia && window.matchMedia('(max-width: 700px), (pointer: coarse)').matches);
        const menu = el('div', { class: 'ch-menu ch-menu--me' + (sheet ? ' is-sheet' : ''), role: 'menu', 'aria-label': 'Account menu' });
        const nodes = [];
        if (sheet) nodes.push(el('div', { class: 'ch-menu-scrim' }));
        nodes.push(menu);
        let accOpen = false;

        function item(ico, label, run, o) {
            o = o || {};
            const b = el('button', { type: 'button', role: 'menuitem', class: 'ch-menu-item' + (o.sub ? ' ch-menu-sub' : '') + (o.current ? ' is-current' : '') },
                ico ? icon(ico) : null,
                el('span', { class: 'ch-menu-label', text: label }),
                o.tail || null);
            if (o.expanded != null) b.setAttribute('aria-expanded', String(o.expanded));
            b.addEventListener('click', function () { if (o.keep) run(); else { closeMenu(); run(); } });
            return b;
        }
        const sep = function () { return el('div', { class: 'ch-menu-sep', role: 'separator' }); };

        function render() {
            menu.textContent = '';
            if (sheet) menu.appendChild(el('div', { class: 'ch-menu-head' }, avatar(S.profile, 36), el('strong', { text: nameOf(S.profile) })));

            menu.appendChild(item('user', 'View my profile', function () { location.href = 'profile.html'; }));
            menu.appendChild(item('smile', 'Set Custom Status', openStatusDlg));
            menu.appendChild(sep());
            menu.appendChild(item(S.desk ? 'bell' : 'belloff', S.desk ? 'Turn off notifications' : 'Turn on notifications',
                function () { toggleNotif().then(render); }, { keep: true }));
            menu.appendChild(item(S.sound ? 'sound' : 'muted', 'Sounds: ' + (S.sound ? 'ON' : 'OFF'),
                function () { toggleSound(); render(); }, { keep: true }));
            menu.appendChild(item(S.imgOn ? 'shield' : 'shieldoff', S.imgOn ? 'Turn off image checker' : 'Turn on image checker',
                function () { setImgPrefs(!S.imgOn); toast(S.imgOn ? 'Image checker on' : 'Image checker off'); render(); }, { keep: true }));
            menu.appendChild(sep());
            menu.appendChild(item('users', 'Switch Accounts', function () { accOpen = !accOpen; render(); },
                { keep: true, expanded: accOpen, tail: el('span', { class: 'ch-menu-chev' }, icon('chevdown')) }));
            if (accOpen) {
                readAccounts().forEach(function (a) {
                    const cur = !!(S.me && a.id === S.me.id);
                    menu.appendChild(item(null, a.name, function () { switchAccount(a.id); },
                        { sub: true, current: cur, keep: cur, tail: cur ? el('span', { class: 'ch-menu-check' }, icon('check')) : null }));
                });
                menu.appendChild(item('settings', 'Manage Accounts', openAccountsDlg, { sub: true }));
            }
            menu.appendChild(sep());
            menu.appendChild(item('copy', 'Copy User ID', function () { copyText(S.me.id, 'User ID copied'); }));
        }
        render();

        nodes.forEach(function (n) { document.body.appendChild(n); });
        S.menu = { room: null, nodes: nodes, el: menu, row: null, refocus: anchor };
        anchor.setAttribute('aria-expanded', 'true');

        if (!sheet) {
            const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
            const b = anchor.getBoundingClientRect();
            const w = Math.max(b.width, 252);
            menu.style.minWidth = w + 'px';
            menu.style.left = Math.max(8, Math.min(b.left, vw - w - 8)) + 'px';
            menu.style.bottom = Math.max(8, vh - b.top + 8) + 'px';     // grows upward, so the sub-list never leaves the screen
            menu.style.maxHeight = Math.max(160, b.top - 16) + 'px';
            menu.style.overflowY = 'auto';
            const first = menu.querySelector('.ch-menu-item:not([disabled])');
            if (first) first.focus();
        }

        menu.addEventListener('keydown', function (e) {
            const items = Array.from(menu.querySelectorAll('.ch-menu-item:not([disabled])'));
            const i = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
            else if (e.key === 'Tab') closeMenu();
        });
    }

    function initAccountMenu() {
        setIcon('chMeCaret', 'chevup');
        $('stMusPlay').querySelector('.ch-cs-play-ico').innerHTML = ICON.play;
        $('chMe').addEventListener('click', openMeMenu);

        const chips = $('stChips');
        STATUS_IDEAS.forEach(function (t) {
            chips.appendChild(el('button', { type: 'button', class: 'ch-chip', text: t, onclick: function () { $('stInput').value = t; $('stInput').focus(); } }));
        });
        $('statusForm').addEventListener('submit', saveStatusForm);
        $('stClear').addEventListener('click', function () {
            if (!stDraft) return;
            $('stInput').value = ''; $('stMusicT').value = ''; $('stMusicA').value = '';
            stDraft.path = ''; stDraft.file = null; dropTrack();
            if (stDraft.objUrl) { URL.revokeObjectURL(stDraft.objUrl); stDraft.objUrl = ''; }
            saveStatusForm();
        });
        $('stPick').addEventListener('click', function () { $('stFile').click(); });
        $('stThumb').addEventListener('click', function () { $('stFile').click(); });
        $('stFile').addEventListener('change', function (e) { pickStatusFile(e.target.files && e.target.files[0]); e.target.value = ''; });
        $('stThumbDel').addEventListener('click', function () {
            if (!stDraft) return;
            if (stDraft.objUrl) URL.revokeObjectURL(stDraft.objUrl);
            stDraft.file = null; stDraft.path = ''; stDraft.objUrl = '';
            paintStThumb();
        });
        $('stMusUpBtn').addEventListener('click', function () { $('stMusFile').click(); });
        $('stMusFile').addEventListener('change', function (e) { pickMusicFile(e.target.files && e.target.files[0]); e.target.value = ''; });
        $('stMusQ').addEventListener('input', function () { clearTimeout(msTimer); msTimer = setTimeout(runMusicSearch, 350); });
        $('stMusQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(msTimer); runMusicSearch(); } });
        $('stMusPlay').addEventListener('click', function () {
            const m = stDraft && stDraft.music;
            if (m) csPlay('draft', m.url, m.start);
        });
        setIcon('stMusDel', 'xcircle');
        $('stMusDel').addEventListener('click', function () { $('stMusicT').value = ''; $('stMusicA').value = ''; dropTrack(); });
        $('stMusStart').addEventListener('input', function () {
            const m = stDraft && stDraft.music;
            if (!m) return;
            m.start = Number(this.value) || 0;
            paintStClip();
            if (csNow && csNow.key === 'draft') { csNow.start = m.start; try { csAudio.currentTime = m.start; } catch (e) { /* ignore */ } }
        });
        $('stMusStart').addEventListener('change', function () {
            const m = stDraft && stDraft.music;
            if (m && !(csNow && csNow.key === 'draft' && !csAudio.paused)) csPlay('draft', m.url, m.start);
        });
        $('stMusicT').addEventListener('input', function () { if (stDraft && stDraft.music && !this.value.trim()) dropTrack(); else paintStMusic(); });
        $('stMusicA').addEventListener('input', paintStMusic);
        $('statusDlg').addEventListener('close', function () { if (csNow && csNow.key === 'draft') csStop(); });
        $('accAdd').addEventListener('click', addAccount);
    }

    async function boot() {
        if (window.SPCH) SPCH.attach({
            S: S, sb: sb, $: $, el: el, toast: toast, friendly: friendly, setLoading: setLoading,
            openRoom: openRoom, closeRoom: closeRoom, setNav: setNav, renderList: renderList, bumpRoom: bumpRoom,
            updateBadges: updateBadges, cacheProfiles: cacheProfiles, pushNotice: pushNotice, mentionsUser: mentionsUser,
            nameOf: nameOf, safePreview: safePreview, paintHeader: paintHeader,
            openSettings: openSettings, loadRooms: loadRooms, startDm: startDm, avatar: avatar
        });
        initTheme();
        initSound();
        installComposer();
        initFilter();
        initAccountMenu();
        fitViewport();
        injectEmojiStyles();
        wire();
        Promise.all([loadCustomEmoji(), loadEmojiData()]).then(function () { onEmojiData(true); });      // chat-emoji.js + emoji-data.js, load in the background
        gate('loading');

        if (!sb) { gate('setup'); return; }

        let session = null;
        try { session = (await sb.auth.getSession()).data.session; } catch (e) { session = null; }
        if (!session || !session.user) { gate('login'); return; }
        S.me = session.user;

        try {
            S.profile = await ensureProfile(S.me);
            S.profiles.set(S.profile.id, S.profile);
            await Promise.all([loadRooms(), loadInvites(), loadInbox(), loadBlocks(), loadEmotes()]);
            buildPicker();                                   // adds MY EMOTES now that we know what you own
        } catch (err) {
            console.error('Chats failed to load:', err);
            if (isSetupMissing(err)) gate('sql'); else gate('error', friendly(err));
            return;
        }

        $('chMeName').textContent = nameOf(S.profile);
        $('chMeAv').textContent = '';
        $('chMeAv').appendChild(avatar(S.profile, 36));
        paintMeStatus();
        loadMyStatus();
        rememberCurrent();
        sb.auth.onAuthStateChange(function (event, sess) {
            if (event === 'SIGNED_OUT') { location.reload(); return; }
            if (sess && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) rememberAccount(sess);
        });

        hideGate();
        if (window.SPCH) SPCH.start();
        subscribeGlobal();
        subscribeBugs();
        setInterval(loadStreaks, 5 * 60 * 1000);                          // the streak day rolls over at midnight
        document.addEventListener('visibilitychange', function () { if (!document.hidden) loadStreaksSoon(); });
        subscribeUser();
        subscribePresence();
        initNotif();
        answerNotifyPing();
        renderList();
        handleDeepLink();
    }

    boot();
})();
