# Phase CH Gate Report — iMac real GPU (ANGLE Metal)

- Date: 2026-11-20 (JST)
- GPU: ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 5500 XT)
- Candidate: v1.81.0, bundle index-CsdJ-R1T.js, worker csgWorker-D0mABq7-.js, served at http://127.0.0.1:8851/
- OLD: production https://monosphere.pages.dev/ (v1.80.0)
- Results: ~/monosphere-check/phasech/results-all.json, gate.log

## identity — PASS
12 frames, frame diffs all 0; idle config (all CC–CH keys at inert
defaults incl. gpgpuCsgRefineDivisions 2) diffs all 0; manifest 1.81.0.

## det — PASS
Refine starter rendered twice: repeat diffs all 0. Sphere-fallback
scene differs (min 0.044440).

## ui — PASS (real panel drive)
- Regression recipe (defaults): 5.9524 / 302 tris / euler 2 /
  components 1 / genus 0.
- 仕上げ toggle → 細分化 clicked; the 細分化の分割数 slider is shown.
- Refine recipe: **5.9524 / 1,208 tris / euler 2 / components 1 /
  genus 0**, status note 「仕上げ: 細分化（分割数 2）」 shown; second
  run identical.
- Import into morph: status shown, canvas meanAbsDiff 0.038167.

## probe — PASS (production worker asset csgWorker-D0mABq7-.js)
All 10 checks: refineDiff volume 5.952390 / 1,208 tris / gate ok
genus 0; determinism (identical position hash); refine(3) = 2,718
tris at the same volume; finish 'none' regression 302 tris; finish
'hull' regression 13.459556 / 576; open grid mesh still rejected
NOT_MANIFOLD with the refine finish; timing recorded; no errors.

## fps — PASS
FROZEN avg 59.8 (min window 58); starter avg 60.2 (min window 60).

## errors
errorCount 0. **ALL PASS.**
