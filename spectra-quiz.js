/* Spectra Quiz (v2: Quiz with Spectra): a multiple-choice quiz card that sits right under one of Spectra's answers (Spectra Academics "Quiz" button).
   Public API:
     SpectraQuiz.parse(raw)                 -> quiz object or null (reads the ```quiz JSON block Spectra writes)
     SpectraQuiz.mount(host, quiz, save, o) -> draws the card into host. save() is called after every tap so progress is kept.
                                               o.fresh() (optional) is called when the student taps "New quiz".
   Quiz object: { title, qs:[{ q, o:[4 options], a:correctIndex, e:explanation }], pick:[index|-1...], i:currentQuestion, done:boolean }
   Two ways to play (picked on the card's first screen and saved as Q.mode): 'solo' = Quiz normally (free, just the questions)
   and 'spectra' = Quiz with Spectra (her face, a speech bubble and her voice via SpectraVoice, explains every answer and why the wrong ones are wrong).
   Faces come from assets/spectra-academics/ (same as the video lessons). When her Gemini voice is busy / out of credits, her Spectre takes over (host.isConnected-safe, no page hooks needed).
   Her wrong-option explanations come from the quiz JSON ("x": 4 strings, one per option), so there are no extra AI calls. Old quizzes without "x" still work.
   Spectra's own mood hooks: o.onResult({ score, total, perfect }) (optional) fires when the results screen opens. */
