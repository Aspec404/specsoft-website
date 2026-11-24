/* SPECSOFT® Spectra Academics Voice Chat v1: talk to Spectra out loud, she talks back and her face changes with her mood.
   Flow: mic (browser speech recognition) -> your words go through the normal Academics chat (saved in your chat history, same credits) ->
   her reply is read by SpectraVoice (Gemini voice, browser voice as backup) while her expression follows the [mood:xxx] tag.
   Load AFTER spectra-academics.js. Needs spectra-voice.js (already on the page) and spectra-voicechat.css. */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ---------- her faces: same files and mood map as the video lesson (spectra-lesson.js), folder assets/spectra-academics/ ---------- */
const DIR = 'assets/spectra-academics/', PFP = 'assets/spectra/spectra-academics/spectra-happy.webp';
const IMG = { think: DIR + 'spectra-think.webp', calm: DIR + 'spectra-calm.webp', happy: DIR + 'spectra-happy.webp', upset: DIR + 'spectra-upset.webp' };
const FACE = { joy: 'happy', sparkle: 'happy', love: 'happy', smug: 'happy', shy: 'happy', thinking: 'think', confused: 'think', deadpan: 'think', speechless: 'think', sleepy: 'think',
  surprised: 'calm', shocked: 'calm', calm: 'calm', listening: 'calm', sad: 'upset', annoyed: 'upset', grumpy: 'upset', pout: 'upset' };
/* her Spectre (sphere drone): reads for her when her voice is busy / out of credits / the free browser voice is used */
const SP = { power: 'spectre-power.webp', happy: 'spectre-happy.webp', sparkle: 'spectre-sparkle.webp', idea: 'spectre-idea.webp', loading: 'spectre-loading.webp', pause: 'spectre-pause.webp' };
const SPM = { sparkle: 'sparkle', surprised: 'sparkle', shocked: 'sparkle', thinking: 'idea', confused: 'idea' };   // mood -> Spectre face (everything else = happy)
const WHY = { busy: "Spectra's voice is busy, so her Spectre is reading this one.", rate: 'Too many voice requests, so her Spectre is stepping in.', daily: "You're out of credits for today. Her Spectre reads the rest for free.", off: "Spectra's voice isn't available right now, so her Spectre is reading this one." };
const MOODS = Object.keys(FACE).filter(m => m !== 'calm' && m !== 'listening');
const HINT = '\n\n[VOICE CHAT: the student is talking to you out loud and your reply will be read aloud. Reply in 1 to 4 short spoken sentences, plain talking words only: no markdown, no lists, no headings, no LaTeX or symbols (say "x squared", "one half"), no code blocks. Start your reply with exactly one tag, [mood:' + MOODS.join('|') + '], that fits what you are about to say, then talk like Spectra. If the topic needs a long answer, give the short version and ask if they want more.]';

const DEF = { lang: 'en-US', auto: true };
let cfg = Object.assign({}, DEF, LS('sa.acad.vc', {}) || {});
let on = false, state = 'idle', muted = false, rec = null, lastRaw = '', gen = 0, raf = 0, wake = null, shownUrl = '', curMood = 'calm', who = 'spectra', boot = false;

/* ---------- mood helpers ---------- */
function readMood(raw) { const m = /^\s*\[mood:(\w+)\]/i.exec(String(raw || '')); const k = m && m[1].toLowerCase(); return k && FACE[k] ? k : ''; }
function guessMood(t) {   // backup when the server did not send a tag
  t = String(t || '');
  if (/😭|🥺|😢|sorry|sad|miss/i.test(t)) return 'sad';
  if (/😂|🤣|💀|haha|lol|lmao/i.test(t)) return 'joy';
  if (/😡|😤|ugh|annoy|seriously\?/i.test(t)) return 'annoyed';
  if (/😳|🥰|aww|shy|thank/i.test(t)) return 'shy';
  if (/😮|😱|omg|wow|no way|whoa/i.test(t)) return 'surprised';
  if (/🤔|hmm|let me think|let's see/i.test(t)) return 'thinking';
  if (/😏|obviously|easy/i.test(t)) return 'smug';
  if (/\?\s*$/.test(t)) return 'confused';
  if (/!|✨|🎉|great|nice|good job|correct/i.test(t)) return 'joy';
  return 'calm';
}
function plainText(raw) {   // what to show on screen (no tags, no markdown)
  return String(raw || '').replace(/\[(mood|remember):[^\]]*\]/gi, '').replace(/\[GIFT OFFER\]/gi, '').replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1').replace(/[*_~`#>]+/g, '').replace(/\s+/g, ' ').trim();
}

