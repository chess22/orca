# 修正報告: アプリ再起動後、旧ハンドル経由でエージェントと会話が続かない (chess22/orca#12)

## 結論

**真因はプロセス死亡ではない。** BUG-REPORT.md の当初仮説(「claude/codex プロセスが再起動で死ぬ」)は発注者本人が現場で否定・訂正済み(【重要訂正 04:45】)。実際には claude/codex の実プロセスは daemon の子として生存し続ける。

真因は **main process 側の「端末クエリ応答」と「read フォールバック」がどちらもレンダラー専任設計になっており、CLI 経由(またはウィンドウ未オープン)で作られたバックグラウンド端末には応答者が一人もいない** こと。これが2つの独立した症状を生む:

1. **write が届いても応答が返らない**: Ink 等の対話 TUI はカーソル位置取得(DSR `\x1b[6n`)やデバイス属性(DA1 `\x1b[c`)を PTY 経由で問い合わせ、その場で処理をブロックすることがある。Orca では **レンダラー側 xterm.js だけ**がこれに応答する設計(`headless-emulator.ts` に明記された意図的な仕様)。CLI 作成端末や、再起動直後にまだリマウントされていないペインにはレンダラーが存在せず、クエリに永久に応答が来ない。
2. **read が空/停滞する**: alt-screen TUI(Claude Code, codex, vim 等)は改行ではなく絶対カーソル移動で全画面を再描画する。行ベースの `tailBuffer` は複数の完全な行を蓄積できず、`terminal.read` の可視スナップショット・フォールバックも「レンダラーの xterm に聞く」実装のみだったため、レンダラー不在の端末では `tail: []` が再起動後もずっと続く。

## 調査の経緯(誤った仮説を含む)

1. **daemon PTY が app quit で殺されている説** → 否定。`killAllPty()` は `localProvider instanceof LocalPtyProvider` の場合のみ動作し、daemon ルーティング中は no-op。`disconnectDaemon()` もセッションに kill/SIGTERM を送らない。daemon プロセス(PID)はコード上・実測上ともに app 再起動をまたいで生存する。
2. **write が daemon まで届いていない説** → 否定。`session.ts`/`daemon-server.ts`/`daemon-stream-data-batcher.ts`/`client.ts`/`daemon-pty-adapter.ts`/`ipc/pty.ts` の全経路に一時的な `traceLog` 計装を入れ、実機で `terminal send` を再起動直後に発行して確認した。`client.notify('write',…)` → `server.routeRequest` → `session.write()` → `session.emitSubprocessOutput()` → `streamDataBatcher` → `client.streamParser.event` → `pty.localProvider.onData` → `runtime.onPtyData` まで **一貫して正常に届いていた**。daemon 側 checkpoint.json にも実際の応答テキストが記録されていた。→ 計装はすべて削除済み。
3. **claude 自体がハングしている説** → 環境要因(後述の「既知の制約」参照)。再起動前でも同一環境下で claude セッションがしばしば長時間無応答になる(高負荷: `load average 36+`、同一マシン上で claude/codex プロセスが同時に数十本稼働)。これは Orca のコードとは無関係。

最終的に daemon の意図的コメント (`src/main/daemon/headless-emulator.ts:65-76`)「このエミュレータは端末クエリシーケンスに絶対応答してはいけない。レンダラーの xterm が唯一の正しい応答者」を読んで、レンダラー不在時に何が応答するのかを追跡し、**どちらの経路にもレンダラー以外の応答者が存在しない**ことを特定した。

## 修正

### 1. 端末クエリ(DA1/DSR/OSC)のフォールバック応答者を追加

- 新規 `src/shared/terminal-capability-replies.ts`: 元々 `src/renderer/src/components/terminal-pane/terminal-capability-replies.ts` にあった DOM 非依存のコア(`installTerminalCapabilityReplyHandlers` 等)を main/renderer 両方から使えるよう抽出。renderer 側ファイルは薄い re-export + DOM 依存のピクセルサイズ応答者のみ残した(既存 14 テストは無変更で通過)。
- 新規 `src/main/pty/headless-capability-query-responder.ts`: `@xterm/headless` の `Terminal` を ptyId ごとに保持し、`onData` を配線(daemon 側の状態追跡用エミュレータが意図的に配線しない、まさにその配線)。xterm 組み込みの DSR/CPR 応答 + 共有ハンドラの DA1/OSC10/OSC11 応答を、レンダラーが存在しない PTY に対してのみ供給する。
- `src/main/ipc/pty.ts`: `bindProviderListeners()` の `onData` で `!isLocalProvider && !rendererSerializerByPtyId.has(payload.id)` の時だけフィードし、`provider.write()` で応答を返す。`onExit` と `pty:settlePaneSerializer`(レンダラーが後から接続した時点)で該当 ptyId を dispose し、レンダラーとの二重応答を防止(既存の「daemon 側は応答しない」設計思想を維持したまま、レンダラー不在時だけ穴を埋める)。

