// Phase 18 stage 5 — User Parameters propagation through #c= links.
// Identity: zero declarations => payload bytes identical to legacy
// {name, config}; legacy payloads decode unchanged; unknown fields
// are ignored by the decoder (forward compatibility).
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p18s5-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

// Mock window/localStorage BEFORE any library call (modules read
// window lazily). Records every write so the test can prove the
// session overlay never touches localStorage.
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
      export { encodeConfigPayload, decodeConfigPayload } from './lib/shareLink.ts';
      export { sanitizeUserParameters, setUserParameters, getUserParameters, getSavedUserParameters, setSessionUserParameters, clearSessionUserParameters, getSessionUserParameters, USER_PARAMETERS_STORAGE_KEY, MAX_USER_PARAMETERS } from './lib/userParameters.ts';
      export { handleEmbedControlMessage } from './lib/embedControl.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  define: { __LIBRARY_SCOPE__: '"private"' },
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { encodeConfigPayload, decodeConfigPayload, sanitizeUserParameters, setUserParameters, getUserParameters, getSavedUserParameters, setSessionUserParameters, clearSessionUserParameters, getSessionUserParameters, USER_PARAMETERS_STORAGE_KEY, MAX_USER_PARAMETERS } = lib;
const { handleEmbedControlMessage } = lib;

// Raw legacy encoder (the pre-stage-5 code path, verbatim logic).
async function encodeRaw(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; packed.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const config = { sdfAmbientLight: 0.25, gpgpuBlendMode: 'normal' };
const decl = { id: 'up-test-1', label: 'Ambient', group: 'Light', key: 'sdfAmbientLight', defaultValue: 0.5 };
const decl2 = { id: 'up-test-2', label: 'Blend', group: '', key: 'gpgpuBlendMode', defaultValue: 'additive' };

// --- encode / decode round-trip --------------------------------
{
  const withDecls = await encodeConfigPayload('Scene', config, [decl, decl2]);
  check('encode with declarations succeeds', typeof withDecls === 'string' && withDecls.length > 0);
  const decoded = await decodeConfigPayload(withDecls);
  check('round-trip: name preserved', decoded?.name === 'Scene');
  check('round-trip: config preserved', JSON.stringify(decoded?.config) === JSON.stringify(config));
  check('round-trip: declarations restored exactly', JSON.stringify(decoded?.userParameters) === JSON.stringify(sanitizeUserParameters([decl, decl2])),
    JSON.stringify(decoded?.userParameters));

  const noDecls = await encodeConfigPayload('Scene', config);
  const emptyDecls = await encodeConfigPayload('Scene', config, []);
  const legacy = await encodeRaw({ name: 'Scene', config });
  check('no declarations == legacy payload bytes', noDecls === legacy, `${noDecls} vs ${legacy}`);
  check('empty declarations == legacy payload bytes', emptyDecls === legacy);
  const decodedLegacy = await decodeConfigPayload(legacy);
  check('legacy payload decodes (backward compat)', decodedLegacy?.name === 'Scene' && JSON.stringify(decodedLegacy?.config) === JSON.stringify(config));
  check('legacy payload carries no userParameters field', decodedLegacy && !('userParameters' in decodedLegacy));

  // Unknown-field payload: current decoder must ignore extras and
  // still apply config — this is what lets an OLD build read a NEW
  // link (it only ever reads name/config).
  const withUnknown = await encodeRaw({ name: 'Scene', config, userParameters: [decl], futureField: { x: 1 } });
  const decodedUnknown = await decodeConfigPayload(withUnknown);
  check('unknown fields ignored, config intact', decodedUnknown?.name === 'Scene' && JSON.stringify(decodedUnknown?.config) === JSON.stringify(config));
  check('known bundled field still read beside unknown fields', decodedUnknown?.userParameters?.length === 1);
}

// --- bundled declaration validation -----------------------------
{
  const broken = { id: 'bad', label: 'Bad', group: '', key: 'noSuchKeyXYZ', defaultValue: 1 };
  const encoded = await encodeConfigPayload('S', config, [decl, broken]);
  const decoded = await decodeConfigPayload(encoded);
  check('broken declaration dropped from bundle', decoded?.userParameters?.length === 1 && decoded.userParameters[0].id === decl.id);

  const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, label: `P${i}`, group: '', key: 'sdfAmbientLight', defaultValue: 0.5 }));
  const encodedMany = await encodeConfigPayload('S', config, many);
  const decodedMany = await decodeConfigPayload(encodedMany);
  check('bundle capped at MAX_USER_PARAMETERS (32)', decodedMany?.userParameters?.length === MAX_USER_PARAMETERS, String(decodedMany?.userParameters?.length));

  const onlyBroken = await encodeConfigPayload('S', config, [broken]);
  check('all-broken bundle == legacy payload bytes', onlyBroken === await encodeRaw({ name: 'S', config }));
}

// --- session overlay ---------------------------------------------
{
  const saved = { id: 'saved-1', label: 'SavedParam', group: '', key: 'sdfAmbientLight', defaultValue: 0.1 };
  setUserParameters([saved]);
  check('saved declarations readable', getUserParameters()[0]?.id === 'saved-1');
  const writesAfterSave = storageWrites.length;
  check('save wrote localStorage once', writesAfterSave > 0 && storageData.has(USER_PARAMETERS_STORAGE_KEY));

  setSessionUserParameters([decl, decl2]);
  check('session overlay wins over saved', getUserParameters().map((d) => d.id).join(',') === 'up-test-1,up-test-2');
  check('saved set still intact under overlay', getSavedUserParameters()[0]?.id === 'saved-1');
  check('session overlay wrote nothing to localStorage', storageWrites.length === writesAfterSave, `${storageWrites.length} vs ${writesAfterSave}`);
  check('session getter exposes overlay', getSessionUserParameters()?.length === 2);

  // setUserParam (embed API) resolves bundled names while overlay on.
  const applied = [];
  const handlers = {
    config: { sdfAmbientLight: 0.2, gpgpuBlendMode: 'normal' },
    applyValue: (k, v) => applied.push([k, v]),
    applyPresetById: () => false,
    getState: () => ({ presetId: null, isPlaying: true }),
  };
  const ok = handleEmbedControlMessage({ ns: 'kalokagathia', v: 1, type: 'setUserParam', name: 'Ambient', value: 0.7 }, handlers);
  check('setUserParam resolves bundled declaration name', ok.handled === true && JSON.stringify(applied) === JSON.stringify([['sdfAmbientLight', 0.7]]), JSON.stringify(ok));
  const bad = handleEmbedControlMessage({ ns: 'kalokagathia', v: 1, type: 'setUserParam', name: 'SavedParam', value: 0.7 }, handlers);
  check('setUserParam: saved name shadowed by overlay', bad.handled === false);

  clearSessionUserParameters();
  check('clearing overlay restores saved declarations', getUserParameters()[0]?.id === 'saved-1' && getSessionUserParameters() === null);
  const ok2 = handleEmbedControlMessage({ ns: 'kalokagathia', v: 1, type: 'setUserParam', name: 'SavedParam', value: 0.3 }, handlers);
  check('setUserParam resolves saved name again after clear', ok2.handled === true);
  check('overlay lifecycle never wrote localStorage', storageWrites.length === writesAfterSave);

  // Clean up global state for any later importers.
  setUserParameters([]);
  clearSessionUserParameters();
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
