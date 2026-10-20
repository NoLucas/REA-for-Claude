#!/usr/bin/env bash
# selftest.sh — fast, offline checks for the REA for Claude plugin.
# Runs in CI and locally. No network, no analysis engines required.
#
#   bash scripts/selftest.sh
#
# Checks: JSON validity + manifest shape, shell syntax, Node syntax,
# launcher MCP smoke (initialize + tools/list over stdio) when rea-agents is
# cached/installed, and report generation from bundled fixtures.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
fail=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; fail=1; }
have() { command -v "$1" >/dev/null 2>&1; }
JQ=python3; have python3 || JQ=""

echo "== JSON validity & manifest shape"
json_ok() { python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$1" 2>/dev/null; }
for f in .claude-plugin/plugin.json .claude-plugin/marketplace.json .mcp.json .claude/settings.json scripts/rea-config.example.json tests/fixtures/*.json; do
  [ -e "$f" ] || { bad "missing $f"; continue; }
  if json_ok "$f"; then pass "valid JSON: $f"; else bad "invalid JSON: $f"; fi
done
python3 - <<'PY' && pass "plugin.json declares the rea MCP server" || bad "plugin.json manifest shape"
import json,sys
m=json.load(open('.claude-plugin/plugin.json'))
assert m.get('name')=='rea', m.get('name')
s=m.get('mcpServers',{}).get('rea',{})
assert s.get('command')=='node', s
assert any('launch-rea.cjs' in a for a in s.get('args',[])), s
PY
python3 - <<'PY' && pass "marketplace.json lists the plugin" || bad "marketplace.json shape"
import json
m=json.load(open('.claude-plugin/marketplace.json'))
assert any(p.get('name')=='rea' for p in m.get('plugins',[])), m
PY

echo "== shell syntax"
for s in scripts/*.sh remote/entrypoint.sh; do
  [ -e "$s" ] || continue
  if bash -n "$s"; then pass "bash -n $s"; else bad "bash -n $s"; fi
done

echo "== node syntax"
for j in scripts/*.cjs scripts/*.mjs; do
  [ -e "$j" ] || continue
  if node --check "$j"; then pass "node --check $j"; else bad "node --check $j"; fi
done

echo "== report generation from fixtures"
tmp="$(mktemp -d)"
if node scripts/make-report.mjs tests/fixtures --out "$tmp" --format both >/tmp/mr.out 2>&1; then
  html="$(ls "$tmp"/*.html 2>/dev/null | head -1)"
  md="$(ls "$tmp"/*.md 2>/dev/null | head -1)"
  if [ -s "$html" ] && grep -q "<title>" "$html" && [ -s "$md" ]; then pass "make-report produced HTML+MD"; else bad "make-report output incomplete"; fi
  grep -q "untrusted" "$html" && pass "report carries the untrusted-content notice" || bad "report missing untrusted-content notice"
else
  bad "make-report failed: $(tail -1 /tmp/mr.out)"
fi
# stdin + single-file modes
if node scripts/make-report.mjs --stdin --out "$tmp/s" --format md < tests/fixtures/decompile.evidence.json >/dev/null 2>&1; then pass "make-report --stdin"; else bad "make-report --stdin"; fi
rm -rf "$tmp"

echo "== launcher MCP smoke (stdio initialize + tools/list)"
if [ "${REA_SELFTEST_SKIP_MCP:-0}" = "1" ]; then
  echo "  skip (REA_SELFTEST_SKIP_MCP=1)"
else
  smoke="$(node - <<'NODE' 2>/dev/null
const {spawn}=require('child_process');
const p=spawn('node',['scripts/launch-rea.cjs'],{stdio:['pipe','pipe','ignore']});
let buf='',done=false,sawTools=false;
const send=(o)=>p.stdin.write(JSON.stringify(o)+'\n');
const t=setTimeout(()=>{if(!done){console.log('TIMEOUT');p.kill();process.exit(0);}},90000);
p.stdout.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);if(!l.trim())continue;let m;try{m=JSON.parse(l)}catch{continue}
  if(m.id===1&&m.result){send({jsonrpc:'2.0',method:'notifications/initialized'});send({jsonrpc:'2.0',id:2,method:'tools/list'});}
  if(m.id===2&&m.result){sawTools=Array.isArray(m.result.tools)&&m.result.tools.length>0;console.log(sawTools?('TOOLS '+m.result.tools.length):'NOTOOLS');done=true;clearTimeout(t);p.kill();process.exit(0);}}});
send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'selftest',version:'1'}}});
NODE
)"
  case "$smoke" in
    TOOLS\ *) pass "launcher served MCP tools ($smoke)";;
    TIMEOUT) echo "  skip (rea-agents not cached / slow network: $smoke)";;
    *) bad "launcher MCP smoke: ${smoke:-no response}";;
  esac
fi

echo
if [ "$fail" = "0" ]; then printf '\033[32mselftest passed\033[0m\n'; else printf '\033[31mselftest FAILED\033[0m\n'; fi
exit "$fail"
