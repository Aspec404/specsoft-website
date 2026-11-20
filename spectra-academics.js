/* SPECSOFT® Spectra Academics v5 (projects: edit popup with name, description, color + symbol pickers, reorder by drag or Move up/down, archive). v4: projects as folders, inline project creation, drag and drop, project menu, cooler sidebar. v3 (try again, edit + copy your message, new Video button + video-making card). v2: Talks to the same "spectra-chat" Edge Function with an `academics` field.
   v2: "+" menu (files, project, persona), Tools menu (level, web search, deep reasoning, deep research),
   chat three-dot menu (pin, rename, add to project, delete), no tracks for Elementary. */
(function () {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const MAXC = 400000;   /* max characters in one message (typed + attached files). Keep in sync with the textarea maxlength in the html and the server cap in spectra-chat */
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const P = {
  back: 'M15 6l-6 6 6 6', plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z', menu: 'M4 7h16M4 12h16M4 17h16', send: 'M12 19V5M6 11l6-6 6 6', stop: 'M8 8h8v8H8z',
  panel: 'M4 5h16v14H4zM9 5v14', tools: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4', chev: 'M6 9l6 6 6-6', chevr: 'M9 6l6 6-6 6',
  clip: 'M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01', pin: 'M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17v4M17 19h4',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  copy: 'M9 9h10v10H9zM5 15V5h10', speaker: 'M4 9v6h4l5 4V5L8 9zM16.5 9a4 4 0 010 6M19 6.5a8 8 0 010 11',
  up: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 012 2v4h6a2 2 0 012 2l-1.5 7a2 2 0 01-2 1.5H7', down: 'M7 13V4H4v9zM7 13l4 7a2 2 0 002-2v-4h6a2 2 0 002-2l-1.5-7A2 2 0 0017.5 3H7',
  spin: 'M12 3a9 9 0 019 9', play: 'M8 5v14l11-7z', flag: 'M5 21V4M5 4h11l-2 4 2 4H5', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1', check: 'M5 12l5 5 9-10', blank: 'M0 0',
  refresh: 'M4 12a8 8 0 0113.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 01-13.7 5.6L4 15M4 20v-5h5',
  cards: 'M8 8h12v10H8zM4 15V6a2 2 0 012-2h9',
  pdf: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M12 11v6M9 14l3 3 3-3',
  vid: 'M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2zM10 9.2v5.6l4.8-2.8z',
  x: 'M6 6l12 12M18 6L6 18', arrup: 'M12 19V5M6 11l6-6 6 6', arrdn: 'M12 5v14M6 13l6 6 6-6', archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4', palette2: 'M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2.2-.5-1.2.3-2.3 1.6-2.3H17a4 4 0 004-4c0-5-4-9.5-9-9.5zM7.5 11h.01M10 7.5h.01M14 7.5h.01M16.5 11h.01',
  /* project symbols */
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13', flask: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3', calc: 'M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  bolt: 'M13 3L5 13h6l-1 8 8-10h-6z', rocket: 'M12 2.5c3.6 2.6 5 6 5 9.5l-1.6 3.8H8.6L7 12c0-3.5 1.4-6.9 5-9.5zM9 15.5l-3.2 3.7 3.7-.7M15 15.5l3.2 3.7-3.7-.7M12 9h.01M10.6 19.2c.3 1.2.8 2 1.4 2.6.6-.6 1.1-1.4 1.4-2.6', bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.5.4.5 1 .5 1.6V16h6v-.5c0-.6 0-1.2.5-1.6A6 6 0 0012 3z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 11a3.5 3.5 0 100 7 3.5 3.5 0 000-7z', leaf: 'M5 19C5 10 10 5 20 4c0 10-5 15-14 15zM5 19l8-8',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM12 12h.01', trophy: 'M8 4h8v5a4 4 0 01-8 0zM8 6H4v2a3 3 0 003 3M16 6h4v2a3 3 0 01-3 3M12 13v4M8 21h8M10 17h4', cap: 'M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8', puzzle: 'M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4h-4v-2a2 2 0 10-4 0v2H6v-4H4a2 2 0 110-4h2V6h4z', compass: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5z', chat: 'M4 5h16v11H9l-5 4z'
};
const paint = r => (r || document).querySelectorAll('[data-ic]').forEach(e => { e.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + (P[e.dataset.ic] || '') + '"/></svg>'; });
const toast = t => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); setTimeout(() => e.classList.remove('on'), 2400); };
const SUBJ = ['Math', 'General Sciences', 'Social Studies', 'Languages', 'ICT/TVL', 'General Knowledge'], LEVELS = ['Elementary', 'Junior High', 'Senior High', 'College'];
const WEB_AUTO = ['Social Studies', 'General Knowledge'];
const PERS = [{ id: 'spectra', n: 'Spectra (Default)' }, { id: 'dev', n: 'Developer Mode' }, { id: 'creative', n: 'Creative' }, { id: 'custom', n: 'Custom' }];
let chats = LS('sa.acad.chats', []), projs = LS('sa.acad.proj', []), cur = null, proj = null, pend = null, busy = false, ctrl = null;
let subject = '', track = '', level = LS('sa.acad.level', 'Senior High'), web = false, think = false, research = false;
/* persona, custom persona, nickname and model are SHARED with Spectra Chat (sa.persona, sa.cfg, sa.model). Reply length + emojis are Academics-only (sa.acad.cfg). */
const CFGS = () => LS('sa.cfg', {}) || {};
const ACFG = () => Object.assign({ len: 'detailed', emo: 'few' }, LS('sa.acad.cfg', {}) || {});
let persona = LS('sa.persona', LS('sa.acad.persona', 'spectra')), custom = String(CFGS().persona || LS('sa.acad.custom', '') || '').slice(0, 400);
if (!PERS.some(p => p.id === persona) || (persona === 'custom' && !custom.trim())) persona = 'spectra';
const root = document.documentElement, main = $('#main'), comp = $('#comp'), inp = $('#in'), sd = $('#sd'), sc = $('#sc');
const SAVE_MAX = 30000;   /* a message bigger than this is kept in full while the page is open, but only its first part is saved on this device (localStorage is ~5 MB) */
const lite = m => { const big = m.role === 'user' && m.content.length > SAVE_MAX; if (!m.imf && !big) return m; const o = Object.assign({}, m); delete o.imf; if (big) o.content = o.content.slice(0, SAVE_MAX) + '\n[...rest not saved on this device]'; return o; };
const save = () => { const all = chats.filter(c => c.pin).concat(chats.filter(c => !c.pin)).slice(0, 40).map(c => Object.assign({}, c, { msgs: c.msgs.map(lite) })); SS('sa.acad.chats', all); SS('sa.acad.proj', projs); };
const nm = () => (($('[data-user-name]') || {}).textContent || '').trim();
const noTrack = () => level === 'Elementary';

/* theme */
const th = $('#theme');
const setTh = t => { root.dataset.theme = t; SS('sa.acad.theme', t); th.dataset.ic = t === 'dark' ? 'sun' : 'moon'; paint(th.parentNode); };
th.onclick = () => setTh(root.dataset.theme === 'dark' ? 'light' : 'dark');

