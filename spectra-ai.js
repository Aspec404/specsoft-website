/* SPECSOFT® Spectra AI. Load AFTER main.js.
   LAUNCH = 'demo'     -> scripted replies (no backend)
   LAUNCH = 'supabase' -> Supabase Edge Function "spectra-chat" (public launch)
   Type /dev in the chat box to set a PRIVATE 9Router URL/key/model (saved only in YOUR browser) -> direct mode. */
(function () {
'use strict';
const LAUNCH = 'supabase';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const N = { joy: 1, thinking: 2, sparkle: 3, love: 4, annoyed: 5, sad: 6, surprised: 7, confused: 8, shy: 9, deadpan: 10, smug: 11, pout: 12, shocked: 13, sleepy: 14, grumpy: 15, speechless: 16 };
const PFP = 'assets/spectra/spectra-pfp.png';
const ico = n => '<i class="sa-fi" data-i="' + n + '"><svg><use href="#i-' + n + '"/></svg></i>';
const faceSrc = m => 'assets/spectra/expressions/spectra-exp-' + String(N[m]).padStart(2, '0') + '-' + m + '.png';
const CANONICAL_SPECSOFT_SITE = 'https://specsoftdev.netlify.app';
const sanitizeSpecsoftLinks = text => {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/https?:\/\/[^\s<>"')\]]+/gi, url => {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      if (host === 'specsoft.co.uk' || host === 'specsoftdev.netlify.app' || /(^|\.)specsoft(\.|$)/i.test(host)) return CANONICAL_SPECSOFT_SITE;
    } catch (e) {}
    return url;
  });
};
const SYS = "You are Spectra, the official AI assistant and mascot of SPECSOFT, an independent software and game development brand. Be friendly, concise and helpful; put code in markdown code blocks. ALWAYS use the canonical SPECSOFT website URL exactly as https://specsoftdev.netlify.app when you mention the website. Never invent, guess, or paraphrase it. Start EVERY reply with one hidden mood tag, exactly like [mood:joy], chosen from: " + Object.keys(N).join(', ') + ".";
let atts = [], pendingImgs = [];
const modes = () => LS('sa.modes', { think: false });
const THINK = 'Think through the problem step by step, double-check your work, then give a clear final answer.';
const backend = () => LS('sa.dev', null) ? 'direct' : LAUNCH;
const CFG = () => LS('sa.cfg', { nick: '', expr: true, typing: true });
const PERSONAS = [
  { id: 'spectra', n: 'Spectra', i: 'spark', p: '' },
  { id: 'dev', n: 'Dev Mode', i: 'code', p: 'Focus on clean, correct code with brief explanations. Ask for the error message or code if it is missing.' },
  { id: 'lua', n: 'Roblox Lua', i: 'gamepad', p: 'You are an expert Roblox Luau scripter. Prefer modern Luau and say where each script belongs (ServerScriptService, StarterPlayerScripts, etc).' },
  { id: 'creative', n: 'Creative', i: 'palette', p: 'Be imaginative and playful for ideas, stories and game design. Offer several options.' },
  { id: 'chill', n: 'Chill Bro', i: 'smile', p: 'Talk casually like a laid-back friend with light humor, but stay accurate.' }];
const persona = () => PERSONAS.find(x => x.id === LS('sa.persona', 'spectra')) || PERSONAS[0];

let chats = LS('sa.chats', []), cur = null, busy = false, ctrl = null, timer = null, mood = '', pokes = 0, idle, typing;
const save = () => { const kept = new Set(chats.filter(c => c.pin || c.lib)); chats.filter(c => !kept.has(c)).slice(0, 40).forEach(c => kept.add(c)); SS('sa.chats', chats.filter(c => kept.has(c))); };
let renaming = null; const justTitled = new Set(), naming = new Set();
const msgsEl = $('#saMsgs'), scrollEl = $('#saScroll'), input = $('#saInput'), sendBtn = $('#saSend'), app = $('#saApp');
const down = () => { scrollEl.scrollTop = scrollEl.scrollHeight; };
const toast = t => { const e = $('#saToast'); e.textContent = t; e.classList.add('on'); setTimeout(() => e.classList.remove('on'), 2200); };
const copy = (t, ok) => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(ok || 'Copied!')).catch(() => toast('Copy failed'));

/* ---- Icons: inline fallbacks auto-swap to Flaticon files at assets/icons/<name>.svg (or .png) ---- */
const IC = {};
const probe = n => IC[n] || (IC[n] = new Promise(res => { const t = ['svg', 'png']; (function go(i) { if (i >= t.length) return res(''); const u = 'assets/icons/' + n + '.' + t[i], im = new Image(); im.onload = () => res(u); im.onerror = () => go(i + 1); im.src = u; })(0); }));
function upIcons() { $$('.sa-fi[data-i]:not([data-d])').forEach(el => { el.dataset.d = 1; probe(el.dataset.i).then(u => { if (u) { el.style.setProperty('--fi', 'url("' + u + '")'); el.classList.add('f'); } }); }); }
let upT; new MutationObserver(() => { cancelAnimationFrame(upT); upT = requestAnimationFrame(upIcons); }).observe(app, { childList: true, subtree: true });
upIcons();

