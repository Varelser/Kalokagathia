DOCS_INDEX

このリポジトリでは、文書を次の3層で扱います。

1. root に残す文書（現在の正本）

README.md起動・開発・配布の入口

CURRENT_STATUS.md現在の正本。まず最初に読む

REVIEW.md現物基準の精査結果

REFACTOR_PLAN_LARGE_FILES.md巨大ファイル分割の実行計画

PHASE0_COMPLETION_STATUS.md現在の package の位置づけ

SYSTEM_DESIGN_BLUEPRINT.md設計思想

UPGRADE_ROADMAP.md拡張ロードマップ

2. archive に移した文書（旧進捗・旧計画）

docs/archive/root-history/旧来 root に散在していた進捗記録、フェーズ記録、途中メモ

docs/archive/build-logs/退避した build / typecheck / verify のログ

3. 運用ルール

現在の判断は root の文書を優先する

archive 文書と build log は、履歴参照専用として扱う

archive 文書に root の正本と矛盾がある場合、root 側を優先する

新規の進捗 md を増やす場合も、root に乱立させず、必要なら docs/ 配下へ置く

推奨参照順

CURRENT_STATUS.md

REVIEW.md

REFACTOR_PLAN_LARGE_FILES.md

SYSTEM_DESIGN_BLUEPRINT.md

必要時のみ docs/archive/root-history/
