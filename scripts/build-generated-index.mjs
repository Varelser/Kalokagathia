#!/usr/bin/env node
// Build the lazy index for the GENERATED preset collection (the 746
// presets generated 2026-11-09..11 that live OUTSIDE the app bundle as
// static files: /presets/<id>.json + /catalog/thumbs/<id>.jpg +
// /share/<id>). The in-app shelf lists only the built-in starter library;
// this index lets the shelf offer the generated collection as its own
// group without inlining 746 configs (~15 MB) into the JS bundle.
//
// Output: public/generated-collection.json (copied by Vite to dist/,
// fetched lazily by lib/generatedCollection.ts on first use).
// Format (compact tuples): { v, count, presets: [[id, name, seriesKey]] }
//
// Authoritative source, in priority order:
//   1. ../../site/presets/*.json  — the exact files the live site serves
//      (id + name read from each record).
//   2. Env batch files generated-presets-*.json under ../../preset-analysis/
//      and the project root ({"presets":[...]}), deduped by id.
// If neither exists, an empty index is written and the build continues —
// the shelf group then reports itself unavailable instead of breaking.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditRoot = path.resolve(projectRoot, '..');
const outFile = path.join(projectRoot, 'public', 'generated-collection.json');

// Series key = id prefix before the first '-'. Labels/order live in
// lib/generatedCollection.ts; the generator only needs stable keys.
const seriesKeyOf = (id) => {
  const dash = id.indexOf('-');
  return dash > 0 ? id.slice(0, dash) : id;
};

const byId = new Map();
const addRecord = (rec) => {
  if (!rec || typeof rec.id !== 'string' || typeof rec.name !== 'string') return;
  if (!byId.has(rec.id)) byId.set(rec.id, rec.name);
};

let source = null;

// --- source 1: the served per-preset JSONs -------------------------------
const sitePresetsDir = path.join(auditRoot, 'site', 'presets');
if (fs.existsSync(sitePresetsDir)) {
  const files = fs.readdirSync(sitePresetsDir).filter((f) => f.endsWith('.json')).sort();
  let parsed = 0;
  for (const file of files) {
    try {
      addRecord(JSON.parse(fs.readFileSync(path.join(sitePresetsDir, file), 'utf8')));
      parsed += 1;
    } catch {
      console.warn(`[generated-index] skipped unparsable ${file}`);
    }
  }
  if (parsed > 0) source = `site/presets (${parsed} files)`;
}

// --- source 2: env batch files -------------------------------------------
if (byId.size === 0) {
  const envDirs = [path.join(auditRoot, 'preset-analysis'), projectRoot];
  for (const dir of envDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith('generated-presets-') && f.endsWith('.json'))
      .sort();
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        const list = Array.isArray(data) ? data : data.presets;
        if (Array.isArray(list)) list.forEach(addRecord);
      } catch {
        console.warn(`[generated-index] skipped unparsable ${file}`);
      }
    }
  }
  if (byId.size > 0) source = 'env batch files (fallback)';
}

const presets = [...byId.entries()]
  .map(([id, name]) => [id, name, seriesKeyOf(id)])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const perSeries = {};
presets.forEach(([, , series]) => {
  perSeries[series] = (perSeries[series] ?? 0) + 1;
});

const payload = { v: 1, count: presets.length, presets };
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload));

if (presets.length === 0) {
  console.warn('[generated-index] WARNING: no source found — wrote an empty index; the shelf Generated group will show as unavailable.');
} else {
  console.log(`[generated-index] ${presets.length} presets from ${source} -> public/generated-collection.json`);
  console.log(`[generated-index] per-series: ${Object.entries(perSeries).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}
