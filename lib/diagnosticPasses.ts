// Diagnostic passes (Phase DA3) — named AOV-style extraction of
// per-particle quantities for diagnosis only.
//
// This module is a REGISTRY + CPU REFERENCE ENCODER. It is deliberately
// not imported by any rendering / simulation module: the normal draw
// path cannot observe it, which is the structural half of the
// "diagnostics off ⇒ identical output" argument (see DA3_DESIGN.md).
// The encoder operates on plain readback buffers of the shape the app
// already produces:
//   positions:  Float32Array, texSize*texSize*4, RGBA = (x, y, z, age)
//               — the layout readbackParticlePositions() in
//               components/gpgpuDiagnostics.ts fills.
//   velocities: Float32Array, same length, RGBA = (vx, vy, vz, phase)
//               — the velocity render target's layout. No CPU readback
//               of it exists yet; the encoder accepts the buffer when a
//               caller supplies one and refuses (loudly) otherwise.
//
// Quantities mirror what the points vertex shader already derives for
// the normal draw (components/gpgpuShaderPoints.ts: vSpeed = length of
// velocity, vNormAge = age / uAgeMax), so the GPU route (next round)
// and this CPU reference must agree by construction, not by tuning.

export type DiagnosticPassKind = 'scalar' | 'vector3';
export type DiagnosticPassSource = 'position' | 'velocity' | 'derived';
export type DiagnosticPassAvailability =
  /** Encodable today from a buffer the app can already read back. */
  | 'readback'
  /** Encodable by the CPU reference encoder once the caller supplies
   *  the source buffer; no in-app readback wiring exists yet. */
  | 'cpu-reference'
  /** Defined and named, but needs a GPU accumulation step that does
   *  not exist yet. Asking the encoder for it is an error, by design:
   *  a silently blank diagnostic is worse than a loud refusal. */
  | 'deferred';

export interface DiagnosticPassDefinition {
  id: string;
  label: string;
  kind: DiagnosticPassKind;
  source: DiagnosticPassSource;
  availability: DiagnosticPassAvailability;
  /** What one output element means, in one line. */
  semantics: string;
}

export const DIAGNOSTIC_PASSES: readonly DiagnosticPassDefinition[] = [
  {
    id: 'age',
    label: 'Age (normalized)',
    kind: 'scalar',
    source: 'position',
    availability: 'readback',
    semantics: 'clamp(age / ageMax, 0, 1); age is position texture A.',
  },
  {
    id: 'speed',
    label: 'Speed (normalized)',
    kind: 'scalar',
    source: 'velocity',
    availability: 'cpu-reference',
    semantics: 'clamp(|velocity.xyz| / speedMax, 0, 1).',
  },
  {
    id: 'position',
    label: 'World position',
    kind: 'vector3',
    source: 'position',
    availability: 'readback',
    semantics: 'position texture RGB, unmodified.',
  },
  {
    id: 'velocity',
    label: 'Velocity vector',
    kind: 'vector3',
    source: 'velocity',
    availability: 'cpu-reference',
    semantics: 'velocity texture RGB, unmodified.',
  },
  {
    id: 'density',
    label: 'Local density',
    kind: 'scalar',
    source: 'derived',
    availability: 'deferred',
    semantics:
      'Neighbourhood density around each particle. Needs a GPU accumulation/grid pass; not stored in any current target.',
  },
];

const PASS_BY_ID = new Map(DIAGNOSTIC_PASSES.map((pass) => [pass.id, pass]));

export function listDiagnosticPassIds(): string[] {
  return DIAGNOSTIC_PASSES.map((pass) => pass.id);
}

export function getDiagnosticPass(id: string): DiagnosticPassDefinition | undefined {
  return PASS_BY_ID.get(id);
}

export interface DiagnosticEncodeParams {
  /** Normalizer for the age pass. <= 0 ⇒ raw age seconds are returned. */
  ageMax: number;
  /** Normalizer for the speed pass. <= 0 ⇒ normalize by the observed
   *  maximum speed in the supplied buffer (documented, deterministic
   *  for a fixed buffer). */
  speedMax: number;
}

export interface DiagnosticScalarStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p99: number;
}

