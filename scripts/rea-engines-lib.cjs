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

// Engine version policy — the ONE place versions and checksums live. install-engines.sh /
// install-engines.ps1 carry copies for shell-only hosts; bump all three together.
// `install-engines.cjs --upgrade` moves an existing ~/.rea-engines to these versions.
const VERSIONS = {
  rea: '6.7.0',
  ghidra: '12.1.4',
  ghidraZip: 'ghidra_12.1.4_PUBLIC_20260921.zip',
  ghidraSha256: 'ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db',
  ghidraUrl: 'https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip',
  jadx: '0.7.1',
  jadxJar: 'jadx-headless-mcp-0.7.1-all.jar',
  jadxUrl: 'https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar',
  jdkMajor: 21,
  // Optional engines (selectable with "engines": [..., "apktool", "radare2"]).
  apktool: '3.0.3',
  apktoolJar: 'apktool_3.0.3.jar',
  apktoolSha256: 'dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423',
  apktoolUrl: 'https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar',
  radare2: '6.2.4',
  radare2Win: {
    x64: { zip: 'radare2-6.2.4-w64.zip', sha256: 'aa3454fd89e8a4ead450caff35a1d3919065744e7091540d4913a9487241799d', dir: 'radare2-6.2.4-w64' },
    arm64: { zip: 'radare2-6.2.4-w64-arm64.zip', sha256: '6566f55452ebb98adf15b43fc5328ba2467d21597ff59db35f0544db161a2f14', dir: 'radare2-6.2.4-w64-arm64' },
  },
  radare2UrlBase: 'https://github.com/radareorg/radare2/releases/download/6.2.4/',
};
const GHIDRA_DIR_NAME = `ghidra_${VERSIONS.ghidra}_PUBLIC`;
const JDK_DIR_NAME = `jdk-${VERSIONS.jdkMajor}`;
const RADARE2_DIR_NAME = 'radare2';

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

/**
 * ~/.rea-plugin.json, or $CLAUDE_PLUGIN_DATA/config.json. When REA_PLUGIN_CONFIG is set it
 * is the only file consulted (a missing file means "no config"), so tests and scripted
 * installs are hermetic on machines that also have a personal ~/.rea-plugin.json.
 */
