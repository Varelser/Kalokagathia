// =============================================================================
// monosphere-ai-limiter — strict, globally-consistent rate limiter for the
// Monosphere (Kalokagathia) AI relay.
//
// STATUS: DEPLOYED (2026-11-11) as the Worker "monosphere-ai-limiter"
// (https://monosphere-ai-limiter.varelser-jp.workers.dev). public/_worker.js
// consults this limiter first for /api/ai and /api/test-ai and falls back to
// its per-isolate in-memory limiter on any limiter failure. See
// STRICT_RATELIMIT_IMPL_REPORT_20261111.md and relay/DEPLOYMENT_RUNBOOK.md.
//
// Design
// ------
// - A separate Worker (workers.dev) that holds ONLY rate-limit state.
// - State lives in ONE Durable Object instance per rate key
//   (key = "<route>|<client IP>"). A Durable Object is single-threaded and
//   strongly consistent, so every /check for the same key is serialised
//   through the same object no matter which colo/isolate the Pages relay
//   runs in. That is what makes the limit strict (global), unlike the
//   per-isolate Map in public/_worker.js.
// - The DO persists hit timestamps with this.state.storage (SQLite-backed
//   when created with new_sqlite_classes — see wrangler.toml.example).
// - Rules are IDENTICAL to public/_worker.js (AI Phase 3):
//     /api/ai      : 8 req / 60 s burst AND 20 req / 10 min per IP
//     /api/test-ai : 10 req / 10 min per IP
//   Sliding window over stored timestamps, same retryAfter computation,
//   and on success limit/remaining/windowSeconds describe the LONGEST rule,
//   exactly like checkRateLimit() in the Pages worker, so the AI tab usage
//   panel (rateLimit passthrough) behaves unchanged.
//
// HTTP API
// --------
//   GET  /health -> 200 { ok: true, service: "monosphere-ai-limiter" }
//        (no auth, no state; for deployment smoke tests only)
//   POST /check  -> HMAC-authenticated. Headers:
//          X-Limiter-Timestamp: <unix epoch milliseconds, decimal string>
//          X-Limiter-Signature: <hex HMAC-SHA256(secret,
//                                  "<timestamp>.<raw request body>")>
//        Body (JSON): { "key": "<client IP>", "route": "/api/ai" }
//          ("key" may also be the combined "<route>|<ip>" form; route then
//           is parsed from the prefix.)
//        200: { allowed, retryAfterSeconds, remaining, limit, windowSeconds }
//          allowed=false -> retryAfterSeconds >= 1, remaining = 0, and
//          limit/windowSeconds describe the VIOLATED rule (same semantics
//          as the Pages worker's 429 body).
//          allowed=true  -> retryAfterSeconds = 0, limit/remaining/
//          windowSeconds describe the longest rule.
//        401: missing/stale/invalid signature. 400: malformed body/route.
//        500: limiter misconfigured (secret or DO binding missing).
//
// Secret: env.LIMITER_HMAC_SECRET (Worker secret; the SAME value is set as
// a secret env var on the Pages project — see relay/DEPLOYMENT_RUNBOOK.md). Never log it,
// never return it.
// =============================================================================

export const RATE_RULES = {
  '/api/ai': [
    { windowMs: 60_000, max: 8 },
    { windowMs: 600_000, max: 20 },
  ],
  '/api/test-ai': [{ windowMs: 600_000, max: 10 }],
};

const MAX_CLOCK_SKEW_MS = 300_000; // signed timestamps accepted within ±5 min
const STORAGE_KEY = 'hits';

