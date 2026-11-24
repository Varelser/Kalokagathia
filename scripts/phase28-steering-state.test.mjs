// Phase 28 — 9-5: steering state mode on the WGSL route.
// Until this phase the WGSL velocity pass had no attribute
// texture, so steering mode 3 (state) silently resolved to
// state 0 (seek the first target) while the GLSL pass switched
// targets per particle from the attribute slot. Checks:
//   - the velocity shader binds the mirrored bake at
//     binding 13 (a texture, not a storage buffer — the stage
//     already binds the default limit of 8 storage buffers)
//   - mode 3 in WGSL mirrors the GLSL chunk: slot channel
//     select (kaloAttrChannel), threshold >=, state 1 ->
//     target1 + arrive (mode 1), state 0 -> target + seek
//   - the old degradation (sMode 3 -> 0) is gone
//   - uniform: steerStateSlot / steerStateThreshold appended
//     at indices 152-153 (VEL_UNIFORM_BYTES 608 -> 624), the
//     writer writes them from the resolved steering params,
//     and WebGPUSteeringParams carries the two fields
//   - plumbing: BGL + bind group entries for binding 13, the
//     state type carries attrTexture, init creates it
//     zero-filled, destroy releases it, and
//     updateWebGPUAttrData uploads with a size guard
//   - runtime: the bake effect stores the exact texture array
//     in wgAttrDataRef and uploads it, the no-bake branch
//     zeroes the mirror, and the init completion uploads the
//     stored bake into a late-landing state
//   - routing declarations: steering state counts as a
//     sim-side attribute consumer for the dynamic-stage
//     declarations (feedback / chain), while a plain
//     steering-state config declares nothing and stays
//     WebGPU-eligible
//   - resolution: resolveSteeringSeek carries the slot /
//     threshold with the documented clamps
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p28-steering-state-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { resolveSteeringSeek, STEER_SEEK_MODE_IDS } from './lib/steering.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// ── Resolution ──────────────────────────────────────────────────
{
  const r = lib.resolveSteeringSeek({ gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'state', gpgpuSteerSeekStateSlot: 2, gpgpuSteerSeekStateThreshold: 0.25 });
  check('resolve: state mode id is 3', r.modeId === 3 && lib.STEER_SEEK_MODE_IDS.state === 3);
  check('resolve: slot / threshold carried', r.stateSlot === 2 && r.stateThreshold === 0.25);
  const d = lib.resolveSteeringSeek({});
  check('resolve: defaults slot 0 / threshold 0.5', d.stateSlot === 0 && d.stateThreshold === 0.5);
  const c = lib.resolveSteeringSeek({ gpgpuSteerSeekStateSlot: 9, gpgpuSteerSeekStateThreshold: 7 });
  check('resolve: clamps slot 0..3 / threshold 0..1', c.stateSlot === 3 && c.stateThreshold === 1);
}

