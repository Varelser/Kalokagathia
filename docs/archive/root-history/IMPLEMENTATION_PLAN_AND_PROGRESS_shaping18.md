IMPLEMENTATION PLAN AND PROGRESS — shaping18

focus

shell family の最終磨きとして、aura_shell / eclipse_halo / resin_shell を renderer / atlas / hybrid / starter の4層で同時に強化した。

what changed

1) sceneSurfaceShellSystem.tsx の専用 shaping 強化

ShellProfile に以下を追加

auraAmount

diskAmount

lacquerAmount

flowAmount

aura_shell

膨張膜寄りの半径押し出し

外周 aura glow

軽い disk 圧縮

eclipse_halo

disk compression を大幅追加

中心陰りと equator bloom を再圧縮

halo ring の比率を強化

resin_shell

lacquer sheen

downward flow / amber pooling

halo を弱めて滑面寄りへ

2) shell shader uniform 追加

uAuraAmount

uDiskAmount

uLacquerAmount

uFlowAmount



fragment 側では以下を追加した。



aura glow

disk mask

lacquer spec

flow wave



これにより、同じ shell 系でも



aura = 光の膜

eclipse = 圧縮円盤 halo

resin = 琥珀被膜 の差が出やすくなった。

3) depictionArchitecture 更新

更新対象:



aura_shell

eclipse_halo

resin_shell



spatialSignature / shapingFocus / contrastAxis を今回の renderer 実装に合わせて更新した。

4) atlas bundle 追加

追加:



sphere-aura-reliquary

ring-eclipse-umbra

image-resin-amber

5) hybrid / temporal 追加

hybrid:



aura-reliquary

amber-umbra



temporal:



aura-reliquary-breathe

amber-umbra-shed

6) starter 見本密度追加

追加:



starter-aura-eclipse-reliquary

starter-resin-amber-shell

starter-eclipse-amber-codex



対応 sequence:



starter-sequence-aura-eclipse-reliquary

starter-sequence-resin-amber-shell

starter-sequence-eclipse-amber-codex

verification

npm ci 通過

npm run typecheck 通過

npm run build 通過

build output

dist/assets/index-DhvgOm8w.js 892.94 kB

dist/assets/index-B8FfSG2b.css 52.78 kB

dist/assets/particleDataWorker-BBFq97Yk.js 121.19 kB

starter coverage after shaping18

aura_shell: 5

eclipse_halo: 8

resin_shell: 6

updated files

components/sceneSurfaceShellSystem.tsx — 425行 / 22.2 KB

lib/depictionArchitecture.ts — 138行 / 17.4 KB

lib/expressionAtlasBundles.ts — 320行 / 16.0 KB

lib/hybridExpressions.ts — 343行 / 14.1 KB

lib/hybridTemporalVariants.ts — 441行 / 14.1 KB

lib/starterLibrary.ts — 4164行 / 142.4 KB

next best target

次は shell family を横断して、mirror_skin / calcified_skin / residue_skin / shell_script の硬質差 / 劣化差 / 記述差をさらに圧縮するのが自然。
