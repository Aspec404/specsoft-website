# AGENTS.md

Guidance for coding agents working in this repository.

## What this is

The SPECSOFT® website: a **stateless, multi-page vanilla site** (HTML + CSS + JS, no bundler/framework)
backed by **Supabase** (auth, Postgres, RLS) and hosted on **Netlify**. It also contains **SPECSOFT Studio**
(a browser node-graph app that lives in the same repo/page set), the **Spectra AI** assistant, and a small
standalone **Discord bot**.

## Run and test

```powershell
npm install                 # root deps: express, supabase-js, dotenv, nsfwjs/tfjs
node server.js              # static server on http://localhost:3000 (PORT env overrides)
node studio-size-limits.test.js   # only test in the repo
```

`studio-size-limits.test.js` is a static source-regex check that the Studio size caps are 5 MB. Update its
patterns in the same change whenever a limit changes (it currently fails against the uncommitted 500 KB project cap
in `studio.js`).

- There is no build step, no bundler, no lint config, and no npm scripts. Pages are served as-is from the repo root.
- Serve over HTTP rather than opening `file://` — Supabase auth redirects, email links, and fetches expect an origin.
- `.env` is for the Discord bot/back-end only; website code uses `supabase-config.js`. Never commit it.
- Deploy: Netlify builds from `main` (static root). `spectra-chat.mjs` is a Netlify Function v2; `index.ts` is the
  equivalent Supabase Edge Function. `sync.bat` commits, regenerates `version.json`, and pushes.

## Layout

### Pages (repo root)

| Page | Purpose |
| --- | --- |
| `index.html` | Marketing homepage (hero, about, stats, timeline, FAQ) |
| `intro.html` | Intro animation, shown once per session via `gate.js` |
| `login.html` | Log in / sign up (`auth.js`) |
| `1-confirm-signup.html`, `2-reset-password.html`, `3-change-email.html`, `verified.html` | Auth email landing pages |
| `hub.html` | Post-login dashboard/hub |
| `community.html`, `chats.html` | Community feed and realtime chat |
| `projects.html` | Projects hub (feed, likes, saves) |
| `profile.html`, `settings.html` | Profile and site/account settings |
| `store.html`, `store-manager.html` | APEX Credits store and store admin |
| `studio.html` | SPECSOFT Studio IDE (PC only) |
| `studio-view.html`, `studio-preview-host.html` | Published-project viewer / sandboxed preview host |
| `spectra-ai.html` | Spectra AI chat UI |
| `admin.html` | Staff/admin console |
| `credits.html`, `privacy.html`, `terms.html`, `rules.html`, `404.html` | Static info pages |

### JavaScript

- `main.js` — global boot: applies settings, injects sidebar/mobile nav/theme, then shared page modules
  (projects hub, community counters, credits carousel). Loaded on nearly every page, last in `<body>`.
- `supabase-config.js` — exposes `window.SPECSOFT_CONFIG` and **`window.getSupabaseClient()`** (singleton).
- `roles.js`, `ban.js`, `gate.js`, `studio-guard.js` — auth/role display, ban screen, intro gate, Studio device gate.
- Feature modules: `auth.js`, `chats.js`, `profile.js`, `projects.js`, `store.js`, `settings.js`,
  `notifications.js`, `seasons.js`, `apex-credits.js`, `avatar-frames.js`, `admin.js`, `spectra-ai.js`, etc.
- Studio modules load in dependency order in `studio.html`:
  `studio-graph.js` → `studio-sql.js` → `studio-data.js` → `studio-timeline.js` → `studio-engine.js` →
  `studio-preview.js` → `studio-shell.js` → `studio-stools.js` → `studio-menu.js` → `studio-explorer.js` →
  `studio-publish.js` → `studio.js`.
- Backend functions: `spectra-chat.mjs` (Netlify) and `index.ts` (Supabase Edge). See their header comments for env vars.

### CSS

Global tokens/base live in `style.css`; shared chrome in `site-*.css`, `cursor.css`, `auth.css`, `chats.css`, etc.
Feature/page styles each have their own stylesheet linked from that page's `<head>` (`studio.css`, `store.css`,
`projects.css`, `profile.css`, `spectra-ai.css`, …). Settings turn features on/off through `ss-*` classes and
`data-accent` on `<html>`.