// --- Pure sliding-window evaluation (shared logic, unit-testable) ---------
// hits: sorted timestamps (ms). Returns the verdict plus the pruned/extended
// hit list to persist. Mirrors checkRateLimit() in public/_worker.js.
export function evaluateRateLimit(hitsIn, rules, now) {
  const longest = Math.max(...rules.map((r) => r.windowMs));
  const hits = (Array.isArray(hitsIn) ? hitsIn : [])
    .filter((t) => typeof t === 'number' && now - t < longest)
    .sort((a, b) => a - b);
  for (const rule of rules) {
    const inWindow = hits.filter((t) => now - t < rule.windowMs);
    if (inWindow.length >= rule.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((inWindow[0] + rule.windowMs - now) / 1000),
      );
      return {
        allowed: false,
        retryAfterSeconds,
        remaining: 0,
        limit: rule.max,
        windowSeconds: rule.windowMs / 1000,
        hits,
      };
    }
  }
  hits.push(now);
  const tightest = rules[rules.length - 1];
  const usedInLongest = hits.filter((t) => now - t < tightest.windowMs).length;
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, tightest.max - usedInLongest),
    limit: tightest.max,
    windowSeconds: tightest.windowMs / 1000,
    hits,
  };
}

// --- HMAC helpers (WebCrypto; available in Workers and Node >= 19) --------
function hexToBytes(hex) {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(sig);
}

// Verify X-Limiter-Timestamp / X-Limiter-Signature for a raw body string.
// Returns true only when the signature matches AND the timestamp is fresh.
export async function verifySignature(secret, timestamp, signature, rawBody, now = Date.now()) {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return timingSafeEqualStr(expected, signature.toLowerCase());
}

// --- Durable Object: one instance per "<route>|<ip>" ----------------------
// Serialises every check for its key and owns the persistent hit list, so
// counts are globally consistent for that key.
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/check') {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => null);
    const route = body?.route;
    const rules = RATE_RULES[route];
    if (!rules) {
      return Response.json({ ok: false, error: 'unknown route' }, { status: 400 });
    }
    // The DO's own clock is authoritative (the caller's clock is never
    // trusted for window math).
    const now = Date.now();
    const stored = (await this.state.storage.get(STORAGE_KEY)) || [];
    const verdict = evaluateRateLimit(stored, rules, now);
    await this.state.storage.put(STORAGE_KEY, verdict.hits);
    const { hits: _hits, ...pub } = verdict;
    return Response.json(pub);
  }
}

// --- Worker entry -----------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'monosphere-ai-limiter' });
    }
    if (url.pathname !== '/check') {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }
    if (request.method !== 'POST') {
      return Response.json({ ok: false, error: 'method not allowed' }, { status: 405 });
    }
    const secret = env?.LIMITER_HMAC_SECRET ? String(env.LIMITER_HMAC_SECRET) : null;
    if (!secret) {
      return Response.json({ ok: false, error: 'limiter not configured' }, { status: 500 });
    }
    if (!env?.RATE_LIMITER || typeof env.RATE_LIMITER.idFromName !== 'function') {
      return Response.json({ ok: false, error: 'limiter binding missing' }, { status: 500 });
    }
    const rawBody = await request.text();
    const okSig = await verifySignature(
      secret,
      request.headers.get('X-Limiter-Timestamp'),
      request.headers.get('X-Limiter-Signature'),
      rawBody,
    );
    if (!okSig) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
    let body = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
    let route = typeof body?.route === 'string' ? body.route : null;
    let key = typeof body?.key === 'string' ? body.key : null;
    // Accept the combined "<route>|<ip>" key form used by the Pages worker.
    if (key && key.includes('|')) {
      const [prefix, rest] = key.split('|', 2);
      if (!route && RATE_RULES[prefix]) route = prefix;
      if (RATE_RULES[prefix]) key = rest;
    }
    if (!route || !RATE_RULES[route] || !key || key.length > 128 || route.length > 64) {
      return Response.json({ ok: false, error: 'bad request' }, { status: 400 });
    }
    const id = env.RATE_LIMITER.idFromName(`${route}|${key}`);
    const stub = env.RATE_LIMITER.get(id);
    const res = await stub.fetch('https://rate-limiter.internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route }),
    });
    const verdict = await res.json().catch(() => null);
    if (!verdict || typeof verdict.allowed !== 'boolean') {
      return Response.json({ ok: false, error: 'limiter internal error' }, { status: 502 });
    }
    return Response.json(verdict);
  },
};
