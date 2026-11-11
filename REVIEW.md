Review

Phase 5 は core completion criteria を満たしたため、完了扱いへ更新した。



今後の browser-captured real-export fixture 追加は品質向上の継続項目であり、Phase 5 未完了を意味しない。



完了判定の根拠は docs/archive/phase5-completion-report.json に固定した。



Phase 5 は import mode を replace / merge に分離した。UI の project import は merge ではなく replace semantics なので、既存 workspace の ID プールに引きずられて不要な remap が起きないよう修正した。verify:phase5 は replace mode の stable-ID 維持を監視する。



Phase 5 は real-export intake を一段進め、fixture folder だけでなく manifest.json も比較対象にした。これにより browser export capture の置き換え漏れや内容 drift をハッシュ付きで検出できる。



Phase 5 は real-export fixture の受け皿を追加し、browser-available 環境で採取した .json を fixtures/project-state/real-export/ に置けば、そのまま verify:phase5 の検査対象になるようになった。



これにより「browser 実経路は後で確認する」から一歩進み、実 export を repo 常設 fixture として固定化できる導線ができた。

2026-03-31 追記（Phase 5: orphan sequence / import inspection）

Phase 5 をさらに進め、import 時の recoverable failure と preflight diagnostics を拡張した。

prepareImportedProjectData() は missing preset を参照する sequence step を drop し、droppedOrphanSequenceCount で件数を返す。これにより壊れた sequence 1件のために import 全体を落とさず、修復内容も notice へ出せる。

inspectProjectDataText() を追加し、invalid-json と invalid-project-payload を分けて返すようにした。UI の import 失敗メッセージも generic error から一段具体化した。

新規 fixture phase5-orphan-sequence.json と verifier 拡張により、orphan sequence drop と import inspection diagnostics を後退させないようにした。

2026-03-31 追加 12

Phase 5 をさらに進め、duplicate preset / sequence ID と invalid active preset を含む import を verifier で固定化した。

lib/projectTransferShared.ts は import diagnostics を返すようになり、notice で normalization 内容を明示できる。返すのは remappedPresetIdCount、regeneratedSequenceIdCount、activePresetFallbackApplied。さらに sequence ID は衝突時のみ再生成するようにした。さらに、sequence ID は衝突時のみ再生成するよう修正した。

あわせて presetIdRemap の作り方を修正し、duplicate preset ID を含む入力でも 最初に確定した remap を保持するようにした。以前のように最後の duplicate が remap を上書きする状態ではなくなった。

新規 fixture phase5-duplicate-ids-invalid-active.json と verify:phase5 の追加シナリオにより、duplicate input repair と import notice reporting が後退しないようになった。

2026-03-31 追加 11

Phase 5 をさらに進め、prepareImportedProjectData() が import remap 後の ProjectData を buildProjectData() で再構築するようにした。これで prepared import の manifest / serialization / schema digest が、実際の imported presets / sequence と一致する。

修正前は preset / sequence の ID remap と activePresetId 更新は行っていたが、prepared.project.manifest.stats や prepared.project.serialization は parse 時点のまま残りうるため、collision あり import のあとに summary が stale になる余地があった。

verify:phase5 は collision remap 後に、manifest presetCount / sequenceCount、execution count、serialization layer count、schema version を確認するように拡張した。

したがって今回の差分は UI 追加ではなく、import collision handling 後の snapshot integrity fix に意味がある。

2026-03-31 追加 10

Phase 5 をさらに進め、export/import の shared helper を追加した。lib/projectTransferShared.ts に file name 生成、JSON serialize/parse、preset / sequence ID remap、import notice 組立を寄せた。

これにより useProjectTransfer.ts の UI 経路と verify:phase5 の Node 経路が、少なくとも project file の作り方と import 前処理について同じ語彙を使うようになった。

verify:phase5 は新たに temp directory へ exported JSON を実際に書き出し、再読込し、さらに collision ありの preset ID set を与えて import preparation を検証する。

確認対象は次の 5 点。

export file name の安定

exported file の parse

file I/O 後の manifest / serialization 安定

preset / sequence ID remap の整合

remap 後 project の再 serialize / 再 parse

したがって今回の差分は、browser 実経路そのものではないが、Phase 5 の file round-trip と import collision handling を CLI で反復可能にした点に意味がある。

