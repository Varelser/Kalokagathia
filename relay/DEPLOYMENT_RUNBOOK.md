# relay/ — Strict /api/ai rate limiter (prepared, NOT deployed)

Status on 2026-11-11: **BLOCKED — not deployed.** Production
(https://monosphere.pages.dev/, deployment `ae28ae98`) still uses the
per-isolate in-memory sliding-window limiter inside `public/_worker.js`.
Nothing in this folder is live, and `public/_worker.js` was **not** modified
for this item.

## Why blocked — the decisive probe (2026-11-11)

Using the registered `custom.cloudflare` token (account
`af63e3d6dd6507977f4f07afae481cfa`; scopes: Account Settings Read /
Pages Edit / User Details Read / Memberships Read), a reversible probe
worker `monosphere-perm-probe` was uploaded and immediately deleted:

| Request | Result |
|---|---|
| `GET /accounts/{id}/workers/scripts` | **200**, `[]` (read works) |
| `GET /accounts/{id}/storage/kv/namespaces` | **401**, code `10000` "Authentication error" (KV not accessible) |
| `PUT /accounts/{id}/workers/scripts/monosphere-perm-probe` (multipart, module format) | **403**, "No access to the specified resource." |
| `DELETE /accounts/{id}/workers/scripts/monosphere-perm-probe` (cleanup) | **403**, same error (nothing existed to clean up) |
| `GET /accounts/{id}/workers/scripts` (after) | **200**, `[]` — account left exactly as found |

### Exact missing permission

> **Account → Workers Scripts → Edit** on the API token (Account Resources
> must include this account).

That single grant unblocks the whole design below (Durable Objects are
created/migrated as part of the script upload). **No KV permission is
needed** for this design. Only if the KV fallback were chosen instead
would **Account → Workers KV Storage → Edit** also be required — and KV is
eventually consistent, so it cannot provide strict limits anyway; it is
documented here only as a last-resort fallback.

## What is prepared in this folder

| File | Purpose |
|---|---|
| `monosphere-ai-limiter.js` | Complete limiter Worker + `RateLimiter` Durable Object. HMAC-authenticated `POST /check`, `GET /health`. Rules identical to production (`/api/ai`: 8/60s + 20/10min; `/api/test-ai`: 10/10min). |
| `wrangler.toml.example` | DO binding (`RATE_LIMITER` → class `RateLimiter`) + first-migration `new_sqlite_classes = ["RateLimiter"]`, `workers_dev = true`. |
| `pages-worker-integration.example.js` | Reference snippet for the future `public/_worker.js` change (strict check after the Origin check, fail-open to the existing in-isolate limiter). **Not applied.** |
| `test_limiter.mjs` | Local test suite (pure window logic + end-to-end through the Worker `fetch` with a mocked DO namespace). |
| `DEPLOYMENT_RUNBOOK.md` | This runbook. (Named distinctly from the project README so its Drive mirror keeps a unique plain filename.) |

### Design notes

- **Primitive: Durable Objects** (one instance per `"<route>|<ip>"` via
  `idFromName`). A DO is single-threaded and strongly consistent, so all
  checks for a key serialise through one object regardless of colo/isolate
  — the limit becomes truly global per key. Hit timestamps persist in
  `state.storage` (SQLite-backed with the migration above).
- **Auth:** HMAC-SHA256 over `"<timestamp>.<raw body>"`, headers
  `X-Limiter-Timestamp` / `X-Limiter-Signature`, ±5 min freshness window,
  constant-time compare. Secret lives only as a Worker secret and a Pages
  secret env var (same value, set via API, never committed or logged).
- **Fail-open:** if the limiter is unreachable/slow (>1.5 s)/misconfigured,
  the Pages worker falls back to today's in-isolate limiter, so an outage
  of the limiter can never take the AI relay down; it only degrades
  strictness to the current behaviour.
- **Untouched by design:** the Origin check (runs first, limiter is never
  called for rejected origins), BYOK (browser-direct calls never touch the
  relay), the `usage`/`rateLimit` response passthrough and the AI-tab
  usage panel (the limiter returns the same limit/remaining/windowSeconds
  semantics — longest rule on success, violated rule on denial).

## Local verification (already run, 2026-11-11)

```bash
cd ~/workspace/monosphere-audit/project
node --check relay/monosphere-ai-limiter.js        # syntax OK
node relay/test_limiter.mjs                        # 19 checks, LIMITER TEST: PASS
node ../test_worker_rate_limit.mjs                 # production worker harness: PASS (unchanged)
npx tsc --noEmit                                   # exit 0
npx eslint relay/                                  # exit 0
```

The e2e section of `test_limiter.mjs` alternates "isolates" over one shared
DO registry to demonstrate cross-isolate state sharing, checks the exact
success shape (`limit 20, remaining 12, windowSeconds 600` after 8 calls —
same as the production harness), the 9th-call burst denial, wrong-secret
and stale-timestamp 401s, and the combined `"<route>|<ip>"` key form.

## Deployment runbook (execute once Workers Scripts → Edit is granted)

0. **Re-probe.** Re-run the perm-probe (PUT + DELETE `monosphere-perm-probe`).
   Proceed only if PUT returns 2xx. Also confirm the token can read the
   Pages project and that no other Worker scripts appeared meanwhile.
1. **Generate the shared secret** on the operator machine only:
   `openssl rand -hex 32`. Keep it in process memory / a password manager;
   never write it to this repo, a report, or a log.
2. **Deploy the limiter Worker.**
   - Wrangler route: copy `wrangler.toml.example` to `wrangler.toml` in a
     scratch copy of this folder, then `wrangler deploy`. The migration in
     the config creates the SQLite DO class on first deploy.
   - API route (matches this environment's tooling): `PUT
     /accounts/{account_id}/workers/scripts/monosphere-ai-limiter` as
     multipart form-data with parts `metadata` (JSON:
     `{"main_module": "monosphere-ai-limiter.js",
       "compatibility_date": "2025-01-01",
       "bindings": [{"type": "durable_object_namespace",
                     "name": "RATE_LIMITER", "class_name": "RateLimiter"}]}`)
     and `monosphere-ai-limiter.js` (the source, content type
     `application/javascript+module`). Durable Object migrations via the
     raw API change over time — verify the current `migrations` field in
     the Cloudflare Workers API docs at deploy time; the wrangler route
     above is the reference behaviour.
   - Ensure a workers.dev subdomain exists for the account
     (`GET /accounts/{id}/workers/subdomain`); creating one, if absent,
     is part of the same Workers permission family.
3. **Set the Worker secret:** wrangler `wrangler secret put
   LIMITER_HMAC_SECRET`, or API `PUT
   /accounts/{id}/workers/scripts/monosphere-ai-limiter/secrets` with
   `{"name": "LIMITER_HMAC_SECRET", "text": "<secret>", "type": "secret_text"}`.
4. **Smoke-test the limiter directly** (signed request; run the signing in
   a local shell so the secret never appears in logs):
   `GET https://monosphere-ai-limiter.<subdomain>.workers.dev/health`
   → `{"ok":true,...}`. Then a signed `POST /check`
   `{"key":"203.0.113.99","route":"/api/ai"}` → `allowed:true, limit:20,
   remaining:19, windowSeconds:600`; repeat rapidly ×9 → the 9th returns
   `allowed:false, limit:8, windowSeconds:60`. An unsigned request → 401.
5. **Set the Pages env vars (set-only, preserve existing).**
   `GET /accounts/{id}/pages/projects/monosphere` and read
   `deployment_configs` — note it returns existing values; handle them
   only in local memory and log **names only**. Build the merged env map
   per environment (production + preview) keeping the existing `Groq` and
   `Gemini` entries untouched, adding:
   - `LIMITER_URL` — plain text: `https://monosphere-ai-limiter.<subdomain>.workers.dev`
   - `LIMITER_HMAC_SECRET` — `{"type": "secret_text", "value": "<secret>"}`
   Then `PATCH /accounts/{id}/pages/projects/monosphere/deployment_configs`
   with the merged maps. Re-GET and verify **by name only** that `Groq`,
   `Gemini`, `LIMITER_URL`, `LIMITER_HMAC_SECRET` are all present.
6. **Apply the Pages worker integration** from
   `pages-worker-integration.example.js` to `public/_worker.js` (origin
   check first; strict check; fail-open fallback to `checkRateLimit`,
   which stays in the file). Re-run `test_worker_rate_limit.mjs` (it will
   exercise the fallback path, since no limiter env is set locally) plus
   `relay/test_limiter.mjs`, `npm run typecheck`, `npm run lint`, the
   `verify:*` gates and `npm run build`.
7. **Deploy the app** with the established Direct Upload flow:
   `~/workspace/cloudflare-pages/.venv/bin/python
   ~/workspace/cloudflare-pages/deploy.py --project-name monosphere`
   (run from `~/workspace/cloudflare-pages`, `--dir` = the built `dist/`
   directory as in previous deploys).
8. **Production probes:** `/api/ping` 200 with both keys present; one real
   `/api/ai` call (same-origin) → 200 with `usage` and `rateLimit`
   fields; burst of 9 rapid `/api/ai` calls → 9th is 429 with
   `Retry-After` (shared-IP caveat: this VM's egress IP may already carry
   other test traffic); cross-origin POST → 403; confirm BYOK files were
   not in the change set.
9. **Rollback (any step):** remove `LIMITER_URL`/`LIMITER_HMAC_SECRET`
   from the Pages deployment configs (the worker instantly reverts to the
   in-isolate limiter), or redeploy the previous `_worker.js`. The limiter
   Worker itself can be deleted with `DELETE
   /accounts/{id}/workers/scripts/monosphere-ai-limiter`; its DO state is
   disposable (windows expire within 10 minutes).
