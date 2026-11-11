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

export async function encodeConfigPayload(name: string, config: unknown): Promise<string | null> {
  try {
    if (typeof CompressionStream === 'undefined') return null;
    const raw = new TextEncoder().encode(JSON.stringify({ name, config }));
    const packed = await pipeThrough(raw, new CompressionStream('deflate-raw'));
    return bytesToBase64Url(packed);
  } catch {
    return null;
  }
}

export async function decodeConfigPayload(
  payload: string,
): Promise<{ name?: string; config: Record<string, unknown> } | null> {
  try {
    if (typeof DecompressionStream === 'undefined') return null;
    const packed = base64UrlToBytes(payload);
    if (packed.length > 200_000) return null;
    const raw = await pipeThrough(packed, new DecompressionStream('deflate-raw'));
    if (raw.length > 2_000_000) return null;
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as { name?: unknown; config?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    const cfg = parsed.config;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      config: cfg as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
