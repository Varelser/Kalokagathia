// Phase 18 stage 2 — emitter hierarchy + force order.
// Hand-computed checks: positions use spread 0 unless noted, so
// base effective = manual offset; ring checks use count 2,
// spread 10 (index 0 -> (+10,0), index 1 -> (-10,0) on X).
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p18s2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const eq3 = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;

await build({
  stdin: {
    contents: `
      export { resolveSourceParents, hasSourceParents, resolveEffectivePositionsWithParents, effectivePositionWithParents } from './lib/sourceHierarchy.ts';
      export { effectivePosition } from './lib/sourceEditor.ts';
      export { GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder, isDefaultGpgpuForceOrder, serializeGpgpuForceOrder } from './lib/gpgpuForceOrder.ts';
      export { VEL_FRAG_MAIN_FORCES, VEL_FRAG_MAIN_FORCES_HEAD, VEL_FRAG_FORCE_CHUNKS, buildMainForcesFragment } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { SIM_VEL_FRAG, buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { resolveSourceParents, hasSourceParents, resolveEffectivePositionsWithParents, effectivePositionWithParents, effectivePosition } = lib;
const { GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder, isDefaultGpgpuForceOrder, serializeGpgpuForceOrder } = lib;
const { VEL_FRAG_MAIN_FORCES, VEL_FRAG_MAIN_FORCES_HEAD, VEL_FRAG_FORCE_CHUNKS, buildMainForcesFragment, SIM_VEL_FRAG, buildVelocityFragment } = lib;

const pos = [{ x: 1, y: 2, z: 3 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }, { x: 100, y: 100, z: 100 }];

// --- parents: root-only equals legacy effectivePosition, element-wise ---
{
  const legacy = pos.map((o, i) => effectivePosition(o, i, 4, 0));
  const empty = resolveEffectivePositionsWithParents(pos, 4, 0, []);
  const allRoot = resolveEffectivePositionsWithParents(pos, 4, 0, [-1, -1, -1, -1]);
  check('parents empty == legacy', empty.every((v, i) => eq3(v, legacy[i])));
  check('parents all -1 == legacy', allRoot.every((v, i) => eq3(v, legacy[i])));
  check('hasSourceParents empty/-1 false', !hasSourceParents([], 4) && !hasSourceParents([-1, -1], 4));
  // ring preserved: count 2 spread 10, no parents
  const ring = resolveEffectivePositionsWithParents([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], 2, 10, []);
  check('ring base preserved', eq3(ring[0], { x: 10, y: 0, z: 0 }) && Math.abs(ring[1].x + 10) < 1e-9 && Math.abs(ring[1].z) < 1e-9, JSON.stringify(ring));
}
// --- one-level parent: child = own + parent ---
{
  const out = resolveEffectivePositionsWithParents(pos, 4, 0, [-1, 0, -1, -1]);
  check('one-level parent hand-computed', eq3(out[1], { x: 11, y: 2, z: 3 }), JSON.stringify(out[1]));
  check('root sibling untouched', eq3(out[2], pos[2]));
}
// --- chain: 2 -> 1 -> 0 ---
{
  const out = resolveEffectivePositionsWithParents(pos, 4, 0, [-1, 0, 1, -1]);
  check('chain hand-computed', eq3(out[2], { x: 11, y: 7, z: 3 }), JSON.stringify(out[2]));
  check('single fn matches array fn', eq3(effectivePositionWithParents(pos, [-1, 0, 1, -1], 2, 4, 0), out[2]));
}
// --- cycle / self / out-of-range fall back to root edges ---
{
  check('resolve self/out-of-range/non-integer', JSON.stringify(resolveSourceParents([0, 9, 1.5, -2], 4)) === '[-1,-1,-1,-1]', JSON.stringify(resolveSourceParents([0, 9, 1.5, -2], 4)));
  const cyc = resolveEffectivePositionsWithParents(pos, 4, 0, [1, 0, -1, -1]);
  check('cycle terminates, each base once', eq3(cyc[0], { x: 11, y: 2, z: 3 }) && eq3(cyc[1], { x: 11, y: 2, z: 3 }), JSON.stringify(cyc));
  const self = resolveEffectivePositionsWithParents(pos, 4, 0, [0, -1, -1, -1]);
  check('self reference == legacy', eq3(self[0], pos[0]));
}
// --- force order parsing / correction ---
{
  check('default order names count 19', GPGPU_FORCE_CHUNK_NAMES.length === 19);
  check('normalize empty == default', JSON.stringify(normalizeGpgpuForceOrder('')) === JSON.stringify([...GPGPU_FORCE_CHUNK_NAMES]));
  check('isDefault empty/undefined/full', isDefaultGpgpuForceOrder('') && isDefaultGpgpuForceOrder(undefined) && isDefaultGpgpuForceOrder(GPGPU_FORCE_CHUNK_NAMES.join(',')));
  const partial = normalizeGpgpuForceOrder('wind,curl');
  check('partial keeps head, appends missing in default order', partial[0] === 'wind' && partial[1] === 'curl' && partial.length === 19 && partial[2] === 'pyro-buoyancy', partial.join(','));
  const messy = normalizeGpgpuForceOrder('bogus,wind,wind,, curl ,nope');
  check('unknown/duplicate dropped', messy.filter((n) => n === 'wind').length === 1 && !messy.includes('bogus') && messy.length === 19, messy.join(','));
  check('serialize default == empty string', serializeGpgpuForceOrder('') === '' && serializeGpgpuForceOrder('wind,curl').startsWith('wind,curl,'));
  check('non-default detected', !isDefaultGpgpuForceOrder('wind,curl'));
}
// --- chunk byte identity against the stage-0 baseline ---
{
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));
  const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
  const pin = baseline.parts.VEL_FRAG_MAIN_FORCES;
  check('VEL_FRAG_MAIN_FORCES matches baseline pin', VEL_FRAG_MAIN_FORCES.length === pin.length && sha(VEL_FRAG_MAIN_FORCES) === pin.sha256, `${VEL_FRAG_MAIN_FORCES.length} ${sha(VEL_FRAG_MAIN_FORCES)}`);
  const manualConcat = VEL_FRAG_MAIN_FORCES_HEAD + GPGPU_FORCE_CHUNK_NAMES.map((n) => VEL_FRAG_FORCE_CHUNKS[n]).join('');
  check('head + default chunks == VEL_FRAG_MAIN_FORCES', manualConcat === VEL_FRAG_MAIN_FORCES);
  check('every chunk non-empty and registry complete', GPGPU_FORCE_CHUNK_NAMES.every((n) => typeof VEL_FRAG_FORCE_CHUNKS[n] === 'string' && VEL_FRAG_FORCE_CHUNKS[n].length > 0));
}
// --- order application: same chunk multiset, different order ---
{
  const reversed = [...GPGPU_FORCE_CHUNK_NAMES].reverse().join(',');
  const frag = buildVelocityFragment('', reversed);
  check('reversed fragment != stock', frag !== SIM_VEL_FRAG);
  check('reversed fragment same length as stock', frag.length === SIM_VEL_FRAG.length, `${frag.length} vs ${SIM_VEL_FRAG.length}`);
  const sortChars = (s) => [...s].sort().join('');
  check('reversed fragment is a char permutation of stock', sortChars(frag) === sortChars(SIM_VEL_FRAG));
  for (const name of GPGPU_FORCE_CHUNK_NAMES) {
    if (!frag.includes(VEL_FRAG_FORCE_CHUNKS[name])) { check(`chunk ${name} present in reversed fragment`, false); }
  }
  check('all chunks present in reversed fragment', GPGPU_FORCE_CHUNK_NAMES.every((n) => frag.includes(VEL_FRAG_FORCE_CHUNKS[n])));
  const windAt = frag.indexOf(VEL_FRAG_FORCE_CHUNKS['wind']);
  const curlAt = frag.indexOf(VEL_FRAG_FORCE_CHUNKS['curl']);
  const defWindAt = SIM_VEL_FRAG.indexOf(VEL_FRAG_FORCE_CHUNKS['wind']);
  const defCurlAt = SIM_VEL_FRAG.indexOf(VEL_FRAG_FORCE_CHUNKS['curl']);
  check('order actually changed (wind/curl swapped vs default)', (windAt < curlAt) !== (defWindAt < defCurlAt));
  check('buildMainForcesFragment(default) == pinned chunk', buildMainForcesFragment() === VEL_FRAG_MAIN_FORCES && buildMainForcesFragment('') === VEL_FRAG_MAIN_FORCES);
}
// --- default builder identity ---
{
  check("buildVelocityFragment('') === SIM_VEL_FRAG", buildVelocityFragment('') === SIM_VEL_FRAG);
  check("buildVelocityFragment('', '') === SIM_VEL_FRAG", buildVelocityFragment('', '') === SIM_VEL_FRAG);
  check('buildVelocityFragment with default-order string === SIM_VEL_FRAG', buildVelocityFragment('', GPGPU_FORCE_CHUNK_NAMES.join(',')) === SIM_VEL_FRAG);
  const withSnippet = buildVelocityFragment('vel += vec3(1.0);', 'wind,curl');
  check('custom snippet still injected with order applied', withSnippet.includes('custom force (user GLSL)') && withSnippet.indexOf(VEL_FRAG_FORCE_CHUNKS['wind']) < withSnippet.indexOf(VEL_FRAG_FORCE_CHUNKS['curl']));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
