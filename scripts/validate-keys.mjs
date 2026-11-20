#!/usr/bin/env node
// validate-keys.mjs — Phase DA4: did-you-mean key validation for preset /
// config JSON files.
//
// There is no canonical key registry in this codebase: ParticleConfig keys
// are spread across the default definitions (lib/appStateDefault*.ts),
// the type definitions (types/config*.ts) and the normalization layer
// (lib/appStateConfigNormalization.ts). This script DERIVES the known-key
// set from those sources at run time (textual scan, node stdlib only):
//
//   1. lib/appStateDefault*.ts        — top-level keys of each exported
//                                       APP_STATE_DEFAULT_* object literal.
//   2. types/config*.ts               — fields of the ParticleConfig*
//                                       interfaces (independent cross-check
//                                       of source 1; a symmetric difference
//                                       is reported as a derivation warning).
//   3. lib/appStateConfigNormalization.ts — string literals of
//                                       CONFIG_ARRAY_KEYS (keys the
//                                       normalizer explicitly handles).
//
// Structural (non-config) key sets are derived the same way:
//   PresetLibraryData / PresetRecord  from types/presets.ts,
//   PresetSequenceItem                from types/sequence.ts,
//   ProjectData                       from types/project.ts.
//
// The derived config-key set is fingerprinted (SHA-256 over the sorted key
// list). --record stores the fingerprint; --check fails when the derived
// set drifts from the record, so a silent key addition/removal (the
// "new key changed the picture" failure mode) has to be acknowledged by
// re-recording with a reason.
//
// Usage:
//   node scripts/validate-keys.mjs [options] [fileOrDir ...]
//     (no targets)      scan the preset-library JSON files at the repo root
//                       (generated-presets-*.json, showcase-presets-*.json,
//                       frontier-presets-*.json) plus public-library.json
//     --record [path]   write fingerprint record
//                       (default: scripts/validate-keys.fingerprint.json)
//     --check  [path]   compare against the fingerprint record; exit 1 on
//                       drift and list added/removed keys
//     --json            print the full report as JSON
//   Exit codes: 0 = clean, 1 = unknown keys / fingerprint drift,
//               2 = usage or I/O error.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RECORD_PATH = join(ROOT, 'scripts', 'validate-keys.fingerprint.json');
const MAX_SUGGESTION_DISTANCE = 2;

// ---------------------------------------------------------------------------
// Source masking: blank out comments and string/template contents so that
// structural scanning (brace depth, key regexes) is not confused by them.
// Length and newlines are preserved.
// ---------------------------------------------------------------------------
function maskSource(src) {
  const out = src.split('');
  const blank = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  // Stack entries: 'code' | 'template'. Template interpolation ${ } pushes
  // a brace counter so we can return to template mode correctly.
  const stack = [];
  let state = 'code'; // code | line | block | single | double | template
  let braceDepthInInterp = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1] ?? '';
    if (state === 'code') {
      if (c === '/' && next === '/') { blank(i); blank(i + 1); i += 2; state = 'line'; continue; }
      if (c === '/' && next === '*') { blank(i); blank(i + 1); i += 2; state = 'block'; continue; }
      if (c === "'") { blank(i); i += 1; state = 'single'; continue; }
      if (c === '"') { blank(i); i += 1; state = 'double'; continue; }
      if (c === '`') { blank(i); i += 1; state = 'template'; continue; }
      if (c === '}' && stack.length > 0 && braceDepthInInterp === 0) {
        // Closing a template interpolation: resume template mode.
        stack.pop(); blank(i); i += 1; state = 'template'; continue;
      }
      if (stack.length > 0) {
        if (c === '{') braceDepthInInterp += 1;
        if (c === '}') braceDepthInInterp -= 1;
      }
      i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; i += 1; continue; }
      blank(i); i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { blank(i); blank(i + 1); i += 2; state = 'code'; continue; }
      blank(i); i += 1; continue;
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (c === '\\') { blank(i); if (i + 1 < src.length) blank(i + 1); i += 2; continue; }
      blank(i); i += 1;
      if (c === quote) state = 'code';
      continue;
    }
    // template
    if (c === '\\') { blank(i); if (i + 1 < src.length) blank(i + 1); i += 2; continue; }
    if (c === '$' && next === '{') {
      blank(i); blank(i + 1); i += 2;
      stack.push('interp'); braceDepthInInterp = 0; state = 'code'; continue;
    }
    blank(i); i += 1;
    if (c === '`') state = 'code';
  }
  return out.join('');
}

