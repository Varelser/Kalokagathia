Phase 45 — operator / atlas bundle post-stack references

Goal

Allow operator recipes and expression atlas bundles to reference independent post stacks so depiction + post can be combined as reusable bundles and starter presets.

Implemented

Added postStackId metadata to ExpressionAtlasBundle.

Added buildExpressionAtlasPatch() to merge depiction patch + referenced post stack patch.

Added operator-side post-stack heuristics in lib/operatorGeneratedBundles.ts.

Atlas buttons now apply depiction patch and paired post stack together.

Added OPERATOR_ATLAS_STACK_PRESETS / sequences so atlas bundles can be saved and replayed as starter presets.

Result

Operator bundles are no longer depiction-only.

Atlas bundles can carry a recommended post identity.

Starter library now contains bundle-driven depiction + post combinations, closer to TouchDesigner / Red Giant style preset families.

Next

Phase 46 should move from single bundle pairings to multi-stage product packs:



TouchDesigner-like feedback chains

Trapcode-like emitter/render/post packs

Form-like structured grid packs

Universe-like retro/post packs