/* ---- Expressions ---- */
$$('.sa-face').forEach(i => { i.onerror = () => { i.onerror = null; i.src = PFP; }; i.onclick = poke; });
function setMood(m) {
  if (!CFG().expr) return;
  if (!N[m]) m = 'sparkle';
  clearTimeout(idle); idle = setTimeout(() => setMood('sleepy'), 90000);
  if (m === mood) return; mood = m;
  $$('.sa-face').forEach(i => { i.style.opacity = 0; setTimeout(() => { i.src = faceSrc(m); i.style.opacity = 1; }, 140); });
}
function poke() { pokes++; setTimeout(() => pokes = 0, 8000); setMood(pokes > 6 ? 'grumpy' : pokes > 3 ? 'annoyed' : 'surprised'); }

/* ---- Greetings (visitor's local time) ---- */
function greeting(u) {
  if (!localStorage.getItem('sa.seen')) { localStorage.setItem('sa.seen', '1'); return ["Hey, nice to meet ya, " + u + "! I'm Spectra.", 'joy']; }
  const h = new Date().getHours();
  const k = h === 3 ? 'am3' : h < 3 ? 'late' : h < 5 ? 'dawn' : h < 9 ? 'morn' : h < 12 ? 'am' : h < 17 ? 'day' : h < 21 ? 'eve' : h < 23 ? 'night' : 'owl';
  const P = {
    am3: [["Bro it's already 3:00 AM, why are you still chatting??", 'shocked']],
    late: [["Can't sleep? Let's make you sleep.", 'sleepy'], ["Still up, {u}? Talk to me.", 'speechless']],
    dawn: [["Early bird or never slept?", 'surprised'], ["Morning already, {u}?", 'sleepy']],
    morn: [["Hello, morning bird, did you tidy up your room?", 'joy'], ["Bro woke up so early just to chat", 'surprised'], ["Good morning! Did you drink your coffee?", 'smug']],
    am: [["Good morning, {u}! What are we making today?", 'joy'], ["What can I do for you, {u}?", 'sparkle']],
    day: [["What can I do for you, {u}?", 'sparkle'], ["Hey, nice to meet ya.", 'joy'], ["Yo {u}, what's the plan?", 'smug']],
    eve: [["Good evening, {u}.", 'sparkle'], ["Evening, {u}! How was your day?", 'joy']],
    night: [["Good evening, {u}. Late-night coding?", 'smug'], ["Hey {u}, what's up tonight?", 'sparkle']],
    owl: [["Hello, night owl.", 'smug'], ["It's 11 PM, {u}... one more bug?", 'deadpan']]
  }[k];
  const last = localStorage.getItem('sa.last'); let c = P.filter(x => x[0] !== last); if (!c.length) c = P;
  const r = c[Math.floor(Math.random() * c.length)]; localStorage.setItem('sa.last', r[0]);
  return [r[0].replace('{u}', u), r[1]];
}
function showGreeting() {
  const n = CFG().nick || ($('[data-user-name]') || {}).textContent; const [t, m] = greeting(n && n.trim() ? n.trim() : 'Bro');
  const b = $('#saBubble'); b.textContent = ''; setMood(m); let i = 0;
  if (!CFG().typing) { b.textContent = t; return; }
  const iv = setInterval(() => { b.textContent = t.slice(0, ++i); if (i >= t.length) clearInterval(iv); }, 28);
}

