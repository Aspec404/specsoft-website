/* SPECSOFT® Spectra Academics Settings (v1): the settings center from Spectra Chat, brought to Academics.
   SHARED with Spectra Chat (same localStorage keys): nickname + custom persona ('sa.cfg'), persona ('sa.persona'), model ('sa.model').
   ONLY for Academics: reply length + emojis ('sa.acad.cfg'), theme ('sa.acad.theme'), level, chats.
   Needs window.SpectraAcad from spectra-academics.js (paint, toast, setTheme, sync, msgs). */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const LS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = () => window.SpectraAcad || {};
const toast = t => { if (A().toast) A().toast(t); };
const sync = () => { if (A().sync) A().sync(); };

/* ---------- data ---------- */
const PERSONAS = [['spectra', 'Spectra (Default)'], ['dev', 'Developer Mode'], ['creative', 'Creative'], ['custom', 'Use my custom one']];
const MODELS = [['2.5', 'Spectrum 2.5'], ['3', 'Spectrum 3'], ['3.5', 'Spectrum 3.5'], ['lumen4', 'Lumen 4']];
const CFG = () => Object.assign({ nick: '', persona: '' }, LS('sa.cfg', {}) || {});
const putCfg = (k, v) => SS('sa.cfg', Object.assign({}, LS('sa.cfg', {}) || {}, { [k]: v }));
const ACFG = () => Object.assign({ len: 'detailed', emo: 'few' }, LS('sa.acad.cfg', {}) || {});
const putA = (k, v) => SS('sa.acad.cfg', Object.assign({}, LS('sa.acad.cfg', {}) || {}, { [k]: v }));
const persona = () => { const p = LS('sa.persona', LS('sa.acad.persona', 'spectra')); return PERSONAS.some(x => x[0] === p) ? p : 'spectra'; };
const customText = () => String(CFG().persona || LS('sa.acad.custom', '') || '');
const modelId = () => { const m = String(LS('sa.model', '3.5')); return MODELS.some(x => x[0] === m) ? m : '3.5'; };

/* ---------- icons + small builders ---------- */
const IC = {
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  smile: 'M12 3a9 9 0 100 18 9 9 0 000-18zM8.5 14a4 4 0 007 0M9 9.5h.01M15 9.5h.01',
  gauge: 'M4 18a8 8 0 1116 0M12 18l4-6',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  bug: 'M9 9h6v7a3 3 0 01-6 0zM9 5l1.5 2M15 5l-1.5 2M5 13h4M15 13h4M5 8l3 2M19 8l-3 2M5 18l4-2M19 18l-4-2',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8h.01'
};
const svg = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
const TABS = [['general', 'General', 'gear'], ['personal', 'Personalization', 'smile'], ['usage', 'Usage limits', 'gauge'], ['data', 'Data controls', 'data'], ['bug', 'Report bug', 'bug'], ['about', 'About', 'info']];
const SEGS = {};
const sw = (k, on) => '<label class="as-sw"><input type="checkbox" data-sw="' + k + '"' + (on ? ' checked' : '') + '><i></i></label>';
const seg = (k, opts, cur) => { SEGS[k] = opts; return '<div class="as-seg" data-seg="' + k + '">' + opts.map((o, i) => '<button type="button" data-i="' + i + '" class="' + (String(o[0]) === String(cur) ? 'on' : '') + '">' + o[1] + '</button>').join('') + '</div>'; };
const r = (l, d, ctl, stack) => '<div class="as-r' + (stack ? ' stack' : '') + '"><div class="as-t"><b>' + l + '</b>' + (d ? '<span>' + d + '</span>' : '') + '</div>' + (ctl ? '<div class="as-c">' + ctl + '</div>' : '') + '</div>';
const sec = t => '<h4 class="as-sec">' + t + '</h4>';
const btn = (act, label, cls) => '<button type="button" class="as-btn' + (cls ? ' ' + cls : '') + '" data-act="' + act + '">' + label + '</button>';
function sure(b, fn) {
  if (b.dataset.sure) { delete b.dataset.sure; return fn(); }
  b.dataset.sure = 1; const t = b.textContent; b.textContent = 'Click again to confirm';
  setTimeout(() => { if (b.isConnected && b.dataset.sure) { delete b.dataset.sure; b.textContent = t; } }, 3000);
}

