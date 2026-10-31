/* ==========================================================================
   SPECSOFT® — Login / Sign up (auth.js)
   Load AFTER main.js (and after the Supabase CDN script).

   SETUP (2 minutes):
   1. supabase.com > your project > Project Settings > API
   2. Copy the "Project URL" and the "anon public" key into CONFIG below.
   3. NEVER paste the "service_role" key here. It is a secret and gives full
      access to your database. Only the anon key belongs in website code.
   ========================================================================== */
(function () {
    'use strict';

    // supabase-config.js (loaded first on login.html) only knows the URL and key, so merge it over the defaults
    const CONFIG = Object.assign({
        SUPABASE_URL: 'https://mcpjjmbvuzclzrniunkq.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_uuybm3j2xZ0wdrbIhxANCQ_QApPdkv7',
        DEFAULT_NEXT: 'community.html',
        MIN_PASSWORD: 8,
        // YOUR LIVE ADDRESS, e.g. 'https://yoursite.netlify.app' (no slash at the end, https only).
        // When you test from 127.0.0.1 / localhost / your home network, email links (confirm, reset password)
        // point here instead, so they open on any device. Leave '' to keep links on the page you are on.
        LIVE_SITE: ''
    }, window.SPECSOFT_CONFIG || {});

    const card = document.getElementById('auCard');
    if (!card) return;

    /* ----------------------------------------------------------------------
       1. HELPERS
       ---------------------------------------------------------------------- */
    const $  = id => document.getElementById(id);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const RE_USER  = /^[A-Za-z0-9_]{3,20}$/;

    const sb = window.getSupabaseClient ? window.getSupabaseClient() : (
        (window.supabase && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY)
            ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
            : null
    );

    if (!sb) $('auConfig').hidden = false;

    const baseUrl = () => location.origin + location.pathname;
    // ----- where links in EMAILS lead -----
    // Emails get opened on other devices (your phone), where 127.0.0.1 / localhost means "this phone" and fails.
    // So on a local or home-network address, email links use LIVE_SITE instead. On the real site nothing changes.
    // (Discord login is not an email link: it returns to the same device, so it keeps using baseUrl().)
    const LIVE_SITE = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(String(CONFIG.LIVE_SITE || '').trim().replace(/\/+$/, ''))
        ? String(CONFIG.LIVE_SITE).trim().replace(/\/+$/, '') : '';
    const onLocalAddress = () => location.protocol === 'file:' ||
        /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    const emailBase = () => (LIVE_SITE && onLocalAddress())
        ? LIVE_SITE + '/'
        : location.origin + location.pathname.replace(/[^/]*$/, '');
    // the SPECSOFT "activation successful" page, and the login page that shows the new-password form
    const verifiedUrl = () => emailBase() + 'verified.html';
    const recoveryUrl = () => emailBase() + 'login.html';
    const canOAuth = () => /^https?:$/.test(location.protocol);

    // Only allow redirects to a local .html page (blocks open-redirect tricks)
    function safeNext() {
        let p = new URLSearchParams(location.search).get('next');
        try { p = p || sessionStorage.getItem('au_next'); } catch (e) { /* ignore */ }
        p = p || CONFIG.DEFAULT_NEXT;
        const ok = /^[A-Za-z0-9_\-./]+\.html(\?[A-Za-z0-9_\-=&%.]*)?(#[A-Za-z0-9_\-]*)?$/.test(p) &&
                   !p.startsWith('/') && !p.includes('..') && !/^login\.html/i.test(p);
        return ok ? p : CONFIG.DEFAULT_NEXT;
    }

    /* ----------------------------------------------------------------------
       2. TERMINAL FEEDBACK (left side, desktop)
       ---------------------------------------------------------------------- */
    const term = $('auTermBody');

    function termLog(text, kind) {
        if (!term) return;
        const line = document.createElement('div');
        line.className = 'au-term-line is-new';
        const mark = document.createElement('span');
        mark.className = kind === 'ok' ? 'au-t-ok' : kind === 'bad' ? 'au-t-bad' : 'au-t-dim';
        mark.textContent = kind === 'ok' ? '✔' : kind === 'bad' ? '✖' : '>';
        line.appendChild(mark);
        line.appendChild(document.createTextNode(' ' + text));

        term.querySelectorAll('.au-cursor').forEach(c => c.remove());
        term.appendChild(line);
        while (term.children.length > 7) term.removeChild(term.firstChild);
    }

    /* ----------------------------------------------------------------------
       3. PANELS + MODES
       ---------------------------------------------------------------------- */
    const COPY = {
        login:   { title: 'Log in',          sub: 'Welcome back. Pick up where you left off.',        h1: ['WELCOME', 'BACK.'] },
        signup:  { title: 'Create account',  sub: 'Join the SPECSOFT® community in a few seconds.',  h1: ['JOIN THE', 'BUILD.'] },
        forgot:  { title: 'Reset password',  sub: 'Enter your email and we will send you a reset link.', h1: ['LOST YOUR', 'KEY?'] },
        reset:   { title: 'New password',    sub: 'Choose a new password for your account.',          h1: ['NEW', 'KEY.'] },
        check:   { title: 'Check your email', sub: '',                                                h1: ['CHECK YOUR', 'INBOX.'] },
        username:{ title: 'Pick a username', sub: 'This is how people will see you on SPECSOFT\u00ae.', h1: ['PICK YOUR', 'NAME.'] },
        success: { title: 'You are in',      sub: '',                                                h1: ['ACCESS', 'GRANTED.'] },
        account: { title: 'Your account',    sub: '',                                                h1: ['YOU ARE', 'IN.'] }
    };

    let current = 'login';

    /* ----------------------------------------------------------------------
       BOT CHECK (Cloudflare Turnstile)
       1. Cloudflare dashboard > Turnstile > Add site > copy the SITE key and the SECRET key.
       2. Supabase > Authentication > Attack Protection > turn on CAPTCHA > Turnstile > paste the SECRET key.
       3. Paste the SITE key below. While it is empty, nothing changes and no check is shown.
       (For local testing Cloudflare has a key that always passes: 1x00000000000000000000AA)
       ---------------------------------------------------------------------- */
    const TURNSTILE_SITE_KEY = '';

    const captcha = (function () {
        const widgets = new Map();                        // container element -> { id, token }
        const st = document.createElement('style');
        st.textContent = '.au-captcha{margin:2px 0 14px}.au-captcha:empty{display:none}';
        document.head.appendChild(st);

        const enabled = () => !!TURNSTILE_SITE_KEY;

        function mount(tries) {
            if (!enabled()) return;
            if (!window.turnstile) { if ((tries || 0) < 60) setTimeout(() => mount((tries || 0) + 1), 250); return; }
            document.querySelectorAll('[data-captcha]').forEach(box => {
                if (widgets.has(box) || box.offsetParent === null) return;      // only render boxes that are on screen
                const rec = { id: null, token: '' };
                rec.id = window.turnstile.render(box, {
                    sitekey: TURNSTILE_SITE_KEY,
                    appearance: 'interaction-only',           // invisible unless Cloudflare needs the person to click
                    size: 'flexible',
                    callback: t => { rec.token = t; },
                    'expired-callback': () => { rec.token = ''; },
                    'error-callback': () => { rec.token = ''; }
                });
                widgets.set(box, rec);
            });
        }

        // resolves with a fresh token (or undefined when the check is switched off)
        async function token(scope) {
            if (!enabled()) return undefined;
            const box = scope && scope.querySelector('[data-captcha]');
            const rec = box && widgets.get(box);
            if (!rec) throw new Error('captcha_loading');
            for (let i = 0; i < 40 && !rec.token; i++) await new Promise(r => setTimeout(r, 150));
            if (!rec.token) throw new Error('captcha_failed');
            return rec.token;
        }

        function reset(scope) {
            if (!enabled() || !window.turnstile) return;
            const box = scope && scope.querySelector && scope.querySelector('[data-captcha]');
            const rec = box && widgets.get(box);
            if (rec) { rec.token = ''; try { window.turnstile.reset(rec.id); } catch (e) { /* ignore */ } }
        }

        return { mount, token, reset };
    })();

    function showPanel(name, opts) {
        opts = opts || {};
        current = name;

        $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });

        const tabsVisible = name === 'login' || name === 'signup';
        $('auTabs').hidden = !tabsVisible;
        $('auSocial').hidden = !tabsVisible;

        if (tabsVisible) {
            $('auTabs').dataset.mode = name;
            $('auTabLogin').setAttribute('aria-selected', String(name === 'login'));
            $('auTabSignup').setAttribute('aria-selected', String(name === 'signup'));
        }

        const c = COPY[name];
        $('auTitle').textContent = c.title;
        $('auSub').textContent = c.sub;
        $('auSub').hidden = !c.sub;
        $('auH1a').textContent = c.h1[0];
        $('auH1b').textContent = c.h1[1];

        // keep the URL in sync for the two main modes (so links like login.html?mode=signup work)
        if (name === 'login' || name === 'signup') {
            try { history.replaceState(null, '', location.pathname + (name === 'signup' ? '?mode=signup' : '') + keepNext()); } catch (e) { /* ignore */ }
        }

        captcha.mount();

        if (opts.focus) {
            const panel = document.querySelector('[data-panel="' + name + '"]');
            const first = panel && panel.querySelector('input:not([type="checkbox"])');
            if (first) first.focus({ preventScroll: false });
        }
    }

    function keepNext() {
        const n = new URLSearchParams(location.search).get('next');
        if (!n) return '';
        const sep = location.search.includes('mode=') ? '&' : '?';
        return sep + 'next=' + encodeURIComponent(n);
    }

    document.addEventListener('click', e => {
        const go = e.target.closest('[data-go]');
        if (!go) return;
        const to = go.dataset.go;
        if (to === 'login')  termLog('mode: LOG_IN');
        if (to === 'signup') termLog('mode: SIGN_UP');
        if (to === 'forgot') termLog('mode: RESET_KEY');
        clearAllMessages();
        showPanel(to, { focus: true });
    });

    /* ----------------------------------------------------------------------
       4. FORM UTILITIES
       ---------------------------------------------------------------------- */
    function setError(input, msg) {
        const field = input.closest('.au-field') || input.closest('form');
        const hint = $(input.id + 'Hint');
        if (hint) hint.textContent = msg || '';
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg && hint) input.setAttribute('aria-describedby', hint.id);
        if (field && field.classList) field.classList.toggle('has-error', !!msg);
        return !msg;
    }

    function showMsg(form, text, kind) {
        const box = form.querySelector('.au-msg');
        if (!box) return;
        box.className = 'au-msg' + (text ? ' is-' + (kind || 'error') : '');
        box.textContent = text || '';
    }

    function clearAllMessages() {
        $$('.au-msg').forEach(b => { b.className = 'au-msg'; b.textContent = ''; });
        $$('.au-hint').forEach(h => { h.textContent = ''; });
        $$('.au-field.has-error').forEach(f => f.classList.remove('has-error'));
        $$('.au-input').forEach(i => i.setAttribute('aria-invalid', 'false'));
    }

    function shake() {
        if (reduceMotion) return;
        card.classList.remove('is-shake');
        void card.offsetWidth;
        card.classList.add('is-shake');
    }

    function setLoading(btn, on) {
        btn.classList.toggle('is-loading', on);
        btn.setAttribute('aria-busy', String(on));
        if (btn.tagName === 'BUTTON') btn.disabled = on;
    }

    let busy = false;

    async function run(form, btn, task) {
        if (busy) return;
        busy = true;
        setLoading(btn, true);
        if (form) showMsg(form, '');
        try {
            await task();
        } catch (err) {
            console.error('[auth]', err);
            const text = friendly(err);
            if (form) showMsg(form, text, 'error');
            termLog('access denied', 'bad');
            shake();
        } finally {
            if (form) captcha.reset(form);               // a captcha token only works once
            busy = false;
            setLoading(btn, false);
        }
    }

    function friendly(err) {
        const code = (err && (err.code || '')).toString();
        const msg  = (err && err.message || '').toLowerCase();
        const status = err && err.status;

        if (err && (err.isNotConnected || err.isFriendly)) return err.message;
        if (msg.includes('provider is not enabled') || msg.includes('unsupported provider')) return 'Discord login is not switched on yet. Please use email for now.';
        if (msg.includes('captcha')) return 'Please finish the security check and try again.';
        if (code === 'invalid_credentials' || msg.includes('invalid login')) return 'Wrong email or password.';
        if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'Please confirm your email first. Check your inbox (and spam).';
        if (code === 'weak_password' || msg.includes('password should')) return 'That password is too weak. Try a longer one.';
        if (code === 'user_already_exists' || msg.includes('already registered')) return 'That email already has an account. Try logging in.';
        if (code === 'email_address_invalid' || msg.includes('invalid email')) return 'That email address does not look valid.';
        if (code === 'signup_disabled') return 'Sign ups are turned off right now.';
        if (status === 429 || code.includes('rate_limit') || msg.includes('rate limit') || msg.includes('too many')) return 'Too many tries. Wait a minute and try again.';
        if (msg.includes('failed to fetch') || msg.includes('network')) return 'Cannot reach the server. Check your connection.';
        if (code === 'same_password') return 'Choose a password different from your old one.';
        if (msg.includes('error sending') || code === 'smtp_failed') return 'We could not send the email right now. Please try again in a few minutes, or ask us on Discord.';
        // unknown problem: show Supabase's short code so it can be found in the Auth logs
        return 'Something went wrong. Please try again.' + ((code || status) ? ' (' + (code || status) + ')' : '');
    }

    function needBackend() {
        const e = new Error('The backend is not connected yet. Add your Supabase keys in auth.js.');
        e.isNotConnected = true;
        throw e;
    }

    /* ----------------------------------------------------------------------
       5. VALIDATION
       ---------------------------------------------------------------------- */
    const vEmail = i => {
        const v = i.value.trim();
        if (!v) return setError(i, 'Enter your email.');
        if (!RE_EMAIL.test(v)) return setError(i, 'That email does not look right.');
        return setError(i, '');
    };

    const vUser = i => {
        const v = i.value.trim();
        if (!v) return setError(i, 'Pick a username.');
        if (!RE_USER.test(v)) return setError(i, '3 to 20 characters: letters, numbers and underscores only.');
        return setError(i, '');
    };

    const vPass = (i, minimal) => {
        const v = i.value;
        if (!v) return setError(i, 'Enter your password.');
        if (!minimal && v.length < CONFIG.MIN_PASSWORD) return setError(i, 'Use at least ' + CONFIG.MIN_PASSWORD + ' characters.');
        return setError(i, '');
    };

    const vMatch = (i, other) => {
        if (!i.value) return setError(i, 'Repeat your password.');
        if (i.value !== other.value) return setError(i, 'Passwords do not match.');
        return setError(i, '');
    };

    // validate when leaving a field, and re-check live once it already shows an error
    function wire(input, validator) {
        input.addEventListener('blur', () => { if (input.value || input.getAttribute('aria-invalid') === 'true') validator(input); });
        input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') validator(input); });
    }

    /* ----------------------------------------------------------------------
       6. PASSWORD SHOW/HIDE + STRENGTH METER
       ---------------------------------------------------------------------- */
    document.addEventListener('click', e => {
        const t = e.target.closest('[data-toggle]');
        if (!t) return;
        const input = $(t.dataset.toggle);
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        t.setAttribute('aria-pressed', String(show));
        t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        input.focus();
    });

    function strength(pw) {
        if (!pw) return 0;
        let s = 0;
        if (pw.length >= CONFIG.MIN_PASSWORD) s++;
        if (pw.length >= 12) s++;
        if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
        if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
        if (pw.length < CONFIG.MIN_PASSWORD) return 1;
        return Math.max(1, Math.min(4, s));
    }

    const meter = $('auMeter');
    const meterText = $('auMeterText');
    const LEVELS = ['At least ' + CONFIG.MIN_PASSWORD + ' characters', 'Weak', 'Okay', 'Good', 'Strong'];

    $('suPassword').addEventListener('input', e => {
        const lvl = strength(e.target.value);
        meter.dataset.level = String(lvl);
        meterText.textContent = LEVELS[lvl];
    });

    /* ----------------------------------------------------------------------
       7. FORMS
       ---------------------------------------------------------------------- */
    // ----- log in -----
    const fLogin = $('auFormLogin');
    wire($('loginEmail'), vEmail);
    wire($('loginPassword'), i => vPass(i, true));

    fLogin.addEventListener('submit', e => {
        e.preventDefault();
        const email = $('loginEmail'), pass = $('loginPassword');
        const ok = [vEmail(email), vPass(pass, true)].every(Boolean);
        if (!ok) { shake(); return; }

        run(fLogin, fLogin.querySelector('.au-btn'), async () => {
            termLog('verifying credentials...');
            if (!sb) needBackend();
            const captchaToken = await captcha.token(fLogin);
            const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value, options: captchaToken ? { captchaToken } : undefined });
            if (error) throw error;
            pass.value = '';
            termLog('access granted', 'ok');
            await afterLogin(data.user);
        });
    });

    // ----- sign up -----
    const fSignup = $('auFormSignup');
    wire($('suUsername'), vUser);
    wire($('suEmail'), vEmail);
    wire($('suPassword'), i => vPass(i, false));
    wire($('suConfirm'), i => vMatch(i, $('suPassword')));
    $('suTerms').addEventListener('change', () => setError($('suTerms'), ''));

    fSignup.addEventListener('submit', e => {
        e.preventDefault();
        const user = $('suUsername'), email = $('suEmail'), pass = $('suPassword'), conf = $('suConfirm'), terms = $('suTerms');
        const checks = [vUser(user), vEmail(email), vPass(pass, false), vMatch(conf, pass)];
        let ok = checks.every(Boolean);
        if (!terms.checked) { setError(terms, 'You need to agree to continue.'); ok = false; } else { setError(terms, ''); }
        if (!ok) { shake(); return; }

        // honeypot: a person never sees this field, a bot fills it. Pretend it worked and do nothing.
        if ($('suWebsite') && $('suWebsite').value) {
            pendingEmail = email.value.trim();
            showCheck('If this email is new, we just sent a confirmation link to ' + pendingEmail + '. Open it to finish creating your account.');
            return;
        }

        run(fSignup, fSignup.querySelector('.au-btn'), async () => {
            termLog('creating account...');
            if (!sb) needBackend();
            const captchaToken = await captcha.token(fSignup);
            const { data, error } = await sb.auth.signUp({
                email: email.value.trim(),
                password: pass.value,
                options: { data: { username: user.value.trim() }, emailRedirectTo: verifiedUrl(), captchaToken }
            });
            if (error) throw error;
            pass.value = ''; conf.value = '';

            if (data.session) {                // email confirmation is switched off in Supabase
                termLog('account created', 'ok');
                await afterLogin(data.user);
            } else {                           // normal case: confirmation email was sent
                pendingEmail = email.value.trim();
                termLog('confirmation email sent', 'ok');
                showCheck('If this email is new, we just sent a confirmation link to ' + pendingEmail + '. Open it to finish creating your account.');
            }
        });
    });

    // ----- forgot password -----
    const fForgot = $('auFormForgot');
    wire($('fgEmail'), vEmail);

    fForgot.addEventListener('submit', e => {
        e.preventDefault();
        const email = $('fgEmail');
        if (!vEmail(email)) { shake(); return; }

        run(fForgot, fForgot.querySelector('.au-btn'), async () => {
            termLog('sending reset link...');
            if (!sb) needBackend();
            const captchaToken = await captcha.token(fForgot);
            const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: recoveryUrl(), captchaToken });
            if (error) throw error;
            pendingEmail = email.value.trim();
            resendKind = 'recovery';
            termLog('reset link sent', 'ok');
            showCheck('If an account exists for ' + pendingEmail + ', a reset link is on its way. It can take a minute to arrive.');
        });
    });

    // ----- set new password -----
    const fReset = $('auFormReset');
    wire($('rsPassword'), i => vPass(i, false));
    wire($('rsConfirm'), i => vMatch(i, $('rsPassword')));

    fReset.addEventListener('submit', e => {
        e.preventDefault();
        const pass = $('rsPassword'), conf = $('rsConfirm');
        if (![vPass(pass, false), vMatch(conf, pass)].every(Boolean)) { shake(); return; }

        run(fReset, fReset.querySelector('.au-btn'), async () => {
            termLog('updating password...');
            if (!sb) needBackend();
            const { data, error } = await sb.auth.updateUser({ password: pass.value });
            if (error) throw error;
            pass.value = ''; conf.value = '';
            recoveryMode = false;
            termLog('password updated', 'ok');
            granted(data.user, 'Password updated.');
        });
    });

    /* ----------------------------------------------------------------------
       8. CHECK-EMAIL PANEL (with resend cooldown)
       ---------------------------------------------------------------------- */
    let pendingEmail = '';
    let resendKind = 'signup';
    let cooldownTimer = null;

    function showCheck(text) {
        $('auCheckText').textContent = text;
        const msg = $('auCheckMsg');
        msg.className = 'au-msg';
        msg.textContent = '';
        showPanel('check');
        startCooldown(30);
    }

    function startCooldown(seconds) {
        const btn = $('auResend');
        const label = btn.querySelector('.au-btn-label');
        clearInterval(cooldownTimer);
        let left = seconds;
        btn.disabled = true;
        label.textContent = 'RESEND IN ' + left + 's';
        cooldownTimer = setInterval(() => {
            left--;
            if (left <= 0) {
                clearInterval(cooldownTimer);
                btn.disabled = false;
                label.textContent = 'RESEND EMAIL';
            } else {
                label.textContent = 'RESEND IN ' + left + 's';
            }
        }, 1000);
    }

    $('auResend').addEventListener('click', async () => {
        if (busy || !pendingEmail) return;
        const btn = $('auResend');
        const msg = $('auCheckMsg');
        busy = true;
        setLoading(btn, true);
        try {
            if (!sb) needBackend();
            const checkPanel = document.querySelector('[data-panel="check"]');
            const captchaToken = await captcha.token(checkPanel);
            const { error } = resendKind === 'recovery'
                ? await sb.auth.resetPasswordForEmail(pendingEmail, { redirectTo: recoveryUrl(), captchaToken })
                : await sb.auth.resend({ type: 'signup', email: pendingEmail, options: { emailRedirectTo: verifiedUrl(), captchaToken } });
            if (error) throw error;
            msg.className = 'au-msg is-ok';
            msg.textContent = 'Sent again. Check your inbox and spam folder.';
            startCooldown(30);
        } catch (err) {
            msg.className = 'au-msg is-error';
            console.error('[auth]', err);
            msg.textContent = friendly(err);
        } finally {
            captcha.reset(document.querySelector('[data-panel="check"]'));
            busy = false;
            setLoading(btn, false);
            if (!cooldownTimer) btn.disabled = false;
        }
    });

    /* ----------------------------------------------------------------------
       9. DISCORD LOGIN
       ---------------------------------------------------------------------- */
    // Supabase publishes which login providers are switched on. If Discord is off, say so here
    // instead of sending people to a plain error page on supabase.co.
    async function discordEnabled() {
        try {
            const r = await fetch(CONFIG.SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } });
            if (!r.ok) return true;
            const j = await r.json();
            return !(j && j.external && j.external.discord === false);
        } catch (e) { return true; }
    }

    $('auDiscord').addEventListener('click', () => {
        const btn = $('auDiscord');
        const form = current === 'signup' ? fSignup : fLogin;

        run(form, btn, async () => {
            termLog('opening discord...');
            if (!sb) needBackend();
            if (!canOAuth()) {
                throw Object.assign(new Error('Discord login needs the site to run on http(s), not as a local file.'), { isNotConnected: true });
            }
            if (!(await discordEnabled())) throw Object.assign(new Error('Discord login is not switched on yet. Please use email for now.'), { isFriendly: true });
            try { sessionStorage.setItem('au_next', safeNext()); sessionStorage.setItem('au_oauth', '1'); } catch (e) { /* ignore */ }
            const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: baseUrl() } });
            if (error) throw error;
            // the browser now leaves for Discord, keep the button spinning
            await new Promise(() => {});
        });
    });

    /* ----------------------------------------------------------------------
       9b. PROFILE CHECK + USERNAME STEP
       Discord members arrive without the username we ask for at sign up, and a profile row
       needs one. After any login we make sure the profile exists, and ask for a username if not.
       If the profiles table can't be read for any reason, we skip this and log in as before.
       ---------------------------------------------------------------------- */
    let pendingUser = null;

    async function profileMissing(user) {
        try {
            const { data, error } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle();
            if (error) return false;
            return !data;
        } catch (e) { return false; }
    }

    function suggestUsername(user) {
        const m = user.user_metadata || {};
        let s = String(m.username || m.user_name || m.name || m.full_name || (user.email || 'member').split('@')[0])
            .replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        if (s.length < 3) s = (s + '_member').slice(0, 20);
        return s.slice(0, 20);
    }

    async function createProfile(user, username) {
        const m = user.user_metadata || {};
        const row = { id: user.id, username: username };
        const dn = String(m.full_name || m.name || '').trim().slice(0, 40);
        if (dn) row.display_name = dn;
        const av = m.avatar_url || m.picture;
        if (av && /^https:\/\//i.test(av)) row.avatar_url = av;
        return sb.from('profiles').insert(row);
    }

    function askUsername(user, note) {
        pendingUser = user;
        const input = $('unName');
        if (!input.value) input.value = suggestUsername(user);
        clearAllMessages();
        showPanel('username', { focus: true });
        if (note) showMsg($('auFormUsername'), note, 'error');
        termLog('choose a username');
    }

    async function afterLogin(user, message) {
        if (sb && user && await profileMissing(user)) {
            const meta = (user.user_metadata || {}).username;
            const viaEmail = ((user.app_metadata || {}).provider || 'email') === 'email';
            if (viaEmail && meta && RE_USER.test(meta)) {
                const { error } = await createProfile(user, meta);        // the username they picked at sign up
                if (error && error.code === '23505') { askUsername(user, 'That username was taken. Pick another one.'); return; }
            } else {
                askUsername(user); return;
            }
        }
        granted(user, message);
    }

    const fUsername = $('auFormUsername');
    wire($('unName'), vUser);
    $('unTerms').addEventListener('change', () => setError($('unTerms'), ''));

    fUsername.addEventListener('submit', e => {
        e.preventDefault();
        const name = $('unName'), terms = $('unTerms');
        let ok = vUser(name);
        if (!terms.checked) { setError(terms, 'You need to agree to continue.'); ok = false; } else { setError(terms, ''); }
        if (!ok || !pendingUser) { shake(); return; }

        run(fUsername, fUsername.querySelector('.au-btn'), async () => {
            termLog('saving username...');
            const { error } = await createProfile(pendingUser, name.value.trim());
            if (error) {
                if (error.code === '23505') throw Object.assign(new Error('That username is already taken. Try another one.'), { isFriendly: true });
                if (error.code === '23514') throw Object.assign(new Error('3 to 20 characters: letters, numbers and underscores only.'), { isFriendly: true });
                throw error;
            }
            termLog('profile created', 'ok');
            granted(pendingUser);
        });
    });

    $('unCancel').addEventListener('click', async () => {
        try { if (sb) await sb.auth.signOut(); } catch (e) { /* ignore */ }
        pendingUser = null;
        syncNav(null);
        clearAllMessages();
        showPanel('login', { focus: false });
    });

    /* ----------------------------------------------------------------------
       10. LOGGED-IN STATES
       ---------------------------------------------------------------------- */
    let redirectTimer = null;

    function displayName(user) {
        const m = (user && user.user_metadata) || {};
        return m.username || m.full_name || m.name || m.user_name || ((user && user.email) || 'member').split('@')[0];
    }

    function syncNav(user) {
        const label = $('authNavText');                       // sidebar link (added in main.js)
        if (label) label.textContent = user ? 'MY PROFILE' : 'LOG IN';
        const link = $('authNavLink');
        if (link) {
            link.href = user ? 'profile.html' : 'login.html';
            link.setAttribute('data-nav', user ? 'profile' : 'login');
        }
        $('auHudSession').textContent = user ? 'ACTIVE' : 'NONE';
    }

    function granted(user, message) {
        syncNav(user);
        const next = safeNext();
        $('auSuccessText').textContent = (message || 'Access granted.') + ' Taking you in...';
        showPanel('success');
        try { sessionStorage.removeItem('au_next'); sessionStorage.removeItem('au_oauth'); } catch (e) { /* ignore */ }
        clearTimeout(redirectTimer);
        redirectTimer = setTimeout(() => { location.href = next; }, reduceMotion ? 300 : 1400);
    }

    function showAccount(user) {
        syncNav(user);
        const name = displayName(user);
        $('auAccName').textContent = name;
        $('auAccEmail').textContent = user.email || '';

        const provider = (user.app_metadata && user.app_metadata.provider) || 'email';
        $('auAccProvider').textContent = provider.toUpperCase();

        const d = user.created_at ? new Date(user.created_at) : null;
        $('auAccSince').textContent = d && !isNaN(d) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

        const av = $('auAvatar');
        av.querySelectorAll('img').forEach(i => i.remove());
        $('auAvatarInitial').textContent = name.charAt(0).toUpperCase();
        const url = user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture);
        if (url && /^https:\/\//i.test(url)) {
            const img = document.createElement('img');
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => img.remove();
            img.src = url;
            av.appendChild(img);
        }

        $('auGoNext').href = safeNext();
        showPanel('account');
    }

    $('auLogout').addEventListener('click', async () => {
        const btn = $('auLogout');
        if (busy) return;
        busy = true;
        setLoading(btn, true);
        try {
            if (sb) await sb.auth.signOut();
            termLog('session closed');
            syncNav(null);
            clearAllMessages();
            showPanel('login', { focus: false });
        } catch (err) {
            showPanel('login');
        } finally {
            busy = false;
            setLoading(btn, false);
        }
    });

    /* ----------------------------------------------------------------------
       11. START UP
       ---------------------------------------------------------------------- */
    let recoveryMode = /type=recovery/.test(location.hash);

    // errors that Supabase puts in the URL (expired link, cancelled Discord login, ...)
    function readUrlError() {
        const h = new URLSearchParams(location.hash.replace(/^#/, ''));
        const q = new URLSearchParams(location.search);
        const code = h.get('error_code') || q.get('error_code') || '';
        const raw  = h.get('error_description') || q.get('error_description') || '';
        if (!h.get('error') && !q.get('error')) return '';
        if (code === 'otp_expired') return 'That link expired or was already used. Request a new one.';
        if (/access_denied/.test(h.get('error') || q.get('error') || '')) return 'Login was cancelled or the link is no longer valid.';
        return raw ? 'Login failed. Please try again.' : '';
    }

    async function start() {
        const urlMode = new URLSearchParams(location.search).get('mode');
        showPanel(urlMode === 'signup' ? 'signup' : 'login');

        const urlErr = readUrlError();
        if (urlErr) {
            showMsg(fLogin, urlErr, 'error');
            showPanel('login');
            try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
        }

        if (!sb) return;

        sb.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                recoveryMode = true;
                termLog('recovery link verified', 'ok');
                showPanel('reset', { focus: true });
            } else if (event === 'SIGNED_OUT') {
                syncNav(null);
            } else if (session && session.user) {
                syncNav(session.user);
            }
        });

        let session = null;
        try { ({ data: { session } } = await sb.auth.getSession()); } catch (e) { session = null; }

        if (session && session.user) {
            if (recoveryMode) {
                showPanel('reset');
            } else {
                let fromRedirect = false;
                try { fromRedirect = sessionStorage.getItem('au_oauth') === '1'; } catch (e) { /* ignore */ }
                if (await profileMissing(session.user)) {
                    askUsername(session.user);
                } else if (fromRedirect || /access_token=|type=signup|type=magiclink/.test(location.hash)) {
                    termLog('access granted', 'ok');
                    granted(session.user);
                } else {
                    showAccount(session.user);
                }
            }
        } else {
            syncNav(null);
        }
    }

    start();
})();