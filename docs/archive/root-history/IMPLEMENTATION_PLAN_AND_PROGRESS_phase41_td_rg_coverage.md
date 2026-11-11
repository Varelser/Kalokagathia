Phase 41 — TouchDesigner / Red Giant coverage foundation

Goal

Add a schema-aware coverage layer that treats depiction expansion as a matrix of:



source families

motion families

render families

compute backends

post families

GPGPU features



This phase does not attempt product cloning. It adds the abstraction needed to measure and expand toward TouchDesigner-like and Red Giant-like coverage without deleting existing families.

Implemented in this phase

Expanded depictionCoverage.ts from 4 axes to 7 axes:



depiction methods

motion families

compute backends

source families

render families

post families

GPGPU features



Expanded project manifest schema to include:



coverage arrays in export/import snapshots

sourceFamilyCount

renderFamilyCount

postFamilyCount



Updated Project IO panel to show:



counts for Sources / Renders / Post FX

explicit coverage rows for source families, render families, and post families



Added product-inspired starter packs without hard-coding vendor dependency:



Touch Feedback Topology

Touch POP Force Cloud

Trapcode Particular Noir

Trapcode Form Lattice

Universe Retro Feedback

Audio Reactive Operator Stack

Why this order

If preset packs are added before coverage is measurable, expansion becomes opaque and harder to audit. This phase makes future gap-filling mechanical instead of subjective.

Remaining high-value next steps

Phase 42

Add explicit scorecards for missing source families and render bands:



text-glyph

image-map

video-map

mesh/surface emitters

spline/path emitters

brush/paint emitters

instanced object swarms

raymarch / SDF render bands

Phase 43

Split post stack into a more explicit reusable operator layer:



bloom

starglow / shine-like streaks

RGB split / chromatic aberration

feedback echo

retro scanline/noise/distortion

displacement / heat haze

Phase 44

Move from recipe chains toward graph-like operator routing:



emitter → sim → render → post

branch / merge

product-parity preset bundles built on top of graph nodes

Validation

TypeScript typecheck passed

Vite build passed

Notes

Build still reports large chunks in three-core and main index. That is a packaging/performance task, not a correctness failure.
