/* SPECSOFT® Studio, PHASE 6: secure Preview.
   Builds ONE page from your enabled files (in Explorer order): HTML files go in the body, CSS files in a <style>,
   "JavaScript (page)" files run inside the page. Graph-logic JavaScript does NOT go into the page.
   SECURITY: the page runs in <iframe sandbox="allow-scripts"> (opaque origin: no cookies, no storage, no access to
   Studio or your Supabase session, no popups, no top navigation) with a Content-Security-Policy that blocks ALL
   network access, remote images/scripts/fonts, frames, objects and form posts. Only data: and blob: sources work.
   Messages from the page are accepted only from that frame, with a secret token, and are validated, size-capped
   and rate-limited. A heartbeat watchdog stops a page that stops responding. Preview never publishes anything. */
(function () {
    'use strict';
    var G = window.StudioGraph, MAX_DOC = 300000, MAX_LOGS = 1000, RATE = 100, BEAT_LIMIT = 5000;
    var LEVELS = { log: 'info', info: 'info', debug: 'info', warn: 'warn', error: 'error' };
    var CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src blob:";
    var P = window.StudioPreview = {}, ui = {}, st = { running: false, token: '', frame: null, logs: 0, errors: 0, win: [], warned: 0, beat: 0, wd: 0, map: [], timer: 0 };
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

    function bridge(K) {                                 // runs INSIDE the preview page (stringified): reports logs, errors and a heartbeat
        function send(m) { m.k = K; try { parent.postMessage(m, '*'); } catch (e) {} }
        function fmt(a) { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch (e) { return String(a); } }
        ['log', 'info', 'warn', 'error', 'debug'].forEach(function (lv) {
            console[lv] = function () { send({ t: 'log', level: lv, args: [].slice.call(arguments, 0, 8).map(function (a) { return fmt(a).slice(0, 500); }) }); };
        });
        window.addEventListener('error', function (e) { send({ t: 'error', msg: String(e.message || 'Error').slice(0, 300), line: e.lineno | 0 }); });
        window.addEventListener('unhandledrejection', function (e) { send({ t: 'error', msg: 'Unhandled promise rejection: ' + fmt((e.reason && e.reason.message) || e.reason).slice(0, 300), line: 0 }); });
        document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest && e.target.closest('a[href]');
            if (a && a.getAttribute('href').charAt(0) !== '#') { e.preventDefault(); send({ t: 'log', level: 'warn', args: ['Blocked link to ' + a.getAttribute('href').slice(0, 200)] }); }
        }, true);
        addEventListener('load', function () { send({ t: 'ready' }); });
        setInterval(function () { send({ t: 'beat' }); }, 1000);
    }

    /* Turns a saved/draft graph into one page. Pure function (no DOM), so it can be tested. */
    P.assemble = function (g) {
        var files = [];
        (function walk(list, path) {
            (Array.isArray(list) ? list : []).forEach(function (n) {
                if (!n || n.enabled === false) return;
                var c = n.config || {};
                if (n.type === 'script' && (c.lang === 'html' || c.lang === 'css' || c.lang === 'pagejs')) files.push({ id: n.id, label: path + n.label, lang: c.lang, code: String(c.code || '') });
                if (n.type === 'branch' && c.sub) walk(c.sub.nodes, path + n.label + ' / ');
            });
        })(g && g.nodes, '');
        var css = files.filter(function (f) { return f.lang === 'css'; }).map(function (f) { return f.code; }).join('\n');
        var html = files.filter(function (f) { return f.lang === 'html'; }).map(function (f) { return f.code.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, ''); }).join('\n');
        var js = files.filter(function (f) { return f.lang === 'pagejs'; });
        var parts = ['<!DOCTYPE html>', '<html><head><meta charset="UTF-8">', '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">',
            '<script>(' + bridge.toString() + ')("__STUDIO_TOKEN__")<\/script>', '<style>', css, '</style></head><body>', html], map = [], line = 1;
        parts.forEach(function (p) { line += p.split('\n').length; });
        js.forEach(function (f) { parts.push('<script>'); line++; map.push({ id: f.id, label: f.label, start: line, count: f.code.split('\n').length }); parts.push(f.code); line += f.code.split('\n').length; parts.push('<\/script>'); line++; });
        parts.push('</body></html>');
        var tpl = parts.join('\n');
        return { files: files, map: map, size: tpl.length, hasHtml: files.some(function (f) { return f.lang === 'html'; }),
            doc: function (token) { return tpl.replace('"__STUDIO_TOKEN__"', function () { return JSON.stringify(token); }); } };
    };

    function token() { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
    function status(t) { if (ui.status) ui.status.textContent = t || (st.running ? 'Running, ' + st.logs + ' message(s), ' + st.errors + ' error(s)' : 'Not running'); }
    function buttons() { if (!ui.stop) return; ui.stop.disabled = !st.running; ui.reload.disabled = !st.running; }
    function locate(line) {
        for (var i = 0; i < st.map.length; i++) { var m = st.map[i]; if (line >= m.start && line < m.start + m.count) return { id: m.id, text: ' (in ' + m.label + ', line ' + (line - m.start + 1) + ')' }; }
        return { id: undefined, text: line ? ' (line ' + line + ')' : '' };
    }
    function onMsg(e) {
        if (!st.frame || e.source !== st.frame.contentWindow) return;                              // only OUR frame
        var m = e.data; if (!m || typeof m !== 'object' || m.k !== st.token) return;               // and only with the secret token
        if (m.t === 'beat') { st.beat = Date.now(); return; }
        if (m.t === 'ready') { st.beat = Date.now(); G.log('ok', 'preview', 'Page loaded'); return; }
        if (m.t !== 'log' && m.t !== 'error') return;
        var now = Date.now(); st.win = st.win.filter(function (t) { return now - t < 1000; });
        if (st.win.length >= RATE) { if (now - st.warned > 1000) { st.warned = now; G.log('warn', 'preview', 'The page is logging too fast, some messages were dropped'); } return; }
        st.win.push(now);
        if (st.logs >= MAX_LOGS) { if (st.logs === MAX_LOGS) { st.logs++; G.log('warn', 'preview', 'Message limit reached (' + MAX_LOGS + '), further messages are dropped'); } return; }
        st.logs++;
        if (m.t === 'log') {
            var lv = Object.prototype.hasOwnProperty.call(LEVELS, m.level) ? LEVELS[m.level] : 'info';
            G.log(lv, 'preview', (Array.isArray(m.args) ? m.args.slice(0, 8) : []).map(function (a) { return String(a).slice(0, 500); }).join(' ').slice(0, 1000));
        } else { st.errors++; var loc = locate(m.line | 0); G.log('error', 'preview', String(m.msg || 'Error').slice(0, 300) + loc.text, loc.id); }
        status();
    }
    function sourceGraph() {
        if (ui.source && ui.source.value === 'saved') { var s = P.getSaved && P.getSaved(); if (!s) { G.log('warn', 'preview', 'There is no saved version of this project yet'); return null; } return s; }
        return G.get();
    }
    function info(a) {
        if (!ui.info) return; ui.info.textContent = '';
        if (!G.isOpen()) { ui.info.textContent = 'Open a project to preview it.'; return; }
        if (!a.files.length) { ui.info.textContent = 'No HTML, CSS or JavaScript (page) files yet. Create them in the Code Editor.'; return; }
        ['html', 'css', 'pagejs'].forEach(function (l) {
            var f = a.files.filter(function (x) { return x.lang === l; }); if (!f.length) return;
            ui.info.appendChild(el('span', 'pv-chip', { html: 'HTML', css: 'CSS', pagejs: 'Page JS' }[l] + ': ' + f.map(function (x) { return x.label; }).join(', ')));
        });
    }
    P.stop = function (quiet) {
        clearInterval(st.wd); clearTimeout(st.timer); window.removeEventListener('message', onMsg);
        if (st.frame) { st.frame.remove(); st.frame = null; }
        var was = st.running; st.running = false; st.token = ''; buttons();
        if (ui.empty) ui.empty.hidden = false;
        if (!quiet) { status('Stopped'); if (was) G.log('warn', 'preview', 'Preview stopped'); } else status();
    };
    P.run = function () {
        P.stop(true);
        if (!G.isOpen()) { G.log('warn', 'preview', 'Open a project first'); return; }
        var g = sourceGraph(); if (!g) return;
        var a = P.assemble(g); info(a);
        if (!a.hasHtml) { G.log('warn', 'preview', 'Nothing to show yet: add an HTML file (Code Editor, New, HTML)'); status('Add an HTML file'); return; }
        if (a.size > MAX_DOC) { G.log('error', 'preview', 'The page is too large to preview (' + Math.round(a.size / 1000) + ' KB, max ' + Math.round(MAX_DOC / 1000) + ' KB)'); return; }
        st.token = token(); st.logs = 0; st.errors = 0; st.win = []; st.warned = 0; st.map = a.map; st.beat = Date.now();
        var f = document.createElement('iframe');
        f.setAttribute('sandbox', 'allow-scripts'); f.setAttribute('allow', ''); f.setAttribute('title', 'Preview'); f.referrerPolicy = 'no-referrer';
        f.srcdoc = a.doc(st.token); st.frame = f; st.running = true; window.addEventListener('message', onMsg);
        ui.host.appendChild(f); ui.empty.hidden = true; buttons(); status();
        G.log('info', 'preview', 'Preview started (' + a.files.length + ' file(s), ' + (a.size / 1000).toFixed(1) + ' KB, ' + (ui.source.value === 'saved' ? 'last saved version' : 'current draft') + ')');
        st.wd = setInterval(function () {                  // watchdog: a page that stops answering is removed
            if (Date.now() - st.beat > BEAT_LIMIT) { G.log('error', 'preview', 'The page stopped responding and was removed'); P.stop(true); status('Not responding, stopped'); }
        }, 1000);
    };
    P.onChange = function () {                           // optional automatic preview: reload shortly after the draft changes
        if (!ui.auto || !ui.auto.checked || !st.running || ui.source.value !== 'draft' || !ui.root.offsetParent) return;
        clearTimeout(st.timer); st.timer = setTimeout(P.run, 700);
    };
    P.mount = function (container) { container.appendChild(ui.root); if (st.running) P.run(); else info(P.assemble(G.isOpen() ? G.get() : {})); };
    P.isRunning = function () { return st.running; };

    function build() {
        ui.root = el('div', 'pv'); var bar = el('div', 'pv-bar');
        function btn(t, title, fn) { var b = el('button', 'st-btn', t); b.type = 'button'; b.title = title; b.addEventListener('click', fn); bar.appendChild(b); return b; }
        ui.run = btn('Run preview', 'Build the page and show it in the sandbox', P.run);
        ui.reload = btn('Reload', 'Rebuild and reload the page', P.run); ui.stop = btn('Stop', 'Remove the preview page', function () { P.stop(); });
        ui.source = el('select'); ui.source.setAttribute('aria-label', 'Preview source');
        [['draft', 'Current draft'], ['saved', 'Last saved version']].forEach(function (x) { var o = el('option', '', x[1]); o.value = x[0]; ui.source.appendChild(o); }); bar.appendChild(ui.source);
        var l = el('label', 'pv-auto'); ui.auto = el('input'); ui.auto.type = 'checkbox'; l.appendChild(ui.auto); l.appendChild(el('span', '', 'Auto-refresh while I edit')); bar.appendChild(l);
        ui.status = el('span', 'pv-status', 'Not running'); bar.appendChild(ui.status);
        ui.info = el('div', 'pv-info'); ui.host = el('div', 'pv-host'); ui.empty = el('p', 'pv-empty', 'Press Run preview. The page runs in a locked-down sandbox: no network, no access to Studio or your account.'); ui.host.appendChild(ui.empty);
        ui.root.appendChild(bar); ui.root.appendChild(ui.info); ui.root.appendChild(ui.host); buttons();
    }
    G.ext.preview = { load: function () { P.stop(true); info(P.assemble(G.isOpen() ? G.get() : {})); } };    // no save(): nothing here is stored
    build();
})();
