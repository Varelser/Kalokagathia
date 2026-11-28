// Shared GLSL snippet definitions — the Scratch Pad foundation
// (Layer 1 WP11, phase A).
//
// Every GLSL injection point (lib/glslInjection.ts) historically
// held its snippet independently, per stage: a fragment of GLSL
// written for the custom force could not be reused by the GEOM
// vertex point, and a helper written for one post snippet had to
// be copy-pasted into the next. UE5's Scratch Pad is exactly the
// missing piece — module authoring that spans stages. This
// module is that grammar, as pure functions over a plain value:
//
//   a definition set is an ordered list of { name, code } pairs
//   (a lib value — persistence is a later phase's wiring, and
//   no config key is registered here);
//
//   a snippet references a definition with a whole-line
//   directive:
//
//       // @use <name>
//
//   Expansion is verbatim textual substitution: the directive
//   line is replaced by the referenced definition's body, which
//   is itself expanded first (depth-first, in textual order).
//   Expansion is a pure, deterministic function of
//   (definition set, code): the order of definitions inside the
//   set never affects the result, a definition referenced twice
//   is expanded twice, and a code text without directives is
//   returned as the identical string.
//
// Rejection rules (the set is one authored value, so it is
// validated as a whole): malformed or duplicate names, a
// reference to an undefined name, and reference cycles —
// including cycles between definitions an entry point never
// reaches — all reject the set / the expansion with a reason.
// Depth and expanded-length caps bound pathological inputs.
//
// The forbidden-token / length discipline is NOT re-implemented
// here: lib/glslInjection.ts layers its shared validateGlslSnippet
// core over these functions (validateGlslSharedSnippetDefsForInjection
// / resolveGlslSnippet), so a definition body is held to exactly
// the contract of the point that consumes it. One consequence of
// expansion-at-resolution, decided here for the custom force's
// ctrl() declarations: expansion happens BEFORE the point's own
// processing, so a ctrl() declaration inside a shared definition
// behaves exactly as if it had been written inline in the
// referencing snippet — the point's existing extraction and
// duplicate checks see the expanded text and stay in charge.

import React from 'react';

// ---------------------------------------------------------------------------
// The value shape

export interface GlslSharedSnippetDef {
  /** GLSL-identifier-shaped name, referenced by `// @use <name>`. */
  name: string;
  /** The GLSL fragment. May itself contain `// @use` directives. */
  code: string;
}

export type GlslSharedSnippetSet = readonly GlslSharedSnippetDef[];

export interface GlslSharedSnippetValidation {
  ok: boolean;
  error?: string;
}

