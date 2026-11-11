IMPLEMENTATION PLAN AND PROGRESS — shaping16

今回の目的

前段の line / glyph-outline / sigil 強化に続き、差がまだ甘かった次の群を詰める。



ribbon_veil

liquid_smear

growth_field

branch_propagation

biofilm_skin



今回は renderer の実差分だけで終わらせず、depictionArchitecture、atlas bundle、hybrid、temporal variant、starter preset まで同期させる。





実施内容

1. Brush renderer の profile 化

対象:



components/sceneBrushSurfaceSystem.tsx — 483行 / 15.8 KB



実施:



BrushProfile 新設

brush_surface / ribbon_veil / mist_ribbon / liquid_smear / vortex_sheet に専用 profile を追加

group rotation / plane drift / scale / squash / shear を mode ごとに分離

shader uniform を追加

uTrailShear

uVeilCurve

uBleedWarp

uEdgeSoftness

uStreakFreq

uTearFreq

uBandFreq

uAlphaMul

liquid_smear のみ NormalBlending 寄りにして、加算一辺倒を避けた



効果:



ribbon_veil は薄い層幕・吊られた帯・z方向オフセットが強くなった

mist_ribbon はさらに薄く、霧的でフェードが強い

liquid_smear は引きずり・滲み・刷毛ムラが強い





2. Growth renderer の専用 shaping 強化

対象:



components/sceneGrowthFieldSystem.tsx — 347行 / 13.7 KB



実施:



GrowthProfile 新設

trunk / branch / twig の階層構造を導入

maxStrandCount ベースに切り替え、枝 + 小枝の可変 drawRange に対応

branch ごとに deterministic な twig 生成を追加

shader uniform を追加

uTipGlow

uBarkBands

uGateFreq

uAlphaMul



効果:



growth_field の専用 renderer が、単なる trunk + side branch から 幹 → 枝 → 小枝 の階層へ進んだ

tip だけが光るため、先端密度の見え方が改善した

幹の縞と gate により、成長線の面白みが出た





3. branch_propagation の経路補正と fiber 側の差分強化

対象:



components/sceneFiberFieldSystem.tsx — 250行 / 11.0 KB



確認:



branch_propagation は GrowthFieldSystem ではなく FiberFieldSystem 経路だった



実施:



density / curl / length に branch_propagation 専用係数を追加

arborDepth / arborSpread / arborLift を導入

endpoint 生成時に arbor bias を加え、分岐骨格っぽさを強化



効果:



既存の mesh / thread 系との差が増えた

branch_propagation が単なる糸群より、樹状の armature として見えやすくなった





4. biofilm_skin の実経路に合わせて reaction-diffusion を強化

対象:



components/sceneReactionDiffusionSystem.tsx — 395行 / 14.0 KB



確認:



biofilm_skin は ReactionDiffusionSystem 経路だった



実施:



ReactionProfile 新設

reaction_diffusion / biofilm_skin を profile 分離

biofilm_skin 専用に seed texture を変更

群体 blob

rim

trail

cell grain

shader uniform を追加

flowAniso

poolMix

colonyBands

cellScale

contourTightness

hueShift

lightnessShift

mode 切替時に reseed するよう修正



効果:



biofilm_skin が従来の generic reaction plate ではなく 群体膜 / 培地 / 反応縞 / pooled colony として見えやすくなった





5. depictionArchitecture の補正

対象:



lib/depictionArchitecture.ts — 138行 / 17.3 KB



更新:



growth_field

ribbon_veil

liquid_smear

branch_propagation

biofilm_skin



主な変更:



shapingFocus

contrastAxis

spatial signature 文言





6. atlas / hybrid / temporal / starter の同期

対象:



lib/expressionAtlasBundles.ts — 257行 / 12.9 KB

lib/hybridExpressions.ts — 308行 / 12.7 KB

lib/hybridTemporalVariants.ts — 406行 / 13.0 KB

lib/starterLibrary.ts — 3984行 / 135.8 KB



追加 atlas bundles:



ring-ribbon-manifold

image-liquid-smear-canvas

sphere-branch-arbor

plane-biofilm-petri



追加 hybrid:



ribbon-biofilm

branch-smear



追加 temporal:



ribbon-biofilm-creep

branch-smear-propagate



追加 starter presets:



starter-ribbon-biofilm-petri

starter-liquid-smear-canvas

starter-branch-arbor-growth



追加 starter sequences:



starter-sequence-ribbon-biofilm-petri

starter-sequence-liquid-smear-canvas

starter-sequence-branch-arbor-growth





検証

実行:



npm ci

npm run typecheck

npm run build



結果:



typecheck 通過

build 通過



主な build 出力:



dist/assets/index-BuNDsZnP.js 878.07 kB

dist/assets/index-B8FfSG2b.css 52.78 kB

dist/assets/particleDataWorker-CYRoedfj.js 117.87 kB





今回の改善ポイント

見た目差が増したもの

ribbon_veil

mist_ribbon

liquid_smear

growth_field

branch_propagation

biofilm_skin

starter 内の出現数（簡易カウント）

ribbon_veil: 2

liquid_smear: 3

branch_propagation: 2

biofilm_skin: 2

growth_field: 4





次の本命

次に詰めるべきは以下。



sceneSurfaceShellSystem.tsx の membrane_pollen / spore_halo / halo_bloom の差の再圧縮

sceneVolumeFogSystem.tsx と sceneDepositionFieldSystem.tsx の cross-family 接続強化

controlPanelProceduralModeSettings.tsx に profile / architecture の差分を可視化する小ラベル追加

starter preset の mode coverage を 1本 → 2本へ揃える底上げ
