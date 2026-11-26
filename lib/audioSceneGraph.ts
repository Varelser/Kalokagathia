/**
 * Audio scene graph (TD §7 stage 2, Round 84 gap 5).
 *
 * Stage 1 (lib/audioRouting.ts) turned the central particle
 * wiring into data. The scene systems that read the analysed
 * levels directly — the burst drive shared by the scene
 * systems, the screen overlay drives, the camera rig input,
 * the hue shift and the line uniforms — kept their fixed
 * inline formulas. This module turns those five wirings into
 * data as well, stored in the `audioSceneGraph` config key
 * as JSON; '' means the default graph, which reproduces the
 * legacy direct formulas exactly (the identity is pinned by
 * scripts/phase44-audio-scene-graph.test.mjs against
 * reference copies of the legacy formulas).
 *
 * Model (design: round84 (5), #2):
 *   - Sources are the five analysed levels (bass / treble /
 *     pulse / bandA / bandB), shared with stage 1.
 *   - Outputs are the five direct consumers: burst, screen,
 *     camera, hue, line. Outputs are terminal (nothing reads
 *     them back), so cycles are structurally impossible and
 *     validation only checks membership.
 *   - An edge's weight is either a constant or a reference
 *     to an existing *Scale config key (optionally scaled):
 *     the camera's legacy input reads audioBeatScale and
 *     audioBurstScale as weights, so constants alone cannot
 *     reproduce it.
 *   - Each output's final gain stays bound to its legacy
 *     scale key, applied by the consumer exactly where the
 *     legacy formula applied it; the graph only edits which
 *     sources feed each output and at what weight. The hue
 *     output additionally carries a fixed node coefficient
 *     (0.3 in the legacy formula), applied by the consumer
 *     after its gain, in the legacy order.
 *   - The line output is the one exception on sources: it is
 *     evaluated inside applyParticleAudioUniforms, where the
 *     values at hand are the stage-1 inputs (already routed
 *     and gained), and the legacy line uniforms read those
 *     inputs. Its edges therefore read the stage-1 inputs;
 *     the other four outputs read the analysed levels, as
 *     their consumers always did.
 */
import type { ParticleConfigAudio } from '../types/configAudio';
import type { AudioRoutingInputs } from './audioRouting';

export type AudioSceneSourceId = 'bass' | 'treble' | 'pulse' | 'bandA' | 'bandB';
export type AudioSceneOutputId = 'burst' | 'screen' | 'camera' | 'hue' | 'line';

/** Config keys an edge may reference as its weight. */
export type AudioSceneWeightKey =
  | 'audioBeatScale' | 'audioJitterScale' | 'audioPulseScale'
  | 'audioBurstScale' | 'audioScreenScale' | 'audioCameraScale'
  | 'audioHueShiftScale' | 'audioLineScale'
  | 'audioMorphScale' | 'audioShatterScale' | 'audioTwistScale'
  | 'audioBendScale' | 'audioWarpScale';

export interface AudioSceneEdge {
  from: AudioSceneSourceId;
  /** Constant weight; used when weightKey is absent. */
  weight?: number;
  /** When set, the edge reads config[weightKey] as its weight;
   *  the contribution is (level × key) × (weightScale ?? 1). */
  weightKey?: AudioSceneWeightKey;
  weightScale?: number;
}

export interface AudioSceneOutput {
  /** Fixed node coefficient (hue: 0.3). Absent = 1. */
  coefficient?: number;
  edges: AudioSceneEdge[];
}

export interface AudioSceneGraph {
  outputs: Partial<Record<AudioSceneOutputId, AudioSceneOutput>>;
}

export interface AudioSceneOutputInfo {
  id: AudioSceneOutputId;
  label: string;
  /** Existing config key bound as this output's final gain. */
  gainKey: 'audioBurstScale' | 'audioScreenScale' | 'audioCameraScale' | 'audioHueShiftScale' | 'audioLineScale';
}

