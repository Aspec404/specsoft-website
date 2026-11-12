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
const modes = () => ({ think: false, search: false, research: false, ...LS('sa.modes', {}) });
const THINK = 'Think through the problem step by step, double-check your work, then give a clear final answer.';
const backend = () => LS('sa.dev', null) ? 'direct' : LAUNCH;
const CFG = () => ({ nick: '', expr: true, typing: true, persona: '', enter: true, autotitle: true, memOn: true, recall: true, automem: true, notif: false, sound: false, shortcuts: true, len: 'normal', emo: 'normal', fs: 1, art: true, grid: true, calm: false, ...LS('sa.cfg', {}) });
const PERSONAS = [
  { id: 'custom', n: 'Use my custom one', i: 'pen', p: '' },
  { id: 'spectra', n: 'Spectra (Default)', i: 'spark', p: '' },
  { id: 'dev', n: 'Developer Mode', i: 'code', p: 'Focus on clean, correct code with brief explanations. Ask for the error message or code if it is missing.' },
  { id: 'creative', n: 'Creative', i: 'palette', p: 'Be imaginative and playful for ideas, stories and game design. Offer several options.' }];
const MODELS = [
  { id: '2.5', n: 'Spectrum 2.5', d: 'Fastest' },
  { id: '3', n: 'Spectrum 3', d: 'Balanced' },
  { id: '3.5', n: 'Spectrum 3.5', d: 'Smartest' }];
const model = () => MODELS.find(x => x.id === LS('sa.model', '3.5')) || MODELS[2];
const personaText = () => persona().id === 'custom' ? ((CFG().persona || '').trim() ? 'Follow this custom style from the user (tone and focus only): ' + CFG().persona.trim().slice(0, 400) : '') : persona().p;
const persona = () => PERSONAS.find(x => x.id === LS('sa.persona', 'spectra')) || PERSONAS[1];

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

