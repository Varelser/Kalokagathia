import type { PresetRecord } from '../types';
import {
  clearSessionUserParameters,
  sanitizeUserParameters,
  type UserParameterDeclaration,
} from './userParameters';

// Share links and shared-view mode.
//
// Link forms:
//   /share/<presetId>        static OGP page that redirects to /#p=<presetId>
//   /#p=<presetId>           apply a preset by id (bundled/local library first,
//                            otherwise fetched from /presets/<presetId>.json)
//   /#c=<base64url payload>  apply an inline config snapshot
//                            (JSON {name, config}, deflate-raw compressed)
//
// Opening the app through a share link enters "shared view": cost-bearing
// features (the AI relay, which spends the owner's API quota) stay off until
// the visitor explicitly switches to the full app.

type Listener = () => void;

let sharedView = false;
const listeners = new Set<Listener>();

export function isSharedView(): boolean {
  return sharedView;
}

export function enterSharedView(): void {
  if (sharedView) return;
  sharedView = true;
  listeners.forEach((fn) => fn());
}

export function exitSharedView(): void {
  if (!sharedView) return;
  sharedView = false;
  // Phase 18 stage 5: leaving shared view discards any declarations
  // that arrived bundled with the link (session-only overlay).
  clearSessionUserParameters();
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* history unavailable */
  }
  listeners.forEach((fn) => fn());
}

export function subscribeSharedView(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export type ShareHash =
  | { kind: 'preset'; id: string }
  | { kind: 'config'; payload: string };

export function parseShareHash(hash: string): ShareHash | null {
  const p = /^#p=([A-Za-z0-9._-]+)$/.exec(hash);
  if (p) return { kind: 'preset', id: p[1] };
  const c = /^#c=([A-Za-z0-9_-]+)$/.exec(hash);
  if (c) return { kind: 'config', payload: c[1] };
  return null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type AnyCompressionStream = CompressionStream | DecompressionStream;

async function pipeThrough(bytes: Uint8Array, stream: AnyCompressionStream): Promise<Uint8Array> {
  const transform = stream as unknown as TransformStream<Uint8Array, Uint8Array>;
  const buf = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(transform)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeConfigPayload(
  name: string,
  config: unknown,
  userParameters?: readonly UserParameterDeclaration[],
): Promise<string | null> {
  try {
    if (typeof CompressionStream === 'undefined') return null;
    // Phase 18 stage 5: bundle the author's User Parameter
    // declarations as an optional field. With zero (valid)
    // declarations the payload object is exactly {name, config},
    // so legacy links stay byte-identical. Sanitising here means
    // only declarations that pass lib/userParameters validation
    // ever ride the link (broken ones dropped, cap 32).
    const bundled = userParameters ? sanitizeUserParameters(userParameters) : [];
    const payloadObject = bundled.length > 0
      ? { name, config, userParameters: bundled }
      : { name, config };
    const raw = new TextEncoder().encode(JSON.stringify(payloadObject));
    const packed = await pipeThrough(raw, new CompressionStream('deflate-raw'));
    return bytesToBase64Url(packed);
  } catch {
    return null;
  }
}

/**
 * Fetch one catalog preset record from /presets/<id>.json — the exact
 * resolution step share links (/#p=<id>) use for presets that are not in
 * the bundled/local library. Returns null when the origin does not serve
 * a matching JSON record (unknown id, SPA-shell fallback, network error),
 * so callers can degrade quietly.
 */
export async function fetchCatalogPreset(presetId: string): Promise<PresetRecord | null> {
  try {
    const r = await fetch(`/presets/${encodeURIComponent(presetId)}.json`);
    if (!(r.headers.get('content-type') || '').includes('json')) return null;
    const rec = (await r.json()) as PresetRecord | null;
    if (rec && rec.id === presetId && rec.config && typeof rec.config === 'object') return rec;
    return null;
  } catch {
    return null;
  }
}

export interface DecodedConfigPayload {
  name?: string;
  config: Record<string, unknown>;
  /** Declarations bundled by a newer link; absent on legacy links. */
  userParameters?: UserParameterDeclaration[];
}

export async function decodeConfigPayload(
  payload: string,
): Promise<DecodedConfigPayload | null> {
  try {
    if (typeof DecompressionStream === 'undefined') return null;
    const packed = base64UrlToBytes(payload);
    if (packed.length > 200_000) return null;
    const raw = await pipeThrough(packed, new DecompressionStream('deflate-raw'));
    if (raw.length > 2_000_000) return null;
    // Forward/backward compatibility rests on this decoder reading
    // only the fields it knows: unknown JSON fields are ignored, so
    // an older build reads a new link's config exactly as before,
    // and this build reads legacy {name, config} payloads unchanged.
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as { name?: unknown; config?: unknown; userParameters?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    const cfg = parsed.config;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
    const result: DecodedConfigPayload = {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      config: cfg as Record<string, unknown>,
    };
    if (parsed.userParameters !== undefined) {
      result.userParameters = sanitizeUserParameters(parsed.userParameters);
    }
    return result;
  } catch {
    return null;
  }
}
