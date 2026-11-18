import {
  compileExpression,
  type ExpressionCompileResult,
} from './expression';
import {
  ATTR_SLOT_COUNT,
  normalizeAttrExprs,
  normalizeAttrNames,
} from './gpgpuAttributes';

/**
 * GLSL code generation for the expression language (Phase BO).
 *
 * Stage 2 (dynamic attribute re-evaluation) evaluates the SAME
 * expressions as the stage-1 bake (lib/gpgpuAttributes.ts), but
 * on the GPU, every frame, with t = the sim clock. To keep one
 * language with one meaning, this module walks the AST produced
 * by compileExpression (lib/expression.ts) — there is NO second
 * parser — and emits a fully parenthesised GLSL expression whose
 * value matches evaluateCompiledExpression / the bake's
 * evaluateCompiledExpressionWithVars discipline:
 *
 *   - `%` is the expression language's mod (a - b * floor(a / b)),
 *     with the evaluator's b == 0 → 0 guard — NOT the GLSL %
 *     operator and not an unguarded mod();
 *   - `^` is pow(); comparisons and logical ops yield 1.0 / 0.0;
 *   - `!v` is (v == 0.0 ? 1.0 : 0.0); the ternary tests !== 0.0;
 *   - every FUNCTIONS entry is mapped (see astCallToGlsl); the
 *     ones without a GLSL twin of the same meaning (round,
 *     smoothstep's hi == lo case, clamp's JS min/max order,
 *     lerp, fract, mod) are emitted as small bridging expressions
 *     that reproduce the JS definition. A function with no
 *     faithful mapping makes the generator return null so the
 *     caller falls back to the bake — never a silent re-interpretation.
 *
 * Numbers always carry a decimal point or an exponent so GLSL
 * never reads them as ints. Every emitted sub-expression is
 * wrapped in parentheses, so GLSL operator precedence is never
 * load-bearing.
 *
 * Precision note: the evaluator runs on JS doubles, the GPU on
 * float32 — the same twin discipline the codebase already uses
 * for the bake's GLSL consumers. The per-slot finite guard in
 * the generated fragment treats NaN and any |value| >= 1e30 as
 * non-finite (the bake's Number.isFinite fallback); results in
 * that range cannot occur from the 0..1 attribute domain except
 * through deliberately exploding expressions (pow / exp / a
 * near-zero divisor), where stage 2 falls back to the bake
 * value for that slot exactly as stage 1 does for Infinity.
 */

type AstNode = Extract<ExpressionCompileResult, { ok: true }>['ast'];

/** Names compileExpression reserves for itself (mirrors the
 *  CONSTANTS table and the normalizeExtraVars discipline in
 *  lib/expression.ts): an attribute slot carrying one of these
 *  names can never shadow the built-in, so the slot-name map
 *  below skips them exactly as the bake's environment does. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'x',
  't',
  'pi',
  'tau',
  'e',
  'abs',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sqrt',
  'pow',
  'exp',
  'log',
  'floor',
  'ceil',
  'round',
  'sign',
  'fract',
  'mod',
  'min',
  'max',
  'clamp',
  'lerp',
  'smoothstep',
]);

const CHANNELS = ['r', 'g', 'b', 'a'] as const;

/** GLSL float literal: always a decimal point or an exponent. */
function formatGlslNumber(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const raw = String(value);
  return /[.eE]/.test(raw) ? raw : `${raw}.0`;
}

export type GlslVarResolver = (name: string) => string | null;

/**
 * Emit the GLSL for one compiled AST, or null when a node has
 * no faithful GLSL form (an unmapped function or variable).
 * `resolveVar` maps variable names (x / t / extra names) to
 * GLSL expressions.
 */
export function astToGlsl(node: AstNode, resolveVar: GlslVarResolver): string | null {
  switch (node.type) {
    case 'num':
      return formatGlslNumber(node.value);
    case 'const':
      return formatGlslNumber(node.value);
    case 'var':
      return resolveVar(node.name);
    case 'unary': {
      const arg = astToGlsl(node.arg, resolveVar);
      if (arg === null) return null;
      return node.op === '-' ? `(-${arg})` : `((${arg}) == 0.0 ? 1.0 : 0.0)`;
    }
    case 'ternary': {
      const cond = astToGlsl(node.cond, resolveVar);
      const then = astToGlsl(node.then, resolveVar);
      const els = astToGlsl(node.else, resolveVar);
      if (cond === null || then === null || els === null) return null;
      return `((${cond}) != 0.0 ? (${then}) : (${els}))`;
    }
    case 'binary': {
      const left = astToGlsl(node.left, resolveVar);
      const right = astToGlsl(node.right, resolveVar);
      if (left === null || right === null) return null;
      switch (node.op) {
        case '+':
          return `((${left}) + (${right}))`;
        case '-':
          return `((${left}) - (${right}))`;
        case '*':
          return `((${left}) * (${right}))`;
        case '/':
          return `((${left}) / (${right}))`;
        case '%':
          // The language's mod definition, with the b == 0 → 0
          // guard (identical shape to the mod() bridge below).
          return `((${right}) == 0.0 ? 0.0 : ((${left}) - (${right}) * floor(((${left}) / (${right})))))`;
        case '^':
          return `pow((${left}), (${right}))`;
        case '<':
          return `((${left}) < (${right}) ? 1.0 : 0.0)`;
        case '<=':
          return `((${left}) <= (${right}) ? 1.0 : 0.0)`;
        case '>':
          return `((${left}) > (${right}) ? 1.0 : 0.0)`;
        case '>=':
          return `((${left}) >= (${right}) ? 1.0 : 0.0)`;
        case '==':
          return `((${left}) == (${right}) ? 1.0 : 0.0)`;
        case '!=':
          return `((${left}) != (${right}) ? 1.0 : 0.0)`;
        case '&&':
          return `(((${left}) != 0.0 && (${right}) != 0.0) ? 1.0 : 0.0)`;
        case '||':
          return `(((${left}) != 0.0 || (${right}) != 0.0) ? 1.0 : 0.0)`;
        default:
          return null;
      }
    }
    case 'call': {
      const args: string[] = [];
      for (const arg of node.args) {
        const emitted = astToGlsl(arg, resolveVar);
        if (emitted === null) return null;
        args.push(emitted);
      }
      return astCallToGlsl(node.name, args);
    }
  }
}