/* ---- Markdown ---- */
function md(t) {
  return t.split('```').map((p, i) => {
    if (i % 2) {
      const nl = p.indexOf('\n'), lang = nl > -1 ? p.slice(0, nl).trim() : '', code = nl > -1 ? p.slice(nl + 1) : p;
      return '<div class="sa-code"><div class="sa-code-h"><span>' + esc(lang || 'code') + '</span><span><button class="sa-cc" type="button">COPY</button><button class="sa-sv" type="button">SAVE</button></span></div><pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre></div>';
    }
    return esc(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>').replace(/\n/g, '<br>');
  }).join('');
}

/* ---- Rendering ---- */
function msgEl(m, last) {
  const d = document.createElement('div');
  d.className = 'sa-msg ' + (m.role === 'user' ? 'user' : 'ai') + (m.err ? ' err' : '') + (last ? ' last' : '');
  if (m.role === 'user') {
    d.innerHTML = '<div class="sa-b"></div>'; const b = d.firstChild; let tx = m.show || m.content;
    if (m._imgs && m._imgs.length) {
      const g = document.createElement('div'); g.className = 'sa-imgs';
      m._imgs.forEach(u => { const im = document.createElement('img'); im.src = u; im.alt = 'attached image'; g.appendChild(im); });
      b.appendChild(g); tx = tx.replace(/\n🖼 [^\n]*/, '');
    }
    b.appendChild(document.createTextNode(tx)); return d;
  }
  d.innerHTML = '<img class="sa-av" src="' + PFP + '" alt=""><div class="sa-col"><div class="sa-b">' + md(m.content) + '</div><div class="sa-act">' +
    '<button data-a="copy" title="Copy">' + ico('copy') + '</button><button data-a="up" title="Like" class="' + (m.fb === 'up' ? 'on' : '') + '">' + ico('like') + '</button><button data-a="down" title="Dislike" class="' + (m.fb === 'down' ? 'on' : '') + '">' + ico('dislike') + '</button><button data-a="regen" title="Regenerate">' + ico('refresh') + '</button><button data-a="more" title="More">' + ico('more') + '</button>' +
    '<div class="sa-pop"><button data-a="branch">' + ico('branch') + '<span>Branch in new chat</span></button><button data-a="share">' + ico('link') + '<span>Share message link</span></button><button data-a="report">' + ico('flag') + '<span>Report legal issue</span></button></div></div></div>';
  return d;
}
function renderChat() {
  msgsEl.innerHTML = ''; const ms = cur ? cur.messages : [];
  $('#saHero').classList.toggle('gone', !!ms.length); app.classList.toggle('chatting', !!ms.length);
  ms.forEach((m, i) => msgsEl.appendChild(msgEl(m, i === ms.length - 1))); down();
}
function renderList() {
  const L = $('#saList'); L.innerHTML = '';
  const vis = chats.filter(c => !c.arch);
  if (!vis.length) { L.innerHTML = '<div class="sa-empty">' + (chats.length ? 'Everything is archived' : 'No chats yet') + '</div>'; return; }
  const d0 = new Date().setHours(0, 0, 0, 0); let g = '';
  const label = t => L.insertAdjacentHTML('beforeend', '<div class="sa-label">' + t + '</div>');
  const add = c => {
    const it = document.createElement('div'); it.className = 'sa-item' + (c === cur ? ' on' : '') + (naming.has(c) ? ' naming' : '');
    if (c === renaming) {
      it.innerHTML = '<input class="sa-rn" maxlength="40" aria-label="Rename chat">'; const inp = it.firstChild; inp.value = c.title; let done = false;
      const fin = ok => { if (done) return; done = true; renaming = null; if (ok) { const v = inp.value.trim().slice(0, 40); if (v) { c.title = v; c.renamed = true; save(); } } renderList(); };
      inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); };
      inp.onblur = () => fin(true); inp.onclick = e => e.stopPropagation();
      L.appendChild(it); setTimeout(() => { inp.focus(); inp.select(); }, 0); return;
    }
    it.innerHTML = (c.pin ? ico('pin') : '') + '<span></span><button class="sa-dots" type="button" aria-label="Chat options">' + ico('more') + '</button>';
    const sp = it.querySelector('span'); sp.textContent = c.title;
    if (justTitled.has(c)) { justTitled.delete(c); const full = c.title; let i = 0; sp.textContent = ''; const iv = setInterval(() => { sp.textContent = full.slice(0, ++i); if (i >= full.length) clearInterval(iv); }, 32); }
    it.onclick = e => { const dt = e.target.closest('.sa-dots'); if (dt) { e.stopPropagation(); return chatMenu(c, dt.getBoundingClientRect(), it); } if (!busy) openChat(c); };
    it.oncontextmenu = e => { e.preventDefault(); chatMenu(c, { x: e.clientX, y: e.clientY }, it); };
    L.appendChild(it);
  };
  const pinned = vis.filter(c => c.pin), rest = vis.filter(c => !c.pin);
  if (pinned.length) { label('Pinned'); pinned.forEach(add); g = 'Pinned'; }
  rest.forEach(c => { const t = c.t >= d0 ? 'Today' : c.t >= d0 - 864e5 ? 'Yesterday' : 'Earlier'; if (t !== g) { g = t; label(t); } add(c); });
}
function openChat(c) { cur = c; renderList(); renderChat(); app.classList.remove('drawer'); }

