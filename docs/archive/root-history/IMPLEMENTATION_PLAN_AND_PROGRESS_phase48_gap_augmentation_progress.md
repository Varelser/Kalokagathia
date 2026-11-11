Phase 48 — gap-driven augmentation + overall progress

目的

product pack scorecard を「比較」だけでなく「不足帯域の補強」に使う

現在設定の coverage と、pack library 全体の coverage を分けて数値化する

全体進捗を schema-aware project manifest で記録する

実装

lib/productPackScorecards.ts



coverage target key 集計を追加

pack library 全体の rollup を追加

overall coverage score / best pack / average pack を算出



lib/productPackAugmentation.ts



current config の gap targets を元に、coverage gain が大きい pack を提案

coverageGain / resultCoverageScore / coveredGapTargets を返す



lib/projectState.ts + types/project.ts



manifest に coverageRollup と augmentationSuggestions を追加

stats に currentCoverageScore / overallCoverageScore / bestPackCoverageScore / averagePackCoverageScore / augmentationSuggestionCount を追加



components/controlPanelGlobalDisplay.tsx



Product Packs セクションに current coverage / library coverage / gap-driven augment を追加



components/controlPanelProjectIO.tsx



export manifest に overall progress 数値と augmentation 候補を表示

現時点の measured progress

coverage targets total: 82

product packs: 10

product pack families: 4

overall pack-library coverage: 54 / 82 = 66%

best single pack: Hybrid Audio Operator Stack = 26 / 82 = 32%

average single-pack coverage: 25%

axis progress

source: 10 / 14

render: 15 / 24

post: 15 / 20

compute: 7 / 7

motion: 7 / 17

残る大きい未充足帯域

motion の残数がまだ多い

render は instanced / surface / gpu render family の追加余地が大きい

source は brush / glyph / shell 側にまだ穴がある

次フェーズ

Phase 49: motion-gap packs

fluid / swarm / structure / growth / orbit / volumetric の不足帯域を専用 pack 群で埋める

Phase 50: render-gap packs

instanced-object swarm / gpu tubes / mapped surface / volumetric render を pack 単位で増設
