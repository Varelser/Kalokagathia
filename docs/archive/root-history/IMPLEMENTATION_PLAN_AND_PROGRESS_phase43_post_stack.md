Phase 43 — post stack chain 化

目的

post processing を固定3種ではなく順序付き stack として扱う

TouchDesigner / Trapcode / Universe 系の見た目差を post 層でも拡張する

coverage から post 帯域の欠けを見えるようにする

今回の実装

postFxStackProfile を追加

manual

touch-feedback

particular-glow

retro-feedback

dream-smear

lib/postFxStack.ts を追加し、active stage と order を分離

post effect を追加

Noise

Vignette

Brightness / Contrast

AppScene.tsx で stage map による chain render に変更

coverage / render registry / UI を更新

post stack starter preset を4本追加

この段階で得たもの

Bloom → CA → DOF 固定ではなく、profile ごとの順序差が出せる

post 帯域が manifest / render registry に出る

retro / glow / smear の見た目差を preset と profile で増やせる

次段階

Phase 44: post stack を recipe / bundle から独立参照できるようにする

Phase 45: emitter → sim → render → post の graph 化

Phase 46: product-parity preset pack を大量追加