export const AUDIO_SCENE_SOURCES: readonly { id: AudioSceneSourceId; label: string }[] = [
  { id: 'bass', label: 'Bass' },
  { id: 'treble', label: 'Treble' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'bandA', label: 'Band A' },
  { id: 'bandB', label: 'Band B' },
];

export const AUDIO_SCENE_OUTPUTS: readonly AudioSceneOutputInfo[] = [
  { id: 'burst', label: 'Burst', gainKey: 'audioBurstScale' },
  { id: 'screen', label: 'Screen', gainKey: 'audioScreenScale' },
  { id: 'camera', label: 'Camera', gainKey: 'audioCameraScale' },
  { id: 'hue', label: 'Hue', gainKey: 'audioHueShiftScale' },
  { id: 'line', label: 'Line', gainKey: 'audioLineScale' },
];

export const AUDIO_SCENE_WEIGHT_KEYS: readonly AudioSceneWeightKey[] = [
  'audioBeatScale', 'audioJitterScale', 'audioPulseScale',
  'audioBurstScale', 'audioScreenScale', 'audioCameraScale',
  'audioHueShiftScale', 'audioLineScale',
  'audioMorphScale', 'audioShatterScale', 'audioTwistScale',
  'audioBendScale', 'audioWarpScale',
];

export const AUDIO_SCENE_MAX_EDGES_PER_OUTPUT = 8;
export const AUDIO_SCENE_WEIGHT_LIMIT = 4;

const SOURCE_IDS = new Set<string>(AUDIO_SCENE_SOURCES.map((s) => s.id));
const WEIGHT_KEY_SET = new Set<string>(AUDIO_SCENE_WEIGHT_KEYS);

/** The legacy direct formulas, as a graph. Edge order matters:
 *  the resolver sums in listed order so the default graph is
 *  bit-identical to the legacy inline formulas. */
export function defaultAudioSceneGraph(): AudioSceneGraph {
  return {
    outputs: {
      burst: { edges: [{ from: 'pulse', weight: 1 }] },
      screen: {
        edges: [
          { from: 'pulse', weight: 1 },
          { from: 'treble', weightKey: 'audioJitterScale' },
        ],
      },
      camera: {
        edges: [
          { from: 'bass', weightKey: 'audioBeatScale' },
          { from: 'pulse', weightKey: 'audioBurstScale', weightScale: 0.65 },
        ],
      },
      hue: {
        coefficient: 0.3,
        edges: [
          { from: 'bass', weight: 0.35 },
          { from: 'treble', weight: 0.2 },
          { from: 'pulse', weight: 0.45 },
        ],
      },
      line: {
        edges: [
          { from: 'bass', weight: 1 },
          { from: 'treble', weight: 1 },
        ],
      },
    },
  };
}

function edgeCanonical(edge: AudioSceneEdge): string {
  if (edge.weightKey) return `${edge.from}@key:${edge.weightKey}*${edge.weightScale ?? 1}`;
  return `${edge.from}@${edge.weight ?? 0}`;
}

function canonicalOutputs(graph: AudioSceneGraph): string {
  const parts: string[] = [];
  for (const output of AUDIO_SCENE_OUTPUTS) {
    const node = graph.outputs[output.id];
    const list = node?.edges ?? [];
    parts.push(`${output.id}#${node?.coefficient ?? 1}:${list.map(edgeCanonical).join(',')}`);
  }
  return parts.join('|');
}

export function isDefaultAudioSceneGraph(graph: AudioSceneGraph): boolean {
  return canonicalOutputs(graph) === canonicalOutputs(defaultAudioSceneGraph());
}

const clampWeight = (v: number): number =>
  Math.max(-AUDIO_SCENE_WEIGHT_LIMIT, Math.min(AUDIO_SCENE_WEIGHT_LIMIT, v));

/**
 * Parse the stored JSON into a validated graph. Anything
 * structurally wrong falls back to the default graph as a
 * whole; individually invalid edges (unknown source, unknown
 * weight key, duplicate source, non-finite numbers) are
 * dropped, mirroring the stage-1 discipline.
 */
