IMPLEMENTATION_PLAN_AND_PROGRESS_shaping22

概要

今回は mesh-line 側の最終圧縮として、static_lace / signal_braid / cinder_web / spectral_mesh を中心に強化した。



重点は以下の3点。



sceneFiberFieldSystem.tsx の profile 化を進め、geometry と shader の両方で差を立てる

sceneLineSystem.tsx に未定義だった mesh-line 系 profile を追加する

atlas / hybrid / temporal / starter を同期させ、renderer だけ強い状態を避ける

実施内容

1. Fiber renderer の専用 shaping 強化

対象: components/sceneFiberFieldSystem.tsx

397行 / 18.9 KB



追加した FiberProfile 軸:



densityBoost

lengthBase

curlBoost

tangentStretch

normalBias / bitangentBias / seedBias

verticalBias / radialLift / radialPull / planarPull

curtainAmount / braidAmount / quantize

waveAmplitude / waveFrequency / phaseSpeed

glow / bandFrequency / bandMix / prismAmount / gateAmount

shimmerScale / pulseMix / alphaMul / charAmount



これにより以下の差を明確化した。



static_lace



quantize

planar pull

高周波 band / gate

static 的 breakups



signal_braid



braid crossings

pulse-gated wave

radial lift

高発光の signal cadence



cinder_web



short web

char darkening

ember seam

inward pull



spectral_mesh



prism split

shimmer

spectral banding

longer tangent weave



material blending も mode に応じて変え、static_lace / cinder_web / mesh_weave は NormalBlending 寄りにした。

2. Line renderer の不足 profile を追加

対象: components/sceneLineSystem.tsx

520行 / 28.6 KB



追加した mode:



static_lace

signal_braid

cinder_web



既存 spectral_mesh も更新した。



これで line 側でも、



lace の grid-like breakup

signal braid の gated pulse

cinder web の dark short web

spectral mesh の shimmer が出るようにした。

3. depictionArchitecture 更新

対象: lib/depictionArchitecture.ts

138行 / 17.6 KB



更新:



static_lace

signal_braid

cinder_web

spectral_mesh



今回の renderer 実装に合わせ、spatialSignature / shapingFocus / contrastAxis を具体化した。

4. atlas bundle 追加

対象: lib/expressionAtlasBundles.ts

430行 / 22.2 KB



追加:



grid-static-signal-lace

text-cinder-codex-web

ring-spectral-braid

5. hybrid / temporal 追加

対象: lib/hybridExpressions.ts

396行 / 16.4 KB

対象: lib/hybridTemporalVariants.ts

494行 / 15.8 KB



追加:



static-signal-lace

cinder-codex-web

static-signal-oscillation

cinder-codex-shed

6. starter 見本追加

対象: lib/starterLibrary.ts

4388行 / 152.4 KB



追加 preset:



starter-static-signal-lace

starter-cinder-codex-web

starter-spectral-braid-cylinder



追加 sequence:



starter-sequence-static-signal-lace

starter-sequence-cinder-codex-web

starter-sequence-spectral-braid-cylinder

検証

npm ci 通過

npm run typecheck 通過

npm run build 通過

build 出力

dist/assets/index-BWYvCOdr.js 923.04 kB

dist/assets/particleDataWorker-7MSzhJpt.js 126.09 kB

dist/assets/index-CiiugB3f.css 52.80 kB

見本密度

starter 内の direct type count。



static_lace: 2

signal_braid: 5

cinder_web: 3

spectral_mesh: 6

現時点の意味

今回で mesh-line 系は、



fiber geometry

line scoring / gating

atlas/hybrid

starter density の4層が揃った。



次に効くのは、これまで強化した各 family を横断して、 同 source でも family ごとの差がどれだけ出るか を比較しながら、source-aware shaping を詰める工程。



具体的には、



text 起点の glyph / shell / fiber の差

grid 起点の lace / lattice / contour の差

ring 起点の halo / orbit / braid の差 の横比較が次段階として自然。
