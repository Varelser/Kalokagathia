IMPLEMENTATION PLAN AND PROGRESS

2026-03-28 Motion Family 第3弾 + Depiction Family 第5弾

今回の拡張では、既存機能を削らずに、描写語彙と動きの語彙をさらに追加した。

追加した motion family

tremor_lattice

bloom_torrent

orbit_fracture

foam_drift

signal_braid

追加した depiction family

soot_veil

nerve_web

bloom_spores

mirror_skin

pollen_storm

反映した箇所

types/scene.ts

components/motionCatalog.ts

components/controlPanelPartsMotion.tsx

components/sceneMotionMap.ts

lib/motionArchitecture.ts

lib/depictionArchitecture.ts

components/AppScene.tsx

lib/renderModeRegistry.ts

lib/projectState.ts

lib/starterLibrary.ts

専用寄せを追加した renderer

sceneFiberFieldSystem.tsx

nerve_web

signal_braid

sceneVolumeFogSystem.tsx

soot_veil

foam_drift

sceneSurfaceShellSystem.tsx

mirror_skin

sceneSurfacePatchSystem.tsx

tremor_lattice

sceneCrystalAggregateSystem.tsx

bloom_spores

pollen_storm

orbit_fracture

starter preset 追加

Tremor Lattice Chamber

Bloom Torrent Spores

Orbit Fracture Reliquary

Foam Soot Sanctuary

Signal Nerve Atlas

Pollen Storm Vault

starter sequence 追加

Tremor Lattice Chamber

Bloom Torrent Spores

Orbit Fracture Reliquary

Foam Soot Sanctuary

Signal Nerve Atlas

Pollen Storm Vault

検証結果

npm run typecheck : 通過

npm run build : 通過

現在の見立て

本来ゴールを



particle 描写の種類を網羅する

動きの種類を網羅する

時間変化と複合表現も増やす



と置いたとき、現在は次の段階にある。



motion family 第1〜3弾: 完了

depiction family 第1〜5弾: 完了

temporal profile 第1弾: 完了

hybrid expression 第1〜2弾: 完了

dedicated shaping: 継続中

進捗率

本質ベース進捗: 約93%

次の本命

dedicated shaping の残りをさらに詰める

bloom_torrent

foam_drift

soot_veil

mirror_skin

hybrid expression 第3弾

plasma + fog

ash + glyph

lattice + rupture

temporal profile 第2弾

inhale / exhale 差分強化

staged rupture

accretion loop

depiction family 第6弾

charge veil

cinder web

membrane pollen

drift glyph dust

prism smoke

補足

今回も既存機能は削っていない。追加した mode は既存の安定 renderer に接続しつつ、一部は mode 専用の見た目補正も加えている。
