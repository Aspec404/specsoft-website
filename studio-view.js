/* SPECSOFT® Studio, PHASE 7: the standalone viewer for published projects (studio-view.html?p=link-name).
   SECURITY: the project is untrusted code written by someone else. It runs in <iframe sandbox="allow-scripts">
   (an opaque origin: no cookies, no storage, no access to this page or your Supabase session, no popups, no navigation of
   this page). The viewer also puts its OWN Content-Security-Policy in front of the page, so even a release that was
   inserted without Studio cannot use the network, remote scripts, fonts, images, frames or form posts. Everything
   from the database is shown with textContent, never as HTML. */
(function () {
    'use strict';
    var CFG = window.SPECSOFT_CONFIG || {};
    var sb = window.getSupabaseClient ? window.getSupabaseClient() : ((window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null);
    var CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; worker-src blob:";
    var KIND = { website: 'Static website', game: 'HTML game', interactive: 'Interactive experience', source: 'Source code' };
    var MAX_DOC = 400000, frame = null;
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function main(node) { var m = $('main'); m.textContent = ''; m.appendChild(node); }
    function msg(title, text) { var c = el('div', 'center'); c.appendChild(el('h2', '', title)); c.appendChild(el('p', '', text)); var a = el('a', 'btn', 'Back to SPECSOFT'); a.href = 'index.html'; c.appendChild(a); main(c); }

    /* the viewer's CSP goes FIRST, then the release; a second CSP inside the release can only make it stricter */
    function safeDoc(bundle) { return '<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + CSP + '">' + String(bundle).slice(0, MAX_DOC); }
    function runFrame(row, into) {
        if (frame) frame.remove(); frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('allow', 'fullscreen; autoplay'); frame.setAttribute('title', String(row.title).slice(0, 60)); frame.referrerPolicy = 'no-referrer';
        frame.srcdoc = safeDoc(row.bundle); into.appendChild(frame); $('fs').hidden = !frame.requestFullscreen;
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
        var files = (Array.isArray(row.files) ? row.files : []).slice(0, 200).map(function (f) { f = f || {}; return { name: String(f.name || 'file').slice(0, 80), lang: String(f.lang || '').slice(0, 20), code: String(f.code || '').slice(0, 300000) }; });
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
        $('fs').addEventListener('click', function () { if (frame && frame.requestFullscreen) frame.requestFullscreen().catch(function () {}); });
        if (row.kind === 'source') showSource(row); else if (row.kind === 'game') showGame(row, cover); else { showPage(row); }
    }
    async function load() {
        var slug = (new URLSearchParams(location.search).get('p') || '').toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return msg('Project not found', 'This link is not valid.');
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
