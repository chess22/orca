# Branch Layout (chess22/orca fork)

```
upstream (stablyai/orca)          … 本家。リリースの取り込み元
  └→ main                        … 本家追従専用ミラー。独自コミットは置かない
       ├→ chess22/<feature>      … 機能ブランチ(1 機能 = 1 ブランチ = 1 worktree)
       │     chess22/pane-width          … ペイン幅/比率 (Refs chess22/orca#3)
       │     chess22/multi-window        … マルチウィンドウ (Refs chess22/orca#2)
       │     chess22/parallel-identity   … 本家と開発版の並行運用 (identity 分離)
       └→ integration/main       … 全部入り統合ライン(旧 mod/parallel-identity)
                                    本家リリース + 全 feature をマージ。
                                    開発アプリ (Orca Dev) はここからビルドする。
```

## 運用ルール

- `main` は upstream の取り込み専用。直接コミットしない。
- 機能は `chess22/<name>` で開発し、コミット末尾に `Refs chess22/orca#<issue>` を付ける。
- 完成した機能は `integration/main` にマージして Orca Dev でドッグフードする。
- ビルドは他エージェントが作業していない隔離 worktree で行う(dist 破損防止)。