/* ---- Chat item menu: 3 dots on hover, or right-click. Pin / Rename / Library / Archive / Delete ---- */
let cm = null;
function closeMenu() { if (cm) { cm.remove(); cm = null; } $$('.sa-item.menu').forEach(x => x.classList.remove('menu')); }
function chatMenu(c, a, it) {
  closeMenu(); if (it) it.classList.add('menu');
  cm = document.createElement('div'); cm.className = 'sa-cmenu';
  const items = [['pin', 'pin', c.pin ? 'Unpin' : 'Pin'], ['rename', 'pen', 'Rename Convo'], ['lib', 'folder', c.lib ? 'Remove from Library' : 'Add to Library'], ['arch', 'archive', c.arch ? 'Unarchive Convo' : 'Archive Convo'], null, ['del', 'trash', 'Delete', 1]];
  cm.innerHTML = items.map(x => x ? '<button type="button" data-k="' + x[0] + '"' + (x[3] ? ' class="danger"' : '') + '>' + ico(x[1]) + '<span>' + x[2] + '</span></button>' : '<div class="sa-sep"></div>').join('');
  document.body.appendChild(cm);
  const w = cm.offsetWidth, h = cm.offsetHeight, x = a.x !== undefined ? a.x : a.left, y = a.y !== undefined ? a.y : a.bottom + 4;
  cm.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'; cm.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
  cm.onclick = e => {
    e.stopPropagation(); const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
    if (k === 'del' && !b.dataset.sure) { b.dataset.sure = 1; b.querySelector('span').textContent = 'Click again to delete'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.querySelector('span').textContent = 'Delete'; } }, 3000); return; }
    closeMenu();
    if (k === 'pin') { c.pin = !c.pin; save(); renderList(); }
    else if (k === 'rename') { renaming = c; renderList(); }
    else if (k === 'lib') { c.lib = !c.lib; save(); toast(c.lib ? 'Added to Library' : 'Removed from Library'); }
    else if (k === 'arch') { c.arch = !c.arch; save(); if (c.arch && cur === c) { if (busy) stop(); cur = null; renderChat(); showGreeting(); } renderList(); toast(c.arch ? 'Archived. Find it in Library' : 'Unarchived'); }
    else if (k === 'del') { if (cur === c && busy) stop(); chats = chats.filter(x => x !== c); if (cur === c) { cur = null; renderChat(); showGreeting(); } save(); renderList(); toast('Chat deleted'); }
  };
}
document.addEventListener('click', closeMenu); addEventListener('resize', closeMenu); $('#saList').addEventListener('scroll', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

/* ---- Images: shrink before sending (max 1280px JPEG) so uploads stay small and fast ---- */
function shrink(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      let w = im.naturalWidth, h = im.naturalHeight; const k = Math.min(1, 1280 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
      let q = .82, out = c.toDataURL('image/jpeg', q);
      while (out.length > 1.1e6 && q > .4) { q -= .12; out = c.toDataURL('image/jpeg', q); }
      out.length > 1.2e6 ? rej(new Error('big')) : res(out);
    };
    im.onerror = () => rej(new Error('bad')); im.src = src;
  });
}

/* ---- Supabase request + AI chat titles ("hi bro" becomes "Simple Greeting") ---- */
async function sbReq() {
  const sb = window.getSupabaseClient && window.getSupabaseClient(); const s = sb && (await sb.auth.getSession()).data.session;
  if (!s) throw new Error('LOGIN');
  return { url: window.SPECSOFT_CONFIG.SUPABASE_URL + '/functions/v1/spectra-chat', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: window.SPECSOFT_CONFIG.SUPABASE_ANON_KEY } };
}
async function autoTitle(c) {
  if (backend() !== 'supabase' || c.renamed || c.titled) return;
  const u = c.messages.find(m => m.role === 'user'), a = c.messages.find(m => m.role === 'assistant' && !m.err && m.content);
  if (!u || !a) return;
  c.titled = true; naming.add(c); renderList();
  try {
    const q = await sbReq();
    const r = await fetch(q.url, { method: 'POST', headers: q.headers, body: JSON.stringify({ mode: 'title', user: (u.show || u.content).split(/\n(?:🖼|📎)/)[0].slice(0, 400), assistant: a.content.slice(0, 300) }) });
    const j = r.ok ? await r.json() : null, t = j && typeof j.title === 'string' ? j.title.trim().slice(0, 40) : '';
    if (t && !c.renamed) { c.title = t; justTitled.add(c); }
  } catch (e) { }
  naming.delete(c); save(); renderList();
}

/* ---- Backend ---- */
const DEMOS = [[/specsoft/i, "[mood:joy]**SPECSOFT®** is an independent software and game dev brand.\n\n- Software and game dev\n- Roblox developers\n- Anime and creatives"], [/code|debounce|lua|script/i, "[mood:smug]Here you go:\n\n```javascript\nfunction debounce(fn, wait = 300) {\n  let t;\n  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };\n}\n```"]];
const demo = q => (DEMOS.find(d => d[0].test(q)) || [0, "[mood:sparkle]Demo mode is on, so I'm using scripted replies. Once the backend is connected, I'll answer anything. **Spectra online.**"])[1];
async function ask(h, onTok, signal) {
  let url, hd = { 'Content-Type': 'application/json' }, body;
  if (backend() === 'direct') {
    const d = LS('sa.dev', {}); url = d.url.replace(/\/$/, '') + '/chat/completions'; hd.Authorization = 'Bearer ' + d.key;
    let hh = h;
    if (pendingImgs.length) {
      if (d.vision) { hh = h.slice(); const l = hh[hh.length - 1]; hh[hh.length - 1] = { role: 'user', content: [{ type: 'text', text: l.content }, ...pendingImgs.map(u => ({ type: 'image_url', image_url: { url: u } }))] }; }
      else toast('Images skipped: this model has no vision enabled');
    }
    pendingImgs = [];
    body = { model: d.model, stream: true, messages: [{ role: 'system', content: SYS + ' ' + persona().p + (modes().think ? ' ' + THINK : '') }, ...hh] };
  } else {
    const sb = window.getSupabaseClient && window.getSupabaseClient(); const s = sb && (await sb.auth.getSession()).data.session;
    if (!s) throw new Error('LOGIN');
    url = window.SPECSOFT_CONFIG.SUPABASE_URL + '/functions/v1/spectra-chat'; hd.Authorization = 'Bearer ' + s.access_token; hd.apikey = window.SPECSOFT_CONFIG.SUPABASE_ANON_KEY;
    const imgs = pendingImgs; pendingImgs = [];
    const nm = (CFG().nick || (($('[data-user-name]') || {}).textContent || '')).trim().slice(0, 20);
    body = { messages: h, persona: persona().id, think: modes().think, nick: nm, hour: new Date().getHours() }; if (imgs.length) body.images = imgs;
  }
  const r = await fetch(url, { method: 'POST', headers: hd, signal, body: JSON.stringify(body) });
  if (!r.ok || !r.body) {
    if (r.status === 429) { const tx = await r.text().catch(() => ''); throw new Error(/^daily/.test(tx) ? 'DAILY' : 'RATE'); }
    if (r.status === 413 || (r.status === 400 && body.images)) throw new Error('IMG');
    throw new Error(r.status === 401 ? 'LOGIN' : 'FAIL');
  }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (; ;) {
    const { done, value } = await rd.read(); if (done) return;
    buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop();
    for (const l of ls) {
      if (l.indexOf('data:') !== 0) continue; const x = l.slice(5).trim(); if (x === '[DONE]') return;
      try { const c = JSON.parse(x).choices[0].delta.content; if (c) onTok(c); } catch (e) { }
    }
  }
}
function setDev() {
  const u = prompt('9Router URL (ends in /v1):', 'http://localhost:20128/v1'); if (!u) return;
  const k = prompt('9Router API key:'); const m = prompt('Model / combo name:'); if (!k || !m) return;
  SS('sa.dev', { url: u, key: k, model: m, vision: /^y/i.test(prompt('Does this model support images? (y/n)') || '') }); toast('Dev mode saved in this browser only');
}

