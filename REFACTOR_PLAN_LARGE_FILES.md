対象と優先順位

優先

ファイル

現在の問題

目標

0

App.tsx

app orchestrator に snapshot / compare / diagnostics が残っていた

完了（snapshot / compare / overlay / layer preview を分離）

1

controlPanelGlobalDisplay*

main / hook は整理済み。camera/basic display の表示分割余地

presentational component 化（必要時のみ）

2

starter library chunk

chunk 化済みだが family 命名再整理余地

必要時のみ family 名単位で再整理

3

sourceAwareShapingSurfaceFamilies.ts

surface family shaping がまだ1ファイル集中

shell / fog / deposition 単位へ必要時のみ再分割

4

gpgpuShaderSimulation.ts

simulation shader が1ファイル集中

完了（velocity / position / sort / fluid へ再分割）

5

gpgpuShaders.ts

shader family が1ファイル集中

完了（simulation / points / trails / volumes / constants へ再分類）

6

controlPanelProceduralModeSettings.tsx

section 分離前は多数 UI / data が集中

完了（catalog / overview / specific controls へ分割）

実行原則

1回の変更で責務を1つだけ動かす

既存 API 名は、外部参照点では極力維持する

まず export 面を保ったまま内部移設 する

動作確認ポイントを各段階で固定する

Phase A: sceneGpgpuSystem.tsx 分割（第3段完了）

目標境界

components/gpgpu/gpgpuBackendInit.ts



renderer capability 判定

backend 選択

render target / texture / buffer 初期化



components/gpgpu/gpgpuStep.ts



frame stepping

deltaTime 正規化

pass 実行順



components/gpgpu/gpgpuReadback.ts



readback

timeout

pending / mapped 管理

CPU fallback の返却



components/gpgpu/gpgpuDiagnostics.ts



diagnostics payload

capability / route / adapter 情報の整形



components/gpgpu/gpgpuUniformRouting.ts



config -> uniform / pass parameter の変換

今回完了した内容

Step 1: shader / 定数を components/gpgpuShaders.ts へ移設

Step 2: 描画 material / geometry / sim quad 構築を components/useGpgpuAssets.ts へ移設

第1段結果: sceneGpgpuSystem.tsx は 1982行 → 654行

第2段結果: sceneGpgpuSystem.tsx は 654行 → 268行

追加分割: useGpgpuRuntime.ts / gpgpuSimulationPasses.ts / gpgpuVisualUpdates.ts

残りの分割手順

Step 3: readback 関連だけ切り出す → 完了

Step 4: backend 初期化を切り出す → 完了

Step 5: stepping を切り出す → 完了

Step 6: diagnostics と routing を切り出す → 完了

Step 7: render outputs を切り出す → 完了

残課題

sceneGpgpuSystem.tsx を 700行未満 へ縮小 → 達成済み（252行）

readback / init / stepping が別ファイル化 → 達成済み

diagnostics / routing の完全分離 → 達成済み

render outputs の別ファイル化 → 達成済み

simMeshRef 参照抜けの修正 → 達成済み

Phase B: starterLibrary.ts 分割（完了）

今回完了した内容

starterLibrary.ts を 5965行 → 77行 へ縮小

helper を starterLibraryCore.ts へ分離

base preset / extension preset / base sequence / extension sequence を別ファイルへ分離

starterLibrary.ts は互換層 + 集約 export に変更

現在の構成

lib/starterLibrary.ts

lib/starterLibraryCore.ts

lib/starterLibraryPresetBase.ts

lib/starterLibraryPresetBaseChunk01.ts ~ Chunk04.ts

lib/starterLibraryPresetExtensions.ts

lib/starterLibraryPresetExtensionChunk01.ts ~ Chunk05.ts

lib/starterLibrarySequenceBase.ts

lib/starterLibrarySequenceChunk01.ts ~ Chunk04.ts

lib/starterLibrarySequenceExtensions.ts

残課題

starterLibrary.ts を 300行未満 へ縮小 → 達成済み（77行）

既存 export 名を維持 → 達成済み