export interface DiagnosticPassResult {
  passId: string;
  kind: DiagnosticPassKind;
  /** 1 for scalar passes, 3 for vector3 passes. */
  components: 1 | 3;
  /** Interleaved per-particle values, length = particleCount * components. */
  values: Float32Array;
  /** Scalar passes: stats of the values. Vector passes: stats of the
   *  per-particle vector magnitude. */
  stats: DiagnosticScalarStats;
}

export function computeScalarStats(values: ArrayLike<number>): DiagnosticScalarStats {
  const count = values.length;
  if (count === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p99: 0 };
  }
  const sorted = Float32Array.from(values as ArrayLike<number>).sort();
  let sum = 0;
  for (let i = 0; i < count; i += 1) sum += sorted[i];
  const pick = (q: number) => sorted[Math.min(count - 1, Math.floor(q * count))];
  return {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    mean: sum / count,
    p50: pick(0.5),
    p99: pick(0.99),
  };
}

function requireBuffer(
  pass: DiagnosticPassDefinition,
  buffers: { positions?: Float32Array | null; velocities?: Float32Array | null },
): Float32Array {
  const buffer = pass.source === 'position' ? buffers.positions : buffers.velocities;
  if (!buffer) {
    throw new Error(
      `diagnostic pass "${pass.id}" needs the ${pass.source} buffer, which was not supplied`,
    );
  }
  if (buffer.length % 4 !== 0) {
    throw new Error(
      `diagnostic pass "${pass.id}": ${pass.source} buffer length ${buffer.length} is not a multiple of 4 (RGBA texels)`,
    );
  }
  return buffer;
}

/**
 * CPU reference encoder. Pure: it reads the supplied buffers and
 * allocates its own output; it never writes into the inputs and holds
 * no state between calls.
 */
export function encodeDiagnosticPass(
  id: string,
  buffers: { positions?: Float32Array | null; velocities?: Float32Array | null },
  params: DiagnosticEncodeParams,
): DiagnosticPassResult {
  const pass = PASS_BY_ID.get(id);
  if (!pass) {
    throw new Error(
      `unknown diagnostic pass "${id}". Available: ${listDiagnosticPassIds().join(', ')}`,
    );
  }
  if (pass.availability === 'deferred') {
    throw new Error(
      `diagnostic pass "${pass.id}" is defined but deferred: ${pass.semantics}`,
    );
  }
  const buffer = requireBuffer(pass, buffers);
  const particleCount = buffer.length / 4;

  if (pass.kind === 'vector3') {
    const values = new Float32Array(particleCount * 3);
    const magnitudes = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      const x = buffer[i * 4];
      const y = buffer[i * 4 + 1];
      const z = buffer[i * 4 + 2];
      values[i * 3] = x;
      values[i * 3 + 1] = y;
      values[i * 3 + 2] = z;
      magnitudes[i] = Math.hypot(x, y, z);
    }
    return { passId: pass.id, kind: pass.kind, components: 3, values, stats: computeScalarStats(magnitudes) };
  }

  const values = new Float32Array(particleCount);
  if (pass.id === 'age') {
    const ageMax = params.ageMax;
    for (let i = 0; i < particleCount; i += 1) {
      const age = buffer[i * 4 + 3];
      values[i] = ageMax > 0 ? Math.min(1, Math.max(0, age / ageMax)) : age;
    }
  } else if (pass.id === 'speed') {
    let speedMax = params.speedMax;
    if (speedMax <= 0) {
      speedMax = 0;
      for (let i = 0; i < particleCount; i += 1) {
        const s = Math.hypot(buffer[i * 4], buffer[i * 4 + 1], buffer[i * 4 + 2]);
        if (s > speedMax) speedMax = s;
      }
      if (speedMax <= 0) speedMax = 1; // all-zero velocities: avoid 0/0, values stay 0
    }
    for (let i = 0; i < particleCount; i += 1) {
      const s = Math.hypot(buffer[i * 4], buffer[i * 4 + 1], buffer[i * 4 + 2]);
      values[i] = Math.min(1, Math.max(0, s / speedMax));
    }
  } else {
    // Registry/encoder drift guard: a scalar pass with no encoder must
    // fail loudly instead of returning zeros.
    throw new Error(`diagnostic pass "${pass.id}" has no CPU reference encoder`);
  }
  return { passId: pass.id, kind: pass.kind, components: 1, values, stats: computeScalarStats(values) };
}
