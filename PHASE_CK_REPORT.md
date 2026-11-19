# Phase CK Report — CSG result export (G0 export side)

Version: **1.84.0** · Date: 2026-11-20 · Deployment:
`ad0c24d2-2f79-4a3c-9209-6e06466fac2e`
(https://ad0c24d2.monosphere.pages.dev, production
https://monosphere.pages.dev — both hosts verified
byte-identical index, bundle `index-BzCa4Vk3.js`)

## Scope

The export side of the CSG second-release brief's G0
remainder (brief rev1 §9 / D3 / D8 / D14, #5
ランザルザー's G0 checklist C1–C5): CSG results can be
downloaded as GLB (EXT_mesh_manifold), 3MF, and STL.
Stopping point held: no sales/publishing/charges, no
mother-data changes, U6 and the manifold-3.5.5
decision untouched.

## Premise measurements (before implementation)

- The app had **no** GLB/3MF export of CSG results at
  all: no `exportTransform`/`importTransform`, no
  GLTFExporter use; the CSG result's only exit was
  take-into-morph (OBJ text).
- manifold-3d 3.5.4's own helpers (`lib/gltf-io.js`,
  `lib/export-3mf.js`, on @gltf-transform/core) work
  from the project with two traps, both measured in
  the spike (`spike_ck.mjs`):
  1. `writeMesh` with an empty id2properties Map
     writes **no position accessors at all**; a Map
     entry per runOriginalID with
     `attributes: ['POSITION']` is required.
     `readMesh` likewise needs `['POSITION']` passed
     explicitly.
  2. **export-3mf applies no D8 transform**: from a
     glTF-convention document it writes unit
     "millimeter" but the raw metre values with no
     axis swap — exactly the D8 failure mode (a
     slicer reads 1/1000 scale, lying on its side).
     The conversion is therefore baked in by this
     phase's own transform.
- D8 transforms (proper rotation, determinant +1,
  winding preserved):
  export `(x, y, z) → (x, −z, y) ×1000`;
  import `(x, y, z) → (x, z, −y) ÷1000`.

## Implementation

- NEW `lib/csgExport.ts`: pure
  `exportTransformPositions` / `importTransformPositions`;
  `assertExportableMesh` (the C3 pre-check — the
  result must pass the same `checkWatertightGate`
  used for CSG inputs, else the export refuses with
  the gate's reason instead of letting the 3MF
  writer drop the mesh silently); GLB via gltf-io
  `writeMesh` + `toArrayBuffer`; 3MF via
  transform → writeMesh → export-3mf
  (header unit millimeter); hand-rolled binary STL
  with recomputed face normals; a dispatcher
  returning `{bytes, filename, mime}`.
- Panel: three buttons (GLB / 3MF / STL, D3 order)
  beside take-into-morph in the CSG section, a units
  note, status-line feedback. The export module is
  loaded by **dynamic import()** on click, so
  @gltf-transform lands in a split chunk
  (`csgExport-CS54L0za.js`) and the initial bundle
  structure is unchanged. Export runs on the main
  thread by design.
- No new config keys, no new starter. Totals stay
  **keys 1,358 / starters 605**.

## Tests

- `phaseck_test.mjs`: **39/39**. Transform unit
  tests (axis mappings, round-trip identity, signed
  volume ×1e9 sign-preserved); round trips on a real
  production-path CSG result (torus − sphere,
  2.251255 / 372 tris):
  - GLB: dVol 0%, dArea 0% (EXT verified in the JSON
    chunk; readback via readMesh)
  - OBJ: dVol 0.000004%, dArea 0.000005%
  - 3MF: dVol 0.000002%, dArea 0.000001%, plus the
    file-level slicer check (unit millimeter; bounds
    equal the D8-transformed source bounds)
  - STL: exact length, dVol 0%
  All within the D14 acceptance order (C4).
- Cost at 102,152 triangles (C5): GLB out 63 ms /
  back 19 ms; 3MF out 687 ms / unzip 114 ms.
- EXT pre-check: an open cube is refused with the
  gate's reason through both the assert and the
  dispatcher (C3).
- Full sweep: **72 suites, all passing** (the one
  flag was phasecj's exact `1.83.0` version pin,
  relaxed to the house `>=` idiom; phaseck's own
  version checks use the same idiom).
- Typecheck clean. verify:shaders PASS (25/34
  presets toured, failures 0, console errors 0; the
  first run hit the known fixed-wait flake and the
  re-run passed in full).

## Gate (iMac real GPU)

`PHASE_CK_GATE_REPORT.md` — all cases pass, 0 errors.
The ui case clicks the real export buttons and
verifies the actual downloads. First run failed one
expectation of mine (3MF z bounds ±1470 assumed; the
faceted 14-segment torus reaches only ±1433.1 in Y —
no vertex at 90°); the downloaded file was correct
and the Node suite's source-bounds formulation had
already pinned it exactly. Expectation corrected to
the measured faceted extent and the full gate
re-run: all pass.

## Also in this shipment

The Phase CC–CJ implementation and gate reports
(16 files) are added to the repository root: code
comments and CURRENT_STATUS referenced them, but
they existed only commander-locally (#3 ミッドナイト's
round-14 note (a)). The CK reports join them.