/* ---------- UI ---------- */
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4"/></svg>';
const MICOFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4M4 4l16 16"/></svg>';
const WAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>';
const XI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15c4-4 12-4 16 0l-2 3-3-1.5v-2.3a9 9 0 00-6 0v2.3L6 18z"/></svg>';

let ov, imgA, imgB, stEl, meEl, aiEl, muteB, avEl, whyEl;
function build() {
  if (ov) return;
  ov = document.createElement('div'); ov.className = 'vc'; ov.hidden = true; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Voice chat with Spectra');
  ov.innerHTML = '<div class="vc-bg"></div>' +
    '<div class="vc-top"><b>Voice chat</b><select class="vc-lang" aria-label="Language"><option value="en-US">English (US)</option><option value="en-PH">English (PH)</option><option value="fil-PH">Filipino / Taglish</option><option value="en-GB">English (UK)</option></select>' +
    '<button class="vc-x" type="button" aria-label="Close voice chat">' + XI + '</button></div>' +
    '<div class="vc-stage"><div class="vc-ring r1"></div><div class="vc-ring r2"></div><button class="vc-av" type="button" aria-label="Tap to interrupt Spectra"><img class="a on" alt=""><img class="b" alt=""></button></div>' +
    '<div class="vc-st" role="status" aria-live="polite"></div><div class="vc-why" aria-live="polite"></div>' +
    '<div class="vc-cap"><p class="me"></p><p class="ai"></p></div>' +
    '<div class="vc-ctl"><button class="vc-b vc-mute" type="button" aria-label="Mute mic">' + MIC + '</button><button class="vc-b vc-end" type="button" aria-label="End voice chat">' + PHONE + '</button></div>' +
    '<div class="vc-tip">Tap Spectra to interrupt her</div>';
  document.body.appendChild(ov);
  imgA = ov.querySelector('.a'); imgB = ov.querySelector('.b'); stEl = ov.querySelector('.vc-st'); meEl = ov.querySelector('.me'); aiEl = ov.querySelector('.ai');
  muteB = ov.querySelector('.vc-mute'); avEl = ov.querySelector('.vc-av'); whyEl = ov.querySelector('.vc-why');
  [imgA, imgB].forEach(i => { i.onerror = () => { if (i.dataset.f) return; i.dataset.f = '1'; i.src = who === 'spectre' ? DIR + SP.happy : PFP; }; });
  const lg = ov.querySelector('.vc-lang'); lg.value = cfg.lang; lg.onchange = () => { cfg.lang = lg.value; SS('sa.acad.vc', cfg); if (state === 'listening') { stopRec(); listen(); } };
  ov.querySelector('.vc-x').onclick = ov.querySelector('.vc-end').onclick = close;
  muteB.onclick = () => { muted = !muted; muteB.innerHTML = muted ? MICOFF : MIC; muteB.classList.toggle('off', muted); if (muted) { stopRec(); if (state === 'listening') setState('muted'); } else if (state === 'muted') listen(); };
  avEl.onclick = () => { if (state === 'speaking') { gen++; if (window.SpectraVoice) SpectraVoice.stop(); state = 'idle'; listen(); } };
  document.addEventListener('keydown', e => { if (on && e.key === 'Escape') close(); });
}

