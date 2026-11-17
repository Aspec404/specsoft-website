/* SPECSOFT® Spectra Code. Load AFTER main.js. Talks to the Supabase Edge Function "spectra-code".
   Flow: Spectra PLANS (orchestrator) -> Spectres write files IN PARALLEL -> you review each file (Git tab) before accepting. */
(function () {
'use strict';
const GHOST = {};  // a missing element becomes a harmless detached <div>, so a revamped layout can never crash this script
const $ = s => document.querySelector(s) || (GHOST[s] = GHOST[s] || document.createElement('div')), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const EFF = ['low', 'medium', 'high', 'xhigh'], EFFN = ['Low', 'Medium', 'High', 'Extra High'];
let P = LS('sc_projects', []), cur = LS('sc_cur', null), busy = false, ctl = null, tick = null;
if (!P.length) { P = [mk('Project 1')]; cur = P[0].id; }
if (!P.find(p => p.id === cur)) cur = P[0].id;
function mk(name) { return { id: 'p' + Date.now() + Math.random().toString(36).slice(2, 5), name, t: Date.now(), msgs: [], files: {} }; }
const proj = () => P.find(p => p.id === cur);
const save = () => {
  if (SS('sc_projects', P)) { SS('sc_cur', cur); return; }
  // browser storage is full: drop old versions and retry so new files are not silently lost
  P.forEach(p => Object.values(p.files).forEach(f => { if (f.versions) f.versions = f.versions.slice(-2); }));
  if (SS('sc_projects', P)) SS('sc_cur', cur); else $('#scLeft').textContent = 'Storage full! Download your files';
};

async function req(body, signal) {
  const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session;
  if (!s) throw new Error('LOGIN');
  return fetch(window.SPECSOFT_CONFIG.SUPABASE_URL + '/functions/v1/spectra-code', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: window.SPECSOFT_CONFIG.SUPABASE_ANON_KEY }, body: JSON.stringify(body) });
}

