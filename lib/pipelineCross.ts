/**
 * Pipeline cross-group finish + WebGPU reasoned disabling
 * (limit plan stage 5, slice S5).
 *
 * Decisions: STAGE5_DECISIONS.md.
 *   - 分岐E: cross-group influence defaults to the REP's
 *     snapshot semantics (a set-group / set-state transition
 *     is visible to other rules from the NEXT evaluation).
 *     A rule may individually designate same-evaluation
 *     timing (params.crossImmediate / params.timing
 *     'immediate'), realised as a 2-phase evaluation whose
 *     cost only designated configurations pay.
 *   - 分岐F: a configuration always SAVES; on the WebGPU
 *     route the parts that cannot run are disabled WITH
 *     reasons, never dropped silently.
 *
 * What the real code actually supplies (verified in this
 * slice — the prep inventory's §6.2 left this open):
 *
 * GROUP AGGREGATES. The REP condition supply is per-particle
 * only (vel / age / rad / t / state / den / sdf / hit / hits
 * / slots / g / x). There is NO group aggregate variable:
 * lib/gpgpuParticleRulesLive.ts records the design §5
 * downgrade explicitly — "group change is realised as
 * state-as-membership, group aggregates are out of scope".
 * What DOES exist is the CPU membership evaluation
 * (evaluateGpgpuGroup over the attribute bake), so the
 * aggregates in PIPELINE_GROUP_AGGREGATE_AVAILABILITY marked
 * 'twin' are computable on the CPU twin from membership +
 * per-particle rows — and only there. `centroid` is
 * 'unavailable': neither the twin inputs
 * (LiveRuleParticleInput carries slots + vars, no positions)
 * nor the REP supply carries particle positions. The
 * group-aggregate node's centroid output therefore has no
 * supply on either route and is reported, not faked.
 *
 * SAME-EVALUATION TIMING. The REP fragment itself (GLSL
 * and WGSL twins alike) is snapshot-only: every condition
 * reads the state carried in, transitions apply to the
 * returned state. A faithful same-evaluation form needs a
 * 2-phase evaluation (phase 1 evaluates the whole rule set
 * from the snapshot, phase 2 re-evaluates it reading phase
 * 1's state — the REP ping-pong run twice inside one step).
 * That 2-phase form is implemented on the CPU twin
 * (evaluatePipelineCrossStep), the designation is held
 * end-to-end (graph params -> compiler immediateRuleIds ->
 * persist, via the graph key), and — since the S5
 * follow-up — it is wired into the WebGL GPU REP: the
 * scene resolves the designation with resolveRepTwoPhase
 * below and, while a designated rule is live, runs
 * components/gpgpuRuleEvalPass.ts twice per evaluation
 * (the fracture readback reads the second run's target;
 * the predation hold pass still accumulates once per
 * evaluation). The WebGPU route is NOT 2-phased: the WGSL
 * REP stays snapshot-only there and the designation
 * surfaces as the note 'cross-immediate-snapshot-fallback'
 * (preserved, not disabled — see the coverage analysis
 * below). The diagnostic below proves the twin-level
 * contrast the gate's E4-b premise check needs.
 *
 * WEBGPU. Contrary to the prep inventory's older note, the
 * WebGPU route HAS a WGSL REP twin and a coverage predicate
 * (liveRulesWgslCoverable). The route falls back to WebGL
 * for the WHOLE rule set when any live rule is uncoverable;
 * analyzePipelineWebGpuCoverage attributes that verdict
 * back to individual graph nodes with structured reasons,
 * mirroring the predicate's own checks one by one so the
 * two can never drift apart silently (the test pins their
 * agreement). Note the value-type correction this implies:
 * StateId and Mask DO have a WGSL home (the WGSL REP writes
 * .g state and .r mask exactly like the fragment); Display
 * values are produced (.a) but their consumer reads the
 * WebGL REP texture, so display ACTIONS block the route.
 */

import {
  compilePipelineGraphToLiveRules,
  pipelineNodeCrossImmediate,
} from './pipelineCompiler';
import { parsePipelineGraph } from './pipelineGraph';
import type { PipelineGraph, PipelineValueType } from './pipelineGraph';
import {
  classifyLiveRules,
  evaluateLiveRuleStep,
  liveConditionWgsl,
  liveRuleConditionVariables,
  liveRulesWgslCoverable,
  type LiveParticleRule,
  type LiveRuleClassification,
  type LiveRuleParticleInput,
} from './gpgpuParticleRulesLive';
import { evaluateGpgpuGroup, type GpgpuGroupDef } from './gpgpuGroups';
import { astReferencesVariable } from './expression';
import { DENSITY_VAR_NAME } from './gpgpuDensity';