/* ---------- panes ---------- */
const PANES = {
  general() {
    const c = CFG(), dark = (document.documentElement.dataset.theme || 'light') === 'dark';
    return sec('Chat') +
      r('Nickname', 'What Spectra calls you. Leave it empty to use your profile name. Shared with Spectra Chat.', '<input class="as-in" data-txt="nick" maxlength="20" placeholder="Bro" value="' + esc(c.nick) + '">', 1) +
      sec('Look') +
      r('Theme', 'Light or dark for Spectra Academics.', seg('theme', [['light', 'Light'], ['dark', 'Dark']], dark ? 'dark' : 'light'), 1) +
      '<div class="as-empty">Your nickname, persona, custom persona and model are shared with Spectra Chat, so changing them in one place changes both.</div>';
  },
  personal() {
    const t = customText();
    return sec('Persona') +
      r('Persona', 'How Spectra shows up for you.', seg('persona', PERSONAS, persona()), 1) +
      '<div class="as-r col"><div class="as-t"><b>Custom persona</b><span>Used when "Use my custom one" is picked. It changes tone and focus only, never her rules or her teaching style basics.</span></div>' +
      '<textarea class="as-ta" id="asCustom" data-txt="persona" maxlength="400" rows="4" placeholder="e.g. short answers, hype energy, explain things like I\'m new to this.">' + esc(t) + '</textarea>' +
      '<div class="as-cnt"><span id="asCnt">' + t.length + '/400</span></div></div>' +
      sec('Model and style') +
      r('Model', 'Faster or smarter, your call. Shared with Spectra Chat.', seg('model', MODELS, modelId()), 1) +
      r('Reply length', 'Only for Academics. Detailed is best for learning.', seg('len', [['short', 'Short'], ['normal', 'Normal'], ['detailed', 'Detailed']], ACFG().len), 1) +
      r('Emojis', 'Only for Academics. How many she sprinkles in.', seg('emo', [['few', 'Less'], ['normal', 'Normal'], ['lots', 'More']], ACFG().emo), 1);
  },
  usage() {
    const u = LS('sa.left', null), day = new Date().toISOString().slice(0, 10), ok = u && u.day === day && u.limit > 0;
    const pct = ok ? Math.min(100, Math.round(Math.max(u.limit - u.left, 0) / u.limit * 100)) : 0;
    return sec('Today') +
      '<div class="as-r col"><div class="as-t"><b>' + (ok ? u.left + ' of ' + u.limit + ' credits left' : 'Send a message to see your count') + '</b><span id="asReset"></span></div><div class="as-bar"><i style="width:' + pct + '%"></i></div></div>' +
      sec('What things cost') +
      r('Normal message', '', '<span class="as-n">1 credit</span>') + r('Web search', '', '<span class="as-n">2 credits</span>') + r('Deep reasoning', '', '<span class="as-n">3 credits</span>') + r('Deep research', '', '<span class="as-n">5 credits</span>') +
      r('Making flashcards', 'Saved on the message, so studying them again is free.', '<span class="as-n">1 credit</span>') +
      r('Making a video', 'Saved on the message, so watching it again is free.', '<span class="as-n">2 credits</span>') + r('Spectra voice in a video', 'About one credit per step. The free browser voice costs nothing.', '<span class="as-n">1 / step</span>') +
      r('Sending images', 'Added to any of the above.', '<span class="as-n">+1 credit</span>') +
      '<div class="as-empty">Your count refreshes after every message. Limits reset at midnight UTC.</div>';
  },
  data() {
    return sec('Your data') +
      r('Export Academics chats', 'Chats, projects and Academics settings as one file.', btn('export', 'Export'), 1) +
      sec('Delete') +
      r('Delete all Academics chats', 'Removes every chat on this page, including pinned ones. Projects stay.', btn('clrchats', 'Delete chats', 'danger'), 1) +
      r('Reset Academics settings', 'Reply length, emojis and level go back to defaults. Persona, nickname and model are shared with Spectra Chat, so reset those there.', btn('reset', 'Reset settings', 'danger'), 1) +
      '<div class="as-empty">Chats and settings are stored in this browser on this device, so clearing your browser data removes them. Export first if you want a backup.</div>';
  },
  bug() {
    return sec('Report a bug') +
      '<div class="as-r col"><div class="as-t"><b>What kind of problem?</b></div><select class="as-sel" id="asBugCat"><option value="bug">Something is broken</option><option value="answer">Spectra said something wrong</option><option value="idea">Feature idea</option><option value="legal">Legal issue</option><option value="other">Something else</option></select></div>' +
      '<div class="as-r col"><div class="as-t"><b>What happened?</b><span>The more detail, the faster we can fix it. Your browser type and screen size are attached automatically.</span></div><textarea class="as-ta" id="asBugTxt" maxlength="1500" rows="5" placeholder="What did you do, what did you expect, what actually happened?"></textarea></div>' +
      r('Include my last messages', 'Attaches the last 6 messages of this chat so we can see what went wrong. Off by default.', sw('bugchat', false)) +
      '<div style="padding-top:16px">' + btn('bug', 'Send report', 'main') + '</div>' +
      '<div class="as-empty">Reports go privately to the SPECSOFT team. If sending fails, your report is copied so you can paste it in our Discord.</div>';
  },
  about() {
    return sec('Spectra Academics') +
      r('Version', 'Spectra Academics v1 \u00b7 SPECSOFT\u00ae', '<span class="as-n">v1</span>') +
      r('What is this?', 'Spectra as a patient teacher. She can make mistakes, so double-check important answers with a teacher or textbook.', '') +
      sec('Links') +
      r('Spectra Chat', 'The everyday Spectra, with memory and more settings.', '<a class="as-btn" href="spectra-ai.html">Open</a>') +
      r('Discord community', 'Help, feedback and events.', '<a class="as-btn" href="https://discord.gg/Uym7ybcWK3" target="_blank" rel="noopener noreferrer">Join</a>');
  }
};

