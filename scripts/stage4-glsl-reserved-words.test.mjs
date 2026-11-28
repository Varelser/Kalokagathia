// Limit plan stage 4, gate fix round 2 — GLSL reserved-word
// regression guard.
//
// Root cause pinned by the G4-1 real-GPU probe: the orient
// accumulation fragment declared `bool active = ...`, and
// `active` is a word reserved for future use in GLSL ES
// (§3.6) — ANGLE rejects it with "Illegal use of reserved
// word", the fragment never compiled, the pass never ran,
// and the posture angle stayed exactly 0 in every sample
// while every node-side test passed (the strings were only
// ever checked for substrings, never compiled). The fix
// renamed the identifier to `stepActive`; this test pins
// the whole class of bug, not just the one word:
//
//  (a) The runtime shader strings handed to three.js by the
//      two accumulated-state passes (ORIENT_FRAG — its reset
//      branch is the posture initialisation — and SPIN_FRAG)
//      contain no reserved word as an identifier token.
//  (b) The same scan over every template literal in every
//      components/gpgpu*.ts source file (vertex + fragment +
//      shared chunks), so a future chunk in any generated
//      shader is covered at its definition site.
//  (c) The specific regression: ORIENT_FRAG carries
//      `stepActive` and no bare `active` token.
//
// Method notes: comments are stripped before tokenising
// (prose may legitimately use these words); `${...}`
// interpolations are blanked (identifiers there are JS —
// an injected chunk is itself a template literal and is
// scanned at its own definition); `#include <...>` chunk
// names are blanked (three.js resolves them before the
// GLSL compiler ever sees the source, so `<common>` is not
// an identifier use). The word list is the union of the
// GLSL ES 1.00 and ES 3.00 reserved-for-future-use lists.
import { build } from 'esbuild';
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s4rw-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const RESERVED = [
  // GLSL ES 1.00 §3.6, reserved for future use.
  'active', 'asm', 'class', 'common', 'enum', 'extern', 'external',
  'filter', 'fixed', 'goto', 'inline', 'long', 'namespace', 'noinline',
  'partition', 'public', 'short', 'sizeof', 'static', 'super',
  'template', 'this', 'typedef', 'union', 'unsigned', 'using',
  'row_major', 'sampler3DRect',
  // GLSL ES 3.00 §3.6 additions.
  'cast', 'graph', 'resource',
];
const RESERVED_SET = new Set(RESERVED);

const blankKeepNewlines = (m) => m.replace(/[^\n]/g, ' ');

function stripForScan(text) {
  return text
    .replace(/#include\s*<[^>]*>/g, blankKeepNewlines)
    .replace(/\/\*[\s\S]*?\*\//g, blankKeepNewlines)
    .replace(/\/\/[^\n]*/g, blankKeepNewlines);
}

function reservedHits(text) {
  const hits = [];
  const clean = stripForScan(text);
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    if (RESERVED_SET.has(m[0])) hits.push(m[0]);
  }
  return hits;
}

// Extract template literals from TS source with ${...}
// interpolation regions blanked (see header notes).
function extractTemplateLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '`') {
      i++;
      let text = '';
      let depth = 0;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { text += '  '; i += 2; continue; }
        if (ch === '$' && src[i + 1] === '{') { depth++; text += '  '; i += 2; continue; }
        if (depth > 0) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          text += ch === '\n' ? '\n' : ' ';
          i++; continue;
        }
        if (ch === '`') { i++; break; }
        text += ch; i++;
      }
      out.push(text);
      continue;
    }
    i++;
  }
  return out;
}

await build({
  stdin: {
    contents: `
      export { ORIENT_FRAG } from './components/gpgpuOrientPass.ts';
      export { SPIN_FRAG } from './components/gpgpuSpinPass.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  outfile: BUNDLE,
});

try {
  const { ORIENT_FRAG, SPIN_FRAG } = await import(pathToFileURL(BUNDLE).href);

  // ── (a) runtime strings of the accumulated-state passes ──
  check('(a) ORIENT_FRAG (accumulation + reset/initialisation) has no reserved-word identifier',
    reservedHits(ORIENT_FRAG).length === 0, reservedHits(ORIENT_FRAG).join(','));
  check('(a) SPIN_FRAG (spin accumulation) has no reserved-word identifier',
    reservedHits(SPIN_FRAG).length === 0, reservedHits(SPIN_FRAG).join(','));

  // ── (c) the specific regression ──
  check('(c) ORIENT_FRAG uses stepActive and no bare `active` token',
    ORIENT_FRAG.includes('bool stepActive =') && ORIENT_FRAG.includes('stepActive = false')
    && ORIENT_FRAG.includes('if (stepActive)')
    && !reservedHits(ORIENT_FRAG).includes('active'));

  // ── (b) every generated-shader source file ──
  const compDir = join(ROOT, 'components');
  const files = readdirSync(compDir)
    .filter((f) => f.startsWith('gpgpu') && (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.bak'))
    .sort();
  check('(b) scan found the generated-shader source files', files.length >= 30, `${files.length} files`);
  for (const f of files) {
    const src = readFileSync(join(compDir, f), 'utf8');
    const hits = extractTemplateLiterals(src).flatMap((lit) => reservedHits(lit));
    check(`(b) ${f}: no reserved-word identifier in any template literal`,
      hits.length === 0, [...new Set(hits)].join(','));
  }

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
