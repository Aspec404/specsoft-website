// SPECSOFT® Spectra VOICE backend (Supabase Edge Function): Gemini text-to-speech, so she sounds bubbly and expressive.
// Sits next to spectra-chat and follows the same rules: must be logged in, per-user burst limit, shares the DAILY credit pool.
//
// Setup:
//   1) Save this file as supabase/functions/spectra-voice/index.ts
//   2) supabase functions deploy spectra-voice --no-verify-jwt        (GEMINI_API_KEY is already set for spectra-chat)
// Optional secrets:
//   SPECTRA_VOICE=off            kill switch (the page falls back to the free browser voice)
//   SPECTRA_VOICE_COST=1         credits per spoken reply (0 = free, max 5)
//   SPECTRA_VOICE_NAME=Leda      default Gemini voice
//   SPECTRA_VOICE_MAX=800        max characters spoken per request
//   SPECTRA_TRIM=off             turn off the end-of-clip cleanup that removes the buzz/static Gemini sometimes adds after her last word
//   (old secret SPECTRA_SPECTRE_MODELS is now IGNORED on purpose: EVERY Gemini model, 3.8, 3.8 Lite and 3.1, speaks as Spectra. The Spectre only appears when the page falls back to the free browser voice.)
//   SPECTRA_SPECTRE_ON_MODELS=   optional and EMPTY by default. Only if you ever want a Spectre voice on a Gemini model again: e.g. 3.1 = models whose name contains that word are spoken by her SPECTRE (robotic voice, header X-Spectra-Voice: spectre).
//   SPECTRE_VOICE_NAME=Puck      Gemini voice the Spectre uses (Puck, Charon, Fenrir, Orus, Umbriel, Iapetus, Algenib, Achird, Zephyr, Kore)
//   SPECTRA_TTS_MODEL=model1,model2   first = preferred, rest = fallbacks (default order: gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts, then Gemini 3.1 Flash TTS as the emergency backup; the two 3.1 names are because I'm not sure which one your account uses, a wrong one is just skipped)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Expose-Headers': 'X-Spectra-Left, X-Spectra-Limit, X-Spectra-Model, X-Spectra-Voice',
};
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

// girly, young-sounding Gemini voices only (the page's picker uses the same list)
const VOICES = new Set(['Leda', 'Zephyr', 'Aoede', 'Autonoe', 'Laomedeia', 'Kore']);
// the Spectre (her sphere drone) gets its own, deliberately un-Spectra voice
const SPECTRE_VOICES = new Set(['Puck', 'Charon', 'Fenrir', 'Orus', 'Umbriel', 'Iapetus', 'Algenib', 'Achird', 'Zephyr', 'Kore']);

