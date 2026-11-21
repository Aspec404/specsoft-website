/* Spectra Pet: a tiny transparent Spectra chibi that rests on top of the chat box.
   Type  /spectra-pet         in the chat box and press send: she hops in and rests on the box (and it is remembered on this device)
   Type  spectra-pet remove   (or /spectra-pet remove): she waves bye and goes away.
   She jumps when you tap her, when you send a message, and now and then by herself.
   Self-contained: it only listens to the chat box, so spectra-academics.js does not need any change.
   Files (same folder as her faces): assets/spectra-academics/spectra-pet.png (resting) and spectra-pet-jump.gif (the jump, one loop = 1.12 s) */
(function () {
  'use strict';
  var KEY = 'sa.acad.pet', DIR = 'assets/spectra-academics/', PNG = DIR + 'spectra-pet.png?v=1', GIF = DIR + 'spectra-pet-jump.gif?v=1', JUMP_MS = 1160;
  var CMD = /^\/?spectra-pet(?:\s+(remove|off|hide))?$/i;
  var pet = null, img = null, jumpT = 0, idleT = 0;
  var reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }
  var $ = function (id) { return document.getElementById(id); };
  var toast = function (t) { try { if (window.SpectraAcad && window.SpectraAcad.toast) window.SpectraAcad.toast(t); } catch (e) { } };
  var keep = function (on) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { } };

  function mk(src, onerr) { var i = new Image(); i.alt = ''; i.draggable = false; i.decoding = 'async'; if (onerr) i.onerror = onerr; i.src = src; return i; }
  /* a fresh <img> every time, so the gif always starts from its first frame */
  function put(i) { if (!pet) return; if (img && img.parentNode === pet) pet.replaceChild(i, img); else pet.appendChild(i); img = i; }
  function rest() { put(mk(PNG, function () { put(mk(GIF)); })); }   // no png yet? the gif loops as her resting pose
  function jump() {
    if (!pet) return;
    clearTimeout(jumpT); put(mk(GIF));
    jumpT = setTimeout(function () { if (pet) rest(); }, JUMP_MS);
  }
  function schedule() {   // a little hop every 20 to 45 seconds while the page is open
    clearTimeout(idleT); if (!pet || reduce) return;
    idleT = setTimeout(function () { if (pet && !document.hidden && pet.offsetParent) jump(); schedule(); }, 20000 + Math.random() * 25000);
  }

  function show(quiet) {
    var comp = $('comp'); if (!comp) return false;
    if (pet && pet.parentNode === comp) { if (!quiet) { jump(); toast('Spectra is already hanging out here'); } return true; }
    pet = document.createElement('div'); pet.className = 'sp-pet'; pet.id = 'spPet'; pet.setAttribute('aria-hidden', 'true');
    pet.addEventListener('click', function () { jump(); });
    comp.appendChild(pet); img = null; keep(true);
    try { new Image().src = GIF; } catch (e) { }
    if (quiet) rest(); else { jump(); toast('Spectra Pet is here!'); }
    schedule(); return true;
  }
  function remove() {
    if (!pet) { toast('There is no Spectra Pet to remove'); return; }
    var p = pet; pet = null; img = null; clearTimeout(jumpT); clearTimeout(idleT); keep(false);
    p.classList.add('out'); setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 260);
    toast('Spectra Pet removed. Type /spectra-pet to bring her back.');
  }

  /* the chat box command: Enter or the send button. The line is eaten, it never goes to Spectra. */
  function run(text) {
    var m = CMD.exec(String(text || '').trim()); if (!m) return false;
    if (m[1]) remove(); else show(false);
    var i = $('in'); if (i) { i.value = ''; try { i.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { } }
    return true;
  }
  document.addEventListener('keydown', function (e) {
    var t = e.target; if (!t || t.id !== 'in' || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (run(t.value)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    else if (pet && t.value.trim()) setTimeout(jump, 150);   // she cheers when you send something
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('#sd'); if (!b) return;
    var i = $('in'); if (!i) return;
    if (run(i.value)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    else if (pet && i.value.trim()) setTimeout(jump, 150);
  }, true);

  var on = false; try { on = localStorage.getItem(KEY) === '1'; } catch (e) { }
  if (on) show(true);
  window.SpectraPet = { show: function () { return show(false); }, remove: remove };
})();
