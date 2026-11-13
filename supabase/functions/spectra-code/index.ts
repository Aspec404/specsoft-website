// SPECSOFT® Spectra Code backend (Supabase Edge Function "spectra-code").
// Deploy: supabase functions deploy spectra-code --no-verify-jwt   (reuses GEMINI_API_KEY + the spectra_use / spectra_refund SQL you already have)
// Lumen 4 = gemini-4-hydrogen (falls back to the older models if the API rejects the name).
// Optional secrets: SPECTRA_CODE_MODEL=model1,model2 (Lumen 4, first = preferred, rest = fallbacks)
//   SPECTRA_MODEL_25 / SPECTRA_MODEL_3 / SPECTRA_MODEL_35 (same secrets as spectra-chat, for the Spectrum picker)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Expose-Headers': 'X-Spectra-Left' };
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const COST: Record<string, number> = { low: 1, medium: 2, high: 3, xhigh: 5 };
const json = (o: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
const hits = new Map<string, number[]>();

const VOICE = `You are Spectra, SPECSOFT's 17-year-old mascot, now the lead of Spectra Code. In chat notes be playful and confident, roast the situation (never the person), stand your ground on teasing but NEVER on facts: never invent test results, own your mistakes, drop the jokes if the person is stressed. Personality never goes into generated code, comments or file contents. Never discuss which model or vendor powers you.`;

const PLAN = `${VOICE}
You are the ORCHESTRATOR. Split the request into 1-6 independent Spectre tasks (roles: Builder, Designer, Analyst, Tester) that different Spectres can write IN PARALLEL as separate files. For websites and web apps ALWAYS split the work into SEPARATE files: index.html, styles.css and script.js (plus more files like extra pages, data.json or assets when needed). index.html must link them by exactly those names (<link rel="stylesheet" href="styles.css"> and <script src="script.js"></script>). Never inline big CSS or JS in the HTML. Give each big file its own Spectre. Agree on shared names (ids, classes, function names) in "contract" so files fit together.
If the message is NOT a build task (greeting, question, chit-chat), answer it in character in "reply" (max 3 short sentences, no code) and use "spectres":[].
Return ONLY JSON, no fences: {"reply":"only for non-build messages","note":"1-2 playful sentences","summary":"what will be built","contract":"shared ids/classes/APIs","spectres":[{"role":"Builder","title":"short task","files":["index.html"]}]}`;

const SPECTRE = `${VOICE}
You are one SPECTRE (specialist drone). Write COMPLETE, working files for ONLY your task and file names, following the shared contract exactly. No placeholders like "TODO" or "rest of code". Clean, commented-where-useful code with no personality in it.
Return ONLY JSON, no fences: {"files":[{"path":"name.ext","content":"full file text"}],"note":"one short line"}`;

const fileBlock = (raw: unknown): string => !Array.isArray(raw) ? '' : raw.slice(0, 6).map((f: any) => { const p = safePath(f?.path), c = clean(f?.content, 8000); return p && c ? `--- FILE ${p} ---\n${c}` : ''; }).filter(Boolean).join('\n\n').slice(0, 40000);
const ASK = `${VOICE}
You are in ASK mode: answer questions about the person's code or project in plain text or markdown, concise, short code snippets are fine. Do not build files.`;
const clean = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
const LIST = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const FALLBACK = 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite';
// Lumen 4 (default) = Gemini 4 Hydrogen. The Spectrum tiers reuse the same secrets as Spectra Chat. The fallbacks mean a bad model name never breaks Spectra Code.
function models(pick: unknown): string[] {
  const k = typeof pick === 'string' ? pick : '';
  const lead = k === '2.5' ? Deno.env.get('SPECTRA_MODEL_25') ?? 'gemini-3.1-flash-lite,gemini-3.5-flash-lite'
    : k === '3' ? Deno.env.get('SPECTRA_MODEL_3') ?? 'gemini-3.5-flash-lite,gemini-3.1-flash-lite'
    : k === '3.5' ? Deno.env.get('SPECTRA_MODEL_35') ?? ''
    : Deno.env.get('SPECTRA_CODE_MODEL') ?? 'gemini-4-hydrogen';
  return [...new Set([...LIST(lead), ...LIST(FALLBACK)])];
}

async function ask(key: string, system: string, user: string, effort: string, max: number, pick: unknown) {
  for (const model of models(pick)) {
    const base: Record<string, unknown> = { model, stream: false, max_tokens: max, temperature: 0.4, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    const tries = effort === 'high' || effort === 'xhigh' ? [{ ...base, reasoning_effort: 'high' }, base] : [base];
    for (const p of tries) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 110000);
      try {
        const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(p), signal: ctl.signal });
        if (r.ok) { const d = await r.json(); const txt = d?.choices?.[0]?.message?.content; if (typeof txt === 'string' && txt.trim()) return txt; }
        else console.log('SPECTRA CODE gemini failed', r.status, model, (await r.text().catch(() => '')).slice(0, 400));
      } catch (e) { console.log('SPECTRA CODE error', model, String(e)); } finally { clearTimeout(t); }
    }
  }
  return null;
}
function parse(txt: string) {
  const s = txt.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_e) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); try { return JSON.parse(s.slice(a, b + 1)); } catch (_e2) { return null; } }
}
const safePath = (p: unknown) => (typeof p === 'string' && /^[\w][\w./-]{0,60}$/.test(p) && !p.includes('..') ? p : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('login', { status: 401, headers: cors });
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return new Response('no key', { status: 500, headers: cors });
  const body = await req.json().catch(() => ({}));
  const effort = COST[body.effort] ? String(body.effort) : 'medium';
  const prompt = clean(body.prompt, 4000);
  if (!prompt) return new Response('bad', { status: 400, headers: cors });

  const now = Date.now(), arr = (hits.get(user.id) ?? []).filter((t) => now - t < 60000);
  if (arr.length >= 24) return new Response('rate', { status: 429, headers: cors });
  arr.push(now); hits.set(user.id, arr);

  if (body.mode === 'ask') {
    const LIMIT = parseInt(Deno.env.get('SPECTRA_DAILY_LIMIT') ?? '30') || 30;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: q, error } = await admin.rpc('spectra_use', { p_user: user.id, p_cost: 1, p_limit: LIMIT });
    if (!error && !q?.ok) return new Response('daily:' + LIMIT, { status: 429, headers: { ...cors, 'X-Spectra-Left': '0' } });
    const fb = fileBlock(body.files);
    const txt = await ask(key, ASK, (fb ? 'PROJECT FILES:\n' + fb + '\n\n' : '') + 'QUESTION:\n' + prompt, 'low', 3000, body.model);
    if (!txt) { if (!error) await admin.rpc('spectra_refund', { p_user: user.id, p_cost: 1 }); return new Response('upstream', { status: 502, headers: cors }); }
    return json({ reply: clean(txt.trim(), 6000), spectres: [] }, error ? {} : { 'X-Spectra-Left': String(Math.max(LIMIT - q.used, 0)) });
  }

  if (body.mode === 'plan') {
    const LIMIT = parseInt(Deno.env.get('SPECTRA_DAILY_LIMIT') ?? '30') || 30, cost = COST[effort];
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: q, error } = await admin.rpc('spectra_use', { p_user: user.id, p_cost: cost, p_limit: LIMIT });
    if (!error && !q?.ok) return new Response('daily:' + LIMIT, { status: 429, headers: { ...cors, 'X-Spectra-Left': '0' } });
    const left = error ? '' : String(Math.max(LIMIT - q.used, 0));
    const prev = fileBlock(body.files);
    const txt = await ask(key, PLAN, (prev ? 'EXISTING PROJECT FILES (the Spectres may change them; keep what still works):\n' + prev + '\n\n' : '') + 'REQUEST:\n' + prompt, effort, 1500, body.model);
    const plan = txt ? parse(txt) : null;
    const sp = Array.isArray(plan?.spectres) ? plan.spectres.slice(0, 6).map((s: any, i: number) => ({
      id: 's' + (i + 1), role: ['Builder', 'Designer', 'Analyst', 'Tester'].includes(s?.role) ? s.role : 'Builder',
      title: clean(s?.title, 80) || 'Build task', files: (Array.isArray(s?.files) ? s.files : []).map(safePath).filter(Boolean).slice(0, 4),
    })).filter((s: any) => s.files.length) : [];
    if (!sp.length) {
      const reply = clean(plan?.reply, 600) || (txt && !plan ? clean(txt.trim(), 600) : '');
      if (!error && cost > 1) await admin.rpc('spectra_refund', { p_user: user.id, p_cost: cost - 1 }); // a chat reply costs 1 credit
      if (reply) return json({ reply, spectres: [] }, left ? { 'X-Spectra-Left': String(Math.max(LIMIT - q.used + cost - 1, 0)) } : {});
      if (!error) await admin.rpc('spectra_refund', { p_user: user.id, p_cost: 1 });
      return new Response(txt ? 'plan' : 'upstream', { status: 502, headers: cors });
    }
    return json({ note: clean(plan.note, 240), summary: clean(plan.summary, 400), contract: clean(plan.contract, 1200), spectres: sp }, left ? { 'X-Spectra-Left': left } : {});
  }

  if (body.mode === 'spectre') {
    const t = body.task ?? {};
    const files = (Array.isArray(t.files) ? t.files : []).map(safePath).filter(Boolean).slice(0, 4);
    if (!files.length) return new Response('bad', { status: 400, headers: cors });
    const user_ = `FULL REQUEST:\n${prompt}\n\nSUMMARY: ${clean(body.summary, 400)}\nSHARED CONTRACT: ${clean(body.contract, 1200)}\n\nYOUR ROLE: ${clean(t.role, 20)}\nYOUR TASK: ${clean(t.title, 80)}\nWRITE ONLY THESE FILES: ${files.join(', ')}\n\nEXISTING PROJECT FILES:\n${fileBlock(body.files)}`;
    const txt = await ask(key, SPECTRE, user_, effort, 16000, body.model);
    const out = txt ? parse(txt) : null;
    const fl = (Array.isArray(out?.files) ? out.files : []).map((f: any) => ({ path: safePath(f?.path), content: clean(f?.content, 60000) })).filter((f: any) => f.path && f.content);
    if (!fl.length) return new Response('spectre', { status: 502, headers: cors });
    return json({ files: fl, note: clean(out.note, 160) });
  }
  return new Response('bad', { status: 400, headers: cors });
});
