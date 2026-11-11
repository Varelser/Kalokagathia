IMPLEMENTATION PLAN AND PROGRESS shaping17

Scope

Compress the visual difference for shell / halo / membrane families.

Focus on halo_bloom, membrane_pollen, and spore_halo.

Keep renderer / depictionArchitecture / atlas / hybrid / starter in sync.

Implemented

components/sceneSurfaceShellSystem.tsx



Added shell profile axes for haloSharpness, equatorBias, poreAmount, sporeAmount, bloomAmount, centerDarkness, and blendMode.

Extended hull deformation so halo modes compress toward the equator and membrane modes develop porous cut-ins.

Added shader uniforms for pore breakup, spore grain, bloom rings, halo sharpness, and center dimming.

Switched some shell modes from additive to normal blending for better membrane/script readability.



lib/depictionArchitecture.ts



Refined the architecture descriptions for halo_bloom, membrane_pollen, and spore_halo to match the new shaping logic.



lib/expressionAtlasBundles.ts



Added halo-bloom-equinox.

Added membrane-pollen-herbarium.

Added spore-halo-reliquary.



lib/hybridExpressions.ts



Added halo-membrane.

Added spore-reliquary.



lib/hybridTemporalVariants.ts



Added halo-membrane-breath.

Added spore-reliquary-shed.



lib/starterLibrary.ts



Added starter-halo-bloom-equinox.

Added starter-membrane-pollen-herbarium.

Added starter-spore-halo-reliquary.

Added matching preset-sequence entries.

Validation

npm run typecheck

npm run build

Coverage snapshot

halo_bloom: 1 -> 2 starter presets

membrane_pollen: 4 -> 6 starter presets

spore_halo: 4 -> 5 starter presets

Next recommended target

Re-compress the difference for aura_shell, eclipse_halo, and resin_shell as a final shell-family polish pass.

After that, move to export-facing sample curation rather than more renderer expansion.