/* ---------- modal ---------- */
let modal, nav, pane, tab = 'general', tick = 0;
function build() {
  if (modal) return;
  modal = document.createElement('div'); modal.className = 'as-modal'; modal.id = 'asSet';
  modal.innerHTML = '<div class="as-card" role="dialog" aria-modal="true" aria-label="Spectra Academics settings"><div class="as-h"><b>Settings</b><button type="button" class="as-x" id="asX" aria-label="Close settings">\u00d7</button></div><div class="as-b"><nav class="as-nav" id="asNav" aria-label="Settings sections"></nav><div class="as-pane" id="asPane"></div></div></div>';
  document.body.appendChild(modal); nav = $('#asNav'); pane = $('#asPane');
  $('#asX').onclick = close; modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('on')) { e.stopPropagation(); close(); } }, true);
  nav.onclick = e => { const b = e.target.closest('button[data-tab]'); if (!b) return; tab = b.dataset.tab; draw(true); };
  pane.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.sw) return;   // only the "include my last messages" switch lives here
  });
  pane.addEventListener('input', e => {
    const t = e.target; if (!t.dataset || !t.dataset.txt) return;
    const k = t.dataset.txt, v = t.value.slice(0, k === 'nick' ? 20 : 400);
    putCfg(k, v); if (k === 'persona') { const c = $('#asCnt'); if (c) c.textContent = v.length + '/400'; } sync();
  });
  pane.addEventListener('click', onPane);
}
function usageTick() {
  const el = $('#asReset'); if (!el) return clearInterval(tick);
  const n = new Date(), nx = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1), ms = nx - n.getTime();
  el.textContent = 'Resets in ' + Math.floor(ms / 36e5) + 'h ' + Math.floor(ms % 36e5 / 6e4) + 'm (midnight UTC)';
}
function draw(reset) {
  clearInterval(tick);
  nav.innerHTML = TABS.map(t => '<button type="button" data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + svg(IC[t[2]]) + '<span>' + t[1] + '</span></button>').join('');
  const keep = pane.scrollTop; pane.innerHTML = PANES[tab](); pane.scrollTop = reset ? 0 : keep;
  const on = nav.querySelector('.on'); if (reset && on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (tab === 'usage') { usageTick(); tick = setInterval(usageTick, 30000); }
}
function open(t, focus) {
  build(); if (t) tab = t; draw(true); modal.classList.add('on');
  const app = $('#app'); if (app) app.classList.remove('drawer');
  if (focus === 'custom') setTimeout(() => { const ta = $('#asCustom'); if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); } }, 60);
}
function close() { if (modal) modal.classList.remove('on'); clearInterval(tick); }

