# Phase CI Report — CSG second release U2: free-form cross-section input (v1.82.0)

- Date: 2026-11-20 (JST)
- Version: 1.81.0 → **1.82.0** (bundle index-DtnHLyCN.js, worker csgWorker-C6rRPDfw.js)
- Deployment: `fd9760a7-4e5b-4445-9961-1057fd4ab0ed` (https://fd9760a7.monosphere.pages.dev)
- GitHub: Varelser/Kalokagathia commit `bcf10def` (sync record #140)
- Totals: keys **1,357** (+1), starters **604** (+1), catalog 1,660 (unchanged)

## Scope decision

The commander offered three UI routes (A: text paste,
B: A + SVG file load, C: point editor). The user
(2026-11-20 01:06 JST): 「できるだけ網羅して全て実装して」
— all three routes in one phase. Commander-settled
conventions: coordinates are world units as written
(the size key does not apply, matching U5's raw-units
discipline); multiple disjoint polygons are allowed;
holes are NOT supported (the shared validation refuses
containment); the config text is the single source of
truth and the editor writes point-list text back into
it (an SVG input converts to a point list on the first
edit, stated in the editor hint).

## What shipped

- **Parser** (`lib/csgFreeform.ts`, new):
  `parseFreeformText` dispatches on the input shape —
  SVG documents (extracts `<path d>`, `<polygon>`,
  `<polyline>`, `<rect>`, `<circle>`, `<ellipse>`),
  bare SVG path data (commands M L H V C S Q T A Z,
  absolute + relative; cubic flattened at 16 steps,
  quadratic at 12, arcs via endpoint→centre conversion
  at ≤15°/segment), and point lists (blank-line
  separated blocks, `#` comments, "x, y" / "x y" /
  flat number streams). Caps: 16 polygons, 4,096
  points. Every result passes the shared
  `validateExtrudePolygons` (self-intersection /
  overlap / containment refused with reasons).
  `serializePolygonsToPointList` is the canonical
  writer (4-decimal rounding).
- **Spec/key/builder**: `CsgExtrudeProfileKind` gains
  `'custom'`; `CsgExtrudeSpec.customPolygons` carries
  the parsed polygons; `resolveExtrudePolygons(spec)`
  (new in `lib/csgExtrude.ts`) is the single resolver
  used by the builder and the client pre-check;
  `csgOperandKey` appends an FNV-1a hash of the points
  for custom profiles only — preset keys stay
  byte-identical.
- **Config**: +1 key `gpgpuCsgExtrudeCustomText`
  (default = a 10-point star point list). Descriptions
  and AI catalog entries added; the profile
  description mentions the custom route.
- **Panel** (`components/controlPanelPlayTabGraph.tsx`):
  profile select gains 「カスタム（自由形）」; when
  custom, a block appears with the textarea
  (200,000-char cap, the established idiom), a
  file-load control (.svg/.txt), a live parse status
  line (「N 図形・M 点（形式）」 or the refusal reason),
  and the point editor. `run()` parses the text first
  and aborts with the reason before any worker traffic.
- **Editor** (`components/csgFreeformEditor.tsx`, new):
  SVG canvas over ±2.5 world units (0.5 grid, y-up),
  click adds a point to the active polygon, pointer
  down near a point (<0.16) drags it, buttons for
  undo / close-and-next / clear-all.
- **Starter** `starter-csg-extrude-custom-star`: the
  default star extruded at height 1.2 minus the size-2
  sphere at x=1 → volume **1.242676**, 218 triangles,
  gate ok; the generated OBJ is embedded as the morph
  target (`SAMPLE_OBJ_CSG_CUSTOM_STAR`).

## Bug found by the gate (and fixed before shipping)

The first gate run passed everything except the
editor drive: each mouse click produced exactly one
point — the latest click's. Cause: the editor derived
its points from the strict parse, which refuses the
1–2 point states a shape passes through while being
drawn, so every click restarted from an empty list.
Fix: `parsePointListLenient` (keeps partial polygons,
drops a dangling odd number) + `cleanFreeformPolygons`
extracted as the shared cleanup; the editor falls
back to the lenient parse for point-list drafts (SVG
texts still start from empty when invalid). The
strict parse remains the only entry for running an
operation. Five new tests pin the lenient behaviour
and the contrast with the strict refusal. Two gate
harness lessons were also recorded in the gate script:
panel sections fold with display:none (programmatic
clicks work folded, real mouse clicks need the
section unfolded and scrolled into view), and click
expectations must be derived from the points the
editor actually produced (sub-pixel jitter).

## Verification

- `phaseci_test.mjs`: **63 passed, 0 failed** —
  parser coverage for all three formats, validation
  integration, production-path builds (star prism =
  shoelace area × height; starter recipe numbers),
  cache-key identity, wiring, starter, totals.
- Full sweep: **all 70 suites pass** (one CF pin
  relaxed: the client pre-check now calls the resolver,
  same invariant). Typecheck clean.
- verify:shaders: **PASS** (after the known fixed-wait
  flake repeated; a faithful replication probe showed
  the label present with zero console errors).
- iMac real-GPU gate: **ALL PASS** — see
  PHASE_CI_GATE_REPORT.md.
- Deploy: staged without --delete (static dirs
  intact: catalog/share/presets 1,660 each); live
  verified on both hosts immediately and after a
  delay (bundle index-DtnHLyCN.js, "1.82.0" present,
  catalog thumb image/jpeg, preset real JSON).

## CSG second release — remaining

- U5 OBJ-load CSG (the M3 offset/scale convention is
  still to be fixed in the brief).
- G0 export-side remainder: slicer 3MF check + the D8
  exportTransform/importTransform implementation.
- U4 smooth: deferred to the manifold-3d 3.5.5
  decision (Phase CH ruling).
- U6 STL/glTF load: start conditions not fixed.
