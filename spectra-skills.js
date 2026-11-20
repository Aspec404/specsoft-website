/* SPECSOFT® Spectra Skills & Capabilities (v1) for Spectra Academics.
   Capabilities = what she can do (up to 3 at once). Skills = how she teaches (only 1 at a time, "None" is the default).
   The page only stores ids in localStorage ('sa.acad.eq'); the real instructions live on the server (spectra-chat index.ts),
   so a choice cannot be faked from the browser. API: SpectraEquip.get(), SpectraEquip.open() */
(function () {
'use strict';
const KEY = 'sa.acad.eq', MAXC = 3;
const ico = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
const P = {
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h4',
  pdf: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M12 11v6M9 14l3 3 3-3',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4', split: 'M4 5h16v14H4zM12 5v14',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.5a2.5 2.5 0 114 2c-.8.6-1.5 1-1.5 2M12 17h.01',
  chat: 'M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  people: 'M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.9M16 4.1a3.5 3.5 0 010 6.8',
  none: 'M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8', chev: 'M9 6l6 6-6 6'
};
const SKILLS = [
  { id: 'socratic', n: 'Socratic Tutor', short: 'Socratic', ic: P.help, d: 'She never gives the final answer. She breaks the problem down and asks one guiding question at a time until you solve it.' },
  { id: 'feynman', n: 'Feynman Check', short: 'Feynman', ic: P.chat, d: 'You explain the topic in simple everyday words. She listens for jargon, gaps and hand-waving, then asks sharp follow-ups.' },
  { id: 'hints', n: 'Step by Step Hint', short: 'Hints', ic: P.bulb, d: 'Tiered help when you are stuck: a subtle nudge, then a structural hint, and a worked example only as a last resort.' },
  { id: 'diagnose', n: 'Error Diagnosis', short: 'Diagnosis', ic: P.search, d: 'Wrong answer or buggy code? She finds out why (concept, method or careless slip) instead of just showing the fix.' },
  { id: 'roleplay', n: 'Roleplay Immersion', short: 'Roleplay', ic: P.people, d: 'Practice inside a real scenario (ordering food in Tokyo, a job interview, a server outage) with gentle fixes without breaking character.' }
];
const CAPS = [
  { id: 'viz', n: 'Inline Visualizations', ic: P.chart, d: 'Draws interactive shapes and graphs inside her answers.' },
  { id: 'dev', n: 'Developer Mode', ic: P.code, d: 'Code-first answers: clean examples, why it works, edge cases and common bugs.' },
  { id: 'docs', n: 'Document Analysis', ic: P.file, d: 'Attach a file or paste a text and she summarizes it, pulls key points and flags gaps.' },
  { id: 'pdf', n: 'Write PDF', ic: P.pdf, d: 'Turns her answers into clean documents and adds a PDF button under each answer to save it.' },
  { id: 'web', n: 'Web Search & Live URL Reader', ic: P.globe, d: 'Paste a link and she reads that page, then teaches from it (+1 credit when a link is read). Plain Web Search lives in Tools.' },
  { id: 'stepper', n: 'Math & LaTeX Interactive Stepper', ic: P.sliders, d: 'Clean math with sliders: drag a variable and the equation (and graph) rewrites itself, one step at a time.' },
  { id: 'canvas', n: 'Persistent Canvas', ic: P.split, d: 'Long writing or code opens in a side-by-side editor. Edit it by hand, flip between versions, copy, download or save as PDF.' }
];
const AVAIL = CAPS.filter(c => !c.soon).map(c => c.id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = m => { if (window.SpectraAcad && window.SpectraAcad.toast) window.SpectraAcad.toast(m); };

function get() {
  let v = null; try { v = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
  if (!v || typeof v !== 'object') v = { skill: '', caps: ['viz'] };   // fresh start: skill None, Inline Visualizations on (that is how Academics already behaved)
  return {
    skill: SKILLS.some(s => s.id === v.skill) ? v.skill : '',
    caps: (Array.isArray(v.caps) ? v.caps : []).filter((c, i, a) => AVAIL.includes(c) && a.indexOf(c) === i).slice(0, MAXC)
  };
}
function put(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { } }

/* badge on the chatbox + the row in the Tools menu */
function refresh() {
  const e = get(), sk = SKILLS.find(s => s.id === e.skill);
  const b = document.getElementById('eqb');
  if (b) { b.hidden = !sk; if (sk) { b.querySelector('span').textContent = sk.short; b.title = 'Skill: ' + sk.n + ' (tap to change)'; } }
  const s = document.getElementById('eqs'); if (s) s.textContent = 'Capabilities ' + e.caps.length + '/' + MAXC + ' \u00b7 Skill: ' + (sk ? sk.short : 'None');
}

/* sheet */
let el = null;
const slots = (k, max) => Array.from({ length: max }, (_, i) => '<i' + (i < k ? ' class="on"' : '') + '></i>').join('');
function render() {
  const e = get(), n = e.caps.length, full = n >= MAXC;
  const caps = CAPS.map(c => {
    const on = e.caps.includes(c.id);
    return '<button type="button" class="eq-it' + (on ? ' on' : '') + (c.soon ? ' soon' : '') + (!on && full && !c.soon ? ' full' : '') + '" data-cap="' + c.id + '" role="switch" aria-checked="' + on + '"' + (c.soon ? ' disabled' : '') + '>' +
      '<span class="eq-ic">' + ico(c.ic) + '</span><span class="eq-tx"><b>' + esc(c.n) + (c.soon ? '<em>Soon</em>' : '') + '</b><small>' + esc(c.d) + '</small></span>' + (c.soon ? '' : '<span class="eq-sw"><i></i></span>') + '</button>' +
      (c.id === 'canvas' && on && (e.skill === 'socratic' || e.skill === 'hints') ? '<div class="eq-note">Paused while ' + (e.skill === 'socratic' ? 'Socratic Tutor' : 'Step by Step Hint') + ' is on. You can still open and edit canvases by hand.</div>' : '');
  }).join('');
  const skills = [{ id: '', n: 'None', ic: P.none, d: 'Normal Spectra teaching. This is the default.' }].concat(SKILLS).map(s => {
    const on = e.skill === s.id;
    let extra = '';
    if (on && s.id === 'socratic') extra = '<div class="eq-note">Video, Flashcards and Canvas are switched off while Socratic Tutor is on, because they would show the answer.</div>';
    if (on && s.id === 'hints') extra = '<div class="eq-note">Persistent Canvas is switched off while Step by Step Hint is on, because it would show the whole answer.</div>';
    if (on && s.id === 'roleplay' && !e.caps.includes('dev') && !full) extra = '<div class="eq-note">Tip: pair it with Developer Mode for coding scenarios like a production outage.</div>';
    return '<button type="button" class="eq-it eq-sk' + (on ? ' on' : '') + '" data-skill="' + s.id + '" role="radio" aria-checked="' + on + '"><span class="eq-ic">' + ico(s.ic) + '</span><span class="eq-tx"><b>' + esc(s.n) + '</b><small>' + esc(s.d) + '</small></span><span class="eq-rd"><i></i></span></button>' + extra;
  }).join('');
  el.querySelector('.eq-body').innerHTML =
    '<section><div class="eq-sh"><div><b>Capabilities</b><small>What she can do. Up to ' + MAXC + ' at once.</small></div><span class="eq-slots" id="eqsl" aria-label="' + n + ' of ' + MAXC + ' slots used">' + slots(n, MAXC) + '<em>' + n + '/' + MAXC + '</em></span></div><div class="eq-list">' + caps + '</div></section>' +
    '<section><div class="eq-sh"><div><b>Skills</b><small>How she teaches. Only 1 at a time, because skills would clash.</small></div><span class="eq-slots" aria-label="' + (e.skill ? 1 : 0) + ' of 1 slot used">' + slots(e.skill ? 1 : 0, 1) + '<em>' + (e.skill ? 1 : 0) + '/1</em></span></div><div class="eq-list" role="radiogroup" aria-label="Skill">' + skills + '</div></section>';
}
function change(fn) {
  const before = get(), after = fn(JSON.parse(JSON.stringify(before)));
  if (!after) return; put(after); render(); refresh();
  if (window.SpectraCanvas && window.SpectraCanvas.refresh) window.SpectraCanvas.refresh();   // the Rewrite bar hides or comes back
  if (((before.skill === 'socratic') !== (after.skill === 'socratic') || before.caps.includes('pdf') !== after.caps.includes('pdf')) && window.SpectraAcad && window.SpectraAcad.redraw) window.SpectraAcad.redraw();   // Video / Flashcards buttons grey out or come back, PDF button shows or hides
}
function key(e) { if (e.key === 'Escape' && el) { e.preventDefault(); close(); } }
function close() { document.removeEventListener('keydown', key, true); if (el) el.remove(); el = null; }
function open() {
  close();
  el = document.createElement('div'); el.className = 'eq';
  el.innerHTML = '<div class="eq-card" role="dialog" aria-modal="true" aria-label="Skills and Capabilities"><header class="eq-h"><b>Skills &amp; Capabilities</b><button type="button" class="eq-x" aria-label="Close">\u00d7</button></header><div class="eq-body"></div></div>';
  render(); document.body.appendChild(el); document.addEventListener('keydown', key, true);
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('.eq-x')) return close();
    const c = e.target.closest('[data-cap]'), s = e.target.closest('[data-skill]');
    if (c) {
      const id = c.dataset.cap;
      change(v => {
        if (v.caps.includes(id)) v.caps = v.caps.filter(x => x !== id);
        else if (v.caps.length >= MAXC) { const sl = document.getElementById('eqsl'); if (sl) { sl.classList.remove('shake'); void sl.offsetWidth; sl.classList.add('shake'); } toast('All ' + MAXC + ' capability slots are used. Turn one off first.'); return null; }
        else v.caps.push(id);
        return v;
      });
    } else if (s) change(v => { if (v.skill === s.dataset.skill) return null; v.skill = s.dataset.skill; return v; });
  });
  const f = el.querySelector('.eq-x'); if (f) f.focus();
}

/* hook up the badge and the Tools menu row */
const ci = document.querySelector('.eqo-c'); if (ci) ci.innerHTML = ico(P.chev);
const oi = document.querySelector('.eqo-i'); if (oi) oi.innerHTML = ico(P.bulb);
const bi = document.querySelector('#eqb i'); if (bi) bi.setAttribute('aria-hidden', 'true');
const o = document.getElementById('eqo'); if (o) o.addEventListener('click', () => { const p = document.getElementById('pop'); if (p) p.classList.remove('open'); open(); });
const b = document.getElementById('eqb'); if (b) b.addEventListener('click', open);
refresh();
window.SpectraEquip = { get, open, close, refresh };
})();