/* ---------- assets: images / music / sfx. Blobs live in IndexedDB (localStorage is far too small), only tiny metadata goes in the project ---------- */
const AK = { img: { dir: 'assets/images/', max: 10, re: /\.(png|jpe?g|webp|gif|svg)$/i, name: 'image' }, mp3: { dir: 'assets/audio/', max: 30, re: /\.(mp3|m4a)$/i, name: 'MP3/M4A' }, sfx: { dir: 'assets/sfx/', max: 5, re: /\.(mp3|wav|ogg|m4a)$/i, name: 'sound effect' } };
const KT = { img: 'IMG', mp3: 'MUSIC', sfx: 'SFX' };
let aopen = null, aurl = null, pvUrls = [], _db = null;
const idb = () => _db || (_db = new Promise((ok, no) => { const r = indexedDB.open('sc_assets', 1); r.onupgradeneeded = () => r.result.createObjectStore('a'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
const idbTx = async (mode, fn) => { const db = await idb(); return new Promise((ok, no) => { const t = db.transaction('a', mode), q = fn(t.objectStore('a')); t.oncomplete = () => ok(q && q.result); t.onerror = t.onabort = () => no(t.error); }); };
const aPut = (pid, path, blob) => idbTx('readwrite', s => s.put(blob, pid + '|' + path));
const aGet = (pid, path) => idbTx('readonly', s => s.get(pid + '|' + path));
const aDel = (pid, path) => idbTx('readwrite', s => s.delete(pid + '|' + path));
const aDelAll = p => Promise.all(Object.keys(p.assets || {}).map(k => aDel(p.id, k))).catch(() => { });
const fmtSz = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const assetList = () => Object.entries(proj().assets || {}).map(([path, a]) => ({ path, kind: a.kind, size: a.size, w: a.w, h: a.h, dur: a.dur }));
const probe = (file, kind) => new Promise(ok => {
  const u = URL.createObjectURL(file); let to;
  const end = v => { clearTimeout(to); URL.revokeObjectURL(u); ok(v); }; to = setTimeout(() => end({}), 3000);
  if (kind === 'img') { const i = new Image(); i.onload = () => end(i.naturalWidth ? { w: i.naturalWidth, h: i.naturalHeight } : {}); i.onerror = () => end({}); i.src = u; }
  else { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => end(isFinite(a.duration) ? { dur: Math.round(a.duration * 10) / 10 } : {}); a.onerror = () => end({}); a.src = u; }
});
async function importAssets(kind, list) {
  const p = proj(), K = AK[kind], A = p.assets || (p.assets = {}), added = [];
  for (const f of list.slice(0, 10)) {
    if (!K.re.test(f.name)) { log('skipped ' + f.name + ' (not a ' + K.name + ' file)'); continue; }
    if (f.size > K.max * 1048576) { log('skipped ' + f.name + ' (over ' + K.max + ' MB)'); continue; }
    let nm = f.name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w.-]/g, '').slice(-40); if (!/^\w/.test(nm)) nm = 'a' + nm;
    let path = K.dir + nm, n = 2; while (A[path]) path = K.dir + nm.replace(/(\.\w+)$/, '-' + (n++) + '$1');
    try { await aPut(p.id, path, f); } catch (e) { log('could not store ' + f.name + ' (browser storage full?)'); continue; }
    A[path] = Object.assign({ kind, size: f.size, type: f.type || '' }, await probe(f, kind)); added.push(path);
  }
  if (!added.length) { log('no ' + K.name + ' files added (max ' + K.max + ' MB each)'); return; }
  save(); say('Imported ' + added.join(', ') + '. Tell me where to use ' + (added.length > 1 ? 'them' : 'it') + ' and the Spectres will wire the exact path in.'); log('assets: ' + added.join(', ')); renderAll();
}
function assetsHtml() {
  const A = Object.entries(proj().assets || {}); if (!A.length) return '';
  return '<div class="ide-g">Assets</div>' + A.map(([n, a]) => `<div class="ide-as ${aopen === n ? 'on' : ''}" data-aopen="${esc(n)}"><i class="ide-ak">${KT[a.kind] || 'FILE'}</i><span title="${esc(n)}">${esc(n.replace(/^assets\//, ''))}</span><small>${fmtSz(a.size)}</small><u data-adel="${esc(n)}" title="Remove">×</u></div>` + (aopen === n ? `<div class="ide-ap" data-aprev="${esc(n)}"></div>` : '')).join('');
}
async function hydrate() {
  const el = document.querySelector('[data-aprev]'); if (!el) return;
  const p = proj(), path = el.dataset.aprev, a = (p.assets || {})[path], blob = a && await aGet(p.id, path).catch(() => null);
  if (!blob || !document.body.contains(el)) return;
  if (aurl) URL.revokeObjectURL(aurl); aurl = URL.createObjectURL(blob);
  el.innerHTML = (a.kind === 'img' ? `<img src="${aurl}" alt="">` : `<audio controls preload="metadata" src="${aurl}"></audio>`) + `<code>${esc(path)}</code><small>${[a.w ? a.w + '×' + a.h : '', a.dur ? a.dur + 's' : '', fmtSz(a.size)].filter(Boolean).join(' · ')}</small>`;
}
function downloadAssets(skip) {
  Object.keys(proj().assets || {}).forEach(async (n, i) => { const b = await aGet(proj().id, n).catch(() => null); if (!b) return; setTimeout(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = n.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, (skip + i) * 300); });
}
/* tiny STORE-only zip writer so the download keeps the assets/ folders */
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(entries) {
  const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const nm = enc.encode(e.name), crc = crc32(e.data), sz = e.data.length;
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(lh.buffer, nm, e.data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    cd.push(ch.buffer, nm); off += 30 + nm.length + sz;
  }
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cd.reduce((a, b) => a + b.byteLength, 0), true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cd, end.buffer], { type: 'application/zip' });
}
async function zipDl() {
  const p = proj(), enc = new TextEncoder(), en = Object.entries(p.files).map(([n, f]) => ({ name: n, data: enc.encode(f.content) }));
  for (const n of Object.keys(p.assets || {})) { const b = await aGet(p.id, n).catch(() => null); if (b) en.push({ name: n, data: new Uint8Array(await b.arrayBuffer()) }); }
  if (!en.length) { log('nothing to zip yet'); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(zip(en)); a.download = (p.name || 'project').replace(/[^\w-]+/g, '-') + '.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); log('zipped ' + en.length + ' files');
}

/* ---------- Import to SPECSOFT Studio: turns this project into Studio files/nodes + assets (pure, nothing is stored here) ---------- */
const studioPlan = (() => {
    const MAX_SCRIPT = 200000, MAX_GRAPH = 450000, MAX_COUNT = 60, MAX_TOTAL = 20000000, MAX_FILE = 5000000, MAX_TXT = 1000000, MAX_PREVIEW_IMG = 2000000, IMG = /\.(png|jpe?g|gif|webp)$/i;
    function ext(p) { var m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; }
    function base(p) { return String(p).split('/').pop(); }
    function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function bytes(s) { return new TextEncoder().encode(s).length; }
    function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'; }
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
    async function plan(bundle) {
        var files = (bundle.files || []).filter(function (f) { return f && typeof f.path === 'string' && typeof f.content === 'string' && f.content.trim(); }).sort(function (a, b) { return a.path < b.path ? -1 : 1; });
        var out = { title: 'Spectra Code Import', nodes: [], images: [], texts: [], skipped: [], notes: [], lost: [] };
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
            out.nodes.push({ id: 'imp' + Date.now().toString(36) + '_' + (n++), type: 'script', label: label.slice(-40), enabled: true, x: 40 + (out.nodes.length % 5) * 180, y: 40 + Math.floor(out.nodes.length / 5) * 90, config: { lang: lang, code: rewrite(code) } });
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
    }

    return plan;
})();
const STUDIO_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
async function studioAssetUp(sb, uid, pid, name, blob, mime) {   // same storage path and table row as Studio's own Assets page
  const path = uid + '/' + pid + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
  const up = await sb.storage.from('studio-assets').upload(path, new Blob([blob], { type: mime }), { contentType: mime, upsert: false });
  if (up.error) return up.error.message;
  const ins = await sb.from('studio_assets').insert({ project_id: pid, name, path, mime, size: blob.size });
  if (ins.error) { await sb.storage.from('studio-assets').remove([path]); return ins.error.message; }
  return '';
}
/* Creates a NEW Studio project called "Spectra Code Import" straight in the Studio database (you are logged in to both), then opens Studio on it. */
async function sendToStudio() {
  const p = proj(), names = Object.keys(p.files);
  if (!names.length && !Object.keys(p.assets || {}).length) { log('nothing to send to Studio yet: build or import something first'); return; }
  const w = window.open('about:blank', '_blank');        // opened first, inside the click, so popup blockers allow it
  const fail = m => { if (w) w.close(); log('Studio import failed: ' + m); say('Studio import failed: ' + m, { err: 1 }); };
  try {
    const sb = window.getSupabaseClient && window.getSupabaseClient(), ses = sb && (await sb.auth.getSession()).data.session;
    if (!ses) return fail('you are not logged in. Log in, then try again.');
    log('sending to SPECSOFT Studio...');
    const assets = [];
    for (const [path, a] of Object.entries(p.assets || {})) { const blob = await aGet(p.id, path).catch(() => null); if (blob) assets.push({ path, kind: a.kind, size: a.size, type: a.type || '', blob }); }
    const pl = await studioPlan({ files: names.map(path => ({ path, content: p.files[path].content })), assets });
    if (!pl.nodes.length && !pl.images.length && !pl.texts.length) return fail('there was nothing Studio can import. ' + pl.skipped.join('; '));
    if (pl.graphBytes > 450000) return fail('the code is too big for one Studio project (' + Math.round(pl.graphBytes / 1000) + ' KB, the limit is about 450 KB).');
    const r = await sb.from('studio_projects').insert({ owner_id: ses.user.id, title: pl.title, graph: { version: 3, nodes: pl.nodes, connections: [], frames: [], groups: [], folders: [] } }).select('id').single();
    if (r.error) return fail(r.error.message + (/studio_projects/.test(r.error.message) ? ' (run supabase-studio.sql first)' : ''));
    let made = 0; const bad = [];
    for (const it of pl.images) { const e = await studioAssetUp(sb, ses.user.id, r.data.id, it.name, it.blob, STUDIO_MIME[it.name.split('.').pop().toLowerCase()] || 'image/png'); if (e) bad.push(it.name + ': ' + e); else made++; }
    for (const it of pl.texts) { const e = await studioAssetUp(sb, ses.user.id, r.data.id, it.name, new Blob([it.text]), 'text/plain'); if (e) bad.push(it.name + ': ' + e); else made++; }
    const kinds = ['html', 'css', 'pagejs'].map(l => { const c = pl.nodes.filter(x => x.config.lang === l).length; return c ? c + ' ' + { html: 'HTML', css: 'CSS', pagejs: 'JavaScript (page)' }[l] : ''; }).filter(Boolean).join(', ');
    const notes = [...pl.skipped.map(m => 'Not imported: ' + m), ...bad.map(m => 'Asset failed: ' + m), ...pl.notes];
    log('Studio project "' + pl.title + '" created: ' + kinds + (made ? ', ' + made + ' asset(s)' : ''));
    say('Sent to SPECSOFT Studio as "' + pl.title + '": ' + (kinds || 'no code files') + (made ? ', ' + made + ' asset(s)' : '') + '. Opening Studio now (look for it in the project list if it does not open by itself).' + (notes.length ? '\n\nHeads up:\n- ' + notes.slice(0, 8).join('\n- ') + (notes.length > 8 ? '\n- and ' + (notes.length - 8) + ' more' : '') : ''), notes.length ? { err: 1 } : undefined);
    const url = 'studio.html?open=' + r.data.id; if (w) w.location.href = url; else location.href = url;
  } catch (e) { fail((e && e.message) || String(e)); }
}

/* ---------- diff (line based) ---------- */
function diff(a, b) {
  const A = a ? a.split('\n') : [], B = b.split('\n');
  if (A.length * B.length > 360000) return B.map((l, i) => ({ k: '+', n: i + 1, l }));
  const m = A.length, n = B.length, L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let k = n - 1; k >= 0; k--) L[i][k] = A[i] === B[k] ? L[i + 1][k + 1] + 1 : Math.max(L[i + 1][k], L[i][k + 1]);
  const o = []; let i = 0, k = 0;
  while (i < m && k < n) { if (A[i] === B[k]) { o.push({ k: ' ', n: k + 1, l: B[k] }); i++; k++; } else if (L[i + 1][k] >= L[i][k + 1]) { o.push({ k: '-', n: i + 1, l: A[i] }); i++; } else { o.push({ k: '+', n: k + 1, l: B[k] }); k++; } }
  while (i < m) { o.push({ k: '-', n: i + 1, l: A[i++] }); } while (k < n) { o.push({ k: '+', n: k + 1, l: B[k++] }); }
  return o;
}
const stat = d => ({ a: d.filter(x => x.k === '+').length, d: d.filter(x => x.k === '-').length });
const statH = s => `<span class="sc-stat"><i class="a">+${s.a}</i>${s.d ? '<i class="d">−' + s.d + '</i>' : ''}</span>`;
function dview(d, max) {
  const keep = new Set(); d.forEach((x, i) => { if (x.k !== ' ') for (let q = i - 2; q <= i + 2; q++) keep.add(q); });
  let h = '', gap = 0, rows = 0;
  d.forEach((x, i) => {
    if (!keep.has(i)) { gap++; return; }
    if (gap) { h += `<div class="sc-gap">${gap} unmodified lines</div>`; gap = 0; }
    if (++rows > max) return;
    h += `<div class="sc-l ${x.k === '+' ? 'a' : x.k === '-' ? 'd' : ''}"><i>${x.n}</i><code>${esc(x.l) || ' '}</code></div>`;
  });
  if (gap) h += `<div class="sc-gap">${gap} unmodified lines</div>`;
  if (rows > max) h += `<div class="sc-gap">${rows - max} more lines</div>`;
  return h;
}
const fdiff = f => diff(f.old || '', f.content);
const fcard = (n, f, max, btns) => { const d = fdiff(f); return `<div class="sc-f"><div class="sc-fh"><em>${f.old ? 'M' : 'A'}</em><span>${esc(n)}</span>${statH(stat(d))}${btns}</div><div class="sc-diff">${dview(d, max)}</div></div>`; };
const log = t => { const el = $('#scTerm'); el.textContent += '[' + new Date().toLocaleTimeString() + '] ' + t + '\n'; if (el.parentNode) el.parentNode.scrollTop = 1e9; };