(function () {
  'use strict';
  var LET = ['A', 'B', 'C', 'D'];
  /* her faces: the same files the video lessons use (spectra-lesson.js). Spectra reads the quiz normally; when her Gemini voice is busy,
     rate-limited or out of credits (or the free browser voice is used) her Spectre drone takes over, exactly like in the lessons. */
  var IMGDIR = 'assets/spectra-academics/';
  var SPECTRA = { idle: 'spectra-happy.webp', think: 'spectra-think.webp', right: 'spectra-excited-happy.webp', wrong: 'spectra-calm.webp', sad: 'spectra-upset.webp' };
  var SPECTRE = { idle: 'spectre-happy.webp', think: 'spectre-idea.webp', right: 'spectre-sparkle.webp', wrong: 'spectre-happy.webp', sad: 'spectre-pause.webp', boot: 'spectre-power.webp', load: 'spectre-loading.webp' };
  var SPECTRE_ON_FREE_VOICE = true;   // true: the free browser voice is read by her Spectre too (it is not Spectra's voice). false: only a busy/out Gemini voice brings the Spectre.
  var WHY = { busy: "Spectra's voice is busy, so her Spectre is reading this one.", rate: 'Too many voice requests, so her Spectre is stepping in.', daily: "You're out of credits for today. Her Spectre reads the rest for free.", off: "Spectra's voice isn't available right now, so her Spectre is reading this one." };
  /* her voice in the quiz: '' = whatever the student picked in voice settings (Gemini voice costs credits per line like Read aloud, the browser voice is free)
     'browser' = the quiz voice is always the free browser voice */
  var VOICE = { engine: '' };
  var RIGHT = ["YESSS, that's right, bro!", 'Ayy, you got it!', 'Correct! Big brain moment!', 'Nailed it, bro!', "That's it! Easy W!"];
  var OOPS = ['Ooh, so close, bro.', "Not quite, but that's okay.", 'Ahh, tricky one!', "Nope, but let's fix that together."];
  var NUDGE = ['Take your time, bro. Pick the best one!', "Ooh, this one's fun. What do you think?", 'No rush! Trust your brain.', 'You got this, bro!'];
  var SPK = '<path d="M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 010 5"/><path d="M18 7a7 7 0 010 10"/>', MUTE = '<path d="M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>';
  var svg = function (p) { return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; };
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var str = function (v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; };
  var math = function (el) {
    if (!window.renderMathInElement) return;
    try { window.renderMathInElement(el, { throwOnError: false, delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }] }); } catch (e) { }
  };
  var shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

  /* the model puts the correct option anywhere; we shuffle so the right answer is not always in the same spot */
  function mix(q) {
    var idx = shuffle([0, 1, 2, 3]);
    var r = { q: q.q, e: q.e, o: idx.map(function (k) { return q.o[k]; }), a: idx.indexOf(q.a) };
    if (q.x) r.x = idx.map(function (k) { return q.x[k]; });
    return r;
  }

  function parse(raw) {
    var t = String(raw || ''), m = t.match(/```quiz\s*([\s\S]*?)```/i), s;
    if (m) s = m[1]; else { var a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return null; s = t.slice(a, b + 1); }
    var j; try { j = JSON.parse(s); } catch (e) { return null; }
    if (!j || !Array.isArray(j.qs)) return null;
    var qs = [];
    j.qs.slice(0, 10).forEach(function (x) {
      if (!x || !Array.isArray(x.o) || x.o.length !== 4) return;
      var o = x.o.map(function (v) { return str(v, 120); }), a = +x.a, q = str(x.q, 220);
      if (!q || o.some(function (v) { return !v; }) || !(a >= 0 && a <= 3) || a % 1 !== 0) return;
      if (new Set(o.map(function (v) { return v.toLowerCase(); })).size !== 4) return;   // duplicate options = unfair question
      var xs = Array.isArray(x.x) && x.x.length === 4 ? x.x.map(function (v, k) { return k === a ? '' : str(v, 140); }) : null;
      if (xs && xs.every(function (v) { return !v; })) xs = null;
      qs.push(mix({ q: q, o: o, a: a, e: str(x.e, 300), x: xs }));
    });
    if (qs.length < 2) return null;
    return { title: str(j.title, 50) || 'Quick quiz', qs: qs, pick: qs.map(function () { return -1; }), i: 0, done: false };
  }

  function mount(host, Q, save, opt) {
    if (!host || !Q || !Q.qs) return;
    opt = opt || {};
    var N = Q.qs.length;
    if (!Array.isArray(Q.pick) || Q.pick.length !== N) Q.pick = Q.qs.map(function () { return -1; });
    if (!(Q.i >= 0 && Q.i < N)) Q.i = 0;
    try { Object.keys(SPECTRA).forEach(function (k) { new Image().src = IMGDIR + SPECTRA[k]; }); } catch (e) { }
    host.classList.add('ac-qz'); host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Quiz: ' + Q.title);
    var persist = function () { try { if (save) save(); } catch (e) { } };
    var score = function () { return Q.qs.reduce(function (n, q, k) { return n + (Q.pick[k] === q.a ? 1 : 0); }, 0); };
    var answered = function () { return Q.pick.filter(function (p) { return p >= 0; }).length; };

    var tk = 0, raf = 0, talking = false, spk = 'spectra', boot = false, ld = false, whyMsg = '', curState = 'idle';   // spk = who reads this quiz now (spectra or her Spectre)
    var voiceOn = function () { return Q.vm !== false && !!(window.SpectraVoice && window.SpectraVoice.play); };
    var clip = function (a, k) { return a[(Math.abs(k) + (Q.t || 0)) % a.length]; };
    var plain = function (t) { return String(t || '').replace(/\\\(|\\\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 600); };
    /* what she says about question k, built from the saved answer so it is the same every time you come back to it */
    var endp = function (t) { t = String(t || '').trim(); return t && !/[.!?]$/.test(t) ? t + '.' : t; };
    /* she never says the same thing twice: a sentence is dropped when nearly all of its words were already said in this line
       (the saved explanation often repeats the option text, or the "why this one is wrong" note, or itself) */
    var STOPW = /^(the|a|an|is|are|was|were|it|its|this|that|of|to|in|on|and|or|so|be|as|for|by|with|at|than|then|you|your|we|i|not|isn|t|s|here|because|which)$/;
    var wordsOf = function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(function (w) { return w && !STOPW.test(w); }); };
    function nodup(parts) {
      var said = {}, out = [];
      parts.join(' ').split(/(?<=[.!?])\s+/).forEach(function (sn) {
        sn = sn.trim(); if (!sn) return;
        var w = wordsOf(sn), seen = w.filter(function (x) { return said[x]; }).length;
        if (w.length >= 3 && seen / w.length >= 0.7) return;   // already said it
        w.forEach(function (x) { said[x] = 1; }); out.push(sn);
      });
      return out.join(' ');
    }
    var covers = function (text, opt) {   // does the explanation already contain the option's words?
      var ow = wordsOf(opt), tw = wordsOf(text); if (!ow.length) return true;
      return ow.filter(function (w) { return tw.indexOf(w) >= 0; }).length / ow.length >= 0.6;
    };
    function coach(k) {
      var q = Q.qs[k], p = Q.pick[k];
      if (p < 0) return clip(NUDGE, k);
      if (p === q.a) return nodup([clip(RIGHT, k), q.e]);
      var why = q.x && q.x[p] ? endp(q.x[p]) : '';
      return nodup([clip(OOPS, k), 'Option ' + LET[p] + " isn't it.", why, 'The better answer is ' + LET[q.a] + (q.e && covers(q.e, q.o[q.a]) ? '.' : ': ' + q.o[q.a] + '.'), q.e]);
    }
    function faceSrc(state) {
      var re = spk === 'spectre', set = re ? SPECTRE : SPECTRA, k = state;
      if (re && boot) k = 'boot'; else if (re && ld) k = 'load';
      return IMGDIR + (set[k] || set.idle);
    }
    function face(state) {
      curState = state; var re = spk === 'spectre', set = re ? SPECTRE : SPECTRA;
      return '<span class="qz-av' + (re ? ' sp' : '') + (boot ? ' boot' : '') + '" aria-hidden="true"><b>' + (re ? '\u25c9' : 'S') + '</b><img src="' + esc(faceSrc(state)) + '" data-fb="' + esc(IMGDIR + set.idle) + '" alt="" onerror="SpectraQuiz._fb(this)"></span>';
    }
    function strip(state, text, cls) {
      var on = Q.vm !== false;
      return '<div class="qz-sp">' + face(state) + '<div class="qz-bub ' + (cls || '') + '" data-say role="status"><em class="qz-nm">' + (spk === 'spectre' ? 'Spectre' : 'Spectra') + '</em><span>' + esc(text) + '</span>' + (whyMsg && spk === 'spectre' ? '<small class="qz-nt">' + esc(whyMsg) + '</small>' : '') + '</div><button type="button" class="qz-vb" data-vm aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + (on ? 'Turn her voice off' : 'Turn her voice on') + '" title="' + (on ? 'Her voice is on' : 'Her voice is off') + '">' + svg(on ? SPK : MUTE) + '</button></div>';
    }
    function paintWho() {   // swap the face / name / note in place (no redraw, so the bubble does not flicker)
      var sp = host.querySelector('.qz-sp'); if (!sp) return;
      var av = sp.querySelector('.qz-av'), t = document.createElement('div'); t.innerHTML = face(curState);
      if (av && t.firstChild) av.parentNode.replaceChild(t.firstChild, av);
      var nm = sp.querySelector('.qz-nm'); if (nm) nm.textContent = spk === 'spectre' ? 'Spectre' : 'Spectra';
      var bub = sp.querySelector('.qz-bub'), old = bub && bub.querySelector('.qz-nt'); if (old) old.remove();
      if (bub && whyMsg && spk === 'spectre') { var s = document.createElement('small'); s.className = 'qz-nt'; s.textContent = whyMsg; bub.appendChild(s); }
    }
    /* her Spectre: the voice layer calls this before every line (same idea as the lesson player) */
    function takeover(who, why) {
      if (!host.isConnected) return;
      if (who !== 'spectre') { if (spk === 'spectre') { spk = 'spectra'; whyMsg = ''; paintWho(); } return; }   // a clip already loaded in Spectra's voice: she is back
      if (spk === 'spectre') return;
      if (why === 'chosen' && !SPECTRE_ON_FREE_VOICE) return;
      spk = 'spectre'; boot = true; whyMsg = why !== 'chosen' ? (WHY[why] || WHY.busy) : '';
      try { Object.keys(SPECTRE).forEach(function (k) { new Image().src = IMGDIR + SPECTRE[k]; }); } catch (e) { }
      paintWho();
      var m = whyMsg; if (m) setTimeout(function () { if (whyMsg === m) { whyMsg = ''; paintWho(); } }, 5600);
      return new Promise(function (r) { setTimeout(function () { boot = false; paintWho(); r(); }, 1150); });   // the voice waits for the boot-up
    }
    function pulse() {
      raf = 0; if (!talking) return;
      if (!host.isConnected) { talking = false; try { window.SpectraVoice.stop(); } catch (e) { } return; }
      var av = host.querySelector('.qz-av'), l = null; try { l = window.SpectraVoice.level(); } catch (e) { }
      if (av) av.style.setProperty('--lv', l == null ? 0 : l.toFixed(2));
      raf = requestAnimationFrame(pulse);
    }
    function hush() {   // she stops talking (new question, new screen, voice turned off)
      tk++; ld = false; if (talking) { talking = false; try { window.SpectraVoice.stop(); } catch (e) { } }
      var av = host.querySelector('.qz-av'); if (av) av.style.setProperty('--lv', 0);
    }
    var lastT = '', lastAt = 0;
    function say(text, mood) {
      if (!voiceOn()) return;
      var now = Date.now(); if (text === lastT && now - lastAt < 900) return; lastT = text; lastAt = now;
      var id = ++tk, V = window.SpectraVoice;
      var o = { speaker: spk === 'spectre' ? 'spectre' : 'auto', onWho: takeover, onStart: function () { if (id === tk && ld) { ld = false; if (spk === 'spectre') paintWho(); } } };
      if (VOICE.engine) o.engine = VOICE.engine;
      try { V.prime && V.prime(); } catch (e) { }
      talking = true; ld = true; if (spk === 'spectre') paintWho(); if (!raf) raf = requestAnimationFrame(pulse);
      var end = function () { if (id === tk) { talking = false; ld = false; var av = host.querySelector('.qz-av'); if (av) av.style.setProperty('--lv', 0); if (spk === 'spectre') paintWho(); } };
      V.play('[mood:' + mood + '] ' + plain(text), o).then(end, end);
    }
    function chosen(ix) {   // one answer tapped
      if (Q.pick[Q.i] >= 0) return;
      Q.pick[Q.i] = ix; persist(); draw('.qz-bt.pri');
      if (Q.mode === 'spectra') { var good = ix === Q.qs[Q.i].a; say(coach(Q.i), good ? 'sparkle' : 'love'); var b = host.querySelector('.qz-sp'); if (b) { try { b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (er) { } } }
    }

    function picker() {
      return head() + '<div class="qz-pk">' + strip('idle', 'Quiz time, bro! How do you wanna play it?') + '<div class="qz-mds">' +
        '<button type="button" class="qz-md pri" data-md="spectra"><b>Quiz with Spectra</b><small>She talks to you out loud and explains every answer, including why the wrong ones are wrong. A Gemini voice uses credits like Read aloud, the browser voice is free.</small></button>' +
        '<button type="button" class="qz-md" data-md="solo"><b>Quiz normally</b><small>Free and solo. Just you and the questions.</small></button></div></div>';
    }

    function head(right) {
      return '<div class="qz-h"><span class="qz-b"><i></i>Quiz</span><span class="qz-t">' + esc(Q.title) + '</span>' + (right || '') + '</div>';
    }

    function question() {
      var q = Q.qs[Q.i], p = Q.pick[Q.i], did = p >= 0, last = Q.i === N - 1;
      var h = head('<em class="qz-c" aria-live="polite">' + (Q.i + 1) + '/' + N + '</em>');
      h += '<div class="qz-p" aria-hidden="true"><i style="width:' + Math.round((answered() / N) * 100) + '%"></i></div>';
      h += '<div class="qz-q">' + esc(q.q) + '</div><div class="qz-os">';
      q.o.forEach(function (o, k) {
        var c = 'qz-o';
        if (did) c += k === q.a ? ' ok' : k === p ? ' bad' : ' dim';
        h += '<button type="button" class="' + c + '" data-o="' + k + '"' + (did ? ' disabled' : '') + '><span class="qz-l">' + LET[k] + '</span><span class="qz-x">' + esc(o) + '</span></button>';
      });
      h += '</div>';
      if (Q.mode === 'spectra') h += strip(!did ? 'think' : p === q.a ? 'right' : 'wrong', coach(Q.i), !did ? '' : p === q.a ? 'ok' : 'bad');
      else if (did) {
        var good = p === q.a;
        h += '<div class="qz-e ' + (good ? 'ok' : 'bad') + '" role="status"><b>' + (good ? 'Nice, that is right!' : 'Not quite.') + '</b>' + (good ? '' : ' The answer is <u>' + LET[q.a] + '</u>.') + (q.e ? ' <span>' + esc(q.e) + '</span>' : '') + '</div>';
      }
      h += '<div class="qz-n"><button type="button" class="qz-bt" data-n="p"' + (Q.i === 0 ? ' disabled' : '') + '>\u00ab Previous</button>';
      h += last ? '<button type="button" class="qz-bt pri" data-n="f"' + (did ? '' : ' disabled') + '>Finish</button>' : '<button type="button" class="qz-bt pri" data-n="n">Next \u00bb</button>';
      h += '</div>';
      return h;
    }

    function results() {
      var sc = score(), pc = Math.round((sc / N) * 100), perfect = sc === N;
      var msg = perfect ? 'PERFECT! Every single one, bro!' : pc >= 80 ? 'So close to perfect, nice work!' : pc >= 50 ? 'Not bad! A little review and you got it.' : 'Rough round, but that is how you learn. Try again!';
      var h = head('<em class="qz-c">Done</em>');
      if (Q.mode === 'spectra') h += strip(pc >= 80 ? 'right' : pc >= 50 ? 'idle' : 'sad', msg + ' Tap a question below to go over it.', pc >= 80 ? 'ok' : '');
      h += '<div class="qz-r"><div class="qz-ring" style="--pc:' + pc + '"><b>' + sc + '<small>/' + N + '</small></b></div><div class="qz-rt"><strong>' + (Q.mode === 'spectra' ? sc + ' out of ' + N : esc(msg)) + '</strong><span>' + pc + '% correct</span></div></div>';
      h += '<div class="qz-rv">';
      Q.qs.forEach(function (q, k) {
        var ok = Q.pick[k] === q.a;
        h += '<button type="button" class="qz-ri ' + (ok ? 'ok' : 'bad') + '" data-g="' + k + '"><i>' + (ok ? '\u2713' : '\u2717') + '</i><span>' + esc(q.q) + '</span></button>';
      });
      h += '</div><div class="qz-n"><button type="button" class="qz-bt" data-n="r">Try again</button>' + (opt.fresh ? '<button type="button" class="qz-bt pri" data-n="x">New quiz</button>' : '<button type="button" class="qz-bt pri" data-n="v">Review</button>') + '</div>';
      return h;
    }

    var announced = false;
    function draw(focus) {
      host.innerHTML = Q.done ? results() : !Q.mode ? picker() : question();
      math(host);
      if (Q.done && !announced) { announced = true; try { if (opt.onResult) opt.onResult({ score: score(), total: N, perfect: score() === N }); } catch (e) { } }
      if (!Q.done) announced = false;
      if (focus) { var f = host.querySelector(focus); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { } } }
    }

    host.onclick = function (e) {
      var o = e.target.closest('[data-o]'), n = e.target.closest('[data-n]'), g = e.target.closest('[data-g]'), md = e.target.closest('[data-md]'), vm = e.target.closest('[data-vm]'), sy = e.target.closest('[data-say]');
      if (md) {
        Q.mode = md.dataset.md === 'spectra' ? 'spectra' : 'solo'; persist(); draw('.qz-o');
        if (Q.mode === 'spectra') say("Hey bro, quiz time! " + N + ' questions. Pick your answer and I will explain every single one.', 'joy');
        return;
      }
      if (vm) { Q.vm = Q.vm === false; persist(); if (Q.vm === false) hush(); draw(); if (Q.vm !== false) say(coach(Q.done ? 0 : Q.i), 'joy'); return; }
      if (sy && Q.mode === 'spectra' && !Q.done) { say(coach(Q.i), Q.pick[Q.i] >= 0 && Q.pick[Q.i] === Q.qs[Q.i].a ? 'sparkle' : 'love'); return; }
      if (o && !o.disabled) { chosen(+o.dataset.o); return; }
      if (g) { hush(); Q.done = false; Q.i = +g.dataset.g; persist(); draw(); host.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (!n) return;
      var k = n.dataset.n; hush();
      if (k === 'n' && Q.i < N - 1) Q.i++;
      else if (k === 'p' && Q.i > 0) Q.i--;
      else if (k === 'f') { if (Q.pick[Q.i] < 0) return; Q.done = true; if (Q.mode === 'spectra') { var sc2 = score(), pc2 = Math.round(sc2 / N * 100); persist(); draw(); say((sc2 === N ? 'PERFECT! Every single one, bro!' : pc2 >= 80 ? 'So close to perfect, nice work!' : pc2 >= 50 ? 'Not bad! A little review and you got it.' : 'Rough round, but that is how you learn. Try again!') + ' You got ' + sc2 + ' out of ' + N + '.', sc2 === N ? 'sparkle' : pc2 >= 50 ? 'joy' : 'love'); return; } }
      else if (k === 'r') { Q.pick = Q.qs.map(function () { return -1; }); Q.i = 0; Q.done = false; Q.t = (Q.t || 0) + 1; Q.qs = Q.qs.map(mix); if (Q.mode === 'spectra') { persist(); draw(); say('Round two! Let us go, bro!', 'sparkle'); return; } }
      else if (k === 'v') { Q.done = false; Q.i = 0; }
      else if (k === 'x') { if (opt.fresh) opt.fresh(); return; }
      persist(); draw(); try { host.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (er) { }
    };
    /* keyboard: 1-4 / A-D pick an option, arrows move between questions */
    host.tabIndex = -1;
    host.onkeydown = function (e) {
      if (Q.done || !Q.mode || e.altKey || e.ctrlKey || e.metaKey) return;
      var k = e.key.toLowerCase(), ix = ['1', '2', '3', '4'].indexOf(k); if (ix < 0) ix = ['a', 'b', 'c', 'd'].indexOf(k);
      if (ix >= 0 && Q.pick[Q.i] < 0) { e.preventDefault(); chosen(ix); }
      else if (e.key === 'ArrowRight' && Q.i < N - 1) { e.preventDefault(); hush(); Q.i++; persist(); draw(); }
      else if (e.key === 'ArrowLeft' && Q.i > 0) { e.preventDefault(); hush(); Q.i--; persist(); draw(); }
    };
    draw();
  }

  /* a face that will not load falls back to her happy face once, then to the plain badge */
  function fb(img) { if (!img || img.dataset.f || !img.dataset.fb) { if (img) img.remove(); return; } img.dataset.f = '1'; img.src = img.dataset.fb; }

  window.SpectraQuiz = { parse: parse, mount: mount, _fb: fb };
})();
