# バグ: アプリ再起動で対話型エージェントの実セッションが死ぬ(Orca Test, HEAD a295758b6)

## 症状(2026-07-26 04:20 実測)
アプリ = read-reattach-fix worktree の Orca Test.app(修正入り 1.4.155)。daemon(PID 66589)は再起動をまたいで生存。

- bash シェル(23本)・毎秒 echo ループ(6本)は再起動後も継続・入力可 → 合格
- しかし対話型エージェント 4 本(claude --model haiku/sonnet --dangerously-skip-permissions ×3、codex ×1)は
  アプリ quit(osascript quit)→ open で **プロセスごと消滅**(pgrep -fl "claude --model" が 0 件)
- ところが CLI では connected:true / writable:true、terminal send は accepted:true を返す。
  画面(tail)は死亡直前の会話が残ったまま。**見た目は生存・実体は死亡**
- 付随現象1: 再起動直後の数分、旧ハンドルの read が別ペイン(LIVE3_TICK ペイン)の画面を返す混線。数分で正しい対応に戻る
- 付随現象2: browser tab list が再起動前 5 → 後 3(--worktree all でも 3)
- 付随現象3: terminal create --title で付けた title が再起動後の list にしばらく出ない(rename したものは残る)

## 再現手順
1. tools/agent-restart-repro/eq-build.sh   … 負荷 40 本+ブラウザタブ構築(パスは要書き換え: 自分のビルドに向ける)
2. tools/agent-restart-repro/eq-agents-setup.sh … エージェント4本起動し合言葉を記憶させる
3. osascript -e 'quit app "Orca Test"' → open -g で再起動
4. 旧ハンドル宛に質問を send → 返答が来ない(本バグ)。pgrep で claude プロセス不在を確認
※ CLI は bundle 内 executable + app.asar.unpacked/out/cli/index.js を ELECTRON_RUN_AS_NODE=1 で直接叩く。
   ORCA_USER_DATA_PATH="/Users/chess/Library/Application Support/orca-test-app" を明示。

## 対比(重要ヒント)
- 同型の Orca Dev では、アプリ差し替え再起動時に claude --remote-control セッション(ターミナル40本)が生き残った実績あり(2026-07-25 深夜)
- 生死の分かれ目は不明: bash は生存 / claude・codex TUI は死亡

## 【重要訂正 04:45】プロセスは死んでいない
発注者の生存判定が誤り(Orca が `--remote-control` を argv 先頭側に注入するため pgrep パターンが不一致)。
実際は claude 3 本とも生存(PID 98024 / 1355 / 1888、起動 04:18)。codex のみ生死不明。

**真のバグ: アプリ再起動後、旧ハンドル宛 terminal send が accepted:true になるのに、生きているエージェントの PTY に入力が届かない(TUI 画面に文字が現れない・返答なし)。**
- 再起動直後は read も別ペインの画面を返す(混線)。数分後 read の対応は直るが、send は直らない
- つまり調査の焦点は「プロセス寿命」ではなく「再起動後の handle→PTY の write 経路の再接続」(read 経路は途中から正しくなるのに write 経路がズレたまま/捨てられている疑い)
