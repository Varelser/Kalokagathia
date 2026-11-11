Phase 47 — Product Pack Coverage Scorecards

Goal

Product pack ごとに coverage scorecard を持たせ、TouchDesigner / Trapcode / Universe 系 pack が どの source / render / post / compute / motion 帯域をどれだけ持つかを可視化する。

Implemented

exported coverage targets from lib/depictionCoverage.ts

added lib/productPackScorecards.ts

added per-pack scorecards with hit counts / total targets / missing targets

added manifest export of product pack scorecards

added stats for scorecard count and active pack coverage score

added scorecard display to Global Display and Project I/O

Result

product pack は単なる preset 束ではなく、coverage の広さを持つ bundle として比較可能

manifest export からも各 pack の coverage score を確認可能

active pack の弱い帯域を UI で即確認可能

Next

Phase 48: scorecard の低い帯域に対して gap-driven pack augmentation を入れる。
