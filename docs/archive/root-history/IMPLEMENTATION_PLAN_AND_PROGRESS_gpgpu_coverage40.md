IMPLEMENTATION_PLAN_AND_PROGRESS_gpgpu_coverage40

Goal

Broaden depiction coverage without deleting any existing family, operator recipe, preset, or renderer route. This phase treats execution method coverage and motion coverage as first-class planning objects so GPGPU / WebGPU / procedural geometry / particle fields can be expanded systematically instead of ad hoc.

What this phase adds

Added a new runtime coverage analyzer in lib/depictionCoverage.ts.

Coverage is now tracked across four additive dimensions:

depiction methods

motion families

compute backends

active GPGPU feature bands

Project manifest stats now expose those counts so exported projects show how broad a scene already is.

Project I/O UI now displays the new coverage chips.

Added six GPGPU starter presets so existing GPU motion bands are reachable immediately from the starter library.

Why this phase matters

The project already had many GPGPU controls and several procedural systems, but they were not organized as a deliberate coverage layer. That made it harder to answer:



which depiction methods are already active

which motion families are already represented

whether a scene is CPU-only / procedural / WebGL GPGPU / WebGPU compute

whether GPGPU capability exists but is underexposed in presets



This phase fixes the planning surface first, then exposes more of the existing GPU bandwidth through presets.

Implemented files

lib/depictionCoverage.ts

additive coverage analysis

active GPGPU feature extraction

motion family / depiction method / backend classification

lib/projectState.ts

manifest stats extended with coverage counts

GPGPU snapshot features widened beyond ribbon/tube/metaball only

types/project.ts

new manifest stat fields

components/controlPanelProjectIO.tsx

schema-aware snapshot now shows Methods / Motions / Backends / GPGPU counts

lib/starterLibrary.ts

added six GPGPU-focused starter presets and sequence items

Added starter presets

starter-gpgpu-boids-flock-array

starter-gpgpu-curl-vortex-ribbon

starter-gpgpu-attractor-smooth-tube

starter-gpgpu-fluid-metaball

starter-gpgpu-volumetric-ion-cloud

starter-gpgpu-webgpu-curl-field

Coverage plan after this phase

Phase 40A completed

coverage analyzer layer

manifest visibility layer

starter access layer for existing GPGPU bands

Next careful phases

Phase 40B

Add explicit motion-band scorecards for:



flock / swarm

fluid / SPH

vortex / curl

attractor / chaos

elastic / spring / verlet

field / wind / gravity well / vector field

collision / SDF / mouse interaction

volumetric / metaball / tube / ribbon

Phase 40C

Add coverage browser filters in UI:



filter starter presets by backend

filter starter presets by motion family

filter starter presets by depiction method

Phase 40D

Add dedicated handcrafted axes only where generic GPGPU coverage is still weak:



dense flock structure

granular GPU packing

GPU sheet / ribbon advection

GPU erosion / dissolution style transport

Non-destructive rule check

Existing families kept intact

Existing operator presets kept intact

Existing renderer routing kept intact

Existing procedural systems kept intact

New coverage logic is additive only

Verification target

npm run typecheck

npm run build
