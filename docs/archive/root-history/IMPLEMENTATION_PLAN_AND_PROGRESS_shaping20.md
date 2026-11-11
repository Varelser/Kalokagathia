IMPLEMENTATION_PLAN_AND_PROGRESS_shaping20

Summary

Volumetric final compression completed on the available shaping18-source base because shaping19-source.zip was not present in this environment. Focused on dust_plume, ashfall, mirage_smoke, and static_smoke with renderer-specific shaping, depiction registry updates, atlas/hybrid additions, and starter density increases.

Implemented

1. Volume fog renderer specialization

Added new FogProfile axes:

plumeAmount

fallAmount

mirageAmount

staticAmount

dustAmount

edgeFade

Strengthened mode-specific behavior:

dust_plume = convective column + coarse motes + matte desaturation

ashfall = gravity streaks + particulate curtain + ledger-like descent

mirage_smoke = refraction bands + shimmer + heat-field wobble

static_smoke = scan flicker + block noise + slab density

Added matching shader uniforms:

uPlumeAmount

uFallAmount

uMirageAmount

uStaticAmount

uDustAmount

uEdgeFade

2. Depiction architecture updates

Updated depiction descriptions for:



dust_plume

ashfall

mirage_smoke

static_smoke

3. Expression atlas bundles added

sphere-dust-plume-column

plane-ashfall-ledger

video-mirage-heatfield

grid-static-smoke-slab

4. Hybrid recipes added

dust-ledger

mirage-static

5. Hybrid temporal variants added

dust-ledger-settle

mirage-static-flicker

6. Starter preset density added

starter-dust-plume-column

starter-ashfall-ledger

starter-mirage-heatfield

starter-static-smoke-slab



Matching sequence entries were also added.

Verification

npm ci passed

npm run typecheck passed

npm run build passed

Build output

dist/assets/index-DCIuATAZ.js 901.56 kB

dist/assets/index-B8FfSG2b.css 52.78 kB

dist/assets/particleDataWorker-Lw8A5S4w.js 122.85 kB

Starter density counts

dust_plume: 2

ashfall: 3

mirage_smoke: 4

static_smoke: 2

Updated files

components/sceneVolumeFogSystem.tsx — 364行 / 19.7 KB

lib/depictionArchitecture.ts — 139行 / 17.4 KB

lib/expressionAtlasBundles.ts — 364行 / 18.2 KB

lib/hybridExpressions.ts — 362行 / 14.8 KB

lib/hybridTemporalVariants.ts — 460行 / 14.7 KB

lib/starterLibrary.ts — 4246行 / 146.0 KB

Next

Remaining natural target: volumetric + deposition bridge, especially velvet_ash / soot_veil / rune_smoke / ink_bleed cohesion.

Secondary target: reduce large bundle size through manual chunking or selective lazy-loading.
