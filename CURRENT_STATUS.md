Current Status

Phase 4 は完了扱いを維持する。

Phase 5 は 完了 とする。完了条件は docs/archive/phase5-completion-report.json に固定した。

browser 由来の real-export fixture 追加は今後も可能だが、これは Phase 5 の必須ゲートではなく任意の追補 とする。

verify:phase5 は core Phase 5 の完了条件を支える常設検証として維持し、real-export fixture が追加された場合のみ追加検査を自動で行う。

2026-03-31 追加 24（Phase 5 完了判定の固定）

docs/archive/phase5-completion-report.json を追加し、Phase 5 の完了条件を固定した。



core completion criteria は次の 5 本とする。



schema versioning / migration

sparse serialization normalization

file round-trip と import hardening

replace / merge import semantics

fixture / drift infrastructure



browser-captured real-export fixture は optional follow-up とし、未投入でも Phase 5 完了判定を下げない。



npm run generate:phase5-completion-report を追加した。



Phase 5 は fixtures/project-state/real-export/ を real export 受け皿として追加した。



verify:phase5 は optional real-export fixtures を走査し、存在する .json について naming pattern / inspection / serialize→parse 安定性を確認する。



この環境では browser UI export 自体はまだ回していないが、実ファイルが入れば継続検査へ即時載る状態になった。

2026-03-31 追加 20（Phase 5 進行: orphan sequence drop と import inspection 追加）

Phase 5 をさらに進め、prepareImportedProjectData() に droppedOrphanSequenceCount を追加した。import 時に存在しない preset を参照する sequence step は読み込みを止めずに drop し、その件数を diagnostics と import notice で報告する。

lib/projectTransferShared.ts に inspectProjectDataText() を追加した。これにより import 前に JSON 構文エラー と JSON は読めるが project export ではない payload を区別して扱える。UI 側 useProjectTransfer.ts もこの inspection を使うよう更新した。

新規 fixture fixtures/project-state/phase5-orphan-sequence.json を追加した。これは missing preset を参照する orphan sequence step を含み、Phase 5 verifier が drop / diagnostics / rebuilt manifest を固定監視する。

verify:phase5 は新たに以下を確認する。

invalid JSON syntax の専用エラー

unsupported project payload の専用エラー

orphan sequence step の drop

orphan drop 件数の diagnostics / notice 反映

2026-03-31 追加 19（Phase 5 進行: duplicate ID repair と import diagnostics 追加）

Phase 5 をさらに進め、prepareImportedProjectData() に import diagnostics を追加した。現在は remappedPresetIdCount、regeneratedSequenceIdCount、activePresetFallbackApplied。さらに sequence ID は衝突時のみ再生成するようにした。さらに、sequence ID は衝突時のみ再生成するよう修正した を返す。

これにより、project import 後の notice で「何件の preset ID を remap したか」「sequence ID を何件再生成したか」「active preset を先頭へ戻したか」を表示できるようになった。

同時に、duplicate preset ID を含む import で presetIdRemap が最後の重複だけを保持していた問題を修正し、最初に確定した remap を固定するようにした。これで duplicate preset を参照する sequence は deterministic に同じ imported preset へ寄る。

fixtures/project-state/phase5-duplicate-ids-invalid-active.json を追加した。これは duplicate preset IDs / duplicate sequence IDs / invalid active preset を含む recoverable fixture で、Phase 5 verifier が常時監視する。

verify:phase5 は新たに以下を確認する。

duplicate preset / sequence ID が import preparation で一意化されること

invalid active preset が先頭 imported preset に fallback すること

import notice が normalization 内容を報告すること

進捗目安: 正式ロードマップ全体 約98%、Phase 5 約91%。

2026-03-31 追加 18（Phase 5 進行: import remap 後の manifest / serialization 再構築）

prepareImportedProjectData() は preset / sequence の ID remap 後、buildProjectData() を使って project snapshot を再構築するように更新した。これで import 衝突解消後の manifest.stats、execution digest、serialization が実際の imported state と同期する。

以前は prepared.project が remap 後の preset / sequence を持っていても、manifest / serialization は parse 時点の値を保持しており、presetCount / sequenceCount や schema digest が内部的にズレうる余地があった。今回それを潰した。

verify:phase5 は新たに、collision remap 後の project について manifest presetCount / sequenceCount、execution count、serialization layer count、schema version の整合を確認する。

したがって Phase 5 は、fixture parity と file round-trip に加えて import collision 解決後の snapshot integrity まで verifier で監視する段階に進んだ。

進捗目安: 正式ロードマップ全体 約98%、Phase 5 約88%。

2026-03-31 追加 17（Phase 5 進行: file round-trip と import helper 共通化）

Phase 5 をさらに進め、project export/import の ファイル経路そのもの を検証しやすい形へ寄せた。

追加: lib/projectTransferShared.ts

buildProjectExportFileName()

serializeProjectData()

parseProjectDataText()

prepareImportedProjectData()

buildProjectImportNotice()

これにより、UI 側 useProjectTransfer.ts の export/import は、Phase 5 verifier と同じ helper を使うようになった。export のファイル名と JSON 文字列化、import 時の preset / sequence ID remap、migration notice の組み立てが 1 箇所に寄った。

scripts/verify-phase5-entry.ts は以下を追加確認する。

temp directory へ実際に exported JSON を書き出し、読み戻せること

exported file の manifest.execution / serialization が file I/O 後も安定すること

preset ID 衝突時に import helper が全 preset を remap できること

sequence ID と sequence 内 preset 参照が remap 後も整合すること

remap 済み project を再度 disk へ書いて再 parse できること

この pass により、Phase 5 は「memory 上の parse/normalize」だけでなく、CLI で再現できる file round-trip + import preparation まで入った。

