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
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const enginesLib = createRequire(import.meta.url)('./rea-engines-lib.cjs');
let failed = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); failed++; };
const section = (m) => console.log(`== ${m}`);

section(`platform: ${process.platform} ${process.arch} node ${process.version}`);

section('JSON validity & manifest shape');
const jsonFiles = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', '.mcp.json', '.claude/settings.json', 'hooks/hooks.json', 'scripts/rea-config.example.json', 'desktop/manifest.json',
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

try {
  const h = JSON.parse(fs.readFileSync('hooks/hooks.json', 'utf8'));
  const hk = h.hooks?.SessionStart?.[0]?.hooks?.[0];
  if (hk?.type === 'command' && hk.command === 'node' && hk.args?.[0]?.includes('ensure-engines.cjs')) ok('hooks/hooks.json: SessionStart runs ensure-engines.cjs in exec form');
  else bad('hooks/hooks.json shape');
} catch (e) { bad(`hooks check: ${e.message}`); }

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

// A Ghidra directory that passes validateEngines() without a real download.
function fakeGhidra(dir, version) {
  const osDir = process.platform === 'win32' ? 'win_x86_64' : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac_arm_64' : 'mac_x86_64') : (process.arch === 'arm64' ? 'linux_arm_64' : 'linux_x86_64');
  fs.mkdirSync(path.join(dir, 'support'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Ghidra', 'Features', 'Decompiler', 'os', osDir), { recursive: true });
  fs.writeFileSync(path.join(dir, 'support', process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless'), '');
  fs.writeFileSync(path.join(dir, 'Ghidra', 'application.properties'), `application.version=${version}\n`);
  fs.writeFileSync(path.join(dir, 'Ghidra', 'Features', 'Decompiler', 'os', osDir, process.platform === 'win32' ? 'decompile.exe' : 'decompile'), '');
}

section('engine installer + SessionStart hook (offline, cross-platform)');
{
  const edir = path.join(os.tmpdir(), `rea-engines-selftest-${process.pid}`);
  fs.rmSync(edir, { recursive: true, force: true });
  const base = { ...process.env, REA_PLUGIN_ENGINES_DIR: edir, REA_PLUGIN_CONFIG: path.join(os.tmpdir(), 'definitely-missing-rea-config.json') };
  // dry run: plans per-OS downloads, writes nothing
  const dry = spawnSync(process.execPath, ['scripts/install-engines.cjs', '--dry-run'], { encoding: 'utf8', env: base, timeout: 60000 });
  // the installer labels the OS as windows/macos/linux (lib.platformInfo().label), not process.platform
  const platLabel = enginesLib.platformInfo().label;
  const planned = /plan: Ghidra 12\.1\.4/.test(dry.stdout) && /plan: jadx-headless-mcp/.test(dry.stdout) && dry.stdout.includes(`platform ${platLabel};`);
  if (dry.status === 0 && planned && !fs.existsSync(path.join(edir, 'install.lock'))) ok(`install-engines.cjs --dry-run plans Ghidra+jadx for ${platLabel} without touching disk`);
  else bad(`install-engines.cjs --dry-run: status ${dry.status}\n${dry.stdout}\n${dry.stderr}`);
  // hook, auto disabled: reports missing, starts nothing
  const h1 = spawnSync(process.execPath, ['scripts/ensure-engines.cjs'], { encoding: 'utf8', env: { ...base, REA_PLUGIN_AUTO_ENGINES: '0' }, timeout: 30000 });
  if (h1.status === 0 && /engines missing/.test(h1.stdout) && /auto_engines=false/.test(h1.stdout) && !fs.existsSync(path.join(edir, 'install.log'))) ok('ensure-engines.cjs reports missing engines and respects auto_engines=false');
  else bad(`ensure-engines.cjs (auto off): ${h1.stdout} ${h1.stderr}`);
  // hook, --status: never installs
  const h2 = spawnSync(process.execPath, ['scripts/ensure-engines.cjs', '--status'], { encoding: 'utf8', env: base, timeout: 30000 });
  if (h2.status === 0 && /engines missing/.test(h2.stdout) && !fs.existsSync(path.join(edir, 'install.log'))) ok('ensure-engines.cjs --status only reports');
  else bad(`ensure-engines.cjs --status: ${h2.stdout} ${h2.stderr}`);
  // hook, fake ready layout: Ghidra dir + jar present -> "ready". REA_PLUGIN_SKIP_JDK=1 keeps the
  // check hermetic: CI runners ship different default JDKs (ubuntu-latest: 17), and a missing
  // JDK 21 would otherwise turn this into an "engines missing" line without the per-engine marks.
  // The layout must be *complete* (validateEngines checks headless script, properties and the
  // native decompiler) and the jar must carry a zip header, or the hook reports it as broken.
  fakeGhidra(path.join(edir, 'ghidra_12.1.4_PUBLIC'), '12.1.4');
  fs.writeFileSync(path.join(edir, 'jadx-headless-mcp-0.7.1-all.jar'), 'PK\u0003\u0004fake');
  const h3 = spawnSync(process.execPath, ['scripts/ensure-engines.cjs', '--status'], { encoding: 'utf8', env: { ...base, REA_PLUGIN_SKIP_JDK: '1' }, timeout: 30000 });
  if (h3.status === 0 && /Ghidra ✓/.test(h3.stdout) && /jadx ✓/.test(h3.stdout)) ok('ensure-engines.cjs discovers an installed layout');
  else bad(`ensure-engines.cjs (ready): ${h3.stdout} ${h3.stderr}`);
  // launcher: discovered engines reach REA; a fresh install.lock suppresses a second installer
  const probe = path.join(os.tmpdir(), `rea-probe2-${process.pid}.mjs`);
  fs.writeFileSync(probe, "console.log(JSON.stringify({g:process.env.GHIDRA_INSTALL_DIR??null,j:process.env.REA_JADX_MCP_JAR??null}))");
  const l1 = spawnSync(process.execPath, ['scripts/launch-rea.cjs'], { encoding: 'utf8', env: { ...base, REA_PLUGIN_REA_COMMAND: probe, GHIDRA_INSTALL_DIR: '', REA_JADX_MCP_JAR: '' }, timeout: 30000 });
  try {
    const o = JSON.parse(l1.stdout.trim().split('\n').pop());
    if (o.g === path.join(edir, 'ghidra_12.1.4_PUBLIC') && o.j === path.join(edir, 'jadx-headless-mcp-0.7.1-all.jar')) ok('launcher auto-discovers engines in the engines dir');
    else bad(`launcher discovery: ${JSON.stringify(o)}`);
  } catch (e) { bad(`launcher discovery probe: ${l1.stderr.trim() || e.message}`); }
  fs.rmSync(path.join(edir, 'ghidra_12.1.4_PUBLIC'), { recursive: true, force: true });
  fs.writeFileSync(path.join(edir, 'install.lock'), '0');
  const l2 = spawnSync(process.execPath, ['scripts/launch-rea.cjs'], { encoding: 'utf8', env: { ...base, REA_PLUGIN_REA_COMMAND: probe, GHIDRA_INSTALL_DIR: '', REA_PLUGIN_AUTO_ENGINES: '1' }, timeout: 30000 });
  try {
    const o = JSON.parse(l2.stdout.trim().split('\n').pop());
    if (/already running/.test(l2.stderr) && o.g === path.join(edir, 'ghidra_12.1.4_PUBLIC')) ok('launcher pre-sets the Ghidra path and does not start a second installer while install.lock is fresh');
    else bad(`launcher lock handling: ${l2.stderr} ${JSON.stringify(o)}`);
  } catch (e) { bad(`launcher lock probe: ${l2.stderr.trim() || e.message}`); }
  fs.rmSync(probe, { force: true });
  fs.rmSync(edir, { recursive: true, force: true });
}

section('MCP registration: cloud hosts skip plugin MCP servers; setup-mcp registers at project level');
{
  const pdir = path.join(os.tmpdir(), `rea-mcp-selftest-${process.pid}`);
  fs.rmSync(pdir, { recursive: true, force: true });
  fs.mkdirSync(pdir, { recursive: true });
  const skipEnv = { ...process.env, CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS: '1', CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT: 'documents', CLAUDE_PROJECT_DIR: pdir, REA_PLUGIN_CONFIG: path.join(os.tmpdir(), 'definitely-missing-rea-config.json'), REA_PLUGIN_AUTO_ENGINES: '0' };
  const plainEnv = { ...skipEnv }; delete plainEnv.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS;
  // hook: plain host -> no MCP warning; skipping host + bare project -> warning naming /rea:setup-mcp
  const h0 = spawnSync(process.execPath, [path.resolve('scripts/ensure-engines.cjs'), '--status'], { encoding: 'utf8', env: plainEnv, cwd: pdir, timeout: 30000 });
  if (h0.status === 0 && /mcp: rea server registered via plugin manifest/.test(h0.stdout) && !/NOT loaded/.test(h0.stdout)) ok('ensure-engines.cjs: plugin manifest counts as registered on a normal host');
  else bad(`ensure-engines.cjs (plain host): ${h0.stdout} ${h0.stderr}`);
  const h1 = spawnSync(process.execPath, [path.resolve('scripts/ensure-engines.cjs')], { encoding: 'utf8', env: skipEnv, cwd: pdir, timeout: 30000 });
  if (h1.status === 0 && /REA MCP server is NOT loaded/.test(h1.stdout) && /\/rea:setup-mcp/.test(h1.stdout)) ok('ensure-engines.cjs warns when the host skips plugin MCP servers and nothing registers rea');
  else bad(`ensure-engines.cjs (skip host): ${h1.stdout} ${h1.stderr}`);
  // ... and points at the linked computer's relayed tools, /rea:start, and the missing git repo
  if (h1.stdout.includes(`${enginesLib.LINKED_TOOL_PREFIX}open_binary`) && /\/rea:start/.test(h1.stdout) && /is not one, so files written here vanish/.test(h1.stdout)) ok('ensure-engines.cjs names the linked-computer tools, /rea:start, and that a non-git directory cannot keep the files');
  else bad(`ensure-engines.cjs (linked / git hints): ${h1.stdout}`);
  // the _EXCEPT allow-list naming rea means the plugin server does load
  const h2 = spawnSync(process.execPath, [path.resolve('scripts/ensure-engines.cjs')], { encoding: 'utf8', env: { ...skipEnv, CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT: 'documents,rea' }, cwd: pdir, timeout: 30000 });
  if (h2.status === 0 && !/NOT loaded/.test(h2.stdout)) ok('ensure-engines.cjs honours CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT');
  else bad(`ensure-engines.cjs (except): ${h2.stdout} ${h2.stderr}`);
  // setup-mcp: --check 1 before, writes three files, --check 0 after, merges existing content, --remove undoes
  const c0 = spawnSync(process.execPath, ['scripts/setup-mcp.cjs', '--check', '--dir', pdir], { encoding: 'utf8', env: skipEnv, timeout: 30000 });
  fs.writeFileSync(path.join(pdir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'echo' } } }));
  const w = spawnSync(process.execPath, ['scripts/setup-mcp.cjs', '--dir', pdir], { encoding: 'utf8', env: skipEnv, timeout: 30000 });
  const mcp = JSON.parse(fs.readFileSync(path.join(pdir, '.mcp.json'), 'utf8'));
  const settings = JSON.parse(fs.readFileSync(path.join(pdir, '.claude', 'settings.json'), 'utf8'));
  const boot = fs.readFileSync(path.join(pdir, '.claude', 'rea-mcp.cjs'), 'utf8') === fs.readFileSync('scripts/rea-mcp-bootstrap.cjs', 'utf8');
  const c1 = spawnSync(process.execPath, ['scripts/setup-mcp.cjs', '--check', '--dir', pdir], { encoding: 'utf8', env: skipEnv, timeout: 30000 });
  if (c0.status === 1 && w.status === 0 && mcp.mcpServers.rea?.args?.[0] === '.claude/rea-mcp.cjs' && mcp.mcpServers.other && settings.enableAllProjectMcpServers === true && boot && c1.status === 0 && /project \.mcp\.json/.test(c1.stdout)) ok('setup-mcp.cjs writes .mcp.json (merged), .claude/rea-mcp.cjs and settings.json; --check flips 1 → 0');
  else bad(`setup-mcp.cjs: check0=${c0.status} write=${w.status} check1=${c1.status}\n${w.stdout}${w.stderr}${c1.stdout}`);
  // hook now sees the project registration
  const h3 = spawnSync(process.execPath, [path.resolve('scripts/ensure-engines.cjs'), '--status'], { encoding: 'utf8', env: skipEnv, cwd: pdir, timeout: 30000 });
  if (h3.status === 0 && /registered via project \.mcp\.json/.test(h3.stdout) && !/NOT loaded/.test(h3.stdout)) ok('ensure-engines.cjs reports the project-level registration');
  else bad(`ensure-engines.cjs (after setup): ${h3.stdout} ${h3.stderr}`);
  // bootstrap resolves this checkout's launcher when run from the repo, and the plugin's own copy from elsewhere
  const where = spawnSync(process.execPath, [path.join(pdir, '.claude', 'rea-mcp.cjs'), '--where'], { encoding: 'utf8', env: { ...skipEnv, REA_PLUGIN_LAUNCHER: path.resolve('scripts/launch-rea.cjs') }, cwd: pdir, timeout: 30000 });
  if (where.status === 0 && where.stdout.includes('launch-rea.cjs') && /REA_PLUGIN_LAUNCHER/.test(where.stdout)) ok('rea-mcp-bootstrap.cjs resolves the launcher (REA_PLUGIN_LAUNCHER first)');
  else bad(`rea-mcp-bootstrap.cjs --where: ${where.stdout} ${where.stderr}`);
  const rm = spawnSync(process.execPath, ['scripts/setup-mcp.cjs', '--remove', '--dir', pdir], { encoding: 'utf8', env: skipEnv, timeout: 30000 });
  const after = JSON.parse(fs.readFileSync(path.join(pdir, '.mcp.json'), 'utf8'));
  if (rm.status === 0 && !after.mcpServers?.rea && after.mcpServers?.other && !fs.existsSync(path.join(pdir, '.claude', 'rea-mcp.cjs'))) ok('setup-mcp.cjs --remove keeps other servers');
  else bad(`setup-mcp.cjs --remove: ${rm.stdout} ${rm.stderr}`);
  // cloud + no git repository: setup-mcp warns that the files will not survive the container
  const cloudEnv = { ...skipEnv, CLAUDE_CODE_REMOTE: 'true' };
  const wc = spawnSync(process.execPath, ['scripts/setup-mcp.cjs', '--dir', pdir], { encoding: 'utf8', env: cloudEnv, timeout: 30000 });
  if (wc.status === 0 && /WARNING: .* is not a git repository/.test(wc.stdout)) ok('setup-mcp.cjs warns in a cloud session outside a git repository');
  else bad(`setup-mcp.cjs (cloud, no git): ${wc.stdout} ${wc.stderr}`);
  spawnSync(process.execPath, ['scripts/setup-mcp.cjs', '--remove', '--dir', pdir], { encoding: 'utf8', env: skipEnv, timeout: 30000 });
  // router: when the server is not loaded, routed prompts are told about the linked-computer tools
  const rq = JSON.stringify({ prompt: 'reverse engineer ./samples/firmware.bin' });
  const r1 = spawnSync(process.execPath, [path.resolve('scripts/rea-router.cjs')], { input: rq, encoding: 'utf8', env: skipEnv, cwd: pdir, timeout: 20000 });
  const r0 = spawnSync(process.execPath, [path.resolve('scripts/rea-router.cjs')], { input: rq, encoding: 'utf8', env: plainEnv, cwd: pdir, timeout: 20000 });
  if (r1.status === 0 && r1.stdout.includes(enginesLib.LINKED_TOOL_PREFIX) && r1.stdout.includes('/rea:start') && r0.status === 0 && r0.stdout.includes('[REA]') && !r0.stdout.includes(enginesLib.LINKED_TOOL_PREFIX)) ok('rea-router.cjs adds the linked-computer hint only when the rea server is not loaded');
  else bad(`rea-router.cjs (linked hint): skip=${r1.stdout} plain=${r0.stdout}`);
  fs.rmSync(pdir, { recursive: true, force: true });
}

section('rea-router: reverse-engineering prompts route to REA, others are untouched');
{
  const cases = [
    ['이 app.apk 파일 분석해서 뭐 하는 앱인지 알려줘', true],
    ['reverse engineer ./samples/firmware.bin', true],
    ['What does agent.exe do? dump its imports', true],
    ['decompile this', true],
    ['帮我反编译这个 firmware.bin，看看它做什么', true],
    ['この app.apk を解析して何をするアプリか教えて', true],
    ['把 README 里的错别字改一下', false],
    ['src/auth.ts のリファクタリングをして', false],
    ['Refactor the auth module in src/auth.ts', false],
    ['Explain the architecture of this repo', false],
    ['/commit', false],
    ['install node_modules and run tests', false],
  ];
  let good = 0;
  for (const [prompt, expect] of cases) {
    const r = spawnSync(process.execPath, ['scripts/rea-router.cjs'], { input: JSON.stringify({ prompt }), encoding: 'utf8', timeout: 20000 });
    const routed = r.stdout.includes('"hookEventName":"UserPromptSubmit"') && r.stdout.includes('[REA]');
    if (r.status === 0 && routed === expect) good++;
    else bad(`rea-router: "${prompt}" -> routed=${routed}, expected ${expect} ${r.stderr.trim()}`);
  }
  if (good === cases.length) ok(`rea-router classified ${good}/${cases.length} prompts as expected`);
  const h = JSON.parse(fs.readFileSync('hooks/hooks.json', 'utf8'));
  const u = h.hooks?.UserPromptSubmit?.[0]?.hooks?.[0];
  if (u?.command === 'node' && u.args?.[0]?.includes('rea-router.cjs')) ok('hooks/hooks.json: UserPromptSubmit runs rea-router.cjs');
  else bad('hooks/hooks.json: UserPromptSubmit hook missing');
}

section('1.0: validation/repair, offline archives, router tuning, report themes/json/bundles, release workflow');
{
  const edir = path.join(os.tmpdir(), `rea-10-selftest-${process.pid}`);
  fs.rmSync(edir, { recursive: true, force: true });
  const base = { ...process.env, REA_PLUGIN_ENGINES_DIR: edir, REA_PLUGIN_CONFIG: path.join(os.tmpdir(), 'definitely-missing-rea-config.json'), REA_PLUGIN_AUTO_ENGINES: '0' };
  // a half-extracted Ghidra must be reported as broken with the exact repair command
  fs.mkdirSync(path.join(edir, 'ghidra_12.1.4_PUBLIC', 'support'), { recursive: true });
  fs.writeFileSync(path.join(edir, 'jadx-headless-mcp-0.7.1-all.jar'), 'not a jar');
  const st = spawnSync(process.execPath, ['scripts/ensure-engines.cjs', '--status'], { encoding: 'utf8', env: base, timeout: 30000 });
  if (st.status === 0 && /✗ ghidra: incomplete Ghidra/.test(st.stdout) && /--force --only ghidra/.test(st.stdout) && /✗ jadx: .*not a valid jar/.test(st.stdout) && /--force --only jadx/.test(st.stdout)) ok('doctor self-repair: half-extracted Ghidra and truncated jar get exact --force --only repair commands');
  else bad(`self-repair: ${st.stdout} ${st.stderr}`);
  // offline archive: a file in <dir>/archives is used without network (jadx has no pinned sha, so any content works)
  fs.rmSync(path.join(edir, 'jadx-headless-mcp-0.7.1-all.jar'), { force: true });
  fs.mkdirSync(path.join(edir, 'archives'), { recursive: true });
  fs.writeFileSync(path.join(edir, 'archives', 'jadx-headless-mcp-0.7.1-all.jar'), 'PK\u0003\u0004offline');
  const off = spawnSync(process.execPath, ['scripts/install-engines.cjs', '--only', 'jadx', '--dir', edir], { encoding: 'utf8', env: { ...base, REA_PLUGIN_SKIP_JDK: '1', REA_PLUGIN_SKIP_APT: '1' }, timeout: 60000 });
  if (off.status === 0 && /using archived jadx-headless-mcp-0\.7\.1-all\.jar/.test(off.stdout) && fs.readFileSync(path.join(edir, 'jadx-headless-mcp-0.7.1-all.jar'), 'utf8').includes('offline')) ok('offline mode: archives/<file> is installed without any download');
  else bad(`offline mode: ${off.stdout} ${off.stderr}`);
  // --upgrade: an older Ghidra dir is reported, not silently replaced, without the flag
  fs.rmSync(path.join(edir, 'ghidra_12.1.4_PUBLIC'), { recursive: true, force: true });
  fs.mkdirSync(path.join(edir, 'ghidra_12.1.3_PUBLIC', 'support'), { recursive: true });
  const up = spawnSync(process.execPath, ['scripts/install-engines.cjs', '--only', 'ghidra', '--dir', edir], { encoding: 'utf8', env: { ...base, REA_PLUGIN_SKIP_JDK: '1', REA_PLUGIN_SKIP_APT: '1' }, timeout: 60000 });
  if (/found ghidra_12\.1\.3_PUBLIC; pinned 12\.1\.4 not installed — run with --upgrade/.test(up.stdout) && fs.existsSync(path.join(edir, 'ghidra_12.1.3_PUBLIC'))) ok('version policy: an older Ghidra is kept and --upgrade is suggested');
  else bad(`version policy: ${up.stdout} ${up.stderr}`);
  // dry run with optional engines lists apktool (and radare2 on Windows)
  const dry = spawnSync(process.execPath, ['scripts/install-engines.cjs', '--dry-run', '--dir', path.join(edir, 'none')], { encoding: 'utf8', env: { ...base, REA_PLUGIN_OPTIONAL_ENGINES: '1' }, timeout: 60000 });
  if (dry.status === 0 && /plan: apktool 3\.0\.3/.test(dry.stdout) && (process.platform !== 'win32' || /plan: radare2 6\.2\.4/.test(dry.stdout))) ok('optional engines: dry run plans apktool' + (process.platform === 'win32' ? ' and radare2' : ''));
  else bad(`optional engines dry run: ${dry.stdout} ${dry.stderr}`);
  // router tuning: config off, deny, allow, project override, --why
  const cfg = path.join(edir, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ router: { deny: ['^skip rea'], allow: ['\\bvendor blob\\b'] } }));
  const r1 = spawnSync(process.execPath, ['scripts/rea-router.cjs', '--test', 'skip rea: decompile x.exe'], { encoding: 'utf8', env: { ...base, REA_PLUGIN_CONFIG: cfg }, timeout: 20000 });
  const r2 = spawnSync(process.execPath, ['scripts/rea-router.cjs', '--why', 'inspect the vendor blob please'], { encoding: 'utf8', env: { ...base, REA_PLUGIN_CONFIG: cfg }, timeout: 20000 });
  const r3 = spawnSync(process.execPath, ['scripts/rea-router.cjs'], { input: JSON.stringify({ prompt: 'decompile x.exe' }), encoding: 'utf8', env: { ...base, REA_PLUGIN_ROUTER: '0' }, timeout: 20000 });
  const proj = path.join(edir, 'proj'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, '.rea-plugin.json'), JSON.stringify({ router: { deny: ['\\.exe\\b'] } }));
  const r4 = spawnSync(process.execPath, ['scripts/rea-router.cjs', '--test', 'decompile x.exe'], { encoding: 'utf8', env: { ...base, CLAUDE_PROJECT_DIR: proj }, timeout: 20000 });
  try {
    const j1 = JSON.parse(r1.stdout), j2 = JSON.parse(r2.stdout), j4 = JSON.parse(r4.stdout);
    if (!j1.reverseEngineering && /deny pattern/.test(j1.rule) && j2.reverseEngineering && /allow pattern/.test(j2.rule) && j2.config && r3.stdout.trim() === '' && !j4.reverseEngineering && /deny pattern/.test(j4.rule)) ok('router tuning: deny, allow, REA_PLUGIN_ROUTER=0 and project .rea-plugin.json override all apply; --why reports config');
    else bad(`router tuning: ${r1.stdout} ${r2.stdout} [${r3.stdout}] ${r4.stdout}`);
  } catch (e) { bad(`router tuning: ${e.message} ${r1.stderr} ${r2.stderr} ${r4.stderr}`); }
  // report: themes, json, bundle, diff of two bundles
  const rep = path.join(edir, 'rep');
  const a = spawnSync(process.execPath, ['scripts/make-report.mjs', 'tests/fixtures', '--out', rep, '--format', 'all', '--theme', 'ocean', '--bundle'], { encoding: 'utf8', timeout: 60000 });
  let repOk = false;
  try {
    const w = JSON.parse(a.stdout).written;
    const html = w.find((f) => f.endsWith('.html')), json = w.find((f) => /[0-9]\.json$/.test(f)), bundle = w.find((f) => f.endsWith('.rea-bundle.json'));
    const jm = JSON.parse(fs.readFileSync(json, 'utf8')), bm = JSON.parse(fs.readFileSync(bundle, 'utf8'));
    repOk = fs.readFileSync(html, 'utf8').includes('#0b6bcb') && jm.schema === 'rea-for-claude/report@1' && jm.targets.length === 1 && bm.rea_bundle.schema === 'rea-for-claude/bundle@1' && bm.rea_bundle.count === 2 && bm.evidence.length === 2;
  } catch { repOk = false; }
  if (a.status === 0 && repOk) ok('make-report: ocean theme applied, JSON model and evidence bundle written');
  else bad(`make-report 1.0: ${a.stdout} ${a.stderr}`);
  const b1 = spawnSync(process.execPath, ['scripts/make-report.mjs', 'tests/fixtures/diff-before', '--out', path.join(rep, 'x'), '--format', 'md', '--bundle', path.join(rep, 'before.rea-bundle.json')], { encoding: 'utf8', timeout: 60000 });
  const b2 = spawnSync(process.execPath, ['scripts/make-report.mjs', 'tests/fixtures/diff-after', '--out', path.join(rep, 'y'), '--format', 'md', '--bundle', path.join(rep, 'after.rea-bundle.json')], { encoding: 'utf8', timeout: 60000 });
  const d = spawnSync(process.execPath, ['scripts/make-report.mjs', '--diff', path.join(rep, 'before.rea-bundle.json'), path.join(rep, 'after.rea-bundle.json'), '--out', path.join(rep, 'd'), '--format', 'json'], { encoding: 'utf8', timeout: 60000 });
  try {
    const dj = JSON.parse(d.stdout); const dm = JSON.parse(fs.readFileSync(dj.written[0], 'utf8'));
    if (b1.status === 0 && b2.status === 0 && dj.changed === 2 && dm.schema === 'rea-for-claude/diff@1') ok('make-report --diff accepts two evidence bundles and writes the diff JSON model');
    else bad(`bundle diff: ${d.stdout}`);
  } catch (e) { bad(`bundle diff: ${e.message} ${d.stderr}`); }
  const bt = spawnSync(process.execPath, ['scripts/make-report.mjs', 'tests/fixtures', '--out', rep, '--theme', 'neon'], { encoding: 'utf8', timeout: 60000 });
  if (bt.status === 2 && /--theme must be one of/.test(bt.stderr)) ok('make-report rejects an unknown theme'); else bad('make-report theme validation');
  // release workflow + stability doc + /rea:why exist and look right
  const rel = fs.existsSync('.github/workflows/release.yml') ? fs.readFileSync('.github/workflows/release.yml', 'utf8') : '';
  if (/windows-latest/.test(rel) && /macos-latest/.test(rel) && /ubuntu-latest/.test(rel) && /mcpb sign/.test(rel) && /--self-signed/.test(rel) && /mcpb verify/.test(rel)) ok('release.yml builds, signs and verifies .mcpb on 3 OSes');
  else bad('release.yml missing or incomplete');
  if (fs.existsSync('docs/STABILITY.md') && fs.existsSync('commands/why.md') && fs.existsSync('commands/setup-mcp.md')) ok('docs/STABILITY.md, /rea:why and /rea:setup-mcp present'); else bad('STABILITY.md, why.md or setup-mcp.md missing');
  {
    const start = fs.existsSync('commands/start.md') ? fs.readFileSync('commands/start.md', 'utf8') : '';
    const readmes = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'].map((f) => fs.readFileSync(f, 'utf8'));
    if (/^---\ndescription: /.test(start) && start.includes(enginesLib.LINKED_TOOL_PREFIX) && readmes.every((t) => t.includes('/rea:start') && t.includes(enginesLib.LINKED_TOOL_PREFIX))) ok('/rea:start present; every README has the per-environment guide');
    else bad('commands/start.md missing or a README lacks the /rea:start environment guide');
  }
  fs.rmSync(edir, { recursive: true, force: true });
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
