/* ==========================================================================
      Combines:
     • Global layout (sidebar, theme, mobile menu, dropdowns, favicon)
     • Projects Hub (feed, filters, dialog, likes/saves)  → needs #phGrid
     • Community (animated member counter)                → needs #cmMemberCount
     • Credits Carousel (3D coverflow)                    → needs #cmCredits
   Load at the bottom of <body>. Each page-specific module self-guards and
   exits immediately if its target elements are not on the page.
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

            <div class="nav-item" id="communityToggle">
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
                <span class="nav-chevron">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </span>
            </div>

            <div class="nav-dropdown" id="communityDropdown">
                <a href="community.html" class="nav-subitem">
                    <span class="sub-bullet"></span>
                    <span>Community Hub</span>
                </a>
                <a href="chats.html" class="nav-subitem">
                    <span class="sub-bullet"></span>
                    <span>Chats</span>
                </a>
            </div>

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
            <a href="login.html" class="nav-item" data-nav="login" id="authNavLink">
                <span class="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                        <polyline points="10 17 15 12 10 7"></polyline>
                        <line x1="15" y1="12" x2="3" y2="12"></line>
                    </svg>
                </span>
                <span class="nav-text" id="authNavText">LOG IN</span>
                <span class="nav-num">05</span>
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
            <button class="theme-toggle sidebar-logout" id="logoutBtn" type="button" data-user-only hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M10 17l5-5-5-5"></path>
                    <path d="M15 12H3"></path>
                    <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"></path>
                </svg>
                <span>LOG OUT</span>
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
            SPECSOFT®
        </a>
        <button class="hamburger" id="hamburgerBtn" aria-label="Toggle Navigation" aria-expanded="false" aria-controls="sidebar">
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
            '':          'home',
            'index':     'home',
            'home':      'home',
            'community': 'community',
            'chats':     'community',
            'store':     'store',
            'roblox':    'roblox',
            'profile':   'login',
            'login':     'login'
        };

        const activeKey = navMap[pageKey] || null;

        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        if (activeKey) {
            const activeItem = document.querySelector(`.nav-item[data-nav="${activeKey}"]`);
            const dropdownToggle = activeKey === 'community'
                ? document.getElementById('communityToggle')
                : activeKey === 'projects' ? document.getElementById('projectsToggle') : null;
            if (activeItem) activeItem.classList.add('active');
            if (dropdownToggle) dropdownToggle.classList.add('active');
        }

        const activeSubitem = document.querySelector(`.nav-subitem[href="${pageKey}.html"]`);
        if (activeSubitem) {
            activeSubitem.classList.add('active');
            const parentToggle = activeSubitem.closest('.nav-dropdown')?.previousElementSibling;
            if (parentToggle) parentToggle.classList.add('active');
        }
    }

    /* ----------------------------------------------------------------------
       1.4b SIDEBAR ACCOUNT LABEL (shows your username when logged in)
       Display only. It reads the session Supabase saved in the browser;
       it does not protect anything.
       ---------------------------------------------------------------------- */
    function setAuthNavState(user) {
        const label = document.getElementById('authNavText');
        const link = document.getElementById('authNavLink');
        if (label) label.textContent = user ? 'MY PROFILE' : 'LOG IN';
        if (link) {
            link.href = user ? 'profile.html' : 'login.html';
            link.setAttribute('data-nav', user ? 'profile' : 'login');
        }
    }

    function initAuthNav() {
        const label = document.getElementById('authNavText');
        if (!label) return;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!/^sb-.+-auth-token$/.test(key)) continue;
                const sess = JSON.parse(localStorage.getItem(key));
                const u = sess && sess.user;
                if (!u) continue;
                setAuthNavState(u);
                return;
            }
        } catch (e) { /* storage blocked or unreadable: keep LOG IN */ }
    }

    function initSidebarLogout() {
        const button = document.getElementById('logoutBtn');
        if (!button) return;

        button.addEventListener('click', function () {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            try {
                const authKeys = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (/^sb-.+-auth-token$/.test(key || '')) authKeys.push(key);
                }
                authKeys.forEach(function (key) { localStorage.removeItem(key); });
                try { sessionStorage.removeItem('au_oauth'); sessionStorage.removeItem('au_next'); } catch (e) { /* storage may be blocked */ }
                if (window.SpecAuth) window.SpecAuth.refresh();
                window.location.href = 'login.html';
            } catch (err) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
                button.querySelector('span').textContent = 'LOG OUT FAILED';
            }
        });
    }

    /* ----------------------------------------------------------------------
       1.4c ACCOUNT: profile chip in the top bar + reusable avatar hooks
       ----------------------------------------------------------------------
       START account-module
       Works on every page that loads main.js. DISPLAY ONLY: it reads the
       session Supabase saved in this browser. It does not protect anything.

       Use it anywhere with plain HTML (no extra JS needed):
         <span data-user-avatar></span>                          profile picture (or initial letter)
         <span data-user-avatar style="--sp-size:64px"></span>   same, any size
         <span data-user-name></span>                            the username
         <div data-user-only> ... </div>                         only visible when logged in
         <div data-guest-only> ... </div>                        only visible when logged out

       Or from your own JS:
         SpecAuth.getUser()   returns { id, name, email, avatar, provider } or null
         SpecAuth.avatar(u)   returns a ready-made .sp-avatar element
         SpecAuth.refresh()   re-draws everything (call after login or logout)
       ---------------------------------------------------------------------- */
    const SpecAuth = (function () {
        const KEY_RE = /^sb-.+-auth-token$/;
        let chips = [];

        function getUser() {
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!KEY_RE.test(key)) continue;
                    let sess = JSON.parse(localStorage.getItem(key));
                    if (Array.isArray(sess)) sess = sess[0];            // very old supabase-js format
                    const u = sess && sess.user;
                    if (!u || !u.id) continue;

                    const m = u.user_metadata || {};
                    const name = m.username || m.full_name || m.name || m.user_name ||
                                 (u.email || '').split('@')[0] || 'member';
                    let avatar = m.sp_avatar || m.avatar_url || m.picture || '';   // sp_avatar = picture chosen on the profile page
                    if (!/^https:\/\//i.test(avatar)) avatar = '';       // only https images

                    return {
                        id: u.id,
                        name: String(name),
                        email: u.email || '',
                        avatar: avatar,
                        provider: (u.app_metadata && u.app_metadata.provider) || 'email'
                    };
                }
            } catch (e) { /* storage blocked or unreadable: treat as logged out */ }
            return null;
        }

        // A round profile picture. Falls back to the first letter if there is no image or it fails to load.
        function avatar(user, size) {
            const wrap = document.createElement('span');
            wrap.className = 'sp-avatar';
            if (size) wrap.style.setProperty('--sp-size', size);

            const initial = document.createElement('span');
            initial.className = 'sp-initial';
            initial.textContent = user && user.name ? user.name.charAt(0).toUpperCase() : '?';
            wrap.appendChild(initial);

            if (user && user.avatar) {
                const img = document.createElement('img');
                img.alt = '';
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                img.onerror = function () { img.remove(); };
                img.src = user.avatar;
                wrap.appendChild(img);
            }
            return wrap;
        }

        function makeChip(user, variant) {
            const a = document.createElement('a');
            a.className = 'sp-chip sp-chip--' + variant;
            a.href = 'profile.html';
            a.title = 'Signed in as ' + user.name;
            a.setAttribute('aria-label', 'Your account: ' + user.name);

            const wrap = document.createElement('span');
            wrap.className = 'sp-av-wrap';
            wrap.appendChild(avatar(user));
            const dot = document.createElement('i');
            dot.className = 'sp-dot';
            wrap.appendChild(dot);

            const label = document.createElement('span');
            label.className = 'sp-chip-name';
            label.textContent = user.name;

            a.appendChild(wrap);
            a.appendChild(label);
            return a;
        }

        function drawChips(user) {
            chips.forEach(function (c) { c.remove(); });
            chips = [];
            if (!user) return;

            // desktop: right side of the HUD bar (or a floating chip on pages without one)
            const hudRight = document.querySelector('.hud-bar .hud-right');
            const desktop = makeChip(user, hudRight ? 'hud' : 'float');
            (hudRight || document.body).appendChild(desktop);
            chips.push(desktop);

            // phones: in the mobile header, just before the hamburger button
            const header = document.querySelector('.mobile-header');
            if (header) {
                const mobile = makeChip(user, 'mobile');
                header.insertBefore(mobile, header.querySelector('.hamburger'));
                chips.push(mobile);
            }
        }

        function fillHooks(user) {
            document.querySelectorAll('[data-user-avatar]').forEach(function (el) {
                el.textContent = '';
                if (user) el.appendChild(avatar(user));
            });
            document.querySelectorAll('[data-user-name]').forEach(function (el) {
                el.textContent = user ? user.name : '';
            });
            document.querySelectorAll('[data-user-only]').forEach(function (el) { el.hidden = !user; });
            document.querySelectorAll('[data-guest-only]').forEach(function (el) { el.hidden = !!user; });
        }

        function refresh() {
            const user = getUser();
            drawChips(user);
            fillHooks(user);
            setAuthNavState(user);

            document.documentElement.classList.toggle('sp-authed', !!user);
            return user;
        }

        // keep every open tab in sync (log in or out in one tab, the others update)
        window.addEventListener('storage', function (e) {
            if (!e.key || KEY_RE.test(e.key)) refresh();
        });

        return { getUser: getUser, avatar: avatar, refresh: refresh };
    })();

    window.SpecAuth = SpecAuth;
    /* END account-module */

    /* ----------------------------------------------------------------------
       1.5 THEME TOGGLE
       ---------------------------------------------------------------------- */
    function initThemeToggle() {
        const themeToggle = document.getElementById('themeToggle');
        const themeLabel  = document.getElementById('themeLabel');

        if (!themeToggle) return;

        const savedTheme = localStorage.getItem('specsoft-theme');
        if (savedTheme === 'light') {
            document.body.classList.add('light-mode');
            if (themeLabel) themeLabel.textContent = 'LIGHT MODE';
        }

        themeToggle.addEventListener('click', function () {
            const isLight = document.body.classList.toggle('light-mode');
            localStorage.setItem('specsoft-theme', isLight ? 'light' : 'dark');
            if (themeLabel) themeLabel.textContent = isLight ? 'LIGHT MODE' : 'DARK MODE';
        });
    }

    /* ----------------------------------------------------------------------
       1.6 MOBILE SIDEBAR TOGGLE
       ---------------------------------------------------------------------- */
    function initMobileSidebar() {
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        const sidebar      = document.getElementById('sidebar');
        const overlay      = document.getElementById('sidebarOverlay');

        if (!hamburgerBtn || !sidebar || !overlay) return;

        function setOpen(open) {
            hamburgerBtn.classList.toggle('active', open);
            sidebar.classList.toggle('open', open);
            overlay.classList.toggle('active', open);
            hamburgerBtn.setAttribute('aria-expanded', String(open));
            document.body.style.overflow = open ? 'hidden' : '';
        }

        hamburgerBtn.addEventListener('click', () => {
            setOpen(!sidebar.classList.contains('open'));
        });

        overlay.addEventListener('click', () => setOpen(false));

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                setOpen(false);
            }
        });

        window.closeSidebar = () => setOpen(false);
    }

    /* ----------------------------------------------------------------------
       1.7 PROJECTS DROPDOWN
       ---------------------------------------------------------------------- */
    function initDropdown(toggleId, dropdownId) {
        const toggle = document.getElementById(toggleId);
        const dropdown = document.getElementById(dropdownId);
        if (!toggle || !dropdown) return;

        function setOpen(open) {
            toggle.classList.toggle('dropdown-open', open);
            dropdown.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', String(open));
        }

        toggle.setAttribute('role', 'button');
        toggle.setAttribute('tabindex', '0');
        toggle.setAttribute('aria-expanded', 'false');

        toggle.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(!toggle.classList.contains('dropdown-open'));
        });

        toggle.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(!toggle.classList.contains('dropdown-open'));
            } else if (e.key === 'Escape') {
                setOpen(false);
            }
        });
    }

    function initProjectsDropdown() { initDropdown('projectsToggle', 'projectsDropdown'); }
    function initCommunityDropdown() { initDropdown('communityToggle', 'communityDropdown'); }

    /* ----------------------------------------------------------------------
       1.8 INJECT FAVICON (system dark/light mode)
       ---------------------------------------------------------------------- */
    function injectFavicon() {
        if (document.querySelector('link[rel="icon"], link[rel="shortcut icon"]')) return;

        const links = [
            { rel: 'icon',             href: 'logo.png',      media: null },
            { rel: 'icon',             href: 'logo.png',      media: '(prefers-color-scheme: dark)' },
            { rel: 'icon',             href: 'logo-dark.png', media: '(prefers-color-scheme: light)' },
            { rel: 'apple-touch-icon', href: 'logo.png',      media: null }
        ];

        links.forEach(function (item) {
            const link = document.createElement('link');
            link.rel = item.rel;
            link.href = item.href;
            if (item.rel === 'icon') link.type = 'image/png';
            if (item.media) link.media = item.media;
            document.head.appendChild(link);
        });
    }

    /* ======================================================================
       PART 2 — PROJECTS HUB (needs #phGrid)
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

        const esc = s => String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));

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
                try {
                    localStorage.setItem('specsoft.hub.' + key, JSON.stringify(value));
                } catch (e) { /* storage blocked */ }
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

        const byId = {};
        PROJECTS.forEach(p => { byId[p.id] = p; });

        const liked = new Set(store.get('liked', []));
        const saved = new Set(store.get('saved', []));

        const state = {
            q: '',
            cat: 'all',
            sort: 'newest',
            view: store.get('view', 'grid'),
            onlySaved: false
        };

        let lastFocus = null;
        let toastEl = null;
        let toastTimer = null;

        const catLabel  = id => (CATEGORIES.find(c => c.id === id) || {}).label || id;
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
            const id = esc(p.id);
            const name = esc(p.title);
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

            const actions = p.teaser
                ? ''
                : '<div class="ph-actions">' + actionsHTML(p) + '</div>';

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

            const stories = PROJECTS
                .filter(p => p.featured && !p.teaser)
                .map(p =>
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
                const n = c.id === 'all'
                    ? PROJECTS.length
                    : PROJECTS.filter(p => p.category === c.id).length;
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
                const hay = [p.title, p.summary, p.type, catLabel(p.category), (p.tags || []).join(' ')]
                    .join(' ').toLowerCase();
                const ok = (state.cat === 'all' || p.category === state.cat) &&
                           (!q || hay.includes(q)) &&
                           (!state.onlySaved || saved.has(p.id));
                cardEls[p.id].hidden = !ok;
                if (ok) shown++;
            });

            PROJECTS.slice().sort(sorters[state.sort]).forEach((p, i) => {
                cardEls[p.id].style.order = i;
            });

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

            $('#phDMedia').innerHTML   = mediaInner(p);
            $('#phDHead').innerHTML    = headHTML(p);
            $('#phDTitle').textContent = p.title;
            $('#phDText').textContent  = p.details || p.summary;
            $('#phDMeta').innerHTML    = [['Type', p.type], ['Year', p.year], ['Status', STATUS[p.status] || '']]
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

        dlg.addEventListener('click', e => {
            if (e.target === dlg) dlg.close();
        });

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

        search.addEventListener('input', () => {
            state.q = search.value;
            apply();
        });

        search.addEventListener('keydown', e => {
            if (e.key === 'Escape' && search.value) {
                search.value = '';
                state.q = '';
                apply();
            }
        });

        sortSel.addEventListener('change', () => {
            state.sort = sortSel.value;
            apply();
        });

        $('#phSaved').addEventListener('click', () => {
            state.onlySaved = !state.onlySaved;
            apply();
        });

        $$('[data-view-btn]').forEach(b => b.addEventListener('click', () => {
            state.view = b.dataset.viewBtn;
            store.set('view', state.view);
            apply();
        }));

        $('#phClear').addEventListener('click', () => {
            state.q = '';
            state.cat = 'all';
            state.onlySaved = false;
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
       PART 2.5 — COMMUNITY (needs #cmMemberCount)
       ====================================================================== */
    function initCommunity() {
        const counter = document.getElementById('cmMemberCount');
        if (!counter) return;

        const target = parseInt(counter.dataset.target, 10) || 247;

        const reduceMotion = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduceMotion) {
            counter.textContent = target.toLocaleString();
            return;
        }

        const DURATION = 1400;
        const easeOut = t => 1 - Math.pow(1 - t, 3);

        let startTime = null;

        function step(now) {
            if (startTime === null) startTime = now;
            const t = Math.min((now - startTime) / DURATION, 1);
            counter.textContent = Math.round(easeOut(t) * target).toLocaleString();
            if (t < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
    }

    /* ======================================================================
       PART 2.6 — CREDITS: 3D SWIPEABLE CARDS + PRESENCE (needs #cmCredits)
       ----------------------------------------------------------------------
       • Drag / swipe / arrow keys / dots / click a side card
       • Discord-style status icons: active, do not disturb, idle, offline
       • LIVE badge: turns on when presence is pulled from Discord (see notes)
       ====================================================================== */
    function initCreditsCarousel() {
        const root = document.getElementById('cmCredits');
        if (!root) return;

        /* ------------------------------------------------------------------
           2.6.1 CREDITS DATA — edit this to add/remove people
           ------------------------------------------------------------------
           status    'online' (green) | 'dnd' (red + bar) | 'idle' (yellow moon) | 'offline' (grey)
                     This is the manual fallback. It is replaced automatically
                     when a discordId is set and the live lookup works.
           discordId OPTIONAL. A Discord user ID (Settings > Advanced > Developer
                     Mode, then right-click the profile > Copy User ID).
                     The person must also join the Lanyard Discord server
                     (discord.gg/lanyard) for live status to work.
           avatar    OPTIONAL image path/URL. Empty = Discord avatar (if live)
                     or the initial letter.
           tags      OPTIONAL small chips.
           links     OPTIONAL buttons: { label, url }.
           placeholder  true = dashed "open slot" card (no status icon).
           ------------------------------------------------------------------ */
        const CREDITS = [
            {
                initial: 'S',
                name: 'SPECSOFT® Founder',
                handle: '@aspec_404',
                role: 'Founder / Lead Developer',
                bio: 'Building SPECSOFT from the ground up. Software, games, and everything in between.',
                status: 'dnd',
                discordId: '',
                avatar: 'https://cdn.discordapp.com/avatars/952887396339437578/47f036ea387e4527969112aa2debb024.png?size=1024',
                tags: ['Development', 'Softwares'],
                links: []
            },
            {
                initial: 'K',
                name: 'SPECSOFT® Community Head Management',
                handle: '@nothingtazuna',
                role: 'Community Manager / Supporter',
                bio: 'Join the community and help build what comes next.',
                status: 'online',
                discordId: '',
                avatar: 'https://cdn.discordapp.com/avatars/888045612606578708/9a16271ee03525e5eaa66e02878897b2.png?size=1024',
                tags: ['Development', 'Support'],
                links: []
            },
            {
                initial: 'U',
                name: 'SPECSOFT® Operations Chairman',
                handle: '@solarnamer',
                role: 'Contributor / Operations / Recruitment',
                bio: 'Join the community and help build what comes next.',
                status: 'idle',
                discordId: '',
                avatar: 'https://cdn.discordapp.com/avatars/991653286719524997/56c02f007eb5bee3c8cc823f1eabe136.png?size=1024',
                tags: ['Recruitment', 'Operations'],
                links: []
            },
            {
                initial: 'A',
                name: 'SPECSOFT® Moderation Team',
                handle: '@.ynn4v1',
                role: 'Enforcer / Moderator',
                bio: 'Keeping the community safe and fun for everyone, away from the chaos.',
                status: 'idle',
                discordId: '',
                avatar: 'https://cdn.discordapp.com/avatars/1524043677696135309/e8ef21c447f8450d4d9a5eb80c12f1ab.png?size=1024',
                tags: ['Moderation'],
                links: []
            },
            {
                initial: 'E',
                name: 'SPECSOFT® Early Supporter',
                handle: '@escobedo1233037',
                role: 'Early Supporter / VIP',
                bio: 'Supporting the community and helping it grow from the start. "Yeah i\'m helping the community grow and i will be here for a long time." - Escobedo1233037',
                status: 'online',
                discordId: '',
                avatar: 'https://cdn.discordapp.com/avatars/753396554462789693/5361cc9a2465362cf30c5a43839a4d63.png?size=1024',
                tags: ['Supporter', 'VIP'],
                links: []
            },
            {
                initial: 'R',
                name: 'SPECSOFT® Community Management',
                handle: '@itztwilight_',
                role: 'Community Manager / Development',
                bio: 'Helping the community grow and assisting in development. "I\'m here to help the community grow and make it a better place." - itztwilight_',
                status: 'idle',
                discordId: '',
                avatar: 'https://cdn.discordapp.com/avatars/1218806016339214386/488729882cd45640fbb95c551fd0fb2a.png?size=1024',
                tags: ['Community', 'Development'],
                links: []
            },
            {
                initial: '+',
                name: 'Join the team!',
                handle: '@yournamehere',
                role: 'Open Position',
                bio: 'We\'re always looking for talented individuals to join our team. If you\'re interested in contributing to the community and helping us grow, reach out to us!',
                status: 'offline',
                discordId: '',
                avatar: '',
                placeholder: true,
                links: [{ label: 'Join the team!', url: 'https://discord.gg/a3FEnaMh85' }]
            }
        ];

        const PRESENCE_URL = 'https://api.lanyard.rest/v1/users/';
        const POLL_MS = 45000;

        /* ------------------------------------------------------------------
           2.6.2 ELEMENTS + HELPERS
           ------------------------------------------------------------------ */
        const stage     = document.getElementById('crStage');
        const track     = document.getElementById('crTrack');
        const nav       = document.getElementById('crNav');
        const prevBtn   = document.getElementById('crPrev');
        const nextBtn   = document.getElementById('crNext');
        const dotsEl    = document.getElementById('crDots');
        const counterEl = document.getElementById('crCounter');
        const liveEl    = document.getElementById('crLive');
        const liveText  = document.getElementById('crLiveText');
        const summaryEl = document.getElementById('crSummary');
        const hintEl    = document.getElementById('crHint');
        const announce  = document.getElementById('crAnnounce');
        const carousel  = document.getElementById('crCarousel');

        if (!stage || !track || !carousel) return;

        const total = CREDITS.length;
        if (!total) { root.hidden = true; return; }

        const reduceMotion = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const esc = s => String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
        const safeUrl = u => /^\s*(javascript|data|vbscript):/i.test(u) ? '#' : u;
        const mod = (n, m) => ((n % m) + m) % m;
        const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

        const STATUS = {
            online:  { label: 'ACTIVE',         aria: 'Active' },
            dnd:     { label: 'DO NOT DISTURB', aria: 'Do not disturb' },
            idle:    { label: 'IDLE',           aria: 'Idle' },
            offline: { label: 'OFFLINE',        aria: 'Offline' }
        };

        /* Status icons (same shapes as Discord): circle, circle + bar, moon, grey circle */
        function statusIcon(s) {
            switch (s) {
                case 'dnd':
                    return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
                           '<circle cx="10" cy="10" r="10" fill="#f23f43"/>' +
                           '<rect class="cr-dnd-bar" x="4.5" y="8.4" width="11" height="3.2" rx="1.6"/></svg>';
                case 'idle':
                    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
                           '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="#f0b232"/></svg>';
                case 'offline':
                    return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
                           '<circle cx="10" cy="10" r="10" fill="#80848e"/></svg>';
                default:
                    return '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
                           '<circle cx="10" cy="10" r="10" fill="#23a55a"/></svg>';
            }
        }

        /* ------------------------------------------------------------------
           2.6.3 BUILD CARDS
           ------------------------------------------------------------------ */
        function presenceHTML(c) {
            if (c.placeholder) return '<span class="cr-slot">OPEN SLOT</span>';
            const m = STATUS[c.status] || STATUS.offline;
            return statusIcon(c.status) + '<span>' + m.label + '</span><span class="cr-live-tag">LIVE</span>';
        }

        function avatarHTML(c) {
            const src = c.avatar || c.avatarUrl;
            return '<span class="cr-initial">' + esc(c.initial) + '</span>' +
                   (src ? '<img src="' + esc(safeUrl(src)) + '" alt="" loading="lazy" onerror="this.remove()">' : '');
        }

        function cardHTML(c, i) {
            const status = c.placeholder ? 'slot' : (STATUS[c.status] ? c.status : 'offline');
            const badge = c.placeholder ? '' :
                '<span class="cr-status" role="img" aria-label="' + esc((STATUS[status] || STATUS.offline).aria) + '">' +
                statusIcon(status) + '</span>';

            const tags = (c.tags || []).map(t => '<span>' + esc(t) + '</span>').join('');
            const links = (c.links || []).map(l => {
                const url = safeUrl(l.url || '#');
                const ext = /^https?:\/\//i.test(url);
                return '<a class="cr-link" href="' + esc(url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>';
            }).join('');

            return '<article class="cr-card' + (c.placeholder ? ' cr-card--placeholder' : '') + '"' +
                    ' data-index="' + i + '" data-status="' + status + '" data-live="false"' +
                    ' role="group" aria-roledescription="slide" aria-label="' + (i + 1) + ' of ' + total + '">' +
                '<div class="cr-card-inner">' +
                    '<div class="cr-surface"><div class="cr-shine"></div><div class="cr-dim"></div></div>' +
                    '<div class="cr-content">' +
                        '<i class="cr-bracket cr-bracket--tl"></i><i class="cr-bracket cr-bracket--br"></i>' +
                        '<div class="cr-top">' +
                            '<span class="cr-id">ID ' + String(i + 1).padStart(3, '0') + '</span>' +
                            '<span class="cr-presence">' + presenceHTML(c) + '</span>' +
                        '</div>' +
                        '<div class="cr-avatar-wrap">' +
                            '<span class="cr-avatar-ring"></span>' +
                            '<span class="cr-avatar">' + avatarHTML(c) + '</span>' +
                            badge +
                        '</div>' +
                        '<h3 class="cr-name">' + esc(c.name) + '</h3>' +
                        '<p class="cr-handle">' + esc(c.handle) + '</p>' +
                        '<p class="cr-role">' + esc(c.role) + '</p>' +
                        '<p class="cr-bio">' + esc(c.bio) + '</p>' +
                        (tags ? '<div class="cr-tags">' + tags + '</div>' : '') +
                        (links ? '<div class="cr-links">' + links + '</div>' : '') +
                    '</div>' +
                '</div>' +
            '</article>';
        }

        track.innerHTML = CREDITS.map(cardHTML).join('');
        const cards = Array.from(track.children);

        let dots = [];
        if (total > 1) {
            dotsEl.innerHTML = CREDITS.map((c, i) =>
                '<button type="button" class="cr-dot" data-index="' + i + '" aria-label="Show ' + esc(c.name) + '"></button>'
            ).join('');
            dots = Array.from(dotsEl.children);
        } else {
            if (nav) nav.hidden = true;
            if (hintEl) hintEl.hidden = true;
        }

        /* ------------------------------------------------------------------
           2.6.4 3D LAYOUT (continuous position so dragging feels physical)
           ------------------------------------------------------------------ */
        const wrap = total >= 3;          // loop around when there are 3+ cards
        let pos = 0;                      // current (fractional) position
        let target = 0;                   // where we are animating to
        let raf = 0;
        let stepX = 260;                  // horizontal distance between cards
        let spread = reduceMotion ? 1 : 0; // intro: cards fan out from the middle
        let curIdx = -1;

        function measure() {
            stepX = clamp(stage.clientWidth * 0.31, 80, 270);
        }

        function offsetOf(i) {
            let d = i - pos;
            if (wrap) d -= total * Math.round(d / total);
            return d;
        }

        function render() {
            const near = wrap ? mod(Math.round(pos), total) : clamp(Math.round(pos), 0, total - 1);

            for (let i = 0; i < total; i++) {
                const d = offsetOf(i);
                const a = Math.abs(d);
                const dir = d < 0 ? -1 : 1;

                const x = dir * (a <= 1 ? a * stepX : stepX + (a - 1) * stepX * 0.3) * spread;
                const z = -Math.min(a, 2.5) * 150;
                const rot = -dir * Math.min(a, 1) * 42 * spread;
                const sc = 1 - Math.min(a, 2) * 0.09;

                let op = a <= 1 ? 1 - a * 0.18 : Math.max(0, 0.82 - (a - 1) * 0.9);
                if (wrap) op *= clamp((total / 2 - a) / 0.5, 0, 1);

                const el = cards[i];
                el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,' + z.toFixed(1) + 'px) rotateY(' + rot.toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
                el.style.opacity = op.toFixed(3);
                el.style.zIndex = String(Math.round(100 - a * 10));
                el.style.setProperty('--dim', (Math.min(a, 1) * 0.5).toFixed(3));
                el.style.pointerEvents = op < 0.05 ? 'none' : '';
                el.style.visibility = op < 0.01 ? 'hidden' : '';
            }

            if (near !== curIdx) setActive(near);
        }

        function setActive(i) {
            curIdx = i;
            cards.forEach((el, n) => {
                const on = n === i;
                el.classList.toggle('is-active', on);
                el.setAttribute('aria-hidden', on ? 'false' : 'true');
                el.querySelectorAll('a, button').forEach(f => { f.tabIndex = on ? 0 : -1; });
            });
            dots.forEach((d, n) => d.setAttribute('aria-current', String(n === i)));
            if (counterEl) counterEl.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0');
            resetTilt();

            if (announce) {
                const c = CREDITS[i];
                const st = c.placeholder ? 'open slot' : (STATUS[c.status] || STATUS.offline).aria;
                announce.textContent = (i + 1) + ' of ' + total + ': ' + c.name + ', ' + st;
            }
        }

        function tick() {
            const diff = target - pos;
            if (Math.abs(diff) < 0.0008) {
                pos = target;
                raf = 0;
                render();
                return;
            }
            pos += diff * 0.16;
            render();
            raf = requestAnimationFrame(tick);
        }

        function animate() {
            if (reduceMotion) { pos = target; render(); return; }
            if (!raf) raf = requestAnimationFrame(tick);
        }

        function goTo(i) {
            const base = Math.round(target);
            if (wrap) {
                let d = mod(i - base, total);
                if (d > total / 2) d -= total;
                target = base + d;
            } else {
                target = clamp(i, 0, total - 1);
            }
            animate();
        }

        function step(n) {
            const base = Math.round(target) + n;
            target = wrap ? base : clamp(base, 0, total - 1);
            animate();
        }

        /* ------------------------------------------------------------------
           2.6.5 DRAG / SWIPE (with momentum)
           ------------------------------------------------------------------ */
        let drag = null;
        let justDragged = false;

        function onDown(e) {
            if (total < 2) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.target.closest('a, button')) return;
            drag = {
                id: e.pointerId, x: e.clientX, y: e.clientY, pos0: pos,
                lastX: e.clientX, lastT: performance.now(), v: 0, axis: null
            };
        }

        function onMove(e) {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;

            if (!drag.axis) {
                if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
                drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                if (drag.axis === 'x') {
                    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
                    stage.classList.add('is-dragging');
                    if (raf) { cancelAnimationFrame(raf); raf = 0; }
                    resetTilt();
                }
            }
            if (drag.axis !== 'x') return;

            const now = performance.now();
            const dt = Math.max(1, now - drag.lastT);
            drag.v = 0.8 * drag.v + 0.2 * ((e.clientX - drag.lastX) / dt);
            drag.lastX = e.clientX;
            drag.lastT = now;

            let np = drag.pos0 - dx / stepX;
            if (!wrap) {
                if (np < 0) np *= 0.35;
                if (np > total - 1) np = (total - 1) + (np - (total - 1)) * 0.35;
            }
            pos = np;
            target = np;
            render();
        }

        function onUp(e) {
            if (!drag || (e && e.pointerId !== drag.id)) return;
            const d = drag;
            drag = null;
            stage.classList.remove('is-dragging');

            if (d.axis === 'x') {
                const cardsPerSec = (-d.v * 1000) / stepX;
                const base = Math.round(d.pos0);
                let t = Math.round(pos + cardsPerSec * 0.18);
                t = clamp(t, base - 2, base + 2);
                target = wrap ? t : clamp(t, 0, total - 1);
                justDragged = true;
                setTimeout(() => { justDragged = false; }, 60);
                animate();
            }
        }

        stage.addEventListener('pointerdown', onDown);
        stage.addEventListener('pointermove', onMove);
        stage.addEventListener('pointerup', onUp);
        stage.addEventListener('pointercancel', onUp);

        /* ------------------------------------------------------------------
           2.6.6 CLICK / KEYBOARD / BUTTONS
           ------------------------------------------------------------------ */
        cards.forEach((el, i) => {
            el.addEventListener('click', e => {
                if (justDragged) return;
                if (i !== curIdx && !e.target.closest('a')) goTo(i);
            });
        });

        dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));
        if (prevBtn) prevBtn.addEventListener('click', () => step(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => step(1));

        carousel.addEventListener('keydown', e => {
            if (total < 2) return;
            if (e.key === 'ArrowRight')     { e.preventDefault(); step(1); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
            else if (e.key === 'Home')      { e.preventDefault(); goTo(0); }
            else if (e.key === 'End')       { e.preventDefault(); goTo(total - 1); }
        });

        /* ------------------------------------------------------------------
           2.6.7 TILT + SHINE on the front card (mouse only)
           ------------------------------------------------------------------ */
        const canTilt = !reduceMotion && window.matchMedia &&
            window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        function resetTilt() {
            cards.forEach(el => {
                el.classList.remove('is-tilting');
                const inner = el.firstElementChild;
                inner.style.removeProperty('--rx');
                inner.style.removeProperty('--ry');
            });
        }

        if (canTilt) {
            stage.addEventListener('pointermove', e => {
                if (drag || curIdx < 0) return;
                const el = cards[curIdx];
                const r = el.getBoundingClientRect();
                const nx = (e.clientX - r.left) / r.width - 0.5;
                const ny = (e.clientY - r.top) / r.height - 0.5;
                if (Math.abs(nx) > 0.6 || Math.abs(ny) > 0.6) { resetTilt(); return; }
                const inner = el.firstElementChild;
                inner.style.setProperty('--rx', (-ny * 12).toFixed(2) + 'deg');
                inner.style.setProperty('--ry', (nx * 16).toFixed(2) + 'deg');
                el.style.setProperty('--mx', ((nx + 0.5) * 100).toFixed(1) + '%');
                el.style.setProperty('--my', ((ny + 0.5) * 100).toFixed(1) + '%');
                el.classList.add('is-tilting');
            });
            stage.addEventListener('pointerleave', resetTilt);
        }

        /* ------------------------------------------------------------------
           2.6.8 PRESENCE UI (LIVE badge, summary, per-card status)
           ------------------------------------------------------------------ */
        let liveOk = false;

        function paintCard(i) {
            const c = CREDITS[i];
            if (c.placeholder) return;
            const el = cards[i];
            const status = STATUS[c.status] ? c.status : 'offline';

            el.dataset.status = status;
            el.dataset.live = c.live ? 'true' : 'false';
            el.querySelector('.cr-presence').innerHTML = presenceHTML(Object.assign({}, c, { status: status }));

            const badge = el.querySelector('.cr-status');
            badge.innerHTML = statusIcon(status);
            badge.setAttribute('aria-label', STATUS[status].aria);

            if (c.avatarUrl && !c.avatar && !el.querySelector('.cr-avatar img')) {
                el.querySelector('.cr-avatar').insertAdjacentHTML('beforeend',
                    '<img src="' + esc(c.avatarUrl) + '" alt="" loading="lazy" onerror="this.remove()">');
            }
        }

        function paintSummary() {
            const people = CREDITS.filter(c => !c.placeholder);
            const n = s => people.filter(c => c.status === s).length;
            const parts = [];
            if (n('online')) parts.push(n('online') + ' ACTIVE');
            if (n('idle'))   parts.push(n('idle') + ' IDLE');
            if (n('dnd'))    parts.push(n('dnd') + ' DND');

            if (summaryEl) {
                summaryEl.textContent = parts.length ? parts.join('   ') : (people.length ? 'EVERYONE IS OFFLINE' : '');
            }
            if (liveEl) liveEl.dataset.live = String(liveOk);
            if (liveText) liveText.textContent = liveOk ? 'LIVE' : 'STATUS';
        }

        function paintAll() {
            for (let i = 0; i < total; i++) paintCard(i);
            paintSummary();
        }

        /* ------------------------------------------------------------------
           2.6.9 LIVE PRESENCE (optional, uses the free Lanyard API)
           Only runs for people who have a discordId. If anything fails, the
           manual status above stays in place and nothing breaks.
           ------------------------------------------------------------------ */
        async function pullPresence() {
            const people = CREDITS.filter(c => c.discordId);
            if (!people.length || !window.fetch) return;

            let ok = 0;
            await Promise.all(people.map(async c => {
                try {
                    const res = await fetch(PRESENCE_URL + encodeURIComponent(c.discordId), { cache: 'no-store' });
                    if (!res.ok) return;
                    const json = await res.json();
                    if (!json || !json.success || !json.data) return;

                    const s = json.data.discord_status;
                    c.status = STATUS[s] ? s : 'offline';
                    c.live = true;

                    const u = json.data.discord_user;
                    if (u && u.avatar && !c.avatar) {
                        c.avatarUrl = 'https://cdn.discordapp.com/avatars/' + encodeURIComponent(c.discordId) + '/' + encodeURIComponent(u.avatar) + '.png?size=256';
                    }
                    ok++;
                } catch (err) { /* keep manual status */ }
            }));

            liveOk = ok > 0;
            paintAll();
        }

        if (CREDITS.some(c => c.discordId)) {
            pullPresence();
            setInterval(() => { if (!document.hidden) pullPresence(); }, POLL_MS);
            document.addEventListener('visibilitychange', () => { if (!document.hidden) pullPresence(); });
        }

        /* ------------------------------------------------------------------
           2.6.10 INIT + ONE-TIME INTRO (cards fan out when scrolled into view)
           ------------------------------------------------------------------ */
        function runIntro() {
            if (spread >= 1) return;
            const start = performance.now();
            const DUR = 1000;
            (function frame(now) {
                const t = clamp((now - start) / DUR, 0, 1);
                spread = 1 - Math.pow(1 - t, 3);
                render();
                if (t < 1) requestAnimationFrame(frame);
            })(start);
        }

        measure();
        render();
        paintAll();

        if ('ResizeObserver' in window) {
            new ResizeObserver(() => { measure(); render(); }).observe(stage);
        } else {
            window.addEventListener('resize', () => { measure(); render(); });
        }

        if (spread < 1) {
            if ('IntersectionObserver' in window) {
                const io = new IntersectionObserver(entries => {
                    if (entries.some(en => en.isIntersecting)) { io.disconnect(); runIntro(); }
                }, { threshold: 0.35 });
                io.observe(stage);
            } else {
                spread = 1;
                render();
            }
        }
    }


/* ======================================================================
       PART 3 — BOOTSTRAP
       ====================================================================== */
    document.addEventListener('DOMContentLoaded', function () {
        // Global — every page
        injectFavicon();
        injectLayout();
        highlightActiveNav();
        initAuthNav();
        SpecAuth.refresh();
        initSidebarLogout();
        initThemeToggle();
        initMobileSidebar();
        initProjectsDropdown();
        initCommunityDropdown();

        // Page-specific — each self-guards and exits if its elements aren't present
        // projects.js owns the current Projects Hub when that page-specific
        // bundle is present. Avoid running the legacy renderer over the same
        // toolbar and grid (which duplicates its icons and content).
        if (!document.querySelector('script[src$="projects.js"]')) initProjectsHub();
        initCommunity();
        initCreditsCarousel();

        // 🍂 Inject Autumn Leaves
        if (!document.querySelector('.halloween-bats')) {
            const leaves = document.createElement('div');
            leaves.className = 'halloween-bats';
            leaves.innerHTML = `
                <div class="leaf"></div>
                <div class="leaf"></div>
                <div class="leaf"></div>
                <div class="leaf"></div>
                <div class="leaf"></div>
            `;
            document.body.appendChild(leaves);
        }
    });

})();


/* ======================================================================
   SPECSOFT® roles.js loader: badges, the "online" heartbeat for the admin
   dashboard, and the account-standing banner, on every page that uses main.js.
   (It needs the Supabase script to be on the page; if it is not, it does nothing.)
   ====================================================================== */
(function () {
    if (window.SpecRoles || document.querySelector('script[src$="roles.js"]')) return;
    var s = document.createElement('script');
    s.src = 'roles.js';
    s.defer = true;
    document.head.appendChild(s);
})();


/* ======================================================================
   SPECSOFT® notifications.js loader: the bell (Main / Events / System),
   on every page that uses main.js.
   (It needs the Supabase script to be on the page; if it is not, it does nothing.)
   ====================================================================== */
(function () {
    if (window.SpecNotifications || document.querySelector('script[src$="notifications.js"]')) return;
    var s = document.createElement('script');
    s.src = 'notifications.js';
    s.defer = true;
    document.head.appendChild(s);
})();


/* ======================================================================
   SPECSOFT® site-fx loader: the generic "LIVE TERMINAL OS" layer (radar
   glow, 3D tilt, cursor reticle, scroll reveal, magnetic buttons,
   data-pulse) on every page that uses main.js. See site-fx.js/site-fx.css —
   index.html additionally loads index-fx.js/index-fx.css itself for the
   homepage-only pieces (headline decode, terminal typewriter, scroll rail).
   ====================================================================== */
(function () {
    if (document.querySelector('link[href$="site-fx.css"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'site-fx.css';
    document.head.appendChild(link);
})();
(function () {
    if (window.SpecFX || document.querySelector('script[src$="site-fx.js"]')) return;
    var s = document.createElement('script');
    s.src = 'site-fx.js';
    s.defer = true;
    document.head.appendChild(s);
})();


/* ======================================================================
   SPECSOFT® 3D background loader: a WebGL particle field + wireframe core
   behind the page (see index-3d.js), on every page that uses main.js. Three
   first, in document order (async = false, not defer — index-3d.js needs
   the THREE global to already exist when it runs), then the scene itself.
   Does nothing if the CDN can't be reached — the page already has its flat
   2D grid-bg as the real background, so this is a pure bonus layer.
   ====================================================================== */
(function () {
    if (window.THREE || document.getElementById('bg3d') || document.querySelector('script[src$="index-3d.js"]')) return;
    var three = document.createElement('script');
    three.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
    three.async = false;
    document.head.appendChild(three);

    var bg3d = document.createElement('script');
    bg3d.src = 'index-3d.js';
    bg3d.async = false;
    document.head.appendChild(bg3d);
})();