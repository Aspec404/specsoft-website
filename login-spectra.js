/* Spectra on the login page: typewriter bubble, reactions, mouse parallax, success moment, Gemini voice clips.
   Voice = pre-made Gemini clips in spectra-voice-lines/. NO browser voice: if a clip fails, she stays silent and an alert shows. */
(function () {
  var D = window.SPECTRA_LOGIN, hero = document.querySelector('.sp-hero'), bub = document.querySelector('.sp-bubble'),
      line = document.getElementById('spLine'), mute = document.querySelector('.sp-mute');
  if (!D || !hero || !bub || !line) return;
  var active = function () { return hero.getClientRects().length > 0; };     // hero is hidden on phones (offsetParent is always null for position:fixed)
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var muted = false; try { muted = localStorage.getItem('sp.mute') === '1'; } catch (e) {}
  var lastAt = {}, ready = false;
  function cool(k, ms) { var n = Date.now(); if (lastAt[k] && n - lastAt[k] < ms) return false; lastAt[k] = n; return true; }
  ['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { ready = true; }, { once: true, capture: true }); });

  /* ---- alert (toast) ---- */
  var toastEl = document.createElement('div'); toastEl.className = 'sp-toast'; toastEl.setAttribute('role', 'alert'); document.body.appendChild(toastEl);
  var toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 5000); }

  /* ---- voice: Gemini clips only ---- */
  var AUD = new Audio(), expecting = '';
  AUD.preload = 'auto';
  AUD.addEventListener('error', function () {
    if (!expecting) return;
    var id = expecting; expecting = '';
    if (cool('verr', 8000)) toast("Spectra's voice isn't available right now, so she's staying quiet. (clip: " + id + ")");
  });
  function voice(id) {
    if (muted || !ready || !active()) return;
    expecting = id;
    try { AUD.pause(); AUD.src = 'spectra-voice-lines/' + id + '.wav'; AUD.currentTime = 0; } catch (e) {}
    var p = AUD.play();
    if (p && p.catch) p.catch(function (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return;   // blocked by the browser / interrupted: not an error
      if (expecting && cool('verr', 8000)) toast("Spectra's voice isn't available right now, so she's staying quiet. (clip: " + id + ")");
    });
  }

  /* ---- bubble: typewriter ---- */
  var typeT, idleT;
  function type(text) {
    clearInterval(typeT);
    if (reduce) { line.textContent = text; return; }
    var i = 0; line.textContent = '';
    typeT = setInterval(function () { i++; line.textContent = text.slice(0, i); if (i >= text.length) clearInterval(typeT); }, 26);
  }
  function say(text, id) { if (!active()) return; type(text); if (id) voice(id); idle(); }
  function sayId(id) { var v = D.voiced[id]; if (v) say(v[0], id); }
  var lastIdle = '';
  function pickIdle() { var t; do { t = D.idle[Math.floor(Math.random() * D.idle.length)]; } while (t === lastIdle && D.idle.length > 1); lastIdle = t; return t; }
  function idle() {
    clearTimeout(idleT);
    idleT = setTimeout(function () {
      if (!document.hidden && active()) {
        if (!AUD.paused && !AUD.ended) { idle(); return; }   // she's still talking: wait, don't talk over herself
        sayId(pickIdle());                                    // types the line AND speaks it
      } else idle();
    }, 11000);
  }
  var h = new Date().getHours();
  if (h < 5) { line.textContent = D.late; }
  idle();

  /* ---- reactions ---- */
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'loginPassword' && cool('pw', 25000)) sayId('pwfocus');
  });
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.type === 'password' && e.key && e.key.length === 1 && e.getModifierState && e.getModifierState('CapsLock') && cool('caps', 15000)) sayId('caps');
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-go]'); if (!b) return;
    var go = b.getAttribute('data-go');
    if (go === 'signup' && cool('su', 6000)) sayId('signup');
    else if (go === 'forgot' && cool('fg', 6000)) sayId('forgot');
  });
  var card = document.getElementById('auCard');
  if (card && window.MutationObserver) {
    var shaken = false;
    new MutationObserver(function () {
      var s = card.classList.contains('is-shake');
      if (s && !shaken && cool('wrong', 3000)) sayId('wrong');
      shaken = s;
    }).observe(card, { attributes: true, attributeFilter: ['class'] });
    var watch = function (name, fn) {
      var p = card.querySelector('[data-panel="' + name + '"]'); if (!p) return;
      new MutationObserver(function () { if (!p.hidden) fn(); }).observe(p, { attributes: true, attributeFilter: ['hidden'] });
    };
    watch('success', function () { granted(); sayId('success'); });
    watch('account', function () { sayId('account'); });
  }

  /* ---- poke Spectra (2.5s cooldown) + secret mad mode (5 quick pokes) ---- */
  var clicks = [];
  hero.addEventListener('click', function () {
    var n = Date.now(); clicks = clicks.filter(function (t) { return n - t < 4000; }); clicks.push(n);
    if (clicks.length >= 5 && cool('mad', 12000)) {
      clicks = []; hero.classList.add('sp-mad'); setTimeout(function () { hero.classList.remove('sp-mad'); }, 1000); lastAt.poke = n; sayId('mad'); return;
    }
    if (!cool('poke', 2500)) return;
    sayId(D.pokes[Math.floor(Math.random() * D.pokes.length)]);
  });

  /* ---- success moment ---- */
  function granted() {
    if (!active()) return;
    document.body.classList.remove('sp-granted-on'); void document.body.offsetWidth; document.body.classList.add('sp-granted-on');
  }

  /* ---- mute button ---- */
  function paintMute() { if (!mute) return; mute.setAttribute('aria-pressed', muted ? 'true' : 'false'); mute.textContent = muted ? 'VOICE OFF' : 'VOICE ON'; }
  if (mute) mute.addEventListener('click', function (e) {
    e.stopPropagation(); muted = !muted; try { localStorage.setItem('sp.mute', muted ? '1' : '0'); } catch (x) {}
    if (muted) { expecting = ''; try { AUD.pause(); } catch (x) {} }
    paintMute();
  });
  paintMute();

  /* ---- mouse parallax (individual `translate` property, so it stacks with the slow drift animation) ---- */
  if (!reduce) {
    var tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    addEventListener('mousemove', function (e) {
      tx = (e.clientX / innerWidth - .5) * -24; ty = (e.clientY / innerHeight - .5) * -14;
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });
    function step() {
      cx += (tx - cx) * .08; cy += (ty - cy) * .08;
      hero.style.setProperty('--sp-tx', cx.toFixed(1) + 'px'); hero.style.setProperty('--sp-ty', cy.toFixed(1) + 'px');
      raf = (Math.abs(tx - cx) > .1 || Math.abs(ty - cy) > .1) ? requestAnimationFrame(step) : 0;
    }
  }
})();
