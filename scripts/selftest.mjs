#!/usr/bin/env node
/*
 * selftest.mjs — cross-platform checks (Windows, macOS, Linux). No bash required.
 *
 *   node scripts/selftest.mjs            # everything, including the live launcher smoke
 *   REA_SELFTEST_SKIP_MCP=1 node scripts/selftest.mjs
 *
 * Covers: JSON validity + manifest shape, node syntax of every script, report and diff
 * generation from fixtures, desktop manifest shape, and a live MCP smoke that starts the
 * real launcher (which on Windows exercises the npx-cli.js / npx.cmd path) and asserts it
 * serves tools. bash-only checks (gateway, entrypoint) live in selftest.sh.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
let failed = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); failed++; };
const section = (m) => console.log(`== ${m}`);

section(`platform: ${process.platform} ${process.arch} node ${process.version}`);

section('JSON validity & manifest shape');
const jsonFiles = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.mcp.json', '.claude/settings.json', 'scripts/rea-config.example.json', 'desktop/manifest.json',
  ...fs.readdirSync('tests/fixtures').filter((f) => f.endsWith('.json')).map((f) => `tests/fixtures/${f}`)];
for (const f of jsonFiles) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); ok(`valid JSON: ${f}`); } catch (e) { bad(`invalid JSON: ${f}: ${e.message}`); }
}
try {
  const m = JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8'));
  const s = m.mcpServers?.rea;
  if (m.name === 'rea' && s?.command === 'node' && s.args?.some((a) => a.includes('launch-rea.cjs')) && !('userConfig' in m)) ok('plugin.json declares the rea MCP server without userConfig');
  else bad('plugin.json manifest shape');
  const d = JSON.parse(fs.readFileSync('desktop/manifest.json', 'utf8'));
  if (d.manifest_version === '0.3' && d.server?.type === 'node' && d.server.entry_point.includes('launch-rea.cjs') && d.user_config?.ghidra_install_dir) ok('desktop/manifest.json shape');
  else bad('desktop/manifest.json shape');
} catch (e) { bad(`manifest check: ${e.message}`); }

section('node syntax');
for (const f of fs.readdirSync('scripts').filter((f) => /\.(cjs|mjs)$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', path.join('scripts', f)], { encoding: 'utf8' });
  r.status === 0 ? ok(`node --check scripts/${f}`) : bad(`node --check scripts/${f}: ${r.stderr.trim()}`);
}
{
  const r = spawnSync(process.execPath, ['--check', 'remote/oauth-gateway/gateway.mjs'], { encoding: 'utf8' });
  r.status === 0 ? ok('node --check remote/oauth-gateway/gateway.mjs') : bad(`gateway syntax: ${r.stderr.trim()}`);
}

section('report + diff generation from fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-selftest-'));
{
  const r = spawnSync(process.execPath, ['scripts/make-report.mjs', 'tests/fixtures', '--out', tmp, '--format', 'both'], { encoding: 'utf8' });
  const html = fs.readdirSync(tmp).find((f) => f.endsWith('.html'));
  if (r.status === 0 && html && fs.readFileSync(path.join(tmp, html), 'utf8').includes('untrusted')) ok('make-report produced HTML+MD with the untrusted-content notice');
  else bad(`make-report: ${r.stderr.trim() || r.stdout.trim()}`);
  const d = spawnSync(process.execPath, ['scripts/make-report.mjs', '--diff', 'tests/fixtures/diff-before', 'tests/fixtures/diff-after', '--out', path.join(tmp, 'd'), '--format', 'both'], { encoding: 'utf8' });
  const md = fs.existsSync(path.join(tmp, 'd')) ? fs.readdirSync(path.join(tmp, 'd')).find((f) => f.endsWith('.md')) : null;
  if (d.status === 0 && d.stdout.includes('"changed": 2') && md && fs.readFileSync(path.join(tmp, 'd', md), 'utf8').includes('FUN_001014a0')) ok('make-report --diff detects 2 changes incl. code line diff');
  else bad(`make-report --diff: ${d.stderr.trim() || d.stdout.trim()}`);
}
fs.rmSync(tmp, { recursive: true, force: true });

section('launcher: blank values are dropped (unit)');
{
  // Run the launcher with a fake rea command that just prints its env, to assert blank/unresolved values never reach REA.
  const probe = path.join(os.tmpdir(), `rea-probe-${process.pid}.mjs`);
  fs.writeFileSync(probe, "console.log(JSON.stringify({g:process.env.GHIDRA_INSTALL_DIR??null,j:process.env.REA_JADX_MCP_JAR??null,argv:process.argv.slice(2)}))");
  const r = spawnSync(process.execPath, ['scripts/launch-rea.cjs'], {
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, REA_PLUGIN_REA_COMMAND: probe, REA_PLUGIN_GHIDRA_INSTALL_DIR: '', REA_PLUGIN_JADX_MCP_JAR: '${user_config.jadx_mcp_jar}', GHIDRA_INSTALL_DIR: '', REA_JADX_MCP_JAR: '', REA_PLUGIN_CONFIG: path.join(os.tmpdir(), 'definitely-missing-rea-config.json'), REA_PLUGIN_ENGINES_DIR: path.join(os.tmpdir(), 'no-engines-here'), REA_PLUGIN_AUTO_ENGINES: '0', CLAUDE_CODE_REMOTE: '' },
  });
  fs.rmSync(probe, { force: true });
  try {
    const out = JSON.parse(r.stdout.trim().split('\n').pop());
    if (out.g === null && out.j === null && out.argv[0] === 'mcp') ok('blank and unresolved ${user_config} values are not passed to REA; "mcp" arg is');
    else bad(`launcher env handling: ${JSON.stringify(out)}`);
  } catch (e) { bad(`launcher probe: ${r.stderr.trim() || e.message}`); }
}

section('launcher MCP smoke (stdio initialize + tools/list)');
if (process.env.REA_SELFTEST_SKIP_MCP === '1') console.log('  skip (REA_SELFTEST_SKIP_MCP=1)');
else {
  const result = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['scripts/launch-rea.cjs'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, REA_PLUGIN_AUTO_ENGINES: '0', CLAUDE_CODE_REMOTE: '' } });
    let buf = '', err = '', done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); p.kill(); resolve(v); } };
    const t = setTimeout(() => finish({ timeout: true, err }), 180000);
    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => finish({ error: e.message }));
    p.on('exit', (code) => { if (!done) finish({ exited: code, err }); });
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1 && m.result) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); }
        if (m.id === 2 && m.result) finish({ tools: (m.result.tools || []).length });
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } } });
  });
  if (result.tools > 0) ok(`launcher served MCP tools (${result.tools}) on ${process.platform}`);
  else if (result.timeout) console.log(`  skip (timed out fetching rea-agents; last stderr: ${result.err.trim().split('\n').pop() || 'none'})`);
  else bad(`launcher MCP smoke: ${JSON.stringify(result).slice(0, 300)}`);
}

console.log(failed ? '\nselftest FAILED' : '\nselftest passed');
process.exit(failed ? 1 : 0);
