/* SPECSOFT® Spectra voice (v3): she reads her replies out loud.
   Engine 1 = Gemini voice (expressive, via the spectra-voice edge function, costs credits).
   Engine 2 = the browser's built-in voices (free). If Gemini fails or you are out of credits, she falls back to the browser voice.
   Adds a speaker button to each reply, a "Voice settings" panel and optional auto-read. Load BEFORE spectra-ai.js. */
(function () {
'use strict';
const SYN = window.speechSynthesis, OK = !!(SYN && window.SpeechSynthesisUtterance);
const KEY = 'sa.voice', DEF = { engine: 'gemini', gv: 'Leda', voice: '', rate: 1.05, pitch: 1.12, auto: false, exp: 1 };
const GV = [['Leda', 'Leda (youthful)'], ['Zephyr', 'Zephyr (bright)'], ['Aoede', 'Aoede (breezy)'], ['Autonoe', 'Autonoe (bright)'], ['Laomedeia', 'Laomedeia (upbeat)'], ['Kore', 'Kore (firm)']];
const GMAX = 650;   // Gemini voice reads about this many characters of a reply (her opening and reactions), so one reply stays one credit
const load = () => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { return Object.assign({}, DEF); } };
const store = c => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { } };
let cfg = load(), run = 0, cur = null;   // cur = { m, btn, st } while she is loading or speaking (st: 'ld' | 'on')
if (!GV.some(g => g[0] === cfg.gv)) cfg.gv = 'Leda';

const I = (inner, extra) => '<i class="sa-fi sv' + (extra ? ' ' + extra : '') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg></i>';
const ICON = I('<path d="M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4z"/><path d="M15.5 9.5a3.5 3.5 0 010 5"/><path d="M18 7a7 7 0 010 10"/>');
const STOP = '<i class="sa-fi sv sv-stop"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg></i>';
const SPIN = I('<path d="M12 3a9 9 0 019 9" stroke-width="2.4"/>', 'sv-spin');
const BTN = '<button data-a="speak" title="Read aloud" aria-label="Read aloud">' + ICON + STOP + SPIN + '</button>';
const MENU = '<button data-a="voice">' + ICON + '<span>Voice settings</span></button>';

/* ---------- turn markdown into something that sounds right out loud ---------- */
// [pattern, browser-voice text, Gemini text (null = leave as typed, Gemini laughs by itself)]
const LAUGH = [[/[\u{1F602}\u{1F923}\u{1F480}]+/gu, ' ha ha! ', ' haha! '], [/\b(?:ha){2,}h?\b/gi, 'ha ha ha!', null], [/\bhe(?:he)+\b/gi, 'he he!', null], [/\blmf?ao\b/gi, 'ha ha ha!', 'haha!'], [/\blol\b/gi, 'ha ha!', 'haha!'], [/\bomg\b/gi, 'oh my god!', 'oh my god!']];
const SAY = [[/\bspecsoft\b/gi, 'Spec soft'], [/\bfr\b/gi, 'for real'], [/\bngl\b/gi, 'not gonna lie'], [/\btbh\b/gi, 'to be honest'], [/\bicl\b/gi, "I can't lie"],
  [/\bidk\b/gi, "I don't know"], [/\bidc\b/gi, "I don't care"], [/\brn\b/gi, 'right now'], [/\batm\b/gi, 'at the moment'], [/\bimo\b/gi, 'in my opinion'], [/\bong\b/gi, 'on god'],
  [/\bwyd\b/gi, 'what you doing'], [/\bwym\b/gi, 'what you mean'], [/\bhmu\b/gi, 'hit me up'], [/\bskl\b/gi, 'share ko lang'], [/\bsmh\b/gi, 'shaking my head'], [/\bnpc\b/gi, 'N P C']];
