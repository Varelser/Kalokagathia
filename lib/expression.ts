/**
 * Safe expression evaluator (Phase AJ).
 *
 * A small recursive-descent parser + tree-walking evaluator for
 * modulation expressions. There is NO eval / Function anywhere in
 * this module: the grammar below is the whole language, identifiers
 * resolve only against a fixed table (variables x / t, constants
 * pi / tau / e, and the function list), and the AST is size-capped
 * at parse time, so a stored expression can never reach outside
 * this sandbox or build an unbounded tree.
 *
 * Grammar (loosest binding first):
 *   expr     := ternary
 *   ternary  := compare ('?' ternary ':' ternary)?
 *   compare  := additive (('<'|'<='|'>'|'>='|'=='|'!=') additive)?
 *   additive := mult (('+'|'-') mult)*
 *   mult     := power (('*'|'/'|'%') power)*
 *   power    := unary ('^' power)?
 *   unary    := ('-'|'!') unary | primary
 *   primary  := number | ident | ident '(' args ')' | '(' expr ')'
 *
 * Comparisons yield 1 / 0. Evaluation is a pure function of
 * (x, t): x is the wrapped source's 0..1 value, t is time in
 * seconds. Non-finite intermediate results propagate as NaN /
 * Infinity and the CALLER decides the fallback (the modulation
 * engine falls back to the raw input x), so a bad expression can
 * never inject NaN into a rendered parameter.
 *
 * Phase BI extension (additive only): compileExpression accepts
 * an optional set of EXTRA variable names (the attribute slot
 * names, for the bake-time attribute arithmetic in
 * lib/gpgpuAttributes.ts). Calls without extraVars behave exactly
 * as before — unknown identifiers are still compile errors. An
 * extra name that collides with a built-in (x / t, a constant or
 * a function name) is ignored: the built-in wins. ASTs containing
 * extra variables are evaluated through
 * evaluateCompiledExpressionWithVars with an environment record
 * (x / t are read from the record too); the (x, t) evaluator
 * below is untouched.
 */

export const EXPRESSION_MAX_LENGTH = 240;
export const EXPRESSION_MAX_NODES = 200;

type AstNode =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'const'; value: number }
  | { type: 'unary'; op: '-' | '!'; arg: AstNode }
  | { type: 'binary'; op: string; left: AstNode; right: AstNode }
  | { type: 'ternary'; cond: AstNode; then: AstNode; else: AstNode }
  | { type: 'call'; name: string; args: AstNode[] };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
};

const FUNCTIONS: Record<string, { min: number; max: number; fn: (...args: number[]) => number }> = {
  abs: { min: 1, max: 1, fn: (a) => Math.abs(a) },
  sin: { min: 1, max: 1, fn: (a) => Math.sin(a) },
  cos: { min: 1, max: 1, fn: (a) => Math.cos(a) },
  tan: { min: 1, max: 1, fn: (a) => Math.tan(a) },
  asin: { min: 1, max: 1, fn: (a) => Math.asin(a) },
  acos: { min: 1, max: 1, fn: (a) => Math.acos(a) },
  atan: { min: 1, max: 1, fn: (a) => Math.atan(a) },
  atan2: { min: 2, max: 2, fn: (a, b) => Math.atan2(a, b) },
  sqrt: { min: 1, max: 1, fn: (a) => Math.sqrt(a) },
  pow: { min: 2, max: 2, fn: (a, b) => Math.pow(a, b) },
  exp: { min: 1, max: 1, fn: (a) => Math.exp(a) },
  log: { min: 1, max: 1, fn: (a) => Math.log(a) },
  floor: { min: 1, max: 1, fn: (a) => Math.floor(a) },
  ceil: { min: 1, max: 1, fn: (a) => Math.ceil(a) },
  round: { min: 1, max: 1, fn: (a) => Math.round(a) },
  sign: { min: 1, max: 1, fn: (a) => Math.sign(a) },
  fract: { min: 1, max: 1, fn: (a) => a - Math.floor(a) },
  mod: { min: 2, max: 2, fn: (a, b) => (b === 0 ? 0 : a - b * Math.floor(a / b)) },
  min: { min: 1, max: 8, fn: (...args) => Math.min(...args) },
  max: { min: 1, max: 8, fn: (...args) => Math.max(...args) },
  clamp: { min: 3, max: 3, fn: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) },
  lerp: { min: 3, max: 3, fn: (a, b, t) => a + (b - a) * t },
  smoothstep: {
    min: 3,
    max: 3,
    fn: (lo, hi, v) => {
      if (hi === lo) return v < lo ? 0 : 1;
      const u = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      return u * u * (3 - 2 * u);
    },
  },
};

