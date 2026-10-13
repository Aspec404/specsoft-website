/* ==========================================================================
   SPECSOFT® — Main JavaScript
   Combines:
     • Global layout (sidebar, theme, mobile menu, dropdowns, favicon)
     • Projects Hub (feed, filters, dialog, likes/saves)
   Load at the bottom of <body>. On pages without #phGrid, the projects
   half exits immediately — zero cost.
   ========================================================================== */

(function () {
    'use strict';

    /* ======================================================================
       PART 1 — GLOBAL LAYOUT (runs on every page)
       ====================================================================== */

    /* ----------------------------------------------------------------------
       1.1 SIDEBAR COMPONENT
       ---------------------------------------------------------------------- */
    const SIDEBAR_HTML = `
        <div class="sidebar-top">
            <a href="index.html" class="logo">
                <img src="logo.png"
                     alt="SPECSOFT Logo"
                     class="logo-img logo-light"
                     onerror="this.style.display='none';">
                <img src="logo-dark.png"
                     alt="SPECSOFT Logo"
                     class="logo-img logo-dark"
                     onerror="this.style.display='none';">
                SPECSOFT®
            </a>
            <div class="status-indicator">
                <span class="pulse-dot"></span> SYSTEMS ONLINE
            </div>
        </div>

        <nav class="side-nav">
            <a href="index.html" class="nav-item" data-nav="home">
                <span class="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                    </svg>
                </span>
                <span class="nav-text">HOME</span>
                <span class="nav-num">01</span>
            </a>

            <div class="nav-item" id="projectsToggle">
                <span class="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="16 18 22 12 16 6"></polyline>
                        <polyline points="8 6 2 12 8 18"></polyline>
                    </svg>
                </span>
                <span class="nav-text">PROJECTS</span>
                <span class="nav-num">02</span>
                <span class="nav-chevron">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </span>
            </div>

            <div class="nav-dropdown" id="projectsDropdown">
                <a href="projects.html" class="nav-subitem">
                    <span class="sub-bullet"></span>
                    <span>Projects Hub</span>
                </a>
                <a href="spectra-ai.html" class="nav-subitem">
                    <span class="sub-bullet"></span>
                    <span>Spectra AI</span>
                </a>
                <a href="project-clan-wars.html" class="nav-subitem">
                    <span class="sub-bullet"></span>
                    <span>Ability Arena Roblox</span>
                </a>
            </div>

            <a href="community.html" class="nav-item" data-nav="community">
                <span class="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                </span>
                <span class="nav-text">COMMUNITY</span>
                <span class="nav-num">03</span>
            </a>

            <a href="store.html" class="nav-item" data-nav="store">
                <span class="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                    </svg>
                </span>
                <span class="nav-text">STORE</span>
                <span class="nav-num">04</span>
            </a>
        </nav>

        <div class="sidebar-bottom">
            <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
                <svg class="moon-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
                <svg class="sun-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
                <span id="themeLabel">DARK MODE</span>
            </button>
            <div class="social-links">
                <a href="https://github.com/yourusername" target="_blank" rel="noopener" aria-label="Github">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M12 0.297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.387 0.6 0.113 0.82-0.26 0.82-0.58 0-0.283-0.01-1.04-0.016-2.04-3.338 0.725-4.042-1.61-4.042-1.61-0.546-1.387-1.333-1.756-1.333-1.756-1.09-0.745 0.083-0.729 0.083-0.729 1.205 0.084 1.84 1.236 1.84 1.236 1.07 1.834 2.81 1.304 3.495 0.997 0.108-0.776 0.418-1.305 0.762-1.605-2.665-0.303-5.467-1.334-5.467-5.931 0-1.31 0.47-2.381 1.236-3.221-0.124-0.303-0.535-1.524 0.117-3.176 0 0 1.008-0.322 3.301 1.23 0.957-0.266 1.983-0.399 3.003-0.404 1.02 0.005 2.047 0.138 3.006 0.404 2.291-1.552 3.297-1.23 3.297-1.23 0.653 1.653 0.242 2.874 0.118 3.176 0.77 0.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.48 5.922 0.43 0.372 0.814 1.102 0.814 2.222 0 1.604-0.014 2.896-0.014 3.291 0 0.322 0.216 0.698 0.824 0.579C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                    </svg>
                </a>
                <a href="https://discord.gg/yourinvite" target="_blank" rel="noopener" aria-label="Discord">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
                    </svg>
                </a>
                <a href="https://www.roblox.com/groups/yourgroupid" target="_blank" rel="noopener" aria-label="Roblox">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M5.164 0L.001 18.836 18.836 24 24 5.164 5.164 0zm7.281 10.278l4.683 1.257-1.257 4.683-4.683-1.257 1.257-4.683z"/>
                    </svg>
                </a>
            </div>
        </div>
    `;

    /* ----------------------------------------------------------------------
       1.2 MOBILE HEADER COMPONENT
       ---------------------------------------------------------------------- */
    const MOBILE_HEADER_HTML = `
        <a href="index.html" class="logo">
            <img src="logo.png"
                 alt="SPECSOFT Logo"
                 class="logo-img logo-light"
                 onerror="this.style.display='none';">
            <img src="logo-dark.png"
                 alt="SPECSOFT Logo"
                 class="logo-img logo-dark"
                 onerror="this.style.display='none';">
            SPECSOFT® [BETA]
        </a>
        <button class="hamburger" id="hamburgerBtn" aria-label="Toggle Navigation">
            <span></span>
            <span></span>
            <span></span>
        </button>
    `;

    /* ----------------------------------------------------------------------
       1.3 INJECT SIDEBAR & MOBILE HEADER
       ---------------------------------------------------------------------- */
    function injectLayout() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.innerHTML = SIDEBAR_HTML;

        const mobileHeader = document.querySelector('.mobile-header');
        if (mobileHeader) mobileHeader.innerHTML = MOBILE_HEADER_HTML;
    }

    /* ----------------------------------------------------------------------
       1.4 AUTO-HIGHLIGHT ACTIVE NAV ITEM
       ---------------------------------------------------------------------- */
    function highlightActiveNav() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const pageKey = currentPage.replace('.html', '');

        const navMap = {
            '': 'home',
            'index': 'home',
            'home': 'home',
            'community': 'community',
            'store': 'store',
            'roblox': 'roblox'
        };

        const activeKey = navMap[pageKey] || null;

        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        if (activeKey) {
            const activeItem = document.querySelector(`.nav-item[data-nav="${activeKey}"]`);
            if (activeItem) activeItem.classList.add('active');
        }
    }

    /* ----------------------------------------------------------------------
       1.5 THEME TOGGLE
       ---------------------------------------------------------------------- */
    function initThemeToggle() {
        const themeToggle = document.getElementById('themeToggle');
        const themeLabel = document.getElementById('themeLabel');

        if (!themeToggle) return;

        const savedTheme = localStorage.getItem('specsoft-theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light-mode');
            if (themeLabel) themeLabel.textContent = 'LIGHT MODE';
        }

        themeToggle.addEventListener('click', function () {
            document.body.classList.toggle('light-mode');

            if (document.body.classList.contains('light-mode')) {
                localStorage.setItem('specsoft-theme', 'light');
                if (themeLabel) themeLabel.textContent = 'LIGHT MODE';
            } else {
                localStorage.setItem('specsoft-theme', 'dark');
                if (themeLabel) themeLabel.textContent = 'DARK MODE';
            }
        });
    }

    /* ----------------------------------------------------------------------
       1.6 MOBILE SIDEBAR TOGGLE
       ---------------------------------------------------------------------- */
    function initMobileSidebar() {
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (!hamburgerBtn || !sidebar || !overlay) return;

        function toggleSidebar() {
            hamburgerBtn.classList.toggle('active');
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');

            document.body.style.overflow =
                sidebar.classList.contains('open') ? 'hidden' : '';
        }

        function closeSidebar() {
            hamburgerBtn.classList.remove('active');
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }

        hamburgerBtn.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', closeSidebar);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                closeSidebar();
            }
        });

        window.closeSidebar = closeSidebar;
    }

    /* ----------------------------------------------------------------------
       1.7 PROJECTS DROPDOWN
       ---------------------------------------------------------------------- */
    function initProjectsDropdown() {
        const projectsToggle = document.getElementById('projectsToggle');
        const projectsDropdown = document.getElementById('projectsDropdown');

        if (!projectsToggle || !projectsDropdown) return;

        projectsToggle.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            projectsToggle.classList.toggle('dropdown-open');
            projectsDropdown.classList.toggle('open');
        });
    }

    /* ----------------------------------------------------------------------
       1.8 INJECT FAVICON (system dark/light mode)
       ---------------------------------------------------------------------- */
    function injectFavicon() {
        const existing = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (existing) return;

        const fallback = document.createElement('link');
        fallback.rel = 'icon';
        fallback.type = 'image/png';
        fallback.href = 'logo.png';
        document.head.appendChild(fallback);

        const darkFavicon = document.createElement('link');
        darkFavicon.rel = 'icon';
        darkFavicon.type = 'image/png';
        darkFavicon.href = 'logo.png';
        darkFavicon.media = '(prefers-color-scheme: dark)';
        document.head.appendChild(darkFavicon);

        const lightFavicon = document.createElement('link');
        lightFavicon.rel = 'icon';
        lightFavicon.type = 'image/png';
        lightFavicon.href = 'logo-dark.png';
        lightFavicon.media = '(prefers-color-scheme: light)';
        document.head.appendChild(lightFavicon);

        const apple = document.createElement('link');
        apple.rel = 'apple-touch-icon';
        apple.href = 'logo.png';
        document.head.appendChild(apple);
    }

    /* ======================================================================
       PART 2 — PROJECTS HUB (only runs on pages that have #phGrid)
       ====================================================================== */
    function initProjectsHub() {
        const grid = document.getElementById('phGrid');
        if (!grid) return;

        /* ------------------------------------------------------------------
           2.1 DATA
           ------------------------------------------------------------------ */
        const CATEGORIES = [
            { id: 'ai',       label: 'AI' },
            { id: 'games',    label: 'Games' },
            { id: 'software', label: 'Software' },
            { id: 'roblox',   label: 'Roblox' }
        ];

        const STATUS = { active: 'ACTIVE', growing: 'GROWING', soon: 'COMING SOON' };

        const PROJECTS = [
            {
                id: 'spectra',
                title: 'Project Spectra',
                category: 'ai',
                type: 'AI Development',
                year: 2026,
                status: 'active',
                featured: true,
                likes: 0,
                summary: 'Our official AI and mascot of SPECSOFT.',
                tags: ['AI', 'Mascot'],
                link: 'project-spectra-ai.html',
                linkLabel: 'OPEN PROJECT'
            },
            {
                id: 'apex-clan',
                title: 'Apex Clan',
                category: 'roblox',
                type: 'Roblox Community',
                year: 2026,
                status: 'growing',
                featured: true,
                likes: 0,
                summary: 'Competitive clan in Ability Arena on Roblox, and the official SPECSOFT clan.',
                tags: ['Roblox', 'Clan', 'Ability Arena'],
                link: 'roblox.html',
                linkLabel: 'VISIT COMMUNITY'
            },
            {
                id: 'next-game',
                title: 'Project ████',
                category: 'games',
                type: 'Game Development',
                year: 2026,
                status: 'soon',
                teaser: true,
                summary: 'Not announced yet. Something is being built.',
                tags: ['Games']
            },
            {
                id: 'next-software',
                title: 'Software Experiment',
                category: 'software',
                type: 'Software',
                year: 2026,
                status: 'soon',
                teaser: true,
                summary: 'A new tool is in the lab. Details soon.',
                tags: ['Software']
            }
        ];

        /* ------------------------------------------------------------------
           2.2 HELPERS
           ------------------------------------------------------------------ */
        const $  = (s, r = document) => r.querySelector(s);
        const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
        const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        const svg = inner =>
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';

        const ICON = {
            ai:       svg('<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M9 3v2M15 3v2M9 19v2M15 19v2"/>'),
            games:    svg('<rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M7 10v4M5 12h4"/><circle cx="15.5" cy="11" r=".7"/><circle cx="18" cy="13" r=".7"/>'),
            software: svg('<polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/><line x1="14" y1="5" x2="10" y2="19"/>'),
            roblox:   svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
            lock:     svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
            heart:    svg('<path d="M12 20s-7-4.4-9-9.2C1.6 7.4 3.7 4 7 4c2 0 3.4 1 5 3 1.6-2 3-3 5-3 3.3 0 5.4 3.4 4 6.8-2 4.8-9 9.2-9 9.2z"/>'),
            bookmark: svg('<path d="M6 3h12v18l-6-4.5L6 21z"/>'),
            share:    svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>'),
            search:   svg('<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>'),
            close:    svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
            plus:     svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
            grid:     svg('<rect x="4" y="4" width="6.5" height="6.5"/><rect x="13.5" y="4" width="6.5" height="6.5"/><rect x="4" y="13.5" width="6.5" height="6.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5"/>'),
            list:     svg('<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>'),
            chevron:  svg('<polyline points="6 9 12 15 18 9"/>')
        };

        const ARROW = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';

        const store = {
            get(key, fallback) {
                try {
                    const v = localStorage.getItem('specsoft.hub.' + key);
                    return v === null ? fallback : JSON.parse(v);
                } catch (e) { return fallback; }
            },
            set(key, value) {
                try { localStorage.setItem('specsoft.hub.' + key, JSON.stringify(value)); } catch (e) { /* storage blocked */ }
            }
        };

        /* ------------------------------------------------------------------
           2.3 STATE + DOM
           ------------------------------------------------------------------ */
        const dlg      = $('#phDialog');
        const search   = $('#phSearch');
        const sortSel  = $('#phSort');
        const meta     = $('#phMeta');
        const empty    = $('#phEmpty');
        const emptyTxt = $('#phEmptyText');

        const byId  = {};
        PROJECTS.forEach(p => { byId[p.id] = p; });

        const liked = new Set(store.get('liked', []));
        const saved = new Set(store.get('saved', []));
        const state = { q: '', cat: 'all', sort: 'newest', view: store.get('view', 'grid'), onlySaved: false };

        let lastFocus = null;
        let toastEl = null;
        let toastTimer = null;

        const catLabel = id => (CATEGORIES.find(c => c.id === id) || {}).label || id;
        const likeCount = p => (p.likes || 0) + (liked.has(p.id) ? 1 : 0);

        /* ------------------------------------------------------------------
           2.4 TEMPLATES
           ------------------------------------------------------------------ */
        function headHTML(p) {
            return '<div class="ph-card-head">' +
                '<span class="ph-avatar" aria-hidden="true">' +
                    '<img class="logo-img logo-light" src="logo.png" alt="" onerror="this.parentNode.classList.add(\'no-logo\')">' +
                    '<img class="logo-img logo-dark" src="logo-dark.png" alt="" onerror="this.parentNode.classList.add(\'no-logo\')">' +
                    '<span class="ph-avatar-fallback">S</span>' +
                '</span>' +
                '<div class="ph-head-text">' +
                    '<span class="ph-handle">specsoft</span>' +
                    '<span class="ph-sub"><span>' + esc(p.type) + '</span><span>' + esc(p.year) + '</span></span>' +
                '</div>' +
                '<span class="ph-status ph-status--' + esc(p.status) + '">' + esc(STATUS[p.status] || '') + '</span>' +
            '</div>';
        }

        function mediaInner(p) {
            const icon = p.teaser ? ICON.lock : (ICON[p.category] || ICON.software);
            const art = '<div class="ph-art ph-art--' + esc(p.category) + (p.teaser ? ' ph-art--teaser' : '') + '">' +
                '<span class="ph-art-icon">' + icon + '</span></div>';
            const img = p.image
                ? '<img class="ph-img" src="' + esc(p.image) + '" alt="' + esc(p.title) + ' preview" loading="lazy" onerror="this.remove()">'
                : '';
            return art + img;
        }

        function tagsHTML(p) {
            return (p.tags || []).map(t => '<span>' + esc(t) + '</span>').join('');
        }

        function actionsHTML(p) {
            const id = esc(p.id), name = esc(p.title);
            return '<button type="button" class="ph-act" data-like data-id="' + id + '" aria-pressed="false" aria-label="Like ' + name + '">' +
                    ICON.heart + '<span class="ph-count"></span></button>' +
                '<button type="button" class="ph-act" data-share data-id="' + id + '" aria-label="Copy link to ' + name + '" title="Copy link">' +
                    ICON.share + '</button>' +
                '<button type="button" class="ph-act ph-act--end" data-save data-id="' + id + '" aria-pressed="false" aria-label="Save ' + name + '" title="Save">' +
                    ICON.bookmark + '</button>';
        }

        function cardHTML(p, i) {
            const id = esc(p.id);
            const media = p.teaser
                ? '<div class="ph-media">' + mediaInner(p) + '</div>'
                : '<button type="button" class="ph-media" data-open data-id="' + id + '" aria-label="Open ' + esc(p.title) + '">' + mediaInner(p) + '</button>';
            const title = p.teaser
                ? esc(p.title)
                : '<button type="button" data-open data-id="' + id + '">' + esc(p.title) + '</button>';
            const actions = p.teaser ? '' : '<div class="ph-actions">' + actionsHTML(p) + '</div>';

            return '<article class="ph-card" data-id="' + id + '" style="--i:' + i + '">' +
                headHTML(p) + media + actions +
                '<div class="ph-body">' +
                    '<h3 class="ph-title">' + title + '</h3>' +
                    '<p class="ph-summary">' + esc(p.summary) + '</p>' +
                    '<div class="ph-tags">' + tagsHTML(p) + '</div>' +
                '</div>' +
            '</article>';
        }

        /* ------------------------------------------------------------------
           2.5 BUILD THE PAGE (once)
           ------------------------------------------------------------------ */
        const cardEls = {};

        function build() {
            $('#phSearchIcon').innerHTML = ICON.search;
            $('#phSelectIcon').innerHTML = ICON.chevron;
            $('#phSavedIcon').innerHTML  = ICON.bookmark;
            $('#phViewGrid').innerHTML   = ICON.grid;
            $('#phViewList').innerHTML   = ICON.list;
            $('#phDClose').innerHTML     = ICON.close;

            const stories = PROJECTS.filter(p => p.featured && !p.teaser).map(p =>
                '<button type="button" class="ph-story" role="listitem" data-open data-id="' + esc(p.id) + '">' +
                    '<span class="ph-ring"><span class="ph-ring-core">' + (ICON[p.category] || ICON.software) + '</span></span>' +
                    '<span class="ph-story-label">' + esc(p.title) + '</span>' +
                '</button>'
            ).join('');
            $('#phStories').innerHTML = stories +
                '<a class="ph-story ph-story--add" role="listitem" href="contact.html">' +
                    '<span class="ph-ring"><span class="ph-ring-core">' + ICON.plus + '</span></span>' +
                    '<span class="ph-story-label">Pitch an idea</span>' +
                '</a>';

            const chips = [{ id: 'all', label: 'All' }].concat(CATEGORIES).map(c => {
                const n = c.id === 'all' ? PROJECTS.length : PROJECTS.filter(p => p.category === c.id).length;
                return '<button type="button" class="ph-chip" data-cat="' + c.id + '" aria-pressed="' + (c.id === 'all') + '">' +
                    esc(c.label) + ' <span class="ph-chip-n">' + n + '</span></button>';
            }).join('');
            $('#phChips').innerHTML = chips;

            grid.innerHTML = PROJECTS.map(cardHTML).join('');
            $$('.ph-card', grid).forEach(el => { cardEls[el.dataset.id] = el; });

            const hud = $('#hudCount');
            if (hud) hud.textContent = PROJECTS.filter(p => !p.teaser).length;

            grid.classList.add('is-intro');
            setTimeout(() => grid.classList.remove('is-intro'), 1400);
        }

        /* ------------------------------------------------------------------
           2.6 FILTER, SEARCH, SORT
           ------------------------------------------------------------------ */
        const sorters = {
            newest: (a, b) => (+!!a.teaser - +!!b.teaser) || (b.year - a.year) || (PROJECTS.indexOf(a) - PROJECTS.indexOf(b)),
            liked:  (a, b) => (+!!a.teaser - +!!b.teaser) || (likeCount(b) - likeCount(a)) || (b.year - a.year),
            az:     (a, b) => (+!!a.teaser - +!!b.teaser) || a.title.localeCompare(b.title)
        };

        function apply() {
            const q = state.q.trim().toLowerCase();
            let shown = 0;

            PROJECTS.forEach(p => {
                const hay = [p.title, p.summary, p.type, catLabel(p.category), (p.tags || []).join(' ')].join(' ').toLowerCase();
                const ok = (state.cat === 'all' || p.category === state.cat) &&
                           (!q || hay.includes(q)) &&
                           (!state.onlySaved || saved.has(p.id));
                cardEls[p.id].hidden = !ok;
                if (ok) shown++;
            });

            PROJECTS.slice().sort(sorters[state.sort]).forEach((p, i) => { cardEls[p.id].style.order = i; });

            grid.dataset.view = state.view;
            $$('[data-view-btn]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.viewBtn === state.view)));
            $$('#phChips .ph-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === state.cat)));
            $('#phSaved').setAttribute('aria-pressed', String(state.onlySaved));

            meta.textContent = 'Showing ' + shown + ' of ' + PROJECTS.length + ' projects';

            const none = shown === 0;
            empty.hidden = !none;
            grid.hidden = none;
            if (none) {
                emptyTxt.textContent = (state.onlySaved && saved.size === 0)
                    ? 'You have not saved any projects yet. Use the bookmark on a project to keep it here.'
                    : 'No projects match your filters. Try a different search or clear the filters.';
            }
        }

        /* ------------------------------------------------------------------
           2.7 LIKE, SAVE, SHARE
           ------------------------------------------------------------------ */
        function sync(id, pop) {
            const p = byId[id];
            if (!p) return;
            const n = likeCount(p);

            $$('[data-like][data-id="' + id + '"]').forEach(b => {
                const on = liked.has(id);
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-pressed', String(on));
                b.querySelector('.ph-count').textContent = n > 0 ? n : '';
                if (pop === 'like') flash(b);
            });

            $$('[data-save][data-id="' + id + '"]').forEach(b => {
                const on = saved.has(id);
                b.classList.toggle('is-active', on);
                b.setAttribute('aria-pressed', String(on));
                if (pop === 'save') flash(b);
            });

            $('#phSavedCount').textContent = saved.size;
        }

        function flash(btn) {
            btn.classList.remove('is-pop');
            void btn.offsetWidth;
            btn.classList.add('is-pop');
            setTimeout(() => btn.classList.remove('is-pop'), 400);
        }

        function toggle(set, key, id, kind) {
            if (set.has(id)) set.delete(id); else set.add(id);
            store.set(key, Array.from(set));
            sync(id, kind);
            if (kind === 'like' && state.sort === 'liked') apply();
            if (kind === 'save' && state.onlySaved) apply();
        }

        function toast(msg) {
            if (!toastEl) {
                toastEl = document.createElement('div');
                toastEl.className = 'ph-toast';
                toastEl.setAttribute('role', 'status');
            }
            (dlg.open ? dlg : document.body).appendChild(toastEl);
            toastEl.textContent = msg;
            void toastEl.offsetWidth;
            toastEl.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
        }

        async function share(id) {
            const p = byId[id];
            if (!p) return;
            const url = location.href.split('#')[0] + '#' + id;

            if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
                try {
                    await navigator.share({ title: p.title + ' | SPECSOFT', text: p.summary, url: url });
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }

            try {
                await navigator.clipboard.writeText(url);
                toast('Link copied');
            } catch (e) {
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (err) { /* ignore */ }
                ta.remove();
                toast(ok ? 'Link copied' : 'Copy failed. Copy the address bar link instead.');
            }
        }

        /* ------------------------------------------------------------------
           2.8 DETAIL DIALOG
           ------------------------------------------------------------------ */
        function setHash(id) {
            try {
                history.replaceState(null, '', id ? '#' + id : location.pathname + location.search);
            } catch (e) {
                location.hash = id || '';
            }
        }

        function openProject(id) {
            const p = byId[id];
            if (!p || p.teaser) return;

            if (!dlg.open) lastFocus = document.activeElement;

            $('#phDMedia').innerHTML = mediaInner(p);
            $('#phDHead').innerHTML  = headHTML(p);
            $('#phDTitle').textContent = p.title;
            $('#phDText').textContent  = p.details || p.summary;
            $('#phDMeta').innerHTML = [['Type', p.type], ['Year', p.year], ['Status', STATUS[p.status] || '']]
                .map(row => '<div><dt>' + row[0] + '</dt><dd>' + esc(row[1]) + '</dd></div>').join('');
            $('#phDTags').innerHTML    = tagsHTML(p);
            $('#phDActions').innerHTML = actionsHTML(p);

            const link = $('#phDLink');
            link.hidden = !p.link;
            if (p.link) {
                link.href = p.link;
                link.innerHTML = esc(p.linkLabel || 'OPEN PROJECT') + ' ' + ARROW;
            }

            sync(id);

            if (!dlg.open) {
                dlg.showModal();
                document.documentElement.classList.add('ph-lock');
            }
            dlg.scrollTop = 0;
            setHash(id);
        }

        dlg.addEventListener('close', () => {
            document.documentElement.classList.remove('ph-lock');
            setHash('');
            if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        });

        dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

        function openFromHash() {
            const id = decodeURIComponent(location.hash.slice(1));
            if (id && byId[id] && !byId[id].teaser) openProject(id);
            else if (!id && dlg.open) dlg.close();
        }

        /* ------------------------------------------------------------------
           2.9 EVENTS
           ------------------------------------------------------------------ */
        document.addEventListener('click', e => {
            const t = e.target.closest('[data-open],[data-like],[data-save],[data-share],[data-close]');
            if (!t) return;
            const id = t.dataset.id;

            if (t.hasAttribute('data-open'))       openProject(id);
            else if (t.hasAttribute('data-like'))  toggle(liked, 'liked', id, 'like');
            else if (t.hasAttribute('data-save'))  toggle(saved, 'saved', id, 'save');
            else if (t.hasAttribute('data-share')) share(id);
            else if (t.hasAttribute('data-close')) dlg.close();
        });

        $('#phChips').addEventListener('click', e => {
            const b = e.target.closest('[data-cat]');
            if (!b) return;
            state.cat = b.dataset.cat;
            apply();
        });

        search.addEventListener('input', () => { state.q = search.value; apply(); });
        search.addEventListener('keydown', e => {
            if (e.key === 'Escape' && search.value) { search.value = ''; state.q = ''; apply(); }
        });

        sortSel.addEventListener('change', () => { state.sort = sortSel.value; apply(); });

        $('#phSaved').addEventListener('click', () => { state.onlySaved = !state.onlySaved; apply(); });

        $$('[data-view-btn]').forEach(b => b.addEventListener('click', () => {
            state.view = b.dataset.viewBtn;
            store.set('view', state.view);
            apply();
        }));

        $('#phClear').addEventListener('click', () => {
            state.q = ''; state.cat = 'all'; state.onlySaved = false;
            search.value = '';
            apply();
        });

        document.addEventListener('keydown', e => {
            if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || dlg.open) return;
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
            e.preventDefault();
            search.focus();
        });

        window.addEventListener('hashchange', openFromHash);

        /* ------------------------------------------------------------------
           2.10 INIT
           ------------------------------------------------------------------ */
        build();
        if (state.view !== 'grid' && state.view !== 'list') state.view = 'grid';
        PROJECTS.forEach(p => { if (!p.teaser) sync(p.id); });
        apply();
        openFromHash();
    }

    /* ======================================================================
       PART 3 — BOOTSTRAP
       ====================================================================== */
    document.addEventListener('DOMContentLoaded', function () {
        // Global — runs on every page
        injectFavicon();
        injectLayout();
        highlightActiveNav();
        initThemeToggle();
        initMobileSidebar();
        initProjectsDropdown();

        // Projects hub — no-op on pages without #phGrid
        initProjectsHub();
    });

})();