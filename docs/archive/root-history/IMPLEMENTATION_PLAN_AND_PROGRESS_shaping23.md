IMPLEMENTATION PLAN AND PROGRESS — shaping23

Goal

source-aware shaping の導入。



前段までで mode ごとの差はかなり立ったが、同じ mode でも source が text / grid / ring / plane / cylinder などに変わると、 描写の重心が source 側に引っ張られて family 差が潰れる箇所が残っていた。



今回は特に mesh / line / thread 系 を対象に、



mode profile

source profile

starter / atlas の比較見本 を同時に導入した。





What changed

1. source-aware helper を追加

新規:



lib/sourceAwareShaping.ts



追加した内容:



getLayerSource(config, layerIndex)

withSourceAwareLineProfile(profile, source)

withSourceAwareFiberProfile(profile, source)



主な source 補正:



text:

planar / gate / quantize を強化

inscription / codex 的な平面拘束を増加

grid:

planar / quantize / band frequency を強化

architectonic な格子拘束を増加

ring:

radial bias / lift / pulse を強化

orbit / halo 的な円環性を増加

cylinder:

tangent stretch / braid を強化

thread / braid 的な軸方向性を増加

plane:

planar pull / matte softness を強化

manuscript / plate 的な受け皿性を増加





2. FiberFieldSystem を source-aware 化

更新:



components/sceneFiberFieldSystem.tsx



変更:



mode profile だけでなく、layer2Source / layer3Source を見て source-aware 補正を合成するよう変更

buildFiberLayout() の strand count 決定にも source-aware profile を反映



効果:



text + glyph_weave / shell_script 近傍 は planar / gate / quantize が強まり、字面に張り付きやすくなった

grid + static_lace / mesh_weave は格子拘束と banding が強まり、architectonic な張力が出る

ring + spectral_mesh / signal_braid は radial lift と pulse が増し、orbit 側の差が出やすくなった





3. LineSystem を source-aware 化

更新:



components/sceneLineSystem.tsx



変更:



mode profile に source-aware line profile を合成

candidate score の前提となる planarBias / radialBias / gate が source でも変わるようにした



効果:



text では glyph / inscription 側の間引き・接続の癖が強まる

grid では平面拘束と quantized connectivity が強まる

ring では radial coherence が増し、halo / orbit 側との差が潰れにくい





4. source 固定比較の atlas bundle を追加

更新:



lib/expressionAtlasBundles.ts



追加:



text-source-inscription-anchor

grid-source-architectonic-anchor

ring-source-orbit-anchor



意図:



source を固定したまま family 差を見るための比較アンカー

renderer 調整時に「source のせいでそう見えているのか / family の差でそう見えているのか」を切り分けやすくした





5. source 固定比較の starter preset を追加

更新:



lib/starterLibrary.ts



追加 preset:



starter-source-text-inscription-contrast

starter-source-grid-architectonic-contrast

starter-source-ring-orbit-contrast



追加 sequence:



starter-sequence-source-text-inscription-contrast

starter-sequence-source-grid-architectonic-contrast

starter-sequence-source-ring-orbit-contrast



意図:



text / grid / ring を固定して family 差を見るための実見本を増やす

「mode 差」ではなく「source 固定での mode 差」を観察できるようにする





Validation

npm ci ✅

npm run typecheck ✅

npm run build ✅



build output:



dist/assets/index-CnsFRjmk.js 929.78 kB

dist/assets/particleDataWorker-DxCYrZ4U.js 127.77 kB

dist/assets/index-CiiugB3f.css 52.80 kB





Updated files

components/sceneFiberFieldSystem.tsx — 401行 / 19.3 KB

components/sceneLineSystem.tsx — 522行 / 28.8 KB

lib/sourceAwareShaping.ts — 193行 / 4.8 KB

lib/expressionAtlasBundles.ts — 464行 / 24.5 KB

lib/starterLibrary.ts — 4456行 / 155.7 KB





Current result

今回で、mesh / line / thread 系は source で潰れにくい差がかなり入り始めた。 特に次の比較が見やすくなった。



text: shell/script/rune/glyph 系

grid: lace/lattice 系

ring: halo/spectral/braid 系





Next best step

次は同じ source-aware shaping を



sceneSurfaceShellSystem.tsx

sceneVolumeFogSystem.tsx

sceneDepositionFieldSystem.tsx へ広げること。



これで



text: shell_script / rune_smoke / drift_glyph_dust

grid: static_smoke / lattice_surge / sigil_dust

ring: halo_bloom / eclipse_halo / spectral_mesh の source 固定比較がさらに安定する。
