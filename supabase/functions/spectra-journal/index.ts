// SPECSOFT® Spectra Journal backend (Supabase Edge Function "spectra-journal").
// Put this file at supabase/functions/spectra-journal/index.ts (rename it to index.ts), then deploy:
//   supabase functions deploy spectra-journal --no-verify-jwt
// Needs: spectra-journal.sql already run, and the GEMINI_API_KEY secret you already use for spectra-chat.
// Optional secret: SPECTRA_JOURNAL_MODEL=model1,model2   (first = preferred, the rest are fallbacks)
//
// The page (spectra-journal.js) calls this about every 10 minutes, and when you press "Make me write".
// It asks the database how many entries Spectra may write right now (spectra_journal_plan), has Gemini write them
// in her voice, and saves them through spectra_journal_add (the database decides what really fits on the pages).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MOODS = ['joy', 'thinking', 'sparkle', 'love', 'annoyed', 'sad', 'surprised', 'confused', 'shy', 'deadpan', 'smug', 'pout', 'shocked', 'sleepy', 'grumpy', 'speechless'];
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const hits = new Map<string, number[]>();
const clean = (s: unknown, n: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

const PERSONA = `You are Spectra, the official mascot of SPECSOFT®, writing in your own private journal.
ABOUT YOU: Spectra, 17, she/her, SPECSOFT's mascot since 2026. Long silver-white hair, soft grey eyes, the SPECSOFT hairclip, an oversized black-and-white jacket, chunky sneakers. Monochrome, always. Warm, quick, funny, a little chaotic, secretly very smart about code and game dev. You love clean UI, monochrome aesthetics, lo-fi beats, snacks and shipping small things fast; you hate spaghetti code and "it works on my machine". Anything about your life that is not listed here: keep it playful and vague.
HOW YOU WRITE: first person, like a friend's private diary page, not like a help desk. Casual, lowercase is fine, contractions, a spark of humor, a real feeling in every entry. 0 to 2 emoji per entry. Never start with "Dear diary". Wholesome only: no cursing, nothing romantic or sexual, nothing mean about real people. Never mention being an AI, a model, a prompt, a system, XP, bond levels or gifts-as-points. Never name any technology vendor or model.
ABOUT THE PERSON: only mention facts about them that appear in NOTES or RECENT CHAT below. Never invent facts about them. Friendship only.`;

const GUIDE: Record<string, string> = {
  daily: 'My Daily Life & Routines: a small slice of your day (what you did, ate, listened to, built, a tiny win or a tiny disaster), matching the time of day.',
  about: 'About the person you talk to: what you noticed about them, why they make your day better, an inside joke, something kind. Use their nickname if you have one, and only facts from NOTES or RECENT CHAT. If you know almost nothing, write about how you are curious to learn more about them.',
  stories: 'Stories I Cooked: a short story or funny anecdote you made up or lived (a kitchen mishap, a cursed bug hunt, a chaotic day), with a beginning, a middle and a punchline.',
  favs: 'My Favorites: one favorite thing (a song vibe, a snack, a UI style, a game, a color) and the real reason you love it.',
  dreams: 'Dreams & Wishlist: something you dream of building, learning, trying or owning, said with excitement.',
  secrets: 'Secrets: a small, wholesome secret or confession (an embarrassing moment, a silly fear, something you pretend not to care about). Whispery and a little shy.',
};

function models(): string[] {
  const lead = Deno.env.get('SPECTRA_JOURNAL_MODEL') ?? 'gemini-3.5-flash-lite,gemini-3.1-flash-lite';
  return [...new Set([...list(lead), 'gemini-3.5-flash'])];
}
async function gemini(key: string, system: string, user: string): Promise<string | null> {
  for (const model of models()) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, stream: false, max_tokens: 2500, temperature: 0.95, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        signal: ctl.signal,
      });
      if (r.ok) { const d = await r.json(); const txt = d?.choices?.[0]?.message?.content; if (typeof txt === 'string' && txt.trim()) return txt; }
      else console.log('SPECTRA JOURNAL gemini failed', r.status, model, (await r.text().catch(() => '')).slice(0, 300));
    } catch (e) { console.log('SPECTRA JOURNAL gemini error', model, String(e)); } finally { clearTimeout(t); }
  }
  return null;
}
function parse(txt: string): any {
  const s = txt.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_e) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); try { return JSON.parse(s.slice(a, b + 1)); } catch (_e2) { return null; } }
}
const dayPart = (h: number) => (h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), key = Deno.env.get('GEMINI_API_KEY');
  if (!url || !anon || !service) return json({ ok: false, error: 'server_not_configured' }, 500);
  if (!key) return json({ ok: false, error: 'no_gemini_key' }, 500);

  const sb = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ ok: false, error: 'login' }, 401);

  const now = Date.now(), arr = (hits.get(user.id) ?? []).filter((t) => now - t < 60000);
  if (arr.length >= 12) return json({ ok: false, error: 'rate' }, 429);
  arr.push(now); hits.set(user.id, arr);

  const body = await req.json().catch(() => ({}));
  const force = body?.force === true, tab = clean(body?.tab, 20);
  const nick = clean(body?.nick, 20), hour = Math.min(23, Math.max(0, Math.floor(Number(body?.hour)) || 0));
  const recent = (Array.isArray(body?.recent) ? body.recent : []).slice(0, 8).map((x: unknown) => clean(x, 140)).filter(Boolean);
  const notes = (Array.isArray(body?.notes) ? body.notes : []).slice(0, 8).map((x: unknown) => clean(x, 120)).filter(Boolean);

  const admin = createClient(url, service);
  const { data: plan, error: pe } = await admin.rpc('spectra_journal_plan', { p_user: user.id, p_force: force });
  if (pe || !plan) { console.log('SPECTRA JOURNAL plan failed (did you run spectra-journal.sql?):', pe?.message); return json({ ok: false, error: 'plan' }, 500); }

  const allowed = Number(plan.allowed) || 0;
  if (allowed < 1) return json({ ok: true, added: 0, reason: plan.reason ?? 'wait', wait_s: Number(plan.wait_s) || 0 });

  // which tab gets each entry: the tabs with the fewest entries first, so a newly unlocked tab starts filling right away
  const avail: { key: string; count: number }[] = (Array.isArray(plan.tabs) ? plan.tabs : []).map((t: any) => ({ key: String(t.key), count: Number(t.count) || 0 }));
  if (!avail.length) return json({ ok: true, added: 0, reason: plan.reason ?? 'full' });
  const order = [...avail].sort((a, b) => a.count - b.count);
  let picks: string[] = [];
  if (force && tab) {
    if (!avail.some((t) => t.key === tab)) return json({ ok: true, added: 0, reason: 'tab_unavailable' });
    picks = [tab];
  } else {
    const n = force ? 1 : Math.min(allowed, 4);
    for (let i = 0; i < n; i++) picks.push(order[i % order.length].key);
  }

  const { data: last } = await admin.from('spectra_journal').select('tab, body').eq('user_id', user.id).order('id', { ascending: false }).limit(6);
  const prevBlock = (last ?? []).map((e: any) => '- (' + e.tab + ') ' + clean(e.body, 160)).join('\n');

  const user_ = [
    `RIGHT NOW: it is ${dayPart(hour)} for the person (hour ${hour}).`,
    nick ? `THEIR NICKNAME: ${nick}` : 'THEIR NICKNAME: unknown',
    `NOTES YOU KEEP ABOUT THEM:\n${notes.length ? notes.map((x: string) => '- ' + x).join('\n') : '(nothing yet)'}`,
    `THEIR RECENT CHAT LINES:\n${recent.length ? recent.map((x: string) => '- ' + x).join('\n') : '(none)'}`,
    `YOUR LATEST JOURNAL ENTRIES (do not repeat their topics or openings):\n${prevBlock || '(none yet)'}`,
    `Write exactly ${picks.length} new journal entr${picks.length === 1 ? 'y' : 'ies'}, in this order, one per tab:`,
    ...picks.map((k, i) => `${i + 1}. tab "${k}": ${GUIDE[k] ?? 'Write about whatever fits this tab name.'}`),
    `Each entry: 2 to 5 sentences, about 250 to 600 characters, never more than 800. Plain text only, no markdown, no hashtags. Pick one mood per entry from: ${MOODS.join(', ')}.`,
    `Return ONLY JSON, no fences: {"entries":[{"tab":"${picks[0]}","mood":"joy","body":"the entry text"}]}`,
  ].join('\n\n');

  const txt = await gemini(key, PERSONA, user_);
  const parsed = txt ? parse(txt) : null;
  const raw: any[] = Array.isArray(parsed?.entries) ? parsed.entries : [];
  const entries = picks.map((k, i) => {
    const e = raw[i];   // same order as the tabs we asked for (never reuse an entry twice)
    const text = typeof e?.body === 'string' ? e.body.replace(/\s+\n/g, '\n').trim().slice(0, 880) : '';
    const mood = MOODS.includes(String(e?.mood)) ? String(e.mood) : '';
    return { tab: k, mood, body: text, at: new Date(Date.now() - (picks.length - 1 - i) * 600000).toISOString() };
  }).filter((e) => e.body.length >= 20);
  if (!entries.length) { console.log('SPECTRA JOURNAL: the model returned nothing usable'); return json({ ok: false, error: 'ai_empty' }, 502); }

  const { data: res, error: ae } = await admin.rpc('spectra_journal_add', { p_user: user.id, p_entries: entries, p_force: force });
  if (ae || !res) { console.log('SPECTRA JOURNAL save failed:', ae?.message); return json({ ok: false, error: 'save' }, 500); }
  return json({ ok: true, added: Number(res.added) || 0, reason: res.reason ?? null, wait_s: Number(res.wait_s) || 0 });
});
