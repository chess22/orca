#!/bin/bash
APP="/Users/chess/orca/workspaces/orca/read-reattach-fix/dist/mac-arm64/Orca Test.app"
export ORCA_USER_DATA_PATH="/Users/chess/Library/Application Support/orca-test-app"
export ELECTRON_RUN_AS_NODE=1
BIN="$APP/Contents/MacOS/Orca Test"
CLI="$APP/Contents/Resources/app.asar.unpacked/out/cli/index.js"
WT="path:/Users/chess/orca/workspaces/test-playground/orca-test-round2"
declare -a NAMES=(AGENT_H1 AGENT_H2 AGENT_S1 AGENT_CX)
declare -a CMDS=("claude --model haiku --dangerously-skip-permissions" "claude --model haiku --dangerously-skip-permissions" "claude --model sonnet --dangerously-skip-permissions" "codex")
> /tmp/eq-agents.txt
for i in 0 1 2 3; do
  H=$("$BIN" "$CLI" terminal create --worktree "$WT" --title "${NAMES[$i]}" --command "${CMDS[$i]}" --json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["terminal"]["handle"])')
  echo "${NAMES[$i]} $H" >> /tmp/eq-agents.txt
done
cat /tmp/eq-agents.txt
# wait for TUIs then send codeword
while read NAME H; do
  "$BIN" "$CLI" terminal wait --terminal "$H" --for tui-idle --timeout-ms 60000 --json >/dev/null 2>&1
  "$BIN" "$CLI" terminal send --terminal "$H" --text "合言葉「EQ_${NAME}_MOON」を記憶して。今は「了解」とだけ返答。" --enter --json >/dev/null 2>&1
  echo "prompted $NAME"
done < /tmp/eq-agents.txt
sleep 20
while read NAME H; do
  "$BIN" "$CLI" terminal read --terminal "$H" --json 2>/dev/null | python3 -c "
import sys,json
tail=json.load(sys.stdin)['result']['terminal']['tail']
text=' '.join(tail)
print('$NAME replied:', '了解' in text or 'EQ_${NAME}_MOON' in text)"
done < /tmp/eq-agents.txt