/* ---------- actions ---------- */
function onPane(e) {
  const sg = e.target.closest('.as-seg button');
  if (sg) {
    const k = sg.parentNode.dataset.seg, v = SEGS[k][+sg.dataset.i][0];
    if (k === 'persona') { SS('sa.persona', v); sync(); draw(); if (v === 'custom' && !customText().trim()) { toast('Write your custom persona below'); const ta = $('#asCustom'); if (ta) ta.focus(); } else toast(PERSONAS.find(p => p[0] === v)[1] + ' on'); return; }
    if (k === 'model') { SS('sa.model', v); sync(); }
    else if (k === 'len' || k === 'emo') putA(k, v);
    else if (k === 'theme') { if (A().setTheme) A().setTheme(v); }
    draw(); return;
  }
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
  if (a === 'export') exportData();
  else if (a === 'clrchats') sure(b, () => { SS('sa.acad.chats', []); toast('All chats deleted'); setTimeout(() => location.reload(), 500); });
  else if (a === 'reset') sure(b, () => { ['sa.acad.cfg', 'sa.acad.level', 'sa.acad.eq'].forEach(k => { try { localStorage.removeItem(k); } catch (er) { } }); if (window.SpectraEquip) SpectraEquip.refresh(); if (A().redraw) A().redraw(); sync(); draw(); toast('Settings reset'); });
  else if (a === 'bug') sendBug(b);
}
function exportData() {
  const d = { app: 'spectra-academics', v: 1, t: Date.now(), settings: { acad: ACFG(), level: LS('sa.acad.level', 'Senior High'), equip: LS('sa.acad.eq', null) }, chats: LS('sa.acad.chats', []), projects: LS('sa.acad.proj', []) };
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
  a.download = 'spectra-academics-export-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Export downloaded');
}
async function sendBug(b) {
  const cat = $('#asBugCat').value, txt = $('#asBugTxt').value.trim(), inc = !!(pane.querySelector('[data-sw=bugchat]') || {}).checked;
  if (txt.length < 10) return toast('Tell us a bit more (10+ characters)');
  const ms = A().msgs ? A().msgs() : [];
  const info = ['Academics', (navigator.userAgent || '').slice(0, 160), innerWidth + 'x' + innerHeight, 'model ' + modelId(), 'persona ' + persona(), new Date().toISOString()].join(' | ');
  const chat = inc ? ms.slice(-6).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 500) })) : [];
  b.disabled = true; const label = b.textContent; b.textContent = 'Sending...';
  try {
    const sb = window.getSupabaseClient && window.getSupabaseClient(), s = sb && (await sb.auth.getSession()).data.session; if (!s) { toast('Log in first to send a report'); b.disabled = false; b.textContent = label; return; }
    const C = window.SPECSOFT_CONFIG;
    const rs = await fetch(C.SUPABASE_URL + '/functions/v1/spectra-chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token, apikey: C.SUPABASE_ANON_KEY }, body: JSON.stringify({ mode: 'bug', category: cat, message: txt.slice(0, 1500), info, chat }) });
    const j = rs.ok ? await rs.json() : null; if (!j || !j.ok) throw 0;
    $('#asBugTxt').value = ''; toast('Report sent. Thank you!');
  } catch (e) {
    const all = '[Spectra Academics ' + cat + '] ' + txt + '\n' + info;
    try { await navigator.clipboard.writeText(all); toast('Could not send it, so I copied your report. Paste it in our Discord!'); } catch (er) { toast('Could not send the report'); }
  }
  b.disabled = false; b.textContent = label;
}

const gear = $('#st'); if (gear) gear.onclick = () => open('general');
window.SpectraAcadSettings = { open, close };
})();
