/**
 * Display metadata for the GPGPU force chunks (TD §7 stage 2,
 * Phase 34). The chunk set and default order live in
 * lib/gpgpuForceOrder.ts; this module adds, per chunk, the
 * panel label, whether the chunk is variant-gated (spliced
 * into the shader only while its enable key is on), a note
 * for the chunks whose relative order changes the result,
 * and a pure readout of whether the force is currently
 * active under a given config.
 *
 * Activity is governed by keys that are independent of the
 * order key — the order editor only permutes; it never
 * enables or disables. 'derived' means the panel cannot
 * decide activity from config alone (slope follows the
 * terrain texture's existence at runtime).
 */
import type { ParticleConfig } from '../types';
import type { GpgpuForceChunkName } from './gpgpuForceOrder';
import { fieldInstancesActive } from './gpgpuFieldInstances';
import { relDragActive } from './gpgpuSpeedDragSpin';
import { meanderStandaloneActive } from './gpgpuMeander';
import { genericSurfaceTensionActive } from './gpgpuLifecycle';

export type ForceChunkActivity = 'active' | 'inactive' | 'derived';

export interface GpgpuForceChunkMeta {
  name: GpgpuForceChunkName;
  label: string;
  /** Spliced into the shader string only while its enable key is on. */
  variantGated: boolean;
  /** Why this chunk's relative order matters, when it does. */
  orderNote?: string;
}

const ASSIGN_NOTE = 'vel を代入で置き換えるため、このチャンクより前に蓄積された速度は捨てられます（space mode 1/2 のとき）';
const READ_NOTE = '現在の vel を読むため、前に置いたフォースの蓄積が効き方に影響します';

export const GPGPU_FORCE_CHUNK_META: readonly GpgpuForceChunkMeta[] = [
  { name: 'pyro-buoyancy', label: 'Pyro Buoyancy', variantGated: false },
  { name: 'turbulence', label: 'Turbulence', variantGated: false },
  { name: 'audio-blast', label: 'Audio Blast', variantGated: false },
  { name: 'nbody', label: 'N-Body', variantGated: false },
  { name: 'curl', label: 'Curl', variantGated: false },
  { name: 'pyro-disturbance', label: 'Pyro Disturbance', variantGated: false },
  { name: 'boids', label: 'Boids', variantGated: false },
  { name: 'kuramoto', label: 'Kuramoto', variantGated: false },
  { name: 'particle-life', label: 'Particle Life', variantGated: false, orderNote: '蓄積した vel を減衰させ、上限を超えるとクランプします。前にあるフォースだけが対象になります' },
  { name: 'attractor', label: 'Attractor', variantGated: false, orderNote: ASSIGN_NOTE },
  { name: 'attractor-2', label: 'Attractor 2', variantGated: true, orderNote: ASSIGN_NOTE },
  { name: 'attractor-3', label: 'Attractor 3', variantGated: true, orderNote: ASSIGN_NOTE },
  { name: 'attractor-4', label: 'Attractor 4', variantGated: true, orderNote: ASSIGN_NOTE },
  { name: 'levy', label: 'Lévy', variantGated: false },
  { name: 'vortex', label: 'Vortex', variantGated: false },
  { name: 'wind', label: 'Wind', variantGated: false },
  { name: 'wind-volume', label: 'Wind Volume', variantGated: false },
  { name: 'slope', label: 'Slope', variantGated: false },
  { name: 'well', label: 'Well', variantGated: false },
  { name: 'elastic', label: 'Elastic', variantGated: false },
  { name: 'magnetic', label: 'Magnetic', variantGated: false, orderNote: READ_NOTE },
  { name: 'steer-avoid', label: 'Steer Avoid', variantGated: false },
  { name: 'steer-seek', label: 'Steer Seek', variantGated: true, orderNote: READ_NOTE },
  { name: 'field-instances', label: 'Field Instances', variantGated: true },
  { name: 'rel-drag', label: 'Relative Drag', variantGated: true },
  { name: 'meander', label: 'Meander', variantGated: true },
  { name: 'surface-tension', label: 'Surface Tension (generic)', variantGated: true, orderNote: READ_NOTE },
];

const META_BY_NAME = new Map(GPGPU_FORCE_CHUNK_META.map((m) => [m.name, m]));

export function gpgpuForceChunkMeta(name: GpgpuForceChunkName): GpgpuForceChunkMeta {
  return META_BY_NAME.get(name)!;
}

/**
 * Whether the force currently contributes, read from the
 * config keys that guard it (mirrors the survey table in
 * TD7_STAGE2_SURVEY_FORCE.md §3). This is a display readout
 * only; the shader guards remain the source of truth.
 */
export function resolveForceChunkActive(name: GpgpuForceChunkName, config: ParticleConfig): ForceChunkActivity {
  const on = (v: boolean) => (v ? 'active' : 'inactive') as ForceChunkActivity;
  switch (name) {
    case 'pyro-buoyancy': return on(config.gpgpuPyroEnabled);
    case 'turbulence': return on(config.gpgpuTurbulence > 0.001);
    case 'audio-blast': return on(config.gpgpuAudioReactive && config.audioEnabled);
    case 'nbody': return on(config.gpgpuNBodyEnabled);
    case 'curl': return on(config.gpgpuCurlEnabled);
    case 'pyro-disturbance': return on(config.gpgpuPyroEnabled && config.gpgpuPyroDisturbance > 0);
    case 'boids': return on(config.gpgpuBoidsEnabled);
    case 'kuramoto': return on(config.gpgpuKuramotoEnabled);
    case 'particle-life': return on(config.gpgpuParticleLifeEnabled);
    case 'attractor': return on(config.gpgpuAttractorEnabled);
    case 'attractor-2': return on(config.gpgpuAttractor2Enabled);
    case 'attractor-3': return on(config.gpgpuAttractor3Enabled);
    case 'attractor-4': return on(config.gpgpuAttractor4Enabled);
    case 'levy': return on(config.gpgpuLevyEnabled);
    case 'vortex': return on(config.gpgpuVortexEnabled);
    case 'wind': return on(config.gpgpuWindEnabled);
    case 'wind-volume': return on(config.gpgpuWindVolumeEnabled);
    case 'slope': return 'derived';
    case 'well': return on(config.gpgpuWellEnabled);
    case 'elastic': return on(config.gpgpuElasticEnabled);
    case 'magnetic': return on(config.gpgpuMagneticEnabled);
    case 'steer-avoid': return on(config.gpgpuSteerAvoid > 0 && config.gpgpuSdfEnabled);
    case 'steer-seek': return on(config.gpgpuSteerSeekEnabled);
    case 'field-instances': return on(fieldInstancesActive(config));
    case 'rel-drag': return on(relDragActive(config));
    case 'meander': return on(meanderStandaloneActive(config));
    case 'surface-tension': return on(genericSurfaceTensionActive(config));
    default: return 'inactive';
  }
}