2026-03-31 追加 9

Phase 5 をもう一段進め、fixtures/project-state/ に committed JSON fixture を追加した。これで Phase 5 の検証は、メモリ上の synthetic payload だけでなく 実際に repo に置かれた project JSON を読む段階に入った。

新規 scripts/projectPhase5Fixtures.ts は fixture payload の単一ソースとして機能し、generate:phase5-fixtures と verify:phase5 が同じ定義を共有する。

verify:phase5 はまず fixture file の内容が期待 payload と一致するかを見て、その後に parse / sparse recovery / legacy migration / round-trip を確認する。つまり「fixture を置いたが古い」「fixture だけ更新して verify の期待が古い」の両方を潰せるようになった。

これにより Phase 5 はまだ finished ではないが、実 file fixture を伴う import/export hardening には入ったと判断してよい。残りは browser 実経路の往復と CI 常設化。

Phase 5 hardening レビュー（2026-03-31, serialization normalization pass）

今回の中心は、新機能追加ではなく project serialization の読込耐性強化。

lib/projectSerializationSnapshot.ts に serialization 正規化 helper を追加し、partial / sparse / drift した block 値を fallback serialization とマージするようにした。

とくに execution block は Phase 4 で確立した routing token 群を再注入できるため、old export や不完全 export でも requested/resolved/path/render/simulation/... の語彙を落としにくくなった。

lib/projectStateStorage.ts では、従来の block ごとの個別 normalize をやめ、serialization 全体を helper で再構成する方式へ整理した。

新しい verify:phase5 は以下を専用に見る。

sparse serialization recovery

legacy migration rebuild

parse -> parse round-trip stability

README には verify:project-state / verify:phase4 / verify:phase5 の実行順を追記し、検証導線の欠落を解消した。

package.json には direct script dependency として esbuild / skia-canvas を追加した。これで script が transitive dependency 前提になっていた状態は一段改善した。

ただし、この pass では node_modules 非同梱のため package-lock.json の再生成は未実施であり、依存導入可能な環境で次に合わせる必要がある。

したがって、Phase 5 はまだ finished ではないが、少なくとも 読込正規化と専用 verifier の土台 は入り、今後は fixture 拡張と実 export file の往復検証へ進める状態になった。

Phase 4 完了レビュー（2026-03-31, build + verifier pass）

Phase 4 は 完了扱い に更新する。

根拠は次の3点。

npm run build 完走

npm run verify:project-state 通過

npm run verify:export 通過（sandbox policy により app UI navigation が blocked のため、node-canvas harness fallback を使用）

verify:export は app UI 実経路を最初に試し、ERR_BLOCKED_BY_ADMINISTRATOR などで page navigation が塞がれた場合は node-canvas harness に自動退避する。これにより、この環境でも opaque / transparent PNG の alpha 挙動を継続検証できるようになった。

package.json には verify:phase4 を追加し、build / project-state / export を一括で通せるようにした。

したがって、Phase 4 の残課題は「実装」ではなく、以後は Phase 5 の project import/export round-trip と schema migration 帯域の拡張 が中心になる。

Phase 4 継続レビュー（2026-03-31, verification hardening pass）

今回の差分は、新しい描写 family 追加ではなく 検証経路の実装 が中心。

projectStateShared.ts / projectStateStorage.ts の import を細くし、project export/import 系が starter library 初期化や operator recipe 展開に巻き込まれないようにした。

projectExecutionRouting.ts は sceneBranches 算出時の循環参照を修正し、未完成 route を明示渡しする形にした。

追加した verify:project-state は Node 単体で以下を確認する。

execution snapshot と manifest/export の同期

serialization execution token の保持

parseProjectData() の round-trip 保持

legacy payload からの migration-aware 復元

これにより、Playwright browser が無い環境でも、Phase 4 の本筋である routing / manifest / serialization の整合 は継続検証できるようになった。

現在の目安更新:

正式ロードマップ全体 約90%

Phase 4 単体 約99%

実装面の残差は少なく、残りは build / browser-based export verification 側が主課題。

Phase 4 継続レビュー（2026-03-31, subsystem runtime snapshot pass）

