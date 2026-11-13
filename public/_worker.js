// Monosphere relay worker (advanced mode). Serves the static site via the
// ASSETS binding and relays AI chat requests to Groq / Gemini with the API
// keys kept server-side (Pages project environment variables). Keys are
// never exposed to the browser.
function clean(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/^["']+|["']+$/g, '').trim();
  return s || null;
}
function groqKey(env) { return clean(env.GROQ_API_KEY) || clean(env.Groq); }
function geminiKey(env) { return clean(env.GEMINI_API_KEY) || clean(env.Gemini); }

const GROQ_MODEL = 'openai/gpt-oss-120b';
const GEMINI_MODEL = 'gemini-2.5-flash';

// --- Rate limiting (AI Phase 3 + strict limiter) ---------------------------
// The Pages project is deployed by Direct Upload and has no KV/Durable
// Object binding available to this worker. Two layers, same rules:
//   1. STRICT (primary, for /api/ai and /api/test-ai): the separate
//      monosphere-ai-limiter Worker holds one Durable Object per
//      "<route>|<ip>", so counts are globally consistent across colos.
//      Consulted via checkRateLimitStrict() when LIMITER_URL /
//      LIMITER_HMAC_SECRET are set (see relay/DEPLOYMENT_RUNBOOK.md).
//   2. IN-ISOLATE (fallback): the counters below live in isolate memory —
//      per-colo and reset when the isolate is recycled. Used whenever the
//      strict limiter is unset, unreachable or slow (fail-open, so a
//      limiter outage can only degrade strictness, never availability),
//      and as the only layer for /api/sync/* (not a limiter route).
// Limits are generous for a human chatting:
//   /api/ai      : 8 req / 60s burst and 20 req / 10 min per IP
//   /api/test-ai : 10 req / 10 min per IP
const RATE_RULES = {
  '/api/ai': [{ windowMs: 60_000, max: 8 }, { windowMs: 600_000, max: 20 }],
  '/api/test-ai': [{ windowMs: 600_000, max: 10 }],
  '/api/sync/push': [{ windowMs: 60_000, max: 10 }, { windowMs: 600_000, max: 60 }],
  '/api/sync/pull': [{ windowMs: 60_000, max: 10 }, { windowMs: 600_000, max: 60 }],
};
const rateBuckets = new Map(); // key -> sorted timestamps (ms)

function checkRateLimit(pathname, ip, now = Date.now()) {
  const rules = RATE_RULES[pathname];
  if (!rules) return { ok: true };
  const key = `${pathname}|${ip}`;
  const longest = Math.max(...rules.map((r) => r.windowMs));
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < longest);
  for (const rule of rules) {
    const inWindow = hits.filter((t) => now - t < rule.windowMs);
    if (inWindow.length >= rule.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((inWindow[0] + rule.windowMs - now) / 1000));
      rateBuckets.set(key, hits);
      return { ok: false, retryAfterSeconds, limit: rule.max, windowSeconds: rule.windowMs / 1000 };
    }
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  // Opportunistic cleanup so the map cannot grow without bound.
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) {
      if (!v.length || now - v[v.length - 1] > longest) rateBuckets.delete(k);
    }
  }
  const tightest = rules[rules.length - 1];
  const usedInLongest = hits.filter((t) => now - t < tightest.windowMs).length;
  return { ok: true, limit: tightest.max, remaining: Math.max(0, tightest.max - usedInLongest), windowSeconds: tightest.windowMs / 1000 };
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
    || 'unknown';
}

