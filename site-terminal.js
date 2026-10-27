/* ==========================================================================
   SPECSOFT® site-terminal.js - Revamped Interactive Terminal
   ========================================================================== */
(function () {
    'use strict';
    function ssRead() { try { return JSON.parse(localStorage.getItem('specsoft.settings.v1') || '{}') || {}; } catch (e) { return {}; } }
    function ssOff(k) { return ssRead()[k] === false; }
    function ssOn(k) { return ssRead()[k] === true; }
    if (ssOff('terminal')) return;
    if (window.SpecTerminal) return;

    function reduceMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function sound(name) {
        try { if (window.SpecSound) window.SpecSound.play(name); } catch (e) {}
    }

    // Inject CSS for the rainbow effect dynamically
    if (!document.getElementById('st-dynamic-css')) {
        var style = document.createElement('style');
        style.id = 'st-dynamic-css';
        style.innerHTML = `
            @keyframes stRainbow {
                0%   { color: #ff5f56; }
                17%  { color: #ffbd2e; }
                33%  { color: #27c93f; }
                50%  { color: #007aff; }
                67%  { color: #af52de; }
                83%  { color: #ff2d55; }
                100% { color: #ff5f56; }
            }
            .st-rainbow * {
                animation: stRainbow 2s linear infinite !important;
            }
        `;
        document.head.appendChild(style);
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
        els.prompt = prompt;

        printLine('SPECSOFT® terminal v2.4.8 \u2014 type "help" to see what this does.', 'ok');
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
        if (reduceMotion()) { printLine('(reduced motion is on, skipping the visual)', 'ok'); return; }
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
        var maxFrames = 220;
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
        help: function (arg) {
            if (arg) {
                // Strip quotes so help 'color' works like help color
                var topic = arg.toLowerCase().replace(/['"]/g, '');
                
                printLine('--- MANUAL: ' + topic + ' ---', 'ok');
                
                if (topic === 'color' || topic === 'colors' || topic === 'c0') {
                    printLine('Changes the text color of your terminal session.');
                    printLine('Usage: c0 - c7  OR  color c0 - c7  OR  color cRainbow[seconds]');
                    printLine('');
                    printLine('  c0 = White', 'ok');
                    printLine('  c1 = Red', 'err');
                    printLine('  c2 = Green', 'ok');
                    printLine('  c3 = Blue');
                    printLine('  c4 = Yellow');
                    printLine('  c5 = Orange');
                    printLine('  c6 = Pink');
                    printLine('  c7 = Violet');
                    printLine('');
                    printLine('Trick: "color cRainbow10" animates in a rainbow for 10s.');
                    return;
                }
                if (topic === 'matrix') {
                    printLine('Turns on the Matrix digital rain background.');
                    printLine('Usage: matrix = true');
                    printLine('Tip: Refresh the page to turn it off.');
                    return;
                }
                if (topic === 'themeswitch') {
                    printLine('Toggles the website theme.');
                    printLine('Usage: themeSwitch = true (Light) or = false (Dark)');
                    return;
                }
                if (topic === 'reset') {
                    printLine('Clears your browser cache and settings. Logs you out.', 'err');
                    printLine('Usage: reset settings');
                    printLine('You must type "reset confirm" to proceed.');
                    return;
                }
                if (topic === 'sudo') {
                    printLine('Executes a command as superuser.');
                    printLine('Usage: sudo [command]');
                    printLine('Trick: Try "sudo make me a sandwich".');
                    return;
                }
                
                printLine('No manual entry for ' + topic, 'err');
                return;
            }

            printLine('--- SPECSOFT TERMINAL v2.4.8 ---');
            printLine('Type "help [command]" for detailed info.');
            printLine('');
            printLine('SYSTEM:  sysinfo, ping, date, whoami, reset');
            printLine('NAV:     home, about, build, projects, team, faq');
            printLine('SOCIAL:  discord, github, roblox');
            printLine('STYLE:   themeSwitch = true/false, c0-c7, color cRainbow10');
            printLine('EFFECTS: matrix = true');
            printLine('FUN:     sudo, clear');
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
        date: function () { printLine(new Date().toString(), 'ok'); },
        'make me a sandwich': function () { printLine('what? make it yourself.', 'err'); },
        'sudo make me a sandwich': function () { printLine('okay. \uD83E\uDD6A', 'ok'); },
        'reset settings': function() {
            printLine('WARNING: This will clear all local settings and log you out.', 'err');
            printLine('To confirm, type: reset confirm', 'ok');
        },
        'reset confirm': function() {
            printLine('Wiping local storage...', 'err');
            setTimeout(() => {
                try { localStorage.clear(); sessionStorage.clear(); } catch(e) {}
                printLine('Settings cleared. Rebooting...', 'ok');
                setTimeout(() => { window.location.reload(); }, 1000);
            }, 800);
        }
    };

    function runCommand(raw) {
        var cmd = raw.trim();
        if (!cmd) return;

        history.push(cmd);
        historyIndex = history.length;
        printLine(cmd, 'cmd');
        sound('click');

        // 1. Variables (e.g. matrix = true)
        if (cmd.includes('=')) {
            var parts = cmd.split('=');
            var varName = parts[0].trim().toLowerCase();
            var varValue = parts[1].trim().toLowerCase() === 'true';

            if (varName === 'matrix') {
                if (varValue) { printLine('matrix = true', 'ok'); runMatrix(); }
                else { printLine('matrix = false (reload to fully stop)', 'ok'); }
                return;
            }
            if (varName === 'themeswitch') {
                document.body.classList.toggle('light-mode', varValue);
                if (window.SpecSettings) SpecSettings.set('theme', varValue ? 'light' : 'dark');
                else { try { localStorage.setItem('specsoft-theme', varValue ? 'light' : 'dark'); } catch (e) {} }
                var label = document.getElementById('themeLabel');
                if (label) label.textContent = varValue ? 'LIGHT MODE' : 'DARK MODE';
                printLine('themeSwitch = ' + varValue, 'ok');
                return;
            }
            printLine('Unknown variable: ' + varName, 'err');
            return;
        }

        // 2. Colors (c0 - c7) and "color c1"
        var colorMatch = cmd.match(/^(?:color\s+)?(c[0-7])$/i);
        if (colorMatch) {
            var colorCode = colorMatch[1].toLowerCase();
            var colors = ['#ffffff', '#ff5f56', '#27c93f', '#007aff', '#ffbd2e', '#ff9500', '#ff2d55', '#af52de'];
            var colorHex = colors[parseInt(colorCode[1])];
            els.log.style.color = colorHex;
            els.input.style.color = colorHex;
            els.prompt.style.color = colorHex;
            printLine('Color set to ' + colorCode, 'ok');
            return;
        }

        // 3. Rainbow (color cRainbow10 or cRainbow10)
        if (cmd.match(/^(?:color\s+)?cRainbow/i)) {
            var secs = parseInt(cmd.replace(/color\s+cRainbow/i, '').replace(/cRainbow/i, '')) || 5;
            printLine('Rainbow activated for ' + secs + ' seconds.', 'ok');
            els.panel.classList.add('st-rainbow');
            setTimeout(function() {
                els.panel.classList.remove('st-rainbow');
                els.log.style.color = ''; els.input.style.color = ''; els.prompt.style.color = '';
                printLine('Rainbow ended. Back to normal.', 'ok');
            }, secs * 1000);
            return;
        }

        // 4. Normal Commands
        if (COMMANDS[cmd]) { COMMANDS[cmd](); return; }

        var parts = cmd.split(/\s+/);
        var name = parts[0].toLowerCase();
        var arg = cmd.substring(name.length).trim(); 
        
        if (COMMANDS[name]) { COMMANDS[name](arg); return; }
        if (COMMANDS[cmd]) { COMMANDS[cmd](); return; }

        printLine('command not found: ' + cmd + ' \u2014 try "help"', 'err');
    }

    /* ---- open triggers ---- */
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