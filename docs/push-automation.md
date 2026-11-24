# Kalokagathia GitHub push 承認自動化 (2026-11-24 実施)

目的: Muse の GitHub コネクタ承認カード (approval_expired / approval_denied) で
push が止まる問題を、経路変更で解消する。販売・公開・課金は対象外。

## B経路 (本命・実証済み): iMac + deploy key の通常 git push

- VM から GitHub への SSH は egress proxy が 22/443 とも遮断するため不可。
  HTTPS の読み取り (ls-remote / clone) のみ可。
- iMac には repo 専用 deploy key `~/.ssh/kalokagathia_deploy` が登録済みで、
  `ssh -i ~/.ssh/kalokagathia_deploy -T git@github.com` が
  "Hi Varelser/Kalokagathia!" を返す (書き込み可)。
- 専用 clone: iMac `~/kalokagathia-git` (depth 1, main, single-branch)。
  この clone は自動化専用なので `reset --hard origin/main` 前提でよい。
- 使い方: 変更ファイルをこの clone にコピー → commit → 
  `GIT_SSH_COMMAND="ssh -i ~/.ssh/kalokagathia_deploy -o IdentitiesOnly=yes" git push origin main`
- 実証: 2026-11-24、ワークフロー追加 commit `d8b7aaf` をこの経路で main へ
  push し、VM 側から ls-remote + raw ファイル取得で到達を確認済み。
  コネクタ承認カードは一切経由していない。
- 注意: 製品コードの push は従来どおり期ごとの杉の指示で実施する。
  この経路ができたことは「常時 push してよい」許可ではない。

## A経路 (補助): PR の Auto-approve + Auto-merge

- `.github/workflows/auto-approve-merge.yml` を main に設置済み (commit d8b7aaf)。
  - 対象: オーナー (Varelser) が開いた非ドラフト PR のみ。他人の PR は対象外。
  - 動作: hmarr/auto-approve-action@v4 で自動 Approve →
    `gh pr merge --squash --auto` で auto-merge 予約。
  - 前提 (どちらも 2026-11-24 に ON 化済み):
    (1) Settings → General → Pull Requests の「Allow auto-merge」
    (2) Settings → Actions → General → Workflow permissions の
        「Allow GitHub Actions to create and approve pull requests」
        — これが OFF だと Auto-approve が "GitHub Actions is not permitted
        to approve pull requests" で失敗する (PR #1 初回テストで実測し修正)。
- 実証: PR #1 (docs/push-automation.md の追加) で、github-actions[bot] が
  自動 Approve → squash auto-merge まで無人で完了 (merge commit 61d21a9)。
  テスト用ブランチはマージ後に削除済み。
- ブランチ保護 (Approve 必須化) は **あえて未設定**。設定すると direct push
  (B経路や他AIの snapshot push) まで止まるため。PR 方式は「使いたいときに
  使える」状態に留める。

## ファイル

- `auto-approve-merge.yml` — ワークフロー正本 (リポ側と同一内容)
- `imac_install_workflow.sh` — iMac でワークフローを設置したスクリプト (再実行可、NOCHANGE 判定あり)
- iMac 側置き場: `~/kalokagathia-automation/` (同2ファイル)