現時点の判定（ソース更新ベース）:

正式ロードマップ全体: 約97%

Phase 4: 完了維持

Phase 5: 約84%

残りの主対象:

browser-available 環境で app 実 export から採った fixture の追加

実 UI 経路の export → import 往復

依存が入った環境で npm run verify:phase5 / npm run build の再確認

2026-03-31 追加 16（Phase 5 進行: 実 fixture file 同梱と fixture 同期検証）

Phase 5 をさらに進め、fixtures/project-state/ に 実 project JSON fixture 3件 を同梱した。

phase5-native-rich.json

phase5-sparse-layer2-custom.json

phase5-legacy-v24.json

scripts/projectPhase5Fixtures.ts を追加し、fixture payload の定義を 1 箇所へ寄せた。fixture の書き出しは npm run generate:phase5-fixtures で再生成できる。

scripts/verify-phase5-entry.ts は、この committed fixture file を実際に読み、期待 payload と 完全一致 しているかをまず確認するようになった。これにより「verify は通るが fixture が古い」という状態を検出できる。

verify:phase5 の追加確認対象:

fixture file が現行期待値と同期していること

committed fixture file が parseProjectData() で読めること

sparse fixture で custom execution token が保持されること

legacy fixture で migration state が migrated になること

現時点の判定:

正式ロードマップ全体: 約96%

Phase 4: 完了維持

Phase 5: 約78%

Phase 5 の残りは、fixture 実体の追加そのものではなく、browser-available 環境での export → import 実ファイル往復 と、その結果を CI / 実機検証へ寄せること。

2026-03-31 追加 15（Phase 5 進行: serialization 正規化と専用 verifier 追加）

Phase 5 を進め、project import/export の壊れやすい箇所だった sparse serialization / partial block / legacy payload の読込を強化した。

lib/projectSerializationSnapshot.ts に normalizeProjectSerializationSnapshot() を追加した。これにより、読み込み時に各 layer block の values を 入力値 + fallback 値の和集合 で正規化し、空 block や欠損 execution token を現行 routing 語彙で自動補完する。

lib/projectStateStorage.ts は serialization 読込をこの helper 経由へ切り替えた。従来のように block ごとに raw 値をそのまま採るのでなく、schema version に合わせて serialization 全体を再整形する。

追加:

npm run verify:phase5

scripts/verify-phase5.mjs

scripts/verify-phase5-entry.ts

verify:phase5 の検証対象:

sparse serialization でも custom token を保持しつつ fallback block 値を補完できること

schema / serialization / manifest を欠く legacy payload から migration-aware に再構築できること

parse → JSON 化 → 再 parse 後も serialization / manifest.execution が安定すること

README.md は verify:project-state / verify:phase4 / verify:phase5 の導線を明記した。

package.json には、direct script dependency として esbuild と skia-canvas を明示した。

この pass では node_modules 非同梱のため、package-lock.json の再生成までは行っていない。lock 更新は依存導入可能な環境で実施する。

現時点の判定:

正式ロードマップ全体: 約94%

Phase 4: 完了維持

Phase 5: 基盤 → hardening 進行中

この unpacked pass では node_modules が同梱されていないため、今回追加分の最終確認は フル npm run 再実行ではなくソース更新中心。依存が入った環境では、次の確認順を推奨する。

npm run verify:project-state

npm run verify:phase5

npm run verify:phase4

2026-03-31 追加 14（Phase 4 完了: build / project-state / export 検証通し）

Phase 4 の出口確認として、依存を再構成した上で npm run build / npm run verify:project-state / npm run verify:export を通した。

npm run build はこの環境で完走を確認した。最新 build 出力は以下。

dist/assets/index-BwOn5n6a.js 436.50kB

dist/assets/depiction-catalog-CdyD-dSc.js 360.25kB

dist/assets/three-core-BbVy3ccf.js 675.03kB

dist/assets/particleDataWorker-BxYiCCNG.js 377.93kB

verify:project-state は 3 シナリオ通過。

baseline

hybrid + video + post FX

text/fiber + WebGPU-preferred GPGPU