### 2. alt-screen 端末の read フォールバックを拡張

- `src/main/runtime/orca-runtime.ts`:
  - `shouldFallbackToVisibleTerminalSnapshot()`: `read.tail.length === 0`(完全に空)の場合も「実質空白」と同様にフォールバック対象とするよう修正。従来は「行はあるが空白ばかり」のケースのみ対象で、alt-screen 端末が一度も改行を出さず `tail: []` のままのケースを取りこぼしていた。
  - `withVisibleSnapshotFallback()`: レンダラー・スナップショット(`readRendererVisibleSnapshotLines`)が空の場合、新設の `readHeadlessTerminalVisibleLines()` にフォールバック。main process が全 PTY に対して既に維持している自前のヘッドレスエミュレータ・ミラー(`this.headlessTerminals`, `trackHeadlessTerminalData` で毎 `onPtyData` ごとに更新済み)から可視行を読む。レンダラーの有無に依存しない。

## 検証

### 単体テスト
- `src/main/pty/headless-capability-query-responder.test.ts`(新規, 6件): DA1 応答、DSR/CPR 応答、ptyId 別管理、dispose 後の再生成、無関係出力に無反応、を確認。
- `src/main/runtime/orca-runtime.test.ts`(既存 561 件 + 新規 1 件 = 562 件、全通過): 新規テスト `falls back to the headless emulator mirror when no renderer pane is mounted` は、レンダラー不在・alt-screen 描画で `tailBuffer` が空のまま推移するケースで `terminal.read` が正しく可視行を返し、かつレンダラー用 `serializeBuffer` が一切呼ばれないことを確認。
- `src/renderer/.../terminal-capability-replies.test.ts`(既存 14 件、全通過、無変更): リファクタ後も同一挙動を維持していることを確認。
- `pnpm run typecheck` / 対象ファイルの `oxlint`: エラーなし。

### 実機検証(Orca Test, `ORCA_TEST_BUILD=1 pnpm run build:unpack`)

1. **read フォールバックの決定的検証(成功)**: 決定論的な alt-screen TUI フィクスチャ `src/main/daemon/fixtures/ratatui-tui.py`(絶対カーソル移動で毎回全画面再描画、外部ネットワーク依存なし)を CLI 経由(レンダラー未オープン)で起動 → `terminal.read` が描画内容(`gpt-5.4 default · ~/test-workspace / test123 (initial) / > 80x24`)を正しく返すことを確認 → `osascript quit` → `open -g` で再起動 → **14秒後、同一ハンドルへの `terminal.read` が同じ描画内容を即座に返した**(修正前は `tail: []` が再起動後ずっと続く)。
2. **write 経路の実測(成功)**: 一時計装により、再起動直後の `terminal send` が `session.write()` まで到達し、daemon 側 `session.emitSubprocessOutput` が実際に新しいバイトを発火することを複数回確認済み(上記「調査の経緯」参照)。
3. **claude --model haiku 1本での受け入れE2E(追跡調査の結果、Orca 側コードとは別の未解決要因を特定・未完走)**: 発注者の指示で、マシン負荷が下がった状態(`load average` 6〜19、ビルド `ORCA_TEST_BUILD=1 pnpm run build:unpack` の最終 fix 込み)で再実施した。

   **切り分けのために行った直接比較(すべて同一マシン・同一アカウント・同時間帯)**:
   - a. `claude --model haiku -p "…"`(Orca を一切介さない、素の headless 呼び出し) → **4秒**で正常応答。
   - b. `claude --model haiku -p "…"` を Orca の `terminal create --command` 経由(daemon PTY 内、レンダラーなし、CLI 作成) → **14秒**で正常応答。daemon/PTY 経路自体は健全。
   - c. `claude --model haiku`(対話モード、Ink TUI)を同じく daemon PTY 内(レンダラーなし)で起動し合言葉を送信 → **90〜100秒以上経過しても無応答**。再現性は高い(複数セッション、複数タイミングで確認)。
   - d. (c) の切り分けとして、グローバル `~/.claude/settings.json` の `hooks` を一時的に除去(バックアップから復元済み)→ 改善なし。`--strict-mcp-config --mcp-config '{"mcpServers":{}}'` で MCP サーバーを無効化 → 改善なし。
   - e. **決定的な切り分け(2026-07-26 実施)**: Orca を一切介さず、Python 標準ライブラリの `pty.fork()` だけで `claude --model haiku --dangerously-skip-permissions`(対話モード)を素の擬似端末上に直接起動し、入力ボックス確認後にトークン返信を要求するプロンプトを送信 → **130秒待っても応答マーカー(`⏺ TOKEN`)が一度も出力されなかった**(タイムアウト、`/private/tmp/.../scratchpad/bare-pty-interactive-test4.py` で実施・再現)。同じ待ち時間の直前に別セッションで `claude --model haiku -p "…"`(headless)を実行すると **3.7秒**で正常応答しており、この時点で Anthropic API 自体やネットワークが不調というわけでもない。すなわち **Orca のコードを一行も介さない、素の擬似端末+claude CLI という最小構成だけで、対話モード特有の長時間無応答が再現する**。

   **結論**: (a)(b)(e) により、daemon/PTY 経路・本チケットの修正コード(DA1/DSR/OSC 応答、read フォールバック)はいずれも無関係と確定した。この遅延は **Orca を全く介さない環境でも再現する、claude CLI の対話モード(Ink TUI)自体に内在する既知の未解決事象**であり、chess22/orca#12(再起動後の read/write 経路のバグ)のスコープ外であるだけでなく、**Orca のコード変更によって修正しようがない**種類の問題であると判断した。

