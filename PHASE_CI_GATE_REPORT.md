# Phase CI Gate Report — iMac real GPU (ANGLE Metal)

- Date: 2026-11-20 (JST)
- GPU: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 5500 XT)
- Candidate: v1.82.0, bundle index-DtnHLyCN.js, worker csgWorker-C6rRPDfw.js
- Production (OLD): v1.81.0 at https://monosphere.pages.dev
- Scripts: `phaseci_gate.mjs`, `phaseci_probe_build.mjs`
  (results: `~/monosphere-check/phaseci/results-all.json` on the iMac)

## Result: ALL PASS (errorCount 0)

- **identity**: 12 frames bit-identical (maxDiff 0);
  the candidate with every CC–CI key at its inert
  default also 12 frames diff 0; manifest 1.82.0.
- **det**: the custom-star starter configuration
  rendered twice = bit-identical (repeatMax 0);
  sphere-fallback scene differs (fallbackMin 0.026535).
- **ui** (real panel drive):
  - regression recipe (defaults): 5.9524 / 302 tris /
    euler 2 / 1 component / genus 0.
  - operand A → extrude, profile → custom: the custom
    block (textarea + editor) appears; the live status
    reads 「1 図形・10 点（点リスト）」.
  - height slider → 1.2, run: **1.2427 / 218 / genus 0**,
    twice identical (the starter recipe through the
    real panel).
  - editor: section unfolded, four real mouse clicks
    draw the square (-1,-1) (1,-0.992) (1,1.008)
    (-1,1); the textarea holds exactly those points.
  - B → cube, operation → union, B offset X → 3,
    height → 1: **12.0000 / 24 tris / euler 4 /
    2 components / genus 0** — matching the shoelace
    expectation computed from the drawn points.
  - import into morph: status shown, canvas changed
    (meanAbsDiff 0.032733).
- **probe** (production worker asset, all 9 checks):
  custom star difference 1.242676 / 218 / gate ok,
  position hash b89ee556 identical across two runs
  (56 ms); two disjoint custom squares + a cube union
  = 10 / 36 tris / 3 components; plain difference
  regression 5.952390 / 302; a bowtie custom polygon
  refused NOT_MANIFOLD with the self-intersection
  reason.
- **fps**: FROZEN avg 59.8 (min window 58), starter
  avg 60.2 (min window 60). Pass bar: avg > 30.

## Gate history for this phase

Runs 1–2 failed only the ui case's editor step: first
the section fold (display:none) zeroed the editor's
bounding box; after unfolding, each click still
produced a single point — the real product bug
(editor drafts re-derived from the strict parse),
fixed in the app (lenient draft parse) and re-gated
from scratch. The final run above is on the fixed
build (index-DtnHLyCN.js).