verify:export はこの sandbox で page.goto(http://127.0.0.1:*) と file://.../dist/index.html がともに ERR_BLOCKED_BY_ADMINISTRATOR になるため、node-canvas harness へ自動退避する形にした。

verify:export の現在仕様:

まず app UI を Playwright + Chromium で開こうとする

sandbox policy で navigation が阻害された場合は node-canvas harness で PNG alpha 振る舞いを検証する

opaque PNG は transparent pixel 0、transparent PNG は transparent pixel > 0 を確認する

追加:

npm run verify:phase4

scripts/verify-phase4.mjs

verify:phase4 は以下を順に実行する。

npm run build

npm run verify:project-state

npm run verify:export

現時点の判定:

正式ロードマップ全体: 約92%

Phase 4 単体: 完了

次の主対象は Phase 5 の import/export 検証拡張と round-trip 強化。

2026-03-31 追加 13（Phase 4 詰め: project-state 検証経路の追加と循環参照修正）

Phase 4 の締めとして、Playwright browser 依存なしで manifest / execution routing / serialization / parse migration を検証できる Node 単体の project-state verifier を追加した。

追加:

npm run verify:project-state

scripts/verify-project-state.mjs

scripts/verify-project-state-entry.ts

検証対象は3シナリオ。

baseline

hybrid + video + post FX

text/fiber + WebGPU-preferred GPGPU

各シナリオで以下を通した。

manifest.execution 4件

serialization.layers 4件

routing map と manifest execution の requested/resolved/path/render/simulation/capability/sceneBranches 一致

serialization execution block に routing token 群が全て入ること

parseProjectData() round-trip 後も execution / sceneBranches が保持されること

schema / serialization を外した legacy payload から migration-aware に復元できること

併せて、projectStateShared.ts / projectStateStorage.ts の不要な appState -> appStateLibrary -> starterLibrary 依存を外し、project export/import 系が starter preset 初期化に巻き込まれないよう整理した。

さらに、projectExecutionRouting.ts が sceneBranches を作る際の自己参照再帰を修正した。未完成 route を sceneRenderRouting 側へ明示渡しする形に変え、Node 検証でも stack overflow しないようにした。

verify:export は依然として Playwright browser 未導入環境では止まるが、失敗時に verify:project-state を案内する形へメッセージを改善した。

現時点の目安:

正式ロードマップ全体: 約90%

Phase 4 単体: 約99%

残りの中心課題:

vite build 完走確認

Playwright browser 実体あり環境での verify:export / round-trip 実 UI 検証

Phase 5 側の import/export 検証帯域の拡張

2026-03-31 追加 12（Phase 4 継続: manifest / export / routing builder 最終同期）

Phase 4 の実質仕上げとして、manifest / export / routing builder の語彙をさらに揃えた。

lib/projectExecutionRouting.ts は layer / gpgpu の routing input helper を持つ形へ整理し、Layer 2 / 3 / GPGPU の execution snapshot を build する箇所の raw branching を少し圧縮した。

execution snapshot は sceneBranches を builder 自身が持つようにし、projectStateManifest 側で後付けしていた branch 注入をやめた。これにより manifest / diagnostics / runtime / export が同じ execution entry を見やすくなった。

lib/projectSerializationSnapshot.ts は layer ごとに buildProjectExecutionRoutingMap() を参照し、execution block に以下を含めるようにした。

resolved engine / path

requested / resolved / path token

render / simulation token

override / procedural / hybrid token

capability flags

scene branch token

note token

そのため export 側でも、従来の「engine と path だけ」より一段詳しく routing 状態を追えるようになった。

PROJECT_SERIALIZATION_SCHEMA_VERSION は 2 に更新した。旧 export は migration-aware に fallback しつつ読める。



進捗目安:



正式ロードマップ全体: 約89%

Phase 4 単体: 約99%

今回の差分上積み: +1pt 前後



残り主課題:



build 完走確認

export の実ファイル round-trip 検証

Phase 5 の import/export 検証拡張

2026-03-31 追加 11（Phase 4 継続: routing helper 分割と shell / glyph / fiber / line 寄せ）

Phase 4 の仕上げとして、肥大化していた lib/sceneRenderRouting.ts を 役割別に分割 した。現在は以下の4ファイル構成。

lib/sceneRenderRouting.ts（aggregate export）

lib/sceneRenderRoutingTypes.ts

lib/sceneRenderRoutingRuntime.ts

lib/sceneRenderRoutingPlans.ts

これにより、前回 653 行だった hotspot は、types 200行 / runtime 408行 / plans 142行 に分散された。

さらに Phase 4 の残りとして、以下の subsystem が routing-owned runtime snapshot を使うようになった。

sceneSurfaceShellSystemShared.ts

sceneSurfaceShellSystemRuntime.ts

sceneGlyphOutlineSystem.tsx

sceneFiberFieldSystem.tsx

sceneLineSystemShared.ts

sceneVoxelLatticeSystem.tsx

新規 snapshot helper:

getLayerRuntimeHullSnapshot()

getLayerRuntimeGlyphOutlineSnapshot()

getLayerRuntimeFiberSnapshot()

getLayerRuntimeLineSnapshot()

これで shell / glyph / fiber / line family でも、mode / source / color / radiusScale / material / opacity / width / pointBudget などの読取が routing helper 側へさらに寄った。

確認結果:

npm ci ✅

npm run typecheck ✅

npm run build ⚠️ sandbox では今回も vite build が transforming... 以降で完走確認を取り切れていない

進捗目安:

正式ロードマップ全体: 約87%

Phase 4 単体: 約96%

Phase 4 の残り主課題:

sceneParticleSystem* / sceneParticleSystemRender / sceneParticleSystemShared の raw config.layer2* / layer3* 読取寄せ

executionDiagnostics / 一部 registry 周辺の残差整理

build 完走確認

2026-03-31 追加 10（Phase 4 継続: subsystem runtime snapshot 共有の拡張）

Phase 4 の残りとして、scene subsystem 内部でまだ config.layer2* / layer3* を個別に読んでいた箇所を、sceneRenderRouting 側の layer runtime snapshot へ寄せた。

lib/sceneRenderRouting.ts に LayerRuntimeConfigSnapshot と以下の helper を追加した。

getLayerRuntimeConfigSnapshot()

getLayerRuntimeSource()

getLayerRuntimeColor()

getLayerRuntimeRadiusScale()

getLayerRuntimeMaterialStyle()

getLayerRuntimeGeomMode3D()

これにより、routing / scene branch plan だけでなく、subsystem が使う mode / source / color / radiusScale / materialStyle / geometry の語彙も共通 helper へ寄り始めた。

今回の適用先は以下。

sceneHybridMembraneSystem.tsx

sceneHybridSurfacePatchSystem.tsx

sceneSdfSurfaceShellSystem.tsx

sceneVolumetricFieldSystem.tsx

sceneHybridGranularFieldSystem.tsx

sceneHybridFiberFieldSystem.tsx

特に hybrid / shell / volumetric 系では、mode / source / material / color / radiusScale の大半を runtime snapshot 由来へ切り替えた。

検証結果

npm ci ✅

npm run typecheck ✅

npm run build ⚠️ vite build は transforming... まで到達するが、この環境では完走ログを最後まで安定取得できない

進捗目安

正式ロードマップ全体: 約 82%

Phase 4 単体: 約 87%

今回上積み: +5pt 前後

CURRENT_STATUS

最終更新: 2026-03-31



このファイルが、このソース一式の現在の正本です。現状把握は、まずこのファイルと REVIEW.md を見てください。

2026-03-31 追加 9（Phase 4 継続: scene routing plan の正本化）

Phase 4 の残りとして、scene 側の描写分岐と render mode summary が 同じ routing 語彙 を使うように整理した。

追加: lib/sceneRenderRouting.ts

反映先: components/AppSceneLayerContent.tsx / lib/renderModeRegistry.ts / lib/executionDiagnostics.ts / components/AppExecutionDiagnosticsOverlay.tsx

sceneRenderRouting では、Layer 2 / 3 / GPGPU の routing snapshot から以下を一段で判定できるようにした。

particle core

procedural / hybrid system

glyph outline

aux / spark

connection line style

ghost trail

GPGPU smooth tube / metaball / volumetric

AppSceneLayerContent は scene family の分岐条件をこの helper へ寄せ、Layer 2 / 3 / GPGPU の描画判定が runtime 内で重複しないようにした。

renderModeRegistry も、mode 名や toggle の直読みだけでなく 実際の routing plan を見て active 判定する箇所を増やした。

これにより image / video / text particle layout、connection lines、instanced solids、ghost trail、GPGPU metaball などが、実 scene とより近い集計になる。

diagnostics overlay には scene branches を追加した。

例: particle-core / procedural:surface-shell / hybrid:volume-fog / connections:brush / metaballs

今回確認できた実行結果:

npm ci ✅

npm run typecheck ✅

npm run build ⚠️ sandbox では今回も vite build の完走ログを確認し切れず、dist 再生成の断定は保留

進捗目安:

正式ロードマップ全体: 3.7 / 5 = 74%

Phase 4 単体: 約 69%（runtime / diagnostics / registry / scene branch plan まで snapshot-first 化、残りは scene subsystem 個別実装と manifest への更なる反映）

2026-03-31 追加 8（Phase 4 継続: snapshot-first の接続拡張）

Phase 4 の残りとして、routing snapshot をまだ間接参照していた補助層をさらに整理した。

反映先: lib/simulationAdapterBridge.ts / lib/projectExecutionRouting.ts / lib/executionDiagnostics.ts / components/AppSceneLayerContent.tsx

simulation adapter bridge は、layer config を再解釈して毎回 engine を引き直すのではなく、execution routing snapshot を受け取って bridge plan を組めるようにした。

これにより manifest / runtime / diagnostics の adapter 表示が同じ routing entry を正本として共有する。

projectExecutionRouting は bridge 情報を routing snapshot から再構成する形へ寄せ、Layer 2 / 3 の execution → simulation class 連結を一本化した。

diagnostics も routing entry から bridge 補助情報を組み立てるように変更し、Layer 2 / 3 の engine/path/procedural 解釈が runtime と揃うようにした。

AppSceneLayerContent の GPGPU 補助描写は、config.gpgpuWebGPUEnabled 直結ではなく GPGPU routing entry + feature flag を基準に判定するようにした。

特に metaball は WebGPU toggle 固定ではなく、resolved backend が webgl-gpgpu / webgpu-compute のどちらでも描写可能な routing へ修正した。

今回確認できた実行結果:

npm ci ✅

npm run typecheck ✅

npm run build ⚠️ sandbox では今回も transforming... 以降で停止

進捗目安:

正式ロードマップ全体: 3.5 / 5 = 70%

Phase 4 単体: 約 62%（manifest / diagnostics / Layer2/3 runtime / GPGPU 条件分岐 / adapter bridge の snapshot-first 化まで接続済み、残りは scene subsystem 全域への展開）

2026-03-31 追加 6（Phase 4 / 5 前段の正式化）

2026-03-31 追加 7（Phase 4 優先の runtime 正本化）

Phase 4 を優先して、runtime 側が capability-aware routing snapshot を直接参照する範囲を拡大した。



反映先: components/AppSceneLayerContent.tsx / components/gpgpuExecutionRouting.ts / lib/executionDiagnostics.ts

追加/強化: lib/projectExecutionRouting.ts



ProjectExecutionRoutingSnapshot に overrideId / proceduralSystemId / hybridKind を追加した。



これにより manifest / diagnostics / runtime が同じ routing 語彙を共有するようになった。



AppSceneLayerContent は resolveExecutionEngineForLayer() を都度呼ぶ分岐から、getLayerExecutionRoutingSnapshot() を正本として使う形へ変更した。



Layer 2 / 3 の particle / procedural / hybrid 切替が manifest と同じ解釈で動く。



GPGPU も frame routing 時に getProjectExecutionRoutingEntry(..., { gpgpuWebgpuAvailable }) を参照するようにした。



静的 manifest と live availability の差分を同じ routing builder 上で吸収する。



diagnostics overlay と Project I/O の routing 表示にも overrideId / proceduralSystemId / hybridKind / flags / notes を反映した。



今回確認できた実行結果:



npm run typecheck ✅



Phase 4 の前段として散在していた execution foundation を、project manifest 上の capability-aware routing として正式化した。



追加: lib/projectExecutionRouting.ts

反映先: lib/projectStateManifest.ts / components/controlPanelProjectIOManifestSection.tsx

内容: render class / simulation class / requested engine / resolved engine / path / capability flags（webgl-stable / webgpu-preferred / export-only / mobile-risky）



Phase 5 の前段として存在していた manifest / storage を、serialization block + migration-aware schema へ拡張した。



追加: lib/projectSerializationSnapshot.ts

反映先: lib/projectStateStorage.ts / types/project.ts

内容: source / simulation / primitive / shading / postfx / execution block、schema、serialization、旧 version からの migration 状態保持



Project I/O パネルに capability-aware routing を表示するようにした。



今回確認できた実行結果:



npm ci ✅

npm run typecheck ✅

npm run build ⚠️ sandbox では今回も transforming... 以降で停止



正式ロードマップ進捗率は 3.5 / 5 = 70% を目安とする。Phase 1〜3 は完了、Phase 4 は runtime / diagnostics / GPGPU 条件分岐 / adapter bridge へ接続拡大中、Phase 5 は serialization schema / migration metadata まで前進。

現在の位置づけ

パッケージ種別: source only

基準状態: Phase 87 / Phase 0 complete baseline

正式ロードマップ確認: UPGRADE_ROADMAP の正式 phase 数は 5（Phase 1〜5） / Phase 2 は現物コードで実装確認済み / Phase 3 は今回完了扱い / 次の主対象は Phase 4

今回完了:

CURRENT_STATUS.md / REVIEW.md を現物ベースへ再同期

root の *.out を docs/archive/build-logs/2026-03-31/ へ退避

npm audit を 0 vulnerabilities で維持

starterLibrarySequenceExtensions.ts を aggregate + 4 chunk へ再分割

appStateConfig.ts を aggregate 化し、default family を 8分割

depictionCoverage.ts を aggregate 化し、targets / layer-resolvers / gpgpu-resolvers / family-resolvers / summary へ再分割

今回の確認範囲:

npm run typecheck ✅

npm run build ✅

npm run verify:public-library ✅

npm audit --json ✅

npm run verify:library ⚠️ Playwright browser 未配置のため未完

npm run build（今回 Phase 2 差分の再確認）⚠️ sandbox 環境では transforming... 以降で停止。typecheck と verify:public-library は通過

正式ロードマップ進捗率: 3 / 5 完了 = 60%

Phase 3 進捗: image / video / text source の luminance を particle layout だけでなく size / alpha にも反映し、さらに text source + 3D solids では instanced solid の scale / rotation / depth layering にも反映

今回 pass の検証: npm run typecheck / npm run build / npm run verify:public-library / npm audit --json は通過

今回の要点

1. root を静かに維持した

以下のログを root 直下から退避済みです。



build.out

typecheck.out

typecheck2.out

typecheck3.out

typecheck4.out

今回追加の build_phase1b.out

今回追加の build_split_only.out



退避先:



docs/archive/build-logs/2026-03-31/

2. source-level split を本体側へ進めた

lib/appStateConfig.ts は aggregate export 層へ縮小し、以下へ分割しました。



lib/appStateConfigDefaults.ts

lib/appStateConfigNormalization.ts

lib/appStateDefaultViewDisplay.ts

lib/appStateDefaultEnvironment.ts

lib/appStateDefaultAudioSynth.ts

lib/appStateDefaultLayer1.ts

lib/appStateDefaultLayer2.ts

lib/appStateDefaultLayer3.ts

lib/appStateDefaultGpgpu.ts

lib/appStateDefaultPostAmbient.ts



lib/depictionCoverage.ts も aggregate export 層へ縮小し、以下へ分割しました。



lib/depictionCoverageTargets.ts

lib/depictionCoverageLayerResolvers.ts

lib/depictionCoverageGpgpuResolvers.ts

lib/depictionCoverageFamilyResolvers.ts

lib/depictionCoverageSummary.ts

3. build は維持した

appStateConfig / depictionCoverage の source-level split 後も、build は通過しています。追加の manualChunks も試しましたが、その差分は build 安定性確認のため採用せず、現時点では source split のみを採用しています。

4. Phase 2 を開始した

scene 系の責務分割に入り、components/sceneBrushSurfaceSystemShared.ts を aggregate export 層へ縮小しました。



新規分割先:



components/sceneBrushSurfaceSystemTypes.ts

components/sceneBrushSurfaceSystemProfiles.ts

components/sceneBrushSurfaceSystemShaders.ts

components/sceneBrushSurfaceSystemConfig.ts



これにより、次の Phase 2 本体を scene / control-panel の責務分離 として進める足場ができています。

5. Phase 2 の完了はコード実体でも確認できる

UPGRADE_ROADMAP.md の Phase 2 要件である render mode registry / support level / UI summary は現物コードで成立しています。



lib/renderModeRegistry.ts

components/controlPanelGlobalDisplay.tsx



したがって、正式ロードマップ上の Phase 2 は完了確認済み と扱えます。

6. Phase 3d を前進させた

components/sceneReactionDiffusion* 系を強化し、以下を mode ごとに分離しました。



diffusion coefficients (dA / dB)

reaction gain

surface height / ridge / pit

wetness / scar



これにより reaction_diffusion / cellular_front / corrosion_front / biofilm_skin が単なる同一 plate shader ではなく、より独立した表情を持つようになっています。

7. Phase 3d の topology routing も dedicated 化した

components/sceneReactionDiffusionSystemRender.tsx に mode / source 別の geometry routing を追加しました。



biofilm_skin → sphere shell

cellular_front → open cylinder front

corrosion_front → torus etch ring

その他の reaction source → plane / disc / ring / torus / cylinder / cone / cube / sphere



これにより、Phase 3d は shader parameter 差だけでなく、専用 render path 側で topology も切り替わる段階に進みました。

8. Phase 3 を完了扱いへ進めた

reaction-diffusion 系の dedicated runtime / shader / topology routing に加え、baseline browsing surfaces 側も同期しました。



追加した露出先:



lib/starterLibraryPresetExtensionChunk04.ts

starter-reaction-plate-labyrinth

starter-biofilm-colony-skin

lib/starterLibrarySequenceExtensionChunk04.ts

上記 2 preset の sequence step

lib/expressionAtlasBundlesAnchorsElastic.ts

reaction-plate-labyrinth-anchor

biofilm-colony-anchor



これにより、Phase 3 の新 render class は procedural panel だけでなく、starter preset / preset sequence / expression atlas anchor からも辿れる状態になりました。

build 実測

変更前（同梱 build.out）

index-_21j54FJ.js: 1415.65 kB

three-core-CRqydIZK.js: 675.03 kB

Vite chunk warning: あり

現在（2026-03-31 再計測）

index-DBOT5kv7.js: 430.96 kB

depiction-catalog-B8e6VC9t.js: 327.00 kB

starter-library-data-B0CBr1ai.js: 226.58 kB

scene-core-families-COB0V8U4.js: 191.96 kB

scene-surface-families-hogEgexv.js: 169.28 kB

scene-gpgpu--xN8mpx6.js: 71.74 kB

three-core-BbVy3ccf.js: 675.03 kB

Vite chunk warning: なし

現在の実測値（現物同期済み）

ファイル

行数

KB

現在の責務

App.tsx

431

13.6

app orchestrator

components/AppScene.tsx

110

4.2

scene orchestrator

components/AppSceneLayerContent.tsx

251

14.7

layer 別 scene family 集約

components/sceneGpgpuSystem.tsx

251

6.5

GPGPU orchestrator

components/controlPanelTabLayer2.tsx

436

31.2

layer 2 controls

components/controlPanelTabLayer3.tsx

436

31.2

layer 3 controls

lib/appStateConfig.ts

2

0.1

config aggregate export

lib/appStateConfigDefaults.ts

20

1.0

config default aggregate

lib/appStateConfigNormalization.ts

116

4.0

normalize / synth helpers

lib/appStateDefaultLayer2.ts

207

5.7

layer2 default family

lib/appStateDefaultLayer3.ts

207

5.7

layer3 default family

lib/depictionCoverage.ts

4

0.2

coverage aggregate export

lib/depictionCoverageTargets.ts

174

4.1

target definitions

lib/depictionCoverageLayerResolvers.ts

186

6.9

layer/source/render resolver

lib/depictionCoverageGpgpuResolvers.ts

138

6.4

gpgpu / compute resolver

lib/depictionCoverageFamilyResolvers.ts

253

15.4

solver / physical / temporal / specialist resolver

lib/depictionCoverageSummary.ts

95

4.1

profile assembly / gap summary

lib/starterLibraryPresetBaseChunk02.ts

615

19.5

preset base data chunk

lib/starterLibraryPresetExtensionChunk05.ts

609

21.0

preset extension data chunk

lib/starterLibrarySequenceExtensions.ts

12

0.7

sequence extension aggregate

vite.config.ts

101

4.7

build / chunk policy

残る大型ホットスポット

現在の 500行超 TypeScript / TSX は 5本 です。前回の 7本 → 5本 に減少しました。



lib/starterLibraryPresetBaseChunk02.ts — 615行

lib/starterLibraryPresetExtensionChunk05.ts — 609行

lib/starterLibraryPresetExtensionChunk03.ts — 596行

lib/starterLibraryPresetBaseChunk01.ts — 554行

lib/hybridTemporalVariantBase.ts — 506行



したがって、現在の中心問題は config / coverage ではなく、starter preset data と hybrid temporal variant 側です。

正式ロードマップ進捗

Phase 2

UPGRADE_ROADMAP.md の要件は現物コードで満たしています。



lib/renderModeRegistry.ts に render mode registry 本体がある

category と support level（stable / experimental / heavy）を保持している

components/controlPanelGlobalDisplay.tsx がこの registry を集計表示している



したがって、正式な描写機能拡張の軸では Phase 2 は完了扱いでよいです。

Phase 3

現時点で確認できる進捗は次です。



3b: Brush / Filament connection lines — 実装済み

3c: image / video / text の media luminance sampling 強化 — 実装済み

3e: sheet / membrane surface — 実装済み

3f: text / glyph driven instancing 強化 — 今回実装

3d: reaction-diffusion は dedicated runtime / shader / render を持ち、さらに mode / source 別 topology routing まで入った。残課題は preset 同期と capability-aware routing への接続



Phase 3 は今回で完了扱いです。

検証結果

成功

npm run typecheck

npm run build

npm run verify:public-library

npm audit --json（clean）

未完

npm run verify:library

Playwright browser binary が環境に無いため停止

npx playwright install chromium も DNS EAI_AGAIN で取得失敗

したがって、ライブラリ verify の未完はコード不具合確定ではなく、実行環境不足

文書運用

root の正本:



CURRENT_STATUS.md

REVIEW.md

REFACTOR_PLAN_LARGE_FILES.md

PHASE0_COMPLETION_STATUS.md

SYSTEM_DESIGN_BLUEPRINT.md

UPGRADE_ROADMAP.md



旧ログ / 旧進捗 / build log:



docs/archive/root-history/

docs/archive/build-logs/2026-03-31/



Phase 3 進捗追記: reaction-diffusion 系の procedural grouping / quick preset / controls 同期を実施。cellular_front と biofilm_skin に quick preset を追加し、procedural panel で reaction family controls と guide-aware reset source が機能するようにした。

Phase 4 追加進捗（2026-03-31, snapshot-first continuation）

今回の差分では、Phase 4 の残りを scene subsystem 個別内部でも同じ routing plan を使う 方向で前進させた。

実施

lib/sceneRenderRouting.ts

LayerSceneRenderPlan

GpgpuRenderOutputPlan を追加

Layer 2 / 3 について、particle / procedural / hybrid / glyph / aux / spark / connection / ghost trail の scene branch を単一 plan として返すようにした

GPGPU について、point / instanced / trail / ribbon / tube / streak / smooth tube / metaball / volumetric の output 判定を単一 plan として返すようにした

components/AppSceneLayerContent.tsx は Layer 2 / 3 と GPGPU の描画条件を plan 参照へ変更

components/gpgpuRenderOutputs.tsx は GPGPU output branch を plan 参照へ変更

lib/renderModeRegistry.ts は GPGPU active 判定を plan 参照へ変更

意味

これにより、Phase 4 の capability-aware routing は



manifest

diagnostics

render mode summary

scene family selection

GPGPU output rendering



で同じ routing / branch 語彙を共有する状態にさらに近づいた。

進捗目安

正式ロードマップ全体: 約 78%

Phase 4 単体: 約 76%



残りの中心課題は、scene subsystem 内部にまだ残る個別 config 解釈と、manifest / export 側への scene branch plan のさらなる反映である。



Phase 4 update: manifest execution entries now include sceneBranches, and procedural scene subsystem mode reads are routed through getLayerRuntimeMode() so exported routing, UI cards, and subsystem profile selection use the same mode vocabulary.



Phase 4 continuation: subsystem runtime setting reads now extend beyond mode/source/material/color/radiusScale into temporal, line style, deposition, patch, growth, and fog snapshots. useAppSceneTemporalConfig, sceneLineSystemRuntime, sceneDepositionFieldSystem, sceneGrowthFieldSystem*, sceneSurfacePatchSystemShared, and sceneVolumeFogSystemRuntime now resolve more of their runtime state through lib/sceneRenderRouting.ts.



Phase 4 continuation: sceneRenderRouting now owns source-layout-aware runtime snapshots and particle-layout dependency assembly for more subsystems. Crystal aggregate / crystal deposition / voxel lattice / erosion trail / brush surface config now read source, sourceCount, sourceSpread, density, opacity, materialStyle, and radiusScale through shared helpers instead of repeating raw config.layer2* / config.layer3* lookups.



Phase 4 progress estimate update: 正式ロードマップ全体 約86%、Phase 4 単体 約95%。残る主課題は subsystem 内にまだ残る一部 source-specific tuning の helper 化、manifest/export 側の runtime snapshot 反映の詰め、build 完走確認。



Phase 4 continuation: particle core runtime reads are now routed through shared snapshots. sceneParticleSystemShared, sceneParticleSystemRender, particleData, and sceneParticleSystem now consume routing-owned particle field / visual / SDF / ghost-trail helpers, eliminating direct config.layer2* / config.layer3* reads inside those target files.



Phase 4 progress estimate update: 正式ロードマップ全体 約88%、Phase 4 単体 約98%。残る主課題は build 完走確認、manifest/export 側の最終同期整理、一部 routing builder 側の historical raw branching の整理。



Phase 5 drift report: npm run generate:phase5-drift-report



Phase 5 now checks project fingerprint stability across parse/serialize/parse round-trips, not only counts.



Phase 5 追補: docs/archive/phase5-import-report.json を追加し、replace / merge 両モードでの exact preset / sequence ID change、duplicate source ID の可視化、orphan drop を fixture ごとに固定した。



Phase 5 追補: docs/archive/phase5-import-report.json に compareSummary / aggregateSummary を追加し、fixture ごとの retain / remap / drop / payload-preserve 件数を比較しやすくした。



docs/archive/phase5-real-export-readiness-report.json を追加し、optional real-export fixture の failure reason を invalid-json / invalid-project-payload / manifest-entry-missing / manifest-sha256-drift / manifest-metadata-drift / roundtrip-drift に細分化した。さらに statusCounts、metadata drift fields、round-trip drift fields を entry ごとに持てるようにした。



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

2026-11-08 追加（Phase 5 完了後の現状 — ライブラリアップグレードと Play タブ時代）



本書の Phase 5 完了判定はそのまま維持する。これ以降の作業は UPDATE_LOG.md が正本であり、本節はその要約である。



基盤アップグレード（2026-11-07）: React 19.3 / @react-three/fiber 9.8 / drei 10.7 / three 0.187 / Vite 8.3 / TypeScript 5.9.3。engines node>=20 と .nvmrc を追加。verify:phase5 が落ちていた duplicate-ids fixture は、parseProjectData を lossless 化し防御的処理を loadProjectData 側へ移す修正を本採用し、verify:phase5 は 11/11 PASS に復帰（既知のテスト失敗はゼロ）。TypeScript は strict: true、noUnusedLocals/Parameters 採用、ESLint は 0 errors / 0 warnings を自己防衛付きで維持。package.json version は 1.0.0。



表現ロードマップ Phase 6〜9（Play タブ新設）: プリセット棚・マクロつまみ8種・表現マップ・パネル階層（Play/Design/Lab）・プリセット交配・パラメータ検索（359件）＋XYパッド・履歴フィルムストリップ・CSV/JSON データソース・MIDI/OSC 制御（OSC は tools/osc-bridge の Node リレー経由）・カメラ入力・ソース位置エディタ・演奏記録・モノクロテクスチャパック・PLY/SVG 書き出し・GPGPU シード決定性。色は付けない（モノクロ専用）方針を 2026-11-08 に確定。



「究極」候補（2026-11-08）: モジュレーション・エンジン、Stage モード（A/B デッキ＋クロスフェーダ）、プリセット類似マップ、GPU フィードバック（実フレーム再帰）、決定的レンダリング（固定ステップ PNG 連番 → WebCodecs で WebM/MP4 動画までアプリ内完結）、カスタム GLSL フォース（コンパイル検査付き）、ノードグラフ表示/編集、カバレッジ補完ジェネレータ、万華鏡/スリットスキャンのポスト効果、クリーン出力ウィンドウ、コマンドパレット（⌘K）、言葉からプリセット生成（ローカル解釈）。



運用状態: Drive の monosphere が正本で、作業は git 管理コピーで行い承認後に反映する手順を継続。バックアップ monosphere-backup-20261107 は、利用者の Intel iMac（macOS Sequoia）での起動確認が済むまで保持する。WebGPU 全面移行は iMac 実機での性能測定を前提に保留中。



## 2026-11-08 追記（進捗総括の追加）



同日付までの全進捗（基盤刷新、Play タブ Phase 6–9、コード衛生、拡張群、究極候補、その他の拡張、シェーダー欠陥3件の修正、GPU監査と verify:shaders 常設化）を総括した文書 PROGRESS_SUMMARY_20261108.md を monosphere ルートに追加しました。Drive とローカル git は完全同期（HEAD fa6a3c5、コミット総数76）、全ゲート合格、未反映バッチはありません。残る主要項目は iMac 実機での起動確認（11項目チェックリスト）で、バックアップ monosphere-backup-20261107 は確認まで保持します。



## 2026-11-11 追記（現状総括 — AI連携・カタログ727件・フォローオンプログラム）



本書の Phase 4 / Phase 5 完了判定はそのまま維持する。本節が現在の正本であり、個別作業の詳細は各 IMPL_REPORT（Drive ルート）と UPDATE_LOG.md が正本である。



本番状態: https://monosphere.pages.dev/（Cloudflare Pages、Direct Upload 運用）。現在の本番デプロイは 24928640（2026-11-11、衛生項目の反映）。生成プリセットのカタログは 727 件（719 件＋ Tube Lite SS 8 件）で、/catalog/ と各プリセットの /presets/ JSON、/share/ ページが本番稼働している。



2026-11-09〜10 の到達点: AI タブ（自然言語指示→パラメータ調整＋プリセット生成、Groq / Gemini 切替リレー /api/ai、BYOK 対応）、自由配線 Stage 4（任意 DAG＋位置フィードバック）、理論系プリセット 27 件のカタログ統合（692→719 件）、Basic / Pro 簡易モード、プリセット部分適用、進化ラボ、パラメータタイムライン等（2026-11-11 の 11 項目プログラムで完了）。



小物修正バンドル（デプロイ ae28ae98）: FHN 表示ゲイン layer2ReactionFhnGain / layer3ReactionFhnGain を追加（既定 1.0 ＝従来表示そのもの、範囲 0.2–4.0）。あわせてプリセットライブラリ保存の堅牢化: スターターライブラリの完全形は約 910 万文字で保存上限（400 万文字）と localStorage 容量の双方を超え、従来は保存が常に無言で失敗していた。DEFAULT_CONFIG との差分のみを保存する無損失圧縮（約 36.6 万文字）＋書き込み後検証に改め、失敗時は棚に日本語で通知する。



Physarum 球面の極圧縮修正（デプロイ 61b29bb7）: 表示側のみ等面積（Lambert 円筒等面積式）緯度リマップを適用し、極付近の過密を解消。シミュレーション本体とシート表示は不変。



AI 制御カタログ拡張（デプロイ cf9f9cb5）: AI が操作できるキーは実測 84 件から 304 件へ拡張（従来言われていた 103 件は実測と不一致だった）。PARAMETER_CATALOG は 397 件。リレーのメッセージ切断（9,000 文字→ 1 件 40,000 文字 / 合計 90,000 文字）も修正した。残存制約: Groq 無料枠の TPM 8,000 では全カタログプロンプトが 413 となり、設計どおり Gemini へ自動フォールバックする。



可読性 Phase 4（デプロイ 401ff282）: デッキ内 9–11px 級ラベルを 11px 下限へ引き上げ、主要ラベルに日本語の二重ラベル（グロス）を併記した。



重量プリセット残件（デプロイ 55275d64）: Tube Lite S で 10fps 未満だった 10 件は、コード最適化 3 件と Lite SS 変種 8 件の新設により全件 10fps 以上に到達。あわせて MAX_GPGPU_TEX_SIZE=512 の上限を導入し、Coverage 456 で起きていた WebGL コンテキスト喪失の連鎖を解消した。



/api/ai の厳密レート制限（KV バインド Worker 化）は BLOCKED（未適用）: 登録済み Cloudflare トークンに Workers Scripts の編集権限が無く（Workers スクリプト PUT が 403、KV 一覧が 401）、本番は Phase 3 のアイソレート内制限（8 回/60 秒＋20 回/10 分、429＋Retry-After）のままである。制限 Worker 一式（Durable Objects 実装、テスト 19/19）とデプロイ手順書は project/relay/ に完成済みで、権限が 1 つ追加されれば即適用できる。



中止が決まった項目: WebGPU への全面移行と GitHub 公開は、利用者が 2026-11-11 に中止を決定したため対象外（WebGPU は性能上の必然性が無いことも 2026-11-10 の A/B 計測で確認済み）。



衛生（2026-11-11、デプロイ 24928640）: 死にキー layer2Opacity / layer3Opacity / layer2ParticleGlow（ParticleConfig にも DEFAULT_CONFIG にも存在せず、描画・UI・AI のいずれからも読まれない書き込み専用キー）を、全プリセットプールと本番 /presets/*.json から計 6,302 件除去した。発生源である operator suffix 辞書の Opacity / ParticleGlow エントリも除去し、スターターライブラリ全 444 件の config が正規キー範囲に収まることを実行検証した。Drive 側の stray 2 件（ルート直下の sceneVolumetricFieldSystem.tsx.bak-20261109 と、fixtures/project-state 直下の重複 phase5-legacy-v24.json）はゴミ箱へ移動した（完全削除ではない）。詳細は HYGIENE_IMPL_REPORT_20261111.md。



文書の正本について: 本書の Drive 版（Google ドキュメント）とローカル Markdown 版は、2026-11-11 の照合で内容同一（差異は番号付きリストの表記のみ）であることを確認した。以後はローカル Markdown を正本として更新し、Drive へ反映する。
