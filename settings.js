/* ==========================================================================
   SPECSOFT® settings.js  -  draws settings.html from SpecSettings.CATS
   Add a setting in site-settings.js and it shows up here by itself.
   Control types: toggle, select, range, palette, presets, pad, code, action.
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
    var LOCK = ' \uD83D\uDD12';
    var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
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
        clearTimeout(tmr); tmr = setTimeout(function () { toast.classList.remove('is-on'); }, 2200);
    }
    function checkReload() {
        var need = Object.keys(initial).some(function (k) { return S.get(k) !== initial[k]; });
        reloadBar.hidden = !need;
    }

    // choose a select/palette value: free ones are saved, locked ones are only previewed
    function choose(it, v) {
        if (S.isLocked(it, v)) { S.setPreview(it.key, v); flash('\uD83D\uDD12 Preview only. Unlocks with APEX Credits soon.'); }
        else { S.set(it.key, v); flash('Saved'); }
        checkReload();
    }
    function optLabel(it, o) { return o[1] + (S.isLocked(it, o[0]) ? LOCK : ''); }
    function fmt(it, v) { return v + (it.unit || ''); }

    /* ------------------------------------------------------------ controls */
    function control(it) {
        if (it.type === 'toggle') {
            var inp = h('input', { type: 'checkbox', role: 'switch', 'data-key': it.key, 'aria-label': it.label });
            inp.checked = !!S.view(it.key);
            inp.addEventListener('change', function () { S.set(it.key, inp.checked); flash('Saved'); checkReload(); });
            return h('label', { class: 'sx-switch' }, [inp, h('span')]);
        }
        if (it.type === 'select') {
            var sel = h('select', { class: 'sx-select', 'data-key': it.key, 'aria-label': it.label },
                it.options.map(function (o) { return h('option', { value: o[0], text: optLabel(it, o) }); }));
            sel.value = S.view(it.key);
            sel.addEventListener('change', function () { choose(it, sel.value); });
            return sel;
        }
        if (it.type === 'range') {
            var out = h('output', { class: 'sx-range-out', 'data-out': it.key, text: fmt(it, S.view(it.key)) });
            var rng = h('input', { type: 'range', class: 'sx-range', 'data-key': it.key, min: it.min, max: it.max, step: it.step, 'aria-label': it.label });
            rng.value = S.view(it.key);
            rng.addEventListener('input', function () { out.textContent = fmt(it, rng.value); S.set(it.key, Number(rng.value)); });
            rng.addEventListener('change', function () { flash('Saved'); });
            return h('div', { class: 'sx-range-wrap' }, [rng, out]);
        }
        if (it.type === 'palette') {
            var wrap = h('div', { class: 'sx-palette', role: 'radiogroup', 'data-pal': it.key, 'aria-label': it.label });
            it.options.forEach(function (o) {
                var b = h('button', { type: 'button', class: 'sx-swatch', role: 'radio', 'data-val': o[0], 'aria-label': o[1], title: o[1] }, [h('span', { class: 'sx-swatch-dot' })]);
                if (o[3]) b.style.setProperty('--sw', o[3]);
                b.addEventListener('click', function () { choose(it, o[0]); });
                wrap.appendChild(b);
            });
            paintPalette(wrap);
            return wrap;
        }
        return h('button', { type: 'button', class: 'sx-btn' + (it.danger ? ' sx-btn--danger' : ''), text: it.button, onclick: function () { runAction(it.action); } });
    }

    function paintPalette(wrap) {
        var it = S.item(wrap.getAttribute('data-pal')), cur = S.view(it.key);
        Array.prototype.forEach.call(wrap.children, function (b) {
            var v = b.getAttribute('data-val'), locked = S.isLocked(it, v);
            b.classList.toggle('is-on', v === cur);
            b.classList.toggle('is-locked', locked);
            b.setAttribute('aria-checked', String(v === cur));
            var o = it.options.filter(function (x) { return x[0] === v; })[0];
            b.title = o[1] + (locked ? ' (locked, preview only)' : '');
        });
    }

    function row(it) {
        var label = h('div', { class: 'sx-row-label', text: it.label });
        if (it.reload) label.appendChild(h('span', { class: 'sx-tag', text: 'RELOAD', title: 'Needs a page reload to fully apply' }));
        var text = h('div', { class: 'sx-row-text' }, [label, h('div', { class: 'sx-row-desc', text: it.desc })]);
        var tag = it.type === 'toggle' ? 'label' : 'div';      // a label makes the whole row tappable
        return h(tag, { class: 'sx-row sx-row--' + it.type }, [text, control(it)]);
    }

    /* ------------------------------------------------------- full-width blocks */
    function block(it, kids) {
        return h('div', { class: 'sx-block sx-block--' + it.type }, [
            h('div', { class: 'sx-row-label', text: it.label }),
            h('div', { class: 'sx-row-desc', text: it.desc })
        ].concat(kids));
    }

    function padBlock(it) {
        var drag = h('div', { class: 'sx-pad-drag', 'data-cursor': 'grab', text: 'Drag me' });
        var up = function () { drag.classList.remove('is-dragging'); };
        drag.addEventListener('pointerdown', function () { drag.classList.add('is-dragging'); });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        var tapBox = h('div', { class: 'sx-pad-tap', text: coarse ? 'Tap or drag here to try your touch effects' : 'Click here to preview your tap effect' });
        tapBox.addEventListener('pointerdown', function (e) {
            if (e.pointerType !== 'touch' && window.SpecTouch) window.SpecTouch.demo(e.clientX, e.clientY);
        });
        var pad = h('div', { class: 'sx-pad' }, [
            h('div', { class: 'sx-pad-grid' }, [
                h('button', { type: 'button', class: 'sx-btn', 'data-cursor-label': 'CLICK ME', text: 'Click me' }),
                h('a', { href: '#', class: 'sx-pad-link', text: 'A link', onclick: function (e) { e.preventDefault(); } }),
                h('input', { type: 'text', class: 'sx-pad-input', placeholder: 'Type here', 'aria-label': 'Practice text field' }),
                h('button', { type: 'button', class: 'sx-btn', disabled: '', text: 'Locked' }),
                drag,
                h('div', { class: 'sx-pad-busy', 'aria-busy': 'true', text: 'Loading' })
            ]),
            tapBox
        ]);
        return block(it, [pad]);
    }

    function presetActive(p) { return Object.keys(p.map).every(function (k) { return S.view(k) === p.map[k]; }); }
    function presetLocked(p) { return Object.keys(p.map).some(function (k) { return S.isLocked(S.item(k), p.map[k]); }); }
    function paintPresets(grid) {
        Array.prototype.forEach.call(grid.children, function (b) {
            var p = S.PRESETS.filter(function (x) { return x.id === b.getAttribute('data-preset'); })[0];
            b.classList.toggle('is-on', presetActive(p));
            b.classList.toggle('is-locked', presetLocked(p));
        });
    }
    function presetsBlock(it) {
        var grid = h('div', { class: 'sx-presets', 'data-presets': '1' });
        S.PRESETS.forEach(function (p) {
            var b = h('button', { type: 'button', class: 'sx-preset', 'data-preset': p.id }, [
                h('span', { class: 'sx-preset-name', text: p.name }),
                h('span', { class: 'sx-preset-desc', text: p.desc })
            ]);
            b.addEventListener('click', function () {
                var r = S.applyPreset(p.map);
                flash(r.locked ? '\uD83D\uDD12 Previewing ' + p.name + '. Locked parts are not saved.' : p.name + ' applied');
                checkReload();
            });
            grid.appendChild(b);
        });
        paintPresets(grid);
        return block(it, [grid]);
    }

    function copyText(inp) {
        var done = function () { flash('Copied'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, function () { inp.select(); document.execCommand('copy'); done(); });
        else { inp.select(); try { document.execCommand('copy'); done(); } catch (e) { flash('Press Ctrl+C to copy'); } }
    }
    function codeBlock(it) {
        var inp = h('input', { type: 'text', class: 'sx-code', 'data-code': '1', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Cursor share code' });
        inp.value = S.exportCursorCode();
        var copy = h('button', { type: 'button', class: 'sx-btn', text: 'Copy', onclick: function () { copyText(inp); } });
        var apply = h('button', { type: 'button', class: 'sx-btn', text: 'Apply', onclick: function () {
            var r = S.importCursorCode(inp.value);
            if (!r) flash('That code is not valid');
            else flash(r.locked ? 'Applied. \uD83D\uDD12 ' + r.locked + ' locked style(s) are preview only.' : 'Code applied');
            checkReload();
        } });
        return block(it, [h('div', { class: 'sx-code-row' }, [inp, copy, apply])]);
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
        else if (a === 'resetCursor') { S.resetCursor(); flash('Cursor reset'); checkReload(); }
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

    /* ----------------------------------------------------------- render */
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
            var lastGroup = '';
            items.forEach(function (it) {
                if (it.group && it.group !== lastGroup) { lastGroup = it.group; panel.appendChild(h('h3', { class: 'sx-sub', text: it.group })); }
                var node = it.type === 'pad' ? padBlock(it) : it.type === 'presets' ? presetsBlock(it) : it.type === 'code' ? codeBlock(it) : row(it);
                panel.appendChild(node);
                shown++;
            });
        });
        if (!shown) panel.appendChild(h('div', { class: 'sx-empty', text: 'No settings match "' + query.trim() + '".' }));
        paintBanner();
    }

    // shown while locked styles are being previewed
    function paintBanner() {
        var old = panel.querySelector('.sx-banner');
        if (old) old.remove();
        if (!S.previewing().length || !panel.querySelector('.sx-pad, .sx-presets, .sx-palette')) return;
        var b = h('div', { class: 'sx-banner' }, [
            h('span', { text: '\uD83D\uDD12 Previewing locked styles. They are not saved.' }),
            h('button', { type: 'button', class: 'sx-btn', text: 'Clear preview', onclick: function () { S.clearPreview(); flash('Preview cleared'); } })
        ]);
        panel.insertBefore(b, panel.firstChild);
    }

    function refreshValues() {
        panel.querySelectorAll('[data-key]').forEach(function (el) {
            var v = S.view(el.getAttribute('data-key'));
            if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
            if (el.type === 'range') {
                var out = panel.querySelector('[data-out="' + el.getAttribute('data-key') + '"]');
                if (out) out.textContent = fmt(S.item(el.getAttribute('data-key')), v);
            }
        });
        panel.querySelectorAll('[data-pal]').forEach(paintPalette);
        panel.querySelectorAll('[data-presets]').forEach(paintPresets);
        panel.querySelectorAll('[data-code]').forEach(function (inp) { if (document.activeElement !== inp) inp.value = S.exportCursorCode(); });
        paintBanner();
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