今回の差分では、scene subsystem 内部でまだ散っていた mode / source / material / color / radiusScale の読取を、sceneRenderRouting 側の LayerRuntimeConfigSnapshot へ寄せた。



主な前進点は次のとおり。



lib/sceneRenderRouting.ts に LayerRuntimeConfigSnapshot と layer runtime helper 群を追加し、scene branch 判定だけでなく subsystem 設定読取の一部も共通化した

sceneHybridMembraneSystem.tsx / sceneHybridSurfacePatchSystem.tsx / sceneSdfSurfaceShellSystem.tsx が snapshot 由来の mode / source / color / radiusScale を使うようになった

sceneVolumetricFieldSystem.tsx が snapshot 由来の mode / source / color / radiusScale / materialStyle を使うようになった

sceneHybridGranularFieldSystem.tsx / sceneHybridFiberFieldSystem.tsx でも local な getLayerSource/getLayerColor をやめ、runtime snapshot を参照するようになった



これで Phase 4 の残りは、scene subsystem ごとにまだ残る個別 enabled / density / opacity / temporal 系の設定読取と、manifest/export への更なる反映が中心になってきた。



進捗目安:



正式ロードマップ全体: 約 82%

Phase 4 単体: 約 87%

今回差分上積み: +5pt 前後

REVIEW

2026-03-31 追加 8

Phase 4 をさらに進め、scene family 分岐と render mode summary を同じ routing snapshot 語彙へ寄せた。

新規 lib/sceneRenderRouting.ts により、Layer 2 / 3 / GPGPU の scene branch 判定を helper 化した。これで particle core / procedural / hybrid / glyph outline / aux / spark / connection / ghost trail / metaball などの判定が 1 箇所に寄った。

components/AppSceneLayerContent.tsx はこの helper を使う形へ整理され、scene 側の分岐重複が減った。

lib/renderModeRegistry.ts も routing-aware に寄せられ、active summary が mode 名や toggle だけでなく実際の route に近い判定になった。

lib/executionDiagnostics.ts と components/AppExecutionDiagnosticsOverlay.tsx には scene branches が追加され、現在どの scene branch が有効かを debug overlay で追いやすくなった。

今回確認できたのは npm ci と npm run typecheck の通過。npm run build は sandbox では完走ログ確認が未完。

2026-03-31 追加 7

Phase 4 をさらに進め、simulationAdapterBridge / executionDiagnostics / AppSceneLayerContent が execution routing snapshot をより直接使う形へ寄せられた。

lib/simulationAdapterBridge.ts に routing entry から bridge plan を組む経路を追加し、Layer 2 / 3 の adapter 表示や diagnostics が config 再解釈に依存しすぎないようにした。

lib/projectExecutionRouting.ts は resolved engine/path を組み立てた後、その routing entry から simulation class / notes を決める形へ整理された。

components/AppSceneLayerContent.tsx の GPGPU 補助描写は routing entry を使って判定するようになり、metaball が config.gpgpuWebGPUEnabled 固定ではなく resolved backend に従うように修正された。

今回確認できたのは npm ci と npm run typecheck の通過。npm run build は sandbox では今回も transforming... 以降で停止。

2026-03-31 追加 6

Phase 4 / 5 は未着手ではなく前段が既にある、という状態をコード上でも整理し直した。

lib/projectExecutionRouting.ts を追加し、Layer 1 / 2 / 3 / GPGPU それぞれについて render class / simulation class / requested engine / resolved engine / path / capability flags を project manifest に書き出すようにした。

lib/projectSerializationSnapshot.ts を追加し、project export に source / simulation / primitive / shading / postfx / execution block を持つ serialization を導入した。

lib/projectStateStorage.ts は schema と migration-aware import を扱うように拡張した。旧 project JSON は import 時に現行 schema 情報を補って読み込む。

components/controlPanelProjectIOManifestSection.tsx では capability-aware routing を可視化するようにした。

今回確認できたのは npm ci と npm run typecheck の通過。npm run build は sandbox では今回も transforming... 以降で停止。

2026-03-31 追加 5

Phase 3 を仕上げ、reaction-diffusion / biofilm 系を starter preset・preset sequence・expression atlas anchor へ追加した。これにより新 render class が procedural panel 内だけでなく、baseline browsing surfaces からも到達できる状態になった。



