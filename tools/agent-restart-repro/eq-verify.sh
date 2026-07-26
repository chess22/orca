#!/bin/bash
APP="/Users/chess/orca/workspaces/orca/read-reattach-fix/dist/mac-arm64/Orca Test.app"
export ORCA_USER_DATA_PATH="/Users/chess/Library/Application Support/orca-test-app"
export ELECTRON_RUN_AS_NODE=1
BIN="$APP/Contents/MacOS/Orca Test"
CLI="$APP/Contents/Resources/app.asar.unpacked/out/cli/index.js"
RESTART_TS="$1"
"$BIN" "$CLI" terminal list --json 2>/dev/null > /tmp/eq-after.json
python3 - "$RESTART_TS" <<'EOF'
import json,sys,subprocess,os
restart_ts=sys.argv[1]
APP="/Users/chess/orca/workspaces/orca/read-reattach-fix/dist/mac-arm64/Orca Test.app"
BIN=APP+"/Contents/MacOS/Orca Test"
CLI=APP+"/Contents/Resources/app.asar.unpacked/out/cli/index.js"
env=dict(os.environ)
d=json.load(open("/tmp/eq-after.json"))
terms=d["result"]["terminals"]
print("terminals after restart:", len(terms))
def read(h):
    r=subprocess.run([BIN,CLI,"terminal","read","--terminal",h,"--json"],capture_output=True,text=True,env=env)
    try: return json.loads(r.stdout)["result"]["terminal"]["tail"]
    except Exception: return None
shell_ok=shell_ng=tick_ok=tick_ng=other=0
tick_fresh=[]
for t in terms:
    tail=read(t["handle"])
    if tail is None:
        other+=1; print("READ FAIL:", t["handle"][:18], t.get("title")); continue
    text="\n".join(tail)
    import re
    m=re.findall(r"EQ_(\d+)_READY", text)
    tk=re.findall(r"(\d\d:\d\d:\d\d) EQ_TICK_(\d+)", text)
    if tk:
        last=tk[-1]
        if last[0] > restart_ts: tick_ok+=1; tick_fresh.append(f"EQ_TICK_{last[1]}@{last[0]}")
        else: tick_ng+=1; print("TICK STALE:", t.get("title"), last)
    elif m:
        shell_ok+=1
    else:
        other+=1
print(f"scrollback-restored shells: {shell_ok}/23")
print(f"live ticks continuing after restart({restart_ts}): {tick_ok}/6  stale:{tick_ng}")
print("sample fresh ticks:", ", ".join(tick_fresh[:4]))
EOF
# input test on 3 EQ shells
for n in 3 12 21; do
  H=$(python3 -c "
import json
d=json.load(open('/tmp/eq-after.json'))
for t in d['result']['terminals']:
    if t.get('title')=='EQ shell $n': print(t['handle']); break")
  [ -z "$H" ] && { echo "EQ shell $n: handle not found"; continue; }
  "$BIN" "$CLI" terminal send --terminal "$H" --text "echo EQ_${n}_INPUT_OK_\$(date +%H%M%S)" --enter --json >/dev/null 2>&1
  sleep 2
  "$BIN" "$CLI" terminal read --terminal "$H" --json 2>/dev/null | python3 -c "
import sys,json
tail=json.load(sys.stdin)['result']['terminal']['tail']
hits=[l for l in tail if 'EQ_${n}_INPUT_OK_' in l and 'echo' not in l]
print('EQ shell $n input:', hits[-1].strip() if hits else 'NOT FOUND')"
done
# TUI panes
python3 - <<'EOF'
import json,subprocess,os
APP="/Users/chess/orca/workspaces/orca/read-reattach-fix/dist/mac-arm64/Orca Test.app"
BIN=APP+"/Contents/MacOS/Orca Test"; CLI=APP+"/Contents/Resources/app.asar.unpacked/out/cli/index.js"
d=json.load(open("/tmp/eq-after.json"))
for t in d["result"]["terminals"]:
    if t.get("title") in ("EQ tui claude","EQ tui vim"):
        r=subprocess.run([BIN,CLI,"terminal","read","--terminal",t["handle"],"--json"],capture_output=True,text=True,env=dict(os.environ))
        try:
            tail=json.loads(r.stdout)["result"]["terminal"]["tail"]
            nonempty=len([l for l in tail if l.strip()])
            print(t["title"], "screen lines:", nonempty, "->", "ALIVE" if nonempty>2 else "EMPTY?")
        except Exception as e: print(t["title"], "read error", e)
EOF
"$BIN" "$CLI" tab list --json 2>/dev/null | python3 -c 'import sys,json
tabs=json.load(sys.stdin)["result"].get("tabs",[])
print("browser tabs after restart:", len(tabs))
for t in tabs: print(" -", t.get("url","")[:50])'