/* ---------- render ---------- */
function renderTabs() { }
function renderMsgs() {
  const m = proj().msgs, box = $('#scMsgs');
  box.innerHTML = m.length ? m.map(x => x.r === 'u' ? `<div class="sc-m u"><b>❯</b> ${esc(x.t)}</div>` : `<div class="sc-m ${x.err ? 'err' : ''}"><b class="sc-bul">●</b>${esc(x.t)}${x.sp ? '<div class="sc-tree">' + x.sp.map((s, i) => spCard(s, i === x.sp.length - 1)).join('') + '</div>' : ''}${x.files ? editCards(x.files) : ''}${x.go ? '<div><button class="sc-btn ok" data-go style="margin-top:10px">Build this plan</button></div>' : ''}</div>`).join('')
    : '<div class="sc-empty"><pre>  ◆ SPECTRA CODE\n  Lumen 4 · Spectres online</pre>Describe what to build. Spectra plans it, then her Spectres write the files at the same time.<span class="sc-cur"></span></div>';
  box.scrollTop = 1e9;
}
const editCards = names => { const f = proj().files, ok = names.filter(n => f[n]); return ok.length ? `<div class="sc-edit"><b class="sc-bul">●</b>Edited ${ok.length} file${ok.length > 1 ? 's' : ''}<div class="sc-tree">${ok.map((n, i) => `<button class="sc-tr sc-o" data-open="${esc(n)}"><span class="sc-br">${i === ok.length - 1 ? '└' : '├'}</span><em>${f[n].old ? 'M' : 'A'}</em><span class="sc-tt">${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button>`).join('')}</div></div>` : ''; };
const spCard = (s, last) => `<div class="sc-tr" data-sid="${s.id}"><span class="sc-br">${last ? '└' : '├'}</span><span class="sc-role">${s.role}</span><span class="sc-tt">${esc(s.title)}<small>${esc(s.files.join(', '))}</small></span><span class="sc-st" data-s="${s.st}">${s.st}</span></div>`;
let sel = null, view = 'exp', act = 'chat', alt = null, ptab = 'props', openT = [], q = '', verI = null, palI = 0, palItems = [];
const base = n => n.split('/').pop();
const codeOf = s => s.split('\n').slice(0, 5000).map((l, i) => `<div class="sc-l"><i>${i + 1}</i><code>${esc(l) || ' '}</code></div>`).join('');
const HLRX = /(\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(<\/?[a-zA-Z][\w-]*|\/?>)|\b(const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|try|catch|switch|case|break|continue|true|false|null|undefined|this)\b|(\b\d+(?:\.\d+)?\b)/g;
function hl(src) {
  let o = '', i = 0, m; HLRX.lastIndex = 0;
  while ((m = HLRX.exec(src))) { o += esc(src.slice(i, m.index)); o += `<span class="${m[1] ? 'hc' : m[2] ? 'hs' : m[3] ? 'ht' : m[4] ? 'hk' : 'hn'}">${esc(m[0])}</span>`; i = m.index + m[0].length; if (!m[0].length) HLRX.lastIndex++; }
  return o + esc(src.slice(i));
}
const VT = { exp: 'Explorer', search: 'Search', git: 'Review changes', chats: 'Projects' };
function hits() {
  if (!q.trim()) return '<p class="sc-note">Type to search every file in this project.</p>';
  const f = proj().files, ql = q.toLowerCase(), out = [];
  Object.keys(f).sort().forEach(n => f[n].content.split('\n').forEach((l, i) => { if (out.length < 80 && l.toLowerCase().includes(ql)) out.push(`<button class="ide-hit" data-open="${esc(n)}" data-line="${i + 1}"><b>${esc(n)}:${i + 1}</b><span>${esc(l.trim().slice(0, 90))}</span></button>`); }));
  return out.join('') || '<p class="sc-note">No matches.</p>';
}
function renderSide() {
  const p = proj(), f = p.files, names = Object.keys(f).sort(), pend = names.filter(n => f[n].state === 'pending');
  $$('.ab-b[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  $('#gitN').textContent = pend.length || '';
  $('#sdH').innerHTML = `<span>${VT[view]}</span>` + (view === 'exp' ? '<button class="ide-ib" data-m="files" title="Add files">+</button>' : view === 'chats' ? '<button class="ide-ib" data-newp title="New project">+</button>' : view === 'git' && pend.length ? '<button class="ide-ib" data-all title="Accept all">✓</button>' : '');
  let h = '';
  if (view === 'exp') h = (names.length ? `<div class="ide-g">${esc(p.name)}</div>` + names.map(n => `<button class="ide-f ${act === n ? 'on' : ''}" data-open="${esc(n)}"><i class="ide-sd ${f[n].state}"></i><span>${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button>`).join('') : '<p class="sc-note">No files yet. Ask Spectra to build something, or add your own with +.</p>') + assetsHtml();
  else if (view === 'search') h = `<input class="ide-q" id="ideQ" placeholder="Search in files" value="${esc(q)}" autocomplete="off" spellcheck="false"><div id="ideHits">${hits()}</div>`;
  else if (view === 'git') h = pend.length ? pend.map(n => `<div class="ide-r"><button class="ide-f" data-open="${esc(n)}"><i class="ide-sd pending"></i><span>${esc(n)}</span>${statH(stat(fdiff(f[n])))}</button><div class="ide-rb"><button class="sc-btn ok" data-acc="${esc(n)}">Accept</button><button class="sc-btn" data-rej="${esc(n)}">Reject</button></div></div>`).join('') : '<p class="sc-note">Nothing to review. New and changed files from your Spectres land here first.</p>';
  else h = [...P].sort((a, b) => (b.t || 0) - (a.t || 0)).map(x => { const n = Object.keys(x.files).length; return `<div class="ide-p ${x.id === cur ? 'on' : ''}" data-id="${x.id}"><span><b>${esc(x.name)}</b><small>${n ? n + ' file' + (n > 1 ? 's' : '') : 'No files yet'}</small></span>${P.length > 1 ? `<u data-x="${x.id}">×</u>` : ''}</div>`; }).join('');
  $('#sdB').innerHTML = h; hydrate();
}
function renderEdTabs() {
  const p = proj(); openT = openT.filter(n => p.files[n]); if (act !== 'chat' && !p.files[act]) act = 'chat';
  $('#edTabs').innerHTML = `<button class="ide-t ${act === 'chat' ? 'on' : ''}" data-act="chat">Chat</button>` + openT.map(n => `<button class="ide-t ${act === n ? 'on' : ''}" data-act="${esc(n)}"><i class="ide-sd ${p.files[n].state}"></i>${esc(base(n))}<u data-ct="${esc(n)}">×</u></button>`).join('');
  const f = p.files[act];
  $('#edAct').innerHTML = f ? (f.state === 'pending' ? `<button class="sc-btn ok" data-acc="${esc(act)}">Accept</button><button class="sc-btn" data-rej="${esc(act)}">Reject</button>` : '') + `<button class="sc-btn ${alt === 'diff' ? 'on' : ''}" data-alt="diff">Diff</button><button class="sc-btn ${alt === 'hist' ? 'on' : ''}" data-alt="hist">History</button><button class="sc-btn" data-cp="${esc(act)}">Copy</button><button class="sc-btn" data-dl="${esc(act)}">Download</button>` : `<span class="ide-hint">${esc(p.name)}</span>`;
}
function histHtml(f) {
  const vs = f.versions || [], vi = verI == null || verI >= vs.length ? vs.length - 1 : verI;
  if (!vs.length) return '<p class="sc-note">No saved versions yet.</p>';
  return `<div class="sc-vers">${vs.map((v, i) => `<button class="sc-btn ${i === vi ? 'on' : ''}" data-ver="${i}">v${i + 1} · ${new Date(v.t).toLocaleTimeString()}</button>`).join('')}${vi !== vs.length - 1 ? `<button class="sc-btn ok" data-restore="${vi}">Restore this version</button>` : ''}</div><div class="sc-diff big">${codeOf(vs[vi].content)}</div>`;
}
function paint(src) {
  const n = src.split('\n').length, code = /\.(html?|css|js|ts|json|svg|xml)$/i.test(act);
  $('#gut').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  $('#hl').innerHTML = (code ? hl(src) : esc(src)) + '\n';
}
function renderEditor() {
  const f = proj().files[act], chat = act === 'chat' || !f;
  $('#chat').hidden = !chat; $('#edMain').hidden = chat;
  if (chat) return;
  $('#edEmpty').hidden = true;
  if (alt) { $('#edWrap').hidden = true; $('#edAlt').hidden = false; $('#edAlt').innerHTML = alt === 'diff' ? `<div class="sc-diff big">${dview(fdiff(f), 5000)}</div>` : histHtml(f); return; }
  $('#edAlt').hidden = true; $('#edWrap').hidden = false;
  const ta = $('#ta'); if (ta.dataset.f !== act || ta.value !== f.content) { ta.value = f.content; ta.dataset.f = act; }
  paint(f.content);
}
function renderProps() {
  $('#ppB').hidden = ptab !== 'props'; $('#pv').hidden = ptab !== 'prev';
  $$('.pp-h [data-pt]').forEach(b => b.classList.toggle('on', b.dataset.pt === ptab));
  if (ptab !== 'props') return;
  const p = proj(), f = p.files, names = Object.keys(f), pend = names.filter(n => f[n].state === 'pending');
  const tot = names.reduce((a, n) => { const s = stat(fdiff(f[n])); a.a += s.a; a.d += s.d; return a; }, { a: 0, d: 0 });
  const last = [...p.msgs].reverse().find(x => x.sp), sp = last ? last.sp : [], cf = f[act];
  $('#ppB').innerHTML = `<div class="sc-sec"><b>${esc(p.name)}</b><p>${esc(p.summary || 'Nothing built yet.')}</p></div><div class="sc-kv"><div><b>${names.length}</b>files</div><div><b>${pend.length}</b>to review</div><div class="g"><b>+${tot.a}</b>added</div><div class="r"><b>−${tot.d}</b>removed</div></div>`
    + (cf ? `<div class="sc-sec"><b>${esc(act)}</b><p>${cf.content.split('\n').length} lines · ${cf.content.length} characters · ${cf.state}</p></div>` : '')
    + (pend.length ? '<div class="sc-sec"><button class="sc-btn ok" data-all>Accept all files</button></div>' : '')
    + (sp.length ? '<div class="sc-sec"><b>Spectres</b><div class="sc-tree">' + sp.map((s, i) => spCard(s, i === sp.length - 1)).join('') + '</div></div>' : '');
}
async function preview() {
  const p = proj(), f = p.files, e = f['index.html'] ? 'index.html' : Object.keys(f).find(n => /\.html?$/i.test(n));
  if (!e) { $('#pv').srcdoc = '<body style="font:14px sans-serif;color:#888;background:#0a0a0a;padding:24px">Nothing to preview yet. Build a page with an index.html first.</body>'; return; }
  let h = f[e].content;
  h = h.replace(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi, (m, u) => /stylesheet/i.test(m) && f[u] ? '<style>' + f[u].content + '</style>' : m);
  h = h.replace(/<script([^>]*)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi, (m, a, u) => f[u] ? '<script>' + f[u].content.replace(/<\/script/gi, '<\\/script') + '</scr' + 'ipt>' : m);
  pvUrls.forEach(u => URL.revokeObjectURL(u)); pvUrls = [];
  for (const path of Object.keys(p.assets || {})) { // the preview is a srcdoc, so imported assets are swapped in as data: (small) or blob: (big) urls
    if (!h.includes(path)) continue;
    const blob = await aGet(p.id, path).catch(() => null); if (!blob) continue;
    let u; if (blob.size <= 524288) u = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); }); else { u = URL.createObjectURL(blob); pvUrls.push(u); }
    h = h.split('./' + path).join(u).split(path).join(u);
  }
  $('#pv').srcdoc = h;
}
function renderSb() {
  const p = proj(), n = Object.keys(p.files).length, pend = Object.values(p.files).filter(f => f.state === 'pending').length;
  $('#sb').innerHTML = `<span>◆ ${esc(p.name)}</span><span>${n} file${n === 1 ? '' : 's'}</span><span>${pend} to review</span><span class="ide-sp"></span><span>${busy ? 'Spectres working...' : 'Idle'}</span><button class="ide-sbb" data-term>Terminal</button>`;
}
function renderFiles() { renderEdTabs(); renderEditor(); renderSide(); renderProps(); renderSb(); }
function renderAll() { renderTabs(); renderMsgs(); renderFiles(); }
function openFile(n, line) {
  const f = proj().files[n]; if (!f) return;
  if (!openT.includes(n)) openT.push(n);
  act = n; sel = n; alt = f.state === 'pending' && f.old ? 'diff' : null; verI = null; renderFiles();
  if (line && !alt) { const ta = $('#ta'), lh = parseFloat(getComputedStyle(ta).lineHeight) || 19; ta.scrollTop = Math.max(0, (line - 4) * lh); ta.dispatchEvent(new Event('scroll')); }
}
const newProject = () => { const n = mk('Project ' + (P.length + 1)); P.push(n); cur = n.id; act = 'chat'; openT = []; save(); renderAll(); };
const acceptAll = () => { Object.values(proj().files).forEach(f => { f.state = 'accepted'; }); save(); renderFiles(); };
const toggleTerm = () => { const b = $('#bt'); b.hidden = !b.hidden; };
const setView = v => { view = v; renderSide(); if (v === 'search') setTimeout(() => $('#ideQ').focus(), 0); };

