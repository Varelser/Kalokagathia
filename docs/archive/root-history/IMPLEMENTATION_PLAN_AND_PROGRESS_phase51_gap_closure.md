Phase 51 — motion / render / source / post gap closure

What was implemented

Added three gap-closure product packs to cover the remaining motion/render/source/post targets.

Corrected coverage mapping so GPGPU shell emitters count toward shell-volume and GPGPU instancing counts toward instanced-geometry.

Verified typecheck and production build after changes.

New packs

Niagara Chaos Magnetic Tubes

covers chaos / swarm / magnetic / elastic motion

covers gpu-tubes and random-scatter / aux / sdf-assisted render paths

Houdini Shell Metaball Volume

covers shell-volume source

covers gpu-metaballs / gpu-volumetric and vignette-darken paths

Hybrid Contact SDF Scatter

covers random-scatter source

covers contact-fx / sdf-shading / vignette / instanced-geometry / aux-particles

Coverage result

Measured against the current internal target set:



total targets: 92

covered: 92

overall coverage: 100%

product packs: 25

families: 8



Axis coverage:



source: 14 / 14

render: 24 / 24

post: 20 / 20

compute: 7 / 7

motion: 17 / 17

solver: 10 / 10

Notes

This is 100% against the project's current measured target registry, not a claim that every conceivable generation method in existence is exhausted.

The next meaningful phase is no longer simple gap filling. It should shift to either:

deeper sub-axes inside each family, or

quality / performance / chunk-splitting / UI reachability improvements.