/* ---- Sending ---- */
const setBusy = b => { busy = b; sendBtn.classList.toggle('stop', b); sendBtn.setAttribute('aria-label', b ? 'Stop' : 'Send'); };
async function sendMsg(t) {
  t = (t || '').trim(); if (!t && atts.some(a => a.kind === 'image')) t = 'What do you think of this?'; if (!t && atts.length) return toast('Add a message with your attachment'); if (!t || busy) return;
  if (t === '/dev') { input.value = ''; setDev(); return; }
  if (!cur) { cur = { title: t.slice(0, 34), t: Date.now(), messages: [] }; chats.unshift(cur); }
  else { cur.t = Date.now(); chats = [cur, ...chats.filter(c => c !== cur)]; }
  const tx = atts.filter(a => a.kind === 'text'), im = atts.filter(a => a.kind === 'image');
  pendingImgs = im.map(a => a.data);
  const cleanT = sanitizeSpecsoftLinks(t);
  const full = cleanT + tx.map(a => '\n\n[Attached: ' + a.name + ']\n```\n' + a.data + '\n```').join('');
  const imN = im.map(a => a.name).join('  '), fN = tx.map(a => a.name).join('  ');
  const show = cleanT + (imN ? '\n🖼 ' + imN : '') + (fN ? '\n📎 ' + fN : '');
  const um = { role: 'user', content: sanitizeSpecsoftLinks(full), show: sanitizeSpecsoftLinks(show) };
  if (im.length) Object.defineProperty(um, '_imgs', { value: im.map(a => a.data), enumerable: false, writable: true });
  cur.messages.push(um); const chat = cur; atts = []; drawAtt(); const ai = { role: 'assistant', content: '' }; cur.messages.push(ai);
  input.value = ''; input.style.height = 'auto'; renderList(); renderChat(); setBusy(true); setMood('thinking');
  const el = msgsEl.lastElementChild; el.classList.add('live'); const body = el.querySelector('.sa-b'); let raw = '', mm = null; body.innerHTML = '<span class="sa-dots"><i></i><i></i><i></i></span>';
  const onTok = x => {
    raw += x;
    raw = sanitizeSpecsoftLinks(raw);
    let s = raw; const m = s.match(/^\s*\[mood:(\w+)\]\s*/i);
    if (m) { mm = m[1].toLowerCase(); s = s.slice(m[0].length); } else if (/^\s*\[[^\]]*$/.test(s)) s = '';
    ai.content = s; if (s) body.innerHTML = md(s); down();
  };
  const end = err => {
    setBusy(false); ctrl = null;
    if (err) { ai.err = 1; ai.content = err; setMood('pout'); } else setMood(mm || 'joy');
    save(); renderChat(); if (!err && ai.content) autoTitle(chat);
  };
  const h = cur.messages.slice(0, -1).map(m => ({ role: m.role, content: sanitizeSpecsoftLinks(m.content) }));
  if (backend() === 'demo') { const txt = demo(t); let i = 0; timer = setInterval(() => { onTok(txt.slice(i, i += 3)); if (i >= txt.length) { clearInterval(timer); timer = null; end(); } }, 16); return; }
  ctrl = new AbortController();
  try { await ask(h, onTok, ctrl.signal); end(); }
  catch (e) { if (e.name === 'AbortError') end(); else end(e.message === 'LOGIN' ? 'You need to **log in** to chat with Spectra.' : e.message === 'RATE' ? 'Slow down a bit, try again in a minute.' : e.message === 'IMG' ? "That image is too big or not supported 😭 try a smaller JPG, PNG or WebP." : e.message === 'DAILY' ? "You've used all your Spectra messages for today 😭 They reset at midnight UTC. Come back tomorrow, I'll miss you!" : "Spectra's brain is offline right now. Try again later."); }
}
function stop() { if (timer) { clearInterval(timer); timer = null; end(); } else if (ctrl) ctrl.abort(); }

