import type { MotionDagNode, MotionDagNodeKind, ParticleConfig } from '../types';
import { MOTION_MAP } from '../components/sceneMotionMap';
import { isDedicatedSystemMotionType } from './motionChain';

/**
 * Motion DAGs (free-wiring stage 4): a free-form — but structurally
 * acyclic — node program evaluated after the motion graph section
 * (stage 3), when both are enabled, or right after the layer's own
 * stack when the graph is off.
 *
 * Registers: 0 = main (the position entering the DAG section),
 * 1 = source (the position that entered the layer's own stack), and
 * node i (0-based) writes register i + 2. A node's inputs may only
 * reference strictly earlier registers, so cycles cannot be expressed.
 * Node kinds: motion (apply a motion to inA), mix (lerp inA/inB by
 * param), scale (inA * param), source (the source register), copy (inA).
 *
 * Resolution is defensive, mirroring motionChain / motionRoute /
 * motionGraph: the DAG is empty unless enabled, unknown kinds/motions
 * are dropped, register references are clamped to valid earlier
 * registers, params are clamped per kind, at most
 * MOTION_DAG_MAX_NODES nodes are honoured, and the DAG does not apply
 * when the layer's stage 1 is a dedicated-system motion.
 */
export const MOTION_DAG_MAX_NODES = 16;

export interface ResolvedMotionDagNode {
  kind: MotionDagNodeKind;
  kindCode: number;
  motionCode: number;
  inA: number;
  inB: number;
  param: number;
}

export interface ResolvedMotionDag {
  nodes: ResolvedMotionDagNode[];
  /** Register id whose value leaves the DAG section. */
  output: number;
}

const KIND_CODES: Record<MotionDagNodeKind, number> = {
  motion: 0,
  mix: 1,
  scale: 2,
  source: 3,
  copy: 4,
};
const KINDS = new Set(Object.keys(KIND_CODES));

function clampRegister(value: unknown, maxRegister: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const v = Math.floor(value);
  return v < 0 ? 0 : v > maxRegister ? maxRegister : v;
}

export function resolveMotionDag(
  config: ParticleConfig,
  layerIndex: 2 | 3,
): ResolvedMotionDag | null {
  const enabled = layerIndex === 2 ? config.layer2MotionDagEnabled : config.layer3MotionDagEnabled;
  if (!enabled) return null;
  const stage1Types = layerIndex === 2
    ? (config.layer2MotionMix ? config.layer2Motions : [config.layer2Type])
    : (config.layer3MotionMix ? config.layer3Motions : [config.layer3Type]);
  if (stage1Types.some((t) => t && isDedicatedSystemMotionType(t))) return null;
  const raw = layerIndex === 2 ? config.layer2MotionDag : config.layer3MotionDag;
  if (!Array.isArray(raw)) return null;
  const nodes: ResolvedMotionDagNode[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const node = entry as MotionDagNode;
    if (typeof node.kind !== 'string' || !KINDS.has(node.kind)) continue;
    const kind = node.kind as MotionDagNodeKind;
    // This node writes register nodes.length + 2, so valid inputs are 0..nodes.length + 1.
    const maxRegister = nodes.length + 1;
    let motionCode = -1;
    if (kind === 'motion') {
      if (typeof node.motion !== 'string' || !(node.motion in MOTION_MAP)) continue;
      motionCode = MOTION_MAP[node.motion as keyof typeof MOTION_MAP];
    }
    let param = 0;
    if (typeof node.param === 'number' && Number.isFinite(node.param)) {
      param = kind === 'mix'
        ? Math.min(1, Math.max(0, node.param))
        : kind === 'scale'
          ? Math.min(3, Math.max(0, node.param))
          : node.param;
    } else if (kind === 'mix') {
      param = 0.5;
    } else if (kind === 'scale') {
      param = 1;
    }
    nodes.push({
      kind,
      kindCode: KIND_CODES[kind],
      motionCode,
      inA: clampRegister(node.inA, maxRegister),
      inB: clampRegister(node.inB, maxRegister),
      param,
    });
    if (nodes.length >= MOTION_DAG_MAX_NODES) break;
  }
  if (nodes.length === 0) return null;
  const rawOutput = layerIndex === 2 ? config.layer2MotionDagOutput : config.layer3MotionDagOutput;
  const lastRegister = nodes.length + 1;
  const output = typeof rawOutput === 'number' && Number.isFinite(rawOutput) && Math.floor(rawOutput) >= 0
    ? Math.min(Math.floor(rawOutput), lastRegister)
    : lastRegister;
  return { nodes, output };
}

/** DAG packed for the shader: nodes as [kindCode, inA, inB, param], motion codes separately. */
export function resolveMotionDagPacked(
  config: ParticleConfig,
  layerIndex: 2 | 3,
): { vec4s: [number, number, number, number][]; motions: number[]; count: number; output: number } {
  const dag = resolveMotionDag(config, layerIndex);
  const vec4s: [number, number, number, number][] = [];
  const motions: number[] = [];
  for (let i = 0; i < MOTION_DAG_MAX_NODES; i++) {
    const node = dag?.nodes[i];
    if (!node) {
      vec4s.push([3, 0, 0, 0]);
      motions.push(-1);
    } else {
      vec4s.push([node.kindCode, node.inA, node.inB, node.param]);
      motions.push(node.motionCode);
    }
  }
  return { vec4s, motions, count: dag ? dag.nodes.length : 0, output: dag ? dag.output : 0 };
}
