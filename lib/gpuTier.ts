// GPU tier system (2026-11-11): classifies the visitor's GPU into one of
// four tiers so heavy features can (a) pick defaults that fit the machine
// and (b) warn — never block — when a feature recommends a stronger GPU.
//
// Detection = renderer-string table (documented below) first; when the
// string is unknown, a short WebGL micro-benchmark decides. The result is
// cached in localStorage ('kalokagathia.gpuTier.v1'); a manual override
// (GPU Diagnostics section in the Play tab) always wins and doubles as
// the test hook. The owner's iMac (Radeon Pro 5500 XT) classifies as
// 'standard' by table, which reproduces the shipped behaviour exactly:
// raymarch defaults 0.5/64 and MAX_GPGPU_TEX_SIZE 512.
//
// This module must stay dependency-free and safe to import at module
// scope in non-browser contexts (verify scripts run under node): every
// window/localStorage/document access is guarded.

export type GpuTier = 'entry' | 'standard' | 'high' | 'flagship';

export const GPU_TIER_ORDER: Record<GpuTier, number> = {
  entry: 0,
  standard: 1,
  high: 2,
  flagship: 3,
};

export const GPU_TIER_LABELS_JA: Record<GpuTier, string> = {
  entry: 'エントリー',
  standard: '標準',
  high: '高性能',
  flagship: 'フラッグシップ',
};

export const GPU_TIER_STORAGE_KEY = 'kalokagathia.gpuTier.v1';

export type GpuTierDetectionSource = 'renderer-table' | 'benchmark' | 'software' | 'fallback';

export interface GpuTierInfo {
  /** Effective tier: manual override when set, otherwise the detected tier. */
  tier: GpuTier;
  detectedTier: GpuTier;
  renderer: string | null;
  source: GpuTierDetectionSource;
  /** Average ms per benchmark frame when the benchmark ran, else null. */
  benchmarkMs: number | null;
  override: GpuTier | null;
}

interface GpuTierCache {
  detectedTier: GpuTier;
  renderer: string | null;
  source: GpuTierDetectionSource;
  benchmarkMs: number | null;
  override: GpuTier | null;
}

const FALLBACK_INFO: GpuTierInfo = {
  tier: 'standard',
  detectedTier: 'standard',
  renderer: null,
  source: 'fallback',
  benchmarkMs: null,
  override: null,
};

function isGpuTier(value: unknown): value is GpuTier {
  return value === 'entry' || value === 'standard' || value === 'high' || value === 'flagship';
}

function readCache(): GpuTierCache | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GPU_TIER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GpuTierCache>;
    if (!isGpuTier(parsed.detectedTier)) return null;
    return {
      detectedTier: parsed.detectedTier,
      renderer: typeof parsed.renderer === 'string' ? parsed.renderer : null,
      source: parsed.source === 'benchmark' || parsed.source === 'software' || parsed.source === 'renderer-table'
        ? parsed.source
        : 'fallback',
      benchmarkMs: typeof parsed.benchmarkMs === 'number' ? parsed.benchmarkMs : null,
      override: isGpuTier(parsed.override) ? parsed.override : null,
    };
  } catch {
    return null;
  }
}

function writeCache(cache: GpuTierCache): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GPU_TIER_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full/blocked: detection simply re-runs next load.
  }
}

// ---------------------------------------------------------------------------
// Renderer-string classification table.
//
// Rules are evaluated in order, first match wins, case-insensitive against
// the UNMASKED_RENDERER_WEBGL string (ANGLE-wrapped on most platforms).
// Ordering notes:
//  - software renderers are caught before everything (they are 'entry'
//    regardless of the name they report);
//  - 'Radeon Pro' workstation cards (incl. the owner's Radeon Pro
//    5500 XT) are 'standard' — the app's heavy paths were tuned on
//    exactly that class;
//  - Apple M-series: Max/Ultra 'flagship', Pro and base chips 'high'
//    (their integrated GPUs outrun most discrete 'standard' cards);
//  - Apple A-series (iPhone/iPad) and pre-Iris Intel integrated are
//    'entry' (thermal limits make sustained heavy rendering unrealistic);
//  - unknown strings return null and fall through to the benchmark.
// ---------------------------------------------------------------------------