export type ExpressionCompileResult =
  | { ok: true; ast: AstNode }
  | { ok: false; error: string };

interface Token {
  kind: 'num' | 'ident' | 'op' | 'end';
  value: string;
  num?: number;
  pos: number;
}

function tokenize(text: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || (ch === '.' && text[i + 1] >= '0' && text[i + 1] <= '9')) {
      let j = i;
      let seenDot = false;
      let seenExp = false;
      while (j < text.length) {
        const c = text[j];
        if (c >= '0' && c <= '9') j++;
        else if (c === '.' && !seenDot && !seenExp) {
          seenDot = true;
          j++;
        } else if ((c === 'e' || c === 'E') && !seenExp && j > i) {
          seenExp = true;
          j++;
          if (text[j] === '+' || text[j] === '-') j++;
        } else break;
      }
      const raw = text.slice(i, j);
      const num = Number(raw);
      if (!Number.isFinite(num)) return { error: `数値が不正です (${i} 文字目)` };
      tokens.push({ kind: 'num', value: raw, num, pos: i });
      i = j;
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      tokens.push({ kind: 'ident', value: text.slice(i, j).toLowerCase(), pos: i });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
      tokens.push({ kind: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if ('+-*/%^<>?:(),!'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i });
      i++;
      continue;
    }
    return { error: `使えない文字 '${ch}' があります (${i} 文字目)` };
  }
  tokens.push({ kind: 'end', value: '', pos: text.length });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private extraVars: ReadonlySet<string>;
  private index = 0;
  private nodes = 0;
  error: string | null = null;

  constructor(tokens: Token[], extraVars: ReadonlySet<string> = new Set()) {
    this.tokens = tokens;
    this.extraVars = extraVars;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private count(): void {
    this.nodes++;
    if (this.nodes > EXPRESSION_MAX_NODES && !this.error) {
      this.error = '式が複雑すぎます';
    }
  }

  private expectOp(op: string): boolean {
    const token = this.peek();
    if (token.kind === 'op' && token.value === op) {
      this.next();
      return true;
    }
    if (!this.error) this.error = `'${op}' が必要です (${token.pos} 文字目)`;
    return false;
  }

  parse(): AstNode | null {
    const node = this.parseTernary();
    if (this.error || !node) return null;
    if (this.peek().kind !== 'end') {
      this.error = `式の後ろに余分な内容があります (${this.peek().pos} 文字目)`;
      return null;
    }
    return node;
  }

  private parseTernary(): AstNode | null {
    const cond = this.parseCompare();
    if (!cond) return null;
    const token = this.peek();
    if (token.kind === 'op' && token.value === '?') {
      this.next();
      const thenBranch = this.parseTernary();
      if (!thenBranch || !this.expectOp(':')) return null;
      const elseBranch = this.parseTernary();
      if (!elseBranch) return null;
      this.count();
      return { type: 'ternary', cond, then: thenBranch, else: elseBranch };
    }
    return cond;
  }

  private parseCompare(): AstNode | null {
    const left = this.parseAdditive();
    if (!left) return null;
    const token = this.peek();
    if (token.kind === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(token.value)) {
      this.next();
      const right = this.parseAdditive();
      if (!right) return null;
      this.count();
      return { type: 'binary', op: token.value, left, right };
    }
    return left;
  }

  private parseAdditive(): AstNode | null {
    let left = this.parseMult();
    if (!left) return null;
    for (;;) {
      const token = this.peek();
      if (token.kind === 'op' && (token.value === '+' || token.value === '-')) {
        this.next();
        const right = this.parseMult();
        if (!right) return null;
        this.count();
        left = { type: 'binary', op: token.value, left, right };
      } else return left;
    }
  }

  private parseMult(): AstNode | null {
    let left = this.parsePower();
    if (!left) return null;
    for (;;) {
      const token = this.peek();
      if (token.kind === 'op' && (token.value === '*' || token.value === '/' || token.value === '%')) {
        this.next();
        const right = this.parsePower();
        if (!right) return null;
        this.count();
        left = { type: 'binary', op: token.value, left, right };
      } else return left;
    }
  }

  private parsePower(): AstNode | null {
    const base = this.parseUnary();
    if (!base) return null;
    const token = this.peek();
    if (token.kind === 'op' && token.value === '^') {
      this.next();
      const exponent = this.parsePower();
      if (!exponent) return null;
      this.count();
      return { type: 'binary', op: '^', left: base, right: exponent };
    }
    return base;
  }

  private parseUnary(): AstNode | null {
    const token = this.peek();
    if (token.kind === 'op' && (token.value === '-' || token.value === '!')) {
      this.next();
      const arg = this.parseUnary();
      if (!arg) return null;
      this.count();
      return { type: 'unary', op: token.value as '-' | '!', arg };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode | null {
    const token = this.next();
    if (token.kind === 'num') {
      this.count();
      return { type: 'num', value: token.num as number };
    }
    if (token.kind === 'op' && token.value === '(') {
      const inner = this.parseTernary();
      if (!inner || !this.expectOp(')')) return null;
      return inner;
    }
    if (token.kind === 'ident') {
      const name = token.value;
      const after = this.peek();
      if (after.kind === 'op' && after.value === '(') {
        const spec = FUNCTIONS[name];
        if (!spec) {
          this.error = `未知の関数 '${name}' です`;
          return null;
        }
        this.next();
        const args: AstNode[] = [];
        if (!(this.peek().kind === 'op' && this.peek().value === ')')) {
          for (;;) {
            const arg = this.parseTernary();
            if (!arg) return null;
            args.push(arg);
            if (this.peek().kind === 'op' && this.peek().value === ',') {
              this.next();
              continue;
            }
            break;
          }
        }
        if (!this.expectOp(')')) return null;
        if (args.length < spec.min || args.length > spec.max) {
          this.error = `関数 '${name}' の引数の数が合いません`;
          return null;
        }
        this.count();
        return { type: 'call', name, args };
      }
      if (name === 'x' || name === 't') {
        this.count();
        return { type: 'var', name };
      }
      if (name in CONSTANTS) {
        this.count();
        return { type: 'const', value: CONSTANTS[name] };
      }
      if (this.extraVars.has(name)) {
        this.count();
        return { type: 'var', name };
      }
      this.error = this.extraVars.size > 0
        ? `未知の名前 '${name}' です (使える変数は x と t と属性名)`
        : `未知の名前 '${name}' です (使える変数は x と t)`;
      return null;
    }
    if (!this.error) this.error = `予期しない内容です (${token.pos} 文字目)`;
    return null;
  }
}

/**
 * Normalise caller-supplied extra variable names for
 * compileExpression: lowercased (the tokenizer lowercases
 * identifiers), trimmed, and stripped of anything that collides
 * with a built-in — x / t, the constants and the function names
 * always win, so a colliding extra name is simply inert and
 * never an error.
 */
function normalizeExtraVars(extraVars?: Iterable<string>): Set<string> {
  const out = new Set<string>();
  if (!extraVars) return out;
  for (const raw of extraVars) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (name === 'x' || name === 't') continue;
    if (name in CONSTANTS) continue;
    if (name in FUNCTIONS) continue;
    out.add(name);
  }
  return out;
}

/**
 * Parse an expression into an AST, or report a Japanese error.
 * `extraVars` (Phase BI) optionally names additional variables
 * the expression may reference; omitting it keeps the original
 * x / t-only behaviour exactly.
 */
export function compileExpression(text: string, extraVars?: Iterable<string>): ExpressionCompileResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: '式が空です' };
  }
  if (text.length > EXPRESSION_MAX_LENGTH) {
    return { ok: false, error: `式が長すぎます (上限 ${EXPRESSION_MAX_LENGTH} 文字)` };
  }
  const tokens = tokenize(text);
  if (!Array.isArray(tokens)) return { ok: false, error: tokens.error };
  const parser = new Parser(tokens, normalizeExtraVars(extraVars));
  const ast = parser.parse();
  if (!ast) return { ok: false, error: parser.error ?? '式を解釈できませんでした' };
  return { ok: true, ast };
}

