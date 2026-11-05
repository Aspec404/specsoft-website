/* SPECSOFT® Studio: Libraries (Dependencies page).
   A small VETTED list of libraries. The files live on YOUR OWN site (folder vendor/), so nothing is fetched from anyone else.
   Studio reads the file from your own origin and puts its text straight into the Preview page, because the Preview sandbox
   blocks all network access. A project saves only the library ids (never code); unknown ids are dropped when a project loads.
   Page JavaScript that is in the Preview runs AFTER the libraries, so a global such as THREE is already there. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;
    var G = window.StudioGraph, MAX_LIB = 2 * 1024 * 1024, MAX_ENABLED = 10;
    var CATALOG = [
        { id: 'three', name: 'three.js', file: 'vendor/three.min.js', global: 'THREE',
          desc: '3D engine (WebGL). Needs the plain script build named three.min.js, release r152 to r159, saved on your site as vendor/three.min.js.' }
    ];
    var known = {}; CATALOG.forEach(function (c) { known[c.id] = c; });
    var enabled = [], cache = {}, L = window.StudioLibs = {};
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

    L.catalog = function () { return CATALOG.slice(); };
    L.enabled = function () { return enabled.slice(); };
    L.get = L.enabled;                                                   // what a project saves: ids only
    L.set = function (ids) {                                             // used when a project loads: unknown or repeated ids are ignored
        enabled = (Array.isArray(ids) ? ids : []).filter(function (id, i, a) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(known, id) && a.indexOf(id) === i; }).slice(0, MAX_ENABLED);
    };
    L.toggle = function (id, on) {
        if (!Object.prototype.hasOwnProperty.call(known, id)) return;
        var has = enabled.indexOf(id) > -1; if (on === has) return;
        enabled = on ? enabled.concat([id]) : enabled.filter(function (x) { return x !== id; });
        if (G && G.onChange) G.onChange();                               // marks the project as changed so it can be saved
    };
    function fetchLib(c) {                                               // c.file comes from the catalog above, never from project data
        if (Object.prototype.hasOwnProperty.call(cache, c.id)) return Promise.resolve(cache[c.id]);
        return fetch(c.file, { credentials: 'omit' }).then(function (r) {
            if (!r.ok) throw new Error('not found at ' + c.file + ' (HTTP ' + r.status + ')');
            return r.text();
        }).then(function (t) {
            if (t.length > MAX_LIB) throw new Error(c.file + ' is too large (' + (t.length / 1048576).toFixed(2) + ' MB, max ' + (MAX_LIB / 1048576) + ' MB)');
            if (/^\s*</.test(t)) throw new Error('your site returned a web page instead of the script, so ' + c.file + ' is probably missing');
            cache[c.id] = t; return t;
        });
    }
    L.load = async function () {                                         // used by the Preview: { libs: [{id, code}], notes: [text] }
        var libs = [], notes = [];
        for (var i = 0; i < enabled.length; i++) {
            var c = known[enabled[i]];
            try { libs.push({ id: c.id, code: await fetchLib(c) }); }
            catch (e) { notes.push('Library ' + c.name + ' could not be loaded: ' + String((e && e.message) || e).slice(0, 200)); }
        }
        return { libs: libs, notes: notes };
    };
    L.render = function (host) {
        host.textContent = ''; var w = el('div', 'pg'); w.appendChild(el('h1', '', 'Dependencies'));
        w.appendChild(el('p', 'pg-lead', 'Libraries from a short vetted list. They are put straight into the Preview page, before your JavaScript (page) files run. Files come from your own site (vendor/ folder), nothing is loaded from other websites. Not part of published releases yet.'));
        if (!G || !G.isOpen()) { w.appendChild(el('p', 'pg-lead', 'Open a project to choose its libraries.')); host.appendChild(w); return; }
        CATALOG.forEach(function (c) {
            var row = el('div', 'pg-set'), lab = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = enabled.indexOf(c.id) > -1; cb.setAttribute('aria-label', 'Use ' + c.name);
            var status = el('p', 'pg-lead', 'Checking ' + c.file + ' ...');
            cb.addEventListener('change', function () { L.toggle(c.id, cb.checked); });
            lab.appendChild(cb); lab.appendChild(el('strong', '', ' ' + c.name + ' ')); lab.appendChild(el('span', '', '(global ' + c.global + ')')); row.appendChild(lab); row.appendChild(el('p', 'pg-lead', c.desc)); row.appendChild(status); w.appendChild(row);
            fetchLib(c).then(function (t) { status.textContent = 'Found ' + c.file + ' (' + (t.length / 1024).toFixed(0) + ' KB).'; }, function (e) { status.textContent = 'Not available yet: ' + String((e && e.message) || e).slice(0, 200) + '. Add the file to your site and reload this page.'; });
        });
        host.appendChild(w);
    };
})();
