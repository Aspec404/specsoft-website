/* SPECSOFT® Studio, PHASE 8.5c: Assets. Images (png, jpg, gif, webp) and text files (txt, json, csv, md, js, css, html) that belong to a project.
   Files live in the PRIVATE Supabase Storage bucket "studio-assets" (see supabase-studio-assets.sql), one row per file in studio_assets.
   The Preview (studio-preview.js) asks this file for the assets a page mentions and inlines them: images as data: addresses
   (write asset:name.png wherever an image address goes), text files through studioAsset("name") in Page JS.
   Everything a person uploads is treated as untrusted: names are checked, images are verified by their first bytes, text must be
   valid UTF-8, text is uploaded as text/plain, and names are only ever shown with textContent. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var G = window.StudioGraph, BUCKET = 'studio-assets', MAX_FILE = 5000000, MAX_IMG = 2000000, MAX_TXT = 1000000, MAX_COUNT = 60, MAX_TOTAL = 20000000, NAME = /^[A-Za-z0-9._-]{1,60}$/;
    var KINDS = { png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'], gif: ['image/gif', 'image'], webp: ['image/webp', 'image'],
        txt: ['text/plain', 'text'], json: ['text/plain', 'text'], csv: ['text/plain', 'text'], md: ['text/plain', 'text'], js: ['text/plain', 'text'], css: ['text/plain', 'text'], html: ['text/plain', 'text'] };
    var A = window.StudioAssets = {}, st = { pid: null, list: null, error: '', busy: false, msg: '', draft: { name: '', text: '' } }, cache = {}, thumbs = {}, ui = {};
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function log(sev, msg) { if (G && G.log) G.log(sev, 'assets', msg); }
    function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'; }
    function friendly(err) {
        var m = String((err && err.message) || err || 'Unknown error');
        if (/studio_assets|schema cache|does not exist|relation|bucket not found/i.test(m)) return 'Assets are not set up yet. Run supabase-studio-assets.sql in the Supabase SQL Editor, then reload this page.';
        return m.slice(0, 200);
    }
    function ctx() { var P = window.StudioProject; return P && P.current() ? { sb: P.client(), user: P.user(), pid: P.current().id } : null; }

    async function loadList(force) {
        var c = ctx(); st.error = '';
        if (!c) { st.pid = null; st.list = null; return null; }
        if (!force && st.pid === c.pid && st.list) return st.list;
        var r = await c.sb.from('studio_assets').select('id,name,path,mime,size,created_at').eq('project_id', c.pid).order('created_at', { ascending: true });
        st.pid = c.pid;
        if (r.error) { st.list = null; st.error = friendly(r.error); throw new Error(st.error); }
        st.list = r.data || []; return st.list;
    }
    function sniff(u8) {                                 // what an image really is, from its first bytes (the file name is not trusted)
        function at(i, s) { for (var k = 0; k < s.length; k++) if (u8[i + k] !== s.charCodeAt(k)) return false; return true; }
        if (u8.length > 8 && u8[0] === 0x89 && at(1, 'PNG')) return 'image/png';
        if (u8.length > 3 && u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'image/jpeg';
        if (u8.length > 6 && (at(0, 'GIF87a') || at(0, 'GIF89a'))) return 'image/gif';
        if (u8.length > 12 && at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
        return '';
    }
    function isText(u8) {
        for (var i = 0, n = Math.min(u8.length, 4096); i < n; i++) if (u8[i] === 0) return false;
        try { new TextDecoder('utf-8', { fatal: true }).decode(u8); return true; } catch (e) { return false; }
    }
    function safeName(raw, taken) {
        var s = String(raw).replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '').slice(0, 60) || 'file';
        var dot = s.lastIndexOf('.'), base = dot > 0 ? s.slice(0, dot) : s, ext = dot > 0 ? s.slice(dot) : '', n = s, i = 2;
        while (taken[n]) { n = (base.slice(0, 60 - ext.length - String(i).length - 1) + '-' + i + ext); i++; }
        return n;
    }
    function dataUrl(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = function () { rej(new Error('Could not read the file')); }; r.readAsDataURL(blob); }); }
    async function download(row) {
        var c = ctx(); if (!c) throw new Error('Open a project first');
        var r = await c.sb.storage.from(BUCKET).download(row.path); if (r.error) throw new Error(friendly(r.error));
        return new Blob([r.data], { type: row.mime });
    }

    async function upload(file) {
        var c = ctx(); if (!c) { st.msg = 'Open a project first.'; return; }
        var list = await loadList(false), ext = (file.name.split('.').pop() || '').toLowerCase(), kind = KINDS[ext];
        if (!kind) { st.msg = '"' + String(file.name).slice(0, 60) + '": this file type is not allowed (png, jpg, gif, webp, txt, json, csv, md, js, css, html).'; return; }
        if (file.size <= 0 || file.size > MAX_FILE) { st.msg = '"' + String(file.name).slice(0, 60) + '": files must be between 1 byte and ' + fmt(MAX_FILE) + '.'; return; }
        var total = list.reduce(function (s, a) { return s + a.size; }, 0);
        if (list.length >= MAX_COUNT) { st.msg = 'This project already has ' + MAX_COUNT + ' assets (the maximum).'; return; }
        if (total + file.size > MAX_TOTAL) { st.msg = 'Adding this file would pass the ' + fmt(MAX_TOTAL) + ' limit for a project.'; return; }
        var u8 = new Uint8Array(await file.arrayBuffer()), mime = kind[0];
        if (kind[1] === 'image' && sniff(u8) !== mime) { st.msg = '"' + String(file.name).slice(0, 60) + '" is not really a ' + ext + ' image, so it was not uploaded.'; return; }
        if (kind[1] === 'text' && !isText(u8)) { st.msg = '"' + String(file.name).slice(0, 60) + '" is not plain UTF-8 text, so it was not uploaded.'; return; }
        var taken = {}; list.forEach(function (a) { taken[a.name] = true; });
        var name = safeName(file.name, taken), id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)), path = c.user.id + '/' + c.pid + '/' + id;
        var up = await c.sb.storage.from(BUCKET).upload(path, new Blob([u8], { type: mime }), { contentType: mime, upsert: false });
        if (up.error) { st.msg = friendly(up.error); return; }
        var ins = await c.sb.from('studio_assets').insert({ project_id: c.pid, name: name, path: path, mime: mime, size: u8.length }).select('id,name,path,mime,size,created_at').single();
        if (ins.error) { await c.sb.storage.from(BUCKET).remove([path]); st.msg = friendly(ins.error); return; }
        list.push(ins.data); log('ok', 'Uploaded "' + name + '" (' + fmt(u8.length) + ')');
    }

    /* ---- what the Preview needs ---- */
    A.refs = function (files) {                          // asset names mentioned in the page's files
        var img = {}, txt = {}, a = /asset:([A-Za-z0-9._-]{1,60})/g, b = /studioAsset\(\s*['"]([A-Za-z0-9._-]{1,60})['"]\s*\)/g, m;
        (files || []).forEach(function (f) { while ((m = a.exec(f.code)) && Object.keys(img).length < 60) img[m[1]] = true; while ((m = b.exec(f.code)) && Object.keys(txt).length < 60) txt[m[1]] = true; });
        var out = { images: Object.keys(img), texts: Object.keys(txt) }; out.any = out.images.length + out.texts.length > 0; return out;
    };
    A.load = async function (refs) {
        var out = { images: {}, texts: {}, notes: [] }, list;
        try { list = await loadList(false); } catch (e) { out.notes.push(st.error || 'Assets could not be listed.'); return out; }
        var by = {}; (list || []).forEach(function (a) { by[a.name] = a; });
        async function get(name, want) {
            var row = by[name]; if (!row) { out.notes.push('Asset "' + name + '" was not found in Assets.'); return; }
            var isImg = row.mime.indexOf('image/') === 0;
            if (want === 'image' && !isImg) { out.notes.push('"' + name + '" is a text file: read it with studioAsset("' + name + '") instead of asset:' + name + '.'); return; }
            if (want === 'text' && isImg) { out.notes.push('"' + name + '" is an image: use asset:' + name + ' instead of studioAsset().'); return; }
            if (row.size > (isImg ? MAX_IMG : MAX_TXT)) { out.notes.push('"' + name + '" is too large to put in the Preview (' + fmt(row.size) + ', the limit is ' + fmt(isImg ? MAX_IMG : MAX_TXT) + ').'); return; }
            try {
                if (!cache[row.id]) { var blob = await download(row); cache[row.id] = isImg ? await dataUrl(blob) : await blob.text(); }
                (isImg ? out.images : out.texts)[name] = cache[row.id];
            } catch (e) { out.notes.push('"' + name + '" could not be downloaded: ' + String((e && e.message) || e).slice(0, 120)); }
        }
        for (var i = 0; i < refs.images.length; i++) await get(refs.images[i], 'image');
        for (var j = 0; j < refs.texts.length; j++) await get(refs.texts[j], 'text');
        return out;
    };
    A.known = function () {                              // names of this project's assets, or null while the list is not loaded (used by Validate)
        var c = ctx(); if (!c || st.pid !== c.pid || !st.list) return null;
        var m = {}; st.list.forEach(function (a) { m[a.name] = true; }); return m;
    };

    /* ---- the Assets page ---- */
    function ref(a) { return a.mime.indexOf('image/') === 0 ? 'asset:' + a.name : 'studioAsset("' + a.name + '")'; }
    function thumb(a, img) {
        if (thumbs[a.id]) { img.src = thumbs[a.id]; return; }
        if (a.size > MAX_IMG) return;
        download(a).then(function (b) { thumbs[a.id] = URL.createObjectURL(b); img.src = thumbs[a.id]; }, function () {});
    }
    function draw() {
        var host = ui.host; if (!host) return; host.textContent = '';
        var w = el('div', 'pg as'); w.appendChild(el('h1', '', 'Assets'));
        w.appendChild(el('p', 'pg-lead', 'Images and text files for this project, kept private to you. In HTML, CSS and Page JS write asset:name.png wherever an image address goes. In Page JS, studioAsset("data.json") gives you a text file as a string. You can also paste code or text into the box below instead of uploading a file. The Preview only loads the assets your files mention. Assets are not part of published releases yet.'));
        if (!ctx()) { w.appendChild(el('p', 'pg-lead', 'Open a project to manage its assets.')); host.appendChild(w); return; }
        if (st.error) { var er = el('p', 'as-msg', st.error); er.setAttribute('role', 'alert'); w.appendChild(er); host.appendChild(w); return; }
        var list = st.list || [], total = list.reduce(function (s, a) { return s + a.size; }, 0);
        var bar = el('div', 'as-bar'), pick = el('input'); pick.type = 'file'; pick.multiple = true; pick.setAttribute('aria-label', 'Choose files to upload');
        pick.accept = Object.keys(KINDS).map(function (k) { return '.' + k; }).join(',');
        pick.addEventListener('change', function () { go(pick.files); });
        bar.appendChild(pick); bar.appendChild(el('span', 'as-meter', list.length + ' of ' + MAX_COUNT + ' files, ' + fmt(total) + ' of ' + fmt(MAX_TOTAL)));
        w.appendChild(bar);
        var drop = el('div', 'as-drop', st.busy ? 'Uploading...' : 'Or drop files here'); drop.tabIndex = 0;
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
        drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files) go(e.dataTransfer.files); });
        w.appendChild(drop);
        var pb = el('div', 'as-paste'); pb.appendChild(el('strong', '', 'Or paste text or code'));
        var nm = el('input'); nm.type = 'text'; nm.maxLength = 60; nm.placeholder = 'Name, like helper.js or data.json'; nm.value = st.draft.name; nm.setAttribute('aria-label', 'Name for the new text asset');
        nm.addEventListener('input', function () { st.draft.name = nm.value; });
        var ta = el('textarea'); ta.rows = 8; ta.spellcheck = false; ta.placeholder = 'Paste your code or text here. Best for small snippets: for a big library, upload the file instead.'; ta.value = st.draft.text; ta.setAttribute('aria-label', 'Text for the new asset');
        ta.addEventListener('input', function () { st.draft.text = ta.value; });
        [nm, ta].forEach(function (x) { x.style.display = 'block'; x.style.width = '100%'; x.style.boxSizing = 'border-box'; x.style.margin = '6px 0'; x.style.padding = '6px'; x.style.background = 'transparent'; x.style.color = 'inherit'; x.style.border = '1px solid rgba(255,255,255,.25)'; x.style.font = 'inherit'; }); ta.style.fontFamily = 'monospace'; ta.style.resize = 'vertical';
        var sv = el('button', 'st-btn', 'Save as asset'); sv.type = 'button'; sv.disabled = st.busy; sv.addEventListener('click', pasteSave);
        pb.appendChild(nm); pb.appendChild(ta); pb.appendChild(sv); w.appendChild(pb);
        if (st.msg) { var ms = el('p', 'as-msg', st.msg); ms.setAttribute('role', 'status'); w.appendChild(ms); }
        var grid = el('div', 'as-grid');
        if (!list.length) grid.appendChild(el('p', 'pg-lead', 'No assets yet.'));
        list.forEach(function (a) {
            var card = el('div', 'as-card'), isImg = a.mime.indexOf('image/') === 0, box = el('div', 'as-thumb');
            if (isImg) { var im = el('img'); im.alt = ''; im.loading = 'lazy'; box.appendChild(im); thumb(a, im); } else box.appendChild(el('span', '', 'TXT'));
            card.appendChild(box); card.appendChild(el('strong', 'as-name', a.name)); card.appendChild(el('small', '', (isImg ? 'image' : 'text') + ', ' + fmt(a.size)));
            var row = el('div', 'as-row');
            function btn(t, aria, fn) { var b = el('button', 'st-btn', t); b.type = 'button'; b.setAttribute('aria-label', aria + ' ' + a.name); b.addEventListener('click', fn); row.appendChild(b); return b; }
            btn('Copy reference', 'Copy the reference for', function () { var r = ref(a); try { navigator.clipboard.writeText(r).then(function () { st.msg = 'Copied ' + r; draw(); }, function () { st.msg = 'Your browser blocked copying. The reference is ' + r; draw(); }); } catch (e) { st.msg = 'The reference is ' + r; draw(); } });
            btn('Rename', 'Rename', function () { rename(a); }); btn('Delete', 'Delete', function () { remove(a); });
            card.appendChild(row); grid.appendChild(card);
        });
        w.appendChild(grid); host.appendChild(w);
    }
    async function go(files) {
        if (st.busy) return; st.busy = true; st.msg = ''; draw();
        try { for (var i = 0; i < files.length && i < 20; i++) { try { await upload(files[i]); } catch (e) { st.msg = friendly(e); } draw(); } }
        finally { st.busy = false; draw(); }
    }
    async function pasteSave() {                         // text typed or pasted into the box becomes a text asset, through the same checks as an uploaded file
        if (st.busy) return; var name = st.draft.name.trim(), text = st.draft.text;
        if (!NAME.test(name) || !/\.(txt|json|csv|md|js|css|html)$/i.test(name)) { st.msg = 'Give it a name that ends in .js, .json, .css, .html, .txt, .md or .csv (letters, digits, dot, dash, underscore).'; draw(); return; }
        if (!text.trim()) { st.msg = 'Paste or type something first.'; draw(); return; }
        if (new TextEncoder().encode(text).length > MAX_TXT) { st.msg = 'That is over ' + fmt(MAX_TXT) + ', the most a text asset can be for the Preview. Split it, or upload it as a file if it is only stored.'; draw(); return; }
        st.busy = true; st.msg = ''; draw();
        try { await upload(new File([text], name, { type: 'text/plain' })); if (!st.msg) st.draft = { name: '', text: '' }; }
        catch (e) { st.msg = friendly(e); }
        finally { st.busy = false; draw(); }
    }
    async function rename(a) {
        var c = ctx(); if (!c) return;
        var nn = window.prompt('New name for ' + a.name + ' (letters, digits, dot, dash, underscore). Files that mention the old name will stop finding it.', a.name);
        if (nn === null) return; nn = nn.trim();
        if (!NAME.test(nn)) { st.msg = 'That name is not allowed (use letters, digits, dot, dash, underscore, up to 60 characters).'; draw(); return; }
        if (st.list.some(function (x) { return x.name === nn && x.id !== a.id; })) { st.msg = 'Another asset already has that name.'; draw(); return; }
        var r = await c.sb.from('studio_assets').update({ name: nn }).eq('id', a.id);
        if (r.error) st.msg = friendly(r.error); else { a.name = nn; st.msg = 'Renamed to ' + nn + '.'; } draw();
    }
    async function remove(a) {
        var c = ctx(); if (!c || !window.confirm('Delete "' + a.name + '"? This cannot be undone.')) return;
        var s = await c.sb.storage.from(BUCKET).remove([a.path]); if (s.error) { st.msg = friendly(s.error); draw(); return; }
        var r = await c.sb.from('studio_assets').delete().eq('id', a.id); if (r.error) { st.msg = friendly(r.error); draw(); return; }
        st.list = st.list.filter(function (x) { return x.id !== a.id; }); delete cache[a.id];
        if (thumbs[a.id]) { URL.revokeObjectURL(thumbs[a.id]); delete thumbs[a.id]; }
        st.msg = 'Deleted ' + a.name + '.'; log('warn', 'Deleted "' + a.name + '"'); draw();
    }
    A.render = function (host) {
        ui.host = host; st.msg = ''; draw();
        loadList(true).then(draw, draw);
    };
})();
