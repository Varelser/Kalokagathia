IMPLEMENTATION PLAN AND PROGRESS — shaping21

目的

volumetric と deposition の接続差をさらに詰めるため、以下を重点対象にした。



soot_veil

rune_smoke

velvet_ash

ink_bleed



狙いは、単に別々の mode を強くすることではなく、



soot_veil = 煤膜 / 帳面状の平たい煤気

rune_smoke = 記号ゲートを持つ符号霧

velvet_ash = 柔らかく密な受け皿灰

ink_bleed = それらを受けて染み込む版面 / 紙面



として、fog 側と deposition 側の接続差が見えるようにすること。





今回の実装

1. sceneVolumeFogSystem.tsx

新しい fog shaping 軸を追加。



sootAmount

runeAmount

velvetAmount

ledgerAmount



実装内容:



soot_veil に ledger band / matte char darkening / flat soot curtain を追加

rune_smoke に rune grid / gated symbol pulse / luminous coded smoke を追加

velvet_ash に matte velvet field / soft center / ash-receiving body を追加

fog color / alpha の両方で差が出るように修正

2. sceneDepositionFieldSystem.tsx

新しい deposition shaping 軸を追加。



sootStain

runeRetention

velvetMatte

vaporLift



実装内容:



ink_bleed に soot-fed stain / rune retention / vapor lift / matte absorption を追加

drift_glyph_dust / sigil_dust に rune retention を追加

deposition_field / seep_fracture に soot / vapor 方向の微補強を追加

vertex と fragment の両方で、受け皿としての変形と色差を追加

3. depictionArchitecture.ts

記述を renderer 実装へ同期。



更新対象:



soot_veil

rune_smoke

velvet_ash

ink_bleed

4. expressionAtlasBundles.ts

追加:



plane-velvet-ink-manuscript

text-rune-ledger-smoke

plane-soot-ink-ledger

5. hybridExpressions.ts

追加:



velvet-manuscript

rune-ledger

6. hybridTemporalVariants.ts

追加:



velvet-manuscript-sink

rune-ledger-oscillation

7. starterLibrary.ts

追加 preset:



starter-velvet-ink-manuscript

starter-rune-ledger-text

starter-soot-ink-ledger



追加 sequence:



starter-sequence-velvet-ink-manuscript

starter-sequence-rune-ledger-text

starter-sequence-soot-ink-ledger





検証

npm ci 通過

npm run typecheck 通過

npm run build 通過

build 出力

dist/assets/index-WUScHfOs.js 911.47 kB

dist/assets/particleDataWorker-IbJp1HPr.js 124.48 kB

dist/assets/index-B8FfSG2b.css 52.78 kB





更新ファイル

components/sceneVolumeFogSystem.tsx — 399行 / 22.1 KB

components/sceneDepositionFieldSystem.tsx — 377行 / 17.0 KB

lib/depictionArchitecture.ts — 138行 / 17.5 KB

lib/expressionAtlasBundles.ts — 398行 / 20.6 KB

lib/hybridExpressions.ts — 378行 / 15.6 KB

lib/hybridTemporalVariants.ts — 476行 / 15.2 KB

lib/starterLibrary.ts — 4320行 / 149.2 KB





見本密度

starter 直指定 count:



velvet_ash: 4

soot_veil: 5

rune_smoke: 6

ink_bleed: 7





状態判断

今回で、volumetric と deposition の境目にある



煤膜

記号霧

柔灰

吸い込み版面



の差はかなり強くなった。



次の自然な段階は、



signal_braid / static_lace / cinder_web / spectral_mesh の mesh-line 側の最終圧縮

prism_smoke / charge_veil / ion_rain / static_smoke の signal-volumetric 側の再統合

starter / atlas の重複整理と coverage table の自動生成



の順。
