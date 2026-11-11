Phase 50 — solver family expansion

今回の目的

生成方法を product pack の見た目差ではなく、solver / generation family として独立軸化する。

TouchDesigner / Trapcode / Houdini / Niagara / Geometry Nodes / Unity VFX Graph 系を、同じ coverage 指標で比較できるようにする。

未実装帯域を数値で把握し、次の実装順序を固定する。

今回やったこと

coverage に solverFamilies 軸を追加。

solver target を 10 本追加。

operator-graph

system-emitter

simulation-zone

gpu-vfx-graph

volumetric-solver

pbd-solver

mpm-material

destruction-fracture

signal-image-field

task-graph

product pack bundle に solverFamilies を追加。

新規 product pack を 5 本追加。

Unity VFX GPU Sheet

Houdini MPM Slurry Stack

Houdini Destruction Fracture Debris

Touch TOP COP Signal Field

Hybrid PDG Variant Sweep

coverage scorecard / rollup / augmentation を solver 軸対応に更新。

Project Manifest / Project IO / Global Display を solver 軸対応に更新。

schema version を更新。

project data version: 10

manifest schema version: 8

全体進捗

coverage targets total: 92



source: 14

render: 24

post: 20

compute: 7

motion: 17

solver: 10



pack library



product packs: 22

product pack families: 8



overall pack-library coverage



77 / 92 = 84%

average single-pack coverage: 26%

best single-pack coverage: 38%

best pack: Hybrid Audio Operator Stack



axis progress



source: 12 / 14 = 86%

render: 18 / 24 = 75%

post: 17 / 20 = 85%

compute: 7 / 7 = 100%

motion: 13 / 17 = 76%

solver: 10 / 10 = 100%

残る未充足帯域

source

random-scatter

shell-volume

render

aux-particles

sdf-lighting

instanced-geometry

gpu-tubes

gpu-metaballs

gpu-volumetric

post

vignette

contact-fx

sdf-shading

motion

chaos

elastic

magnetic

swarm

solver

なし

次段階

Phase 51 では、残っている render / motion の穴を優先する。 特に次を重点帯域にする。



chaos

elastic

magnetic

swarm

gpu-tubes

gpu-metaballs

gpu-volumetric

sdf-lighting
