/*
 * rea-engines-lib.cjs — shared helpers for the launcher, the SessionStart hook and the
 * cross-platform installer. Pure Node, no dependencies, CommonJS so every script can
 * `require()` it (launch-rea.cjs runs on Claude Desktop's bundled Node too).
 *
 * Everything here is read-only: it discovers what is installed and where things should
 * go. Nothing in this file downloads or writes.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Pinned engine versions. Keep in sync with install-engines.sh / install-engines.ps1.
const VERSIONS = {
  rea: '6.7.0',
  ghidra: '12.1.4',
  ghidraZip: 'ghidra_12.1.4_PUBLIC_20260921.zip',
  ghidraSha256: 'ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db',
  ghidraUrl: 'https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip',
  jadxJar: 'jadx-headless-mcp-0.7.1-all.jar',
  jadxUrl: 'https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar',
  jdkMajor: 21,
};
const GHIDRA_DIR_NAME = `ghidra_${VERSIONS.ghidra}_PUBLIC`;
const JDK_DIR_NAME = `jdk-${VERSIONS.jdkMajor}`;

const clean = (v) =>
  typeof v === 'string' && v.trim() !== '' && !v.trim().startsWith('${') ? v.trim() : undefined;

/** Platform descriptor used for download selection and user-facing messages. */
function platformInfo() {
  const p = process.platform;
  const a = process.arch;
  const osName = p === 'win32' ? 'windows' : p === 'darwin' ? 'macos' : p;
  const adoptiumOs = p === 'win32' ? 'windows' : p === 'darwin' ? 'mac' : 'linux';
  const adoptiumArch = a === 'arm64' ? 'aarch64' : a === 'x64' ? 'x64' : a;
  return {
    platform: p,
    arch: a,
    osName,
    adoptiumOs,
    adoptiumArch,
    label: `${osName}/${a}`,
    supported: ['win32', 'darwin', 'linux'].includes(p) && ['x64', 'arm64'].includes(a),
  };
}

/** ~/.rea-plugin.json (or $REA_PLUGIN_CONFIG, or $CLAUDE_PLUGIN_DATA/config.json). */
function readConfig(log) {
  const candidates = [
    clean(process.env.REA_PLUGIN_CONFIG),
    path.join(os.homedir(), '.rea-plugin.json'),
    clean(process.env.CLAUDE_PLUGIN_DATA) && path.join(process.env.CLAUDE_PLUGIN_DATA, 'config.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        if (log) log(`config: ${file}`);
        return parsed;
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT' && log) log(`config ${file} ignored: ${err.message}`);
    }
  }
  return {};
}

/**
 * Where engines live. One directory per user, shared by Claude Code, Claude Desktop and
 * cloud sessions so a 600 MB Ghidra is only ever downloaded once per machine:
 *   REA_PLUGIN_ENGINES_DIR > config.engines_dir > ~/.rea-engines
 * ($CLAUDE_PLUGIN_DATA/engines is still honoured for discovery, see discover()).
 */
function enginesDir(config = {}) {
  return (
    clean(process.env.REA_PLUGIN_ENGINES_DIR) ||
    clean(config.engines_dir) ||
    path.join(os.homedir(), '.rea-engines')
  );
}

function legacyEnginesDirs() {
  const out = [];
  if (clean(process.env.CLAUDE_PLUGIN_DATA)) out.push(path.join(process.env.CLAUDE_PLUGIN_DATA, 'engines'));
  return out;
}

/** Path of the java executable inside a JDK home, per OS. */
function javaBin(javaHome) {
  return path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

/** macOS tarballs unpack to <dir>/Contents/Home; normalise to the real JAVA_HOME. */
function resolveJavaHome(dir) {
  if (!dir) return undefined;
  const macHome = path.join(dir, 'Contents', 'Home');
  if (fs.existsSync(javaBin(macHome))) return macHome;
  if (fs.existsSync(javaBin(dir))) return dir;
  return undefined;
}

/** Look at one directory and report which engines it holds. */
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
  if (jadx) {
    try {
      if (fs.statSync(path.join(dir, jadx)).size > 0) found.REA_JADX_MCP_JAR = path.join(dir, jadx);
    } catch { /* ignore */ }
  }
  const kuna = entries.find((e) => e === 'kuna' || e === 'kuna.exe');
  if (kuna) found.REA_KUNA_COMMAND = path.join(dir, kuna);
  const jdk = entries.filter((e) => /^jdk-\d+/.test(e)).sort().pop();
  const javaHome = jdk && resolveJavaHome(path.join(dir, jdk));
  if (javaHome) found.JAVA_HOME = javaHome;
  return found;
}

/** discover() across the primary and legacy directories; first hit per key wins. */
function discoverAll(config = {}) {
  const dirs = [enginesDir(config), ...legacyEnginesDirs()];
  const merged = {};
  for (const d of dirs) {
    for (const [k, v] of Object.entries(discover(d))) if (!merged[k]) merged[k] = v;
  }
  return merged;
}

