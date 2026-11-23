// Phase 16 stages 1 / 4 / 5 — scene depth base, GEOM injection
// points, foliage split.
// (a) depth fade pure-function boundaries + depth reconstruction
// (b) buildGeomVert / buildGeomFrag byte-identity at empty/invalid
//     code, seam presence at valid code, forbidden-token validation
// (c) bake speciesData consistency with the zone assignment (via
//     the legacy normal-magnitude channel) + allocateSpeciesCounts
//     sum / cap / ratio / remainder rules
// (d) new-key defaults (identity at rest)
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p16dgf-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

await build({
  stdin: {
    contents: `
      export * from './lib/sceneDepth.ts';
      export * from './lib/geomCustomGlsl.ts';
      export * from './lib/glslInjection.ts';
      export * from './lib/speciesAllocation.ts';
      export * from './lib/gpgpuMorphTargets.ts';
      export { GEOM_VERT, GEOM_FRAG, buildGeomVert, buildGeomFrag } from './components/gpgpuShaderVolumes.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);

  // --- (a) depth fade boundaries --------------------------------
  const f = m.depthFadeFactor;
  check('(a) hard step: scene behind frag -> 1', f(10, 5, 0) === 1);
  check('(a) hard step: scene in front -> 0', f(5, 10, 0) === 0);
  check('(a) hard step: equality occludes -> 0', f(5, 5, 0) === 0);
  check('(a) hard step: negative softness is hard', f(10, 5, -3) === 1 && f(5, 10, -3) === 0);
  check('(a) soft: at frag depth -> 0', f(5, 5, 5) === 0);
  check('(a) soft: at frag+softness -> 1', f(10, 5, 5) === 1);
  check('(a) soft: beyond -> clamped 1', f(30, 5, 5) === 1);
  check('(a) soft: midpoint -> 0.5', close(f(7.5, 5, 5), 0.5));
  check('(a) soft: quarter -> 0.25', close(f(6.25, 5, 5), 0.25));
  check('(a) non-finite degrades to 1', f(NaN, 5, 5) === 1 && f(5, Infinity, 5) === 1);
  // Reconstruction: near at depth 0, far at depth 1, monotonic.
  const vd = (d) => m.viewDepthFromDepthBuffer(d, 0.1, 1000);
  check('(a) depth 0 -> near', close(vd(0), 0.1, 1e-6), String(vd(0)));
  check('(a) depth 1 -> far', close(vd(1), 1000, 1e-3), String(vd(1)));
  check('(a) depth monotonic', vd(0.25) < vd(0.5) && vd(0.5) < vd(0.75));
  check('(a) depth clamps outside [0,1]', close(vd(-1), 0.1, 1e-6) && close(vd(2), 1000, 1e-3));
  check('(a) GLSL twin present', m.SCENE_DEPTH_GLSL.includes('kaloDepthFadeFactor') && m.SCENE_DEPTH_GLSL.includes('kaloViewDepthFromBuffer'));

  // --- (b) GEOM builders ----------------------------------------
  check('(b) vert empty -> byte-identical', m.buildGeomVert('') === m.GEOM_VERT);
  check('(b) vert whitespace -> byte-identical', m.buildGeomVert('  \n ') === m.GEOM_VERT);
  check('(b) frag empty -> byte-identical', m.buildGeomFrag('') === m.GEOM_FRAG);
  check('(b) vert invalid (gl_Position) -> stock', m.buildGeomVert('gl_Position = vec4(0.0);') === m.GEOM_VERT);
  check('(b) frag invalid (gl_FragColor) -> stock', m.buildGeomFrag('gl_FragColor = vec4(1.0);') === m.GEOM_FRAG);
  const vOut = m.buildGeomVert('disp = vec3(0.0, 1.0, 0.0);');
  check('(b) vert valid -> seam + code spliced', vOut !== m.GEOM_VERT && vOut.includes('// geom vertex (user GLSL)') && vOut.includes('disp = vec3(0.0, 1.0, 0.0);') && vOut.includes('vWorldPos += disp;'));
  check('(b) vert seam sits before gl_Position', vOut.indexOf('// geom vertex (user GLSL)') < vOut.indexOf('gl_Position = projectionMatrix'));
  const fOut = m.buildGeomFrag('col *= 0.5;');
  check('(b) frag valid -> seam + code spliced', fOut !== m.GEOM_FRAG && fOut.includes('// geom fragment (user GLSL)') && fOut.includes('col *= 0.5;'));
  check('(b) frag seam sits before final write', fOut.indexOf('// geom fragment (user GLSL)') < fOut.indexOf('gl_FragColor = vec4(col, uOpacity * vDensityMul);'));
  // Validation: forbidden tokens per point, examples pass.
  check('(b) validate vert rejects gl_Position', !m.validateGeomCustomVertexGlslCode('gl_Position;').ok);
  check('(b) validate vert rejects #', !m.validateGeomCustomVertexGlslCode('#define X 1').ok);
  check('(b) validate vert rejects uniform', !m.validateGeomCustomVertexGlslCode('uniform float x;').ok);
  check('(b) validate vert rejects texture', !m.validateGeomCustomVertexGlslCode('texture2D(t, uv);').ok);
  check('(b) validate frag rejects gl_FragColor', !m.validateGeomCustomFragmentGlslCode('gl_FragColor;').ok);
  check('(b) validate frag rejects void main', !m.validateGeomCustomFragmentGlslCode('void main() {}').ok);
  check('(b) validate vert example ok', m.validateGeomCustomVertexGlslCode(m.GEOM_CUSTOM_VERTEX_GLSL_EXAMPLE).ok);
  check('(b) validate frag example ok', m.validateGeomCustomFragmentGlslCode(m.GEOM_CUSTOM_FRAGMENT_GLSL_EXAMPLE).ok);
  check('(b) validate length cap', !m.validateGeomCustomVertexGlslCode('x'.repeat(4001)).ok);
  // Contracts registered with the new stages.
  const vc = m.getGlslInjection('geom-custom-vertex');
  const fc = m.getGlslInjection('geom-custom-fragment');
  check('(b) vertex contract stage', vc && vc.stage === 'geom-vertex' && vc.backends.webgpu === 'unsupported');
  check('(b) fragment contract stage', fc && fc.stage === 'geom-fragment' && fc.backends.cpu === 'unsupported');
  check('(b) vertex contract write-back is disp only', vc.variables.filter((v) => v.access === 'readwrite').map((v) => v.name).join(',') === 'disp');
  check('(b) fragment contract write-back is col only', fc.variables.filter((v) => v.access === 'readwrite').map((v) => v.name).join(',') === 'col');
  check('(b) harnesses embed the snippet', m.buildGeomCustomVertexHarness('disp = vec3(1.0);').includes('disp = vec3(1.0);') && m.buildGeomCustomFragmentHarness('col *= 2.0;').includes('col *= 2.0;'));

  // --- (c) species bake + allocation -----------------------------
  const terrain = { amplitude: 30, frequency: 1.5, octaves: 3, seed: 7 };
  const scatterBase = { density: 1, heightMin: 0, heightMax: 1, slopeMax: 1, alignNormal: 1, scaleRandom: 0, rotRandom: 0, bend: 0 };
  const bake3 = m.buildGpgpuMorphTargetDataWithNormals({
    texSize: 16, target: 'terrain', worldScale: 1, jitter: 0, seed: 3,
    terrain, scatter: { ...scatterBase, species: 3 },
  });
  check('(c) speciesData length = texel count', bake3.speciesData.length === 256);
  check('(c) speciesData zones within [0, species)', bake3.speciesData.every((z) => z >= 0 && z < 3));
  check('(c) speciesData has multiple zones', new Set(bake3.speciesData).size >= 2, [...new Set(bake3.speciesData)].join(','));
  // Cross-check against the legacy channel: with alignment 1 and
  // no finishing, the companion normal's magnitude IS the species
  // class scale of the particle's zone.
  let zoneConsistent = true;
  for (let i = 0; i < 256; i++) {
    const o = i * 4;
    const mag = Math.hypot(bake3.normalData[o], bake3.normalData[o + 1], bake3.normalData[o + 2]);
    if (mag < 1e-6) continue; // zero normal carries no class
    const zone = bake3.speciesData[i];
    const want = 0.55 + 0.45 * (zone / 2);
    if (!close(mag, want, 1e-4)) { zoneConsistent = false; break; }
  }
  check('(c) speciesData zone == normal-magnitude class zone', zoneConsistent);
  check('(c) zone helper matches scale helper', [0, 0.2, 0.5, 0.9, 1].every((t) => {
    const s = { ...scatterBase, species: 3 };
    const zone = m.terrainScatterSpeciesZone(s, t);
    return close(m.terrainScatterSpeciesScale(s, t), 0.55 + 0.45 * (zone / 2), 1e-12);
  }));
  const bake1 = m.buildGpgpuMorphTargetDataWithNormals({
    texSize: 16, target: 'terrain', worldScale: 1, jitter: 0, seed: 3,
    terrain, scatter: { ...scatterBase, species: 1 },
  });
  check('(c) species=1 -> all zero', bake1.speciesData.every((z) => z === 0));
  const bakeOff = m.buildGpgpuMorphTargetDataWithNormals({
    texSize: 16, target: 'terrain', worldScale: 1, jitter: 0, seed: 3,
    terrain, scatter: null,
  });
  check('(c) scatter off -> all zero', bakeOff.speciesData.every((z) => z === 0));
  check('(c) bake data unchanged by the channel (species1 == off positions)', bake1.data.every((v, i) => v === bakeOff.data[i]));

  const alloc = m.allocateSpeciesCounts;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  check('(c) alloc A>=N returns totals', JSON.stringify(alloc([5, 3, 2], 10)) === '[5,3,2]' && JSON.stringify(alloc([5, 3, 2], 99)) === '[5,3,2]');
  check('(c) alloc A=0 -> zeros', JSON.stringify(alloc([5, 3], 0)) === '[0,0]');
  check('(c) alloc exact ratio', JSON.stringify(alloc([300, 100], 200)) === '[150,50]');
  check('(c) alloc equal thirds remainder to lowest index', JSON.stringify(alloc([10, 10, 10], 10)) === '[4,3,3]');
  check('(c) alloc sum == min(A, N)', sum(alloc([7, 13, 29, 3], 20)) === 20 && sum(alloc([7, 13, 29, 3], 52)) === 52);
  check('(c) alloc never exceeds totals', alloc([1, 100], 50).every((v, i) => v <= [1, 100][i]));
  check('(c) alloc zero-total species stays 0', alloc([0, 10], 5)[0] === 0 && sum(alloc([0, 10], 5)) === 5);
  check('(c) alloc empty totals', JSON.stringify(alloc([], 5)) === '[]' && JSON.stringify(alloc([0, 0], 5)) === '[0,0]');
  check('(c) alloc ratio preserved approx', (() => { const r = alloc([900, 100], 100); return r[0] === 90 && r[1] === 10; })());
  check('(c) alloc deterministic', JSON.stringify(alloc([7, 13, 29, 3], 20)) === JSON.stringify(alloc([7, 13, 29, 3], 20)));

  // --- (d) new-key defaults --------------------------------------
  const cfg = m.DEFAULT_CONFIG;
  check('(d) gpgpuDepthOcclusion default 0', cfg.gpgpuDepthOcclusion === 0);
  check('(d) geom custom defaults off/empty', cfg.gpgpuGeomCustomVertexEnabled === false && cfg.gpgpuGeomCustomVertexCode === '' && cfg.gpgpuGeomCustomFragmentEnabled === false && cfg.gpgpuGeomCustomFragmentCode === '');
  check('(d) species modes default follow', cfg.gpgpuGeomSpecies2Mode === 'follow' && cfg.gpgpuGeomSpecies3Mode === 'follow' && cfg.gpgpuGeomSpecies4Mode === 'follow');

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