/* ---- Message actions ---- */
msgsEl.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const w = b.closest('.sa-msg'); const i = [...msgsEl.children].indexOf(w); const m = cur && cur.messages[i];
  if (b.classList.contains('sa-cc') || b.classList.contains('sa-sv')) {
    const box = b.closest('.sa-code'), code = box.querySelector('code').textContent;
    if (b.classList.contains('sa-cc')) return copy(code);
    const a = LS('sa.assets', []); a.unshift({ lang: box.querySelector('.sa-code-h span').textContent, code, t: Date.now() }); SS('sa.assets', a.slice(0, 60)); return toast('Saved to Assets');
  }
  const a = b.dataset.a; if (!a || !m) return;
  if (a === 'copy') copy(m.content);
  else if (a === 'up' || a === 'down') { m.fb = m.fb === a ? null : a; save(); $$('.sa-pop.open').forEach(p => p.classList.remove('open')); const bs = w.querySelectorAll('[data-a=up],[data-a=down]'); bs[0].classList.toggle('on', m.fb === 'up'); bs[1].classList.toggle('on', m.fb === 'down'); if (m.fb) setMood(m.fb === 'up' ? 'love' : 'sad'); }
  else if (a === 'regen') { if (busy || i !== cur.messages.length - 1) return; cur.messages.pop(); const u = cur.messages.pop(); if (u._imgs && u._imgs.length) atts = u._imgs.map((d, k) => ({ kind: 'image', name: 'image ' + (k + 1), data: d })); sendMsg(u.content); }
  else if (a === 'more') b.parentNode.querySelector('.sa-pop').classList.toggle('open');
  else if (a === 'branch') { const c = { title: 'Branch: ' + cur.title, t: Date.now(), titled: true, messages: cur.messages.slice(0, i + 1).map(x => ({ ...x })) }; chats.unshift(c); save(); openChat(c); toast('Branched into a new chat'); }
  else toast(a === 'share' ? 'Share links come with the Supabase table (next phase)' : 'Legal reports come with the reports update (next phase)');
});
document.addEventListener('click', e => { if (!e.target.closest('.sa-pop') && !e.target.closest('[data-a=more]')) $$('.sa-pop.open').forEach(p => p.classList.remove('open')); });

/* ---- Search + Assets modal ---- */
const modal = $('#saModal'), qEl = $('#saQ'), res = $('#saRes');
function fill() {
  const q = qEl.value.toLowerCase(); res.innerHTML = '';
  if (modal.dataset.k === 's') {
    chats.filter(c => !q || c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q))).slice(0, 20).forEach(c => {
      const d = document.createElement('div'); d.className = 'sa-res'; d.textContent = c.title; d.onclick = () => { modal.classList.remove('on'); openChat(c); }; res.appendChild(d);
    });
  } else if (modal.dataset.k === 'l') {
    const m = c => !q || c.title.toLowerCase().includes(q);
    const grp = (name, list, kind) => { if (!list.length) return; res.insertAdjacentHTML('beforeend', '<div class="sa-label">' + name + '</div>'); list.forEach(c => { const d = document.createElement('div'); d.className = 'sa-res'; d.innerHTML = '<button data-lb="' + kind + '">' + (kind === 'arch' ? 'UNARCHIVE' : 'REMOVE') + '</button><span></span>'; d.lastChild.textContent = c.title; d._c = c; res.appendChild(d); }); };
    grp('Saved', chats.filter(c => c.lib && !c.arch && m(c)), 'lib'); grp('Archived', chats.filter(c => c.arch && m(c)), 'arch');
  } else {
    LS('sa.assets', []).forEach((a, i) => {
      if (q && !(a.lang + a.code).toLowerCase().includes(q)) return;
      const d = document.createElement('div'); d.className = 'sa-res';
      d.innerHTML = '<button data-x="' + i + '">DELETE</button><button data-c="' + i + '">COPY</button>' + esc(a.lang) + '<pre>' + esc(a.code.slice(0, 220)) + '</pre>'; res.appendChild(d);
    });
  }
  if (!res.children.length) res.innerHTML = '<div class="sa-empty">Nothing here yet.</div>';
}
function openModal(k) { modal.dataset.k = k; modal.classList.add('on'); qEl.value = ''; qEl.placeholder = k === 's' ? 'Search your chats...' : k === 'l' ? 'Search your library...' : 'Saved code (use SAVE on any code block)'; fill(); qEl.focus(); }
res.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const a = LS('sa.assets', []);
  if (b.dataset.c) copy(a[b.dataset.c].code); if (b.dataset.x) { a.splice(b.dataset.x, 1); SS('sa.assets', a); fill(); }
});
qEl.addEventListener('input', fill);
res.addEventListener('click', e => {
  if (modal.dataset.k !== 'l') return; const row = e.target.closest('.sa-res'); if (!row || !row._c) return; const c = row._c, b = e.target.closest('button[data-lb]');
  if (b) { if (b.dataset.lb === 'arch') c.arch = false; else c.lib = false; save(); renderList(); fill(); return; }
  modal.classList.remove('on'); if (!busy) openChat(c);
});
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('on'); });