大量 preset 追加時の一点衝突を緩和 → 達成済み

追加で完了した内容

starterLibraryPresetBase.ts を 2092行 → 12行 へ縮小

starterLibraryPresetExtensions.ts を 2284行 → 14行 へ縮小

starterLibrarySequenceBase.ts を 1263行 → 12行 へ縮小

base preset 数 102 → 102 を維持

extension preset 数 137 → 137 を維持

sequence id 数 96 → 96 を維持

残課題

chunk 命名は数値ベースなので、必要なら family 名ベースへ再整理する

Phase C: controlPanelGlobalDisplay.tsx 分割（第3段完了）

実施結果

Product Pack UI を components/controlPanelGlobalDisplayProductPacks.tsx へ分割

Post FX / GPGPU / Screen FX を components/controlPanelGlobalDisplayEffects.tsx から PostFx / Gpgpu / ScreenFx へ再分割

components/controlPanelGlobalDisplay.tsx は main orchestrator + basic display + camera へ縮小

第2段で components/useGlobalDisplayProductPacks.tsx を追加

Product Pack の派生状態 / 差分判定 / custom pack 操作を hook 化

components/controlPanelGlobalDisplay.tsx は 512行 → 267行

UI ラベル数比較: Slider label= 27 → 27, Toggle label= 6 → 6（display main + product pack section）

前段分割で残っていた product pack section の参照不整合も修正

追加で完了した内容

components/controlPanelGlobalDisplayGpgpu.tsx を 536行 → 130行 へ縮小

components/controlPanelGlobalDisplayGpgpuAdvancedRender.tsx / components/controlPanelGlobalDisplayGpgpuTrails.tsx / components/controlPanelGlobalDisplayGpgpuForces.tsx を追加

