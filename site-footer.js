/* ==========================================================================
   SPECSOFT® site-footer.js  -  the shared footer, on every page

   main.js loads this file (and site-footer.css) the same way it loads site-fx,
   so any page that uses main.js gets the footer by itself. Nothing to add per page.

   EDIT HERE
   - Links:   COLS below. Each entry is [label, url]. Add or remove freely.
   - Credits: BUILT_WITH below (the "Built with" chips).
   - Socials: they follow the icons in the sidebar (main.js) automatically, so
              change those three URLs once, in main.js, and both places update.
              The SOCIALS values below are only the fallback.
   - Pages with no footer: SKIP below. A single page can also opt out with
              <meta name="specsoft-footer" content="off">.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecFooter) return;

    var SKIP = /(^|\/)(chats|intro|ban|admin|gate)(\.html)?$/i;   // app screens and full-screen pages

    var TAGLINE = 'Build with purpose. Create without limits.';
    var EST = 2025;

    var COLS = [
        { title: 'General', links: [
            ['Help & Support', 'help.html'],
            ['Privacy Policy', 'privacy.html'],
            ['Terms & Guidelines', 'terms.html'],
            ['Credits & Attributions', 'credits.html'],
            ['Server & Website Rules', 'rules.html']
        ], note: ['Powered by Netlify', 'https://www.netlify.com'] },
        { title: 'Content', links: [
            ['Studio Documentation', 'studio.html'],
            ['Content Guidelines', 'content-guidelines.html']
        ] },
        { title: 'Other', links: [
            ['Spectra AI', 'spectra-ai.html'],
            ['Blog', 'blog.html'],
            ['Careers', 'careers.html'],
            ['Contact Us', 'contact.html'],
            ['Our Team', 'team.html']
        ] }
    ];

    var BUILT_WITH = [
        ['Netlify', 'https://www.netlify.com'],
        ['GitHub', 'https://github.com'],
        ['Supabase', 'https://supabase.com'],
        ['Google Fonts', 'https://fonts.google.com'],
        ['Emoji.gg', 'https://emoji.gg'],
        ['Emojipedia', 'https://emojipedia.org'],
        ['Flaticon', 'https://www.flaticon.com'],
        ['Three.js', 'https://threejs.org'],
        ['highlight.js', 'https://highlightjs.org'],
        ['NSFWJS', 'https://nsfwjs.com'],
        ['GIPHY', 'https://giphy.com']
    ];

    var SOCIALS = [
        { label: 'Discord', url: 'https://discord.gg/Uym7ybcWK3', d: 'M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z' },
        { label: 'GitHub', url: 'https://github.com/Aspec404/specsoft-website', d: 'M12 0.297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.387 0.6 0.113 0.82-0.26 0.82-0.58 0-0.283-0.01-1.04-0.016-2.04-3.338 0.725-4.042-1.61-4.042-1.61-0.546-1.387-1.333-1.756-1.333-1.756-1.09-0.745 0.083-0.729 0.083-0.729 1.205 0.084 1.84 1.236 1.84 1.236 1.07 1.834 2.81 1.304 3.495 0.997 0.108-0.776 0.418-1.305 0.762-1.605-2.665-0.303-5.467-1.334-5.467-5.931 0-1.31 0.47-2.381 1.236-3.221-0.124-0.303-0.535-1.524 0.117-3.176 0 0 1.008-0.322 3.301 1.23 0.957-0.266 1.983-0.399 3.003-0.404 1.02 0.005 2.047 0.138 3.006 0.404 2.291-1.552 3.297-1.23 3.297-1.23 0.653 1.653 0.242 2.874 0.118 3.176 0.77 0.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.48 5.922 0.43 0.372 0.814 1.102 0.814 2.222 0 1.604-0.014 2.896-0.014 3.291 0 0.322 0.216 0.698 0.824 0.579C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' },
        { label: 'Roblox', url: 'https://www.roblox.com/groups/yourgroupid', d: 'M5.164 0L.001 18.836 18.836 24 24 5.164 5.164 0zm7.281 10.278l4.683 1.257-1.257 4.683-4.683-1.257 1.257-4.683z' }
    ];

    /* ------------------------------------------------------------------ build */
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function ext(url) { return /^https?:\/\//i.test(url); }
    function a(label, url, cls) {
        return '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(url) + '"' + (ext(url) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + esc(label) + '</a>';
    }
    function socialUrl(s) {
        // use whatever the sidebar already links to, so there is one place to edit
        try {
            var el = document.querySelector('.social-links a[aria-label="' + s.label + '"]');
            if (el && el.getAttribute('href')) return el.getAttribute('href');
        } catch (e) { /* ignore */ }
        return s.url;
    }

    function html() {
        var y = new Date().getFullYear();
        var years = EST + (y > EST ? '\u2013' + y : '');
        var cols = COLS.map(function (c) {
            return '<div class="sf-col"><h3 class="sf-h">' + esc(c.title) + '</h3><ul>' +
                c.links.map(function (l) { return '<li>' + a(l[0], l[1], 'sf-link') + '</li>'; }).join('') +
                (c.note ? '<li class="sf-note">' + a(c.note[0], c.note[1], 'sf-link sf-link--muted') + '</li>' : '') +
                '</ul></div>';
        }).join('');
        var social = SOCIALS.map(function (s) {
            return '<a class="sf-soc" href="' + esc(socialUrl(s)) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(s.label) + '" title="' + esc(s.label) + '">' +
                '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + s.d + '"/></svg></a>';
        }).join('');
        var built = BUILT_WITH.map(function (b) { return '<li>' + a(b[0], b[1], 'sf-chip') + '</li>'; }).join('');

        return '<div class="sf-card">' +
            '<i class="sf-corner sf-tl"></i><i class="sf-corner sf-tr"></i><i class="sf-corner sf-bl"></i><i class="sf-corner sf-br"></i>' +
            '<div class="sf-top">' +
                '<div class="sf-brand">' +
                    '<a class="sf-logo" href="index.html" aria-label="SPECSOFT home">' +
                        '<img src="logo.png" alt="" class="logo-img logo-light" onerror="this.style.display=\'none\';">' +
                        '<img src="logo-dark.png" alt="" class="logo-img logo-dark" onerror="this.style.display=\'none\';">' +
                        '<span>SPECSOFT\u00ae</span></a>' +
                    '<p class="sf-tag">' + esc(TAGLINE) + '</p>' +
                    '<div class="sf-socials">' + social + '</div>' +
                '</div>' +
                '<nav class="sf-cols" aria-label="Footer">' + cols + '</nav>' +
            '</div>' +
            '<div class="sf-built"><span class="sf-h sf-h--inline">Built with</span><ul>' + built + '</ul></div>' +
            '<div class="sf-bar">' +
                '<span>\u00a9 ' + years + ' SPECSOFT\u00ae. All rights reserved.</span>' +
                '<span class="sf-est">EST. ' + EST + '</span>' +
                '<button type="button" class="sf-top-btn" id="sfTop" aria-label="Back to top">TOP <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>' +
            '</div>' +
        '</div>';
    }

    function host() {
        return document.querySelector('main.main-content') || document.querySelector('.main-content') || document.querySelector('.sx-wrap');
    }

    function mount() {
        if (document.getElementById('spFooter')) return;
        if (SKIP.test(location.pathname.replace(/\/+$/, ''))) return;
        var meta = document.querySelector('meta[name="specsoft-footer"]');
        if (meta && /^(off|no|false)$/i.test(meta.getAttribute('content') || '')) return;
        var h = host();
        if (!h) return;

        var f = document.createElement('footer');
        f.id = 'spFooter';
        f.className = 'sf';
        f.innerHTML = html();
        h.appendChild(f);

        var top = f.querySelector('#sfTop');
        if (top) top.addEventListener('click', function () {
            var calm = !!(document.documentElement.classList.contains('ss-reduce-motion') || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
            var opt = { top: 0, behavior: calm ? 'auto' : 'smooth' };
            try { window.scrollTo(opt); if (h.scrollTo) h.scrollTo(opt); } catch (e) { window.scrollTo(0, 0); }
        });
    }

    window.SpecFooter = { mount: mount };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