function clean(t, gem) {
  let s = String(t || '')
    .replace(/\[(mood|remember):[^\]]*\]/gi, '').replace(/\[GIFT OFFER\]/gi, '')
    .replace(/```widget[\s\S]*?(```|$)/gi, ' ').replace(/```[\s\S]*?(```|$)/g, ' (code skipped). ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (a math formula). ').replace(/(?<![\w$])\$(?!\s)[^$\n]{1,80}(?<!\s)\$(?![\w$])/g, ' a formula ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' link ')
    .replace(/\|\|[^|\n]+\|\|/g, ' spoiler ').replace(/^\s*-#\s*/gm, '').replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*>{1,3}\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, '').replace(/\|/g, ', ')
    .replace(/[*_~`#]+/g, '').replace(/[\u00ae\u2122]/g, '');
  LAUGH.forEach(([r, b, g]) => { const v = gem ? g : b; if (v !== null) s = s.replace(r, v); });
  s = s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');
  SAY.forEach(([r, v]) => { s = s.replace(r, v); });
  return s.replace(/([!?])\./g, '$1').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}
function trimTo(s, max) {   // cut at the end of a sentence so she never stops mid-word
  if (s.length <= max) return s;
  const cut = s.slice(0, max), m = cut.match(/^[\s\S]*[.!?\u2026](?=\s|$)/), i = m ? m[0].length : cut.lastIndexOf(' ');
  return (i > max * .4 ? cut.slice(0, i) : cut).trim();
}

/* one short spoken piece per sentence (browser voice), keeping paragraph breaks for longer pauses */
function sentences(s) {
  const out = [];
  s.split(/\n+/).forEach(line => {
    line = line.trim(); if (!line) return; const before = out.length;
    line.split(/(?<=[.!?\u2026])\s+/).forEach(p => {
      p = p.trim(); if (!p) return;
      if (p.length <= 160) return out.push({ t: p, brk: false });
      let buf = ''; p.split(/(?<=[,;:])\s+/).forEach(q => { if (buf && (buf + ' ' + q).length > 160) { out.push({ t: buf, brk: false }); buf = q; } else buf = buf ? buf + ' ' + q : q; });
      if (buf) out.push({ t: buf, brk: false });
    });
    if (out.length > before) out[out.length - 1].brk = true;
  });
  return out.map(x => ({ t: x.t.slice(0, 240), brk: x.brk }));
}
const MOOD = { joy: [.10, .14], sparkle: [.12, .20], love: [-.04, .12], surprised: [.10, .22], shocked: [.08, .24], shy: [-.12, .10], sad: [-.15, -.10], sleepy: [-.22, -.12], deadpan: [-.06, -.18], smug: [-.05, .02], annoyed: [.04, -.04], grumpy: [-.02, -.12], pout: [-.06, .06], confused: [-.04, .08], thinking: [-.06, -.02], speechless: [-.14, -.06] };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function prosody(t, mood) {
  const k = clamp(+cfg.exp, 0, 2); let r = cfg.rate + mood[0] * k, p = cfg.pitch + mood[1] * k;
  if (/\?+$/.test(t)) p += .10 * k;
  if (/!+$/.test(t)) { p += .15 * k; r += .06 * k; }
  if (/(\.\.\.|\u2026)$/.test(t)) { r -= .10 * k; p -= .05 * k; }
  if (/\b[A-Z]{3,}\b/.test(t)) { p += .08 * k; r += .04 * k; }
  p += (Math.random() - .5) * .18 * k; r += (Math.random() - .5) * .10 * k;
  return { r: clamp(r, .6, 1.8), p: clamp(p, .5, 2) };
}
function gap(t, brk) {
  const e = t.slice(-1), g = /(\.\.\.|\u2026)$/.test(t) ? 380 : e === '?' ? 210 : e === '!' ? 170 : /[,;:]/.test(e) ? 90 : 140;
  return g + (brk ? 170 : 0);
}

/* ---------- browser voices ---------- */
const voices = () => { try { return SYN.getVoices() || []; } catch (e) { return []; } };
const LADY = /aria|jenny|samantha|zira|ava|allison|susan|karen|tessa|moira|fiona|victoria|serena|nova|female|google us english|google uk english female|natural/i;
function pick() {
  const v = voices(); if (!v.length) return null;
  if (cfg.voice) { const f = v.find(x => x.name === cfg.voice); if (f) return f; }
  const en = v.filter(x => /^en[-_]/i.test(x.lang)), pool = en.length ? en : v;
  return pool.find(x => LADY.test(x.name) && /^en[-_]US/i.test(x.lang)) || pool.find(x => LADY.test(x.name)) || pool.find(x => /^en[-_]US/i.test(x.lang)) || pool[0];
}

/* ---------- button state + notices ---------- */
function paint(btn, st) {
  if (!btn || !btn.isConnected) return;
  btn.classList.toggle('on', st === 'on'); btn.classList.toggle('ld', st === 'ld');
  btn.title = st ? 'Stop reading' : 'Read aloud'; btn.setAttribute('aria-label', btn.title);
}
function setSt(st) { if (cur) { cur.st = st; paint(cur.btn, st); } }
let noteT = 0;
function notice(msg) {
  const old = document.querySelector('.sv-toast'); if (old) old.remove(); clearTimeout(noteT);
  const d = document.createElement('div'); d.className = 'sv-toast'; d.setAttribute('role', 'status'); d.textContent = msg; document.body.appendChild(d);
  noteT = setTimeout(() => d.remove(), 3400);
}

/* ---------- Gemini voice ---------- */
const AUD = new Audio(); AUD.preload = 'auto';
const cache = new Map();   // "voice|mood|text" -> blob url, so replaying the same reply is instant and free
let ctrl = null, unlocked = false;
function silentWav() {   // tiny silent clip, played once on a tap so iOS/Safari let later audio start on their own
  const n = 400, b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer), t = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  t(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); t(8, 'WAVE'); t(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); t(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function unlock() {
  if (unlocked) return; unlocked = true;
  try { AUD.src = silentWav(); const p = AUD.play(); if (p && p.catch) p.catch(() => { }); } catch (e) { }
  if (OK) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; SYN.speak(u); } catch (e) { } }
}
async function authInfo() {
  const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session, c = window.SPECSOFT_CONFIG;
  if (!s || !c || !c.SUPABASE_URL) return null;
  return { url: c.SUPABASE_URL + '/functions/v1/spectra-voice', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: c.SUPABASE_ANON_KEY } };
}
const saveLeft = r => { const lf = r.headers.get('X-Spectra-Left'), lm = r.headers.get('X-Spectra-Limit'); if (lf !== null && lm !== null && !isNaN(+lf) && +lm > 0) { try { localStorage.setItem('sa.left', JSON.stringify({ left: +lf, limit: +lm, day: new Date().toISOString().slice(0, 10) })); } catch (e) { } } };
/* returns true when Gemini handled it (played, or was cancelled), false when the caller should use the browser voice */
async function gemSay(raw, id) {
  const tag = /^\s*\[mood:(\w+)\]/i.exec(String(raw || '')), mood = tag ? tag[1].toLowerCase() : 'joy';
  const text = trimTo(clean(raw, true), GMAX); if (!text) return true;
  const key = cfg.gv + '|' + mood + '|' + text; let url = cache.get(key);
  if (!url) {
    const a = await authInfo(); if (!a) return false;
    ctrl = new AbortController(); let r;
    try { r = await fetch(a.url, { method: 'POST', headers: a.headers, body: JSON.stringify({ text, mood, voice: cfg.gv }), signal: ctrl.signal }); }
    catch (e) { return id !== run; }
    if (id !== run) return true;
    saveLeft(r);
    if (!r.ok) {
      const msg = await r.text().catch(() => '');
      if (/^daily/.test(msg)) notice("You're out of credits for today, so Spectra is using the free voice.");
      else if (r.status !== 503) notice('Gemini voice is busy, using the free voice for now.');
      return false;
    }
    try { console.info('Spectra voice: Gemini model =', r.headers.get('X-Spectra-Model') || 'unknown'); } catch (e) { }
    const blob = await r.blob(); if (id !== run) return true; if (blob.size < 1000) return false;
    url = URL.createObjectURL(blob); cache.set(key, url);
    if (cache.size > 12) { const k = cache.keys().next().value; URL.revokeObjectURL(cache.get(k)); cache.delete(k); }
  }
  if (id !== run) return true;
  return new Promise(res => {
    let fin = false; const end = ok => { if (fin) return; fin = true; AUD.onended = AUD.onerror = null; if (ok && id === run && cur) { paint(cur.btn, ''); cur = null; } res(ok); };
    AUD.onended = () => end(true); AUD.onerror = () => end(false);
    AUD.src = url; const p = AUD.play();
    if (p && p.then) p.then(() => { if (id === run) setSt('on'); }, () => end(false)); else setSt('on');
  });
}

/* ---------- browser voice playback ---------- */
function browserSay(text, id) {
  if (!OK) { if (id === run && cur) { paint(cur.btn, ''); cur = null; } return; }
  const tag = /^\s*\[mood:(\w+)\]/i.exec(String(text || '')), mood = MOOD[tag && tag[1].toLowerCase()] || [.04, .06];
  const parts = sentences(clean(text)); if (!parts.length) { if (id === run && cur) { paint(cur.btn, ''); cur = null; } return; }
  const v = pick(); setSt('on'); let i = 0;
  const next = () => {
    if (id !== run) return;
    if (i >= parts.length) { if (cur) paint(cur.btn, ''); cur = null; return; }
    const s = parts[i++], pr = prosody(s.t, mood), u = new SpeechSynthesisUtterance(s.t);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = pr.r; u.pitch = pr.p; u.volume = 1;
    let fired = false; const done = () => { if (fired || id !== run) return; fired = true; setTimeout(next, gap(s.t, s.brk)); };
    u.onend = done; u.onerror = done; SYN.speak(u);
  };
  next();
}

/* ---------- controls ---------- */
function stop() {
  run++;
  if (ctrl) { try { ctrl.abort(); } catch (e) { } ctrl = null; }
  try { AUD.onended = AUD.onerror = null; AUD.pause(); } catch (e) { }
  if (OK) { try { SYN.cancel(); } catch (e) { } }
  if (cur) paint(cur.btn, ''); cur = null;
}
async function say(text, m, btn) {
  stop(); const id = run; cur = { m, btn, st: 'ld' };
  if (cfg.engine === 'gemini') {
    paint(btn, 'ld'); let ok = false;
    try { ok = await gemSay(text, id); } catch (e) { ok = false; }
    if (id !== run) return; if (ok) return;
  }
  browserSay(text, id);
}
function toggle(m, btn) { unlock(); if (cur && cur.m === m) return stop(); say(m.content, m, btn); }
function auto(text, m) {
  if (!cfg.auto || document.hidden) return;
  const b = document.querySelectorAll('.sa-msg.ai [data-a=speak]'); say(text, m || {}, b[b.length - 1] || null);
}
function sync(d, m) { if (cur && cur.m === m) { const b = d.querySelector('[data-a=speak]'); if (b) { cur.btn = b; paint(b, cur.st); } } }

/* ---------- settings panel ---------- */
let ov = null;
function fillVoices(sel) {
  const v = voices().slice().sort((a, b) => (/^en/i.test(b.lang) - /^en/i.test(a.lang)) || a.name.localeCompare(b.name));
  sel.textContent = ''; const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Auto (best girly match)'; sel.appendChild(o0);
  v.forEach(x => { const o = document.createElement('option'); o.value = x.name; o.textContent = x.name + ' (' + x.lang + ')'; sel.appendChild(o); });
  sel.value = voices().some(x => x.name === cfg.voice) ? cfg.voice : '';
}
function panel() {
  if (ov) { ov.remove(); ov = null; return; }
  ov = document.createElement('div'); ov.className = 'sv-ov';
  ov.innerHTML = '<div class="sv-box" role="dialog" aria-label="Spectra voice settings"><div class="sv-t">Spectra\'s voice</div>' +
    '<label class="sv-r"><span>Voice engine</span><select id="svEng"><option value="gemini">Gemini (expressive, 1 credit per reply)</option><option value="browser">Browser (free, more robotic)</option></select></label>' +
    '<label class="sv-r sv-gem"><span>Gemini voice</span><select id="svGv"></select></label>' +
    '<label class="sv-r sv-brw"><span>Browser voice</span><select id="svVoice"></select></label>' +
    '<label class="sv-r sv-brw"><span>Speed <b id="svRv"></b></span><input id="svRate" type="range" min="0.7" max="1.5" step="0.05"></label>' +
    '<label class="sv-r sv-brw"><span>Pitch <b id="svPv"></b></span><input id="svPitch" type="range" min="0.8" max="1.6" step="0.05"></label>' +
    '<label class="sv-r sv-brw"><span>Bubbly level <b id="svEv"></b></span><input id="svExp" type="range" min="0" max="2" step="0.1"></label>' +
    '<label class="sv-c"><input id="svAuto" type="checkbox"><span>Read her replies out loud automatically</span></label>' +
    '<p class="sv-n" id="svNote"></p>' +
    '<div class="sv-b"><button type="button" id="svTest">Test voice</button><button type="button" id="svDone" class="main">Done</button></div></div>';
  document.body.appendChild(ov);
  const $ = id => ov.querySelector('#' + id), eng = $('svEng'), gv = $('svGv'), sel = $('svVoice'), rate = $('svRate'), pit = $('svPitch'), au = $('svAuto'), ex = $('svExp');
  GV.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; gv.appendChild(o); });
  fillVoices(sel); eng.value = cfg.engine; gv.value = cfg.gv; rate.value = cfg.rate; pit.value = cfg.pitch; au.checked = cfg.auto; ex.value = cfg.exp;
  $('svRv').textContent = (+cfg.rate).toFixed(2) + 'x'; $('svPv').textContent = (+cfg.pitch).toFixed(2); $('svEv').textContent = (+cfg.exp).toFixed(1);
  const show = () => {
    const g = cfg.engine === 'gemini'; ov.querySelectorAll('.sv-gem').forEach(e => { e.hidden = !g; }); ov.querySelectorAll('.sv-brw').forEach(e => { e.hidden = g; });
    $('svNote').textContent = g ? 'Gemini voice sounds like a real person but uses 1 credit per reply (and only reads about the first 650 characters). Replaying the same reply is free. If it fails, she uses the free voice.' : 'Free browser voices. How she sounds depends on your device, and Edge has the nicest ones (look for "Natural").';
  };
  show();
  eng.onchange = () => { cfg.engine = eng.value; store(cfg); show(); };
  gv.onchange = () => { cfg.gv = gv.value; store(cfg); };
  sel.onchange = () => { cfg.voice = sel.value; store(cfg); };
  rate.oninput = () => { cfg.rate = +rate.value; $('svRv').textContent = cfg.rate.toFixed(2) + 'x'; store(cfg); };
  pit.oninput = () => { cfg.pitch = +pit.value; $('svPv').textContent = cfg.pitch.toFixed(2); store(cfg); };
  ex.oninput = () => { cfg.exp = +ex.value; $('svEv').textContent = cfg.exp.toFixed(1); store(cfg); };
  au.onchange = () => { cfg.auto = au.checked; store(cfg); };
  $('svTest').onclick = () => { unlock(); say("[mood:joy]Hey bro!! It's Spectra! Wait... did you really just ask me to talk? Okay okay, haha, let's gooo! How do I sound?", {}, null); };
  const close = () => { if (ov) { ov.remove(); ov = null; } document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  $('svDone').onclick = close; ov.addEventListener('click', e => { if (e.target === ov) close(); }); document.addEventListener('keydown', esc);
  if (OK && SYN.onvoiceschanged !== undefined) SYN.onvoiceschanged = () => { if (ov) fillVoices(sel); };
  eng.focus();
}
if (OK) { try { SYN.getVoices(); } catch (e) { } }
window.addEventListener('pagehide', stop);

window.SpectraVoice = { ok: true, btn: BTN, menu: MENU, toggle, panel, auto, sync, unlock, stop, _clean: clean, _sentences: sentences, _prosody: prosody, _trim: trimTo };
})();
