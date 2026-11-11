IMPLEMENTATION_PLAN_AND_PROGRESS_shaping28

scope

sceneGlyphOutlineSystem.tsx と sceneSurfacePatchSystem.tsx を source-aware / cross-family aware にして、



text: contour_echo / glyph_weave / shell_script / ink_bleed の plate / weave / inscription 差

grid: contour_echo / tremor_lattice / static_lace / calcified_skin の relief / line / shell 差 を source 固定でも潰れにくい状態へさらに圧縮した。 今回は renderer 差分に加えて、review 用 anchor / hybrid / starter も追加した。

executed

lib/sourceAwareShaping.ts



GlyphLike / PatchLike を追加した。

追加関数:

withSourceAwareGlyphProfile()

withCrossFamilyGlyphProfile()

withSourceAwarePatchProfile()

withCrossFamilyPatchProfile()

主な補正:

text:glyph_weave の outline copies / quantize / tint を強化

text:shell_script の gate / shear / inscription hold を強化

text:contour_echo の plate spread / flattening を強化

grid:contour_echo / standing_interference / tremor_lattice の contour / shear / planar hold を強化



components/sceneGlyphOutlineSystem.tsx



getLayerSource() を参照するように変更した。

profile を

withSourceAwareGlyphProfile()

withCrossFamilyGlyphProfile() の合成に変更した。

blendMode を追加し、text inscription 系が additive 一辺倒にならないようにした。

これで text 固定時に

contour_echo

shell_script

glyph_weave

ink_bleed

drift_glyph_dust の線差が前より分かれやすくなった。



components/sceneSurfacePatchSystem.tsx



getLayerSource() を参照するように変更した。

patch profile を

withSourceAwarePatchProfile()

withCrossFamilyPatchProfile() の合成に変更した。

blendMode を追加し、text / grid の plate 系を NormalBlending 寄りにできるようにした。

これで

text: contour_echo

grid: contour_echo / standing_interference / tremor_lattice の plate / relief 差が source 固定でも潰れにくくなった。



lib/expressionAtlasBundles.ts



review anchor を追加

review-text-plate-weave-anchor

review-grid-relief-line-anchor

review-grid-relief-shell-anchor



lib/hybridExpressions.ts



review hybrid を追加

review-text-plate-weave-split

review-grid-relief-line-split

review-grid-relief-shell-split



lib/hybridTemporalVariants.ts



review temporal を追加

review-text-plate-weave-trace

review-grid-relief-line-hold

review-grid-relief-shell-hold



lib/starterLibrary.ts



starter preset を追加

starter-review-text-plate-weave-split

starter-review-grid-relief-line-split

starter-review-grid-relief-shell-split

sequence も追加した。

これで direct starter count は次まで増えた。

glyph_weave: 4 -> 5

contour_echo: 5 -> 7

static_lace: 5 -> 6

calcified_skin: 7 -> 8

tremor_lattice: 0 -> 2

verification

npm ci passed

npm run typecheck passed

npm run build passed

build output

dist/assets/index-xK6O3lIg.js 987.07 kB

dist/assets/particleDataWorker-D3QPnpvr.js 142.77 kB

dist/assets/index-CiiugB3f.css 52.80 kB

direct starter counts

glyph_weave: 5

stipple_field: 3

contour_echo: 7

shell_script: 16

tremor_lattice: 2

static_lace: 6

calcified_skin: 8

next

次に効くのは、今回追加した review preset を基準にして、



text での shell_script と ink_bleed の受け皿差 / inscription 差

grid での tremor_lattice と static_lace の line-vs-relief 差 を、sceneDepositionFieldSystem.tsx と sceneLineSystem.tsx 側でさらに局所圧縮すること。 特に text の 2D plate / sheet / outline と、grid の lattice / lace / crust の境界をさらに削れる。
