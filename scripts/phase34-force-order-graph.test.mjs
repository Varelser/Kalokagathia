// Phase 34 (TD §7 stage 2) — GPGPU force order graph.
// The stage adds an editing surface over the existing
// gpgpuForceOrder key; the storage and resolver are
// unchanged. This test pins: the editor metadata covers
// exactly the resolver's chunk set, reorder -> serialize ->
// normalize round-trips, the default order serialises to
// '', the assembled main-forces fragment for '' and for the
// explicit default permutation are byte-identical, and the
// activity readout follows the guard keys.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p34-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder, serializeGpgpuForceOrder, isDefaultGpgpuForceOrder } from './lib/gpgpuForceOrder.ts';
      export { GPGPU_FORCE_CHUNK_META, resolveForceChunkActive } from './lib/gpgpuForceChunkMeta.ts';
      export { buildMainForcesFragment, VEL_FRAG_MAIN_FORCES } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const {
  GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder, serializeGpgpuForceOrder,
  isDefaultGpgpuForceOrder, GPGPU_FORCE_CHUNK_META, resolveForceChunkActive,
  buildMainForcesFragment, VEL_FRAG_MAIN_FORCES,
} = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const DEFAULTS = [...GPGPU_FORCE_CHUNK_NAMES];

// --- metadata coverage ------------------------------------------------
check('meta covers exactly the 27 chunks, in default order',
  GPGPU_FORCE_CHUNK_META.length === 27
  && GPGPU_FORCE_CHUNK_META.map((m) => m.name).join(',') === DEFAULTS.join(','));
check('variant-gated set is attractor-2/3/4 + steer-seek + field-instances + rel-drag + meander + surface-tension',
  GPGPU_FORCE_CHUNK_META.filter((m) => m.variantGated).map((m) => m.name).join(',')
  === 'attractor-2,attractor-3,attractor-4,steer-seek,field-instances,rel-drag,meander,surface-tension');

// --- serialize / normalize round-trip ---------------------------------
check('default order serialises to empty string', serializeGpgpuForceOrder(DEFAULTS) === '');
check('empty key is default', isDefaultGpgpuForceOrder('') && serializeGpgpuForceOrder('') === '');
{
  // Simulate the editor's move: swap the first two chunks.
  const moved = [...DEFAULTS];
  const [first] = moved.splice(0, 1);
  moved.splice(1, 0, first);
  const stored = serializeGpgpuForceOrder(moved);
  check('a moved order serialises to a non-empty permutation',
    stored !== '' && normalizeGpgpuForceOrder(stored).join(',') === moved.join(','));
  check('the moved order is not default', !isDefaultGpgpuForceOrder(stored));
  // Move the last chunk to the front, twice removed from default.
  const rotated = [DEFAULTS[DEFAULTS.length - 1], ...DEFAULTS.slice(0, -1)];
  check('rotation round-trips',
    normalizeGpgpuForceOrder(serializeGpgpuForceOrder(rotated)).join(',') === rotated.join(','));
}

// --- assembly identity --------------------------------------------------
check("fragment('') === fragment(explicit default) === pinned assembly",
  buildMainForcesFragment('') === buildMainForcesFragment(DEFAULTS)
  && buildMainForcesFragment('') === VEL_FRAG_MAIN_FORCES);
{
  const allVariants = { steeringSeek: true, attractor2: true, attractor3: true, attractor4: true };
  const fwd = buildMainForcesFragment(DEFAULTS, allVariants);
  const rev = buildMainForcesFragment([...DEFAULTS].reverse(), allVariants);
  check('reversed order changes the string but not its length (all variants on)',
    rev !== fwd && rev.length === fwd.length);
  check('variant-gated chunks are skipped without their variant',
    buildMainForcesFragment(DEFAULTS) === VEL_FRAG_MAIN_FORCES
    && buildMainForcesFragment(DEFAULTS).length < fwd.length);
}

// --- activity readout ---------------------------------------------------
const off = {
  gpgpuPyroEnabled: false, gpgpuTurbulence: 0, gpgpuAudioReactive: false, audioEnabled: false,
  gpgpuNBodyEnabled: false, gpgpuCurlEnabled: false, gpgpuPyroDisturbance: 0, gpgpuBoidsEnabled: false,
  gpgpuKuramotoEnabled: false, gpgpuParticleLifeEnabled: false, gpgpuAttractorEnabled: false,
  gpgpuAttractor2Enabled: false, gpgpuAttractor3Enabled: false, gpgpuAttractor4Enabled: false,
  gpgpuLevyEnabled: false, gpgpuVortexEnabled: false, gpgpuWindEnabled: false, gpgpuWindVolumeEnabled: false,
  gpgpuWellEnabled: false, gpgpuElasticEnabled: false, gpgpuMagneticEnabled: false,
  gpgpuSteerAvoid: 0, gpgpuSdfEnabled: false, gpgpuSteerSeekEnabled: false,
};
check('all-off config: plain chunks inactive, slope derived',
  resolveForceChunkActive('curl', off) === 'inactive'
  && resolveForceChunkActive('turbulence', off) === 'inactive'
  && resolveForceChunkActive('slope', off) === 'derived');
check('single enable key activates its chunk',
  resolveForceChunkActive('curl', { ...off, gpgpuCurlEnabled: true }) === 'active'
  && resolveForceChunkActive('turbulence', { ...off, gpgpuTurbulence: 0.5 }) === 'active'
  && resolveForceChunkActive('attractor-3', { ...off, gpgpuAttractor3Enabled: true }) === 'active');
check('compound guards need every key',
  resolveForceChunkActive('audio-blast', { ...off, gpgpuAudioReactive: true }) === 'inactive'
  && resolveForceChunkActive('audio-blast', { ...off, gpgpuAudioReactive: true, audioEnabled: true }) === 'active'
  && resolveForceChunkActive('steer-avoid', { ...off, gpgpuSteerAvoid: 1 }) === 'inactive'
  && resolveForceChunkActive('steer-avoid', { ...off, gpgpuSteerAvoid: 1, gpgpuSdfEnabled: true }) === 'active'
  && resolveForceChunkActive('pyro-disturbance', { ...off, gpgpuPyroDisturbance: 1 }) === 'inactive'
  && resolveForceChunkActive('pyro-disturbance', { ...off, gpgpuPyroDisturbance: 1, gpgpuPyroEnabled: true }) === 'active');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
