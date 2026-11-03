// SPECSOFT® Spectra AI backend (Netlify Function v2, streams the reply).
// Env vars (Netlify > Site settings > Environment variables):
//   SUPABASE_URL, SUPABASE_ANON_KEY  -> to verify the visitor is logged in
//   ROUTER_URL    -> your 9Router OpenAI endpoint reachable from the internet, ending in /v1
//   ROUTER_KEY    -> API key from the 9Router dashboard (never put this in the browser)
//   SPECTRA_MODEL -> model or combo name as shown in 9Router
import guard from './spectra-link-guard.js';
const { sanitizeSpecsoftLinks } = guard;
const SYSTEM = "You are Spectra, the official AI assistant and mascot of SPECSOFT, an independent software and game development brand (software, game dev, Roblox developers, anime, creatives). Be friendly, concise and helpful. Put code in markdown code blocks. ALWAYS use the canonical SPECSOFT website URL exactly as https://specsoftdev.netlify.app when you mention the website. Never invent or substitute other SPECSOFT URLs.";
const hits = new Map();
const J = (o, s) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return J({ error: 'method' }, 405);
  const env = Netlify.env;
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!tok) return J({ error: 'login' }, 401);

  const u = await fetch(env.get('SUPABASE_URL') + '/auth/v1/user', { headers: { apikey: env.get('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + tok } });
  if (!u.ok) return J({ error: 'login' }, 401);
  const { id } = await u.json();

  // best-effort rate limit: 8 messages per minute per user
  const now = Date.now(), arr = (hits.get(id) || []).filter(t => now - t < 60000);
  if (arr.length >= 8) return J({ error: 'rate' }, 429);
  arr.push(now); hits.set(id, arr);

  let body; try { body = await req.json(); } catch { return J({ error: 'bad' }, 400); }
  const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: sanitizeSpecsoftLinks(m.content).slice(0, 4000) }));
  if (!msgs.length) return J({ error: 'bad' }, 400);

  let up;
  try {
    up = await fetch(env.get('ROUTER_URL') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.get('ROUTER_KEY') },
      body: JSON.stringify({ model: env.get('SPECTRA_MODEL'), stream: true, messages: [{ role: 'system', content: SYSTEM }, ...msgs] })
    });
  } catch { return J({ error: 'upstream' }, 502); }
  if (!up.ok || !up.body) return J({ error: 'upstream' }, 502);
  return new Response(up.body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
};