export interface GlslSharedSnippetExpansion {
  ok: boolean;
  /** Present when ok: the expanded code. */
  code?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Names and directives

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const GLSL_SHARED_SNIPPET_NAME_MAX_LENGTH = 64;

export function isValidGlslSharedSnippetName(name: string): boolean {
  return name.length <= GLSL_SHARED_SNIPPET_NAME_MAX_LENGTH && NAME_PATTERN.test(name);
}

// A directive is a whole line: optional leading whitespace, the
// comment marker, `@use`, the name, optional trailing
// whitespace — nothing else. Anything that merely mentions
// `@use` inside a longer comment is prose, not a directive.
const DIRECTIVE_PATTERN = /^\s*\/\/\s*@use\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/** The name a line references, or null when the line is not a
 *  directive. */
export function glslSharedSnippetDirective(line: string): string | null {
  const match = DIRECTIVE_PATTERN.exec(line);
  return match ? match[1] : null;
}

/** Names referenced by a code text, in order of appearance
 *  (duplicates kept — each appearance is one expansion). */
export function findGlslSharedSnippetRefs(code: string): string[] {
  const refs: string[] = [];
  for (const line of code.split('\n')) {
    const name = glslSharedSnippetDirective(line);
    if (name !== null) refs.push(name);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Structural validation of a definition set
//
// Point-agnostic: names, duplicates, resolvable references and
// acyclicity over the whole set. The consuming point's
// forbidden-token and length rules are layered on top by
// lib/glslInjection.ts.

export function validateGlslSharedSnippetDefs(
  defs: GlslSharedSnippetSet,
): GlslSharedSnippetValidation {
  const byName = new Map<string, GlslSharedSnippetDef>();
  for (const def of defs) {
    if (!isValidGlslSharedSnippetName(def.name)) {
      return { ok: false, error: `共有スニペットの名前が不正です: '${def.name}'` };
    }
    if (byName.has(def.name)) {
      return { ok: false, error: `共有スニペットの名前が重複しています: '${def.name}'` };
    }
    byName.set(def.name, def);
  }
  for (const def of defs) {
    for (const ref of findGlslSharedSnippetRefs(def.code)) {
      if (!byName.has(ref)) {
        return {
          ok: false,
          error: `共有スニペット '${def.name}' が未定義の '${ref}' を参照しています`,
        };
      }
    }
  }
  const cycle = findGlslSharedSnippetCycle(defs);
  if (cycle) {
    return {
      ok: false,
      error: `共有スニペットの参照が循環しています: ${cycle.join(' -> ')}`,
    };
  }
  return { ok: true };
}

/** One reference cycle as a name path (first name repeated at
 *  the end), or null when the set is acyclic. Deterministic:
 *  definitions are visited in set order, references in textual
 *  order. */
export function findGlslSharedSnippetCycle(
  defs: GlslSharedSnippetSet,
): string[] | null {
  const byName = new Map<string, GlslSharedSnippetDef>();
  for (const def of defs) {
    if (!byName.has(def.name)) byName.set(def.name, def);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (name: string): string[] | null => {
    state.set(name, 'visiting');
    stack.push(name);
    const def = byName.get(name);
    if (def) {
      for (const ref of findGlslSharedSnippetRefs(def.code)) {
        if (!byName.has(ref)) continue;
        const refState = state.get(ref);
        if (refState === 'visiting') {
          return [...stack.slice(stack.indexOf(ref)), ref];
        }
        if (refState === undefined) {
          const found = visit(ref);
          if (found) return found;
        }
      }
    }
    stack.pop();
    state.set(name, 'done');
    return null;
  };
  for (const def of defs) {
    if (state.get(def.name) === undefined) {
      const found = visit(def.name);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Expansion

export const GLSL_SHARED_SNIPPET_MAX_DEPTH = 16;
export const GLSL_SHARED_SNIPPET_MAX_EXPANDED_LENGTH = 262144;

/**
 * Expand every `// @use` directive in `code` against `defs`.
 * A code text without directives is returned as the identical
 * string (no split/rejoin round trip), so configurations that
 * never use shared definitions keep byte-identical output.
 */
export function expandGlslSharedSnippets(
  code: string,
  defs: GlslSharedSnippetSet,
  maxExpandedLength: number = GLSL_SHARED_SNIPPET_MAX_EXPANDED_LENGTH,
): GlslSharedSnippetExpansion {
  if (findGlslSharedSnippetRefs(code).length === 0) {
    return { ok: true, code };
  }
  const structural = validateGlslSharedSnippetDefs(defs);
  if (!structural.ok) return { ok: false, error: structural.error };

  const byName = new Map<string, GlslSharedSnippetDef>();
  for (const def of defs) byName.set(def.name, def);
  const memo = new Map<string, string>();

  const expandDef = (name: string, stack: readonly string[]): GlslSharedSnippetExpansion => {
    const cached = memo.get(name);
    if (cached !== undefined) return { ok: true, code: cached };
    if (stack.includes(name)) {
      return {
        ok: false,
        error: `共有スニペットの参照が循環しています: ${[...stack, name].join(' -> ')}`,
      };
    }
    if (stack.length >= GLSL_SHARED_SNIPPET_MAX_DEPTH) {
      return {
        ok: false,
        error: `共有スニペットの展開が深すぎます（最大 ${GLSL_SHARED_SNIPPET_MAX_DEPTH} 段）`,
      };
    }
    const def = byName.get(name);
    if (!def) {
      return { ok: false, error: `共有スニペット '${name}' は定義されていません` };
    }
    const expanded = expandText(def.code, [...stack, name]);
    if (!expanded.ok) return expanded;
    memo.set(name, expanded.code as string);
    return expanded;
  };

  const expandText = (text: string, stack: readonly string[]): GlslSharedSnippetExpansion => {
    const lines = text.split('\n');
    const out: string[] = [];
    let length = 0;
    for (const line of lines) {
      const ref = glslSharedSnippetDirective(line);
      if (ref === null) {
        out.push(line);
        length += line.length + 1;
      } else {
        const expanded = expandDef(ref, stack);
        if (!expanded.ok) return expanded;
        out.push(expanded.code as string);
        length += (expanded.code as string).length + 1;
      }
      if (length > maxExpandedLength) {
        return {
          ok: false,
          error: `共有スニペット展開後のコードが長すぎます（最大 ${maxExpandedLength} 文字）`,
        };
      }
    }
    return { ok: true, code: out.join('\n') };
  };

  return expandText(code, []);
}

// ---------------------------------------------------------------------------
// Serialisation — the lib value's text form (JSON array of
// { name, code }). Persistence (which store, which key) is a
// later phase's wiring decision; this pair only fixes the shape
// so every consumer reads and writes the same bytes. Parsing is
// strict and total: malformed input is an error, never a throw,
// and a structurally invalid set is rejected, not repaired.

export function serializeGlslSharedSnippetDefs(defs: GlslSharedSnippetSet): string {
  return JSON.stringify(defs.map((def) => ({ name: def.name, code: def.code })));
}

export function parseGlslSharedSnippetDefs(
  text: string,
): { ok: boolean; defs?: GlslSharedSnippetDef[]; error?: string } {
  if (text.trim() === '') return { ok: true, defs: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '共有スニペット定義の JSON が読めません' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: '共有スニペット定義は配列でなければなりません' };
  }
  const defs: GlslSharedSnippetDef[] = [];
  for (const entry of parsed) {
    if (
      typeof entry !== 'object' || entry === null ||
      typeof (entry as { name?: unknown }).name !== 'string' ||
      typeof (entry as { code?: unknown }).code !== 'string'
    ) {
      return { ok: false, error: '共有スニペット定義の項目の形が不正です（name と code が必要です）' };
    }
    defs.push({ name: (entry as { name: string }).name, code: (entry as { code: string }).code });
  }
  const structural = validateGlslSharedSnippetDefs(defs);
  if (!structural.ok) return { ok: false, error: structural.error };
  return { ok: true, defs };
}

// ---------------------------------------------------------------------------
// Config bridge (Layer 1 WP11, phase C)
//
// The definition set can also be authored into the work itself
// via the `glslSharedSnippets` config key (a JSON string in
// exactly the serialised form above), so it travels with
// presets/projects.
//
// Resolution discipline (the WP9 phase C rule — option (c)
// combined use with a sentinel, decided there by the user):
// - The sentinel is the RAW string, judged before parsing.
//   '' (or a non-string) means "not authored": the fallback
//   applies — for this set the fallback is the empty set, so
//   an unauthored configuration resolves exactly as phase A
//   left it and every generated shader stays byte-identical.
// - Any non-empty string is authoritative, including the
//   valid empty authored form '[]': an explicitly emptied set
//   stays empty instead of falling back.
// - A broken value (unreadable JSON, a malformed entry, a
//   structurally invalid set) degrades to the EMPTY SET and
//   never throws — the strict parser above reports the
//   failure and this bridge absorbs it, the same degradation
//   the sequence-tracks bridge applies to broken JSON.
// - There is NO migration: editors write the config key, so
//   the first edit promotes the edited set into the work.

/** Parse a config-key value; null when it carries no authorship. */
export function parseGlslSharedSnippetDefsConfigValue(
  serialized: unknown,
): GlslSharedSnippetDef[] | null {
  if (typeof serialized !== 'string' || serialized === '') return null;
  const parsed = parseGlslSharedSnippetDefs(serialized);
  return parsed.ok ? (parsed.defs as GlslSharedSnippetDef[]) : [];
}

/** Effective definition set: config authorship first, fallback otherwise. Pure and deterministic. */
export function resolveGlslSharedSnippetDefs(
  serialized: unknown,
  fallback: GlslSharedSnippetSet = [],
): GlslSharedSnippetDef[] {
  return parseGlslSharedSnippetDefsConfigValue(serialized) ?? [...fallback];
}

/** Serialize a definition set for the config key (the lib value's text form). */
export function serializeGlslSharedSnippetDefsForConfig(defs: GlslSharedSnippetSet): string {
  return serializeGlslSharedSnippetDefs(defs);
}

/** The definition set authored into the given config value, if any. */
export function useResolvedGlslSharedSnippetDefs(serialized: string | undefined): GlslSharedSnippetDef[] {
  return React.useMemo(() => resolveGlslSharedSnippetDefs(serialized), [serialized]);
}