/* ---- Wiring ---- */
sendBtn.onclick = () => busy ? stop() : sendMsg(input.value);
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMsg(input.value); } });
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  if (!busy) { setMood('confused'); clearTimeout(typing); typing = setTimeout(() => setMood('sparkle'), 2500); }
});
input.addEventListener('paste', e => {
  const fs = [...((e.clipboardData && e.clipboardData.files) || [])].filter(f => /^image\/(jpeg|png|webp|gif)$/.test(f.type)); if (!fs.length) return; e.preventDefault();
  fs.forEach(f => { const r = new FileReader(); r.onload = () => shrink(r.result).then(d => addAtt({ kind: 'image', name: f.name || 'pasted image.jpg', data: d })).catch(() => toast('Could not read that image')); r.readAsDataURL(f); });
});
$('#saNew').onclick = () => { if (busy) stop(); cur = null; renderList(); renderChat(); showGreeting(); app.classList.remove('drawer'); input.focus(); };
$('#saSearch').onclick = () => openModal('s'); $('#saAssets').onclick = () => openModal('a');
$('#saCollapse').onclick = () => SS('sa.min', app.classList.toggle('min')); $('#saBurger').onclick = () => app.classList.toggle('drawer');
$$('.sa-sug').forEach(b => b.onclick = () => b.dataset.p ? sendMsg(b.dataset.p) : input.focus());
$('#saLibrary').onclick = () => openModal('l'); // Library = saved + archived chats (Assets = saved code)
scrollEl.addEventListener('click', () => app.classList.remove('drawer'));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openModal('s'); }
  if (e.key === 'Escape') { modal.classList.remove('on'); $('#saSet').classList.remove('on'); if (busy) stop(); }
});

