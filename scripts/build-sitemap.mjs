#!/usr/bin/env node
// Build sitemap.xml for the live site (audit fix 2026-11-14): the app root,
// the generated-preset catalog gallery, and every generated preset's
// extensionless share page (/share/<id>).
//
// Output: public/sitemap.xml (copied by Vite to dist/ on every build, so
// future builds keep it in sync with the collection).
//
// Authoritative source for the ids, in priority order (same policy as
// scripts/build-generated-index.mjs):
//   1. ../../site/presets/*.json — the exact files the live site serves.
//   2. generated-presets-*.json batch files under ../../preset-analysis/
//      and the project root ({"presets":[...]}), deduped by id.
// If neither exists, a root+catalog-only sitemap is written and the build
// continues.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditRoot = path.resolve(projectRoot, '..');
const outFile = path.join(projectRoot, 'public', 'sitemap.xml');
const ORIGIN = 'https://monosphere.pages.dev';

const ids = new Set();
let source = null;

// --- source 1: the served per-preset JSONs -------------------------------
const sitePresetsDir = path.join(auditRoot, 'site', 'presets');
if (fs.existsSync(sitePresetsDir)) {
  const files = fs.readdirSync(sitePresetsDir).filter((f) => f.endsWith('.json')).sort();
  let parsed = 0;
  for (const file of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(sitePresetsDir, file), 'utf8'));
      if (rec && typeof rec.id === 'string') { ids.add(rec.id); parsed += 1; }
    } catch {
      console.warn(`[sitemap] skipped unparsable ${file}`);
    }
  }
  if (parsed > 0) source = `site/presets (${parsed} files)`;
}

// --- source 2: env batch files (fallback / top-up) ------------------------
if (ids.size === 0) {
  const candidates = [];
  for (const dir of [path.join(auditRoot, 'preset-analysis'), projectRoot]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/^generated-presets-.*\.json$/.test(f)) candidates.push(path.join(dir, f));
    }
  }
  for (const file of candidates.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = Array.isArray(data) ? data : data.presets;
      if (!Array.isArray(list)) continue;
      for (const rec of list) {
        if (rec && typeof rec.id === 'string') ids.add(rec.id);
      }
    } catch {
      console.warn(`[sitemap] skipped unparsable ${path.basename(file)}`);
    }
  }
  if (ids.size > 0) source = `batch files (${candidates.length})`;
}

const sorted = [...ids].sort();
const urls = [
  { loc: `${ORIGIN}/`, priority: '1.0' },
  { loc: `${ORIGIN}/catalog/`, priority: '0.8' },
  ...sorted.map((id) => ({ loc: `${ORIGIN}/share/${encodeURIComponent(id)}`, priority: '0.6' })),
];

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map((u) => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`),
  '</urlset>',
  '',
].join('\n');

fs.writeFileSync(outFile, xml);
console.log(`[sitemap] wrote ${outFile} — ${urls.length} urls (${sorted.length} share pages) from ${source ?? 'no source (root+catalog only)'}`);
