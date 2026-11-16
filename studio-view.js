/* SPECSOFT® Studio, PHASE 7: the standalone viewer for published projects (studio-view.html?p=link-name).
   SECURITY: the project is untrusted code written by someone else. It runs in <iframe sandbox="allow-scripts">
   (an opaque origin: no cookies, no storage, no access to this page or your Supabase session, no popups, no navigation of
   this page). The viewer also puts its OWN Content-Security-Policy in front of the page, so even a release that was
   inserted without Studio cannot use the network, remote scripts, fonts, images, frames or form posts, UNLESS the visitor
   switches on "Internet" in the header (off by default, remembered per project in THIS browser only, never stored in the release). Everything
   from the database is shown with textContent, never as HTML. */
(function () {
    'use strict';
    var CFG = window.SPECSOFT_CONFIG || {};
    var sb = window.getSupabaseClient ? window.getSupabaseClient() : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
    var CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src blob:";
    var NET_CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://code.jquery.com; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob: https:; font-src data: https://fonts.gstatic.com; media-src data: blob: https:; connect-src https:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src blob:";
    var curRow = null, slugKey = '', tok = '', seen = {}, pseudo = false;
    /* Internet toggle: a per-visitor choice kept in THIS browser (the project can never switch it on for anyone). The inline bar replaces
       window.confirm(), which is silently blocked when the hub embeds this page in a sandbox without allow-modals. */
    function netOn() { try { return localStorage.getItem('studio-net:' + slugKey) === '1'; } catch (e) { return false; } }
    function syncNet() { var b = $('net'); b.textContent = 'Internet: ' + (netOn() ? 'on' : 'off'); b.setAttribute('aria-pressed', netOn() ? 'true' : 'false'); }
    function setNet(on) {
        try { localStorage.setItem('studio-net:' + slugKey, on ? '1' : '0'); } catch (e) {}
        syncNet(); $('netAsk').hidden = true;
        if (frame && curRow) runFrame(curRow, frame.parentNode);          // restart the project under the new policy
    }
    var KIND = { website: 'Static website', game: 'HTML game', interactive: 'Interactive experience', source: 'Source code' };
    var MAX_DOC = 5 * 1024 * 1024, frame = null;
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function main(node) { var m = $('main'); m.textContent = ''; m.appendChild(node); }
    function msg(title, text) { var c = el('div', 'center'); c.appendChild(el('h2', '', title)); c.appendChild(el('p', '', text)); var a = el('a', 'btn', 'Back to SPECSOFT'); a.href = 'index.html'; c.appendChild(a); main(c); }

    /* the viewer's CSP goes FIRST, then the release; a second CSP inside the release can only make it stricter */
    /* Studio bakes its OWN strict CSP <meta> into every bundle it publishes (studio-preview.js assemble() with net off). Browsers enforce ALL
       policies at once, so that old meta would cancel the viewer's Internet switch. The viewer's policy is already placed first and cannot be
       removed by the release, so stripping the baked-in meta loses no safety and also fixes releases that were published before this switch existed. */
    var BAKED = /<meta\b[^>]*http-equiv\s*=\s*["']?\s*content-security-policy[^>]*>/gi;
    function reporter() {
        return '<script>(function(){var n=0,t=' + JSON.stringify(tok) + ';function s(o){if(n++>30)return;o.t=t;try{parent.postMessage(o,"*")}catch(e){}}'
            + 'document.addEventListener("securitypolicyviolation",function(e){s({k:"csp",d:e.violatedDirective,u:String(e.blockedURI)})});'
            + 'window.addEventListener("error",function(e){s({k:"err",m:String(e.message)})});'
            + 'window.addEventListener("unhandledrejection",function(e){s({k:"err",m:String(e.reason)})});})()' + '<' + '/script>';
    }
    function safeDoc(bundle) { return '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + (netOn() ? NET_CSP : CSP) + '">' + reporter() + String(bundle).slice(0, MAX_DOC).replace(BAKED, ''); }
    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!frame || e.source !== frame.contentWindow || !d || d.t !== tok || typeof d.k !== 'string') return;
        var line = d.k === 'csp' ? 'Blocked by policy (' + String(d.d).slice(0, 40) + '): ' + String(d.u).slice(0, 140) + (netOn() ? '' : '   [Internet is off]') : 'Error: ' + String(d.m).slice(0, 160);
        if (seen[line] || Object.keys(seen).length >= 8) return; seen[line] = 1;
        var b = $('diag'); b.hidden = false; b.textContent += (b.textContent ? '\n' : '') + line;
    });
    /* Fullscreen: real fullscreen first; if the browser refuses (or has none, like iPhone Safari) fall back to filling the viewer */
    function setPseudo(on) { pseudo = on; if (frame) frame.style.cssText = on ? 'position:fixed;inset:0;width:100%;height:100%;z-index:9999' : ''; $('fsx').hidden = !on; }
    function toggleFs() {
        if (!frame) return;
        if (pseudo) return setPseudo(false);
        if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        var rq = frame.requestFullscreen || frame.webkitRequestFullscreen, p;
        if (!rq) return setPseudo(true);
        try { p = rq.call(frame); } catch (e) { return setPseudo(true); }
        if (p && p.catch) p.catch(function () { setPseudo(true); });
    }
    function runFrame(row, into) {
        if (frame) frame.remove(); frame = document.createElement('iframe'); tok = Math.random().toString(36).slice(2) + Date.now().toString(36); seen = {}; $('diag').textContent = ''; $('diag').hidden = true; pseudo = false; $('fsx').hidden = true;
        frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('allow', 'fullscreen; autoplay'); frame.setAttribute('title', String(row.title).slice(0, 60)); frame.referrerPolicy = 'no-referrer';
        frame.srcdoc = safeDoc(row.bundle); into.appendChild(frame); $('fs').hidden = false;
    }
    function showPage(row) { var wrap = el('div'); wrap.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column'; main(wrap); runFrame(row, wrap); }
    function showGame(row, cover) {
        var c = el('div', 'center');
        if (cover) { var im = el('img', 'cover'); im.alt = ''; im.src = cover; c.appendChild(im); }
        c.appendChild(el('h2', '', row.title)); if (row.description) c.appendChild(el('p', '', row.description));
        var play = el('button', '', 'Play'); play.type = 'button';
        play.addEventListener('click', function () {
            showPage(row); $('fs').hidden = false;
        }); c.appendChild(play); main(c); play.focus();
    }
    function showSource(row) {
        var files = (Array.isArray(row.files) ? row.files : []).slice(0, 200).map(function (f) { f = f || {}; return { name: String(f.name || 'file').slice(0, 80), lang: String(f.lang || '').slice(0, 20), code: String(f.code || '').slice(0, 5 * 1024 * 1024) }; });
        var wrap = el('div', 'src'), ul = el('ul'), pre = el('pre'), cur = null;
        if (!files.length) { msg('No files', 'This release has no code files.'); return; }
        function open(i, b) { pre.textContent = files[i].code; if (cur) cur.removeAttribute('aria-current'); b.setAttribute('aria-current', 'true'); cur = b; pre.scrollTop = 0; }
        files.forEach(function (f, i) { var li = el('li'), b = el('button', 'mono', f.name); b.type = 'button'; b.addEventListener('click', function () { open(i, b); }); li.appendChild(b); ul.appendChild(li); if (i === 0) setTimeout(function () { open(0, b); }, 0); });
        wrap.appendChild(ul); wrap.appendChild(pre); main(wrap);
    }
    function render(row) {
        var cover = typeof row.cover === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(row.cover) ? row.cover : '';
        document.title = String(row.title).slice(0, 60) + ' | SPECSOFT® Studio';
        $('ttl').textContent = row.title; $('meta').textContent = (KIND[row.kind] || row.kind) + '  |  v' + row.version + '  |  ' + new Date(row.released_at).toLocaleDateString();
        $('hd').hidden = false;
        curRow = row; $('net').hidden = false; syncNet();
        $('net').addEventListener('click', function () { if (netOn()) setNet(false); else $('netAsk').hidden = !$('netAsk').hidden; });
        $('netYes').addEventListener('click', function () { setNet(true); });
        $('netNo').addEventListener('click', function () { $('netAsk').hidden = true; });
        $('fs').addEventListener('click', toggleFs); $('fsx').addEventListener('click', toggleFs);
        if (row.kind === 'source') showSource(row); else if (row.kind === 'game') showGame(row, cover); else { showPage(row); }
    }
    async function load() {
        var slug = (new URLSearchParams(location.search).get('p') || '').toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return msg('Project not found', 'This link is not valid.');
        slugKey = slug;
        if (!sb) return msg('Not available', 'The viewer is not configured.');
        var r = await sb.rpc('studio_open', { p_slug: slug });
        if (r.error) return msg('Not available', /studio_open/.test(r.error.message || '') ? 'Publishing is not set up on this site yet.' : 'Could not load this project right now.');
        var row = r.data && r.data[0];
        if (!row) {                                       // private projects: the owner (signed in) can still open their own
            var s = (await sb.auth.getSession()).data.session;
            if (s) {
                var p = await sb.from('studio_published').select('title,description,category,cover,release_id').eq('slug', slug).maybeSingle();
                if (p.data && p.data.release_id) {
                    var rel = await sb.from('studio_releases').select('kind,version,notes,bundle,files,created_at').eq('id', p.data.release_id).maybeSingle();
                    if (rel.data) row = { title: p.data.title, description: p.data.description, category: p.data.category, cover: p.data.cover, kind: rel.data.kind, version: rel.data.version, notes: rel.data.notes, bundle: rel.data.bundle, files: rel.data.files, released_at: rel.data.created_at };
                }
            }
        }
        if (!row) return msg('Project not available', 'It may be private, unpublished, or the link is wrong.');
        render(row);
    }
    load();
})();