function show(url) {   // crossfade to another picture
  if (!url || url === shownUrl) return; shownUrl = url;
  const [a, b] = imgA.classList.contains('on') ? [imgB, imgA] : [imgA, imgB];
  a.dataset.f = ''; a.src = url; a.classList.add('on'); b.classList.remove('on');
}
function spWant() {   // which Spectre face fits right now (same idea as the lesson)
  if (boot) return 'power';
  if (ov.dataset.ld === '1' || state === 'thinking') return 'loading';
  if (state === 'muted') return 'pause';
  if (state === 'speaking') return SPM[curMood] || 'happy';
  return 'happy';
}
function render() {
  if (!ov) return; const f = FACE[curMood] || 'calm';
  ov.dataset.who = who; ov.dataset.f = f; ov.dataset.m = curMood; ov.toggleAttribute('data-boot', boot);
  show(who === 'spectre' ? DIR + SP[spWant()] : IMG[f]);
}
function setMood(m) { curMood = m || 'calm'; render(); }
const LABEL = { listening: 'Listening...', thinking: 'Thinking...', speaking: 'Spectra is talking', muted: 'Mic is muted', idle: '' };
function setState(s) {
  state = s; ov.dataset.s = s; stEl.textContent = (who === 'spectre' && s === 'speaking') ? 'Spectre is talking' : (LABEL[s] || '');
  if (s === 'listening') setMood('listening'); else if (s === 'thinking') setMood('thinking'); else render();
}
/* her Spectre takes over (called by SpectraVoice before every line). Resolves after the boot-up so the voice waits for it. */
function takeover(w, why) {
  if (!ov) return;
  if (w !== 'spectre') { if (who === 'spectre') { who = 'spectra'; boot = false; render(); } return; }   // a clip already loaded in Spectra's voice: she is back
  if (who === 'spectre') return;   // sticky for this call
  who = 'spectre'; boot = true; render();
  if (why !== 'chosen') { whyEl.textContent = WHY[why] || WHY.busy; clearTimeout(whyEl._t); whyEl._t = setTimeout(() => { whyEl.textContent = ''; }, 5600); }
  return new Promise(r => setTimeout(() => { boot = false; render(); r(); }, 1150));
}
function note(t) { stEl.textContent = t; }

/* ---------- speech recognition (her ears) ---------- */
function stopRec() { if (rec) { const r = rec; rec = null; r.onend = r.onerror = r.onresult = null; try { r.abort(); } catch (e) { } } }
function listen() {
  if (!on || muted || state === 'thinking') return;
  if (state === 'speaking') return;
  stopRec(); const my = gen; let fin = '', itm = '';
  const r = rec = new SR(); r.lang = cfg.lang; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  r.onstart = () => { if (on && my === gen) { setState('listening'); meEl.textContent = ''; } };
  r.onresult = e => {
    fin = ''; itm = '';
    for (let i = 0; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) fin += x[0].transcript; else itm += x[0].transcript; }
    meEl.textContent = (fin + itm).trim();
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { rec = null; muted = true; muteB.innerHTML = MICOFF; muteB.classList.add('off'); setState('muted'); note('Mic blocked. Allow the microphone in your browser, then tap the mic.'); }
    else if (e.error === 'audio-capture') { note('No microphone found.'); }
    else if (e.error === 'network') { note('Voice recognition needs internet.'); }
  };
  r.onend = () => {
    if (rec !== r) return; rec = null;
    const t = (fin || itm).trim();
    if (t.length > 1 && on && my === gen) submit(t);
    else if (on && !muted && my === gen) setTimeout(() => { if (on && state === 'listening' && !rec) listen(); }, 250);
  };
  try { r.start(); } catch (e) { rec = null; setTimeout(listen, 500); }
}

/* ---------- send through the normal Academics chat ---------- */
function waitDone(my) {
  return new Promise(res => {
    const sd = $('#sd'); let started = sd.dataset.ic === 'stop', done = false;
    const fin = v => { if (done) return; done = true; mo.disconnect(); clearTimeout(t0); res(v); };
    const mo = new MutationObserver(() => { if (my !== gen) return fin('cancel'); if (sd.dataset.ic === 'stop') started = true; else if (started) fin('ok'); });
    mo.observe(sd, { attributes: true, attributeFilter: ['data-ic'] });
    const t0 = setTimeout(() => { if (!started) fin('none'); }, 3000);
  });
}
async function submit(text) {
  const my = gen, inp = $('#in'), sd = $('#sd');
  if (sd.dataset.ic === 'stop') { sd.click(); await new Promise(r => setTimeout(r, 200)); }   // a reply is still being written: stop it first
  setState('thinking'); meEl.textContent = text; aiEl.textContent = ''; lastRaw = '';
  inp.value = text; inp.dispatchEvent(new Event('input', { bubbles: true })); sd.click();
  const r = await waitDone(my); if (!on || my !== gen) return;
  if (r === 'none' || !lastRaw.trim()) { note(r === 'none' ? 'Could not send that. Try again.' : 'She had a problem answering. Try again.'); setTimeout(() => { if (on && my === gen) listen(); }, 1200); return; }
  speak(lastRaw, my);
}