/* ---- Personas, settings, drawer backdrop ---- */
const pBtn = $('#saPersona'), pMenu = $('#saPMenu'), setM = $('#saSet'), nick = $('#saNick'), ex = $('#saExpr'), ty = $('#saTyping');
const drawP = () => { pBtn.title = 'Tools · ' + persona().n; pBtn.setAttribute('aria-label', 'Tools and persona: ' + persona().n); pBtn.classList.toggle('alt', persona().id !== 'spectra'); };
const attEl = $('#saAtt'), fileIn = $('#saFile');
const TOOLS = [['file', 'clip', 'Attach image or file'], ['shot', 'shot', 'Take a screenshot'], ['asset', 'cube', 'Upload from Assets'], ['search', 'globe', 'Web search', 1], ['think', 'brain', 'Deep reasoning'], ['research', 'radar', 'Deep research', 1]];
function drawMenu(sub) {
  const m = modes();
  pMenu.innerHTML = sub
    ? '<button type="button" data-back="1"><span>‹ Back</span></button>' + PERSONAS.map(x => '<button type="button" data-p="' + x.id + '">' + ico(x.i) + '<span>' + x.n + '</span></button>').join('')
    : TOOLS.map(t => '<button type="button" data-t="' + t[0] + '">' + ico(t[1]) + '<span>' + t[2] + '</span>' + (t[3] ? '<em>Soon</em>' : t[0] === 'think' && m.think ? '<em class="on">On</em>' : '') + '</button>').join('') + '<div class="sa-sep"></div><button type="button" data-persona="1">' + ico('spark') + '<span>Persona: ' + persona().n + '</span><em>›</em></button>';
}
function drawAtt() {
  attEl.innerHTML = (modes().think ? '<span class="sa-ac mode">' + ico('brain') + '<span>Deep reasoning</span><button data-m="think" aria-label="Turn off">×</button></span>' : '') +
    atts.map((a, i) => '<span class="sa-ac">' + (a.kind === 'image' ? '<img class="sa-th" src="' + a.data + '" alt="">' : ico('clip')) + '<span>' + esc(a.name) + '</span><button data-x="' + i + '" aria-label="Remove">×</button></span>').join('');
  attEl.hidden = !attEl.innerHTML;
}
const addAtt = a => { if (atts.length >= 5) return toast('Max 5 attachments'); if (a.kind === 'image' && atts.filter(x => x.kind === 'image').length >= 3) return toast('Max 3 images per message'); atts.push(a); drawAtt(); };
attEl.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.m) SS('sa.modes', { ...modes(), think: false }); else atts.splice(+b.dataset.x, 1); drawAtt(); };
fileIn.onchange = () => {
  [...fileIn.files].forEach(f => {
    const img = f.type.indexOf('image/') === 0; if (img && !/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return toast(f.name + ': use JPG, PNG, WebP or GIF');
    if (!img && !/\.(txt|md|json|js|ts|py|lua|luau|html|css|csv|xml|ya?ml|java|c|cpp|cs|sql|sh|log)$/i.test(f.name)) return toast(f.name + ': unsupported file type');
    if (f.size > (img ? 15e6 : 2e5)) return toast(f.name + ' is too big');
    const r = new FileReader(); r.onload = () => img ? shrink(r.result).then(d => addAtt({ kind: 'image', name: f.name, data: d })).catch(() => toast(f.name + ': could not read that image')) : addAtt({ kind: 'text', name: f.name, data: r.result });
    if (img) r.readAsDataURL(f); else r.readAsText(f);
  });
  fileIn.value = '';
};
async function screenshot() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return toast('Screenshots are not supported on this device');
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true }), v = document.createElement('video');
    v.srcObject = s; v.muted = true; await v.play(); await new Promise(r => setTimeout(r, 250));
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    s.getTracks().forEach(t => t.stop()); shrink(c.toDataURL('image/jpeg', .9)).then(d => addAtt({ kind: 'image', name: 'screenshot.jpg', data: d })).catch(() => toast('Could not use that screenshot'));
  } catch (e) { toast('Screenshot cancelled'); }
}
function tool(t) {
  if (t === 'file') fileIn.click();
  else if (t === 'shot') screenshot();
  else if (t === 'asset') { openModal('a'); modal.dataset.pick = '1'; qEl.placeholder = 'Pick a saved snippet to attach'; }
  else if (t === 'think') { const on = !modes().think; SS('sa.modes', { ...modes(), think: on }); drawAtt(); toast('Deep reasoning ' + (on ? 'on' : 'off')); }
  else toast('Needs a search API, we will wire it up in the 9Router step');
}
['#saAssets', '#saLibrary', '#saSearch'].forEach(s => $(s).addEventListener('click', () => { modal.dataset.pick = ''; }));
res.addEventListener('click', e => {
  if (modal.dataset.pick !== '1' || e.target.closest('button')) return;
  const r = e.target.closest('.sa-res'), x = r && r.querySelector('[data-x]'), a = x && LS('sa.assets', [])[x.dataset.x];
  if (a) { addAtt({ kind: 'text', name: a.lang + ' snippet', data: a.code }); modal.classList.remove('on'); modal.dataset.pick = ''; }
});
pBtn.onclick = e => { e.stopPropagation(); if (!pMenu.classList.contains('open')) drawMenu(false); pMenu.classList.toggle('open'); };
pMenu.onclick = e => {
  e.stopPropagation(); const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.persona) return drawMenu(true); if (b.dataset.back) return drawMenu(false);
  if (b.dataset.p) { SS('sa.persona', b.dataset.p); drawP(); pMenu.classList.remove('open'); toast(persona().n + ' mode on'); setMood('sparkle'); return; }
  pMenu.classList.remove('open'); tool(b.dataset.t);
};
document.addEventListener('click', () => pMenu.classList.remove('open'));
drawAtt();
drawP();
$('#saSettings').onclick = () => { const c = CFG(); nick.value = c.nick; ex.checked = c.expr; ty.checked = c.typing; setM.classList.add('on'); app.classList.remove('drawer'); };
const saveCfg = () => { SS('sa.cfg', { nick: nick.value.trim().slice(0, 20), expr: ex.checked, typing: ty.checked }); if (!ex.checked) { mood = ''; $$('.sa-face').forEach(i => { i.src = PFP; }); } };
[nick, ex, ty].forEach(x => x.addEventListener('change', saveCfg)); nick.addEventListener('input', saveCfg);
$('#saSetClose').onclick = () => setM.classList.remove('on');
setM.addEventListener('click', e => { if (e.target === setM) setM.classList.remove('on'); });
$('#saBack').onclick = () => app.classList.remove('drawer');
if (LS('sa.min', false)) app.classList.add('min');

/* ---- Profile: sidebar avatar + name. main.js (SpecAuth) fills them from the login session; this upgrades them with the live `profiles` row (avatar_url, display_name) ---- */
const avaEl = $('[data-user-avatar]'), nameEl = $('[data-user-name]');
let prof = null;
function paintProfile() {
  if (!prof || !window.SpecAuth) return;
  if (avaEl && !(avaEl.firstElementChild && avaEl.firstElementChild.dataset.prof)) {
    const a = window.SpecAuth.avatar({ name: prof.name, avatar: prof.avatar }); a.dataset.prof = '1';
    avaEl.textContent = ''; avaEl.appendChild(a);
  }
  if (nameEl && nameEl.textContent !== prof.name) nameEl.textContent = prof.name;
}
async function loadProfile() {
  try {
    const u = window.SpecAuth && window.SpecAuth.getUser(); if (!u) { prof = null; return; }
    const sb = window.getSupabaseClient && window.getSupabaseClient(); if (!sb) return;
    const { data } = await sb.from('profiles').select('username,display_name,avatar_url').eq('id', u.id).maybeSingle();
    if (!data) return;
    prof = { name: data.display_name || data.username || u.name, avatar: /^https:\/\//i.test(data.avatar_url || '') ? data.avatar_url : u.avatar };
    paintProfile();
  } catch (e) { }
}
/* main.js re-draws these hooks on login/logout/storage events; re-apply the profile row when that happens */
[avaEl, nameEl].forEach(el => el && new MutationObserver(paintProfile).observe(el, { childList: true, characterData: true, subtree: true }));
addEventListener('storage', () => setTimeout(() => { prof = null; loadProfile(); }, 60));
loadProfile();

renderList(); renderChat(); setTimeout(showGreeting, 700);
})();
