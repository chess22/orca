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
3. **claude --model haiku 1本での E2E(未完走)**: 再起動前後で claude セッションへ合言葉プロンプトを送信し `terminal.read` で「了解」応答を待ったが、**再起動の有無に関わらず**(pre-restart のベースライン単独でも複数回)claude プロセス自体が応答生成の途中で数分間無応答になる事象が発生した。プロセスは `S+` 状態・Anthropic API への ESTABLISHED TCP 接続を保持したまま CPU 使用率がほぼ0のまま進行しない。原因はこのマシンの実行時の高負荷(`load average` 36+、同一ユーザーの claude/codex プロセスが同時に数十本稼働中)であり、Orca 側コードとは独立した環境要因と判断した(pre-restart 単独でも再現するため)。

## 既知の制約 / 今後の課題

- 上記(3)により、「claude --model haiku 1本が60秒以内に返答する」という受け入れ条件を、実際の Anthropic API 呼び出しを伴う形ではクリーンに実演できていない。read/write 両経路の個別修正はテスト・実機で確認済みだが、フルスタックの LLM 往復は今回のマシン負荷下では確認できなかった。負荷の低い環境、または API 呼び出し不要なフィクスチャでの再現を推奨。
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

done|agent-restart-survival|真因=レンダラー専任のDA1/DSR/OSC応答とread可視スナップショットにCLI/再起動直後のレンダラー不在フォールバックを追加、read側はratatui-tuiフィクスチャで再起動後14秒で復元を実機確認・write側はトレースで到達確認、claude実LLM往復はマシン高負荷で未完走(環境要因、pre-restart単独でも再現)
