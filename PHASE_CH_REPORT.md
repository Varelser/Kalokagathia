# Phase CH Report — CSG second release U4 revised: the refine finish (v1.81.0)

- Date: 2026-11-20 (JST)
- Version: 1.80.0 → **1.81.0** (bundle index-CsdJ-R1T.js, worker csgWorker-D0mABq7-.js)
- Deployment: `ae6eb42e-9f08-4891-8236-1257f69bf768` (https://ae6eb42e.monosphere.pages.dev)
- GitHub: Varelser/Kalokagathia commit `2da03e0a` (sync record #139)
- Totals: keys **1,356** (+1), starters **603** (+1), catalog 1,660 (unchanged)

## Why U4 changed shape (the smooth blocker, measured)

The brief's U4 specified a smooth finish via `Manifold.smooth`. Before
implementation the commander re-measured the premise on the pinned
manifold-3d 3.5.4 (Node, production construction path):

| Path | Cube (8.0) | Cube − sphere (5.9524) | Gate (c) |
|---|---|---|---|
| smooth + refine(2) | **16.6814** | **12.9836** | passes, but the shape is destroyed (flat faces bulge outward) |
| smoothOut() + refine(2) | 6.6667 | 5.9178 | **fails** (refined cube's new vertices collapse onto the 8 corners; 73 unshared edges) |
| smooth(crease-sharpened, 52.5°) + refine(2) | 5.3333 | 5.8939 | **fails** (344 unshared edges; welding at 1e-5…1e-3 changes nothing — the tangent-refined output structure itself is broken) |
| smooth only / + refine(1) | 8.0 (identity) | 5.9524 (identity) | passes but changes nothing |
| **refine(2) alone (no tangents)** | 8.0 | 5.9524 | **passes**, triangles ×4 |

Sphere-only and hull-only smoothed results do pass (single smooth
patches), but a general boolean finish cannot. Ruling (recorded in the
team ledger, 2026-11-20-02): **smooth is not shipped on 3.5.4**; U4
ships the verified refine finish instead, and smoothing is deferred to
the manifold-3d 3.5.5 decision (brief D15), at which point the
tangent-refine output gets re-measured. Two defect pins in the Phase
CH suite keep the evidence executable: if a future upgrade fixes the
library, those tests turn red and re-open the question.

## What shipped

- `CsgFinishKind` gains `'refine'`. `applyCsgFinish(result, finish,
  refineDivisions)` calls `result.refine(clampCsgRefineDivisions(n))`
  (clamp 2–3, from `lib/csgCore.ts`). The finish is applied inside the
  worker after the boolean and before gate (c), exactly like hull, so
  the verdict and reported numbers describe the subdivided solid.
- Cache key: 'none' and 'hull' keys are byte-identical to before;
  refine keys gain `|f:refine:<n>`.
- Config: +1 key `gpgpuCsgRefineDivisions` (default 2). The finish
  union widens to `'none' | 'hull' | 'refine'`; default finish stays
  'none' (fully inert).
- Panel: 仕上げ Toggle gains 細分化; a 細分化の分割数 slider (2–3)
  appears only when refine is selected; the status line appends
  「※仕上げ: 細分化（分割数 N）」; the section intro gained one
  sentence explaining that refine raises morph density without
  changing the shape.
- Starter `starter-csg-refine-diff` ("CSG Refine (Boolean Difference,
  Subdivided)"): the regression recipe with finish 'refine' at 2
  divisions; the embedded morph OBJ is the production-path result
  (1,208 tris / 606 verts, volume 5.952390).

## Verification

- `phasech_test.mjs`: **60 passed, 0 failed** (finish family + clamp +
  cache keys; volume/genus preservation on the diff, sphere, genus-1
  hole block and hull results; the two 3.5.4 defect pins; wiring;
  starter reproduction).
- Full sweep: **all 69 suites pass** (the CG suite's two exact-string
  pins for the CG-era call signatures were relaxed to prefix checks —
  CH extends both calls with the divisions argument).
- Typecheck clean. verify:shaders PASS (34 presets, 0 failures,
  0 console errors; the run needed a low-load window — three earlier
  attempts died on the audit's fixed waits, and a direct probe with a
  longer wait confirmed the label renders with zero errors).
- iMac real-GPU gate: **all cases pass** (see PHASE_CH_GATE_REPORT.md).
- Deploy: staged without --delete (catalog 1,664 files / share 1,660 /
  presets 1,660 intact); both hosts serve index-CsdJ-R1T.js with
  "1.81.0"; catalog thumb image/jpeg; preset JSON real.

## Remaining in the CSG second release

U2 free-form input (UI shape is the user's decision), U5 OBJ-load CSG
(brief must close the offset/scale convention), the G0 export-side
remainder (slicer 3MF check + D8 transforms), and smooth (blocked on
the 3.5.5 decision). Stopping point unchanged: no sales, publishing,
charges or mother-data changes; U6 out of scope.
