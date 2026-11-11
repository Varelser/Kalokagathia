IMPLEMENTATION_PLAN_AND_PROGRESS_shaping27

scope

glyph_weave と stipple_field の見本密度不足を埋めつつ、 text / grid の 2D 系 residual collision を局所的にさらに離す。 今回は renderer の cross-family 補正と、review 用 bundle / hybrid / starter の両方を追加した。

executed

lib/sourceAwareShaping.ts



text:glyph_weave の line / fiber cross-family 補正を強化した。

line: planarBias, gateThreshold, widthMul, shimmerMul を追加補正

fiber: planarPull, quantize, bandMix, gateAmount, alphaMul を追加補正

grid:stipple_field の deposition cross-family 補正を強化した。

bandsMul, bandWarp, glyphGrid, contourMix, sootStain, velvetMatte

目的は、text では glyph_weave を shell_script / drift_glyph_dust / contour_echo から、 grid では stipple_field を static_lace / calcified_skin / deposition_field からさらに離すこと。



lib/expressionAtlasBundles.ts



review anchor を追加

review-text-glyph-density-anchor

review-grid-stipple-density-anchor



lib/hybridExpressions.ts



review hybrid を追加

review-text-glyph-density-split

review-grid-stipple-density-split



lib/hybridTemporalVariants.ts



review temporal を追加

review-text-glyph-density-trace

review-grid-stipple-density-hold



lib/starterLibrary.ts



starter preset を追加

starter-text-glyph-weave-codex

starter-text-glyph-weave-palimpsest

starter-grid-stipple-ledger

starter-grid-stipple-calcify

sequence も追加した。

これで direct starter count は

glyph_weave: 2 -> 4

stipple_field: 1 -> 3 まで増えた。

verification

npm ci passed

npm run typecheck passed

npm run build passed

build output

dist/assets/index-CkIXrI_5.js 976.18 kB

dist/assets/particleDataWorker-BfbWhHAo.js 140.82 kB

dist/assets/index-CiiugB3f.css 52.80 kB

direct starter counts

glyph_weave: 4

stipple_field: 3

contour_echo: 5

shell_script: 16

drift_glyph_dust: 9

calcified_skin: 7

static_lace: 5

next

次は、追加した review preset を基準にして、



text: contour_echo / glyph_weave / shell_script の plate-vs-weave-vs-inscription 差

grid: stipple_field / static_lace / calcified_skin の relief-vs-line-vs-shell 差 を renderer 側でさらに局所圧縮するのが自然。 特に sceneGlyphOutlineSystem.tsx と sceneSurfacePatchSystem.tsx を触ると効く。
