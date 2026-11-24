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
 * GLSL code generation for the attribute CHAIN stage
 * (Phase 18 stage 1).
 *
 * The chain is the second expression stage of the attribute
 * dataflow: where the stage-1 passes (the bake, Phase BO's
 * dynamic re-evaluation, Phase BV's feedback) produce the
 * texture consumers read today, the chain pass takes THAT
 * texture as its input (uSrc) and applies one more expression
 * set (config gpgpuAttrChainExprs) on top. Its output is what
 * the consumers then read. The pass is stateless like BO —
 * it always reads the stage-1 output, never its own — so the
 * deterministic render stays reproducible.
 *
 * Variable discipline (one language, one meaning, shared with
 * the bake and the stage-1 builders):
 *   - x reads the slot's own STAGE-1 value (src.<chan>);
 *   - a slot name reads the CURRENT value of that slot: the
 *     chain result of an already-processed slot, the stage-1
 *     value of the rest (slots evaluate in order 0 → 3);
 *   - the ext slot names (slots 4..7) read the ext bake
 *     texture (w0..w3), read-only — the chain writes slots
 *     0..3 only;
 *   - vel / age / rad read the sim state, t reads uTime;
 *   - results clamp to [0, 1]; a non-finite result falls back
 *     to the stage-1 channel for that slot only.
 *
 * Returns null — the caller keeps the stage-1 texture
 * verbatim — when every chain expression is empty, when no
 * expression compiles, or when a compilable expression has no
 * faithful GLSL form (the BO rule: never silently
 * reinterpret). The sim / ext sampling lines are emitted only
 * when an expression actually reads them, exactly as in the
 * stage-1 builders.
 */

const CHANNELS = ['r', 'g', 'b', 'a'] as const;

/** Names that can never name a slot here (built-ins + sim). */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'x', 't', 'pi', 'tau', 'e',
  'abs', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sqrt', 'pow', 'exp', 'log', 'floor', 'ceil', 'round', 'sign',
  'fract', 'mod', 'min', 'max', 'clamp', 'lerp', 'smoothstep',
  ...ATTR_SIM_VAR_NAMES,
  DENSITY_VAR_NAME,
]);

export function buildAttrChainFragment(
  exprsInput: readonly string[] | unknown,
  namesInput: readonly string[] | unknown,
  extNamesInput?: readonly string[] | unknown,
): string | null {
  const exprs = normalizeAttrExprs(exprsInput);
  const names = normalizeAttrNames(namesInput);
  if (!exprs.some((expr) => expr.trim().length > 0)) return null;
  const lowerNames = names.map((name) => name.toLowerCase());
  const slotByName = new Map<string, number>();
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const key = lowerNames[slot];
    if (RESERVED_NAMES.has(key)) continue;
    if (!slotByName.has(key)) slotByName.set(key, slot);
  }
  const extSlotByName = new Map<string, number>();
  if (extNamesInput !== undefined) {
    const lowerExtNames = normalizeAttrNames2(extNamesInput).map((name) => name.toLowerCase());
    for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
      const key = lowerExtNames[slot];
      if (RESERVED_NAMES.has(key)) continue;
      if (slotByName.has(key) || extSlotByName.has(key)) continue;
      extSlotByName.set(key, slot);
    }
  }
  const extraVars = [
    ...lowerNames,
    ...[...extSlotByName.keys()],
    ...ATTR_SIM_VAR_NAMES,
    DENSITY_VAR_NAME,
  ];

  const blocks: string[] = [];
  let activeSlots = 0;
  let usesSim = false;
  let usesExt = false;
  let usesDen = false;
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const expr = exprs[slot];
    if (expr.trim().length === 0) continue;
    const compiled = compileExpression(expr, extraVars);
    if (!compiled.ok) continue;
    const chan = CHANNELS[slot];
    const resolveVar: GlslVarResolver = (name) => {
      if (name === 'x') return `src.${chan}`;
      if (name === 't') return 'uTime';
      const sim = simVarToGlsl(name);
      if (sim !== null) return sim;
      const target = slotByName.get(name);
      if (target !== undefined) return `v${target}`;
      const extTarget = extSlotByName.get(name);
      return extTarget === undefined ? null : `w${extTarget}`;
    };
    const glsl = astToGlsl(compiled.ast, resolveVar);
    if (glsl === null) return null;
    activeSlots++;
    if (astUsesSimVar(compiled.ast)) usesSim = true;
    if (astUsesDensityVar(compiled.ast)) usesDen = true;
    for (const key of extSlotByName.keys()) {
      if (astReferencesVariable(compiled.ast, key)) {
        usesExt = true;
        break;
      }
    }
    blocks.push(
      `  {\n`
      + `    float r = ${glsl};\n`
      + `    v${slot} = ((r == r) && abs(r) < 1.0e30) ? clamp(r, 0.0, 1.0) : src.${chan};\n`
      + `  }`,
    );
  }
  if (activeSlots === 0) return null;

  return [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uSrc;',
    ...(usesExt ? ATTR_EXT_UNIFORM_LINES : []),
    ...(usesSim ? ATTR_SIM_UNIFORM_LINES : []),
    ...(usesDen ? ATTR_DEN_UNIFORM_LINES : []),
    'uniform float uTime;',
    'void main() {',
    '  vec4 src = texture2D(uSrc, vUv);',
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