/**
 * Map one FUNCTIONS call to GLSL. Every entry of the
 * lib/expression.ts FUNCTIONS table is covered; anything else
 * returns null (the caller falls back to the bake).
 */
function astCallToGlsl(name: string, args: string[]): string | null {
  const a = args[0];
  const b = args[1];
  switch (name) {
    case 'abs':
    case 'sin':
    case 'cos':
    case 'tan':
    case 'asin':
    case 'acos':
    case 'atan':
    case 'sqrt':
    case 'exp':
    case 'log':
    case 'floor':
    case 'ceil':
    case 'sign':
    case 'fract':
      // GLSL twins with the same definition (fract is x -
      // floor(x) on both sides).
      return `${name}((${a}))`;
    case 'atan2':
      return `atan((${a}), (${b}))`;
    case 'pow':
      return `pow((${a}), (${b}))`;
    case 'round':
      // Math.round rounds half toward +Infinity: floor(v + 0.5).
      // (GLSL round() rounds half away from zero — not used.)
      return `floor((${a}) + 0.5)`;
    case 'mod':
      return `((${b}) == 0.0 ? 0.0 : ((${a}) - (${b}) * floor(((${a}) / (${b})))))`;
    case 'min':
    case 'max': {
      let acc = `(${a})`;
      for (let i = 1; i < args.length; i++) {
        acc = `${name}((${acc}), (${args[i]}))`;
      }
      return acc;
    }
    case 'clamp':
      // Math.min(hi, Math.max(lo, v)) — the JS evaluation order.
      return `min((${args[2]}), max((${args[1]}), (${args[0]})))`;
    case 'lerp':
      return `((${a}) + ((${b}) - (${a})) * (${args[2]}))`;
    case 'smoothstep': {
      const lo = args[0];
      const hi = args[1];
      const v = args[2];
      const u = `clamp((((${v}) - (${lo})) / ((${hi}) - (${lo}))), 0.0, 1.0)`;
      return `((${hi}) == (${lo}) ? ((${v}) < (${lo}) ? 0.0 : 1.0) : ((${u}) * (${u}) * (3.0 - 2.0 * (${u}))))`;
    }
    default:
      return null;
  }
}

/**
 * Build the attribute dynamic pass's fragment shader for the
 * given per-slot expressions and slot names, or null when the
 * pass must not exist:
 *
 *   - every slot's expression is empty (the caller keeps the
 *     bake — the stage-1 structural identity discipline), or
 *   - every non-empty expression either fails to compile or
 *     uses a construct with no faithful GLSL form.
 *
 * A slot whose expression fails to compile keeps its bake
 * value (no assignment is emitted for it), exactly like the
 * bake. Slots evaluate in order 0 → 3 against locals v0..v3
 * holding the CURRENT values: a slot name reads the
 * re-evaluated value of an already-processed slot and the bake
 * value of the rest (itself included), x reads the slot's own
 * bake channel (src.<chan>), t reads uTime. Duplicate slot
 * names resolve to the first matching slot, as in the bake.
 * Each re-evaluated result is clamped to [0, 1]; a non-finite
 * result falls back to the bake channel for that slot only.
 */
export function buildAttrDynFragment(
  exprsInput: readonly string[] | unknown,
  namesInput: readonly string[] | unknown,
): string | null {
  const exprs = normalizeAttrExprs(exprsInput);
  const names = normalizeAttrNames(namesInput);
  if (!exprs.some((expr) => expr.trim().length > 0)) return null;
  const lowerNames = names.map((name) => name.toLowerCase());
  // Slot-name → first slot carrying it (built-ins never shadowed).
  const slotByName = new Map<string, number>();
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const key = lowerNames[slot];
    if (RESERVED_NAMES.has(key)) continue;
    if (!slotByName.has(key)) slotByName.set(key, slot);
  }

  const blocks: string[] = [];
  let activeSlots = 0;
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const expr = exprs[slot];
    if (expr.trim().length === 0) continue;
    const compiled = compileExpression(expr, lowerNames);
    if (!compiled.ok) continue;
    const chan = CHANNELS[slot];
    const resolveVar: GlslVarResolver = (name) => {
      if (name === 'x') return `src.${chan}`;
      if (name === 't') return 'uTime';
      const target = slotByName.get(name);
      return target === undefined ? null : `v${target}`;
    };
    const glsl = astToGlsl(compiled.ast, resolveVar);
    if (glsl === null) return null;
    activeSlots++;
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
    'uniform float uTime;',
    'void main() {',
    '  vec4 src = texture2D(uSrc, vUv);',
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
