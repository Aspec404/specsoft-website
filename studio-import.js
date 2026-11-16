/* SPECSOFT® Studio: receives a project sent from Spectra Code (+ menu, "Import to SPECSOFT Studio").
   Spectra Code leaves the project (code files + imported images and audio) in this browser's IndexedDB ("sc_handoff") and opens studio.html?import=spectra.
   This file turns it into a NEW Studio project through Studio's own code paths (create, Save, Assets upload), so every Studio limit and check still applies.
   Mapping:  index.html            -> HTML file (linked style/script tags are removed, because those files become Studio files)
             .css                  -> CSS file
             .js                   -> JavaScript (page) file, in the order the page loaded them
             png, jpg, gif, webp   -> Assets, and every path in the code is rewritten to asset:name
             json, txt, md, csv, other pages and any other text -> text Assets (read them with studioAsset("name"))
   NOT imported: audio (Assets only hold images and text) and anything over a Studio limit. Everything skipped is listed in the Console. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var MAX_SCRIPT = 200000, MAX_GRAPH = 450000, MAX_COUNT = 60, MAX_TOTAL = 20000000, MAX_FILE = 5000000, MAX_TXT = 1000000, MAX_PREVIEW_IMG = 2000000;
    var IMG = /\.(png|jpe?g|gif|webp)$/i, SELF = window.StudioImport = {};

    function ext(p) { var m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; }
    function base(p) { return String(p).split('/').pop(); }
    function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function bytes(s) { return new TextEncoder().encode(s).length; }
    function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'; }
    function log(sev, msg) { var G = window.StudioGraph; if (G && G.log) G.log(sev, 'import', msg); else console.log('[import] ' + msg); }
    function toast(msg, kind, actions) {                 // visible banner at the top of Studio (the Console tab can be hidden, this cannot)
        if (!document.body) return;
        var t = document.getElementById('stImportToast');
        if (!t) { t = document.createElement('div'); t.id = 'stImportToast'; t.setAttribute('role', 'status'); t.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;max-width:min(680px,92vw);padding:10px 12px 10px 14px;border-radius:10px;font:13px/1.5 system-ui,sans-serif;background:#111;color:#fff;border:1px solid rgba(255,255,255,.3);box-shadow:0 8px 30px rgba(0,0,0,.5);display:flex;gap:10px;align-items:center;flex-wrap:wrap'; document.body.appendChild(t); }
        function btn(text, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.style.cssText = 'font:inherit;padding:3px 10px;border-radius:7px;border:1px solid rgba(255,255,255,.4);background:transparent;color:inherit;cursor:pointer'; b.addEventListener('click', fn); return b; }
        t.textContent = ''; t.style.borderColor = kind === 'error' ? '#ff6b6b' : kind === 'ok' ? '#6fdc84' : kind === 'warn' ? '#ffcf7a' : 'rgba(255,255,255,.3)';
        var m = document.createElement('span'); m.style.flex = '1 1 auto'; m.textContent = msg; t.appendChild(m);
        (actions || []).forEach(function (a) { t.appendChild(btn(a.text, a.fn)); }); t.appendChild(btn('x', function () { t.remove(); }));
        clearTimeout(t._t); if (kind === 'ok') t._t = setTimeout(function () { t.remove(); }, 15000);
    }
    function say(sev, msg) { log(sev, msg); toast(msg, sev); }
    function uniq(raw, taken) {                          // same rule as Studio's own Assets upload, so the name we plan is the name that gets stored
        var s = String(raw).replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '').slice(0, 60) || 'file';
        var dot = s.lastIndexOf('.'), b = dot > 0 ? s.slice(0, dot) : s, e = dot > 0 ? s.slice(dot) : '', n = s, i = 2;
        while (taken[n]) { n = b.slice(0, 60 - e.length - String(i).length - 1) + '-' + i + e; i++; }
        taken[n] = true; return n;
    }

    /* index.html -> what Studio's HTML file should hold. Studio builds the <head> and <body> itself, so only the body content and the inline <style>/<script> from the head are kept. */
    function pageHtml(src, lookup) {
        var d = new DOMParser().parseFromString(src, 'text/html'), r = { html: '', css: [], js: [], ext: [], notes: [] };
        d.querySelectorAll('link[rel~="stylesheet"][href]').forEach(function (l) { var h = lookup(l.getAttribute('href')); if (h) { r.css.push(h); l.remove(); } });
        d.querySelectorAll('script[src]').forEach(function (s) { var h = lookup(s.getAttribute('src')); if (h) { r.js.push(h); s.remove(); } else r.ext.push(s.getAttribute('src')); });
        d.querySelectorAll('meta[http-equiv]').forEach(function (m) { m.remove(); });          // Studio sets its own security policy
        var head = [].filter.call(d.head.children, function (n) { var t = n.tagName; return t === 'STYLE' || t === 'SCRIPT' || (t === 'LINK' && /stylesheet/i.test(n.getAttribute('rel') || '')); }).map(function (n) { return n.outerHTML; }).join('\n');
        if (d.body.attributes.length) r.notes.push('Attributes on <body> (' + [].map.call(d.body.attributes, function (a) { return a.name; }).join(', ') + ') could not be kept: Studio supplies its own <body>. Put them on a <div> instead.');
        r.html = (head ? head + '\n' : '') + d.body.innerHTML.trim(); return r;
    }

    /* Pure: turns the handoff bundle into the nodes, assets and notes. Nothing is stored here. */
    SELF.plan = async function (bundle) {
        var files = (bundle.files || []).filter(function (f) { return f && typeof f.path === 'string' && typeof f.content === 'string' && f.content.trim(); }).sort(function (a, b) { return a.path < b.path ? -1 : 1; });
        var out = { title: String(bundle.name || 'Spectra Code project').slice(0, 60), nodes: [], images: [], texts: [], skipped: [], notes: [], lost: [] };
        var paths = {}; files.forEach(function (f) { if (/^(css|js|mjs)$/.test(ext(f.path))) paths[f.path] = true; });
        function lookup(u) {
            u = String(u || ''); if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return '';
            var p = u.split(/[?#]/)[0].replace(/^(\.{1,2}\/)+/, '').replace(/^\//, ''); if (paths[p]) return p;
            var hit = Object.keys(paths).filter(function (k) { return base(k) === base(p); }); return hit.length === 1 ? hit[0] : '';
        }
        var taken = {}, total = 0, count = 0, map = [];
        function room(size, label) {
            if (count >= MAX_COUNT) { out.skipped.push(label + ': a Studio project holds at most ' + MAX_COUNT + ' assets'); return false; }
            if (total + size > MAX_TOTAL) { out.skipped.push(label + ': would pass the ' + fmt(MAX_TOTAL) + ' asset limit for a project'); return false; }
            count++; total += size; return true;
        }
        /* images, audio and svg that were imported into Spectra Code */
        for (var i = 0; i < (bundle.assets || []).length; i++) {
            var a = bundle.assets[i]; if (!a || !a.blob) continue;
            if (a.kind === 'img' && IMG.test(a.path)) {
                if (a.blob.size > MAX_FILE) { out.skipped.push(a.path + ': over ' + fmt(MAX_FILE) + ' (the Studio limit per file)'); continue; }
                if (!room(a.blob.size, a.path)) continue;
                var nm = uniq(base(a.path), taken); out.images.push({ name: nm, blob: a.blob, from: a.path }); map.push({ from: a.path, to: 'asset:' + nm });
                if (a.blob.size > MAX_PREVIEW_IMG) out.notes.push(nm + ' is over ' + fmt(MAX_PREVIEW_IMG) + ': it is stored, but the Preview will not load it. Use a smaller image.');
            } else if (a.kind === 'img') {                // svg: Studio image assets are png, jpg, gif and webp only
                var svg = await a.blob.text();
                if (bytes(svg) > MAX_TXT || !room(bytes(svg), a.path)) { if (bytes(svg) > MAX_TXT) out.skipped.push(a.path + ': over ' + fmt(MAX_TXT)); continue; }
                var sn = uniq(base(a.path) + '.txt', taken); out.texts.push({ name: sn, text: svg });
                out.notes.push(a.path + ' was kept as the text asset ' + sn + ' (Studio images are png, jpg, gif and webp). To use it, paste the <svg> markup into your HTML.');
                out.lost.push(a.path);
            } else { out.skipped.push(a.path + ': audio is not supported yet (Studio Assets only hold images and text)'); out.lost.push(a.path); }
        }
        /* code files */
        var htmls = files.filter(function (f) { return /^html?$/.test(ext(f.path)); });
        var main = htmls.filter(function (f) { return base(f.path).toLowerCase() === 'index.html'; })[0] || htmls[0], ph = null;
        if (main) ph = pageHtml(main.content, lookup);
        var csss = files.filter(function (f) { return ext(f.path) === 'css'; }), jss = files.filter(function (f) { return /^m?js$/.test(ext(f.path)); });
        function ordered(list, first) { var seen = {}, res = []; (first || []).concat(list.map(function (f) { return f.path; })).forEach(function (p) { if (!seen[p] && list.some(function (f) { return f.path === p; })) { seen[p] = 1; res.push(list.filter(function (f) { return f.path === p; })[0]); } }); return res; }
        csss = ordered(csss, ph && ph.css); jss = ordered(jss, ph && ph.js);
        files.forEach(function (f) {                      // everything that is not a page, css or js becomes a text asset
            var e = ext(f.path); if (f === main || e === 'css' || e === 'js' || e === 'mjs') return;
            var name = /^(json|txt|md|csv)$/.test(e) || /^html?$/.test(e) ? base(f.path) : base(f.path) + '.txt';
            if (/^html?$/.test(e)) name = base(f.path).replace(/\.htm$/i, '.html');
            if (bytes(f.content) > MAX_TXT) { out.skipped.push(f.path + ': over ' + fmt(MAX_TXT) + ' (the most a text asset can be)'); return; }
            if (!room(bytes(f.content), f.path)) return;
            var tn = uniq(name, taken); out.texts.push({ name: tn, text: f.content, from: f.path });
            if (tn !== base(f.path)) out.notes.push(f.path + ' was kept as the text asset ' + tn + ' (Studio text assets: txt, json, csv, md, js, css, html).');
            else if (/^html?$/.test(e)) out.notes.push(f.path + ' is an extra page: Studio shows ONE page, so it was kept as a text asset (' + tn + ').');
        });
        map.sort(function (x, y) { return y.from.length - x.from.length; });
        function rewrite(code) { map.forEach(function (m) { code = code.replace(new RegExp('(?:\\.{1,2}/|/)*' + rx(m.from), 'g'), m.to); }); return code; }
        var labels = {}, n = 0;
        function add(f, lang, code) {
            if (code.length > MAX_SCRIPT) { out.skipped.push(f.path + ': over ' + MAX_SCRIPT.toLocaleString('en-US') + ' characters (the Studio limit per script file)'); return; }
            var label = base(f.path); if (labels[label]) label = f.path.replace(/\//g, '-'); labels[label] = 1;
            out.nodes.push({ id: 'imp' + Date.now().toString(36) + '_' + (n++), type: 'script', label: label.slice(-40), enabled: true, x: 80, y: 80 + out.nodes.length * 120, config: { lang: lang, code: rewrite(code) } });
        }
        if (main) { add(main, 'html', ph.html); (ph.notes || []).forEach(function (m) { out.notes.push(m); }); ph.ext.forEach(function (u) { out.notes.push('The page loads ' + u + ' from the internet: turn on "Network access" in the Preview bar (or use the Dependencies page for libraries).'); }); }
        csss.forEach(function (f) { add(f, 'css', f.content); });
        jss.forEach(function (f) {
            add(f, 'pagejs', f.content);
            if (/^\s*(import\s[^;\n]*\sfrom\s|import\s*['"]|export\s)/m.test(f.content)) out.notes.push(f.path + ' uses import/export (ES modules). Studio runs page JS as one classic script, so it may not run: merge the modules into one file.');
        });
        /* things the code still points at that Studio cannot serve */
        var all = out.nodes.map(function (x) { return x.config.code; }).join('\n');
        out.lost.forEach(function (p) { if (all.indexOf(p) > -1 || all.indexOf(base(p)) > -1) out.notes.push('Your code still mentions ' + p + ', which Studio cannot load.'); });
        out.texts.forEach(function (t) { if (t.from && !/\.(html?)$/i.test(t.from) && all.indexOf(base(t.from)) > -1) out.notes.push('Your code mentions ' + base(t.from) + ': in Studio the Preview blocks fetch(), so read it with studioAsset("' + t.name + '") instead.'); });
        if (!main && out.nodes.length) out.notes.push('No index.html was found, so there is no page to preview yet. Add an HTML file in the Code Editor.');
        out.graphBytes = bytes(JSON.stringify(out.nodes)); return out;
    };

    /* the handoff lives in this browser's IndexedDB (same site as Spectra Code) */
    function dbOpen() { return new Promise(function (ok, no) { var r = indexedDB.open('sc_handoff', 1); r.onupgradeneeded = function () { r.result.createObjectStore('h'); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
    function readHandoff() { return dbOpen().then(function (db) { return new Promise(function (ok) { var q = db.transaction('h').objectStore('h').get('latest'); q.onsuccess = function () { db.close(); ok(q.result || null); }; q.onerror = function () { db.close(); ok(null); }; }); }, function () { return null; }); }
    function clearHandoff() { return dbOpen().then(function (db) { return new Promise(function (ok) { var t = db.transaction('h', 'readwrite'); t.objectStore('h').delete('latest'); t.oncomplete = t.onerror = t.onabort = function () { db.close(); ok(); }; }); }, function () { }); }
    function ready() { return new Promise(function (ok) { var t0 = Date.now(); (function poll() { var P = window.StudioProject; if (P && P.user && P.user() && window.StudioGraph && window.StudioGraph.get) return ok(true); if (Date.now() - t0 > 20000) return ok(false); setTimeout(poll, 250); })(); }); }

    SELF.run = async function () {
        var P = window.StudioProject, G = window.StudioGraph, A = window.StudioAssets;
        toast('Importing your Spectra Code project...', 'info');
        try { var tab = document.querySelector('[data-tab="log"]'); if (tab) tab.click(); } catch (e) { }
        if (!(await ready())) { say('error', 'Sign in to Studio first, then open studio.html?import=spectra again. Your project is still waiting.'); return; }
        if (!P.createNamed || !P.save) { say('error', 'studio.js is missing the createNamed and save helpers. Apply the studio.js patch.'); return; }
        var h = await readHandoff();
        if (!h) { say('error', 'Nothing was waiting to import. This must be the same website as Spectra Code (the handoff lives in this browser for this site). In Spectra Code, open the + menu and choose Import to SPECSOFT Studio again.'); return; }
        if (Date.now() - (h.t || 0) > 86400000) { say('error', 'The waiting project is over a day old, so it was ignored. Send it again from Spectra Code.'); return; }
        var pl; try { pl = await SELF.plan(h); } catch (e) { say('error', 'Could not read the project from Spectra Code: ' + String((e && e.message) || e).slice(0, 200)); return; }
        if (!pl.nodes.length && !pl.images.length && !pl.texts.length) { pl.skipped.forEach(function (m) { log('warn', 'Skipped ' + m); }); say('error', 'There was nothing Studio can import (see the Console for what was skipped).'); return; }
        if (pl.graphBytes > MAX_GRAPH) { say('error', 'This project is too big for Studio (' + Math.round(pl.graphBytes / 1000) + ' KB of code, a Studio project can hold about ' + Math.round(MAX_GRAPH / 1000) + ' KB). Nothing was imported.'); return; }
        var id = await P.createNamed(pl.title); if (!id) { say('error', 'Studio could not create the project (see the Console).'); return; }
        var g = G.get(); g.nodes = (g.nodes || []).concat(pl.nodes); G.load(g); P.markDirty(); await P.save();
        var back = G.get().nodes || [], kept = pl.nodes.filter(function (n) { return back.some(function (b) { return b.config && b.config.lang === n.config.lang && b.config.code === n.config.code; }); }).length;
        if (kept !== pl.nodes.length) { say('error', 'Studio accepted only ' + kept + ' of ' + pl.nodes.length + ' files, so the import was stopped. The node format in studio-graph.js differs from what the importer builds (see the node shape built in add() inside studio-import.js).'); return; }
        if (P.isDirty()) { say('error', 'The imported files could not be saved (see the messages above).'); return; }
        var made = 0, bad = 0;
        if ((pl.images.length || pl.texts.length) && !(A && A.add)) log('warn', 'Assets are not available, so ' + (pl.images.length + pl.texts.length) + ' asset(s) were not imported (apply the studio-assets.js patch).');
        else {
            var queue = pl.images.map(function (x) { return { name: x.name, file: new File([x.blob], x.name, { type: x.blob.type }) }; }).concat(pl.texts.map(function (x) { return { name: x.name, file: new File([x.text], x.name, { type: 'text/plain' }) }; }));
            for (var i = 0; i < queue.length; i++) {
                var r = await A.add(queue[i].file);
                if (r.row) { made++; if (r.row.name !== queue[i].name) log('warn', queue[i].name + ' was stored as ' + r.row.name + ', so references to it may not match.'); }
                else { bad++; log('warn', '"' + queue[i].name + '" was not uploaded: ' + r.msg); }
            }
        }
        var kinds = ['html', 'css', 'pagejs'].map(function (l) { var c = pl.nodes.filter(function (x) { return x.config.lang === l; }).length; return c ? c + ' ' + { html: 'HTML', css: 'CSS', pagejs: 'JavaScript (page)' }[l] : ''; }).filter(Boolean).join(', ');
        say('ok', 'Imported "' + pl.title + '": ' + (kinds || 'no code files') + (made ? ', ' + made + ' asset(s)' : '') + '. Your files are in the Explorer. ' + ((pl.skipped.length + pl.notes.length) ? (pl.skipped.length + pl.notes.length) + ' note(s) are in the Console. ' : '') + 'Open Preview and press Run preview.');
        pl.skipped.forEach(function (m) { log('warn', 'Not imported: ' + m); });
        pl.notes.forEach(function (m) { log('warn', m); });
        if (!bad) await clearHandoff();                  // keep it when an upload failed, so nothing is lost
    };

    function offer() {
        ready().then(function (ok) {
            if (!ok) return; return readHandoff().then(function (h) {
                if (!h || Date.now() - (h.t || 0) > 86400000 || document.getElementById('stImportToast')) return;
                toast('A project from Spectra Code is waiting: "' + String(h.name || 'Untitled').slice(0, 40) + '".', 'info', [{ text: 'Import it', fn: function () { SELF.run().catch(function (e) { say('error', 'Import failed: ' + String((e && e.message) || e).slice(0, 200)); }); } }, { text: 'Discard', fn: function () { clearHandoff().then(function () { var t = document.getElementById('stImportToast'); if (t) t.remove(); }); } }]);
            });
        });
    }
    if (/(^|[?&])import=spectra(&|$)/.test(location.search)) {
        try { history.replaceState(null, '', location.pathname); } catch (e) { }
        SELF.run().catch(function (e) { say('error', 'Import failed: ' + String((e && e.message) || e).slice(0, 200)); });
    } else offer();
})();
