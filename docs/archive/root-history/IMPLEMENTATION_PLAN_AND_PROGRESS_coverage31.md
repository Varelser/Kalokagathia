coverage31

実施

網羅優先で、未実装寄りだった生成原理と時間構造をさらに追加した。

追加した物理・構造 family

viscoelastic_membrane

percolation_sheet

talus_heap

corrosion_front

creep_lattice

追加した時間構造 family

percolate

slump

rebound

fissure

ossify

同期した範囲

types/scene.ts

types/configLayer2.ts

types/configLayer3.ts

components/sceneMotionMap.ts

components/motionCatalog.ts

lib/motionArchitecture.ts

lib/depictionArchitecture.ts

lib/proceduralModeRegistry.ts

lib/temporalProfiles.ts

components/controlPanelProceduralModeSettings.tsx

components/sceneMembraneSystem.tsx

components/sceneDepositionFieldSystem.tsx

components/sceneCrystalAggregateSystem.tsx

components/sceneReactionDiffusionSystem.tsx

components/sceneVoxelLatticeSystem.tsx

lib/expressionAtlasBundles.ts

lib/hybridExpressions.ts

lib/hybridTemporalVariants.ts

lib/starterLibrary.ts

検証

npm ci 通過

npm run typecheck 通過

npm run build 通過

build 出力

dist/assets/index-7NVexX2i.js 1045.83 kB

dist/assets/particleDataWorker-CAVsYtX2.js 151.05 kB

dist/assets/index-CiiugB3f.css 52.80 kB

現時点

前回の coverage30 に対して、



膜の粘弾性

受け皿の浸透経路

崩積斜面

腐食前線

クリープ格子



という別原理を追加できた。



時間構造も、



浸透

崩れ沈み

反発復元

亀裂化

硬化固定



を追加し、既存の accumulate / delaminate / anneal / bifurcate / recur とは別の軸を持たせた。
