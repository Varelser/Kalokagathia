MonoSphere Particle Generator — System Design Blueprint

1. Purpose

This project is no longer treated as a single particle renderer. It is a layered visual system for combining:



source layouts

motion/simulation

render classes

material styles

post processing

project state



The main design goal is breadth of depiction rather than forcing every visual through one GPU pathway.

2. Core architectural idea

Each visible result is the combination of five axes.



Source

sphere, ring, grid, plane, image, video, text

Motion / simulation

flow, curl, orbit, sheet, reaction diffusion, volume fog, fiber, growth, etc.

Render class

particles, lines, ribbons, solids, surfaces, volumetrics, metaballs

Material style

classic, glass, hologram, chrome, halftone

Post FX

bloom, chromatic aberration, DOF, overlays

3. Runtime composition

App.tsx owns workspace state, presets, sequence state, and project import/export.

components/AppScene.tsx routes each layer to the correct renderer.

lib/renderModeRegistry.ts tracks active render classes, support level, and progress metrics.

lib/projectState.ts builds exportable project manifests and summary counts.

4. Layer model

Layer 1

Primary particle field / legacy core layer.

Layer 2 and Layer 3

Experimental expansion layers. These can switch among:



particle rendering

membrane/surface rendering

reconstructed shells/patches

fog volumes

fiber and growth structures

text/image/video driven layouts

GPGPU layer

Separate high-density pathway for metaballs, smooth tubes, and dense GPU-oriented visuals.

5. Current render-class map

Particles

layer points/sprites

image-driven layout

video-driven layout

text/glyph layout

Lines / strands

classic connections

brush connection strips

filament connection strips

glyph outline lines

fiber field strands

growth branch structures

Surfaces

membrane surface

reaction diffusion surface

convex shell surface

reconstructed surface patch

brush surface wash

Volumetric

fog stack

fog material styling

fog glow / anisotropy

Solids / blobs

instanced solids

metaballs

metaball material styling

metaball pulse modulation

6. Data and persistence

Project persistence now uses versioned project JSON with:



full config

presets

sequence state

UI state

schema-aware manifest

per-layer summary

statistical counts



This keeps exports migration-friendly even when the config object grows.

7. Extension rule

New depiction modes should be added by following this sequence:



define layer type / settings

add scene system component

route through AppScene.tsx

register class in renderModeRegistry.ts

expose controls in layer panel

reflect in project manifest features

document in roadmap

8. Current bottlenecks

Large control panel files for Layer 2 and Layer 3

Some render systems still duplicate material-style logic

Render registry is summary-driven rather than full plugin metadata

Capability routing is still heuristic, not formalized per system

9. Recommended next architecture step

Move from ad-hoc scene systems toward a clearer plugin contract:



id

label

category

support level

settings schema

scene component

manifest features

performance classification



That would make future additions such as deposition, erosion, voxel growth, or brush volumes much easier to add.

Additional surface family

Deposition / Erosion Field: a stratified terrain-like surface class for sediment, cuts, and weathered accumulation.



Crystal aggregation extends the specialized render-class family by sampling particle motion into clustered solid formations.



Added erosion trail network rendering for layered runoff / gully streak structures.



Voxel / lattice aggregation as a snapped instanced-solid field



Hybrid strata-crystal rendering combines sediment surfaces with instanced crystalline growth.