function evaluateNode(node: AstNode, x: number, t: number): number {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'const':
      return node.value;
    case 'var':
      return node.name === 'x' ? x : t;
    case 'unary': {
      const value = evaluateNode(node.arg, x, t);
      return node.op === '-' ? -value : value === 0 ? 1 : 0;
    }
    case 'ternary':
      return evaluateNode(node.cond, x, t) !== 0
        ? evaluateNode(node.then, x, t)
        : evaluateNode(node.else, x, t);
    case 'call': {
      const spec = FUNCTIONS[node.name];
      const args = node.args.map((arg) => evaluateNode(arg, x, t));
      return spec.fn(...args);
    }
    case 'binary': {
      const left = evaluateNode(node.left, x, t);
      const right = evaluateNode(node.right, x, t);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return right === 0 ? 0 : left - right * Math.floor(left / right);
        case '^':
          return Math.pow(left, right);
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
        case '==':
          return left === right ? 1 : 0;
        case '!=':
          return left !== right ? 1 : 0;
        default:
          return NaN;
      }
    }
  }
}

/** Evaluate a compiled expression. May return NaN / Infinity for
 *  pathological inputs — the caller owns the fallback. */
export function evaluateCompiledExpression(ast: AstNode, x: number, t: number): number {
  return evaluateNode(ast, x, t);
}