const SOFTWARE_PATTERN = /swiftshader|llvmpipe|softpipe|basic render|software/i;

interface TierRule {
  pattern: RegExp;
  tier: GpuTier;
}

const TIER_RULES: TierRule[] = [
  // Flagship: current high-end discrete + Apple Max/Ultra.
  { pattern: /rtx\s?5090|rtx\s?5080|rtx\s?4090|rtx\s?4080/, tier: 'flagship' },
  { pattern: /radeon.*7900|rx\s?7900/, tier: 'flagship' },
  { pattern: /apple m\d+\s?(max|ultra)/, tier: 'flagship' },
  // High: upper-mid discrete (RTX 3060–4070 class, RX 6700–7800 class),
  // Apple M base/Pro, Intel Arc A7xx.
  { pattern: /rtx\s?4070|rtx\s?4060|rtx\s?3070|rtx\s?3060/, tier: 'high' },
  { pattern: /radeon.*7[6-8]00|rx\s?7[6-8]00/, tier: 'high' },
  { pattern: /radeon.*6[7-9]00|rx\s?6[7-9]00/, tier: 'high' },
  { pattern: /apple m\d+/, tier: 'high' },
  { pattern: /arc.*a7\d0/, tier: 'high' },
  // Standard: the tuned-for class — Radeon Pro workstation, RDNA1 /
  // lower RDNA2, GTX 16-series, RTX 20-series / 3050, Iris Xe, and the
  // generic 'Apple GPU' string some Safari builds report.
  { pattern: /radeon pro/, tier: 'standard' },
  { pattern: /radeon.*5\d00|rx\s?5\d00/, tier: 'standard' },
  { pattern: /radeon.*6600|rx\s?6600/, tier: 'standard' },
  { pattern: /rtx\s?3050|rtx\s?20\d0|gtx\s?16\d0/, tier: 'standard' },
  { pattern: /iris.*xe|xe graphics/, tier: 'standard' },
  { pattern: /apple gpu/, tier: 'standard' },
  // Entry: older Intel integrated, Apple A-series, mobile GPUs.
  { pattern: /apple a\d+/, tier: 'entry' },
  { pattern: /intel.*(hd|uhd) graphics/, tier: 'entry' },
  { pattern: /gtx\s?1050|gtx\s?1030/, tier: 'entry' },
  { pattern: /adreno|mali|powervr|geforce\s?(mx|940|930)/, tier: 'entry' },
];

export function isSoftwareRendererString(renderer: string | null): boolean {
  return renderer !== null && SOFTWARE_PATTERN.test(renderer);
}

