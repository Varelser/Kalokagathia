Phase 44 — post stack を recipe / bundle から独立参照できる層へ分離

目的

Post 処理を scene preset の一部として埋め込むだけでなく、 独立した stack bundle として適用・記録・再利用できるようにする。

今回の実装

lib/postFxLibrary.ts を新設



post stack bundle 定義を追加

reset → bundle patch 適用の共通関数を追加

current config から active bundle id を推定

presets/current config から referenced bundle ids を集計



components/controlPanelGlobalDisplay.tsx



Post Processing セクションに Independent post stacks を追加

bundle 単位で即適用できるようにした

active order を表示し、現在の stage 順序を見える化した



lib/starterLibrary.ts



Phase 43 で追加した post 系 starter preset を、 直接数値埋め込みではなく buildPostFxStackPatch() を経由する構造へ変更



types/project.ts / lib/projectState.ts



project manifest に以下を追加

postStackTemplates

activePostStackId

postStackTemplateCount

export/import 時に post stack 参照状況を保持できるようにした



components/controlPanelProjectIO.tsx



schema-aware snapshot に Post Stacks 件数を追加

coverage rows に post stack templates / active post stack を追加

検証

TypeScript typecheck: 通過

Vite build: 通過

今回の意味

これで post は単なる最後段の固定設定ではなく、 独立した bundle として scene preset から切り離して差し替え・比較・記録できる層になった。

次の候補

Phase 45: post stack を operator recipe / atlas bundle 側からも参照可能にする

Phase 46: source-emitter / render-band / post-stack の三層 bundle 化

Phase 47: TouchDesigner / Red Giant 系の product-parity preset pack を三層 bundle 上で追加
