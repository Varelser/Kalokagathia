Phase 46 — Product pack library

Goal

TouchDesigner-like / Trapcode-like / Universe-like の描写帯域を、単発 preset ではなく product pack として束で扱えるようにする。

Added

lib/productPackLibrary.ts 新設

product pack 10本追加

Touch Feedback Topology

Touch POP Force Cloud

Touch Curve Relief Feedback

Trapcode Particular Noir

Trapcode Particular Audio Sparks

Trapcode Form Lattice

Trapcode Form SDF Swarm

Universe Retro Feedback

Universe Broadcast Ghost

Hybrid Audio Operator Stack

Global Display に Product Packs パネル追加

project manifest に product pack families / packs / active product pack を追加

starter library に pack-driven presets / sequences を追加

Effect

製品系の描写帯域を pack 単位で即適用できる

export/import 時に product pack の参照状況を保持できる

pack-driven preset / sequence として再利用できる

Next

Phase 47: product pack ごとの source / motion / render / post coverage scorecard を追加

Phase 48: pack を atlas / operator recipe 側の自動展開対象へ接続