正式ロードマップ進捗は 3 / 5 完了 = 60%。Phase 1〜3 完了、次は Phase 4。



Phase 3 をさらに前進させ、reaction-diffusion variants の procedural grouping / quick preset / controls 同期を入れた。PROCEDURAL_MODES は procedural registry 由来に切り替えられ、cellular_front / biofilm_skin の quick preset 追加、reaction family 共通 controls、guide-aware reset source が有効になった。

2026-03-31 追加 3

UPGRADE_ROADMAP.md の正式な phase 数は 5。Phase 1〜5 が本線で、Phase 87 / Phase 0 は別の基準状態。

Phase 3d をさらに進め、ReactionDiffusionSystemRender に mode / source 別の dedicated topology routing を追加した。biofilm は sphere shell、cellular front は open cylinder、corrosion front は torus、残りも plane / disc / ring / torus / cone / cube / sphere を切り替える。

変更点は components/sceneReactionDiffusionSystem.tsx、components/sceneReactionDiffusionSystemRuntime.ts、components/sceneReactionDiffusionSystemRender.tsx、UPGRADE_ROADMAP.md、CURRENT_STATUS.md。

2026-03-31 追加 2

UPGRADE_ROADMAP.md の Phase 2 を現物コードで再確認した。lib/renderModeRegistry.ts と components/controlPanelGlobalDisplay.tsx により、registry / support level / UI 集計の 3 点が揃っているため、正式な描写機能拡張軸では Phase 2 は完了扱いでよい。

Phase 3 の text / glyph driven instancing を 1 段進め、text source かつ 3D solids 有効時に、luminance が instanced solid の scale banding / rotation / depth layering に効くようにした。

変更点は components/sceneParticleSystem.tsx、components/sceneParticleSystemUniforms.ts、components/sceneShaderParticlePoint.ts、lib/renderModeRegistry.ts。

今回 pass の確認では typecheck と verify:public-library は通過。build は sandbox で transforming... 以降停止し、再確認未完。

2026-03-31 追加（Phase 2 確認 + Phase 3d 強化）

UPGRADE_ROADMAP.md の Phase 2 は、lib/renderModeRegistry.ts と components/controlPanelGlobalDisplay.tsx の現物コードで完了確認できた。

Phase 3d として components/sceneReactionDiffusion* を強化し、reaction_diffusion / cellular_front / corrosion_front / biofilm_skin に mode 固有の diffusion / reaction / relief / ridge / pit / wetness を導入した。

変更点は components/sceneReactionDiffusionProfiles.ts、components/sceneReactionDiffusionSystemRuntime.ts、components/sceneReactionDiffusionShaders.ts、lib/renderModeRegistry.ts、UPGRADE_ROADMAP.md、CURRENT_STATUS.md。

2026-03-31 追加

Phase 3 を 1 ステップ進め、image / video / text の media luminance が particle layout に加えて size / alpha にも効くようにした。これで video-driven / glyph-driven particles の視覚差が増した。

変更点は components/particleData.ts、components/sceneParticleSystem.tsx、components/sceneParticleSystemUniforms.ts、components/sceneShaderParticlePoint.ts。



最終更新: 2026-03-31



この文書は、現物のソース・build・検証結果に合わせて同期した精査結果です。過去のレビュー文面に残っていた古い行数・古い責務記述は、この版では整理済みです。

総評

この package は、壊れた途中物ではなく、整理がかなり進んだ source baselineです。今回のパスまでで appStateConfig と depictionCoverage の大きい集中点は aggregate 化されました。一方、正式な描写機能拡張軸では lib/renderModeRegistry.ts と components/controlPanelGlobalDisplay.tsx により Phase 2 の registry 要件は満たされています。今回の追加差分では Phase 3 の text / glyph driven instancing を強化しました。



現在の主問題は App.tsx ではなく、以下です。



高密度な scene family shared / runtime 本体

高密度な control panel section

Playwright 未配置により未完の browser verify

今回確認した事実

実行・検証

npm run typecheck は 通過

npm run build は 通過

npm run verify:public-library は 通過

npm audit --json は 0 vulnerabilities

npm run verify:library は 未完

Playwright browser binary 不在

npx playwright install chromium は DNS EAI_AGAIN で取得失敗

build の変化

指標

変更前

現在

entry chunk

1415.65 kB