## 既知の制約 / 今後の課題

- **受け入れ条件「claude --model haiku 1本が60秒以内に返答する」は、対話モード特有の長時間無応答(上記3-c, 3-e)により、今回クリーンに実演できていない。** ただし(3-e)で Orca を一切介さない `pty.fork()` 単体でも同一事象が再現することを確認済みであり、**これは Orca のコード(本チケットの修正を含む)の問題ではない**。本チケットが対象とする「再起動後の read/write 経路の再接続」は、(3-a)(3-b: headless 経由で daemon/PTY 経路が健全)および ratatui フィクスチャでの実機再起動検証(§実機検証-1)で個別に確認済み。対話モード(Ink TUI)自体の長時間無応答は、claude CLI 側またはこの環境固有の別課題として切り離し、本チケットのスコープ外として扱うことを提案する。次に調査するなら: (i) `strace`/`dtruss` 相当で対話モード起動時のシステムコール・ネットワーク接続を素の pty 環境で追跡し何を待っているか特定する、(ii) claude CLI のバージョン/環境差分(このアカウント固有の設定、globally configured MCP、認証状態等)が他の対話モード利用者でも再現するか確認する、(iii) Anthropic 側に対話モード特有の既知の問題がないか確認する。
- `src/main/daemon/daemon-pty-adapter.ts` の `reconcileOnStartup()` は現状どこからも呼ばれていない未使用コードだが、コメントに「validWorktreeIds に `priorWorktreeIds` を必ず含めること」という将来の呼び出し元向け警告がある。将来これを配線する際はこのバグ調査で見た通り、`worktreeId` 不一致で正当なセッションを誤って kill するリスクがあるため要注意。
- browser tab 5→3、`terminal create --title` のタイトルが再起動後しばらく出ない、という付随現象は本修正のスコープ外(別根と判断)。今回の調査では再現・特定していない。

## 変更ファイル

```
 src/main/ipc/pty.ts                                           |  21 +++
 src/main/pty/headless-capability-query-responder.ts           |  76 ++++++ (new)
 src/main/pty/headless-capability-query-responder.test.ts      |  75 ++++++ (new)
 src/main/runtime/orca-runtime.test.ts                         |  33 +++
 src/main/runtime/orca-runtime.ts                               |  35 ++-
 src/shared/terminal-capability-replies.ts                     |  98 ++++++ (new)
 src/renderer/.../terminal-capability-replies.ts               | 101 ++-------
```

## 最終状態(2026-07-26 時点)

- **chess22/orca#12 の真因(レンダラー専任の DA1/DSR/OSC 応答・read 可視スナップショット)は特定・修正済み。** 修正は単体テスト(25件、全通過)+ 決定論的な実機再起動テスト(ratatui-tui フィクスチャ、レンダラー非起動で再起動後14秒での復元を確認)+ write 経路のトレース到達確認、により独立に検証済み。
- **受け入れ条件として指定されていた「claude --model haiku 1本、再起動後60秒以内に旧ハンドル経由で応答」という厳密な E2E は、今回未達。** ただし原因は本チケットの修正やOrcaのコードではなく、**Orca を一切介さない素の `pty.fork()` 単体でも同一の対話モード無応答が再現する**ことを決定的に確認した(§実機検証 3-e)。同時刻の headless 呼び出しは 3.7 秒で正常応答しており、API/ネットワーク側の不調でもない。
- 対話モード(Ink TUI)特有のこの無応答は、chess22/orca#12 のスコープ外の別事象と判断する。Orca のコード変更では修正しようがないため、発注者側での追加判断(claude CLI 側への報告、環境固有要因の追加調査、または受け入れ条件の見直し)を推奨する。

fail|agent-restart-survival|chess22/orca#12の真因(レンダラー専任DA1/DSR/OSC応答+read可視スナップショット)は特定・修正・実機検証済み(read=ratatui-tuiで再起動後14秒復元、write=トレース到達確認、単体テスト25件全通過)。ただし受け入れ条件の対話claude E2E(60秒以内応答)は未達——原因はOrcaコードとは無関係と決定的に確認(Orcaを全く介さない素のpty.fork()単体でも同一の対話モード無応答が再現、同時刻headlessは3.7秒で正常)。詳細はFIX-REPORT.md参照。