/* ---- Windows 11 (Fluent 3D) emoji: uses emoji-data.js, the same list as chats. Anything not in the list stays a normal emoji ---- */
const EMO = (() => {
  const E = window.SPEC_EMOJI; if (!E || !E.list) return null;
  const m = new Map(), slug = r => (r[4] || r[1]).toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
  E.list.forEach(r => { const ch = String.fromCodePoint(...r[0].split('-').map(h => parseInt(h, 16))), u = E.base + slug(r) + '_' + r[0] + '.png'; m.set(ch, u); m.set(ch.replace(/\uFE0F/g, ''), u); });
  return m;
})();
const EMO_RX = /[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
function emo(ch) {
  if (!EMO || (!/\p{Emoji_Presentation}/u.test(ch) && !/[\uFE0F\u200D\u20E3]/.test(ch))) return null; // plain text symbols like ® or ™ stay as text
  return EMO.get(ch) || EMO.get(ch.replace(/\uFE0F/g, '')) || null;
}
const emojiHtml = h => EMO ? h.replace(EMO_RX, ch => { const u = emo(ch); return u ? '<img class="sa-emo" src="' + u + '" alt="' + ch + '" draggable="false">' : ch; }) : h;
function emojiNodes(t) {
  const f = document.createDocumentFragment(); let last = 0;
  if (EMO) t.replace(EMO_RX, (ch, i) => {
    const u = emo(ch); if (!u) return ch;
    if (i > last) f.appendChild(document.createTextNode(t.slice(last, i)));
    const im = document.createElement('img'); im.className = 'sa-emo'; im.src = u; im.alt = ch; im.draggable = false; f.appendChild(im); last = i + ch.length; return ch;
  });
  if (last < t.length) f.appendChild(document.createTextNode(t.slice(last)));
  return f;
}

/* ---- Code blocks: tiny built-in syntax highlighter (no libraries) ---- */
const W = s => new Set(s.split(' '));
const HLX = {
  lua: { kw: W('and break do else elseif end false for function goto if in local nil not or repeat return then true until while continue export type'), bi: W('print warn error assert pairs ipairs next select tostring tonumber typeof require pcall xpcall spawn delay wait task game workspace script Instance Vector3 Vector2 CFrame Color3 UDim2 UDim Enum math string table os coroutine Players RunService TweenService ReplicatedStorage ServerStorage'), lc: '--', bc: ['--[[', ']]'], ls: ['[[', ']]'], q: '"\'' },
  js: { kw: W('if else for while do switch case break continue return function var let const new class extends super this typeof instanceof in of delete void yield async await try catch finally throw import export from default static get set null undefined true false interface type enum implements readonly public private protected abstract declare namespace as'), bi: W('console window document Math JSON Object Array Promise Map Set Date String Number Boolean Error parseInt parseFloat setTimeout setInterval fetch require module exports'), lc: '//', bc: ['/*', '*/'], q: '"\'`' },
  py: { kw: W('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self'), bi: W('print len range str int float list dict set tuple open input enumerate zip map filter sorted sum min max abs isinstance super type'), lc: '#', tq: 1, q: '"\'' },
  sh: { kw: W('if then else elif fi for while do done case esac function in return exit export local'), bi: W('echo cd ls cat grep sed awk npm npx node git supabase curl chmod mkdir rm cp mv sudo source pip python netlify'), lc: '#', q: '"\'', dollar: 1 },
  sql: { ci: 1, kw: W('select from where insert into values update set delete create table alter drop index primary key foreign references not null default unique and or join left right inner outer on group by order having limit offset as distinct union all exists in like between is policy enable row level security function returns language begin end if then else case when cascade add column constraint check using with to for returning'), bi: W('count sum avg min max now coalesce auth uid int integer bigint text uuid boolean timestamptz timestamp date jsonb json varchar serial'), lc: '--', bc: ['/*', '*/'], q: '\'"' },
  json: { kw: W('true false null'), q: '"', json: 1 },
  css: { kw: W('important'), bc: ['/*', '*/'], q: '"\'', css: 1, prop: 1 },
  yaml: { kw: W('true false null yes no'), lc: '#', q: '"\'', prop: 1 },
  html: { kw: W(''), q: '"\'', html: 1 },
  c: { kw: W('if else for while do switch case break continue return struct union enum typedef static const volatile extern sizeof class public private protected namespace using template typename virtual override new delete this nullptr true false auto void int char float double long short unsigned signed bool include define'), bi: W('printf scanf malloc free std cout cin endl string vector map'), lc: '//', bc: ['/*', '*/'], q: '"\'' },
  cs: { kw: W('if else for foreach while do switch case break continue return class struct interface enum namespace using public private protected internal static readonly const new this base null true false void int string bool float double var async await try catch finally throw override virtual abstract sealed get set in out ref is as'), bi: W('Console List Dictionary Task Debug Math'), lc: '//', bc: ['/*', '*/'], q: '"\'' },
  java: { kw: W('if else for while do switch case break continue return class interface enum extends implements package import public private protected static final abstract new this super null true false void int long double float boolean char byte short try catch finally throw throws synchronized instanceof'), bi: W('System String List Map ArrayList HashMap Math Object'), lc: '//', bc: ['/*', '*/'], q: '"\'' },
  go: { kw: W('if else for range switch case break continue return func package import type struct interface map chan go defer select var const nil true false fallthrough goto default'), bi: W('fmt make len cap append panic recover string int bool error byte rune float64'), lc: '//', bc: ['/*', '*/'], q: '"\'`' },
  rs: { kw: W('if else for while loop match break continue return fn let mut const static struct enum impl trait pub use mod crate self super where as in ref move dyn async await unsafe extern type true false'), bi: W('println vec String Vec Option Some None Result Ok Err Box'), lc: '//', bc: ['/*', '*/'], q: '"' },
  php: { kw: W('if else elseif for foreach while do switch case break continue return function class extends implements interface namespace use public private protected static new echo null true false try catch finally throw as'), bi: W('array isset empty count strlen print_r var_dump'), lc: '//', bc: ['/*', '*/'], q: '"\'', dollar: 1 }
};
const HLA = { javascript: 'js', jsx: 'js', mjs: 'js', node: 'js', ts: 'js', typescript: 'js', tsx: 'js', py: 'py', python: 'py', luau: 'lua', lua: 'lua', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', htm: 'html', xml: 'html', svg: 'html', scss: 'css', jsonc: 'json', postgres: 'sql', pgsql: 'sql', 'c++': 'c', cpp: 'c', h: 'c', hpp: 'c', cc: 'c', csharp: 'cs', 'c#': 'cs', golang: 'go', rust: 'rs', yml: 'yaml', patch: 'diff' };
const HLN = { js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', jsx: 'JSX', py: 'Python', python: 'Python', lua: 'Lua', luau: 'Luau', sh: 'Shell', bash: 'Bash', shell: 'Shell', html: 'HTML', css: 'CSS', scss: 'SCSS', json: 'JSON', sql: 'SQL', c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#', 'c#': 'C#', java: 'Java', go: 'Go', rust: 'Rust', rs: 'Rust', php: 'PHP', yaml: 'YAML', yml: 'YAML', xml: 'XML', diff: 'Diff', md: 'Markdown', markdown: 'Markdown', text: 'Text', txt: 'Text', plaintext: 'Text' };
function hl(code, lang) {
  const n = code.length;
  if (n > 20000) return esc(code);
  if (lang === 'diff') return code.split('\n').map(l => { const c = l[0] === '+' && l.slice(0, 3) !== '+++' ? 'add' : l[0] === '-' && l.slice(0, 3) !== '---' ? 'del' : l.slice(0, 2) === '@@' ? 'k' : ''; return c && l ? '<span class="t-' + c + '">' + esc(l) + '</span>' : esc(l); }).join('\n');
  const L = HLX[lang]; if (!L) return esc(code);
  let out = '', i = 0, inTag = false;
  const put = (cls, s) => s.split('\n').forEach((x, k) => { if (k) out += '\n'; if (x) out += cls ? '<span class="t-' + cls + '">' + esc(x) + '</span>' : esc(x); });
  const span = (open, close, cls) => { let j = code.indexOf(close, i + open.length); j = j < 0 ? n : j + close.length; put(cls, code.slice(i, j)); i = j; };
  while (i < n) {
    const c = code[i];
    if (L.bc && code.startsWith(L.bc[0], i)) { span(L.bc[0], L.bc[1], 'c'); continue; }
    if (L.lc && code.startsWith(L.lc, i)) { let j = code.indexOf('\n', i); if (j < 0) j = n; put('c', code.slice(i, j)); i = j; continue; }
    if (L.html) {
      if (code.startsWith('<!--', i)) { span('<!--', '-->', 'c'); continue; }
      if (!inTag) { const m = /^<\/?[A-Za-z][\w:-]*/.exec(code.slice(i, i + 80)); if (m) { put('k', m[0]); i += m[0].length; inTag = true; continue; } put('', c); i++; continue; }
      if (c === '>' || code.startsWith('/>', i)) { const g = c === '>' ? '>' : '/>'; put('k', g); i += g.length; inTag = false; continue; }
    }
    if (L.ls && code.startsWith(L.ls[0], i)) { span(L.ls[0], L.ls[1], 's'); continue; }
    if (L.tq && (c === '"' || c === "'") && code.startsWith(c + c + c, i)) { span(c + c + c, c + c + c, 's'); continue; }
    if (L.q.indexOf(c) > -1) {
      let j = i + 1;
      while (j < n && code[j] !== c && !(code[j] === '\n' && c !== '`')) { if (code[j] === '\\') j++; j++; }
      if (j > n) j = n; if (code[j] === c) j++;
      const key = L.json && /^\s*:/.test(code.slice(j, j + 30));
      put(key ? 'p' : 's', code.slice(i, j)); i = j; continue;
    }
    if (L.dollar && c === '$') { const m = /^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?*!$-])/.exec(code.slice(i, i + 80)); if (m) { put('v', m[0]); i += m[0].length; continue; } }
    if (L.css && c === '#') { const m = /^#[0-9a-fA-F]{3,8}\b/.exec(code.slice(i, i + 12)); if (m) { put('n', m[0]); i += m[0].length; continue; } }
    if ((c >= '0' && c <= '9') || (c === '.' && code[i + 1] >= '0' && code[i + 1] <= '9')) { const m = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/.exec(code.slice(i, i + 40)); if (m) { put('n', m[0]); i += m[0].length; continue; } }
    const m = (L.css ? /^[A-Za-z_@-][\w-]*/ : /^[A-Za-z_$][\w$]*/).exec(code.slice(i, i + 80));
    if (m) {
      const w = m[0], lw = L.ci ? w.toLowerCase() : w, after = code.slice(i + w.length, i + w.length + 40);
      const cls = L.html ? (inTag ? 'p' : '') : L.kw.has(lw) ? 'k' : L.bi && L.bi.has(w) ? 'b' : L.prop && /^\s*:(?!:)/.test(after) ? 'p' : /^\s*\(/.test(after) ? 'f' : /^[A-Z][A-Za-z0-9_]/.test(w) ? 't' : '';
      put(cls, w); i += w.length; continue;
    }
    put('', c); i++;
  }
  return out;
}
function codeBlock(p) {
  const nl = p.indexOf('\n'), lang = (nl > -1 ? p.slice(0, nl) : '').trim(), code = (nl > -1 ? p.slice(nl + 1) : p).replace(/\n$/, '');
  const key = lang.toLowerCase(), n = code.split('\n').length;
  const body = hl(code, HLA[key] || key).split('\n').map((l, k, a) => '<span class="l">' + l + (k < a.length - 1 ? '\n' : '') + '</span>').join('');
  return '<div class="sa-code' + (n > 3 ? ' ln' : '') + (n > 24 ? ' long' : '') + '"><div class="sa-code-h"><span>' + esc(HLN[key] || lang || 'code') + '</span><span><button class="sa-wr" type="button">WRAP</button><button class="sa-cc" type="button">COPY</button><button class="sa-sv" type="button">SAVE</button></span></div><pre><code>' + body + '</code></pre>' + (n > 24 ? '<button class="sa-ex" type="button" data-n="' + n + '">Show all ' + n + ' lines</button>' : '') + '</div>';
}

/* ---- Math: LaTeX through KaTeX (loaded from cdnjs only when a message actually has math) ---- */
const KATEX = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/', mcache = new Map(); let kState = 0;
function loadKatex() {
  if (kState) return; kState = 1;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = KATEX + 'katex.min.css'; document.head.appendChild(l);
  const s = document.createElement('script'); s.src = KATEX + 'katex.min.js'; s.async = true;
  s.onload = () => { kState = 2; $$('.sa-math.pending').forEach(el => { el.outerHTML = mathHtml(el.textContent, el.classList.contains('d')); }); };
  s.onerror = () => { kState = 3; };
  document.head.appendChild(s);
}
function mathHtml(tex, disp) {
  tex = String(tex).trim(); const cls = 'sa-math' + (disp ? ' d' : ''), at = ' data-tex="' + esc(tex) + '" title="Hold to copy the LaTeX"';
  if (!tex || tex.length > 800) return '<span class="' + cls + ' bad"' + at + '>' + esc(tex) + '</span>';
  const k = (disp ? 'D' : 'I') + tex; if (mcache.has(k)) return mcache.get(k);
  if (!window.katex) { if (kState < 2) loadKatex(); return '<span class="' + cls + (kState === 3 ? ' bad' : ' pending') + '"' + at + '>' + esc(tex) + '</span>'; }
  let h; try { h = '<span class="' + cls + '"' + at + '>' + window.katex.renderToString(tex, { displayMode: !!disp, throwOnError: false, strict: 'ignore', trust: false, maxExpand: 1000 }) + '</span>'; } catch (e) { h = '<span class="' + cls + ' bad"' + at + '>' + esc(tex) + '</span>'; }
  mcache.set(k, h); return h;
}

/* ---- Markdown ---- */
/* ---- Chat formatting (Discord style): headings, quotes, lists, tables, spoilers, links, bold/italic/underline/strike ---- */
function inl(src) {
  const C = [], K = [];
  let h = esc(src.replace(/`([^`\n]+)`/g, (m, c) => '\uE002' + (C.push(c) - 1) + '\uE003'));
  const link = (u, t) => '\uE004' + (K.push('<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>') - 1) + '\uE005';
  h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)\uE000-\uE005]+)\)/g, (m, t, u) => link(u, t))
    .replace(/(^|[\s(])(https?:\/\/[^\s<\uE000-\uE005]*[^\s<.,;:!?)\]'"\uE000-\uE005])/g, (m, a, u) => a + link(u, u));
  h = h.replace(/\*\*\*(\S(?:[^\n]*?\S)?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(\S(?:[^\n]*?\S)?)\*\*/g, '<b>$1</b>')
    .replace(/__(\S(?:[^\n]*?\S)?)__/g, '<u>$1</u>')
    .replace(/(^|[^\w*])\*(\S(?:[^*\n]*?\S)?)\*(?![\w*])/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])_(\S(?:[^_\n]*?\S)?)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/~~(\S(?:[^\n]*?\S)?)~~/g, '<s>$1</s>')
    .replace(/\|\|(\S(?:[^\n]*?\S)?)\|\|/g, '<span class="sa-spoiler" tabindex="0">$1</span>');
  return emojiHtml(h).replace(/\uE004(\d+)\uE005/g, (m, k) => K[k]).replace(/\uE002(\d+)\uE003/g, (m, k) => '<code>' + esc(C[k]) + '</code>');
}
function renderList(items) {
  let out = '', st = [];
  for (const it of items) {
    while (st.length && it.ind < st[st.length - 1].ind) out += '</li></' + st.pop().t + '>';
    const top = st[st.length - 1];
    if (!top || it.ind > top.ind) { out += '<' + it.t + (it.t === 'ol' && it.num && +it.num !== 1 ? ' start="' + (+it.num) + '"' : '') + '><li>'; st.push({ t: it.t, ind: it.ind }); } else out += '</li><li>';
    out += it.html;
  }
  while (st.length) out += '</li></' + st.pop().t + '>';
  return out;
}
function blocks(p) {
  const L = p.split('\n'), out = [], para = []; let i = 0, m;
  const flush = () => { if (para.length) { out.push('<p class="sa-p">' + para.map(inl).join('<br>') + '</p>'); para.length = 0; } };
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  while (i < L.length) {
    const ln = L[i], s = ln.trim();
    if (!s) { flush(); i++; continue; }
    if (/^\uE000\d+\uE001$/.test(s)) { flush(); out.push(s); i++; continue; }
    if ((m = /^(#{1,4})\s+(.+)$/.exec(s))) { flush(); out.push('<h' + m[1].length + ' class="sa-h">' + inl(m[2]) + '</h' + m[1].length + '>'); i++; continue; }
    if ((m = /^-#\s+(.+)$/.exec(s))) { flush(); out.push('<div class="sa-subt">' + inl(m[1]) + '</div>'); i++; continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(s)) { flush(); out.push('<hr class="sa-hx">'); i++; continue; }
    if ((m = /^>>>\s?(.*)$/.exec(s))) { flush(); out.push('<blockquote class="sa-q">' + blocks([m[1]].concat(L.slice(i + 1)).join('\n')) + '</blockquote>'); i = L.length; continue; }
    if (s[0] === '>') { flush(); const q = []; while (i < L.length && /^\s*>/.test(L[i]) && !/^\s*>>>/.test(L[i])) { q.push(L[i].replace(/^\s*>\s?/, '')); i++; } out.push('<blockquote class="sa-q">' + blocks(q.join('\n')) + '</blockquote>'); continue; }
    if (s[0] === '|' && i + 1 < L.length && L[i + 1].indexOf('|') > -1 && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(L[i + 1])) {
      flush(); const head = cells(L[i]), al = cells(L[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''), rows = []; let j = i + 2;
      while (j < L.length && L[j].trim() && L[j].indexOf('|') > -1) rows.push(cells(L[j++]));
      const td = (t, k, tag) => '<' + tag + (al[k] ? ' style="text-align:' + al[k] + '"' : '') + '>' + inl(t) + '</' + tag + '>';
      out.push('<div class="sa-tbl"><table><thead><tr>' + head.map((c, k) => td(c, k, 'th')).join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + head.map((_, k) => td(r[k] || '', k, 'td')).join('') + '</tr>').join('') + '</tbody></table></div>');
      i = j; continue;
    }
    if (/^(\s*)([-*+]|\d{1,3}[.)])\s+\S/.test(ln)) {
      flush(); const items = [];
      while (i < L.length && (m = /^(\s*)([-*+]|(\d{1,3})[.)])\s+(.*)$/.exec(L[i]))) { items.push({ ind: m[1].replace(/\t/g, '    ').length, t: m[3] ? 'ol' : 'ul', num: m[3], html: inl(m[4]) }); i++; }
      out.push(renderList(items)); continue;
    }
    para.push(ln); i++;
  }
  flush(); return out.join('');
}
function md(t) {
  return t.replace(/[\uE000-\uE005]/g, '').split('```').map((p, i) => {
    if (i % 2) return codeBlock(p);
    const M = [], keep = (tex, d, src) => { tex = tex.replace(/\uE000(\d+)\uE001/g, (x, k) => M[k][2]); M.push([tex, d, src]); return '\uE000' + (M.length - 1) + '\uE001'; };
    p = p.split(/(`[^`\n]+`)/).map((x, k) => k % 2 ? x : x
      .replace(/\$\$([\s\S]+?)\$\$/g, (m, a) => keep(a, 1, m))
      .replace(/\\\[([\s\S]+?)\\\]/g, (m, a) => keep(a, 1, m))
      .replace(/\\\(([\s\S]+?)\\\)/g, (m, a) => keep(a, 0, m))
      .replace(/(^|[^\\$\d])\$([^\s$](?:[^$\n]*[^\s$])?)\$(?![\d$])/g, (m, a, b) => a + keep(b, 0, m.slice(a.length)))).join('');
    return blocks(p).replace(/\uE000(\d+)\uE001/g, (m, k) => mathHtml(M[k][0], M[k][1]));
  }).join('');
}

/* ---- Rendering ---- */
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
function srcHtml(m) {
  const ok = (m.sources || []).filter(s => s && typeof s.u === 'string' && /^https:\/\//i.test(s.u)).slice(0, 10);
  if (!ok.length) return '';
  const q = (m.queries || []).length ? '<div class="sa-sq">' + ico('search') + '<span>' + esc(m.queries.slice(0, 4).join(' \u00b7 ')) + '</span></div>' : '';
  return '<div class="sa-src"><div class="sa-sl">Sources</div>' + q + '<div class="sa-chips">' + ok.map(s => '<a class="sa-chip" href="' + esc(s.u) + '" target="_blank" rel="noopener noreferrer">' + ico('globe') + '<span>' + esc(String(s.t || hostOf(s.u) || 'source')) + '</span></a>').join('') + '</div></div>';
}
function paintSrc(el, m) {
  const col = el.querySelector('.sa-col'); if (!col) return;
  const old = col.querySelector('.sa-src'); if (old) old.remove();
  const h = srcHtml(m), act = col.querySelector('.sa-act'); if (h && act) act.insertAdjacentHTML('beforebegin', h);
}
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
    const ut = document.createElement('div'); ut.className = 'sa-ut'; ut.innerHTML = md(tx); b.appendChild(ut); return d;
  }
  d.innerHTML = '<img class="sa-av" src="' + PFP + '" alt=""><div class="sa-col"><div class="sa-b">' + md(m.content) + '</div>' + srcHtml(m) + memqHtml(m) + giftHtml(m) + '<div class="sa-act">' +
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
    it.innerHTML = (c.pin ? ico('pin') : '') + '<span></span><button class="sa-more" type="button" aria-label="Chat options">' + ico('more') + '</button>';
    const sp = it.querySelector('span'); sp.textContent = c.title;
    if (justTitled.has(c)) { justTitled.delete(c); const full = c.title; let i = 0; sp.textContent = ''; const iv = setInterval(() => { sp.textContent = full.slice(0, ++i); if (i >= full.length) clearInterval(iv); }, 32); }
    it.onclick = e => { const dt = e.target.closest('.sa-more'); if (dt) { e.stopPropagation(); return chatMenu(c, dt.getBoundingClientRect(), it); } if (!busy) openChat(c); };
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
  if (backend() !== 'supabase' || c.renamed || c.titled || !CFG().autotitle) return;
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
/* ---- Error messages: first person, funny, and they say what actually broke ---- */
const ERR = {
  LOGIN: "**Login required** 🔐 I don't talk to strangers, and you're a stranger rn. **Log in** and we're best friends again.",
  DAILY: "**Usage limit reached** 😭 you used up all your messages for today. My energy refills at midnight UTC. Come back tomorrow, I'll miss you!",
  RATE: "**Slow down, speedy** 🏎️ you're sending messages faster than I can blink. Give me a minute to catch my breath.",
  TRAFFIC: "**System traffic** 🚦 my brain is stuck in rush hour, everyone's talking to the robots at once. Try again in a sec!",
  BADGW: "**502 Bad Gateway** 💀 the server I rely on just ghosted me mid-sentence. Not you, not me, the pipes. Try again in a moment.",
  TIMEOUT: "**Timed out** ⏳ I thought so hard I forgot to answer. Hit regenerate or ask me again!",
  OFFLINE: "**No connection** 📡 I can't reach my brain. Are you offline? Check your internet and try again.",
  SERVER: "**500 Server error** 🔧 something's cursed on my end and I can't fix it myself. The SPECSOFT team needs to take a look.",
  MISSING: "**404 Brain not found** 🧠 I can't find my own brain, it might not be deployed yet. Tell the SPECSOFT team!",
  IMG: "**Image problem** 🖼️ that image is too big or not supported. Try a smaller JPG, PNG or WebP.",
  FAIL: "**My brain is offline** 😵 something broke and I'm not sure what. Try again in a bit."
};
function errCode(st, tx, hasImg) {
  if (st === 401) return 'LOGIN';
  if (st === 429) return /^daily/.test(tx) ? 'DAILY' : 'RATE';
  if (st === 413 || (st === 400 && hasImg)) return 'IMG';
  if (st === 404) return 'MISSING';
  if (st === 408 || st === 504) return 'TIMEOUT';
  if (st === 502 || st === 503) { if (st === 503 || /->\s*(429|503)|high demand|UNAVAILABLE|overload/i.test(tx)) return 'TRAFFIC'; if (/timeout/i.test(tx)) return 'TIMEOUT'; return 'BADGW'; }
  if (st >= 500) return 'SERVER';
  return 'FAIL';
}
async function ask(h, onTok, signal, onMeta) {
  let url, hd = { 'Content-Type': 'application/json' }, body;
  if (backend() === 'direct') {
    const d = LS('sa.dev', {}); url = d.url.replace(/\/$/, '') + '/chat/completions'; hd.Authorization = 'Bearer ' + d.key;
    let hh = h;
    if (pendingImgs.length) {
      if (d.vision) { hh = h.slice(); const l = hh[hh.length - 1]; hh[hh.length - 1] = { role: 'user', content: [{ type: 'text', text: l.content }, ...pendingImgs.map(u => ({ type: 'image_url', image_url: { url: u } }))] }; }
      else toast('Images skipped: this model has no vision enabled');
    }
    pendingImgs = [];
    body = { model: d.model, stream: true, messages: [{ role: 'system', content: SYS + ' ' + personaText() + (modes().think ? ' ' + THINK : '') }, ...hh] };
  } else {
    const sb = window.getSupabaseClient && window.getSupabaseClient(); const s = sb && (await sb.auth.getSession()).data.session;
    if (!s) throw new Error('LOGIN');
    url = window.SPECSOFT_CONFIG.SUPABASE_URL + '/functions/v1/spectra-chat'; hd.Authorization = 'Bearer ' + s.access_token; hd.apikey = window.SPECSOFT_CONFIG.SUPABASE_ANON_KEY;
    const imgs = pendingImgs; pendingImgs = [];
    const nm = (CFG().nick || (($('[data-user-name]') || {}).textContent || '')).trim().slice(0, 20);
    const md3 = modes(); body = { messages: h, persona: persona().id, custom: persona().id === 'custom' ? (CFG().persona || '').slice(0, 400) : '', model: model().id, think: !!md3.think && !md3.research, search: !!md3.search, research: !!md3.research, nick: nm, hour: new Date().getHours(), memory: CFG().memOn ? mem().map(m => m.t) : [], recent: recentCtx(), style: { len: CFG().len, emo: CFG().emo } }; if (imgs.length) body.images = imgs;
  }
  const r = await fetch(url, { method: 'POST', headers: hd, signal, body: JSON.stringify(body) });
  const lf = r.headers.get('X-Spectra-Left'), lm = r.headers.get('X-Spectra-Limit');
  if (lf !== null && lm !== null && !isNaN(+lf) && +lm > 0) SS('sa.left', { left: +lf, limit: +lm, day: new Date().toISOString().slice(0, 10) });
  const go = +r.headers.get('X-Spectra-Offer'); if (go > 0 && onMeta) { let nt = ''; try { nt = decodeURIComponent(r.headers.get('X-Spectra-Offer-Note') || ''); } catch (e) { } onMeta({ offer: { amount: go, note: nt.slice(0, 90) } }); }
  const gerr = r.headers.get('X-Spectra-Gift-Error'); if (gerr) console.warn('Spectra could not gift credits. Error code:', gerr, '(open the spectra-chat function logs in Supabase for the full message)');
  if (!r.ok || !r.body) { const tx = await r.text().catch(() => ''); throw new Error(errCode(r.status, tx, !!body.images)); }
  if (onMeta && r.headers.get('X-Spectra-Search') === 'failed') onMeta({ nosearch: 1 });
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (; ;) {
    const { done, value } = await rd.read(); if (done) return;
    buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop();
    for (const l of ls) {
      if (l.indexOf('data:') !== 0) continue; const x = l.slice(5).trim(); if (x === '[DONE]') return;
      try { const j = JSON.parse(x); if (j.status || j.sources || j.queries || j.offer) { if (onMeta) onMeta(j); } else { const c = j.choices[0].delta.content; if (c) onTok(c); } } catch (e) { }
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
  if (/^\/remember\s+\S/i.test(t)) { addMem(t.replace(/^\/remember\s+/i, '')); input.value = ''; input.style.height = 'auto'; return; }
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
  const el = msgsEl.lastElementChild; el.classList.add('live'); const body = el.querySelector('.sa-b'); let raw = '', mm = null; const wm = modes(), web = backend() === 'supabase' && (wm.research || wm.search);
  body.innerHTML = '<span class="sa-dots"><i></i><i></i><i></i></span>' + (web ? '<span class="sa-stat">' + (wm.research ? 'Researching the web\u2026' : 'Searching the web\u2026') + '</span>' : '');
  const onMeta = j => {
    if (j.offer && !ai.gift) {
      ai.gift = { amount: +j.offer.amount || 0, note: String(j.offer.note || '').slice(0, 90), state: 'pending', ts: Date.now() };
      chats.forEach(c => c.messages.forEach(x => { if (x !== ai && x.gift && x.gift.state === 'pending') x.gift.state = 'expired'; })); // older cards are replaced by this one
      setMood('joy');
    }
    if (j.sources) { ai.sources = j.sources; ai.queries = j.queries || []; paintSrc(el, ai); down(); }
    else if (j.queries && j.queries.length) { const st = body.querySelector('.sa-stat'); if (st) st.textContent = 'Reading: ' + j.queries[0].slice(0, 40); }
    if (j.nosearch) toast('Search was unavailable, so I answered without it');
  };
  const onTok = x => {
    raw += x;
    raw = sanitizeSpecsoftLinks(raw);
    let s = raw; const m = s.match(/^\s*\[mood:(\w+)\]\s*/i);
    if (m) { mm = m[1].toLowerCase(); s = s.slice(m[0].length); } else if (/^\s*\[[^\]]*$/.test(s)) s = '';
    s = cleanFake(s); ai.content = s; if (s) body.innerHTML = md(s); down();
  };
  const end = err => {
    const gone = ctrl && ctrl.signal.aborted; setBusy(false); ctrl = null;
    if (!err && !ai.content && !gone && backend() !== 'demo') err = ERR.FAIL;
    if (err) { ai.err = 1; ai.content = err; setMood('pout'); } else setMood(mm || 'joy');
    save(); renderChat(); if (!err && ai.content) { autoTitle(chat); notifyDone(ai.content); maybeNote(chat, ai, t); }
  };
  const h = cur.messages.slice(0, -1).map(m => ({ role: m.role, content: sanitizeSpecsoftLinks(m.content) }));
  if (backend() === 'demo') { const txt = demo(t); let i = 0; timer = setInterval(() => { onTok(txt.slice(i, i += 3)); if (i >= txt.length) { clearInterval(timer); timer = null; end(); } }, 16); return; }
  ctrl = new AbortController();
  try { await ask(h, onTok, ctrl.signal, onMeta); end(); }
  catch (e) { if (e.name === 'AbortError') end(); else { if (!ERR[e.message]) console.error('Spectra request failed:', e); end(ERR[e.message] || (e instanceof TypeError && navigator.onLine === false ? ERR.OFFLINE : ERR.FAIL)); } }
}
function stop() { if (timer) { clearInterval(timer); timer = null; end(); } else if (ctrl) ctrl.abort(); }

/* ---- Message actions ---- */
msgsEl.addEventListener('error', e => { const t = e.target; if (t && t.classList && t.classList.contains('sa-emo')) t.replaceWith(document.createTextNode(t.alt)); }, true);
/* hold a formula (about half a second) to copy its LaTeX code */
let hold = 0, hp = null;
const unhold = () => { clearTimeout(hold); hold = 0; };
msgsEl.addEventListener('pointerdown', e => {
  const m = e.target.closest && e.target.closest('.sa-math'); if (!m || (e.pointerType === 'mouse' && e.button !== 0)) return;
  unhold(); hp = [e.clientX, e.clientY];
  hold = setTimeout(() => { hold = 0; copy(m.dataset.tex || m.textContent, 'LaTeX copied!'); m.classList.add('copied'); setTimeout(() => m.classList.remove('copied'), 650); }, 500);
});
msgsEl.addEventListener('pointermove', e => { if (hold && hp && Math.hypot(e.clientX - hp[0], e.clientY - hp[1]) > 10) unhold(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => msgsEl.addEventListener(t, unhold, true));
msgsEl.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('.sa-math') && matchMedia('(hover: none)').matches) e.preventDefault(); });
msgsEl.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('sa-spoiler')) { e.preventDefault(); e.target.classList.toggle('on'); } });
msgsEl.addEventListener('click', e => {
  const sp = e.target.closest('.sa-spoiler'); if (sp) { sp.classList.toggle('on'); return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('sa-wr')) { b.closest('.sa-code').classList.toggle('wrap'); b.classList.toggle('on'); return; }
  if (b.classList.contains('sa-ex')) { const bx = b.closest('.sa-code'); bx.classList.toggle('open'); b.textContent = bx.classList.contains('open') ? 'Collapse' : 'Show all ' + b.dataset.n + ' lines'; return; }
  const w = b.closest('.sa-msg'); const i = [...msgsEl.children].indexOf(w); const m = cur && cur.messages[i];
  if (b.classList.contains('sa-cc') || b.classList.contains('sa-sv')) {
    const box = b.closest('.sa-code'), code = box.querySelector('code').textContent;
    if (b.classList.contains('sa-cc')) { copy(code); b.textContent = 'COPIED'; b.classList.add('ok'); setTimeout(() => { b.textContent = 'COPY'; b.classList.remove('ok'); }, 1400); return; }
    const a = LS('sa.assets', []); a.unshift({ lang: box.querySelector('.sa-code-h span').textContent, code, t: Date.now() }); SS('sa.assets', a.slice(0, 60)); return toast('Saved to Assets');
  }
  const a = b.dataset.a; if (!a || !m) return;
  if (a === 'gacc' || a === 'grej') giftAct(m, a === 'gacc' ? 'accept' : 'reject', b);
  else if (a === 'memyes' || a === 'memno') { if (a === 'memyes') addMem(m.memq); delete m.memq; save(); const q = b.closest('.sa-mq'); if (q) q.remove(); }
  else if (a === 'copy') copy(m.content);
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
input.addEventListener('keydown', e => { if (e.key !== 'Enter' || e.isComposing) return; if (CFG().enter ? !e.shiftKey : (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendMsg(input.value); } });
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
$$('.sa-sug').forEach(b => b.onclick = () => {
  if (b.dataset.mode) { if (!modes()[b.dataset.mode]) setMode(b.dataset.mode); else input.focus(); return; }
  b.dataset.p ? sendMsg(b.dataset.p) : input.focus();
});
$('#saLibrary').onclick = () => openModal('l'); // Library = saved + archived chats (Assets = saved code)
scrollEl.addEventListener('click', () => app.classList.remove('drawer'));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openModal('s'); }
  if (e.key === 'Escape') { modal.classList.remove('on'); $('#saSet').classList.remove('on'); if (busy) stop(); }
});

/* ---- Personas, settings, drawer backdrop ---- */
const pBtn = $('#saPersona'), pMenu = $('#saPMenu');
const drawP = () => { pBtn.title = 'Tools · ' + persona().n + ' · ' + model().n; pBtn.setAttribute('aria-label', 'Tools and persona: ' + persona().n); pBtn.classList.toggle('alt', persona().id !== 'spectra' || model().id !== '3.5'); };
const attEl = $('#saAtt'), fileIn = $('#saFile');
const TOOLS = [['file', 'clip', 'Attach image or file'], ['shot', 'shot', 'Take a screenshot'], ['asset', 'cube', 'Upload from Assets'], ['search', 'globe', 'Web search'], ['think', 'brain', 'Deep reasoning'], ['research', 'radar', 'Deep research']];
function drawMenu(sub) {
  const m = modes(), back = '<button type="button" data-back="1"><span>\u2039 Back</span></button>';
  if (sub === 'persona') {
    pMenu.innerHTML = back + '<div class="sa-h">Persona</div>' + PERSONAS.map(x => '<button type="button" data-p="' + x.id + '"' + (x.id === persona().id ? ' class="cur"' : '') + '>' + ico(x.i) + '<span>' + x.n + (x.id === 'custom' && !(CFG().persona || '').trim() ? '<small>Write it in Settings</small>' : '') + '</span>' + (x.id === persona().id ? '<em class="on">On</em>' : '') + '</button>').join('');
  } else if (sub === 'model') {
    pMenu.innerHTML = back + '<div class="sa-h">Model</div>' + MODELS.map(x => '<button type="button" data-mdl="' + x.id + '"' + (x.id === model().id ? ' class="cur"' : '') + '>' + ico('cube') + '<span>' + x.n + '<small>' + x.d + '</small></span>' + (x.id === model().id ? '<em class="on">On</em>' : '') + '</button>').join('');
  } else {
    pMenu.innerHTML = TOOLS.map(t => '<button type="button" data-t="' + t[0] + '">' + ico(t[1]) + '<span>' + t[2] + '</span>' + (m[t[0]] ? '<em class="on">On</em>' : '') + '</button>').join('') +
      '<div class="sa-sep"></div><button type="button" data-persona="1">' + ico('spark') + '<span>Persona: ' + persona().n + '</span><em>\u203a</em></button>' +
      '<button type="button" data-model="1">' + ico('cube') + '<span>Model: ' + model().n + '</span><em>\u203a</em></button>';
  }
}
const MODE_META = { think: ['brain', 'Deep reasoning'], search: ['globe', 'Web search'], research: ['radar', 'Deep research'] };
const modeChips = () => Object.keys(MODE_META).filter(k => modes()[k]).map(k => '<span class="sa-ac mode">' + ico(MODE_META[k][0]) + '<span>' + MODE_META[k][1] + '</span><button data-m="' + k + '" aria-label="Turn off">\u00d7</button></span>').join('');
function drawAtt() {
  attEl.innerHTML = modeChips() +
    atts.map((a, i) => '<span class="sa-ac">' + (a.kind === 'image' ? '<img class="sa-th" src="' + a.data + '" alt="">' : ico('clip')) + '<span>' + esc(a.name) + '</span><button data-x="' + i + '" aria-label="Remove">×</button></span>').join('');
  attEl.hidden = !attEl.innerHTML;
  const md2 = modes(); input.placeholder = md2.research ? 'What should Spectra research?' : md2.search ? 'Ask Spectra to search the web...' : 'Send a message to Spectra...';
}
const addAtt = a => { if (atts.length >= 5) return toast('Max 5 attachments'); if (a.kind === 'image' && atts.filter(x => x.kind === 'image').length >= 3) return toast('Max 3 images per message'); atts.push(a); drawAtt(); };
attEl.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.m) SS('sa.modes', { ...modes(), [b.dataset.m]: false }); else atts.splice(+b.dataset.x, 1); drawAtt(); };
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
function setMode(k) {
  const m = modes(), on = !m[k], n = { ...m, [k]: on };
  if (on && k === 'search') n.research = false;
  if (on && k === 'research') { n.search = false; n.think = false; }
  SS('sa.modes', n); drawAtt();
  if (on && k !== 'think' && backend() === 'direct') return toast(MODE_META[k][1] + ' needs the SPECSOFT backend (dev mode skips it)');
  toast(MODE_META[k][1] + (on ? ' on' + (k === 'search' ? ' (uses extra credits)' : k === 'research' ? ' (uses the most credits)' : '') : ' off'));
  if (on) input.focus();
}
function tool(t) {
  if (t === 'file') fileIn.click();
  else if (t === 'shot') screenshot();
  else if (t === 'asset') { openModal('a'); modal.dataset.pick = '1'; qEl.placeholder = 'Pick a saved snippet to attach'; }
  else if (t === 'think' || t === 'search' || t === 'research') setMode(t);
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
  if (b.dataset.persona) return drawMenu('persona'); if (b.dataset.model) return drawMenu('model'); if (b.dataset.back) return drawMenu(false);
  if (b.dataset.mdl) { SS('sa.model', b.dataset.mdl); drawP(); pMenu.classList.remove('open'); toast(model().n + ' selected'); setMood('sparkle'); return; }
  if (b.dataset.p) {
    if (b.dataset.p === 'custom' && !(CFG().persona || '').trim()) { pMenu.classList.remove('open'); toast('Write your custom persona first'); return openSettings('personal'); }
    SS('sa.persona', b.dataset.p); drawP(); pMenu.classList.remove('open'); toast(persona().n + (b.dataset.p === 'spectra' ? ' is back' : ' on')); setMood('sparkle'); return;
  }
  pMenu.classList.remove('open'); tool(b.dataset.t);
};
document.addEventListener('click', () => pMenu.classList.remove('open'));
drawAtt();
drawP();
/* ---- Settings center: General, Personalization, Memory, Appearance, Notifications, Shortcuts, Usage limits, Data controls, About, Report bug ---- */
const setM = $('#saSet'), sxNav = $('#sxNav'), sxPane = $('#sxPane');
const MOD = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '') ? '\u2318' : 'Ctrl';
const putCfg = (k, v) => { SS('sa.cfg', { ...CFG(), [k]: v }); applyCfg(); };
const mem = () => { const a = LS('sa.mem', []); return Array.isArray(a) ? a.filter(x => x && typeof x.t === 'string').slice(0, 20) : []; };
function addMem(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim().slice(0, 160); if (!t) return false;
  const a = mem(); if (a.some(x => x.t.toLowerCase() === t.toLowerCase())) { toast('Already saved'); return false; }
  if (a.length >= 20) { toast('Memory is full (20 notes). Delete one first'); return false; }
  a.push({ t, ts: Date.now() }); SS('sa.mem', a); toast(CFG().memOn ? 'Saved to memory' : 'Saved (memory is off in Settings)'); return true;
}
/* ---- Memory across chats: digest of your latest other chats + suggested notes ---- */
function recentCtx() {
  if (!CFG().recall || !cur) return [];
  if (cur.messages.filter(x => x.role === 'user').length > 6) return [];
  return chats.filter(c => c !== cur && !c.arch && c.messages && c.messages.some(x => x.role === 'assistant' && x.content && !x.err)).slice(0, 2)
    .map(c => ({ title: String(c.title || '').slice(0, 40), msgs: c.messages.filter(x => !x.err && x.content).slice(-4).map(x => ({ role: x.role, content: String(x.show || x.content).slice(0, 220) })) }));
}
function giftHtml(m) {
  const g = m.gift; if (!g || m.err) return '';
  const st = g.state === 'pending' && Date.now() - (g.ts || 0) > 2 * 36e5 ? 'expired' : g.state;
  const foot = st === 'pending'
    ? '<button type="button" class="sa-gacc" data-a="gacc">Accept</button><button type="button" class="sa-grej" data-a="grej">Reject</button>'
    : '<span class="sa-gst">' + ({ accepted: 'Accepted \u00b7 +' + g.amount + ' APEX Credits added', rejected: 'Rejected \u00b7 no credits added', expired: 'This gift expired' }[st] || '') + '</span>';
  return '<div class="sa-gift ' + st + '"><div class="sa-gh">' + ico('spark') + '<span>GIFT</span></div><div class="sa-gt">Spectra just gave you <b>' + (+g.amount || 0) + '</b> APEX Credits!</div>' +
    (g.note ? '<div class="sa-gn"><small>Note from Spectra</small><p>' + esc(g.note) + '</p></div>' : '') + '<div class="sa-gb">' + foot + '</div></div>';
}
/* Spectra sometimes tries to draw her own fake gift card (a markdown image with a data: link). The real card is built by the page, so drop the fake. */
function cleanFake(s) { return String(s).replace(/!\[[^\]]*\]\(\s*data:[^)\s]*\)?/gi, '').replace(/^[ \t]*\[GIFT OFFER\][ \t]*\n?/gim, '').replace(/^\s+/, ''); }
let giftBusy = false;
async function giftAct(m, act, b) {
  const g = m.gift; if (!g || g.state !== 'pending' || giftBusy) return;
  giftBusy = true; const card = b.closest('.sa-gift'); if (card) card.querySelectorAll('button').forEach(x => { x.disabled = true; }); b.textContent = '...';
  const home = chats.find(c => c.messages.includes(m));
  try {
    const q = await sbReq(), rs = await fetch(q.url, { method: 'POST', headers: q.headers, body: JSON.stringify({ mode: 'gift', action: act }) });
    const j = rs.ok || rs.status === 200 ? await rs.json() : null; if (!j) throw 0;
    if (!j.ok) { if (j.error === 'expired' || j.error === 'none') { g.state = 'expired'; toast('That gift is not available anymore'); } else throw 0; }
    else {
      g.state = act === 'accept' ? 'accepted' : 'rejected';
      if (home && j.reply) home.messages.push({ role: 'assistant', content: String(j.reply).slice(0, 400) });
      if (act === 'accept') { toast('+' + g.amount + ' APEX Credits'); try { if (window.ApexCredits) window.ApexCredits.refresh(); } catch (e) { } setMood('joy'); } else setMood('pout');
    }
  } catch (e) { toast('Could not reach Spectra. Try again'); }
  giftBusy = false; save(); if (home === cur) { renderChat(); down(); }
}
function memqHtml(m) {
  return m.memq && !m.err ? '<div class="sa-mq"><span>Remember <b>' + esc(m.memq) + '</b> for next time?</span><button type="button" data-a="memyes">Save</button><button type="button" data-a="memno">No</button></div>' : '';
}
async function maybeNote(chat, ai, text) {
  const c = CFG();
  if (!c.automem || !c.memOn || backend() !== 'supabase' || ai.err || ai.memq) return;
  if (text.length < 15 || text.length > 400 || text[0] === '/' || !/\b(i am|i'm|im|i like|i love|i use|i make|i build|i prefer|i work|i play|i study|i want|i need|i code|my name|my favorite|my fave|my game|my project|my server|my team|call me)\b/i.test(text)) return;
  if (mem().length >= 20 || Date.now() - (+LS('sa.memt', 0) || 0) < 90000) return;
  SS('sa.memt', Date.now());
  try {
    const q = await sbReq(), rs = await fetch(q.url, { method: 'POST', headers: q.headers, body: JSON.stringify({ mode: 'memory', user: text.slice(0, 400) }) });
    const j = rs.ok ? await rs.json() : null, n = j && typeof j.note === 'string' ? j.note.trim().slice(0, 100) : '';
    if (!n || mem().some(x => x.t.toLowerCase() === n.toLowerCase())) return;
    ai.memq = n; save();
    if (cur === chat && !busy && cur.messages[cur.messages.length - 1] === ai) {
      const col = msgsEl.lastElementChild && msgsEl.lastElementChild.querySelector('.sa-col'), act = col && col.querySelector('.sa-act');
      if (act && !col.querySelector('.sa-mq')) act.insertAdjacentHTML('beforebegin', memqHtml(ai));
    }
  } catch (e) { }
}
function applyCfg() {
  const c = CFG();
  app.style.setProperty('--sa-fs', c.fs);
  app.classList.toggle('no-art', !c.art); app.classList.toggle('no-grid', !c.grid); app.classList.toggle('calm', !!c.calm);
  const hint = $('.sa-hint'); if (hint) hint.textContent = (c.enter ? 'Enter to send \u00b7 Shift+Enter for a new line' : MOD + '+Enter to send \u00b7 Enter for a new line') + ' \u00b7 Spectra can make mistakes';
  if (!c.expr) { mood = ''; $$('.sa-face').forEach(i => { i.src = PFP; }); }
  drawP();
}
/* notifications + sound when a reply finishes */
function blip() {
  try {
    const A = window.AudioContext || window.webkitAudioContext, a = new A(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(880, t + .09);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .26);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(t + .28); setTimeout(() => a.close(), 500);
  } catch (e) { }
}
function pingNote(body) {
  try { const n = new Notification('Spectra', { body, icon: PFP, tag: 'spectra' }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { }
}
function notifyDone(txt) {
  const c = CFG(); if (c.sound) blip();
  if (c.notif && document.hidden && 'Notification' in window && Notification.permission === 'granted') pingNote(String(txt).replace(/[*_`#>|~\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Your reply is ready');
}
function askNotif(box) {
  if (!('Notification' in window)) { box.checked = false; return toast('This browser does not support notifications'); }
  Notification.requestPermission().then(p => { if (p === 'granted') putCfg('notif', true); else { box.checked = false; putCfg('notif', false); toast('Notifications are blocked in your browser settings'); } });
}

/* small UI builders */
const SEGS = {};
const sw = (k, on) => '<label class="sx-sw"><input type="checkbox" data-sw="' + k + '"' + (on ? ' checked' : '') + '><i></i></label>';
const seg = (k, opts, cur) => { SEGS[k] = opts; return '<div class="sx-seg" data-seg="' + k + '">' + opts.map((o, i) => '<button type="button" data-i="' + i + '" class="' + (o[0] === cur ? 'on' : '') + '">' + o[1] + '</button>').join('') + '</div>'; };
const r = (l, d, ctl, stack) => '<div class="sx-r' + (stack ? ' stack' : '') + '"><div class="sx-t"><b>' + l + '</b>' + (d ? '<span>' + d + '</span>' : '') + '</div>' + (ctl ? '<div class="sx-c">' + ctl + '</div>' : '') + '</div>';
const sec = t => '<h4 class="sx-sec">' + t + '</h4>';
const btn = (act, label, cls) => '<button type="button" class="sx-btn' + (cls ? ' ' + cls : '') + '" data-act="' + act + '">' + label + '</button>';
const kbds = s => s.split(' ').map(x => '<kbd class="sx-k">' + esc(x) + '</kbd>').join('');
function sure(b, fn) {
  if (b.dataset.sure) { delete b.dataset.sure; return fn(); }
  b.dataset.sure = 1; const t = b.textContent; b.textContent = 'Click again to confirm';
  setTimeout(() => { if (b.isConnected && b.dataset.sure) { delete b.dataset.sure; b.textContent = t; } }, 3000);
}

const PANES = {
  general() {
    const c = CFG();
    return sec('Chat') +
      r('Nickname', 'What Spectra calls you. Leave it empty to use your profile name.', '<input class="sx-in" data-txt="nick" maxlength="20" placeholder="Bro" value="' + esc(c.nick) + '">', 1) +
      r('Send with Enter', 'Off means ' + MOD + '+Enter sends and Enter adds a new line.', sw('enter', c.enter)) +
      r('Auto-name chats', 'Spectra titles new chats from your first message.', sw('autotitle', c.autotitle)) +
      sec('Spectra') +
      r('Typing animation', 'Her greeting types itself out.', sw('typing', c.typing)) +
      r('Live expressions', 'Her face changes with her mood.', sw('expr', c.expr));
  },
  personal() {
    const c = CFG();
    return sec('Persona') +
      r('Persona', 'How Spectra shows up for you.', seg('persona', PERSONAS.map(p => [p.id, p.n]), persona().id), 1) +
      '<div class="sx-r col"><div class="sx-t"><b>Custom persona</b><span>Used when "Use my custom one" is picked. It changes tone and focus only, never her rules.</span></div><textarea class="sx-ta" data-txt="persona" maxlength="400" rows="4" placeholder="e.g. short answers, hype energy, explain things like I\'m new to coding.">' + esc(c.persona) + '</textarea></div>' +
      sec('Model and style') +
      r('Model', 'Faster or smarter, your call.', seg('model', MODELS.map(m => [m.id, m.n]), model().id), 1) +
      r('Reply length', 'How much she writes by default.', seg('len', [['short', 'Short'], ['normal', 'Normal'], ['detailed', 'Detailed']], c.len), 1) +
      r('Emojis', 'How many she sprinkles in.', seg('emo', [['few', 'Less'], ['normal', 'Normal'], ['lots', 'More']], c.emo), 1);
  },
  memory() {
    const c = CFG(), a = mem();
    return sec('Memory') +
      r('Use memory', 'Spectra reads these notes in every chat while this is on. Notes only change what she knows about you, never her rules.', sw('memOn', c.memOn)) +
      r('Recall recent chats', 'At the start of a new chat, Spectra can see a short digest of your latest two chats, so she can pick up where you left off.', sw('recall', c.recall)) +
      r('Suggest notes', 'When you tell her something lasting about yourself, she offers to save it. Nothing is saved unless you tap Save.', sw('automem', c.automem)) +
      sec('Saved notes (' + a.length + '/20)') +
      (a.length ? a.map((m, i) => '<div class="sx-mi"><span>' + esc(m.t) + '</span><button type="button" data-act="memdel" data-i="' + i + '" aria-label="Delete note">\u00d7</button></div>').join('') : '<div class="sx-empty">Nothing saved yet. Add a note below, or type <b>/remember your note</b> in the chat box.</div>') +
      '<div class="sx-add"><input class="sx-in" id="sxMemIn" maxlength="160" placeholder="e.g. I make Roblox obbies"><button type="button" class="sx-btn main" data-act="memadd">Add</button></div>' +
      (a.length ? '<div style="padding-top:14px">' + btn('memclear', 'Clear all notes', 'danger') + '</div>' : '') +
      '<div class="sx-empty">Notes live in this browser on this device. Don\'t put passwords or private info in here.</div>';
  },
  look() {
    const c = CFG();
    return sec('Look') +
      r('Text size', 'For Spectra\'s messages.', seg('fs', [[0.92, 'Small'], [1, 'Default'], [1.1, 'Large'], [1.2, 'XL']], +c.fs), 1) +
      r('Background art', 'The big Spectra artwork behind the chat.', sw('art', c.art)) +
      r('Grid background', 'The hairline grid with the cursor glow.', sw('grid', c.grid)) +
      r('Calm mode', 'Turns off Spectra\'s animations on this page. Good for slow devices.', sw('calm', c.calm));
  },
  notif() {
    const c = CFG();
    return sec('When a reply is ready') +
      r('Browser notification', 'Pings you if the tab is in the background. You may be asked for permission.', sw('notif', c.notif && 'Notification' in window && Notification.permission === 'granted')) +
      r('Sound', 'A tiny blip when Spectra finishes.', sw('sound', c.sound)) +
      r('Try it', 'Sends a test ping with your current settings.', btn('test', 'Send test')) +
      '<div class="sx-empty">On iPhone, notifications only work after you add SPECSOFT to your Home Screen.</div>';
  },
  keys() {
    const c = CFG(), K = [['Send message', c.enter ? 'Enter' : MOD + ' Enter'], ['New line', c.enter ? 'Shift Enter' : 'Enter'], ['Search chats', MOD + ' K'], ['New chat', MOD + ' Shift O'], ['Toggle sidebar', MOD + ' \\'], ['Open settings', MOD + ' ,'], ['Show this list', MOD + ' /'], ['Jump to the message box', '/'], ['Stop a reply / close popups', 'Esc']];
    return sec('Keyboard') + r('Enable shortcuts', 'Turns the extra shortcuts on or off (Search chats and Esc always work).', sw('shortcuts', c.shortcuts)) + sec('List') + K.map(k => r(k[0], '', kbds(k[1]))).join('');
  },
  usage() {
    const u = LS('sa.left', null), day = new Date().toISOString().slice(0, 10), ok = u && u.day === day && u.limit > 0;
    const pct = ok ? Math.min(100, Math.round(Math.max(u.limit - u.left, 0) / u.limit * 100)) : 0;
    return sec('Today') +
      '<div class="sx-r col"><div class="sx-t"><b>' + (ok ? u.left + ' of ' + u.limit + ' credits left' : 'Send a message to see your count') + '</b><span id="sxReset"></span></div><div class="sx-bar"><i style="width:' + pct + '%"></i></div></div>' +
      sec('What things cost') +
      r('Normal message', '', '<span class="sx-n">1 credit</span>') + r('Web search', '', '<span class="sx-n">2 credits</span>') + r('Deep reasoning', '', '<span class="sx-n">3 credits</span>') + r('Deep research', '', '<span class="sx-n">5 credits</span>') + r('Sending images', 'Added to any of the above.', '<span class="sx-n">+1 credit</span>') +
      '<div class="sx-empty">Your count refreshes after every message. Limits reset at midnight UTC.</div>';
  },
  data() {
    return sec('Your data') +
      r('Export everything', 'Chats, notes, saved code and settings as one file.', btn('export', 'Export'), 1) +
      r('Import', 'Load a Spectra export file. Existing chats are kept.', btn('import', 'Choose file') + '<input type="file" id="sxImp" accept=".json,application/json" hidden>', 1) +
      sec('Delete') +
      r('Delete all chats', 'Removes every chat in this browser, including pinned and saved ones.', btn('clrchats', 'Delete chats', 'danger'), 1) +
      r('Delete saved code', 'Clears everything you saved from code blocks (Assets).', btn('clrassets', 'Delete saved code', 'danger'), 1) +
      r('Reset settings', 'Back to defaults. Chats and memory notes stay.', btn('reset', 'Reset settings', 'danger'), 1) +
      '<div class="sx-empty">Chats, notes and settings are stored in this browser on this device, so clearing your browser data removes them. Export first if you want a backup.</div>';
  },
  about() {
    return sec('Spectra AI') +
      r('Version', 'Spectra AI v3 \u00b7 SPECSOFT\u00ae', '<span class="sx-n">v3</span>') +
      r('Who is she?', 'SPECSOFT\'s official mascot and the helper on this page. She can make mistakes, so double-check anything important.', '') +
      sec('Links') +
      r('Website', 'specsoftdev.netlify.app', '<a class="sx-btn" href="https://specsoftdev.netlify.app" target="_blank" rel="noopener noreferrer">Open</a>') +
      r('Discord community', 'Help, feedback and events.', '<a class="sx-btn" href="https://discord.gg/Uym7ybcWK3" target="_blank" rel="noopener noreferrer">Join</a>');
  },
  bug() {
    return sec('Report a bug') +
      '<div class="sx-r col"><div class="sx-t"><b>What kind of problem?</b></div><select class="sx-sel" id="sxBugCat"><option value="bug">Something is broken</option><option value="answer">Spectra said something wrong</option><option value="idea">Feature idea</option><option value="other">Something else</option></select></div>' +
      '<div class="sx-r col"><div class="sx-t"><b>What happened?</b><span>The more detail, the faster we can fix it. Your browser type and screen size are attached automatically.</span></div><textarea class="sx-ta" id="sxBugTxt" maxlength="1500" rows="5" placeholder="What did you do, what did you expect, what actually happened?"></textarea></div>' +
      r('Include my last messages', 'Attaches the last 6 messages of this chat so we can see what went wrong. Off by default.', sw('bugchat', false)) +
      '<div style="padding-top:16px">' + btn('bug', 'Send report', 'main') + '</div>' +
      '<div class="sx-empty">Reports go privately to the SPECSOFT team. If sending fails, your report is copied so you can paste it in our Discord.</div>';
  }
};
const TABS = [['general', 'General', 'gear'], ['personal', 'Personalization', 'smile'], ['memory', 'Memory', 'brain'], ['look', 'Appearance', 'palette'], ['notif', 'Notifications', 'bell'], ['keys', 'Shortcuts', 'keys'], ['usage', 'Usage limits', 'gauge'], ['data', 'Data controls', 'data'], ['about', 'About', 'info'], ['bug', 'Report bug', 'bug']];
let sxTab = 'general', sxT = 0;
function tickUsage() {
  const el = $('#sxReset'); if (!el) return clearInterval(sxT);
  const n = new Date(), nx = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1), ms = nx - n.getTime();
  el.textContent = 'Resets in ' + Math.floor(ms / 36e5) + 'h ' + Math.floor(ms % 36e5 / 6e4) + 'm (midnight UTC, ' + new Date(nx).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' your time)';
}
function drawSx(reset) {
  clearInterval(sxT);
  sxNav.innerHTML = TABS.map(t => '<button type="button" data-tab="' + t[0] + '" class="' + (t[0] === sxTab ? 'on' : '') + '">' + ico(t[2]) + '<span>' + t[1] + '</span></button>').join('');
  const keep = sxPane.scrollTop; sxPane.innerHTML = PANES[sxTab](); sxPane.scrollTop = reset ? 0 : keep;
  const on = sxNav.querySelector('.on'); if (reset && on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (sxTab === 'usage') { tickUsage(); sxT = setInterval(tickUsage, 30000); }
}
function openSettings(tab) { if (tab) sxTab = tab; drawSx(true); setM.classList.add('on'); app.classList.remove('drawer'); }
const closeSettings = () => { setM.classList.remove('on'); clearInterval(sxT); };

function exportData() {
  const d = { app: 'spectra', v: 3, t: Date.now(), settings: CFG(), memory: mem(), assets: LS('sa.assets', []), chats: chats.map(c => ({ title: c.title, t: c.t, pin: !!c.pin, lib: !!c.lib, arch: !!c.arch, messages: c.messages.map(m => { const o = { role: m.role, content: m.content }; if (m.sources) { o.sources = m.sources; o.queries = m.queries; } return o; }) })) };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
  a.download = 'spectra-export-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Export downloaded');
}
function importData(f) {
  if (!f) return; if (f.size > 8e6) return toast('That file is too big');
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result); if (!d || d.app !== 'spectra' || !Array.isArray(d.chats)) throw 0;
      const have = new Set(chats.map(c => c.t + '|' + c.title)); let n = 0;
      d.chats.slice(0, 100).forEach(c => {
        if (!c || typeof c.title !== 'string' || !Array.isArray(c.messages)) return;
        const ms = c.messages.slice(0, 200).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').map(m => {
          const o = { role: m.role, content: m.content.slice(0, 20000) };
          if (Array.isArray(m.sources)) { o.sources = m.sources.slice(0, 10).filter(s => s && typeof s.u === 'string' && typeof s.t === 'string').map(s => ({ t: s.t.slice(0, 60), u: s.u.slice(0, 600) })); o.queries = Array.isArray(m.queries) ? m.queries.slice(0, 6).map(q => String(q).slice(0, 120)) : []; }
          return o;
        });
        const t = +c.t || Date.now(), title = c.title.slice(0, 40); if (!ms.length || have.has(t + '|' + title)) return;
        chats.push({ title, t, titled: true, pin: !!c.pin, lib: !!c.lib, arch: !!c.arch, messages: ms }); n++;
      });
      chats.sort((a, b) => b.t - a.t);
      if (Array.isArray(d.memory)) { const a = mem(); d.memory.slice(0, 20).forEach(m => { const t = m && typeof m.t === 'string' ? m.t.slice(0, 160) : ''; if (t && a.length < 20 && !a.some(x => x.t === t)) a.push({ t, ts: Date.now() }); }); SS('sa.mem', a); }
      save(); renderList(); drawSx(); toast(n + ' chat' + (n === 1 ? '' : 's') + ' imported');
    } catch (e) { toast('That is not a Spectra export file'); }
  };
  rd.readAsText(f);
}
async function sendBug(b) {
  const cat = $('#sxBugCat').value, txt = $('#sxBugTxt').value.trim(), inc = !!(sxPane.querySelector('[data-sw=bugchat]') || {}).checked;
  if (txt.length < 10) return toast('Tell us a bit more (10+ characters)');
  const md = modes(), info = [(navigator.userAgent || '').slice(0, 160), innerWidth + 'x' + innerHeight, 'model ' + model().id, 'persona ' + persona().id, Object.keys(md).filter(k => md[k]).join('+') || 'no modes', new Date().toISOString()].join(' | ');
  const chat = inc && cur ? cur.messages.slice(-6).map(m => ({ role: m.role, content: String(m.content).slice(0, 500) })) : [];
  b.disabled = true; const label = b.textContent; b.textContent = 'Sending...';
  try {
    const q = await sbReq(), rs = await fetch(q.url, { method: 'POST', headers: q.headers, body: JSON.stringify({ mode: 'bug', category: cat, message: txt.slice(0, 1500), info, chat }) });
    const j = rs.ok ? await rs.json() : null; if (!j || !j.ok) throw 0;
    $('#sxBugTxt').value = ''; toast('Report sent. Thank you!');
  } catch (e) { copy('[Spectra ' + cat + '] ' + txt + '\n' + info, 'Could not send it, so I copied your report. Paste it in our Discord!'); }
  b.disabled = false; b.textContent = label;
}