/* ---------- build ---------- */
function status(on, txt) {
  const el = $('#scStatus'); el.hidden = !on; clearInterval(tick);
  if (!on) return;
  const t0 = Date.now(); $('#scStatusTxt').textContent = txt;
  tick = setInterval(() => { const tok = Math.round(Object.values(proj().files).reduce((a, f) => a + f.content.length, 0) / 4); $('#scStatusMeta').textContent = '(Press esc to interrupt · ' + Math.round((Date.now() - t0) / 1000) + 's · ↓ ' + tok + ' tokens)'; }, 500);
}
const setSt = (m, id, st) => { const s = m.sp.find(x => x.id === id); if (s) s.st = st; const c = document.querySelector(`[data-sid="${id}"] .sc-st`); if (c) { c.textContent = st; c.dataset.s = st; } if (window.SCSwarm) SCSwarm.set(id, st); };
const say = (t, extra) => { const p = proj(); const m = Object.assign({ r: 'a', t }, extra); p.msgs.push(m); save(); renderMsgs(); return m; };

let mode = 'build';
let swT = 0;
const done = () => { if (window.SCSwarm) SCSwarm.end(); clearTimeout(swT); swT = setTimeout(() => { const sw = $('#scSwarm'); if (sw && !busy) sw.hidden = true; }, 2500); save(); status(false); busy = false; ctl = null; $('#scSend').disabled = false; renderAll(); };
const fail = (e, m) => {
  const msg = e.name === 'AbortError' ? 'Stopped.' : { LOGIN: 'Log in to use Spectra Code.', DAILY: 'You used all your Spectra credits for today. They reset at midnight UTC.', RATE: 'Too many requests. Wait a minute and try again.', UPSTREAM: 'Spectra got no answer from her brain. Check the spectra-code function logs in Supabase (SPECTRA_API_KEY and model names), then try again.' }[e.message] || 'Spectra could not plan that. Try again or make the request simpler.';
  if (m && m.sp) m.sp.forEach(s => { if (s.st === 'Running' || s.st === 'Queued') s.st = 'Cancelled'; });
  say(msg, { err: 1 }); log('error: ' + e.message);
};
const nick = () => ((document.querySelector('[data-user-name]') || {}).textContent || '').trim().slice(0, 20);
const ctxFiles = () => Object.entries(proj().files).slice(0, 14).map(([path, f]) => ({ path, content: f.content.slice(0, 40000) }));
const hist = () => proj().msgs.filter(m => m.t).slice(-10).map(m => ({ r: m.r, t: m.t + (m.files && m.files.length ? ' [files: ' + m.files.join(', ') + ']' : '') }));
function renderMode() {
  const el = $('#scModes'); el.hidden = mode === 'build';
  el.innerHTML = mode === 'build' ? '' : `<span class="sc-chip">${mode === 'plan' ? 'Plan Mode' : 'Ask Spectra'}<u data-m="off">×</u></span><span>${mode === 'plan' ? 'Spectra plans first, you approve before the Spectres build.' : 'Ask about your code. No files get written.'}</span>`;
  $('#scIn').placeholder = mode === 'ask' ? 'Ask Spectra about your code...' : mode === 'plan' ? 'Describe what to build. Spectra will plan it first.' : 'Tell Spectra what to build. Enter to send, Shift+Enter for a new line.';
}
async function exec(m, plan, text, effort, model) {
  const p = proj(), changed = new Set(), cutF = [];
  status(true, 'Deploying ' + m.sp.length + ' Spectres...');
  if (window.SCSwarm) { clearTimeout(swT); const sw = $('#scSwarm'); if (sw) sw.hidden = false; SCSwarm.start(m.sp); }
  await Promise.all(m.sp.map(async s => {
    setSt(m, s.id, 'Running'); log(s.role + ' ' + s.id + ' -> ' + s.files.join(', '));
    try {
      const rr = await req({ mode: 'spectre', prompt: text, effort, model, summary: plan.summary, contract: plan.contract, task: s, files: ctxFiles(), history: hist(), assets: assetList() }, ctl.signal);
      if (!rr.ok) throw new Error('HTTP ' + rr.status);
      const out = await rr.json(); if (out.cut) cutF.push(...out.cut);
      out.files.forEach(f => {
        const pv = p.files[f.path], vs = (pv ? (pv.versions || [{ t: Date.now(), content: pv.content }]) : []).concat([{ t: Date.now(), content: f.content }]).slice(-10);
        p.files[f.path] = { content: f.content, old: pv ? (pv.state === 'pending' ? pv.old : pv.content) : '', state: 'pending', versions: vs }; changed.add(f.path);
      });
      setSt(m, s.id, 'Completed'); log(s.id + ' done: ' + out.files.map(f => f.path).join(', ')); if (out.note) log(s.id + ': ' + out.note); renderFiles();
    } catch (e) { const a = e.name === 'AbortError'; setSt(m, s.id, a ? 'Cancelled' : 'Failed'); log(s.id + (a ? ' cancelled' : ' failed: ' + e.message)); }
  }));
  const bad = m.sp.filter(s => s.st !== 'Completed').length;
  const cutMsg = cutF.length ? cutF.join(', ') + ' hit the length limit and got cut off. Tell me "finish ' + cutF[0] + '" and I will complete it.' : '';
  say(bad ? bad + ' Spectre(s) did not finish, so some files are missing. Send the request again to retry them.' + (cutMsg ? ' ' + cutMsg : '') : cutMsg || 'All done. Open the Files tab and accept the files you want.', bad || cutMsg ? { err: 1, files: [...changed] } : { files: [...changed] });
}
async function build() {
  const input = $('#scIn'), text = input.value.trim();
  if (!text || busy) return;
  const p = proj(), effort = EFF[+($('#scEff').value || 1)], model = $('#scModel').value, md = mode;
  busy = true; $('#scSend').disabled = true; input.value = '';
  p.msgs.push({ r: 'u', t: text }); if (p.msgs.length === 1) p.name = text.slice(0, 22); p.t = Date.now(); save(); renderAll();
  ctl = new AbortController(); status(true, md === 'ask' ? 'Thinking...' : 'Orchestrating...'); log(md + ': effort=' + effort);
  let m;
  try {
    const r = await req({ mode: md === 'ask' ? 'ask' : 'plan', prompt: text, effort, model, files: ctxFiles(), history: hist(), assets: assetList(), nick: nick(), hour: new Date().getHours() }, ctl.signal);
    if (!r.ok) { const tx = await r.text().catch(() => ''); log('plan failed: HTTP ' + r.status + ' ' + tx.slice(0, 60)); throw new Error(r.status === 429 ? (tx.startsWith('daily') ? 'DAILY' : 'RATE') : r.status === 401 ? 'LOGIN' : tx.startsWith('upstream') ? 'UPSTREAM' : 'PLAN'); }
    const left = r.headers.get('X-Spectra-Left'); if (left !== null) $('#scLeft').textContent = left + ' credits left today';
    const plan = await r.json();
    if (!plan.spectres || !plan.spectres.length) { say(plan.reply || 'I am here. Tell me what to build.'); log(md === 'ask' ? 'ask reply' : 'chat reply'); return; }
    p.summary = plan.summary || '';
    const sp = plan.spectres.map(s => ({ ...s, st: 'Queued' }));
    if (md === 'plan') {
      m = say((plan.note ? plan.note + '\n' : '') + (plan.summary || 'Here is the plan.'), { sp, go: true }); p.pending = { text, plan, effort, model };
      log('plan ready: ' + sp.length + ' Spectres, waiting for approval'); return;
    }
    m = say(plan.note || 'Deploying Spectres!', { sp }); log('plan ok: ' + sp.length + ' Spectres');
    await exec(m, plan, text, effort, model);
  } catch (e) { fail(e, m); } finally { done(); }
}
async function go() {
  const p = proj(), pe = p.pending; if (!pe || busy) return;
  const m = p.msgs.find(x => x.go); if (!m) return;
  busy = true; $('#scSend').disabled = true; ctl = new AbortController(); m.go = false; p.pending = null; m.sp.forEach(s => { s.st = 'Queued'; }); renderMsgs(); log('plan approved');
  try { await exec(m, pe.plan, pe.text, pe.effort, pe.model); } catch (e) { fail(e, m); } finally { done(); }
}
$('#scFile').addEventListener('change', async e => {
  const p = proj(), added = [];
  for (const f of [...e.target.files].slice(0, 6)) {
    if (f.size > 60000) { log('skipped ' + f.name + ' (over 60 KB)'); continue; }
    const path = f.name.replace(/\s+/g, '-').replace(/[^\w./-]/g, ''); if (!/^[\w][\w./-]{0,60}$/.test(path)) continue;
    const txt = await f.text(); p.files[path] = { content: txt, old: '', state: 'accepted', versions: [{ t: Date.now(), content: txt }] }; added.push(path);
  }
  e.target.value = '';
  if (added.length) { if (!p.msgs.length) p.name = added[0]; sel = added[0]; say('Added ' + added.join(', ') + '. Your Spectres can read and change them now.'); log('added files: ' + added.join(', ')); renderAll(); } else log('no files added');
});

