#!/usr/bin/env node
/*
 * rea-mcp-bootstrap.cjs — project-level entry point for the REA MCP server.
 *
 * `/rea:setup-mcp` copies this file into a repository as `.claude/rea-mcp.cjs` and points
 * `.mcp.json` at it. It exists for hosts that do not load plugin-declared MCP servers
 * (claude.ai cloud sessions set CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1): a project .mcp.json is
 * still honoured there, but it cannot reference ${CLAUDE_PLUGIN_ROOT}, so this file locates the
 * installed plugin's launcher at run time and hands over to it:
 *
 *   1. REA_PLUGIN_LAUNCHER            explicit path to launch-rea.cjs
 *   2. ./scripts/launch-rea.cjs       the project *is* REA-for-Claude
 *   3. the installed plugin           ~/.claude/plugins/{cache,synced,marketplaces}/**​/scripts/launch-rea.cjs
 *                                     (newest plugin version wins)
 *   4. fallback                       npx -y rea-agents@<pinned> mcp — REA without the plugin's
 *                                     engine auto-install; engine-free providers still work
 *
 * No dependencies; runs on Node 18+ on Windows, macOS and Linux.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REA_VERSION = '6.7.0';

function isLauncher(file) {
  return fs.existsSync(file) && fs.existsSync(path.join(path.dirname(file), 'rea-engines-lib.cjs'));
}

function pluginVersion(launcher) {
  try {
    const manifest = path.join(path.dirname(path.dirname(launcher)), '.claude-plugin', 'plugin.json');
    const j = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (j.name !== 'rea') return null;
    return String(j.version || '0');
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function findInstalledPlugin() {
  const home = os.homedir();
  const roots = ['cache', 'synced', 'marketplaces'].map((d) => path.join(home, '.claude', 'plugins', d));
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      const sub = path.join(dir, e.name);
      const candidate = path.join(sub, 'scripts', 'launch-rea.cjs');
      if (isLauncher(candidate)) {
        const v = pluginVersion(candidate);
        if (v) { hits.push({ launcher: candidate, version: v }); continue; }
      }
      walk(sub, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  hits.sort((a, b) => compareVersions(b.version, a.version));
  return hits[0] ? hits[0].launcher : null;
}

function resolveLauncher() {
  const explicit = (process.env.REA_PLUGIN_LAUNCHER || '').trim();
  if (explicit && isLauncher(explicit)) return { launcher: explicit, how: 'REA_PLUGIN_LAUNCHER' };
  const local = path.resolve(process.cwd(), 'scripts', 'launch-rea.cjs');
  if (isLauncher(local)) return { launcher: local, how: 'this repository' };
  const here = path.resolve(__dirname, '..', 'scripts', 'launch-rea.cjs');
  if (isLauncher(here)) return { launcher: here, how: 'plugin checkout' };
  const installed = findInstalledPlugin();
  if (installed) return { launcher: installed, how: 'installed plugin' };
  return null;
}

function run(command, args, extra) {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...extra });
  child.on('error', (err) => { process.stderr.write(`[rea-mcp] failed to start ${command}: ${err.message}\n`); process.exit(1); });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { child.kill(sig); } catch { /* gone */ } });
}

function main() {
  const passthrough = process.argv.slice(2);
  if (passthrough[0] === '--where') {
    const r = resolveLauncher();
    process.stdout.write(r ? `${r.launcher} (${r.how})\n` : `none — would fall back to npx -y rea-agents@${REA_VERSION} mcp\n`);
    return;
  }
  const r = resolveLauncher();
  if (r) {
    run(process.execPath, [r.launcher, ...passthrough]);
    return;
  }
  process.stderr.write(`[rea-mcp] REA-for-Claude plugin not found on this machine; starting plain rea-agents@${REA_VERSION} (no engine auto-install — Ghidra/jadx tools answer provider_unavailable until installed). Install the plugin: claude plugin marketplace add NoLucas/REA-for-Claude && claude plugin install rea@rea-for-claude\n`);
  const reaArgs = passthrough[0] === 'doctor' ? passthrough : ['mcp', ...passthrough];
  const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (process.platform === 'win32' && fs.existsSync(npxCli)) {
    run(process.execPath, [npxCli, '-y', `rea-agents@${REA_VERSION}`, ...reaArgs]);
  } else {
    run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', `rea-agents@${REA_VERSION}`, ...reaArgs], { shell: process.platform === 'win32' });
  }
}

main();
