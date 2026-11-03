// SPECSOFT® Spectra AI backend (Supabase Edge Function).
// Deploy: supabase functions deploy spectra-chat --no-verify-jwt   (login is checked below)
// Simplest: supabase secrets set DEEPSEEK_API_KEY=...   (talks to DeepSeek directly, no 9Router/tunnel needed)
// Optional overrides: ROUTER_URL, ROUTER_KEY (e.g. your 9Router), SPECTRA_MODEL
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const MOODS = 'joy, thinking, sparkle, love, annoyed, sad, surprised, confused, shy, deadpan, smug, pout, shocked, sleepy, grumpy, speechless';
const SYSTEM = `You are Spectra, the official AI assistant and mascot of SPECSOFT, an independent software and game development brand. Be friendly, concise and helpful; put code in markdown code blocks. Start EVERY reply with one hidden mood tag, exactly like [mood:joy], chosen from: ${MOODS}.`;
const PERSONAS: Record<string, string> = {
  dev: 'Focus on clean, correct code with brief explanations. Ask for the error message or code if it is missing.',
  lua: 'You are an expert Roblox Luau scripter. Prefer modern Luau and say where each script belongs (ServerScriptService, StarterPlayerScripts, etc).',
  creative: 'Be imaginative and playful for ideas, stories and game design. Offer several options.',
  chill: 'Talk casually like a laid-back friend with light humor, but stay accurate.',
};
const hits = new Map<string, number[]>();
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('login', { status: 401, headers: cors });
  // best-effort rate limit: 8 messages per minute per user
  const now = Date.now(), arr = (hits.get(user.id) ?? []).filter((t) => now - t < 60000);
  if (arr.length >= 8) return new Response('rate', { status: 429, headers: cors });
  arr.push(now); hits.set(user.id, arr);
  const body = await req.json().catch(() => ({}));
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length) return new Response('bad', { status: 400, headers: cors });
  const model = Deno.env.get('SPECTRA_MODEL') ?? 'deepseek-chat';
  const up = await fetch((Deno.env.get('ROUTER_URL') ?? 'https://api.deepseek.com') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (Deno.env.get('ROUTER_KEY') ?? Deno.env.get('DEEPSEEK_API_KEY')) },
    body: JSON.stringify({ model, stream: true, ...(body.think ? { thinking: { type: 'enabled' } } : {}), messages: [{ role: 'system', content: SYSTEM + ' ' + (PERSONAS[body.persona] ?? '') + (body.think ? ' Think through the problem step by step, double-check your work, then give a clear final answer.' : '') }, ...messages] }),
  });

  const upText = up.ok ? null : await up.text().catch(() => '');
  if (!up.ok || !up.body) {
    console.log('SPECTRA upstream failed', {
      status: up.status,
      statusText: up.statusText,
      model,
      keyPresent: !!(Deno.env.get('ROUTER_KEY') ?? Deno.env.get('DEEPSEEK_API_KEY')),
      response: upText ? upText.slice(0, 2000) : null,
    });
    return new Response(upText ? `upstream ${up.status}: ${upText}` : 'upstream', { status: 502, headers: cors });
  }
  return new Response(up.body, { headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
});
