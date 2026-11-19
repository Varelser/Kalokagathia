# Phase CJ Report — CSG second release U5: OBJ-load mesh operands (v1.83.0)

- Date: 2026-11-20 (JST)
- Version: 1.82.0 → **1.83.0** (bundle index-8mbRCSMo.js, worker csgWorker-C6rRPDfw.js — unchanged, the worker needed no changes)
- Deployment: `71abeb5b-10c0-45e4-abd6-9b9283970378` (https://71abeb5b.monosphere.pages.dev)
- GitHub: Varelser/Kalokagathia commit `4fa575ec` (sync record #141)
- Totals: keys **1,358** (+1), starters **605** (+1), catalog 1,660 (unchanged)

## Premise state (verified in real code before starting)

Phase CC's pipe was already half-built for this unit,
exactly as #3 ミッドナイト's round-11 premise check
said: the `CsgOperand` mesh variant, the construction
branch in `buildCsgOperand` (Mesh numProp 3 →
Manifold.ofMesh, deliberately no merge), the client
gate (a) call on mesh operands in `lib/csg.ts`, the
content-hashed mesh cache key, and the worker's
NOT_MANIFOLD status classification all existed. The
missing pieces were M1 (a producer), M2 (UI), and M3
(the placement convention).

## M3 ruling (commander, closing the brief's gap)

Mesh operands are **raw world units**: no
normalisation, no scale — the size keys do not apply.
Placement is the existing per-operand offset only.
This follows the brief's own direction for U5 ("NO
morph normalisation — raw units") and the discipline
Phase CI set for custom cross-sections. Recorded in
the ledger note for this phase.

## What shipped

- **Producer** (`lib/csgMeshOperand.ts`, new):
  `buildMeshOperandFromObj(text, offset)` — parses
  with the existing `parseObjGeometry` (no second
  parser), welds vertices at 1e-6 via
  `weldMeshPositions` (the gate's own quantisation,
  so the judged form and the constructed form agree;
  welding only identifies coincident vertices and
  drops triangles that degenerate in the process —
  nothing is moved or filled, no repair), applies the
  offset, and returns the operand. `parseCsgMeshText`
  exposes the welded data for the panel's live status.
- **Config**: kind unions for A/B gain `'mesh'`; +1
  key `gpgpuCsgMeshObjText` whose default is a
  112-vertex / 224-triangle torus OBJ (R 1.05,
  r 0.42, genus 1). Descriptions and AI catalog
  entries added.
- **Panel**: kind select gains 「メッシュ（OBJ読み込み）」;
  when either operand is mesh, a block appears with
  the textarea (200,000-char cap), a file loader
  (.obj/.txt), and a live status line driven by the
  welded parse + gate (a): counts and genus when the
  mesh is closed, the gate's reason when it is not,
  and the skipped note above the 100,000-face cap.
  `run()` builds mesh operands per operand offset and
  aborts with the reason on parse failure; gate (a)
  itself fires inside `runCsgOperation` as designed.
- **Starter** `starter-csg-mesh-torus`: A = the
  default torus mesh, B = size-2 sphere at x=1.1,
  difference → volume **2.251255**, 372 triangles,
  genus 1 → 0 (the bite closes the hole); the result
  OBJ is embedded as the morph target
  (`SAMPLE_OBJ_CSG_MESH_TORUS`).
- The closedness judgement for CSG input is gate (a)
  (1e-6 weld + shared edges + generalised Euler), not
  the morph side's `isObjClosedMesh`; this is stated
  in the tests and was the brief's open asymmetry.

## Verification

- `phasecj_test.mjs`: **38 passed, 0 failed** —
  conversion numbers (torus 3.182276 / genus 1),
  starter recipe, weld behaviour (per-face cube →
  8 verts / volume 1; raw-units 3-cube = 27), quad
  faces via the existing parser, gate (a) as the
  judgement (open cube refused), failure reasons,
  offset/cache-key behaviour, wiring, starter,
  totals.
- Full sweep: **all 71 suites pass** (the sweep's
  SWEEP_FAIL=1 flag was a pattern artifact — three
  suites print "0 fail" instead of "0 failed"; every
  suite's own line reports zero failures). Typecheck
  clean.
- verify:shaders: **PASS** (one known fixed-wait
  flake, re-run passed).
- iMac real-GPU gate: **ALL PASS, first run** — see
  PHASE_CJ_GATE_REPORT.md.
- Deploy: staged without --delete (static dirs
  intact at 1,660 each); live verified on both hosts
  immediately and after a delay (bundle
  index-8mbRCSMo.js, "1.83.0" present, catalog thumb
  image/jpeg, preset real JSON).

## CSG second release — remaining

- G0 export-side remainder: slicer 3MF check + the
  D8 exportTransform/importTransform implementation.
- U4 smooth: deferred to the manifold-3d 3.5.5
  decision (Phase CH ruling).
- U6 STL/glTF load: start conditions not fixed.