分割前後で Slider label= 92 → 92、Toggle label= 31 → 31、Math.round( 5 → 5 を維持

残課題

camera/basic display を必要なら presentational component 化する

product pack section の型を any 依存から段階的に外す

Phase D: productPackLibrary.ts / operatorMatrix.ts（第2段完了）

productPackLibrary.ts 実施結果

productPackLibrary.ts を 1323行 → 69行 へ縮小

productPackLibraryTypes.ts を追加

family ごとの chunk を追加

TouchDesigner / Trapcode / Universe / Hybrid

Houdini / Niagara / Geometry Nodes / Unity VFX

bundle id 数を 25 → 25 で維持

operatorMatrix.ts 実施結果

operatorMatrix.ts を 986行 → 84行 へ縮小

operatorMatrixTypes.ts / operatorMatrixHelpers.ts / operatorMatrixRecipeLibraryRaw.ts を追加

さらに operatorMatrixHelpers.ts を

operatorMatrixPatchPresets.ts

operatorMatrixSourceAutoWeight.ts

operatorMatrixLayerPatch.ts

operatorMatrixAutoVariant.ts へ再分割

base recipe id 数を 32 → 32 で維持

buildOperatorLayerPatch の外部 API は維持

残課題

product pack 側は family chunk 化でかなり改善したので、第2段分割の優先度は下がった

次の中心対象は starter / source-aware shaping / camera-basic display の大型 chunk

Phase E: gpgpuShaders.ts 再分類（完了）

実施結果

gpgpuShaders.ts を 918行 → 28行 へ縮小

gpgpuShaderConstants.ts / gpgpuShaderSimulation.ts / gpgpuShaderPoints.ts / gpgpuShaderTrails.ts / gpgpuShaderVolumes.ts を追加

shader export 数 24 → 24 を維持

既存 import 面は gpgpuShaders.ts の aggregate export により維持

残課題

gpgpuShaderSimulation.ts の velocity / position / sort / fluid 再分割は 完了

現在は gpgpuShaderSimulation.ts が 5行、最大 chunk は gpgpuShaderSimulationVelocity.ts の 361行

進め方

次は必要なら camera-basic display / starter family 命名 / sourceAwareShapingSurfaceFamilies.ts の再分類へ進む

各 phase ごとに 1 zip を切る

各 zip に CURRENT_STATUS.md を更新して残す

Phase F: sourceAwareShaping.ts 再分類（完了）

実施結果

sourceAwareShaping.ts を 1143行 → 21行 へ縮小

sourceAwareShapingLineFiber.ts / sourceAwareShapingSurfaceFamilies.ts / sourceAwareShapingGlyphPatch.ts / sourceAwareShapingTypes.ts / sourceAwareShapingUtils.ts を追加

既存 import 面は sourceAwareShaping.ts の aggregate export により維持

今回触った 6 ファイルは局所 tsc で確認済み

残課題

sourceAwareShapingSurfaceFamilies.ts は 462行 あるため、必要なら shell / fog / deposition に再分割できる

Phase G: sceneBrushSurfaceSystem.tsx update / render family 分割（完了）

実施結果

sceneBrushSurfaceSystem.tsx を 784行 → 448行 へ縮小

sceneBrushSurfaceSystemShared.ts / sceneBrushSurfaceSystemRuntime.ts / sceneBrushSurfaceSystemRender.tsx を追加

brush profile / shader / settings / deps と、frame 更新ロジック、JSX 描画を分離

追加した 4 ファイルは transpileModule ベースで構文確認済み

残課題

sceneReactionDiffusionSystem.tsx が次の大型システム候補

expressionAtlasBundles.ts は bundle family ごとの data chunk 化余地あり

Phase H: sceneReactionDiffusionSystem.tsx simulation / uniforms / render 分割（完了）

実施結果

sceneReactionDiffusionSystem.tsx を 782行 → 9行 へ縮小

sceneReactionDiffusionProfiles.ts / sceneReactionDiffusionSeedTexture.ts / sceneReactionDiffusionShaders.ts / sceneReactionDiffusionSystemRuntime.ts / sceneReactionDiffusionSystemRender.tsx / sceneReactionDiffusionSystemShared.ts を追加

profile / params / seed texture / shader / frame 更新ロジック / JSX 描画を分離

追加した 7 ファイルは transpileModule ベースで構文確認済み

残課題

expressionAtlasBundles.ts は bundle family ごとの data chunk 化余地あり

controlPanelGlobalDisplay.tsx の camera/basic display 側の presentational 分離は必要時に継続可能

Phase I: expressionAtlasBundles.ts bundle family 分割（完了）

実施結果

expressionAtlasBundles.ts を 766行 → 45行 へ縮小

expressionAtlasTypes.ts / expressionAtlasCore.ts / expressionAtlasBundlesBase.ts / expressionAtlasBundlesReview.ts / expressionAtlasBundlesAnchorsMaterial.ts / expressionAtlasBundlesAnchorsElastic.ts / expressionAtlasBundlesAnchorsGranular.ts / expressionAtlasBundlesAnchorsFlow.ts / expressionAtlasBundlesAnchorsPhase.ts を追加

ExpressionAtlasBundle id 数 83 → 83、buildExpressionAtlasPatch( 1 → 1、getExpressionAtlasBundleById( 2 → 2 を維持

追加した expression atlas 系 9 ファイルは transpileModule ベースで構文確認済み

残課題

controlPanelGlobalDisplay.tsx の camera/basic display 側の presentational 分離は必要時に継続可能

motionArchitecture.ts は family / helper 単位の再分類余地あり

Phase J: motionArchitecture.ts family / override 分割（完了）

実施結果

motionArchitecture.ts を 704行 → 26行 へ縮小

motionArchitectureTypes.ts / motionArchitectureDefaults.ts / motionArchitectureOverridesSystems.ts / motionArchitectureOverridesExpressionsA.ts / motionArchitectureOverridesExpressionsB.ts を追加

分割前後で depictionHint: 86 → 86、editingFocus: 86 → 86、override key 数 78 → 78 を維持

rune_smoke の recommendedSources 二重記述を整理

追加した motion architecture 系 6 ファイルは transpileModule ベースで構文確認済み

残課題

controlPanelGlobalDisplay.tsx の camera/basic display 側の presentational 分離は必要時に継続可能

sceneSurfaceShellSystem.tsx / sceneVolumeFogSystem.tsx など中規模 scene family の分離余地あり

Phase K: sceneSurfaceShellSystem.tsx shared / runtime / render 分割（完了）

実施結果

sceneSurfaceShellSystem.tsx を 622行 → 55行 へ縮小

sceneSurfaceShellSystemShared.ts / sceneSurfaceShellSystemRuntime.ts / sceneSurfaceShellSystemRender.tsx を追加

profile / shader / hull layout helper / frame 更新ロジック / JSX 描画を分離

分割前後で buildHullLayout( 2 → 2、useFrame(({ clock }) => { 1 → 1、shellMaterial.uniforms.uColor.value.set 1 → 1 を維持

追加した surface shell 系 4 ファイルは transpileModule ベースで構文確認済み

残課題

sceneVolumeFogSystem.tsx の shared / runtime / render 分離

controlPanelGlobalDisplay.tsx の camera/basic display 側の presentational 分離は必要時に継続可能

Phase L: sceneVolumeFogSystem.tsx shared / runtime / render 分割（完了）

実施結果

sceneVolumeFogSystem.tsx を 607行 → 9行 へ縮小

sceneVolumeFogSystemShared.ts / sceneVolumeFogSystemRuntime.ts / sceneVolumeFogSystemRender.tsx を追加

fog profile / shader / slice transform helper / frame 更新ロジック / JSX 描画を分離

分割前後で useFrame(({ clock }) => { 1 → 1、getFogSliceTransform( 3 → 3、uMaterialStyle 10 → 10 を維持

追加した volume fog 系 4 ファイルは transpileModule ベースで構文確認済み

残課題

sceneVolumeFogSystemShared.ts の shader/profile 再分割（完了）

controlPanelGlobalDisplay.tsx の camera/basic display 側の presentational 分離は必要時に継続可能

Phase M: sceneVolumeFogSystemShared.ts 第2段分割（完了）

実施内容:



sceneVolumeFogSystemShared.ts を 545行 → 14行 へ縮小

sceneVolumeFogSystemProfiles.ts / sceneVolumeFogSystemShaders.ts / sceneVolumeFogSystemTransforms.ts / sceneVolumeFogSystemMaterial.ts / sceneVolumeFogSystemTypes.ts を追加

sceneVolumeFogSystemRuntime.ts / sceneVolumeFogSystemRender.tsx / sceneVolumeFogSystem.tsx の import を専用ファイルへ更新



確認:



volume fog 系 9 ファイルは transpileModule ベースで構文確認済み

局所 tsc では外部依存未導入に伴う react / three / @react-three/fiber 解決エラーのみを確認

Phase N: controlPanelProjectIO.tsx の manifest / compare / shared 分割（完了）

実施内容:



controlPanelProjectIO.tsx を 551行 → 146行 へ縮小

controlPanelProjectIOShared.tsx / controlPanelProjectIOManifestSection.tsx / controlPanelProjectIOCompareSection.tsx を追加

active hybrid expressions を main に残し、manifest / compare / snapshot bank を専用セクションへ分離



確認:



project I/O 系 4 ファイルは transpileModule ベースで構文確認済み

分割前後で getSnapshotDiff( 1 → 1、SnapshotCard 1 → 1、LayerToggleRow 1 → 1 を維持



次候補:



components/controlPanelPartsSources.tsx (split complete)

lib/hybridTemporalVariants.ts

lib/projectState.ts

Phase O: lib/hybridTemporalVariants.ts の family 分割（完了）

実施内容:



lib/hybridTemporalVariants.ts を 702行 → 31行 へ縮小

lib/hybridTemporalVariantTypes.ts / lib/hybridTemporalVariantBase.ts / lib/hybridTemporalVariantReview.ts / lib/hybridTemporalVariantCycles.ts を追加

main を aggregate + resolver に寄せ、base / review / cycle variant を専用ファイルへ分離



確認:



hybrid temporal 系 5 ファイルは transpileModule ベースで構文確認済み

ローカル HybridTemporalVariant id 数 91 → 91、unique 数 91 → 91 を維持



次候補:



lib/projectState.ts



components/controlPanelProjectIOShared.tsx の第2段分割



lib/productPackDetailControls.ts



Completed: lib/projectState.ts split into shared / manifest / storage families; aggregate projectState.ts retained for compatibility.

Phase P: components/proceduralModeSettingsCatalog.ts の catalog / labels / quick preset 分割（完了）

実施内容:



proceduralModeSettingsCatalog.ts を 780行 → 4行 へ縮小

proceduralModeSettingsTypes.ts / proceduralModeSettingsLabels.ts / proceduralModeSettingsModes.ts / proceduralModeSettingsQuickPresets.ts を追加

main を aggregate export に寄せ、型 / labels+guides / procedural mode set / quick preset patch 群を専用ファイルへ分離



確認:



procedural catalog 系 5 ファイルは transpileModule ベースで構文確認済み

分割前後で summary: 29 → 29、bestSources: 29 → 29、recommendedRanges: 29 → 29、proceduralLayerPatch( 34 → 34 を維持



次候補:



lib/productPackDetailControls.ts



components/controlPanelProjectIOShared.tsx の第2段分割



components/controlPanelGlobalDisplay.tsx の camera/basic display 側の presentational 分離



Completed: components/controlPanelProjectIOShared.tsx stage-2 split into manifest shared / compare shared / snapshot diff / snapshot card; aggregate API preserved.



完了: lib/hybridExpressions.ts を base / review / physical family に分割。

Phase App: App.tsx 再分離（完了）

実施結果

App.tsx を 580行 → 430行 へ縮小

components/AppComparePreview.tsx を追加し、compare preview scene を分離

components/AppExecutionDiagnosticsOverlay.tsx を追加し、execution diagnostics overlay を分離

lib/useAppSnapshots.ts を追加し、snapshot / compare state と handlers を分離

lib/useAppLayerPreview.ts を追加し、layer focus / mute に基づく display config と toggle handler を分離

確認

compare preview の AppScene 描画導線を維持

execution diagnostics overlay の entries 表示導線を維持

snapshot capture / load / morph / clear / rename / note の handler 導線を維持

完了: components/sceneGrowthFieldSystem.tsx を shared / runtime / render に分割し、main を 549行 → 41行 へ縮小。growth field の layout helper / frame update / render JSX の責務分離を完了。

Phase AppScene: components/AppScene.tsx の camera / temporal / layer / post-fx 分割（完了）

実施結果

AppScene.tsx を 529行 → 110行 へ縮小

AppSceneTypes.ts / useAppSceneTemporalConfig.ts / AppSceneCameraRig.tsx / AppSceneLayerContent.tsx / AppScenePostFx.tsx を追加

main を app-scene orchestrator に寄せ、camera / temporal / layer content / post-fx を専用ファイルへ分離

確認

分割前後で useFrame(({ clock }) => { 1 → 1、<ParticleSystem config= 8 → 8、<ScreenOverlay 1 → 1、<EffectComposer> 1 → 1 を維持

AppScene 系 6 ファイルは transpileModule ベースで構文確認済み

この ZIP 基準の 500行超ファイル数 は 13 → 12

Phase SurfacePatch: components/sceneSurfacePatchSystem.tsx の shared / runtime / render 分割（完了）

実施結果

sceneSurfacePatchSystem.tsx を 527行 → 58行 へ縮小

sceneSurfacePatchSystemShared.ts / sceneSurfacePatchSystemRuntime.ts / sceneSurfacePatchSystemRender.tsx を追加

main を surface patch orchestrator に寄せ、layout / shader / frame update / render を専用ファイルへ分離

確認

分割前後で buildPatchLayout( 2 → 2、useFrame(({ clock }) => { 1 → 1、<shaderMaterial 1 → 1、geometry.computeBoundingSphere() 1 → 1、uMaterialStyle 10 → 10 を維持

この ZIP 基準の 500行超ファイル数 は 12 → 11

sceneLineSystem.tsx: shared / runtime / render 分割を追加。

Phase GpgpuAssets: components/useGpgpuAssets.ts の asset family 分割（完了）

実施結果

useGpgpuAssets.ts を 514行 → 21行 へ縮小

gpgpuAssetShared.ts / useGpgpuSimulationAssets.ts / useGpgpuDrawAssets.ts / useGpgpuTrailAssets.ts / useGpgpuMeshAssets.ts を追加

main を aggregate hook に寄せ、sim / draw / trail / mesh asset を専用 hook へ分離

確認

分割前後で new THREE.ShaderMaterial( 13 → 13、new THREE.BufferGeometry() 4 → 4、new THREE.InstancedBufferGeometry() 2 → 2、new THREE.Mesh( 3 → 3 を維持

GPGPU asset 系 6 ファイルは transpileModule ベースで構文確認済み

この ZIP 基準の 500行超ファイル数 は 11 → 10

次候補

components/scenePhysicsMotionChunk.ts

依存導入後の full typecheck と実エラー潰し

lib/appStateConfig.ts / lib/depictionCoverage.ts の最終整理

Phase PhysicsMotion: components/scenePhysicsMotionChunk.ts の family 分割（完了）

実施結果

scenePhysicsMotionChunk.ts を 511行 → 10行 へ縮小

scenePhysicsMotionPrelude.ts / scenePhysicsMotionBranchA.ts / scenePhysicsMotionBranchB.ts / scenePhysicsMotionBranchC.ts / scenePhysicsMotionTail.ts を追加

main を aggregate export に寄せ、applyMotion GLSL を prelude / branch family / tail へ分離

確認

分割前後で motionType < 分岐数 112 → 112 を維持

physics motion 系 6 ファイルは transpileModule ベースで構文確認済み

この ZIP 基準の 500行超ファイル数 は 10 → 8

次候補

依存導入後の full typecheck と実エラー潰し

lib/appStateConfig.ts / lib/depictionCoverage.ts の最終整理

components/sceneParticleSystem.tsx の第2段分割

Phase Q — sceneParticleSystem.tsx 第2段分割（完了）

components/sceneParticleSystem.tsx を worker / shared / uniforms / render へ分割

components/sceneParticleSystem.tsx は 849行 → 439行

この ZIP 基準の 500行超ファイル数 は 8 → 7

次優先候補:

依存導入後の full typecheck と実エラー潰し

lib/appStateConfig.ts / lib/depictionCoverage.ts の最終整理

starter chunk 群の命名・分類整理

Phase R: build chunk 再配分 + starter sequence extension 再分割（完了）

実施結果

vite.config.ts の manualChunks を拡張し、source family 単位の chunk を追加

starter-library-data

depiction-catalog

scene-gpgpu

scene-surface-families

scene-core-families

lib/starterLibrarySequenceExtensions.ts を 148行 / 51.2KB → 12行 / 0.7KB へ縮小

lib/starterLibrarySequenceExtensionChunk01.ts ~ Chunk04.ts を追加

sequence extension item 数 134 → 134 を維持

build entry chunk は 1415.65 kB → 430.96 kB

Vite chunk warning は あり → なし

残課題

lib/appStateConfig.ts の family 分割

lib/depictionCoverage.ts の target / resolver / summary 分割

starter preset data chunk の再分割

Phase Membrane: components/sceneMembraneSystem.tsx の shared / runtime / render 分割（完了）

実施結果

sceneMembraneSystem.tsx を 481行 → 48行 へ縮小

sceneMembraneSystemShared.ts / sceneMembraneSystemRuntime.ts / sceneMembraneSystemRender.tsx を追加

main を membrane orchestrator に寄せ、profile / layout / shader / uniform helper、frame 更新、render JSX を専用ファイルへ分離

確認

分割前後で buildMembraneLayout( 2 → 2、estimateLayerPositionApprox( 1 → 1、MEMBRANE_FRAGMENT_SHADER 1 → 1、uVeil uniform 2 → 2 を維持

membrane 系 4 ファイルは transpileModule ベースで構文確認済み

次候補

components/sceneFiberFieldSystem.tsx

components/sceneMotionEstimator.ts

lib/projectStateManifest.ts

Phase SourceAwareSurfaceFamilies: lib/sourceAwareShapingSurfaceFamilies.ts の shell / fog / deposition 再分割（完了）

実施結果

sourceAwareShapingSurfaceFamilies.ts を 462行 → 3行 へ縮小

sourceAwareShapingShellProfile.ts / sourceAwareShapingFogProfile.ts / sourceAwareShapingDepositionProfile.ts を追加

aggregate export を維持したまま、surface family shaping を shell / fog / deposition 単位へ分離

確認

分割前後で export 関数数 6 → 6 を維持

source-aware surface family 系 4 ファイルは transpileModule ベースで構文確認済み

次候補

lib/projectStateManifest.ts

components/sceneFiberFieldSystem.tsx

lib/starterLibraryPresetBaseChunk02.ts 以降の data chunk 再分割

2026-03-31 additional split pass

lib/projectStateManifest.ts を projectStateManifestBuild.ts / projectStateManifestNormalize.ts に分割し、入口を re-export のみに縮小。

components/sceneFiberFieldSystem.tsx を sceneFiberFieldSystemShared.ts / sceneFiberFieldSystemRuntime.ts / sceneFiberFieldSystemRender.tsx に分割。

目的は build/normalize と runtime/render の責務分離、差分判定容易化、将来拡張時の衝突縮小。

2026-03-31 shared layer tab consolidation

components/controlPanelTabLayer2.tsx / components/controlPanelTabLayer3.tsx を薄い wrapper に縮小し、共通本体を components/controlPanelLayerTabShared.tsx へ集約。

Layer 2 / 3 の UI ロジックを単一実装にしたことで、将来のパラメータ追加・削除・表示順変更を 1 箇所で済む構造へ変更。

目的は duplicate UI drift の防止、エラー切り分け容易化、upgrade 時の二重修正回避。

2026-03-31 particle runtime split

components/sceneParticleSystem.tsx を orchestration 主体へ縮小。

ghost material 生成を components/sceneParticleSystemGhostMats.ts へ、useFrame 内の runtime 更新を components/sceneParticleSystemRuntime.ts へ分離。

目的は render entry / material prep / frame runtime の責務分離と、shader / collision / audio reactive 更新の局所化。

2026-03-31 motion estimator + motion panel split

components/sceneMotionEstimator.ts を orchestration 主体へ縮小し、共有 scratch / noise helper を sceneMotionEstimatorShared.ts、固有 motion 分岐を sceneMotionEstimatorSpecific.ts へ分離。



components/controlPanelPartsMotion.tsx を controlPanelMotionCatalog.tsx / controlPanelMotionSelector.tsx / PerSourceMotionConfig の構成へ分割。



目的は motion 推定ロジックの局所化、UI データ辞書と描画の責務分離、検索・ラベル・manifest 表示拡張時の差分縮小。



2026-03-31 追加分割: scripts/projectPhase5Fixtures.ts を projectPhase5FixturesShared.ts / projectPhase5FixturePayloads.ts / projectPhase5FixtureIO.ts に分離。fixture payload 定義、shared helper、manifest/fingerprint I/O を責務分離。



2026-03-31 追加分割: lib/starterLibraryPresetBaseChunk01.ts を starterLibraryPresetBaseChunk01Foundational.ts / starterLibraryPresetBaseChunk01Structural.ts / starterLibraryPresetBaseChunk01Cinematic.ts に分離。base preset を foundational / structural / cinematic 群へ整理。



2026-03-31 追加分割:



lib/renderModeRegistry.ts を renderModeRegistryShared.ts / renderModeRegistryLayerModes.ts / renderModeRegistryGpgpuModes.ts / renderModeRegistryPostFxModes.ts に分割。描画モード定義と summary 集計を分離。

lib/starterLibraryPresetBaseChunk03.ts を hybrid / field / event studies に分割。

lib/starterLibraryPresetBaseChunk04.ts を core / weather / ritual relics に分割。

lib/starterLibraryPresetExtensionChunk02.ts を surface / source contrast / text-video / codex studies に分割。

components/sceneShaderParticlePoint.ts を vertex / fragment へ分割し、shader entry を re-export 化。



2026-03-31 追加分割:



lib/starterLibraryPresetBaseChunk02.ts を starterLibraryPresetBaseChunk02Procedural.ts / starterLibraryPresetBaseChunk02Motion.ts / starterLibraryPresetBaseChunk02Hybrid.ts に分割。procedural / motion / hybrid preset 群の責務を分離。

lib/starterLibraryPresetExtensionChunk03.ts を expression / source-contrast / review-split 群へ分割。

lib/starterLibraryPresetExtensionChunk05.ts を phase-change / GPGPU / reference / phase42 / post-FX 群へ分割。

scripts/verify-phase5-entry.ts を verifyPhase5Shared.ts / verifyPhase5FixtureScenarios.ts / verifyPhase5ImportScenarios.ts に分割。shared helper、fixture hardening、import hardening の責務を分離。

lib/sceneRenderRoutingRuntime.ts を accessor / snapshot / predicate の3責務へ分割。描画可否判定、runtime snapshot 構築、値 accessor の差分局所化を狙う。



2026-03-31 追加分割: lib/hybridTemporalVariantBase.ts→Core / Expansion / Specialist / SourceAnchors, lib/expressionAtlasBundlesBase.ts→Core / Extended / Anchors, lib/temporalProfiles.ts→Shared / Layer。



2026-03-31 追加分割



components/controlPanelLayerTabShared.tsx を controlPanelLayerTabSharedTypes.ts / controlPanelLayerTabSourceSections.tsx / controlPanelLayerTabParticleSections.tsx へ分割。source/media/layout と particle/legacy/procedural 構成を分離。

lib/starterLibraryPresetExtensionChunk01.ts を starterLibraryPresetExtensionChunk01Atmospheric.ts / starterLibraryPresetExtensionChunk01Atlas.ts / starterLibraryPresetExtensionChunk01OutlineBiologic.ts へ分割。雰囲気系・atlas 系・outline/biologic 系 preset 群を整理。

2026-03-31 追加分割メモ 7

components/sceneReactionDiffusionProfiles.ts を Shared / Modes / Source / Cross に分割し、profile定義・source補正・cross-family補正を分離。



components/sceneParticleSystemRuntime.ts を Types / Audio / Layer / Fx に分割し、audio uniform更新・layer runtime state構築・collision/SDF/ghost処理を局所化。



この時点でコード系大型ファイル数は 400行超: 7 → 5、300行超: 38 → 36。



2026-03-31 追加: sceneFiberFieldSystemShared.ts を types / profiles / geometry / shaders へ分離し、fiber profile 定義・geometry 更新・shader 定義の責務を切り分けた。



2026-03-31 追加: sceneShaderParticleLine.ts を classic / brush shader 定義へ分離し、line shader 修正時の影響範囲を局所化した。



2026-03-31 追加: App.tsx の描画レイアウトを components/AppRootLayout.tsx へ抽出し、App 本体を状態・hook orchestration に寄せた。



2026-03-31 追加: hybridExpressionBase.ts を core / extended / source anchors に分離し、比較基準レシピと一般 hybrid recipe を別々に拡張できるようにした。



2026-03-31 追加分割: components/sceneCrystalAggregateSystem.tsx を sceneCrystalAggregateSystemShared.ts / sceneCrystalAggregateSystemRuntime.ts / main orchestrator へ分割。App.tsx は components/AppBodyScene.tsx と components/AppModeGate.tsx を追加して、描画レイアウトとモードゲートを抽出。目的は 400 行超ファイルの解消と入口責務の明確化。



2026-03-31 追加分割: lib/useAppUiState.ts と lib/useAppControlPanelBridge.ts を追加し、App.tsx の UI state 群と control panel bridge 呼び出しを外出しして 399行 へ縮小。これによりコード系 400行超ファイルは 0 本 になった。



projectTransferShared.ts を shared types / prepare / report に分割し、import preparation と change report を責務分離。



proceduralModeSettingsQuickPresets.ts を base / physical / flow に分割し、preset 定義群の追加位置を明確化。
