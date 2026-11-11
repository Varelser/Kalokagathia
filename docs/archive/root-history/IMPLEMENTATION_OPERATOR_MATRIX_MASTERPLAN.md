Operator Matrix Masterplan

Goal

Keep every existing family, mode, preset, and renderer intact while adding a non-destructive operator layer that can scale coverage much faster than one-mode-at-a-time work.

Rule

Existing files and existing modes are not deleted.

Existing renderer routing remains the source of truth.

Operator recipes sit on top of existing modes and generate bundles / starter presets / hybrids.

Manual crafted presets remain available alongside generated operator presets.

Source-aware weighting is additive only and must not rewrite existing handcrafted presets.

Coverage Strategy

The operator layer uses these axes:



material: ink / ash / resin / glass / crystal / bio / metal / dust / vapor

geometry: sheet / shell / fog / aggregate / lattice / mesh / front / plate

dynamics: capillary / advection / vortex / pressure / avalanche / jam / viscoelastic / freeze / melt / sublimate / corrode / creep / grammar / growth / static / erode / dissolve / abrade / pit

inscription: plain / glyph / ledger / rune / contour / palimpsest

source: text / grid / plane / ring / image / video / sphere / cylinder / cube

temporal: existing temporal profile library remains in use

Why source-aware auto weighting is the next multiplier

The fastest way to increase coverage without deleting anything is:



keep the handcrafted family layer intact

let operator recipes inherit source-specific weighting automatically

batch-expand recipes into multiple source anchors

auto-generate comparison hybrids from the grown recipe library



This gives broader coverage while preserving the stronger handcrafted axes for later refinement.

Implementation Layers

lib/operatorMatrix.ts

operator axis definitions

recipe specs

source-aware weighting

batch-grown recipe variants

lib/operatorGeneratedBundles.ts

convert recipes into atlas bundles

lib/operatorGeneratedStarters.ts

convert recipes into starter presets and starter sequences

lib/operatorGeneratedHybrids.ts

convert matrix logic into hybrid review recipes and temporal review variants

existing files receive additive imports only

expressionAtlasBundles.ts

starterLibrary.ts

hybridExpressions.ts

hybridTemporalVariants.ts

Current Phase

Phase O1: non-destructive operator layer bootstrap



add operator matrix and recipe library

expose generated atlas bundles

expose generated starter presets

expose generated hybrid review recipes

keep existing content untouched



Phase O1.5: erosion / dissolution / wear operator expansion



add erode / dissolve / abrade / pit operator dynamics

add recipe bundles for erosion_trail / seep_fracture / residue_skin / calcified_skin

add review hybrid for erosion / dissolution / wear comparison

keep all existing hand-crafted review bundles intact



Phase O2: source-aware operator weighting



add automatic weighting for text / grid / ring / plane / image / video / sphere / cylinder / cube

automatically rebalance count / size / radius / temporal strength by source

keep the original recipe definitions unchanged



Phase O3: recipe batch growth



expand every base operator recipe into two additional source anchors

grow atlas bundles / starter presets / hybrid review coverage automatically

keep manual recipes available in parallel

Current Operator Scale

base operator recipes: 32

auto-expanded operator recipes: 64

total operator recipes: 96

source-review hybrid recipes: 6 auto-generated + manual reviews

Next Phases

Phase O4



duplicate suppression and coverage scoring

source collision scoring for recipe growth



Phase O5



UI filter for operator recipes by axis

matrix browser for material / geometry / dynamics / inscription / source



Phase O6



promote weak high-value bands into dedicated handcrafted axes

use collision metrics to decide which bands deserve bespoke renderer parameters
