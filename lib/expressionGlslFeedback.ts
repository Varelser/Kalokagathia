import {
  astReferencesVariable,
  compileExpression,
} from './expression';
import {
  astToGlsl,
  astUsesDensityVar,
  astUsesSimVar,
  simVarToGlsl,
  ATTR_DEN_MAIN_LINES,
  ATTR_DEN_UNIFORM_LINES,
  ATTR_EXT_MAIN_LINES,
  ATTR_EXT_UNIFORM_LINES,
  ATTR_SIM_MAIN_LINES,
  ATTR_SIM_UNIFORM_LINES,
  type GlslVarResolver,
} from './expressionGlsl';
import { DENSITY_VAR_NAME } from './gpgpuDensity';
import {
  ATTR_SIM_VAR_NAMES,
  ATTR_SLOT_COUNT,
  normalizeAttrExprs,
  normalizeAttrNames,
  normalizeAttrNames2,
} from './gpgpuAttributes';

/**
 * GLSL code generation for attribute feedback (Phase BV).
 *
 * The feedback variant of the Phase BO dynamic attribute pass
 * (buildAttrDynFragment in lib/expressionGlsl.ts). The BO pass
 * is deliberately stateless: it always reads the BAKE texture,
 * never its own output. This generator adds exactly one new
 * variable to the expression language:
 *
 *   p — the slot's OWN value in the previous frame's output
 *       texture (prev.<chan>).
 *
 * Everything else keeps the BO discipline verbatim:
 *   - slots evaluate in order 0 → 3 against locals v0..v3 that
 *     initialise from the bake (src), so a slot name reads the
 *     current frame's already-updated value of an earlier slot
 *     and the bake value of the rest — a feedback slot's new
 *     value is therefore visible to later slots in the SAME
 *     frame, exactly like the bake's slot ordering (Phase BI);
 *   - x reads the slot's own bake channel, t reads uTime;
 *   - results are clamped to [0, 1];
 *   - the non-finite guard falls back to prev.<chan> for a slot
 *     whose expression references p (a transient exploding
 *     expression must not destroy accumulated state — Phase BV
 *     brief J2) and to src.<chan> (the BO fallback) otherwise;
 *   - 'p' is reserved: a slot NAMED 'p' can never shadow the
 *     previous-value variable, mirroring x / t.
 *
 * Returns null — the caller keeps the BO fragment / the bake —
 * when:
 *   - every expression is empty, or
 *   - no compilable expression references p (feedback would add
 *     nothing; the BO fragment already covers the config), or
 *   - an expression referencing p fails to compile or has no
 *     faithful GLSL form (never silently reinterpret feedback).
 *
 * A slot whose expression does NOT reference p is emitted with
 * the exact BO semantics, so within a feedback pass only the
 * p-referencing slots (and slots reading them by name) diverge
 * from the stateless re-evaluation.
 *
 * Wiring contract (components/gpgpuAttrFeedbackPass.ts): the
 * pass ping-pongs two float RTs; on the first frame after
 * (re)build / rebake the caller binds uPrev to the bake texture
 * itself, so p == x on frame 0 by definition and no copy pass
 * is needed. State resets are therefore exactly: pass rebuild
 * (signature change), rebake (bake texture object change), and
 * scene remount (deterministic renders remount, which restarts
 * the sim clock the same way). With an evaluation interval the
 * state advances once per EVALUATION, not per frame (brief J3).
 *
 * Ported verbatim from the Phase BU spike
 * (phasebu-work/project-copy/lib/expressionGlslFeedback.ts);
 * the only changes are this header and the module's place in
 * the production tree.
 *
 * Phase 18 stage 1: the sim variables (vel / age / rad) and
 * the ext slot inputs (w0..w3) join under the same conditional
 * emission as the BO builder — a fragment using neither is
 * byte-identical to the Phase BV output.
 */

const CHANNELS = ['r', 'g', 'b', 'a'] as const;

