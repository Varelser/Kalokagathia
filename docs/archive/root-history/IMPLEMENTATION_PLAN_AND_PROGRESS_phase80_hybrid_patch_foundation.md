Phase 80 — Hybrid Patch Foundation

Goal

Add a third hybrid execution foundation that is distinct from legacy procedural surface routing and can be reused by later hybrid field families.

Implemented

Added lib/hybridRuntimeShared.ts for shared source influence and audio drive utilities.

Added components/sceneHybridSurfacePatchSystem.tsx as a third hybrid runtime renderer.

Routed surface-patch family to hybrid-runtime when hybridPatchEnabled is on.

Added global toggle for Hybrid Patch Surface.

Why now

This keeps the roadmap efficient: after volumetric and SDF shell, patch is the next low-risk family for validating a reusable hybrid runtime path before moving into heavier compute foundations.
