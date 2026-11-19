# Phase CJ Gate Report — iMac real GPU (ANGLE Metal)

- Date: 2026-11-20 (JST)
- GPU: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 5500 XT)
- Candidate: v1.83.0, bundle index-8mbRCSMo.js, worker csgWorker-C6rRPDfw.js
- Production (OLD): v1.82.0 at https://monosphere.pages.dev
- Scripts: `phasecj_gate.mjs`, `phasecj_probe_build.mjs`
  (results: `~/monosphere-check/phasecj/results-all.json` on the iMac)

## Result: ALL PASS, first run (errorCount 0)

- **identity**: 12 frames bit-identical (maxDiff 0);
  the candidate with every CC–CJ key at its inert
  default also 12 frames diff 0; manifest 1.83.0.
- **det**: the mesh-torus starter configuration
  rendered twice = bit-identical (repeatMax 0);
  sphere-fallback scene differs (fallbackMin 0.043828).
- **ui** (real panel drive):
  - regression recipe (defaults): 5.9524 / 302 tris /
    euler 2 / 1 component / genus 0.
  - operand A → mesh: the mesh block appears; the
    live status reads 「頂点 112・三角形 224（閉じた
    メッシュ・種数 1）」 for the default torus text.
  - B offset X → 1.1, run: **2.2513 / 372 / genus 0**,
    twice identical; after restoring the text, a
    third identical run.
  - open-mesh drive: the text swapped for a cube
    with no top face — the live line switches to
    「閉じたメッシュではありません」, the run aborts
    at gate (a) with the shared-edge reason and no
    result readout appears.
  - import into morph: status shown, canvas changed
    (meanAbsDiff 0.038615).
- **probe** (production worker asset, all 10 checks):
  torus mesh − sphere = 2.251255 / 372 / gate ok,
  position hash 543c56f1 identical across two runs
  (55 ms); two disjoint torus meshes unioned =
  6.364551 / 448 tris / 2 components / total genus 2;
  welded unit-cube mesh inside the size-2 primitive
  cube, union = 8 / 12 tris; an open cube mesh
  refused NOT_MANIFOLD by the worker; plain
  difference regression 5.952390 / 302.
- **fps**: FROZEN avg 59.2 (min window 55), starter
  avg 60.2 (min window 60). Pass bar: avg > 30.
