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
 * Auto-engines (default on every OS; disable with "auto_engines": false or REA_PLUGIN_AUTO_ENGINES=0):
 * if Ghidra is missing, the matching installer is started detached — install-engines.sh on
 * Linux with apt, install-engines.cjs on Windows / macOS / other Linux — and REA is started
 * immediately with the paths the installer will produce. REA resolves providers per call, so
 * once the install finishes you only need to re-open the target (open_binary).
 *
 * JDK: when ~/.rea-engines/jdk-21 exists (installed by install-engines.cjs because no JDK 21+
 * was found) it is exported as JAVA_HOME and put first on PATH for REA and Ghidra, unless the
 * user already set JAVA_HOME. config.java_home overrides both.
 *
 * Windows + config.use_wsl: REA is executed inside WSL (wsl.exe -d <distro>) so the Linux-only
 * tooling (binwalk, tshark, mitmproxy, Linux Ghidra) is available while Claude runs on Windows.
 * Paths in the config must then be Linux paths.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const lib = require('./rea-engines-lib.cjs');

const DEFAULT_REA_VERSION = lib.VERSIONS.rea;

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
const clean = lib.clean;

function main() {
  const config = lib.readConfig(log);
  const env = { ...process.env };
  const dir = lib.enginesDir(config);
  const discovered = lib.discoverAll(config);

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

  // JDK: user JAVA_HOME > config.java_home > bundled ~/.rea-engines/jdk-21. Ghidra and the
  // jadx jar both need it; putting bin/ first on PATH covers tools that call plain `java`.
  // Falls back to a JDK another tool installed (IntelliJ ~/.jdks, Temurin, Homebrew, apt …)
  // so a machine that already has Java 21+ never downloads a second one.
  let javaHome = clean(env.JAVA_HOME) || clean(config.java_home) || discovered.JAVA_HOME;
  let javaSource = clean(env.JAVA_HOME) ? 'JAVA_HOME' : clean(config.java_home) ? 'config' : discovered.JAVA_HOME ? 'bundled' : null;
  if (!javaHome) {
    const sys = lib.findJdk(config, env);
    if (sys.ok && sys.javaHome) { javaHome = sys.javaHome; javaSource = sys.source; }
  }
  if (javaHome && fs.existsSync(lib.javaBin(javaHome))) {
    env.JAVA_HOME = javaHome;
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    const bin = path.join(javaHome, 'bin');
    if (!(env[pathKey] || '').split(path.delimiter).includes(bin)) env[pathKey] = bin + path.delimiter + (env[pathKey] || '');
    if (javaSource === 'bundled' || javaSource === 'system') log(`using ${javaSource} JDK: ${javaHome}`);
  }

  // Optional engines: <engines>/bin (apktool wrapper) and radare2/bin go first on PATH so
  // REA finds `apktool` / `radare2` / `r2` exactly like an apt install would provide them.
  {
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    const extra = [discovered.RADARE2_BIN, discovered.ENGINES_BIN].filter(Boolean);
    const parts = (env[pathKey] || '').split(path.delimiter);
    for (const dirToAdd of extra.reverse()) if (!parts.includes(dirToAdd)) env[pathKey] = dirToAdd + path.delimiter + env[pathKey];
    if (discovered.REA_APKTOOL_JAR && !clean(env.REA_APKTOOL_JAR)) env.REA_APKTOOL_JAR = discovered.REA_APKTOOL_JAR;
  }

  const autoEngines = lib.autoEnginesEnabled(config, env);
  delete env.REA_PLUGIN_AUTO_ENGINES;

  const { selection, wants } = lib.engineSelection(config, env);
  const expected = lib.expectedPaths(dir);
  const plat = lib.platformInfo();

  // `launch-rea.cjs doctor [--format json]` runs REA's doctor with exactly the environment
  // the MCP server gets (used by /rea:doctor). It never starts an install.
  const isDoctor = process.argv[2] === 'doctor';
  const reaArgs = isDoctor ? process.argv.slice(2) : ['mcp', ...process.argv.slice(2)];

  if (autoEngines && !isDoctor && plat.supported && !env.GHIDRA_INSTALL_DIR && wants('ghidra')) {
    // Tell REA where the engines *will* be, then install them in the background.
    env.GHIDRA_INSTALL_DIR = expected.GHIDRA_INSTALL_DIR;
    if (wants('jadx') && !env.REA_JADX_MCP_JAR) env.REA_JADX_MCP_JAR = expected.REA_JADX_MCP_JAR;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const status = lib.installStatus(dir);
      if (status.running) {
        log(`engine install already running (${status.lock}); REA starts now, re-open targets when it finishes`);
      } else {
        const useBash = process.platform === 'linux' && wants('apt') && fs.existsSync('/usr/bin/apt-get');
        const command = useBash ? 'bash' : process.execPath;
        const args = useBash
          ? [path.join(__dirname, 'install-engines.sh'), '--background']
          : [path.join(__dirname, 'install-engines.cjs'), '--background'];
        const out = fs.openSync(status.log, 'a');
        const child = spawn(command, args, {
          detached: true,
          stdio: ['ignore', out, out],
          env: { ...process.env, REA_PLUGIN_ENGINES_DIR: dir, REA_PLUGIN_ENGINES: selection },
          windowsHide: true,
        });
        child.unref();
        log(`Ghidra not found; installing engines (${selection}) for ${plat.label} in the background into ${dir} (log: ${status.log})`);
      }
    } catch (err) {
      log(`could not start engine installer: ${err.message}`);
    }
  }

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
