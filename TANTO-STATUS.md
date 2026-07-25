# 担当状態文書 — 4機能を統合ラインへマージ

## 目的
integration/main(本家v1.4.155+既存改造の全部入りライン、開発アプリ Orca Dev のビルド元)に、完成済み4ブランチをマージする。
- chess22/read-reattach-fix (再起動後の入出力再接続、#12) ← 最優先・今日の実害の修正
- chess22/pane-width (terminal resize, #3)
- chess22/sighup-resilience (SIGHUP耐性, #10)
- chess22/orca-test-identity (Orca Test識別子, #11)

## 状況
integration/main で直接 merge を試したところ read-reattach-fix で衝突(config/electron-builder.config.cjs, src/cli/runtime/metadata.ts, src/main/cli/cli-installer.ts, src/main/daemon/daemon-pty-adapter.ts, daemon-pty-router.ts, src/main/index.ts, src/main/providers/types.ts ほか)。abort 済み。
衝突は主に「4ブランチが同じ箇所を別々に触っている(識別子/CLI/daemon周り)」ことによる。

## 依頼
このworktree(branch: integration/merge-work、integration/main から分岐)で4ブランチを順にマージし、衝突を正しく解消すること。順序は自分で判断してよい。各ブランチの意図は各worktreeのTANTO-STATUS.mdを参照(/Users/chess/orca/workspaces/orca/<名前>/TANTO-STATUS.md)。
解消後の検証: pnpm run typecheck と、触れた領域の vitest(最低でも daemon/runtime/cli/startup 関連)を通すこと。
完了したら経過に記録し、行頭に「- MERGE-DONE 日付」を追記。
禁止: 本番Orca / Orca Dev / orca / orca-dev-app プロファイルへの一切の操作。アプリの起動・終了もしない(コードとテストのみ)。

## 再開(01:4x、ユーザー許可あり)
ユーザーの実環境で #12 の症状(右下Relayペインに画面から入力できない)が出ており、修正の反映許可が出た。作業を再開すること。
最優先は chess22/read-reattach-fix。4ブランチ全部が難しければ read-reattach-fix だけ先に統合しても構わない(その判断は任せる)。
完了したら経過に記録し、行頭に「- MERGE-DONE 日付」を追記。

## 経過
- 2026-07-26 02:10 JST: 4ブランチを `integration/merge-work` へ統合。最優先の
  `chess22/read-reattach-fix` を先にマージし、Orca Dev/Test識別子、複数daemon世代、
  multi-window、pane resizeの重複箇所を両立するよう解消した。
  `chess22/orca-test-identity` と `chess22/sighup-resilience` は統合履歴に既に含まれており
  `Already up to date`、`chess22/pane-width` は続けてマージした。4ブランチすべてが最終HEADの
  ancestorであることを確認。
- 統合コミット: `b9d827686` (read reattach)、`a822914fe` (pane width)。
  follow-up `74bd3debd` でmulti-window notifierからpane resize通知が欠落しないよう補完し、
  既存の物理PTY停止テストfixtureを意図どおり「停止不能」になるよう修正。
- 検証: `pnpm run typecheck` 成功。daemon/runtime/CLI/startup/renderer関連vitestは
  13 files / 1282 tests 全合格。`pnpm run verify:bundled-skill-guides` と
  `git diff --check` も成功。実アプリおよび Orca / Orca Dev / `orca` /
  `orca-dev-app` profile は起動・終了・操作していない。
- MERGE-DONE 2026-07-26