function readConfig(log) {
  const explicit = clean(process.env.REA_PLUGIN_CONFIG);
  const candidates = explicit ? [explicit] : [
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
  // Any Ghidra release layout; the pinned one wins, otherwise the highest version present.
  const ghidras = entries.filter((e) => /^ghidra_\d+\.\d+(?:\.\d+)?_PUBLIC$/.test(e) && fs.existsSync(path.join(dir, e, 'support')));
  const ghidra = ghidras.includes(GHIDRA_DIR_NAME) ? GHIDRA_DIR_NAME : ghidras.sort(compareVersionDirs).pop();
  if (ghidra) found.GHIDRA_INSTALL_DIR = path.join(dir, ghidra);
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
  const apktool = entries.filter((e) => /^apktool_.*\.jar$/.test(e)).sort().pop();
  if (apktool) found.REA_APKTOOL_JAR = path.join(dir, apktool);
  const r2bin = path.join(dir, RADARE2_DIR_NAME, 'bin');
  if (fs.existsSync(path.join(r2bin, process.platform === 'win32' ? 'radare2.exe' : 'radare2'))) found.RADARE2_BIN = r2bin;
  if (fs.existsSync(path.join(dir, 'bin'))) found.ENGINES_BIN = path.join(dir, 'bin');
  return found;
}

function compareVersionDirs(a, b) {
  const va = (a.match(/\d+(?:\.\d+)*/) || ['0'])[0].split('.').map(Number);
  const vb = (b.match(/\d+(?:\.\d+)*/) || ['0'])[0].split('.').map(Number);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (va[i] || 0) - (vb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Integrity check of what discover() found: is each engine complete and usable?
 * Returns [{ engine, ok, detail, repair }] where `repair` is the exact installer command
 * that fixes a broken piece (used by /rea:doctor and ensure-engines --status).
 */
function validateEngines(config = {}, env = process.env) {
  const found = discoverAll(config);
  const dir = enginesDir(config);
  const installer = `node "${path.join(__dirname, 'install-engines.cjs')}"`;
  const out = [];
  const p = platformInfo();
  // Ghidra
  if (found.GHIDRA_INSTALL_DIR) {
    const g = found.GHIDRA_INSTALL_DIR;
    const headless = path.join(g, 'support', p.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless');
    const props = path.join(g, 'Ghidra', 'application.properties');
    const osDir = p.platform === 'win32' ? 'win_x86_64' : p.platform === 'darwin' ? (p.arch === 'arm64' ? 'mac_arm_64' : 'mac_x86_64') : (p.arch === 'arm64' ? 'linux_arm_64' : 'linux_x86_64');
    const decomp = path.join(g, 'Ghidra', 'Features', 'Decompiler', 'os', osDir, p.platform === 'win32' ? 'decompile.exe' : 'decompile');
    const missing = [[headless, 'support/analyzeHeadless'], [props, 'Ghidra/application.properties'], [decomp, `Decompiler/os/${osDir}/decompile`]].filter(([f]) => !fs.existsSync(f)).map(([, n]) => n);
    let version = '';
    try { version = (/application\.version=(.+)/.exec(fs.readFileSync(props, 'utf8')) || [])[1] || ''; } catch { /* ignore */ }
    const stale = version && version.trim() !== VERSIONS.ghidra;
    const tmpLeft = fs.existsSync(`${g}.tmp`);
    if (missing.length || tmpLeft) out.push({ engine: 'ghidra', ok: false, detail: `incomplete Ghidra at ${g}${missing.length ? ` (missing ${missing.join(', ')})` : ''}${tmpLeft ? ' (stale .tmp staging dir)' : ''} — a download or extraction was interrupted`, repair: `${installer} --force --only ghidra` });
    else if (stale) out.push({ engine: 'ghidra', ok: true, detail: `Ghidra ${version.trim()} at ${g} (pinned version is ${VERSIONS.ghidra})`, repair: `${installer} --upgrade` });
    else out.push({ engine: 'ghidra', ok: true, detail: `Ghidra ${version.trim() || VERSIONS.ghidra} at ${g}` });
  } else {
    out.push({ engine: 'ghidra', ok: false, detail: `Ghidra not found in ${dir}`, repair: `${installer} --only ghidra` });
  }
  // JDK
  const jdk = findJdk(config, env);
  if (jdk.ok) out.push({ engine: 'jdk', ok: true, detail: `${jdk.line} [${jdk.source}${jdk.javaHome ? `: ${jdk.javaHome}` : ''}]` });
  else if (jdk.major >= VERSIONS.jdkMajor && !jdk.javac) out.push({ engine: 'jdk', ok: false, detail: `java ${jdk.major} found but javac is missing (a JRE, not a JDK) — Ghidra needs a full JDK`, repair: `${installer} --force --only jdk` });
  else if (jdk.major && jdk.major < VERSIONS.jdkMajor) out.push({ engine: 'jdk', ok: false, detail: `java ${jdk.major} is too old (need ${VERSIONS.jdkMajor}+)`, repair: `${installer} --only jdk` });
  else out.push({ engine: 'jdk', ok: false, detail: 'no usable JDK 21+', repair: `${installer} --only jdk` });
  // jadx
  if (found.REA_JADX_MCP_JAR) {
    const jar = found.REA_JADX_MCP_JAR;
    let okZip = false;
    try { const fd = fs.openSync(jar, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); okZip = b[0] === 0x50 && b[1] === 0x4b; } catch { /* ignore */ }
    if (okZip) out.push({ engine: 'jadx', ok: true, detail: `${path.basename(jar)}${path.basename(jar) !== VERSIONS.jadxJar ? ` (pinned: ${VERSIONS.jadxJar})` : ''}`, ...(path.basename(jar) !== VERSIONS.jadxJar ? { repair: `${installer} --upgrade` } : {}) });
    else out.push({ engine: 'jadx', ok: false, detail: `${jar} is not a valid jar (truncated download)`, repair: `${installer} --force --only jadx` });
  } else {
    out.push({ engine: 'jadx', ok: false, detail: `jadx-headless-mcp not found in ${dir}`, repair: `${installer} --only jadx` });
  }
  // optional engines: report only when present or selected
  const sel = engineSelection(config, env);
  if (found.REA_APKTOOL_JAR || sel.list.includes('apktool')) out.push({ engine: 'apktool', ok: Boolean(found.REA_APKTOOL_JAR), detail: found.REA_APKTOOL_JAR ? path.basename(found.REA_APKTOOL_JAR) : 'not installed (optional)', ...(found.REA_APKTOOL_JAR ? {} : { repair: `${installer} --only apktool` }) });
  if (found.RADARE2_BIN || sel.list.includes('radare2')) out.push({ engine: 'radare2', ok: Boolean(found.RADARE2_BIN), detail: found.RADARE2_BIN || 'not installed (optional)', ...(found.RADARE2_BIN ? {} : { repair: `${installer} --only radare2` }) });
  return out;
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

/**
 * JDKs installed by other tools (IntelliJ's ~/.jdks, Temurin/Microsoft/Zulu/Corretto
 * installers, Homebrew, apt, sdkman). Returned newest-first; only directories with a java
 * binary. Used before downloading anything, so a machine that already has a JDK 21+ never
 * fetches another one.
 */
function systemJdkCandidates(env = process.env) {
  const home = os.homedir();
  const roots = [];
  if (process.platform === 'win32') {
    const pf = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    for (const base of pf) for (const vendor of ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru', 'OpenJDK', 'Azul']) roots.push(path.join(base, vendor));
    roots.push(path.join(home, '.jdks'), path.join(home, 'scoop', 'apps'));
  } else if (process.platform === 'darwin') {
    roots.push('/Library/Java/JavaVirtualMachines', path.join(home, 'Library', 'Java', 'JavaVirtualMachines'), '/opt/homebrew/opt', '/usr/local/opt', path.join(home, '.jdks'), path.join(home, '.sdkman', 'candidates', 'java'));
  } else {
    roots.push('/usr/lib/jvm', '/usr/java', '/opt', path.join(home, '.jdks'), path.join(home, '.sdkman', 'candidates', 'java'));
  }
  const found = [];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries) {
      if (!/jdk|java|temurin|zulu|corretto|openjdk|semeru|liberica|microsoft/i.test(e) && root !== '/usr/lib/jvm') continue;
      const dir = path.join(root, e);
      const candidates = [dir, path.join(dir, 'Contents', 'Home'), path.join(dir, 'libexec', 'openjdk.jdk', 'Contents', 'Home'), path.join(dir, 'current')];
      for (const c of candidates) if (fs.existsSync(javaBin(c)) && !found.includes(c)) found.push(c);
    }
  }
  return found.sort(compareVersionDirs).reverse();
}

/** Is a suitable JDK reachable: explicit JAVA_HOME, the bundled one, PATH, or a system install? */
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
  for (const c of systemJdkCandidates(env)) {
    // Cheap pre-filter on the directory name before spawning java: skip obvious < 21.
    const m = /(\d+)/.exec(path.basename(c.replace(/[\\/]Contents[\\/]Home$/, '')));
    if (m && Number(m[1]) >= 8 && Number(m[1]) < VERSIONS.jdkMajor) continue;
    const info = javaInfo(javaBin(c), env);
    if (info.ok) return { source: 'system', javaHome: c, ...info };
  }
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

/**
 * Which engines the user wants: REA_PLUGIN_ENGINES, config.engines, or all.
 * "all" = ghidra, jadx, apt (Linux). Optional engines (apktool, radare2) are installed only
 * when listed explicitly or when "all" is combined with config.optional_engines: true.
 */
function engineSelection(config = {}, env = process.env) {
  const sel = clean(env.REA_PLUGIN_ENGINES) || (Array.isArray(config.engines) && config.engines.length ? config.engines.join(',') : 'all');
  const list = sel.split(',').map((s) => s.trim()).filter(Boolean);
  const optional = config.optional_engines === true || clean(env.REA_PLUGIN_OPTIONAL_ENGINES) === '1';
  const wants = (name) => list.includes(name) || (list.includes('all') && (!OPTIONAL_ENGINES.includes(name) || optional));
  return { selection: sel, list, wants, optional };
}
const OPTIONAL_ENGINES = ['apktool', 'radare2'];

/** Where pre-downloaded archives are looked up before hitting the network (offline / mirror). */
function archiveDirs(config = {}, env = process.env, dir = enginesDir(config)) {
  return [clean(env.REA_PLUGIN_ARCHIVE_DIR), clean(config.archive_dir), path.join(dir, 'archives')].filter(Boolean);
}

/**
 * Router settings: ~/.rea-plugin.json `router` (true/false/{allow,deny}) plus a project
 * `.rea-plugin.json` in $CLAUDE_PROJECT_DIR (same shape) whose values take precedence.
 * allow/deny are regex strings tested against the prompt; deny wins, allow forces routing.
 */
function routerConfig(config = {}, env = process.env) {
  const merged = { enabled: true, allow: [], deny: [] };
  const apply = (r) => {
    if (r === false) merged.enabled = false;
    else if (r === true) merged.enabled = true;
    else if (r && typeof r === 'object') {
      if (r.enabled === false) merged.enabled = false;
      if (r.enabled === true) merged.enabled = true;
      if (Array.isArray(r.allow)) merged.allow.push(...r.allow.filter((x) => typeof x === 'string'));
      if (Array.isArray(r.deny)) merged.deny.push(...r.deny.filter((x) => typeof x === 'string'));
    }
  };
  apply(config.router);
  const projectDir = clean(env.CLAUDE_PROJECT_DIR);
  if (projectDir) {
    try {
      const pc = JSON.parse(fs.readFileSync(path.join(projectDir, '.rea-plugin.json'), 'utf8'));
      apply(pc && pc.router);
      merged.projectFile = path.join(projectDir, '.rea-plugin.json');
    } catch { /* none */ }
  }
  if (clean(env.REA_PLUGIN_ROUTER) === '0') merged.enabled = false;
  return merged;
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
    REA_APKTOOL_JAR: path.join(dir, VERSIONS.apktoolJar),
    RADARE2_DIR: path.join(dir, RADARE2_DIR_NAME),
    BIN_DIR: path.join(dir, 'bin'),
  };
}

/** Human-readable one-liner of what is present. */
function summarize(found, jdk) {
  const parts = [];
  parts.push(found.GHIDRA_INSTALL_DIR ? `Ghidra ✓ (${found.GHIDRA_INSTALL_DIR})` : 'Ghidra ✗');
  parts.push(found.REA_JADX_MCP_JAR ? 'jadx ✓' : 'jadx ✗');
  parts.push(jdk && jdk.ok ? `JDK ${jdk.major} ✓ (${jdk.source})` : 'JDK 21+ ✗');
  if (found.REA_APKTOOL_JAR) parts.push('apktool ✓');
  if (found.RADARE2_BIN) parts.push('radare2 ✓');
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// MCP registration: is the `rea` server going to exist in this session at all?
//
// claude.ai cloud sessions start Claude Code with CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS=1: plugin
// skills, hooks and commands load, but every plugin-declared MCP server is skipped (an
// _EXCEPT list names the few that are not). There the only way to get mcp__rea__* tools is a
// project-level .mcp.json (plus enableAllProjectMcpServers) or a user-level entry in
// ~/.claude.json. Local Claude Code and Claude Desktop load the plugin's server normally.
// ---------------------------------------------------------------------------------------------
function hasReaServer(file, projectDir) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.mcpServers && j.mcpServers.rea) return true;
    // ~/.claude.json keeps per-project (local-scope) servers under projects[<dir>].mcpServers
    if (projectDir && j && j.projects) {
      for (const [dir, cfg] of Object.entries(j.projects)) {
        if (path.resolve(dir) === path.resolve(projectDir) && cfg && cfg.mcpServers && cfg.mcpServers.rea) return true;
      }
    }
  } catch { /* missing or invalid */ }
  return false;
}

function mcpRegistration(cwd) {
  const projectDir = clean(process.env.CLAUDE_PROJECT_DIR) || cwd || process.cwd();
  const skip = clean(process.env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS);
  const except = (process.env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT || '').split(',').map((s) => s.trim()).filter(Boolean);
  const pluginMcpSkipped = Boolean(skip) && skip !== '0' && skip !== 'false' && !except.includes('rea');
  const project = hasReaServer(path.join(projectDir, '.mcp.json'));
  const user = hasReaServer(path.join(os.homedir(), '.claude.json'), projectDir);
  const cloud = process.env.CLAUDE_CODE_REMOTE === 'true' || Boolean(clean(process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE));
  const source = project ? 'project .mcp.json' : user ? '~/.claude.json' : pluginMcpSkipped ? null : 'plugin manifest';
  return { projectDir, pluginMcpSkipped, project, user, cloud, loaded: Boolean(source), source };
}

// A claude.ai session linked to the user's computer relays that computer's MCP servers into
// the session under the remote-devices prefix: the plugin's `rea` server running in Claude
// Desktop shows up as mcp__remote-devices__plugin_rea_rea__open_binary and so on. Hooks
// cannot see the tool list, so they describe this name and let Claude check for it.
const LINKED_TOOL_PREFIX = 'mcp__remote-devices__plugin_rea_rea__';

// Files written into a directory that is not under git do not outlive a cloud container.
function insideGitRepo(dir) {
  let d = path.resolve(dir || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    const up = path.dirname(d);
    if (up === d) return false;
    d = up;
  }
}

module.exports = {
  VERSIONS,
  mcpRegistration,
  LINKED_TOOL_PREFIX,
  insideGitRepo,
  GHIDRA_DIR_NAME,
  JDK_DIR_NAME,
  RADARE2_DIR_NAME,
  OPTIONAL_ENGINES,
  compareVersionDirs,
  validateEngines,
  archiveDirs,
  routerConfig,
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
  systemJdkCandidates,
  installStatus,
  engineSelection,
  autoEnginesEnabled,
  expectedPaths,
  summarize,
};