/**
 * Run `java -version` (and look for javac) for a given java binary or the one on PATH.
 * Returns { ok, major, line, javac } — `ok` means a full JDK >= VERSIONS.jdkMajor.
 * Note: JAVA_TOOL_OPTIONS makes java print an extra first line, so every line is scanned.
 */
function javaInfo(javaExe, env = process.env) {
  const exe = javaExe || (process.platform === 'win32' ? 'java.exe' : 'java');
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8', env, timeout: 15000, windowsHide: true });
  if (r.error || r.status !== 0) return { ok: false, major: 0, line: '', javac: false };
  const text = `${r.stderr || ''}\n${r.stdout || ''}`;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  const major = m ? Number(m[1]) : 0;
  const line = (text.split('\n').find((l) => /version "/.test(l)) || '').trim();
  let javacExe;
  if (javaExe) javacExe = path.join(path.dirname(javaExe), process.platform === 'win32' ? 'javac.exe' : 'javac');
  else javacExe = process.platform === 'win32' ? 'javac.exe' : 'javac';
  const jc = spawnSync(javacExe, ['-version'], { encoding: 'utf8', env, timeout: 15000, windowsHide: true });
  const javac = !jc.error && jc.status === 0;
  return { ok: major >= VERSIONS.jdkMajor && javac, major, line, javac };
}

/** Is a suitable JDK reachable: explicit JAVA_HOME, the bundled one, or PATH? */
function findJdk(config = {}, env = process.env) {
  const fromEnv = clean(env.JAVA_HOME);
  if (fromEnv && fs.existsSync(javaBin(fromEnv))) {
    const info = javaInfo(javaBin(fromEnv), env);
    if (info.ok) return { source: 'JAVA_HOME', javaHome: fromEnv, ...info };
  }
  const bundled = discoverAll(config).JAVA_HOME;
  if (bundled) {
    const info = javaInfo(javaBin(bundled), env);
    if (info.ok) return { source: 'bundled', javaHome: bundled, ...info };
  }
  const onPath = javaInfo(undefined, env);
  if (onPath.ok) return { source: 'PATH', javaHome: undefined, ...onPath };
  return { source: 'none', javaHome: undefined, ok: false, major: onPath.major, line: onPath.line, javac: onPath.javac };
}

/** Status of a background install in `dir`: running (fresh lock), done, or idle. */
function installStatus(dir) {
  const lock = path.join(dir, 'install.lock');
  const done = path.join(dir, 'install.done');
  const log = path.join(dir, 'install.log');
  let running = false;
  try {
    running = Date.now() - fs.statSync(lock).mtimeMs < 30 * 60 * 1000;
  } catch { /* no lock */ }
  return { running, done: fs.existsSync(done), lock, doneFile: done, log };
}

/** Which engines the user wants: config.engines array, REA_PLUGIN_ENGINES, or all. */
function engineSelection(config = {}, env = process.env) {
  const sel = Array.isArray(config.engines) && config.engines.length ? config.engines.join(',') : clean(env.REA_PLUGIN_ENGINES) || 'all';
  const list = sel.split(',').map((s) => s.trim()).filter(Boolean);
  const wants = (name) => list.includes('all') || list.includes(name);
  return { selection: sel, list, wants };
}

/** Should engines be installed automatically when missing? Default: yes, unless disabled. */
function autoEnginesEnabled(config = {}, env = process.env) {
  if (clean(env.REA_PLUGIN_AUTO_ENGINES) === '0') return false;
  if (clean(env.REA_PLUGIN_AUTO_ENGINES) === '1') return true;
  if (config.auto_engines === false) return false;
  return true;
}

/** Expected final paths for engines in `dir` (what the installer will produce). */
function expectedPaths(dir) {
  return {
    GHIDRA_INSTALL_DIR: path.join(dir, GHIDRA_DIR_NAME),
    REA_JADX_MCP_JAR: path.join(dir, VERSIONS.jadxJar),
    JDK_DIR: path.join(dir, JDK_DIR_NAME),
  };
}

/** Human-readable one-liner of what is present. */
function summarize(found, jdk) {
  const parts = [];
  parts.push(found.GHIDRA_INSTALL_DIR ? `Ghidra ✓ (${found.GHIDRA_INSTALL_DIR})` : 'Ghidra ✗');
  parts.push(found.REA_JADX_MCP_JAR ? 'jadx ✓' : 'jadx ✗');
  parts.push(jdk && jdk.ok ? `JDK ${jdk.major} ✓ (${jdk.source})` : 'JDK 21+ ✗');
  return parts.join(', ');
}

module.exports = {
  VERSIONS,
  GHIDRA_DIR_NAME,
  JDK_DIR_NAME,
  clean,
  platformInfo,
  readConfig,
  enginesDir,
  legacyEnginesDirs,
  javaBin,
  resolveJavaHome,
  discover,
  discoverAll,
  javaInfo,
  findJdk,
  installStatus,
  engineSelection,
  autoEnginesEnabled,
  expectedPaths,
  summarize,
};