/* code colors: tiny built-in highlighter (no library, works while streaming). Colors come from the --tk-* variables in the css. */
const KW = 'abstract|as|assert|async|await|base|break|case|catch|class|const|constructor|continue|debugger|default|def|defer|del|delete|do|elif|else|elseif|end|enum|except|export|extends|extern|fi|final|finally|fn|for|foreach|from|func|function|global|go|if|implements|import|in|include|inline|instanceof|interface|is|lambda|let|local|match|module|namespace|new|nonlocal|not|of|operator|or|override|package|pass|pub|public|private|protected|raise|readonly|ref|repeat|require|return|sealed|select|self|static|struct|super|switch|then|this|throw|throws|trait|try|type|typeof|union|unless|unsafe|until|use|using|var|virtual|void|volatile|when|where|while|with|yield|and|AND|OR|NOT|SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|LIMIT|AS|HAVING|DISTINCT|UNION|PRIMARY|KEY';
const LIT = 'true|false|null|nil|None|True|False|undefined|NaN|Infinity|NULL';
const TYP = 'int|long|short|byte|char|float|double|bool|boolean|string|str|number|object|any|unknown|never|i8|i16|i32|i64|u8|u16|u32|u64|f32|f64|usize|size_t';
const HLRE = new RegExp([
  '(\\/\\*[\\s\\S]*?(?:\\*\\/|$))',                                   // 1 block comment
  '(<!--[\\s\\S]*?(?:-->|$))',                                        // 2 html comment
  '(\\/\\/[^\\n]*|--[^\\n]*|#[^\\n]*)',                               // 3 line comment
  '("""[\\s\\S]*?(?:"""|$)|\'\'\'[\\s\\S]*?(?:\'\'\'|$)|`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|$)|"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?)', // 4 strings
  '(\\b(?:0x[\\da-fA-F]+|\\d[\\d_]*\\.?\\d*(?:[eE][+-]?\\d+)?)\\b)',     // 5 number
  '(\\b(?:' + LIT + ')\\b)',                                          // 6 literal
  '(\\b(?:' + KW + ')\\b)',                                           // 7 keyword
  '(\\b(?:' + TYP + ')\\b|\\b[A-Z][A-Za-z0-9_]*\\b)',                 // 8 type / Class
  '(\\b[A-Za-z_$][\\w$]*(?=\\s*\\())',                                // 9 function call
  '([=!<>+\\-*\\/%&|^~?:]+)'                                          // 10 operator
].join('|'), 'g');
const HLC = ['', 'c', 'c', 'c', 's', 'n', 'l', 'k', 't', 'f', 'o'];
function hl(code, lang, live) {
  if ((live && code.length > 8000) || code.length > 120000) return esc(code);   // big blocks stay plain while streaming (smooth), and past 120k always (never freeze the page)
  if (/^(?:text|txt|plain|plaintext|output|log|console)$/i.test(lang)) return esc(code);
  const hash = /^(?:py|python|sh|bash|shell|zsh|yml|yaml|rb|ruby|toml|ini|r|pl|perl|makefile|dockerfile|ps1|powershell)$/i.test(lang), slashes = !hash && !/^(?:sql|lua|hs|haskell)$/i.test(lang);
  let out = '', last = 0, m; HLRE.lastIndex = 0;
  while ((m = HLRE.exec(code))) {
    if (m[0] === '') { HLRE.lastIndex++; continue; }
    let g = 1; while (g < 11 && m[g] === undefined) g++;
    if (g === 3) { const s = m[0]; if ((s[0] === '#' && !hash && lang && !/^(?:c|cpp|c\+\+|cs|csharp|objc|php|css|scss|html|xml|md|markdown)$/i.test(lang)) || (s[0] === '/' && !slashes && hash) || (s[0] === '-' && /^(?:js|javascript|ts|typescript|java|c|cpp|cs|go|rust|rs|php|css|json)$/i.test(lang))) g = 10; }
    if (g === 3 && m[0][0] === '#' && /^(?:c|cpp|c\+\+|cs|csharp|objc)$/i.test(lang)) g = 7;   // #include / #define
    if (g === 10 && /^(?:html|xml|svg|htm)$/i.test(lang)) g = 0;   // < and > in markup stay plain
    out += esc(code.slice(last, m.index)); out += g ? '<span class="tk-' + HLC[g] + '">' + esc(m[0]) + '</span>' : esc(m[0]); last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

/* markdown + math (math is protected first so KaTeX auto-render can find it) */
function md(t, live, user) {
  const M = [], CV = [];
  if (!user && window.SpectraCanvas && t.indexOf('~~~canvas') >= 0) t = SpectraCanvas.hide(t, CV);   // Persistent Canvas: each canvas block becomes a card in the chat
  /* single-dollar math ($5$, $x$) -> \(..\). Strict: money like "$5 and $8" stays plain text. Code fences are skipped. */
  if (!user) t = t.split('```').map((p, i) => i % 2 ? p : p.replace(/(?<![\w$\\])\$(?!\s)([^$\n]{1,80}?)(?<!\s)\$(?![\w$])/g, (m, a) => '\\(' + a + '\\)')).join('```');
  if (!user) t = t.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, m => { M.push(m); return '\uE000' + (M.length - 1) + '\uE001'; });
  return t.split('```').map((p, i) => {
    if (i % 2) {
      if (!user && (p.match(/^[^\n]*/) || [''])[0].trim().toLowerCase() === 'stepper') {   // Math & LaTeX Interactive Stepper: one JSON object; lone backslashes (LaTeX like \frac) are doubled first so they cannot turn into tabs or break the JSON
        let ok = null; if (!live) { try { ok = JSON.stringify(JSON.parse(p.replace(/^[^\n]*\n?/, '').trim().replace(/\\(["\\])|\\/g, (m, c) => c ? m : '\\\\'))); } catch (e) { ok = null; } }
        return ok ? '<div class="ac-stp" data-v="' + esc(ok) + '"></div>' : live ? '<div class="ac-stp ld"><span class="ac-dots"><i></i><i></i><i></i></span><span class="ac-sx">Presenting</span></div>' : '';
      }
      if (!user && (p.match(/^[^\n]*/) || [''])[0].trim().toLowerCase() === 'viz') {
        let ok = null; if (!live) { try { ok = JSON.stringify(JSON.parse(p.replace(/^[^\n]*\n?/, '').trim())); } catch (e) { ok = null; } }
        return ok ? '<div class="ac-viz" data-v="' + esc(ok) + '"></div>' : live ? '<div class="ac-viz ld"><span class="ac-dots"><i></i><i></i><i></i></span><span class="ac-sx">Drawing it out</span></div>' : '';
      }
      const lg = ((p.match(/^[^\n]*/) || [''])[0].trim().toLowerCase().match(/^[\w+#.-]{1,20}$/) || [''])[0], body = p.replace(/^[^\n]*\n/, ''), ln = body.replace(/\n$/, '').split('\n').length, lng = ln > 28 && !live;
      return '<div class="ac-cb' + (lng ? ' long' : '') + '"><div class="ac-ch"><span>' + esc(lg || 'code') + '</span><span class="ac-cx">' + (lng ? '<button type="button" class="ac-ex" data-ex="1">Expand ' + ln.toLocaleString() + ' lines</button>' : '') + '<button type="button" class="ac-cp" data-cp="1">Copy</button></span></div><pre><code>' + hl(body, lg, live) + '</code></pre></div>';
    }
    return mdText(p);
  }).join('').replace(/\uE000(\d+)\uE001/g, (x, k) => esc(M[k])).replace(/(?:<br>)?\uE002(\d+)\uE003(?:<br>)?/g, (x, k) => CV[k] || '');
}
/* text formatting between code fences (also used for YOUR messages): **bold** *italic* ***both*** __underline__ ~~strike~~ ==highlight== ||spoiler|| `code` [text](https://link)
   blocks: --- divider, --- Section --- labeled divider, # heading, > quote, -# small text, - bullets, 1. numbers, - [ ] / - [x] checklist, | tables | */
const PRE = '(<code>[^<]*<\\/code>)|';
const ir = (src, f) => { const re = new RegExp(PRE + src, 'g'); return s => s.replace(re, (m, c, a, b) => c || f(a, b)); };
const INL = [
  s => s.replace(/`([^`\n]+)`/g, '<code>$1</code>'),
  ir('\\*\\*\\*([^*\\n]+?)\\*\\*\\*', a => '<b><i>' + a + '</i></b>'),
  ir('\\*\\*([^*\\n]+?)\\*\\*', a => '<b>' + a + '</b>'),
  ir('(?<![\\w*])\\*(?![*\\s])([^*\\n]+?)(?<![*\\s])\\*(?![*\\w])', a => '<i>' + a + '</i>'),
  ir('(?<!\\w)__(?!\\s)([^_\\n]+?)(?<!\\s)__(?!\\w)', a => '<u>' + a + '</u>'),
  ir('~~(?!\\s)([^~\\n]+?)(?<!\\s)~~', a => '<s>' + a + '</s>'),
  ir('==(?!\\s)([^=\\n]+?)(?<!\\s)==', a => '<mark>' + a + '</mark>'),
  ir('\\|\\|(?!\\s)([^|\\n]+?)(?<!\\s)\\|\\|', a => '<span class="ac-sp" role="button" tabindex="0" aria-label="Spoiler, tap to reveal">' + a + '</span>'),
  ir('\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)', (a, b) => '<a href="' + b + '" target="_blank" rel="noopener noreferrer">' + a + '</a>'),
  ir('\\[(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})|red|orange|yellow|gold|lime|green|teal|cyan|blue|purple|violet|pink|magenta|gray|grey|white|black)\\]([^\\n]+?)\\[\\/\\]', (a, b) => '<span class="ac-co" style="color:' + a + '">' + b + '</span>')   // [#ff0055]colored text[/] (hex or a basic color name only)
];
const inl = s => INL.reduce((x, f) => f(x), s);
function mdText(p) {
  const L = esc(p).split('\n'), out = []; let i = 0, m;
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < L.length) {
    const l = L[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < L.length && L[i + 1].indexOf('|') >= 0 && /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(L[i + 1])) {
      const head = cells(l), al = cells(L[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''), rows = []; i += 2;
      while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(cells(L[i])); i++; }
      const td = (t, c, k) => '<' + t + (al[k] ? ' style="text-align:' + al[k] + '"' : '') + '>' + inl(c || '') + '</' + t + '>';
      out.push('<div class="ac-tw"><table><thead><tr>' + head.map((c, k) => td('th', c, k)).join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + head.map((c, k) => td('td', r[k], k)).join('') + '</tr>').join('') + '</tbody></table></div>');
    } else if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr class="ac-hr">'); i++; }
    else if ((m = l.match(/^-{3,}\s+(.+?)(?:\s+-{3,})?\s*$/))) { out.push('<div class="ac-hl"><span>' + inl(m[1]) + '</span></div>'); i++; }
    else if ((m = l.match(/^(#{1,4}) (.+)$/))) { out.push('<div class="ac-hd h' + m[1].length + '" role="heading" aria-level="' + m[1].length + '">' + inl(m[2]) + '</div>'); i++; }
    else if (/^&gt; ?/.test(l)) { const q = []; while (i < L.length && /^&gt; ?/.test(L[i])) { q.push(inl(L[i].replace(/^&gt; ?/, ''))); i++; } out.push('<blockquote>' + q.join('<br>') + '</blockquote>'); }
    else if (/^-# /.test(l)) { out.push('<small class="ac-sub2">' + inl(l.slice(3)) + '</small>'); i++; }
    else if (/^[-*] /.test(l)) {
      const it = []; while (i < L.length && /^[-*] /.test(L[i])) { const x = L[i].slice(2), t = x.match(/^\[( |x|X)\] (.*)$/); it.push(t ? '<li class="ac-td' + (t[1] === ' ' ? '' : ' on') + '"><i aria-hidden="true"></i><span>' + inl(t[2]) + '</span></li>' : '<li>' + inl(x) + '</li>'); i++; }
      out.push('<ul>' + it.join('') + '</ul>');
    } else if (/^\d+\. /.test(l)) {
      const it = []; while (i < L.length && /^\d+\. /.test(L[i])) { it.push('<li>' + inl(L[i].replace(/^\d+\. /, '')) + '</li>'); i++; }
      out.push('<ol>' + it.join('') + '</ol>');
    } else { out.push(inl(l)); i++; }
  }
  const blk = /^(?:<(?:ul|ol|h3|blockquote|hr|small class="ac-sub2"|div class="ac-(?:tw|hl)"|div class="ac-hd)[ >])/;
  let h = '';
  out.forEach((x, k) => { const b = blk.test(x), pb = k > 0 && blk.test(out[k - 1]); h += (k > 0 && !b && !pb ? '<br>' : '') + x; });
  return h;
}
const math = el => { if (window.renderMathInElement) try { renderMathInElement(el, { throwOnError: false, delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }] }); } catch (e) { } };
const clean = t => t.replace(/^\s*\[mood:[a-z]*\]?\s*/i, '');
const srcHtml = a => (a.src && a.src.length) ? '<div class="ac-src"><b>Sources</b><br>' + a.src.filter(s => s && /^https:\/\//i.test(s.u)).map(s => '<a href="' + esc(s.u) + '" target="_blank" rel="noopener noreferrer">' + esc(s.t || s.u.replace(/^https:\/\/(www\.)?/, '').split('/')[0]) + '</a>').join('') + '</div>' : '';
const aHtml = (a, live) => a.content ? md(a.content, live) + srcHtml(a) : '<span class="ac-dots"><i></i><i></i><i></i></span>' + (a.st ? '<span class="ac-sx">' + esc(a.st) + '</span>' : '');

/* projects: folders hold their chats. Create them inline, drag chats in, or use "Add to project" from the menus. */
const PC = ['#7c5cff', '#22d3ee', '#34d399', '#f472b6', '#fb923c', '#60a5fa'];
const PCOL = PC.concat(['#f87171', '#facc15', '#a3e635', '#94a3b8']);   // colors in the picker (any other color works through the rainbow swatch)
const PIC = ['folder', 'book', 'flask', 'calc', 'globe', 'code', 'edit', 'star', 'heart', 'bolt', 'rocket', 'bulb', 'music', 'palette2', 'camera', 'leaf', 'target', 'trophy', 'cap', 'chart', 'puzzle', 'compass', 'chat', 'pin'];   // symbols in the picker
const pico = p => (p && PIC.indexOf(p.i) >= 0) ? p.i : 'folder';
const liveProjs = () => projs.filter(p => !p.a);   // archived projects are hidden from the pickers
const pcol = id => { const i = projs.findIndex(p => p.id === id); return (projs[i] && projs[i].c) || PC[(i < 0 ? 0 : i) % PC.length]; };
let pex = LS('sa.acad.pex', {}), creating = null, dragId = null, pmid = null, pmsure = false;
const sPex = () => SS('sa.acad.pex', pex);
const pname = id => (projs.find(p => p.id === id) || {}).n || '';
const inProj = c => !!c.proj && projs.some(p => p.id === c.proj);
function newProj(after) {
  creating = { after: after || null };
  if (shell.classList.contains('min')) setMin(false); shell.classList.add('drawer');
  plist(); const i = $('#pni'); if (i) i.focus();
}
function finishNew(ok) {
  if (!creating) return; const i = $('#pni'), v = ok && i ? i.value.trim().slice(0, 28) : '', after = creating.after; creating = null;
  if (!v) { plist(); return; }
  const id = 'p' + Date.now().toString(36); projs.push({ id, n: v, c: PC[projs.length % PC.length] }); pex[id] = true; sPex(); save(); plist(); toast('Project created'); if (after) after(id);
}
function setProj(id) { if (cur) { cur.proj = id || null; save(); } else pend = id || ''; if (id) { pex[id] = true; sPex(); } list(); tag(); }
function startIn(id) {
  if (busy) stop(); if (window.SpectraVoice) SpectraVoice.stop(); cur = null; pend = id; pex[id] = true; sPex();
  draw(); list(); closeDrawer(); inp.focus(); toast('New chat in ' + pname(id));
}
function delProj(id) {
  chats.forEach(c => { if (c.proj === id) c.proj = null; }); projs = projs.filter(p => p.id !== id); delete pex[id]; sPex(); if (pend === id) pend = null;
  save(); list(); tag(); toast('Project deleted, its chats are kept');
}
const row = (c, nest) => '<div class="ac-it' + (nest ? ' nest' : '') + (cur && cur.id === c.id ? ' on' : '') + (mid === c.id ? ' mo' : '') + '" data-id="' + c.id + '" draggable="true"><span class="ac-t">' + esc(c.title) + '</span>' + (c.pin ? '<i class="ac-pn" data-ic="pin"></i>' : '') + '<button class="ac-dot" data-o="' + c.id + '" type="button" aria-label="Chat options" data-ic="dots"></button></div>';
const prow = (p, arch) => {
  const cs = chats.filter(c => c.proj === p.id), open = pex[p.id] !== false;
  return '<div class="ac-pj' + (open ? ' open' : '') + (arch ? ' arch' : '') + (pmid === p.id ? ' mo' : '') + '" data-pid="' + p.id + '"><div class="ac-pr" data-pr="' + p.id + '"' + (arch ? '' : ' draggable="true"') + (p.d ? ' title="' + esc(p.d) + '"' : '') + '><i class="ac-cv" data-ic="chevr"></i><i class="ac-pc" style="--pc:' + pcol(p.id) + '" data-ic="' + pico(p) + '"></i><span class="ac-pt">' + esc(p.n) + '</span><em>' + cs.length + '</em>' +
    (arch ? '' : '<button class="ac-pa" data-pn="' + p.id + '" type="button" aria-label="New chat in this project" title="New chat here" data-ic="plus"></button>') + '<button class="ac-pa ac-pm" data-pm="' + p.id + '" type="button" aria-label="Project options" data-ic="dots"></button></div>' +
    '<div class="ac-pk">' + (p.d ? '<div class="ac-pd">' + esc(p.d) + '</div>' : '') + (cs.length ? cs.map(c => row(c, 1)).join('') : '<div class="ac-em">' + (arch ? 'No chats in it' : 'Drop chats here') + '</div>') + '</div></div>';
};
function plist() {
  const q = $('#q').value.trim(); $('#psec').hidden = !!q; if (q) return;
  const ni = $('#pni'), keep = ni ? ni.value : '', had = !!ni && document.activeElement === ni;
  let h = creating ? '<div class="ac-pj"><div class="ac-pr"><i class="ac-pc" style="--pc:' + PC[projs.length % PC.length] + '" data-ic="folder"></i><input class="ac-ri" id="pni" maxlength="28" placeholder="Project name" aria-label="Project name" autocomplete="off"></div></div>' : '';
  h += liveProjs().map(p => prow(p, 0)).join('');
  const ar = projs.filter(p => p.a), aop = pex.__arch === true;
  if (ar.length) h += '<div class="ac-ah' + (aop ? ' open' : '') + '" data-arch="1" role="button" tabindex="0"><i class="ac-cv" data-ic="chevr"></i><i class="ac-ai" data-ic="archive"></i><span>Archived</span><em>' + ar.length + '</em></div>' + (aop ? '<div class="ac-al">' + ar.map(p => prow(p, 1)).join('') + '</div>' : '');
  $('#pl').innerHTML = h || '<div class="ac-em">Group your chats into projects</div>'; paint($('#pl'));
  const i = $('#pni'); if (i) { i.value = keep; if (had || !keep) i.focus(); }
}

/* chat list: pinned first, then Today / Yesterday / Earlier. Each chat has a three-dot menu. */
let mid = null, mv = 'main', anc = null;
function drawChats() {
  const q = $('#q').value.trim().toLowerCase();
  const pool = chats.filter(c => (q || !inProj(c)) && c.title.toLowerCase().includes(q)), pins = q ? [] : pool.filter(c => c.pin), rest = q ? pool : pool.filter(c => !c.pin);
  $('#cl').innerHTML = (pins.length ? '<div class="ac-gl">Pinned</div>' + pins.map(c => row(c)).join('') : '') + (rest.length ? '<div class="ac-gl">' + (q ? 'Results' : 'Recents') + '</div>' + rest.map(c => row(c)).join('') : '') || (q ? '<div class="ac-em">No matches</div>' : '<div class="ac-em">No chats yet</div>');
  paint($('#cl'));
}
function list() { plist(); drawChats(); }
const cm = document.createElement('div'); cm.id = 'cm'; cm.className = 'ac-cm'; document.body.appendChild(cm);
function closeMenu() { if (mid === null) return; mid = null; cm.classList.remove('open'); list(); }
function place() {
  const w = cm.offsetWidth || 210, h = cm.offsetHeight;
  const l = Math.min(Math.max(8, anc.right - w), innerWidth - w - 8); let t = anc.bottom + 6;
  if (t + h > innerHeight - 8) t = Math.max(8, anc.top - h - 6);
  cm.style.left = l + 'px'; cm.style.top = t + 'px';
}
function menuDraw() {
  const c = chats.find(x => x.id === mid); if (!c) { closeMenu(); return; }
  const it = (a, ic, tx, cls) => '<button type="button" class="ac-mi' + (cls ? ' ' + cls : '') + '" data-a="' + a + '"><i data-ic="' + ic + '"></i><span>' + tx + '</span></button>';
  if (mv === 'main') cm.innerHTML = it('pin', 'pin', c.pin ? 'Unpin Chat' : 'Pin Chat') + it('ren', 'edit', 'Rename Chat') +
    '<button type="button" class="ac-mi" data-a="proj"><i data-ic="folder"></i><span>Add to project</span><i data-ic="chevr" class="ac-chv"></i></button><div class="ac-sep"></div>' + it('del', 'trash', 'Delete Chat', 'dg');
  else cm.innerHTML = '<button type="button" class="ac-mi" data-a="back"><i data-ic="back"></i><span>Add to project</span></button><div class="ac-sep"></div>' +
    [{ id: '', n: 'No project' }].concat(liveProjs()).map(p => '<button type="button" class="ac-mi" data-pj="' + (p.id || '') + '"><i data-ic="' + ((c.proj || '') === (p.id || '') ? 'check' : 'blank') + '"></i><span>' + esc(p.n) + '</span></button>').join('') +
    '<button type="button" class="ac-mi" data-pj="__new"><i data-ic="plus"></i><span>New project</span></button>';
  paint(cm); place();
}
function openMenu(id, btn) { mid = id; mv = 'main'; anc = btn.getBoundingClientRect(); cm.classList.add('open'); menuDraw(); list(); }
cm.onclick = e => {
  e.stopPropagation(); const c = chats.find(x => x.id === mid); if (!c) return;
  const pj = e.target.closest('[data-pj]');
  if (pj) {
    const id = pj.dataset.pj, cid = mid;
    if (id === '__new') { closeMenu(); newProj(nid => { const cc = chats.find(x => x.id === cid); if (cc) { cc.proj = nid; save(); list(); toast('Added to ' + pname(nid)); } }); return; }
    c.proj = id || null; if (id) { pex[id] = true; sPex(); } save(); closeMenu(); toast(id ? 'Added to ' + pname(id) : 'Removed from project'); return;
  }
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'proj') { mv = 'proj'; menuDraw(); return; } if (a === 'back') { mv = 'main'; menuDraw(); return; }
  const id = mid; closeMenu();
  if (a === 'pin') { c.pin = !c.pin; save(); list(); toast(c.pin ? 'Chat pinned' : 'Chat unpinned'); }
  else if (a === 'ren') rename(id); else if (a === 'del') del(id);
};
function rename(id) {
  const c = chats.find(x => x.id === id), sp = $('#sb [data-id="' + id + '"] .ac-t'); if (!c || !sp) return;
  const i = document.createElement('input'); i.className = 'ac-ri'; i.value = c.title; i.maxLength = 40; i.setAttribute('aria-label', 'Rename chat');
  sp.replaceWith(i); i.focus(); i.select(); let done = false;
  const fin = ok => { if (done) return; done = true; const v = i.value.trim(); if (ok && v) { c.title = v.slice(0, 40); save(); } list(); };
  i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') fin(false); e.stopPropagation(); };
  i.onblur = () => fin(true); i.onclick = e => e.stopPropagation();
}
function del(id) {
  chats = chats.filter(c => c.id !== id); if (cur && cur.id === id) { if (busy) stop(); cur = null; draw(); }
  save(); plist(); list(); toast('Chat deleted');
}
$('#sb').onclick = e => {
  const o = e.target.closest('[data-o]');
  if (o) { e._o = 1; const id = o.dataset.o; closePm(); if (mid === id) closeMenu(); else openMenu(id, o); return; }
  const pm = e.target.closest('[data-pm]');
  if (pm) { e._o = 1; const id = pm.dataset.pm; closeMenu(); if (pmid === id) closePm(); else openPm(id, pm); return; }
  const pn = e.target.closest('[data-pn]'); if (pn) { startIn(pn.dataset.pn); return; }
  if (e.target.closest('.ac-ri')) return;
  const ah = e.target.closest('[data-arch]'); if (ah) { pex.__arch = pex.__arch !== true; sPex(); plist(); return; }
  const pr = e.target.closest('[data-pr]'); if (pr) { const id = pr.dataset.pr; pex[id] = pex[id] === false; sPex(); plist(); return; }
  const it = e.target.closest('[data-id]'); if (!it) return;
  if (busy) stop(); if (window.SpectraVoice) SpectraVoice.stop(); cur = chats.find(c => c.id === it.dataset.id) || null; draw(); list(); closeDrawer();
};
$('#sb').addEventListener('scroll', () => { closeMenu(); closePm(); });
$('#sb').addEventListener('keydown', e => { if (e.target.id !== 'pni') return; if (e.key === 'Enter') { e.preventDefault(); finishNew(true); } else if (e.key === 'Escape') finishNew(false); e.stopPropagation(); });
$('#sb').addEventListener('focusout', e => { if (e.target.id === 'pni') setTimeout(() => { if (creating && document.activeElement !== $('#pni')) finishNew(true); }, 120); });
$('#q').oninput = list;
$('#np').onclick = () => newProj();

/* project menu (three dots on a folder) */
const pmn = document.createElement('div'); pmn.id = 'pmn'; pmn.className = 'ac-cm'; document.body.appendChild(pmn);
function pmDraw() {
  const p = projs.find(x => x.id === pmid) || {}, act = liveProjs(), i = act.findIndex(x => x.id === pmid);
  const it = (a, ic, tx, cls, off) => '<button type="button" class="ac-mi' + (cls ? ' ' + cls : '') + (off ? ' off' : '') + '" data-a="' + a + '"' + (off ? ' disabled' : '') + '><i data-ic="' + ic + '"></i><span>' + tx + '</span></button>';
  pmn.innerHTML = (p.a ? '' : it('new', 'plus', 'New chat here')) + it('edit', 'palette2', 'Edit project') + it('ren', 'edit', 'Rename') +
    (p.a ? '<div class="ac-sep"></div>' + it('unarch', 'refresh', 'Unarchive') : '<div class="ac-sep"></div>' + it('up', 'arrup', 'Move up', '', i <= 0) + it('dn', 'arrdn', 'Move down', '', i < 0 || i >= act.length - 1) + it('arch', 'archive', 'Archive project')) +
    '<div class="ac-sep"></div>' + it('del', 'trash', pmsure ? 'Tap again to delete' : 'Delete project', 'dg'); paint(pmn);
}
function closePm() { if (pmid === null) return; pmid = null; pmsure = false; pmn.classList.remove('open'); plist(); }
function openPm(id, btn) {
  pmid = id; pmsure = false; const r = btn.getBoundingClientRect(); pmDraw(); pmn.classList.add('open');
  const w = pmn.offsetWidth || 210, h = pmn.offsetHeight; let t = r.bottom + 6; if (t + h > innerHeight - 8) t = Math.max(8, r.top - h - 6);
  pmn.style.left = Math.min(Math.max(8, r.right - w), innerWidth - w - 8) + 'px'; pmn.style.top = t + 'px'; plist();
}
pmn.onclick = e => {
  e.stopPropagation(); const b = e.target.closest('[data-a]'); if (!b || pmid === null) return; const a = b.dataset.a, id = pmid;
  if (a === 'del' && !pmsure) { pmsure = true; pmDraw(); return; }
  closePm(); if (a === 'new') startIn(id); else if (a === 'ren') renameProj(id); else if (a === 'del') delProj(id);
  else if (a === 'edit') openPd(id); else if (a === 'up') moveProj(id, -1); else if (a === 'dn') moveProj(id, 1); else if (a === 'arch') archProj(id, true); else if (a === 'unarch') archProj(id, false);
};
function renameProj(id) {
  const p = projs.find(x => x.id === id), sp = $('#pl [data-pid="' + id + '"] .ac-pt'); if (!p || !sp) return;
  const i = document.createElement('input'); i.className = 'ac-ri'; i.value = p.n; i.maxLength = 28; i.setAttribute('aria-label', 'Rename project');
  const dr = sp.closest('.ac-pr'); if (dr) dr.draggable = false;
  sp.replaceWith(i); i.focus(); i.select(); let done = false;
  const fin = ok => { if (done) return; done = true; const v = i.value.trim(); if (ok && v) { p.n = v.slice(0, 28); save(); } list(); tag(); };
  i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') fin(false); e.stopPropagation(); };
  i.onblur = () => fin(true); i.onclick = e => e.stopPropagation();
}

/* projects: move up/down, drag to reorder (computers), archive, and the edit popup (name, description, color, symbol) */
function flashProj(id) { const el = $('#pl [data-pid="' + id + '"]'); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
function moveProjTo(id, tid, after) {   // put project id before or after project tid
  const i = projs.findIndex(p => p.id === id), t = projs.findIndex(p => p.id === tid); if (i < 0 || t < 0 || id === tid) return;
  const [p] = projs.splice(i, 1), j = projs.findIndex(x => x.id === tid); projs.splice(after ? j + 1 : j, 0, p); save(); plist(); flashProj(id);
}
function moveProj(id, d) {
  const act = liveProjs(), i = act.findIndex(p => p.id === id), j = i + d; if (i < 0 || j < 0 || j >= act.length) return;
  moveProjTo(id, act[j].id, d > 0);
}
function archProj(id, on) {
  const p = projs.find(x => x.id === id); if (!p) return; p.a = !!on; if (on) { if (pend === id) pend = null; }
  save(); list(); tag(); toast(on ? 'Project archived' : 'Project restored');
}
let pdrag = null;
const pdMark = () => $$('#sb .pdz-a,#sb .pdz-b,#sb .pdrag').forEach(x => x.classList.remove('pdz-a', 'pdz-b', 'pdrag'));
const pdAfter = (t, e) => { const h = t.querySelector('.ac-pr').getBoundingClientRect(); return e.clientY > h.top + h.height / 2; };
$('#sb').addEventListener('dragstart', e => {
  const r = e.target.closest && e.target.closest('.ac-pr[data-pr]'); if (!r || r.closest('.arch') || r.querySelector('.ac-ri')) return;
  pdrag = r.dataset.pr; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'project:' + pdrag); } catch (x) { } r.closest('.ac-pj').classList.add('pdrag');
});
$('#sb').addEventListener('dragover', e => {
  if (!pdrag) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch)'); if (!t || t.dataset.pid === pdrag) return;
  e.preventDefault(); $$('#sb .pdz-a,#sb .pdz-b').forEach(x => x.classList.remove('pdz-a', 'pdz-b')); t.classList.add(pdAfter(t, e) ? 'pdz-a' : 'pdz-b');
});
$('#sb').addEventListener('drop', e => {
  if (!pdrag) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch)'); if (!t || t.dataset.pid === pdrag) return;
  e.preventDefault(); const id = pdrag, after = pdAfter(t, e); pdrag = null; pdMark(); moveProjTo(id, t.dataset.pid, after);
});
$('#sb').addEventListener('dragend', () => { pdrag = null; pdMark(); });

let pd = null;   // the project being edited in the popup: { id, n, d, c, i }
const pdb = document.createElement('div'); pdb.className = 'ac-pdb'; pdb.id = 'pdb'; document.body.appendChild(pdb);
pdb.innerHTML = '<div class="ac-pdx" role="dialog" aria-modal="true" aria-label="Edit project">' +
  '<div class="ac-pdh"><span class="ac-pdv" id="pdv"></span><b>Edit project</b><button class="ac-ib" data-a="cancel" type="button" aria-label="Close" data-ic="x"></button></div>' +
  '<label class="ac-pdl"><span>Name</span><input id="pdn" maxlength="28" autocomplete="off" placeholder="Project name"></label>' +
  '<label class="ac-pdl"><span>Description <small id="pdc"></small></span><textarea id="pdd" rows="3" maxlength="140" placeholder="What is this project about? (optional)"></textarea></label>' +
  '<div class="ac-pdl"><span>Color</span><div class="ac-pcols" id="pdcol"></div></div>' +
  '<div class="ac-pdl"><span>Symbol</span><div class="ac-pics" id="pdic"></div></div>' +
  '<div class="ac-pdf"><button type="button" class="ac-pbt ghost" data-a="arch" id="pda"></button><span></span><button type="button" class="ac-pbt" data-a="cancel">Cancel</button><button type="button" class="ac-pbt pri" data-a="save">Save</button></div></div>';
paint(pdb);
function pdDraw() {
  const col = pd.c, list = PCOL.indexOf(col) >= 0 ? PCOL : PCOL.concat([col]);
  pdb.style.setProperty('--pc', col);
  $('#pdv').innerHTML = '<i data-ic="' + pd.i + '"></i>'; $('#pdc').textContent = pd.d.length + '/140';
  $('#pdcol').innerHTML = list.map(c => '<button type="button" class="ac-sw' + (c === col ? ' on' : '') + '" data-c="' + c + '" style="--c:' + c + '" aria-label="Color ' + c + '"></button>').join('') + '<label class="ac-sw ac-swu" title="Custom color"><input type="color" id="pdu" value="' + col + '" aria-label="Custom color"></label>';
  $('#pdic').innerHTML = PIC.map(k => '<button type="button" class="ac-pi' + (k === pd.i ? ' on' : '') + '" data-i="' + k + '" aria-label="Symbol ' + k + '" data-ic="' + k + '"></button>').join('');
  paint(pdb);
}
function openPd(id) {
  const p = projs.find(x => x.id === id); if (!p) return;
  pd = { id, n: p.n, d: p.d || '', c: pcol(id), i: pico(p) }; closeMenu(); closePm();
  $('#pdn').value = pd.n; $('#pdd').value = pd.d; $('#pda').textContent = p.a ? 'Unarchive' : 'Archive'; pdDraw();
  pdb.classList.add('on'); if (!matchMedia('(hover:none) and (pointer:coarse)').matches) setTimeout(() => { const n = $('#pdn'); if (n && pdb.classList.contains('on')) { n.focus(); n.select(); } }, 60);   // not on phones: the keyboard would cover the pickers
}
function closePd() { pd = null; pdb.classList.remove('on'); }
function applyPd() {
  const p = projs.find(x => x.id === pd.id), n = $('#pdn').value.trim().slice(0, 28);
  if (!n) { toast('Give the project a name'); $('#pdn').focus(); return false; }
  p.n = n; p.d = pd.d.trim().slice(0, 140); p.c = pd.c; p.i = pd.i; if (!p.d) delete p.d; save(); return true;
}
pdb.addEventListener('click', e => {
  if (e.target === pdb) { closePd(); return; } if (!pd) return;
  const c = e.target.closest('.ac-sw[data-c]'); if (c) { pd.c = c.dataset.c; pdDraw(); return; }
  const k = e.target.closest('.ac-pi[data-i]'); if (k) { pd.i = k.dataset.i; pdDraw(); return; }
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'cancel') closePd();
  else if (a === 'save') { if (applyPd()) { closePd(); list(); tag(); toast('Project updated'); } }
  else if (a === 'arch') { const id = pd.id, was = !!(projs.find(x => x.id === id) || {}).a; if (applyPd()) { closePd(); archProj(id, !was); } }
});
pdb.addEventListener('input', e => {
  if (!pd) return;
  if (e.target.id === 'pdd') { pd.d = e.target.value; $('#pdc').textContent = pd.d.length + '/140'; }
  else if (e.target.id === 'pdu' && /^#[0-9a-f]{6}$/i.test(e.target.value)) { pd.c = e.target.value.toLowerCase(); pdb.style.setProperty('--pc', pd.c); $$('#pdcol .ac-sw.on').forEach(x => x.classList.remove('on')); }
});
pdb.addEventListener('change', e => { if (pd && e.target.id === 'pdu') pdDraw(); });
document.addEventListener('keydown', e => {
  if (!pd) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePd(); }
  else if (e.key === 'Enter' && (e.target.id === 'pdn' || e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (applyPd()) { closePd(); list(); tag(); toast('Project updated'); } }
}, true);

/* drag a chat onto a project (or back onto Recents) */
$('#sb').addEventListener('dragstart', e => { const it = e.target.closest && e.target.closest('.ac-it'); if (!it) return; dragId = it.dataset.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { } it.classList.add('drag'); });
$('#sb').addEventListener('dragend', () => { dragId = null; $$('#sb .dz,#sb .drag').forEach(x => x.classList.remove('dz', 'drag')); });
$('#sb').addEventListener('dragover', e => { if (!dragId) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch),#cl'); if (!t) return; e.preventDefault(); $$('#sb .dz').forEach(x => x !== t && x.classList.remove('dz')); t.classList.add('dz'); });
$('#sb').addEventListener('dragleave', e => { const t = e.target.closest('.dz'); if (t && !t.contains(e.relatedTarget)) t.classList.remove('dz'); });
$('#sb').addEventListener('drop', e => {
  if (!dragId) return; const t = e.target.closest('.ac-pj[data-pid]:not(.arch),#cl'); if (!t) return; e.preventDefault();
  const c = chats.find(x => x.id === dragId), id = t.dataset.pid || ''; dragId = null; $$('#sb .dz,#sb .drag').forEach(x => x.classList.remove('dz', 'drag')); if (!c) return;
  c.proj = id || null; if (id) { pex[id] = true; sPex(); } save(); list(); toast(id ? 'Added to ' + pname(id) : 'Moved to Recents');
});
$('#nw').onclick = () => { grC = null; gr(); if (busy) stop(); if (window.SpectraVoice) SpectraVoice.stop(); cur = null; pend = null; draw(); list(); closeDrawer(); inp.focus(); };

/* message actions: copy, TTS, like, dislike, three-dot (report legal issue, share message link) */
const mkId = m => m.id || (m.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
const bt = (k, ic, lb, on) => '<button type="button" class="ac-ab' + (on ? ' on' : '') + '" data-k="' + k + '" aria-label="' + lb + '" title="' + lb + '" data-ic="' + ic + '"></button>';
const ttsBtn = '<button type="button" class="ac-ab ac-tts" data-k="tts" data-a="speak" aria-label="Read aloud" title="Read aloud"><i class="v-i" data-ic="speaker"></i><i class="v-s" data-ic="stop"></i><i class="v-l" data-ic="spin"></i></button>';
const vidBtn = m => '<button type="button" class="ac-ab ac-vid' + (socOn() ? ' sk-off' : '') + '" data-k="video" title="' + (socOn() ? 'Off while Socratic Tutor is on' : 'Watch Spectra explain it as a video') + '" aria-label="Video"><i data-ic="vid"></i><span>' + (m.lesson ? 'Watch' : 'Video') + '</span></button>';
const fcBtn = m => '<button type="button" class="ac-ab ac-fc' + (socOn() ? ' sk-off' : '') + '" data-k="flash" title="' + (socOn() ? 'Off while Socratic Tutor is on' : 'Turn this answer into flashcards') + '" aria-label="Flashcards"><i data-ic="cards"></i><span>' + (m.cards ? 'Study' : 'Flashcards') + '</span></button>';
const capOn = id => { const e = EQ(); return !!e && Array.isArray(e.caps) && e.caps.includes(id); };   // Skills & Capabilities: is this capability switched on?
const pdfBtn = '<button type="button" class="ac-ab ac-pdf" data-k="pdf" title="Save this answer as a PDF" aria-label="Save as PDF"><i data-ic="pdf"></i><span>PDF</span></button>';
const VM = new WeakMap(), vm = m => { let s = VM.get(m); if (!s) { s = {}; VM.set(m, s); } s.content = plain(m, true); return s; };
const bar = (m, last) => '<div class="ac-acts">' + bt('copy', 'copy', 'Copy') + ttsBtn + bt('up', 'up', 'Good answer', m.fb === 'up') + bt('down', 'down', 'Bad answer', m.fb === 'down') + (last ? bt('regen', 'refresh', 'Try again') : '') + bt('more', 'dots', 'More') + vidBtn(m) + fcBtn(m) + (capOn('pdf') ? pdfBtn : '') + '</div>';
const uBar = '<div class="ac-uacts">' + bt('ucopy', 'copy', 'Copy message') + bt('uedit', 'edit', 'Edit message') + '</div>';
const plain = (m, noCv) => (window.SpectraCanvas ? SpectraCanvas.strip(m.content, noCv) : m.content).replace(/```(?:viz|stepper)[\s\S]*?```/g, '').trim();
const copyTxt = t => (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t) : Promise.reject()).catch(() => { const x = document.createElement('textarea'); x.value = t; x.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); } catch (e) { } x.remove(); });
const mm = document.createElement('div'); mm.className = 'ac-cm ac-mm'; document.body.appendChild(mm); let mmm = null;
const closeMM = () => { mmm = null; mm.classList.remove('open'); };
function openMM(m, btn) {
  if (mmm === m.id) return closeMM(); mmm = m.id;
  mm.innerHTML = '<button type="button" class="ac-mi" data-z="share"><i data-ic="link"></i><span>Share Message Link</span></button><div class="ac-sep"></div><button type="button" class="ac-mi dg" data-z="legal"><i data-ic="flag"></i><span>Report Legal Issue</span></button>';
  paint(mm); mm.classList.add('open'); const r = btn.getBoundingClientRect(), w = mm.offsetWidth, h = mm.offsetHeight;
  mm.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 8) + 'px'; mm.style.top = (r.bottom + h + 14 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
}
async function reportLegal(m) {
  const d = (prompt('What is the legal issue with this message? (copyright, privacy, harmful content...)') || '').trim(); if (!d) return;
  if (d.length < 10) { toast('Add a bit more detail (10+ characters)'); return; }
  try {
    const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session; if (!s) { toast('Log in first to send a report'); return; }
    const C = window.SPECSOFT_CONFIG, i = cur.msgs.indexOf(m);
    const r = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY },
      body: JSON.stringify({ mode: 'bug', category: 'legal', message: d, info: 'Academics legal report | msg ' + m.id + ' | ' + (subject || 'General Knowledge') + ' | ' + level, chat: cur.msgs.slice(Math.max(0, i - 5), i + 1).map(x => ({ role: x.role, content: x.content })) }) });
    toast(r.ok ? 'Report sent. Thank you!' : r.status === 429 ? 'Too many reports, try again later' : 'Could not send the report');
  } catch (e) { toast('Could not send the report'); }
}
/* Flashcards button: Spectra writes a small deck from her answer (1 credit once, then it is saved on the message), the player lets you study it */
let fcBusy = false;
async function flash(m, b) {
  if (!window.SpectraFlash) { toast('Flashcards are not loaded'); return; }
  if (m.cards) { SpectraFlash.open(m.cards); return; }
  if (fcBusy) { toast('Spectra is still making flashcards'); return; }
  const i = cur ? cur.msgs.indexOf(m) : -1; if (i < 0 || !m.content) return;
  fcBusy = true; b.disabled = true; b.classList.add('ld'); const lb = b.querySelector('span'); if (lb) lb.textContent = 'Making...';
  const pn = vidPanel(b.closest('.ac-m.a'), 'Making your flashcards', ['Reading the answer', 'Picking the key ideas', 'Writing questions and answers', 'Checking every card']);
  const hist = cur.msgs.slice(0, i + 1).slice(-7).map(x => ({ role: x.role, content: x.content }));
  hist.push({ role: 'user', content: '[FLASHCARDS REQUEST] Turn your last answer into study flashcards.' });
  let raw = '';
  try {
    await ask(hist, t => { raw += t; }, new AbortController().signal, null, null, { flash: true, search: false, research: false, think: false, academics: { subject: cur.subject || subject || 'General Knowledge', level, track: '' } });
    const D = SpectraFlash.parse(raw); if (!D) throw new Error('PARSE');
    m.cards = D; save(); SpectraFlash.open(D);
  } catch (e) {
    toast(e.message === 'LOGIN' ? 'Log in first to make flashcards' : e.st === 429 ? 'Spectra is busy or you hit today\'s limit' : 'Spectra could not make flashcards. Try again.');
  }
  pn.end(); fcBusy = false; if (b.isConnected) { b.disabled = false; b.classList.remove('ld'); if (lb) lb.textContent = m.cards ? 'Study' : 'Flashcards'; }
}
/* Video button: Spectra writes a lesson script (costs 2 credits once, then it is saved on the message), the player performs it */
/* the "making your video" card: animated gradient outline, sound bars, rotating status lines */
function vidPanel(w, ttl, steps) {
  if (!w) return { end() { } };
  const S = steps || ['Reading the answer', 'Writing the script', 'Setting up the board', 'Timing every step', 'Adding the final touches'];
  const p = document.createElement('div'); p.className = 'ac-vmk'; p.setAttribute('role', 'status');
  p.innerHTML = '<div class="ac-vmb"><i></i><i></i><i></i><i></i><i></i></div><div class="ac-vmx"><b>' + (ttl || 'Making your video') + '</b><span>' + S[0] + '</span></div><div class="ac-vmp"></div>';
  w.appendChild(p); try { p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { }
  const sp = p.querySelector('.ac-vmx span'); let k = 0;
  const iv = setInterval(() => {
    if (!p.isConnected) { clearInterval(iv); return; }
    if (k >= S.length - 1) return; k++; sp.classList.add('sw'); setTimeout(() => { sp.textContent = S[k]; sp.classList.remove('sw'); }, 250);
  }, 2600);
  return { end() { clearInterval(iv); p.remove(); } };
}
let vidBusy = false;
async function video(m, b) {
  if (!window.SpectraLesson) { toast('Video mode is not loaded'); return; }
  if (m.lesson) { SpectraLesson.open(m.lesson); return; }
  if (vidBusy) { toast('Spectra is still making a video'); return; }
  const i = cur ? cur.msgs.indexOf(m) : -1; if (i < 0 || !m.content) return;
  vidBusy = true; b.disabled = true; b.classList.add('ld'); const lb = b.querySelector('span'); if (lb) lb.textContent = 'Making...'; const pn = vidPanel(b.closest('.ac-m.a'));
  const hist = cur.msgs.slice(0, i + 1).slice(-7).map(x => ({ role: x.role, content: x.content }));
  hist.push({ role: 'user', content: '[VIDEO LESSON REQUEST] Turn your last answer into a step-by-step video lesson with as many steps as the topic really needs.' });
  let raw = '';
  try {
    await ask(hist, t => { raw += t; }, new AbortController().signal, null, null, { lesson: true, search: false, research: false, think: false, academics: { subject: cur.subject || subject || 'General Knowledge', level, track: '' } });
    const L = SpectraLesson.parse(raw); if (!L) throw new Error('PARSE');
    m.lesson = L; save(); SpectraLesson.open(L);
  } catch (e) {
    toast(e.message === 'LOGIN' ? 'Log in first to make videos' : e.st === 429 ? 'Spectra is busy or you hit today\'s limit' : 'Spectra could not make that video. Try again.');
  }
  pn.end(); vidBusy = false; if (b.isConnected) { b.disabled = false; b.classList.remove('ld'); if (lb) lb.textContent = m.lesson ? 'Watch' : 'Video'; }
}
/* Write PDF capability: builds a clean printable page (math included) and opens the browser's print sheet, where "Save as PDF" makes the file.
   Runs fully in the browser, so it costs no credits. The page title becomes the file name. */
const PDF_CSS = '.ac-hd{font-weight:700;margin:16px 0 6px;line-height:1.3;break-after:avoid}.ac-hd.h1{font-size:24px}.ac-hd.h2{font-size:20px}.ac-hd.h3{font-size:17px}.ac-hd.h4{font-size:14.5px}' + '.ac-ch button,.ac-ex{display:none}.ac-sp{background:none!important;-webkit-text-fill-color:inherit!important}.ac-hr{border:0;border-top:1px solid #ccc;margin:12px 0}.ac-tw{overflow:visible}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}blockquote{border-left:3px solid #999;margin:8px 0;padding-left:10px}' + '@page{size:A4;margin:16mm 15mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'html{background:#eceef1}body{margin:0 auto;max-width:800px;padding:28px 34px 40px;background:#fff;color:#111;font:14.5px/1.65 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;overflow-wrap:anywhere}' +
  '.hd{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin:0 0 22px;padding:0 0 12px;border-bottom:2px solid #111}.hd b{font-size:12px;letter-spacing:.14em;text-transform:uppercase}.hd span{color:#666;font-size:12px;text-align:right}' +
  'h1{margin:0 0 18px;font-size:24px;line-height:1.25}h3{margin:22px 0 6px;font-size:17px;line-height:1.3;break-after:avoid}b{font-weight:700}' +
  'ul,ol{margin:6px 0 10px;padding-left:24px}li{margin:3px 0}code{padding:1px 5px;border-radius:5px;background:#f1f2f4;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace}' +
  'pre{margin:10px 0;padding:12px 14px;border:1px solid #dcdfe4;border-radius:8px;background:#f6f7f9;white-space:pre-wrap;word-break:break-word;break-inside:avoid}pre code{padding:0;background:none}' +
  '.katex-display{margin:12px 0;overflow-x:auto;overflow-y:hidden;break-inside:avoid}.katex{font-size:1.08em}' +
  '.src{margin-top:26px;padding-top:10px;border-top:1px solid #ccc;font-size:12px;color:#444}.src a{color:#1d4ed8;display:block;margin-top:3px}' +
  '.ft{margin-top:30px;padding-top:10px;border-top:1px solid #ddd;color:#777;font-size:11px}' +
  '.tip{position:sticky;top:0;margin:-28px -34px 20px;padding:10px 34px;background:#111;color:#fff;font-size:13px}' +
  '@media print{html{background:#fff}body{max-width:none;padding:0}.tip{display:none}}';
function savePdf(m, over) {   // over = { text, title } when the Canvas panel saves a document
  const box = document.createElement('div'); box.innerHTML = md(over ? over.text : plain(m)); math(box);
  if (!box.textContent.trim()) { toast('Nothing to put in a PDF yet'); return; }
  const first = box.querySelector('.ac-hd, h3'), ttl = ((over && over.title) || (first && first.textContent) || (cur && cur.title) || 'Spectra answer').trim().slice(0, 80);
  if (first && box.firstElementChild === first && (!over || first.textContent.trim() === ttl)) first.remove();
  const src = ((m && m.src) || []).filter(x => x && /^https:\/\//i.test(x.u));
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(ttl) + '</title>' +
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css"><style>' + PDF_CSS + '</style></head><body>' +
    '<div class="tip">Print window opening. Choose "Save as PDF" as the destination.</div>' +
    '<div class="hd"><b>Spectra Academics</b><span>' + esc(date) + '</span></div><h1>' + esc(ttl) + '</h1>' + box.innerHTML +
    (src.length ? '<div class="src"><b>Sources</b>' + src.map(x => '<a href="' + esc(x.u) + '">' + esc(x.t || x.u) + '</a>').join('') + '</div>' : '') +
    '<div class="ft">Made with Spectra Academics by SPECSOFT. Spectra can make mistakes, so double-check important answers.</div>' +
    '<script>addEventListener("load",function(){var go=function(){setTimeout(function(){focus();print()},300)};document.fonts&&document.fonts.ready?document.fonts.ready.then(go,go):go()})<\/script></body></html>';
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' })), w = window.open(url, '_blank');   // a real blob link (not about:blank), so the page always loads and prints
  setTimeout(() => URL.revokeObjectURL(url), 180000);
  if (w) { toast('Choose "Save as PDF" in the print window'); return; }
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0'; f.srcdoc = html; document.body.appendChild(f);   // popup blocked: print from a hidden frame instead
  setTimeout(() => f.remove(), 120000); toast('Choose "Save as PDF" in the print window');
}

/* try again (last answer only), plus copy + edit on your own messages */
function regen(m) {
  if (busy) { toast('Spectra is still answering'); return; }
  if (!cur || m !== cur.msgs[cur.msgs.length - 1]) return;
  const u = cur.msgs[cur.msgs.length - 2]; if (!u || u.role !== 'user') return;
  if (u.img) toast('Images are not re-sent when trying again');
  if (window.SpectraVoice) SpectraVoice.stop();
  cur.msgs.pop(); run(undefined, m);
}
const cutAt = c => { const k = c.indexOf('\n\n[Attached:'); return k < 0 ? [c, ''] : [c.slice(0, k), c.slice(k)]; };
function cancelEd() { $$('.ac-ed').forEach(x => { const w = x.parentNode; x.remove(); w.classList.remove('editing'); }); }
function editMsg(w, m) {
  if (busy) { toast('Wait for Spectra to finish first'); return; }
  cancelEd(); const parts = cutAt(m.content), tail = parts[1];
  const ed = document.createElement('div'); ed.className = 'ac-ed';
  ed.innerHTML = '<textarea rows="1" aria-label="Edit your message"></textarea><div class="ac-edb"><button type="button" data-e="x">Cancel</button><button type="button" data-e="ok" class="pri">Save &amp; send</button></div>';
  const t = ed.firstChild; t.value = parts[0]; t.maxLength = Math.max(50, MAXC - tail.length);
  const fit = () => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 240) + 'px'; };
  t.oninput = fit;
  t.onkeydown = ev => { if (ev.key === 'Escape') cancelEd(); else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ed.querySelector('[data-e=ok]').click(); } };
  ed.onclick = ev => {
    const b = ev.target.closest('[data-e]'); if (!b) return; if (b.dataset.e === 'x') { cancelEd(); return; }
    const v = t.value.trim(); if (!v) { toast('Message cannot be empty'); return; }
    const i = cur ? cur.msgs.indexOf(m) : -1; if (i < 0 || busy) return;
    if (m.img) toast('Images are not re-sent when editing');
    if (window.SpectraVoice) SpectraVoice.stop();
    m.content = v + tail; cur.msgs.length = i + 1; run();
  };
  w.classList.add('editing'); w.appendChild(ed); fit(); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
}
$('#ms').addEventListener('click', e => {
  const b = e.target.closest('.ac-uacts .ac-ab'), w = b && b.closest('[data-uid]'), m = w && cur && cur.msgs.find(x => x.id === w.dataset.uid); if (!m) return;
  e.stopPropagation(); closeMM();
  if (b.dataset.k === 'ucopy') copyTxt(cutAt(m.content)[0]).then(() => toast('Copied')); else editMsg(w, m);
});
$('#ms').addEventListener('click', e => {
  const b = e.target.closest('.ac-ab'), w = b && b.closest('[data-mid]'), m = w && cur && cur.msgs.find(x => x.id === w.dataset.mid); if (!m) return;
  e.stopPropagation(); const k = b.dataset.k; if (k !== 'more') closeMM();
  if (k === 'copy') copyTxt(plain(m)).then(() => toast('Copied'));
  else if (k === 'tts') { if (window.SpectraVoice && window.SpectraVoice.toggle) window.SpectraVoice.toggle(vm(m), b); else toast('Spectra voice is coming soon'); }
  else if (k === 'up' || k === 'down') { m.fb = m.fb === k ? undefined : k; save(); b.parentNode.querySelectorAll('[data-k=up],[data-k=down]').forEach(x => x.classList.toggle('on', x.dataset.k === m.fb)); toast(m.fb ? 'Thanks for the feedback' : 'Feedback removed'); }
  else if (k === 'more') openMM(m, b);
  else if (k === 'regen') regen(m);
  else if ((k === 'video' || k === 'flash') && socOn()) toast('Socratic Tutor is on, so no answer reveals. Switch the skill to use this.');
  else if (k === 'pdf') savePdf(m);
  else if (k === 'video') video(m, b);
  else if (k === 'flash') flash(m, b);
});
mm.onclick = e => {
  e.stopPropagation(); const z = (e.target.closest('[data-z]') || {}).dataset; if (!z) return; const m = cur && cur.msgs.find(x => x.id === mmm); closeMM(); if (!m) return;
  if (z.z === 'share') copyTxt(location.origin + location.pathname + '#m=' + m.id).then(() => toast('Message link copied'));
  else reportLegal(m);
};
document.addEventListener('click', closeMM); document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMM(); }); addEventListener('resize', closeMM); $('#sc').addEventListener('scroll', closeMM);
function openHash() {
  const id = (location.hash.match(/^#m=([a-z0-9]+)$/) || [])[1]; if (!id) return; const c = chats.find(x => x.msgs.some(y => y.id === id)); if (!c) { toast('That message is not on this device'); return; }
  cur = c; draw(); list(); const el = $('[data-mid="' + id + '"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('ac-flash'); setTimeout(() => el.classList.remove('ac-flash'), 1800); }
}
addEventListener('hashchange', openHash);

/* your message: images sit OUTSIDE the bubble (borderless, right-aligned, like text) and open in a previewer; long text/code is clipped with Show more */
const uImgs = m => { const a = m.imf || m.ims; return a && a.length ? '<div class="ac-ui n' + Math.min(a.length, 3) + '">' + a.map((s, i) => '<button type="button" class="ac-uimg" data-pv="' + i + '" aria-label="Preview image ' + (i + 1) + '"><img src="' + s + '" alt="Image you sent" loading="lazy" draggable="false"></button>').join('') + '</div>' : (m.img ? '<div class="ac-ui n1"><span class="ac-uimg gone">Image not saved</span></div>' : ''); };
const uMd = t => t.length > 30000 ? esc(t.slice(0, 120000)).replace(/\n/g, '<br>') : md(t, false, true);
const uText = m => { const t = m.content.split('\n\n[Attached:')[0]; if (t.length <= 1800 && t.split('\n').length <= 24) return uMd(t); const ln = t.split('\n').length; return '<div class="ac-clip">' + uMd(t) + '</div><button type="button" class="ac-more" data-more="1">Show more <small>' + ln.toLocaleString() + ' lines</small></button>'; };
const pvEl = document.createElement('div'); pvEl.className = 'ac-pv'; pvEl.hidden = true;
pvEl.innerHTML = '<button type="button" class="ac-pvx" data-pvk="x" aria-label="Close preview">\u00d7</button><button type="button" class="ac-pvn l" data-pvk="p" aria-label="Previous image">\u2039</button><img class="ac-pvi" alt=""><button type="button" class="ac-pvn r" data-pvk="n" aria-label="Next image">\u203a</button><span class="ac-pvc"></span>';
document.body.appendChild(pvEl);
let pvL = [], pvI = 0;
const pvDraw = () => { const im = pvEl.querySelector('.ac-pvi'); im.src = pvL[pvI]; im.classList.remove('z'); pvEl.querySelector('.ac-pvc').textContent = pvL.length > 1 ? (pvI + 1) + ' / ' + pvL.length : ''; pvEl.classList.toggle('one', pvL.length < 2); };
const pvOpen = (list, i) => { if (!list || !list.length) return; pvL = list; pvI = Math.max(0, Math.min(i, list.length - 1)); pvDraw(); pvEl.hidden = false; document.documentElement.classList.add('ac-pvon'); };
const pvClose = () => { pvEl.hidden = true; document.documentElement.classList.remove('ac-pvon'); pvEl.querySelector('.ac-pvi').removeAttribute('src'); };
const pvGo = d => { if (pvL.length < 2) return; pvI = (pvI + d + pvL.length) % pvL.length; pvDraw(); };
pvEl.addEventListener('click', e => {
  const k = (e.target.closest('[data-pvk]') || {}).dataset; if (k) { if (k.pvk === 'x') pvClose(); else pvGo(k.pvk === 'n' ? 1 : -1); return; }
  if (e.target.classList.contains('ac-pvi')) e.target.classList.toggle('z'); else pvClose();
});
document.addEventListener('keydown', e => { if (pvEl.hidden) return; if (e.key === 'Escape') { e.stopPropagation(); pvClose(); } else if (e.key === 'ArrowRight') pvGo(1); else if (e.key === 'ArrowLeft') pvGo(-1); }, true);
$('#ms').addEventListener('click', e => {
  const b = e.target.closest('.ac-uimg[data-pv]'), mb = e.target.closest('[data-more]');
  if (b) { const w = b.closest('[data-uid]'), m = w && cur && cur.msgs.find(x => x.id === w.dataset.uid); if (m) pvOpen(m.imf || m.ims, +b.dataset.pv); return; }
  if (mb) { const c = mb.previousElementSibling, open = c.classList.toggle('open'); mb.firstChild.nodeValue = open ? 'Show less ' : 'Show more '; }
});
$('#att').addEventListener('click', e => { const im = e.target.closest('.ac-chip img'); if (!im) return; const imgs = att.filter(a => a.k === 'img'), i = imgs.findIndex(a => a.d === im.getAttribute('src')); pvOpen(imgs.map(a => a.d), Math.max(0, i)); });

/* formatting clicks: copy / expand code, reveal spoilers */
$('#ms').addEventListener('click', e => {
  const cp = e.target.closest('[data-cp]'), ex = e.target.closest('[data-ex]'), sp = e.target.closest('.ac-sp');
  if (cp) { const pr = cp.closest('.ac-cb').querySelector('pre'); copyTxt(pr.textContent.replace(/\n$/, '')).then(() => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy'; }, 1300); }); e.stopPropagation(); return; }
  if (ex) { const bx = ex.closest('.ac-cb'), o = bx.classList.toggle('open'); ex.textContent = o ? 'Collapse' : 'Expand ' + bx.querySelector('pre').textContent.replace(/\n$/, '').split('\n').length.toLocaleString() + ' lines'; e.stopPropagation(); return; }
  if (sp) { sp.classList.toggle('on'); e.stopPropagation(); }
});
$('#ms').addEventListener('keydown', e => { const sp = e.target.closest && e.target.closest('.ac-sp'); if (sp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sp.classList.toggle('on'); } });

/* chat view */
function draw() {
  const has = cur && cur.msgs.length;
  main.classList.toggle('chatting', !!has); tag();
  (has ? $('#dock') : $('#slot')).appendChild(comp);
  $('#ms').innerHTML = has ? cur.msgs.map(m => m.role === 'user'
    ? '<div class="ac-ur" data-uid="' + mkId(m) + '">' + uImgs(m) + '<div class="ac-m u">' + uText(m) + (m.att && m.att.length ? '<div class="ac-ua">' + m.att.map(n => '<span>' + esc(n) + '</span>').join('') + '</div>' : '') + '</div>' + uBar + '</div>'
    : '<div class="ac-m a" data-mid="' + mkId(m) + '">' + aHtml(m) + (m.content && !(busy && m === cur.msgs[cur.msgs.length - 1]) ? bar(m, m === cur.msgs[cur.msgs.length - 1]) : '') + '</div>').join('') : '';
  paint($('#ms')); if (window.SpectraVoice && cur) $$('.ac-m.a[data-mid]').forEach(el => { const m = cur.msgs.find(x => x.id === el.dataset.mid); if (m) SpectraVoice.sync(el, vm(m)); });
  $$('.ac-m.a').forEach(math); if (window.SpectraViz) SpectraViz.mount($('#ms')); if (window.SpectraStepper) SpectraStepper.mount($('#ms')); if (window.SpectraCanvas) SpectraCanvas.refresh(); down();
}
const down = () => { sc.scrollTop = sc.scrollHeight; };
const setBtn = () => { sd.dataset.ic = busy ? 'stop' : 'send'; paint(sd.parentNode); };
const stop = () => { if (ctrl) ctrl.abort(); };

/* Skills & Capabilities choice (ids only; the server owns the real instructions) */
const EQ = () => { const v = LS('sa.acad.eq', null); return v && typeof v === 'object' ? v : null; };
const socOn = () => { const e = EQ(); return !!e && e.skill === 'socratic'; };   // Socratic Tutor never reveals answers, so Video and Flashcards are off
async function ask(msgs, onTok, sig, imgs, onEv, extra) {
  const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session;
  if (!s) throw new Error('LOGIN');
  const C = window.SPECSOFT_CONFIG;
  const r = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', {
    method: 'POST', signal: sig, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY },
    body: JSON.stringify(Object.assign({
      messages: msgs, persona: persona, custom: persona === 'custom' ? custom : '', model: model().id, think: think && !research, search: web && !research, research: research,
      nick: (CFGS().nick || nm()).slice(0, 20), hour: new Date().getHours(), memory: [], recent: [], style: { len: ACFG().len, emo: ACFG().emo }, images: imgs && imgs.length ? imgs : undefined,
      academics: { subject: subject || 'General Knowledge', level, track: noTrack() ? '' : track }, equip: EQ() || undefined
    }, extra || {}))
  });
  const lf = r.headers.get('X-Spectra-Left'), lm = r.headers.get('X-Spectra-Limit');
  if (lf !== null && lm !== null && +lm > 0) { SS('sa.left', { left: +lf, limit: +lm, day: new Date().toISOString().slice(0, 10) }); cred(); }
  const sf = r.headers.get('X-Spectra-Search'); if (sf === 'failed') toast('Web search failed, answered without it'); else if (sf === 'url-failed') toast('Could not open that link, answered without it');
  if (!r.ok || !r.body) { const e = new Error('HTTP'); e.st = r.status; throw e; }
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (; ;) {
    const { done, value } = await rd.read(); if (done) return;
    buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop();
    for (const l of ls) {
      if (l.indexOf('data:') !== 0) continue; const x = l.slice(5).trim(); if (x === '[DONE]') return;
      try { const j = JSON.parse(x); const c = j.choices && j.choices[0].delta.content; if (c) onTok(c); if (onEv && (j.status || j.sources || j.read)) onEv(j); } catch (e) { }
    }
  }
}
async function send() {
  let t = inp.value.trim(); if (busy) return stop(); if (!t && !att.length) return;
  if (!t) t = 'Please take a look at this.';
  const imgs = att.filter(a => a.k === 'img').map(a => a.d), ims = att.filter(a => a.k === 'img').map(a => a.t || a.d), names = att.filter(a => a.k === 'txt').map(a => a.n);
  let content = t, room = MAXC - t.length;
  att.filter(a => a.k === 'txt').forEach(f => { const blk = '\n\n[Attached: ' + f.n.replace(/[\[\]\n]/g, '') + ']\n', take = room - blk.length; if (take < 50) return; const s = f.d.slice(0, take); content += blk + s; room -= blk.length + s.length; });
  att.length = 0; attDraw();
  if (!cur) { cur = { id: Date.now().toString(36), title: t.slice(0, 32), proj: pend === null ? proj : (pend || null), subject, msgs: [], t: Date.now() }; chats.unshift(cur); pend = null; }
  cur.msgs.push({ role: 'user', content, att: names.length ? names : undefined, img: imgs.length ? 1 : undefined, ims: ims.length ? ims : undefined, imf: imgs.length ? imgs : undefined });
  inp.value = ''; grow();
  await run(imgs);
}
/* AI chat title: after the first answer Spectra names the chat (free, same 'title' mode Spectra Chat uses). Only renames chats still carrying the default title (the start of your first message). */
async function autoTitle(chat) {
  const u = chat.msgs.find(m => m.role === 'user'), a = chat.msgs.find(m => m.role === 'assistant'); if (!u || !a || !a.content || chat.tt) return;
  const first = u.content.split('\n\n[Attached:')[0].trim(); if (chat.title !== first.slice(0, 32)) return;
  try {
    const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session; if (!s) return;
    const C = window.SPECSOFT_CONFIG;
    const r = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY },
      body: JSON.stringify({ mode: 'title', user: first.slice(0, 400), assistant: clean(a.content).slice(0, 300) }) });
    if (!r.ok) return; const d = await r.json(), tt = d && typeof d.title === 'string' ? d.title.trim() : '';
    if (!tt || chat.title !== first.slice(0, 32)) return;   // empty answer, or you renamed it meanwhile
    chat.title = tt.slice(0, 40); chat.tt = 1; save(); list(); plist();
  } catch (e) { }
}
/* waiting status next to the dots (". . . Debugging"). Picked from what you asked, rotates every few seconds. */
const ST = {
  def: ['Thinking', 'On it, bro!', 'Cooking up an answer', 'Brewing', 'Warming up the brain'],
  think: ['Thinking it through', 'Connecting the dots', 'Working it out', 'Thinking harder'],
  code: ['Debugging', 'Reading the code', 'Tracing the bug', 'Checking the logic'],
  math: ['Solving', 'Crunching the numbers', 'Checking my work'],
  img: ['Looking at your image', 'Studying the picture'],
  web: ['Searching the web', 'Fact-checking', 'Reading sources'],
  link: ['Reading the link', 'Skimming the page'],
  res: ['Researching', 'Digging through sources', 'Cross-checking facts', 'Writing the report']
};
const CODE_RX = /```|\b(?:function|const|bug|debug|error|exception|stack ?trace|code|script|api|sql|html|css|java(?:script)?|python|typescript|compile|syntax|undefined|null)\b|[{};]\s*$/im, MATH_RX = /\d\s*[+\-*\/^=]\s*[\dx(]|\b(?:solve|equation|derivative|integral|calculate|algebra|geometry|factor|simplify|fraction)\b|\\frac/i;
function stPool(q, o) {
  if (o.res) return ST.res; if (o.rl && !o.web) return ST.link; if (o.web) return ST.web;
  const p = []; if (o.img) p.push(...ST.img); if (CODE_RX.test(q)) p.push(...ST.code); else if (MATH_RX.test(q)) p.push(...ST.math); if (o.think) p.push(...ST.think);
  return p.length ? p.concat(ST.def.slice(0, 2)) : ST.def;
}
/* Spectra writes her own status (2-4 words, free side call, same family as the chat title). The built-in lists above cover the first second and any failure. */
async function aiStatus(q, sig) {
  try {
    const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session; if (!s) return '';
    const C = window.SPECSOFT_CONFIG;
    const r = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', { method: 'POST', signal: sig, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY }, body: JSON.stringify({ mode: 'status', user: q.slice(0, 300) }) });
    if (!r.ok) return ''; const d = await r.json(); return d && typeof d.status === 'string' ? d.status.trim().slice(0, 40) : '';
  } catch (e) { return ''; }
}
/* Live URL Reader (capability "web"): a pasted link is read by the server for +1 credit. The page only decides the wording of the waiting text. */
const URL_RX = /https?:\/\/[^\s<>\"'`\[\]]+/i;
const readsLink = () => { if (!capOn('web') || !cur) return false; const u = cur.msgs[cur.msgs.length - 1]; return !!u && u.role === 'user' && URL_RX.test(String(u.content || '').split('\n\n[Attached:')[0]); };
/* one Spectra reply for the chat as it stands (its last message is the user's).
   fallback = the old answer: put back if a "try again" fails or is stopped before anything arrives */
async function run(imgs, fallback) {
  const chat = cur, rl = readsLink() && !research, lq = String((chat.msgs[chat.msgs.length - 1] || {}).content || '').split('\n\n[Attached:')[0];
  let pool = stPool(lq, { res: research, rl, web, think, img: !!(imgs && imgs.length) }), si = Math.floor(Math.random() * pool.length);
  const a = { role: 'assistant', content: '', st: pool[si] }; chat.msgs.push(a);
  busy = true; setBtn(); draw(); plist(); list();
  const sent = chat.msgs.slice(0, -1).slice(-12), hist = sent.map(m => ({ role: m.role, content: m.content })), oc = window.SpectraCanvas && SpectraCanvas.older ? SpectraCanvas.older(chat.msgs.slice(0, -1), sent) : null; ctrl = new AbortController(); let raw = '', failed = false;
  const el = () => cur === chat ? $$('.ac-m.a').pop() : null;
  let own = false;
  if (!fallback && lq.trim().length > 2) aiStatus(lq, ctrl.signal).then(t => { if (!t || a.content || own || !a.st) return; own = true; a.st = t; const e = el(), s = e && e.querySelector('.ac-sx'); if (s) { s.textContent = t; s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; } });
  const rot = setInterval(() => { if (a.content || !a.st || own) return; si = (si + 1) % pool.length; a.st = pool[si]; const e = el(), s = e && e.querySelector('.ac-sx'); if (s) { s.textContent = a.st; s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; } }, 2600);
  try {
    await ask(hist, tok => { raw += tok; a.content = clean(raw); const e = el(); if (e) { e.innerHTML = aHtml(a, true); down(); if (window.SpectraCanvas) SpectraCanvas.live(a); } }, ctrl.signal, imgs, j => {
      if (j.status) { own = false; pool = research ? ST.res : j.status === 'reading' ? ST.link : ST.web; si = 0; a.st = pool[0]; }
      if (j.read && j.read.failed && !j.read.ok) toast('Could not open that link');
      if (j.sources) a.src = j.sources.slice(0, 10);
      const e = el(); if (e) { e.innerHTML = aHtml(a, true); if (a.content) math(e); }
    }, oc ? { canvas: oc } : undefined);   // a canvas older than the 12 messages we send still reaches Spectra
  } catch (e) {
    if (e.name !== 'AbortError') { failed = true; a.content = (a.content ? a.content + '\n\n' : '') + (e.message === 'LOGIN' ? 'Log in first, then come back so I can teach you!' : e.st === 429 ? 'Spectra is busy or you hit today\'s limit. Try again in a bit.' : 'Spectra had a problem answering. Try again.'); }
  }
  clearInterval(rot); delete a.st;
  if (fallback && (failed || !a.content)) { chat.msgs.pop(); chat.msgs.push(fallback); toast(failed ? 'Could not try again, kept the old answer' : 'Kept the old answer'); }
  else if (!a.content) chat.msgs.pop();
  busy = false; ctrl = null; setBtn(); save(); draw(); plist(); list();
  if (!failed && !fallback && a.content) autoTitle(chat);
}

/* composer */
const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 180) + 'px'; comp.classList.toggle('typing', inp.value.length > 0); };
inp.oninput = grow; sd.onclick = send;
const touchUI = matchMedia('(hover:none) and (pointer:coarse)');   // phones and tablets: Enter = new line, the Send button sends. On a computer Enter still sends (Shift+Enter = new line).
if (touchUI.matches) inp.enterKeyHint = 'enter';
inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { if (touchUI.matches) return; e.preventDefault(); send(); } };

/* attachments: up to 3 images (shrunk before sending) or text files (first ~3000 characters) */
const att = [], TXT = /\.(txt|md|csv|json|js|ts|py|html|css|java|c|cpp|cs|lua|sql|xml|yml|yaml|log)$/i;
const FILE_I = 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5';
function attDraw() {
  const b = $('#att'); b.hidden = !att.length;
  b.innerHTML = att.map((a, i) => '<span class="ac-chip">' + (a.k === 'img' ? '<img src="' + a.d + '" alt="">' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + FILE_I + '"/></svg>') + '<em>' + esc(a.n) + '</em><button type="button" data-r="' + i + '" aria-label="Remove">\u00d7</button></span>').join('');
}
$('#att').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; att.splice(+b.dataset.r, 1); attDraw(); };
function readImg(f) {
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const go = (max, q) => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k)); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); };
      let d = go(1024, .82); if (d.length > 1.2e6) d = go(768, .6);
      if (d.length > 1.2e6) { toast('That image is too big'); return; }
      if (att.length >= 3) { toast('Max 3 attachments'); return; }
      att.push({ n: f.name, k: 'img', d, t: go(640, .7) }); attDraw();
    };
    im.onerror = () => toast('Could not read that image'); im.src = fr.result;
  };
  fr.readAsDataURL(f);
}
function readTxt(f) {
  if (f.size > 1500000) { toast('That file is too big (1.5 MB max)'); return; }
  const fr = new FileReader();
  fr.onload = () => { const s = String(fr.result); if (att.length >= 3) { toast('Max 3 attachments'); return; } if (s.length > MAXC) toast('Huge file: sending the first ' + MAXC.toLocaleString() + ' characters'); att.push({ n: f.name, k: 'txt', d: s.slice(0, MAXC) }); attDraw(); };
  fr.readAsText(f);
}
function addFiles(fl) {
  [...fl].forEach(f => { if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) readImg(f); else if (f.type.indexOf('text/') === 0 || TXT.test(f.name)) readTxt(f); else toast('Images and text files only for now'); });
}
$('#fi').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
inp.addEventListener('paste', e => { const fs = [...((e.clipboardData || {}).files || [])].filter(f => f.type.indexOf('image/') === 0); if (fs.length) { e.preventDefault(); addFiles(fs); } });

/* academic tracks (Senior High and up; Elementary has none) */
const TR = { 'ICT/TVL': [
  ['TVL/ICT', ['Computer Programming', 'Computer Systems Servicing', 'Animation', 'Illustration', 'Technical Drafting']],
  ['TVL/Home Economics', ['Cookery', 'Bread and Pastry', 'Food and Beverage', 'Housekeeping', 'Dressmaking', 'Caregiving']],
  ['TVL/Industrial Arts', ['Electrical Installation', 'Automotive Servicing', 'Welding', 'Carpentry', 'Plumbing', 'Electronics']],
  ['TVL/Agri-Fishery Arts', ['Crop Production', 'Animal Production', 'Aquaculture', 'Food Processing']],
  ['STEM', ['Pre-Calculus', 'Basic Calculus', 'General Chemistry', 'General Physics', 'General Biology']],
  ['ABM', ['Business Math', 'Fundamentals of ABM', 'Business Finance', 'Organization and Management', 'Principles of Marketing']],
  ['HUMSS', ['Creative Writing', 'Philippine Politics and Governance', 'World Religions', 'Community Engagement', 'Disciplines in the Social Sciences']],
  ['GAS', ['Humanities', 'Social Sciences', 'Applied Economics', 'Disaster Readiness and Risk Reduction']]] };
const hasTr = () => !noTrack() && !!TR[subject];
function trk() {
  const L = hasTr() ? TR[subject] : null, el = $('#trk'); el.hidden = !L; if (!L) { el.innerHTML = ''; return; }
  el.innerHTML = L.map(t => '<div class="ac-tk"><button type="button" class="ac-tn" data-t="' + t[0] + '">' + t[0] + '</button><button type="button" class="ac-tx" data-x="1">Expand more<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button><div class="ac-ts">' + t[1].map(s => '<button type="button" data-t="' + t[0] + ': ' + s + '">' + s + '</button>').join('') + '</div></div>').join('');
}
$('#trk').onclick = e => {
  const x = e.target.closest('[data-x]'); if (x) { x.parentNode.classList.toggle('open'); return; }
  const b = e.target.closest('[data-t]'); if (!b) return; track = track === b.dataset.t ? '' : b.dataset.t;
  $$('#trk .ac-tk').forEach(k => k.classList.toggle('on', !!track && track.split(': ')[0] === k.querySelector('.ac-tn').dataset.t));
  $$('#trk .ac-ts button').forEach(s => s.classList.toggle('on', s.dataset.t === track)); tag();
};

/* tag line + modes */
const tag = () => {
  const m = [(noTrack() ? '' : track) || subject || 'Any subject', level];
  if (research) m.push('Deep research'); else { if (web) m.push('Web'); if (think) m.push('Reasoning'); }
  if (persona !== 'spectra') m.push(PERS.find(p => p.id === persona).n);
  const pj = curProj(); if (pj && pname(pj)) m.push(pname(pj));
  $('#tg').textContent = m.join(' \u00b7 '); inp.placeholder = subject ? 'Ask about ' + subject + '...' : 'Ask me anything...';
  $('#tl').classList.toggle('lit', web || think || research);
  const gm = research ? 'res' : (think && web) ? 'tw' : think ? 't' : web ? 'w' : ''; if (gm) comp.dataset.gm = gm; else delete comp.dataset.gm;
};
const syncModes = () => { $('#tw').checked = web; $('#tt').checked = think; $('#tr').checked = research; tag(); };
$('#tw').onchange = e => { web = e.target.checked; if (web) research = false; syncModes(); };
$('#tt').onchange = e => { think = e.target.checked; if (think) research = false; syncModes(); };
$('#tr').onchange = e => { research = e.target.checked; if (research) { web = false; think = false; } syncModes(); };

/* subjects + level */
const SI = { 'Math': 'M5 4h14l-7 8 7 8H5', 'General Sciences': 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3', 'Social Studies': P.globe, 'Languages': 'M4 5h9M8.5 3v2M6 5c0 4 3 7 7 8M11 5c0 3-3 6-7 8M14 21l4-10 4 10M15.5 17.5h5', 'ICT/TVL': 'M4 5h16v11H4zM9 20h6M12 16v4', 'General Knowledge': 'M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z' };
$('#pills').innerHTML = SUBJ.map(s => '<button class="ac-pill" type="button" data-s="' + s + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + SI[s] + '"/></svg>' + s + '</button>').join('');
$('#pills').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; subject = subject === b.dataset.s ? '' : b.dataset.s; track = ''; trk(); web = WEB_AUTO.includes(subject); if (web) research = false; syncModes(); $$('.ac-pill').forEach(x => x.classList.toggle('on', x.dataset.s === subject)); if (!hasTr()) inp.focus(); };
$('#lv').innerHTML = LEVELS.map(l => '<button type="button" data-l="' + l + '">' + l + '</button>').join('');
const lvDraw = () => $$('#lv button').forEach(b => b.classList.toggle('on', b.dataset.l === level));
$('#lv').onclick = e => {
  const b = e.target.closest('[data-l]'); if (!b) return; level = b.dataset.l; SS('sa.acad.level', level);
  if (noTrack()) { if (TR[subject]) toast('Elementary keeps it simple, no tracks needed'); track = ''; }
  trk(); lvDraw(); tag();
};

/* "+" menu: add files, add to project, persona */
const pops = { ap: '#pp', tl: '#pop', md: '#mpop' };
const closePops = () => { Object.values(pops).forEach(s => $(s).classList.remove('open')); $('#ap').classList.remove('open'); };
const togglePop = id => { const o = !$(pops[id]).classList.contains('open'); closePops(); if (!o) return; $(pops[id]).classList.add('open'); if (id === 'ap') { $('#ap').classList.add('open'); $$('#pp .ac-sub,#pp .ac-mi.sb').forEach(x => x.classList.remove('open')); $('#pcur').textContent = PERS.find(p => p.id === persona).n; } };
const curProj = () => cur ? (cur.proj || '') : (pend === null ? (proj || '') : (pend || ''));
function ppjDraw() {
  const c = curProj();
  $('#ppj').innerHTML = [{ id: '', n: 'No project' }].concat(liveProjs()).map(p => '<button type="button" class="ac-mi" data-pj="' + p.id + '"><i data-ic="' + (c === p.id ? 'check' : 'blank') + '"></i><span>' + esc(p.n) + '</span></button>').join('') + '<button type="button" class="ac-mi" data-pj="__new"><i data-ic="plus"></i><span>New project</span></button>';
  paint($('#ppj'));
}
function ppsDraw() {
  $('#pps').innerHTML = PERS.map(p => '<button type="button" class="ac-mi" data-pe="' + p.id + '"><i data-ic="' + (persona === p.id ? 'check' : 'blank') + '"></i><span>' + p.n + '</span></button>').join('');
  paint($('#pps'));
}
$('#pp').onclick = e => {
  const pj = e.target.closest('[data-pj]');
  if (pj) {
    const id = pj.dataset.pj;
    if (id === '__new') { closePops(); newProj(nid => { setProj(nid); toast('Added to ' + pname(nid)); }); return; }
    setProj(id); closePops(); toast(id ? 'Added to ' + pname(id) : 'No project'); return;
  }
  const pe = e.target.closest('[data-pe]');
  if (pe) {
    const id = pe.dataset.pe;
    if (id === 'custom' && !custom.trim()) { closePops(); if (window.SpectraAcadSettings) SpectraAcadSettings.open('personal', 'custom'); else toast('Settings are not loaded'); return; }
    persona = id; SS('sa.persona', persona); tag(); closePops(); toast(PERS.find(p => p.id === id).n + ' on'); return;
  }
  const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
  if (a === 'file') { closePops(); $('#fi').click(); return; }
  const s = $(a === 'proj' ? '#ppj' : '#pps'), o = !s.classList.contains('open');
  $$('#pp .ac-sub,#pp .ac-mi.sb').forEach(x => x.classList.remove('open'));
  if (o) { s.classList.add('open'); b.classList.add('open'); if (a === 'proj') ppjDraw(); else ppsDraw(); }
};
$('#ap').onclick = e => { e.stopPropagation(); togglePop('ap'); };
$('#tl').onclick = e => { e.stopPropagation(); togglePop('tl'); };

/* model picker: same models and same saved choice ('sa.model') as Spectra Chat */
const MODELS = [{ id: '2.5', n: 'Spectrum 2.5', d: 'Fastest', g: 'Spectrum Series' }, { id: '3', n: 'Spectrum 3', d: 'Balanced', g: 'Spectrum Series' }, { id: '3.5', n: 'Spectrum 3.5', d: 'Smartest', g: 'Spectrum Series' }, { id: 'lumen4', n: 'Lumen 4', d: 'Newest', g: 'Lumen Series' }];
const model = () => MODELS.find(x => x.id === String(LS('sa.model', '3.5'))) || MODELS[2];
function mdraw() { let g = ''; $('#mn').textContent = model().n; $('#mpop').innerHTML = MODELS.map(m => (m.g !== g ? (g = m.g, '<b>' + g + '</b>') : '') + '<button type="button" data-m="' + m.id + '" class="' + (m.id === model().id ? 'on' : '') + '"><span>' + m.n + '</span><small>' + m.d + '</small></button>').join(''); }
$('#md').onclick = e => { e.stopPropagation(); togglePop('md'); };
$('#mpop').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; SS('sa.model', b.dataset.m); mdraw(); closePops(); toast(model().n + ' on'); };
document.addEventListener('click', e => { if (!e.target.closest('.ac-pop')) closePops(); if (mid !== null && !e._o && !e.target.closest('#cm')) closeMenu(); if (pmid !== null && !e._o && !e.target.closest('#pmn')) closePm(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePops(); closeMenu(); closePm(); } });
addEventListener('resize', () => { closeMenu(); closePm(); });

/* greeting, credits, drawer */
/* greeting: depends on the hour and the weekday. "@user" becomes your nickname. Picked once per time slot (not on every redraw), and "New chat" rolls a new one. */
const GRT = {
  any: ['Hi @user, what do we learn about today?', 'Here we go!', 'Spectra and Spectre?', "What's cooking?", 'Assignment questions, @user?', 'Ready when you are, @user.', "What's the topic today, @user?", 'Got a tough one for me, @user?', 'Pick a subject, @user. I am ready.', 'Quiz me or teach me, @user?', 'Stuck on something, @user?'],
  a3: ['Really? 3 AM? Do you even sleep, @user?', '3 AM for academic lessons?', 'What an unusual hour to be awake, @user!', 'Nothing good happens at 3 AM except studying, apparently.', 'Go to sleep, @user... after one question.'],
  early: ['Bro woke up early, good morning, @user.', "Isn't it early to be up, @user?", 'Hello, morning bird.', 'Good morning @user, did you tidy up your room?', 'Coffee or milk today?', 'Up before the sun, @user. Respect.', 'Fresh brain, fresh start, @user.'],
  morning: ['Good morning, @user.', 'Morning, @user! Breakfast first?', 'Fresh morning, fresh lesson, @user.', 'Rise and shine, @user!', 'Ready for class, @user?', 'Morning, @user. Did you eat yet?'],
  late: ['Good morning, @user. What is on the schedule?', 'Mid-morning brain boost, @user?', 'Study time, @user?', 'Morning, @user. What are we tackling?'],
  noon: ['Good noon, @user. Lunch break lesson?', 'Did you eat lunch, @user?', 'Midday check-in, @user. What is up?', 'Feed the brain too, @user.'],
  after: ['Good afternoon, @user.', 'Afternoon slump, @user? Let us wake that brain up.', 'Homework hour, @user?', 'School is out? Let us review, @user.', 'Snack and study, @user?'],
  eve: ['Good evening, @user.', 'Evening, @user. Homework time?', 'Dinner yet, @user?', 'Golden hour study session, @user?', 'How was your day, @user?'],
  night: ['Good night owl, @user.', 'Night session, @user? Let us make it count.', 'Almost bedtime, @user. One last question?', 'Burning the night oil, @user?', 'Still up, @user? Let us finish strong.'],
  mid: ['Midnight oil, @user?', 'Past midnight, @user. Last question, then sleep.', 'Midnight study squad, @user!', 'Shouldn\'t you be asleep, @user?', 'Late-night cram session, @user?'],
  d1: ['Monday blues again!', 'Monday! Let us make it a good one, @user.', 'Monday it is. One lesson at a time, @user.'],
  d2: ['Happy Tuesday, @user.', 'Tuesday grind, @user. Let us go!', 'Tuesday brain mode: on.'],
  d3: ['Wednesday it is, @user!', 'Halfway through the week, @user. Nice.', 'Hump day! What are we learning?'],
  d4: ['Thursday already, @user?', 'Almost Friday, @user. Stay locked in.', 'Thursday vibes. Any homework?'],
  d5: ['Happy Friday, @user!', 'Friday! Homework first, then fun, @user.', 'TGIF, @user. One more lesson?'],
  d6: ['Studying on a Saturday, @user? Respect.', 'Saturday vibes, @user. Chill lesson?', 'No school today, but here we are, @user!'],
  d0: ['Sunday scaries, @user? Let us get ahead.', 'Lazy Sunday, @user. Light review?', 'Sunday prep for tomorrow, @user?']
};
const grSlot = h => h === 3 ? 'a3' : h >= 4 && h <= 6 ? 'early' : h <= 8 && h >= 7 ? 'morning' : h >= 9 && h <= 11 ? 'late' : h >= 12 && h <= 13 ? 'noon' : h >= 14 && h <= 17 ? 'after' : h >= 18 && h <= 20 ? 'eve' : h >= 21 ? 'night' : 'mid';
let grC = null;
const gr = () => {
  const nick = (CFGS().nick || '').trim() || nm() || 'there', d = new Date(), s = grSlot(d.getHours()), k = s + '|' + d.getDay();
  if (!grC || grC.k !== k) {
    const r = Math.random(), tp = s === 'a3' ? .9 : s === 'early' ? .7 : .55, dp = s === 'a3' ? 0 : .2;
    const pool = r < tp ? GRT[s] : r < tp + dp ? GRT['d' + d.getDay()] : GRT.any, opts = pool.filter(x => !grC || x !== grC.t);
    grC = { k, t: (opts.length ? opts : pool)[Math.floor(Math.random() * (opts.length ? opts.length : pool.length))] };
  }
  $('#gr').textContent = grC.t.replace(/@user/g, nick);
};
const cred = () => { const u = LS('sa.left', null); $('#cr').textContent = u && u.day === new Date().toISOString().slice(0, 10) && u.limit > 0 ? u.left + ' / ' + u.limit + ' credits' : 'Credits'; };
const un = $('[data-user-name]'); if (un) new MutationObserver(gr).observe(un, { childList: true, characterData: true, subtree: true });
const shell = $('#app'), closeDrawer = () => shell.classList.remove('drawer');
$('#bg').onclick = () => shell.classList.add('drawer'); $('#bk').onclick = closeDrawer;
const colb = $('#col'), setMin = m => { shell.classList.toggle('min', m); SS('sa.acad.min', m); colb.setAttribute('aria-label', m ? 'Expand sidebar' : 'Collapse sidebar'); };
colb.onclick = () => setMin(!shell.classList.contains('min'));
$('.ac-s').addEventListener('click', () => { if (shell.classList.contains('min')) { setMin(false); setTimeout(() => $('#q').focus(), 260); } });
if (LS('sa.acad.min', false)) setMin(true);

/* settings module hooks */
function sync() { persona = LS('sa.persona', LS('sa.acad.persona', 'spectra')); custom = String(CFGS().persona || LS('sa.acad.custom', '') || '').slice(0, 400); if (!PERS.some(p => p.id === persona) || (persona === 'custom' && !custom.trim())) persona = 'spectra'; tag(); mdraw(); gr(); cred(); }
window.SpectraAcad = { md, math, paint, toast, redraw: draw, setTheme: setTh, sync, msgs: () => (cur ? cur.msgs : []), save, busy: () => busy, copy: copyTxt, pdf: (text, title) => savePdf(null, { text, title }), ask: (onTok, sig, extra) => ask([], onTok, sig, undefined, undefined, extra) };
addEventListener('storage', e => { if (!e.key || e.key === 'sa.persona' || e.key === 'sa.cfg' || e.key === 'sa.model') sync(); });
th.dataset.ic = root.dataset.theme === 'dark' ? 'sun' : 'moon';
mdraw(); paint(); gr(); cred(); syncModes(); lvDraw(); plist(); list(); draw(); setBtn(); openHash();
})();
