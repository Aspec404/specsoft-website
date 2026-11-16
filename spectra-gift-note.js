/* SPECSOFT Spectra gift message: an OPTIONAL note when you send Spectra a gift.
   Add-on: it does not change spectra-bond.js. Load AFTER spectra-bond.js (and after spectra-ai.js).
   How it works: tapping "Send to Spectra" first opens a small box (Skip / Send gift). The note rides along with the real gift
   message, so it goes through the normal chat (and the same safety checks), and shows in your gift bubble. Max 140 characters. */
(function () {
  'use strict';
  const MAXN = 140;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, MAXN);
  let pending = '', pendTimer = 0, bypass = false, target = null;

  /* the note is added to the gift message when spectra-bond.js hands it to the chat */
  function wrap() {
    const C = window.SpectraChat; if (!C || typeof C.send !== 'function') return false;
    if (C.__note) return true;
    const orig = C.send;
    C.send = function (t, gift) {
      if (gift && gift.name && pending) {
        const n = pending; pending = ''; clearTimeout(pendTimer);
        t = String(t || '') + ' with a note: "' + n.replace(/"/g, "'") + '"';
        gift = Object.assign({}, gift, { note: n });
      }
      return orig.call(C, t, gift);
    };
    C.__note = 1; return true;
  }
  wrap();

  /* ---- the small box ---- */
  const ov = document.createElement('div');
  ov.className = 'sn-ov'; ov.id = 'snOv';
  ov.innerHTML = '<div class="sn-card" role="dialog" aria-modal="true" aria-labelledby="snT"><div class="sn-h"><b id="snT">Send a gift</b><button class="sn-x" type="button" aria-label="Close">\u00d7</button></div>' +
    '<div class="sn-gift"><span class="sn-ic" id="snIc"></span><div><b id="snNm"></b><small>Spectra will read your message</small></div></div>' +
    '<label class="sn-lab" for="snIn">Add a message <span>(optional)</span></label>' +
    '<textarea id="snIn" rows="3" maxlength="' + MAXN + '" placeholder="Write something nice for Spectra..."></textarea>' +
    '<div class="sn-cnt" id="snCnt">0 / ' + MAXN + '</div>' +
    '<div class="sn-row"><button type="button" class="sn-b ghost" data-skip="1">Skip</button><button type="button" class="sn-b" data-go="1">Send gift</button></div></div>';
  document.body.appendChild(ov);
  const ta = $('#snIn', ov);
  const hide = () => { ov.classList.remove('on'); target = null; };
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('.sn-x')) return hide();
    if (e.target.closest('[data-skip]')) return confirmSend('');
    if (e.target.closest('[data-go]')) return confirmSend(ta.value);
  });
  ta.addEventListener('input', () => { $('#snCnt', ov).textContent = ta.value.length + ' / ' + MAXN; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirmSend(ta.value); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('on')) { e.stopPropagation(); hide(); } }, true);

  function openBox(btn) {
    const card = btn.closest('.sb-gift');
    const nm = card && ($('.n', card) || {}).textContent, ic = card && $('.e', card);
    target = btn.dataset.send;
    $('#snNm', ov).textContent = nm || 'Gift';
    $('#snIc', ov).innerHTML = ic ? ic.innerHTML : '\ud83c\udf81';
    ta.value = ''; $('#snCnt', ov).textContent = '0 / ' + MAXN;
    ov.classList.add('on'); setTimeout(() => { try { ta.focus({ preventScroll: true }); } catch (e) { } }, 60);
  }
  function confirmSend(note) {
    const id = target; hide(); if (id == null) return;
    wrap(); pending = clean(note); clearTimeout(pendTimer); pendTimer = setTimeout(() => { pending = ''; }, 30000);
    const b = $('#sbBody [data-send="' + String(id).replace(/"/g, '') + '"]'); if (!b) { pending = ''; return; }
    bypass = true; try { b.click(); } finally { bypass = false; }       // now the real send happens
  }

  /* catch the "Send to Spectra" tap BEFORE spectra-bond.js sees it */
  document.addEventListener('click', e => {
    if (bypass) return;
    const b = e.target.closest && e.target.closest('[data-send]');
    if (!b || !b.closest('#sbBody') || b.disabled) return;
    e.stopImmediatePropagation(); e.preventDefault(); openBox(b);
  }, true);
})();