// --- Strict rate limiter client (monosphere-ai-limiter Worker) -------------
// HMAC-authenticated call to the limiter Worker; its Durable Object verdict
// is globally consistent for the "<route>|<ip>" key. Returns the same shape
// as checkRateLimit() on success/denial, or null when the limiter is not
// configured or cannot be trusted — the caller then fails open to
// checkRateLimit(). On denial the limiter's limit/windowSeconds describe
// the violated rule, exactly like the in-isolate 429 body.
async function hmacHexWorker(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkRateLimitStrict(env, pathname, ip) {
  const base = clean(env.LIMITER_URL);
  const secret = clean(env.LIMITER_HMAC_SECRET);
  if (!base || !secret) return null;
  const body = JSON.stringify({ key: ip, route: pathname });
  const ts = String(Date.now());
  try {
    const signature = await hmacHexWorker(secret, `${ts}.${body}`);
    const r = await fetch(`${base.replace(/\/+$/, '')}/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Limiter-Timestamp': ts,
        'X-Limiter-Signature': signature,
      },
      body,
      // 3.5s budget: the 1.5s from the original design intermittently timed
      // out against cold / cross-colo Durable Object paths in production
      // (measured 2026-11-11: ~1/3 of burst calls failed open), while AI
      // upstream calls take seconds anyway, so the headroom is free.
      signal: AbortSignal.timeout(3500),
    });
    if (!r.ok) {
      console.warn(`strict limiter http ${r.status}; falling back to in-isolate limiter`);
      return null;
    }
    const j = await r.json().catch(() => null);
    if (!j || typeof j.allowed !== 'boolean') return null;
    if (!j.allowed) {
      return { ok: false, retryAfterSeconds: j.retryAfterSeconds, limit: j.limit, windowSeconds: j.windowSeconds };
    }
    return { ok: true, limit: j.limit, remaining: j.remaining, windowSeconds: j.windowSeconds };
  } catch (e) {
    console.warn(`strict limiter unavailable (${String(e).slice(0, 80)}); falling back to in-isolate limiter`);
    return null;
  }
}

async function testGroq(env) {
  const key = groqKey(env);
  if (!key) return { provider: 'groq', ok: false, error: 'key missing' };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 128, temperature: 0,
    }),
  });
  const j = await r.json().catch(() => ({}));
  const text = j?.choices?.[0]?.message?.content ?? null;
  return { provider: 'groq', ok: r.ok && Boolean(text), status: r.status, model: GROQ_MODEL, reply: text, error: r.ok ? undefined : JSON.stringify(j).slice(0, 200) };
}

async function testGemini(env) {
  const key = geminiKey(env);
  if (!key) return { provider: 'gemini', ok: false, error: 'key missing' };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
      generationConfig: { maxOutputTokens: 128, temperature: 0 },
    }),
  });
  const j = await r.json().catch(() => ({}));
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || null;
  return { provider: 'gemini', ok: r.ok && Boolean(text), status: r.status, model: GEMINI_MODEL, reply: text, error: r.ok ? undefined : JSON.stringify(j).slice(0, 200) };
}

function sanitizeMessages(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const out = [];
  let total = 0;
  for (const m of msgs.slice(-14)) {
    const role = ['system', 'user', 'assistant'].includes(m?.role) ? m.role : 'user';
    // Per-message cap raised 9000 -> 40000 (2026-11-11, AI catalog expansion):
    // the Phase 1/2 system prompts carry the full AI control catalog, which
    // grew to ~300 keys (~22k chars) plus a 250-parent list for generation;
    // at 9000 chars the catalog was truncated mid-way and most keys became
    // unreachable for the model.
    const content = String(m?.content ?? '').slice(0, 40000);
    total += content.length;
    if (total > 90000) break;
    out.push({ role, content });
  }
  return out;
}

async function aiGroq(env, messages, jsonMode) {
  const key = groqKey(env);
  if (!key) return { ok: false, status: 500, error: 'groq key missing' };
  const payload = {
    model: GROQ_MODEL,
    messages,
    max_tokens: 1600,
    temperature: 0.4,
  };
  if (jsonMode) payload.response_format = { type: 'json_object' };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  const text = j?.choices?.[0]?.message?.content ?? null;
  if (!r.ok || !text) return { ok: false, status: r.status, error: JSON.stringify(j).slice(0, 240) };
  const usage = j?.usage
    ? { inputTokens: j.usage.prompt_tokens ?? null, outputTokens: j.usage.completion_tokens ?? null }
    : undefined;
  return { ok: true, provider: 'groq', model: GROQ_MODEL, text, usage };
}

async function aiGemini(env, messages, jsonMode) {
  const key = geminiKey(env);
  if (!key) return { ok: false, status: 500, error: 'gemini key missing' };
  let system = '';
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n' : '') + m.content; continue; }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const gen = { maxOutputTokens: 2048, temperature: 0.4 };
  if (jsonMode) gen.responseMimeType = 'application/json';
  const payload = { contents, generationConfig: gen };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || null;
  if (!r.ok || !text) return { ok: false, status: r.status, error: JSON.stringify(j).slice(0, 240) };
  const usage = j?.usageMetadata
    ? { inputTokens: j.usageMetadata.promptTokenCount ?? null, outputTokens: j.usageMetadata.candidatesTokenCount ?? null }
    : undefined;
  return { ok: true, provider: 'gemini', model: GEMINI_MODEL, text, usage };
}

// --- Preset cross-device sync via Neon (programme item 8) -------------------
// Opt-in sync of the user's own preset library across their devices. The
// browser holds a human-typeable sync code; the server only ever sees its
// SHA-256 hash (sync_hash) and stores per-preset rows keyed by that hash in
// Neon (pooled connection string in the NEON_DATABASE_URL Pages env var,
// reached over Neon's HTTP SQL API). The raw code is never stored or logged.
// Payload caps: 2,000 records and ~2 MB of JSON per push (the compressed
// library is ~366 KB for 445 records, so this is generous headroom).
const SYNC_MAX_RECORDS = 2000;
const SYNC_MAX_BODY_CHARS = 2_200_000;
const SYNC_PUSH_CHUNK = 100;

function neonDbUrl(env) { return clean(env.NEON_DATABASE_URL); }

function neonHost(connStr) {
  try {
    return new URL(connStr).hostname;
  } catch {
    const m = /@([^/:?]+)/.exec(connStr || '');
    return m ? m[1] : null;
  }
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeSyncCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function neonSql(env, query, params) {
  const conn = neonDbUrl(env);
  if (!conn) throw new Error('neon not configured');
  const host = neonHost(conn);
  if (!host) throw new Error('neon host unresolved');
  // Neon free-tier compute pauses when idle; the first query after a pause
  // can take several seconds to wake, so allow a long timeout.
  const r = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': conn },
    body: JSON.stringify({ query, params: params ?? [] }),
    signal: AbortSignal.timeout(25_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`neon sql ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
  return Array.isArray(j?.rows) ? j.rows : [];
}

let syncSchemaReady = false;
async function syncEnsureSchema(env) {
  if (syncSchemaReady) return;
  await neonSql(env, `CREATE TABLE IF NOT EXISTS monosphere_sync_presets (
    sync_hash text NOT NULL,
    preset_id text NOT NULL,
    record jsonb NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (sync_hash, preset_id)
  )`);
  await neonSql(env, `CREATE TABLE IF NOT EXISTS monosphere_sync_meta (
    sync_hash text PRIMARY KEY,
    deleted_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  syncSchemaReady = true;
}

function validSyncRecord(rec) {
  return Boolean(rec) && typeof rec === 'object' && !Array.isArray(rec)
    && typeof rec.id === 'string' && rec.id.length > 0 && rec.id.length <= 200
    && typeof rec.name === 'string'
    && Boolean(rec.config) && typeof rec.config === 'object' && !Array.isArray(rec.config);
}

async function syncPush(env, body) {
  const code = normalizeSyncCode(body?.code);
  if (code.length < 12 || code.length > 64) {
    return Response.json({ ok: false, error: 'invalid code' }, { status: 400 });
  }
  const recordsIn = body?.records;
  if (!Array.isArray(recordsIn)) {
    return Response.json({ ok: false, error: 'records must be an array' }, { status: 400 });
  }
  if (recordsIn.length > SYNC_MAX_RECORDS) {
    return Response.json({ ok: false, error: 'too many records' }, { status: 413 });
  }
  if (JSON.stringify(recordsIn).length > SYNC_MAX_BODY_CHARS) {
    return Response.json({ ok: false, error: 'payload too large' }, { status: 413 });
  }
  const deletedIn = Array.isArray(body?.deletedIds) ? body.deletedIds : [];
  const deletedIds = [...new Set(deletedIn.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 200))].slice(0, SYNC_MAX_RECORDS);
  const nowIso = new Date().toISOString();
  const records = [];
  for (const rec of recordsIn) {
    if (!validSyncRecord(rec)) {
      return Response.json({ ok: false, error: 'invalid record shape' }, { status: 400 });
    }
    // Sanitise updatedAt in JS so the SQL cast below can never fail on a
    // malformed timestamp: anything unparseable is stamped as "now".
    const parsed = typeof rec.updatedAt === 'string' ? Date.parse(rec.updatedAt) : NaN;
    records.push({ ...rec, updatedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : nowIso });
  }
  const syncHash = await sha256Hex(code);
  await syncEnsureSchema(env);
  // Per-chunk single-param upsert: the whole chunk travels as one jsonb
  // parameter and is expanded server-side. The ON CONFLICT guard makes the
  // merge newest-wins on the server as well as on the client.
  for (let i = 0; i < records.length; i += SYNC_PUSH_CHUNK) {
    const chunk = records.slice(i, i + SYNC_PUSH_CHUNK);
    await neonSql(env, `INSERT INTO monosphere_sync_presets (sync_hash, preset_id, record, updated_at)
      SELECT $1, elem->>'id', elem, (elem->>'updatedAt')::timestamptz
      FROM jsonb_array_elements($2::jsonb) AS elem
      ON CONFLICT (sync_hash, preset_id) DO UPDATE
        SET record = EXCLUDED.record, updated_at = EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at >= monosphere_sync_presets.updated_at`,
    [syncHash, JSON.stringify(chunk)]);
  }
  if (deletedIds.length) {
    await neonSql(env, `DELETE FROM monosphere_sync_presets
      WHERE sync_hash = $1 AND preset_id IN (SELECT jsonb_array_elements_text($2::jsonb))`,
    [syncHash, JSON.stringify(deletedIds)]);
    await neonSql(env, `INSERT INTO monosphere_sync_meta (sync_hash, deleted_ids, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (sync_hash) DO UPDATE SET
        deleted_ids = COALESCE((
          SELECT jsonb_agg(DISTINCT x) FROM (
            SELECT jsonb_array_elements_text(monosphere_sync_meta.deleted_ids) AS x
            UNION SELECT jsonb_array_elements_text(EXCLUDED.deleted_ids)
          ) AS merged
        ), '[]'::jsonb),
        updated_at = now()`,
    [syncHash, JSON.stringify(deletedIds)]);
  }
  if (records.length) {
    // A (re-)pushed id is alive again: drop it from the tombstone list.
    await neonSql(env, `UPDATE monosphere_sync_meta AS m
      SET deleted_ids = COALESCE((
        SELECT jsonb_agg(x) FROM jsonb_array_elements_text(m.deleted_ids) AS x
        WHERE x NOT IN (SELECT jsonb_array_elements_text($2::jsonb))
      ), '[]'::jsonb)
      WHERE m.sync_hash = $1`,
    [syncHash, JSON.stringify(records.map((r) => r.id))]);
  }
  const countRows = await neonSql(env, 'SELECT count(*)::int AS n FROM monosphere_sync_presets WHERE sync_hash = $1', [syncHash]);
  return Response.json({ ok: true, stored: countRows[0]?.n ?? records.length, received: records.length, deleted: deletedIds.length });
}

async function syncPull(env, body) {
  const code = normalizeSyncCode(body?.code);
  if (code.length < 12 || code.length > 64) {
    return Response.json({ ok: false, error: 'invalid code' }, { status: 400 });
  }
  const syncHash = await sha256Hex(code);
  await syncEnsureSchema(env);
  const rows = await neonSql(env, 'SELECT record, updated_at FROM monosphere_sync_presets WHERE sync_hash = $1 ORDER BY updated_at ASC', [syncHash]);
  const metaRows = await neonSql(env, 'SELECT deleted_ids, updated_at FROM monosphere_sync_meta WHERE sync_hash = $1', [syncHash]);
  // Unknown code is indistinguishable from an empty library: an empty set,
  // never an error that would confirm a hash exists.
  return Response.json({
    ok: true,
    records: rows.map((r) => ({ record: r.record, updatedAt: r.updated_at })),
    deletedIds: Array.isArray(metaRows[0]?.deleted_ids) ? metaRows[0].deleted_ids : [],
    tombstoneUpdatedAt: metaRows[0]?.updated_at ?? null,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // AI endpoints spend the owner's API quota: only accept calls that come
    // from this site's own pages (browsers always send Origin on POST).
    if (request.method === 'POST' && (url.pathname === '/api/ai' || url.pathname === '/api/test-ai' || url.pathname === '/api/sync/push' || url.pathname === '/api/sync/pull')) {
      const origin = request.headers.get('Origin');
      let originOk = false;
      try {
        originOk = Boolean(origin) && new URL(origin).host === url.host;
      } catch {
        originOk = false;
      }
      if (!originOk) return Response.json({ ok: false, error: 'forbidden origin' }, { status: 403 });
      // Origin passed: strict limiter first for the AI routes (the sync
      // routes have no limiter rules and stay on the in-isolate layer);
      // any limiter failure fails open to checkRateLimit().
      const ip = clientIp(request);
      let rl = null;
      if (url.pathname === '/api/ai' || url.pathname === '/api/test-ai') {
        rl = await checkRateLimitStrict(env, url.pathname, ip);
      }
      if (!rl) rl = checkRateLimit(url.pathname, ip);
      if (!rl.ok) {
        return Response.json(
          { ok: false, error: 'rate_limited', retryAfterSeconds: rl.retryAfterSeconds, limit: rl.limit, windowSeconds: rl.windowSeconds },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
        );
      }
      request.__rateInfo = { limit: rl.limit, remaining: rl.remaining, windowSeconds: rl.windowSeconds };
    }
    if (url.pathname === '/api/ping') {
      return Response.json({
        ok: true,
        ts: new Date().toISOString(),
        hasGroqKey: Boolean(groqKey(env)),
        hasGeminiKey: Boolean(geminiKey(env)),
        hasNeonDb: Boolean(neonDbUrl(env)),
      });
    }
    if ((url.pathname === '/api/sync/push' || url.pathname === '/api/sync/pull') && request.method === 'POST') {
      if (!neonDbUrl(env)) {
        return Response.json({ ok: false, error: 'sync not configured' }, { status: 503 });
      }
      const rawText = await request.text().catch(() => '');
      if (rawText.length > SYNC_MAX_BODY_CHARS) {
        return Response.json({ ok: false, error: 'payload too large' }, { status: 413 });
      }
      let body = {};
      try {
        body = rawText ? JSON.parse(rawText) : {};
      } catch {
        return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
      }
      try {
        return url.pathname === '/api/sync/push' ? await syncPush(env, body) : await syncPull(env, body);
      } catch (e) {
        return Response.json({ ok: false, error: String(e).slice(0, 160) }, { status: 502 });
      }
    }
    if (url.pathname === '/api/test-ai' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      try {
        if (body?.provider === 'groq') return Response.json(await testGroq(env));
        if (body?.provider === 'gemini') return Response.json(await testGemini(env));
        return Response.json({ ok: false, error: 'provider must be groq|gemini' }, { status: 400 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
      }
    }
    if (url.pathname === '/api/ai' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const messages = sanitizeMessages(body);
      if (!messages.length) return Response.json({ ok: false, error: 'messages required' }, { status: 400 });
      const jsonMode = body?.jsonMode !== false;
      try {
        const res = body?.provider === 'gemini'
          ? await aiGemini(env, messages, jsonMode)
          : await aiGroq(env, messages, jsonMode);
        return Response.json({ ...res, rateLimit: request.__rateInfo ?? undefined }, { status: res.ok ? 200 : 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
      }
    }
    const res = await env.ASSETS.fetch(request);
    // Real 404 for missing files (audit 2026-11-14): the Pages assets layer
    // answers a miss with the SPA shell (200, text/html), which made missing
    // preset JSONs, robots.txt etc. indistinguishable from real content.
    // A request whose path carries a file extension is a file request: when
    // the assets layer reports 404, or returns the HTML shell for a
    // non-HTML extension, the file does not exist — say so. Extensionless
    // routes keep the SPA fallback untouched.
    const assetExt = /\.([A-Za-z0-9]+)$/.exec(url.pathname)?.[1]?.toLowerCase() ?? null;
    if (assetExt) {
      const servedType = res.headers.get('Content-Type') || '';
      const shellForFile = res.status === 200 && assetExt !== 'html' && assetExt !== 'htm' && servedType.includes('text/html');
      if (res.status === 404 || shellForFile) {
        return new Response('Not Found\n', {
          status: 404,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' },
        });
      }
    }
    // Repeat-visit speed: Vite/Rolldown asset filenames are content-hashed, so
    // they can be cached immutably; id-keyed media (thumbs, per-preset JSON,
    // icons) changes rarely and gets a week. HTML and everything else keeps
    // the platform default (revalidate), so deploys take effect immediately.
    let cache = null;
    if (url.pathname.startsWith('/assets/')) cache = 'public, max-age=31536000, immutable';
    else if (url.pathname.startsWith('/catalog/thumbs/') || url.pathname.startsWith('/presets/') || url.pathname.startsWith('/icons/')) cache = 'public, max-age=604800';
    if (!cache) return res;
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', cache);
    return out;
  },
};