/** Classify a renderer string; null when the table has no opinion. */
export function classifyRendererString(renderer: string | null): GpuTier | null {
  if (!renderer) return null;
  if (isSoftwareRendererString(renderer)) return 'entry';
  const haystack = renderer.toLowerCase();
  for (const rule of TIER_RULES) {
    if (rule.pattern.test(haystack)) return rule.tier;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Micro-benchmark (only for unknown renderer strings): a fragment-heavy
// fullscreen pass on a throwaway 512x512 canvas; average ms per frame
// over 24 measured frames after warmup, timed with gl.finish().
// Thresholds are heuristic (documented, deliberately conservative):
//   < 2.5ms flagship · < 6ms high · < 14ms standard · otherwise entry.
// ---------------------------------------------------------------------------

const BENCHMARK_THRESHOLDS_MS = { flagship: 2.5, high: 6, standard: 14 } as const;

export function classifyBenchmarkMs(msPerFrame: number): GpuTier {
  if (msPerFrame < BENCHMARK_THRESHOLDS_MS.flagship) return 'flagship';
  if (msPerFrame < BENCHMARK_THRESHOLDS_MS.high) return 'high';
  if (msPerFrame < BENCHMARK_THRESHOLDS_MS.standard) return 'standard';
  return 'entry';
}

const BENCH_VERTEX = `#version 300 es
void main() { gl_Position = vec4(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2), 0.0, 1.0) * 2.0 - 1.0; }`;

const BENCH_FRAGMENT = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy / 512.0 * 6.28318 + uSeed;
  float acc = 0.0;
  for (int i = 0; i < 60; i++) {
    float f = float(i) * 0.37 + 1.0;
    acc += sin(p.x * f + acc) * cos(p.y * f - acc);
    acc = fract(acc * 1.618 + 0.31) * 2.0 - 1.0;
  }
  outColor = vec4(vec3(acc * 0.5 + 0.5), 1.0);
}`;

export function runGpuMicroBenchmark(): number | null {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, BENCH_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, BENCH_FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const seedLocation = gl.getUniformLocation(program, 'uSeed');
    const draw = (seed: number) => {
      gl.uniform1f(seedLocation, seed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.finish();
    };
    for (let i = 0; i < 4; i += 1) draw(i * 0.13);
    const frames = 24;
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) draw(1 + i * 0.13);
    const elapsed = performance.now() - start;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return elapsed / frames;
  } catch {
    return null;
  }
}

/** Synchronous renderer-string probe (mirrors lib/gpuDiagnostics.ts). */
export function probeRendererString(): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return null;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    let renderer: string | null = null;
    if (debugInfo) {
      renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '') || null;
    }
    if (!renderer) {
      renderer = String(gl.getParameter(gl.RENDERER) ?? '') || null;
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Runtime store: one detection per session, override applied on top.
// ---------------------------------------------------------------------------

let currentInfo: GpuTierInfo = (() => {
  const cache = readCache();
  if (!cache) return FALLBACK_INFO;
  return {
    tier: cache.override ?? cache.detectedTier,
    detectedTier: cache.detectedTier,
    renderer: cache.renderer,
    source: cache.source,
    benchmarkMs: cache.benchmarkMs,
    override: cache.override,
  };
})();

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeGpuTier(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getGpuTierInfo(): GpuTierInfo {
  return currentInfo;
}

/**
 * Effective tier resolved synchronously (in-memory state, else the
 * localStorage cache, else 'standard'). Used by non-React code paths
 * (config defaults, tex-size caps) that run before/around detection.
 */
export function resolveEffectiveTierSync(): GpuTier {
  if (currentInfo !== FALLBACK_INFO || readCache()) return currentInfo.tier;
  return 'standard';
}

let detectionStarted = false;

/** Run detection once (subsequent calls are no-ops). Safe anywhere. */
export function initGpuTier(): void {
  if (detectionStarted) return;
  detectionStarted = true;
  const cached = readCache();
  if (cached) {
    // Cache is already reflected in currentInfo; nothing to re-measure.
    return;
  }
  const renderer = probeRendererString();
  const byTable = classifyRendererString(renderer);
  if (byTable !== null) {
    const source: GpuTierDetectionSource = isSoftwareRendererString(renderer) ? 'software' : 'renderer-table';
    const cache: GpuTierCache = { detectedTier: byTable, renderer, source, benchmarkMs: null, override: null };
    writeCache(cache);
    currentInfo = { tier: byTable, detectedTier: byTable, renderer, source, benchmarkMs: null, override: null };
    notify();
    return;
  }
  const benchmarkMs = runGpuMicroBenchmark();
  const detectedTier: GpuTier = benchmarkMs !== null ? classifyBenchmarkMs(benchmarkMs) : 'standard';
  const source: GpuTierDetectionSource = benchmarkMs !== null ? 'benchmark' : 'fallback';
  const cache: GpuTierCache = { detectedTier, renderer, source, benchmarkMs, override: null };
  writeCache(cache);
  currentInfo = { tier: detectedTier, detectedTier, renderer, source, benchmarkMs, override: null };
  notify();
}

/** Force a fresh detection (clears the cache first). Used by 再検出. */
export function redetectGpuTier(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(GPU_TIER_STORAGE_KEY);
  } catch { /* ignore */ }
  const override = currentInfo.override;
  detectionStarted = false;
  currentInfo = { ...FALLBACK_INFO, override, tier: override ?? FALLBACK_INFO.tier };
  initGpuTier();
  if (override) setGpuTierOverride(override);
  notify();
}

export function setGpuTierOverride(override: GpuTier | null): void {
  const cache: GpuTierCache = {
    detectedTier: currentInfo.detectedTier,
    renderer: currentInfo.renderer,
    source: currentInfo.source,
    benchmarkMs: currentInfo.benchmarkMs,
    override,
  };
  writeCache(cache);
  currentInfo = { ...currentInfo, override, tier: override ?? currentInfo.detectedTier };
  notify();
}