// ---------------------------------------------------------------------------
// Group aggregates (twin-level only — see the header)
// ---------------------------------------------------------------------------

export type PipelineGroupAggregateKind =
  | 'count' | 'fraction' | 'mean-slot' | 'max-slot' | 'mean-var' | 'max-var' | 'centroid';

export interface PipelineGroupAggregateAvailability {
  status: 'twin' | 'unavailable';
  reason: string;
}

export const PIPELINE_GROUP_AGGREGATE_AVAILABILITY:
Readonly<Record<PipelineGroupAggregateKind, PipelineGroupAggregateAvailability>> = {
  count: {
    status: 'twin',
    reason: 'Membership sum over evaluateGpgpuGroup on the CPU twin; no REP supply.',
  },
  fraction: {
    status: 'twin',
    reason: 'count / particle count on the CPU twin; no REP supply.',
  },
  'mean-slot': {
    status: 'twin',
    reason: 'Mean of a bake slot over the members, CPU twin only; no REP supply.',
  },
  'max-slot': {
    status: 'twin',
    reason: 'Max of a bake slot over the members, CPU twin only; no REP supply.',
  },
  'mean-var': {
    status: 'twin',
    reason: 'Mean of a caller-supplied per-particle variable over the members, CPU twin only.',
  },
  'max-var': {
    status: 'twin',
    reason: 'Max of a caller-supplied per-particle variable over the members, CPU twin only.',
  },
  centroid: {
    status: 'unavailable',
    reason: 'No position supply: twin inputs carry slots + vars only, and the REP reads no positions.',
  },
};

export type PipelineGroupAggregateSpec =
  | { kind: 'count' | 'fraction' | 'centroid' }
  | { kind: 'mean-slot' | 'max-slot'; slot: number }
  | { kind: 'mean-var' | 'max-var'; values: readonly number[] };

/**
 * Compute one aggregate of one group over the attribute
 * bake, on the CPU twin. Returns null when the group cannot
 * be evaluated, the aggregate kind is unavailable
 * (centroid), or a mean is taken over zero members. A count
 * over zero members is 0, not null.
 */
