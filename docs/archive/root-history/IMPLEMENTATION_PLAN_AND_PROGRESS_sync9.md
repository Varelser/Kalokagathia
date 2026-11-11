IMPLEMENTATION PLAN AND PROGRESS sync9

Goal

Eliminate the highest-priority synchronization drift across:



layer motion type definitions

motion catalog grouping

motion selector exposure

procedural renderer routing

project manifest / stats reporting

render mode registry activation

What was fixed

1. Added a shared procedural mode registry

Created lib/proceduralModeRegistry.ts as a common source for:



procedural system IDs

mode-to-system mapping

mode-to-feature-tag mapping



This removes repeated hand-maintained arrays from multiple files.

2. Synchronized motion coverage to full mode count

Updated components/motionCatalog.ts so all Layer2Type motion modes are represented in group catalogs. Added the missing modes:



field

pendulum

braid

3. Synchronized motion selector coverage

Updated components/controlPanelPartsMotion.tsx so selector options are generated from MOTION_GROUPS with fallback metadata. Result:



selector coverage now matches catalog coverage

selector coverage now matches Layer2Type coverage

newly added modes are reachable from UI without manual duplicate maintenance

4. Unified procedural renderer routing in AppScene

Updated components/AppScene.tsx to route procedural systems from shared registry helpers instead of repeated ad-hoc arrays. This closes routing gaps for late-added families such as:



shell_script

eclipse_halo

resin_shell

glyph_weave

lattice_surge

fracture_bloom

ember_drift

5. Unified project manifest feature tagging and stats

Updated lib/projectState.ts to derive procedural feature tags and procedural mode counts from the shared registry. This reduces stat drift and ensures manifest reporting reflects current procedural mode coverage.

6. Unified render mode registry activation

Updated lib/renderModeRegistry.ts so procedural renderer activation conditions also resolve through the shared procedural registry. This keeps the render registry aligned with AppScene routing.

Verification

scene type / motionCatalog / selector coverage synchronized to 172 / 172 / 172.

npm run typecheck passed.

npm run build passed.

Highest-priority work completed

Yes. The top priority was not “add more modes first,” but “make existing modes consistently reachable and correctly routed.” That synchronization pass is now implemented.

Recommended next priority

Expand depictionArchitecture.ts so newer late-added modes are semantically classified there as well.

Move selector labels/icons into a dedicated metadata registry to reduce component size.

Continue with renderer-specific shaping so families differ more strongly in visible output, not only in routing.