[['#scMp3', 'mp3'], ['#scSfx', 'sfx'], ['#scImg', 'img']].forEach(([s, k]) => $(s).addEventListener('change', async e => { const l = [...e.target.files]; e.target.value = ''; await importAssets(k, l); }));

/* ---------- command palette ---------- */
const setMode = k => { mode = mode === k ? 'build' : k; renderMode(); };
const CMD = [['Import to SPECSOFT Studio', () => sendToStudio()], ['New project', newProject], ['Toggle terminal', toggleTerm], ['Open Chat', () => { act = 'chat'; renderFiles(); }], ['Accept all changes', acceptAll], ['Plan Mode (toggle)', () => setMode('plan')], ['Ask Spectra (toggle)', () => setMode('ask')], ['Add files', () => $('#scFile').click()], ['Show Explorer', () => setView('exp')], ['Show Search', () => setView('search')], ['Review changes', () => setView('git')], ['Show Projects', () => setView('chats')]];
function palList() {
  const v = $('#palIn').value, k = v.replace(/^>/, '').trim().toLowerCase();
  palItems = (v.startsWith('>') ? CMD.filter(c => c[0].toLowerCase().includes(k)).map(c => ({ t: '> ' + c[0], run: c[1] })) : Object.keys(proj().files).sort().filter(n => n.toLowerCase().includes(k)).map(n => ({ t: n, run: () => openFile(n) }))).slice(0, 20);
  palI = Math.min(palI, Math.max(palItems.length - 1, 0));
  $('#palList').innerHTML = palItems.length ? palItems.map((x, i) => `<button class="ide-pi ${i === palI ? 'on' : ''}" data-pi="${i}">${esc(x.t)}</button>`).join('') : '<p class="sc-note">' + (v.startsWith('>') ? 'No commands match.' : 'No files yet. Type > for commands.') + '</p>';
}
const openPal = pre => { $('#pal').hidden = false; $('#palIn').value = pre || ''; palI = 0; palList(); $('#palIn').focus(); };
const closePal = () => { $('#pal').hidden = true; };
const runPal = i => { const it = palItems[i]; closePal(); if (it) it.run(); };

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target, d = k => { const x = t.closest('[' + k + ']'); return x ? x.getAttribute(k) : null; }, p = proj(), menu = $('#scMenu');
  if (t === $('#pal')) { closePal(); return; }
  if (t.dataset && t.dataset.x) { e.stopPropagation(); const gone = P.find(x => x.id === t.dataset.x); if (gone) aDelAll(gone); P = P.filter(x => x.id !== t.dataset.x); if (cur === t.dataset.x) { cur = P[0].id; act = 'chat'; openT = []; } save(); renderAll(); return; }
  const adl = d('data-adel'); if (adl !== null) { e.stopPropagation(); delete (p.assets || {})[adl]; aDel(p.id, adl).catch(() => { }); if (aopen === adl) aopen = null; save(); renderFiles(); return; }
  const ao = d('data-aopen'); if (ao !== null) { aopen = aopen === ao ? null : ao; renderSide(); return; }
  const ct = d('data-ct'); if (ct !== null) { openT = openT.filter(n => n !== ct); if (act === ct) act = 'chat'; renderFiles(); return; }
  const pi = d('data-pi'); if (pi !== null) { runPal(+pi); return; }
  const pid = d('data-id'); if (pid && t.closest('.ide-p')) { cur = pid; act = 'chat'; openT = []; save(); renderAll(); return; }
  const v = d('data-v'); if (v) { setView(v); return; }
  if (t.closest('[data-pal]')) { openPal(''); return; }
  if (t.closest('[data-newp]')) { newProject(); return; }
  const ac = d('data-act'); if (ac !== null) { act = ac; sel = ac; alt = null; renderFiles(); return; }
  const op = d('data-open'); if (op !== null) { openFile(op, +d('data-line') || 0); return; }
  const al = d('data-alt'); if (al !== null) { alt = alt === al ? null : al; verI = null; renderFiles(); return; }
  const pt = d('data-pt'); if (pt) { ptab = pt; renderProps(); if (pt === 'prev') preview(); return; }
  if (t.closest('[data-refresh]')) { preview(); return; }
  if (t.closest('[data-term]')) { toggleTerm(); return; }
  if (d('data-b') === 'x') { $('#bt').hidden = true; return; }
  const cp = d('data-cp'), dl = d('data-dl'), acc = d('data-acc'), rej = d('data-rej'), mm = d('data-m'), tl = d('data-t'), ve = d('data-ver'), rs = d('data-restore');
  if (cp) navigator.clipboard.writeText(p.files[cp].content).catch(() => { });
  if (dl) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([p.files[dl].content], { type: 'text/plain' })); a.download = dl.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  if (acc) { p.files[acc].state = 'accepted'; save(); renderFiles(); }
  if (rej) { delete p.files[rej]; save(); renderFiles(); }
  if (t.closest('[data-all]')) acceptAll();
  if (ve !== null) { verI = +ve; renderFiles(); }
  if (rs !== null) { const f = p.files[act], x = f && f.versions[+rs]; if (x) { f.old = f.content; f.content = x.content; f.state = 'pending'; f.versions = f.versions.concat([{ t: Date.now(), content: x.content }]).slice(-10); alt = null; save(); renderFiles(); } }
  if (t.closest('#scPlus')) menu.hidden = !menu.hidden; else if (!t.closest('#scMenu')) menu.hidden = true;
  if (mm) {
    if (mm === 'tools') $('#scTools').hidden = !$('#scTools').hidden; else menu.hidden = true;
    if (mm === 'files') $('#scFile').click();
    if (mm === 'mp3') $('#scMp3').click();
    if (mm === 'sfx') $('#scSfx').click();
    if (mm === 'img') $('#scImg').click();
    if (mm === 'studio') sendToStudio();
    if (mm === 'plan' || mm === 'ask') setMode(mm);
    if (mm === 'off') { mode = 'build'; renderMode(); }
    if (mm === 'ver') { if (act === 'chat') { const n = Object.keys(p.files)[0]; if (n) openFile(n); } if (act !== 'chat') { alt = 'hist'; renderFiles(); } else log('add or build a file first, then use History'); }
  }
  if (tl) {
    const all = Object.entries(p.files); menu.hidden = true;
    if (tl === 'copy') navigator.clipboard.writeText(all.map(([n, f]) => '/* ===== ' + n + ' ===== */\n' + f.content).join('\n\n')).catch(() => { });
    if (tl === 'dl') all.forEach(([n, f], i) => setTimeout(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([f.content], { type: 'text/plain' })); a.download = n.split('/').pop(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, i * 300));
    if (tl === 'clear') $('#scTerm').textContent = '';
    if (tl === 'dl') downloadAssets(all.length);
    if (tl === 'zip') zipDl();
  }
  if (t.closest('[data-go]')) go();
  if (t.closest('#scSend')) build();
});
document.addEventListener('input', e => { if (e.target.id === 'ideQ') { q = e.target.value; $('#ideHits').innerHTML = hits(); } });
$('#scIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } });
$('#scEff').addEventListener('input', e => { $('#scEffTxt').textContent = EFFN[+e.target.value]; });
$('#palIn').addEventListener('input', () => { palI = 0; palList(); });
$('#palIn').addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); palI = Math.min(palI + 1, palItems.length - 1); palList(); } else if (e.key === 'ArrowUp') { e.preventDefault(); palI = Math.max(palI - 1, 0); palList(); } else if (e.key === 'Enter') { e.preventDefault(); runPal(palI); } });
document.addEventListener('keydown', e => {
  const k = (e.key || '').toLowerCase(), c = e.ctrlKey || e.metaKey;
  if (c && k === 'k') { e.preventDefault(); openPal(''); } else if (c && k === 'j') { e.preventDefault(); toggleTerm(); } else if (c && k === 'b') { e.preventDefault(); setView('exp'); } else if (c && e.shiftKey && k === 'f') { e.preventDefault(); setView('search'); }
  else if (k === 'escape') { if (!$('#pal').hidden) closePal(); else if (ctl) ctl.abort(); $('#scMenu').hidden = true; }
});
/* editor */
const ta = $('#ta');
ta.addEventListener('input', () => { const f = proj().files[act]; if (!f) return; f.content = ta.value; paint(ta.value); save(); });
ta.addEventListener('scroll', () => { $('#hl').scrollTop = ta.scrollTop; $('#hl').scrollLeft = ta.scrollLeft; $('#gut').scrollTop = ta.scrollTop; });
ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
ta.addEventListener('change', () => { const f = proj().files[act]; if (!f) return; const vs = f.versions || (f.versions = []); if (!vs.length || vs[vs.length - 1].content !== f.content) { vs.push({ t: Date.now(), content: f.content }); f.versions = vs.slice(-10); save(); } });
/* resizers (sets CSS variables --sw / --aw / --bh and the element size) */
document.addEventListener('mousedown', e => {
  const r = e.target.closest && e.target.closest('[data-rz]'); if (!r) return; e.preventDefault();
  const kind = r.dataset.rz, app = $('#app'), pv = $('#pv'); pv.style.pointerEvents = 'none';
  const mv = ev => {
    if (kind === 'sw') { const w = Math.max(160, Math.min(520, ev.clientX - app.getBoundingClientRect().left - ($('.ab').offsetWidth || 0))); app.style.setProperty('--sw', w + 'px'); $('.sd').style.width = w + 'px'; }
    if (kind === 'aw') { const w = Math.max(240, Math.min(720, window.innerWidth - ev.clientX)); app.style.setProperty('--aw', w + 'px'); $('.pp').style.width = w + 'px'; }
    if (kind === 'bh') { const h = Math.max(80, Math.min(window.innerHeight * 0.7, window.innerHeight - ev.clientY - ($('#sb').offsetHeight || 0))); app.style.setProperty('--bh', h + 'px'); $('#bt').style.height = h + 'px'; }
  };
  const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); pv.style.pointerEvents = ''; };
  document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
});
/* swarm panel mount (spectra-swarm.js fills it) */
if (!document.getElementById('scSwarm') && document.getElementById('scStatus')) { const sw = document.createElement('div'); sw.className = 'sc-swarm'; sw.id = 'scSwarm'; sw.hidden = true; document.getElementById('scStatus').parentNode.insertBefore(sw, document.getElementById('scStatus')); }
const need = ['scMsgs', 'scIn', 'scSend', 'scModel', 'scEff', 'scStatus', 'scTerm', 'sdB', 'sdH', 'edTabs', 'edAct', 'edMain', 'ta', 'hl', 'gut', 'ppB', 'pv', 'sb', 'pal', 'chat'], miss = need.filter(i => !document.getElementById(i));
if (miss.length) console.warn('Spectra Code: these elements are not on the page, so those parts are skipped: ' + miss.join(', '));
renderAll(); renderMode(); log('Spectra Code ready');
})();