// her hidden [mood:...] tag becomes a delivery note for the voice
const MOOD_STYLE: Record<string, string> = {
  joy: 'bubbly, cheerful and upbeat, smiling while she talks',
  sparkle: 'sparkly, super excited and a little giggly',
  love: 'warm, soft and sweet',
  annoyed: 'a bit annoyed and sarcastic, but still playful',
  sad: 'soft and a little sad',
  surprised: 'surprised, animated and wide-eyed',
  confused: 'confused and curious',
  shy: 'shy, quiet and a little flustered',
  deadpan: 'dry and deadpan, but still playful',
  smug: 'smug, teasing and playful',
  pout: 'pouty and dramatic',
  shocked: 'shocked and dramatic',
  sleepy: 'sleepy, slow and yawning softly',
  grumpy: 'grumpy but cute',
  speechless: 'stunned and almost speechless',
  thinking: 'thoughtful and curious',
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
// which models count as "the Spectre's models" (default: NONE, so 3.8, 3.8 Lite and the 3.1 backup all speak as Spectra; a leftover SPECTRA_SPECTRE_MODELS secret on Supabase can no longer turn 3.1 into the Spectre)
const SPECTRE_KEYS = (Deno.env.get('SPECTRA_SPECTRE_ON_MODELS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s && s !== 'off');
const isSpectreModel = (m: string) => SPECTRE_KEYS.some((k) => m.toLowerCase().includes(k));
const hits = new Map<string, number[]>();   // best-effort burst limiter: 10 voice clips per minute per user

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// Gemini returns raw 16-bit mono PCM; browsers need a WAV header to play it
function toWav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length), v = new DataView(out.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, pcm.length, true); out.set(pcm, 44);
  return out;
}
// Gemini TTS sometimes adds a buzzy / static tail after the last word. Walk back from the end, keep only up to the last stretch of real
// voiced speech (plus a short soft ending), fade it out and add a tiny bit of true silence so the clip never ends on a pop.
function trimTail(pcm: Uint8Array, rate: number): { pcm: Uint8Array; cut: number } {
  const n = pcm.length >> 1, v = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  const F = Math.round(rate * 0.02), nf = Math.floor(n / F);
  if (nf < 25) return { pcm: pcm.subarray(0, n * 2), cut: 0 };
  const rms = new Float32Array(nf), zcr = new Float32Array(nf);
  for (let f = 0; f < nf; f++) {
    let s = 0, z = 0, prev = 0;
    for (let i = 0; i < F; i++) { const x = v.getInt16((f * F + i) * 2, true); s += x * x; if (i && (x >= 0) !== (prev >= 0)) z++; prev = x; }
    rms[f] = Math.sqrt(s / F); zcr[f] = z / F;
  }
  const ref = Array.from(rms).sort((a, b) => a - b)[Math.floor(nf * 0.9)], thr = Math.max(ref * 0.15, 120);
  const voiced = (f: number) => rms[f] > thr && zcr[f] > 0.015 && zcr[f] < 0.22;   // speech vowels: loud enough, not hiss-like, not a low hum
  let last = -1;
  for (let f = nf - 1; f >= 3; f--) { if (voiced(f) && voiced(f - 1) && voiced(f - 2) && voiced(f - 3)) { last = f; break; } }
  if (last < 0) return { pcm: pcm.subarray(0, n * 2), cut: 0 };   // nothing speech-like found: leave the clip alone
  let keep = Math.min(n, (last + 1 + 11) * F);   // +220 ms so soft endings and breaths survive
  const cut = n - keep;
  if (cut < rate * 0.15 || keep < rate * 0.4) return { pcm: pcm.subarray(0, n * 2), cut: 0 };
  const pad = Math.round(rate * 0.12), fade = Math.min(keep, Math.round(rate * 0.06));
  const out = new Uint8Array((keep + pad) * 2), o = new DataView(out.buffer);
  out.set(pcm.subarray(0, keep * 2), 0);
  for (let i = 0; i < fade; i++) { const idx = keep - fade + i; o.setInt16(idx * 2, Math.round(v.getInt16(idx * 2, true) * (1 - (i + 1) / fade)), true); }
  return { pcm: out, cut };
}
const reply = (msg: string, status: number, extra: Record<string, string> = {}) => new Response(msg, { status, headers: { ...cors, ...extra } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply('bad', 405);
  if ((Deno.env.get('SPECTRA_VOICE') ?? 'on').toLowerCase() === 'off') return reply('off', 503);

  // 1) must be logged in
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return reply('login', 401);

  // 2) clean the request (the text comes from the browser, so it is treated as untrusted)
  const body = await req.json().catch(() => ({}));
  const MAX = Math.min(Math.max(parseInt(Deno.env.get('SPECTRA_VOICE_MAX') ?? '800') || 800, 100), 1500);
  const text = String(body.text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/^\s*#+/gm, '').replace(/[ \t]+/g, ' ').trim().slice(0, MAX);
  if (!/[\p{L}\p{N}]/u.test(text)) return reply('bad', 400);
  const mood = typeof body.mood === 'string' && has(MOOD_STYLE, body.mood.toLowerCase()) ? body.mood.toLowerCase() : 'joy';
  const wanted = String(body.voice ?? '');
  const fallbackVoice = Deno.env.get('SPECTRA_VOICE_NAME') ?? 'Leda';
  const voice = VOICES.has(wanted) ? wanted : (VOICES.has(fallbackVoice) ? fallbackVoice : 'Leda');
  // speaker: '' = old behaviour (chat read-aloud, every model speaks as Spectra) | 'auto' = lesson player that can show the Spectre | 'spectre' = lesson already switched to the Spectre, only use its models
  const speakerMode = body.speaker === 'spectre' ? 'spectre' : body.speaker === 'auto' ? 'auto' : '';
  const spectreWanted = Deno.env.get('SPECTRE_VOICE_NAME') ?? 'Puck';
  const spectreVoice = SPECTRE_VOICES.has(spectreWanted) ? spectreWanted : 'Puck';

  // the lesson already switched to the Spectre (browser voice) and no Gemini model is a Spectre model: nothing to generate, fail fast with no credits and no rate-limit hit
  if (speakerMode === 'spectre' && !SPECTRE_KEYS.length) return reply('tts', 502);

  // 3) anti-spam burst limit
  const now = Date.now(), arr = (hits.get(user.id) ?? []).filter((t) => now - t < 60000);
  if (arr.length >= 10) return reply('rate', 429);
  arr.push(now); hits.set(user.id, arr);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) { console.log('SPECTRA VOICE: GEMINI_API_KEY secret is missing'); return reply('no key', 500); }

  // 4) shared per-user DAILY credits (same counter as spectra-chat)
  const COST = Math.min(Math.max(Math.floor(Number(Deno.env.get('SPECTRA_VOICE_COST') ?? 1)), 0), 5) || 0;
  const LIMIT = parseInt(Deno.env.get('SPECTRA_DAILY_LIMIT') ?? '30') || 30;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let counted = false, left: number | null = null;
  if (COST > 0) {
    const { data: q, error: qe } = await admin.rpc('spectra_use', { p_user: user.id, p_cost: COST, p_limit: LIMIT }) as any;
    if (qe) console.log('SPECTRA VOICE usage rpc failed (limit NOT enforced):', qe.message);
    else if (!q?.ok) return reply('daily:' + LIMIT, 429, { 'X-Spectra-Left': '0', 'X-Spectra-Limit': String(LIMIT) });
    else { counted = true; left = Math.max(LIMIT - q.used, 0); }
  }

  // 5) ask Gemini to speak it, with director's notes so she acts the line instead of reading it
  const spoken = /[.!?\u2026~)"'\u201d]$/.test(text) ? text : text + '.';   // a missing full stop makes Gemini TTS ramble or glitch at the end
  const spectraPrompt =
    '# AUDIO PROFILE: Spectra\n## A playful, bubbly Gen Z girl chatting with her best friend.\n\n' +
    "### DIRECTOR'S NOTES\n" +
    'Style: ' + MOOD_STYLE[mood] + '. Very expressive, with big pitch swings, lively pacing, natural pauses and little giggles or gasps where they fit. Never flat, never like a narrator or an assistant.\n' +
    'Accent: neutral American.\nEnding: stop right after the last word of the transcript. No extra breaths, hum, noise, beeps or sound effects after it.\n\n#### TRANSCRIPT\n' + spoken;
  // the Spectre: a tiny hovering drone, synthetic and a little staccato, friendly but clearly not Spectra
  const spectrePrompt =
    '# AUDIO PROFILE: Spectre\n## A tiny hovering robot drone, Spectra\'s little helper, reading the lesson for her.\n\n' +
    "### DIRECTOR'S NOTES\n" +
    'Style: synthetic and slightly robotic, neat and precise, a little staccato with short even pauses between phrases and small pitch steps. Friendly, curious and cute, like a small AI drone, never flat-out cold. Subtle mood, kept understated: ' + MOOD_STYLE[mood] + '.\n' +
    'Accent: neutral American.\nEnding: stop right after the last word of the transcript. No extra breaths, hum, noise, beeps or sound effects after it.\n\n#### TRANSCRIPT\n' + spoken;
  const models = (Deno.env.get('SPECTRA_TTS_MODEL') ?? 'gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-3.1-flash-tts-preview,gemini-3.1-flash-tts').split(',').map((s) => s.trim()).filter(Boolean);
  const modelList = speakerMode === 'spectre' ? models.filter(isSpectreModel) : models;   // the lesson is already on the Spectre: skip Spectra's models
  if (!modelList.length) { if (counted) await admin.rpc('spectra_refund', { p_user: user.id, p_cost: COST }); return reply('tts', 502); }
  const tidy = (Deno.env.get('SPECTRA_TRIM') ?? 'on').toLowerCase() !== 'off';
  let audio: Uint8Array | null = null, usedModel = '', who = 'spectra';
  for (const model of modelList) {
    const asSpectre = speakerMode !== '' && isSpectreModel(model);   // only lesson requests can show a Spectre, chat read-aloud keeps Spectra's voice
    try {
      const up = await fetch(API + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: asSpectre ? spectrePrompt : spectraPrompt }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: asSpectre ? spectreVoice : voice } } } },
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!up.ok) { console.log('SPECTRA VOICE', model, up.status, (await up.text()).slice(0, 300)); continue; }
      const j = await up.json();
      const part = (j?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p?.inlineData?.data);
      if (!part) { console.log('SPECTRA VOICE', model, 'returned no audio'); continue; }
      const rate = parseInt(/rate=(\d+)/.exec(String(part.inlineData.mimeType ?? ''))?.[1] ?? '24000') || 24000;
      const raw = fromBase64(part.inlineData.data), t = tidy ? trimTail(raw, rate) : { pcm: raw, cut: 0 };
      if (t.cut) console.log('SPECTRA VOICE', model, 'trimmed', Math.round(t.cut / rate * 1000), 'ms of tail from a', Math.round(raw.length / 2 / rate * 1000), 'ms clip');
      audio = toWav(t.pcm, rate); usedModel = model; who = asSpectre ? 'spectre' : 'spectra';
      break;
    } catch (e) { console.log('SPECTRA VOICE', model, 'failed:', String(e)); }
  }

  if (!audio) {
    if (counted) await admin.rpc('spectra_refund', { p_user: user.id, p_cost: COST });   // no audio, so no charge
    return reply('tts', 502);
  }
  const h: Record<string, string> = { ...cors, 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Spectra-Model': usedModel, 'X-Spectra-Voice': who };   // the page logs this in the browser console so you can see which model really spoke
  if (left !== null) { h['X-Spectra-Left'] = String(left); h['X-Spectra-Limit'] = String(LIMIT); }
  return new Response(audio, { headers: h });
});