export function computePipelineGroupAggregate(
  defs: readonly GpgpuGroupDef[],
  groupId: string,
  attrData: Float32Array,
  count: number,
  spec: PipelineGroupAggregateSpec,
): number | null {
  if (PIPELINE_GROUP_AGGREGATE_AVAILABILITY[spec.kind].status !== 'twin') return null;
  const membership = evaluateGpgpuGroup(defs, groupId, attrData, count);
  if (!membership) return null;
  let members = 0;
  let sum = 0;
  let max = -Infinity;
  for (let i = 0; i < count; i += 1) {
    if (membership[i] !== 1) continue;
    members += 1;
    if (spec.kind === 'mean-slot' || spec.kind === 'max-slot') {
      const v = attrData[i * 4 + spec.slot] ?? 0;
      sum += v;
      if (v > max) max = v;
    } else if (spec.kind === 'mean-var' || spec.kind === 'max-var') {
      const v = spec.values[i] ?? 0;
      sum += v;
      if (v > max) max = v;
    }
  }
  switch (spec.kind) {
    case 'count': return members;
    case 'fraction': return count > 0 ? members / count : null;
    case 'mean-slot':
    case 'mean-var': return members > 0 ? sum / members : null;
    case 'max-slot':
    case 'max-var': return members > 0 ? max : null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Same-evaluation timing (分岐E): the 2-phase CPU twin
// ---------------------------------------------------------------------------

export interface PipelineCrossStepResult {
  /** The step's result (phase 2's when two phases ran). */
  mask: number;
  state: number;
  matched: string[];
  display: number;
  /** 1 = snapshot only, 2 = same-evaluation designation honoured. */
  phases: 1 | 2;
  /** Phase 1's state, when two phases ran (else null). */
  phase1State: number | null;
}

/**
 * Evaluate one live step with the same-evaluation
 * designation honoured: when at least one LIVE rule id is
 * designated (immediateRuleIds, from the compiler), the
 * whole set is evaluated twice — phase 2 reads phase 1's
 * returned state and carries phase 1's mask as its previous
 * mask (the true-kill latch continuity) — and phase 2's
 * result is the step's result. With no designation this is
 * exactly evaluateLiveRuleStep, one phase, unchanged.
 */
export function evaluatePipelineCrossStep(
  classified: readonly LiveRuleClassification[],
  input: LiveRuleParticleInput,
  groupDefs: readonly GpgpuGroupDef[] = [],
  immediateRuleIds: readonly string[] = [],
): PipelineCrossStepResult {
  const phase1 = evaluateLiveRuleStep(classified, input, groupDefs);
  const liveIds = new Set(
    classified.filter((e) => e.route === 'live').map((e) => e.rule.id),
  );
  const designated = immediateRuleIds.some((id) => liveIds.has(id));
  if (!designated) {
    return { ...phase1, phases: 1, phase1State: null };
  }
  const phase2Input: LiveRuleParticleInput = {
    ...input,
    vars: { ...input.vars, state: phase1.state },
    prevMask: phase1.mask,
  };
  const phase2 = evaluateLiveRuleStep(classified, phase2Input, groupDefs);
  return { ...phase2, phases: 2, phase1State: phase1.state };
}

export interface PipelineCrossDiagnosticStep {
  state: number;
  matched: string[];
  phases: 1 | 2;
}

export interface PipelineCrossDiagnostic {
  /** First step index at which the observer rule matched,
   *  or null when it never did within the run. This is the
   *  quantity the gate's E4-b premise check reads: 1 for
   *  the default (snapshot) form — the transition is
   *  observed one evaluation late — and 0 for the
   *  same-evaluation form. */
  firstObserverStep: number | null;
  steps: PipelineCrossDiagnosticStep[];
}

/**
 * Run a fixed input through repeated evaluations, feeding
 * each step's returned state (and mask, for the latch) into
 * the next, and record when the observer rule first
 * matches. The same classified set and inputs are used for
 * both timings; the only difference is immediateRuleIds.
 */
export function runPipelineCrossDiagnostic(
  classified: readonly LiveRuleClassification[],
  input: LiveRuleParticleInput,
  groupDefs: readonly GpgpuGroupDef[],
  observerRuleId: string,
  immediateRuleIds: readonly string[] = [],
  stepCount = 3,
): PipelineCrossDiagnostic {
  const steps: PipelineCrossDiagnosticStep[] = [];
  let state = typeof input.vars.state === 'number' && Number.isFinite(input.vars.state)
    ? input.vars.state : 0;
  let prevMask: number | undefined = input.prevMask;
  let firstObserverStep: number | null = null;
  for (let i = 0; i < stepCount; i += 1) {
    const stepInput: LiveRuleParticleInput = {
      ...input,
      vars: { ...input.vars, state },
      ...(prevMask !== undefined ? { prevMask } : {}),
    };
    const result = evaluatePipelineCrossStep(classified, stepInput, groupDefs, immediateRuleIds);
    steps.push({ state: result.state, matched: result.matched, phases: result.phases });
    if (firstObserverStep === null && result.matched.includes(observerRuleId)) {
      firstObserverStep = i;
    }
    state = result.state;
    prevMask = result.mask;
  }
  return { firstObserverStep, steps };
}

// ---------------------------------------------------------------------------
// Same-evaluation timing on the WebGL GPU REP: designation resolution
// ---------------------------------------------------------------------------

export interface RepTwoPhaseResolution {
  /** True when at least one designated rule classifies
   *  live in the effective rule list: the WebGL REP then
   *  runs twice per evaluation (the 2-phase form), and
   *  only designated configurations pay that cost (分岐E). */
  twoPhase: boolean;
  /** The designated rule ids the stored graph carries
   *  (the compiler's surface). Empty without a graph: the
   *  row-list form cannot carry the designation. */
  immediateRuleIds: string[];
  /** The designated ids that classify live in the
   *  effective (predation-merged) rule list — exactly the
   *  intersection evaluatePipelineCrossStep's phase
   *  decision makes, over the same classification. */
  liveImmediateRuleIds: string[];
}

/**
 * Resolve whether the WebGL REP must run its 2-phase form
 * for a configuration: parse the stored graph text
 * (config.gpgpuPipelineGraph), take the compiler's
 * immediateRuleIds, and intersect them with the ids that
 * classify LIVE in the effective rule list the REP is
 * actually built from (the predation-merged list). An
 * empty / absent / unparseable graph designates nothing,
 * and a designation on a rule that is not live (baked,
 * never, disabled, or absent from the effective list)
 * does not stand the second phase up — the same verdict
 * the CPU twin reaches in evaluatePipelineCrossStep. Pure:
 * the graph is only read, never modified.
 */
export function resolveRepTwoPhase(
  graphText: string | null | undefined,
  rules: readonly LiveParticleRule[],
  options: {
    names: readonly string[];
    names2: readonly string[];
    groupDefs?: readonly GpgpuGroupDef[];
    densityAvailable?: boolean;
  },
): RepTwoPhaseResolution {
  const none: RepTwoPhaseResolution = {
    twoPhase: false, immediateRuleIds: [], liveImmediateRuleIds: [],
  };
  if (typeof graphText !== 'string' || graphText.length === 0) return none;
  const graph = parsePipelineGraph(graphText);
  if (!graph) return none;
  const { immediateRuleIds } = compilePipelineGraphToLiveRules(graph);
  if (immediateRuleIds.length === 0) return none;
  const classified = classifyLiveRules(rules, {
    names: options.names,
    names2: options.names2,
    groupDefs: options.groupDefs ?? [],
    densityAvailable: options.densityAvailable,
  });
  const liveIds = new Set(
    classified.filter((e) => e.route === 'live').map((e) => e.rule.id),
  );
  const liveImmediateRuleIds = immediateRuleIds.filter((id) => liveIds.has(id));
  return {
    twoPhase: liveImmediateRuleIds.length > 0,
    immediateRuleIds: [...immediateRuleIds],
    liveImmediateRuleIds,
  };
}

// ---------------------------------------------------------------------------
// WebGPU reasoned disabling (分岐F)
// ---------------------------------------------------------------------------

export type PipelineWebGpuReasonSeverity = 'disable' | 'note';

export interface PipelineWebGpuReason {
  code: string;
  severity: PipelineWebGpuReasonSeverity;
  message: string;
}

export interface PipelineWebGpuNodeStatus {
  nodeId: string;
  kind: string;
  /** The compiled live rule id, when the node produced one. */
  ruleId: string | null;
  /** True when this node's contribution cannot run on the
   *  WebGPU route (the route falls back to WebGL). */
  disabled: boolean;
  reasons: PipelineWebGpuReason[];
}

export interface PipelineWebGpuCoverage {
  /** True when every part runs on the WebGPU route —
   *  pinned to liveRulesWgslCoverable over the compiled
   *  rules, so the analysis and the route predicate agree. */
  coverable: boolean;
  nodes: PipelineWebGpuNodeStatus[];
}

/** Value-type capability on the WebGPU route, from the
 *  WGSL REP twin's real supply (see the header note). */
export const PIPELINE_WEBGPU_TYPE_CAPABILITY:
Readonly<Record<PipelineValueType, { supported: boolean; reason: string }>> = {
  Scalar: { supported: true, reason: 'Attribute slots 0..3 and the sim variables are mirrored.' },
  Vec3: { supported: true, reason: 'Frame-start position / velocity storage buffers.' },
  Bool: { supported: true, reason: 'Condition bits (.b) are written by the WGSL REP.' },
  StateId: { supported: true, reason: 'State (.g) is written by the WGSL REP, as in the fragment.' },
  Mask: { supported: true, reason: 'The aggregate mask (.r) is written by the WGSL REP.' },
  Group: { supported: true, reason: 'Predicate-source group targets only; snapshot / composite targets fall back to baked on both routes.' },
  Display: { supported: false, reason: 'Display values are produced (.a) but their consumer reads the WebGL REP texture.' },
};

/** Condition variables with no WGSL home (the resolver in
 *  liveConditionWgsl returns null for each). */
const WGSL_HOMELESS_VARS: readonly string[] = [
  DENSITY_VAR_NAME, 'hit', 'hits', 'prey', 'pred', 'predhold', 'predage',
];

export interface PipelineWebGpuOptions {
  names?: readonly string[] | unknown;
  names2?: readonly string[] | unknown;
  groupDefs?: readonly GpgpuGroupDef[];
  attrDynamicActive?: boolean;
}

/**
 * Attribute the WebGPU route's coverage verdict to the
 * graph's nodes, with structured reasons. The graph itself
 * is never modified and always remains saveable (分岐F):
 * this is a pure analysis over the compiled rules, the
 * classification and the WGSL representability checks —
 * the same checks liveRulesWgslCoverable performs, kept in
 * lockstep by the S5 test.
 */
export function analyzePipelineWebGpuCoverage(
  graph: PipelineGraph,
  options: PipelineWebGpuOptions = {},
): PipelineWebGpuCoverage {
  const names = (options.names ?? []) as readonly string[];
  const names2 = (options.names2 ?? []) as readonly string[];
  const groupDefs = options.groupDefs ?? [];
  const compiled = compilePipelineGraphToLiveRules(graph);
  const classified = classifyLiveRules(compiled.rules, {
    names, names2, groupDefs, densityAvailable: true,
  });
  const byRuleId = new Map(classified.map((e) => [e.rule.id, e]));
  const slotVars = liveRuleConditionVariables(names, names2)
    .filter((name) => !['g', 'vel', 'age', 'rad', 'state', 'sdf', 'hit', 'hits', DENSITY_VAR_NAME].includes(name));

  const nodes: PipelineWebGpuNodeStatus[] = [];
  compiled.rules.forEach((rule, i) => {
    const nodeId = compiled.ruleNodeIds[i] ?? '';
    const node = graph.nodes.find((n) => n.id === nodeId);
    const reasons: PipelineWebGpuReason[] = [];
    const entry = byRuleId.get(rule.id);
    if (!entry || entry.route === 'never') {
      reasons.push({
        code: 'never-matches-either-route', severity: 'note',
        message: 'The condition does not compile; the rule is inert on both routes and blocks neither.',
      });
    } else if (entry.route === 'baked-fallback') {
      reasons.push({
        code: 'route-baked-fallback', severity: 'disable',
        message: `Classified baked-fallback (${entry.reason}); the WGSL REP has no counterpart for the baked approximation.`,
      });
    } else {
      if (entry.conditionAst) {
        if (liveConditionWgsl(entry.conditionAst, 'tgt', names, names2) === null) {
          const homeless = WGSL_HOMELESS_VARS.filter((v) => astReferencesVariable(entry.conditionAst!, v));
          const extSlots = [4, 5, 6, 7].filter((s) => astReferencesVariable(entry.conditionAst!, `slot${s}`));
          const parts = [
            ...homeless,
            ...extSlots.map((s) => `slot${s}`),
          ];
          reasons.push({
            code: 'condition-variable-no-wgsl-home', severity: 'disable',
            message: `The condition reads ${parts.length > 0 ? parts.join(' / ') : 'a variable'} with no WGSL home (density / contact / predation supplies and slots 4..7 exist on the WebGL route only).`,
          });
        }
        if (options.attrDynamicActive) {
          const read = slotVars.filter((v) => astReferencesVariable(entry.conditionAst!, v));
          if (read.length > 0) {
            reasons.push({
              code: 'attr-dynamic-slot-read', severity: 'disable',
              message: `While an attribute dynamic stage is active the WGSL REP reads the mirrored bake, so the slot-reading condition (${read.join(' / ')}) would diverge.`,
            });
          }
        }
      }
      if (rule.action.type === 'spawn' || rule.action.type === 'display') {
        reasons.push({
          code: 'action-consumer-off-route', severity: 'disable',
          message: rule.action.type === 'spawn'
            ? 'The spawn consumer (the Aux pool) is WebGL-only.'
            : 'The display consumer reads the WebGL REP texture.',
        });
      }
    }
    if (compiled.immediateRuleIds.includes(rule.id)) {
      reasons.push({
        code: 'cross-immediate-snapshot-fallback', severity: 'note',
        message: 'Same-evaluation timing is designated; the WGSL REP is snapshot-only, so on this route the rule evaluates with the default 1-step delay (the designation itself is preserved).',
      });
    }
    nodes.push({
      nodeId,
      kind: node?.kind ?? '',
      ruleId: rule.id,
      disabled: reasons.some((r) => r.severity === 'disable'),
      reasons,
    });
  });

  // Graph nodes that produced no rule can still carry a
  // route-relevant gap: a wired group-aggregate is twin-only
  // on EVERY route (reported by the compiler as an issue).
  for (const issue of compiled.issues) {
    if (issue.reason !== 'group-aggregate-twin-only') continue;
    if (nodes.some((n) => n.nodeId === issue.nodeId)) continue;
    const node = graph.nodes.find((n) => n.id === issue.nodeId);
    nodes.push({
      nodeId: issue.nodeId,
      kind: node?.kind ?? 'group-aggregate',
      ruleId: null,
      disabled: true,
      reasons: [{
        code: 'group-aggregate-twin-only', severity: 'disable',
        message: 'Group aggregates have no live supply on either route; the aggregate exists on the CPU twin only (lib/pipelineCross.ts).',
      }],
    });
  }

  const coverable = liveRulesWgslCoverable(compiled.rules, {
    names, names2, groupDefs, densityAvailable: true,
    attrDynamicActive: options.attrDynamicActive,
  });
  return { coverable, nodes };
}

export { pipelineNodeCrossImmediate };