sxNav.onclick = e => { const b = e.target.closest('button[data-tab]'); if (!b) return; sxTab = b.dataset.tab; drawSx(true); };
sxPane.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.sw) {
    const k = t.dataset.sw; if (k === 'bugchat') return;
    if (k === 'notif' && t.checked) return askNotif(t);
    putCfg(k, t.checked); if (k === 'sound' && t.checked) blip(); if (k === 'memOn') drawSx();
  } else if (t.id === 'sxImp') { importData(t.files[0]); t.value = ''; }
});
sxPane.addEventListener('input', e => { const t = e.target; if (t.dataset.txt) putCfg(t.dataset.txt, t.value.slice(0, t.dataset.txt === 'nick' ? 20 : 400)); });
sxPane.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'sxMemIn') { e.preventDefault(); const b = sxPane.querySelector('[data-act=memadd]'); if (b) b.click(); } });
sxPane.addEventListener('click', e => {
  const sg = e.target.closest('.sx-seg button');
  if (sg) {
    const k = sg.parentNode.dataset.seg, v = SEGS[k][+sg.dataset.i][0];
    if (k === 'persona') { SS('sa.persona', v); if (v === 'custom' && !(CFG().persona || '').trim()) toast('Write your custom persona below'); }
    else if (k === 'model') SS('sa.model', v);
    else putCfg(k, v);
    applyCfg(); drawSx(); return;
  }
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
  if (a === 'memadd') { const i = $('#sxMemIn'); if (addMem(i.value)) drawSx(); }
  else if (a === 'memdel') { const m = mem(); m.splice(+b.dataset.i, 1); SS('sa.mem', m); drawSx(); }
  else if (a === 'memclear') sure(b, () => { SS('sa.mem', []); drawSx(); toast('Memory cleared'); });
  else if (a === 'test') { const c = CFG(); if (c.sound) blip(); if (c.notif && 'Notification' in window && Notification.permission === 'granted') pingNote('This is how I will ping you when a reply is ready'); else toast(c.sound ? 'Blip!' : 'Turn on a notification or sound first'); }
  else if (a === 'export') exportData();
  else if (a === 'import') $('#sxImp').click();
  else if (a === 'clrchats') sure(b, () => { if (busy) stop(); chats = []; cur = null; save(); renderList(); renderChat(); showGreeting(); toast('All chats deleted'); });
  else if (a === 'clrassets') sure(b, () => { SS('sa.assets', []); toast('Saved code deleted'); });
  else if (a === 'reset') sure(b, () => { ['sa.cfg', 'sa.persona', 'sa.model', 'sa.modes'].forEach(k => { try { localStorage.removeItem(k); } catch (er) { } }); applyCfg(); drawAtt(); drawSx(); toast('Settings reset'); });
  else if (a === 'bug') sendBug(b);
});
$('#saSettings').onclick = () => openSettings('general');
$('#saSetClose').onclick = closeSettings;
setM.addEventListener('click', e => { if (e.target === setM) closeSettings(); });

