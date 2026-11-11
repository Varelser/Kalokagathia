MonoSphere Particle Generator — Rendering Roadmap Master

Current status

Render classes registered: 38

Render categories: 10

Project schema: v3 manifest-aware

Roadmap status: implemented base + expanded experimental layer set

Implemented milestones

Hidden 3D geometry controls exposed

Icosa geometry added

Render registry introduced

Image-driven particle layout

Video-driven particle layout

Text / glyph particle layout

Brush / filament connection lines

Membrane surface

Reaction diffusion surface

Volume fog stack

Convex shell surface

Surface patch reconstruction

Material style family

Glyph outline lines

Metaball styling / pulse

Fog material styling / anisotropy

Project export/import redesign

Schema-aware manifest

Fiber field

Growth field

Brush surface wash

Immediate next targets

A. Deposition / erosion field

Goal: create visuals that accumulate or dissolve over time rather than only move.

B. Voxel / lattice growth

Goal: extend growth beyond strands into chunked or crystalline accretion.

C. Brush volume

Goal: move from stacked paint planes toward true painterly volumetric strokes.

D. Capability matrix

Goal: formalize each renderer as:



WebGL stable

WebGPU preferred

export-heavy

mobile-risky

E. Renderer plugin contract

Goal: replace the current ad-hoc additions with a manifest-driven scene plugin structure.

Priority order

deposition / erosion field

voxel or lattice growth

brush volume

capability matrix

renderer plugin contract

Numerical progress model

Implemented now

experimental surface systems: 6

strand / growth systems: 4

media/text driven sources: 3

special blob/volume systems: 5

material-style aware systems: 5+

Success criteria for next phase

40+ registered render classes

12+ milestone families

plugin metadata added for every custom renderer

one-click grouping for depiction families

Notes

This roadmap is depiction-first. The question is not whether visuals can be unified into one GPU path, but whether the system can continue to widen the class of visuals it can depict while remaining editable and serializable.

Newly completed

Deposition / Erosion Field: sedimentary ridge surface driven by layer motion and audio.



Crystal aggregation was added after deposition as a dedicated instanced-solid procedural surface/structure hybrid.



Added erosion trail network rendering for layered runoff / gully streak structures.



Voxel / lattice aggregation



Crystal deposition hybrid surface
