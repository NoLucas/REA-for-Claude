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

echo "== evidence diff from fixtures"
tmpd="$(mktemp -d)"
if out="$(node scripts/make-report.mjs --diff tests/fixtures/diff-before tests/fixtures/diff-after --out "$tmpd" --format both 2>&1)"; then
  echo "$out" | grep -q '"changed": 2' && pass "make-report --diff detects 2 changed items" || bad "make-report --diff unexpected summary: $(echo "$out" | tr -d '\n' | head -c 200)"
  grep -q 'FUN_001014a0' "$tmpd"/*.md && pass "diff shows decompiled-code line changes" || bad "diff missing code line diff"
else bad "make-report --diff failed: $(echo "$out" | tail -1)"; fi
rm -rf "$tmpd"

echo "== oauth gateway (offline unit: metadata, DCR, PKCE, bearer check)"
gw_out="$(node - <<'NODE' 2>&1
const {spawn}=require('child_process');const http=require('http');const crypto=require('crypto');
const PORT=38777; const env={...process.env,PUBLIC_URL:`http://127.0.0.1:${PORT}`,GATEWAY_PASSWORD:'selftest-passphrase-1',UPSTREAM_MCP_URL:'http://127.0.0.1:1/mcp',PORT:String(PORT)};
const p=spawn('node',['remote/oauth-gateway/gateway.mjs'],{env,stdio:['ignore','ignore','pipe']});
const req=(m,path,body,headers={})=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port:PORT,path,method:m,headers},(x)=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({s:x.statusCode,h:x.headers,b:d}));});r.on('error',rej);if(body)r.write(body);r.end();});
const form=(o)=>new URLSearchParams(o).toString();
(async()=>{await new Promise(r=>setTimeout(r,1200));try{
 let r=await req('GET','/.well-known/oauth-authorization-server');if(r.s!==200)throw 'meta '+r.s;
 r=await req('POST','/mcp','{}');if(r.s!==401||!/resource_metadata/.test(r.h['www-authenticate']||''))throw '401 '+r.s;
 r=await req('POST','/register',JSON.stringify({redirect_uris:['https://claude.ai/api/mcp/auth_callback']}),{'content-type':'application/json'});if(r.s!==201)throw 'dcr '+r.s;const c=JSON.parse(r.b);
 r=await req('POST','/register',JSON.stringify({redirect_uris:['https://evil.example/x']}),{'content-type':'application/json'});if(r.s!==400)throw 'badredir '+r.s;
 const ver=crypto.randomBytes(32).toString('base64url'),chal=crypto.createHash('sha256').update(ver).digest('base64url');
 const q={response_type:'code',client_id:c.client_id,redirect_uri:c.redirect_uris[0],code_challenge:chal,code_challenge_method:'S256',state:'s'};
 r=await req('POST','/authorize',form({...q,password:'wrong-wrong-wrong'}),{'content-type':'application/x-www-form-urlencoded'});if(r.s!==401)throw 'wrongpw '+r.s;
 r=await req('POST','/authorize',form({...q,password:'selftest-passphrase-1'}),{'content-type':'application/x-www-form-urlencoded'});if(r.s!==302)throw 'login '+r.s;
 const code=new URL(r.h.location).searchParams.get('code');
 r=await req('POST','/token',form({grant_type:'authorization_code',code,redirect_uri:q.redirect_uri,client_id:c.client_id,code_verifier:'bad'}),{'content-type':'application/x-www-form-urlencoded'});if(r.s!==400)throw 'pkce '+r.s;
 r=await req('POST','/authorize',form({...q,password:'selftest-passphrase-1'}),{'content-type':'application/x-www-form-urlencoded'});const code2=new URL(r.h.location).searchParams.get('code');
 r=await req('POST','/token',form({grant_type:'authorization_code',code:code2,redirect_uri:q.redirect_uri,client_id:c.client_id,code_verifier:ver}),{'content-type':'application/x-www-form-urlencoded'});if(r.s!==200)throw 'token '+r.s;const t=JSON.parse(r.b);
 r=await req('POST','/mcp','{}',{authorization:'Bearer '+t.access_token});if(r.s!==502)throw 'proxy(expected 502 upstream down) '+r.s;
 console.log('GATEWAY_OK');}catch(e){console.log('GATEWAY_FAIL '+e);}finally{p.kill();}})();
NODE
)"
case "$gw_out" in *GATEWAY_OK*) pass "oauth gateway: metadata, DCR, redirect allowlist, PKCE, bearer 401, proxy";; *) bad "oauth gateway: $gw_out";; esac

echo "== remote entrypoint transport detection"
if bash -c 'rea() { printf "code: COMMAND_NOT_FOUND\nmessage: \x27--http\x27 is not a command\n"; }; source <(sed -n "/^native_supported()/,/^}/p" remote/entrypoint.sh); native_supported && exit 1 || exit 0'; then pass "entrypoint picks bridge on rea 6.7.0"; else bad "entrypoint misdetects native on 6.7.0"; fi
if bash -c 'rea() { printf "Usage: rea mcp --http\n  --host  Listener address\n  --port  Listener port\n"; }; source <(sed -n "/^native_supported()/,/^}/p" remote/entrypoint.sh); native_supported'; then pass "entrypoint picks native when --http is supported"; else bad "entrypoint misses native support"; fi

echo "== desktop extension manifest"
python3 - <<'PY' && pass "desktop/manifest.json shape (mcpb 0.3, node server, user_config)" || bad "desktop/manifest.json shape"
import json
m=json.load(open('desktop/manifest.json'))
assert m['manifest_version']=='0.3' and m['server']['type']=='node'
assert 'launch-rea.cjs' in m['server']['entry_point']
assert set(m['user_config'])>= {'ghidra_install_dir','jadx_mcp_jar'}
PY

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
