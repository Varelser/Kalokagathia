Phase 42 — emitter / render-band expansion

Goal

TouchDesigner / Red Giant 的な帯域へ寄せるため、次の不足帯域を既存破壊なしで追加する。



curve / path 系 emitter 帯域

image / text / plane を使う surface-map 帯域

brush / capillary 系の描写帯域

instanced object swarm 帯域

GPGPU + SDF + ribbon / smooth-tube の複合帯域

coverage gap の manifest 可視化

Implemented in this phase

lib/depictionCoverage.ts

source/render/post/compute/motion の target を追加

gapTargets を追加

curve-path, surface-map, brush-field, glyph-mask を source families に追加

mapped-surface, brush-sheet, path-lines, curve-ribbons, instanced-object-swarm を render families に追加

feedback-echo, retro-crt, channel-split を post families に追加

instanced-mesh-pipeline, media-map-sampler, feedback-buffer を compute backends に追加

types/project.ts

manifest coverage に gapTargets

manifest stats に coverageGapCount

lib/projectState.ts

project data version を 5

manifest schema version を 3

export / import で gapTargets と coverageGapCount を保持

components/controlPanelProjectIO.tsx

Motion families / Compute backends / Gap targets を表示

lib/starterLibrary.ts

curve/path / surface-map / brush / SDF / instanced swarm / smooth tube を狙う starter preset を 6 本追加

Added starter presets

Curve Path Script

Surface Image Relief Map

Brush Capillary Sheet

Glyph SDF Shell

GPGPU Instanced SDF Swarm

GPGPU SmoothTube Orbit

Why this order

いきなり product-parity の見た目を個別に増やすと、あとで「何が未実装か」が見えなくなるため、先に coverage gap を manifest に載せた。

Next phase candidates

mesh / surface emitters の専用 UI 化

post stack の chain 化

feedback / echo を post renderer として独立化

product-parity preset packs の束化
