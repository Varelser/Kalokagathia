IMPLEMENTATION_PLAN_AND_PROGRESS_shaping10

目的

今回の主目的は、新規 mode の追加ではなく、既存 procedural mode 群の差の最終詰め、見本密度の極限強化、そして depictionArchitecture と各 renderer の専用 shaping 強化を、破綻しない順番で進めることです。



対象は次の3点です。



見た目差がまだ弱い procedural mode の専用分岐強化

atlas / hybrid / starter preset の密度増強

architecture 側の定義を「分類」から「描写設計台帳」へ拡張





現状監査で分かったこと

1. renderer ごとの「専用差分」密度に偏りがある

以下は、proceduralModeRegistry.ts に登録されている mode 数に対して、各 renderer 内で mode 名が明示的に分岐・調整されている数です。



membrane: 0 / 1

surface-shell: 6 / 11

surface-patch: 2 / 5

brush-surface: 3 / 5

fiber-field: 8 / 13

growth-field: 0 / 1

deposition-field: 4 / 5

reaction-diffusion: 0 / 2

volume-fog: 8 / 15

crystal-aggregate: 1 / 7

voxel-lattice: 1 / 5

crystal-deposition: 0 / 1

erosion-trail: 0 / 1



これは「動かない」という意味ではなく、mode ごとの見た目差がまだ renderer 内で十分に専用化されていないという意味です。



特に優先度が高いのは次の5系統です。



sceneCrystalAggregateSystem.tsx

sceneVoxelLatticeSystem.tsx

sceneSurfaceShellSystem.tsx

sceneVolumeFogSystem.tsx

sceneFiberFieldSystem.tsx

2. 見本密度にムラがある

starterLibrary.ts 上で procedural mode の starter preset 数を確認すると、以下の mode は0本でした。



contour_echo

ember_drift

ion_rain

mesh_weave

ribbon_veil

stipple_field



また、1本しかない mode も多数あります。



このため、機能として存在していても、ユーザーが「何が差なのか」を最短で把握できる見本密度がまだ不足しています。

3. atlas / hybrid 側でも未接続 mode が残る

expressionAtlasBundles.ts / hybridExpressions.ts / hybridTemporalVariants.ts を見ると、少なくとも以下の mode は参照ゼロでした。



biofilm_skin

branch_propagation

cinder_web

ember_drift

ember_lace

ember_swarm

foam_drift

fracture_bloom

fracture_pollen

glyph_weave

lattice_surge

mirror_skin

nerve_web

seep_fracture

standing_interference

static_lace

stipple_field

tremor_lattice

vapor_canopy

vortex_sheet



つまり、存在する mode の一部が、見本束・複合束・時間変化束にまだ入っていない状態です。

4. depictionArchitecture.ts は分類としては有効だが、shaping 台帳としてはまだ薄い

現状の DepictionArchitecture は次の3項目です。



depictionClass

renderPrimitive

editBias



これは「分類」には十分ですが、差の最終詰めには足りません。



今後は少なくとも次を持つ必要があります。



rendererId

shapeProfileId

sourceAffinity

materialAffinity

silhouettePriority

densityProfile

contrastAxes

recommendedParamFocus

samplePresetTargets





実行順序

Phase 1: 差の最終詰め（最優先）

目的

既存 mode を「選べる」だけでなく、見てすぐ区別できるところまで持っていく。

1-1. Surface shell 系の専用 shaping 強化

対象 file:



components/sceneSurfaceShellSystem.tsx



対象 mode:



mirror_skin

shell_script

eclipse_halo

resin_shell

併せて surface_shell の基準差も明文化



実装内容:



mirror_skin: 反転寄りの揺らぎ、低 jitter、高 fresnel、鏡面寄り opacity

shell_script: text/grid source の輪郭追従、script 的 banding、局所的な表面線痕

eclipse_halo: halo 半径の外周強調、中心減衰、輪光優先

resin_shell: 低周波うねり、樹脂的な厚み、濁りと内部封入感



完了条件:



shell 系 11 mode すべてに renderer 内で明示差分が入る

