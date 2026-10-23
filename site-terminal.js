/* ==========================================================================
   SPECSOFT® site-terminal.js  -  the interactive command terminal

   Press "/" anywhere (when not typing in a field) or click the terminal
   icon in the HUD bar to open it. Type a command, hit enter. Auto-loaded
   on every page by main.js, so it works the same everywhere.

   Reads the real social links straight out of the sidebar at runtime
   (main.js renders them) instead of hardcoding a second copy that could
   drift out of sync.
   ========================================================================== */
(function () {
    'use strict';
    if (window.SpecTerminal) return;

    function reduceMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function sound(name) {
        try { if (window.SpecSound) window.SpecSound.play(name); } catch (e) {}
    }

    var els = {};
    var history = [];
    var historyIndex = -1;

    function build() {
        var backdrop = document.createElement('div');
        backdrop.className = 'st-backdrop';

        var panel = document.createElement('div');
        panel.className = 'st-panel';

        var head = document.createElement('div');
        head.className = 'st-head';
        var title = document.createElement('div');
        title.className = 'st-head-title';
        var dots = document.createElement('span');
        dots.className = 'st-head-dots';
        dots.innerHTML = '<span></span><span></span><span></span>';
        title.appendChild(dots);
        title.appendChild(document.createTextNode('SPECSOFT TERMINAL \u2014 type "help"'));
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'st-close';
        close.setAttribute('aria-label', 'Close terminal');
        close.textContent = '\u00D7';
        close.addEventListener('click', closeTerminal);
        head.appendChild(title);
        head.appendChild(close);

        var log = document.createElement('div');
        log.className = 'st-log';

        var inputRow = document.createElement('div');
        inputRow.className = 'st-inputrow';
        var prompt = document.createElement('span');
        prompt.className = 'st-prompt';
        prompt.textContent = 'visitor@specsoft:~$';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'st-input';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.placeholder = 'type a command\u2026';
        inputRow.appendChild(prompt);
        inputRow.appendChild(input);

        panel.appendChild(head);
        panel.appendChild(log);
        panel.appendChild(inputRow);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeTerminal(); });
        input.addEventListener('keydown', onInputKey);

        els.backdrop = backdrop;
        els.panel = panel;
        els.log = log;
        els.input = input;

        printLine('SPECSOFT® terminal \u2014 type "help" to see what this does.', 'ok');
    }

    function printLine(text, kind) {
        var line = document.createElement('div');
        line.className = 'st-line' + (kind ? ' st-' + kind : '');
        line.textContent = text;
        els.log.appendChild(line);
        els.log.scrollTop = els.log.scrollHeight;
    }

    function openTerminal() {
        if (!els.backdrop) build();
        els.backdrop.classList.add('is-open');
        sound('open');
        setTimeout(function () { els.input.focus(); }, 50);
        document.addEventListener('keydown', onEsc);
    }
    function closeTerminal() {
        if (!els.backdrop) return;
        els.backdrop.classList.remove('is-open');
        sound('close');
        document.removeEventListener('keydown', onEsc);
    }
    function onEsc(e) { if (e.key === 'Escape') closeTerminal(); }

    function onInputKey(e) {
        if (e.key === 'Enter') {
            var val = els.input.value;
            els.input.value = '';
            if (val.trim()) runCommand(val);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIndex > 0) { historyIndex--; els.input.value = history[historyIndex] || ''; }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex < history.length - 1) { historyIndex++; els.input.value = history[historyIndex] || ''; }
            else { historyIndex = history.length; els.input.value = ''; }
        }
    }

    /* ---- helpers the commands use ---- */
    function socialLink(label) {
        var a = document.querySelector('a[aria-label="' + label + '"]');
        return a ? a.href : null;
    }
    function openLink(url) {
        if (!url) { printLine('that link isn\u2019t set up yet.', 'err'); return; }
        window.open(url, '_blank', 'noopener');
    }
    function goTo(id) {
        if (document.getElementById(id)) {
            document.getElementById(id).scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
            closeTerminal();
        } else {
            window.location.href = 'index.html#' + id;
        }
    }

    /* ---- the matrix easter egg ---- */
    function runMatrix() {
        if (reduceMotion()) { printLine('(reduced motion is on, skipping the visual \u2014 but you found it.)', 'ok'); return; }
        var canvas = document.getElementById('stMatrix');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'stMatrix';
            document.body.appendChild(canvas);
        }
        var ctx = canvas.getContext('2d');
        var w = canvas.width = window.innerWidth;
        var h = canvas.height = window.innerHeight;
        var fontSize = 15;
        var columns = Math.floor(w / fontSize);
        var drops = new Array(columns).fill(1);
        var chars = 'アイウエオカキクケコサシスセソ0123456789<>/*-+SPECSOFT';

        canvas.classList.add('is-on');
        var frames = 0;
        var maxFrames = 220; // ~7s at ~30fps
        var timer = setInterval(function () {
            ctx.fillStyle = 'rgba(3,3,3,0.08)';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#ffffff';
            ctx.font = fontSize + 'px monospace';
            for (var i = 0; i < drops.length; i++) {
                var ch = chars[(Math.random() * chars.length) | 0];
                ctx.fillText(ch, i * fontSize, drops[i] * fontSize);
                if (drops[i] * fontSize > h && Math.random() > 0.975) drops[i] = 0;
                drops[i]++;
            }
            frames++;
            if (frames >= maxFrames) {
                clearInterval(timer);
                canvas.classList.remove('is-on');
                setTimeout(function () { ctx.clearRect(0, 0, w, h); }, 700);
            }
        }, 33);
    }

    /* ---- command registry ---- */
    var COMMANDS = {
        help: function () {
            printLine('available commands:');
            ['help', 'whoami', 'home / about / build / projects / team / faq',
                'discord / github / roblox', 'theme [light|dark]', 'clear'].forEach(function (c) {
                printLine('  ' + c);
            });
        },
        whoami: function () {
            var user = window.SpecAuth && window.SpecAuth.getUser ? window.SpecAuth.getUser() : null;
            if (user && (user.username || user.name)) printLine('you are @' + (user.username || user.name) + '. hey.', 'ok');
            else printLine('a curious visitor poking around the terminal. respect.', 'ok');
        },
        clear: function () { els.log.innerHTML = ''; },
        discord: function () { openLink(socialLink('Discord')); },
        github: function () { openLink(socialLink('Github')); },
        roblox: function () { openLink(socialLink('Roblox')); },
        home: function () { goTo('home'); },
        about: function () { goTo('about'); },
        build: function () { goTo('build'); },
        projects: function () { goTo('projects'); },
        team: function () { goTo('team'); },
        faq: function () { goTo('faq'); },
        matrix: function () { printLine('wake up\u2026', 'ok'); runMatrix(); },
        theme: function (arg) {
            var light = arg === 'light' ? true : arg === 'dark' ? false : !document.body.classList.contains('light-mode');
            document.body.classList.toggle('light-mode', light);
            try { localStorage.setItem('specsoft-theme', light ? 'light' : 'dark'); } catch (e) {}
            var label = document.getElementById('themeLabel');
            if (label) label.textContent = light ? 'LIGHT MODE' : 'DARK MODE';
            printLine('theme set to ' + (light ? 'light' : 'dark') + '.', 'ok');
        },
        'make me a sandwich': function () { printLine('what? make it yourself.', 'err'); },
        'sudo make me a sandwich': function () { printLine('okay. \uD83E\uDD6A', 'ok'); }
    };

    function runCommand(raw) {
        var cmd = raw.trim();
        history.push(cmd);
        historyIndex = history.length;
        printLine(cmd, 'cmd');
        sound('click');

        if (COMMANDS[cmd]) { COMMANDS[cmd](); return; }

        var parts = cmd.split(/\s+/);
        var name = parts[0].toLowerCase();
        var arg = parts[1];
        if (COMMANDS[name]) { COMMANDS[name](arg); return; }

        printLine('command not found: ' + cmd + ' \u2014 try "help"', 'err');
    }

    /* ---- open triggers: "/" key, and a HUD button ---- */
    function trigIcon() {
        var span = document.createElement('span');
        span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
        return span.firstChild;
    }

    function mountTrigger() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'st-trigger';
        btn.setAttribute('aria-label', 'Open terminal (or press /)');
        btn.appendChild(trigIcon());
        btn.addEventListener('click', openTerminal);

        var hudRight = document.querySelector('.hud-bar .hud-right');
        if (hudRight) hudRight.insertBefore(btn, hudRight.firstChild);

        // Keep the trigger in the HUD only. Duplicating it in the mobile header
        // produced a second terminal button above the page HUD.
    }

    function onGlobalKey(e) {
        if (e.key !== '/') return;
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        if (els.backdrop && els.backdrop.classList.contains('is-open')) return;
        e.preventDefault();
        openTerminal();
    }

    function start() {
        mountTrigger();
        document.addEventListener('keydown', onGlobalKey);
    }

    window.SpecTerminal = { open: openTerminal, close: closeTerminal, run: runCommand };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