### Database

Every feature has a matching `supabase-*.sql` migration at the root (28 files). They are **run manually in the
Supabase SQL editor**, are written to be idempotent (`create table if not exists`, `drop policy if exists`), and
enable RLS. Install `supabase-profiles.sql` first; later phases build on it (`supabase-studio-phase7*.sql`, etc.).

## Conventions

1. **All frontend code is classic scripts, not ES modules.** Use `(function () { 'use strict'; ... })();`.
   Match the file you are editing: most site/Studio modules use `var`, `function`, and 4-space indentation.
   Only `spectra-chat.mjs` and `index.ts` are modern modules (2-space indent).
2. **Page modules self-guard.** Start by checking for their root element (e.g. `if (!document.getElementById('x')) return;`)
   so `main.js` can be shared across all pages. Studio modules also start with
   `if (window.__STUDIO_BLOCKED) return;`.
3. **Load order matters.** Supabase CDN (pinned `@supabase/supabase-js@2.117.3`) → `supabase-config.js` →
   `roles.js`/`ban.js` → `main.js` → feature modules → non-critical `defer` scripts (`cursor.js`).
   `gate.js` and `studio-guard.js` are **not** deferred and must stay in `<head>` before paint.
4. **Supabase access** goes through `window.getSupabaseClient()`. Only the anon/publishable key belongs in the
   browser; **never** add a `service_role` key. All authorization must be enforced in SQL/RLS, not just in JS.
5. **New DB feature ⇒ new `supabase-<feature>.sql`**, idempotent and RLS-enabled, plus a note in the module header
   that it must be run once.
6. **Studio internals communicate through globals:** `window.StudioGraph` owns nodes/wires plus an extension
   registry (`StudioGraph.ext`); `StudioSQL`, `StudioData`, `StudioShell`, `StudioEngine`, etc. register themselves.
   Respect the hard limits defined at the top of each module (nodes, project size, SQL rows, run time, outputs).
7. **Untrusted code sandbox:** Studio script nodes run in a Web Worker inside a sandboxed iframe with a
   network-blocking CSP. Do not weaken that boundary or pass the page/Supabase session into it.
8. **State keys** are namespaced and versioned: `specsoft.settings.v1`, `specsoft-theme`, `specsoft-intro-seen`.
   Keep backward compatibility when adding settings.
9. **Dependencies stay minimal and CDN-pinned.** No frameworks, no build tooling. Do not introduce a bundler for a
   single change.
10. Some files contain literal `\uFFFD` characters where `®` used to be (encoding damage). Don't mass-rewrite
    encoding; match the surrounding text when editing nearby comments.

## Gotchas

- `auth.js` has `LIVE_SITE = 'https://specsoftdev.netlify.app'` used to rewrite email links during local testing;
  Supabase's redirect allowlist must contain that URL and the auth landing pages.
- `main.js` contains an email-link rescue that forwards `#access_token=...` hashes to `login.html`/`verified.html`.
- Intro gate: `sessionStorage['specsoft-intro-seen']`; `index.html` also has an inline copy of the logic — keep both
  in sync if you change it.
- Version strings are duplicated: the HUD in `index.html` (`VER 7`) and `version.json` (`release`), the latter
  regenerated by `sync.bat`. Update both when releasing.
- Studio is intentionally blocked on phones/tablets (`studio-guard.js`). That is a UX gate, not security; RLS is the
  real boundary.
- `backend_ai_deprcated/` (Python model), `nsfw/` (model files), and `my-discord-bot/` (its own `package.json`) are
  auxiliary/deprecated and are not part of the website deploy.

## Before finishing a change

- Run `node studio-size-limits.test.js` for anything touching Studio size/limits.
- Load the affected page(s) over HTTP and check the console; there are no UI tests.
- Verify the script/link order on any page you edit and that new modules self-guard on pages that don't need them.
- Do not commit `.env`, `node_modules/`, or generated `version.json` changes unless the task is a release.
