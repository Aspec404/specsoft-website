/* ==========================================================================
   SPECSOFT® settings.js  -  draws settings.html from SpecSettings.CATS
   Add a setting in site-settings.js and it shows up here by itself.
   ========================================================================== */
(function () {
    'use strict';
    var S = window.SpecSettings;
    var panel = document.getElementById('sxPanel');
    if (!S || !panel) { if (panel) panel.textContent = 'Settings could not load. Please refresh the page.'; return; }

    var $ = function (id) { return document.getElementById(id); };
    var catsEl = $('sxCats'), search = $('sxSearch'), toast = $('sxToast'), reloadBar = $('sxReload'), file = $('sxFile');
    var active = (location.hash || '').replace('#', '');
    if (!S.CATS.some(function (c) { return c.id === active; })) active = S.CATS[0].id;
    var query = '';
    var initial = {};
    S.CATS.forEach(function (c) { c.items.forEach(function (it) { if (it.reload) initial[it.key] = S.get(it.key); }); });

    function h(tag, attrs, kids) {
        var n = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') n.textContent = attrs[k];
            else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
            else n.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
        return n;
    }

    var tmr = null;
    function flash(msg) {
        toast.textContent = msg; toast.classList.add('is-on');
        clearTimeout(tmr); tmr = setTimeout(function () { toast.classList.remove('is-on'); }, 1600);
    }
    function checkReload() {
        var need = Object.keys(initial).some(function (k) { return S.get(k) !== initial[k]; });
        reloadBar.hidden = !need;
    }

    function control(it) {
        if (it.type === 'toggle') {
            var inp = h('input', { type: 'checkbox', role: 'switch', 'data-key': it.key, 'aria-label': it.label });
            inp.checked = !!S.get(it.key);
            inp.addEventListener('change', function () { S.set(it.key, inp.checked); flash('Saved'); checkReload(); });
            return h('label', { class: 'sx-switch' }, [inp, h('span')]);
        }
        if (it.type === 'select') {
            var sel = h('select', { class: 'sx-select', 'data-key': it.key, 'aria-label': it.label },
                it.options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
            sel.value = S.get(it.key);
            sel.addEventListener('change', function () { S.set(it.key, sel.value); flash('Saved'); checkReload(); });
            return sel;
        }
        return h('button', { type: 'button', class: 'sx-btn' + (it.danger ? ' sx-btn--danger' : ''), text: it.button, onclick: function () { runAction(it.action); } });
    }

    function row(it) {
        var label = h('div', { class: 'sx-row-label', text: it.label });
        if (it.reload) label.appendChild(h('span', { class: 'sx-tag', text: 'RELOAD', title: 'Needs a page reload to fully apply' }));
        var text = h('div', { class: 'sx-row-text' }, [label, h('div', { class: 'sx-row-desc', text: it.desc })]);
        var tag = it.type === 'toggle' ? 'label' : 'div';      // a label makes the whole row tappable
        return h(tag, { class: 'sx-row sx-row--' + it.type }, [text, control(it)]);
    }

    function runAction(a) {
        if (a === 'export') {
            var url = URL.createObjectURL(new Blob([S.exportJSON()], { type: 'application/json' }));
            var link = h('a', { href: url, download: 'specsoft-settings.json' });
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            flash('Exported');
        } else if (a === 'import') { file.value = ''; file.click(); }
        else if (a === 'reset') { if (window.confirm('Reset every setting to its default?')) { S.reset(); flash('Settings reset'); checkReload(); } }
    }
    file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 100000) { flash('That file is too big'); return; }
        var r = new FileReader();
        r.onload = function () {
            var res = S.importJSON(String(r.result));
            flash(res && res.applied ? 'Imported ' + res.applied + ' settings' : 'That file has no settings I can use');
            checkReload();
        };
        r.readAsText(f);
    });

    function matches(it) {
        var q = query.trim().toLowerCase();
        return !q || (it.label + ' ' + it.desc).toLowerCase().indexOf(q) !== -1;
    }

    function render() {
        catsEl.textContent = '';
        S.CATS.forEach(function (c) {
            var ic = h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
            ic.innerHTML = c.icon;     // static markup from site-settings.js, never user data
            var b = h('button', { type: 'button', class: 'sx-cat', 'aria-current': String(!query && c.id === active) }, [ic, h('span', { text: c.title })]);
            b.addEventListener('click', function () {
                query = ''; search.value = ''; active = c.id; history.replaceState(null, '', '#' + c.id); render();
                if (window.scrollY > 120) window.scrollTo(0, 0);
            });
            catsEl.appendChild(b);
        });

        var cur = catsEl.querySelector('[aria-current="true"]');
        if (cur && catsEl.scrollWidth > catsEl.clientWidth) catsEl.scrollLeft = cur.offsetLeft - (catsEl.clientWidth - cur.offsetWidth) / 2;

        panel.textContent = '';
        var shown = 0;
        S.CATS.forEach(function (c) {
            if (!query && c.id !== active) return;
            var items = c.items.filter(matches);
            if (!items.length) return;
            panel.appendChild(h('h2', { class: 'sx-group-title', text: c.title }));
            panel.appendChild(h('p', { class: 'sx-group-blurb', text: c.blurb }));
            items.forEach(function (it) { panel.appendChild(row(it)); shown++; });
        });
        if (!shown) panel.appendChild(h('div', { class: 'sx-empty', text: 'No settings match "' + query.trim() + '".' }));
    }

    function refreshValues() {
        panel.querySelectorAll('[data-key]').forEach(function (el) {
            var v = S.get(el.getAttribute('data-key'));
            if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
        });
        checkReload();
    }

    function paintSync() {
        var st = S.status(), box = $('sxSync'), txt = box.querySelector('span');
        box.className = 'sx-sync';
        txt.textContent = '';
        if (st.error) { box.classList.add('is-err'); txt.textContent = 'Sync paused'; box.title = st.error; }
        else if (st.signedIn) { box.classList.add('is-on'); txt.textContent = 'Synced'; box.title = 'Your settings sync to your account'; }
        else {
            txt.textContent = 'This device \u00b7 ';
            txt.appendChild(h('a', { href: 'login.html', text: 'Log in' }));
            box.title = 'Log in to sync your settings across devices';
        }
    }

    S.on(function (key) { if (key === '__status') paintSync(); else refreshValues(); });
    search.addEventListener('input', function () { query = search.value; render(); });
    $('sxReloadBtn').addEventListener('click', function () { location.reload(); });
    window.addEventListener('hashchange', function () {
        var id = (location.hash || '').replace('#', '');
        if (S.CATS.some(function (c) { return c.id === id; })) { active = id; query = ''; search.value = ''; render(); }
    });

    $('sxBack').addEventListener('click', function (e) {
        var same = false;
        try { same = !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch (x) { /* ignore */ }
        if (same) { e.preventDefault(); history.back(); }
    });

    render();
    paintSync();
})();