function evaluateNodeWithVars(node: AstNode, vars: Record<string, number>): number {
  switch (node.type) {
    case 'num':
      return node.value;
    case 'const':
      return node.value;
    case 'var': {
      const value = vars[node.name];
      return typeof value === 'number' ? value : NaN;
    }
    case 'unary': {
      const value = evaluateNodeWithVars(node.arg, vars);
      return node.op === '-' ? -value : value === 0 ? 1 : 0;
    }
    case 'ternary':
      return evaluateNodeWithVars(node.cond, vars) !== 0
        ? evaluateNodeWithVars(node.then, vars)
        : evaluateNodeWithVars(node.else, vars);
    case 'call': {
      const spec = FUNCTIONS[node.name];
      const args = node.args.map((arg) => evaluateNodeWithVars(arg, vars));
      return spec.fn(...args);
    }
    case 'binary': {
      const left = evaluateNodeWithVars(node.left, vars);
      const right = evaluateNodeWithVars(node.right, vars);
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return right === 0 ? 0 : left - right * Math.floor(left / right);
        case '^':
          return Math.pow(left, right);
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
        case '==':
          return left === right ? 1 : 0;
        case '!=':
          return left !== right ? 1 : 0;
        default:
          return NaN;
      }
    }
  }
}

/**
 * Evaluate a compiled expression against an environment record
 * (Phase BI). Every variable — x and t included — is read from
 * `vars`; a name missing from the record evaluates to NaN, so
 * the caller's non-finite fallback applies. Same contract as
 * evaluateCompiledExpression: NaN / Infinity may come back and
 * the caller owns the fallback.
 */
export function evaluateCompiledExpressionWithVars(ast: AstNode, vars: Record<string, number>): number {
  return evaluateNodeWithVars(ast, vars);
}

const compileCache = new Map<string, ExpressionCompileResult>();
const COMPILE_CACHE_LIMIT = 64;

/** Compile with a small LRU-ish cache (route evaluation runs per frame). */
export function compileExpressionCached(text: string): ExpressionCompileResult {
  const cached = compileCache.get(text);
  if (cached) return cached;
  const result = compileExpression(text);
  if (compileCache.size >= COMPILE_CACHE_LIMIT) compileCache.clear();
  compileCache.set(text, result);
  return result;
}

/**
 * The modulation-facing entry point: evaluate `text` with input x
 * at time t. Invalid expressions and non-finite results fall back
 * to the raw input x, so the wrapped source passes through
 * untouched instead of collapsing to 0.
 */
export function evaluateExpressionText(text: string, x: number, t: number): number {
  const compiled = compileExpressionCached(text);
  if (!compiled.ok) return x;
  const value = evaluateNode(compiled.ast, x, t);
  return Number.isFinite(value) ? value : x;
}