export function parseAudioSceneGraph(text: string | undefined | null): AudioSceneGraph {
  if (!text) return defaultAudioSceneGraph();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaultAudioSceneGraph();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultAudioSceneGraph();
  const rawOutputs = (raw as { outputs?: unknown }).outputs;
  if (!rawOutputs || typeof rawOutputs !== 'object' || Array.isArray(rawOutputs)) {
    return defaultAudioSceneGraph();
  }
  const outputs: AudioSceneGraph['outputs'] = {};
  for (const output of AUDIO_SCENE_OUTPUTS) {
    const node = (rawOutputs as Record<string, unknown>)[output.id];
    if (node === undefined) continue;
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const rawEdges = (node as { edges?: unknown }).edges;
    if (!Array.isArray(rawEdges)) continue;
    const seen = new Set<string>();
    const valid: AudioSceneEdge[] = [];
    for (const item of rawEdges) {
      if (valid.length >= AUDIO_SCENE_MAX_EDGES_PER_OUTPUT) break;
      if (!item || typeof item !== 'object') continue;
      const from = (item as { from?: unknown }).from;
      if (typeof from !== 'string' || !SOURCE_IDS.has(from)) continue;
      if (seen.has(from)) continue;
      const weightKey = (item as { weightKey?: unknown }).weightKey;
      const weight = (item as { weight?: unknown }).weight;
      const weightScale = (item as { weightScale?: unknown }).weightScale;
      if (weightKey !== undefined) {
        if (typeof weightKey !== 'string' || !WEIGHT_KEY_SET.has(weightKey)) continue;
        const edge: AudioSceneEdge = { from: from as AudioSceneSourceId, weightKey: weightKey as AudioSceneWeightKey };
        if (weightScale !== undefined) {
          if (typeof weightScale !== 'number' || !Number.isFinite(weightScale)) continue;
          edge.weightScale = clampWeight(weightScale);
        }
        seen.add(from);
        valid.push(edge);
      } else {
        if (typeof weight !== 'number' || !Number.isFinite(weight)) continue;
        seen.add(from);
        valid.push({ from: from as AudioSceneSourceId, weight: clampWeight(weight) });
      }
    }
    const parsed: AudioSceneOutput = { edges: valid };
    const coefficient = (node as { coefficient?: unknown }).coefficient;
    if (coefficient !== undefined) {
      if (typeof coefficient !== 'number' || !Number.isFinite(coefficient)) continue;
      parsed.coefficient = clampWeight(coefficient);
    }
    outputs[output.id] = parsed;
  }
  return { outputs };
}

/** Serialise for storage; the default graph stores as '' (stage-1 precedent). */
export function serializeAudioSceneGraph(graph: AudioSceneGraph): string {
  if (isDefaultAudioSceneGraph(graph)) return '';
  const outputs: Record<string, AudioSceneOutput> = {};
  for (const output of AUDIO_SCENE_OUTPUTS) {
    const node = graph.outputs[output.id];
    if (!node) continue;
    const stored: AudioSceneOutput = {
      edges: node.edges.map((e) => {
        if (e.weightKey) {
          const edge: AudioSceneEdge = { from: e.from, weightKey: e.weightKey };
          if (e.weightScale !== undefined && e.weightScale !== 1) edge.weightScale = e.weightScale;
          return edge;
        }
        return { from: e.from, weight: e.weight ?? 0 };
      }),
    };
    if (node.coefficient !== undefined && node.coefficient !== 1) stored.coefficient = node.coefficient;
    outputs[output.id] = stored;
  }
  return JSON.stringify({ version: 1, outputs });
}

export interface AudioSceneLevels {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
}

export interface AudioSceneOutputValue {
  /** Sum of the edge contributions, in listed edge order (no coefficient, no gain). */
  sum: number;
  /** Per-source contributions (0 when the source has no edge). */
  parts: Record<AudioSceneSourceId, number>;
  /** The node's fixed coefficient (1 when absent). */
  coefficient: number;
}

