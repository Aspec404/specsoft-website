/* ==========================================================================
   SPECSOFT® — Main JavaScript
   Handles: Sidebar injection, theme toggle, mobile menu, dropdowns, favicon
   ========================================================================== */

(function () {
    'use strict';

    /* ==========================================================================
       1. SIDEBAR COMPONENT (injected into every page)
       ========================================================================== */
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
                <!-- GITHUB -->
                <a href="https://github.com/yourusername" target="_blank" rel="noopener" aria-label="Github">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M12 0.297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.387 0.6 0.113 0.82-0.26 0.82-0.58 0-0.283-0.01-1.04-0.016-2.04-3.338 0.725-4.042-1.61-4.042-1.61-0.546-1.387-1.333-1.756-1.333-1.756-1.09-0.745 0.083-0.729 0.083-0.729 1.205 0.084 1.84 1.236 1.84 1.236 1.07 1.834 2.81 1.304 3.495 0.997 0.108-0.776 0.418-1.305 0.762-1.605-2.665-0.303-5.467-1.334-5.467-5.931 0-1.31 0.47-2.381 1.236-3.221-0.124-0.303-0.535-1.524 0.117-3.176 0 0 1.008-0.322 3.301 1.23 0.957-0.266 1.983-0.399 3.003-0.404 1.02 0.005 2.047 0.138 3.006 0.404 2.291-1.552 3.297-1.23 3.297-1.23 0.653 1.653 0.242 2.874 0.118 3.176 0.77 0.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.48 5.922 0.43 0.372 0.814 1.102 0.814 2.222 0 1.604-0.014 2.896-0.014 3.291 0 0.322 0.216 0.698 0.824 0.579C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                    </svg>
                </a>

                <!-- DISCORD -->
                <a href="https://discord.gg/yourinvite" target="_blank" rel="noopener" aria-label="Discord">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
                    </svg>
                </a>

                <!-- ROBLOX -->
                <a href="https://www.roblox.com/groups/yourgroupid" target="_blank" rel="noopener" aria-label="Roblox">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <path d="M5.164 0L.001 18.836 18.836 24 24 5.164 5.164 0zm7.281 10.278l4.683 1.257-1.257 4.683-4.683-1.257 1.257-4.683z"/>
                    </svg>
                </a>
            </div>
        </div>
    `;

    /* ==========================================================================
       2. MOBILE HEADER COMPONENT
       ========================================================================== */
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

    /* ==========================================================================
       3. INJECT SIDEBAR & MOBILE HEADER
       ========================================================================== */
    function injectLayout() {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) {
            sidebar.innerHTML = SIDEBAR_HTML;
        }

        const mobileHeader = document.querySelector('.mobile-header');
        if (mobileHeader) {
            mobileHeader.innerHTML = MOBILE_HEADER_HTML;
        }
    }

    /* ==========================================================================
       4. AUTO-HIGHLIGHT ACTIVE NAV ITEM
       ========================================================================== */
    function highlightActiveNav() {
        let currentPage = window.location.pathname.split('/').pop() || 'index.html';
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

    /* ==========================================================================
       5. THEME TOGGLE
       ========================================================================== */
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

    /* ==========================================================================
       6. MOBILE SIDEBAR TOGGLE
       ========================================================================== */
    function initMobileSidebar() {
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (!hamburgerBtn || !sidebar || !overlay) return;

        function toggleSidebar() {
            hamburgerBtn.classList.toggle('active');
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');

            if (sidebar.classList.contains('open')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
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

    /* ==========================================================================
       7. PROJECTS DROPDOWN
       ========================================================================== */
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

    /* ==========================================================================
       8. INJECT FAVICON (with dark/light mode variants)
       ========================================================================== */
    function injectFavicon() {
        const existing = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (existing) return;

        // Dark mode favicon (white logo)
        const darkFavicon = document.createElement('link');
        darkFavicon.rel = 'icon';
        darkFavicon.type = 'image/png';
        darkFavicon.href = 'logo.png';
        darkFavicon.media = '(prefers-color-scheme: dark)';
        document.head.appendChild(darkFavicon);

        // Light mode favicon (black logo)
        const lightFavicon = document.createElement('link');
        lightFavicon.rel = 'icon';
        lightFavicon.type = 'image/png';
        lightFavicon.href = 'logo-dark.png';
        lightFavicon.media = '(prefers-color-scheme: light)';
        document.head.appendChild(lightFavicon);

        // Fallback (older browsers that don't support prefers-color-scheme)
        const fallback = document.createElement('link');
        fallback.rel = 'icon';
        fallback.type = 'image/png';
        fallback.href = 'logo.png';
        document.head.appendChild(fallback);

        // Apple touch icon
        const apple = document.createElement('link');
        apple.rel = 'apple-touch-icon';
        apple.href = 'logo.png';
        document.head.appendChild(apple);
    }

    /* ==========================================================================
       9. INITIALIZE EVERYTHING
       ========================================================================== */
    document.addEventListener('DOMContentLoaded', function () {
        injectFavicon();
        injectLayout();
        highlightActiveNav();
        initThemeToggle();
        initMobileSidebar();
        initProjectsDropdown();
    });

})();