1-2. Fiber 系の専用 shaping 強化

対象 file:



components/sceneFiberFieldSystem.tsx



対象 mode:



branch_propagation

static_lace

prism_threads

glyph_weave

fiber_field 基準形の明示化



実装内容:



branch_propagation: 幹→枝の長短差、先端細化、分岐角制御

static_lace: 動きを弱め、密度と局所交差を増やし lace 化

prism_threads: 彩度より位相差と屈折感、thread ごとの spectral offset

glyph_weave: text/image source に対する輪郭追従と縫い込み感



完了条件:



fiber 系 13 mode のうち、少なくとも 12 mode で専用分岐が入る

1-3. Volume fog 系の専用 shaping 強化

対象 file:



components/sceneVolumeFogSystem.tsx



対象 mode:



vapor_canopy

ion_rain

velvet_ash

static_smoke

ember_drift

volume_fog 基準形の明示化



実装内容:



vapor_canopy: 天蓋状の上下差、上層密度集中、層流感

ion_rain: 縦方向 streak、降下 anisotropy、帯電発光

velvet_ash: 粒状の鈍い散乱、重力寄り沈降、低 glow

static_smoke: 流れを抑え、局所ノイズのみで停滞感を作る

ember_drift: 微発光粒の混入、熱上昇と灰落下の二相化



完了条件:



fog 系 15 mode のうち、少なくとも 13 mode に専用差が入る

1-4. Crystal / Voxel 系の専用 shaping 強化

対象 files:



components/sceneCrystalAggregateSystem.tsx

components/sceneVoxelLatticeSystem.tsx



対象 mode:



crystal 側: fracture_pollen, bloom_spores, pollen_storm, orbit_fracture, fracture_bloom, crystal_aggregate

voxel 側: frost_lattice, pollen_lattice, lattice_surge, voxel_lattice



実装内容:



fracture_pollen: 粒化・破断・軽量散布

bloom_spores: 小粒高密度・生物寄り cluster

pollen_storm: 大きな spread と風偏り

orbit_fracture: 周回軌道上に破片を配列

fracture_bloom: bloom と fracture の中間、中心凝集 + 外周破断

frost_lattice: 霜柱的な細セル、snap 強化

pollen_lattice: 粒の付着した格子、セルごとの欠損

lattice_surge: 波打つ格子、周期変形



完了条件:



crystal 系 7 mode と voxel 系 5 mode で専用差が視認可能になる

1-5. Patch / Brush / Deposition / Reaction の差詰め

対象 files:



components/sceneSurfacePatchSystem.tsx

components/sceneBrushSurfaceSystem.tsx

components/sceneDepositionFieldSystem.tsx

components/sceneReactionDiffusionSystem.tsx



重点 mode:



standing_interference

tremor_lattice

vortex_sheet

seep_fracture

biofilm_skin

それぞれの基準 mode



実装内容:



standing_interference: 周期帯と節の固定化

tremor_lattice: 微振動で格子波紋化

vortex_sheet: 面の中心渦、せん断回転

seep_fracture: 滲み + 割れ目

biofilm_skin: 有機膜状の feed/kill 偏り



完了条件:



専用 shaping 未実装モードをほぼ解消する





Phase 2: depictionArchitecture の拡張

目的

分類辞書から、描写設計の単一台帳に引き上げる。

新設または拡張する要素

対象 file:



lib/depictionArchitecture.ts

必要なら lib/depictionShapingProfiles.ts を新設



追加項目案:



rendererId

shapeProfileId

sourceAffinity: Layer3Source[]

materialAffinity: MaterialStyle[]

silhouettePriority: 'outline' | 'surface' | 'volume' | 'thread' | 'fragment'

densityProfile: 'sparse' | 'mid' | 'dense' | 'layered' | 'clustered'

contrastAxes: string[]

recommendedParamFocus: string[]

samplePresetTargets: string[]

役割

AppScene の routing 判定

control panel の guide 自動生成

atlas bundle / starter preset の自動生成元

将来の mode 追加時の破綻防止



