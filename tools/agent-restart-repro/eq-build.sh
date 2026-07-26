#!/bin/bash
APP="/Users/chess/orca/workspaces/orca/read-reattach-fix/dist/mac-arm64/Orca Test.app"
export ORCA_USER_DATA_PATH="/Users/chess/Library/Application Support/orca-test-app"
export ELECTRON_RUN_AS_NODE=1
BIN="$APP/Contents/MacOS/Orca Test"
CLI="$APP/Contents/Resources/app.asar.unpacked/out/cli/index.js"
WT1="path:/Users/chess/orca/workspaces/test-playground/orca-test-round2"
ok=0; fail=0
create() { # $1 worktree $2 title $3 command
  if "$BIN" "$CLI" terminal create --worktree "$1" --title "$2" ${3:+--command "$3"} --json >/dev/null 2>&1; then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL: $2"; fi
}
# 23 shells with scrollback marker
for i in $(seq 1 23); do
  create "$WT1" "EQ shell $i" "bash -c 'echo EQ_${i}_READY; exec bash'"
done
# 6 tick loops (live output every second)
for i in $(seq 1 6); do
  create "$WT1" "EQ tick $i" "bash -c 'while true; do echo \$(date +%T) EQ_TICK_${i}; sleep 1; done'"
done
# 2 TUI panes: idle claude + vim
create "$WT1" "EQ tui claude" "claude --model sonnet"
create "$WT1" "EQ tui vim" "vim -c 'set number'"
echo "created ok=$ok fail=$fail"
# +3 browser tabs
for u in "https://example.com/" "https://example.org/" "data:text/html,<h1>EQ_PAGE</h1>"; do
  "$BIN" "$CLI" tab create --url "$u" --json >/dev/null 2>&1 && echo "tab ok: $u"
done
"$BIN" "$CLI" terminal list --json 2>/dev/null | python3 -c 'import sys,json; print("total terminals:", len(json.load(sys.stdin)["result"]["terminals"]))'
"$BIN" "$CLI" tab list --json 2>/dev/null | python3 -c 'import sys,json; print("total browser tabs:", len(json.load(sys.stdin)["result"].get("tabs",[])))'
