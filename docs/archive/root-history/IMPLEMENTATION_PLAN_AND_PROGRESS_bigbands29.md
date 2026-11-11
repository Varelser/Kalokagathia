IMPLEMENTATION PLAN AND PROGRESS bigbands29

Goal

未実装だった大帯域を追加し、時間構造専用 family を実装して、UI / renderer / temporal / atlas / starter を同期させる。

Added physical bands

cloth_membrane

viscous_flow

granular_fall

fracture_grammar

growth_grammar

Added temporal families

accumulate

exfoliate

phase_shift

inhale

rewrite

Integrated areas

type definitions

motion map / motion catalog / motion architecture

depiction architecture

procedural registry

membrane / brush / crystal aggregate / growth renderers

temporal profile engine

procedural control panel labels / guides / quick presets / temporal options

expression atlas bundles

hybrid expressions

hybrid temporal variants

starter presets / sequence

Validation target

npm ci

npm run typecheck

npx vite build

Notes

新規帯域は既存 renderer 拡張で入れた。

時間構造は TemporalProfile 追加で入れた。

cloth / viscous / granular / fracture-growth grammar を物理系の母体として追加した。

accumulate / exfoliate / phase_shift / inhale / rewrite を時間構造の母体として追加した。
