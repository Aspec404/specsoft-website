/* SPECSOFT® Studio, PHASE 7: Version Control (snapshots) and Publish (releases). Two pages inside Studio.
   Needs supabase-studio-phase7.sql installed, and studio.js (it exposes StudioProject: the SAME Supabase client, user and
   open project Studio already uses, so there is no second login or project system).
   Publishing is separate from Preview: a release is built from the LAST SAVED version of the project, with the same
   assembler Preview uses, and is stored as an immutable row. Visitors never read your project: they read the live
   release through studio_open(slug), and the viewer (studio-view.html) runs it in a locked-down sandbox. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var G = window.StudioGraph, PV = window.StudioPreview;
    if (!G) return;
    /* studio.js creates window.StudioProject AFTER this file loads, so it is looked up when a page is used, not at load time */
    var P = {
        client: function () { var s = window.StudioProject; return s ? s.client() : null; },
        user: function () { var s = window.StudioProject; return s ? s.user() : null; },
        current: function () { var s = window.StudioProject; return s ? s.current() : null; },
        saved: function () { var s = window.StudioProject; return s ? s.saved() : null; },
        isDirty: function () { var s = window.StudioProject; return s ? s.isDirty() : false; }
    };
    var X = window.StudioPublish = {}, seq = 0;
    var MAX_PAGE = 300000, MAX_FILES = 280000, SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/, VER = /^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$/;
    var KINDS = [['website', 'Static website'], ['game', 'HTML game'], ['interactive', 'Interactive experience'], ['source', 'Source code']];
    var CATS = [['website', 'Website'], ['game', 'Game'], ['art', 'Art'], ['tool', 'Tool'], ['education', 'Education'], ['other', 'Other']];
    var HUBCATS = [['ai', 'AI'], ['games', 'Games'], ['software', 'Software'], ['roblox', 'Roblox'], ['other', 'Other']];   // the Projects hub's own categories (projects.js)
    function hubCatFor(c) { return c === 'game' ? 'games' : (c === 'website' || c === 'tool' || c === 'education') ? 'software' : 'other'; }
    var SHARES = [['none', 'No copy: visitors can only open it'], ['free', 'Free copy: any signed-in member can copy it'], ['password', 'Password to copy: members need your password']];
    function shareName(m) { return (SHARES.filter(function (x) { return x[0] === m; })[0] || SHARES[0])[1]; }
    function shareErr(c) { return { not_signed_in: 'sign in first', bad_mode: 'unknown mode', not_found: 'publish a release first', password_required: 'type a password (4 to 60 characters)', bad_password: 'the password must be 4 to 60 characters' }[c] || String(c || 'unknown error'); }
    var VIS = [['public', 'Public: anyone with the link, listed'], ['unlisted', 'Unlisted: anyone with the link'], ['private', 'Private: only you']];
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function say(sev, src, m) { G.log(sev, src, m); }

    var st = document.createElement('style'); st.id = 'stPublishCss';
    st.textContent = [
        '.px-card{border:1px solid var(--border-subtle,#333);padding:14px 16px;margin:14px 0;max-width:760px}.px-card h2{margin:0 0 10px}',
        '.px-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}',
        '.px-f{display:grid;gap:4px;font:400 .72rem var(--font-mono,monospace);color:var(--text-secondary)}',
        '.px-f input,.px-f select,.px-f textarea{box-sizing:border-box;width:100%;background:var(--bg-base,#000);color:var(--text-primary);border:1px solid var(--border-subtle,#333);padding:7px 9px;font:400 .82rem var(--font-mono,monospace)}',
        '.px-f textarea{min-height:64px;resize:vertical}.px-f small{opacity:.75}',
        '.px-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center}',
        '.px-msg{margin:10px 0;min-height:1.2em;font:400 .78rem var(--font-mono,monospace);color:var(--text-secondary)}.px-msg.err{color:#e5484d}.px-msg.ok{color:#2fa66a}',
        '.px-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border-subtle,#2a2a2a)}.px-grow{flex:1;min-width:0}',
        '.px-row small{display:block;color:var(--text-secondary);margin-top:2px;font:400 .72rem var(--font-mono,monospace);overflow-wrap:anywhere}',
        '.px-ver{font:600 .85rem var(--font-mono,monospace)}.px-live{display:inline-block;margin-left:8px;padding:0 7px;border:1px solid #2fa66a;color:#2fa66a;font:500 .62rem var(--font-mono,monospace);letter-spacing:.06em}',
        '.px-url{font:400 .78rem var(--font-mono,monospace);overflow-wrap:anywhere;color:var(--text-primary)}',
        '.px-cover{width:176px;height:99px;object-fit:cover;border:1px solid var(--border-subtle,#333);display:block;background:var(--bg-base,#000)}',
        '.px-diff{margin:8px 0 0;padding:8px 10px;border-left:2px solid var(--border-hover,#666);font:400 .74rem var(--font-mono,monospace);color:var(--text-secondary)}.px-diff ul{margin:6px 0 0;padding-left:18px}',
        '.px-chk{display:flex;gap:8px;align-items:center;font:400 .76rem var(--font-mono,monospace);color:var(--text-secondary);margin-top:8px}'
    ].join('\n');
    document.head.appendChild(st);

    /* ---- helpers ---- */
    function need() {
        if (!P.client()) return 'Supabase is not configured.';
        if (!P.user()) return 'Sign in to use this page.';
        if (!P.current()) return 'Open a project first (Explorer, on the left).';
        return '';
    }
    function nice(err) {
        var m = (err && err.message) || 'Unknown error', c = err && err.code;
        if (/(studio_set_sharing|studio_share_info|studio_copy|sharing|pass_hash|'graph' column of 'studio_releases')/.test(m) && /(does not exist|schema cache|Could not find)/i.test(m)) return 'The Sharing options are not installed yet. Run supabase-studio-phase7c-sharing.sql in the Supabase SQL Editor.';
        if (/studio_(versions|releases|published|open)/.test(m) && /(does not exist|schema cache|Could not find)/i.test(m)) return 'The Phase 7 tables are not installed yet. Run supabase-studio-phase7.sql in the Supabase SQL Editor.';
        if (c === '23505' && /slug/.test(m + (err.details || ''))) return 'That link name is already taken. Pick another one.';
        if (c === '23505') return 'That version number already exists for this project. Pick a new number.';
        if (/hub_project_id/.test(m)) return 'The Projects hub link is not installed yet. Run supabase-studio-phase7b-hub.sql in the Supabase SQL Editor.';
        if (c === '42501' || /row-level security/i.test(m)) return 'Not allowed. You may have reached a limit (15 snapshots or 50 releases per project) or the project is not yours.';
        return m;
    }
    function msgBox() { var m = el('p', 'px-msg'); m.setAttribute('role', 'status'); m.show = function (t, kind) { m.textContent = t || ''; m.className = 'px-msg' + (kind ? ' ' + kind : ''); }; return m; }
    function field(parent, text, input, hint) { var l = el('label', 'px-f'); l.appendChild(el('span', '', text)); l.appendChild(input); if (hint) l.appendChild(el('small', '', hint)); parent.appendChild(l); return input; }
    function input(type, max, val, ph) { var i = el('input'); i.type = type; if (max) i.maxLength = max; i.value = val || ''; if (ph) i.placeholder = ph; return i; }
    function select(opts, val) { var s = el('select'); opts.forEach(function (o) { var x = el('option', '', o[1]); x.value = o[0]; if (o[0] === val) x.selected = true; s.appendChild(x); }); return s; }
    function btn(text, fn, cls, title) { var b = el('button', 'st-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); return b; }
    function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } }
    function viewUrl(slug) { return new URL('studio-view.html?p=' + encodeURIComponent(slug), location.href).href; }
    function head(w, title, badge, lead) { w.appendChild(el('h1', '', title)); w.appendChild(el('span', 'pg-badge', badge)); w.appendChild(el('p', 'pg-lead', lead)); }

    /* =================== VERSION CONTROL =================== */
    function flat(g) { var m = {}; (function walk(c, path) { ((c && c.nodes) || []).forEach(function (n) { m[n.id] = { name: path + n.label, n: n }; if (n.config && n.config.sub) walk(n.config.sub, path + n.label + ' / '); }); })(g, ''); return m; }
    function conns(g) { var s = {}; (function walk(c) { ((c && c.connections) || []).forEach(function (x) { s[x.from + '>' + x.to] = 1; }); ((c && c.nodes) || []).forEach(function (n) { if (n.config && n.config.sub) walk(n.config.sub); }); })(g); return s; }
    function lines(t) { return String(t || '').split('\n').length; }
    X.diff = function (from, to) {                       // what changed going from "from" (a snapshot) to "to" (the draft)
        var a = flat(from), b = flat(to), out = { added: [], removed: [], changed: [], wires: 0, db: false, tl: false };
        Object.keys(b).forEach(function (id) { if (!a[id]) out.added.push(b[id].name); });
        Object.keys(a).forEach(function (id) {
            if (!b[id]) { out.removed.push(a[id].name); return; }
            var x = a[id].n, y = b[id].n, cx = x.config || {}, cy = y.config || {}, what = [];
            if (x.label !== y.label) what.push('renamed from ' + x.label);
            if (!!x.enabled !== !!y.enabled) what.push(y.enabled ? 'enabled' : 'disabled');
            if (x.type !== y.type) what.push('type ' + x.type + ' to ' + y.type);
            var cA = cx.code || cx.sql || '', cB = cy.code || cy.sql || ''; if (cA !== cB) what.push('code changed (' + (lines(cB) - lines(cA) >= 0 ? '+' : '') + (lines(cB) - lines(cA)) + ' lines)');
            if (cx.aDelay !== cy.aDelay || cx.eDelay !== cy.eDelay || cx.oDelay !== cy.oDelay || cx.timeout !== cy.timeout || cx.mode !== cy.mode || cx.waitEvent !== cy.waitEvent) what.push('settings changed');
            if (x.x !== y.x || x.y !== y.y) what.push('moved');
            if (what.length) out.changed.push(b[id].name + ': ' + what.join(', '));
        });
        var ca = conns(from), cb = conns(to); Object.keys(ca).forEach(function (k) { if (!cb[k]) out.wires++; }); Object.keys(cb).forEach(function (k) { if (!ca[k]) out.wires++; });
        out.db = JSON.stringify(from.db || null) !== JSON.stringify(to.db || null); out.tl = JSON.stringify(from.timeline || null) !== JSON.stringify(to.timeline || null);
        return out;
    };
    function showDiff(box, d, name) {
        box.textContent = ''; box.className = 'px-diff';
        var n = d.added.length + d.removed.length + d.changed.length + d.wires + (d.db ? 1 : 0) + (d.tl ? 1 : 0);
        if (!n) { box.textContent = 'Your draft is identical to ' + name + '.'; return; }
        box.appendChild(el('strong', '', 'Your draft compared with ' + name + ':')); var ul = el('ul'); box.appendChild(ul);
        d.added.slice(0, 20).forEach(function (t) { ul.appendChild(el('li', '', 'added ' + t)); });
        d.removed.slice(0, 20).forEach(function (t) { ul.appendChild(el('li', '', 'removed ' + t)); });
        d.changed.slice(0, 40).forEach(function (t) { ul.appendChild(el('li', '', t)); });
        if (d.wires) ul.appendChild(el('li', '', d.wires + ' connection(s) added or removed'));
        if (d.db) ul.appendChild(el('li', '', 'database data differs')); if (d.tl) ul.appendChild(el('li', '', 'timeline differs'));
        if (d.added.length > 20 || d.removed.length > 20 || d.changed.length > 40) ul.appendChild(el('li', '', '... and more'));
    }

    function versions(w, my) {
        head(w, 'Version Control', 'Snapshots', 'Save a named copy of your project, compare it with your draft, and go back to it. A snapshot keeps the graph, code, database and timeline. Snapshots are private to you.');
        var gate = need(); if (gate) { w.appendChild(el('p', 'px-msg', gate)); return; }
        var sb = P.client(), proj = P.current(), msg = msgBox(), list = el('div'), keep;
        var card = el('div', 'px-card'), grid = el('div', 'px-grid'), lab = input('text', 80, '', 'e.g. Before the big refactor'), note = input('text', 500, '', 'optional');
        card.appendChild(el('h2', '', 'New snapshot')); field(grid, 'Name', lab); field(grid, 'Note', note); card.appendChild(grid);
        var act = el('div', 'px-actions'), mk = btn('Create snapshot', async function () {
            mk.disabled = true; var r = await snapshot(lab.value, note.value); mk.disabled = false;
            if (!r.ok) return msg.show(r.error, 'err'); lab.value = ''; note.value = ''; msg.show('Snapshot v' + r.number + ' created.', 'ok'); load();
        }, '', 'Saves your current DRAFT (including unsaved changes)'); act.appendChild(mk); card.appendChild(act); w.appendChild(card);
        keep = el('label', 'px-chk'); var kc = el('input'); kc.type = 'checkbox'; kc.checked = true; keep.appendChild(kc); keep.appendChild(el('span', '', 'When I restore, snapshot my current draft first (so nothing is lost)')); w.appendChild(keep);
        w.appendChild(msg); w.appendChild(el('h2', '', 'Snapshots')); w.appendChild(list);

        async function snapshot(label, nt) {
            var g = G.get(); if (JSON.stringify(g).length > 450000) return { ok: false, error: 'This project is too large to snapshot (450 KB max).' };
            var r = await sb.from('studio_versions').insert({ project_id: proj.id, owner_id: P.user().id, label: String(label || '').trim().slice(0, 80), note: String(nt || '').trim().slice(0, 500), graph: g }).select('number').single();
            if (r.error) return { ok: false, error: nice(r.error) }; return { ok: true, number: r.data.number };
        }
        async function load() {
            var r = await sb.from('studio_versions').select('id,number,label,note,created_at').eq('project_id', proj.id).order('number', { ascending: false });
            if (my !== seq) return; list.textContent = '';
            if (r.error) { msg.show(nice(r.error), 'err'); return; }
            if (!r.data.length) { list.appendChild(el('p', 'px-msg', 'No snapshots yet. Create the first one above.')); return; }
            r.data.forEach(function (v) {
                var row = el('div', 'px-row'), body = el('div', 'px-grow'), t = el('div'), diff = el('div');
                t.appendChild(el('span', 'px-ver', 'v' + v.number)); t.appendChild(document.createTextNode('  ' + (v.label || 'Untitled snapshot')));
                body.appendChild(t); body.appendChild(el('small', '', when(v.created_at) + (v.note ? '  |  ' + v.note : ''))); body.appendChild(diff);
                var cmp = btn('Compare', async function () {
                    var g = await sb.from('studio_versions').select('graph').eq('id', v.id).single(); if (g.error) return msg.show(nice(g.error), 'err');
                    showDiff(diff, X.diff(g.data.graph || {}, G.get()), 'v' + v.number);
                }, '', 'Show what is different between this snapshot and your draft');
                var res = btn('Restore', async function () {
                    if (!window.confirm('Restore v' + v.number + '? Your current draft is replaced. It is not saved to the project until you press Save.')) return;
                    if (kc.checked) { var s = await snapshot('Auto: before restoring v' + v.number, ''); if (!s.ok) return msg.show('Restore cancelled: ' + s.error, 'err'); }
                    var g = await sb.from('studio_versions').select('graph').eq('id', v.id).single(); if (g.error) return msg.show(nice(g.error), 'err');
                    G.load(g.data.graph || {}); G.onChange(); P.markDirty(); say('ok', 'versions', 'Restored v' + v.number + ' as a draft. Press Save to keep it.');
                    msg.show('Restored v' + v.number + ' as your draft. Press Save to keep it.', 'ok'); load();
                }, '', 'Replace your draft with this snapshot');
                var del = btn('Delete', async function () {
                    if (!window.confirm('Delete snapshot v' + v.number + '? This cannot be undone.')) return;
                    var d = await sb.from('studio_versions').delete().eq('id', v.id); if (d.error) return msg.show(nice(d.error), 'err'); load();
                }, 'st-danger');
                var acts = el('div', 'px-actions'); acts.style.marginTop = '0'; acts.appendChild(cmp); acts.appendChild(res); acts.appendChild(del);
                row.appendChild(body); row.appendChild(acts); list.appendChild(row);
            });
        }
        load();
    }

    /* =================== PUBLISH =================== */
    function ext(n) { var c = n.config || {}; return n.type === 'database' ? '.sql' : c.lang === 'html' ? '.html' : c.lang === 'css' ? '.css' : c.lang === 'pagejs' ? '.page.js' : c.lang === 'json' ? '.json' : '.js'; }
    X.collectFiles = function (g) {                      // for "Source code" releases: every code file, as plain text
        var out = [], total = 0;
        (function walk(c, path) { ((c && c.nodes) || []).forEach(function (n) {
            var cf = n.config || {};
            if (n.type === 'script' || n.type === 'database') { var code = String(n.type === 'database' ? cf.sql : cf.code || ''); total += code.length; out.push({ name: (path + n.label + ext(n)).slice(0, 80), lang: n.type === 'database' ? 'sql' : cf.lang, code: code }); }
            if (cf.sub) walk(cf.sub, path + n.label + '/');
        }); })(g, '');
        return { files: out, size: total };
    };
    function nextVersion(v) { if (!v || !VER.test(v)) return '1.0.0'; var p = v.split('.').map(Number); while (p.length < 3) p.push(0); p[2] = Math.min(999, p[2] + 1); return p.join('.'); }
    function slugFrom(t) { var s = String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, ''); return s.length >= 3 ? s : 'project-' + Math.random().toString(36).slice(2, 7); }
    function coverFrom(file, done) {                     // re-draws the picture on a canvas: the stored image is always a clean 640x360 JPEG
        if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 4000000) return done(null, 'Use a PNG, JPEG or WebP picture under 4 MB.');
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () {
            var c = document.createElement('canvas'); c.width = 640; c.height = 360; var x = c.getContext('2d'), r = Math.max(640 / img.width, 360 / img.height), w = img.width * r, h = img.height * r;
            x.fillStyle = '#000'; x.fillRect(0, 0, 640, 360); x.drawImage(img, (640 - w) / 2, (360 - h) / 2, w, h); URL.revokeObjectURL(url);
            var q = 0.82, d = c.toDataURL('image/jpeg', q); while (d.length > 140000 && q > 0.3) { q -= 0.12; d = c.toDataURL('image/jpeg', q); }
            if (d.length > 140000) return done(null, 'That picture is too detailed. Try a simpler one.'); done(d);
        };
        img.onerror = function () { URL.revokeObjectURL(url); done(null, 'That file could not be read as a picture.'); }; img.src = url;
    }

    function publishPg(w, my) {
        head(w, 'Publish', 'Releases', 'Turn your project into a page people can open. A release is built from the LAST SAVED version of your project and never changes. Publishing is separate from Preview. You can roll back to any earlier release.');
        var gate = need(); if (gate) { w.appendChild(el('p', 'px-msg', gate)); return; }
        var sb = P.client(), proj = P.current(), msg = msgBox(), status = el('div'), hist = el('div'), pub = null, rels = [], cover = null;
        var form = el('div', 'px-card'), g1 = el('div', 'px-grid'), g2 = el('div', 'px-grid');
        form.appendChild(el('h2', '', 'Listing'));
        var kind = field(g1, 'Type', select(KINDS, 'website'), 'Sets how visitors see it: a page, a game launcher, or browsable code.');
        var cat = field(g1, 'Category', select(CATS, 'website'));
        var title = field(g1, 'Title', input('text', 60, proj.title));
        var slug = field(g1, 'Link name', input('text', 40, slugFrom(proj.title)), 'Letters, numbers and dashes, 3 to 40.');
        var vis = field(g1, 'Visibility', select(VIS, 'private'));
        var share = field(g1, 'Copying', select(SHARES, 'none'), 'Who may copy this project into their own Studio. A change applies to releases published after it.');
        var sharePw = field(g1, 'Copy password', input('password', 60, '', '4 to 60 characters'), 'Leave empty to keep the current password.'); sharePw.autocomplete = 'new-password';
        function syncShareUi() { sharePw.parentNode.style.display = share.value === 'password' ? '' : 'none'; }
        share.addEventListener('change', syncShareUi); syncShareUi();
        form.appendChild(g1);
        var hubL = el('label', 'px-chk'), hubOn = el('input'), hubCat = select(HUBCATS, hubCatFor('website')); hubOn.type = 'checkbox'; hubOn.checked = true;
        hubL.appendChild(hubOn); hubL.appendChild(el('span', '', 'Also show it on the Projects hub (only when Visibility is Public)')); form.appendChild(hubL);
        var hg = el('div', 'px-grid'); hg.style.marginTop = '8px'; field(hg, 'Projects hub category', hubCat); form.appendChild(hg);
        cat.addEventListener('change', function () { hubCat.value = hubCatFor(cat.value); });
        var desc = el('textarea'); desc.maxLength = 300; var dl = el('label', 'px-f'); dl.style.marginTop = '10px'; dl.appendChild(el('span', '', 'Description (300 characters)')); dl.appendChild(desc); form.appendChild(dl);
        var cw = el('div', 'px-actions'), cimg = el('img', 'px-cover'), cfile = el('input'); cimg.alt = 'Cover preview'; cimg.hidden = true; cfile.type = 'file'; cfile.accept = 'image/png,image/jpeg,image/webp'; cfile.setAttribute('aria-label', 'Cover image');
        var crm = btn('Remove cover', function () { cover = null; cimg.hidden = true; cfile.value = ''; crm.hidden = true; }); crm.hidden = true;
        cfile.addEventListener('change', function () { coverFrom(cfile.files[0], function (d, e) { if (e) { msg.show(e, 'err'); cfile.value = ''; return; } cover = d; cimg.src = d; cimg.hidden = false; crm.hidden = false; msg.show('', ''); }); });
        cw.appendChild(el('span', 'px-f', 'Cover image')); cw.appendChild(cfile); cw.appendChild(crm); form.appendChild(cw); form.appendChild(cimg);
        var rc = el('div', 'px-card'); rc.appendChild(el('h2', '', 'New release'));
        var ver = field(g2, 'Version number', input('text', 11, '1.0.0'), 'Like 1.0.0. Each release needs a new number.'), notes = field(g2, 'Release notes', input('text', 500, '', 'what is new'));
        rc.appendChild(g2); var dirty = el('p', 'px-msg'); rc.appendChild(dirty);
        var pubBtn = btn('Publish release', publish, '', 'Builds a release from the last saved version and makes it live'), saveL = btn('Save listing only', saveListing, '', 'Changes the title, description, cover and visibility without a new release');
        var ra = el('div', 'px-actions'); ra.appendChild(pubBtn); ra.appendChild(saveL); rc.appendChild(ra);
        w.appendChild(status); w.appendChild(form); w.appendChild(rc); w.appendChild(msg); w.appendChild(el('h2', '', 'Release history')); w.appendChild(hist);

        function fillFromPub() {
            if (!pub) return; share.value = pub.sharing || 'none'; syncShareUi(); kind.value = (rels.filter(function (r) { return r.id === pub.release_id; })[0] || rels[0] || { kind: 'website' }).kind; cat.value = pub.category; title.value = pub.title; slug.value = pub.slug; vis.value = pub.visibility; desc.value = pub.description || '';
            if (pub.cover && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(pub.cover)) { cover = pub.cover; cimg.src = cover; cimg.hidden = false; crm.hidden = false; }
        }
        function listing() {                             // reads and validates the form; returns null (and says why) when something is wrong
            var t = title.value.trim(), s = slug.value.trim().toLowerCase(), d = desc.value.trim();
            if (!t) { msg.show('Give the project a title.', 'err'); return null; }
            if (!SLUG.test(s)) { msg.show('The link name needs 3 to 40 letters, numbers or dashes, and cannot start with a dash.', 'err'); return null; }
            return { project_id: proj.id, owner_id: P.user().id, slug: s, title: t.slice(0, 60), description: d.slice(0, 300), category: cat.value, cover: cover, visibility: vis.value };
        }
        function hubStatus(c) {                          // the Projects hub line in the Status card
            if (!pub) return;
            if (!pub.hub_project_id) { c.appendChild(el('p', 'px-msg', 'Projects hub: not listed. Set Visibility to Public, then post it.')); var pa = el('div', 'px-actions'); pa.style.marginTop = '0'; pa.appendChild(btn('Post to Projects hub', postToHub, '', 'Creates the card on the Projects hub from the listing above')); c.appendChild(pa); return; }
            c.appendChild(el('p', 'px-msg ok', 'Projects hub: listed. Its likes, comments and reposts live on that card.'));
            var a = el('div', 'px-actions'); a.style.marginTop = '0';
            a.appendChild(btn('See the Projects hub', function () { window.open(new URL('projects.html', location.href).href, '_blank', 'noopener'); }));
            a.appendChild(btn('Remove from hub', removeFromHub, 'st-danger', 'Deletes the card, including its likes, comments and reposts')); c.appendChild(a);
        }
        function paintStatus() {
            status.textContent = ''; var c = el('div', 'px-card'); c.appendChild(el('h2', '', 'Status'));
            var live = pub && pub.release_id ? rels.filter(function (r) { return r.id === pub.release_id; })[0] : null;
            if (!live) { c.appendChild(el('p', 'px-msg', pub ? 'Unpublished. Visitors see "not available". Pick a release below and press Make live, or publish a new one.' : 'Not published yet.')); hubStatus(c); status.appendChild(c); return; }
            var line = el('div'); line.appendChild(el('span', 'px-ver', 'v' + live.version)); line.appendChild(el('span', 'px-live', pub.visibility.toUpperCase())); c.appendChild(line);
            var u = viewUrl(pub.slug); c.appendChild(el('p', 'px-url', u)); c.appendChild(el('p', 'px-msg', 'Copying: ' + shareName(pub.sharing || 'none')));
            var a = el('div', 'px-actions');
            a.appendChild(btn('Open Project', function () { window.open(u, '_blank', 'noopener'); }, '', 'Opens the standalone viewer in a new tab'));
            a.appendChild(btn('Copy link', function () { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(function () { msg.show('Link copied.', 'ok'); }, function () { msg.show('The browser blocked copying. Select the link above.', 'err'); }); }));
            a.appendChild(btn('Unpublish', unpublish, 'st-danger', 'Visitors will see "not available". Your releases are kept.'));
            c.appendChild(a); if (pub.visibility === 'private') c.appendChild(el('p', 'px-msg', 'Visibility is Private: only you can open it, while signed in.')); hubStatus(c); status.appendChild(c);
        }
        function paintHist() {
            hist.textContent = ''; if (!rels.length) { hist.appendChild(el('p', 'px-msg', 'No releases yet.')); return; }
            rels.forEach(function (r) {
                var isLive = pub && pub.release_id === r.id, row = el('div', 'px-row'), b = el('div', 'px-grow'), t = el('div');
                t.appendChild(el('span', 'px-ver', 'v' + r.version)); if (isLive) t.appendChild(el('span', 'px-live', 'LIVE')); t.appendChild(document.createTextNode('  ' + (KINDS.filter(function (k) { return k[0] === r.kind; })[0] || ['', r.kind])[1]));
                b.appendChild(t); b.appendChild(el('small', '', when(r.created_at) + (r.notes ? '  |  ' + r.notes : '')));
                var a = el('div', 'px-actions'); a.style.marginTop = '0';
                var liveRel = pub && pub.release_id ? rels.filter(function (x) { return x.id === pub.release_id; })[0] : null;
                if (pub && !isLive) a.appendChild(btn(liveRel && r.created_at < liveRel.created_at ? 'Roll back to this' : 'Make live', function () { goLive(r); }));
                if (!isLive) a.appendChild(btn('Delete', function () { delRel(r); }, 'st-danger'));
                row.appendChild(b); row.appendChild(a); hist.appendChild(row);
            });
        }
        async function reload() {
            var a = await sb.from('studio_published').select('*').eq('project_id', proj.id).maybeSingle();
            var b = await sb.from('studio_releases').select('id,version,notes,kind,created_at').eq('project_id', proj.id).order('created_at', { ascending: false });
            if (my !== seq) return;
            if (a.error || b.error) { msg.show(nice(a.error || b.error), 'err'); return; }
            pub = a.data; rels = b.data || []; ver.value = nextVersion(rels[0] && rels[0].version); paintStatus(); paintHist();
        }
        async function syncHub(row) {                    // creates or updates the card on the Projects hub (a profile_projects row); returns a sentence for the message box
            if (!hubOn.checked) return '';
            var existing = pub && pub.hub_project_id, live = row.visibility === 'public' && !!row.release_id;
            var vu = viewUrl(row.slug), httpsOk = /^https:\/\//i.test(vu);      // the database only accepts https links on a hub card (projects_url_https)
            var noLink = '';                                       // no warning needed: the hub builds the Open Project link from its own address (studio_slug)
            var base = { title: row.title, summary: (row.description || 'Made with SPECSOFT Studio.').slice(0, 280), category: hubCat.value, url: live && httpsOk ? vu : null, tags: ['studio'] };
            if (existing) {
                var u = await sb.from('profile_projects').update(base).eq('id', existing);
                return u.error ? ' The Projects hub did not accept the update: ' + hubNice(u.error) : (live ? ' The Projects hub card is updated.' + noLink : ' Its Projects hub card no longer links here, because it is not Public and live.');
            }
            if (!live) return ' It is not on the Projects hub yet: it needs Visibility set to Public and a live release.';
            var ins = await sb.from('profile_projects').insert(Object.assign({ owner_id: P.user().id }, base)).select('id').single();
            if (ins.error) return ' It could not be added to the Projects hub: ' + hubNice(ins.error);
            var lk = await sb.from('studio_published').update({ hub_project_id: ins.data.id }).eq('project_id', proj.id);
            if (lk.error) return ' A card was added to the Projects hub, but linking it failed: ' + nice(lk.error);
            return ' It is now on the Projects hub.' + noLink;
        }
        function hubNice(e) { if (e && /projects_url_https/.test(e.message || '')) return 'the database refused the link (rule projects_url_https). Send me that rule and I will match it.'; return (e && (e.code === '42501' || /row-level security/i.test(e.message || ''))) ? 'the Projects hub refused it (your profile may already have the maximum number of projects).' : nice(e); }
        function kindOf(t) { return /could not|did not|failed/i.test(t) ? 'err' : 'ok'; }
        async function removeFromHub() {
            if (!pub || !pub.hub_project_id) return;
            if (!window.confirm('Remove it from the Projects hub? This deletes the card, including its likes, comments and reposts. Your published project stays live.')) return;
            var d = await sb.from('profile_projects').delete().eq('id', pub.hub_project_id); if (d.error) return msg.show(nice(d.error), 'err');
            say('warn', 'publish', 'Removed from the Projects hub'); msg.show('Removed from the Projects hub.', 'ok'); reload();
        }
        function shareCheck() {                          // returns a sentence when the Copying choice cannot be saved yet
            if (share.value !== 'password') return '';
            var cur = pub && pub.sharing === 'password', pw = sharePw.value;
            if (!pw && !cur) return 'Type a password (4 to 60 characters) for "Password to copy", or pick another Copying option.';
            if (pw && (pw.length < 4 || pw.length > 60)) return 'The copy password needs 4 to 60 characters.';
            return '';
        }
        async function applySharing() {                  // saves the Copying choice (the password is hashed on the server); returns a sentence for the message box
            var mode = share.value, cur = (pub && pub.sharing) || 'none', pw = sharePw.value;
            if (mode === cur && !(mode === 'password' && pw)) return '';
            var r = await sb.rpc('studio_set_sharing', { p_project: proj.id, p_mode: mode, p_password: mode === 'password' ? pw : '' });
            if (r.error) return ' It could not change Copying: ' + nice(r.error);
            if (r.data && r.data.ok === false) return ' It could not change Copying: ' + shareErr(r.data.error) + '.';
            sharePw.value = '';
            return mode === 'none' ? ' Copying is off.' : ' Copying is on (' + (mode === 'free' ? 'free copy' : 'password') + '). Releases published from now on can be copied.';
        }
        function postToHub() {                           // one click: tick the box, check the basics, then save the listing (which creates the card)
            if (!pub || !pub.release_id) return msg.show('Publish a release first, so the card has something to open.', 'err');
            if (vis.value !== 'public') return msg.show('Set Visibility to Public in the Listing box first, then press Post to Projects hub again.', 'err');
            hubOn.checked = true; saveListing();
        }
        async function saveListing() {
            var row = listing(); if (!row) return; if (!pub) { msg.show('Publish a release first. The listing is created with your first release.', 'err'); return; }
            var se = shareCheck(); if (se) return msg.show(se, 'err'); row.release_id = pub.release_id; var r = await sb.from('studio_published').upsert(row, { onConflict: 'project_id' });
            if (r.error) return msg.show(nice(r.error), 'err'); var sx = await applySharing(), hx = await syncHub(row); msg.show('Listing saved.' + sx + hx, kindOf(sx + hx)); reload();
        }
        async function publish() {
            var row = listing(); if (!row) return; var v = ver.value.trim(); if (!VER.test(v)) return msg.show('The version number should look like 1.0.0.', 'err');
            var g = P.saved(); if (!g) return msg.show('There is no saved version of this project yet. Press Save first.', 'err'); var se = shareCheck(); if (se) return msg.show(se, 'err');
            var k = kind.value, rel = { project_id: proj.id, owner_id: P.user().id, version: v, notes: notes.value.trim().slice(0, 500), kind: k, bundle: '', files: null };
            if (share.value !== 'none') { if (JSON.stringify(g).length > 450000) return msg.show('This project is too large to include a copy (450 KB max). Pick "No copy" or make the project smaller.', 'err'); rel.graph = g; }   // the snapshot a visitor copies; only stored when copying is on
            if (k === 'source') {
                var f = X.collectFiles(g); if (!f.files.length) return msg.show('There are no code files to publish.', 'err'); if (f.size > MAX_FILES) return msg.show('The code is too large to publish (' + Math.round(f.size / 1000) + ' KB, max ' + Math.round(MAX_FILES / 1000) + ' KB).', 'err'); rel.files = f.files;
            } else {
                if (!PV || !PV.assemble) return msg.show('The Preview module is missing, so a page cannot be built.', 'err');
                var a = PV.assemble(g); if (!a.hasHtml) return msg.show('Nothing to publish yet: add an HTML file in the Code Editor and Save.', 'err'); if (a.size > MAX_PAGE) return msg.show('The page is too large (' + Math.round(a.size / 1000) + ' KB, max ' + Math.round(MAX_PAGE / 1000) + ' KB).', 'err');
                rel.bundle = a.doc('published');
            }
            pubBtn.disabled = true; msg.show('Publishing...', '');
            var ins = await sb.from('studio_releases').insert(rel).select('id').single();
            if (ins.error) { pubBtn.disabled = false; return msg.show(nice(ins.error), 'err'); }
            row.release_id = ins.data.id; var up = await sb.from('studio_published').upsert(row, { onConflict: 'project_id' }); pubBtn.disabled = false;
            if (up.error) { msg.show('The release v' + v + ' was saved, but the listing was not updated: ' + nice(up.error), 'err'); reload(); return; }
            var sx = await applySharing(), hx = await syncHub(row); say('ok', 'publish', 'Published v' + v + ' (' + row.visibility + ') at ' + viewUrl(row.slug)); msg.show('Published v' + v + '. It is live.' + sx + hx, kindOf(sx + hx)); notes.value = ''; reload();
        }
        async function goLive(r) {
            if (!window.confirm('Make v' + r.version + ' the live release?')) return;
            var u = await sb.from('studio_published').update({ release_id: r.id }).eq('project_id', proj.id); if (u.error) return msg.show(nice(u.error), 'err');
            say('ok', 'publish', 'v' + r.version + ' is now live'); msg.show('v' + r.version + ' is now live.', 'ok'); reload();
        }
        async function unpublish() {
            if (!window.confirm('Unpublish? Visitors will see "not available". Your releases are kept.')) return;
            var u = await sb.from('studio_published').update({ release_id: null }).eq('project_id', proj.id); if (u.error) return msg.show(nice(u.error), 'err');
            var note = ''; if (pub.hub_project_id) { var h = await sb.from('profile_projects').update({ url: null }).eq('id', pub.hub_project_id); note = h.error ? ' (The Projects hub card could not be updated: ' + nice(h.error) + ')' : ' Its Projects hub card stays, with its likes and comments, but no longer links here.'; }
            say('warn', 'publish', 'Unpublished'); msg.show('Unpublished.' + note, 'ok'); reload();
        }
        async function delRel(r) {
            if (!window.confirm('Delete release v' + r.version + '? This cannot be undone.')) return;
            var d = await sb.from('studio_releases').delete().eq('id', r.id); if (d.error) return msg.show(nice(d.error), 'err'); reload();
        }
        dirty.textContent = P.isDirty() ? 'You have unsaved changes. A release uses the LAST SAVED version, so press Save first if you want them included.' : '';
        reload().then(function () { if (my === seq) fillFromPub(); });
    }

    X.render = function (view, host) {
        var my = ++seq; host.textContent = ''; var w = el('div', 'pg'); host.appendChild(w);
        try { if (view === 'versions') versions(w, my); else publishPg(w, my); } catch (e) { w.appendChild(el('p', 'px-msg err', 'This page failed to load: ' + String((e && e.message) || e).slice(0, 200))); }
    };
})();
