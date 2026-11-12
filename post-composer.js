/* ==========================================================================
   SPECSOFT® post composer (post-composer.js)
   A post = title + text + images + files + links (+ tags). It is saved as a profile_projects row with kind = 'post',
   so it shows up in the hub, on the profile, and gets likes / comments / reposts / saves / reports for free.

   Needs: supabase-hub-v2.sql (columns + the post-media bucket) and post-social.css.

   SpecComposer.open({ sb, me, toast, onCreated })
     me         { id }  (required: guests are told to log in)
     onCreated  called with the new row after it was saved
   ========================================================================== */
(function () {
    'use strict';

    var MAX_IMAGES = 6, MAX_FILES = 5, MAX_LINKS = 5, MAX_TAGS = 6;
    var MAX_IMG_BYTES = 10 * 1024 * 1024, MAX_FILE_BYTES = 25 * 1024 * 1024;

    // what the post-media bucket accepts (supabase-hub-v2.sql). Extension decides, because browsers report odd types for zip / md.
    var TYPES = {
        png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'], webp: ['image/webp', 'image'], gif: ['image/gif', 'image'],
        mp4: ['video/mp4', 'video'], webm: ['video/webm', 'video'],
        pdf: ['application/pdf', 'file'], zip: ['application/zip', 'file'], json: ['application/json', 'file'], txt: ['text/plain', 'file'], md: ['text/markdown', 'file']
    };

    function el(tag, attrs) {
        var node = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            var v = attrs[k];
            if (v === null || v === undefined || v === false) return;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        });
        for (var i = 2; i < arguments.length; i++) put(node, arguments[i]);
        return node;
    }
    function put(parent, c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) { c.forEach(function (x) { put(parent, x); }); return; }
        parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
    function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
    function bytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function safeName(n) { return String(n).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60) || 'file'; }

    function friendly(err) {
        var code = String(err && err.code || ''), msg = String(err && err.message || '').toLowerCase();
        if (code === 'PGRST204' || /column .*(kind|body|attachments|links)|post-media|bucket not found/.test(msg)) return 'Run supabase-hub-v2.sql in your Supabase SQL Editor to turn on posts.';
        if (code === '42501' || msg.indexOf('row-level security') >= 0) return 'You reached the limit of 100 posts, or you are not allowed to post right now.';
        if (code === '23514') return 'Something is too long or not allowed (title 80, text 5000 characters, links must start with https://).';
        if (msg.indexOf('exceeded') >= 0 || msg.indexOf('too large') >= 0) return 'One of your files is too big (25 MB max).';
        if (msg.indexOf('failed to fetch') >= 0 || msg.indexOf('network') >= 0) return 'Cannot reach the server. Check your connection.';
        return 'Something went wrong. Please try again.';
    }

    function open(opts) {
        opts = opts || {};
        var sb = opts.sb, me = opts.me, say = opts.toast || function () { };
        if (!sb) return;
        if (!me) { say('Log in to create a post.'); return; }
        if (document.getElementById('pcmpDialog')) return;

        var S = { items: [], links: [''], busy: false, dirty: false };

        var dlg = el('dialog', { class: 'pcmp', id: 'pcmpDialog', 'aria-labelledby': 'pcmpH' });
        var title = el('input', { class: 'pc-input', id: 'pcmpTitle', type: 'text', maxlength: '80', placeholder: 'Give your post a title', required: true });
        var body = el('textarea', { class: 'pc-input pcmp-body', id: 'pcmpBody', maxlength: '5000', rows: '6', placeholder: 'What do you want to share? Updates, ideas, questions, a work in progress...' });
        var tags = el('input', { class: 'pc-input', id: 'pcmpTags', type: 'text', maxlength: '80', placeholder: 'Tags, separated by commas (max 6)' });
        var hub = el('input', { type: 'checkbox', id: 'pcmpHub', checked: true });
        var msg = el('p', { class: 'pcmp-msg', role: 'alert' });
        var counter = el('span', { class: 'pcmp-counter', text: '0 / 5000' });
        var tray = el('div', { class: 'pcmp-tray' });
        var linksBox = el('div', { class: 'pcmp-links' });
        var drop = el('div', { class: 'pcmp-drop', tabindex: '0', role: 'button', 'aria-label': 'Add images or files' });
        var picker = el('input', { type: 'file', multiple: true, hidden: true, accept: Object.keys(TYPES).map(function (e) { return '.' + e; }).join(',') });
        var postBtn = el('button', { type: 'submit', class: 'pc-btn pc-btn--solid pcmp-post' }, el('span', { class: 'pcmp-post-t', text: 'Post' }));
        var bar = el('div', { class: 'pcmp-progress', hidden: true }, el('i'));

        function mark() { S.dirty = true; }
        body.addEventListener('input', function () { counter.textContent = body.value.length + ' / 5000'; mark(); });
        title.addEventListener('input', mark); tags.addEventListener('input', mark);

        function say2(t) { msg.textContent = t || ''; }

        /* ---- files ---- */
        function addFiles(list) {
            say2('');
            Array.prototype.forEach.call(list, function (f) {
                var e = ext(f.name), t = TYPES[e];
                if (!t) { say2('".' + e + '" files are not supported. Use images, mp4/webm, pdf, zip, json, txt or md.'); return; }
                if (t[1] === 'image' && f.size > MAX_IMG_BYTES) { say2(f.name + ' is over 10 MB. Images can be up to 10 MB.'); return; }
                if (f.size > MAX_FILE_BYTES) { say2(f.name + ' is over 25 MB.'); return; }
                var images = S.items.filter(function (i) { return i.kind === 'image'; }).length;
                var files = S.items.length - images;
                if (t[1] === 'image' && images >= MAX_IMAGES) { say2('You can add up to ' + MAX_IMAGES + ' images.'); return; }
                if (t[1] !== 'image' && files >= MAX_FILES) { say2('You can add up to ' + MAX_FILES + ' files.'); return; }
                S.items.push({ file: f, kind: t[1], mime: t[0], preview: t[1] === 'image' ? URL.createObjectURL(f) : '' });
                mark();
            });
            paintTray();
        }

        function paintTray() {
            clear(tray);
            S.items.forEach(function (it, i) {
                var rm = el('button', { type: 'button', class: 'pcmp-rm', 'aria-label': 'Remove ' + it.file.name, onclick: function () {
                    if (it.preview) URL.revokeObjectURL(it.preview);
                    S.items.splice(i, 1); paintTray();
                } }, '\u00D7');
                if (it.kind === 'image') tray.appendChild(el('div', { class: 'pcmp-thumb' }, el('img', { src: it.preview, alt: it.file.name }), i === 0 && S.items[0].kind === 'image' ? el('span', { class: 'pcmp-cover', text: 'COVER' }) : null, rm));
                else tray.appendChild(el('div', { class: 'pcmp-file' }, el('span', { class: 'pcmp-file-ext', text: ext(it.file.name).toUpperCase() }),
                    el('span', { class: 'pcmp-file-n' }, el('strong', { text: it.file.name }), el('small', { text: bytes(it.file.size) })), rm));
            });
            drop.querySelector('.pcmp-drop-sub').textContent = S.items.length ? 'Add more' : 'Images up to 10 MB, files up to 25 MB';
        }

        put(drop, el('strong', { text: 'Drop images or files here, or click to browse' }), el('span', { class: 'pcmp-drop-sub', text: 'Images up to 10 MB, files up to 25 MB' }));
        drop.addEventListener('click', function () { picker.click(); });
        drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
        picker.addEventListener('change', function () { addFiles(picker.files); picker.value = ''; });
        ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
        ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
        drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
        body.addEventListener('paste', function (e) {                                  // paste a screenshot straight in
            var fs = e.clipboardData && e.clipboardData.files;
            if (fs && fs.length) { e.preventDefault(); addFiles(fs); }
        });

        /* ---- links ---- */
        function paintLinks() {
            clear(linksBox);
            S.links.forEach(function (v, i) {
                var inp = el('input', { class: 'pc-input', type: 'url', inputmode: 'url', maxlength: '300', placeholder: 'https://', value: v, 'aria-label': 'Link ' + (i + 1) });
                inp.addEventListener('input', function () { S.links[i] = inp.value; mark(); });
                linksBox.appendChild(el('div', { class: 'pcmp-linkrow' }, inp,
                    S.links.length > 1 ? el('button', { type: 'button', class: 'pcmp-rm pcmp-rm--row', 'aria-label': 'Remove link', onclick: function () { S.links.splice(i, 1); paintLinks(); } }, '\u00D7') : null));
            });
            if (S.links.length < MAX_LINKS) linksBox.appendChild(el('button', { type: 'button', class: 'pc-btn pcmp-addlink', text: '+ Add another link', onclick: function () { S.links.push(''); paintLinks(); linksBox.querySelector('.pcmp-linkrow:last-of-type input').focus(); } }));
        }

        /* ---- close ---- */
        function close(force) {
            if (S.busy) return;
            if (!force && S.dirty && (title.value.trim() || body.value.trim() || S.items.length) && !window.confirm('Discard this post?')) return;
            dlg.close();
        }

        /* ---- save ---- */
        async function save(e) {
            e.preventDefault();
            if (S.busy) return;
            say2('');
            var t = title.value.trim(), b = body.value.trim();
            if (!t) { say2('Add a title.'); title.focus(); return; }
            if (!b && !S.items.length && !S.links.some(function (l) { return l.trim(); })) { say2('Write something, or add an image, file or link.'); body.focus(); return; }

            var links = [];
            for (var i = 0; i < S.links.length; i++) {
                var l = S.links[i].trim();
                if (!l) continue;
                if (!/^https:\/\/[^\s]+$/i.test(l)) { say2('Links must start with https://'); return; }
                links.push({ url: l });
            }
            var tagList = tags.value.split(',').map(function (x) { return x.trim().replace(/\s+/g, ' ').slice(0, 24); }).filter(Boolean);
            tagList = tagList.filter(function (x, i2) { return tagList.indexOf(x) === i2; }).slice(0, MAX_TAGS);

            S.busy = true; postBtn.disabled = true; bar.hidden = false;
            var uploaded = [], paths = [];
            try {
                var done = 0, total = S.items.length;
                for (var n = 0; n < S.items.length; n++) {
                    var it = S.items[n];
                    var path = me.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + safeName(it.file.name);
                    var up = await sb.storage.from('post-media').upload(path, it.file, { cacheControl: '31536000', upsert: false, contentType: it.mime });
                    if (up.error) throw up.error;
                    paths.push(path);
                    uploaded.push({ url: sb.storage.from('post-media').getPublicUrl(path).data.publicUrl, name: it.file.name.slice(0, 80), type: it.mime, size: it.file.size, kind: it.kind });
                    done++; bar.firstChild.style.width = Math.round(done / Math.max(1, total) * 90) + '%';
                }
                var cover = uploaded.filter(function (u) { return u.kind === 'image'; })[0];
                var row = {
                    owner_id: me.id, kind: 'post', title: t,
                    summary: b ? b.replace(/\s+/g, ' ').slice(0, 280) : null,
                    body: b || null, attachments: uploaded, links: links, tags: tagList,
                    cover_url: cover ? cover.url : null, category: 'other', show_in_hub: hub.checked
                };
                var res = await sb.from('profile_projects').insert(row).select('*').single();
                if (res.error) throw res.error;
                bar.firstChild.style.width = '100%';
                S.items.forEach(function (x) { if (x.preview) URL.revokeObjectURL(x.preview); });
                S.dirty = false; S.busy = false;
                dlg.close();
                say('Posted');
                if (opts.onCreated) opts.onCreated(res.data);
            } catch (err) {
                if (paths.length) { try { await sb.storage.from('post-media').remove(paths); } catch (e2) { /* ignore */ } }   // no orphan files
                say2(friendly(err));
                S.busy = false; postBtn.disabled = false; bar.hidden = true; bar.firstChild.style.width = '0';
            }
        }

        var form = el('form', { class: 'pcmp-form', novalidate: true, onsubmit: save },
            el('header', { class: 'pcmp-head' },
                el('h2', { id: 'pcmpH', text: 'Create a post' }),
                el('button', { type: 'button', class: 'pcmp-x', 'aria-label': 'Close', onclick: function () { close(false); } }, '\u00D7')),
            el('div', { class: 'pcmp-scroll' },
                el('label', { class: 'pcmp-l', for: 'pcmpTitle', text: 'Title' }), title,
                el('div', { class: 'pcmp-row' }, el('label', { class: 'pcmp-l', for: 'pcmpBody', text: 'Description' }), counter), body,
                el('span', { class: 'pcmp-l', text: 'Images and files' }), drop, picker, tray,
                el('span', { class: 'pcmp-l', text: 'Links' }), linksBox,
                el('label', { class: 'pcmp-l', for: 'pcmpTags', text: 'Tags' }), tags,
                el('label', { class: 'pcmp-check' }, hub, el('span', { text: 'Show this post in the Projects Hub' }))),
            el('footer', { class: 'pcmp-foot' }, msg, bar,
                el('div', { class: 'pcmp-actions' }, el('button', { type: 'button', class: 'pc-btn', text: 'Cancel', onclick: function () { close(false); } }), postBtn)));

        dlg.appendChild(form);
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(false); });
        dlg.addEventListener('close', function () { S.items.forEach(function (x) { if (x.preview) URL.revokeObjectURL(x.preview); }); dlg.remove(); });
        dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) close(false); });
        document.body.appendChild(dlg);
        paintLinks(); paintTray();
        dlg.showModal();
        title.focus();
    }

    window.SpecComposer = { open: open };
})();
