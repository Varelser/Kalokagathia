// =============================================================================
// pages-worker-integration.example.js — NOT APPLIED. DO NOT DEPLOY AS-IS.
//
// Reference snippet for the change to public/_worker.js once the limiter
// Worker is deployed and the Pages project has the LIMITER_URL /
// LIMITER_HMAC_SECRET env vars (see relay/DEPLOYMENT_RUNBOOK.md runbook steps 5-6).
// It is kept as a separate file so production stays byte-identical to the
// in-isolate limiter until the whole chain is verified.
//
// Integration contract (must all hold):
//  1. Origin check runs FIRST, unchanged (cross-origin POST -> 403, and no
//     limiter call is made for rejected origins).
//  2. BYOK is untouched: browser-direct provider calls never reach this
//     worker at all, so nothing here can affect them.
//  3. On limiter "allowed" -> use ITS limit/remaining/windowSeconds for the
//     existing rateLimit passthrough (usage panel unchanged); do NOT also
//     consume an in-isolate bucket (would double-count and diverge).
//  4. On limiter "denied" -> the EXACT 429 response shape used today.
//  5. On ANY limiter failure (missing env, timeout, non-200, bad JSON) ->
//     fail OPEN to the existing in-isolate checkRateLimit() below (kept
//     verbatim as the fallback layer) and console.warn once per failure.
// =============================================================================

// --- ADD: HMAC + limiter call (place near checkRateLimit) ------------------
async function hmacHexWorker(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Returns one of:
//   { mode: 'strict', ok: true,  limit, remaining, windowSeconds }
//   { mode: 'strict', ok: false, retryAfterSeconds, limit, windowSeconds }
//   null  -> limiter unavailable; caller falls back to checkRateLimit().
async function checkRateLimitStrict(env, pathname, ip) {
  const base = clean(env.LIMITER_URL); // e.g. https://monosphere-ai-limiter.<subdomain>.workers.dev
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
      signal: AbortSignal.timeout(3500), // raised from 1500 after production measurement (see STRICT_RATELIMIT_IMPL_REPORT_20261111.md)
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!j || typeof j.allowed !== 'boolean') return null;
    if (!j.allowed) {
      return {
        mode: 'strict', ok: false,
        retryAfterSeconds: j.retryAfterSeconds, limit: j.limit, windowSeconds: j.windowSeconds,
      };
    }
    return {
      mode: 'strict', ok: true,
      limit: j.limit, remaining: j.remaining, windowSeconds: j.windowSeconds,
    };
  } catch {
    return null;
  }
}

// --- REPLACE: the rate-limit block inside fetch(), AFTER the origin check --
// Existing code today:
//   const rl = checkRateLimit(url.pathname, clientIp(request));
//   if (!rl.ok) { ...429... }
//   request.__rateInfo = { limit: rl.limit, remaining: rl.remaining, windowSeconds: rl.windowSeconds };
//
// Replacement:
//   const ip = clientIp(request);
//   let rl = await checkRateLimitStrict(env, url.pathname, ip);
//   if (!rl) rl = checkRateLimit(url.pathname, ip); // fail-open fallback layer
//   if (!rl.ok) {
//     return Response.json(
//       { ok: false, error: 'rate_limited', retryAfterSeconds: rl.retryAfterSeconds, limit: rl.limit, windowSeconds: rl.windowSeconds },
//       { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
//     );
//   }
//   request.__rateInfo = { limit: rl.limit, remaining: rl.remaining, windowSeconds: rl.windowSeconds };
//
// Everything downstream (usage passthrough, `rateLimit: request.__rateInfo`
// on /api/ai responses, the /api/test-ai and /api/ping handlers, the ASSETS
// cache handling) stays byte-identical.