完了条件:



mode 追加時に architecture だけ更新すれば、renderer / UI / sample 設計の基礎が揃う状態に近づく





Phase 3: 見本密度の極限強化

目的

「何が違うのか」を見本で即理解できる状態にする。

最低達成ライン

全 procedural mode に対して:



starter preset 最低2本

sequence preset 最低1本

atlas / hybrid / temporal variant のいずれか 最低1回以上登場

最優先で増やす mode

現在 0 本のものから着手:



contour_echo

ember_drift

ion_rain

mesh_weave

ribbon_veil

stipple_field

増やし方

A. mode ごとの「基準見本」と「偏位見本」の2本化

例:



ion_rain



基準: vertical charge rain

偏位: prism ion curtain



mesh_weave



基準: balanced structural weave

偏位: canopy drift weave



ribbon_veil



基準: soft ribbon veil

偏位: torn shear ribbon

B. atlas bundle の増設

増設目標:



12 → 24 本



増やす方向:



mirror_skin

glyph_weave

lattice_surge

ember_drift

stipple_field

vortex_sheet

standing_interference

fracture_bloom

biofilm_skin

mesh_weave

ribbon_veil

ion_rain

C. hybrid recipe / temporal variant の増設

増設目標:



hybrid recipe: 27 → 40 以上

temporal variant: 39 → 60 以上



優先 recipe:



mirror-skin + glyph-weave

ion-rain + prism-threads

ember-drift + resin-shell

stipple-field + shell-script

biofilm-skin + pollen-lattice

fracture-bloom + eclipse-halo



完了条件:



0見本 mode をゼロにする

1見本 mode を大幅に減らす

atlas / hybrid の未接続 mode を大幅に削減する





Phase 4: UI と guide の同期

目的

強化した差が、control panel 側でも理解可能になるようにする。



対象 file:



components/controlPanelProceduralModeSettings.tsx



必要な修正:



現在の guide は基礎 procedural mode 寄りなので、拡張 mode に追随させる

depictionArchitecture 由来で label / summary / tips / ranges を出せるようにする

mode ごとに quick preset を 2 本ずつ持たせる設計へ寄せる



完了条件:



UI と renderer の差分が同じ語彙で説明される





実装順の結論

最優先から並べると、順番は次です。



sceneSurfaceShellSystem.tsx

sceneVolumeFogSystem.tsx

sceneCrystalAggregateSystem.tsx

sceneVoxelLatticeSystem.tsx

sceneFiberFieldSystem.tsx

sceneSurfacePatchSystem.tsx

sceneBrushSurfaceSystem.tsx

sceneDepositionFieldSystem.tsx

sceneReactionDiffusionSystem.tsx

lib/depictionArchitecture.ts 拡張

starterLibrary.ts の 0見本 mode 解消

atlas / hybrid / temporal variant 密度強化

controlPanelProceduralModeSettings.tsx の同期





直近の実装着手点

次に実際にコードを進めるなら、最初の着手点はこれです。

Step A

sceneSurfaceShellSystem.tsx

sceneVolumeFogSystem.tsx



理由:



差が視覚的に最も分かりやすく、改善効果が大きい

mirror_skin, shell_script, eclipse_halo, resin_shell, ion_rain, velvet_ash, static_smoke, ember_drift は「名前に対して見本差が必要」な mode だから

Step B

sceneCrystalAggregateSystem.tsx

sceneVoxelLatticeSystem.tsx



理由:



現状の explicit shaping 密度が最も低い

mode 数の割に見た目差がまだ renderer 側で薄い

Step C

0見本 mode 6種の starter preset を 2 本ずつ追加



理由:



「何が違うか」を最短で把握できる効果が高い





成功判定 KPI

renderer explicit shaping coverage を主要系で 80%以上へ

starter preset 0本 mode を 0 件へ

starter preset 1本 mode を大幅削減

atlas / hybrid / temporal 参照ゼロ mode を大幅削減

shell / fog / crystal / voxel / fiber の5系統で、mode名を隠しても見分けやすくなる
