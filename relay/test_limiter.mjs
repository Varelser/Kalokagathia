// Local unit/integration test for relay/monosphere-ai-limiter.js
// Runs in plain Node (>=19, WebCrypto global). No Cloudflare runtime needed:
// the Durable Object is backed by an in-memory Map "storage", and two
// separate worker invocations sharing one DO registry prove that state is
// shared across isolates (the property production gets from DO consistency).
//
// Run: node relay/test_limiter.mjs   (from the project root)

import worker, { RateLimiter, evaluateRateLimit, hmacHex, RATE_RULES } from './monosphere-ai-limiter.js';

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// ---- 1. Pure sliding-window logic ----------------------------------------
{
  const rules = RATE_RULES['/api/ai'];
  const t0 = 1_000_000_000_000;
  let hits = [];
  let v = null;
  for (let i = 0; i < 8; i += 1) {
    v = evaluateRateLimit(hits, rules, t0 + i * 1000);
    hits = v.hits;
    if (!v.allowed) break;
  }
  check('ai: first 8 in 60s allowed', v.allowed === true && hits.length === 8);
  v = evaluateRateLimit(hits, rules, t0 + 8000);
  check('ai: 9th in 60s denied', v.allowed === false && v.limit === 8 && v.windowSeconds === 60, `retryAfter=${v.retryAfterSeconds}`);
  check('ai: retryAfter ~52s for 9th at +8s', v.retryAfterSeconds === 52, `got ${v.retryAfterSeconds}`);
  // After the burst window slides past, one more is allowed but the 10-min
  // cap (20) still applies.
  let hits2 = [];
  let now = t0;
  for (let i = 0; i < 20; i += 1) {
    const r = evaluateRateLimit(hits2, rules, now);
    hits2 = r.hits;
    if (!r.allowed) { v = r; break; }
    now += 8000; // spaced so the 60s burst rule (8) never trips: 8 per 64s
    v = r;
  }
  check('ai: 20 spaced requests allowed', hits2.length === 20, `hits=${hits2.length}`);
  v = evaluateRateLimit(hits2, rules, now);
  check('ai: 21st within 10min denied by long rule', v.allowed === false && v.limit === 20 && v.windowSeconds === 600);
  const later = evaluateRateLimit(hits2, rules, t0 + 600_001);
  check('ai: allowed again after 10min window slides', later.allowed === true);

  const trules = RATE_RULES['/api/test-ai'];
  let th = [];
  let tv = null;
  for (let i = 0; i < 10; i += 1) { tv = evaluateRateLimit(th, trules, t0 + i * 100); th = tv.hits; }
  check('test-ai: 10 allowed', tv.allowed === true && th.length === 10);
  tv = evaluateRateLimit(th, trules, t0 + 1100);
  check('test-ai: 11th denied (10/10min)', tv.allowed === false && tv.limit === 10 && tv.windowSeconds === 600);
}

// ---- 2. End-to-end through the Worker fetch with a mocked DO namespace ---
const SECRET = 'test-secret-for-local-tests-only';

// Mock DO storage: Map-backed, async like the real API.
function makeDoRegistry() {
  const objects = new Map(); // name -> {instance, store}
  return {
    idFromName(name) { return { name }; },
    get(id) {
      if (!objects.has(id.name)) {
        const store = new Map();
        const state = {
          storage: {
            async get(k) { return store.has(k) ? [...store.get(k)] : undefined; },
            async put(k, val) { store.set(k, [...val]); },
          },
        };
        objects.set(id.name, { instance: new RateLimiter(state, {}), store });
      }
      const { instance } = objects.get(id.name);
      // Mirror the real DO stub API: fetch(urlString, init) -> Request.
      return { fetch: (url, init) => instance.fetch(new Request(url, init)) };
    },
  };
}

const registry = makeDoRegistry();
const env = { LIMITER_HMAC_SECRET: SECRET, RATE_LIMITER: registry };

async function signedCheck(route, key, { secret = SECRET, ts = Date.now(), isolate = 'A' } = {}) {
  const body = JSON.stringify({ key, route });
  const sig = await hmacHex(secret, `${ts}.${body}`);
  // `isolate` is illustrative: worker.fetch is stateless; all state lives in
  // the shared registry, exactly as separate Pages isolates would share DOs.
  void isolate;
  return worker.fetch(new Request('https://monosphere-ai-limiter.workers.dev/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Limiter-Timestamp': String(ts),
      'X-Limiter-Signature': sig,
    },
    body,
  }), env);
}

{
  const health = await worker.fetch(new Request('https://x/health'), env);
  check('health endpoint 200', health.status === 200);

  let last = null;
  for (let i = 0; i < 8; i += 1) {
    const r = await signedCheck('/api/ai', '203.0.113.7', { isolate: i % 2 ? 'B' : 'A' });
    last = await r.json();
    if (!(r.status === 200 && last.allowed)) break;
  }
  check('e2e: 8 shared-state checks allowed across isolates', last?.allowed === true, JSON.stringify(last));
  check('e2e: success shape matches Pages worker (limit 20, remaining 12, 600s)',
    last?.limit === 20 && last?.remaining === 12 && last?.windowSeconds === 600, JSON.stringify(last));

  const r9 = await signedCheck('/api/ai', '203.0.113.7');
  const j9 = await r9.json();
  check('e2e: 9th denied by burst rule', r9.status === 200 && j9.allowed === false && j9.limit === 8 && j9.windowSeconds === 60, JSON.stringify(j9));

  const otherIp = await signedCheck('/api/ai', '198.51.100.9');
  const otherJ = await otherIp.json();
  check('e2e: different IP unaffected', otherJ.allowed === true);

  const badSig = await signedCheck('/api/ai', '203.0.113.7', { secret: 'wrong-secret' });
  check('e2e: wrong HMAC secret -> 401', badSig.status === 401, `got ${badSig.status}`);

  const stale = await signedCheck('/api/ai', '203.0.113.7', { ts: Date.now() - 10 * 60_000 });
  check('e2e: stale timestamp -> 401', stale.status === 401, `got ${stale.status}`);

  const combined = await signedCheck(null, '/api/test-ai|192.0.2.55');
  const combinedJ = await combined.json().catch(() => null);
  // signedCheck stringifies route:null; combined-key parsing needs a raw call:
  void combined; void combinedJ;
  const body = JSON.stringify({ key: '/api/test-ai|192.0.2.55' });
  const ts = Date.now();
  const sig = await hmacHex(SECRET, `${ts}.${body}`);
  const rc = await worker.fetch(new Request('https://x/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Limiter-Timestamp': String(ts), 'X-Limiter-Signature': sig },
    body,
  }), env);
  const jc = await rc.json();
  check('e2e: combined "<route>|<ip>" key accepted', rc.status === 200 && jc.allowed === true && jc.limit === 10, JSON.stringify(jc));

  const noBinding = await worker.fetch(new Request('https://x/health'), {});
  check('health works without bindings', noBinding.status === 200);
  const body2 = JSON.stringify({ key: '1.2.3.4', route: '/api/ai' });
  const ts2 = Date.now();
  const sig2 = await hmacHex(SECRET, `${ts2}.${body2}`);
  const unconf = await worker.fetch(new Request('https://x/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Limiter-Timestamp': String(ts2), 'X-Limiter-Signature': sig2 },
    body: body2,
  }), {});
  check('missing secret -> 500 (fail-visible, Pages side fails open)', unconf.status === 500, `got ${unconf.status}`);
}

console.log(failures === 0 ? 'LIMITER TEST: PASS' : `LIMITER TEST: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
