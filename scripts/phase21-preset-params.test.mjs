// Phase 21 stage 1 — User Parameters propagation through #p= links.
// Identity: a preset record without declarations stays shape-
// identical; declarations are sanitised on capture, on persistence
// normalisation and on catalog fetch; the session overlay discipline
// (never localStorage) is inherited from stage 18-5.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p21s1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const storageWrites = [];
const storageData = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storageData.has(k) ? storageData.get(k) : null),
    setItem: (k, v) => { storageWrites.push(k); storageData.set(k, String(v)); },
    removeItem: (k) => { storageData.delete(k); },
  },
  history: { replaceState: () => {} },
  location: { pathname: '/', search: '' },
};

await build({
  stdin: {
    contents: `
      export { presetSessionDeclarations, fetchCatalogPreset } from './lib/shareLink.ts';
      export { sanitizeUserParameters, setUserParameters, getUserParameters, setSessionUserParameters, clearSessionUserParameters, getSessionUserParameters } from './lib/userParameters.ts';
      export { createPresetRecord, duplicatePresetRecord } from './lib/presetRecordFactory.ts';
      export { parsePersistedPresetRecords } from './lib/appStateLibrary.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { presetSessionDeclarations, fetchCatalogPreset, sanitizeUserParameters, setUserParameters, getUserParameters, setSessionUserParameters, clearSessionUserParameters, createPresetRecord, duplicatePresetRecord, parsePersistedPresetRecords } = lib;

const decl = { id: 'up-p21-1', label: 'Ambient', group: 'Light', key: 'sdfAmbientLight', defaultValue: 0.5 };
const decl2 = { id: 'up-p21-2', label: 'Blend', group: '', key: 'gpgpuBlendMode', defaultValue: 'additive' };
const broken = { id: 'bad', label: 'Bad', group: '', key: 'noSuchKeyXYZ', defaultValue: 1 };
const baseConfig = { sdfAmbientLight: 0.25 };

// --- presetSessionDeclarations ------------------------------------
check('absent field yields []', presetSessionDeclarations({}).length === 0);
check('null record yields []', presetSessionDeclarations(null).length === 0);
check('valid declarations pass through sanitised', JSON.stringify(presetSessionDeclarations({ userParameters: [decl, decl2] })) === JSON.stringify(sanitizeUserParameters([decl, decl2])));
check('broken declarations dropped', presetSessionDeclarations({ userParameters: [decl, broken] }).length === 1);
check('all-broken yields []', presetSessionDeclarations({ userParameters: [broken] }).length === 0);

// --- factory capture ----------------------------------------------
{
  setUserParameters([]);
  const plain = createPresetRecord(baseConfig, 'Plain', 0);
  check('zero saved declarations: record has no userParameters field', !('userParameters' in plain), JSON.stringify(Object.keys(plain)));

  setUserParameters([decl]);
  const captured = createPresetRecord(baseConfig, 'Captured', 1);
  check('saved declarations captured on new preset', captured.userParameters?.length === 1 && captured.userParameters[0].id === decl.id, JSON.stringify(captured.userParameters));

  const dupPlain = duplicatePresetRecord(plain);
  check('duplicate of legacy record stays legacy shape', !('userParameters' in dupPlain));
  const dupCaptured = duplicatePresetRecord(captured);
  check('duplicate carries declarations', dupCaptured.userParameters?.length === 1 && dupCaptured.userParameters[0].id === decl.id);
  setUserParameters([]);
}

// --- persistence normalisation -------------------------------------
{
  const legacyJson = JSON.stringify([{ id: 'a', name: 'A', config: baseConfig, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]);
  const legacy = parsePersistedPresetRecords(legacyJson);
  check('legacy persisted record round-trips without the field', legacy?.length === 1 && !('userParameters' in legacy[0]));

  const withDecls = JSON.stringify([{ id: 'b', name: 'B', config: baseConfig, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', userParameters: [decl, broken] }]);
  const parsed = parsePersistedPresetRecords(withDecls);
  check('persisted declarations preserved + sanitised', parsed?.[0]?.userParameters?.length === 1 && parsed[0].userParameters[0].id === decl.id, JSON.stringify(parsed?.[0]?.userParameters));
}

// --- catalog fetch sanitisation ------------------------------------
{
  const originalFetch = globalThis.fetch;
  const payload = { id: 'cat-1', name: 'Cat', config: baseConfig, createdAt: 'x', updatedAt: 'x', userParameters: [decl, broken] };
  globalThis.fetch = async () => ({ headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(payload)) });
  const rec = await fetchCatalogPreset('cat-1');
  check('catalog record declarations sanitised', rec?.userParameters?.length === 1 && rec.userParameters[0].id === decl.id);

  const payloadBroken = { ...payload, userParameters: [broken] };
  globalThis.fetch = async () => ({ headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(payloadBroken)) });
  const rec2 = await fetchCatalogPreset('cat-1');
  check('catalog all-broken declarations drop the field', rec2 && !('userParameters' in rec2));

  const payloadLegacy = { id: 'cat-1', name: 'Cat', config: baseConfig, createdAt: 'x', updatedAt: 'x' };
  globalThis.fetch = async () => ({ headers: { get: () => 'application/json' }, json: async () => JSON.parse(JSON.stringify(payloadLegacy)) });
  const rec3 = await fetchCatalogPreset('cat-1');
  check('legacy catalog record untouched', rec3 && !('userParameters' in rec3) && rec3.name === 'Cat');
  globalThis.fetch = originalFetch;
}

// --- overlay discipline via the #p path ----------------------------
{
  setUserParameters([{ id: 'saved-1', label: 'SavedParam', group: '', key: 'sdfAmbientLight', defaultValue: 0.1 }]);
  const writesAfterSave = storageWrites.length;
  const bundled = presetSessionDeclarations({ userParameters: [decl, decl2] });
  if (bundled.length > 0) setSessionUserParameters(bundled);
  check('#p overlay wins over saved', getUserParameters().map((d) => d.id).join(',') === 'up-p21-1,up-p21-2');
  check('#p overlay wrote nothing to localStorage', storageWrites.length === writesAfterSave);
  clearSessionUserParameters();
  check('clearing #p overlay restores saved', getUserParameters()[0]?.id === 'saved-1');
  setUserParameters([]);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
