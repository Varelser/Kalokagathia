// Shared neighbour-loop shape (Grammar 2.0 stage 2, slice B8).
//
// Design: kalokagathia-pro/STAGE2_DESIGN.md §1 judgment 3 /
// §3 B8 — the proximity loops that were embedded per solver
// (Boids / Particle Life / Kuramoto / N-Body / SPH / the Grains
// scan / the position pass's Grains projection) share ONE loop
// shape: a stride over the position texture's texels, the
// sample-UV computation for texel `si`, and the self-skip.
// The parts of that shape that are BYTE-IDENTICAL across the
// copies live here exactly once; every consumer interpolates
// them, so each assembled shader string stays bit-identical
// to its pre-B8 text (pinned by
// scripts/stage2-neighbor-b8.test.mjs against the pre-B8
// sha256 of every assembled fragment and of the force chunks).
//
// What is deliberately NOT shared (the loop shape is where
// the commonality ends; the kernels stay per solver):
//   - the stride variable name / divisor where they differ
//     (Kuramoto's kStride and Particle Life's plStride divide
//     by 64.0, not by uNBodySamples, and keep their names);
//   - the cell-sort candidate loops (DEM / pile / projection):
//     their candidate source is the sort texture's entry.xy,
//     not a stride over texels;
//   - the 10-space-indented sample-UV lines inside the extra
//     nesting of the XSPH / pile full scans (different text);
//   - the density pass (sj, 4-space, array-built string), the
//     REP prey/pred sampling (uPreyTexSizeF, array-built) and
//     the WGSL twins (different language) — different text,
//     left embedded per judgment 3.
// No generic spatial index is created here: the DEM cell sort
// remains the one spatial index, untouched.

/** The sample-UV line of the stride loop (8-space indent,
 * trailing newline included): texel index `si` → centred UV.
 * Shared by the N-Body / Boids / Kuramoto / Particle Life
 * chunks, the SPH head, the Grains scan tail, the XSPH sampled
 * open and the position projection loop. */
export const NEIGHBOR_SUV_GLSL = /* glsl */ `        vec2 sUv = (vec2(mod(si, uTexSizeF), floor(si / uTexSizeF)) + 0.5) / uTexSizeF;
`;

/** The self-skip line of the stride loop (8-space indent,
 * trailing newline included): a sample landing on the
 * particle's own texel is not a neighbour. Shared by every
 * stride loop above except N-Body, which has no self-skip
 * (its r > 0.001 guard covers the self term instead). */
export const NEIGHBOR_SELF_SKIP_GLSL = /* glsl */ `        if (length(sUv - vUv) < 1.5 / uTexSizeF) continue;
`;

/** The full stride-loop opening whose text is identical in
 * the N-Body, Boids and SPH blocks: the uNBodySamples stride
 * declaration, the 64-step loop, the sample-count break, the
 * texel index and the sample UV. Consumers that also skip
 * the self texel append NEIGHBOR_SELF_SKIP_GLSL. */
export const NEIGHBOR_STRIDE_OPEN_GLSL = /* glsl */ `      float stride = uTexSizeF / float(uNBodySamples);
      for (int i = 0; i < 64; i++) {
        if (i >= uNBodySamples) break;
        float si = float(i) * stride;
` + NEIGHBOR_SUV_GLSL;
