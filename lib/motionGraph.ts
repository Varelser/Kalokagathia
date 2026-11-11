import type { MotionGraphStep, ParticleConfig } from '../types';
import { MOTION_MAP } from '../components/sceneMotionMap';
import { isDedicatedSystemMotionType } from './motionChain';

/**
 * Motion graphs (free-wiring stage 3): a bounded step program evaluated
 * after a layer's own motion stack (its stage 1 + serial chain, with any
 * routed pre-stage from stage 2 applied before it).
 *
 * Registers: main (the running position), source (the position that entered
 * the layer's own stack), branch (a saved copy of main). Each step:
 *   1. if saveBranch, branch := main;
 *   2. inputPos := main | source | branch, per the step's input;
 *   3. main := mix(main, applyMotion(inputPos, motion, layer params), blend).
 * That gives fork (save) and merge (source/branch inputs with blend) — the
 * DAG essence chains cannot express — without replacing the update loops.
 *
 * Resolution is defensive, mirroring motionChain / motionRoute: the graph
 * is empty unless enabled, steps must name known motions, blend is clamped
 * to 0..1, at most MOTION_GRAPH_MAX_STEPS steps are honoured, and the graph
 * does not apply when the layer's stage 1 is a dedicated-system motion
 * (those layers never pass through the shared position evaluation).
 */
export const MOTION_GRAPH_MAX_STEPS = 8;

export type ResolvedMotionGraphStep = MotionGraphStep & { code: number };

const GRAPH_INPUTS = new Set(['prev', 'source', 'branch']);

export function resolveMotionGraphSteps(
  config: ParticleConfig,
  layerIndex: 2 | 3,
): ResolvedMotionGraphStep[] {
  const enabled = layerIndex === 2 ? config.layer2MotionGraphEnabled : config.layer3MotionGraphEnabled;
  if (!enabled) return [];
  const stage1Types = layerIndex === 2
    ? (config.layer2MotionMix ? config.layer2Motions : [config.layer2Type])
    : (config.layer3MotionMix ? config.layer3Motions : [config.layer3Type]);
  if (stage1Types.some((t) => t && isDedicatedSystemMotionType(t))) return [];
  const raw = layerIndex === 2 ? config.layer2MotionGraph : config.layer3MotionGraph;
  if (!Array.isArray(raw)) return [];
  const steps: ResolvedMotionGraphStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const motion = (entry as MotionGraphStep).motion;
    if (typeof motion !== 'string' || !(motion in MOTION_MAP)) continue;
    const input = GRAPH_INPUTS.has((entry as MotionGraphStep).input) ? (entry as MotionGraphStep).input : 'prev';
    const blendRaw = (entry as MotionGraphStep).blend;
    const blend = typeof blendRaw === 'number' && Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 1;
    steps.push({
      motion: motion as MotionGraphStep['motion'],
      input,
      blend,
      saveBranch: (entry as MotionGraphStep).saveBranch === true,
      code: MOTION_MAP[motion as keyof typeof MOTION_MAP],
    });
    if (steps.length >= MOTION_GRAPH_MAX_STEPS) break;
  }
  return steps;
}

/** Steps packed for the shader: [code, inputSelect(0 prev/1 source/2 branch), blend, saveFlag], padded to MAX. */
export function resolveMotionGraphVec4s(
  config: ParticleConfig,
  layerIndex: 2 | 3,
): { vec4s: [number, number, number, number][]; count: number } {
  const steps = resolveMotionGraphSteps(config, layerIndex);
  const vec4s: [number, number, number, number][] = [];
  for (let i = 0; i < MOTION_GRAPH_MAX_STEPS; i++) {
    const step = steps[i];
    if (!step) {
      vec4s.push([-1, 0, 1, 0]);
    } else {
      vec4s.push([
        step.code,
        step.input === 'source' ? 1 : step.input === 'branch' ? 2 : 0,
        step.blend,
        step.saveBranch ? 1 : 0,
      ]);
    }
  }
  return { vec4s, count: steps.length };
}