// ── WGSL shader ─────────────────────────────────────────────────
const src = readFileSync(join(ROOT, 'lib', 'webgpuCompute.ts'), 'utf8');
{
  check('WGSL: attribute texture bound at 13', src.includes('@group(0) @binding(13) var attrTex : texture_2d<f32>;'));
  check('WGSL: mode 3 loads the particle texel', src.includes('textureLoad(attrTex, vec2i(i32(idx % texSizeU), i32(idx / texSizeU)), 0)'));
  check('WGSL: channel select mirrors kaloAttrChannel', src.includes('var slotValue = attrData.r;')
    && src.includes('if (u.steerStateSlot == 1) { slotValue = attrData.g; }')
    && src.includes('else if (u.steerStateSlot == 2) { slotValue = attrData.b; }')
    && src.includes('else if (u.steerStateSlot >= 3) { slotValue = attrData.a; }'));
  check('WGSL: threshold comparison is >=', src.includes('let isState1 = slotValue >= u.steerStateThreshold;'));
  check('WGSL: state1 -> target1 + arrive, state0 -> target + seek', src.includes('sMode = select(0, 1, isState1);')
    && src.includes('vec3f(u.steerTarget1X, u.steerTarget1Y, u.steerTarget1Z), isState1)'));
  check('WGSL: old degradation removed', !src.includes('if (sMode == 3) { sMode = 0; }'));
  check('WGSL: uniform tail fields', src.includes('steerStateSlot : i32,') && src.includes('steerStateThreshold : f32,'));
  const tail = src.indexOf('attractor2Scale : f32,');
  check('WGSL: state fields appended after attractor2 (offsets stable)', tail > 0 && src.indexOf('steerStateSlot : i32,') > tail);
  check('WGSL: uniform buffer grew past the Phase 28 size of 624 bytes (Phase 29 appended attractor units 3/4 -> 656; 616 would under-size: struct rounds to 16-byte alignment)', src.includes('const VEL_UNIFORM_BYTES = 656;'));
  check('WGSL: writer writes indices 152-153', src.includes('velI[152] = st ? st.stateSlot : 0;') && src.includes('velU[153] = st ? st.stateThreshold : 0.5;'));
  check('WGSL: steering params carry the pair', src.includes('stateSlot: number;') && src.includes('stateThreshold: number;'));
  check('WGSL: BGL entry for binding 13', src.includes('{ binding: 13, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: \'unfilterable-float\', viewDimension: \'2d\' } }'));
  check('WGSL: bind group binds the state texture', src.includes('{ binding: 13, resource: state.attrTexture.createView() }'));
  check('WGSL: state type carries attrTexture', src.includes('attrTexture: GPUTexture;'));
  check('WGSL: init creates the texture zero-filled', src.includes('const attrTexture = device.createTexture({') && src.includes('new Float32Array(texSize * texSize * 4)'));
  check('WGSL: destroy releases the texture', src.includes('state.attrTexture.destroy();'));
  check('WGSL: update export with size guard + writeTexture', src.includes('export function updateWebGPUAttrData')
    && src.includes('if (attrData.byteLength !== byteSize) return;')
    && src.includes('state.device.queue.writeTexture('));
}

// ── Runtime wiring ──────────────────────────────────────────────
{
  const rt = readFileSync(join(ROOT, 'components', 'useGpgpuRuntime.ts'), 'utf8');
  check('runtime: imports updateWebGPUAttrData', rt.includes('updateWebGPUAttrData,'));
  check('runtime: bake stored in wgAttrDataRef', rt.includes('wgAttrDataRef.current = texData;'));
  check('runtime: bake effect uploads to a live state', rt.includes('updateWebGPUAttrData(webgpuStateRef.current, texData);'));
  check('runtime: init completion uploads the stored bake', rt.includes('updateWebGPUAttrData(state, wgAttrDataRef.current);'));
  check('runtime: no-bake branch zeroes the mirror', rt.includes('wgAttrDataRef.current = null;')
    && rt.includes('new Float32Array(webgpuStateRef.current.texSize * webgpuStateRef.current.texSize * 4)'));
}

// ── Routing declarations ────────────────────────────────────────
{
  const base = lib.DEFAULT_CONFIG;
  const plain = lib.getWebgpuComputeCapabilityReport({ ...base, gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'state', gpgpuExecutionPreference: 'webgpu' });
  check('routing: plain state mode declares no attr features', !plain.requestedFeatures.some((f) => f.startsWith('attr-')), plain.requestedFeatures.join(','));
  const feedback = lib.getWebgpuComputeCapabilityReport({ ...base, gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'state', gpgpuAttrFeedbackEnabled: true });
  check('routing: state + feedback declares attr-feedback', feedback.requestedFeatures.includes('attr-feedback'), feedback.requestedFeatures.join(','));
  const chain = lib.getWebgpuComputeCapabilityReport({
    ...base, gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'state',
    gpgpuAttrChainEnabled: true, gpgpuAttrChainExprs: ['x * 2', '', '', ''],
  });
  check('routing: state + chain declares attr-chain', chain.requestedFeatures.includes('attr-chain'), chain.requestedFeatures.join(','));
  const seekOnly = lib.getWebgpuComputeCapabilityReport({ ...base, gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'seek', gpgpuAttrFeedbackEnabled: true });
  check('routing: seek mode + feedback does NOT declare attr-feedback', !seekOnly.requestedFeatures.includes('attr-feedback'), seekOnly.requestedFeatures.join(','));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