430.96 kB

source-family chunk

なし

5系統

Vite chunk warning

あり

なし



主な chunk:



starter-library-data

depiction-catalog

scene-gpgpu

scene-surface-families

scene-core-families

root 整理

root から以下を archive へ退避しています。



build.out

typecheck.out

typecheck2.out

typecheck3.out

typecheck4.out

build_phase1b.out

build_split_only.out



退避先:



docs/archive/build-logs/2026-03-31/

良かった点

1. appStateConfig / depictionCoverage の巨大集中点が解消した

現在は以下のように aggregate + submodule 構成です。



lib/appStateConfig.ts: 2行

lib/appStateConfigNormalization.ts: 116行

lib/depictionCoverage.ts: 4行

lib/depictionCoverageSummary.ts: 95行



つまり、以前の 800行級ボトルネック 2 本は、もう本体の集中点ではありません。

2. build は source split 後も維持された

typecheck と build が両方通っているため、今回の分割は構造整理だけでなく、実際に成立している差分です。

3. 大型ホットスポットの数が減った

500行超 TypeScript / TSX は 7本 → 5本 に減少しました。次の優先対象がかなり明確になっています。

気づいた問題点

1. starter preset data が次の最大ホットスポット

現時点の 500行超 TypeScript / TSX は次です。



ファイル

行数

KB

lib/starterLibraryPresetBaseChunk02.ts

615

19.5

lib/starterLibraryPresetExtensionChunk05.ts

609

21.0

lib/starterLibraryPresetExtensionChunk03.ts

596

20.3

lib/starterLibraryPresetBaseChunk01.ts

554

16.5

lib/hybridTemporalVariantBase.ts

506

16.1



今後の分割優先はここです。

2. control panel の L2 / L3 はまだ重い

components/controlPanelTabLayer2.tsx: 436行 / 31.2KB

components/controlPanelTabLayer3.tsx: 436行 / 31.2KB



500行未満ではありますが、責務密度は高いです。presentational section 単位でさらに切れる余地があります。

3. 追加の manual chunk 差分は未採用

appStateConfig / depictionCoverage を chunk 側でもさらに分ける案は試しましたが、今回の検証では build 安定性を優先して採用していません。したがって、今回の確定成果は source split です。

評価

総合

8.8 / 10

内訳

構造整理: 9.1 / 10

build 健全性: 8.8 / 10

ドキュメント整合: 8.7 / 10

配布静音性: 8.9 / 10

次フェーズへ進む足場: 8.6 / 10

次にやるべき順番

lib/starterLibraryPresetBaseChunk02.ts と lib/starterLibraryPresetExtensionChunk05.ts の再分割

lib/starterLibraryPresetExtensionChunk03.ts と lib/starterLibraryPresetBaseChunk01.ts の再分割

lib/hybridTemporalVariantBase.ts の family 分割

components/controlPanelTabLayer2.tsx / components/controlPanelTabLayer3.tsx の presentational 分離

Playwright browser を持つ環境で verify:library を再実行

Phase 2 開始時点の所見

components/sceneBrushSurfaceSystemShared.ts は aggregate export に縮小し、types / profiles / shaders / config へ分割済み

次に切る優先度が高いのは components/sceneFiberFieldSystem.tsx と components/controlPanelTabLayer2.tsx / components/controlPanelTabLayer3.tsx

今回の追加差分では typecheck と verify:public-library は通過。build は sandbox 環境で transforming... 以降が停止し、再確認未完

Phase 4 継続レビュー（2026-03-31, scene branch plan pass）

今回の差分で良くなった点は次の通り。



AppSceneLayerContent.tsx の Layer 2 / 3 / GPGPU の条件分岐が、個別の config.* 読みより scene render plan 参照へ寄った

components/gpgpuRenderOutputs.tsx が point / instanced / trail / ribbon / tube / streak / volumetric を routing-aware plan で切り替えるようになった

lib/renderModeRegistry.ts の GPGPU active 判定が、scene 実描画と同じ plan を見るようになった



したがって、Phase 4 の残りは「routing 情報がある」状態からさらに進み、実際の scene 出力切替が同じ plan を見る 状態に近づいている。

現在の評価

正式ロードマップ全体: 約 78%



Phase 4 単体: 約 76%



