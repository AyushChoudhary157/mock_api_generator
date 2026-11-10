# Mock API Generator (FrugalTesting)

Create a live, public, CORS-enabled REST API with realistic fake data in seconds. No sign-up: projects are owned by a secret key kept in the browser's localStorage.

* **Frontend:** vanilla HTML/CSS/ES modules in `public/` (Poppins + JetBrains Mono, FrugalTesting tool-page tokens, light/dark).
* **Backend:** Vercel serverless functions in `api/` (plain Node `req/res`, so they also run in the bundled dev server).
* **Database:** Neon Postgres via `@neondatabase/serverless` (HTTP driver for single statements, pooled WebSocket `Pool` for transactions).
* **AI:** OpenRouter, server-side only, used just for "describe your API" and domain-specific values.

## Folder structure

```
api/
  _lib/        env, http helpers, db, auth, ratelimit, faker, schema, records, ai, service, log
  manage/[...path].js   /api/manage/*  project/resource management (X-Owner-Token)
  v1/[...path].js       /api/v1/*      public mock endpoints
  cron/cleanup.js       TTL cleanup (Vercel cron)
migrations/001_init.sql projects, resources, records(JSONB+GIN), request_logs, rate_limit_counters, ai_cache
public/        index.html, styles.css, js/ (app, wizard, schema-editor, data-view, settings-view, tester, ...)
scripts/       migrate, seed, dev-server, screenshots (visual QA)
tests/         api.test.js (18 end-to-end), ai.test.js (6, stubbed OpenRouter)
docs/CURL_TESTS.md      sample cURL for every endpoint
```

## Local setup

```bash
npm install
npm run dev:local        # embedded Postgres (PGlite), auto-migrates, http://localhost:3000
npm run seed:local       # optional demo project (prints a token you can paste into "Access key")
npm test                 # runs API + AI tests (no network, no Neon needed)
```
With Neon: copy `.env.example` to `.env`, set `NEON_DATABASE_URL` (use the **-pooler** connection string), then `npm run migrate && npm run dev`.
AI is optional: set `OPENROUTER_API_KEY`; without it the AI tab explains it is disabled and manual/import flows work unchanged.

## Deploy (Vercel)

1. Create a Neon project, run `NEON_DATABASE_URL=... npm run migrate`.
2. Import the repo in Vercel (no build step; `public/` is served statically, `api/` as functions).
3. Set env vars from `.env.example` (at least `NEON_DATABASE_URL`, `CRON_SECRET`, `IP_HASH_SALT`; optionally `OPENROUTER_API_KEY`).
4. `vercel.json` already rewrites `/tools/mock-api-generator` to the page and schedules `/api/cron/cleanup` daily (deletes anonymous projects idle for 30 days, old logs, counters, AI cache).

## Embedding on frugaltesting.com

* **Iframe (recommended with Webflow):** add an Embed element:
  `<iframe src="https://YOUR-DEPLOYMENT/?embed=1" title="Mock API Generator" style="width:100%;min-height:1100px;border:0" loading="lazy"></iframe>`
  `?embed=1` hides the site header/footer and marketing sections.
* **Standalone page:** point a reverse proxy / Vercel domain so `https://www.frugaltesting.com/tools/mock-api-generator` serves this deployment. Assets use absolute paths (`/styles.css`, `/js/*`).
* **Static page elsewhere + API here:** set `<meta name="mock-api-base" content="https://YOUR-DEPLOYMENT">` and list the page's origin in `ALLOWED_ORIGINS`.
* Header/footer links in `index.html` are plain links to frugaltesting.com; adjust them (e.g. the Contact URL) to match the live navigation.

## Design notes

* **Ownership:** browser generates `mat_<48 hex>`; only its SHA-256 is stored. "Access key & backup" lets users export/restore it.
* **Limits (env-configurable):** 5 projects/owner, 10 resources, 100 records/resource (enforced atomically inside the insert statement), 1,000 public requests/project/day, 120 req/min/IP public, 90 req/min/IP management, 10 project creations/IP/day, 20 AI calls/owner/day.
* **Security:** parameterised SQL only (field names from URLs are matched against the schema and still bound as parameters); body size limits (16 KB public, 256 KB management); JSON-only; header allow-list for custom headers; XSS-safe rendering (no `innerHTML` anywhere); open CORS only on `/api/v1`, allow-listed origins on `/api/manage`; IPs stored hashed; JSON-lines logs.
* **Query features:** `page, limit, sortBy, order, search, envelope`, exact filters `?field=value`, pagination headers (`X-Total-Count`, `Link`, ...).
* **Simulation:** delay (<= 5 s), random error rate + status, custom 2xx per method, custom headers; resource overrides project defaults.
* **Data:** deterministic seeded faker (same seed = same data). JSONB loses key order, so responses are re-ordered to the schema order.

## Known limitations / next steps

* Anonymous ownership: lose the key and you lose management access (the public API keeps working until it expires). Next: optional email magic-link accounts (`projects.email` column is ready).
* Rate limiting is Postgres fixed-window counters (one extra write per request). For high traffic move to Upstash Redis / Cloudflare rate limiting.
* Public endpoints are open: anyone with a URL can write to it. Next: optional per-project API keys, read-only mode.
* Filtering is exact-match on top-level fields only (no `gt/lt/like`, no nested paths); search scans the record JSON text.
* Relationships are one-to-many via `ref` fields only; no cascade deletes or referential checks.
* Schema edits do not migrate existing records (use "Save & regenerate").
* Request logs show only the latest 50 entries per project; no analytics dashboard.
* Not covered by automated tests: the browser UI (use `node scripts/screenshots.mjs` for visual QA), real Neon/OpenRouter (tested against PGlite and a stubbed fetch). Lighthouse was not run.
* Roadmap: teams/workspaces, webhooks on write, OpenAPI import/export, GraphQL, custom response templates, scenario scripting.