/* shortcuts */
addEventListener('keydown', e => {
  if (!CFG().shortcuts) return;
  const mod = e.ctrlKey || e.metaKey, tag = ((e.target && e.target.tagName) || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#saNew').click(); }
  else if (mod && e.key === ',') { e.preventDefault(); openSettings('general'); }
  else if (mod && e.key === '/') { e.preventDefault(); openSettings('keys'); }
  else if (mod && e.key === '\\') { e.preventDefault(); innerWidth <= 850 ? app.classList.toggle('drawer') : $('#saCollapse').click(); }
  else if (e.key === '/' && !mod && !typing) { e.preventDefault(); input.focus(); }
}, true);
applyCfg();
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

/* ---- Mobile sidebar: close button, swipe from the left edge to open, swipe left to close ---- */
const closeDrawer = () => app.classList.remove('drawer');
$('#saX').onclick = closeDrawer;
['#saAssets', '#saLibrary', '#saSearch', '#saSettings'].forEach(s => $(s).addEventListener('click', closeDrawer));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
let tx0 = 0, ty0 = 0, tgo = false;
addEventListener('touchstart', e => { const t = e.touches[0]; tx0 = t.clientX; ty0 = t.clientY; tgo = innerWidth <= 850 && (app.classList.contains('drawer') || tx0 < 28); }, { passive: true });
addEventListener('touchend', e => {
  if (!tgo) return; tgo = false; const t = e.changedTouches[0], dx = t.clientX - tx0, dy = Math.abs(t.clientY - ty0);
  if (dy > 60 || Math.abs(dx) < 70) return;
  if (dx > 0 && tx0 < 28 && !app.classList.contains('drawer')) app.classList.add('drawer');
  else if (dx < 0 && app.classList.contains('drawer')) closeDrawer();
}, { passive: true });

renderList(); renderChat(); setTimeout(showGreeting, 700);
})();