export function buildAttrFeedbackFragment(
  exprsInput: readonly string[] | unknown,
  namesInput: readonly string[] | unknown,
  extNamesInput?: readonly string[] | unknown,
): string | null {
  const exprs = normalizeAttrExprs(exprsInput);
  const names = normalizeAttrNames(namesInput);
  if (!exprs.some((expr) => expr.trim().length > 0)) return null;
  const lowerNames = names.map((name) => name.toLowerCase());
  // Slot-name → first slot carrying it. 'p' is reserved here in
  // addition to the BO reserved set (which astToGlsl's caller
  // discipline already applies via expressionGlsl's own table —
  // this generator resolves names itself, so it must skip 'p'
  // explicitly or a slot named 'p' would hijack the variable).
  // Phase 18 stage 1: the sim names are reserved the same way.
  const slotByName = new Map<string, number>();
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const key = lowerNames[slot];
    if (key === 'p') continue;
    if ((ATTR_SIM_VAR_NAMES as readonly string[]).includes(key)) continue;
    if (key === DENSITY_VAR_NAME) continue;
    if (!slotByName.has(key)) slotByName.set(key, slot);
  }
  // Ext slots (Phase 18 stage 1): read-only inputs w0..w3 from
  // the ext bake texture, under the same conditional-emission
  // discipline as the BO builder (see expressionGlsl.ts).
  const extSlotByName = new Map<string, number>();
  if (extNamesInput !== undefined) {
    const lowerExtNames = normalizeAttrNames2(extNamesInput).map((name) => name.toLowerCase());
    for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
      const key = lowerExtNames[slot];
      if (key === 'p') continue;
      if ((ATTR_SIM_VAR_NAMES as readonly string[]).includes(key)) continue;
      if (key === DENSITY_VAR_NAME) continue;
      if (slotByName.has(key) || extSlotByName.has(key)) continue;
      extSlotByName.set(key, slot);
    }
  }
  const extraVars = [
    ...lowerNames,
    ...[...extSlotByName.keys()],
    ...ATTR_SIM_VAR_NAMES,
    DENSITY_VAR_NAME,
    'p',
  ];

  const blocks: string[] = [];
  let feedbackSlots = 0;
  let usesSim = false;
  let usesExt = false;
  let usesDen = false;
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const expr = exprs[slot];
    if (expr.trim().length === 0) continue;
    const compiled = compileExpression(expr, extraVars);
    if (!compiled.ok) continue;
    const usesP = astReferencesVariable(compiled.ast, 'p');
    const chan = CHANNELS[slot];
    const resolveVar: GlslVarResolver = (name) => {
      if (name === 'x') return `src.${chan}`;
      if (name === 't') return 'uTime';
      if (name === 'p') return `prev.${chan}`;
      const sim = simVarToGlsl(name);
      if (sim !== null) return sim;
      const target = slotByName.get(name);
      if (target !== undefined) return `v${target}`;
      const extTarget = extSlotByName.get(name);
      return extTarget === undefined ? null : `w${extTarget}`;
    };
    const glsl = astToGlsl(compiled.ast, resolveVar);
    if (glsl === null) {
      // No faithful form. If the slot wanted feedback, the whole
      // feedback pass must not exist (never reinterpret); a
      // non-feedback slot just keeps its bake, as in BO.
      if (usesP) return null;
      continue;
    }
    if (usesP) feedbackSlots++;
    if (astUsesSimVar(compiled.ast)) usesSim = true;
    if (astUsesDensityVar(compiled.ast)) usesDen = true;
    for (const key of extSlotByName.keys()) {
      if (astReferencesVariable(compiled.ast, key)) {
        usesExt = true;
        break;
      }
    }
    const fallback = usesP ? `prev.${chan}` : `src.${chan}`;
    blocks.push(
      `  {\n`
      + `    float r = ${glsl};\n`
      + `    v${slot} = ((r == r) && abs(r) < 1.0e30) ? clamp(r, 0.0, 1.0) : ${fallback};\n`
      + `  }`,
    );
  }
  if (feedbackSlots === 0) return null;

  return [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    'uniform sampler2D uPrev;',
    ...(usesExt ? ATTR_EXT_UNIFORM_LINES : []),
    ...(usesSim ? ATTR_SIM_UNIFORM_LINES : []),
    ...(usesDen ? ATTR_DEN_UNIFORM_LINES : []),
    'uniform float uTime;',
    'void main() {',
    '  vec4 src = texture2D(uSrc, vUv);',
    '  vec4 prev = texture2D(uPrev, vUv);',
    ...(usesExt ? ATTR_EXT_MAIN_LINES : []),
    ...(usesSim ? ATTR_SIM_MAIN_LINES : []),
    ...(usesDen ? ATTR_DEN_MAIN_LINES : []),
    '  float v0 = src.r;',
    '  float v1 = src.g;',
    '  float v2 = src.b;',
    '  float v3 = src.a;',
    ...blocks,
    '  gl_FragColor = vec4(v0, v1, v2, v3);',
    '}',
    '',
  ].join('\n');
}