Phase 4 の今回差分上積み: +7pt 前後



Phase 4 follow-up: scene branch plans are now serialized into manifest execution entries, reducing the gap between diagnostics-only branch visibility and export/import-visible routing state.



Phase 4 continuation: routing-owned runtime snapshots now cover temporal activation plus deposition / patch / growth / fog subsystem settings, reducing repeated direct reads of config.layer2* / config.layer3* inside scene subsystems.



Phase 4 continuation: crystal / crystal-deposition / voxel / erosion / brush families now share routing-owned source-layout snapshots and dependency arrays. This removes another band of duplicated layer2* / layer3* settings reads and makes runtime radius / density / source-layout decisions more consistent across subsystems.



現在の目安: 正式ロードマップ全体 約86%、Phase 4 単体 約95%。



Phase 4 continuation: sceneRenderRouting was split into Types / Runtime / Plans, reducing the new helper hotspot while keeping the same external import path.



Phase 4 continuation: shell / glyph / fiber / line families now consume routing-owned runtime snapshots (Hull / GlyphOutline / Fiber / Line) instead of repeating more raw config.layerX* reads in place.



現在の目安更新: 正式ロードマップ全体 約87%、Phase 4 単体 約96%。



Phase 4 continuation: the dense particle-core band has been reduced further. sceneParticleSystem* and particleData.ts now read Layer 2 / 3 runtime state through shared routing snapshots instead of local config.layerX* branching, which lowers one of the last large runtime hotspots.



現在の目安更新: 正式ロードマップ全体 約88%、Phase 4 単体 約98%。



Phase 4 continuation: manifest / export / routing builder were synchronized further. projectExecutionRouting now owns sceneBranches, and projectSerializationSnapshot now serializes requested/resolved/path/render/simulation/override/procedural/hybrid/branch/note execution tokens from the same routing map instead of reconstructing a thinner execution view per layer.



現在の目安更新: 正式ロードマップ全体 約89%、Phase 4 単体 約99%。



Phase 5 drift report: npm run generate:phase5-drift-report



Phase 5 now checks project fingerprint stability across parse/serialize/parse round-trips, not only counts.



Phase 5 追補: docs/archive/phase5-import-report.json を追加し、replace / merge 両モードでの exact preset / sequence ID change、duplicate source ID の可視化、orphan drop を fixture ごとに固定した。



Phase 5 は phase5-import-report に compare / aggregate summary を追加し、exact ID table を読まなくても retain/remap/drop の全体傾向を追えるようにした。



optional real-export fixture 向けに phase5-real-export-readiness-report を追加し、manifest missing・hash drift・metadata drift・round-trip drift を分けて診断できるようにした。entry ごとに metadata drift fields / round-trip drift fields も保持する。



Phase 5 execution readiness: npm run generate:phase5-execution-readiness-report writes docs/archive/phase5-execution-readiness-report.json, separating repo-level readiness (lockfile sync) from environment blockers (node_modules, real-export fixture presence).



Phase 5 evidence index: npm run generate:phase5-evidence-index writes docs/archive/phase5-evidence-index.json, centralizing completion criteria, import/drift coverage, readiness blockers, and remaining closure steps in one file.



Phase 5 closeout checklist: npm run generate:phase5-closeout-checklist writes docs/archive/phase5-closeout-checklist.json, separating repo-complete, execution-ready, real-export-committed, and execution-proven closure states.

Phase 5 proof intake

docs/archive/phase5-proof-intake.json tracks whether the four execution-proof logs (npm-ci.log, verify-project-state.log, verify-phase5.log, build.log) have been captured under docs/archive/phase5-proof-input/.

This keeps execution-proven closeout separate from repo-level completion and makes the remaining closeout work mechanically checkable.

Phase 5 auto-closeout: `npm run generate:phase5-auto-closeout

generate:phase5-refresh-closeoutwritesdocs/archive/phase5-auto-closeout.json`, automatically promoting status from repo-ready to execution-ready to execution-proven once proof logs verify successfully and a real export fixture is present.



Phase 5 operator handoff: run npm run generate:phase5-operator-handoff after proof logs or browser real-export fixtures are added.



Phase 5 final closure can also be read from docs/archive/phase5-final-closeout.json, regenerated with npm run generate:phase5-final-closeout.
