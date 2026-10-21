#!/usr/bin/env node
/*
 * Universal launcher for the REA (Reverse Engineer Anything) MCP server.
 *
 * One entry point for every place a Claude session can run:
 *   - Claude Code on your machine        (plugin or .mcp.json)
 *   - Claude Desktop / linked claude.ai  (claude_desktop_config.json or plugin)
 *   - claude.ai cloud sessions           (.mcp.json in this repo; engines auto-installed)
 *   - Docker "REA appliance"             (remote/Dockerfile)
 *
 * Configuration precedence for each engine path (first non-empty wins):
 *   1. the real REA variable in the environment   (GHIDRA_INSTALL_DIR, REA_JADX_MCP_JAR, ...)
 *   2. the plugin variable in the environment     (REA_PLUGIN_GHIDRA_INSTALL_DIR, ...)
 *   3. the config file                            ($REA_PLUGIN_CONFIG or ~/.rea-plugin.json)
 *   4. auto-discovery in the engines directory    (REA_PLUGIN_ENGINES_DIR / config.engines_dir /
 *                                                  ~/.rea-engines, or $CLAUDE_PLUGIN_DATA/engines)
 *
 * Empty values are dropped: REA rejects an empty GHIDRA_INSTALL_DIR ("must be absolute"),
 * and some hosts substitute blank plugin settings as "".
 *
 * Cloud mode (CLAUDE_CODE_REMOTE set, or REA_PLUGIN_AUTO_ENGINES=1, or config.auto_engines):
 * if Ghidra is missing on Linux, scripts/install-engines.sh is started detached and REA is
 * started immediately with the paths the installer will produce. REA resolves providers per
 * call, so once the install finishes you only need to re-open the target (open_binary).
 *
 * Windows + config.use_wsl: REA is executed inside WSL (wsl.exe -d <distro>) so the Linux-only
 * tooling (binwalk, tshark, mitmproxy, Linux Ghidra) is available while Claude runs on Windows.
 * Paths in the config must then be Linux paths.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_REA_VERSION = '6.7.0';
const GHIDRA_DIR_NAME = 'ghidra_12.1.4_PUBLIC';
const JADX_JAR_NAME = 'jadx-headless-mcp-0.7.1-all.jar';
const PLUGIN_ROOT = path.resolve(__dirname, '..');

// plugin env name -> [real REA env name, config key]
const ENGINES = {
  REA_PLUGIN_GHIDRA_INSTALL_DIR: ['GHIDRA_INSTALL_DIR', 'ghidra_install_dir'],
  REA_PLUGIN_JADX_MCP_JAR: ['REA_JADX_MCP_JAR', 'jadx_mcp_jar'],
  REA_PLUGIN_KUNA_COMMAND: ['REA_KUNA_COMMAND', 'kuna_command'],
  REA_PLUGIN_IDA_MCP_CONFIG: ['REA_IDA_MCP_CONFIG', 'ida_mcp_config'],
  REA_PLUGIN_BROWSER_EXECUTABLE: ['REA_BROWSER_EXECUTABLE', 'browser_executable'],
};

const log = (msg) => process.stderr.write(`[rea-plugin] ${msg}\n`);
// POSIX single-quote escaping for values embedded in `bash -lc` (WSL mode).
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const clean = (v) =>
  typeof v === 'string' && v.trim() !== '' && !v.trim().startsWith('${') ? v.trim() : undefined;

function readConfig() {
  const candidates = [
    clean(process.env.REA_PLUGIN_CONFIG),
    path.join(os.homedir(), '.rea-plugin.json'),
    clean(process.env.CLAUDE_PLUGIN_DATA) && path.join(process.env.CLAUDE_PLUGIN_DATA, 'config.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        log(`config: ${file}`);
        return parsed;
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') log(`config ${file} ignored: ${err.message}`);
    }
  }
  return {};
}

function enginesDir(config) {
  return (
    clean(process.env.REA_PLUGIN_ENGINES_DIR) ||
    clean(config.engines_dir) ||
    (clean(process.env.CLAUDE_PLUGIN_DATA) && path.join(process.env.CLAUDE_PLUGIN_DATA, 'engines')) ||
    path.join(os.homedir(), '.rea-engines')
  );
}

function discover(dir) {
  const found = {};
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return found;
  }
  const ghidra = entries.filter((e) => /^ghidra_12\.1\.\d+_PUBLIC$/.test(e)).sort().pop();
  if (ghidra && fs.existsSync(path.join(dir, ghidra, 'support'))) found.GHIDRA_INSTALL_DIR = path.join(dir, ghidra);
  const jadx = entries.filter((e) => /^jadx-headless-mcp-.*-all\.jar$/.test(e)).sort().pop();
  if (jadx) found.REA_JADX_MCP_JAR = path.join(dir, jadx);
  const kuna = entries.find((e) => e === 'kuna' || e === 'kuna.exe');
  if (kuna) found.REA_KUNA_COMMAND = path.join(dir, kuna);
  return found;
}

function main() {
  const config = readConfig();
  const env = { ...process.env };
  const dir = enginesDir(config);
  const discovered = discover(dir);

  for (const [pluginKey, [reaKey, configKey]] of Object.entries(ENGINES)) {
    const value =
      clean(env[reaKey]) || clean(env[pluginKey]) || clean(config[configKey]) || discovered[reaKey];
    delete env[pluginKey];
    if (value) env[reaKey] = value;
    else delete env[reaKey];
  }
  for (const [k, v] of Object.entries(config.env || {})) {
    if (clean(v) && !clean(env[k])) env[k] = String(v).trim();
  }

  const version = clean(env.REA_PLUGIN_VERSION) || clean(config.rea_version) || DEFAULT_REA_VERSION;
  delete env.REA_PLUGIN_VERSION;

  const isCloud = Boolean(clean(env.CLAUDE_CODE_REMOTE));
  const autoEngines =
    clean(env.REA_PLUGIN_AUTO_ENGINES) === '1' || config.auto_engines === true || (isCloud && config.auto_engines !== false);
  delete env.REA_PLUGIN_AUTO_ENGINES;

  const selection = Array.isArray(config.engines) && config.engines.length ? config.engines.join(',') : clean(env.REA_PLUGIN_ENGINES) || 'all';
  const wants = (name) => /(^|,)(all)(,|$)/.test(selection) || selection.split(',').map((s) => s.trim()).includes(name);

  if (autoEngines && process.platform === 'linux' && !env.GHIDRA_INSTALL_DIR) {
    const installer = path.join(PLUGIN_ROOT, 'scripts', 'install-engines.sh');
    if (wants('ghidra')) env.GHIDRA_INSTALL_DIR = path.join(dir, GHIDRA_DIR_NAME);
    if (wants('jadx') && !env.REA_JADX_MCP_JAR) env.REA_JADX_MCP_JAR = path.join(dir, JADX_JAR_NAME);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const lock = path.join(dir, 'install.lock');
      if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 30 * 60 * 1000) {
        log(`engine install already running (${lock}); REA starts now, re-open targets when it finishes`);
      } else {
        const out = fs.openSync(path.join(dir, 'install.log'), 'a');
        const child = spawn('bash', [installer, '--background'], {
          detached: true,
          stdio: ['ignore', out, out],
          env: { ...process.env, REA_PLUGIN_ENGINES_DIR: dir, REA_PLUGIN_ENGINES: selection },
        });
        child.unref();
        log(`Ghidra not found; installing engines (${selection}) in the background into ${dir} (log: ${dir}/install.log)`);
      }
    } catch (err) {
      log(`could not start engine installer: ${err.message}`);
    }
  }

  const reaArgs = ['mcp', ...process.argv.slice(2)];
  const useWsl = process.platform === 'win32' && (config.use_wsl === true || clean(env.REA_PLUGIN_USE_WSL) === '1');
  delete env.REA_PLUGIN_USE_WSL;

  let command;
  let args;
  let useShell = false;
  if (useWsl) {
    // Windows paths in the config are translated for WSL (C:\x\y -> /mnt/c/x/y) so users can
    // keep one config for both modes. Values that are already POSIX paths pass through.
    const toWsl = (v) => {
      const m = /^([A-Za-z]):[\\/](.*)$/.exec(v);
      return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : v;
    };
    const distro = clean(config.wsl_distro);
    const exportsList = ['GHIDRA_INSTALL_DIR', 'REA_JADX_MCP_JAR', 'REA_KUNA_COMMAND', 'REA_IDA_MCP_CONFIG', 'REA_BROWSER_EXECUTABLE']
      .filter((k) => env[k])
      .map((k) => `export ${k}=${shellQuote(toWsl(env[k]))};`)
      .join(' ');
    const inner = `${exportsList} exec npx -y rea-agents@${version} ${reaArgs.map(shellQuote).join(' ')}`;
    command = 'wsl.exe';
    args = [...(distro ? ['-d', distro] : []), '--', 'bash', '-lc', inner];
    log(`starting REA ${version} inside WSL${distro ? ` (${distro})` : ''}`);
  } else if (clean(env.REA_PLUGIN_REA_COMMAND) || clean(config.rea_command)) {
    // "rea" for a global install, or a path to rea.mjs (e.g. the copy bundled in a .mcpb).
    // A .mjs/.js path is run with this same Node binary so no PATH lookup is needed.
    const rc = clean(env.REA_PLUGIN_REA_COMMAND) || clean(config.rea_command);
    delete env.REA_PLUGIN_REA_COMMAND;
    if (/\.(mjs|cjs|js)$/i.test(rc)) { command = process.execPath; args = [rc, ...reaArgs]; }
    else if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(rc)) { command = rc; args = reaArgs; useShell = true; }
    else { command = rc; args = reaArgs; }
    log(`starting REA via ${rc}`);
  } else {
    // npx. On Windows, prefer running npm's npx-cli.js with this Node binary: it avoids the
    // cmd.exe quoting layer and Node's refusal to spawn .cmd files without a shell (EINVAL,
    // CVE-2024-27980). Fall back to npx.cmd through the shell when npx-cli.js is not beside node.
    const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (process.platform === 'win32' && fs.existsSync(npxCli)) {
      command = process.execPath; args = [npxCli, '-y', `rea-agents@${version}`, ...reaArgs];
    } else {
      command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      args = ['-y', `rea-agents@${version}`, ...reaArgs];
      useShell = process.platform === 'win32';
    }
  }

  const child = spawn(command, args, {
    env,
    stdio: 'inherit',
    shell: useShell,
    windowsHide: true,
  });
  child.on('error', (err) => {
    log(`failed to start ${command}: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code == null ? 1 : code);
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
}

main();
