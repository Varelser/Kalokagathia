IMPLEMENTATION_PLAN_AND_PROGRESS_shaping12

Scope

専用 shaping 強化の第2段階として、crystal / debris / voxel / lattice 系を集中強化。

目的は mode 数の追加ではなく、既存 mode 間の見た目差を最終的に詰めること。

Implemented

1) sceneCrystalAggregateSystem.tsx

crystal family を profile ベースに再構成。

mode ごとに以下を分離。

geometry kind (tetra / octa / icosa)

anchor / per-anchor 密度

spread radius

vertical lift

ring flatten / orbit bias

bloom bias

gust bias

spin

directional jitter

axis scale

opacity / roughness / metalness

hue / lightness shift

専用差を強化した対象:

fracture_pollen

bloom_spores

pollen_storm

orbit_fracture

fracture_bloom

shard_debris

crystal_aggregate

2) sceneVoxelLatticeSystem.tsx

voxel family を profile ベースに再構成。

mode ごとに以下を分離。

snap multiplier

jitter

shell bias

planar bias

surge wave amplitude / frequency

axis scale

opacity / roughness / metalness

hue / lightness shift

wireframe override

専用差を強化した対象:

skin_lattice

frost_lattice

pollen_lattice

lattice_surge

voxel_lattice

3) depictionArchitecture.ts

未記載だった 2 mode を正式追加。

lattice_surge

fracture_bloom

control panel 側で、これらも spatial signature / contrast axis / shaping focus を正しく参照可能にした。

4) Hybrid / Atlas の拡張

追加:



hybridExpressions.ts

fracture-lattice

pollen-fracture

hybridTemporalVariants.ts

fracture-lattice-surge

pollen-fracture-shed

expressionAtlasBundles.ts

fracture-bloom-orbit

surge-lattice-grid

5) Starter preset 密度の補強

追加:



starter-fracture-bloom-orbit

starter-surge-lattice-grid

starter-pollen-fracture-codex

対応 sequence 3本も追加。

Verification

npm ci 実施

npm run typecheck 通過

npx vite build 通過

Build output

dist/assets/index-INjeG_Y7.js 840.94 kB

dist/assets/index-B8FfSG2b.css 52.78 kB

dist/assets/particleDataWorker-BcgpBlhb.js 112.55 kB

Coverage notes

Starter occurrence count (target modes):



fracture_pollen: 2

bloom_spores: 1

pollen_storm: 2

orbit_fracture: 3

fracture_bloom: 2

pollen_lattice: 2

lattice_surge: 4

frost_lattice: 6

Updated files

components/sceneCrystalAggregateSystem.tsx

components/sceneVoxelLatticeSystem.tsx

lib/depictionArchitecture.ts

lib/expressionAtlasBundles.ts

lib/hybridExpressions.ts

lib/hybridTemporalVariants.ts

lib/starterLibrary.ts

Next best step

sceneFiberFieldSystem.tsx を profile 化し、

mesh_weave

spectral_mesh

aurora_threads

prism_threads

glyph_weave の見た目差を強化する。

その次に atlas bundle を「未カバー source × mode 組み合わせ」へ広げる。