/** One edge's contribution. For key-referenced weights the
 *  scale multiplies the contribution last — (level × key) ×
 *  scale — which is the legacy camera formula's association
 *  ((pulse × audioBurstScale) × 0.65); folding the scale into
 *  the weight first would drift by 1 ulp. */
function edgeContribution(edge: AudioSceneEdge, value: number, config: ParticleConfigAudio): number {
  if (edge.weightKey) return (value * config[edge.weightKey]) * (edge.weightScale ?? 1);
  return value * (edge.weight ?? 0);
}

/**
 * Evaluate one output. `sourceValue` supplies the level for a
 * source id — the caller decides whether that is the analysed
 * level or (for line) the stage-1 input.
 */
export function evaluateAudioSceneOutput(
  graph: AudioSceneGraph,
  output: AudioSceneOutputId,
  sourceValue: (source: AudioSceneSourceId) => number,
  config: ParticleConfigAudio,
): AudioSceneOutputValue {
  const node = graph.outputs[output];
  const parts: Record<AudioSceneSourceId, number> = { bass: 0, treble: 0, pulse: 0, bandA: 0, bandB: 0 };
  let sum = 0;
  if (node) {
    for (const edge of node.edges) {
      const contribution = edgeContribution(edge, sourceValue(edge.from), config);
      parts[edge.from] = contribution;
      sum += contribution;
    }
  }
  return { sum, parts, coefficient: node?.coefficient ?? 1 };
}

/**
 * Evaluate all five outputs for one frame. The line output
 * reads the stage-1 inputs (see the module header); pass null
 * for stage1Inputs only from contexts that never read line
 * (line then falls back to the analysed levels).
 */
export function resolveAudioSceneOutputs(
  graph: AudioSceneGraph,
  levels: AudioSceneLevels,
  stage1Inputs: AudioRoutingInputs | null,
  config: ParticleConfigAudio,
): Record<AudioSceneOutputId, AudioSceneOutputValue> {
  const fromLevels = (s: AudioSceneSourceId) => levels[s];
  const fromStage1 = (s: AudioSceneSourceId) => (stage1Inputs ? stage1Inputs[s] : levels[s]);
  return {
    burst: evaluateAudioSceneOutput(graph, 'burst', fromLevels, config),
    screen: evaluateAudioSceneOutput(graph, 'screen', fromLevels, config),
    camera: evaluateAudioSceneOutput(graph, 'camera', fromLevels, config),
    hue: evaluateAudioSceneOutput(graph, 'hue', fromLevels, config),
    line: evaluateAudioSceneOutput(graph, 'line', fromStage1, config),
  };
}

let cachedText: string | null = null;
let cachedGraph: AudioSceneGraph | null = null;

/** Parse with a single-entry memo, for the per-frame runtime path. */
export function resolveAudioSceneGraph(text: string | undefined | null): AudioSceneGraph {
  const key = text ?? '';
  if (cachedGraph !== null && cachedText === key) return cachedGraph;
  cachedText = key;
  cachedGraph = parseAudioSceneGraph(key);
  return cachedGraph;
}

/**
 * Convenience for the direct consumers: the (gain-free) sum
 * of one output from the analysed levels, using the graph
 * stored in the config. The consumer applies its legacy gain
 * key itself, at the legacy position in its formula.
 */
export function audioSceneOutputSum(
  config: ParticleConfigAudio,
  levels: AudioSceneLevels,
  output: AudioSceneOutputId,
): number {
  const graph = resolveAudioSceneGraph(config.audioSceneGraph);
  return evaluateAudioSceneOutput(graph, output, (s) => levels[s], config).sum;
}

/** Same, but the full value (parts + coefficient). */
export function audioSceneOutputValue(
  config: ParticleConfigAudio,
  levels: AudioSceneLevels,
  output: AudioSceneOutputId,
): AudioSceneOutputValue {
  const graph = resolveAudioSceneGraph(config.audioSceneGraph);
  return evaluateAudioSceneOutput(graph, output, (s) => levels[s], config);
}
