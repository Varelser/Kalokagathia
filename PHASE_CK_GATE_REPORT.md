# Phase CK Gate Report — iMac real GPU

Date: 2026-11-20 · GPU: ANGLE (AMD, ANGLE Metal
Renderer: AMD Radeon Pro 5500 XT) · Candidate:
v1.84.0 dist served at http://127.0.0.1:8851/ ·
Production comparison: https://monosphere.pages.dev/
(v1.83.0) · Script: `phaseck_gate.mjs` (harness from
phasecj), probe built by `phaseck_probe_build.mjs`
against the production worker asset
`csgWorker-C6rRPDfw.js` (byte-identical to v1.83.0).

## Result: ALL PASS, 0 errors (full re-run)

- **identity**: 12 frames, frame diffs all 0;
  CSG-keys-idle candidate also all 0; manifest
  version 1.84.0. pass.
- **det**: mesh-torus starter rendered twice, repeat
  diffs all 0; fallback scene differs (min
  0.043827824). pass.
- **ui**: panel driven live — regression cube−sphere
  5.9524 / 302 / genus 0; mesh recipe (torus −
  sphere at B offset 1.1) 2.2513 / 372 / genus 0,
  twice identical; open-mesh refusal shown and the
  run refused; torus restored, third run identical.
  **Exports (new in CK)**, real button clicks with
  Playwright download capture:
  - GLB `monosphere-csg-result.glb`, 7,860 bytes:
    'glTF' magic, EXT_mesh_manifold present in the
    JSON chunk, status line confirmed.
  - 3MF `monosphere-csg-result.3mf`, 5,328 bytes:
    PK magic, unit "millimeter", 188 vertices;
    bounds x [−1470.0, 1040.253], y [−420.0, 420.0],
    z [−1433.1, 1433.1] — the D8-transformed result
    bounds (mm scale, source height on the file's Y
    axis, bitten +x tip).
  - STL `monosphere-csg-result.stl`, 18,684 bytes =
    84 + 50 × 372 exactly; triangle count field 372.
  Import into morph: status shown, canvas changed
  (meanAbsDiff 0.0386). pass.
- **probe**: production worker asset — mesh
  difference 2.251255 / 372, gate ok genus 0,
  determinism (identical position hash), two-torus
  union 2 components, cube union 8 / 12, open mesh
  refused, plain difference regression 5.952390 /
  302. All 10 checks pass (worker unchanged this
  phase; this is the CJ acceptance re-run).
- **fps**: FROZEN 59.8 avg (min window 58), starter
  60.2 avg (min window 60). pass.

## First-run failure and correction (recorded)

The first full run failed exactly one check:
`export3mf.boundsOk`. My gate expectation asserted
the 3MF z bounds (source Y) at ±1470 — the
continuous torus extent. The actual download
measured ±1433.1: the faceted source torus has 14
ring segments and no vertex at 90°, so its Y extent
is 1.47 × sin(77.14°) = 1.4331. The file, the
transform, and the app were correct; the Node suite
had already pinned the bounds against the
transformed source bounds exactly. The gate
expectation was corrected to the measured faceted
extent (with the reason recorded in the gate
source) and the full gate was re-run: all pass.