/* ---------- she talks back ---------- */
async function speak(raw, my) {
  const mood = readMood(raw) || guessMood(plainText(raw)); aiEl.textContent = plainText(raw);
  const V = window.SpectraVoice;
  curMood = mood; ov.dataset.ld = '1'; setState('speaking'); setMood(mood);   // 'ld' = getting her voice ready (Spectre shows its loading face)
  if (!V || !V.play) { ov.dataset.ld = ''; await new Promise(r => setTimeout(r, Math.min(9000, 1200 + aiEl.textContent.length * 55))); }
  else { try { await V.play('[mood:' + mood + '] ' + plainText(raw), { onWho: takeover, speaker: who === 'spectre' ? 'spectre' : 'auto', onStart: () => { if (on && my === gen) { ov.dataset.ld = ''; setState('speaking'); setMood(mood); } } }); } catch (e) { } }
  ov.dataset.ld = ''; if (!on || my !== gen) return;
  setState('idle'); if (cfg.auto && !muted) listen(); else setState('muted');
}

/* ---------- lifecycle ---------- */
function open() {
  if (!SR) { alert('Voice input is not supported in this browser. Try Chrome, Edge or Safari.'); return; }
  build(); if (on) return;
  if (window.SpectraVoice && SpectraVoice.prime) SpectraVoice.prime();   // unlocks audio on iPhone/Safari from this tap
  on = true; muted = false; gen++; who = 'spectra'; boot = false; shownUrl = ''; whyEl.textContent = ''; Object.keys(SP).forEach(k => { new Image().src = DIR + SP[k]; }); muteB.innerHTML = MIC; muteB.classList.remove('off'); meEl.textContent = ''; aiEl.textContent = '';
  ov.hidden = false; document.documentElement.classList.add('vc-open'); void ov.offsetWidth; ov.classList.add('in');
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(w => { wake = w; }).catch(() => { }); } catch (e) { }
  setState('idle'); loop(); listen();
}
function close() {
  if (!on) return; on = false; gen++; stopRec();
  if (window.SpectraVoice) SpectraVoice.stop();
  cancelAnimationFrame(raf); ov.classList.remove('in'); ov.hidden = true; document.documentElement.classList.remove('vc-open');
  try { if (wake) { wake.release(); wake = null; } } catch (e) { }
  setState('idle');
}
function loop() {   // the ring pulses with her real voice volume (or a soft breathing when the browser voice can not be measured)
  const t = performance.now() / 1000;
  let lv = 0;
  if (state === 'speaking') { const v = window.SpectraVoice && SpectraVoice.level && SpectraVoice.level(); lv = v == null ? .35 + .25 * Math.sin(t * 9) ** 2 : v; }
  else if (state === 'listening') lv = .15 + .1 * Math.sin(t * 2.4);
  ov.style.setProperty('--lv', lv.toFixed(3));
  raf = requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && on) close(); });

/* ---------- entry button in the composer ---------- */
function addButton() {
  const sd = $('#sd'); if (!sd || $('#vcb')) return;
  const b = document.createElement('button'); b.id = 'vcb'; b.type = 'button'; b.className = 'ac-ib ac-vcb'; b.title = 'Voice chat'; b.setAttribute('aria-label', 'Start voice chat'); b.innerHTML = WAVE;
  b.onclick = open; sd.parentNode.insertBefore(b, sd);
  if (!SR) { b.title = 'Voice chat needs Chrome, Edge or Safari'; b.classList.add('na'); }
}
addButton();

window.SAVoiceChat = { get on() { return on; }, hint: HINT, feed(raw) { lastRaw = raw; }, open, close };
})();