// Extract the top-level (depth-1) property names of the object literal or
// interface body whose opening brace is at `openIdx` in a masked source.
function extractTopLevelKeys(masked, openIdx) {
  const keys = new Set();
  let depth = 0;
  let i = openIdx;
  const ident = /[A-Za-z_$][A-Za-z0-9_$]*/y;
  while (i < masked.length) {
    const c = masked[i];
    if (c === '{') { depth += 1; i += 1; continue; }
    if (c === '}') {
      depth -= 1; i += 1;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1 && /[A-Za-z_$]/.test(c)) {
      ident.lastIndex = i;
      const m = ident.exec(masked);
      if (m) {
        // A key is an identifier followed by ':' (or '?:' for optional
        // interface fields). Method signatures (followed by '(') and
        // plain value references are not keys.
        let j = i + m[0].length;
        while (j < masked.length && /\s/.test(masked[j])) j += 1;
        if (masked[j] === '?') {
          j += 1;
          while (j < masked.length && /\s/.test(masked[j])) j += 1;
        }
        if (masked[j] === ':') keys.add(m[0]);
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return keys;
}

function keysFromObjectLiterals(filePath, anchorRe) {
  const masked = maskSource(readFileSync(filePath, 'utf8'));
  const keys = new Set();
  let m;
  const re = new RegExp(anchorRe.source, 'g');
  while ((m = re.exec(masked)) !== null) {
    const openIdx = masked.indexOf('{', m.index);
    if (openIdx === -1) continue;
    for (const k of extractTopLevelKeys(masked, openIdx)) keys.add(k);
  }
  return keys;
}

function keysFromInterfaces(filePath, nameRe) {
  return keysFromObjectLiterals(filePath, new RegExp(`export\\s+interface\\s+(?:${nameRe.source})\\b`));
}

function listFiles(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .map((name) => join(dir, name))
    .sort();
}

// ---------------------------------------------------------------------------
// Derivation of the known-key sets.
// ---------------------------------------------------------------------------
function deriveKeySets() {
  const perSource = {};

  const defaultFiles = listFiles(join(ROOT, 'lib'), /^appStateDefault.*\.ts$/);
  const fromDefaults = new Set();
  for (const f of defaultFiles) {
    for (const k of keysFromObjectLiterals(f, /export\s+const\s+\w+[^=]*=/)) fromDefaults.add(k);
  }
  perSource.defaults = { files: defaultFiles.map((f) => basename(f)), count: fromDefaults.size };

  const typeFiles = listFiles(join(ROOT, 'types'), /^config.*\.ts$/);
  const fromTypes = new Set();
  for (const f of typeFiles) {
    for (const k of keysFromInterfaces(f, /ParticleConfig\w*/)) fromTypes.add(k);
  }
  perSource.types = { files: typeFiles.map((f) => basename(f)), count: fromTypes.size };

  const normPath = join(ROOT, 'lib', 'appStateConfigNormalization.ts');
  const fromNormalization = new Set();
  if (existsSync(normPath)) {
    const raw = readFileSync(normPath, 'utf8');
    const arr = raw.match(/CONFIG_ARRAY_KEYS\s*=\s*\[([\s\S]*?)\]/);
    if (arr) {
      for (const m of arr[1].matchAll(/'([A-Za-z0-9_$]+)'/g)) fromNormalization.add(m[1]);
    }
  }
  perSource.normalization = { files: ['appStateConfigNormalization.ts (CONFIG_ARRAY_KEYS)'], count: fromNormalization.size };

  const knownConfigKeys = new Set([...fromDefaults, ...fromTypes, ...fromNormalization]);
  const derivationWarnings = [];
  const onlyDefaults = [...fromDefaults].filter((k) => !fromTypes.has(k)).sort();
  const onlyTypes = [...fromTypes].filter((k) => !fromDefaults.has(k)).sort();
  if (onlyDefaults.length > 0) derivationWarnings.push(`keys in defaults but not in types: ${onlyDefaults.join(', ')}`);
  if (onlyTypes.length > 0) derivationWarnings.push(`keys in types but not in defaults: ${onlyTypes.join(', ')}`);
  const normOutside = [...fromNormalization].filter((k) => !fromDefaults.has(k) && !fromTypes.has(k)).sort();
  if (normOutside.length > 0) derivationWarnings.push(`CONFIG_ARRAY_KEYS entries outside defaults/types: ${normOutside.join(', ')}`);

  const structural = {
    library: keysFromInterfaces(join(ROOT, 'types', 'presets.ts'), /PresetLibraryData/),
    record: keysFromInterfaces(join(ROOT, 'types', 'presets.ts'), /PresetRecord/),
    sequenceItem: keysFromInterfaces(join(ROOT, 'types', 'sequence.ts'), /PresetSequenceItem/),
    project: keysFromInterfaces(join(ROOT, 'types', 'project.ts'), /ProjectData/),
  };

  return { knownConfigKeys, perSource, derivationWarnings, structural };
}

// ---------------------------------------------------------------------------
// Levenshtein distance (self-implemented; no dependencies).
// ---------------------------------------------------------------------------
function levenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;
  for (let i = 1; i <= la; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

function suggestionsFor(key, knownSet) {
  const found = [];
  for (const candidate of knownSet) {
    if (Math.abs(candidate.length - key.length) > MAX_SUGGESTION_DISTANCE) continue;
    const d = levenshtein(key, candidate);
    if (d <= MAX_SUGGESTION_DISTANCE) found.push({ candidate, distance: d });
  }
  found.sort((x, y) => x.distance - y.distance || x.candidate.localeCompare(y.candidate));
  return found.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Fingerprint: SHA-256 over the sorted key list (one key per line).
// ---------------------------------------------------------------------------
function fingerprintOf(keySet) {
  const sorted = [...keySet].sort();
  const hash = createHash('sha256').update(sorted.join('\n') + '\n', 'utf8').digest('hex');
  return { hash, sorted };
}

// ---------------------------------------------------------------------------
// Target collection and scanning.
// ---------------------------------------------------------------------------
function defaultTargets() {
  const rootJson = listFiles(ROOT, /presets.*\.json$/i);
  const extra = join(ROOT, 'public-library.json');
  const targets = [...rootJson];
  if (existsSync(extra) && !targets.includes(extra)) targets.push(extra);
  return targets.sort();
}

function expandTargets(args) {
  const files = [];
  for (const arg of args) {
    const p = resolve(arg);
    if (!existsSync(p)) {
      console.error(`error: target not found: ${arg}`);
      process.exit(2);
    }
    if (statSync(p).isDirectory()) {
      const walk = (dir) => {
        for (const name of readdirSync(dir).sort()) {
          if (name === 'node_modules' || name.startsWith('.')) continue;
          const child = join(dir, name);
          if (statSync(child).isDirectory()) walk(child);
          else if (name.endsWith('.json')) files.push(child);
        }
      };
      walk(p);
    } else {
      files.push(p);
    }
  }
  return files;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scanFile(filePath, sets) {
  const rel = filePath.startsWith(ROOT) ? filePath.slice(ROOT.length + 1) : filePath;
  const result = { file: rel, status: 'scanned', configObjects: 0, unknown: [], notes: [], observedConfigKeys: new Set() };
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    result.status = 'error';
    result.notes.push(`JSON parse error: ${err.message}`);
    return result;
  }
  // Shape gate: a preset-library / project export has a currentConfig
  // object and/or a presets array of record objects. Files that merely
  // carry a "presets" key of another schema (e.g. the generated index,
  // whose presets are [id, name, family] tuples) are skipped, not flagged.
  const hasCurrentConfig = isPlainObject(data?.currentConfig);
  const hasRecordPresets = Array.isArray(data?.presets)
    && (data.presets.length === 0 || isPlainObject(data.presets[0]));
  if (!isPlainObject(data) || (!hasCurrentConfig && !hasRecordPresets)) {
    result.status = 'skipped';
    result.notes.push('not a preset-library / project export shape (no currentConfig object or record-style presets[])');
    return result;
  }

  const unknownMap = new Map(); // key -> {context, count}
  const noteUnknown = (key, context, knownSet) => {
    const id = `${context}:${key}`;
    if (!unknownMap.has(id)) {
      unknownMap.set(id, { key, context, count: 0, suggestions: suggestionsFor(key, knownSet) });
    }
    unknownMap.get(id).count += 1;
  };
  const checkKeys = (obj, allowed, context, knownSet) => {
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) noteUnknown(key, context, knownSet);
    }
  };
  const checkConfig = (obj, context) => {
    result.configObjects += 1;
    for (const key of Object.keys(obj)) result.observedConfigKeys.add(key);
    checkKeys(obj, sets.knownConfigKeys, context, sets.knownConfigKeys);
  };

  const topAllowed = new Set([...sets.structural.library, ...sets.structural.project]);
  const shape = ('schema' in data || 'serialization' in data || 'manifest' in data || 'ui' in data) ? 'project' : 'library';
  result.shape = shape;
  checkKeys(data, topAllowed, `top-level (${shape})`, topAllowed);

  if (isPlainObject(data.currentConfig)) checkConfig(data.currentConfig, 'currentConfig');
  if (Array.isArray(data.presets)) {
    data.presets.forEach((preset, idx) => {
      if (!isPlainObject(preset)) return;
      checkKeys(preset, sets.structural.record, `presets[${idx}] record`, sets.structural.record);
      if (isPlainObject(preset.config)) checkConfig(preset.config, `presets[${idx}].config`);
    });
  }
  if (Array.isArray(data.presetSequence)) {
    data.presetSequence.forEach((item, idx) => {
      if (!isPlainObject(item)) return;
      checkKeys(item, sets.structural.sequenceItem, `presetSequence[${idx}]`, sets.structural.sequenceItem);
      if (isPlainObject(item.keyframeConfig)) checkConfig(item.keyframeConfig, `presetSequence[${idx}].keyframeConfig`);
    });
  }

  result.unknown = [...unknownMap.values()];
  return result;
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { json: false, record: null, check: null, targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--record' || arg === '--check') {
      const mode = arg.slice(2);
      let path = DEFAULT_RECORD_PATH;
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { path = resolve(argv[i + 1]); i += 1; }
      opts[mode] = path;
    } else if (arg.startsWith('--record=')) opts.record = resolve(arg.slice('--record='.length));
    else if (arg.startsWith('--check=')) opts.check = resolve(arg.slice('--check='.length));
    else if (arg.startsWith('--')) {
      console.error(`error: unknown option: ${arg}`);
      process.exit(2);
    } else opts.targets.push(arg);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sets = deriveKeySets();
  const { hash, sorted } = fingerprintOf(sets.knownConfigKeys);

  const targetFiles = opts.targets.length > 0 ? expandTargets(opts.targets) : defaultTargets();
  const observed = new Set();
  const results = [];
  for (const file of targetFiles) {
    results.push(scanFile(file, sets));
  }
  // Collect the config keys actually observed across all scanned files.
  for (const r of results) {
    if (r.observedConfigKeys instanceof Set) {
      for (const k of r.observedConfigKeys) observed.add(k);
    }
  }

  const scanned = results.filter((r) => r.status === 'scanned');
  const skipped = results.filter((r) => r.status === 'skipped');
  const errored = results.filter((r) => r.status === 'error');
  const totalUnknown = scanned.reduce((n, r) => n + r.unknown.length, 0);
  const totalConfigObjects = scanned.reduce((n, r) => n + r.configObjects, 0);
  const definedButUnused = sorted.filter((k) => !observed.has(k));
  const observedFp = fingerprintOf(observed);

  let fingerprintCheck = null;
  if (opts.record) {
    const record = {
      version: 1,
      algorithm: 'sha256(sorted keys joined by newline)',
      fingerprint: hash,
      keyCount: sorted.length,
      keys: sorted,
      recordedAt: new Date().toISOString(),
    };
    writeFileSync(opts.record, JSON.stringify(record, null, 2) + '\n', 'utf8');
    fingerprintCheck = { mode: 'record', path: opts.record, fingerprint: hash };
  } else if (opts.check) {
    if (!existsSync(opts.check)) {
      console.error(`error: fingerprint record not found: ${opts.check} (run with --record first)`);
      process.exit(2);
    }
    const record = JSON.parse(readFileSync(opts.check, 'utf8'));
    const recordedKeys = new Set(record.keys ?? []);
    const added = sorted.filter((k) => !recordedKeys.has(k));
    const removed = [...recordedKeys].filter((k) => !sets.knownConfigKeys.has(k)).sort();
    fingerprintCheck = {
      mode: 'check',
      path: opts.check,
      recordedFingerprint: record.fingerprint,
      currentFingerprint: hash,
      match: record.fingerprint === hash && added.length === 0 && removed.length === 0,
      added,
      removed,
    };
  }

  const report = {
    derivation: {
      perSource: sets.perSource,
      knownConfigKeyCount: sets.knownConfigKeys.size,
      warnings: sets.derivationWarnings,
      structuralCounts: {
        library: sets.structural.library.size,
        record: sets.structural.record.size,
        sequenceItem: sets.structural.sequenceItem.size,
        project: sets.structural.project.size,
      },
    },
    fingerprint: { algorithm: 'sha256', value: hash, keyCount: sorted.length },
    fingerprintCheck,
    scan: {
      filesConsidered: results.length,
      filesScanned: scanned.length,
      filesSkipped: skipped.map((r) => ({ file: r.file, notes: r.notes })),
      filesErrored: errored.map((r) => ({ file: r.file, notes: r.notes })),
      configObjects: totalConfigObjects,
      observedConfigKeyCount: observed.size,
      observedFingerprint: observedFp.hash,
      definedButUnusedKeys: definedButUnused,
      unknownKeyCount: totalUnknown,
      files: scanned.map((r) => ({
        file: r.file,
        shape: r.shape,
        configObjects: r.configObjects,
        unknown: r.unknown,
      })),
    },
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('validate-keys (DA4): did-you-mean key validation');
    console.log(`  derived known config keys: ${sets.knownConfigKeys.size} ` +
      `(defaults ${sets.perSource.defaults.count} / types ${sets.perSource.types.count} / normalization ${sets.perSource.normalization.count})`);
    for (const w of sets.derivationWarnings) console.log(`  derivation warning: ${w}`);
    console.log(`  fingerprint (sha256, sorted known keys): ${hash}`);
    if (fingerprintCheck?.mode === 'record') {
      console.log(`  fingerprint recorded to: ${fingerprintCheck.path}`);
    }
    if (fingerprintCheck?.mode === 'check') {
      if (fingerprintCheck.match) {
        console.log('  fingerprint check: MATCH (key set unchanged since record)');
      } else {
        console.log('  fingerprint check: DRIFT DETECTED — a reason is required before re-recording.');
        if (fingerprintCheck.added.length > 0) console.log(`    added keys:   ${fingerprintCheck.added.join(', ')}`);
        if (fingerprintCheck.removed.length > 0) console.log(`    removed keys: ${fingerprintCheck.removed.join(', ')}`);
      }
    }
    console.log(`  scanned ${scanned.length} files, ${totalConfigObjects} config objects, ` +
      `${observed.size} distinct config keys observed`);
    if (skipped.length > 0) console.log(`  skipped ${skipped.length} files (not preset-library shape)`);
    if (definedButUnused.length > 0) {
      const shown = definedButUnused.length > 12
        ? `${definedButUnused.slice(0, 12).join(', ')}, … (full list via --json)`
        : definedButUnused.join(', ');
      console.log(`  defined but unused in scanned data (${definedButUnused.length}): ${shown}`);
    }
    if (totalUnknown === 0 && errored.length === 0) {
      console.log('  result: OK — no unknown keys');
    } else {
      for (const r of scanned) {
        for (const u of r.unknown) {
          const hint = u.suggestions.length > 0
            ? ` — did you mean ${u.suggestions.map((s) => `'${s.candidate}' (distance ${s.distance})`).join(' / ')}?`
            : ' — no close candidate (distance > 2)';
          console.log(`  UNKNOWN ${r.file} [${u.context}] '${u.key}' x${u.count}${hint}`);
        }
      }
      for (const r of errored) console.log(`  ERROR ${r.file}: ${r.notes.join('; ')}`);
      console.log(`  result: FAIL — ${totalUnknown} unknown key(s), ${errored.length} file error(s)`);
    }
  }

  const drift = fingerprintCheck?.mode === 'check' && !fingerprintCheck.match;
  process.exit(totalUnknown > 0 || errored.length > 0 || drift ? 1 : 0);
}

main();
